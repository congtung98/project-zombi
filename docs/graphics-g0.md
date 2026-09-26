# Đồ họa G0: audit, scene chuẩn và baseline

Ngày 26/09/2026. Bước đầu của kế hoạch nâng cấp đồ họa `docs/Graphics_Improvement_Implementation_Plan.md` (G0 → G6).

G0 **không đổi hình ảnh game**. Sprint này gồm:
- audit renderer và cách vẽ hiện tại;
- world thử `graphics-lab`;
- công cụ đo (log từng frame);
- script chụp ảnh và đo cố định;
- ảnh và số liệu baseline để các sprint sau so sánh.

Save, schema map và nội dung các world cũ không đổi.

Quyết định của chủ dự án áp dụng cho G1–G6:
- **Texture:** tự sinh bằng code, sinh một lần và cache, seed ổn định. Registry phải thay được bằng file ảnh sau này mà không sửa gameplay.
- **UV:** theo tọa độ thế giới chỉ cho đường, đất và mặt lớn. Đồ đạc, cửa và module xoay dùng UV cục bộ, cùng tỷ lệ vật lý.
- **Trường `visual`:** chỉ là cấu hình gọn, tùy chọn, có mặc định. Không đổi ID, collider, loot hay save.
- **Hiệu năng:** mục tiêu 60 FPS ở Medium trên máy hiện tại. Mỗi số đo phải ghi rõ môi trường đo.

Repo không có `AGENTS.md`; tài liệu gốc là `docs/CURRENT_STATE.md`.

## 1. Audit

### Renderer, màu, camera

| Mục | Hiện trạng |
| --- | --- |
| Phiên bản | three 0.186.0, @react-three/fiber 9.8.0, drei 10.7.8. `WebGLRenderer` (WebGL2), không dùng WebGPU. |
| Color management | Mặc định của R3F: `ColorManagement.enabled`, `outputColorSpace = srgb`, `ACESFilmicToneMapping`, exposure 1. Màu hex trong nội dung là sRGB, được đổi sang linear. |
| Texture | **Không có texture ảnh nào.** 13 texture trên GPU gồm: shadow map, dữ liệu của `BatchedMesh` (ma trận/màu/indirect), mask nội thất 256² và vài DataTexture nhỏ. |
| Khử răng cưa | `antialias: true`, MSAA 4 mẫu. |
| Pixel ratio | `dpr = [1, maxPixelRatio]`. Cài đặt cho chọn 1, 1,5 hoặc 2; mặc định **1,5**. |
| Bóng | Cài đặt `shadows`: off / low (Basic, 1024²) / high (PCF, 2048², mặc định). Một nguồn bóng duy nhất là mặt trời. |
| Camera | Orthographic, offset (20, 24, 20): nhìn chéo 45°, nghiêng ≈ 40°. `zoom` = số px mỗi mét: mặc định **28**, khoảng 14–60. Ở 1280×800 với zoom 28, khung nhìn rộng ≈ 46 m. |

**Tỷ lệ pixel dùng cho G2** (zoom 28):

| Kích thước | Pixel |
| --- | --- |
| 5 cm | ≈ 1,4 px |
| 10 cm | ≈ 2,8 px |
| 20 cm | ≈ 5,6 px |
| Tay nắm cửa 12 × 6 cm | ≈ 3 × 2 px |

Chi tiết nhỏ hơn khoảng 8 cm (≈ 2 px) không nên dựng bằng hình khối ở zoom mặc định. Ở zoom 60 thì 5 cm ≈ 3 px.

### Ánh sáng

- **Ngoài trời:** `Lights.tsx` gồm ambient, hemisphere và một directional light (mặt trời) đặt cố định ở (18, 32, 12), nhìn về gốc tọa độ. Cường độ và màu nội suy theo `daylightAt`; nền scene đổi theo ngày/đêm. Không có point light nào.
- **Camera bóng mặt trời cố định ±36 m quanh gốc tọa độ, không đi theo người chơi.** Đã kiểm bằng cách chiếu điểm vào không gian của nguồn sáng: ở `graphics-lab` (tâm 24, 24), nhà B (38, 6, 40) và cây thông (43, 7, 36) nằm ngoài vùng bóng, nên **không có bóng mặt trời**. `neighborhood-50` (±25 m) nằm trọn trong vùng. World sinh bằng generator (≥ 68 m) hoặc lệch tâm sẽ mất bóng ở rìa. Việc sửa thuộc G4.
- **Trong nhà:** `indoorShading.ts` gắn một bản vá vào `MeshStandardMaterial.prototype`. Fragment nằm trong phòng và dưới trần thì `outgoingLight = màu nền × ánh sáng phòng × hệ số hình khối` (hướng trời cố định). Hệ quả:
  - trong nhà không có mặt trời, không có bóng;
  - roughness và metalness không có tác dụng;
  - normal map chỉ tác động qua hệ số hình khối;
  - đèn phòng là uniform, không phải `Light` của Three.
- **Mask nội thất (M11c-1B):** áp sau ánh sáng, trong cùng bản vá. Material nào tự gán `onBeforeCompile` thì tự thoát khỏi bản vá, nên **material mới ở G1 phải nối tiếp bản vá này**, không được thay thế nó.
- **VisionOverlay:** là lớp phủ lên khung hình đã render, không phải ánh sáng.

### Vẽ, batching, tài nguyên

- **Batch tĩnh** (`StaticBatches.tsx`, `staticBatchData.ts`):
  - Mỗi chunk là một `BatchedMesh` với **một material trắng duy nhất**, màu tô theo từng instance. Hình học là khối đơn vị (hộp, mặt sàn, trụ, cầu, nón) co giãn theo từng instance.
  - Thêm một bản song sinh chỉ vẽ bóng (`SHADOW_ONLY`) cho các mảnh nhà bị cắt hoặc ẩn.
  - Vật che bị làm mờ thì vẽ thêm một mesh phủ, dùng `sharedBox(size)` với material dùng chung đã làm mờ.
- **Nguồn hình học:**
  - Tường và đồ đạc (`prop`) lấy thẳng từ registry collider, nên **ngoại hình chính là hộp va chạm**.
  - Container vẽ từ `map.containers`.
  - Sàn là mặt phẳng ở y = 0,02; tấm sàn tầng trên dày 0,2 m.
  - **Mái là tấm phẳng dày 0,2 m, nhô 0,3 m, không có độ dốc.**
  - Bậc thang là các hộp chồng lên nhau; cây gồm thân và tán.
- **UV:** khối đơn vị có UV 0..1 trên mỗi mặt nhưng bị co giãn theo từng vật. Mảnh bị **cắt lớp được vẽ bằng ma trận thấp hơn**, nên texture gắn theo UV của khối sẽ bị nén theo chiều cao. G1 phải tính UV từ kích thước vật lý.
- **Mesh riêng (component React theo từng thực thể):**
  - Đường: mỗi đường một mặt phẳng, dùng chung material theo màu.
  - Nền đất: một mặt phẳng, **cộng `gridHelper`/đường lưới 1 m phủ cả map**.
  - Cửa, cửa sổ, đèn, container: mỗi loại một component.
  - Nhân vật/zombie: `character/rig.ts`, **~11 mesh và 5 material riêng mỗi nhân vật**, 4 phần có bóng.
- **Vòng đời:**
  - `sharedResources.ts`: material và geometry dùng chung sống suốt app, mesh dùng `dispose={null}`.
  - Batch được giải phóng khi chunk rời khung nhìn (có `setTimeout` để chịu được StrictMode).
  - Material của rig được giải phóng theo rig.
  - Đo 10 vòng vào/ra nhà, ngày/đêm: số geometry, texture và program không đổi (mục 3).

### Cutaway, mask, bóng trên từng mảnh

- Mỗi `BatchedPiece` quyết định nguyên / cắt / ẩn, rồi đến làm mờ.
- Mảnh bị cắt hoặc ẩn bật instance trong batch bóng song sinh, nên vẫn giữ bóng.
- Cửa, kính, rèm, đèn, dấu container, zombie và túi đồ đọc chung `cutaway`.
- Collider, vật chắn tầm nhìn, điều hướng, AI, save và ánh sáng không đọc `cutaway`.

### Thực thể có trạng thái và stable ID

| Thực thể | Trạng thái lưu |
| --- | --- |
| Cửa | `state` (open / closed / destroyed) + `hp` |
| Container | loot, dấu đã mở |
| Cửa sổ | kính (collider, trong suốt) + rèm `closed` |
| Đèn phòng | `on` |
| Điện lưới | `electricity` |
| Zombie, túi đồ rơi | có |
| Khám phá nội thất | tùy chọn |

Tường, `prop`, cây và đường không có trạng thái; ID lấy từ nội dung. **Không có xe riêng**: xe hiện chỉ là một `prop` hộp 4 × 1,4 × 2 m.

### Quan sát từ ảnh baseline

1. Mọi thứ là hộp màu phẳng:
   - Sofa, giường, tủ đều là một hộp.
   - Cửa là một cánh phẳng với tay nắm hộp.
   - Cửa sổ chỉ có tấm kính; bệ và đầu cửa là các hộp tường, không có khung.
   - Mái là tấm phẳng xám.
2. Đường lưới 1 m trên nền cỏ là dấu hiệu "prototype" rõ nhất. Ban đêm đường lưới **sáng hơn mặt đất** vì `LineBasicMaterial` không nhận ánh sáng.
3. Đường và vỉa hè là mặt phẳng cùng độ cao, không có lề. Nền ngoài map gần đen cả ban ngày. Tường biên là hộp nâu.
4. Trong nhà nhìn phẳng: ánh sáng phòng thay mặt trời, không có bóng tiếp xúc. Mép vùng đang thấy có bậc ô 0,25 m (giới hạn đã biết của M11c-1B).
5. Nhà B không có bóng mặt trời (xem mục Ánh sáng).

## 2. Scene chuẩn `graphics-lab`

`content/maps/graphics-lab`: ẩn khỏi menu, một chunk 48 m, vùng chơi 48 × 48 m tâm (24, 24). Chơi bằng `?world=graphics-lab`. World này **không đóng băng** trong fixture, vì các sprint sau sẽ thêm trường `visual` vào nó. `src/map/graphicsLab.test.ts` giữ các thành phần mà kế hoạch yêu cầu.

**Prefab `building/lab-house`** (12 × 9 m, 2 tầng, cao 3 m mỗi tầng):
- Tầng trệt:
  - phòng khách: sofa, bàn nước, ghế bành, kệ;
  - bếp: tủ bếp, tủ lạnh, bàn ăn, hai ghế;
  - phòng ngủ: giường, tủ đầu giường, tủ quần áo.
- Cửa: chính, bếp, phòng ngủ, sau. Năm cửa sổ.
- Cầu thang dọc tường bắc phòng khách.
- Tầng trên: hành lang (có kệ) và phòng ngủ (giường, bàn, tủ); cửa trong mở sẵn, ba cửa sổ.
- Mỗi phòng có đèn và công tắc.

**Chunk:**
- Nhà A ở (16, 12) không xoay, mặt trước hướng ra đường.
- **Nhà B dùng cùng prefab**, ở (32, 36) xoay 180°, để bắt lỗi ảnh hưởng chéo và lỗi xoay.
- Ngoài trời:
  - đường nhựa 6 m chạy dọc trục x, hai vỉa hè 1,5 m, lối đi vào mỗi nhà;
  - sân nhà A rào ba mặt, rào trắng thấp trước nhà B;
  - bốn cây (tròn và thông), một xe (`prop`), hộp thư, hai thùng rác (một cái là container);
  - điểm xuất phát người chơi và ba điểm spawn zombie.
- `map:check --deep` sạch.

## 3. Đo và chụp: `scripts/g0-graphics-baseline.mjs`

```
BASE_URL=http://127.0.0.1:5173 PLAYWRIGHT_MODULE=file:///…/playwright/index.mjs CHROMIUM_PATH=<chrome.exe> \
  node scripts/g0-graphics-baseline.mjs --gpu [--uncapped] [--headed] [--jpeg] [--out=…] [--compare=<thư mục lần trước>]
```

**Cố định mỗi lần chạy:**
- viewport 1280 × 800, device scale = `--dpr` (mặc định 1), cài đặt `shadows` = `--shadows` (mặc định high), vision overlay bật;
- zoom theo cảnh, giờ trong ngày, vị trí và hướng nhân vật;
- 8 zombie đứng yên ở điểm cố định, spawn tự nhiên tắt;
- chuột không di chuyển (không ngắm);
- mỗi cảnh warm-up 3 s rồi lấy mẫu 6 s.

**Sáu cảnh:**

| Cảnh | Mô tả |
| --- | --- |
| `day-outside` | ngoài trời ban ngày |
| `day-inside` | trong phòng khách, đang cắt lớp |
| `day-upstairs` | tầng trên |
| `day-wide` | zoom 14, toàn cảnh |
| `night-outside` | ngoài trời ban đêm |
| `night-inside-lamp` | trong nhà ban đêm, bật đèn phòng khách và bếp |

**Đại lượng đo:**
- **Frame time:** khoảng cách giữa hai frame render (delta của R3F), ghi **từng frame** qua `runtime.perf.startFrameLog()` / `takeFrameLog()`. Báo median / p95 / p99 / max, không chỉ FPS trung bình.
- **CPU:** từ `useFrame` đầu tiên tới hết `gl.render`.
- **Draw call và tam giác:** của `gl.info`, gồm cả lượt vẽ shadow map.
- **Số lượng:** mesh, mesh đang hiện, batch/instance, đèn, vật đổ bóng, material/geometry/texture duy nhất, `gl.info.memory`, số program.
- **Bộ nhớ ước tính:**
  - texture = rộng × cao × byte/texel theo format/type, × 4/3 nếu có mipmap;
  - shadow map tính cả texture màu lẫn depth, nên là **cận trên**;
  - framebuffer = điểm ảnh × 8 byte × số mẫu MSAA + bộ đệm resolve;
  - geometry = byte của attribute và index.
  - Đây là ước tính, không phải số VRAM thật. Dung lượng PNG không dùng làm VRAM.
- **JS heap:** `performance.memory`.
- **Vòng đời:** 10 vòng vào/ra nhà A, ngày/đêm, so số tài nguyên trước và sau.
- **Tải:** menu lạnh/ấm (số request, byte truyền/nén/giải nén), thời gian từ "New Game" tới HUD. Chạy với bản production (`vite preview`) thì script **chỉ đo tải**, vì bản production không có hook dev.
- **Tái lập:** `--compare` so từng ảnh với lần chạy khác, trong trình duyệt. Báo % pixel lệch trên ngưỡng 24/255 và độ lệch trung bình.

**Chế độ trình duyệt:**
- `--gpu`: GPU thật qua ANGLE D3D11. Không có cờ này thì Chrome render bằng SwiftShader (CPU): frame time vô nghĩa, nhưng draw call và các số đếm vẫn đúng.
- Headless không khóa theo vsync mà theo nhịp riêng (~6,1 ms, ≈ 164 Hz), nên median luôn là 6,1 ms.
- `--uncapped` (`--disable-frame-rate-limit --disable-gpu-vsync`) cho **chi phí render thật** của từng cảnh.
- `--headed` mở cửa sổ thật; khi đó frame bị khóa theo tần số quét màn hình, gần nhất với trải nghiệm người chơi.

## 4. Baseline (máy hiện tại)

**Môi trường:**

| Mục | Giá trị |
| --- | --- |
| Hệ điều hành | Windows 11 (10.0.26200) |
| CPU / RAM | Intel i5-11500 (12 luồng), 16 GB |
| GPU | NVIDIA GeForce RTX 3060, ANGLE Direct3D11 |
| Trình duyệt | Chrome 154.0.8037.57, **headless** |
| Server | Vite dev server (bản dev của React) |
| Khung hình | 1280 × 800, DPR 1, MSAA 4 |
| Cài đặt | bóng high (PCF 2048²) — Medium chưa tồn tại, đây là mặc định hiện tại nhưng DPR ép về 1 |
| Cảnh | zoom 28 (toàn cảnh 14), 8 zombie, warm-up 3 s, mẫu 6 s |

Dữ liệu gốc: `docs/graphics/g0-baseline/report.json` (có khóa nhịp, kèm ảnh) và `report-uncapped.json`.

**Chi phí render, `--gpu --uncapped`** (ms):

| Cảnh | Frame median | p95 | p99 | max | CPU median | CPU p95 | Draw call | Tam giác | Mesh hiện |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| day-outside | 3,4 | 10,0 | 12,9 | 17,1 | 2,8 | 8,5 | 145 | 5 944 | 123 |
| day-inside | 3,5 | 8,9 | 11,0 | 22,7 | 2,7 | 7,1 | 60 | 5 000 | 74 |
| day-upstairs | 2,7 | 7,0 | 9,1 | 15,4 | 2,1 | 5,5 | 70 | 4 784 | 89 |
| day-wide | 3,6 | 8,4 | 10,7 | 16,0 | 2,9 | 7,0 | 116 | 6 146 | 98 |
| night-outside | 3,2 | 6,4 | 8,8 | 11,8 | 2,6 | 5,3 | 145 | 5 944 | 123 |
| night-inside-lamp | 2,6 | 5,3 | 7,1 | 9,3 | 2,1 | 4,3 | 60 | 5 000 | 74 |

**Chế độ khóa nhịp headless** (`report.json`): median 6,1 ms mọi cảnh; p95 6,4–10,7 ms; max 6,8–17,3 ms.

**Bóng low** (tham khảo): draw call 133 / 57 (ít hơn 12 ở ngoài trời, 3 ở trong nhà); frame time trong cùng khoảng.

**Nhận xét:**
- Median ≤ 3,6 ms, p99 ≤ 12,9 ms, đều dưới 16,7 ms (60 FPS). Còn nhiều dư địa **trên máy này**, nhưng không kết luận được cho máy yếu.
- Thời gian này là CPU nhiều hơn GPU: CPU median 2,1–2,9 ms.
- Draw call ngoài trời gấp đôi trong nhà. Mức chênh khớp với ước tính theo `rig.ts`: mỗi nhân vật ~11 mesh + 4 mesh đổ bóng. Chưa đo tách riêng.

**Tài nguyên** (giống nhau ở mọi cảnh):

| Mục | Giá trị |
| --- | --- |
| Texture / geometry / program trên GPU | 13 / 56–57 / 11–12 |
| Material duy nhất | 112–133 (chủ yếu 5 material mỗi rig nhân vật) |
| Batch tĩnh | 3 `BatchedMesh`, 382 instance |
| Đèn | 3, trong đó 1 đổ bóng |
| Texture (ước tính) | 33,8 MB — shadow map 2 × 16,8 MB là cận trên; mask nội thất 0,26 MB; dữ liệu batch ≈ 30 KB |
| Framebuffer (ước tính) | ≈ 36,9 MB |
| Geometry | ≈ 80 KB |
| JS heap (bản dev) | 87–122 MB, dao động |

**Vòng đời:** trước và sau 10 vòng vẫn là 57 geometry, 13 texture, 11 program.

**Tải:**

| Đo | Menu | Request | Truyền | Nén / giải nén | Vào game |
| --- | --- | --- | --- | --- | --- |
| Production, localhost, lạnh | 290 ms | 12 | 1,96 MB | 4,46 MB sau giải nén | New Game → HUD 994 ms |
| Production, localhost, ấm | 105 ms | — | 3,6 KB | — | — |
| Dev server, lạnh | 1,9 s | — | 32 MB (mã chưa đóng gói) | — | không đại diện |

Không giới hạn mạng. Bundle production: rapier 2,24 MB (842 KB gzip), three 737 KB (187 KB gzip), r3f 424 KB; world `graphics-lab` là chunk riêng 9,6 KB.

**Tái lập:** hai lần chạy PNG cho 0 % pixel lệch, độ lệch trung bình 0. Bản JPEG so với PNG lệch 0,2 %, do nén.

**Ảnh:** `docs/graphics/g0-baseline/*.jpg` (JPEG chất lượng 88, 73–168 KB mỗi ảnh). Nếu không muốn đưa ảnh vào git, chạy lại script để tạo ra chúng.

**Chưa đo, không tuyên bố:**
- FPS trên cửa sổ thật có vsync (`--headed`);
- hiệu năng trên máy yếu (Low);
- thời gian GPU tách riêng (chưa dùng timer query);
- frame time của bản production (script cần hook dev).

## 5. Mã

- `src/game/core/perf.ts`: `FrameLog`, `startFrameLog`/`takeFrameLog` (tối đa `FRAME_LOG_MAX` = 20 000 frame). `recordFrame` ghi kèm draw call và tam giác của frame.
- `src/game/rendering/PerfProbe.tsx`: cập nhật gauge trước `recordFrame`.
- `src/game/rendering/GameLoop.tsx`: chỉ ở dev, thêm `window.__gl` (renderer) cạnh `__scene`/`__renderInfo`.
- `content/maps/graphics-lab/` (world, chunk, prefab `lab-house`).
- `scripts/g0-graphics-baseline.mjs`.
- `docs/graphics/g0-baseline/` (ảnh + 2 report).

## 6. Kiểm chứng

- 569 test qua (+13 skip). Test mới:
  - `src/game/core/perf.test.ts` (2): log từng frame, giới hạn độ dài.
  - `src/map/graphicsLab.test.ts` (4): ẩn khỏi menu; hai bản cùng prefab, bản B xoay 180°; đủ phòng, tầng, đường, vỉa hè, cây, xe, rào; hai bản vẽ cùng số mảnh và cùng màu; các vị trí cảnh của script đứng đúng nhà/phòng; zombie của script không đứng trong collider.
- `npm run lint`, `npm run build` (tsc), `npm run build:editor`, `npm run check:bundle` (4 world tải theo nhu cầu), `npm run map:check -- --deep` đều sạch.
- Playwright: `worlds-browser.mjs` PASS (graphics-lab có trong danh sách, ẩn). `g0-graphics-baseline.mjs` chạy SwiftShader, GPU có khóa nhịp, GPU không khóa nhịp, bóng low và production chỉ đo tải: 0 lỗi console.

## 7. Gợi ý cho G1

- Material mới phải:
  - giữ một batch mỗi chunk (texture array hoặc chỉ số material theo instance) hoặc giải thích phần draw call tăng thêm;
  - tính UV từ kích thước vật lý: thế giới cho đường/đất, cục bộ cho đồ đạc/cửa, chịu được ma trận cắt lớp;
  - nối tiếp bản vá `indoorShading` thay vì thay nó;
  - áp đúng material cho mesh phủ của fader.
- Trong nhà chỉ màu nền và texture có tác dụng; roughness chỉ có ý nghĩa ngoài trời.
- Đường lưới trên nền đất và camera bóng cố định là hai lỗi hình ảnh rẻ để sửa. Đề xuất đưa vào G1 (nền đất) và G4 (bóng), có ảnh A/B.
