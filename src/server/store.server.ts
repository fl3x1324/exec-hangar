import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HelperEvent } from '#/core/report'

/**
 * Append-only JSONL store of helper events. Raw events (not derived
 * observations) are kept so detection rules can be improved and re-run later.
 */

/**
 * `event.at` = raw log time on the helper's clock; add `clockOffsetMs`
 * (server − helper, measured when sent) for server time.
 */
export type StoredEvent = HelperEvent

export const dataDir = () => process.env.DATA_DIR ?? join(process.cwd(), 'data')
const file = () => join(dataDir(), 'events.jsonl')

let cache: StoredEvent[] | null = null
const seen = new Set<string>()

/** Identity = which token + helper + the raw log line's facts (not the jittery corrected time). */
const keyOf = (s: Pick<StoredEvent, 'helperId' | 'event' | 'tokenId'>) =>
  `${s.tokenId ?? 'legacy'}|${s.helperId}|${JSON.stringify(s.event)}`

/** Serialises writes so a rewrite (purge) never races an append. */
let lock: Promise<unknown> = Promise.resolve()
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn)
  lock = run.catch(() => {})
  return run
}

async function load(): Promise<StoredEvent[]> {
  if (cache) return cache
  let text = ''
  try {
    text = await readFile(file(), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  cache = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const s = JSON.parse(line) as StoredEvent
      cache.push(s)
      seen.add(keyOf(s))
    } catch {
      // Skip a torn last line from a crash mid-write.
    }
  }
  return cache
}

export async function allEvents(): Promise<StoredEvent[]> {
  return load()
}

/** Appends events not already stored (helpers may resend after a restart). Returns count added. */
export function addEvents(items: StoredEvent[]): Promise<number> {
  return exclusive(async () => {
    const store = await load()
    const fresh = items.filter((s) => {
      const k = keyOf(s)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    if (fresh.length === 0) return 0
    await mkdir(dataDir(), { recursive: true })
    await appendFile(file(), fresh.map((s) => JSON.stringify(s) + '\n').join(''))
    store.push(...fresh)
    return fresh.length
  })
}

/**
 * Deletes every event a token sent (e.g. a revoked player's bad data).
 * Rewrites the file atomically. Returns how many were removed.
 */
export function removeEventsByToken(tokenId: string): Promise<number> {
  return exclusive(async () => {
    const store = await load()
    const keep = store.filter((s) => (s.tokenId ?? 'legacy') !== tokenId)
    const removed = store.length - keep.length
    if (removed === 0) return 0
    await mkdir(dataDir(), { recursive: true })
    const tmp = `${file()}.tmp`
    await writeFile(tmp, keep.map((s) => JSON.stringify(s) + '\n').join(''))
    await rename(tmp, file())
    cache = keep
    seen.clear()
    for (const s of keep) seen.add(keyOf(s))
    return removed
  })
}
