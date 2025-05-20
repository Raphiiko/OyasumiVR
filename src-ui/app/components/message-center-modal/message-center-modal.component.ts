import { Component, OnInit, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { combineLatest, map, switchMap } from 'rxjs';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { MessageCenterService } from 'src-ui/app/services/message-center/message-center.service';
import { fade, vshrink } from 'src-ui/app/utils/animations';

@Component({
  selector: 'app-message-center-modal',
  templateUrl: './message-center-modal.component.html',
  styleUrls: ['./message-center-modal.component.scss'],
  standalone: false,
  animations: [fade(), vshrink()],
})
export class MessageCenterModalComponent extends BaseModalComponent<void, void> implements OnInit {
  [x: string]: any;
  protected scrolled = signal(false);
  protected hiddenShown = signal(false);
  protected readonly messages = toObservable(this.hiddenShown).pipe(
    switchMap((hiddenShown) => {
      return hiddenShown
        ? combineLatest([this.messageCenter.messages, this.messageCenter.hiddenMessages]).pipe(
            map(([messages, hiddenMessages]) => {
              return messages.concat(hiddenMessages);
            })
          )
        : this.messageCenter.messages;
    })
  );

  constructor(protected messageCenter: MessageCenterService) {
    super();
  }

  ngOnInit(): void {}

  toggleHidden() {
    this.hiddenShown.set(!this.hiddenShown());
  }

  onScroll(event: Event) {
    const scrolled = (event.target as HTMLElement).scrollTop > 0;
    this.scrolled.set(scrolled);
  }
}
