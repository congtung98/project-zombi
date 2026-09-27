# Prefab library P2–P5: nội dung thư viện chung

Nhánh `feature/prefab-library`, tiếp theo P1 (docs/prefab-library-p1.md). Chủ dự án yêu cầu làm liền P2 → P5, commit và push từng sprint, sau đó merge vào `feature/world-generator` (không merge vào master). Quyết định D1–D8 của P1 vẫn áp dụng: tối đa 4 tầng (D4), chỉ 15 vật phẩm hiện có (D5), công trình lớn chỉ đặt tay (D6), phong cách trộn, ưu tiên Việt Nam (D7).

## Cách dựng nội dung

- **Bộ dựng** `scripts/map-tools/library/builder.ts` viết đúng JSON mà trình sửa prefab viết:
  - tường chạy (tự khoét cửa, cửa sổ), cửa có hướng mở, cửa sổ, phòng có đèn và công tắc;
  - đồ đạc lấy từ preset của editor, đặt áp tường;
  - cầu thang, mặt nền;
  - compound (`Compound`: công trình, tường, rào, cây, trang trí, mặt nền quanh pivot).

  Prefab dựng ra là nội dung bình thường, sửa tiếp được trong editor.
- **Quy tắc tự áp dụng khi dựng:**
  - tâm cửa nằm trên lưới 0,5 m, cửa rộng tối thiểu 1 m;
  - bản lề đặt về phía đầu tường gần hơn, để cánh cửa áp vào tường khi mở;
  - cửa sổ bị đồ đạc chắn thì tự dời dọc tường (không còn chỗ thì bỏ);
  - công tắc đèn tự chọn chỗ tới được: cạnh cửa trước, rồi dọc các bức tường.
- **Kiểm tra tiếp cận nhanh** (`access.ts`) mô phỏng đúng các quy tắc của deep check, chạy ngay khi dựng và báo lỗi kèm ID:
  - lưới nav 0,5 m, vật cản nở 0,4 m, mọi cửa mở (cánh cửa chắn chỗ nó quay tới);
  - các tầng nối với nhau qua cầu thang;
  - vật tương tác được coi là tới được khi có điểm đứng liên thông, nằm trong tầm với và nhìn thấy nó.

  `debug.ts` in sơ đồ lưới từng tầng dạng ký tự; `why.ts` cho biết vật cản nào chặn một ô.
- **Trình chạy** `node scripts/map-tools/library-build.ts <p2|p3|p4|p5>`:
  - thêm prefab và compound của sprint vào `content/maps/prefab-library`;
  - xếp thành một dải trưng bày mới phía nam, tự thêm chunk và nới vùng chơi;
  - từ chối nếu mục của sprint đã có.
- **Test** `src/map/editor/libraryContent.test.ts`: mỗi prefab và compound của thư viện, đặt một mình trong world trống, phải qua validator không lỗi và deep check thật không cảnh báo nào (cửa, tủ, công tắc, rèm đều tới được; cầu thang dùng được; tủ nằm trong phòng; không chồng collider); đồng thời không vượt 4 tầng.

## P2 — nhà ở (13 prefab)

| prefabId | Tên | Kích thước | Tầng | Phong cách |
|---|---|---|---|---|
| house/cap4 | Nhà cấp 4 | 6 × 12 | 1 | Việt Nam |
| house/cottage | Nhà nhỏ | 8 × 8 | 1 | chung |
| house/bungalow-l | Bungalow chữ L | 12 × 10 | 1 | Mỹ |
| house/garden | Nhà vườn | 10 × 9 | 1 | Việt Nam |
| house/longhouse | Nhà dài nông thôn | 14 × 7 | 1 | Việt Nam |
| house/ranch | Nhà Mỹ một tầng | 12 × 9 | 1 | Mỹ |
| house/tube-4x16 | Nhà ống 4 × 16 | 4 × 16 | 2 | Việt Nam |
| house/tube-5x18 | Nhà ống 3 tầng | 5 × 18 | 3 | Việt Nam |
| house/shophouse | Nhà phố kinh doanh | 5 × 20 | 3 | Việt Nam (nhóm thương mại) |
| house/villa | Biệt thự | 14 × 12 | 2 | Việt Nam |
| house/suburban | Nhà ngoại ô Mỹ | 12 × 10 | 2 | Mỹ |
| house/l-two-storey | Nhà chữ L hai tầng | 12 × 12 | 2 | chung |
| apartment/block-4 | Chung cư 4 tầng | 30 × 14 | 4 | chung |

- **Biến thể:** mọi nhà có 3 biến thể nhìn (intact, lived-in, abandoned); chung cư không có.
- **Loot:** dùng bảng loot nhà ở sẵn có (`house-kitchen`, `house-wardrobe`, `house-nightstand`, `store-shelf`, `hardware-shelf`, `tool-shelf`).
- **Placement cho generator:**
  - lô dân cư đặt được mọi nhà;
  - nhà ống và nhà phố vừa lô hẹp của profile vn-urban;
  - chung cư cần mặt tiền 32–60 m;
  - nhà dài nông thôn nhận cả zone ruộng.
- **Chung cư:** mỗi tầng có một hành lang giữa, lõi cầu thang hai làn đi zig-zag ở phía bắc, và 4 căn (phòng khách + phòng ngủ).

### Lỗi game tìm ra nhờ P2 (đã sửa)

`navLayers.ts` dựng một lưới nav riêng cho mỗi tầng trên của từng nhà. Lưới đó lại nhận cả cửa và cửa sổ của mọi nhà khác có sàn cao gần bằng (±0,5 m, ví dụ tầng 3 m và tầng 3,2 m).

- Hậu quả: bảng "cửa nào thuộc lưới nào" bị nhà sau ghi đè, nên trạng thái cửa tầng trên của nhà trước không bao giờ tới được lưới của chính nó (cửa luôn đóng trong nav).
- Ảnh hưởng: world có từ 2 nhà nhiều tầng trở lên thì zombie đi sai ở tầng trên, và deep check báo nhầm là không tới được.
- Cách sửa: lưới tầng của một nhà chỉ nhận cửa và cửa sổ của chính nhà đó (theo `buildingId`).
- Test hồi quy: một biệt thự (tầng 3,2 m) và một nhà ngoại ô (tầng 3 m) đặt cạnh nhau, tầng trên của cả hai đều liên thông với đường.

### Kiểm chứng P2

- 13/13 prefab mới qua deep check thật khi đứng riêng; world thư viện `map:check --deep` sạch.
- `npm test`: 918 pass, 13 skip. Test generator "vn-urban chỉ đặt nhà ống" được mở rộng cho 3 nhà hẹp mới.
- tsc, oxlint, build, build:editor, check:bundle sạch.
- Chơi thử world thư viện: nhà ống 2 và 3 tầng, nhà phố (cắt lớp nhìn vào trong), biệt thự, nhà ngoại ô hiện đúng.

## P3 — dịch vụ (5 prefab)

| prefabId | Tên | Kích thước | Tầng | Nội dung |
|---|---|---|---|---|
| service/bank | Ngân hàng | 18 × 14 | 1 | Sảnh giao dịch, 4 quầy, ATM; khu nhân viên; kho tiền (két `bank-vault`); kho hồ sơ; phòng giám đốc |
| service/bookstore | Nhà sách | 14 × 12 | 2 | Hai dãy kệ sách (`bookstore-shelf`), quầy, kho; tầng trên là phòng đọc và văn phòng |
| service/auto-repair | Gara sửa xe | 16 × 12 | 1 | Xưởng có cửa xe 3 m, ô tô đang sửa, bàn thợ (`workshop-bench`), kệ phụ tùng (`garage-shelf`); văn phòng; kho |
| service/garage-double | Garage đôi | 10 × 7 | 1 | Hai cửa xe mở ra ngoài, một ô tô, kệ |
| service/machine-shop | Xưởng cơ khí | 22 × 16 | 1 | Xưởng máy (5 máy, 3 bàn thợ), kho vật tư, văn phòng, vệ sinh |

Cùng với lab-garage có sẵn, thư viện có 3 loại garage.

- **Bảng loot theo địa điểm** (`lootTables.ts`, chỉ dùng 15 vật phẩm có sẵn, theo D5): `office-desk`, `bank-vault`, `bookstore-shelf`, `garage-shelf`, `workshop-bench`, `medical-cabinet`, `pharmacy-shelf`, `police-armory` (chỉ vũ khí cận chiến), `locker`, `canteen-fridge`, `kiosk-counter`. Muốn đổi loot một loại địa điểm thì sửa bảng, không phải sửa prefab.
- **Sửa generator:** trước đây điểm spawn zombie chỉ cần không nằm trên vật cản. Với các công trình công nghiệp đặt sát nhau, một điểm spawn rơi vào khoảng sân bị bao kín (deep check báo `spawn-unreachable`). Giờ generator loang trên lưới 0,5 m (vật cản nở 0,4 m, như lưới nav) từ điểm xuất phát của người chơi và chỉ giữ điểm spawn tới được.
- **Kiểm chứng:** 5/5 prefab qua deep check thật khi đứng riêng; world thư viện sạch; `npm test` 923 pass, 13 skip; tsc, oxlint sạch; chơi thử thấy ngân hàng và nhà sách hiện đúng.

## P4 — công trình công cộng lớn (5 prefab, 4 compound)

Theo D6, các công trình này chỉ đặt tay: prefab không có `placement` nên generator không bao giờ tự chọn. Compound thì có sẵn footprint và `placement` (zone công cộng, mặt tiền) để sau này generator dùng.

Cả năm công trình dựng theo cùng một kiểu (`corridorBuilding` trong `p4-public.ts`):
- mỗi tầng có một hành lang, phòng ở hai bên, mỗi phòng có cửa ra hành lang và cửa sổ ở tường ngoài;
- lõi cầu thang 7 m đi zig-zag: làn A đi lên từ tầng chẵn, làn B từ tầng lẻ;
- đồ đạc bày theo loại phòng: phòng bệnh, phòng khám, nhà thuốc, căng tin, phòng mổ, văn phòng, phòng họp, kho vũ khí, phòng thay đồ, buồng giam, lớp học, giảng đường, thư viện, kho;
- cửa ở hai đầu hành lang mở ra ngoài, để cánh cửa không chắn hành lang.

| prefabId | Tên | Kích thước | Tầng | Nội dung |
|---|---|---|---|---|
| public/hospital | Bệnh viện | 40 × 24 | 3 | 2 lõi thang; cấp cứu, 5 phòng khám, nhà thuốc (`pharmacy-shelf`), căng tin (`canteen-fridge`), sảnh; 9 phòng bệnh, trạm y tá, kho thuốc; 2 phòng mổ, hồi sức, văn phòng (`medical-cabinet`, `office-desk`) |
| public/police-station | Đồn cảnh sát | 26 × 18 | 2 | Trực ban, kho vũ khí (`police-armory`), phòng thay đồ (`locker`), 2 buồng giam, hỏi cung; tầng trên là văn phòng, phòng trưởng đồn, kho hồ sơ |
| public/school-block | Dãy lớp học | 44 × 12 | 2 | Hành lang chạy dọc phía nam; 6 lớp học, phòng giáo viên, thư viện |
| public/lecture-hall | Giảng đường | 48 × 16 | 3 | 2 lõi thang; 7 giảng đường, phòng seminar, phòng thí nghiệm, thư viện, văn phòng khoa, căng tin |
| public/dormitory | Ký túc xá | 30 × 14 | 3 | Theo kiểu chung cư |

| compoundId | Tên | Thành phần |
|---|---|---|
| compound/police-station | Đồn cảnh sát có bãi xe | Đồn, bãi đỗ nhựa, 2 xe cảnh sát, đèn đường, cột cờ |
| compound/hospital | Bệnh viện có sân trước | Bệnh viện, sân bê tông, chỗ đỗ xe cứu thương và xe, cây, ghế |
| compound/high-school | Trường cấp ba | 2 dãy lớp xếp chữ L quanh sân trường, sân bóng rổ, cột rổ, cột cờ, hàng rào có cổng phía nam, cây, ghế, thùng rác |
| compound/university | Khuôn viên đại học | 2 giảng đường xếp chữ U, ký túc xá, quảng trường lát gạch, bãi cỏ, lối đi, đài phun nước (mặt nước chặn đi lại), cây, ghế |

- **Kiểm chứng:** 5 prefab và 4 compound qua deep check thật khi đứng riêng (compound kiểm tra cả việc các thành phần không chồng collider lên nhau); world thư viện sạch; `npm test` 932 pass, 13 skip; build và check:bundle sạch.
- **Chơi thử:** trường cấp ba hiện đúng (2 dãy lớp, sân, sân bóng rổ, rào có cổng, cây).
- **Test được cập nhật:** test WG3 giờ chấp nhận prefab không có placement, với điều kiện đó là công trình công cộng đặt tay. Test "thêm cả thư viện vào world trống" kiểm tra rằng compound quá lớn so với world bị từ chối trọn vẹn, không đặt dở dang.

## P5 — nhà tù, nghĩa trang, công viên, hồ nước (4 prefab, 5 compound)

| prefabId | Tên | Kích thước | Tầng | Nội dung |
|---|---|---|---|---|
| public/prison-block | Khối giam | 36 × 20 | 2 | 34 buồng giam ở hai bên hành lang; phòng quản giáo, nhà ăn, phòng y tế, phòng thay đồ, kho |
| public/guard-tower | Chòi canh | 8 × 4 | 2 | Cầu thang trong; chòi quan sát có cửa sổ bốn phía, tủ trực |
| landscape/chapel | Nhà nguyện | 8 × 10 | 1 | Ghế băng, bàn thờ, tủ đồ lễ |
| landscape/kiosk | Ki-ốt | 4 × 4 | 1 | Quầy bán hàng (`kiosk-counter`) |

| compoundId | Tên | Thành phần |
|---|---|---|
| compound/prison | Nhà tù | Tường bao 64 × 52 cao 4 m có cổng phía nam, khối giam, 4 chòi canh quay cửa vào sân, ki-ốt làm nhà gác cổng, sân đất, sân bóng rổ, ghế, đèn |
| compound/cemetery | Nghĩa trang | 32 ngôi mộ (bia mộ có va chạm, nền mộ bằng đất), lối đi giữa, nhà nguyện, thông, hàng rào có cổng, ghế |
| compound/park | Công viên | Bãi cỏ, lối đi chữ thập, sân chơi (cầu trượt, xích đu, hố cát), ki-ốt, ghế, cây, thùng rác, đèn, bồn hoa (zombie đi vòng, người chơi bước qua được) |
| compound/pond | Hồ nước nhỏ | Mặt nước elip 16 × 10 (chặn đi lại) trên bờ đất, bãi cỏ, cây, ghế, bụi |
| compound/lake | Hồ lớn | Mặt nước elip 34 × 20 trên bờ đất, cầu gỗ vẽ trên mặt nước, lối đi hai bên, cây, ghế, đèn |

- **Placement cho generator (dùng sau này, D6):** mọi compound có `placement` ghi zone phù hợp. Nhà tù: công cộng, công nghiệp. Nghĩa trang: công cộng, đất trống, ruộng. Công viên: công cộng, dân cư, đất trống. Hồ: thêm cả rừng và ruộng.
- **Hai lưu ý khi làm compound có nước:**
  - Không để hai mặt nước chồng nhau: tường chắn vô hình của chúng sẽ đè lên nhau, deep check báo `collider-overlap`. Hồ lớn vì vậy dùng một elip.
  - Cầu gỗ là mặt nền vẽ ở lớp 3, nằm trên mặt nước; không dùng khối có va chạm vì sẽ chồng với tường chắn của nước.
- **Kiểm chứng:**
  - 4 prefab và 5 compound qua deep check thật khi đứng riêng.
  - World thư viện (117 chunk, 37 prefab, 10 compound) `map:check --deep` sạch; mọi world khác cũng sạch.
  - `npm test` 941 pass, 13 skip; tsc, oxlint, build, build:editor, check:bundle sạch.
  - Chơi thử: nhà tù, công viên, nghĩa trang, hồ lớn hiện đúng.

## Tổng kết P1–P5

- **Thư viện chung:** 37 building prefab và 10 compound, gồm 10 prefab cũ và compound mẫu của P1.
  - Nhà ở: 6 nhà 1 tầng, 6 nhà 2–3 tầng, chung cư 4 tầng, cộng các nhà cũ.
  - Dịch vụ: ngân hàng, nhà sách, gara sửa xe, garage đôi, xưởng cơ khí, tiệm tạp hóa, cửa hàng, nhà kho.
  - Công cộng: bệnh viện, đồn cảnh sát, trường cấp ba, đại học (giảng đường và ký túc xá), trạm y tế, nhà tù, chòi canh.
  - Cảnh quan: nhà nguyện, ki-ốt, nghĩa trang, công viên, hai hồ nước.
- **Theo các quyết định D1–D8:**
  - D4: không nhà nào vượt 4 tầng.
  - D5: loot chỉ gồm 15 vật phẩm có sẵn, chia theo 11 bảng loot riêng từng loại địa điểm.
  - D6: công trình công cộng lớn và mảnh cảnh quan chỉ đặt tay; nhà ở và dịch vụ có `placement` cho generator.
  - D7: phong cách trộn, ưu tiên Việt Nam.
- **Hai lỗi của game/generator tìm ra và đã sửa trong lúc làm:**
  - lưới nav tầng trên của mỗi nhà nhận nhầm cửa của nhà khác có tầng cao gần bằng;
  - điểm spawn zombie có thể rơi vào sân bị bao kín.
- **Giới hạn còn lại:**
  - Nội thất là khối hộp dùng các asset có sẵn: chưa có asset riêng cho giường bệnh, bia mộ, máy móc, cầu trượt (hiện là hộp màu).
  - Generator chưa đặt compound và chưa gộp lô lớn (D6, để sau).
  - Nội dung được dựng bằng script một lần. Sửa tiếp trong editor bằng cách mở world `prefab-library`, rồi xuất và chạy `map:unpack`.
