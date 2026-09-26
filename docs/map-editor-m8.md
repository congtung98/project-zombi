# Map editor M8: migration nội dung cho save

Ngày 26/09/2026. Sprint thứ hai sau kế hoạch M1–M6. Lộ trình: M7 hoàn thiện editor → **M8** → M9 generator nhiều biến thể + cây → M10 streaming chunk → M11 phòng đa giác + nhiều tầng.

**Mục tiêu**: đổi tập ID có trạng thái của một world đã phát hành (thêm, bỏ hoặc đổi tên cửa, container, cửa sổ, đèn, zone) mà save của người chơi vẫn nạp được. Trước M8, save như vậy bị báo `incompatible`.

- Save vẫn là **schema v8**: không thêm trường nào.
- Schema map vẫn v1; thêm file tùy chọn `migrations/content-v<N>.json`.
- Nội dung `neighborhood-50` không đổi.

## 1. Kết quả

| Việc | Cách dùng |
|---|---|
| **File migration nội dung** | `content/maps/<world>/migrations/content-v<N>.json`: tập ID có trạng thái của bản N + bảng đổi tên. Validator kiểm tra (`map:check`, editor) |
| **Editor: Tương thích save** | Inspector → World (không chọn gì): khác biệt so với bản đã phát hành, chọn "bỏ" hoặc "đổi tên thành" cho từng ID bị bỏ, nút **Tạo migration vN → vN+1** |
| **Game** | Continue với save của bản cũ: save được chuyển sang nội dung mới, bản gốc giữ ở `<slot>.backup-v8-content-v<N>`, hiện thông báo |
| **Save cũ v1–v7** | Qua bảng legacy tới nội dung v1, rồi qua chuỗi migration nội dung |

## 2. Định dạng (`src/map/contentMigration.ts`, thuần, chạy được trong Node)

```json
{
  "format": "zombie-outbreak/content-migration",
  "fromVersion": 1,
  "toVersion": 2,
  "ids": { "doors": [...], "containers": [{ "id": "…", "position": { "x": 0, "z": 0 } }], "windows": [...], "lamps": [...], "zones": [...] },
  "renamed": { "c0_0/house/lamp-living": "c0_0/house/lamp-lounge" }
}
```

- **Chỉ ghi những gì không suy ra được**: tập ID của bản N (để kiểm tra save của bản đó như với map của nó; container kèm vị trí cho túi đồ rơi) và việc đổi tên (ý định của người làm map).
- Bị bỏ và được thêm là hiệu giữa bản N và bản N+1 (`ids` của file kế tiếp, hoặc nội dung hiện tại). Nhờ vậy sửa tiếp sau khi tạo migration không làm file cũ đi; chỉ một phép đổi tên có đích biến mất mới thành lỗi.
- `planContentMigration` ghép các bước từ bản của save tới bản hiện tại: mỗi ID cũ ra một ID hiện tại (giữ hoặc đổi tên) hoặc `null` (bị bỏ dọc đường).
  - Ở mỗi bước, ID phải có mặt trong tập của bước sau. Vì ID đã xóa không bao giờ được cấp lại (`retiredIds`, `retiredLocalIds`), một ID bị bỏ ở bước giữa không thể "sống lại" thành thứ khác.
- `statefulIds(parts)` dùng chung cho `MapData` (game, `mapStatefulIds`) và record đã resolve (editor, validator), nên hai phía luôn khớp (có test).

## 3. Game: `migrateContent` (`src/game/systems/save.ts`)

Chạy khi save v8 có `contentVersion` nhỏ hơn nội dung hiện tại. Save mới hơn nội dung, hoặc thiếu một bước, thì báo `incompatible`.

1. **Kiểm tra** save với `ids` của bản của nó: cửa, container cố định, rèm, đèn phải khớp đúng; zone và cửa đang bị vây của zombie phải thuộc bản đó. Sai thì `corrupt`, bản gốc giữ nguyên.
2. **Chuyển**:
   - giữ hoặc đổi tên: trạng thái đi theo (cửa mở/HP, loot đã lấy, rèm, đèn, zone);
   - cửa mới ở trạng thái ban đầu, rèm mở, đèn tắt;
   - container mới có loot hash(worldSeed, id), giống New Game (`seedAddedContainers` như các bước v3/v5 cũ);
   - container bị bỏ: mỗi vật phẩm thành một túi `drop:<itemId>` ở chỗ tủ cũ, giống người chơi bỏ đồ xuống; ID vật phẩm và inventory không đổi;
   - zombie của zone bị bỏ theo luật `zoneFor` của runtime; zombie vây một cửa bị bỏ chuyển sang `SEARCH` vị trí nhớ được;
   - người chơi, zombie và túi đồ nằm trong vật cản mới (tường, container, kính cửa sổ, khoảng hở 0,45 m) được dời ra cạnh gần nhất rồi kẹp vào vùng chơi.
3. **Kiểm tra lại** như save của bản hiện tại. Kết quả có `migrated: true`, `contentFrom: N`.

Liên quan:
- `migrateV7` giờ đặt `contentVersion = LEGACY_CONTENT_VERSION (1)` cho save của khu phố: bảng legacy trỏ tới ID của nội dung v1.
- `uiStore` truyền map đang chạy (kể cả world `?world=`) cho `validateSaveGame` và `commitMigratedSave`. Trước đây world khác khu phố không được kiểm tra ID khi Continue.
- `backupSlotFor(slot, 8, N)` → `slot-1.backup-v8-content-vN`.
- Thông báo: "Bản đồ đã được cập nhật (nội dung vN → vM)…"; save cũ v1–v7 nhận cả hai thông báo.

## 4. Editor

- `src/map/editor/migration.ts`: `contentChanges`, `suggestRenames`, `writeContentMigration`, `setMigrationRename`, `migrationOf`. Mỗi thao tác là một lệnh, hoàn tác được.
  - `suggestRenames`: gợi ý khi trong cùng một cha (một nhà, một chunk) và cùng loại có đúng một ID bị bỏ và một ID được thêm, ví dụ đổi local ID của đèn trong prefab.
- `SaveCompat.tsx` (Inspector → World):
  - bản đã phát hành / đang sửa;
  - danh sách thêm/bỏ theo loại; ô chọn cho từng ID bị bỏ (mặc định theo gợi ý);
  - nút tạo migration; khi đã có file thì ô chọn sửa thẳng vào file.
- **Bản gốc để so sánh** (`baseline`):
  - mở từ repo: chính nó;
  - bản nháp hoặc Import của world đã có trong repo: **bản trong repo** (`publishedDocument`). Trước đây là bản nháp vừa mở, nên thay đổi đã nằm sẵn trong nháp không được tính;
  - world chưa phát hành (Mới, generator, Lưu thành…): không có, không cần migration.
- Cảnh báo `content-changed-same-version` nay chỉ tới panel này.

## 5. Validator

- `checkWorldDocuments` đọc `migrations/content-v<N>.json` với mọi N < `contentVersion`:
  - thiếu: `content-migration-missing` (cảnh báo: save vN sẽ không nạp được);
  - sai dạng: `content-migration` (lỗi);
  - đổi tên không khớp bản sau: `content-migration-rename` (lỗi; nguồn phải là ID bị bỏ, đích là ID mới cùng loại, mỗi đích một lần).
- Các bước hợp lệ nằm trong `WorldDocuments.contentMigrations`; `loadWorld` gắn vào `MapData.contentMigrations`.
- File migration là "extra" của document editor, nên pack/unpack/Export/Import mang theo. `forkDocument` (Lưu thành…) bỏ `migrations/…` như trước, vì world mới bắt đầu ở v1.

## 6. Khác với dự kiến

| Dự kiến | Thực tế | Lý do |
|---|---|---|
| Bảng migration liệt kê thêm/bỏ | Chỉ ghi tập ID bản cũ + đổi tên | Thêm/bỏ suy ra được; file không cũ đi khi sửa tiếp |
| Đồ trong tủ bị bỏ: mất | Rơi xuống đất tại chỗ | Không bao giờ mất vật phẩm của người chơi |
| Tự phát hiện đổi tên | Gợi ý + người làm map chọn | Đổi tên là ý định; chỉ gợi ý chỗ chắc chắn (một cặp trong cùng một nhà) |

## 7. Kiểm chứng

- **Unit** `src/map/editor/migration.test.ts` (8). Khu phố v2: thêm nhà, bỏ đống phế liệu và zone west, đổi tên đèn phòng khách trong prefab.
  - Khác biệt, gợi ý đổi tên, file migration (`ids` = `mapStatefulIds` của khu phố hiện tại), `contentVersion` 2, validator sạch, ghi lại và bỏ đổi tên được.
  - Từ chối đổi tên sai (ID còn giữ, khác loại, đích lạ); file sửa tay sai → `content-migration-rename`; tăng version không có migration → `content-migration-missing`.
  - Save v1 thật (runtime) → v2:
    - đèn đổi tên vẫn bật, cửa vẫn mở;
    - cửa của nhà mới ở trạng thái ban đầu; tủ mới có loot giống New Game;
    - đồ đống phế liệu nằm trong túi tại chỗ cũ, ID giữ nguyên; zombie của zone bị bỏ có zone mới;
    - nạp vào runtime, chạy, lưu lại thành save v2 thường.
  - Người chơi đứng trong tường nhà mới được dời ra.
  - Fixture legacy v1 và v7 → v2 (`contentFrom` 1).
  - Chuỗi v1 → v2 → v3 (đổi local ID cửa cửa hàng mà không ghi đổi tên: vây cửa → `SEARCH`); `planContentMigration` ghép đúng; từ chối save mới hơn, thiếu bước, ID lạ.
  - Tên slot backup; `statefulIds` và `mapStatefulIds` khớp với phía editor.
- `npm test`: **480 pass** (+10 skip). `tsc -b`, `oxlint`, `build`, `build:editor`, `map:check -- --deep`, `check:bundle` sạch.
- **Trình duyệt** `scripts/m8-editor-browser.mjs` (dev, IndexedDB thật) PASS:
  - tách khu phố thành world tạm bằng `map:unpack --world-id`;
  - chơi và lưu content v1 (đèn bật, cửa mở);
  - editor: đặt nhà từ palette, xóa đống phế liệu, đổi local ID đèn trong Inspector prefab. Panel hiện khác biệt, gợi ý đổi tên đã chọn sẵn → **Tạo migration** (v2, hết cảnh báo, 0 lỗi);
  - Export → `map:unpack --force` → Continue:
    - thông báo "nội dung v1 → v2"; đèn mới tên bật, cửa mở; 3 vật phẩm đống phế liệu nằm trong túi; cửa và đèn nhà mới ở trạng thái ban đầu;
    - slot ở v2, `…backup-v8-content-v1` giữ bản v1.
- **Hồi quy**: editor m3–m7, game p2-s5, p2-s2 (migrate v1/v2 qua IndexedDB thật), p2-lighting PASS; fixture không đổi.
- **Thử nghiệm** (đã hoàn tác): ghi một bản v2 hợp lệ vào `content/maps/neighborhood-50` rồi chạy `npm test` → **30 fail**, trước M8 là 46.
  - Tất cả là test khẳng định nội dung cụ thể của khu phố: `house-scrap`, `lamp-living`, số tường/nhà, zone, fixture legacy chuyển đúng tới nội dung v1 từng byte.
  - Save của người chơi không còn là vấn đề, nhưng sửa khu phố thật vẫn phải cập nhật các test đó.

## 8. Còn lại

- Tách test game khỏi nội dung sống của khu phố (một bản đóng băng cho test) để sửa khu phố không kéo theo sửa test. Chưa làm, cần chốt cách.
- M9–M11 theo lộ trình.
