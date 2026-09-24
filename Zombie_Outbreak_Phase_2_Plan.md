# Zombie Outbreak — Phase 2: Trang bị, chế tạo và phòng thủ nơi trú ẩn

**Phiên bản:** 1.0 · **Ngày:** 24/09/2026 · **Trạng thái:** kế hoạch triển khai đề xuất.

Tài liệu kế thừa kế hoạch Phase 1 và bản cập nhật tiến độ của chủ dự án. Các tính năng hoàn thành được ghi nhận theo mô tả của người phát triển; chưa có bước kiểm tra repository hoặc benchmark thực tế. Các con số cân bằng, recipe và thời lượng dưới đây là đề xuất để bắt đầu playtest, không phải thông số đã được đo hoặc yêu cầu cố định.

## 1. Nền tảng hiện có và mục tiêu tiếp theo

### 1.1. Những gì đã hoàn thành

- Phase 1 với 6 sprint; gameplay có chu kỳ ngày/đêm.
- Melee với gậy gắn mặc định trên nhân vật.
- Loot/inventory 12 ô; đồ hộp, nước, snack, băng gạc, hộp cứu thương, nước tăng lực.
- Zombie navigation và truy đuổi trong phạm vi cho phép ở mức cơ bản.
- Audio vung gậy, người chơi bị đánh và zombie bị tiêu diệt.
- Zombie respawn; settings đồ họa/âm thanh; save game bằng IndexedDB.

Giữ và mở rộng các hệ thống trên. Không cần viết lại engine, chuyển thư viện navigation hoặc thay toàn bộ inventory nếu code hiện tại đáp ứng được hợp đồng dữ liệu mới.

### 1.2. Mục tiêu Phase 2

Chuyển từ một vòng chơi tìm đồ ăn và đánh zombie sang một vòng chơi có chuẩn bị, bảo trì và phòng thủ:

**Tạo nhân vật → tìm vũ khí và dụng cụ → tích trữ vật liệu → sửa/chế tạo → gia cố nơi trú → đối phó zombie phá cửa → tiếp tục đi loot.**

Người chơi cần gặp các lựa chọn có ý nghĩa: dùng gỗ để sửa gậy hay đóng barricade; mang nhiều đồ hồi phục hay chừa ô cho dụng cụ; dùng vũ khí sắp hỏng hay giữ nó để sửa; đầu tư bộ hàn cho nơi trú lâu dài hay tiếp tục di chuyển.

**Mốc hoàn thành:** chơi một phiên 30–45 phút, từ nhân vật mới không có gậy tới tìm được vũ khí, trải nghiệm vũ khí hỏng/sửa, tạo nơi trữ đồ, gia cố cửa và chứng kiến zombie phá lớp gia cố rồi phá cửa; save/reload khôi phục đúng tất cả trạng thái. Kiểm tra riêng cả barricade gỗ và kim loại, không buộc phải kiếm đủ bộ hàn trong mọi phiên 30 phút.

## 2. Phạm vi chốt cho Phase 2

| Hạng mục | Bắt buộc | Giới hạn để hoàn thành được |
|---|---|---|
| Character creation | Tên, preset ngoại hình, tóc, màu da/áo/quần, preview | Ngoại hình không tăng chỉ số; chưa nghề nghiệp/traits |
| Model/animation | Player và zombie có model, animation di chuyển/đánh/chết | Một rig player, một rig zombie; biến thể bằng tóc/màu/material |
| Equipment | Loot và trang bị melee; không spawn với gậy | Một ô vũ khí; chưa dual wield, giáp hoặc balô tăng ô |
| Vũ khí | Gậy bóng chày, ống sắt, xà beng, búa; gậy gỗ tự chế | Chưa súng, dao với bộ animation riêng, mod vũ khí |
| Condition | Mỗi instance có độ bền; hỏng vẫn tồn tại và đánh yếu | Chưa tách condition lưỡi/cán hoặc mô phỏng vật liệu |
| Container | Tủ đồ, tủ đầu giường, tủ bếp, kệ/thùng dụng cụ | Giao diện chung; chưa cần animation riêng từng ngăn kéo |
| Craft/repair | Recipe dữ liệu, dụng cụ, vật liệu, thời gian thao tác | Chưa XP, skill tree, xác suất thất bại hoặc workstation |
| Building | Thùng chứa, vách gỗ một tầng; lắp lại cửa đã vỡ | Chưa xây nhà nhiều tầng, mái, nền, điện/nước |
| Barricade | Gỗ + búa/đinh; metal sheet + torch/welder mask | Chỉ cửa, một lớp gia cố đại diện cho mỗi cửa; chưa cửa sổ |
| Zombie siege | Ghi nhớ lần thấy player, chọn cửa cản đường, phá cửa | Chưa horde theo lịch hoặc hệ thống âm thanh thu hút toàn bản đồ |
| Persistence | Lưu toàn bộ trạng thái mới và chuyển đổi save cũ | Một schema migration rõ ràng; giữ nguyên IndexedDB |

Nhân vật mới và save cũ có chính sách riêng: **New Game không có vũ khí; Continue save Phase 1 giữ cây gậy hiện có sau khi chuyển thành item instance**. Không xóa trang bị của một ván đang chơi chỉ vì thay đổi thiết kế New Game.

## 3. Những quyết định phải khóa trước khi code

1. `ItemDefinition` mô tả loại item; `ItemInstance` mô tả một món cụ thể. Hai cây gậy cùng loại có ID/condition khác nhau.
2. Vũ khí và dụng cụ không stack. Vật liệu và đồ tiêu hao stack theo loại.
3. Vũ khí trang bị vẫn chiếm một ô trong inventory 12 ô; equipment chỉ tham chiếu ID, không chứa bản sao.
4. Chỉ có một nguồn dữ liệu condition/HP; UI và model là phần hiển thị từ dữ liệu đó.
5. Craft, repair, build, barricade dùng chung hệ thống hành động có thời gian và cơ chế hoàn tất nguyên tử.
6. Một cửa có HP thân cửa và HP lớp barricade riêng. Damage làm hết lớp barricade trước, rồi truyền phần dư vào cửa.
7. Cửa có barricade không mở được. Muốn đi qua cần tháo gia cố, hoặc có lối ra khác.
8. Zombie biết vị trí player từ cảm nhận hoặc trí nhớ gần đây; không dùng vị trí player toàn thời gian sau tường để quyết định phá cửa.
9. Thay đổi vật cản cập nhật cả collider và navigation. Không chỉ ẩn mesh khi cửa vỡ.
10. Save/migration được làm cùng tính năng; sprint cuối chỉ tích hợp và kiểm tra hồi quy.

## 4. Tạo nhân vật và pipeline model

### 4.1. Luồng New Game

`New Game → Character Creation → xác nhận bắt đầu/ghi đè nếu có save → khởi tạo world → gameplay`.

- Tên tối đa 24 ký tự, trim khoảng trắng; để trống dùng tên mặc định.
- 3 preset ngoại hình dựa trên một rig; 3 kiểu tóc; 4 màu da; 4 màu áo và 4 màu quần là lượng nội dung ban đầu đề xuất.
- Preview 3D đứng idle, xoay bằng kéo chuột; nút Randomize và Reset.
- Tất cả preset có cùng collider, tốc độ, chỉ số và tầm đánh.
- Back/Cancel không xóa save cũ; chỉ tạo world sau khi người chơi xác nhận bắt đầu.
- Continue đọc cấu hình ngoại hình trong save, không chạy lại character creation.

Tách `CharacterAppearance` khỏi gameplay stats. Lưu ID preset, tóc và các lựa chọn màu; không serialize mesh hoặc texture.

### 4.2. Quy ước asset

Chọn một bộ asset có giấy phép phù hợp trước khi sản xuất hàng loạt. Dùng cùng phong cách low-poly và tỷ lệ chiều cao. Có thể dùng GLB làm định dạng bàn giao model; API tải model cụ thể theo stack và phiên bản đang có trong repository.

Kiểm chứng bằng một model player và một zombie trước:

- Trục tiến, scale, điểm gốc ở chân; model quay đúng hướng gameplay.
- Animation tại chỗ; controller/vật lý điều khiển vị trí, tránh model và collider tự di chuyển riêng.
- Điểm gắn tay phải chuẩn hóa thành `weaponSocket`; offset/rotation của từng melee nằm trong cấu hình.
- Thời điểm gây sát thương do combat action kiểm soát; animation hiển thị cùng tiến trình và không phát damage lần hai khi loop/crossfade.
- Material chia sẻ khi thích hợp; phần tùy biến màu của player không làm toàn bộ zombie đổi màu theo.
- Collider giữ đơn giản và độc lập bộ xương; Phase 2 không cần ragdoll.

| Player clips tối thiểu | Zombie clips tối thiểu |
|---|---|
| Idle, walk, run | Idle, walk/chase |
| Melee swing, shove | Attack player, bash structure |
| Hit reaction, death | Hit reaction, death |

Craft/build có thể dùng một animation làm việc chung. Zombie bash có thể tái sử dụng clip attack nếu hướng và hit timing hợp lý. Đừng chặn milestone gameplay vì thiếu nhiều animation đặc thù.

**Nghiệm thu:** đổi tóc/màu được, reload giữ ngoại hình; equip/unequip đổi model trên tay; swing không lệch collider; zombie vẫn chạy ở mức đồ họa thấp.

## 5. Trang bị melee và độ bền

### 5.1. Khởi đầu không có gậy

Player vào ván mới tay không, vẫn có thao tác đẩy và chạy để thoát. Click đánh khi chưa trang bị hiển thị gợi ý ngắn; chưa cần bộ combat tay không riêng. Bố trí một container có melee cơ bản trong khu khởi đầu có thể tiếp cận an toàn. Người chơi phải tự tìm và lấy nó; không tự thêm item khi spawn.

Seed loot bảo đảm có ít nhất một vũ khí cơ bản ở nhóm container khởi đầu. Mục tiêu playtest: tìm được melee đầu trong khoảng 1–3 phút nếu làm theo hướng dẫn. Không để một seed tạo ra ván hoàn toàn không có cách phòng vệ trước khi vượt qua đám zombie.

### 5.2. Bộ vũ khí đầu tiên

Các thông số dưới đây là baseline nếu zombie cơ bản vẫn gần 50 HP; đối chiếu damage/HP thực tế của Phase 1 trước khi áp dụng. `Cooldown` là thời gian tối thiểu giữa hai lần bắt đầu đòn; hit window nằm trong khoảng đó.

| Loại | Damage | Tầm | Cooldown | Stamina | Max condition | Hao mòn / đòn trúng | Vai trò |
|---|---:|---:|---:|---:|---:|---:|---|
| Gậy gỗ tự chế | 18 | 1,7 | 0,85s | 9 | 40 | 1 | Đồ tạm, dễ chế tạo |
| Gậy bóng chày | 25 | 2,0 | 0,8s | 10 | 80 | 1 | Cân bằng, dễ sửa |
| Ống sắt | 28 | 1,8 | 0,95s | 13 | 120 | 1 | Bền, tiêu stamina cao |
| Xà beng | 32 | 1,8 | 1,0s | 14 | 150 | 1 | Hiếm, bền, dùng tháo gia cố |
| Búa | 18 | 1,3 | 0,65s | 8 | 100 | 1 | Dụng cụ đồng thời là vũ khí |

Búa không nên trở thành melee bắt buộc để đánh tốt; nó có giá trị vì mở khóa chế tạo. Kiểm tra DPS và damage/stamina, không chỉ nhìn damage mỗi hit. Hai cây cùng loại có thể loot ở condition khác nhau.

### 5.3. Quy tắc condition/broken

- Condition chạy từ 0 đến `maxCondition` riêng của loại vũ khí.
- Đánh trượt không mất condition ở bản đầu. Đòn trúng mục tiêu hợp lệ mất 1; đòn trúng nhiều mục tiêu chỉ trừ một lần theo `attackId`.
- Đánh công trình do người chơi nhắm phá tiêu hao 2 condition mỗi đòn trúng; UI phải phân biệt tương tác phá với đánh zombie.
- Lấy condition tại lúc xác nhận hit để tính damage; sau khi giải quyết đòn mới trừ hao mòn. Đòn làm condition từ 1 về 0 vẫn có damage bình thường.
- Khi condition = 0: trạng thái **BROKEN**, damage các đòn tiếp theo = 20% base damage, làm tròn và tối thiểu 1; tầm/cooldown/stamina giữ nguyên để thấy rõ bất lợi.
- Condition > 0: damage bình thường trong Phase 2. Cảnh báo vàng khi ≤ 25%, đỏ và âm thanh một lần khi vừa hỏng. Chưa thêm nhiều mức suy giảm phức tạp.
- Vũ khí broken vẫn trong inventory, vẫn cầm được, có thể sửa. Dụng cụ broken không đáp ứng yêu cầu chế tạo/barricade.
- Repair làm condition > 0 tự bỏ trạng thái broken. Nên suy ra broken từ condition thay vì lưu thêm boolean có thể mâu thuẫn.

### 5.4. Equip và thao tác inventory

Click item → xem condition và chọn Equip/Repair/Drop. Chuyển món đang trang bị sang container hoặc drop thì tự unequip. Hai món giống nhau không gộp thành stack. Tooltip ghi damage, condition hiện tại/tối đa và trạng thái broken.

Giữ inventory 12 ô trong Phase 2; ô vũ khí trang bị là phần hiển thị tham chiếu tới một ô đang dùng. Tool requirement kiểm tra dụng cụ khả dụng trong inventory, không yêu cầu player phải cầm búa khi thao tác để tránh đổi qua lại. Animation có thể tạm hiện model dụng cụ mà không thay đổi equipment thực.

## 6. Vật liệu, dụng cụ và phân phối loot

### 6.1. Item mới

| Item ID đề xuất | Tên | Stack tối đa | Công dụng |
|---|---|---:|---|
| `wood_plank` | Ván gỗ | 10 | Sửa melee gỗ, chế tạo, xây và barricade |
| `scrap_metal` | Kim loại vụn | 10 | Sửa melee kim loại |
| `metal_sheet` | Tấm kim loại | 3 | Barricade kim loại |
| `duct_tape` | Băng keo | 10 | Sửa vũ khí và chế tạo gậy tạm |
| `nails` | Đinh | 50 | Chế tạo/build/barricade gỗ; số lượng tính từng chiếc |
| `hammer` | Búa | 1 | Tool và melee; condition riêng |
| `crowbar` | Xà beng | 1 | Melee; tháo công trình/gia cố theo recipe |
| `welding_torch` | Đèn khò hàn | 1 | Dụng cụ có fuel 0–100 |
| `welder_mask` | Mặt nạ hàn | 1 | Tool requirement; chỉ cần có trong inventory |
| `fuel_canister` | Bình nhiên liệu | 5 | Nạp 50 fuel cho torch, dùng hết một bình mỗi lần |

Torch/mask chưa cần condition trong Phase 2; torch có fuel riêng. Không dùng `scrap_metal` thay cho `metal_sheet` một cách ngầm định. Mask là dụng cụ trong gameplay, chưa cần thêm hệ thống giáp đầu.

### 6.2. Container thật trong thế giới

| Container | Loot chính | Loot phụ/hiếm |
|---|---|---|
| Tủ bếp/kệ thực phẩm | Các món ăn, nước hiện có | Duct tape hiếm |
| Tủ đầu giường | Băng gạc, snack | Gậy bóng chày hiếm |
| Tủ quần áo | Một số melee dân dụng | Nước, đồ sơ cứu |
| Tủ/kệ dụng cụ gara | Búa, đinh, gỗ, tape | Ống sắt, xà beng |
| Kệ xưởng/nhà kho | Scrap metal, metal sheet | Torch, mask, fuel |
| Thùng người chơi chế tạo | Chỉ đồ người chơi chuyển vào | Tuyệt đối không tự sinh loot |

Mỗi container có ID ổn định, loại, sức chứa, vị trí tương tác và cờ đã tạo loot. Có thể tái sử dụng toàn bộ inventory UI hiện có, chỉ thêm quy tắc instance và chuyển item hai chiều. Không cần dựng mô hình mỗi vật bên trong tủ.

Loot tạo một lần, condition khởi tạo của melee được lưu ngay; mở lại/load không reroll. Respawn zombie không reset container hay công trình. Nhà kho/xưởng cần nằm trong phần map có thể tiếp cận; chưa cần mở rộng diện tích map nếu các nhóm container đặt vừa hiện trạng.

**Cân bằng tiến trình:** melee cơ bản dễ tìm; búa/đinh/gỗ ở tuyến khám phá gần; bộ hàn ở vị trí có rủi ro cao hơn. Kiểm tra nhiều seed để vật liệu tương ứng với recipe thật sự tồn tại đủ, không chỉ đúng về xác suất trên giấy.

## 7. Crafting, sửa chữa và hành động có thời gian

### 7.1. Một hệ thống hành động dùng chung

Các hành động craft/repair/build/install/remove/refuel có cùng quy trình:

1. Kiểm tra player sống, đủ khoảng cách, không có hành động khác; đủ item, tool và fuel.
2. Đặt trước số lượng/instance cần dùng để chúng không bị chuyển đi hoặc dùng lặp trong lúc thao tác; chưa trừ vật liệu.
3. Hiện thanh tiến trình. Thời gian thế giới vẫn chạy; player dễ bị tấn công khi thao tác.
4. Di chuyển, đánh, bị trúng đòn, bấm Cancel hoặc target bị phá → hủy, giải phóng đặt trước, không trừ nguyên liệu/fuel và không tạo output.
5. Khi hoàn tất, kiểm tra lại target, quyền sở hữu item, khoảng trống, tình trạng tool và vật cản.
6. Trong một lần cập nhật nguyên tử: trừ input/fuel, hao mòn tool nếu có, tạo output/cập nhật target, phát sự kiện cho UI/render/navigation.

Pause dừng tiến trình. Mở inventory/crafting không tự pause để việc bảo trì có rủi ro; Esc vẫn pause single-player như hiện tại. Không dùng đồng hồ thực của trình duyệt để action hoàn tất trong khi game đang pause.

Save lúc action đang chạy chỉ chứa trạng thái đã hoàn tất và nguyên liệu chưa tiêu; không lưu reservation hoặc tiến độ action. Load hủy action đang dở. Nếu save trùng tick hoàn tất thì snapshot phải là trước hoặc sau toàn bộ thao tác, không được ở giữa.

### 7.2. Sửa vũ khí

Mỗi thao tác hồi một lượng condition cố định, bị chặn ở max. Item đã đầy condition không sửa được. UI hiển thị trước condition nhận được thực tế và vật liệu mất; mọi thao tác xác định, chưa có xác suất thất bại hay repair skill.

| Nhóm/recipe | Chi phí | Dụng cụ | Hồi condition | Thời gian |
|---|---|---|---:|---:|
| Gậy gỗ/gậy bóng chày | 1 wood + 1 duct tape | Không | +30 | 4s |
| Ống sắt/xà beng/búa | 1 scrap metal + 1 duct tape | Không | +25 | 5s |
| Nạp torch | 1 fuel canister | Torch chưa đầy | +50 fuel, tối đa 100 | 3s |

Đây là quy tắc game giản lược. Không yêu cầu búa để sửa chính búa, tránh tình huống toàn bộ dụng cụ hỏng làm khóa tiến trình. Repair không hao mòn mục tiêu sau khi hồi; chưa tăng chi phí theo số lần sửa.

Vũ khí broken có thể sửa bằng recipe trên. Fuel chỉ bị trừ khi thao tác hàn hoàn tất, tương tự vật liệu. Tooltip báo nếu nạp bình làm mất phần fuel vượt 100.

### 7.3. Crafting tối thiểu

| Output | Nguyên liệu | Tool | Thời gian | Kết quả |
|---|---|---|---:|---|
| Gậy gỗ tự chế | 2 wood + 1 duct tape | Không | 4s | Weapon instance mới, condition đầy |
| Thùng chứa gỗ | 4 wood + 8 nails | Búa condition > 0 | 6s | Công trình có 16 ô, HP 150 |
| Vách gỗ | 4 wood + 8 nails | Búa condition > 0 | 8s | Công trình chặn đường, HP 200 |
| Lắp lại cửa gỗ đã vỡ | 3 wood + 6 nails | Búa condition > 0 | 6s | Door leaf mới, HP 120, chưa barricade |

Thùng/vách được tạo trực tiếp qua build mode khi hoàn tất; không cần thêm item blueprint trong inventory. Lắp lại cửa chỉ hợp lệ tại frame cửa có sẵn; không tự tạo cửa giữa map. Một lần chế tạo/xây bằng búa mất 1 condition khi hoàn tất; búa còn 1 vẫn làm được lần cuối rồi broken.

Hệ thống output inventory phải tính chỗ trống **sau khi tiêu input**. Nếu không đủ chỗ tạo gậy, không bắt đầu hoặc không commit; không làm mất item. Công trình xuất hiện trong world không tiêu ô inventory đầu ra.

## 8. Building cơ bản

### 8.1. Cách sử dụng

Phím B mở build menu; chọn thùng/vách rồi hiện preview mờ. Xoay R theo bước 90°, click xác nhận bắt đầu thao tác, Esc hủy. Grid 1 mét là giả định ban đầu; nếu map hiện tại có đơn vị/ô khác, dùng cùng hệ grid đó để tránh sai lệch.

Preview xanh khi vị trí hợp lệ, đỏ khi không hợp lệ, kèm lý do ngắn như “Vướng cửa”, “Quá xa”, “Thiếu 4 đinh”. Khoảng cách build đề xuất ≤ 2,5 đơn vị, có đường tương tác không xuyên tường.

### 8.2. Điều kiện đặt

- Mặt nền hợp lệ, không xuyên nhà/đồ nội thất hoặc đè lên player/zombie.
- Kiểm tra toàn bộ footprint sau rotation, không chỉ điểm tâm.
- Cấm đặt thùng vào ô cửa và vùng mở cánh cửa; không dùng thùng làm vật cản bất tử.
- Công trình có collider phải nằm trong vùng navigation quản lý được.
- Kiểm tra lại overlap khi kết thúc action: zombie có thể đi vào preview trong lúc player đóng vách.
- Dùng cùng dữ liệu footprint cho preview, collider và cập nhật navigation.

Player được phép tạo chướng ngại vật, nhưng hệ thống phải cho tháo/phá chúng để không khóa ván vĩnh viễn. Zombie có thể đánh công trình player xây nếu công trình đó chặn tuyến tiếp cận hợp lệ; Phase 2 chưa cần phá tường nhà nguyên bản.

### 8.3. Tháo dỡ và chứa đồ

Thùng có inventory riêng lưu theo structure ID. Chỉ cho tháo khi rỗng. Đồ rơi khi thùng bị zombie phá phải chuyển nguyên instance/số lượng sang một container đống đổ nát có thể loot; không mất hoặc nhân đồ.

Tháo thùng/vách cần búa hoặc xà beng còn condition, thao tác 4s; hồi tối đa 50% vật liệu ban đầu nhân với tỷ lệ HP còn lại, làm tròn xuống. Không hồi đinh; tool mất 1 condition. Nếu inventory không đủ chỗ nhận vật liệu, chặn tháo và báo lý do. Công trình bị zombie phá không hoàn trả vật liệu để tránh vòng farm.

## 9. Cửa và barricade

### 9.1. Trạng thái cửa

`OPEN`, `CLOSED`, `DESTROYED`; HP thân cửa độc lập lớp gia cố. Frame cửa còn tồn tại sau khi door leaf bị phá để có thể lắp lại cửa mới.

- OPEN: đi qua được; không cho gắn barricade.
- CLOSED: collider và navigation chặn đường; có thể mở nếu không có barricade.
- DESTROYED: đường thông, không còn collider lá cửa hoặc lớp gia cố; có thể xây lại tại frame.
- Barricade chỉ gắn trên cửa CLOSED còn HP; tối đa một loại gỗ hoặc kim loại.
- Cửa đang gia cố không mở được từ cả hai phía. UI phải nói rõ, tránh player tưởng cửa lỗi.

### 9.2. Recipe và HP đề xuất

| Cấu hình | Nguyên liệu | Dụng cụ/tiêu hao | HP lớp gia cố | Tổng HP nếu cửa còn đầy 120 | Thời gian |
|---|---|---|---:|---:|---:|
| Cửa không gia cố | Không | Không | 0 | 120 | — |
| Barricade gỗ, 1–3 ván | Mỗi ván: 1 wood + 2 nails | Búa > 0; mất 1 condition/lần | +80 mỗi ván, tối đa 240 | Tối đa 360 | 4s/ván |
| Barricade kim loại | 1 metal sheet | Torch ≥ 20 fuel + mask; tiêu 20 fuel | 500 | 620 | 10s |

Bảng tổng HP chỉ là mức chịu đòn khi tất cả thành phần đầy. Barricade không hồi HP thân cửa. Gỗ lưu `plankCount` và HP chung, `maxHP = plankCount × 80`; không cần mô phỏng mỗi chiếc đinh.

Thêm một ván tăng cả currentHP và maxHP thêm 80. Không cho quá ba ván. Khi lớp gỗ về 0, toàn bộ layer biến mất và `plankCount` về 0. Không chồng metal lên gỗ; tháo gỗ trước rồi gắn metal. Muốn biểu diễn ván nứt dùng tỷ lệ HP chung, chưa cần theo dõi HP từng ván.

### 9.3. Phân phối damage, sửa và tháo

Damage zombie: trừ barricade HP trước; phần còn dư mới trừ door HP. Khi door HP về 0: chuyển DESTROYED, hủy collider lá cửa, cập nhật navigation, hủy action gắn/sửa đang nhắm cửa đó và cho zombie tiếp tục đuổi. Một hit không được gây trọn damage vào cả hai lớp.

| Hành động | Chi phí | Điều kiện | Hiệu ứng |
|---|---|---|---|
| Sửa thân cửa | 1 wood + 2 nails | Búa > 0; cửa CLOSED, chưa DESTROYED | +60 HP, tối đa 120; 4s; tool −1 |
| Vá lớp gỗ | 1 wood + 2 nails | Búa > 0; layer còn HP | +80 HP, không tăng plankCount; 4s; tool −1 |
| Vá lớp kim loại | 1 scrap metal + 10 fuel | Torch + mask; layer còn HP | +150 HP, tối đa 500; 6s |
| Tháo lớp gỗ | Không | Búa hoặc xà beng > 0 | 4s; tool −1; hồi floor(plankCount × HP/maxHP × 0,5) wood, không hồi đinh |
| Tháo lớp kim loại | 10 fuel | Torch + mask | 6s; hồi 1 scrap metal, không hồi metal sheet |

Không sửa lớp đã bị phá hoàn toàn; phải gắn mới. Không cho sửa/gia cố/tháo trong vòng 3 giây kể từ lần target nhận damage gần nhất; target nhận damage trong action thì hủy. Quy tắc này ngăn player giữ phím sửa để vô hiệu hóa cả nhóm zombie.

Kim loại có HP cao hơn đáng kể nhưng cần nhiều chuyến loot, bộ dụng cụ và fuel. Nó kéo dài thời gian phòng thủ, không tạo vùng bất tử.

## 10. Zombie phát hiện player trong nhà và phá cửa

### 10.1. Cảm nhận và trí nhớ

Nếu Phase 1 đang phát hiện chỉ theo khoảng cách, Phase 2 thêm line-of-sight (LOS) đơn giản. Trong phạm vi phát hiện, raycast qua vật cản tới player. Tường và cửa kín chắn nhìn; lối cửa mở cho nhìn vào nhà. Cửa sổ chỉ cho nhìn qua nếu map đánh dấu rõ là bề mặt trong suốt; không tự giả định mọi window collider đều như nhau.

Khi zombie thấy player, cập nhật `lastSeenPosition` và `lastSeenTime`. Player chạy vào nhà rồi đóng cửa: zombie tìm tới vị trí được nhớ, có thể phá cửa chặn đường dù lúc đó không còn thấy player. Thời gian nhớ ban đầu 20 giây; khi đã tới và bắt đầu phá một cửa liên quan tới dấu vết gần nhất, giữ mục tiêu phá tối đa thêm 60 giây trước khi bỏ cuộc nếu vẫn không có thông tin mới. Khi cửa vỡ, tìm tại lastSeenPosition; chỉ chuyển ATTACK_PLAYER nếu thật sự phát hiện lại player.

Không tự phát hiện một player đứng yên sau tường kín chỉ vì khoảng cách gần. Hệ thống âm thanh thu hút zombie toàn diện có thể làm sau; audio phát cho người chơi không tự đồng nghĩa với sự kiện cảm nhận AI.

### 10.2. Chọn cửa để phá

Khó khăn chính: navigation thường coi cửa đóng là không đi được, nên một lệnh tìm đường bình thường có thể trả “không có đường” trước khi zombie biết cửa nào đáng phá.

Giải pháp tối thiểu không bắt buộc thay engine navigation:

1. Đánh dấu mỗi cửa là một portal nối hai vùng/ô đi lại, có điểm tiếp cận ở mỗi phía.
2. Thử tuyến đang thông tới player hoặc vị trí nhớ gần nhất trước.
3. Nếu không có tuyến thông, thử đường dự kiến qua portal có thể phá, cộng chi phí phá cửa vào tuyến; đường di chuyển thực chỉ tới điểm tiếp cận phía zombie.
4. Chỉ chọn cửa có quan hệ với tuyến tới mục tiêu, không chọn cửa gần nhất bất kỳ.
5. Tới vị trí tiếp cận hợp lệ mới ATTACK_STRUCTURE. Cửa vỡ hoặc mở thì tính lại đường và tiếp tục.
6. Nếu không có tuyến kể cả qua cửa có thể phá, chuyển tìm kiếm/bỏ cuộc; không đánh tường nhà nguyên bản vô hạn.

Với grid có thể biểu diễn ô phá được kèm chi phí cao. Với waypoint/navmesh hiện tại có thể dùng đồ thị phòng/cửa bổ sung; đây là lớp lựa chọn mục tiêu, không cho collider đi xuyên cửa đóng. Chốt cách triển khai dựa trên code thật ở sprint nền tảng.

### 10.3. FSM mở rộng

| State | Mục tiêu | Chuyển trạng thái chính |
|---|---|---|
| IDLE/WANDER | Chờ/đi lang thang theo hành vi hiện có | Thấy player → CHASE |
| CHASE | Tới player đang thấy hoặc vị trí nhớ | Gần player → ATTACK_PLAYER; bị cửa chặn → APPROACH_STRUCTURE |
| APPROACH_STRUCTURE | Tới vị trí đánh hợp lệ ở cửa/công trình | Tới tầm → ATTACK_STRUCTURE; tuyến mở → CHASE |
| ATTACK_STRUCTURE | Damage barricade/cửa/vật cản có thể phá | Cửa vỡ/mở → CHASE; hết thời gian bám mục tiêu → SEARCH |
| SEARCH | Tới/kiểm tra nơi nhìn thấy cuối | Thấy lại → CHASE; hết thời gian → IDLE/WANDER |
| DEAD | Ngừng AI và damage | Không chuyển tiếp |

Có thể gộp state nếu FSM hiện tại đơn giản; điều quan trọng là giữ đúng hành vi và lifecycle target.

### 10.4. Nhiều zombie và thời gian giữ cửa

Đề xuất zombie cơ bản gây 10 damage công trình mỗi 1,2 giây. Cửa chuẩn chỉ có tối đa hai vị trí đánh tiếp xúc; zombie ở hàng sau chờ hoặc tìm lối khác, không đánh xuyên đồng đội từ xa. Nếu collider hiện tại đủ giải quyết hàng chờ, không cần slot manager phức tạp; vẫn phải kiểm chứng số con thật sự ở tầm tiếp xúc.

Ước lượng với hai zombie đánh liên tục, không tính đi đường và animation vào trạng thái:

| Phòng thủ đầy HP | Tổng HP | Thời gian chịu đòn xấp xỉ |
|---|---:|---:|
| Cửa thường | 120 | 7,2 giây |
| Cửa + 3 ván gỗ | 360 | 21,6 giây |
| Cửa + kim loại | 620 | 37,2 giây |

Đây là điểm bắt đầu cân bằng. Phải playtest với thời gian cần rút lui/sửa/đổi lối. Nếu cần cửa trụ lâu hơn, tăng HP hoặc giảm structure damage; không tăng zombie player damage theo cùng tỷ lệ.

### 10.5. Navigation và respawn động

Các sự kiện đóng/mở/phá/xây lại cửa, đặt/phá/tháo vách phải làm mất hiệu lực đường đi liên quan. Dùng revision cho vật cản hoặc cập nhật vùng bị ảnh hưởng, không rebuild toàn map mỗi đòn đánh vào HP.

HP thay đổi nhưng topology chưa đổi thì không cần cập nhật navigation. Nav update có thể xử lý theo hàng đợi; collider mới có hiệu lực ngay và controller phải dừng trước vật cản nếu đường cũ chưa được tính lại.

Respawn hiện có cần kiểm tra cả vật cản mới và vùng trong nhà: không spawn bên trong thùng/vách/cửa, không spawn trong nội thất kín hoặc vùng trú do player đang sử dụng. Trong Phase 2 có thể cấm respawn toàn bộ phòng nội thất để đơn giản. Đừng cho zombie xuất hiện ngay trong nhà vừa barricade vì điểm spawn cũ không biết layout đã thay đổi.

## 11. Dữ liệu và kiến trúc mở rộng

### 11.1. Hợp đồng dữ liệu đề xuất

Đây là phác thảo thiết kế để ánh xạ vào code hiện tại, không phải đoạn mã có thể thay trực tiếp toàn bộ schema đang chạy.

```ts
type ItemInstance =
  | {
      id: string;
      definitionId: string;
      kind: 'stack';
      quantity: number;
    }
  | {
      id: string;
      definitionId: string;
      kind: 'weapon';
      condition: number;
    }
  | {
      id: string;
      definitionId: string;
      kind: 'tool';
      fuel?: number;
    };

// Búa/xà beng là kind 'weapon'; tool capabilities nằm trong definition.
// maxCondition, damage, modelId, stackLimit... nằm ở ItemDefinition.

interface Equipment {
  weaponInstanceId: string | null;
}

interface BarricadeState {
  kind: 'wood' | 'metal';
  hp: number;
  maxHp: number;
  plankCount?: number; // bắt buộc với wood, không dùng với metal
}

interface DoorState {
  id: string;
  state: 'open' | 'closed' | 'destroyed';
  hp: number;
  maxHp: number;
  barricade: BarricadeState | null;
}

interface PlayerStructure {
  id: string;
  definitionId: string;
  position: [number, number, number];
  rotationQuarterTurns: number;
  hp: number;
  containerId?: string;
}
```

Trong code thật có thể dùng discriminated union chặt hơn cho barricade. ID phải duy nhất, ổn định qua save/load và không phụ thuộc thứ tự render/array index. Chuyển đồ giữa inventory/container/world giữ ID cho món không stack; không tạo ID mới chỉ vì đổi chủ chứa.

### 11.2. Quyền sở hữu và save

Chọn một cách lưu item nhất quán: ví dụ bảng instance theo ID và các container lưu slot chứa ID. Equipment chỉ là tham chiếu không sở hữu item; mỗi item phải thuộc đúng một nơi giữa inventory, container và world drop. Tránh vừa lưu bản sao vũ khí trong equipment vừa lưu trong inventory.

Save Phase 2 bổ sung:

- `schemaVersion`, `contentVersion` nếu định nghĩa item/map có thể đổi, `worldSeed` và thời gian như hiện có.
- Ngoại hình player, inventory chứa instance/stack và equipment reference.
- Door state, barricade, công trình player, inventory thùng và đống đồ rơi.
- Condition vũ khí, fuel torch, trạng thái loot generated và các ID đã sinh.
- Trạng thái zombie và respawn phù hợp cơ chế hiện có.

Không lưu mesh, animation mixer, collider handle hoặc đường đi navigation đã tính. Load tái tạo collider/navigation từ world state rồi mới bật simulation; đường zombie được tính lại. Animation và AI có thể về state an toàn lúc load, nhưng HP, thực thể chết và giới hạn respawn không được reset sai.

### 11.3. Chuyển đổi save Phase 1

1. Lấy một save Phase 1 thật làm fixture, chốt schema đang dùng trước khi đặt số phiên bản mới; không mặc định save hiện tại đã là version 1.
2. Giữ bản gốc/backup trước khi chuyển đổi. Chỉ ghi save phiên bản mới sau khi chuyển đổi và validate thành công.
3. Consumable stack giữ số lượng. Melee có sẵn chuyển thành instance condition đầy nếu dữ liệu cũ chưa có condition.
4. Gậy gắn mặc định của save cũ trở thành item thật, trang bị tham chiếu tới instance đó. Nếu 12 ô đã đầy, tạo world drop/container nhận đồ bên cạnh player ở vị trí hợp lệ; không xóa item khác hoặc âm thầm tăng capacity.
5. Gán ngoại hình mặc định cho save cũ. Giữ health, giờ, vị trí và tiến độ loot.
6. Cửa có sẵn nhận HP tương ứng trạng thái cũ; container đã loot không được reset chỉ vì có loot table mới.
7. Nội dung mới cho save cũ: nếu thêm container vào map, dùng ID mới cố định và sinh đúng một lần. Nếu không thêm container, thông báo rõ save cũ không tự nhận lại loot đã lấy; New Game dùng để nghiệm thu đầy đủ tiến trình loot mới.
8. Chạy migration lại với cùng dữ liệu không tạo thêm gậy, container hoặc vật phẩm. Lỗi đọc/schema lạ phải giữ bản gốc và hiển thị lỗi, không tự New Game.

Giữ các save fixture ở mỗi milestone thay đổi schema. Save của bản phát triển đang dở có thể không được hỗ trợ lâu dài, nhưng chính sách phải rõ trước khi phát hành cho người chơi.

### 11.4. Module nên thêm hoặc mở rộng

| Module | Trách nhiệm | Không nên kiêm nhiệm |
|---|---|---|
| Item/Inventory | Definition, instance, ownership, transfer | Điều khiển animation |
| Equipment | Kiểm tra và đổi weapon reference | Giữ bản sao condition |
| Combat | Hit window, damage, condition wear | Trực tiếp sửa UI |
| TimedAction | Reservation, cancel, validate, commit | Tự quyết định mọi recipe |
| Recipe/Repair | Inputs, tool requirements, output | Chứa logic collider |
| Building | Preview validation, spawn structure | Đặt mesh mà thiếu world state |
| Structure/Door | HP, barricade, destroy/open/close | Tự truy đuổi player |
| Perception/AI | LOS, memory, chọn mục tiêu | Biết vị trí player sau tường vô điều kiện |
| Navigation | Vật cản động, portal, repath | Gây damage công trình |
| Persistence | Snapshot, validate, migrate | Serialize object render/physics |

Các sự kiện đáng có: `itemEquipped`, `weaponBroken`, `actionCompleted`, `doorStateChanged`, `barricadeChanged`, `structureCreated`, `structureDestroyed`, `navigationInvalidated`. Có thể dùng event system hiện có hoặc callback đơn giản; chưa cần dựng ECS/event bus mới chỉ cho Phase 2.

## 12. Lộ trình triển khai: 8 sprint

Ước lượng **160–240 giờ**, giả định dùng asset có sẵn phù hợp, kiến trúc Phase 1 tương đối rõ, không phải viết lại navigation. Tương đương khoảng **8–12 tuần ở 20 giờ/tuần** hoặc **11–16 tuần ở 15 giờ/tuần**. Đây là phạm vi lập kế hoạch, cần ước lượng lại sau sprint đầu; tự làm toàn bộ model/rig/animation có thể kéo dài đáng kể.

Mỗi sprint kết thúc bằng một build chơi được và một ghi chú trạng thái. Không đợi đủ tám sprint mới save được dữ liệu mới.

| Sprint | Trọng tâm | Giờ dự kiến | Phụ thuộc chính |
|---|---|---:|---|
| P2-S1 | Dữ liệu item, save và thử cửa động | 16–24 | Phase 1 ổn định |
| P2-S2 | Loot container, equipment, melee, condition | 20–30 | S1 |
| P2-S3 | Model, animation, character creation | 20–30 | Equipment contract S1–S2 |
| P2-S4 | Timed action, crafting và repair | 16–24 | S2 |
| P2-S5 | Perception, zombie phá cửa, repath | 20–30 | Door/navigation contract S1 |
| P2-S6 | Barricade gỗ/kim loại, tool/fuel | 24–36 | S4 + S5 |
| P2-S7 | Building, thùng chứa, vách, rebuild cửa | 24–36 | S4 + S5 + S6 |
| P2-S8 | Tích hợp, cân bằng, migration, release | 20–30 | S1–S7 |

### Sprint P2-S1 — Chốt dữ liệu và kiểm chứng rủi ro

**Mục tiêu:** tạo nền cho instance và thử được cửa thay đổi đường đi trước khi làm nhiều nội dung.

- [x] Đánh dấu bản Phase 1 ổn định: `f56399c` (ghi mốc trong `docs/phase2-s1.md`, không tạo tag/commit/push); ghi lại lệnh build/test và một save mẫu.
- [x] Kiểm tra cách lưu inventory, gậy mặc định, entity IDs, door collider và navigation hiện tại.
- [x] Định nghĩa ItemDefinition/ItemInstance, ownership và equipment reference; chuyển consumable hiện tại mà không mất số lượng.
- [x] Thêm skeleton migration, snapshot và fixture; chốt chính sách gậy save cũ.
- [x] Dựng một phòng thử, một cửa, một zombie; toggle cửa đóng/mở/vỡ rồi kiểm tra collider + repath.
- [x] Thử zombie nhận một cửa trên tuyến tới mục tiêu thay vì chọn cửa gần bất kỳ.
- [x] Chốt cách cập nhật vùng navigation, portal và điểm tiếp cận cửa.

**Đã triển khai 24/09/2026.** Chi tiết quyết định, fixture và kiểm chứng: `docs/phase2-s1.md`; bàn giao hiện tại: `CURRENT_STATE.md`. Phòng thử dev: `?lab=doors`. Chọn cửa là truy vấn thử nghiệm dựa trên vị trí nhớ; tích hợp FSM tự tiếp cận/đập cửa thuộc S5. New Game S1 vẫn có gậy Phase 1, chuyển sang loot ở S2.

**Bàn giao:** build nền tảng vẫn chơi Phase 1 bình thường; hai cây gậy thử nghiệm có thể giữ condition khác nhau sau reload; cửa mở/vỡ làm đường thông thật.

**Cổng quyết định:** nếu navigation không hỗ trợ vật cản động hoặc không tìm được cửa cần phá, giải quyết trong phòng thử trước khi xây vách/barricade trên toàn map.

### Sprint P2-S2 — Từ gậy mặc định sang đồ phải đi tìm

- [x] Bỏ gậy tự cấp ở New Game; giữ shove khi tay không.
- [x] Đặt container thật và nhóm loot; bảo đảm melee đầu game trong một container phải tự lấy.
- [x] Tạo melee definitions: gậy, ống sắt, xà beng, búa; dùng mesh đơn giản trước khi có model hoàn chỉnh.
- [x] Equip/unequip/drop/transfer theo instance ID, vẫn giới hạn 12 ô.
- [x] Implement condition wear, broken 20% damage, tooltip và cảnh báo.
- [x] Lưu condition/weapon reference/loot generation.

**Đã triển khai 24/09/2026.** Chi tiết: `docs/phase2-s2.md`. Gậy giữ baseline Phase 1, vũ khí khác theo tỷ lệ tương đối của bảng §5.2. 4 container ID mới; save v3 thêm chúng một lần khi migrate. Soak tách chính sách shelter (cổng) và patrol (số liệu); baseline soak Phase 1 được xác định là bot kẹt góc. Đánh công trình trừ 2 condition chờ S5–S7.

**Nghiệm thu:** New Game không có gậy; loot và trang bị được; đổi hai cây cùng loại không đổi lẫn condition; hit không gây hao mòn nhiều lần ngoài ý muốn; broken vẫn tồn tại và yếu rõ; reload không hồi condition.

### Sprint P2-S3 — Model và tạo nhân vật

- [x] Kiểm tra quyền dùng asset, rig, scale, bộ animation tối thiểu.
- [x] Gắn player/zombie model vào controller hiện có.
- [x] Chuẩn hóa socket và transform từng melee; đồng bộ hit timing.
- [x] Tạo appearance data, preset và UI preview; thêm Randomize/Reset.
- [x] Kết nối New Game/Back/Continue và lưu ngoại hình.
- [x] Chạy cùng số zombie/camera/settings như baseline Phase 1 để đo ảnh hưởng model.

**Đã triển khai 24/09/2026.** Chi tiết: `docs/phase2-s3.md`. Rig low-poly dựng bằng code (không asset ngoài, không cần giấy phép), pose thuần chạy sau tick; save v4 (tên + ngoại hình). So cùng cảnh với bản S2: draw call 147 → 271 (High) / 238 (Low); FPS GPU thật chưa đo.

**Nghiệm thu:** lựa chọn ngoại hình hiện đúng trong gameplay và save; không xóa save khi thoát màn tạo nhân vật; equip/unequip hiển thị đúng; animation chết không tiếp tục gây damage.

### Sprint P2-S4 — Crafting và sửa chữa

- [x] Thêm wood, scrap metal, tape, nails và loot tương ứng.
- [x] TimedAction: start, reserve, cancel, commit; pause/save đúng thời điểm.
- [x] Recipe data và UI hiện đủ/thiếu nguyên liệu, tool, output.
- [x] Craft gậy gỗ; repair nhóm gỗ/kim loại; xử lý item full condition.
- [x] Kiểm tra inventory full theo trạng thái sau khi tiêu input.
- [x] Test hoàn tất đúng một lần, hủy do di chuyển/bị đánh, save giữa action.

**Đã triển khai 24/09/2026.** Chi tiết: `docs/phase2-s4.md`. 3 container vật liệu ID mới (save v5 thêm một lần khi migrate; bảng loot cũ không đổi). Recipe S4 không cần dụng cụ; cơ chế tool requirement/hao mòn đã có và được test bằng recipe thử, dùng thật ở S6/S7. Sửa kèm lỗi ô tên tạo nhân vật mất ký tự đầu ở bản production (S3).

**Nghiệm thu:** loot vật liệu → sửa vũ khí broken → đánh với damage bình thường; hủy action không mất đồ; spam nút hoặc reload không nhân item.

### Sprint P2-S5 — Zombie phá cửa để vào nhà

- [ ] LOS và last-seen memory; kiểm tra phát hiện qua cửa mở/tường kín.
- [ ] Door HP/state và damage target riêng với player.
- [ ] Chọn portal/cửa hợp lệ, điểm tiếp cận và trạng thái bash.
- [ ] Damage theo hit window, tiếp xúc và cooldown; hạn chế số zombie đánh cửa.
- [ ] Phá cửa cập nhật collider/nav; mở cửa giữa lúc zombie đánh hủy target hợp lý.
- [ ] Audio bash/break và feedback cửa bị hư; lưu HP/trạng thái.
- [ ] Chặn respawn trong nội thất và collider mới.

**Nghiệm thu:** zombie thấy player vào nhà → player đóng cửa → zombie đập cửa → cửa vỡ → zombie vào và tìm/đuổi tiếp. Player chưa từng bị thấy sau tường kín không bị AI phát hiện bằng tọa độ toàn cục.

### Sprint P2-S6 — Barricade và bộ hàn

- [ ] UI ngữ cảnh cửa: gia cố gỗ, hàn metal, sửa, tháo; hiển thị yêu cầu thiếu.
- [ ] Layer HP gỗ 1–3 ván; metal sheet; damage spillover.
- [ ] Tool condition búa; torch fuel; mask requirement; refuel.
- [ ] Không mở cửa khi barricaded; không mix wood/metal.
- [ ] Gián đoạn thao tác khi cửa bị đánh và cooldown sửa 3 giây.
- [ ] Lưu từng layer, HP, plankCount và fuel.
- [ ] Cân bằng thời gian cửa trụ trước một/hai zombie.

**Nghiệm thu:** thiếu búa/đinh hoặc torch/mask/fuel thì không gia cố; gỗ tiêu đúng số vật liệu; metal chịu đòn lâu hơn; phá layer không tự phục hồi cửa; reload không làm mất hoặc nhân barricade.

### Sprint P2-S7 — Xây nơi trú cơ bản

- [ ] Build menu/preview, xoay 90°, footprint và placement validation.
- [ ] Thùng 16 ô, chuyển đồ hai chiều, save/load.
- [ ] Vách gỗ và tái tính đường đi; zombie đánh vách chặn tuyến hợp lệ.
- [ ] Lắp lại cửa vào frame đã vỡ và đồng bộ topology.
- [ ] Tháo dỡ/thu hồi có giới hạn, xử lý inventory full.
- [ ] Thùng bị phá tạo đống đồ rơi giữ nguyên item instance.
- [ ] Regression respawn, collider, đường đi sau reload với nhiều công trình.

**Nghiệm thu:** có thể xây nơi cất đồ và chướng ngại vật, bị zombie phá, phục hồi cửa và tiếp tục dùng; không có vật cản bất tử, không tự nhân nguyên liệu do tháo/xây lặp.

### Sprint P2-S8 — Chơi trọn vòng và phát hành

- [ ] Chạy kịch bản 30–45 phút bằng New Game và seed cố định.
- [ ] Thử nhiều seed: vũ khí đầu game, bộ tool, nhu yếu phẩm và nguồn vật liệu đủ hợp lý.
- [ ] Chạy save Phase 1 qua migration; thử inventory đầy và container cũ đã loot.
- [ ] Cân bằng broken damage, tần suất sửa, loot, HP cửa và lượng fuel.
- [ ] Profile số zombie dự kiến của game, đồng thời animate model và bash/build; tối ưu theo nút thắt đo được.
- [ ] Kiểm tra settings audio mới đi đúng nhóm volume hiện có.
- [ ] Build production, chơi thử bản triển khai, save/reload và kiểm tra asset/model.
- [ ] Ghi release notes, giới hạn đã biết và dữ liệu benchmark.

**Nghiệm thu:** tất cả yêu cầu ở mục 15 đạt; ghi rõ cấu hình máy, độ phân giải, browser, số zombie/công trình khi báo FPS. So sánh cùng một cảnh/seed với Phase 1 để biết chi phí thực của model và navigation động.

## 13. Chiến lược kiểm thử

### 13.1. Unit/integration cho luật dễ gây mất dữ liệu

| Tình huống | Kết quả mong đợi |
|---|---|
| Hai gậy cùng definition, condition 10 và 70 | Không stack, đổi tay không tráo condition |
| Một hit chạm hai zombie | Mỗi target damage tối đa một lần; wear một lần/attackId |
| Condition 1 trước hit | Hit hiện tại đủ damage, sau đó broken; hit kế tiếp còn 20% |
| Repair item full/broken | Full bị chặn; broken được hồi đúng và giữ ID |
| Tool remaining condition = 1 | Một action hoàn tất được, sau đó tool broken và chặn action tiếp |
| Hủy craft hoặc target bị phá | Không tiêu input/fuel, không output, giải phóng reservation |
| Inventory đầy nhưng input bị tiêu hết một stack | Cho craft nếu slot thực tế sau commit đủ chỗ |
| Gửi cùng completion hai lần | Chỉ có một commit và một lần tiêu tài nguyên |
| Barricade HP 5, door HP 120, hit 10 | Layer mất, door còn 115 |
| Gắn ván khi layer còn 30/80 | Thành 110/160; không tự hồi thân cửa |
| Gắn metal khi đang có wood | Bị chặn và không mất nguyên liệu |
| Tháo/build lặp nhiều lần | Không sinh lợi tài nguyên hoặc condition miễn phí |
| Thùng vỡ chứa melee bị hỏng | Đống đồ rơi giữ nguyên ID/condition/số lượng |
| Migration chạy lại/reload nhiều lần | Không cấp lại gậy, reset loot hoặc nhân công trình |
| Save trong hoặc đúng tick hoàn tất action | Toàn bộ trạng thái trước hoặc sau commit, không có trạng thái nửa chừng |

### 13.2. Playtest và kiểm tra trực quan

- Player chạy qua cửa rồi đóng: zombie đuổi, đập đúng phía, không gây damage lên player xuyên cửa.
- Có cửa phụ đang mở: zombie ưu tiên đường thông theo chính sách route; không đập một cửa không liên quan.
- Đứng sau tường kín chưa từng bị thấy: không tự bị khóa mục tiêu.
- Cửa vỡ trong lúc nhiều zombie đang tới: zombie sau không bash một target đã mất.
- Mở cửa khi zombie đang lấy đà: target bị đổi/hủy, không phát hit từ xa.
- Build preview hợp lệ nhưng zombie bước vào trước khi hoàn tất: action không tạo collider chồng zombie hoặc trừ vật liệu sai.
- Xây vách cắt tuyến, phá vách, save/reload: các bước cho cùng kết quả va chạm/navigation.
- Tạo nhà được barricade rồi chạy đủ một chu kỳ respawn: không spawn zombie bên trong nội thất.
- Character preview/appearance và weapon socket xem ở cả idle, run, swing và death.
- Hiệu ứng cửa/model biến mất không còn collider vô hình; công trình còn tồn tại không bị đi xuyên sau load.

Không kiểm chứng toàn bộ bằng unit test; lỗi model, cửa hẹp và zombie chen nhau cần chạy scene thật. Test tự động tập trung luật dữ liệu, damage, action và persistence.

## 14. Rủi ro và cách giảm phạm vi khi trễ

| Rủi ro | Dấu hiệu sớm | Cách xử lý |
|---|---|---|
| Asset khác rig/tỷ lệ | Animation lệch, tay không bám gậy | Kiểm chứng một player/một zombie; mua/tạo thêm chỉ sau khi pipeline chạy |
| Navigation không hiểu cửa | Báo không có đường, đứng yên hoặc đập cửa sai | Phòng thử S1; portal graph hoặc grid có ô phá được |
| Inventory bị nhân bản | Equip item rồi loot vẫn còn bản cũ | Một nguồn instance, equipment reference, invariant ownership |
| Người chơi thiếu công cụ | Không thể sửa búa hoặc dựng nơi trú | Recipe repair không cần chính tool; loot cơ bản có bảo đảm |
| 12 ô quá chật | Phải bỏ hết đồ sống còn để mang tool | Stack vật liệu hợp lý; thùng xây sớm; chưa tăng ô mặc định ngay |
| Spam repair vô hiệu hóa zombie | Cửa không bao giờ vỡ khi giữ sửa | Action bị hủy khi target trúng, thời gian chờ sửa và chi phí |
| Save không đồng nhất | Cửa vỡ nhưng nav vẫn chặn, condition reset | Load world state → collider/navigation → simulation; fixture mỗi sprint |
| Model đông gây tụt FPS | Chi phí animation/shadow tăng mạnh | Giảm clip update ở xa, số shadow, culling; đo trước khi tối ưu lớn |
| Building phình thành game xây dựng | Bắt đầu thêm mái/tầng/nền | Giữ thùng, vách, frame cửa và barricade cho Phase 2 |

**Có thể giảm trước:** số tóc/màu, số biến thể zombie, animation riêng từng vũ khí, số mẫu furniture, hiệu ứng hàn/phá phức tạp. Giữ tối thiểu player/zombie model, lựa chọn ngoại hình, loot melee, condition/broken/repair, craft/build cơ bản và cả hai loại barricade đúng mong muốn.

**Không nên cắt:** kiểm tra ownership, save/migration, collider/nav update, interruption khi craft và chính sách respawn trong nhà. Đây là các điều kiện để tính năng hoạt động cùng nhau.

## 15. Definition of Done toàn Phase 2

- [ ] New Game có tạo ngoại hình, player spawn tay không và vẫn có cách thoát zombie.
- [ ] Player/zombie dùng model với animation tối thiểu; weapon model khớp món trang bị.
- [ ] Tìm được melee trong furniture/container; có nhiều loại có vai trò khác nhau.
- [ ] Mỗi vũ khí có ID/condition; broken còn 20% damage và sửa lại được.
- [ ] Inventory 12 ô, tool/material stack và equip không nhân/mất đồ.
- [ ] Craft/repair/build có điều kiện, thời gian, hủy và commit nhất quán.
- [ ] Có thể xây thùng, vách và lắp lại cửa vỡ; state được lưu.
- [ ] Barricade gỗ cần búa/đinh; kim loại cần sheet/torch/mask/fuel; HP metal cao hơn.
- [ ] Cửa barricaded không mở; tháo/sửa có chi phí và không tạo vòng farm.
- [ ] Zombie thấy player vào nhà, có thể tới và phá cửa/layer đúng thứ tự.
- [ ] Cửa/vách đổi trạng thái làm collider/navigation cập nhật; zombie không đánh xuyên tường/cửa.
- [ ] Respawn không vô hiệu hóa nơi trú bằng cách spawn trong nội thất.
- [ ] Continue khôi phục ngoại hình, item condition, fuel, HP cửa/layer, công trình và đồ trong thùng.
- [ ] Save Phase 1 được migrate theo chính sách rõ ràng và không bị ghi đè khi lỗi.
- [ ] Phiên playtest 30–45 phút hoàn thành vòng trang bị–sửa chữa–phòng thủ; bản production chạy ổn trên cấu hình thử được ghi lại.

## 16. Việc đầu tiên nên làm và bàn giao giữa các phiên phát triển

**Task đầu tiên: P2-S1 — Item instance + equipment reference + save fixture.** Chỉ sau khi condition có thể đi theo một cây gậy qua loot/equip/drop/save mới tăng số lượng item và recipe. Cùng sprint, dựng phòng thử cửa động để xác nhận navigation có thể phục vụ phần phá cửa/building.

Nên duy trì các tài liệu ngắn trong repository khi bắt đầu thực hiện, cập nhật theo code thật:

| Tài liệu | Nội dung |
|---|---|
| `docs/phase-2-plan.md` | Bản kế hoạch này và các thay đổi phạm vi đã chốt |
| `docs/project-state.md` | Sprint đang làm, phần hoàn tất, lỗi còn lại, build/test gần nhất |
| `docs/decisions.md` | Quyết định có hệ quả: ownership, save version, navigation, recipes |
| `docs/next-task.md` | Một nhiệm vụ kế tiếp, file/module liên quan và tiêu chí nghiệm thu |

Không đánh dấu “hoàn tất” chỉ vì đã có UI hoặc model: phải có gameplay, dữ liệu save và kiểm tra tương tác với các hệ thống khác. Kết thúc mỗi sprint bằng một save mẫu và một build để có điểm quay lại nếu sprint sau làm hỏng hành vi cũ.
