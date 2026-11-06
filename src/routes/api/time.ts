import { createFileRoute } from '@tanstack/react-router'

/** Clock reference for helpers and browsers (NTP-style offset estimation). */
export const Route = createFileRoute('/api/time')({
  server: {
    handlers: {
      GET: () =>
        Response.json({ serverTimeMs: Date.now() }, { headers: { 'cache-control': 'no-store' } }),
    },
  },
})
