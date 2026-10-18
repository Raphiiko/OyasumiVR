import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { BaseModalComponent } from '../../base-modal/base-modal.component';
import { SteamService } from 'src-ui/app/services/steam.service';

@Component({
  selector: 'app-misc-testing',
  templateUrl: './misc-testing.component.html',
  styleUrls: ['./misc-testing.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class MiscTestingComponent {
  readonly modal = input<BaseModalComponent<any, any>>();

  constructor(private steamService: SteamService) {}

  test() {
    this.steamService.setAchievement('NON_EXISTING_ACHIEVEMENT', true);
  }
}
