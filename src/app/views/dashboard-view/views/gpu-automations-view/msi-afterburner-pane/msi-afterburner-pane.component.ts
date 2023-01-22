import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import {
  APP_SETTINGS_DEFAULT,
  AppSettings,
  ExecutableReferenceStatus,
} from '../../../../../models/settings';
import { open as openFile } from '@tauri-apps/api/dialog';
import { cloneDeep } from 'lodash';
import { GpuAutomationsService } from '../../../../../services/gpu-automations.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  MSIAfterburnerAutomationConfig,
} from '../../../../../models/automations';
import { vshrink } from '../../../../../utils/animations';
import { SelectBoxItem } from '../../../../../components/select-box/select-box.component';

@Component({
  selector: 'app-msi-afterburner-pane',
  templateUrl: './msi-afterburner-pane.component.html',
  styleUrls: ['./msi-afterburner-pane.component.scss'],
  animations: [vshrink()],
})
export class MsiAfterburnerPaneComponent implements OnInit, OnDestroy {
  msiAfterburnerStatus: ExecutableReferenceStatus = 'UNKNOWN';
  msiAfterburnerPathAlert?: {
    text: string;
    type: 'INFO' | 'SUCCESS' | 'ERROR';
    loadingIndicator?: boolean;
  };
  msiAfterburnerPathInputChange: Subject<string> = new Subject();
  destroy$: Subject<void> = new Subject<void>();
  appSettings: AppSettings = cloneDeep(APP_SETTINGS_DEFAULT);
  config: MSIAfterburnerAutomationConfig = cloneDeep(AUTOMATION_CONFIGS_DEFAULT.MSI_AFTERBURNER);
  profileOptions: SelectBoxItem[] = [
    {
      id: '0',
      label: 'gpu-automations.msiAfterburner.none',
    },
    ...new Array(5).fill(0).map((_, i) => ({
      id: (i + 1).toString(),
      label: {
        string: 'gpu-automations.msiAfterburner.profile',
        values: { index: (i + 1).toString() },
      },
    })),
  ];
  onDisableProfile: SelectBoxItem = this.profileOptions[0];
  onEnableProfile: SelectBoxItem = this.profileOptions[0];

  constructor(protected gpuAutomations: GpuAutomationsService) {}

  ngOnInit() {
    this.gpuAutomations.msiAfterburnerConfig.pipe(takeUntil(this.destroy$)).subscribe((config) => {
      this.config = config;
      this.onEnableProfile = this.profileOptions[config.onSleepEnableProfile];
      this.onDisableProfile = this.profileOptions[config.onSleepDisableProfile];
    });
    this.gpuAutomations.msiAfterburnerStatus
      .pipe(takeUntil(this.destroy$))
      .subscribe((status) => this.processMSIAfterburnerStatus(status));
  }

  ngOnDestroy() {
    this.destroy$.next();
  }

  processMSIAfterburnerStatus(status: ExecutableReferenceStatus) {
    this.msiAfterburnerStatus = status;
    const statusToAlertType: {
      [s: string]: 'INFO' | 'SUCCESS' | 'ERROR';
    } = { CHECKING: 'INFO', SUCCESS: 'SUCCESS' };
    this.msiAfterburnerPathAlert = [
      'NOT_FOUND',
      'INVALID_EXECUTABLE',
      'INVALID_SIGNATURE',
      'PERMISSION_DENIED',
      'INVALID_FILENAME',
      'UNKNOWN_ERROR',
      'CHECKING',
      'SUCCESS',
    ].includes(status)
      ? {
          type: statusToAlertType[status] || 'ERROR',
          text: 'gpu-automations.msiAfterburner.executable.status.' + status,
          loadingIndicator: status === 'CHECKING',
        }
      : undefined;
  }

  async browseForMsiAfterburner() {
    const path = await openFile({
      defaultPath: 'C:\\Program Files (x86)\\MSI Afterburner',
      directory: false,
      multiple: false,
      filters: [
        {
          name: 'MSIAfterburner',
          extensions: ['exe'],
        },
      ],
    });
    if (path && typeof path === 'string') await this.gpuAutomations.setMSIAfterburnerPath(path);
  }

  changeProfile(event: 'ON_DISABLE' | 'ON_ENABLE', item: SelectBoxItem) {
    switch (event) {
      case 'ON_DISABLE':
        this.onDisableProfile = item;
        this.gpuAutomations.setMSIAfterburnerProfileOnSleepDisable(parseInt(item.id));
        break;
      case 'ON_ENABLE':
        this.gpuAutomations.setMSIAfterburnerProfileOnSleepEnable(parseInt(item.id));
        this.onEnableProfile = item;
        break;
    }
  }
}
