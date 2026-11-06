export const MIN = 60_000
export const HOUR = 3_600_000

const pad = (n: number) => String(n).padStart(2, '0')

export function splitDuration(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000))
  return { h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 }
}

/** h:mm:ss, always with hours (max ~2 h in practice). */
export function fmtCountdown(ms: number): string {
  const { h, m, s } = splitDuration(ms)
  return `${h}:${pad(m)}:${pad(s)}`
}

/** mm:ss for short secondary countdowns, h:mm:ss above an hour. */
export function fmtTimer(ms: number): string {
  const { h, m, s } = splitDuration(ms)
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** "2 h 14 min", "14 min", "45 s". */
export function fmtSpan(ms: number): string {
  const abs = Math.abs(ms)
  if (abs < MIN) return `${Math.max(0, Math.round(abs / 1000))} s`
  const totalMin = Math.round(abs / MIN)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`
}

export const fmtRel = (ms: number) => (ms >= 0 ? `in ${fmtSpan(ms)}` : `${fmtSpan(ms)} ago`)

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function dtf(key: string, opts: Intl.DateTimeFormatOptions) {
  let f = fmtCache.get(key)
  if (!f) fmtCache.set(key, (f = new Intl.DateTimeFormat(undefined, opts)))
  return f
}

export function fmtClock(atMs: number, utc: boolean): string {
  return dtf(`clock-${utc}`, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: utc ? 'UTC' : undefined,
  }).format(atMs)
}

function dayKey(atMs: number, utc: boolean) {
  return dtf(`day-${utc}`, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: utc ? 'UTC' : undefined }).format(atMs)
}

/** "Today" / "Tomorrow" / "Sat 8 Nov". */
export function fmtDay(atMs: number, nowMs: number, utc: boolean): string {
  const k = dayKey(atMs, utc)
  if (k === dayKey(nowMs, utc)) return 'Today'
  if (k === dayKey(nowMs + 24 * HOUR, utc)) return 'Tomorrow'
  return dtf(`wd-${utc}`, { weekday: 'short', day: 'numeric', month: 'short', timeZone: utc ? 'UTC' : undefined }).format(atMs)
}

export function fmtDateTime(atMs: number, utc: boolean): string {
  return dtf(`dt-${utc}`, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: utc ? 'UTC' : undefined,
  }).format(atMs)
}

export const tzName = (utc: boolean) =>
  utc ? 'UTC' : (Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'local').split('/').pop()!.replace(/_/g, ' ')
