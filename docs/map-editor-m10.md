# Map editor M10: streaming theo chunk trong runtime

Ngày 26/09/2026. Sprint thứ tư sau kế hoạch M1–M6 (có một sprint chen: chọn world trong game). Lộ trình: M7 → M8 → M9 → **M10** → M11 phòng đa giác + nhiều tầng.

- Save **không đổi (v8)**; schema map v1 không đổi; nội dung `neighborhood-50` không đổi.
- Generator vẫn **v2**. Giới hạn nâng từ 4×4 lên **16×16 khối** (khoảng 530 × 500 m, 288 chunk).

## 1. Đo trước khi làm

World 16×16 sinh bằng generator, trình duyệt GPU thật (màn 165 Hz):

| | Khu phố 50 m | 4×4 (132 m) | 16×16 (528 × 498 m) |
|---|---|---|---|
| Mở tới menu | 0,9 s | 0,8 s | 2,6 s |
| Vào game | 1,0 s | 0,8 s | 3,4 s |
| CPU/frame | 1,25 ms | 2,55 ms | **10 ms** |
| Object trong scene | 385 | 1 737 | **12 058** |
| Mô phỏng/tick | 0,07 ms | 0,1 ms | 0,24 ms |
| Draw call | 50 | 144 | 145 |

Kết luận:
- **Mô phỏng không phải vấn đề**. Nhờ LOD AI từ R2, 512 zombie trên 528 m chỉ tốn 0,24 ms/tick; runtime thêm khoảng 33 MB. Draw call cũng không phải vấn đề, vì frustum culling đã loại phần ngoài màn hình.
- **Vấn đề là mọi thứ của cả world đều được mount**: 844 cửa (mỗi cửa một body Rapier), 1 012 cửa sổ, 844 đèn. Mỗi cửa, cửa sổ, đèn có `useFrame` riêng, tức khoảng 2 700 callback mỗi frame, cộng batch của cả 288 chunk. Scene lại luôn mount sau menu, và mount lại khi bắt đầu ván.
- **Dựng runtime 1,76 s**, trong đó 1,56 s là làm nóng đồ thị HPA* cho mọi tile (R3b làm việc này ngay lúc nạp).
- **Bản build nhúng JSON của mọi world** vào gói JS chính. World 16×16 thêm khoảng 0,7 MB cho mọi người chơi, kể cả khi họ không chơi world đó.

Vì vậy M10 stream **phần hiển thị và content**. Phần mô phỏng vẫn giữ cả world (xem mục 5).

## 2. Streaming phần hiển thị theo camera

- **`rendering/viewChunks.ts`** (thuần, có test):
  - `viewGroundRect` cắt bốn tia góc của frustum camera ở mặt đất và ở độ cao `streaming.viewTop` (20 m, ngọn cây cao nhất), nên vật cao đứng ngay ngoài mép màn hình vẫn được tính;
  - `chunksInRect` nới hình chữ nhật thêm `viewMargin` (16 m = nửa chunk). Một vật rộng tối đa một chunk thuộc chunk chứa tâm của nó, nên luôn được mount khi có phần nằm trong màn hình;
  - `nextViewChunks` có trễ: chunk đang hiện chỉ bị gỡ khi ra xa thêm `viewKeep` (16 m), nên camera đứng trên ranh giới chunk không bị nạp/gỡ liên tục. Tập này luôn gồm các chunk quanh người chơi trong bán kính collider (`chunksAround`);
  - `itemChunkKey` đưa vật dài hơn một chunk (hàng rào biên) vào nhóm `wide`, luôn mount.
- **`ChunkStreamer`** tính lại tập chunk mỗi frame từ camera và chỉ phát khi tập thay đổi (`viewChunkStore`). `?stream=off` hoặc `streaming.view: false` mount mọi chunk, để so sánh.
- **`StaticBatches`**: mỗi chunk đang hiện là một `StaticChunk` riêng. Batch được dựng khi chunk vào tầm nhìn và giải phóng khi rời đi; đăng ký làm mờ vật che và mái nhà đi theo chunk.
- **`Scene`**: cửa (kèm body Rapier của lá cửa), tủ, cửa sổ, đèn được mount theo chunk qua `chunkEntities.ts` (`indexChunkEntities`: chỉ mục theo chunk của tâm, dựng một lần). Đường đi, túi đồ rơi và zombie giữ như cũ. Zombie vốn đã chỉ được vẽ khi không DORMANT.
- Tầm nhìn: màn 1280×800 ở zoom mặc định hiện 16 chunk, full HD 36 chunk, trên 288 chunk của world 16×16.

## 3. Nav: làm nóng đồ thị theo ngân sách

- `NavGridOptions.initialWarmMs` và `warmFrom`. Runtime chỉ làm nóng 30 ms (`pathfinding.initialWarmMs`), bắt đầu từ các tile gần điểm xuất phát (`NavTiles.prioritize`, xếp theo khoảng cách Chebyshev). Công cụ và test vẫn làm nóng toàn bộ như trước (mặc định).
- Phần còn lại được làm nóng:
  - khi game không chạy (menu, tạm dừng, tạo nhân vật): `runtime.idleWork()`, 4 ms mỗi frame (`pathfinding.idleWarmMs`), gọi từ `GameLoop`;
  - khi đang chơi: 0,5 ms mỗi tick lúc hàng đợi tìm đường rảnh (cơ chế R3b có sẵn).
- Nạp save thì làm nóng quanh vị trí người chơi trước (`prioritizeWarm`).
- Làm nóng chỉ thay đổi *thời điểm* tính cạnh, không bao giờ thay đổi đường đi (có test so với lưới làm nóng toàn bộ).

## 4. Content theo world

- `src/map/bundledFiles.ts`:
  - gói chính chỉ chứa mọi `world.json` (menu đọc tên và kích thước) và toàn bộ world mặc định `neighborhood-50` (bản đồ khu phố và migration save cũ cần nó ngay lúc import);
  - world khác nạp bằng `loadBundledWorldFiles(worldId)`.
- Bản build game (`vite.config.ts`) gom mỗi world thành một chunk `world-<id>-*.js`, chỉ tải khi chơi world đó.
- `main.tsx`: `preloadStartupWorld()` tải world cần chơi (URL hoặc lựa chọn đã lưu), rồi mới import App và runtime. Runtime singleton vẫn được dựng đồng bộ trên world đó. World hỏng hoặc thiếu vẫn quay về khu phố như ở sprint chọn world.
- Editor tải mọi world lúc khởi động (`loadAllBundledWorlds`), nên hành vi không đổi.
- Trong test, mọi file được nạp sẵn (`src/test/bundledFiles.ts`).
- `check:bundle` kiểm tra thêm: mỗi world không phải mặc định có chunk riêng, và không có import tĩnh hay `<link>` nào tới chunk world. Marker của generator đổi sang một chuỗi chỉ code generator có: `town-grid` cũng xuất hiện trong phần truy vết của `world.json` world sinh tự động, nên báo nhầm khi có world sinh tự động trong repo.
- Ví dụ: world 16×16 là chunk 713 KB (gzip 112 KB), trước đây nằm trong gói chính của mọi người chơi. Gói chính hiện là `index` 79 KB + `App` 108 KB + `runtime` 120 KB.

## 5. Không stream phần mô phỏng

- Zombie, nav, collider mô phỏng, WorldState và lighting vẫn giữ cả world. Ở 528 m, toàn bộ phần này tốn 0,22 ms/tick và khoảng 33 MB.
- Muốn stream cả mô phỏng thì phải lưu zombie và trạng thái theo chunk, rồi đóng băng hoặc khôi phục khi nạp/gỡ. Việc đó chỉ đáng làm khi world lớn cỡ vài km. Schema và ownership đã sẵn sàng (`ChunkLifecycle`, ID ổn định).
- Collider Rapier vẫn theo bán kính quanh người chơi như R3b. Lá cửa giờ có body khi chunk của nó đang hiện, và tập đang hiện luôn chứa vùng quanh người chơi.

## 6. Kết quả

Trình duyệt (GPU thật, `?perf=1`):

| | Trước M10 | M10 |
|---|---|---|
| 16×16: CPU/frame | 10 ms | **3,5 ms** |
| 16×16: object trong scene | 12 058 | **1 850–1 875** |
| 16×16: mở tới menu | 2,6 s | **1,06–1,08 s** |
| 16×16: vào game | 3,4 s | **0,81–0,86 s** |
| 16×16: heap khi chơi | 314 MB | 197–213 MB |
| 4×4: CPU/frame, object | 2,55 ms, 1 737 | 2,56 ms, 1 717 (cả world vẫn nằm trong tầm nhìn) |
| Khu phố | 1,25 ms, 385 | 1,3 ms, 388 |

- Mô phỏng ở 16×16 đo được 0,84 ms/tick trong những giây đầu, vì còn làm nóng nav (0,5 ms/tick theo ngân sách). Sau khi đồ thị đã nóng, con số trở về khoảng 0,22 ms (số đo Node).
- Draw call gần như không đổi (frustum culling vốn đã loại phần ngoài màn hình).

Node (`SCALE_BENCH=1 npx vitest run src/game/core/scale.bench.test.ts --silent=false`):

| World | Chunk | Nav làm nóng toàn bộ | Dựng runtime (M10) | Tile còn chờ | Frame menu để xong | Tick TB / p99 |
|---|---|---|---|---|---|---|
| 4×4 | 36 | 77 ms | 45 ms | 30 | 8 | 0,15 / 1,9 ms |
| 8×8 | 100 | 363 ms | 70 ms | 93 | 74 | 0,10 / 0,6 ms |
| 16×16 | 288 | 1 741 ms | **154 ms** | 284 | 380 | 0,22 / 1,0 ms |

## 7. Kiểm chứng

- **Unit** `rendering/streaming.test.ts` (8):
  - với camera thật của game (zoom 14/28/60; màn 1280×800, 1920×1080, 390×844, 2560×1440), mọi điểm trên màn hình ở mọi độ cao tới 20 m đều có chunk của vật chứa nó đang được hiện;
  - vùng quanh người chơi luôn được hiện;
  - trễ: camera lắc qua ranh giới chunk thì tập giữ nguyên, đi xa thì chunk cũ bị gỡ;
  - mỗi cửa, tủ, cửa sổ, đèn và vật tĩnh thuộc đúng một nhóm chunk; hàng rào biên thuộc nhóm `wide`;
  - nav: runtime làm nóng quanh điểm xuất phát trước, phần còn lại xong bằng `idleWork`; đường đi trùng với lưới làm nóng toàn bộ; save nạp thì làm nóng quanh người chơi.
- `npm test`: **510 pass** (+13 skip, gồm benchmark quy mô). `tsc -b`, `oxlint`, `build`, `build:editor`, `check:bundle`, `map:check -- --deep` sạch. Hai cảnh báo `spawn-indoors` của `neighborhood-50-lab` đến từ chỉnh sửa chưa commit trong chunk của lab.
- **Trình duyệt** `scripts/m10-streaming-browser.mjs` (dev, thị trấn 8×8 tạm, 64 chunk) PASS:
  - trang khu phố không yêu cầu file chunk nào của thị trấn;
  - chọn thị trấn thì 64 file chunk được tải trước khi vào game; nav còn 61 tile chờ lúc ở menu, xong trước khi vào game;
  - lúc bắt đầu hiện 16/64 chunk, đúng 68 lá cửa của các chunk đó;
  - đứng yên thì tập chunk không đổi;
  - dịch chuyển 160 m: mọi chunk đang hiện nằm quanh chỗ mới, chunk cũ đã gỡ, 27 cửa (746 object);
  - `?stream=off`: 214 cửa, 3 955 object.
- **Production** (`vite preview`): trang mặc định không tải chunk world nào; `?world=neighborhood-50-lab` tải đúng `world-neighborhood-50-lab-*.js`; vào game được, không lỗi.
- **Hồi quy** PASS: editor m3–m9, `worlds-browser.mjs`; game p2-s2, p2-s4, p2-s5, p2-lighting (số đo ánh sáng giữ nguyên), p2-vision.

## 8. Còn lại

- Stream phần mô phỏng (zombie, nav, trạng thái theo chunk), khi cần world vài km.
- Editor với world rất lớn: viewport M7 vẫn dựng batch cho mọi chunk.
- Instancing nhân vật (mục R3b).
- M11: phòng đa giác + nhiều tầng.
