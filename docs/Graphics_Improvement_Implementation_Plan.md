# Plan cải tiến đồ họa — Game zombie React + Three.js

> Tài liệu giao việc cho coding agent. Mục tiêu: chuyển cảnh từ các khối màu prototype sang một thế giới low-poly có chất liệu, chiều sâu và dấu vết sinh hoạt, phù hợp game web nhẹ.
>
> Đây là định hướng và hợp đồng triển khai, chưa phải kết quả audit repository. Các budget, tên field và đường dẫn gợi ý phải được điều chỉnh theo code, thiết bị mục tiêu và phép đo thực tế.

## 1. Kết quả cần đạt

- Nhà cửa có tỷ lệ hợp lý, khung cửa, bệ cửa, chân tường, mái và các lớp chi tiết lớn đọc được ở camera gameplay.
- Nội thất có silhouette và cấu trúc riêng: nhìn từ trên phân biệt được giường, sofa, tủ, bàn, bếp; không còn chỉ là những hộp màu giống nhau.
- Có bộ màu và bộ vật liệu dùng chung, texture nhẹ và tỷ lệ vân nhất quán.
- Vật thể có cảm giác tiếp xúc với sàn; ánh sáng tạo chiều sâu nhưng không che mất thông tin chiến đấu.
- Mỗi khu vực có chi tiết cho thấy chức năng và lịch sử sử dụng: bếp, garage, nhà đang di tản, cửa hàng bị bỏ lại.
- Hoạt động đúng với prefab, chunk, stable ID, save, LOS, nhiều tầng và building cutaway hiện có.
- Chất lượng được kiểm chứng bằng ảnh gameplay trước/sau và phép đo trên cùng scene, không chỉ bằng một ảnh render đẹp ở editor.

## 2. Phạm vi và nguyên tắc thực thi

### Trong phạm vi

1. Một scene/căn nhà chuẩn để phát triển chất lượng hình ảnh.
2. Bộ module kiến trúc, furniture và props dùng lại được.
3. Material/texture pipeline và asset registry.
4. Ánh sáng, bóng tiếp xúc và môi trường xung quanh căn nhà.
5. Cụm trang trí có chủ đích và biến thể prefab.
6. Tích hợp editor, cấu hình chất lượng, kiểm thử và profiling.

### Chưa ưu tiên

- Đồ họa photorealistic, texture 4K đại trà, hiệu ứng cinematic nặng.
- Thay toàn bộ map hoặc nhân vật/zombie cùng lúc.
- Viết lại renderer, đổi engine, bắt buộc chuyển sang React Three Fiber.
- Thêm cơ chế gameplay mới chỉ để phục vụ trang trí.
- Mở rộng quy mô map trước khi có bộ asset và budget ổn định.

### Chỉ dẫn cho agent

- Đọc `AGENTS.md`, code và tài liệu hiện tại trước khi chỉnh sửa.
- Kế thừa registry, batch rendering, instancing, cutaway, vision và asset lifecycle đã có.
- Nếu nhánh cutaway đang được sửa, tích hợp trên interface thống nhất; không tạo một RoofController hoặc visibility pipeline cạnh tranh.
- Làm tuần tự G0–G6, mỗi bước có kết quả chạy được. Không chỉ viết proposal hoặc thêm metadata mà chưa đưa hình ảnh mới vào runtime.
- Không yêu cầu chủ dự án duyệt mọi chi tiết nhỏ. Chốt lựa chọn reversible bằng phong cách trong tài liệu, ghi lại lý do. Không mua asset hoặc nhận điều khoản dịch vụ thay người dùng.
- Không tuyên bố đạt FPS hoặc visual parity khi chưa đo/chụp kiểm tra.

## 3. Art direction

**Phong cách:** low-poly có texture nhẹ, bảng màu tiết chế, bề mặt hơi cũ, không khí hậu tận thế qua cách bố trí và dấu vết sử dụng.

- Hình khối và silhouette rõ ở góc nhìn isometric.
- Chi tiết lớn trước: mái hiên, khung cửa, chia cánh tủ, chân bàn, đệm ghế.
- Texture bổ sung vân và biến thiên nhỏ; không dùng noise mạnh để giả chi tiết.
- Tránh trộn đồ photorealistic với các khối màu hoạt hình chưa xử lý.
- Không phủ bẩn, máu và rác đồng đều lên toàn map.
- Giữ nền môi trường tương đối dịu để player, zombie và vật tương tác dễ đọc.

Palette khởi đầu, dùng như tham chiếu chứ không phải màu cuối sau tone mapping:

| Nhóm | Hướng màu |
| --- | --- |
| Tường | Kem xám, xám ấm, xanh nhạt đã bạc màu |
| Gỗ | Nâu mật ong trầm, nâu xám |
| Mái | Xám xanh, nâu than |
| Cây/cỏ | Olive, xanh rêu, xanh lá ít bão hòa |
| Đường/vỉa hè | Than xám, bê tông ấm |
| Điểm nhấn | Đỏ gạch, vàng mù tạt, xanh biển hiệu |

Kiểm tra palette trong ánh sáng gameplay thật. Không giải quyết vật liệu sai bằng cách giảm exposure toàn scene.

## 4. G0 — Audit, baseline và scene chuẩn

### Audit cần có

- Phiên bản Three.js và renderer/backend đang dùng; kiểm tra API theo phiên bản cài trong repo.
- Camera, zoom thông thường, kích thước viewport và device pixel ratio.
- Color management, tone mapping, output color space và lighting hiện có.
- Asset/material registry; batching/instancing; ownership và disposal.
- Geometry nhà và nội thất đang được tạo ở đâu; UV đã có chưa.
- Cách cutaway, interior mask, shadow pass và floor visibility tác động từng batch item.
- Những object có gameplay state và stable ID: cửa, cửa sổ, container, xe nếu có.

### Scene chuẩn

Tạo hoặc tái sử dụng scene nhỏ gồm:

- Một nhà mẫu có phòng khách, bếp và phòng ngủ; một phần tầng trên để kiểm tra cutaway nếu runtime hỗ trợ.
- Một căn nhà thứ hai dùng chung asset/material để bắt lỗi ảnh hưởng chéo.
- Một đoạn đường, vỉa hè, sân, cây, hàng rào và xe/prop đại diện.
- Một player và số zombie cố định phù hợp scene kiểm thử hiện có.

Giữ nguyên layout gameplay ban đầu khi so sánh. Khóa camera, zoom, thời gian, thời tiết nếu có, seed và settings cho các ảnh A/B.

Chụp tối thiểu: ngoài trời ban ngày, trong nhà/cutaway ban ngày, ngoài trời ban đêm và nội thất bật đèn. Đo thời gian tải, frame time, draw calls, triangles, texture/geometry counts và memory khi có công cụ đáng tin cậy.

**Gate:** có baseline trước khi thêm hàng loạt asset hoặc postprocessing.

## 5. G1 — Bộ vật liệu và texture dùng chung

Tạo material catalog nhỏ trước:

| Material family | Ứng dụng | Đặc điểm |
| --- | --- | --- |
| Painted plaster | Tường trong nhà | Vân rất nhẹ, roughness cao |
| Brick | Tường ngoài | Mạch gạch đọc được, tránh tương phản quá mạnh |
| Wood | Sàn/tủ/bàn | Vân có hướng, tỷ lệ nhất quán |
| Floor tile | Bếp/phòng tắm | Mạch ô rõ vừa đủ ở zoom gameplay |
| Concrete | Vỉa hè/nền garage | Biến thiên nhẹ, ít bóng |
| Asphalt | Đường | Tối vừa phải, không thành vùng đen tuyệt đối |
| Painted metal | Xe/tủ sắt | Phân biệt lớp sơn với phần kim loại lộ ra |
| Fabric | Sofa/đệm/rèm | Màu mềm, độ bóng thấp |
| Roof | Mái nhà | Nhịp tấm/lợp lớn, ít chi tiết li ti |
| Glass | Cửa sổ | Dễ đọc và tương thích LOS/cutaway |

### Quy tắc texture

- Dùng texture tileable khi thích hợp, không tạo file riêng cho từng bức tường.
- Mức khởi đầu đề xuất 256–512 px cho vật liệu nhỏ và 512–1024 px cho bề mặt lặp chính; chỉ tăng sau khi kiểm tra zoom thực tế.
- Khai báo kích thước vật lý của một lần lặp, ví dụ vân gạch ứng với một diện tích bao nhiêu mét.
- UV của tường dài phải lặp, không kéo giãn vân. Xoay prefab phải giữ hướng vân hợp lý.
- Base color và các data maps phải dùng đúng color-space theo renderer/version. Không gán cùng chế độ màu cho mọi texture.
- Roughness/normal maps chỉ thêm khi thấy khác biệt đủ rõ; không bắt mọi asset có đầy đủ bộ PBR maps.
- Normal map không thay thế silhouette/khung cửa. Không dùng displacement nặng cho những chi tiết không đọc được.
- Kiểm tra mipmaps, filtering và hiện tượng shimmering của vân ở khoảng cách xa.
- Nếu dùng atlas, chừa padding phù hợp mipmap; không coi atlas là cách tự động giảm draw calls khi geometry/material vẫn tách rời.

### Quản lý tài nguyên

- Registry ánh xạ semantic material ID sang material config/texture dùng chung.
- Tránh sửa `texture.repeat`, offset, tint hay opacity trên tài nguyên dùng chung làm đổi mọi object ngoài ý muốn. Dùng UV/per-instance parameters hoặc texture/material variant có chủ đích.
- Cutaway/vision mask phải hoạt động với material mới trong cả batch/instance path hiện có.
- Tải lại/chuyển chunk không tạo vô hạn material và texture mới.
- Asset bên ngoài cần nguồn và license rõ ràng; không dùng asset rip từ PZ. Ghi nguồn/attribution trong manifest khi cần.
- Có thể bắt đầu bằng texture tự tạo đơn giản theo tham số. Không để thiếu asset bên ngoài chặn toàn bộ việc hoàn thiện scene.

**Nghiệm thu G1:** cùng vật liệu có tỷ lệ nhất quán trên nhiều kích thước object; không thay đổi nhà khác khi chỉnh một instance; không làm hỏng visibility hoặc ánh sáng.

## 6. G2 — Nâng cấp module kiến trúc

Giữ cấu trúc modular và dữ liệu prefab. Ưu tiên chi tiết bằng geometry đơn giản được dùng lại.

| Thành phần | Thay đổi cần làm |
| --- | --- |
| Tường | Độ dày hợp lý, chân tường, nẹp góc hoặc đường viền có chọn lọc |
| Cửa | Khung, panel lớn, tay nắm; giữ pivot bản lề và interaction point |
| Cửa sổ | Khung, bệ cửa, thanh chia đơn giản, rèm nếu phù hợp |
| Sàn | Material theo công năng phòng, mép chuyển vật liệu rõ |
| Mái | Độ dày mép, hướng dốc phù hợp, máng xối/hiên ở nơi cần thiết |
| Cầu thang | Bậc và lan can dễ đọc, giữ mặt đi và floor transition hiện có |
| Mặt ngoài | Biển số nhà, đèn hiên, hộp thư hoặc chi tiết nhận diện vừa đủ |

Không dùng geometry cực nhỏ cho mọi chi tiết. Chi tiết thường dưới vài pixel ở zoom gameplay nên giản lược, đưa vào texture hoặc chỉ bật ở mức chất lượng cao.

Mỗi chi tiết phải thuộc đúng building/floor/cutaway group. Khi tường cắt thấp, nẹp và khung liên quan cũng phải xử lý đồng bộ; không để tay nắm, rèm hoặc mái hiên lơ lửng.

Model GLB có thể dùng cho module phù hợp nếu đã có pipeline, nhưng không bắt buộc thay nguyên căn nhà. Wall/floor/roof procedural hiện tại có thể tiếp tục dùng.

**Nghiệm thu G2:** nhà nhận diện rõ hơn trong screenshot gameplay; cửa vẫn mở đúng, LOS/collision không lệch; bốn rotation prefab không lỗi UV hoặc cutaway.

## 7. G3 — Nội thất có cấu trúc và cụm trang trí

### Bộ furniture đầu tiên

| Asset | Chi tiết ưu tiên |
| --- | --- |
| Giường | Khung, đệm, gối, một khối chăn đơn giản |
| Sofa | Đệm ngồi/lưng, tay vịn, chân hoặc phần đế |
| Bàn/ghế | Mặt bàn có độ dày, chân và lưng ghế |
| Tủ bếp | Chia cánh/ngăn kéo, tay nắm, mặt bếp |
| Tủ lạnh | Chia ngăn, tay nắm, màu/vật liệu hợp lý |
| Tủ quần áo | Cánh, chân/đế, đường chia lớn |
| Kệ/kho | Khung và tầng kệ; vài nhóm đồ đại diện |

Không cần mọi ngăn kéo đều animation. Chỉ thêm bộ phận tương tác khi gameplay có yêu cầu.

### Cụm trang trí tái sử dụng

Tạo ít nhất vài cụm nhỏ để chứng minh pipeline:

- Bàn ăn bỏ dở: một ghế kéo lệch, cốc, đĩa.
- Góc bếp: nồi, thớt, vài hộp thực phẩm.
- Chuẩn bị di tản: thùng đồ, túi, ghế xô lệch gần cửa nhưng không chặn lối.
- Garage: kệ dụng cụ, can, vệt bẩn cục bộ.

Đặt cụm qua editor/prefab data, không hard-code tọa độ theo tên nhà trong renderer. Không yêu cầu hệ nested prefab tổng quát nếu repo chưa có; có thể dùng thao tác editor bung cụm thành các object có ID riêng.

Phân biệt rõ:

- `decorative`: đồ trang trí, mặc định không tạo collider nhỏ hoặc tương tác giả.
- `interactive`: object gameplay thật, giữ stable ID, collider và behavior hiện có.

Trang trí trông như đồ loot cần có quy ước hình ảnh nhất quán để người chơi không liên tục thử nhặt đồ vô dụng. Không rải đồ lên container/lối mở cửa làm khó tương tác.

### Biến thể

Từ cùng layout, tạo variant có chủ đích như intact, lived-in, abandoned. Khác palette, props hoặc mức hao mòn; không random mọi thứ độc lập gây cảnh hỗn loạn.

Biến thể được lưu tường minh hoặc resolve bằng seed ổn định gắn với instance ID và version nội dung. Không thay bố trí mỗi lần load chunk.

**Nghiệm thu G3:** furniture đọc được từ camera chơi; có câu chuyện qua bố trí; không chặn navigation hoặc đổi loot/save ngoài ý muốn.

## 8. G4 — Ánh sáng, tiếp xúc và môi trường

### Ánh sáng

- Sửa cấu hình màu/tone mapping sai trước khi thêm hiệu ứng.
- Duy trì day/night và đèn hiện có, chỉnh có kiểm soát để vật liệu đọc được.
- Không thêm nhiều point light có shadow chỉ để cảnh sáng đẹp hơn.
- Dùng roughness khác nhau hợp lý giữa tường, vải, gỗ và kim loại; vật liệu phi kim không tự đặt metalness cao để làm bóng.
- Emissive có thể biểu diễn bóng đèn sáng, nhưng không mặc định nó tự chiếu sáng phòng trong renderer đang dùng.
- Không bake bóng mặt trời cố định vào base color vì game có chu kỳ ngày/đêm.

### Bóng tiếp xúc và AO

Ưu tiên kiểm tra bóng hiện có và contact ở chân đồ trước. Có thể dùng AO nhẹ hoặc shading cục bộ, nhưng chỉ sau profiling và kiểm tra ảnh A/B.

- AO không thay thế nguồn sáng và không được làm mọi góc phòng đen đặc.
- AO/decals tĩnh phải tương thích đồ có thể di chuyển/phá hủy; tránh bóng cũ còn trên sàn khi object mất.
- AO screen-space có thể thay đổi khi cutaway; kiểm tra halo, đường viền và tầng trên.
- Nếu dùng contact approximation nhẹ, kiểm tra không tràn xuyên tường/sàn hoặc lộ qua mask.

### Tương thích cutaway và interior mask

- Ẩn roof/floor với camera không tự làm mất vật cản ánh sáng và shadow vật lý.
- Giữ đường shadow-only hoặc cơ chế tương đương nếu renderer hiện có cần nó; không nhân đôi mọi mesh không kiểm soát.
- Mask nội thất chưa nhìn thấy không thay ambient/exposure toàn world.
- Material, props và decals mới đều chịu đúng mask/floor policy. Không để thảm, vết bẩn, vật emissive lộ phòng chưa khám phá.
- Đèn động hoặc highlight tương tác không được vô tình cung cấp thông tin entity ngoài LOS trái luật hiện tại.
- Quay lưng ngoài đường ban ngày không biến ngoài trời thành ban đêm.

### Cảnh quan quanh nhà

Thêm một bộ nhỏ: vỉa hè/lề đường, vạch sơn, hàng rào, thùng rác, hộp thư, bụi cây, cây và cụm cỏ thưa. Đặt theo công năng và vị trí, không phủ ngẫu nhiên toàn bộ mặt đất.

Decals/vệt bẩn cần tránh z-fighting và số lớp trong suốt quá nhiều. Kiểm tra trên bề mặt xoay và tại biên chunk.

Xe trong giai đoạn này chỉ nâng ngoại hình nếu đã có: bánh, kính, đường chia thân và màu phù hợp. Không thêm driving simulation.

**Nghiệm thu G4:** có chiều sâu và contact tốt hơn ở cả ngày/đêm; không đổi vision, không rò sáng khi cutaway; hiệu ứng không lấn át gameplay.

## 9. G5 — Tích hợp editor và bảo toàn kiến trúc

### Hợp đồng dữ liệu

Map vẫn lưu semantic IDs và transform. Không serialize material/geometry/scene runtime vào JSON.

Ví dụ ý tưởng cho phần visual config, phải thích nghi schema thật:

```json
{
  "assetId": "furniture/wardrobe_01",
  "visualVariantId": "worn_oak",
  "materialSetId": "residential_muted",
  "decorSeed": 42138
}
```

Không thêm tất cả field nếu không dùng. Chỉ dùng ID/config có registry và validation tương ứng.

- Đổi visual asset không làm đổi entity/container/door identity.
- Collider và navigation giữ nguyên khi chỉ đổi ngoại hình trong footprint cũ.
- Nếu geometry mới lớn hơn footprint hoặc đổi cửa vào, phải cập nhật dữ liệu collision/interaction/LOS liên quan và kiểm tra migration; không coi đó là skin swap đơn thuần.
- Chi tiết nẹp/tay nắm thường chỉ là render parts, không cần gameplay entity riêng.
- Variant properties không được làm thay đổi loot table ngầm.
- Cutaway/mask per-instance vẫn đúng khi renderer gộp nhiều vật vào batch.

### Editor

- Palette có tên và nhóm asset rõ ràng; thumbnail đơn giản nếu pipeline đã có.
- Inspector chọn variant/material set từ danh sách hợp lệ.
- Preview và gameplay dùng cùng visual factory/registry, tránh hai phiên bản model khác nhau.
- Placement preview vẫn thể hiện footprint thật để tránh đặt chồng nhau.
- Duplicate giữ visual config nhưng tạo ID gameplay mới đúng hệ thống hiện tại.
- Import/export giữ visual config; asset thiếu có fallback dễ nhận biết và cảnh báo, không âm thầm thay gameplay data.

**Nghiệm thu G5:** tạo nhà bằng editor với bộ module mới, export rồi runtime load đúng; save cũ vẫn giữ state cửa/container/player.

## 10. G6 — Hiệu năng, quality settings và rollout

### Budget

Agent phải điền bảng đo trên cùng thiết bị/scene trước khi rollout:

| Chỉ số | Baseline | Sau nâng cấp | Budget/nhận xét |
| --- | --- | --- | --- |
| Frame time median/p95 | Đo | Đo | Chốt theo thiết bị mục tiêu |
| Draw calls | Đo | Đo | Giải thích phần tăng |
| Triangles visible | Đo | Đo | Tập trung cảnh gameplay |
| Texture/geometry counts | Đo | Đo | Không tăng mãi sau unload |
| Ước tính texture memory | Đo/ước tính có ghi phương pháp | Tương tự | Không dùng dung lượng PNG làm VRAM |
| Dung lượng tải bổ sung | Đo | Đo | Tách compressed transfer và decoded memory |
| Cold load/warm load | Đo | Đo | Cùng network/cache conditions |

Nếu mục tiêu là 60 FPS thì tổng thời gian mỗi frame tương ứng khoảng 16.7 ms; đây là mục tiêu tham khảo, không phải kết quả đã đạt. Chốt thiết bị và quality tier thực tế thay vì hứa chạy tốt trên mọi máy.

### Tối ưu theo phép đo

- Share geometry/material và instance những chi tiết lặp phù hợp.
- Batch theo material/chunk/cutaway policy; không merge toàn căn nhà thành một mesh không thể cắt lớp.
- Giảm chi tiết nhỏ và dùng LOD khi có bằng chứng hữu ích ở zoom xa.
- Ưu tiên số shadow-casting lights, draw calls, texture memory và transparency trước khi chỉ đếm polygon.
- Tải asset theo nhu cầu, có placeholder hợp lệ trong lúc tải; không block game bởi props trang trí chưa sẵn sàng.
- Texture compression chỉ bổ sung khi build/runtime decoder và browser mục tiêu được kiểm tra; không mặc định nén luôn tốt hơn trong mọi trường hợp.
- Benchmark scene đông hơn có nhiều instance, không chỉ căn nhà mẫu duy nhất.

### Quality tiers gợi ý

| Tính năng | Low | Medium | High |
| --- | --- | --- | --- |
| Hình khối chính, doors, silhouette furniture | Giữ | Giữ | Giữ |
| Vật liệu cơ bản và màu | Giữ | Giữ | Giữ |
| Chi tiết trang trí rất nhỏ | Giảm | Vừa | Đầy đủ trong budget |
| Shadows | Giảm độ phân giải/phạm vi | Cân bằng | Cao hơn nếu đủ budget |
| AO/postprocessing phụ | Tắt hoặc rất nhẹ | Tùy profiling | Tùy profiling |
| Texture/normal detail | Giảm | Chuẩn | Tăng có chọn lọc |

Quality tier chỉ thay đổi trình bày và chi phí render; không làm khác collision, loot, zombie visibility, LOS hoặc độ an toàn của spawn. Không tắt một vật cản gameplay ở Low khiến người chơi được nhìn xuyên nó.

### Rollout

Hoàn thiện căn nhà mẫu trước, sau đó áp cho nhà dân còn lại, safehouse và cửa hàng bằng registry/module chung. Mỗi nhóm kiểm tra nhanh gameplay và ảnh before/after. Không chỉnh tay hàng trăm instance nếu có thể thay asset dùng chung đúng hợp đồng.

## 11. Checklist regression và nghiệm thu cuối

- [ ] Nhà mẫu đẹp hơn rõ ràng ở zoom gameplay, không chỉ khi zoom sát.
- [ ] Các phòng khác nhau đọc được qua vật liệu và nội thất.
- [ ] Player, zombie, cửa và container không chìm vào chi tiết trang trí.
- [ ] Texture không kéo giãn, seam/shimmering ở mức chấp nhận được.
- [ ] Hai nhà chung asset không ảnh hưởng chéo khi đổi variant/cutaway.
- [ ] Bốn rotation prefab hiển thị, UV và tương tác đúng.
- [ ] Nhìn qua cửa sổ không lộ phòng kín; props/decals chịu mask đầy đủ.
- [ ] Mái ẩn không làm phòng sáng bất thường; không có props tầng trên lơ lửng.
- [ ] Day/night và đèn chạy đúng; không bake sai bóng cố định.
- [ ] Cửa mở/đóng, container loot, combat, nav và zombie spawn không regression.
- [ ] Save cũ load đúng, không reset đồ đã loot hoặc state cửa.
- [ ] Editor và runtime hiển thị thống nhất; export/import giữ visual config.
- [ ] Chunk unload/reload không nhân bản props, material hoặc resource liên tục.
- [ ] Low/Medium/High không thay đổi thông tin gameplay được phép thấy.
- [ ] Có ảnh trước/sau và báo cáo profiling trung thực.

Ưu tiên kiểm tra tự động cho registry/reference, stable ID, transform, serialization và resource lifecycle có rủi ro. Kiểm tra hình ảnh/material/lighting bằng render thực tế; không viết hàng loạt test chỉ so sánh các hằng màu.

## 12. Những việc không được làm

- Chỉ thêm texture rồi coi như hoàn thành art pass.
- Tăng polygon/độ phân giải texture hàng loạt mà không đo lợi ích.
- Trộn nhiều asset pack không cùng tỷ lệ và phong cách.
- Đặt mọi material bóng hoặc kim loại để cảnh trông nổi bật.
- Dùng bloom/fog/độ tối để che các vấn đề hình khối.
- Random variant mỗi frame hoặc mỗi lần chunk load.
- Tạo collider cho mọi đồ trang trí nhỏ.
- Merge meshes làm mất cutaway/floor/instance identity.
- Thay đổi save/gameplay để thuận tiện cho nâng ngoại hình.
- Bỏ qua shadow, interior mask và visibility trên shader/material mới.
- Tuyên bố các props đều nhặt được khi chúng chỉ là trang trí.

## 13. Bàn giao

1. Bộ art direction ngắn: palette, tỷ lệ, vật liệu, ví dụ dùng đúng/sai.
2. Scene chuẩn và ảnh trước/sau ở các trạng thái ánh sáng/cutaway.
3. Asset/material catalog và nguồn/license của asset bổ sung.
4. Module kiến trúc, furniture, cụm trang trí và variant dùng được trong editor.
5. Hướng dẫn thêm visual asset mà giữ gameplay identity/collider đúng.
6. Bảng đo hiệu năng, quality settings và các giới hạn còn lại.
7. Danh sách test/manual checks đã thực hiện; không ghi PASS cho việc chưa chạy.

**Bắt đầu bằng G0 và một căn nhà mẫu. Ưu tiên thực tế: tỷ lệ → khung cửa/chân tường → furniture có cấu trúc → vật liệu → contact/lighting → cụm trang trí → mở rộng toàn map.**
