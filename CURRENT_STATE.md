# CURRENT_STATE — bàn giao cho phiên làm việc mới

> Cập nhật: 2026-09-24, sau khi hoàn thành **Sprint 6** (Sprint 4, 5, 6 đều **chưa commit**; commit gần nhất vẫn là `77b3139 docs: update project state after phase 1 sprint 3`).
> Đọc file này trước, rồi `README.md` (tổng quan, điều khiển, phát hành) và `Zombie_Outbreak_Phase_1_MVP.md` (kế hoạch 8 tuần, tiếng Việt).
> Người dùng giao việc theo sprint của kế hoạch: "tiếp tục sprint N" nghĩa là **Sprint N** trong kế hoạch.

## 1. Phase hiện tại

Phase 1 (MVP): **cả 6 sprint đã xong về mặt mã**. Hai việc còn lại để đóng Phase 1 theo tiêu chí kế hoạch không làm được từ máy dev:

1. **Deploy thực tế**: cần bật *Settings → Pages → Source: GitHub Actions* trên repo `congtung98/project-zombi` và push `master` (workflow `.github/workflows/deploy.yml` đã sẵn). Chưa push vì người dùng chưa yêu cầu commit.
2. **Đo FPS và playtest thủ công 15–30 phút trên máy thật** (laptop GPU tích hợp): ghi thiết bị, trình duyệt, độ phân giải, số zombie; xác nhận cảm nhận cân bằng sau các thay đổi Sprint 6.

| Sprint | Trạng thái | Commit |
|---|---|---|
| 1 Nền tảng và prototype | Xong | `fa5904b` |
| 2 Khu phố và tương tác | Xong | `5ce1fa5` |
| 3 AI và chiến đấu | Xong | `8c55bce` |
| 4 Survival, inventory, loot | Xong (2026-09-24) | chưa commit |
| 5 Clock/spawn/save (IndexedDB) | Xong (2026-09-24) | chưa commit |
| 6 Hoàn thiện và phát hành | Xong về mã (2026-09-24); deploy + đo máy thật chờ người dùng | chưa commit |

Kiểm chứng cuối Sprint 6: `npm test` 113/113 (gồm soak 30 phút), `npx tsc -b` sạch, `npm run lint` sạch, `npm run build` thành công (chunk tách rapier/three/r3f/react), playtest headless bản production qua `vite preview` pass, không lỗi console.

Gợi ý commit (chỉ khi người dùng yêu cầu): ba commit theo sprint bằng `git add` từng nhóm (§3), hoặc một commit `phase4-6: inventory, loot, day/night, spawn, save and release polish`. Attribution ở §8.

## 2. Những gì đã hoàn thành

**Sprint 1–3.** Nền tảng Vite/React/R3F/Rapier, runtime tick cố định, bản đồ 50×50 với 3 công trình, cửa/container, tương tác E, NavGrid A*, FSM zombie, combat gậy + đẩy, feedback.

**Sprint 4.** Vật phẩm, inventory túi 12/tủ 8, loot theo seed sinh một lần lúc New Game, dùng vật phẩm, panel túi/tủ, phím I.

**Sprint 5.** Ánh sáng ngày/đêm, spawn có giới hạn (điểm đặt tay, RNG theo seed), schema save v1, snapshot/load, IndexedDB một slot, Continue, autosave 60 s, chết xóa save, New Game hỏi xác nhận.

**Sprint 6 (phiên này).**
- **Soak test** `src/game/core/soak.test.ts`: bot 30 phút game (dt 1/20), body giả bám `NavGrid`, raycast = `hasLineOfWalk`. Lộ trình 7 tủ, mở cửa (nhắm ô phía người chơi của cửa đóng), đánh khi zombie < 2 m, đẩy khi ≥ 2 con < 2,6 m, ăn/uống < 35, băng < 45. Bất biến mỗi tick + snapshot mỗi 60 s (validate + load vào runtime khác phải cho cùng snapshot). In `SOAK REPORT` (chạy `npx vitest run src/game/core/soak.test.ts --reporter=verbose`). Chạy ~2 s.
- **Cân bằng combat theo dữ liệu soak** (`config.ts`): lần 1 damageTaken = 0 (khóa hoàn toàn) → gậy cooldown 1,0, knockback 1,0, stagger 0,2, stamina 12; đẩy cooldown 2,0, stamina 20, knockback 2,5; zombie speed 2,3, windup 0,3. Kết quả: sống 30 phút, 11 kill, 60 sát thương, minHealth 40, 7/7 tủ. Đây là số liệu từ bot "phản xạ hoàn hảo, đánh mọi thứ"; người thật sẽ né/đóng cửa nhiều hơn → có thể vẫn hơi dễ, cần playtest tay.
- **Audio** `src/game/audio/sfx.ts`: lớp `Sfx` (Web Audio, master gain, noise buffer, chống spam theo tên), 15 hiệu ứng tổng hợp; `sfx.unlock()` ở pointerdown/keydown (App). Không có asset ngoài nên không cần ghi giấy phép.
- **Settings** `src/stores/settingsStore.ts` (localStorage `zombie-outbreak.settings.v1`, sanitize khi đọc): `volume`, `muted`, `shadows` off/low/high, `maxPixelRatio` 1/1.5/2, `showHints`. `GameCanvas` key theo shadows+dpr (remount renderer), `Lights` castShadow + shadow map 1024/2048, HUD ẩn hint. `components/Settings.tsx`: `SettingsPanel`, `GuidePanel`; `Menus.tsx` có view main/settings/guide ở menu chính và pause.
- **Hoàn thiện**: `uiStore.sceneReady` + `markSceneReady` (GameLoop sau 2 tick) → overlay "Đang tải…"; `vite.config.ts` `base: './'`, `advancedChunks`, `chunkSizeWarningLimit` 2400 (rapier WASM ~2,2 MB); `.github/workflows/deploy.yml` (npm ci → test → build → Pages); `package.json` description/license/`deploy:check`; menu phụ đề "Phase 1 MVP · bản phát hành thử".
- **Playtest production** (`scratchpad/playtest6.mjs` phiên 22688918): chạy trên `vite preview` port 5199; kiểm tra tải chunk, guide/settings + localStorage, New Game, F3 FPS (~27 headless SwiftShader), chơi 20 s, Lưu và về menu → reload → Continue, autosave sau 60 s, không lỗi console.

## 3. File đã thay đổi (chưa commit)

Sprint 4 và 5: xem danh sách trong phiên bản trước của file này (git diff `77b3139` sẽ liệt kê đầy đủ). Tóm tắt: `entities/items.ts`, `systems/{inventory,loot,spawn,save,saveStorage}.ts` (+test), `world/{lootTables,worldState}.ts`, `types/save.ts`, `rendering/{Lights,daylight,Scene,PlayerView,GameLoop}.tsx`, `stores/{inventoryStore,worldStore,uiStore,hudStore}.ts`, `components/{Inventory,ContainerPanel,Menus,HUD}.tsx`, `core/{config,events,clock,runtime}.ts`, `app/{App,GameCanvas}.tsx`, `index.css`, `mapData.ts`, `buildings.ts`, `player.ts`, `survival.ts`.

Sprint 6 — mới: `src/game/core/soak.test.ts`, `src/game/audio/sfx.ts`, `src/stores/settingsStore.ts`, `src/components/Settings.tsx`, `.github/workflows/deploy.yml`. Sửa: `config.ts` (combat/zombie), `app/App.tsx` (sfx, unlock, loading overlay), `app/GameCanvas.tsx` (settings), `rendering/Lights.tsx` (shadow quality), `rendering/GameLoop.tsx` (sceneReady), `stores/uiStore.ts` (sceneReady, sfx save), `components/Menus.tsx` (viết lại: views), `components/HUD.tsx` (hint toggle), `index.css`, `vite.config.ts`, `package.json`, `README.md`, file này.

## 4. Kiến trúc hiện tại

```text
src/
  app/                 App (event → store, sfx, unlock audio, loading overlay), GameCanvas (Canvas key = shadows+dpr, Scene key = sessionId)
  game/core/           config, clock, events, runtime, soak.test (bot 30 phút)
  game/entities/       player, zombie, items
  game/systems/        input, movement, ai, combat, survival, interaction, inventory, loot, spawn, save, saveStorage
  game/world/          buildings, mapData, worldState, lootTables, navigation
  game/rendering/      Scene, CameraRig, CursorProbe, Ground, Roads, Walls, BuildingView, DoorView, ContainerView,
                       PlayerView, ZombieView, Lights + daylight, OcclusionFader, PhysicsBridge, GameLoop, blockerData
  game/audio/          sfx (Web Audio tổng hợp)
  components/          HUD, Menus, Settings (SettingsPanel + GuidePanel), Inventory, ContainerPanel
  stores/              uiStore, hudStore, worldStore, inventoryStore, settingsStore (localStorage)
  types/               index, save
.github/workflows/     deploy.yml (GitHub Pages)
```

Luồng tick và ranh giới không đổi so với Sprint 5 (xem README). Audio chỉ là listener sự kiện ở App; settings không chạm simulation.

## 5. Quyết định quan trọng và lý do (Sprint 6)

- **Playtest bằng bot thay cho playtest tay**: máy dev không có người chơi; bot cho số liệu lặp lại được để chỉnh config có căn cứ (kế hoạch: "chỉ chỉnh số sau playtest có ghi nhận"). Nó không thay được cảm nhận thật; ghi rõ ở §1.
- **Đẩy là công cụ thoát thân** (cooldown 2 s, 20 thể lực) chứ không phải khóa nhóm; gậy vẫn thắng 1v1 nhưng nhóm ≥ 2 gây sát thương. Nếu playtest tay thấy quá khó, nới `push.cooldown` 1,5 hoặc `melee.cooldown` 0,9 trước.
- **Âm thanh tổng hợp** thay vì file: tránh vấn đề giấy phép và tải asset; đủ cho feedback MVP; đổi sang Howler + file ở Phase 2 nếu cần chất lượng.
- **Settings remount Canvas** khi đổi bóng/pixel ratio (đơn giản, hiếm khi đổi); simulation không bị ảnh hưởng vì `runtime` là singleton ngoài React, nhưng body Rapier được tạo lại từ `runtime.player.position`/`zombie.position` nên vị trí giữ nguyên.
- **`base: './'`** để cùng một `dist/` chạy ở root lẫn sub-path GitHub Pages.
- **Không tách nhỏ chunk rapier**: WASM nhúng của `rapier3d-compat`; tách được chỉ khi đổi sang gói `rapier3d` (WASM rời) — để Phase 2.

## 6. Bug / TODO còn lại

- **Chưa deploy thật, chưa đo FPS máy thật, chưa playtest tay** (xem §1). Mốc ~60 FPS trên GPU tích hợp chưa được xác nhận.
- Cảnh báo console dev do thư viện (THREE.Clock deprecated, Rapier init params): không phải lỗi dự án.
- Save chưa gồm timer nhỏ (stamina regen, cooldown, timer AI); tự ổn định < 2 s sau load.
- `saveStorage.ts` và `sfx.ts` không có unit test (cần trình duyệt); kiểm bằng playtest headless.
- Bot soak không kiểm tra va chạm thật (body giả bám lưới) nên không phát hiện kẹt góc của Rapier; playtest tay ở cửa/góc vẫn cần.
- Audio: iOS Safari cần gesture để `resume()`; đã gắn unlock ở pointerdown/keydown nhưng chưa thử trên thiết bị thật.

## 7. Bước tiếp theo

Nếu người dùng yêu cầu: (1) commit 3 sprint; (2) push → bật Pages → kiểm tra URL theo mục "Kiểm tra sau deploy" trong README; (3) ghi kết quả đo FPS + playtest tay vào README ("Đo FPS") và chỉnh `config.ts` nếu cần. Sau đó Phase 1 đóng; Phase 2 (ngoài phạm vi tài liệu này) có thể là map lớn hơn, asset thật, âm thanh file, navmesh nếu cần.

## 8. Những thứ không được tự ý thay đổi

- Thứ tự tick trong `GameRuntime.tick`; simulation ngoài React state; không import Rapier trong simulation.
- ID ổn định của tường/cửa/container/zombie/item; `mapId` `neighborhood-50`; `SAVE_SCHEMA_VERSION` phải tăng khi đổi cấu trúc `SaveGame`.
- Layout bản đồ 50×50.
- Số liệu gameplay chỉ sửa trong `config.ts` sau playtest có ghi nhận; **chạy lại soak test sau khi đổi combat/spawn/survival** và ghi `SOAK REPORT` mới vào README.
- Contract `ZombieAIContext`; tính thuần của các system có test.
- Không gieo lại loot ngoài `newGame(seed)`.
- oxlint: không đặt tên hàm `use*`; không mutate giá trị từ `useThree()` trong `useFrame` (dùng ref trên JSX).
- Không thêm asset ngoài nếu chưa ghi nguồn/giấy phép (hiện không có asset ngoài: icon emoji, âm thanh tổng hợp).
- Không commit/push nếu người dùng không yêu cầu. Attribution commit: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## 9. Cách kiểm chứng nhanh

```bash
npm test                                   # 113 test, gồm soak 30 phút (~2 s)
npx vitest run src/game/core/soak.test.ts --reporter=verbose   # xem SOAK REPORT
npx tsc -b && npm run lint && npm run build
npm run preview                            # http://localhost:4173 bản production
npm run dev                                # http://localhost:5173 (có window.__runtime)
```

Playtest headless: xem memory `windows-headless-chromium-recipe`. Bản production không có `window.__runtime` nên kịch bản `playtest6.mjs` điều khiển hoàn toàn qua UI và đọc IndexedDB (`zombie-outbreak`/`saves`/`slot-1`) và localStorage (`zombie-outbreak.settings.v1`). Khi tắt server, kill đúng PID đang nghe cổng.
