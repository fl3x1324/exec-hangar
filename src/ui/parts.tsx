import { useState } from 'react'
import { useLoaderData, useNavigate, useSearch } from '@tanstack/react-router'
import type { Light } from '#/core/cycle'
import { FIXTURE_NAMES } from './fixtures'
import { fmtDateTime, fmtRel, fmtSpan } from './format'
import { useHangar, type Live } from './live'
import { TRUST } from './trust'

/** The live hangar clock, bound to the root loader data and preview search params. */
export function useLive(): Live {
  const { report, fixture } = useLoaderData({ from: '__root__' })
  const { speed } = useSearch({ from: '__root__' })
  // Time-warp is a dev preview tool; always real time in production.
  const warp = import.meta.env.DEV && typeof speed === 'number' && speed > 1 && speed <= 3600 ? speed : 1
  return useHangar(report, { preview: fixture !== null, speed: warp })
}

/**
 * Fixed-width digits so a countdown never jitters, whatever the font.
 * Colons/separators get a narrower box.
 */
export function Digits({
  text,
  className,
  sepClassName,
  digitWidth = 0.62,
}: {
  text: string
  className?: string
  sepClassName?: string
  /** Width of each digit box in em; tune for condensed fonts. */
  digitWidth?: number
}) {
  return (
    <span className={className} aria-hidden>
      {[...text].map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={i} className="inline-block text-center" style={{ width: `${digitWidth}em` }}>
            {ch}
          </span>
        ) : (
          <span key={i} className={sepClassName ?? 'inline-block w-[0.32em] text-center'}>
            {ch}
          </span>
        ),
      )}
    </span>
  )
}

/** Timezone-dependent text: rendered on the client only to avoid SSR mismatch. */
export function ClientText({ live, children, fallback = '--:--' }: { live: Live; children: () => string; fallback?: string }) {
  return <span suppressHydrationWarning>{live.hydrated ? children() : fallback}</span>
}

export const LIGHT_LABEL: Record<Light, string> = { green: 'lit', red: 'waiting', off: 'dark' }

export function lightsAria(lights: Light[]): string {
  return `Hangar lights, left to right: ${lights.map((l) => LIGHT_LABEL[l]).join(', ')}`
}

export type DetailsTheme = {
  root?: string
  heading?: string
  row?: string
  key?: string
  value?: string
  muted?: string
  good?: string
  bad?: string
}

/** Secondary data: calibration basis, sources, helper. Styled by the caller. */
export function Details({ live, utc, theme: t }: { live: Live; utc: boolean; theme: DetailsTheme }) {
  const { report, now } = live
  const c = report.calibration
  const lastObs = c.observations.at(-1)
  const when = (ms: number | null) => (ms == null ? '—' : live.hydrated ? `${fmtDateTime(ms, utc)} (${fmtRel(ms - now)})` : '…')
  const sourceName = (id: string) => (id === 'elevator' ? 'In-game data (elevator)' : id)

  return (
    <div className={t.root}>
      <section>
        <h3 className={t.heading}>Timer basis</h3>
        <dl>
          <Row t={t} k="Status" v={TRUST[c.status].label} />
          <Row t={t} k="Anchored on" v={c.basis ? sourceName(c.basis) : '—'} />
          {c.calibration && (
            <Row
              t={t}
              k="Cycle"
              v={`${fmtSpan(c.calibration.openMs)} open · ${fmtSpan(c.calibration.closeMs)} closed`}
            />
          )}
          {lastObs && (
            <Row
              t={t}
              k="Last in-game close"
              v={`${when(lastObs.atMs)} · ${lastObs.agrees ? 'matches trackers' : `off by ${fmtSpan(lastObs.residualMs ?? 0)}`}`}
            />
          )}
        </dl>
        {c.notes.length > 0 && (
          <ul className={t.muted}>
            {c.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className={t.heading}>Community trackers</h3>
        <dl>
          {report.sources.map((s) => (
            <Row
              key={s.id}
              t={t}
              k={s.id}
              v={
                <>
                  <span className={s.ok ? t.good : t.bad}>{s.ok ? '● online' : `● ${s.error ?? 'error'}`}</span>
                  {s.fetchedAt && <span className={t.muted}> · fetched {when(s.fetchedAt)}</span>}
                </>
              }
            />
          ))}
        </dl>
      </section>
      <section>
        <h3 className={t.heading}>In-game helper</h3>
        <dl>
          <Row t={t} k="Last report" v={when(report.helper.lastEventAt)} />
          <Row t={t} k="Game build" v={report.helper.lastClientBuild ?? '—'} />
          <Row t={t} k="Shard" v={report.helper.lastShard ?? '—'} />
        </dl>
      </section>
    </div>
  )
}

function Row({ t, k, v }: { t: DetailsTheme; k: string; v: React.ReactNode }) {
  return (
    <div className={t.row}>
      <dt className={t.key}>{k}</dt>
      <dd className={t.value}>{v}</dd>
    </div>
  )
}

const SPEEDS = [1, 60, 600]

/** Dev-only toolbar: preview fixtures and time-warp. */
export function PreviewBar() {
  const [open, setOpen] = useState(true)
  const search = useSearch({ from: '__root__' })
  const navigate = useNavigate()

  const btn = 'rounded-md px-2 py-1 transition-colors'
  const on = 'bg-white text-black'
  const offc = 'text-white/70 hover:bg-white/10 hover:text-white'

  return (
    <div className="fixed bottom-3 left-3 z-50 font-[JetBrains_Mono] text-[11px] text-white">
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-white/15 bg-black/80 p-1 shadow-2xl backdrop-blur-md">
        <button className={`${btn} ${offc}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Toggle preview bar">
          {open ? '◂' : '▸ preview'}
        </button>
        {open && (
          <>
            <select
              aria-label="Data source"
              className="rounded-md bg-white/10 px-1.5 py-1 text-white outline-none"
              value={search.fx ?? ''}
              onChange={(e) => navigate({ to: '.', search: { ...search, fx: e.target.value || undefined } })}
            >
              <option value="">live data</option>
              {FIXTURE_NAMES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            {SPEEDS.map((s) => (
              <button
                key={s}
                className={`${btn} ${(search.speed ?? 1) === s ? on : offc}`}
                onClick={() => navigate({ to: '.', search: { ...search, speed: s === 1 ? undefined : s } })}
                title={s === 1 ? 'Real time' : `Time-warp ×${s}`}
              >
                {s}×
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
