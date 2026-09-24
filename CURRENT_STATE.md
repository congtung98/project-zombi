# CURRENT_STATE — bàn giao cho phiên làm việc mới

> Cập nhật: **2026-09-24**, hoàn thành **Phase 2 — Sprint P2-S3**.
> Đọc file này, README.md, toàn bộ Zombie_Outbreak_Phase_2_Plan.md và docs/phase2-s1.md, phase2-s2.md, phase2-s3.md.
> **Người dùng tự commit và push mọi thay đổi. Không tự commit/push. Cập nhật CURRENT_STATE cuối mỗi sprint.**

## 1. Trạng thái hiện tại

Phase 1 xong mã cả 6 sprint. Phase 2 xong **S1** (6977c79), **S2** (96c2af6, docs 049c3c4) và **S3** (model/animation/tạo nhân vật, save v4). Sprint kế tiếp là **P2-S4: timed action, crafting và repair**.

Mốc Git trước phiên S3: **049c3c4** (docs: update project status after phase 2 sprint 2), working tree sạch. Thay đổi S3 chưa commit, để người dùng review.

| Sprint | Trạng thái |
|---|---|
| Phase 1 S1–S6 | Xong mã; deploy thật, FPS GPU thật và playtest tay vẫn cần xác nhận |
| P2-S1 Item/save/cửa động | Xong, đã commit |
| P2-S2 Loot/equipment/melee/condition | Xong, đã commit |
| P2-S3 Model/animation/character creation | Xong; 173 test, build/lint, Playwright dev + production qua; **chưa commit** |
| P2-S4 Timed action/craft/repair | Tiếp theo |
| P2-S5 Perception/zombie phá cửa | Chưa làm; dùng kết quả spike S1 |
| P2-S6 Barricade/tool/fuel | Chưa làm |
| P2-S7 Building/thùng/vách/rebuild | Chưa làm |
| P2-S8 Tích hợp/cân bằng/release | Chưa làm |

## 2. S3 đã bàn giao

- **Asset**: rig low-poly dựng bằng code, không file ngoài → không có vấn đề giấy phép. Một rig cho mọi preset và zombie; gốc ở chân, +Z tiến, tay phải −X, `weaponSocket` cuối tay phải (nghiêng 45°). Dùng chung box geometry, material riêng từng nhân vật.
- **Animation** (`rendering/character/pose.ts`, thuần, có test): idle/đi/chạy (pha theo quãng đường), vung (tay quét qua chính diện đúng `hitDelay`), đẩy (từ `pushCooldown`), trúng đòn (`hurtTimer` player mới, chỉ hiển thị; `staggerTimer` zombie), chết (ngã ngửa). Zombie: tay trước, giơ-đập theo `attackWindup` (dùng lại cho bash S5), mắt đỏ khi CHASE/ATTACK, biến thể theo ID. Damage vẫn do combat/AI.
- **Animator sau tick**: view đăng ký callback vào `CharacterAnimator` gắn sau `GameLoop` → pose dùng state của tick hiện tại (trước đây trễ 1 frame). Không đổi thứ tự tick/physics.
- **Vũ khí**: `weaponModels.ts` (4 loại, `WEAPON_GRIPS` offset/rotation), gắn/gỡ theo equipment, hỏng ánh đỏ.
- **Tạo nhân vật**: New Game → màn tạo nhân vật → Bắt đầu → (xác nhận ghi đè nếu có save) → world. Quay lại không đụng save; save chỉ bị xóa sau xác nhận. Tên ≤ 24 (NFC, trim, trống → "Người sống sót"), 3 dáng, 3 tóc, 4 da/áo/quần, Ngẫu nhiên/Mặc định, preview kéo xoay. Tên trên HUD, menu save, game over.
- **Save v4**: `player.name` + `player.appearance` (chỉ ID). v1→v2→v3→v4, v2→…, v3→v4 (mặc định). Backup `slot-1.backup-v3`. Fixture mới `phase2-s3-v4.json` từ Chromium.
- **Sửa lỗi**: ô nhập không gõ được dấu cách (InputManager preventDefault trước khi bỏ qua input); `migrateV2` ghi version 3 cố định.
- **Hook dev**: `window.__renderInfo` (draw call/tam giác/FPS) và `window.__scene`, chỉ ở dev.

## 3. Kiểm chứng cuối sprint

- **npm test: 173/173**, 19 file. **npm run build**, **npm run lint** sạch. Soak shelter/patrol giữ nguyên số liệu S2 (30'/4 kill/30 dmg; 721,9 s/34 kill).
- **Hiệu năng cùng cảnh** (`scripts/p2-render-bench.mjs`, 10 zombie, pixel ratio 1): draw call 147 → **271** (bóng High) / **238** (Low); tam giác 6 180 → 3 180; FPS headless 12→15 (High), 22→19 (Low) — không phải benchmark GPU. Vật đổ bóng đã giới hạn (High: thân/đầu/chân; Low: thân).
- **Playwright/Chromium 151** (`scripts/p2-s3-browser.mjs`): dev — tạo nhân vật bằng input thật, Back giữ save, xác nhận ghi đè, gõ tên có dấu cách, scene 1 rig/nhân vật + `weapon:crowbar` trong socket, yaw tay ≈ 0 ở frame hit, zombie đập/chết nằm ngửa, lưu/reload/Continue giữ ngoại hình, bóng Off vẫn render. Production — luồng tạo/Back/ghi đè/lưu/Continue; PASS 3 lần liên tiếp sau **một lần thất bại không rõ nguyên nhân** (log bị cắt; nghi timeout khi khởi động đồng thời).
- Hồi quy: `p2-s2-browser.mjs` dev + production, `p2-smoke.mjs` (S1) dev + production qua CDP: PASS.

## 4. File/module liên quan

| File | Trách nhiệm |
|---|---|
| src/game/entities/appearance.ts (+ .test) | Lựa chọn ngoại hình, bảng màu, tên, validate, randomize; test runtime/save profile |
| src/game/entities/player.ts | `name`, `appearance`, `hurtTimer`, `CharacterProfile` |
| src/game/rendering/character/rig.ts | Dựng rig, `playerLook`/`zombieLook`, `applyPose`, `setCharacterGlow`, `shadowDetail` |
| src/game/rendering/character/pose.ts | Pose thuần từ state |
| src/game/rendering/character/weaponModels.ts | Model vũ khí + grip |
| src/game/rendering/character/animators.ts, Scene.tsx | Chạy pose sau tick |
| src/game/rendering/character/character.test.ts | Test rig/pose/socket |
| src/game/rendering/PlayerView.tsx, ZombieView.tsx | Collider giữ nguyên, model rig |
| src/components/CharacterCreation.tsx, CharacterPreview.tsx | Màn tạo nhân vật + preview |
| src/stores/uiStore.ts, components/Menus.tsx | Màn `create`, `beginNewGame`, không xóa save sớm |
| src/game/systems/save.ts, types/save.ts | Schema v4, `migrateV3` |
| scripts/p2-s3-browser.mjs, p2-render-bench.mjs | Kiểm thử S3, benchmark cùng cảnh |
| docs/phase2-s3.md | Quyết định asset, animation, hiệu năng, kiểm chứng |

## 5. Bước tiếp theo — P2-S4

1. Thêm `wood_plank`, `scrap_metal`, `duct_tape`, `nails` (stack theo plan §6.1) và loot tương ứng. Bảng loot Phase 1/S2 đã sinh vào save; nội dung mới cho save cũ cần chính sách rõ (thêm container mới hoặc chỉ New Game) → có thể cần schema v5.
2. TimedAction: start → reserve → cancel → commit nguyên tử; hủy khi di chuyển/đánh/trúng đòn/Cancel; pause dừng tiến trình; save không lưu action dở (snapshot trước hoặc sau commit).
3. Recipe data + UI (đủ/thiếu nguyên liệu, tool, output); craft gậy gỗ tự chế (definition mới, maxCondition 40, chỉ số theo tỷ lệ như S2); repair nhóm gỗ/kim loại (+30/+25, chặn max, broken sửa được). Bật nút "Sửa" đang disabled trong thẻ chi tiết.
4. Inventory full tính sau khi tiêu input; tool requirement dùng `isUsableTool` (tool hỏng không đủ điều kiện).
5. Tư thế làm việc: dùng lại rig (tay trước) qua `pose.ts`; hiển thị thanh tiến trình.
6. Test: hoàn tất đúng một lần, hủy không mất đồ, spam/reload không nhân item, save giữa action. Soak lại nếu đổi combat/survival.

## 6. Giới hạn và việc còn lại

- Chưa deploy thật, đo FPS GPU tích hợp thật hay playtest tay. Draw call tăng ~1,6–1,8× so với capsule; nếu nghẽn ở S8 cân nhắc InstancedMesh/gộp geometry.
- Model là khối low-poly, chưa GLB; chưa có tư thế làm việc (S4) và bash riêng (S5).
- Cân bằng: soak patrol chết ở ~12' khi đánh liên tục (xem docs/phase2-s2.md); quyết định ở S8. Chưa repair/craft.
- Script S3 production từng thất bại một lần không rõ lý do; lần sau nên giữ log đầy đủ.
- Route portal S1 là spike; S5 cần cache theo topology revision. Save chưa lưu cooldown/AI timer.
- Warning thư viện: THREE.Clock, Rapier init parameters, Vite advancedChunks deprecated. Audio Safari chưa kiểm chứng iOS thật.
- Trên máy dev có tiến trình khác nghe cổng 5173; các kiểm chứng dùng 5174/5199/9223 và đã tắt.

## 7. Kiểm tra nhanh và nguyên tắc giữ lại

Chạy npm test, npm run build, npm run lint. Soak: `npx vitest run src/game/core/soak.test.ts --reporter=verbose`. Chơi thử `npm run dev`; lab `?lab=doors`.

Browser: Playwright không phải dependency; truyền `PLAYWRIGHT_MODULE` (file:// URL) và `CHROMIUM_PATH`, `BASE_URL` nếu không dùng cổng mặc định. Khởi động Vite mới sau khi sửa source. `p2-s3-browser.mjs` (dev) ghi đè `phase2-s3-v4.json`; các fixture cũ đóng băng. `p2-smoke.mjs` cần Chromium mở sẵn với `--remote-debugging-port=9223` và profile thử. Ảnh ở node_modules/.tmp (không track).

Giữ simulation ngoài React; thứ tự tick hiện có; pose chạy sau tick qua `CharacterAnimator`; không import Rapier runtime vào simulation. Giữ layout/ID map và fixture cũ. Tăng schema khi đổi cấu trúc save; không im lặng cắt/mất item. Không đổi balance khi chưa đo; soak sau sửa combat/AI/spawn/survival (cổng: shelter). Không thêm asset ngoài khi chưa ghi nguồn/giấy phép. **Không commit/push; chỉ gợi ý message.**

Commit message gợi ý: **feat(phase2): character creation, procedural rig and animations, save v4**
