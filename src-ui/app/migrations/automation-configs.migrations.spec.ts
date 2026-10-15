import { describe, expect, it } from 'vitest';
import { runMigrations, Versioned } from 'src-shared-ts/src/migration-runner';
import { AUTOMATION_CONFIGS_MIGRATION } from './automation-configs.migrations';
import { parseOscScriptFromCode } from '../utils/osc-script-utils';
import { SLEEPING_ANIMATION_PRESETS } from '../models/sleeping-animation-presets';

const GOGO_LOCO = SLEEPING_ANIMATION_PRESETS.find((preset) => preset.id === 'GOGO_LOCO_1_8_0')!;
const FLOATS = { SIDE_BACK: '-1.0', SIDE_FRONT: '-0.75', SIDE_LEFT: '-0.6', SIDE_RIGHT: '-0.4' };

function sleepingAnimations(preset: string, emoteAddress: string) {
  const oscScripts = Object.fromEntries(
    Object.entries(FLOATS).map(([pose, float]) => [
      pose,
      parseOscScriptFromCode(`
i 214 ${emoteAddress}
f ${float} /avatar/parameters/Go/Float
      `).script,
    ])
  );
  return { preset, oscScripts };
}

async function migrate(SLEEPING_ANIMATIONS: object) {
  const result = await runMigrations(
    { version: 20, SLEEPING_ANIMATIONS } as Versioned,
    AUTOMATION_CONFIGS_MIGRATION
  );
  expect(result.status).toBe('migrated');
  return (result as { value: any }).value.SLEEPING_ANIMATIONS;
}

describe('automation configs migration 20 to 21', () => {
  it.each(['/avatar/parameters/VRCEmote', '/avatar/parameters/Go/VRCEmote'])(
    'gives the GoGo Loco preset scripts that use %s both emote parameters',
    async (emoteAddress) => {
      const migrated = await migrate(sleepingAnimations('GOGO_LOCO_1_8_0', emoteAddress));
      for (const pose of Object.keys(FLOATS)) {
        expect(migrated.oscScripts[pose]).toEqual(
          GOGO_LOCO.oscScripts[pose as keyof typeof FLOATS]
        );
      }
    }
  );

  it('leaves custom scripts unchanged', async () => {
    const custom = sleepingAnimations('CUSTOM', '/avatar/parameters/VRCEmote');
    const migrated = await migrate(structuredClone(custom));
    expect(migrated.oscScripts).toEqual(custom.oscScripts);
  });
});
