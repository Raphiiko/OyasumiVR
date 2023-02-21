import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { trigger } from '@angular/animations';
import { DashboardViewComponent } from './views/dashboard-view/dashboard-view.component';
import { BatteryAutomationsViewComponent } from './views/dashboard-view/views/battery-automations-view/battery-automations-view.component';
import { SettingsViewComponent } from './views/dashboard-view/views/settings-view/settings-view.component';
import { AboutViewComponent } from './views/dashboard-view/views/about-view/about-view.component';
import { OverviewViewComponent } from './views/dashboard-view/views/overview-view/overview-view.component';
import { SleepDetectionViewComponent } from './views/dashboard-view/views/sleep-detection-view/sleep-detection-view.component';
import { GpuAutomationsViewComponent } from './views/dashboard-view/views/gpu-automations-view/gpu-automations-view.component';
import { OscAutomationsViewComponent } from './views/dashboard-view/views/osc-automations-view/osc-automations-view.component';
import { StatusAutomationsViewComponent } from './views/dashboard-view/views/status-automations-view/status-automations-view.component';
import { AutoInviteRequestAcceptViewComponent } from './views/dashboard-view/views/auto-invite-request-accept-view/auto-invite-request-accept-view.component';
import { SleepDebugViewComponent } from './views/sleep-debug-view/sleep-debug-view.component';

const routes: Routes = [
  {
    path: 'sleepDebug',
    component: SleepDebugViewComponent,
  },
  {
    path: 'dashboard',
    component: DashboardViewComponent,
    data: { animation: 'batteryManagement' },
    children: [
      {
        path: 'overview',
        component: OverviewViewComponent,
      },
      {
        path: 'sleepDetection',
        component: SleepDetectionViewComponent,
      },
      {
        path: 'oscAutomations',
        component: OscAutomationsViewComponent,
      },
      {
        path: 'batteryAutomations',
        component: BatteryAutomationsViewComponent,
      },
      {
        path: 'gpuAutomations',
        component: GpuAutomationsViewComponent,
      },
      {
        path: 'statusAutomations',
        component: StatusAutomationsViewComponent,
      },
      {
        path: 'autoInviteRequestAccept',
        component: AutoInviteRequestAcceptViewComponent,
      },
      {
        path: 'settings',
        component: SettingsViewComponent,
      },
      {
        path: 'about',
        component: AboutViewComponent,
      },
      {
        path: '**',
        redirectTo: 'overview',
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];

export const routeAnimations = trigger('routeAnimations', []);

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
