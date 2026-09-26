# Map editor M11a: nhà và phòng hình L, T, U (đa giác vuông góc)

Ngày 26/09/2026. Sprint đầu của M11 (phòng đa giác + nhiều tầng), sau M10.

- Save **không đổi (v8)**; nội dung `neighborhood-50` không đổi.
- Schema map v1 thêm hai trường tùy chọn: `PrefabDocument.outline` và `RoomObject.outline`.

**M11 chia ba sprint:**
- **M11a (sprint này): nhà và phòng đa giác.**
- **M11b: nhiều tầng, phần dữ liệu và mô phỏng.** Tầng trong prefab, cầu thang, sàn tầng trên có collider, nav nhiều lớp nối qua cầu thang, người chơi và zombie lên xuống, độ cao tương đối cho tầm nhìn và đòn đánh, save.
- **M11c: nhiều tầng, phần hiển thị và editor.** Cắt lớp tầng trên, camera, con trỏ, ánh sáng theo tầng, editor sửa từng tầng, prefab nhà hai tầng.

## 1. Vì sao là "đa giác vuông góc"

Mọi cạnh chạy theo trục X hoặc Z, vì các hệ thống đều dựa trên hình hộp thẳng trục: tường, tường chạy, collider, nav, tầm nhìn và phép xoay 90° của prefab. Hình chữ L, T, U hay nhà có chỗ khoét đều làm được. Tường chéo sẽ phải làm lại toàn bộ hệ collider và phép thử tầm nhìn, nên không nằm trong M11.

## 2. Nội dung

- `PrefabDocument.outline?: {x,z}[]`: đường bao của nhà trên đường tâm tường. `footprint` phải đúng bằng khung bao của nó. Sàn, mái và phép thử "trong nhà" đi theo outline.
- `RoomObject.outline?: {x,z}[]`: phòng hình L/T/U. `bounds` phải đúng bằng khung bao của nó. Ánh sáng và phép thử "trong phòng" đi theo outline. Đèn mặc định treo ở tâm mảnh chữ nhật lớn nhất của phòng (tâm khung bao của chữ L có thể rơi vào chỗ khoét).
- Không có outline thì mọi thứ giữ nguyên như trước: file cũ không đổi một byte.
- Validator:
  - `invalid-outline` (lỗi): dưới 4 đỉnh, cạnh chéo hoặc dài 0, các cạnh cắt hay chạm nhau, diện tích 0;
  - `outline-bounds` (lỗi): khung chữ nhật không đúng bằng khung bao của outline;
  - `outside-footprint` và `lamp-outside-room` (cảnh báo) dùng outline, nên tủ đặt ở chỗ khoét hoặc đèn treo ngoài chữ L đều bị báo.
- Deep check: `spawn-indoors` và `container-outside-room` dùng outline.

## 3. Game

- `src/map/polygon.ts` (thuần, dùng chung cho game, validator, editor):
  - `outlineProblem`, `pointInOutline` (điểm trên cạnh tính là bên trong), `insideOutline` (có lề), `distanceToOutline`;
  - `outlineRects`: chia outline thành các hình chữ nhật không chồng nhau, phủ kín, tất định;
  - `outlineCentre`, `normalizeOutline`, `rectOutline`, `outlineBounds`.
- Resolver xoay và đặt outline theo instance (`BuildingInfo.outline`, `RoomPlacement.outline`).
- Kiểm tra trong nhà/trong phòng (`isInsideBuilding`, `isInsideRoom`) dùng outline. Vì vậy chỗ khoét là ngoài trời với:
  - mái ẩn khi đứng trong nhà;
  - chỗ sinh zombie;
  - zombie lang thang trong/ngoài nhà;
  - ánh sáng phòng và HUD.
- Sàn và mái vẽ theo từng mảnh chữ nhật (`buildingPieces`). Mái chỉ chìa ra 0,3 m ở cạnh ngoài, nên các mảnh không chồng nhau (không nhấp nháy z-fighting). `RoofController` giữ một tập mảnh mái cho mỗi nhà, vì các mảnh có thể nằm ở chunk khác nhau.
- Shader ánh sáng trong nhà vẫn nhận hình chữ nhật: phòng chữ L chiếm một ô cho mỗi mảnh, cùng độ sáng (`roomSlots.ts`). Khi phải chọn phòng gần nhất (quá 16 ô), phòng chỉ được chọn nếu đủ chỗ cho mọi mảnh, để không bao giờ sáng một nửa. Bảng debug F6 vẽ viền theo outline.

## 4. Editor

- **Prefab mới…** có thêm **Hình: Chữ nhật / Chữ L**. Chữ L là nhà mẫu bị khoét góc đông bắc: outline, tường chạy theo từng cạnh, cửa ở tường nam, một phòng chữ L có đèn.
- **Inspector footprint** (khi không chọn gì):
  - **Chuyển thành đa giác (L, T, U…)**;
  - danh sách đỉnh sửa bằng số (hai cạnh gặp nhau ở đỉnh đi theo, giữ đúng trục);
  - **Khoét góc** (góc ngoài thành chỗ khoét, bằng nửa mỗi cạnh; bấm ở góc trong của chỗ khoét thì lấp lại);
  - **Khoét cạnh** (đẩy một phần ba giữa cạnh vào trong, tạo chữ U);
  - **Về hình chữ nhật**;
  - **Dựng tường theo outline**: chỉ thêm tường cho cạnh chưa có; tường cũ nằm ngoài outline cần xóa tay;
  - **Sửa outline**: bật để hiện tay cầm đỉnh/cạnh trên khung nhìn. Mặc định tắt, vì tay cầm giữa cạnh trùng đúng điểm giữa bức tường chạy dọc cạnh đó.
- Ô nhập footprint và **Khớp footprint** bị khóa khi có outline.
- **Inspector phòng**: các nút tương tự, thêm **Theo outline nhà**. Phòng chữ L có tay cầm ở đỉnh (`v<i>`) và giữa cạnh (`e<i>`). Kéo đỉnh thì hai cạnh đi theo; kéo cạnh thì dời cạnh sang ngang. Phép kéo làm các cạnh cắt nhau sẽ dừng ở hình hợp lệ cuối cùng.
- Di chuyển, xoay (xoay quanh tâm khung bao), nhân bản, hoàn tác đều mang theo outline. Sửa ô khung phòng bị từ chối khi phòng có outline.
- Điểm khoét rơi đúng lưới 0,25 m.
- Vẽ:
  - sàn chữ L theo từng mảnh trong khung nhìn;
  - thumbnail vẽ đa giác;
  - prefab editor vẽ viền outline, tô phòng theo mảnh, nhãn ở mảnh lớn nhất;
  - viền chọn theo outline.
- Chọn phòng chữ L bằng click: gần cạnh của outline hoặc gần tâm, không phải khi click ở chỗ khoét.
- `src/map/editor/outlines.ts` (thuần): `dragOutlineVertex`, `dragOutlineEdge`, `cutOutlineCorner`, `notchOutlineEdge`, `turnOutline`, `outlineWallRuns`, `outlineHandles`. `prefabCommands.ts`: `starterLHouse`, `buildOutlineWalls`, `updatePrefab({ outline })`.

## 5. Kiểm chứng

- **Unit** `src/map/editor/polygon.test.ts` (8):
  - hình học: hợp lệ hay không, điểm trong/trên cạnh, lề, các mảnh phủ đúng diện tích và không chồng;
  - thao tác: khoét góc rồi lấp lại, khoét cạnh theo lưới 0,25 m (từ chối khi quá nông), kéo đỉnh/cạnh, xoay;
  - nhà chữ L ở 4 góc xoay: hợp lệ, chỗ khoét ngoài nhà, đèn trong chữ L;
  - game: `buildingAt`, mảnh mái/sàn, mái không chồng, chỗ khoét không thuộc phòng nào, ô shader, 300 tick;
  - validator và deep check theo outline;
  - pack round-trip từng byte; sàn trong editor theo mảnh;
  - lệnh prefab: footprint, dựng tường, tay cầm, phòng (kéo, chọn, dời, xoay, nhân bản, bỏ outline).
- `npm test`: **519 pass** (+13 skip). `tsc -b`, `oxlint`, `build`, `build:editor`, `check:bundle`, `map:check -- --deep` sạch. Các CLI `map:*` vẫn chạy được (import có đuôi `.ts`).
- **Trình duyệt** `scripts/m11a-editor-browser.mjs` (dev) PASS:
  - nhà chữ L tạo từ hộp thoại;
  - kéo cạnh footprint bằng chuột thật rồi hoàn tác;
  - chọn phòng ở tâm, khoét cạnh bắc (10 đỉnh), kéo tay cầm cạnh tây;
  - thumbnail đa giác;
  - đặt nhà xoay 90°, Export → `map:unpack` → `?world=`: 51 điểm trong nhà và 12 điểm ở chỗ khoét; chỗ khoét không thuộc phòng nào; mái ẩn khi đứng trong chữ L, không ẩn ở chỗ khoét (đúng phép thử của `RoofController`, lề 0,4 m).
- **Hồi quy** PASS: editor m3–m10, `worlds-browser`; game p2-s2, p2-s4, p2-s5, p2-lighting (số đo giữ nguyên), p2-vision.

## 6. Còn lại

- Generator chưa sinh nhà chữ L (thư viện prefab của khu phố chưa có). Có thể thêm prefab L vào thư viện rồi cho generator chọn theo lô.
- "Dựng tường theo outline" không xóa tường cũ.
- Mái chìa ra ở chỗ góc lõm có thể thiếu một đoạn ngắn, vì cạnh mảnh nào nằm chung một phần với mảnh khác thì không chìa ra. Chỉ ảnh hưởng hình ảnh.
- M11b, M11c: nhiều tầng.
