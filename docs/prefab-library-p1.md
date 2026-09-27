# Prefab library P1: thư viện chung, surface, compound

Nhánh `feature/prefab-library` (tách từ `feature/world-generator`, chưa merge vào master). P1 là sprint hạ tầng; nội dung P2–P5 (nhà ở, dịch vụ, công trình công cộng lớn, nhà tù, nghĩa trang, công viên, hồ) chưa làm.

## 0. Quyết định của chủ dự án (2026-09-27)

| # | Quyết định | Áp dụng trong P1 |
|---|---|---|
| D1 | Chép bản sao khi nhập (copy-on-import), không liên kết sống | `source` = thư viện, ID, phiên bản, hash; cập nhật phải xem trước; không ghi đè bản đã sửa; không tự đổi ID có trạng thái; xử lý trùng ID |
| D2 | Mở rộng schema với `surface` | Hình dạng, vật liệu, va chạm, điều hướng; bê tông, nhựa, cỏ, đất, gạch lát, nước; nước chặn điều hướng; thứ tự vẽ theo lớp; save không đổi |
| D3 | Compound prefab giữ thông tin nhóm trong editor | Chọn, di chuyển, xoay, nhân bản cả nhóm; sửa riêng một phần; rã nhóm; game chỉ thấy record thường |
| D4 | Giữ `MAX_STOREYS = 4` | Không đổi |
| D5 | Chỉ dùng 15 vật phẩm hiện có | Không đổi item hay loot table trong P1 |
| D6 | Công trình lớn chỉ đặt tay | Compound có `footprint` và `placement` để generator dùng sau; không gộp lô |
| D7 | Phong cách trộn, ưu tiên Việt Nam | `catalog.architectureStyle` (vietnamese / american / generic); generator ưu tiên theo phong cách |
| D8 | P1 → P5, mỗi sprint có tiêu chí nghiệm thu, build, test, commit, push nhánh riêng | Nhánh `feature/prefab-library` |

## 1. Kiến trúc

```
content/maps/prefab-library/          world ẩn (listed: false) = thư viện chung
  prefabs/*.json                      building prefab (có catalog: nhóm, phong cách, tag)
  compounds/*.json                    compound prefab (chỉ editor đọc)
  editor/compounds.json               nhóm của các compound mẫu trong world thư viện
content/maps/<world>/
  prefabs/*.json                      bản chép của world (có source nếu nhập từ thư viện)
  editor/compounds.json               các nhóm của world (chỉ editor đọc)
```

- **Thư viện là nơi quản lý nội dung, không phải dữ liệu runtime bắt buộc.** Game không bao giờ nạp `compounds/` hay `editor/` (`src/map/bundledFiles.ts` loại chúng; `check:bundle` có marker). Một world dùng prefab thư viện giữ bản chép của riêng nó.
- **Building prefab** = `PrefabDocument` như cũ, thêm hai trường tùy chọn:
  - `catalog`: nhóm (nhà ở, thương mại, công cộng, công nghiệp, cảnh quan), `architectureStyle`, tag, mô tả;
  - `source`: `{ library, id, version, hash }`.
  - `hash` = `cyrb53:` của nội dung, không tính `prefabId`, `source`, `contentVersion`, `retiredLocalIds`. Nhờ vậy bản nhập dưới ID khác vẫn cùng hash, còn sửa gì trong world cũng làm hash đổi.
- **Compound prefab** = `CompoundDocument`: `compoundId`, `contentVersion`, `name`, `footprint`, `catalog`, `placement`, `instances` (building prefab của thư viện) và `objects` (tường, rào, cây, trang trí, surface, container). Vị trí tính theo pivot (0, 0), chưa xoay.
- **Nhóm** (`src/map/editor/groups.ts`): mỗi compound đặt vào world thành các record thường cộng một mục trong `editor/compounds.json`:
  - `groupId`, `name`, `compoundId`, `source` (phiên bản đã ghim);
  - `pivot`, `quarterTurns`;
  - mỗi thành phần có `member`, `id` và `hash` của thành phần trong hệ tọa độ của nhóm.
  - Di chuyển hoặc xoay cả nhóm không làm thành phần nào thành "đã sửa"; sửa riêng một thành phần thì có.

### 1.1 Surface

Object `kind: 'surface'` dùng được trong prefab, trong chunk và trong compound.

- **Trường:** `shape` (rect / ellipse), `position`, `size [X, Z]`, `material`, `color`, `layer` 0–4, `collision` (none / solid), `navigation` (walkable / blocked).
- **Hiển thị:** runtime `MapData.surfaces`, gộp mesh theo ô 128 m, vật liệu và màu (`surfaceBatches`). Mặt nước có texture riêng (`water`, lớp thứ 16 của surface catalog).
  - Surface nằm cao hơn road cùng lớp 0,5 mm; lớp cao hơn nằm trên.
  - Validator cảnh báo `surface-overlap` khi hai surface khác màu chồng nhau trên cùng lớp (trong prefab và toàn world).
- **Va chạm:** `solid` sinh các tường vô hình (`WallDef.hidden`, ID dẫn xuất `<id>#solid-<n>`, cao 1 m).
  - Collider, Rapier, nav grid, đẩy khỏi vật cản khi migrate save và kiểm tra `spawn-blocked` đều tự nhận.
  - Không vẽ, không che tầm nhìn (thấp hơn `occluderMinHeight` 1,5 m).
  - Hình elip được phủ bằng các dải 0,5 m.
- **Điều hướng:** `blocked` mà không `solid` sinh `MapData.navBlockers`, chỉ trên lưới tầng trệt (ví dụ bồn cỏ zombie đi vòng, người chơi vẫn bước lên). `solid` bắt buộc đi kèm `blocked` (lỗi `surface-solid-walkable`).
- **Giới hạn:** chỉ ở tầng trệt, không có `level`, không có trạng thái save.

### 1.2 Thư viện chung (`src/map/editor/library.ts`)

- **`prefabStatus`** trả về một trong các trạng thái:
  - `absent`: chưa có trong world;
  - `current`: đã nhập, mới nhất;
  - `outdated`: thư viện có bản mới;
  - `modified`: đã sửa trong world;
  - `modified-outdated`: cả hai;
  - `id-taken`: world có prefab khác cùng ID (kèm cờ `identical` nếu nội dung trùng khớp).
- **`importPrefab`:** chép vào world, ghi `source`, manifest ghim phiên bản. Từ chối nếu world đã có bản chép, hoặc có prefab khác cùng ID. Khi trùng ID: `freePrefabId` gợi ý `<id>-2`; `linkPrefab` chỉ ghi nguồn nếu nội dung giống hệt.
- **`planPrefabUpdate`:** tính trước thay đổi (thêm, bỏ, đổi, số instance, footprint) và bị chặn khi:
  - bản trong world đã sửa (trừ khi chọn "Ghi đè bản sửa trong world");
  - bỏ ID có trạng thái (cửa, tủ, cửa sổ, đèn) của prefab đang có instance (trừ khi chọn "Chấp nhận đổi ID có trạng thái"; sau đó cần tăng `contentVersion` của world, editor đã cảnh báo sẵn);
  - thư viện dùng lại local ID mà world đã khóa: luôn bị chặn.

  Khi áp dụng: giữ `prefabId` và file của world; `retiredLocalIds` = hợp của cả hai cộng các ID bị bỏ.
- **Compound:**
  - `placeCompound` nhập các prefab còn thiếu (trùng ID thì nhập dưới ID mới). World đã có bản chép cũ hơn thì dùng bản đó và ghi chú. ID record có dạng `<chunk>/<compound>-<member>-<n>`.
  - `planCompoundUpdate`:
    - thành phần chưa sửa được thay tại chỗ, giữ ID;
    - thành phần đã sửa tay được giữ;
    - thành phần mới được thêm;
    - thành phần bản mới bỏ thì bị xóa (ID khóa lại);
    - thành phần đã sửa tay mà bản mới bỏ thì tách khỏi nhóm;
    - bỏ ID có trạng thái cần đồng ý.
  - `saveCompound`: lưu vùng chọn thành `compounds/<id>.json`, dùng khung của nhóm đang gắn với compound đó (thêm hoặc bớt thành phần không làm dịch pivot). Lưu lại có thay đổi thì tăng phiên bản. Vùng chọn chứa một phần của nhóm khác thì bị từ chối.
  - `groupRecords` (Ctrl+G), `ungroup`.
- **Lệnh world biết về nhóm:** `moveRecords` dời pivot theo; `rotateRecords` xoay cả nhóm quanh pivot; `duplicateRecords` tạo nhóm mới; `deleteRecords` và `writeRecords` dọn nhóm rỗng. Mọi thay đổi nằm trong document nên undo, redo, nháp, export và `map:unpack` đều mang theo.

### 1.3 Phong cách kiến trúc trong generator (D7)

- `PlanParams.architectureStyle` và `styleByZone` (theo zone).
- Trọng số: cùng phong cách ×4, `generic` ×1, phong cách khác ×0,25 (`STYLE_WEIGHT`, `styledWeight`).
- Không đặt phong cách thì trọng số giữ đúng như WG3, nên world cũ sinh lại cho kết quả như cũ.
- Đổi phong cách không cắt lại lô.
- Tab Generator có ô "Phong cách".

## 2. Editor

- **Tab Prefab → "Thư viện chung":**
  - tìm kiếm; lọc theo loại (công trình / compound), nhóm, phong cách;
  - thumbnail (có vẽ surface), kích thước, số tầng, phiên bản, trạng thái;
  - nút theo trạng thái: Thêm vào world / Nhập với ID mới / Liên kết / Xem cập nhật… / Đặt;
  - compound: click rồi click viewport để đặt (R xoay trước khi đặt).
  - Khi đang mở chính world thư viện, danh sách lấy từ nội dung đang sửa.
- **Tab "Trong world":** prefab nhập từ thư viện có dòng "từ thư viện: id vN".
- **Hộp thoại cập nhật:** phiên bản cũ → mới, danh sách thay đổi, lý do bị chặn, hai ô đồng ý, xem trước trong viewport, Áp dụng (một bước, Ctrl+Z hoàn tác được).
- **Chọn nhóm:** click một thành phần chọn cả nhóm; Alt+click chọn riêng một phần; chọn bằng khung cũng mở rộng ra cả nhóm (trừ khi giữ Alt). Ctrl+G nhóm, Ctrl+Shift+G rã nhóm.
- **Inspector nhóm:** tên, compound và phiên bản, "Thư viện có bản vN" kèm nút cập nhật, pivot, danh sách thành phần (đã sửa tay / đã xóa, bấm tên để chọn riêng), các nút Xoay 90°, Nhân bản, Xóa, Rã nhóm, Lưu thành compound….
  - Record đơn lẻ trong nhóm có dòng "Thuộc nhóm" để chọn lại cả nhóm.
  - Vùng chọn nhiều record chưa thành nhóm có nút Nhóm lại và Lưu thành compound….
- **Inspector prefab:** mục "Thư viện chung" gồm nguồn, trạng thái, nút cập nhật, và sửa nhóm, phong cách, tag, mô tả.
- **Surface:**
  - tab Nền của world và tab Nền của prefab có 9 mẫu: bãi cỏ, sân bê tông, sân gạch lát, bãi đỗ nhựa, lối đi, nền đất, hồ elip, mặt nước chữ nhật, bồn cỏ (chỉ chặn điều hướng);
  - Inspector có vật liệu (màu, va chạm, điều hướng mặc định đổi theo), hình, kích thước, màu, lớp vẽ, va chạm, điều hướng; tay cầm kéo kích thước.

## 3. Nội dung

- `scripts/map-tools/library-p1.ts` (đã chạy một lần; chạy lại thì script từ chối):
  - ghi `catalog` cho 10 prefab của thư viện;
  - tạo compound mẫu `compound/garden-house` "Nhà vườn có ao (mẫu)": nhà, bãi cỏ, lối đi, ao nước, hàng rào, hai cây; đặt thành một nhóm ở chunk `c1_0` của world thư viện.
- Chưa thêm prefab mới nào của P2–P5.

## 4. Kiểm chứng

- **Test mới:**
  - `src/map/editor/surfaces.test.ts` (8 test): pond, dải elip, nav/collider, gộp mesh, validator, xoay và kéo kích thước, prefab, pack và save/load;
  - `src/map/editor/library.test.ts` (16 test): nhập bản sao, trùng ID và liên kết, phát hiện và áp dụng cập nhật, các trường hợp bị chặn, compound và nhóm, undo, pack, Ctrl+G và lưu compound, cập nhật compound, phong cách trong generator.
- **Kết quả:**
  - `npm test`: 892 pass, 13 skip. `navTiles` "a long route costs a few milliseconds" là test đo thời gian: một lần chạy cả bộ bị trượt (627 ms) khi máy đang tải; chạy riêng pass, chạy lại cả bộ cũng pass.
  - tsc, oxlint, `build`, `build:editor`, `check:bundle` sạch.
  - `map:check --deep` sạch với mọi world; chỉ còn 2 cảnh báo cũ `spawn-indoors` ở neighborhood-50.
- **Trình duyệt (Playwright MCP, dev server):**
  - tab Thư viện chung hiện 10 prefab và 1 compound với đúng trạng thái;
  - Thêm vào world chuyển trạng thái sang "Đã nhập, mới nhất";
  - đặt compound tự nhập `building/house` thành `building/house-2` (trùng ID), Validate 0 lỗi;
  - R xoay cả nhóm; Ctrl+Z trả về; click thường chọn 7 record, Alt+click chọn riêng ao;
  - hộp thoại Lưu thành compound mở đúng; không có lỗi console;
  - Chơi thử world thư viện: bãi cỏ, lối đi, ao nước, rào, cây hiện đúng.

## 5. Giới hạn còn lại

- Chưa thử trên trình duyệt: hộp thoại cập nhật với một thư viện thực sự có bản mới (unit test đã phủ), và việc người chơi bị ao chặn trong lúc chơi (test chỉ xác nhận collider và nav).
- Surface chỉ có chữ nhật và elip; chưa có đa giác. Mặt nước không có hiệu ứng động.
- Cập nhật compound không tạo lại thành phần đã bị xóa tay. Thành phần đã sửa tay mà bản mới bỏ thì chỉ bị tách khỏi nhóm.
- Compound lấy prefab thư viện qua bản chép đang có của world; world có bản cũ hơn thì dùng bản đó (có ghi chú), không tự cập nhật.
- Chỉ compound của world `prefab-library` hiện trong thư viện chung. Compound lưu ở world khác nằm trong `compounds/` của world đó.
- "Mới → Trống" vẫn chép prefab của neighborhood-50; chưa có lựa chọn lấy từ thư viện.
- Generator chưa đặt compound (D6) và chỉ có ưu tiên phong cách theo cả plan hoặc theo zone, chưa theo vùng vẽ tay.
