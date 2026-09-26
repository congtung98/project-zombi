# Đồ họa G1: bộ vật liệu và texture dùng chung

Ngày 26/09/2026. Bước 2 của `docs/Graphics_Improvement_Implementation_Plan.md`, nối tiếp G0 (`docs/graphics-g0.md`).

Game có một bộ vật liệu dùng chung. Mỗi vật liệu có texture tự sinh bằng code, sinh một lần và cache. Vật liệu đã được áp cho:
- tường (gạch bên ngoài, vữa bên trong);
- sàn, tấm sàn, cầu thang (sàn gỗ);
- mái (ngói), nền đất (cỏ);
- đường (nhựa, bê tông, đất);
- cây (vỏ cây, tán lá), cánh cửa (gỗ), rèm (vải).

Lưới 1 m trên nền đất đã bỏ.

Save, schema map, nội dung, ID, collider, loot và điều hướng không đổi. Batch tĩnh vẫn là một material và một draw call mỗi chunk.

## 1. Catalog (`src/game/rendering/surfaces/catalog.ts`)

Mỗi vật liệu có một **ID ngữ nghĩa** và các thuộc tính:
- kích thước vật lý của một lần lặp (m);
- cách lấy tọa độ texture;
- roughness;
- `strength` (độ đậm của chi tiết, 0 = màu trơn);
- nguồn điểm ảnh.

Texture là **bản đồ chi tiết**: nhân với màu của nội dung (tường `#b9a58c` vẫn là màu đó), kèm một `gain` để độ sáng trung bình bằng 1. Nhờ vậy vật liệu không làm cảnh tối hay sáng lên, và không phải chỉnh exposure.

| ID | Tên | Lặp (m) | Tọa độ | Dùng ở G1 |
| --- | --- | --- | --- | --- |
| `matte` | Sơn trơn | 2 | cục bộ | đồ đạc, container, vật ngoài trời (rào, xe) |
| `plaster` | Vữa sơn | 2,4 | thế giới | mặt trong tường, vách ngăn, trần/mép tấm sàn |
| `brick` | Gạch | 1,5 (hàng 0,25 m, viên 0,5 m) | thế giới | mặt ngoài tường |
| `woodFloor` | Sàn gỗ | 2,4 (ván 0,2 m) | thế giới | sàn, mặt trên tấm sàn, bậc thang |
| `wood` | Gỗ | 1 | cục bộ | cánh cửa |
| `tile` | Gạch lát | 1,6 (viên 0,4 m) | thế giới | (G2: bếp, phòng tắm) |
| `concrete` | Bê tông | 4 | thế giới | vỉa hè, sân, tường biên |
| `asphalt` | Nhựa đường | 4 | thế giới | đường |
| `dirt` | Đất | 4 | thế giới | đường đất |
| `roof` | Mái lợp | 2,4 (hàng 0,3 m) | thế giới | mái |
| `grass` | Cỏ | 8 | thế giới | nền đất |
| `bark` | Vỏ cây | 1,2 | ba mặt phẳng | thân cây |
| `foliage` | Tán lá | 2,5 | ba mặt phẳng | tán cây |
| `fabric` | Vải | 0,8 | cục bộ | rèm (G3: sofa, giường) |
| `paintedMetal` | Kim loại sơn | 2 | cục bộ | (G3/G4: xe, tủ lạnh) |

**Tỷ lệ cách điệu, chọn cho zoom chơi:** hàng gạch 0,25 m ≈ 7 px ở zoom 28, và không lấp lánh ở zoom 14. Không có vật liệu nào metallic. Roughness chỉ có tác dụng ngoài trời, vì trong nhà ánh sáng phòng thay ánh sáng mặt trời (G0 audit).

**Cách lấy tọa độ texture** (theo quyết định của chủ dự án):
- **Thế giới:** cho đường, đất và mặt lớn (tường, sàn, mái). Các mảnh cạnh nhau nối tiếp hoa văn, nên tường bị chia quanh cửa sổ vẫn liền mạch.
- **Cục bộ:** cho đồ đạc và cửa. Tính từ góc dưới của hộp vật thể, mỗi mặt chạy u theo cạnh dài, nên vân gỗ dọc cánh cửa và dọc mặt bàn, xoay và đi theo vật thể.
- **Ba mặt phẳng (triplanar):** cho khối tròn (cây).

## 2. Texture: sinh một lần, cache, không chặn frame

- **Bộ sinh** (`surfaces/textureGen.ts`): TypeScript thuần, không cần DOM.
  - Noise giá trị trên lưới lặp, và các bố cục gạch/ván/ô/ngói lặp khít.
  - Seed cố định cho từng vật liệu; bố cục lệch nửa hàng để mép texture rơi vào giữa viên.
  - Kết quả mã hóa sRGB 8 bit, kèm `gain`.
- **Texture array** (`surfaces/surfaceMaterial.ts`):
  - Một `DataArrayTexture` 256 × 256 × 15 lớp, sRGB, mipmap, lặp, anisotropy 4.
  - **5,2 MB** trên GPU (tính cả mipmap).
  - Tạo **một lần cho cả app**; chunk nạp lại, vào ván mới hay remount scene đều dùng lại.
- **Không chặn frame:** scene game render cả lúc đang ở menu, nên lần đầu biên dịch shader xảy ra ngay khi mở app. Khi đó:
  1. Shader dùng tạm một texture trắng 1 × 1 với `gain` 1 (màu trơn như trước G1).
  2. 15 lớp được sinh dần trong lúc rảnh, mỗi lần một lớp (`requestIdleCallback`, ≈ 12 ms mỗi lớp).
  3. Xong thì uniform đổi sang texture thật và `gain` được gán cùng lúc. Không phải biên dịch lại shader.
  - Đo được: tổng 176 ms rải trong lúc rảnh, **0 ms chặn**.
- **Thay bằng file sau này:** catalog đã có trường `source` (hiện chỉ có `procedural`). Chỉ cần thêm một loại nguồn file:
  - nơi đổi là `generateNextLayer`: nạp ảnh, ghi vào đúng lớp và đặt `gain = 1`;
  - ảnh phải cùng kích thước 256², sRGB, lặp khít.
  - Nội dung và gameplay chỉ biết ID vật liệu, nên không phải sửa gì ở đó. Hiện không có asset ngoài nào, nên chưa có vấn đề license hay attribution.

## 3. Vật liệu nào cho mảnh nào (`surfaces/surfaceRules.ts`)

Nội dung chưa có trường vật liệu theo từng vật; trường tùy chọn `visual` sẽ đến ở sprint đồ đạc/editor. Đến lúc đó, các quy tắc sau là nơi duy nhất quyết định. Chúng chỉ đọc vai trò, nhà và màu.

- **Tường của nhà:** thử hai mặt rộng (theo chiều mỏng của tường) xem có nằm trong nhà không.
  - Mặt ngoài là gạch, mặt trong là vữa. Vách ngăn (cả hai mặt trong nhà) là vữa hoàn toàn.
  - Mặt đầu tường (góc nhà, má cửa) theo mặt ngoài.
  - Mặt trên (lộ ra khi cắt lớp) và mặt dưới theo mặt trong.
  - Nhà xoay 180° (nhà B trong lab) cho đúng kết quả của nhà A, xoay theo.
- **Tấm sàn tầng trên:** mặt trên là sàn gỗ, trần và mép là vữa.
- **Sàn nhà, bậc thang:** sàn gỗ. **Mái:** ngói.
- **Đồ đạc, container:** `matte`, tạm cho tới G3.
- **Ngoài nhà:** tường biên `world/boundary-*` là bê tông; các khối khác (rào, xe, thùng) là `matte`.
- **Cây:** thân là vỏ cây, tán là tán lá.
- **Đường** (chỉ có màu):
  - nâu ấm, bão hòa > 0,2 → đất;
  - sáng < 0,45 → nhựa;
  - còn lại → bê tông.
  - Đúng với cả preset editor và các world hiện có.

**Mã vật liệu mỗi instance:**
- `a | b << 4 | mặt << 8` (< 2¹⁴, chính xác trong float32): vật liệu `a` cho mọi mặt, `b` cho các mặt có bit trong mặt nạ.
- Mã nằm trong **kênh alpha của màu instance** của `BatchedMesh`; shader đọc xong đặt alpha về 1. Nhờ vậy batch vẫn một material, không thêm draw call.
- Mesh thường (đường, nền đất, cửa, rèm, lớp phủ khi làm mờ) mang mã trong uniform của material.

## 4. Shader và tương thích

- `SurfaceMaterial` là lớp con của `MeshStandardMaterial`:
  - `onBeforeCompile` gọi **bản vá ánh sáng trong nhà trước**, rồi thêm phần vật liệu. Nhờ vậy ánh sáng phòng và mask nội thất (M11c-1B) áp như cũ. `hasIndoorShading` nhận ra material nối tiếp.
  - Là lớp con nên `clone()` (bản làm mờ của fader) giữ nguyên ngoại hình.
- **Cắt lớp:** mảnh batch là khối đơn vị co giãn theo ma trận. Tọa độ cục bộ = (điểm + 0,5) × kích thước lấy từ ma trận, tính từ góc dưới, nên mảnh bị cắt thấp giữ hoa văn tại chỗ. Tường dùng tọa độ thế giới nên không bị ảnh hưởng. Bản song sinh chỉ vẽ bóng không đổi.
- **Fader:** lớp phủ làm mờ giờ dùng cùng khối đơn vị và cùng mã vật liệu với instance (`surfaceMaterial(code, màu, unit)` + `fadedVariant`), nên khi mờ vẫn giữ texture.
- **Cửa:** mỗi cánh một `SurfaceMaterial` gỗ (màu vẫn theo HP), với kích thước hộp của cánh. Collider tạo từ hình học thật, không đổi.
- **Chương trình shader:** hai biến thể (`unit` cho batch và lớp phủ, `mesh` cho mesh thường). Số program trên GPU vẫn 11–12 như G0.

## 5. Đo

Môi trường như G0: RTX 3060, i5-11500, Chrome 154 headless, 1280 × 800, DPR 1, bóng high, 8 zombie.

**Chi phí render, `--gpu --uncapped`** (ms):

| Cảnh | G0 median / p95 / p99 | G1 median / p95 / p99 | Draw call G0 → G1 |
| --- | --- | --- | --- |
| day-outside | 3,4 / 10,0 / 12,9 | 2,9 / 6,4 / 9,2 | 145 → 144 |
| day-inside | 3,5 / 8,9 / 11,0 | 3,5 / 7,6 / 9,6 | 60 → 59 |
| day-upstairs | 2,7 / 7,0 / 9,1 | 2,8 / 6,3 / 8,4 | 70 → 69 |
| day-wide | 3,6 / 8,4 / 10,7 | 3,3 / 7,4 / 10,3 | 116 → 115 |
| night-outside | 3,2 / 6,4 / 8,8 | 3,5 / 8,2 / 10,3 | 145 → 144 |
| night-inside-lamp | 2,6 / 5,3 / 7,1 | 2,8 / 6,8 / 8,7 | 60 → 59 |
| day-close (mới, zoom 60) | — | 4,0 / 9,2 / 11,5 | 101 |

- Trên máy này, khác biệt nằm trong độ nhiễu giữa các lần đo. Draw call ít hơn 1 vì bỏ lưới.
- **Chưa đo trên máy yếu.** Shader fragment nặng hơn (một lần lấy mẫu texture, ba lần với cây); trên GPU tích hợp cần đo trước khi kết luận.

**Tài nguyên:**
- Texture trên GPU 13 → 14 (thêm texture array); geometry và program không tăng.
- Bộ nhớ texture ước tính 33,8 → 39,1 MB (+5,2 MB).
- Vòng đời 10 vòng ở cả hai world: không tăng.
- Material duy nhất 112 → 111 (6 material vật liệu dùng chung).

**Tải (bản production, localhost, 3 lần xen kẽ với bản build G0):**

| Đo | G0 | G1 |
| --- | --- | --- |
| Bundle game | — | +12 KB (+4,9 KB gzip) |
| Tới menu | 229–265 ms | 230–252 ms |
| Vào game, bấm ngay khi menu hiện | 984–999 ms | 1 131–1 133 ms |
| Vào game, ở menu 2 s trước khi bấm | 265–280 ms | 270–281 ms |

**+140 ms lúc vào game chỉ xảy ra khi bấm ngay.** Việc sinh texture trong lúc rảnh bị dồn vào lúc đó; nếu người chơi ở menu từ khoảng 1 s trở lên thì không khác. Script có tùy chọn `--menu-wait`.

**Ảnh trước/sau:**
- `docs/graphics/g1/*.jpg` là sau; `docs/graphics/g0-baseline/*.jpg` là trước. `docs/graphics/g1/before-g0/day-close.jpg` là ảnh trước cho cảnh cận mới.
- `neighborhood-50`: `docs/graphics/g1/neighborhood-50/` (sau) và `…/before-g0/` (trước, chụp từ code G0 trong worktree tạm).
- Pixel lệch so với G0 (ngưỡng 24/255): ban ngày 0,3–0,6 %, độ lệch trung bình 2,3–3,5/255. Texture cố ý nhẹ.
- Ban đêm 5,5–8,2 %, chủ yếu vì lưới sáng đã mất.

## 6. Kiểm chứng

- **Test:** 581 qua, 13 skip.
  - Mới `surfaces/surfaces.test.ts` (11):
    - catalog vừa mã 14 bit;
    - texture tái lập theo seed, lặp không đường nối (bước ở mép ≤ 3 × bước nội bộ theo từng chiều), trung bình × gain = 1 ± 3 %;
    - texture array sinh một lần, sRGB, đủ lớp;
    - material nối bản vá trong nhà, clone giữ ngoại hình, material mesh thường dùng chung;
    - quy tắc: tường ngoài/vách ngăn, nhà xoay 180° cho cùng kết quả, sàn/tấm sàn/mái/bậc/đồ đạc/biên/cây, đường theo màu.
  - Mới `surfaces/surfaceWarmup.test.ts` (1): lần biên dịch đầu dùng texture tạm với gain 1, sinh qua timer, rồi đổi sang texture thật.
  - Một lần chạy toàn bộ có `navTiles` (test thời gian tìm đường) vượt ngưỡng khi máy đang chạy hai dev server và trình duyệt. Chạy riêng lại qua 3/3; không liên quan G1.
- **Công cụ:** lint, `build`, `build:editor`, `check:bundle` sạch.
- **Playwright, dev:** `m11c1a-cutaway-browser` PASS, `m11c1b-interior-browser` PASS (nghiệm thu cửa sổ: phần thấy 84,7, ngoài nêm 5,4; cỏ 64,7, trước là 65,6 vì có texture cỏ), `p2-lighting-browser` PASS, `p2-vision-browser` PASS, `m11b-floors-browser` PASS. `g0-graphics-baseline.mjs` 0 lỗi ở lab và `neighborhood-50`.
- **Soát bằng mắt:**
  - gạch liền qua các mảnh tường quanh cửa sổ;
  - tường bị cắt: mặt ngoài gạch, mặt trong vữa;
  - nhà B xoay đúng;
  - vùng chưa thấy trong nhà vẫn tối;
  - không lấp lánh ở zoom 14;
  - cảnh cận zoom 60 đủ nét.

## 7. Script đo

`scripts/g0-graphics-baseline.mjs` thêm:
- `--world=neighborhood-50` (5 cảnh);
- cảnh `day-close` (zoom 60);
- `--menu-wait`;
- vòng đời theo cảnh của từng world;
- đếm texture array (mọi lớp).

Số liệu vật liệu (thời gian sinh, số lớp đã sinh trước, texture hiện giữ) lấy qua hook dev `window.__surfaces`, và mask qua `window.__indoorMask`. Script không import module theo URL nữa, vì Vite phục vụ module đã sửa với `?t=`, thành một bản module khác.

## 8. Giới hạn còn lại

- Vật liệu theo quy tắc, chưa theo dữ liệu: chưa có trường `visual`. Cửa hàng vẫn là gạch như nhà dân (màu tường xám cho ra gạch xám).
- Bếp chưa lát gạch; cần công năng phòng (G2).
- Đồ đạc là `matte` cho tới G3.
- Editor viewport vẫn vẽ màu trơn (G5: dùng chung factory).
- Cánh cửa bị cắt lớp thì vân bị nén theo chiều cao, vì collider cần hình học thật của cánh.
- Hướng ván sàn cố định theo trục X của thế giới, không theo từng phòng.
- Mặt đường nhựa rất nhẹ. Nếu muốn đậm hơn chỉ cần chỉnh `strength` trong catalog, không phải sinh lại texture.
- Chiếu hộp theo mặt có thể chọn mip khác nhau ở ngay cạnh hộp; chưa thấy lỗi ở zoom chơi.
