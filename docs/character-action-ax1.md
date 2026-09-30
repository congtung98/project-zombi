# AX1 — Action core

> Nhánh `feature/character-action`, ngày 2026-09-30. Kiến trúc: `docs/character-action-ax0.md`.

## 0. Quyết định của chủ dự án

- **2026-09-30 "oke hãy bắt đầu":** duyệt kiến trúc AX0 và D1–D7 theo đề xuất.
- **D5 đổi so với đề xuất:** giới hạn hàng đợi là **128**, không phải 12.
  - Lý do: test T26 của INV-LOOT (đã nghiệm thu) xếp 100 lượt chuyển liên tiếp. Giới hạn 12 sẽ từ chối từ lượt thứ 13, tức là phá một hành vi đã duyệt.
  - Spam không thể xếp quá số đồ đang có, vì chuyển đồ đã có claims. Nên 128 chỉ là rào an toàn, không phải luật chơi.
  - Giá trị nằm ở `GAME_CONFIG.actions.queueLimit`; muốn 12 thì đổi một số và cập nhật T26.

## 1. Đã làm

**Module mới `src/game/actions/`:**

| File | Nội dung |
|---|---|
| `types.ts` | `ActionContext`, `TargetRef` (thêm kind `inventory` cho chuyển đồ), `ActionDefinition` (lane, `characterState`, `interrupt`, `presentation`, hook `begin`/`commit`/`ended`/`cancelled`/`claims`/`view`), `ActionJob` (trạng thái `queued → running → committing → completed/cancelled/failed`), `ActionFailure` |
| `registry.ts` | `registerAction` / `getAction`; đăng ký trùng loại thì báo lỗi |
| `actionSystem.ts` | `ActionSystem`: `refusal` (`DUPLICATE`, `QUEUE_FULL`), `enqueue`, `tick` (thời gian mô phỏng, dư thời gian chuyển sang bước sau), `complete`, `cancelAll`/`cancel`, `claimed`, `view`, `clear`; commit áp dụng mutation như một transaction |
| `effects.ts` | Tầng Gameplay Effect: `stat`, `item.consume`, `item.transfer`, `inventory.write` (so dấu vân tay nội dung), `event`, `after`. `applyMutation` kiểm tra hết rồi mới ghi; một kiểm tra lỗi thì không đổi gì |
| `characterState.ts` | 14 trạng thái, bảng chuyển trạng thái, `InterruptPolicy`, `deriveState` theo ưu tiên, `CharacterStateMachine` (ghi lại chuyển trạng thái không hợp lệ) |
| `worldVersions.ts` | Bộ đếm version theo object, chỉ lúc chạy |
| `world.ts` | `ActionWorld`: phần simulation mà định nghĩa action được đọc/nhờ; runtime dựng một lần |
| `defs/transfer.ts` | `TRANSFER`: logic chuyển đồ INV-LOOT chuyển nguyên vẹn từ runtime vào định nghĩa. `prepareTransfer` kiểm tra lúc gửi; bước commit trả mutation `item.transfer` |
| `defs/recipe.ts` | `CRAFT`, `REPAIR`: commit dựng trên bản sao (`prepareRecipe`) rồi trả mutation `inventory.write` |

**Runtime (`core/runtime.ts`):**
- `jobs` là getter của `actions.jobs`.
- `queueTransfer`/`startRecipe`/`startCraft`/`startRepair` gửi qua `ActionSystem` và nhận thêm `RequestOptions { requestId, source }` (không bắt buộc).
- `cancelAction`/`cancelJob`/`completeAction` ủy cho `ActionSystem`.
- **Gián đoạn đi qua policy của action đang chạy:** `interruptAction(kind, reason)` được gọi khi di chuyển, khi đánh/đẩy, khi bị trúng đòn và khi vào thế.
- `characterState` được cập nhật mỗi tick.
- `worldVersions` tăng khi cửa, đèn, rèm đổi trạng thái hoặc tủ được mở lần đầu.

**Chỗ khác:**
- `crafting.ts` có `prepareRecipe`; `commitRecipe` giữ nguyên hợp đồng.
- `actionQueue.ts` chỉ còn ledger, bước chuyển và `JobView`.
- Lý do mới: `queue-full` (chuyển đồ / chế tạo), `stance` (hủy vì vào thế), `action:failed` nhận thêm mã của ActionSystem.
- Nhãn tiếng Việt: `craftText.ts`, `labels.ts`.

## 2. Hành vi không đổi (bằng chứng)

- **1049 test cũ pass** không sửa logic. Chỉ `inventoryMatrix.test.ts` T30 đổi cách đọc dòng của job (`transferData(job)`), vì job có hình dạng mới.
- **Soak trùng từng số với mốc INV-LOOT:**
  - shelter: 1800 s, 14 kill, 110 dmg, 1800 lần kiểm tra toàn vẹn;
  - patrol: 1379,3 s, 38 kill, 230 dmg.
  - Soak kiểm tra thêm `character.violations` rỗng sau 30 phút.
- **Trình duyệt (Chrome GPU, chuột thật):** `il-s2`, `il-s3`, `il-s4`, `il-s5`, `cs1-combat` PASS.
- **Policy của TRANSFER/CRAFT/REPAIR:** `{ move: cancel, hit: cancel, attack: cancel, stance: allow }`, đúng hành vi trước AX1. Vào thế không dừng việc; bước chân, đòn đánh và bị đánh thì dừng.

## 3. Test mới (26)

| File | Kiểm tra |
|---|---|
| `actions/actionSystem.test.ts` | Request lặp chạy một lần; cửa sổ nhớ ID; giới hạn hàng đợi; commit đúng một lần, không sớm, ID cũ không commit lại; chỉ chạy theo thời gian mô phỏng, cách chia `dt` không đổi kết quả; mutation lỗi thì không đổi gì và job fail; hủy nhả giữ chỗ; claims khi chờ, giữ chỗ khi chạy; job không bắt đầu được thì rời hàng và job sau chạy |
| `actions/effects.test.ts` | Áp theo thứ tự + kẹp chỉ số; một kiểm tra lỗi thì không chỉ số, không item, không event, không `after`; hai lần lấy cùng instance được cộng dồn; chuyển đúng số hoặc không gì; inventory đổi ngay trên mảng cũ vẫn bị phát hiện |
| `actions/characterState.test.ts` | Ưu tiên trạng thái; DEAD chỉ về IDLE; Case 5 của FB (đang ăn bị đánh → IDLE / thế); policy cho phép từng loại gián đoạn; ghi chuyển trạng thái không hợp lệ |
| `core/actionCore.test.ts` | Job là định nghĩa đã đăng ký; trạng thái nhân vật CRAFTING/LOOTING/IDLE; vào thế không dừng chuyển đồ, vung đòn thì dừng; request chế tạo và chuyển đồ lặp chạy một lần; giới hạn hàng đợi có lý do; version object, New Game đặt lại |

**Kiểm chứng:**
- `npm test`: 1075 pass, 13 skip;
- `tsc`, `oxlint`, `build`, `build:editor`, `check:bundle`, `map:check` sạch.

## 4. Chính xác hóa so với AX0

- **Thứ tự gián đoạn:**
  - Gián đoạn được xử lý ngay tại chỗ nó xảy ra trong tick: di chuyển → đánh/đẩy → trúng đòn; chết được xét khi tới bước hàng đợi.
  - Tất cả đều trước khi hàng đợi tiến, nên một action không bao giờ hoàn tất trong đúng tick nhân vật bị đánh (mục tiêu của AX0 §3).
  - Không gom event lại để xếp ưu tiên. Cách gom sẽ đổi lý do hủy trong vài tổ hợp hiếm và đổi các event mà test cũ kiểm tra.
- **State machine dựng trạng thái từ "facts" của tick** (sống, di chuyển, thế, đang vung, action đang chạy) thay vì nhận event rời rạc. Các event của AX0 §3.2 tương ứng với việc facts thay đổi, còn bảng chuyển trạng thái được kiểm bằng `violations`.
- **Kiểm tra lúc gửi:** mỗi feature có hàm `prepare*` riêng (`prepareTransfer`, phần kiểm tra trong `startRecipe`). Hook `validate` chung chưa cần vì hai định nghĩa hiện có đều kiểm tra lại ở `begin`/`commit`.
- **Effect `world.set` (cửa/tủ/đèn) làm ở AX4** cùng provider.
- **`ActionContext.amount` thêm ở AX2** khi có ăn/uống.

## 5. Giới hạn, việc tiếp theo

- UI chưa gửi `requestId`. Cơ chế đã có và đã có test; AX2 (menu item) và AX4/AX5 (click, menu thế giới) sẽ gửi một ID mỗi cử chỉ.
- `characterState` chưa hiện trên HUD. AX3 dùng nó cho animation, AX6 cho trạng thái "đang đi tới".
- **Tiếp theo — AX2 Item Action System:**
  - `ItemComponents`, `ItemActionRegistry` thay nhánh `kind` trong menu;
  - `EAT`/`DRINK`/`HEAL` có thời gian theo D4;
  - `OPEN_ITEM` + đồ hộp niêm phong (D3);
  - tự lấy đồ từ tủ/đất trước khi dùng.
