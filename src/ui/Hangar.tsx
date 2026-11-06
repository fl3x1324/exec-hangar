import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { periodMs, type Calibration, type Light } from '#/core/cycle'
import { arc, C, polar, R, RW, segments, type Seg } from './dial'
import { fmtClock, fmtCountdown, fmtDay, fmtRel, fmtSpan, fmtTimer, HOUR, MIN, tzName } from './format'
import { useUtcPref, type Live, type Mood } from './live'
import { ClientText, Details, Digits, LIGHT_LABEL, lightsAria, useLive } from './parts'
import { BLACKOUT_MS, planRun, TRAVEL_OPTIONS, travelLabel } from './plan'
import { TRUST } from './trust'

/**
 * The hangar page: state-coloured glow, the full cycle as a dial, upcoming
 * windows, a 12 h timeline and a "Can I make it?" travel planner.
 */

const EMERALD = '#34d399'
/** Carved outer track for the "now" knob. */
const TRACK_W = 18
const TRACK_R = R + RW / 2 + 9 + TRACK_W / 2
const KNOB_R = TRACK_W / 2 - 2
/** Extra viewBox room so the track fits around the 400×400 dial. */
const PAD = Math.ceil(TRACK_R + TRACK_W / 2 + 4 - C)
const RED = '#dc2626'
const BLACKOUT_RED = '#ef4444'

const MOOD: Record<
  Mood,
  { word: string; verb: string; glow: string; ink: string }
> = {
  none: { word: 'NO SIGNAL', verb: '', glow: 'rgb(120 120 130 / 0.18)', ink: 'text-zinc-400' },
  charging: {
    word: 'CLOSED',
    verb: 'Opens in',
    glow: 'rgb(220 38 38 / 0.30)',
    ink: 'text-red-500',
  },
  soon: {
    word: 'OPENING',
    verb: 'Opens in',
    glow: 'rgb(52 211 153 / 0.30)',
    ink: 'text-emerald-300',
  },
  open: {
    word: 'OPEN',
    verb: 'Closes in',
    glow: 'rgb(16 185 129 / 0.34)',
    ink: 'text-emerald-400',
  },
  closing: {
    word: 'CLOSING',
    verb: 'Closes in',
    glow: 'rgb(245 158 11 / 0.32)',
    ink: 'text-amber-400',
  },
  blackout: {
    word: 'BLACKOUT',
    verb: 'Lockdown in',
    glow: 'rgb(239 68 68 / 0.45)',
    ink: 'text-red-500',
  },
}

export function Hangar() {
  const live = useLive()
  const [utc, setUtc] = useUtcPref()
  const [travelMin, setTravelMin] = useState(45)
  /** True when the arrival was picked on the timeline rather than from a preset pill. */
  const [customTravel, setCustomTravel] = useState(false)
  const pickPreset = (m: number) => {
    setTravelMin(m)
    setCustomTravel(false)
  }
  const pickCustom = (m: number) => {
    setTravelMin(m)
    setCustomTravel(true)
  }
  const { state, mood, report } = live
  const m = MOOD[mood]
  const status = report.calibration.status

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#060708] font-chakra text-zinc-100">
      {/* Ambient glow that follows the state */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 transition-[background] duration-1000 ${mood === 'blackout' ? 'alarm' : ''}`}
        style={{ background: `radial-gradient(90% 55% at 50% 0%, ${m.glow}, transparent 70%)` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(rgb(255 255 255 / .5) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / .5) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(70% 50% at 50% 25%, black, transparent)',
        }}
      />
      {mood === 'blackout' && <div aria-hidden className="hazard absolute inset-x-0 top-0 z-10 h-3" />}

      <div className="relative mx-auto max-w-7xl px-4 pb-28 pt-5 sm:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">Pyro · PYAM-EXHANG-0-1</div>
            <div className="text-lg font-semibold uppercase tracking-[0.12em]">Executive Hangar</div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {live.offline && (
              <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-zinc-400" title="Showing last known timer">
                offline
              </span>
            )}
            <TrustChip status={status} />
            <Link
              to="/helper"
              className="rounded-full border border-zinc-700 px-2.5 py-1 text-zinc-300 hover:border-zinc-500"
              title="Help keep the timer exact: Windows helper setup"
            >
              Helper
            </Link>
            <button
              onClick={() => setUtc(!utc)}
              className="rounded-full border border-zinc-700 px-2.5 py-1 font-mono text-zinc-300 hover:border-zinc-500"
              title="Toggle local time / UTC"
            >
              <ClientText live={live} fallback="local">
                {() => tzName(utc)}
              </ClientText>
            </button>
          </div>
        </header>

        {status === 'conflict' && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <span className="mt-0.5 font-mono text-amber-400">!</span>
            <span>
              <b className="font-semibold">Timer may be off.</b> {TRUST.conflict.detail}
            </span>
          </div>
        )}

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[1fr_minmax(0,540px)_1fr]">
          <div className="order-1 lg:order-2">{state && live.cal ? <Dial live={live} cal={live.cal} utc={utc} /> : <NoSignal />}</div>

          <Card title="Open windows · next 24 h" className="order-3 lg:order-1">
            {live.windows.length === 0 ? (
              <p className="text-sm text-zinc-500">No schedule available.</p>
            ) : (
              <ol className="-mx-2">
                {live.windows.slice(0, 7).map((w) => (
                  <li
                    key={w.openAtMs}
                    className={`flex items-center justify-between gap-3 rounded-lg px-2 py-2 ${
                      w.current ? 'border border-emerald-500/50 bg-emerald-500/10' : 'border border-transparent'
                    }`}
                  >
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                        <ClientText live={live} fallback="…">
                          {() => fmtDay(w.openAtMs, live.now, utc)}
                        </ClientText>
                      </div>
                      <div className="font-door text-2xl font-bold tracking-wide">
                        <ClientText live={live}>{() => fmtClock(w.openAtMs, utc)}</ClientText>
                        <span className="px-1.5 text-zinc-600">→</span>
                        <ClientText live={live}>{() => fmtClock(w.closeAtMs, utc)}</ClientText>
                      </div>
                    </div>
                    <div className={`text-right text-xs ${w.current ? 'text-emerald-300' : 'text-zinc-400'}`}>
                      {w.current ? (
                        <>
                          <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-400">● now</div>
                          closes {fmtRel(w.closeAtMs - live.now)}
                        </>
                      ) : (
                        fmtRel(w.openAtMs - live.now)
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="Signal" className="order-4 lg:order-3">
            <p className="mb-4 text-sm text-zinc-400">{TRUST[status].detail}</p>
            <Details
              live={live}
              utc={utc}
              theme={{
                root: 'space-y-5',
                heading: 'mb-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500',
                row: 'flex justify-between gap-4 border-b border-zinc-900 py-1.5 text-xs',
                key: 'shrink-0 text-zinc-500',
                value: 'text-right text-zinc-200',
                muted: 'mt-2 text-xs text-zinc-500',
                good: 'text-emerald-400',
                bad: 'text-red-400',
              }}
            />
          </Card>

          {live.cal && (
            <div className="order-2 lg:order-4 lg:col-span-3">
              <Timeline live={live} cal={live.cal} utc={utc} travelMin={travelMin} custom={customTravel} onPick={pickCustom} />
              <Plan live={live} utc={utc} travelMin={travelMin} custom={customTravel} onPreset={pickPreset} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Card({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 backdrop-blur ${className ?? ''}`}>
      <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">{title}</h2>
      {children}
    </section>
  )
}

function NoSignal() {
  return (
    <div className="grid aspect-square place-items-center rounded-full border-2 border-dashed border-zinc-800 text-center">
      <div className="max-w-[65%]">
        <div className="font-door text-5xl font-black tracking-[0.18em] text-zinc-400">NO SIGNAL</div>
        <p className="mt-3 text-sm text-zinc-400">{TRUST.none.detail}</p>
      </div>
    </div>
  )
}

/* ---------- Dial ---------- */

function Dial({ live, cal, utc }: { live: Live; cal: Calibration; utc: boolean }) {
  const state = live.state!
  const P = periodMs(cal)
  const nowF = state.msIntoCycle / P
  const m = MOOD[live.mood]
  const blackout = live.mood === 'blackout'
  const segs = segments(cal)
  const gap = 0.003
  const [kx, ky] = polar(TRACK_R, nowF)
  const openAt = state.phase === 'open' ? state.cycleStartMs : state.cycleStartMs + P
  const closeAt = state.cycleStartMs + cal.openMs + (state.phase === 'open' ? 0 : P)

  const stroke = (s: Seg) => (s.kind === 'open' ? EMERALD : s.kind === 'blackout' ? 'url(#eh-hazard)' : RED)
  const glow = (s: Seg) => (s.kind === 'open' ? 'url(#eh-glow-green)' : 'url(#eh-glow-red)')

  const ring = (s: Seg, f0: number, f1: number, past: boolean, key: string) => (
    <path
      key={key}
      d={arc(R, f0, f1)}
      fill="none"
      stroke={stroke(s)}
      strokeWidth={RW}
      opacity={past ? 0.22 : s.kind === 'closed' && state.phase === 'open' ? 0.55 : 1}
      filter={past || (s.kind === 'closed' && state.phase === 'open') ? undefined : glow(s)}
    />
  )

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[540px]">
      <svg
        viewBox={`${-PAD} ${-PAD} ${400 + 2 * PAD} ${400 + 2 * PAD}`}
        className="h-full w-full overflow-visible"
        role="img"
        aria-label={`Cycle dial. ${m.word}, ${fmtCountdown(live.remainingMs)} left.`}
      >
        <defs>
          <filter id="eh-glow-green" filterUnits="userSpaceOnUse" x={-PAD} y={-PAD} width={400 + 2 * PAD} height={400 + 2 * PAD}>
            <feGaussianBlur stdDeviation="5" result="b" />
            <feFlood floodColor={EMERALD} floodOpacity="0.55" />
            <feComposite in2="b" operator="in" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="eh-glow-red" filterUnits="userSpaceOnUse" x={-PAD} y={-PAD} width={400 + 2 * PAD} height={400 + 2 * PAD}>
            <feGaussianBlur stdDeviation="4" result="b" />
            <feFlood floodColor={RED} floodOpacity="0.45" />
            <feComposite in2="b" operator="in" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Groove: dark machined stripes */}
          <pattern id="eh-groove" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#07080a" />
            <rect width="2.5" height="6" fill="#1a1d22" />
          </pattern>
          {/* Inner shadow: light from above, so the upper wall shades the groove */}
          <filter id="eh-inset" filterUnits="userSpaceOnUse" x={-PAD} y={-PAD} width={400 + 2 * PAD} height={400 + 2 * PAD}>
            <feFlood floodColor="#000" floodOpacity="0.95" />
            <feComposite in2="SourceAlpha" operator="out" />
            <feGaussianBlur stdDeviation="3" />
            <feOffset dy="3.5" result="shadow" />
            <feComposite in="shadow" in2="SourceAlpha" operator="in" result="inner" />
            <feMerge>
              <feMergeNode in="SourceGraphic" />
              <feMergeNode in="inner" />
            </feMerge>
          </filter>
          {/* Lip bevels: outer edge lit at the bottom, inner edge lit at the top */}
          <linearGradient id="eh-lip-outer" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#000" stopOpacity="0.9" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.03" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.22" />
          </linearGradient>
          <linearGradient id="eh-lip-inner" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.2" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.03" />
            <stop offset="1" stopColor="#000" stopOpacity="0.9" />
          </linearGradient>
          {/* Knob: polished bearing, lit from top-left */}
          <radialGradient id="eh-knob" cx="0.35" cy="0.3" r="0.75">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.55" stopColor="#e4e7eb" />
            <stop offset="1" stopColor="#8b9098" />
          </radialGradient>
          <pattern id="eh-hazard" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="#0a0a0a" />
            <rect width="4" height="8" fill={BLACKOUT_RED} />
          </pattern>
        </defs>

        {/* Carved track the knob travels in */}
        <circle cx={C} cy={C} r={TRACK_R} fill="none" stroke="url(#eh-groove)" strokeWidth={TRACK_W} filter="url(#eh-inset)" />
        <circle cx={C} cy={C} r={TRACK_R + TRACK_W / 2} fill="none" stroke="url(#eh-lip-outer)" strokeWidth={1.5} />
        <circle cx={C} cy={C} r={TRACK_R - TRACK_W / 2} fill="none" stroke="url(#eh-lip-inner)" strokeWidth={1.5} />

        {segs.map((s, i) => {
          const a = s.f0 + gap
          const b = s.f1 - gap
          if (s.f1 <= nowF) return ring(s, a, b, true, `${i}`)
          if (s.f0 > nowF) return ring(s, a, b, false, `${i}`)
          return (
            <g key={i}>
              {/* split at "now", clamped to the drawn extent so a "now" inside a gap never bleeds into it */}
              {ring(s, a, Math.min(b, Math.max(a, nowF)), true, 'past')}
              <g className={blackout ? 'alarm' : 'pulse-soft'}>{ring(s, Math.min(b, Math.max(a, nowF)), b, false, 'future')}</g>
            </g>
          )
        })}

        <circle cx={C} cy={C} r={R - RW / 2 - 16} fill="rgb(0 0 0 / 0.35)" stroke="rgb(255 255 255 / 0.06)" strokeWidth={1.5} />

        <BoundaryLabel f={0} label="OPENS" time={live.hydrated ? fmtClock(openAt, utc) : '--:--'} />
        <BoundaryLabel f={cal.openMs / P} label="CLOSES" time={live.hydrated ? fmtClock(closeAt, utc) : '--:--'} />

        {/* "now" knob riding in the track: contact shadow, then the bearing */}
        <circle cx={kx} cy={ky + 3} r={KNOB_R + 0.5} fill="#000" opacity={0.9} style={{ filter: 'blur(2px)' }} />
        <circle
          cx={kx}
          cy={ky}
          r={KNOB_R}
          fill="url(#eh-knob)"
          stroke="rgb(0 0 0 / 0.5)"
          strokeWidth={0.6}
          style={{ filter: 'drop-shadow(0 0 5px rgb(255 255 255 / .35))' }}
        />
      </svg>

      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className={`font-door text-3xl font-black tracking-[0.2em] sm:text-4xl ${m.ink} ${blackout ? 'alarm' : ''}`}>{m.word}</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.35em] text-zinc-400">{m.verb}</div>
          <div
            role="timer"
            aria-label={`${m.verb} ${fmtCountdown(live.remainingMs)}`}
            className={`font-door text-[17vw] font-bold leading-[0.9] sm:text-[6.5rem] ${blackout ? 'text-red-500' : 'text-white'}`}
          >
            <Digits text={fmtCountdown(live.remainingMs)} digitWidth={0.5} sepClassName="inline-block w-[0.24em] text-center" />
          </div>
          <MiniLamps lights={state.lights} blackout={blackout} />
          <div className="mt-2 h-4 font-mono text-[11px] text-zinc-500">
            {blackout ? (
              <span className="font-semibold text-red-400">Leave now · lethal at close</span>
            ) : state.nextChangeAtMs < state.phaseEndsAtMs ? (
              `next light in ${fmtTimer(state.nextChangeAtMs - live.now)}`
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function BoundaryLabel({ f, label, time }: { f: number; label: string; time: string }) {
  const [x, y] = polar(R - RW / 2 - 30, f)
  return (
    <g>
      <text x={x} y={y - 4} textAnchor="middle" fill="#71717a" fontSize={7.5} letterSpacing={2} fontFamily="JetBrains Mono, monospace">
        {label}
      </text>
      <text x={x} y={y + 10} textAnchor="middle" fill="#f4f4f5" fontSize={14} fontWeight={700} fontFamily="'Big Shoulders Display', sans-serif" letterSpacing={0.5}>
        {time}
      </text>
    </g>
  )
}

/** Small versions of Blast door's lamps. */
function MiniLamps({ lights, blackout }: { lights: Light[]; blackout: boolean }) {
  return (
    <div
      role="img"
      aria-label={lightsAria(lights)}
      className={`mx-auto mt-3 flex w-fit gap-1.5 rounded-lg border p-1.5 ${blackout ? 'alarm border-red-500/60' : 'border-white/10 bg-black/30'}`}
    >
      {lights.map((l, i) => (
        <div
          key={i}
          title={LIGHT_LABEL[l]}
          className={`relative h-7 w-3.5 overflow-hidden rounded-[5px] transition-all duration-700 sm:h-9 sm:w-4 ${
            l === 'green'
              ? 'bg-emerald-400 shadow-[0_0_14px_2px_rgb(52_211_153/0.55),inset_0_0_5px_rgb(255_255_255/0.5)]'
              : l === 'red'
                ? 'grille bg-red-600 shadow-[0_0_10px_1px_rgb(220_38_38/0.4)]'
                : 'border border-dashed border-zinc-600 bg-zinc-950'
          }`}
        >
          {l === 'green' && <div className="absolute inset-x-0.5 top-0.5 h-1/3 rounded-sm bg-white/35 blur-[1px]" />}
        </div>
      ))}
    </div>
  )
}

/* ---------- Timeline + plan (from Planner, restyled) ---------- */

/** Longest arrival you can pick on the timeline (its right edge). */
const TIMELINE_AHEAD_MIN = 12 * 60

function Timeline({
  live,
  cal,
  utc,
  travelMin,
  custom,
  onPick,
}: {
  live: Live
  cal: Calibration
  utc: boolean
  travelMin: number
  custom: boolean
  onPick: (travelMin: number) => void
}) {
  const track = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const { now } = live
  const from = now - HOUR
  const span = 13 * HOUR
  const x = (ms: number) => `${((ms - from) / span) * 100}%`
  const windows = live.windows.filter((w) => w.openAtMs < from + span)
  // include the window that closed within the visible past hour
  const prevOpen = (windows[0]?.openAtMs ?? now) - periodMs(cal)
  const shown = prevOpen + cal.openMs > from ? [{ openAtMs: prevOpen, closeAtMs: prevOpen + cal.openMs }, ...windows] : windows
  const ticks: number[] = []
  for (let h = Math.ceil(from / HOUR) * HOUR; h < from + span; h += HOUR) ticks.push(h)
  const arrive = now + travelMin * MIN
  const { skipped, closeCall } = planRun(live.windows, now, travelMin * MIN)
  const marker = skipped
    ? skipped.reason === 'blackout'
      ? { line: 'border-red-400', tag: 'bg-red-600 text-white', text: 'you arrive · blackout' }
      : { line: 'border-red-400', tag: 'bg-red-600 text-white', text: 'you arrive · too late' }
    : closeCall
      ? { line: 'border-amber-400', tag: 'bg-amber-400 text-black', text: 'you arrive · close call' }
      : { line: 'border-white/60', tag: 'bg-black/85 text-white', text: 'you arrive' }

  const clampTravel = (m: number) => Math.min(TIMELINE_AHEAD_MIN, Math.max(1, Math.round(m)))
  /** Travel minutes for a pointer x on the track. */
  const pickAt = (clientX: number) => {
    const el = track.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    onPick(clampTravel((from + frac * span - now) / MIN))
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 15 : 1
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? travelMin + step
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? travelMin - step
          : e.key === 'Home'
            ? 1
            : e.key === 'End'
              ? TIMELINE_AHEAD_MIN
              : null
    if (next === null) return
    e.preventDefault()
    onPick(clampTravel(next))
  }

  return (
    <section className="mt-4" aria-label="Next 12 hours">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">Next 12 hours</h2>
        <span className="flex items-center gap-3 text-xs text-zinc-400">
          <Legend className="bg-emerald-400" label="open" />
          <Legend className="bg-[repeating-linear-gradient(-45deg,#ef4444_0_3px,#0a0a0a_3px_6px)]" label="blackout" />
          <Legend className="bg-[repeating-linear-gradient(-45deg,#ffffff1f_0_3px,transparent_3px_6px)]" label="closed" />
        </span>
      </div>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Arrival time: click or drag to set when you reach the hangar"
        aria-valuemin={1}
        aria-valuemax={TIMELINE_AHEAD_MIN}
        aria-valuenow={travelMin}
        aria-valuetext={`Arrive in ${fmtSpan(travelMin * MIN)}`}
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          pickAt(e.clientX)
        }}
        onPointerMove={(e) => dragging.current && pickAt(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onKeyDown={onKeyDown}
        className="relative h-24 cursor-ew-resize touch-pan-y select-none overflow-hidden rounded-xl border border-zinc-800 bg-[repeating-linear-gradient(-45deg,#ffffff0a_0_6px,transparent_6px_12px)] outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
      >
        {shown.map((w) => (
          <div
            key={w.openAtMs}
            className="absolute inset-y-0 flex bg-emerald-400/90 shadow-[0_0_24px_rgb(52_211_153/0.35)]"
            style={{ left: x(w.openAtMs), width: `${(cal.openMs / span) * 100}%` }}
          >
            <div className="flex-1 overflow-hidden px-2 pt-1.5 font-door text-lg font-bold text-black/80">
              <ClientText live={live}>{() => fmtClock(w.openAtMs, utc)}</ClientText>
            </div>
            <div className="hazard h-full" style={{ width: `${(BLACKOUT_MS / cal.openMs) * 100}%`, animation: 'none' }} />
          </div>
        ))}
        <div className={`absolute inset-y-0 border-l-2 border-dashed ${marker.line}`} style={{ left: x(arrive) }}>
          <span
            className={`absolute bottom-1.5 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${marker.tag} ${
              (arrive - from) / span > 0.8 ? 'right-1' : 'left-1'
            }`}
          >
            {marker.text}
            {custom && <> · {fmtClock(arrive, utc)}</>}
          </span>
        </div>
        <div className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_10px_white]" style={{ left: x(now) }}>
          <span className="absolute -left-[3px] top-0 h-2 w-2 rounded-full bg-white" />
          <span className="absolute left-1.5 top-1 rounded bg-black/70 px-1 font-mono text-[10px] font-bold text-white">NOW</span>
        </div>
      </div>
      <div className="relative mt-1.5 h-4 font-mono text-[10px] text-zinc-500">
        {ticks.map((h, i) =>
          i % 2 === 0 ? (
            <span key={h} className="absolute -translate-x-1/2" style={{ left: x(h) }}>
              <ClientText live={live} fallback="">
                {() => fmtClock(h, utc)}
              </ClientText>
            </span>
          ) : null,
        )}
      </div>
    </section>
  )
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-4 rounded-sm ring-1 ring-white/10 ${className}`} />
      {label}
    </span>
  )
}

function Plan({
  live,
  utc,
  travelMin,
  custom,
  onPreset,
}: {
  live: Live
  utc: boolean
  travelMin: number
  custom: boolean
  onPreset: (n: number) => void
}) {
  const travelMs = travelMin * MIN
  const { target, info, skipped, closeCall, blackoutAtMs } = planRun(live.windows, live.now, travelMs)
  const t = (ms: number) => <ClientText live={live}>{() => fmtClock(ms, utc)}</ClientText>
  const urgent = target && info && (target.current || info.leaveBy - live.now < HOUR)

  return (
    <section className="mt-8 grid gap-6 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6 backdrop-blur sm:grid-cols-[1fr_1.3fr] sm:p-8">
      <div>
        <h2 className="text-2xl font-semibold uppercase tracking-[0.08em]">Can I make it?</h2>
        <p className="mt-2 text-sm text-zinc-400">How long until you can be at the hangar door, compboards in hand?</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {TRAVEL_OPTIONS.map((m) => (
            <button
              key={m}
              onClick={() => onPreset(m)}
              className={`rounded-full px-3.5 py-1.5 font-mono text-sm transition-all ${
                !custom && travelMin === m
                  ? 'bg-emerald-400 text-black shadow-[0_0_18px_rgb(52_211_153/0.5)]'
                  : 'bg-white/5 text-zinc-300 ring-1 ring-white/10 hover:bg-white/10'
              }`}
            >
              {travelLabel(m)}
            </button>
          ))}
          {custom && (
            <span
              className="rounded-full bg-emerald-400 px-3.5 py-1.5 font-mono text-sm text-black shadow-[0_0_18px_rgb(52_211_153/0.5)]"
              title="Picked on the timeline"
            >
              Custom · {travelLabel(travelMin)}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col justify-center border-zinc-800 sm:border-l sm:pl-8">
        {skipped && (
          <div className="mb-5 flex gap-3 rounded-lg border border-red-500/50 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-200">
            <span className="font-mono font-bold text-red-400">
              {skipped.reason === 'blackout' ? '☠' : '!'}
            </span>
            <span>
              <b className="font-semibold">
                Skip the {t(skipped.window.openAtMs)}–{t(skipped.window.closeAtMs)} window.
              </b>{' '}
              {skipped.reason === 'blackout' ? (
                <>
                  You'd arrive at {t(live.now + travelMs)}, after blackout starts at {t(skipped.blackoutAtMs)}.
                  Anyone still inside at {t(skipped.window.closeAtMs)} is killed.
                </>
              ) : (
                <>
                  You'd arrive at {t(live.now + travelMs)}, only {fmtSpan(skipped.insideMs)} before blackout at{' '}
                  {t(skipped.blackoutAtMs)}: too late to get in and out.
                </>
              )}
            </span>
          </div>
        )}
        {closeCall && info && blackoutAtMs && (
          <div className="mb-5 flex gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-100">
            <span className="font-mono font-bold text-amber-400">!</span>
            <span>
              <b className="font-semibold">It will be close.</b> You'd only have {fmtSpan(info.inside)} inside before
              blackout at {t(blackoutAtMs)}. Move fast and be out before then.
            </span>
          </div>
        )}
        {target && info ? (
          <>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
              {target.current ? 'This window' : skipped ? 'Go for the next one' : 'Your window'}
            </div>
            <div className="mt-1 font-door text-5xl font-bold tracking-wide sm:text-6xl">
              {t(target.openAtMs)} <span className="text-zinc-600">→</span> {t(target.closeAtMs)}
            </div>
            <p className="mt-3 text-zinc-300">
              Arrive at <b className="text-white">{t(info.arrive)}</b>
              {info.arrive < target.openAtMs
                ? `, about ${fmtSpan(target.openAtMs - info.arrive)} before it opens.`
                : ', while it is open.'}{' '}
              You'd have <b className={closeCall ? 'text-amber-300' : 'text-emerald-300'}>{fmtSpan(info.inside)}</b> inside
              before blackout.
            </p>
            {urgent && (
              <p className="mt-2 text-sm font-medium text-amber-300">
                {info.leaveBy > live.now ? `Leave within ${fmtSpan(info.leaveBy - live.now)}.` : 'Leave now.'}
              </p>
            )}
          </>
        ) : (
          <p className="text-zinc-400">No window in the next 24 h fits that travel time.</p>
        )}
      </div>
    </section>
  )
}

function TrustChip({ status }: { status: keyof typeof TRUST }) {
  const t = TRUST[status]
  const cls = {
    good: 'border-emerald-500/40 text-emerald-300',
    neutral: 'border-zinc-700 text-zinc-300',
    info: 'border-sky-500/40 text-sky-300',
    warn: 'border-amber-500/60 bg-amber-500/10 text-amber-300',
    none: 'border-zinc-700 text-zinc-500',
  }[t.tone]
  const icon = { good: '✓', neutral: '◇', info: '↻', warn: '!', none: '—' }[t.tone]
  return (
    <span className={`rounded-full border px-2.5 py-1 ${cls}`} title={t.detail}>
      <span className="mr-1 font-mono">{icon}</span>
      {t.label}
    </span>
  )
}
