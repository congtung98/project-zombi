# Chọn world trong game + khu phố đóng băng cho test

Ngày 26/09/2026. Sprint chen giữa M9 và M10: map làm bằng editor hoặc generator giờ chơi được từ menu chính của game, không cần gõ `?world=` trên URL.

- Save **không đổi (v8)**; nội dung `neighborhood-50` không đổi.
- Schema map vẫn v1; `world.json` thêm trường tùy chọn `listed`.

## 1. Cách dùng

1. Đưa map vào repo: `npm run map:unpack -- <file>.mappack.json` (Export từ editor) hoặc `npm run map:generate -- …`. Kết quả nằm ở `content/maps/<worldId>/`.
2. Mở game, cả dev (`npm run dev`) lẫn bản build. Menu chính hiện **World: <tên>**, và nút **Đổi world** khi có từ hai world trở lên.
3. **Đổi world** mở danh sách world, mỗi dòng có tên, `worldId`, kích thước vùng chơi và bản lưu của world đó. Bấm **Chơi** thì game tải lại trên world đó.
4. Game nhớ lựa chọn (localStorage `zombie-outbreak.world`), nên lần mở sau vào thẳng world đó. Chọn lại *Khu phố 50 m* để trở về mặc định.

- **Mỗi world có một bản lưu riêng**:
  - `neighborhood-50` vẫn dùng `slot-1`, nên save cũ của người chơi giữ nguyên;
  - world khác dùng `slot-world-<worldId>`;
  - đổi world không xóa bản lưu nào.
- **Ẩn world khỏi menu**: đặt `"listed": false` trong `world.json`, hoặc bỏ chọn ô *Hiện trong menu game* ở Inspector World của editor.
  - `neighborhood-50-lab` được ẩn theo cách này.
  - Bản dev vẫn liệt kê world ẩn, có ghi chú "(ẩn, chỉ dev)".
  - World ẩn vẫn mở được bằng `?world=`.
  - **Lưu thành…** và `map:unpack --world-id` luôn cho ra world hiện trong menu.
- **`?world=<worldId>`** giờ chạy được cả ở bản build, và được ưu tiên hơn lựa chọn đã lưu, nhưng **chỉ cho lần mở đó**.
  - Ở dev, world không tồn tại hoặc lỗi nội dung sẽ ném lỗi như trước.
  - Ở bản build, game quay về khu phố và hiện thông báo.
- **World đã chọn không còn hoặc bị lỗi** (đã xóa khỏi `content/maps`, nội dung sai): game chơi khu phố, hiện thông báo vàng trên menu một lần rồi quên lựa chọn đó. Không bao giờ ra trang trắng.

## 2. Cài đặt

- `src/game/world/worldChoice.ts` (thay `devWorld.ts`):
  - `selectWorld` là logic thuần: thứ tự ưu tiên URL → lựa chọn đã lưu → mặc định, và cách xử lý khi world không còn hoặc lỗi;
  - `menuWorlds` quyết định world nào hiện, thứ tự (mặc định trước, rồi theo tên), và world ẩn chỉ hiện ở dev hoặc khi đang chơi nó;
  - `startupWorld` được `runtime.ts` gọi một lần để dựng runtime;
  - `switchWorld` lưu lựa chọn rồi tải lại trang. Nếu localStorage bị chặn thì đưa world vào URL thay thế.
- Phải tải lại trang vì runtime singleton (vật lý, nav, scene) được dựng trên một map. Thứ tự trong `initialMap`: playtest của editor → door lab / stress (chỉ dev) → `startupWorld`.
- `src/map/content.ts`:
  - `bundledWorldCatalog()` chỉ đọc `world.json` thô (tên, `listed`, vùng chơi), không resolve;
  - world được chọn mới được nạp và validate.
- `uiStore`:
  - `saveSlotForWorld`;
  - `worlds` (`WorldOption` kèm trạng thái save), `worldNotice`, `refreshWorlds`, `chooseWorld`;
  - save của world khác chỉ được đọc để tóm tắt, không migrate. Migrate xảy ra khi Continue trên chính world đó.
  - Trong playtest của editor, danh sách world rỗng nên menu không hiện dòng world.
- Menu (`Menus.tsx`): `WorldLine`, `WorldsPanel`. CSS `.world-line`, `.world-list`.
- Schema, validator, editor:
  - `WorldDocument.listed?: boolean` (validator: phải là boolean);
  - `updateWorld` chỉ ghi `listed` khi ẩn (mặc định là hiện, không ghi khóa);
  - `forkDocument` bỏ `listed`;
  - checkbox trong Inspector World.
- Bản build vẫn gói mọi JSON trong `content/maps/`, kể cả world ẩn.

## 3. Khu phố đóng băng cho test

- `src/test/fixtures/maps/neighborhood-50/` là bản sao của `content/maps/neighborhood-50/` lúc sprint này.
- File content được tách ra `src/map/bundledFiles.ts`. Vitest trỏ module này sang `src/test/bundledFiles.ts` (alias trong `vite.config.ts`), là các world thật nhưng thay `neighborhood-50` bằng bản đóng băng.
- Nhờ vậy test game và editor khẳng định ID, vị trí, loot của **bản đóng băng**. Sửa khu phố thật (kèm migration M8) không làm vỡ các test đó. Đã thử dời 3 tủ của nhà an toàn và đổi tên world thật: 502/502 test vẫn pass. Trước đây thay đổi kiểu này làm khoảng 30 test fail.
- `src/map/liveContent.test.ts` vẫn kiểm tra content thật:
  - mọi world trong `content/maps` nạp được;
  - world mặc định có mặt và đang hiện trong menu;
  - world lab bị ẩn;
  - bản đóng băng thay đúng từng file và không lẫn file của bản thật.

  `npm run map:check -- --deep` vẫn chạy trên content thật.
- `editor.test.ts` (round-trip từng byte) đọc bản đóng băng.
- Game và editor không bao giờ import fixture: `check:bundle` có thêm marker `src/test/fixtures`.
- Muốn test theo khu phố mới: copy lại thư mục vào `src/test/fixtures/maps/` rồi sửa các test khẳng định nội dung.

## 4. Kiểm chứng

- **Unit**:
  - `worldChoice.test.ts` (8): thứ tự ưu tiên, quay về mặc định, `?world=` nghiêm ngặt ở dev, danh sách menu, catalog, trường `listed` (validator, lệnh editor, fork);
  - `liveContent.test.ts` (7).
- `npm test`: **502 pass** (+10 skip). `tsc -b`, `oxlint`, `build`, `build:editor`, `check:bundle`, `map:check -- --deep` sạch.
- **Trình duyệt** `scripts/worlds-browser.mjs` (dev) PASS:
  - `map:generate` tạo world tạm, và world đó hiện trong menu cạnh khu phố; world lab hiện kèm "(ẩn, chỉ dev)";
  - chọn world tạm: trang tải lại, slot save riêng (`slot-1` và `slot-world-…` cùng tồn tại);
  - tải lại trang vẫn giữ lựa chọn; `?world=` ghi đè chỉ một lần;
  - quay về khu phố thì Continue vào đúng save cũ;
  - world đã lưu nhưng đã bị xóa: quay về khu phố, hiện thông báo một lần.
- **Hồi quy** PASS: editor m3, m6, m8, m9 (`?world=`, playtest, save theo world); game p2-s5, p2-s2, p2-vision.
