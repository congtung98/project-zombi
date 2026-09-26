# Đồ họa G3a: registry đồ đạc

Ngày 27/09/2026. Bước 4 của `docs/Graphics_Improvement_Implementation_Plan.md` (§7, phần "Bộ furniture đầu tiên"). Cụm trang trí và biến thể là G3b.

Đồ đạc không còn là hộp màu. Một prop hoặc container có thể mang `visual.assetId`; khi đó renderer vẽ các bộ phận của mẫu **bên trong đúng hộp cũ**. Hộp vẫn là collider, vật chắn nav và tầm nhìn, và đích tương tác. ID, loot và save không đổi.

13 mẫu:
- giường, sofa / ghế bành, bàn, bàn làm việc, ghế tựa;
- tủ bếp có mặt đá, tủ thấp, tủ lạnh, tủ quần áo, tủ đầu giường;
- kệ sách, kệ kho, thùng gỗ.

Nhà mẫu (`graphics-lab`, `graphics-rotations`) dùng 16 món. Khu phố (`neighborhood-50`) chưa gán mẫu nào và vẫn giữ hình cũ; việc áp cho cả map để đến đợt rollout.

## 1. Registry (`src/game/rendering/furniture/`)

- **`catalog.ts`** (dữ liệu thuần, validator và editor dùng chung): danh sách ID, nhãn, và cờ `deep` cho mẫu sâu hơn rộng (giường).
- **`assets.ts`**: bộ phận của từng mẫu, là các hộp trong khung riêng của mẫu.
  - Trục: x ngang mặt trước, y từ sàn lên, z từ lưng (−d/2) ra mặt trước (+d/2).
  - Mọi bộ phận nằm trong hộp. Bộ phận nào lố ra sẽ bị cắt lại và ghi tên vào `clipped`; test giữ danh sách này rỗng ở mọi kích thước đã thử.
  - Số lượng theo hộp:
    - sofa: một đệm cho mỗi khoảng 0,65 m (ghế bành có 1 đệm);
    - tủ quần áo: 1–3 cánh;
    - giường: 1 hoặc 2 gối;
    - tủ bếp: một mô-đun mỗi khoảng 0,6 m, có chậu rửa khi dài từ 1,6 m;
    - kệ: số tầng theo chiều cao.
  - Chi tiết cố định có kích thước vật lý (tay nắm ≥ 2,5 cm, chân tủ, len tủ), để đọc được ở 28 px/m.
  - Không có ngẫu nhiên: cùng một hộp luôn ra cùng một bộ phận. Biến thể có seed thuộc G3b.
  - Màu nội dung là vật liệu chính (chăn, vải bọc, cánh tủ, gỗ mặt bàn). Phần còn lại dùng màu phụ cố định (ga trắng, mặt đá, tay nắm kim loại, sách, thùng giấy) hoặc sắc độ của màu chính.
  - Mỗi bộ phận có bề mặt G1 riêng: `fabric`, `wood`, `paintedMetal` hoặc `matte`. Cả bốn đều ánh xạ UV cục bộ, nên vân đi theo từng bộ phận khi đồ xoay, đúng yêu cầu của chủ dự án.
- **`placement.ts`**: đặt bộ phận vào hộp thế giới theo hướng `facing` (0–3). Hộp luôn song song trục, nên xoay chỉ là hoán vị trục và bộ phận vẫn là hộp song song trục.
  - Chúng được vẽ trong batch tĩnh như tường, nên **không thêm draw call**.
  - Khi nội dung không ghi hướng, `autoFacing` chọn:
    - lưng áp mặt tường trong vòng 0,3 m che ít nhất nửa cạnh, ở tầm cao của món đồ;
    - nếu có hai tường (góc phòng), chọn hướng cho mẫu dáng quen (giường sâu hơn rộng);
    - không có tường thì cũng theo dáng quen.
  - Thứ tự xét bắt đầu từ số lần xoay của instance, nên mọi bản xoay của cùng một nhà chọn cùng một mặt.

## 2. Dữ liệu và runtime

- **Schema:** `PropObject.visual?` và `ContainerObject.visual?` là `FurnitureVisual { assetId, facing? }`. Dùng được cả trong prefab lẫn cho object đặt thẳng trong chunk.
- **Validator:**
  - `assetId` lạ là **cảnh báo** `unknown-asset`, và runtime vẽ hộp trơn thay vào. Ngoại hình không bao giờ chặn việc nạp map, đúng §9 của kế hoạch.
  - `facing` ngoài 0–3 là lỗi `schema`.
- **Resolver:** cộng `facing` với số lần xoay của instance. Hướng tự động giữ lại `turn` của instance cho bước chọn ở trên. Kết quả vào `WallDef.visual` và `ContainerDef.visual` (`FurnitureLook`).
- **`collectStaticItems`:** prop/container có mẫu hợp lệ không vẽ hộp nữa mà vẽ các bộ phận. Mỗi bộ phận:
  - có `anchor` là hộp gốc, nên cắt lớp và làm mờ coi cả món đồ là một;
  - giữ ID, vai trò (`prop`/`container`) và tòa nhà của món đồ;
  - có `furniture { assetId, part, facing }` để test và debug.
  - Prop cao vẫn mờ khi che nhân vật; container vẫn không mờ, như trước.
- **Collider, nav, tầm nhìn, loot:** test so với cùng map không có `visual` và thấy **giống hệt**.

## 3. Mask nội thất: đồ cao không còn đen khi đang nhìn vào

Tủ và kệ cao (từ 1,5 m) là vật chắn tầm nhìn loại `furniture`. Tia nhìn dừng ở mặt trước, nên các ô dưới chính cái tủ bị coi là "chưa thấy". Kết quả là kệ sách tối đen dù người chơi đang nhìn thẳng vào nó. Lỗi này có từ M11c-1B, nhưng giờ mới lộ rõ vì kệ có sách.

`InteriorVisibility`:
- Nếu một ô ngay sát chân món đồ (vòng một ô quanh hộp) đang được thấy, các ô có tâm nằm trong hộp cũng được thấy, và được ghi là đã khám phá.
- Chỉ mở chân của chính món đồ; phía sau nó vẫn tối.
- Kiểm theo trạng thái trước lượt mở, nên món này không làm lộ món kế bên.
- Danh sách occluder `furniture` được lọc sẵn một lần, và chỉ lọc lại khi chunk stream làm đổi danh sách.

Test mới trên lab:
- đứng ngoài bán kính gần, nhìn về kệ: cả ba ô dưới kệ được thấy;
- quay đi: các ô đó tối lại nhưng vẫn ghi là đã khám phá;
- tầng trên không lộ gì.

## 4. Editor

- **Inspector** của prop/container trong cả prefab editor và world editor có hai trường:
  - **"Mẫu hình":** Hộp trơn, hoặc 13 mẫu. Một ID lạ được giữ lại và hiện là "không có trong registry".
  - **"Mặt trước":** Tự động (lưng áp tường), Nam, Đông, Bắc, Tây.
  - Mỗi lần đổi là một mục lịch sử.
- **Xoay (R):** xoay theo cả `facing` khi hướng đã được đặt. Một hộp vuông có hướng giờ cũng xoay được (trước kia báo "không có gì để xoay"). Hướng tự động vẫn tự động.
- **Palette:** các preset đồ đạc và tủ có sẵn mẫu. Mới có ghế tựa, bàn làm việc, ghế bành, kệ sách. Thùng gỗ trong palette world dùng `furniture/crate`.
- Viewport editor vẫn vẽ hộp. Xem trước bằng chính factory của game để đến G5; chơi thử trong editor đã thấy đồ đạc thật.

## 5. Nội dung

`lab-house`, hai bản giống hệt nhau:
- **Hướng đặt tường minh** cho những món không tựa tường: ghế bành nhìn về bàn nước, hai ghế ăn đối diện nhau, giường tầng trên (đầu cách tường 0,35 m).
- **Còn lại để tự động.** Sofa, kệ sách, tủ bếp, tủ lạnh ở góc, giường, tủ đầu giường, hai tủ quần áo, bàn làm việc và kệ hành lang đều quay đúng mặt.
- **Hai giường đổi màu thành màu chăn:** đỏ đất `#8a5a52` và xanh xám `#5f6f86`. Chỉ đổi ngoại hình.

## 6. Đo

**Môi trường:**
- RTX 3060, i5-11500, 16 GB, Windows 11, Chrome 154 headless, ANGLE D3D11.
- 1280×800, DPR 1, bóng high, 8 zombie đứng yên, khởi động 3 s, lấy mẫu 6 s.
- Lúc đo, máy còn chạy dev server và trình duyệt của chủ dự án.

**Cách đo:**
- A/B xen kẽ trong cùng phiên: G2 (commit 9046c66, dựng từ một worktree tạm) và G3a, hai lượt với thứ tự đảo nhau.
- `--uncapped`. Số liệu ở `docs/graphics/g3a/report-ab.json`.

| | G2 | G3a |
|---|---|---|
| Draw call ngoài trời / trong nhà | 154 / 63 | 154 / 63 |
| Tam giác (gồm lượt bóng) | 9,9–14,0 k | 14,3–20,4 k |
| Instance batch (lab) | 1 054 | 1 698 |
| Geometry / texture trên GPU | 57–59 / 14 | 57–59 / 14 |
| Frame median, 11 cảnh × 2 lượt | 2,0–5,7 ms | 2,1–4,5 ms |
| Frame p95 | 3,1–12,9 ms | 3,3–11,1 ms |

- **Không đo được khác biệt:** chênh giữa hai bản nhỏ hơn chênh giữa hai lượt của cùng một bản. Máy bận nên p95 lên tới 9–13 ms ở cả hai bản; con số này không đại diện cho máy của chủ dự án khi chơi thật.
- **Nhiều tam giác hơn** vì 32 món đồ thành khoảng 680 hộp nhỏ, mỗi hộp 12 tam giác. Dữ liệu batch trên GPU tăng 50 KB.
- **Vòng đời:** 10 vòng vào/ra ở lab, bản xoay và `neighborhood-50`, số tài nguyên không tăng.
- **neighborhood-50:** draw call, tam giác, texture, geometry và instance giống hệt G2.
- **Bundle game:** +14,1 KB (+4,9 KB gzip) so với G2, đa phần là bộ dựng mẫu.
- **Tải (production, localhost, 2 lần):** vào ngay 1,13–1,23 s; ở menu 2 s thì 246–269 ms. Như G2.
- **Chưa đo** trên máy yếu và trên cửa sổ thật có vsync.

**Ảnh:**
- `docs/graphics/g3a/*.jpg`: 11 cảnh lab, gồm 4 cảnh mới cận đồ đạc ở zoom 60 (`close-living`, `close-kitchen`, `close-bedroom`, `close-upstairs`).
- `docs/graphics/g3a/rotations/`: 4 góc xoay.
- `docs/graphics/g3a/neighborhood-50/`.
- Bản trước là `docs/graphics/g2/`.

Script đo có thêm `--scenes=a,b` để chạy riêng vài cảnh.

## 7. Kiểm chứng

- **Test:** 604 qua, 13 skip.
  - Mới `rendering/furniture/furniture.test.ts` (11):
    - mọi mẫu nằm gọn trong hộp ở 2–3 kích thước;
    - số lượng đi theo hộp;
    - facing q đúng bằng facing 0 xoay q lần;
    - hướng tự động: tựa tường, góc phòng, không tường, bỏ qua tường chỉ có phía trên;
    - preset palette hợp lệ;
    - lab: 16 món mỗi nhà, bộ phận nằm trong collider và có neo, hướng đúng cả ở nhà xoay 180°;
    - collider, occluder và loot giống bản không có `visual`;
    - mẫu lạ là cảnh báo và vẽ hộp trơn, `facing` sai là lỗi;
    - xoay trong editor.
  - `interiorVisibility.test.ts` +1: đồ cao được thấy trọn khi nhìn vào.
  - `world.test.ts` cập nhật: preset thùng gỗ có `visual`.
  - Test 4 góc xoay (G2) giờ bao cả đồ đạc, kể cả hướng tự động. Nó làm tròn tới milimét, nên thêm một độ lệch 1e-4 mm cho khỏi lật ở mốc 0,5 mm do nhiễu dấu phẩy động.
  - Test bề mặt: sofa là vải và gỗ, tủ lạnh là kim loại sơn và matte.
- **Công cụ:** lint, `tsc`, `build`, `build:editor`, `check:bundle` sạch. `map:check --deep` sạch với các world đồ họa (2 cảnh báo cũ `spawn-indoors` ở `neighborhood-50-lab`).
- **Playwright PASS:**
  - mới `g3a-furniture-editor-browser`: Inspector đọc mẫu và hướng, đặt hướng, đổi mẫu, về hộp trơn, hoàn tác, R xoay hướng;
  - `m11c1b-interior`, `p2-lighting`, `p2-vision` (cả hai cần Vite khởi động mới), `m11b-floors`, `worlds`;
  - `m11a-editor`, `m11c2-editor`, `m5-editor` (đặt tủ từ preset có mẫu rồi chơi thử, loot vẫn đúng);
  - `m11c1a-cutaway` với `GPU=1`.
- **Hai test thời gian nav** (`navTiles`, `streaming`) có một lần hỏng khi chạy cả bộ lúc máy đang đo trình duyệt; chạy riêng và lần chạy cả bộ cuối đều qua. Chúng đã chập chờn như vậy từ trước.

## 8. Giới hạn còn lại

- Chưa có cụm trang trí, biến thể hay `materialSetId`: đó là G3b.
- `neighborhood-50` và các world khác chưa gán mẫu; để đến rollout.
- Đồ đạc chỉ đặt theo 4 hướng và song song trục. Ghế kéo lệch góc cần thêm góc xoay cho instance (G3b).
- Container cao vẫn không mờ khi che nhân vật (như trước).
- Viewport editor vẫn vẽ hộp, chưa có dấu mặt trước (G5).
- Tay nắm và thanh ngang chỉ khoảng 1 px ở zoom chơi (28 px/m); ở zoom 60 thì rõ.
