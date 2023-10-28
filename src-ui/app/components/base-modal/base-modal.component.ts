import { Component } from '@angular/core';
import { Subject } from 'rxjs';
import { ModalOptions } from '../../services/modal.service';

@Component({
  selector: 'app-base-modal',
  template: ``,
})
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class BaseModalComponent<ModalInput extends { [k: string]: any } | void, ModalOutput> {
  result?: ModalOutput;
  close$ = new Subject<void>();
  close() {
    this.close$.next();
  }

  getOptionsOverride(): Partial<ModalOptions> {
    return {};
  }
}
