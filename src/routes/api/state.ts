import { createFileRoute } from '@tanstack/react-router'
import { getHangarReport } from '#/server/hangar.server'

export const Route = createFileRoute('/api/state')({
  server: {
    handlers: {
      GET: async () =>
        Response.json(await getHangarReport(), { headers: { 'cache-control': 'no-store' } }),
    },
  },
})
