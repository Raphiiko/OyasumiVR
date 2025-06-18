import {
  OscParameter,
  OscScript,
  OscScriptCodeValidationError,
  OscScriptCommandAction,
  OscScriptSleepAction,
} from '../models/osc-script';

const MAX_OSC_SCRIPT_COMMANDS = 100;
export const MAX_PARAMETERS_PER_COMMAND = 5;
export const MAX_STRING_VALUE_LENGTH = 144;
const SLEEP_ACTION_REGEX = /^\s*sleep\s+(?<VALUE>[0-9]+([.][0-9]+)?)(?<UNIT>ms|s)?\s*$/i;
const COMMAND_ACTION_REGEX =
  // eslint-disable-next-line no-control-regex
  /(?:(?<FLOAT_TYPE>f)\s+(?<FLOAT_VALUE>-?[0-9]+(?:\.[0-9]+)?)|(?<INT_TYPE>i)\s+(?<INT_VALUE>[0-9]+)|(?<BOOL_TYPE>b)\s+(?<BOOL_VALUE>true|false|1|0|yes|no)|(?<STRING_TYPE>s)\s+"(?<STRING_VALUE>(?:\\"|[^"])*)")|(?:(?<ADDRESS>\/[^\n\r]+))/gi;

function checkSyntax(scriptLineContent: string) {
  const matches = [...scriptLineContent.matchAll(COMMAND_ACTION_REGEX)];

  let matchedLength = 0;
  matches.forEach((match) => {
    matchedLength += match[0].length;
  });

  if (matches.length > 1) {
    matchedLength += matches.length - 1; // count an unmatched space per gap between elements
  }

  return matchedLength === scriptLineContent.length;
}

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
    version: 3,
    commands: [],
  };
  const errors: OscScriptCodeValidationError[] = [];
  let totalSleepDuration = 0;
  const lines = code
    .split('\n')
    .map((l, index) => ({ text: l.trim(), index }))
    .filter((l) => !!l.text);

  for (const line of lines) {
    if (!line.text.trim()) {
      continue;
    }
    const sleepActionMatch = line.text.match(SLEEP_ACTION_REGEX);
    if (sleepActionMatch) {
      const isFloat = sleepActionMatch.groups!['VALUE'].includes('.');
      let duration = parseFloat(sleepActionMatch.groups!['VALUE']);
      const unit: 's' | 'ms' =
        (sleepActionMatch.groups!['UNIT'] as 's' | 'ms') || (isFloat ? 's' : 'ms');
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
    } else {
      const matches = [...line.text.matchAll(COMMAND_ACTION_REGEX)];

      if (matches.length > 0) {
        const parameters: OscParameter[] = [];

        for (const match of matches) {
          if (match.groups!['FLOAT_TYPE'] && match.groups!['FLOAT_VALUE']) {
            const floatValue = parseFloat(match.groups!['FLOAT_VALUE']);
            if (!isNaN(floatValue)) {
              parameters.push({
                type: 'Float',
                value: floatValue + '',
              });
            } else {
              errors.push({
                line: line.index,
                message: 'misc.oscScriptEditorErrors.invalidFloat',
              });
            }
          }

          if (match.groups!['INT_TYPE'] && match.groups!['INT_VALUE']) {
            const intValue = parseInt(match.groups!['INT_VALUE'], 10);
            if (!isNaN(intValue)) {
              parameters.push({
                type: 'Int',
                value: intValue + '',
              });
            } else {
              errors.push({
                line: line.index,
                message: 'misc.oscScriptEditorErrors.invalidInteger',
              });
            }
          }

          if (match.groups!['BOOL_TYPE'] && match.groups!['BOOL_VALUE']) {
            const boolValue = ['1', 'true', 'yes'].includes(
              match.groups!['BOOL_VALUE'].toLowerCase()
            );
            parameters.push({
              type: 'Boolean',
              value: boolValue + '',
            });
          }

          if (match.groups!['STRING_TYPE'] && typeof match.groups!['STRING_VALUE'] === 'string') {
            const stringValue = match.groups!['STRING_VALUE'];

            if (stringValue.length < MAX_STRING_VALUE_LENGTH) {
              parameters.push({
                type: 'String',
                value: stringValue.replace(/\\"/g, '"'), // un-escape escaped quotes when adding to array
              });
            } else {
              errors.push({
                line: line.index,
                message: {
                  string: 'misc.oscScriptEditorErrors.stringTooLong',
                  values: { value: MAX_STRING_VALUE_LENGTH + '' },
                },
              });
            }
          }
        }

        let address: string | undefined;
        for (const match of matches) {
          if (match.groups!['ADDRESS']) {
            address = match.groups!['ADDRESS'];
            break;
          }
        }

        // current regex only matches addresses with slash, so missing address throws addressNoSlash
        if (!address) {
          errors.push({
            line: line.index,
            message: 'misc.oscScriptEditorErrors.addressNoSlash',
          });
        } else if (!address.substring(1, address.length).match(`[\x00-\x7F]+`)) {
          errors.push({
            line: line.index,
            message: 'misc.oscScriptEditorErrors.addressNotASCII',
          });
        }

        if (!checkSyntax(line.text)) {
          errors.push({
            line: line.index,
            message: 'misc.oscScriptEditorErrors.invalidSyntax',
          });
        }

        if (parameters.length > MAX_PARAMETERS_PER_COMMAND) {
          errors.push({
            line: line.index,
            message: {
              string: 'misc.oscScriptEditorErrors.maxParameterCountExceeded',
              values: { value: MAX_PARAMETERS_PER_COMMAND + '' },
            },
          });
          continue;
        }

        script.commands.push({
          type: 'COMMAND',
          parameters,
          address: address ? address : '',
        } as OscScriptCommandAction);
      } else {
        errors.push({
          line: line.index,
          message: 'misc.oscScriptEditorErrors.invalidSyntax',
        });
      }
    }
  }

  if (script.commands.length > MAX_OSC_SCRIPT_COMMANDS) {
    errors.push({
      line: 0,
      message: {
        string: 'misc.oscScriptEditorErrors.tooManyCommands',
        values: { value: MAX_OSC_SCRIPT_COMMANDS + '' },
      },
    });
  }

  return { script, errors };
}
