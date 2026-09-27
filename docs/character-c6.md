# Nhân vật C6: visibility, hiệu năng đám đông, rollout và bàn giao

Ngày 27/09/2026. Bước cuối của `docs/Character_Zombie_Model_Animation_Plan.md`. Sổ tay bàn giao: **`docs/character-handbook.md`**.

## 1. Sửa trong C6

- **Ánh sáng trong nhà cho nhân vật (hồi quy từ C1, đã sửa).**
  - Nguyên nhân: shader đèn phòng và mask nội thất được cài lên prototype `MeshStandardMaterial`. Material của rig hộp cũ nhận nó. `CharacterMaterial` (C1) có `onBeforeCompile` riêng nên bị loại ra. Hậu quả từ C1 tới C5: ban đêm trong nhà có đèn, nhân vật chỉ được mặt trời/ambient chiếu, tối hơn sàn.
  - Sửa: `CharacterMaterial` nối chuỗi `applyIndoorShader` trước (như vật liệu bề mặt G1), khóa program `indoor-lighting-v4|character-palette-2`.
  - Test khóa lại: material có `hasIndoorShading`, shader có `uRoomShade`, `uVisMap`, `vIndoorWorld` và palette.
  - Ảnh `docs/character/c6/night-inside-lamp.jpg`: player trong phòng có đèn, sáng như sàn.
- **Dựng geometry nhanh hơn, nhẹ hơn.**
  - Loft tính pháp tuyến mượt theo chỉ số (vòng × điểm) thay vì băm vị trí, và xuất thẳng geometry có chỉ số (bỏ `mergeVertices`). Lần đầu gặp một hình dạng: 18 → **4,2 ms**.
  - `skinIndex`, `skinWeight` (chuẩn hóa, hai trọng số luôn cộng đúng 255) và `paint` là byte: bớt ~⅓ bộ nhớ mỗi đỉnh.
  - Ảnh lab giống hệt C5 (0 % pixel khác).
- Test vòng đời: 500 zombie dùng ≤ 72 hình dạng chung; 500 material riêng đều được giải phóng khi dispose.

## 2. Visibility (đã kiểm tra, không đổi luật)

| Mục | Kết quả |
| --- | --- |
| Thân, tóc, quần áo, vết bẩn theo luật ẩn | Một mesh duy nhất, ẩn cùng lúc (vision opacity, cutaway). Zombie không có vũ khí; vũ khí player luôn hiện như player. |
| Xác | Theo cùng luật với zombie sống; ẩn thì không vẽ, không bóng. |
| Phòng chưa thấy | Zombie ẩn theo vision như trước. Nhân vật trong nhà giờ lại chịu mask nội thất (như rig cũ). |
| Depth test | Luôn bật; không vẽ xuyên tường. |
| Cutaway | Không ảnh hưởng collider/targeting (hình chỉ để vẽ). |

Script trình duyệt (`GPU=1`) PASS:
- `p2-vision-browser`: trước/sau/gần, cửa đóng/mở, zombie khuất vẫn phá cửa mà không được vẽ;
- `m11c1a-cutaway-browser`;
- `m11c1b-interior-browser`;
- `m11b-floors-browser` (C3).

## 3. Hiệu năng

A/B xen kẽ C0 (worktree `7524e86`) / C6, thứ tự A B B A.
- Máy: i5-11500, RTX 3060.
- Trình duyệt: Chrome 154 headless, ANGLE D3D11, không giới hạn FPS.
- Thiết lập: 1280 × 800, DPR 1, Medium, bóng cao, zoom 28.
- Cảnh: ngã tư neighborhood-50, zombie đuổi player bất tử (AI thật), cùng camera, số zombie và AI.
- Chi tiết: `docs/character/c6/ab.json`.

| Zombie | Frame median C0 → C6 (ms) | p95 | CPU median | Draw call | Tam giác | Mesh / material nhân vật |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 0,9–1,0 → 1,0 | 1,4 → 1,4–1,6 | 0,7 → 0,7–0,8 | 64 → 52 | 20 k → 23 k | 10 / 5 → 1 / 1 |
| 10 | 1,6–1,7 → **1,4–1,5** | 2,3–2,4 → 2,0–2,2 | 1,3–1,4 → 1,1–1,2 | 164–178 → **66–68** | 22 k → 48–51 k | ~90 / ~45 → ~9 / ~9 |
| 30 | 3,4–3,7 → **2,6–2,7** | 4,8–5,2 → 3,9 | 2,9–3,2 → 2,1 | 440–454 → **106–107** | 25 k → 118 k | ~305 / ~148 → ~30 / ~30 |
| 60 | 4,8 → **3,4** | 6,4–6,5 → 4,8 | 4,3 → 2,9 | 665–683 → **136–138** | 28 k → 176–182 k | ~455 / 220 → ~44 / ~44 |

- **Thời gian pose** (`animatorMs`): 0,2–0,4 ms → 0,3–0,5 ms ở 60 zombie. Không cần giảm tần số pose cho zombie xa hay ngoài màn hình. Simulation và combat không bị cắt theo animation.
- **Vòng đời** (8 × sinh/xóa 20 zombie):
  - texture 30 → 30, program 13 → 13;
  - geometry tăng một lần theo số hình dạng mới gặp (83–85 → 94; ID tăng qua mỗi vòng). Test 500 zombie chứng minh chặn trên 72.
  - Heap JS dao động giống nhau ở cả C0 và C6 (GC).
- **Tải và kích thước**:
  - JS build: 3 881 894 → 3 905 039 byte (**+23,1 KB, +8,6 KB gzip**); chunk App +21,5 KB, three +1,4 KB (SkinnedMesh);
  - lab bị loại khỏi build production (check:bundle + tìm chuỗi);
  - không có file asset mới;
  - dựng một hình dạng lần đầu ~4 ms (trong frame nó xuất hiện).
- Tam giác tăng 4–6 lần nhưng vẫn < 200 k ở 60 zombie. Chi phí thực nằm ở draw call và material, đã giảm 5 lần.
- Cảnh đồ họa G6 (`g0-graphics-baseline`, 8 zombie đứng yên): mọi cảnh median ~6,1 ms với vsync 165 Hz headless (giới hạn khung, không phải chi phí). Draw call day-outside 115.
- **Chưa đo**: máy yếu; trình duyệt thật có vsync. Mức Thấp không đổi gì cho nhân vật ngoài bóng.

## 4. Ma trận kiểm tra (§13 của kế hoạch)

| Mục | Trạng thái |
| --- | --- |
| So sánh trước/sau ở camera gameplay | PASS: lab zoom 28 + trong game (`docs/character/c0` ↔ `c6`, `bench-10`) |
| Idle, walk, run, turn, attack, hit, death | PASS: lab `states`, `turn`, `combat`, `zombies`; unit test |
| Khớp không hở, quần áo không xuyên nặng ở pose cực trị | PASS (test khuỷu/gối blend, ảnh cận 200–400 px/m). Giới hạn: tay áo có mặt phẳng ở đỉnh vai khi nhìn gần |
| Chân không trượt; bị chặn không chạy nhịp | PASS: pha theo quãng đường thật, `c3-locomotion-browser` (biên độ 0 khi ép tường) |
| Scale, sàn, hướng trước | PASS: test chiều cao 1,74–1,85, chân [−3; +3,5] cm, +Z trước |
| Grip, đường vung, hit window; không đổi damage/range | PASS: tay thẳng trước đúng `hitAt`, hai nắm tay < 0,3 m, config combat không đổi |
| Interrupt, chết giữa đòn, pause/resume, hitch không lặp event | PASS: animation không phát event; `c4-combat-browser` (zombie chết giữa lúc vung không đánh trúng, pause đóng băng cú ngã); `maxDelta` như tick |
| Biến thể zombie độc lập, giữ stats | PASS: test không module simulation nào import phần vẽ nhân vật |
| Ngày/đêm, mask nội thất, cutaway | PASS sau sửa §1 (ảnh đêm có đèn); `m11c1a`, `m11c1b` PASS |
| Vũ khí/phụ kiện không lộ actor ngoài LOS | PASS: một mesh; zombie không vũ khí; `p2-vision` |
| Save/load giữ ngoại hình; save cũ có fallback | PASS: `appearance.test` (có/không `outfit`), `p2-s3-browser` |
| Xác, loot, respawn, chunk | PASS: không đổi luật; `p2-s3`, `m10` không chạy lại ở C6 (không đụng streaming) |
| Nhiều actor cùng asset không đổi màu/pose lẫn nhau | PASS: test material riêng, nhấp nháy một con không đổi con khác |
| Quality tier không đổi gameplay | PASS: nhân vật không đọc tier |
| Ảnh/video và số đo | Có ảnh + số đo; **không có video** (headless). Chưa xem trên màn hình tần số cao thật |

## 5. Kiểm tra đã chạy

- Unit: **656 test** (C6: material nhân vật giữ đèn trong nhà, 500 zombie dùng hình dạng giới hạn).
- lint, tsc, build, build:editor, check:bundle sạch.
- Playwright (`GPU=1`):
  - `p2-vision`, `m11c1a`, `m11c1b` PASS;
  - `c3-locomotion`, `c4-combat`, `p2-s3`, `p2-s4`, `p2-s5-gait`, `m11b` PASS ở các sprint trước; mã chạy của chúng không đổi trong C6 ngoài material và loft;
  - bench A/B ở trên.

## 6. Còn lại

- Hướng đòn khi player bị đánh: runtime chưa lưu nguồn sát thương.
- Zombie nhanh/chậm theo loại: chưa có loại; nhịp chân đã theo tốc độ đo được.
- Tia kiểm tra chỗ ngã ở 0,5 m: không xét bậc thang hay đồ thấp.
- Mặt trên tay áo hơi phẳng khi nhìn rất gần.
- Chưa kiểm trên máy yếu hay trình duyệt có vsync thật.
