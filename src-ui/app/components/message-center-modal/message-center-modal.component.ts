import { Component, OnInit } from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { MessageCenterService } from 'src-ui/app/services/message-center/message-center.service';
import { fade, vshrink } from 'src-ui/app/utils/animations';

@Component({
  selector: 'app-message-center-modal',
  templateUrl: './message-center-modal.component.html',
  styleUrls: ['./message-center-modal.component.scss'],
  animations: [fade(), vshrink()],
  standalone: false,
})
export class MessageCenterModalComponent extends BaseModalComponent<void, void> implements OnInit {
  constructor(protected messageCenter: MessageCenterService) {
    super();
  }

  ngOnInit(): void {}
}
