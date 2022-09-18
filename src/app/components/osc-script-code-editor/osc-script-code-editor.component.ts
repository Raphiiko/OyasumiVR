import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import { BehaviorSubject, debounceTime, map, Observable, Subject, takeUntil, tap } from 'rxjs';
import { TString } from '../../models/translatable-string';
import {
  OscParameterType,
  OscScript,
  OscScriptCommandAction,
  OscScriptSleepAction,
} from '../../models/osc-script';
import { fade, hshrink, noop } from '../../utils/animations';
import { cloneDeep, isEqual } from 'lodash';
import { OscService } from '../../services/osc.service';

interface ValidationError {
  line: number;
  message: TString;
}

const MAX_SCRIPT_LINES = 100;
const SLEEP_ACTION_REGEX = /^\s*sleep\s+(?<VALUE>[0-9]+([.][0-9]+)?)(?<UNIT>ms|s)?\s*$/i;
const COMMAND_ACTION_REGEX =
  /^\s*((?<FLOAT_TYPE>f)\s+(?<FLOAT_VALUE>[0-9]+([.][0-9]+)?)|(?<INT_TYPE>i)\s+(?<INT_VALUE>[0-9]+)|(?<BOOL_TYPE>b)\s+(?<BOOL_VALUE>true|false|1|0|yes|no))\s+(?<ADDRESS>[\x00-\x7F]+)\s*$/i;

@Component({
  selector: 'app-osc-script-code-editor',
  templateUrl: './osc-script-code-editor.component.html',
  styleUrls: ['./osc-script-code-editor.component.scss'],
  animations: [fade(), hshrink(), noop()],
})
export class OscScriptCodeEditorComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('editor') editorRef!: ElementRef;
  @ViewChild('lineCounter') lineCounterRef!: ElementRef;
  @Input() minHeight = 10;
  @Input() set script(script: OscScript) {
    const { script: currentScript } = this.parseScript(this._code.value);
    if (isEqual(script, currentScript)) return;
    const code = this.scriptToCode(script);
    this._code.next(code);
    if (this.editorRef) this.editorRef.nativeElement.innerText = code;
  }
  @Output() scriptChange = new EventEmitter<OscScript>();
  @Output() errorCount = new EventEmitter<number>();
  @Output() validatedChange = new EventEmitter<boolean>();
  private destroy$: Subject<void> = new Subject<void>();
  private _code: BehaviorSubject<string> = new BehaviorSubject<string>('');
  errors: ValidationError[] = [];
  tooltipErrors: ValidationError[] = [];
  tooltipPosition: { x: number; y: number } = { x: 0, y: 0 };
  testing = false;
  _validated = false;
  set validated(value: boolean) {
    this._validated = value;
    this.validatedChange.emit(value);
  }
  get validated(): boolean {
    return this._validated;
  }

  protected lineCounters: Observable<string[]> = this._code.pipe(
    map((code) => {
      let lines = this.minHeight;
      if (this.editorRef) {
        lines = Math.max(lines, code.split('\n').length);
      }
      return Array(lines)
        .fill('')
        .map((x, i) => `${i + 1}.`);
    })
  );

  constructor(private osc: OscService) {}

  ngOnInit(): void {
    this._code
      .pipe(
        takeUntil(this.destroy$),
        tap(() => (this.validated = false)),
        debounceTime(500)
      )
      .subscribe((code) => {
        this.tooltipErrors = [];
        const { script, errors } = this.parseScript(code);
        this.validated = true;
        this.errors = errors;
        this.errorCount.emit(errors.length);
        this.scriptChange.emit(script);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
  }

  ngAfterViewInit() {
    if (this._code.value) {
      this.editorRef.nativeElement.innerText = this._code.value;
    }
  }

  onEditorContentChange(content: string) {
    content = content.replace(/<br>/g, '\n');
    const match = content.match(/\n+$/);
    if (match) {
      content = content.substring(0, content.length - match[0].length);
      content += Array(Math.ceil(match[0].length / 2))
        .fill('\n')
        .join('');
    }
    const split = content.split('\n');
    if (split.length > MAX_SCRIPT_LINES) {
      content = split.slice(0, MAX_SCRIPT_LINES).join('\n') + '\n';
      if (this.editorRef) this.editorRef.nativeElement.innerText = content;
    }
    this._code.next(content);
  }

  scriptToCode(script: OscScript): string {
    return script.commands
      .map((command) => {
        switch (command.type) {
          case 'SLEEP':
            return `sleep ${command.duration}ms`;
          case 'COMMAND':
            const type = { FLOAT: 'f', INT: 'i', BOOLEAN: 'b' }[
              command.parameterType
            ] as OscParameterType;
            const value = {
              FLOAT: (v: string) => parseFloat(v),
              INT: (v: string) => parseInt(v),
              BOOLEAN: (v: string) => (v === 'true' ? 'true' : 'false'),
            }[command.parameterType](command.value);
            return `${type} ${value} ${command.address}`;
        }
      })
      .join('\n');
  }

  parseScript(rawScript: string): { script: OscScript; errors: ValidationError[] } {
    const script: OscScript = {
      commands: [],
    };
    const errors: ValidationError[] = [];
    let totalSleepDuration = 0;
    let lines = rawScript.split('\n').map((l, index) => ({ text: l.trim(), index }));
    if (lines.length > MAX_SCRIPT_LINES) {
      errors.push({
        line: 0,
        message: `An OSC script cannot have more than ${MAX_SCRIPT_LINES} lines.`,
      });
    }
    lines = lines.filter((l) => !!l.text);
    for (let line of lines) {
      if (!line.text.trim()) {
        continue;
      }
      let match;
      if ((match = line.text.match(SLEEP_ACTION_REGEX))) {
        let duration = parseFloat(match.groups!['VALUE']);
        const unit: 's' | 'ms' = (match.groups!['UNIT'] as 's' | 'ms') || 'ms';
        if (unit === 'ms' && duration % 1 != 0) {
          errors.push({
            line: line.index,
            message: 'Millisecond values have to be defined as a whole number.',
          });
        }
        if (unit === 's') duration *= 1000;
        if (duration > 5000) {
          errors.push({
            line: line.index,
            message: 'Sleep duration cannot exceed 5 seconds.',
          });
        }
        totalSleepDuration += duration;
        if (totalSleepDuration > 10000) {
          errors.push({
            line: line.index,
            message: 'The total script duration cannot exceed 10 seconds.',
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
                message: `The value must be a valid float value between -1.0 and 1.0.`,
              });
            }
            break;
          case 'INT':
            value = parseInt(match.groups!['INT_VALUE']);
            if (isNaN(value) || value < 0 || value > 255) {
              errors.push({
                line: line.index,
                message: `The value must be a valid integer between 0 and 255.`,
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
            message: `A valid OSC address must always start with a '/' symbol.`,
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
          message: 'Invalid syntax.',
        });
      }
    }

    return { script, errors };
  }

  getErrorsForLine(lineNumber: number): ValidationError[] {
    return this.errors.filter((error) => error.line === lineNumber);
  }

  hoverOnLine(lineNumber: number, event?: MouseEvent) {
    this.tooltipErrors = this.getErrorsForLine(lineNumber);
    if (!event) return;
    const el: HTMLElement = event.target as HTMLElement;
    const x = el.offsetLeft + el.offsetWidth + 6;
    const y = el.offsetTop + el.offsetHeight + 4;
    this.tooltipPosition = { x, y };
  }

  formatCode() {
    const { script, errors } = this.parseScript(this._code.value);
    if (errors.length) return;
    this.script = script;
  }

  async testCode() {
    if (this.testing) return;
    const { script, errors } = this.parseScript(this._code.value);
    if (errors.length) return;
    this.testing = true;
    await Promise.all([
      this.osc.runScript(script),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    this.testing = false;
  }
}
