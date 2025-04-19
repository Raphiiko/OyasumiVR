import { inject } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import {
  SleepDetectorStateReportHandlingResult,
  SleepModeForSleepDetectorAutomationService,
} from '../sleep-detection-automations/sleep-mode-for-sleep-detector-automation.service';
import { filter, firstValueFrom, interval, Subject, Subscription } from 'rxjs';
import { message, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';

export class SleepDetectionDebugger {
  private automationConfig = inject(AutomationConfigService);
  private sleepDetector = inject(SleepModeForSleepDetectorAutomationService);
  timeData: SDDFrame[] = [];
  lastTimeRecorded = 0;
  reportHandlingData: SDDStateEntry[] = [];
  frameCollectionSubscription?: Subscription;
  reportHandlingResultSubscription?: Subscription;
  cleanUpSubscription?: Subscription;
  thresholdValues: Array<{
    sensitivity: 'LOWEST' | 'LOW' | 'MEDIUM' | 'HIGH' | 'HIGHEST';
    threshold: number;
    active: boolean;
  }> = [];
  started = false;
  update = new Subject<void>();

  start() {
    if (this.started) return;
    this.started = true;
    this.thresholdValues = this.sleepDetector.getThresholdValues();
    this.frameCollectionSubscription = interval(200).subscribe(() => this.collectFrame());
    this.cleanUpSubscription = interval(60000).subscribe(() => this.cleanUpData());
    this.reportHandlingResultSubscription = this.sleepDetector.lastStateReportHandlingResult
      .pipe(filter(Boolean))
      .subscribe((result) => {
        // Update last entry
        if (
          this.reportHandlingData.length &&
          this.reportHandlingData[this.reportHandlingData.length - 1].result === result
        ) {
          const entry = this.reportHandlingData[this.reportHandlingData.length - 1];
          entry.amountSeen++;
          entry.lastSeen = Date.now();
        }
        // Insert new entry
        else this.reportHandlingData.push(new SDDStateEntry(Date.now(), 1, Date.now(), result));
      });
  }

  stop() {
    this.started = false;
    this.frameCollectionSubscription?.unsubscribe();
    this.reportHandlingResultSubscription?.unsubscribe();
    this.cleanUpSubscription?.unsubscribe();
  }

  private async collectFrame() {
    const lastReport = await firstValueFrom(this.sleepDetector.lastStateReport);
    if (!lastReport) return;
    if (lastReport.lastLog <= this.lastTimeRecorded) return;
    this.lastTimeRecorded = lastReport.lastLog;
    this.timeData.push(new SDDFrame(lastReport.lastLog, lastReport.distanceInLast15Minutes));
    this.update.next();
  }

  private cleanUpData() {
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    const twentyFourHoursAgo = now - twentyFourHours;
    const index = this.timeData.findIndex((frame) => frame.time > twentyFourHoursAgo);
    if (index >= 0) {
      this.timeData.splice(0, index);
    }
    this.reportHandlingData = this.reportHandlingData.filter(
      (entry) => entry.lastSeen > twentyFourHoursAgo
    );
  }

  async exportData() {
    const filePath = await save({
      filters: [
        {
          name: 'JSON Data',
          extensions: ['json'],
        },
      ],
    });
    if (!filePath) return;
    const data = {
      timeData: this.timeData,
      thresholdValues: this.thresholdValues,
      reportHandlingData: this.reportHandlingData,
      config: await firstValueFrom(this.automationConfig.configs).then(
        (configs) => configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR
      ),
    };
    try {
      await writeTextFile(filePath, JSON.stringify(data));
      await message('Sleep data has been exported', 'Sleep Data Exported');
    } catch (e) {
      await message(
        'An error occurred and the sleep data could not be exported: ' + e,
        'Sleep data could not be exported'
      );
    }
  }
}

class SDDFrame {
  time: number;
  value: number;

  constructor(time: number, value: number) {
    this.time = time;
    this.value = value;
  }
}

class SDDStateEntry {
  firstSeen: number;
  amountSeen: number;
  lastSeen: number;
  result: SleepDetectorStateReportHandlingResult;

  constructor(
    firstSeen: number,
    amountSeen: number,
    lastSeen: number,
    result: SleepDetectorStateReportHandlingResult
  ) {
    this.firstSeen = firstSeen;
    this.amountSeen = amountSeen;
    this.lastSeen = lastSeen;
    this.result = result;
  }
}
