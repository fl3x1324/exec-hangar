import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  hangarStateAt,
  lightsAt,
  residualToNearestClose,
  schedule,
  type Calibration,
} from './cycle'
import { DupCounter, LineBuffer, parseLogLine, type LogEvent } from './logParser'
import { buildCalibration, detectCloses, ELEVATOR_CLOSE_LEAD_MS, mergeCloses, type UpstreamSource } from './calibration'
import { parseArkanisConfig, parseXyxyllAppJs } from './upstream'
import { validateEvent } from './protocol'

const fixture = (name: string) => readFileSync(join(import.meta.dir, '__fixtures__', name), 'utf8')
const iso = (s: string) => Date.parse(s)
const MIN = 60_000

// Arkanis/xyxyll calibration for build 12974691 (2026-10-30).
const ARKANIS: Calibration = {
  anchorMs: iso('2026-10-29T22:01:09.073Z'),
  openMs: 3_900_123,
  closeMs: 7_200_227,
}
const NOMINAL: Calibration = { anchorMs: iso('2026-01-01T00:00:00Z'), openMs: 65 * MIN, closeMs: 120 * MIN }

const logEvents = (): LogEvent[] =>
  fixture('exec-close-2026-11-06.log')
    .split('\n')
    .map(parseLogLine)
    .filter((e): e is LogEvent => e !== null)

describe('cycle', () => {
  test('light pattern across a nominal cycle', () => {
    const at = (min: number) => lightsAt(min * MIN, NOMINAL).map((l) => l[0]).join('')
    expect(at(0)).toBe('ggggg')
    expect(at(11.9)).toBe('ggggg')
    expect(at(12)).toBe('ggggo')
    expect(at(48)).toBe('goooo')
    expect(at(60)).toBe('ooooo') // blackout
    expect(at(65)).toBe('rrrrr') // closed
    expect(at(89)).toBe('grrrr')
    expect(at(161)).toBe('ggggr')
    expect(at(184.99)).toBe('ggggr')
  })

  test('state, phase end and next change', () => {
    const s = hangarStateAt(NOMINAL.anchorMs + 61 * MIN, NOMINAL)
    expect(s.phase).toBe('open')
    expect(s.subPhase).toBe('blackout')
    expect(s.phaseEndsAtMs).toBe(NOMINAL.anchorMs + 65 * MIN)
    expect(s.nextChangeAtMs).toBe(NOMINAL.anchorMs + 65 * MIN)

    const c = hangarStateAt(NOMINAL.anchorMs + 100 * MIN, NOMINAL)
    expect(c.phase).toBe('closed')
    expect(c.nextChangeAtMs).toBe(NOMINAL.anchorMs + 113 * MIN)
    expect(c.phaseEndsAtMs).toBe(NOMINAL.anchorMs + 185 * MIN)
  })

  test('works before the anchor (negative elapsed)', () => {
    const s = hangarStateAt(NOMINAL.anchorMs - 1 * MIN, NOMINAL)
    expect(s.phase).toBe('closed')
    expect(s.cycleIndex).toBe(-1)
    expect(s.phaseEndsAtMs).toBe(NOMINAL.anchorMs)
  })

  test('schedule lists alternating boundaries', () => {
    const s = schedule(NOMINAL.anchorMs, NOMINAL.anchorMs + 370 * MIN, NOMINAL)
    expect(s.map((e) => e.kind)).toEqual(['open', 'close', 'open', 'close'])
    expect(s[1].atMs - s[0].atMs).toBe(65 * MIN)
  })

  test('Arkanis anchor predicts the 2026-11-06 close at 06:51:29.146Z', () => {
    const s = hangarStateAt(iso('2026-11-06T06:40:00Z'), ARKANIS)
    expect(new Date(s.phaseEndsAtMs).toISOString()).toBe('2026-11-06T06:51:29.146Z')
  })
})

describe('log parser', () => {
  test('extracts whitelisted events from the real 2026-11-06 session', () => {
    const ev = logEvents()
    expect(ev.find((e) => e.type === 'log_start')).toMatchObject({ clientBuild: '12913470' })
    expect(ev.find((e) => e.type === 'env')).toMatchObject({ env: 'pub-sc-alpha-4102-12881860' })
    expect(ev.find((e) => e.type === 'join_pu')).toMatchObject({ shard: 'pub_euw1b_12881860_470' })
    expect(ev.filter((e) => e.type === 'location').map((e) => (e as { location: string }).location)).toContain(
      'AsteroidClusterBase_Pyro_Dungeon_Executive_001b',
    )
    const states = ev.filter((e) => e.type === 'elevator_state').map((e) => (e as { state: string }).state)
    expect(states).toContain('LoweringPlatform')
    expect(states).toContain('ClosedIdle')
  })

  test('non-exec locations are masked', () => {
    const e = parseLogLine(
      '<2026-11-06T06:11:35.646Z> [Notice] <RequestLocationInventory> Player[X] requested inventory for Location[RR_HUR_LEO] [Team]',
    )
    expect(e).toEqual({ type: 'location', at: iso('2026-11-06T06:11:35.646Z'), location: 'other' })
  })

  test('ignores other elevators and unrelated lines', () => {
    expect(
      parseLogLine(
        '<2026-11-06T06:52:19.922Z> [Notice] <CSCLoadingPlatformManager::OnLoadingPlatformStateChanged> [Loading Platform] Loading Platform Manager [LoadingPlatformManager_FreightElevator_Util_HangarMedium] Platform state changed to OpenIdle [Team]',
      ),
    ).toBeNull()
    expect(parseLogLine('no timestamp here')).toBeNull()
  })

  test('LineBuffer holds partial lines across chunks', () => {
    const b = new LineBuffer()
    expect(b.push('<a>one\r\n<b>tw')).toEqual(['<a>one'])
    expect(b.push('o\n')).toEqual(['<b>two'])
  })
})

describe('calibration', () => {
  const upstream: UpstreamSource[] = [{ id: 'arkanis', label: 'test', calibration: ARKANIS }]

  test('detects one close from the clustered lowerings, with 2 elevators moving together', () => {
    const closes = detectCloses(logEvents())
    expect(closes).toHaveLength(1)
    expect(new Date(closes[0].atMs).toISOString()).toBe('2026-11-06T06:51:25.602Z')
    expect(closes[0].elevators).toBe(2)
  })

  const lower = (at: number, dup?: number): LogEvent => ({ type: 'elevator_state', at, state: 'LoweringPlatform', ...(dup ? { dup } : {}) })

  test('elevators lowering >1 s apart in a cluster are not "together"', () => {
    const t = iso('2026-11-06T06:51:25Z')
    expect(detectCloses([lower(t), lower(t + 5_000)])[0].elevators).toBe(1)
    expect(detectCloses([lower(t), lower(t + 400), lower(t + 900)])[0].elevators).toBe(3)
  })

  test('same-millisecond lowerings stay distinct via dup', () => {
    const t = iso('2026-11-06T06:51:25Z')
    const d = new DupCounter()
    const tagged = [lower(t), lower(t)].map((e) => d.tag(e))
    expect(tagged[1]).toMatchObject({ dup: 1 })
    expect(new Set(tagged.map((e) => JSON.stringify(e))).size).toBe(2)
    expect(detectCloses(tagged)[0].elevators).toBe(2)
    expect(validateEvent(tagged[1])).toEqual(tagged[1])
    expect(validateEvent({ ...tagged[1], dup: -1 })).toBeNull()
  })

  test('real observation verifies Arkanis and re-anchors on it', () => {
    const r = buildCalibration(upstream, detectCloses(logEvents()))
    expect(r.status).toBe('verified')
    expect(r.basis).toBe('elevator')
    expect(Math.abs(r.observations[0].residualMs!)).toBeLessThan(100) // lead constant absorbs the 3.5 s
    // New anchor predicts the same close as the observation implies.
    const close = hangarStateAt(iso('2026-11-06T06:40:00Z'), r.calibration!).phaseEndsAtMs
    expect(close).toBe(iso('2026-11-06T06:51:25.602Z') + ELEVATOR_CLOSE_LEAD_MS)
  })

  test('upstream only', () => {
    const r = buildCalibration(upstream, [])
    expect(r.status).toBe('upstream')
    expect(r.calibration).toEqual(ARKANIS)
  })

  test('single disagreeing observation → conflict, keep upstream', () => {
    const at = iso('2026-11-06T06:51:25.602Z') + 40 * MIN
    const r = buildCalibration(upstream, [{ atMs: at, boundaryMs: at + ELEVATOR_CLOSE_LEAD_MS }])
    expect(r.status).toBe('conflict')
    expect(r.calibration).toEqual(ARKANIS)
  })

  test('two helpers reporting the same single-elevator close do not add up', () => {
    const t = iso('2026-11-06T06:51:25Z')
    const a = detectCloses([lower(t)])
    const b = detectCloses([lower(t + 20)])
    const merged = mergeCloses([a, b])
    expect(merged).toHaveLength(1)
    expect(merged[0].elevators).toBe(1)
    expect(mergeCloses([a, detectCloses([lower(t + 10), lower(t + 50)])])[0].elevators).toBe(2)
  })

  test('single disagreeing multi-elevator close → observed on its own', () => {
    const at = iso('2026-11-06T06:51:25.602Z') + 40 * MIN
    const r = buildCalibration(upstream, [{ atMs: at, boundaryMs: at + ELEVATOR_CLOSE_LEAD_MS, elevators: 2 }])
    expect(r.status).toBe('observed')
    expect(r.notes.join(' ')).toContain('lowered together')
    expect(residualToNearestClose(at + ELEVATOR_CLOSE_LEAD_MS, r.calibration!)).toBe(0)
  })

  test('two consistent disagreeing observations → observed (upstream stale after reset)', () => {
    const first = iso('2026-11-06T06:51:25.602Z') + 40 * MIN
    const second = first + 2 * (ARKANIS.openMs + ARKANIS.closeMs) + 1_000
    const obs = [first, second].map((a) => ({ atMs: a, boundaryMs: a + ELEVATOR_CLOSE_LEAD_MS }))
    const r = buildCalibration(upstream, obs)
    expect(r.status).toBe('observed')
    expect(residualToNearestClose(second + ELEVATOR_CLOSE_LEAD_MS, r.calibration!)).toBe(0)
  })

  test('observations older than the upstream anchor are ignored', () => {
    const old = ARKANIS.anchorMs - 10 * MIN
    const r = buildCalibration(upstream, [{ atMs: old, boundaryMs: old }])
    expect(r.status).toBe('upstream')
  })

  test('disagreeing upstream sources are flagged', () => {
    const other = { ...ARKANIS, anchorMs: ARKANIS.anchorMs + 30 * MIN }
    const r = buildCalibration([...upstream, { id: 'x', label: 'x', calibration: other }], [])
    expect(r.upstream[1].agreesWithPrimary).toBe(false)
    expect(r.notes.join(' ')).toContain('disagrees')
  })
})

describe('upstream parsers', () => {
  test('Arkanis config', () => {
    const p = parseArkanisConfig(JSON.parse(fixture('arkanis-config.json')))
    expect(p?.calibration.openMs).toBeGreaterThan(64 * MIN)
    expect(p?.label).toContain('Patch')
  })

  test('xyxyll app.js matches Arkanis', () => {
    const x = parseXyxyllAppJs(fixture('xyxyll-app.js'))
    const a = parseArkanisConfig(JSON.parse(fixture('arkanis-config.json')))
    expect(x).not.toBeNull()
    expect(x!.calibration).toEqual(a!.calibration)
  })

  test('garbage → null', () => {
    expect(parseArkanisConfig({ serverStartTimes: { initialOpenTime: 'x', openDurationMs: 1, closeDurationMs: 2 } })).toBeNull()
    expect(parseXyxyllAppJs('const nope = 1;')).toBeNull()
  })
})

describe('docs fixtures', () => {
  test('docs/fixtures match buildReport output (run `bun run fixtures` to update)', async () => {
    const { buildFixtures, serialize, FIXTURE_DIR } = await import('../../scripts/fixtures')
    for (const [name, report] of Object.entries(buildFixtures())) {
      expect(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8')).toBe(serialize(report))
    }
  })
})
