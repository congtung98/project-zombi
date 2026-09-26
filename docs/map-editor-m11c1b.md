# M11c-1B: tầm nhìn nội thất (mask, nhìn qua cửa/cửa sổ, ghi nhớ vùng đã khám phá)

Ngày 26/09/2026. Sprint thứ hai của M11c, sau M11c-1A (cắt lớp, đã commit f24212e). Triển khai phần tầm nhìn nội thất của `docs/Building_Cutaway_Visibility_Fix_Plan.md` (mục 7.2–7.5, 8, 12) theo hướng (a) người dùng chọn: làm tối rõ phần nội thất nhân vật không thấy, kiểu Project Zomboid, chỉ trong nhà, không bao giờ ngoài trời.

**Nghiệm thu bắt buộc** (người dùng đặt): nhìn qua cửa sổ thấy một phần phòng, phòng kín kế bên không bị lộ. Đạt: xem mục 6.

Save vẫn là v9, thêm trường tùy chọn `exploration` (mục 4). Schema map và nội dung không đổi.

## 1. Hành vi

- **Trong nhà:** chỉ phần phòng nhân vật đang thấy mới sáng như thường. Một ô đang thấy khi:
  - trong tầm nhìn 20 m;
  - trong nón nhìn 110°, hoặc trong bán kính gần 2,5 m;
  - có đường nhìn: tường, cửa đóng và rèm kéo chặn; kính và cửa mở cho qua.

  Cùng luật với tầm nhìn zombie của người chơi.
- **Ô đã thấy trước đây** (đã khám phá) hiện ở mức "nhớ": tối 45% và xám 60%.
- **Ô chưa bao giờ thấy** gần như đen (7%), kể cả mặt tường trong, đồ đạc, đèn và dấu thùng đồ (phần phát sáng cũng bị nhân).
- **Ngoài trời không bao giờ bị tối:** mask chỉ áp cho fragment nằm trong phòng, dưới trần.
- **Nhìn qua cửa hoặc cửa sổ từ ngoài (peek):**
  - nhà được nhìn vào bị cắt lớp như khi đứng trong nó, ở tầng của nhân vật: ẩn mái và tầng trên, cắt tường phía camera;
  - chỉ phần nhìn thấy qua ô cửa sáng lên, phần còn lại vẫn tối;
  - cần ít nhất 4 ô thấy được trong phạm vi 14 m;
  - nhà vẫn bị cắt thêm 0,8 s sau lần thấy cuối, để không nhấp nháy ở mép cửa sổ;
  - kéo rèm hay đóng cửa thì hết peek, mái hiện lại.
- **Chuyển trạng thái:** ô sáng lên hoặc mờ về mức nhớ trong 0,25 s. Zombie không theo độ trễ này: việc zombie hiện hay ẩn vẫn do hệ thống tầm nhìn người chơi quyết định ngay, và zombie ở chỗ không thấy thì không được vẽ.
- **Tầng khác:** phòng của tầng khác với tầng nhân vật đứng dùng một hằng "đã khám phá" (nhớ nếu đã từng thấy chỗ nào của phòng đó, ngược lại tối).
- **Debug F4:** tô màu thay vì làm tối: xanh lá là đang thấy, xanh dương là nhớ, đỏ là chưa thấy.

## 2. Luồng dữ liệu

```
runtime.tick → vision.update → interior.step (mỗi 0,1 s; bỏ qua nếu vị trí, hướng nhìn và lighting.revision không đổi)
   InteriorVisibility (systems/interiorVisibility.ts, thuần)
     quạt 360 tia qua vision occluders (computeSectorDistances, từ độ cao chân + tầm mắt)
     → ô đang thấy / đã khám phá theo từng phòng (lưới 0,25 m trên bounds, bỏ ô ngoài outline)
     → peeks: nhà được nhìn vào từ ngoài
CutawayController (useFrame): cutaway.update(vị trí, interior.peeks, thời gian) → cắt nhà đang ở và các nhà peek
InteriorMask (useFrame): làm mượt ô đang thấy → texture 256 × 256 (64 m quanh nhân vật, lọc nearest)
   + cờ theo slot phòng của shader → indoorShading: màu sau ánh sáng × mask
Save: interior.serialize() → SaveGame.exploration; loadSnapshot → interior.restore()
```

- **`systems/interiorVisibility.ts`:** `InteriorVisibility` với `grids`, `byRoom`, `revision`, `peeks`, `seenByBuilding`, `step`, `update`, `exploredShare`, `serialize`, `restore`, `clear`; `isSavedExploration`. Đây là trạng thái trình bày, như tầm nhìn người chơi: AI, ánh sáng và mô phỏng không đọc nó.
- **`rendering/cutaway.ts`:** `CutawayState` giữ nhà đang đứng trong (`view`/`building`) và các nhà peek. Thêm `peekIds`, `cutIds`; `update(p, seenInto, now)`; `attach(..., buildingById, peekHold)`. `limit`, `hidesPoint` và `storeyShown` xét mọi nhà đang bị cắt.
- **`rendering/indoorShading.ts`:** uniform `uRoomMask[slot]`, `uVisMap`, `uVisWindow`, `uVisLevels`; `indoorSlots` (IndoorLighting ghi phòng của từng slot); `PROGRAM_KEY` v4. Mask là một hệ số nhân *sau* màu ánh sáng phòng, không thay ánh sáng.
- **`rendering/InteriorMask.tsx`:** mới, dựng texture và cờ slot mỗi frame khi có thay đổi.
- **Config** `interiorVisibility`: `enabled` (công tắc dev), `cell` 0,25, `updateInterval` 0,1, `rays` 360, `wallTolerance` 0,19, `unexploredLevel` 0,07, `rememberedLevel` 0,45, `rememberedDesaturation` 0,6, `fadeSeconds` 0,25, `maskSize` 64, `peekMinCells` 4, `peekDistance` 14, `peekHold` 0,8.
- **F6:** nhãn cắt lớp thêm dòng "nhìn vào từ ngoài: …".

## 3. Tách biệt khỏi ánh sáng và mô phỏng

- **Ánh sáng không đổi:** cường độ đèn cảnh, ánh sáng phòng (`buildingLighting`) và exposure giữ nguyên. Kiểm chứng: tắt/bật mask thì cường độ đèn, ánh sáng phòng kho và độ sáng cỏ bằng nhau.
- **Ngoài trời:** không bị tối (cỏ 65,9 khi bật và khi tắt mask).
- **Công tắc dev:** `runtime.config.interiorVisibility.enabled = false` tắt mask. Script đo ánh sáng tắt nó cùng lúc với lớp phủ tầm nhìn, vì mask cố ý thay đổi theo hướng nhìn:
  - `p2-lighting-browser.mjs`: tắt cho cả script;
  - `p2-vision-browser.mjs`: tắt trong phần đo ánh sáng và lớp phủ.

## 4. Ghi nhớ trong save

- **Định dạng:** `SaveGame.exploration?: { cell, rooms: [{ id, bits }] }`, mỗi phòng một bitset base64 trên lưới của phòng (hàng theo Z, gốc là góc bounds).
- **Không tăng phiên bản save**, vì đây chỉ là dữ liệu trình bày:
  - save không có trường này nghĩa là chưa khám phá gì;
  - trường sai hình dạng bị bỏ khi tải (`isSavedExploration`), không bao giờ báo save hỏng;
  - phòng không còn, hoặc lưới đổi (khác `cell`, bounds đổi sau khi cập nhật nội dung), bị bỏ qua;
  - khi chưa khám phá gì thì snapshot không ghi trường này, nên save cũ tải rồi lưu lại vẫn giữ nguyên từng byte (các test round-trip vẫn pass).

## 5. Sửa kèm

- **Leo cầu thang ở FPS thấp (lỗi từ M11b):**
  - ở khoảng 3 fps, vật lý có thể đẩy thân nhân vật hơn 1,2 m trong một frame, trong khi độ cao chỉ được đặt một lần theo luật bước lên 1 m;
  - nên một bước dài từ chân cầu thang tới chỗ bậc đã cao hơn 1 m làm nhân vật đi xuyên dưới cầu thang;
  - `FloorField.follow` giờ áp luật bước lên dọc quãng đường (mỗi 0,25 m); bước dài hơn 4 m vẫn là dịch chuyển tức thời (script, tải save);
  - test mới trong `floors.test.ts`.
- **`m11c1a-cutaway-browser.mjs`:**
  - chờ camera bám đứng yên trước khi đo pixel (ở vài fps camera trễ tới 1 m);
  - phép kiểm proxy bóng nhắm đúng các điểm cỏ chỉ nằm trong bóng tầng đã ẩn (bật proxy thì tối, tắt proxy thì sáng).

## 6. Kiểm chứng

- **Unit** `systems/interiorVisibility.test.ts` (7 test):
  - qua cửa sổ thấy một phần phòng khách, phòng kho kín 0 ô, nhà A là peek;
  - rèm kéo hoặc quay lưng thì không thấy gì, đi lại thì còn nhớ;
  - trong nhà: phòng trong nón thấy, phòng sau vách kín không; bán kính gần tính cả phía sau;
  - theo tầng;
  - save, tải, và bỏ qua memory hỏng hoặc cũ;
  - bỏ qua lượt quét không đổi;
  - peek và thời gian giữ trong `CutawayState`.
- **Unit khác:** `floors.test.ts` thêm `follow`; `indoorShading.test.ts` thêm uniform mới và v4.
- **Trình duyệt** `scripts/m11c1b-interior-browser.mjs`, đo pixel trên màn hình:

  | Cảnh | Trong quạt | Ngoài quạt | Phòng kho | Cỏ |
  | --- | --- | --- | --- | --- |
  | Qua cửa sổ, cách 4 m | 83,7 | 5,6 | 3,4 | 65,6 |
  | Sau khi đã vào phòng kho | 78,9 | 7,8 | 25,6 (mức nhớ) | 63,5 |
  | Sau Lưu → menu → Continue | 84,7 | 5,3 | 26,2 | 65,9 |
  | Tắt mask | 84,7 | 84,7 | 51,8 | 65,9 |

  - Zombie trong phòng kho: không vẽ.
  - Kéo rèm: hết peek.
  - Tắt mask: đèn và ánh sáng phòng không đổi.
- **Hiệu năng** (vitest, node):
  - một lượt quét: lab 1,4 ms (12 phòng, 7 680 ô), khu phố 0,6 ms; tối đa 10 lượt/s, đứng yên thì 0;
  - test spawn chạy nhiều tick: 201 ms so với 186 ms trên HEAD;
  - trình duyệt: bật mask 3 fps, tắt mask 2,5 fps trên cùng cảnh lab (swiftshader), tức không làm chậm.

## 6b. Sửa sau khi người dùng thử bằng mắt

- **Công tắc đèn biến mất ở tường bị cắt:** M11c-1A ẩn công tắc khi tường của nó bị cắt thấp hơn công tắc (1,3 m > 0,6 m), nên người chơi không thấy công tắc và không biết đèn bật hay tắt.
  - Giờ công tắc vẫn vẽ: hạ xuống nằm trên đỉnh phần tường còn lại, tại điểm của tường gần công tắc nhất, và giữ màu bật/tắt.
  - Công tắc chỉ bị ẩn khi cả tầng của nó bị ẩn. Bấm E vẫn như trước, vì điểm tương tác không đổi.
  - Trong phòng nhân vật không thấy, công tắc tối theo mask như mọi thứ khác trong phòng.
- **Kiểm chứng:** `m11c1a-cutaway-browser.mjs` kiểm công tắc phòng kho trên tường đông (bị cắt) được vẽ tại x 16,85, y 0,67; công tắc tầng trên vẫn ẩn khi đứng ở tầng trệt.

## 7. Giới hạn còn lại

- **Ô 0,25 m hiện thành bậc** ở mép hình quạt (lọc nearest, cố ý để không loang sang phòng sau vách).
- **Tường mỏng hơn khoảng 0,19 m** có thể lộ một dải ô sau nó.
- **Chỉ 16 slot phòng gần nhất có mask** (giới hạn shader có từ trước). Phòng xa hơn nằm dưới mái của chúng; peek chỉ xét trong phạm vi 14 m.
- **Peek chỉ xét tầng của nhân vật:** không nhìn được vào cửa sổ tầng 2 từ mặt đất.
- **Chưa bỏ vẽ đồ đạc bị mask che hoàn toàn** (tối ưu tùy chọn).
- **Chưa có mái hiên.**
- **Từ M11c-1A:** đèn trần tầng đang xem vẫn vẽ; cánh cửa bị ẩn mất bóng nhỏ; chưa có fade hay dither cho kiến trúc.
