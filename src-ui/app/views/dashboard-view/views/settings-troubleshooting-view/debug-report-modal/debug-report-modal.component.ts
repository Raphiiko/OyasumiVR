import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { commands, Value } from '../../../../../bindings';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { error } from '@tauri-apps/plugin-log';
import { BaseModalComponent } from '../../../../../components/base-modal/base-modal.component';
import { DebugReportService } from '../../../../../services/debug-report.service';
import { FileDialogService } from '../../../../../services/file-dialog.service';
import { ModalOptions } from '../../../../../services/modal.service';
import { ToastService } from '../../../../../services/toast.service';
import { fadeUp } from '../../../../../utils/animations';

export interface DebugReportModalInputModel {
  collectUiState: () => Promise<Record<string, unknown>>;
}

type Step = 'confirm' | 'uploading' | 'done' | 'failed' | 'tooLarge' | 'saving';

@Component({
  selector: 'app-debug-report-modal',
  templateUrl: './debug-report-modal.component.html',
  styleUrls: ['./debug-report-modal.component.scss'],
  animations: [fadeUp()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class DebugReportModalComponent
  extends BaseModalComponent<DebugReportModalInputModel, void>
  implements DebugReportModalInputModel, AfterViewInit, OnDestroy
{
  @ViewChild('cancelButton') cancelButton?: ElementRef<HTMLButtonElement>;
  collectUiState!: () => Promise<Record<string, unknown>>;
  step: Step = 'confirm';
  reportCode = '';
  codeCopied = false;
  /** The step to return to when saving fails. */
  private saveFallbackStep: Step = 'failed';
  /** Set once a zip exists, so a retry uploads the same zip and Save to file has one to write. */
  protected reportCreated = false;

  constructor(
    private toasts: ToastService,
    private debugReports: DebugReportService,
    private cdr: ChangeDetectorRef,
    private fileDialog: FileDialogService
  ) {
    super();
  }

  // the page button keeps focus otherwise, so Enter would not land on Cancel
  ngAfterViewInit() {
    this.cancelButton?.nativeElement.focus();
  }

  ngOnDestroy() {
    void this.discardReport();
  }

  override getOptionsOverride(): Partial<ModalOptions> {
    return { closeOnEscape: false };
  }

  async upload() {
    this.setStep('uploading');
    try {
      if (!this.reportCreated) {
        await commands.debugReportCreate((await this.collectUiState()) as Value);
        this.reportCreated = true;
      }
      this.reportCode = await commands.debugReportUpload();
      this.debugReports.setRecentCode(this.reportCode);
      this.setStep('done');
      await this.discardReport();
    } catch (e) {
      if (e === 'REPORT_TOO_LARGE') {
        this.setStep('tooLarge');
        return;
      }
      error(`[DebugReport] Could not upload the debug report: ${JSON.stringify(e)}`);
      this.setStep('failed');
    }
  }

  async saveToFile() {
    const now = new Date();
    const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
      .map((part) => part.toString().padStart(2, '0'))
      .join('-');
    const path = await this.fileDialog.save({
      defaultPath: `OyasumiVR-debug-report-${date}.zip`,
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    if (!path) return;
    this.saveFallbackStep = this.step;
    this.setStep('saving');
    try {
      await commands.debugReportSave(path);
    } catch (e) {
      error(`[DebugReport] Could not save the debug report: ${JSON.stringify(e)}`);
      this.toasts.show({ type: 'error', title: 'settings.troubleshooting.debugReport.saveFailed' });
      this.setStep(this.saveFallbackStep);
      return;
    }
    this.toasts.show({ type: 'success', title: 'settings.troubleshooting.debugReport.saved' });
    await this.close();
  }

  async copyCode() {
    try {
      await writeText(this.reportCode);
    } catch (e) {
      error(`[DebugReport] Could not copy the report code: ${e}`);
      this.toasts.show({ type: 'error', title: 'toasts.clipboard.failed' });
      return;
    }
    this.codeCopied = true;
    this.cdr.markForCheck();
    setTimeout(() => {
      this.codeCopied = false;
      this.cdr.markForCheck();
    }, 2000);
  }

  /** Drops the zip from the core's memory; only Retry and Save to file need it. */
  private async discardReport() {
    this.reportCreated = false;
    await commands.debugReportDiscard().catch((e) => {
      error(`[DebugReport] Could not discard the debug report: ${JSON.stringify(e)}`);
    });
  }

  private setStep(step: Step) {
    this.step = step;
    this.cdr.markForCheck();
  }
}
