import { Component, OnDestroy, OnInit } from '@angular/core';
import { fade, hshrink, noop, vshrink } from '../../../../utils/animations';
import { VRChatService } from '../../../../services/vrchat.service';
import { Subject, takeUntil } from 'rxjs';
import { UserStatus } from 'vrchat';
import { VRChatUserStatus } from '../../../../models/vrchat';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';
import { TString } from '../../../../models/translatable-string';
import { DomSanitizer } from '@angular/platform-browser';

@Component({
  selector: 'app-status-automations-view',
  templateUrl: './status-automations-view.component.html',
  styleUrls: ['./status-automations-view.component.scss'],
  animations: [vshrink(), noop(), hshrink()],
})
export class StatusAutomationsViewComponent implements OnInit, OnDestroy {
  private destroy$: Subject<void> = new Subject<void>();
  loggedIn = false;
  limit = 1;
  bedLimit = 1;
  statusOptions: SelectBoxItem[] = [
    {
      id: 'join me',
      label: 'Join Me',
      htmlPrefix: this.sanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons-round" style="color: #409eff; font-size: 1.25em; margin-right: 0.25em;">brightness_1</i>'
      ),
    },
    {
      id: 'active',
      label: 'Online',
      htmlPrefix: this.sanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons-round" style="color: #67c23a; font-size: 1.25em; margin-right: 0.25em;">brightness_1</i>'
      ),
    },
    {
      id: 'ask me',
      label: 'Ask Me',
      htmlPrefix: this.sanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons-round" style="color: #fd9200; font-size: 1.25em; margin-right: 0.25em;">brightness_1</i>'
      ),
    },
    {
      id: 'busy',
      label: 'Do Not Disturb',
      htmlPrefix: this.sanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons-round" style="color: #f56c6c; font-size: 1.25em; margin-right: 0.25em;">brightness_1</i>'
      ),
    },
  ];

  constructor(private vrchat: VRChatService, private sanitizer: DomSanitizer) {}

  ngOnInit(): void {
    this.vrchat.status.pipe(takeUntil(this.destroy$)).subscribe((status) => {
      this.loggedIn = status === 'LOGGED_IN';
    });
  }
  ngOnDestroy() {
    this.destroy$.next();
  }

  login() {
    this.vrchat.showLoginModal();
  }

  async setStatus(status: VRChatUserStatus) {
    await this.vrchat.setStatus(status);
  }

  onLimitChange(value: string) {
    this.limit = parseInt(value);
    this.bedLimit = Math.min(this.limit, 10);
  }
}
