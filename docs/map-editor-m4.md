# Map editor M4: world authoring

Ngày 25/09/2026. Thực hiện M4 của `docs/Map_Editor_Implementation_Plan.md`, sau M3 (08a3559). Save **không đổi (v8)**, nội dung khu phố không đổi. Schema map vẫn là v1; phần thêm vào đều không bắt buộc (zone `shape: "rect"`). Định dạng dữ liệu: `docs/map-content-format.md`.

## 1. Kết quả

Palette bên trái có các tab **Prefab · Object · Nền · Zone · Spawn · Chunk**, bên dưới là panel **Layer**.

| Tab | Nội dung | Đặt |
|---|---|---|
| Prefab | Công trình như M3 | click; R xoay 90° |
| Object | Tường, hàng rào gỗ, thùng gỗ, xe hỏng, cột bê tông, khối vật cản, đống phế liệu (loot `scrap-pile`), thùng dụng cụ (loot `park-toolbox`), thùng rỗng (container) | tường/hàng rào: kéo để định chiều dài theo trục kéo nhiều hơn, độ dày giữ nguyên; khối vật cản: kéo khung; còn lại: click |
| Nền | Đường nhựa, vỉa hè, đường đất, sân sỏi (record `roads`: mặt phẳng tô màu, không collider) | click = kích thước mẫu, kéo = khung |
| Zone | Zone zombie chữ nhật (kéo khung), zone zombie tròn (nhấn ở tâm, kéo ra bán kính) | |
| Spawn | Spawn zombie, spawn người chơi (đặt làm điểm xuất phát ở Inspector) | click |
| Chunk | Danh sách chunk kèm trạng thái; click ô trống viền xám quanh world trong viewport để **thêm chunk**, click chunk có sẵn để chọn; **Xóa chunk** khi chunk không còn sở hữu record; **Khớp vùng chơi với chunk** | |

- **Trạng thái chunk**: viền và nhãn trong viewport (xanh = như lúc mở/lưu, cam ● = đã sửa, đỏ ✕ = có lỗi validate trong file chunk đó); panel Chunk ghi số record sở hữu, số tham chiếu (`externalRefs`), đã sửa, số lỗi/cảnh báo. Mọi chunk của document đều được nạp trong editor, nên không có trạng thái "chưa nạp".
- **Layer** (chỉ trong phiên editor, không bao giờ vào file export hay game): Công trình, Tường / vật cản, Container, Nền / đường, Zone, Spawn zombie, Spawn người chơi. **Ẩn** = không vẽ, không chọn được; **Khóa** = vẫn vẽ, không chọn/kéo được. Ẩn/khóa một layer bỏ record của nó khỏi vùng chọn; undo/redo không đưa chúng quay lại vùng chọn; click lỗi Validate trên record thuộc layer ẩn/khóa chỉ báo trên thanh trạng thái.
- **Chọn**: click; Shift+click thêm/bớt; **kéo từ chỗ nền trống** = khung chọn (lấy record nằm trọn trong khung, Shift để cộng thêm); Ctrl+A chọn hết (trừ layer ẩn/khóa). Zone chỉ bắt click ở **viền** (±0,75 m) hoặc **tâm** (1 m), nên click/kéo trong sân không túm cả zone. Đường vẫn chọn được ở mọi điểm: khóa layer Nền khi muốn kéo khung trên đường.
- **Xoay** (R hoặc nút "Xoay 90°"): công trình xoay quanh pivot; hộp, mặt nền và zone chữ nhật song song trục nên xoay lẻ = đổi kích thước X/Z quanh tâm; spawn, zone tròn và khối vuông không đổi nên bị bỏ qua (không tạo mục lịch sử rỗng).
- **Inspector**: zone chữ nhật sửa kích thước X/Z, zone tròn sửa bán kính, mỗi zone hiện số spawn zombie thuộc nó; spawn zombie hiện "Thuộc zone" theo đúng luật của game. World: kích thước vùng chơi, bật/tắt và chỉnh hàng rào biên.

## 2. Kiến trúc

```text
src/map/editor/
  presets.ts      mẫu record của palette (template không có ID/neo) + presetPlacement (click/kéo → neo + kích thước)
  commands.ts     + placeRecord, rotateRecords (thay rotateInstances), addChunk, removeChunk, fittedPlayAreaSize;
                  updateWorld nhận thêm playArea, boundary
  layers.ts       LAYERS, layerOf(record), isHidden/isEditable (thuần, test được)
  picking.ts      zone chỉ bắt ở viền/tâm; recordsInRect (khung chọn)
  document.ts     + chunkStatuses (record, ref, đã sửa, lỗi theo đường dẫn file)
src/game/world/zones.ts   zoneContains, zoneFor: luật gán zone dùng chung cho runtime và validator (không import runtime,
                          nên Node CLI `map:check` chạy được)
src/editor/               tab palette, panel Chunk/Layer, công cụ chunk, khung chọn, kéo để định kích thước
```

- Mọi thao tác mới đều là lệnh thuần `document → document` qua cùng lịch sử (một lần kéo/click = một mục; thêm/xóa chunk hoàn tác được). Layer, tab, chunk đang chọn, khung chọn là trạng thái phiên.
- Record đặt từ palette có khóa theo đúng thứ tự file content (`kind, objectId, name, position, size, color, lootTableId`…), nên file export giữ phong cách diff như file viết tay.
- **Thêm chunk** ghi vào cuối manifest: thứ tự content (và thứ tự runtime của mọi thứ đã đặt) không đổi; `chunkBounds` nới ra; record đang lấn vào ô đó nhận tham chiếu ngay. **Xóa chunk** chỉ khi chunk không sở hữu record và không phải chunk cuối cùng; `chunkBounds` thu về vừa khít.
- Record đặt/kéo ra ngoài mọi chunk vẫn bị chặn như M3; thông báo chỉ sang tab Chunk.

## 3. Zone và nối vào runtime

- Schema: `zones[]` là union `{ shape: "circle", radius }` | `{ shape: "rect", size: [x, z] }` quanh `center` (neo sở hữu vẫn là `center`). Chỉ có `kind: "zombiePopulation"`, loại duy nhất có consumer (lang thang + di cư của horde). Các loại `safeSpawn/residential/commercial/forest/event` trong kế hoạch **không thêm** vì game chưa có hệ thống nào đọc chúng.
- Resolver: zone chữ nhật → `ZoneDef.halfSize` (+ `radius` = bán kính bao ngoài).
- **Luật gán zone** (`zoneFor`): điểm nằm trong một hay nhiều zone chữ nhật thuộc zone chữ nhật **nhỏ nhất** chứa nó (hòa: thứ tự map); nếu không thì thuộc zone có **tâm gần nhất** (luật S5). Map chỉ có zone tròn như khu phố giữ nguyên hành vi (soak không đổi). `horde.nearestZone` gọi luật này, nên spawn, respawn và migrate save v5 → v6 đều dùng chung.
- **Lang thang**: zone chữ nhật chọn điểm đều trong hình chữ nhật với đúng hai lần rút RNG như zone tròn (nhánh zone tròn không đổi).
- Validator có thêm hai **cảnh báo**: `zone-assignment` (spawn zombie nằm trong một zone nhưng theo luật lại thuộc zone khác) và `surface-overlap` (hai mặt nền khác màu chồng nhau: cùng độ cao nên nhấp nháy trong game).

## 4. Vùng chơi

Vùng chơi vẫn là **hình vuông tâm (0, 0)**, vì NavGrid, mặt đất, hàng rào biên và kiểm tra túi đồ rơi trong save đều giả định vậy. Editor cho sửa kích thước và nút **Khớp vùng chơi với chunk** (`fittedPlayAreaSize`: hình vuông tâm gốc phủ mọi chunk, trừ lề 2 m mỗi cạnh; world 2 × 2 → 60 m như M3, thêm cột chunk phía đông → 124 m). Với lưới chunk lệch một phía, vùng chơi phủ cả phần không có chunk: đó là mặt đất trống, muốn đặt đồ ở đó thì thêm chunk. Cho vùng chơi là hình chữ nhật lệch tâm là thay đổi runtime/save, để sau.

## 5. Khác với kế hoạch

| Kế hoạch | Thực tế | Lý do |
|---|---|---|
| Layer Terrain, Road riêng | Một layer "Nền / đường"; không có terrain | Mặt đất là một mặt phẳng cấp world (M1 đã chốt, `docs/map-content-format.md` §6); nền/đường đều là record `roads` |
| Zone MVP gồm nhiều loại | Chỉ `zombiePopulation` (tròn + chữ nhật) | Chỉ loại có consumer mới được đưa vào |
| Zone có thể giới hạn trong một chunk | Zone vượt biên được, sở hữu theo tâm + `externalRefs` như mọi record | Cơ chế ownership có từ M1, không nhân bản zone |
| Trạng thái chunk loaded/modified/invalid | modified/invalid (+ số record/ref) | Editor luôn nạp mọi chunk; streaming chưa có |
| Kéo liên chunk tuân thủ chính sách identity | Như M3: giữ ID, báo đổi chunk sở hữu | Quyết định M1 (cách 1) |

## 6. Kiểm chứng

- **Unit** `src/map/editor/world.test.ts` (20 test): thêm chunk (cuối manifest, bounds, chia sẻ chunk không đổi, trùng/chỉ số lẻ bị chặn), xóa chunk (còn record bị chặn, chunk cuối bị chặn, bounds thu lại), đặt ngoài chunk bị chặn tới khi thêm chunk, undo thêm chunk về đúng document, khớp vùng chơi, trạng thái chunk; **nhà vượt biên x = 32** giữa hai chunk mới: một owner + một tham chiếu, `MapData` có đúng một cửa/một building, `ChunkLifecycle` nạp/gỡ từng chunk theo mọi thứ tự không thêm hai lần (listener added/removed đúng một lần), kéo hẳn sang một chunk bỏ tham chiếu và giữ ID; mọi preset đặt ra record hợp lệ với ID `<chunk>/<namespace>/<tên>-<n>` và thứ tự khóa của file content; kích thước khi kéo (tường theo trục, khung, bán kính, click); xoay đổi X/Z; luật `zoneFor`; **zone chữ nhật chạy trong `GameRuntime`** (zombie được gán vào zone, 40 điểm lang thang đều nằm trong zone, 600 tick); cảnh báo `zone-assignment`, `surface-overlap`; layer, zone chỉ bắt ở viền/tâm, khung chọn; **world nhiều chunk do editor tạo** (2 chunk mới, nhà an toàn vượt biên, đường, hàng rào, đống phế liệu có loot, zone chữ nhật, spawn, zone tròn) → export → import → loader thật → `GameRuntime` 900 tick.
- `npm test`: **434 pass** (+9 skip), gồm soak (khu phố chỉ có zone tròn: số liệu không đổi). `tsc -b`, `oxlint`, `npm run build`, `npm run build:editor`, `npm run map:check` sạch. `npm run check:bundle` thêm marker cho preset/layer M4: `dist` OK, `dist-editor` phát hiện đủ.
- **Trình duyệt** `scripts/m4-editor-browser.mjs` (Chrome headless SwiftShader, dev) PASS với chuột thật trên viewport: khóa Container → click không chọn đống phế liệu; ẩn Công trình → click không chọn nhà; khung chọn lấy đúng 2 cột; world mới → tab Chunk thêm `c1_0`, `c1_-1` (bounds, ● đã sửa) → khớp vùng chơi 124 m → đặt nhà ở x = 32 (owner `c1_0`, `c0_0` tham chiếu) → kéo đường 4 × 80, hàng rào 8 m, đặt đống phế liệu, kéo zone chữ nhật 10 × 14, đặt spawn zombie (Inspector: thuộc `c1_0/zones/zone-1`) → R xoay hàng rào → kéo nhà sang hẳn phía đông (tham chiếu mất), hoàn tác → xóa chunk: có record thì nút tắt, chunk rỗng xóa được, hoàn tác → Export → `map:unpack` → `/?world=m4-browser-test` → New Game: vùng chơi 124 m, đúng một cửa nhà, zone có `halfSize {5, 7}`, zombie ở spawn đó thuộc zone chữ nhật, có đống phế liệu và hàng rào; không lỗi console.
- Hồi quy: `scripts/m3-editor-browser.mjs` PASS (click nền trống giờ mở khung chọn, click không kéo vẫn bỏ chọn); game dev `p2-s5-browser.mjs` PASS.

## 7. Giới hạn, việc sau

- Vùng chơi chỉ là hình vuông tâm gốc (mục 4).
- Mặt nền chồng nhau khác màu vẫn nhấp nháy trong game (chỉ có cảnh báo, chưa có thứ tự vẽ).
- Chưa đổi kiểu object (tường ↔ vật cản ↔ container) trong Inspector; chưa kéo tay cầm để đổi kích thước trong viewport (sửa số ở Inspector hoặc đặt lại bằng kéo).
- Viewport vẫn vẽ mỗi hộp một mesh; world nhiều chunk lớn cần batch như `StaticBatches`.
- Sửa prefab (M5); Play From Here, kiểm tra collider chồng/đi tới được, generator (M6).
