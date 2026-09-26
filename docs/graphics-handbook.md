# Sổ tay đồ họa

Bàn giao của kế hoạch `docs/Graphics_Improvement_Implementation_Plan.md` (§13), sau G0–G6. Chi tiết từng bước nằm ở `docs/graphics-g0.md` … `docs/graphics-g6.md`.

## 1. Định hướng mỹ thuật

**Phong cách:** low-poly có texture nhẹ, bảng màu tiết chế, bề mặt hơi cũ. Không khí hậu tận thế đến từ bố trí và dấu vết (đồ đạc, đồ trang trí, biến thể nhà), không đến từ màn lọc tối.

**Tỷ lệ:** 1 đơn vị = 1 m.

| Vật | Kích thước |
|---|---|
| Tầng | 3 m |
| Cửa | 2,1 m |
| Tường | 0,2–0,3 m |
| Bàn | 0,75 m |
| Ghế | 0,45 m (mặt ngồi) |
| Giường | 2 × 1,6 × 0,55 m |
| Tủ quần áo | 1,9–2 m |
| Xe | 4 × 2 × 1,4 m |

Ở zoom chơi (28 px/m), 1 cm ≈ 0,3 px. Chi tiết dưới 2,5 cm (tay nắm) chỉ còn một điểm ảnh. Vì vậy ưu tiên chi tiết lớn: khung cửa, chia cánh tủ, chân bàn, đệm ghế, chăn gối.

**Bảng màu** (màu nội dung trước tone mapping):

| Nhóm | Ví dụ trong nội dung |
|---|---|
| Tường | `#b9a58c` gạch kem, `#c9b89f` vách trong, `#9c968c` xám (garage) |
| Gỗ | `#6f5a45` tủ, `#8b6f5c` bàn, `#5b4332` gỗ tối |
| Mái | `#5a5f66` xám xanh, `#4f5357` than |
| Cây, cỏ | `#4a5f3c` nền, `#4d6a39` bụi, `#617d43` cỏ |
| Đường | `#55534f` nhựa, `#9b968c` vỉa hè |
| Điểm nhấn | `#8a5a52` đỏ đất, `#a3322a` đỏ hộp đồ nghề, `#3f5f8a` xanh cặp sách |

Kiểm tra màu trong ánh sáng game thật. Không sửa vật liệu sai bằng cách giảm exposure.

**Đúng / sai:**

| Nên | Không nên |
|---|---|
| Đặt đồ theo công năng: nồi ở đầu tủ bếp, thùng đồ cạnh cửa trước | Rải đồ ngẫu nhiên khắp sàn |
| Để biến thể kể chuyện: bỏ hoang = giường bừa, kệ thưa, tường xỉn | Phủ bẩn đều toàn map |
| Dùng màu dịu cho đồ trang trí | Dùng màu đồ trang trí giống đồ nhặt được (đèn vàng) |
| Đặt đồ trang trí trên bàn, tủ, ngoài lối cửa | Che dấu loot trên nóc tủ, hay đặt trong vòng mở cửa (validator cảnh báo) |
| Dùng prop có collider cho đồ to cản đường (bàn, thùng gỗ) | Dùng đồ trang trí cho vật người chơi phải đi vòng |

## 2. Catalog (mọi thứ sinh bằng code; không có asset ngoài)

**Bề mặt** (`src/game/rendering/surfaces/catalog.ts`, G1): 15 vật liệu.
- matte, plaster, brick, woodFloor, wood, tile, concrete, asphalt, dirt, roof, grass, bark, foliage, fabric, paintedMetal.
- Mỗi vật liệu có: cỡ lặp vật lý, cách lấy tọa độ (thế giới / cục bộ / triplanar), roughness, độ đậm.
- Texture chi tiết sinh bằng code **một lần**, seed cố định, vào một texture array 256² × 15 lớp (5,2 MB).

**Đồ đạc** (`src/game/rendering/furniture/`, G3a/G3b/G4): 18 mẫu, dựng trong hộp va chạm.
- Trong nhà: bed, sofa, table, desk, chair, counter, cabinet, fridge, wardrobe, nightstand, bookshelf, shelving, crate, workbench.
- Ngoài trời: car, fence, bin, mailbox.
- Kiểu: giường made/unmade, kệ sách full/sparse, kệ kho goods/tools/sparse.

**Đồ trang trí** (`src/game/rendering/decor/`, G3b/G4): 20 mẫu, chỉ để vẽ.
- cup, plate, pot, cutting-board, food-boxes, cans, bottle, books, papers, clothes, rug, carton, duffel-bag, backpack, jerrycan, toolbox, tires, oil-stain, bush, grass.
- Mẫu đánh dấu `small` bị ẩn ở mức Thấp.

**Biến thể nhà** (`src/game/rendering/variants.ts`, G3b): intact, lived-in, abandoned.

**Chi tiết tự sinh:**
- G2: khung cửa, cửa sổ, bệ, len và chân tường, bậc thềm, mái hông, sàn theo phòng.
- G4: vạch sơn, bó vỉa, bóng tiếp xúc.

**Nguồn và giấy phép:** mọi hình khối và texture đều do code của repo sinh ra. Không dùng file ảnh, model hay asset pack nào của bên thứ ba, nên không cần ghi công. Nếu sau này thêm texture file, catalog bề mặt có chỗ cho nguồn `file` (G1); khi đó ghi nguồn và giấy phép vào đây.

## 3. Thêm một mẫu mới mà giữ đúng ID và va chạm

**Nguyên tắc:** ngoại hình **không bao giờ** đổi ID, va chạm, nav, tầm nhìn, loot hay save. Mẫu luôn nằm trong hộp của object; hộp mới là va chạm.

**Đồ đạc** (prop/container có collider):
1. Thêm ID vào `FURNITURE_IDS` và `FURNITURE` (`furniture/catalog.ts`): nhãn, và `deep` nếu mẫu sâu hơn rộng.
2. Viết builder trong `furniture/assets.ts`. Quy ước khung: x ngang mặt trước, y từ sàn, z từ lưng ra trước; mọi `p.box(...)` nằm trong `dims`. Số lượng chi tiết theo kích thước hộp, chi tiết cố định từ 2,5 cm. Dùng bề mặt `wood`/`fabric`/`paintedMetal`/`matte` (UV cục bộ).
3. Nếu có kiểu thì thêm vào `FURNITURE_VARIANTS`, `FURNITURE_VARIANT_LABELS`, và (nếu hợp) `VARIANTS[…].furniture`.
4. Thêm cỡ thử vào `SIZES` trong `furniture.test.ts`. Test sẽ báo bộ phận nào lố ra ngoài hộp.
5. Nếu cần, thêm preset palette trong `map/editor/prefabPresets.ts`.

**Đồ trang trí** (chỉ để vẽ):
1. Thêm ID vào `DECOR_IDS` và `DECOR` (`decor/catalog.ts`): nhãn, `size` bao trọn mẫu, màu, `flat` nếu nằm phẳng, `small` nếu chỉ vài pixel.
2. Viết builder trong `decor/assets.ts` (hộp, trụ, cầu, nón; có thể xoay nhẹ). `decor.test.ts` kiểm mọi bộ phận nằm trong `size`.
3. Thêm vào `DECOR_PRESETS` (palette), hoặc vào một cụm trong `prefabPresets.ts`.

**Nội dung:** đặt `visual.assetId` (và `facing`/`yaw`/`variantId` nếu cần) cho prop/container, hoặc object `decor` (xem `docs/map-content-format.md`). Chạy `npm run map:check`.

**Không cần** tăng `contentVersion` khi chỉ đổi ngoại hình hay thêm đồ trang trí. **Phải** tăng (kèm migration, editor tạo được) khi thêm, bỏ hay đổi tên cửa, tủ, cửa sổ, đèn hay zone.

## 4. Mức chất lượng (G6)

Cài đặt → "Chất lượng đồ họa". Chỉ đổi hình và chi phí vẽ; không đổi va chạm, loot, tầm nhìn zombie hay LOS.

| | Thấp | Vừa (mặc định) | Cao |
|---|---|---|---|
| Bóng | thấp (1024) | cao (2048) | cao |
| Tỉ lệ pixel tối đa | 1× | 1,5× | 2× |
| Bóng tiếp xúc | tắt | bật | bật |
| Đồ trang trí rất nhỏ | ẩn | hiện | hiện |
| Lọc dị hướng texture | 1 | 4 | 8 |

Sau khi chọn mức, vẫn chỉnh riêng được bóng và độ phân giải.

## 5. Công cụ đo

- `scripts/g0-graphics-baseline.mjs`: các cảnh cố định của `graphics-lab`, `graphics-rotations` và `neighborhood-50`.
  - Tùy chọn: `--gpu`, `--uncapped`, `--dpr`, `--shadows`, `--scenes`, `--walk=<m/s>` (G6: người chơi đi lại), `--compare`.
  - Báo frame time median/p95, CPU, draw call, tam giác, số tài nguyên, ước tính bộ nhớ texture theo nguồn (có `contact`), vòng đời qua 10 lần vào/ra, thời gian tải.
- Để A/B công bằng: dựng commit cũ trong `git worktree` (junction `node_modules`), chạy dev server thứ hai, đo xen kẽ cũ, mới, mới, cũ.
- Script trình duyệt của từng sprint: `g3a-furniture-editor-browser`, `g3b-decor-editor-browser`, cùng các script M-series.
- **Cần `GPU=1`:** `m11c1a-cutaway`, `m10-streaming`, `p2-s3`, `p2-s5`. Dưới SwiftShader (render bằng CPU), cảnh từ G1 chỉ còn vài FPS, nên các bước chờ theo thời gian thực bị lệch. `r0-perf-browser` dùng `--gpu`.
