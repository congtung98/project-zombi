# Hướng dẫn làm map với Map Editor

Dành cho người làm nội dung: từ một prefab nhà mới đến world chơi được trong game. Chi tiết kỹ thuật: `docs/map-content-format.md` và các báo cáo `docs/map-editor-m3.md` … `m6.md`.

## 0. Mở editor

```bash
npm install
npm run dev          # rồi mở http://localhost:5173/editor.html
```

Editor mở sẵn khu phố `neighborhood-50`. Các nút trên thanh trên cùng:

- **Mới**: world trống 2 × 2 chunk, hoặc **Sinh bằng generator** (seed + số khối).
- **Mở…**: content trong repo hoặc bản nháp.
- **Lưu nháp** (Ctrl+S): lưu vào IndexedDB riêng của editor, không đụng save game.
- **Lưu thành…** (Ctrl+Shift+S): lưu bản đang sửa (kể cả phần chưa lưu) thành **world mới** với `worldId`/tên mới rồi sửa tiếp trên bản đó. Chunk, prefab, ID giữ nguyên; `contentVersion` về 1; không mang theo migration save của world gốc. World gốc không đổi. Bản sao được lưu nháp ngay; lịch sử hoàn tác bắt đầu lại.
- **Import… / Export**: content pack `.mappack.json`.

Chuột: trái để chọn/kéo; phải hoặc giữa để kéo camera; lăn để zoom. F để focus, Tab để đổi nhìn trên xuống / isometric.

## 1. Tạo prefab nhà (chế độ sửa prefab)

1. Tab **Prefab** → **Prefab mới…** → đặt `prefabId` (ví dụ `building/corner-shop`), tên và kích thước. Editor tạo nhà mẫu (4 bức tường, cửa ở tường nam mở vào trong, một phòng có đèn) rồi mở **chế độ sửa prefab**: viền và banner hồng ghi *Sửa PREFAB GỐC* kèm danh sách instance sẽ thay đổi theo.
2. **Tường**: nhấn rồi kéo theo trục X hoặc Z. Tường không cần tự chừa khe.
3. **Cửa/cửa sổ**: click sát một bức tường, cửa tự bám vào tường và quay vào trong nhà. Game tự khoét khe, dựng lanh tô, bệ và đầu cửa sổ. Hướng mở và trạng thái ban đầu chỉnh ở Inspector.
4. **Nội thất, tủ**: click để đặt. Bảng loot của tủ chọn ở Inspector. Tab Nội thất có **Cây (vườn)** để trồng cây trong sân của prefab; cây xoay theo instance. Vòng xanh là tầm tương tác trong game (phím E).
5. **Phòng**: kéo khung trên đường tâm tường. Phòng có đèn đi kèm công tắc (ô vàng, kéo để dời). Chọn đèn (bấm công tắc) rồi kéo ô vuông vàng để dời bóng đèn trên trần; Inspector có nút **Đèn về tâm phòng**. Ánh sáng tính theo phòng: cửa sổ chiếu vào, cửa mở truyền sang phòng bên.
6. **Đổi kích thước bằng tay cầm**: chọn một mục, kéo các ô vuông trắng. Khối/phòng có 8 ô (cạnh và góc; cạnh đối diện đứng yên), tường chạy có 2 ô ở hai đầu (trượt theo trục của tường). Vật quá nhỏ trên màn hình thì không hiện tay cầm: phóng to để đổi kích thước, còn kéo thân vật thì vẫn là di chuyển.
7. Inspector (khi không chọn gì): **Xem xoay** 90/180/270° để thấy instance xoay trông ra sao (chỉ xem), **Khớp footprint với tường**, màu tường/mái/sàn.
8. **← Về world**.

Mọi thao tác đều có Hoàn tác / Làm lại (Ctrl+Z / Ctrl+Y).

## 2. Đặt lên world

- Tab **Prefab**: click một prefab (có hình thu nhỏ), R để xoay, click lên viewport để đặt, Esc để thoát.
- Tab **Object / Nền / Zone / Spawn**: tường và hàng rào (kéo dài), thùng, xe, **cây tán tròn / cây thông** (M9: thân chặn đường như cái cột, tán chỉ để nhìn và mờ đi khi che người chơi; Inspector: kiểu, chiều cao, bán kính tán/thân, màu; tay cầm kéo bán kính tán; layer **Cây**), đống phế liệu có loot, đường/vỉa hè (kéo khung), zone zombie (chữ nhật: kéo khung; tròn: kéo bán kính), spawn zombie/người chơi. Spawn người chơi chọn làm điểm xuất phát ở Inspector.
- **Tay cầm**: chọn một khối, đường, zone rồi kéo các ô vuông trắng để đổi kích thước (zone tròn: một ô bán kính). Mỗi lần kéo là một bước Hoàn tác; ID giữ nguyên, vật có thể được chuyển sang chunk khác khi tâm vượt ranh giới.
- **Lớp vẽ** (Inspector của đường/nền): chỗ hai mặt nền chồng nhau, lớp cao hơn nằm trên (0–4).
- Tab **Chunk**: click ô xám để thêm chunk 32 m, rồi bấm **Khớp vùng chơi với chunk**: vùng chơi thành hình chữ nhật phủ các chunk (trừ lề 2 m), không cần đối xứng quanh gốc. Kích thước X/Z và tâm cũng sửa được ở Inspector → World.
- **Layer** (panel trái): ẩn/khóa theo loại, chỉ có tác dụng trong editor. Kéo từ chỗ nền trống để chọn theo khung; Ctrl+A chọn tất cả.

## 3. Kiểm tra

- Nút **Validate** hiện số lỗi/cảnh báo. **Lỗi** chặn Export và Chơi thử. Click một dòng để chọn đúng record, hoặc mục trong prefab.
- **Kiểm tra sâu** (trong bảng Validate) dùng chính hệ thống của game:
  - tủ, cửa, công tắc, rèm có đi tới và với tới được không (mọi cửa mở);
  - spawn/zone có nối tới chỗ người chơi không; spawn zombie có nằm trong nhà không;
  - collider của hai record có chồng nhau không; tủ có nằm ngoài phòng không.
  - Kết quả là cảnh báo: đọc rồi tự quyết định.
- Cảnh báo **content-changed-same-version**: bạn đã thêm, bỏ hoặc đổi tên cửa/tủ/cửa sổ/đèn/zone so với bản đã phát hành. Dời, đổi màu, đổi kích thước thì không cần làm gì: save cũ vẫn giữ trạng thái cửa/loot/đèn.
- **Tương thích save** (Inspector → World, bỏ chọn mọi thứ để thấy):
  - liệt kê những gì thêm (xanh) và bỏ (đỏ) theo loại;
  - mỗi ID bị bỏ có ô chọn: **bỏ** (mất trạng thái; đồ trong tủ rơi xuống đất chỗ tủ cũ) hoặc **đổi tên thành** một ID mới cùng loại (giữ trạng thái). Editor tự gợi ý khi chỉ có một cặp bỏ/thêm trong cùng một nhà, ví dụ đổi local ID của đèn;
  - bấm **Tạo migration vN → vN+1**: `contentVersion` tăng và file `migrations/content-vN.json` được thêm vào world. Save cũ của người chơi sẽ tự chuyển sang nội dung mới khi Continue (có giữ bản sao).
- Bản nháp hoặc pack của một world đã có trong repo luôn được so với bản trong repo, kể cả khi đã lưu nháp nhiều lần.

## 4. Chơi thử (Play From Here)

- **▶ Chơi từ đây** rồi click một điểm, hoặc **▶ Từ spawn**. Chọn giờ bắt đầu (ví dụ 21:00 để thử đèn và ban đêm).
- Game thật chạy trên đúng bản đang sửa, kể cả phần chưa lưu. Save trong lúc chơi chỉ nằm trong bộ nhớ; save thật, map và bản nháp đều không đổi.
- **← Về editor**: mọi thứ còn nguyên (document, vùng chọn, camera, lịch sử).

## 5. Đưa vào repo và game

1. **Export** → tải về `<worldId>.mappack.json`. Export bị chặn nếu còn lỗi.
2. Ghi pack vào repo:

   ```bash
   npm run map:unpack -- <worldId>.mappack.json           # → content/maps/<worldId>/
   npm run map:unpack -- <file> --force                   # ghi đè world có sẵn (file không đổi thì không ghi lại)
   npm run map:unpack -- <file> --world-id <id-mới> [--name "Tên"]   # ghi pack thành world mới (như Lưu thành…)
   npm run map:check -- --deep                            # validate + kiểm tra sâu mọi world
   ```

3. Chơi trong game: mở game (dev hoặc bản build) → menu chính → **Đổi world** → chọn world → **Chơi**. Game tải lại trên world đó và nhớ lựa chọn cho lần sau (chi tiết `docs/world-menu.md`).
   - Mỗi world có slot save riêng (`slot-world-<id>`). `neighborhood-50` là world mặc định và dùng save thật `slot-1`. Đổi world không xóa save nào.
   - World thử nghiệm không muốn người chơi thấy: bỏ chọn *Hiện trong menu game* ở Inspector World (`"listed": false`). Bản dev vẫn liệt kê nó, kèm "(ẩn, chỉ dev)".
   - `?world=<worldId>` vẫn dùng được cho một lần mở (link, script), không đổi lựa chọn đã lưu.
   - **Không thấy thay đổi sau khi unpack?** Tắt `npm run dev` (Ctrl+C) rồi chạy lại. Dev server chạy lâu, nhất là sau khi các thư mục trong `content/maps/` bị tạo/xóa, có thể bỏ lỡ sự kiện "file đổi" và tiếp tục phục vụ JSON cũ; tải lại trang không đủ vì cache nằm ở server. Cách kiểm tra: console dev `__runtime.map.contentVersion` phải bằng số trong `world.json`.
4. Commit thư mục `content/maps/<worldId>/`. Muốn sửa tiếp: Mở… → content trong repo; hoặc `npm run map:pack -- content/maps/<worldId>` rồi Import.

> **Sửa `neighborhood-50` (world chính đang phát hành).**
> - Từ M8, thêm/bỏ/đổi tên cửa, tủ, đèn, zone **không làm mất save** của người chơi nữa, miễn là tạo migration (Tương thích save → Tạo migration). Save v1–v7 cũng đi qua nó.
> - Test trong `npm test` chạy trên **bản khu phố đóng băng** (`src/test/fixtures/maps/neighborhood-50/`), không đọc bản thật. Vì vậy sửa khu phố thật không làm vỡ test. `src/map/liveContent.test.ts` và `npm run map:check -- --deep` vẫn kiểm tra bản thật nạp được.
> - Để thử nghiệm, vẫn nên làm trên **world mới**: mở `neighborhood-50` → **Lưu thành…** (`worldId` khác); hoặc Mới → Trống / Sinh bằng generator. Lỡ export `neighborhood-50` đã sửa thì `map:unpack -- neighborhood-50.mappack.json --world-id <id-mới>`.

## 6. Sinh world bằng generator

```bash
npm run map:generate -- --seed 42 --blocks 2x2 --world-id town-42      # → content/maps/town-42/
npm run map:generate -- --seed 42 --blocks 3x3 --pack town.mappack.json # pack để Import vào editor
npm run map:generate -- --seed 42 --blocks 2x2 --dry                    # chỉ in tóm tắt
npm run map:generate -- --seed 7 --blocks 4x4 --layout varied --trees 1 --dry   # bố cục đa dạng, nhiều cây
npm run map:generate -- --seed 3 --blocks 16x16 --layout varied --world-id big-town   # thị trấn lớn nhất (~530 m)
```

- **Kích thước** (`--blocks`, từ 1×1 tới 16×16): từ M10, world lớn chơi mượt vì game chỉ mount phần camera thấy và chỉ tải world đang chơi (`docs/map-editor-m10.md`). Thị trấn 16×16 có 288 chunk, khoảng 500 nhà và 500 zombie. Editor vẫn dựng mọi chunk, nên sửa world rất lớn sẽ chậm hơn.

- **Bố cục** (`--layout`): `grid` (mặc định) có khối 28 m đều nhau, 4 lô mỗi khối. `varied` có khối 22/28/34 m, mỗi dãy 1–3 lô rộng không đều, và khoảng 1/5 số khối thành công viên (cây, ghế, zone).
- **Cây** (`--trees 0..1`, mặc định 0,5): cây nhỏ dọc đường ở ranh lô (không che giữa mặt nhà), cây góc vườn, cây trong công viên. Cây dùng luồng ngẫu nhiên riêng, nên đổi mật độ cây không đổi phần còn lại của thị trấn.
- Cùng seed + số khối + bố cục + mật độ cây + thư viện prefab + phiên bản generator (v2) ⇒ cùng file. Trong editor: Mới → *Sinh bằng generator* (chọn Bố cục, Cây) cho ra đúng kết quả đó.
- World sinh ra là nội dung bình thường: sửa tay, chơi thử, export như trên.
- Generator **không ghi đè** world đã sửa tay (kể cả khi có `--force`). Muốn sinh lại thì dùng `--world-id`/`--out` khác.

## 7. Quy tắc cần nhớ

- **ID là vĩnh viễn**:
  - dời, xoay, sửa không đổi ID; kéo qua chunk khác vẫn giữ ID;
  - nhân bản tạo ID mới;
  - ID đã xóa không bao giờ được cấp lại (`retiredIds`, `retiredLocalIds`).
- **Sửa prefab gốc** thì mọi instance đổi theo; muốn biến thể thì **Nhân bản** prefab.
- Vùng chơi là hình chữ nhật, đặt tâm tùy ý (M7); mặt đất, lưới nav và hàng rào biên theo nó.
- Hai mặt đường khác màu **cùng lớp** chồng nhau sẽ nhấp nháy trong game (cảnh báo `surface-overlap`): đặt **Lớp vẽ** khác cho một trong hai.
