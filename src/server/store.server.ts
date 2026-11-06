import { appendFile, mkdir, readFile } from 'node:fs/promises'
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

const dataDir = () => process.env.DATA_DIR ?? join(process.cwd(), 'data')
const file = () => join(dataDir(), 'events.jsonl')

let cache: StoredEvent[] | null = null
const seen = new Set<string>()

/** Identity = which helper + the raw log line's facts (not the jittery corrected time). */
const keyOf = (s: Pick<StoredEvent, 'helperId' | 'event'>) => `${s.helperId}|${JSON.stringify(s.event)}`

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
export async function addEvents(items: StoredEvent[]): Promise<number> {
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
}
