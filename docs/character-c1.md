# Nhân vật C1: cơ thể mẫu và khớp nối

Ngày 27/09/2026. Bước 2 của `docs/Character_Zombie_Model_Animation_Plan.md`, theo phương án chọn ở `docs/character-c0.md` §4.

Kết quả: player và zombie dùng chung **một cơ thể low-poly có dáng người** (vai → eo → hông, chi thuôn, khuỷu, gối, bàn chân, đầu vát hàm, cổ, tóc), dựng thành **một `SkinnedMesh` mỗi nhân vật**. Collider, chiều cao, tốc độ, hit window, AI, save không đổi.

## 1. Kết quả nhìn thấy

Ảnh `docs/character/c1/` (so với `docs/character/c0/`):
- `close-z200`: player nhìn trước, nghiêng (cầm gậy), sau; zombie trước và đang đi.
- `lineup-z28` / `lineup-z100`: player, player cầm gậy, 4 zombie.
- `states-z28` / `states-z80`: player đứng, đi, chạy, 3 pha vung, bị đánh, chết; zombie đứng, đi, giơ tay, đập, bị đánh, chết.
- `turn-z28` / `turn-z80`: 8 hướng.
- `bench-10`: trong game, 10 zombie vây player ở ngã tư.

Thay đổi chính:
- Thân: 7 tiết diện từ gấu áo tới cổ áo. Ngực rộng hơn eo, vai dốc về cổ.
- Tay: bắp tay và cẳng tay thuôn, khuỷu, nắm tay, tay áo ngắn.
- Chân: đùi to hơn cẳng, gối, cổ chân. Giày có gót, mũi và đế tối màu.
- Đầu: cằm nhỏ phía trước, má, trán, đỉnh vát. Có mũi, mắt, lông mày. Tóc che đỉnh và gáy, để lộ trán. Tóc dài xuống vai. Mohawk là một dải.
- Zombie: da nhợt xám/vàng (hết xanh lá), quần áo trầm.

## 2. Quyết định kỹ thuật

| Mục | Quyết định |
| --- | --- |
| Rig | 13 xương: hips → torso → head; shoulder → elbow mỗi tay; hip → knee → ankle mỗi chân (`body.ts`: `BONES`, `BONE_PARENT`). Gốc ở chân, +Z trước, +Y lên, 1 m. Rest pose chỉ có tịnh tiến, nên ma trận bind nghịch đảo suy ra từ vị trí nghỉ. |
| Skinning | Trọng số cứng (1 xương). Vòng ở khuỷu, gối chia 50/50 cho hai xương; gấu áo chia cho xương chậu; gốc cổ theo xương ngực. Nhờ đó khớp gập không hở. |
| Hình | Loft (`loft.ts`): nối các tiết diện bát giác vát góc, hoặc chữ nhật cho chi tiết nhỏ. Mỗi tiết diện có `at`, `w`, `d`, độ vát, lệch tâm. Pháp tuyến mượt ở đầu, chi, thân. Chi tiết nhỏ (mắt, đế) và tay áo giữ cạnh. |
| Chia sẻ | Geometry cache theo khóa `preset/hair/outfit`, không bao giờ dispose; tối đa 9 khóa với C1. Mỗi nhân vật có xương, skeleton (texture xương) và material riêng. |
| Màu | `CharacterMaterial` (`material.ts`): mỗi đỉnh mang ô màu `paint` (10 ô: da, áo, viền, quần, giày, tóc, mắt, thắt lưng, đế, vết bẩn). Material giữ mảng màu dạng uniform. Mắt phát sáng qua uniform riêng. Mọi material nhân vật dùng chung một chương trình shader (`customProgramCacheKey`). |
| Culling | `boundingSphere` cố định bán kính 1,6 m quanh tâm cao 0,9 m, bao mọi tư thế. |
| Vũ khí | Socket ở nắm tay phải (con của xương khuỷu phải), vẫn nghiêng 45°. Quy ước grip `WEAPON_GRIPS` giữ nguyên. |
| Pose | `pose.ts` thêm khuỷu, gối, cổ chân, xoay/nghiêng chậu, nghiêng thân, quay đầu, dạng chân. Đi: gối gập khi chân vung lên trước, cổ chân giữ bàn chân gần phẳng. Chạy: khuỷu ~90°. Vung gậy: khuỷu co khi lấy đà, duỗi đúng lúc trúng. **Chân chạm sàn:** chậu hạ theo chân dài hơn (`legReach`), thay cho nhún cố định cũ (làm chân lơ lửng khi dang rộng). |
| Bóng | Một mesh nên 'full' và 'body' như nhau (một vật đổ bóng); 'none' khi tắt bóng. |

Không đổi: `gait.ts`, `animators.ts`, cách PlayerView/ZombieView đọc timer của runtime, vision/cutaway, save, config.

## 3. Số đo

A/B xen kẽ C0 (worktree `7524e86`) / C1, thứ tự A B B A. Máy: i5-11500, RTX 3060, Chrome headless ANGLE D3D11, uncapped, 1280 × 800, DPR 1, Medium, bóng cao. Cảnh: `c0-character-bench` (zombie vây player bất tử ở ngã tư neighborhood-50). Chi tiết `docs/character/c1/ab.json`.

| Zombie | Frame median C0 → C1 (ms) | p95 C0 → C1 | CPU median | Draw call | Tam giác |
| --- | --- | --- | --- | --- | --- |
| 0 | 1,6 → 1,5–1,7 | 3,4–3,5 → 3,0–3,6 | 1,2 → 1,1–1,2 | 64 → 52 | 20,3 k → 23,2 k |
| 10 | 3,6–3,8 → **2,8** | 8,0–9,0 → 5,8–6,0 | 2,9–3,1 → 2,0–2,1 | 206 → **72** | 22,0 k → 53,1 k |
| 30 | 7,0–7,1 → **4,3–4,4** | 15,2–16,4 → 9,2–10,0 | 6,0 → 3,4–3,5 | 425–452 → **105** | 24,7 k → 101,6 k |

- Mỗi nhân vật: ~1 300 tam giác, 1 draw call + 1 bóng (trước: 10–11 mesh, 5 material, ~14 draw call).
- Thời gian pose (`animatorMs`): 0,2–0,5 → 0,3–0,5 ms ở 30 zombie. Cập nhật skeleton nằm trong render, có trong frame time.
- Vòng đời (8 × sinh/xóa 20 zombie): geometry, texture, program trước = sau. Số geometry tăng một lần theo số khóa hình dạng đã gặp (tối đa 9), không tăng theo số zombie.
- Tam giác tăng ~4 lần nhưng vẫn nhỏ so với GPU; chi phí nằm ở số draw call, đã giảm 3–4 lần.

## 4. Kiểm tra đã chạy

- `body.test.ts` (mới, 7 test):
  - một mesh, trọng số bằng 1, ô màu hợp lệ, dưới 2 500 tam giác;
  - 40 zombie dùng ≤ 9 geometry, 40 material riêng;
  - cao 1,74–1,85 m, rộng ≤ đường kính capsule, chân ở sàn với mọi preset × tóc;
  - chu kỳ đi/chạy/zombie: điểm thấp nhất trong [−3; +3,5] cm ở 16 pha;
  - vòng khuỷu blend nằm trong bán kính tay quanh khớp khi chạy;
  - da zombie không còn xanh lá;
  - dispose chỉ giải phóng material và texture xương, không đụng geometry dùng chung.
- `character.test.ts` sửa theo material đơn.
- Toàn bộ: **633 test**; lint, tsc, build, build:editor, check:bundle sạch.
- Playwright (dev, `GPU=1`):
  - `p2-s3-browser` PASS: rig/socket, vung (tay ngang trước mặt đúng frame trúng), zombie chết, tắt bóng;
  - `p2-s4-browser` PASS (lần chạy đầu fail vì thời gian, lần hai PASS);
  - `p2-s5-gait` PASS: chân đổi góc 99,8 % frame ở ~770 FPS, mỗi bước đúng một âm;
  - `p2-vision-browser` PASS.
- Script cũ tìm khớp theo tên (`shoulderR`, `torso`, `hipL`) thay vì chỉ số con. `p2-s5-gait` có thêm `GPU=1`: từ G1, SwiftShader chỉ đạt 3 FPS nên script đã hỏng từ trước C1.
- Lab: ảnh lặp lại giống 100 %.

## 5. Còn lại / giới hạn

- Chỉ một bộ đồ (áo thun + quần dài). Màu viền, giày, đế lấy mặc định. → C2.
- Player vẫn chạy tại chỗ khi bị tường chặn; bước lùi/ngang; animation còn chạy khi pause. → C3.
- Đòn đánh, bị đánh, chết vẫn như cũ (chỉ thêm khuỷu). → C4.
- Mọi zombie cùng dáng tay giơ. → C5.
- Ở zoom 28, người mảnh hơn khối hộp cũ (đúng tỷ lệ thật). Mắt ~1 px, hướng mặt đọc chủ yếu qua tóc/gáy và tư thế.
