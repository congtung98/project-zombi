import type { Group } from 'three'
import type { ItemId } from '../../entities/items'
import { computePose, createPose, type ActionPose, type FallKind, type Pose } from './pose'
import { applyPose, type CharacterRig } from './rig'
import { buildItemProp } from './itemProps'

/**
 * AX3 (FB §7, docs/character-action-ax0.md §2.7): the character's visual state for one frame, built
 * by the view from the simulation (read only) and handed to an animation driver. Actions reach the
 * animation only through `action` (a pose group and its timing) and `props`: the driver decides how
 * they look. Today the driver poses the rig in code; an AnimationMixer driver can replace it later
 * without touching the Action System.
 */
export interface CharacterAnimState {
  time: number
  gaitPhase: number
  speed: number
  hipTurn: number
  swing: number
  hitAt: number
  shove: number
  hurt: number
  dead: number
  fall: FallKind
  armed: boolean
  ready: number
  aimLead: number
  action: ActionPose | null
  props: HandProps
}

/** What each hand holds for the running action, and whether the weapon is put away meanwhile. */
export interface HandProps {
  right: ItemId | null
  left: ItemId | null
  hideWeapon: boolean
}

export interface AnimationDriver {
  update(anim: CharacterAnimState): void
  /** The equipped weapon's model (hidden while an action needs the hands; never unequipped). */
  setWeapon(group: Group | null): void
  dispose(): void
}

/** Props held in the rig's hand sockets; rebuilt only when what a hand holds changes. */
export class PropAttachment {
  private readonly held = { right: null as { itemId: ItemId; group: Group } | null, left: null as { itemId: ItemId; group: Group } | null }
  private readonly rig: CharacterRig
  private readonly castShadow: boolean

  constructor(rig: CharacterRig, castShadow: boolean) {
    this.rig = rig
    this.castShadow = castShadow
  }

  sync(props: Pick<HandProps, 'right' | 'left'>): void {
    this.hand('right', props.right)
    this.hand('left', props.left)
  }

  /** Item in a hand now (tests, debug). */
  holding(hand: 'right' | 'left'): ItemId | null {
    return this.held[hand]?.itemId ?? null
  }

  clear(): void {
    this.sync({ right: null, left: null })
  }

  private hand(hand: 'right' | 'left', itemId: ItemId | null): void {
    const current = this.held[hand]
    if ((current?.itemId ?? null) === itemId) return
    // Shared geometries and materials: removing the group frees everything it owned.
    current?.group.removeFromParent()
    this.held[hand] = null
    if (!itemId) return
    const group = buildItemProp(itemId, this.castShadow)
    ;(hand === 'right' ? this.rig.weaponSocket : this.rig.leftSocket).add(group)
    this.held[hand] = { itemId, group }
  }
}

/** Today's driver: the procedural pose (`computePose`) written into the rig, plus the hand props. */
export class ProceduralPoseDriver implements AnimationDriver {
  private readonly rig: CharacterRig
  private readonly pose: Pose = createPose()
  private readonly props: PropAttachment
  private weapon: Group | null = null

  constructor(rig: CharacterRig, castShadow: boolean) {
    this.rig = rig
    this.props = new PropAttachment(rig, castShadow)
  }

  update(a: CharacterAnimState): void {
    computePose({
      kind: 'player', time: a.time, gaitPhase: a.gaitPhase, speed: a.speed, hipTurn: a.hipTurn, swing: a.swing, hitAt: a.hitAt,
      shove: a.shove, attack: -1, hurt: a.hurt, dead: a.dead, fall: a.fall, armed: a.armed, ready: a.ready, aimLead: a.aimLead, action: a.action,
    }, this.pose)
    applyPose(this.rig, this.pose)
    this.props.sync(a.props)
    if (this.weapon) this.weapon.visible = !a.props.hideWeapon
  }

  setWeapon(group: Group | null): void {
    this.weapon = group
  }

  dispose(): void {
    this.props.clear()
    this.weapon = null
  }
}
