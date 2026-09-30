/**
 * AX1 (docs/character-action-ax0.md §2.5, WIS §5): a counter per world object that grows whenever its
 * gameplay state changes (a door opened, a lamp switched, a curtain drawn, a container opened). A
 * request made from a menu carries the version it saw; when its turn comes a different version means
 * the target changed meanwhile and the request is checked again (`TARGET_CHANGED`). Runtime only:
 * never saved (a load starts every object at 0 and no request survives a load).
 */
export class WorldObjectVersions {
  private readonly versions = new Map<string, number>()

  get(id: string): number {
    return this.versions.get(id) ?? 0
  }

  bump(id: string): number {
    const next = this.get(id) + 1
    this.versions.set(id, next)
    return next
  }

  clear(): void {
    this.versions.clear()
  }
}
