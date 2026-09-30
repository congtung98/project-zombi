import { describe, expect, it } from 'vitest'
import { ACTION_STATES, CHARACTER_STATES, CharacterStateMachine, canTransition, deriveState, INTERRUPT_ALL, interrupts, type CharacterFacts } from './characterState'

const idle: CharacterFacts = { alive: true, moving: false, approaching: false, stance: false, swinging: false, action: null }

describe('character state (AX1, FB §4)', () => {
  it('derives the state by priority: death, swing, action, approach, stance, movement', () => {
    expect(deriveState(idle)).toBe('IDLE')
    expect(deriveState({ ...idle, moving: true })).toBe('MOVING')
    expect(deriveState({ ...idle, moving: true, stance: true })).toBe('COMBAT_STANCE')
    expect(deriveState({ ...idle, stance: true, approaching: true })).toBe('APPROACHING')
    expect(deriveState({ ...idle, stance: true, action: 'LOOTING' })).toBe('LOOTING')
    expect(deriveState({ ...idle, swinging: true, action: 'EATING' })).toBe('ATTACKING')
    expect(deriveState({ ...idle, alive: false, swinging: true })).toBe('DEAD')
  })

  it('death leaves only through a reset; an action may hand over to the next one', () => {
    for (const s of CHARACTER_STATES) if (s !== 'DEAD' && s !== 'IDLE') expect(canTransition('DEAD', s)).toBe(false)
    expect(canTransition('DEAD', 'IDLE')).toBe(true)
    expect(canTransition('EATING', 'DRINKING')).toBe(true)
    expect(canTransition('EATING', 'COMBAT_STANCE')).toBe(true)
    for (const s of CHARACTER_STATES) if (s !== 'DEAD') expect(canTransition(s, 'DEAD')).toBe(true)
  })

  it('Case 5 (FB §15): eating, a zombie hits → interrupted, back to IDLE or the stance', () => {
    const m = new CharacterStateMachine()
    m.update({ ...idle, action: 'EATING' })
    expect(m.state).toBe('EATING')
    expect(interrupts('hit', INTERRUPT_ALL)).toBe(true)
    // The runtime cancels the queue on the hit: the next facts have no action.
    expect(m.update({ ...idle, stance: true })).toEqual({ from: 'EATING', to: 'COMBAT_STANCE' })
    m.update({ ...idle, action: 'EATING' })
    m.update(idle)
    expect([m.state, m.violations]).toEqual(['IDLE', []])
  })

  it('a policy can let an action run through one interruption and not another', () => {
    const policy = { ...INTERRUPT_ALL, stance: 'allow' as const }
    expect(interrupts('stance', policy)).toBe(false)
    expect(['move', 'hit', 'attack'].every((k) => interrupts(k as 'move', policy))).toBe(true)
  })

  it('records a transition the table does not allow, but follows the facts', () => {
    const m = new CharacterStateMachine()
    m.update({ ...idle, alive: false })
    m.update({ ...idle, action: ACTION_STATES[0] })
    expect(m.state).toBe(ACTION_STATES[0])
    expect(m.violations).toEqual([{ from: 'DEAD', to: ACTION_STATES[0] }])
    m.reset()
    expect(m.state).toBe('IDLE')
  })
})
