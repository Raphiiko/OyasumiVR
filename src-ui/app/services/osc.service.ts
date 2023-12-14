import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { OscScript, OscScriptSleepAction } from '../models/osc-script';
import { cloneDeep } from 'lodash';
import { TaskQueue } from '../utils/task-queue';
import { debug, error } from 'tauri-plugin-log-api';
import { listen } from '@tauri-apps/api/event';
import { OSCMessage, OSCMessageRaw, parseOSCMessage } from '../models/osc-message';
import { BehaviorSubject, interval, Observable, Subject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class OscService {
  private scriptQueue: TaskQueue = new TaskQueue({ runUniqueTasksConcurrently: true });
  private _messages: Subject<OSCMessage> = new Subject<OSCMessage>();
  public messages: Observable<OSCMessage> = this._messages.asObservable();
  private _vrchatOscAddress: BehaviorSubject<string | null> = new BehaviorSubject<string | null>(
    null
  );
  private _oscServerAddress: BehaviorSubject<string | null> = new BehaviorSubject<string | null>(
    null
  );

  constructor() {}

  async init() {
    await listen<OSCMessageRaw>('OSC_MESSAGE', (data) => {
      this._messages.next(parseOSCMessage(data.payload));
    });
    await this.startOscServer();
    await this.fetchVRChatOSCAddress();
    interval(1000).subscribe(() => this.fetchVRChatOSCAddress());
  }

  private async startOscServer(): Promise<string | null> {
    let address = await invoke<string | null>('start_osc_server');
    if (address) {
      address = address.replace('0.0.0.0', '127.0.0.1');
      this._oscServerAddress.next(address);
    } else error("[OSC] Couldn't start OSC server");
    console.log(address);
    return address ?? null;
  }

  // private async stopOscServer(): Promise<void> {
  //   this._oscServerAddress.next(null);
  //   await invoke<string>('stop_osc_server');
  // }

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
    const address = await invoke<string | null>('get_vrchat_osc_address');
    if (address !== this._vrchatOscAddress.value) this._vrchatOscAddress.next(address);
  }
}
