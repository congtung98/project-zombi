# World generator WG3: thư viện prefab, metadata placement, đặt công trình, chế độ FULL

Ngày 27/09/2026. Sprint thứ ba của World Map Generator (`docs/writing-block.md`, quyết định Q1–Q9 ở `docs/world-generator-wg1.md` §0). Nhánh `feature/world-generator`.

- Lộ trình: WG1 → WG2 → **WG3** → WG4 tích hợp editor → WG5 môi trường, lưu trữ, hiệu năng → WG6 ảnh tham chiếu + vẽ tay.
- **Không đổi**: save (v9), `contentVersion` và nội dung của các world hiện có, runtime game.
- **Có thêm** vào hệ thống sẵn có:
  - trường tùy chọn `placement` của prefab (schema + validator);
  - `PrefabPatch.placement` cho lệnh `updatePrefab` của editor;
  - world ẩn `content/maps/prefab-library`;
  - một sửa lỗi trong kiểm tra sâu (mục 5).

## 1. Tiêu chí nghiệm thu

| # | Tiêu chí | Kết quả |
|---|---|---|
| C1 | Mở rộng Prefab Registry hiện có bằng metadata, không tạo hệ prefab mới (Q6): footprint, allowedZones, weight, setback, entrance (và category, road-facing, collision bounds, điểm neo trang trí) | Đạt: `PrefabDocument.placement`; footprint sẵn có là khung va chạm |
| C2 | Thư viện prefab là world ẩn; có 3–5 prefab tạm dựng bằng công cụ prefab hiện có | Đạt: `listed: false`, 10 prefab. 4 prefab mới dựng bằng `createPrefab` / `placePrefabItem` / `updatePrefabItem` / `updatePrefab` |
| C3 | Thuật toán đặt theo §8: chọn lô → prefab hợp zone → kiểm footprint → vị trí và hướng quay → va chạm → lối ra đường → sinh instance → ghi metadata | Đạt: `fitPrefab`, `placeBuildings`, `parcel.build` |
| C4 | Không co giãn công trình cho vừa lô; không đổi đường khi thay prefab | Đạt (test) |
| C5 | Người dùng thay được prefab trên một lô | Đạt: `setParcelPrefab` / `--set-prefab`, kiểm độ vừa, lệch zone thì cảnh báo |
| C6 | Không phải lô nào cũng có nhà | Đạt: tỉ lệ bỏ trống theo zone; lô `open`/`interior` không bao giờ có nhà |
| C7 | Cùng seed, layout, phiên bản generator và thư viện → cùng world; ID ổn định | Đạt: instance `<chunk>/<lot-id>`, zone `<chunk>/zones/<block-id>` |
| C8 | LAYOUT_ONLY / FULL_GENERATION / SELECTIVE_REGENERATION; lô khóa được bảo vệ; sửa tay được bảo vệ mặc định (Q2) | Đạt: `--mode`, `--regen-parcels`, `--regen-chunks`; lô khóa không bao giờ đụng tới; công trình chọn tay (`source: manual`) được giữ qua `replan` và qua sinh lại hàng loạt |
| C9 | World FULL hợp lệ, mở được trong editor, chơi được; mọi cửa/tủ/spawn tới được | Đạt: validator sạch; kiểm tra sâu không có `interaction-unreachable` / `spawn-unreachable` / `collider-overlap`; runtime chạy 600 tick có zombie; trình duyệt OK |
| C10 | Lô Việt Nam và ngoại ô Mỹ (Q5) | Đạt: nhà ống 4 × 14 m xây sát ranh trên lô `vn-urban`; nhà ngoại ô chỉ vào lô ≥ 9 m nhờ khoảng `frontage` |
| C11 | Không hồi quy | Đạt (mục 6) |

## 2. Metadata placement (`src/map/schema.ts`)

```ts
placement?: {
  category: 'house' | 'shop' | 'industrial' | 'public' | 'outbuilding'
  allowedZones: LandUseZone[]    // residential, commercial, industrial, public, forest, farmland, empty
  weight: number                 // > 0, tỉ lệ chọn giữa các prefab vừa lô
  setback: number                // sân trước tối thiểu từ mép lô giáp đường (m)
  sideGap: number                // khoảng hở hai bên (m); 0 = nhà liền kề xây sát ranh
  roadFacing: boolean            // xoay để cửa chính quay ra đường
  entrance?: { x, z }            // mặc định: cửa đầu tiên ở tầng trệt
  frontage?: [min, max]          // dải bề rộng lô hợp với prefab (vd. nhà ống [4, 8])
  anchors?: { name, position }[] // điểm neo trang trí (WG5 dùng)
}
```

- Chỉ generator đọc trường này: game bỏ qua, không đổi ID, collider, loot hay save.
- `footprint` sẵn có là khung va chạm mà generator giữ trong lô.
- `LAND_USE_ZONES` chuyển về schema map để prefab và layout dùng chung; layout re-export.
- Validator:
  - `category` / zone lạ là lỗi `schema`;
  - `weight` ≤ 0, `setback` / `sideGap` âm, `frontage` sai dạng là `out-of-range` hoặc `schema`;
  - `anchors` cần tên dạng slug.
- Editor: `updatePrefab(doc, id, { placement })` kiểm hợp lệ, sắp zone theo thứ tự chuẩn, `null` để gỡ. Giao diện Inspector cho trường này thuộc WG4.

## 3. Thư viện prefab (`content/maps/prefab-library`)

World ẩn gồm 6 × 2 chunk với một phố showroom. Mỗi prefab đặt một lần, quay cửa ra phố, nên mở world trong editor là xem và sửa được toàn bộ thư viện. Dựng lần đầu bằng `node scripts/map-tools/prefab-library.ts`; sau đó thư viện là nội dung, sửa trong editor, `--force` để dựng lại từ đầu.

| Prefab | Nguồn | category | zone | frontage | setback / sideGap | weight |
|---|---|---|---|---|---|---|
| `building/house` 9 × 7 | neighborhood-50 | house | residential | 9–40 | 3 / 1,5 | 3 |
| `building/safehouse` 8 × 8 | neighborhood-50 | house | residential | 9–40 | 3 / 1,5 | 1 |
| `building/lab-house` 12 × 9, 2 tầng | graphics-lab | house | residential | 9–40 | 3 / 1,5 | 2 |
| `building/two-storey` 10 × 8 | floors-lab | house | residential | 9–40 | 3 / 1,5 | 1,5 |
| `building/lab-garage` 7 × 6 | graphics-lab | outbuilding | residential, industrial | 8–30 | 2 / 1 | 0,5 |
| `building/store` 12 × 8 | neighborhood-50 | shop | commercial | 12–60 | 1 / 1 | 3 |
| **`library/corner-shop`** 14 × 10 | mới | shop | commercial | 15–60 | 1 / 1 | 2 |
| **`library/warehouse`** 22 × 14 | mới | industrial | industrial | 24–80 | 4 / 2 | 2 |
| **`library/clinic`** 16 × 12 | mới | public | public | 18–80 | 3 / 2 | 1 |
| **`library/tube-house`** 4 × 14 | mới | house | residential, commercial | 4–8 | 0 / 0 | 3 |

Bốn prefab mới dựng bằng lệnh của editor, nên cấu trúc giống hệt prefab làm tay:

| Prefab | Dựng từ | Nội dung |
|---|---|---|
| Tiệm góc phố | nhà mẫu 14 × 10 | 2 cửa sổ mặt tiền, 3 kệ hàng, 2 tủ lạnh, quầy |
| Nhà kho | nhà mẫu 22 × 14 | cửa rộng, 3 kệ vật tư/đồ nghề, cụm garage, thùng các-tông |
| Trạm y tế | nhà mẫu 16 × 12 | vách ngăn có cửa, phòng chờ và phòng khám mỗi phòng một đèn, 2 tủ thuốc loot `safehouse-cabinet`, giường, bàn, ghế |
| Nhà ống | nhà mẫu 4 × 14 | vách ngăn có cửa, phòng trước và bếp, tủ bếp, tủ quần áo |

Nhà ống rộng 4 m để tường và cửa luôn nằm trên lưới 0,5 m (xem §4).

## 4. Đặt công trình (`src/map/layout/buildings.ts`)

1. **Thư viện → catalog**: `prefabCatalog(id, prefabs)` giữ các prefab có `placement`, có `building` và có cửa chính. Mặt cửa chính lấy từ `entrance`, nếu không có thì lấy cửa đầu tiên ở tầng trệt.
2. **Lô**: chỉ lô `lot` có lối ra đường. Lô `open` / `interior` nhận `build: null`.
3. **Bỏ trống có chủ đích** (`DEFAULT_VACANCY`): residential 12 %, commercial 10 %, industrial 20 %, public 25 %; forest, farmland, empty luôn trống.
4. **Ứng viên**: prefab có zone của lô trong `allowedZones` và bề rộng lô trong `frontage`.
5. **Độ vừa** (`fitPrefab`):
   - xoay để cửa chính quay ra phía đường (`turnsBetween(entrance, access.side)`);
   - footprint giữ nguyên kích thước, không co giãn;
   - phải lọt giữa khoảng lùi trước, khoảng hở hai bên và 1 m phía sau;
   - vị trí: giữa mặt tiền, mặt trước ở đúng khoảng lùi.
6. **Lưới 0,5 m**:
   - Mép lô được thu vào lưới 0,5 m (bỏ lại dải ≤ 0,5 m sát vỉa hè; mặt tiền dò ở 0,6 m).
   - Pivot của nhà đặt trên lưới trong khoảng xê dịch mà các khoảng lùi cho phép. Không đặt được trên lưới thì coi là không vừa.
   - Lý do: kiểm tra sâu cho thấy nhà đặt lệch lưới (vd. x = 8,1) làm lưới dẫn đường 0,5 m của game không nối qua khe cửa, nên cả nội thất không tới được. Nhà đặt tay trong game luôn ở vị trí chẵn. Sau khi bám lưới, mọi cửa và tủ đều tới được.
7. **Chọn**: theo `weight` trong các prefab vừa, ngẫu nhiên tất định từ `hash(parcel.seed, "build:" + salt)`.
8. **Ghi lại** trên lô:
   - có nhà: `build = { prefabId, quarterTurns, position, footprint, source: generated | manual }`;
   - trống: `build = { prefabId: null, reason: vacant | no-prefab | no-fit | cleared, source }`;
   - `plan.catalog` ghi thư viện đã dùng (vd. `prefab-library@1`).
9. **Sinh lại có chọn lọc** (`placeBuildings(plan, catalog, opts)`):
   - không có lựa chọn: chỉ lô chưa quyết định (`build` chưa có);
   - `parcels`: các lô chỉ định, kể cả công trình chọn tay (vì đây là thao tác chủ động);
   - `chunks`: các lô có tâm trong chunk, bỏ qua công trình chọn tay;
   - lô khóa không bao giờ bị đụng tới;
   - `salt` đổi lựa chọn mà không đổi lô.
10. **Thay tay** (`setParcelPrefab`):
    - prefab phải có trong catalog và vừa lô (không co giãn; khoảng `frontage` chỉ là gợi ý cho generator);
    - zone không khớp thì cảnh báo `zone-mismatch`, vẫn cho phép;
    - lô khóa thì từ chối; `null` = dọn trống;
    - kết quả `source: manual`. Đường không bao giờ đổi.
11. **`replan` của WG2** giữ lô khóa và lô có công trình chọn tay (Q2), cùng công trình trên đó.
12. **Tự kiểm** (`checkBuildings`): `building-outside-parcel`, `building-on-street`, `building-overlap`, `entrance-not-facing-street`, `unknown-prefab`.

## 5. World FULL (`layoutWorld.ts`) và sửa lỗi kiểm tra sâu

- `buildLayoutWorld(layout, plan, { mode: 'full', catalog })` thêm vào world chỉ layout:
  - một instance cho mỗi lô có nhà (`<chunk>/<lot-id>`, neo ở pivot), chỉ chép các prefab được dùng;
  - một zone `zombiePopulation` cho mỗi khối, trên hình chữ nhật lớn nhất của khối, thụt 1 m, tên theo zone chính (Khu dân cư 1, Khu thương mại 1…); các zone rời nhau;
  - spawn zombie ngoài trời trong zone: 2–10 mỗi ha theo zone, 1–6 mỗi khối, cách footprint 0,8 m và không vướng collider thấp;
  - `generator.params.mode = full`, `generator.catalog = prefab-library@1`.
  Loot có sẵn trong tủ của prefab.
- **Sửa lỗi `analysis.ts`**: kiểm tra `zone-unreachable` so component của `NavWorld` (được đánh số lại khi world có cầu thang, M11b) với component của lưới tầng trệt. Trong world có nhà hai tầng, điều này báo sai mọi zone. Giờ hai phía dùng cùng `world.componentAt`. Các world hiện có vẫn sạch.

## 6. Cách dùng

```sh
npm run layout:import -- khu-pho.geojson --id khu-pho --out khu-pho.layout.json
npm run layout:plan -- khu-pho.layout.json --mode full --svg khu-pho.svg --pack khu-pho.mappack.json --world-id khu-pho
# sinh lại vài lô / vài chunk với lựa chọn khác:   --regen-parcels lot-…,lot-…   --regen-chunks c0_0,c1_0   --salt 2
# thay tay:                                        --set-prefab lot-…=library/clinic   --set-prefab lot-…=none
# thư viện khác:                                   --library <thư mục world>
npm run map:unpack -- khu-pho.mappack.json --out content/maps/khu-pho   # rồi ?world=khu-pho
```

- Công trình được ghi vào `plan` của file layout.
- Chạy lại mà không có tùy chọn kế hoạch thì giữ nguyên lô và công trình. Chỉ lô chưa quyết định mới được đặt nhà.
- Preview SVG vẽ footprint (nâu = sinh ra, xanh = chọn tay) và chấm vàng ở cạnh cửa chính.

## 7. Kiểm chứng

- **Test** (22 test mới, `buildings.test.ts`):
  - thư viện: hợp lệ, ẩn, kiểm tra sâu sạch, đủ category và zone, mặt cửa chính đúng; validator placement và `updatePrefab`;
  - `fitPrefab` trên 4 hướng: cửa quay ra đường, đúng khoảng lùi (+≤ 0,5 m do lưới), không co giãn, pivot trên lưới; lô hẹp hay nông thì từ chối; khoảng `frontage`; nhà ống sát ranh lô 4 m;
  - thị trấn thử: phần lớn lô có nhà, có lô trống, không nhà trên đất trống; bất biến `checkBuildings`; zone hợp lệ; tất định; salt không đổi lô và đường; sinh lại theo lô (lô khóa giữ nguyên, báo `parcel-locked`); theo chunk (bỏ qua chọn tay); thay tay (vừa lô, lệch zone, không vừa, prefab lạ, lô khóa); `replan` giữ công trình chọn tay; nhà ống trên `vn-urban`;
  - world FULL: số instance = số nhà, chỉ prefab dùng, zone và spawn; kiểm tra sâu sạch cho cả thị trấn thử và khu nhà ống sát ranh; runtime 600 tick có zombie; pack khứ hồi; lưới dày 500 m.
- `plan.test.ts` dò mặt tiền ở 0,6 m (mép lô trên lưới).
- `npm test`: **810 pass** (+10 skip, 3 file skip; trước WG3 là 788). tsc, oxlint, build, build:editor sạch.
- check:bundle: 6 world tải theo nhu cầu (thêm thư viện), không có code generator trong game.
- `map:check --deep`: mọi world sạch, trừ 2 cảnh báo `spawn-indoors` cũ của `neighborhood-50-lab`.
- **Số đo** (Node, máy này):
  - thị trấn thử: 92 nhà, 15 lô cố ý trống, 22 lô không vừa (lô nhỏ dọc đường bậc thang), 7 zone, 27 spawn; cả chuỗi kế hoạch + nhà khoảng 45 ms;
  - lưới dày 500 m: kế hoạch + nhà + world khoảng 1,1 s;
  - kiểm tra sâu thị trấn thử 0,4 s.
- **Trình duyệt** (Chrome GPU, world xả tạm vào `content/maps/wg3-browser-test`, đã xóa):
  - game: 92 nhà, 222 cửa, 350 tủ loot, 7 zone; nhà quay cửa ra phố, nhà hai tầng hiển thị đúng, cutaway và vùng nội thất tối hoạt động như world làm tay;
  - editor: 0 lỗi, 0 cảnh báo, danh sách prefab đếm instance;
  - không lỗi console.

## 8. Giới hạn và phần của sprint sau

- **Chưa có môi trường** (cây, hàng rào, xe, đèn đường): WG5 (`anchors` đã có chỗ).
- 22/129 lô của thị trấn thử không vừa prefab nào. Đó là các lô nhỏ hoặc nông dọc đường bậc thang và ở rìa. Thư viện nhiều cỡ nhà hơn sẽ giảm con số này.
- Thư viện nhỏ: một prefab cho public/industrial, chưa có nhà ống hai tầng. Thư viện là nội dung, thêm được trong editor.
- Zone zombie lấy hình chữ nhật lớn nhất của khối. Khối chữ L chỉ có zone trên một nhánh.
- Chưa có trạng thái generated/modified/locked trên record của world đã xuất, và chưa có nút trong editor để khóa, thay prefab, sinh lại lô hay xem kế hoạch: WG4. Hiện làm qua CLI và file layout.
- Theo Q3: chỉ sinh lại world chưa phát hành. Không có migration save cho world đã có người chơi.
