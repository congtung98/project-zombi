# Thị trấn Ngã Tư — world mặc định `neighborhood-50` mở rộng thành 16 × 16 chunk

Cập nhật 2026-09-27, nhánh `feature/prefab-library` (đã merge vào `feature/world-generator`).

## 1. Kết quả

- World mặc định `neighborhood-50` đổi tên thành **Thị trấn Ngã Tư**. Kích thước là 256 chunk (cx, cz từ −8 đến 7), tức 512 × 512 m; vùng chơi ±254 m, có hàng rào biên.
- Khu phố 50 m cũ nằm nguyên ở giữa: giữ mọi ID, nhà an toàn, cửa hàng, nhà dân và điểm xuất phát của người chơi. Bốn đoạn đường `old-north` / `south` / `west` / `east-link` nối khu cũ ra đường vành đai.
- **Đường sá** (vẽ tay, không phải lưới đều):
  - đường vành đai vuông quanh khu cũ;
  - hai đại lộ chữ thập (x = −1, z = −1) chạy từ vành đai ra rìa rừng, cuối là đường đất;
  - mỗi góc phần tư có đường nhánh cấp hai, đường khu dân cư, ngã ba lệch nhau và ngõ cụt ngắn;
  - tổng cộng 173 đoạn đường.
- **Phân khu:**
  - thương mại dọc các đại lộ (lô hẹp kiểu phố Việt, profile `vn-urban`);
  - hành chính quanh đồn công an và bệnh viện;
  - công nghiệp ở góc đông nam, cạnh nhà tù;
  - còn lại là khu dân cư.
- **Compound đặt ở vị trí riêng**, mỗi chỗ được đánh dấu `worldgen:restricted` để generator không xây đè:

  | Compound | Vị trí (x, z) |
  |---|---|
  | Đồn công an | (−56, −28) |
  | Bệnh viện | (90, −32) |
  | Công viên | (128, −30) |
  | Trường cấp ba | (104.5, −110.5) |
  | Đại học | (150, −192) |
  | Nghĩa trang | (−175, −178) |
  | Nhà tù (xoay 90°) | (127, 148.5) |
  | Hồ lớn | (40, 165) |
  | Ao nhỏ | (−105, 115) |
  | Nhà vườn có ao | (−172, 115) |

- **Rừng:** vùng `forest` là một vành từ ±205 đến ±262 m, cây do generator WG5 trồng. Toàn world có 2073 cây, phần lớn nằm ở rìa.
- **Số lượng:**
  - 38 prefab và 310 instance;
  - đủ 37 prefab của thư viện chung, cộng các prefab cũ của world;
  - 3604 object, 28 điểm spawn.
- `validate` cho 0 lỗi và 0 cảnh báo. `map:check --deep` OK (khoảng 3.4 s).

## 2. Cách dựng lại

Script: `scripts/map-tools/town-build.ts`. Script chạy lại từ đầu trên world gốc (content v1) và từ chối chạy nếu world không còn ở v1:

```sh
git checkout -q <commit trước thị trấn> -- content/maps/neighborhood-50   # world 50 m gốc
node scripts/map-tools/town-build.ts [--seed 2026]
node scripts/map-tools/check.ts content/maps/neighborhood-50 --deep
```

Các bước của script:

1. Bản đồ đường, phân khu và vị trí compound được viết dưới dạng GeoJSON (`worldgen:crs: local-metres`).
2. `importGeoJsonLayout` → `planLayout` (seed 2026, lô thương mại theo `vn-urban`) → `placeBuildings`.
3. Prefab thư viện nào còn thiếu thì được đặt vào một lô vừa với nó.
4. `createLayoutWorld` tạo world.
5. Ghép các record của khu cũ vào; `placeCompound` đặt từng compound.
6. Thêm đủ 16 × 16 chunk, khớp lại vùng chơi, cắt bỏ object nằm ngoài vùng chơi.
7. Ghi nguồn thư viện (`source`) cho các prefab giống hệt bản trong thư viện.
8. `writeContentMigration` nâng lên content v2.

World này là **nội dung**: từ giờ nên sửa trong editor. Chạy lại script sẽ ra lại đúng bản này, nhưng mọi chỉnh tay sau đó sẽ mất.

## 3. Tương thích save

- Content v1 → v2: file `migrations/content-v1.json` chỉ ghi lại các ID có trạng thái của khu cũ (cửa, tủ, cửa sổ, đèn, zone). Các ID này không đổi, nên save cũ nạp bình thường.
- Hai file `legacy-v7-*.json` giữ nguyên.
- Toàn bộ test save/liveContent đều pass.

## 4. Thay đổi đi kèm

- Nhà ống `tube-4x16`, `tube-5x18`, `library/tube-house` và `shophouse` có `sideGap` 0.1 m (trước là 0).
  - Lý do: hai nhà liền kề xây sát vạch lô thì tường chồng lên nhau.
  - Hệ quả: nhà ống 4 m không còn vừa lô 4 m, cần lô từ 5 m.
  - Test WG3 đã cập nhật theo.
- `tube-4x16` và `tube-5x18` được đặt ở cả khu dân cư lẫn khu thương mại.
- Asset nội thất mới (commit `3bd7c07`): giường bệnh, bàn mổ, máy công cụ, ATM, bia mộ, ghế công viên, cầu trượt, xích đu, hố cát, cột bóng rổ, cột cờ.

## 5. Giới hạn còn tồn tại

- **Khởi động chậm hơn:** world mặc định vẫn được đóng gói sẵn và dựng lúc import (`NEIGHBORHOOD_MAP`).
  - Chunk `index` của game tăng lên khoảng 1.3 MB (185 kB gzip).
  - Việc dựng world mất khoảng 0.25 s trong chế độ dev.
  - Nếu cần nhanh hơn, có thể chuyển world mặc định sang nạp theo yêu cầu như các world khác.
- **Rìa map:** rừng chỉ là cây rải dày. Ngoài vùng chơi là hàng rào biên.
- **Người chơi xuất phát ở khu cũ** giữa thị trấn. Các khu ở xa (đại học, nghĩa trang, nhà tù) cách khoảng 200 m.
