# Zombie Outbreak — Phase 1 (MVP)

Game sinh tồn zombie 3D góc nhìn isometric chạy trên trình duyệt. Kế hoạch chi tiết nằm trong
`Zombie_Outbreak_Phase_1_MVP.md`. Repo hiện ở **Sprint 1: nền tảng và prototype**.

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
| Chuột trái / Space / E / I | Đã gắn binding, gameplay làm ở Sprint 2–4 |

Tab mất focus sẽ tự tạm dừng và xóa mọi phím đang giữ.

## Cấu trúc mã

```text
src/
  app/                 App (điều hướng màn hình), GameCanvas
  game/
    core/              config, clock, events, runtime (thứ tự tick)
    entities/          player, zombie (state thuần)
    systems/           input, movement, ai (FSM), survival  (+ unit test)
    world/             mapData: sân 50×50, hàng rào, tường thử nghiệm, điểm spawn
    rendering/         Scene, CameraRig, Ground, Walls, PlayerView, ZombieView, Lights, GameLoop
  components/          HUD, Menus (main/pause/game over)
  stores/              uiStore (màn hình), hudStore (snapshot HUD theo nhịp 10 Hz)
  types/               kiểu dữ liệu chia sẻ
```

Nguyên tắc:

- **Simulation không nằm trong React state.** `GameRuntime` giữ dữ liệu runtime; view đọc trực tiếp trong
  `useFrame`; UI chỉ nhận snapshot qua `hudStore` theo nhịp chậm.
- **Một nguồn thời gian.** `GameClock` chỉ tiến trong `runtime.tick()`, delta time bị giới hạn bởi
  `config.loop.maxDelta`.
- **Thứ tự tick cố định:** input → chuyển động/physics → AI → combat → survival/clock → phát sự kiện.
- **Physics do Rapier xử lý.** Simulation đặt vận tốc cho body, Rapier giải quyết va chạm với tường.
- **Cấu hình tập trung** trong `src/game/core/config.ts`; số liệu là giá trị thử nghiệm để chỉnh sau playtest.

## Trạng thái theo kế hoạch

Sprint 1 (đã có): scene + sân 50×50, input manager, player capsule + collider, WASD/Shift với stamina,
camera orthographic theo nhân vật có zoom, tường thử nghiệm, một zombie FSM (IDLE → CHASE → ATTACK)
đuổi và gây sát thương, HUD, menu/pause/game over, unit test cho movement, AI, survival và runtime tick.

Tiếp theo: playtest 5 phút theo mục 10 của kế hoạch, ghi nhận va chạm/camera/FPS, rồi mới dựng hai
công trình của Sprint 2.
