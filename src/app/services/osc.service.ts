import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { message } from '@tauri-apps/api/dialog';
import { exit } from '@tauri-apps/api/process';
import { SleepService } from './sleep.service';
import { OscScript, OscScriptSleepAction } from '../models/osc-script';
import { cloneDeep } from 'lodash';
import { TaskQueue } from '../utils/task-queue';

@Injectable({
  providedIn: 'root',
})
export class OscService {
  address = '127.0.0.1:9000';
  private scriptQueue: TaskQueue = new TaskQueue({ runUniqueTasksConcurrently: true });

  constructor(private sleep: SleepService) {}

  async init() {
    const result = await invoke<boolean>('osc_init');
    if (!result) {
      await message(
        'Could not bind a UDP socket to interact with VRChat over OSC. Please give Oyasumi the correct permissions.',
        { type: 'error', title: 'Oyasumi' }
      );
      await exit(0);
    }
  }

  async send_float(address: string, value: number) {
    await invoke('osc_send_float', { addr: this.address, oscAddr: address, data: value });
  }

  async send_int(address: string, value: number) {
    await invoke('osc_send_int', { addr: this.address, oscAddr: address, data: value });
  }

  async send_bool(address: string, value: boolean) {
    await invoke('osc_send_bool', { addr: this.address, oscAddr: address, data: value });
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
