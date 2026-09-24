# CURRENT_STATE — bàn giao cho phiên làm việc mới

> Cập nhật: 2026-09-24, sau khi hoàn thành **Sprint 5** (Sprint 4 và 5 đều **chưa commit**; commit gần nhất vẫn là `77b3139 docs: update project state after phase 1 sprint 3`).
> Đọc file này trước, rồi `README.md` (tổng quan + điều khiển) và `Zombie_Outbreak_Phase_1_MVP.md` (kế hoạch 8 tuần, tiếng Việt).
> Người dùng giao việc theo sprint của kế hoạch: "tiếp tục sprint N" nghĩa là **Sprint N** trong kế hoạch.

## 1. Phase hiện tại

Phase 1 (MVP), **Sprint 5 đã xong**. Bước tiếp theo là **Sprint 6: hoàn thiện và phát hành** (playtest 15–30 phút, cân bằng, audio/feedback, settings, đo FPS, build + deploy, kiểm tra save/reload trên bản deploy).

| Sprint | Trạng thái | Commit |
|---|---|---|
| 1 Nền tảng và prototype | Xong | `fa5904b` |
| 2 Khu phố và tương tác | Xong | `5ce1fa5` |
| 3 AI và chiến đấu | Xong | `8c55bce` |
| 4 Survival, inventory, loot | Xong (2026-09-24) | chưa commit |
| 5 Clock/spawn/save (IndexedDB) | Xong (2026-09-24) | chưa commit |
| 6 Hoàn thiện và phát hành | Chưa | |

Kiểm chứng ở cuối Sprint 5: `npm test` 112/112 pass, `npx tsc -b` sạch, `npm run lint` (oxlint) sạch không cảnh báo, `npm run build` thành công, playtest headless 24/24 kiểm tra pass, không lỗi console.

Gợi ý commit (chỉ khi người dùng yêu cầu): có thể tách hai commit theo sprint bằng `git add` từng nhóm file (§3), hoặc một commit `phase4-5: inventory, loot, day/night, spawn and save`. Attribution ở §8.

## 2. Những gì đã hoàn thành

**Sprint 1–3.** Nền tảng Vite/React/R3F/Rapier, runtime tick cố định, bản đồ 50×50 với 3 công trình, cửa/container, tương tác E, NavGrid A*, FSM zombie (IDLE/CHASE/SEARCH/ATTACK/DEAD), combat gậy + đẩy, feedback. Chi tiết trong README.

**Sprint 4.** Vật phẩm (`entities/items.ts`), inventory dùng chung túi 12 ô/tủ 8 ô (`systems/inventory.ts`), loot theo seed sinh một lần lúc New Game (`systems/loot.ts`, `world/lootTables.ts`), dùng vật phẩm chỉ trừ khi có tác dụng (`consumeInventoryItem`), panel túi/tủ (`components/Inventory.tsx`, `ContainerPanel.tsx`, `stores/inventoryStore.ts`), phím I, Esc đóng UI trước rồi mới pause, `uiOpen` chặn đánh/đẩy.

**Sprint 5 (phiên này).**
- **Ngày/đêm** `rendering/daylight.ts` (hàm thuần `daylightAt(t)` 0..1, smoothstep quanh `clock.nightEnd`/`nightStart` với `lighting.twilight`) + `rendering/Lights.tsx` (ambient/hemisphere/sun và `<color attach="background">` nội suy trong `useFrame`; GameCanvas không còn màu nền tĩnh). `GameClock.isNight` đọc mốc từ config; thêm `clock.restore()`.
- **Spawn có giới hạn** `systems/spawn.ts` (`pickSpawnPoint` thuần: lọc cách người chơi ≥ `spawn.minDistance`, không chồng zombie sống, ưu tiên điểm bị che theo raycast; `spawnInterval` ngày/đêm) + `runtime.stepSpawn` (chạy sau `stepSurvival`, trước `clock.advance`): dọn xác sau `corpseLifetime`, không spawn khi người chơi chết, chỉ khi số sống < `maxActive`, RNG = `createRng(hashSeed(seed, 'spawn:' + spawnCounter))`. Sự kiện `zombie:spawned`/`zombie:removed` → `worldStore.zombieIds` → `Scene` thêm/gỡ `ZombieView`.
- **Save schema** `types/save.ts` (`SAVE_SCHEMA_VERSION = 1`, `SaveGame`, `SaveSummary`). `runtime.createSnapshot()` (dữ liệu thuần, chỉ zombie sống, `spawn: {nextZombieId, timer, counter}`) và `runtime.loadSnapshot(save)` (= `newGame(seed)` rồi ghi đè: không tạo zombie từ điểm spawn, `items` container lấy từ bản lưu, cửa mở cập nhật `nav`, kẹp chỉ số, `fitInventory` về đúng số ô; `nextZombieId` = max(bản lưu, ID lớn nhất + 1)). `PlayerView` lấy vị trí ban đầu từ `runtime.player.position` nên Scene remount theo `sessionId` là đủ để đặt body.
- **Validate** `systems/save.ts`: `validateSaveGame(data, mapId)` trả `incompatible` (schema khác), `wrong-map`, `corrupt` (thiếu trường, NaN, item lạ, AI lạ, ID zombie trùng); `summarizeSave` cho menu.
- **IndexedDB** `systems/saveStorage.ts`: DB `zombie-outbreak`, store `saves`, slot `slot-1`; mỗi thao tác một transaction, trả `StorageResult` (quota/chặn/không hỗ trợ → thông báo). Không có test node cho phần này (kiểm ở playtest trình duyệt).
- **UI/flow** `stores/uiStore.ts`: `saveSlot` (`unknown|empty|ready|incompatible|corrupt|error`), `refreshSaveSlot`, `continueGame` (đọc → validate → `loadSnapshot` → `enterSession`), `saveGame(label)` (snapshot đồng bộ rồi ghi async, toast), `discardSave`, `gameOver` xóa save, `toMenu` làm mới slot. `worldStore.syncFromRuntime` chụp cửa/container/zombie khi vào ván. `GameLoop`: sau `runtime.tick`, `consumeAutosave()` → `saveGame('Đã tự động lưu.')` (mỗi `save.autosaveInterval` = 60 s, chỉ khi còn sống). `Menus.tsx`: Continue + tóm tắt bản lưu, cảnh báo không tương thích/hỏng, New Game hỏi xác nhận khi có dữ liệu và xóa slot; Pause có Lưu game / Lưu và về menu / Về menu (không lưu); Game over báo save đã xóa. HUD debug đếm zombie sống/tổng.
- **Config mới**: `clock.nightEnd/nightStart`, `lighting.*`, `spawn.*`, `save.autosaveInterval`. Sau ảnh chụp headless, mức sáng ban đêm được nâng (ambient 0.3, hemisphere 0.22, sun 0.3) vì bản đầu quá tối.
- **Test mới**: `spawn.test.ts` (5), `save.test.ts` (13: round-trip đầy đủ qua JSON và load 3 lần không nhân đôi, không lưu xác + ID duy nhất sau load, kẹp/fit, validate các kiểu lỗi, spawn trong runtime, dọn xác, không spawn khi chết, autosave đúng nhịp, daylight).

## 3. File đã thay đổi (chưa commit)

Sprint 4 — mới: `src/game/entities/items.ts`, `src/game/systems/inventory.ts` (+test), `src/game/systems/loot.ts` (+test), `src/game/world/lootTables.ts`, `src/stores/inventoryStore.ts`, `src/components/Inventory.tsx`, `src/components/ContainerPanel.tsx`. Sửa: `config.ts`, `events.ts`, `runtime.ts`, `entities/player.ts`, `systems/survival.ts` (+test), `world/buildings.ts`, `world/mapData.ts`, `world/worldState.ts`, `stores/uiStore.ts`, `stores/hudStore.ts`, `components/HUD.tsx`, `components/Menus.tsx`, `app/App.tsx`, `index.css`, `runtime.test.ts`.

Sprint 5 — mới: `src/types/save.ts`, `src/game/systems/spawn.ts` (+test), `src/game/systems/save.ts` (+test), `src/game/systems/saveStorage.ts`, `src/game/rendering/daylight.ts`. Sửa: `config.ts`, `events.ts`, `clock.ts`, `runtime.ts`, `rendering/Lights.tsx`, `rendering/Scene.tsx`, `rendering/PlayerView.tsx`, `rendering/GameLoop.tsx`, `app/GameCanvas.tsx`, `app/App.tsx`, `stores/worldStore.ts`, `stores/uiStore.ts` (viết lại), `components/Menus.tsx` (viết lại), `components/HUD.tsx`, `index.css`, `README.md`, file này.

## 4. Kiến trúc hiện tại

```text
src/
  app/                 App (nối event runtime → store, phím I/Esc), GameCanvas (Scene key = sessionId)
  game/core/           config, clock (ngày/đêm, restore), events, runtime (tick, API inventory, spawn, snapshot/load)
  game/entities/       player (có inventory), zombie, items
  game/systems/        input, movement, ai, combat, survival, interaction, inventory, loot, spawn, save (validate), saveStorage (IndexedDB)
  game/world/          buildings, mapData, worldState (cửa/container + loot), lootTables, navigation
  game/rendering/      Scene, CameraRig, CursorProbe, Ground, Roads, Walls, BuildingView, DoorView, ContainerView,
                       PlayerView, ZombieView, Lights + daylight, OcclusionFader, PhysicsBridge, GameLoop, blockerData
  components/          HUD, Menus (save/continue), Inventory, ContainerPanel
  stores/              uiStore (màn hình + save flow), hudStore, worldStore (mirror cửa/container/zombieIds), inventoryStore
  types/               index (Vec3, EntityId, ZombieAIState), save (schema)
```

Luồng một tick: `stepPlayerMovement` → `stepInteraction` → `stepZombies` → `stepCombat` → `stepSurvival` → **`stepSpawn`** → `clock.advance` → `events.flush` → `input.endFrame` → đếm ngược autosave (bật `autosaveDue`). Game loop: `tick` rồi `consumeAutosave()` → snapshot ngay tại ranh giới tick.

Ranh giới quan trọng (không đổi): simulation không nằm trong React state; simulation không import Rapier (`PhysicsQuery`, `register*`); AI nhận context; NavGrid không dùng physics; ID ổn định; loot chỉ sinh trong `newGame(seed)`; snapshot chỉ chụp giữa hai tick.

## 5. Quyết định quan trọng và lý do (Sprint 5)

- **Một slot save, chết là xóa save.** Kế hoạch yêu cầu New Game "xử lý rõ việc ghi đè": menu hỏi xác nhận và xóa slot ngay; game over xóa slot để Continue không hồi sinh. Nếu người dùng muốn "load lại trước khi chết", cần thêm slot hoặc bỏ xóa khi chết (đổi trong `uiStore.gameOver`).
- **Autosave 60 s + lưu thủ công ở pause.** Autosave chụp ngay sau `tick` trong `GameLoop` (cùng luồng JS, không có tick xen giữa) nên đúng "snapshot ở ranh giới tick". Lưu thủ công khi pause cũng thỏa (tick không chạy).
- **Load = newGame(seed) + ghi đè**, không tạo zombie từ `map.zombieSpawns`; nội dung container từ bản lưu. Vì vậy reload nhiều lần không nhân đôi (test + playtest).
- **Không lưu xác zombie**; ID mới sau load lấy `max(nextZombieId đã lưu, ID lớn nhất + 1)` nên không trùng.
- **Spawn dùng điểm đặt tay** (8 điểm ngoài nhà, đã có từ Sprint 3) thay vì điểm ngẫu nhiên: đảm bảo không spawn trong nhà an toàn và không kẹt trong tường. Vì zombie IDLE đứng yên tại điểm spawn, điểm chỉ trống khi zombie đó đi đuổi hoặc chết → spawn thực tế là "thay thế", đúng tinh thần có giới hạn.
- **"Ngoài tầm nhìn" xấp xỉ bằng khoảng cách ≥ 16 m + ưu tiên bị tường che**, vì camera orthographic ở zoom mặc định thấy gần hết bản đồ 50×50.
- **Ánh sáng đêm không quá tối** (ảnh headless): người chơi cần thấy zombie; số trong `config.lighting` là giá trị thử nghiệm.

## 6. Bug / TODO còn lại

- **Cân bằng** (cổng cuối tuần 5 của kế hoạch): chưa playtest thủ công vòng chơi 10–15 phút. Nhịp spawn 25/12 s, `maxActive` 10, loot, combat (khóa zombie đơn lẻ) đều chưa chỉnh theo cảm nhận thật.
- **Chuyển cảnh khi load**: có một khung hình body ở vị trí cũ trước khi Rapier khởi tạo xong (không thấy trong playtest vì overlay menu che). Nếu thấy nháy, thêm màn "Đang tải…" ngắn.
- Save chưa gồm: `staminaRegenTimer`, cooldown đánh/đẩy, timer AI (`loseTargetTimer`, `attackCooldown`), knockback đang diễn ra. Đều tự ổn định trong < 2 s sau load; chấp nhận ở MVP.
- `saveStorage.ts` không có unit test (Node không có IndexedDB); chỉ kiểm bằng playtest trình duyệt.
- Cảnh báo build "chunk > 500 kB" (three + rapier): xử lý ở Sprint 6 nếu cần (code-split menu, `manualChunks`).
- Hai cảnh báo console dev do thư viện (THREE.Clock deprecated, Rapier init params): không phải lỗi dự án.

## 7. Bước tiếp theo: Sprint 6 (kế hoạch §7)

Thứ tự: playtest 15–30 phút (ghi lỗi làm gián đoạn vòng chơi, cảm nhận cân bằng) → sửa lỗi chặn → audio/feedback (Howler.js; ghi nguồn/giấy phép cạnh manifest nếu thêm asset) → settings (âm lượng, chất lượng bóng) và màn hướng dẫn điều khiển → đo FPS trên máy thật (ghi thiết bị, trình duyệt, độ phân giải, số zombie) → tối ưu nút thắt đo được → `npm run build` + deploy (tĩnh, ví dụ GitHub Pages/Netlify; chú ý `base` trong `vite.config.ts` nếu deploy dưới sub-path) → chơi thử bản deploy, kiểm tra save/reload/Continue trên đó.

## 8. Những thứ không được tự ý thay đổi

- Thứ tự tick trong `GameRuntime.tick`; simulation ngoài React state; không import Rapier trong simulation.
- ID ổn định của tường/cửa/container/zombie/item; tên `itemId`; `mapId` `neighborhood-50`.
- **`SAVE_SCHEMA_VERSION`**: bất kỳ thay đổi cấu trúc `SaveGame` phải tăng phiên bản (bản cũ sẽ bị báo không tương thích) hoặc viết migrate trong `validateSaveGame`; không lặng lẽ nạp sai.
- Layout bản đồ 50×50; chỉ chỉnh vị trí loot/spawn khi cân bằng.
- Số liệu gameplay chỉ sửa trong `config.ts` (và `lootTables.ts`/`items.ts` là dữ liệu nội dung) sau playtest có ghi nhận.
- Contract `ZombieAIContext`; tính thuần của `stepZombie`, `resolveConeHits`, `tickPlayerCombat`, `inventory.ts`, `loot.ts`, `spawn.ts`, `validateSaveGame`, `daylightAt`.
- Không gieo lại loot ngoài `newGame(seed)`; `loadSnapshot` phải ghi đè `items` từ bản lưu.
- oxlint coi hàm tên `use*` là React hook: không đặt tên hàm gameplay bắt đầu bằng `use`.
- Không thêm asset ngoài nếu chưa ghi nguồn/giấy phép.
- Không commit/push nếu người dùng không yêu cầu. Attribution commit: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## 9. Cách kiểm chứng nhanh

```bash
npm test            # 112 test
npx tsc -b && npm run lint && npm run build
npm run dev         # http://localhost:5173 ; Esc → Lưu game; menu → Continue
```

Playtest tự động trên máy Windows này: xem memory `windows-headless-chromium-recipe` (Chromium cache của Playwright với `executablePath`, cờ SwiftShader, import qua `file:///`). `window.__runtime` cho đọc/ghi `clock.timeOfDay` (đổi giờ để xem đêm), `spawnTimer` (ép spawn), `autosaveTimer` (ép autosave), `applyPlayerDamage(n, id)` (ép chết), `createSnapshot()`. IndexedDB: DB `zombie-outbreak`, store `saves`, key `slot-1`; ghi `{schemaVersion: 99}` vào đó để thử đường "không tương thích". Kịch bản đã dùng: `scratchpad/playtest5.mjs` của phiên 22688918 (24 kiểm tra). Khi tắt dev server, kill đúng PID đang nghe cổng.
