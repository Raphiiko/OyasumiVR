import { Component, Input, OnInit, Output, EventEmitter, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, map } from 'rxjs';
import { FrameLimitConfigOption, FrameLimitConfigOptions } from 'src-ui/app/models/automations';
import { TString } from 'src-ui/app/models/translatable-string';
import { OpenVRService } from 'src-ui/app/services/openvr.service';
import { vshrink } from 'src-ui/app/utils/animations';

@Component({
  selector: 'app-frame-limiter-selector',
  templateUrl: './frame-limiter-selector.component.html',
  styleUrls: ['./frame-limiter-selector.component.scss'],
  standalone: false,
  animations: [vshrink()],
})
export class FrameLimiterSelectorComponent implements OnInit {
  @Input() activeValue?: FrameLimitConfigOption;
  @Input() configuredValue?: FrameLimitConfigOption;
  @Output() valueRequested = new EventEmitter<FrameLimitConfigOption>();

  hmdDisplayFrequency: number | undefined;
  frameLimitConfigOptions = FrameLimitConfigOptions.filter((o) => o !== 'DISABLED');

  constructor(private readonly openvr: OpenVRService, private destroyRef: DestroyRef) {}

  ngOnInit(): void {
    this.openvr.devices
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        map((devices) => devices.find((d) => d.class === 'HMD')?.displayFrequency),
        distinctUntilChanged()
      )
      .subscribe((displayFrequency) => {
        this.hmdDisplayFrequency = displayFrequency;
      });
  }

  selectOption(value: FrameLimitConfigOption): void {
    this.valueRequested.emit(value);
  }

  getLabelForOption(option: FrameLimitConfigOption): string {
    switch (option) {
      case 'DISABLED':
        return 'frame-limiter.selector.disabled';
      case 'AUTO':
        return 'frame-limiter.selector.auto';
      case 0:
        return 'frame-limiter.selector.noLimit';
      default:
        if (typeof option === 'number') {
          return Math.round((1 / (option + 1)) * 100) + '%';
        }
        return '';
    }
  }

  getFpsForOption(option: FrameLimitConfigOption): string {
    if (!this.hmdDisplayFrequency || typeof option !== 'number' || option === 0) return '';
    const fps = Math.round((1 / (option + 1)) * this.hmdDisplayFrequency);
    return `~${fps}fps`;
  }

  getTooltipForOption(option: FrameLimitConfigOption): TString | undefined {
    if (option === 'AUTO') {
      return 'frame-limiter.selector.autoDescription';
    }
    return undefined;
  }
}
