# AX4 — Picker, định tuyến input, click trái, provider object

> Nhánh `feature/character-action`, ngày 2026-09-30. Kiến trúc: `docs/character-action-ax0.md` §2.5, §4, §5, §8.1–8.2. D1: mở tủ 0,35 s; cửa, đèn, rèm tức thời.

## 1. Người chơi thấy gì

- **Rê chuột lên cửa, tủ, công tắc đèn hoặc rèm** (trên tầng đang đứng, trong phần đang nhìn thấy): con trỏ thành bàn tay và vòng sáng nhảy sang object đó. Không có object dưới chuột thì vòng sáng vẫn chỉ đích của phím E như trước.
- **Click trái lên object (ngoài thế chiến đấu):** làm action mặc định, giống E.
  - Cửa mở/đóng ngay.
  - Tủ: nhân vật với tay (pose `reach`) 0,35 s rồi cửa sổ Lục đồ mở. Tủ đang mở thì click hoặc E sẽ đóng.
  - Đèn bật/tắt, rèm kéo/mở.
- **Quá xa:** không có gì xảy ra, toast "…: quá xa, lại gần hơn". Tự đi tới là việc của AX6.
- **Đang ở thế chiến đấu** (hoặc nhấn chuột phải cùng lúc, chord CS1): chuột trái vẫn là đánh, kể cả khi con trỏ đang trên tủ.
- **Click trái lên đất trống ngoài thế:** vẫn là nhắc "cần chuột phải" như CS1.
- **Bấm liên tục** khi tủ đang mở ra: chỉ xếp một lần (không có mở–đóng–mở ngoài ý muốn).
- **Gợi ý E trên HUD không đổi chữ:** "Mở Cửa (độ bền 90/120)", "Cửa đã vỡ", "Bật Đèn (mất điện)", "Kéo rèm …", "Mở / Xem / Đóng Tủ".

## 2. Kiến trúc

```text
CursorProbe (view, mỗi frame) — tia camera + shown(p): không bị cutaway ẩn, phòng đã từng thấy (không đụng ánh sáng)
   ▼ runtime.updatePointerTarget(ray, shown)
WorldPicker (interaction/picker.ts, thuần) — tia × hộp pick của object và zombie cùng tầng; gần nhất thắng;
   trong 0,25 m dọc tia: object > character; không trúng gì → đất
   ▼ runtime.pointerTarget / hoverInteractable
Router (runtime.stepControls, trước cập nhật thế): UI đã lọc; combat (thế / đang vung / chuột phải lúc này) → combat;
   chuột trái trên object → InteractionSystem.executeDefault(obj, 'left-click'), chuột trái không thành đòn hay nhắc
   ▼
InteractionSystem (interaction/interactionSystem.ts) — provider.getActions → option (mặc định trước) → request
   · immediate → ActionSystem.perform (cùng kiểm tra, cùng commit một transaction, ngay trong tick)
   · queue → ActionSystem.enqueue; cùng object + cùng action đang chờ → không xếp lần hai
   ▼
defs/world.ts: OPEN_DOOR / CLOSE_DOOR / TOGGLE_LIGHT / TOGGLE_CURTAIN / CLOSE_CONTAINER (immediate), OPEN_CONTAINER (0,35 s)
   kiểm tra lại: object còn (TARGET_GONE) → trong tầm (OUT_OF_RANGE) → trạng thái vẫn cho phép (TARGET_CHANGED)
   ▼ effect `world.set { objectType, objectId, patch }`
World adapters của runtime: door → setDoorState, light → setLamp, window → setCurtain, container → openLoot / closeContainer
   (collider, nav, lighting, event, save vẫn đi đường cũ); registerWorldAdapter cho loại mới
```

- **Provider** (`interaction/providers.ts`, đăng ký qua `interaction/registry.ts`): `door`, `container`, `light`, `window`.
  - Mỗi provider dựng object từ map, với bán kính tầm với như cũ và **hộp pick**: cửa phủ ô cửa, tủ phủ khối tủ, công tắc là khối nhỏ, rèm phủ khung cửa sổ.
  - `getActions` tính từ trạng thái gameplay.
  - `getInteractionContext` trả ghi chú hoặc trạng thái cho gợi ý.
- **Runtime không còn** `buildInteractables` riêng hay chuỗi `if (kind)` trong `describeInteraction` / `interact`. `interact(target)` = E = `executeDefault`.
- **`Interactable.kind`** là type của provider (chuỗi mở). Thêm `pick`.
- **Trạng thái "đang mở" của tủ:**
  - là tủ đang hiện trong Lục đồ (`openContainerId`), chỉ lúc chạy, không lưu;
  - `opened` (đã từng lục) vẫn lưu như cũ.
- **FB Case 7:** test đăng ký một loại **máy phát điện** hoàn toàn từ bên ngoài runtime: provider + action `GENERATOR_SWITCH` + adapter trạng thái. Gợi ý, option (kể cả "Đổ xăng" bị khóa kèm lý do) và việc bật máy chạy qua đúng đường này, không sửa runtime, input hay state machine.

## 3. Thay đổi hành vi (và test cũ đổi theo)

- **Mở tủ bằng E hoặc click có thời gian (D1).**
  - Test nào chỉ cần tủ mở sẵn để dựng tình huống thì dùng `rt.openLoot(id, true)` (đúng hành vi cũ của `interact`).
  - Test nào kiểm tra chính phím E thì chạy thêm 0,5 s.
  - Test đã đổi: `runtime`, `combatStance`, `combatSwing`, `floors`, `actionCore`, `inventoryMatrix`, `itemUse`, `worldReset`, `actionQueue`, `inventoryCommands`, `recovery`, `phase2-save`, `timedAction`, `inventoryV10`, `floor`, `save`, `persistence`.
- **`interact()` giờ kiểm tra tầm với lúc thực hiện** (WIS §8: không commit ngoài tầm).
  - Vài test cũ gọi nó từ xa: đổi sang `setDoorState` / `openLoot` khi đó chỉ là dựng tình huống.
  - Test công tắc đèn: nhân vật đứng tại công tắc.
- **Soak:** bot đứng chờ tủ mở.

  | Soak | Mốc mới |
  |---|---|
  | shelter | 1800 s / 2 kill / 20 dmg (trước AX4: 7 kill / 30 dmg) |
  | patrol | 804,9 s / 28 kill (trước AX4: 812,2 s / 31 kill) |

  Tổng thời gian đứng chờ khác đi nên dòng thời gian lệch. Kiểm tra toàn vẹn vẫn đủ 1800 / 804 lần.
- **Browser script:** `il-s2`, `il-s6` đợi tủ mở xong (`openContainerId`) trước khi đọc nội dung.

## 4. Test

- **`interaction/picker.test.ts` (5 test):**
  - tia × hộp;
  - sàn ngay dưới tủ chọn tủ, không chọn đất;
  - tủ bị tủ áo che thì không chọn được;
  - luật ±0,25 m (object > character), zombie ở hẳn phía trước thì thắng;
  - điểm đất đúng tầng.
- **`core/worldInteraction.test.ts` (7 test):**
  - con trỏ chọn đúng object, đất khi không trúng gì, không chọn phần không nhìn thấy;
  - Case 1: click tủ → `OPEN_CONTAINER` (LOOTING, pose reach) → mở sau 0,35 s, không vung, không nhắc;
  - click cửa mở rồi đóng, version tăng;
  - quá xa → `OUT_OF_RANGE`, không đổi gì;
  - trong thế chuột trái là đánh; ngoài thế click đất vẫn nhắc;
  - bấm lặp khi đang mở chỉ xếp một lần, E trên tủ đang mở thì đóng;
  - Case 7 máy phát.
- **`scripts/ax4-browser.mjs`** (Chrome GPU, chuột thật):
  - rê tìm tủ: con trỏ bàn tay, vòng sáng;
  - click mở tủ có thời gian;
  - cửa mở rồi đóng bằng hai click;
  - cửa cách 5 m: "quá xa", không đổi;
  - trong thế: vung, không mở;
  - 0 lỗi trang.
- **Ảnh:** `ax4-hover-container`, `ax4-left-click-open`, `ax4-door-toggled`, `ax4-too-far`.
- **Kiểm chứng:**
  - `npm test` 1103 pass, 13 skip;
  - tsc, oxlint, build, build:editor, check:bundle, map:check sạch;
  - `cs1-combat`, `il-s2/s3/s4/s5`, `ax3`, `ax4` PASS.

## 5. Giới hạn, việc tiếp theo

- **Picker không dùng tường làm vật chắn.** Thứ ẩn tủ phía sau tường là cutaway / mái và bộ nhớ phòng đã thấy. Tủ nhìn thấy được ở phòng bên chọn được bằng chuột, nhưng không làm được nếu tường chắn (tầm với / LOS kiểm tra lúc chạy).
- **Đóng cửa không kiểm tra có người hoặc zombie đứng trong ô cửa** (như trước AX4).
- **Mở/đóng cửa, đèn, rèm chưa có pose với tay:** chạy tức thời nên không có bước để trình diễn.
- **Tiếp theo — AX5:**
  - menu chuột phải trên object (theo §4);
  - chuột phải trên zombie → thế chiến đấu với đích;
  - làn combat trong registry (COMBAT_STANCE / MELEE_ATTACK / SHOVE);
  - "Lấy hết" trong menu tủ;
  - sau AX5 dừng chờ duyệt (D6).
