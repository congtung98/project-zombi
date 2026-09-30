# AX3 — Animation layer

> Nhánh `feature/character-action`, ngày 2026-09-30. Kiến trúc: `docs/character-action-ax0.md` §2.7, §7 (FB §7: Action ≠ Animation; giữ pose đơn giản; đổi sang AnimationMixer sau mà không viết lại Action System).

## 1. Người chơi thấy gì

- **Uống:** chai (hoặc lon) đưa lên miệng trong 0,5 s, ngửa đầu, hạ xuống ở 15 % cuối. Cầm tay phải.
- **Ăn:** tay trái giữ đồ ở ngực, tay phải đưa từng miếng lên miệng khoảng 0,9 lần/giây. Món: gói snack hoặc hộp đã mở.
- **Băng bó / sơ cứu:** cẳng tay trái đưa ngang trước ngực, tay phải quấn quanh, mắt nhìn vết thương. Cuộn băng / hộp cứu thương ở tay trái.
- **Mở hộp:** pose làm việc, hộp ở tay trái.
- **Chế tạo / sửa / chuyển đồ:** pose làm việc chung, không cầm gì (như trước).
- **Chuyển tiếp mượt:** pose hòa vào và ra trong 0,15 s. Vũ khí được cất đi khi tay bận và hiện lại ngay khi xong hoặc bị hủy, không bao giờ bị tháo trang bị.
- **Ảnh chụp trong game thật** (`docs/character-action/`): `ax3-drink`, `ax3-open-tin`, `ax3-eat-tin`, `ax3-bandage`, `ax3-after`. Ảnh Character Lab: `ax3-lab-actions` và `ax3-lab-actions-side` (12 pose: 2 thời điểm mỗi nhóm, soda, món không có mô hình, idle).

## 2. Kiến trúc

```text
ActionJob (Action System) ──► presentationOf(job)  — actions/presentation.ts, dữ liệu thuần
   { group: 'drink', elapsed, progress, prop: { itemId: 'water', hand: 'right' }, hideWeapon }
        │  runtime.actionPresentation (null khi không có gì đang chạy hoặc đã chết)
        ▼
PlayerView (mỗi frame) ─► CharacterAnimState — rendering/character/animState.ts
   locomotion, combat (swing/shove/ready/aim), hurt, dead, action { group, t, progress, weight }, props
        ▼
AnimationDriver.update(anim)
   ProceduralPoseDriver hôm nay: computePose → applyPose + PropAttachment + ẩn/hiện vũ khí
   (MixerDriver sau này: cùng interface, Action System không đổi)
```

- **Action chỉ nói tên nhóm pose và món cầm** (`presentation.anim`, `presentation.prop`, `propItem(job)`). Action không biết pose hay clip nào.
- **Thời gian lấy từ bước của job** (đồng hồ mô phỏng). Pose không có sự kiện "finished"; thiếu pose hay prop không làm action hoàn tất sai giờ (CAS §7).
- **Pose (`pose.ts`):**
  - kênh `action?: ActionPose` thay kênh `work` cũ; nhóm `work` / `reach` / `eat` / `drink` / `medical` với `weight` hòa trộn;
  - thứ tự lớp: death > hurt (cộng thêm) > swing/shove > action > ready > locomotion/idle;
  - thế ready nhường chỗ cho action theo `weight`.
- **Socket:** `weaponSocket` (tay phải) + **`leftSocket`** mới trên `elbowL`, cùng quy ước tay cầm.
- **Món cầm (`itemProps.ts`):**
  - hình theo món: bottle, can, tin, snack, roll, kit;
  - món chưa có hình dùng khối nhỏ theo màu loại;
  - geometry và material dùng chung, nên gắn/gỡ mỗi action không cấp phát gì ngoài Group.
- **Character Lab:** bộ mới `/?lab=characters&set=actions` để so ảnh pose trước/sau.
- **Đã bỏ:** getter `runtime.workElapsed` (thay bằng `actionPresentation`).

## 3. Test

- **`character.test.ts`:**
  - pose `work` (chuyển từ kênh cũ);
  - nhóm eat / drink / medical / reach có hình dạng đúng (miếng ăn lên miệng rồi xuống, ngửa đầu khi uống, hạ chai ở cuối, cúi nhìn khi băng bó);
  - `weight` 0 = không đổi gì; một nửa = nửa đường;
  - death và hurt vẫn đè lên action;
  - thế ready nhường chỗ.
- **`animState.test.ts`:**
  - mọi món ăn / uống / dùng / mở có hình riêng, món khác dùng khối dự phòng;
  - prop vào đúng tay và rời đi, 100 lần đổi không để lại gì;
  - driver ẩn vũ khí khi tay bận và trả lại sau, không tháo trang bị.
- **`itemUse.test.ts`:** `actionPresentation` khi uống (drink, chai tay phải, cất vũ khí, tiến trình) và khi băng bó (medical, tay trái); null khi rảnh hoặc bị đánh.
- **`actionCore.test.ts`:** chuyển đồ hiện pose `work`, không cầm gì.
- **`scripts/ax3-browser.mjs`** (Chrome GPU, game thật, chuột thật qua menu):
  - uống: prop, cất gậy, khát chỉ tăng khi xong;
  - "Mở rồi ăn": mở ở tay trái rồi ăn hộp đã mở ở tay phải, đói 20 → 54;
  - băng bó rồi bước một bước: hủy, máu và số băng giữ nguyên;
  - gậy vẫn được trang bị;
  - 0 lỗi trang.
- **Kiểm chứng:**
  - `npm test` 1091 pass, 13 skip;
  - tsc, oxlint, build, build:editor, check:bundle, map:check sạch;
  - `cs1-combat`, `il-s2`, `il-s3`, `il-s4`, `il-s5`, `ax3` PASS.

## 4. Giới hạn

- **Pose dựng bằng code:** tay cầm chỉ gần đúng (chai nghiêng theo cẳng tay, không bám chính xác miệng). Đổi sang clip thật là việc của một `MixerDriver`.
- **Không có âm thanh bắt đầu riêng** cho ăn/uống/băng bó. Âm hoàn tất (`eat`/`drink`/`heal`) và âm hủy (`workCancel`) giữ như cũ; Settings vẫn một thanh âm lượng chung (AX0 §10).
- **Zombie không dùng lớp action** (không cần trong phase này).
- **Tiếp theo — AX4:** picker theo con trỏ, định tuyến input theo ưu tiên, click trái làm action mặc định, provider cửa/tủ/đèn/rèm.
