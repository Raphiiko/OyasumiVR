import { Component } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { ModalOptions } from '../../services/modal.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-base-modal',
  template: ``,
  standalone: false,
})
export class BaseModalComponent<_ModalInput extends { [k: string]: any } | void, ModalOutput> {
  result?: ModalOutput;
  close$ = new BehaviorSubject(false);
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
    this.close$.next(true);
  }

  getOptionsOverride(): Partial<ModalOptions> {
    return {};
  }
}
