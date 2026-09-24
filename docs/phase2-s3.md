# P2-S3 — Quyết định và kiểm chứng

Ngày: 24/09/2026. Phạm vi: mục Sprint P2-S3 trong `Zombie_Outbreak_Phase_2_Plan.md` (model, animation, tạo nhân vật). Mốc trước sprint: `049c3c4`.

## Asset: rig dựng bằng code, không dùng file ngoài

Plan yêu cầu kiểm tra quyền dùng asset trước khi sản xuất. Đã chọn **rig low-poly dựng bằng code** (`src/game/rendering/character/`) thay vì tải GLB:

- Không có vấn đề giấy phép, không có file nhị phân, bundle không tăng đáng kể. Không cần ghi nguồn/giấy phép vì không thêm asset ngoài.
- Một rig cho mọi preset player và mọi zombie (plan: "một rig player, một rig zombie; biến thể bằng tóc/màu/material"). Cây khớp: gốc ở chân → hông → chân trái/phải; thân → đầu (mặt, tóc) và vai trái/phải → `weaponSocket` ở tay phải.
- Tự chủ đủ bộ clip plan cần: idle, walk, run, melee swing, shove, hit reaction, death cho player; idle, walk/chase, attack (dùng lại cho bash cửa ở S5), hit reaction, death cho zombie.
- Quy ước để có thể thay bằng GLB sau này: gốc ở chân, trục tiến +Z, tay phải ở −X, vũ khí kéo dài theo +Z từ điểm cầm; `WEAPON_GRIPS` giữ offset/rotation từng vũ khí.

Kích thước: cao 1,8 m (khớp capsule), chân 0,86, thân 0,58, đầu 0,27, tay 0,64. Ba preset chỉ đổi bề rộng; bề ngang vai + tay ≤ 0,8 m (đường kính capsule), có test cho mọi preset × kiểu tóc. Dùng chung một `BoxGeometry` đơn vị cho mọi bộ phận. Material riêng mỗi nhân vật nên màu player không làm zombie đổi màu và hit flash chỉ tác động một con.

## Animation

- `pose.ts` là hàm thuần: state simulation → góc khớp. Animation tại chỗ; vị trí do controller/physics điều khiển như cũ. Pha bước chân tăng theo quãng đường đi được (không trượt chân); bỏ qua dịch chuyển tức thời (load/teleport).
- **Thời điểm damage vẫn do combat quyết định.** Pose chỉ phản chiếu `attackTimer`: keyframe yaw của tay cầm vũ khí đi qua chính diện đúng ở `hitDelay / swingDuration`, và chỉ cắt qua một lần (có test), nên loop/blend không thể tạo đòn thứ hai. Zombie: giơ tay (0 → 0,7) rồi đập xuống ở tiến trình 1 = frame damage của `attackWindup`; view giữ tư thế đập 0,18 s cho dễ nhìn (chỉ hình ảnh).
- Shove suy từ `pushCooldown` (không thêm state). Hit reaction: zombie dùng `staggerTimer`; player có `hurtTimer` 0,3 s mới (chỉ hiển thị, không lưu, không đặt khi mất máu vì đói). Death: ngã ngửa quanh chân (player 0,6 s theo thời gian view, zombie theo `deadTimer`). Zombie chết đã bị runtime tắt body/AI; animation không gây damage.
- **Sửa trễ một frame:** trước đây `useFrame` của view chạy trước `GameLoop.tick` (theo thứ tự mount), nên pose luôn là của tick trước. Giờ view đăng ký callback vào `CharacterAnimator` gắn sau `GameLoop`; thứ tự tick/physics không đổi. Đo trong trình duyệt: frame gần `hitDelay` nhất (t = 0,139–0,172 s) có yaw tay −0,07…0,09 rad (chính diện).
- Zombie: mắt sáng đỏ khi CHASE/ATTACK (thay cho màu thân theo state của capsule cũ), thanh máu giữ nguyên.

## Weapon socket

`weaponSocket` ở cuối tay phải, nghiêng 45° để vũ khí chúc xuống-trước khi nghỉ và hướng trước-lên khi vung ngang. Model vũ khí (gậy, ống sắt, xà beng có móc, búa cán + đầu) dựng từ primitive trong `weaponModels.ts`, gắn vào socket khi equip, gỡ và dispose khi unequip/đổi. Vũ khí hỏng ánh đỏ. Kiểm chứng trong scene thật: socket chứa đúng `weapon:crowbar` sau khi trang bị.

## Tạo nhân vật

- Luồng: **New Game → Tạo nhân vật → Bắt đầu → (có save: "Xóa bản lưu và bắt đầu") → world**. Menu chính không còn xóa save; "Quay lại" không đụng save; save chỉ bị xóa sau xác nhận ghi đè (trước đây bị xóa ngay khi bấm New Game). Game over → New Game cũng qua màn tạo nhân vật. Continue đọc ngoại hình từ save, không mở lại màn này.
- Nội dung: tên ≤ 24 ký tự (NFC, đếm theo code point nên dấu tiếng Việt tính 1, trim, để trống → "Người sống sót"); 3 dáng (Cân đối, Vạm vỡ, Mảnh khảnh), 3 kiểu tóc (ngắn, dài, mohawk), 4 màu da, 4 màu áo, 4 màu quần; Ngẫu nhiên, Mặc định. Preview 3D idle trên canvas riêng (lazy), kéo chuột để xoay.
- `CharacterAppearance` tách khỏi chỉ số: chỉ lưu ID lựa chọn. Test: ba preset cho snapshot gameplay giống hệt nhau trừ tên/ngoại hình.
- Tên hiện trên HUD, trong thông tin save ở menu và màn game over.
- **Sửa lỗi input:** `InputManager` gọi `preventDefault` cho Space/mũi tên *trước* khi bỏ qua ô nhập, nên ô tên không gõ được dấu cách. Giờ kiểm tra ô nhập trước.

## Save v4

- `SAVE_SCHEMA_VERSION = 4`: `player.name`, `player.appearance`. v4 bắt buộc tên hợp lệ (đã chuẩn hóa) và appearance đúng 5 ID đã biết; ID lạ bị coi là hỏng, không tự đoán.
- Chuỗi migrate thuần: v1 → v2 → v3 → v4, v2 → … → v4, v3 → v4 (tên/ngoại hình mặc định, không đổi gì khác; có test so từng trường với fixture S2). `migrateV2` giờ ghi đúng version 3 thay vì hằng số hiện tại. Backup `slot-1.backup-v3` cho save S2. Toast Continue nói rõ nhân vật dùng ngoại hình mặc định.
- Fixture `phase2-s3-v4.json` xuất từ save thật trong Chromium (Trần Tùng, vạm vỡ/mohawk/da sẫm/áo đỏ/quần ô liu, cầm xà beng 90). Fixture v1/v2/v3 giữ nguyên; script S2 không còn ghi đè fixture v3.

## Hiệu năng (cùng cảnh)

`scripts/p2-render-bench.mjs`: seed 20260924, player ở ngã tư, 10 zombie đứng vòng tròn bán kính 4 m, camera mặc định, pixel ratio 1, 1280×800. Số liệu lấy từ `renderer.info` (hook chỉ có ở dev). **FPS headless SwiftShader không phải benchmark GPU**; draw call và tam giác mới so sánh được giữa hai bản.

| Bản | Bóng | Draw call | Tam giác | FPS headless |
|---|---|---:|---:|---:|
| S2 (capsule) | High | 147 | 6 180 | 12 |
| S2 (capsule) | Low | 147 | 6 180 | 22 |
| S3 rig, mọi bộ phận đổ bóng | High | 329 | 3 876 | 15 |
| S3 rig, mọi bộ phận đổ bóng | Low | 249 | 2 916 | 19–20 |
| **S3 rig, giới hạn vật đổ bóng (bản giao)** | High | **271** | 3 180 | 15 |
| **S3 rig, giới hạn vật đổ bóng (bản giao)** | Low | **238** | 2 784 | 19 |

Mỗi nhân vật ~10–11 mesh nên draw call tăng gần gấp đôi, số tam giác giảm. Đã giới hạn vật đổ bóng: High = thân, đầu, chân; Low = thân; Off = không (tay/tóc không đổ bóng vì gần như không thấy từ camera isometric cao). Bóng Off trong trình duyệt: 35 draw call, zombie vẫn render và animate. Nếu GPU tích hợp thật bị nghẽn draw call ở S8, hướng tiếp theo là InstancedMesh theo bộ phận hoặc gộp geometry tĩnh; chưa làm vì chưa đo trên máy thật.

## Kiểm chứng

- **173 test** (19 file): dữ liệu ngoại hình/tên (NFC, 24 ký tự, randomize phủ mọi lựa chọn), ba preset cùng state gameplay, save/load giữ ngoại hình, từ chối ID lạ/tên sai; rig (chân ở 0, cùng chiều cao mọi preset × tóc, vừa capsule, nhìn +Z, socket tay phải), zombie biến thể xác định theo ID, material không chia sẻ; pose (chính diện đúng frame hit, một lần cắt, chân đối pha, zombie giơ-đập, chết nằm ngửa, mọi tổ hợp hữu hạn); migration v3→v4 và chuỗi v1/v2; fixture v4 round-trip. Soak shelter/patrol **giữ nguyên số liệu S2**. `npm run build`, `npm run lint` sạch.
- **Playwright + Chromium 151 headless, context riêng** — `scripts/p2-s3-browser.mjs`:
  - Dev: tạo nhân vật 1 bằng input thật (gõ tên, chọn 5 hàng, kiểm tra `aria-checked`) → HUD tên → lưu v4 đúng. New Game → đổi tóc → Quay lại: save y nguyên. Nhân vật 2 gõ "␣␣Trần Tùng␣␣" (dấu cách chạy được) → Ngẫu nhiên → Mặc định → chọn → Bắt đầu hiện xác nhận ghi đè, save vẫn nguyên cho tới khi xác nhận. Scene có 1 rig/nhân vật, socket chứa `weapon:crowbar`; mẫu cú vung sau tick; zombie giơ tay, trúng đòn, chết nằm ngửa (−π/2); lưu → reload → Continue giữ tên/ngoại hình; bóng Off vẫn render. Không lỗi console/page.
  - Production: không `__runtime`; cùng luồng tạo nhân vật/Back/ghi đè/lưu/reload/Continue. PASS 3 lần liên tiếp; một lần chạy đầu thất bại nhưng log bị cắt mất (chỉ giữ 3 dòng cuối) nên không rõ nguyên nhân, nghi timeout khi Chromium CDP và preview khởi động cùng lúc. Theo dõi nếu lặp lại.
  - Hồi quy: `p2-s2-browser.mjs` dev (loot/đánh/hỏng/thả/lưu, migration v3/v2/v1 → v4 kèm backup) và production PASS; `p2-smoke.mjs` (S1: migration v1, backup, schema 99, xung đột transaction, túi đầy, cửa/raycast/nav, slot-lab) dev + production PASS.
  - Ảnh (không track): `node_modules/.tmp/p2s3-creation.png`, `p2s3-ingame-closeup.png`, `p2s3-swing.png`, `p2s3-zombie-dead.png`, `p2s3-low-graphics.png`, `p2s3-prod-ingame.png`, `p2-bench-*.png`.

## Giới hạn còn lại

- Model là khối low-poly, không có ngón tay/khuỷu/đầu gối; chưa dùng GLB. Đủ cho yêu cầu S3; nâng cấp ngoại hình là việc tùy chọn sau này.
- Chưa có animation làm việc chung cho craft/build (S4 sẽ dùng lại tư thế tay trước), chưa có tư thế bash riêng (S5 dùng lại attack).
- FPS thật trên GPU tích hợp chưa đo; draw call tăng ~1,6–1,8× so với capsule.
- Tên nhân vật chỉ hiển thị, chưa có kiểm duyệt nội dung.
