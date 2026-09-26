# Map editor M7: hoàn thiện editor

Ngày 26/09/2026. Sprint đầu tiên sau kế hoạch M1–M6, lấy từ mục "Còn lại sau M6" của `docs/map-editor-m6.md`. Lộ trình đã chốt: M7 hoàn thiện editor → M8 migration nội dung cho save → M9 generator nhiều biến thể + cây → M10 streaming chunk → M11 phòng đa giác + nhiều tầng.

- Save **không đổi (v8)**; nội dung `neighborhood-50` không đổi từng byte.
- Schema map vẫn v1; mọi trường mới đều tùy chọn: `playArea.depth`, `playArea.center`, `roads[].layer`. `lamp.at` đã có từ M1, nay sửa được trong editor.

## 1. Kết quả

| Việc | Cách dùng |
|---|---|
| **Gộp mesh theo chunk** | Tự động. Viewport vẽ mỗi chunk bằng tối đa 3 `BatchedMesh` (đặc, kính, zone) |
| **Tay cầm đổi kích thước** | Chọn một khối/đường/zone (world) hoặc khối/phòng/tường chạy (prefab), rồi kéo các ô vuông trắng. Zone tròn: một ô bán kính |
| **Thứ tự vẽ mặt nền** | Inspector của đường/nền → **Lớp vẽ** 0–4 |
| **Vị trí đèn** | Prefab: chọn đèn, kéo ô vàng. Inspector: Đèn X/Z, **Đèn về tâm phòng** |
| **Vùng chơi lệch tâm** | Tab Chunk → **Khớp vùng chơi với chunk** (hình chữ nhật phủ các chunk); Inspector → World: X, Z, tâm |

## 2. Gộp mesh trong viewport

- `src/editor/drawItems.ts`: `drawItems(record)` biến một record đã resolve thành dữ liệu vẽ thuần (hình, pass, màu, vị trí, xoay, scale). `buildBatches(items)` dựng một `BatchedMesh` cho mỗi pass có mục, màu theo instance, material trắng dùng chung.
- `RecordView` (bóng mờ khi đặt, cảnh prefab) vẽ cùng dữ liệu đó bằng mesh rời; `ChunkBatch` vẽ cả một chunk.
- `resolvedChunks(doc)` (`document.ts`) trả danh sách record theo chunk, dùng chung cache của resolver: danh sách của một chunk là **cùng một mảng** khi chunk, prefab và world không đổi. Vì vậy một lệnh chỉ dựng lại batch của các chunk nó chạm tới (có test).
- Layer ẩn và bóng mờ bị lọc trước khi gộp; bóng mờ vẽ riêng bằng `RecordView`. Batch cũ được giải phóng sau khi gỡ (có xử lý StrictMode gắn lại ngay, giống `StaticBatches` của game).
- Chọn, kéo và khung chọn vẫn dùng dữ liệu đã resolve, không dựa vào mesh.

## 3. Tay cầm (`src/map/editor/handles.ts`, thuần)

| Đối tượng | Tay cầm | Lệnh |
|---|---|---|
| Khối (tường, vật cản, container) rời, đường, zone chữ nhật | 4 cạnh + 4 góc | Đổi `size`; tâm dời để cạnh đối diện đứng yên. Tâm vượt ranh giới chunk thì record được **chuyển chunk sở hữu, giữ ID** (qua `moveRecords`) |
| Zone tròn | 1 ô bán kính (phía đông tâm) | Đổi `radius` |
| Khối trong prefab | 4 cạnh + 4 góc | `position` + `size` (giữ chiều cao) |
| Tường chạy (prefab) | 2 đầu | Trượt theo trục của tường, không ngắn hơn 0,5 m, không vượt đầu kia |
| Phòng (prefab) | 4 cạnh + 4 góc | `bounds` |
| Đèn (prefab) | Ô vàng ở vị trí đèn | `lamp.at`, kẹp trong phòng; kéo về đúng tâm thì bỏ `at` (file giữ như cũ) |

- Kích thước tối thiểu (`MIN_SIZE`): khối 0,1 m; mặt nền 0,5 m; zone và phòng 1 m; bán kính 0,5 m. Kéo quá cạnh đối diện thì dừng ở kích thước tối thiểu, không lật.
- Một lần kéo là **một mục lịch sử**, có xem trước khi kéo. Không lệnh nào đổi ID, nên save giữ nguyên trạng thái.
- Tay cầm vẽ cố định 9 px trên màn hình, bắt trong bán kính 10 px. Khi vật nhỏ hơn 36 px trên màn hình (`handlesUsable`), tay cầm bị ẩn để bấm vào thân vật vẫn là di chuyển; phóng to để đổi kích thước. Lỗi này do kịch bản M3 phát hiện: đống phế liệu 1 m ở mức zoom xa bị "đổi kích thước" thay vì kéo đi.
- Cửa và cửa sổ không có tay cầm (bề rộng đổi ở Inspector).
- Đèn dời khỏi tâm thì bấm vào đèn cũng chọn được nó. Đèn ở tâm thì bấm tâm phòng vẫn chọn phòng như M5.

## 4. Thứ tự vẽ mặt nền

- `roads[].layer?: 0..4` (`SURFACE_LAYER_MAX`). Game: `roadY(road) = 0,015 + layer × 0,001` m, lớp cao nhất 0,019 m vẫn dưới sàn nhà (0,02). Camera game là orthographic (near 0,1, far 200), độ phân giải độ sâu khoảng 1e-5 m, nên cách nhau 1 mm là đủ; không dùng `polygonOffset`.
- Editor vẽ theo cùng quy tắc (0,01 + layer × 0,001).
- `surface-overlap` chỉ còn cảnh báo khi hai mặt khác màu **cùng lớp**. Validate: số nguyên 0–4. Lớp 0 là mặc định và không ghi vào file.

## 5. Vùng chơi lệch tâm

- Schema: `playArea { size, depth?, center? }`; `playAreaRect()` (`transform.ts`). `MapData` có thêm `depth?`, `center?` và `mapBounds(map)`.
- Nơi dùng:
  - NavGrid: số cột/hàng và gốc lấy từ hình chữ nhật (+1 m lề như cũ);
  - `Ground`: mặt đất, collider, lưới. Hình vuông tâm gốc vẫn dùng `gridHelper` như trước; hình khác vẽ lưới từng mét;
  - hàng rào biên (`boundaryWalls`);
  - kiểm tra spawn/record ngoài vùng chơi (validator);
  - điểm bắt đầu Play From Here;
  - kiểm tra túi đồ rơi khi nạp save (`drop outside map`).
- Editor: `fittedPlayArea(world)` phủ hình chữ nhật của các chunk trừ lề 2 m. `normalizePlayArea` bỏ `depth`/`center` khi là hình vuông tâm gốc, nên world cũ giữ nguyên từng byte.
  - Ví dụ: 2 × 2 chunk → `{ size: 60 }` như trước. Thêm một cột chunk phía đông → `{ size: 92, depth: 60, center: { x: 16, z: 0 } }`, thay vì hình vuông 124 m phủ cả phần đất trống phía tây.
- Tìm đường và biên đã kiểm tra trên world lệch tâm: đi được tới x = 58, hàng rào ở x = 62,5 chặn, có đường đi từ spawn. Save: túi rơi ở x = 58 hợp lệ, ở x = 64 bị từ chối.

## 6. Khác với dự kiến

| Dự kiến | Thực tế | Lý do |
|---|---|---|
| Tay cầm cho mọi thứ | Không có cho cửa/cửa sổ, instance prefab, spawn | Cửa gắn với tường (bề rộng ở Inspector). Instance lấy kích thước từ prefab. Spawn là điểm |
| Thứ tự vẽ tự động theo thứ tự nội dung | Trường `layer` do người làm map chọn | Thứ tự tự động sẽ đổi khi dời record giữa các chunk; `layer` ổn định và đọc được |
| Vùng chơi đa giác | Hình chữ nhật lệch tâm | NavGrid, mặt đất, hàng rào là lưới chữ nhật; đa giác không có nhu cầu thực tế |

## 7. Kiểm chứng

- **Unit** `src/map/editor/polish.test.ts` (9):
  - tay cầm kéo cạnh/góc, kích thước tối thiểu, `handlesUsable`;
  - danh sách tay cầm theo loại record;
  - kéo là một lệnh, chuyển chunk giữ ID, hoàn tác chính xác; bán kính zone; giữ chiều cao tường;
  - prefab: đầu tường chạy trượt theo trục, phòng, đèn kẹp trong phòng và bỏ `at` khi về tâm, chọn bằng đèn, tập ID có trạng thái không đổi, `lamp-outside-room`;
  - vị trí đèn tới game đúng khi instance xoay;
  - lớp vẽ: cảnh báo chỉ cùng lớp, validate 0–4 nguyên, `roadY`;
  - vùng chơi: validate `depth`/`center`, hình vuông tâm gốc giữ dạng cũ, spawn trong phần lệch tâm hợp lệ, NavGrid phủ phần đó;
  - batch: danh sách theo chunk ổn định, một lệnh chỉ đổi chunk của nó, ≤ 3 batch/chunk, đủ số instance.
- `world.test.ts`: test "khớp vùng chơi" và world M4 nhiều chunk cập nhật sang hình chữ nhật (hàng rào, NavGrid, túi rơi trong save).
- `npm test`: **472 pass** (+10 skip). `tsc -b`, `oxlint`, `build`, `build:editor`, `map:check -- --deep`, `check:bundle` sạch.
- **Trình duyệt** `scripts/m7-editor-browser.mjs` (dev, chuột thật) PASS:
  - kéo tay cầm phía đông một con đường của khu phố: rộng 4 → 6 m, tâm +1 m, một mục lịch sử, hoàn tác;
  - khu phố vẽ bằng 26 draw call;
  - world mới: hai mặt nền chồng nhau → `surface-overlap` → lớp 1 → hết cảnh báo;
  - tay cầm bán kính zone 4 → 7 m;
  - thêm hai chunk phía đông, khớp vùng chơi `{92, 60, (16, 0)}`, spawn zombie ở x = 56;
  - prefab mới: kéo đèn khỏi tâm, về tâm, hoàn tác; kéo cạnh nam của phòng;
  - Export → `map:unpack` → `?world=`: vùng chơi đúng, đi được phía đông, hàng rào chặn, có đường đi, lớp mặt đường `[0, 1]`, vị trí đèn đúng. Không lỗi console.
- Thị trấn sinh 4×4 trong kịch bản M6: **1 495 → 135 draw call**, cùng 17,6 nghìn tam giác.
- **Hồi quy**: editor m3/m4/m5/m6 PASS (m4 đổi kỳ vọng sang vùng chơi chữ nhật), game p2-s5 và p2-s2 (migrate save v1/v2 → v8 qua IndexedDB thật) PASS.

## 8. Còn lại

- M8: migration nội dung cho save khi đổi tập ID.
- M9: generator nhiều biến thể bố cục, cây cối dựng thủ tục.
- M10: streaming chunk trong runtime.
- M11: phòng đa giác, nhiều tầng.
- Nhỏ: zone "quá dày" (chưa có số liệu mật độ); tay cầm bề rộng cửa/cửa sổ.
