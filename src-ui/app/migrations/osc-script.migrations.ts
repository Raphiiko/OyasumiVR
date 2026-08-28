import { OSC_SCRIPT_VERSION } from '../models/osc-script';
import type { OscScript } from '../models/osc-script';
import { runMigrations } from 'src-shared-ts/src/migration-runner';
import type { MigrationDefinition, Versioned } from 'src-shared-ts/src/migration-runner';

export const OSC_SCRIPT_MIGRATION: MigrationDefinition<Versioned> = {
  targetVersion: OSC_SCRIPT_VERSION,
  minimumSupportedVersion: 0,
  steps: {
    0: keepSame(1),
    1: keepSame(2),
    2: from2to3,
  },
  normalizeCurrentVersion: (data) => {
    const commands = (data as any).commands ?? [];
    if (!Array.isArray(commands)) throw new Error('OSC script commands must be an array');
    return { ...data, commands };
  },
};

export async function migrateOscScript(data: any): Promise<OscScript> {
  const result = await runMigrations(data, OSC_SCRIPT_MIGRATION);
  if (result.status === 'migrated' || result.status === 'unchanged') {
    return result.value as OscScript;
  }
  if (result.status === 'failed') throw result.cause;
  throw new Error(`OSC script migration failed with status ${result.status}`);
}

function keepSame(version: number): (data: any) => any {
  return (data: any) => {
    data.version = version;
    return data;
  };
}

function from2to3(data: any): any {
  data.version = 3;
  data.commands ??= [];
  data.commands = data.commands.map((command: any) => {
    if (command.type !== 'COMMAND') return command;
    command = structuredClone(command);
    command.parameters = command.parameters.map((parameter: any) => {
      parameter = structuredClone(parameter);
      switch (parameter.type) {
        case 'INT':
          parameter.type = 'Int';
          break;
        case 'FLOAT':
          parameter.type = 'Float';
          break;
        case 'BOOLEAN':
          parameter.type = 'Boolean';
          break;
        case 'STRING':
          parameter.type = 'String';
          break;
      }
      return parameter;
    });
    return command;
  });
  return data;
}
