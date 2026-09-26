# Định dạng nội dung map (schema v1)

Hợp đồng dữ liệu giữa content (JSON), runtime và editor sau này. Áp dụng từ M1–M2 của `Map_Editor_Implementation_Plan.md` (xem báo cáo `docs/map-editor-m1-m2.md`). Mã nguồn: `src/map/`.

## 1. Thư mục

```text
content/maps/<worldId>/
  world.json                 manifest + chỉ mục chunk/prefab
  prefabs/<name>.json        prefab (tọa độ cục bộ)
  chunks/c<cx>_<cz>.json     layout của một chunk (tọa độ cục bộ chunk)
  migrations/                dữ liệu cho save cũ (map đóng băng + bảng ID cũ → ID ổn định)
  migrations/content-v<N>.json  M8: chuyển save của nội dung vN sang vN+1 (tập ID có trạng thái của vN + đổi tên)
```

Game nạp mọi JSON dưới `content/maps/` bằng `import.meta.glob` (Vite gộp vào bundle, vitest đọc cùng cách). Streaming sau này thay nguồn đọc bằng fetch theo chunk, giữ nguyên hợp đồng `read(path)`.

## 2. Tọa độ và đơn vị

- 1 đơn vị = 1 m; Y hướng lên; mặt đất là XZ (`coordinateSystem: "y-up-xz-meters"`).
- Vùng chơi là hình chữ nhật `playArea.size` (X) × `playArea.depth` (Z, mặc định bằng `size`) quanh `playArea.center` (mặc định gốc tọa độ). Từ M7 nó có thể lệch tâm; NavGrid, mặt đất, hàng rào biên, kiểm tra spawn và kiểm tra túi đồ rơi trong save đều dùng hình chữ nhật này (`playAreaRect`, `mapBounds`).
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
- **ID đã xóa** (`world.json` → `retiredIds`, tùy chọn, sắp xếp): editor ghi ID của record bị xóa vào đây và không cấp lại; validator báo `retired-id-reused` nếu record còn sống dùng một ID trong danh sách (M3).
- **Quyết định M1 về đổi chunk sở hữu (cách 1 trong kế hoạch):** đoạn chunk trong ID là *chunk định danh*, được ghi thẳng trong ID và **không đổi** khi record chuyển sang chunk khác. Sau khi chuyển, ID vẫn giữ nguyên, save vẫn khớp, và validator chỉ đòi ID phải duy nhất toàn world. Editor (M3–M4) phải chuyển record giữa các file chunk nhưng giữ nguyên ID; nhân bản mới tạo ID mới theo chunk đích.
- Không sinh ID từ chỉ số mảng, vị trí hay thời điểm export; không dùng lại ID của thực thể đã xóa.

## 5. Phiên bản

| Trường | Ý nghĩa |
|---|---|
| `schemaVersion` (world/prefab/chunk) | Cấu trúc JSON; hiện là 1, khác 1 thì báo `unsupported-schema` |
| `contentVersion` (world, từng prefab/chunk) | Bản sửa nội dung; manifest ghim phiên bản prefab (`version-mismatch` nếu lệch) |
| Save `schemaVersion` 9 + `contentVersion` (v9 = M11b: `y` là độ cao chân) | Save ghi lại bản nội dung nó được tạo ra. Bản cũ hơn đi qua chuỗi migration nội dung (M8, `migrations/content-v<N>.json`); thiếu một bước hoặc save mới hơn nội dung → `incompatible` |

`contentVersion` chỉ để phát hiện khác biệt, không tự chứng minh tương thích. Khi thêm, bỏ hoặc đổi tên ID có trạng thái (cửa, container cố định, cửa sổ, đèn, zone), tăng `contentVersion` kèm một migration nội dung; editor tạo nó (Inspector → World → Tương thích save).

**Migration nội dung** `migrations/content-v<N>.json` (M8, `src/map/contentMigration.ts`):

```json
{
  "format": "zombie-outbreak/content-migration",
  "fromVersion": 1,
  "toVersion": 2,
  "ids": { "doors": [...], "containers": [{ "id": "…", "position": { "x": 0, "z": 0 } }], "windows": [...], "lamps": [...], "zones": [...] },
  "renamed": { "c0_0/house/lamp-living": "c0_0/house/lamp-lounge" }
}
```

- `ids` là mọi ID có trạng thái của bản N, xếp theo tên; container kèm vị trí world. Save của bản N được kiểm tra đúng như với map của nó.
- `renamed`: ID cũ → ID mới **cùng loại** thì nhận trạng thái của ID cũ. Nguồn phải là ID đã bị bỏ, đích phải là ID mới, và mỗi đích chỉ dùng một lần.
- Phần bị bỏ hoặc được thêm suy ra từ `ids`, `renamed` và ID của bản sau (`ids` của file kế tiếp, hoặc nội dung hiện tại), nên file không cũ đi khi sửa tiếp. ID đã xóa không bao giờ được cấp lại (`retiredIds`, `retiredLocalIds`), nên nhiều bước ghép lại vẫn an toàn.

## 6. Tài liệu JSON

**world.json**: `schemaVersion, worldId, name, contentVersion, chunkSize, coordinateSystem, playArea { size, depth?, center? {x,z} } (M7: bỏ `depth`/`center` khi là hình vuông tâm gốc), boundary { height, thickness } | null, chunkBounds { minCx, maxCx, minCz, maxCz }` (tính cả biên), `chunks [{ chunkId, cx, cz, path }]`, `prefabs [{ prefabId, contentVersion, path }]`, `playerSpawn` (ID spawn), `listed?: boolean` (mặc định true; `false` ẩn world khỏi menu chọn world của game, vẫn mở được bằng `?world=`; không ảnh hưởng save), `gameplay? { maxActiveZombies? }`, `retiredIds? [string]` (M3), `generator? { name, version, seed, params, catalog }` (M6: truy vết world sinh tự động; `map:generate` dùng để phát hiện sửa tay).

**Prefab**: `schemaVersion, prefabId` (vd. `building/store`), `contentVersion, name, pivot {x,y,z}, footprint {minX,minZ,maxX,maxZ}`, `outline? [{x,z}]` (M11a: nhà chữ L/T/U, đa giác vuông góc trên đường tâm tường; `footprint` = khung bao của nó; sàn, mái, phép thử trong nhà theo outline), `building? { height, storeys?, wallThickness, wallColor, roofColor, floorColor }` (có thì là nhà: sàn, mái, ánh sáng; M11b: `height` là chiều cao một tầng, `storeys` 1–4, mỗi tầng trên có tấm sàn phủ footprint/outline, khoét lỗ cầu thang; mái trên tầng cao nhất), `objects[]`, `rooms[]`. Các object phân biệt bằng `kind`:

| kind | Trường | Runtime |
|---|---|---|
| `wall` | `localId, position {x,y,z}` (tâm hộp), `size [x,y,z], color` | collider tĩnh, ô nav bị chặn (trừ phần trên cao ≥ 1,6 m), vật chắn tầm nhìn khi cao |
| `prop` | như `wall` | như `wall`; tách layer riêng cho editor |
| `container` | như hộp + `name, lootTableId?` | container có loot (seed theo ID ổn định) |
| `door` | `localId, name, position {x,z}` (tâm khe cửa), `quarterTurns, width, openTowards ±1, initialState?` | khung q = 0: tường chạy theo X, bản lề ở x = −width/2, cánh đóng hướng +X, mở về phía Z = `openTowards`; cao `DOOR_HEIGHT` |
| `window` | `localId, name, position {x,z}, quarterTurns, width, sill, head, thickness` | q = 0: kính chạy theo X, phía trong nhà là +Z |
| `tree` (M9) | `localId, position {x,z}, height 2..20, canopy 0.5..8` (bán kính tán), `trunk 0.1..1` (bán kính thân, nhỏ hơn tán), `color` (màu tán), `style: "round"\|"pine"` | thân là một wall cùng ID (`trunkWall`): collider, chặn nav và tầm nhìn zombie như cái cột; tán chỉ để vẽ (batch theo chunk) và mờ đi khi che người chơi như mái; không xoay |
| `wallRun` (M5) | `localId, from {x,z}, to {x,z}` (song song X hoặc Z, trên đường tâm tường), `height, thickness, color` | resolver tách thành hộp tường, khoét khe ở mỗi cửa/cửa sổ cùng prefab nằm trên nó (cùng trục, tâm trên tường), thêm lanh tô trên cửa (từ `DOOR_HEIGHT`) và bệ/đầu cửa sổ; kéo dài nửa độ dày ở hai đầu để kín góc. Mảnh có ID dẫn xuất `<entity>#<phần>`, không có trạng thái |

**Tầng (M11b)**: `level?` (0 = tầng trệt) trên `wall`, `prop`, `container`, `door`, `window`, `wallRun`, `stairs` và phòng; resolver nâng lên `level · building.height`, tường chạy chỉ khoét cửa cùng tầng. Object `stairs { localId, level?, position {x,z}, quarterTurns, width 1–4, length 2–12 }`: ở hướng 0° leo theo +X, lên một tầng; resolver dựng tường hai bên (tới lan can 1 m ở tầng trên), tường dưới đầu trên (cao bằng cửa), lan can ngang đầu dưới ở tầng trên (ID phái sinh `#side-a`, `#side-b`, `#back`, `#rail`) và khoét lỗ trong tấm sàn tầng trên. Runtime: `MapData.floors` (tấm sàn), `MapData.stairs`.

Room: `localId, name, level?` (M11b: tầng, mặc định 0), `bounds`, `outline? [{x,z}]` (M11a: phòng chữ L/T/U; `bounds` = khung bao; ánh sáng và phép thử trong phòng theo outline; đèn mặc định ở tâm mảnh chữ nhật lớn nhất), `lamp? { localId, name, intensity 0..1, color, requiresElectricity, switchAt {x,z}, at? {x,z} }` (`at`: vị trí đèn trên trần, mặc định tâm phòng; M7 sửa được trong editor, ánh sáng vẫn tính theo cả phòng). Trần nhà = `building.height`.

`retiredLocalIds?` (M5, sắp xếp): local ID đã xóa/đổi tên trong prefab editor; không cấp lại, dùng lại là lỗi `retired-id-reused`.

**Chunk**: `schemaVersion, contentVersion, chunkId, cx, cz`, `instances [{ instanceId, prefabId, position {x,y,z}, quarterTurns }]`, `objects` (wall/prop/container/tree, có `objectId`), `roads [{ roadId, position, size [x,z], color, layer? 0..4 }]` (M7: `layer` là thứ tự vẽ, lớp cao nằm trên chỗ chồng nhau, mỗi lớp cao hơn 1 mm và luôn dưới sàn nhà; mặc định 0, không ghi), `zones [{ zoneId, kind: "zombiePopulation", name, shape: "circle", center, radius } | { …, shape: "rect", center, size [x,z] }]`, `spawns [{ spawnId, kind: "player"|"zombie", position }]`, `externalRefs`.

- Không có mảng `terrain`: mặt đất vẫn là một mặt phẳng cấp world như trước.
- Zone chỉ có loại `zombiePopulation` (loại duy nhất có consumer: horde director), hình tròn hoặc chữ nhật (M4). Zone chồng nhau được phép. Luật gán (`game/world/zones.ts`, dùng chung cho runtime và validator): điểm nằm trong zone chữ nhật thuộc zone chữ nhật nhỏ nhất chứa nó, nếu không thì thuộc zone có tâm gần nhất (luật S5; map chỉ có zone tròn không đổi hành vi). Zone chữ nhật lang thang trong hình chữ nhật.
- Chưa có `assetId`/asset registry: mọi thứ vẫn là hộp tô màu, chưa có model để ánh xạ.

File được ghi bằng `formatJson`: giữ thứ tự khóa, và object/mảng nào ngắn thì nằm trên một dòng, để diff dễ đọc.

## 7. Kiểm tra (validator)

Dùng chung cho runtime loader, test và CLI (`npm run map:check`). Mỗi lỗi ghi rõ `severity, code, message, path` (dạng `chunks/c0_0.json#/instances/2/position`) và `entityId`. Runtime gặp lỗi thì ném `MapContentError`, **không** lùi về map mặc định.

- **Lỗi** (chặn nạp/export): `unsupported-schema`, `schema`, `not-finite`, `out-of-range`, `invalid-rect`, `invalid-id`, `invalid-path`, `missing-file`, `duplicate-id`, `manifest-mismatch`, `version-mismatch`, `unknown-kind`, `unknown-prefab`, `unknown-loot-table`, `rooms-need-building`, `chunk-outside-bounds`, `owner-mismatch`, `missing-external-ref`, `stale-external-ref`, `missing-player-spawn`, `spawn-outside-play-area`, `spawn-blocked` (spawn cách một collider thấp dưới 0,4 m), `retired-id-reused`, `invalid-outline` (M11a: outline dưới 4 đỉnh, có cạnh chéo/dài 0, cạnh cắt nhau hoặc không có diện tích), `outline-bounds` (khung chữ nhật khác khung bao của outline), M11b: `storey-height` (nhà nhiều tầng cần tầng cao ≥ 2,6 m), `stairs-need-storeys`, `stairs-too-steep` (dốc hơn 45°), `level-not-allowed` (cây hoặc object trong chunk có `level`); `level` ngoài số tầng là `out-of-range`.
- `checkWorldDocuments` là bản không ném lỗi của `loadWorldDocuments` (editor dùng cho bảng Validate và bản nháp).
- Cây (M9): `height`, `canopy`, `trunk` ngoài khoảng hoặc thân không nhỏ hơn tán → `out-of-range`; `style` khác `round`/`pine` → `schema`. Spawn trên thân cây → `spawn-blocked` như mọi collider thấp.
- **Migration nội dung** (M8): `content-migration` (file sai dạng, lỗi), `content-migration-rename` (đổi tên không khớp bản sau, lỗi), `content-migration-missing` (thiếu bước vN → vN+1: save vN sẽ không nạp được, cảnh báo).
- **Cảnh báo**: `building-no-entrance`, `outside-footprint`, `outside-play-area`, `zone-assignment` (spawn zombie nằm trong một zone nhưng theo luật thuộc zone khác), `surface-overlap` (hai mặt nền khác màu **cùng lớp** chồng nhau, sẽ nhấp nháy; M7: đặt lớp khác để hết) — hai cái sau từ M4; `lamp-outside-room` (M7: đèn `at` nằm ngoài phòng của nó). M11a: `outside-footprint` và `lamp-outside-room` theo outline khi có. M11b: `stairs-outside-footprint` (cầu thang cộng 0,9 m chỗ bước lên/xuống ở hai đầu không nằm gọn trong nhà); deep check `stairs-unusable`.
- **Kiểm tra sâu** (M6, `src/map/analysis.ts`, cảnh báo): `interaction-unreachable`, `spawn-unreachable`, `spawn-indoors`, `zone-unreachable`, `start-not-walkable`, `collider-overlap`, `container-outside-room`. Dùng NavGrid/interactable/LOS của game nên chạy trong editor, test và `npm run map:check -- --deep` (qua Vite), không trong validator Node thuần. Chưa có: zone quá dày.

## 8. Save

- Save v8 dùng ID ổn định và ghi `contentVersion`. Save v9 (M11b): `y` của mọi vị trí (người chơi, zombie, ký ức, túi đồ rơi) là độ cao chân; bước v8 → v9 đưa về 0 (trước đó chỉ có một tầng).
- Save v1–v7 được kiểm tra và migrate bằng **map cũ đóng băng** (`migrations/legacy-v7-map.json`, đúng bản trước M2). Nhờ vậy các bước migrate cũ và các hằng `CONTAINERS_ADDED_V3/V5`, `DOORS_ADDED_V7`, `WALL_PREFIXES_ADDED_V7` (nay ở `world/legacyContent.ts`) chạy y như trước.
- Bước v7 → v8 đổi tên qua `migrations/legacy-v7-ids.json` cho cửa, container cố định, rèm (cửa sổ), đèn, zone của zombie và cửa đang bị vây, rồi xếp lại theo thứ tự map.
- Túi đồ rơi giữ ID `drop:…`. ID inventory và item **không đổi**, nên vật phẩm vẫn mang tên tủ cũ, ví dụ `loot:…:ct-safehouse-closet:1`. Việc này không ảnh hưởng gì vì ID chỉ cần duy nhất.
- ID không có trong bảng thì giữ nguyên, nên bước kiểm tra v8 sẽ từ chối save đó; không có dữ liệu nào bị bỏ im lặng.
- Storage lưu bản gốc vào `slot-1.backup-v7` như các lần nâng cấp trước.
- Bảng legacy đưa save tới **nội dung v1** (`LEGACY_CONTENT_VERSION`). Bản nội dung sau đó đi tiếp qua migration nội dung, nên save v1–v7 vẫn nạp được sau khi khu phố đổi bố cục.
- **Migration nội dung** (M8, `migrateContent` trong `save.ts`). Save v8 của bản N < hiện tại được kiểm tra với `ids` của bước N, rồi chuyển qua mọi bước:
  - cửa, container, rèm, đèn, zone còn lại hoặc được đổi tên giữ trạng thái;
  - cửa mới ở trạng thái ban đầu, rèm mở, đèn tắt; container mới có loot theo hash(worldSeed, id), giống New Game;
  - container bị bỏ: mỗi vật phẩm thành một túi `drop:<itemId>` tại chỗ tủ cũ (ID vật phẩm giữ nguyên);
  - zombie của zone bị bỏ theo luật `zoneFor`; zombie đang vây một cửa bị bỏ chuyển sang `SEARCH`;
  - người chơi, zombie và túi đồ bị vật cản mới che được dời ra cạnh vật cản và vào trong vùng chơi.
  - Kết quả được kiểm tra lại như một save của bản hiện tại. Bản gốc lưu ở `<slot>.backup-v<save>-content-v<N>` (vd. `backup-v9-content-v1`); menu hiện thông báo bản đồ đã cập nhật.

## 9. Công cụ

- `npm run map:check [thư-mục-world…]`: kiểm tra content trên đĩa. Cần Node ≥ 22.18 vì dùng TypeScript stripping có sẵn; các module `src/map/*` import bằng đuôi `.ts` để chạy trực tiếp.
- `node scripts/map-tools/import-legacy.ts <legacy-map.json> <world-dir> --world-id … --name …`: chuyển một `MapData` viết tay thành prefab + chunk + bảng ID. Khu phố được sinh bằng lệnh này từ `legacy-v7-map.json`, và test khóa lại rằng file đã commit đúng là output của lệnh, chừng nào `contentVersion` còn là 1.
- `npm run map:unpack -- <pack.json> [--out <dir>] [--force] [--world-id <id> [--name <tên>]]`: ghi content pack của editor vào `content/maps/<worldId>/` sau khi validate; cần `--force` để ghi đè; file dữ liệu không đổi thì không ghi lại; file thừa trên đĩa chỉ được báo. `--world-id` ghi pack thành world mới (`forkDocument` trong `src/map/editor/document.ts`, như nút Lưu thành… của editor): `worldId`/tên mới, `contentVersion` 1, bỏ `migrations/…` và `generator` của world gốc, chunk/prefab/ID giữ nguyên. `npm run map:pack -- <world-dir> [out.json]` làm chiều ngược lại.
- Content pack (`<worldId>.mappack.json`): `{ format: "zombie-outbreak/map-pack", formatVersion: 1, worldId, files: { <đường dẫn tương đối>: <JSON> } }`, thứ tự ổn định, không chứa trạng thái editor. Chi tiết editor: `docs/map-editor-m3.md` … `docs/map-editor-m6.md`, hướng dẫn `docs/map-editor-guide.md`.
- `npm run map:generate -- --seed <n> --blocks <X>x<Z> [--world-id …] [--out …] [--pack …] [--force] [--dry]` (M6): generator thị trấn tất định `src/map/tools/generator.ts`; không ghi đè world đã sửa tay. `npm run map:check -- --deep`: thêm kiểm tra sâu. Hướng dẫn: `docs/map-editor-guide.md`.
- `src/map/tools/tileWorld.ts`: generator ghép ô N × N rồi phân lại vào lưới chunk; map stress `?stress=N` (chỉ dev) dùng nó. Bundle production không chứa generator và importer.
