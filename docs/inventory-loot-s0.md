# INV-LOOT S0 — Audit và phương án tích hợp

> Phase: `docs/Phase_Inventory_Loot_Upgrade.md` (mã `INV-LOOT`). Sprint 0 = khảo sát, chốt phương án. **Chưa sửa code.**
> Ngày: 2026-09-28. Trạng thái repo lúc audit: `master` sạch tại 133e8c4, `npm test` 941 pass (+13 skip) theo CURRENT_STATE.
> Tài liệu này đã sửa theo góp ý của chủ dự án (thời gian chuyển đồ, balo cho save cũ, T15/T16, lý do đổi data model, reservation chung, Floor, Unequip, Escape, capacity, soak).
> **Gate:** chủ dự án duyệt tài liệu này trước khi bắt đầu migration (S1) và transfer queue (S4).

## 0. Quyết định

### 0.1 Đã chốt (chủ dự án, 2026-09-28)

| # | Quyết định |
|---|---|
| D1 | UI tiếng Việt. Mọi nhãn gom vào một file (`src/components/inventory/labels.ts`), không thêm thư viện i18n |
| D2 | Icon SVG tự vẽ trong repo, rõ hình ở 20–24 px; không trích asset PZ |
| D3 | Không làm tab Corpse (xác zombie hiện tồn tại 20 s, không lưu, không có đồ) |
| D4 | Bảng chế tạo tách thành cửa sổ riêng cùng kiểu với Inventory/Loot |
| D5 | Balo cho save cũ theo phương án 3(b), với 4 điều kiện ở §6. Dữ liệu thỏa điều kiện 1 (xem §6.1) |
| D6 | Thời gian chuyển đồ theo nhóm: đồ nhỏ theo lô có giới hạn, đồ lớn theo từng đơn vị; thông số nằm trong item definition (§4) |

### 0.2 Đã trả lời (chủ dự án, 2026-09-28)

| # | Quyết định |
|---|---|
| Q1 | Nhánh `feature/inventory-loot`. Mỗi sprint commit và push kèm trạng thái kiểm thử thực tế. **Dừng chờ duyệt sau S1 và S4.** Không merge vào master |
| Q2 | Ăn uống, chế tạo, sửa truy cập túi chính + balo **đang đeo**. Balo đã tháo hoặc nằm dưới đất không nằm trong phạm vi. Chi tiết ở §0.3 |
| Q3 | Một queue chung cho transfer/craft/repair, chạy tuần tự. UI hiện action đang chạy **và** các action đang chờ. Chi tiết ở §0.3 |
| Q4 | Đổi mảng ô thành danh sách. **Giới hạn slot giữ nguyên:** túi chính 12, container giữ capacity của nó |

### 0.3 Luật đi kèm Q2/Q3

- **Một hàm duy nhất** `usableInventories(runtime)` trả về [túi chính, balo đang đeo] theo thứ tự đó. Ăn uống, chế tạo, sửa đều dùng nó.
- **Ăn/Uống/Dùng trên một món:** dùng đúng instance người chơi chọn (có thể nằm trong balo đang đeo).
- **Craft/Repair tự tìm nguyên liệu:** thứ tự ổn định, túi chính trước rồi balo đang đeo; cộng được từ cả hai. Bỏ qua món đang bị action khác giữ chỗ, món Favorite và món đang trang bị.
- **Balo có nguyên liệu đang được giữ chỗ:** không tháo, bỏ hay chuyển được cho tới khi action xong hoặc bị hủy.
- **Chế tạo khi đang chuyển đồ:**
  - được xếp hàng nếu nguyên liệu **đang mang và chưa bị giữ chỗ** đã đủ;
  - nếu phải dựa vào đồ chưa chuyển xong, báo "Chưa đủ nguyên liệu đang mang" (không đặt trước theo kết quả tương lai);
  - tới lượt thì kiểm tra lại nguyên liệu, quyền truy cập túi và điều kiện chế tạo;
  - không còn hợp lệ thì bỏ qua với lý do rõ, không trừ nguyên liệu một phần và không treo queue.
- **Kiểm chứng tại mốc duyệt:**
  - S1: save cũ giữ nguyên tổng đồ, condition và trang bị;
  - S4: spam thao tác, hủy giữa chừng, đầy túi, craft và transfer tranh cùng nguyên liệu.

## 1. Bản đồ codebase (đường dẫn thật)

| Mảng | Nơi | Ghi chú |
|---|---|---|
| Item definition | `src/game/entities/items.ts` | 15 item, `ItemId` là union literal; `stackLimit`, `maxCondition`, `melee`, `toolTags`, `repairGroup`; icon là emoji. Chưa có khối lượng, capability, balo |
| Item instance | cùng file | `stack` / `weapon` (có `condition`) / `tool` (`fuel?`). ID dạng `<inventoryId>:<n>`, bộ đếm `nextItemId` theo inventory |
| Inventory | `src/game/systems/inventory.ts` | `{ id, nextItemId, slots: (ItemInstance \| null)[] }`, số ô = độ dài mảng. API theo **chỉ số ô** (`transferSlot`, `removeFromSlot`) |
| Player | `src/game/entities/player.ts`, `runtime.player.inventory` | 12 ô (`GAME_CONFIG.inventory.slots`) |
| Equipment | `src/game/systems/equipment.ts` | Chỉ `weaponInstanceId` (tham chiếu, không bản sao). Hiện `reconcileEquipment` tự tháo khi món rời túi |
| Hotbar | — | Không có. Mục hotbar của spec không áp dụng |
| Dùng đồ | `src/game/systems/survival.ts` `consumeInventoryItem` | Tức thời, theo chỉ số ô; runtime chặn khi món bị reserve |
| Độ bền | `src/game/systems/weapons.ts` `applyWeaponWear` | Trừ `condition` trên instance trong túi, phát `weapon:worn` |
| Chế tạo/sửa | `src/game/systems/crafting.ts`, `entities/recipes.ts` | `checkRecipe` / `commitRecipe` (thử trên bản sao rồi mới ghi). Chỉ đọc túi chính |
| Timed action | `src/game/systems/timedAction.ts`, `runtime.action` | **Một** action, reservation theo `counts[itemId]` + `instanceIds`, chỉ trên túi chính. Hủy khi di chuyển/đánh/bị đánh/chết/X. Không lưu vào save |
| Container thế giới | `src/game/world/worldState.ts` | `ContainerState { id, opened, items, position? }`, ID ổn định từ map content (`c0_-1/store/shelf-1`…), 8 ô |
| Sinh loot | `src/game/systems/loot.ts`, `world/lootTables.ts` | Sinh **một lần cho mọi container lúc New Game** (`createWorldState`), seed = FNV(worldSeed, containerId), mulberry32. 23 bảng; có sẵn tủ bếp (`house-kitchen`), tủ quần áo (`house-wardrobe`), tủ đầu giường (`house-nightstand`), kệ dụng cụ (`tool-shelf`) |
| Đồ dưới đất | `runtime.dropItem` | Mỗi lần Drop tạo container 1 ô `drop:<itemId>` tại chân ("Túi đồ rơi"), mở bằng E. Migration nội dung cũng rải đồ tủ bị bỏ thành các túi này |
| Tương tác | `src/game/systems/interaction.ts`, `runtime.stepInteraction` | Tầm 1 m + bán kính vật, cùng tầng, `isBlocked` (tường/cửa/kính qua `staticColliders.segmentBlocked`); spatial hash, không raycast mỗi frame. Panel tự đóng khi ra xa hơn tầm + 0,75 m |
| Game loop / pause | `rendering/GameLoop.tsx` → `runtime.tick(dt)` | dt biến thiên, chặn 0,1 s; pause = không gọi tick. Mở túi **không** pause |
| Input | `src/game/systems/input.ts`, `App.tsx` | Nhấn chuột chỉ tính trên canvas; wheel gắn vào canvas (`CameraRig`) nên overlay DOM không zoom; ô nhập chữ giữ phím. `uiOpen` chặn đòn đánh và thế chiến đấu. Không dùng pointer lock |
| Esc | `App.tsx` `onAction('pause')` | Hiện tại: đóng túi/tủ → rời thế → pause |
| React | `src/stores/inventoryStore.ts` | Runtime là nguồn thật; store clone túi + container đang mở khi có event `inventory:changed` (không mỗi frame) |
| Save | `src/types/save.ts` (v9), `systems/save.ts`, `systems/saveStorage.ts`, `stores/uiStore.ts` | IndexedDB `zombie-outbreak`, store `saves`, một key mỗi slot, ghi một transaction. Migration thuần trong bộ nhớ v1 → v9 + migration nội dung; `commitMigratedSave` ghi backup + bản mới trong **một** transaction và hủy nếu slot đã đổi. Save mới hơn code bị từ chối. Lưu thủ công/autosave dùng cờ `busy` (lần sau bỏ qua khi lần trước chưa xong). Lỗi ghi → toast lỗi, không báo thành công |
| Fixture save | `src/game/systems/fixtures/` | v1…v7 đóng băng: nền tốt cho test migration |
| Soak | `src/game/core/soak.test.ts` | Bot gọi `rt.takeAll()` tức thời |
| Script | `package.json` | `test` (vitest), `lint` (oxlint), `build` (tsc -b + vite), `build:editor`, `check:bundle`, `map:check` |

**Gate S0 (spec §3):** nguồn authoritative duy nhất = `GameRuntime` (túi, container, floor, balo, equipment). Nơi duy nhất thay đổi ownership/quantity = module thuần mới `inventoryOps` được gọi qua các command của runtime. UI chỉ gửi command (ID + số lượng) và đọc snapshot; không có state item riêng. **Đạt về thiết kế**, sẽ khóa bằng test ở S1.

## 2. Giữ / mở rộng / thay

| Giữ nguyên | Mở rộng | Thay |
|---|---|---|
| Item definition/instance (thêm trường) | `items.ts`: `weightKg`, `category`, `capabilities`, `transfer`, `bag`; item `backpack`; `ItemInstance.favorite?` | `inventory.ts`: mảng slot → danh sách + `slotCapacity` (§3) |
| Sinh loot một lần lúc New Game, seed theo ID | `loot.ts`: luồng seed phụ cho balo (§6.2); capacity theo loại container | `runtime.action` đơn → hàng đợi dùng chung (§5) |
| Tương tác, tầm với, chặn tường | `interaction.ts`: kiểm tra tầm cho từng món Floor | `drop:<id>` → Floor theo ô (§7) |
| Chuỗi migration + backup một transaction | `save.ts`: v10 | `Inventory.tsx`, `ContainerPanel.tsx` → bộ component mới (§ spec 9.2) |
| Crafting check/commit trên bản sao | `crafting.ts`: nguồn nhiều inventory (nếu Q2 = có), reservation theo instance | Esc (§8.2) |
| `inventoryStore` nhận event | Thêm revision, selector theo inventory | |

## 3. Data model

### 3.1 Phương án

```ts
interface Inventory {            // thay cho { slots: (ItemInstance|null)[] }
  id: string
  nextItemId: number
  items: ItemInstance[]          // thứ tự ổn định = thứ tự thêm vào
  slotCapacity: number | null    // null = không giới hạn (Floor)
  revision: number               // tăng mỗi mutation; runtime-only, không lưu
}
```

- **Không có registry instance toàn cục.** Instance nằm trong đúng một `items[]` của inventory sở hữu nó. Invariant 1 (một chủ) đúng theo cấu trúc; không có hai bản quantity.
- **Nội dung balo:** `bags: Map<bagInstanceId, Inventory>` trong runtime. Instance balo nằm ở túi, container hay Floor thì nội dung vẫn tra theo ID balo. Chuyển balo = chuyển một instance, nội dung đi theo mà không cần sửa chỗ nào khác (atomic theo cấu trúc). Validator: mỗi instance balo có đúng một bản ghi nội dung và ngược lại; trong nội dung balo không có balo.
- **Số slot dùng** = `items.length` (một stack thật hoặc một món không stack = một slot), đúng spec §2.3.

### 3.2 Vì sao đổi (lợi ích cụ thể, không phải để khớp ví dụ)

1. **Floor không có sức chứa cố định.** Mảng slot buộc chọn trước độ dài. Floor (và fixture 500 món của T26) cần `slotCapacity: null`.
2. **Overcapacity biểu diễn được.** Spec §2.3/§6.4 yêu cầu giữ đồ và đánh dấu khi vượt giới hạn. Mảng slot không chứa nổi quá độ dài của nó; hiện chỉ có thể cắt bớt (vi phạm §11.3.5). Trường hợp thật: capacity mới nhỏ hơn cấu hình cũ, balo bị thay định nghĩa.
3. **API theo chỉ số ô phải bỏ dù giữ hay đổi.** T10 bắt action giữ ID khi sort/filter; UI danh sách không hiển thị vị trí ô. Ô `null` và chỉ số ô không còn ý nghĩa gì với người chơi, chỉ còn là nguồn lỗi (lấy nhầm ô sau khi danh sách đổi).
4. **Validator và migration đơn giản hơn:** bỏ kiểm tra "độ dài mảng = capacity" và các ô trống.

**Chi phí:** save v10 đổi hình dạng (chuyển đổi đơn giản: bỏ `null`, giữ thứ tự, `slotCapacity` = độ dài mảng cũ); khoảng 20 file dùng `.slots` phải sửa (đa số là test). Nếu chủ dự án muốn giữ mảng slot (Q4 = không), phương án thay thế: giữ `slots`, đổi API sang instance ID, Floor dùng cấu trúc riêng, overcapacity chặn bằng validator. Cách này ít đổi save hơn nhưng có hai kiểu inventory song song.

### 3.3 Item definition bổ sung (thông số khởi điểm, tune được)

| Item | kg | Nhóm chuyển | Ghi chú |
|---|---|---|---|
| nails | 0,01 | nhỏ, lô 10 | |
| bandage | 0,05 | nhỏ, lô 3 | stackLimit 3 |
| duct_tape | 0,2 | nhỏ, lô 5 | |
| chips | 0,15 | đơn vị | |
| soda | 0,35 | đơn vị | |
| canned_food | 0,4 | đơn vị | |
| scrap_metal | 0,5 | đơn vị | |
| water | 0,6 | đơn vị | |
| hammer | 0,7 | đơn vị | |
| medkit, baseball_bat, wooden_club | 1,0 | đơn vị | |
| metal_pipe | 1,5 | đơn vị | |
| crowbar, wood_plank | 2,0 | đơn vị | |
| backpack (mới) | 0,8 (vỏ) | đơn vị, tính theo vỏ + đồ bên trong | 8 ô, không stack, slot `back` |

Khối lượng chỉ để hiển thị và tính thời gian; **không** thêm giới hạn khối lượng (spec §2.2). Stack limit giữ nguyên.

## 4. Thời gian chuyển đồ

Cấu hình trên item definition (mặc định theo nhóm trong `GAME_CONFIG.transfer`), không nằm trong UI:

```ts
transfer?: { batch: number; seconds: number }   // đồ nhỏ: mỗi bước chuyển tối đa `batch` đơn vị
// không khai báo → mỗi bước một đơn vị, seconds = clamp(0.20 + kg × 0.15, 0.20, 1.50)
```

- **Đồ nhỏ** (đinh, băng gạc, băng keo): theo lô có giới hạn. Ví dụ 50 đinh = 5 lô × 0,3 s = 1,5 s (spec cũ: 10 s).
- **Đồ lớn** (đồ hộp, nước, gỗ, vũ khí…): mỗi đơn vị một bước, thời gian tăng theo số lượng và khối lượng. Ví dụ 10 ván gỗ ≈ 5 s, 3 đồ hộp ≈ 0,8 s. Không có trần cho cả stack, nên chuyển đống đồ nặng không nhanh như một món.
- **Commit từng bước.** Hủy giữa chừng chỉ giữ các bước đã hoàn tất; bước đang chạy không chuyển phần nào; phần còn lại ở nguồn.
- **Không phụ thuộc FPS.** Tiến trình cộng dồn dt của simulation (đã dừng khi pause). Trong một tick, vòng lặp hoàn tất **nhiều bước** nếu dt đủ, phần dư chuyển sang bước sau; mỗi bước vẫn revalidate riêng. Test: cùng một batch ở 30/60/144 Hz và với dt 0,1 s cho cùng số bước commit tại cùng thời điểm simulation (sai số ≤ 1 tick).
- Ước lượng Take All một tủ bếp điển hình (2 đồ hộp, 1 nước, 1 snack): khoảng 1,1 s.

## 5. Hàng đợi hành động và reservation chung

- `runtime.action` trở thành `runtime.actions`: hàng đợi FIFO, một action chạy tại một thời điểm. Transfer, chế tạo và sửa đi chung (không tạo hàng đợi thứ hai). Batch lưu dạng "danh sách instance ID + số lượng còn lại", sinh bước khi tới lượt (không tạo hàng nghìn object khi Take All).
- **Một sổ reservation duy nhất:** `{ actionId, inventoryId, instanceId, quantity }`. Chế tạo hiện reserve theo `counts[itemId]`; sẽ đổi thành reserve **instance cụ thể** lúc bắt đầu chạy. Nhờ vậy mọi action dùng cùng một luật:
  - khả dụng của một instance = quantity − tổng reserved của nó; tổng reserved không bao giờ vượt quantity;
  - hủy/xong/lỗi chỉ giải phóng reservation **của chính actionId đó**;
  - use/equip/transfer/drop đều kiểm tra cùng một hàm.
- Hủy (di chuyển, đánh, bị đánh, chết, X, container mất/ra ngoài tầm, load/New Game) dọn toàn bộ hàng đợi và sổ.
- **Regression test bắt buộc (S4):**
  1. Đang chế tạo, chuyển/drop nguyên liệu đã reserve bị chặn đúng lý do;
  2. Hủy transfer không giải phóng reservation của craft đang chạy hoặc đang chờ; craft vẫn commit đúng sau đó;
  3. Hủy craft không động tới món transfer đã commit;
  4. Một instance không bao giờ bị hai action giữ vượt quantity (property test với chuỗi thao tác ngẫu nhiên có seed);
  5. Hoàn tất/hủy lặp lại cùng actionId không commit hay giải phóng lần hai;
  6. Các test `timedAction.test.ts`, `crafting.test.ts` hiện có vẫn pass không đổi ý nghĩa.

## 6. Balo

### 6.1 Bằng chứng cho điều kiện 1 (cờ "đã mở" có thật)

- `ContainerState.opened` được lưu trong **mọi** save từ khi game có save (Phase 1 sprint 5, commit 15fb349). Validator yêu cầu nó là boolean với cả save v1 (`save.ts:80`).
- Chỉ có **một** chỗ bật cờ: `runtime.interact` khi người chơi mở container bằng E (`runtime.ts:1111`); ngữ nghĩa không đổi từ commit 5ce1fa5. Không thể lấy hay cất đồ mà không mở (take/store yêu cầu container đang mở).
- Các chỗ ghi `opened: false` ngoài New Game: container mới được migration gieo (v2→v3, v4→v5, migration nội dung). Những container này chưa từng tồn tại với người chơi, nên "chưa mở" là đúng. Túi `drop:*` cũng có `opened: false` nhưng không phải container của map, nên bị loại.
- Kết luận: `opened === false` là **dữ liệu đã ghi**, không phải suy đoán từ việc tủ còn đồ. `lootGenerated` không được dùng làm điều kiện.

### 6.2 Ván mới

- Balo ra từ một **luồng seed phụ** `hash(worldSeed, 'inv-loot/backpack-v1:' + containerId)`, chạy sau bảng loot chính, chỉ cho bảng phù hợp: `house-wardrobe`, `locker` (xác suất khởi điểm 15 %, trong config).
- Lý do không thêm balo vào pool của bảng: thêm một dòng pool làm lệch mọi lượt roll sau đó, đổi loot của cùng seed và mốc soak. Luồng phụ giữ nguyên loot cũ từng món.
- Chỉ thêm nếu container còn slot. Không có chỗ thì không thêm (và không bỏ món khác).
- Instance ID balo tất định: `<inventoryId>:bag-v1`. Validator hiện chỉ kiểm tra hậu tố số, nên ID này không va chạm bộ đếm.

### 6.3 Save cũ (migration v9 → v10)

Điều kiện chủ dự án đặt ra và cách đáp ứng:

1. **Cờ đã mở có thật:** chỉ xét container của map có `opened === false` (§6.1).
2. **Chỉ container phù hợp và còn chỗ:** bảng loot thuộc danh sách §6.2 và còn slot trống. Không xóa, không thay, không gộp đồ có sẵn.
3. **Seed ổn định và dấu đã chạy:** dùng đúng hàm của §6.2, nên một tủ chưa mở trong save cũ nhận đúng thứ ván mới cùng seed sẽ có. Dấu: `schemaVersion` 10 (migration chỉ chạy cho save < 10) cộng trường `lootPatches: ['backpack-v1']` trong save; ID balo tất định nên chạy lặp cũng không thêm lần hai (T20).
4. **Không có container hợp lệ:** không đổi món nào, save vẫn nâng cấp hình dạng lên v10 (bắt buộc cho data model) và thông báo "Không có tủ phù hợp chưa mở: không thêm balo". Không tặng balo cho người chơi, không ghi đè loot.

Thông báo sau migration luôn nêu số balo đã thêm (kể cả 0). Nếu Q4 chọn giữ mảng slot thì điều kiện 1–4 vẫn áp dụng y nguyên.

## 7. Floor

- **Dữ liệu:** mỗi ô 1 m × tầng là một inventory `floor:<storeyY>:<cx>:<cz>`, `slotCapacity: null`, tạo khi có đồ và xóa khi rỗng. Mỗi món trên Floor **giữ vị trí thật** (`position` riêng cho từng món), ô chỉ để tổ chức và truy vấn.
- **Nhặt:** kiểm tra tầm và tường chắn tới **vị trí của từng món**, không theo tâm ô hay tâm danh sách. Hai món cùng ô không mặc nhiên đều nhặt được; món ngoài tầm hiện disabled "Ngoài tầm".
- **Tab Floor:** gom các ô trong tầm; mỗi dòng giữ ID inventory nguồn thật, không có inventory ảo chứa bản sao.
- **Drop:** tại chân người chơi (vị trí hợp lệ, đúng tầng); xê dịch nhỏ theo vòng quanh nếu trùng, mỗi điểm đều kiểm `isBlocked` từ người chơi để không rơi trong tường/ngoài map.
- **Hiển thị:** mỗi món một marker nhỏ (instanced), là projection của dữ liệu; chunk unload không xóa dữ liệu (dữ liệu nằm trong WorldState, không theo chunk).
- **Migration:** `drop:*` → Floor tại cùng vị trí, giữ instance ID. Migration nội dung (tủ bị bỏ) sẽ rải đồ vào Floor thay vì tạo túi.

## 8. Các chi tiết đã khóa

### 8.1 Đồ đang trang bị

- Store/Drop/Transfer đồ đang cầm hoặc balo đang đeo: bị chặn, lý do "Đang trang bị — tháo ra trước". Đây là **thay đổi trải nghiệm** so với việc tự tháo hiện tại.
- Để dễ thao tác: menu chuột phải của món đang trang bị đặt "Tháo" lên đầu; dòng có huy hiệu "Đang cầm"; thông báo batch nêu số món bị bỏ qua kèm gợi ý tháo. Store/Drop hàng loạt bỏ qua món Favorite và món đang trang bị.
- Balo có action pending liên quan: từ chối tháo/chuyển, cho Cancel trước.

### 8.2 Escape

Mỗi lần nhấn xử lý **đúng một tầng**, theo thứ tự:

1. popup (menu, tooltip ghim, hộp số lượng);
2. hàng đợi action đang chạy;
3. cửa sổ đang focus; nếu không cửa sổ nào focus thì cửa sổ trên cùng (z-order);
4. rời thế chiến đấu;
5. pause.

X vẫn hủy hàng đợi như hiện tại.

### 8.3 Capacity

- `slotCapacity` được **lưu trong save** cho từng inventory. Load dùng giá trị đã lưu, không lấy từ config. Config capacity theo loại container chỉ áp dụng khi sinh container (New Game, container mới do migration).
- Migration v10: túi = 12, container = độ dài mảng cũ (8), túi drop cũ chuyển thành Floor.

### 8.4 Soak

Bot chuyển đồ qua hàng đợi (`enqueueTakeAll`, chờ đến khi xong theo thời gian simulation). Ngoài việc bot hoàn thành, soak còn kiểm tra:

- mỗi 1 s simulation: tổng số lượng theo từng `itemId` trong túi + container + Floor + balo chỉ đổi do dùng/chế tạo/hao mòn đã ghi nhận;
- không có instance ID trùng;
- sổ reservation rỗng khi hàng đợi rỗng;
- không còn listener hay action treo khi kết thúc.

Mốc soak mới được đo lại và ghi, không chỉnh thời gian chờ để khớp mốc cũ.

## 9. Save v10 và rủi ro migration

| Rủi ro | Biện pháp |
|---|---|
| Đổi hình dạng inventory làm hỏng save | Migration thuần, clone trước khi đổi; validate invariant trước khi `commitMigratedSave` (backup + ghi trong một transaction, đã có) |
| Chạy migration lặp nhân đồ | ID tất định (balo), `lootPatches`, test chạy v10 → validate → không migrate lại |
| Balo gieo vào tủ đã lục | Điều kiện `opened === false` (§6.1) + test với fixture v5 (2 tủ đã mở) |
| Unknown item ID | Hiện validator từ chối cả save. v10: giữ payload thành món "không xác định" hiển thị được, chặn dùng/trang bị, không xóa (spec §11.3.7) |
| `drop:*` sau migration nội dung | Thứ tự: migration nội dung (v9) → v10 chuyển toàn bộ `drop:*` sang Floor; test với fixture có túi rơi |
| Save cũ vượt capacity | Không xảy ra với dữ liệu hiện có (mảng cố định); vẫn hỗ trợ cờ overcapacity cho tương lai |
| Save của phiên bản mới hơn | Đã từ chối (`incompatible`), giữ nguyên |
| Pending queue lọt vào save | Snapshot chỉ gồm state đã commit; test T18 |

## 10. Kiểm thử — điều chỉnh

- **T15 và T16 không coi là đạt sẵn.** Sinh loot một lần lúc New Game chỉ là nền thuận lợi. Test cụ thể:
  - T15: mở container rỗng nhiều lần, save/load, migrate từ fixture v5/v7 → nội dung không đổi, generator không chạy;
  - T16 (thay cho "hai yêu cầu mở cùng lúc"): đếm số lần gọi generator. Tạo world = đúng một lần mỗi container; mở hoặc load = 0 lần; migration chỉ gọi cho container mới và luồng balo; khởi tạo world hai lần (StrictMode, remount theo `sessionId`) không sinh lặp.
- Các ca còn lại theo ma trận spec §14 (T01–T30), gắn vào sprint tương ứng; ca UI thật chạy bằng Playwright theo công thức headless Chromium đã dùng.
- Đo frame time trước/sau trên cùng máy và cùng cảnh (S2 lấy mốc, S6 so sánh), ghi median/p95.

## 11. File dự kiến sửa

- **Mới:**
  - `src/game/systems/inventoryOps.ts` (thuần: add/remove/split/merge/transfer preview/commit, capacity, khối lượng, invariant);
  - `src/game/systems/actionQueue.ts` (hàng đợi + sổ reservation);
  - `src/game/systems/floor.ts`;
  - `src/game/systems/bags.ts`;
  - `src/components/inventory/*` (overlay, window, table, row, tooltip, menu, dialog số lượng, tiến trình, drag preview, `labels.ts`);
  - `src/components/inventory/icons/*` (SVG);
  - `src/stores/inventoryUiStore.ts` (layout, pin, filter; lưu vào preferences);
  - test tương ứng.
- **Sửa:**
  - `entities/items.ts`, `systems/inventory.ts` (bỏ hoặc chuyển thành adapter), `equipment.ts`, `timedAction.ts`, `crafting.ts`, `survival.ts`, `loot.ts`;
  - `world/worldState.ts`, `world/lootTables.ts` (chỉ config balo, không sửa pool);
  - `core/runtime.ts`, `core/config.ts`, `core/events.ts`;
  - `systems/save.ts`, `types/save.ts`;
  - `stores/inventoryStore.ts`, `stores/settingsStore.ts` (UI scale, reset layout), `app/App.tsx` (Esc);
  - rendering Floor marker;
  - `soak.test.ts`, các test dùng `.slots`;
  - `scripts/p2-s2-browser.mjs`, `p2-smoke.mjs`;
  - `docs/CURRENT_STATE.md`.
- **Bỏ:** `components/ContainerPanel.tsx`, phần lưới ô trong `components/Inventory.tsx`.

## 12. Thứ tự sprint

Như spec §13. S1 (data model + v10 + balo cho save cũ) dừng báo cáo. S4 (queue + reservation chung) dừng báo cáo. Ghi chú từng sprint: `docs/inventory-loot-s1.md` …; ảnh bàn giao `docs/inventory-loot/`.
