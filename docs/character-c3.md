# Nhân vật C3: locomotion của player

Ngày 27/09/2026. Bước 4 của `docs/Character_Zombie_Model_Animation_Plan.md`.

Chân của player giờ theo **chuyển động thật của thân** (sau va chạm), không theo tốc độ dự định:
- bị tường chặn thì chân dừng, không chạy tại chỗ;
- trượt dọc tường thì bước theo tốc độ dọc tường;
- lùi hoặc đi ngang trong lúc hướng nhìn giữ theo con trỏ (khi vung) thì bước lùi và xoay chậu theo đường đi;
- đứng yên thì dồn trọng lượng nhẹ;
- pause thì animation dừng hẳn.

Gameplay không đổi: âm bước chân, bán kính nghe, tốc độ, va chạm vẫn do runtime quyết định.

## 1. Thay đổi

| File | Nội dung |
| --- | --- |
| `rendering/character/locomotion.ts` (mới) | `advancePlayerGait`, hàm thuần. Lọc vận tốc thân từ vị trí mỗi frame (hằng số thời gian 0,12 s như `gait.ts`, không phụ thuộc FPS). Tốc độ hiển thị = min(tốc độ đo, tốc độ dự định). Pha bước tăng theo quãng đường thật. Khi đi đúng như dự định (≥ 80 %), pha bị kéo về `stridePhase` của runtime, nên mỗi lần chạm chân vẫn trùng một âm bước. Hướng đi so với hướng nhìn: nửa trước thì chậu xoay về đường đi (tối đa ±0,7 rad); nửa sau thì pha chạy ngược (bước lùi). Dịch chuyển > 1 m trong một frame (nạp save, debug) không tính là đi. `delta = 0` không đổi gì. |
| `pose.ts` | `PoseInput.hipTurn` (tùy chọn): chậu xoay thêm, ngực xoay ngược lại để giữ hướng nhìn. Đứng yên (player): dồn trọng lượng chậm giữa hai chân (chậu nghiêng ±0,028 rad, gối chân nghỉ gập nhẹ, ngực cân lại), đầu trôi nhẹ. Tắt dần khi bước. Chân vẫn chạm sàn nhờ `legReach`. |
| `PlayerView.tsx` | Đọc `advancePlayerGait` thay cho tốc độ/pha dự định. Sải chân: đi hay chạy theo config. |
| `Scene.tsx` | `CharacterAnimator` nhận `paused`. Animation dùng cùng chính sách thời gian với tick (`min(delta, loop.maxDelta)`); khi pause thì delta = 0. Ngã chết, vung gậy, thở không tiếp tục sau menu; zombie cũng vậy (trước đây chân zombie tụt về đứng khi pause). |

Không cần IK chân. Sàn và cầu thang: gốc hình ở chân và theo `position.y` của runtime. Chậu hạ theo chân (C1), nên chân không lơ lửng hay lún khi gập. `m11b-floors-browser` PASS.

Hoãn: không có hướng đòn khi player bị đánh (C4); bước ngang thật (chân bắt chéo) — dùng xoay chậu thay thế, đủ đọc ở zoom chơi.

## 2. Kiểm tra đã chạy

- `locomotion.test.ts` (mới, 6 test). Physics 60 Hz, render 30/60/144/240 Hz:
  - bị chặn: tốc độ < 0,05 m/s, pha đứng yên;
  - đi tự do: tốc độ 3,8–4 m/s, pha lệch `stridePhase` < 0,15 rad;
  - trượt dọc tường 1,5 m/s: tốc độ 1,35–1,65;
  - lùi: hướng −1, pha giảm; đi ngang: chậu xoay đúng 0,7; đi chéo: chậu xoay ≈ −0,7;
  - pause không đổi trạng thái; dịch chuyển tức thời không phải chuyển động;
  - pose: chậu xoay nhưng ngực giữ hướng; đứng yên thì chậu nghiêng theo thời gian, khi đi thì không.
- `body.test.ts` +1: dồn trọng lượng ở 4 thời điểm và chậu xoay ±0,7 khi đi đều giữ chân trong [−3; +3,5] cm.
- Toàn bộ: **643 test**; lint, tsc, build, check:bundle sạch.
- `scripts/c3-locomotion-browser.mjs` (mới, `GPU=1`) **PASS**. Giữ W+D trong game thật:
  - đi tự do: biên độ hông 1,0 rad, đi 1,87 m;
  - ép vào tường biên bắc: thân không đi (0 m), runtime vẫn dự định 4 m/s, biên độ hông **0** (C0: chạy tại chỗ);
  - Escape khi đang đi: tư thế đứng yên tuyệt đối.
- `p2-s5-gait` PASS (743/646 FPS, không frame đứng chân, mỗi sự kiện bước đúng một âm). Trước đây phần chạy lao vào tường góc safehouse và đo cả đoạn chạy tại chỗ; nay mỗi mẫu kết thúc trước tường (1,8 s đi, 1 s chạy).
- `m11b-floors-browser` PASS (cầu thang, tầng).
- Ảnh `docs/character/c3/states-*` (tư thế đứng giờ có dồn trọng lượng theo `t`).

## 3. Giới hạn

- Âm bước chân vẫn phát khi bị tường chặn: đó là tiếng ồn gameplay (runtime, P2-S5), không đổi trong đợt này.
- Chưa xem trên màn hình 144 Hz thật; độ mượt được chứng minh bằng unit test và headless không giới hạn FPS.
