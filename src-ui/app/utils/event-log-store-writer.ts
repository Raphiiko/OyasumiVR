import { LazyStore } from '@tauri-apps/plugin-store';
import type { EventLog } from '../models/event-log-entry';

export class EventLogStoreWriter {
  private writeQueue: Promise<unknown> = Promise.resolve();

  private readonly store: Pick<LazyStore, 'set' | 'save'>;

  constructor(store: Pick<LazyStore, 'set' | 'save'>) {
    this.store = store;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.catch(() => undefined);
    return result;
  }

  async save(eventLog: EventLog): Promise<void> {
    await this.enqueue(() => this.store.set('EVENT_LOG', eventLog));
  }

  async clear(eventLog: EventLog): Promise<void> {
    await this.enqueue(async () => {
      await this.store.set('EVENT_LOG', eventLog);
      await this.store.save();
    });
  }
}
