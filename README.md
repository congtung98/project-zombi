# Zombie Outbreak — Phase 2

Game sinh tồn zombie 3D góc nhìn isometric chạy trên trình duyệt. Kế hoạch chi tiết nằm trong
`Zombie_Outbreak_Phase_1_MVP.md` và `Zombie_Outbreak_Phase_2_Plan.md`. Repo đã hoàn thành mã Phase 1 (Sprint 1–6), **Phase 2 — Sprint 1** (dữ liệu item, migration save, thử cửa động), **Sprint 2** (bắt đầu tay không, loot melee, độ bền/hỏng), **Sprint 3** (model/animation, tạo nhân vật), **Sprint 4** (hành động có thời gian, sửa vũ khí, chế tạo) , **Sprint 5** (zombie nghe tiếng bước chân, lang thang/di cư theo đàn, phá cửa) , sprint bổ sung **tầm nhìn người chơi** (chỉ thấy zombie trong hình quạt/không bị che) và **ánh sáng trong nhà** (phòng, cửa sổ, rèm, đèn). Bản build production
nằm trong `dist/` sau `npm run build`; workflow GitHub Pages ở `.github/workflows/deploy.yml`.

## Chạy

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit test (Vitest) cho luật game cốt lõi
npm run build      # tsc -b && vite build  → dist/ (base './', chạy được ở root hoặc sub-path)
npm run preview    # phục vụ dist/ để chơi thử bản production
npm run lint
# Map editor (M3–M9): npm run dev rồi mở http://localhost:5173/editor.html — hướng dẫn docs/map-editor-guide.md
npm run build:editor   # → dist-editor/ (tách khỏi bản build game; npm run check:bundle kiểm tra)
npm run map:unpack -- <world>.mappack.json   # ghi file Export của editor vào content/maps/<world>/ → chơi: menu chính › Đổi world
npm run map:unpack -- <pack> --world-id <id>  # ghi pack thành world mới (như nút Lưu thành… của editor)
npm run map:check -- --deep                  # validate + kiểm tra sâu (đi tới được, tầm tương tác, collider chồng)
npm run map:generate -- --seed 42 --blocks 2x2 [--layout varied] [--trees 0..1]   # thị trấn sinh tự động (tất định) → content/maps/gen-42/
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
| Chuột trái | Đánh bằng vũ khí đang cầm về phía con trỏ (stamina/cooldown/tầm theo vũ khí). Tay không: chỉ hiện gợi ý |
| Space | Đẩy zombie ra xa, không gây sát thương (cooldown và stamina riêng) |
| E | Tương tác với cửa (mở/đóng) và container gần nhất trong tầm, ưu tiên hướng nhìn |
| Con lăn chuột | Zoom camera trong giới hạn min/max |
| Esc | Tạm dừng (dừng simulation, cooldown và đồng hồ); menu pause có Lưu game / Lưu và về menu |
| F3 | Overlay debug: FPS, vị trí, trạng thái zombie (và collider Rapier) |
| E (công tắc cạnh cửa / sát cửa sổ bên trong) | Bật/tắt đèn trần của phòng (cần điện); kéo/mở rèm (bớt ánh sáng, che tầm nhìn qua kính) |
| F6 | Debug ánh sáng trong nhà: viền phòng theo độ sáng, số liệu Direct/Propagated/Artificial/Final, cửa, cửa sổ, đồ thị phòng (`?lighting=debug`) |
| F4 | Debug tầm nhìn người chơi: vòng tầm nhìn/gần, hình quạt, tia LOS xanh/đỏ, nhãn trạng thái trên zombie (`?vision=debug` bật sẵn) |
| I | Mở/đóng túi 12 ô. Click trái chọn món → thẻ chi tiết (damage, độ bền, trạng thái) với Trang bị/Dùng, Cất vào tủ, Thả xuống. Chuột phải dùng/trang bị nhanh; Shift+trái cất nhanh khi mở tủ. Panel tủ: click lấy hoặc Lấy tất cả. Đồ thả tạo túi đồ rơi, E để nhặt lại |
| I → click vũ khí → Sửa | Sửa vũ khí (đồ gỗ: 1 ván + 1 băng keo, +30; đồ kim loại: 1 kim loại vụn + 1 băng keo, +25), mất 4–5 s. Bảng **Chế tạo** cạnh túi: gậy gỗ tự chế (2 ván + 1 băng keo) |
| X | Hủy sửa/chế tạo đang làm (di chuyển, đánh, đẩy hoặc bị trúng đòn cũng hủy; không mất nguyên liệu) |
| Esc (khi túi mở) | Đóng túi/tủ trước, nhấn lần nữa mới tạm dừng (tạm dừng thì thao tác đang làm cũng dừng) |

Zombie nhìn phía trước mặt và **nghe tiếng bước chân** quanh mình (đi bộ 5 m, chạy 12 m, đứng yên im lặng, qua tường
còn một nửa). Khi nghe thấy tiếng bước chân của chính mình là lúc zombie xung quanh có thể nghe bạn. Zombie đã thấy/nghe bạn sẽ **đập cửa** đóng chặn đường (cửa rung, sẫm dần, prompt E hiện độ bền) và phá
được; zombie chưa phát hiện bạn thì không biết bạn ở trong nhà.

Tab mất focus sẽ tự tạm dừng và xóa mọi phím đang giữ. Ở chế độ dev, `window.__runtime` trỏ tới
simulation để kiểm tra từ console hoặc kịch bản playtest tự động.

## Cấu trúc mã

```text
content/maps/<world>/  nội dung map: world.json, prefabs/, chunks/ (32 m), migrations/ (docs/map-content-format.md)
scripts/map-tools/     check.ts (npm run map:check [--deep]), deep-check.mjs, generate.ts, import-legacy.ts, pack.ts / unpack.ts
editor.html, playtest.html  entry riêng của map editor và trang chơi thử (chỉ trong bản build editor)
src/
  map/                 schema, transform (xoay/chunk/ID), validate, resolve (JSON → MapData), loader (ChunkLifecycle),
                       content (nạp JSON đi kèm bundle), analysis (kiểm tra sâu), tools/ (importLegacy, tileWorld, generator),
                       editor/ (document bất biến, lệnh world + prefab, lịch sử undo/redo, content pack, preset palette, layer — thuần TS)
  editor/              UI map editor (React + R3F): viewport, palette theo tab, chunk/layer, chế độ sửa prefab, inspector, validate, nháp IndexedDB riêng, chơi thử
  playtest/            trang chơi thử: nhận bản chụp từ editor, game thật với save trong bộ nhớ
  app/                 App (điều hướng màn hình), GameCanvas
  game/
    core/              config, clock (ngày/đêm, restore), events, runtime (thứ tự tick, spawn, di cư, đòn vào cửa, snapshot/load)
    entities/          player, zombie (state thuần), items (định nghĩa vật phẩm, ID ổn định), recipes (craft/repair)
    systems/           input, movement, ai (FSM: nhìn/nghe/trí nhớ, lang thang, vây cửa + bám path), horde (đạo diễn di cư),
                       combat, survival (+ dùng vật phẩm), interaction,
                       inventory (add/remove/transfer), loot (PRNG seed, bảng loot), spawn (chọn điểm spawn),
                       save (validate schema, tóm tắt), saveStorage (IndexedDB), crafting (kiểm tra/commit
                       recipe), timedAction (reservation, tiến độ)  (+ unit test)
    world/             buildings (kiểu + generator nhà tham số cho door lab/test), mapData (kiểu MapData + nạp khu phố từ
                       content), legacyContent (map cũ đóng băng cho save v1–v7), worldState (cửa/container + loot),
                       lootTables (bảng loot đặt tay), navigation (lưới A*, cửa mở/đóng/vỡ, vùng liên thông, chọn cửa phá)
    rendering/         Scene, CameraRig, CursorProbe, Ground, Roads, StaticBatches (tường/sàn/mái/container gộp theo
                       chunk), ChunkColliders (collider Rapier quanh người chơi), DoorView, ContainerView, WindowView,
                       PlayerView, ZombieView, Lights (+ daylight), OcclusionFader, GameLoop
      character/       rig dựng bằng code (khớp, weaponSocket), pose thuần (animation), model vũ khí, animator sau tick
  components/          HUD, Menus (main/pause/game over), Inventory (túi 12 ô + sửa), ContainerPanel (panel tủ + overlay),
                       CraftingPanel (bảng chế tạo)
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
- **Rapier chỉ lo thân người chơi.** Simulation đặt vận tốc cho body người chơi; collider tĩnh chỉ nạp cho các
  chunk quanh người chơi. Zombie do simulation di chuyển (va chạm hộp), body kinematic chỉ để chặn người chơi.
- **Simulation không import Rapier.** Che chắn (zombie thấy/đánh, tương tác, cận chiến, che spawn) là truy vấn
  đoạn thẳng trên `StaticColliderRegistry` (cùng bộ hộp); test thay được bằng `setLineOfSightOverride`.
- **Điều hướng không dùng physics.** `NavGrid` dựng một lần từ map data (ô 0,5 m, vật cản nới theo bán kính
  tác nhân); trạng thái cửa chỉ đổi các ô trong khung cửa và vùng cánh cửa mở. Lưới chia tile theo chunk
  (`navTiles`): vùng liên thông theo tile, đường xa đi đồ thị điểm chuyển tiếp (HPA*). AI nhận
  `findPath`/`hasLineOfWalk` qua context nên test được bằng hàm giả.
- **Map là dữ liệu.** Khu phố nằm trong `content/maps/neighborhood-50/` (prefab + chunk JSON); `src/map/` kiểm tra
  và resolve thành `MapData`. Mọi thực thể có ID ổn định `<chunk>/<instance>/<localId>` (ví dụ `c-1_-1/safehouse/door`);
  `worldState` và save (v8) giữ trạng thái theo ID này.
- **Cấu hình tập trung** trong `src/game/core/config.ts`; số liệu là giá trị thử nghiệm để chỉnh sau playtest.

## Trạng thái theo kế hoạch

### Chọn world trong game + khu phố đóng băng cho test (26/09/2026)

- Menu chính có **Đổi world**: mọi world trong `content/maps/` (kể cả output của `map:unpack`/`map:generate`) chơi được mà không cần `?world=`. Mỗi world một slot save; game nhớ lựa chọn. `"listed": false` ẩn world thử nghiệm.
- Test chạy trên bản khu phố đóng băng (`src/test/fixtures/maps/`), nên sửa khu phố thật không làm vỡ test. Chi tiết `docs/world-menu.md`.

### Map editor M9: generator nhiều biến thể + cây cối (26/09/2026)

- Cây (`kind: "tree"`, tán tròn hoặc thông) trong chunk và prefab: thân chặn đường/tầm nhìn như cột, tán vẽ theo batch và mờ đi khi che người chơi. Palette, Inspector, tay cầm tán, layer Cây.
- Generator v2: bố cục `varied` (khối 22–34 m, lô không đều, công viên) và mật độ cây (luồng ngẫu nhiên riêng); vùng chơi chữ nhật. Save không đổi (v8). Chi tiết `docs/map-editor-m9.md`.

### Map editor M8: migration nội dung cho save (26/09/2026)

- Thêm/bỏ/đổi tên cửa, tủ, cửa sổ, đèn, zone của world đã phát hành mà save người chơi vẫn nạp được: `migrations/content-v<N>.json` (tập ID bản cũ + đổi tên), tạo bằng panel **Tương thích save** (Inspector → World).
- Continue chuyển save sang nội dung mới: trạng thái giữ theo ID/đổi tên, thứ mới ở trạng thái ban đầu, đồ trong tủ bị bỏ rơi xuống đất, bản gốc được backup. Save v1–v7 đi qua nội dung v1 rồi tiếp. Save vẫn v8. Chi tiết `docs/map-editor-m8.md`.

### Map editor M7: hoàn thiện editor (26/09/2026)

- Viewport gộp mesh theo chunk (thị trấn 4×4: 1 495 → 135 draw call). Tay cầm đổi kích thước cho khối, đường, zone (bán kính zone tròn), phòng và tường chạy trong prefab; kéo vị trí đèn trên trần.
- Lớp vẽ mặt nền (`layer` 0–4) để mặt nền chồng nhau không nhấp nháy. Vùng chơi hình chữ nhật lệch tâm (`playArea.depth/center`), khớp theo các chunk; NavGrid, mặt đất, hàng rào và save theo nó.
- Nút **Lưu thành…** (world mới từ bản đang sửa) và `map:unpack --world-id`. Save không đổi (v8). Chi tiết `docs/map-editor-m7.md`.

### Map editor M6: công cụ sản xuất (25/09/2026)

- **Play From Here**: ▶ Chơi từ đây (click điểm) / Từ spawn, chọn giờ; game thật trong khung phủ lên editor, chạy trên bản đang sửa; save chỉ trong bộ nhớ (không mở IndexedDB của game), map/nháp không đổi, về editor giữ nguyên mọi thứ.
- **Kiểm tra sâu** bằng NavGrid/tương tác/LOS của game (đi tới được, tầm tương tác, spawn/zone bị cô lập, spawn trong nhà, collider chồng, tủ ngoài phòng) trong editor và `map:check -- --deep`.
- **Generator** thị trấn tất định (editor: Mới → Sinh bằng generator; CLI `map:generate`), không ghi đè world sửa tay; thumbnail prefab; hướng dẫn `docs/map-editor-guide.md`; báo cáo hiệu năng. Save không đổi (v8). Chi tiết `docs/map-editor-m6.md`.

### Map editor M5: prefab editor (25/09/2026)

- Sửa prefab gốc từ palette hoặc từ instance (banner liệt kê instance bị ảnh hưởng), prefab mới (nhà mẫu 4 tường + cửa + phòng có đèn), nhân bản thành biến thể, xóa prefab không dùng. Palette prefab: tường kéo theo trục (**`wallRun`**: game tự khoét khe cho cửa/cửa sổ đặt lên nó, dựng lanh tô/bệ cửa sổ), cửa/cửa sổ bám tường và mở vào trong, nội thất, tủ có loot, phòng kéo khung + đèn/công tắc. Xem xoay 0–270°, vòng tầm tương tác.
- Sửa tương thích (giữ local ID) thì save cũ vẫn giữ trạng thái cửa/loot/đèn; thêm/xóa/đổi tên mục có trạng thái thì hỏi xác nhận, khóa ID cũ (`retiredLocalIds`) và cảnh báo tăng contentVersion. Save không đổi (v8). Chi tiết `docs/map-editor-m5.md`.

### Map editor M4: world authoring (25/09/2026)

- Palette theo tab: Prefab, Object (tường/hàng rào kéo theo chiều dài, thùng, xe, container có loot), Nền (đường/vỉa hè/đất/sỏi, kéo khung), Zone (zombie chữ nhật kéo khung, tròn kéo bán kính), Spawn; tab **Chunk** thêm chunk bằng click ô trống, xóa chunk rỗng, trạng thái đã sửa/lỗi, khớp vùng chơi. **Layer** ẩn/khóa (chỉ trong editor), khung chọn, Ctrl+A, xoay object/nền/zone.
- **Zone chữ nhật** có tác dụng trong game: zombie trong zone chữ nhật thuộc zone nhỏ nhất chứa nó (còn lại: tâm gần nhất như S5) và lang thang trong hình chữ nhật. Cảnh báo mới `zone-assignment`, `surface-overlap`. Save không đổi (v8). Chi tiết `docs/map-editor-m4.md`.

### Map editor M3: editor MVP (25/09/2026)

- `/editor.html`: mở content trong repo/bản nháp/pack, đặt prefab (bóng mờ, xoay 90°), chọn/kéo (qua biên chunk giữ ID), Inspector, xóa/nhân bản, snap 1/0,5/0,25 m/OFF, nhìn trên xuống/isometric, undo/redo cho mọi thao tác, Validate dùng chung validator của game (click lỗi → chọn record), nháp IndexedDB riêng, Export/Import content pack. Output chạy trong game qua `npm run map:unpack` + menu *Đổi world* (trước đây `/?world=<id>`, dev; slot save riêng). Chi tiết `docs/map-editor-m3.md`.

### R3b: hiệu năng theo chunk (25/09/2026)

- LOS phía simulation (bỏ raycast Rapier), tường/sàn/mái/container vẽ bằng một `BatchedMesh` mỗi chunk, collider Rapier chỉ quanh người chơi, nav chia tile theo chunk (HPA* cho đường xa). Draw call map stress 335 → 106, CPU/frame ~10,5 → 5–7,6 ms. Chi tiết `docs/refactor-r3b.md`.

### Map content M1–M2 / R3a (25/09/2026)

- Khu phố chuyển thành 3 prefab + 4 chunk 32 m + manifest; validator dùng chung (runtime, test, `npm run map:check`); `ChunkLifecycle` đếm tham chiếu cho thứ vượt biên chunk. Bố cục và gameplay giữ nguyên (test so từng thực thể với map cũ).
- Save **v8**: ID ổn định + `contentVersion`; save cũ migrate qua map cũ đóng băng, giữ `slot-1.backup-v7`. Chi tiết `docs/map-editor-m1-m2.md`.

### Phase 2 — Sprint bổ sung: ánh sáng trong nhà (25/09/2026)

- **Room graph**: mỗi nhà chia phòng; cửa sổ cho ánh sáng ngày trực tiếp, cửa/lối mở truyền ánh sáng giữa các phòng và từ ngoài trời (mở 0,65, đóng 0,05, suy giảm 0,8/bước, tối đa 3 bước), đèn trần cộng ánh sáng nhân tạo (cần điện). Phòng sâu không cửa sổ tối hơn; đóng cửa thì tối hẳn; ban đêm bật đèn mới sáng. Tính lại theo sự kiện, không mỗi frame.
- Map: cửa sổ + rèm cho nhà an toàn, cửa hàng, nhà dân; nhà dân có **vách ngăn và phòng ngủ** (cửa phòng ngủ ban đầu mở); mỗi phòng một đèn + công tắc (E).
- Hiển thị: shader patch tại chỗ cho vật liệu (không clone, không PointLight): chỉ bề mặt trong phòng theo ánh sáng phòng; ngoài trời giữ nguyên theo ngày/đêm. Không phụ thuộc hướng nhìn hay PlayerVision (có test chặn).
- Save **v7** (rèm, đèn, điện, cửa phòng ngủ; backup `slot-1.backup-v6`). F6 debug, F3 dòng "Ánh sáng".
- **325 test**; Playwright dev + production (`scripts/p2-lighting-browser.mjs`, đo độ sáng sàn thật). Soak shelter vẫn sống 30' (patrol 719 s do vách mới đổi đường đi). Chi tiết `docs/phase2-lighting.md`.

### Phase 2 — Sprint bổ sung: tầm nhìn người chơi (25/09/2026)

- Camera vẫn thấy cả khu vực, nhưng zombie chỉ được vẽ khi **nhân vật thấy nó**: trong 2,5 m quanh người (cả sau lưng), hoặc trong hình quạt 110° / 20 m theo **hướng nhân vật quay**, và không bị tường, tủ cao hay cửa đóng che (hàng rào, thùng, xe thấp không che). Hiện/ẩn có fade 0,2 s và giữ thêm 0,15 s chống nhấp nháy.
- **Không đổi AI**: zombie bị ẩn vẫn lang thang, đuổi, đánh, đập cửa (test so simulation có/không có vision giống hệt; soak không đổi).
- Tầm nhìn **không làm tối thế giới**: khung cảnh sáng/tối chỉ theo giờ trong ngày ở mọi hướng. Thêm **VisionOverlay** rất nhẹ (một shader toàn màn hình): ngoài tầm nhìn dịu ~8 %, sau tường trong hình quạt ~12 %, tối đa 15 %, ban đêm một nửa; cạnh mềm, xoay mượt theo hướng nhân vật; tắt được ("Hiệu ứng tầm nhìn"). F4 vẽ debug (mask tô hồng); F3 thêm thống kê tầm nhìn/overlay. Config `playerVision` trong `config.ts`. Save không đổi (v6).
- **298 test**; Playwright dev + production (`scripts/p2-vision-browser.mjs`, đo độ sáng màn hình có/không overlay khi quay lúc 12:00/00:00/trong nhà, quay nhanh, zoom). Chi tiết `docs/phase2-vision.md`.

### Phase 2 — Sprint 5 (24/09/2026)

- **Cảm nhận**: zombie chưa phát hiện nhìn hình nón ±70° phía trước (10 m, mọi hướng trong 1,2 m); đang săn thì nhìn mọi hướng. **Nghe tiếng bước chân** trong bán kính cố định: đi bộ 5 m, chạy 12 m, đứng yên/sửa đồ im lặng, qua tường/cửa đóng còn một nửa. Nhớ vị trí thấy/nghe 20 s; người chơi chưa bị phát hiện sau tường kín không bao giờ bị nhắm.
- **Lang thang**: nghỉ 3–8 s → đi tới điểm ngẫu nhiên đi được trong vùng của mình (tìm đường A*) → nghỉ → điểm mới. **Di cư**: 8 vùng ngoài trời; mỗi 90–180 s một đạo diễn bên ngoài đẩy cả nhóm của một vùng sang vùng khác (ưu tiên vùng vắng).
- **Phá cửa**: zombie đã thấy/nghe bạn mà bị cửa đóng chặn sẽ chọn đúng cửa trên tuyến tới vị trí nhớ, tới một trong 2 chỗ đập mỗi phía (con khác xếp hàng), đập 10 HP/1,2 s; mở cửa lúc lấy đà hủy đòn; vỡ ở 0 HP (collider + đường đi cập nhật), zombie vào tìm rồi đuổi khi thấy lại. Âm đập/vỡ theo khoảng cách, cửa rung và sẫm theo HP. Respawn không bao giờ trong nhà.
- Save schema **v6** (trí nhớ, vùng, cửa đang đập, bộ đếm di cư; backup `slot-1.backup-v5`). F3 hiện trạng thái/vùng/trí nhớ zombie và bán kính tiếng bước chân.
- **259 test**; soak shelter vẫn sống 30' (lần đầu có zombie phá cửa nhà an toàn), patrol 853 s; Playwright dev + production (`scripts/p2-s5-browser.mjs`). Chi tiết `docs/phase2-s5.md`.

### Phase 2 — Sprint 4 (24/09/2026)

- **Vật liệu**: ván gỗ, kim loại vụn, băng keo (stack 10), đinh (stack 50). 3 chỗ loot mới: hộp đồ nghề nhà an toàn (luôn 1 ván + 1 băng keo + 1 kim loại vụn), kệ vật liệu cửa hàng (luôn đinh, ván, băng keo), đống phế liệu ngoài trời sau nhà dân (rủi ro hơn). Bảng loot cũ không đổi.
- **Hành động có thời gian** dùng chung: bắt đầu → đặt trước vật liệu → thanh tiến trình → hoàn tất nguyên tử; di chuyển/đánh/đẩy/trúng đòn/X hủy mà không mất gì; pause dừng tiến độ; save giữa chừng giữ trạng thái trước thao tác. Đồ đã đặt trước không thả/cất được.
- **Sửa vũ khí** trong thẻ chi tiết (xem trước độ bền nhận được, nguyên liệu thiếu); vũ khí hỏng sửa được, chặn ở max. **Chế tạo** gậy gỗ tự chế (18 dmg, độ bền 40). Tư thế làm việc trên rig.
- Save schema **v5** (thêm 3 container vật liệu một lần khi migrate, backup `slot-1.backup-v4`). Sửa lỗi ô tên màn tạo nhân vật mất ký tự đầu trong bản production.
- **211 test**; soak giữ nguyên số liệu; Playwright dev + production (`scripts/p2-s4-browser.mjs`). Chi tiết `docs/phase2-s4.md`.

### Phase 2 — Sprint 3 (24/09/2026)

- **Tạo nhân vật**: New Game → màn tạo nhân vật (tên ≤ 24 ký tự, 3 dáng, 3 kiểu tóc, 4 màu da/áo/quần, Ngẫu nhiên/Mặc định, preview 3D kéo để xoay) → Bắt đầu. Có save thì phải xác nhận ghi đè; "Quay lại" không xóa save. Ngoại hình không ảnh hưởng chỉ số.
- **Model/animation**: một rig low-poly dựng bằng code cho player và zombie (không asset ngoài, không vấn đề giấy phép): idle, đi, chạy, vung, đẩy, trúng đòn, chết; zombie giơ tay đuổi, đập, mắt đỏ khi săn, biến thể theo ID. Vũ khí gắn ở `weaponSocket` tay phải. Damage vẫn do combat quyết định; tay quét qua chính diện đúng frame gây damage.
- Save schema **v4** (tên + ngoại hình); save cũ nhận ngoại hình mặc định, backup `slot-1.backup-v3`. Sửa lỗi ô nhập không gõ được dấu cách.
- Cùng cảnh 10 zombie: draw call 147 → 271 (bóng High) / 238 (Low), tam giác 6 180 → 3 180. **173 test**, Playwright dev + production. Chi tiết `docs/phase2-s3.md`.

### Phase 2 — Sprint 2 (24/09/2026)

- New Game **tay không**; Space đẩy vẫn dùng được, click đánh chỉ hiện gợi ý. Tủ quần áo nhà an toàn luôn có một melee cơ bản (gậy hoặc ống sắt). Save Phase 1 migrate vẫn giữ gậy cũ.
- Bốn vũ khí: gậy (baseline Phase 1), ống sắt, xà beng, búa; chỉ số theo definition, condition theo instance. 4 container mới: tủ quần áo nhà an toàn, kệ dụng cụ cửa hàng (luôn có búa), tủ đầu giường nhà dân, thùng dụng cụ công viên. Loot và condition gieo một lần theo seed.
- Mỗi đòn trúng mất 1 độ bền (một lần mỗi cú vung dù trúng nhiều con; đánh trượt không mất). Condition 1 → 0 vẫn đủ damage; vũ khí **hỏng** còn 20% damage, vẫn cầm/thả/lưu được. Cảnh báo vàng ≤ 25%, đỏ + âm thanh khi vừa hỏng; HUD hiện vũ khí đang cầm.
- Save schema **v3**: v1 → v2 → v3 hoặc v2 → v3 khi Continue, thêm các tủ mới đúng một lần, không reroll tủ cũ; backup `slot-1.backup-v1`/`-v2` trong cùng transaction.
- Kiểm chứng: **157 test**, build/lint; Playwright + Chromium kiểm tra dev và production bằng input thật. Soak tách chính sách *shelter* (cổng: 30' sống, 11/11 tủ) và *patrol* (chỉ số liệu: chết ở 12'). Phát hiện: baseline soak Phase 1 "30 phút, 11 kill" chủ yếu là bot kẹt góc cửa nhà an toàn. Chi tiết: `docs/phase2-s2.md`.
- Phòng thử `?lab=doors` có thêm "Bộ vũ khí thử (gậy 1, búa hỏng)".

### Phase 2 — Sprint 1 (24/09/2026)

- Item có ID instance và kind; hai gậy giữ condition riêng qua equip/transfer/drop/save. Equipment tham chiếu ID trong túi, vẫn chiếm một trong 12 ô. S1 còn cấp gậy lúc New Game để giữ vòng chơi Phase 1; S2 mới bỏ cấp gậy, thêm loot melee và hao mòn/broken damage.
- Save schema **v2**, tự chuyển v1 khi Continue. Giữ nguyên consumable, vị trí, chỉ số, clock, cửa và loot đã lấy. Túi cũ đầy: gậy nằm trong túi đồ rơi dưới chân, không xóa món khác hay tăng capacity.
- IndexedDB giữ bản gốc tại `slot-1.backup-v1` trước khi ghi v2 trong cùng transaction. Nếu đã có backup khác, lưu thêm key có UUID. Chỉ xem menu không ghi/migrate slot; schema lạ hoặc ownership sai bị từ chối. Backup không bị xóa khi New Game/chết.
- Cửa có state `closed/open/destroyed` và HP; cửa vỡ gỡ cả mesh/collider. Nav cập nhật các ô cửa liên quan, tăng revision để AI repath. Truy vấn portal thử nghiệm chọn cửa thuộc tuyến tới mục tiêu, ưu tiên đường đang thông. Zombie chưa tự đập cửa (S5).
- Phòng thử: `npm run dev` → mở `http://localhost:5173/?lab=doors` → New Game. Dùng các nút đóng/mở/phá cửa, F3 xem collider. Mở cửa để zombie thấy player rồi đóng và bấm “Kiểm tra tuyến zombie”. “Thêm hai gậy 10 / 70” → Lưu thử → Nạp lại để kiểm tra instance. Lab dùng `slot-lab`, tách khỏi `slot-1`; query lab bị vô hiệu trong production.
- Kiểm chứng: **135 test**, gồm migration/ownership và Rapier capsule qua cửa; TypeScript/build/lint; Chrome headless kiểm tra IndexedDB, collider thật và save/reload. Xem `docs/phase2-s1.md` và `CURRENT_STATE.md` để tái lập.
- Soak sau sửa AI không có đường: **30 phút sống, 11 kill, 60 damage, minHealth 40, endHealth 65, 7/7 tủ, 29 snapshot round-trip**; dùng 4 nước/3 đồ hộp/1 băng, 11 spawn, tối đa 9 zombie. Không đổi thông số combat/spawn/survival.

### Lịch sử Phase 1

Các mục dưới đây ghi kết quả tại thời điểm từng sprint Phase 1; schema và hành vi hiện tại xem mục Phase 2 phía trên.

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
