# Map editor M9: generator nhiều biến thể + cây cối

Ngày 26/09/2026. Sprint thứ ba sau kế hoạch M1–M6. Lộ trình: M7 → M8 → **M9** → M10 streaming chunk → M11 phòng đa giác + nhiều tầng.

- Save **không đổi (v8)**; nội dung `neighborhood-50` không đổi.
- Schema map vẫn v1; thêm object tùy chọn `kind: "tree"` (chunk và prefab).
- Generator `town-grid` lên **v2**.

## 1. Kết quả

| Việc | Cách dùng |
|---|---|
| **Cây** | Palette Object: *Cây tán tròn*, *Cây thông*. Prefab: Nội thất → *Cây (vườn)*. Inspector: kiểu, cao, bán kính tán/thân, màu. Tay cầm kéo bán kính tán. Layer **Cây** |
| **Cây trong game** | Thân chặn đường, collider, chặn tầm nhìn zombie. Tán vẽ theo batch của chunk, đổ bóng, mờ đi khi che người chơi |
| **Bố cục generator** | `--layout grid` (như v1) hoặc `varied`: khối 22/28/34 m, 1–3 lô mỗi dãy rộng không đều, công viên |
| **Mật độ cây** | `--trees 0..1` (mặc định 0,5): cây đường, cây góc vườn, cây công viên |
| **Editor** | Mới → Sinh bằng generator: thêm *Bố cục* và *Cây*; kết quả trùng CLI từng byte |

## 2. Cây (`src/game/world/trees.ts`, thuần)

- **Schema** `TreeObject { kind: 'tree', localId|objectId, position {x,z}, height 2..20, canopy 0.5..8, trunk 0.1..1, color, style: 'round'|'pine' }`. Không xoay; thân phải nhỏ hơn tán (validator).
- **Resolver**: `parts.trees` (`TreeDef`) + **thân là một `WallDef` cùng ID** (`trunkWall`: hộp 2·trunk, cao tới chân tán + 0,3 m). Vì vậy mọi hệ thống đang đọc `walls` tự coi thân cây là vật cản, không sửa gì thêm:
  - collider Rapier theo chunk; NavGrid; vật che tầm nhìn (zombie và người chơi);
  - `lowSolids` của validator (`spawn-blocked`), `collider-overlap` của kiểm tra sâu;
  - `outOfSolids` của migration save M8.
- Bounds của record là hình vuông tán (dùng cho sở hữu chunk và tham chiếu chéo). Trong prefab, cây được chọn ở thân và phần trong của tán, để tán không che các mục bên dưới.
- `treeProfile`: chân tán, đỉnh tán, chiều cao thân. Cây tán tròn có tán cao tới 2 × bán kính và tối đa 65 % chiều cao; cây thông có tán 80 % chiều cao.
- **Game** (`staticBatchData` + `StaticBatches`):
  - hình mới `trunk` (trụ), `crown` (cầu ít đa giác), `cone` (nón), trong cùng `BatchedMesh` của chunk; bỏ qua "tường" thân cây để không vẽ thành hộp;
  - tán là vật che: mờ đi khi che người chơi (lớp phủ cùng hình dạng);
  - `BatchedMesh` đòi mọi hình có index, nên tán tròn dùng `SphereGeometry(0.5, 9, 6)` chứ không dùng icosahedron.
- **Editor**:
  - `drawItems`: thân đặc + tán trong mờ (pass kính), để thấy thứ đứng dưới tán;
  - layer `vegetation` "Cây"; thumbnail prefab vẽ tán;
  - tay cầm `radius` cho cây ở cả world và prefab (kẹp trong giới hạn, luôn rộng hơn thân).
- `MapData.trees` chỉ có khi world có cây, nên world cũ giữ nguyên dạng.

## 3. Generator v2 (`src/map/tools/generator.ts`)

- `GeneratorOptions` thêm `layout?: 'grid' | 'varied'` và `trees?: 0..1`. `world.generator.params` luôn ghi `{ blocksX, blocksZ, layout, trees }`. `GENERATOR_VERSION = 2`: `map:generate --force` từ chối ghi đè world v1 như quy tắc M6.
- **Lưới đường**: kích thước từng cột/hàng khối (`grid`: 28 m; `varied`: chọn trong 22/28/34 m). Đường 4 m quanh mọi khối.
- **Lô** (`lotsOfBlock`):
  - `grid`: 2 × 2 lô bằng nhau như v1;
  - `varied`: mỗi dãy (bắc/nam) cắt thành 1–3 lô, rộng ≥ 11 m, bề rộng lệch ±20 %, làm tròn 0,5 m. Nhà vẫn quay cửa ra đường của dãy.
- **Công viên** (`varied`, khoảng 20 % khối, không bao giờ tất cả): ghế (vật cản), cây dày theo lưới có xê dịch (1/3 là thông), zone "Công viên i-j".
- **Cây** dùng **luồng ngẫu nhiên riêng** (`seed ^ 0x5bd1e995`), nên đổi mật độ chỉ đổi cây (có test, cả hai bố cục):
  - cây đường: nhỏ (tán 1,1–1,5 m), cách mép đường 0,7 m, mỗi ~7 m, không đặt ngay trước giữa mặt nhà (chỗ cửa thường ở);
  - cây góc vườn phía sau lô;
  - cây công viên.
  - Ràng buộc: thân cách vật cản ≥ 0,6 m, tán không chạm mái (lề 0,3 m), hai cây không quá sát, nằm trong vùng chơi.
- **Vùng chơi** là hình chữ nhật của thị trấn (M7), không còn hình vuông phủ cạnh dài.
- Spawn zombie được kiểm tra với collider đã resolve, nên không bao giờ nằm trên thân cây.
- CLI: `--layout`, `--trees`. Tóm tắt in bố cục, số công viên, số cây, vùng chơi X × Z.
- **Không làm đường cong**: đường trong schema là hình chữ nhật (`roads[]`). Đường cong cần một loại mặt nền mới (polyline); để sau nếu cần.

## 4. Hiệu năng

| | Draw call | Ghi chú |
|---|---|---|
| Editor, thị trấn lưới 4×4 (seed 3, cây 0,5) | 135 (như M7) | tam giác 17,6k → 25,2k |
| Editor, varied 4×4 (seed 7, cây 1: 157 cây, 4 công viên) | 118 | 24 chunk |
| Game, varied 2×2 (55 cây), khung nhìn đầu game | 105 | SwiftShader |

Generator: varied 4×4 với 157 cây mất khoảng 40 ms.

## 5. Kiểm chứng

- **Unit** `src/map/editor/trees.test.ts` (7):
  - cây = tường thân + tán; ID, bounds, layer; validator (thân ≥ tán, chiều cao, kiểu); spawn trên thân bị chặn, dưới tán thì được; không xoay; tay cầm bán kính; pack round-trip;
  - game: NavGrid chặn thân, đi được dưới tán; batch có `trunk`/`crown`, không có hộp; tán là vật che; world không cây không có `trees`;
  - editor: vẽ thân + tán trong mờ; batch trộn hình;
  - prefab: đặt từ palette, xoay theo instance, tay cầm, lên game;
  - generator varied: 7 cấu hình hợp lệ, kiểm tra sâu sạch, có công viên, tán không chạm mái, chạy 600 tick;
  - varied khác grid, tất định; vùng chơi chữ nhật; mật độ cây chỉ đổi cây; tham số sai bị từ chối.
- `production.test.ts`: metadata v2.
- `npm test`: **487 pass** (+10 skip). `tsc -b`, `oxlint`, `build`, `build:editor`, `map:check -- --deep`, `check:bundle` sạch.
- **Trình duyệt** `scripts/m9-editor-browser.mjs` (dev) PASS:
  - varied 4×4 nhiều cây: 157 cây, 118 draw call;
  - varied 2×2 từ hộp thoại: export trùng `map:generate --pack` từng byte (trừ tên);
  - cây từ palette: đổi thành thông cao 9 m ở Inspector, tay cầm tán → 3 m bằng chuột thật, ẩn layer Cây thì không chọn được;
  - cây vườn trong prefab mới, thumbnail có tán;
  - Export → `map:unpack` → `?world=`: 55 cây, thân là tường, NavGrid chặn thân, đi được cạnh tán. Ảnh: tán cạnh người chơi mờ đi.
- **Hồi quy**: editor m3–m8 PASS (m6 export = CLI với tham số mặc định mới); game p2-s5, p2-s2, p2-lighting, p2-vision PASS.

## 6. Còn lại

- Đường cong (cần kiểu mặt nền polyline), ngõ cụt / ngã ba, lô sâu khác nhau trong cùng khối.
- Cây: chưa có gió/lá rụng, chưa ảnh hưởng ánh sáng trong nhà.
- M10 streaming chunk; M11 phòng đa giác + nhiều tầng.
