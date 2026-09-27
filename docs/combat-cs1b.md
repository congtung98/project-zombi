# Combat CS1b: timeline đòn đánh, hướng đòn và đệm click

Ngày 27/09/2026. Phần thứ hai của `docs/Combat_Stance_Input_Sprint_Plan.md` (§7, §8, một phần §9 và §11). Phần trước: `docs/combat-cs1a.md`.

## 1. Luật mới

Một cú click trong thế tạo một **ý định đánh**. Hướng đòn là **hướng ngắm tại lúc click** (`attackYaw`). Không tự nhắm, không chọn zombie gần nhất.

| Pha (`attackPhase`) | Diễn ra |
| --- | --- |
| `windup` (lấy đà + căn hướng) | Stamina bị trừ ngay khi click (như cũ). Thân quay về `attackYaw` với tốc độ 630°/s. Tư thế lấy đà chạy trong `windup` = 0,07 s. Lấy đà xong mà thân còn lệch quá 12° thì **giữ tư thế lấy đà**, cooldown vũ khí cũng dừng theo. Chưa có damage. |
| `strike` | Bắt đầu khi đã lấy đà xong và thân lệch ≤ 12°. Đòn được **chốt** (`attackCommitted`). Từ đây hướng không còn theo chuột. Thân quay nốt phần lệch còn lại (≤ 12°) về hướng đã chốt. Damage đến ở `hitDelay` 0,15 s, tính theo thời gian của đòn. |
| `recovery` | Từ lúc trúng tới hết cú vung (0,35 s), sau đó là phần còn lại của cooldown vũ khí. Sau khi trúng 0,1 s, thân lại được quay về hướng ngắm nếu còn giữ thế; hướng đòn đã chốt không đổi. |

- **Trúng đòn**: `resolveConeHits` dùng `attackYaw` đã chốt, không dùng `facing`. Gốc là vị trí hiện tại của người chơi. Tầm, cung ±60°, tia chặn tường, "mỗi mục tiêu một lần", độ bền theo `attackId`, damage và cooldown đều giữ nguyên.
- **Đồng hồ combat là nguồn chuẩn.** Pose chỉ đọc `attackTimer`. Lúc giữ lấy đà, `attackTimer` đứng ở 0,07 s, tức tư thế gậy đang kéo về sau. Một tick dài vượt qua mốc trúng vẫn ra đúng một lần trúng.
- **Hết giờ căn hướng**: 0,6 s sau click mà thân vẫn chưa quay tới (bị thứ khác giữ hướng) thì đòn bị hủy. Phát `player:attackCancelled {reason: 'align-timeout'}` và toast nhắc. Stamina và cooldown không được hoàn. Quay 180° hợp lệ tốn khoảng 0,29 s, cộng 0,07 s lấy đà, vẫn dưới 0,6 s.
- **Chết** giữa đòn thì đòn bị hủy (`reason: 'dead'`). Trước đây đòn vẫn trúng sau khi chết. Bị đánh không hủy đòn, giữ như cũ.
- **Đệm click**: chỉ giữ tối đa một click. Click chỉ được giữ khi đòn chỉ còn phải chờ ≤ `bufferWindow` 0,18 s (chờ cooldown hoặc chờ hết cú vung đã chốt). Click mới thay click cũ. Click được giữ mang hướng ngắm lúc click và hết hạn sau 0,18 s. Các trường hợp bỏ click: click quá sớm trong recovery, click lúc thiếu stamina (click đó không làm gì), click khi đang căn hướng. Thả RMB, Esc, mở panel, blur hoặc pause, và chết đều xóa click đang giữ.
- **Hold**: click trái nhận ra lúc nút phải đang giữ vẫn được tính, kể cả khi nút phải được thả trong cùng frame (`InputManager.wasPressedWhileHeld`). Ngoại lệ: nút phải đang chờ được thả sau Esc, E hoặc panel. Script trình duyệt tìm ra lỗi này.
- **E giữa đòn** (windup, strike, recovery của cú vung) bị bỏ, không xếp hàng; phát `player:interactBlocked`. Hết cú vung thì E dùng lại được.
- **Đẩy (Space)** giữ luật cũ (snap về con trỏ). Tài liệu không nói về đẩy.

## 2. Ảnh hưởng timing (thay đổi cân bằng có chủ đích)

| Đòn | Trước CS1 | CS1b (trình duyệt thật, click → damage) |
| --- | --- | --- |
| Đã nhìn đúng hướng | 0,15 s | **150–152 ms**, không đổi |
| Ra sau lưng (180°) | 0,15 s, snap 180° | **336–338 ms**, quay qua khoảng 12 frame, không snap |
| Lệch 90° | 0,15 s | khoảng 0,15–0,2 s (quay 0,14 s song song với lấy đà 0,07 s) |

Recovery sau khi trúng dài như cũ vì cooldown dừng trong lúc căn hướng. DPS khi đánh liên tục cùng một hướng giữ nguyên.

## 3. Thay đổi

| File | Nội dung |
| --- | --- |
| `entities/player.ts` | `attackYaw`, `attackCommitted`, `attackAlignTime`: dữ liệu runtime, không lưu vào save. |
| `systems/combat.ts` | `startAttack(..., yaw)` từ chối khi đang vung. `canStartAttack`, `attackReadyIn`, `cancelSwing`, `attackPhase`. `tickPlayerCombat` trả `'hit' | 'cancelled' | null`, gồm căn hướng, giữ tư thế, dừng cooldown, hết giờ. |
| `core/config.ts` | `combatStance`: `windup` 0,07, `alignToleranceDeg` 12, `alignTimeout` 0,6, `turnReleaseAfterHit` 0,1, `bufferWindow` 0,18. |
| `core/runtime.ts` | Hướng: đang vung thì quay về `attackYaw` tới 0,1 s sau khi trúng; sau đó theo thế, rồi theo hướng đi. Bỏ snap khi click. `pendingAttack`, `tryStartAttack`. Chết thì hủy đòn. E bị chặn giữa đòn. `chordAllowed`. |
| `systems/input.ts` | `wasPressedWhileHeld` (lưu các nút đang giữ lúc nhấn, xóa cuối frame và khi `clear`). |
| `core/events.ts` | `player:attackCancelled`, `player:interactBlocked`. |
| `hudStore.ts`, `HUD.tsx` | F3 "Combat": thế BẬT/tắt (mode), pha, hướng ngắm, thân, đòn (đang căn / chốt), click đang chờ, input thuộc thế giới / UI / đang chờ thả chuột phải. |
| `App.tsx` | Toast khi đòn bị hủy vì không kịp quay. |

## 4. Kiểm tra đã chạy

- `core/combatSwing.test.ts` (mới, 12 test):
  - timing đòn trước mặt bằng `hitDelay`;
  - click sau lưng: zombie trước mặt không bị trúng, trúng sau 0,28–0,45 s, mỗi tick quay không quá giới hạn, thân lệch ≤ 12° lúc trúng;
  - đổi con trỏ giữa strike không đổi đòn hay cung;
  - chuỗi pha windup → strike → recovery → none;
  - hết giờ căn hướng (không trúng, không hoàn phí);
  - tick 0,1 s vẫn ra đúng một lần trúng;
  - spam click: 3 cú trong 2,5 s, cách nhau ≥ cooldown, số lần trúng = số cú;
  - click đầu recovery bị bỏ, click cuối recovery được giữ, chạy khi sẵn sàng và mang hướng của nó;
  - thả RMB, Esc, blur xóa click đang giữ; đòn đang chạy vẫn trúng;
  - chết giữa lấy đà;
  - E giữa đòn.
- `combatStance.test.ts` +1: phải, trái, thả phải trong cùng frame; không tính sau Esc.
- `combat.test.ts` đổi theo kiểu trả về mới.
- Tổng **693 test** pass. lint, tsc sạch.
- Trình duyệt thật: `scripts/cs1-combat-browser.mjs` (mới, chuột thật, Chrome GPU) PASS 3/3 lần liên tiếp:
  - click trái ngoài thế không vung;
  - RMB bật thế và con trỏ chữ thập;
  - đòn trước mặt 150 ms;
  - đòn sau lưng khoảng 337 ms, mỗi frame quay tối đa 0,07 rad, lấy đà khoảng 250 ms, zombie phía trước không bị trúng;
  - đổi con trỏ sau khi chốt vẫn chỉ trúng con phía trước;
  - spam 10 click → 2 cú, 2 lần trúng;
  - thả RMB giữa đòn thì đòn vẫn trúng, thế tắt, con trỏ trở lại bình thường;
  - blur khi đang giữ RMB thì thế tắt, không vung.
- Cũng PASS: `p2-s3`, `p2-s4`, `c4-combat`, `p2-s2`. `p2-s2` và `p2-s4` giờ chờ cú vung kết thúc thay vì chờ cố định 700 ms: lần chạy đầu sau khi Vite khởi động có frame rất chậm, nên đòn quay người không kịp trúng trong 700 ms.
- Ảnh `docs/combat/cs1/`: `cs1-ready.png` (thế sẵn sàng), `cs1-flip-debug.png` (F3 khi con trỏ đã sang phía đối diện: ngắm 294°, thân và đòn 114° đã chốt).

## 5. Còn lại (CS1c)

- E: ưu tiên vật dưới con trỏ, giữ mục tiêu ổn định, highlight.
- Mở rộng script trình duyệt theo ma trận §13: E, UI, pointer ra ngoài canvas, Toggle.
- Sổ tay bàn giao.
