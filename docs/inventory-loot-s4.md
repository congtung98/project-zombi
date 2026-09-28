# INV-LOOT S4 — Hàng đợi có thời gian, giữ chỗ chung, kéo thả, hộp số lượng

> Phase: `docs/Phase_Inventory_Loot_Upgrade.md`. Trước đó: `docs/inventory-loot-s0.md` … `s3.md`.
> Nhánh `feature/inventory-loot`. Ngày 2026-09-28. **Mốc dừng chờ duyệt** (Q1): transfer và queue.

## 1. Kết quả

### Một hàng đợi (`runtime.jobs`, `systems/actionQueue.ts`)

- **Transfer, chế tạo và sửa** chung một hàng đợi, chạy tuần tự (Q3). Job đầu hàng là job đang chạy.
- **Chỉ job đang chạy giữ chỗ.** Hàng đợi và sổ giữ chỗ không bao giờ được lưu; load hay New Game xoá sạch cả hai.
- **Sổ giữ chỗ duy nhất** `ReservationLedger`:
  - lưu số đơn vị của từng instance theo `actionId`; một instance không bao giờ bị giữ vượt số lượng;
  - hủy hay hoàn tất một action chỉ trả phần của chính action đó.
- Món đang được **transfer** giữ thì không dùng, không trang bị, không chuyển được. Món đang được **chế tạo/sửa** giữ thì vẫn trang bị được (giữ luật cũ của P2-S4, ví dụ vũ khí đang sửa vẫn cầm được).
- **Claims khi xếp hàng:**
  - claims = đơn vị mà các dòng transfer đang chờ và các recipe đang chờ sẽ dùng;
  - lúc xếp hàng, phần còn trống = số lượng − phần đang giữ chỗ − claims;
  - vì vậy spam nhấp đúp, kéo thả, "Lấy hết" hay "Chế tạo" không bao giờ xếp quá số đồ đang có; bị từ chối ngay với lý do "Đã xếp hàng" hoặc "Đang dùng cho thao tác khác".

### Transfer có thời gian (spec §8, audit §4)

- **Thời lượng bước:**
  - đồ nhỏ đi theo lô: đinh 10/0,3 s, băng gạc 3/0,25 s, băng keo 5/0,3 s;
  - đồ khác mỗi đơn vị clamp(0,2 + kg × 0,15; 0,2; 1,5) s: nước 0,29 s, đồ hộp 0,26 s, ván gỗ 0,5 s; balo tính theo vỏ + đồ bên trong.
  - Thông số nằm trong item definition và `GAME_CONFIG.transfer`.
- **Máy trạng thái của mỗi bước:**
  - Pending → Running: kiểm tra tầm với, trang bị, Favorite, giữ chỗ, chỗ trống; rồi giữ chỗ.
  - Running → Committed: kiểm tra lại toàn bộ, chuyển đúng số đơn vị trong một mutation, trả giữ chỗ.
  - Món không còn chỗ thì bị bỏ qua với lý do; các món khác vẫn đi, kể cả gộp vào stack còn chỗ. Không kẹt vô hạn.
- **Không phụ thuộc FPS:** tiến trình cộng dồn dt mô phỏng (dừng khi pause thật). Một tick có thể hoàn tất nhiều bước, phần thời gian dư chuyển sang bước sau.
- **Hủy:**
  - di chuyển, đánh/đẩy, bị trúng đòn, chết, X, Esc, nút Hủy: hủy job đang chạy và toàn bộ job chờ;
  - bước đang chạy không chuyển gì; các bước đã commit được giữ nguyên;
  - tủ ra ngoài tầm: hủy riêng các job dùng tủ đó (`unreachable`), job khác chạy tiếp;
  - `cancelJob(id)` bỏ một job riêng (nút × trong danh sách chờ).
- **Tóm tắt:** mỗi job phát một tóm tắt `inventory:transferred`, ví dụ "Đã chuyển 3 · 3 món không chuyển: Hết chỗ (3).". Toast hủy ghi cả số job chờ bị hủy kèm.

### Chế tạo và sửa (Q2, Q3)

- **Nguồn nguyên liệu** (`crafting.ts`):
  - túi chính trước, balo đang đeo sau, cộng được từ cả hai; một hàm `usableInventories` duy nhất;
  - không tự tiêu thụ món Favorite hay đang trang bị;
  - không dùng đơn vị đang bị action khác giữ.
- **Kế hoạch theo instance:** `checkRecipe` trả về kế hoạch cụ thể; lúc bắt đầu giữ chỗ đúng kế hoạch đó, lúc commit tiêu thụ đúng kế hoạch đó. Kế hoạch không còn đúng (món đã bị chuyển đi) thì thất bại, không thay đổi gì.
- **Khi xếp hàng:**
  - chỉ được xếp nếu đồ **đang mang và chưa bị giữ/claim** đã đủ, nếu không thì báo "chưa đủ nguyên liệu đang mang";
  - tới lượt thì kiểm tra lại; không còn hợp lệ thì bỏ qua với lý do, không trừ một phần, hàng đợi chạy tiếp.
- **Một vũ khí chỉ có một lần sửa** trong hàng đợi (lý do "đã có trong hàng đợi").
- Balo đang đeo mà bên trong có đồ đang bị giữ chỗ thì không tháo, chuyển hay bỏ được.

### UI

- Mọi lệnh chuyển của UI đi qua `runtime.queueTransfer`: nhấp đúp, Lấy/Cất đã chọn, Lấy hết (cả tủ, bỏ qua bộ lọc), Bỏ xuống, menu.
- **Thanh thao tác** trong Túi đồ:
  - job đang chạy với tiến trình bước, "x/y" đơn vị của cả job, thời gian còn lại, nút Hủy / Hủy hết;
  - **danh sách job đang chờ**, mỗi job có nút ×.
  - HUD hiện cùng dữ liệu khi Túi đồ đóng.
- **Nhãn dòng:** "Đang dùng" cho món đang được giữ, "Chờ chuyển" (viền đứt) cho món đã xếp hàng. Số lượng chỉ đổi khi commit, không đổi trước.
- **Kéo thả:** giữ chuột trên dòng rồi kéo quá 5 px sang cửa sổ hoặc tab khác (`data-drop-key`); có bóng kéo. Kéo các dòng đang chọn, hoặc chỉ dòng đó.
- **Hộp số lượng:**
  - mở bằng Shift + kéo một stack, hoặc mục menu "Chọn số lượng…";
  - số nguyên 1..số lượng, nút Tối đa / Đồng ý / Hủy, chọn đích; Enter đồng ý, Esc hủy;
  - runtime kiểm tra lại khi xếp hàng và ở từng bước.
- **Chế tạo:** nút đổi thành "Xếp hàng chế tạo" khi đang có việc; kiểm tra nguyên liệu theo túi chính + balo đang đeo.
- **Esc:** popup → **hủy cả hàng đợi** (cửa sổ vẫn mở) → cửa sổ → rời thế → pause.

## 2. Kiểm chứng (đã chạy thật)

| Cổng | Kết quả |
|---|---|
| `npm test` | **1030 pass**, 13 skip (sau S3: 1011) |
| Soak (bot đi qua hàng đợi + kiểm tra toàn vẹn mỗi giây) | **PASS**. shelter 1800 s / 14 kill / 110 dmg; patrol 1379,3 s / 38 kill / 230 dmg. Toàn vẹn **1800 và 1379 lần kiểm tra, lần nào cũng đúng**. Vẫn lấy 26 món từ 11 tủ |
| `tsc -b`, `oxlint` | Sạch |
| `vite build`, `build:editor`, `check:bundle`, `map:check` | OK |
| `scripts/il-s4-browser.mjs` (Chrome GPU) | **PASS** 2/2 lần chạy |
| `il-s2-browser.mjs`, `il-s3-browser.mjs` (hồi quy) | **PASS** (S3 chạy 3/3) |

### Mốc chủ dự án yêu cầu cho S4

Chi tiết ở `src/game/systems/actionQueue.test.ts`.

- **Spam thao tác (T06):** xếp một stack đồ hộp 5 lần: lần đầu được nhận, 4 lần sau bị từ chối "Đã xếp hàng"; tổng không đổi. Bấm "Chế tạo" 10 lần với nguyên liệu cho 2 gậy: 1 chạy, 1 chờ, 8 bị từ chối, ra đúng 2 gậy, nguyên liệu hết đúng 4 ván 2 băng keo.
- **Hủy giữa chừng (T07):** Lấy hết rồi bị trúng đòn: 3 nước đã commit ở lại, bước thứ 4 không chuyển gì, phần còn lại bị hủy. Tổng không đổi, sổ giữ chỗ rỗng.
- **Đầy túi (T09):** túi bị lấp đầy trong lúc job chờ: nước vẫn gộp vào stack còn chỗ (5), băng gạc ở lại tủ với lý do Hết chỗ, số ô không vượt giới hạn.
- **Craft và transfer tranh cùng nguyên liệu:**
  - craft đang chờ mà ván gỗ bị chuyển đi: tới lượt thì thất bại "missing-input", không mất gì, hàng đợi chạy tiếp;
  - ván gỗ đang bị craft giữ thì xếp chuyển đi bị từ chối "reserved"; craft cần đồ còn trong tủ bị từ chối "missing-carried";
  - hủy transfer không trả phần giữ chỗ của craft (vẫn 2 ván); hủy craft trả đúng phần của nó;
  - **test ngẫu nhiên có seed:** 12 seed × 120 thao tác ngẫu nhiên (xếp hàng, chế tạo, hủy tất cả, hủy một job, tick với dt khác nhau). Sau mỗi thao tác: không ID trùng, không món nào bị giữ vượt số lượng, sổ giữ chỗ rỗng khi rảnh. Cuối cùng tổng mỗi loại khớp chính xác (chỉ ván gỗ/băng keo giảm đúng theo số gậy đã làm).

### Test khác

- T01 qua hàng đợi (3/10 đinh là một lô 0,3 s).
- Thời lượng bước theo cấu hình.
- **Không phụ thuộc FPS:** 30/60/144 Hz và dt 0,1 cho cùng số đơn vị tại cùng thời điểm (±1), kể cả khi một frame hoàn tất nhiều bước.
- T10: đổi thứ tự danh sách không đổi món được chuyển.
- T11: món đang chuyển không dùng hay trang bị được.
- Q2: chế tạo lấy túi chính rồi balo; balo đang đeo giữ nguyên liệu thì không tháo được.
- Tủ ngoài tầm chỉ hủy job của tủ đó.
- T18: save giữa batch chỉ có bước đã commit; load thì hàng đợi rỗng, không phát lại.
- T26: tủ 500 món, 100 lần chuyển liên tiếp: xong hết, không kẹt, không rò giữ chỗ.
- Sổ giữ chỗ và nguyên liệu từ nhiều inventory (`crafting.test.ts`).
- `timedAction.test.ts` cập nhật theo luật mới.

### Trình duyệt (`il-s4-browser.mjs`)

1. **Lấy hết 13 món:** thanh hiện "Đang làm: Lấy Nước +2 · 4/13 · 0.2 s · Hủy". Bấm Hủy: giữ 4, còn 9 ở tủ, tổng 13.
2. **Nhấp đúp 4 lần** cùng một dòng: chỉ một job, lấy đúng 3.
3. **Kéo** một dòng từ Lục đồ sang Túi đồ (có bóng kéo).
4. **Shift + kéo** stack 10 đinh: hộp số lượng, nhập 3, còn 7/3. Menu "Chọn số lượng…" → Tối đa → 4 băng keo.
5. **Túi đầy:** toast "Đã chuyển 3 · 3 món không chuyển: Hết chỗ (3)."; nước 5/1, băng gạc ở lại.
6. **Giữ phím W** giữa lúc lấy: hủy, giữ phần đã xong, toast "Đã hủy…".
7. **Chế tạo xếp sau transfer:** danh sách chờ hiện "Đang chờ: Chế tạo Gậy gỗ tự chế"; cả hai hoàn tất.
8. **Esc** khi đang lấy: hủy hàng đợi, cửa sổ vẫn mở.
9. **Pause thật** (mất focus) giữa bước: tiến trình đứng nguyên sau 1 s; tiếp tục thì xong đủ 5 nước.
10. **Save giữa batch** (đang lấy, đã có 1/4), Continue: còn 1 món, hàng đợi rỗng, sổ giữ chỗ rỗng.

Ảnh: `docs/inventory-loot/s4/`: `inventory-transfer-progress`, `inventory-drag`, `inventory-quantity-dialog`, `inventory-full-partial`, `inventory-queue-craft`.

## 3. Cần chủ dự án duyệt / quyết

1. **Thông số thời gian** là giá trị khởi điểm, chưa playtest tay: nước 0,29 s/cái, ván gỗ 0,5 s/cái, đinh 10 cái/0,3 s, balo đầy tới 1,5 s. Lấy hết một tủ bếp điển hình mất khoảng 1 s, tủ 13 món khoảng 4 s.
2. **Mốc soak đổi** vì lấy đồ giờ tốn thời gian (bot đứng lại ở tủ):
   - shelter: 3 → 14 kill, sát thương nhận 30 → 110, máu thấp nhất 35, vẫn sống 30 phút;
   - patrol: sống lâu hơn, 646 → 1379 s.

   Không thông số chiến đấu nào đổi. Có chấp nhận mốc mới không?
3. **Esc hủy cả hàng đợi** trong một lần nhấn (spec: "hủy action nếu còn action"). Nếu muốn Esc chỉ hủy job đang chạy và giữ job chờ, đổi được dễ.
4. **Tóm tắt đếm theo "món" (dòng):** một dòng chỉ chuyển được một phần (ví dụ 3/4 nước) cũng tính là "món không chuyển".

## 4. Lệch so với kế hoạch và phần chưa làm

- **Claims cho recipe đang chờ:** thêm ngoài spec. Cần để "đồ đang mang và chưa bị giữ chỗ" (Q3) không cho xếp nhiều craft hơn số nguyên liệu.
- **Đường chuyển tức thời `transferItems`:** vẫn còn, nhưng chỉ làm lõi mutation cho bước commit của hàng đợi, cho test và cho `takeFromContainer/putIntoContainer/takeAll` (API cũ, còn test dùng). UI và bot soak đều đi qua hàng đợi.
- **Script S3:** trước phần thử balo, script dọn zombie trong bán kính 40 m. Phần này không nhằm thử chiến đấu; gián đoạn do zombie đã được kiểm ở unit test và ở S4.
- **Icon băng keo** vẫn hơi giống kính lúp: sửa ở S6 (polish).
- **Để lại S5:** item không xác định (phục hồi), lỗi IndexedDB/quota (T21), new game sau khi loot (T22) mới có kiểm tra một phần qua load.

## 5. File

- **Mới:**
  - `src/game/systems/actionQueue.ts` (+ test);
  - `scripts/il-s4-browser.mjs`.
- **Sửa:**
  - `core/runtime.ts` (hàng đợi, sổ giữ chỗ, `queueTransfer`, `cancelJob`, `stepQueue`, bước transfer, recipe theo kế hoạch, claims, hủy theo tầm với), `core/events.ts`;
  - `systems/crafting.ts` (nhiều nguồn, kế hoạch), `timedAction.ts`, `inventoryCommands.ts` (lý do `queued`);
  - `stores/inventoryStore.ts` (job đang chạy, job chờ, món chờ chuyển), `stores/hudStore.ts`, `stores/inventoryUiStore.ts` (kéo, popup số lượng);
  - `components/inventory/` (ItemTable kéo thả và nhãn, Panels thanh thao tác và hàng chờ, Popups hộp số lượng, InventoryOverlay bóng kéo, itemActions, commands, escape, labels);
  - `components/CraftingPanel.tsx`, `craftText.ts`;
  - `rendering/PlayerView.tsx`;
  - `app/App.tsx`;
  - `index.css`;
  - test: `crafting.test.ts`, `timedAction.test.ts`, `soak.test.ts` (bot qua hàng đợi, kiểm tra toàn vẹn);
  - `scripts/il-s3-browser.mjs`.
