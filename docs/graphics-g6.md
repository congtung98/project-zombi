# Đồ họa G6: hiệu năng, mức chất lượng và rollout

Ngày 27/09/2026. §10–§11 của `docs/Graphics_Improvement_Implementation_Plan.md`, bước cuối. Sổ tay bàn giao (định hướng mỹ thuật, catalog, cách thêm mẫu) nằm ở `docs/graphics-handbook.md`.

## 1. Tối ưu theo phép đo

Profile CPU (CDP, cảnh ngoài trời của lab) chỉ ra hai điểm nóng:

1. **`BatchedMesh` lọc từng instance.** Mặc định, mỗi lượt vẽ (chính và bóng) mỗi frame, three.js duyệt toàn bộ instance của mọi batch, tính lại hình cầu bao, rồi upload lại danh sách vẽ. Chi phí này tăng theo số khối, và qua các sprint số khối đã tăng từ 382 lên 2 326.
   - **Sửa:** tắt `perObjectFrustumCulled` cho batch tĩnh và bản bóng. Danh sách vẽ giờ chỉ dựng lại khi độ hiển thị đổi (cắt lớp, làm mờ). Cả chunk vẫn bị lọc theo hình cầu bao.
   - **Đổi lại:** GPU vẽ thêm vài khối ngoài màn hình (+1,8 nghìn tam giác ở lab).
2. **Lớp phủ tầm nhìn** tính 128 tia chắn tầm nhìn mỗi frame, kể cả khi người chơi đứng yên (`clearFraction`, 16 % mẫu CPU).
   - **Sửa:** chỉ tính lại khi vị trí người chơi, `lighting.revision` (cửa, rèm) hoặc số vật chắn đổi, giống cách mask nội thất đã làm.

**A/B xen kẽ** (trước sửa / sau sửa, lab, `--uncapped`):

| | Trước | Sau |
|---|---|---|
| Đứng yên, trung bình median frame | 6,5–6,8 ms | 3,7–3,8 ms |
| Đứng yên, p95 | 13,0–13,2 ms | 8,2–8,3 ms |
| Đi lại (`--walk=3`), median frame | 6,8–7,1 ms | 5,5–6,4 ms |
| Đi lại, p95 | 15,1–15,4 ms | 12,9–13,8 ms |

**Không đụng tới:** chi phí upload mảng uniform của bản vá ánh sáng trong nhà (`flatten`, `uniform1fv`, khoảng 9 % mẫu). Muốn giảm phải đổi cách truyền dữ liệu phòng (mảng uniform sang texture) trong shader mà mọi vật liệu dùng chung; rủi ro cao so với lợi ích, nên để lại.

## 2. Bảng ngân sách: G0 và bản cuối

**Điều kiện đo:**
- **Máy:** RTX 3060, i5-11500, 16 GB, Windows 11, Chrome 154 headless, ANGLE D3D11.
- **Cảnh:** 1280×800, DPR 1, bóng cao, 8 zombie đứng yên, khởi động 3 s, lấy mẫu 6 s, `--uncapped`.
- **Cách đo:** cùng phiên, xen kẽ G0 (`3dfab4b`, dựng từ worktree) và bản cuối, thứ tự G0, cuối, cuối, G0. Số liệu ở `docs/graphics/g6/` và `node_modules/.tmp/graphics/g6ba-*`.
- Máy vẫn chạy trình duyệt của chủ dự án. Lab ở G0 là nội dung khi đó (chưa có đồ đạc, garage, cây cảnh).

| Chỉ số | G0 | Bản cuối | Nhận xét |
|---|---|---|---|
| **Lab**: frame median, trung bình 11 cảnh, 2 lượt | 4,28 / 5,96 ms | 3,64 / 4,05 ms | Đứng yên: nhanh hơn G0 nhờ §1 |
| Lab: frame p95 | 9,7 / 10,9 ms | 8,3 / 8,5 ms | |
| Lab: CPU median | 3,4 / 4,8 ms | 2,8 / 3,1 ms | |
| Lab **đi lại** (4 cảnh, 1 lượt): median / p95 | 6,1 / 12,7 ms | 7,1 / 15,0 ms | Khoảng +1 ms khi đi: tia nhìn tính lại mỗi frame, nhiều khối hơn |
| Lab: draw call | 53–145 | 58–164 | Chi tiết cửa (G2), garage (G3b), vài hình mới (G4); batch vẫn một draw call |
| Lab: tam giác (gồm lượt bóng) | 4,3–6,1 k | 35,7–36,8 k | Đồ đạc, đồ trang trí, mái hông, cây cảnh; GPU dư |
| Lab: instance batch | 382 | 2 326 | Không còn tốn CPU mỗi frame (§1) |
| Texture / geometry trên GPU | 13 / 56 | 17 / 64 | Không tăng sau 10 vòng vào/ra, ở cả 3 world |
| Bộ nhớ texture ước tính | 33,8 MB | 39,9 MB | Bóng 33,6 MB (như cũ), bề mặt 5,2 MB, tiếp xúc 0,69 MB, dữ liệu batch 0,2 MB; tính từ cỡ và định dạng texture, không từ dung lượng file |
| **neighborhood-50**: frame median | 3,92 / 4,30 ms | 3,44 / 3,54 ms | Sau rollout |
| neighborhood-50: frame p95 | 8,5 / 8,8 ms | 7,6 / 7,4 ms | |
| neighborhood-50: tam giác / instance | 2,0–3,1 k / 138 | 20,1–21,2 k / 1 050 | |
| **Tải thêm** (production): JS | 3 791 709 B | 3 881 582 B | +89,9 KB (+27,2 KB gzip); không có file asset nào |
| Truyền / giải nén (lần tải đầu, localhost) | 1 913 / 4 358 KB | 1 937 / 4 434 KB | |
| Lần tải đầu / tải lại tới menu | 256–259 / 77–79 ms | 262–269 / 86–99 ms | |
| Vào game khi bấm ngay | 0,96 s | 1,14–1,15 s | Dựng batch, đồ đạc, bản đồ tiếp xúc; ở menu 2 s trước khi bấm thì còn khoảng 0,25 s (G3a–G4) |

**Cảnh đông** (`r0-perf-browser --gpu`, map stress ghép 4 × 4 khu phố sau rollout):
- đứng yên 8,2 ms (122 FPS);
- đi lại 7,8 ms;
- 100 zombie vây quanh 12,8 ms (78 FPS), worst frame 125 ms;
- map thường có đám đông: 10,4 ms.

**Mục tiêu 60 FPS ở mức Vừa:** trên máy này, mọi cảnh đã đo dưới 16,7 ms: median 3–7 ms, p95 tới 15 ms khi đi lại, cảnh stress đông nhất 12,8 ms. Đây là **headless trên máy này**; chưa đo trong cửa sổ trình duyệt thật có vsync, và chưa đo trên máy yếu.

## 3. Mức chất lượng

Cài đặt → "Chất lượng đồ họa" (`settingsStore.graphics`, `GRAPHICS_PRESETS`).

| | Thấp | Vừa (mặc định) | Cao |
|---|---|---|---|
| Bóng | thấp (1024) | cao (2048) | cao |
| Tỉ lệ pixel tối đa | 1× | 1,5× | 2× |
| Bóng tiếp xúc | tắt | bật | bật |
| Đồ trang trí rất nhỏ (`small`: cốc, đĩa, lon, chai, sách, giấy, quần áo, thớt, cỏ) | ẩn | hiện | hiện |
| Lọc dị hướng texture | 1 | 4 | 8 |

- Chọn mức sẽ đặt luôn bóng và tỉ lệ pixel; sau đó vẫn chỉnh riêng được.
- **Không đổi thông tin gameplay:** va chạm, loot, tầm nhìn zombie, LOS và vật chắn tầm nhìn giống nhau ở mọi mức. Đồ trang trí vốn không tham gia gameplay. Test `quality.test.ts`: mức Thấp chỉ bỏ đúng đồ trang trí `small`, mọi mảnh khác giữ nguyên.
- **Đo trên máy này** (lab, `--uncapped`):

  | Mức | Median frame | p95 |
  |---|---|---|
  | Vừa (DPR 1,5) | 3,46 ms | 8,05 ms |
  | Thấp | 3,75 ms | 8,33 ms |
  | Cao (DPR 2) | 3,43 ms | 8,01 ms |

  Máy mạnh và nút thắt là CPU, nên các mức khác nhau không đáng kể. **Mức Thấp chưa được kiểm trên máy yếu**; theo quyết định của chủ dự án, chưa tuyên bố gì về hiệu năng của nó.

## 4. Rollout

Áp cho world chính `neighborhood-50` bằng registry và mẫu dùng chung. Sửa 3 prefab, nên mọi instance đổi theo; không đổi ID có trạng thái, nên không tăng `contentVersion`.
- **Nhà dân** (`building/house`):
  - giường, tủ quần áo, tủ bếp, tủ đầu giường có mẫu;
  - biến thể "có người ở" / "bỏ hoang" chọn theo seed (instance hiện tại ra "bỏ hoang");
  - đồ trang trí theo biến thể: thảm; nồi, cốc, cặp sách; hoặc lon, giấy, quần áo, thùng.
- **Safehouse:** tủ thấp, tủ quần áo, hòm đồ; đồ tích trữ của người sống sót (thảm, lon và chai trên tủ, can xăng, túi, ba lô).
- **Cửa hàng:**
  - quầy, 3 kệ hàng, tủ lạnh, 2 kệ đồ nghề;
  - chỉ có biến thể "bỏ hoang": kệ thưa, thùng các-tông, giấy và hộp thực phẩm dưới sàn, chai trên quầy.
- **Ngoài trời:** hàng rào, 3 thùng gỗ, xe, hòm đồ công viên có mẫu; bụi cây và cỏ quanh nhà và công viên. Vạch sơn tự sinh (G4).
- **Không áp:** các world thử nghiệm (`neighborhood-50-lab`, `cutaway-lab`, `floors-lab`), vì test M-series dựa vào chúng.

**Một lỗi do rollout đã bắt và sửa.** Map `?stress=N` ghép nhiều bản khu phố và đổi tên object theo phần cuối ID. Tên cây cảnh tôi đặt trùng giữa các chunk (`bush-1`), nên world ghép bị trùng ID và không nạp được. Sửa bằng tên duy nhất toàn world (`park-bush-1`, `house-bush-1`…), theo đúng quy ước của nội dung gốc. Thêm test: tài liệu ghép 4 × 4 phải qua validator, và tên object duy nhất giữa các chunk.

## 5. Checklist nghiệm thu (§11)

- [x] **Nhà mẫu đẹp hơn rõ ở zoom chơi:** ảnh `docs/graphics/g6/*.jpg` so với `before-g0/`, cùng cảnh và camera.
- [x] **Các phòng đọc được qua vật liệu và nội thất:** bếp lát gạch có tủ bếp, chậu rửa, tủ lạnh; phòng ngủ có giường, tủ đầu giường; garage sàn bê tông có bàn thợ.
- [x] **Player, zombie, cửa, container không chìm vào trang trí:** đồ trang trí màu dịu, không collider, không có dấu; tủ giữ đèn loot; validator cảnh báo đồ che dấu loot hay đứng trong vòng mở cửa. Zombie và người chơi vẫn nổi bật trong ảnh.
- [x] **Texture không kéo giãn; seam và shimmering chấp nhận được:** vật liệu theo cỡ vật lý, mipmap, lọc dị hướng (G1).
- [x] **Hai nhà chung asset không ảnh hưởng chéo:** nhà A (có người ở) và nhà B (bỏ hoang) cùng prefab; test so từng mảnh, chỉ khác màu và đồ theo biến thể; cắt lớp theo từng nhà.
- [x] **Bốn góc xoay prefab đúng:** test so từng mảnh sau khi quy về khung prefab, gồm đồ đạc, hướng tự động, góc lệch, đồ trang trí.
- [x] **Nhìn qua cửa sổ không lộ phòng kín; props và decals chịu mask:** `m11c1b-interior` PASS. Đồ trang trí và bóng tiếp xúc áp trước mask.
- [x] **Mái ẩn không làm phòng sáng bất thường; không đồ tầng trên lơ lửng:** test cắt lớp theo neo; `m11b-floors` PASS.
- [x] **Ngày/đêm và đèn đúng; không bake bóng:** `p2-lighting` PASS; bóng mặt trời động, bám người chơi.
- [x] **Cửa, loot, chiến đấu, nav, spawn không hồi quy:**
  - `p2-s2`, `p2-s4`, `m5-editor` (chơi thử và loot) PASS;
  - `p2-s3`, `p2-s5` PASS với `GPU=1`;
  - `r0-perf --gpu` 6/6;
  - test đơn vị 626.
- [x] **Save cũ nạp đúng:** test save lab v1 → v2 (cửa, tủ, người chơi giữ nguyên); test migration M8; `p2-s4`/`p2-s5` save/Continue.
- [x] **Editor và game thống nhất; export/import giữ ngoại hình:** `visualContract.test.ts`; khung nhìn editor dùng chung bộ dựng.
- [x] **Chunk unload/reload không nhân bản tài nguyên:** 10 vòng ở mọi world đo, số texture và geometry không đổi.
- [x] **Thấp/Vừa/Cao không đổi thông tin gameplay:** §3.
- [x] **Có ảnh trước/sau và profiling trung thực:** §1–§2. Ảnh nằm trong `docs/graphics/` (bị `.gitignore` của chủ dự án, chỉ ở máy).

## 6. Kiểm chứng của G6

- **Test:** 626 qua, 13 skip; chạy cả bộ hai lần liên tiếp đều qua.
  - Mới: `quality.test.ts` (2), `stressMap.test` +1.
  - **Sửa test thời gian nav chập chờn:** lần làm ấm lưới nav lúc dựng giờ luôn làm xong ô xuất phát, bất kể ngân sách 30 ms (`NavTiles.warm(budget, minTiles)`). Trước đó, khi máy bận, 30 ms có thể hết trước ô đầu tiên và người chơi đứng trên một ô chưa làm ấm.
- **Công cụ:** lint, `tsc`, `build`, `build:editor`, `check:bundle`, `map:check --deep` sạch.
- **Playwright PASS:**
  - game: `p2-lighting`, `p2-vision`, `m11c1b-interior`, `m11b-floors`, `worlds`, `p2-s2`, `p2-s4`;
  - `m11c1a` (`GPU=1`), `m10-streaming` (`GPU=1`), `p2-s3` (`GPU=1`), `p2-s5` (`GPU=1`), `r0-perf --gpu`;
  - editor: `m3`–`m9`, `m11a`, `m11c2`, `g3a-furniture`, `g3b-decor`.
- **Các script cần `GPU=1`:** dưới SwiftShader (render bằng CPU), cảnh từ G1 trở đi chỉ còn vài FPS, trong khi các bước chờ trong script tính bằng thời gian thực. Ví dụ `p2-s3` đo tư thế zombie ngã sau 900 ms và thấy −1,55 thay vì −1,57 rad (chưa ngã hết). Đã xác nhận cả ba script qua trên G0 dưới SwiftShader và qua trên bản cuối với GPU. `m10-streaming` hỏng dưới SwiftShader từ G0 trở đi; với GPU thì qua.
- **Không chạy:** `p2-smoke` (cần mở tay một Chrome có cổng debug).

## 7. Giới hạn còn lại

- Khi đi lại, lab tốn khoảng +1 ms mỗi frame so với G0 (tia nhìn tính lại, nhiều khối hơn). Upload uniform của bản vá ánh sáng trong nhà là chỗ tối ưu tiếp theo (§1).
- Mức Thấp chưa được kiểm trên máy yếu; chưa đo trong cửa sổ thật có vsync.
- Editor chưa vẽ mái, khung cửa G2, vạch sơn, bóng và mask.
- Bóng tiếp xúc chia tầng theo dải 3 m.
- Các world thử nghiệm chưa rollout.
- Test đơn vị của map stress không bắt được ID trùng mà trình duyệt bắt được (hai đường nạp khác nhau). Test mới kiểm trực tiếp validator và tên object; nguyên nhân sâu của khác biệt chưa tìm.
