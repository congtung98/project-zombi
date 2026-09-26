# Đồ họa G3b: cụm trang trí và biến thể

Ngày 27/09/2026. Phần thứ hai của §7 trong `docs/Graphics_Improvement_Implementation_Plan.md`, sau G3a (registry đồ đạc).

Nhà giờ kể chuyện qua bố trí:
- **Đồ trang trí** (`decor`) là loại object mới, chỉ để vẽ.
- **Cụm trang trí** đặt một lần trong editor và bung thành nhiều object có ID riêng.
- **Biến thể nhà** (nguyên vẹn / có người ở / bỏ hoang) đổi bảng màu, đồ trang trí và kiểu đồ đạc trên cùng một bố trí.
- Đồ đạc có thêm **góc lệch** (ghế kéo lệch) và **kiểu** (giường bừa, kệ thưa, kệ đồ nghề).

Nhà mẫu A giờ "có người ở", nhà B là cùng prefab nhưng "bỏ hoang". Lab có thêm một garage.

## 1. Quyết định (chọn theo khuyến nghị, có thể đảo ngược)

- **Đồ trang trí là object riêng, không nhét vào `visual`,** đúng yêu cầu của chủ dự án: có vị trí và ID riêng, nhưng không collider, không chặn đường hay tầm nhìn, không tương tác, không trạng thái lưu. Đồ đủ to để cản đường (bàn, ghế, tủ) vẫn là prop/container có collider.
- **Cụm là preset editor, không phải prefab lồng nhau** (repo chưa có). Kế hoạch cho phép cách này. Đặt cụm = tạo từng object với ID mới, một bước hoàn tác; phím R xoay cả cụm trước khi đặt.
- **Biến thể đặt ở instance.** Prefab khai các biến thể nó có. Instance chọn một, hoặc lấy theo seed ổn định `instanceId@contentVersion của prefab` (FNV-1a), nên không bao giờ đổi mỗi lần tải chunk.
  - Biến thể **không** đổi collider, nav, loot hay save. Vì vậy vật cản (kể cả ghế lệch) giống nhau ở mọi biến thể; chỉ đồ trang trí mới lọc theo biến thể.
  - Không thêm `materialSetId`: bảng màu của biến thể đã đủ, và kế hoạch dặn không thêm trường không dùng.
- **Quy ước "trông như đồ nhặt được":** thứ nhặt được luôn có dấu (đèn vàng trên nóc tủ, xám khi đã mở; túi đồ rơi). Đồ trang trí không bao giờ có dấu và giữ màu dịu. Validator cảnh báo đồ trang trí che dấu loot của tủ hoặc đứng trong vòng mở cửa.

## 2. Registry và hiển thị

- **`rendering/decor/`:** `catalog.ts` có 18 mẫu, mỗi mẫu có nhãn, kích thước để editor chọn và vẽ khung, màu, cờ `flat`. `assets.ts` dựng các bộ phận: hộp hoặc trụ đứng (dùng hình trụ sẵn có của batch), mỗi bộ phận có thể xoay nhẹ, và mọi bộ phận nằm trong kích thước đã khai (test giữ).
- **Batch tĩnh hỗ trợ xoay tự do:** `StaticItem.yaw` được đưa vào ma trận instance, bản mờ và bản cắt lớp. `itemBounds` cho hộp bao của khối đã xoay, để cắt lớp và làm mờ dùng đúng hộp. Mapping UV cục bộ của G1 không phụ thuộc phép xoay nên vân vẫn đúng. Vẫn **không thêm draw call**.
- **Đồ trang trí trong `collectStaticItems`:**
  - vai trò `prop` của tòa nhà chứa nó, nên cắt lớp, ẩn theo tầng và chịu mask nội thất như đồ đạc;
  - `anchor` là hộp bao của cả món;
  - đồ nằm trên sàn được nâng nhẹ trên các lớp sàn (tầng trệt: sàn nhà + sàn phòng; tầng trên: sàn phòng; ngoài trời: trên các lớp đường) để không nhấp nháy.
- **Mẫu lạ** là cảnh báo; game vẽ một hộp nhỏ màu tím xám để dễ thấy.
- **Biến thể** (`rendering/variants.ts`):
  - Bảng màu của nhà "bỏ hoang": độ bão hòa ×0,72, tối hơn 0,06, pha 14 % màu bụi. "Nguyên vẹn" sáng và tươi hơn một chút. "Có người ở" giữ nguyên màu nội dung.
  - Bảng màu áp cho mọi mảnh của nhà (tường, chi tiết, sàn, mái, đồ đạc), trừ đồ trang trí.
  - Kiểu đồ đạc mặc định của nhà bỏ hoang: giường bừa, kệ sách thưa, kệ kho thưa.
- **Đồ đạc:**
  - `yaw` (−45…45°): mẫu thu nhỏ vừa đủ để khi xoay vẫn nằm trong hộp collider (`yawFit`).
  - `variantId`: giường `made`/`unmade`, kệ sách `full`/`sparse`, kệ kho `goods`/`tools`/`sparse`.
  - Mẫu mới `furniture/workbench` (bàn thợ có ê tô, khay đồ, hộp đồ nghề ở tầng dưới).

## 3. Dữ liệu

- **Schema** (chi tiết trong `docs/map-content-format.md`):
  - object `decor { localId, level?, assetId, position, yaw?, color?, variants? }`, trong prefab và trong chunk;
  - `PrefabDocument.visual?.variants`;
  - `InstanceRecord.visual?.variantId`;
  - `FurnitureVisual.yaw?`, `FurnitureVisual.variantId?`.
- **Resolver:**
  - chọn biến thể và ghi vào `BuildingInfo.variant`;
  - bỏ đồ trang trí không thuộc biến thể;
  - xoay `yaw` của đồ trang trí theo instance;
  - `MapData.decor`.
- **Validator:**
  - lỗi: `variants` lạ, `yaw` của đồ đạc ngoài ±45°;
  - cảnh báo: `unknown-asset`, `unknown-variant`, `variant-not-offered`, `decor-on-container`, `decor-in-doorway`.
- **Lab** (`graphics-lab`) lên `contentVersion` 2, vì garage thêm cửa, tủ, cửa sổ và đèn (ID có trạng thái). Kèm `migrations/content-v1.json` sinh bằng `statefulIds` của nội dung v1, nên save v1 vẫn nạp được. `graphics-rotations`: cả 4 bản chọn tường minh "có người ở".

## 4. Nội dung

- **Nhà A, có người ở:**
  - bàn ăn có 2 đĩa, 2 cốc, chai;
  - góc bếp có thớt và bánh mì, nồi, hộp thực phẩm, đặt ở hai đầu tủ bếp, tránh dấu loot;
  - sách trên bàn nước, sách trên bàn làm việc, cặp sách cạnh bàn tầng trên.
- **Nhà B, bỏ hoang:**
  - bên cửa trước (ngoài vòng mở cửa): 3 thùng các-tông (một thùng chồng lên), túi du lịch, ba lô;
  - bàn ăn còn một đĩa, một cốc, nồi;
  - lon đồ hộp trên tủ bếp, hộp thực phẩm đổ dưới sàn, giấy tờ vương vãi ở hai tầng, quần áo;
  - giường bừa, kệ thưa, tường xỉn.
- **Cả hai nhà:** thảm dưới bàn nước; ghế ăn kéo lệch 25°.
- **Garage** (`building/lab-garage`): sàn bê tông, bàn thợ, kệ đồ nghề (tủ có loot `tool-shelf`), hộp đồ nghề, 2 can xăng, chồng lốp, 2 vệt dầu, lối xe bê tông ra đường.
- **Palette prefab có tab "Trang trí":** 18 mẫu và 4 cụm theo kế hoạch: "bàn ăn bỏ dở", "góc bếp", "chuẩn bị di tản", "góc garage".
- **Editor:**
  - Inspector đồ trang trí: mẫu, xoay, màu, "chỉ hiện ở" các biến thể.
  - Inspector đồ đạc: "Lệch (độ)", "Kiểu".
  - Prefab: các biến thể nhà. Instance: biến thể.
  - Lớp editor "Trang trí". Viewport vẽ khung đồ trang trí; hình thật để G5.

## 5. Đo

**Môi trường:**
- RTX 3060, i5-11500, Chrome 154 headless, ANGLE D3D11, 1280×800, DPR 1, bóng high, 8 zombie đứng yên.
- **Máy rất bận** (31 tiến trình Chrome của chủ dự án đang chạy): mọi con số đều cao hơn các sprint trước, kể cả bản cũ.

**Cách đo:** A/B xen kẽ với G3a (dựng từ worktree), thứ tự cũ, mới, mới, cũ; `--uncapped`. Số liệu ở `docs/graphics/g3b/report-ab.json`.

| | G3a | G3b |
|---|---|---|
| Draw call ngoài trời / trong nhà | 154 / 63 | 163 / 72 (+9: garage có cửa, cửa sổ, đèn, dấu loot riêng) |
| Tam giác | 15,0–20,4 k | 16,9–24,8 k |
| Instance batch (lab) | 1 698 | 1 990 |
| Geometry | 57–58 | 64–66 (cửa garage rộng hơn nên có pano riêng, v.v.) |
| Trung bình các median frame, 11 cảnh | 5,7 / 6,4 ms | 6,6 / 6,7 ms |
| Trung bình các median CPU | 4,7 / 5,3 ms | 5,4 / 5,6 ms |

- **CPU có vẻ tăng khoảng 0,3–0,9 ms**, cùng chiều với số instance trong batch; nhưng máy quá nhiễu để chốt. Qua các sprint, CPU tăng theo số instance (382 → 1 054 → 1 698 → 1 990). **G6 sẽ xử lý:** lọc theo từng instance của `BatchedMesh` ở cả lượt vẽ bóng.
- **neighborhood-50** (không đổi nội dung): draw call, tam giác, texture, geometry, instance giống hệt G3a. Frame time lúc này của G3a và G3b như nhau (G3a 7,0–7,4 ms, G3b 7,0–7,3 ms, capped); cả hai cao hơn lần đo trước vì máy bận.
- **Vòng đời:** 10 vòng vào/ra ở lab, bản xoay và `neighborhood-50`, số tài nguyên không tăng.
- **Bundle game:** +24,4 KB (+6,8 KB gzip) so với G3a.

**Ảnh:** `docs/graphics/g3b/` (lab 11 cảnh, `rotations/`, `neighborhood-50/`), nằm trong `.gitignore` của chủ dự án.

## 6. Kiểm chứng

- **Test:** 614 qua, 13 skip.
  - Mới `rendering/decor/decor.test.ts` (10):
    - mọi mẫu trang trí nằm trong kích thước;
    - seed biến thể ổn định, trải đều, bị ghi đè đúng, rơi về seed khi chọn thứ không có;
    - nhà A/B có đúng đồ trang trí của biến thể;
    - collider, occluder và ID có trạng thái giống bản không có đồ trang trí;
    - đổi biến thể không đổi loot hay collider, chỉ đổi giường, kệ và màu;
    - đồ trên sàn nằm trên các lớp sàn, đồ trên bàn ở mặt bàn, xoay theo nhà;
    - ghế lệch nằm trong collider;
    - validator (mẫu lạ, biến thể lạ, che dấu loot, đứng trong vòng mở cửa, `yaw` và kiểu đồ đạc);
    - đặt cụm: ID riêng, xoay R, đặt lại ra ID mới;
    - R xoay đồ trang trí; biến thể của prefab và của instance.
  - Cập nhật:
    - `graphicsLab.test`: thêm garage, lối xe, biến thể; hai nhà cùng các mảnh, B = màu A qua bảng "bỏ hoang";
    - test 4 góc xoay: chuẩn hóa cả `yaw`;
    - `furniture.test`: bàn thợ, hộp bao khi xoay;
    - `surfaces.test`: trụ của đồ trang trí.
- **Công cụ:** lint, `tsc`, `build`, `build:editor`, `check:bundle`, `map:check --deep` sạch (2 cảnh báo cũ ở `neighborhood-50-lab`).
- **Playwright PASS:**
  - mới `g3b-decor-editor-browser`: tab "Trang trí", đặt cụm "bàn ăn" bằng chuột thật (6 object ID mới, hoàn tác một bước), Inspector đồ trang trí, biến thể prefab và instance;
  - `g3a-furniture-editor-browser`, `m11c1b-interior`, `p2-lighting`, `p2-vision` (Vite mới), `m11b-floors`, `worlds`, `m11a/m11c2/m5-editor`, `m11c1a` (`GPU=1`).
- **Soát bằng mắt** (tắt mask để xem cả nhà): nhà A, nhà B tầng trệt và tầng trên, garage. Vệt dầu ban đầu đen như lỗ thủng; đã làm nhạt màu.

## 7. Giới hạn còn lại

- Chỉ nhà mẫu và garage có đồ trang trí và biến thể; `neighborhood-50` để đợt rollout (G6).
- Đồ trang trí chỉ xoay quanh trục đứng (không có cốc đổ nghiêng). Vệt dầu là các đĩa bát giác đục, không trong suốt.
- Không có collider cho đồ trang trí: đi xuyên qua thùng các-tông được. Đó là chủ ý của kế hoạch; thùng to cản đường thì nên dùng prop.
- Container cao vẫn không mờ khi che nhân vật (như trước).
- Editor mới vẽ khung đồ trang trí, chưa vẽ hình thật (G5).
