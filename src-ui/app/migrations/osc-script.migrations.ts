import { error, info } from '@tauri-apps/plugin-log';
import { OSC_SCRIPT_VERSION, OscScript } from '../models/osc-script';
import { message } from '@tauri-apps/plugin-dialog';

const migrations: { [v: number]: (data: any) => any } = {
  1: keepSame(1),
  2: keepSame(2),
  3: from2to3,
};

export function migrateOscScript(data: any): OscScript {
  let currentVersion = data.version || 0;
  // Reset to latest when the current version is higher than the latest
  if (currentVersion > OSC_SCRIPT_VERSION) {
    data = resetToEmpty();
    info(
      `[osc-script-migrations] Resetting OSC script as it's version is higher than the latest version`
    );
  }
  console.log(0, currentVersion + 0, structuredClone(data));
  while (currentVersion < OSC_SCRIPT_VERSION) {
    try {
      console.log(1, currentVersion + 0, structuredClone(data));
      data = migrations[++currentVersion](structuredClone(data));
      console.log(2, currentVersion + 0, structuredClone(data));
    } catch {
      error(
        "[osc-script-migrations] Couldn't migrate osc script to version " +
          currentVersion +
          '. Resetting to empty script'
      );
      data = resetToEmpty();
      message(
        'One of your OSC scripts could not be migrated to the new version of OyasumiVR, and has therefore been reset. Apologies for the inconvenience.\n\nPlease report this issue to the developer so this issue may be fixed in the future. Thank you!',
        { title: 'Migration Error (OSC Script)' }
      );
      continue;
    }
    currentVersion = data.version;
    info(`[osc-script-migrations] Migrated OSC script to version ${currentVersion + ''}`);
  }
  return data as OscScript;
}

function keepSame(version: number): (data: any) => any {
  return (data: any) => {
    data.version = version;
    return data;
  };
}

function resetToEmpty(): OscScript {
  return {
    version: 3,
    commands: [],
  };
}

function from2to3(data: any): any {
  data.version = 3;
  data.commands ??= [];
  data.commands = data.commands.map((command: any) => {
    if (command.type === 'COMMAND') {
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
    } else {
      return command;
    }
  });
  return data;
}
