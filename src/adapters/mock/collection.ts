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

/** Generic localStorage-backed collection, used by every mock port that needs list/get/save/delete. */
export class MockCollection<T extends { id: string }> {
  private key: string
  private items: T[]

  constructor(storageKey: string, seed: T[]) {
    this.key = `worship-studio:mock:${storageKey}`
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(this.key) : null
    this.items = stored ? (JSON.parse(stored) as T[]) : seed
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
