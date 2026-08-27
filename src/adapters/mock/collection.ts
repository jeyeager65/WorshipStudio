/**
 * Deep clone via JSON round-trip rather than structuredClone — our data model is plain
 * JSON-shaped data by design (that's the whole point of the file-based architecture), and
 * callers here are often Vue reactive refs/proxies (e.g. a song editor's `song.value`).
 * structuredClone's stricter internal-slot checks can throw on a reactive Proxy wrapping an
 * array; a JSON round-trip reads straight through it and naturally yields a plain object.
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Every mock storage key shares this prefix, which is what lets the demo be reset wholesale. */
export const MOCK_STORAGE_PREFIX = 'worship-studio:mock:'

/**
 * Throws away everything the demo has stored, so the next load seeds fresh from fixtures.ts.
 *
 * Needed because these collections only consult their seed when nothing is stored: someone who
 * opened the demo once keeps that day's sample data forever, and every later improvement to it is
 * invisible to them. Without a way to reset, a returning visitor is looking at a fossil with no
 * indication anything has changed.
 *
 * Callers reload afterwards — the adapter and its collections were built from the old data and hold
 * it in memory.
 */
export function clearMockStorage(): void {
  if (typeof localStorage === 'undefined') return
  const keys: string[] = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (key?.startsWith(MOCK_STORAGE_PREFIX)) keys.push(key)
  }
  // Collected before removing: deleting while iterating shifts the indices underneath the loop.
  for (const key of keys) localStorage.removeItem(key)
}

/** Generic localStorage-backed collection, used by every mock port that needs list/get/save/delete. */
export class MockCollection<T extends { id: string }> {
  private key: string
  private items: T[]

  constructor(storageKey: string, seed: T[]) {
    this.key = `${MOCK_STORAGE_PREFIX}${storageKey}`
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(this.key) : null
    // Clone the seed too, not just what save() takes in — otherwise this.items would start out
    // as a live reference to the caller's shared seed array (e.g. sampleData.ts's sampleThemes),
    // and save()'s in-place push/splice would permanently mutate that shared array itself,
    // silently leaking state into every later `new MockCollection(key, sameSeed)` for the rest
    // of the process, including in a completely different test.
    this.items = stored ? (JSON.parse(stored) as T[]) : clone(seed)
  }

  private persist() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.key, JSON.stringify(this.items))
    }
  }

  async list(): Promise<T[]> {
    return clone(this.items)
  }

  async get(id: string): Promise<T | undefined> {
    const found = this.items.find((item) => item.id === id)
    return found ? clone(found) : undefined
  }

  async save(item: T): Promise<void> {
    // Clone on the way in too — otherwise this.items would hold a live reference to
    // whatever the caller passed (often a Vue-reactive object), and further mutation of
    // that object elsewhere would silently bleed into "stored" data without going through
    // save() again.
    const stored = clone(item)
    const index = this.items.findIndex((existing) => existing.id === stored.id)
    if (index === -1) {
      this.items.push(stored)
    } else {
      this.items[index] = stored
    }
    this.persist()
  }

  async delete(id: string): Promise<void> {
    this.items = this.items.filter((item) => item.id !== id)
    this.persist()
  }
}

/**
 * Same localStorage-backed persistence as MockCollection, but for a single JSON document
 * rather than a list — used by ports that manage one settings object (library-settings.json,
 * machine-settings.json) instead of a collection of records.
 */
export class MockSingleton<T> {
  private key: string
  private value: T

  constructor(storageKey: string, seed: T) {
    this.key = `${MOCK_STORAGE_PREFIX}${storageKey}`
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(this.key) : null
    // Same reasoning as MockCollection above — clone the seed so this.value never starts as a
    // live reference to a shared module-level object.
    this.value = stored ? (JSON.parse(stored) as T) : clone(seed)
  }

  async get(): Promise<T> {
    return clone(this.value)
  }

  async save(next: T): Promise<void> {
    this.value = clone(next)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.key, JSON.stringify(this.value))
    }
  }
}
