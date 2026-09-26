# Đồ họa G2: module kiến trúc

Ngày 27/09/2026. Bước 3 của `docs/Graphics_Improvement_Implementation_Plan.md` (sau G0 audit và G1 vật liệu).

Nhà có thêm các chi tiết kiến trúc:
- mái hông dốc trên ván diềm;
- khung cửa (ốp má cửa + nẹp hai mặt), pano hai mặt cánh cửa;
- khung, thanh chia chữ thập và bệ ngoài cho cửa sổ;
- dải chân tường ngoài, len chân tường trong nhà;
- bậc thềm trước cửa ra ngoài;
- mặt bậc thang bằng gỗ, cổ bậc sơn;
- sàn theo phòng (trường tùy chọn `visual` của phòng, chọn được trong editor).

Mọi chi tiết đều **chỉ để vẽ**: không collider, không vật chắn tầm nhìn, không điều hướng, không save. ID, loot và save không đổi. Schema map chỉ thêm một trường tùy chọn.

## 1. Chi tiết (`src/game/rendering/architecture.ts`)

Các chi tiết được sinh từ dữ liệu sẵn có (cửa, cửa sổ, mảnh tường, phòng), dựng bằng khối và vẽ trong batch tĩnh của chunk, nên không thêm draw call nào cho chúng.

| Chi tiết | Kích thước (m) | Vật liệu, màu | Vai trò cắt lớp |
| --- | --- | --- | --- |
| Ốp má + đầu ô cửa | 0,03 × dày tường | `matte` `#ddd5c4` | `opening` |
| Nẹp cửa hai mặt (2 đứng + 1 ngang) | 0,09 rộng, nhô 0,03 | như trên | `opening` |
| Khung cửa sổ (4 thanh) | 0,07 × 0,10 | như trên | `opening` |
| Thanh chia chữ thập | 0,04 × 0,06 | như trên | `opening` |
| Bệ cửa sổ ngoài | 0,05 dày, nhô 0,08, thừa 0,08 mỗi bên | `concrete` `#cfc8b8` | `opening` |
| Len chân tường (mặt trong) | cao 0,10, nhô 0,02 | `wood` `#5d4a3a` | `wall` |
| Dải chân tường ngoài (tầng trệt) | cao 0,35, nhô 0,03, bọc góc nhà | `concrete` `#7f786e` | `wall` |
| Bậc thềm (cửa tầng trệt ra ngoài) | sâu 0,8, cao 0,05, thừa 0,2 mỗi bên | `concrete` `#9a948a` | `floor` |
| Sàn theo phòng | hình chữ nhật của phòng, nâng 3 mm | `visual.floor` / `visual.floorColor` | `floor` |

- **Tỷ lệ:** chọn cho zoom chơi (28 px/m: nẹp 9 cm ≈ 2–3 px). Chi tiết dưới khoảng 5 cm không dựng.
- **Độ dày ô cửa:** lấy từ lanh tô phía trên, nên vách 0,2 m và tường ngoài 0,3 m đều khít.
- **Len và chân tường** chỉ đặt trên mảnh tường đứng trên sàn một tầng, không đặt trên lanh tô hay đầu cửa sổ:
  - mặt trong (theo vật liệu G1) có len;
  - mặt ngoài ở tầng trệt có dải chân tường;
  - ở góc nhà ngoài, dải chân tường được nối dài để khép góc.
- **Sàn theo phòng:** chỉ phòng có `visual.floor` mới được vẽ lớp sàn riêng, còn lại giữ sàn gỗ của nhà.
  - Sàn phòng tầng trên trừ lỗ cầu thang.
  - Đường chuyển vật liệu nằm ở giữa ô cửa (khung phòng nằm trên đường tâm tường).
  - Màu mặc định theo vật liệu: gạch lát `#c2bcae`, bê tông `#8d8a84`, thảm `#8a7a6a`.

### Hộp neo: chi tiết đi cùng chủ của nó

Mỗi chi tiết mang một **`anchor`**: hộp của tường hoặc ô cửa mà nó thuộc về. Hộp này dùng cho hai việc:
- **cắt lớp phân loại** chi tiết theo hộp neo (mặt phía camera / quay lưng / trong nhà);
- **fader** kiểm tra hộp neo khi quyết định làm mờ.

Còn việc giữ nguyên, cắt hay ẩn vẫn tính trên hình của chính chi tiết. Kết quả:
- Khung cửa ở tường phía camera bị cắt xuống 0,6 m như cánh cửa, phần đầu khung bị ẩn.
- Khung và bệ cửa sổ ở tầng trên ẩn cùng tầng.
- Nẹp cửa mờ đi cùng ô cửa.
- Không có chi tiết nào lơ lửng khi tường đã bị cắt.

Trước đây một nẹp nhô ra ngoài mặt tường sẽ bị xếp là "tự do" và không bị cắt. `doorwayBox` và `paneBox` giờ dùng chung giữa chi tiết, `DoorView` và `WindowView`.

## 2. Mái hông

- Tấm mái phẳng cũ giờ là **ván diềm** (0,2 m, nhô 0,3 m, sơn màu trim). Trên đó là **mái hông** (hình `hip` trong batch): nóc chạy theo cạnh dài, dốc 22° ở cả bốn mặt.
- **Hình học** (`src/game/rendering/unitShapes.ts`):
  - khối đơn vị có index, pháp tuyến phẳng, cùng thuộc tính với các hình khác của `BatchedMesh`;
  - độ dài nóc được làm tròn theo bước 0,02 để các nhà dùng chung ít geometry;
  - cache theo khóa, không bao giờ giải phóng (như material dùng chung).
- Nhà chữ L/T/U: mỗi hình chữ nhật một mái hông, chỗ nối thành rãnh.
- **Shader:** trên mặt dốc hướng ±X, u chạy theo mép mái, nên hàng ngói luôn song song với mép.
- Mái vẫn là `roof` (ẩn khi cắt lớp), vẫn là vật che (fader), vẫn đổ bóng. Trong nhà không đổi, vì phần mái nằm trên trần là ngoài trời với ánh sáng phòng.

## 3. Cửa

Mỗi mặt cánh cửa có hai pano nổi (trên và dưới), màu tối hơn cánh 22 %.

- **Vẫn theo cánh:** pano theo màu (HP) và độ mờ của cánh cửa.
- **Collider không đổi:** `@react-three/rapier` tạo collider cho mọi mesh con của `RigidBody`, nên pano nằm trong một group anh em trên cùng bản lề. Group này chép rung, cắt và ẩn của cánh.
- **Gộp:** 4 pano là **một geometry** dùng chung cho mọi cửa cùng kích thước, tức là một draw call mỗi cửa.
- Cánh cửa, tay nắm, điểm tương tác và bản lề giữ nguyên.

## 4. Sàn theo phòng: dữ liệu và editor

- **Schema** `RoomObject.visual?: { floor?, floorColor? }`:
  - `floor` phải là ID trong catalog vật liệu (validator: `schema` ở `/rooms/i/visual/floor`);
  - `floorColor` là `#rrggbb`.
  - Không có trường thì map cũ đọc như trước.
- **Resolver** chép sang `RoomPlacement.visual`.
- **Editor:** Inspector của phòng có ô chọn "Sàn" (Mặc định / Sàn gỗ / Gạch lát / Bê tông / Vải / Gỗ / Đất) và "Màu sàn". Xuất và nhập giữ nguyên trường này; chọn "Mặc định" thì xóa nó.
- **Nhà mẫu:** bếp lát gạch, phòng ngủ tầng trên trải thảm `#7a7268`.

## 5. World bốn góc xoay

`content/maps/graphics-rotations` (ẩn): 4 bản `lab-house` xoay 0°, 90°, 180°, 270°, hai đường giao nhau.
- Prefab là bản sao của `graphics-lab`; một test bảo đảm hai bản luôn trùng nhau.
- Test so **từng mảnh vẽ** của mỗi bản (vị trí và kích thước quy về khung của prefab, trục nóc, vật liệu): bốn bản giống hệt nhau.
- Riêng tấm sàn tầng trên: cách chia hình chữ nhật quanh lỗ cầu thang phụ thuộc hướng (có từ M11b). Diện tích như nhau nên nhìn giống hệt; test so theo diện tích.

## 6. Đo

Môi trường như G0/G1: RTX 3060, i5-11500, Chrome 154 headless, 1280 × 800, DPR 1, bóng high.

| | G1 | G2 |
| --- | --- | --- |
| Draw call ngoài trời / trong nhà | 144 / 59 | 154 / 63 (+1 pano mỗi cửa trong khung hình) |
| Tam giác (gồm lượt bóng) | 4,5–6,1 k | 10,0–14,0 k |
| Instance batch (lab) | 382 | 1 054 |
| Geometry / texture trên GPU | 55–56 / 14 | 57–58 / 14 |
| Frame median, `--uncapped`, 2 lần | 2,8–4,0 ms | 3,0–4,3 ms / 3,2–4,3 ms |
| Frame p95 | 6,3–9,2 ms | 6,6–10,2 ms |
| CPU median | 2,1–3,2 ms | 2,3–3,6 ms |

- **Chi phí CPU tăng nhẹ nhưng lặp lại được** (+0,3–0,5 ms median, +0,2–0,4 ms CPU).
  - Nguyên nhân khả dĩ: batch có gấp 2,8 lần instance, và three.js lọc từng instance mỗi frame cả ở lượt vẽ bóng. **Chưa đo tách riêng.**
  - Vẫn còn xa ngân sách 16,7 ms trên máy này. Nếu cần, xử lý ở G6 (tắt lọc từng instance cho chunk nhỏ, hoặc gộp chi tiết tĩnh).
- **Vòng đời:** 10 vòng ở lab, `neighborhood-50` và world xoay, số tài nguyên không tăng.
- **Bundle game:** +5,9 KB (+2,1 KB gzip).
- **Tải (production, localhost):** bấm ngay 1,13–1,17 s; ở menu 2 s thì 273 ms. Như G1.
- **Chưa đo** trên máy yếu và trên cửa sổ thật có vsync.

**Ảnh:**
- `docs/graphics/g2/*.jpg` là sau; `docs/graphics/g1/*.jpg` là trước.
- `docs/graphics/g2/neighborhood-50/` là sau; `docs/graphics/g1/neighborhood-50/` là trước.
- `docs/graphics/g2/rotations/`: 4 góc xoay.

## 7. Kiểm chứng

- **Test:** 592 qua, 13 skip.
  - Mới `rendering/architecture.test.ts` (8):
    - mỗi cửa 9 mảnh, mỗi cửa sổ 7, có neo; bậc thềm chỉ ở hai cửa ra ngoài và nằm ngoài nhà;
    - len ở cả hai tầng, dải chân tường chỉ tầng trệt và nằm ngoài;
    - sàn bếp/thảm đúng vật liệu, màu, độ cao; sàn tầng trên chừa lỗ cầu thang;
    - mái hông: nóc theo cạnh dài, dốc đều (sai số < 6 %);
    - cắt lớp theo neo: phần khung chạm sàn bị cắt, đầu khung ẩn, chi tiết tầng trên ẩn, len tầng trệt còn nguyên;
    - bản sao prefab trùng khít; 4 góc xoay giống hệt từng mảnh.
  - Mới `map/editor/roomVisual.test.ts` (1): đặt/xóa sàn phòng trong editor, xuất rồi nhập lại, validator sạch.
  - `validate.test.ts` +1: `visual` hợp lệ và không hợp lệ.
  - Cập nhật test cũ vì có mái hông và chi tiết: `cutaway`, `staticBatchData`, `polygon` (L), `floors`, `surfaces`.
- **Công cụ:** lint, `tsc`, `build`, `build:editor`, `check:bundle` (5 world tải theo nhu cầu) sạch. `map:check --deep` sạch với cả hai world đồ họa.
- **Playwright:**
  - PASS: `m11c1b-interior`, `p2-lighting`, `p2-vision`, `m11b-floors`, `worlds`, `m11a-editor`, `m11c2-editor`, `m5-editor`.
  - `m11c1a-cutaway` **PASS khi `GPU=1`** (tùy chọn mới của script).
  - Với SwiftShader mặc định, cảnh G2 chỉ còn khoảng 2 FPS (G0/G1 khoảng 3). Bước chờ 400 ms sau khi dịch chuyển chưa đủ một frame, nên phần đi phím thật qua cửa trượt thời gian: đọc trạng thái cũ. Đã kiểm bằng vị trí cuối và FPS; hành vi game đúng, vì bản GPU qua cả phần đó.
  - `p2-lighting`/`p2-vision` cần Vite khởi động mới, do chúng import module theo URL.
- **Soát bằng mắt:**
  - mái, khung, bệ, bậc thềm, dải chân tường rõ ở zoom 28, sắc ở zoom 60;
  - cắt lớp không để lại chi tiết lơ lửng;
  - 4 góc xoay đúng;
  - bếp lát gạch hiện đúng phòng.

## 8. Giới hạn còn lại

- Chưa có máng xối, đèn hiên, biển số nhà (chi tiết dưới vài px; để G4 cảnh quan).
- Nhà chữ L/T/U: mỗi phần một mái hông, chưa có mái liền.
- Cánh cửa bị cắt lớp: vân gỗ bị nén (như G1).
- Bậc thềm là hình vẽ không collider, chân nhân vật lún 5 cm khi đứng trên nó.
- Hai nhà phía đông-nam của lab và world xoay không có bóng mặt trời: camera bóng cố định (G0), để G4.
- Editor viewport vẫn vẽ hộp màu trơn, chưa có chi tiết (G5).
