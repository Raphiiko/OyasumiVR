import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { DropdownItem } from '../dropdown-button/dropdown-button.component';
import {
  OscParameterType,
  OscScript,
  OscScriptCommandAction,
  OscScriptSleepAction,
} from '../../models/osc-script';
import { cloneDeep, isEqual } from 'lodash';
import { SelectBoxItem } from '../select-box/select-box.component';
import { fade, hshrink, noop, vshrink } from 'src/app/utils/animations';
import { TString } from '../../models/translatable-string';
import { floatPrecision } from '../../utils/number-utils';
import { debounceTime, startWith, Subject, takeUntil, tap } from 'rxjs';
import { OscService } from '../../services/osc.service';

interface ValidationError {
  actionIndex: number;
  message: TString;
}

@Component({
  selector: 'app-osc-script-simple-editor',
  templateUrl: './osc-script-simple-editor.component.html',
  styleUrls: ['./osc-script-simple-editor.component.scss'],
  animations: [vshrink(), noop(), hshrink(), fade()],
})
export class OscScriptSimpleEditorComponent implements OnInit, OnDestroy {
  private validationTrigger: Subject<void> = new Subject<void>();
  private destroy$: Subject<void> = new Subject<void>();
  protected _script: OscScript = { version: 1, commands: [] };
  @Input() set script(script: OscScript) {
    if (isEqual(script, this._script)) return;
    this._script = cloneDeep(script);
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
  ];

  constructor(private osc: OscService) {}

  ngOnInit(): void {
    this.validationTrigger
      .pipe(
        takeUntil(this.destroy$),
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

  ngOnDestroy() {
    this.destroy$.next();
  }

  onAdd(item: DropdownItem) {
    switch (item.id) {
      case 'COMMAND':
        this._script.commands.push({
          type: 'COMMAND',
          address: '',
          parameterType: 'BOOLEAN',
          value: 'true',
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

  setSleepDuration(command: OscScriptSleepAction, event: Event) {
    command.duration = parseInt((event.target as HTMLInputElement).value);
    this.validationTrigger.next();
  }

  setIntValue(command: OscScriptCommandAction, event: Event) {
    command.value = (event.target as HTMLInputElement).value;
    this.validationTrigger.next();
  }

  setFloatValue(command: OscScriptCommandAction, event: Event) {
    command.value = (event.target as HTMLInputElement).value;
    this.validationTrigger.next();
  }

  setAddress(command: OscScriptCommandAction, event: Event) {
    command.address = (event.target as HTMLInputElement).value;
    this.validationTrigger.next();
  }

  setBoolValue(command: OscScriptCommandAction, event: SelectBoxItem) {
    command.value = event.id;
    this.validationTrigger.next();
  }

  getSelectedParameterTypeForCommand(command: OscScriptCommandAction): SelectBoxItem | undefined {
    return this.parameterTypeSelectItems.find((item) => item.id === command.parameterType);
  }

  setSelectedParameterTypeForCommand(command: OscScriptCommandAction, item: SelectBoxItem) {
    command.parameterType = item.id as OscParameterType;
    switch (command.parameterType) {
      case 'INT':
        command.value = '1';
        break;
      case 'FLOAT':
        command.value = '1.0';
        break;
      case 'BOOLEAN':
        command.value = 'true';
        break;
    }
    this.validationTrigger.next();
  }

  getSelectedBooleanValueForCommand(command: OscScriptCommandAction) {
    return command.parameterType === 'BOOLEAN' && command.value === 'true'
      ? { id: 'true', label: 'true' }
      : { id: 'false', label: 'false' };
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
              message: 'comp.osc-script-simple-editor.errors.addressRequired',
            });
          } else {
            if (!command.address.startsWith('/')) {
              this.errors.push({
                actionIndex,
                message: 'comp.osc-script-simple-editor.errors.addressNoSlash',
              });
            }
            if (!command.address.substring(1, command.address.length).match(`[\x00-\x7F]+`)) {
              this.errors.push({
                actionIndex,
                message: 'comp.osc-script-simple-editor.errors.addressNotASCII',
              });
            }
          }
          switch (command.parameterType) {
            case 'INT':
              const intValue = parseInt(command.value);
              if (isNaN(intValue) || intValue < 0 || intValue > 255) {
                this.errors.push({
                  actionIndex,
                  message: 'comp.osc-script-simple-editor.errors.intOutOfBounds',
                });
              }
              break;
            case 'FLOAT':
              const floatValue = parseFloat(command.value);
              if (isNaN(floatValue) || floatValue < -1.0 || floatValue > 1.0) {
                this.errors.push({
                  actionIndex,
                  message: 'comp.osc-script-simple-editor.errors.floatOutOfBounds',
                });
              } else if (floatPrecision(floatValue) > 3) {
                this.errors.push({
                  actionIndex,
                  message: 'comp.osc-script-simple-editor.errors.floatTooPrecise',
                });
              }
              break;
          }
          break;
        case 'SLEEP':
          if (command.duration === null || command.duration === undefined) {
            this.errors.push({
              actionIndex: actionIndex,
              message: 'comp.osc-script-simple-editor.errors.durationRequired',
            });
          }
          if (command.duration < 1) {
            this.errors.push({
              actionIndex: actionIndex,
              message: 'comp.osc-script-simple-editor.errors.durationTooShort',
            });
          }
          if (command.duration > 5000) {
            this.errors.push({
              actionIndex: actionIndex,
              message: 'comp.osc-script-simple-editor.errors.durationTooHigh',
            });
          }
          totalSleepDuration += command.duration;
          if (totalSleepDuration > 10000) {
            this.errors.push({
              actionIndex: actionIndex,
              message: 'comp.osc-script-simple-editor.errors.totalDurationTooLong',
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
    const y = el.offsetTop - 9;
    this.tooltipPosition = { x, y };
  }
}
