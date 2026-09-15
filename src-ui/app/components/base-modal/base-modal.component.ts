import { ChangeDetectionStrategy, Component } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ModalOptions } from '../../services/modal.service';

@Component({
  selector: 'app-base-modal',
  template: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class BaseModalComponent<_ModalInput extends { [k: string]: any } | void, ModalOutput> {
  result?: ModalOutput;
  close$ = new BehaviorSubject(false);

  close() {
    this.close$.next(true);
  }

  getOptionsOverride(): Partial<ModalOptions> {
    return {};
  }
}
