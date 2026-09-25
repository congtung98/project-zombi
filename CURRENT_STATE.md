# CURRENT_STATE — bàn giao cho phiên làm việc mới

> Cập nhật: **2026-09-25**, hoàn thành **sprint bổ sung "tầm nhìn người chơi"** (sau P2-S5, trước P2-S6).
> Đọc file này, README.md, toàn bộ Zombie_Outbreak_Phase_2_Plan.md, docs/phase2-s1.md … phase2-s5.md và docs/phase2-vision.md.
> **Người dùng tự commit và push mọi thay đổi. Không tự commit/push. Cập nhật CURRENT_STATE cuối mỗi sprint.**

## 1. Trạng thái hiện tại

Phase 1 xong mã cả 6 sprint. Phase 2 xong **S1–S5** (đã commit, S5 = 1f81571) và **sprint bổ sung tầm nhìn người chơi** (zombie chỉ vẽ khi nhân vật thấy; lớp tối mặt đất; debug F4; save vẫn v6). Sprint kế tiếp là **P2-S6: barricade gỗ/kim loại, tool/fuel**.

Mốc Git trước phiên tầm nhìn: **1f81571**, working tree sạch. Thay đổi tầm nhìn chưa commit, để người dùng review. File yêu cầu `Prompt triển khai hệ thống tầm nhìn người chơi kiểu Project Zomboid.md` ở gốc repo chưa track (người dùng quyết định có commit hay không).

| Sprint | Trạng thái |
|---|---|
| Phase 1 S1–S6 | Xong mã; deploy thật, FPS GPU thật và playtest tay vẫn cần xác nhận |
| P2-S1 … P2-S4 | Xong, đã commit |
| P2-S5 Perception/lang thang/di cư/phá cửa | Xong, đã commit (1f81571) |
| Bổ sung: tầm nhìn người chơi | Xong; 288 test, build/lint, soak không đổi, Playwright dev + production qua; **chưa commit** |
| P2-S6 Barricade/tool/fuel | Tiếp theo; dùng TimedAction + tool requirement S4, hook `worldTargetId` S5 |
| P2-S7 Building/thùng/vách/rebuild | Chưa làm |
| P2-S8 Tích hợp/cân bằng/release | Chưa làm |

## 2. Sprint tầm nhìn đã bàn giao (chi tiết docs/phase2-vision.md)

- `PlayerVisionSystem` (`systems/playerVision.ts`) chạy **cuối tick** (sau di cư), 20 lượt/s: ứng viên từ `runtime.getNearbyZombies` → khoảng cách 20 m → bán kính gần 2,5 m (bỏ qua hình quạt, **vẫn cần LOS**; `nearDetectionThroughWalls` để đổi) → hình quạt 110° theo `player.facing` (dot product) → LOS mắt 1,6 m tới thân 1,2 m. Tối đa 48 raycast/lượt, cũ nhất trước. Grace 0,15 s, fade 0,2 s trong tick.
- Trạng thái ở `runtime.vision.states` (`isVisibleToPlayer`, `reason`, `opacity`), **không** trong `ZombieState`, không lưu. AI không đọc. Test chứng minh simulation giống hệt khi tắt vision.
- Vật chắn riêng `runtime.visionOccluders` (`world/visionOccluders.ts`, AABB, không Rapier): tường có đỉnh ≥ 1,5 m (kể cả lanh tô, biên, cột), tủ/kệ cao, lá cửa khi đóng (đọc `world.doors` lúc truy vấn). Hàng rào/thùng/xe/giường/quầy không chặn. `createWindowOccluder` (rèm) và `add/remove` sẵn cho cửa sổ/barricade/vách sau này.
- Render: `ZombieView` đọc `runtime.vision.opacity(id)` (ẩn = không vẽ, không bóng, bỏ pose); `VisionMask.tsx` làm tối mặt đất ngoài vùng thấy bằng stencil (Canvas `stencil: true`, setting "Vùng tối ngoài tầm nhìn"); `PlayerVisionDebug.tsx` (F4 / `?vision=debug` / `playerVision.debug`). F3 thêm thống kê + `nhìn=` từng zombie.
- Config `GAME_CONFIG.playerVision` (= `PLAYER_VISION_CONFIG`).

## 2b. S5 đã bàn giao (đã commit)

- **Cảm nhận**: zombie chưa phát hiện nhìn hình nón ±70°/10 m (hoặc mọi hướng trong 1,2 m); đang săn nhìn mọi hướng 14 m. **Nghe bước chân** bán kính cố định: đi 5 m, chạy 12 m, đứng yên im lặng; qua tường × 0,5. Trí nhớ `lastKnownTarget/memoryAge/memorySource` 20 s (thay timeout SEARCH 8 s). Bị đánh khi chưa phát hiện → tìm hướng đòn.
- **Lang thang**: IDLE nghỉ 3–8 s → WANDER tới điểm ngẫu nhiên đi được, cùng vùng liên thông, ngoài trời, trong vùng (0,9 m/s) → nghỉ → điểm mới.
- **Di cư**: 8 `zombieZones` trên map khu phố; director mỗi 90–180 s chuyển cả nhóm của một vùng (≥ 2 con đang nghỉ/lang thang) sang vùng khác ưu tiên vùng vắng; con rảnh chuyển MIGRATE (1,4 m/s), con đang săn giữ săn. Seed theo ván + bộ đếm, lưu trong save.
- **Phá cửa**: `findDoorRoute` trên nhãn vùng liên thông (cache theo `nav.version`); APPROACH_STRUCTURE → ATTACK_STRUCTURE, 10 dmg/1,2 s, 2 slot mỗi phía cửa, hàng chờ 2,4 m, runtime kiểm tra lại cửa còn đóng + trong tầm mỗi đòn; mở cửa lúc lấy đà hủy đòn; vây tối đa 60 s từ thông tin mới nhất; vỡ → collider/nav/`door:destroyed` → SEARCH vị trí nhớ. `findPath` trả null ngay khi khác vùng liên thông (không còn A* loang).
- **Phản hồi**: âm đập/vỡ cửa giảm theo khoảng cách, cửa rung + sẫm theo HP, prompt "(độ bền x/120)", toast cửa vỡ, mắt đỏ khi vây cửa, F3 hiện vùng/trí nhớ/cửa đang đập, bán kính bước chân, giờ di cư. Hướng dẫn trong game cập nhật. Lab `?lab=doors` hiện HP cửa + trạng thái zombie.
- **Respawn** cấm điểm trong nhà và ô không đi được (`pickSpawnPoint.isAllowed`).
- **Feedback 25/09 — animation + bước chân**: chân người chơi/zombie không còn phụ thuộc FPS (tốc độ lọc 0,12 s, pha tích phân; `rendering/character/gait.ts`), sải dài hơn (`config.player.walkStride/runStride` 2,2/3,2 m, zombie 1,6 m), zombie quay mượt. Tiếng bước chân `player:footstep` phát mỗi nửa sải **chỉ khi zombie nghe được** (`playerNoise` > 0), âm `stepWalk`/`stepRun`.
- **Hook S6**: `TimedAction.worldTargetId` — cửa trúng đòn hủy action nhắm nó (`target-damaged`), không trừ gì.
- **Save v6**: zombie thêm `memoryAge/memorySource/zoneId/structureTargetId`, save thêm `horde {timer, counter}`; migrate v5 → v6 (vùng gần nhất, không vây, timer 90), backup `slot-1.backup-v5`. Fixture `phase2-s5-v6.json` (Chromium, lưu giữa lúc đang đập cửa); `phase2-s4-v5.json` đóng băng.

## 3. Kiểm chứng cuối sprint

**Sprint tầm nhìn (25/09)**: npm test **288/288** (29 file; mới `systems/playerVision.test.ts` 18, `core/vision.test.ts` 4), build/lint sạch. Soak **không đổi** so với S5 (shelter 30'/4 kill/30 dmg/cửa vỡ giây 61; patrol 853 s/30 kill). Hiệu năng Node: 500 zombie 0,095 ms/lượt, đường viền mask 0,047 ms. Playwright/Chrome 153 `scripts/p2-vision-browser.mjs` dev (trước/sau/sát lưng, quay bằng phím thật, cửa đóng/mở, zombie ẩn vẫn đập cửa, bật/tắt mask) + production (F3/F4, không lỗi) PASS; hồi quy production p2-s5, p2-s4 PASS.

**S5 (24/09)**:

- **npm test: 266/266**, 27 file (gồm `gait.test.ts`, `footsteps.test.ts`). **npm run build**, **npm run lint** sạch.
- Soak (lộ trình không đổi): shelter **sống 30'**, 4 kill, 30 dmg, **cửa nhà an toàn bị phá ở giây 61** (zombie nghe/thấy bot chạy về), 12 lần di cư; patrol chết ở **853 s** (trước 721,9 s), 30 kill. Bất biến ≤ 2 zombie đập mỗi phía cửa.
- Playwright/Chrome 153 (`scripts/p2-s5-browser.mjs`): dev 3/3 (lang thang, bước chân bằng phím thật, E mở/đóng cửa, đập cửa với Rapier thật, lưu giữa vây → reload → Continue → vỡ → vào nhà → đánh, ghi fixture v6); production 4/4. Hồi quy p2-s2/s3/s4 dev + production, p2-smoke dev + production: PASS (schema 6).
- **3 test interaction lỗi sẵn trên HEAD** (commit S4 đổi `INTERACT_RANGE` 2 → 1 m) đã sửa vị trí vật trong test; script S4 thêm bước lùi vào phòng vì cùng nguyên nhân. Hằng số không đổi.

## 4. File/module liên quan

| File | Trách nhiệm |
|---|---|
| src/game/systems/ai.ts (+ ai.test, perception.test) | FSM, `perceive` (nón nhìn + nghe), trí nhớ, lang thang/MIGRATE, vây cửa, `moveTowards` báo `blocked` |
| src/game/entities/zombie.ts | Trường trí nhớ, lang thang, vùng, cửa mục tiêu; `UNAWARE_STATES` |
| src/game/systems/horde.ts (+ horde.test) | `nearestZone`, `planMigration`, `migrationInterval` thuần |
| src/game/world/navigation.ts | `componentAt` (nhãn vùng cache theo revision), `findDoorRoute` mới, `portals` có `center/sides/slots` |
| src/game/world/mapData.ts | `ZoneDef`, `zombieZones` map khu phố |
| src/game/core/runtime.ts | `playerNoise`, ngữ cảnh AI (route/slot/cửa/điểm lang thang), `stepStructureHits`, `stepHorde`, lọc respawn, snapshot/load v6 |
| src/game/core/siege.test.ts | Nghiệm thu runtime S5 (body giả trên lưới) |
| src/game/core/config.ts | `zombie.*` (nón, trí nhớ, lang thang), `hearing`, `structure`, `horde` |
| src/game/systems/save.ts, types/save.ts | Schema v6, `migrateV5`, `isZombieV6` |
| src/game/rendering/DoorView.tsx, ZombieView.tsx, audio/sfx.ts, app/App.tsx | Rung/sẫm cửa, mắt đỏ, `doorBash/doorBreak` theo khoảng cách, toast |
| src/components/HUD.tsx, stores/hudStore.ts, DoorLab.tsx, Settings.tsx | F3, lab, hướng dẫn |
| scripts/p2-s5-browser.mjs | Kiểm thử S5 dev/production; dev ghi `phase2-s5-v6.json` |
| src/game/rendering/character/gait.ts (+ test), core/footsteps.test.ts, scripts/p2-s5-gait.mjs | Gait độc lập FPS, nhịp/âm bước chân |
| docs/phase2-s5.md | Quyết định, số liệu, kiểm chứng |

## 5. Bước tiếp theo — P2-S6

0. Barricade/vách mới phải chặn tầm nhìn người chơi: thêm occluder vào `runtime.visionOccluders` (`isBlocking` đọc trạng thái) — không sửa `PlayerVisionSystem`.
1. Barricade trên `DoorState` (gỗ 1–3 ván, kim loại); `stepStructureHits` trừ barricade trước, phần dư vào cửa (plan §9.3). Cửa barricade không mở được.
2. Action nhắm cửa: `startRecipe` với `worldTargetId = doorId` (hook đã có), kiểm tra khoảng cách tới cửa, cooldown 3 s sau lần cửa trúng đòn.
3. Items `metal_sheet`, `welding_torch` (fuel), `welder_mask`, `fuel_canister`; refuel là recipe có thời gian. Búa đã là tool (`isUsableTool`).
4. Save v7 cho barricade/fuel; migrate v6 → v7; fixture mới; giữ `phase2-s5-v6.json` đóng băng (script S5 đang ghi đè nó — tắt ghi khi đổi schema).
5. Cân bằng thời gian trụ cửa với 1–2 zombie; soak shelter hiện mất cửa ở giây 61 — cân nhắc cho bot gia cố/sửa cửa khi có S6/S7.

## 6. Giới hạn và việc còn lại

- Tầm nhìn: lớp tối chỉ phủ mặt đất (tường/đồ vật ngoài tầm vẫn sáng), chưa có vùng "đã khám phá", mép stencil cứng; một tia LOS/zombie; tầm nhìn không giảm ban đêm; chưa spatial hash (điểm thay: `getNearbyZombies`). Giá trị 2,5/20 m/110° là khởi điểm, chưa playtest tay.

- Chưa deploy thật, đo FPS GPU tích hợp thật hay playtest tay. Draw call tăng ~1,6–1,8× so với capsule (S3).
- Cân bằng S5 (nón 70°, nghe 5/12 m, di cư 90–180 s) là giá trị khởi điểm. Nghe chưa có sai số; tiếng đánh/đập cửa chưa thu hút zombie.
- Cửa vỡ chưa lắp lại được (S7); nhà an toàn có thể mất cửa sớm.
- Chi phí phá cửa 12 m/cạnh đi bộ đường thẳng là ước lượng; đủ cho map hiện tại.
- Warning thư viện: THREE.Clock, Rapier init parameters, Vite advancedChunks deprecated. Audio Safari chưa kiểm chứng iOS thật.

## 7. Kiểm tra nhanh và nguyên tắc giữ lại

**Môi trường**: repo cần Node ≥ 20 (Vitest/Rolldown dùng `node:util.styleText`). Máy dev hiện chỉ có Node 18.12 trên PATH; S5 dùng Node 22.20 portable ngoài repo. `node_modules` từng thiếu binding Windows của rolldown/oxlint (lỗi optional deps của npm) — đã giải nén đúng phiên bản trong lockfile; nếu tái cài thì `npm ci` bằng Node ≥ 20.

Chạy npm test, npm run build, npm run lint. Lưu ý: `npm run` bằng npm 10 từng ghi đè trường `license` trong package-lock.json (đã hoàn tác); có thể gọi thẳng `node node_modules/vitest/vitest.mjs run`, `node node_modules/vite/bin/vite.js build`, `./node_modules/.bin/oxlint`. Soak: `npx vitest run src/game/core/soak.test.ts --reporter=verbose` (in thêm `sightAlerts/noiseAlerts/sieges/doorHits/doorsDestroyed/migrations`). Chơi thử `npm run dev`; F3 xem trạng thái/vùng/trí nhớ zombie; lab `?lab=doors` (mở cửa cho zombie thấy, đóng lại, xem HP cửa).

Browser: Playwright không phải dependency; truyền `PLAYWRIGHT_MODULE` (file:// URL, ví dụ npx cache `playwright@1.64`) và `CHROMIUM_PATH` (Chrome cài sẵn), `BASE_URL`. Khởi động Vite mới sau khi sửa source. `p2-s5-browser.mjs` (dev) ghi đè `phase2-s5-v6.json`; fixture v1–v5 đóng băng. `p2-vision-browser.mjs` (dev/`--production`) không ghi fixture. `p2-smoke.mjs` cần Chrome headless mở sẵn với `--remote-debugging-port=9223` và profile thử riêng. Ảnh ở node_modules/.tmp (không track).

Giữ simulation ngoài React; thứ tự tick: input → movement (tính tiếng bước chân) → interaction → AI → combat → **đòn vào công trình** → action → survival/clock → spawn → **di cư** → **tầm nhìn người chơi (chỉ render, AI không đọc)** → events; pose chạy sau tick qua `CharacterAnimator`; không import Rapier runtime vào simulation. AI chỉ biết vị trí người chơi qua nhìn/nghe/trí nhớ. Mọi hành động có thời gian mới dùng `startRecipe`/reservation/commit nguyên tử. Giữ layout/ID map, ID vùng và fixture cũ. Tăng schema khi đổi cấu trúc save. Không đổi balance khi chưa đo; soak sau sửa combat/AI/spawn/survival. **Không commit/push; chỉ gợi ý message.**

Commit message gợi ý: **feat(phase2): player vision cone, line of sight and zombie fade with ground mask**
