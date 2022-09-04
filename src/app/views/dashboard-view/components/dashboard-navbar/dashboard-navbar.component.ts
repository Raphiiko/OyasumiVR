import { Component, OnInit } from '@angular/core';
import { combineLatest, map, Observable, startWith } from 'rxjs';
import { AppSettingsService } from '../../../../services/app-settings.service';
import { OpenVRService } from '../../../../services/openvr.service';
import { fade } from '../../../../utils/animations';
import { LighthouseService } from '../../../../services/lighthouse.service';

@Component({
  selector: 'app-dashboard-navbar',
  templateUrl: './dashboard-navbar.component.html',
  styleUrls: ['./dashboard-navbar.component.scss'],
  animations: [fade()]
})
export class DashboardNavbarComponent implements OnInit {
  settingErrors: Observable<boolean>;
  constructor(private settingsService: AppSettingsService, private lighthouse: LighthouseService) {
    this.settingErrors = combineLatest([
      this.lighthouse.consoleStatus.pipe(
        map((status) => !['UNKNOWN', 'SUCCESS', 'CHECKING'].includes(status)),
        startWith(false)
      ),
    ]).pipe(map((errorAreas: boolean[]) => !!errorAreas.find((a) => a)));
  }

  ngOnInit(): void {}
}
