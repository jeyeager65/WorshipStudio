import type { LocationQueryValue, RouteLocationRaw } from 'vue-router'

export function returnPath(
  value: LocationQueryValue | LocationQueryValue[] | undefined,
  fallback: string,
): string {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate?.startsWith('/') && !candidate.startsWith('//') ? candidate : fallback
}

export function routeWithReturnTo(path: string, returnTo: string): RouteLocationRaw {
  return { path, query: { returnTo } }
}
