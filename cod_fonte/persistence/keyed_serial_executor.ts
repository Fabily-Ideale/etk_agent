export class keyed_serial_executor {
  private chains: Map<string, Promise<void>>;

  constructor() {
    this.chains = new Map<string, Promise<void>>();
  }

  public run<result_type>(key: string, operation: () => Promise<result_type>): Promise<result_type> {
    const previous_chain = this.chains.get(key) || Promise.resolve();
    const result_promise = previous_chain.then(operation, operation);
    const settled_chain = result_promise.then(
      () => undefined,
      () => undefined
    );

    this.chains.set(key, settled_chain);

    void settled_chain.then(() => {
      if (this.chains.get(key) === settled_chain) {
        this.chains.delete(key);
      }
    });

    return result_promise;
  }

  public get_pending_key_count(): number {
    return this.chains.size;
  }

  public async drain(): Promise<void> {
    while (this.chains.size > 0) {
      await Promise.all(Array.from(this.chains.values()));
    }
  }
}
