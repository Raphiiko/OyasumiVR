import { Injectable } from '@angular/core';
import { HotkeyService } from './hotkey.service';
import { SleepPreparationService } from './sleep-preparation.service';
import { SleepService } from './sleep.service';
import { ShutdownAutomationsService } from './shutdown-automations.service';
import { firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class HotkeyHandlerService {
  constructor(
    private hotkeyService: HotkeyService,
    private sleep: SleepService,
    private sleepPreparation: SleepPreparationService,
    private shutdownSequence: ShutdownAutomationsService
  ) {}

  public async init() {
    this.hotkeyService.hotkeyPressed.subscribe(async (hotkey) => {
      switch (hotkey) {
        case 'HOTKEY_TOGGLE_SLEEP_MODE':
          if (await firstValueFrom(this.sleep.mode)) {
            await this.sleep.disableSleepMode({ type: 'HOTKEY' });
          } else {
            await this.sleep.enableSleepMode({ type: 'HOTKEY' });
          }
          break;
        case 'HOTKEY_ENABLE_SLEEP_MODE':
          await this.sleep.enableSleepMode({ type: 'HOTKEY' });
          break;
        case 'HOTKEY_DISABLE_SLEEP_MODE':
          await this.sleep.disableSleepMode({ type: 'HOTKEY' });
          break;
        case 'HOTKEY_RUN_SLEEP_PREPARATION':
          await this.sleepPreparation.prepareForSleep();
          break;
        case 'HOTKEY_RUN_SHUTDOWN_SEQUENCE':
          await this.shutdownSequence.runSequence('HOTKEY');
          break;
      }
    });
  }
}
