# CURRENT_STATE — bàn giao cho phiên làm việc mới

> Cập nhật: **2026-09-24**, hoàn thành **Phase 2 — Sprint P2-S4**.
> Đọc file này, README.md, toàn bộ Zombie_Outbreak_Phase_2_Plan.md và docs/phase2-s1.md … phase2-s4.md.
> **Người dùng tự commit và push mọi thay đổi. Không tự commit/push. Cập nhật CURRENT_STATE cuối mỗi sprint.**

## 1. Trạng thái hiện tại

Phase 1 xong mã cả 6 sprint. Phase 2 xong **S1** (6977c79), **S2** (96c2af6), **S3** (cd632cc, docs 9e4ffe6) và **S4** (timed action, sửa, chế tạo, save v5). Sprint kế tiếp là **P2-S5: perception, zombie phá cửa, repath**.

Mốc Git trước phiên S4: **9e4ffe6** (docs: update project status after phase 2 sprint 3), working tree sạch. Thay đổi S4 chưa commit, để người dùng review.

| Sprint | Trạng thái |
|---|---|
| Phase 1 S1–S6 | Xong mã; deploy thật, FPS GPU thật và playtest tay vẫn cần xác nhận |
| P2-S1 Item/save/cửa động | Xong, đã commit |
| P2-S2 Loot/equipment/melee/condition | Xong, đã commit |
| P2-S3 Model/animation/character creation | Xong, đã commit |
| P2-S4 Timed action/craft/repair | Xong; 211 test, build/lint, Playwright dev + production qua; **chưa commit** |
| P2-S5 Perception/zombie phá cửa | Tiếp theo; dùng kết quả spike S1 |
| P2-S6 Barricade/tool/fuel | Chưa làm; dùng lại TimedAction + tool requirement S4 |
| P2-S7 Building/thùng/vách/rebuild | Chưa làm |
| P2-S8 Tích hợp/cân bằng/release | Chưa làm |

## 2. S4 đã bàn giao

- **Vật liệu**: `wood_plank`, `scrap_metal`, `duct_tape` (stack 10), `nails` (50), kind `material`, không dùng trực tiếp. **Gậy gỗ tự chế** `wooden_club` (18 dmg, 1,7 m, 1,05 s, 11 stamina, độ bền 40, model riêng). `repairGroup` gỗ/kim loại trên definition.
- **Loot**: 3 container ID mới `ct-safehouse-toolbox` (bảo đảm 1 ván/1 băng keo/1 kim loại vụn), `ct-store-hardware` (bảo đảm đinh/ván/băng keo), `ct-house-scrap` (ngoài trời, rủi ro). Bảng loot Phase 1/S2 không đổi. 400 seed (tổng 3 container): băng keo 2–6 (TB 2,6), ván 2–10 (TB 4,6); mỗi seed đủ ≥ 2 việc cần băng keo.
- **TimedAction** (`systems/timedAction.ts`, `systems/crafting.ts`, `entities/recipes.ts`, `runtime.action`): start kiểm tra + reservation → tiến độ theo dt tick (pause dừng) → hủy khi di chuyển/đánh/đẩy/trúng đòn zombie/X/chết (đói không hủy) → commit nguyên tử trên bản sao túi (action xóa trước commit, gọi lặp no-op). Reservation chặn thả/cất/dùng. Không lưu action; snapshot luôn trước hoặc sau commit.
- **Recipe**: gậy gỗ 2 ván + 1 băng keo 4 s; sửa gỗ 1 ván + 1 băng keo +30 4 s; sửa kim loại 1 kim loại vụn + 1 băng keo +25 5 s; không cần dụng cụ; chặn ở max, đầy bị chặn, hỏng sửa được. Chỗ thành phẩm tính sau khi tiêu input. Tool requirement (`isUsableTool`, hao mòn khi commit, instance chọn lúc start) có sẵn, test bằng recipe thử.
- **UI**: nút Sửa trong thẻ chi tiết (xem trước độ bền, nguyên liệu có/cần, lý do), bảng Chế tạo trong overlay túi, thanh tiến trình HUD trên bảng chỉ số + Hủy (X), toast/âm thanh bắt đầu/xong/hủy. Tư thế làm việc dùng chung trong `pose.ts` (input `work`).
- **Save v5**: migrate v4 → v5 gieo 3 container mới một lần (`seedAddedContainers`, dùng chung v2 → v3); backup `slot-1.backup-v4`. Fixture mới `phase2-s4-v5.json` từ Chromium; `phase2-s3-v4.json` đóng băng.
- **Sửa lỗi S3**: ô tên tạo nhân vật (controlled input) mất ký tự đầu ở bản production khi canvas đang khởi động → uncontrolled input. Đây là nguyên nhân lần fail "không rõ" của script S3 production.

## 3. Kiểm chứng cuối sprint

- **npm test: 211/211**, 22 file. **npm run build**, **npm run lint** sạch. Soak shelter/patrol giữ nguyên số liệu S2/S3 (30'/4 kill/30 dmg; 721,9 s/34 kill); lộ trình soak không đổi.
- **Playwright/Chromium 151** (`scripts/p2-s4-browser.mjs`): dev — loot hộp đồ nghề/tủ quần áo bằng input thật, gậy hỏng 5 dmg → sửa 0 → 30 (≥ 4 s game, cùng ID) → 25 dmg, hủy bằng di chuyển/X/trúng đòn không mất gì, chặn thả đồ đặt trước, pause đứng tiến độ, save giữa action rồi Continue, chế tạo + trang bị gậy gỗ (socket `weapon:wooden_club`), fixture v5, migrate fixture v4 qua Continue. Production — loot thật, bảng Chế tạo, sửa/pause/save/reload/Continue; **7/7 PASS liên tiếp**.
- Hồi quy: `p2-s2-browser.mjs`, `p2-s3-browser.mjs` (production 4/4 sau sửa ô tên), `p2-smoke.mjs` dev + production: PASS. Script cũ giờ assert schema 5.

## 4. File/module liên quan

| File | Trách nhiệm |
|---|---|
| src/game/entities/items.ts | Vật liệu, `wooden_club`, `repairGroup` |
| src/game/entities/recipes.ts | Dữ liệu recipe, `repairRecipeFor`, `CRAFT_RECIPES` |
| src/game/systems/crafting.ts (+ .test) | `checkRecipe`/`commitRecipe` thuần, không đổi gì khi thất bại |
| src/game/systems/timedAction.ts | Kiểu action, reservation, `advanceAction` |
| src/game/core/runtime.ts | `action`, `startCraft/startRepair/startRecipe`, `cancelAction`, `completeAction`, `stepAction`, chặn đồ đặt trước |
| src/game/core/timedAction.test.ts | Test tích hợp runtime (hủy, save, commit, acceptance) |
| src/game/world/lootTables.ts, mapData.ts, materials.test.ts | 3 container + bảng loot vật liệu, `CONTAINERS_ADDED_V5`, test seed/vị trí |
| src/game/systems/save.ts, types/save.ts | Schema v5, `migrateV4`, `seedAddedContainers` |
| src/components/Inventory.tsx, CraftingPanel.tsx, craftText.ts, HUD.tsx | Sửa, chế tạo, tiến trình, lý do |
| src/game/rendering/character/pose.ts, weaponModels.ts | Tư thế làm việc, model gậy gỗ |
| src/components/CharacterCreation.tsx | Ô tên uncontrolled (sửa lỗi S3) |
| scripts/p2-s4-browser.mjs | Kiểm thử S4 dev/production; dev ghi `phase2-s4-v5.json` |
| docs/phase2-s4.md | Quyết định, số liệu, kiểm chứng |

## 5. Bước tiếp theo — P2-S5

1. LOS + `lastSeenPosition/lastSeenTime` (nhớ 20 s); không phát hiện player sau tường kín chưa từng thấy. AI hiện có `lastKnownTarget` và raycast mắt 1,5 m.
2. Tích hợp `nav.findDoorRoute` (spike S1) vào FSM: APPROACH/ATTACK_STRUCTURE, chỉ cửa trên tuyến tới vị trí nhớ; cache theo `nav.version`, không chạy mọi frame/mọi zombie.
3. Door HP (đã có `hp`, `DOOR_MAX_HP` 120) nhận damage công trình 10/1,2 s theo `attackWindup`; tối đa 2 vị trí đánh; vỡ → `setDoorState('destroyed')` (collider + nav đã có). Pose đập dùng lại `attack` của zombie.
4. Mở cửa khi zombie đang lấy đà: hủy mục tiêu, không hit từ xa. Audio bash/break. Lưu HP cửa (đã có trong save; kiểm tra lại) — nếu thêm trạng thái AI mới vào save thì tăng schema v6.
5. Respawn: cấm spawn trong nội thất/collider mới.
6. Khi cửa bị đánh, action nhắm cửa (S6) phải hủy: dùng `cancelAction`/sự kiện; S4 chưa có action nhắm world target.
7. Soak lại (đổi AI) — cổng shelter có thể đổi vì zombie phá cửa nhà an toàn; ghi rõ số liệu mới.

## 6. Giới hạn và việc còn lại

- Chưa deploy thật, đo FPS GPU tích hợp thật hay playtest tay. Draw call tăng ~1,6–1,8× so với capsule (S3).
- Cân bằng: soak patrol chết ở ~12' khi đánh liên tục; lượng vật liệu/băng keo là giá trị khởi điểm. Quyết định ở S8.
- Đinh chỉ mới là loot; recipe dùng búa, refuel, barricade, build thuộc S6–S7. `metal_sheet`, torch, mask, fuel chưa có.
- Route portal S1 là spike; S5 cần cache theo topology revision. Save chưa lưu cooldown/AI timer.
- Warning thư viện: THREE.Clock, Rapier init parameters, Vite advancedChunks deprecated. Audio Safari chưa kiểm chứng iOS thật.
- Trên máy dev có tiến trình khác nghe cổng 5173; các kiểm chứng dùng 5174/5199/9223 và đã tắt.

## 7. Kiểm tra nhanh và nguyên tắc giữ lại

Chạy npm test, npm run build, npm run lint. Soak: `npx vitest run src/game/core/soak.test.ts --reporter=verbose`. Chơi thử `npm run dev`; lab `?lab=doors` (có "Vật liệu thử").

Browser: Playwright không phải dependency; truyền `PLAYWRIGHT_MODULE` (file:// URL) và `CHROMIUM_PATH`, `BASE_URL` nếu không dùng cổng mặc định. Khởi động Vite mới sau khi sửa source. `p2-s4-browser.mjs` (dev) ghi đè `phase2-s4-v5.json`; fixture v1–v4 đóng băng. `p2-smoke.mjs` cần Chromium mở sẵn với `--remote-debugging-port=9223` và profile thử. Ảnh ở node_modules/.tmp (không track). Giữ log đầy đủ khi script fail (race ở script thường do đọc DOM trước khi React render).

Giữ simulation ngoài React; thứ tự tick: input → movement → interaction → AI → combat → **action** → survival/clock → events; pose chạy sau tick qua `CharacterAnimator`; không import Rapier runtime vào simulation. Mọi hành động có thời gian mới (barricade, build, refuel) dùng `startRecipe`/reservation/commit nguyên tử, không trừ gì khi hủy. Giữ layout/ID map và fixture cũ. Tăng schema khi đổi cấu trúc save; không im lặng cắt/mất item. Không đổi balance khi chưa đo; soak sau sửa combat/AI/spawn/survival (cổng: shelter). Không thêm asset ngoài khi chưa ghi nguồn/giấy phép. **Không commit/push; chỉ gợi ý message.**

Commit message gợi ý: **feat(phase2): timed actions, weapon repair, crafting and save v5**
