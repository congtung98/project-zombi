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
4. **Nội thất, tủ**: click để đặt. Bảng loot của tủ chọn ở Inspector. Vòng xanh là tầm tương tác trong game (phím E).
5. **Phòng**: kéo khung trên đường tâm tường. Phòng có đèn đi kèm công tắc (ô vàng, kéo để dời). Ánh sáng tính theo phòng: cửa sổ chiếu vào, cửa mở truyền sang phòng bên.
6. Inspector (khi không chọn gì): **Xem xoay** 90/180/270° để thấy instance xoay trông ra sao (chỉ xem), **Khớp footprint với tường**, màu tường/mái/sàn.
7. **← Về world**.

Mọi thao tác đều có Hoàn tác / Làm lại (Ctrl+Z / Ctrl+Y).

## 2. Đặt lên world

- Tab **Prefab**: click một prefab (có hình thu nhỏ), R để xoay, click lên viewport để đặt, Esc để thoát.
- Tab **Object / Nền / Zone / Spawn**: tường và hàng rào (kéo dài), thùng, xe, đống phế liệu có loot, đường/vỉa hè (kéo khung), zone zombie (chữ nhật: kéo khung; tròn: kéo bán kính), spawn zombie/người chơi. Spawn người chơi chọn làm điểm xuất phát ở Inspector.
- Tab **Chunk**: click ô xám để thêm chunk 32 m, rồi bấm **Khớp vùng chơi với chunk**.
- **Layer** (panel trái): ẩn/khóa theo loại, chỉ có tác dụng trong editor. Kéo từ chỗ nền trống để chọn theo khung; Ctrl+A chọn tất cả.

## 3. Kiểm tra

- Nút **Validate** hiện số lỗi/cảnh báo. **Lỗi** chặn Export và Chơi thử. Click một dòng để chọn đúng record, hoặc mục trong prefab.
- **Kiểm tra sâu** (trong bảng Validate) dùng chính hệ thống của game:
  - tủ, cửa, công tắc, rèm có đi tới và với tới được không (mọi cửa mở);
  - spawn/zone có nối tới chỗ người chơi không; spawn zombie có nằm trong nhà không;
  - collider của hai record có chồng nhau không; tủ có nằm ngoài phòng không.
  - Kết quả là cảnh báo: đọc rồi tự quyết định.
- Cảnh báo **content-changed-same-version**: bạn đã thêm, bỏ hoặc đổi tên cửa/tủ/cửa sổ/đèn/zone. Save cũ của world này sẽ không nạp được nữa, nên **tăng contentVersion** (Inspector → World) trước khi phát hành. Dời, đổi màu, đổi kích thước thì không cần: save cũ vẫn giữ trạng thái cửa/loot/đèn.

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

3. Chơi trong game (dev): `http://localhost:5173/?world=<worldId>`. World khác `neighborhood-50` dùng slot save riêng (`slot-world-<id>`). `neighborhood-50` là map mặc định của game (không cần `?world=`) và dùng save thật `slot-1`.
   - **Không thấy thay đổi sau khi unpack?** Tắt `npm run dev` (Ctrl+C) rồi chạy lại. Dev server chạy lâu, nhất là sau khi các thư mục trong `content/maps/` bị tạo/xóa, có thể bỏ lỡ sự kiện "file đổi" và tiếp tục phục vụ JSON cũ; tải lại trang không đủ vì cache nằm ở server. Cách kiểm tra: console dev `__runtime.map.contentVersion` phải bằng số trong `world.json`.
4. Commit thư mục `content/maps/<worldId>/`. Muốn sửa tiếp: Mở… → content trong repo; hoặc `npm run map:pack -- content/maps/<worldId>` rồi Import.

> **Sửa `neighborhood-50` (world chính đang phát hành).** Save thật của người chơi (`slot-1`) và các bước migrate save cũ v1–v7 gắn với đúng tập cửa/tủ/cửa sổ/đèn/zone của khu phố. Thêm, bỏ hoặc đổi tên những thứ đó (ví dụ đặt thêm một nhà có cửa) sẽ làm save hiện có bị từ chối và làm fail các test migrate/tương đương trong `npm test`. Đó là thay đổi nội dung cần một content migration, chưa có công cụ. Để thử nghiệm, hãy làm trên **world mới**: mở `neighborhood-50` → **Lưu thành…** (`worldId` khác) rồi mới sửa; hoặc Mới → Trống / Sinh bằng generator. Lỡ export `neighborhood-50` đã sửa thì `map:unpack -- neighborhood-50.mappack.json --world-id <id-mới>`. Chỉ dời, xoay, đổi màu, đổi kích thước (giữ nguyên tập ID) mới là sửa tương thích.

## 6. Sinh world bằng generator

```bash
npm run map:generate -- --seed 42 --blocks 2x2 --world-id town-42      # → content/maps/town-42/
npm run map:generate -- --seed 42 --blocks 3x3 --pack town.mappack.json # pack để Import vào editor
npm run map:generate -- --seed 42 --blocks 2x2 --dry                    # chỉ in tóm tắt
```

- Cùng seed + số khối + thư viện prefab + phiên bản generator ⇒ cùng file. Trong editor: Mới → *Sinh bằng generator* cho ra đúng kết quả đó.
- World sinh ra là nội dung bình thường: sửa tay, chơi thử, export như trên.
- Generator **không ghi đè** world đã sửa tay (kể cả khi có `--force`). Muốn sinh lại thì dùng `--world-id`/`--out` khác.

## 7. Quy tắc cần nhớ

- **ID là vĩnh viễn**:
  - dời, xoay, sửa không đổi ID; kéo qua chunk khác vẫn giữ ID;
  - nhân bản tạo ID mới;
  - ID đã xóa không bao giờ được cấp lại (`retiredIds`, `retiredLocalIds`).
- **Sửa prefab gốc** thì mọi instance đổi theo; muốn biến thể thì **Nhân bản** prefab.
- Vùng chơi luôn là hình vuông tâm (0, 0).
- Hai mặt đường khác màu chồng nhau sẽ nhấp nháy trong game (cảnh báo `surface-overlap`).
