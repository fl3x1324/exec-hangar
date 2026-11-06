import { createFileRoute } from '@tanstack/react-router'
import { validateBatch } from '#/core/protocol'
import { addEvents } from '#/server/store.server'
import { ingestConfigured, verifyToken } from '#/server/tokens.server'

const MAX_BODY_BYTES = 256 * 1024

/** Ingest endpoint for the Windows log helper. */
export const Route = createFileRoute('/api/events')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
        const tokenId = await verifyToken(bearer)
        if (!tokenId) {
          if (!(await ingestConfigured()))
            return Response.json({ error: 'no helper tokens configured on server' }, { status: 503 })
          return Response.json({ error: 'unauthorized' }, { status: 401 })
        }

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
            tokenId,
          })),
        )
        return Response.json({ accepted: batch.events.length, added })
      },
    },
  },
})
