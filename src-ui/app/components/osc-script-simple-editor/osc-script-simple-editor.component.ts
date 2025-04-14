import { Component, DestroyRef, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { DropdownItem } from '../dropdown-button/dropdown-button.component';
import {
  OscParameterType,
  OscScript,
  OscScriptCommandAction,
  OscScriptSleepAction,
} from '../../models/osc-script';
import { isEqual } from 'lodash';
import { SelectBoxItem } from '../select-box/select-box.component';
import { fade, hshrink, noop, vshrink } from 'src-ui/app/utils/animations';
import { TString } from '../../models/translatable-string';
import { floatPrecision } from '../../utils/number-utils';
import { debounceTime, startWith, Subject, tap } from 'rxjs';
import { OscService } from '../../services/osc.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAX_PARAMETERS_PER_COMMAND, MAX_STRING_VALUE_LENGTH } from '../../utils/osc-script-utils';

interface ValidationError {
  actionIndex: number;
  message: TString;
}

@Component({
    selector: 'app-osc-script-simple-editor',
    templateUrl: './osc-script-simple-editor.component.html',
    styleUrls: ['./osc-script-simple-editor.component.scss'],
    animations: [vshrink(), noop(), hshrink(), fade()],
    standalone: false
})
export class OscScriptSimpleEditorComponent implements OnInit {
  private validationTrigger: Subject<void> = new Subject<void>();
  protected _script: OscScript = { version: 2, commands: [] };
  @Input() set script(script: OscScript) {
    if (isEqual(script, this._script)) return;
    this._script = structuredClone(script);
    this.validationTrigger.next();
  }

  @Output() scriptChange = new EventEmitter<OscScript>();
  @Output() errorCount = new EventEmitter<number>();
  @Output() validatedChange = new EventEmitter<boolean>();
  _validated = true;
  set validated(value: boolean) {
    this._validated = value;
    this.validatedChange.emit(value);
  }

  get validated(): boolean {
    return this._validated;
  }

  errors: ValidationError[] = [];
  tooltipErrors: ValidationError[] = [];
  tooltipPosition: { x: number; y: number } = { x: 0, y: 0 };
  testing = false;
  addCommandItems: DropdownItem[] = [
    {
      id: 'COMMAND',
      label: 'comp.osc-script-simple-editor.commands.COMMAND.title',
      subLabel: 'comp.osc-script-simple-editor.commands.COMMAND.description',
    },
    {
      id: 'SLEEP',
      label: 'comp.osc-script-simple-editor.commands.SLEEP.title',
      subLabel: 'comp.osc-script-simple-editor.commands.SLEEP.description',
    },
  ];
  parameterTypeSelectItems: SelectBoxItem[] = [
    {
      id: 'BOOLEAN',
      label: 'Boolean',
    },
    {
      id: 'INT',
      label: 'Integer',
    },
    {
      id: 'FLOAT',
      label: 'Float',
    },
    {
      id: 'STRING',
      label: 'String',
    },
  ];

  protected readonly MAX_PARAMETERS_PER_COMMAND = MAX_PARAMETERS_PER_COMMAND;
  protected readonly MAX_STRING_VALUE_LENGTH = MAX_STRING_VALUE_LENGTH;

  constructor(private osc: OscService, private destroyRef: DestroyRef) {}

  ngOnInit(): void {
    this.validationTrigger
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        startWith(void 0),
        tap(() => (this.validated = false)),
        debounceTime(500)
      )
      .subscribe(() => {
        this.validateScript();
        this.validated = true;
        this.errorCount.emit(this.errors.length);
        this.scriptChange.emit(this._script);
      });
  }

  onAdd(item: DropdownItem) {
    switch (item.id) {
      case 'COMMAND':
        this._script.commands.push({
          type: 'COMMAND',
          address: '',
          parameters: [
            {
              type: 'BOOLEAN',
              value: 'true',
            },
          ],
        });
        break;
      case 'SLEEP':
        this._script.commands.push({
          type: 'SLEEP',
          duration: 1000,
        });
        break;
    }
    this.validationTrigger.next();
  }

  addParameter(commandIndex: number) {
    const command = this._script.commands[commandIndex] as OscScriptCommandAction;
    command.parameters.push({
      type: 'BOOLEAN',
      value: 'true',
    });
  }

  removeParameter(commandIndex: number, parameterIndex: number) {
    const command = this._script.commands[commandIndex] as OscScriptCommandAction;
    command.parameters.splice(parameterIndex, 1);
  }

  setSleepDuration(command: OscScriptSleepAction, event: Event) {
    command.duration = parseInt((event.target as HTMLInputElement).value);
    this.validationTrigger.next();
  }

  setIntValue(command: OscScriptCommandAction, parameterIndex: number, event: Event) {
    command.parameters[parameterIndex].value = (event.target as HTMLInputElement).value;
    this.validationTrigger.next();
  }

  setFloatValue(command: OscScriptCommandAction, parameterIndex: number, event: Event) {
    command.parameters[parameterIndex].value = (event.target as HTMLInputElement).value;
    this.validationTrigger.next();
  }

  setAddress(command: OscScriptCommandAction, event: Event) {
    command.address = (event.target as HTMLInputElement).value;
    this.validationTrigger.next();
  }

  setBoolValue(
    command: OscScriptCommandAction,
    parameterIndex: number,
    selectBoxItem: SelectBoxItem
  ) {
    command.parameters[parameterIndex].value = selectBoxItem.id;
    this.validationTrigger.next();
  }

  setStringValue(command: OscScriptCommandAction, parameterIndex: number, event: Event) {
    command.parameters[parameterIndex].value = (event.target as HTMLInputElement).value;
    this.validationTrigger.next();
  }

  getCommandParameterType(
    command: OscScriptCommandAction,
    parameterIndex: number
  ): SelectBoxItem | undefined {
    return this.parameterTypeSelectItems.find(
      (item) => item.id === command.parameters[parameterIndex].type
    );
  }

  setCommandParameterType(
    command: OscScriptCommandAction,
    parameterIndex: number,
    item: SelectBoxItem
  ) {
    const parameter = command.parameters[parameterIndex];
    parameter.type = item.id as OscParameterType;
    switch (parameter.type) {
      case 'INT':
        parameter.value = '1';
        break;
      case 'FLOAT':
        parameter.value = '1.0';
        break;
      case 'BOOLEAN':
        parameter.value = 'true';
        break;
      case 'STRING':
        parameter.value = '';
        break;
    }
    this.validationTrigger.next();
  }

  removeCommand(command: OscScriptSleepAction | OscScriptCommandAction) {
    const index = this._script.commands.indexOf(command);
    if (index >= 0) this._script.commands.splice(index, 1);
    this.validationTrigger.next();
  }

  validateScript() {
    this.errors = [];
    let totalSleepDuration = 0;
    this._script.commands.forEach((command, actionIndex) => {
      switch (command.type) {
        case 'COMMAND':
          if (!command.address) {
            this.errors.push({
              actionIndex,
              message: 'misc.oscScriptEditorErrors.addressRequired',
            });
          } else {
            if (!command.address.startsWith('/')) {
              this.errors.push({
                actionIndex,
                message: 'misc.oscScriptEditorErrors.addressNoSlash',
              });
            }
            if (!command.address.substring(1, command.address.length).match(`[\x00-\x7F]+`)) {
              this.errors.push({
                actionIndex,
                message: 'misc.oscScriptEditorErrors.addressNotASCII',
              });
            }
          }
          command.parameters.forEach((parameter) => {
            switch (parameter.type) {
              case 'INT': {
                const intValue = parseInt(parameter.value);
                if (isNaN(intValue) || intValue < 0 || intValue > 255) {
                  this.errors.push({
                    actionIndex,
                    message: 'misc.oscScriptEditorErrors.intOutOfBounds',
                  });
                }
                break;
              }
              case 'FLOAT': {
                const floatValue = parseFloat(parameter.value);
                if (isNaN(floatValue) || floatValue < -1.0 || floatValue > 1.0) {
                  this.errors.push({
                    actionIndex,
                    message: 'misc.oscScriptEditorErrors.floatOutOfBounds',
                  });
                } else if (floatPrecision(floatValue) > 3) {
                  this.errors.push({
                    actionIndex,
                    message: 'misc.oscScriptEditorErrors.floatTooPrecise',
                  });
                }
                break;
              }
              case 'STRING': {
                if (parameter.value.length > this.MAX_STRING_VALUE_LENGTH) {
                  this.errors.push({
                    actionIndex,
                    message: {
                      string: 'misc.oscScriptEditorErrors.stringTooLong',
                      values: { value: this.MAX_STRING_VALUE_LENGTH + '' },
                    },
                  });
                }
                break;
              }
            }
          });
          break;
        case 'SLEEP':
          if (command.duration === null || command.duration === undefined) {
            this.errors.push({
              actionIndex: actionIndex,
              message: 'misc.oscScriptEditorErrors.durationRequired',
            });
          }
          if (command.duration < 1) {
            this.errors.push({
              actionIndex: actionIndex,
              message: 'misc.oscScriptEditorErrors.durationTooShort',
            });
          }
          if (command.duration > 5000) {
            this.errors.push({
              actionIndex: actionIndex,
              message: 'misc.oscScriptEditorErrors.durationTooHigh',
            });
          }
          totalSleepDuration += command.duration;
          if (totalSleepDuration > 10000) {
            this.errors.push({
              actionIndex: actionIndex,
              message: 'misc.oscScriptEditorErrors.totalDurationTooLong',
            });
          }
          break;
      }
    });
  }

  async testCode() {
    if (this.testing) return;
    this.validateScript();
    if (this.errors.length) return;
    this.testing = true;
    await Promise.all([
      this.osc.runScript(this._script),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    this.testing = false;
  }

  getErrorsForAction(actionIndex: number): ValidationError[] {
    return this.errors.filter((error) => error.actionIndex === actionIndex);
  }

  hoverOnAction(lineNumber: number, event?: MouseEvent) {
    this.tooltipErrors = this.getErrorsForAction(lineNumber);
    if (!event) return;
    const el: HTMLElement = event.target as HTMLElement;
    const x = el.offsetLeft + el.offsetWidth + 6;
    const y = el.offsetTop;
    this.tooltipPosition = { x, y };
  }
}
