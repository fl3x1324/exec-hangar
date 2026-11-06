import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { DEFAULT_GAME_LOG, HELPER_DOWNLOAD_URL, HELPER_GUIDE_URL, HELPER_SHA256_URL, RELEASES_URL } from './links'

/**
 * /helper: download and setup guide for the Windows helper, in the timer's
 * visual language. Mirrors docs/HELPER.md (which ships with each release);
 * keep the two in sync.
 */
export function HelperPage() {
  // This page is served by the timer server itself, so its origin is the "server" setting.
  const [origin, setOrigin] = useState<string | null>(null)
  useEffect(() => setOrigin(window.location.origin), [])

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#060708] font-chakra text-zinc-100">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(90% 45% at 50% 0%, rgb(16 185 129 / 0.22), transparent 70%)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(rgb(255 255 255 / .5) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / .5) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(70% 40% at 50% 15%, black, transparent)',
        }}
      />

      <div className="relative mx-auto max-w-4xl px-4 pb-28 pt-5 sm:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">Pyro · PYAM-EXHANG-0-1</div>
            <div className="text-lg font-semibold uppercase tracking-[0.12em]">Executive Hangar</div>
          </div>
          <Link
            to="/"
            className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-500"
          >
            ← Back to the timer
          </Link>
        </header>

        {/* Hero */}
        <section className="pt-14 text-center sm:pt-20">
          <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-emerald-400">Windows helper</div>
          <h1 className="mt-3 font-door text-5xl font-black uppercase tracking-[0.08em] sm:text-7xl">Help keep the timer exact</h1>
          <p className="mx-auto mt-5 max-w-2xl text-zinc-300">
            The helper watches your Star Citizen game log while you play. When the executive hangar closes near you, it
            reports the exact moment, so the timer stays accurate for everyone, even right after a patch resets the
            cycle. It sits quietly in the notification area and never touches the game.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href={HELPER_DOWNLOAD_URL}
              className="rounded-full bg-emerald-400 px-6 py-3 font-semibold uppercase tracking-[0.1em] text-black shadow-[0_0_28px_rgb(52_211_153/0.5)] transition hover:bg-emerald-300"
            >
              Download for Windows
            </a>
            <a href={RELEASES_URL} className="rounded-full px-4 py-3 text-sm text-zinc-300 ring-1 ring-white/10 hover:bg-white/5">
              All releases
            </a>
          </div>
          <p className="mt-3 font-mono text-[11px] text-zinc-500">
            exec-hangars-helper.exe · Windows 10/11 ·{' '}
            <a href={HELPER_SHA256_URL} className="underline decoration-zinc-700 underline-offset-2 hover:text-zinc-300">
              SHA-256
            </a>
          </p>
        </section>

        {/* Steps */}
        <ol className="mt-16 space-y-4">
          <Step n={1} title="Put it in its own folder">
            <p>
              For example <Code>Documents\Exec Hangar helper</Code>. The helper keeps its settings file next to the .exe,
              so avoid <Code>Downloads</Code> (gets cleaned up) and <Code>Program Files</Code> (not writable).
            </p>
          </Step>

          <Step n={2} title="Start it">
            <p>Double-click the .exe. Windows may warn you because the program isn't code-signed:</p>
            <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
              <b>"Windows protected your PC"</b>: click <b>More info</b>, then <b>Run anyway</b>. Needed once per version.
            </div>
            <p className="mt-3">
              On the first start it creates <Code>exec-hangars-helper.json</Code> next to the .exe and opens it.
            </p>
          </Step>

          <Step n={3} title="Fill in the settings">
            <Settings origin={origin} />
          </Step>

          <Step n={4} title="Start it again and check the icon">
            <p>
              Look for the round icon in the notification area, bottom-right. Not there? Click the <b>^</b> arrow next to
              the clock (drag the icon onto the taskbar to keep it visible).
            </p>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              <Status color="bg-emerald-400" label="Green" text="Connected and watching the game log. All good." />
              <Status color="bg-amber-500" label="Amber" text="Connecting, or waiting for the game. Start Star Citizen." />
              <Status color="bg-red-500" label="Red" text="Can't reach the timer server. Keeps retrying." />
              <Status color="bg-zinc-400" label="Grey" text="Paused by you." />
            </ul>
            <p className="mt-3 text-sm text-zinc-400">Hover the icon for details. Left-click opens this timer.</p>
          </Step>

          <Step n={5} title="Start with Windows (optional)">
            <p>
              Right-click the icon and tick <b>Start with Windows</b>. It then starts when you sign in, so you never have
              to remember it.
            </p>
          </Step>
        </ol>

        {/* Menu */}
        <Card title="The tray menu" className="mt-12">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[11rem_1fr]">
            <MenuRow k="Open hangar timer" v="This website." />
            <MenuRow k="Open log file" v="What the helper has been doing. Useful when something's wrong." />
            <MenuRow k="Open settings file" v="Edit the settings. Quit and start the helper again to apply." />
            <MenuRow k="Pause reporting" v="Stop reading the game log. Anything that happens while paused is skipped." />
            <MenuRow k="Start with Windows" v="On / off." />
            <MenuRow k="Quit" v="Stops the helper." />
          </dl>
        </Card>

        {/* Troubleshooting */}
        <Card title="Troubleshooting" className="mt-6">
          <div className="divide-y divide-zinc-800/80">
            <Faq q='"The server rejected the token"'>
              The token is wrong or was changed. Get the current one, update the settings file, start again.
            </Faq>
            <Faq q='"The helper is already running"'>
              It's already in the notification area (check behind the <b>^</b> arrow). Only one copy runs at a time.
            </Faq>
            <Faq q="Stuck on amber while playing">
              The <Code>log</Code> path is wrong. In the RSI Launcher check where Star Citizen is installed, and point{' '}
              <Code>log</Code> at <Code>...\StarCitizen\LIVE\Game.log</Code>.
            </Faq>
            <Faq q="Red icon">
              The <Code>server</Code> address is wrong, the site is down, or a firewall blocks the helper. Open the
              address in your browser to check.
            </Faq>
            <Faq q="Something else">
              Right-click → <b>Open log file</b>. It lives at <Code>%LOCALAPPDATA%\exec-hangars\helper.log</Code>.
            </Faq>
          </div>
        </Card>

        {/* Privacy */}
        <Card title="Privacy: what it reads and sends" className="mt-6">
          <div className="space-y-3 text-sm text-zinc-300">
            <p>
              It only <b>reads</b> <Code>Game.log</Code>, the text log Star Citizen writes anyway. It never reads or
              changes game memory or files, and never sends keystrokes. From that log it sends only:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-zinc-400">
              <li>executive hangar elevator movements (how the closing time is measured)</li>
              <li>entering or leaving the executive hangar (other locations are never sent)</li>
              <li>game version, server build and server (shard) ID, to tell patches and servers apart</li>
            </ul>
            <p className="text-zinc-400">
              Plus an anonymous helper ID (a scrambled code derived from your computer's name), its version, and how far
              your PC clock is off. Never your player name, chat, or anything else from the log.
            </p>
          </div>
        </Card>

        {/* Uninstall */}
        <Card title="Uninstall" className="mt-6">
          <p className="text-sm text-zinc-300">
            Right-click the icon, untick <b>Start with Windows</b>, click <b>Quit</b>, then delete the helper's folder (and
            optionally <Code>%LOCALAPPDATA%\exec-hangars</Code>, its log).
          </p>
        </Card>

        <p className="mt-8 text-center text-xs text-zinc-500">
          Same guide on GitHub:{' '}
          <a href={HELPER_GUIDE_URL} className="underline decoration-zinc-700 underline-offset-2 hover:text-zinc-300">
            docs/HELPER.md
          </a>
        </p>
      </div>
    </div>
  )
}

function Settings({ origin }: { origin: string | null }) {
  const [copied, setCopied] = useState(false)
  const server = origin ?? 'https://…'
  const json = `${JSON.stringify({ server, token: 'paste-the-token-here', log: DEFAULT_GAME_LOG }, null, 2)}\n`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(server)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'exec-hangars-helper.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="space-y-4">
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="font-semibold text-zinc-100">server</dt>
          <dd className="mt-1 flex flex-wrap items-center gap-2 text-zinc-400">
            This site's address:
            <span className="rounded bg-black/50 px-2 py-0.5 font-mono text-emerald-300 ring-1 ring-white/10">{server}</span>
            <button
              onClick={copy}
              disabled={!origin}
              className="rounded-full px-2.5 py-0.5 font-mono text-xs text-zinc-300 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-40"
            >
              {copied ? 'copied' : 'copy'}
            </button>
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-zinc-100">token</dt>
          <dd className="mt-1 text-zinc-400">Ask whoever runs this site. Keep it to yourself.</dd>
        </div>
        <div>
          <dt className="font-semibold text-zinc-100">log</dt>
          <dd className="mt-1 text-zinc-400">
            Only change it if Star Citizen is installed elsewhere: point it at <Code>Game.log</Code> in your{' '}
            <Code>StarCitizen\LIVE</Code> folder, with double backslashes (<Code>\\</Code>).
          </dd>
        </div>
      </dl>
      <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-black/50 p-4 font-mono text-xs leading-relaxed text-zinc-300">
        {json}
      </pre>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={download}
          disabled={!origin}
          className="rounded-full bg-white/5 px-4 py-2 font-mono text-sm text-zinc-200 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-40"
        >
          Download settings file
        </button>
        <span className="text-xs text-zinc-500">
          Server already filled in. Put it next to the .exe (replace the one it created) and add the token.
        </span>
      </div>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid gap-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 backdrop-blur sm:grid-cols-[3.5rem_1fr] sm:p-6">
      <div className="font-door text-5xl font-black leading-none text-emerald-400/90">{n}</div>
      <div className="text-zinc-300">
        <h2 className="mb-2 text-lg font-semibold uppercase tracking-[0.08em] text-zinc-100">{title}</h2>
        {children}
      </div>
    </li>
  )
}

function Card({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 backdrop-blur sm:p-6 ${className ?? ''}`}>
      <h2 className="mb-4 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">{title}</h2>
      {children}
    </section>
  )
}

function Status({ color, label, text }: { color: string; label: string; text: string }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-black/30 px-3 py-2.5 text-sm">
      <span className={`mt-0.5 inline-block h-4 w-4 shrink-0 rounded-full ring-1 ring-black/60 ${color}`} aria-hidden />
      <span>
        <b className="text-zinc-100">{label}</b> <span className="text-zinc-400">{text}</span>
      </span>
    </li>
  )
}

function MenuRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="font-semibold text-zinc-100">{k}</dt>
      <dd className="text-zinc-400">{v}</dd>
    </>
  )
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group py-3 first:pt-0 last:pb-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-zinc-100">
        {q}
        <span className="text-zinc-500 transition-transform group-open:rotate-90">›</span>
      </summary>
      <p className="mt-2 text-sm text-zinc-400">{children}</p>
    </details>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-200">{children}</code>
}
