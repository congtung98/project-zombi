# INV-LOOT S2 — UI hai cửa sổ Inventory / Loot

> Phase: `docs/Phase_Inventory_Loot_Upgrade.md`. Audit và quyết định: `docs/inventory-loot-s0.md`. S1: `docs/inventory-loot-s1.md`.
> Nhánh `feature/inventory-loot`. Ngày 2026-09-28. S2 không phải mốc dừng (Q1: dừng sau S1 và S4).

## 1. Kết quả

### Cửa sổ

Có ba cửa sổ độc lập: **Túi đồ**, **Lục đồ** (tủ đang mở) và **Chế tạo**. Mở game hay mở cửa sổ đều không pause, không làm tối màn hình, không đổi ánh sáng.

- `InvWindow.tsx`:
  - kéo bằng thanh tiêu đề, đổi cỡ ở góc;
  - ghim, thu gọn còn thanh tiêu đề, đóng;
  - cửa sổ không ghim tự thu gọn 350 ms sau khi con trỏ rời, trừ khi có popup hoặc focus trong nội dung;
  - mặc định ghim;
  - vị trí được clamp để luôn kéo lại được (giữ 96 px của thanh tiêu đề trên màn hình).
- Bố cục (`layout.ts`, thuần, có test):
  - ở 1920×1080: Túi đồ 480×360 ở trên trái; Lục đồ ở trên phải, dưới đồng hồ; Chế tạo dưới Túi đồ;
  - vùng an toàn đo từ phần tử HUD thật (`.hud-clock`, `.hud-stats`, thanh gợi ý), không hard-code;
  - cao tối đa 75 % màn hình;
  - hẹp hơn hai cửa sổ thì chuyển sang **một cửa sổ có tab Túi đồ / Lục đồ**, nằm giữa đồng hồ và khung chỉ số.
- Bố cục, ghim và thu gọn được lưu ở localStorage `zombie-outbreak.inventory-layout.v1` (preferences, không vào save game). Dữ liệu hỏng thì dùng mặc định.
- **Cài đặt:** "Cỡ cửa sổ túi đồ" 100/125/150 % (chỉ scale lớp cửa sổ) và nút **Đặt lại bố cục**.
- Chế tạo mở bằng nút trên thanh tiêu đề Túi đồ và chỉ hiện khi Túi đồ đang mở (chế tạo dùng đồ đang mang).

### Bảng

`ItemTable.tsx` + `rows.ts` + `selection.ts` + `tableData.ts`:

- **Dòng:** icon SVG, tên, trạng thái (Đang cầm / Đang đeo / ★ / Đang dùng / Hỏng), thanh độ bền có số, loại, số lượng, kg của cả dòng.
- **Sort và lọc:**
  - sort theo Tên / Loại / SL / Kg, ổn định (instance ID làm tie-breaker);
  - lọc theo loại; tìm không phân biệt dấu ("nuoc" tìm ra "Nước").
- **Nhóm hiển thị:** món không stack cùng loại (≥ 2) gom thành nhóm mở được. Không gộp dữ liệu; mỗi món giữ trạng thái riêng. Stack thật không bao giờ bị gom.
- **Chọn:**
  - click, Ctrl/Cmd+click, Shift+click (theo dòng đang thấy), Ctrl+A (chỉ trong bảng);
  - chọn theo row ID, không theo chỉ số;
  - nhóm được chọn tương ứng với toàn bộ instance của nó (T05);
  - món biến mất thì tự rời khỏi lựa chọn.
- **Bàn phím:** ↑ ↓ Home End để di chuyển (Shift để chọn dải), Enter để thực hiện hành động mặc định, phím Menu hoặc Shift+F10 để mở menu. `data-ui-keys` giữ các phím này cho UI; WASD vẫn điều khiển nhân vật.
- **Ảo hoá:** trên 80 dòng thì chỉ render dòng đang thấy. Lý do nằm ở số đo §2.

### Popup

`Popups.tsx`, `ItemCard.tsx`, `itemActions.ts`:

- **Tooltip** (trễ 300 ms):
  - icon lớn, tên, loại, khối lượng (kèm mỗi cái);
  - vũ khí: độ bền + mức, sát thương thật theo độ bền, tầm/hồi/thể lực;
  - vật liệu sửa (lấy từ recipe thật), sức chứa balo, tác dụng, mô tả;
  - nhóm thì liệt kê từng món với độ bền riêng.
- **Menu chuột phải theo capability:**
  - Trang bị / Bỏ trang bị, Đeo / Tháo balo;
  - Ăn / Uống / Dùng (chỉ đồ đang mang), Sửa;
  - Lấy vào… / Cất vào… / Chuyển vào…, Bỏ xuống đất;
  - Đánh dấu / Bỏ yêu thích, Xem chi tiết.
- **Lý do khi bị khóa:** mục bị khóa luôn ghi lý do, ví dụ "Đang trang bị — tháo ra trước", "Món yêu thích — bỏ yêu thích trước", "Lấy vào túi trước", "Chỉ số đã đầy", "thiếu nguyên liệu", "Không để túi trong túi". Chọn nhiều món thì mục chuyển ghi số món đi được (1/2).
- Popup nằm ở lớp riêng phía trên mọi cửa sổ, được clamp trong viewport, đóng khi bấm ra ngoài và tự đóng khi món không còn.

### Lệnh

- **Một đường lệnh duy nhất:** `runtime.transferItems(source, destination, lines)` theo khóa `main | worn | container:<id>` và instance ID.
  - luật: chết, đang ra đòn, ngoài tầm, cùng chỗ, món mất, **đồ đang trang bị không bao giờ đi**, **Favorite không rời đồ đang mang**, món đang được giữ chỗ, rồi mới tới sức chứa;
  - mỗi lần gọi phát **một** sự kiện tóm tắt `inventory:transferred`; UI hiện toast một lần khi có món không chuyển được hoặc chuyển nhiều dòng.
  - `takeFromContainer`, `putIntoContainer`, `takeAll` chỉ còn là lớp bọc gọi vào nó.
- **Các lệnh khác:**
  - `setFavorite`;
  - `dropItem` chặn đồ đang trang bị, Favorite và đồ đang giữ chỗ.
- **Cửa sổ độc lập:** phím I chỉ bật/tắt Túi đồ; E ở tủ mở Lục đồ (và Túi đồ); đóng Lục đồ không đóng Túi đồ.
- **Nhấp đúp / Enter:**
  - ở Lục đồ: lấy vào inventory đang chọn bên Túi đồ (túi chính hoặc balo đang đeo);
  - ở Túi đồ: cất vào tủ đang mở; không có tủ thì không làm gì (không tự bỏ xuống đất).
- **Nút:** **Lấy hết** lấy cả tủ, bỏ qua tìm kiếm và bộ lọc (tooltip ghi rõ); thêm **Lấy đã chọn**, **Cất đã chọn**, **Bỏ xuống**.
- **Esc, mỗi lần một tầng** (`escape.ts`): popup → hủy thao tác đang chạy → cửa sổ đang focus (hoặc trên cùng) → rời thế chiến đấu → pause. Esc trong ô tìm kiếm xoá chữ rồi thoát ô.
- **Thanh thao tác trong Túi đồ:** hiện thao tác đang chạy với tiến trình và nút Hủy. Thanh `hud-work` của HUD ẩn khi Túi đồ đang mở.
- **Nhãn và icon:**
  - mọi nhãn ở `labels.ts` (tiếng Việt);
  - 16 icon SVG tự vẽ ở `ItemIcon.tsx`, rõ hình ở 20–24 px; món lạ dùng icon dấu hỏi thống nhất.

## 2. Kiểm chứng (đã chạy thật)

| Cổng | Kết quả |
|---|---|
| `npm test` | **1003 pass**, 13 skip (sau S1: 984). Thêm test runtime cho lệnh chuyển đồ và test logic UI (dòng, chọn, bố cục, menu theo capability) |
| Soak | **Trùng từng số** với trước S1/S2: shelter 1800 s / 3 kill / 30 dmg / 26 món; patrol 646,75 s / 26 kill |
| `tsc -b`, `oxlint` | Sạch |
| `vite build`, `build:editor`, `check:bundle` | OK |
| Trình duyệt `scripts/il-s2-browser.mjs` (dev, **Chrome GPU D3D11**, 1920×1080 → 1366×768 → 1024×640) | **PASS**, console sạch |

**Nội dung script trình duyệt** (theo thứ tự):

1. **Bố cục mặc định 1920×1080** với tủ bếp: 480×360 ở (16,16); Lục đồ ở (1424,108), dưới đồng hồ; không có lớp tối. Đồng hồ game vẫn chạy khi cửa sổ mở (T24).
2. **Lấy đồ:** nhấp đúp lấy một món; Ctrl+click hai món rồi **Lấy đã chọn**.
3. **Lấy hết khi đang lọc:** gõ tìm "zzz" (bảng trống), **Lấy hết** vẫn lấy cả tủ.
4. **Tooltip vũ khí:** "Độ bền 43/80 · Tốt", sát thương, vật liệu sửa.
5. **Menu:**
   - **Trang bị** thì dòng có nhãn "Đang cầm";
   - menu của vũ khí đang cầm có "Cất vào Tủ bếp" và "Bỏ xuống đất" bị khóa với lý do;
   - Esc chỉ đóng menu;
   - **Ăn** qua menu: đói 20 → 55, số lượng giảm 1.
6. **Sort và tìm:** sort Kg tăng dần đúng thứ tự; tìm "GAY" chỉ ra gậy.
7. **Bàn phím trong bảng:** ↑ ↓ End Home Ctrl+A không làm nhân vật di chuyển; Ctrl+A chọn đủ số dòng.
8. **T23:**
   - nhấn chuột trái/phải trên dòng không thành đòn hay thế chiến đấu;
   - lăn chuột trên bảng không zoom (28 → 28);
   - kéo cửa sổ 200/100 px: cửa sổ đi đúng, nhân vật không đi, không có đòn.
9. **Đổi cỡ, thu gọn, ghim:**
   - đổi cỡ +100/+50 và được lưu vào localStorage;
   - thu gọn còn thanh tiêu đề rồi mở lại;
   - bỏ ghim thì cửa sổ tự thu gọn sau khi con trỏ rời, và mở lại khi rê vào thanh tiêu đề.
10. **Cửa sổ Chế tạo** mở từ thanh tiêu đề.
11. **Esc từng tầng:** thao tác sửa đang chạy → Chế tạo → Lục đồ (Túi đồ còn) → Túi đồ → menu tạm dừng.
12. **1366×768 ở 100/125/150 %:** hai cửa sổ nằm trong màn hình, cạnh nhau, không có scroll ngang trang.
13. **1024×640 @150 %:** một cửa sổ có tab Túi đồ / Lục đồ; Lấy hết vẫn chạy.
14. **Frame time**, cùng cảnh, cùng máy (Chrome GPU D3D11, 1920×1080, thị trấn mặc định). Đơn vị ms, median / p95:

    | Trường hợp | Median | p95 |
    |---|---|---|
    | Cửa sổ đóng | 26,7 | 40,3 |
    | Mở Túi đồ + Lục đồ với **tủ 500+ món** | 26,7 | 40,3 |
    | Đang cuộn bảng 500 món | 26,7 | 40,3 |

    Không đo được khác biệt ở frame time. Thời gian **click sort → vẽ xong** với 500+ dòng: **167 ms trước khi ảo hoá, ~60 ms sau** (gồm hai frame khoảng 27 ms, tức công việc thực vài ms). Máy chạy khoảng 37 FPS do world thị trấn, không phải do UI.

**Lưu ý môi trường:** SwiftShader headless (dùng ở các sprint trước) chạy world thị trấn dưới 1 frame/giây, kể cả khi đóng cửa sổ. Đây cũng là lý do `p2-s4-browser.mjs` hỏng từ trước. S2 kiểm tra bằng Chrome có GPU (`GPU=1`).

Ảnh: `docs/inventory-loot/s2/` gồm:
- `inventory-loot-default`, `inventory-tooltip`, `inventory-menu-equipped`, `inventory-action-strip`;
- `inventory-1366-100`, `inventory-1366-125`, `inventory-1366-150`;
- `inventory-compact-layout`.

## 3. Lệch so với kế hoạch và phần chưa làm

- **Chuyển đồ vẫn tức thời** (adapter vào đúng `transferItems`). Hàng đợi có thời gian, tiến trình từng món, kéo thả giữa cửa sổ, hộp chọn số lượng (Shift+kéo) và summary theo batch làm ở **S4**.
- **Chặn chuyển/bỏ đồ đang trang bị và Favorite làm luôn ở S2** (S1 ghi là S4), vì menu mới cần hiển thị lý do. Thay đổi trải nghiệm: cất vũ khí đang cầm giờ phải "Bỏ trang bị" trước (mục này nằm đầu menu).
- **Đi xa, tủ vẫn tự đóng như cũ.** Trạng thái "Ngoài tầm" (giữ cửa sổ nhưng khóa thao tác), tab Floor và các tủ lân cận làm ở **S3**. Nhãn "Trong tầm" hiện tại luôn đúng vì tủ ngoài tầm đã tự đóng.
- **Tooltip ẩn khi menu mở**, nên không có một ảnh chụp chứa cả hai. Ảnh bàn giao S6 sẽ chụp riêng tooltip và menu, hoặc cho phép hiện cùng lúc nếu cần.
- **Chế tạo vẫn chỉ đọc túi chính.** Đọc cả balo đang đeo và sổ reservation chung làm ở S4.
- **Script cũ:** `p2-s4-browser.mjs` và các script `p2-*` khác dựa trên SwiftShader và UI lưới ô cũ, chưa cập nhật cho UI mới.

## 4. File

- **Mới:**
  - `src/components/inventory/`: `InventoryOverlay`, `InvWindow`, `Panels`, `ItemTable`, `ItemCard`, `Popups`, `ItemIcon`, `labels`, `rows`, `selection`, `layout`, `itemActions`, `commands`, `escape`, `tableData`, `inventoryUi.test`;
  - `src/game/systems/inventoryCommands.ts` (+ test);
  - `src/stores/inventoryUiStore.ts`;
  - `scripts/il-s2-browser.mjs`.
- **Sửa:**
  - `core/runtime.ts` (`transferItems`, `inventoryFor`, `setFavorite`, cửa sổ độc lập, drop có luật), `core/events.ts`;
  - `stores/inventoryStore.ts` (view theo khóa, chia sẻ object không đổi), `stores/settingsStore.ts` (`uiScale`);
  - `app/App.tsx` (Esc, toast tóm tắt);
  - `components/HUD.tsx`, `Settings.tsx` (scale, đặt lại bố cục, hướng dẫn), `CraftingPanel.tsx` (`CraftingList`);
  - `systems/input.ts` (`data-ui-keys`);
  - `index.css` (bỏ CSS lưới ô, thêm phần INV-LOOT theo token spec);
  - `phase2-save.test.ts` (cất vũ khí đang cầm giờ bị chặn).
- **Bỏ:** `components/Inventory.tsx`, `components/ContainerPanel.tsx`.
