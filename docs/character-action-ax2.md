# AX2 — Item Action System

> Nhánh `feature/character-action`, ngày 2026-09-30. Kiến trúc: `docs/character-action-ax0.md` §2.6, §6. Lõi: `docs/character-action-ax1.md`.

## 0. Quyết định áp dụng

- **D3:** đồ hộp niêm phong, mở bằng tay 1,5 s, chưa cần đồ khui hộp.
- **D4:** thời gian dùng đồ:

  | Món | Thời gian |
  |---|---|
  | Đồ hộp đã mở | 3 s |
  | Snack | 2 s |
  | Nước, nước ngọt | 2,5 s |
  | Băng gạc | 3 s |
  | Hộp cứu thương | 5 s |

- **D7:** vào thế chiến đấu thì hủy ăn/uống/băng bó/mở hộp.

## 1. Người chơi thấy gì

- **Menu chuột phải trên item** dựng từ thành phần của món:
  - Nước, nước ngọt → **Uống**; snack, đồ hộp đã mở → **Ăn**; băng gạc, hộp cứu thương → **Băng bó / sơ cứu**.
  - Đồ hộp → **Mở** và **Mở rồi ăn**.
  - Vũ khí → **Trang bị / Sửa**; balo → **Đeo / Tháo**.
  - Mục bị khóa luôn có lý do: *Đang dùng cho thao tác khác*, *Chỉ số đã đầy*, *Hết chỗ*, *Chuyển vào túi chính trước*, hoặc lý do của recipe.
- **Dùng đồ có thời gian:** thanh tiến trình trên HUD và trong cửa sổ hiện "Uống Nước", "Mở Đồ hộp", "Ăn Đồ hộp (đã mở)". Nút Hủy / X / Esc dùng như chuyển đồ.
  - Chỉ số và số lượng chỉ đổi **khi xong**.
  - Di chuyển, bị đánh, vung đòn, vào thế hoặc chết thì hủy; không mất gì.
- **Dùng thẳng từ tủ hoặc dưới đất:**
  - "Uống" trên chai nước trong tủ tạo hai việc nối nhau: **Lấy vào túi chính** (đúng một đơn vị, có kiểm tra tầm với) rồi **Uống**.
  - Không lấy được (ngoài tầm, túi đầy) thì việc sau không chạy.
  - Túi chính hết chỗ thì mục menu khóa với lý do *Hết chỗ*.
- **Đồ hộp:**
  - "Mở rồi ăn" gồm Mở (1,5 s) rồi Ăn (3 s).
  - Mở xong mà việc ăn bị hủy thì hộp **vẫn đã mở**, và save/load giữ nguyên.
  - Không còn chỗ cho hộp đã mở (túi đầy, không có stack hộp mở để gộp) thì từ chối ngay trước khi bắt đầu.
- **Toast:** "Đã mở Đồ hộp." khi mở; lý do tiếng Việt cho mọi trường hợp từ chối.

## 2. Kiến trúc

**Item = thành phần:**
- Các trường tùy chọn của `ItemDefinition` chính là component: `melee`, `bag`, `consumable` (mới), `sealed` (mới), `repairGroup`, `toolTags`, `transfer`.
- `consumable = { action: EAT | DRINK | HEAL, portions, seconds, leaves? }`. `effect` là lượng một phần đem lại. Phase này mọi món có `portions: 1`.
- `sealed = { opensTo, seconds, requiresToolTag? }`.
- Món mới **`canned_food_open`** (Đồ hộp (đã mở), icon hộp mở nắp). `canned_food` giờ là hộp niêm phong, `effect` rỗng.

**Item Action Registry (`src/game/items/itemActions.ts`):**
- Provider theo component, đăng ký theo thứ tự: `equippable`, `consumable`, `sealed`, `repairable`. `itemOptions(query)` gộp các option kèm lý do khóa.
- Menu (`components/inventory/itemActions.ts`) chỉ render các option đó, cộng thêm Chuyển / Chọn số lượng / Bỏ xuống / Yêu thích / Xem (chung cho mọi món).
- Thêm một kiểu dùng mới = thêm một provider và một action. Không sửa menu hay code nhân vật (FB §6).

**Action (`src/game/actions/defs/use.ts`):**

| Action | Trạng thái nhân vật | Presentation (AX3 dùng) |
|---|---|---|
| `EAT` | EATING | `eat`, prop tay phải, cất vũ khí |
| `DRINK` | DRINKING | `drink`, prop tay phải, cất vũ khí |
| `HEAL` (target `self`, món là `ctx.item`) | HEALING | `medical`, prop tay trái |
| `OPEN_ITEM` | INTERACTING | `work` |

- `begin` kiểm tra lại (còn món, còn tác dụng, có dụng cụ, có chỗ), rồi giữ chỗ **1 đơn vị** (loại `use` trong ledger).
- `commit` trả **một mutation**: các `stat` + `item.consume` + `item:used`. Với mở hộp: `inventory.write` trên bản sao (−1 niêm phong, +1 đã mở) + `item:opened`.

**Chuỗi job của một request (`ActionChain`, `actionSystem.ts`):**
- `runtime.useItem(source, instanceId, { open?, requestId?, source? })` xếp tối đa 3 job: TRANSFER → OPEN_ITEM → EAT/DRINK/HEAL. Tất cả dùng chung một `chain`.
- Một job kết thúc mà không làm được phần của mình (hook `succeeded`) thì chain bị đánh dấu hỏng, và các job sau rời hàng đợi mà không chạy.
- Job sau tìm lại món nó cần: chuyển đồ có thể gộp món vào một stack khác, mở hộp tạo món khác. Nó tìm theo ID trước, rồi theo `itemId` trong túi chính / balo đang đeo, ưu tiên món không phải yêu thích.

**Chặn click kép:** mục menu gửi `requestId` mới cho mỗi lần bấm (`newRequestId`). Cùng ID gửi lại thì bị bỏ qua.

**Đường dùng tức thời cũ đã bỏ:**
- `runtime.consumeItem`, `runtime.activateItem` (không còn UI nào gọi) và `consumeInventoryItem` / `applyItemEffect` trong `survival.ts`.
- `UseItemFailure` thêm `full`, `missing-tool`, `reserved`, `busy`, `unreachable`, `queue-full`.

## 3. Mốc soak mới (thay đổi cân bằng có chủ đích)

Ăn, uống, băng bó giờ tốn thời gian đứng yên và không làm được giữa trận. Bot soak dùng đồ như người chơi: qua `useItem`, đứng yên khi đang dùng, chỉ bắt đầu khi zombie gần nhất cách hơn 3 m, ưu tiên máu. Bot shelter băng bó khi máu dưới 85 lúc yên, thay vì dùng tức thời dưới 45 giữa trận như trước.

| Soak | Trước (AX1) | AX2 |
|---|---|---|
| shelter (cổng: sống đủ 30 phút) | 1800 s, 14 kill, 110 dmg | **1800 s, 7 kill, 30 dmg**, dùng: nước 3, đồ hộp đã mở 3, nước ngọt 1, băng gạc 1; 1800 lần kiểm tra toàn vẹn |
| patrol (không có cổng sống sót) | 1379,3 s, 38 kill | **812,2 s, 31 kill, 200 dmg** (đánh liên tục, băng bó 5 lần lúc tạm yên) |

- Với ngưỡng cũ (<45 và không zombie trong 5 m), shelter chết ở 1508 s. Nó bị 5 zombie ập vào nhà (cửa đã vỡ từ giây 67) khi còn 80 máu, và chưa lần nào kịp băng bó.
- Đây là hệ quả thật của việc dùng đồ có thời gian. Chiến thuật hợp lý là băng bó lúc yên.
- Kiểm tra toàn vẹn của soak cộng thêm sự kiện `item:opened` (−1 hộp niêm phong, +1 hộp đã mở). Nó vẫn khớp từng đơn vị mỗi giây.

## 4. Test

**`core/itemUse.test.ts` (10 test):**
- **Case 2:** uống có thời gian, hiệu ứng và số lượng đổi cùng lúc khi xong, về IDLE.
- **Request lặp:** cùng request uống hai lần chỉ uống một lần.
- **Bị đánh giữa chừng (CAS §11):** bị đánh ở giây 1,5 thì hủy; nước, khát và giữ chỗ như cũ.
- **Case 5 / D7:** vào thế hoặc bước đi khi đang ăn thì hủy, không mất snack, chuyển sang COMBAT_STANCE / MOVING.
- **Chết giữa lúc băng bó:** không mất băng gạc; target của HEAL là `self`.
- **Món đang dùng:** không chuyển đi hay dùng lần hai được.
- **Chỉ số đầy:** từ chối ngay kèm lý do.
- **Case 6 (đồ hộp):** mở rồi ăn; hủy lúc ăn thì hộp vẫn mở qua save/load; ăn lại thì +35 đói.
- **Mở không đủ chỗ:** chỉ mở thì được một hộp; không chỗ thì từ chối trước khi bắt đầu.
- **Case 6 (dụng cụ):** yêu cầu dụng cụ là dữ liệu trên item (`requiresToolTag`). Thiếu thì `missing-tool`, có xà beng thì mở được. Thêm đồ khui hộp chỉ cần một tag.
- **Dùng từ tủ:** lấy vào túi rồi uống; ra ngoài tầm thì không uống gì, không còn job hay giữ chỗ.

**`items/itemActions.test.ts` (4 test):**
- option theo thành phần;
- vũ khí/balo;
- lý do khóa;
- món lạ không có option;
- provider trùng bị báo lỗi.

**Test cũ đổi theo:**
- `runtime.test`, `inventoryV10`, `phase2-save`, `recovery`, `actionQueue`: dùng `useItem` và chạy đủ thời gian.
- `inventoryUi.test`: uống từ tủ giờ bật; hết chỗ thì khóa *Hết chỗ*.
- `survival.test`: bỏ các test của hàm tức thời đã xóa (hành vi của chúng nay nằm trong `itemUse.test`).
- `actionSystem.test`: `enqueue` nhận options.

**Kiểm chứng:**
- `npm test` 1085 pass, 13 skip;
- tsc, oxlint, build, build:editor, check:bundle, map:check sạch;
- trình duyệt (Chrome GPU, chuột thật): `il-s2` (bấm "Mở rồi ăn" trên hộp niêm phong: đói 20 → 54,6), `il-s3`, `il-s4`, `il-s5`, `cs1-combat` PASS;
- `il-s2` đổi regex menu sang `Ăn|Uống|Mở rồi ăn`.

## 5. Giới hạn, việc tiếp theo

- Chưa có animation riêng: khi dùng đồ nhân vật vẫn làm pose `work` chung (theo `workElapsed`). **AX3** thêm nhóm pose `eat`/`drink`/`medical`/`reach`, món cầm trên tay và socket tay trái, dựa trên `presentation` đã khai báo ở đây.
- Chỉ dùng được từ túi chính, balo đang đeo, tủ trong tầm và dưới đất. Chưa có hotbar hay phím tắt dùng đồ (ngoài phạm vi).
- Ăn dở (`portions > 1`), thối rữa, lon rỗng (`leaves`), rót nước: mới có chỗ trong dữ liệu, chưa có món nào dùng.
