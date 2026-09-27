# World generator WG2: mặt đường, vỉa hè, giao lộ, khối và lô đất

Ngày 27/09/2026. Sprint thứ hai của World Map Generator (`docs/writing-block.md`, quyết định Q1–Q9 ở `docs/world-generator-wg1.md` §0). Nhánh `feature/world-generator`.

- Lộ trình: WG1 → **WG2** → WG3 thư viện prefab + đặt prefab → WG4 tích hợp editor → WG5 môi trường, lưu trữ, hiệu năng → WG6 ảnh tham chiếu + vẽ tay.
- **Không đổi**: game, editor, schema map (v1), save (v9), `content/maps/`.
- WG2 thêm lớp `plan` (tùy chọn) vào WorldLayout, planner thuần trong `src/map/layout/`, một CLI và phần xuất world "chỉ layout" bằng các record hiện có.

## 1. Tiêu chí nghiệm thu

| # | Tiêu chí | Kết quả |
|---|---|---|
| B1 | Mạng đường đã nắn → mặt đường bằng `RoadRecord` hiện có; mỗi phố thẳng là một dải, liền qua giao lộ; chỉ chồng nhau ở ô giao lộ, cùng mặt và cùng lớp; bề rộng theo làn/tag; đường đất nằm lớp dưới mặt nhựa | Đạt (`streets.test.ts`) |
| B2 | Vỉa hè theo đúng phía của tag (trái/phải theo chiều way), khép kín góc giao lộ và góc cua, không nằm trên mặt đường, không chồng nhau; game tự sinh vạch giữa và bó vỉa | Đạt (test + ảnh game) |
| B3 | Giữ kết nối: mọi điểm trên tim đường của mọi cạnh đã nắn đều nằm trên mặt đường; đường vào nối đúng hai cạnh | Đạt (kiểm độc lập trong test) |
| B4 | Sinh đường vào khu dân cư cho khối quá sâu | Đạt: hẻm service 3,5 m |
| B5 | Lô có ID, đa giác, zone, vùng đặt được, lối ra đường, hướng quay mặt nhà, seed, trạng thái khóa; không phải lô nào cũng để xây | Đạt: `lot` / `open` / `interior` |
| B6 | Lô không chồng đường, vỉa hè, vùng cấm xây hay lẫn nhau, và nằm trong vùng | Đạt (kiểm độc lập trong test) |
| B7 | Kích thước lô cấu hình được: khu dân cư Việt Nam và ngoại ô Mỹ | Đạt: profile `default`, `vn-urban`, ghi đè theo zone |
| B8 | Tất định; đổi seed chỉ đổi đường cắt lô; giữ nguyên lô đã khóa; sinh lại một khối không đổi phần còn lại; ID khối không phụ thuộc lô khóa | Đạt |
| B9 | Xuất world chỉ layout, validator sạch, mở được trong editor, chơi được | Đạt: 0 lỗi, 0 cảnh báo; chạy được trong runtime test và trình duyệt |
| B10 | 500 × 500 m dưới 3 s | Đạt: 0,17–0,22 s lập kế hoạch + 0,04–0,06 s xuất world |
| B11 | Không hồi quy | Đạt (mục 6) |

Collision và nav: đường trong game **không có collider** (`Roads.tsx`: "chỉ để định hướng bằng mắt"), nên zombie đi được mọi chỗ không có vật cản như trước. World sinh ra chạy qua NavGrid và runtime của game mà không phải sửa gì (có test).

## 2. Kiến trúc

| File | Vai trò |
|---|---|
| `rects.ts` | Công cụ hình chữ nhật (hiệu, gộp dải, giao) và `CellGrid`: lưới nén trên đúng các cạnh hình chữ nhật, nên tô ô, loang và tách lại thành hình chữ nhật đều chính xác |
| `streets.ts` | **RoadNetworkGenerator** (hình học): cạnh đã nắn + đường vào → mặt nhựa/đất/vỉa hè |
| `parcels.ts` | **ParcelGenerator**: raster vùng cấm, tách khối, xác định mặt tiền, chia lô |
| `plan.ts` | Điều phối (`planLayout`, `replan`), profile, đường vào, tự kiểm (`checkPlan`) |
| `layoutWorld.ts` | **WorldSerializer** chế độ chỉ layout: kế hoạch → `MapDocument` (world.json + chunk) |
| `preview.ts` | Preview SVG vẽ thêm lô (màu theo zone, vạch hướng ra đường, viền xanh khi khóa) và mặt đường |
| `scripts/map-tools/layout-plan.ts` | CLI `npm run layout:plan` |

Tái sử dụng:
- `RoadRecord` với quy tắc màu → mặt (`roadSurface`), `layer`;
- `roadDetails` của G4: tự vẽ vạch và bó vỉa;
- `withExternalRefs` / `documentFiles` / `checkWorldDocuments` / `exportPack` / `parsePack`;
- `loadWorld` + `GameRuntime` (test);
- `pointInOutline`, `signedArea`, `quantize`, chunk.

## 3. Mặt đường (`streets.ts`)

- **Mặt đường xe chạy**: mỗi đoạn song song trục thành một hình chữ nhật rộng bằng bề rộng đường.
  - Đầu đoạn gặp đoạn vuông góc (giao lộ hoặc góc cua) được kéo dài thêm nửa bề rộng đường kia, nên phủ kín ô giao lộ. Đầu cụt không kéo.
  - Các đoạn thẳng hàng cùng bề rộng gộp thành một dải chạy qua mọi giao lộ.
  - Kết quả là ít record: lưới 21 × 21 phố chỉ có 42 dải. Hai dải chỉ chồng nhau đúng ô giao lộ, cùng màu và cùng lớp. UV tính theo tọa độ world nên phần chồng vẽ ra y hệt, không nhấp nháy. Validator không cảnh báo (chỉ cảnh báo khi khác màu cùng lớp). Vạch giữa của game tự bỏ qua ô giao lộ.
- **Màu và lớp** (`SURFACE_STYLE`):

| Mặt | Màu | Lớp | Game đọc là |
|---|---|---|---|
| Nhựa | `#3a3a3f` | 2 | asphalt |
| Đất | `#8a6a45` | 1 | dirt |
| Vỉa hè | `#a19d94` | 0 | concrete |

  - Đường đất (`track`, `surface=unpaved`) nằm dưới mặt nhựa ở chỗ gặp nhau.
- **Vỉa hè**:
  - Mỗi đoạn có dải vỉa hè ở phía `sidewalk` của tag, trái/phải theo chiều đi của way (đi về +X thì bên phải là +Z).
  - Rộng theo profile: `default` arterial 2,5 / collector 2,2 / local 1,8 / service 1,2 m; `vn-urban` 4 / 3,5 / 3 / 1,5 m; hoặc `--sidewalk` đặt chung.
  - Dải được kéo dài qua góc giao lộ, rồi trừ đi mọi mặt đường, nên góc khép kín và vỉa hè không bao giờ nằm trên đường.
  - Dải dọc X được đặt trước; dải dọc Z trừ thêm các dải đã có, nên vỉa hè không chồng nhau.
  - Game tự sinh bó vỉa ở mép vỉa hè giáp mặt nhựa.
- **ID**: `asphalt|dirt|sidewalk-<hash 8>` của hình chữ nhật, kèm danh sách cạnh mà mảnh phục vụ.

## 4. Khối, lô, đường vào (`parcels.ts`, `plan.ts`)

1. **Vùng** = khung bao mạng đã nắn + `margin` 24 m (đường ngoài cùng cũng có lô phía ngoài), làm tròn ra mét. Đây là vùng chơi của world xuất ra.
2. **Vùng cấm xây** (Q8): polygon nước/cấm xây và đường sông/đường sắt (có bề rộng) được chuyển sang khung world, rồi raster ô `restrictedCell` 2 m theo kiểu bảo thủ. Ô bị tính khi tâm nằm trong, hoặc cách biên không quá nửa đường chéo ô.
3. **Khối**:
   - vùng trừ mặt đường, vỉa hè và vùng cấm, tách thành các mảnh liên thông 4 hướng trên lưới nén; mỗi khối được lát kín bằng các hình chữ nhật;
   - mảnh hẹp dưới 3 m không thành lô (`sliver-land`);
   - ID `block-<hash>` chỉ phụ thuộc đường và vùng cấm, không phụ thuộc lô khóa.
4. **Tách theo mặt tiền**: hình chữ nhật được cắt tại chỗ đường bắt đầu hoặc kết thúc dọc một cạnh, nên dãy lô không bao giờ chạy quá đầu phố.
5. **Mặt tiền**:
   - một cạnh là mặt tiền khi ≥ 50 % dải ngay ngoài nó là đường hoặc vỉa hè, và có đoạn tim đường song song gần nhất;
   - cạnh đó cho `access { edge, side, frontage, roadClass }`, và `side` là hướng nhà nên quay ra.
6. **Chia lô** theo profile của zone tại tâm hình chữ nhật:
   - dãy bắc/nam trải hết chiều ngang, cột đông/tây nằm giữa hai dãy;
   - độ sâu dãy = độ sâu mục tiêu; phần còn lại nông hơn độ sâu tối thiểu thì dãy lấy hết;
   - mỗi dãy cắt theo mặt tiền mục tiêu, trong khoảng [min, max], lệch ±15 % theo seed, cắt ở bội số 0,5 m;
   - phần bên trong còn lại thành lô `interior`, không có lối ra, được gộp khi xếp thẳng hàng;
   - zone không chia (forest, farmland, empty) giữ một lô `open` cho mỗi hình chữ nhật.

| Profile | residential (mặt tiền / sâu, m) | commercial | industrial | public |
|---|---|---|---|---|
| `default` (vừa prefab hiện có) | 11–15–20 / 14–22–30 | 12–18–30 / 14–24–34 | 20–32–50 / 20–34–50 | 20–36–60 |
| `vn-urban` (nhà ống, vỉa hè rộng) | 4–5–7 / 12–16–22 | 4–6–9 / 14–18–24 | 15–25–40 / 20–30–45 | 20–30–50 |

   Có thể ghi đè từng zone bằng `params.zones`.
7. **Đường vào khu dân cư**:
   - áp dụng cho hình chữ nhật residential/commercial giáp đường ở hai cạnh đối diện, và đủ chỗ cho 3 lần độ sâu lô cộng bề rộng hẻm;
   - thêm hẻm service 3,5 m (không vỉa hè) qua giữa, chiều dài nhất, từ tim đường bên này sang tim đường bên kia;
   - lặp tối đa 3 lượt, không bao giờ cắt qua lô giữ lại;
   - hẻm được lưu ở `accessRoads`, tách khỏi đường nguồn (đường sinh ra, có `joins`).
8. **Lô**:
   - ID `lot-<hash>` của hình chữ nhật;
   - `buildable` = lô thụt vào `inset` 0,5 m (setback của từng prefab áp ở WG3);
   - `seed` = FNV(seed, id) cho WG3;
   - `locked: false`.
9. **Sinh lại**:
   - `replan(layout, planCũ, params, blocks?)` giữ **nguyên văn** các lô `locked`, và khi có `blocks` thì giữ mọi lô ngoài các khối đó;
   - lô giữ lại được trừ khỏi khối trước khi chia;
   - lô giữ lại mà nay chồng đường, vùng cấm hoặc ra ngoài vùng sẽ bị báo lỗi `kept-parcel-conflict`, không âm thầm bỏ.
10. **Tự kiểm** (`checkPlan`, lỗi = lỗi planner hoặc layout đã đổi): `parcel-overlap`, `parcel-on-street`, `parcel-on-restricted`, `parcel-outside`, `street-gap` (tim cạnh/hẻm không nằm trên mặt đường). Cảnh báo `lot-off-street`. Info: `access-roads`, `sliver-land`, `block-no-access`, `kept-parcels`.

## 5. Cách dùng

```sh
npm run layout:import -- khu-pho.geojson --id khu-pho --out khu-pho.layout.json
npm run layout:plan -- khu-pho.layout.json --svg khu-pho.svg --pack khu-pho.mappack.json --world-id khu-pho
# tùy chọn: --seed 1  --profile default|vn-urban  --sidewalk <m>  --margin 24  --no-access
#           --blocks <block-id>,…  (chỉ chia lại các khối này)   --reset (bỏ kế hoạch cũ và các khóa)   --out <file>
npm run map:unpack -- khu-pho.mappack.json --out content/maps/khu-pho   # rồi chơi với ?world=khu-pho
```

- Kế hoạch được ghi vào file layout (tại chỗ, trừ khi có `--out`).
- File đã có kế hoạch thì được lập lại và giữ lô khóa.
- `--pack` ghi world chỉ layout:
  - mặt đường, hàng rào biên, điểm xuất phát ở giao lộ gần tâm;
  - `generator { name: world-layout, params: { layout, mode: layout-only, profile, source, attribution? } }`, nên câu ghi công OSM đi theo world;
  - chưa có nhà, zone zombie, spawn zombie (WG3).
- Khóa lô: hiện sửa `locked: true` trong file. Editor bật/tắt khóa ở WG4.

## 6. Kiểm chứng

- **Test** (25 test mới):
  - `streets.test.ts` (7): giao lộ 2 dải chồng đúng 36 m², vỉa hè không chồng đường/nhau và kín 4 góc, gộp dải qua joint, phía vỉa hè theo chiều way, T hở một phía, góc cua trong/ngoài, đường đất/nhiều làn, ID ổn định;
  - `plan.test.ts` (18): kế hoạch fixture không lỗi/cảnh báo, bất biến kiểm độc lập (không chồng nhau, không trên đường/vùng cấm, trong vùng, kết nối, lô chạm đường, buildable trong lô), zone và lô không xây, không sửa layout, khứ hồi file và validator, tất định, seed chỉ đổi lô, giữ lô khóa, sinh lại một khối, lô giữ lại xung đột, đường vào, `vn-urban`, ghi đè zone và zone mặc định, từ chối layout không hợp lệ, 500 m, world chỉ layout (validator sạch, không `surface-overlap`, màu → mặt, pack khứ hồi, `loadWorld` + `roadDetails` có vạch và bó vỉa + `GameRuntime` chạy 300 tick, người chơi đứng trên mặt nhựa).
- `npm test`: **788 pass** (+10 skip, 3 file skip; trước WG2 là 763). `tsc -b`, oxlint, build, build:editor, check:bundle (không có code generator trong game), map:check sạch.
- **Số đo** (Node, máy này):

| Thị trấn | Kế hoạch | Kết quả |
|---|---|---|
| Fixture | ~30 ms | 29 dải nhựa, 73 vỉa hè, 7 khối, 174 lô (129 mặt tiền, 5 đất trống, 40 bên trong) |
| Siêu khối 200 × 160 m, `default` | | 10 hẻm, 142 lô, 4 bên trong |
| Siêu khối 200 × 160 m, `vn-urban` | | 10 hẻm, 408 lô nhà ống |
| Lưới dày 500 m (21 × 21 phố, 31°) | 173–223 ms (+38–57 ms xuất world) | 42 dải nhựa, 1604 vỉa hè, 401 khối, 536 lô, 324 chunk |

- **Trình duyệt** (Chrome GPU, Vite dev, world fixture xả tạm vào `content/maps/wg2-browser-test`, đã xóa sau khi xem):
  - game `?world=`: 102 mặt đường. Giao lộ có vạch giữa đứt đoạn bỏ qua ô giao lộ, vỉa hè kín góc, bó vỉa, không nhấp nháy ở ô chồng; đi bộ trên phố bình thường;
  - editor Import pack: 0 lỗi, 0 cảnh báo; mặt đường là record thường, sửa được;
  - không có lỗi console.
- **Hồi quy**: không file nào của game/editor/nội dung bị sửa. Chỉ sửa `schema.ts` (thêm `plan?`), validator layout (kiểm `plan`), preview, và thêm file mới.

## 7. Giới hạn và phần của sprint sau

- **Số record mặt đường**: vỉa hè khoảng 4 mảnh mỗi khối (lưới dày 500 m: ~1650 record). `Roads.tsx` của game vẽ mỗi record một mesh, có frustum culling nên chỉ phần trong khung nhìn tốn draw call. Gộp batch mặt đường theo chunk để ở WG5.
- **Cầu/hầm** vẽ phẳng như giao lộ (`crossing-kept`), chưa có hình học cầu.
- Vạch sơn chỉ có vạch giữa của game. Chưa có vạch làn nhiều làn, một chiều, vạch dừng hay vạch qua đường.
- Lô là hình chữ nhật. Khối không vuông được lát bằng nhiều hình chữ nhật. Đường bậc thang cho ra các lô nhỏ theo bậc.
- Zone của lô lấy theo tâm lô, profile lấy theo tâm hình chữ nhật của khối. Một hình chữ nhật trải hai zone dùng chung một cỡ lô.
- Hẻm chỉ thêm cho residential/commercial giáp đường hai đầu. Chưa có ngõ cụt hay vòng quay xe. Nhiều lượt có thể thành lưới hẻm nhỏ trong khối rất lớn.
- Vùng cấm raster 2 m theo kiểu bảo thủ, nên lô có thể lùi thêm tới ~1,4 m khỏi bờ sông hay đường sắt.
- World xuất ra có file cho mọi chunk trong vùng, kể cả chunk rỗng. Chưa có nhà, zone và spawn zombie (WG3: chế độ FULL).
- Kế hoạch chưa hiện trong editor. Sửa tay trên world xuất ra chưa truy ngược về layout (WG4: generated/modified/locked).
