Tôi đang phát triển một game zombie survival bằng React + Three.js. Hãy triển khai hệ thống tầm nhìn của người chơi theo phong cách Project Zomboid.

## Mục tiêu

Người chơi không được nhìn thấy toàn bộ zombie chỉ vì chúng đang nằm trong phạm vi camera. Camera và tầm nhìn thực tế của nhân vật phải là hai khái niệm riêng biệt.

Zombie chỉ được hiển thị rõ khi nhân vật thực sự có khả năng nhìn thấy chúng.

Hệ thống cần bao gồm:

1. Near Detection Radius
2. Vision Cone / Field of View
3. Line of Sight
4. Occlusion bởi tường và vật cản
5. Hidden / Visible state cho zombie
6. Fog / darkening cho vùng ngoài tầm nhìn nếu phù hợp với kiến trúc hiện tại

Không được làm ảnh hưởng tới AI zombie. Zombie vẫn phải tồn tại, pathfinding, wander, chase và xử lý logic bình thường ngay cả khi player không nhìn thấy chúng.

---

# 1. Kiến trúc tổng thể

Hãy tách hệ thống thành các module độc lập nếu phù hợp:

```text
Player
  ↓
PlayerVisionSystem
  ├── Near Detection
  ├── Vision Cone
  ├── Distance Check
  ├── Line Of Sight
  └── Visibility Result
          ↓
      Zombie Renderer
```

Không được viết logic kiểu:

```js
if (!zombie.visible) {
  stopZombieAI();
}
```

`visible` chỉ ảnh hưởng tới việc player có nhìn thấy zombie hay không.

AI zombie phải hoàn toàn độc lập với PlayerVisionSystem.

---

# 2. Near Detection Radius

Tạo một vùng nhận biết rất gần xung quanh player.

Ví dụ:

```js
nearDetectionRadius = 2.5;
```

Nếu zombie nằm trong bán kính này, player luôn có thể phát hiện zombie ngay cả khi nó đang ở phía sau nhân vật.

Mục đích là tránh tình trạng zombie đứng sát lưng player nhưng hoàn toàn biến mất vì nằm ngoài vision cone.

Logic:

```text
distance <= nearDetectionRadius
        ↓
visible = true
```

Near Detection Radius phải có priority cao hơn Vision Cone.

---

# 3. Vision Cone

Player chỉ nhìn thấy zombie trong một vùng hình quạt phía trước.

Các config ban đầu:

```js
visionDistance = 20;
fieldOfView = 110;
```

Các giá trị này phải được đặt trong config để dễ chỉnh sau này.

Vision Cone phụ thuộc vào:

- vị trí player
- hướng player đang nhìn
- vị trí zombie
- khoảng cách tới zombie
- góc giữa hướng player và zombie

Sử dụng dot product thay vì tính angle bằng `acos` nếu có thể để tối ưu performance.

Ví dụ:

```js
const directionToZombie = zombie.position
  .clone()
  .sub(player.position);

const distance = directionToZombie.length();

directionToZombie.normalize();

const playerForward = new THREE.Vector3(0, 0, -1)
  .applyQuaternion(player.quaternion)
  .normalize();

const dot = playerForward.dot(directionToZombie);

const threshold = Math.cos(
  THREE.MathUtils.degToRad(fieldOfView / 2)
);

const insideVisionCone = dot >= threshold;
```

Zombie phải thỏa mãn:

```text
distance <= visionDistance

AND

insideVisionCone === true
```

trước khi thực hiện LOS check.

---

# 4. Line Of Sight

Zombie nằm trong vision cone chưa chắc đã nhìn thấy được.

Phải raycast từ vị trí mắt / phần thân trên của player tới zombie.

Ví dụ:

```text
Player
   \
    \ ray
     \
     Wall
      |
      |       Zombie
```

Nếu ray chạm wall trước zombie:

```text
visible = false
```

Nếu không có vật cản:

```text
visible = true
```

Không raycast từ chân player.

Tạo một eye position:

```js
const eyePosition = player.position.clone();

eyePosition.y += playerEyeHeight;
```

Ví dụ:

```js
playerEyeHeight = 1.6;
```

Target của zombie cũng nên nằm khoảng giữa thân:

```js
const zombieTarget = zombie.position.clone();

zombieTarget.y += zombieTargetHeight;
```

Ví dụ:

```js
zombieTargetHeight = 1.2;
```

---

# 5. Occluder Layer

Không được raycast toàn bộ scene vì sẽ rất tốn performance.

Chỉ raycast những object thực sự có thể chặn tầm nhìn như:

```text
walls
closed doors
large furniture
buildings
solid obstacles
```

Không raycast các object như:

```text
grass
loot item
small decoration
particle
blood decal
UI marker
```

Hãy tạo một danh sách hoặc layer riêng:

```js
visionOccluders
```

Ví dụ:

```js
visionOccluders = [
  ...walls,
  ...closedDoors,
  ...largeObstacles
];
```

PlayerVisionSystem chỉ raycast vào danh sách này.

---

# 6. Door logic

Door phải có ảnh hưởng tới LOS.

Ví dụ:

```text
Door closed
→ block vision

Door open
→ không block vision
```

Nếu door đang mở, nó phải được:

- remove khỏi `visionOccluders`

hoặc

- disable collision đối với raycast vision

Không nên recreate toàn bộ system mỗi lần mở cửa.

---

# 7. Window logic

Window nên hoạt động khác wall.

Window bình thường:

```text
không block vision
```

Curtain đóng:

```text
block vision
```

Curtain mở:

```text
không block vision
```

Nếu game chưa có curtain system, hãy thiết kế architecture sao cho sau này có thể bổ sung mà không phải sửa PlayerVisionSystem.

---

# 8. Visibility state

Mỗi zombie có state riêng:

```js
zombie.isVisibleToPlayer
```

Không nên trực tiếp dùng:

```js
mesh.visible
```

làm source of truth.

Thay vào đó:

```text
PlayerVisionSystem
        ↓
isVisibleToPlayer
        ↓
Renderer
        ↓
mesh.visible / fade effect
```

Ví dụ:

```js
zombie.isVisibleToPlayer = visibilityResult;
```

Renderer sau đó quyết định cách hiển thị.

---

# 9. Fade thay vì pop-in

Nếu có thể, không để zombie biến mất / xuất hiện tức thì.

Thêm opacity transition.

Ví dụ:

```text
hidden

0 opacity
   ↓
0.3
   ↓
0.6
   ↓
1.0

visible
```

Thời gian transition khoảng:

```js
visibilityFadeDuration = 0.15 - 0.3 seconds;
```

Zombie vừa đi ra khỏi LOS cũng fade out nhẹ thay vì biến mất ngay.

Nếu material hiện tại không hỗ trợ opacity thì hãy chỉnh material phù hợp.

---

# 10. Memory rất ngắn

Có thể thêm visibility grace period để tránh flickering khi zombie bị che bởi object rất nhỏ hoặc raycast thay đổi liên tục.

Ví dụ:

```js
visibilityGracePeriod = 0.15;
```

Nếu zombie vừa mất LOS trong vòng 150ms:

```text
không hide ngay
```

Nếu sau thời gian này vẫn không thấy:

```text
fade out
```

Đây KHÔNG phải là AI memory.

Nó chỉ là visual smoothing.

---

# 11. Player quay người

Vision cone phải update theo orientation thực tế của player.

Không sử dụng hướng camera làm hướng nhìn.

Ví dụ nếu camera isometric đang nhìn về phía Đông Nam nhưng player quay về phía Bắc:

```text
vision direction = hướng player

KHÔNG PHẢI

vision direction = hướng camera
```

Lấy forward vector từ quaternion hoặc rotation của character.

---

# 12. Camera không quyết định visibility

Camera vẫn có thể nhìn thấy map phía sau player.

Tuy nhiên zombie phía sau player không được hiện nếu nằm ngoài near radius.

Ví dụ:

```text
       Camera
          \
           \
            Player →

      Zombie
```

Nếu zombie ở phía sau player:

```text
camera có thể nhìn thấy vị trí zombie

nhưng

PlayerVisionSystem = false
```

Zombie phải bị ẩn.

---

# 13. Fog / vùng tối

Nếu phù hợp với kiến trúc hiện tại, hãy thêm một lớp visual để khu vực ngoài tầm nhìn player tối hơn.

Không cần mô phỏng Project Zomboid chính xác 100%.

Mục tiêu:

```text
inside vision
→ normal lighting

outside vision
→ darker

unexplored / strongly occluded
→ very dark
```

Nếu hệ thống fog quá phức tạp cho phase hiện tại, hãy tách nó thành module riêng và chỉ chuẩn bị interface.

Ví dụ:

```js
VisionMaskSystem
```

Không được để việc chưa có fog cản trở implementation của zombie visibility.

---

# 14. Performance

Game có thể có rất nhiều zombie, vì vậy không được raycast tất cả zombie mỗi frame một cách thiếu kiểm soát.

Phải thực hiện broad phase trước.

Thứ tự:

```text
Zombie
 ↓
Distance check
 ↓
Near radius?
 ↓
Vision cone?
 ↓
LOS raycast
```

Nếu zombie ngoài `visionDistance`:

```text
không raycast
```

Nếu zombie ngoài cone:

```text
không raycast
```

Chỉ những zombie vượt qua broad phase mới được raycast.

---

# 15. Update frequency

Không bắt buộc phải check toàn bộ vision ở 60 FPS.

Thiết kế để có thể update:

```js
visionUpdateInterval = 50;
```

tức khoảng:

```text
20 lần / giây
```

hoặc sử dụng staggered update.

Ví dụ:

Frame 1:

```text
Zombie 0-20
```

Frame 2:

```text
Zombie 21-40
```

Frame 3:

```text
Zombie 41-60
```

Nếu số zombie thấp thì có thể check toàn bộ.

Hãy lựa chọn implementation cân bằng giữa responsiveness và performance.

---

# 16. Spatial optimization

Nếu project hiện tại đã có:

- chunk
- spatial hash
- grid
- quadtree
- nearby entity system

hãy tận dụng chúng.

Chỉ query zombie trong:

```text
player.position ± visionDistance
```

thay vì loop toàn bộ zombie trên map.

Nếu hiện tại chưa có spatial structure thì đừng over-engineer, nhưng hãy viết PlayerVisionSystem để sau này có thể thay:

```js
allZombies
```

bằng:

```js
getNearbyZombies(player.position, radius)
```

---

# 17. Debug mode

Hãy thêm debug visualization.

Khi:

```js
DEBUG_PLAYER_VISION = true;
```

hiển thị:

### Vision distance

Một vòng tròn quanh player.

### Near radius

Một vòng tròn nhỏ quanh player.

### Vision cone

Hai line từ player thể hiện:

```text
-FOV / 2
+FOV / 2
```

### LOS ray

Có thể vẽ ray tới zombie đang được test.

Ví dụ:

```text
green ray = visible

red ray = blocked
```

### Zombie state

Có thể hiển thị trên zombie:

```text
VISIBLE

OUTSIDE FOV

OUT OF RANGE

BLOCKED

NEAR DETECTION
```

Debug visualization phải có thể bật/tắt hoàn toàn.

---

# 18. Visibility priority

Logic cuối cùng nên gần giống:

```js
function canPlayerSeeZombie(player, zombie) {

  const distance = getDistance(player, zombie);

  // Không cần xử lý quá xa
  if (distance > visionDistance) {
    return false;
  }

  // Zombie rất gần player
  if (distance <= nearDetectionRadius) {
    return true;
  }

  // Kiểm tra FOV
  if (!isInsideVisionCone(player, zombie)) {
    return false;
  }

  // Kiểm tra LOS
  if (!hasLineOfSight(player, zombie)) {
    return false;
  }

  return true;
}
```

Tách các function rõ ràng:

```js
getNearbyEntities()

isInsideVisionCone()

hasLineOfSight()

updateVisibility()

updateVisibilityFade()
```

Không viết toàn bộ logic vào một component React.

---

# 19. React + Three.js architecture

Nếu project đang sử dụng React Three Fiber, ưu tiên:

- system/controller riêng xử lý logic
- component chỉ chịu trách nhiệm render
- tránh setState React liên tục mỗi frame

Không nên:

```js
setZombieVisible(...)
```

60 lần / giây qua React state.

Có thể dùng:

- refs
- entity state
- game store
- ECS nếu project đã có
- mutable runtime state

React chỉ nên quản lý state dài hạn hoặc UI.

---

# 20. Integration với zombie system

Zombie AI hiện tại có thể có các state dạng:

```text
IDLE
WANDER
INVESTIGATE
CHASE
ATTACK
```

Không chỉnh logic AI chỉ vì zombie không visible.

Ví dụ:

```text
Zombie đang WANDER
player không thấy zombie
→ zombie vẫn wander

Zombie đang CHASE
player quay lưng nên không nhìn thấy zombie
→ zombie vẫn chase

Player nhìn lại
→ zombie xuất hiện trong LOS
```

PlayerVisionSystem và ZombiePerceptionSystem phải là hai hệ thống riêng.

---

# 21. Player vision khác Zombie vision

Không reuse trực tiếp PlayerVisionSystem cho Zombie AI.

Sau này zombie có thể có:

```text
ZombiePerceptionSystem

- visual detection
- hearing
- target memory
- last known position
```

Trong khi PlayerVisionSystem chỉ chịu trách nhiệm:

```text
player có thể nhìn thấy entity nào?
```

Hãy giữ architecture đủ sạch để hai hệ thống không phụ thuộc chéo không cần thiết.

---

# 22. Config

Tạo một config tập trung, ví dụ:

```js
export const PLAYER_VISION_CONFIG = {

  nearDetectionRadius: 2.5,

  visionDistance: 20,

  fieldOfView: 110,

  playerEyeHeight: 1.6,

  zombieTargetHeight: 1.2,

  visibilityFadeDuration: 0.2,

  visibilityGracePeriod: 0.15,

  visionUpdateInterval: 50,

};
```

Không hardcode các giá trị này ở nhiều file.

---

# 23. Edge cases

Hãy xử lý các trường hợp:

### Zombie sát player nhưng phía sau

→ visible vì Near Detection.

### Zombie phía trước nhưng sau wall

→ hidden.

### Zombie phía trước qua doorway đang mở

→ visible.

### Zombie phía trước nhưng door đóng

→ hidden.

### Zombie ngoài FOV nhưng camera nhìn thấy

→ hidden.

### Zombie ngoài vision distance

→ hidden.

### Player quay nhanh 180 độ

→ visibility update ngay hoặc rất nhanh.

### Zombie chạy qua góc tường

→ fade out thay vì pop.

### Zombie từ sau lưng đi sát player

→ xuất hiện khi vào near radius.

---

# 24. Không phá hệ thống hiện tại

Trước khi code:

1. đọc architecture hiện tại
2. xác định Player component
3. xác định Zombie entity/component
4. xác định hệ thống wall/collision
5. xác định cửa / building object
6. xác định game update loop
7. xác định hệ thống zombie manager

Sau đó mới integrate.

Không rewrite toàn bộ zombie system nếu không cần thiết.

Ưu tiên thay đổi tối thiểu nhưng architecture sạch.

---

# 25. Kết quả mong muốn

Sau khi hoàn thành:

Khi player nhìn về phía trước:

```text
zombie phía trước + không có wall
→ hiện

zombie phía trước + sau wall
→ ẩn

zombie phía sau
→ ẩn

zombie phía sau nhưng đứng sát player
→ hiện
```

Khi player quay người:

```text
những zombie mới lọt vào FOV
→ fade in

những zombie ra khỏi FOV
→ fade out
```

Camera không được quyết định visibility của zombie.

---

# 26. Yêu cầu code

Hãy:

1. Phân tích codebase hiện tại trước khi sửa.
2. Nêu ngắn gọn những file cần thay đổi.
3. Tạo PlayerVisionSystem hoặc module tương đương.
4. Tách config riêng.
5. Implement Near Detection Radius.
6. Implement Vision Cone.
7. Implement Line of Sight.
8. Implement occluder filtering.
9. Integrate zombie visibility.
10. Thêm fade.
11. Thêm debug visualization.
12. Đảm bảo zombie AI vẫn hoạt động khi invisible.
13. Kiểm tra performance.
14. Không gây regression cho combat, zombie AI, inventory hoặc các system hiện tại.
15. Chạy build/lint/test nếu project hiện tại có script tương ứng.

Sau khi hoàn thành, hãy báo cáo:

```text
Files changed

Architecture added

Vision algorithm

Performance optimization

Config values

Edge cases handled

Known limitations
```

Ưu tiên implementation đơn giản, dễ maintain, dễ mở rộng và phù hợp với game survival có số lượng zombie lớn.
