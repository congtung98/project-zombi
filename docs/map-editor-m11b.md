# Map editor M11b: nhiều tầng — dữ liệu và mô phỏng

Ngày 26/09/2026. Sprint thứ hai của M11, sau M11a (nhà và phòng chữ L/T/U).

- **Save lên v9**: `y` của mọi vị trí là độ cao chân, tức sàn đang đứng. Save v1–v8 được chuyển tự động, mọi thứ về mặt đất.
- Schema map v1 thêm các trường tùy chọn: `building.storeys`, `level` trên object và phòng, object mới `stairs`. File cũ không đổi byte nào; `neighborhood-50` không đổi.
- World thử mới `floors-lab` (ẩn khỏi menu, mở bằng `?world=floors-lab`): một nhà hai tầng.

**M11 chia ba sprint:**
- M11a: nhà và phòng đa giác vuông góc (đã xong).
- **M11b (sprint này): nhiều tầng, phần dữ liệu và mô phỏng.**
- M11c: nhiều tầng, phần hiển thị và editor. Cắt lớp tầng trên, ánh sáng hiển thị theo tầng, editor sửa từng tầng, nhà hai tầng mẫu trong editor.

## 1. Nội dung

- `building.storeys` (1–4, mặc định 1). `building.height` là chiều cao **một tầng** (sàn tới sàn). Tầng k có sàn ở độ cao k·height. Mái nằm trên tầng cao nhất.
- `level` (0 = tầng trệt, mặc định) trên `wall`, `prop`, `container`, `door`, `window`, `wallRun`, `stairs` và phòng.
  - Resolver nâng mọi thứ lên `level · height`: tường, khung cửa, kính, tủ, phòng (`floorY`), đèn, công tắc.
  - Tường chạy chỉ khoét cửa/cửa sổ **cùng tầng**.
  - Cây và object đặt thẳng trong chunk không có tầng.
- `stairs`: `position` (tâm), `quarterTurns`, `width` (1–4 m), `length` (2–12 m), `level` (tầng dưới). Ở hướng 0°, cầu thang leo theo +X và đi lên đúng một tầng. Resolver tự dựng quanh cầu thang:
  - hai tường dọc hai bên, cao tới lan can 1 m ở tầng trên (`#side-a`, `#side-b`);
  - một tường dưới đầu trên, cao bằng cửa (`#back`), để gầm cầu thang bị bịt;
  - lan can ngang đầu dưới ở tầng trên (`#rail`).

  Như vậy chỉ vào được từ đầu dưới (ở tầng dưới) và ra ở đầu trên (ra sàn tầng trên). Các mảnh này có ID phái sinh như tường chạy, không có trạng thái lưu.
- **Sàn tầng trên**: mỗi tầng trên có một tấm sàn (dày 0,2 m) phủ footprint/outline, khoét chỗ các cầu thang đi lên tới tầng đó (`MapData.floors`, ID `<nhà>#floor-<tầng>-<i>`).
- Validator:
  - lỗi `storey-height`: nhà nhiều tầng cần mỗi tầng cao ít nhất 2,6 m;
  - lỗi `stairs-need-storeys`: cầu thang cần nhà ít nhất 2 tầng;
  - lỗi `stairs-too-steep`: dốc hơn 45°;
  - lỗi `out-of-range`: `level` ngoài số tầng, hoặc cầu thang leo quá tầng trên cùng;
  - lỗi `level-not-allowed`: cây, hoặc object đặt trong chunk, có `level`;
  - cảnh báo `stairs-outside-footprint`: cầu thang, cộng 0,9 m chỗ bước lên/xuống ở mỗi đầu, không nằm gọn trong nhà.
- Deep check: tầm với và đường tới đồ vật đi qua cầu thang; cảnh báo mới `stairs-unusable` khi chỗ bước lên/xuống bị chặn.

## 2. Luật độ cao (`src/game/world/floors.ts`, thuần)

- `FloorField.surfaceAt(x, z, y)`: trong các mặt đứng được (mặt đất 0, tấm sàn, mặt dốc cầu thang), lấy mặt **cao nhất** mà không cao hơn chân quá `STEP_UP` = 1 m.
  - Vì vậy: đi lên dốc được, đứng trên sàn được, bước từ đầu cầu thang ra sàn được; nhưng không bao giờ "trèo" lên tấm sàn từ tầng dưới (cách nhau cả một tầng).
  - 1 m đủ cho một frame dài (0,1 s) khi chạy trên cầu thang dốc nhất cho phép.
- World không có tầng trên trả 0 ngay, không tốn gì.
- `LEVEL_TOLERANCE` = 1,2 m: hai điểm lệch nhau quá chừng này theo chiều cao là ở hai tầng khác nhau.

## 3. Mô phỏng

- **Người chơi**: capsule Rapier không còn trọng lực. Mỗi tick, mô phỏng đặt `player.position.y` (độ cao chân) từ `surfaceAt` rồi đặt thân lơ lửng trên sàn 2 cm. Rapier chỉ còn lo trượt dọc tường.
- **Zombie**: `position.y` là độ cao chân.
  - `moveZombie` lấy độ cao mới sau mỗi bước con.
  - Chỉ những hộp chồng lên dải cao của thân mới chặn zombie, nên tường tầng khác không chặn.
  - Tấm sàn không bao giờ chặn di chuyển.
  - Zombie ở hai tầng không đẩy nhau, không đẩy người chơi, không tách nhau.
  - Thân kinematic đi theo độ cao.
- **Điều hướng nhiều lớp** (`navLayers.ts`, `NavWorld`):
  - Mỗi tầng một `NavGrid`: lớp 0 là mặt đất toàn map; mỗi tầng trên của một nhà là một lớp trên khung nhà đó.
  - Mỗi lớp chỉ lấy tường/cửa/cửa sổ của tầng mình. Ngưỡng "trên đầu" tính từ sàn lớp, và ô không có sàn (ngoài nhà, lỗ cầu thang) bị chặn.
  - Cầu thang nối một điểm ngay sau đầu dưới (lớp dưới) với một điểm ngay sau đầu trên (lớp trên).
  - Đường đi cùng một lớp là A\* của lớp đó. Đường qua nhiều lớp được lập kế hoạch qua các cầu thang (Dijkstra, như `findDoorRoute` qua cửa); mỗi đoạn trong một lớp dùng A\* của lớp đó, còn cầu thang thì đi thẳng.
  - `findDoorRoute` tính cả cửa ở tầng trên. `componentAt` nối vùng qua cầu thang. `hasLineOfWalk` sai khi hai điểm khác lớp.
  - World một tầng: `NavWorld` gọi thẳng lưới mặt đất (`runtime.nav` vẫn là lưới đó), kết quả không đổi.
- **AI**:
  - Chỉ tấn công khi người chơi cùng tầng. "Tới nơi" (điểm tìm kiếm, điểm lang thang, waypoint, chỗ đứng phá cửa) phải cùng tầng.
  - Cửa ở tầng khác không bao giờ được coi là "gần".
  - Zombie ở tầng trên đi lang thang trong tầng đó.
- **Tầm nhìn và đòn đánh**:
  - Mắt zombie (1,5 m), tầm đánh gậy (1,2 m), mắt người chơi và điểm nhắm vào zombie đều tính từ chân.
  - Tấm sàn là collider `floor` (chặn tầm nhìn/đòn đánh, không chặn đi lại) và là vật che tầm nhìn của người chơi.
  - Nên zombie ngay dưới người chơi không thấy, không đánh được; nhìn qua lỗ cầu thang thì vẫn thấy.
- **Tương tác**:
  - Với tới từ độ cao thân (chân + 0,9 m) và chỉ với đồ cùng tầng (±1,4 m).
  - Đồ vật có độ cao theo tầng: cửa, công tắc, rèm, túi đồ rơi (nằm ở sàn đang đứng).
- **Ánh sáng**:
  - Phòng thuộc tầng của nó (`onRoomStorey`). `getRoomAtPosition` theo độ cao.
  - Cửa sổ/cửa gắn với phòng cùng tầng.
  - Lỗ cầu thang là một khe luôn mở giữa phòng ở chân và phòng ở đầu cầu thang.
- **Save v9**:
  - Người chơi, zombie, ký ức vị trí và túi đồ rơi giữ độ cao, nên nạp lại vẫn ở tầng trên.
  - Bước v8 → v9 đưa mọi độ cao về 0: trước v9 chỉ có một tầng, và save lưu tâm thân người chơi (0,9).
  - Đẩy vật ra khỏi khối rắn (migration nội dung) chỉ xét khối cùng tầng.

## 4. Hiển thị tối thiểu (phần còn lại là M11c)

- Tấm sàn vẽ thành hộp, làm mờ khi che người chơi ở tầng dưới (bộ làm mờ sẵn có).
- Bậc thang vẽ thành các bậc 0,2 m. Mái nằm trên tầng cao nhất.
- Camera theo độ cao người chơi. Con trỏ chiếu xuống sàn đang đứng.
- Zombie, túi đồ và thân vật lý vẽ ở đúng độ cao.
- Shader ánh sáng trong nhà có thêm cận dưới theo sàn phòng (`uRoomFloor`), nên phòng tầng trên không tô lên tầng trệt.
- Editor: đọc/ghi mọi trường mới; Inspector có ô cho cầu thang (vị trí, xoay, rộng, dài, từ tầng). Chưa có chọn tầng: các tầng vẽ chồng lên nhau trong editor.

## 5. Kiểm chứng

**Sửa sau khi người dùng thử bằng mắt** (cửa và công tắc đèn tầng 2 hiện ở tầng 1):
- `doorLeafTransform` đặt cánh cửa ở `height/2` tuyệt đối. Không chỉ sai hình: collider và vật che tầm nhìn của cửa tầng trên cũng nằm ở tầng trệt, nên chặn zombie ngay bên dưới, còn ở tầng trên cửa đóng không chặn gì. Giờ cánh cửa đứng trên sàn của cửa (`hinge.y`); `DoorView` đặt thân ở `hinge.y`.
- Công tắc đèn vẽ ở 1,3 m cố định. Giờ `LampPlacement.floorY` + `SWITCH_HEIGHT` (dùng chung cho vẽ và với tới).
- Bảng F6 sập ở world có cầu thang: cạnh ánh sáng của lỗ cầu thang không phải là cửa. Giờ cạnh đó vẽ ở tâm cầu thang; nhãn phòng, cửa, cửa sổ và đường nối vẽ ở độ cao tầng của chúng.
- Test mới trong `floors.test.ts`: collider và vật che của cửa tầng trên ở 3–5,2 m, không còn gì ở tầng trệt bên dưới; công tắc tầng trên ở 4,3 m. Test hỏng khi bỏ bản sửa và pass khi có.
- Kịch bản trình duyệt thêm hai bước: đo độ cao trong scene (tâm cánh cửa 1,1 / 4,1 m, công tắc 1,3 / 4,3 m) và bật F6 (có nhãn "Cầu thang", không lỗi).

- **Unit** `src/game/world/floors.test.ts` (18), trên bản đông cứng của `floors-lab` (`src/test/fixtures/maps/floors-lab`):
  - resolver: độ cao theo tầng, tấm sàn chừa lỗ cầu thang, tường quanh cầu thang; cầu thang xoay theo nhà ở 4 hướng;
  - validator: mọi mã lỗi mới; deep check sạch;
  - `surfaceAt`, `subtractRect`;
  - `NavWorld`: world một tầng không đổi; đường qua cầu thang; phá cửa trước, cửa tầng trên; từ giữa cầu thang;
  - mô phỏng: người chơi leo lên và xuống (kể cả frame 0,1 s); đi dưới sàn tầng trên vẫn ở mặt đất; chỉ với tới đồ cùng tầng, túi rơi ở tầng trên; zombie ngay bên dưới không thấy/không đánh, người chơi không thấy zombie dưới sàn; zombie nhớ vị trí đuổi lên cầu thang và tấn công; ánh sáng theo tầng; save v9 giữ tầng, save v8 về mặt đất; dữ liệu vẽ (sàn, 15 bậc, mái ở 6 m).
- Test cũ cập nhật theo quy ước mới:
  - vị trí trong test tầm nhìn là độ cao chân;
  - fixture save được so với bản "về mặt đất";
  - phiên bản save 9;
  - uniform `uRoomFloor`.
- `npm test`: **537 pass** (+13 skip).
  - Test làm nóng nav của M10 (`streaming.test.ts`, đo theo thời gian thật) hỏng 2 trong khoảng 6 lần chạy toàn bộ lúc máy bận; 3 lần chạy toàn bộ sau đó và 8 lần chạy riêng đều pass. Test này dùng world một tầng nên đi qua đúng lưới cũ.
  - `tsc -b`, `oxlint`, `build`, `build:editor`, `check:bundle` (2 world tải theo nhu cầu), `map:check -- --deep` sạch.
- **Trình duyệt** `scripts/m11b-floors-browser.mjs` (dev) PASS:
  - bấm phím thật (S+D) leo cầu thang: giữa chừng y ≈ 1,8, lên tới y = 3, thân Rapier ở 3,92;
  - E ở tầng trên mở tủ quần áo, không phải tủ bếp ngay bên dưới;
  - zombie nhớ vị trí đi vào nhà, leo cầu thang, lên tầng trên trong ~5 s;
  - Lưu và về menu → Continue: người chơi và thân vẫn ở tầng trên;
  - W+A đi xuống, về y = 0.
- **Hồi quy** PASS (mỗi script một server Vite mới):
  - editor m3–m9, m11a;
  - `worlds`, `m10-streaming`;
  - game p2-s2, p2-s3, p2-s4, p2-s5, p2-lighting, p2-vision.
  - Các script lưu game đổi số phiên bản save 8 → 9 (m8 đổi cả tên bản sao lưu `backup-v9-…`).

## 6. Còn lại

- **M11c**:
  - cắt lớp tầng trên khi ở trong nhà (hiện chỉ làm mờ tấm sàn/tường che người chơi);
  - ánh sáng hiển thị và debug F6 theo tầng;
  - editor: chọn tầng để sửa, ẩn/mờ tầng khác, đặt cầu thang bằng chuột, nhà hai tầng mẫu.
- Túi đồ rơi ra từ một tủ tầng trên bị xóa bằng migration nội dung sẽ rơi xuống mặt đất ngay bên dưới, vì migration chỉ lưu vị trí X/Z của tủ.
- Generator chưa sinh nhà nhiều tầng.
- Chỉ có cầu thang thẳng một đợt; cầu thang chữ L/U hay chiếu nghỉ phải ghép bằng nhiều cầu thang.
- Không có rơi/thiệt hại khi rơi: ô không có sàn đã bị tường/lan can chặn, và nav không bao giờ đi qua đó.
