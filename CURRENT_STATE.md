# CURRENT_STATE — bàn giao cho phiên làm việc mới

> Cập nhật: 2026-09-24, sau khi hoàn thành **Sprint 4** (chưa commit; commit gần nhất vẫn là `77b3139 docs: update project state after phase 1 sprint 3`).
> Đọc file này trước, rồi `README.md` (tổng quan + điều khiển) và `Zombie_Outbreak_Phase_1_MVP.md` (kế hoạch 8 tuần, tiếng Việt).
> Người dùng giao việc theo sprint của kế hoạch: "tiếp tục phase N" nghĩa là **Sprint N** trong kế hoạch.

## 1. Phase hiện tại

Phase 1 (MVP), **Sprint 4 đã xong**. Bước tiếp theo là **Sprint 5: clock/ánh sáng ngày đêm, spawn có giới hạn, save/load IndexedDB, Continue**.

| Sprint | Trạng thái | Commit |
|---|---|---|
| 1 Nền tảng và prototype | Xong | `fa5904b` |
| 2 Khu phố và tương tác | Xong | `5ce1fa5` |
| 3 AI và chiến đấu | Xong | `8c55bce` |
| 4 Survival, inventory, loot | Xong (2026-09-24) | chưa commit |
| 5 Clock/spawn/save (IndexedDB) | Chưa | |
| 6 Hoàn thiện và phát hành | Chưa | |

Kiểm chứng ở cuối Sprint 4: `npm test` 94/94 pass, `npx tsc -b` sạch, `npm run lint` (oxlint) sạch, `npm run build` thành công, playtest headless 23/23 kiểm tra pass, không lỗi console.

## 2. Những gì đã hoàn thành

**Sprint 1.** Vite + React 19 + TypeScript, R3F/Drei/Rapier. Runtime tick với thứ tự cố định, input manager, player/zombie là capsule dynamic khóa xoay trên Rapier, camera orthographic isometric theo nhân vật có zoom, WASD/Shift với stamina, HUD 10 Hz, menu/pause/game over, Vitest.

**Sprint 2.** Bản đồ tay 50×50 (`mapData.ts`): hai trục đường, ba công trình đi vào được (nhà an toàn = spawn, cửa hàng, nhà dân), công viên có hàng rào, vật cản rời. Generator tường/cửa (`buildings.ts`), cửa bản lề mở/đóng có collider, 7 container ID ổn định, prompt E chọn đối tượng gần nhất ưu tiên hướng nhìn, raycast Rapier chặn tương tác xuyên tường, mái ẩn khi ở trong nhà, tường/cửa/mái che nhân vật được làm mờ.

**Sprint 3.** `NavGrid` A* (ô 0,5 m, cửa mở/đóng đổi ô, `nav.version`), FSM zombie IDLE → CHASE ⇄ ATTACK, CHASE → SEARCH → CHASE | IDLE, mọi trạng thái → DEAD; bám path, tầm nhìn raycast ở 1,5 m, wind-up 0,4 s. Combat gậy (hình quạt ±60° + raycast tường, hit window 0,15 s, knockback vận tốc giảm dần), Space đẩy, zombie chết tắt body. Feedback (gậy vung, lóe trắng, thanh máu, lóe đỏ, cooldown HUD). 8 spawn, steering tách zombie. Chi tiết trong README.

**Sprint 4 (phiên này).**
- **Vật phẩm** `src/game/entities/items.ts`: 6 item (`canned_food`, `chips`, `water`, `soda`, `bandage`, `medkit`) với `stackLimit`, `effect` (health/hunger/thirst/stamina, có thể âm), icon emoji, mô tả. Không có wood/scrap (kế hoạch §2).
- **Inventory** `src/game/systems/inventory.ts`: `Inventory = { slots: (ItemStack|null)[] }` dùng chung cho túi (12 ô, `config.inventory.slots`) và container (8 ô, `config.inventory.containerSlots`). `addItem` lấp stack cùng loại trước rồi ô trống, trả `{added, remainder}`; `removeFromSlot/removeItem` không âm; `transferSlot/transferAll` chỉ trừ nguồn đúng số đã vào đích (tổng bảo toàn). `cloneInventory` cho snapshot UI.
- **Loot** `src/game/systems/loot.ts` + `src/game/world/lootTables.ts`: PRNG mulberry32, `hashSeed(worldSeed, containerId)` (FNV-1a) → mỗi container có seed riêng, độc lập thứ tự mở. Bảng loot có `guaranteed` + `rolls` theo trọng số (`itemId: null` = không ra gì). `ContainerDef.loot` trong map data trỏ tới bảng. Nội dung sinh **một lần** trong `createWorldState(map, seed)` lúc `newGame(seed)`; `WorldState.seed` và `ContainerState.items` là dữ liệu cần lưu ở Sprint 5.
- **Dùng vật phẩm** `survival.ts`: `canBenefit`, `applyItemEffect` (kẹp 0..max), `consumeInventoryItem(player, slot)` trả `{ok, itemId, effect}` hoặc `{ok:false, reason: 'empty'|'dead'|'no-effect'}`; chỉ trừ đồ khi ok. (Tên hàm không bắt đầu bằng `use` vì oxlint coi là React hook.)
- **Runtime**: `inventoryOpen`, `openContainerId`, `uiOpen` (suy ra từ hai trường trên, chặn đánh/đẩy). `interact(container)`: mở panel + túi, E lần nữa ở cùng container thì đóng; `stepInteraction` tự đóng panel khi đi xa quá `INTERACT_RANGE + radius + config.inventory.closeDistanceSlack` và đóng mọi UI khi chết. API cho UI/test: `toggleInventory`, `setInventoryOpen`, `closeContainer`, `closeAllUi`, `openContainer` (getter), `consumeItem(slot)`, `takeFromContainer(slot)`, `putIntoContainer(slot)`, `takeAll()`. Sự kiện mới: `container:closed`, `inventory:changed`, `item:used`, `item:useFailed`. Prompt E: "Mở/Xem/Đóng <tên tủ>".
- **UI**: `stores/inventoryStore.ts` (snapshot túi + tủ, `sync` khi `inventory:changed`, `reset` khi New Game/về menu), `components/Inventory.tsx` (`ItemSlot`, `SlotGrid`, `InventoryPanel`), `components/ContainerPanel.tsx` (`ContainerPanel`, `InventoryOverlay`). App: phím I toggle (chỉ khi `playing`), Esc đóng UI trước rồi mới pause, toast cho `item:used`/`item:useFailed`; bỏ toast "Sprint 4" cũ ở `container:opened`. HUD: `<kbd>I</kbd> Túi n/12` (vàng khi mở), hint có "I túi đồ". Menu: phụ đề Sprint 4, dòng I trong ControlsHelp. CSS mới ở cuối `index.css` (`.inv-*`, `.slot*`).
- **Test mới**: `inventory.test.ts` (stack/limit, đầy không mất, remove không âm, transfer bảo toàn tổng, 12 ô), `loot.test.ts` (PRNG xác định, guaranteed/bounds, seed khác kết quả khác, không vượt số ô, mọi container map có bảng, sinh một lần và độc lập seed, nhà an toàn luôn có nước/đồ hộp/băng, chỉ item hợp lệ), `survival.test.ts` thêm 5 test dùng vật phẩm, `runtime.test.ts` thêm 7 test tích hợp (mở/đóng panel, seed lặp lại, take/put/take-all với túi đầy, dùng item + sự kiện, đi xa/chết đóng UI, UI mở chặn đánh, newGame reset). Một test cũ đổi: E lần hai ở cùng tủ giờ là đóng panel.

## 3. File đã thay đổi trong Sprint 4 (chưa commit)

Mới: `src/game/entities/items.ts`, `src/game/systems/inventory.ts` (+ test), `src/game/systems/loot.ts` (+ test), `src/game/world/lootTables.ts`, `src/stores/inventoryStore.ts`, `src/components/Inventory.tsx`, `src/components/ContainerPanel.tsx`.

Sửa: `config.ts` (`inventory.*`), `events.ts`, `runtime.ts`, `entities/player.ts` (`inventory`), `systems/survival.ts` (+ test), `world/buildings.ts` (`ContainerDef.loot`), `world/mapData.ts` (gán `loot` cho 7 container), `world/worldState.ts` (seed + items), `stores/uiStore.ts`, `stores/hudStore.ts`, `components/HUD.tsx`, `components/Menus.tsx`, `app/App.tsx`, `index.css`, `runtime.test.ts`, `README.md`, file này.

Gợi ý commit: `phase4: survival items, inventory and seeded loot` (chỉ commit khi người dùng yêu cầu; attribution ở §8).

## 4. Kiến trúc hiện tại

```text
src/
  app/                 App (điều hướng màn hình, nối event runtime → store, phím I/Esc), GameCanvas (Scene key = sessionId)
  game/core/           config (mọi số gameplay), clock, events (bus có hàng đợi), runtime (GameRuntime, thứ tự tick, API inventory)
  game/entities/       player (có inventory), zombie, items: state/dữ liệu thuần (không class, không React)
  game/systems/        input, movement, ai, combat, survival (+ dùng item), interaction, inventory, loot  (+ *.test.ts)
  game/world/          buildings, mapData, worldState (cửa/container + loot), lootTables, navigation (NavGrid)
  game/rendering/      Scene, CameraRig, CursorProbe, Ground, Roads, Walls, BuildingView, DoorView, ContainerView,
                       PlayerView, ZombieView, Lights, OcclusionFader, PhysicsBridge, GameLoop, blockerData
  components/          HUD, Menus, Inventory, ContainerPanel
  stores/              uiStore (màn hình), hudStore (snapshot 10 Hz + toast + damageFlash), worldStore (mirror cửa/container),
                       inventoryStore (snapshot túi/tủ theo sự kiện)
  types/               Vec3, Vec2, EntityId, ZombieAIState
```

Luồng một tick (`GameRuntime.tick`, dt bị giới hạn bởi `config.loop.maxDelta`):
`stepPlayerMovement` → `stepInteraction` (prompt E, tự đóng panel khi đi xa/chết) → `stepZombies` → `stepCombat` (bỏ qua input đánh/đẩy khi `uiOpen`) → `stepSurvival` → `clock.advance` → `events.flush` → `input.endFrame`.

Ranh giới quan trọng:
- **Simulation không nằm trong React state.** `runtime` là singleton; view đọc trực tiếp trong `useFrame`; HUD nhận snapshot 10 Hz; `inventoryStore` nhận snapshot (clone) chỉ khi có `inventory:changed`. Thao tác click trong UI gọi thẳng `runtime.*` (ngoài tick, an toàn vì JS đơn luồng); sự kiện phát ở tick kế tiếp (~1 frame).
- **Simulation không import Rapier.** `registerPlayerBody`, `registerZombieBody`, `registerPhysicsQuery`.
- **AI nhận phụ thuộc qua context** (`ZombieAIContext`); `stepZombie` thuần.
- **Điều hướng không dùng physics:** `NavGrid` dựng một lần từ map data.
- **ID ổn định** cho tường, cửa, container, zombie, item.
- **Loot sinh một lần** tại `newGame(seed)`; không có đường nào gieo lại. Trạng thái `opened` chỉ để đèn báo trên tủ.

## 5. Quyết định quan trọng và lý do

- (Sprint 3) Grid A* thay vì navmesh; knockback là vận tốc giảm dần; zombie chết tắt body; raycast tầm nhìn 1,5 m; wind-up đòn zombie; đòn zombie chỉ áp sau đòn người chơi cùng tick.
- **Loot sinh lúc New Game cho mọi container** (không phải lần đầu mở): đơn giản hơn cho save (Sprint 5 chỉ cần lưu `items`), test được không cần tương tác, và seed mỗi container băm từ id nên kết quả không phụ thuộc người chơi mở tủ nào trước.
- **Container cũng là `Inventory`** (8 ô) để dùng chung `transferSlot/transferAll` hai chiều; người chơi có thể cất đồ vào tủ để giải phóng chỗ.
- **Dùng vật phẩm khi chỉ số đầy = thất bại, không trừ đồ** (kế hoạch §5.2 "chỉ trừ item khi hành động dùng thành công"). Snack có tác dụng phụ −5 khát nhưng vẫn "thành công" nếu hồi được đói.
- **Mở container thì mở luôn túi**; phím I đóng cả hai; Esc đóng UI trước rồi mới pause (tránh pause ngoài ý muốn khi đang loot). Game **không pause** khi túi mở: zombie vẫn tấn công, người chơi vẫn đi được, chỉ đánh/đẩy bị chặn.
- **Đi xa tủ thì panel tự đóng** (`closeDistanceSlack` 0,75 m) để không loot từ xa.
- **Không có item "gậy" trong túi**: gậy luôn được trang bị (kế hoạch cho phép "có thể là item trang bị riêng", không bắt buộc ở MVP).

## 6. Bug / TODO còn lại

- **Cân bằng loot** chưa qua playtest vòng chơi 10–15 phút (cổng cuối tuần 5 của kế hoạch). Seed mẫu cho thấy có thể ra 2 medkit ở tủ quần áo; nếu quá dư thì giảm `weight` medkit trong `lootTables.ts`. Tổng nhu yếu phẩm hiện đủ cho ~25 phút (hunger 20 phút, thirst 15 phút; nước 40/chai).
- **Cân bằng combat** (từ Sprint 3): cooldown gậy 0,8 s + knockback 1,5 m cho phép khóa một zombie đơn lẻ; chưa chỉnh.
- Container panel không có thao tác chuyển một phần stack (chỉ chuyển cả ô); `transferSlot` hỗ trợ `quantity` nếu cần thêm.
- Không có kéo-thả hay sắp xếp túi; không bắt buộc trong Phase 1.
- Cảnh báo build "chunk > 500 kB" (three + rapier): chấp nhận ở MVP.
- Hai cảnh báo console ở dev do thư viện (THREE.Clock deprecated, Rapier init params): không phải lỗi dự án.
- Menu Continue vẫn disabled (Sprint 5).

## 7. Bước tiếp theo: Sprint 5 (theo kế hoạch §5.5 và §7)

Thứ tự: clock đã có (`GameClock`, `dayLengthSec` 600 s, `isNight`) → ánh sáng ngày/đêm trong `Lights.tsx` đọc `runtime.clock` trong `useFrame` → spawn có giới hạn (điểm hợp lệ, ngoài tầm nhìn, đủ xa, không trong nhà an toàn; tái lập sau load) → snapshot schema (`types/save.ts`: `schemaVersion`, `worldSeed`, `savedAt`, clock, player gồm vị trí/hướng/chỉ số/`inventory`, `world.doors`, `world.containers[id].{opened, items}`, zombie `{id, position, ai, health}`) → IndexedDB save/load nguyên tử, bắt lỗi quota/hỏng, báo rõ → Continue trong menu → kiểm tra reload nhiều lần không nhân đôi zombie/loot, dữ liệu không tương thích báo được.

Lưu ý khi làm: snapshot phải chụp ở ranh giới tick (pause trước khi save); `runtime.newGame()` hiện tạo zombie theo `map.zombieSpawns` với ID `zombie-N` — load cần khôi phục đúng ID và vị trí body (đặt `setTranslation` sau khi `Scene` remount theo `sessionId`); `Inventory`/`ContainerState.items` đã là object thuần, `Map` của doors/containers cần chuyển sang mảng khi lưu.

## 8. Những thứ không được tự ý thay đổi

- **Thứ tự tick** trong `GameRuntime.tick` và nguyên tắc "simulation không nằm trong React state", "simulation không import Rapier".
- **ID ổn định** của tường/cửa/container/zombie/item trong map data, `items.ts`, `worldState`. Không đổi tên ID, thứ tự spawn zombie, hay `itemId`.
- **Layout bản đồ 50×50** đã khóa; chỉ chỉnh vị trí loot/spawn khi cân bằng.
- **Số liệu gameplay chỉ sửa trong `src/game/core/config.ts`** (và bảng loot/hiệu ứng item trong `lootTables.ts`/`items.ts`, là dữ liệu nội dung) và chỉ sau playtest có ghi nhận.
- **Contract của `ZombieAIContext`**, tính thuần của `stepZombie`, `resolveConeHits`, `tickPlayerCombat`, và của `inventory.ts`/`loot.ts`/`consumeInventoryItem` (test dựa vào đó).
- **Không gieo lại loot** ở bất kỳ đường nào ngoài `newGame(seed)`; Sprint 5 load phải ghi đè `items` từ save chứ không gọi `createWorldState` với seed rồi bỏ qua nội dung đã lấy.
- Không thêm asset ngoài nếu chưa ghi nguồn/giấy phép (icon hiện là emoji hệ thống).
- Không commit/push nếu người dùng không yêu cầu. Attribution commit: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## 9. Cách kiểm chứng nhanh

```bash
npm test            # 94 test
npx tsc -b && npm run lint && npm run build
npm run dev         # http://localhost:5173 ; I mở túi, E ở tủ mở panel, F3 debug
```

Playtest tự động trên máy Windows này: Playwright không cài trong repo; dùng Chromium cache của Playwright với `executablePath` và cờ SwiftShader (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`), import module qua URL `file:///`. Trong trang, `window.__runtime` cho đọc `player` (gồm `inventory`), `world.containers`, `world.seed`, `openContainerId`, `uiOpen`; dịch chuyển người chơi bằng `__runtime.playerBody.setTranslation(...)`. Panel tủ: `.inv-panel-container`, ô có đồ: `.slot-filled`, nút "Lấy tất cả". Khi tắt dev server, kill đúng PID đang nghe cổng, không kill toàn bộ `node.exe`.
