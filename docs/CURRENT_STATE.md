# CURRENT_STATE — bàn giao cho phiên làm việc mới

> Cập nhật: **2026-09-25**, hoàn thành **map editor M5 (prefab editor)** sau M4 (P2-S6/S7 tạm dừng theo quyết định chủ dự án).
> Đọc file này, README.md, toàn bộ Zombie_Outbreak_Phase_2_Plan.md, docs/phase2-s1.md … phase2-s5.md, docs/phase2-vision.md, docs/phase2-lighting.md, docs/refactor-r0-r2.md, docs/Map_Editor_Implementation_Plan.md, docs/map-content-format.md, docs/map-editor-m1-m2.md, docs/refactor-r3b.md, docs/map-editor-m3.md, docs/map-editor-m4.md, **docs/map-editor-m5.md**.
> **Người dùng tự commit và push mọi thay đổi. Không tự commit/push. Cập nhật CURRENT_STATE cuối mỗi sprint.**

## 0. Map editor M5 — prefab editor (mới nhất, chưa commit — chi tiết docs/map-editor-m5.md)

Save không đổi (v8), content khu phố không đổi, schema map vẫn v1 (thêm tùy chọn `wallRun`, `retiredLocalIds`). Thứ tự: M3 → M4 → **M5** → M6 (công cụ sản xuất).

- **`wallRun`** (`schema.ts`, `resolve.ts: wallRunBoxes`): tường song song trục; resolver khoét khe cho cửa/cửa sổ cùng prefab nằm trên nó, lanh tô từ `DOOR_HEIGHT`, bệ/đầu cửa sổ; mảnh có ID `<entity>#<phần>` (không trạng thái, không trong `entityIds`). Tường hộp cũ giữ nguyên.
- **Lệnh prefab thuần** `src/map/editor/prefabCommands.ts` (+ `prefabPresets.ts`): create (nhà mẫu `starterHouse`), duplicate (biến thể), delete (không instance), updatePrefab (contentVersion đồng bộ manifest), fitFootprint, place/move/rotate/delete/duplicate/updatePrefabItem; cửa/cửa sổ bám `nearestWallRun` và quay vào tâm footprint; xóa/đổi tên → `retiredLocalIds`. Chung lịch sử với lệnh world.
- **Editor**: `store.prefabMode` (banner hồng, palette/Inspector riêng, `PrefabScene` vẽ qua `resolveInstance`, xem xoay chỉ-xem, vòng tầm tương tác theo `GameRuntime`), nút Sửa/Nhân bản/Xóa/Prefab mới, "Sửa prefab gốc (N instance)" ở Inspector instance, click lỗi trong file prefab mở đúng mục. Cache `resolvedRecords` theo (world, prefab map, chunk).
- **Save**: `statefulEntityIds` (cửa, container, cửa sổ, đèn, zone) = đúng thứ save so khớp. Sửa giữ tập này → save cũ nạp và giữ trạng thái (có test). Cảnh báo `content-changed-same-version` nay chỉ bật khi tập này đổi mà world giữ contentVersion; xóa/đổi tên mục có trạng thái khi prefab có instance → hỏi xác nhận.
- **Kiểm chứng**: 451 test (+9 skip; mới `src/map/editor/prefab.test.ts` 17, gồm nhà dựng bằng lệnh chạy trong `GameRuntime` ở 4 góc xoay và save giữ trạng thái sau sửa tương thích); tsc/oxlint/build/build:editor/map:check/check:bundle (marker M5) sạch; Playwright `scripts/m5-editor-browser.mjs` PASS (prefab mới bằng GUI → 4 góc xoay → export → unpack → chơi `?world=`); hồi quy m3/m4 editor, game dev p2-s5 PASS.
- **Chưa làm**: tay cầm đổi kích thước, polygon room/nhiều tầng, vị trí đèn `at`, migration nội dung cho save; M6 (Play From Here, kiểm tra collider/đi tới, generator, thumbnail, hướng dẫn quy trình).

Commit message gợi ý: **feat(editor): prefab editor M5 (source prefab mode, wall runs with auto openings, doors/windows snapping, rooms and lamps, rotation preview, retired local IDs, save-compatible edits)**

## 0-M4. Map editor M4 — world authoring (đã commit 0a8f50c — chi tiết docs/map-editor-m4.md)

Save không đổi (v8), content khu phố không đổi, schema map vẫn v1 (thêm tùy chọn). Thứ tự đã chốt: R3a → R3b → M3 → **M4** → M5 (prefab editor) → M6 (công cụ sản xuất).

- **Palette theo tab** (`src/map/editor/presets.ts`): Object/Nền/Zone/Spawn đặt bằng click (kích thước mẫu) hoặc kéo (tường theo chiều dài, khung, bán kính); lệnh `placeRecord` tạo ID `<chunk>/<namespace>/<tên>-<n>`, khóa theo thứ tự file content. `rotateRecords` thay `rotateInstances` (hộp/nền/zone chữ nhật đổi X/Z).
- **Chunk**: `addChunk` (cuối manifest, nới `chunkBounds`, tham chiếu tính lại), `removeChunk` (chỉ chunk rỗng, không phải chunk cuối), `fittedPlayAreaSize`; `chunkStatuses` (record/ref/đã sửa/lỗi) cho panel và viền viewport; công cụ chunk click ô trống để thêm.
- **Layer** (`layers.ts`, phiên editor): ẩn/khóa 7 layer; picking, khung chọn (`recordsInRect`), Ctrl+A, undo/redo và click lỗi đều tôn trọng. Zone chỉ bắt click ở viền/tâm.
- **Zone chữ nhật** (`shape: "rect", size`) → `ZoneDef.halfSize`; luật gán mới `game/world/zones.ts` (`zoneFor`: zone chữ nhật nhỏ nhất chứa điểm, còn lại tâm gần nhất — map chỉ có zone tròn không đổi); `pickWanderPoint` lang thang trong hình chữ nhật (cùng số lần rút RNG). Validator thêm cảnh báo `zone-assignment`, `surface-overlap`. Inspector: kích thước zone, số spawn thuộc zone, "Thuộc zone" của spawn zombie, vùng chơi + hàng rào biên.
- Vùng chơi vẫn là hình vuông tâm gốc (NavGrid/Ground/save/biên giả định vậy).
- World mới trong editor không còn cảnh báo `content-changed-same-version` (chưa phát hành).
- **Kiểm chứng**: 434 test (+9 skip; mới `src/map/editor/world.test.ts` 20, gồm nhà vượt biên giữa 2 chunk mới qua `ChunkLifecycle`, zone chữ nhật trong `GameRuntime`, world nhiều chunk do editor tạo chạy 900 tick), tsc/oxlint/build/build:editor/map:check/check:bundle (thêm marker M4) sạch; Playwright `scripts/m4-editor-browser.mjs` (dev) PASS kể cả export → unpack → chơi `?world=`; hồi quy `m3-editor-browser.mjs`, game dev `p2-s5-browser.mjs` PASS. Soak không đổi.
- **Chưa làm**: vùng chơi lệch tâm, thứ tự vẽ mặt nền chồng nhau, đổi kiểu object/tay cầm đổi kích thước trong viewport; sửa prefab (M5); Play From Here, generator (M6).

## 0-M3. Map editor M3 — editor MVP (đã commit 08a3559 — chi tiết docs/map-editor-m3.md)

- **Entry riêng** `editor.html` (`npm run dev` → `/editor.html`; build `npm run build:editor` → `dist-editor/`). Bản build game không chứa editor/generator: `npm run check:bundle`.
- **Lõi thuần** `src/map/editor/`: `MapDocument` bất biến (world + prefabs + chunks + extras), lệnh place/move/setAnchor/rotate/delete/duplicate/updateRecord/updateWorld, lịch sử (document + selection trước/sau), content pack, picking/snap. **UI** `src/editor/` (zustand + R3F): viewport vẽ output của resolver runtime, palette, inspector, bảng Validate, nháp IndexedDB riêng `zombie-outbreak-editor`.
- **Identity**: move/rotate/sửa giữ ID; kéo qua biên chunk chuyển file chunk và giữ ID (báo rõ); đặt/nhân bản tạo `<chunk>/<tên>-<n>` mới; xóa ghi `world.retiredIds` (mới, tùy chọn) + lỗi validate `retired-id-reused`; không xóa được spawn người chơi; cảnh báo editor `content-changed-same-version` nếu đổi bố cục mà giữ `contentVersion`.
- **Validator**: thêm `checkWorldDocuments` (không ném lỗi), `loadWorldDocuments` bọc lại nó. Export bị chặn khi còn lỗi; import pack lỗi bị từ chối, document đang mở giữ nguyên.
- **Đưa vào game**: `npm run map:unpack -- <pack>` (validate, `--force` để ghi đè, file không đổi không ghi lại), `npm run map:pack -- <dir>`; dev `?world=<id>` chơi world trong `content/maps/<id>` với slot save `slot-world-<id>` (`world/devWorld.ts`, `uiStore.activeSaveSlot`).
- **Kiểm chứng**: 414 test (+9 skip; mới `src/map/editor/editor.test.ts` 18 gồm runtime chạy pack do editor tạo), tsc/oxlint/build/build:editor/map:check/check:bundle sạch; Playwright `scripts/m3-editor-browser.mjs` (dev) PASS 13 bước kể cả world mới → unpack → chơi trong game; hồi quy dev p2-s2/vision, production p2-s5/lighting PASS. Test thời gian `navTiles` đổi sang min-of-3 (từng rớt khi chạy song song).
- **Chưa làm lúc M3** (tạo chunk, object rời/đường/zone/spawn mới, layer, khung chọn): xong ở M4 (mục 0-M4).

## 0a. R3b: hiệu năng theo chunk (đã commit 09112e2 — chi tiết docs/refactor-r3b.md)

- **LOS phía simulation**: `runtime.isBlocked()` → `staticColliders.segmentBlocked()` (cùng bộ hộp Rapier; test đối chiếu Rapier WASM trùng 100 %) cho tầm nhìn/đòn của zombie, tương tác, cận chiến, che spawn. `PhysicsBridge` bỏ; test thay bằng `setLineOfSightOverride` (tên cũ `registerPhysicsQuery`). Soak/perf dùng LOS thật.
- **Render gộp theo chunk**: `rendering/StaticBatches.tsx` (`BatchedMesh` mỗi chunk: tường/vật cản, thân container, sàn, mái; màu theo instance trên một material trắng; shader trong nhà hỗ trợ batching, key `indoor-lighting-v2`); vật che là hộp + callback (`occlusionRegistry`), tường/mái mờ = ẩn instance + bản sao mờ; `RoofController` ở StaticBatches. `Walls.tsx`, `BuildingView.tsx`, `blockerData.ts` bỏ.
- **Collider Rapier theo chunk**: `rendering/ChunkColliders.tsx` — chỉ các chunk trong `GAME_CONFIG.streaming.colliderChunkRadius` (1) quanh người chơi + hộp dài hơn chunk (Rapier chỉ còn phục vụ thân người chơi). Lá cửa vẫn body riêng.
- **Nav theo chunk**: `world/gridSearch.ts` (A*/Dijkstra giới hạn vùng), `world/navTiles.ts` (vùng theo tile + union-find; HPA* cho đường cách ≥ 2 tile; đồ thị dựng lúc nạp map, làm nóng lại `pathfinding.warmMs` 0,5 ms/tick sau đổi cửa). Đường gần giữ A* cũ.
- **Kết quả**: draw call 194 → 62 (thường), 335 → 106 (stress); CPU/frame stress đứng yên 10,5–10,9 → 5,2–7,6 ms, 224 zombie 12,3–14,3 → 7,6–8,5 ms; bão path stress tick tệ nhất 9,2 → 4,9 ms (cùng LOS).
- **Mốc soak mới** (LOS thật thay LOS giả theo lưới): shelter 1800 s/3 kill/30 dmg, patrol **659 s/30 kill**. Trước khi đổi LOS, soak sau nav trùng M2 từng số.
- **Kiểm chứng**: 396 test (+9 skip), tsc/oxlint/build sạch; Playwright dev S2–S5/vision/lighting + tường chunk xa, production S5/vision/lighting/S4 PASS.
- **Chưa làm (dời sang streaming)**: `ChunkLifecycle` điều khiển registry/nav/WorldState, nav lưu theo tile, instancing nhân vật.

## 0b. Map content M1–M2 = R3a (đã commit 86ce472 — chi tiết docs/map-editor-m1-m2.md)

Kế hoạch: `docs/Map_Editor_Implementation_Plan.md`. Thứ tự đã chốt với chủ dự án: **R3a (M1+M2) → R3b (hiệu năng theo chunk) → M3+ (editor GUI)**.

- **Nội dung là dữ liệu**: `content/maps/neighborhood-50/` (world.json, 3 prefab `building/*`, 4 chunk 32 m `c-1_-1 c0_-1 c-1_0 c0_0`, `migrations/legacy-v7-map.json` + `legacy-v7-ids.json`). Định dạng/quy ước: `docs/map-content-format.md`.
- **Mã**: `src/map/` (schema, transform, validate, resolve, loader `ChunkLifecycle`, content, format; tools `importLegacy`, `tileWorld`); `NEIGHBORHOOD_MAP = loadBundledWorld('neighborhood-50').map` (không còn BuildingDef viết tay); `MapData.buildings: BuildingInfo[]`; hằng `*_ADDED_Vn` chuyển sang `world/legacyContent.ts` (chỉ cho save cũ). `?stress=N` sinh bằng `tileWorld` qua cùng pipeline; production không chứa generator.
- **ID ổn định**: `c-1_-1/safehouse/door`, `c0_-1/store/shelf-1`, `c-1_0/objects/park-toolbox`, `c0_0/zones/south`, `world/boundary-n`… (đoạn chunk là định danh bất biến). **Mọi test/script mới phải dùng ID này.**
- **Save v8** (+ `contentVersion`): v1–v7 migrate qua map cũ đóng băng rồi đổi tên ID (backup `slot-1.backup-v7`); ID inventory/item không đổi.
- **Tương đương**: test so từng thực thể với map cũ; soak trùng từng số R2 khi cùng thứ tự + khóa loot cũ. Mốc soak lúc đó (thứ tự chunk, loot seed theo ID mới, LOS giả): shelter 1800 s/3 kill/10 dmg, patrol 970 s/42 kill (R3b thay bằng mốc LOS thật).
- **Kiểm chứng**: 380 test pass (+9 skip), tsc/oxlint/build sạch, `npm run map:check` OK; Playwright dev S2 (migrate v7/v3/v2/v1 → v8 qua Continue), S3, S4, S5, vision, lighting và production S5/vision/lighting/S4 PASS. Fixture `phase2-light-v7.json` nay đóng băng (script không ghi nữa).
- **Sửa nội dung**: sửa JSON trong `content/maps/…` rồi `npm run map:check`; đổi bố cục khu phố = tăng `contentVersion` (test tương đương/importer tự bỏ qua khi khác 1) và viết migrate nếu trạng thái đã lưu bị ảnh hưởng.
- Sau M1–M2 là R3b (mục 0a), rồi M3 (mục 0).

## 0c. Refactor kiến trúc R0–R2 (đã commit 8637897 — chi tiết docs/refactor-r0-r2.md)

Yêu cầu: `Prompt thực thi refactor kiến trúc R0–R2 cho Zombie Outbreak.md` (dựa trên `game-architecture-refactor-plan.md`). Không streaming/ảo hóa/worker/floating origin/chunk persistence. Save vẫn v7 (M2 nâng lên v8).

- **R0**: `runtime.perf` (`core/perf.ts`), HUD **F7** / `?perf=1` (`components/PerfHud.tsx`, `rendering/PerfProbe.tsx`: frame, CPU/frame, draw call), map stress **`?stress=N`** (dev, `world/stressMap.ts`, slot `slot-stress`), benchmark `PERF_SCENARIOS=1 npx vitest run src/game/core/perf.scenarios.test.ts --reporter=verbose`, trình duyệt `scripts/r0-perf-browser.mjs [label] --gpu`.
- **R1** (không đổi hành vi, soak trùng từng số): `core/spatialHash.ts` (kết quả theo thứ tự chèn); `runtime.zombieIndex` (separation, cận chiến, tầm nhìn), index occluder, interactable, công trình (`runtime.buildingAt`, `RoofController`); A* dùng lại buffer (stamp); không còn `scene.traverse` ở hot path: vá shader trong nhà trên `MeshStandardMaterial.prototype` (`installIndoorShading`), `occlusionRegistry` + `occluderRef`; material/geometry dùng chung (`rendering/sharedResources.ts`); giới hạn phòng shader `buildingLighting.maxShaderRooms` (map nhiều phòng tải 16 phòng gần nhất).
- **R2**: **simulation sở hữu `zombie.position`**; `systems/zombieMovement.ts` (vòng tròn và hộp của `world/staticColliders.ts`, có `registerStaticCollider/unregisterStaticCollider`; `Walls.tsx` dựng từ registry); body Rapier **kinematic chỉ cho zombie ACTIVE còn sống** (`ZombieBody`), `ZombieView` chỉ hiển thị; `systems/aiScheduler.ts` (ACTIVE ≤ 25 m 20 Hz, NEAR ≤ 60 m 4 Hz, DORMANT 0,5 Hz, critical ≤ 6 m/đang đánh/khựng/ngã mọi tick, ≤ 48 lượt/tick); `world/pathfindingQueue.ts` (một yêu cầu/zombie, ≤ 6 A*/tick, ≤ 2 ms; `runtime.pathBudget.maxPathMs = Infinity` khi cần tất định); `ai.ts` dùng `ctx.requestPath` + `NavGrid.routeKind`; `Scene` tách danh sách zombie/body/túi đồ thành component riêng (đổi cấp độ không re-render cả scene). Config `GAME_CONFIG.simulation`, `GAME_CONFIG.pathfinding`.
- **Kết quả** (map stress, 160 zombie): tick Node 1,29 → 0,056 ms; bão A* tệ nhất 595 → 9,8 ms; trình duyệt (Intel UHD 730) 53,6 → ~74 FPS, CPU/frame 17,5 → ~10,5 ms, body zombie 160 → ~8. Draw call chưa giảm (việc của R3).
- **Hành vi đổi (R2)**: người chơi không đẩy được zombie (kinematic); zombie va chạm thật với người chơi/nhau/tủ; soak patrol 719 → **655 s** (shelter vẫn đạt cổng: 30', 4 kill, 30 dmg). Test dùng body giả chỉ còn cho người chơi.
- **Kiểm chứng**: 359 test pass (+ 9 skip benchmark), tsc/oxlint/build sạch; trình duyệt dev s2/s3/s4/s5/vision/lighting và production s5/vision/lighting/s4 PASS (fixture lighting ghi lại đã khôi phục).
- Barricade/vách mới (P2-S6/S7) đăng ký vào `StaticColliderRegistry`, `VisionOccluderSet` và nav; nội dung tĩnh của chúng nên là object trong prefab/chunk.

## 1. Trạng thái hiện tại

Phase 1 xong mã cả 6 sprint. Phase 2 xong **S1–S5** (đã commit, S5 = 1f81571) và **sprint bổ sung tầm nhìn người chơi** (zombie chỉ vẽ khi nhân vật thấy; debug F4; save vẫn v6; sau playtest đã **bỏ lớp tối mặt đất** — tầm nhìn không được đụng ánh sáng). Sprint kế tiếp là **P2-S6: barricade gỗ/kim loại, tool/fuel**.

Tầm nhìn: c4f9728 → 1fc531d → **5f38d8d** (VisionOverlay), đã commit. **Ánh sáng trong nhà** đã commit (**38a1469**, save **v7**). Sau đó là **refactor R0–R2** (mục 0c, commit 8637897), **map content M1–M2** (mục 0b, save v8), R3b (mục 0a), map editor M3 (mục 0-M3), M4 (mục 0-M4) và **M5** (mục 0). File yêu cầu `Prompt triển khai hệ thống tầm nhìn người chơi kiểu Project Zomboid.md` ở gốc repo chưa track (người dùng quyết định có commit hay không).

| Sprint | Trạng thái |
|---|---|
| Phase 1 S1–S6 | Xong mã; deploy thật, FPS GPU thật và playtest tay vẫn cần xác nhận |
| P2-S1 … P2-S4 | Xong, đã commit |
| P2-S5 Perception/lang thang/di cư/phá cửa | Xong, đã commit (1f81571) |
| Bổ sung: tầm nhìn người chơi | Đã commit (c4f9728, 1fc531d, 5f38d8d) |
| Bổ sung: ánh sáng trong nhà | Đã commit (38a1469) |
| Refactor R0–R2 (hiệu năng/kiến trúc) | Đã commit (8637897) |
| Map content M1–M2 = R3a (prefab + chunk JSON, save v8) | Đã commit (86ce472) |
| R3b (LOS simulation, batch + collider theo chunk, nav HPA*) | Đã commit (09112e2) |
| M3 map editor MVP | Đã commit (08a3559) |
| M4 world authoring | Đã commit (0a8f50c) |
| M5 prefab editor | Xong, chưa commit (docs/map-editor-m5.md) |
| M6 công cụ sản xuất | Tiếp theo (thứ tự đã chốt) |
| P2-S6 Barricade/tool/fuel | Tạm dừng (sau R0–R2); dùng TimedAction + tool requirement S4, hook `worldTargetId` S5 |
| P2-S7 Building/thùng/vách/rebuild | Chưa làm |
| P2-S8 Tích hợp/cân bằng/release | Chưa làm |

## 1b. Sprint ánh sáng trong nhà đã bàn giao (chi tiết docs/phase2-lighting.md)

- `lighting/buildingLighting.ts`: `outdoorLightLevel(t)` = 0,05 + 0,95 × `daylightAt` (DayNight không đổi); `buildLightingBuildings(map)` (cửa sổ/cửa tự tìm phòng bằng điểm hai bên, bên ngoài = `outdoor`); `solveBuilding` (cửa sổ → direct × 0,6 × 0,8; lan truyền × transmission × 0,8, sâu ≤ 3, ngưỡng 0,03, visited, best arrival; đèn có điện; final = 1 − Π(1 − x), kẹp 0,03); `BuildingLightingSystem` (dirty theo building, bước ánh sáng ngày 0,03, `revision`, `getLightAtPosition`).
- `runtime.lighting`; `setLamp/setCurtain/setElectricity` (+ sự kiện `light:changed/curtain:changed/power:changed`), `setDoorState` đánh dấu bẩn; cập nhật trước tầm nhìn cuối tick. Không đọc facing/vision (test chặn).
- Map (ID mới): cửa sổ `win-*` (bệ/dầm là tường, kính là `WindowView` + collider `…:pane`), phòng `room-*`, đèn `lamp-*` + công tắc; nhà dân có vách `house-partition` + cửa `door-house-bedroom` (ban đầu mở, `DoorPlacement.initialState`). Kính chặn nav như tường.
- Hiển thị: `rendering/indoorShading.ts` patch mọi `MeshStandardMaterial` tại chỗ (`onBeforeCompile`, key chung): fragment trong phòng dưới trần = màu × shade phòng (0,06…0,85) × hướng mặt + emissive; ngoài giữ nguyên. `IndoorLighting.tsx` cập nhật uniform theo revision. Tương tác E: công tắc (`light`), rèm (`window`, tầm 0,3 m). F6 debug, F3 dòng Ánh sáng.
- Save v7 `lighting {curtains, lamps, electricity}`; migrate v6 → v7 thêm cửa phòng ngủ (mở), mặc định rèm mở/đèn tắt/có điện, đẩy entity khỏi vách mới. Fixture `phase2-light-v7.json` và `phase2-s5-v6.json` đều đóng băng (từ save v8 script không ghi nữa).

## 2. Sprint tầm nhìn đã bàn giao (chi tiết docs/phase2-vision.md)

- `PlayerVisionSystem` (`systems/playerVision.ts`) chạy **cuối tick** (sau di cư), 20 lượt/s: ứng viên từ `runtime.getNearbyZombies` → khoảng cách 20 m → bán kính gần 2,5 m (bỏ qua hình quạt, **vẫn cần LOS**; `nearDetectionThroughWalls` để đổi) → hình quạt 110° theo `player.facing` (dot product) → LOS mắt 1,6 m tới thân 1,2 m. Tối đa 48 raycast/lượt, cũ nhất trước. Grace 0,15 s, fade 0,2 s trong tick.
- Trạng thái ở `runtime.vision.states` (`isVisibleToPlayer`, `reason`, `opacity`), **không** trong `ZombieState`, không lưu. AI không đọc. Test chứng minh simulation giống hệt khi tắt vision.
- Vật chắn riêng `runtime.visionOccluders` (`world/visionOccluders.ts`, AABB, không Rapier): tường có đỉnh ≥ 1,5 m (kể cả lanh tô, biên, cột), tủ/kệ cao, lá cửa khi đóng (đọc `world.doors` lúc truy vấn). Hàng rào/thùng/xe/giường/quầy không chặn. `createWindowOccluder` (rèm) và `add/remove` sẵn cho cửa sổ/barricade/vách sau này.
- Render: `ZombieView` đọc `runtime.vision.opacity(id)` (ẩn = không vẽ, không bóng, bỏ pose); `PlayerVisionDebug.tsx` (F4 / `?vision=debug` / `playerVision.debug`). F3 thêm thống kê + `nhìn=` từng zombie.
- Config `GAME_CONFIG.playerVision` (= `PLAYER_VISION_CONFIG`).
- **VisionOverlay** (`rendering/VisionOverlay.tsx` + `systems/visionOverlay.ts`, config `visionOverlay`): 1 quad toàn màn hình vẽ cuối, blend đen alpha ≤ 0,15 (ngoài tầm 0,08, sau vật chắn trong quạt 0,12, gần 0, ban đêm × 0,5), pixel chiếu xuống mặt đất (world-space), cạnh mềm smoothstep, hướng nhân vật làm mượt 60 ms, mask sector LOS 128 tia/frame (0,1 ms). Chỉ đọc `daylightAt`; không đèn/vật liệu/exposure. Setting "Hiệu ứng tầm nhìn". F3 dòng Overlay; F4 tô hồng mask.

## 2b. S5 đã bàn giao (đã commit)

- **Cảm nhận**: zombie chưa phát hiện nhìn hình nón ±70°/10 m (hoặc mọi hướng trong 1,2 m); đang săn nhìn mọi hướng 14 m. **Nghe bước chân** bán kính cố định: đi 5 m, chạy 12 m, đứng yên im lặng; qua tường × 0,5. Trí nhớ `lastKnownTarget/memoryAge/memorySource` 20 s (thay timeout SEARCH 8 s). Bị đánh khi chưa phát hiện → tìm hướng đòn.
- **Lang thang**: IDLE nghỉ 3–8 s → WANDER tới điểm ngẫu nhiên đi được, cùng vùng liên thông, ngoài trời, trong vùng (0,9 m/s) → nghỉ → điểm mới.
- **Di cư**: 8 `zombieZones` trên map khu phố; director mỗi 90–180 s chuyển cả nhóm của một vùng (≥ 2 con đang nghỉ/lang thang) sang vùng khác ưu tiên vùng vắng; con rảnh chuyển MIGRATE (1,4 m/s), con đang săn giữ săn. Seed theo ván + bộ đếm, lưu trong save.
- **Phá cửa**: `findDoorRoute` trên nhãn vùng liên thông (cache theo `nav.version`); APPROACH_STRUCTURE → ATTACK_STRUCTURE, 10 dmg/1,2 s, 2 slot mỗi phía cửa, hàng chờ 2,4 m, runtime kiểm tra lại cửa còn đóng + trong tầm mỗi đòn; mở cửa lúc lấy đà hủy đòn; vây tối đa 60 s từ thông tin mới nhất; vỡ → collider/nav/`door:destroyed` → SEARCH vị trí nhớ. `findPath` trả null ngay khi khác vùng liên thông (không còn A* loang).
- **Phản hồi**: âm đập/vỡ cửa giảm theo khoảng cách, cửa rung + sẫm theo HP, prompt "(độ bền x/120)", toast cửa vỡ, mắt đỏ khi vây cửa, F3 hiện vùng/trí nhớ/cửa đang đập, bán kính bước chân, giờ di cư. Hướng dẫn trong game cập nhật. Lab `?lab=doors` hiện HP cửa + trạng thái zombie.
- **Respawn** cấm điểm trong nhà và ô không đi được (`pickSpawnPoint.isAllowed`).
- **Feedback 25/09 — animation + bước chân**: chân người chơi/zombie không còn phụ thuộc FPS (tốc độ lọc 0,12 s, pha tích phân; `rendering/character/gait.ts`), sải dài hơn (`config.player.walkStride/runStride` 2,2/3,2 m, zombie 1,6 m), zombie quay mượt. Tiếng bước chân `player:footstep` phát mỗi nửa sải **chỉ khi zombie nghe được** (`playerNoise` > 0), âm `stepWalk`/`stepRun`.
- **Hook S6**: `TimedAction.worldTargetId` — cửa trúng đòn hủy action nhắm nó (`target-damaged`), không trừ gì.
- **Save v6**: zombie thêm `memoryAge/memorySource/zoneId/structureTargetId`, save thêm `horde {timer, counter}`; migrate v5 → v6 (vùng gần nhất, không vây, timer 90), backup `slot-1.backup-v5`. Fixture `phase2-s5-v6.json` (Chromium, lưu giữa lúc đang đập cửa); `phase2-s4-v5.json` đóng băng.

## 3. Kiểm chứng cuối sprint

**Sprint ánh sáng (25/09)**: npm test **325/325** (31 file; mới `lighting/buildingLighting.test.ts` 22 gồm 10 acceptance của spec + test chặn; `phase2-save.test.ts` thêm v6 → v7 và fixture v7). Build/lint sạch. Playwright `scripts/p2-lighting-browser.mjs` dev + production PASS (độ sáng sàn thật: 12:00 phòng khách 92,5 / phòng ngủ 59,5 → đóng cửa 15,1; quay 4 hướng chênh 0; 00:00 bật đèn phòng ngủ 15 → 84; mất điện về 15; ngoài trời không đổi). Hồi quy vision, s5 (dev+prod), s4/s3/s2 (prod) PASS. **Soak**: shelter sống 30', 3 kill, 30 dmg, cửa không vỡ; patrol **719 s**, 31 kill (S5: 853 s) — do vách nhà dân đổi đường đi, chưa chỉnh số.

**Sprint tầm nhìn (25/09)**: npm test **298/298** (30 file; `systems/playerVision.test.ts` 20 gồm 3 test chặn vision/overlay chạm ánh sáng, `systems/visionOverlay.test.ts` 8, `core/vision.test.ts` 4), build/lint sạch. Soak **không đổi** so với S5 (shelter 30'/4 kill/30 dmg/cửa vỡ giây 61; patrol 853 s/30 kill). Hiệu năng Node: 500 zombie 0,095 ms/lượt. Playwright/Chrome 153 `scripts/p2-vision-browser.mjs` dev (trước/sau/sát lưng, quay bằng phím thật, cửa đóng/mở, zombie ẩn vẫn đập cửa, **đèn và độ sáng màn hình không đổi khi quay 4 hướng lúc 12:00/00:00/trong nhà; overlay chỉ dịu còn ≥ 92 % (ngày), ≥ 98 % (đêm); quay nhanh/zoom không có khung tối**) + production (F3/F4, không lỗi) PASS; hồi quy production p2-s5, p2-s4 PASS.

**S5 (24/09)**:

- **npm test: 266/266**, 27 file (gồm `gait.test.ts`, `footsteps.test.ts`). **npm run build**, **npm run lint** sạch.
- Soak (lộ trình không đổi): shelter **sống 30'**, 4 kill, 30 dmg, **cửa nhà an toàn bị phá ở giây 61** (zombie nghe/thấy bot chạy về), 12 lần di cư; patrol chết ở **853 s** (trước 721,9 s), 30 kill. Bất biến ≤ 2 zombie đập mỗi phía cửa.
- Playwright/Chrome 153 (`scripts/p2-s5-browser.mjs`): dev 3/3 (lang thang, bước chân bằng phím thật, E mở/đóng cửa, đập cửa với Rapier thật, lưu giữa vây → reload → Continue → vỡ → vào nhà → đánh, ghi fixture v6); production 4/4. Hồi quy p2-s2/s3/s4 dev + production, p2-smoke dev + production: PASS (schema 6).
- **3 test interaction lỗi sẵn trên HEAD** (commit S4 đổi `INTERACT_RANGE` 2 → 1 m) đã sửa vị trí vật trong test; script S4 thêm bước lùi vào phòng vì cùng nguyên nhân. Hằng số không đổi.

## 4. File/module liên quan

| File | Trách nhiệm |
|---|---|
| src/game/systems/ai.ts (+ ai.test, perception.test) | FSM, `perceive` (nón nhìn + nghe), trí nhớ, lang thang/MIGRATE, vây cửa, `moveTowards` báo `blocked` |
| src/game/entities/zombie.ts | Trường trí nhớ, lang thang, vùng, cửa mục tiêu; `UNAWARE_STATES` |
| src/game/systems/horde.ts (+ horde.test) | `nearestZone`, `planMigration`, `migrationInterval` thuần |
| src/game/world/navigation.ts | `componentAt` (R3b: vùng theo tile qua `navTiles.ts`), `findDoorRoute` mới, `portals` có `center/sides/slots` |
| src/game/world/mapData.ts | `ZoneDef`, `zombieZones` map khu phố |
| src/game/core/runtime.ts | `playerNoise`, ngữ cảnh AI (route/slot/cửa/điểm lang thang), `stepStructureHits`, `stepHorde`, lọc respawn, snapshot/load v6 |
| src/game/core/siege.test.ts | Nghiệm thu runtime S5 (body giả trên lưới) |
| src/game/core/config.ts | `zombie.*` (nón, trí nhớ, lang thang), `hearing`, `structure`, `horde` |
| src/game/systems/save.ts, types/save.ts | Schema v6, `migrateV5`, `isZombieV6` |
| src/game/rendering/DoorView.tsx, ZombieView.tsx, audio/sfx.ts, app/App.tsx | Rung/sẫm cửa, mắt đỏ, `doorBash/doorBreak` theo khoảng cách, toast |
| src/components/HUD.tsx, stores/hudStore.ts, DoorLab.tsx, Settings.tsx | F3, lab, hướng dẫn |
| scripts/p2-s5-browser.mjs | Kiểm thử S5 dev/production; dev ghi `phase2-s5-v6.json` |
| src/game/rendering/character/gait.ts (+ test), core/footsteps.test.ts, scripts/p2-s5-gait.mjs | Gait độc lập FPS, nhịp/âm bước chân |
| docs/phase2-s5.md | Quyết định, số liệu, kiểm chứng |

## 5. Bước tiếp theo — P2-S6

0. Barricade/vách mới phải chặn tầm nhìn người chơi: thêm occluder vào `runtime.visionOccluders` (`isBlocking` đọc trạng thái) — không sửa `PlayerVisionSystem`. Barricade cửa sổ: nối `windowBarricade(id)` của `LightingInputs` (hệ số ánh sáng, ví dụ 0,4) và `markWindowDirty`; barricade cửa: transmission riêng. Giữ tách movement / vision / lighting.
1. Barricade trên `DoorState` (gỗ 1–3 ván, kim loại); `stepStructureHits` trừ barricade trước, phần dư vào cửa (plan §9.3). Cửa barricade không mở được.
2. Action nhắm cửa: `startRecipe` với `worldTargetId = doorId` (hook đã có), kiểm tra khoảng cách tới cửa, cooldown 3 s sau lần cửa trúng đòn.
3. Items `metal_sheet`, `welding_torch` (fuel), `welder_mask`, `fuel_canister`; refuel là recipe có thời gian. Búa đã là tool (`isUsableTool`).
4. Save v9 cho barricade/fuel; migrate v8 → v9; fixture mới (các fixture cũ giữ đóng băng); barricade tĩnh là object trong prefab/chunk, ID theo `docs/map-content-format.md`.
5. Cân bằng thời gian trụ cửa với 1–2 zombie; soak shelter hiện mất cửa ở giây 61 — cân nhắc cho bot gia cố/sửa cửa khi có S6/S7.

## 6. Giới hạn và việc còn lại

- Ánh sáng: không PointLight động, phòng sáng đều (chưa theo khoảng cách cửa sổ), chưa semi-indoor/blend ngưỡng cửa/màu lan truyền/thời tiết/lịch mất điện; tối đa 16 phòng trong shader. Soak patrol giảm còn 719 s vì vách nhà dân.
- Tầm nhìn: **quy tắc** — vision chỉ đổi zombie nào được vẽ, không bao giờ đổi đèn/vật liệu/exposure/lớp phủ môi trường (ánh sáng chỉ ở `Lights.tsx` theo đồng hồ; có test chặn). VisionOverlay là lớp phủ duy nhất, kẹp ≤ 0,15; mái/tường lấy shade của điểm đất phía sau (chiếu mặt đất). Một tia LOS/zombie; tầm nhìn không giảm ban đêm; chưa spatial hash (điểm thay: `getNearbyZombies`). Giá trị 2,5/20 m/110° là khởi điểm, chưa playtest tay.

- Chưa deploy thật, đo FPS GPU tích hợp thật hay playtest tay. Draw call tăng ~1,6–1,8× so với capsule (S3).
- Cân bằng S5 (nón 70°, nghe 5/12 m, di cư 90–180 s) là giá trị khởi điểm. Nghe chưa có sai số; tiếng đánh/đập cửa chưa thu hút zombie.
- Cửa vỡ chưa lắp lại được (S7); nhà an toàn có thể mất cửa sớm.
- Chi phí phá cửa 12 m/cạnh đi bộ đường thẳng là ước lượng; đủ cho map hiện tại.
- Warning thư viện: THREE.Clock, Rapier init parameters, Vite advancedChunks deprecated. Audio Safari chưa kiểm chứng iOS thật.

## 7. Kiểm tra nhanh và nguyên tắc giữ lại

**Môi trường**: repo cần Node ≥ 20 (Vitest/Rolldown dùng `node:util.styleText`). Máy dev hiện chỉ có Node 18.12 trên PATH; S5 dùng Node 22.20 portable ngoài repo. `node_modules` từng thiếu binding Windows của rolldown/oxlint (lỗi optional deps của npm) — đã giải nén đúng phiên bản trong lockfile; nếu tái cài thì `npm ci` bằng Node ≥ 20.

Chạy npm test, npm run build, npm run lint. Lưu ý: `npm run` bằng npm 10 từng ghi đè trường `license` trong package-lock.json (đã hoàn tác); có thể gọi thẳng `node node_modules/vitest/vitest.mjs run`, `node node_modules/vite/bin/vite.js build`, `./node_modules/.bin/oxlint`. Soak: `npx vitest run src/game/core/soak.test.ts --reporter=verbose` (in thêm `sightAlerts/noiseAlerts/sieges/doorHits/doorsDestroyed/migrations`). Chơi thử `npm run dev`; F3 xem trạng thái/vùng/trí nhớ zombie; lab `?lab=doors` (mở cửa cho zombie thấy, đóng lại, xem HP cửa).

Browser: Playwright không phải dependency; truyền `PLAYWRIGHT_MODULE` (file:// URL, ví dụ npx cache `playwright@1.64`) và `CHROMIUM_PATH` (Chrome cài sẵn), `BASE_URL`. Khởi động Vite mới sau khi sửa source. `p2-s5-browser.mjs` (dev) ghi đè `phase2-s5-v6.json`; fixture v1–v5 đóng băng. `p2-vision-browser.mjs` (dev/`--production`) không ghi fixture. `p2-lighting-browser.mjs` dev ghi `phase2-light-v7.json`; `p2-s5-browser.mjs` thôi ghi fixture v6; script cũ assert schema 7. `p2-smoke.mjs` cần Chrome headless mở sẵn với `--remote-debugging-port=9223` và profile thử riêng. Ảnh ở node_modules/.tmp (không track).

Giữ simulation ngoài React; thứ tự tick: input → movement (tính tiếng bước chân) → interaction → AI (R2: cấp độ → scheduler → hàng đợi A* → di chuyển zombie có va chạm → body kinematic) → combat → **đòn vào công trình** → action → survival/clock → spawn → **di cư** → **ánh sáng trong nhà (theo sự kiện)** → **tầm nhìn người chơi (chỉ render, AI không đọc)** → events; pose chạy sau tick qua `CharacterAnimator`; không import Rapier runtime vào simulation. AI chỉ biết vị trí người chơi qua nhìn/nghe/trí nhớ. Mọi hành động có thời gian mới dùng `startRecipe`/reservation/commit nguyên tử. Giữ layout/ID map, ID vùng và fixture cũ. Tăng schema khi đổi cấu trúc save. Không đổi balance khi chưa đo; soak sau sửa combat/AI/spawn/survival. **Không commit/push; chỉ gợi ý message.**

