# INV-LOOT S1 — Domain model, save v10, balo cho save cũ

> Phase: `docs/Phase_Inventory_Loot_Upgrade.md`. Audit và các quyết định: `docs/inventory-loot-s0.md`.
> Nhánh `feature/inventory-loot`. Ngày 2026-09-28. **Mốc dừng chờ duyệt** (Q1): dữ liệu và migration.

## 1. Kết quả

- **Inventory là danh sách instance** (`src/game/systems/inventory.ts`):
  - `{ id, kind, nextItemId, items, slotCapacity }`, với `kind` là `player | container | drop | bag`;
  - giới hạn slot giữ nguyên: túi chính 12, container 8, túi rơi 1;
  - mọi thao tác dùng instance ID, không dùng chỉ số ô: `findItem`, `addItem`, `removeQuantity`, `removeItem`, `roomFor`, `previewTransfer`, `transferItem`, `transferAll`;
  - `slotView` vẽ lưới ô cho UI cũ.
- **Quy tắc stack:**
  - chỉ gộp khi cùng item, cùng là stack và cùng cờ favorite;
  - vũ khí, dụng cụ và balo không bao giờ gộp;
  - tách stack thì phần mới có ID mới; chuyển trọn instance thì giữ ID.
- **Quá tải:** dữ liệu vượt số ô được giữ nguyên. Không thao tác nào thêm ô khi đang quá tải, nhưng vẫn gộp được vào stack còn chỗ.
- **Item** (`entities/items.ts`):
  - `weightKg` cho mọi item;
  - `transfer` (lô cho đồ nhỏ: đinh 10/0,3 s, băng gạc 3/0,25 s, băng keo 5/0,3 s), dùng từ S4;
  - item mới `backpack` (8 ô, 0,8 kg);
  - `favorite?` trên instance;
  - `Equipment.backInstanceId` (slot Back).
- **Balo** (`systems/bags.ts`):
  - nội dung balo nằm ở `WorldState.bags`, khóa theo ID instance balo; balo ở đâu thì nội dung đi theo, không sao chép;
  - không có balo trong balo;
  - khối lượng tính mỗi instance đúng một lần;
  - `usableInventories` là hàm duy nhất xác định phạm vi dùng đồ (Q2): túi chính rồi balo đang đeo. Ăn/uống trên một món dùng đúng instance được chọn, kể cả trong balo đang đeo.
- **Save v10** (`types/save.ts`, `systems/save.ts`):
  - v9 → v10 đổi hình dạng inventory: cùng instance, cùng thứ tự, số ô cũ thành `slotCapacity`; không đổi ID, số lượng, độ bền hay vũ khí đang cầm;
  - thêm `bags` và `lootPatches`;
  - các bước migration v1–v9 giữ nguyên logic, chạy trên kiểu `LegacyInventory`;
  - migration nội dung (M8) chạy được với cả hai hình dạng.
- **Bản vá balo cho save cũ** (`patchLoot`, luật `GAME_CONFIG.bonusLoot` `backpack-v1`), đáp ứng 4 điều kiện ở §0.3 và §6 của audit:
  1. Chỉ xét container của map có cờ `opened === false`. Cờ này được lưu từ khi game có save và chỉ bật khi người chơi mở tủ bằng E.
  2. Chỉ bảng `house-wardrobe` và `locker`, chỉ vào ô trống; không xóa, thay hay gộp đồ.
  3. Dùng luồng seed riêng `inv-loot/backpack-v1:<container>`. Tủ chưa mở nhận đúng thứ ván mới cùng seed có. ID balo tất định (`<inventory>:backpack-v1`). Dấu `lootPatches` được ghi kể cả khi không thêm gì.
  4. Không có tủ hợp lệ thì giữ nguyên đồ và thông báo; không tặng đồ.
- **Ván mới:**
  - balo ra từ cùng luồng seed phụ, nên loot bảng cũ không đổi từng món;
  - load **không** gọi generator nữa (trước đây `loadSnapshot` sinh loot cho mọi container rồi ghi đè);
  - constructor runtime không sinh một world loot thừa.
- **Backup:** bản vá loot trên save v10 (không đổi schema, không đổi nội dung) có key backup riêng `…backup-v10-loot-patch`.
- **Thông báo sau migration** nêu: túi đồ chuyển sang danh sách, số balo đã thêm, hoặc lý do không thêm.
- **UI cũ vẫn dùng được:**
  - lưới ô vẽ từ danh sách; thao tác theo ID;
  - header hiện "đã dùng/12 · x kg";
  - chuột phải lên balo để đeo/tháo, có nhãn E; nút "Đeo balo/Tháo balo" trong thẻ chi tiết.

## 2. Kiểm chứng (đã chạy thật)

| Cổng | Kết quả |
|---|---|
| `npm test` (vitest) | **984 pass**, 13 skip. Trước S1: 941 pass, 13 skip. Thêm 43 test |
| Soak (`src/game/core/soak.test.ts`) | **Trùng từng số với mốc trước S1**: shelter 1800 s / 3 kill / 30 dmg / lấy 26 món / cùng túi cuối; patrol 646,75 s / 26 kill / 230 dmg |
| `tsc -b`, `oxlint` | Sạch |
| `vite build`, `build:editor`, `check:bundle`, `map:check` | OK |
| Trình duyệt `scripts/il-s1-browser.mjs` (dev, SwiftShader, 1366×768) | **PASS**, console sạch (lần đầu trên server Vite mới có 4 lỗi `504 Outdated Optimize Dep` của Vite, lần chạy lại sạch) |

**Bằng chứng S1 mà chủ dự án yêu cầu** (save cũ giữ nguyên tổng đồ, độ bền và trang bị): `src/game/systems/inventoryV10.test.ts`.

- **Fixture v9 thật** `fixtures/inv-loot-v9.json`, ghi bằng code `master` (133e8c4) **trước khi sửa**, seed 20260928. Save có:
  - ô trống giữa túi chính;
  - gậy mòn (37) đang cầm;
  - tủ đã mở còn đồ, có ô trống giữa;
  - tủ đầu giường đã mở có đồ người chơi cất vào;
  - túi đồ rơi;
  - tủ quần áo chưa mở còn chỗ.
- **Kết quả v9 → v10:**
  - mọi instance ở đúng chủ cũ, đúng thứ tự, cùng ID, số lượng và độ bền;
  - tổng từng loại item không đổi;
  - vũ khí đang cầm giữ nguyên; `backInstanceId: null`;
  - mọi trường ngoài inventory (đồng hồ, zombie, cửa, ánh sáng, chỉ số) giống hệt;
  - thay đổi duy nhất là 1 balo trong tủ quần áo chưa mở, giống hệt ván mới cùng seed.
- **Chạy lặp:** migration cho cùng kết quả; save đã là v10 thì không migrate lại; round-trip qua runtime khớp hoàn toàn.
- **Fixture v1–v7 (đóng băng):**
  - v2–v7: mọi instance vẫn ở đúng chủ với cùng ID, số lượng và độ bền; vũ khí đang cầm giữ nguyên;
  - v1: mọi stack giữ nguyên cộng đúng một gậy được cấp như trước.
- **4 điều kiện của bản vá:**
  - tủ đã mở nhưng còn đồ thì không nhận balo;
  - tủ hợp lệ nhưng đầy thì không nhận gì và không mất gì;
  - chạy lại bản vá không thêm balo thứ hai;
  - không có tủ hợp lệ thì vẫn ghi dấu và giữ nguyên đồ;
  - ở mọi fixture cũ, balo chỉ xuất hiện ở tủ chưa mở, phù hợp, trúng roll và còn chỗ.
- **Validator v10 từ chối:**
  - bản ghi balo thừa hoặc thiếu;
  - balo trong balo;
  - balo đang đeo nhưng không nằm trong túi chính;
  - `lootPatches` trùng;
  - `kind` sai; capacity 0;
  - favorite không phải `true`, hoặc favorite trong save cũ.

  Container quá tải được giữ nguyên, không bị cắt.
- **T15 / T16** (kiểm tra thật, không coi là đạt sẵn):
  - New Game gọi generator đúng 1 lần mỗi container; constructor không sinh world thừa;
  - mở/đóng container, save/load: 0 lần;
  - container đã lục vẫn rỗng sau load;
  - migrate v9 gọi 0 lần; migrate v2 chỉ gọi cho các container v3/v5 thêm vào.
- **Balo trong runtime:**
  - balo đang đeo dùng được đồ bên trong, balo chỉ mang theo thì không;
  - T13 (mức dữ liệu): thả balo có đồ → save/load → nhặt lại thì nội dung và khối lượng giữ nguyên, tính một lần.
- **Invariant chuyển đồ:**
  - T01–T04, T14;
  - quá tải; favorite không gộp;
  - 20 seed × 100 lần chuyển ngẫu nhiên giữa 4 inventory (có Floor không giới hạn): tổng mỗi loại không đổi, không trùng ID, không vượt giới hạn stack/ô, `previewTransfer` luôn khớp `transferItem`.

**Trình duyệt `il-s1-browser.mjs`:**

- **New Game trên thị trấn:**
  - click ô tủ để lấy đồ; header "2/12 · 1.1 kg";
  - chuột phải trang bị vũ khí.
- **Save:** ra v10 (`kind`, `slotCapacity` 12, `lootPatches`, `bags` khớp số balo); Continue trả đúng túi và vũ khí.
- **Nạp fixture v9 thật vào IndexedDB rồi Continue:**
  - migration nội dung v1 → v2 (khu 50 m thành thị trấn), rồi v9 → v10;
  - backup `slot-1.backup-v9` giống hệt bản gốc;
  - túi, gậy (37) và mọi container cũ giữ nguyên;
  - balo được thêm vào 61 tủ phù hợp chưa mở, gồm tủ quần áo của fixture và các tủ thị trấn mà migration nội dung mới gieo.
  - Toast: "…Túi đồ chuyển sang dạng danh sách: giữ nguyên mọi món, độ bền và vũ khí đang cầm. Đã thêm 61 balo vào tủ phù hợp bạn chưa từng mở (đồ có sẵn giữ nguyên)."
- **Balo:** lấy balo từ tủ quần áo, chuột phải để đeo, save thì `backInstanceId` và bản ghi `bag:<id>` 8 ô được lưu.
- **Ảnh:** `docs/inventory-loot/s1/`.

## 3. Lệch so với kế hoạch và phần chưa làm

- **Floor chuyển sang S3** (schema v11). v10 vẫn giữ túi rơi 1 ô `drop:<id>` như trước. Làm Floor cùng S3 (cùng UI Floor, tầm với từng món) gọn hơn nhét dữ liệu Floor vào S1 mà chưa có ai dùng.
- **Chế tạo/sửa vẫn chỉ đọc túi chính.** Đọc cả balo đang đeo, reservation theo instance và sổ reservation chung làm ở **S4**, cùng regression test tranh chấp nguyên liệu.
- **Cất/bỏ đồ đang trang bị vẫn tự tháo như cũ.** Luật chặn "tháo ra trước" làm ở S4 cùng luật transfer. Balo đang đeo cũng tự tháo khi bị bỏ.
- **Item ID lạ vẫn làm cả save bị từ chối** (không sửa gì, bản gốc giữ nguyên). Món "không xác định" để phục hồi làm ở **S5**.
- **Chưa có `revision`** cho inventory. Thêm ở S2 cùng selector UI.
- **Save cũ của khu 50 m chuyển sang thị trấn nhận 61 balo.** Đây là hành vi nhất quán với ván mới: các tủ thị trấn do migration nội dung gieo được coi như ván mới. Nếu muốn ít hơn thì chỉnh `bonusLoot.chance` trước khi phát hành. Luật đã phát hành không được sửa, phải thêm luật mới.
- **`scripts/p2-s4-browser.mjs` hỏng từ trước S1.** Chạy trên `master` cũng hỏng ở cùng bước, vì game ở thị trấn lớn chạy chậm hơn thời gian thực trên SwiftShader. Đã cập nhật API cho các script `p2-*`, `cs1`, `m5`, `m8`, nhưng **chưa chạy lại** chúng.

## 4. File

- **Mới:**
  - `src/game/systems/bags.ts`;
  - `src/game/systems/inventoryV10.test.ts`;
  - `src/game/systems/fixtures/inv-loot-v9.json` (đóng băng);
  - `src/test/legacySave.ts` (tiện ích test: `asV9`, `slotsOf`, `compactSlots`);
  - `scripts/il-s1-browser.mjs`;
  - `docs/inventory-loot/s1/*.png`.
- **Sửa:**
  - `entities/items.ts`, `entities/player.ts`;
  - `systems/inventory.ts`, `equipment.ts`, `loot.ts`, `survival.ts`, `crafting.ts`, `timedAction.ts`, `save.ts`, `saveStorage.ts`;
  - `world/worldState.ts`;
  - `core/runtime.ts`, `core/config.ts`, `core/events.ts`;
  - `types/save.ts`;
  - `stores/inventoryStore.ts`, `hudStore.ts`, `uiStore.ts`;
  - `components/Inventory.tsx`, `ContainerPanel.tsx`;
  - `app/App.tsx`;
  - các test dùng `.slots`;
  - các script trình duyệt cũ.
