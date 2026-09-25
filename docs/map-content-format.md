# Định dạng nội dung map (schema v1)

Hợp đồng dữ liệu giữa content (JSON), runtime và editor sau này. Áp dụng từ M1–M2 của `Map_Editor_Implementation_Plan.md` (xem báo cáo `docs/map-editor-m1-m2.md`). Mã nguồn: `src/map/`.

## 1. Thư mục

```text
content/maps/<worldId>/
  world.json                 manifest + chỉ mục chunk/prefab
  prefabs/<name>.json        prefab (tọa độ cục bộ)
  chunks/c<cx>_<cz>.json     layout của một chunk (tọa độ cục bộ chunk)
  migrations/                dữ liệu cho save cũ (map đóng băng + bảng ID cũ → ID ổn định)
```

Game nạp mọi JSON dưới `content/maps/` bằng `import.meta.glob` (Vite gộp vào bundle, vitest đọc cùng cách). Streaming sau này thay nguồn đọc bằng fetch theo chunk, giữ nguyên hợp đồng `read(path)`.

## 2. Tọa độ và đơn vị

- 1 đơn vị = 1 m; Y hướng lên; mặt đất là XZ (`coordinateSystem: "y-up-xz-meters"`).
- Vùng chơi hình vuông `playArea.size`, tâm tại gốc tọa độ (NavGrid và kiểm tra túi đồ rơi dựa vào điều này).
- `quarterTurns` q ∈ {0, 1, 2, 3}: xoay +90°·q quanh +Y, cùng quy ước `rotation.y` của Three.js; q = 1 biến (x, z) thành (z, −x). Phép xoay dùng hoán vị chính xác, không dùng lượng giác.
- Vị trí thế giới = `gốc chunk + vị trí instance + xoay(local − pivot, q)`, sau đó **lượng tử hóa 1 µm** (`quantize`). Nhờ vậy cùng một điểm luôn cho cùng một giá trị, dù cách chia chunk/instance khác nhau; −0 được chuẩn hóa thành 0.
- Hộp (tường, đồ vật, container) luôn song song trục: q lẻ thì hoán đổi kích thước X và Z. Cửa và cửa sổ cộng q của object với q của instance.

## 3. Chunk và quyền sở hữu

- `chunkSize` = 32 m. Chunk (cx, cz) phủ `[cx·S, (cx+1)·S) × [cz·S, (cz+1)·S)` (nửa mở). Chỉ số = `floor(v / S)`, đúng cả với tọa độ âm. ID chuẩn: `c<cx>_<cz>`, ví dụ `c-1_0` (không có `-0` hay số 0 đứng đầu).
- Mỗi record (instance, object rời, đường, zone, spawn) có **đúng một chunk sở hữu**: chunk chứa điểm neo của nó (vị trí instance/object/đường/spawn, tâm zone). Trong file chunk, tọa độ neo phải nằm trong `[0, S)`, nếu không validator báo `owner-mismatch`.
- Record vượt biên chunk (theo bounds sau khi xoay) **không bị nhân bản**. Mỗi chunk bị nó lấn vào ghi một `externalRefs: [{ id, ownerChunkId }]`. Validator tính lại tập tham chiếu và báo `missing-external-ref` hoặc `stale-external-ref` khi lệch. Cạnh nằm đúng trên đường chia chunk không tính là lấn sang.
- Vòng đời (`ChunkLifecycle`, `src/map/loader.ts`): một record còn hoạt động khi ít nhất một chunk đang nạp sở hữu hoặc tham chiếu nó (đếm tham chiếu). Nạp một chunk hai lần không có tác dụng. Thứ tự nạp không ảnh hưởng `MapData`, vì record được sắp theo thứ tự content.
- Record là mô tả bất biến. Trạng thái đổi được (cửa, loot, đèn, rèm) nằm trong WorldState/save theo ID, nên gỡ rồi nạp lại chunk không reset được nó.
- Tường biên vùng chơi thuộc cấp world (`world/boundary-n|s|w|e`), sinh từ `world.boundary`.
- R3b: runtime dùng cùng lưới chunk (`MapData.chunkSize`, mặc định 32) cho batch render (`StaticBatches`), nhóm collider Rapier (`ChunkColliders`) và tile nav (`navTiles`); vật được xếp vào chunk theo tâm của nó.
- Kích thước khu phố thực tế: vùng chơi 50 m (−25..25) nằm trên 4 chunk `c-1_-1`, `c0_-1`, `c-1_0`, `c0_0`. Ba nhà, mỗi nhà nằm gọn trong một chunk. Hai con đường, zone "Ngã tư" và tường biên cắt qua đường chia chunk, nên ownership + tham chiếu được dùng thật ngay từ đầu.

## 4. ID ổn định

| Loại | Dạng | Ví dụ |
|---|---|---|
| Instance (công trình) | `<chunk>/<tên>` | `c-1_-1/safehouse` |
| Thực thể trong prefab | `<instance>/<localId>` | `c-1_-1/safehouse/door`, `c0_0/house/lamp-living` |
| Object rời | `<chunk>/objects/<tên>` | `c-1_0/objects/park-toolbox` |
| Đường, zone, spawn | `<chunk>/roads\|zones\|spawns/<tên>` | `c-1_-1/zones/cross`, `c-1_-1/spawns/player-start` |
| Cấp world | `world/<tên>` | `world/boundary-n` |

- Tên và `localId` là slug: chữ thường, số, gạch nối (`^[a-z0-9]+(-[a-z0-9]+)*$`). `objects`, `roads`, `zones`, `spawns` là tên dành riêng, không đặt cho instance.
- **Quyết định M1 về đổi chunk sở hữu (cách 1 trong kế hoạch):** đoạn chunk trong ID là *chunk định danh*, được ghi thẳng trong ID và **không đổi** khi record chuyển sang chunk khác. Sau khi chuyển, ID vẫn giữ nguyên, save vẫn khớp, và validator chỉ đòi ID phải duy nhất toàn world. Editor (M3–M4) phải chuyển record giữa các file chunk nhưng giữ nguyên ID; nhân bản mới tạo ID mới theo chunk đích.
- Không sinh ID từ chỉ số mảng, vị trí hay thời điểm export; không dùng lại ID của thực thể đã xóa.

## 5. Phiên bản

| Trường | Ý nghĩa |
|---|---|
| `schemaVersion` (world/prefab/chunk) | Cấu trúc JSON; hiện là 1, khác 1 thì báo `unsupported-schema` |
| `contentVersion` (world, từng prefab/chunk) | Bản sửa nội dung; manifest ghim phiên bản prefab (`version-mismatch` nếu lệch) |
| Save `schemaVersion` 8 + `contentVersion` | Save ghi lại bản nội dung nó được tạo ra; khác bản hiện tại → `incompatible` (chưa có migration nội dung nào) |

`contentVersion` chỉ để phát hiện khác biệt, không tự chứng minh tương thích. Muốn đổi bố cục khu phố thì tăng `contentVersion` và viết migration nội dung, nếu có trạng thái đã lưu bị ảnh hưởng.

## 6. Tài liệu JSON

**world.json**: `schemaVersion, worldId, name, contentVersion, chunkSize, coordinateSystem, playArea { size }, boundary { height, thickness } | null, chunkBounds { minCx, maxCx, minCz, maxCz }` (tính cả biên), `chunks [{ chunkId, cx, cz, path }]`, `prefabs [{ prefabId, contentVersion, path }]`, `playerSpawn` (ID spawn), `gameplay? { maxActiveZombies? }`.

**Prefab**: `schemaVersion, prefabId` (vd. `building/store`), `contentVersion, name, pivot {x,y,z}, footprint {minX,minZ,maxX,maxZ}`, `building? { height, wallThickness, wallColor, roofColor, floorColor }` (có thì là nhà: sàn, mái, ánh sáng), `objects[]`, `rooms[]`. Các object phân biệt bằng `kind`:

| kind | Trường | Runtime |
|---|---|---|
| `wall` | `localId, position {x,y,z}` (tâm hộp), `size [x,y,z], color` | collider tĩnh, ô nav bị chặn (trừ phần trên cao ≥ 1,6 m), vật chắn tầm nhìn khi cao |
| `prop` | như `wall` | như `wall`; tách layer riêng cho editor |
| `container` | như hộp + `name, lootTableId?` | container có loot (seed theo ID ổn định) |
| `door` | `localId, name, position {x,z}` (tâm khe cửa), `quarterTurns, width, openTowards ±1, initialState?` | khung q = 0: tường chạy theo X, bản lề ở x = −width/2, cánh đóng hướng +X, mở về phía Z = `openTowards`; cao `DOOR_HEIGHT` |
| `window` | `localId, name, position {x,z}, quarterTurns, width, sill, head, thickness` | q = 0: kính chạy theo X, phía trong nhà là +Z |

Room: `localId, name, bounds`, `lamp? { localId, name, intensity 0..1, color, requiresElectricity, switchAt {x,z}, at? {x,z} }`. Trần nhà = `building.height`.

**Chunk**: `schemaVersion, contentVersion, chunkId, cx, cz`, `instances [{ instanceId, prefabId, position {x,y,z}, quarterTurns }]`, `objects` (wall/prop/container, có `objectId`), `roads [{ roadId, position, size [x,z], color }]`, `zones [{ zoneId, kind: "zombiePopulation", name, shape: "circle", center, radius }]`, `spawns [{ spawnId, kind: "player"|"zombie", position }]`, `externalRefs`.

- Không có mảng `terrain`: mặt đất vẫn là một mặt phẳng cấp world như trước.
- Zone chỉ có hình tròn, vì đó là loại duy nhất horde director dùng. Zone chồng nhau được phép: zombie thuộc zone có tâm gần nhất (luật `nearestZone` có từ trước).
- Chưa có `assetId`/asset registry: mọi thứ vẫn là hộp tô màu, chưa có model để ánh xạ.

File được ghi bằng `formatJson`: giữ thứ tự khóa, và object/mảng nào ngắn thì nằm trên một dòng, để diff dễ đọc.

## 7. Kiểm tra (validator)

Dùng chung cho runtime loader, test và CLI (`npm run map:check`). Mỗi lỗi ghi rõ `severity, code, message, path` (dạng `chunks/c0_0.json#/instances/2/position`) và `entityId`. Runtime gặp lỗi thì ném `MapContentError`, **không** lùi về map mặc định.

- **Lỗi** (chặn nạp/export): `unsupported-schema`, `schema`, `not-finite`, `out-of-range`, `invalid-rect`, `invalid-id`, `invalid-path`, `missing-file`, `duplicate-id`, `manifest-mismatch`, `version-mismatch`, `unknown-kind`, `unknown-prefab`, `unknown-loot-table`, `rooms-need-building`, `chunk-outside-bounds`, `owner-mismatch`, `missing-external-ref`, `stale-external-ref`, `missing-player-spawn`, `spawn-outside-play-area`, `spawn-blocked` (spawn cách một collider thấp dưới 0,4 m).
- **Cảnh báo**: `building-no-entrance`, `outside-footprint`, `outside-play-area`.
- Chưa kiểm tra (để M6): khả năng đi tới được và nav bị tách vùng, collider chồng nhau, zone quá dày.

## 8. Save

- Save v8 dùng ID ổn định và ghi `contentVersion`.
- Save v1–v7 được kiểm tra và migrate bằng **map cũ đóng băng** (`migrations/legacy-v7-map.json`, đúng bản trước M2). Nhờ vậy các bước migrate cũ và các hằng `CONTAINERS_ADDED_V3/V5`, `DOORS_ADDED_V7`, `WALL_PREFIXES_ADDED_V7` (nay ở `world/legacyContent.ts`) chạy y như trước.
- Bước v7 → v8 đổi tên qua `migrations/legacy-v7-ids.json` cho cửa, container cố định, rèm (cửa sổ), đèn, zone của zombie và cửa đang bị vây, rồi xếp lại theo thứ tự map.
- Túi đồ rơi giữ ID `drop:…`. ID inventory và item **không đổi**, nên vật phẩm vẫn mang tên tủ cũ, ví dụ `loot:…:ct-safehouse-closet:1`. Việc này không ảnh hưởng gì vì ID chỉ cần duy nhất.
- ID không có trong bảng thì giữ nguyên, nên bước kiểm tra v8 sẽ từ chối save đó; không có dữ liệu nào bị bỏ im lặng.
- Storage lưu bản gốc vào `slot-1.backup-v7` như các lần nâng cấp trước.

## 9. Công cụ

- `npm run map:check [thư-mục-world…]`: kiểm tra content trên đĩa. Cần Node ≥ 22.18 vì dùng TypeScript stripping có sẵn; các module `src/map/*` import bằng đuôi `.ts` để chạy trực tiếp.
- `node scripts/map-tools/import-legacy.ts <legacy-map.json> <world-dir> --world-id … --name …`: chuyển một `MapData` viết tay thành prefab + chunk + bảng ID. Khu phố được sinh bằng lệnh này từ `legacy-v7-map.json`, và test khóa lại rằng file đã commit đúng là output của lệnh, chừng nào `contentVersion` còn là 1.
- `src/map/tools/tileWorld.ts`: generator ghép ô N × N rồi phân lại vào lưới chunk; map stress `?stress=N` (chỉ dev) dùng nó. Bundle production không chứa generator và importer.
