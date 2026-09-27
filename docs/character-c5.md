# Nhân vật C5: mẫu zombie, animation và biến thể

Ngày 27/09/2026. Bước 6 của `docs/Character_Zombie_Model_Animation_Plan.md`.

Zombie dùng lại thân và rig của player. Khác biệt đến từ **dáng đứng/đi**, **tay theo trạng thái AI**, **nhịp bước lệch nhau**, **quần áo bạc màu, bẩn, dính máu, rách**. Mọi thứ chọn một lần từ ID, ổn định qua save và chunk streaming. Tất cả **chỉ để hiển thị**: tốc độ, tầm đánh, máu, AI không đổi. Test kiểm tra rằng không module simulation nào import phần vẽ nhân vật.

## 1. Dáng (`character/zombieVariants.ts`, `POSTURES`)

| ID | Dáng | Đặc điểm |
| --- | --- | --- |
| `shambler` | Lê chân | Kéo chân trái (sải 60 %, gối gần thẳng), đầu nghiêng, chậu lắc theo chân lành |
| `hunched` | Khom | Gập eo 0,58 rad, ngẩng đầu nhìn tới, gối chùng, bước ngắn, tay buông thấp |
| `lurcher` | Lệch vai | Vai phải thấp (ngực nghiêng 0,2), tay phải buông thõng kể cả khi đuổi (chỉ vươn tay trái), kéo chân phải |
| `stiff` | Cứng đờ | Thẳng người, gối gần không gập, bước nhỏ, tay gần thẳng, đầu giật nhanh |

- **Tay theo trạng thái** (chỉ đọc `z.ai`):
  - CHASE, ATTACK, APPROACH_STRUCTURE, ATTACK_STRUCTURE: vươn tay (và mắt đỏ như trước);
  - các trạng thái khác: buông tay, đung đưa theo bước.
  - Chuyển mượt trong ~0,35 s.
- **Không đi đều như đội hình**: mỗi zombie có pha bước ban đầu, hệ số sải 0,85–1,15 (nhịp chân khác nhau ở cùng tốc độ thật) và lệch đồng hồ lắc lư. Nhịp chân vẫn theo tốc độ đo được của từng con.
- Không có random theo frame: mọi biến thể là hằng số theo ID. `idHash` = FNV-1a cộng bước trộn murmur3, nên các ID liên tiếp vẫn phân tán đều.
- Đòn đập của zombie: vẫn hai tay (mọi dáng), gối chùng khi đập (C4).

## 2. Ngoại hình

- **Màu**:
  - áo từ 11 màu đời thường, quần từ 7 màu;
  - mỗi con bạc màu 20–52 % về xám ấm và tối đi một chút (test: không con nào sặc bằng áo đỏ của player);
  - tóc 4 màu; da 7 tông nhợt xám/vàng (không xanh lá).
- **Quần áo bẩn/rách** (khoảng 7/10 con): hình dạng "worn" riêng của mỗi bộ, gồm:
  - 3 mảng lớn trên thân trước/sau, 1 trên đùi phải, 1 trên ống quyển trái;
  - gấu rách (5 mảnh vải thõng) với áo thả ngoài.
  - Mảng dùng ô màu `stain`, mỗi con một sắc: đất `#4f4435`, máu khô `#4a211d`, bẩn `#3e3a30`.
  - Không dùng alpha, không lộ thân sai lớp. Mảng đủ lớn để đọc ở zoom 28.
- Ô màu mới `metal` (khóa thắt lưng, khóa yếm) tách khỏi `stain`.

## 3. Geometry và bộ nhớ

- Khóa hình dạng: `preset/hair/outfit[/worn]`, tối đa 72 (36 sạch + 36 worn).
- **Geometry giờ có chỉ số** (`mergeVertices` trong `MeshBuilder.build`). Mỗi hình dạng 1 530–2 060 tam giác, 80–120 KB (trước ~200 KB không chỉ số). Tối đa ~7,5 MB nếu gặp đủ 72; bình thường ít hơn nhiều.
- Chỉ dựng khi gặp lần đầu, dùng chung cho mọi con.
- Vòng đời bench (ID tăng dần qua 8 vòng): geometry 62 → 86 là các khóa lần đầu gặp. Texture và program không đổi.

## 4. Kiểm tra đã chạy

- `zombieVariants.test.ts` (mới, 4 test):
  - biến thể ổn định theo ID; 60 con phủ đủ 4 dáng; pha và sải phân tán;
  - 4 dáng có độ ngả thân khác nhau; lurcher vươn một tay; mọi dáng: tay buông > −0,6, tay vươn < −0,75, chênh > 0,6; chân lê sải ngắn hơn;
  - 50–90 % con mặc đồ bẩn; màu bạc; vết bẩn khác màu áo;
  - không file nào trong `game/core`, `systems`, `entities`, `world` import `rendering/character`.
- `body.test.ts`:
  - mọi dáng × buông/vươn, đồ worn: chân trên sàn suốt chu kỳ; tay buông vẫn trong capsule;
  - geometry có chỉ số (đỉnh < 75 % số chỉ số);
  - giới hạn khóa hình dạng × 2.
- Toàn bộ: **654 test**; lint, tsc, build, check:bundle sạch.
- Bench (`docs/character/c5/bench-10`, headless D3D11 uncapped, cùng máy): 0/10/30 zombie → draw call 52/70/105 (như C1). Tam giác 30 zombie 114 k. Frame 1,0/1,5/2,4 ms.
- Ảnh:
  - `zombies-z160` / `zombies-z28`: hàng trên 4 dáng khi lang thang (tay buông), hàng dưới khi đuổi (tay vươn; lurcher một tay), đồ bẩn;
  - `lineup-z100`, `close-z200`: zombie với màu bạc và vết bẩn.

## 5. Giới hạn

- Game chưa có zombie nhanh/chậm theo loại. Nhịp chân đã theo tốc độ đo được, nên khi có loại mới cũng tự đúng.
- Vết thương không làm chi tiết nhỏ (theo kế hoạch). Mặt zombie giống người, chỉ khác màu da và mắt.
