# P2-S4 — Quyết định và kiểm chứng

Ngày: 24/09/2026. Phạm vi: mục Sprint P2-S4 trong `Zombie_Outbreak_Phase_2_Plan.md` (timed action, crafting, repair). Mốc trước sprint: `9e4ffe6`.

## Vật liệu và gậy gỗ tự chế

| ID | Tên | Stack | Dùng ở S4 |
|---|---|---:|---|
| `wood_plank` | Ván gỗ | 10 | Sửa đồ gỗ, chế tạo gậy |
| `scrap_metal` | Kim loại vụn | 10 | Sửa đồ kim loại |
| `duct_tape` | Băng keo | 10 | Mọi lần sửa và chế tạo gậy |
| `nails` | Đinh | 50 | Chưa dùng (build/barricade S6–S7); có loot sẵn |

- Vật liệu kind `material`: stack theo loại, không "Dùng" trực tiếp (chuột phải báo "không dùng trực tiếp", không mất đồ). `metal_sheet`, torch, mask, fuel để S6.
- `wooden_club`: damage 18, tầm 1,7 (số tuyệt đối của plan); cooldown 1,05 s, stamina 11 (plan 0,85 s/9 nhân cùng tỷ lệ gậy 1,0/0,8 và 12/10 như S2); maxCondition 40; hỏng còn 4. Hạ zombie 50 HP trong 3 đòn. Model: tấm ván + băng keo xám ở tay cầm, cùng quy ước grip.
- `repairGroup` trên definition: gỗ = gậy bóng chày, gậy gỗ; kim loại = ống sắt, xà beng, búa.

## Loot và chính sách save cũ

Không sửa bảng loot Phase 1/S2 (seed cũ sinh đúng đồ cũ, có test). Thêm **3 container ID mới cố định** (save v5):

| ID | Vị trí | Nội dung |
|---|---|---|
| `ct-safehouse-toolbox` | Hộp đồ nghề, tường tây nhà an toàn | **Bảo đảm** 1 ván + 1 băng keo + 1 kim loại vụn (đủ sửa một lần nhóm nào cũng được, chưa đủ chế gậy) |
| `ct-store-hardware` | Kệ vật liệu, tường đông cửa hàng | **Bảo đảm** 6–12 đinh, 1–2 ván, 1 băng keo; 2 lượt: kim loại vụn/ván/băng keo/không |
| `ct-house-scrap` | Đống phế liệu ngoài trời phía đông nhà dân (giữa hai điểm spawn) | **Bảo đảm** 1–2 kim loại vụn; 3 lượt: ván, kim loại vụn, băng keo, đinh, không |

400 seed (tổng 3 container mới): ván 2–10 (TB 4,6), kim loại vụn 2–8 (TB 4,2), băng keo 2–6 (TB 2,6), đinh 6–31 (TB 10,9). Mọi seed đủ ít nhất hai việc cần băng keo; 169/400 seed đủ cả gậy gỗ lẫn một lần sửa. Băng keo là nút thắt có chủ đích (sửa hay chế gậy).

Kiểm tra vị trí bằng test: không chồng tường/vật cản/container khác, có điểm đứng đi tới được từ spawn trong tầm tương tác và không bị tường chắn. Container vẫn có collider nhưng không trong nav grid như Phase 1.

**Save cũ:** `SAVE_SCHEMA_VERSION = 5`. Migrate v4 → v5 gieo 3 container mới một lần bằng `generateContainerLoot(seed, id)` y như New Game, `opened: false`; không đụng container/đồ khác. Chuỗi v1 → … → v5 vẫn thuần, không mutate, idempotent. v5 thiếu container mới hoặc v4 đã có container v5 bị coi là hỏng. Backup `slot-1.backup-v4`. Hàm gieo dùng chung với v2 → v3 (`seedAddedContainers`, chỉ thêm đúng nhóm ID của phiên bản đó). Toast Continue nêu 3 chỗ vật liệu mới.

## TimedAction

Module thuần `systems/timedAction.ts` (reservation, tiến độ) + `systems/crafting.ts` (kiểm tra/commit recipe) + dữ liệu `entities/recipes.ts`; `GameRuntime` giữ `action` (một hành động tại một thời điểm) và chạy `stepAction` sau combat, trước survival.

1. **Start** (`startCraft`, `startRepair`, `startRecipe`): còn sống, không có action khác, không đang vung; đủ nguyên liệu, dụng cụ (`isUsableTool`, dụng cụ hỏng không tính, món đang sửa không tự làm dụng cụ), chỗ cho thành phẩm. Chọn instance dụng cụ và ghi **reservation** (số lượng theo loại + ID target/dụng cụ). Chưa trừ gì.
2. **Tiến độ** theo `dt` của tick (thời gian game): pause không tick nên dừng; delta dài bị kẹp `maxDelta`. Mở túi không pause.
3. **Hủy** giải phóng reservation, không trừ gì: di chuyển (WASD), bấm đánh hoặc đẩy, trúng đòn zombie, phím **X** / nút Hủy, chết. Mất máu do đói/khát không hủy (nếu không sẽ không thể làm gì khi đói).
4. **Reservation**: thả, cất vào tủ hay dùng một món/lượng đã đặt trước bị chặn kèm toast; món khác vẫn chuyển được, lấy đồ từ tủ vẫn được, đổi vũ khí cầm tay được.
5. **Commit nguyên tử** trong tick: action bị xóa trước khi commit (gọi lặp/cũ là no-op), kiểm tra lại toàn bộ trên một bản sao túi: trừ input, hao mòn dụng cụ, sửa target (giữ ID, chặn ở max) hoặc thêm thành phẩm; chỉ ghi lại túi khi mọi bước thành công. Thất bại (ví dụ túi bị lấp đầy trong lúc làm) → `action:failed`, không mất gì.
6. **Save**: action không bao giờ nằm trong save. Snapshot chỉ chụp giữa hai tick nên luôn là trước hoặc sau commit (test quét từng tick quanh thời điểm hoàn tất). Load/New Game xóa action.

Sự kiện: `action:started/rejected/cancelled/failed/completed`, `item:reserved`; hao mòn dụng cụ phát `weapon:worn/broken` như combat.

## Recipe (số liệu khởi điểm của plan)

| Recipe | Chi phí | Dụng cụ | Kết quả | Thời gian |
|---|---|---|---|---:|
| Gậy gỗ tự chế | 2 ván + 1 băng keo | Không | Instance mới, độ bền 40/40 | 4 s |
| Sửa đồ gỗ | 1 ván + 1 băng keo | Không | +30, chặn ở max | 4 s |
| Sửa đồ kim loại | 1 kim loại vụn + 1 băng keo | Không | +25, chặn ở max | 5 s |

- Không cần búa để sửa (plan §7.2): búa hỏng không khóa tiến trình. Vũ khí hỏng sửa được; độ bền > 0 tự bỏ trạng thái hỏng. Món đầy độ bền bị chặn.
- Chỗ trống thành phẩm tính **sau khi tiêu input** (stack dùng hết giải phóng ô).
- Cơ chế dụng cụ (tag + hao mòn khi hoàn tất, chọn instance lúc start, dụng cụ hỏng giữa chừng làm commit thất bại) đã có và được test bằng recipe thử; recipe dùng búa thật thuộc S6/S7. Refuel torch để S6.

## UI

- Túi đồ (I): click vũ khí → thẻ chi tiết có **Sửa (4 s/5 s)**, xem trước "độ bền 0 → 30/80 (+30)", nguyên liệu có/cần (đỏ khi thiếu), lý do chưa sửa được. Khi đang sửa: "Đang sửa…" và **Hủy sửa (X)**.
- Bảng **Chế tạo** cạnh túi: chỉ số thành phẩm, nguyên liệu, dụng cụ, thời gian, lý do chặn (thiếu nguyên liệu, túi đầy sau khi tiêu input, đang làm việc khác).
- HUD: thanh tiến trình trên bảng chỉ số (góc trái dưới, không bị overlay túi che), thời gian còn lại, nút Hủy (X). Toast khi bắt đầu bị từ chối, hủy (nêu lý do, "không mất nguyên liệu"), thất bại, hoàn tất ("Đã sửa …: 0 → 30/80"). Âm thanh tổng hợp mới: bắt đầu, xong, hủy.
- Tư thế làm việc dùng chung (`pose.ts`, input `work`): cúi người, tay trái giữ, tay phải gõ ~2,5 lần/s; cú vung luôn ưu tiên. Đo trong trình duyệt: tay phải −1,2…−1,4 rad khi đang sửa.
- Hướng dẫn, gợi ý phím, menu và README cập nhật (I túi/sửa/chế tạo, X hủy). Lab `?lab=doors` có nút "Vật liệu thử".

## Sửa lỗi phát hiện khi kiểm thử (S3)

**Ô tên ở màn tạo nhân vật mất ký tự đầu trong bản production.** Script S3 production lỗi ngẫu nhiên (đúng "một lần thất bại không rõ nguyên nhân" ghi ở S3). Lần này giữ đủ log: tên "Mai An" chỉ còn "n". Chẩn đoán trong Chromium: mỗi phím thay toàn bộ giá trị trên cùng DOM node; gõ cách 60 ms (tốc độ người) vẫn mất 2 ký tự đầu trong vài giây sau khi mở màn hình, lúc hai canvas WebGL đang khởi động. Controlled input bị React ghi lại giá trị cũ. Sửa: ô tên thành uncontrolled (`defaultValue`), React không ghi DOM; chỉ cắt khi vượt 24 ký tự (theo code point). Sau sửa: 10/10 lần giữ đủ tên ở 0 ms và 60 ms, giới hạn 24 ký tự vẫn đúng. Script S3 cũng chờ trạng thái radio thay vì đọc `aria-checked` một lần (race thứ hai).

## Kiểm chứng

- **211 test** (22 file): dữ liệu vật liệu/recipe; craft đúng một lần, ID mới; thiếu nguyên liệu không đổi gì; túi đầy được craft khi input giải phóng ô, bị chặn khi không; sửa +30/+25, chặn max, đầy bị chặn, sai nhóm/không phải vũ khí; dụng cụ còn 1 → hoàn tất rồi hỏng và chặn lần sau; dụng cụ hỏng/target không làm dụng cụ; reservation theo số lượng nhiều stack. Runtime: hoàn tất đúng một lần sau đủ thời gian, gọi lặp no-op, spam start chỉ một action; hủy do di chuyển/đánh/đẩy/X/nút/trúng đòn/chết không mất gì và giải phóng reservation; đói không hủy; chặn thả/cất/dùng đồ đặt trước; busy khi đang vung; commit thất bại khi túi bị lấp; save giữa action = trạng thái trước, load không nhân đồ; snapshot mỗi tick quanh hoàn tất chỉ có trước/sau. Acceptance: lấy vật liệu từ tủ → gậy hỏng đánh 5 → sửa → đánh 25. 400 seed vật liệu, vị trí container, migration v4 → v5 (gieo như New Game, idempotent, từ chối sai), save cũ sửa được xà beng, fixture v5 round trip. Pose làm việc.
- **Soak giữ nguyên số liệu S2/S3**: shelter 30' sống, 4 kill, 30 damage; patrol chết ở 721,9 s, 34 kill (lộ trình soak không đổi nên con số so sánh được).
- `npm run build`, `npm run lint` sạch.
- **Playwright + Chromium 151 headless, context riêng** — `scripts/p2-s4-browser.mjs`:
  - Dev: đi bằng W+A tới hộp đồ nghề, E, Lấy tất cả; D tới tủ quần áo, lấy và trang bị (input thật); chuột phải vật liệu → gợi ý, không mất. Gậy hỏng đánh 5 → thẻ Sửa "0 → 30/80" → thanh tiến trình, tư thế làm việc → xong sau ≥ 4 s game, cùng ID, tốn 1 ván + 1 băng keo → đánh 25. Hủy bằng phím S (di chuyển), X, zombie đánh trúng: túi y nguyên. Thả băng keo đang đặt trước bị chặn. Esc pause: tiến độ đứng yên 1,5 s; lưu giữa action → save v5 không có action, vật liệu còn đủ → reload → Continue không có action. Chế tạo gậy gỗ (40/40), trang bị → socket `weapon:wooden_club`. Lưu → fixture `phase2-s4-v5.json` → reload → Continue giữ nguyên. Ghi fixture S3 v4 vào slot → Continue → toast vật liệu, `slot-1.backup-v4` bằng bản gốc, 14 container. Không lỗi console/page.
  - Production (`vite preview`): không `__runtime`; loot bằng input thật, bảng Chế tạo báo "Ván gỗ 1/2" và nút khóa; sửa giữa chừng → lưu → reload → Continue (vật liệu còn, không action) → sửa hết (có lần 72 → 80 bị chặn ở max) → lưu → Continue. **PASS 7/7 lần liên tiếp** sau khi script chờ ô túi render (trước đó 1 PASS, 2 lỗi do script chọn ô túi trước khi React cập nhật).
  - Hồi quy: `p2-s2-browser.mjs` và `p2-s3-browser.mjs` dev + production (S3 production 4/4 sau sửa lỗi ô tên), `p2-smoke.mjs` dev + production qua CDP: PASS. Các script cũ assert schema 5; `p2-s3-browser.mjs` không còn ghi đè `phase2-s3-v4.json` (đóng băng).
  - Ảnh (không track): `node_modules/.tmp/p2s4-repair-progress.png`, `p2s4-craft-progress.png`, `p2s4-inventory-craft.png`, `p2s4-migrated.png`, `p2s4-prod-repair.png`.

## Giới hạn còn lại

- Chưa có recipe dùng búa thật, refuel, build, barricade (S6–S7); đinh chỉ mới là loot.
- Cân bằng vật liệu là giá trị khởi điểm; chưa playtest người thật xem băng keo có quá hiếm. Chưa đổi combat/HP/spawn.
- Script browser thao tác nhanh hơn người; các race đã gặp là ở script (trừ lỗi ô tên đã sửa). Chưa đo FPS GPU thật.
