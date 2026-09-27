# Combat CS1a: audit, input và thế chiến đấu (chuột phải)

Ngày 27/09/2026. Phần đầu của `docs/Combat_Stance_Input_Sprint_Plan.md` (sprint CS1).

Chủ dự án cho phép chia CS1 thành các sprint nhỏ, tự commit và push từng phần, dùng khuyến nghị của agent. Việc này thay cho câu "dừng để chủ dự án tự commit" trong tài liệu.

## 1. Audit (tài liệu §3)

| Câu hỏi | Trạng thái trước CS1 |
| --- | --- |
| Chuột trái gây damage ngay hay chạy timeline? | Chạy timeline. `startAttack` trừ stamina, đặt cooldown, `attackTimer = 0`. Damage đến ở `hitDelay` 0,15 s (`tickPlayerCombat`, xử lý cả khi một tick vượt qua mốc này). Vung kéo dài 0,35 s. **Nhưng lúc click, `player.facing` bị gán thẳng về con trỏ**: đòn ra sau lưng quay 180° trong một frame. |
| Ai đặt hướng? | Chỉ một trường là `player.facing`, do simulation ghi. Có hai chỗ ghi: di chuyển (`dampAngle` về hướng đi, trừ khi đang vung) và combat (snap về con trỏ khi đánh hoặc đẩy). View chỉ đọc (`visual.rotation.y`). Animation không ghi ngược. |
| Model có tư thế nào? | Pose procedural (`pose.ts`), không dùng clip. Đã có: vung (chiều ngang và chiều dọc của cánh tay qua `hitAt`), cầm hai tay, xoay chậu theo đường đi khi đi ngang hoặc lùi (C3), đẩy, bị đánh, chết. Thiếu: tư thế sẵn sàng, xoay tại chỗ, ngực dẫn hướng. |
| Damage, tầm, cung, cooldown, stamina, độ bền, ngắt đòn | Mỗi vũ khí có damage, range, cooldown và stamina riêng (`items.ts`; gậy: 25 / 2 m / 1 s / 12). Cung ±60°, knockback 1, stagger 0,2. Chặn tường bằng tia ở cao 1,2 m. Mỗi mục tiêu trúng tối đa một lần mỗi đòn. Độ bền trừ một lần theo `attackId`. Người chơi bị đánh không làm hủy đòn. Đòn chỉ dừng khi chết (tick bỏ qua người chơi đã chết). |
| Camera và điểm ngắm | Camera orthographic isometric. `CursorProbe` chiếu tia từ camera thật (NDC tính theo rect của canvas) xuống mặt phẳng ở độ cao sàn của player, mỗi frame, kể cả khi chuột không di chuyển. Nhờ vậy tia không bao giờ trúng mái hay tầng khác. Chuột ra ngoài canvas thì `cursorWorld = null`. |
| E và UI | E có resolver (`selectInteractable`): chọn theo khoảng cách cộng trọng số hướng nhìn, có tia chặn tường và lọc theo tầng. Chưa có highlight, chỉ có prompt. Túi đồ và container không pause simulation; `uiOpen` chặn đánh và đẩy. |
| Listener | Phím gắn trên `window`, `pointerdown` trên canvas, `pointerup` trên `window`. Blur thì xóa phím. `contextmenu` bị chặn trên div bọc Canvas (chỉ trong vùng game). Khi blur hoặc tab ẩn, App tự pause, và pause xóa input. **Thiếu:** bấm hai nút chuột cùng lúc (trình duyệt không phát `pointerdown` cho nút thứ hai), `pointercancel`, mất capture. |
| LOS và tầm nhìn | `PlayerVisionSystem` dùng `player.facing` (hướng thật của nhân vật), không dùng hướng chuột. |

Chuột trái ngoài combat không có chức năng nào khác trong thế giới. Các panel là DOM riêng nên không bị ảnh hưởng.

## 2. Chia sprint

| Sprint | Nội dung |
| --- | --- |
| **CS1a** (sprint này) | Input manager (bấm hai nút, cancel, capture, reset). RMB Hold/Toggle, cài đặt. Hướng quay giới hạn tốc độ và tách hướng ngắm mong muốn. Đi trong thế (×0,8, không chạy). LMB chỉ đánh khi đang ở thế. Esc/E rời thế. Tư thế sẵn sàng, ngực dẫn hướng, con trỏ chữ thập. Chữ hướng dẫn. |
| **CS1b** | Timeline đòn mới: lấy đà và căn hướng → chốt hướng → vung → hồi. Hết giờ căn hướng thì hủy đòn. Đệm một cú click. Damage và animation dùng chung `committedAttackYaw`. E bị từ chối khi đang vung. Debug F3. |
| **CS1c** | Tương tác E: ưu tiên vật dưới con trỏ, giữ mục tiêu ổn định, highlight. Script trình duyệt nghiệm thu theo ma trận §13. Sổ tay bàn giao, tuning. |

Ở CS1a, đòn đánh vẫn giữ luật cũ: lúc click, hướng snap về con trỏ. Trong thế, thân đã quay dần về con trỏ trước đó, nên lần snap này thường rất nhỏ. CS1b sẽ bỏ hẳn việc snap.

## 3. Thay đổi

| File | Nội dung |
| --- | --- |
| `systems/stance.ts` (mới) | `StanceControl`: mode, toggled, suppressed, requested, aimYaw, turnSign, clickOutsideAt. Là dữ liệu runtime, không lưu vào save. Các hàm thuần: `updateStanceRequest`, `cancelStance`, `setStanceMode`, `aimYawTowards` (con trỏ gần chân < 0,35 m hoặc NaN thì trả null và giữ hướng cũ), `angleDiff` (đúng 180° luôn là +π), `turnToward` (giới hạn bước, không vượt đích, có trễ ±8° ở gần 180° để không đảo chiều quay). |
| `systems/input.ts` | Hành động `stance` = `Mouse2`. Nút chuột lấy từ bitmask `buttons` (bấm và thả nút thứ hai phát ra `pointermove`). Chỉ tính là nhấn khi sự kiện nằm trên canvas; thả thì tính ở bất kỳ đâu. Pointer capture khi nhấn. `pointercancel`, mất capture khi còn giữ nút, tab ẩn → `clear()`. `onClear` báo cho runtime. Không nhận phím trong input, select, contentEditable hoặc khi đang gõ IME. Con trỏ ra ngoài canvas (capture) thì giữ điểm ngắm cũ. |
| `core/runtime.ts` | `stance`, `simTime`, `stepControls()` chạy đầu tick. Stance bị tắt khi chết hoặc khi có panel mở; nút phải đang giữ phải thả ra rồi mới bật lại. Hướng: đang vung thì giữ nguyên; trong thế thì `turnToward(aimYaw, 630°/s)`; ngoài thế thì theo hướng đi như cũ. Khi đang ở thế hoặc đòn còn chạy (`combatPosture`): tốc độ đi ×0,8 và không chạy được. LMB ngoài thế: không đánh, không tốn gì; sau 80 ms mà không có RMB thì phát `player:attackNeedsStance`. LMB trước RMB tối đa 80 ms vẫn tính là đánh. RMB và LMB trong cùng tick: xử lý stance trước. `cancelStance()` (Esc), `setStanceMode()`, `resetCombatIntent()` (khi blur, pause, New Game). E khi đang ở thế: rời thế rồi mới tương tác. |
| `core/config.ts` | `combatStance` gồm turnSpeedDeg 630, speedFactor 0,8, aimMinDistance 0,35, turnSideHysteresisDeg 8, simultaneousGrace 0,08, poseBlend 0,14, torsoLeadDeg 35. |
| `core/events.ts` | `player:attackNeedsStance`, `player:stance`. |
| `pose.ts` | `ready` (0..1): cầm gậy hai tay nâng qua vai phải, tay không thì giơ nắm đấm; gối chùng nhẹ. Cú vung bắt đầu từ tư thế sẵn sàng và quay về đó; khung damage vẫn là cú vung gốc (tay thẳng trước mặt đúng `hitAt`). `aimLead`: ngực xoay 0,8 và đầu 0,25 theo độ lệch hướng. |
| `PlayerView.tsx` | Blend `ready` trong 0,14 s theo `combatPosture`. Ngực dẫn về hướng ngắm, tối đa ±35°, làm mượt 0,08 s. View không ghi ngược vào simulation. |
| `CursorProbe.tsx` | Con trỏ canvas thành `crosshair` khi ở thế. |
| `settingsStore.ts`, `Settings.tsx` | `combatStance: 'hold' | 'toggle'`, mặc định `hold`. Dữ liệu cũ không có trường này thì là hold. Thêm hàng "Thế chiến đấu". |
| `App.tsx` | Đồng bộ mode sang runtime (đổi mode thì reset stance). Esc: đóng panel trước, rồi rời thế, cuối cùng mới pause. Nhắc "Giữ chuột phải…" tối đa một lần mỗi 30 s. |
| `HUD.tsx`, `hudStore.ts`, `Settings.tsx` (hướng dẫn) | Thanh phím có "Chuột phải: Giữ thế", sáng lên khi đang ở thế. Gợi ý "Giữ chuột phải để ngắm · Chuột trái để đánh · E để tương tác" (đổi chữ theo Toggle). Cập nhật trang hướng dẫn. |

Hold: một cạnh nhấn vẫn tính cho ít nhất một tick. Trên máy chậm, bấm phải rồi trái rồi thả hết giữa hai frame vẫn ra đòn. Lỗi này được tìm thấy khi chạy `p2-s2` trên trình duyệt thật.

## 4. Thay đổi hành vi (có chủ đích)

- Chuột trái **không còn đánh khi đứng ngoài thế**. Đây là quyết định trong tài liệu.
- Trong thế: đi chậm hơn (4 → 3,2 m/s), Shift không chạy. Bán kính tiếng bước chân vẫn tính theo đi bộ (5 m).
- Ngoài thế, thân vẫn quay theo hướng đi như trước. Trong thế, đi ngang hoặc lùi không làm quay thân (C3 đã có sẵn dáng bước lùi).
- Đòn đang chạy vẫn giữ tốc độ chậm và tư thế cho tới khi hết. Thả RMB không hủy đòn và không hoàn chi phí.
- Space (đẩy) giữ nguyên luật cũ: snap về con trỏ, dùng được cả ngoài thế. Tài liệu không nói gì về đẩy. Ghi lại ở đây để quyết sau.

## 5. Kiểm tra đã chạy

- Unit: `systems/stance.test.ts` (9 test: góc ngắn nhất, đúng 180°, quay giới hạn và không vượt đích, trễ khi con trỏ rung sau lưng, con trỏ gần chân hoặc NaN, Hold/Toggle, bị chặn/hủy, đổi mode, nhấn và thả giữa hai tick). `core/combatStance.test.ts` (14 test: LMB ngoài thế, RMB+LMB cùng tick, ân hạn 80 ms, LMB giữ trước khi vào thế, tốc độ quay và hướng quay, đi ngang/lùi ×0,8 không chạy, con trỏ gần chân hoặc ra ngoài, Toggle, blur, Esc, thả RMB giữa đòn, chết, save không chứa stance, E từ thế). `character.test.ts` +1 (tư thế sẵn sàng, cú vung vẫn đúng `hitAt`, ngực dẫn hướng). Test cũ bấm Mouse0 giờ giữ thêm Mouse2 (melee, runtime, timedAction, soak). Test "túi mở chặn đánh" thêm bước: RMB giữ xuyên qua lúc mở panel thì phải nhấn lại.
- Tổng: **680 test** pass. lint, tsc, build, build:editor, check:bundle sạch.
- Trình duyệt thật (Chrome, GPU D3D11, dev): `p2-s2` (click trái ngoài thế ra lời nhắc; phải+trái bấm cùng lúc ra "Tay không"; đánh, độ bền, save), `p2-s3` (vung từ tư thế sẵn sàng), `p2-s4`, `c3-locomotion`, `c4-combat`, `p2-vision`: tất cả PASS. Script cũ được sửa để giữ chuột phải khi đánh.
- Ảnh (`docs/combat/cs1a/`): `armed-neutral.png`, `armed-ready.png`, `unarmed-ready.png`. Với con trỏ quay sang phía đối diện, `facing` đi qua 1,99 → 2,39 → 2,72 → 3,12 → −2,83 → … → −1,22 (khoảng 25 ms mỗi mẫu). Thân quay dần, không snap. Con trỏ là `crosshair` khi giữ nút và trở về bình thường khi thả.

## 6. Còn lại

- CS1b: snap khi click vẫn còn; chưa có pha căn hướng, chốt hướng, đệm click; E chưa bị chặn khi đang vung.
- CS1c: E chưa ưu tiên vật dưới con trỏ và chưa có highlight.
- Chưa có điều khiển cảm ứng/mobile. Chưa có hệ đổi phím (tài liệu cho phép hoãn). Action ID `stance` đã có trong `KEY_BINDINGS`.
