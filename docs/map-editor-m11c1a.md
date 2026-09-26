# Map editor M11c-1A: cắt lớp công trình trên nền nhiều tầng

Ngày 26/09/2026. Sprint đầu của M11c. Triển khai phần hiển thị của `docs/Building_Cutaway_Visibility_Fix_Plan.md` (milestone M1–M4 của tài liệu đó), trên nền nhiều tầng của M11b.

**M11c chia ba sprint** (thứ tự người dùng chọn ngày 26/09/2026):
- **M11c-1A (sprint này): cắt lớp.** Metadata cho kiến trúc, một điểm quyết định hiển thị duy nhất, chọn tầng quan sát (có trễ trên cầu thang), cắt tường, giữ bóng, fixture thử. Chưa lộ nội thất khi đứng ngoài nhìn qua cửa sổ, vì chưa có mask.
- M11c-1B: tầm nhìn nội thất, bắt buộc để xong M11c-1. Mask làm tối phần nội thất nhân vật chưa thấy (chỉ trong nhà, không bao giờ ngoài trời), nhìn qua cửa/cửa sổ, ghi nhớ vùng đã khám phá. Nghiệm thu bắt buộc: nhìn qua cửa sổ thấy một phần phòng, phòng kín kế bên vẫn không bị lộ.
- M11c-2: editor. Sửa từng tầng, đặt cầu thang bằng chuột, nhà hai tầng mẫu.

Không đổi save, schema map hay nội dung `neighborhood-50`. Cắt lớp chỉ là trạng thái trình bày: không ghi vào save, không vào prefab.

## 1. Audit code cũ (M1)

Ảnh "trước" chụp bằng `BASELINE=1 node scripts/m11c1a-cutaway-browser.mjs`, lưu ở `node_modules/.tmp/m11c1a-*-before.png`.

- **Điều kiện ẩn mái:** `RoofController` (R1) ẩn *cả mái* của nhà khi nhân vật đứng trong khung nhà *hoặc cách tường ngoài dưới 0,4 m*. Nó không xét tầm nhìn hay tầng. Đây là dạng mà mục 14 của tài liệu cấm: đứng sát tường ngoài cũng lộ cả nhà.
- **Nhà hai tầng, ở tầng trệt:** mái ẩn, nhưng tấm sàn, tường, cửa, cửa sổ, đồ đạc và đèn tầng 2 vẫn vẽ. Chúng chỉ mờ đi khi nằm trên 3 tia từ camera tới nhân vật (`OcclusionFader`). Tấm sàn tầng 2 che gần hết phòng, nhân vật gần như không thấy (ảnh `ground-before`, `stairs-before`).
- **Mesh riêng từng mảnh:** có. Mỗi tường, mái và tấm sàn là một instance trong `BatchedMesh` của chunk, ẩn hiện riêng được. Làm mờ nghĩa là ẩn instance và hiện một bản sao dùng material mờ dùng chung, nên không lây sang nhà khác.
- **Metadata:** mục trong batch chỉ có `roofOf`; tường và đồ đạc không có nhà, tầng hay vai trò.
- **Cửa và cửa sổ:** có hình học thật (bản lề, rộng, cao; ô kính, bệ, đầu cửa sổ) và trạng thái chạy (cửa, rèm).
- **Tầm nhìn:** `PlayerVisionSystem` chỉ quyết định zombie nào hiện, dựa trên tập vật chắn tầm nhìn riêng, không dựa trên mesh. `VisionOverlay` là lớp tối nhẹ (≤ 15%), không che nội thất. Nội thất tĩnh luôn vẽ đủ khi mái ẩn.
- **Mesh ẩn:** không mất collider hay vật chắn tầm nhìn (hai tập riêng). Nhưng `setVisibleAt(false)` cũng bỏ instance khỏi shadow pass, nên mái ẩn làm mất bóng đổ ra sân.
- **Material dùng chung:** không có chuyện đổi opacity của material chung.
- **Play From Here:** dùng cùng runtime và cùng đường vẽ.
- **Hai lỗi M11b tìm thấy ở lớp phủ tầm nhìn:**
  - tia mask tầm nhìn dùng độ cao tuyệt đối, nên ở tầng 2 mask tính theo tường tầng trệt;
  - shader chiếu xuống mặt phẳng y = 0, nên ở tầng 2 vùng tối lệch khoảng 3,5 m.

## 2. Luồng dữ liệu mới

```
resolver (prop: true trên đồ vật)
  → staticBatchData.collectStaticItems: mỗi mảnh có buildingId + role (+ id)
  → StaticBatches: BatchedPiece cho mọi mảnh của nhà; members[buildingId]
CutawayController (useFrame, trước OcclusionFader)
  → cutaway.update(vị trí chân nhân vật): nhà nào, tầng quan sát nào (version++ khi đổi)
  → mỗi mảnh của nhà cũ/mới: piece.setLimit(cutaway.limit(...))
BatchedPiece.sync (điểm quyết định duy nhất): cắt lớp (nguyên/cắt/ẩn) → rồi mới đến làm mờ
Cửa, cửa sổ, đèn, công tắc, dấu thùng, zombie, túi đồ: đọc cùng `cutaway` khi version đổi
```

- **`src/game/rendering/cutaway.ts`** (thuần, không three.js, không React):
  - `observedLevel`: tầng quan sát theo độ cao chân, có trễ `LEVEL_SWITCH` = 0,75 tầng;
  - `viewFor`: sàn, trần và độ cao cắt tường của tầng quan sát;
  - `wallSide`: tường phía camera / phía xa / vách trong / đứng tự do, dò hình học quanh footprint nên đúng với mọi góc xoay prefab;
  - `displayLimit` và `pieceShow` (nguyên / cắt / ẩn);
  - lớp `CutawayState` với singleton `cutaway`: `update`, `limit`, `hidesPoint`, `storeyShown`, `stats`.
- **Metadata** (`staticBatchData.ts`): `StaticItem.buildingId`, `role` (`wall`, `prop`, `container`, `roof`, `slab`, `floor`, `stairs`), `id`.
  - `buildingMembership` tìm nhà theo ID trước (`<instance>/…`, `<instance>#…`, `<building>-…`), sau đó theo vị trí (tâm mảnh nằm trong footprint hoặc cách mép dưới 0,2 m).
  - `WallDef.prop` do resolver đặt cho object `prop`, để cắt lớp không bao giờ cắt đồ đạc.
  - Metadata suy ra lúc chạy, nên hai bản sao của cùng prefab không dùng chung nhóm và không cần trường mới trong schema.
- **`StaticBatches.tsx`**: `RoofController` được thay bằng `CutawayController`. `BatchedPiece` có `limit`/`show`:
  - mảnh bị cắt dùng chính instance đó với ma trận thấp hơn;
  - mảnh bị cắt hoặc ẩn bật instance cùng số trong **batch bóng song sinh** của chunk (một `BatchedMesh` dùng `SHADOW_ONLY`, mọi instance tắt sẵn; chỉ chunk có nhà mới có);
  - vì vậy cắt lớp không thêm draw call nào theo mảnh;
  - fader chỉ làm mờ mảnh còn nguyên;
  - khi tháo batch (StrictMode, streaming), mảnh trở về nguyên. Trước đây một mảnh đang mờ bị tháo rồi gắn lại có thể biến mất.

## 3. Quy tắc hiển thị

Chỉ áp dụng cho **nhà nhân vật đang đứng bên trong**:
- vào khi tâm nhân vật đã qua đường tường 0,2 m (`ENTER_DEPTH`);
- ra khi đã cách footprint 0,3 m (`LEAVE_MARGIN`).

Đứng ngoài sát tường không cắt gì; nhà che nhân vật thì fader làm mờ như trước.

| Mảnh của nhà đang xem | Tầng trệt (sàn 0) | Tầng 2 (sàn 3) |
| --- | --- | --- |
| Mái | ẩn | ẩn |
| Tấm sàn, tường, cửa, cửa sổ, đồ đạc, đèn tầng trên | ẩn | (không có) |
| Tấm sàn dưới chân, cả tầng dưới | — | nguyên |
| Tường ngoài phía camera (+X, +Z), vách trong, tường quanh cầu thang | cắt còn 0,6 m | cắt còn 3,6 m |
| Tường ngoài quay lưng camera (−X, −Z) | nguyên (tới trần) | nguyên |
| Cửa trong tường bị cắt | cánh thu còn 0,6 m | tương tự |
| Kính cửa sổ và rèm trong tường bị cắt | ẩn (bệ 0,9 m > 0,6 m) | tương tự |
| Công tắc trên tường bị cắt | ẩn (bấm E vẫn được) | tương tự |
| Đèn trần của tầng đang xem | vẫn vẽ (như trước) | vẫn vẽ |
| Zombie, túi đồ, dấu thùng ở tầng bị ẩn | ẩn | — |
| Nhà khác (kể cả bản sao cùng prefab) | nguyên | nguyên |

- **Chọn tầng:** trên cầu thang, tầng quan sát chỉ đổi khi chân đã đi được 3/4 tầng. Lên thì đổi ở khoảng 2,25 m; xuống thì đổi ở khoảng 0,75 m; dao động ở giữa không làm lật tầng.
- **Chuyển trạng thái:** đổi tức thì, không fade (tài liệu cho phép ẩn cứng trước). Chống nhấp nháy bằng trễ ở cửa ra vào và trên cầu thang.

## 4. Độc lập với mô phỏng và ánh sáng

- Collider, vật chắn tầm nhìn, điều hướng, AI, save và `buildingLighting` không đọc `cutaway`.
- Tường đã cắt vẫn chặn đi lại, tầm nhìn và đòn đánh; sàn tầng trên đã ẩn vẫn ngăn hai tầng (test `presentation only`).
- **Bóng:** mảnh bị cắt hoặc ẩn vẫn đổ bóng đủ hình qua batch bóng song sinh (`SHADOW_ONLY`: `colorWrite` và `depthWrite` tắt; batch này có `castShadow`), nên mái và tầng trên vẫn đổ bóng ra sân.
- **Ánh sáng:** cường độ đèn cảnh, ánh sáng phòng và exposure không đổi khi cắt lớp. Trong phòng, ánh sáng vẫn do `indoorShading` quyết định theo phòng, không phụ thuộc bóng mái.

## 5. Sửa kèm (lỗi M11b ở lớp phủ tầm nhìn)

- `computeSectorDistances`: tia mask xuất phát từ `position.y` + độ cao mắt.
- `VisionOverlay`: shader chiếu xuống sàn đang đứng (`uFloorY`).
- `BuildingLightingDebug` (F6):
  - chỉ vẽ tầng đang quan sát; nhà khác chỉ vẽ tầng trệt; ô cầu thang hiện từ cả hai tầng nó nối;
  - thêm nhãn cắt lớp đi theo nhân vật: nhà, tầng, sàn, độ cao ẩn, độ cao cắt tường, số mảnh ẩn/cắt/giữ bóng, thời gian tính, phòng.

## 6. Fixture `cutaway-lab`

World ẩn khỏi menu, mở bằng `?world=cutaway-lab`; bản đông cứng cho test ở `src/test/fixtures/maps/cutaway-lab`. Prefab `building/cutaway-house`, 10 × 8 m, hai tầng:
- **Tầng trệt:**
  - phòng khách: cửa chính ở tường tây, cửa sổ ở tường nam (phía camera), bàn, tủ bếp, cầu thang kín dọc tường bắc;
  - phòng kho: ngăn bằng vách kín, cửa riêng ở tường đông, cửa sổ ở tường bắc.
- **Tầng trên:** hành lang và phòng ngủ (cửa, cửa sổ phía nam, tủ quần áo, giường).
- **Ba bản:** `house-a` và `house-b` cạnh nhau (cùng prefab), `house-c` xoay 90°.

## 7. Kiểm chứng

- **Unit** `src/game/rendering/cutaway.test.ts` (9 test):
  - thành viên và vai trò; bản sao không dính nhau;
  - phân loại tường, kể cả nhà xoay 90°;
  - trễ tầng trên cầu thang;
  - vào và ra qua cửa; đứng sát tường không cắt;
  - bảng quy tắc ở tầng trệt và ở tầng 2;
  - ẩn zombie/túi theo tầng và lọc tầng của F6;
  - chỉ là trình bày (va chạm, tầm nhìn, ánh sáng không đổi);
  - nhà khác không bị ảnh hưởng.
- **Trình duyệt** `scripts/m11c1a-cutaway-browser.mjs`:
  - nhà và tầng được cắt ở 7 cảnh;
  - những gì vẽ ở tầng trệt: cửa chính nguyên, cửa kho cắt còn 0,6 m, cửa phòng ngủ ẩn, kính phía nam và tầng trên ẩn, đèn tầng trệt vẽ, công tắc trên tường xa vẽ và trên tường đã cắt ẩn;
  - phím thật qua cửa chính và lên/xuống cầu thang, lấy mẫu mỗi frame: đổi đúng một lần mỗi chiều;
  - bóng: so điểm cỏ với dự đoán hình học của cả khối nhà, kèm phép so bật/tắt proxy;
  - đèn và ánh sáng phòng giống nhau trong và ngoài nhà;
  - nhãn F6.
- Ảnh "sau": `node_modules/.tmp/m11c1a-*-after.png`.
- **Số liệu trình duyệt:**
  - bóng: 98/104 điểm cỏ khớp dự đoán hình học (6 điểm lệch ở mép bóng); 8/10 điểm chỉ nằm trong bóng của tầng đã ẩn vẫn tối;
  - tắt proxy (công tắc dev) thì 22 điểm sáng lên;
  - ánh sáng phòng khách 0,693 cả trong lẫn ngoài.
- **Hiệu năng** (swiftshader, 1280 × 800):
  - ghép cắt lớp khi đổi nhà hoặc tầng: 0,1–0,2 ms (khu phố và lab); mỗi frame chỉ thêm một truy vấn nhà;
  - ngoài trời trên khu phố, bản này và HEAD cùng 64 draw call, 6,1 / 6,0 fps, cùng tỉ lệ mô phỏng 0,6;
  - batch bóng song sinh không thêm draw call khi không dùng.
- **Sửa script cũ:**
  - `m11b-floors-browser.mjs` đo *chân* cánh cửa (0 và 3 m), vì cửa phòng ngủ trong vách trong giờ được cắt thấp khi đứng ở tầng 2;
  - `p2-vision-browser.mjs` giữ phím xoay ít nhất 250 ms *và* 3 frame. Ở khoảng 6 fps, 250 ms có thể chỉ chứa 1 bước mô phỏng 0,1 s, và nhân vật chỉ xoay được 3/4. Đây là lỗi phụ thuộc pha khung hình, không phụ thuộc hiệu năng (FPS như HEAD).

## 8. Giới hạn còn lại

- **Không lộ nội thất khi nhìn qua cửa sổ từ ngoài:** làm ở M11c-1B, cùng mask nội thất chưa thấy.
- **Fader vẫn lộ mờ nội thất nhà khác:** khi một nhà che nhân vật (đứng ngoài, cạnh nhà), fader làm mờ mái và tường của nó như trước, nên lộ mờ nội thất. Mask của M11c-1B sẽ xử lý.
- **Đèn trần của tầng đang xem vẫn vẽ ở độ cao trần** (như trước M11c), để nhìn thấy đèn nào đang sáng.
- **Cánh cửa bị ẩn mất bóng nhỏ của nó:** cửa là mesh riêng, fader cũng ghi vào material của nó, nên không dùng proxy.
- **Chưa có fade hay dither** khi chuyển; chỉ có trễ.
- **Chưa có mái hiên:** schema chưa có khái niệm này.
- **Chỉ cắt nhà nhân vật đang ở trong;** nhà khác che nhân vật thì vẫn do fader.
