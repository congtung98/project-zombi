# World generator WG4: tích hợp vào Map Editor

Ngày 27/09/2026. Sprint thứ tư của World Map Generator (`docs/writing-block.md` §10–§11, quyết định Q1–Q9 ở `docs/world-generator-wg1.md` §0). Nhánh `feature/world-generator`.

- Lộ trình: WG1 → WG2 → WG3 → **WG4** → WG5 môi trường, lưu trữ, hiệu năng → WG6 ảnh tham chiếu + vẽ tay.
- **Không đổi**: save game (v9), schema map (v1), `contentVersion` và nội dung các world hiện có, runtime game.
- **Có thêm**, đều là phần mở rộng của editor sẵn có (không có editor mới):
  - tab **Generator** trong bảng trái;
  - công cụ chọn lô;
  - lớp phủ layout trong viewport;
  - mục **Generator** trong Inspector;
  - kiểu **Từ GeoJSON** trong hộp thoại Mới.

## 1. Tiêu chí nghiệm thu

| # | Tiêu chí (§10, §11, Q2, Q3) | Kết quả |
|---|---|---|
| C1 | Import reference | Đạt: Mới → Từ GeoJSON. File đọc tại máy, không gọi mạng (Q4); tùy chọn cắt vùng, chế độ, kiểu lô, seed |
| C2 | Preview layout / mạng đường / ranh giới lô | Đạt: lớp phủ gồm đường gốc, mạng đã nắn, lô theo trạng thái, khối, nước/đường sắt/cấm xây; tải SVG |
| C3 | Generate world, LAYOUT_ONLY và FULL | Đạt: khi tạo từ GeoJSON, và khi sinh lại (đổi chế độ) |
| C4 | Regenerate selected parcel; SELECTIVE_REGENERATION theo lô hoặc chunk, bảo vệ object khóa | Đạt: "Sinh lại lô", "Sinh lại chunk"; lô khóa bị từ chối hoặc bỏ qua |
| C5 | Replace prefab (không co giãn, không đổi đường) | Đạt: danh sách chỉ gồm prefab vừa lô; lệch zone thì ghi chú |
| C6 | Lock / unlock object | Đạt: lô (và công trình trên lô), record đường/zone/spawn |
| C7 | Change seed (và kiểu lô) | Đạt: xem trước rồi Áp dụng / Hủy |
| C8 | Undo/redo qua hệ thống hiện có | Đạt: mỗi thao tác generator là một command trong lịch sử |
| C9 | Save generated world | Đạt: Lưu nháp, Export, Lưu thành… và `map:unpack` mang theo layout |
| C10 | Phân biệt generated / manual / locked generated; modified ≠ locked (Q2) | Đạt: manifest hash; 4 trạng thái hiển thị, màu viền lô |
| C11 | Object sửa tay được bảo vệ khỏi regenerate ngoài ý muốn; không xóa/ghi đè dữ liệu editor khi người dùng chưa thao tác rõ ràng | Đạt: mặc định giữ object sửa tay, ghi đè phải tick; object đặt tay không bao giờ bị đụng; sinh lại world phải xem trước |
| C12 | Q3: không regenerate world đã phát hành | Đạt: world trong `content/maps` chỉ xem và khóa; Lưu thành… để có bản chưa phát hành |
| C13 | Game không nạp layout; bundle game không có code generator | Đạt: glob game bỏ `layout/**`; `check:bundle` có marker mới |

## 2. Layout nằm cùng world (`src/map/layout/worldSync.ts`)

- World sinh từ layout mang theo file **`layout/world-layout.json`**. File gồm:
  - `WorldLayout` (lớp nguồn và lớp đã nắn);
  - `plan` (lô và công trình);
  - **manifest** `generated` (mục 3).
- Đây là file "extra" của world folder, giống `migrations/…`. Vì vậy editor tự giữ nó trong document, và mọi thứ sau đều mang theo mà không cần code riêng:
  - lịch sử undo/redo;
  - bản nháp IndexedDB của editor;
  - Export pack, `map:unpack`, `map:pack`;
  - Lưu thành… (`forkDocument` chỉ bỏ `migrations/`).
- Game không bao giờ đọc file này:
  - loader chỉ đọc `world.json`, prefab, chunk;
  - glob content của game (`src/map/bundledFiles.ts`) loại `content/maps/*/layout/**`, nên world sinh ra tải xuống đúng bằng world làm tay;
  - editor đọc các file này qua glob riêng `src/editor/layoutFiles.ts`.
- `layout:plan --pack` (CLI) cũng ghi file này, nên pack làm bằng CLI mở trong editor là dùng được tab Generator ngay.
- Validate: `checkWorldLayout` kiểm tra thêm cấu trúc của `generated`. Layout hỏng thì tab Generator báo lỗi và không làm gì.

## 3. Manifest và trạng thái (Q2)

`GeneratedManifest`:

| Trường | Nội dung |
|---|---|
| `mode` | chế độ sinh |
| `catalog` | thư viện prefab dùng khi sinh |
| `playArea` | vùng chơi lúc sinh |
| `records[]` | mỗi record generator đã ghi: `id`, chunk sở hữu, `hash` = cyrb53 của chunk + JSON chuẩn hóa (khóa sắp xếp), `parcel` (công trình) hoặc `block` (zone, spawn zombie) |
| `locked[]` | record khóa riêng: đường, zone, spawn |
| `rolls` | bộ đếm salt cho sinh lại chọn lọc, để cùng chuỗi thao tác cho cùng kết quả |

`generatorStatus(doc, layout)` cho mỗi record:

- **generated** (sinh tự động): hash khớp.
- **modified** (sửa tay): hash lệch (di chuyển, xoay, đổi trường, chuyển chunk), đã xóa, hoặc công trình do người chọn tay (`build.source = manual`). Di chuyển về đúng chỗ cũ thì record lại là generated.
- **locked** (khóa): lô của record bị khóa (`LayoutParcel.locked`), hoặc record nằm trong `locked[]`. Khóa và sửa tay độc lập với nhau (một record có thể vừa khóa vừa sửa tay).
- **manual** (thủ công): record không có trong manifest, tức là đặt tay.

Trạng thái lô dùng để tô viền trong viewport:

| Trạng thái | Màu |
|---|---|
| sinh tự động | xanh lá |
| sửa tay | hồng |
| khóa | xanh dương |
| lô trống | xám |
| đất trống / bên trong | xanh rêu |

## 4. Sinh lại (`syncGenerated`)

Mọi thao tác đều theo cùng một hàm thuần: document → document mới. Các bước:

1. Tính kế hoạch mới.
2. `buildLayoutWorld` ra world mới.
3. Trộn world mới vào document theo quy tắc dưới.
4. Cập nhật layout và manifest.

Lỗi thì document giữ nguyên.

| Thao tác | Kế hoạch | Được đổi |
|---|---|---|
| `world` (seed, kiểu lô, chế độ) | Cùng tham số: giữ nguyên lô, chỉ chọn lại công trình trên lô không được giữ. Khác tham số: `planLayout` với `keep` = lô khóa + lô chọn tay + lô có công trình sửa tay (bỏ hai loại sau nếu ghi đè) | mọi record generated; record sửa tay chỉ khi tick "ghi đè" |
| `parcels` (Sinh lại lô) | `placeBuildings` cho các lô đó. Một lô thì thử lại tới 8 salt đến khi ra công trình khác | công trình trên lô (kể cả khi đã sửa tay, vì đây là thao tác chỉ đích danh) + zone/spawn zombie của khối, để spawn tránh nhà mới |
| `chunks` | lô có tâm trong chunk, trừ lô khóa và lô sửa tay (trừ khi ghi đè) | như trên |
| `prefab` (Thay prefab) | `setParcelPrefab`: phải vừa lô, không co giãn | công trình trên lô |
| `revert` (Khôi phục bản sinh) | giữ nguyên | các record được chỉ định; record đã xóa được thêm lại và bỏ khỏi `retiredIds` (world chưa phát hành, không có save nào giữ nó) |
| `lock` | cờ `locked` của lô / `locked[]` | không record nào; chunk giữ nguyên object |

Quy tắc trộn:

- **Khóa**: không bao giờ đổi.
- **Thủ công**: không bao giờ đổi.
  - Nếu một record đặt tay giữ đúng ID mà generator cần, generator bỏ qua ID đó và báo `conflicts`.
  - Riêng trường hợp record đó giống hệt bản generator sinh ra, nó được nhận lại là generated.
- **Record generated đã biến mất khỏi kết quả mới**: bị bỏ, và ID không bị đưa vào `retiredIds`.
- **Prefab**: prefab mới được chép từ thư viện. Nếu world đã có bản riêng của prefab (đã sửa trong world), bản của world được dùng, cả khi đặt lẫn khi dựng.
- **Vùng chơi**: đi theo kế hoạch, trừ khi đã sửa tay.
- **Điểm xuất phát**: đi theo kế hoạch nếu record cũ không còn.
- **Chồng lấn**: công trình mới chồng lên object đặt tay thì có cảnh báo `manual-overlap`; object đặt tay vẫn được giữ.

## 5. Trong editor

- **Mới → Từ GeoJSON (World Generator)**:
  - chọn file, cắt vùng (không cắt, 250, 500, 1000 m), chế độ, kiểu lô, seed;
  - kết quả là world chưa phát hành (không có baseline), mở sẵn tab Generator;
  - lỗi nắn mạng đường thì bị từ chối với thông báo rõ. Ví dụ: cắt fixture ở 250 m làm hai nút đường nắn trùng một điểm (Q1).
- **Tab Generator**:
  - **Tóm tắt**: nguồn, số cạnh/khối/lô, chế độ, thư viện, seed, ghi công OSM, số record theo trạng thái.
  - **Hiển thị**: các lớp phủ, chú giải màu, tải SVG.
  - **Lô đang chọn**:
    - trạng thái, zone, kích thước, mặt tiền, chunk, công trình;
    - Sinh lại lô, Khóa/Mở khóa lô, Khôi phục bản sinh;
    - Thay prefab: danh sách prefab vừa lô, "(không có công trình)";
    - Sinh lại chunk, kèm tùy chọn ghi đè lô sửa tay.
  - **Sinh lại world**: seed, kiểu lô, chế độ, ghi đè → **Xem trước** (viewport hiện kết quả, bảng hiện thay/thêm/bỏ/giữ) → **Áp dụng** (một command) hoặc **Hủy**. Bản xem trước tự hết hạn khi document đổi.
  - **Lần chạy gần nhất** và **Cảnh báo của layout**: click một cảnh báo có tọa độ để tới chỗ đó.
- **Công cụ chọn lô** (tự bật trong tab Generator):
  - click để chọn lô; công trình trên lô trở thành vùng chọn;
  - Esc bỏ chọn;
  - chuột phải/giữa để kéo khung nhìn như thường.
- **Inspector**: mọi record của world sinh từ layout có dòng **Generator** (trạng thái), cùng các nút tới lô, Khóa/Mở khóa, Khôi phục bản sinh.
- **Q3**:
  - world có trong `content/maps` thì tab hiện thông báo và chặn mọi thao tác đổi nội dung;
  - khóa/mở khóa vẫn được, vì chỉ đổi layout;
  - Lưu thành… một worldId mới cho ra bản chưa phát hành để sinh lại.

## 6. Cách dùng

1. Editor (`npm run dev` → `/editor.html`) → **Mới** → Kiểu: *Từ GeoJSON* → chọn file (ví dụ `src/test/fixtures/layouts/wg1-town.geojson`) → worldId → **Tạo**.
2. Tab **Generator**: bật/tắt lớp phủ, click lô để khóa, thay prefab hay sinh lại; đổi seed → Xem trước → Áp dụng. Ctrl+Z hoàn tác bất cứ bước nào.
3. **Lưu nháp** (Ctrl+S) để giữ trong IndexedDB của editor. **Export** rồi `npm run map:unpack -- <file>.mappack.json` để đưa vào repo, sau đó chơi bằng `?world=<worldId>`. Từ lúc này world coi như đã phát hành (Q3).

## 7. Kiểm chứng

- **Test mới**:
  - `src/map/layout/worldSync.test.ts` (24): layout lưu cùng world, game không đọc; hash ổn định qua pack; trạng thái khi di chuyển/xóa/đặt tay/khóa;
  - cùng file: sinh lại cùng seed không đổi gì (kể cả sau khi khóa lô); seed mới giữ record sửa tay và khóa, deep check sạch; ghi đè; không mang lại nhà đã xóa trừ khi khôi phục; xung đột ID; bất biến; sinh lại lô/chunk; thay và bỏ prefab; LAYOUT_ONLY ↔ FULL; thị trấn dày 500 m;
  - `src/map/editor/generator.test.ts` (7): thư viện, quy tắc Q3, tạo world từ GeoJSON (có cắt, lỗi đầu vào), qua lịch sử undo/redo, qua nháp/export/Lưu thành….
- **Toàn bộ**: `npm test` 841 pass (+13 skip). tsc, oxlint, build, build:editor, check:bundle, map:check sạch.
- **Trình duyệt** (Vite dev, Playwright qua MCP, chuột thật):
  - Mới → Từ GeoJSON: 92 nhà, Validate 0/0;
  - click lô: công trình được chọn, Inspector báo generated;
  - khóa lô: viền xanh dương, "Sinh lại lô" bị tắt;
  - thay prefab: sửa tay; "Sinh lại lô": trở về sinh tự động;
  - kéo nhà: sửa tay;
  - seed 7: xem trước "thay 13, thêm 103, bỏ 99, giữ 1 sửa tay" → Áp dụng; nhà sửa tay vẫn còn; Ctrl+Z về seed 1;
  - Export → `map:unpack` → `map:check` và deep check sạch;
  - `npm run build`: chunk `world-wg4-browser` 141 kB, không có file layout; `check:bundle` OK;
  - chơi `?world=wg4-browser`: 26 zombie, nhà quay ra phố;
  - mở lại world trong editor: layout nạp từ repo, vẫn "1 sửa tay", mọi thao tác sinh lại bị chặn (Q3), khóa vẫn được;
  - world tạm đã xóa khỏi `content/maps`.
- **Hiệu năng**: sinh lại fixture (seed mới) khoảng 110 ms trong trình duyệt; thị trấn dày 500 m dưới 8 s trong test.

## 8. Giới hạn và phần của sprint sau

- **Chạy trên main thread**: sinh lại world cỡ 500 m làm editor đứng vài giây. Web Worker và xử lý tăng dần thuộc WG5.
- **Nhập lại GeoJSON đã sửa vào world có sẵn** (đổi reference): chưa có trong editor. CLI `layout:import --force` giữ gốc tọa độ, nhưng mạng đường đổi thì cần quy tắc trộn đường riêng.
- **Kiểm tra chồng lấn với object đặt tay** chỉ dựa trên khung bao. Chồng lấn tinh hơn để deep check báo.
- **Khóa trên world đã phát hành**: được phép vì chỉ đổi layout. Muốn sinh lại vẫn phải Lưu thành…
- **Viền chunk "chưa lưu" màu cam** hiện khắp world mới (hành vi cũ của tab Chunk). Vì vậy viền lô sửa tay dùng màu hồng để không lẫn.
- **Không có script Playwright riêng** trong `scripts/` cho WG4: máy hiện không có gói Playwright cho Node. Bước kiểm tra trình duyệt ở mục 7 chạy qua MCP.
- **Còn lại**: môi trường, lưu trữ/hiệu năng, gộp mặt đường (WG5); ảnh tham chiếu và vẽ tay (WG6).
