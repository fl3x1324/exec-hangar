import { createFileRoute } from '@tanstack/react-router'
import { HelperPage } from '#/ui/HelperPage'

export const Route = createFileRoute('/helper')({
  head: () => ({ meta: [{ title: 'Helper setup · Exec Hangar Timer' }] }),
  component: HelperPage,
})
