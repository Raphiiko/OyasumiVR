import { inject } from '@angular/core';
import { MessageMonitor } from './message-monitor';
import { NvmlService } from '../../nvml.service';
import { GpuAutomationsService } from '../../gpu-automations.service';
import { ElevatedSidecarService } from '../../elevated-sidecar.service';
import {
  asyncScheduler,
  combineLatest,
  distinctUntilChanged,
  firstValueFrom,
  map,
  throttleTime,
} from 'rxjs';
import { AppSettingsService } from '../../app-settings.service';
import { ModalService } from '../../modal.service';
import { ConfirmModalComponent } from 'src-ui/app/components/confirm-modal/confirm-modal.component';
import { AutomationConfigService } from '../../automation-config.service';
import {
  GPUPowerLimitsAutomationConfig,
  MSIAfterburnerAutomationConfig,
} from 'src-ui/app/models/automations';
import { isEqual } from 'lodash';
import { TString } from 'src-ui/app/models/translatable-string';
import { ExecutableReferenceStatus } from 'src-ui/app/models/settings';
import { Router } from '@angular/router';

export class GpuAutomationMessageMonitor extends MessageMonitor {
  private nvml = inject(NvmlService);
  private gpuAutomations = inject(GpuAutomationsService);
  private elevatedSidecar = inject(ElevatedSidecarService);
  private settingsService = inject(AppSettingsService);
  private modalService = inject(ModalService);
  private automationConfig = inject(AutomationConfigService);
  private router = inject(Router);

  public override async init(): Promise<void> {
    await Promise.all([
      this.initSidecarStatusMonitor(),
      this.initNvmlStatusMonitor(),
      this.initAfterburnerStatusMonitor(),
    ]);
  }

  private async initSidecarStatusMonitor() {
    combineLatest([this.gpuAutomations.isEnabled(), this.elevatedSidecar.sidecarStarted])
      .pipe(
        map(([gpuAutomationsEnabled, sidecarRunning]) => gpuAutomationsEnabled && !sidecarRunning),
        distinctUntilChanged(),
        throttleTime(5000, asyncScheduler, { trailing: true, leading: false })
      )
      .subscribe((showError) => {
        if (showError) {
          this.messageCenter.addMessage({
            id: 'gpuAutomationsSidecarNotRunning',
            title: 'message-center.messages.gpuAutomationsSidecarNotRunning.title',
            message: 'message-center.messages.gpuAutomationsSidecarNotRunning.message',
            hideable: false,
            type: 'warning',
            actions: [
              {
                label: 'message-center.messages.gpuAutomationsSidecarNotRunning.actions.disable',
                action: () => {
                  this.gpuAutomations.disable();
                },
              },
              {
                label: 'message-center.messages.gpuAutomationsSidecarNotRunning.actions.elevate',
                action: async () => {
                  if (!(await firstValueFrom(this.settingsService.settings)).askForAdminOnStart) {
                    this.modalService
                      .addModal(ConfirmModalComponent, {
                        title: 'gpu-automations.elevationSidecarModal.title',
                        message: 'gpu-automations.elevationSidecarModal.message',
                        confirmButtonText: 'gpu-automations.elevationSidecarModal.confirm',
                        cancelButtonText: 'gpu-automations.elevationSidecarModal.cancel',
                      })
                      .subscribe((data) => {
                        if (data?.confirmed) {
                          this.settingsService.updateSettings({ askForAdminOnStart: true });
                        }
                        this.elevatedSidecar.start();
                      });
                  } else {
                    this.elevatedSidecar.start();
                  }
                },
              },
            ],
          });
        } else {
          this.messageCenter.removeMessage('gpuAutomationsSidecarNotRunning');
        }
      });
  }

  private async initAfterburnerStatusMonitor() {
    combineLatest([
      this.gpuAutomations.isEnabled(),
      this.gpuAutomations.msiAfterburnerConfig,
      this.gpuAutomations.msiAfterburnerStatus,
      this.elevatedSidecar.sidecarStarted,
    ])
      .pipe(
        map(
          ([gpuAutomationsEnabled, msiAfterburnerConfig, msiAfterburnerStatus, sidecarRunning]) => {
            if (!gpuAutomationsEnabled || !sidecarRunning) return { error: false };
            if (
              msiAfterburnerConfig.onSleepEnableProfile === 0 &&
              msiAfterburnerConfig.onSleepDisableProfile === 0
            )
              return { error: false };
            if (
              (
                [
                  'NOT_FOUND',
                  'INVALID_EXECUTABLE',
                  'INVALID_SIGNATURE',
                  'UNKNOWN_ERROR',
                ] as ExecutableReferenceStatus[]
              ).includes(msiAfterburnerStatus)
            ) {
              return {
                error: true,
                msiAfterburnerStatus,
              };
            }
            return { error: false };
          }
        )
      )
      .subscribe(({ error, msiAfterburnerStatus }) => {
        let message: TString =
          'message-center.messages.gpuAutomationsAfterburnerError.message.UNKNOWN_ERROR';
        if (error) {
          switch (msiAfterburnerStatus) {
            case 'NOT_FOUND':
            case 'INVALID_EXECUTABLE':
            case 'INVALID_SIGNATURE':
            case 'UNKNOWN_ERROR':
              message =
                'message-center.messages.gpuAutomationsAfterburnerError.message.' +
                msiAfterburnerStatus;
              break;
          }
          this.messageCenter.addMessage({
            id: 'gpuAutomationsAfterburnerError',
            title: 'message-center.messages.gpuAutomationsAfterburnerError.title',
            message,
            hideable: false,
            type: 'warning',
            actions: [
              {
                label: 'message-center.messages.gpuAutomationsAfterburnerError.actions.disable',
                action: () => {
                  this.automationConfig.updateAutomationConfig<MSIAfterburnerAutomationConfig>(
                    'MSI_AFTERBURNER',
                    {
                      onSleepEnableProfile: 0,
                      onSleepDisableProfile: 0,
                    }
                  );
                },
              },
              {
                label: 'message-center.actions.configure',
                action: async () => {
                  this.router.navigate(['/dashboard/gpuAutomations'], {
                    fragment: 'MSI_AFTERBURNER',
                  });
                  this.messageCenter.toggle();
                },
              },
            ],
          });
        } else {
          this.messageCenter.removeMessage('gpuAutomationsAfterburnerError');
          return;
        }
      });
  }

  private async initNvmlStatusMonitor() {
    combineLatest([
      this.gpuAutomations.isEnabled(),
      this.gpuAutomations.powerLimitsConfig,
      this.nvml.status,
      this.elevatedSidecar.sidecarStarted,
    ])
      .pipe(
        map(([gpuAutomationsEnabled, powerLimitsConfig, nvmlStatus, sidecarRunning]) => {
          if (!gpuAutomationsEnabled || !sidecarRunning) return { error: false };
          if (!powerLimitsConfig.onSleepEnable.enabled && !powerLimitsConfig.onSleepDisable.enabled)
            return { error: false };
          return {
            error: true,
            powerLimitsConfig,
            nvmlStatus,
          };
        }),
        distinctUntilChanged((a, b) => isEqual(a, b))
      )
      .subscribe(({ error, powerLimitsConfig, nvmlStatus }) => {
        if (!error) {
          this.messageCenter.removeMessage('gpuAutomationsNvmlError');
          return;
        }
        switch (nvmlStatus) {
          case 'DriverNotLoaded':
          case 'LibLoadingError':
          case 'NoPermission':
          case 'NvmlUnknownError':
          case 'UnknownError': {
            let message: TString = 'gpu-automations.powerLimiting.disabled.unknown';
            if (nvmlStatus === 'NoPermission') {
              message = 'gpu-automations.powerLimiting.disabled.noPermission';
            } else if (nvmlStatus === 'DriverNotLoaded') {
              message = {
                string: 'gpu-automations.powerLimiting.disabled.noNvidia',
                values: {
                  code: 'DRIVER_NOT_LOADED',
                },
              };
            } else if (nvmlStatus === 'LibLoadingError') {
              message = {
                string: 'gpu-automations.powerLimiting.disabled.noNvidia',
                values: {
                  code: 'LIB_LOADING_ERROR',
                },
              };
            }
            this.messageCenter.addMessage({
              id: 'gpuAutomationsNvmlError',
              title: 'message-center.messages.gpuAutomationsNvmlError.title',
              message,
              hideable: false,
              type: 'warning',
              actions: [
                {
                  label: 'message-center.messages.gpuAutomationsNvmlError.actions.disable',
                  action: () => {
                    this.automationConfig.updateAutomationConfig<GPUPowerLimitsAutomationConfig>(
                      'GPU_POWER_LIMITS',
                      {
                        onSleepEnable: {
                          ...powerLimitsConfig.onSleepEnable,
                          enabled: false,
                        },
                        onSleepDisable: {
                          ...powerLimitsConfig.onSleepDisable,
                          enabled: false,
                        },
                      }
                    );
                  },
                },
              ],
            });
            break;
          }
          default:
            this.messageCenter.removeMessage('gpuAutomationsNvmlError');
            break;
        }
      });
  }
}
