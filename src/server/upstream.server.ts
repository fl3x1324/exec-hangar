import type { UpstreamSource } from '#/core/calibration'
import {
  ARKANIS_CONFIG_URL,
  XYXYLL_APP_URL,
  parseArkanisConfig,
  parseXyxyllAppJs,
  type ParsedUpstream,
} from '#/core/upstream'
import type { SourceStatus } from '#/core/report'

/**
 * Polls community trackers with a short cache. On failure the last good value
 * is kept (an anchor stays valid until the next server deploy), and the error
 * is reported alongside it.
 */

const TTL_MS = 5 * 60_000
const TIMEOUT_MS = 10_000

type SourceDef = {
  id: string
  url: string
  parse: (body: string) => ParsedUpstream | null
}

/** Order = preference; the first available source is primary. */
const SOURCES: SourceDef[] = [
  { id: 'arkanis', url: ARKANIS_CONFIG_URL, parse: (b) => parseArkanisConfig(JSON.parse(b)) },
  { id: 'xyxyll', url: XYXYLL_APP_URL, parse: parseXyxyllAppJs },
]


type Entry = { value: ParsedUpstream | null; fetchedAt: number | null; checkedAt: number; error: string | null }
const entries = new Map<string, Entry>()
let inflight: Promise<void> | null = null

async function refresh(def: SourceDef): Promise<void> {
  const prev = entries.get(def.id)
  try {
    const res = await fetch(def.url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'exec-hangars' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const parsed = def.parse(await res.text())
    if (!parsed) throw new Error('unrecognised format')
    entries.set(def.id, { value: parsed, fetchedAt: Date.now(), checkedAt: Date.now(), error: null })
  } catch (err) {
    entries.set(def.id, {
      value: prev?.value ?? null,
      fetchedAt: prev?.fetchedAt ?? null,
      checkedAt: Date.now(),
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function getUpstream(): Promise<{ sources: UpstreamSource[]; status: SourceStatus[] }> {
  const stale = SOURCES.some((s) => {
    const e = entries.get(s.id)
    return !e || Date.now() - e.checkedAt > TTL_MS
  })
  if (stale) {
    inflight ??= Promise.all(SOURCES.map(refresh)).then(() => {
      inflight = null
    })
    await inflight
  }
  const sources: UpstreamSource[] = []
  const status: SourceStatus[] = []
  for (const def of SOURCES) {
    const e = entries.get(def.id)
    if (e?.value) sources.push({ id: def.id, label: e.value.label, calibration: e.value.calibration })
    status.push({
      id: def.id,
      url: def.url,
      ok: !!e?.value && !e.error,
      fetchedAt: e?.fetchedAt ?? null,
      error: e?.error ?? null,
    })
  }
  return { sources, status }
}
