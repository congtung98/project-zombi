# Combat CS1c: tương tác E, nghiệm thu và bàn giao CS1

Ngày 27/09/2026. Phần cuối của `docs/Combat_Stance_Input_Sprint_Plan.md`. Các phần trước: `docs/combat-cs1a.md` (audit, input, thế chiến đấu) và `docs/combat-cs1b.md` (timeline đòn).

## 1. CS1c đã làm

| File | Nội dung |
| --- | --- |
| `systems/interaction.ts` | `selectInteractable(..., options)`. **Ưu tiên vật dưới con trỏ**: tia con trỏ được lấy ở độ cao của vật, khoảng cách tới tâm vật ≤ bán kính. Vật đó phải trong tầm và không bị tường chắn. Không có thì dùng luật cũ (gần nhất, ưu tiên trước mặt). **Giữ mục tiêu hiện tại** trừ khi vật khác tốt hơn ≥ `TARGET_STICKINESS` 0,25, để hai tủ cạnh nhau không nhấp nháy. Tầm vẫn tính từ người chơi. Tầng và tường vẫn lọc như cũ. |
| `core/runtime.ts` | Truyền `pointerDistance` (tia camera orthographic: `cursor + offset × (h / offset.y)`) và `current`. E cùng frame với click đánh trong thế: đòn thắng, E bị bỏ. |
| `rendering/InteractHighlight.tsx` (mới) | Vòng vàng mảnh nhấp nháy dưới vật E sẽ tác động (đúng vật của prompt). Vẽ đè, chỉ để hiển thị. Không thêm dấu nổi, vì tủ chưa mở đã có dấu loot vàng. |
| `scripts/cs1-combat-browser.mjs` | Thêm E, highlight, panel, Esc, E giữa đòn, thả nút ngoài canvas, `pointercancel`, chế độ Toggle trong cài đặt. |
| `docs/character-handbook.md` | Bảng trạng thái animation có thêm thế chiến đấu và cú vung CS1b. |

## 2. Bàn giao (tài liệu §15)

### 2.1 Input cuối cùng

| Input | Hành vi |
| --- | --- |
| WASD | Đi theo camera như cũ. Trong thế: ×0,8, không chạy, thân không quay theo hướng đi. |
| Chuột phải (Hold, mặc định) | Giữ = thế chiến đấu. Thân quay dần về con trỏ, gậy nâng lên, con trỏ thành chữ thập. Thả = hết thế; đòn đang chạy vẫn đánh xong. |
| Chuột phải (Toggle) | Mỗi lần nhấn bật hoặc tắt. Giữ nút không lặp. Đổi mode thì thế reset. |
| Chuột trái trong thế | Một đòn theo hướng ngắm lúc click. Đệm tối đa một click ở 0,18 s cuối. Giữ nút không tự đánh. |
| Chuột trái ngoài thế | Không đánh, không tương tác. Nhắc "Giữ chuột phải…" tối đa một lần mỗi 30 s. Bấm trái trước phải trong 80 ms vẫn tính là đánh. |
| E | Tác động lên vật đang có vòng vàng và prompt: vật dưới con trỏ nếu trong tầm, nếu không thì vật gần phía trước. Nhấn một lần là một lần (theo cạnh nhấn). Đang ở thế thì rời thế trước; nút phải đang giữ phải nhấn lại. Giữa đòn (hoặc cùng frame với click đánh) thì bị bỏ, không xếp hàng. |
| Esc | Có panel thì đóng panel; không thì rời thế (xóa click đang chờ); không có gì thì pause. |
| Space | Đẩy như cũ: snap về con trỏ, dùng được cả ngoài thế. |
| Click trên panel/UI | Không xuống thế giới (chỉ nhận nhấn trên canvas). |
| Blur, tab ẩn, pause, `pointercancel`, mất capture | Xóa nút đang giữ, thế và click chờ. Không tự đánh khi quay lại. |

### 2.2 Nguồn chuẩn

- **Ý định** nằm trong `runtime.stance` (`systems/stance.ts`): mode, requested, suppressed, aimYaw. Đây là dữ liệu runtime, không lưu vào save.
- **Hướng** là `player.facing`, chỉ simulation ghi (`stepPlayerMovement`), quay giới hạn 630°/s theo đường ngắn. Đang vung thì quay về `attackYaw`; sau đó theo thế; ngoài thế theo hướng đi. View và vision chỉ đọc.
- **Pha đòn** là `player.attackTimer`, `attackCommitted`, `attackYaw`. `tickPlayerCombat` là đồng hồ chuẩn; `attackPhase()` suy ra pha. Damage dùng `attackYaw` đã chốt. Pose chỉ đọc tiến độ.
- **Trình bày**: `PlayerView` blend `ready` và `aimLead`; `CursorProbe` đổi con trỏ; `InteractHighlight` vẽ vòng; F3 hiện dòng "Combat".

### 2.3 Tuning cuối (`GAME_CONFIG.combatStance`)

| Thông số | Giá trị | Ghi chú |
| --- | --- | --- |
| turnSpeedDeg | 630 | Giữa khoảng gợi ý 540–720. Quay 180° mất khoảng 0,29 s. |
| alignToleranceDeg | 12 | Giữa khoảng 10–15. |
| windup | 0,07 s | Bằng thời gian kéo gậy của pose (0,2 cú vung). Đòn đúng hướng vẫn trúng ở 0,15 s. |
| alignTimeout | 0,6 s | Lớn hơn 0,29 + 0,07. |
| turnReleaseAfterHit | 0,1 s | |
| bufferWindow | 0,18 s | Giữa khoảng 150–200 ms. |
| speedFactor | 0,8 | |
| poseBlend | 0,14 s | Giữa khoảng 0,10–0,18. |
| torsoLeadDeg | 35 | Giữa khoảng 30–45. |
| aimMinDistance | 0,35 m | |
| turnSideHysteresisDeg | 8 | |
| simultaneousGrace | 0,08 s | |

Các giá trị vẫn là giá trị khởi đầu; chưa có playtest tay của chủ dự án. Timing đo trên trình duyệt thật: đòn trước mặt **150 ms** (không đổi); đòn sau lưng **337–343 ms** (trước đây 150 ms nhưng thân snap 180°). Đây là thay đổi cân bằng có chủ đích của tài liệu.

## 3. Ma trận nghiệm thu (tài liệu §13)

Cột "Unit": các file test trong `src/game/`. Cột "Trình duyệt": `scripts/cs1-combat-browser.mjs` chạy trên Chrome với chuột thật.

| Tình huống | Kết quả | Kiểm tra |
| --- | --- | --- |
| LMB ngoài thế | Không vung, không tốn gì, có nhắc | Unit `combatStance`; trình duyệt bước 1; `p2-s2` |
| RMB giữ/thả khi đứng yên | Vào/ra thế, không có menu trình duyệt | Unit; trình duyệt bước 2 và 6 (con trỏ chữ thập rồi trở về thường). `contextmenu` bị chặn trên div bọc Canvas. |
| RMB Toggle | Một cạnh nhấn một lần đổi | Unit `stance`, `combatStance`; trình duyệt bước 11 |
| RMB + LMB gần như đồng thời | Cùng tick: thế trước. Trái trước phải ≤ 80 ms vẫn đánh. Phải thả cùng frame vẫn đánh. Bấm hai nút theo bitmask. | Unit; `p2-s2` (bấm hai nút thật) |
| LMB giữ rồi mới vào thế | Không đánh cho tới khi nhấn lại | Unit |
| Đánh trước mặt | 150 ms, như cũ | Unit `combatSwing`; trình duyệt bước 2 |
| Click sau lưng khoảng 180° | Quay qua khoảng 12 frame; zombie phía trước không bị trúng; trúng ở khoảng 0,34 s | Unit; trình duyệt bước 3 |
| Kéo chuột sang phía đối diện giữa strike | Hướng và cung trúng giữ nguyên | Unit; trình duyệt bước 4 (ảnh F3) |
| Thả RMB giữa đòn | Đòn trúng và đánh xong, click chờ bị xóa | Unit; trình duyệt bước 6 |
| Spam LMB | Tối đa một click chờ; mỗi cú cách nhau ≥ cooldown; số lần trúng = số cú | Unit; trình duyệt bước 5 |
| Đi ngang/lùi khi ngắm | Hướng không đổi, ×0,8, không chạy | Unit; C3 dáng lùi |
| Con trỏ sát chân | Giữ hướng cũ, không NaN | Unit |
| Con trỏ qua mái/tầng khác | Mặt phẳng ngắm là sàn của tầng player (có từ M11b); tia không chạm mái | Thiết kế `CursorProbe`; `m11b-floors-browser` |
| Ngắm zombie sau tường | Tia chặn tường ở 1,2 m, như cũ (`isTargetBlocked`) | `melee.test` / `runtime.test` (có sẵn) |
| E gần hai tủ | Vật dưới con trỏ thắng; không thì giữ mục tiêu (0,25); prompt và vòng là cùng một vật | Unit `interaction`; trình duyệt bước 8 (ảnh vòng) |
| E giữa đòn | Bị bỏ, không mở panel sau đó | Unit; trình duyệt bước 9 |
| E từ thế | Rời thế, mở tủ; RMB cũ không bật lại thế | Unit; trình duyệt bước 8 |
| Click UI, E trong ô nhập chữ | Click panel không vung; phím trong input/select/contentEditable/IME bị bỏ qua | Trình duyệt bước 8; `p2-s3` (ô tên) |
| Pointer ra ngoài canvas, thả, cancel | Không kẹt thế | Trình duyệt bước 10 |
| Alt-tab, tab ẩn, pause, resume | Thế tắt, game pause, không tự đánh | Unit (reset); trình duyệt bước 7 |
| Chết hoặc bị đánh giữa đòn | Chết thì hủy đòn (không trúng). Bị đánh không hủy, như cũ. | Unit |
| FPS thấp, frame giật | Tick 0,1 s vẫn ra đúng một lần trúng; nhấn giữa hai frame vẫn tính | Unit; lần chạy nguội `p2-s2` |
| Save/load, hồi sinh | Save không có trường nào của thế hay click chờ; newGame/load xóa input | Unit `combatStance` (save); `p2-s2` save/reload |

## 4. Kiểm tra đã chạy (CS1c)

- `interaction.test.ts` +2: vật dưới con trỏ (trong tầm, ngoài tầm, sau tường, không nằm trên vật); hai tủ cạnh nhau không nhấp nháy, rồi chuyển khi vật kia rõ ràng tốt hơn. `combatSwing.test.ts` +1: E và click cùng frame.
- Tổng **696 test** pass. lint, tsc, build, build:editor, check:bundle sạch.
- Trình duyệt thật (Chrome GPU D3D11, dev). PASS: `cs1-combat-browser` (đủ 11 bước, cả lần chạy `--docs`), `p2-s2`, `p2-s3`, `p2-s5`, `c3-locomotion`, `p2-vision`, `p2-lighting`, `m11b-floors`, `m11c1a-cutaway`, `m11c1b-interior`, `worlds`.
- **Flaky có từ trước CS1**, đã so với bản 25c2a5f chạy trong worktree:
  - `c4-combat` "pushed back in the open": bản mới fail 2/3 lần, bản trước CS1 cũng fail 2/4.
  - `p2-s4`: bản mới fail 1/6 ở bước "di chuyển hủy thao tác". Bước này nhấn S chỉ 120 ms, nên nếu cả nhấn lẫn thả rơi giữa hai frame chậm thì không có tick nào thấy phím. Bản trước CS1 fail 3/4 ở bước đánh (chờ cố định 700 ms).
  - Các lần fail không liên quan tới thế hay đòn. Để lại cho một sprint sửa script riêng.
- Ảnh `docs/combat/cs1/`: `cs1-ready.png`, `cs1-flip-debug.png`, `cs1-e-highlight.png`.

## 5. Hồi quy còn lại, phần hoãn, giới hạn

- **Đẩy (Space)** vẫn snap hướng và dùng được ngoài thế. Tài liệu không nói về đẩy. Nếu muốn đồng bộ, cho đẩy cũng quay trong lúc lấy đà (sprint sau).
- **Chưa playtest tay** trên màn hình thật với người chơi. Tuning mới là giá trị khởi đầu.
- **Không có clip xoay tại chỗ**: rig procedural quay cả thân, ngực dẫn tối đa ±35°. Chân không bước khi xoay tại chỗ (chỉ quay theo gốc). Đây là giới hạn của rig C1–C6.
- **Chưa có** điều khiển cảm ứng/mobile, hệ đổi phím (action `stance` đã có trong `KEY_BINDINGS`), menu chuột phải.
- Chết giữa đòn giờ hủy đòn; trước đây đòn vẫn trúng. Đây là thay đổi nhỏ có chủ đích.
- `p2-smoke` cần Chrome mở cổng CDP 9223 riêng, không chạy trong đợt này.

## 6. Chủ dự án tự thử nhanh

1. `npm run dev` → New Game. Lấy gậy ở tủ quần áo: đi tới tủ, thấy vòng vàng dưới tủ, nhấn E, trang bị trong túi (I).
2. Ra ngoài. Click trái: không có gì, chỉ hiện nhắc. **Giữ chuột phải**: gậy nâng lên, con trỏ chữ thập. Rê chuột vòng quanh: nhân vật quay dần, không giật.
3. Giữ phải và đi WASD: đi chậm, lùi hoặc đi ngang vẫn nhìn theo chuột. Shift không chạy.
4. Tới gần zombie: click trái khi đang nhìn về phía nó thì đòn nhanh như cũ. Đưa chuột ra sau lưng rồi click: nhân vật quay người rồi mới đánh.
5. Đang vung thì kéo chuột sang hướng khác: đòn không đổi hướng. Spam click: không có chuỗi đòn dài.
6. Esc khi đang giữ phải: rời thế (không pause). Esc lần nữa: pause.
7. Cài đặt → "Thế chiến đấu" → "Bấm chuột phải để bật/tắt": một click phải bật thế, một click nữa tắt. Chữ gợi ý trên HUD đổi theo.
8. F3: dòng "Combat" hiện thế, pha đòn, hướng ngắm/thân/đòn, click đang chờ.
9. Tests: `npm test`. Trình duyệt: `BASE_URL=… PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… GPU=1 node scripts/cs1-combat-browser.mjs` (khởi động lại Vite trước `p2-s2`).
