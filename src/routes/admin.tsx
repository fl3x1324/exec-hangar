import { createFileRoute } from '@tanstack/react-router'
import { getAdminState } from '#/ui/admin.functions'
import { AdminPage } from '#/ui/AdminPage'

export const Route = createFileRoute('/admin')({
  head: () => ({
    meta: [{ title: 'Admin · Exec Hangar Timer' }, { name: 'robots', content: 'noindex' }],
  }),
  loader: () => getAdminState(),
  component: AdminRoute,
})

function AdminRoute() {
  return <AdminPage state={Route.useLoaderData()} />
}
