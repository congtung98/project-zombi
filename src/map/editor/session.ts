import type { CommandResult } from './commands.ts'
import type { MapDocument } from './document.ts'

/**
 * Command history (M3). An entry keeps the document and selection before and after one command;
 * documents are immutable and share unchanged chunks, so this costs little and undo/redo restore
 * data, identities and selection exactly. A new command after an undo drops the redo branch.
 * One drag = one command = one entry (the viewport previews the move and commits on release).
 */

export interface HistoryEntry {
  label: string
  before: MapDocument
  after: MapDocument
  selectionBefore: string[]
  selectionAfter: string[]
}

export interface EditState {
  doc: MapDocument
  selection: string[]
  past: HistoryEntry[]
  future: HistoryEntry[]
}

export const HISTORY_LIMIT = 200

export function initialEditState(doc: MapDocument): EditState {
  return { doc, selection: [], past: [], future: [] }
}

/** Apply a command result; errors return the state unchanged plus the message. */
export function applyCommand(state: EditState, label: string, result: CommandResult): { state: EditState; error?: string; note?: string } {
  if (!result.ok) return { state, error: result.error }
  if (result.doc === state.doc) return { state: { ...state, selection: result.selection } }
  const entry: HistoryEntry = { label, before: state.doc, after: result.doc, selectionBefore: state.selection, selectionAfter: result.selection }
  const past = [...state.past, entry].slice(-HISTORY_LIMIT)
  return { state: { doc: result.doc, selection: result.selection, past, future: [] }, note: result.note }
}

export function undo(state: EditState): EditState {
  const entry = state.past[state.past.length - 1]
  if (!entry) return state
  return { doc: entry.before, selection: entry.selectionBefore, past: state.past.slice(0, -1), future: [entry, ...state.future] }
}

export function redo(state: EditState): EditState {
  const entry = state.future[0]
  if (!entry) return state
  return { doc: entry.after, selection: entry.selectionAfter, past: [...state.past, entry], future: state.future.slice(1) }
}
