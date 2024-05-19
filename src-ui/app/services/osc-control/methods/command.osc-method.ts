import { OscMethod } from '../osc-method';
import { OSCIntValue, OSCMessage } from '../../../models/osc-message';
import { OscService } from '../../osc.service';
import { OscControlService } from '../osc-control.service';
import { firstValueFrom } from 'rxjs';
import { EventLogTurnedOffOpenVRDevices } from '../../../models/event-log-entry';
import { OpenVRService } from '../../openvr.service';
import { LighthouseConsoleService } from '../../lighthouse-console.service';
import { LighthouseService } from '../../lighthouse.service';
import { EventLogService } from '../../event-log.service';
import { AppSettingsService } from '../../app-settings.service';

export class CommandOscMethod extends OscMethod<number> {
  constructor(
    osc: OscService,
    private oscControl: OscControlService,
    private openvr: OpenVRService,
    private lighthouseConsole: LighthouseConsoleService,
    private lighthouse: LighthouseService,
    private eventLog: EventLogService,
    private appSettings: AppSettingsService
  ) {
    super(osc, {
      description: 'Trigger various actions in OyasumiVR from a single address (See documentation)',
      address: '/OyasumiVR/Command',
      addressAliases: ['/Oyasumi/Cmd'],
      type: 'Int',
      initialValue: 0,
      isVRCAvatarParameter: true,
      access: 'ReadWrite',
    });
  }

  async handleOSCMessage(message: OSCMessage) {
    const { value: commandId } = message.values[0] as OSCIntValue;
    switch (commandId) {
      case 0: // Idle
        break;
      case 1: // Initialize
        await this.handleInitialize();
        break;
      case 2: // Turn off all trackers
        await this.handleTurnOffAllTrackers();
        break;
      case 3: // Turn off all controllers
        await this.handleTurnOffAllControllers();
        break;
      case 4: // Turn off all devices
        await this.handleTurnOffAllDevices();
        break;
      case 5: // Turn off all lighthouses
        await this.handleTurnOffAllLighthouses();
        break;
      case 6: // Turn on all lighthouses
        await this.handleTurnOnAllLighthouses();
        break;
    }
  }

  private async handleInitialize() {
    await this.setValue(0);
    await this.oscControl.resyncAllVRCParameters();
  }

  private async handleTurnOffAllTrackers() {
    const devices = (await firstValueFrom(this.openvr.devices)).filter(
      (d) => d.class === 'GenericTracker'
    );
    await this.lighthouseConsole.turnOffDevices(devices);
    this.eventLog.logEvent({
      type: 'turnedOffOpenVRDevices',
      reason: 'OSC_CONTROL',
      devices: devices.length > 1 ? 'TRACKERS' : 'TRACKER',
    } as EventLogTurnedOffOpenVRDevices);
  }

  private async handleTurnOffAllControllers() {
    setTimeout(async () => {
      const devices = (await firstValueFrom(this.openvr.devices)).filter(
        (d) => d.class === 'Controller'
      );
      await this.lighthouseConsole.turnOffDevices(devices);
      this.eventLog.logEvent({
        type: 'turnedOffOpenVRDevices',
        reason: 'OSC_CONTROL',
        devices: devices.length > 1 ? 'CONTROLLERS' : 'CONTROLLER',
      } as EventLogTurnedOffOpenVRDevices);
    }, 2000);
  }

  private async handleTurnOffAllDevices() {
    setTimeout(async () => {
      await this.lighthouseConsole.turnOffDevices(await firstValueFrom(this.openvr.devices));
      this.eventLog.logEvent({
        type: 'turnedOffOpenVRDevices',
        reason: 'OSC_CONTROL',
        devices: 'ALL',
      } as EventLogTurnedOffOpenVRDevices);
    }, 2000);
  }

  private async handleTurnOffAllLighthouses() {
    const devices = await firstValueFrom(this.lighthouse.devices).then((devices) =>
      devices.filter((d) => !this.lighthouse.isDeviceIgnored(d))
    );
    const appSettings = await firstValueFrom(this.appSettings.settings);
    for (const device of devices) {
      await this.lighthouse.setPowerState(device, appSettings.lighthousePowerOffState);
    }
  }

  private async handleTurnOnAllLighthouses() {
    const devices = await firstValueFrom(this.lighthouse.devices).then((devices) =>
      devices.filter((d) => !this.lighthouse.isDeviceIgnored(d) && d.powerState !== 'on')
    );
    for (const device of devices) {
      await this.lighthouse.setPowerState(device, 'on');
    }
  }
}
