import { Component, DestroyRef, OnInit } from '@angular/core';
import { BackgroundService } from '../../services/background.service';
import { fade } from '../../utils/animations';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-dashboard-view',
  templateUrl: './dashboard-view.component.html',
  styleUrls: ['./dashboard-view.component.scss'],
  animations: [fade('fade', '1s ease')],
  standalone: false,
})
export class DashboardViewComponent implements OnInit {
  protected backgroundImage: string | null = null;

  constructor(
    private background: BackgroundService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.background.background.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((url) => {
      this.backgroundImage = url;
    });
  }
}
