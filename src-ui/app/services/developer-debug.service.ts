import { inject, Injectable } from '@angular/core';
import { SleepModeForSleepDetectorAutomationService } from './sleep-detection-automations/sleep-mode-for-sleep-detector-automation.service';
import { firstValueFrom, interval, Subject, Subscription } from 'rxjs';
import { message, save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';

@Injectable({
  providedIn: 'root',
})
export class DeveloperDebugService {
  public sleepDetectionDebugger = new SleepDetectionDebugger();

  constructor() {}

  async init() {}
}

class SleepDetectionDebugger {
  private sleepDetector = inject(SleepModeForSleepDetectorAutomationService);
  timeData: SDDFrame[] = [];
  lastTimeRecorded = 0;
  frameCollectionSubscription?: Subscription;
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
    this.frameCollectionSubscription = interval(200)
      .pipe()
      .subscribe(() => this.collectFrame());
    this.cleanUpSubscription = interval(60000)
      .pipe()
      .subscribe(() => this.cleanUpFrames());
  }

  stop() {
    this.started = false;
    this.frameCollectionSubscription?.unsubscribe();
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

  private cleanUpFrames() {
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    const twentyFourHoursAgo = now - twentyFourHours;
    const index = this.timeData.findIndex((frame) => frame.time > twentyFourHoursAgo);
    if (index >= 0) {
      this.timeData.splice(0, index);
    }
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
    };
    try {
      await writeTextFile(filePath, JSON.stringify(data));
    } catch (e) {
      await message('Sleep data has been exported', 'File Saved');
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
