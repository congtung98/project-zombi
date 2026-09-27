# Plan nâng cấp model và animation Character / Zombie

> Tài liệu giao việc cho coding agent, triển khai sau đợt nâng cấp đồ họa môi trường.
> Hiện trạng theo mô tả của chủ dự án: player và zombie được ghép từ các khối chữ nhật/vuông cơ bản bằng Three.js. Chưa audit repository; mọi tên module và cấu hình dưới đây là đề xuất cần thích nghi với code thật.

## 1. Mục tiêu

Chuyển nhân vật từ hình người ghép hộp sang **low-poly có silhouette người rõ ràng, tỷ lệ gần thực, khuôn mặt tối giản, quần áo có cấu trúc và chuyển động có trọng lượng**.

Giữ chất sinh tồn nghiêm túc, đồng bộ với môi trường đã nâng cấp. Không theo photorealism và không tăng chi tiết chỉ để đẹp khi zoom sát.

Kết quả đầu tiên phải là một player mẫu và một zombie mẫu dùng chung cấu trúc cơ thể/rig phù hợp. Hoàn thiện chất lượng mẫu trước khi nhân rộng trang phục và biến thể.

## 2. Thời điểm và cách triển khai

- Chỉ bắt đầu tích hợp sau khi đợt đồ họa môi trường đã có baseline ổn định và được chủ dự án xem/commit.
- Tái sử dụng art direction, material registry, quality tiers, profiling và scene kiểm thử đã có.
- Không ghi đè phần việc graphics/cutaway đang dở hoặc tự nâng phiên bản Three.js để tiện triển khai.
- **Mỗi lần làm một sprint, dừng báo cáo để chủ dự án xem và tự commit. Không tự commit hoặc tự chuyển sprint.**
- Sprint đầu là C0: audit và baseline. Không viết lại AI, combat, movement hay save trong đợt này.
- Nếu một animation đòi hỏi hành vi gameplay chưa tồn tại, ghi nhận là deferred thay vì tự thêm cơ chế mới.

## 3. Art direction và tỷ lệ

### Hình dáng tổng thể

- Tỷ lệ khởi đầu gợi ý: cao khoảng 7–7,5 lần chiều cao đầu, tinh chỉnh tại zoom gameplay.
- Dùng chiều cao/collider gameplay hiện có làm mốc; không tự đổi kích thước tác nhân để hợp model mới.
- Vai, eo và hông tạo được chuyển tiếp, không là một hộp thẳng đều.
- Bắp tay/cẳng tay và đùi/cẳng chân thuôn nhẹ; bàn tay và giày đúng tỷ lệ.
- Đầu vát góc, hàm thu nhẹ, có cổ và khối tóc đơn giản.
- Không cần cơ bụng, từng ngón tay, facial rig hoặc texture da chi tiết.
- Chi tiết quan trọng nhất ở camera thật: đầu, vai, tư thế, chiều dài chi, quần áo và vũ khí.

### Shading và màu

- Da, vải và tóc ít bóng, không có cảm giác nhựa đồng nhất.
- Smooth shading có chọn lọc ở đầu/chi; giữ cạnh ở cổ áo, gấu áo và đế giày.
- Vát cạnh nơi cải thiện silhouette; không bevel mọi cạnh hoặc để mọi mặt thành faceted rõ quá mức.
- Đồng bộ palette của môi trường: màu đời thường, độ bão hòa tiết chế.
- Quần áo có vài mảng lớn đọc được: cổ áo, đường mở áo, thắt lưng, giày.
- Không dùng viền phát sáng/outline dày để che việc model khó đọc. Highlight tương tác nếu đã có vẫn theo luật cũ.

## 4. C0 — Audit và baseline

Agent cần xác định:

1. Player/zombie visual được tạo ở đâu, có bao nhiêu mesh/material/draw calls mỗi actor.
2. Có skeleton/skinning/AnimationMixer hay animation đang xoay rigid parts bằng code.
3. Root transform, hướng forward, trục up, đơn vị và vị trí gốc ở chân/giữa thân.
4. Movement, rotation, combat phase, damage timing, attack range, hitbox, stagger, death và respawn do system nào sở hữu.
5. Vũ khí được gắn thế nào, điểm grip và pivot ở đâu; animation/sound/hit event kích hoạt bằng gì.
6. Cách áp LOS, floor visibility, cutaway, interior mask và shadow lên actor/phụ kiện.
7. Những visual state nào đã được lưu; ID và RNG dùng để tạo appearance nếu có.
8. Cách render/update nhiều zombie, culling, instancing/batching và tài nguyên dùng chung.

Mở rộng scene lab hiện có hoặc tạo fixture dùng chung runtime: player, một zombie mẫu, một nhóm zombie cố định, cửa, hành lang hẹp, cầu thang nếu được hỗ trợ và nền có grid để thấy foot sliding.

Baseline cần ảnh/video ngắn: đứng, đi, chạy nếu có, đánh, bị đánh, chết; kiểm tra từ các hướng chính ở camera gameplay. Đo frame time và render/resource counts trên cùng mật độ zombie trước/sau.

**Bàn giao C0:** audit, nguồn dữ liệu authoritative, phương án rig được chọn, baseline và dự kiến file/module sẽ sửa. Dừng để người dùng xem và tự commit.

## 5. Chọn phương án model/rig theo audit

| Phương án | Dùng khi | Ràng buộc |
| --- | --- | --- |
| Rigid-part hierarchy cải tiến | Repo đang dùng mesh con và animation procedural, số tác nhân/budget phù hợp | Thuôn hình khối, đặt pivot đúng, che đường nối; đo chi phí nhiều mesh |
| Skinned low-poly model dùng chung rig | Repo đã có hoặc có lý do rõ cần biến dạng khớp/bộ clip tái sử dụng | Chỉ dùng rig đủ cần; kiểm tra deform và chi phí animation đám đông |

Không viết cả hai pipeline đầy đủ. Ưu tiên mở rộng đường hiện có nếu đạt chất lượng; nếu rigid mesh count là bottleneck, đề xuất phương án thay thế bằng số đo.

GLB là lựa chọn asset, không phải điều kiện bắt buộc. Nếu dùng file ngoài, ghi nguồn/license và chuẩn hóa scale, orientation, rig. Không tự mua asset, không dùng model/animation trích xuất từ PZ.

Không mặc định các skinned mesh khác pose có thể được batch bằng instancing thông thường. Nếu cần crowd optimization nâng cao, tách thành việc có bằng chứng profiling.

## 6. C1 — Cơ thể mẫu và khớp nối

### Geometry

| Bộ phận | Thay đổi |
| --- | --- |
| Head/neck | Đầu bớt vuông, hàm thu, cổ nối thân rõ |
| Torso/pelvis | Vai → eo → hông có chuyển, không kéo dãn một cube duy nhất |
| Arms | Upper arm/forearm thuôn, khuỷu rõ, bàn tay nắm gọn |
| Legs | Đùi lớn hơn cẳng chân, cổ chân thu, phân biệt đầu gối |
| Feet | Mũi giày/gót/đế, không thành khối vuông to |

### Rig contract

Cấu trúc gợi ý: actor root → pelvis → torso → neck/head; shoulder/upper arm/forearm/hand; thigh/shin/foot hai bên. Chỉ thêm joint cần animation thật.

- Một root authoritative cho vị trí actor; visual root là con, chỉ chứa offset trình bày.
- Joint pivot ở vai, khuỷu, hông, gối và cổ chân đúng hình học.
- Rigid parts chồng nhẹ hoặc được áo/quần che ở khớp để tránh khe; không lộ khớp cầu kiểu robot.
- Nếu skinning, kiểm tra vai/hông/khuỷu ở pose cực trị để tránh bẹt hoặc xoắn mesh.
- Tránh scale không đều trên hierarchy gây sai rotation, normal hoặc vũ khí.
- Phần cơ thể cần che dưới trang phục phải xử lý để không xuyên áo.
- Bind/rest pose và chiều dài xương phải nhất quán giữa player và zombie mẫu.

**Nghiệm thu C1:** silhouette tốt hơn ở gameplay zoom; không hở khớp ở pose đi/đánh; root/feet đúng mặt sàn; collider và các chỉ số gameplay chưa đổi. Dừng để người dùng xem và tự commit.

## 7. C2 — Quần áo, tóc và player visual

Tạo một bộ player hoàn chỉnh trước, sau đó mở rộng catalog nhỏ:

- Áo thun + quần dài.
- Áo khoác + jeans.
- Áo sơ mi + quần công sở.
- Đồ lao động.

Mỗi bộ cần hình dáng riêng, không chỉ đổi màu thân: cổ/gấu áo, tay áo, độ rộng áo khoác, dáng quần, giày. Có 2–3 khối tóc đơn giản nếu khả thi; không cần hair simulation.

### Registry và appearance

- Appearance dùng semantic IDs: body preset, outfit, hair, palette, variation seed khi cần.
- Không serialize mesh, material hoặc pose vào save.
- Appearance của một actor phải ổn định qua load/chunk transitions. Nếu hệ thống chưa lưu seed/IDs cần thiết, thêm optional fields có default/migration rõ, không hứa tuyệt đối không đổi schema save.
- Các biến thể hình thể lớn ảnh hưởng footprint/reach nằm ngoài scope. Bước đầu dùng cùng rig và kích thước gameplay.
- Shared geometry/material có ownership rõ; đổi màu/visibility một actor không đổi cả đám đông.
- Chi tiết quần áo không tạo thêm hitbox/collider vật lý nếu không có yêu cầu gameplay.

**Nghiệm thu C2:** player khớp phong cách môi trường, outfit đọc được; không xuyên áo nghiêm trọng; appearance đúng sau save/load; giữ nguyên equipment/inventory. Dừng để người dùng xem và tự commit.

## 8. Hợp đồng animation với gameplay

### Nguồn trạng thái

Animation nhận dữ liệu từ movement/combat/AI hiện có, không tự quyết định damage hoặc vị trí world:

- Vận tốc thực tế sau xử lý va chạm.
- Hướng di chuyển và hướng nhìn/aim.
- Đang grounded, tầng/mặt sàn và trạng thái cầu thang nếu có.
- Combat phase và phase progress từ hệ combat.
- Hit reaction/stagger được gameplay cho phép.
- Alive/dead và trạng thái interaction đã có.

Tên các state chỉ là gợi ý: `idle`, `walk`, `run`, `attack`, `hit`, `death`; state không có trong game thì không tạo behavior mới để dùng clip.

### Ownership và thời gian

- Movement controller giữ quyền dịch chuyển; animation mặc định in-place để tránh root motion di chuyển actor lần thứ hai.
- Attack anticipation/contact/recovery phải map vào timing authoritative hiện có. Không dời hit frame một cách ngầm làm thay đổi độ khó.
- Không phát damage bằng cả callback animation lẫn combat update.
- Visual/sound event phải idempotent theo action ID để không lặp do blend, pause, reload hoặc frame hitch.
- Khi FPS thấp bước qua một marker, xử lý crossing đúng; không kiểm tra bằng so sánh float bằng tuyệt đối.
- Update dùng game delta/time policy hiện tại; pause không để animation tiếp tục đánh/chết ngầm.
- Animation không phụ thuộc React rerender mỗi frame.

### Transition

- Idle ↔ walk/run blend ngắn; giá trị khởi đầu có thể khoảng 0.1–0.2 s, tinh chỉnh thực tế.
- Death ưu tiên cao; hit reaction không được hủy attack/movement nếu gameplay không cho phép.
- Không cần state machine mới cạnh tranh với AI/combat; có thể là presentation state machine đọc state của chúng.
- Upper/lower body layering chỉ thêm khi cần di chuyển và đánh/aim đồng thời, theo chính sách hiện có.

## 9. C3 — Locomotion player

### Idle

Chuyển trọng lượng/hô hấp rất nhẹ, chân không trôi. Không lắc toàn thân hoặc đầu quá nhiều gây cảm giác hoạt hình.

### Walk/run nếu đã có

- Foot cadence/stride phù hợp vận tốc thực, kể cả bị tường chặn hoặc bị giảm tốc.
- Chân trái/phải đối pha, tay vung tự nhiên; vai/hông xoay nhẹ.
- Chân chạm sàn rõ, tránh chìm hoặc hover.
- Không tăng playback rate vô hạn khi tốc độ thay đổi; dùng clamp/blend hợp lý.
- Forward, backward và strafe phải khớp cơ chế điều khiển hiện tại; không ép actor xoay để che animation còn thiếu.
- Vũ khí cầm tay không xuyên thân thường xuyên; điều chỉnh arm pose phù hợp.

### Grounding

Ban đầu căn chân theo ground height/floor data có sẵn. Không bắt buộc full IK.

Nếu có cầu thang, kiểm tra visual root/feet không nhảy giữa tầng và không raycast chọn sàn tầng trên thay mặt sàn đang đứng. Foot IK chỉ bổ sung khi có lỗi nhìn rõ cần sửa và budget cho phép.

**Nghiệm thu C3:** đi/dừng/đổi hướng không snap rõ, không chạy tại chỗ khi bị chặn; root không drift; kiểm tra ở frame rate cao/thấp và pause/resume. Dừng để người dùng xem và tự commit.

## 10. C4 — Melee, hit reaction và death

### Attack

Cấu trúc hình ảnh: chuẩn bị → vung/contact → hồi phục, đồng bộ với combat phase thật.

- Có vai/thân tham gia, không chỉ xoay cánh tay như cần gạt.
- Socket/grip gắn vào bàn tay; pivot model vũ khí được chuẩn hóa.
- Giữ attack range, damage và hit detection hiện có; nếu đường vung nhìn không khớp vùng đánh, sửa visual hoặc báo sai lệch, không âm thầm tăng range.
- Không dùng camera shake/hit stop mới để thay việc animation có lực. Hiệu ứng đã có được giữ và kiểm tra.
- Two-handed grip là optional theo vũ khí hiện tại; không làm IK hai tay tổng quát nếu chỉ cần một preset pose.

### Hit reaction

- Phản ứng ngắn theo hướng tác động nếu dữ liệu có sẵn.
- Không tự knockback collider hoặc kéo actor xuyên tường.
- Tôn trọng interrupt/stagger policy và invulnerability hiện có.

### Death

- Dùng clip/procedural pose có kiểm soát trước; chưa cần ragdoll.
- Chuyển cuối pose sang corpse presentation theo lifecycle thật.
- Quyền kill, drop loot, respawn và corpse collision thuộc gameplay, không chờ tùy tiện vào render callback.
- Không cập nhật pose mãi cho corpse đã yên nếu không cần.
- Kiểm tra ngã gần tường/bậc thang: có fallback hợp lý, ghi rõ giới hạn xuyên hình nếu chưa có xử lý nâng cao.

**Nghiệm thu C4:** visual contact phù hợp hit window, không nhân đôi damage/audio; bị đánh/chết giữa attack không phát lại action; corpse/loot/respawn giữ đúng luật. Dừng để người dùng xem và tự commit.

## 11. C5 — Zombie model, animation và biến thể

Dùng lại rig/body nền, tạo khác biệt chủ yếu qua posture, quần áo, màu và animation.

| Thành phần | Hướng xử lý |
| --- | --- |
| Head/shoulders | Đầu hơi lệch, vai bất đối xứng vừa phải |
| Torso | Gập nhẹ, trọng lượng không cân bằng |
| Arms | Buông/lệch, hoặc đưa ra theo trạng thái; không luôn hai tay giơ thẳng |
| Gait | Nhịp bước khác nhau, kéo chân nhẹ ở một số variant |
| Skin | Nhợt/xám nhẹ, không mặc định xanh lá |
| Clothes | Trang phục đời thường, bạc/bẩn/rách có chọn lọc |

Tạo 3–4 preset dáng đứng/đi có chất lượng. Có thể đổi phase offset và variation nhỏ theo seed ổn định để đám đông không bước đồng bộ.

- Gait variant không tự đổi move speed, attack range, HP hoặc khả năng AI.
- Nếu có zombie nhanh/chậm theo gameplay, playback phải theo vận tốc thực tế của từng loại.
- Không dùng random mỗi frame làm pose rung.
- Zombie wander/chase/attack cần chuyển pose phù hợp state hiện có, không viết AI mới.
- Quần áo rách dùng geometry/material tiết chế; tránh alpha overdraw lớn hoặc lộ lớp thân sai.
- Không làm mặt/chi tiết vết thương quá nhỏ nếu không đọc được ở gameplay zoom.

**Nghiệm thu C5:** nhóm zombie đa dạng nhưng cùng phong cách, không đi đều như đội hình; visual variants không đổi gameplay; appearance ổn định sau lifecycle. Dừng để người dùng xem và tự commit.

## 12. C6 — Visibility, crowd performance và rollout

### Tích hợp vision/cutaway

- Toàn bộ body, hair, outfit, weapon, blood overlay và corpse phải theo visibility policy tương ứng.
- Không để vũ khí/tóc nổi khi body bị ẩn bởi LOS hoặc floor policy.
- Actor trong phòng chưa thấy không bị lộ bởi highlight, effect hoặc shadow nếu luật hiện tại cấm; không thay đổi chính sách thông tin ngoài ý muốn.
- Actor không được render xuyên tường bằng cách tắt depth test.
- Kiểm tra mái/tường cutaway không ảnh hưởng collider hoặc targeting.

### Performance

Đo với cùng camera, resolution/DPR, số zombie, AI workload và settings so với C0. Ghi rõ thiết bị/headless hay trình duyệt thật.

| Chỉ số | Yêu cầu |
| --- | --- |
| Frame time median/p95 | So sánh baseline và các mật độ đại diện |
| Draw calls/triangles | Tách actor cost khi đo được |
| Animation update time | Quan sát khi nhiều zombie đang đi/đánh |
| Resource counts/memory | Kiểm tra nhiều chu kỳ spawn/despawn |
| Load time/asset size | Ghi phần tăng so với trước |

Không đặt một polycount tùy ý làm bằng chứng đủ nhẹ. Draw calls, số material, skeleton updates và shader cost đều cần xét.

Tối ưu có thứ tự:

1. Chia sẻ geometry/material/clip data an toàn; mỗi actor vẫn có pose/state độc lập.
2. Giảm mesh/material nhỏ dư thừa; merge có kiểm soát theo rig/visibility needs.
3. Giảm chi tiết ở xa hoặc quality Low khi có lợi ích đo được.
4. Giảm tần số pose update cho actor xa/ngoài màn hình nếu cần, nội suy và đồng bộ lại đúng lúc quay vào.

Không giảm simulation/combat update chỉ vì animation bị cull. Khi actor trở lại view, lấy phase hiện tại từ gameplay, không replay attack/hit events đã qua. Bounding volumes phải chứa pose đang chuyển động để không cull cánh tay/vũ khí sai.

Low/Medium/High không thay đổi collider, hit timing, range, AI hoặc visibility gameplay. Low vẫn phải giữ silhouette, vũ khí và animation đọc được.

### Resource lifecycle

Spawn/despawn/respawn/unload phải giải phóng mixers/actions/listeners và tài nguyên riêng đúng ownership; không dispose shared assets đang được actor khác sử dụng.

Rollout trước cho player và một loại zombie, sau đó các actor archetype còn lại. Không giữ hai visual systems cùng update một actor.

**Nghiệm thu C6:** có benchmark, scene đông zombie không regression ngoài budget đã thống nhất, lifecycle không tăng tài nguyên vô hạn và game thật dùng pipeline mới. Dừng để người dùng xem và tự commit.

## 13. Ma trận kiểm tra

- [ ] So sánh trước/sau ở camera gameplay, không chỉ close-up.
- [ ] Idle, walk, run nếu có, turn, attack, hit và death nhìn hợp phong cách.
- [ ] Khớp không hở, quần áo không xuyên nghiêm trọng ở pose cực trị.
- [ ] Chân không trượt quá rõ; actor bị chặn không chạy hết nhịp như đang di chuyển.
- [ ] Model đúng scale, floor height và hướng forward.
- [ ] Melee grip, đường vung và hit window hợp nhau; không đổi damage/range.
- [ ] Interrupt, death giữa attack, pause/resume và frame hitch không lặp event.
- [ ] Zombie biến thể có pose/appearance độc lập nhưng giữ stats.
- [ ] Day/night, interior mask và cutaway không làm lỗi material/visibility.
- [ ] Vũ khí/phụ kiện không lộ actor ngoài LOS hoặc ở tầng bị ẩn.
- [ ] Save/load giữ appearance nếu được persist; save cũ có fallback hợp lệ.
- [ ] Corpse, loot, respawn và chunk lifecycle đúng.
- [ ] Nhiều actor dùng cùng asset không đổi màu/pose lẫn nhau.
- [ ] Quality tiers không thay đổi gameplay hoặc lợi thế nhìn thấy.
- [ ] Có ảnh/video và số đo; không đánh dấu PASS cho kiểm tra chưa chạy.

Tự động hóa test quan trọng cho event idempotence, animation clock, state transitions, seed/appearance serialization và lifecycle. Chất lượng dáng người, foot contact và cảm giác đòn đánh cần render/video thật; không chỉ test giá trị góc khớp.

## 14. Những việc không được làm

- Chỉ đổi màu hoặc thêm texture lên model hộp rồi coi là hoàn thành.
- Làm đầu/bàn tay quá lớn hoặc thêm squash-and-stretch trái phong cách.
- Tăng chi tiết mặt/ngón tay trước khi sửa silhouette và locomotion.
- Để animation tự di chuyển root hoặc tự gây damage cạnh tranh với gameplay.
- Sửa AI/stats để che lỗi gait hoặc attack clip.
- Giảm LOS correctness để actor đẹp hơn.
- Tạo material/geometry riêng mỗi frame hoặc clone toàn bộ asset cho mỗi zombie thiếu kiểm soát.
- Bắt buộc full IK, ragdoll, facial rig hay motion capture khi không cần.
- Tự chuyển sprint hoặc tự commit sau khi hoàn tất sprint hiện tại.

## 15. Báo cáo mỗi sprint và bàn giao cuối

Mỗi sprint báo cáo: kết quả nhìn thấy, file/module chính thay đổi, quyết định kỹ thuật, kiểm tra đã chạy, ảnh/video trước/sau và vấn đề còn lại. Dừng để người dùng xem và tự commit.

Bàn giao cuối gồm body/rig contract, player/zombie presets, outfit/material catalog, animation adapter và state mapping, weapon socket conventions, scene lab, benchmark và hướng dẫn thêm variant mà không sửa core gameplay.

**Bắt đầu C0 sau khi nâng cấp đồ họa môi trường ổn định. Thứ tự ưu tiên: silhouette → khớp → trang phục → locomotion → combat/death → zombie variants → crowd optimization.**
