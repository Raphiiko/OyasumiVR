import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { APP_SETTINGS_DEFAULT } from '../../models/settings';
import { AUTOMATION_CONFIGS_DEFAULT, AutomationConfigs } from '../../models/automations';
import { buildFeatureSnapshot, FeatureSnapshotContext } from './feature-snapshot.service';

function context(edit: (a: AutomationConfigs) => void = () => {}): FeatureSnapshotContext {
  const automations = structuredClone(AUTOMATION_CONFIGS_DEFAULT);
  edit(automations);
  return {
    settings: structuredClone(APP_SETTINGS_DEFAULT),
    automations,
    vrchatLoggedIn: false,
    pulsoidLoggedIn: false,
  };
}

describe('buildFeatureSnapshot', () => {
  it('sends only 0/1 values under keys Aptabase accepts', () => {
    const snapshot = buildFeatureSnapshot(context());
    for (const [key, value] of Object.entries(snapshot)) {
      expect(key.length).toBeLessThanOrEqual(40);
      expect([0, 1]).toContain(value);
    }
  });

  it('reports no automation as used on a fresh install', () => {
    const snapshot = buildFeatureSnapshot(context());
    const used = Object.keys(snapshot).filter((key) => snapshot[key] === 1);
    expect(used).toEqual([
      'vrcx_logs',
      'discord_presence',
      'osc_server',
      'lighthouse_power_control',
      'overlay_menu',
    ]);
  });

  it('counts brightness and device power by their options', () => {
    expect(buildFeatureSnapshot(context()).brightness).toBe(0);
    const snapshot = buildFeatureSnapshot(
      context((a) => {
        a.BRIGHTNESS_AUTOMATIONS.SLEEP_MODE_ENABLE.enabled = true;
        a.DEVICE_POWER_AUTOMATIONS.turnOffDevicesOnSleepModeEnable.types = ['CONTROLLER' as never];
      })
    );
    expect(snapshot.brightness).toBe(1);
    expect(snapshot.device_power).toBe(1);
  });

  it('reads the options of automations whose enabled flag has no effect', () => {
    const snapshot = buildFeatureSnapshot(
      context((a) => {
        a.AUDIO_DEVICE_AUTOMATIONS.onSleepEnableAutomations = [{} as never];
        a.SYSTEM_MIC_MUTE_AUTOMATIONS.onSleepModeEnableState = 'MUTE' as never;
        a.SLEEP_MODE_CHANGE_ON_STEAMVR_STATUS.disableOnSteamVRStop = true;
        a.OSC_GENERAL.onSleepModeEnable = { version: 1, commands: [{} as never] } as never;
      })
    );
    expect(snapshot.audio_devices).toBe(1);
    expect(snapshot.system_mic_mute).toBe(1);
    expect(snapshot.wake_on_steamvr_stop).toBe(1);
    expect(snapshot.osc_scripts).toBe(1);
  });

  it('counts system mic mute when only the world join behaviour is set', () => {
    const snapshot = buildFeatureSnapshot(
      context((a) => (a.SYSTEM_MIC_MUTE_AUTOMATIONS.vrchatWorldJoinBehaviour = 'MUTE' as never))
    );
    expect(snapshot.system_mic_mute).toBe(1);
  });
});
