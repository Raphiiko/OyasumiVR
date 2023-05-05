import { Component } from '@angular/core';
import { Subject } from 'rxjs';

@Component({
  selector: 'app-base-modal',
  template: ``,
})
export class BaseModalComponent<ModalInput extends { [k: string]: any } | void, ModalOutput> {
  result?: ModalOutput;
  close$ = new Subject<void>();

  close() {
    this.close$.next();
  }
}
