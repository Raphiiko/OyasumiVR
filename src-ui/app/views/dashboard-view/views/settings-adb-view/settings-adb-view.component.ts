import { Component, computed, effect, model, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, map, Observable } from 'rxjs';
import { StepperStepState } from 'src-ui/app/components/adb-connection-stepper/adb-connection-stepper.component';
import { ADBDevice, ADBServerStatus } from 'src-ui/app/models/adb';
import { OVRDevice } from 'src-ui/app/models/ovr-device';
import { ADBService } from 'src-ui/app/services/adb.service';
import { OpenVRService, OpenVRStatus } from 'src-ui/app/services/openvr.service';
import { vshrink } from 'src-ui/app/utils/animations';

@Component({
  selector: 'app-settings-adb-view',
  templateUrl: './settings-adb-view.component.html',
  styleUrls: ['./settings-adb-view.component.scss'],
  standalone: false,
  animations: [vshrink()],
})
export class SettingsAdbViewComponent {
  protected stepperState: StepperStepState[] = [];
  private readonly openvrStatus: Signal<OpenVRStatus>;
  private readonly adbServerStatus: Signal<ADBServerStatus | null>;
  private readonly adbTargetModel: Signal<string | null>;
  private readonly openvrHmd: Signal<OVRDevice | null>;
  private readonly adbActiveDevice: Signal<ADBDevice | null>;
  private readonly wirelessDeviceTarget: Signal<{ host: string; port: number } | null>;
  protected readonly statusContext = model<{
    icon: string;
    title: string;
    message: string;
  } | null>(null);

  protected showWarning: Observable<boolean>;

  constructor(
    private adbService: ADBService,
    private openvr: OpenVRService
  ) {
    this.openvrStatus = toSignal(this.openvr.status, { initialValue: 'INACTIVE' });
    this.openvrHmd = toSignal(
      this.openvr.devices.pipe(map((devices) => devices.find((d) => d.class === 'HMD') ?? null)),
      { initialValue: null }
    );
    this.adbServerStatus = toSignal(this.adbService.serverStatus, { initialValue: null });
    this.adbTargetModel = toSignal(this.adbService.targetModel, { initialValue: null });
    this.adbActiveDevice = toSignal(this.adbService.activeDevice, { initialValue: null });
    this.wirelessDeviceTarget = toSignal(this.adbService.wirelessDeviceTarget, {
      initialValue: null,
    });

    effect(this.buildState.bind(this));

    this.showWarning = this.adbService.activeDevice.pipe(
      map((d) => d?.state !== 'device'),
      distinctUntilChanged(),
      debounceTime(5000)
    );
  }

  private buildState() {
    this.statusContext.set(null);

    const steamVRStep = this.buildSteamVRStepState();
    const adbStep = this.buildAdbStepState(steamVRStep.status === 'complete');
    const deviceStep = this.buildDeviceStepState(adbStep.status === 'complete');

    this.stepperState = [steamVRStep, adbStep, deviceStep];
  }

  private buildSteamVRStepState(): StepperStepState {
    const openvrStatus = this.openvrStatus();
    const adbTargetModel = this.adbTargetModel();
    const openvrHmd = this.openvrHmd();

    const step: StepperStepState = {
      title: 'SteamVR',
      icon: 'steamvr',
      subtitle: '',
      status: 'current',
    };

    switch (openvrStatus) {
      case 'INACTIVE':
      case 'INITIALIZING':
        step.status = 'current';
        step.subtitle = 'Waiting for SteamVR';
        break;
      case 'INITIALIZED':
        if (adbTargetModel) {
          step.status = 'complete';
          step.subtitle = openvrHmd?.modelNumber ?? adbTargetModel;
        } else if (openvrHmd) {
          step.status = 'current';
          step.subtitle = 'Headset Unsupported';
          this.statusContext.set({
            icon: 'docs',
            title: 'Headset Unsupported',
            message:
              'Your current headset either does not support ADB, or support for it has not been added to OyasumiVR. If you know your headset supports ADB, and you believe OyasumiVR should support it, please get in touch on Discord.',
          });
        } else {
          step.status = 'current';
          step.subtitle = 'Waiting for headset';
          this.statusContext.set({
            icon: 'docs',
            title: 'Waiting for headset',
            message:
              'SteamVR is running, but no headset was detected. Please ensure your headset is connected to SteamVR.',
          });
        }
        break;
    }

    return step;
  }

  private buildAdbStepState(previousStepComplete: boolean): StepperStepState {
    const adbServerStatus = this.adbServerStatus();
    const step: StepperStepState = {
      title: 'ADB Tools',
      icon: 'adb',
      subtitle: '',
      status: 'upcoming',
    };

    if (!previousStepComplete) return step;

    switch (adbServerStatus?.status) {
      case 'notFound':
        step.subtitle = 'Not Found';
        step.status = 'current';
        this.statusContext.set({
          icon: 'docs',
          title: 'ADB Tools Not Found',
          message:
            'ADB tools could not found on your system. Please ensure they are installed and accessible from your PATH.',
        });
        break;
      case 'unknownError':
        step.subtitle = 'Error';
        step.status = 'current';
        this.statusContext.set({
          icon: 'docs',
          title: 'Unknown Error',
          message:
            'An unknown error occurred while checking for ADB tools. Please check the logs for more information and get in touch on Discord.',
        });
        break;
      case 'running':
        step.subtitle = 'Available';
        step.status = 'complete';
        break;
      case undefined:
        step.subtitle = 'Checking...';
        step.status = 'current';
        break;
    }

    return step;
  }

  private buildDeviceStepState(previousStepComplete: boolean): StepperStepState {
    const adbActiveDevice = this.adbActiveDevice();
    const wirelessDeviceTarget = this.wirelessDeviceTarget();
    const step: StepperStepState = {
      title: 'Device',
      icon: 'head_mounted_device',
      subtitle: '',
      status: 'upcoming',
    };

    if (!previousStepComplete) return step;
    step.status = 'current';

    if (
      !adbActiveDevice ||
      adbActiveDevice.state === 'offline' ||
      adbActiveDevice.state === 'noDevice' ||
      adbActiveDevice.state === 'connecting' ||
      adbActiveDevice.state === 'detached'
    ) {
      if (wirelessDeviceTarget) {
        const address = wirelessDeviceTarget.host + ':' + wirelessDeviceTarget.port;
        step.subtitle = `Attempting to connnect...\n(${address})`;
        this.statusContext.set({
          icon: 'docs',
          title: 'Attempting to connect...',
          message:
            "You have previously connected to this device wirelessly via ADB, so OyasumiVR will attempt to connect to it again.\n\nIf the device's IP address or port has changed, you will have to reconnect to it manually. It is recommended to set up a static IP address for your headset so that OyasumiVR can automatically reconnect to it.",
        });
      } else {
        step.subtitle = 'Unavailable';
      }
    } else {
      let modeError = false;
      switch (adbActiveDevice.state) {
        case 'device':
          step.status = 'complete';
          step.subtitle = 'Connected';
          break;
        case 'authorizing':
          step.subtitle = 'Authorizing...';
          break;
        case 'unauthorized':
          step.subtitle = 'Unauthorized';
          this.statusContext.set({
            icon: 'docs',
            title: 'Device Unauthorized',
            message:
              'Your headset was detected, but is not yet authorized to be accessed via ADB. Please accept the request within the headset to authorize access.\n\nIf you do not see the authorization popup when putting on your headset, replug the usb cable, or reboot your headset.',
          });
          break;
        case 'noPerm':
          step.subtitle = 'Insufficient Permissions';
          break;
        case 'bootloader':
          step.subtitle = 'Bootloader Mode';
          modeError = true;
          break;
        case 'host':
          step.subtitle = 'Host Mode';
          modeError = true;
          break;
        case 'recovery':
          step.subtitle = 'Recovery Mode';
          modeError = true;
          break;
        case 'sideload':
          step.subtitle = 'Sideload Mode';
          modeError = true;
          break;
        case 'rescue':
          step.subtitle = 'Rescue Mode';
          modeError = true;
          break;
        default:
          step.subtitle = 'Unknown State';
          break;
      }
      if (modeError) {
        this.statusContext.set({
          icon: 'docs',
          title: 'Device Unauthorized',
          message:
            'Your headset is currently booted into an unsupported mode, such as the bootloader, or recovery mode. Please restart it into its regular mode of operation and try again.',
        });
      }
    }

    return step;
  }
}
