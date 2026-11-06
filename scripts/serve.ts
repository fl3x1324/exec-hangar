/**
 * Production server: serves the built client assets from dist/client and hands
 * everything else (SSR pages, /api/*) to the TanStack Start handler.
 *
 *   bun run build && bun run start
 *
 * Env: PORT (default 3000), HOST (default 0.0.0.0), plus the app's own
 * HELPER_TOKEN and DATA_DIR.
 */
import { stat } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'

const root = join(import.meta.dir, '..')
const clientDir = join(root, 'dist', 'client')
const { default: app } = (await import(join(root, 'dist', 'server', 'server.js'))) as {
  default: { fetch: (req: Request) => Response | Promise<Response> }
}

/** A file under dist/client for this URL path, or null (never escapes clientDir). */
async function staticFile(pathname: string): Promise<string | null> {
  let rel: string
  try {
    rel = normalize(decodeURIComponent(pathname))
  } catch {
    return null
  }
  const path = join(clientDir, rel)
  if (!path.startsWith(clientDir + sep)) return null
  const s = await stat(path).catch(() => null)
  return s?.isFile() ? path : null
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  hostname: process.env.HOST ?? '0.0.0.0',
  async fetch(req) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const { pathname } = new URL(req.url)
      const file = await staticFile(pathname)
      if (file) {
        // Hashed build assets never change; cache them for a year.
        const immutable = pathname.startsWith('/assets/')
        return new Response(Bun.file(file), {
          headers: { 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300' },
        })
      }
    }
    return app.fetch(req)
  },
})

console.log(`exec-hangars listening on http://${server.hostname}:${server.port}`)

// Exit promptly on `docker stop` (PID 1 gets no default signal handling).
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => process.exit(0))
