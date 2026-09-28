# INV-LOOT S3 — Tủ lân cận, Ngoài tầm, đồ dưới đất (Floor, save v11), balo

> Phase: `docs/Phase_Inventory_Loot_Upgrade.md`. Trước đó: `docs/inventory-loot-s0.md` … `s2.md`.
> Nhánh `feature/inventory-loot`. Ngày 2026-09-28. S3 không phải mốc dừng (Q1: dừng sau S1 và S4).

## 1. Kết quả

### Tầm với và tủ lân cận (`core/runtime.ts`)

- Danh sách **tủ trong tầm** (`nearbyContainerIds`) và **đồ dưới đất trong tầm** (`nearbyFloorIds`) được cập nhật khoảng 8 lần/giây, không raycast mỗi frame.
- **Luật tầm với:**
  - khoảng cách tới điểm neo;
  - cùng tầng;
  - không có tường, cửa đóng hay kính chắn (`isBlocked`).
- **Đồ dưới đất được kiểm tra ở vị trí của chính món đó**, không theo ô hay tâm danh sách: hai món cùng một ô 1 m chưa chắc đều với tới được.
- Mọi lệnh chuyển đồ đều kiểm tra tầm với **ngay lúc chuyển**, với từng tủ và từng món dưới đất.
- **Cửa sổ Lục đồ không tự đóng khi đi xa nữa.** Nó giữ tủ đang xem, hiện "Ngoài tầm — lại gần để lấy/cất", khóa Lấy hết và Lấy đã chọn; runtime từ chối với lý do `unreachable`. Quay lại gần thì dùng được tiếp.
- **Tab Lục đồ:**
  - thứ tự: Dưới đất → các tủ trong tầm (theo tên rồi ID) → tủ đang xem nếu đã ra ngoài tầm;
  - chọn theo khóa: một tủ mới vào tầm không cướp tab đang xem;
  - bấm tab = xem tủ đó (tính là đã mở, không sinh loot);
  - tủ trùng tên được đánh số ("Tủ lạnh căng tin 1 / 2").
- **E khi không nhắm vào vật gì** mà có đồ dưới đất trong tầm thì mở Lục đồ ở tab Dưới đất (gợi ý "Xem đồ dưới đất").

### Floor (`systems/floor.ts`, save **v11**)

- **Dữ liệu:**
  - `FloorStore`: ô 1 m theo tầng (`floor:<tầng cm>:<cx>:<cz>`), mỗi ô là một inventory loại `floor`, không giới hạn slot;
  - **mỗi món giữ vị trí thật**;
  - thả xuống **không gộp stack**, mỗi lần thả là một đống riêng ở đúng chỗ;
  - ô rỗng tự biến mất.
- **Thả xuống** đi qua đúng một đường `transferItems(nguồn, 'floor', …)`:
  - được thả từ túi chính **hoặc balo đang đeo**; đồ đang trang bị, Favorite và đồ đang giữ chỗ vẫn bị chặn;
  - món rơi cách chân 0,35 m về phía trước nếu không có gì chắn, không thì rơi ngay dưới chân;
  - tầng giữ nguyên.
- **Nhặt:** từ tab Dưới đất (nhấp đúp, Lấy đã chọn, Lấy hết, menu). Mỗi dòng là instance thật trong ô của nó, không có inventory ảo chứa bản sao.
- **Hiển thị:** mỗi món một marker nhỏ ở vị trí thật, dựng từ dữ liệu floor (`worldStore.drops`). Load lại hay chunk unload không tạo bản thứ hai, vì dữ liệu nằm ở `WorldState` chứ không theo chunk.
- **Save v11:**
  - `floor: [{ id, y, items, positions }]`; `containers` chỉ còn tủ của map;
  - validator: ô không rỗng, mỗi món có đúng một vị trí nằm trong đúng ô đó và trong bản đồ, không còn túi rơi.
  - **v10 → v11:** mỗi túi rơi thành đồ dưới đất tại đúng vị trí, cùng instance (ID, số lượng, độ bền, nội dung balo). Túi rơi đã rỗng thì không còn gì để giữ.
  - Migration nội dung trên save v11 cũng rải đồ của tủ bị bỏ xuống đất, và dời đồ bị vật cản mới đè ra bên cạnh.
- Thông báo sau migration có thêm: "Túi đồ đã thả trở thành đồ dưới đất ở đúng chỗ cũ (E khi đứng gần để xem)."

### Balo

- UI S2 đã có tab "Balo đang đeo" và các thao tác Đeo / Tháo / Chuyển vào balo; S3 hoàn tất vòng đời: **đeo → cho đồ vào → tháo → bỏ xuống đất → save/Continue → nhặt → đeo lại**.
- Nội dung và khối lượng giữ nguyên, khối lượng chỉ tính một lần. Balo đang đeo phải tháo ra mới bỏ được (menu ghi lý do).

## 2. Kiểm chứng (đã chạy thật)

| Cổng | Kết quả |
|---|---|
| `npm test` | **1011 pass**, 13 skip (sau S2: 1003) |
| Soak | **Trùng từng số** với mốc gốc: shelter 1800 s / 3 kill / 30 dmg / 26 món; patrol 646,75 s / 26 kill |
| `tsc -b`, `oxlint` | Sạch |
| `vite build`, `build:editor`, `check:bundle`, `map:check` | OK |
| `scripts/il-s3-browser.mjs` (Chrome GPU, 1920×1080) | **PASS**, console sạch |
| `scripts/il-s2-browser.mjs` (chạy lại) | **PASS**; frame time không đổi (26,7 ms median), sort 500 dòng 59 ms |

**Test mới** (`floor.test.ts` và các test cập nhật):

- **Floor:** ô theo 1 m và tầng; mỗi món giữ vị trí; thả không gộp; lấy một phần thì phần còn lại vẫn ở chỗ cũ; round-trip qua save; `near()` giữ tầng và khoảng cách thật.
- **T08:** tủ sau tường không nằm trong danh sách và không chuyển được đồ.
- **Tầm với từng món:** hai món cùng ô 1 m, món cách 1,4 m lấy được, món cách 1,9 m bị từ chối; có tường thì cũng bị từ chối.
- **Tủ mới vào tầm** không đổi tab đang xem; **E** khi không nhắm gì mở Dưới đất.
- **T13 + T17:** vòng đời balo đầy đủ ở trên, qua hai lần save/load. Luôn đúng một món dưới đất và một bản ghi balo; nội dung và khối lượng giữ nguyên.
- **Fixture v10 thật** `fixtures/inv-loot-v10.json`, ghi bằng code S2 trước khi đổi schema: balo đang đeo chứa nước Favorite, balo chứa đinh cất trong tủ đầu giường, hai túi rơi.
  - Lên v11: túi rơi thành đồ dưới đất cùng instance và vị trí;
  - balo, Favorite, trang bị và túi chính không đổi; tổng số món không đổi;
  - chạy lặp không migrate lại; round-trip khớp.
  - Validator từ chối túi rơi trong save v11 và món nằm sai ô.
- **Cập nhật test cũ:**
  - so sánh cả save với fixture thì bỏ phần túi rơi, rồi so riêng từng món trong túi rơi với đồ dưới đất (`floorItemsOf` / `dropItemsOf`);
  - test "đi xa thì tủ tự đóng" đổi thành "đi xa thì hiện Ngoài tầm, không chuyển được, quay lại thì dùng tiếp".

**Trình duyệt** (`il-s3-browser.mjs`):

1. **Bốn loại tủ mẫu** mở đúng tab với đồ thật: tủ bếp, tủ quần áo, tủ đầu giường, kệ dụng cụ.
2. **Hai tủ cạnh nhau:** chỗ đứng được chọn theo đúng luật tầm với của runtime.
   - Tab hiện: Dưới đất / Tủ lạnh căng tin 1 / Tủ lạnh căng tin 2;
   - tab đang xem được giữ nguyên;
   - bấm tab kia thì chuyển sang và tủ đó được đánh dấu đã mở.
3. **Đi xa 8 m:** hiện "Ngoài tầm", Lấy hết bị khóa; quay lại thì dùng được.
4. **Balo:** đeo qua menu, "Chuyển vào Balo đang đeo" cho ván gỗ và nước, tab balo hiện đúng hai món. Bỏ xuống khi đang đeo bị khóa; tháo ra rồi bỏ xuống thì balo nằm dưới đất.
5. **E ở chỗ trống** mở tab Dưới đất, trong đó có "Balo".
6. **Lưu và về menu → reload → Continue:** đúng một món dưới đất, bản ghi balo còn. Nhấp đúp để nhặt, đeo lại: nội dung `waterx2, wood_plankx3`.

Ảnh: `docs/inventory-loot/s3/`: `loot-kitchen`, `loot-tabs`, `loot-out-of-reach`, `backpack-worn-contents`, `floor-tab`, `backpack-picked-up`.

## 3. Lệch so với kế hoạch và phần chưa làm

- **Xác zombie:** không làm (D3).
- **Sức chứa theo loại tủ:** vẫn 8 cho mọi tủ, chưa đổi số nào.
  - Cơ chế giữ capacity đã lưu có từ S1; muốn cấu hình theo bảng loot thì chỉ ảnh hưởng ván mới.
  - Chưa làm vì chưa có số liệu cân bằng; nếu cần thì thêm config.
- **Loot "sinh lười":** không dùng. Vẫn sinh một lần lúc New Game (một cơ chế duy nhất, như audit đã chọn).
- **Balo nằm trong tủ hoặc dưới đất:** không xem được nội dung. Chỉ balo đang đeo mới dùng được đồ bên trong (đúng spec §6.3).
- **Marker dưới đất:** là hộp vàng nhỏ giống nhau cho mọi món. Icon hoặc mesh theo loại để lại S6 (polish).
- **Test xuyên tường:** thực hiện bằng override tia chắn (`setLineOfSightOverride`); bản thân tia chắn đã có test riêng (`lineOfSight.test.ts`). Script trình duyệt không dựng cảnh xuyên tường thật.
- **Script:** `scripts/il-s1-browser.mjs` được đánh dấu SUPERSEDED (dùng UI lưới ô S1 và save v10).

## 4. File

- **Mới:**
  - `src/game/systems/floor.ts`, `floor.test.ts`;
  - `src/game/systems/fixtures/inv-loot-v10.json` (đóng băng);
  - `scripts/il-s3-browser.mjs`.
- **Sửa:**
  - `core/runtime.ts` (tầm với, danh sách lân cận, `openLoot`, `lootOpen` / `lootInReach`, floor trong `transferItems`, drop, snapshot/load);
  - `systems/inventory.ts` (loại `floor`, không gộp khi thả), `inventoryCommands.ts` (khóa `floor`), `save.ts` (v11, `migrateV10`, floor trong migration nội dung, validator), `types/save.ts`;
  - `world/worldState.ts` (`floor`);
  - `stores/inventoryStore.ts` (view Dưới đất, tab), `stores/worldStore.ts` (marker theo món), `stores/uiStore.ts` (thông báo);
  - `rendering/Scene.tsx`;
  - `components/inventory/` (Panels: tab Lục đồ, Ngoài tầm, Bỏ xuống từ balo; Popups; itemActions; commands; escape; labels);
  - `index.css`;
  - `test/legacySave.ts`;
  - các test save, migration và floors.
