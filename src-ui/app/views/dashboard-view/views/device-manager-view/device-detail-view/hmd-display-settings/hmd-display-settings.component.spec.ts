import '@angular/compiler';
import { Injector, runInInjectionContext, type InputSignal } from '@angular/core';
import { SIGNAL } from '@angular/core/primitives/signals';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { DMKnownDevice } from 'src-ui/app/models/device-manager';
import {
  APP_SETTINGS_DEFAULT,
  type AppSettings,
  type HmdSettings,
} from 'src-ui/app/models/settings';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { SteamFrameService } from 'src-ui/app/services/steam-frame/steam-frame.service';
import { HmdDisplaySettingsComponent } from './hmd-display-settings.component';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// writes a signal input the way a template binding does
function setInput<T>(input: InputSignal<T>, value: T) {
  const node = input[SIGNAL];
  node.applyValueToInputSignal(node, value);
}

describe('HmdDisplaySettingsComponent', () => {
  it.each([
    ['an Index', 'Index', { model: 'VALVE_INDEX', maxBrightness: 140 }],
    ['a Beyond', 'Beyond', { model: 'BIGSCREEN_BEYOND', maxBrightness: 140 }],
  ] as const)(
    'keeps the stored model of %s known from before manufacturers were stored',
    (_, typeName, own) => {
      const id = 'OVR_HMD_LHR-TEST0001';
      const settings: AppSettings = {
        ...structuredClone(APP_SETTINGS_DEFAULT),
        hmdSettings: { [id]: own as HmdSettings },
      };
      const updateSettings = vi.fn();
      const appSettings = {
        settings: new BehaviorSubject(settings),
        settingsSync: settings,
        updateSettings,
      };
      const component = runInInjectionContext(
        Injector.create({
          providers: [
            { provide: AppSettingsService, useValue: appSettings },
            { provide: SteamFrameService, useValue: { identityOf: () => null } },
          ],
        }),
        () => new HmdDisplaySettingsComponent()
      );
      const device = { id, typeName, deviceType: 'HMD' } as DMKnownDevice;
      setInput(component.device, device);

      component.setMaxBrightness(120);

      expect(updateSettings).toHaveBeenCalledWith({
        hmdSettings: { [id]: { ...own, maxBrightness: 120 } },
      });
    }
  );
});
