# P2-S5 — Quyết định và kiểm chứng

Ngày: 24/09/2026. Phạm vi: mục Sprint P2-S5 trong `Zombie_Outbreak_Phase_2_Plan.md` (perception, zombie phá cửa, repath) cộng yêu cầu thêm của chủ dự án: **nghe tiếng bước chân trong phạm vi cố định**, **lang thang Idle → điểm ngẫu nhiên → pathfind → nghỉ → điểm mới**, và **hệ thống di cư bên ngoài đẩy cả nhóm sang vùng khác**. Mốc trước sprint: `e66cba5`.

## Cảm nhận (`systems/ai.ts`)

- **Nhìn**: raycast mắt 1,5 m như cũ, kiểm tra mỗi 0,2 s. Zombie **chưa phát hiện** (IDLE/WANDER/MIGRATE) chỉ thấy trong hình nón ±70° phía trước, tầm 10 m, hoặc bất kỳ hướng nào trong 1,2 m (chạm mặt). Zombie **đang săn** (CHASE/SEARCH/ATTACK/đập cửa) nhìn mọi hướng tới 14 m. `viewHalfAngleDeg: 180` trả lại tầm nhìn 360° của Phase 1.
  - Quyết định: thêm hình nón vì nếu vẫn nhìn 360°/10 m thì tiếng bước chân đi bộ (5 m) gần như không bao giờ có tác dụng ngoài việc nghe qua tường. Có hình nón thì lẻn sau lưng zombie có ý nghĩa: đi bộ vẫn bị nghe, đứng yên thì không.
- **Nghe**: bán kính cố định từ vị trí người chơi, mọi hướng: **đi bộ 5 m, chạy 12 m**, đứng yên/sửa/chế tạo = im lặng (`config.hearing`). Có tường/cửa đóng giữa hai bên (raycast) thì bán kính × 0,5 (2,5 m / 6 m). Nghe thấy → nhớ vị trí phát ra tiếng (nguồn `noise`) → SEARCH tới đó. Runtime tính `playerNoise` mỗi tick từ tốc độ thật (`resolvePlayerSpeed`); âm thanh phát cho người chơi không phải sự kiện AI.
- **Trí nhớ**: `lastKnownTarget` + `memoryAge` + `memorySource` (`sight`/`noise`). Nhớ **20 s** (`memoryDuration`), thay cho timeout SEARCH 8 s cố định của Phase 1. Tiếng bước chân mới khi đang SEARCH làm mới vị trí và thời gian. Bị đánh/đẩy khi chưa phát hiện → nhớ hướng đòn tới.
- **Không dùng tọa độ toàn cục**: người chơi chưa từng bị thấy/nghe, đứng sau tường kín, không bao giờ thành mục tiêu (test runtime 30 s với zombie cách tường 1,2–5 m).

## Lang thang và di cư

- **IDLE** nghỉ 3–8 s (RNG runtime seed theo ván) → **WANDER** tới một điểm ngẫu nhiên trong vùng (0,9 m/s) → tới nơi / hết 20 s / không còn đường → IDLE nghỉ → điểm mới. Điểm lang thang: ô đi được, **cùng vùng liên thông** với zombie (không nằm sau cửa đóng), không trong nhà (trừ khi zombie đang ở chính nhà đó), cách ≥ 1,5 m; seed = hash(seed ván, id, bộ đếm).
- **Vùng (`MapData.zombieZones`)**: 8 vùng ngoài trời trên map khu phố (công viên, đường tây, bãi bắc, sân cửa hàng, đường đông, ngã tư, phố nam, sân sau nhà dân), tâm đều đi được và cùng vùng liên thông (có test). Zombie mới thuộc vùng gần điểm spawn nhất. Map không có vùng (test/lab) thì lang thang quanh điểm spawn bán kính 6 m và không di cư.
- **Đạo diễn di cư (`systems/horde.ts` + `runtime.stepHorde`)**: mỗi 90–180 s game chọn một vùng có ≥ 2 zombie đang nghỉ/lang thang, chọn vùng đích khác với trọng số 1/(1 + số zombie ở đó) để đàn tản ra thay vì dồn một chỗ. Cả nhóm đổi `zoneId`; con đang nghỉ/lang thang chuyển **MIGRATE** (1,4 m/s, không nghỉ dọc đường, tối đa 60 s) tới điểm trong vùng mới; con đang săn tiếp tục săn và sau đó lang thang ở vùng mới. Không có nhóm đủ lớn thì thử lại sau 20 s. RNG = hash(seed ván, `horde:<bộ đếm>`), cùng seed cho cùng kết quả (test chạy hai lần so sánh). Sự kiện `horde:migrated`; F3 hiện thời gian tới lần di cư kế.

## Phá cửa

- **Chọn cửa** (`NavGrid.findDoorRoute`, viết lại từ spike S1): lưới giữ nhãn **vùng liên thông 4 hướng** (khớp đúng những gì A* không cắt góc đi được), tính lười và cache theo `nav.version`. Đồ thị: điểm xuất phát, hai điểm tiếp cận mỗi cửa **đóng**, đích; cạnh đi bộ nối nút cùng vùng (độ dài đường thẳng ước lượng), cạnh phá cửa nối hai phía một cửa với chi phí 12. Trả về cửa đầu tiên trên tuyến rẻ nhất → không chọn cửa không liên quan; có tuyến mở thì `doorId: null`; phá cửa cũng không tới được thì null (zombie bỏ cuộc, không đập tường). Không chạy mỗi frame: chỉ khi một lần tìm đường mới trả null (≥ 0,4 s/zombie).
- **Hiệu năng**: `findPath` trả null ngay khi hai đầu khác vùng liên thông, thay vì A* loang cả khu vực đi được mỗi 0,4 s như trước. Nhãn vùng dựng lại (BFS ~10 800 ô) chỉ khi cửa đổi trạng thái.
- **FSM**: CHASE/SEARCH bị chặn → **APPROACH_STRUCTURE** (nhận slot) → **ATTACK_STRUCTURE**: quay mặt vào cửa, vung (windup 0,3 s như đòn thường, dùng lại pose `attack`) rồi 0,9 s hồi = **10 damage mỗi 1,2 s**. Cửa 120 HP = 12 đòn ≈ 14,4 s với 1 zombie.
  - Mỗi **phía cửa có 2 slot** (±0,35 m dọc tường, cách mặt cửa 1,05 m; kiểm tra đi được). Runtime giữ slot theo `doorId:side`, trả khi zombie rời trạng thái/chết/đổi cửa. Không có slot → đứng chờ ở 2,4 m, không bao giờ đánh từ hàng sau.
  - Runtime kiểm tra lại mỗi đòn: zombie còn sống, cửa **vẫn đóng**, trong tầm 1,3 × 1,25 m. Mở cửa lúc đang lấy đà → không có đòn, zombie rời cửa về SEARCH/CHASE.
  - Giữ vây tối đa **60 s** kể từ thông tin mới nhất (nghe/thấy mới reset); hết thì quên và về IDLE. Trên đường tới cửa (APPROACH) vẫn áp dụng trí nhớ 20 s.
  - HP về 0 → `setDoorState('destroyed')`: collider lá cửa, lưới nav, revision như S1; `door:destroyed`. Zombie đang tới/đập cửa đó chuyển SEARCH với cửa sổ tìm mới (memoryAge = 0) tới vị trí nhớ; chỉ CHASE/ATTACK khi thật sự thấy lại người chơi.
- **Hook S6**: `TimedAction.worldTargetId` (null với mọi recipe S4); cửa trúng đòn hủy action nhắm cửa đó với lý do `target-damaged`, không trừ gì (có test).
- **Phản hồi**: âm `doorBash` (thịch + lạch cạch) và `doorBreak` (gỗ vỡ), giảm theo khoảng cách người chơi–cửa (đủ trong 6 m, tối thiểu 15%). Cánh cửa rung 0,18 s mỗi đòn (chỉ phần hiển thị; collider không đổi) và sẫm dần theo HP. Prompt cửa hiện "(độ bền 90/120)" khi hư. Toast đỏ khi cửa vỡ. Mắt đỏ cả khi tiếp cận/đập cửa.

## Respawn

`pickSpawnPoint` nhận `isAllowed`: runtime cấm điểm trong nhà (nới 0,5 m) và ô không đi được (collider mới S7 sẽ vào nav). Điểm đặt tay hiện có đều hợp lệ (test).

## Save v6

`SAVE_SCHEMA_VERSION = 6`. Mỗi zombie thêm `memoryAge`, `memorySource`, `zoneId`, `structureTargetId`; save thêm `horde { timer, counter }`. Trạng thái AI mới hợp lệ từ v6 (v5 chứa `WANDER` bị từ chối). Validator: trí nhớ có-hoặc-không đồng bộ, trạng thái đập cửa phải có cửa (tồn tại trên map) và vị trí nhớ, `zoneId` phải là vùng của map. Không lưu path, slot, timer nghỉ, windup, điểm lang thang (load tính lại; phía cửa suy ra từ vị trí).

**Migrate v5 → v6** thuần/idempotent: giữ nguyên mọi thứ khác; zombie vào vùng gần nhất, vị trí nhớ cũ coi là vừa thấy, không có vây cửa, `horde.timer = 90`. Backup `slot-1.backup-v5`, toast Continue. Fixture mới `phase2-s5-v6.json` lưu **giữa lúc zombie đang đập cửa nhà an toàn** trong Chromium; `phase2-s4-v5.json` đóng băng (script S4 không ghi đè nữa).

## Kiểm chứng

- **259 test** (25 file; trước sprint 211, trong đó 3 test interaction lỗi sẵn — xem dưới). Mới: `perception.test.ts` (nón nhìn, nghe đi/chạy/im lặng/qua tường, quên sau 20 s, bị đánh thì tìm, chu kỳ nghỉ–lang thang, MIGRATE, FSM vây cửa: nhịp 1,2 s, mở cửa hủy đòn, xếp hàng không đánh, bỏ vây 60 s, không tuyến thì bỏ cuộc), `siege.test.ts` (runtime + body giả trên lưới: thấy → đóng cửa → đập đúng 12 đòn 110…0 → vỡ → vào nhà → đánh; chưa bị phát hiện sau tường 30 s không bị nhắm; bước chân sau cửa nghe được, tường xa thì không, đứng yên thì không; hook S6; mở cửa lúc lấy đà; ≤ 2 zombie đập một phía; save giữa vây → load khớp tuyệt đối → phá xong; lang thang trong vùng/ngoài trời/đi được; di cư cả nhóm tới vùng đích, tái lập; respawn không trong nhà), `horde.test.ts` (director, vùng/spawn của map, vùng liên thông, slot), save v5 → v6 + 8 kiểu hỏng + fixture v6.
- **Soak** (bot và lộ trình không đổi; thêm số liệu S5 và bất biến ≤ 2 zombie đập mỗi phía cửa):
  - shelter: **sống 30'**, 4 kill, 30 damage, máu thấp nhất 70, 11/11 tủ. Lần đầu có vây cửa thật: zombie-7 nghe rồi thấy bot chạy về nhà, bot đóng cửa, zombie đập 12 đòn và **phá cửa nhà an toàn ở giây 61**, vào nhà và bị hạ. 12 lần di cư, 4 lần bị thấy, 1 lần bị nghe, tối đa 1 zombie/phía cửa. Cổng shelter vẫn đạt nhưng từ giây 61 nhà an toàn không còn cửa (chưa có sửa/lắp lại cửa — S7).
  - patrol: chết ở **853 s** (trước 721,9 s), 30 kill (trước 34), 180 damage; 34 lần bị thấy, 5 lần bị nghe, 6 lần di cư. Sống lâu hơn và ít kill hơn chủ yếu vì zombie không còn thấy 360° và lang thang theo vùng; chưa chỉnh số.
- `npm run lint`, `npm run build` sạch.
- **Playwright + Chrome 153 headless** (`scripts/p2-s5-browser.mjs`):
  - Dev (Rapier thật): 7–8/8 zombie tự rời chỗ trong 9 s, trạng thái IDLE/WANDER theo vùng; phím thật W = "5 m", Shift+W = "12 m", đứng yên = 0; dàn cảnh 1 zombie trước cửa nhà an toàn → đi tới cửa bằng phím, **E mở** → zombie CHASE → **E đóng** → ATTACK_STRUCTURE, HP 120 → 80, prompt "(độ bền 90/120)", máu người chơi vẫn 100 → **lưu giữa vây** (v6, zombie ATTACK_STRUCTURE, fixture) → reload → Continue → vây tiếp tục → cửa vỡ, toast, raycast qua khung cửa không còn bị chặn → zombie vào nhà và đánh (máu 90). **3/3 PASS**.
  - Production (`vite preview`): không `__runtime`; F3 hiện WANDER + vùng, bước chân im lặng/5 m/12 m; lưu → IndexedDB v6 (zoneId, horde, ≥ 3 zombie rời điểm spawn) → reload → Continue; không lỗi console. **4/4 PASS**.
  - Hồi quy: `p2-s2`, `p2-s3`, `p2-s4` dev + production và `p2-smoke.mjs` dev + production (CDP, profile Chrome riêng): PASS; các script giờ assert schema 6.
  - Ảnh (không track): `node_modules/.tmp/p2s5-siege.png`, `p2s5-broken.png`, `p2s5-prod-wander.png`.

## Feedback sau S5 (25/09/2026): animation đi/chạy và tiếng bước chân

**Vấn đề:** chân người chơi/zombie quá nhanh và giật trên máy cấu hình cao. Hai nguyên nhân:
1. Physics Rapier bước cố định 1/60 s, còn view đo quãng đường **mỗi khung hình**. Ở 144 Hz vị trí chỉ đổi ở ~1/2,4 số khung, nên tốc độ đo nhảy 0 ↔ ~2,4× tốc độ thật: biên độ chân chớp giữa đứng và bước, pha bước giật từng cục.
2. Nhịp bước vốn nhanh: sải 1,5 m/chu kỳ cho người chơi (đi 5,3 bước/s, chạy 9,3 bước/s), zombie 1,3 m.

**Sửa:**
- `rendering/character/gait.ts`: tốc độ lọc thông thấp theo hằng thời gian 0,12 s (kết quả như nhau ở mọi FPS), pha tích phân từ tốc độ đã lọc; bỏ qua dịch chuyển > 1 m (teleport/load). Zombie dùng helper này; hướng quay hiển thị của zombie cũng được làm mượt (`dampAngle`, hệ số 10) thay vì giật ở góc đường.
- Người chơi: pha và tốc độ lấy từ **simulation** (`player.stridePhase`, `player.moveSpeed` = tốc độ dự định mỗi tick) thay vì vị trí body; view chỉ làm mượt tốc độ (chân dừng/bắt đầu êm ~0,1 s).
- Sải dài hơn: người chơi `walkStride` 2,2 m / `runStride` 3,2 m trong `config.player` (đi ≈ 3,6 bước/s, chạy ≈ 4,4 bước/s); zombie 1,6 m (đuổi ≈ 2,9 bước/s, lang thang ≈ 1,1).
- **Tiếng bước chân**: runtime phát `player:footstep { running }` ở mỗi nửa sải (bước đầu ngay khi bắt đầu đi), **chỉ khi `playerNoise` > 0** — tức đúng lúc zombie nghe được (đi 5 m, chạy 12 m). Âm tổng hợp `stepWalk` (thịch nhẹ) / `stepRun` (to hơn + tiếng sột), lệch ngẫu nhiên ±10% mỗi bước; cùng nhịp với chân vì cùng pha. Đứng yên, sửa/chế tạo, tạm dừng: im lặng.

**Kiểm chứng:** `gait.test.ts` mô phỏng physics 60 Hz quan sát ở 60/144/240 Hz: tốc độ lọc ±5% tốc độ thật, gợn < 15% (trước: 0 ↔ 5,5 m/s), số chu kỳ bước như nhau ở mọi FPS; `footsteps.test.ts`: bước đầu ngay lập tức, khoảng cách = nửa sải / tốc độ, đánh dấu chạy, cùng số bước ở 60/144/240 Hz, dừng thì im và `playerNoise` = 0. `scripts/p2-s5-gait.mjs` (Chrome headless, không giới hạn khung hình, dev): chân đổi góc ở ≥ 97% khung hình khi đi/chạy, mỗi sự kiện bước đúng một âm, đứng yên 0 âm — **4/4 PASS**. SwiftShader headless chỉ đạt ~21–29 FPS nên độ mượt ở 144 Hz+ được chứng minh bằng unit test, **chưa xem trên màn hình tần số cao thật**. Hồi quy p2-s3/p2-s4/p2-s5 dev PASS; 266 test.

## Việc phát sinh ngoài S5

- Commit S4 (`0752802`) đổi `INTERACT_RANGE` 2 → 1 m nhưng 3 test `interaction.test.ts` vẫn dùng vật ở 2 m nên **lỗi sẵn trên HEAD**. Test đã sửa vị trí (1,4 m), giữ nguyên ý nghĩa; không đổi hằng số. Cùng nguyên nhân: script S4 dừng người chơi ở góc nhà nên zombie "đỗ" để đánh thử nằm sau tường — script thêm một bước lùi vào phòng bằng phím thật.
- Máy dev chỉ có Node 18.12 (Vitest/Rolldown cần ≥ 20) và `node_modules` thiếu binding Windows của rolldown/oxlint. Kiểm chứng chạy bằng Node 22.20 portable ngoài repo; hai binding đúng phiên bản trong `package-lock.json` được giải nén vào `node_modules` (không đổi package.json/lock). Playwright 1.64 lấy từ npx cache, trình duyệt là Chrome cài sẵn (`CHROMIUM_PATH`).

## Giới hạn còn lại

- Chỉ cửa là công trình zombie đánh được; vách/thùng (S7) sẽ dùng cùng FSM + slot. Barricade (S6) sẽ nằm trước HP cửa trong `stepStructureHits`.
- Chi phí phá cửa 12 m và cạnh đi bộ đường thẳng là ước lượng lập kế hoạch; đủ cho 3 nhà một cửa hiện tại.
- Nghe không có sai số vị trí; tiếng đánh/cửa/đập cửa chưa thu hút zombie (plan: hệ thống âm thanh toàn bản đồ để sau).
- Đàn di cư đi cùng lúc cùng tốc độ nên đi gần nhau, nhưng không có steering giữ đội hình.
- Cân bằng (hình nón 70°, bán kính nghe, nhịp di cư, soak shelter mất cửa ở giây 61) là giá trị khởi điểm; chưa playtest người thật, chưa đo FPS GPU thật.
