import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { OscParameter, OscScript, OscScriptSleepAction } from '../models/osc-script';
import { flatten } from 'lodash';
import { TaskQueue } from '../utils/task-queue';
import { debug, error, info } from 'tauri-plugin-log-api';
import { listen } from '@tauri-apps/api/event';
import { OSCMessage, OSCMessageRaw, parseOSCMessage } from '../models/osc-message';
import {
  asyncScheduler,
  BehaviorSubject,
  debounceTime,
  distinctUntilChanged,
  map,
  Observable,
  Subject,
  switchMap,
  throttleTime,
} from 'rxjs';
import { OscMethod } from './osc-control/osc-method';
import { AppSettingsService } from './app-settings.service';
import { AvatarContext } from '../models/avatar-context';

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
  private avatarContext: AvatarContext | null = null;

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
        })
        // switchMap((enabled) =>
        //   enabled ? interval(60000).pipe(switchMap(() => this.fetchVRChatOSCAddress())) : EMPTY
        // )
      )
      .subscribe();
    await listen<string | null>('VRC_OSC_ADDRESS_CHANGED', (event) => {
      this._vrchatOscAddress.next(event.payload);
    });
    await listen<string | null>('VRC_OSCQUERY_ADDRESS_CHANGED', (event) => {
      if (this._vrchatOscQueryAddress.value !== event.payload) {
        this._vrchatOscQueryAddress.next(event.payload);
      }
    });
  }

  public updateAvatarContext(context: AvatarContext | null) {
    this.avatarContext = context;
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
    await this.send_command(address, [
      {
        type: 'FLOAT',
        value: value + '',
      },
    ]);
  }

  async send_int(address: string, value: number) {
    await this.send_command(address, [
      {
        type: 'INT',
        value: value + '',
      },
    ]);
  }

  async send_bool(address: string, value: boolean) {
    await this.send_command(address, [
      {
        type: 'BOOLEAN',
        value: value + '',
      },
    ]);
  }

  async send_string(address: string, value: string) {
    await this.send_command(address, [
      {
        type: 'STRING',
        value: value,
      },
    ]);
  }

  async send_command(address: string, parameters: OscParameter[]) {
    const addr = this._vrchatOscAddress.value;
    if (!addr) return;
    // Replace spaces with underscores in address (This is default VRC behaviour for parameters, and spaces aren't supported in addresses according to the OSC spec anyways)
    address = address.trim().replace(/\s+/g, '_');

    const _parameters = structuredClone(parameters); // copy parameter array because some parameters may be modified before sending
    _parameters.forEach((parameter) => {
      // handle "\n" in string values to insert newlines
      if (parameter.type === 'STRING') {
        parameter.value = parameter.value.replace(/\\n/g, '\n');
      }
    });

    const parametersString = _parameters
      .map((parameter) => `${parameter.type} => ${parameter.value}`)
      .join(', ');

    const addresses = [...this.getAddressAliasesForAvatarContext(address)];
    if (!addresses.length) addresses.push(address);

    for (const oscAddr of addresses) {
      info(`[OSC] Sending {${parametersString}} to ${oscAddr}`);

      await invoke('osc_send_command', {
        addr,
        oscAddr,
        types: _parameters.map((parameter) => parameter.type),
        values: _parameters.map((parameter) => parameter.value),
      });
    }
  }

  queueScript(script: OscScript, replaceId?: string) {
    script = structuredClone(script);
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
            await this.send_command(command.address, command.parameters);
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
    if (oscquery_address !== this._vrchatOscQueryAddress.value) {
      this._vrchatOscQueryAddress.next(oscquery_address);
    }
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

  private getAddressAliasesForAvatarContext(address: string): string[] {
    if (!this.avatarContext) return [];
    if (!address.startsWith('/avatar/parameters')) return [];
    if (this.avatarContext.type !== 'VRCHAT') return [];
    return this.avatarContext.parameters.find((p) => p.address === address)?.modularAliases ?? [];
  }
}
