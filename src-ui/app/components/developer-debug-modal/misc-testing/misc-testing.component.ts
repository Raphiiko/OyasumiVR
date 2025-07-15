import { Component, Input } from '@angular/core';
import { BaseModalComponent } from '../../base-modal/base-modal.component';
import { SteamService } from 'src-ui/app/services/steam.service';

@Component({
  selector: 'app-misc-testing',
  templateUrl: './misc-testing.component.html',
  styleUrls: ['./misc-testing.component.scss'],
  standalone: false,
})
export class MiscTestingComponent {
  @Input() modal?: BaseModalComponent<any, any>;

  constructor(private steamService: SteamService) {}

  test() {
    this.steamService.setAchievement('NON_EXISTING_ACHIEVEMENT', true);
  }
}
