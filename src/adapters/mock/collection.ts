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
    return structuredClone(this.items)
  }

  async get(id: string): Promise<T | undefined> {
    const found = this.items.find((item) => item.id === id)
    return found ? structuredClone(found) : undefined
  }

  async save(item: T): Promise<void> {
    const index = this.items.findIndex((existing) => existing.id === item.id)
    if (index === -1) {
      this.items.push(item)
    } else {
      this.items[index] = item
    }
    this.persist()
  }

  async delete(id: string): Promise<void> {
    this.items = this.items.filter((item) => item.id !== id)
    this.persist()
  }
}
