`# Đồ họa G5: tích hợp editor và hợp đồng dữ liệu
`
`Ngày 27/09/2026. §9 của `docs/Graphics_Improvement_Implementation_Plan.md`, sau G4.
`
`## 1. Hợp đồng dữ liệu (đã có qua G2–G4, G5 kiểm lại)
`
`Map chỉ lưu ID ngữ nghĩa và transform; không lưu material, geometry hay đối tượng runtime nào.
`
`| Trường | Ở đâu | Registry + validator |
`|---|---|---|
`| \`visual.floor\`, \`floorColor\` | phòng | bề mặt G1 (lỗi nếu lạ) |
`| \`visual.assetId\`, \`facing\`, \`yaw\`, \`variantId\` | prop, container | đồ đạc G3a/G3b/G4 (mẫu lạ: cảnh báo, vẽ hộp trơn) |
`| \`decor { assetId, position, yaw, color, variants }\` | object prefab/chunk | đồ trang trí G3b/G4 (mẫu lạ: cảnh báo, hộp nhỏ tím xám) |
`| \`visual.variants\` | prefab | biến thể nhà G3b |
`| \`visual.variantId\` | instance | biến thể nhà G3b (không có: seed ổn định) |
`
`- Đổi ngoại hình không đổi ID của cửa, tủ, cửa sổ hay đèn. Va chạm và nav không đổi vì mẫu luôn nằm trong hộp cũ; đồ trang trí không có va chạm.
`- Không thêm `materialSetId` hay `decorSeed`: chưa có nhu cầu. Bảng màu biến thể và seed biến thể đã đủ; kế hoạch dặn không thêm trường không dùng.
`- Biến thể không bao giờ đổi loot table (test so container giữa hai biến thể: giống hệt).
`- Cắt lớp và mask từng mảnh vẫn đúng khi gộp batch, nhờ `anchor` (G2/G3) và bóng tiếp xúc áp trước mask (G4).
`
`## 2. Editor
`
`- **Cùng một bộ dựng cho editor và game** (kế hoạch: "tránh hai phiên bản model khác nhau"):
`  - `lookParts` (`furniture/placement.ts`): mặt trước tự động hoặc cho trước, góc lệch, kiểu theo biến thể nhà.
`  - `placeDecorParts` (`decor/assets.ts`).
`  - `collectStaticItems` của game và `drawItems` của editor cùng gọi hai hàm này.
`  - Khung nhìn editor giờ vẽ đồ đạc, đồ trang trí, xe, hàng rào, bụi cây như trong game, với màu biến thể của nhà.
`  - Editor vẫn không vẽ mái, chi tiết kiến trúc G2, bóng và mask, để thấy bên trong khi sửa.
`- **Hộp thật khi đặt:** mỗi prop hoặc tủ có mẫu có thêm một dải mờ ở chân bằng đúng hộp va chạm, cả khi xem trước lúc đặt. Nhờ vậy đặt không bị chồng dù mẫu nhỏ hơn hộp (ghế lệch).
`- **Palette:** nhóm có tên (Tường, Cửa, Nội thất, Tủ, Trang trí, Phòng); preset có mẫu sẵn; 4 cụm trang trí. Thumbnail prefab (SVG từ trước) không đổi.
`- **Inspector:** mẫu, mặt trước, góc lệch, kiểu (đồ đạc); mẫu, xoay, màu, "chỉ hiện ở" (đồ trang trí); biến thể nhà (prefab); biến thể (instance). Mẫu lạ được giữ và báo "không có trong registry".
`- **Nhân bản** giữ ngoại hình, cấp ID mới. **Export/import** giữ mọi trường ngoại hình (test).
`- **Hướng dẫn** trong `docs/map-editor-guide.md`, mục "Ngoại hình".
`
`## 3. Nghiệm thu G5 (tự động)
`
``src/map/editor/visualContract.test.ts` (4 test):
`1. **Editor và game khớp nhau:** mọi mảnh đồ đạc của nhà A mà game vẽ đều có trong dữ liệu vẽ của editor, cùng tâm, cỡ và góc xoay. Đồ trang trí trên bàn và tủ cũng ở cùng chỗ; đồ trên sàn chỉ lệch vài mm vì độ nâng khác nhau.
`2. **Nhân bản và export/import:** nhân bản ghế lệch, cốc (chỉ ở "có người ở") và thảm giữ nguyên ngoại hình dưới ID mới; nhân bản xe và bụi cây ở world cũng vậy. Export rồi import ra lại đúng từng prefab, instance (cả biến thể) và object.
`3. **Dựng nhà bằng editor:** prefab mới, tủ quần áo và giường từ palette, cụm "góc bếp" và "chuẩn bị di tản", biến thể nhà, đặt một instance "bỏ hoang". Không có lỗi validate. Bản export nạp vào game: có đủ mẫu, tủ quần áo là container có loot, game chạy được.
`4. **Save cũ:** một save của lab trước khi có garage (content v1) nạp vào v2 qua migration. Cửa đang mở vẫn mở, đồ trong tủ bếp giữ nguyên, người chơi giữ vị trí, kệ đồ nghề của garage được sinh loot như New Game.
`
`## 4. Kiểm chứng
`
`- **Test:** 622 qua, 13 skip (mới 4).
`- **Test thời gian nav:** `streaming` hỏng khi chạy cả bộ lúc máy bận, chạy riêng thì qua; xem G6.
`- **Công cụ:** lint, `tsc`, `build`, `build:editor`, `check:bundle`, `map:check --deep` sạch.
`- **Bundle game:** +0,2 KB (chỉ tách hàm).
`- **Playwright PASS:** mọi script editor `m3`, `m4`, `m5`, `m6`, `m7`, `m8`, `m9`, `m11a`, `m11c2`, `g3a-furniture`, `g3b-decor`, cùng `worlds`.
`- **Hiệu năng game:** không đổi. G5 chỉ tách hàm dùng chung; test so khớp từng mảnh vẫn qua.
`- **Ảnh:** `docs/graphics/g5/g5-prefab-iso.png` (prefab nhà mẫu trong editor) và `g5-world-iso.png` (world lab trong editor).
`
`## 5. Giới hạn
`
`- Editor chưa vẽ mái, khung cửa/cửa sổ G2, vạch sơn/bó vỉa G4, bóng tiếp xúc và mask; khi cần hình cuối cùng thì dùng "Chơi từ đây".
`- Thumbnail prefab chưa có đồ đạc.
