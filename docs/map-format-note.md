# Ghi chú kỹ thuật — Giới hạn của định dạng map hiện tại

Ngày: 25/09/2026 (refactor R0–R2). Không triển khai gì ngoài map stress lặp ô (`world/stressMap.ts`, chỉ dev).

> **Đã triển khai** ở map content M1–M2 (R3a): định dạng chính thức nằm ở `docs/map-content-format.md`, báo cáo ở `docs/map-editor-m1-m2.md`. Phần dưới đây là ghi chú lịch sử lúc đề xuất.

## Hiện trạng

- Map là **hằng số TypeScript** trong `world/mapData.ts`: `BuildingDef` (tâm, kích thước, cửa, cửa sổ, vách, phòng, đèn, container), vật cản, đường, điểm spawn, vùng zombie. Hàm sinh (`generateBuildingWalls`, `generateDoorPlacements`, `generateWindowPlacements`, `generateRooms`) tạo ra tường/cửa/cửa sổ/phòng lúc nạp module.
- `MapData` là một khối duy nhất: hình vuông `size`, tâm ở gốc tọa độ. `NavGrid`, spatial index, collider và scene đều dựng **toàn bộ** map cùng lúc.
- ID viết tay (`door-safehouse`, `ct-store-shelf-1`…) và là khóa của save (cửa, container, rèm, đèn). Các migration lưu dấu nội dung thêm sau theo từng phiên bản ngay trong code map (`CONTAINERS_ADDED_V3/V5`, `DOORS_ADDED_V7`, `WALL_PREFIXES_ADDED_V7`).
- Không có công cụ biên tập map, không có khái niệm chunk, và không có metadata nội dung (phiên bản map, danh sách prefab).

## Giới hạn

| Giới hạn | Hệ quả khi map lớn |
|---|---|
| Viết tay bằng code | Hàng trăm/nghìn nhà không thể viết tay; mỗi thay đổi nội dung là thay đổi code và build lại |
| Một khối, nạp hết | Không stream được; thời gian khởi động và bộ nhớ tăng theo kích thước map |
| Tọa độ tuyệt đối, tâm gốc | Không có đơn vị để nạp/gỡ (chunk); không tách "nội dung tĩnh" và "thay đổi của người chơi" theo vùng |
| ID phẳng toàn cục | Dễ trùng khi ghép nhiều khu; migration phải liệt kê ID thủ công |
| Dữ liệu và migration trộn trong một module | Sửa map có nguy cơ làm hỏng save cũ |
| Nhà là tham số của một mẫu chữ nhật | Không tái sử dụng bố cục nội thất; ghép vách/phòng phức tạp chỉ làm được bằng code |

## Đề xuất: prefab + layout JSON theo chunk (sinh offline, có thể theo seed)

1. **Prefab công trình** (JSON, tọa độ cục bộ): footprint, tường/vách, cửa, cửa sổ, phòng/đèn, **slot** container (loại + bảng loot), điểm tương tác. Gồm các nhà hiện có (nhà an toàn, cửa hàng, nhà dân) và nội thất.
2. **Layout theo chunk** (JSON cho mỗi chunk 32–64 m): danh sách instance prefab `{ prefabId, instanceId, x, z, quarterTurns }`, đường, vật cản rời, vùng zombie, điểm spawn. Chunk là đơn vị nạp/gỡ ở R3 và streaming sau này.
3. **ID ổn định có cấu trúc**: `<chunkId>/<instanceId>/<localId>` (ví dụ `c12_8/house-3/door-front`). Save lưu thay đổi theo ID này; một **bảng ánh xạ** giữ ID cũ của khu phố hiện tại (`door-safehouse` → ID mới) để save v7 vẫn migrate được.
4. **Sinh theo seed là công cụ offline**: một generator (script) ghép prefab thành layout JSON theo seed; game chỉ đọc JSON. Nhờ vậy world tất định, kiểm tra/sửa tay được, không tốn CPU khi chơi và không phụ thuộc phiên bản generator.
5. Metadata: `contentVersion` của layout/prefab để save biết nội dung đã đổi (thay cho các hằng số `*_ADDED_Vn`).

Lý do chọn hướng này thay vì chỉ JSON phẳng hoặc chỉ sinh theo seed khi chạy: prefab cho phép tái sử dụng và giữ nhà có chất lượng thiết kế tay; layout theo chunk khớp trực tiếp với chunk ownership và streaming; sinh offline giữ runtime đơn giản và tất định. Bước đầu tiên (R3) có thể chỉ là chuyển khu phố hiện tại thành 3 prefab + 1 layout chunk, kèm bảng ánh xạ ID, **không đổi gameplay**.
