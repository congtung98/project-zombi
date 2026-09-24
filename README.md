# Zombie Outbreak — Phase 1 (MVP)

Game sinh tồn zombie 3D góc nhìn isometric chạy trên trình duyệt. Kế hoạch chi tiết nằm trong
`Zombie_Outbreak_Phase_1_MVP.md`. Repo hiện ở **Sprint 3: AI và chiến đấu** (đã xong Sprint 1–2).

## Chạy

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit test (Vitest) cho luật game cốt lõi
npm run build      # tsc -b && vite build
npm run lint
```

## Điều khiển

| Phím | Hành động |
|---|---|
| W A S D | Di chuyển theo hướng màn hình (đi chéo không nhanh hơn) |
| Shift | Chạy, tiêu stamina; hồi khi ngừng chạy |
| Chuột trái | Vung gậy về phía con trỏ (tiêu stamina, có cooldown) |
| Space | Đẩy zombie ra xa, không gây sát thương (cooldown và stamina riêng) |
| E | Tương tác với cửa (mở/đóng) và container gần nhất trong tầm, ưu tiên hướng nhìn |
| Con lăn chuột | Zoom camera trong giới hạn min/max |
| Esc | Tạm dừng (dừng simulation, cooldown và đồng hồ) |
| F3 | Overlay debug: FPS, vị trí, trạng thái zombie (và collider Rapier) |
| I | Đã gắn binding, inventory làm ở Sprint 4 |

Tab mất focus sẽ tự tạm dừng và xóa mọi phím đang giữ. Ở chế độ dev, `window.__runtime` trỏ tới
simulation để kiểm tra từ console hoặc kịch bản playtest tự động.

## Cấu trúc mã

```text
src/
  app/                 App (điều hướng màn hình), GameCanvas
  game/
    core/              config, clock, events, runtime (thứ tự tick)
    entities/          player, zombie (state thuần)
    systems/           input, movement, ai (FSM + bám path), combat, survival, interaction  (+ unit test)
    world/             buildings (generator tường/cửa), mapData (khu phố 50×50), worldState (cửa/container),
                       navigation (lưới A*, cửa mở/đóng)
    rendering/         Scene, CameraRig, CursorProbe, Ground, Roads, Walls, BuildingView, DoorView,
                       ContainerView, PlayerView, ZombieView, Lights, OcclusionFader, PhysicsBridge, GameLoop
  components/          HUD, Menus (main/pause/game over)
  stores/              uiStore (màn hình), hudStore (snapshot HUD 10 Hz), worldStore (mirror cửa/container)
  types/               kiểu dữ liệu chia sẻ
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

Tiếp theo (Sprint 4): item definitions, inventory 12 ô, loot hữu hạn theo seed, panel container, dùng
thức ăn/nước/băng, cân bằng tài nguyên. `runtime.uiOpen` đã sẵn để chặn đòn đánh khi inventory mở.
