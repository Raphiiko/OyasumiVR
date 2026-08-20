import { DestroyRef } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * Completes `source` on destroy, so a value pending in a `debounceTime` still reaches the
 * subscriber. Call before subscribing, or a `takeUntilDestroyed` in the chain tears it down first.
 */
export function flushOnDestroy<T>(source: Subject<T>, destroyRef: DestroyRef): void {
  destroyRef.onDestroy(() => source.complete());
}
