import { AfterViewInit, Component, DestroyRef, ElementRef, OnInit, ViewChild } from '@angular/core';
import { combineLatest, firstValueFrom, interval, map } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import * as uPlot from 'uplot';
import { AlignedData } from 'uplot';
import { SelectBoxItem } from '../../select-box/select-box.component';
import { DeveloperDebugService } from '../../../services/developer-debug/developer-debug.service';
import { AutomationConfigService } from '../../../services/automation-config.service';

@Component({
    selector: 'app-debug-sleep-detection-debugger',
    templateUrl: './debug-sleep-detection-debugger.component.html',
    styleUrls: ['./debug-sleep-detection-debugger.component.scss'],
    standalone: false
})
export class DebugSleepDetectionDebuggerComponent implements OnInit, AfterViewInit {
  resolutionItems: ({ interval?: number } & SelectBoxItem)[] = [
    { id: '24h', label: '24h', interval: 24 * 60 * 60 * 1000 },
    { id: '18h', label: '18h', interval: 18 * 60 * 60 * 1000 },
    { id: '12h', label: '12h', interval: 12 * 60 * 60 * 1000 },
    { id: '6h', label: '6h', interval: 6 * 60 * 60 * 1000 },
    { id: '2h', label: '2h', interval: 2 * 60 * 60 * 1000 },
    { id: '1h', label: '1h', interval: 60 * 60 * 1000 },
    { id: '30m', label: '30m', interval: 30 * 60 * 1000 },
    { id: '10m', label: '10m', interval: 10 * 60 * 1000 },
    { id: '5m', label: '5m', interval: 5 * 60 * 1000 },
    { id: '1m', label: '1m', interval: 60 * 1000 },
  ];
  selectedResolution: ({ interval?: number } & SelectBoxItem) | undefined = this.resolutionItems[2];
  sleepDetectionTimeSeriesPlot?: uPlot;

  @ViewChild('sleepDetectionTimeSeriesChart') sleepDetectionTimeSeriesChart?: ElementRef;

  constructor(
    public debug: DeveloperDebugService,
    private destroyRef: DestroyRef,
    private automationConfigService: AutomationConfigService
  ) {}

  ngOnInit() {
    console.log('Developer debug modal opened');
    combineLatest([this.debug.sleepDetectionDebugger.update, interval(2000)])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async () => {
        if (!this.sleepDetectionTimeSeriesPlot) return;
        this.sleepDetectionTimeSeriesPlot.setData(await this.buildSleepData());
      });
  }

  ngAfterViewInit() {
    const data: AlignedData = [[], []];
    const opts: uPlot.Options = {
      width: 800,
      height: 500,
      axes: [
        {
          stroke: '#FFFFFF',
        },
        {
          stroke: '#FFFFFF',
        },
      ],
      series: [
        {},
        {
          // series style
          stroke: 'red',
          width: 1,
          label: 'Sleep Value',
        },
      ],
    };
    this.sleepDetectionTimeSeriesPlot = new window.uPlot(
      opts,
      data,
      this.sleepDetectionTimeSeriesChart?.nativeElement
    );
  }

  asSelectBoxItem(item: ({ interval?: number } & SelectBoxItem) | undefined): SelectBoxItem {
    return item!;
  }

  async buildSleepData(): Promise<AlignedData> {
    const sensitivity = await firstValueFrom(
      this.automationConfigService.configs.pipe(
        map((c) => c.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.sensitivity)
      )
    );
    const oldestAllowed = Date.now() - (this.selectedResolution!.interval ?? 0);
    const xSeries: number[] = [];
    const ySeries: number[] = [];
    const sleepDetectionDebugger = this.debug.sleepDetectionDebugger;
    const sleepDetectionData = sleepDetectionDebugger.timeData;
    const sleepDetectionDataLength = sleepDetectionData.length;
    for (let i = 0; i < sleepDetectionDataLength; i++) {
      if (sleepDetectionData[i].time < oldestAllowed) continue;
      const sleepDetectionDataItem = sleepDetectionData[i];
      xSeries.push(sleepDetectionDataItem.time / 1000);
      ySeries.push(sleepDetectionDataItem.value);
    }
    const data: AlignedData = [xSeries, ySeries];
    // Draw thresholds
    sleepDetectionDebugger.thresholdValues.forEach((thresholdValue, i) => {
      const series: (number | null)[] = [];
      for (let i = 0; i < xSeries.length; i++) {
        series.push(thresholdValue.threshold);
      }
      data.push(series);
      if (this.sleepDetectionTimeSeriesPlot!.series.length <= 2 + i) {
        this.sleepDetectionTimeSeriesPlot?.addSeries({
          width: 1,
          label: thresholdValue.sensitivity,
          points: {
            show: false,
          },
          stroke: thresholdValue.sensitivity === sensitivity ? '#FFFF00FF' : '#FFFF0044',
        });
      }
    });
    return data;
  }
}
