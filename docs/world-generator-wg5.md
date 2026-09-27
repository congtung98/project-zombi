# World generator WG5: môi trường, lưu trữ, hiệu năng

Ngày 27/09/2026. Sprint thứ năm của World Map Generator (`docs/writing-block.md` §13–§15, quyết định Q1–Q9 ở `docs/world-generator-wg1.md` §0). Nhánh `feature/world-generator`.

- Lộ trình: WG1 → WG2 → WG3 → WG4 → **WG5** → WG6 ảnh tham chiếu + vẽ tay.
- **Không đổi**: save game (v9), schema map (v1), định dạng layout (v1: chỉ thêm trường tùy chọn), nội dung các world hiện có.
- **Có thêm**:
  - môi trường cho world FULL;
  - một asset ngoại hình `outdoor/streetlight` và preset "Đèn đường";
  - Web Worker cho generator trong editor, có nút Hủy;
  - gộp mặt đường thành batch trong game.

## 1. Tiêu chí nghiệm thu

| # | Tiêu chí | Kết quả |
|---|---|---|
| E1 | Môi trường bằng prefab/object có sẵn: cây, bụi, cỏ, hàng rào, đèn đường, xe đỗ, xe bỏ hoang, rác, mảnh vụn trên đường | Đạt: `tree`, `decor` (bụi, cỏ, giấy, lon, lốp, vệt dầu), `prop`/`container` mang ngoại hình `outdoor/*`; không thêm loại object mới |
| E2 | Mật độ cấu hình được | Đạt: `plan.environment` gồm mật độ 0..1 và 7 cờ bật/tắt; chỉnh trong editor (Mới, Sinh lại world) và CLI `--env`/`--no-env` |
| E3 | Không chặn cửa, không chặn hết lối đi, không chồng công trình, không phá kết nối đường | Đạt: `checkEnvironment` trên fixture, vn-urban và thị trấn dày; deep check sạch (mọi cửa, tủ, spawn tới được; không collider chồng nhau) |
| E4 | Tái dùng batch cho vật lặp lại | Đạt: object môi trường đi qua static batch sẵn có của game và editor (cây, đồ đạc, decor) |
| P1 | Không treo main thread với bản đồ lớn; có cơ chế hủy | Đạt: import và sinh lại chạy trong worker, editor vẫn vẽ; Hủy dừng worker, document không đổi |
| P2 | Batch generation, geometry reuse, disposal có kiểm soát | Đạt: mặt đường gộp theo ô 128 m và màu, geometry được dispose khi unmount |
| P3 | Không generate lại mỗi lần React render | Đạt: generator chỉ chạy khi bấm nút; trạng thái được cache theo object |
| S1 | Tương thích save IndexedDB hiện có; tách dữ liệu generator khỏi trạng thái gameplay | Đạt: test save/load của game trên world sinh ra; save không chứa gì của layout |
| S2 | Không reset thay đổi gameplay khi chỉ sinh lại map | Đạt: Q3 chặn sinh lại world đã phát hành; save cũ của world đã sinh lại bị từ chối, không nạp nhầm vào công trình khác (test) |
| S3 | Versioning | Layout vẫn v1, trường mới là tùy chọn; `checkWorldLayout` từ chối version lạ; manifest có `version`; save không đổi schema nên không cần migration |

## 2. Môi trường (`src/map/layout/environment.ts`)

`environmentItems(plan, placed, params)` trả về danh sách vật thể theo tọa độ world. `buildLayoutWorld` (chế độ FULL) ghi chúng thành object của chunk sở hữu vị trí đó. Nguyên tắc chunk là nửa mở, nên không vật nào bị nhân đôi ở ranh chunk.

**Trên lô:**
- Cây ven mặt tiền cách lối vào ít nhất 3 m, thỉnh thoảng một cây ở sân sau.
- Bụi ở hai góc trước nhà (không đặt lên lối vào), cỏ rải trong sân.
- Hàng rào sau cho lô dân cư:
  - chạy dọc mép sau, hở 0,6 m ở mỗi đầu để không bao giờ thành chuồng kín;
  - chỉ khi sau nhà còn trống ít nhất 1,8 m và không có cửa sau gần đó.
- Thùng rác (container, loot `scrap-pile`) ở một góc trước.
- Hộp thư đặt ở điểm neo `mailbox` của prefab nếu có, không thì cạnh lối vào.

**Đất trống:**
- rừng: dày, một nửa là thông;
- đất bỏ không: cây và bụi thưa;
- ruộng và đất bên trong khối: ít.

**Đường:**
- Đèn đường trên vỉa hè, phía mép đường, cách nhau 30 m (thưa) tới 18 m (dày), tránh góc phố.
- Xe:
  - chỉ trên lòng đường nhựa rộng từ 6 m, sát lề (cách 0,15 m), cách giao lộ 7 m, nên luôn còn một làn 3,5 m trống;
  - khoảng 40% là xe bỏ hoang (container có loot), kèm vệt dầu và chồng lốp.
- Giấy vụn, lon rải trên vỉa hè.

**Vùng cấm đặt vật có collider:**
- footprint của nhà cộng 0,8 m;
- ô vuông 2,8 m trước và sau mỗi cửa tầng trệt;
- lối rộng 2,6 m từ cửa chính ra tới đường, kéo cả lên vỉa hè;
- ngoài vùng chơi (cách mép 1 m, tính cả tán cây).

Tán cây còn phải tránh mái nhà. Decor không có collider nên không chắn đường.

**Ổn định:**
- mỗi lô và mỗi mảnh đường có luồng ngẫu nhiên riêng, nên đổi nhà trên một lô chỉ đổi đồ của lô đó;
- ID có dạng `env-<lô>-<loại>-<n>` hoặc `street-<mặt đường>-<loại>-<n>`;
- đồ của lô thuộc về lô trong manifest, nên khóa lô thì khóa cả đồ, sinh lại lô thì sinh lại cả đồ;
- sửa tay một cái cây thì lô được coi là "sửa tay".

**Đèn đường** là asset ngoại hình mới `outdoor/streetlight`:
- gồm đế, cột, cổ, kính và nắp, nằm trong hộp collider 0,3 × 4,2 × 0,3 m;
- chỉ để trang trí, không phát sáng (Q8);
- có preset "Đèn đường" trong tab Object của editor.

**Số lượng ở mật độ Vừa:** fixture khoảng 870 đồ, thị trấn dày 500 m khoảng 4.700 đồ.

## 3. Hiệu năng

- **Worker trong editor:**
  - `src/editor/generatorWorker.ts` nhận bản sao document và thư viện prefab, chạy cùng hàm thuần (`syncGenerated`, `layoutWorldFromGeoJson`);
  - worker chỉ gửi về bản vá (`src/map/editor/docPatch.ts`: các chunk, prefab, extras và world đã đổi);
  - editor áp bản vá lên document gốc, nên chunk không đổi giữ nguyên object: lịch sử undo vẫn nhẹ và viewport chỉ resolve lại phần đổi;
  - một job một lúc; tab Generator hiện "Đang …" kèm số giây và nút **Hủy** (terminate worker);
  - kết quả chỉ đổi document khi document vẫn là bản mà job bắt đầu, còn bản xem trước thì báo "đã cũ";
  - khóa/mở khóa vẫn chạy tại chỗ vì chỉ đổi layout;
  - môi trường không có Worker (test) thì chạy tại chỗ.
- **Tăng tốc sinh world:**
  - `RectIndex` (`rects.ts`): chỉ mục lưới 8 m cho câu hỏi "có gì chồng lên đây không";
  - chọn chỗ spawn qua chỉ mục;
  - `buildLayoutWorld` không còn clone toàn bộ hai lần;
  - bước trộn so bằng hash có sẵn;
  - `validate: false` trong bước trộn (editor tự validate document sau khi trộn);
  - giữ nguyên object `world` nếu không đổi.

  Đo trên thị trấn dày 500 m (Node, vitest; khoảng 4.700 đồ môi trường):

  | Bước | Trước | Sau |
  |---|---|---|
  | `buildLayoutWorld` | 1,7 s | 0,45 s |
  | Sinh lại một lô | 2,1 s | 0,35 s |
  | Sinh lại cả world với seed mới | 3,6 s | 1,3 s |

  Trong trình duyệt, worker tạo trọn world dày (484 nhà) trong khoảng 0,4 s.
- **Mặt đường trong game** (`src/game/rendering/roadBatches.ts`, `Roads.tsx`):
  - một mesh cho mỗi ô 128 m và mỗi màu, thay cho một mesh mỗi record;
  - shader bề mặt lấy vân theo tọa độ world nên hình không đổi; mỗi quad giữ độ cao theo lớp vẽ;
  - thị trấn 500 m: khoảng 1.650 record gộp lại còn dưới 110 batch (test);
  - geometry được dispose khi unmount.

## 4. Lưu trữ (§14)

- Dữ liệu generator nằm trong `layout/world-layout.json` của world (WG4), gồm:
  - seed, phiên bản plan/manifest, thư viện;
  - vị trí công trình, lựa chọn tay, lô khóa;
  - tham số môi trường (mới: `plan.environment`).
- Save của game chỉ chứa trạng thái runtime (test: không có `parcels`, không có đường dẫn layout).
- `src/map/layout/persistence.test.ts`:
  1. Chơi world sinh ra: lấy đồ trong xe bỏ hoang, mở cửa → snapshot → JSON → `validateSaveGame` → nạp vào runtime mới. Container, túi đồ, cửa và zombie đều khớp.
  2. Dữ liệu generator đi qua pack và nháp, không vào save.
  3. Save chụp trước khi world bị sinh lại (seed khác) bị `validateSaveGame` từ chối: không bao giờ nạp nhầm vào công trình khác. Cùng với Q3, sinh lại không bao giờ âm thầm xóa loot hay công trình trong world đang chơi.

## 5. Cách dùng

- **Editor:**
  - Mới → Từ GeoJSON, hoặc tab Generator → Sinh lại world;
  - mở mục **Môi trường**: mật độ Không có / Thưa / Vừa / Dày và các cờ Cây, Bụi cỏ, Hàng rào sau, Thùng rác hộp thư, Đèn đường, Xe, Rác;
  - khi đang chạy, tab hiện thời gian kèm nút **Hủy**.
- **CLI:** `npm run layout:plan -- <file>.layout.json --mode full [--env 0..1 | --no-env] --pack … --world-id …`. Tóm tắt in thêm số đồ môi trường.

## 6. Kiểm chứng

- **Test mới:**
  - `environment.test.ts` (10): đủ loại; quy tắc cửa, lối vào, lòng đường; ổn định khi đổi một lô; mật độ và cờ; không cảnh báo vùng chơi; một chunk sở hữu mỗi đồ; deep check; chơi được; LAYOUT_ONLY không có môi trường; vn-urban và thị trấn dày;
  - `persistence.test.ts` (3);
  - `roadBatches.test.ts` (2);
  - worker path trong `generator.test.ts` (+1);
  - `worldSync.test.ts`: sinh lại lô đích danh không ra lô trống;
  - furniture: kích thước streetlight.
- **Toàn bộ:** `npm test` 857 pass (+13 skip). tsc, oxlint, build, build:editor (worker tách file riêng 145 kB), check:bundle, map:check --deep sạch; hai cảnh báo cũ của `neighborhood-50-lab` giữ nguyên.
- **Trình duyệt** (Vite dev, Playwright qua MCP):
  - import thị trấn dày qua worker: editor vẫn vẽ 55 frame trong 600 ms, tạo xong khoảng 0,4 s, Validate 0/0;
  - Hủy ngay sau khi bấm Tạo: document giữ nguyên, không có kết quả đến muộn;
  - sinh lại seed 4 với mật độ Dày: xem trước "thay 160, thêm 1214, bỏ 778" → Áp dụng;
  - click lô → Sinh lại lô qua worker;
  - ảnh isometric trong editor: cây, bụi, đèn, rào;
  - world sinh ra bằng CLI → `map:unpack` → `map:check` và deep check sạch → chơi `?world=`: 26 zombie, FPS 91 khi nhìn gần (225 draw call) và 64 khi thu nhỏ hết cỡ (391);
  - world tạm đã xóa.

## 7. Giới hạn và phần của sprint sau

- **Chưa có đèn phát sáng**, chỉ để trang trí (Q8).
- **Xe luôn thẳng trục**: không có xe nằm chéo hay chắn ngang đường, để giữ kết nối đường.
- **Hàng rào chỉ có ở mép sau lô**. Chưa có rào bên hay cổng.
- **Worker chưa báo tiến độ theo phần trăm**, chỉ hiện số giây.
- **Chưa có script Playwright riêng** trong `scripts/`: máy không có gói Playwright cho Node.
- **Sửa tay hoặc xóa một đồ môi trường sẽ giữ cả lô** khi sinh lại với tham số khác. Đây là cách bảo vệ thận trọng.
- **Còn lại:** WG6, ảnh tham chiếu và vẽ tay.
