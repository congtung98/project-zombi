/**
 * Stable JSON for content files: key order as built, 2-space indent, and any object/array whose
 * one-line form fits in `width` characters kept on one line, so diffs show one entity per line.
 */
export function formatJson(value: unknown, width = 110): string {
  return `${format(value, '', width)}\n`
}

function entries(value: object): [string, unknown][] {
  return Object.entries(value).filter(([, v]) => v !== undefined)
}

function flat(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(flat).join(', ')}]`
  const list = entries(value)
  return list.length ? `{ ${list.map(([k, v]) => `${JSON.stringify(k)}: ${flat(v)}`).join(', ')} }` : '{}'
}

function format(value: unknown, indent: string, width: number): string {
  const line = flat(value)
  if (value === null || typeof value !== 'object' || line.length + indent.length <= width) return line
  const inner = `${indent}  `
  if (Array.isArray(value)) {
    return `[\n${value.map((v) => inner + format(v, inner, width)).join(',\n')}\n${indent}]`
  }
  return `{\n${entries(value).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner, width)}`).join(',\n')}\n${indent}}`
}
