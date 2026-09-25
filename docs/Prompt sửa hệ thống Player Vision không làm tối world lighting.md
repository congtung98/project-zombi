Tôi đang phát triển một game zombie survival bằng React + Three.js. Hiện tại tôi đã triển khai Player Vision System theo kiểu Project Zomboid, nhưng implementation hiện tại đang có lỗi thiết kế:

- Ban ngày ngoài trời, vùng nằm trong POV / vision cone của player sáng bình thường.
- Các vùng nằm ngoài POV bị làm tối mạnh, gần giống ban đêm.
- Điều này khiến toàn bộ world lighting bị phụ thuộc vào hướng nhìn của player.
- Đây KHÔNG phải hành vi tôi mong muốn.

Tôi muốn sửa hệ thống theo nguyên tắc:

```text
WORLD LIGHTING != PLAYER VISION
```

Player Vision chỉ quyết định player có nhận biết / nhìn thấy entity nào.

Player Vision KHÔNG được thay đổi ánh sáng môi trường của game.

---

# 1. Mục tiêu sửa lỗi

Sau khi sửa:

Ban ngày ngoài trời:

```text
road
terrain
trees
buildings
grass
environment
```

phải vẫn sáng theo hệ thống Day/Night và sunlight bình thường ở mọi hướng.

Ví dụ player quay mặt sang phải:

```text
                Player →
```

thì:

```text
phía trước player
→ world vẫn sáng

phía sau player
→ world vẫn sáng

bên trái
→ world vẫn sáng

bên phải
→ world vẫn sáng
```

Chỉ có entity như zombie mới bị ảnh hưởng bởi Player Vision.

Ví dụ:

```text
Zombie trong FOV + có LOS
→ visible

Zombie ngoài FOV
→ hidden / faded

Zombie sau wall
→ hidden

Zombie sát player
→ visible theo near detection
```

Nhưng terrain và environment tuyệt đối không được tối thành ban đêm chỉ vì nằm ngoài FOV.

---

# 2. Tách hoàn toàn World Lighting khỏi Player Vision

Kiến trúc mong muốn:

```text
                    GAME
                      │
          ┌───────────┴───────────┐
          │                       │
   World Lighting          Player Vision
          │                       │
   DayNightSystem             FOV
   Sun                       LOS
   Ambient                   Near Radius
   Sky                       Entity Visibility
   Lamps
   Indoor lighting
          │                       │
          └───────────┬───────────┘
                      │
                  Renderer
```

World Lighting và Player Vision là hai system độc lập.

Không được để:

```text
PlayerVisionSystem
      ↓
AmbientLight intensity
DirectionalLight intensity
Sun intensity
Exposure
Scene environment
```

---

# 3. Những thứ PlayerVisionSystem KHÔNG ĐƯỢC PHÉP chỉnh

Hãy tìm toàn bộ code hiện tại liên quan tới Player Vision và xóa / refactor mọi logic làm thay đổi:

```js
ambientLight.intensity
directionalLight.intensity
hemisphereLight.intensity
sunLight.intensity
scene.environment
scene.environmentIntensity
renderer.toneMappingExposure
renderer.outputColorSpace
scene.background
fog density
world material brightness
global shader brightness
```

Nếu những giá trị trên đang thay đổi theo:

```js
playerFacing
visionCone
isInsideFOV
visionMask
```

thì implementation đó là sai.

Player Vision không được phép điều khiển chúng.

---

# 4. DayNightSystem phải là source of truth cho world lighting

World lighting chỉ được quyết định bởi các system như:

```text
DayNightSystem
WeatherSystem
IndoorLightingSystem
LampSystem
EnvironmentLightingSystem
```

Ví dụ:

```js
sunLight.intensity = dayNightSystem.sunIntensity;
ambientLight.intensity = dayNightSystem.ambientIntensity;
```

Không được viết:

```js
sunLight.intensity *= visionMask;
```

Không được:

```js
ambientLight.intensity =
  isInsidePlayerFOV
    ? normalIntensity
    : normalIntensity * 0.2;
```

Không được:

```js
material.color.multiplyScalar(visionFactor);
```

cho toàn bộ environment.

---

# 5. PlayerVisionSystem chỉ được chịu trách nhiệm perception

PlayerVisionSystem chỉ cần trả về thông tin dạng:

```js
{
  visible: true,
  reason: "LOS"
}
```

hoặc:

```js
{
  visible: false,
  reason: "OUTSIDE_FOV"
}
```

Các reason có thể là:

```text
VISIBLE
NEAR_DETECTION
OUTSIDE_FOV
OUT_OF_RANGE
BLOCKED_BY_OCCLUDER
```

Không đưa brightness của world vào result này.

---

# 6. Entity visibility

Mỗi zombie hoặc NPC cần có:

```js
entity.isVisibleToPlayer
```

PlayerVisionSystem cập nhật giá trị này.

Ví dụ:

```js
zombie.isVisibleToPlayer =
  canPlayerSeeZombie(player, zombie);
```

Renderer sau đó quyết định:

```text
visible
fade in
fade out
hidden
```

Không được dùng Player Vision để chỉnh độ sáng của road / terrain / building.

---

# 7. Giữ nguyên toàn bộ environment rendering

Các object environment như:

```text
terrain
roads
walls
houses
trees
grass
cars
decorations
street objects
```

phải tiếp tục render theo world lighting bình thường.

Player quay lưng với một căn nhà:

```text
house vẫn sáng theo daylight
```

Nhưng zombie đứng cạnh căn nhà có thể:

```text
hidden
```

nếu ngoài FOV.

Đây là hành vi mong muốn.

---

# 8. Optional perception overlay

Nếu hiện tại đã có `VisionOverlay`, `VisionMask`, post-processing hoặc shader làm tối vùng ngoài FOV thì hãy kiểm tra.

Nếu overlay hiện tại đang làm tối quá mạnh:

```text
outside FOV ≈ night
```

hãy tắt hoặc giảm mạnh.

Trong phase hiện tại, ưu tiên:

```text
NO environment darkening
```

Tức là:

```text
inside FOV
→ environment unchanged

outside FOV
→ environment unchanged
```

Player Vision chỉ thay đổi entity visibility.

Sau này nếu muốn thêm perception shading thì phải là effect rất nhẹ.

Ví dụ:

```js
insideVisionFactor = 1.0;
outsideVisionFactor = 0.9;
```

Không dùng:

```js
outsideVisionFactor = 0.1;
```

vì sẽ biến ban ngày thành ban đêm.

---

# 9. Nếu vẫn giữ VisionOverlay

Nếu codebase đã có VisionOverlay và không muốn bỏ hoàn toàn, hãy sửa nó để:

```text
overlay chỉ là visual perception layer
không phải lighting layer
```

Overlay không được chỉnh light source.

Không được:

```js
light.intensity *= overlay;
```

Thay vào đó overlay chỉ nên là:

```text
screen-space alpha mask
hoặc
very subtle world-space overlay
```

Ví dụ:

```js
overlayOpacity = 0.05 - 0.15;
```

Và overlay phải preserve daylight.

---

# 10. Ban ngày ngoài trời

Case cần test:

```text
time = 12:00
weather = clear
player = outside
```

Expected:

```text
world brightness:
100% controlled by daylight

player facing:
không ảnh hưởng world brightness
```

Player quay 360 độ:

```text
sun intensity
ambient intensity
road brightness
building brightness
terrain brightness
```

phải không đổi.

Chỉ danh sách entity visible được thay đổi.

---

# 11. Ban đêm

Case:

```text
time = 00:00
player outside
```

Expected:

World tối vì:

```text
DayNightSystem
```

không phải vì Player Vision.

Nếu player quay về phía zombie:

```text
zombie visible nếu đủ FOV + LOS
```

nhưng độ sáng tổng của world vẫn do night lighting quyết định.

---

# 12. Indoor lighting

Một căn phòng có thể tối vì:

```text
không có window
không có lamp
không có sunlight propagation
```

Đây là IndoorLighting / WorldLighting.

Không phải vì:

```text
player không nhìn vào phòng
```

Player quay lưng khỏi căn phòng:

```text
room lighting không đổi
```

Player quay lại:

```text
room lighting vẫn giữ nguyên
```

Chỉ entity trong phòng mới thay visibility theo PlayerVisionSystem.

---

# 13. Door và window

Door / window vẫn có thể tham gia LOS.

Ví dụ:

```text
closed door
→ block player LOS

open door
→ allow LOS

wall
→ block LOS

window
→ allow LOS nếu thiết kế cho phép
```

Nhưng door/window không được làm thay đổi world lighting chỉ vì Player Vision kiểm tra chúng.

Nếu indoor lighting system có xử lý sunlight qua window thì đó là system riêng.

---

# 14. Không để Vision Cone tác động material environment

Tìm mọi code kiểu:

```js
material.opacity = isInsideVision ? 1 : 0.2;
```

hoặc:

```js
material.color.setScalar(visionFactor);
```

cho environment.

Nếu object là:

```text
terrain
building
road
tree
wall
```

thì không được áp dụng visibility cone.

Vision cone chỉ áp dụng cho entity perception.

Ví dụ:

```text
Zombie
NPC
Creature
Potentially loot marker
```

---

# 15. Fade entity, không fade world

Fade chỉ dùng cho entity.

Ví dụ:

```js
zombie.visibilityAlpha
```

transition:

```text
0 → 1
1 → 0
```

Không được dùng cùng alpha đó cho:

```text
scene
terrain
world
lighting
```

---

# 16. Near Detection giữ nguyên

Near detection vẫn hoạt động.

Ví dụ:

```text
zombie nằm 2m phía sau player
→ visible
```

Nhưng chỉ zombie visible.

Không được làm sáng một vòng tròn 2m quanh player kiểu flashlight.

NearDetectionRadius không phải nguồn sáng.

---

# 17. Vision Cone không phải spotlight

Đặc biệt:

Không được implement Player Vision bằng:

```js
THREE.SpotLight
```

để tạo vùng sáng phía trước player.

Vision cone là logic perception.

Không phải light source.

Sai:

```text
player POV = spotlight
```

Đúng:

```text
player POV = visibility query
```

---

# 18. Không dùng PointLight cho near radius

Near radius cũng không phải:

```js
THREE.PointLight
```

Không tạo vòng sáng quanh player.

Near radius chỉ là:

```js
distance <= nearRadius
→ entity visible
```

---

# 19. Debug visualization

Debug vision cone có thể vẽ:

```text
cone lines
radius circle
LOS rays
```

Nhưng debug geometry:

```text
không phát sáng
không affect lighting
không cast light
```

Nó chỉ là helper.

---

# 20. Expected architecture sau khi sửa

Mong muốn:

```text
DayNightSystem
    ↓
WorldLightingState
    ↓
Sun / Ambient / Environment


PlayerVisionSystem
    ↓
EntityVisibilityState
    ↓
Zombie/NPC renderer


OptionalVisionOverlay
    ↓
very subtle visual effect only
```

Không có dependency:

```text
PlayerVisionSystem
    ↓
WorldLightingState
```

---

# 21. Ví dụ flow đúng

Ví dụ 1:

```text
12:00
player outside
player facing north
zombie south
```

Result:

```text
world = bright daylight
zombie south = hidden
```

Không phải:

```text
south area = dark
```

---

Ví dụ 2:

```text
12:00
player outside
player turns south
```

Result:

```text
world brightness = unchanged
zombie becomes visible
```

---

Ví dụ 3:

```text
00:00
player outside
```

Result:

```text
world dark because night
```

Player quay hướng nào cũng không làm daylight/night brightness thay đổi.

---

Ví dụ 4:

```text
player inside room
room has no light
```

Result:

```text
room dark
```

vì indoor lighting.

Không phải vì room nằm ngoài player FOV.

---

# 22. Hãy audit code hiện tại

Trước khi sửa, hãy tìm các file liên quan tới:

```text
PlayerVisionSystem
VisionMask
VisionOverlay
Fog
DayNightSystem
LightingSystem
Renderer
ZombieRenderer
PlayerRenderer
postprocessing
shader
```

Tìm các chỗ Player Vision đang thay đổi:

```text
light intensity
material brightness
material opacity environment
renderer exposure
fog
screen darkness
```

Hãy liệt kê rõ những chỗ đó.

Sau đó sửa minimal changes.

---

# 23. Không rewrite DayNightSystem nếu không cần

Day/Night cycle hiện tại đang hoạt động.

Không rewrite toàn bộ system này.

Chỉ cần:

```text
remove Player Vision dependency
```

nếu có.

Nếu DayNightSystem vốn đã đúng thì giữ nguyên.

---

# 24. Không phá các system khác

Phải đảm bảo không regression:

```text
combat
zombie AI
zombie navigation
inventory
loot
audio
day/night cycle
save/load
settings
```

Zombie hidden vẫn phải:

```text
wander
chase
attack
pathfind
respond to sound
```

bình thường.

---

# 25. Acceptance criteria

Implementation được coi là đúng khi:

### Daytime outdoor

Player quay 360 độ:

```text
world lighting không thay đổi
```

### Zombie visibility

Zombie ngoài FOV:

```text
hidden
```

nhưng world phía sau zombie:

```text
vẫn sáng bình thường
```

### LOS

Zombie sau wall:

```text
hidden
```

wall:

```text
vẫn render và vẫn nhận daylight bình thường
```

### Near radius

Zombie sát player:

```text
visible
```

không tạo bất kỳ vùng sáng nào quanh player.

### Night

World tối vì DayNightSystem.

Không tối thêm một cách cực đoan chỉ vì ngoài FOV.

---

# 26. Nếu cần bỏ hoàn toàn visual mask

Nếu implementation hiện tại khó tách VisionOverlay khỏi lighting mà không gây side effect, hãy:

```text
disable/remove VisionOverlay
```

trước.

Ưu tiên hệ thống hoạt động đúng theo:

```text
FOV
+
LOS
+
entity visibility
```

Thà không có vùng tối ngoài FOV còn hơn làm sai world lighting.

---

# 27. Kết quả cần báo cáo

Sau khi sửa xong, hãy báo cáo:

```text
Root cause

Files changed

PlayerVision logic removed from lighting

World lighting ownership

Entity visibility flow

Any VisionOverlay changes

Daytime test result

Nighttime test result

Indoor test result

Known limitations
```

---

# 28. Quy tắc bắt buộc cuối cùng

Hãy tuân thủ các rule sau:

```text
Player Vision is NOT a light source.

Player Vision must NOT control world brightness.

Player Vision must NOT control sunlight.

Player Vision must NOT control ambient light.

Player Vision must NOT control exposure.

Player Vision must NOT darken terrain to simulate blindness.

Player Vision should mainly control entity visibility.

World lighting is controlled only by lighting/time/environment systems.
```

Mục tiêu cuối cùng là cảm giác giống Project Zomboid:

```text
player không nhìn thấy zombie phía sau

NHƯNG

thế giới phía sau player vẫn tồn tại
và vẫn sáng/tối đúng theo thời gian trong ngày.
```
