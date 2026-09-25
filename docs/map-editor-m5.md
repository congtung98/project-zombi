# Map editor M5: prefab editor

Ngày 25/09/2026. Thực hiện M5 của `docs/Map_Editor_Implementation_Plan.md`, sau M4 (0a8f50c). Save **không đổi (v8)**, nội dung khu phố không đổi. Schema map vẫn v1; phần thêm vào đều tùy chọn (object `wallRun`, `prefab.retiredLocalIds`). Định dạng: `docs/map-content-format.md`.

## 1. Kết quả

- **Mở prefab gốc**: tab Prefab có các nút **Sửa**, **Nhân bản**, **Xóa** (chỉ xóa được khi không còn instance nào dùng) cho từng prefab, và nút **Prefab mới…**; Inspector của một instance có nút **"Sửa prefab gốc (N instance)"**.
- **Chế độ sửa prefab**: viền hồng, banner **"Sửa PREFAB GỐC"** ghi tên, `prefabId` và danh sách instance bị ảnh hưởng, nút **← Về world**. Trong chế độ này viewport chỉ vẽ prefab trong hệ tọa độ cục bộ của nó; lưới, chọn, kéo, khung chọn, R/Delete/Ctrl+D/mũi tên/Ctrl+A đều áp lên các mục của prefab.
- **Palette prefab**:
  - Tường: kéo theo trục X/Z.
  - Cửa: cửa đi 1,2/1,4 m và cửa sổ; click gần tường thì **bám vào tường và quay vào trong nhà** (cửa mở vào trong).
  - Nội thất: giường, bàn, sofa, quầy (kéo dài), khối.
  - Tủ: tủ bếp, tủ quần áo, tủ đầu giường, kệ hàng, tủ lạnh (có loot), tủ trống.
  - Phòng: kéo khung phòng, có hoặc không có đèn.
- **Tường tự khoét khe**: loại object mới `wallRun`. Resolver tự khoét khe ở chỗ có cửa/cửa sổ nằm trên tường, rồi dựng lanh tô (từ `DOOR_HEIGHT` 2,2 m lên trần), bệ và đầu cửa sổ. Dời cửa dọc tường thì khe đi theo, không phải tự tách hộp như prefab viết tay.
- **Xem trước và lớp phủ**: footprint (đỏ), pivot (chấm hồng), phòng (màu + tên), đèn (đĩa vàng) và công tắc (ô vàng, kéo để dời), cung mở cửa, **vòng tầm tương tác** tính giống `GameRuntime` (cửa, tủ, công tắc). **Xem xoay 0/90/180/270°** vẽ lại qua resolver thật để thấy mọi instance xoay trông ra sao; ở góc khác 0° chỉ xem, click không sửa.
- **Inspector prefab**:
  - Khi không chọn gì: tên, `contentVersion` (tự đồng bộ với số phiên bản ghim trong manifest), danh sách instance, footprint + nút "Khớp footprint với tường", các thuộc tính công trình (cao, tường dày, màu tường/mái/sàn), pivot, số local ID đã xóa.
  - Khi chọn một mục: sửa **local ID** (có kèm ID trong world của instance đầu tiên) và các trường theo loại mục:
    - tường: hai đầu, cao, dày, màu, danh sách khe;
    - cửa: tên, vị trí, góc xoay, độ rộng, hướng mở (vào trong/ra ngoài), trạng thái ban đầu;
    - cửa sổ: bệ, đầu, độ dày;
    - hộp/tủ: vị trí, cao, kích thước, màu, tên, **bảng loot**;
    - phòng: tên, khung, có đèn;
    - đèn: tên, cường độ, màu, cần điện, vị trí công tắc.
- **Validate**: click một lỗi nằm trong file prefab thì editor mở prefab đó và chọn đúng mục.

## 2. Kiến trúc

```text
src/map/schema.ts        + WallRunObject, PrefabDocument.retiredLocalIds
src/map/resolve.ts       + wallRunBoxes (khe, lanh tô, bệ/đầu cửa sổ) — dùng chung game + editor
src/map/validate.ts      wallRun song song trục; retiredLocalIds (retired-id-reused)
src/map/editor/
  prefabPresets.ts       palette prefab (template theo thứ tự khóa của file content)
  prefabCommands.ts      createPrefab (nhà mẫu), duplicatePrefab, deletePrefab, updatePrefab, fitFootprint,
                         placePrefabItem, move/rotate/delete/duplicatePrefabItems, updatePrefabItem,
                         prefabItems/pickPrefabItem/itemsInRect, resolvePrefab, isStatefulItem
  document.ts            resolvedRecords cache theo (world, prefab map, chunk); instancesOf; statefulEntityIds;
                         prefabItemAtPath
src/editor/              PrefabScene (viewport chế độ prefab), PrefabInspector, palette/dialog prefab,
                         sceneHelpers.ts; interaction/Viewport rẽ nhánh theo chế độ
```

- Lệnh prefab là hàm thuần `document → document` và **dùng chung lịch sử** với lệnh world: một lần hoàn tác trả về cả prefab lẫn world, kể cả khi tạo hay xóa prefab. Nếu hoàn tác làm prefab đang sửa biến mất, editor tự về world. Chế độ, tab, góc xem và vùng chọn là trạng thái phiên; vùng chọn được lọc theo chế độ sau mỗi lần hoàn tác/làm lại.
- Viewport của chế độ prefab dựng prefab thành một instance đặt tại pivot và đưa qua `resolveInstance`, tức cùng hàm với game. Vì vậy những gì hiển thị (khe cửa, cửa, cửa sổ, phòng, đèn) đúng là những gì game dựng.
- Sửa prefab tạo ra map prefab mới, nên cache resolve của editor tính lại mọi instance và `externalRefs` của các chunk được tính lại (instance có thể to ra, lấn sang chunk khác).
- Tạo prefab thêm entry vào manifest (`prefabs/<tên>.json`, tự tránh trùng đường dẫn). Nhân bản tạo `prefabId` mới với `contentVersion` 1, không mang theo `retiredLocalIds`. Instance đã đặt vẫn trỏ vào prefab gốc.

## 3. Identity và save

- Save chỉ nạp được khi **tập ID có trạng thái** (cửa, container của map, cửa sổ/rèm, đèn, zone) khớp đúng map và `contentVersion` của world giống nhau (`systems/save.ts`). Từ đó:
  - **Sửa tương thích** (dời, xoay, đổi kích thước, màu, tường, nội thất, khung phòng, pivot, footprint) giữ mọi local ID ⇒ save cũ nạp được và **giữ trạng thái cửa/loot/đèn/rèm**. Test khẳng định điều này qua `validateSaveGame` + `loadSnapshot`.
  - **Thêm, xóa hoặc đổi tên** cửa, tủ, cửa sổ, đèn làm đổi tập ID ⇒ save cũ bị từ chối (không bị reset ngầm). Nếu prefab đang có instance, editor hỏi xác nhận trước khi xóa hoặc đổi tên. Khi đó cảnh báo `content-changed-same-version` hiện lên, liệt kê ID thêm/bỏ, cho tới khi tăng `contentVersion` của world.
- Cảnh báo `content-changed-same-version` (có từ M3) nay **chính xác theo tập ID có trạng thái**, cho cả sửa chunk lẫn sửa prefab: đổi bố cục mà giữ nguyên ID thì không còn cảnh báo.
- Xóa hoặc đổi tên thì local ID cũ vào `retiredLocalIds` của prefab và không bao giờ được cấp lại (`<base>-<n>` bỏ qua các ID này). Dùng lại một ID đã xóa là lỗi validate `retired-id-reused`.
- Mảnh tường sinh từ `wallRun` có ID `<entity>#<phần>` (ký tự `#` không có trong slug) và không có trạng thái, nên không nằm trong danh sách ID ổn định.

## 4. Khác với kế hoạch

| Kế hoạch | Thực tế | Lý do |
|---|---|---|
| Đặt/chỉnh tường | Thêm `wallRun` (resolver tự khoét khe); vẫn đặt được "khối tường" dạng hộp; tường hộp cũ giữ nguyên | Tách hộp quanh cửa bằng tay trong GUI dễ sai; resolver dùng chung nên game và editor khớp nhau |
| Inspector container: type, loot, capacity | Loot table + tên; sức chứa hiển thị "8 ô (cố định)" | Game chưa có sức chứa theo container |
| Interaction point | Công tắc đèn (điểm E) kéo được; vòng tầm tương tác cho cửa/tủ/công tắc | Đây là các điểm tương tác có trong game |
| Cảnh báo khi xóa/đổi localId có state | Hỏi xác nhận khi prefab có instance + khóa ID cũ + cảnh báo theo tập ID | Save hiện so khớp tập ID nên đây là thước đo đúng |
| Asset registry / model | Không có | Mọi thứ vẫn là hộp tô màu (M1 đã chốt) |
| Polygon room / nhiều tầng / nested prefab / override theo instance | Không làm | Ngoài phạm vi MVP như kế hoạch nêu; biến thể = nhân bản prefab |

## 5. Kiểm chứng

- **Unit** `src/map/editor/prefab.test.ts` (17 test):
  - wall run: khe đúng trục, bỏ qua cửa khác trục/lệch tường, lanh tô từ 2,2 m, bệ/đầu cửa sổ;
  - nhà mẫu: hợp lệ, ID mảnh tường nằm ngoài danh sách ID ổn định, không mảnh thấp nào chắn khe cửa;
  - tạo prefab; cửa/cửa sổ bám tường và quay vào trong (4 hướng tường); phòng kéo khung + đèn, dời phòng kéo theo đèn, nhân bản phòng cấp ID đèn mới; xoay;
  - xóa/đổi tên khóa ID, dùng lại bị chặn và là lỗi validate; bật/tắt đèn phòng; `contentVersion` đồng bộ manifest; khớp footprint; biến thể; chặn xóa prefab đang dùng; picking; lịch sử;
  - **nhà dựng hoàn toàn bằng lệnh prefab chạy trong `GameRuntime` ở cả 4 góc xoay**: cửa đóng tách trong/ngoài, mở thì nối (nav), loot đã gieo, `buildingAt` ra đúng nhà, cửa sổ chiếu sáng phòng, đèn cộng ánh sáng nhân tạo;
  - **sửa tương thích giữ save** (cửa mở, tủ đã lấy, đèn bật còn nguyên sau khi nạp lại); thêm container thì save cũ bị từ chối; sửa prefab đổi mọi instance.
- `npm test`: **451 pass** (+9 skip), gồm soak (không đổi). `tsc -b`, `oxlint`, `npm run build`, `npm run build:editor`, `npm run map:check` sạch. `check:bundle` thêm marker M5: `dist` OK, `dist-editor` phát hiện được.
- **Trình duyệt** `scripts/m5-editor-browser.mjs` (Chrome headless SwiftShader, dev) PASS với chuột thật:
  - mở prefab nhà dân từ instance: banner ghi "Ảnh hưởng 1 instance: c0_0/house";
  - kéo giường: không cảnh báo; thêm tủ đầu giường: có cảnh báo; hoàn tác cả hai;
  - world mới → Prefab mới `building/m5-house` → kéo tường ngăn, click cửa sổ sát tường bắc (bám vào, 0°), đặt tủ bếp + đổi bảng loot sang `store-shelf`, đặt giường, kéo công tắc đèn;
  - xem xoay 90°: click không sửa gì;
  - về world, đặt nhà ở 0/90/180/270° → Export → `map:unpack` → `/?world=` → New Game: mỗi nhà có cửa đóng tách trong/ngoài, mở thì nối, tủ có loot, có rèm, có đèn, `buildingAt` đúng; không lỗi console.
- **Hồi quy**: `m3-editor-browser.mjs`, `m4-editor-browser.mjs`, game dev `p2-s5-browser.mjs` PASS.

## 6. Giới hạn, việc sau

- Tường chỉ song song trục; góc tường nối bằng cách kéo dài nửa độ dày (hai tường chồng nhau ở góc, cùng màu nên không thấy).
- Chưa kéo tay cầm để đổi kích thước trong viewport; chưa có polygon room, nhiều tầng hay đèn `at` riêng (đèn luôn ở tâm phòng, trừ khi sửa JSON).
- Chưa có công cụ migration nội dung cho save khi đổi tập ID (chỉ có cảnh báo + tăng `contentVersion`).
- M6: Play From Here, kiểm tra collider chồng / khả năng đi tới, generator, thumbnail palette, hướng dẫn quy trình đầy đủ.
