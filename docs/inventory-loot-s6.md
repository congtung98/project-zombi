# INV-LOOT S6 — Polish, hiệu năng, hồi quy, bàn giao

> Phase: `docs/Phase_Inventory_Loot_Upgrade.md`. Trước đó: `docs/inventory-loot-s0.md` … `s5.md`.
> Nhánh `feature/inventory-loot`. Ngày 2026-09-29. **Sprint cuối.** Sổ tay bàn giao: **`docs/inventory-loot-handbook.md`**.
> Chủ dự án yêu cầu làm S6 và "hoàn thiện theo đề xuất". Các điểm chờ duyệt của S4/S5 giữ nguyên như đã gợi ý (handbook §9).

## 1. Kết quả

### Sửa lỗi

- **Kéo một món xuyên qua thế giới bị tính là cú click trái** (T23):
  - nguyên nhân: `InputManager` đọc nút mới từ mask `buttons` của `pointermove` trên canvas, kể cả nút được nhấn trên UI. Kéo một dòng từ Lục đồ sang Túi đồ (đi ngang qua màn hình game) thành một cú nhấn trái: trong thế chiến đấu thì vung vũ khí, ngoài thế thì hiện nhắc "Giữ chuột phải…" (thấy được trong ảnh S5);
  - sửa: `input.ts` ghi nhớ các nút nhấn ngoài canvas (`uiButtons`) và loại đúng các nút đó. Chord (chuột phải + trái) và việc bắt lại nút đang giữ sau khi mất pointer capture vẫn như cũ (script CS1 đã bắt được lần sửa đầu, vốn làm hỏng đường này).
- **Hiệu năng:**
  - thanh tiến trình của Túi đồ, thanh tiến trình HUD và thanh chỉ số HUD trước đây animate `width`;
  - khi đang chuyển đồ, riêng thanh của Túi đồ tốn 5–6 ms/frame (layout và vẽ lại trên canvas WebGL, tìm bằng A/B trên bản production);
  - thanh chỉ số còn ép layout mỗi frame cả khi chơi bình thường;
  - nay cả ba dùng `transform: scaleX`; layout mỗi frame của cả game giảm từ ~0,3 xuống ~0,01 ms.
- **Dòng bảng:** `ItemRowView` so sánh theo nội dung hiển thị. Mỗi bước chuyển không còn render lại mọi dòng đang hiện của tủ 500 món.
- **Tooltip không hiện lại** khi rê chuột trên đúng dòng vừa mở menu chuột phải: nay hiện lại.

### Polish

- **Icon băng keo** vẽ lại thành cuộn băng nhìn nghiêng có lõi và mép băng xé (trước đây giống kính lúp).
- **Toast** có `role="status"`, hoặc `role="alert"` cho cảnh báo. Thẻ chi tiết vật phẩm có tên truy cập là tên món. Bỏ một nhãn thừa.
- **Empty state và thông báo** của spec §12.1 đã soát lại đủ: túi trống, tủ trống, chưa mở tủ, không khớp tìm kiếm, ngoài tầm, đầy, món không còn, chuyển một phần, bị ngắt, đang tải, lưu thất bại. "Khóa" không áp dụng vì game không có tủ khóa.

### Kiểm thử và công cụ

- **`inventoryMatrix.test.ts`:** T12, T27, T29 (chết vì đòn đánh và vì đói), T30 — bốn mục ma trận trước đây chưa có test riêng.
- **`input.test.ts`:** nút nhấn trên UI không thành cú nhấn vào thế giới; chord; bắt lại nút sau khi mất capture.
- **`scripts/il-s6-browser.mjs`:**
  - ảnh bàn giao §15;
  - T23 kéo xuyên thế giới;
  - đo chi phí UI trên bản production (DevTools metrics, đóng/mở xen kẽ, trung vị; `PROFILE=1` cho sampling profiler, `EXPERIMENT=` cho A/B bằng CSS);
  - rò rỉ listener, job và giữ chỗ sau 10 vòng thao tác.
- **Chế độ build `e2e`:** `vite build --mode e2e` là bản production có thêm `window.__runtime` cho script. Bản phát hành `dist` được kiểm là không có (0 file chứa `__runtime`).

## 2. Kiểm chứng (đã chạy thật)

| Cổng | Kết quả |
|---|---|
| `npm test` | **1049 pass**, 13 skip (sau S5: 1042) |
| Soak | Trùng từng số với S4/S5. shelter 1800 s / 14 kill / 110 dmg; patrol 1379,3 s / 38 kill / 230 dmg. Toàn vẹn 1800 + 1379 lần đều đúng |
| `tsc -b`, `oxlint` | Sạch |
| `vite build`, `build:editor`, `check:bundle`, `map:check` | OK |
| `il-s6-browser.mjs` (bản production e2e, Chrome GPU) | **PASS** |
| `il-s5`, `il-s4`, `il-s3`, `il-s2`, `cs1-combat-browser.mjs` (dev, Chrome GPU) | **PASS** |

Số đo hiệu năng và ma trận T01–T30 đầy đủ: handbook §5 và §6.

## 3. Lệch so với kế hoạch

- **Mục tiêu "overhead UI ≤ 2 ms/frame":**
  - trên máy tham chiếu, tổng thời gian task mỗi frame dao động 2–3 ms giữa hai lần đo giống hệt nhau (WebGL chờ GPU);
  - đánh giá bằng JS riêng của UI theo profiler (0,1–0,2 ms/frame) cùng chênh lệch trung vị của các lần đo (+0,3 … +1,8 ms khi chuyển đồ);
  - script chặn hồi quy ở 3 ms, đủ bắt lỗi transition 5–6 ms vừa sửa;
  - chưa có số của máy yếu.
- **Ảnh bàn giao nằm ở `docs/inventory-loot/final/`**, theo quy ước của repo (ghi chú `docs/inventory-loot-sN.md` + ảnh `docs/inventory-loot/sN/`), không dùng `docs/phases/…` như spec gợi ý.

## 4. File

- **Mới:**
  - `docs/inventory-loot-handbook.md`, `docs/inventory-loot/final/*`;
  - `scripts/il-s6-browser.mjs`;
  - `src/game/core/inventoryMatrix.test.ts`, `src/game/systems/input.test.ts`.
- **Sửa:**
  - `src/game/systems/input.ts` (`uiButtons`);
  - `src/main.tsx` (mode `e2e`);
  - `src/index.css`, `src/components/HUD.tsx`, `components/inventory/Panels.tsx` (thanh bằng `transform`);
  - `components/inventory/ItemTable.tsx` (memo theo nội dung, hover sau menu);
  - `ItemIcon.tsx` (băng keo), `Popups.tsx`, `labels.ts`.
