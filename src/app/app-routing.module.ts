import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { trigger } from '@angular/animations';
import { DashboardViewComponent } from './views/dashboard-view/dashboard-view.component';
import { BatteryViewComponent } from './views/dashboard-view/views/battery-view/battery-view.component';
import { SettingsViewComponent } from './views/dashboard-view/views/settings-view/settings-view.component';
import { AboutViewComponent } from './views/dashboard-view/views/about-view/about-view.component';

const routes: Routes = [
  {
    path: 'dashboard',
    component: DashboardViewComponent,
    data: { animation: 'batteryManagement' },
    children: [
      {
        path: 'battery',
        component: BatteryViewComponent,
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
        redirectTo: 'battery',
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
