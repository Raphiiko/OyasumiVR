import { Component, DestroyRef, OnInit, TrackByFunction } from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { fade, fadeUp, vshrink } from 'src-ui/app/utils/animations';
import { LighthouseDevice } from '../../models/lighthouse-device';
import { LighthouseService } from '../../services/lighthouse.service';
import { animate, style, transition, trigger } from '@angular/animations';
import { OpenVRService } from '../../services/openvr.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, debounceTime, delay, filter, firstValueFrom, interval } from 'rxjs';
import { AppSettingsService } from '../../services/app-settings.service';

export interface LighthouseV1IdWizardModalInputModel {
  device: LighthouseDevice;
}

export interface LighthouseV1IdWizardModalOutputModel {}

@Component({
  selector: 'app-lighthouse-v1-id-wizard-modal',
  templateUrl: './lighthouse-v1-id-wizard-modal.component.html',
  styleUrls: ['./lighthouse-v1-id-wizard-modal.component.scss'],
  animations: [
    fadeUp(),
    vshrink(),
    fade(),
    fade('slowFade', '1s ease'),
    trigger('imgShrink', [
      transition(':enter', [
        style({
          width: 0,
          minWidth: 0,
          opacity: 0,
          flex: 0,
          'margin-left': 0,
          'margin-right': 0,
          'padding-left': 0,
          'padding-right': 0,
        }),
        animate('0.7s cubic-bezier(0.45, 0, 0.55, 1)'),
      ]),
      transition(':leave', [
        animate(
          '0.7s cubic-bezier(0.45, 0, 0.55, 1)',
          style({
            width: 0,
            minWidth: 0,
            opacity: 0,
            flex: 0,
            'margin-left': 0,
            'margin-right': 0,
            'padding-left': 0,
            'padding-right': 0,
          })
        ),
      ]),
    ]),
  ],
})
export class LighthouseV1IdWizardModalComponent
  extends BaseModalComponent<
    LighthouseV1IdWizardModalInputModel,
    LighthouseV1IdWizardModalOutputModel
  >
  implements OnInit, LighthouseV1IdWizardModalInputModel
{
  device: LighthouseDevice;
  step: 'INTRO' | 'MANUAL_INPUT' | 'AUTOMATIC_DETECTION' | 'VERIFY_ID' | 'SUCCESS' = 'INTRO';
  verifyAutomatic = false;
  manualId = '';
  verifyPercentage = 0;
  errorMessage = '';
  trackByIndex: TrackByFunction<any> = (index) => index;
  automaticDetectionSteps: Array<{
    title: string;
    subtitle: string;
    icon?: string;
    loader?: boolean;
  }> = [];
  verifying = false;

  constructor(
    private lighthouseService: LighthouseService,
    private openvr: OpenVRService,
    private destroyRef: DestroyRef,
    private appSettings: AppSettingsService
  ) {
    super();
    this.device = {} as LighthouseDevice;
    this.result = {};
  }

  ngOnInit(): void {
    interval(1000)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter(() => this.step === 'AUTOMATIC_DETECTION'),
        delay(1500),
        filter(() => this.step === 'AUTOMATIC_DETECTION')
      )
      .subscribe(() => this.attemptAutomaticDetection());
    combineLatest([this.openvr.status, this.openvr.devices])
      .pipe(takeUntilDestroyed(this.destroyRef), debounceTime(1))
      .subscribe(([status, devices]) => {
        const openVrInitialized = status === 'INITIALIZED';
        const trackedDeviceDetected = devices.some(
          (d) =>
            (d.class === 'HMD' || d.class === 'Controller' || d.class === 'GenericTracker') &&
            d.handleType
        );
        this.automaticDetectionSteps.splice(0, this.automaticDetectionSteps.length);
        const stepSteam = {
          title: 'comp.lv1-id-wizard-modal.automaticDetection.steps.startSteamVR',
          subtitle: 'comp.lv1-id-wizard-modal.automaticDetection.steps.waitingForSteamVR',
          icon: '',
          loader: true,
        };
        this.automaticDetectionSteps.push(stepSteam);
        if (openVrInitialized) {
          stepSteam.loader = false;
          stepSteam.icon = 'check_circle';
          stepSteam.subtitle = 'comp.lv1-id-wizard-modal.automaticDetection.steps.running';
        } else {
          return;
        }
        const connectDeviceStep = {
          title: 'comp.lv1-id-wizard-modal.automaticDetection.steps.connectDevice',
          subtitle: 'comp.lv1-id-wizard-modal.automaticDetection.steps.connectDeviceDesc',
          icon: '',
          loader: true,
        };
        this.automaticDetectionSteps.push(connectDeviceStep);
        if (trackedDeviceDetected) {
          connectDeviceStep.icon = 'check_circle';
          connectDeviceStep.loader = false;
          connectDeviceStep.subtitle =
            'comp.lv1-id-wizard-modal.automaticDetection.steps.deviceDetected';
        } else {
          return;
        }
        const detectBaseStationStep = {
          title: 'comp.lv1-id-wizard-modal.automaticDetection.steps.detectBasestation',
          subtitle: 'comp.lv1-id-wizard-modal.automaticDetection.steps.detectBasestationDesc',
          icon: '',
          loader: true,
        };
        this.automaticDetectionSteps.push(detectBaseStationStep);
      });
  }

  async cancel() {
    this.result = {};
    await this.close();
  }

  goToManualInput() {
    this.step = 'MANUAL_INPUT';
    this.errorMessage = '';
    this.manualId = '';
  }

  goToAutomaticDetection() {
    this.step = 'AUTOMATIC_DETECTION';
    this.errorMessage = '';
  }

  verifyId(id: string) {
    if (this.verifying) return;
    this.verifying = true;
    // Set state
    this.verifyPercentage = 0;
    this.step = 'VERIFY_ID';
    this.errorMessage = '';
    // Start verification test
    this.lighthouseService.testV1LighthouseIdentifier(this.device, id).subscribe({
      next: async (progress) => {
        if (typeof progress === 'number') {
          this.verifyPercentage = Math.round(progress * 100);
        } else {
          this.verifyPercentage = 100;
          switch (progress) {
            case 'SUCCESS':
              await this.saveId(id);
              setTimeout(() => (this.step = 'SUCCESS'), 1000);
              setTimeout(() => this.close(), 3500);
              break;
            case 'ERROR':
              this.errorMessage = 'comp.lv1-id-wizard-modal.verifyId.error.verificationFailed';
              if (this.verifyAutomatic) {
                this.step = 'AUTOMATIC_DETECTION';
              } else {
                this.step = 'MANUAL_INPUT';
              }
              break;
            case 'INVALID':
              if (this.verifyAutomatic) {
                this.step = 'MANUAL_INPUT';
                this.errorMessage = 'comp.lv1-id-wizard-modal.verifyId.error.detectionFailed';
              } else {
                this.step = 'MANUAL_INPUT';
                this.errorMessage = 'comp.lv1-id-wizard-modal.verifyId.error.invalidId';
              }
              break;
          }
        }
      },
      error: () => (this.verifying = false),
      complete: () => (this.verifying = false),
    });
  }

  verifyManualId() {
    if (this.step !== 'MANUAL_INPUT' || !this.validManualId()) return;
    this.verifyAutomatic = false;
    this.verifyId(this.manualId);
  }

  verifyAutomaticId(id: string) {
    if (this.step !== 'AUTOMATIC_DETECTION') return;
    this.verifyAutomatic = true;
    this.verifyId(id);
  }

  validManualId() {
    return /^[0-9A-F]{8}$/.test(this.manualId);
  }

  async saveId(v1Identifier: string) {
    const lighthouseId = this.device.id;
    const settings = await firstValueFrom(this.appSettings.settings);
    const v1LighthouseIdentifiers = structuredClone(settings.v1LighthouseIdentifiers ?? {});
    v1LighthouseIdentifiers[lighthouseId] = v1Identifier;
    this.appSettings.updateSettings({
      v1LighthouseIdentifiers,
    });
  }

  private async attemptAutomaticDetection() {
    const deviceName = this.device?.deviceName?.trim() ?? '';
    if (deviceName.length < 4) return;
    const matchStr = deviceName.slice(deviceName.length - 4, deviceName.length);
    if (!/^[0-9A-F]{4}$/.test(matchStr)) return;
    const devices = await firstValueFrom(this.openvr.devices);
    const baseStationSerialNumbers = devices
      .filter((d) => d.class === 'TrackingReference')
      .map((d) => d.serialNumber)
      .filter((s) => s.startsWith('LHB-'))
      .map((d) => d.slice(4))
      .filter((s) => /^[0-9A-F]{8}$/.test(s));
    const match = baseStationSerialNumbers.find((s) => s.endsWith(matchStr));
    if (!match) return;
    if (this.step === 'AUTOMATIC_DETECTION') {
      this.verifyAutomaticId(match);
    }
  }

  goToIntro() {
    this.step = 'INTRO';
  }
}
