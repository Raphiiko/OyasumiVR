import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { SleepService } from './sleep.service';
import { OscScript, OscScriptSleepAction } from '../models/osc-script';
import { cloneDeep, isEqual, pick } from 'lodash';
import { TaskQueue } from '../utils/task-queue';
import { debug, info } from 'tauri-plugin-log-api';
import { listen } from '@tauri-apps/api/event';
import { OSCMessage, OSCMessageRaw, parseOSCMessage } from '../models/osc-message';
import {
  BehaviorSubject,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  Observable,
  Subject,
} from 'rxjs';
import { AppSettingsService } from './app-settings.service';
import { AppSettings } from '../models/settings';
import { isValidHostname, isValidIPv4, isValidIPv6 } from '../utils/regex-utils';

export type OscAddressError = 'PORT_IN_USE' | 'PORT_INVALID' | 'PORT_IO_IDENTICAL' | 'INVALID_HOST';
export type OscAddressValidation = {
  oscReceivingHost?: OscAddressError[];
  oscReceivingPort?: OscAddressError[];
  oscSendingHost?: OscAddressError[];
  oscSendingPort?: OscAddressError[];
};

@Injectable({
  providedIn: 'root',
})
export class OscService {
  private scriptQueue: TaskQueue = new TaskQueue({ runUniqueTasksConcurrently: true });
  private _messages: Subject<OSCMessage> = new Subject<OSCMessage>();
  public messages: Observable<OSCMessage> = this._messages.asObservable();
  private validationLock: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  private _addressValidation: BehaviorSubject<OscAddressValidation> = new BehaviorSubject({});
  public addressValidation: Observable<OscAddressValidation> =
    this._addressValidation.asObservable();

  private receivingFeaturesEnabled: Observable<boolean> = this.appSettings.settings.pipe(
    map((settings) =>
      [settings.oscEnableExpressionMenu, settings.oscEnableExternalControl].some(Boolean)
    )
  );

  private _initializedOnAddress: BehaviorSubject<string | null> = new BehaviorSubject<
    string | null
  >(null);

  constructor(private sleep: SleepService, private appSettings: AppSettingsService) {}

  async init() {
    listen<OSCMessageRaw>('OSC_MESSAGE', (data) => {
      this._messages.next(parseOSCMessage(data.payload));
    });
    this.appSettings.settings
      .pipe(
        distinctUntilChanged((a, b) => {
          const pickRelevant = (c: AppSettings) =>
            pick(c, [
              'oscEnableExpressionMenu',
              'oscEnableExternalControl',
              'oscReceivingHost',
              'oscReceivingPort',
              'oscSendingHost',
              'oscSendingPort',
            ]);
          return isEqual(pickRelevant(a), pickRelevant(b));
        })
      )
      .subscribe((settings) => {
        this.setOscSendingAddress(settings.oscSendingHost, settings.oscSendingPort, settings);
        this.setOscReceivingAddress(settings.oscReceivingHost, settings.oscReceivingPort, settings);
      });
  }

  public async setOscReceivingAddress(
    host: string,
    port: number,
    settings?: AppSettings
  ): Promise<OscAddressValidation> {
    // Await the validation lock to be released
    await firstValueFrom(this.validationLock.pipe(filter((v) => !v)));
    // Lock the validation lock
    this.validationLock.next(true);
    // Define validation
    const validation: OscAddressValidation = cloneDeep(this._addressValidation.value);
    validation.oscReceivingHost = [];
    validation.oscReceivingPort = [];
    validation.oscSendingPort = (validation.oscSendingPort ?? []).filter(
      (e) => e !== 'PORT_IO_IDENTICAL'
    );
    // Get the current settings if not provided
    if (!settings) settings = await firstValueFrom(this.appSettings.settings);
    // Validate sending and receiving ports not being identical
    if (settings.oscSendingHost === host && settings.oscSendingPort === port) {
      validation.oscReceivingPort.push('PORT_IO_IDENTICAL');
      validation.oscSendingPort.push('PORT_IO_IDENTICAL');
    }
    // Validate port being in range
    if (port <= 0 || port > 65535) {
      validation.oscReceivingPort.push('PORT_INVALID');
    }
    // Validate host
    if (host === '' || !(isValidIPv6(host) || isValidIPv4(host) || isValidHostname(host))) {
      validation.oscReceivingHost.push('INVALID_HOST');
    }
    // Validate port not already being bound (only if any receiving features are enabled)
    const receivingFeaturesEnabled = await firstValueFrom(this.receivingFeaturesEnabled);
    if (
      receivingFeaturesEnabled &&
      !validation.oscReceivingHost.length &&
      !validation.oscReceivingPort.length
    ) {
      const result = await this.start_osc_server(host, port);
      if (!result) {
        validation.oscReceivingPort.push('PORT_IN_USE');
      }
    } else {
      await this.stop_osc_server();
    }
    // Update the current settings with the new data
    await this.appSettings.updateSettings({
      oscReceivingHost: host,
      oscReceivingPort: port,
    });
    // Return validation results
    this._addressValidation.next(validation);
    this.validationLock.next(false);
    return validation;
  }

  public async setOscSendingAddress(
    host: string,
    port: number,
    settings?: AppSettings
  ): Promise<OscAddressValidation> {
    // Await the validation lock to be released
    await firstValueFrom(this.validationLock.pipe(filter((v) => !v)));
    // Lock the validation lock
    this.validationLock.next(true);
    // Define validation
    const validation: OscAddressValidation = cloneDeep(this._addressValidation.value);
    validation.oscSendingHost = [];
    validation.oscSendingPort = [];
    validation.oscReceivingPort = (validation.oscSendingPort ?? []).filter(
      (e) => e !== 'PORT_IO_IDENTICAL'
    );
    // Get the current settings if not provided
    if (!settings) settings = await firstValueFrom(this.appSettings.settings);
    // Validate sending and receiving ports not being identical
    if (settings.oscReceivingHost === host && settings.oscReceivingPort === port) {
      validation.oscReceivingPort.push('PORT_IO_IDENTICAL');
      validation.oscSendingPort.push('PORT_IO_IDENTICAL');
    }
    // Validate port being in range
    if (port <= 0 || port > 65535) {
      validation.oscSendingPort.push('PORT_INVALID');
    }
    // Validate host
    if (host === '' || !(isValidIPv6(host) || isValidIPv4(host) || isValidHostname(host))) {
      validation.oscSendingHost.push('INVALID_HOST');
    }
    // Update the current settings with the new data
    await this.appSettings.updateSettings({
      oscSendingHost: host,
      oscSendingPort: port,
    });
    // Return validation results
    this._addressValidation.next(validation);
    this.validationLock.next(false);
    return validation;
  }

  private async start_osc_server(host: string, port: number): Promise<boolean> {
    const receiveAddr = `${host}:${port}`;
    let result = true;
    if (this._initializedOnAddress.value !== receiveAddr) {
      result = await invoke<boolean>('start_osc_server', { receiveAddr });
      if (!result) {
        info(`[OSC] Could not bind a UDP socket on ${receiveAddr}.`);
        this._initializedOnAddress.next(null);
      } else {
        this._initializedOnAddress.next(receiveAddr);
      }
    }
    return result;
  }

  private async stop_osc_server(): Promise<void> {
    await invoke<boolean>('stop_osc_server');
    this._initializedOnAddress.next(null);
  }

  async send_float(address: string, value: number) {
    debug(`[OSC] Sending float ${value} to ${address}`);
    const addr = await firstValueFrom(this.appSettings.settings).then(
      (settings) => settings.oscSendingHost + ':' + settings.oscSendingPort
    );
    await invoke('osc_send_float', { addr, oscAddr: address, data: value });
  }

  async send_int(address: string, value: number) {
    debug(`[OSC] Sending int ${value} to ${address}`);
    const addr = await firstValueFrom(this.appSettings.settings).then(
      (settings) => settings.oscSendingHost + ':' + settings.oscSendingPort
    );
    await invoke('osc_send_int', { addr, oscAddr: address, data: value });
  }

  async send_bool(address: string, value: boolean) {
    debug(`[OSC] Sending bool ${value} to ${address}`);
    const addr = await firstValueFrom(this.appSettings.settings).then(
      (settings) => settings.oscSendingHost + ':' + settings.oscSendingPort
    );
    await invoke('osc_send_bool', { addr, oscAddr: address, data: value });
  }

  queueScript(script: OscScript, replaceId?: string) {
    script = cloneDeep(script);
    this.scriptQueue.queueTask(
      {
        runnable: () => this.runScript(script),
        typeId: replaceId,
      },
      true
    );
  }

  async runScript(script: OscScript) {
    debug(`[OSC] Running script (actions=${script.commands.length})`);
    const run = async (script: OscScript) => {
      for (const command of script.commands) {
        switch (command.type) {
          case 'SLEEP':
            await new Promise((resolve) =>
              setTimeout(() => resolve(void 0), (command as OscScriptSleepAction).duration)
            );
            break;
          case 'COMMAND':
            switch (command.parameterType) {
              case 'INT':
                await this.send_int(command.address, parseInt(command.value));
                break;
              case 'FLOAT':
                await this.send_float(command.address, parseFloat(command.value));
                break;
              case 'BOOLEAN':
                await this.send_bool(command.address, command.value === 'true');
                break;
            }
            break;
        }
      }
    };

    await run(script);
  }
}
