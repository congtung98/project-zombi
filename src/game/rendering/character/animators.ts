/**
 * Character pose callbacks run by one `CharacterAnimator` mounted after `GameLoop`, so every rig is
 * posed from the state of the tick that just ran (no one-frame lag, whatever the mount order of
 * views spawned later). Physics/tick ordering is untouched.
 */
type Animate = (delta: number) => void

const animators = new Set<Animate>()

export function registerAnimator(fn: Animate): () => void {
  animators.add(fn)
  return () => {
    animators.delete(fn)
  }
}

export function runAnimators(delta: number): void {
  for (const fn of animators) fn(delta)
}
