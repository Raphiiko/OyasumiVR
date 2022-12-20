import { Component, OnInit } from '@angular/core';
import { SleepService } from '../../services/sleep.service';
import { VRChatService } from '../../services/vrchat.service';
import { UserStatus } from 'vrchat/dist';
import { hshrink, noop } from '../../utils/animations';

@Component({
  selector: 'app-main-status-bar',
  templateUrl: './main-status-bar.component.html',
  styleUrls: ['./main-status-bar.component.scss'],
  animations: [hshrink(), noop()],
})
export class MainStatusBarComponent implements OnInit {
  sleepMode = this.sleepService.mode;
  user = this.vrchat.user;

  constructor(private sleepService: SleepService, private vrchat: VRChatService) {}

  ngOnInit(): void {}

  getStatusColor(status: UserStatus) {
    switch (status) {
      case UserStatus.Active:
        return 'var(--color-vrchat-status-green)';
      case UserStatus.JoinMe:
        return 'var(--color-vrchat-status-blue)';
      case UserStatus.AskMe:
        return 'var(--color-vrchat-status-orange)';
      case UserStatus.Busy:
        return 'var(--color-vrchat-status-red)';
      case UserStatus.Offline:
        return 'black';
    }
  }
}
