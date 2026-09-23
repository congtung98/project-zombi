# Zombie Outbreak — Phase 1 (MVP)

Game sinh tồn zombie 3D góc nhìn isometric chạy trên trình duyệt. Kế hoạch chi tiết nằm trong
`Zombie_Outbreak_Phase_1_MVP.md`. Repo hiện ở **Sprint 2: khu phố và tương tác** (đã xong Sprint 1).

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
| Con lăn chuột | Zoom camera trong giới hạn min/max |
| Esc | Tạm dừng (dừng simulation, cooldown và đồng hồ) |
| F3 | Overlay debug: FPS, vị trí, trạng thái zombie |
| E | Tương tác với cửa (mở/đóng) và container gần nhất trong tầm, ưu tiên hướng nhìn |
| Chuột trái / Space / I | Đã gắn binding, gameplay làm ở Sprint 3–4 |

Tab mất focus sẽ tự tạm dừng và xóa mọi phím đang giữ.

## Cấu trúc mã

```text
src/
  app/                 App (điều hướng màn hình), GameCanvas
  game/
    core/              config, clock, events, runtime (thứ tự tick)
    entities/          player, zombie (state thuần)
    systems/           input, movement, ai (FSM), survival, interaction  (+ unit test)
    world/             buildings (generator tường/cửa), mapData (khu phố 50×50), worldState (cửa/container)
    rendering/         Scene, CameraRig, Ground, Roads, Walls, BuildingView, DoorView, ContainerView,
                       PlayerView, ZombieView, Lights, OcclusionFader, PhysicsBridge, GameLoop
  components/          HUD, Menus (main/pause/game over)
  stores/              uiStore (màn hình), hudStore (snapshot HUD 10 Hz), worldStore (mirror cửa/container)
  types/               kiểu dữ liệu chia sẻ
```

Nguyên tắc:

- **Simulation không nằm trong React state.** `GameRuntime` giữ dữ liệu runtime; view đọc trực tiếp trong
  `useFrame`; UI chỉ nhận snapshot qua `hudStore` theo nhịp chậm.
- **Một nguồn thời gian.** `GameClock` chỉ tiến trong `runtime.tick()`, delta time bị giới hạn bởi
  `config.loop.maxDelta`.
- **Thứ tự tick cố định:** input → chuyển động/physics → AI → combat → survival/clock → phát sự kiện.
- **Physics do Rapier xử lý.** Simulation đặt vận tốc cho body, Rapier giải quyết va chạm với tường.
- **Simulation không import Rapier.** `PhysicsBridge` đăng ký một `PhysicsQuery` (raycast) vào runtime;
  logic tương tác/tầm nhìn test được mà không cần WASM.
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

Sửa lỗi sau playtest: zombie từng gây sát thương xuyên tường. Nay AI dùng raycast của `PhysicsQuery`
cho cả phát hiện lẫn đòn đánh: tường và cửa đóng chắn tầm nhìn, và ngay tại thời điểm gây sát thương
kiểm tra lại lần nữa. Hệ quả: zombie mất dấu người chơi sau 3 giây khi bị tường chắn và về IDLE.

Tiếp theo (Sprint 3): zombie đi vòng tường/qua cửa (navigation grid, nhớ vị trí cuối thấy người chơi),
combat cận chiến, knockback, Space đẩy. Zombie hiện đuổi thẳng nên sẽ kẹt ở tường, đúng như kế hoạch.
