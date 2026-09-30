import { DOOR_MAX_HP } from '../world/doors'
import { SWITCH_HEIGHT } from '../world/buildings'
import { mapRooms, mapWindows } from '../world/mapData'
import { ACTION } from '../actions/types'
import { boxAround } from './picker'
import { registerInteractable } from './registry'
import type { InteractionOption } from './types'

/**
 * AX4: the four interactive object types of the game (door, container, lamp switch, curtain). Their
 * reach radii and prompts are the ones the runtime used before (`buildInteractables`,
 * `describeInteraction`), now data of their provider.
 */

/** Stand right at a window to draw its curtain (a wide reach stole prompts from nearby furniture). */
const CURTAIN_REACH = 0.3

const option = (o: Omit<InteractionOption, 'blocked'> & Partial<Pick<InteractionOption, 'blocked'>>): InteractionOption => ({ blocked: null, ...o })

registerInteractable({
  type: 'door',
  build: (map) => map.doors.map((door) => {
    // The pick volume covers the opening: along the wall (hinge → centre), a little deep, door high.
    const dx = door.center.x - door.hinge.x
    const dz = door.center.z - door.hinge.z
    const len = Math.hypot(dx, dz) || 1
    const half = door.width / 2
    const hx = Math.abs(dx / len) * half + Math.abs(dz / len) * 0.2
    const hz = Math.abs(dz / len) * half + Math.abs(dx / len) * 0.2
    return {
      id: door.id,
      kind: 'door',
      name: door.name,
      position: { x: door.center.x, y: door.center.y + 1, z: door.center.z },
      radius: door.width / 2 + 0.4,
      pick: boxAround({ x: door.center.x, y: door.center.y + door.height / 2, z: door.center.z }, hx, door.height / 2, hz),
    }
  }),
  getActions(obj, ictx) {
    const door = ictx.world.doors.get(obj.id)
    if (!door || door.state === 'destroyed') return []
    return door.state === 'open'
      ? [option({ id: 'door.close', actionType: ACTION.CLOSE_DOOR, label: `Đóng ${obj.name}`, isDefault: true, data: { to: 'closed' } })]
      : [option({ id: 'door.open', actionType: ACTION.OPEN_DOOR, label: `Mở ${obj.name}`, isDefault: true, data: { to: 'open' } })]
  },
  getInteractionContext(obj, ictx) {
    const door = ictx.world.doors.get(obj.id)
    if (door?.state === 'destroyed') return { note: null, status: `${obj.name} đã vỡ` }
    return { note: door && door.hp < DOOR_MAX_HP ? `độ bền ${door.hp}/${DOOR_MAX_HP}` : null, status: null }
  },
})

registerInteractable({
  type: 'container',
  build: (map) => map.containers.map((c) => ({
    id: c.id,
    kind: 'container',
    name: c.name,
    position: { ...c.position },
    radius: Math.max(c.size[0], c.size[2]) / 2 + 0.3,
    pick: boxAround(c.position, c.size[0] / 2 + 0.05, c.size[1] / 2 + 0.05, c.size[2] / 2 + 0.05),
  })),
  getActions(obj, ictx) {
    if (ictx.lootOpen && ictx.openContainerId === obj.id) {
      return [option({ id: 'container.close', actionType: ACTION.CLOSE_CONTAINER, label: `Đóng ${obj.name}`, isDefault: true, data: {} })]
    }
    const opened = ictx.world.containers.get(obj.id)?.opened
    return [option({ id: 'container.open', actionType: ACTION.OPEN_CONTAINER, label: `${opened ? 'Xem' : 'Mở'} ${obj.name}`, isDefault: true, data: {} })]
  },
  getInteractionContext: () => ({ note: null, status: null }),
})

registerInteractable({
  type: 'light',
  // Lamp switches on the inner wall of their room (blocked from outside by the wall itself).
  build: (map) => mapRooms(map).flatMap((room) => room.lamp ? [{
    id: room.lamp.id,
    kind: 'light',
    name: room.lamp.name,
    position: { x: room.lamp.switchAt.x, y: (room.floorY ?? 0) + SWITCH_HEIGHT, z: room.lamp.switchAt.z },
    radius: 0.25,
    pick: boxAround({ x: room.lamp.switchAt.x, y: (room.floorY ?? 0) + SWITCH_HEIGHT, z: room.lamp.switchAt.z }, 0.18, 0.18, 0.18),
  }] : []),
  getActions(obj, ictx) {
    const on = ictx.world.lamps.get(obj.id) === true
    // The switch still clicks without power; the lamp just stays dark.
    return [option({ id: on ? 'light.off' : 'light.on', actionType: ACTION.TOGGLE_LIGHT, label: `${on ? 'Tắt' : 'Bật'} ${obj.name}`, isDefault: true, data: { on: !on } })]
  },
  getInteractionContext(obj, ictx) {
    const lamp = mapRooms(ictx.map).find((r) => r.lamp?.id === obj.id)?.lamp
    return { note: lamp?.requiresElectricity && !ictx.world.electricity ? 'mất điện' : null, status: null }
  },
})

registerInteractable({
  type: 'window',
  // The curtain just inside each window (blocked from outside by the pane).
  build: (map) => mapWindows(map).map((w) => {
    const floor = w.center.y - (w.sill + w.head) / 2
    const at = { x: w.center.x + w.inward.x * 0.35, y: floor + 1.3, z: w.center.z + w.inward.z * 0.35 }
    const half = w.width / 2
    return {
      id: w.id,
      kind: 'window',
      name: w.name,
      position: at,
      radius: CURTAIN_REACH,
      pick: boxAround({ x: w.center.x + w.inward.x * 0.1, y: w.center.y, z: w.center.z + w.inward.z * 0.1 }, w.alongX ? half : 0.15, (w.head - w.sill) / 2, w.alongX ? 0.15 : half),
    }
  }),
  getActions(obj, ictx) {
    const closed = ictx.world.curtains.get(obj.id) === true
    return [option({ id: closed ? 'curtain.open' : 'curtain.close', actionType: ACTION.TOGGLE_CURTAIN, label: `${closed ? 'Mở rèm' : 'Kéo rèm'} ${obj.name}`, isDefault: true, data: { closed: !closed } })]
  },
  getInteractionContext: () => ({ note: null, status: null }),
})
