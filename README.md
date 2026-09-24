# Zombie Outbreak — Phase 1 (MVP)

Game sinh tồn zombie 3D góc nhìn isometric chạy trên trình duyệt. Kế hoạch chi tiết nằm trong
`Zombie_Outbreak_Phase_1_MVP.md`. Repo đã hoàn thành **Sprint 6: hoàn thiện và phát hành** (Phase 1 MVP, đã xong Sprint 1–6). Bản build production
nằm trong `dist/` sau `npm run build`; workflow GitHub Pages ở `.github/workflows/deploy.yml`.

## Chạy

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit test (Vitest) cho luật game cốt lõi
npm run build      # tsc -b && vite build  → dist/ (base './', chạy được ở root hoặc sub-path)
npm run preview    # phục vụ dist/ để chơi thử bản production
npm run lint
```

## Phát hành

- **Build tĩnh:** `npm run build` tạo `dist/` với `base: './'`, nên có thể copy lên bất kỳ host tĩnh nào (GitHub
  Pages, Netlify, Cloudflare Pages, nginx). Chunk lớn nhất là `rapier` (~2,2 MB, gzip ~840 kB) vì WASM của
  `@dimforge/rapier3d-compat` được nhúng; `three` ~740 kB (gzip ~190 kB); mã game ~85 kB.
- **GitHub Pages:** push lên `master` sẽ chạy `.github/workflows/deploy.yml` (npm ci → test → build → deploy).
  Trước lần đầu, bật *Settings → Pages → Source: GitHub Actions* trên repo. URL sẽ là
  `https://<user>.github.io/project-zombi/`. Có thể chạy tay bằng *Actions → Deploy to GitHub Pages → Run workflow*.
- **Kiểm tra sau deploy:** mở URL, New Game, chơi vài phút, Esc → Lưu game, tải lại trang, Continue phải khôi phục
  đúng giờ/vị trí/túi. Save nằm trong IndexedDB của origin đó (đổi domain = mất save).
- **Cài đặt** (menu chính hoặc pause → Cài đặt, lưu trong localStorage): âm lượng/tắt tiếng, bóng đổ Tắt/Thấp/Cao,
  giới hạn pixel ratio 1×/1.5×/2×, gợi ý phím trên HUD. Máy GPU tích hợp nên chọn bóng Thấp hoặc Tắt và 1×.
- **Đo FPS:** F3 hiện FPS và số zombie. Kết quả headless SwiftShader trên máy dev: ~27 FPS ở 1280×800 với bóng Thấp
  (không đại diện GPU thật). Chưa có số đo trên laptop GPU tích hợp thật; cần ghi thiết bị, trình duyệt, độ phân giải,
  số zombie khi đo (kế hoạch §7).

## Điều khiển

| Phím | Hành động |
|---|---|
| W A S D | Di chuyển theo hướng màn hình (đi chéo không nhanh hơn) |
| Shift | Chạy, tiêu stamina; hồi khi ngừng chạy |
| Chuột trái | Vung gậy về phía con trỏ (tiêu stamina, có cooldown) |
| Space | Đẩy zombie ra xa, không gây sát thương (cooldown và stamina riêng) |
| E | Tương tác với cửa (mở/đóng) và container gần nhất trong tầm, ưu tiên hướng nhìn |
| Con lăn chuột | Zoom camera trong giới hạn min/max |
| Esc | Tạm dừng (dừng simulation, cooldown và đồng hồ); menu pause có Lưu game / Lưu và về menu |
| F3 | Overlay debug: FPS, vị trí, trạng thái zombie (và collider Rapier) |
| I | Mở/đóng túi đồ 12 ô. Trong túi: click trái dùng vật phẩm; khi đang mở tủ: click trái cất vào tủ, chuột phải dùng. Trong panel tủ: click lấy, nút Lấy tất cả |
| Esc (khi túi mở) | Đóng túi/tủ trước, nhấn lần nữa mới tạm dừng |

Tab mất focus sẽ tự tạm dừng và xóa mọi phím đang giữ. Ở chế độ dev, `window.__runtime` trỏ tới
simulation để kiểm tra từ console hoặc kịch bản playtest tự động.

## Cấu trúc mã

```text
src/
  app/                 App (điều hướng màn hình), GameCanvas
  game/
    core/              config, clock (ngày/đêm, restore), events, runtime (thứ tự tick, spawn, snapshot/load)
    entities/          player, zombie (state thuần), items (định nghĩa vật phẩm, ID ổn định)
    systems/           input, movement, ai (FSM + bám path), combat, survival (+ dùng vật phẩm), interaction,
                       inventory (add/remove/transfer), loot (PRNG seed, bảng loot), spawn (chọn điểm spawn),
                       save (validate schema, tóm tắt), saveStorage (IndexedDB)  (+ unit test)
    world/             buildings (generator tường/cửa), mapData (khu phố 50×50), worldState (cửa/container + loot),
                       lootTables (bảng loot đặt tay), navigation (lưới A*, cửa mở/đóng)
    rendering/         Scene, CameraRig, CursorProbe, Ground, Roads, Walls, BuildingView, DoorView,
                       ContainerView, PlayerView, ZombieView, Lights (+ daylight), OcclusionFader, PhysicsBridge, GameLoop
  components/          HUD, Menus (main/pause/game over), Inventory (túi 12 ô), ContainerPanel (panel tủ + overlay)
  stores/              uiStore (màn hình, save/continue), hudStore (snapshot HUD 10 Hz), worldStore (mirror cửa/container/zombie),
                       inventoryStore (snapshot túi/tủ, cập nhật theo sự kiện)
  types/               kiểu dữ liệu chia sẻ, save (schema bản lưu)
```

Nguyên tắc:

- **Simulation không nằm trong React state.** `GameRuntime` giữ dữ liệu runtime; view đọc trực tiếp trong
  `useFrame`; UI chỉ nhận snapshot qua `hudStore` theo nhịp chậm.
- **Một nguồn thời gian.** `GameClock` chỉ tiến trong `runtime.tick()`, delta time bị giới hạn bởi
  `config.loop.maxDelta`.
- **Thứ tự tick cố định:** input → chuyển động/physics → tương tác → AI → combat → survival/clock → phát sự kiện.
- **Physics do Rapier xử lý.** Simulation đặt vận tốc cho body, Rapier giải quyết va chạm với tường.
- **Simulation không import Rapier.** `PhysicsBridge` đăng ký một `PhysicsQuery` (raycast) vào runtime;
  logic tương tác/tầm nhìn/đòn đánh test được mà không cần WASM.
- **Điều hướng không dùng physics.** `NavGrid` dựng một lần từ map data (ô 0,5 m, vật cản nới theo bán kính
  tác nhân); trạng thái cửa chỉ đổi các ô trong khung cửa và vùng cánh cửa mở. AI nhận `findPath`/`hasLineOfWalk`
  qua context nên test được bằng hàm giả.
- **ID ổn định.** Tường, cửa, container đều có ID cố định trong map data; `worldState` giữ trạng thái
  mở/đóng để Sprint 5 lưu lại.
- **Cấu hình tập trung** trong `src/game/core/config.ts`; số liệu là giá trị thử nghiệm để chỉnh sau playtest.

## Trạng thái theo kế hoạch

Sprint 1 (xong): scene + sân 50×50, input manager, player capsule + collider, WASD/Shift với stamina,
camera orthographic theo nhân vật có zoom, một zombie FSM (IDLE → CHASE → ATTACK) đuổi và gây sát
thương, HUD, menu/pause/game over, unit test cho movement, AI, survival và runtime tick.

Sprint 2 (xong): khu phố có hai trục đường, ba công trình đi vào được (nhà an toàn là điểm spawn,
cửa hàng, nhà dân), cửa có bản lề mở/đóng với collider (cửa đóng chặn đường và raycast), 7 container
có ID ổn định và trạng thái đã mở, prompt E chọn đối tượng gần nhất ưu tiên hướng nhìn, raycast
Rapier chặn tương tác xuyên tường, mái ẩn khi ở trong nhà và tường che nhân vật được làm mờ.

Sprint 3 (xong):

- **Điều hướng.** Lưới A* 8 hướng không cắt góc, làm thẳng đường bằng kiểm tra tầm đi. Zombie đi thẳng khi
  lưới cho phép, nếu không thì bám waypoint; tìm đường lại khi đích dời quá 0,75 m, khi cửa đổi trạng thái
  (`nav.version`), khi hết path hoặc bị kẹt quá 1 giây; tối thiểu 0,4 giây giữa hai lần tìm.
- **FSM mới:** IDLE → CHASE ⇄ ATTACK, CHASE → SEARCH (đi tới vị trí cuối còn thấy người chơi, bỏ cuộc sau
  3 giây khi tới nơi hoặc 8 giây tổng) → CHASE | IDLE; mọi trạng thái → DEAD. Tầm nhìn raycast ở độ cao mắt
  (1,5 m) nên hàng rào, thùng, quầy không che nhưng tường và cửa đóng thì có. Đòn zombie có wind-up 0,4 giây,
  kiểm tra lại tường chắn đúng lúc gây sát thương; zombie bị đẩy lùi/khựng thì hủy đòn đang vung.
- **Combat.** Chuột trái quay nhân vật về điểm con trỏ chiếu xuống đất (`CursorProbe`), trừ stamina, mở
  cửa sổ trúng đòn sau 0,15 giây: lọc zombie còn sống trong tầm 2 m, hình quạt ±60°, không bị tường chắn
  (raycast ở 1,2 m); mỗi zombie chỉ trúng một lần mỗi cú vung. Knockback 1,5 m là vận tốc giảm dần nên Rapier
  vẫn chặn ở tường. Space đẩy 3 m, khựng 0,6 giây, không sát thương. Zombie chết thì body bị tắt (không chặn
  đường, không nhận đòn), đòn đã queue trong cùng tick bị bỏ; xác ngã xuống, đếm "Đã hạ".
- **Feedback.** Gậy vung theo `attackTimer`, zombie lóe trắng khi trúng và có thanh máu khi bị thương, màn
  hình lóe đỏ khi người chơi trúng đòn, HUD báo cooldown gậy/đẩy.
- **Nhiều zombie.** 8 điểm spawn đặt tay ngoài nhà an toàn; steering tách nhau nhẹ để không chồng lên một điểm.
- **Test:** 64 unit test, gồm A* vòng tường và qua cửa mở/đóng, lọc hình quạt/tường, hit window, và test tích
  hợp runtime với body giả: zombie ngoài nhà đứng chờ khi cửa đóng, đi qua cửa vừa mở và tấn công.

Playtest headless (Chromium SwiftShader, `window.__runtime`): zombie công viên thấy người chơi qua hàng rào,
đi vòng qua khe hàng rào rồi tấn công; zombie đuổi thẳng trúng hai gậy và chết; không lỗi console.
Ghi nhận để cân bằng: với cooldown 0,8 giây và knockback 1,5 m, người chơi có thể khóa một zombie đơn lẻ
mà không bị trúng đòn; cần playtest khi bị vây trước khi chỉnh số.

Sprint 4 (xong):

- **Vật phẩm** (`entities/items.ts`): đồ hộp, snack, nước, nước ngọt, băng gạc, hộp cứu thương; mỗi item có
  `stackLimit` và hiệu ứng (hồi máu/đói/khát/thể lực). Không có wood/scrap vì chưa có crafting.
- **Inventory** (`systems/inventory.ts`): cấu trúc ô cố định dùng chung cho túi (12 ô) và container (8 ô);
  `addItem/removeFromSlot/removeItem/transferSlot/transferAll` trả kết quả rõ ràng (`added/remainder`,
  `moved/remainder`), không âm, đích đầy thì phần dư ở lại nguồn.
- **Loot theo seed** (`systems/loot.ts`, `world/lootTables.ts`): PRNG mulberry32, seed mỗi container =
  hash(seed ván, id) nên không phụ thuộc thứ tự mở; nội dung sinh **một lần** trong `createWorldState` khi
  New Game và lưu trong `world.containers[id].items`. Mở lại tủ không sinh thêm. Nhà an toàn luôn có nước,
  đồ hộp, băng gạc; cửa hàng là nguồn chính; nhà dân có đồ y tế.
- **Dùng vật phẩm** (`survival.ts`): kẹp 0..100; chỉ trừ vật phẩm khi có tác dụng (chỉ số đầy thì báo và giữ đồ).
- **Runtime**: E ở container mở panel (E lần nữa hoặc đi xa thì đóng), I mở/đóng túi, Esc đóng UI trước rồi
  mới pause; `uiOpen` chặn đánh/đẩy khi UI mở. Sự kiện mới: `container:closed`, `inventory:changed`,
  `item:used`, `item:useFailed`.
- **UI**: overlay túi + panel tủ (click lấy/cất/dùng, Lấy tất cả, toast hiệu ứng), HUD đếm ô túi.
- **Test:** 94 unit test (thêm inventory transfer, loot seed/bảng, dùng vật phẩm, tích hợp runtime).

Playtest headless Sprint 4: mở tủ nhà an toàn, lấy từng món và Lấy tất cả (tổng không đổi), dùng nước/băng
đúng chỉ số, dùng khi đầy không mất đồ, I/Esc đóng đúng thứ tự, đi xa tự đóng panel, mở lại không sinh
thêm; không lỗi console.

Sprint 5 (xong):

- **Ngày/đêm** (`Lights.tsx`, `daylight.ts`): ambient/hemisphere/sun và màu nền nội suy theo `clock.timeOfDay`
  với đoạn chuyển mượt quanh bình minh/hoàng hôn (`config.lighting`, `config.clock.nightEnd/nightStart`).
  Đọc trong `useFrame`, không qua React state. Ban đêm vẫn đủ sáng để chơi.
- **Spawn có giới hạn** (`systems/spawn.ts`, `runtime.stepSpawn`): tối đa `spawn.maxActive` zombie sống,
  nhịp ngày 25 s / đêm 12 s, chỉ tại điểm đặt tay cách người chơi ≥ 16 m, không chồng zombie sống, ưu tiên
  điểm bị tường che (raycast). RNG spawn = hash(seed ván, bộ đếm) nên tái lập sau load. Xác được dọn sau 20 s.
  Danh sách zombie là mirror trong `worldStore.zombieIds` để Scene thêm/gỡ view.
- **Save/load** (`types/save.ts`, `systems/save.ts`, `systems/saveStorage.ts`): snapshot thuần
  (`schemaVersion`, `savedAt`, `mapId`, `worldSeed`, clock, player + inventory, cửa, container + items, zombie
  sống, bộ đếm spawn, zoom) chụp ở ranh giới tick (`runtime.createSnapshot`, ngay sau `tick` hoặc khi pause).
  IndexedDB một slot, mỗi ghi là một transaction (nguyên tử), lỗi quota/chặn trả về thông báo rõ.
  `validateSaveGame` từ chối schema khác phiên bản (báo "không tương thích"), bản đồ khác, dữ liệu hỏng/NaN/
  item lạ/ID zombie trùng. `runtime.loadSnapshot` bắt đầu như ván mới cùng seed rồi ghi đè, không tạo zombie
  từ điểm spawn và không gieo lại loot; Scene remount theo `sessionId` và đặt body ở vị trí đã lưu.
- **Menu**: Continue bật khi có bản lưu hợp lệ (hiện ngày/giờ/máu/đã hạ); New Game khi đã có bản lưu hỏi
  xác nhận và xóa slot. Pause: Lưu game, Lưu và về menu, Về menu (không lưu). Tự động lưu mỗi 60 s game.
  Chết là hết ván: bản lưu bị xóa.
- **Test:** 112 unit test (thêm spawn, validate schema, round-trip snapshot/load nhiều lần không nhân đôi,
  dọn xác, autosave, daylight).

Playtest headless Sprint 5: đổi giờ thấy đêm/ngày, giết một con thì con mới spawn cách ≥ 16 m, xác được dọn,
lưu thủ công → reload trang → Continue khôi phục đúng vị trí, chỉ số, túi, cửa mở (đi được trong nav), tủ đã
lấy, 8 zombie, seed; Continue lần hai không nhân đôi; autosave có toast; chết thì save bị xóa; bản lưu
schemaVersion 99 bị báo không tương thích; New Game hỏi xác nhận rồi xóa slot; không lỗi console.

Sprint 6 (xong):

- **Playtest tự động 30 phút** (`src/game/core/soak.test.ts`): bot đi loot 7 tủ theo lộ trình, mở cửa, đánh/đẩy,
  ăn uống; body giả bám lưới điều hướng. Kiểm tra bất biến (ID duy nhất, ≤ `maxActive` zombie sống, snapshot mỗi
  phút hợp lệ và load lại cho cùng snapshot) và in `SOAK REPORT`. Lần chạy đầu cho thấy bot **không bao giờ bị
  trúng đòn** (gậy + đẩy khóa cả nhóm) → chỉnh `config.ts`: gậy cooldown 0,8 → 1,0 s, knockback 1,5 → 1,0 m,
  khựng 0,35 → 0,2 s, thể lực 10 → 12; đẩy cooldown 1,2 → 2,0 s, thể lực 15 → 20, knockback 3 → 2,5 m; zombie tốc
  độ 2 → 2,3, wind-up 0,4 → 0,3 s. Sau chỉnh: 30 phút sống sót, 11 kill, trúng 60 sát thương, máu thấp nhất 40,
  dùng 4 nước/3 đồ hộp/1 băng, còn dư đồ y tế.
- **Âm thanh** (`src/game/audio/sfx.ts`): tổng hợp bằng Web Audio (oscillator + noise + envelope), không asset
  ngoài: vung/trúng gậy, đẩy, zombie đau/chết/phát hiện, người chơi trúng đòn, cửa, tủ, ăn/uống/băng, nhặt đồ,
  lưu, UI. Mở khóa AudioContext ở pointerdown/keydown đầu tiên; giới hạn spam theo từng hiệu ứng.
- **Cài đặt và hướng dẫn** (`src/components/Settings.tsx`, `stores/settingsStore.ts`): panel Cài đặt và Hướng
  dẫn (mục tiêu + điều khiển) trong menu chính và pause; đổi bóng/pixel ratio remount Canvas.
- **Hoàn thiện:** overlay "Đang tải…" tới khi scene tick 2 frame (che khung hình body chưa đặt chỗ khi load);
  tách chunk build (`advancedChunks`: rapier/three/r3f/react/vendor), `base: './'`; workflow GitHub Pages;
  `renderer powerPreference: high-performance`.
- **Test:** 113 unit test.

Playtest bản production (`vite preview`, headless): tải 9 asset < 1 s, không `window.__runtime`, Hướng dẫn/Cài đặt
mở và lưu localStorage, New Game → HUD, F3 hiện FPS, chơi 20 s, Lưu và về menu → reload → Continue đúng giờ,
autosave ghi đè slot sau 60 s; không lỗi console (chỉ 2 cảnh báo deprecated từ thư viện).

**Trạng thái Phase 1:** mọi mục phạm vi bắt buộc đã chạy cùng nhau trong bản build. Còn thiếu để đóng MVP:
deploy thực tế (cần bật GitHub Pages và push) và **đo FPS + playtest thủ công trên máy thật** để xác nhận mốc
~60 FPS và cảm nhận cân bằng.
