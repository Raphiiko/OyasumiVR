import {
  OscParameterType,
  OscScript,
  OscScriptCodeValidationError,
  OscScriptCommandAction,
  OscScriptSleepAction,
} from '../models/osc-script';

const MAX_OSC_SCRIPT_COMMANDS = 100;
const SLEEP_ACTION_REGEX = /^\s*sleep\s+(?<VALUE>[0-9]+([.][0-9]+)?)(?<UNIT>ms|s)?\s*$/i;
const COMMAND_ACTION_REGEX =
  /^\s*((?<FLOAT_TYPE>f)\s+(?<FLOAT_VALUE>-?[0-9]+([.][0-9]+)?)|(?<INT_TYPE>i)\s+(?<INT_VALUE>[0-9]+)|(?<BOOL_TYPE>b)\s+(?<BOOL_VALUE>true|false|1|0|yes|no))\s+(?<ADDRESS>[\x00-\x7F]+)\s*$/i;

export function getOscScriptDuration(script: OscScript): number {
  let duration = 0;
  script.commands.forEach((command) => {
    if (command.type === 'SLEEP') {
      duration += command.duration;
    }
  });
  return duration;
}

export function parseOscScriptFromCode(code: string): {
  script: OscScript;
  errors: OscScriptCodeValidationError[];
} {
  const script: OscScript = {
    version: 1,
    commands: [],
  };
  const errors: OscScriptCodeValidationError[] = [];
  let totalSleepDuration = 0;
  let lines = code.split('\n').map((l, index) => ({ text: l.trim(), index }));

  lines = lines.filter((l) => !!l.text);
  for (let line of lines) {
    if (!line.text.trim()) {
      continue;
    }
    let match;
    if ((match = line.text.match(SLEEP_ACTION_REGEX))) {
      const isFloat = match.groups!['VALUE'].includes('.');
      let duration = parseFloat(match.groups!['VALUE']);
      const unit: 's' | 'ms' = (match.groups!['UNIT'] as 's' | 'ms') || (isFloat ? 's' : 'ms');
      if (unit === 'ms' && duration % 1 != 0) {
        errors.push({
          line: line.index,
          message: 'misc.oscScriptEditorErrors.noFloatMilliseconds',
        });
      }
      if (unit === 's') duration *= 1000;
      if (duration > 5000) {
        errors.push({
          line: line.index,
          message: 'misc.oscScriptEditorErrors.durationTooLong',
        });
      }
      totalSleepDuration += duration;
      if (totalSleepDuration > 10000) {
        errors.push({
          line: line.index,
          message: 'misc.oscScriptEditorErrors.totalDurationTooLong',
        });
      }
      script.commands.push({
        type: 'SLEEP',
        duration,
      } as OscScriptSleepAction);
    } else if ((match = line.text.match(COMMAND_ACTION_REGEX))) {
      let parameterType: OscParameterType = (
        { f: 'FLOAT', i: 'INT', b: 'BOOLEAN' } as { [s: string]: OscParameterType }
      )[match.groups!['FLOAT_TYPE'] || match.groups!['INT_TYPE'] || match.groups!['BOOL_TYPE']];
      let value: number | boolean;
      switch (parameterType) {
        case 'FLOAT':
          value = parseFloat(match.groups!['FLOAT_VALUE']);
          if (isNaN(value) || value < -1.0 || value > 1.0) {
            errors.push({
              line: line.index,
              message: 'misc.oscScriptEditorErrors.floatOutOfBounds',
            });
          }
          break;
        case 'INT':
          value = parseInt(match.groups!['INT_VALUE']);
          if (isNaN(value) || value < 0 || value > 255) {
            errors.push({
              line: line.index,
              message: 'misc.oscScriptEditorErrors.indexOutOfBounds',
            });
          }
          break;
        case 'BOOLEAN': {
          value = ['1', 'true', 'yes'].includes(match.groups!['BOOL_VALUE'].toLowerCase());
          break;
        }
      }
      const address = match.groups!['ADDRESS'];
      if (!address.startsWith('/')) {
        errors.push({
          line: line.index,
          message: 'misc.oscScriptEditorErrors.addressNoSlash',
        });
      }
      script.commands.push({
        type: 'COMMAND',
        parameterType,
        value: value + '',
        address,
      } as OscScriptCommandAction);
    } else {
      errors.push({
        line: line.index,
        message: 'misc.oscScriptEditorErrors.invalidSyntax',
      });
    }
  }
  if (script.commands.length > MAX_OSC_SCRIPT_COMMANDS) {
    errors.push({
      line: 0,
      message: {
        string: 'misc.oscScriptEditorErrors.tooManyCommands',
        values: { value: MAX_OSC_SCRIPT_COMMANDS.toString() },
      },
    });
  }

  return { script, errors };
}
