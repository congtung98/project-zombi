# Sổ tay nhân vật

Bàn giao của kế hoạch `docs/Character_Zombie_Model_Animation_Plan.md` (§15), sau C0–C6. Chi tiết từng bước: `docs/character-c0.md` … `docs/character-c6.md`. Ảnh cuối: `docs/character/c6/`.

## 1. Hợp đồng thân và rig

**Đơn vị và trục:** 1 m. Gốc ở chân, +Y lên, **+Z phía trước**, tay phải ở −X. Cao 1,8 m (tóc tới ~1,80), rộng ≤ đường kính capsule 0,8 m. Collider và chiều cao gameplay (`config.player`, `config.zombie`) không phụ thuộc hình.

**Xương** (`rendering/character/body.ts`, `BONES`), rest pose chỉ có tịnh tiến:

| Xương | Cha | Vị trí nghỉ (preset cân đối) |
| --- | --- | --- |
| `hips` | — | y 0,93 (chậu) |
| `torso` | hips | +0,07 (lưng dưới) |
| `head` | torso | +0,50 (gốc cổ, 1,50) |
| `shoulderL/R` | torso | x ±0,20, +0,42 (thứ tự Euler YXZ) |
| `elbowL/R` | shoulder | −0,29 |
| `hipL/R` | hips | x ±0,092, −0,03 |
| `kneeL/R` | hip | −0,42 |
| `ankleL/R` | knee | −0,40 (cổ chân cao 0,08) |

- Chiều dài xương giống nhau cho mọi preset và cho zombie. Preset chỉ đổi độ rộng (`bulk`, `depth`) và vị trí vai/hông theo chiều ngang.
- **Một `SkinnedMesh` mỗi nhân vật.** Trọng số cứng. Vòng khuỷu/gối chia 50/50, gấu áo chia cho chậu, gốc cổ theo ngực.
- Một draw call + một bóng mỗi nhân vật. Vũ khí là mesh riêng.
- Bounding sphere cố định (tâm y 0,9, bán kính 1,6) bao mọi tư thế.

**Hình khối:** loft bát giác vát góc (`loft.ts`), dựng trực tiếp có chỉ số. Dùng chung theo khóa `preset/hair/outfit[/worn]` (tối đa 72 khóa, 1 500–2 100 tam giác, ~100–150 KB mỗi khóa, dựng ~4 ms lần đầu gặp, không bao giờ dispose). Mỗi đỉnh mang ô màu `paint`.

**Material:** `CharacterMaterial` (`material.ts`).
- Bảng 11 ô màu dạng uniform + mắt phát sáng.
- Một chương trình shader cho mọi nhân vật; mỗi nhân vật một material, nên nhấp nháy/mờ/đổi màu không lan sang con khác.
- **Nối chuỗi `applyIndoorShader`**, nên nhận ánh sáng phòng và mask nội thất như mọi material chuẩn. Material nhân vật mới nào có `onBeforeCompile` riêng cũng phải làm vậy.

**Ô màu** (`SLOT`): da, áo (`top`), viền, quần (`bottom`), giày, tóc, mắt (phát sáng), thắt lưng/mép khóa, đế, vết bẩn (`stain`), kim loại (`metal`).

## 2. Preset và catalog

| Nhóm | ID | Nơi định nghĩa |
| --- | --- | --- |
| Dáng người | `balanced`, `sturdy`, `slim` | `appearance.ts`, `BODY_FRAMES` |
| Tóc | `short`, `long`, `mohawk` | `appearance.ts`, `hair()` trong `body.ts` |
| Trang phục | `tee`, `jacket`, `shirt`, `work` | `OUTFIT_STYLES`, `OUTFIT_BUILDERS`, màu cố định `OUTFIT_COLORS` (`rig.ts`) |
| Da / áo / quần (player) | 4 / 4 / 4 | `SKIN_HEX`, `SHIRT_HEX`, `PANTS_HEX` |
| Dáng zombie | `shambler`, `hunched`, `lurcher`, `stiff` | `zombieVariants.ts` `POSTURES` |
| Zombie | preset, tóc, bộ, da (7), áo (11), quần (7) bạc màu, tóc (4), đồ bẩn (~7/10), màu vết (3) | `zombieLook` (`rig.ts`), `zombieMotion` |

- Player lưu ID ngữ nghĩa trong save (`appearance`; `outfit` tùy chọn, mặc định `tee`). Không lưu mesh, material hay tư thế.
- Zombie không lưu gì: mọi biến thể băm từ ID (`idHash`, FNV-1a + trộn murmur3). ID được lưu, nên ngoại hình ổn định qua save và streaming.

## 3. Animation: adapter và bảng trạng thái

Animation là **hàm thuần** `computePose(PoseInput) → Pose` (`pose.ts`). `applyPose` ghi góc vào xương. `CharacterAnimator` (`Scene.tsx`) gọi mọi view sau tick, không qua React re-render, với `delta = min(delta, loop.maxDelta)`, và **0 khi pause**. Animation không di chuyển gốc, không gây damage, không phát event. Mọi âm thanh và hit đến từ runtime.

| Trạng thái gameplay (nguồn) | Đầu vào pose | Hình |
| --- | --- | --- |
| Player di chuyển (vị trí thân, `moveSpeed`, `stridePhase`, `facing`) | `advancePlayerGait` → `gaitPhase`, `speed`, `hipTurn` | Đi/chạy theo tốc độ thật; bị chặn thì dừng; lùi/ngang thì xoay chậu |
| Player đứng yên | `time` | Thở, dồn trọng lượng |
| Player ở thế chiến đấu (`runtime.combatPosture`, CS1) | `ready` (blend 0,14 s ở view), `aimLead` (ngực dẫn tới ±35° về `stance.aimYaw`) | Gậy nâng hai tay qua vai phải / nắm đấm giơ lên; gối chùng |
| Player vung (`attackTimer / swingDuration`, `hitDelay`; CS1b: giữ ở `windup` khi còn căn hướng) | `swing`, `hitAt` | Lấy đà (đi ra từ tư thế sẵn sàng) → chạm đúng `hitAt` → hồi (về lại tư thế sẵn sàng); cầm hai tay khi có vũ khí. Hướng thân = `facing` do simulation quay về `attackYaw` |
| Player đẩy (`pushCooldown`) | `shove` | Hai tay đẩy |
| Player làm việc (`runtime.action.elapsed`) | `work` | Cúi, gõ |
| Player bị đánh (`hurtTimer`) | `hurt` (không có hướng) | Ngả ra sau |
| Player chết (`alive`) | `dead`, `fall` | Khuỵu → đổ; hướng ngã tránh tường |
| Zombie di chuyển (vị trí đo được) | `advanceMeasuredGait` (sải × `zombieMotion.stride`, pha lệch) | Bước theo dáng |
| Zombie đuổi/đánh/phá cửa (`ai`) | `reach` (mượt 0,35 s), mắt đỏ | Tay vươn |
| Zombie lang thang/tìm/di cư | `reach` → 0 | Tay buông |
| Zombie vung (`attackWindup`) | `attack` | Giơ tay → đập ở tiến độ 1 (frame damage), giữ 0,18 s |
| Zombie trúng đòn (`staggerTimer`, `knockback`, `hitFlashTimer`) | `hurt`, `hurtDir`, nhấp nháy | Ngả theo hướng đẩy |
| Zombie chết (`DEAD`, `deadTimer`) | `dead`, `fall` (`death.ts`) | 5 kiểu ngã; xác ngã xong thôi pose |

Chuyển trạng thái đều liên tục: tốc độ lọc 0,12 s, tay 0,35 s, chậu 0,12 s; bị đánh và chết có ưu tiên (cộng/đè lên tư thế). Không có máy trạng thái thứ hai cạnh AI/combat.

## 4. Socket vũ khí

- `weaponSocket`: con của `elbowR`, ở tâm nắm tay (−0,285 m, +0,01 z), nghiêng +45° quanh X.
- Mô hình vũ khí kéo dài theo **+Z từ điểm cầm**, đặt lệch theo `WEAPON_GRIPS` (`weaponModels.ts`).
- GLB sau này chỉ cần theo cùng quy ước.
- Cầm hai tay: preset tay trái trong nhánh vung (`pose.ts`), không IK.

## 5. Visibility

- Zombie hiện theo `runtime.vision.opacity` và `cutaway.hidesPoint`. Ẩn thì không vẽ, không bóng, không pose. Mờ dần thì material chuyển transparent (vẫn ghi depth).
- Toàn bộ thân, tóc, quần áo là một mesh, nên không thể có tóc hay áo "nổi" khi thân bị ẩn. Zombie không cầm vũ khí.
- Xác theo cùng luật.
- Depth test luôn bật. Nhân vật không vẽ xuyên tường.
- Mức chất lượng Thấp/Vừa/Cao: nhân vật giống nhau ở mọi mức, chỉ bóng theo cài đặt bóng. Không đổi collider, timing, tầm, AI hay tầm nhìn. Thấp vẫn đủ hình dáng, vũ khí và animation.

## 6. Công cụ

- Lab dev `/?lab=characters` (`src/lab/CharacterLab.tsx`), chỉ trong dev: cùng camera, zoom, ánh sáng ban ngày; tư thế cố định, lưới 1 m.
  - `set`: `lineup`, `states`, `turn` (8 hướng), `close`, `outfits`, `combat`, `zombies`;
  - thêm `zoom`, `yaw`, `t`.
- `scripts/c0-character-lab.mjs`: 14 ảnh cố định, `--compare=<thư mục>` so pixel, `--docs=<thư mục>` JPEG, `--only=set-zZOOM`.
- `scripts/c0-character-bench.mjs`: đám đông `--densities=0,10,30,60` (zombie đuổi player bất tử ở ngã tư neighborhood-50). Đo frame, CPU, `animatorMs`, draw call, tam giác, mesh/material nhân vật, vòng đời 8 × 20 zombie.
- A/B: dựng commit cũ trong `git worktree` (junction `node_modules`), chạy dev server thứ hai, đo xen kẽ A B B A.
- Kiểm tra trong game (dev, `GPU=1`):
  - `c3-locomotion-browser`: bị chặn, pause;
  - `c4-combat-browser`: ngã tránh tường, xác tĩnh, pause giữa lúc ngã;
  - cùng `p2-s3`, `p2-s4`, `p2-s5-gait`, `p2-vision`, `m11c1a`, `m11c1b`, `m11b`.

## 7. Thêm biến thể mà không sửa gameplay

**Bộ trang phục mới:**
1. Thêm ID vào `OUTFIT_STYLES` và nhãn `APPEARANCE_LABELS.outfit` (`appearance.ts`).
2. Viết builder trong `body.ts`, trả về vòng thân (`Ring[]`) để lớp `wear` đặt vết bẩn. Dùng `torso`/`torsoRings` (rộng thêm, gấu, eo), `strip` (dải bám mặt trước/sau), `pelvis` (`tucked`), `belt`, `legs`, `arms` (`short`/`long`/`rolled`, `cuff`), `shoes` (`low`/`boots`). Thêm vào `OUTFIT_BUILDERS`.
3. Màu cố định trong `OUTFIT_COLORS` (`rig.ts`).
4. `body.test.ts` tự kiểm: trong capsule, chân trên sàn, khác số tam giác. Xem trong lab (`set=outfits`).
5. Không cần tăng phiên bản save: `outfit` lạ bị từ chối khi nạp, nên chỉ thêm, không đổi tên ID đã phát hành.

**Kiểu tóc mới:** thêm vào `HAIR_STYLES` và nhãn; viết nhánh trong `hair()`; kiểm lab `close`. Save cũ không bị ảnh hưởng.

**Dáng zombie mới:** thêm ID vào `ZOMBIE_POSTURES` và tham số vào `POSTURES`. Không chạm config zombie hay AI. `zombieVariants.test.ts` sẽ yêu cầu dáng mới có độ ngả thân riêng và tay buông/vươn đúng khoảng. Lưu ý: thêm dáng làm đổi dáng của zombie hiện có (chia modulo); nếu cần giữ nguyên, thêm dáng qua một bit băm khác.

**Tư thế/animation mới:** thêm trường tùy chọn vào `PoseInput` (mặc định giữ tư thế cũ), tính trong `computePose` từ một giá trị gameplay đã có. Không tạo cơ chế gameplay mới để có clip. Nếu hành vi chưa tồn tại, ghi là hoãn.

## 8. Nguồn và giấy phép

Mọi hình khối, màu và animation do code của repo sinh ra. Không dùng model, texture, animation hay asset pack của bên thứ ba (không có gì trích từ PZ), nên không cần ghi công.
