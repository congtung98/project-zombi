# CURRENT_STATE — bàn giao cho phiên làm việc mới

> Cập nhật: 2026-09-24, sau commit `8c55bce phase3: combat and navigation zombie`. Cây làm việc sạch.
> Đọc file này trước, rồi `README.md` (tổng quan + điều khiển) và `Zombie_Outbreak_Phase_1_MVP.md` (kế hoạch 8 tuần, tiếng Việt).
> Người dùng giao việc theo sprint của kế hoạch: "tiếp tục phase N" nghĩa là **Sprint N** trong kế hoạch.

## 1. Phase hiện tại

Phase 1 (MVP), **Sprint 3 đã xong**. Bước tiếp theo là **Sprint 4: survival, inventory, loot**.

| Sprint | Trạng thái | Commit |
|---|---|---|
| 1 Nền tảng và prototype | Xong | `fa5904b` |
| 2 Khu phố và tương tác | Xong | `5ce1fa5` |
| 3 AI và chiến đấu | Xong (2026-09-24) | `8c55bce` |
| 4 Survival, inventory, loot | Chưa bắt đầu | |
| 5 Clock/spawn/save (IndexedDB) | Chưa | |
| 6 Hoàn thiện và phát hành | Chưa | |

Kiểm chứng ở cuối Sprint 3: `npm test` 64/64 pass, `npx tsc -b` sạch, `npm run lint` (oxlint) sạch, `npm run build` thành công, playtest headless không lỗi console.

## 2. Những gì đã hoàn thành

**Sprint 1.** Vite + React 19 + TypeScript, R3F/Drei/Rapier. Runtime tick với thứ tự cố định, input manager, player/zombie là capsule dynamic khóa xoay trên Rapier, camera orthographic isometric theo nhân vật có zoom, WASD/Shift với stamina, HUD 10 Hz, menu/pause/game over, Vitest.

**Sprint 2.** Bản đồ tay 50×50 (`mapData.ts`): hai trục đường, ba công trình đi vào được (nhà an toàn = spawn, cửa hàng, nhà dân), công viên có hàng rào, vật cản rời. Generator tường/cửa (`buildings.ts`), cửa bản lề mở/đóng có collider (cửa đóng chặn đường và raycast), 7 container ID ổn định, prompt E chọn đối tượng gần nhất ưu tiên hướng nhìn, raycast Rapier chặn tương tác xuyên tường, mái ẩn khi ở trong nhà, tường/cửa/mái che nhân vật được làm mờ.

**Sprint 3.**
- Lưới điều hướng `NavGrid` (A* 8 hướng, ô 0,5 m, không cắt góc, làm thẳng đường). Ô khung cửa đi được khi cửa mở; ô cánh cửa mở bị chặn. `nav.version` tăng mỗi lần bật cửa.
- FSM zombie: IDLE → CHASE ⇄ ATTACK, CHASE → SEARCH (đi tới vị trí cuối còn thấy người chơi) → CHASE | IDLE; mọi trạng thái → DEAD. Bám path, tìm đường lại khi đích dời > 0,75 m, cửa đổi, hết path hoặc kẹt > 1 s; tối thiểu 0,4 s giữa hai lần tìm. Tầm nhìn raycast ở độ cao mắt 1,5 m (hàng rào/thùng/quầy không che, tường/cửa đóng thì có). Đòn zombie có wind-up 0,4 s, kiểm tra lại tường đúng lúc gây sát thương.
- Combat người chơi: chuột trái quay về điểm con trỏ chiếu xuống đất, trừ stamina, hit window sau 0,15 s, lọc hình quạt ±60° + raycast tường ở 1,2 m, mỗi zombie trúng một lần mỗi cú vung, knockback 1,5 m dạng vận tốc giảm dần (Rapier vẫn chặn ở tường). Space đẩy 3 m, khựng 0,6 s, không sát thương. Zombie chết: body `setEnabled(false)`, đòn đã queue cùng tick bị bỏ, xác ngã, đếm "Đã hạ".
- Feedback: gậy vung theo `attackTimer`, zombie lóe trắng + thanh máu, màn hình lóe đỏ khi trúng đòn, HUD báo cooldown. 8 điểm spawn, steering tách zombie.
- Sửa lỗi sau playtest của người dùng: mái nhà là occluder và bộ làm mờ bắn 3 tia (chân/thân/đầu) nên đứng ngoài sát tường phía trên màn hình vẫn thấy nhân vật.

## 3. File đã thay đổi trong Sprint 3 (commit `8c55bce`)

Mới: `src/game/world/navigation.ts` (+ test), `src/game/systems/combat.ts` (+ test), `src/game/rendering/CursorProbe.tsx`, `Zombie_Outbreak_Phase_1_MVP.md` (đưa vào repo).

Sửa: `config.ts` (thêm `zombie.*` mới, `nav`, `melee`, `push`), `events.ts` (thêm `zombie:damaged`, `zombie:died`, `player:attacked`, `player:pushed`), `runtime.ts` (nav, combat, separation, dead-body), `entities/player.ts` và `entities/zombie.ts` (trường combat/path), `systems/ai.ts` (viết lại), `types/index.ts` (thêm `SEARCH`), `mapData.ts` (8 spawn), `PlayerView.tsx` (gậy), `ZombieView.tsx` (flash, thanh máu, ngã), `BuildingView.tsx` + `OcclusionFader.tsx` (mái mờ, 3 tia), `Scene.tsx`, `HUD.tsx`, `Menus.tsx`, `hudStore.ts`, `App.tsx`, `index.css`, `main.tsx` (`window.__runtime` ở dev), `README.md`, test `ai.test.ts` và `runtime.test.ts`.

## 4. Kiến trúc hiện tại

```text
src/
  app/                 App (điều hướng màn hình, nối event runtime → store), GameCanvas (Scene key = sessionId)
  game/core/           config (mọi số gameplay), clock, events (bus có hàng đợi), runtime (GameRuntime, thứ tự tick)
  game/entities/       player, zombie: state thuần (không class, không React)
  game/systems/        input, movement, ai (FSM + bám path), combat, survival, interaction  (+ *.test.ts)
  game/world/          buildings (generator tường/cửa), mapData (khu phố), worldState (cửa/container), navigation (NavGrid)
  game/rendering/      Scene, CameraRig, CursorProbe, Ground, Roads, Walls, BuildingView, DoorView, ContainerView,
                       PlayerView, ZombieView, Lights, OcclusionFader, PhysicsBridge, GameLoop, blockerData
  components/          HUD, Menus
  stores/              uiStore (màn hình), hudStore (snapshot 10 Hz + toast + damageFlash), worldStore (mirror cửa/container)
  types/               Vec3, Vec2, EntityId, ZombieAIState
```

Luồng một tick (`GameRuntime.tick`, dt bị giới hạn bởi `config.loop.maxDelta`):
`stepPlayerMovement` → `stepInteraction` → `stepZombies` (AI, trả về đòn chờ) → `stepCombat` (input đánh/đẩy, hit window, rồi áp đòn của zombie **còn sống**) → `stepSurvival` → `clock.advance` → `events.flush` → `input.endFrame`.

Ranh giới quan trọng:
- **Simulation không nằm trong React state.** `runtime` là singleton; view đọc trực tiếp trong `useFrame`; UI chỉ nhận snapshot qua `hudStore` theo nhịp `config.loop.hudSyncInterval`. `worldStore` chỉ là mirror cửa/container, cập nhật từ event.
- **Simulation không import Rapier.** Tầng render đăng ký vào runtime: `registerPlayerBody`, `registerZombieBody`, `registerPhysicsQuery` (raycast `isBlocked(from, to, ignoreIds)`, chỉ body có `userData.blocksInteraction` mới chắn). `CursorProbe` ghi `runtime.cursorWorld`.
- **AI nhận phụ thuộc qua context** (`ZombieAIContext`: `canReach`, `findPath`, `hasLineOfWalk`, `getNavVersion`). `stepZombie` là hàm thuần, test bằng hàm giả. Test runtime dùng "fake body" tích phân vận tốc (xem `runtime.test.ts`).
- **Điều hướng không dùng physics:** `NavGrid` dựng một lần từ map data; trạng thái cửa chỉ đổi các ô cửa.
- **ID ổn định** cho tường, cửa, container, zombie (`zombie-N`) để Sprint 5 lưu.
- Ván mới: `runtime.newGame()` tăng `sessionId`; `GameCanvas` remount `Scene` theo key đó để tạo lại mọi body.

## 5. Quyết định quan trọng và lý do

- **Grid A* thay vì navmesh.** Kế hoạch cho phép chọn theo cổng thử nghiệm; với bản đồ 50×50 và tường trục, grid 0,5 m đủ (10k ô, mỗi truy vấn < 1 ms, giới hạn 20k lần mở rộng). Chỉ đổi sang navmesh (recast-navigation) nếu playtest ở cửa/góc cho thấy kẹt nhiều.
- **Knockback là vận tốc giảm dần** (tốc độ = quãng đường × `knockbackDamping`), không phải dịch chuyển tức thời, để Rapier chặn ở tường và không xuyên tường.
- **Zombie chết thì tắt body** thay vì xóa: xác không chặn đường, không nhận đòn, view vẫn vẽ xác ngã. Tránh remount scene.
- **Raycast tầm nhìn ở 1,5 m** (không phải tâm capsule 0,9 m) để hàng rào/thùng cao 1 m không che zombie; nếu không zombie công viên không bao giờ phát hiện người chơi.
- **Đòn zombie có wind-up** để người chơi có thời gian né/đẩy; knockback hoặc stagger hủy wind-up.
- **Đòn của zombie chỉ áp sau khi người chơi ra đòn trong cùng tick** để zombie chết không gây sát thương (yêu cầu checklist).
- **`runtime.uiOpen`** đã có sẵn để chặn đánh/đẩy khi inventory mở ở Sprint 4.
- **`window.__runtime` chỉ ở dev** (`import.meta.env.DEV`) để playtest tự động đọc simulation.

## 6. Bug / TODO còn lại

- **Cân bằng:** cooldown gậy 0,8 s + knockback 1,5 m cho phép khóa một zombie đơn lẻ mà không mất máu. Chưa chỉnh; cần playtest lúc bị vây (≥ 3 con) rồi mới đổi số trong `config.ts`.
- Chưa playtest thủ công kỹ ở cửa/góc nhà với nhiều zombie (cổng quyết định cuối tuần 4 của kế hoạch). Playtest headless mới kiểm tra: đi vòng hàng rào công viên, qua cửa vừa mở, đánh/giết.
- Zombie chưa có trạng thái đi lang thang khi IDLE (không bắt buộc trong Phase 1).
- Cảnh báo build "chunk > 500 kB" (three + rapier): chấp nhận ở MVP, xử lý ở Sprint 6 nếu cần.
- Hai cảnh báo console ở dev do thư viện (THREE.Clock deprecated, Rapier init params): không phải lỗi của dự án.
- Menu Continue vẫn disabled (Sprint 5).

## 7. Bước tiếp theo: Sprint 4 (theo kế hoạch §5.4 và §7)

Thứ tự đề xuất: item definitions (`itemId`, tên, loại, `stackLimit`, hiệu ứng; bỏ wood/scrap khỏi loot) → inventory 12 ô với `add/remove/use/transfer` trả kết quả rõ ràng, không âm, không mất đồ khi đầy → loot hữu hạn sinh **một lần** theo seed khi tạo ván hoặc lần đầu mở container, lưu kết quả vào `worldState` → UI inventory (phím I, đặt `runtime.uiOpen = true`, dùng `input.onAction('inventory')` như pause) và panel container (click chuyển, Take All) → dùng thức ăn/nước/băng (hồi hunger/thirst/health, clamp 100, chỉ trừ khi dùng thành công) → HUD → cân bằng vòng chơi đầu (khu khởi đầu đủ nhu yếu phẩm).

Gợi ý vị trí: `src/game/entities/items.ts`, `src/game/systems/inventory.ts` (+ test), `src/game/systems/loot.ts` (+ test), `src/components/Inventory.tsx`, `src/components/ContainerPanel.tsx`, thêm `inventory`/`containerContents` vào `worldState`/`PlayerState`, sự kiện mới trong `events.ts`. Hiện `container:opened` chỉ hiện toast; thay bằng mở panel.

Ghi chú test: viết test có ý nghĩa cho inventory transfer và loot seed (checklist §8); không test cấu trúc component.

## 8. Những thứ không được tự ý thay đổi

- **Thứ tự tick** trong `GameRuntime.tick` và nguyên tắc "simulation không nằm trong React state", "simulation không import Rapier" (dùng `PhysicsQuery`/register* adapter).
- **ID ổn định** của tường/cửa/container/zombie trong map data và `worldState`; Sprint 5 sẽ lưu theo các ID này. Không đổi tên ID hoặc thứ tự spawn zombie.
- **Layout bản đồ 50×50** đã khóa cuối tuần 2 theo kế hoạch; chỉ chỉnh vị trí loot/spawn khi cân bằng, không mở rộng map trước khi navigation và nội dung được xác nhận.
- **Số liệu gameplay chỉ sửa trong `src/game/core/config.ts`** và chỉ sau playtest có ghi nhận; không hard-code số trong system/view.
- **Contract của `ZombieAIContext`** và tính thuần của `stepZombie`, `resolveConeHits`, `tickPlayerCombat`: test hiện tại dựa vào đó.
- **Save schema chưa tồn tại**: khi thêm dữ liệu cần lưu (inventory, loot), đặt vào `PlayerState`/`WorldState` với kiểu tuần tự hóa được (không Map lồng class, không tham chiếu body).
- Không thêm asset ngoài nếu chưa ghi nguồn/giấy phép cạnh manifest (kế hoạch §6).
- Không commit/push nếu người dùng không yêu cầu. Attribution commit: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## 9. Cách kiểm chứng nhanh

```bash
npm test            # 64 test
npx tsc -b && npm run lint && npm run build
npm run dev         # http://localhost:5173 ; F3 bật debug (trạng thái zombie + collider)
```

Playtest tự động trên máy Windows này: Playwright không cài trong repo; dùng Chromium cache của Playwright với `executablePath` và cờ SwiftShader (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`), import module qua URL `file:///`. Trong trang, `window.__runtime` cho đọc `player`, `zombies`, `nav`, `cursorWorld`; có thể dịch chuyển người chơi bằng `__runtime.playerBody.setTranslation(...)` (trường private TS nhưng truy cập được lúc chạy). FPS headless ~20 không đại diện cho máy thật. Khi tắt dev server, kill đúng PID đang nghe cổng, không kill toàn bộ `node.exe`.
