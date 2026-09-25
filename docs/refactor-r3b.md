# R3b: hiệu năng theo chunk (render, collider, LOS, nav)

Ngày 25/09/2026. Sau map content M1–M2 (R3a, commit 86ce472), theo thứ tự đã chốt: **R3a → R3b → M3 (editor)**. Save **không đổi (v8)**; content không đổi.

## 1. Tóm tắt

| Bước | Thay đổi | Kết quả chính |
|---|---|---|
| 1. LOS phía simulation | Tầm nhìn/đòn đánh của zombie, tương tác, cận chiến và che điểm spawn dùng `StaticColliderRegistry.segmentBlocked` (cùng bộ hộp Rapier từng có), không raycast Rapier nữa. Bỏ `PhysicsBridge` | 15 000 đoạn ngẫu nhiên (khu phố với cửa đóng/mở/vỡ, map stress) **trùng 100 %** với Rapier thật |
| 2. Gộp render theo chunk | Tường, vật cản, thân container, sàn, mái vẽ bằng một `BatchedMesh` cho mỗi chunk (`StaticBatches`); làm mờ vật che dựa trên hộp | Draw call: map thường 194 → **62**, map stress 335 → **106**; số đo ánh sáng trong nhà giữ nguyên |
| 3. Collider Rapier theo chunk | Mỗi chunk một body tĩnh. Chỉ nạp các chunk trong vòng 1 chunk quanh người chơi, cộng hộp dài hơn 1 chunk (tường biên) | Object trong scene ở map stress 5 130 → ~1 676; body tĩnh ~1 100 → ≤ 10 |
| 4. Nav theo chunk (HPA*) | Nhãn vùng tính theo tile 32 m rồi hợp nhất qua biên. Đường dài (cách ≥ 2 tile) đi trên đồ thị điểm chuyển tiếp, tinh chỉnh bằng A* trong từng tile. Đường ngắn giữ A* cũ | Bão tìm đường trên map stress: tick tệ nhất 9,2 → 4,9 ms (cùng LOS); đổi cửa chỉ gán nhãn lại tile liên quan |
| 5. Soak dùng LOS thật | Soak và benchmark Node bỏ LOS giả theo lưới nav | Mốc soak mới, sát game hơn |

**CPU/frame trên trình duyệt** (Intel UHD 730, màn hình khóa 75 Hz):
- Map stress đứng yên: R2 10,5–10,9 ms → R3b **5,2–7,6 ms** (4 lần chạy; máy có tải nền nên dao động).
- 224 zombie: R2 12,3–14,3 ms → **7,6–8,5 ms**.

## 2. Chi tiết

### 2.1 LOS phía simulation (`world/staticColliders.ts`, `core/runtime.ts`)

- `segmentBlocked(from, to, ignoreId)`:
  - lấy hộp ứng viên từ chỉ mục không gian của registry, rồi dùng slab test 3D (`segmentBoxEntry`, dùng chung với tầm nhìn người chơi);
  - bỏ qua lá cửa ở tư thế không hiện hành;
  - bỏ qua hộp có `blockerId` trùng ID đang tương tác (lá cửa khai báo `blockerId` = ID cửa, như `userData` Rapier trước đây).
- `runtime.isBlocked()` là nguồn duy nhất cho mọi truy vấn che chắn. Test có thể thay bằng `setLineOfSightOverride` (đổi tên từ `registerPhysicsQuery`).
- Hệ quả:
  - AI không còn phụ thuộc collider của engine vật lý, nên zombie NEAR/DORMANT và chunk chưa nạp collider vẫn "nhìn" đúng.
  - Trong test Node, LOS giờ là LOS thật (trước đây không có Rapier thì luôn coi là thông).
- Test: `world/lineOfSight.test.ts` dựng thế giới Rapier WASM trong Node bằng đúng các collider các view từng tạo, rồi so với `segmentBlocked`.

### 2.2 Render gộp theo chunk (`rendering/StaticBatches.tsx`, `staticBatchData.ts`)

- Dữ liệu: `collectStaticItems(map, colliders)` gồm tường/vật cản từ registry, thân container, sàn và mái; nhóm theo chunk của tâm vật (`groupByChunk`).
- Mỗi chunk là một `BatchedMesh`: hình hộp đơn vị + sàn đơn vị, mỗi instance có ma trận và màu riêng trên **một material trắng dùng chung**; bỏ sắp xếp theo độ sâu, vẫn cull từng instance. three.js tự vẽ từng phần nếu GPU thiếu `WEBGL_multi_draw`.
- Shader ánh sáng trong nhà: vị trí thế giới giờ tính cả `batchingMatrix`/`instanceMatrix` (khóa chương trình `indoor-lighting-v2`), nên sàn/tường gộp vẫn nhận ánh sáng phòng. Script lighting đo lại được đúng 92,5 / 15,1 / 84.
- Làm mờ vật che (`occlusionRegistry`, `OcclusionFader`):
  - vật che giờ là **hộp + hai callback**; fader kiểm tra tia–hộp thay cho raycast mesh;
  - tường cao ≥ 1,5 m và mái ẩn instance trong batch, rồi hiện một bản sao mờ (vẫn đổ bóng);
  - lá cửa vẫn đăng ký mesh của nó.
- Mái nhà: `RoofController` ẩn instance mái khi người chơi ở trong nhà.
- StrictMode: đăng ký nằm trong effect; giải phóng GPU được hoãn và có cờ `disposed`, để không đụng batch StrictMode gắn lại (lỗi này đã gặp và sửa trong lúc làm).
- `BuildingView.tsx` và `Walls.tsx` bị bỏ. `ContainerView` chỉ còn đèn báo trạng thái.

### 2.3 Collider Rapier theo chunk (`rendering/ChunkColliders.tsx`, `chunkColliderData.ts`)

- Sau bước 1, Rapier chỉ còn lo va chạm của thân người chơi với thế giới (zombie là kinematic).
- Hộp tường, container và kính cửa sổ lấy từ registry, nhóm theo chunk của tâm. Hộp dài hơn 1 chunk vào nhóm `wide`, luôn nạp.
- Nạp các chunk trong `GAME_CONFIG.streaming.colliderChunkRadius` (1) quanh chunk của người chơi; tính lại mỗi frame, chỉ re-render khi tập chunk đổi.
- Bảo đảm (có test): mọi hộp cách người chơi dưới (radius − ½) · 32 = 16 m đều đã được nạp.
- Kiểm tra trình duyệt: trên map stress, dịch chuyển tới chunk xa rồi đi bằng phím thật vào 4 mặt tường. Kết quả: 16/16 lần, 8 lần áp sát tường, không lần nào xuyên vào nhà.
- Lá cửa giữ body riêng trong `DoorView`, vì tư thế đổi theo trạng thái.

### 2.4 Nav theo chunk (`world/gridSearch.ts`, `world/navTiles.ts`, `world/navigation.ts`)

- `GridSearch`: A* (không đổi phép tính, nên đường ngắn giống hệt trước) và Dijkstra, giới hạn trong một hình chữ nhật ô, buffer dùng lại.
- `NavTiles`: tile = các ô có tâm nằm trong một chunk 32 m (map stress 200 m → 8 × 8 tile).
  - **Vùng liên thông**: gán nhãn 4 hướng trong từng tile, rồi union-find qua các cặp nhãn ở mỗi cạnh tile. `componentAt`/`routeKind` tra O(1).
  - **Đổi cửa**: chỉ gán nhãn lại tile chứa cửa. Tile láng giềng chỉ bị ảnh hưởng khi ô cửa nằm sát biên. Đo được 0,1 ms cho đổi cửa + tra vùng, so với loang cả lưới trước đây.
  - **Đường dài (HPA*)**:
    - Mỗi cạnh tile có điểm chuyển tiếp: giữa đoạn ngắn (≤ 5 cặp ô), hai đầu đoạn dài.
    - Cạnh trong tile là chi phí Dijkstra giới hạn trong tile, tính khi được dùng lần đầu và cache tới khi tile đổi.
    - Toàn bộ đồ thị được dựng lúc nạp map (map thường 6,6 ms, map stress ~205 ms). Tile bị huỷ do đổi cửa được làm nóng lại 0,5 ms/tick khi hàng đợi path rảnh (`pathfinding.warmMs`). Việc làm nóng chỉ đổi thời điểm tính, không đổi kết quả (có test).
    - Kết quả được tinh chỉnh bằng A* trong từng tile, rồi làm thẳng trong cửa sổ 48 điểm.
  - Start và goal cách ≤ 1 tile thì dùng một A* như trước. Nếu A* đó hết ngân sách, chuyển sang HPA*.
- Chất lượng (map stress, 60 cặp > 90 m): độ dài / tối ưu trên lưới trung bình 0,99, tệ nhất 1,07 (đường đã làm thẳng có thể ngắn hơn đường ô). Thời gian khi đồ thị đã nóng: trung bình 1,2 ms, tệ nhất 2,2 ms.
- Test (`navTiles.test.ts`):
  - vùng khớp phép loang toàn lưới (3 000 cặp × 4 trạng thái cửa);
  - nhà đóng hết cửa bị tách vùng;
  - 40 đường dài hợp lệ và ≤ 1,15 × tối ưu;
  - cache nóng/nguội cho cùng kết quả;
  - đường dài < 8 ms.

## 3. Hiệu năng

### Node (`PERF_SCENARIOS=1`, 20 s ở 60 tick/s)

M2 dùng LOS giả theo lưới nav; R3b dùng LOS thật (bộ hộp va chạm).

| Kịch bản | Chỉ số | M2 | R3b (2 lần chạy) |
|---|---|---:|---:|
| stress/standing | tick trung bình (ms) | 0,067 | 0,057 / 0,042 |
| stress/crowd (224) | tick trung bình (ms) | 0,623 | 0,612 / 0,593 |
| stress/pathing | tick trung bình (ms) | 1,243 | 1,125 / 1,148 |
| stress/pathing | tick p99 (ms) | 5,76 | 4,34 / 4,81 |
| stress/pathing | tick tệ nhất (ms) | 9,2 | 8,4 / 6,0 |
| stress/pathing | nav tệ nhất (ms) | 5,8 | 4,1 / 4,8 |
| normal/* | tick trung bình (ms) | 0,04–0,18 | 0,03–0,17 |

Riêng bước nav, đo cùng LOS giả để so trực tiếp: stress/pathing tick tệ nhất 9,2 → **4,9 ms**, p99 5,76 → 4,28 ms.

### Trình duyệt (GPU thật, `scripts/r0-perf-browser.mjs --gpu`)

| Chỉ số | Kịch bản | R2 | R3b |
|---|---|---:|---:|
| Draw call | normal/standing | 194 | **62** |
| Draw call | stress/standing | 335 | **106** |
| Draw call | stress/crowd (224 zombie) | – | 245–287 (nhân vật chiếm phần lớn) |
| CPU/frame (ms) | normal/standing | 4,8–4,9 | 3,9–4,6 |
| CPU/frame (ms) | stress/standing | 10,5–10,9 | **5,2–7,6** |
| CPU/frame (ms) | stress/crowd | 12,3–14,3 | **7,6–8,5** |
| Object trong scene | stress/standing | ~5 130 | ~1 676 |
| FPS | tất cả | 62–75 | 75 (khóa màn hình) trong các lần chạy máy không tải |

Sau bước 2 (chỉ gộp render), CPU/frame ở map stress đứng yên là 8,9 ms; bước 3 (collider theo chunk) đưa xuống 5,2 ms. Thời gian simulation trong trình duyệt không đổi (0,64–0,70 ms).

## 4. Thay đổi hành vi

- **Che chắn** (zombie thấy/đánh, tương tác, cận chiến, che spawn) dùng đúng bộ hộp Rapier từng có, nên giống hệt. Chỉ có hai collider rất nhỏ trước đây Rapier tự tạo (đèn báo trên nóc container, tay nắm cửa) không còn chặn tia.
- **Collider Rapier** chỉ tồn tại quanh người chơi; va chạm của người chơi không đổi. Không system nào khác đọc Rapier.
- **Hình ảnh**: sàn giờ đổ bóng (bóng rơi xuống đất nằm dưới sàn nên không thấy), mái nhận bóng. Vật che mờ đi y như trước.
- **Đường dài** (≥ 2 tile, chỉ có ở map lớn) đi qua điểm chuyển tiếp nên có thể lệch vài phần trăm so với đường tối ưu. Map thường (4 tile) luôn dùng A* cũ.
- **Mốc soak mới**, do soak giờ dùng LOS thật thay cho LOS giả theo lưới:
  - shelter: 1800 s, 3 kill, **30 dmg** (vẫn đạt cổng);
  - patrol: **659 s, 30 kill** (trước là 970 s, 42 kill).
  - Nguyên nhân: LOS giả coi hàng rào, xe và thùng thấp là che tầm nhìn; LOS thật (như trong game) thì không.
  - Trước khi đổi LOS, soak sau bước nav vẫn **trùng từng số** với M2.
- Nạp map thêm thời gian dựng đồ thị nav: 6,6 ms (thường), ~205 ms (stress 4×4, chỉ dev).

## 5. File

- Mới:
  - `rendering/StaticBatches.tsx`, `staticBatchData.ts`, `ChunkColliders.tsx`, `chunkColliderData.ts`
  - `world/gridSearch.ts`, `world/navTiles.ts`
  - test: `world/lineOfSight.test.ts`, `world/navTiles.test.ts`, `rendering/staticBatchData.test.ts`, `rendering/chunkColliderData.test.ts`
- Bỏ: `rendering/PhysicsBridge.tsx`, `Walls.tsx`, `BuildingView.tsx`, `blockerData.ts`.
- Sửa:
  - `core/runtime.ts` (`isBlocked`, `setLineOfSightOverride`, làm nóng nav), `core/config.ts` (`streaming.colliderChunkRadius`, `pathfinding.warmMs`)
  - `world/staticColliders.ts` (`segmentBlocked`, `blockerId`), `world/navigation.ts` (dùng `GridSearch`/`NavTiles`, `resetDoors` chỉ chạm cửa đã đổi), `world/mapData.ts` (`chunkSize`, `mapChunkSize`), `map/resolve.ts` (`chunkSize`)
  - `rendering/occlusionRegistry.ts`, `OcclusionFader.tsx`, `indoorShading.ts`, `Scene.tsx`, `ContainerView.tsx`, `WindowView.tsx`, `DoorView.tsx`
  - test/script: đổi tên hook LOS; soak và perf dùng LOS thật; `p2-s5-browser.mjs`, `p2-smoke.mjs` gọi `runtime.isBlocked`.

## 6. Kiểm tra đã chạy

| Kiểm tra | Kết quả |
|---|---|
| `npx vitest run` | 46 file, **396 pass**, 9 skip (benchmark) |
| `tsc -b`, `oxlint`, `vite build` | Sạch |
| Soak | Đạt; sau bước nav trùng M2 từng số; sau khi đổi sang LOS thật cho ra mốc mới ở mục 4 |
| Playwright dev | S2, S3, S4, S5, vision, lighting: **PASS**; số đo ánh sáng giữ nguyên; kiểm tra tường ở chunk xa: PASS |
| Playwright production | S5, vision, lighting, S4: **PASS** |
| Ảnh chụp (GPU) | Trong nhà (mái ẩn, ánh sáng phòng), sau tường (tường và mái mờ), nhà dân có vách ngăn |

## 7. Hạn chế và việc còn lại

- **Chưa streaming nội dung**: runtime vẫn nạp mọi chunk. `ChunkLifecycle` chưa điều khiển registry, nav, WorldState hay lighting, và NavGrid vẫn giữ mảng dày cho cả map (bộ nhớ tăng theo diện tích). Hiện chỉ collider Rapier được nạp theo vị trí người chơi. Việc nối lifecycle vào các system (mục 4 dự kiến của R3b) được **dời sang giai đoạn streaming**, vì nó cần lưu trạng thái theo chunk.
- `StaticBatches` dựng lại mọi batch khi registry đổi; dựng lại theo từng chunk sẽ làm cùng streaming.
- Nhân vật vẫn 12 mesh mỗi con. Đám đông 224 zombie tốn ~250–290 draw call; instancing nhân vật chưa làm. Đèn báo container, kính/rèm và đèn trần chưa gộp.
- Một đường dài đi qua tile vừa bị huỷ đồ thị (đổi cửa) trước khi làm nóng xong có thể tốn tới ~30 ms trong lần tìm đó. Chỉ xảy ra trên map lớn, ngay sau khi đổi cửa.
- Số đo trình duyệt dao động theo tải máy (4 lần chạy: 5,2–7,6 ms ở map stress đứng yên).

## 8. Tiếp theo

Theo thứ tự đã chốt: **M3 (editor MVP)** trên schema/validator/resolver của M1–M2. Các việc còn lại của hướng hiệu năng (streaming nội dung theo chunk, nav lưu theo tile, instancing nhân vật) để vào giai đoạn streaming (R4), khi cần world lớn hơn map stress.
