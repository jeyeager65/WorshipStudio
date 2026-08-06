import type { Service } from '@/models/service'

/** Lightweight "incomplete" check for the Services list — deliberately shallow (no
 *  songs/slides/media/people context needed, unlike the full readiness check inside a service's
 *  own workspace) so the list itself doesn't need to load half the library just to render a
 *  status label. Flags exactly two things: an unfilled template placeholder still in the order
 *  of service, or a role that's been added to the roster but has no one assigned to it yet. */
export function isServiceIncomplete(service: Service): boolean {
  if (service.items.some((item) => item.type === 'placeholder')) return true
  return (service.assignments ?? []).some((assignment) => !assignment.personId)
}
