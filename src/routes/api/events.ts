import { createFileRoute } from '@tanstack/react-router'
import { timingSafeEqual } from 'node:crypto'
import { validateBatch } from '#/core/protocol'
import { addEvents } from '#/server/store.server'

const MAX_BODY_BYTES = 256 * 1024

function authorized(request: Request): boolean | null {
  const token = process.env.HELPER_TOKEN
  if (!token) return null
  const got = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const a = Buffer.from(got)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Ingest endpoint for the Windows log helper. */
export const Route = createFileRoute('/api/events')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = authorized(request)
        if (auth === null) return Response.json({ error: 'HELPER_TOKEN not configured on server' }, { status: 503 })
        if (!auth) return Response.json({ error: 'unauthorized' }, { status: 401 })

        const text = await request.text()
        if (text.length > MAX_BODY_BYTES) return Response.json({ error: 'too large' }, { status: 413 })
        let body: unknown
        try {
          body = JSON.parse(text)
        } catch {
          return Response.json({ error: 'invalid JSON' }, { status: 400 })
        }
        const batch = validateBatch(body)
        if (!batch) return Response.json({ error: 'invalid batch' }, { status: 400 })

        const receivedAt = Date.now()
        const added = await addEvents(
          batch.events.map((event) => ({
            event,
            receivedAt,
            clockOffsetMs: batch.clockOffsetMs,
            helperId: batch.helperId,
          })),
        )
        return Response.json({ accepted: batch.events.length, added })
      },
    },
  },
})
