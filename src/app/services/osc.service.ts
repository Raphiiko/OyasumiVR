import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { SleepService } from './sleep.service';
import { OscScript, OscScriptSleepAction } from '../models/osc-script';
import { cloneDeep } from 'lodash';
import { TaskQueue } from '../utils/task-queue';
import { debug, info } from 'tauri-plugin-log-api';
import { listen } from '@tauri-apps/api/event';
import { OSCMessage, OSCMessageRaw, parseOSCMessage } from '../models/osc-message';
import { BehaviorSubject, filter, firstValueFrom, map, Observable, Subject, take, tap } from 'rxjs';
import { AppSettingsService } from './app-settings.service';

@Injectable({
  providedIn: 'root',
})
export class OscService {
  private scriptQueue: TaskQueue = new TaskQueue({ runUniqueTasksConcurrently: true });
  private _messages: Subject<OSCMessage> = new Subject<OSCMessage>();
  public messages: Observable<OSCMessage> = this._messages.asObservable();

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
        map(
          (settings) => [settings.oscReceivingHost, settings.oscReceivingPort] as [string, number]
        ),
        take(1),
        filter(([host, port]) => port > 0 && port <= 65535),
        tap(([host, port]) => this.init_receiver(host, port))
      )
      .subscribe();
  }

  async init_receiver(host: string, port: number): Promise<boolean> {
    const receiveAddr = `${host}:${port}`;
    if (this._initializedOnAddress.value === receiveAddr) return true;
    const result = await invoke<boolean>('osc_init', { receiveAddr });
    if (!result) {
      info(`[OSC] Could not bind a UDP socket on ${receiveAddr}.`);
      this._initializedOnAddress.next(null);
    } else {
      this._initializedOnAddress.next(receiveAddr);
    }
    return result;
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
      for (let command of script.commands) {
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
