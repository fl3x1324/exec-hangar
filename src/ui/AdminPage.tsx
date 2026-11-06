import { useEffect, useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import {
  adminLogin,
  adminLogout,
  createHelperToken,
  purgeTokenEvents,
  revokeHelperToken,
  type AdminState,
  type AdminToken,
} from './admin.functions'
import { fmtRel } from './format'
import { downloadText, helperSettingsJson, SETTINGS_FILENAME } from './helperSettings'

/** /admin: mint, list and revoke per-player helper tokens. */
export function AdminPage({ state }: { state: AdminState }) {
  const router = useRouter()
  const logout = useServerFn(adminLogout)
  const authed = state.configured && state.authed

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#060708] font-chakra text-zinc-100">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(90% 40% at 50% 0%, rgb(245 158 11 / 0.14), transparent 70%)' }}
      />
      <div className="relative mx-auto max-w-4xl px-4 pb-28 pt-5 sm:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">Exec Hangar · admin</div>
            <div className="text-lg font-semibold uppercase tracking-[0.12em]">Helper tokens</div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Link to="/" className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-300 hover:border-zinc-500">
              ← Timer
            </Link>
            {authed && (
              <button
                onClick={async () => {
                  await logout()
                  await router.invalidate()
                }}
                className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-300 hover:border-zinc-500"
              >
                Sign out
              </button>
            )}
          </div>
        </header>

        <div className="mt-10">
          {!state.configured ? (
            <NotConfigured />
          ) : !state.authed ? (
            <Login onDone={() => router.invalidate()} />
          ) : (
            <Tokens tokens={state.tokens} onChange={() => router.invalidate()} />
          )}
        </div>
      </div>
    </div>
  )
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 backdrop-blur sm:p-6 ${className ?? ''}`}>
      <h2 className="mb-4 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">{title}</h2>
      {children}
    </section>
  )
}

const input =
  'w-full rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500/70'
const primary =
  'rounded-full bg-emerald-400 px-5 py-2 text-sm font-semibold uppercase tracking-[0.08em] text-black shadow-[0_0_18px_rgb(52_211_153/0.4)] hover:bg-emerald-300 disabled:opacity-50'
const ghost = 'rounded-full px-3 py-1 text-xs ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-40'

function NotConfigured() {
  return (
    <Card title="Admin is off">
      <p className="text-sm text-zinc-300">
        Set <Code>ADMIN_TOKEN</Code> on the server (a long random string, e.g. in <Code>.env</Code> next to{' '}
        <Code>compose.yaml</Code>) and restart it. That value is the password for this page.
      </p>
    </Card>
  )
}

function Login({ onDone }: { onDone: () => void }) {
  const login = useServerFn(adminLogin)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Card title="Sign in" className="mx-auto max-w-md">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          try {
            const res = await login({ data: { password } })
            if (res.ok) onDone()
            else setError('Wrong password.')
          } catch {
            setError('Could not reach the server.')
          } finally {
            setBusy(false)
          }
        }}
      >
        <label className="block text-sm text-zinc-400">
          Admin password (the server's <Code>ADMIN_TOKEN</Code>)
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`mt-1.5 ${input}`}
          />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={busy || !password} className={primary}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </Card>
  )
}

function Tokens({ tokens, onChange }: { tokens: AdminToken[]; onChange: () => void }) {
  const create = useServerFn(createHelperToken)
  const revoke = useServerFn(revokeHelperToken)
  const purge = useServerFn(purgeTokenEvents)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [minted, setMinted] = useState<{ name: string; token: string } | null>(null)
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => setNow(Date.now()), [tokens])

  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // revokedAt 0 = the shared token, switched off on the server but with reports left.
  const active = tokens.filter((t) => t.revokedAt === null)
  const revoked = tokens.filter((t) => t.revokedAt !== null)

  return (
    <div className="space-y-6">
      <Card title="Add a player">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError(null)
            try {
              const res = await create({ data: { name } })
              setMinted(res)
              setName('')
              onChange()
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err))
            } finally {
              setBusy(false)
            }
          }}
        >
          <label className="min-w-[14rem] flex-1 text-sm text-zinc-400">
            Name (so you know whose it is)
            <input
              value={name}
              maxLength={40}
              placeholder="e.g. Alex"
              onChange={(e) => setName(e.target.value)}
              className={`mt-1.5 ${input}`}
            />
          </label>
          <button type="submit" disabled={busy || !name.trim()} className={primary}>
            {busy ? 'Creating…' : 'Create token'}
          </button>
        </form>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {minted && <Minted {...minted} onClose={() => setMinted(null)} />}
      </Card>

      <Card title={`Active tokens · ${active.length}`}>
        {active.length === 0 ? (
          <p className="text-sm text-zinc-500">No active tokens yet. Create one above for each player.</p>
        ) : (
          <TokenList
            tokens={active}
            now={now}
            onRevoke={(t, alsoPurge) =>
              act(() => revoke({ data: { id: t.id, purge: alsoPurge } }))
            }
            onPurge={(t) => act(() => purge({ data: { id: t.id } }))}
          />
        )}
      </Card>

      {revoked.length > 0 && (
        <Card title={`Revoked · ${revoked.length}`}>
          <TokenList tokens={revoked} now={now} onPurge={(t) => act(() => purge({ data: { id: t.id } }))} />
        </Card>
      )}
    </div>
  )
}

function Minted({ name, token, onClose }: { name: string; token: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const server = typeof window === 'undefined' ? '' : window.location.origin
  return (
    <div className="mt-5 rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-emerald-100">
          <b>Token for {name}.</b> Shown only this once: send it now.
        </p>
        <button onClick={onClose} className="text-xs text-emerald-200/70 hover:text-emerald-100">
          Done
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="break-all rounded bg-black/50 px-2 py-1 font-mono text-sm text-emerald-300 ring-1 ring-white/10">{token}</code>
        <button
          className={`${ghost} text-zinc-200`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(token)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            } catch {
              /* clipboard unavailable */
            }
          }}
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => downloadText(SETTINGS_FILENAME, helperSettingsJson(server, token))}
          className="rounded-full bg-white/10 px-4 py-2 font-mono text-sm text-zinc-100 ring-1 ring-white/15 hover:bg-white/15"
        >
          Download {SETTINGS_FILENAME}
        </button>
        <span className="text-xs text-zinc-400">
          Server and token filled in. The player puts it next to the .exe. Setup guide:{' '}
          <Link to="/helper" className="underline decoration-zinc-600 underline-offset-2">
            /helper
          </Link>
        </span>
      </div>
    </div>
  )
}

function TokenList({
  tokens,
  now,
  onRevoke,
  onPurge,
}: {
  tokens: AdminToken[]
  now: number | null
  onRevoke?: (t: AdminToken, alsoPurge: boolean) => void
  onPurge: (t: AdminToken) => void
}) {
  const rel = (ms: number | null) => (ms == null || ms === 0 ? 'never' : now === null ? '…' : fmtRel(ms - now))
  return (
    <ul className="divide-y divide-zinc-800/80">
      {tokens.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="truncate font-semibold">{t.name}</span>
              {t.hint && <span className="font-mono text-xs text-zinc-500">…{t.hint}</span>}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-4 font-mono text-[11px] text-zinc-500">
              {t.createdAt ? <span>created {rel(t.createdAt)}</span> : null}
              {t.revokedAt ? <span className="text-red-400/80">revoked {rel(t.revokedAt)}</span> : null}
              <span>last used {rel(t.lastUsedAt)}</span>
              <span>
                {t.events} report{t.events === 1 ? '' : 's'}
              </span>
            </div>
            {t.legacy && (
              <div className="mt-1 text-[11px] text-zinc-500">
                Set by <Code>HELPER_TOKEN</Code> on the server. Remove it there to switch it off.
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {onRevoke && !t.legacy && (
              <>
                <button
                  className={`${ghost} text-amber-300`}
                  onClick={() => confirm(`Revoke ${t.name}'s token? Their helper stops being accepted.`) && onRevoke(t, false)}
                >
                  Revoke
                </button>
                <button
                  className={`${ghost} text-red-300`}
                  disabled={t.events === 0}
                  onClick={() =>
                    confirm(
                      `Revoke ${t.name}'s token AND delete their ${t.events} report(s)? The timer recalculates without them. This can't be undone.`,
                    ) && onRevoke(t, true)
                  }
                >
                  Revoke + delete reports
                </button>
              </>
            )}
            {(!onRevoke || t.legacy) && (
              <button
                className={`${ghost} text-red-300`}
                disabled={t.events === 0}
                onClick={() =>
                  confirm(`Delete ${t.name}'s ${t.events} report(s)? The timer recalculates without them. This can't be undone.`) &&
                  onPurge(t)
                }
              >
                Delete reports
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-200">{children}</code>
}
