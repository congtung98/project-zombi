# Nhân vật C4: đòn đánh, phản ứng trúng đòn, cái chết

Ngày 27/09/2026. Bước 5 của `docs/Character_Zombie_Model_Animation_Plan.md`.

Kết quả:
- Đòn vung gậy có vai, thân và chậu tham gia; hai tay cầm cán.
- Phản ứng trúng đòn nghiêng theo hướng đòn (zombie).
- Cái chết: khuỵu gối rồi đổ theo 5 kiểu (ngửa, sấp, nghiêng trái, nghiêng phải, khuỵu gục). Xác nằm sát mặt sàn, không ngã xuyên tường, ngã xong thì thôi pose.

Hit window, tầm đánh, sát thương, stagger, loot, xác, respawn: **không đổi**.

## 1. Đòn đánh (player)

`pose.ts`, nhánh `swing`, chỉ đọc tiến độ `attackTimer / swingDuration` của combat.

| Pha | Hình |
| --- | --- |
| Lấy đà (0 → min(0,2, hitAt/2)) | Tay phải kéo về bên phải và lên. Ngực xoay theo (0,45 × góc tay), chậu xoay nhẹ (0,15). Thân ngả ra sau 0,06. |
| Chạm (`hitAt` = 0,43) | Tay thẳng trước mặt **đúng frame gây sát thương** (như trước). Ngực về 0. Thân đổ tới 0,14. Khuỷu gần duỗi. |
| Hồi (→ 1) | Tay quét sang trái, ngực theo, rồi về. |

- Mắt giữ trên mục tiêu: đầu quay ngược 0,5 × góc tay.
- **Cầm hai tay** (khi có vũ khí): preset, không IK. Tay trái theo tay phải (pitch 0,95×, yaw −0,42, khuỷu gập thêm). Hai nắm tay cách nhau < 0,3 m lúc chạm (test).
- Tay không: tay trái thủ như cũ.
- Grip/socket: như C1, nắm tay phải, quy ước `WEAPON_GRIPS`.
- Không thêm rung camera hay hit stop. Hiệu ứng cũ (nhấp nháy trúng đòn, âm thanh) giữ nguyên.

Đường vung so với vùng đánh: tay cắt ngang trước mặt đúng lúc trúng, nằm trong hình quạt ±60° của combat. Không có sai lệch cần báo.

Zombie: cú đập giữ nguyên nhịp (đòn trúng ở tiến độ 1). Thêm chùng gối khi đập.

## 2. Phản ứng trúng đòn

- `PoseInput.hurtDir` = hướng bị đẩy so với hướng nhìn:
  - thân ngả theo hướng đẩy (cos → pitch, sin → nghiêng);
  - đầu giật, hai gối chùng 0,25;
  - hai khuỷu co lên (khi không đang đánh).
- Chỉ **cộng thêm** vào tư thế: không hủy đòn vung hay bước đi.
- Zombie lấy hướng từ vector `knockback` của simulation lúc bắt đầu một lần stagger mới (`ZombieView`). Không kéo collider, không knockback mới.
- Player: runtime không lưu người đánh, nên mặc định bị đẩy ra sau (như trước). **Hoãn**: hướng đòn cho player cần gameplay lưu nguồn sát thương.

## 3. Cái chết

- `pose.ts` `deathPose`:
  - 0–30 %: gối khuỵu (bàn chân giữ phẳng);
  - sau đó: thân đổ quanh bàn chân, nhanh dần như rơi;
  - kết thúc ở tư thế nằm của từng kiểu (`FALLS`).
- Tay nằm trong mặt phẳng thân (dọc sườn hoặc qua đầu), nên không cắm xuống đất.
- `rootLift` nâng cả thân để nằm trên sàn. Kiểm bằng test: điểm thấp nhất trong [−4,5; +4] cm với mọi kiểu, cả player và zombie.
- Khi ngã giữa chừng, thân không lún quá 10 cm.
- `death.ts`:
  - `fallOrder`: đòn gần nhất (< 0,6 s) quyết định trước (bị đẩy lùi → ngửa, bị đẩy tới → sấp, sang bên → nghiêng); nếu không có, thứ tự ổn định theo ID, nên đám đông không ngã giống nhau và nạp lại thì ngã như cũ;
  - `chooseFall`: bỏ kiểu ngã có vật cản trong 1,7 m theo hướng đầu (`runtime.isBlocked`, truy vấn chỉ đọc, một lần lúc chết). Không còn chỗ thì khuỵu gục tại chỗ.
- Quyền giết, rơi đồ, dọn xác (`corpseLifetime`), va chạm xác thuộc gameplay; animation không chờ gì cả.
- **Xác đã ngã xong không pose nữa** (`settled` trong ZombieView). Nếu xác bị ẩn trước khi kịp pose xong, nó sẽ pose lúc hiện lại.
- Pause giữa lúc ngã thì cú ngã dừng (delta 0 từ C3).
- Player chết: ưu tiên ngã ngửa nếu có chỗ, không thì kiểu khác, cũng tránh tường.

Giới hạn: kiểm tra chỗ ngã là một tia ở cao 0,5 m. Bậc thang, đồ đạc thấp dưới 0,5 m và zombie khác không được xét. Tay hay đầu có thể chạm mép tường xiên. Chưa có ragdoll.

## 4. Kiểm tra đã chạy

- `death.test.ts` (mới, 4 test): hướng đòn quyết định kiểu ngã; thứ tự ổn định theo ID, đa dạng trong đám đông, khuỵu gục luôn cuối; hướng ngã theo hướng nhìn; tường sau lưng → ngã kiểu khác; tường mọi phía → khuỵu gục.
- `body.test.ts` +2:
  - 5 kiểu chết × (player áo khoác, zombie): nằm trên sàn, cao < 0,7 m (khuỵu < 1,3 m); ngã giữa chừng không lún;
  - lúc chạm hai nắm tay < 0,3 m; ngực xoay < −0,3 khi lấy đà, > 0,3 khi hồi, 0 lúc chạm.
- Test cũ về pose giữ nguyên: tay thẳng trước mặt đúng `hitAt`, một lần cắt ngang; bị đánh thì ngả ra sau; ngã ngửa pitch −π/2.
- Toàn bộ: **649 test**; lint, tsc, build, check:bundle sạch.
- `scripts/c4-combat-browser.mjs` (mới, `GPU=1`) **PASS**:
  - zombie lưng sát tường biên, bị đẩy về phía tường → ngã nghiêng (roll −π/2), không ngửa xuyên tường;
  - xác ngã xong: tư thế giống hệt qua các frame;
  - pause lúc vừa bắt đầu ngã → tư thế đứng yên 500 ms, resume → nằm ngửa;
  - zombie chết giữa lúc vung tay: máu player không đổi.
- `p2-s3-browser` PASS: zombie chết nằm (kiểu ngã giờ thay đổi; script chấp nhận mọi tư thế nằm hoặc khuỵu).
- `p2-s4-browser` PASS.
- Nhân đôi damage/âm thanh: animation không có đường phát event nào (thiết kế từ trước). `melee.test.ts` và các test runtime vẫn khóa một hit mỗi lần vung.
- Ảnh `docs/character/c4/combat-z110` (hàng trên: lấy đà, chạm, hồi, bị đánh từ trước/trái, zombie bị đẩy tới; hàng dưới: ngửa, sấp, trái, phải, khuỵu, đang ngã), `combat-z28`, `states-z80`.
