# Sprint bổ sung trước P2-S6 — Tầm nhìn người chơi

Ngày: 25/09/2026. Yêu cầu: `Prompt triển khai hệ thống tầm nhìn người chơi kiểu Project Zomboid.md` (chủ dự án). Mốc trước sprint: `1f81571` (S5 đã commit). Không đổi save schema (vẫn v6), không đổi AI/combat/balance.

## Mục tiêu và nguyên tắc

- Camera isometric vẫn thấy cả bản đồ quanh nhân vật, nhưng **zombie chỉ được vẽ khi nhân vật thật sự thấy nó**: trong bán kính rất gần (mọi hướng), hoặc trong hình quạt phía trước **theo hướng nhân vật** (không theo camera), trong tầm và không bị vật chắn.
- **Không ảnh hưởng AI**: hệ thống chạy sau mọi bước simulation, chỉ ghi trạng thái hiển thị riêng (`runtime.vision`), không ghi vào `ZombieState`. Zombie ẩn vẫn lang thang, di cư, đuổi, đánh, đập cửa. Tầm nhìn người chơi và cảm nhận zombie (`systems/ai.ts`) là hai hệ thống tách biệt, không dùng chung code.

## Kiến trúc

```text
runtime.tick: input → di chuyển → tương tác → AI → combat → đòn vào cửa → action → sinh tồn → spawn → di cư
              → PlayerVisionSystem.update(dt, player)   ← mới, chỉ đọc vị trí/hướng, chỉ ghi runtime.vision
              → events
render:       ZombieView đọc runtime.vision.opacity(id) → visible/opacity vật liệu
              PlayerVisionDebug (F4, chỉ đường kẻ)
ánh sáng:     Lights.tsx ← daylightAt(clock.timeOfDay) — vision không đọc/ghi gì ở đây
```

| File | Vai trò |
|---|---|
| `src/game/core/config.ts` → `playerVision` (`PLAYER_VISION_CONFIG`) | Mọi con số của hệ thống, không hardcode ở nơi khác |
| `src/game/world/visionOccluders.ts` | `VisionOccluder`/`VisionOccluderSet`: danh sách vật chắn tầm nhìn riêng (AABB), slab test 3D, cửa sổ/rèm |
| `src/game/systems/playerVision.ts` | `PlayerVisionSystem` + hàm thuần `isInsideVisionCone`, `classifyVisibility`, `updateVisibility`, `updateVisibilityFade` |
| `src/game/core/runtime.ts` | Dựng occluder + vision, `getNearbyZombies`, gọi vision cuối tick, xóa trạng thái khi dọn xác/ván mới/load |
| `src/game/rendering/ZombieView.tsx`, `character/rig.ts` (`setCharacterOpacity`) | Áp opacity; ẩn hẳn thì không vẽ, không đổ bóng, bỏ qua tính pose |
| `src/game/rendering/PlayerVisionDebug.tsx` | Vòng tầm nhìn, vòng gần, hai cạnh hình quạt, tia LOS xanh/đỏ, nhãn trạng thái trên zombie |
| `stores/uiStore.ts`, `systems/input.ts`, `app/App.tsx` | F4 bật/tắt debug; `?vision=debug` hoặc `playerVision.debug` bật sẵn |
| `components/Settings.tsx` | Hướng dẫn trong game cập nhật |
| `stores/hudStore.ts`, `components/HUD.tsx` | F3: số zombie thấy/ứng viên/raycast của lượt gần nhất, `nhìn=<lý do>` từng zombie |

## Thuật toán (mỗi lượt, 20 lượt/s)

1. **Ứng viên**: `getNearbyZombies(vị trí, visionDistance)` (lọc hình vuông quanh người chơi; hiện là vòng lặp, sau này thay bằng spatial hash mà không sửa hệ thống). Zombie không được trả về → `OUT_OF_RANGE`.
2. **Khoảng cách** > 20 m → `OUT_OF_RANGE`, không raycast.
3. **Gần** ≤ 2,5 m → bỏ qua hình quạt (sau lưng vẫn thấy) nhưng **vẫn cần LOS** → `NEAR_DETECTION` hoặc `BLOCKED_BY_OCCLUDER`.
4. **Hình quạt** 110° quanh `player.facing` (forward = (sin f, cos f), đúng quy ước runtime), so tích vô hướng với cos(55°), không `acos`. Ngoài → `OUTSIDE_FOV`, không raycast.
5. **LOS**: tia từ mắt (y = 1,6 m) tới giữa thân zombie (y = 1,2 m) chỉ qua `visionOccluders` → `VISIBLE` hoặc `BLOCKED_BY_OCCLUDER`.
6. **Ngân sách**: tối đa 48 raycast/lượt; nhiều ứng viên hơn thì làm mới kết quả cũ nhất trước (chưa từng raycast đi đầu), số còn lại giữ kết quả lượt trước.
7. **Làm mượt** (mỗi tick, theo dt thật): thấy → hiện ngay; mất dấu → vẫn hiện thêm **0,15 s** (chống nhấp nháy, không phải trí nhớ AI) rồi mờ dần; opacity đi 0 ↔ 1 trong **0,2 s**. Zombie mới spawn bắt đầu opacity 0 nên không "bật" ra.

Nhịp lượt giữ phần dư thời gian nên đúng 20 lượt/s ở 30/60/144 Hz; lượt đầu chạy ngay tick đầu. Quay 180° (hướng nhân vật lọc 14/s) → zombie sau lưng hiện trong ≤ 50 ms + fade.

### Vật chắn (`buildVisionOccluders`)

- **Chặn**: mọi khối tường có **đỉnh ≥ 1,5 m** (tường nhà 3 m, lanh tô trên cửa, biên map 2 m, cột 2 m), tủ/kệ cao (kệ 1,6 m, tủ lạnh, tủ quần áo), **lá cửa khi đóng**.
- **Không chặn**: hàng rào 1 m, thùng, xe hỏng 1,4 m, giường, quầy, tủ thấp, túi đồ rơi, cỏ/lưới/đường. Tia ở 1,2–1,6 m nên đi dưới lanh tô: nhìn qua khung cửa mở được.
- **Cửa**: occluder cửa đọc `world.doors` **lúc truy vấn** (`isBlocking`) → mở/đóng/vỡ không dựng lại gì, không cần đồng bộ sự kiện. Cửa mở hoặc vỡ không chặn.
- **Cửa sổ** (chưa có trong game): `createWindowOccluder(id, min, max, isCurtainClosed)` — kính không chặn, rèm đóng chặn. `VisionOccluderSet.add/remove` cho vật chắn động sau này (barricade S6, vách S7) mà không sửa `PlayerVisionSystem`.
- Không dùng Rapier: vật cản vật lý khác vật cản tầm nhìn (hàng rào chặn đi nhưng không che), và simulation phải test được không cần WASM. Raycast Rapier của AI/spawn không đổi.

### Ánh sáng thế giới không thuộc tầm nhìn

Tầm nhìn người chơi **không phải nguồn sáng** và không làm tối khung cảnh. Ánh sáng chỉ do `rendering/Lights.tsx` quyết định (ambient/hemisphere/mặt trời/nền theo `daylightAt(clock.timeOfDay)`); vision chỉ đổi zombie nào được vẽ. Lớp tối mặt đất (VisionMask) của bản đầu đã bị gỡ sau playtest (xem mục cuối).

## Config (`GAME_CONFIG.playerVision`)

| Khóa | Giá trị | Ghi chú |
|---|---|---|
| `nearDetectionRadius` | 2,5 m | Mọi hướng |
| `nearDetectionThroughWalls` | false | true = cảm nhận xuyên tường kiểu PZ |
| `visionDistance` | 20 m | |
| `fieldOfView` | 110° | Toàn góc |
| `playerEyeHeight` / `zombieTargetHeight` | 1,6 / 1,2 m | Tuyệt đối (mặt đất y = 0) |
| `visibilityFadeDuration` | 0,2 s | |
| `visibilityGracePeriod` | 0,15 s | |
| `visionUpdateInterval` | 50 ms | ≈ 20 lượt/s |
| `maxRaycastsPerUpdate` | 48 | Ngân sách xoay vòng |
| `occluderMinHeight` | 1,5 m | Đỉnh khối |
| `debug` | false | DEBUG_PLAYER_VISION |

## Quyết định lệch khỏi yêu cầu

- **Bán kính gần vẫn cần LOS** (yêu cầu mẫu trả `true` ngay). Nếu không, zombie đứng sát bên kia cửa đóng/tường sẽ hiện ra, trái với "door đóng → hidden" và "sau wall → hidden" cũng trong yêu cầu. Muốn cảm nhận xuyên tường: `nearDetectionThroughWalls: true`.
- **Hướng nhìn lấy từ `player.facing`** (góc yaw của simulation) chứ không từ quaternion mesh: cùng một nguồn với combat, không phụ thuộc render.
- **Fade chạy trong tick** (theo dt simulation), renderer chỉ đọc: pause thì fade dừng theo, không có React state mỗi frame.
- Xác zombie theo cùng luật (xác sau lưng không vẽ).

## Kiểm chứng

- **289 test** (29 file; trước 266). Mới: `systems/playerVision.test.ts` (19: hình quạt theo hướng nhân vật; thứ tự khoảng cách → gần → quạt → LOS; tia từ mắt; không raycast ngoài tầm/ngoài quạt; 18–21 lượt/s; quay 180° hiện trong một lượt và fade; grace rồi fade out; nhấp nháy ngắn hơn grace không ẩn; ngân sách 48 và mọi zombie đều được kiểm; debug ray chỉ khi bật; occluder map khu phố đúng danh sách chặn/không chặn; trong nhà: cửa đóng ẩn, mở/vỡ hiện, tường ẩn, sát cửa đóng vẫn ẩn; hàng rào thấp không chặn; cửa sổ/rèm; hiệu năng; **2 test chặn tái phạm**: module vision không import three/render/ánh sáng, `Lights.tsx` chỉ đọc đồng hồ và không nhắc tới vision, chỉ `ZombieView`/`PlayerVisionDebug` đọc `runtime.vision`), `core/vision.test.ts` (4: zombie đuổi từ sau lưng bị ẩn > 1 s trong khi CHASE, hiện khi vào bán kính gần; mở/đóng cửa đổi tầm nhìn, cùng instance occluder; **simulation giống hệt khi tắt vision** — 40 s map khu phố, cùng seed, so vị trí/trạng thái mọi zombie; dọn xác/ván mới/load xóa trạng thái).
- **Hiệu năng** (Node, máy dev): 500 zombie quanh người chơi trên map khu phố, 35 occluder: **0,095 ms/lượt** (48 raycast). FPS GPU thật chưa đo.
- **Soak** không đổi so với S5 (vision không ghi vào simulation): shelter sống 30', 4 kill, 30 damage, cửa nhà an toàn vỡ ở giây 61, 12 lần di cư; patrol chết ở 853 s, 30 kill.
- `npm run build`, `npm run lint` sạch.
- **Playwright + Chrome 153** (`scripts/p2-vision-browser.mjs`, không ghi fixture):
  - Dev: người chơi ngoài trời quay +Z: zombie trước 8 m `VISIBLE` (vẽ, opacity 1), sau 8 m `OUTSIDE_FOV` (không vẽ), sát lưng 1,8 m `NEAR_DETECTION` (vẽ); **phím thật W+D** quay về −Z → zombie sau hiện, zombie trước ẩn; trong nhà an toàn đi tới cửa bằng phím: cửa đóng → zombie ngoài `BLOCKED_BY_OCCLUDER` không vẽ, **E mở** → `VISIBLE`, zombie thấy người chơi và CHASE, **E đóng** → ẩn nhưng vẫn `ATTACK_STRUCTURE` (HP cửa 110); F4 hiện nhãn. Bước ánh sáng: xem mục cuối. PASS.
  - Production: không `__runtime`; F3 có dòng "Tầm nhìn" và `nhìn=` từng zombie; F4 bật 8 nhãn, tắt sạch; không lỗi console. PASS.
  - Hồi quy production `p2-s5-browser.mjs`, `p2-s4-browser.mjs`: PASS. Không chạy lại `p2-s5` dev (nó ghi đè fixture v6; schema không đổi).
  - Ảnh (không track): `node_modules/.tmp/vision-front-debug.png`, `vision-turned.png`, `vision-door-open.png`, `vision-prod-debug.png`.

## Giới hạn

- Không có hiệu ứng thị giác nào cho biết vùng ngoài tầm nhìn (chủ ý sau playtest). Nếu sau này thêm, chỉ được là lớp phủ rất nhẹ (≤ 0,1–0,15) và không chạm vào đèn/vật liệu môi trường.
- Một tia LOS tới giữa thân: zombie ló nửa người ở mép tường có thể chưa hiện; grace 0,15 s làm mượt.
- Tầm nhìn không giảm ban đêm (chưa yêu cầu); có thể nối `visionDistance` với đồng hồ sau.
- Tiếng động (zombie gào, đập cửa) vẫn nghe mọi nơi như trước: người chơi biết có zombie dù không thấy — chủ ý.
- Không có spatial hash (8–12 zombie hiện tại); `getNearbyZombies` là điểm thay thế. Occluder lọc bằng hộp bao của tia, duyệt tuyến tính (35 khối).
- Debug nhãn dùng DOM (`Html` của drei), chỉ để debug.

## Feedback playtest 25/09/2026: tầm nhìn không được làm tối thế giới

Yêu cầu: `Prompt sửa hệ thống Player Vision không làm tối world lighting.md`. Ban ngày ngoài trời, vùng ngoài hình quạt tối gần như ban đêm và có vòng sáng 2,5 m quanh người, khiến ánh sáng thế giới phụ thuộc hướng nhìn.

**Nguyên nhân gốc**: không phải đèn. Kiểm tra toàn bộ: `Lights.tsx` chỉ đọc `daylightAt(clock.timeOfDay)`; không có exposure, fog, `scene.environment`, SpotLight/PointLight, và không vật liệu môi trường nào đổi theo vision (`OcclusionFader` làm mờ tường theo camera, không liên quan hướng nhìn). Thủ phạm duy nhất là `VisionMask`: mặt phẳng đen alpha 0,42–0,72 phủ cả map, đục lỗ bằng stencil theo hình quạt + vòng gần → ngoài quạt tối như đêm, vòng gần giống đèn pin.

**Sửa (tối thiểu, đúng mục 26 của yêu cầu: bỏ hẳn lớp tối)**:
- Xóa `rendering/VisionMask.tsx`, `systems/visionMask.ts`, cấu hình `playerVision.mask`, cài đặt "Vùng tối ngoài tầm nhìn" (giá trị cũ trong localStorage bị bỏ qua khi đọc) và `stencil: true` của Canvas.
- `Lights.tsx`/`daylight.ts` không đổi (vốn đúng). Lý do `BLOCKED` đổi tên `BLOCKED_BY_OCCLUDER` theo yêu cầu.
- Hướng dẫn trong game: "khung cảnh vẫn sáng theo giờ trong ngày".

**Kiểm chứng** (`scripts/p2-vision-browser.mjs` bước 0, Chrome thật): cảnh không còn mesh shader/stencil nào; mọi zombie đưa ra ngoài tầm, người chơi quay tại chỗ 0°/90°/180°/−90°, đo cường độ đèn và độ sáng trung bình 4 góc màn hình (bỏ HUD và nhân vật ở giữa) trên ảnh chụp:
- **12:00 ngoài trời**: Ambient 0,55 / Mặt trời 1,6 / Hemisphere 0,5 ở cả 4 hướng; độ sáng trung bình 60,3, chênh lệch mỗi góc khi quay **0**.
- **00:00 ngoài trời**: 0,3 / 0,3 / 0,22; độ sáng 10,7, chênh **0** → tối là do đồng hồ, không phải do hướng nhìn.
- **Trong nhà an toàn 12:00** (mái ẩn): độ sáng 48,3, chênh **0** khi quay.
- Phần còn lại không đổi: trước/sau/sát lưng, quay bằng phím thật, cửa đóng/mở, zombie ẩn vẫn đập cửa. Production (F3/F4) và hồi quy `p2-s5` production PASS. 289 test, build/lint sạch, soak giống hệt (shelter 30'/4 kill/30 dmg/cửa vỡ giây 61; patrol 853 s/30 kill).
- Ảnh: `node_modules/.tmp/vision-light-noon-north.png`, `-noon-south`, `-midnight-*`, `-indoor-*`.

**Chưa có**: hệ thống ánh sáng trong nhà riêng (phòng không đèn tối hơn); hiện trong nhà chỉ khác ngoài trời do sàn/tường, như trước sprint.

## Playtest lần 2 (25/09/2026): VisionOverlay nhẹ, không phải ánh sáng

Yêu cầu: `Prompt triển khai VisionOverlay kiểu Project Zomboid không phá world lighting.md`. Mốc: `1fc531d` (đã bỏ lớp tối). Kiểm tra trước khi code: không còn overlay/fog/postprocessing/stencil nào; ánh sáng chỉ ở `Lights.tsx` theo `daylightAt`.

**Kiến trúc**

```text
Lights.tsx ← daylightAt(clock)                         (ánh sáng — không đổi)
PlayerVisionSystem → runtime.vision → ZombieView        (zombie hiện/ẩn — không đổi)
VisionOverlay.tsx  ← player vị trí/hướng (làm mượt), playerVision (FOV/gần/tầm),
                     visionOccluders (mask sector LOS), daylightAt (chỉ đọc)
                   → 1 quad toàn màn hình, blend đen alpha ≤ 0,15, vẽ cuối
```

- `config.visionOverlay` (`VISION_OVERLAY_CONFIG`): inside 0, outside 0,08, blocked 0,12, **max 0,15**, edgeSoftness 0,2, nearDistanceShare 0,35, directionSmoothing 0,06 s, ban ngày 1 / ban đêm 0,5, losAware + 128 tia, debug. FOV/bán kính gần/tầm lấy từ `playerVision`, không lặp số.
- `systems/visionOverlay.ts`: công thức alpha (bản TS của shader, dùng cho test/F3), độ mạnh theo ánh sáng ngày, mask sector LOS.
- `rendering/VisionOverlay.tsx`: `OverlayPass` (1 `ShaderMaterial` + texture 128×1), cập nhật **chỉ uniform** mỗi frame; không duyệt scene, không clone/sửa vật liệu, không đèn nào.
- Cài đặt "Hiệu ứng tầm nhìn" (mặc định bật). F3: dòng "Overlay" (hướng, ánh sáng ngày đọc được, độ mạnh, alpha 10 m trước/sau, ms CPU). F4: mask tô hồng + vạch hướng overlay.

**Shader (mỗi pixel)**: chiếu pixel xuống mặt đất y = 0 bằng ma trận nghịch đảo camera (world-space nên zoom/độ phân giải không đổi tầm), rồi:
- `edge = smoothstep(cos55° − 0,2, cos55° + 0,2, dot(hướng, forward))` (cạnh quạt mềm ~39°–68°), cuối tầm mềm 17–23 m;
- `alpha = mix(outside, inside, edge·inRange)`; trong quạt mà sau vật chắn (tra mask sector, chuyển tiếp 1,5 m) → blocked;
- bán kính gần: alpha 0 (mềm từ 2 → 3,25 m), không phát sáng gì; theo khoảng cách chỉ tăng nhẹ 35 % → 100 % (không phải fog: ≈ 0,03 ở 5 m, 0,06 ở 15 m, 0,08 từ ~25 m trở đi, không tăng thêm);
- `alpha = min(alpha · độ mạnh, 0,15)`; màu = đen × alpha → độ sáng cảm nhận = 1 − alpha ≥ 85 %.
- Không raycast theo pixel: 128 tia/frame trên CPU vào `visionOccluders` (0,1 ms), shader nội suy.
- Hướng: `player.facing` (không phải camera), làm mượt hằng số thời gian 60 ms (cộng lọc hướng sẵn có của nhân vật) → quay xoay mượt, không cắt cứng.
- Về "darkFactor" trong yêu cầu: `mix(scene, scene·0,8, 0,08)` chỉ tối 1,6 %, không đạt mục tiêu "ngoài FOV ≈ 85–95 %" cũng trong yêu cầu, nên dùng đen × alpha (tương đương darkFactor 0) với alpha đã kẹp 0,15.

**Nghiệm thu** (`scripts/p2-vision-browser.mjs` bước 0, Chrome thật; mỗi hướng chụp khi tắt rồi bật overlay, tỉ lệ độ sáng 4 góc màn hình):

| Trường hợp | Đèn (4 hướng) | Không overlay: chênh khi quay | Có overlay: tỉ lệ sáng |
|---|---|---|---|
| 12:00 ngoài trời | 0,55 / 1,6 / 0,5, không đổi | 0 | 0,94 – 0,98 |
| 00:00 ngoài trời | 0,3 / 0,3 / 0,22, không đổi | 0 | 0,98 – 1,00 |
| Trong nhà 12:00 | không đổi | 0 | 0,92 – 0,94 |
| Quay nhanh 180° | | | khung tối nhất 0,957 so với trước khi quay |
| Zoom 14 / 60 | | | 0,92 – 0,93 / 0,97 – 1,00 |

- Chỉ có 1 mesh shader, 0 stencil. Zombie phía sau vẫn ẩn bởi PlayerVisionSystem (không phụ thuộc overlay). Production: dòng F3 Overlay (alpha sau lưng > 0 và ≤ 0,15, 0,10 ms CPU/frame). Hồi quy production `p2-s5`, `p2-s4` PASS.
- **298 test** (30 file): `systems/visionOverlay.test.ts` (8: kẹp ≤ 0,15 ngày/đêm → ≥ 85 % sáng; trong tầm và bán kính gần = 0; sau lưng tăng nhẹ theo khoảng cách, không về đen; cạnh mềm (bước 0,5° chênh < 0,002); theo hướng nhân vật; ban đêm một nửa; mask sector nội suy/quấn vòng; trong nhà cửa đóng → blocked, mở → 0), thêm test chặn: file overlay không ghi đèn/exposure/fog/scene/vật liệu, chỉ đọc `daylightAt`, đúng 1 mesh.
- Soak không đổi (shelter 30'/4 kill/30 dmg; patrol 853 s/30 kill). Build/lint sạch.
- Ảnh: `node_modules/.tmp/vision-overlay-noon-north.png`, `-noon-south`, `-midnight-*`, `-indoor-*`, `vision-overlay-debug.png`.

**Giới hạn**
- Pixel được chiếu xuống mặt đất, nên tường/mái lấy shade của điểm đất phía sau chúng: mái nhà trong quạt có thể nhận shade "bị che" (≤ 12 %) theo đường chéo không trùng cạnh hình học. Rất nhẹ ở chế độ thường; chỉ rõ khi bật debug.
- Mask LOS 128 lát (2,8°/lát): góc tường xa hơi tròn.
- Chưa có ánh sáng trong nhà riêng/đèn; overlay không mô phỏng phòng tối (đúng yêu cầu).
