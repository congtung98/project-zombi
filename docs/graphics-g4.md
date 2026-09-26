# Đồ họa G4: ánh sáng, tiếp xúc và cảnh quan

Ngày 27/09/2026. §8 của `docs/Graphics_Improvement_Implementation_Plan.md`, sau G3b.

## 1. Ánh sáng

- **Cấu hình màu:** kiểm lại, vẫn đúng như G0 ghi (ACES Filmic, đầu ra sRGB, texture chi tiết sRGB). Không đổi exposure, không thêm đèn có bóng.
- **Bóng mặt trời bám người chơi** (`Lights.tsx`).
  - Trước đây hộp bóng cố định ±36 m quanh gốc tọa độ, nên nhà xa gốc (nhà B phía đông-nam của lab, lỗi ghi từ G0) không có bóng.
  - Giờ tâm hộp bóng đi theo người chơi và nhảy theo từng texel trên hai trục của chính ánh sáng, nên bóng không rung khi đi.
  - Cùng cỡ bản đồ bóng (2048/1024), cùng phạm vi. Ánh sáng không phụ thuộc hướng nhìn: `p2-vision` vẫn PASS.
- **Roughness theo vật liệu** (G1) và **đèn trần phát sáng khi bật** (có từ trước) giữ nguyên. Không bake bóng vào màu, vì game có ngày/đêm.

## 2. Bóng tiếp xúc (`rendering/contactShade.ts`, `ContactShadeView.tsx`)

Trong nhà, ánh sáng phòng thay mặt trời, nên trước đây không có chút bóng nào dưới giường hay dọc chân tường; đồ đạc trông như trôi. Cách làm:
- **Một bản đồ cho cả world**, dựng **một lần** lúc rảnh sau khi cảnh mở: 10–14 ms trên máy này cho lab (416 × 416). Trước đó không có gì bị làm tối, và không bao giờ dựng lại mỗi frame hay mỗi chunk.
  - Mỗi hộp tĩnh chạm sàn một tầng (tường, prop, container, thân cây; không có cửa, vì cửa chuyển động) được vẽ vào kênh của tầng đó (R trệt, G tầng 2, B, A).
  - Sau đó làm mờ khoảng 0,5 m và nhân đôi, để sàn sát chân một bức tường mỏng vẫn tối đủ.
- **Shader bề mặt** lấy mẫu theo vị trí thế giới và làm tối những mảnh thấp hơn 0,45 m so với sàn tầng của nó: sàn cạnh đồ vật, chân tường, chân đồ đạc. Mức tối tối đa 40 %, nhạt dần theo độ cao.
  - Nó nhân vào màu gốc **trước** ánh sáng và mask nội thất, nên không làm lộ gì (phòng chưa thấy vẫn tối) và không chiếu sáng gì.
  - Nhân vật, zombie và hiệu ứng không bị ảnh hưởng (chỉ vật liệu bề mặt tĩnh).
- **Đồ đạc không di chuyển hay vỡ,** nên không để lại "bóng cũ". Chunk stream không làm bản đồ đổi, vì nó dựng từ `runtime.map` cả world.
- **Tầng** chia theo dải 3 m (mọi nhà hiện có tầng 3 m); nhà có tầng cao khác thì bóng tầng trên có thể lệch. Ghi vào giới hạn.
- **Tắt được:** `setContactStrength(0)` (dùng cho quality tier ở G6).

## 3. Cảnh quan

- **Mẫu ngoài trời** trong registry đồ đạc (collider cũ giữ nguyên):
  - `outdoor/car`: bánh, thân, buồng kính, mui, nắp capô, cản, đèn pha và đèn hậu;
  - `outdoor/fence`: cột khoảng 2 m một, tấm ván, hai thanh ngang;
  - `outdoor/bin`: thùng rác có bánh, nắp, tay kéo;
  - `outdoor/mailbox`: cột, hộp, cờ.
- **Đồ trang trí ngoài trời:** `decor/bush` (ba khối cầu lá) và `decor/grass` (cụm nón lá). Decor có thêm hình cầu và hình nón.
- **Vạch sơn và bó vỉa tự sinh từ đường,** không cần sửa từng map (`roadDetails`):
  - vạch đứt 1,6 m ở giữa mọi đường nhựa rộng từ 4 m và dài từ 8 m, bỏ đoạn đi qua ngã tư;
  - bó vỉa bê tông 18 cm dọc mép vỉa hè giáp đường nhựa, phía vỉa hè, cao 5 cm, không collider (thấp đủ để bước qua).
  - Neighborhood-50 cũng có vạch sơn; nó không có vỉa hè nên không có bó vỉa.
- **Lab:**
  - hàng rào, xe, 2 thùng rác và hộp thư dùng mẫu mới;
  - bụi cây trước nhà A và cạnh garage, cỏ dọc hàng rào;
  - sân nhà B (bỏ hoang) um tùm hơn: 4 bụi, 6 cụm cỏ.
  - Không đổi ID có trạng thái, nên không tăng `contentVersion`.

## 4. Đo

**Môi trường:** RTX 3060, i5-11500, Chrome 154 headless, ANGLE D3D11, 1280×800, DPR 1, bóng high, 8 zombie đứng yên, khởi động 3 s, lấy mẫu 6 s. Máy vẫn bận (trình duyệt của chủ dự án).

**Cách đo:** A/B xen kẽ với G3b (dựng từ worktree), thứ tự cũ, mới, mới, cũ; `--uncapped`. Số liệu ở `docs/graphics/g4/report-ab.json` và `report-ab-neighborhood.json`.

| | G3b | G4 |
|---|---|---|
| Lab: trung bình median frame / CPU, 11 cảnh | 6,45–6,65 / 5,33–5,52 ms | 6,66–6,71 / 5,50–5,56 ms |
| Lab: p95 trung bình | 12,7–12,8 ms | 12,7–13,1 ms |
| Lab: draw call ngoài / trong | 163 / 72 | 164 / 73 (cảnh rộng 133 → 139) |
| Lab: tam giác | 16,9–24,8 k | 25,8–36,8 k (cầu, nón, xe, hàng rào, cả lượt bóng) |
| Lab: instance batch | 1 990 | 2 326 |
| neighborhood-50: frame / CPU | 4,42–4,48 / 3,46–3,48 ms | 4,76–4,84 / 3,70–3,80 ms |
| neighborhood-50: instance | 422 | 474 (vạch sơn) |

- **Chi phí:**
  - lab khoảng +0,1–0,2 ms;
  - neighborhood khoảng +0,3 ms, phần lớn là một lần lấy mẫu texture thêm cho mỗi điểm ảnh bề mặt (bóng tiếp xúc).
  - Số mesh và batch không đổi. Draw call thêm 1 (6 ở cảnh rộng) đến từ các batch có thêm hình (cầu, nón), không phải mesh mới.
- **Bộ nhớ:** bản đồ tiếp xúc 0,69 MB ở lab (script đo giờ đếm nó là `contact`); texture tăng 14 → 17.
- **Vòng đời:** 10 vòng ở lab, bản xoay và neighborhood, số tài nguyên không tăng.
- **Bundle game:** +11,8 KB (+3,5 KB gzip).

**Ảnh:** `docs/graphics/g4/` (lab, `rotations/`, `neighborhood-50/`).

## 5. Kiểm chứng

- **Test:** 618 qua, 13 skip.
  - Mới `contactShade.test.ts` (3):
    - tường trên sàn làm tối kênh trệt và nhạt dần trong 0,5 m;
    - hộp tầng trên vào kênh của nó, lanh tô không tính;
    - lab: dấu cạnh tủ, ngoài đường không có.
  - Mới `landscape.test.ts` (2):
    - 14 vạch trên đường 48 m, bó vỉa hai vỉa hè đúng phía, lối xe không có;
    - cây cảnh chỉ để vẽ, collider giữ nguyên.
  - Cập nhật: `furniture.test` (mẫu ngoài trời, vật ngoài trời không thuộc nhà), `staticBatchData.test` (chi tiết đường), `surfaces.test` (khóa chương trình `surface-v2`).
- **Công cụ:** lint, `tsc`, `build`, `build:editor`, `check:bundle`, `map:check --deep` sạch.
- **Playwright PASS:** `m11c1b-interior`, `p2-lighting`, `p2-vision`, `m11b-floors`, `worlds`, `m11a/m11c2/m5-editor`, `g3a-furniture-editor`, `g3b-decor-editor`, `m11c1a` (`GPU=1`).
- **Test thời gian nav** (`streaming`) lại hỏng một lần khi chạy cả bộ lúc máy bận; chạy riêng thì qua.
- **Soát bằng mắt:**
  - A/B bóng tiếp xúc ở phòng khách (cường độ 0 và 1, rồi chọn mức mặc định);
  - bóng nhà B phía đông-nam;
  - đường ngày và đêm;
  - xe và hàng rào cận cảnh;
  - ngã tư neighborhood trước và sau khi bỏ vạch qua giao lộ.

## 6. Giới hạn còn lại

- Bóng tiếp xúc chia tầng theo dải 3 m; nhà có tầng cao khác thì bóng tầng trên lệch. Nó là làm tối màu gốc (cả ánh sáng trực tiếp), không phải AO chỉ tác động ánh sáng môi trường.
- Chưa có vạch mép đường, vạch qua đường, đèn đường.
- Ban đêm giữ nguyên độ tối của G0; không thêm nguồn sáng.
- Chưa có vệt bẩn/decal ngoài trời (chỉ có vệt dầu dạng đồ trang trí).
