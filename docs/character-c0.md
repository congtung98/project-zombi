# Nhân vật C0: audit, baseline và phương án rig

Ngày 27/09/2026. Bước đầu của kế hoạch `docs/Character_Zombie_Model_Animation_Plan.md` (C0 → C6), làm ngay sau đợt đồ họa môi trường G0–G6 (đã commit, baseline ổn định).

C0 **không đổi hình ảnh game**. Sprint này gồm:
- audit cách dựng, cách animate và cách vẽ nhân vật/zombie;
- trang lab nhân vật (chỉ ở dev) và hai script chụp/đo cố định;
- ảnh và số đo baseline;
- phương án rig được chọn (có số đo), chia sprint và dự kiến file sẽ sửa.

Chủ dự án (27/09/2026): tự làm hết C0 → C6, mỗi sprint tự commit và push, dùng khuyến nghị của agent khi cần quyết định. Quy tắc "dừng sau mỗi sprint" trong kế hoạch được thay bằng quyết định này.

## 1. Audit

| # | Câu hỏi | Hiện trạng |
| --- | --- | --- |
| 1 | Visual tạo ở đâu, bao nhiêu mesh/material/draw call | `src/game/rendering/character/rig.ts` (`buildCharacter`): cây `Group` + các hộp đơn vị `BoxGeometry(1,1,1)` dùng chung, co giãn theo bộ phận. Mỗi nhân vật **10–11 mesh** (2 chân, thân, đầu, dải mắt, 1–2 khối tóc, 2 × tay áo + cẳng tay), vũ khí thêm 1–2 mesh. **5 material riêng mỗi nhân vật** (da, áo, quần, tóc, mắt). Bóng: chân, thân, đầu (4 mesh) ở bóng cao. Đo: **~14 draw call mỗi zombie** (cả pass bóng). |
| 2 | Skeleton/skinning/AnimationMixer? | Không. Animation procedural thuần: `pose.ts` (`computePose`: trạng thái mô phỏng → góc khớp), `applyPose` ghi vào các `Group`. Không clip, không mixer. Khớp: hông, thân, đầu, 2 vai, 2 hông chân. **Không có khuỷu, gối, cổ chân.** |
| 3 | Root, forward, up, đơn vị, gốc | 1 đơn vị = 1 m, +Y lên, **+Z là phía trước**, tay phải ở −X. Gốc `root` ở **chân**. Player: `RigidBody` capsule (tâm capsule) → `visualRef` xoay theo `facing` → nhóm dịch −height/2 → `rig.root`. Zombie: nhóm đặt ở `z.position` (chân) → `visualRef` xoay → `rig.root`. Cao 1,8 m (config `player.height`, `zombie.height`), bán kính 0,4. |
| 4 | Ai sở hữu movement, combat, damage, stagger, death | `runtime.ts` (tick cố định): vị trí, `facing`, `moveSpeed`, `stridePhase`, `attackTimer`, `pushCooldown`, `hurtTimer`, `alive`. Zombie: `systems/ai.ts` (`attackWindup` đếm lùi tới frame gây sát thương, `staggerTimer`, `knockback`, `hitFlashTimer`, `deadTimer`, `ai`). Tầm đánh/hit window: `config.melee` (hitDelay 0,15 s / swing 0,35 s, range 2 m, nửa góc 60°), `config.zombie` (attackWindup 0,3 s, range 1,5 m). Animation **chỉ đọc** các giá trị này; không có callback nào từ animation gây damage. |
| 5 | Vũ khí gắn thế nào, grip, event | `weaponModels.ts`: mô hình từ khối cơ bản, kéo dài theo +Z từ điểm cầm; `WEAPON_GRIPS` = offset/góc trong socket. Socket `weaponSocket` là con của **vai phải** ở cuối tay, nghiêng 45°. PlayerView đổi model khi đổi vũ khí/hỏng. Âm thanh/hit do runtime phát (`events`), không do animation. |
| 6 | LOS, tầng, cutaway, mask, bóng | Zombie: `runtime.vision.opacity(id)` (mờ dần/ẩn), `cutaway.hidesPoint` (tầng bị ẩn) → `visual.visible`; ẩn thì không vẽ, không bóng, bỏ pose. Opacity < 1: material chuyển transparent. Thanh máu ẩn khi opacity ≤ 0,5. Player luôn hiện. Material nhân vật là `MeshStandardMaterial` thường: **không** qua shader bề mặt (mask nội thất, bóng tiếp xúc, đèn trong nhà theo phòng). |
| 7 | State lưu, ID, RNG ngoại hình | Player: `appearance` = 5 ID ngữ nghĩa (`preset`, `hair`, `skin`, `shirt`, `pants`, `entities/appearance.ts`), save v4+ kiểm tra đúng 5 khóa. Zombie: không lưu ngoại hình, `zombieLook(id)` băm FNV-1a từ ID (ID được lưu) → ổn định qua load. Vẫn còn **da xanh lá** (kế hoạch yêu cầu nhợt/xám). |
| 8 | Nhiều zombie: update, culling, batching | Mỗi zombie một `ZombieView` React (mount khi không DORMANT), pose trong `registerAnimator` chạy một lần mỗi frame sau tick (`CharacterAnimator` trong `Scene.tsx`), không qua React re-render. Không instancing/batching; frustum culling mặc định từng mesh. Geometry dùng chung, material riêng. |

**Khác:**
- Gait: `gait.ts` lọc tốc độ theo hằng số thời gian (độc lập FPS). Player lấy `moveSpeed`/`stridePhase` **dự định** từ runtime (cùng nhịp âm bước chân) → **chạy tại chỗ khi bị tường chặn**. Zombie đo từ vị trí thật → không có lỗi này.
- Khi đang vung gậy, player giữ hướng nhìn về con trỏ và vẫn di chuyển → có đi lùi/đi ngang, nhưng chân chỉ có một kiểu bước tiến.
- **Pause:** `CharacterAnimator` vẫn chạy khi menu mở: đồng hồ thở, ngã chết (`deadTime` của player) vẫn tiếp tục; tốc độ đo của zombie tụt về 0 khi dừng → chân khựng lại khi tiếp tục.
- Xác zombie vẫn được pose mỗi frame tới khi bị dọn (`corpseLifetime` 20 s).
- Chết của player: màn hình kết thúc, không respawn. Zombie: `ai = 'DEAD'`, ngã 0,45 s.
- Hướng đòn: zombie có `knockback` (vector từ người đánh); player bị đánh không có hướng.

## 2. Nguồn dữ liệu authoritative cho animation

| Dữ liệu | Player | Zombie |
| --- | --- | --- |
| Vị trí | body Rapier (runtime đặt vận tốc) | `z.position` (AI/runtime) |
| Hướng | `player.facing` | `z.facing` (view làm mượt khi xoay) |
| Tốc độ, pha bước | `moveSpeed`, `stridePhase` (dự định) → C3 đổi sang tốc độ thật | đo từ vị trí |
| Đánh | `attackTimer / swingDuration`, hit ở `hitDelay / swingDuration` | `attackWindup` đếm lùi → 1 = frame damage |
| Đẩy | `pushCooldown` | — |
| Bị đánh | `hurtTimer` (0,3 s) | `staggerTimer`, `hitFlashTimer`, `knockback` |
| Chết | `alive` | `ai === 'DEAD'`, `deadTimer` |
| Tầng/cầu thang | `position.y` do runtime đặt theo sàn | như player |
| Làm việc | `runtime.action.elapsed` | — |

## 3. Hệ thống có đáp ứng yêu cầu của kế hoạch không

**Đã có, giữ nguyên:**
- Pipeline procedural thuần: animation không bao giờ gây damage, không root motion, không phụ thuộc React re-render, không phát event (âm thanh do runtime) → yêu cầu idempotent, hitch, crossing marker đã thỏa theo thiết kế.
- Một rig cho mọi preset và zombie, collider không đổi theo preset, socket vũ khí có quy ước grip.
- Ngoại hình lưu bằng ID ngữ nghĩa; zombie ổn định theo ID.
- Vision/cutaway ẩn zombie (và bóng) đúng luật.

**Thiếu (việc của C1–C6):**
- Hình khối: hộp thẳng, không eo/hông, không khuỷu/gối/bàn chân, đầu vuông (C1).
- Quần áo chỉ là màu áo/quần; không có bộ trang phục (C2).
- Player chạy tại chỗ khi bị chặn, không có bước lùi/ngang, animation chạy khi pause (C3).
- Đòn đánh chỉ xoay cánh tay; chết luôn ngã ngửa; xác vẫn được pose (C4).
- Zombie da xanh lá, mọi con cùng một dáng và nhịp (C5).
- Chi phí vẽ: 5 material + ~11 mesh mỗi nhân vật (C1 thay; C6 đo lại).

## 4. Phương án rig được chọn

Kế hoạch §5 cho hai lựa chọn: hierarchy rigid cải tiến, hoặc skinned mesh dùng chung rig. Số đo C0 cho thấy **số mesh rigid là nút cổ chai**: 10 zombie thêm 142 draw call (64 → 206), 30 zombie thêm 390 (→ 454). CPU khung hình tăng 1,6 → 3,1 → 5,4 ms, trong khi thời gian pose chỉ 0,1–0,2 ms. Tức chi phí nằm ở số lần vẽ, không ở tính góc khớp. Làm hình khối đẹp hơn bằng thêm mesh rigid sẽ còn tăng số này.

**Chọn: skinned mesh trọng số cứng trên chính cây khớp hiện có.**
- Giữ nguyên `pose.ts`, `gait.ts`, `animators.ts`, hợp đồng với gameplay. Chỉ thay phần dựng hình trong `rig.ts`.
- Các khớp thành `Bone` (là `Object3D`, `applyPose` ghi góc như cũ). Thêm khuỷu, gối, cổ chân.
- Mỗi nhân vật **một `SkinnedMesh`**. Mỗi bộ phận gắn cứng vào một xương (trọng số 1). Một số vòng ở khớp (eo, vai, khuỷu, gối) chia trọng số cho hai xương để không hở. Kết quả trông như rigid parts nhưng liền, và chỉ **1 draw call + 1 bóng** mỗi nhân vật.
- Hình khối dựng bằng **loft** (nối các tiết diện bát giác vát góc), không phải hộp: vai → eo → hông, chi thuôn, đầu vát hàm, bàn chân có mũi/gót.
- **Geometry dùng chung** theo khóa hình dạng (preset, trang phục, tóc, dáng zombie), cache một lần. Màu theo **bảng màu từng nhân vật**: mỗi đỉnh mang một chỉ số ô màu; material riêng mỗi nhân vật giữ mảng màu (uniform), nên đổi màu, nhấp nháy khi trúng đòn hay mờ một nhân vật không ảnh hưởng con khác. Mọi material nhân vật dùng chung một chương trình shader.
- Culling: bounding sphere cố định bao mọi tư thế (kể cả vung tay, ngã).
- Vũ khí vẫn là mesh riêng gắn vào xương bàn tay phải (1–2 draw call, chỉ player).

Không làm hai pipeline: không có đường rigid song song. Không dùng file GLB hay asset ngoài; mọi hình khối do code sinh (như đồ đạc G3). Không dùng instancing cho skinned mesh.

## 5. Baseline

Môi trường: Windows 11, i5-11500, RTX 3060, Chrome 154 headless, ANGLE D3D11, không giới hạn FPS (`--uncapped`), 1280 × 800, DPR 1, Medium, bóng cao, zoom 28, 12:00. Máy không chạy tải khác. Chi tiết: `docs/character/c0/bench.json`.

| Zombie | Frame median / p95 (ms) | CPU median / p95 (ms) | Pose (ms) | Draw call | Tam giác | Mesh nhân vật đang hiện | Material nhân vật |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 2,2 / 5,2 | 1,6 / 3,7 | 0 / 0,1 | 64 | 20,3 k | 10 | 5 |
| 10 | 3,8 / 8,4 | 3,1 / 6,7 | 0,1 / 0,2 | 206 | 22,0 k | 112 | 55 |
| 30 | 6,3 / 10,3 | 5,4 / 8,7 | 0,2 / 0,4 | 454 | 25,0 k | 291 | 140 |

Zombie đuổi player bất tử ở ngã tư neighborhood-50 (AI thật, vây và đánh). Vòng đời: 8 lần sinh rồi xóa 20 zombie, bộ nhớ renderer trước/sau như nhau (34 geometry, 29 texture, 11 program).

Ảnh (`docs/character/c0/`): `lineup-z28`/`lineup-z100` (player, player cầm gậy, 4 zombie), `states-z28`/`states-z80` (player: đứng, đi, chạy, 3 pha vung, bị đánh, chết; zombie: đứng, đi, giơ tay, đập, bị đánh, chết), `turn-z28`/`turn-z80` (8 hướng), `bench-10` (trong game).

Nhận xét baseline ở zoom chơi: nhân vật cao ~50 px. Đọc được hướng mặt nhờ dải mắt. Nhưng người và zombie đều là 3 khối (đầu, thân, chân); tay không có khuỷu, không bàn chân. Zombie xanh lá, hai tay luôn giơ thẳng.

## 6. Công cụ

- **Lab nhân vật** `/?lab=characters` (dev, `src/lab/CharacterLab.tsx`): cùng rig, hàm pose, góc camera, zoom và ánh sáng ban ngày như game, trên lưới 1 m / 25 cm. Tư thế cố định, không đồng hồ, nên ảnh giống hệt nhau giữa các lần chạy. Tham số: `set` = `lineup` / `states` / `turn`, `zoom`, `yaw`, `t`. Bản build production bỏ nhánh này.
- `scripts/c0-character-lab.mjs`: chụp 6 ảnh lab, `--compare=<thư mục>` so pixel, `--docs=<thư mục>` lưu JPEG.
- `scripts/c0-character-bench.mjs`: đo đám đông (`--densities=0,10,30`), vòng đời, `--docs`.
- `perf`: gauge mới `animatorMs` (thời gian `runAnimators` mỗi frame) và cột `animatorMs` trong frame log.

## 7. Chia sprint (khuyến nghị, đã chốt)

| Sprint | Nội dung | File chính |
| --- | --- | --- |
| **C1** | Rig skinned một mesh; khớp mới (khuỷu, gối, cổ chân); thân loft vai-eo-hông, chi thuôn, đầu vát, bàn tay, giày; bảng màu từng nhân vật; pose cho khớp mới ở tư thế hiện có; zombie da nhợt/xám. Scripts cũ tìm khớp theo tên. | `character/rig.ts`, mới `character/body.ts` (loft, geometry dùng chung), `character/material.ts`, `pose.ts`, tests, `scripts/p2-s3`, `p2-s4`, `p2-s5-gait` |
| **C2** | Trang phục: áo thun + quần dài, áo khoác + jeans, sơ mi + quần âu, đồ lao động; 3 kiểu tóc gọn; ID `outfit` tùy chọn trong appearance (save cũ có mặc định), màn tạo nhân vật. | `entities/appearance.ts`, `character/outfits.ts`, `save.ts`, `CharacterCreation.tsx` |
| **C3** | Locomotion player: tốc độ thật sau va chạm (không chạy tại chỗ), bước lùi/ngang khi vung, gối/cổ chân khi bước, dồn trọng lượng khi đứng, pause dừng animation. | `PlayerView.tsx`, `pose.ts`, `gait.ts`, `Scene.tsx` |
| **C4** | Đòn đánh có vai/thân (chuẩn bị → chạm → hồi), grip ở bàn tay, bị đánh theo hướng (zombie có knockback), chết có biến thể ngã theo hướng, xác đứng yên thì thôi pose. | `pose.ts`, `ZombieView.tsx`, `PlayerView.tsx` |
| **C5** | Zombie: 4 dáng (lê chân, khom, lệch vai, cứng đờ), pha bước và nhịp theo seed ổn định, tay theo trạng thái (buông khi lang thang, vươn khi đuổi), quần áo bạc/rách từ catalog C2. | `character/zombieVariants.ts`, `pose.ts`, `ZombieView.tsx` |
| **C6** | Visibility (vũ khí/tóc/xác theo luật ẩn), mức chất lượng, đo lại so với C0, vòng đời, sổ tay bàn giao. | `docs/character-handbook.md`, bench |

Mỗi sprint: code, test, ảnh lab + số đo, `docs/character-cN.md`, cập nhật `CURRENT_STATE.md`, commit và push.

**Hoãn (cần gameplay chưa có):** hướng đòn khi player bị đánh (runtime không lưu người đánh); zombie nhanh/chậm theo loại (chưa có loại); IK chân trên bậc thang (sàn cầu thang là dốc liên tục, chỉ căn chân theo `position.y`).

## 8. Kiểm chứng C0

- Game không đổi hình ảnh (chỉ thêm lab dev, gauge đo).
- 626 test, lint, tsc, build, check:bundle sạch (xem CURRENT_STATE).
