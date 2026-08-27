import { Injectable } from '@angular/core';
import {
  isRegistered,
  register,
  unregister,
  unregisterAll,
} from '@tauri-apps/plugin-global-shortcut';
import { error, warn } from '@tauri-apps/plugin-log';
import { map, Observable, Subject, take } from 'rxjs';
import { AppSettingsService } from './app-settings.service';

import { HotkeyId } from '../models/settings';

const validKeys = [
  'BACKQUOTE',
  '`',
  'BACKSLASH',
  '\\',
  'BRACKETLEFT',
  '[',
  'BRACKETRIGHT',
  ']',
  'COMMA',
  ',',
  'DIGIT0',
  '0',
  'DIGIT1',
  '1',
  'DIGIT2',
  '2',
  'DIGIT3',
  '3',
  'DIGIT4',
  '4',
  'DIGIT5',
  '5',
  'DIGIT6',
  '6',
  'DIGIT7',
  '7',
  'DIGIT8',
  '8',
  'DIGIT9',
  '9',
  'EQUAL',
  '=',
  'KEYA',
  'A',
  'KEYB',
  'B',
  'KEYC',
  'C',
  'KEYD',
  'D',
  'KEYE',
  'E',
  'KEYF',
  'F',
  'KEYG',
  'G',
  'KEYH',
  'H',
  'KEYI',
  'I',
  'KEYJ',
  'J',
  'KEYK',
  'K',
  'KEYL',
  'L',
  'KEYM',
  'M',
  'KEYN',
  'N',
  'KEYO',
  'O',
  'KEYP',
  'P',
  'KEYQ',
  'Q',
  'KEYR',
  'R',
  'KEYS',
  'S',
  'KEYT',
  'T',
  'KEYU',
  'U',
  'KEYV',
  'V',
  'KEYW',
  'W',
  'KEYX',
  'X',
  'KEYY',
  'Y',
  'KEYZ',
  'Z',
  'MINUS',
  '-',
  'PERIOD',
  '.',
  'QUOTE',
  "'",
  'SEMICOLON',
  ';',
  'SLASH',
  '/',
  'BACKSPACE',
  'CAPSLOCK',
  'ENTER',
  'SPACE',
  'TAB',
  'DELETE',
  'END',
  'HOME',
  'INSERT',
  'PAGEDOWN',
  'PAGEUP',
  'PRINTSCREEN',
  'SCROLLLOCK',
  'ARROWDOWN',
  'DOWN',
  'ARROWLEFT',
  'LEFT',
  'ARROWRIGHT',
  'RIGHT',
  'ARROWUP',
  'UP',
  'NUMLOCK',
  'NUMPAD0',
  'NUM0',
  'NUMPAD1',
  'NUM1',
  'NUMPAD2',
  'NUM2',
  'NUMPAD3',
  'NUM3',
  'NUMPAD4',
  'NUM4',
  'NUMPAD5',
  'NUM5',
  'NUMPAD6',
  'NUM6',
  'NUMPAD7',
  'NUM7',
  'NUMPAD8',
  'NUM8',
  'NUMPAD9',
  'NUM9',
  'NUMPADADD',
  'NUMADD',
  'NUMPADPLUS',
  'NUMPLUS',
  'NUMPADDECIMAL',
  'NUMDECIMAL',
  'NUMPADDIVIDE',
  'NUMDIVIDE',
  'NUMPADENTER',
  'NUMENTER',
  'NUMPADEQUAL',
  'NUMEQUAL',
  'NUMPADMULTIPLY',
  'NUMMULTIPLY',
  'NUMPADSUBTRACT',
  'NUMSUBTRACT',
  // 'ESCAPE',
  // 'ESC',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'AUDIOVOLUMEDOWN',
  'VOLUMEDOWN',
  'AUDIOVOLUMEUP',
  'VOLUMEUP',
  'AUDIOVOLUMEMUTE',
  'VOLUMEMUTE',
  'F13',
  'F14',
  'F15',
  'F16',
  'F17',
  'F18',
  'F19',
  'F20',
  'F21',
  'F22',
  'F23',
  'F24',
];

@Injectable({
  providedIn: 'root',
})
export class HotkeyService {
  private hotkeys: { [hotkeyString: string]: string[] } = {};
  private _hotkeyPressed = new Subject<HotkeyId>();
  private paused = false;
  private queue: Promise<unknown> = Promise.resolve();
  public hotkeyPressed = this._hotkeyPressed.asObservable();

  constructor(private appSettings: AppSettingsService) {}

  // every change to this.hotkeys and to the registered accelerators runs here, one at a time
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  public async init() {
    this.appSettings.settings.pipe(take(1)).subscribe(async (settings) => {
      await unregisterAll();
      this.hotkeys = structuredClone(settings.hotkeys);
      for (const hotkeyString of Object.keys(this.hotkeys)) {
        await register(hotkeyString, (event) => {
          if (event.state === 'Pressed') {
            this.onHotkeyPressed(hotkeyString);
          }
        });
      }
    });
  }

  public isValidKey(key: string): boolean {
    return validKeys.includes(key.toUpperCase());
  }

  public pause() {
    return this.enqueue(async () => {
      if (this.paused) return;
      this.paused = true;
      for (const hotkeyString of Object.keys(this.hotkeys)) {
        try {
          await unregister(hotkeyString);
        } catch (e) {
          error('[HotkeyService] Could not unregister hotkey: ' + e);
        }
      }
    });
  }

  public resume() {
    return this.enqueue(async () => {
      if (!this.paused) return;
      this.paused = false;
      for (const hotkeyString of Object.keys(this.hotkeys)) {
        try {
          await this.registerAccelerator(hotkeyString);
        } catch (e) {
          warn('[HotkeyService] Could not register hotkey: ' + e);
        }
      }
    });
  }

  private registerAccelerator(hotkeyString: string) {
    return register(hotkeyString, (event) => {
      if (event.state === 'Pressed') {
        this.onHotkeyPressed(hotkeyString);
      }
    });
  }

  public async isValidHotkey(hotkeyString: string) {
    try {
      // If it's already registered, it's valid!
      if (await isRegistered(hotkeyString)) return true;
      // If not, attempt registering and unregistering it. If that succeeds, it's valid!
      await register(hotkeyString, () => {});
      await unregister(hotkeyString);
      return true;
    } catch (error) {
      warn('[HotkeyService] Could not check if hotkey is registered: ' + error);
      return false;
    }
  }

  public registerHotkey(hotkeyId: string, hotkeyString: string, load = false): Promise<boolean> {
    return this.enqueue(async () => {
      if (!(await this.isValidHotkey(hotkeyString))) {
        return false;
      }
      const boundTo = Object.entries(this.hotkeys).find(([, ids]) => ids.includes(hotkeyId))?.[0];
      if (boundTo === hotkeyString) return true;
      // claim the new accelerator before releasing the old one
      if (!this.hotkeys[hotkeyString] && !this.paused) {
        try {
          await this.registerAccelerator(hotkeyString);
        } catch (e) {
          warn('[HotkeyService] Could not register hotkey: ' + e);
          return false;
        }
      }
      const hotkeyIds = this.hotkeys[hotkeyString] ?? [];
      await this.releaseHotkey(hotkeyId);
      this.hotkeys[hotkeyString] = [...hotkeyIds, hotkeyId];
      if (!load) this.saveHotkeys();
      return true;
    });
  }

  public unregisterHotkey(hotkeyId: string, load = false) {
    return this.enqueue(async () => {
      await this.releaseHotkey(hotkeyId);
      if (!load) this.saveHotkeys();
    });
  }

  private async releaseHotkey(hotkeyId: string) {
    for (const [hotkeyString, hotkeyIds] of Object.entries(this.hotkeys)) {
      const index = hotkeyIds.indexOf(hotkeyId);
      if (index < 0) continue;
      hotkeyIds.splice(index, 1);
      if (hotkeyIds.length === 0) {
        delete this.hotkeys[hotkeyString];
        if (!this.paused) {
          try {
            await unregister(hotkeyString);
          } catch (e) {
            error('[HotkeyService] Could not unregister hotkey: ' + e);
          }
        }
      }
    }
  }

  public getHotkeyStringForId(hotkeyId: string): Observable<string | undefined> {
    return this.appSettings.settings.pipe(
      map((settings) => {
        for (const [hotkeyString, hotkeyIds] of Object.entries(settings.hotkeys)) {
          if (hotkeyIds.includes(hotkeyId)) return hotkeyString;
        }
        return undefined;
      })
    );
  }

  private async onHotkeyPressed(hotkeyString: string) {
    const ids = this.hotkeys[hotkeyString] as HotkeyId[];
    if (ids?.length) ids.forEach((id) => this._hotkeyPressed.next(id));
  }

  private saveHotkeys() {
    this.appSettings.updateSettings({
      hotkeys: structuredClone(this.hotkeys),
    });
  }
}
