import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { ThemeService } from './services/theme.service';
import { DashboardViewComponent } from './views/dashboard-view/dashboard-view.component';
import { BatteryViewComponent } from './views/dashboard-view/views/battery-view/battery-view.component';
import { SettingsViewComponent } from './views/dashboard-view/views/settings-view/settings-view.component';
import { DashboardNavbarComponent } from './views/dashboard-view/components/dashboard-navbar/dashboard-navbar.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { DeviceListComponent } from './views/dashboard-view/views/battery-view/components/device-list/device-list.component';
import { BatterySettingsComponent } from './views/dashboard-view/views/battery-view/components/battery-settings/battery-settings.component';
import { DeviceListItemComponent } from './views/dashboard-view/views/battery-view/components/device-list-item/device-list-item.component';
import { VarDirective } from './directives/var.directive';
import { BatteryTimeEventAutomationService } from './services/automations/battery-time-event-automation.service';
import { BatteryPercentageAutomation } from './services/automations/battery-percentage-automation.service';
import { BatteryControllerPoweroffAutomationService } from './services/automations/battery-controller-poweroff-automation.service';
import { BatteryChargingEventAutomationService } from './services/automations/battery-charging-event-automation.service';
import { AboutViewComponent } from './views/dashboard-view/views/about-view/about-view.component';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { HttpClient, HttpClientModule } from '@angular/common/http';

export function createTranslateLoader(http: HttpClient) {
  return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

@NgModule({
  declarations: [
    AppComponent,
    DashboardViewComponent,
    BatteryViewComponent,
    SettingsViewComponent,
    DashboardNavbarComponent,
    DeviceListComponent,
    BatterySettingsComponent,
    DeviceListItemComponent,
    VarDirective,
    AboutViewComponent,
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    AppRoutingModule,
    HttpClientModule,
    TranslateModule.forRoot({
      defaultLanguage: 'en',
      loader: {
        provide: TranslateLoader,
        useFactory: createTranslateLoader,
        deps: [HttpClient],
      },
    }),
  ],
  providers: [ThemeService],
  bootstrap: [AppComponent],
})
export class AppModule {
  constructor(
    private batteryTimeAutomation: BatteryTimeEventAutomationService,
    private batteryLevelAutomation: BatteryPercentageAutomation,
    private batteryControllerPoweroffAutomation: BatteryControllerPoweroffAutomationService,
    private batteryChargingEventAutomation: BatteryChargingEventAutomationService
  ) {
    Promise.all([
      batteryTimeAutomation.init(),
      batteryLevelAutomation.init(),
      batteryControllerPoweroffAutomation.init(),
      batteryChargingEventAutomation.init(),
    ]);
  }
}
