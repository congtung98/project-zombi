# Sprint CS1 — Điều khiển, Combat Stance và định hướng đòn melee

> Tài liệu thực thi cho coding agent. Chủ dự án xác nhận sprint thay model đã hoàn thành; hiện chuột phải chưa có action. Triển khai thay đổi điều khiển/combat riêng trên nền model mới.
>
> Chưa audit repository. Tên state, field và giá trị trong tài liệu là hợp đồng đề xuất, cần map sang code thật. Đây là thiết kế cho game React + Three.js này, không phải bản sao chính xác cơ chế PZ.

## 1. Mục tiêu và cách làm việc

Giữ chuột phải để chuẩn bị chiến đấu và ngắm; click trái để đánh khi đang trong stance; E dùng hành động chính. Nhân vật quay có chuyển động trước khi đánh ra sau, và hướng damage khớp hướng đòn đánh đang thể hiện.

Đây là **một sprint**, chia thành các bước triển khai nội bộ. Hoàn tất, báo cáo bằng kiểm tra thực tế và dừng để người dùng xem/tự commit. Không tự commit, không chuyển sang sprint mới.

Không làm lại model/rig, không thêm súng, combo, parry, dodge, lock-on, full IK, root motion hoặc menu action phức tạp. Chuột phải trong sprint này dành riêng cho stance, không phân biệt click ngắn để mở menu.

## 2. Quyết định sản phẩm đã chốt

| Input/ngữ cảnh | Hành vi |
| --- | --- |
| WASD trong gameplay | Di chuyển theo quy ước camera hiện có |
| Giữ chuột phải, chế độ mặc định Hold | Yêu cầu combat stance và hướng ngắm theo con trỏ |
| Thả chuột phải, chế độ Hold | Ngừng yêu cầu stance; đòn đã bắt đầu hoàn tất nếu không có interrupt gameplay |
| Click chuột phải, chế độ Toggle | Bật/tắt yêu cầu stance bằng cạnh nhấn |
| Click trái khi stance đang được yêu cầu | Yêu cầu một đòn melee |
| Giữ chuột trái | Không tự đánh liên tục trong sprint này |
| Click trái ngoài stance trên world | Không đánh, không tự mở cửa/container; dành cho chọn mục tiêu nếu đã có selection |
| E | Hành động chính của mục tiêu hợp lệ đang highlight |
| Click trong UI | Chỉ thao tác UI, không truyền xuống world/combat |
| Esc | Đóng UI ưu tiên nếu đang mở; nếu không, hủy yêu cầu/queue và rời stance; nếu đã neutral thì dùng pause behavior hiện có |

Chốt dùng E làm tương tác chính để giảm nhập nhằng. Không xây hai cơ chế click trái và E cùng thực hiện action world trong sprint này. Nếu click trái đang có chức năng world khác ngoài combat, audit và ghi rõ cách giữ/chuyển chức năng đó trước khi sửa.

Người chơi luôn có phản hồi ngay khi nhấn chuột phải: đổi pose/con trỏ. Phản hồi nhanh không đồng nghĩa damage xảy ra ngay lúc click trái.

## 3. Audit bắt buộc trước implementation

Đọc `AGENTS.md`, tìm input manager, player controller, aim resolver, animation adapter, combat timeline, hit detection, interaction, settings, pause/focus và save.

Ghi lại:

- Chuột trái hiện gây damage ngay hay khởi chạy timeline?
- Ai cập nhật heading: movement, pointer, animation hay combat? Có nhiều nơi cùng set rotation không?
- Model mới có combat-ready, strafe, turn-in-place và attack phases nào? Những pose nào còn thiếu?
- Attack damage/range/arc, cooldown, stamina/durability và interruption đang hoạt động ra sao?
- Camera orthographic/perspective; world aim point trên tầng nào được tính thế nào?
- E có action sẵn không? Container UI có pause simulation không?
- Input listeners đăng ký ở canvas, document hay React? Có click-through hoặc listener trùng không?
- LOS/vision đang dùng hướng nào? Có đang dùng mouse direction trực tiếp thay vì hướng actor không?

Không thay hành vi zombie AI, spawn, loot, collider hoặc save để tiện triển khai. Ghi rõ phần timing chủ đích thay đổi: thêm căn hướng trước contact có thể làm đòn đánh ra sau chậm hơn.

## 4. Kiến trúc: ý định → controller → gameplay → presentation

Phân biệt các dữ liệu:

| Dữ liệu | Chủ sở hữu/ý nghĩa |
| --- | --- |
| `stanceRequested` | Input/gameplay mode, không phải animation pose đã hoàn tất |
| `desiredAimYaw` | Hướng muốn ngắm từ vị trí con trỏ hợp lệ |
| `bodyYaw` | Hướng hông/chân, do character controller quản lý |
| `facingYaw` | Hướng nhìn chiến đấu thực tế có giới hạn, gồm body và torso twist hợp lệ |
| `committedAttackYaw` | Hướng đòn đã chốt khi chuyển sang pha vung |
| `attackPhase` và progress | Combat system authoritative |
| `visualPose` | Animation đọc gameplay state để trình bày |

Có thể gộp body/facing ở MVP nếu rig chưa hỗ trợ twist, nhưng vẫn phân biệt desired aim và hướng thực tế. Animation không tự ghi ngược heading hoặc damage tạo vòng lặp.

Không suy stance từ việc animation hiện đang có pose cầm gậy: pose có thời gian chuyển, còn input intent phải phản hồi ngay.

## 5. Combat stance và movement

### Vào stance

- Khi pointer input hợp lệ trên gameplay canvas, ghi stance request ngay và blend sang ready pose.
- Giữ vị trí actor; không root-motion trượt chân vào pose.
- Nếu chưa trang bị vũ khí: dùng unarmed behavior chỉ khi hệ đó đã tồn tại. Nếu chưa có, hiển thị thông báo ngắn và không tạo đòn tay không mới.
- Có cue gọn: cursor đổi và pose nâng vũ khí. Không thêm vòng sáng lớn hoặc auto-lock zombie.

### Movement trong stance

- WASD giữ nguyên quy ước world/camera đã có; không đổi W thành lao theo hướng chuột.
- Hướng cơ thể/aim không bị movement heading ghi đè khi strafing/backpedal.
- Đề xuất ban đầu stance speed khoảng 0.8 lần tốc độ đi, áp một lần trước/đúng pipeline modifiers hiện có. Đây là giá trị thử, không số đo PZ.
- Kế thừa thương tích/encumbrance/terrain modifiers nếu có, tránh nhân đôi hệ số.
- Sprint bị chặn khi stance active; không tự thoát stance để sprint rồi tự quay lại ngoài ý muốn. Nếu hệ hiện tại khác, báo thay đổi rõ.
- Không trừ stamina chỉ vì đang giữ tư thế; attack/movement vẫn theo chi phí hiện có.

### Rời stance

- Khi neutral và hết request: blend về locomotion bình thường.
- Khi đã bắt đầu windup/strike/recovery: thả RMB chỉ ngừng yêu cầu và xóa pending attack; đòn hiện tại tiếp tục theo timeline trừ khi gameplay interrupt.
- Trong thời gian đòn đang hoàn tất, effective combat posture vẫn còn; không hạ tay giữa cú vung.
- Khi đòn hết, trả quyền heading cho locomotion bằng chuyển tiếp ổn định, không snap.

## 6. Aim point, rotation và FOV

### Mouse-to-world

- Tính pointer theo bounding rect của canvas và camera thật, không dùng window dimensions mặc định.
- Giữ cách chọn tầng/mặt phẳng aim phù hợp tầng player. Không để ray trúng mái/tầng trên làm heading nhảy.
- Điểm trên mặt phẳng aim là hướng ngắm, không phải bằng chứng actor có thể nhìn hoặc đánh xuyên tới đó.
- Khi con trỏ quá gần player projection tạo vector gần zero, giữ hướng hợp lệ gần nhất. Không tạo NaN hoặc đảo 180° ngẫu nhiên.
- Pointer rời canvas mà không còn mapping hợp lệ: giữ aim cuối, không nhảy về origin; thả nút vẫn phải được xử lý.
- Nếu camera dịch chuyển, aim resolver cập nhật theo vị trí pointer hiện tại kể cả không có mousemove.

### Quay người

- Quay theo góc ngắn nhất, giới hạn angular speed bằng delta time; không gán rotation trực tiếp theo click.
- Góc lệch nhỏ: torso/shoulders có thể dẫn nhẹ trong giới hạn rig.
- Góc lớn: body/feet quay theo; dùng turn-in-place nếu clip sẵn có, hoặc procedural bước nhỏ vừa đủ.
- Không xoắn eo 180° để giữ chân đứng yên.
- Tại đúng 180°, chọn phía quay ổn định theo quy tắc nhất quán để không đổi trái/phải liên tục.
- FOV/LOS hướng nhìn phải theo hướng quan sát thực tế được phép, không teleport theo desired mouse yaw trước cơ thể nếu trái luật hiện tại. Giữ awareness/peripheral rules đang có.

Các giá trị tuning khởi đầu, gom trong config, không rải magic numbers:

| Thông số | Gợi ý thử |
| --- | --- |
| Body turn speed khi stance | 540–720 độ/giây |
| Torso twist giới hạn nếu có | Khoảng ±30–45 độ, xem rig thật |
| Sai số căn hướng trước strike | Khoảng 10–15 độ |
| Pose blend vào/ra | Khoảng 0.10–0.18 giây |

Không cam kết các giá trị này phù hợp trước khi playtest. Ưu tiên cảm giác phản hồi nhưng nhìn được chuyển hướng.

## 7. Timeline melee và hướng damage

### Nhận yêu cầu

Click trái khi stance được yêu cầu và gameplay cho phép tạo attack intent với hướng snapshot tại lúc click. Không auto-aim hoặc tự chọn zombie gần nhất.

Khi đang neutral/ready và đủ điều kiện attack, bắt đầu windup cùng việc quay hướng. Như vậy không bắt chờ quay xong rồi mới bắt đầu lấy đà.

### Các pha

1. **Windup/align:** lấy đà đồng thời quay; chưa gây damage.
2. **Strike/contact:** bắt đầu khi windup tối thiểu hoàn tất và heading đủ gần attack intent; chốt `committedAttackYaw`.
3. **Recovery:** hồi phục theo combat timing, không bắt đầu strike khác ngay bằng spam click.

Trong sprint đầu, hướng của một attack intent được snapshot để dễ kiểm soát. Mouse di chuyển sau click cập nhật hướng ready/đòn sau, **không bẻ hướng đòn hiện tại**. Aim assist trong windup là mở rộng sau nếu cần.

Nếu windup kết thúc mà chưa căn được hướng, giữ pose chuẩn bị ngắn thay vì phát damage ra sau. Có timeout/cancel hữu hạn cho tình huống bất thường như bị controller khác khóa quay; không treo input vô hạn. Thời gian timeout phải lớn hơn thời gian quay hợp lệ tối đa cộng windup; xác định sau audit.

Trong strike, không cho đổi hướng theo chuột. Recovery có thể trả dần quyền quay ở điểm được cấu hình khi active hit window đã kết thúc; không thay đổi damage direction đã chốt.

### Hit detection

- Hit arc/range và animation swing dùng cùng committed heading.
- Dùng collision/occlusion combat thật, không list mesh visible sau cutaway.
- Không đánh xuyên tường/cửa kín khi cursor ở phía bên kia.
- Mỗi action có ID; mỗi target chỉ nhận hit theo policy cũ (thường tối đa một hit/attack), không lặp do nhiều frame overlap.
- Giữ damage, range, weapon durability, stamina cost và recovery/cooldown hiện có trừ thay đổi đã được ghi rõ. Không tự buff/nerf để che animation sai.
- Combat clock authoritative, animation đọc phase/progress. Callback animation không tạo damage thứ hai.
- Khi một frame bước qua active window, xử lý interval crossing/sweep theo collision system phù hợp; không phụ thuộc việc render đúng một frame contact.
- Trong đòn di chuyển được, hit origin theo actor world position hiện tại, không giữ vị trí click ban đầu.

### Phạm vi thay đổi cân bằng

Thêm căn hướng làm tăng thời gian tới contact của đòn ra sau. Đây là thay đổi chủ đích của sprint, phải ghi và playtest; không coi chỉ là visual smoothing.

Đòn đã hướng sẵn nên gần timing cũ, không thêm một khoảng delay toàn cục không cần thiết.

## 8. Input buffer, interrupt và ưu tiên

### Buffer

- Tối đa một pending attack; không tạo hàng đợi nhiều cú từ spam click.
- Chỉ nhận buffer trong phần cuối recovery, cửa sổ thử khoảng 150–200 ms; mỗi click hợp lệ mới thay pending intent cũ.
- Pending có expiry và chỉ chạy khi stance vẫn được yêu cầu, actor sống và đủ điều kiện.
- Không lưu click từ đầu recovery để tự đánh bất ngờ lâu sau đó.
- Thả stance, Esc, UI blocking, blur hoặc death xóa pending.
- LMB đang giữ khi stance mới được bật không tự thành click; phải có cạnh nhấn mới. RMB và LMB cùng frame vẫn dùng thứ tự input nhất quán.

### Interrupt

Death/stagger/hit interrupt giữ theo luật gameplay hiện tại. Hit reaction nhẹ không tự hủy attack nếu trước đây không hủy.

Mở pause đóng băng combat clock nếu game pause thực sự. Sau resume không phát lại contact/audio đã xảy ra; không khôi phục stance request hoặc pending do nút đang giữ trước pause.

Esc/thả RMB không trở thành exploit hủy recovery hoặc né chi phí. Đòn đang chạy xử lý theo cùng quy tắc finish/interrupt; không thêm cancel combat miễn phí.

## 9. E interaction và mục tiêu

- Dùng interaction resolver hiện có; chọn một mục tiêu rõ, highlight và hiển thị prompt.
- Ưu tiên mục tiêu dưới cursor nếu hợp lệ trong tầm; fallback mục tiêu gần theo hướng người chơi. Dùng quy tắc ổn định để không nhấp nháy giữa hai container.
- Tầm tương tác tính từ actor và điểm tương tác, không chỉ ray camera trúng mesh.
- Kiểm tra tầng, vật cản và state cửa/container; không loot xuyên vách hoặc từ tầng khác.
- Giữ E không lặp đóng/mở cửa liên tục; dùng press edge.
- Khi windup/strike/recovery đang chạy: từ chối E với cue nhẹ nếu cần; không queue interaction bất ngờ.
- Khi ready stance và nhấn E hợp lệ: rời stance, xóa pending, thực hiện action; yêu cầu nhấn stance mới sau đó. Hold RMB đang giữ không được tự kích hoạt stance lại ngay.
- Mở UI container/inventory chặn world combat input. Đóng UI không tự thực hiện input còn giữ.
- Không tự thêm timed-action framework cho những action đang instant; tái sử dụng luật hiện tại.

## 10. Browser input và focus

Đây là game web nên bắt buộc xử lý:

- Chặn native `contextmenu` trong gameplay canvas khi game đang nhận input. Không chặn chuột phải toàn website hoặc trong input text/editor ngoài gameplay.
- Không dùng click ngắn/dài RMB làm menu trong sprint này. Thả RMB không mở browser/game menu.
- Theo dõi trạng thái nút bằng input manager thống nhất; không nhầm mã button với bitmask buttons.
- Giữ/release pointer ngoài canvas được xử lý bằng capture hoặc listener tương ứng với lifecycle rõ.
- `pointercancel`, mất capture, window blur, tab hidden: clear held input, stance request, pending và interaction intent. Không tự gây hit khi focus quay lại.
- Tôn trọng simulation background policy hiện có; nếu pause on blur thì pause combat clock cùng game. Không cho delta lớn sau resume skip cả chuỗi attack.
- UI ưu tiên hơn world; thao tác nút menu không vừa đóng UI vừa đánh trong cùng event.
- Không nhận WASD/E khi đang nhập text, IME hoặc chỉnh settings.
- Gỡ listener đúng khi unmount/switch scene; kiểm tra development mode không đăng ký đôi.
- Không yêu cầu pointer lock để chơi camera isometric trừ khi dự án đã dùng vì lý do độc lập.
- Chưa triển khai touch/mobile controls trong sprint này; ghi rõ giới hạn.

## 11. Settings và hướng dẫn người chơi

- Thêm `Combat stance: Hold / Toggle`, mặc định Hold.
- Toggle: RMB press bật/tắt; giữ nút không repeat toggle.
- Chuyển mode trong settings phải reset held/toggle request, không gây stuck stance.
- Lưu tùy chọn trong settings hiện có, có default cho dữ liệu cũ. Không lưu transient stance/attack buffer vào save gameplay.
- Nếu repo có keybinding system, đăng ký action IDs vào đó; không xây một binding system thứ hai. Full remapping mới có thể deferred nếu chưa có.
- Hướng dẫn ngắn trong help/onboarding: “Giữ chuột phải để ngắm · Chuột trái để đánh · E để tương tác”. Cập nhật text theo Toggle khi cần.
- Khi LMB ngoài stance, có thể nhắc một lần bằng cue nhỏ; không spam toast mỗi click.
- Debug có desired/facing/committed heading, phase, input ownership và buffer expiry; production mặc định tắt.

## 12. Kế hoạch triển khai trong sprint

### Bước A — Audit và fixture

- Ghi input/state ownership, timing melee cũ và animation có sẵn.
- Fixture có zombie phía trước/phía sau, cửa, container, tường và hai tầng nếu runtime hỗ trợ.
- Quay video baseline click đánh ngược hướng; lưu timing hiện tại.

### Bước B — Input và stance

- RMB Hold/Toggle, ready pose, WASD strafe/backpedal.
- UI/focus reset và E routing cơ bản.
- Chưa bật hit logic mới khi heading chưa thống nhất.

### Bước C — Rotation và attack contract

- Tách desired/facing/committed heading.
- Căn hướng trong windup, commit hướng strike, đồng bộ damage/animation.
- Buffer một action, interrupt, cooldown và release semantics.

### Bước D — Interaction, settings và polish

- E resolver/highlight, action gating, browser context menu scope.
- Help text, settings defaults, cues, turn-in-place nếu rig hỗ trợ.

### Bước E — Test và playtest

- Chạy kiểm tra logic, video thao tác và regression bên dưới.
- Tuning trong config theo cảm giác chơi; ghi rõ thay đổi so với giá trị khởi đầu.
- Hoàn tất báo cáo, dừng để chủ dự án xem/tự commit.

## 13. Ma trận nghiệm thu bắt buộc

| Tình huống | Kết quả |
| --- | --- |
| LMB ngoài stance | Không vung gậy hoặc gây damage |
| RMB giữ/thả khi idle | Vào/ra stance rõ, không browser menu |
| RMB Toggle | Một cạnh nhấn một lần toggle, không stuck |
| RMB + LMB gần đồng thời | Input được hiểu nhất quán, không mất click tùy frame |
| LMB giữ rồi mới vào stance | Không tự đánh khi chưa có cạnh click mới |
| Aim phía trước | Đòn phản hồi nhanh, không delay thừa |
| Click sau lưng ~180° | Có quay/căn hướng; không damage phía sau trước khi vung đúng hướng |
| Kéo chuột sang phía đối diện giữa strike | Đòn không xoay 180° hoặc đổi hit arc |
| Thả RMB giữa đòn | Đòn hiện tại hoàn tất theo luật, pending bị xóa |
| Spam LMB | Không hàng đợi dài, không bỏ recovery, không duplicate hit |
| Di chuyển ngang/lùi khi aim | Hướng aim không bị movement ghi đè |
| Cursor sát chân/player projection | Không NaN, không heading rung |
| Cursor qua mái/tầng khác | Không aim jump do surface không phù hợp |
| Aim vào zombie sau tường | Không hit xuyên tường/door blocker |
| E gần hai container | Một mục tiêu ổn định, prompt khớp action |
| E trong lúc attack | Không mở UI hay action chen vào ngoài policy |
| E từ ready stance | Rời stance, action đúng, RMB cũ không tự bật lại |
| UI click/E nhập text | Không leak input xuống game |
| Pointer rời canvas/release/cancel | Không stuck nút hoặc stance |
| Alt-tab/hidden/pause/resume | Không đánh tự động, không replay damage/audio |
| Death/stagger giữa attack | Theo gameplay interrupt, không zombie bị hit sau khi action đã hủy |
| FPS thấp/frame hitch | Event idempotent, phase tiến đúng, hit window không mất do render skip |
| Save/load và respawn | Không lưu held buttons/pending; settings và gameplay state cũ còn đúng |

Test tự động ưu tiên các boundary: shortest-angle rotation, input press edges, buffer expiry, phase transitions, event deduplication, blur/UI reset và damage hướng committed. Không chỉ test góc model rồi bỏ qua hit detection.

Manual/video tối thiểu: đánh trước, đánh sau, strafe đánh, đổi cursor giữa strike, thả RMB và spam click, E mở container, alt-tab quay lại. Kiểm tra trên browser thật, không chỉ headless.

## 14. Những việc không được làm

- Gán `bodyYaw = mouseYaw` tức thì khi click.
- Chỉ làm visual quay chậm trong khi hitbox nhảy theo cursor.
- Mỗi frame lấy cursor hiện tại làm damage direction của đòn đã vung.
- Cho animation và combat cùng phát damage/audio độc lập.
- Tắt recovery/cooldown khi RMB được thả hoặc Esc.
- Thêm menu RMB ngay gây conflict với stance.
- Đổi model, zombie stats hoặc attack range ngoài phạm vi để che lỗi.
- Tự động đánh lại sau đóng UI/focus regain.
- Chặn context menu toàn ứng dụng, kể cả vùng ngoài gameplay.
- Tự commit hoặc tiếp tục sprint khác.

## 15. Definition of Done và bàn giao

Sprint đạt khi bộ điều khiển mới dùng được trong game thật, quay/đánh liên tục không snap 180°, damage khớp visual, interaction rõ và browser input không bị kẹt.

Agent báo cáo:

1. Input mapping cuối, Hold/Toggle và quy tắc E.
2. Module thay đổi, nguồn authoritative của heading/combat phases.
3. Các thông số tuning cuối và ảnh hưởng timing đòn trước/sau lưng.
4. Video/ảnh debug và kết quả kiểm tra đã chạy.
5. Regression còn lại, feature deferred và giới hạn rig nếu có.
6. Hướng dẫn chủ dự án tự thử nhanh trước khi commit.

**Bắt đầu audit rồi triển khai trong sprint CS1. Không cần xác nhận lại việc dùng RMB cho stance; đây là định hướng đã chốt. Sau khi đủ nghiệm thu, dừng để chủ dự án xem và tự commit.**
