import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { OscScript, OscScriptSleepAction } from '../models/osc-script';
import { cloneDeep, flatten } from 'lodash';
import { TaskQueue } from '../utils/task-queue';
import { debug, error } from 'tauri-plugin-log-api';
import { listen } from '@tauri-apps/api/event';
import { OSCMessage, OSCMessageRaw, parseOSCMessage } from '../models/osc-message';
import {
  asyncScheduler,
  BehaviorSubject,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  interval,
  map,
  Observable,
  Subject,
  switchMap,
  throttleTime,
} from 'rxjs';
import { OscMethod } from './osc-control/osc-method';
import { AppSettingsService } from './app-settings.service';

@Injectable({
  providedIn: 'root',
})
export class OscService {
  private readonly scriptQueue: TaskQueue = new TaskQueue({ runUniqueTasksConcurrently: true });
  private readonly _messages: Subject<OSCMessage> = new Subject<OSCMessage>();
  public readonly messages: Observable<OSCMessage> = this._messages.asObservable();
  private readonly _vrchatOscAddress: BehaviorSubject<string | null> = new BehaviorSubject<
    string | null
  >(null);
  public readonly vrchatOscAddress: Observable<string | null> =
    this._vrchatOscAddress.asObservable();
  private readonly _vrchatOscQueryAddress: BehaviorSubject<string | null> = new BehaviorSubject<
    string | null
  >(null);
  public readonly vrchatOscQueryAddress: Observable<string | null> =
    this._vrchatOscQueryAddress.asObservable();
  private readonly _oscServerAddress: BehaviorSubject<string | null> = new BehaviorSubject<
    string | null
  >(null);
  public readonly oscServerAddress: Observable<string | null> =
    this._oscServerAddress.asObservable();
  private readonly _oscQueryServerAddress: BehaviorSubject<string | null> = new BehaviorSubject<
    string | null
  >(null);
  public readonly oscQueryServerAddress: Observable<string | null> =
    this._oscQueryServerAddress.asObservable();
  private readonly _oscMethods: BehaviorSubject<OscMethod<unknown>[]> = new BehaviorSubject<
    OscMethod<unknown>[]
  >([]);

  constructor(private appSettings: AppSettingsService) {}

  async init() {
    await listen<OSCMessageRaw>('OSC_MESSAGE', (data) => {
      this._messages.next(parseOSCMessage(data.payload));
    });
    this._oscMethods
      .pipe(throttleTime(100, asyncScheduler, { leading: true, trailing: true }))
      .subscribe(async (methods) => {
        const addresses = flatten(
          methods.map((m) => {
            const addresses = [m.options.address, ...m.options.addressAliases];
            if (m.options.isVRCAvatarParameter)
              addresses.push(...addresses.map((a) => '/avatar/parameters' + a));
            return addresses;
          })
        );
        console.log('SETTING WHITELIST', addresses);
        await invoke('set_osc_receive_address_whitelist', { whitelist: addresses });
      });
    this.appSettings.settings
      .pipe(
        map((s) => s.oscServerEnabled),
        distinctUntilChanged(),
        debounceTime(500),
        switchMap(async (enabled) => {
          if (enabled) {
            await this.startOscServer();
            await this.fetchVRChatOSCAddress();
          } else {
            await this.stopOscServer();
          }
          return enabled;
        }),
        switchMap((enabled) =>
          enabled ? interval(1000).pipe(switchMap(() => this.fetchVRChatOSCAddress())) : EMPTY
        )
      )
      .subscribe();
  }

  private async startOscServer(): Promise<{ oscAddress: string; oscQueryAddress: string } | null> {
    let [oscAddress, oscQueryAddress] = (await invoke<[string, string] | null>(
      'start_osc_server'
    )) ?? [null, null];
    if (oscAddress) {
      oscAddress = oscAddress.replace('0.0.0.0', '127.0.0.1');
      this._oscServerAddress.next(oscAddress);
    } else error("[OSC] Couldn't start OSC server");
    if (oscQueryAddress) {
      oscQueryAddress = oscQueryAddress.replace('0.0.0.0', '127.0.0.1');
      this._oscQueryServerAddress.next(oscQueryAddress);
      for (const method of this._oscMethods.value) {
        await invoke('add_osc_method', { method: this.mapToOscMethod(method) });
      }
    } else error("[OSC] Couldn't start OSCQuery server");
    return oscAddress && oscQueryAddress ? { oscAddress, oscQueryAddress } : null;
  }

  public async addOscMethod(method: OscMethod<unknown>) {
    const methods = [...this._oscMethods.value].filter(
      (m) => m.options.address !== method.options.address
    );
    methods.push(method);
    this._oscMethods.next(methods);
    if (this._oscQueryServerAddress.value) {
      await invoke('add_osc_method', { method: this.mapToOscMethod(method) });
    }
  }

  public async updateOscMethodValue(method: OscMethod<unknown>) {
    await invoke('set_osc_method_value', {
      address: method.options.address,
      value: method.getValue() + '',
    });
  }

  private async stopOscServer(): Promise<void> {
    this._oscServerAddress.next(null);
    this._oscQueryServerAddress.next(null);
    await invoke<string>('stop_osc_server');
  }

  async send_float(address: string, value: number) {
    const addr = this._vrchatOscAddress.value;
    if (!addr) return;
    debug(`[OSC] Sending float ${value} to ${address}`);
    await invoke('osc_send_float', { addr, oscAddr: address, data: value });
  }

  async send_int(address: string, value: number) {
    const addr = this._vrchatOscAddress.value;
    if (!addr) return;
    debug(`[OSC] Sending int ${value} to ${address}`);

    await invoke('osc_send_int', { addr, oscAddr: address, data: value });
  }

  async send_bool(address: string, value: boolean) {
    const addr = this._vrchatOscAddress.value;
    if (!addr) return;
    debug(`[OSC] Sending bool ${value} to ${address}`);
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

  private async fetchVRChatOSCAddress() {
    const osc_address = await invoke<string | null>('get_vrchat_osc_address');
    if (osc_address !== this._vrchatOscAddress.value) this._vrchatOscAddress.next(osc_address);
    const oscquery_address = await invoke<string | null>('get_vrchat_oscquery_address');
    if (oscquery_address !== this._vrchatOscQueryAddress.value)
      this._vrchatOscQueryAddress.next(oscquery_address);
  }

  private mapToOscMethod(method: OscMethod<unknown>): {
    address: string;
    adType: 'Write' | 'Read' | 'ReadWrite';
    valueType: 'Bool' | 'Int' | 'Float' | 'String';
    value?: string;
    description?: string;
  } {
    return {
      address: method.options.address,
      adType: method.options.access,
      valueType: method.options.type,
      value: method.options.access === 'Write' ? undefined : method.getValue() + '',
      description: method.options.description,
    };
  }
}
