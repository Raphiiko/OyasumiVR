import { DestroyRef } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * Completes `source` on destroy, so a value still pending in a `debounceTime` reaches the subscriber
 * one last time. Call this before subscribing: destroy callbacks run in registration order, and a
 * `takeUntilDestroyed` at the end of the chain registers its own once the chain is subscribed.
 */
export function flushOnDestroy<T>(source: Subject<T>, destroyRef: DestroyRef): void {
  destroyRef.onDestroy(() => source.complete());
}
