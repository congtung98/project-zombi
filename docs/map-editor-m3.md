# Map editor M3: editor MVP

Ngày 25/09/2026. Thực hiện M3 của `docs/Map_Editor_Implementation_Plan.md` theo thứ tự đã chốt: R3a (M1+M2, 86ce472) → R3b (09112e2) → **M3**. Save **không đổi (v8)**; nội dung khu phố không đổi. Định dạng dữ liệu: `docs/map-content-format.md`.

## 1. Kết quả

Editor là một trang riêng: `npm run dev` rồi mở **`/editor.html`**. Build riêng bằng `npm run build:editor` (ra `dist-editor/`). Bản build game (`npm run build`, chỉ `index.html`) không chứa mã editor hay generator; `npm run check:bundle` kiểm tra điều này.

| Vùng | Nội dung |
|---|---|
| Thanh trên | Mới, Mở… (content trong repo + bản nháp), Lưu nháp (Ctrl+S), Import…, Export, Hoàn tác/Làm lại, Snap (1 / 0,5 / 0,25 m / OFF), Nhìn trên xuống ↔ isometric (Tab), nút Validate (số lỗi/cảnh báo), chấm ● khi có thay đổi chưa lưu |
| Trái | Palette prefab của world (tìm theo tên/ID, kích thước footprint) |
| Giữa | Viewport Three.js orthographic: lưới 1 m, biên + nhãn chunk, vùng chơi (đỏ), record vẽ từ **cùng resolver với game** (tường, cửa, cửa sổ, container, sàn, đường, zone, spawn; không vẽ mái/ánh sáng/nhân vật) |
| Phải | Inspector: ID (chỉ đọc), chunk sở hữu, chunk định danh (khi khác), tọa độ world X/Z, Y, xoay, kích thước, màu, tên, loot table (chỉ bảng đã đăng ký), bán kính zone, "Đặt làm điểm xuất phát"; khi không chọn gì là thuộc tính world (tên, contentVersion…) |
| Dưới | Bảng Validate (click một lỗi → chọn record và focus camera), thanh trạng thái (thông báo, tọa độ con trỏ + chunk) |

**Thao tác**: click chọn (Shift+click chọn nhiều, click chỗ trống bỏ chọn); kéo để di chuyển (xem trước bằng chính lệnh Move, thả mới ghi, **một lần kéo = một mục lịch sử**); đặt prefab: chọn trong palette → bóng mờ theo con trỏ (đã snap) → R xoay 90° (Shift+R ngược) → click; Esc thoát; phím mũi tên dịch một bước snap; R xoay công trình đang chọn; Delete xóa; Ctrl+D nhân bản; Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z; F focus vùng chọn (hoặc cả world); chuột phải/giữa kéo để pan, lăn để zoom quanh con trỏ. Phím tắt không chạy khi đang gõ trong ô nhập.

## 2. Kiến trúc

```text
src/map/editor/          (thuần TS, import đuôi .ts, chạy được trong Node/CLI và test)
  document.ts            MapDocument = world + prefabs + chunks + extras (file khác của thư mục world, giữ nguyên);
                         tìm record, neo world, externalRefs dẫn xuất, resolvedRecords (cache theo object chunk), world trắng
  commands.ts            place / move / setAnchor / rotate / delete / duplicate / updateRecord / updateWorld
  session.ts             lịch sử: mỗi mục giữ document + selection trước/sau; undo/redo; lệnh mới xóa nhánh redo; tối đa 200
  pack.ts                content pack (export/import), validateDocument, documentFromFiles
  picking.ts             chọn record nhỏ nhất dưới con trỏ, snap
src/editor/              (React, chỉ có ở entry editor.html)
  editorStore.ts         zustand: EditState + phiên (tool, snap, view, preview, trạng thái, hộp thoại)
  Viewport.tsx, RecordView.tsx, Inspector.tsx, Panels.tsx, fields.tsx, interaction.ts, drafts.ts, EditorApp.tsx, main.tsx
```

- **Document là nguồn dữ liệu duy nhất**, bất biến: mỗi lệnh trả document mới dùng chung các chunk không đổi (test khẳng định chunk không đụng tới giữ nguyên object). Scene Three.js dẫn xuất từ document; không lưu gì trong scene. Camera, selection, tool, snap là phiên, không bao giờ vào file export.
- **Một đường dựng map**: viewport vẽ output của `resolveChunk` (resolver runtime); validate dùng `checkWorldDocuments` (bản không ném lỗi của `loadWorldDocuments`, cùng validator với game và `map:check`). Không có bộ luật cửa/collider/tọa độ thứ hai.
- **Lệnh là hàm thuần** `document → { document, selection } | lỗi`. Lỗi không đổi document. Lịch sử lưu cặp document trước/sau nên undo/redo khôi phục đúng dữ liệu, identity và selection. Inspector đi qua cùng các lệnh (một lần Enter/blur = một mục).
- `externalRefs` là dữ liệu dẫn xuất: sau mỗi lệnh được tính lại (`withExternalRefs`), nên record vượt biên luôn có đúng tham chiếu.

## 3. Quy tắc identity (theo docs/map-content-format.md §4)

- Di chuyển, xoay, sửa thuộc tính **không đổi ID**. ID và vị trí ngang không sửa được qua `updateRecord` (vị trí ngang phải đi qua lệnh Move để quyền sở hữu luôn đúng).
- **Kéo qua biên chunk**: record chuyển sang file chunk đích và **giữ ID** (đoạn chunk trong ID là chunk định danh — quyết định M1). Thanh trạng thái báo rõ `Đổi chunk sở hữu (ID giữ nguyên): <id>: c0_0 → c-1_0`; Inspector hiện cả chunk sở hữu và chunk định danh. Điểm đích ngoài mọi chunk của world thì lệnh bị chặn (tạo chunk mới là M4).
- **Đặt / nhân bản** tạo ID mới `<chunk đích>/<tên>-<n>` (nhân bản bỏ hậu tố số: `pillar-1` → `pillar-3`), bỏ qua tên đang dùng, tên dành riêng và ID đã xóa.
- **Xóa** đưa ID vào `world.retiredIds` (mới, tùy chọn, sắp xếp); validator báo lỗi `retired-id-reused` nếu record sống dùng lại ID đó. Undo xóa khôi phục cả record lẫn danh sách retired. Spawn người chơi của manifest không xóa được.
- Đổi bố cục mà không tăng `contentVersion` → cảnh báo riêng của editor `content-changed-same-version` (save cũ của world đó sẽ lệch ID). Tăng ở Inspector → World.

## 4. Lưu, import/export, đưa vào game

- **Lưu nháp**: IndexedDB riêng `zombie-outbreak-editor` (store `drafts`, khóa = worldId, giá trị = pack + thời điểm lưu). Editor không mở database `zombie-outbreak` của game (kịch bản trình duyệt kiểm tra `indexedDB.databases()`). Nháp được mở lại kể cả khi còn lỗi cấp world (đang làm dở), nhưng mỗi file phải qua kiểm tra riêng của nó.
- **Export**: một file `<worldId>.mappack.json` = `{ format: "zombie-outbreak/map-pack", formatVersion: 1, worldId, files: { "world.json", "prefabs/…", "chunks/…", "migrations/…" } }`, thứ tự ổn định (world, prefab và chunk theo manifest, extras theo đường dẫn), mỗi file định dạng như trên đĩa (`formatJson`). Không có camera/selection/thời điểm. **Export bị chặn khi còn lỗi.**
- **Import**: parse + validate toàn bộ trước; pack hỏng, sai format, đường dẫn thoát thư mục (`../`) hay có lỗi validate → từ chối, document đang mở giữ nguyên, lỗi hiện trong bảng Validate.
- **Đưa vào repo** (trình duyệt không ghi vào `src/`/`content/`): `npm run map:unpack -- <pack.json> [--out content/maps/<id>] [--force]` — validate lại, cần `--force` để ghi đè world có sẵn, file có dữ liệu không đổi thì không ghi lại (file migration đóng băng giữ nguyên từng byte), file trên đĩa mà pack không liệt kê chỉ được báo, không xóa. Chiều ngược lại: `npm run map:pack -- content/maps/<id> [out.json]`.
- **Chơi thử output** (dev): world trong `content/maps/<id>` chơi được bằng `/?world=<id>`; save dùng slot riêng `slot-world-<id>`, không đụng `slot-1`. Production bỏ qua tham số này. (Play From Here thật sự từ editor là M6.)

## 5. Khác với kế hoạch

| Kế hoạch | Thực tế | Lý do |
|---|---|---|
| `src/map/editor/` chứa cả editor | Lõi thuần ở `src/map/editor/`, UI React ở `src/editor/` | Lõi chạy được trong Node (CLI unpack/pack, test) giống phần còn lại của `src/map` |
| Export JSON/ZIP | Một file JSON (pack) | Không cần thêm dependency; CLI tách ra đúng cấu trúc thư mục |
| Dirty + cảnh báo khi đóng | Có (chấm ●, `beforeunload`, xác nhận khi Mới/Mở/Import) | — |
| Duplicate "có thể cuối M3" | Có | — |
| Tool Move preview | Xem trước = kết quả thật của lệnh Move trên document tạm | Preview và commit không thể lệch nhau |
| "Chặn re-home âm thầm" | Re-home được phép nhưng **không âm thầm**: giữ ID, báo trên thanh trạng thái, Inspector hiện chunk định danh | Mô hình ID của M1 (cách 1) đã tách định danh khỏi chunk sở hữu |
| Không dùng lại ID đã xóa | `world.retiredIds` + lỗi validate `retired-id-reused` | Cần nhớ ID đã xóa qua nhiều phiên/export, không chỉ trong một phiên |
| Đặt prefab | Chỉ prefab (instance). Object rời, đường, zone, spawn mới: M4 | Theo phạm vi M3/M4 của kế hoạch; record có sẵn thuộc mọi loại vẫn chọn/di chuyển/sửa/xóa/nhân bản được |

## 6. Kiểm chứng

- **Unit** (`src/map/editor/editor.test.ts`, 18 test): mở khu phố (0 lỗi, giữ 2 file migration); mỗi file export **trùng từng byte** với file trên đĩa (file migration trùng dữ liệu); export → import giữ nguyên toàn bộ; pack hỏng/sai owner/đường dẫn `../` bị từ chối; lỗi cấp world bị từ chối khi import nhưng được giữ khi mở nháp; đặt/di chuyển trong chunk/qua biên (ID giữ, externalRefs đúng, chunk khác dùng chung)/chặn ra ngoài world/xoay/xóa + retired/nhân bản/sửa thuộc tính (chặn đổi ID và vị trí ngang); lịch sử place→move→rotate→delete, undo về đúng document ban đầu (cùng object), redo, lệnh mới xóa redo, lệnh lỗi không đổi gì; chọn record; cache resolve; **runtime nạp pack do editor tạo qua loader thật và chạy `GameRuntime` 600 tick** (cửa và container của nhà mới có trong WorldState).
- `npm test`: **414 pass** (+9 skip), chạy 3 lần liên tiếp. Test thời gian `navTiles` (R3b) từng rớt một lần khi 48 worker chạy song song — nay lấy min của 3 lần đo mỗi tuyến, ngưỡng giữ 8 ms.
- `tsc -b`, `oxlint`, `npm run build`, `npm run build:editor`, `npm run map:check` sạch. `npm run check:bundle` → `dist: OK — 10 files, no editor/generator code`; chạy trên `dist-editor` thì thấy đủ marker (đối chứng rằng marker phát hiện được).
- CLI: pack khu phố → unpack đè lên chính nó = `0 file(s) written, 10 unchanged`; unpack ra thư mục mới → `map:check` OK.
- **Trình duyệt** (`scripts/m3-editor-browser.mjs`, Chromium SwiftShader, dev) PASS: mở (33 record, 0 lỗi) → đặt nhà dân với bóng mờ + R → kéo 2 m (1 mục lịch sử) → kéo đống phế liệu qua biên x = 0 (owner c0_0 → c-1_0, ID giữ) → đổi tên ở Inspector → Delete/R trong ô tìm kiếm không có tác dụng → xóa/hoàn tác/làm lại → đưa spawn zombie vào tường cửa hàng: `spawn-blocked` chặn Export, click lỗi chọn đúng spawn → Lưu nháp, tải lại trang, mở nháp giống hệt → Export → Import giống hệt → pack sai bị từ chối, document giữ nguyên → chỉ có database `zombie-outbreak-editor` → **World mới trong editor, đặt nhà an toàn, Export, `map:unpack`, mở game `/?world=m3-browser-test`, New Game**: cửa + 3 container của nhà mới có trong runtime, người chơi ở spawn (2, 2), không có `slot-1`. Không lỗi console. Kịch bản xóa world tạm khi xong.
- Hồi quy game: dev `p2-s2` (migrate v7/v3/v2/v1 → v8, slot-1) và `p2-vision`; production `p2-s5`, `p2-lighting`: PASS. Soak nằm trong `npm test` (gameplay không đổi).

## 7. Giới hạn, việc sau

- Chưa tạo/xóa chunk, chưa đặt object rời/đường/zone/spawn mới, chưa layer ẩn/khóa (M4). Chưa sửa prefab (M5). Chưa Play From Here, kiểm tra chồng collider/khả năng đi tới, generator trong editor (M6).
- Chưa có kéo chọn vùng (marquee); chọn nhiều bằng Shift+click.
- Viewport vẽ mỗi hộp một mesh (khu phố ~200); đủ cho world vài chunk, world lớn cần batch như `StaticBatches`.
- Validate chạy lại toàn world sau mỗi lệnh (vài ms với 4 chunk).
- `retiredIds` chỉ tăng; ID xóa trước M3 (không có) không được theo dõi.
- Editor chưa đổi `contentVersion` từng chunk/prefab (chỉ của world); save chỉ so `contentVersion` của world.
