// Keep unresolved operations independent when the user switches products or forms.
export class InventoryRetryKeys {
  private readonly keys = new Map<string, string>();

  keyFor(operation: string) {
    const existing = this.keys.get(operation);
    if (existing) return existing;
    const key = crypto.randomUUID();
    this.keys.set(operation, key);
    return key;
  }

  complete(operation: string) {
    this.keys.delete(operation);
  }
}
