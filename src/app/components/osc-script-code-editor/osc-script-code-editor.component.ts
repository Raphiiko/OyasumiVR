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
import { OscParameterType, OscScript, OscScriptCodeValidationError } from '../../models/osc-script';
import { fade, hshrink, noop } from '../../utils/animations';
import { isEqual } from 'lodash';
import { OscService } from '../../services/osc.service';
import { parseOscScriptFromCode } from '../../utils/osc-script-utils';

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
    this.setScript(script, false);
  }

  @Output() scriptChange = new EventEmitter<OscScript>();
  @Output() errorCount = new EventEmitter<number>();
  @Output() validatedChange = new EventEmitter<boolean>();
  private destroy$: Subject<void> = new Subject<void>();
  private _code: BehaviorSubject<string> = new BehaviorSubject<string>('');
  errors: OscScriptCodeValidationError[] = [];
  tooltipErrors: OscScriptCodeValidationError[] = [];
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

  protected setScript(script: OscScript, force = false) {
    const { script: currentScript } = parseOscScriptFromCode(this._code.value);
    if (!force && isEqual(script, currentScript)) return;
    const code = this.scriptToCode(script);
    this._code.next(code);
    if (this.editorRef) this.editorRef.nativeElement.innerText = code;
  }

  ngOnInit(): void {
    this._code
      .pipe(
        takeUntil(this.destroy$),
        tap(() => (this.validated = false)),
        debounceTime(500)
      )
      .subscribe((code) => {
        this.tooltipErrors = [];
        const { script, errors } = parseOscScriptFromCode(code);
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

  getErrorsForLine(lineNumber: number): OscScriptCodeValidationError[] {
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
    const { script, errors } = parseOscScriptFromCode(this._code.value);
    if (errors.length) return;
    this.setScript(script, true);
  }

  async testCode() {
    if (this.testing) return;
    const { script, errors } = parseOscScriptFromCode(this._code.value);
    if (errors.length) return;
    this.testing = true;
    await Promise.all([
      this.osc.runScript(script),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    this.testing = false;
  }
}
