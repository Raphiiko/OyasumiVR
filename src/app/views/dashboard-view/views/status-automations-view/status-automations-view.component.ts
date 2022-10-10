import { Component, OnDestroy, OnInit } from '@angular/core';
import { noop, vshrink } from '../../../../utils/animations';
import { VRChatService } from '../../../../services/vrchat.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-status-automations-view',
  templateUrl: './status-automations-view.component.html',
  styleUrls: ['./status-automations-view.component.scss'],
  animations: [vshrink(), noop()],
})
export class StatusAutomationsViewComponent implements OnInit, OnDestroy {
  private destroy$: Subject<void> = new Subject<void>();
  loggedIn = false;

  constructor(private vrchat: VRChatService) {}

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
}
