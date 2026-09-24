# P2-S2 — Quyết định và kiểm chứng

Ngày: 24/09/2026. Phạm vi: mục Sprint P2-S2 trong `Zombie_Outbreak_Phase_2_Plan.md` (từ gậy mặc định sang đồ phải đi tìm). Mốc trước sprint: `1944aee`.

## New Game tay không

- `GameRuntime.newGame` không cấp vũ khí. Bấm đánh khi tay không phát `player:unarmed` → toast nhắc tìm tủ, trang bị trong túi, Space để đẩy; không trừ stamina, không vung. Shove giữ nguyên.
- Toast đầu ván chỉ đường tới tủ quần áo nhà an toàn (chỉ hiện khi map có tủ đó, không hiện ở lab).
- **Migration v1 vẫn cấp gậy Phase 1** như S1 (chính sách plan §2). Fixture v1 không đổi.

## Vũ khí và chỉ số

Gậy giữ nguyên baseline Phase 1 (`GAME_CONFIG.melee`: 25 dmg, tầm 2,0, cooldown 1,0 s, stamina 12) vì đó là số đã chỉnh qua playtest/soak. Các vũ khí khác lấy **tỷ lệ tương đối** của bảng plan so với gậy (cooldown, stamina), không chép số tuyệt đối (plan để gậy 0,8 s/10 stamina, khác baseline thật).

| Vũ khí | Damage | Tầm | Cooldown | Stamina | Max condition | Hỏng (20%) | Đòn hạ zombie 50 HP |
|---|---:|---:|---:|---:|---:|---:|---:|
| Gậy bóng chày | 25 | 2,0 | 1,0 s | 12 | 80 | 5 | 2 |
| Ống sắt | 28 | 1,8 | 1,2 s | 15 | 120 | 6 | 2 |
| Xà beng (tool `pry`) | 32 | 1,8 | 1,25 s | 17 | 150 | 6 | 2 |
| Búa (tool `hammer`) | 18 | 1,3 | 0,8 s | 10 | 100 | 4 | 3 |

- Hit timing, góc quạt, knockback, stagger dùng chung `GAME_CONFIG.melee`. Chỉ số theo vũ khí nằm ở `ItemDefinition.melee`; condition chỉ nằm trên instance.
- Quan sát cân bằng cho S8: với zombie 50 HP, damage 28/32 không hạ nhanh hơn gậy (đều 2 đòn); khác biệt thật là độ bền, tốc độ, stamina và damage khi hỏng. Tầm búa 1,3 ngắn hơn tầm đánh zombie 1,5 nên búa là dụng cụ, không phải melee bắt buộc. Chưa đổi HP zombie.
- Gậy gỗ tự chế thuộc S4 (craft). Chưa thêm vật liệu/fuel.

## Condition, wear, broken

- `systems/weapons.ts` là luật thuần: `weaponHitDamage` đọc condition **tại lúc xác nhận hit**; condition > 0 luôn đủ damage (1 → 0 vẫn đủ cho đòn đó); condition 0 → `round(base × 0,2)`, tối thiểu 1. Broken suy ra từ condition, không lưu cờ riêng, nên repair S4 tự bỏ trạng thái hỏng.
- Mỗi cú vung có `attackId` và `attackWeaponId` (cấp ở `startAttack`). Wear trừ **sau** khi giải quyết damage, 1 lần cho mỗi attackId dù trúng nhiều zombie; `lastWornAttackId` chặn trừ lặp. Đánh trượt không mất condition. Không đổi/thả vũ khí giữa cú vung (có từ S1), nên wear luôn vào đúng món đã vung.
- Sự kiện: `weapon:worn` (UI đồng bộ, không phát âm pickup), `weapon:lowCondition` một lần khi xuống ≤ 25%, `weapon:broken` một lần khi về 0 (toast đỏ + âm `weaponBreak`), `item:equipped`, `player:unarmed`; `player:attacked` thêm `damage`, `weaponId`.
- `isUsableTool(item, tag)` cho S4/S6: đúng capability và condition > 0; búa/xà beng hỏng không đủ điều kiện.
- Chưa làm: đánh công trình trừ 2 condition (chưa có công trình người chơi nhắm phá; S5–S7).

## Loot và container

Thêm 4 container với **ID mới cố định**; không đổi ID/vị trí/bảng loot của 7 container Phase 1, nên seed cũ vẫn sinh đúng đồ cũ (có test đối chiếu fixture Phase 1).

| ID | Vị trí | Bảng | Nội dung |
|---|---|---|---|
| `ct-safehouse-closet` | Tủ quần áo nhà an toàn, tường đông | `safehouse-closet` | **Bảo đảm** 1 melee cơ bản: gậy (3) hoặc ống sắt (1), condition 60–100% |
| `ct-store-tools` | Kệ dụng cụ, tường tây cửa hàng | `tool-shelf` | **Bảo đảm** búa 50–100%; 1 lượt: ống sắt/xà beng/không |
| `ct-house-nightstand` | Tủ đầu giường nhà dân | `house-nightstand` | 2 lượt: băng gạc, snack, gậy hiếm 30–90% |
| `ct-park-toolbox` | Thùng dụng cụ công viên (gần điểm spawn) | `park-toolbox` | 2 lượt: ống sắt, xà beng, búa 25–80% (rủi ro cao hơn) |

- Condition vũ khí loot gieo **một lần** cùng loot (hash(seed, id container)), lưu ngay; mở lại/load không reroll. Loot không bao giờ sinh vũ khí hỏng. Bảng Phase 1 không tiêu thêm RNG nên kết quả cũ giữ nguyên.
- 400 seed: tủ quần áo luôn có đúng 1 melee cơ bản (gặp cả gậy lẫn ống sắt, >10 mức condition khác nhau), kệ dụng cụ luôn có búa dùng được; xà beng chỉ có ở một phần seed.
- Container vẫn có collider Rapier nhưng không nằm trong nav grid (như Phase 1); các vị trí mới sát tường, soak bot đi tới được cả 11.

## Save v3 và migration

- `SAVE_SCHEMA_VERSION = 3`. Cấu trúc item không đổi; v3 bắt buộc có 4 container mới. Chuỗi migrate thuần, không mutate: **v1 → v2 (S1) → v3**, hoặc v2 → v3.
- v2 → v3: thêm container mới còn thiếu, gieo bằng `generateContainerLoot(seed, id)` y như New Game cùng seed, `opened: false`. Container cũ giữ nguyên (đã loot không sinh lại). Thứ tự: container map theo thứ tự map, sau đó túi đồ rơi, khớp `createSnapshot`. Chạy lại cho cùng kết quả; v3 thiếu container mới hoặc v2 đã có container v3 bị coi là hỏng.
- `SaveValidation` có `fromVersion`. `commitMigratedSave(original, save, slot)` backup theo slot và phiên bản: `slot-1.backup-v1`, `slot-1.backup-v2` (trùng khác nội dung thì thêm UUID như S1), cùng transaction với ghi bản mới. Trước đây hàm cố định `slot-1`; nay nhận slot, nên `slot-lab` v2 cũng migrate đúng slot.
- Toast Continue theo phiên bản gốc, nói rõ có tủ vũ khí mới chưa mở và tủ cũ không sinh lại loot.
- Fixture: `phase1-v1.json` (Phase 1), `phase2-s1-v2.json` (S1, **đóng băng**, script S1 không còn ghi đè), `phase2-s2-v3.json` (mới, xuất từ save thật trong Chromium: ống sắt hỏng đang cầm giữ ID sinh từ tủ qua lấy/thả/nhặt, tủ quần áo đã loot, túi đồ rơi chứa ống sắt 33).

## UI và hiển thị

- Túi đồ: click trái chọn món → thẻ chi tiết (damage hiện tại/gốc khi hỏng, tầm, hồi chiêu, stamina, độ bền, trạng thái) với Trang bị/Bỏ trang bị hoặc Dùng, Cất vào tủ (khi mở tủ), Thả xuống, Sửa (disabled, S4). Chuột phải dùng/trang bị nhanh; Shift+trái cất nhanh khi mở tủ. Panel tủ giữ click trái = lấy.
- Ô vũ khí: thanh độ bền xanh/vàng (≤ 25%)/đỏ, tag HỎNG, badge E khi đang cầm. Tooltip ghi damage, condition hiện tại/tối đa, trạng thái.
- HUD: vũ khí đang cầm + độ bền (vàng khi thấp, đỏ + HỎNG), hoặc "Tay không". Toast có mức info/warn/danger và tự xuống dòng.
- Model trên tay đổi theo loại (mesh đơn giản: gậy gỗ, ống xám, xà beng đỏ có móc, búa cán + đầu), vũ khí hỏng ánh đỏ. Model/rig hoàn chỉnh thuộc S3.
- Hướng dẫn trong game và subtitle menu cập nhật. Lab: nút "Bộ vũ khí thử (gậy 1, búa hỏng)".

## Soak: phát hiện về baseline Phase 1

Khi chạy soak với lộ trình mới, bot kẹt góc tường cửa hàng. Tách từng yếu tố (cùng seed 20260924):

| Bot | Lộ trình | Vũ khí | Kết quả |
|---|---|---|---|
| Cũ (8 hướng, không né góc) | 7 tủ Phase 1 | gậy sẵn, tắt wear | 30' sống, 11 kill, 11 spawn, 60 dmg: **khớp đúng baseline S1** |
| Mới (né góc) | 7 tủ Phase 1 | gậy sẵn, tắt wear | chết ở 10,8', 33 kill |
| Mới | 11 tủ | gậy sẵn, tắt wear | chết ở 14,2', 38 kill |

Đo vị trí: bot cũ đứng trong **một ô 1 m ngay ngoài cửa nhà an toàn (-12, -9) khoảng 1545/1800 giây**, do phím 8 hướng đẩy vào góc tường. Nghĩa là "sống 30 phút, 11 kill" của Phase 1/S1 phần lớn là bot đứng yên, không phải phép đo cân bằng combat. Nội dung S2 không làm lệch baseline (dòng 1 khớp tuyệt đối).

Không tự đổi balance trong sprint này. Soak tách hai chính sách:

- **shelter** (cổng pass/fail): loot đủ 11 tủ rồi về nhà an toàn đóng cửa như người chơi thận trọng. Kết quả: **30' sống, 11/11 tủ, vũ khí đầu tiên ở giây 0,2, 4 kill/4 spawn, 30 dmg, minHealth 70, 8 hit → wear 8, 0 hỏng, 29 snapshot round-trip**; dùng 4 nước/3 đồ hộp. Tìm được gậy@55, búa@56, xà beng@69.
- **patrol** (chỉ báo cáo): đi tuần qua điểm spawn và đánh mọi con. **Chết ở 12,0'**, 34 kill/34 spawn, 180 dmg, 69 hit → wear 69, gậy hỏng một lần và bot đổi sang xà beng; dùng 3 băng gạc. Không có hồi máu tự nhiên, nên đánh liên tục chắc chắn chết; đây là dữ liệu cho cân bằng S8 (spawn/damage/hồi máu), không phải lỗi S2.
- Bot giờ đổi vũ khí khi hỏng ở tick kế tiếp không vung (trước đó đổi giữa cú vung bị chặn).

## Kiểm chứng

- **157 test** (17 file): luật wear/broken/tool, phân phối loot 400 seed, bảng Phase 1 không đổi, runtime tay không/đẩy, một đòn hai zombie trừ 1, đánh trượt, condition 1, cảnh báo thấp, chỉ số theo vũ khí, không đổi vũ khí giữa cú vung, reload không hồi condition, migration v2→v3/v1→v3, fixture v3 round-trip, soak shelter + patrol. `npm run build` (gồm `tsc -b`) và `npm run lint` sạch.
- **Playwright + Chromium 151 (bản Playwright chromium-1234), headless SwiftShader 1280×800, context/profile riêng**:
  - `scripts/p2-s2-browser.mjs` (dev): New Game tay không, click đánh ra gợi ý; đi bằng phím D tới tủ, E, click lấy, click chọn, Trang bị (input thật). Chuột thật đánh zombie đặt trên tia con trỏ: 28 dmg, 78→77; condition 1: vẫn 28 rồi HỎNG (toast đỏ, HUD đỏ); đòn sau 6 (20%). Thả qua thẻ chi tiết → HUD tay không → E nhặt lại → chuột phải trang bị. Lưu và về menu → reload → Continue: vẫn ống sắt 0/120 HỎNG cùng ID, túi rơi ống sắt 33. Continue fixture S1 v2 và Phase 1 v1 qua menu: preview không ghi, backup `slot-1.backup-v2`/`-v1` bằng bản gốc, save v3 đủ 11 container. Lab: bộ vũ khí thử. Không lỗi console/page.
  - Cùng script `--production` (vite preview): không có `__runtime`, `?lab=doors` không mở lab, luồng tay không → tủ → trang bị → lưu → reload → Continue giữ nguyên HUD vũ khí.
  - `scripts/p2-smoke.mjs` (hồi quy S1, qua CDP tới Chromium của Playwright, dev + production): migration v1→v3 + backup, schema 99 bị từ chối giữ slot, xung đột transaction giữ slot, túi đầy → gậy rơi, cửa closed/open/destroyed/closed khớp raycast Rapier và nav, save/load cửa vỡ ở `slot-lab` không đổi `slot-1`. PASS.
  - Ảnh: `node_modules/.tmp/p2s2-inventory-detail.png`, `p2s2-broken-hud.png`, `p2s2-lab-kit.png`, `p2s2-prod-equipped.png` (không track).

### Tái lập browser check

Playwright không phải dependency của repo. Cài tạm ngoài repo (ví dụ `npm install playwright` trong thư mục riêng), rồi:

```bash
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort           # Vite mới sau khi sửa source
BASE_URL=http://127.0.0.1:5174 PLAYWRIGHT_MODULE=file:///<...>/playwright/index.mjs \
  CHROMIUM_PATH=<chrome.exe> node scripts/p2-s2-browser.mjs          # ghi lại phase2-s2-v3.json
npm run build && npm run preview -- --host 127.0.0.1 --port 5199 --strictPort
PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... node scripts/p2-s2-browser.mjs --production
```

`p2-smoke.mjs` cần một Chromium headless mở sẵn với `--remote-debugging-port=9223 --user-data-dir=<thư mục thử>` và `BASE_URL` nếu không dùng 5173/5199. Script ghi/xóa save trong profile thử; không chạy trên profile chơi thật. Lưu ý chế độ dev script ghi đè `phase2-s2-v3.json` bằng save mới (seed ngẫu nhiên); test fixture chỉ dựa vào tính chất, không vào seed.

## Giới hạn còn lại

- Chưa có repair/craft (S4): nút Sửa disabled; vũ khí hỏng chỉ có thể thay bằng món khác.
- Chưa đo FPS GPU thật hay playtest tay; headless SwiftShader không phải benchmark. Cảm giác chọn vũ khí (tầm búa ngắn, xà beng chậm) cần người chơi thử.
- Cân bằng: kết quả soak patrol cho thấy vòng chiến liên tục gây chết ở ~11–14 phút kể cả với nội dung Phase 1. Cần quyết định ở S8 (hồi máu, nhịp spawn, loot y tế) dựa trên playtest người thật.
- Model vũ khí là mesh tạm; socket/animation thuộc S3.
