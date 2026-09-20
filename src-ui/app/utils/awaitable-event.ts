export type AwaitableEventListener<T> = (value: T) => void | Promise<void>;

export interface AwaitableEvent<T> {
  subscribe(listener: AwaitableEventListener<T>): () => void;
}

export class AwaitableEventSource<T> {
  private readonly listeners = new Set<AwaitableEventListener<T>>();

  readonly event: AwaitableEvent<T> = {
    subscribe: (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
  };

  emit(value: T): Promise<PromiseSettledResult<void>[]> {
    return Promise.allSettled(
      [...this.listeners].map((listener) => Promise.resolve().then(() => listener(value)))
    );
  }
}
