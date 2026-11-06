import { createServerFn } from '@tanstack/react-start'
import { getHangarReport } from '#/server/hangar.server'

/** SSR/loader entry for the hangar report (public data, no auth needed). */
export const fetchHangarReport = createServerFn({ method: 'GET' }).handler(() => getHangarReport())
