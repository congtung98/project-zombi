# Building Lighting System – Implementation Spec

## 1. Mục tiêu

Tài liệu này mô tả cách triển khai **hệ thống ánh sáng trong building** cho game zombie survival dùng **React + Three.js**, theo hướng lấy cảm hứng từ Project Zomboid nhưng được đơn giản hóa để phù hợp với hiệu năng của game web.

Mục tiêu chính:

- Ánh sáng ngoài trời vẫn do `DayNightSystem` điều khiển.
- Ánh sáng trong nhà được tính riêng dựa trên:
  - room
  - window
  - door
  - opening
  - artificial light
  - daylight propagation
- Phòng sâu bên trong building phải tối hơn phòng có cửa sổ.
- Door mở/đóng phải ảnh hưởng đến lượng ánh sáng truyền giữa các room.
- Lamp / ceiling light có thể chiếu sáng room độc lập với daylight.
- Player quay mặt sang hướng khác **không được làm thay đổi ánh sáng của room**.
- `PlayerVisionSystem` và `BuildingLightingSystem` phải độc lập.

---

# 2. Nguyên tắc kiến trúc bắt buộc

```text
WORLD LIGHTING != PLAYER VISION
```

Kiến trúc mong muốn:

```text
                         LightingSystem
                               │
               ┌───────────────┴────────────────┐
               │                                │
        DayNightSystem              BuildingLightingSystem
               │                                │
        outdoorLight                 Room Graph
        sunIntensity                 Window Exposure
        ambientLight                 Door Propagation
        skyColor                     Artificial Lights
               │                                │
               └───────────────┬────────────────┘
                               │
                      Final World Lighting


                      PlayerVisionSystem
                               │
                       FOV + LOS + entity
                          visibility only
```

Không được để:

```text
PlayerVisionSystem
      ↓
room brightness
sunlight
ambient light
lamp intensity
```

Player Vision chỉ xử lý:

```text
zombie visible / hidden
NPC visible / hidden
entity perception
```

---

# 3. Phạm vi Phase đầu tiên

Trong phase đầu tiên, KHÔNG cần global illumination thực.

Không cần:

- ray-traced GI
- bounce lighting vật lý
- per-pixel light propagation
- raycast ánh sáng từ mỗi cửa sổ mỗi frame
- volumetric lighting
- shadow simulation phức tạp

Thay vào đó dùng mô hình:

```text
Room-based lighting
+
Graph propagation
+
Simple visual application
```

Đây là cách đủ nhẹ để chạy trong browser và vẫn tạo cảm giác phòng sáng/tối khác nhau rõ rệt.

---

# 4. Core data model

Mỗi building được chia thành các `Room`.

Ví dụ:

```js
const building = {
  id: "house_01",

  rooms: [
    {
      id: "living_room",
      type: "living_room",

      bounds: {
        minX: 0,
        maxX: 6,
        minZ: 0,
        maxZ: 5,
      },

      windows: [],
      doors: [],
      lights: [],

      outdoorExposure: 0,
      artificialLight: 0,
      propagatedLight: 0,
      finalLightLevel: 0,
    },
  ],
};
```

Mỗi room cần tối thiểu:

```js
{
  id,
  bounds,

  windows,
  doors,
  lights,

  outdoorExposure,
  artificialLight,
  propagatedLight,
  finalLightLevel
}
```

---

# 5. Room detection

Mỗi building nên biết player/entity đang nằm trong room nào.

Tạo:

```js
getRoomAtPosition(position)
```

Ví dụ:

```js
function isInsideRoom(position, room) {
  return (
    position.x >= room.bounds.minX &&
    position.x <= room.bounds.maxX &&
    position.z >= room.bounds.minZ &&
    position.z <= room.bounds.maxZ
  );
}
```

Sau này có thể nâng cấp từ AABB sang polygon room.

Phase đầu tiên chỉ cần rectangular room bounds là đủ.

---

# 6. Outdoor light level

`DayNightSystem` phải expose một giá trị chuẩn hóa:

```js
outdoorLightLevel
```

Range:

```text
0.0 = tối hoàn toàn
1.0 = daylight cực sáng
```

Ví dụ:

```text
00:00 → 0.05
05:00 → 0.15
07:00 → 0.55
12:00 → 1.0
17:00 → 0.65
20:00 → 0.20
```

Có thể lấy từ hệ thống day/night hiện tại thay vì tạo logic duplicate.

Interface đề xuất:

```js
const worldLighting = {
  outdoorLightLevel,
  sunIntensity,
  ambientIntensity,
};
```

---

# 7. Window exposure

Window là nguồn daylight chính của room.

Mỗi window cần metadata:

```js
{
  id: "window_01",

  roomId: "living_room",

  width: 1.2,
  height: 1.5,

  blocked: false,
  curtainClosed: false,
  barricadeFactor: 1.0,

  daylightFactor: 1.0,
}
```

Tính window contribution:

```js
windowLight =
  outdoorLightLevel
  * daylightFactor
  * barricadeFactor;
```

Nếu curtain đóng:

```js
curtainFactor = 0.2;
```

Ví dụ:

```js
windowLight =
  outdoorLightLevel
  * daylightFactor
  * curtainFactor;
```

---

# 8. Outdoor exposure của room

Một room có nhiều window.

Không cộng thẳng toàn bộ ánh sáng vì có thể vượt quá 1.

Cách đơn giản:

```js
room.outdoorExposure = clamp(
  sum(windowContributions),
  0,
  1
);
```

Có thể giảm bằng hệ số:

```js
room.outdoorExposure = clamp(
  sum(windowContributions) * 0.6,
  0,
  1
);
```

Ví dụ:

```text
Living room
2 windows
outdoorLightLevel = 1.0

window A = 0.5
window B = 0.4

room exposure:
(0.5 + 0.4) * 0.6
= 0.54
```

---

# 9. Room depth factor

Không nên để toàn bộ room sáng đều nếu room lớn.

Có thể thêm:

```js
roomDepthFactor
```

Ví dụ:

```js
effectiveOutdoorLight =
  outdoorExposure * roomDepthFactor;
```

Phase đầu tiên có thể dùng:

```js
roomDepthFactor = 0.8;
```

Sau này có thể dựa vào:

```text
distance tới window
room size
wall layout
```

---

# 10. Door model

Door kết nối hai room.

Ví dụ:

```js
{
  id: "door_01",

  roomA: "living_room",
  roomB: "kitchen",

  isOpen: true,

  openLightTransmission: 0.65,
  closedLightTransmission: 0.05,
}
```

Transmission:

```js
const transmission =
  door.isOpen
    ? door.openLightTransmission
    : door.closedLightTransmission;
```

---

# 11. Room graph

Building nên trở thành graph:

```text
Living Room
     │
   Door
     │
 Kitchen
     │
   Door
     │
 Bathroom
```

Mỗi room là node.

Door/opening là edge.

Ví dụ:

```js
const roomGraph = {
  living_room: [
    {
      target: "kitchen",
      transmission: 0.65,
    },
  ],

  kitchen: [
    {
      target: "living_room",
      transmission: 0.65,
    },
    {
      target: "bathroom",
      transmission: 0.05,
    },
  ],
};
```

---

# 12. Daylight propagation

Sau khi tính direct outdoor light cho từng room, truyền ánh sáng sang room nối với nó.

Ví dụ:

```text
outsideLight = 1.0

Living Room
window exposure = 0.7

Kitchen
no window

Bathroom
no window
```

Door:

```text
Living → Kitchen = 0.5

Kitchen → Bathroom = 0.3
```

Kết quả:

```text
Living:
0.7

Kitchen:
0.7 * 0.5
= 0.35

Bathroom:
0.35 * 0.3
= 0.105
```

---

# 13. Giới hạn propagation

Không propagate vô hạn.

Config:

```js
maxPropagationDepth = 3;
```

Ví dụ:

```text
Window Room
  ↓ depth 1
Kitchen
  ↓ depth 2
Hallway
  ↓ depth 3
Bathroom
```

Sau depth 3 thì dừng.

Điều này giúp:

- dễ debug
- tránh vòng lặp graph
- giảm CPU
- ánh sáng tự nhiên giảm hợp lý

---

# 14. Attenuation theo mỗi bước

Ngoài door transmission, nên có decay:

```js
propagationDecay = 0.8;
```

Ví dụ:

```js
nextLight =
  currentLight
  * doorTransmission
  * propagationDecay;
```

---

# 15. Threshold

Không propagate light cực nhỏ.

```js
minPropagationLight = 0.03;
```

Nếu:

```js
nextLight < minPropagationLight
```

thì stop.

---

# 16. Tránh vòng lặp graph

Phải có visited state.

Ví dụ:

```js
const visited = new Map();
```

Không để:

```text
Living
→ Kitchen
→ Living
→ Kitchen
→ ...
```

---

# 17. Artificial lighting

Mỗi room có thể chứa nguồn sáng nhân tạo:

```js
{
  id: "ceiling_light_01",

  roomId: "kitchen",

  enabled: true,

  intensity: 0.8,

  color: 0xffddaa,

  requiresElectricity: true,
}
```

Tính:

```js
room.artificialLight = sum(
  enabledLights.map(light => light.intensity)
);
```

Clamp:

```js
room.artificialLight = Math.min(
  room.artificialLight,
  1
);
```

---

# 18. Electricity state

Lighting phải hỗ trợ:

```js
worldElectricityAvailable
```

Nếu mất điện:

```js
if (
  light.requiresElectricity &&
  !worldElectricityAvailable
) {
  light.enabled = false;
}
```

Sau này có thể nối với generator system.

---

# 19. Final room light

Đề xuất:

```js
finalLightLevel =
  directOutdoorLight
  + propagatedLight
  + artificialLight;
```

Sau đó:

```js
finalLightLevel = clamp(
  finalLightLevel,
  minIndoorLight,
  1
);
```

Config:

```js
minIndoorLight = 0.03;
```

---

# 20. Không cộng ánh sáng tuyến tính quá đơn giản

Nếu direct + propagated + artificial thường xuyên vượt 1, có thể dùng:

```js
finalLightLevel =
  1 -
  (1 - outdoor)
  * (1 - propagated)
  * (1 - artificial);
```

Ví dụ:

```js
outdoor = 0.6
propagated = 0.2
artificial = 0.5
```

thì:

```text
1 - (0.4 * 0.8 * 0.5)
= 0.84
```

Cách này mượt hơn clamp(sum).

---

# 21. Tách daylight khỏi artificial light

Nên lưu riêng:

```js
room.directOutdoorLight
room.propagatedOutdoorLight
room.artificialLight
room.finalLightLevel
```

Không chỉ lưu một giá trị cuối.

Điều này quan trọng cho:

- debug
- save/load
- weather
- electricity
- lamp color
- future improvements

---

# 22. Áp dụng ánh sáng vào Three.js

Không nên tạo quá nhiều real-time `PointLight`.

Ví dụ 100 building × 5 room:

```text
500 PointLight
```

sẽ rất nặng.

Phase đầu tiên ưu tiên:

```text
room light factor
+
material/shader response
```

---

# 23. Recommended visual approach

Mỗi object trong building biết:

```js
object.userData.roomId
```

Ví dụ:

```js
wall.userData.roomId = "kitchen";
floor.userData.roomId = "kitchen";
furniture.userData.roomId = "kitchen";
```

Renderer đọc:

```js
roomLightLevel
```

và dùng nó để điều chỉnh indoor shading.

---

# 24. Không mutate base material liên tục

Không làm:

```js
material.color.multiplyScalar(roomLight);
```

mỗi frame.

Điều này sẽ làm color bị nhân lặp.

Sai:

```text
frame 1:
1.0 × 0.5 = 0.5

frame 2:
0.5 × 0.5 = 0.25

frame 3:
0.25 × 0.5 = 0.125
```

Phải lưu base color hoặc dùng shader uniform.

---

# 25. Shader uniform approach

Khuyến nghị:

```js
material.userData.indoorLightLevel = 0.5;
```

hoặc custom shader uniform:

```glsl
uniform float uIndoorLight;
```

Sau đó:

```glsl
finalColor *= uIndoorLight;
```

Nhưng chỉ cho indoor surface.

Không áp dụng lên toàn scene.

---

# 26. Nếu chưa có custom shader

Phase đầu tiên có thể clone material theo room-light bucket.

Ví dụ:

```text
0.0
0.2
0.4
0.6
0.8
1.0
```

Object cùng bucket dùng chung material.

Không clone material cho từng object.

---

# 27. Ceiling light

Nếu muốn bóng đèn nhìn thực hơn:

Chỉ các room gần player mới tạo real Three.js light.

Ví dụ:

```js
MAX_DYNAMIC_LIGHTS = 8;
```

Các room xa:

```text
chỉ dùng baked/simple light factor
```

Room gần player:

```text
PointLight / RectAreaLight optional
```

---

# 28. Hybrid lighting

Architecture hiệu quả:

```text
Room light factor
→ ánh sáng tổng quát

+

Dynamic PointLight
→ hiệu ứng local gần player
```

Ví dụ:

```text
Kitchen light level = 0.7

Ceiling lamp PointLight
→ highlight player + furniture gần lamp
```

---

# 29. Window daylight visual

Không cần tạo light ray từ từng window.

Phase đầu tiên:

```text
window determines room exposure
```

Không:

```text
window creates real-time sunlight ray
```

Sau này mới thêm visual beam nếu muốn.

---

# 30. Closed curtain

Curtain có thể ảnh hưởng:

```text
daylight transmission
player LOS
```

Nhưng đây là hai hệ thống khác nhau.

Ví dụ:

```js
curtain.lightTransmission = 0.15;
curtain.blocksVision = true;
```

Không gộp thành một boolean duy nhất.

---

# 31. Barricade

Tương tự:

```js
barricade.lightTransmission = 0.4;
barricade.blocksMovement = true;
barricade.blocksVision = false;
```

Tách:

```text
movement
vision
lighting
```

---

# 32. Door state

Door nên có:

```js
{
  isOpen,
  blocksMovement,
  blocksVision,
  lightTransmission
}
```

Ví dụ:

```text
open door:
movement = allowed
vision = allowed
light transmission = 0.7

closed door:
movement = blocked
vision = blocked
light transmission = 0.05
```

---

# 33. Building exterior

Outdoor object không dùng BuildingLightingSystem.

Ví dụ:

```text
road
grass
trees
outside walls
cars
```

dùng world light.

Indoor object mới dùng room light.

---

# 34. Inside / outside classification

Mỗi world object nên có:

```js
object.userData.environmentType
```

Ví dụ:

```js
"outdoor"
"indoor"
"semi_indoor"
```

`semi_indoor` dùng cho:

```text
garage
porch
covered area
warehouse entrance
```

---

# 35. Semi indoor

Semi indoor có thể blend:

```js
finalLight =
  outdoorLight * outdoorBlend
  +
  roomLight * indoorBlend;
```

Ví dụ:

```text
garage cửa mở:
outdoorBlend = 0.6
indoorBlend = 0.4
```

---

# 36. Player model lighting

Player đứng trong room:

```text
player lighting
→ lấy room.finalLightLevel
```

Player ngoài trời:

```text
→ outdoorLightLevel
```

Player đứng ở doorway:

Có thể blend:

```js
playerLight =
  lerp(
    indoorLight,
    outdoorLight,
    doorwayBlend
  );
```

---

# 37. Zombie lighting

Zombie cũng nhận lighting như entity bình thường.

Nếu zombie ở room tối:

```text
render darker
```

Nhưng visibility vẫn do `PlayerVisionSystem`.

Hai câu hỏi khác nhau:

```text
Player có nhìn thấy zombie không?
```

và:

```text
Nếu thấy thì zombie sáng/tối bao nhiêu?
```

Flow:

```text
PlayerVisionSystem
      ↓
isVisibleToPlayer
      ↓
LightingSystem
      ↓
visual brightness
```

---

# 38. Không dùng darkness để thay thế visibility

Sai:

```text
zombie ngoài FOV
→ brightness = 0
```

Đúng:

```text
zombie ngoài FOV
→ hidden by PlayerVisionSystem
```

Indoor lighting chỉ xử lý brightness thực tế.

---

# 39. Player flashlight

Sau này flashlight phải là system riêng:

```text
FlashlightSystem
```

Không đặt vào:

```text
PlayerVisionSystem
```

Flashlight có thể:

```text
increase local light
```

nhưng vision cone không phải flashlight.

---

# 40. Light update triggers

Không cần recalculation mỗi frame.

Recalculate khi:

```text
time/daylight changed enough
door opened/closed
window changed
curtain opened/closed
light turned on/off
electricity changed
building loaded
```

---

# 41. Event driven update

Ví dụ:

```js
eventBus.emit("DOOR_STATE_CHANGED", doorId);
eventBus.emit("LIGHT_STATE_CHANGED", lightId);
eventBus.emit("DAYLIGHT_CHANGED", outdoorLightLevel);
```

BuildingLightingSystem subscribe và mark building dirty.

---

# 42. Dirty building system

Mỗi building:

```js
building.lightingDirty = true;
```

Chỉ recompute khi dirty.

Ví dụ:

```js
if (building.lightingDirty) {
  recalculateBuildingLighting(building);
  building.lightingDirty = false;
}
```

---

# 43. Day/night throttling

Không recompute tất cả building mỗi frame.

Ví dụ:

```js
DAYLIGHT_RECALC_THRESHOLD = 0.03;
```

Chỉ khi:

```js
Math.abs(
  newOutdoorLight -
  previousOutdoorLight
) >= threshold
```

mới update.

---

# 44. Building streaming

Chỉ update building:

```text
near player
loaded chunk
active simulation area
```

Building rất xa:

```text
không cần lighting simulation realtime
```

---

# 45. Suggested config

```js
export const BUILDING_LIGHTING_CONFIG = {
  minIndoorLight: 0.03,

  maxPropagationDepth: 3,

  propagationDecay: 0.8,

  minPropagationLight: 0.03,

  defaultOpenDoorTransmission: 0.65,

  defaultClosedDoorTransmission: 0.05,

  defaultWindowTransmission: 0.75,

  closedCurtainTransmission: 0.15,

  daylightRecalcThreshold: 0.03,

  maxDynamicLights: 8,
};
```

---

# 46. Suggested classes/modules

```text
lighting/
├── LightingSystem.js
├── DayNightLightingAdapter.js
├── BuildingLightingSystem.js
├── RoomLightingSolver.js
├── LightPropagation.js
├── LightingConfig.js
└── LightingDebug.js
```

Nếu project nhỏ hơn:

```text
lighting/
├── buildingLighting.js
├── lightingConfig.js
└── lightingDebug.js
```

Không over-engineer nếu chưa cần.

---

# 47. BuildingLightingSystem API

Ví dụ:

```js
class BuildingLightingSystem {
  registerBuilding(building) {}

  unregisterBuilding(buildingId) {}

  markDirty(buildingId) {}

  updateOutdoorLight(level) {}

  recalculateBuilding(buildingId) {}

  getRoomLight(roomId) {}

  getLightAtPosition(position) {}
}
```

---

# 48. getLightAtPosition

Đây nên là API quan trọng.

```js
const lightLevel =
  buildingLightingSystem.getLightAtPosition(
    player.position
  );
```

Pseudo:

```js
function getLightAtPosition(position) {
  const room = getRoomAtPosition(position);

  if (!room) {
    return outdoorLightLevel;
  }

  return room.finalLightLevel;
}
```

---

# 49. Light color

Phase đầu tiên có thể chỉ dùng brightness.

Phase sau có thể thêm:

```js
room.lightColor
```

Ví dụ:

```text
sunlight:
slightly cool/neutral

incandescent:
warm

fluorescent:
cool white
```

---

# 50. Artificial color blending

Ví dụ:

```js
room.finalColor =
  blendLightColors(
    daylightColor,
    artificialColors
  );
```

Không bắt buộc trong phase đầu.

---

# 51. Debug visualization

Thêm:

```js
DEBUG_BUILDING_LIGHTING = true;
```

Hiển thị:

```text
room bounds
room id
direct outdoor light
propagated light
artificial light
final light
door transmission
window exposure
```

Ví dụ floating text:

```text
Living Room

Direct: 0.65
Propagated: 0.00
Artificial: 0.20
Final: 0.72
```

---

# 52. Debug room color

Optional:

```text
bright room → debug green
medium → yellow
dark → red
```

Chỉ debug.

Không dùng màu debug trong production.

---

# 53. Debug room graph

Có thể vẽ line:

```text
Living ───── Kitchen
    transmission 0.65
```

Giúp kiểm tra propagation.

---

# 54. Acceptance Test 1 – outdoor daylight

Setup:

```text
12:00
clear weather
player outside
```

Expected:

```text
outdoorLightLevel ≈ 1
```

Không phụ thuộc player facing.

---

# 55. Acceptance Test 2 – room có window

```text
outside = 1.0

living room:
window present
```

Expected:

```text
room light > 0.5
```

---

# 56. Acceptance Test 3 – back room

```text
Living Room
window = yes

Kitchen
window = no

door open
```

Expected:

```text
living > kitchen
```

---

# 57. Acceptance Test 4 – close door

Trước:

```text
Living = 0.7
Kitchen = 0.35
```

Close door.

Expected:

```text
Kitchen drops significantly
```

Ví dụ:

```text
0.35 → 0.05
```

---

# 58. Acceptance Test 5 – lamp

Room không window.

Night:

```text
outdoorLight = 0.05
```

Lamp OFF:

```text
room ≈ dark
```

Lamp ON:

```text
room becomes clearly illuminated
```

---

# 59. Acceptance Test 6 – electricity off

```text
lamp enabled
requiresElectricity = true
electricity = false
```

Expected:

```text
artificialLight = 0
```

---

# 60. Acceptance Test 7 – player rotation

Player đứng trong bright room.

Quay 360°.

Expected:

```text
room light unchanged
```

Đây là test bắt buộc.

---

# 61. Acceptance Test 8 – Player Vision independence

Zombie đứng ngoài player FOV trong bright room.

Expected:

```text
room = bright

zombie = hidden
```

Player quay sang zombie:

```text
room brightness unchanged

zombie becomes visible
```

---

# 62. Acceptance Test 9 – daylight transition

Chạy:

```text
12:00 → 20:00
```

Expected:

```text
window rooms gradually darken
back rooms darken faster
artificial lamps remain stable
```

---

# 63. Acceptance Test 10 – curtain

```text
window room = bright
```

Close curtain.

Expected:

```text
direct daylight decreases
```

Không cần về 0 hoàn toàn nếu curtain vẫn truyền một phần ánh sáng.

---

# 64. Performance requirements

Không:

```text
raycast every window every frame
```

Không:

```text
hundreds of dynamic lights
```

Không:

```text
recalculate every building every frame
```

Không:

```text
clone material per object
```

---

# 65. Performance target

Lighting simulation nên chủ yếu là:

```text
number operations
graph traversal
event-driven updates
```

Không phải GPU-heavy lighting simulation.

---

# 66. Recommended update strategy

```text
Every frame:
render existing values

Occasionally:
update daylight level

On event:
recalculate dirty building
```

---

# 67. Save / Load

Không nhất thiết save calculated values.

Save:

```text
door state
curtain state
lamp state
electricity state
```

Sau load:

```text
recalculate building lighting
```

Không cần save:

```text
propagatedLight
finalLightLevel
```

vì đây là derived state.

---

# 68. Integration với IndexedDB save hiện tại

Save schema có thể thêm:

```js
{
  buildings: {
    house_01: {
      doors: {
        door_01: {
          isOpen: false
        }
      },

      windows: {
        window_01: {
          curtainClosed: true
        }
      },

      lights: {
        ceiling_light_01: {
          enabled: false
        }
      }
    }
  }
}
```

---

# 69. Không phá DayNightSystem

DayNightSystem hiện tại chỉ cần expose:

```js
outdoorLightLevel
```

Không rewrite nếu đang hoạt động.

BuildingLightingSystem là consumer.

```text
DayNightSystem
      ↓
outdoorLightLevel
      ↓
BuildingLightingSystem
```

---

# 70. Không phá PlayerVisionSystem

Không sửa:

```text
FOV
LOS
near detection
zombie visibility
```

trừ khi cần interface.

BuildingLighting không được quyết định:

```text
entity visible / hidden
```

---

# 71. Implementation order

Nên làm đúng thứ tự:

## Step 1

Tạo room data model.

## Step 2

Tạo:

```js
getRoomAtPosition()
```

## Step 3

Expose:

```js
outdoorLightLevel
```

từ DayNightSystem.

## Step 4

Implement window direct light.

## Step 5

Implement door graph.

## Step 6

Implement propagation.

## Step 7

Implement artificial lights.

## Step 8

Implement `getLightAtPosition()`.

## Step 9

Apply room lighting vào indoor renderer.

## Step 10

Add dirty/event-driven update.

## Step 11

Add debug visualization.

## Step 12

Test Player Vision independence.

---

# 72. Phase 1 minimum viable implementation

Nếu muốn làm nhanh:

Chỉ cần:

```text
Room
Window
Door
Light
Graph propagation
FinalLightLevel
```

Không cần:

```text
light color
real dynamic PointLight
smooth doorway blending
semi-indoor
room-depth shader
```

---

# 73. Phase 2 improvements

Sau khi Phase 1 ổn định:

```text
light color
window direction
room depth
doorway blending
generator electricity
flashlight
streetlight
shadow refinement
dynamic local lights
```

---

# 74. Phase 3 advanced

Nếu game đủ lớn:

```text
light probes
low-resolution light grid
GPU light texture
baked room lightmap
chunk lighting cache
weather attenuation
colored propagation
```

---

# 75. Agent instructions

Trước khi code:

1. Đọc architecture hiện tại.
2. Tìm `DayNightSystem`.
3. Tìm Building/Room structure.
4. Tìm door/window system.
5. Tìm renderer/material setup.
6. Tìm PlayerVisionSystem.
7. Tìm save/load schema.
8. Không rewrite system hoạt động tốt nếu không cần.

---

# 76. Agent không được làm

Không:

```text
replace DayNightSystem
```

Không:

```text
merge lighting với PlayerVision
```

Không:

```text
use player facing để tính room brightness
```

Không:

```text
create PointLight cho mọi room
```

Không:

```text
raycast every frame từ mọi window
```

Không:

```text
darken toàn scene nếu player trong nhà
```

---

# 77. Agent phải báo cáo sau khi hoàn thành

```text
Files changed

Architecture added

Room data model

Window daylight formula

Door transmission formula

Propagation algorithm

Artificial light implementation

Performance optimization

Save/load changes

Debug features

Acceptance test results

Known limitations
```

---

# 78. Final architecture target

```text
                 ┌──────────────────┐
                 │  DayNightSystem  │
                 └────────┬─────────┘
                          │
                  outdoorLightLevel
                          │
                          ▼
              ┌────────────────────────┐
              │ BuildingLightingSystem │
              └──────────┬─────────────┘
                         │
                ┌────────┴────────┐
                │                 │
             Windows          Artificial
                │               Lights
                ▼                 │
          Direct Light            │
                │                 │
                └───────┬─────────┘
                        ▼
                 Room Light Graph
                        │
                        ▼
                  Light Propagation
                        │
                        ▼
                 finalLightLevel
                        │
               ┌────────┴─────────┐
               │                  │
             World             Entities
            Renderer             Render


PlayerVisionSystem
       │
       └── visible / hidden only
```

---

# 79. Definition of Done

Hệ thống được coi là hoàn thành khi:

- Room có window sáng hơn room không window.
- Back room nhận ánh sáng yếu hơn front room.
- Door mở làm tăng light propagation.
- Door đóng làm giảm light propagation.
- Lamp bật làm sáng room.
- Mất điện làm lamp điện không hoạt động.
- Day/night làm indoor daylight thay đổi.
- Player quay người không làm room đổi brightness.
- Player Vision không ảnh hưởng room lighting.
- Zombie hidden không đồng nghĩa với room tối.
- Không có số lượng lớn dynamic light.
- Không có recalculation toàn world mỗi frame.
- Có debug mode để kiểm tra room light.
- Build chạy không regression các system hiện tại.

---

# 80. Nguyên tắc cuối cùng

Luôn giữ:

```text
LIGHTING = thế giới thực sự sáng/tối thế nào.

VISION = player có thể nhận biết thứ gì.
```

Hai hệ thống này có thể cùng ảnh hưởng tới hình ảnh cuối cùng nhưng không được thay thế lẫn nhau.

Ví dụ:

```text
Room tối + zombie trong FOV
→ zombie visible nhưng tối.

Room sáng + zombie ngoài FOV
→ room vẫn sáng nhưng zombie hidden.

Room sáng + zombie trong FOV
→ zombie visible và sáng.

Room tối + zombie ngoài FOV
→ room tối và zombie hidden.
```

Đây là behavior mong muốn.
