# CURRENT_STATE — bàn giao cho phiên làm việc mới

> Cập nhật: **2026-09-24**, hoàn thành **Phase 2 — Sprint P2-S2**.
> Đọc file này, README.md, toàn bộ Zombie_Outbreak_Phase_2_Plan.md, docs/phase2-s1.md và docs/phase2-s2.md.
> **Người dùng tự commit và push mọi thay đổi. Không tự commit/push. Cập nhật CURRENT_STATE cuối mỗi sprint.**

## 1. Trạng thái hiện tại

Phase 1 xong mã cả 6 sprint. Phase 2 xong **S1** (item/save/cửa động, commit 6977c79 + docs 1944aee) và **S2** (tay không, loot melee, độ bền/hỏng, save v3). Sprint kế tiếp là **P2-S3: model, animation, tạo nhân vật**.

Mốc Git trước phiên S2: **1944aee** (docs: update project status after phase 2 sprint 1), working tree sạch. Toàn bộ thay đổi S2 chưa commit, để người dùng review.

| Sprint | Trạng thái |
|---|---|
| Phase 1 S1–S6 | Xong mã; deploy thật, FPS GPU thật và playtest tay vẫn cần xác nhận |
| P2-S1 Item/save/cửa động | Xong, đã commit |
| P2-S2 Loot/equipment/melee/condition | Xong; 157 test, build/lint, Playwright dev + production qua; **chưa commit** |
| P2-S3 Model/animation/character creation | Tiếp theo |
| P2-S4 Timed action/craft/repair | Chưa làm |
| P2-S5 Perception/zombie phá cửa | Chưa làm; dùng kết quả spike S1 |
| P2-S6 Barricade/tool/fuel | Chưa làm |
| P2-S7 Building/thùng/vách/rebuild | Chưa làm |
| P2-S8 Tích hợp/cân bằng/release | Chưa làm |

## 2. S2 đã bàn giao

- **New Game tay không**: không cấp gậy; click đánh → `player:unarmed` + toast gợi ý; Space đẩy vẫn dùng. Migration v1 vẫn cấp gậy Phase 1 (không đổi).
- **Vũ khí** (`ItemDefinition.melee`, `toolTags`): gậy 25/2,0/1,0 s/12/80 (= `GAME_CONFIG.melee`, baseline Phase 1), ống sắt 28/1,8/1,2/15/120, xà beng 32/1,8/1,25/17/150 (`pry`), búa 18/1,3/0,8/10/100 (`hammer`). Hit timing/góc/knockback dùng chung. Với zombie 50 HP chỉ búa cần 3 đòn.
- **Wear/broken** (`systems/weapons.ts`): damage đọc condition lúc xác nhận hit; >0 đủ damage; 0 → 20% làm tròn, tối thiểu 1. Wear 1 sau khi giải quyết damage, một lần/`attackId` (ledger `lastWornAttackId`), trượt không mất. Broken suy ra từ condition. Sự kiện `weapon:worn/lowCondition/broken`, `item:equipped`. `isUsableTool` sẵn cho S4/S6 (tool hỏng không đủ điều kiện).
- **Loot**: 4 container ID mới — `ct-safehouse-closet` (bảo đảm gậy/ống sắt 60–100%), `ct-store-tools` (bảo đảm búa 50–100% + ống sắt/xà beng hiếm), `ct-house-nightstand` (băng/snack/gậy hiếm), `ct-park-toolbox` (ống/xà beng/búa 25–80%, gần spawn). Condition gieo một lần theo seed, không sinh đồ hỏng. Bảng/ID 7 container Phase 1 không đổi (test đối chiếu fixture v1).
- **Save v3**: v1→v2→v3 hoặc v2→v3, thuần/không mutate; thêm container mới bằng loot seed như New Game, không reroll tủ cũ, thứ tự khớp snapshot. `commitMigratedSave(original, save, slot)` backup `slot.backup-v<gốc>` cùng transaction (trước chỉ cố định slot-1). Toast theo `fromVersion`.
- **UI**: túi đồ click trái → thẻ chi tiết (Trang bị/Dùng, Cất vào tủ, Thả xuống, Sửa disabled); chuột phải dùng/trang bị nhanh; Shift+trái cất nhanh. Ô có thanh độ bền, tag HỎNG, badge E. HUD hiện vũ khí + độ bền (vàng/đỏ) hoặc "Tay không". Toast có tone. Âm `weaponBreak`. Model tạm theo loại vũ khí, hỏng ánh đỏ. Hướng dẫn/menu cập nhật. Lab có "Bộ vũ khí thử".

## 3. Kiểm chứng cuối sprint

- **npm test: 157/157**, 17 file. **npm run build** (gồm tsc -b) và **npm run lint** sạch.
- **Soak** (seed 20260924), hai chính sách:
  - *shelter* (cổng): 30' sống, 11/11 tủ, vũ khí đầu ở giây 0,2, 4 kill/4 spawn, 30 dmg, minHealth 70, 8 hit → wear 8, 29 snapshot round-trip; dùng 4 nước/3 đồ hộp.
  - *patrol* (chỉ số liệu): chết ở 12,0', 34 kill, 180 dmg, 69 hit → wear 69, 1 lần hỏng rồi đổi sang xà beng.
  - **Phát hiện**: bot soak Phase 1/S1 đứng ~1545/1800 s trong một ô ngoài cửa nhà an toàn (kẹt góc). Bot cũ + nội dung S2 + gậy sẵn/tắt wear tái lập đúng 30'/11 kill/60 dmg; bot sửa di chuyển chết ở 10,8' kể cả nội dung Phase 1. Không đổi balance; chuyển cho S8. Chi tiết `docs/phase2-s2.md`.
- **Playwright/Chromium 151 headless 1280×800, context riêng** (`scripts/p2-s2-browser.mjs`): dev — input thật loot/trang bị, chuột thật đánh: 28 dmg 78→77; condition 1 → 28 rồi HỎNG; đòn sau 6; thả/nhặt/trang bị lại; lưu → reload → Continue giữ 0/120 HỎNG và túi rơi ống 33; Continue fixture v2 và v1 → backup `-v2`/`-v1` bằng bản gốc, v3 đủ 11 container; lab kit. Production — không `__runtime`, không lab, luồng tay không → tủ → trang bị → lưu → reload → Continue. Không lỗi console/page.
- **Hồi quy S1** (`scripts/p2-smoke.mjs` qua CDP tới Chromium của Playwright, dev + production): migration v1, backup, schema 99, xung đột transaction, túi đầy, cửa/raycast/nav, slot-lab. PASS.
- Fixture mới `phase2-s2-v3.json` xuất từ save thật trong Chromium (ống sắt hỏng đang cầm giữ ID từ tủ, túi rơi ống 33). `phase2-s1-v2.json` đóng băng, script S1 không còn ghi đè.

## 4. File/module liên quan

| File | Trách nhiệm |
|---|---|
| src/game/entities/items.ts | Definitions + `melee`/`toolTags`, 4 vũ khí |
| src/game/systems/weapons.ts (+ .test) | Damage theo condition, wear/attackId, level, tool requirement; test loot 400 seed |
| src/game/systems/combat.ts, entities/player.ts | `startAttack` theo chỉ số vũ khí, `attackId`/`attackWeaponId`/`lastWornAttackId` |
| src/game/core/runtime.ts | Bỏ grant gậy, unarmed, resolve melee theo vũ khí + wear, sự kiện |
| src/game/core/melee.test.ts | Runtime: tay không, wear, broken, chỉ số, reload |
| src/game/systems/loot.ts, world/lootTables.ts, world/mapData.ts | Condition range, `oneOf`, 4 bảng + container mới, `CONTAINERS_ADDED_V3` |
| src/game/systems/save.ts, saveStorage.ts, types/save.ts | Schema v3, migrate v2→v3, `fromVersion`, backup theo slot/phiên bản |
| src/components/Inventory.tsx, HUD.tsx, stores/hudStore.ts, app/App.tsx | Thẻ chi tiết, thanh độ bền, HUD vũ khí, toast/âm thanh |
| src/game/rendering/PlayerView.tsx | Model tạm theo loại vũ khí |
| src/game/core/soak.test.ts | `runSoak('shelter' | 'patrol')`, bot né góc, đổi vũ khí hỏng |
| scripts/p2-s2-browser.mjs | Playwright dev/production, xuất fixture v3 |
| scripts/p2-smoke.mjs | Hồi quy S1 qua CDP (đã cập nhật v3, không ghi fixture S1) |
| docs/phase2-s2.md | Quyết định, bảng chỉ số, phát hiện soak, cách tái lập |

## 5. Bước tiếp theo — P2-S3

1. Kiểm tra quyền dùng asset (ghi nguồn/giấy phép trước khi thêm), rig, scale; một player + một zombie trước.
2. Gắn model vào controller hiện có; collider độc lập bộ xương. `weaponSocket` tay phải; offset/rotation từng melee (4 loại hiện có) trong cấu hình, thay mesh tạm ở `PlayerView.WeaponModel`.
3. Hit timing vẫn do `tickPlayerCombat`/`hitDelay`; animation theo `attackTimer`, không phát damage lần hai khi loop/crossfade; animation chết không gây damage.
4. `CharacterAppearance` (preset, tóc, màu da/áo/quần), UI preview kéo xoay, Randomize/Reset; New Game → Character Creation → xác nhận; Back không xóa save; Continue đọc appearance từ save.
5. Appearance vào save → **schema v4** + migration v3→v4 (ngoại hình mặc định), fixture mới; giữ fixture v1/v2/v3.
6. Đo cùng số zombie/camera/settings như baseline trước/sau model (ghi rõ headless không phải benchmark GPU).

## 6. Giới hạn và việc còn lại

- Chưa deploy thật, đo FPS GPU tích hợp thật hay playtest tay 15–30 phút.
- Chưa repair/craft (S4): nút Sửa disabled; vũ khí hỏng chỉ thay bằng món khác. Chưa có vật liệu, fuel, đánh công trình trừ 2 condition.
- Cân bằng: soak patrol cho thấy đánh liên tục chết ở ~11–14' (không hồi máu tự nhiên, spawn bù mỗi 12–25 s). Cần quyết định ở S8 bằng playtest người thật; không đổi config khi chưa đo.
- Damage 28/32 của ống sắt/xà beng không giảm số đòn hạ zombie 50 HP so với gậy; vai trò hiện là độ bền/tốc độ/stamina. Xem lại ở S8 nếu cần.
- Route portal S1 là spike; tích hợp S5 cần cache theo topology revision. Chi phí phá cửa tạm 12.
- Save chưa lưu cooldown/AI timer; `attackId` reset sau load (không ảnh hưởng wear vì không có cú vung dở qua save).
- Warning thư viện: THREE.Clock, Rapier init parameters, Vite advancedChunks deprecated.
- Container có collider nhưng không trong nav grid (như Phase 1); góc hẹp/chen zombie cần playtest tay. Audio Safari chưa kiểm chứng iOS thật.
- Một tiến trình khác đang nghe cổng 5173 trên máy dev trong phiên S2 (không phải của phiên); các kiểm chứng dùng 5174/5199/9223 và đã tắt sau khi chạy.

## 7. Kiểm tra nhanh và nguyên tắc giữ lại

Chạy npm test, npm run build, npm run lint. Số liệu soak: `npx vitest run src/game/core/soak.test.ts --reporter=verbose`. Chơi thử `npm run dev`; lab `?lab=doors`.

Browser: xem mục "Tái lập browser check" trong docs/phase2-s2.md. Playwright không phải dependency: cài tạm ngoài repo, truyền `PLAYWRIGHT_MODULE` (file:// URL) và `CHROMIUM_PATH`. Khởi động Vite mới sau khi sửa source. Chế độ dev của `p2-s2-browser.mjs` ghi đè `phase2-s2-v3.json`. Ảnh chụp ở node_modules/.tmp (không track).

Giữ simulation ngoài React; thứ tự tick hiện có; không import Rapier runtime vào simulation. Giữ layout/ID map và fixture cũ. Tăng schema khi đổi cấu trúc save; không im lặng cắt/mất item. Không đổi balance khi chưa đo; chạy soak sau sửa combat/AI/spawn/survival (cổng là chính sách shelter; patrol chỉ báo cáo). Không thêm asset ngoài khi chưa ghi nguồn/giấy phép. **Không commit/push; chỉ gợi ý message.**

Commit message gợi ý: **feat(phase2): unarmed start, melee loot, weapon condition and save v3**
