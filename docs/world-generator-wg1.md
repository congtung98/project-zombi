# World generator WG1: WorldLayout từ GeoJSON, chuyển tọa độ, nắn lưới

Ngày 27/09/2026. Sprint đầu của World Map Generator (`docs/writing-block.md`). Nhánh `feature/world-generator`.

- Lộ trình: **WG1** → WG2 mạng đường + chia lô → WG3 thư viện prefab + đặt prefab → WG4 tích hợp editor → WG5 môi trường, lưu trữ, hiệu năng → WG6 ảnh tham chiếu + vẽ tay.
- **Không đổi**: game, editor, schema map (v1), save (v9), nội dung `content/maps/`. WG1 chỉ thêm module thuần `src/map/layout/`, một CLI và test.

## 0. Quyết định của chủ dự án (27/09/2026) áp dụng trong WG1

| # | Quyết định | Cách WG1 thực hiện |
|---|---|---|
| Q1 | Nắn về lưới 0°/90°; giữ hình học gốc, lưu bản nắn riêng, có preview, cảnh báo khi biến dạng quá ngưỡng, không âm thầm mất kết nối/tạo giao lộ sai; dữ liệu nâng cấp được lên đường chéo/cong | Hai lớp tách hẳn: `roads`/`network` (gốc, không bao giờ bị sửa) và `normalized` (method `orthogonal`, cùng ID node/cạnh). Cạnh là polyline tổng quát nên phương pháp khác chỉ cần thêm `method`. Gộp node, giao lộ sai, chồng đường là **lỗi** (`valid: false`). Preview SVG |
| Q2 | Layout ở file riêng | `*.layout.json` (format `zombie-outbreak/world-layout` v1), game không nạp. Trạng thái generated/modified/locked thuộc WG4 |
| Q4 | Chỉ GeoJSON, không gọi mạng; xử lý dữ liệu thiếu lô/zone | Chỉ đọc file cục bộ. Thiếu land use → cảnh báo `no-landuse` + `defaults.zone`. Thiếu lô → `no-parcels` (WG2 tự chia) |
| Q5 | 500 × 500 m, 1:1, không phải giới hạn kiến trúc; mở rộng theo chunk | Vượt 500 m chỉ cảnh báo; có `clip`. Chỉ mục sở hữu chunk cho mạng đã nắn |
| Q7 | Zone land use chỉ cho generator, độc lập `zombiePopulation` | Kiểu riêng `LandUseZone`, không chạm `zones.ts` |
| Q8 | Không bỏ dữ liệu sông, hồ, đường sắt, vùng cấm xây | `restricted` (`water`/`railway`/`no-build`), đường thẳng có bề rộng mặc định |

## 1. Tiêu chí nghiệm thu

| # | Tiêu chí | Kết quả |
|---|---|---|
| A1 | GeoJSON (WGS84, EPSG:3857, mét cục bộ) → WorldLayout; feature được hỗ trợ được phân loại, còn lại được báo theo lý do | Đạt (`geojson.test.ts`) |
| A2 | WorldCoordinateTransformer: địa lý → mét, khung nắn ↔ world, ảnh → world, world → editor; đều có test | Đạt (`coordinates.test.ts`, 13 test) |
| A3 | Hình học gốc không đổi sau khi nắn; bản nắn lưu riêng, cùng ID | Đạt (test "never changes the source layer", `renormalize`) |
| A4 | Mọi đoạn đã nắn song song trục; tập node/cạnh và đầu mút giữ nguyên; gộp node, giao lộ sai, chồng đường, nút > 4 nhánh là lỗi | Đạt (`orthogonalize.test.ts`) |
| A5 | Số đo biến dạng + cảnh báo theo ngưỡng; preview | Đạt (`deviation`, `length`, `maxNodeShift`; SVG) |
| A6 | Tất định (cùng input + tùy chọn → cùng byte, không phụ thuộc thứ tự feature); ID ổn định khi import lại | Đạt |
| A7 | Dữ liệu thiếu zone/lô vẫn nhập được; nước/đường sắt/vùng cấm được giữ | Đạt |
| A8 | 500 × 500 m không treo: dưới 3 s | Đạt: 23 ms cho lưới 21 × 21 phố (840 cạnh) |
| A9 | Không hồi quy: toàn bộ test, `tsc -b`, lint, build game/editor, `check:bundle`, `map:check` | Đạt (mục 7) |

## 2. Kiến trúc (`src/map/layout/`, thuần, không Three.js, chạy được trong Web Worker)

| File | Vai trò trong pipeline của tài liệu |
|---|---|
| `schema.ts` | Kiểu `WorldLayout` và hằng số |
| `coordinates.ts` | **WorldCoordinateTransformer**: `LocalTangentProjection` (WGS84 → ECEF → ENU, X đông, Z nam), Web Mercator, `sourceToWorld`/`worldToSource` (khung nắn), `fitSimilarity`/`fitAffine`/`imageToWorld` (ảnh, cho WG6), `worldToEditor` (chunk + vị trí cục bộ) |
| `geojson.ts` | **ReferenceImporter** (GeoJSON): đọc, phân loại tag, chiếu, cắt vùng |
| `network.ts` | Topology đường: node, cạnh, nối chỗ hở, giao cắt không có node |
| `orthogonalize.ts` | **LayoutNormalizer** phương pháp `orthogonal` |
| `importer.ts` | Ghép pipeline, `renormalize`, đọc/ghi/kiểm tra file layout |
| `chunks.ts` | Chỉ mục sở hữu chunk của mạng đã nắn |
| `preview.ts` | Preview SVG |
| `scripts/map-tools/layout-import.ts` | CLI `npm run layout:import` |

Tái sử dụng: `quantize`, `rotateXZ`, `chunkIdOf`/`chunkIndex`/`chunksOverlapping`, `SLUG` (`transform.ts`), `signedArea` (`polygon.ts`), `formatJson` (`format.ts`). Không có file nào của game/editor bị sửa.

## 3. Ánh xạ tag (feature đầu tiên khớp)

1. `worldgen:ignore=yes`; `worldgen:road=<class>`, `worldgen:restricted=<kind>`, `worldgen:parcel=yes|<zone>`, `worldgen:zone=<zone>` (cho GeoJSON tự vẽ).
2. Đường `highway=*`:

| Tag | Lớp | Làn | Vỉa hè |
|---|---|---|---|
| motorway, trunk | arterial | 4 | không |
| primary | arterial | 2 | hai bên |
| secondary, tertiary | collector | 2 | hai bên |
| `*_link` | như trên | 1 | |
| residential | local | 2 | hai bên |
| unclassified, road | local | 2 | không |
| living_street | local | 1 | không |
| service | service | 1 | không |
| track | track (đất) | 1 | không |
| footway, path, cycleway, pedestrian, steps, bridleway | path | không vào mạng lưới | |

   - Bề rộng: `width` (m hoặc ft), nếu không có thì số làn × 3,25 (arterial/collector), 3 (local, track), 3,5 (service), tối thiểu 3 m.
   - Đọc thêm `lanes`, `sidewalk*`, `oneway`, `bridge`, `tunnel` (trừ `building_passage`), `layer`, `surface`.
   - Bỏ qua (có báo): `proposed`, `construction`, `abandoned`…
3. Đường thẳng `railway=rail|light_rail|narrow_gauge|tram|…` → restricted railway (rộng 3–6 m); `waterway=river|canal|stream|drain|ditch` → restricted water (rộng 12/10/3/2/1,5 m). Loại ngầm (`tunnel`) bị bỏ qua, có báo.
4. Vùng nước: `natural=water|bay`, `water=*`, `waterway=riverbank|dock`, `landuse=reservoir|basin`. Vùng cấm xây: nghĩa trang, quân sự, bãi rác, mỏ đá, sân bay, đầm lầy, bãi biển, đá trơ.
5. `building=*` → gợi ý nhà (chỉ để tham khảo, generator đặt prefab).
6. Land use:
   - residential: `landuse=residential`
   - commercial: `landuse=commercial|retail`, `amenity=marketplace`
   - industrial: `landuse=industrial|garages|depot|port|railway`, `man_made=works`
   - public: `landuse=education|religious|institutional|civic`, trường học, bệnh viện, chùa/nhà thờ, cơ quan…
   - forest: `landuse=forest`, `natural=wood|scrub|heath`
   - farmland: `landuse=farmland|farmyard|meadow|orchard|vineyard|allotments…`
   - empty: `landuse=grass|brownfield|construction…`, `leisure=park|garden|pitch|playground…`, `amenity=parking`
7. Còn lại (điểm, tag lạ) → `ignored-feature` (info), gom theo lý do kèm tối đa 5 ID mẫu.

Mỗi feature giữ `tag` đã quyết định lớp của nó, nên đổi bảng ánh xạ sau này không cần import lại.

## 4. WorldLayout (`zombie-outbreak/world-layout` v1)

```text
format, formatVersion, layoutId (slug), name
source { kind: geojson, file?, hash: "cyrb53:…", crs, attribution, features }
importer { name: geojson-importer, version: 1 }
projection { method: local-tangent-plane, ellipsoid: WGS84, origin {lon,lat} } | { method: local-metres, origin {x,y} }
clip Rect | null, extent Rect (khung gốc), defaults { zone }
roads[]      { id, sourceId?, name?, tag, class, lanes, width, sidewalk, oneway, grade, layer, surface, points[], network }
network      { nodes[{id, position, kind: junction|joint|end|boundary}], edges[{id, roadId, from, to, points[]}], crossings[{edges, at, kind: grade-separated|unjoined}] }
zones[]      { id, sourceId?, name?, tag, zone, polygon {outer, holes} }
restricted[] { id, …, kind: water|railway|no-build, geometry: {type: polygon, polygon} | {type: line, points, width} }
buildings[], parcels[]  (gợi ý từ nguồn)
issues[]     { severity, code, message, ids?, at? }
normalized   { method: orthogonal, version, params, frame {rotationDeg, offset}, nodes[], edges[{id, from, to, points, sourceLength, length, deviation, staircase}], bounds, metrics, valid, issues[] } | null
```

- **Khung gốc**: mét cục bộ, X đông, Z nam (bắc là −Z như `world/boundary-n`), lượng tử hóa 1 µm.
  - Nguồn địa lý: mặt phẳng tiếp xúc tại gốc chiếu. Sai số là (d/R)²/2, tức 3·10⁻⁷ ở 5 km; đổi ngược sang lon/lat sai < 10⁻⁹°.
  - Không bao giờ dùng lon/lat làm tọa độ mesh.
- **Khung world** của `normalized`: `world = rotateDeg(gốc, rotationDeg) + offset`, cùng chiều xoay với `rotateXZ`/`quarterTurns`.
- **ID**:
  - đường `road-<nguồn>` (`way/123` → `road-way-123`); feature không có ID dùng hash nội dung `road-h<10 hex>`; phần thứ k của Multi* thêm hậu tố `-k`, mảnh bị cắt thứ k thêm `-pk`, trùng ID thêm `-dupN` kèm cảnh báo;
  - node `n-<hash vị trí gốc>`, cạnh `<roadId>-e<k>`;
  - không lấy từ chỉ số mảng hay thời gian.
- **ID ổn định khi import lại**: CLI giữ gốc chiếu của file cũ, nên ID ổn định khi dữ liệu thay đổi. Đổi gốc chiếu thì ID node đổi.
- Tất định: không dùng thời gian hay `Math.random`, danh sách sắp theo ID. Cùng văn bản nguồn và tùy chọn cho ra cùng byte; đổi thứ tự feature chỉ đổi `source.hash`.

## 5. Nắn lưới (`orthogonalize.ts`)

1. **Khung**: góc chủ đạo là trung bình theo chiều dài của góc các đoạn modulo 90° (trung bình vòng trên 4θ), làm tròn 0,01°. Sau đó dời tâm về gốc theo bội số `grid`. Có thể đặt góc cố định (`alignment`).
2. **Đơn giản hóa** Douglas–Peucker (`simplify` 2 m). Mỗi đoạn:
   - lệch trục ≤ `axisTolerance` (20°) → một chặng thẳng;
   - dốc hơn → **bậc thang**, mỗi bậc ≤ `stairStep` (24 m).
3. **Cổng tại node**: mỗi đầu cạnh ở một node rời theo một hướng có dấu riêng (+X, −X, +Z, −Z), chọn trong hai hướng mà đoạn đầu của nó nghiêng về, sao cho tổng góc bẻ nhỏ nhất (vét cạn, tối đa 4 đầu).
   - Hai đường rời giao lộ gần song song vì vậy không bị nắn chồng lên nhau: đường lệch trục nhiều hơn rẽ trước (chữ L).
   - Node có trên 4 nhánh là lỗi.
4. **Nhóm ràng buộc** (union–find):
   - hai đỉnh nối bằng chặng dọc X chung Z, nối bằng chặng dọc Z chung X;
   - mỗi nhóm lấy trung bình có trọng số (node nặng theo bậc), làm tròn về lưới.
   - Nhờ vậy đường gần thẳng thành thẳng, và một giao lộ luôn là một điểm cho mọi đường đi qua.
5. **Dọn**: bỏ điểm trùng, gộp chặng cùng hàng, bỏ đoạn gập ngược ở đỉnh giữa (không đổi topology).
6. **Kiểm tra** (mã issue):

| Mã | Mức | Ý nghĩa |
|---|---|---|
| `nodes-merged` | lỗi | hai node bị nắn trùng một điểm (kết nối sẽ đổi) |
| `edge-collapsed` | lỗi | vòng co lại thành điểm |
| `false-junction` | lỗi | hai cạnh chạm nhau ở chỗ bản gốc không có giao lộ |
| `edges-overlap` | lỗi | hai cạnh chồng lên nhau một đoạn |
| `junction-too-many-roads` | lỗi | node có > 4 nhánh |
| `crossing-kept` | info | giao cắt bản gốc đã có (cầu/hầm/thiếu node) vẫn giữ, không thành giao lộ |
| `roads-too-close` | cảnh báo | hai đường song song gần hơn nửa tổng bề rộng: mặt đường sẽ chồng nhau |
| `diagonal-staircase` | cảnh báo | có đoạn chéo bị nắn thành bậc thang |
| `edge-deviation` | cảnh báo | cạnh lệch khỏi bản gốc quá `maxDeviation` (5 m; khoảng cách Hausdorff lấy mẫu mỗi 1 m) |
| `edge-length` | cảnh báo | chiều dài đổi quá `maxLengthChange` (25 %) |

Issue của bước nhập: `joined-near-miss` (cảnh báo, nối đầu cụt cách đường khác ≤ `joinTolerance` 1 m, không bao giờ nối khác layer), `crossing-without-junction` (cảnh báo), `grade-separated-crossing` (info), `overlapping-roads`, `duplicate-feature`, `invalid-geometry` (cảnh báo), `extent-over-limit`, `no-landuse` (cảnh báo), `no-parcels`, `attribution`, `ignored-feature` (info), `no-roads` (lỗi).

`valid: false` nghĩa là WG2 phải từ chối layout. Người dùng chỉnh `grid`/`axisTolerance`/`alignment` rồi chạy lại: `renormalize`, nguồn không đổi.

## 6. Cách dùng

```sh
npm run layout:import -- khu-pho.geojson --id khu-pho --name "Khu phố" --out khu-pho.layout.json --svg khu-pho.svg
# tùy chọn: --crs auto|wgs84|web-mercator|local-metres  --origin <lon>,<lat>  --clip 500x500
#           --grid 1  --align auto|<độ>  --simplify 2  --axis-tolerance 20  --stair-step 24
#           --max-deviation 5  --max-length-change 0.25  --join 1  --default-zone residential
#           --attribution "…"  --max-extent 500  --no-normalize  --force
```

- In tóm tắt số lượng, số đo nắn lưới và mọi issue.
- Ghi file layout (và SVG nếu có `--svg`) kể cả khi không hợp lệ, để xem lại.
- Exit 1 khi có lỗi.
- Không ghi đè nếu thiếu `--force`. Khi ghi đè, giữ gốc chiếu của file cũ.
- Xuất từ overpass-turbo (Export → GeoJSON) dùng được ngay. Dữ liệu OSM tự nhận câu ghi công `© OpenStreetMap contributors (ODbL)`.

Fixture tổng hợp (không phải dữ liệu bản đồ thật): `src/test/fixtures/layouts/wg1-town.geojson`, gồm 25 feature:
- lưới 3 × 3 phố xoay 12°, một phố lượn nhẹ;
- một đường chéo 45°, một đường cong 1/4 vòng;
- hẻm cụt, một đường hở 0,6 m, cầu qua sông và qua phố;
- lối đi bộ, sông, đường sắt, hồ, nghĩa trang, 5 vùng đất, 2 nhà;
- một điểm và một đường quy hoạch (bị bỏ qua).

Kết quả:
- 12 đường, 17 node, 19 cạnh;
- xoay −12°, node dịch tối đa 1,55 m, **hợp lệ**;
- cảnh báo đúng chỗ: hai bậc thang, đường cong chạy sát West Avenue 6 m, nối chỗ hở 0,6 m, vượt 500 m.

## 7. Kiểm chứng

- **Unit/integration** (`src/map/layout/*.test.ts`, 67 test mới):
  - `coordinates` (13): gốc/trục, bán kính cong M/N tới mm, khoảng cách so với haversine, khứ hồi 0,1 mm trong 5 km, vĩ độ cao, Web Mercator, xoay đúng một phần tư vòng, khung khứ hồi, chunk nửa mở, ảnh similarity/affine/nghịch đảo/nhiễu/suy biến;
  - `geojson` (15): tag đường, land use, vùng cấm, gợi ý nhà, lô, vòng/lỗ, bỏ qua có lý do, ID độc lập thứ tự, Multi*, trùng ID, CRS, cắt vùng, lỗi đầu vào, ghi công OSM;
  - `network` (8): giao lộ, joint, T, nối chỗ hở (và giữ nguyên record), không nối khác layer, giao cắt cầu/không node, vòng xoay, node biên, lối đi bộ, đường trùng;
  - `orthogonalize` (15): lưới xoay 17° có nhiễu vẫn hợp lệ và giữ topology, góc cố định/grid, phố lượn thành thẳng, góc chủ đạo, bậc thang, cổng tại node, nút 5 nhánh, gộp node, giao lộ sai, cầu, đường quá sát, nguồn không đổi, tất định, `legPlan`/`cleanPolyline`;
  - `layout` (16): fixture, ghi/đọc khứ hồi từng byte, validator, `renormalize`, preview, thiếu zone/lô/đường, giới hạn 500 m + clip, hiệu năng, ID ổn định khi thêm đường, sở hữu chunk.
- `npm test`: **763 pass** (+10 skip, 3 file skip; trước WG1 là 696). `tsc -b`, `oxlint`, `build`, `build:editor`, `check:bundle` (không có code generator trong bundle game), `map:check` sạch.
- **Hiệu năng** (Node, máy này):
  - fixture 13–14 ms;
  - lưới dày 500 × 500 m (21 × 21 phố, 441 giao lộ, 840 cạnh, xoay 31°, nhiễu 0,6 m): 23 ms.
  - Generation không chạm main thread của game; module thuần nên đưa vào Worker được khi editor cần (WG4).
- **Preview**: SVG của fixture render bằng Chrome và đã xem bằng mắt. Lưới thẳng lại, vùng đất/sông/đường sắt khớp khung world, bậc thang tô viền cam, cầu cắt phố và sông không có giao lộ.
- **Hồi quy**: không file nào của game/editor/nội dung bị sửa. Chỉ thêm module mới, một script npm, CLI và fixture.

## 8. Giới hạn và phần của sprint sau

- **Đường chéo/cong thành bậc thang**, dài hơn tới ~41 % với đường 45°. Hình học gốc được giữ để làm phương pháp đường chéo sau này.
- **Đường đôi** (hai chiều vẽ thành hai đường song song của OSM) chưa gộp. Hai nửa gần nhau sẽ bị báo `roads-too-close` hoặc lỗi chồng đường. Cách tạm là gắn `worldgen:ignore` cho một nửa, hoặc WG2 gộp.
- **Giao lộ > 4 nhánh** không biểu diễn được trên lưới 0°/90° (lỗi).
- Chặng bị ép rẽ tại node rất ngắn (< nửa `grid`) có thể co lại. Khi đó checker báo lỗi chồng đường chứ không bỏ qua.
- Vùng đất/vùng cấm chưa nắn, chỉ có khung để đổi sang world. WG2 quyết định chia lô trên khung nào.
- Chưa có UI:
  - xem trước trong editor, trạng thái generated/modified/locked, lưu vào bản nháp: WG4;
  - vẽ tay trên ảnh: WG6 (phép biến đổi ảnh đã có).
- Chỉ đọc GeoJSON. Chưa đọc OSM XML/PBF, và không gọi Overpass (theo Q4).
- `crs: auto` coi mọi file có tọa độ trong khoảng lon/lat là WGS84. File mét cục bộ có tọa độ nhỏ phải khai báo `worldgen:crs` hoặc `--crs local-metres`.
