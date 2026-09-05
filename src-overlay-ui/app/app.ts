import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DashboardOverlay } from './overlays/dashboard/dashboard-overlay';
import { NotificationsOverlay } from './overlays/notifications/notifications-overlay';
import { SplashOverlay } from './overlays/splash/splash-overlay';
import { TooltipOverlay } from './overlays/tooltip/tooltip-overlay';

const OVERLAYS = ['dashboard', 'notifications', 'splash', 'tooltip'] as const;

@Component({
  selector: 'app-root',
  imports: [DashboardOverlay, NotificationsOverlay, SplashOverlay, TooltipOverlay],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  // The sidecar opens one overlay per browser at a fixed URL, so the path never changes after load
  readonly overlay = OVERLAYS.find((name) => window.location.pathname.includes(name)) ?? null;
}
