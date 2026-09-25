# Map content M1–M2 (R3a): báo cáo

Ngày 25/09/2026. Thực hiện M1 (audit + schema) và M2 (runtime chạy bằng JSON) của `docs/Map_Editor_Implementation_Plan.md`, theo thứ tự đã chốt với chủ dự án: **R3a = M1 + M2**, sau đó R3b (hiệu năng theo chunk), rồi mới đến editor GUI (M3+). Định dạng chi tiết nằm ở `docs/map-content-format.md`.

## 1. Tóm tắt

- Khu phố không còn là hằng số TypeScript. Nó nằm trong `content/maps/neighborhood-50/`: 3 prefab (`building/safehouse|store|house`), 4 chunk 32 m, manifest `world.json` và bảng ID cũ → ID ổn định.
- `NEIGHBORHOOD_MAP` giờ đi qua đường nạp mới: đọc JSON → validator → `ChunkLifecycle` → resolver → `MapData`. Mọi system (collider, nav, tầm nhìn, ánh sáng, loot, cửa, AI) vẫn đọc `MapData` như trước, nên không system nào phải sửa logic.
- **Tương đương đã được chứng minh:**
  - Test so từng tường, cửa, cửa sổ, phòng, đèn, container, đường, zone và spawn với map cũ đóng băng (sai số 1e-6).
  - Khi xếp lại thứ tự danh sách như map cũ và dùng khóa loot cũ, soak cho **đúng từng số** mốc R2: shelter 1800 s, 4 kill, 30 dmg; patrol 655 s, 23 kill.
- Save **v8**:
  - Dùng ID ổn định và ghi `contentVersion`.
  - Save v1–v7 migrate qua map cũ đóng băng rồi đổi tên ID; bản gốc được giữ ở `backup-v7`.
  - Đã chạy bằng test với các fixture thật, và chạy bằng Continue thật trên trình duyệt cho v7/v3/v2/v1.
- Map stress `?stress=N` giờ được sinh bằng generator ghép ô (`tileWorld`) và nạp qua cùng pipeline; bố cục trùng khớp bản cũ.
- Không commit (theo quy ước dự án).

## 2. M1: khảo sát và hợp đồng dữ liệu

### Luồng dữ liệu trước M2

`mapData.ts` (BuildingDef viết tay + `generateBuildingWalls/Doors/Windows/Rooms` chạy lúc nạp module) → `NEIGHBORHOOD_MAP: MapData`. Các consumer của `MapData`:

- `runtime.ts`: chỉ mục công trình, `registerMapColliders`, `buildInteractables`, spawn, zone.
- Nav, `staticColliders`, `visionOccluders`.
- `buildingLighting`, `worldState` (cửa, container, rèm, đèn và loot seed theo ID).
- `save.ts`: kiểm tra ID khớp map, migrate v2→v7.
- Scene: Walls, BuildingView, DoorView, ContainerView, WindowView, LampView, Roads, Ground.
- `stressMap.ts`, `doorLab.ts`.

### Nội dung viết tay đã chuyển

| Nội dung | Số lượng | Chuyển thành |
|---|---:|---|
| Nhà (BuildingDef) | 3 | 3 prefab + 3 instance |
| Đoạn tường sinh ra (kể cả bệ/dầm cửa sổ, vách ngăn) | 39 | object `wall` trong prefab |
| Đồ vật trong nhà (quầy, giường) | 2 | object `prop` trong prefab |
| Vật cản ngoài trời (hàng rào, xe, thùng, trụ) | 9 | object `prop` rời trong chunk |
| Tường biên | 4 | sinh từ `world.boundary` |
| Cửa (3 cửa ngoài + cửa phòng ngủ) | 4 | object `door` |
| Cửa sổ | 6 | object `window` |
| Phòng và đèn | 4 + 4 | `rooms[]` + `lamp` |
| Container | 12 + 2 ngoài trời | object `container` trong prefab / rời |
| Đường | 2 | `roads` |
| Zone zombie | 8 | `zones` (hình tròn) |
| Điểm spawn | 1 người chơi + 8 zombie | `spawns` |
| Hằng migrate `*_ADDED_Vn` | 4 | giữ nguyên, chuyển sang `world/legacyContent.ts` (chỉ dùng cho save cũ) |

### Quyết định M1

1. **Chunk 32 m, gốc tọa độ ở tâm map.** Khu phố nằm trên 4 chunk, mỗi nhà gọn trong một chunk; đường, zone "Ngã tư" và tường biên vượt biên chunk, nên cơ chế tham chiếu được dùng thật. Chunk 64 m sẽ gom cả khu phố vào một chunk và không kiểm tra được gì.
2. **Prefab lưu hình học tường minh** (từng đoạn tường, bệ, dầm), không lưu tham số "cạnh + offset". Như vậy editor ở M5 chỉnh được mọi thứ, và cách dựng runtime chỉ còn một đường. Generator tham số (`buildings.ts`) vẫn còn cho door lab, test map và làm nguồn khi import.
3. **ID:** `<chunk>/<instance>/<localId>`, trong đó chunk là *chunk định danh* ghi cứng trong ID (cách 1 của kế hoạch), không phải con trỏ tới chunk sở hữu. Chuyển record sang chunk khác không làm đổi ID.
4. Pivot của prefab nhà = tâm footprint; instance đặt tại tâm cũ với q = 0.
5. Lượng tử hóa tọa độ thế giới 1 µm; quay bằng hoán vị chính xác.
6. Save v1–v7 dùng map cũ **đóng băng** thay vì suy ngược từ content mới, để các bước migrate cũ chạy y hệt.

### Checklist M1

- [x] Bản đồ module và danh sách nội dung viết tay (mục trên).
- [x] Schema và validator (`src/map/schema.ts`, `validate.ts`), tài liệu quy ước (`docs/map-content-format.md`).
- [x] Đủ 4 góc xoay đúng cho hộp render/collider, cửa (tâm, bản lề, góc cánh đóng/mở), cửa sổ, phòng, đèn/công tắc, với pivot lệch gốc. Test đối chiếu với `Vector3.applyAxisAngle` và `Euler` của Three.js (`transform.test.ts`).
- [x] Tọa độ âm và điểm trên biên chunk có đúng một chunk sở hữu (nửa mở), có test.
- [x] Đã chốt cách xử lý ID khi đổi chunk sở hữu (quyết định 3).

## 3. M2: runtime nạp từ JSON

- `src/map/content.ts`: đọc JSON đi kèm bundle, `loadWorld()` gồm validate, lifecycle, `toMapData`. Có lỗi thì ném `MapContentError`, không lùi về map mặc định.
- `src/map/loader.ts`, `ChunkLifecycle`: nạp/gỡ theo chunk với đếm tham chiếu. Record vượt biên chỉ tồn tại một bản; nạp lặp không có tác dụng; `MapData` không phụ thuộc thứ tự nạp. M2 nạp tất cả chunk một lần.
- `src/game/world/mapData.ts`: chỉ còn kiểu dữ liệu và `NEIGHBORHOOD_MAP = loadBundledWorld('neighborhood-50').map`. Mọi BuildingDef viết tay đã bị xóa, nên **không còn hai nguồn cùng tạo một công trình hay container**.
- `MapData.buildings` đổi kiểu thành `BuildingInfo` (footprint + màu sắc); `BuildingDef` mở rộng từ nó cho map tham số.
- Save v8 (`save.ts`, `types/save.ts`, `runtime.createSnapshot`); `uiStore` có toast cho v7 và gợi ý tủ quần áo dùng ID mới.
- `stressMap.ts` = `tileWorld(neighbourhood, N)`, sau đó chạy `loadWorld`. Trong production, `initialMap()` rút gọn thành khu phố nên generator không vào bundle; `GAME_CONFIG.world.size` bị bỏ, kích thước lấy từ `world.json`.

### Checklist M2

- [x] Khu phố nạp từ JSON, giữ bố trí và gameplay (có test tương đương; soak trùng từng số khi cùng thứ tự và khóa loot).
- [x] Không còn hai nguồn cùng tạo một công trình hay container.
- [x] Cửa, collision, nav/AI, LOS, ngày/đêm, loot, combat, respawn không có regression quan sát được: 380 test, S2–S5, vision, lighting trên trình duyệt dev và production.
- [x] Fixture save trước migration nạp được; inventory, đồ đã loot, trạng thái cửa, cuộc vây cửa, rèm và đèn được giữ (`phase2-save.test.ts`: `toLegacy(save v8)` bằng đúng fixture cộng phần mỗi bước thêm vào).
- [x] Save mới nạp lại đúng; migrate không chạy lặp (v8 → `migrated: false`); có đường phục hồi (bản gốc không bị sửa, `backup-v7`, ID lạ → từ chối).
- [x] Nạp/gỡ không nhân đôi entity và không reset loot (lifecycle chỉ giữ mô tả; test đếm tham chiếu, nạp lặp, thứ tự nạp). Streaming thật chưa có.

## 4. Điều chỉnh so với kế hoạch (và lý do)

| Kế hoạch | Thực tế | Lý do |
|---|---|---|
| `src/map/schema|shared|runtime|editor/` | `src/map/{schema,transform,validate,resolve,loader,content,format}.ts` + `src/map/tools/` | Chưa có editor; tách thư mục con khi M3 bắt đầu |
| `externalInstanceRefs` | `externalRefs` cho mọi loại record | Đường, zone, object rời cũng vượt biên |
| `spawnPoints` trong world.json | `playerSpawn` = ID của một spawn trong chunk | Một nguồn cho vị trí spawn |
| Zone `rectangle` | Chỉ `circle` | Consumer duy nhất (horde) dùng tâm + bán kính |
| `terrain[]`, `assetId` | Chưa có | Mặt đất là một mặt phẳng; chưa có model để ánh xạ |
| `playArea` là world bounds tùy ý | Hình vuông tâm gốc | NavGrid và kiểm tra túi rơi giả định như vậy (R3b sửa) |
| Không nói tới loot seed | New Game seed loot theo **ID ổn định** | Loot = hash(seed, ID) như trước; save cũ giữ đồ đã lưu |

## 5. Hành vi thay đổi

- **Loot của New Game** với cùng world seed khác so với trước M2, vì khóa seed là ID mới. Save cũ không bị ảnh hưởng (đồ đã sinh nằm trong save). Bảng loot không đổi: `weapons.test` vẫn cho ra đúng loot Phase 1 khi dùng khóa cũ.
- **Thứ tự spawn zombie, zone và container** theo thứ tự chunk (zombie-1 xuất hiện ở điểm khác trước). Không có vị trí nào bị thêm hay bớt.
- **Mốc soak mới:** shelter 1800 s, 3 kill, 10 dmg; patrol 970 s, 42 kill. Mốc R2 là 1800 s/4/30 và 655 s/23. Toàn bộ chênh lệch đến từ hai điểm trên; đã kiểm chứng bằng cách đảo lại thứ tự và khóa loot thì ra đúng số R2.
- **ID thấy được khi debug** (F3, `__runtime`): `c-1_-1/safehouse/door`, `c0_0/zones/south`…
- Save stress (`slot-stress`, chỉ dev) tạo trước M2 không migrate được vì ID dạng `t0-0:` không có bảng ánh xạ; save đó sẽ bị từ chối là hỏng và bản gốc được giữ.

## 6. Kiểm tra đã chạy

| Lệnh | Kết quả |
|---|---|
| `npx vitest run` | 43 file, 380 pass, 9 skip (benchmark). Thêm 21 test: `src/map/*.test.ts` và các test v8 trong `phase2-save.test.ts` |
| `npx tsc -b`, `npx oxlint`, `npx vite build` | Sạch |
| `npm run map:check` | `neighborhood-50: OK — 4 chunks, 3 prefabs, 33 records`, 0 cảnh báo |
| Soak (`soak.test.ts`) | Đạt cổng; số mới ở mục 5; bản đối chứng cùng thứ tự/khóa loot cũ trùng R2 từng số |
| Map stress 4×4 so với bản cũ (so theo tập hợp) | Tường, cửa, cửa sổ, phòng, đèn, container, đường, zone, spawn trùng khớp; 64 chunk |
| Playwright dev (SwiftShader) | S2 (có migrate v7/v3/v2/v1 → v8 qua Continue, backup từng bản), S3, S4 (v4 → v8), S5 (vây cửa, save/Continue giữa cuộc vây), vision, lighting: tất cả PASS; số đo ánh sáng giữ nguyên (84 / 15,1 / 26,2) |
| Playwright production (`vite preview`) | S5, vision, lighting, S4 PASS |
| Benchmark Node (`PERF_SCENARIOS=1`) | Nằm trong nhiễu so với R2 (stress/standing 0,067 so với 0,054 ms; stress/pathing tệ nhất 9,2 so với 10,0 ms) |
| Kiểm tra bundle | Có content JSON và map cũ đóng băng (cần cho migrate); **không** có `tileWorld`/importer |

Fixture save không bị ghi đè: script lighting không ghi `phase2-light-v7.json` nữa, vì fixture đó nay đã đóng băng.

## 7. Hạn chế còn lại

- Chưa có streaming: runtime nạp mọi chunk khi khởi động. NavGrid, collider Rapier, chỉ mục tầm nhìn và lighting vẫn dựng một lần cho cả map từ `MapData`. Lifecycle mới dừng ở mức mô tả, chưa nối tới các system đang chạy.
- Chưa có migration nội dung (content v1 là bản duy nhất); đổi bố cục thì phải tăng `contentVersion` và viết bước migrate.
- Validator chưa kiểm tra khả năng đi tới được, nav bị tách vùng hay collider chồng nhau.
- Map cũ đóng băng (khoảng 34 KB JSON) nằm trong bundle production để migrate save cũ.
- CLI cần Node ≥ 22.18.

## 8. Tiếp theo

Theo thứ tự đã chốt, bước tiếp là **R3b**:

1. Gộp hình học tĩnh và dùng instancing theo chunk, dựa trên descriptor của chunk.
2. Nav theo chunk kèm portal graph.
3. LOS zombie phía simulation.
4. Nối `ChunkLifecycle` với register/unregister của collider, occluder và nav.

Sau đó là **M3**: editor MVP có entry riêng, đọc và ghi đúng schema này qua cùng validator và resolver.
