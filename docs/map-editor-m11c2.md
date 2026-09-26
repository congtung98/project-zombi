# Map editor M11c-2: editor nhiều tầng

Ngày 26/09/2026. Sprint cuối của M11 (M11a nhà chữ L/T/U, M11b nhiều tầng: dữ liệu và mô phỏng, M11c-1A cắt lớp, M11c-1B tầm nhìn nội thất). Làm cho nhà nhiều tầng sửa được trong editor bằng chuột:
- chọn tầng đang sửa;
- đặt cầu thang bằng thao tác kéo;
- nhà hai tầng mẫu.

Save, schema map và nội dung không đổi. Editor ghi đúng các trường M11b đã có: `building.storeys`, `level` trên object và phòng, object `stairs`.

## 1. Cách dùng

Xem hướng dẫn `docs/map-editor-guide.md` mục 1.9. Tóm tắt:
- **Prefab mới → Hai tầng** (ít nhất 8 × 6 m). Nhà mẫu hợp lệ và chơi được ngay:
  - tầng trệt: cửa nam, cửa sổ nam, phòng có đèn;
  - cầu thang 4 m dọc tường bắc (chân phía tây);
  - tầng trên: bốn tường, cửa sổ nam, phòng có đèn, công tắc cạnh đỉnh cầu thang.
- **Inspector prefab:** **Số tầng** (1–4, mỗi tầng ≥ 2,6 m, bớt tầng chỉ khi tầng đó trống), **Cao mỗi tầng**.
- **Chọn tầng đang sửa:** nút **Trệt / Tầng 2 / …** dưới banner hồng, hoặc PageUp / PageDown.
  - Chỉ tầng đang sửa được vẽ đầy đủ, chọn (click, khung chọn, Ctrl+A) và đặt đồ lên.
  - Tầng ngay dưới hiện mờ để căn tường thẳng hàng; khung vàng là lỗ cầu thang ở sàn tầng đó.
  - Chuột, handle và khung chọn nằm trên sàn của tầng đó, nên ở góc nhìn isometric (Tab) vẫn trúng.
- **Đặt đồ:**
  - mọi thứ đặt mới thuộc tầng đang sửa (`level`; tầng trệt không ghi trường này, giống file viết tay);
  - cửa và cửa sổ chỉ bám vào tường cùng tầng;
  - cây chỉ trồng ở tầng trệt.
- **Inspector → Tầng** của một mục (tường, cửa, cửa sổ, đồ, tủ, phòng): chuyển mục sang tầng khác; editor chuyển theo sang tầng đó và giữ mục đang chọn.
- **Cầu thang** (tab Tường):
  - nhấn ở chân, kéo về phía đỉnh; trục chính của thao tác kéo cho hướng, độ dài kéo cho độ dài (từ chiều cao tầng tới 12 m, không dốc hơn 45°);
  - click không kéo thì cầu thang dài mặc định (khoảng 37°, 4 m cho tầng 3 m), leo về +X;
  - cầu thang leo từ tầng đang sửa lên tầng kế trên; tầng trên cùng và nhà một tầng thì không đặt được;
  - hai ô vuông ở chân/đỉnh để đổi độ dài: đầu kia đứng yên, luôn trượt theo trục cầu thang.

## 2. Mã

- **`src/map/editor/storeys.ts`** (thuần, mới):
  - `levelOf`, `storeysOf`, `levelField`;
  - `prefabFloorView`: prefab thu về một tầng, cộng các cầu thang leo tới tầng đó;
  - `itemsFromStorey`: những gì còn ở tầng ≥ k, dùng để chặn việc bớt tầng;
  - `climbDirection`, `stairEnds`, `defaultStairLength`, `stairFromDrag`, `dragStairEnd`.
- **`src/map/editor/prefabCommands.ts`:**
  - `PrefabItem.level` (đèn theo phòng; cầu thang theo tầng nó bắt đầu), `itemsOnFloor`;
  - `placePrefabItem(..., floor)`, `nearestWallRun(..., level)`;
  - `updatePrefab` nhận `building.storeys`;
  - `starterTwoStoreyHouse`, `TWO_STOREY_MIN`, `createPrefab({ shape: 'twoStorey' })`.
- **`src/map/editor/prefabPresets.ts`:** preset `structure/stairs`.
- **`src/map/editor/handles.ts`:** handle `from` (chân) và `to` (đỉnh) cho cầu thang.
- **Editor:**
  - `editorStore`: `prefabFloor`, `setPrefabFloor`;
  - `interaction`: `activeFloor` (kẹp vào số tầng hiện có, phòng khi hoàn tác làm bớt tầng), `editElevation`; chọn, đặt, khung chọn và Ctrl+A theo tầng; nhãn handle cầu thang;
  - `Viewport`: mặt phẳng chuột, handle và khung chọn ở độ cao tầng;
  - `PrefabScene`: tầng đang sửa, tầng dưới mờ, viền lỗ cầu thang; lớp phủ và khung chọn nâng theo tầng;
  - `Panels`: `FloorSelector`, lựa chọn "Hai tầng";
  - `PrefabInspector`: "Số tầng", "Cao mỗi tầng", `StoreyField`;
  - `EditorApp`: PageUp/PageDown;
  - `drawItems`: cánh cửa theo `hinge.y` (cửa tầng trên trước đây vẽ ở mặt đất), vẽ bậc thang (cả chế độ world).

## 3. Kiểm chứng

- **Unit** `src/map/editor/storeys.test.ts` (7 test):
  - nhà hai tầng mẫu: không lỗi validate; deep check hoàn toàn sạch ở 4 góc xoay (cầu thang dùng được, mọi cửa, công tắc và rèm với tới được); runtime có 2 lớp điều hướng và 1 cầu thang;
  - nhà hai tầng quá nhỏ (7 × 6) bị từ chối;
  - đặt theo tầng: vách tầng 2, cửa bám vách tầng 2 (không bám tường tầng trệt), tủ, phòng; tầng trệt không có trường `level`; cây và tầng không tồn tại bị từ chối;
  - lọc và chọn theo tầng; `prefabFloorView`;
  - cầu thang từ thao tác kéo ở 4 hướng, click mặc định, giới hạn 45° và 12 m;
  - đặt cầu thang bằng lệnh; tầng trên cùng và nhà một tầng bị từ chối; kéo handle đỉnh/chân;
  - số tầng: thêm tự do, bớt bị chặn khi còn đồ, tối đa 4, tầng thấp hơn 2,6 m bị từ chối, về 1 tầng thì bỏ trường; chuyển tầng một phòng.
- **Trình duyệt** `scripts/m11c2-editor-browser.mjs` (chuột thật):
  - tạo nhà hai tầng từ hộp thoại;
  - ở tầng 2 click chọn được tường bắc tầng 2 (không phải tầng trệt); đặt tủ, kéo vách, click cửa (cửa bám vách tầng 2);
  - góc nhìn isometric chọn đúng tủ ở độ cao tầng 2;
  - PageDown về tầng trệt; kéo đỉnh cầu thang (dài 5,2 m, chân đứng yên); kéo một cầu thang mới từ (3,5; 3) tới (3,5; −1) được 4 m; cả hai hoàn tác;
  - Số tầng 2 → 3 (ba nút tầng), hoàn tác;
  - đặt nhà, Export → `map:unpack` → `map:check --deep` sạch → chơi: bấm S+D leo cầu thang lên y = 3, cắt lớp sang tầng 2.
- **Ảnh:** `node_modules/.tmp/m11c2-*.png` (tầng trệt, tầng 2 nhìn trên xuống, tầng 2 isometric, cầu thang mới, trong game ở tầng 2).

## 4. Giới hạn còn lại

- Chế độ world của editor vẽ mọi tầng của một nhà chồng lên nhau (nhìn từ trên thấy tầng cao nhất).
- Generator chưa sinh nhà nhiều tầng.
- Chỉ có cầu thang thẳng một đợt; cầu thang chữ L/U phải ghép từ nhiều cầu thang.
- Tấm sàn tầng trên không vẽ trong editor, chỉ có viền lỗ cầu thang; trong game vẫn có đủ.
