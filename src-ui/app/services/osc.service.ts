import { Injectable } from '@angular/core';
import { OscParameter, OscScript, OscScriptSleepAction } from '../models/osc-script';
import { flatten } from 'lodash';
import { TaskQueue } from '../utils/task-queue';
import { debug, error, info } from '@tauri-apps/plugin-log';
import { OSCMessage, parseOSCMessage } from '../models/osc-message';
import { commands, events, OSCMethod } from 'src-ui/app/bindings';
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
import { ToastService } from './toast.service';

@Injectable({
  providedIn: 'root',
})
export class OscService {
  private readonly scriptQueue: TaskQueue = new TaskQueue({ runUniqueTasksConcurrently: true });
  private readonly _messages: Subject<OSCMessage> = new Subject<OSCMessage>();
  public readonly messages: Observable<OSCMessage> = this._messages.asObservable();
  /** Time in ms of the last whitelisted OSC message, or null before the first one. */
  public readonly lastMessageAt = new BehaviorSubject<number | null>(null);
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

  constructor(
    private appSettings: AppSettingsService,
    private toasts: ToastService
  ) {}

  async init() {
    await events.oscMessageReceivedEvent.listen((data) => {
      this.lastMessageAt.next(Date.now());
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
        await commands.setOscReceiveAddressWhitelist(addresses);
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
    await events.vrcOscAddressChangedEvent.listen((event) => {
      this._vrchatOscAddress.next(event.payload);
    });
    await events.vrcOscQueryAddressChangedEvent.listen((event) => {
      if (this._vrchatOscQueryAddress.value !== event.payload) {
        this._vrchatOscQueryAddress.next(event.payload);
      }
    });
  }

  public updateAvatarContext(context: AvatarContext | null) {
    this.avatarContext = context;
  }

  private async startOscServer(): Promise<{ oscAddress: string; oscQueryAddress: string } | null> {
    let [oscAddress, oscQueryAddress] = (await commands.startOscServer()) ?? [null, null];
    if (oscAddress) {
      oscAddress = oscAddress.replace('0.0.0.0', '127.0.0.1');
      this._oscServerAddress.next(oscAddress);
    } else error("[OSC] Couldn't start OSC server");
    if (oscQueryAddress) {
      oscQueryAddress = oscQueryAddress.replace('0.0.0.0', '127.0.0.1');
      this._oscQueryServerAddress.next(oscQueryAddress);
      for (const method of this._oscMethods.value) {
        await commands.addOscMethod(this.mapToOscMethod(method));
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
      await commands.addOscMethod(this.mapToOscMethod(method));
    }
  }

  public async updateOscMethodValue(method: OscMethod<unknown>) {
    await commands.setOscMethodValue(method.options.address, method.getValue() + '');
  }

  private async stopOscServer(): Promise<void> {
    this._oscServerAddress.next(null);
    this._oscQueryServerAddress.next(null);
    await commands.stopOscServer();
  }

  async send_float(address: string, value: number) {
    await this.send_command(address, [
      {
        type: 'Float',
        value: value + '',
      },
    ]);
  }

  async send_int(address: string, value: number) {
    await this.send_command(address, [
      {
        type: 'Int',
        value: value + '',
      },
    ]);
  }

  async send_bool(address: string, value: boolean) {
    await this.send_command(address, [
      {
        type: 'Boolean',
        value: value + '',
      },
    ]);
  }

  async send_string(address: string, value: string) {
    await this.send_command(address, [
      {
        type: 'String',
        value: value,
      },
    ]);
  }

  async send_command(address: string, parameters: OscParameter[]) {
    const targetAddresses = this.getOscTargetAddresses();
    for (let targetAddr of targetAddresses) {
      // Replace spaces with underscores in address (This is default VRC behaviour for parameters, and spaces aren't supported in addresses according to the OSC spec anyways)
      address = address.trim().replace(/\s+/g, '_');

      const _parameters = structuredClone(parameters); // copy parameter array because some parameters may be modified before sending
      _parameters.forEach((parameter) => {
        // handle "\n" in string values to insert newlines
        if (parameter.type === 'String') {
          parameter.value = parameter.value.replace(/\\n/g, '\n');
        }
      });

      const parametersString = _parameters
        .map((parameter) => `${parameter.type} => ${parameter.value}`)
        .join(', ');

      const oscAddresses = [...this.getAddressAliasesForAvatarContext(address)];
      if (!oscAddresses.length) oscAddresses.push(address);

      for (const oscAddr of oscAddresses) {
        info(`[OSC] Sending {${parametersString}} on ${oscAddr} to ${targetAddr}`);

        const result = await commands.oscSendCommand(
          targetAddr,
          oscAddr,
          _parameters.map((parameter) => parameter.type),
          _parameters.map((parameter) => parameter.value)
        );
        // a failed send rejects, which stops a running OSC script at that step
        if (result.status === 'error') throw result.error;
      }
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

  /** Runs a script for the user, and warns them with a toast when it has nowhere to go. */
  async testScript(script: OscScript) {
    if (!this.getOscTargetAddresses().length) {
      this.toasts.show({
        type: 'warning',
        title: 'toasts.oscTest.noTarget.title',
        message: 'toasts.oscTest.noTarget.message',
        duration: 6000,
      });
      return;
    }
    await this.runScript(script);
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
    const osc_address = await commands.getVrchatOscAddress();
    if (osc_address !== this._vrchatOscAddress.value) this._vrchatOscAddress.next(osc_address);
    const oscquery_address = await commands.getVrchatOscqueryAddress();
    if (oscquery_address !== this._vrchatOscQueryAddress.value) {
      this._vrchatOscQueryAddress.next(oscquery_address);
    }
  }

  private mapToOscMethod(method: OscMethod<unknown>): OSCMethod {
    return {
      address: method.options.address,
      adType: method.options.access,
      valueType: method.options.type,
      value: method.options.access === 'Write' ? null : method.getValue() + '',
      description: method.options.description,
    };
  }

  private getAddressAliasesForAvatarContext(address: string): string[] {
    if (!this.avatarContext) return [];
    if (!address.startsWith('/avatar/parameters')) return [];
    if (this.avatarContext.type !== 'VRCHAT') return [];
    return this.avatarContext.parameters.find((p) => p.address === address)?.modularAliases ?? [];
  }

  private getOscTargetAddresses(): string[] {
    const targets: string[] = [];
    if (this.appSettings.settingsSync.oscTargets.includes('VRCHAT_OSCQUERY')) {
      targets.push(this._vrchatOscAddress.value ?? '');
    }
    if (this.appSettings.settingsSync.oscTargets.includes('CUSTOM')) {
      targets.push(
        `${this.appSettings.settingsSync.oscCustomTargetHost}:${this.appSettings.settingsSync.oscCustomTargetPort}`
      );
    }
    return targets.filter(Boolean);
  }
}
