# Map editor M6: công cụ sản xuất

Ngày 25/09/2026. Thực hiện M6, milestone cuối của `docs/Map_Editor_Implementation_Plan.md`, sau M5 (c187992). Save **không đổi (v8)**, nội dung khu phố không đổi. Schema map vẫn v1; phần thêm vào là tùy chọn (`world.generator`). Hướng dẫn dùng từ đầu đến cuối: **`docs/map-editor-guide.md`**.

## 1. Kết quả

| Việc | Cách dùng |
|---|---|
| **Play From Here** | Thanh trên: **▶ Chơi từ đây** rồi click một điểm trong viewport, hoặc **▶ Từ spawn**; chọn giờ bắt đầu (06–00 h). Game thật mở trong một khung phủ lên editor; **← Về editor** đóng phiên chơi |
| **Kiểm tra sâu** | Bảng Validate → **Kiểm tra sâu**; CLI `npm run map:check -- --deep` |
| **Generator offline** | Editor: Mới → Kiểu "Sinh bằng generator" (seed, số khối). CLI: `npm run map:generate -- --seed 42 --blocks 2x2 [--world-id …] [--out …] [--pack …] [--force] [--dry]` |
| **Thumbnail** | Palette prefab có hình nhìn từ trên xuống (SVG) cho mỗi prefab |
| **Hướng dẫn** | `docs/map-editor-guide.md` (prefab → đặt → validate → chơi thử → export → đưa vào game) |

## 2. Play From Here

- **Kiến trúc**: runtime game là singleton, được dựng một lần lúc import với map cố định. Vì vậy playtest chạy ở trang riêng **`playtest.html`** (entry `src/playtest/main.tsx`) mở trong iframe, và mỗi lần chơi là một phiên game hoàn toàn mới. Editor gửi qua `postMessage` (cùng origin, kiểm tra nguồn gửi) một **bản chụp bất biến** gồm mọi file của document (`playtestFiles`, giống hệt nội dung Export), cùng điểm xuất phát và giờ.
- **Trình tự trong trang playtest**:
  1. Kiểm tra bản chụp bằng **loader thật** (`loadWorld`).
  2. Nếu lỗi: hiện danh sách lỗi và báo về editor; **không lùi về map khác**.
  3. Bật save trong bộ nhớ (`enableMemorySaveStorage`).
  4. Đặt `setPlaytestSession({ map, timeOfDay })` với `playerSpawn` = điểm đã chọn.
  5. Lúc này mới `import()` App/runtime/uiStore, rồi `startNewGame` và đặt giờ.
  - `runtime.initialMap()` ưu tiên phiên playtest; `uiStore` dùng slot `slot-playtest`.
- **Không chạm save thật**: khi bật chế độ bộ nhớ, `readSave/writeSave/deleteSave/commitMigratedSave` chỉ làm việc với một `Map`, nên database `zombie-outbreak` **không bao giờ được mở**. Kịch bản trình duyệt kiểm tra điều này bằng `indexedDB.databases()` sau khi đã Lưu game trong menu pause. Bản nháp không bị ghi.
- **Quay về editor**: editor vẫn được mount phía dưới khung chơi (viewport vẽ theo yêu cầu, không tốn khung hình). Kịch bản kiểm tra rằng sau khi đóng, document vẫn là **cùng một object**, vùng chọn, lịch sử và camera giữ nguyên. Phím tắt của editor tạm tắt trong lúc chơi.
- **Chặn trước khi chơi**: document còn lỗi validate, hoặc điểm xuất phát nằm ngoài vùng chơi hay trong collider (cùng luật `spawn-blocked` của validator: `blockingSolid`, khoảng hở 0,4 m).
- Bản chụp lấy **document đang sửa, chưa lưu**. Kịch bản kiểm tra: dời đống phế liệu 0,5 m mà không lưu, vị trí trong game là vị trí mới.
- Có trong bản build editor (`dist-editor/playtest.html`), đã kiểm tra bằng `vite preview`. Bản build game không chứa trang này (`check:bundle`).

## 3. Kiểm tra sâu (`src/map/analysis.ts`)

Không thêm bộ luật thứ hai: kiểm tra dựng `GameRuntime` trên map đã resolve, mở mọi cửa trong NavGrid, rồi dùng chính dữ liệu của game.

| Mã (cảnh báo) | Ý nghĩa | Nguồn luật |
|---|---|---|
| `interaction-unreachable` | Không có ô đi được nào (cùng vùng với spawn người chơi) nằm trong tầm tương tác mà nhìn thẳng tới được cửa/tủ/công tắc/rèm | `runtime.interactables` (bán kính như game), `INTERACT_RANGE`, `runtime.isBlocked` |
| `spawn-unreachable` | Spawn zombie không nối tới vùng người chơi | NavGrid `componentAt` |
| `spawn-indoors` | Spawn zombie trong nhà (respawn không bao giờ dùng) | `isInsideBuilding` (lề 0,5 như `pickSpawnPoint`) |
| `zone-unreachable` | Không có đất đi được gần tâm zone nối tới vùng người chơi | `nearestWalkableCell` + `componentAt` |
| `start-not-walkable` | Spawn người chơi không đứng trên ô đi được | NavGrid |
| `collider-overlap` | Hộp thấp (< 1,6 m) của **hai record khác nhau** chồng nhau > 0,05 m² (mỗi cặp báo một lần) | cùng các hộp của collider |
| `container-outside-room` | Tủ của một nhà có phòng nhưng tâm tủ không nằm trong phòng nào | `map.rooms` |

- Mọi kết quả là **cảnh báo** (nội dung vẫn hợp lệ). Mỗi mục có đường dẫn record và `entityId`, nên click trong bảng sẽ chọn đúng record. Kết quả ghi là "cũ" khi document đổi sau lần chạy.
- Khu phố: 0 cảnh báo; mọi world sinh ra trong test: 0 cảnh báo. Test dựng lỗi cố ý cho từng mã.
- **CLI**: `deepCheck` cần mã game (`import.meta.glob`, import không đuôi .ts), nên `scripts/map-tools/deep-check.mjs` nạp nó qua `vite.createServer().ssrLoadModule` (không cần dependency mới). `map:check -- --deep` chạy phần kiểm tra thường trước, rồi mới gọi phần này.

## 4. Generator (`src/map/tools/generator.ts`, `town-grid` v1)

- **Pipeline**:
  1. Seed (PRNG mulberry32 riêng).
  2. Đường quanh mỗi khối 28 m (đường rộng 4 m, cùng màu nên chỗ giao không nhấp nháy).
  3. 4 lô 14 × 14 m mỗi khối.
  4. Mỗi lô 15 % để trống; còn lại chọn prefab có trọng số (nhà dân ×2), lấy prefab đầu tiên vừa lô, **xoay để cửa hướng ra đường của lô** (`doorSide` + `turnsBetween`), đặt cách đường 2,5 m.
  5. Vật trang trí: hàng rào sau lô phía bắc, thùng gỗ ngoài footprint, đống phế liệu có loot, xe đỗ giữa hai ngã tư.
  6. Một zone chữ nhật cho mỗi khối.
  7. Spawn zombie: tối đa 2 mỗi khối, ở chỗ không vướng collider (`blockingSolid` trên các record đã resolve) và ngoài nhà.
  8. Spawn người chơi ở ngã tư gần gốc nhất.
  9. Validate: lỗi thì **ném exception**, không bao giờ xuất nội dung hỏng.
- **Tất định**: cùng options + catalog + `GENERATOR_VERSION` cho ra file giống từng byte (test, và kịch bản trình duyệt so pack export từ editor với `map:generate --pack`). Không dùng `Math.random`, thời gian hay thứ tự filesystem.
- **ID** suy từ bố cục (`lot-<i>-<j>-<k>`, `block-<i>-<j>`, `road-x-<k>`, `zombie-<i>-<j>-<n>`, `player-start`) dưới chunk sở hữu; không dựa vào chỉ số mảng.
- **Truy vết**: `world.generator = { name, version, seed, params, catalog }` (tùy chọn, có validate).
- **Không ghi đè bản sửa tay**: CLI từ chối ghi vào thư mục có sẵn nếu thiếu `--force`. Kể cả có `--force`, nó sinh lại world từ metadata đã ghi và chỉ ghi đè khi file trên đĩa **vẫn khớp** output gốc; đã sửa tay, không có metadata hoặc khác phiên bản generator thì từ chối (đã thử). Muốn sinh lại thì sinh ra thư mục mới; gộp vào world đã phát hành là việc riêng (diff + migration).
- Output là document bình thường: mở trong editor, sửa, Play, Export. Runtime chỉ nạp JSON đã xuất; bundle game không chứa generator.

## 5. Hiệu năng

**Node** (`PERF_SCENARIOS=1 npx vitest run src/map/editor/editor.perf.test.ts`, trung vị 5 lần, máy dev):

| World | Chunk | Record | Hộp | Pack | Validate | Resolve lạnh | Lệnh move | Export | Import | Kiểm tra sâu | loadWorld | Dựng GameRuntime |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| neighborhood-50 | 4 | 33 | 64 | 59 KB* | 0,6 ms | 0,1 ms | 0,15 ms | 14 ms* | 2,6 ms | 6,5 ms | 0,7 ms | 5,7 ms |
| sinh 2×2 | 16 | 62 | 239 | 38 KB | 1,0 ms | 0,7 ms | 0,3 ms | 4,2 ms | 1,8 ms | 15 ms | 2,1 ms | 15 ms |
| sinh 4×4 (132 m) | 36 | 223 | 998 | 81 KB | 2,9 ms | 1,1 ms | 0,3 ms | 8,6 ms | 4,2 ms | 46 ms | 2,7 ms | 40 ms |

\* gồm file migration đóng băng 1 885 dòng.

Generator: 9 ms (1×1) → 34 ms (4×4).

**Trình duyệt** (Chrome headless, SwiftShader = GPU phần mềm, không đại diện GPU thật): viewport editor với thị trấn 4×4 có **1 495 draw call**, 17,6 nghìn tam giác, ~35 ms/khung khi vẽ lại. Viewport chỉ vẽ khi có thay đổi (`frameloop="demand"`), nên tốn khi kéo/zoom chứ không tốn lúc đứng yên. Playtest dùng renderer của game (batch theo chunk R3b).

**Giới hạn thực tế**:
- Mọi thao tác dữ liệu đều dưới 10 ms tới cỡ 4×4 (36 chunk, ~1 000 hộp). Validate chạy lại toàn world sau mỗi lệnh, còn kiểm tra sâu chạy khi bấm.
- Nút thắt là viewport editor vẽ **mỗi hộp một mesh** (từ M3). Với world lớn hơn 4×4 hoặc máy yếu, nên gộp theo chunk như `StaticBatches` của game. Chưa làm.
- Không cam kết FPS: chưa đo trên GPU thật.

## 6. Khác với kế hoạch

| Kế hoạch | Thực tế | Lý do |
|---|---|---|
| Play From Here "trong editor" | Trang playtest riêng trong iframe | Runtime là singleton dựng lúc import; mỗi lần chơi cần một phiên mới. Editor vẫn mount, không mất trạng thái |
| Save test: namespace IndexedDB riêng hoặc bộ nhớ | Bộ nhớ | Không mở IndexedDB của game dù chỉ một lần |
| Kiểm tra reachability "nếu có dữ liệu nav" | Dùng NavGrid/interactable/LOS của game, CLI qua Vite SSR | Một bộ luật duy nhất |
| Zone "quá dày" | Không làm | Chưa có số liệu mật độ để đặt ngưỡng; có `zone-unreachable`, `zone-assignment` (M4) |
| Thumbnail + cache | SVG dựng từ resolver mỗi lần prefab đổi | Không cần WebGL hay lưu cache; luôn khớp nội dung |
| Generator: đường/lô → prefab → props/vegetation → zone/spawn | Như vậy, trừ cây cối | Chưa có asset cây; props là hộp tô màu |

## 7. Kiểm chứng

- **Unit**:
  - `src/map/editor/production.test.ts` (9): generator tất định/khác seed/metadata; 6 kích thước hợp lệ và kiểm tra sâu sạch; cửa hướng ra đường; world sinh ra mở, sửa được và chơi 900 tick; kiểm tra sâu của khu phố sạch; phát hiện tủ bị tường vây, spawn và zone trong chuồng kín, spawn trong nhà, collider chồng, tủ ngoài phòng; điểm xuất phát playtest; bản chụp bất biến giống Export.
  - `src/playtest/playtest.test.ts` (1): theo đúng trình tự của trang playtest, runtime được dựng trên map bản chụp, người chơi ở điểm chọn, "Lưu game" ghi vào `slot-playtest` trong bộ nhớ, `slot-1` trống, không cần IndexedDB.
  - `editor.perf.test.ts` (bỏ qua mặc định).
- `npm test`: **461 pass** (+10 skip), gồm soak. `tsc -b`, `oxlint`, `build`, `build:editor` (có `playtest.html`), `map:check`, `map:check -- --deep`, `check:bundle` (thêm marker playtest/generator/kiểm tra sâu: `dist` sạch, `dist-editor` phát hiện được) đều sạch.
- **Trình duyệt**: `scripts/m6-editor-browser.mjs` (dev) PASS:
  - thumbnail;
  - chặn điểm xuất phát trong tường;
  - Play From Here lúc 21:00 trên bản sửa chưa lưu: đi bằng phím thật, lưu trong menu pause, chỉ có database editor;
  - về editor: document, vùng chọn, lịch sử, camera giữ nguyên, không ghi nháp;
  - kiểm tra sâu: sạch, rồi đặt thùng vào tường → `collider-overlap`, click chọn được thùng;
  - generator trong editor = CLI từng byte, kiểm tra sâu sạch, chơi được;
  - số draw call với 4×4.
  - Playtest trên **bản build production của editor** cũng chạy (có HUD, chỉ database editor, đóng thì iframe mất).
  - Hồi quy: game dev `p2-s5`, `p2-s2` (migrate save v1/v2 → v8 qua IndexedDB thật), editor `m3`, `m4`, `m5`: PASS.

## 8. Còn lại sau M6

- Gộp mesh trong viewport editor (world > 4×4).
- Vùng chơi lệch tâm; polygon room/nhiều tầng; tay cầm đổi kích thước; migration nội dung cho save khi đổi tập ID.
- Generator: thêm biến thể bố cục (đường cong, lô không đều), cây cối khi có asset.
- Streaming theo chunk trong runtime (dời từ R3b); ownership và tham chiếu đã sẵn sàng (`ChunkLifecycle`).
