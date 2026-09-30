# AX5 — Menu chuột phải trên thế giới và làn combat

> Nhánh `feature/character-action`, ngày 2026-09-30. Kiến trúc: `docs/character-action-ax0.md` §4, §8.5. Phản hồi chủ dự án: FB §1 (contextual right click, không có "click nhanh = menu, giữ = combat"), FB §13 (combat là action/state). D2: chuột phải trên zombie không tự tung đòn. **Sau AX5 dừng chờ duyệt (D6).**

## 1. Người chơi thấy gì

| Chuột phải… | Ngoài thế chiến đấu | Trong thế (hoặc đang vung) |
|---|---|---|
| trên object (cửa, tủ, công tắc, rèm) | **Menu ngữ cảnh** cạnh con trỏ; không vào thế, kể cả khi giữ nút | combat (Toggle: rời thế; Hold: vẫn là thế) |
| trên zombie | **Vào thế, zombie là đích** (vòng đỏ dưới chân); chuột trái mới đánh (D2) | combat |
| trên đất trống | vào thế (như CS1) | combat |

- **Menu:**
  - tiêu đề là tên object; các mục theo trạng thái hiện tại, mục mặc định đứng đầu;
  - mục bị khóa hiện mờ kèm lý do (ví dụ "Lấy hết — Tủ trống" với tủ đã lục hết);
  - tủ có **Mở / Xem / Đóng** và **Lấy hết** (mở tủ nếu cần rồi xếp chuyển toàn bộ vào túi); cửa có **Mở / Đóng**; đèn **Bật / Tắt**; rèm **Kéo / Mở**.
- **Menu giữ đích của nó:** rê chuột đi chỗ khác không đổi đích; vòng sáng vẫn nằm trên object của menu.
  - Nếu object đổi trạng thái khi menu đang mở (zombie phá cửa, người khác mở), các mục tự cập nhật.
  - Chọn một mục đã cũ thì từ chối với lý do "mục tiêu đã thay đổi", không áp lên object khác.
- **Đóng menu:** Esc (tầng đầu tiên, trước cả popup cửa sổ và pause), bấm bất kỳ đâu trên thế giới (chỉ đóng, không đánh, không làm gì khác), chọn một mục, chết, New Game / load.
- **Bàn phím:** mũi tên lên/xuống, Enter.

## 2. Kiến trúc

- **Router** (`runtime.stepControls`, trước khi cập nhật thế):
  - chuột phải + object dưới con trỏ + ngoài combat → `openWorldMenu`; press đó được "tiêu thụ": Hold đặt `stance.suppressed` (nút giữ không vào thế cho tới khi nhả), Toggle không lật;
  - chuột phải + zombie → ghi đích cho lần vào thế;
  - menu đang mở + bấm trên thế giới → chỉ đóng menu;
  - chord phải + trái cùng frame vẫn là combat CS1.
- **Menu do runtime giữ:**
  - `worldMenu { targetId, version, ndc }`, sự kiện `interaction:menu` / `interaction:menuClosed`;
  - `selectMenuOption(optionId, requestId)` tra lại option trên trạng thái hiện tại rồi `InteractionSystem.execute(..., 'world-menu')`;
  - `syncWorldMenu` mỗi tick gửi lại option khi version object đổi, đóng khi object mất hoặc người chơi chết.
- **UI:** `components/WorldContextMenu.tsx` + `stores/worldMenuStore.ts`.
  - Vị trí lấy từ NDC của cú nhấn, giới hạn trong viewport, theo UI scale; dùng lại style menu của cửa sổ đồ.
  - Mỗi lần chọn mục có `requestId` mới.
- **Lấy hết:**
  - tủ đã mở dùng `TAKE_ALL` (immediate);
  - tủ chưa mở dùng `OPEN_CONTAINER { takeAll }`;
  - cả hai xếp một TRANSFER toàn bộ sau khi mở (effect `after` → `requestTakeAll`).
- **Làn combat** (`actions/defs/combat.ts`):
  - `COMBAT_STANCE` (ghi đích zombie hoặc null), `MELEE_ATTACK` (bọc `tryStartAttack`), `SHOVE` (bọc `startPush` + đẩy);
  - runtime khởi động vào thế, vung, đẩy qua `actions.perform` với context có target (zombie hoặc điểm aim);
  - nhịp độ, cửa sổ trúng đòn, sát thương, hao mòn vẫn là code combat CS1 (đã cân bằng bằng soak). **Soak trùng từng số với AX4**, tức là hành vi không đổi.
- **Hình ảnh:** vòng đỏ dưới zombie đích khi đang ở thế; vòng vàng nằm trên object của menu khi menu mở.

## 3. Test

**`core/worldMenu.test.ts` (9 test):**
- **Case 1:** chuột phải tủ → menu ["Mở Tủ", "Lấy hết"], không vào thế dù giữ nút, nhả ra vẫn không → chọn Mở → `OPEN_CONTAINER` → tủ mở.
- **Case 4:** chuột phải đất → thế, không menu.
- **Trong thế (Toggle):** chuột phải trên tủ rời thế, không menu; ngoài thế cùng cú nhấn mở menu, không lật thế.
- **Menu mở + bấm trên thế giới:** chỉ đóng (không vung, không action, không nhắc).
- **WIS §7:** menu giữ đích khi con trỏ đi chỗ khác; cửa đổi trạng thái thì menu cập nhật; mục cũ → `TARGET_CHANGED`, không đổi gì.
- **"Lấy hết":** mở rồi chuyển hết; tủ đã trống thì mục khóa "Tủ trống".
- **Chết** đóng menu.
- **Case 3:** chuột phải zombie → COMBAT_STANCE có đích → chuột trái → ATTACKING → trúng đòn trừ máu → nhả thì hết đích.
- **Space:** đẩy qua làn combat.

**Browser `scripts/ax5-browser.mjs`** (Chrome GPU, chuột thật):
- menu tủ hiện cạnh con trỏ, không vào thế;
- Esc đóng menu (không pause);
- Mở qua menu;
- menu cửa bật/tắt cửa;
- chuột phải zombie: thế + vòng đỏ + vung;
- chuột phải đất: thế;
- 0 lỗi trang.

Ảnh: `ax5-container-menu`, `ax5-door-menu`, `ax5-zombie-target`.

**Script cũ đổi theo thay đổi đã duyệt (FB §1):**
- `cs1-combat-browser.mjs` và `ax4-browser.mjs` từng nhấn chuột phải khi con trỏ trên tủ để vào thế. Việc đó giờ mở menu, nên hai script vào thế khi con trỏ ở sàn bên cạnh.
- `ax5-browser.mjs` tự phát `zombie:spawned` cho zombie tạo bằng hàm test `spawnZombie`.

**Kiểm chứng:**
- `npm test` 1112 pass, 13 skip; soak trùng AX4 (shelter 1800 s / 2 kill / 20 dmg; patrol 804,9 s / 28 kill);
- tsc, oxlint, build, build:editor, check:bundle, map:check sạch;
- `ax5`, `ax4`, `ax3`, `cs1-combat`, `il-s2/s3/s4/s5` PASS.

## 4. Cần chủ dự án biết khi duyệt (D6)

- **Chuột phải trên object luôn là menu (ngoài thế), đúng FB §1.**
  - Hệ quả khi chơi: đang bị zombie áp sát mà con trỏ nằm trên tủ hoặc cửa thì chuột phải mở menu chứ không vào thế.
  - Cách thoát: bấm lại (đóng menu), hoặc để con trỏ trên zombie hay sàn.
  - Đây là ưu tiên Object > Character đã chốt. Nếu thấy vướng khi chơi thật, có thể thêm luật "có zombie trong X m thì chuột phải luôn là thế". Tôi chưa làm vì FB không yêu cầu.
- **Menu có thể mở ở xa**, nhưng chọn mục ngoài tầm sẽ báo "quá xa". Tự đi tới là AX6.
- **Còn lại theo kế hoạch:**
  - **AX6:** tự đi tới điểm đứng (NavWorld), trạng thái APPROACHING, hết giờ, bị chặn;
  - **AX7:** nghiệm thu tổng (bảng CAS §11, WIS §13, FB Case 1–7), sổ tay bàn giao.
