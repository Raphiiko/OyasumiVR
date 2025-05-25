import { Component, Input } from '@angular/core';
import { BaseModalComponent } from '../../base-modal/base-modal.component';
import { VRChatService } from 'src-ui/app/services/vrchat-api/vrchat.service';
import { LimitedUserGroups } from 'vrchat/dist/api';

@Component({
  selector: 'app-misc-testing',
  templateUrl: './misc-testing.component.html',
  styleUrls: ['./misc-testing.component.scss'],
  standalone: false,
})
export class MiscTestingComponent {
  groups?: LimitedUserGroups[];
  @Input() modal?: BaseModalComponent<any, any>;

  constructor(private vrchatService: VRChatService) {}

  async representGroup(groupId: string) {
    try {
      await this.vrchatService.representGroup(groupId, true);
    } catch (e) {
      console.error('Error representing group', e);
    }
  }

  async fetchGroups(force = false) {
    this.groups = await this.vrchatService.getUserGroups(force);
  }
}
