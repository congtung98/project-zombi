# Plan sửa Building Cutaway & Interior Visibility

> Dành cho coding agent của game zombie React + Three.js. Đọc toàn bộ trước khi sửa code.
>
> Đây là yêu cầu triển khai dựa trên hành vi mong muốn, chưa phải báo cáo audit repository. Thiết kế lấy cảm hứng từ trải nghiệm quan sát trong Project Zomboid, không khẳng định mô phỏng chính xác mã nguồn hay mọi build của PZ.

## 1. Mục tiêu

Sửa cơ chế hiển thị công trình để người chơi nhìn được nhân vật và phần nội thất mà nhân vật có thể quan sát, ngay cả khi vẫn đang đứng ngoài nhà nhìn qua cửa/cửa sổ.

Các tình huống cần hỗ trợ:

- Đứng xa công trình: giữ hình dáng mái và tầng trên khi chúng không cần cutaway.
- Đứng ngoài, nhìn qua cửa/cửa sổ hợp lệ: loại bỏ mái, sàn tầng trên hoặc phần tường che vùng nội thất cần quan sát từ camera.
- Vào tầng trệt: nhìn được tầng trệt, không bị mái/sàn tầng trên che.
- Lên tầng trên: đổi tầng hiển thị ưu tiên theo mặt sàn nhân vật thực sự đang đứng.
- Đứng sau tường gần camera: tường không che nhân vật hoặc các mục tiêu đang nhìn thấy theo quy tắc game.
- Rời công trình/quay hướng nhìn: khôi phục kiến trúc ổn định, không nhấp nháy.

Điều bắt buộc: không biến cutaway thành nhìn xuyên tường, không làm tối môi trường ngoài trời và không làm sáng nội thất chỉ vì mái bị ẩn.

## 2. Chỉ dẫn bắt đầu cho agent

1. Đọc `AGENTS.md`, tài liệu kiến trúc và source thực tế.
2. Tìm code renderer, player vision/LOS/FOV, roof hiding, floor selection, room detection, lighting, prefab resolver và runtime collider registry.
3. Tái hiện và ghi lại hành vi hiện tại bằng một scene nhỏ trước khi sửa.
4. Xác định hệ thống nào đang sở hữu `visible`, opacity, render layers, clipping và shadow state của kiến trúc; tránh nhiều system ghi đè cùng property.
5. Triển khai theo milestone trong tài liệu. Tái sử dụng spatial index/navigation/vision hiện có nếu phù hợp; không viết lại engine.
6. Không mặc định repo dùng React Three Fiber. Kế thừa cách tích hợp React + Three.js thực tế.
7. Tự xử lý các quyết định kỹ thuật có thể suy ra từ code. Chỉ hỏi khi có xung đột yêu cầu hoặc thay đổi sản phẩm không thể xác định.

Tên module và field trong plan là gợi ý hợp đồng, không phải tên file đã xác minh.

## 3. Tách ba hệ thống độc lập

| Hệ thống | Trách nhiệm | Không được làm |
| --- | --- | --- |
| Player Vision | Xác định nhân vật thấy vùng/đối tượng nào theo FOV, LOS, tầng và luật gameplay | Dùng camera cutaway để suy ra nhìn xuyên tường |
| Building Cutaway | Bỏ phần kiến trúc cản camera quan sát vùng/mục tiêu hợp lệ | Xóa collider, vision blocker, đổi trạng thái cửa |
| Lighting | Tính ánh sáng ngày/đêm, đèn và môi trường trong/ngoài nhà | Đổi ambient/exposure theo việc mái đang bị ẩn |

Hai đường kiểm tra khác nhau:

- **Character LOS:** từ nhân vật tới vùng hoặc mục tiêu trong thế giới.
- **Camera occlusion:** từ camera tới nhân vật/vùng/mục tiêu đã được chọn để trình bày.

Không chỉ raycast camera → player. Trường hợp nhân vật ở ngoài cửa sổ cần xét cả vùng trong phòng mà nhân vật đang nhìn vào.

Không dùng danh sách mesh đang render làm nguồn duy nhất cho LOS. Mesh tường bị ẩn vẫn phải chặn tầm nhìn vật lý nếu không có cửa/cửa sổ hợp lệ.

## 4. Quy tắc hành vi

| Trạng thái | Kiến trúc hiển thị | Thông tin được phép lộ |
| --- | --- | --- |
| Ngoài nhà, không thấy nội thất | Giữ công trình; chỉ xử lý occluder cần thiết để thấy player | Không tự lộ nội thất chưa biết |
| Ngoài nhà, thấy phòng qua cửa/cửa sổ | Cutaway các nhóm che vùng quan sát | Chỉ phần visibility hợp lệ hoặc dữ liệu đã biết theo luật memory hiện có |
| Trong tầng trệt | Ẩn roof/ceiling/upper-floor surfaces che tầng trệt; xử lý tường phía camera | Không tự thấy zombie trong phòng kín kế bên |
| Trong tầng hai | Ưu tiên tầng hai, ẩn phần nằm trên cần thiết | Không tự thấy zombie ở tầng khác |
| Nhìn qua cửa vừa đóng hoặc rèm vừa kéo | Cập nhật LOS ngay, cho kiến trúc khôi phục mượt | Không giữ zombie thật hiển thị trong thời gian fade |
| Rời nhà | Khôi phục phần kiến trúc hết lý do cutaway | Không ảnh hưởng collision, AI hay save |

Tường kín chặn LOS; cửa mở có thể cho LOS đi qua; cửa kính/cửa sổ có thể cho nhìn dù không đi xuyên được. Cửa đóng có kính, rèm, ván bịt và tình trạng phá hủy phải tuân theo thuộc tính thật của game, không hard-code rằng mọi cửa đóng đều giống nhau.

Phần mái cần ẩn có thể thuộc công trình khác nếu nó thực sự che player hoặc mục tiêu hợp lệ từ camera. Không giới hạn thuật toán chỉ vào `player.currentBuildingId`.

## 5. Audit trước khi sửa

Agent cần báo cáo ngắn:

- Điều kiện hiện tại để ẩn mái: vào building bounds, vào room, khoảng cách hay LOS?
- Sàn tầng trên, mái, tường có được tách mesh/nhóm riêng không?
- Prefab có `buildingId`, `roomId`, floor và bounds chính xác sau rotation không?
- Cửa/cửa sổ có thông tin aperture thực tế hay chỉ một điểm tương tác?
- Tầm nhìn có mask theo vị trí hay chỉ cờ visible cho cả phòng/entity?
- Mesh bị ẩn có làm mất shadow, collision hoặc vision blocker không?
- Có dùng material chung giữa các nhà khiến đổi opacity một nhà tác động nhà khác không?
- Editor Play From Here và gameplay thật có dùng cùng đường dựng prefab không?

Không tự giả định hệ thống nhiều tầng đã có. Nếu chưa có, hoàn thành hành vi tầng trệt và một fixture hai tầng để xác minh renderer; ghi rõ giới hạn di chuyển/cầu thang còn thiếu.

## 6. Metadata công trình

Tận dụng map schema hiện có, bổ sung tối thiểu khi cần:

| Field/khái niệm | Vai trò |
| --- | --- |
| `buildingId` | Instance công trình ổn định |
| `roomId` | Phòng hoặc vùng không gian |
| `floorIndex` | Tầng ngữ nghĩa; không suy ra chỉ bằng làm tròn Y |
| `renderRole` | `floor`, `ceiling`, `roof`, `wall`, `opening`, `prop` |
| `cutawayGroupId` | Nhóm kiến trúc có thể cutaway cùng nhau |
| `coversRoomIds` | Những phòng/vùng nằm dưới phần mái/sàn che phủ |
| `bounds` | Giới hạn không gian phục vụ broad phase |
| Portal/aperture | Hình học ô cửa, phòng/vùng hai phía và trạng thái cho phép nhìn |

Mái hiên cũng cần coverage metadata; không ép mái hiên thành phòng trong nhà vì có thể làm sai lighting/loot/indoor detection.

`cutawayGroupId` phải được namespace theo instance để hai căn nhà dùng cùng prefab không cùng bị ẩn ngoài ý muốn.

Một sàn tầng hai có hai vai trò: mặt sàn cho người đứng tầng hai và vật che tầng trệt từ camera. Tính visibility theo tầng đang quan sát và coverage, không xóa toàn bộ object khỏi world.

Model nguyên khối phải được tách render primitive/submesh hoặc có cơ chế mask phù hợp trước khi cutaway riêng mái/tường. Không ẩn cả root group khiến nội thất và collider con cùng biến mất.

## 7. Pipeline runtime đề xuất

### 7.1. Xác định observer context

Lấy player position, hướng nhìn, mặt sàn đang đứng, room/building hiện tại và camera projection.

Floor selection dùng dữ liệu mặt sàn/room/transition sẵn có. Trên cầu thang phải có ngưỡng chuyển tầng ổn định, không đổi qua lại chỉ do Y dao động.

### 7.2. Lấy vùng nội thất ứng viên

Dùng spatial index/bounds để tìm công trình và cửa/cửa sổ gần player, trong phạm vi vision. Đây chỉ là bước lọc, không phải bằng chứng nhìn thấy.

- Khi ở trong phòng: phòng hiện tại là vùng ưu tiên cho cutaway, nhưng từng mục tiêu vẫn chịu luật visibility.
- Khi ở ngoài: chỉ tạo vùng reveal khi có LOS thật đi qua aperture hợp lệ hoặc hình học nhìn trực tiếp tương đương.
- Không dùng khoảng cách gần tường làm điều kiện duy nhất để lộ cả nhà.

### 7.3. Xác định visible interior region

Tái sử dụng vision mask/grid/polygon hiện tại nếu nó biểu diễn đúng tường và aperture. Nếu hệ thống mới chỉ kiểm tra entity, bổ sung biểu diễn vùng quan sát để tránh lộ nội thất toàn phòng.

Có thể chọn một cách phù hợp engine:

- Visibility grid theo tầng với blocker/edge đủ chính xác cho cửa sổ.
- Visibility polygon trên mặt phẳng của tầng.
- Portal traversal có giới hạn, kết hợp LOS thật tới các vùng/mục tiêu.

Không cần triển khai cả ba. Một ray tới tâm phòng hoặc tâm cửa sổ không chứng minh toàn phòng nhìn thấy. Các ray mẫu thưa chỉ nên giúp chọn nhóm kiến trúc ứng viên; quyền hiển thị entity vẫn phải kiểm tra chặt chẽ.

Portal nối hai room không tự khiến room phía sau hoàn toàn visible. Phải xét hướng, aperture và vật cản trên đường nhìn. Không cho xuyên nhiều phòng bằng graph connectivity đơn thuần.

### 7.4. Chọn phần kiến trúc cần cutaway

Từ player và các vùng/mục tiêu hợp lệ, tìm nhóm roof/ceiling/upper-floor/wall che camera.

- Dùng room coverage và bounds để lọc trước.
- Với camera orthographic, dùng hướng nhìn song song hoặc ray qua tọa độ màn hình tương ứng; không mặc định mọi ray phải xuất phát từ cùng vị trí camera như perspective.
- Phạm vi ẩn cần đủ thấy vùng quan sát; không raycast mọi triangle của toàn world mỗi frame.
- Mỗi group giữ tập lý do hoặc request count: player bị che, phòng đang nhìn, mục tiêu đang thấy. Chỉ khôi phục khi hết lý do.

MVP được phép cutaway theo nhóm lớn hơn, như toàn roof group của một công trình liên quan, **chỉ khi visibility mask vẫn che được phần nội thất chưa được phép thấy**. Nếu chưa có mask này, không dùng cách ẩn cả mái để lộ cả nhà.

### 7.5. Compose visibility một nơi

Tạo một điểm quyết định render cuối cùng để các system không ghi đè nhau:

- Kiến trúc: content enabled + chunk ready + floor policy + cutaway policy.
- Entity động: content enabled + floor policy + live vision policy của game.
- Nội thất tĩnh: live visibility và/hoặc memory policy đang có, không tự thêm bản đồ nhớ mới trong đợt sửa này.

Không áp dụng quy tắc ẩn nội thất chưa thấy bằng cách nhân tối màu toàn màn hình. Mask phải giới hạn đúng nội thất/tầng liên quan.

## 8. Cách render và chuyển trạng thái

### Roof/upper floors

Ban đầu có thể hard-hide đúng group để kiểm chứng logic. Sau đó thêm fade/dither nếu cần. Ẩn tất cả surfaces che phía trên vùng quan sát, gồm mặt sàn, mái, trần và props trên tầng bị ẩn có thể gây vật thể lơ lửng.

Không ẩn sàn đỡ chân player. Không cắt mọi công trình trên toàn map theo `floorIndex > playerFloor`.

### Walls

Ưu tiên cắt phần trên của đoạn tường che camera, giữ chân tường hoặc đường viền để đọc bố cục. Có thể dùng clipping/mask hoặc geometry chia sẵn theo hệ renderer hiện có.

Tường phía sau không che vùng quan sát có thể giữ nguyên. Cửa/window frame cần cùng chính sách với tường liên quan để không tạo vật thể lơ lửng.

### Fade và hysteresis

- Thời gian chuyển gợi ý 150–300 ms, là giá trị khởi đầu cần tinh chỉnh.
- Có hysteresis ngắn khi mất lý do cutaway để tránh nhấp nháy tại biên cửa/phòng.
- Hysteresis chỉ dành cho kiến trúc. Mất LOS với zombie phải cập nhật theo luật vision ngay, không chờ mái hiện lại.
- Không fade qua lại mỗi frame do ray/room detection không ổn định.

### Material và shadow

- Không đổi opacity/clipping trên material dùng chung mà thiếu isolation theo instance/group.
- Transparency cần xử lý depth và sorting; không đặt `depthTest = false` cho toàn bộ nội thất để ép hiện lên trên tường.
- Tránh rò sáng khi ẩn mái: cutaway cho camera không được tự loại mái khỏi lighting/shadow occlusion vật lý.
- Nếu dùng shadow map, cần đường shadow-only hoặc shadow-pass tương đương vẫn thể hiện mái/tường; clipping dùng cho camera không tự áp vào shadow pass nếu trái mục tiêu này.
- Không giả định `mesh.visible = false` vẫn giữ shadow. Xác minh cách renderer thực tế xử lý.
- Nếu lighting hiện tại chưa mô phỏng mái chắn sáng, bảo toàn baseline và ghi giới hạn, không tự thêm ambient light để che lỗi.
- Material clone và resource riêng phải dispose đúng khi unload; không dispose asset dùng chung.

## 9. Chunk lifecycle, editor và save

- Đăng ký room, aperture, coverage và cutaway group khi chunk/dependency sẵn sàng.
- Công trình vượt chunk phải giữ đúng ownership/reference, không có hai group điều khiển cùng mesh.
- Chunk chưa nạp không được coi là không có tường; không reveal qua vùng thiếu dữ liệu.
- Unload gỡ request, cache, ray targets và resource do system sở hữu.
- Cutaway/fade là state trình bày tạm thời, không ghi vào save gameplay hoặc prefab JSON.
- Trạng thái cửa/rèm/ván bịt vẫn lấy từ runtime/save thật.
- Play From Here dùng runtime pipeline này, trong test save riêng.

Editor thêm metadata/validation cần thiết, không bắt mapper viết visibility script cho từng nhà. Hành vi phải dùng được khi duplicate và xoay prefab 0/90/180/270 độ.

## 10. Debug và validation

Có debug overlay bật/tắt để xem:

- Player floor, room và building hiện tại.
- Aperture cho phép/chặn nhìn cùng nguyên nhân.
- Vùng interior đang visible.
- Cutaway group đang ẩn, lý do và target alpha.
- Physical LOS blockers độc lập với render visibility.
- Shadow representation nếu có.

Validator phát hiện missing/invalid floor, coverage trỏ room không tồn tại, aperture sai transform, group ID trùng giữa instances và mái hiên không có coverage.

Không chạy overlay trong production mặc định. Hạn chế log mỗi frame.

## 11. Milestone

### M1 — Audit và scene tái hiện

- [ ] Xác định nguyên nhân mái/tầng hai hiện che nội thất.
- [ ] Ghi rõ nguồn dữ liệu LOS, camera, room và mesh visibility.
- [ ] Tạo fixture: nhà hai phòng, cửa sổ, cửa ra vào, tường kín, mái và sàn tầng trên; thêm nhà thứ hai gần đó.
- [ ] Có baseline ngoài trời ban ngày, ban đêm và trong nhà.

### M2 — Metadata và tách trách nhiệm

- [ ] Room/floor/coverage/cutaway groups đúng sau prefab transform.
- [ ] Physical LOS/collision hoạt động độc lập khi mesh bị cutaway.
- [ ] Có một nơi compose render visibility cuối cùng.
- [ ] Giữ stable ID và save compatibility; migration/default metadata có chủ đích nếu schema đổi.

### M3 — Ngoài nhà nhìn vào và cutaway tầng

- [ ] Đứng ngoài cửa sổ có LOS: thấy phần nội thất hợp lệ mà không bị mái/sàn tầng trên che.
- [ ] Đứng trước tường kín: không lộ nội thất/zombie chưa thấy.
- [ ] Vào nhà: không che player; phòng kế bên vẫn đúng LOS.
- [ ] Tầng đang quan sát đúng; không có props tầng trên lơ lửng.
- [ ] Camera occluder khác building được xử lý khi cần.

### M4 — Chuyển trạng thái và lighting

- [ ] Tường cutaway dễ đọc; roof/wall khôi phục ổn định.
- [ ] Fade/hysteresis không kéo dài việc nhìn thấy zombie sau khi mất LOS.
- [ ] Đóng/mở cửa, rèm và blocker động invalidate cache đúng.
- [ ] Cutaway không đổi ambient, exposure hoặc làm mất shadow mái ngoài ý muốn.
- [ ] Không ảnh hưởng nhà khác do shared material.

### M5 — Regression và bàn giao

- [ ] Chạy checklist ở mục 12 bằng runtime thật.
- [ ] Kiểm tra chunk unload/reload và Play From Here.
- [ ] Đo hiệu năng trước/sau cùng scene và settings.
- [ ] Ghi cách dùng metadata, debug, cấu hình và giới hạn còn lại.

## 12. Ma trận nghiệm thu

| Tình huống | Kết quả cần đạt |
| --- | --- |
| Xa nhà, quay lưng | Không tự cutaway toàn nhà |
| Sát tường kín | Không nhìn xuyên tường |
| Ngoài cửa sổ, đúng hướng | Thấy vùng có LOS; mái/sàn trên không chắn |
| Cửa sổ có rèm kín | Interior visibility bị chặn theo luật game |
| Cửa mở rồi đóng | LOS cập nhật; không ghost zombie trong thời gian fade |
| Hai phòng, vách kín | Phòng đang nhìn không làm lộ zombie phòng còn lại |
| Vào tầng trệt nhà hai tầng | Mái, sàn trên và props che phía trên xử lý đầy đủ |
| Đứng tầng hai | Sàn dưới chân còn, phần trên không che; entity tầng khác đúng luật |
| Di chuyển trên cầu thang | Không nhấp nháy tầng; ghi giới hạn nếu chưa hỗ trợ cầu thang |
| Hai prefab giống nhau | Cutaway một instance không làm nhà kia biến mất |
| Bốn góc xoay prefab | Coverage, aperture, LOS và cutaway đồng bộ |
| Nhà hoặc mái hiên che player từ camera | Player được thấy, vẫn giữ physical blockers |
| Ngoài trời ban ngày | Không bị tối theo FOV/cutaway |
| Nội thất tối, mái vừa ẩn | Không tự sáng lên vì mất shadow/đổi exposure |
| Đèn trong nhà bật/tắt | Lighting vẫn hoạt động độc lập |
| Chunk boundary/unload/reload | Không mất blocker, không stale hidden state/resource leak rõ rệt |

Unit/integration tests tập trung vào transform, visibility composition, floor policy, invalidation khi cửa đổi và lifecycle. Dùng manual/screenshot checks cho chất lượng hình ảnh, ánh sáng và transition. Không chỉ kiểm tra giá trị boolean rồi coi như renderer đã đúng.

## 13. Hiệu năng

- Dùng spatial index lọc công trình gần/đang liên quan trước khi xét aperture và group.
- Cache kết quả theo player/camera movement và revision của cửa/tường/room; invalidation rõ ràng.
- Candidate search có thể chạy tần số thấp hơn render; opacity interpolation chạy theo frame delta.
- LOS gameplay phải cập nhật kịp khi hướng nhìn hoặc blocker đổi; không hy sinh correctness để giữ cache.
- Tránh raycast mọi mesh/triangle mỗi frame và tránh cập nhật React state toàn scene mỗi frame.
- Đo frame time, số query/raycast và số group cập nhật trên cùng fixture. Không cam kết FPS khi chưa đo.

## 14. Điều không được làm

- Chỉ ẩn mái khi `playerInsideBuilding === true`.
- Ẩn toàn bộ nhà khi player ở gần.
- Chỉ raycast camera → player rồi coi như đã hỗ trợ nhìn qua cửa sổ.
- Tắt vision blocker/collider vì mesh bị ẩn.
- Hiển thị cả phòng chỉ vì thấy một cửa sổ.
- Ẩn roof nhưng quên sàn tầng trên hoặc upper-floor props.
- Bật `depthTest = false` để ép zombie/nội thất xuyên mọi vật cản.
- Thay đổi global lighting để giả lập visibility.
- Để kiến trúc hết shadow khi cutaway mà không xem đó là lỗi lighting.
- Lưu cutaway state vào save hoặc hard-code theo tên từng căn nhà.
- Tuyên bố giống PZ hoàn toàn khi chỉ mới làm approximate behavior.

## 15. Báo cáo hoàn thành

Agent cần bàn giao:

1. Nguyên nhân đã xác minh trong code cũ.
2. Các module thay đổi và data flow mới.
3. Cách ngoài nhà nhìn qua cửa sổ kích hoạt cutaway mà không lộ phòng kín.
4. Cách giữ collision, LOS và lighting độc lập với mesh presentation.
5. Test đã chạy, ảnh trước/sau và kết quả performance nếu đo được.
6. Các giới hạn chưa hỗ trợ, đặc biệt multi-floor/stairs/shadow nếu còn thiếu.

**Bắt đầu bằng M1, sau đó sửa xuyên suốt tới khi các tình huống nghiệm thu liên quan đạt. Không dừng ở việc thêm nút bật/tắt mái hoặc chỉ sửa trường hợp player đã vào trong nhà.**

## Tham khảo nguyên lý PZ

- [38 IWBUMS n’ Roofs — The Indie Stone](https://projectzomboid.com/blog/news/2017/06/38-iwbums-n-roofs/): mục tiêu hiển thị công trình và không che zombie nhân vật đã thấy; bài phát triển lịch sử, không phải đặc tả build hiện tại.
- [How to update buildings to use the new roof occlusion system](https://theindiestone.com/forums/topic/23394-how-to-update-buildings-to-use-the-new-roof-occlusion-system/): liên hệ roof occlusion với room definitions và vùng mái ngoài trời.

Các thuật toán, metadata và milestone ở trên là đề xuất riêng cho dự án React + Three.js.
