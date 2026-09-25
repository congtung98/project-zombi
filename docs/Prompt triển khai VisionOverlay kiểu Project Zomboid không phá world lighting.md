Tôi đang phát triển game zombie survival bằng React + Three.js.

Hiện tại PlayerVisionSystem đã hoặc sẽ xử lý:

- FOV / vision cone
- Near Detection Radius
- Line of Sight
- Zombie/NPC visibility

Tôi muốn bổ sung một `VisionOverlaySystem` để tạo cảm giác giống Project Zomboid hơn: vùng player đang nhìn rõ hơn một chút, vùng ngoài hướng nhìn bị giảm nhận thức nhẹ.

QUAN TRỌNG:

VisionOverlay chỉ là một lớp visual/perception effect.

Nó KHÔNG PHẢI lighting system.

Nó KHÔNG được thay đổi world lighting.

---

# 1. Mục tiêu

Tạo hiệu ứng:

```text
inside player vision
→ world hiển thị bình thường

outside player vision
→ world vẫn hiển thị
→ nhưng có một lớp shading rất nhẹ

blocked area / blind spot
→ có thể tối hơn một chút

NOT:
outside FOV = night
```

Mục tiêu là tạo cảm giác:

```text
player không tập trung nhìn phía sau

≠

thế giới phía sau không có ánh sáng
```

---

# 2. Quy tắc quan trọng nhất

Phải giữ:

```text
WORLD LIGHTING != VISION OVERLAY
```

VisionOverlay không được sửa:

```js
ambientLight.intensity
directionalLight.intensity
hemisphereLight.intensity
sunLight.intensity
renderer.toneMappingExposure
scene.environmentIntensity
scene.background
```

Không được thay đổi:

```text
DayNightSystem
WeatherLighting
IndoorLighting
LampSystem
Sunlight
Moonlight
```

VisionOverlay chỉ được render như một lớp overlay độc lập.

---

# 3. Không implement bằng Light

KHÔNG dùng:

```js
THREE.SpotLight
THREE.PointLight
THREE.DirectionalLight
```

để mô phỏng vision cone.

Sai:

```text
player nhìn đâu
→ spotlight chiếu tới đó
```

Đúng:

```text
world lighting vẫn như cũ

vision cone chỉ quyết định
overlay ở đâu mạnh/yếu
```

---

# 4. Không chỉnh brightness của material world

Không được loop terrain/building rồi làm:

```js
material.color.multiplyScalar(...)
```

hoặc:

```js
material.emissiveIntensity = ...
```

hoặc:

```js
material.opacity = ...
```

theo FOV.

Các object như:

```text
terrain
road
wall
building
tree
grass
car
environment
```

phải giữ nguyên material.

---

# 5. Kiến trúc mong muốn

Tách riêng:

```text
DayNightSystem
      ↓
WorldLighting
      ↓
Scene


PlayerVisionSystem
      ↓
Visibility Data


VisionOverlaySystem
      ↓
Visual Mask Only
```

Không có dependency:

```text
VisionOverlaySystem
      ↓
WorldLighting
```

VisionOverlay chỉ đọc:

```text
player position
player facing direction
FOV
near radius
optional LOS data
```

để render mask.

---

# 6. Cường độ overlay

Overlay phải rất nhẹ.

Config đề xuất:

```js
export const VISION_OVERLAY_CONFIG = {
  enabled: true,

  outsideFovOpacity: 0.08,

  blockedAreaOpacity: 0.12,

  maxOpacity: 0.15,

  fadeSpeed: 6,

  edgeSoftness: 0.25,
};
```

Có thể điều chỉnh nhưng phải giữ nguyên nguyên tắc:

```text
overlay nhẹ
```

Không được:

```js
outsideFovOpacity = 0.5;
```

hoặc:

```js
outsideFovOpacity = 0.8;
```

vì sẽ khiến ban ngày trông như ban đêm.

---

# 7. Inside FOV

Trong vùng player nhìn:

```text
overlay alpha ≈ 0
```

hoặc rất nhỏ.

Ví dụ:

```js
insideFovOpacity = 0.0;
```

hoặc:

```js
insideFovOpacity = 0.02;
```

World phải hiển thị hoàn toàn theo lighting thật.

---

# 8. Outside FOV

Ngoài FOV:

```text
overlay alpha ≈ 0.05 – 0.12
```

Mục tiêu chỉ là làm vùng đó kém nổi bật một chút.

Không được khiến:

```text
road biến thành đen
building biến thành silhouette
grass gần như biến mất
```

Nếu daylight đang mạnh thì outside FOV vẫn phải nhìn rõ là daylight.

---

# 9. Near Detection Radius

Vùng gần player nên không bị overlay hoặc chỉ bị rất nhẹ.

Ví dụ:

```text
distance <= nearDetectionRadius
→ overlay alpha = 0
```

Điều này giúp player vẫn cảm nhận được không gian sát xung quanh.

Near radius không được phát sáng.

Nó chỉ làm giảm overlay.

---

# 10. Soft edge

Không để vision cone có cạnh cứng như:

```text
sáng | tối
```

Phải có soft transition.

Ví dụ:

```text
inside cone
      ↓
edge fade
      ↓
outside cone
```

Có thể dùng:

```js
smoothstep()
```

trong shader.

Ví dụ:

```glsl
float edge = smoothstep(
  threshold - softness,
  threshold + softness,
  dotValue
);
```

Sau đó dùng:

```glsl
overlayAlpha = mix(
  outsideOpacity,
  insideOpacity,
  edge
);
```

---

# 11. Không dùng hard cone shape nếu không cần

Không nên để overlay tạo ra một tam giác / hình quạt rõ ràng quá mức.

Project Zomboid-style perception nên cảm giác tự nhiên.

Có thể kết hợp:

```text
vision angle
+
distance
+
soft falloff
```

để vùng chuyển tiếp mượt.

---

# 12. Distance falloff

Có thể cho overlay tăng nhẹ theo khoảng cách.

Ví dụ:

```text
near player
→ gần như không overlay

far from player
→ overlay mạnh hơn một chút
```

Nhưng giới hạn:

```text
max opacity <= 0.15
```

Ví dụ:

```glsl
float distanceFactor = smoothstep(
  nearRadius,
  visionDistance,
  distanceToPlayer
);
```

Sau đó:

```glsl
overlayAlpha *= distanceFactor;
```

---

# 13. Không biến distance thành fog

Không được làm:

```text
xa player
→ tối dần thành đen
```

Đây không phải fog distance.

Distance chỉ dùng để tăng overlay nhẹ.

Ví dụ:

```text
5m
→ 0.03

15m
→ 0.07

25m
→ 0.10
```

Không phải:

```text
25m
→ 0.8
```

---

# 14. LOS-aware overlay là optional

Nếu PlayerVisionSystem đã có LOS data, có thể dùng nó để làm khu vực bị wall che tối hơn một chút.

Ví dụ:

```text
inside FOV + clear LOS
→ alpha 0

inside FOV + blocked
→ alpha 0.08

outside FOV
→ alpha 0.10
```

Nhưng KHÔNG bắt buộc.

Nếu implementation LOS-mask quá phức tạp hoặc đắt performance, ưu tiên:

```text
FOV-only overlay
```

trước.

---

# 15. Không raycast từng pixel

Không được raycast từ player tới từng pixel hoặc từng fragment.

Nếu cần LOS shading:

- tận dụng visibility mask
- grid
- low resolution texture
- stencil
- simplified sector mask

Không làm:

```text
per-pixel raycast
```

---

# 16. Screen-space overlay

Ưu tiên một trong các cách:

### Option A

Full-screen post-processing shader.

Shader biết:

```text
player screen position
player facing
camera transform
```

rồi tạo soft mask.

### Option B

World-space projected mask.

### Option C

Low-resolution vision texture.

Chọn cách phù hợp với architecture hiện tại.

Không over-engineer.

---

# 17. Nếu dùng full-screen shader

Shader chỉ blend màu tối nhẹ lên screen.

Ví dụ logic:

```glsl
finalColor = mix(
  sceneColor,
  sceneColor * darkFactor,
  overlayAlpha
);
```

Trong đó:

```text
overlayAlpha <= 0.15
```

Không thay đổi ánh sáng scene.

Không thay `sceneColor` trước render.

Chỉ hậu xử lý output.

---

# 18. Dark factor

DarkFactor cũng không nên quá mạnh.

Ví dụ:

```js
darkFactor = 0.75 - 0.9;
```

Và vì opacity overlay rất thấp nên hiệu ứng cuối phải nhẹ.

Không dùng:

```js
darkFactor = 0.1;
```

---

# 19. Preserve daylight

Case:

```text
12:00
sunny
outdoor
```

Nếu terrain ngoài FOV đang nhận daylight mạnh thì sau overlay nó vẫn phải trông là ban ngày.

Ví dụ:

```text
inside FOV:
brightness perceived = 100%

outside FOV:
brightness perceived ≈ 85–95%
```

Không phải:

```text
outside FOV:
brightness perceived = 20%
```

---

# 20. Preserve night lighting

Ban đêm:

```text
world vốn đã tối
```

VisionOverlay không được nhân thêm darkness quá mạnh.

Ví dụ:

```text
night scene brightness
= 30%

outside FOV overlay
→ perceived khoảng 27%
```

Không phải:

```text
30% → 5%
```

---

# 21. Adaptive overlay theo world brightness

Có thể implement optional adaptive strength.

Ví dụ:

```text
daylight
→ overlay 0.10

night
→ overlay 0.04
```

Lý do:

Ban đêm đã tối sẵn, không cần làm mù thêm.

Có thể sử dụng:

```js
worldLightLevel
```

CHỈ để scale overlay strength.

Ví dụ:

```js
overlayStrength =
  THREE.MathUtils.lerp(
    nightOverlayStrength,
    dayOverlayStrength,
    worldLightLevel
  );
```

Nhưng VisionOverlay không được ghi ngược lại vào `worldLightLevel`.

---

# 22. World lighting chỉ read-only đối với overlay

VisionOverlay có thể READ:

```text
currentDaylightFactor
```

để biết nên dùng overlay mạnh bao nhiêu.

Nhưng không được WRITE:

```text
sun intensity
ambient
exposure
```

---

# 23. Entity visibility vẫn do PlayerVisionSystem quyết định

VisionOverlay không thay thế visibility logic.

Ví dụ zombie ngoài FOV:

```text
PlayerVisionSystem
→ hidden
```

Không phải:

```text
VisionOverlay làm tối zombie nên coi như hidden
```

Phải tách:

```text
VisionOverlay
→ visual atmosphere

PlayerVisionSystem
→ gameplay perception
```

---

# 24. Không để zombie “lộ silhouette” ngoài FOV

Nếu zombie đã:

```js
isVisibleToPlayer = false
```

thì VisionOverlay không được khiến silhouette của zombie vẫn hiện ra.

Zombie visibility vẫn cần:

```text
hidden/faded independently
```

Overlay không phải cơ chế conceal entity.

---

# 25. Smooth rotation

Khi player quay:

Không được để cone overlay nhảy cứng.

Có thể lerp hướng:

```js
currentVisionDirection.lerp(
  targetVisionDirection,
  smoothingFactor
);
```

Hoặc shader dùng orientation hiện tại với temporal smoothing.

Mục tiêu:

```text
player rotate
→ overlay rotate mượt
```

---

# 26. Responsive nhưng không lag

Overlay không được trễ quá nhiều.

Target:

```text
50–100ms visual response
```

Nếu smoothing quá lớn sẽ khiến player quay xong nhưng vision cone còn nằm hướng cũ.

---

# 27. Camera independence

VisionOverlay phải dựa vào:

```text
player facing direction
```

KHÔNG phải:

```text
camera facing direction
```

Camera isometric chỉ là góc nhìn của người chơi ngoài đời.

Character perception phải theo orientation của character.

---

# 28. Camera zoom

Overlay cần hoạt động đúng khi camera zoom in/out.

Không hardcode pixel radius cố định nếu nó làm thay đổi vision distance theo zoom.

Vision distance nên là world-space.

Nếu dùng screen-space shader thì phải convert world-space vision radius đúng theo camera projection.

---

# 29. Occlusion bởi wall

Nếu implementation hỗ trợ:

Wall không nhất thiết phải làm toàn bộ vùng phía sau đen.

Chỉ tăng perception overlay nhẹ hoặc dùng entity visibility.

Ví dụ:

```text
wall blocks zombie visibility

world phía sau wall
→ vẫn render
→ có thể subtle darkening
```

Không cần black fog.

---

# 30. Building interior

Không dùng VisionOverlay để mô phỏng interior darkness.

Interior darkness phải do:

```text
IndoorLightingSystem
```

VisionOverlay chỉ thêm perception effect.

Ví dụ:

```text
dark room
+
outside FOV overlay
```

overlay vẫn nhẹ.

Không stack darkness tới mức room thành black screen.

---

# 31. Clamp final opacity

Luôn clamp:

```js
finalOverlayOpacity = Math.min(
  calculatedOpacity,
  maxOpacity
);
```

Đề xuất:

```js
maxOpacity = 0.15;
```

Nếu muốn cinematic hơn có thể đến:

```js
0.18;
```

nhưng không vượt cao nếu không có lý do rõ ràng.

---

# 32. Config riêng

Tạo file config riêng:

```js
export const VISION_OVERLAY_CONFIG = {
  enabled: true,

  insideOpacity: 0.0,

  outsideOpacity: 0.08,

  blockedOpacity: 0.12,

  maxOpacity: 0.15,

  edgeSoftness: 0.2,

  nearRadius: 2.5,

  visionDistance: 20,

  directionSmoothing: 0.15,

  daytimeStrength: 1.0,

  nighttimeStrength: 0.5,
};
```

Không hardcode ở nhiều file.

---

# 33. Debug mode

Thêm:

```js
DEBUG_VISION_OVERLAY = true;
```

Khi bật, hiển thị:

```text
vision cone boundary
near radius
overlay alpha
player forward
screen/world mask
```

Có thể display:

```text
currentOverlayOpacity
worldLightFactor
visionDirection
```

Debug phải không ảnh hưởng lighting.

---

# 34. Performance

VisionOverlay phải rẻ hơn hoặc ít nhất không đắt hơn PlayerVisionSystem.

Không làm:

```text
raycast every pixel
```

Không loop toàn scene mỗi frame.

Ưu tiên:

```text
single fullscreen shader
```

hoặc:

```text
single low-resolution mask texture
```

---

# 35. Không tạo material clone hàng loạt

Không clone material cho toàn bộ world chỉ để overlay.

Sai:

```text
clone terrain material
clone wall material
clone tree material
```

Đúng:

```text
one overlay pass
```

---

# 36. Update frequency

Nếu shader phụ thuộc orientation thì update mỗi frame là được vì chỉ update uniform.

Ví dụ:

```js
shader.uniforms.playerDirection.value.copy(...)
```

Đây rẻ hơn nhiều so với sửa hàng trăm material.

---

# 37. Những lỗi cần tránh

Không được:

```text
outside FOV = black
```

Không được:

```text
player cone = spotlight
```

Không được:

```text
near radius = point light
```

Không được:

```text
VisionOverlay modifies sun
```

Không được:

```text
VisionOverlay modifies ambient
```

Không được:

```text
VisionOverlay changes exposure
```

Không được:

```text
VisionOverlay changes environment materials
```

---

# 38. Acceptance test – daylight

Test:

```text
time = noon
weather = clear
player outside
```

Player đứng yên và quay 360 độ.

Expected:

```text
sunlight remains unchanged
road remains clearly daylight
buildings remain daylight
grass remains daylight
```

Chỉ có subtle perception shading rotate theo player.

---

# 39. Acceptance test – rear area

Đặt camera để nhìn thấy cả trước và sau player.

Expected:

```text
front:
normal brightness

rear:
slightly subdued
but clearly visible
```

Không được:

```text
rear:
night-like darkness
```

---

# 40. Acceptance test – zombie

Zombie phía sau:

```text
world behind player
→ visible

zombie
→ hidden by PlayerVisionSystem
```

Đây là case quan trọng nhất.

---

# 41. Acceptance test – night

Test:

```text
00:00
outside
```

Expected:

```text
night lighting controls darkness
```

VisionOverlay chỉ thêm một lượng rất nhỏ.

Không được khiến outside FOV gần như black.

---

# 42. Acceptance test – indoor

Player đứng trong nhà.

Lighting của căn phòng phải giữ nguyên khi player quay.

VisionOverlay chỉ thay đổi perception shading.

Nếu room đang sáng bởi lamp:

```text
lamp brightness không thay đổi
```

---

# 43. Acceptance test – rotate fast

Player quay nhanh 180°.

Expected:

```text
overlay chuyển hướng mượt
```

Không:

```text
flicker
hard cut
black frame
```

---

# 44. Fallback

Nếu shader hiện tại quá khó sửa:

Hãy disable toàn bộ VisionOverlay và giữ:

```text
PlayerVisionSystem
+
entity visibility
```

trước.

Sau đó implement lại VisionOverlay độc lập.

Không cố vá hệ thống lighting sai.

---

# 45. Yêu cầu audit trước khi code

Trước khi sửa, hãy tìm:

```text
VisionOverlay
VisionMask
FogOfWar
PlayerVision
PostProcessing
Shader
Lighting
DayNight
```

Kiểm tra VisionOverlay hiện tại có:

```text
modify light?
modify exposure?
modify material?
modify scene fog?
```

Nếu có, refactor.

---

# 46. Báo cáo sau khi hoàn thành

Hãy báo cáo:

```text
Root cause

Files changed

Overlay architecture

Shader or rendering approach

Max opacity

FOV edge smoothing

Day/night adaptation

Performance impact

Acceptance tests

Known limitations
```

---

# 47. Quy tắc cuối cùng

Phải tuân thủ:

```text
VisionOverlay is perception.

VisionOverlay is NOT lighting.

VisionOverlay must NOT make daytime look like nighttime.

VisionOverlay must NOT control sun or ambient light.

VisionOverlay should be subtle.

Entity visibility remains separate.

World lighting remains authoritative.
```

Mục tiêu cuối cùng:

```text
Player quay lưng

→ thế giới phía sau vẫn sáng đúng theo thời gian trong ngày
→ nhưng cảm giác thị giác hơi giảm tập trung
→ zombie phía sau vẫn có thể bị ẩn hoàn toàn bởi PlayerVisionSystem
```

Đó là behavior mong muốn.