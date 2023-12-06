import { Component } from '@angular/core';
import { Subject } from 'rxjs';
import { ModalOptions } from '../../services/modal.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-base-modal',
  template: ``,
})
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class BaseModalComponent<ModalInput extends { [k: string]: any } | void, ModalOutput> {
  result?: ModalOutput;
  close$ = new Subject<void>();
  someObservable = new Subject<void>();

  constructor() {
    this.someObservable
      .pipe(
        // No reference needed in context
        takeUntilDestroyed()
      )
      .subscribe(() => {
        // Do logic
      });
  }

  close() {
    this.close$.next();
  }

  getOptionsOverride(): Partial<ModalOptions> {
    return {};
  }
}
