# World generator WG6: ảnh tham chiếu, hiệu chỉnh, vẽ tay (và tổng kết WG1–WG6)

Ngày 27/09/2026. Sprint cuối của World Map Generator (`docs/writing-block.md` §4B, §5; quyết định Q1–Q9 ở `docs/world-generator-wg1.md` §0; Q4: nhập ảnh và vẽ tay để WG6). Nhánh `feature/world-generator`.

- **Không đổi**: save game (v9), schema map (v1), định dạng layout (v1: `OrthogonalParams.offset` là tùy chọn), runtime game.
- **Có thêm**:
  - tab **Bản vẽ** trong editor;
  - file `layout/reference.json` của world, chỉ editor đọc;
  - thao tác đồng bộ `layout`: cập nhật world từ reference đã sửa, cả bản vẽ lẫn GeoJSON. Việc này gỡ giới hạn đã ghi ở WG4.

## 1. Tiêu chí nghiệm thu

| # | Tiêu chí (§4B, §5) | Kết quả |
|---|---|---|
| R1 | Import ảnh bản đồ có quyền sử dụng; hiển thị làm overlay trong Map Editor | Đạt: PNG/JPEG/WebP/GIF đọc tại máy, tối đa 16 MB; có độ mờ, bật/tắt; editor không tải gì từ mạng |
| R2 | Điểm hiệu chỉnh | Đạt: thêm điểm trên ảnh, nhập tọa độ thật; 2 điểm cho phép đồng dạng, từ 3 điểm có thể chọn affine; hiện sai số RMS và sai số lớn nhất |
| R3 | Xác định world scale | Đạt: "Đo tỷ lệ": hai điểm trên ảnh cộng khoảng cách thật; ảnh giữ vị trí và hướng |
| R4 | Đánh dấu đường, giao lộ | Đạt: vẽ polyline theo loại đường; bắt vào đỉnh hoặc thân đường khác thành giao lộ; đường cắt nhau tự thành giao lộ (có thể tắt cho cầu vượt); công cụ Giao lộ gộp các đầu đường suýt chạm |
| R5 | Khoanh vùng khu đất; khu dân cư, thương mại, công nghiệp | Đạt: vùng đất với 7 loại (dân cư, thương mại, công nghiệp, công cộng, rừng, ruộng, đất trống); vùng cấm (nước, đường sắt, cấm xây) |
| R6 | Image Layout Extraction là module thay thế được; output chuẩn hóa về cùng WorldLayout | Đạt: `LayoutExtractor<Input>` → GeoJSON mét cục bộ → cùng importer và pipeline; `HAND_TRACING` là bản cài đặt đầu tiên |
| R7 | Không yêu cầu AI; không giả định ảnh có tọa độ hay tỷ lệ | Đạt: mặc định 0,5 m/pixel, đặt giữa gốc tọa độ, kèm cảnh báo "chưa hiệu chỉnh" |
| R8 | Reference image → world coordinates, có kiểm thử | Đạt: `referenceTransform`, `pixelToMetres`/`metresToPixel`, `measureScale`, cùng khung của layout (test) |
| R9 | Undo/redo, lưu nháp, export | Đạt: mỗi nét vẽ, mỗi lần hiệu chỉnh là một command; reference đi theo nháp, pack, Lưu thành…, `map:unpack`; game không nạp |

## 2. Dữ liệu (`src/map/layout/reference.ts`)

`layout/reference.json` (`zombie-outbreak/layout-reference` v1):

| Trường | Nội dung |
|---|---|
| `image` | tên, mime, kích thước, hash, data URL; `null` = vẽ tay trên lưới (1 m mỗi đơn vị) |
| `calibration` | các điểm pixel ↔ mét (X đông, Z nam), `method` là similarity hoặc affine |
| `features[]` | `road-<n>`, `zone-<n>`, `area-<n>`; điểm tính theo **pixel ảnh**, nên hiệu chỉnh lại thì nét vẽ đi theo ảnh; mỗi đường có loại, số làn, vỉa hè, loại mặt (đất), tên |
| `nextId` | ID không bao giờ dùng lại |

**Các hàm thuần** (tài liệu → tài liệu):
- `addRoad`: tự thêm giao lộ ở chỗ cắt nhau;
- `snapRoadPoint`: bắt vào đỉnh, hoặc chèn đỉnh vào thân đường;
- `markJunction`, `addArea`, `updateFeature`, `removeFeatures`;
- `moveVertex`: dời một đỉnh giao lộ thì mọi đường qua đó dời theo;
- `featureAt`, `measureScale`, `checkReference`.

**Chuẩn hóa:**
- `HAND_TRACING.extract(ref)` trả về GeoJSON `local-metres` với tag `worldgen:road`, `lanes`, `sidewalk`, `surface`, `name`, `worldgen:zone`, `worldgen:restricted` và ID `trace/<feature>`.
- Importer WG1 đọc nó như mọi GeoJSON. Không có đường thì báo lỗi; ảnh chưa hiệu chỉnh thì cảnh báo.
- Module segmentation sau này chỉ cần trả cùng GeoJSON đó.

**Khung tọa độ:**
- Nét vẽ nằm trong "mét nguồn".
- Sau khi sinh world, lớp phủ đi qua khung `normalized.frame` của layout (góc xoay theo hướng chủ đạo, offset), nên ảnh luôn khớp với đường đã sinh.
- Click trong viewport đi ngược lại: world → nguồn → pixel.

## 3. Cập nhật world từ reference đã sửa (`worldSync.ts`, `generator.ts`)

- `reimportLayout(old, text)` import lại với cùng layout ID, gốc chiếu, vùng cắt, zone mặc định, và **ghim khung** cũ: góc xoay qua `alignment`, offset qua tham số mới `OrthogonalParams.offset`. Đường không đổi vì thế nắn vào đúng vị trí cũ.
- `syncGenerated({ kind: 'layout', layout })`:
  - lập lại kế hoạch với tham số cũ;
  - giữ lô khóa, lô chọn tay và lô có công trình sửa tay; lô nào nay bị đường mới đè lên thì planner bỏ và báo `kept-parcel-conflict`;
  - xếp công trình, rồi trộn theo cùng quy tắc (record khóa và record đặt tay không bao giờ bị đụng; record sửa tay được giữ trừ khi ghi đè).
- Q3: bị chặn trên world đã phát hành, như mọi thao tác sinh lại.
- Editor:
  - tab Bản vẽ → "Cập nhật world từ bản vẽ" (world sinh từ bản vẽ);
  - tab Generator → "Cập nhật từ GeoJSON…" (world sinh từ dữ liệu địa lý);
  - cả hai đều xem trước rồi Áp dụng.

## 4. Editor (tab Bản vẽ, công cụ `trace`)

- **Ảnh tham chiếu**: Nhập/Thay ảnh…, Bỏ ảnh (giữ nét vẽ), độ mờ, hiện/ẩn. Ảnh vẫn hiện ở tab Generator để so với world.
- **Hiệu chỉnh**:
  - m/pixel, số điểm, kiểu, sai số;
  - bảng điểm có X/Z sửa được và nút xóa;
  - tick Affine khi có từ 3 điểm;
  - "Đo tỷ lệ": click hai điểm, nhập mét, Áp dụng tỷ lệ.
- **Công cụ**:
  - Chọn: click chọn, kéo đỉnh (giao lộ dời theo, bắt vào đỉnh khác), Delete để xóa;
  - Đường: chọn loại, tick "cắt nhau thành giao lộ";
  - Giao lộ, Vùng đất, Vùng cấm, Điểm hiệu chỉnh, Đo tỷ lệ;
  - phím: Enter xong, Esc hủy, Backspace bỏ điểm cuối.
- **Nét đang chọn**: loại đường, số làn, vỉa hè, tên; zone; loại vùng cấm; Xóa.
- **Sinh world**:
  - cảnh báo của bộ trích xuất;
  - "Tạo world từ bản vẽ": worldId, tên, chế độ, kiểu lô, seed, môi trường, chạy qua worker; world mới mang theo reference;
  - "Cập nhật world từ bản vẽ";
  - "Xuất GeoJSON", dùng với CLI `layout:import`.
- **Viewport** (`ReferenceOverlay.tsx`):
  - ảnh là một quad có texture;
  - đường tô màu nổi theo loại, vùng tô theo zone;
  - nét đang chọn màu trắng, bản nháp màu hồng đi theo con trỏ;
  - điểm hiệu chỉnh đánh số #n, đoạn đo màu cyan.

## 5. Kiểm chứng

- **Test mới** `src/map/layout/reference.test.ts` (11):
  - hiệu chỉnh: mặc định, đo tỷ lệ, đồng dạng xoay 90°, affine, nghịch đảo;
  - giao lộ khi cắt nhau (lưới "#" ra đúng 4 giao lộ, không cảnh báo `crossing-without-junction`); bắt vào thân đường (chữ T); đánh dấu giao lộ;
  - sửa đỉnh giao lộ, xóa, chọn bằng click;
  - cảnh báo chưa hiệu chỉnh; từ chối khi không có đường; kiểm tra file;
  - world từ bản vẽ hợp lệ, giữ reference qua pack, chiều dài đúng tỷ lệ;
  - cập nhật từ bản vẽ: khung giữ nguyên, nhà sửa tay giữ nguyên, lô khóa giữ nguyên, phía tây không đổi;
  - cập nhật world GeoJSON khi bỏ một đường.
- **Toàn bộ**: `npm test` 868 pass (+13 skip). tsc, oxlint, build, build:editor, check:bundle (thêm marker `layout-reference`), map:check --deep sạch.
- **Trình duyệt** (Vite dev, Playwright qua MCP, chuột thật):
  - world trống → tab Bản vẽ → nhập ảnh (vẽ bằng canvas: đường, công viên, hồ, thước 100 m);
  - đo tỷ lệ trên thước: đúng 0,400 m/pixel;
  - vẽ 4 đường (mỗi đường tự có 2 giao lộ), đường nội bộ bắt vào giao lộ, công viên, hồ: 9 bước undo;
  - tạo world lần đầu bị từ chối: đường chéo làm một nút có 5 nhánh. Đây là quy tắc Q1, không nối sai;
  - chọn đường chéo → Delete → vẽ lại từ thân đường (chữ T) → tạo world qua worker: 116 nhà, 947 đồ môi trường, 5 giao lộ, Validate 0/0; ảnh khớp đường sinh ra (khung −0,48°); đường chéo thành đường bậc thang có cảnh báo;
  - vẽ thêm một đường → "Cập nhật world từ bản vẽ" → xem trước → Áp dụng: 40/41 mặt đường cũ giữ nguyên, Validate 0/0;
  - Export → `map:unpack` (`layout/reference.json` và `world-layout.json` vào repo) → `map:check` và deep check sạch; build game: chunk world không có file layout; check:bundle OK;
  - world tạm đã xóa.

## 6. Giới hạn

- **Dải đất bao quanh là một khối.** Toàn bộ dải đất bên ngoài các đường ngoài cùng là một khối của planner WG2. Thêm đường chạm vào dải đó sẽ chia lô lại cả dải; trong thử nghiệm trình duyệt chỉ 35/116 nhà giữ nguyên. Khối bên trong không bị ảnh hưởng (test). Muốn giữ ổn định hơn cần chia dải ngoài thành nhiều khối (việc của planner).
- **Nét vẽ là đường 1 px.** WebGL không vẽ nét dày. Màu nổi giúp dễ thấy, nhưng trên ảnh rất sặc sỡ có thể vẫn khó nhìn; khi đó giảm độ mờ.
- **Đường chéo dài thành bậc thang** (Q1: lưới 0°/90°). Đường cong và đường chéo thật để giai đoạn sau; dữ liệu nguồn vẫn giữ nguyên.
- **Nút có hơn 4 nhánh bị từ chối.** Người vẽ phải tách giao lộ.
- **Ảnh lưu nguyên trong file của world** (tối đa 16 MB). Nháp và pack lớn theo ảnh, nhưng game không tải.
- **Không có AI nhận dạng ảnh** (đúng đặc tả). Chỗ cắm là `LayoutExtractor`.
- **Vẫn chưa có script Playwright riêng** (máy không có gói Node).

## 7. Tổng kết WG1–WG6 (§18)

### Hệ thống có sẵn được tái dùng

- Map Editor, gồm lịch sử undo, layer, validate, deep check, chơi thử, nháp IndexedDB, pack/unpack, Lưu thành….
- Schema map (chunk 32 m, record, ID ổn định, `externalRefs`), resolver.
- Prefab và lệnh prefab, loot, zone zombie, spawn.
- Static batch của game và editor, streaming chunk (M10), save và migration nội dung (M8).
- Object ngoài trời G3/G4, cùng cách làm thư viện prefab ẩn (`listed: false`).

### Kiến trúc (§3)

| Thành phần theo đặc tả | Module |
|---|---|
| ReferenceImporter | `geojson.ts` + `importer.ts` (GeoJSON), `reference.ts` (ảnh và vẽ tay, `LayoutExtractor`) |
| LayoutNormalizer | `network.ts` + `orthogonalize.ts` (lưới 0°/90°, giữ nguồn, cảnh báo độ lệch, khung ghim được) |
| RoadNetworkGenerator | `streets.ts` (mặt đường, vỉa hè, giao lộ) |
| ParcelGenerator | `parcels.ts` + `plan.ts` (khối, lô, đường vào) |
| PrefabPlacementGenerator | `buildings.ts` (metadata `placement` của prefab) |
| EnvironmentGenerator | `environment.ts` |
| WorldSerializer | `layoutWorld.ts` (ra nội dung map thường) + `worldSync.ts` (manifest, trộn, trạng thái) |
| ExistingMapEditor | tab Generator và Bản vẽ, worker, lớp phủ |

Logic sinh là module thuần, không có Three.js. Không có mesh nào nằm trong dữ liệu bản đồ.

### Schema mới

- `WorldLayout` v1 (`layout/world-layout.json`: nguồn, `normalized`, `plan`, `generated` manifest, `plan.environment`).
- `ReferenceTracing` v1 (`layout/reference.json`).
- `PrefabDocument.placement`.
- Asset ngoại hình `outdoor/streetlight`.

### Cách dùng

- CLI: `npm run layout:import`, `npm run layout:plan` (xem wg1–wg5).
- Editor: Mới → Từ GeoJSON; tab Bản vẽ; tab Generator.
- Tài liệu từng sprint: `docs/world-generator-wg1.md` … `wg6.md`; hướng dẫn: `docs/map-editor-guide.md`.

### Kết quả kiểm thử cuối

868 test pass (+13 skip); build, bundle và deep check sạch.

### Giới hạn chung

- Lưới 0°/90° (Q1).
- Thư viện prefab còn nhỏ.
- Đèn đường không sáng.
- Dải đất ngoài là một khối.
- Generator chỉ viết lại world chưa phát hành (Q3). Migration save là hệ riêng (M8).
