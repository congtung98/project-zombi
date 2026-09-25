# Refactor kiến trúc R0–R2 — nền tảng để scale world

Ngày: 25/09/2026. Yêu cầu: `Prompt thực thi refactor kiến trúc R0–R2 cho Zombie Outbreak.md` (chủ dự án), dựa trên `game-architecture-refactor-plan.md`. Mốc trước refactor: `38a1469` (ánh sáng trong nhà, save v7). P2-S6/S7 tạm dừng. **Save vẫn v7** (không đổi schema).

## 1. Executive Summary

- **R0**: có bộ đo trong runtime (`runtime.perf`), HUD hiệu năng **F7** (`?perf=1`), map stress **`?stress=N`** (dev, lặp khu phố N×N: 4×4 = 200 m, 48 nhà, 160 zombie), benchmark Node (`perf.scenarios.test.ts`) và trình duyệt (`scripts/r0-perf-browser.mjs`), audit draw call.
- **R1** (không đổi hành vi): `SpatialHash` dùng chung. Không còn quét toàn cục cho separation, tầm nhìn, vật chắn tầm nhìn, tương tác, mục tiêu cận chiến và công trình. Bỏ `scene.traverse` ở hot path (IndoorLighting mỗi frame, OcclusionFader mỗi giây). Material/geometry tĩnh dùng chung. A* dùng lại buffer. Test và soak **giống hệt từng số** so với mốc.
- **R2**: **simulation sở hữu vị trí zombie**. Zombie di chuyển, suy nghĩ, đổi trạng thái và tìm đường mà không cần mesh hay body Rapier. Rapier chỉ còn body kinematic cho zombie ACTIVE. Có mức ACTIVE/NEAR/DORMANT, `AIScheduler` (20/4/0,5 Hz, zombie "nguy hiểm tức thời" chạy mọi tick) và `PathfindingQueue` (ngân sách, không trùng yêu cầu). Soak có baseline mới.
- Kết quả chính trên map stress (Node, 160–260 zombie):
  - Tick đứng yên: 1,29 → **0,056 ms**.
  - Bão tìm đường: tick tệ nhất 595 → **9,8 ms**.
  - Separation: 25 440 cặp/tick → 0.
  - GC: 164 → 2 lần / 20 s.
- Kết quả trên trình duyệt (GPU Intel UHD 730, map stress):
  - FPS: 53,6 → **~74** (màn hình 75 Hz).
  - CPU mỗi frame: 17,5 → **~10,5 ms**.
  - Body Rapier của zombie: 160 → ~8.
  - Object trong scene: 8 852 → ~5 130.
- Còn lại (thuộc R3): NavGrid dày toàn map (một A* dài vẫn tốn ~9 ms trên map 200 m), draw call (hình học tĩnh chưa gộp), collider Rapier toàn map, LOS của zombie vẫn qua Rapier.

## 2. R0 Baseline

### Công cụ

| Thành phần | Mô tả |
|---|---|
| `core/perf.ts` — `PerfMonitor` | Thời gian các phần trong tick (`sim`, `ai` (gồm nav + move), `movement`, `nav`, `vision`, `lighting`, `combat`, `spawn`), bộ đếm mỗi tick (AI updates, path requests, A* thực chạy, door routes, raycast vision/zombie/khác, cặp separation, test occluder), gauge (số zombie theo mức, body, hàng đợi path, draw call, tam giác, object). Cửa sổ trượt 120 tick; trung bình và tệ nhất. Không cấp phát mỗi tick. |
| `rendering/PerfProbe.tsx` | Khoảng cách frame, **CPU của frame** (từ `useFrame` đầu tiên tới hết `gl.render`), draw call/tam giác của frame đó. Đếm object bằng traverse 1 lần/giây, **chỉ khi HUD đang mở**. |
| `components/PerfHud.tsx` | F7 hoặc `?perf=1`; cập nhật 4 lần/giây. Có trên cả production. |
| `world/stressMap.ts` | `?stress=N` (chỉ dev, N = 1..8). Mọi ID có tiền tố `t<i>-<j>:`, bỏ rào biên bên trong, 10 zombie/ô. Lưu vào slot riêng `slot-stress` (không đụng save thật). |
| `core/perf.scenarios.test.ts` | `PERF_SCENARIOS=1 npx vitest run src/game/core/perf.scenarios.test.ts --reporter=verbose`. 8 kịch bản × 20 s game ở 60 tick/s: thường/stress × đứng yên / di chuyển / đám đông (+30 / +100 zombie) / "pathing" (người chơi nhảy giữa trong nhà và sân mỗi 4 s, mọi zombie được báo vị trí mỗi giây → bão A*). Đo GC bằng `PerformanceObserver('gc')`. `PERF_AI_HZ=a,n,d` để so tần số AI, `PERF_ONLY=stress` để lọc. |
| `scripts/r0-perf-browser.mjs` | Dev server + Playwright; `--gpu` dùng GPU thật (ANGLE D3D11). Chạy map thường và `?stress=4`: đứng yên / đi bằng phím thật / +30 hoặc +100 zombie. |

**Cấu hình đo**: Windows 11, Intel UHD Graphics 730 (D3D11), Chrome 15x headless `--gpu`, 1280×800, DPR 1, bóng mặc định (High), màn hình 75 Hz (FPS trần 75). Node 22.21. Số trình duyệt dao động ±10 FPS giữa các lần chạy (có ghi hai lần cho R2). Trong benchmark Node, "physics" là lưới thay Rapier như soak: R0/R1 di chuyển zombie bằng body giả **ngoài** tick, còn R2 tính di chuyển **trong** tick. Vì vậy thời gian tick của R2 gồm cả phần việc mà trước đó Rapier làm.

### Số liệu mốc chính (R0)

- Map thường 8 zombie: tick 0,03 ms. Trình duyệt 75 FPS, CPU/frame 5,8 ms, 194 draw call, 544 object.
- Map stress 160 zombie: tick 1,29 ms (AI 1,21, separation 25 440 cặp/tick, 164 lần GC / 20 s). Trình duyệt 53,6 FPS, CPU/frame **17,5 ms trong khi simulation chỉ 1 ms** → phần lớn chi phí ở phía render/khung hình. 335 draw call, 8 852 object, 160 body Rapier động.
- Bão tìm đường (stress/pathing): tick tệ nhất **595 ms**. Mỗi A* cấp phát 3 mảng cỡ toàn lưới (~1,45 MB trên lưới 402²), tối đa 20 000 lần mở rộng.

### Audit draw call (R0; R1/R2 không đổi số lượng mesh)

| Loại | Map thường | Map stress 4×4 | Ứng viên tối ưu |
|---|---:|---:|---|
| Tường/vật cản (mesh) | 54 (10 màu) | 804 (10 màu) | **Gộp geometry theo chunk + màu** (R3); đã dùng chung material ở R1 |
| Container (thân + đèn báo) | 28 | 448 | **InstancedMesh** theo loại (vị trí cố định) |
| Cửa (lá + tay nắm) | 8 | 128 | Giữ riêng (động); tay nắm có thể instancing |
| Cửa sổ (kính + rèm) | 12 | 192 | Instancing kính; rèm ít khi hiện |
| Đèn (đèn trần + công tắc) | 8 | 128 | Instancing (emissive theo instance) |
| Sàn + mái | 6 | 96 | Gộp theo chunk |
| Nhân vật | 12 mesh/nhân vật (5 material riêng) | 12 × zombie được vẽ | **InstancedMesh theo bộ phận** hoặc skinned + atlas; hiện 10 zombie ≈ 120 draw call + bóng |

Bóng: tường/thân nhân vật/đầu/chân đổ bóng → mỗi mesh tốn thêm một draw call ở shadow pass.

## 3. R1 Changes (không đổi hành vi)

| Thay đổi | Chi tiết |
|---|---|
| `core/spatialHash.ts` | Lưới đều trên mặt phẳng XZ; `insert/update/remove/queryRadius/queryAABB`; truy vấn **chính xác theo footprint** và trả về **theo thứ tự chèn**. Nhờ vậy thay một vòng lặp bằng một truy vấn cho ra cùng phần tử, cùng thứ tự, nên kết quả simulation giống hệt từng bit. |
| Zombie (`runtime.zombieIndex`, ô 4 m) | Separation (`queryRadius`), mục tiêu cận chiến/đẩy (`meleeTargets(range)`), ứng viên tầm nhìn (`getNearbyZombies`, trả mảng tái sử dụng). |
| Vật chắn tầm nhìn (`VisionOccluderSet`, ô 4 m) | `firstBlocker`/`clearFraction` chỉ test occluder trong bounding box của tia (theo thứ tự danh sách). `add/remove` giữ index đồng bộ (sẵn cho barricade/vách). |
| Interactable (ô 4 m) | `selectInteractable` nhận ứng viên trong `INTERACT_RANGE + bán kính lớn nhất`. Túi đồ rơi được chèn/xóa. |
| Công trình (ô 16 m) | `runtime.buildingAt(p, margin)` cho lang thang, điều kiện spawn và mái nhà. `RoofController` (một truy vấn/frame) thay 48 `useFrame` của `BuildingView`. |
| NavGrid | A* dùng lại `gScore/cameFrom` + mảng **stamp** (`visited/closed`), không xóa giữa các lần; heap dùng lại; hàng đợi BFS của nhãn vùng dùng lại. Cùng số học như cũ → cùng đường (có test so với lưới mới). |
| `IndoorLighting` | Bỏ `scene.traverse` mỗi frame. Bản vá shader được cài **một lần trên `MeshStandardMaterial.prototype`** (`installIndoorShading`): mọi material chuẩn có bản vá ngay khi được tạo (JSX, rig, clone). Giới hạn phòng lấy từ config `buildingLighting.maxShaderRooms` (16). Map nhiều phòng hơn thì tải **16 phòng gần người chơi nhất**, chọn lại khi đi được 4 m. |
| `OcclusionFader` | Bỏ traverse mỗi giây. Mesh che (tường cao, mái, lá cửa) tự đăng ký qua `occluderRef` (callback ref của React 19) vào `occlusionRegistry` (index AABB). Mỗi tia camera chỉ raycast các mesh dưới đoạn tia trước khi tia vượt qua occluder cao nhất. Material dùng chung được **đổi sang bản sao mờ** thay vì sửa tại chỗ. |
| `rendering/sharedResources.ts` | Material/geometry dùng chung cho tường, container, đường, sàn, mái, kính, rèm (`dispose={null}`). Stress: 804 tường dùng 10 material thay vì 804. |

Kiểm chứng R1: 340 test pass, **soak shelter/patrol trùng từng số với mốc**. Lighting trình duyệt cho độ sáng sàn giống hệt (92,5 / 15,1 / 84). Vision trình duyệt PASS.

## 4. R2 Changes

### Quyền sở hữu

```text
AIScheduler ──(ai decision, dt tích lũy)──▶ stepZombie ──▶ zombie.velocity
      │                                         │ requestPath
      │                                         ▼
      │                                  PathfindingQueue ──(ngân sách/tick)──▶ NavGrid.findPath ──▶ zombie.path
      ▼
moveZombies (mọi tick: ACTIVE/NEAR; DORMANT theo nhịp AI, chia bước)
      │  va chạm: StaticColliderRegistry (tường, container, kính, lá cửa theo trạng thái)
      │           + vòng tròn người chơi + chia đôi chồng lấn giữa zombie
      ▼
zombie.position (NGUỒN SỰ THẬT) ──▶ body kinematic (ACTIVE, còn sống) ──▶ ZombieView đặt mesh
```

| Thành phần | Chi tiết |
|---|---|
| `entities/zombie.ts` | Trường runtime (không lưu): `simLevel`, `velocity` (vận tốc AI chọn), `pathPending`. |
| `world/staticColliders.ts` | `StaticColliderRegistry` với **`registerStaticCollider` / `unregisterStaticCollider`** (điểm móc cho chunk ở R3), `querySolid` qua spatial hash. Lá cửa có hai collider (đóng/mở) với `isSolid` đọc trạng thái live; cửa vỡ thì không có. `Walls.tsx` dựng mesh + collider Rapier **từ registry** (subscribe), không còn cắm cứng vào map. |
| `systems/zombieMovement.ts` | `moveZombie`: tích phân, chia bước ≤ 0,2 m (không xuyên tường dù bước dài), đẩy vòng tròn ra khỏi hộp đặc (bỏ qua lanh tô cao hơn 1,8 m), tránh người chơi. `pushOutOfCircle` với `share` 0,5 giữa hai zombie. |
| `systems/aiScheduler.ts` | Cấp độ theo khoảng cách (ACTIVE ≤ 25 m, NEAR ≤ 60 m, dải trễ 2 m, đánh giá mỗi 0,25 s). Tần số 20 / 4 / 0,5 Hz, lệch pha theo ID. **Critical chạy mọi tick**: ACTIVE và (≤ 6 m, đang vung đòn, khựng, bị đẩy lùi, hoặc đã chết để anim ngã mượt). Tối đa 48 lượt không-critical/tick (quá hạn lâu nhất đi trước). Mỗi lượt nhận **toàn bộ thời gian từ lượt trước** (giới hạn 1 s, DORMANT 3 s) nên bộ đếm, trí nhớ, cooldown vẫn đúng. Zombie không tự giữ timer. |
| `world/pathfindingQueue.ts` | Một yêu cầu mỗi zombie (yêu cầu mới thay đích); ưu tiên ACTIVE > NEAR > DORMANT rồi FIFO. Xử lý sau lượt AI với `maxPathsPerTick` 6 + `maxPathMs` 2 (ít nhất 1/tick). `runtime.pathBudget.maxPathMs = Infinity` để chạy tất định (soak). |
| `systems/ai.ts` | `ctx.requestPath` thay `findPath`. Chỉ yêu cầu lại khi đích dời ≥ 0,75 m, path hết/hỏng, cửa đổi (nav version) hoặc kẹt, và không dày hơn 0,4 s. `NavGrid.routeKind` trả lời ngay "không có đường" (khác vùng liên thông, như `findPath` trả null cũ) hoặc "cùng ô", nên việc chọn cửa để phá vẫn đồng bộ. |
| `rendering/ZombieView.tsx` | `ZombieView` = chỉ mesh/anim/transform (đọc `zombie.position`); `ZombieBody` = capsule **kinematic** cho ACTIVE còn sống, nhận `setNextKinematicTranslation`. Gỡ view hoặc body không ảnh hưởng simulation (có test). |
| `stores/worldStore.ts`, `App.tsx`, `Scene.tsx` | `zombieIds` (được vẽ: không DORMANT) và `zombieBodyIds` (ACTIVE + sống), cập nhật theo `zombie:spawned/removed/died/levelChanged` (gộp một lần mỗi đợt). Danh sách zombie, body và túi đồ rơi là **component riêng**: đổi danh sách không re-render cả `Scene` (trước đây ~1 000 RigidBody tĩnh nhận prop mới → frame ~180 ms trên map stress, cũng xảy ra ở mỗi lần spawn trước R2). |
| `PhysicsQuery` | Giữ nguyên; AI không import Rapier. |

Tần số AI đã chọn bằng benchmark (map stress):

| active/near/dormant Hz | stress/standing tick (ms) | stress/crowd tick | stress/pathing tick avg / tệ nhất |
|---|---:|---:|---:|
| 60/60/60 (bị ngân sách 48/tick chặn) | 0,164 | 0,741 | 2,52 / 11,4 |
| 30/6/1 | 0,060 | 0,565 | 1,85 / 8,1 |
| **20/4/0,5 (mặc định)** | 0,068 | 0,558 | **1,66 / 8,1** |
| 10/2/0,5 | 0,072 | 0,574 | 1,82 / 23,9 |

20 Hz ≥ nhịp cảm nhận 5 Hz (`detectInterval` 0,2 s); zombie trong tầm đánh luôn chạy mọi tick. Hạ xuống 10 Hz không tiết kiệm thêm mà còn làm đuôi phân phối tệ hơn.

## 5. Architecture Before / After

| Vai trò | Trước | Sau R2 |
|---|---|---|
| `GameRuntime` | Điều phối + đọc vị trí zombie từ Rapier | Điều phối simulation; sở hữu index, scheduler, queue, collider tĩnh |
| Vị trí zombie | `body.translation()` → `zombie.position` (Rapier là nguồn) | `zombie.position` là nguồn; body chỉ phản chiếu |
| Body zombie | Động, 1/zombie, trong `ZombieView` | Kinematic, chỉ ACTIVE còn sống, `ZombieBody` riêng |
| Nhịp AI | 60 Hz × mọi zombie | Scheduler 20/4/0,5 Hz + critical mọi tick + ngân sách |
| A* | Đồng bộ trong AI, cấp phát mỗi lần | Hàng đợi có ngân sách, không trùng; buffer tái sử dụng |
| Truy vấn gần | Quét toàn bộ zombie/occluder/interactable/công trình | `SpatialHash` |
| Scene traversal | IndoorLighting mỗi frame, OcclusionFader mỗi giây | Không có (chỉ HUD F7 đếm object 1 lần/giây) |
| `ZombieView` | AI body + collider + mesh | Chỉ hiển thị |

## 6. Files Changed

Nhóm thay đổi theo logic (gợi ý chia commit; `runtime.ts` thuộc nhiều nhóm nên nếu tách thì dùng `git add -p`):

1. **R0 instrumentation**: `core/perf.ts`, `core/perf.scenarios.test.ts`, `rendering/PerfProbe.tsx`, `components/PerfHud.tsx`, `index.css`, `components/HUD.tsx`, `systems/input.ts` (F7), `app/App.tsx`, `app/GameCanvas.tsx`, `stores/uiStore.ts` (cờ HUD, slot stress), `world/stressMap.ts` (+ test), `world/mapData.ts` (export phần khu phố, `boundaryWallsFor`, `maxActiveZombies`), `world/visionOccluders.ts` (`testCount`), `core/runtime.ts` (bộ đếm, map stress, giới hạn zombie theo map), `scripts/r0-perf-browser.mjs`.
2. **R1 spatial index**: `core/spatialHash.ts` (+ test).
3. **R1 query migration**: `core/runtime.ts`, `world/visionOccluders.ts` (+ test), `world/navigation.ts` (+ test).
4. **R1 material/traverse cleanup**: `rendering/indoorShading.ts` (+ test), `IndoorLighting.tsx`, `OcclusionFader.tsx`, `occlusionRegistry.ts`, `sharedResources.ts`, `Walls.tsx`, `BuildingView.tsx`, `ContainerView.tsx`, `Roads.tsx`, `WindowView.tsx`, `DoorView.tsx`, `core/config.ts` (`maxShaderRooms`).
5. **R2 zombie transform ownership**: `entities/zombie.ts`, `world/staticColliders.ts`, `systems/zombieMovement.ts` (+ test), `core/runtime.ts`, `core/events.ts`, `rendering/ZombieView.tsx`, `rendering/Scene.tsx`, `rendering/Walls.tsx`, `stores/worldStore.ts`, `app/App.tsx`.
6. **R2 AI scheduler**: `systems/aiScheduler.ts` (+ test), `core/config.ts` (`simulation`).
7. **R2 pathfinding queue**: `world/pathfindingQueue.ts` (+ test), `world/navigation.ts` (`routeKind`), `systems/ai.ts`, `core/config.ts` (`pathfinding`).
8. **R2 tests/baseline**: `core/simulationOwnership.test.ts`, `core/soak.test.ts`, `core/siege.test.ts`, `core/vision.test.ts`, `core/runtime.test.ts` (bỏ body giả của zombie), `scripts/p2-*.mjs` (đặt `zombie.position` thay vì dịch body).

## 7. Performance Before / After

### Node (simulation, trung bình 2 lần chạy × 20 s, 60 tick/s)

| Metric | Kịch bản | R0 | R1 | R2 |
|---|---|---:|---:|---:|
| Tick trung bình (ms) | stress/standing (160) | 1,294 | 0,127 | 0,056 |
| Tick p99 / tệ nhất (ms) | stress/standing | 3,18 / 5,5 | 0,38 / 1,3 | 0,30 / 0,7 |
| Tick trung bình (ms) | stress/crowd (260) | 3,116 | 0,537 | 0,561* |
| Tick trung bình / p99 / tệ nhất (ms) | stress/pathing (260) | 6,37 / 85,9 / **595** | 2,50 / 64,7 / 256 | 1,68 / 6,4 / **9,8** |
| Nav trung bình / tệ nhất (ms) | stress/pathing | 2,85 / 568 | 1,66 / 255 | 1,01 / 8,8 |
| AI (ms, gồm nav + move) | stress/standing | 1,213 | 0,117 | 0,042 |
| Vision (ms) | stress/crowd | 0,107 | 0,016 | 0,015 |
| AI updates/tick | stress/standing | 160 | 160 | 3,2 |
| AI updates/tick | stress/crowd | 260 | 260 | 90,6 |
| A* chạy/tick | stress/pathing | 1,32 | 1,32 | 0,81 (≤ 6, ≤ 2 ms) |
| Cặp separation/tick | stress/standing | 25 440 | 3 | 0 |
| Cặp separation/tick | stress/crowd | 67 340 | 1 291 | 423 |
| Raycast LOS/tick | stress/crowd | 23,0 | 23,0 | 22,5 |
| GC / 20 s (số lần, tổng ms) | stress/standing | 164, 111 ms | 20, 5,8 ms | 2, 1,0 ms |
| GC / 20 s | stress/pathing | 491, 394 ms | 100, 48 ms | 76, 31 ms |
| Zombie ACTIVE (body Rapier ở trình duyệt) | stress/standing | 160 | 160 | 4 |

\* R2 tính cả di chuyển + va chạm trong tick (0,47 ms ở stress/crowd). Ở R0/R1 phần này do body giả ngoài tick (trong trình duyệt là Rapier).

Map thường (8 zombie, đứng yên): tick 0,033 / 0,039 / 0,036 ms, không đổi đáng kể. Đám đông 38 zombie: tick tệ nhất 3,6 → 2,1 → 0,9 ms.

### Trình duyệt (GPU Intel UHD 730; R2 hai lần chạy)

| Metric | Kịch bản | R0 | R1 | R2 |
|---|---|---:|---:|---:|
| FPS | stress/standing | 53,6 | 73,4 | 74,6 / 73,6 |
| Frame trung bình / tệ nhất (ms) | stress/standing | 18,7 / 36,5 | 13,6 / 23,6 | 13,4 / 21,3 – 25,6 |
| CPU/frame (ms) | stress/standing | 17,5 | 12,1 | 10,5 / 10,9 |
| Simulation (ms) | stress/standing | 0,98 | 0,40 | 0,26 |
| FPS | stress/crowd (224) | 45,3 | 57,8 | 62,2 / 71,9 |
| CPU/frame (ms) | stress/crowd | 20,6 | 15,4 | 14,3 / 12,3 |
| Body Rapier zombie | stress/crowd | 224 | 224 | 67 |
| Object trong scene | stress/standing | 8 852 | 8 852 | ~5 130 |
| Draw call | stress/standing | 335 | 335 | 335 |
| FPS / CPU (ms) | normal/standing | 75 / 5,8 | 75 / 4,7 | 75 / 4,8 – 4,9 |

Draw call không đổi (đúng phạm vi: R1/R2 không gộp hình học). Ở map stress, CPU/frame còn ~10 ms với simulation ~0,3 ms: phần còn lại là render của ~800 tường riêng lẻ, ~1 100 collider tĩnh Rapier và bóng. Đây là mục tiêu của R3.

## 8. Behavior Changes (R2)

- **Va chạm zombie**: do simulation (vòng tròn và hộp) thay cho capsule động Rapier. Zombie dừng cách người chơi 0,8 m và không chồng lên nhau. Body kinematic nên **người chơi không đẩy được zombie** (trước đây hai body động đẩy nhau theo khối lượng 80/60). Người chơi vẫn dùng Space (đẩy) để thoát. Zombie giờ va chạm chính xác với tủ/kệ (Rapier cũng làm vậy; body giả của soak cũ thì không).
- **Nhịp quyết định**: zombie ACTIVE xa hơn 6 m quyết định 20 lần/giây (hướng quay đổi theo nhịp đó, view làm mượt); NEAR 4 Hz; DORMANT 0,5 Hz (không vẽ, di chuyển theo bước 2 s, chia nhỏ để không xuyên tường). Trong 6 m hoặc khi đang đánh/khựng/ngã thì như cũ (mọi tick).
- **Đường đi bất đồng bộ**: path mới có sau lượt AI đang chạy (thường xử lý ngay trong tick, dùng ở lượt sau, ≤ 50 ms với ACTIVE). Nếu A* thất bại trong cùng vùng (vượt 20 000 lần mở rộng; chỉ xảy ra trên map lớn) thì zombie chờ và thử lại sau 0,4 s thay vì coi là "bị chặn".
- **Zombie DORMANT (> 60 m) không có mesh**. Người chơi vốn chỉ thấy zombie trong 20 m (player vision), nên không thay đổi thứ nhìn thấy.
- **Soak (baseline mới, tất định)**: shelter vẫn đạt cổng (sống 30', 4 kill, 30 dmg, không vây cửa). Patrol 719 → **655 s**, 31 → 23 kill, 35 → 26 lần bị thấy. Nguyên nhân là va chạm thật giữa zombie–người chơi, zombie–zombie và zombie–tủ (body giả cũ xuyên nhau). Patrol chỉ là số liệu, không phải cổng.
- **Chỉ ở map stress**: phòng ngoài 16 phòng gần nhất được vẽ như ngoài trời.
- Save v7 không đổi; `simLevel/velocity/pathPending`, hàng đợi và scheduler không được lưu; load bắt đầu sạch (có test).

## 9. Tests Run

- `npm test` (vitest): **359 pass / 9 skip** (skip = benchmark chỉ chạy với `PERF_SCENARIOS=1`), 39 file. File mới: `spatialHash`, `visionOccluders`, `stressMap`, `indoorShading`, `aiScheduler`, `pathfindingQueue`, `zombieMovement`, `simulationOwnership` (zombie đi mà không cần body và không lún tường quá 2 cm; gắn/gỡ body không đổi simulation; map lớn chỉ vài ACTIVE, AI < 0,4 cập nhật/zombie/tick; DORMANT vẫn lang thang; bão path trong ngân sách, một yêu cầu/zombie; save/load). Có test tương đương A* (buffer dùng lại = lưới mới) và occluder index (= quét toàn bộ, 2 000 tia).
- Soak: R1 **trùng từng số** với mốc; R2 tất định (hai lần chạy giống hệt).
- `tsc -b`, `oxlint`, `vite build`: sạch.
- Trình duyệt (dev): `p2-s2`, `p2-s3`, `p2-s4`, `p2-s5` (vây cửa với Rapier thật, lưu/tải giữa lúc vây, phá cửa, vào nhà, tấn công), `p2-vision`, `p2-lighting`: **PASS**. Production (vite preview): `p2-s5`, `p2-vision`, `p2-lighting`, `p2-s4` **PASS**; F7 hoạt động, không lỗi trang. Fixture `phase2-light-v7.json` do script lighting ghi lại đã được khôi phục (không đổi).

## 10. Regression Results

| Hạng mục | Kết quả | Kiểm tra bởi |
|---|---|---|
| New game / load save / save-load | OK | s2/s4/s5 (dev + prod), soak (snapshot mỗi phút, load lại trùng), `simulationOwnership` |
| Zombie lang thang / đuổi / tấn công | OK | siege.test, s5, soak, runtime.test (qua cửa mở rồi tấn công, không body) |
| Cận chiến | OK | melee.test, s2 (hao mòn, hỏng 20 %), s3 (zombie chết) |
| Tầm nhìn người chơi, LOS | OK | vision.test, p2-vision (trước/sau/sát lưng, cửa đóng/mở, zombie ẩn vẫn đập cửa) |
| Ánh sáng trong nhà | OK, số đo giống hệt | p2-lighting (92,5 / 15,1 / 84, bật/tắt điện) |
| Cửa, cửa sổ/rèm | OK | siege.test, s5, p2-lighting |
| Túi đồ, loot | OK | s2/s4, inventory/loot test |
| Ngày/đêm | OK | p2-vision (12:00 / 00:00) |

Ghi chú: bước "xoay người bằng phím thật trong 250 ms" của `p2-vision` phụ thuộc FPS SwiftShader. Nó fail 1 lần (hướng 2,46 thay vì ≥ 2,74), rồi PASS 3 lần liên tiếp; đây là kiểm tra theo thời gian có sẵn từ trước, không liên quan refactor.

## 11. Known Limitations

- NavGrid vẫn là một lưới dày phủ toàn map: nhãn vùng loang toàn lưới mỗi khi cửa đổi; một A* dài trên map 200 m tốn ~9 ms (ngân sách chỉ dừng *giữa* các lần tìm); `findDoorRoute` duyệt mọi cửa.
- LOS của zombie (`canReach`), tương tác và cận chiến vẫn raycast Rapier qua `PhysicsQuery`, nên cần collider của cả map đã nạp. Cần LOS phía simulation trước khi stream.
- Rapier vẫn giữ mọi collider tĩnh của map (~1 100 ở map stress). Container/cửa/cửa sổ vẫn tự dựng collider trong view (mới có tường đi qua registry).
- Scheduler và tính mức vẫn duyệt mọi zombie (O(N) rẻ, ~0,05 ms/160 zombie) vì zombie vẫn là entity runtime (chưa ảo hóa).
- Di chuyển có va chạm tốn ~4 µs/zombie ACTIVE/NEAR mỗi tick (0,47 ms với ~125 zombie).
- Draw call chưa giảm (xem audit). Nhân vật vẫn 12 mesh + 5 material riêng.
- Bản vá shader trong nhà gắn trên prototype của `MeshStandardMaterial` (toàn cục; material tự đặt `onBeforeCompile` sẽ không có bản vá).
- Dòng "occluder tests" của HUD F7 gồm cả 128 tia/frame của VisionOverlay.
- Benchmark trình duyệt dao động ±10 FPS; FPS bị trần 75 Hz của màn hình.

## 12. Deferred Work

R3 chunk ownership (index map theo chunk) · NavGrid theo chunk · portal graph giữa chunk (A* có giới hạn) · gộp hình học tĩnh theo chunk · instancing (container, đèn, kính, bộ phận nhân vật) · LOS zombie phía simulation · stream collider theo chunk (đã có `register/unregisterStaticCollider`) · streaming · IndexedDB theo chunk · ảo hóa zombie · mô phỏng quần thể · Web Worker (pathfinding) · floating origin · định dạng map dữ liệu (xem `docs/map-format-note.md`).

## 13. Recommendation for R3

1. **Chunk ownership trong bộ nhớ** (chunk 32–64 m): gán mọi đối tượng map (tường, cửa, container, phòng, vùng) và zombie vào chunk; `SpatialHash` và `StaticColliderRegistry` giữ nguyên API, thêm chỉ mục theo chunk.
2. **Gộp hình học tĩnh theo chunk × material** (tường, sàn, mái), instancing cho container/đèn/kính: mục tiêu CPU/frame map stress ~10 → ~5 ms.
3. **Nav theo chunk + portal graph**: A* cục bộ có giới hạn, đường xa đi qua đồ thị chunk; nhãn vùng tính lại chỉ ở chunk có cửa đổi.
4. **LOS phía simulation** cho zombie (dùng lại `VisionOccluderSet` với kính là vật chắn), để NEAR/DORMANT không cần Rapier và collider có thể stream.
5. **Định dạng map** (prefab + layout JSON theo chunk) trước khi làm streaming.

Sau R3 mới làm streaming/IndexedDB theo chunk và ảo hóa zombie. Có thể quay lại P2-S6/S7 ngay sau R2: barricade/vách mới chỉ cần đăng ký vào `StaticColliderRegistry`, `VisionOccluderSet` và nav (đã có API).
