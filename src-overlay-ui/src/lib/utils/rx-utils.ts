import type { Readable } from "svelte/store";
import { Observable } from "rxjs";

export function asRx<T>(store: Readable<T>): Observable<T> {
  return new Observable<T>((subscriber) =>
    store.subscribe((val) => subscriber.next(val))
  );
}
