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
