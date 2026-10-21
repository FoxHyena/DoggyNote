import { noteDocument, noteState, replaceText, decodeUpdate, NOTE_LIMIT } from '@doggynote/core'
import * as Y from 'yjs'

/** Prepare optimistic text writes; the guard rolls the entire batch back on a race. */
export async function prepareNote(db: D1Database, id: string, markdown: string, update?: string, objectSeq = 0, previous?: { state: string; revision: number } | null) {
  const old = previous === undefined ? await db.prepare('SELECT state,revision FROM note_states WHERE id=?1').bind(id).first<{ state: string; revision: number }>() : previous
  const doc = noteDocument(old?.state)
  try {
    const text = doc.getText('markdown')
    if (update) Y.applyUpdate(doc, decodeUpdate(update))
    else replaceText(text, markdown)
    const md = text.toString(), state = noteState(doc)
    if (new TextEncoder().encode(md).length > NOTE_LIMIT || state.length > NOTE_LIMIT * 8) throw new Error('Note too large')
    const revision = (old?.revision ?? 0) + 1
    return {
      md, state, revision, previousRevision: old?.revision ?? 0,
      guard: db.prepare('INSERT OR REPLACE INTO note_write_guard(id,revision,object_seq) VALUES (?1,?2,?3)').bind(id, old?.revision ?? 0, objectSeq),
      write: db.prepare('INSERT INTO note_states(id,state,revision) VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET state=excluded.state,revision=excluded.revision').bind(id, state, revision),
    }
  } finally { doc.destroy() }
}
