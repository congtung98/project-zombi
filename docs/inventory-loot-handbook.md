# Sổ tay Inventory & Loot (INV-LOOT, S0 → S6)

> Bàn giao cuối phase `docs/Phase_Inventory_Loot_Upgrade.md`. Nhánh `feature/inventory-loot`, ngày 2026-09-29.
> Ghi chú từng sprint: `docs/inventory-loot-s0.md` (audit và quyết định) … `s6.md`. Ảnh bàn giao: `docs/inventory-loot/final/`.

## 1. Trạng thái

- **Phase hoàn tất (S0–S6), chưa merge vào master (Q1).** Phạm vi bắt buộc của spec §2.1 đều đã triển khai và chạy trên dữ liệu game thật.
- **Người chơi làm được:**
  - lại gần tủ, mở Lục đồ, duyệt danh sách, xem tooltip;
  - chuyển một món, nhiều món (chọn, quét chuột, kéo thả, thả lên tab) hoặc Lấy hết, có thời gian và tiến trình;
  - hủy, hoặc bị ngắt khi di chuyển, bị đánh, chết;
  - dùng, trang bị, bỏ xuống đất, đeo balo;
  - save/load giữ nguyên kết quả.
- **Kiểm chứng cuối** (§7, §8):
  - `npm test` 1049 pass, 13 skip; soak 30 phút trùng từng số;
  - tsc, oxlint, build, build:editor, check:bundle, map:check sạch;
  - 7 kịch bản trình duyệt chuột thật PASS.

## 2. Điều khiển

| Thao tác | Kết quả |
|---|---|
| **I** | Mở/đóng Túi đồ (không pause game) |
| **E** ở tủ | Mở Lục đồ của tủ (kèm Túi đồ); E lần nữa thì đóng. E ở chỗ trống có đồ dưới đất thì mở tab Dưới đất |
| Click / Ctrl+click / Shift+click / Ctrl+A | Chọn một dòng / bật tắt từng dòng / chọn cả dải / chọn tất cả dòng đang hiện |
| **Giữ chuột trái, kéo lên/xuống** trong danh sách | Quét chọn cả dải (Ctrl để cộng thêm); tự cuộn ở mép |
| Quét rồi **kéo sang ngang** | Mang cả dải sang cửa sổ/tab khác trong cùng một thao tác |
| **Kéo** một dòng (hoặc một dòng trong vùng đang chọn) | Mang dòng đó (hoặc cả vùng chọn) đi; đích sáng lên khi thả được |
| Thả lên **tab** | Túi chính ↔ Balo đang đeo; Dưới đất ↔ từng tủ trong tầm; tab của chế độ gọn |
| **Shift + kéo** một stack / menu "Chọn số lượng…" | Hộp số lượng (1..tối đa, nút Tối đa, Enter đồng ý, Esc hủy) |
| Nhấp đúp / Enter | Lục đồ → túi đang chọn; Túi đồ → tủ đang mở (không bao giờ tự bỏ xuống đất) |
| Lấy hết | Lấy mọi món trong tủ, bỏ qua tìm kiếm và bộ lọc, trong giới hạn chỗ trống |
| Chuột phải trên dòng | Menu theo capability; mục bị khóa luôn có lý do |
| **Chuột phải trên thế giới** | Vào thế chiến đấu kể cả khi cửa sổ đang mở. Mọi cửa sổ thu gọn; chuột trái để đánh; rời thế thì cửa sổ đã ghim mở lại |
| Ghim | Cửa sổ ghim giữ mở. Cửa sổ không ghim thu gọn sau 1,5 s rời chuột, hoặc ngay khi bấm lên thế giới |
| **X** / nút Hủy / nút × trong hàng đợi | Hủy thao tác đang chạy và hàng đợi / bỏ một job |
| **Esc** | Mỗi lần một tầng: popup → hủy hàng đợi → cửa sổ trên cùng → rời thế → pause |
| WASD | Vẫn di chuyển khi cửa sổ mở; di chuyển thì hủy thao tác đang chạy |

## 3. Kiến trúc

**Nguồn dữ liệu duy nhất** là `GameRuntime` (`src/game/core/runtime.ts`). Mọi thay đổi quyền sở hữu hoặc số lượng đi qua command của runtime, gọi các hàm thuần trong `systems/inventory.ts`. UI chỉ gửi khóa inventory + instance ID + số lượng, và đọc snapshot. Không có bản sao state item nào sống riêng ở UI.

| Trách nhiệm (spec §9.1) | Nơi |
|---|---|
| Item registry | `entities/items.ts` (định nghĩa, khối lượng, `transfer`, `bag`, `unknown_item`) |
| InventoryService (sở hữu, stack/tách/gộp, chỗ trống, khối lượng) | `systems/inventory.ts`, `systems/bags.ts` (túi dùng được = túi chính + balo đang đeo) |
| Lệnh chuyển, luật trạng thái | `systems/inventoryCommands.ts` (khóa `main`/`worn`/`container:<id>`/`floor`, lý do từ chối), `runtime.transferItems` (lõi mutation) |
| TimedActionQueue | `systems/actionQueue.ts` (`ReservationLedger`, `transferStep`), `runtime.queueTransfer` / `stepQueue` / `cancelAction` / `cancelJob` |
| LootService | `systems/loot.ts`, `world/lootTables.ts` (sinh một lần lúc New Game), `runtime` phần tầm với (`refreshNearby` khoảng 8 Hz, tường, tầng) |
| Đồ dưới đất | `systems/floor.ts` (ô 1 m theo tầng, mỗi món giữ vị trí riêng) |
| Equipment | `systems/equipment.ts`, `runtime.equipItem` / `wearBag`; model: `rendering/PlayerView.tsx` (vũ khí, balo `character/backpackModel.ts`) |
| Save/migration | `systems/save.ts` (v1 → v11), `systems/saveStorage.ts` (IndexedDB, backup), `systems/recovery.ts` (item không xác định) |
| UI | `components/inventory/*`, `stores/inventoryStore.ts` (snapshot đồng bộ theo `inventory:changed`), `stores/inventoryUiStore.ts` (bố cục, vùng chọn, popup, kéo thả, thế chiến đấu), nhãn tập trung ở `labels.ts` |
| Input | `systems/input.ts`: nhấn chỉ tính trên canvas; nút nhấn trên UI không bao giờ thành cú nhấn vào thế giới (S6) |

## 4. Dữ liệu và save

- **Inventory:**
  - `{ id, kind, nextItemId, items, slotCapacity }`;
  - instance có `id` ổn định (`<inventory>:<n>`); phần tách ra nhận ID mới; chuyển nguyên món thì giữ ID;
  - stack chỉ gộp với cùng item và cùng cờ favorite;
  - vũ khí, balo, món lạ không bao giờ gộp.
- **Save:**
  - **v10** (S1): danh sách thay cho mảng ô; balo và `bags`; `lootPatches` (balo cho save cũ);
  - **v11** (S3): `floor` thay cho túi rơi;
  - save cũ v1…v9 đi qua migration, có backup trong cùng một transaction;
  - save mới hơn code bị từ chối.
- **Không bao giờ lưu:** hàng đợi, giữ chỗ, tiến trình. Save giữa batch chỉ chứa các bước đã commit.
- **Item không xác định** (S5):
  - giữ nguyên payload, không dùng được, ghi lại y nguyên khi save;
  - lúc load, nếu đang trang bị thì được tháo.
- **Fixture đóng băng:** `systems/fixtures/inv-loot-v9.json`, `inv-loot-v10.json`, cùng các fixture phase trước.
- **Bố cục cửa sổ, ghim, UI scale:** nằm ở `localStorage` (`zombie-outbreak.inventory-layout.v1`), không trong save.

## 5. Cấu hình cân bằng và hiệu năng

| Thông số | Giá trị | Ở đâu |
|---|---|---|
| Ô túi chính / tủ / balo | 12 / 8 / 8 | `GAME_CONFIG.inventory`, `ITEMS.backpack.bag` |
| Thời gian mỗi bước chuyển | clamp(0,2 + kg × 0,15; 0,2; 1,5) s mỗi đơn vị | `GAME_CONFIG.transfer` |
| Đồ nhỏ theo lô | đinh 10 / 0,3 s, băng gạc 3 / 0,25 s, băng keo 5 / 0,3 s | `ITEMS[*].transfer` |
| Khối lượng (kg) | nước 0,6 · đồ hộp 0,4 · snack 0,15 · nước ngọt 0,35 · băng gạc 0,05 · hộp cứu thương 1,0 · ván 2,0 · kim loại vụn 0,5 · băng keo 0,2 · đinh 0,01 · gậy 1,0 · ống sắt 1,5 · xà beng 2,0 · búa 0,7 · gậy tự chế 1,0 · balo 0,8 | `ITEMS` |
| Balo cho save cũ | 15 % ở tủ quần áo / tủ khóa chưa mở | `GAME_CONFIG.bonusLoot` |
| Tầm với tủ / đồ dưới đất | 1 m + bán kính tủ (+0,75 m cho tủ đang mở) / 1,6 m | `interaction.ts`, `runtime.ts` |
| Thu gọn cửa sổ không ghim | 1,5 s | `InvWindow.tsx` (`AUTO_COLLAPSE_MS`) |
| Quét chọn | lệch ngang 48 px thì chuyển sang mang đi; vùng ±24 px ngoài danh sách; cuộn ở 14 px sát mép | `ItemTable.tsx` |

Khối lượng chỉ để hiển thị và tính thời gian chuyển, không bao giờ là giới hạn mang (spec §2.3).

### Hiệu năng

- **Cách đo:**
  - `scripts/il-s6-browser.mjs`, chạy trên bản production `vite build --mode e2e` (bản build giống hệt, chỉ thêm `window.__runtime` cho script);
  - Chrome GPU, 1920×1080, ban ngày, không zombie;
  - DevTools Performance metrics (thời gian task của main thread mỗi frame), đo xen kẽ cửa sổ đóng/mở, lấy trung vị; cộng thêm sampling profiler.

| Kịch bản | Kết quả |
|---|---|
| Cửa sổ mở, tủ 500 món (danh sách ảo) | +0,15 / +0,54 / −0,19 ms/frame ở 3 lần chạy (trong nhiễu đo) |
| 100 lần chuyển liên tiếp, cửa sổ mở so với đóng | +0,3 / +1,2 / +1,8 ms/frame |
| JS riêng của UI khi đang chuyển (profiler: React + store) | khoảng 30–45 ms mỗi 3 s, tức **0,1–0,2 ms/frame** |
| Frame (vsync 144–165 Hz) | trung vị 6,1–7,0 ms ở mọi kịch bản |
| Rò rỉ sau 10 vòng mở / quét-kéo / menu / tooltip / thế chiến đấu / đóng | listener window 26 → 26, document 3 → 3, subscription runtime 141 → 141, 0 job, sổ giữ chỗ rỗng |

- **Độ nhiễu:** trên máy này, tổng thời gian task mỗi frame dao động 2–3 ms giữa các lần đo giống hệt nhau (pass WebGL phải chờ GPU). Vì vậy script chỉ chặn hồi quy ở mức 3 ms; mục tiêu 2 ms của spec được đánh giá theo phần JS của UI.
- **Sửa ở S6:**
  - thanh tiến trình và thanh chỉ số HUD trước đây animate `width`, tốn 5–6 ms/frame khi đang chuyển đồ và ép layout mỗi frame cả khi chơi bình thường; nay dùng `transform`, layout mỗi frame giảm từ ~0,3 xuống ~0,01 ms;
  - dòng bảng không render lại khi nội dung không đổi.

## 6. Ma trận kiểm thử (spec §14)

"Unit" là vitest (`npm test`); "Trình duyệt" là script Playwright chuột thật (`scripts/`).

| ID | Bằng chứng |
|---|---|
| T01 | Unit `inventory.test.ts` "T01: 3 of a stack of 10 nails"; `actionQueue.test.ts` "T01 through the queue" |
| T02 | Unit `inventory.test.ts` "T02" |
| T03 | Unit `inventory.test.ts` "T03" |
| T04 | Unit `inventory.test.ts` "T04" |
| T05 | Unit `inventoryUi.test.ts` "a group of 4 is 4 IDs", thêm trường hợp quét chọn (S5) |
| T06 | Unit `actionQueue.test.ts` "T06"; trình duyệt `il-s4` bước 2 (nhấp đúp 4 lần) |
| T07 | Unit `actionQueue.test.ts` "T07" |
| T08 | Unit `floor.test.ts` "T08" (tường), hủy job khi tủ ra ngoài tầm (`actionQueue.test.ts`); trình duyệt `il-s3` (Ngoài tầm) |
| T09 | Unit `actionQueue.test.ts` "T09"; trình duyệt `il-s4` bước 5 |
| T10 | Unit `actionQueue.test.ts` "T10" |
| T11 | Unit `actionQueue.test.ts` "T11" |
| T12 | Unit `inventoryMatrix.test.ts` "T12" (S6); `inventoryCommands.test.ts` |
| T13 | Unit `floor.test.ts`, `inventoryV10.test.ts` "T13"; trình duyệt `il-s3` (vòng đời balo qua save) |
| T14 | Unit `inventory.test.ts` "T14" |
| T15 | Unit `inventoryV10.test.ts` (T15) |
| T16 | Unit `inventoryV10.test.ts` "loot is rolled once (T15, T16)" |
| T17 | Unit `floor.test.ts` (T17: reload hai lần, một bộ dữ liệu) |
| T18 | Unit `actionQueue.test.ts` "T18"; trình duyệt `il-s4` bước 10 |
| T19 | Unit `recovery.test.ts` "T19" và migration v9; trình duyệt `il-s5` bước 8 (IndexedDB thật) |
| T20 | Unit `inventoryV10.test.ts` "is idempotent", `recovery.test.ts` (load lặp) |
| T21 | Unit `saveFailure.test.ts` (S5) |
| T22 | Unit `worldReset.test.ts` (S5), `inventoryUi.test.ts` (`resetSession`) |
| T23 | Trình duyệt `il-s2` bước 6, `il-s6` bước 3 (kéo xuyên thế giới, S6); unit `input.test.ts` |
| T24 | Trình duyệt `il-s2` (đồng hồ chạy, ánh sáng giữ nguyên khi mở cửa sổ) |
| T25 | Trình duyệt `il-s2` bước 10 (1366×768 ở 100/125/150 %), `il-s6` (ảnh 1366 @150 % và chế độ gọn) |
| T26 | Unit `actionQueue.test.ts` "T26"; trình duyệt `il-s6` bước 9 (100 lần chuyển) và 10 (rò rỉ) |
| T27 | Unit `inventoryMatrix.test.ts` "T27" (S6) |
| T28 | Trình duyệt `il-s4` bước 9 (pause thật đứng tiến trình); unit không phụ thuộc FPS (`actionQueue.test.ts`) |
| T29 | Unit `inventoryMatrix.test.ts` "T29" (chết vì đòn đánh và vì đói, S6); `runtime.test.ts` (chết thì đóng cửa sổ). Việc "tủ bị xóa" không xảy ra trong lúc chơi (tủ cố định theo map); migration nội dung chuyển đồ của tủ bị bỏ ra đất (S3) |
| T30 | Unit `inventoryMatrix.test.ts` "T30" (S6) |

## 7. Chạy kiểm tra

```bash
npm test && npx oxlint && npm run build && npm run build:editor && npm run check:bundle && npm run map:check
# Trình duyệt (Chrome GPU; PLAYWRIGHT_MODULE trỏ tới playwright/index.mjs nếu repo chưa cài playwright):
npx vite --port 5199 &
GPU=1 BASE_URL=http://localhost:5199 node scripts/il-s2-browser.mjs   # il-s3, il-s4, il-s5 tương tự
CHROMIUM_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" GPU=1 BASE_URL=http://localhost:5199 node scripts/cs1-combat-browser.mjs
# Hiệu năng trên bản production:
npx vite build --mode e2e --outDir node_modules/.tmp/dist-e2e && npx vite preview --outDir node_modules/.tmp/dist-e2e --port 5198 &
GPU=1 BASE_URL=http://localhost:5198 node scripts/il-s6-browser.mjs      # PROFILE=1 để xem thời gian theo hàm
```

## 8. Definition of Done (spec §16)

- [x] **Dữ liệu thật:** mọi thao tác bắt buộc chạy trên dữ liệu game thật.
- [x] **Một nguồn state, một đường mutation:** `GameRuntime` + `queueTransfer` / `transferItems`.
- [x] **Giao diện:** Inventory/Loot kiểu PZ, dùng tốt ở 1920×1080, 1366×768 và scale 100–150 %.
- [x] **Nhất quán:** slot, stack, độ bền, trang bị, balo, đồ dưới đất.
- [x] **Tầm với:** không loot xuyên tường, ngoài tầm hay từ tủ không còn.
- [x] **Không mất/nhân đồ:** trong các ca chuyển, ngắt, migration, save/load đã kiểm thử (soak kiểm tra toàn vẹn mỗi giây).
- [x] **Không đổi ánh sáng/vision/pause ngoài yêu cầu:** mở cửa sổ không pause, không tối màn hình.
- [x] **Save cũ:** có migration, backup và phục hồi item lạ.
- [x] **Build/lint/test sạch.**
- [x] **Bàn giao đủ:** ảnh gameplay (`final/`), hướng dẫn điều khiển (§2), config cân bằng (§5).
- [x] **Danh sách file, module chịu trách nhiệm, giới hạn:** §3, §10, ghi chú từng sprint.
- [x] **Không còn mock, TODO hay action giả trong luồng bắt buộc:** menu chỉ có hành động có thật; mục bị khóa luôn có lý do.

## 9. Quyết định của chủ dự án

- **D1–D6, Q1–Q4:** xem `inventory-loot-s0.md` §0.
- **S4 và S5:** các đề xuất giữ như gợi ý (chủ dự án duyệt ngày 2026-09-29, "hoàn thiện theo đề xuất"):
  - thông số thời gian chuyển;
  - mốc soak mới (shelter 14 kill / 110 dmg; patrol 1379 s / 38 kill);
  - Esc hủy cả hàng đợi;
  - tóm tắt đếm theo dòng;
  - cửa sổ ghim tự mở lại sau thế chiến đấu;
  - trễ 1,5 s;
  - luật cử chỉ quét;
  - món lạ không vào balo và được tháo khi load.

## 10. Giới hạn và việc sau này

- **Quét chọn rồi kéo thẳng lên tab phía trên:** vùng quét co lại theo con trỏ (giống Explorer). Muốn thả lên tab phía trên thì làm hai thao tác: quét, thả tay, rồi kéo cụm.
- **Màn hình rất nhỏ** (1024×640 @150 %, tức khoảng 680×430 px UI): chế độ gọn một cửa sổ che phần lớn khung nhìn và nhân vật. Người chơi thu gọn hoặc kéo cửa sổ đi được. Ở 1366×768 @150 % hai cửa sổ vẫn chừa nhân vật.
- **Phạm vi chưa có:** không có hotbar, tab xác zombie (D3), giới hạn khối lượng, balo lồng balo hay loot respawn (ngoài phạm vi phase).
- **Icon:** là SVG tự vẽ (D2); danh sách thay bằng asset thật sau này là toàn bộ `ItemIcon.tsx`.
- **Số đo hiệu năng** chỉ trên một máy (mục 5); chưa có số của máy yếu.
- **Chưa playtest tay** thông số thời gian chuyển; chúng là giá trị khởi điểm trong config.

## 11. Ảnh bàn giao (`docs/inventory-loot/final/`, từ game đang chạy)

- `inventory-loot-default`: hai cửa sổ, ban ngày, tủ bếp.
- `inventory-tooltip-menu`: tooltip vũ khí có độ bền 55/80 và menu theo capability (mục bị khóa có lý do).
- `inventory-transfer-progress`: Lấy hết đang chạy, tiến trình, nhãn "Đang dùng" / "Chờ chuyển", nút Hủy.
- `inventory-full-partial`: túi đầy, nước vẫn gộp vào stack còn chỗ, tóm tắt "Đã chuyển 3 · 3 món không chuyển: Hết chỗ".
- `inventory-backpack-floor`: tab Balo đang đeo (ô, khối lượng) và tab Dưới đất.
- `inventory-compact-layout`: 1024×640 @150 %, một cửa sổ có tab. Kèm `inventory-1366-150`.
- `inventory-icons`: mọi icon item (cuộn băng keo vẽ lại ở S6).
- Thêm từ S5: `docs/inventory-loot/s5/` (quét chọn, thả lên tab, thế chiến đấu, balo trên lưng, item lạ).
