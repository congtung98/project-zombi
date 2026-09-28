# INV-LOOT S5 — Kéo quét nhiều món, thả vào tab, thế chiến đấu khi mở cửa sổ, balo trên lưng, item không xác định

> Phase: `docs/Phase_Inventory_Loot_Upgrade.md`. Trước đó: `docs/inventory-loot-s0.md` … `s4.md`.
> Nhánh `feature/inventory-loot`. Ngày 2026-09-28.
> Phạm vi gồm 4 yêu cầu của chủ dự án khi giao S5 (§1.1–§1.4), cộng phần còn lại của Sprint 5 trong spec (§1.5).

## 1. Kết quả

### 1.1 Chọn và kéo một cụm món chỉ bằng chuột trái (yêu cầu 1)

Mọi thao tác nằm ở `ItemTable.tsx`, tính theo ID dòng, không theo chỉ số:

- **Nhấn rồi kéo lên hoặc xuống trong danh sách** (quét chọn):
  - chọn mọi dòng từ dòng vừa nhấn tới dòng dưới con trỏ, theo cả hai chiều;
  - Ctrl + quét thì cộng thêm vào vùng đang chọn;
  - tới mép trên hoặc mép dưới thì danh sách tự cuộn; danh sách dài dùng virtual list vẫn quét được.
- **Thả tay ngay trong danh sách:** vùng quét vẫn được chọn, không chuyển gì. Sau đó:
  - kéo tiếp một dòng trong vùng đó thì mang cả cụm đi;
  - hoặc bấm "Lấy đã chọn" / "Cất đã chọn".
- **Quét xong kéo luôn sang ngang** (quá 48 px so với điểm nhấn) hoặc ra xa khỏi danh sách: mang cả cụm vừa quét đi, trong **một thao tác**. Ví dụ: tủ bếp có 3 món, nhấn món 1, kéo xuống món 2, kéo tiếp sang cửa sổ Túi đồ, thả tay, 2 món vào túi. Chiều ngược lại cũng làm được.
- **Kéo ngang ngay từ đầu:** mang dòng đó (hoặc cả vùng đang chọn nếu dòng nằm trong đó) đi ngay, giữ đúng luật kéo thả của S4. Chỉ khi chuyển động chủ yếu theo chiều dọc mới thành quét chọn.
- **Đích thả được tô sáng** (viền đứt màu accent): danh sách, panel hoặc tab của một inventory khác.
- **Giới hạn:** nếu vừa quét vừa kéo thẳng lên một tab nằm ngay phía trên, con trỏ sẽ đi ngược qua các dòng, nên vùng quét co lại. Quy tắc này giống quét chọn trong Explorer. Muốn thả lên tab phía trên thì làm hai thao tác: quét, thả tay, rồi kéo cụm đã chọn lên tab.

### 1.2 Cửa sổ không chặn thế chiến đấu (yêu cầu 2)

- **Runtime** (`runtime.ts`):
  - `uiOpen` không còn chặn yêu cầu thế chiến đấu hay đòn đánh;
  - nút chuột vẫn chỉ tính khi nhấn trên canvas, nên nhấn trên cửa sổ không bao giờ thành đòn đánh (T23 giữ nguyên);
  - mở cửa sổ bằng I hoặc E vẫn rời thế (luật CS1). Nếu đang giữ chuột phải lúc mở cửa sổ, phải thả ra rồi nhấn lại mới vào thế.
- **Vào thế thì thu gọn cửa sổ, giống PZ:**
  - mọi cửa sổ (Túi đồ, Lục đồ, Chế tạo), kể cả cửa sổ đã ghim, thu gọn về thanh tiêu đề;
  - menu, thẻ tooltip và thao tác kéo đang dở đều đóng;
  - chuột trái đánh bình thường;
  - rời thế thì cửa sổ đã ghim tự mở lại; cửa sổ không ghim vẫn thu gọn tới khi đưa chuột vào;
  - lúc đang ngắm, lướt chuột qua thanh tiêu đề không mở cửa sổ ra.
- **Cửa sổ không ghim:**
  - không thu gọn ngay khi chuột rời đi; đợi **1,5 s** (trước đây 0,35 s);
  - nhấn chuột lên thế giới (canvas) thì thu gọn ngay;
  - đang kéo một món ra khỏi cửa sổ thì cửa sổ không thu gọn.

### 1.3 Model balo trên lưng (yêu cầu 3)

- `rendering/character/backpackModel.ts` dựng balo từ các khối hộp, cùng kiểu với model vũ khí tạm: thân, nắp gập, túi trước, và hai quai đi qua vai xuống ngực.
- Balo gắn vào xương torso, nên nghiêng, xoay và ngã theo ngực.
- Mặt sau balo tựa đúng lưng áo:
  - preset to/đậm thì balo lùi ra sau;
  - mặc áo khoác thì cộng thêm độ dày áo.
- `PlayerView` gắn hoặc gỡ model theo `equipment.backInstanceId`. Model được tạo lại khi đổi chất lượng bóng.
- Ảnh: `player-backpack(-close)`, `player-backpack-front(-close)`.

### 1.4 Kéo thả vào tab: túi chính ↔ balo, dưới đất ↔ tủ (yêu cầu 4)

- Mọi tab đều là đích thả (`data-drop-key`):
  - trong Túi đồ: "Túi chính", "Balo đang đeo";
  - trong Lục đồ: "Dưới đất" và từng tủ trong tầm;
  - chế độ gọn (compact): các tab trên thanh tiêu đề.
- Thả lên tab nào thì đồ vào inventory của tab đó, dù cửa sổ đang hiện tab khác. Lệnh đi qua `queueTransfer`, nên có đủ thời gian chuyển, giữ chỗ, kiểm tra tầm và chỗ trống.
- Ví dụ đã chạy thật:
  - quét Băng gạc + Đinh, thả lên tab Balo;
  - kéo Đinh từ tab Balo về tab Túi chính;
  - kéo Nước từ tủ thả lên tab Dưới đất, rồi quét hai đống nước dưới đất thả về tab tủ.
- Luật cũ vẫn giữ: tủ ngoài tầm từ chối với lý do; balo không vào balo.

### 1.5 Phần Sprint 5 của spec

- **Item không xác định (§11.3.7, T19, T20)**, module `systems/recovery.ts`:
  - **Validator:** một món có `itemId` mà phiên bản này không biết không còn làm cả save bị coi là hỏng. Món đó được nhận nếu có hình dạng hợp lệ: có ID, số lượng nguyên dương, có `kind`, favorite đúng theo version.
  - **Load:** món đó thành instance `unknown` (`itemId: 'unknown_item'`, số lượng 1) và giữ nguyên `raw` payload. Áp dụng cho túi chính, tủ, dưới đất và nội dung balo, ở cả save cũ đi qua migration (thử bằng fixture v9 thật).
  - **Trang bị:** vũ khí hoặc balo đang trang bị mà là món lạ thì được tháo ra (vẫn nằm trong túi). Toast báo số món và ID gốc.
  - **Hạn chế:** không dùng, trang bị, đeo, gộp, tách được; không bỏ vào balo, vì có thể chính nó là một balo có nội dung. Chuyển, thả xuống đất, đánh dấu yêu thích thì vẫn được.
  - **Save:** ghi lại đúng payload gốc, dưới ID hiện tại và cờ favorite hiện tại. Phiên bản sau này biết món đó sẽ nhận lại nguyên vẹn. Load lại nhiều lần không thêm hay đổi gì.
  - **UI:** hiện "Vật phẩm không xác định (rare_gem ×3)", loại "Không xác định", icon dấu hỏi.
  - ID `unknown_item` trong save bị từ chối, vì nó không bao giờ được ghi ra.
- **Lỗi ghi IndexedDB (T21):**
  - `saveFailure.test.ts` mô phỏng lỗi hết dung lượng: save trả `false`, toast "Không lưu được: Hết dung lượng lưu trữ của trình duyệt.";
  - bản lưu tốt gần nhất và thông tin slot trên menu giữ nguyên; trạng thái trong RAM không mất; lần save sau thành công;
  - hai lần save chồng nhau: lần sau bị từ chối vì cờ `busy`, nên không có lần ghi muộn nào đè lên bản mới hơn.
- **New Game sau khi loot (T22):**
  - `worldReset.test.ts`: lục tủ, để một job đang chạy, thả đồ, đeo balo, rồi New Game;
  - kết quả: queue và sổ giữ chỗ rỗng, cửa sổ đóng, không tủ nào `opened`, dưới đất rỗng;
  - snapshot **trùng khít** với New Game cùng seed trên một runtime chưa từng chơi;
  - phía UI: `inventoryUiStore.resetSession()` (New Game, Continue, về menu) xóa vùng chọn, menu, tooltip, thao tác kéo, tab Lục đồ và cờ thế chiến đấu của world cũ; bố cục cửa sổ, sort và lọc được giữ.
- **Đã có từ trước, S5 kiểm lại:**
  - dùng, trang bị, độ bền, bị đánh hoặc chết thì hủy (T07, T11, T12, T29);
  - save giữa batch (T18).
  - Hotbar: game không có (audit S0).

## 2. Kiểm chứng (đã chạy thật)

| Cổng | Kết quả |
|---|---|
| `npm test` | **1042 pass**, 13 skip (sau S4: 1030) |
| Soak | **Trùng từng số với S4.** shelter 1800 s / 14 kill / 110 dmg; patrol 1379,3 s / 38 kill / 230 dmg. Toàn vẹn 1800 + 1379 lần kiểm tra, đều đúng |
| `tsc -b`, `oxlint` | Sạch |
| `vite build`, `build:editor`, `check:bundle`, `map:check` | OK |
| `scripts/il-s5-browser.mjs` (Chrome GPU, chuột thật) | **PASS** |
| `il-s4`, `il-s3`, `il-s2-browser.mjs` (hồi quy) | **PASS** |
| `cs1-combat-browser.mjs` (hồi quy chiến đấu) | **PASS** |

### Test mới

- `recovery.test.ts`:
  - T19: bốn món lạ (stack yêu thích, vũ khí đang cầm, balo đang đeo kèm nội dung, dụng cụ trong tủ);
  - T20: load lặp lại;
  - món lạ trong save v9 đi qua migration;
  - hình dạng hỏng vẫn bị từ chối.
- `saveFailure.test.ts`: T21.
- `worldReset.test.ts`: T22.
- `backpackModel.test.ts`: balo nằm sau lưng theo preset, quai tới ngực, chỉ balo có model.
- `inventoryUi.test.ts`: quét hai chiều, Ctrl + quét, nhóm vẫn ra đủ instance (T05); thế chiến đấu đóng popup, kéo, tooltip; `resetSession`; tên item lạ.
- `runtime.test.ts`: test "cửa sổ mở chặn đòn" thay bằng luật mới:
  - giữ chuột phải lúc mở cửa sổ thì rời thế và phải nhấn lại;
  - cửa sổ vẫn mở thì chuột phải vẫn vào thế, chuột trái vẫn đánh.

### Trình duyệt (`il-s5-browser.mjs`)

1. **Quét chọn:**
   - tủ có Đồ hộp, Nước, Snack; quét 2 dòng đầu, thả tay trong danh sách: còn 2 dòng được chọn, không có job nào;
   - quét lại rồi kéo sang Túi đồ: danh sách Túi đồ sáng lên, thả tay, vào túi 2 món, tủ còn 1.
2. **Quét ngược** (dòng dưới lên dòng trên) rồi kéo chéo xuống sang tủ: vùng quét giữ nguyên 2 dòng, cả hai vào tủ.
3. **Balo:** quét Băng gạc + Đinh, kéo cụm lên tab "Balo đang đeo" (tab sáng lên, bóng kéo ghi "2 món"): vào balo 3 + 20. Kéo Đinh từ tab Balo về tab "Túi chính".
4. **Dưới đất ↔ tủ:**
   - kéo Nước từ tủ lên tab "Dưới đất": dưới đất có 2 (hai đống, vì đồ dưới đất không gộp);
   - sang tab Dưới đất, quét hai đống, kéo lên tab tủ: tủ có lại 2, dưới đất còn 0.
5. **Thế chiến đấu khi hai cửa sổ ghim đang mở:** chuột phải trên thế giới thì cả hai thu gọn; chuột trái thì vung gậy; thả chuột phải thì cả hai mở lại.
6. **Balo trên lưng:** chụp nhìn sau và nhìn trước ở zoom tối đa.
7. **Cửa sổ không ghim:**
   - sau khi rời chuột 0,7 s vẫn mở; tới 2,1 s đã thu gọn;
   - đưa chuột vào thanh tiêu đề thì mở ra;
   - nhấn chuột lên thế giới thì thu gọn ngay; cửa sổ Lục đồ đã ghim vẫn mở.
8. **Item lạ:**
   - chèn `rare_gem ×3` vào save trong IndexedDB, reload, Continue: toast báo, dòng "Vật phẩm không xác định (rare_gem ×3)", menu không có Ăn / Dùng / Trang bị;
   - Lưu và về menu: bản ghi trong IndexedDB **trùng khít** payload đã chèn, kể cả trường lạ `cut: 'oval'`.

Ảnh: `docs/inventory-loot/s5/`:

- `inventory-sweep-select`, `inventory-sweep-drag`, `inventory-drop-on-bag-tab`, `inventory-floor-to-container-tab`;
- `inventory-stance-collapsed`, `inventory-unknown-item`;
- `player-backpack`, `player-backpack-close`, `player-backpack-front`, `player-backpack-front-close`.

## 3. Cần chủ dự án duyệt / quyết

1. **Rời thế thì cửa sổ đã ghim tự mở lại.** Nếu muốn chúng ở trạng thái thu gọn cho tới khi bấm mở, đổi được dễ.
2. **Thời gian chờ thu gọn cửa sổ không ghim là 1,5 s** (hằng số `AUTO_COLLAPSE_MS`). Nhấn chuột lên thế giới thì thu gọn ngay.
3. **Nhận diện cử chỉ quét:**
   - chuyển động chủ yếu theo chiều dọc là quét;
   - chuyển động chủ yếu theo chiều ngang là kéo;
   - đang quét mà lệch ngang 48 px là chuyển sang mang đi.
4. **Item lạ không vào balo** (vì có thể chính nó là balo), và **được tháo ra nếu đang trang bị lúc load**. Từ lần save sau, trạng thái trang bị lưu là "không cầm".
5. **Bốn điểm chờ duyệt của S4 giữ nguyên như đề xuất** (thông số thời gian, mốc soak, Esc hủy cả hàng đợi, cách đếm "món"), coi như đã duyệt khi giao S5. Nếu muốn đổi, báo lại.

## 4. Lệch so với kế hoạch và việc đi kèm

- **Test hỏng từ commit `ba1db67` (đổi khoảng zoom camera thành 32–128):**
  - 7 test round-trip fixture (`inventoryV10`, `floor`, `phase2-save`) so snapshot sau load với save gốc có `cameraZoom: 28`, nay bị clamp lên 32;
  - đã sửa test cho khớp luật clamp (`zoomAfterLoad`); code game không đổi.
- **Test ngẫu nhiên S4** (12 thị trấn × 120 thao tác) mất khoảng 3,8 s khi chạy riêng, vượt 5 s khi cả bộ chạy song song. Đặt timeout rõ ràng 30 s.
- **`cs1-combat-browser.mjs` đã lỗi thời từ S2** (vẫn tìm `.inv-panel-container` của UI cũ). Đã cập nhật theo cửa sổ mới và luật S5, và thêm kiểm tra: cửa sổ Túi đồ đang mở thì chuột phải vẫn vào thế và cửa sổ thu gọn.
- **`il-s2-browser.mjs`:** chờ 1,9 s thay cho 0,6 s để khớp thời gian thu gọn mới.
- **Test đo thời gian `navTiles` (A* < 8 ms)** từng hỏng một lần, trong lúc Vite đang bundle cùng lúc. Chạy lại khi máy rảnh thì pass. Không liên quan S5.
- **Để lại S6:**
  - polish (icon băng keo, empty state, accessibility);
  - profiling UI;
  - ảnh bàn giao theo §15;
  - ma trận T01–T30 đầy đủ;
  - tổng kết phase.

## 5. File

- **Mới:**
  - `src/game/systems/recovery.ts` (+ test);
  - `src/game/rendering/character/backpackModel.ts` (+ test);
  - `src/components/inventory/dragDrop.ts`;
  - test: `src/game/core/worldReset.test.ts`, `src/stores/saveFailure.test.ts`;
  - `scripts/il-s5-browser.mjs`.
- **Sửa:**
  - `core/runtime.ts` (thế chiến đấu không bị `uiOpen` chặn, mở cửa sổ thì rời thế, recovery lúc load, dạng lưu lúc snapshot), `core/events.ts` (`items:recovered`);
  - `entities/items.ts` (`unknown_item`, `UnknownItemInstance`), `systems/inventory.ts` (`accepts`), `systems/save.ts` (validator);
  - `rendering/PlayerView.tsx` (balo);
  - `components/inventory/`:
    - `ItemTable.tsx`: quét chọn, đích thả;
    - `InvWindow.tsx`: thu gọn khi vào thế, trễ 1,5 s, nhấn lên thế giới thì thu gọn;
    - `Panels.tsx`, `InventoryOverlay.tsx`: tab là đích thả;
    - `selection.ts`: `sweepRows`;
    - `labels.ts`: `itemName`, nhãn;
    - `rows.ts`, `ItemCard.tsx`, `itemActions.ts`, `ItemIcon.tsx`;
  - `stores/inventoryUiStore.ts` (`stance`, `drag.target`, `resetSession`), `stores/uiStore.ts`, `stores/hudStore.ts`;
  - `app/App.tsx`, `index.css`;
  - test: `runtime.test.ts`, `save.test.ts`, `actionQueue.test.ts`, `inventoryV10.test.ts`, `floor.test.ts`, `phase2-save.test.ts`, `inventoryUi.test.ts`;
  - `scripts/il-s2-browser.mjs`, `scripts/cs1-combat-browser.mjs`.
