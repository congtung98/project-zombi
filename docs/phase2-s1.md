# P2-S1 — Quyết định và kiểm chứng

Ngày: 24/09/2026. Phạm vi: mục Sprint P2-S1 trong `Zombie_Outbreak_Phase_2_Plan.md`.

## Baseline và fixture

- Mốc Phase 1: `f56399c` (`docs: update project status after phase 1 sprint 6`); mã Sprint 6: `f2f70b2`. Đã ghi nhận mốc, không tạo tag/commit/push theo yêu cầu chủ dự án.
- Trước đổi schema: 113 test hiện có pass. Một test xuất fixture tạm thời chạy cùng suite (114/114), sau đó gỡ test xuất file để test thường không sửa repository.
- `src/game/systems/fixtures/phase1-v1.json`: xuất từ `GameRuntime` Phase 1 trước khi sửa source, seed `20260924`; đã lấy một stack từ tủ đầu tiên, health 73, clock 30 giây. Không phải save do người chơi gửi hay fixture tự đoán schema.
- `src/game/systems/fixtures/phase2-s1-v2.json`: snapshot từ smoke Chrome/IndexedDB sau migrate, có hai gậy condition 10/70; test kiểm tra round-trip fixture này.
- Lệnh baseline/kiểm tra: `npm test`, `npm run build` (gồm `tsc -b`), `npm run lint`; `npx vitest run src/game/core/soak.test.ts --reporter=verbose` để xem số liệu.

## Ownership và equipment

Giữ inventory dạng mảng slot chứa instance, không thêm registry thứ hai. Mỗi instance thuộc đúng một inventory/container; equipment chỉ có `weaponInstanceId`. `itemId` là tên field tham chiếu definition được giữ từ Phase 1, tương đương `definitionId` trong phác thảo plan. Weapon/tool có quantity = 1 và không stack; stack chứa quantity nguyên dương trong giới hạn definition.

Inventory có namespace `id` và `nextItemId`; ID mới là `namespace:counter`. Counter được lưu, tăng đơn điệu, validator kiểm tra cả item đã chuyển khỏi nơi sinh để không tái dùng ID. Chuyển weapon/tool và cả stack nguyên giữ ID; tách stack cấp ID mới cho phần tách, gộp giữ ID stack đích. UI clone inventory, không giữ object simulation để chỉnh condition.

S1 có duy nhất definition melee `baseball_bat`, maxCondition 80. Các damage/cooldown vẫn dùng config Phase 1, condition chưa hao mòn và chưa giảm damage khi hỏng. New Game cấp gậy thật, trang bị sẵn, nằm ô cuối. Equip/unequip/transfer/drop tối thiểu được nối vào UI để kiểm chứng hợp đồng qua vòng chơi. Chuyển/thả món đang cầm tự bỏ equipment reference; chặn thay đồ khi đang vung.

Túi đồ rơi là container một ô có vị trí trong save và marker không có collider, tương tác bằng E. Không tạo loot ngẫu nhiên cho túi này. Load không cắt ô hay kẹp số lượng nữa: dữ liệu sai bị chặn trước khi reset runtime.

## Persistence

Schema v1 → v2 là hàm thuần, xác định, không mutate đầu vào. Consumable giữ slot/số lượng; cửa cũ nhận state và HP 120; giữ loot, stats và clock. Gậy Phase 1 nhận condition đầy và equipment reference nếu túi còn chỗ. Đủ 12 ô: thêm `drop:legacy-bat` tại vị trí player hợp lệ trong ván cũ, equipment null; không tăng capacity, không mất item. Ngoại hình mặc định và dữ liệu model sẽ bổ sung khi S3 triển khai appearance schema.

Menu chỉ validate/migrate trong bộ nhớ để hiển thị Continue. Khi Continue: validate kết quả → transaction kiểm tra slot chưa bị tab khác thay đổi → backup v1 và ghi v2 nguyên tử → load. Backup đầu tiên là `slot-1.backup-v1`; nếu một v1 khác được nhập về sau, backup thêm UUID thay vì ghi đè backup cũ. Schema lạ/lỗi ownership/capacity/condition/ID/counter giữ nguyên slot và báo lỗi. Không tự New Game. Autosave cũng validate trước khi ghi.

Không có container loot mới ở S1; save cũ không reroll. `slot-lab` dành riêng phòng thử. Không lưu physics handle, navigation path hay object render.

## Cửa và navigation

- Cửa: một `state` (`closed/open/destroyed`), HP 0 chỉ khi destroyed. `DoorView` bỏ body khi vỡ; render/test Rapier dùng cùng `doorLeafTransform` và leaf thickness.
- Cập nhật nav chỉ chạm union ô corridor/open-leaf của cửa đổi; tính cả cửa khác phủ cùng ô để không xóa blocker chồng nhau. Không rebuild toàn grid khi toggle; revision chỉ tăng khi topology thay đổi.
- Portal có hai điểm tiếp cận, cách mặt tường `wallThickness/2 + agentRadius + cellSize`. Điểm không walkable không tham gia graph.
- `findDoorRoute` thử A* đường thông trước. Nếu bế tắc, graph các phía portal dùng các đoạn A* thật làm cạnh di chuyển và chi phí phá cửa cố định 12 (đơn vị đường đi, tạm cho spike) làm cạnh qua cửa đóng. Trả về cửa đóng đầu tiên trên tuyến và path thật tới phía tiếp cận. Có test nhiều cửa nối tiếp, cửa gần không liên quan, cửa phụ mở, phòng không có portal.
- Truy vấn không đổi nav/collider, không cho agent đi xuyên cửa đóng. Lab chỉ gọi với `zombie.lastKnownTarget`, không dùng tọa độ player chưa từng thấy. Cơ chế này chưa tích hợp FSM approach/bash ở map chính; đó là S5. Graph/A* nhiều cặp chỉ dùng khi cần chọn mục tiêu, cần cache theo revision khi tích hợp S5; không chạy mọi frame/mọi zombie.
- Sửa lỗi Phase 1 được test phơi bày: A* trả null nhưng `moveTowards` vẫn đi thẳng tới goal. Giờ trả vận tốc 0; khi cửa mở/vỡ AI tính lại đường.

## Kiểm chứng

- 135 test qua, gồm hai fixture, túi đầy, ID/ownership/counter sai, equip/transfer/drop, condition qua reload, không mutate save lỗi.
- Test Rapier WASM thật: capsule bị cửa đóng chặn, qua được cửa mở/vỡ. Test revision/repath và snapshot cửa vỡ.
- Soak 30 phút: sống, 11 kill, damageTaken 60, minHealth 40, endHealth 65; 7/7 tủ, 29 snapshot, 11 spawn, maxZombies 9; dùng 4 water/3 canned_food/1 bandage. Không chỉnh balance.
- Chrome headless 1280×800, profile thử riêng: migration v1, backup, hai condition 10/70, full bag drop, từ chối schema 99, transaction conflict giữ slot; DoorView/PhysicsBridge raycast khớp nav qua closed/open/destroyed/closed; save/load cửa vỡ và slot-lab không sửa slot-1.
- Script browser: chạy Vite mới trên `127.0.0.1:5173`, Chrome headless với `--remote-debugging-port=9223` và profile thử riêng, rồi `node scripts/p2-smoke.mjs`. Script có ghi/xóa save trong profile thử; không chạy với profile chơi thật. Restart Vite sau sửa source trước chạy script để tránh import URL có timestamp HMR tạo runtime thứ hai.
- Production: `npm run preview -- --host 127.0.0.1 --port 5199 --strictPort`, rồi `node scripts/p2-smoke.mjs --production` trên cùng Chrome thử; chỉ điều khiển UI/đọc IndexedDB, kiểm tra New Game → túi → save → reload → Continue và không mở lab bằng query.

Chưa đo FPS GPU thật hoặc playtest tay dài. Cảnh báo deprecated của THREE.Clock/Rapier init và Vite advancedChunks còn từ Phase 1. Test bot không thay thế cảm giác điều khiển/cân bằng của người chơi.

## Tiếp theo

P2-S2: bỏ grant gậy trong `GameRuntime.newGame`, bảo đảm melee trong container đầu game, thêm definitions/loot, wear một lần/attackId, broken damage 20%, tooltip/cảnh báo. Giữ v1 migration cấp gậy riêng; không sửa fixture v1. Cập nhật CURRENT_STATE cuối sprint, người dùng tự commit/push.
