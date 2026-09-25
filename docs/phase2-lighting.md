# Sprint bổ sung — Hệ thống ánh sáng trong nhà (Building Lighting)

Ngày: 25/09/2026. Yêu cầu: `building-lighting-system-spec.md` (chủ dự án). Mốc trước sprint: `5f38d8d` (VisionOverlay). Save **v7**.

## Nguyên tắc

- **WORLD LIGHTING ≠ PLAYER VISION.** Ánh sáng ngoài trời vẫn chỉ do `Lights.tsx` + `daylightAt(clock)` (không đổi). Ánh sáng trong nhà là hệ thống riêng (`BuildingLightingSystem`), là consumer của `outdoorLightLevel`. Không đọc hướng nhìn, tầm nhìn, camera (có test chặn). PlayerVisionSystem không đổi (chỉ thêm occluder cửa sổ/rèm).
- Mô hình **room graph** (không GI): cửa sổ → ánh sáng trực tiếp; cửa/lối mở → truyền giữa phòng (ngoài trời là một nguồn); đèn → ánh sáng nhân tạo. Chỉ tính lại khi có sự kiện; không raycast ánh sáng, không PointLight.

## Kiến trúc

```text
GameClock → outdoorLightLevel (lighting/buildingLighting.ts, = 0,05 + 0,95 × daylightAt)
     ↓ (bước 0,03)                 world: doors / curtains / lamps / electricity (save v7)
BuildingLightingSystem ── dirty building ← setDoorState / setCurtain / setLamp / setElectricity
     ↓ solveBuilding (số học + duyệt đồ thị)
RoomLight { direct, propagated, artificial, final, color }   (derived, không lưu)
     ↓ revision
IndoorLighting.tsx → uniform phòng → shader patch (indoorShading.ts) cho fragment trong phòng
BuildingLightingDebug.tsx (F6), HUD F3

PlayerVisionSystem → chỉ zombie hiện/ẩn (độc lập)
```

| File | Vai trò |
|---|---|
| `world/buildings.ts` | `WindowDef/PartitionDef/RoomDef/LampDef`; tường cắt cửa sổ (bệ + dầm), vách ngăn có cửa, `generateWindowPlacements`, `generateRooms`, `isInsideRoom`; `DoorPlacement.initialState` |
| `world/mapData.ts` | Cửa sổ/phòng/đèn/vách của 3 công trình; `mapRooms`, `mapWindows` (map test không khai báo thì suy ra: 1 phòng = cả nhà, không đèn); `DOORS_ADDED_V7`, `WALL_PREFIXES_ADDED_V7` |
| `world/worldState.ts` | `curtains`, `lamps`, `electricity`; cửa dùng `initialState` |
| `world/navigation.ts` | Kính chặn đường như tường; trạng thái cửa ban đầu theo `initialState` |
| `world/visionOccluders.ts` | Cửa sổ: kính không che, **rèm đóng che** tầm nhìn người chơi (đọc live) |
| `lighting/buildingLighting.ts` | `outdoorLightLevel`, `buildLightingBuildings`, `solveBuilding`, `BuildingLightingSystem` (API §47: register/unregister/markDirty/updateOutdoorLight/recalculateBuilding/getRoomLight/getLightAtPosition + getRoomAtPosition) |
| `core/runtime.ts` | `runtime.lighting`; tương tác công tắc (`light`) và rèm (`window`); `setLamp/setCurtain/setElectricity`; cập nhật cuối tick trước tầm nhìn; snapshot/load |
| `systems/save.ts`, `types/save.ts` | Schema v7, `migrateV6`, kiểm tra ID rèm/đèn |
| `rendering/indoorShading.ts`, `IndoorLighting.tsx` | Patch shader tại chỗ (không clone), uniform chung, cập nhật theo revision (dịu 0,15 s) |
| `rendering/WindowView.tsx`, `LampView.tsx` | Kính + collider + rèm; đèn trần (phát sáng khi sáng) + công tắc |
| `rendering/BuildingLightingDebug.tsx` | Debug F6 |
| `config.ts` → `buildingLighting` (`BUILDING_LIGHTING_CONFIG`) | Mọi hằng số |

## Dữ liệu map (chỉ thêm ID mới)

- **Nhà an toàn**: 1 phòng, 2 cửa sổ (bắc x = −12, đông z = −11,8; 1,2 m), đèn trần 0,8 (ấm), công tắc cạnh cửa trong nhà (−14,3; −10,25).
- **Cửa hàng**: 1 phòng, 2 tủ kính mặt nam (1,6 m), đèn huỳnh quang 0,9 (trắng lạnh), công tắc (8,6; −9,25).
- **Nhà dân**: **vách ngăn** x = 14 chia **Phòng khách** (cửa trước, 2 cửa sổ bắc/tây, đèn 0,8) và **Phòng ngủ** phía sau (không cửa sổ, đèn 0,7). **Cửa phòng ngủ** (`door-house-bedroom`, 1,4 m) là cửa thật: collider, nav, zombie đập được, lưu; **ban đầu mở**, cánh mở vào phòng khách.
- Cửa sổ: bệ 0–0,9 m và dầm 2,1–3 m là tường (`<id>-sill/-header`), kính 0,9–2,1 m là `WindowView` (collider chặn đi lại, tầm nhìn zombie và raycast tương tác như bức tường cũ → AI và soak không đổi vì cửa sổ; tầm nhìn người chơi xuyên kính).

## Công thức

- **Outdoor**: `0,05 + 0,95 × daylightAt(t)` → 12:00 = 1,0, 00:00 = 0,05, chạng vạng ở giữa.
- **Cửa sổ**: `windowLight = outdoor × daylightFactor × rèm × barricade`, `daylightFactor = 0,75 × min(1, diện tích / 1,44 m²)`, rèm đóng × 0,15, barricade = hook S6 (`windowBarricade`, mặc định 1).
- **Direct phòng**: `clamp(Σ windowLight × 0,6, 0, 1) × roomDepthFactor 0,8`.
- **Cửa**: mở 0,65, đóng 0,05, vỡ 0,65. Cửa/cửa sổ tự tìm phòng bằng cách lấy điểm hai bên (±0,6 m), bên không thuộc phòng nào là `outdoor`.
- **Lan truyền**: nguồn = ngoài trời (giá trị outdoor) + mỗi phòng có direct; `next = light × transmission × 0,8`; dừng khi < 0,03 hoặc sâu > 3; không quay lại phòng đã đi trên cùng đường (visited); ngoài trời chỉ là nguồn (không truyền ra rồi vào lại); mỗi phòng lấy **giá trị tới lớn nhất**.
- **Nhân tạo**: `min(1, Σ intensity)` của đèn đang bật và có điện (`requiresElectricity && !electricity` → 0). Hỏng điện chưa có lịch (hook: `setElectricity`, lưu trong save; nối máy phát sau).
- **Final**: `1 − (1 − direct)(1 − propagated)(1 − artificial)`, kẹp [0,03; 1]. Màu: trắng ban ngày và màu đèn theo tỉ trọng.

Ví dụ 12:00: phòng khách direct 0,72 (+0,04 qua cửa trước đóng) → **0,73**; phòng ngủ (cửa mở) 0,72 × 0,65 × 0,8 = **0,37**; đóng cửa phòng ngủ → 0,03. 00:00: phòng ngủ 0,03; bật đèn → 0,70.

## Hiển thị

- **Không có light Three.js nào mới** (không PointLight/SpotLight), không clone vật liệu. Mọi `MeshStandardMaterial` trong scene được patch **một lần tại chỗ** (`onBeforeCompile`, cùng một program key): fragment nằm trong hình chữ nhật phòng và thấp hơn trần dùng `màu × shade phòng × (0,7 + 0,3 × hướng mặt)` + phát sáng (mái chặn nắng nên trong nhà không nhận mặt trời/ambient); mọi fragment khác giữ nguyên → **ánh sáng ngoài trời không đổi**. Mặt ngoài tường nằm ngoài hình chữ nhật phòng nên vẫn theo nắng/đêm; mặt trong theo phòng.
- `shade = 0,06 + (0,85 − 0,06) × final`. 0,85 ≈ phản hồi nắng trưa ngoài trời; 0,06 để phòng tối vẫn nhìn ra hình. Nhân vật/zombie đứng trong phòng tự nhận ánh sáng phòng (theo vị trí fragment); zombie ẩn vẫn do PlayerVisionSystem.
- Uniform chỉ đổi khi `lighting.revision` đổi; dịu ~0,15 s khi bật đèn/đóng cửa. Binder duyệt scene mỗi frame chỉ để patch mesh mới (cánh cửa tạo lại khi đổi trạng thái, zombie spawn).
- Đèn trần phát sáng theo màu khi sáng; công tắc xanh khi bật. Rèm hiện ở mặt trong kính khi đóng.

## Tương tác

- **E trên công tắc** (cạnh cửa, phía trong): "Bật/Tắt Đèn …" (+ "(mất điện)"). Âm "tách".
- **E sát cửa sổ phía trong**: "Kéo rèm/Mở rèm …" (tầm 0,3 m + 1 m). Rèm: giảm ánh sáng cửa sổ (lighting) **và** che tầm nhìn qua kính (vision) — hai hệ thống, hai thuộc tính. Từ ngoài không kéo được (collider kính có ID `…:pane` khác ID cửa sổ nên chặn raycast tương tác).
  - Lần đầu tầm với rèm = nửa bề rộng cửa sổ: rèm cửa sổ bắc "cướp" prompt của tủ quần áo ở góc nhà an toàn (script S4 bắt được). Đã giảm còn 0,3 m.

## Save v7

- `SAVE_SCHEMA_VERSION = 7`. Thêm `lighting { curtains[{id, closed}], lamps[{id, on}], electricity }` và cửa `door-house-bedroom`. **Không lưu** giá trị ánh sáng (tính lại sau load).
- Validator: ID rèm/đèn khớp map; save < v7 chứa cửa phòng ngủ bị từ chối; save < v7 thiếu nó được migrate.
- **Migrate v6 → v7** thuần/idempotent: thêm cửa phòng ngủ ở trạng thái ban đầu (mở), rèm mở, đèn tắt, có điện; người chơi/zombie đứng trùng vách mới được đẩy ra cạnh vách (bỏ qua dầm trên cửa); còn lại giữ nguyên. Backup `slot-1.backup-v6`, toast Continue. Chuỗi v1…v5 đi tiếp qua v6 → v7.
- Fixture mới `phase2-light-v7.json` (Chromium: đèn phòng khách bật, rèm bắc nhà an toàn đóng); `phase2-s5-v6.json` **đóng băng** (script S5 thôi ghi). Script cũ assert schema 7.

## Debug

- **F6** (`?lighting=debug`, `buildingLighting.debug`): viền phòng tô xanh/vàng/đỏ theo final, nhãn phòng (Direct/Propagated/Artificial/Final), nhãn cửa (T, trạng thái, hai phòng), nhãn cửa sổ (exposure, rèm), đường đồ thị phòng → cửa → phòng/ngoài trời. Chỉ đường kẻ + DOM, không vật liệu sáng.
- **F3**: "Ánh sáng: ngoài trời 1.00 · tại chỗ: Phòng khách 0.73 · điện có · tính lại N lần".

## Kiểm chứng

- **325 test** (31 file). Mới `lighting/buildingLighting.test.ts` (22): outdoor level; lan truyền đúng công thức, độ sâu 3, ngưỡng; vòng lặp kết thúc; cửa ngoài/vỡ; công thức final; đồ thị map; **10 acceptance** của spec (1 ngoài trời ≈ 1 mọi hướng; 2 phòng có cửa sổ > 0,5; 3 phòng sau tối hơn; 4 đóng cửa giảm mạnh; 5 đèn ban đêm; 6 mất điện; 7 quay 360° không đổi giá trị/không tính lại/không đổi revision; 8 zombie ngoài FOV trong phòng sáng bị ẩn, quay lại thấy, phòng không đổi; 9 12:00 → 20:00 giảm dần, phòng sau chạm sàn trước, đèn giữ nguyên; 10 rèm giảm nhưng > 0 và che tầm nhìn qua kính); chỉ tính lại khi có sự kiện, bước ánh sáng ngày 0,03; E công tắc; rèm không kéo được từ ngoài; kính chặn đi lại; cửa phòng ngủ mở, có đường vào; **test chặn**: code ánh sáng không đọc vision/facing/camera, không tạo PointLight/SpotLight. `phase2-save.test.ts`: v6 → v7, đẩy ra khỏi vách, từ chối ID sai, round-trip, fixture v7; test cũ so sánh bỏ phần v7. `horde.test`: slot đập cửa kiểm tra khi cửa đóng.
- **Playwright + Chrome 153** (`scripts/p2-lighting-browser.mjs`), đo độ sáng thật của mảng sàn (chiếu bằng camera của scene), overlay tầm nhìn tắt để tách biệt:

| Cảnh | Phòng khách | Phòng ngủ | Ngoài trời |
|---|---|---|---|
| 12:00, cửa phòng ngủ mở | 92,5 | 59,5 | 67,3 |
| 12:00, cửa phòng ngủ đóng | 92,5 | 15,1 | 67,3 |
| Quay 4 hướng | chênh 0 | chênh 0 | chênh 0 (revision không đổi) |
| 00:00, đèn tắt | 16,4 | 15,1 | 26,2 |
| 00:00, đèn phòng ngủ bật | 16,4 | **84,0** | 26,2 |
| 00:00, đèn bật nhưng mất điện | 16,4 | 15,1 | 26,2 |

  E thật trên công tắc phòng khách → đèn bật; E thật sát cửa sổ bắc nhà an toàn → rèm đóng, direct 0,72 → 0,41; F6 hiện nhãn; lưu → reload → Continue giữ đèn/rèm/cửa, ghi fixture. Production: không `__runtime`, F3 "Ánh sáng … Nhà an toàn 0.73", đi bằng phím thật tới công tắc, E bật, F6 14 nhãn, save v7 có đèn bật. PASS cả hai.
- Hồi quy: `p2-vision-browser` dev + production, `p2-s5` dev + production (không ghi fixture), `p2-s4`, `p2-s3`, `p2-s2` production: PASS. Không chạy `p2-smoke.mjs` (CDP).
- **Soak** (bot không đổi): shelter **sống 30'**, 3 kill, 30 damage, 11/11 tủ, cửa không bị phá (S5: 4 kill, cửa vỡ giây 61); patrol chết ở **719 s** (S5: 853 s), 31 kill, 11/11 tủ. Khác biệt do **vách ngăn nhà dân** đổi đường đi và va chạm của bot/zombie (cửa sổ không đổi nav/AI; ánh sáng không ghi vào simulation). Chưa chỉnh số cân bằng.
- Build/lint sạch.
- Ảnh: `node_modules/.tmp/lighting-noon.png`, `lighting-night-lamp.png`, `lighting-curtain.png`, `lighting-debug.png`, `lighting-prod-debug.png`.

## Hiệu năng

- Tính toán: số học + duyệt đồ thị ≤ 3 bước; chỉ building bẩn; ban ngày chỉ khi mức ngoài trời đổi ≥ 0,03 (≈ 20 bước mỗi hoàng hôn/bình minh). Đứng yên, quay người, đi lại: 0 lần tính lại (test).
- Render: 0 light mới, 0 vật liệu clone; shader thêm một vòng ≤ 16 phòng mỗi fragment. Thêm ~18 mesh nhỏ (6 kính, 6 rèm ẩn khi mở, 4 đèn, 4 công tắc).
- Chưa cần streaming building (3 nhà); `registerBuilding/unregisterBuilding` sẵn cho chunk sau.

## Giới hạn

- Không có PointLight động gần người chơi (spec §27, Phase 1 MVP không cần); đèn không đổ bóng; phòng sáng đều (roomDepthFactor cố định, chưa theo khoảng cách tới cửa sổ/hướng cửa sổ).
- Trong phòng không có bóng đổ của mặt trời/đồ vật; mặt trong và ngoài của tường phân theo hình chữ nhật phòng (vật mỏng nằm đúng mép dùng ánh sáng phòng).
- Chưa có semi-indoor, blend ngưỡng cửa cho nhân vật, màu ánh sáng lan truyền, thời tiết, lịch mất điện/máy phát.
- `maxDynamicLights` chưa dùng (không có light động). Tối đa 16 phòng trong shader (map hiện 4 phòng).
- Mái chỉ ẩn khi người chơi trong nhà, nên ánh sáng trong nhà chỉ thấy rõ lúc ở trong (hoặc qua cửa sổ nhìn từ trên).
