/**
 * exec-hangars log helper (Windows-native).
 *
 * Follows Star Citizen's Game.log, extracts the whitelisted exec-hangar events
 * (see src/core/logParser.ts), corrects their timestamps to server time and
 * sends them to the exec-hangars server. Read-only: never touches the game
 * process.
 *
 * On Windows it runs without a console, as a notification-area (tray) icon:
 * colour = status, hover = details, right-click = menu (open timer, log,
 * settings, pause, start with Windows, quit). Logs go to
 * %LOCALAPPDATA%\exec-hangars\helper.log.
 *
 * Config (first match wins): CLI flags, environment variables, then
 * exec-hangars-helper.json next to the executable.
 *   --server  / EXEC_HANGARS_SERVER  (default http://localhost:3000)
 *   --token   / EXEC_HANGARS_TOKEN   (must match the server's HELPER_TOKEN)
 *   --log     / EXEC_HANGARS_LOG     (default: C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\Game.log)
 *   --backfill                       also scan logbackups\*.log once at startup
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { DupCounter, LineBuffer, parseLogLine, type LogEvent } from '../src/core/logParser'
import type { EventBatch } from '../src/core/protocol'
import {
  acquireSingleInstance,
  autostart,
  createTray,
  isWindows,
  messageBox,
  shellOpen,
  type Tray,
  type TrayColor,
} from './tray'

/** Release number, stamped in by the release build (`--define HELPER_VERSION=...`). */
declare const HELPER_VERSION: string | undefined
const VERSION = typeof HELPER_VERSION === 'string' ? HELPER_VERSION : 'dev'
const APP = 'Exec Hangar helper'
const POLL_MS = 1_000
const SEND_MS = 2_000
const CLOCK_SYNC_MS = 10 * 60_000
const MAX_QUEUE = 10_000
const MAX_BATCH = 500
const DEFAULT_LOG = 'C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE\\Game.log'
const AUTOSTART_NAME = 'ExecHangarsHelper'
/** True for the built .exe, false for `bun helper/main.ts`. */
const compiled = !/^bun(\.exe)?$/i.test(basename(process.execPath))

// ---------- logging ----------

const LOG_DIR = join(process.env.LOCALAPPDATA ?? dirname(process.execPath), 'exec-hangars')
const LOG_FILE = join(LOG_DIR, 'helper.log')
const LOG_MAX_BYTES = 2 * 1024 * 1024

function initLogFile() {
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > LOG_MAX_BYTES) renameSync(LOG_FILE, `${LOG_FILE}.old`)
  } catch {
    /* logging to file is best-effort */
  }
}

const log = (msg: string) => {
  const line = `${new Date().toISOString()} ${msg}`
  console.log(line)
  if (isWindows) {
    try {
      appendFileSync(LOG_FILE, `${line}\r\n`)
    } catch {
      /* best-effort */
    }
  }
}

function fatal(msg: string): never {
  log(`fatal: ${msg}`)
  console.error(`[exec-hangars] ${msg}`)
  messageBox(APP, msg, 'error')
  process.exit(1)
}

// ---------- config ----------

type Config = { server: string; token: string; log: string; backfill: boolean }

const CONFIG_PATH = join(dirname(process.execPath), 'exec-hangars-helper.json')

function loadConfig(): Config {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : undefined
  }
  let file: Partial<Config> = {}
  if (existsSync(CONFIG_PATH)) {
    try {
      file = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    } catch (err) {
      fatal(`Could not read the settings file:\n${CONFIG_PATH}\n\n${err}`)
    }
  }
  const cfg: Config = {
    server: (flag('server') ?? process.env.EXEC_HANGARS_SERVER ?? file.server ?? 'http://localhost:3000').replace(/\/+$/, ''),
    token: flag('token') ?? process.env.EXEC_HANGARS_TOKEN ?? file.token ?? '',
    log: flag('log') ?? process.env.EXEC_HANGARS_LOG ?? file.log ?? DEFAULT_LOG,
    backfill: args.includes('--backfill') || file.backfill === true,
  }
  if (!cfg.token) {
    if (isWindows && compiled) firstRunSetup()
    fatal('No token. Pass --token, set EXEC_HANGARS_TOKEN, or add "token" to exec-hangars-helper.json.')
  }
  return cfg
}

/** No token yet: write a settings template next to the exe, explain, and open it. */
function firstRunSetup(): never {
  try {
    if (!existsSync(CONFIG_PATH)) {
      const template = { server: 'http://your-server:3000', token: '', log: DEFAULT_LOG }
      writeFileSync(CONFIG_PATH, `${JSON.stringify(template, null, 2)}\n`)
    }
  } catch (err) {
    fatal(`The helper needs a settings file but could not create one:\n${CONFIG_PATH}\n\n${err}`)
  }
  messageBox(
    APP,
    `Almost there. Fill in "server" and "token" in the settings file that opens next, save it, then start the helper again.\n\n${CONFIG_PATH}`,
    'info',
  )
  shellOpen(CONFIG_PATH)
  process.exit(0)
}

// ---------- status ----------

const status = {
  server: 'connecting' as 'connecting' | 'ok' | 'down',
  log: 'waiting' as 'waiting' | 'reading',
  paused: false,
  lastSentAt: null as number | null,
  /** When the server was last seen up, for "reconnected" notifications. */
  downSince: null as number | null,
}

let tray: Tray | null = null

function setServer(state: 'ok' | 'down') {
  if (state === status.server) return
  const prev = status.server
  status.server = state
  if (state === 'down') {
    status.downSince = Date.now()
    if (prev === 'ok') tray?.notify(APP, "Can't reach the exec-hangars server. Will keep retrying.", 'warning')
  } else {
    if (prev === 'down' && status.downSince && Date.now() - status.downSince > 30_000)
      tray?.notify(APP, 'Reconnected to the exec-hangars server.')
    status.downSince = null
  }
  updateTray()
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function statusLine(): { color: TrayColor; text: string } {
  if (status.paused) return { color: 'grey', text: 'Paused: not reporting' }
  if (status.server === 'down') return { color: 'red', text: "Can't reach server, retrying" }
  if (status.server === 'connecting') return { color: 'amber', text: 'Connecting to server…' }
  if (status.log === 'waiting') return { color: 'amber', text: 'Waiting for Game.log (game not running?)' }
  return {
    color: 'green',
    text: status.lastSentAt ? `Reporting · last sent ${clock(status.lastSentAt)}` : 'Reporting · watching Game.log',
  }
}

function updateTray() {
  if (!tray) return
  const { color, text } = statusLine()
  tray.set(color, `${APP} ${VERSION}\n${text}`)
}

// ---------- clock sync ----------

/** server − local, ms. null until the first successful sync. */
let clockOffsetMs: number | null = null

async function syncClock(server: string): Promise<void> {
  const samples: { offset: number; rtt: number }[] = []
  for (let i = 0; i < 5; i++) {
    try {
      const t0 = Date.now()
      const res = await fetch(`${server}/api/time`, { signal: AbortSignal.timeout(5_000) })
      const t1 = Date.now()
      const { serverTimeMs } = (await res.json()) as { serverTimeMs: number }
      samples.push({ offset: serverTimeMs - (t0 + t1) / 2, rtt: t1 - t0 })
    } catch {
      // try next sample
    }
  }
  if (!samples.length) {
    log(`clock sync failed (server unreachable?)`)
    setServer('down')
    return
  }
  setServer('ok')
  // The lowest-RTT sample has the least asymmetric-delay error.
  const best = samples.sort((a, b) => a.rtt - b.rtt)[0]
  const changed = clockOffsetMs === null || Math.abs(best.offset - clockOffsetMs) > 250
  clockOffsetMs = Math.round(best.offset)
  if (changed) log(`clock offset ${clockOffsetMs} ms (rtt ${best.rtt} ms)`)
}

// ---------- event queue / sender ----------

/** Events with raw (local-clock) timestamps; the server applies clockOffsetMs. */
const queue: LogEvent[] = []
let lastLocation: string | null = null

function enqueue(e: LogEvent) {
  // Only report leaving the hangar, not every location change elsewhere.
  if (e.type === 'location') {
    if (e.location === 'other' && (lastLocation === null || lastLocation === 'other')) {
      lastLocation = 'other'
      return
    }
    lastLocation = e.location
  }
  if (e.type === 'elevator_state') log(`elevator → ${e.state}`)
  queue.push(e)
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE)
}

const helperId = createHash('sha256').update(`exec-hangars:${hostname()}`).digest('hex').slice(0, 16)

async function flush(cfg: Config): Promise<void> {
  if (!queue.length || clockOffsetMs === null) return
  const chunk = queue.slice(0, MAX_BATCH)
  const offset = clockOffsetMs
  const batch: EventBatch = {
    helperId,
    helperVersion: VERSION,
    clockOffsetMs: offset,
    events: chunk,
  }
  try {
    const res = await fetch(`${cfg.server}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 401)
      fatal(`The server rejected the token. Check "token" in the settings file, then start the helper again.\n\n${CONFIG_PATH}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
    queue.splice(0, chunk.length)
    const { added } = (await res.json()) as { added: number }
    status.lastSentAt = Date.now()
    setServer('ok')
    updateTray()
    if (added) log(`sent ${chunk.length} event(s), ${added} new`)
  } catch (err) {
    setServer('down')
    log(`send failed, will retry: ${err instanceof Error ? err.message : err}`)
  }
}

// ---------- file following ----------

async function readHead(path: string): Promise<string> {
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(128)
    const { bytesRead } = await fh.read(buf, 0, 128, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await fh.close()
  }
}

/** Reads [from, to) of a file that another process is writing. */
async function readRange(path: string, from: number, to: number): Promise<Buffer> {
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(to - from)
    const { bytesRead } = await fh.read(buf, 0, buf.length, from)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

function feed(text: string, lines: LineBuffer, dups: DupCounter) {
  for (const line of lines.push(text)) {
    const e = parseLogLine(line)
    if (e) enqueue(dups.tag(e))
  }
}

function setLog(state: 'waiting' | 'reading') {
  if (state === status.log) return
  status.log = state
  updateTray()
}

async function follow(path: string): Promise<never> {
  let offset = 0
  let head = ''
  let decoder = new TextDecoder()
  const lines = new LineBuffer()
  let dups = new DupCounter()
  let waitingLogged = false

  for (;;) {
    try {
      const { size } = await stat(path)
      const currentHead = await readHead(path)
      // New Game.log (game relaunched): it shrank, or its first line changed.
      if (size < offset || (head && !currentHead.startsWith(head.slice(0, 64)))) {
        log('Game.log was replaced (game restarted); reading the new log from the start')
        offset = 0
        decoder = new TextDecoder()
        lines.reset()
        dups = new DupCounter()
        lastLocation = null
      }
      head = currentHead
      if (status.paused) {
        // Skip whatever is written while paused; resume from the end.
        offset = size
      } else if (size > offset) {
        const chunk = await readRange(path, offset, size)
        offset += chunk.length
        // stream: true keeps a UTF-8 sequence split across reads intact.
        feed(decoder.decode(chunk, { stream: true }), lines, dups)
      }
      waitingLogged = false
      setLog('reading')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        if (!waitingLogged) log(`waiting for ${path}`)
        waitingLogged = true
        setLog('waiting')
      } else {
        log(`read error: ${err}`)
      }
    }
    await Bun.sleep(POLL_MS)
  }
}

async function backfill(logPath: string) {
  const dir = join(dirname(logPath), 'logbackups')
  let files: string[] = []
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.log'))
  } catch {
    log(`no logbackups folder at ${dir}`)
    return
  }
  log(`backfilling ${files.length} old log(s) from ${dir}`)
  for (const f of files) {
    const text = await Bun.file(join(dir, f)).text()
    const lines = new LineBuffer()
    lastLocation = null
    feed(text + '\n', lines, new DupCounter())
  }
  lastLocation = null
}

// ---------- tray ----------

function startTray(cfg: Config) {
  const autostartCommand = `"${process.execPath}"`
  tray = createTray({
    title: APP,
    onClick: () => shellOpen(cfg.server),
    onClose: () => void quit(cfg),
    menu: () => [
      { label: `${APP} ${VERSION}`, disabled: true },
      { label: statusLine().text, disabled: true },
      { separator: true },
      { label: 'Open hangar timer', onClick: () => shellOpen(cfg.server) },
      { label: 'Open log file', onClick: () => shellOpen(LOG_FILE) },
      { label: 'Open settings file', onClick: () => shellOpen(CONFIG_PATH), disabled: !existsSync(CONFIG_PATH) },
      { separator: true },
      {
        label: 'Pause reporting',
        checked: status.paused,
        onClick: () => {
          status.paused = !status.paused
          log(status.paused ? 'paused by user' : 'resumed by user')
          updateTray()
        },
      },
      {
        label: 'Start with Windows',
        checked: autostart.get(AUTOSTART_NAME),
        disabled: !compiled,
        onClick: () => {
          const on = !autostart.get(AUTOSTART_NAME)
          if (!autostart.set(AUTOSTART_NAME, on ? autostartCommand : null))
            messageBox(APP, 'Could not change the "Start with Windows" setting.', 'warning')
          else log(on ? 'start with Windows: on' : 'start with Windows: off')
        },
      },
      { separator: true },
      { label: 'Quit', onClick: () => void quit(cfg) },
    ],
  })
  updateTray()
  log('tray icon added')
  tray.notify(APP, 'Running in the notification area. Right-click the icon for options.')
}

async function quit(cfg: Config) {
  log('quit requested')
  // Best effort: send anything still queued.
  await flush(cfg).catch(() => {})
  tray?.dispose()
  process.exit(0)
}

// ---------- main ----------

async function main() {
  if (isWindows) initLogFile()
  if (!acquireSingleInstance('exec-hangars-helper'))
    fatal('The helper is already running. Look for its icon in the notification area (you may need to click ^ to see it).')
  const cfg = loadConfig()
  log(`exec-hangars helper ${VERSION}`)
  log(`log:    ${cfg.log}`)
  log(`server: ${cfg.server}`)

  if (isWindows) {
    try {
      startTray(cfg)
    } catch (err) {
      log(`tray unavailable: ${err}`)
    }
  }

  await syncClock(cfg.server)
  // Retry quickly until the first sync succeeds (events are held until then).
  let lastSync = Date.now()
  setInterval(() => {
    if (clockOffsetMs === null || Date.now() - lastSync > CLOCK_SYNC_MS) {
      lastSync = Date.now()
      void syncClock(cfg.server)
    }
  }, 15_000)

  let sending = false
  setInterval(async () => {
    if (sending) return
    sending = true
    try {
      await flush(cfg)
    } finally {
      sending = false
    }
  }, SEND_MS)

  // Keep the "last sent" time in the tooltip fresh.
  setInterval(updateTray, 30_000)

  if (cfg.backfill) await backfill(cfg.log)
  await follow(cfg.log)
}

void main()
