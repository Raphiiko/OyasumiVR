import { Component, OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeStyle } from '@angular/platform-browser';
import { BackgroundService } from '../../services/background.service';
import { Subject, takeUntil } from 'rxjs';
import { fade } from '../../utils/animations';

@Component({
  selector: 'app-dashboard-view',
  templateUrl: './dashboard-view.component.html',
  styleUrls: ['./dashboard-view.component.scss'],
  animations: [fade('fade', '1s ease')],
})
export class DashboardViewComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  protected backgroundImage: string | null = null;

  constructor(private background: BackgroundService, private sanitizer: DomSanitizer) {}

  ngOnInit(): void {
    this.background.background.pipe(takeUntil(this.destroy$)).subscribe((url) => {
      this.backgroundImage = url;
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
  }
}
