import { Injectable } from '@angular/core';
import { OscService } from '../osc.service';
import { OscMethod } from './osc-method';
import { AutoAcceptVRCInviteRequestsOscMethod } from './methods/auto-accept-vrc-invite-requests.osc-method';
import { AutomationConfigService } from '../automation-config.service';
import { SleepModeOscMethod } from './methods/sleep-mode.osc-method';
import { SleepService } from '../sleep.service';
import { SleepDetectionOscMethod } from './methods/sleep-detection.osc-method';
import { VRCPlayerCountStatusAutomationOscMethod } from './methods/vrc-player-count-status-automation.osc-method';
import { VRCSleepingAnimationsOscMethod } from './methods/vrc-sleeping-animations.osc-method';
import { OSCMessage, OSCValue } from '../../models/osc-message';
import { AvatarChangeOscMethod } from './methods/avatar-change.osc-method';
import { CommandOscMethod } from './methods/command.osc-method';
import { OpenVRService } from '../openvr.service';
import { LighthouseConsoleService } from '../lighthouse-console.service';
import { LighthouseService } from '../lighthouse.service';
import { EventLogService } from '../event-log.service';
import { AppSettingsService } from '../app-settings.service';
import { VRCMuteSelfParamOscMethod } from './methods/vrc-mute-self-param.osc-method';

@Injectable({
  providedIn: 'root',
})
export class OscControlService {
  private readonly methods: OscMethod<unknown>[] = [];

  constructor(
    private osc: OscService,
    automationConfig: AutomationConfigService,
    sleep: SleepService,
    openvr: OpenVRService,
    lighthouseConsole: LighthouseConsoleService,
    lighthouse: LighthouseService,
    eventLog: EventLogService,
    appSettings: AppSettingsService
  ) {
    this.methods.push(
      ...[
        new AvatarChangeOscMethod(osc, this),
        new SleepModeOscMethod(osc, sleep),
        new SleepDetectionOscMethod(osc, automationConfig),
        new AutoAcceptVRCInviteRequestsOscMethod(osc, automationConfig),
        new VRCPlayerCountStatusAutomationOscMethod(osc, automationConfig),
        new VRCSleepingAnimationsOscMethod(osc, automationConfig),
        new VRCMuteSelfParamOscMethod(osc),
        new CommandOscMethod(
          osc,
          this,
          openvr,
          lighthouseConsole,
          lighthouse,
          eventLog,
          appSettings
        ),
      ]
    );
    for (const method of this.methods) {
      this.osc.addOscMethod(method);
    }
  }

  async init() {
    this.osc.messages.subscribe((message) => {
      this.handleOSCMessage(message);
    });
  }

  public async resyncAllVRCParameters() {
    await Promise.all(
      this.methods.filter((m) => m.options.isVRCAvatarParameter).map((m) => m.syncValue())
    );
  }

  private async handleOSCMessage(message: OSCMessage) {
    let address = message.address;
    for (const method of this.methods) {
      let vrcParam = false;
      if (address.startsWith('/avatar/parameters')) {
        address = address.replace('/avatar/parameters', '');
        vrcParam = true;
      }
      if (vrcParam && !method.options.isVRCAvatarParameter) continue;
      if (![method.options.address, ...method.options.addressAliases].includes(address)) continue;
      if (!this.messageValuesValidForMethod(message.values, method)) continue;
      await method.handleOSCMessage(message);
      return;
    }
  }

  private messageValuesValidForMethod(values: OSCValue[], method: OscMethod<unknown>): boolean {
    switch (method.options.type) {
      case 'Float':
        return values.length > 0 && values[0].kind === 'float';
      case 'Int':
        return values.length > 0 && values[0].kind === 'int';
      case 'Bool':
        return values.length > 0 && values[0].kind === 'bool';
      case 'String':
        return values.length > 0 && values[0].kind === 'string';
      default:
        return false;
    }
  }

  public getOscMethods() {
    return [...this.methods];
  }
}
