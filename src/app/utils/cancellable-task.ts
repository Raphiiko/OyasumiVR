import { BehaviorSubject, filter, map, Observable } from 'rxjs';

type CancellableTaskStatus = 'waiting' | 'running' | 'completed' | 'cancelled' | 'error';

export class CancellableTask<T = unknown, E = unknown> {
  private error?: E;
  private result?: T;
  private status: BehaviorSubject<CancellableTaskStatus> =
    new BehaviorSubject<CancellableTaskStatus>('waiting');
  public readonly onComplete: Observable<T> = this.status.pipe(
    filter((s) => s === 'completed'),
    map(() => this.result!)
  );
  public readonly onCancelled: Observable<void> = this.status.pipe(
    filter((s) => s === 'cancelled'),
    map(() => void 0)
  );
  public readonly onStart: Observable<void> = this.status.pipe(
    filter((s) => s === 'running'),
    map(() => void 0)
  );
  public readonly onError: Observable<E> = this.status.pipe(
    filter((s) => s === 'error'),
    map(() => this.error!)
  );

  constructor(private work: (task: CancellableTask, status: CancellableTaskStatus) => Promise<T>) {}

  public async start(): Promise<T> {
    try {
      this.result = await this.work(this, this.status.value);
      this.status.next('completed');
      this.status.complete();
      return this.result;
    } catch (e) {
      this.error = e as E;
      this.status.next('error');
      this.status.complete();
      throw e;
    }
  }

  cancel() {
    this.status.next('cancelled');
  }

  isComplete() {
    return this.status.value === 'completed';
  }

  isCancelled() {
    return this.status.value === 'cancelled';
  }

  isError() {
    return this.status.value === 'error';
  }

  isRunning() {
    return this.status.value === 'running';
  }
}
