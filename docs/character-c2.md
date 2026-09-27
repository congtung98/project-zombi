# Nhân vật C2: quần áo, tóc và ngoại hình player

Ngày 27/09/2026. Bước 3 của `docs/Character_Zombie_Model_Animation_Plan.md`.

Kết quả:
- **4 bộ trang phục**, khác nhau về hình khối chứ không chỉ màu.
- Player chọn trang phục ở màn tạo nhân vật.
- Trang phục lưu bằng ID ngữ nghĩa, tùy chọn: save cũ vẫn hợp lệ.
- Zombie mặc cả 4 bộ, chọn theo ID.

Collider, chỉ số, túi đồ, trang bị không đổi.

## 1. Catalog

| ID | Nhãn | Hình khối | Màu cố định (ngoài màu áo/quần) |
| --- | --- | --- | --- |
| `tee` | Áo thun | Cổ tròn viền đậm, tay ngắn, gấu áo thả ngoài, quần dài, giày thể thao | viền = màu áo tối 28 % |
| `jacket` | Áo khoác | Rộng hơn thân 3 cm, dài tới hông (gấu 0,80 m), eo thẳng, cổ bẻ, tay dài dày hơn. Mặt trước mở: lộ áo thun sáng giữa hai mép khóa kéo sẫm. Quần jeans, giày nâu. | áo trong `#b7b1a5`, mép khóa sẫm |
| `shirt` | Sơ mi | Cổ đứng + 2 đầu cổ, nẹp khuy giữa ngực, măng-sét, áo đóng thùng, lưng quần cao, thắt lưng + khóa, quần âu hẹp, giày da đen | nẹp/măng-sét = màu áo tối 16 %, thắt lưng nâu, khóa kim loại |
| `work` | Đồ lao động | Áo đóng thùng, tay xắn lên cẳng tay có nếp cuộn. Quần yếm: yếm trước ngực, 2 dây đeo trước và sau, 2 khóa. Quần rộng, ủng cổ cao. | nếp cuộn = màu áo tối 20 %, ủng nâu, khóa kim loại |

Tóc: giữ 3 kiểu đã có (ngắn, dài, mohawk), đủ yêu cầu 2–3 khối tóc. Màu áo và màu quần của appearance tô phần trên và phần dưới của mọi bộ.

Ảnh `docs/character/c2/`:
- `outfits-z170`: hàng trên là 4 bộ nhìn chéo trước, hàng dưới nhìn sau khi đang bước. Kèm các dáng người, tóc, màu da khác nhau.
- `outfits-z28`: như trên ở zoom chơi.
- `close-z200`, `lineup-*`: zombie mặc các bộ khác nhau.
- `bench-10`: trong game.

## 2. Registry và appearance

- `entities/appearance.ts`: `OUTFIT_STYLES`, `OutfitId`, `DEFAULT_OUTFIT = 'tee'`, `outfitOf(a)`, nhãn `APPEARANCE_LABELS.outfit`.
- `CharacterAppearance.outfit?` là **trường tùy chọn duy nhất**. `isAppearance` nhận 5 khóa (save trước C2) hoặc 6 khóa với `outfit` hợp lệ. Khóa lạ vẫn bị từ chối.
- Không tăng phiên bản save, không cần migration. Save cũ nạp nguyên vẹn và vẽ áo thun, đúng như trước C2. Save mới ghi `outfit`.
- `DEFAULT_APPEARANCE` và `randomAppearance` có `outfit`.
- Màn tạo nhân vật: hàng "Trang phục" (4 lựa chọn), xem trước 3D ngay.
- `rendering/character/body.ts`: một builder cho mỗi bộ (`OUTFIT_BUILDERS`), dùng chung các khối: `torsoRings` (rộng thêm, gấu, eo), `strip` (dải phẳng bám theo mặt trước/sau thân: mép áo khoác, nẹp khuy, yếm, dây đeo), `pelvis` (lưng quần cao khi đóng thùng), `belt`, `legs` (độ rộng), `arms` (ngắn/dài/xắn, măng-sét), `shoes` (thấp/ủng).
- `rig.ts`: `OUTFIT_COLORS` cho màu cố định của từng bộ. `zombieLook` chọn bộ theo băm ID (bit 17).
- Geometry vẫn cache theo `preset/hair/outfit`: tối đa 36 khóa cho zombie. Chỉ dựng khi gặp lần đầu; không bao giờ tăng theo số zombie.
- Chi tiết quần áo không có collider hay hitbox.

## 3. Kiểm tra đã chạy

- `appearance.test.ts`:
  - nội dung có 4 bộ, `randomAppearance` ra đủ 4 bộ;
  - `outfit` tùy chọn: save 5 khóa hợp lệ và vẽ `tee`, bộ lạ và khóa lạ bị từ chối;
  - save/load giữ `outfit`; save không có `outfit` nạp không migration, giữ nguyên appearance; túi đồ và trang bị không đổi.
- `body.test.ts`:
  - 3 preset × 3 tóc × 4 bộ: cao 1,74–1,85 m, trong capsule, chân ở sàn;
  - 40 zombie mặc đủ 4 bộ, geometry ≤ 36;
  - 4 bộ có số tam giác khác nhau, áo khoác rộng hơn áo thun, mọi bộ ≤ 0,8 m;
  - đi/chạy với áo thun, đồ lao động, áo khoác: chân không lơ lửng hay lún.
- Toàn bộ: **636 test**; lint, tsc, build, build:editor, check:bundle sạch.
- Playwright `p2-s3-browser` (`GPU=1`) PASS. Script chọn "Đồ lao động" và kiểm tra appearance trong save, sau khi nạp lại và trên rig. Kỳ vọng 5 khóa cũ thêm `outfit`.
- Bench (`docs/character/c2/`, cùng máy, headless D3D11, uncapped): 0/10/30 zombie → draw call 52/70/104, như C1. Tam giác 30 zombie 110 k.
  - Frame 1,0/1,5/2,5 ms, thấp hơn lần đo C1 vì máy lúc đó bận hơn. Không so frame time giữa hai lần đo; so sánh A/B để C6.
  - Vòng đời: geometry 58 → 68 là các khóa hình dạng mới gặp lần đầu (ID zombie tăng dần qua mỗi vòng). Texture và program không đổi.

## 4. Giới hạn

- Không đổi phong cách tóc hay thêm phụ kiện (mũ, túi) — ngoài yêu cầu tối thiểu.
- 36 geometry zombie × ~200 KB (không đánh chỉ số) ≈ 7 MB GPU nếu gặp đủ. C6 sẽ đo và gộp đỉnh nếu cần.
- Quần áo rách/bẩn cho zombie: C5.
