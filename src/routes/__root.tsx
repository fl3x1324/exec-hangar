import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { FIXTURES } from '#/ui/fixtures'
import { fetchHangarReport } from '#/ui/hangar.functions'
import { PreviewBar } from '#/ui/parts'

import appCss from '../styles.css?url'

/** Dev-only preview params; ignored in production builds. */
type RootSearch = {
  /** Preview a docs/fixtures/<fx>.json report instead of live data. */
  fx?: string
  /** Time-warp factor for previews (1 = real time). */
  speed?: number
}

export const Route = createRootRoute({
  validateSearch: (s: Record<string, unknown>): RootSearch =>
    import.meta.env.DEV
      ? {
          fx: typeof s.fx === 'string' && s.fx in FIXTURES ? s.fx : undefined,
          speed: typeof s.speed === 'number' && s.speed > 1 && s.speed <= 3600 ? s.speed : undefined,
        }
      : {},
  // Re-check here: the router passes unvalidated params through to search.
  loaderDeps: ({ search }) => ({
    fx: import.meta.env.DEV && typeof search.fx === 'string' && search.fx in FIXTURES ? search.fx : undefined,
  }),
  loader: async ({ deps }) =>
    deps.fx
      ? { report: FIXTURES[deps.fx], fixture: deps.fx }
      : { report: await fetchHangarReport(), fixture: null },
  staleTime: Infinity,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Exec Hangar Timer · PYAM-EXHANG-0-1' },
      { name: 'description', content: 'Live open/close timer for the Pyro executive hangar.' },
    ],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;900&family=Chakra+Petch:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap',
      },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        {import.meta.env.DEV && <PreviewBar />}
        <TanStackDevtools
          config={{ position: 'bottom-right' }}
          plugins={[{ name: 'Tanstack Router', render: <TanStackRouterDevtoolsPanel /> }]}
        />
        <Scripts />
      </body>
    </html>
  )
}
