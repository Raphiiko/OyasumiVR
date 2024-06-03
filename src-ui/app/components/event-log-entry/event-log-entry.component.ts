import { Component, DestroyRef, Input, OnChanges, OnInit } from '@angular/core';
import { EventLogEntry } from '../../models/event-log-entry';
import { EventLogEntryParser } from './event-log-entry-parser';
import { EventLogSleepModeEnabledEntryParser } from './entry-parsers/sleep-mode-enabled';
import { EventLogSleepModeDisabledEntryParser } from './entry-parsers/sleep-mode-disabled';
import { EventLogTurnedOffOpenVRDevicesEntryParser } from './entry-parsers/openvr-device-turned-off';
import { EventLogGpuPowerLimitChangedEntryParser } from './entry-parsers/gpu-power-limit-changed';
import { EventLogAcceptedInviteRequestEntryParser } from './entry-parsers/accepted-invite-request';
import { EventLogStatusChangedOnPlayerCountChangeEntryParser } from './entry-parsers/status-changed-on-player-count-change';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { TranslateService } from '@ngx-translate/core';
import { EventLogSleepDetectorEnableCancelledEntryParser } from './entry-parsers/sleep-detector-enable-cancelled';
import { EventLogRenderResolutionChangedEntryParser } from './entry-parsers/render-resolution-changed';
import { EventLogFadeDistanceChangedEntryParser } from './entry-parsers/fade-distance-changed';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EventLogLighthouseSetPowerStateEntryParser } from './entry-parsers/lighthouse-set-power-state';
import { EventLogShutdownSequenceStartedEntryParser } from './entry-parsers/shutdown-sequence-started';
import { EventLogShutdownSequenceCancelledEntryParser } from './entry-parsers/shutdown-sequence-cancelled';
import { EventLogHardwareBrightnessChangedEntryParser } from './entry-parsers/display-brightness-changed';
import { EventLogSoftwareBrightnessChangedEntryParser } from './entry-parsers/image-brightness-changed';
import { EventLogWindowsPowerPolicySetEntryParser } from './entry-parsers/windows-power-policy-set';
import { EventLogMsiAfterburnerProfileSetEntryParser } from './entry-parsers/msi-afterburner-profile-set';
import { EventLogSimpleBrightnessChangedEntryParser } from './entry-parsers/simple-brightness-changed';
import { EventLogChangedVRChatMicMuteStateEntryParser } from './entry-parsers/changed-vrchat-mic-mute-state';
import { EventLogChangedSystemMicControllerButtonBehaviorEntryParser } from './entry-parsers/changed-system-mic-controller-button-behavior';
import { EventLogChangedSystemMicMuteStateEntryParser } from './entry-parsers/changed-system-mic-mute-state';
import { EventLogChangedAudioDeviceVolumeEntryParser } from './entry-parsers/changed-audio-device-volume';
import { EventLogMutedAudioDeviceEntryParser } from './entry-parsers/muted-audio-device';
import { EventLogUnmutedAudioDeviceEntryParser } from './entry-parsers/unmuted-audio-device';
import { EventLogBSBFanSpeedChangedEntryParser } from './entry-parsers/bsb-fan-speed-changed';
import { EventLogBSBLedChangedEntryParser } from './entry-parsers/bsb-led-changed';
import { EventLogStatusChangedOnGeneralEventEntryParser } from './entry-parsers/status-changed-on-general-event';

@Component({
  selector: 'app-event-log-entry',
  templateUrl: './event-log-entry.component.html',
  styleUrls: ['./event-log-entry.component.scss'],
})
export class EventLogEntryComponent implements OnInit, OnChanges {
  parser?: EventLogEntryParser<any>;
  headerInfoTitle?: SafeHtml;
  headerInfoSubTitle?: SafeHtml;

  private readonly parsers: EventLogEntryParser<EventLogEntry>[] = [
    new EventLogSleepModeEnabledEntryParser(),
    new EventLogSleepModeDisabledEntryParser(),
    new EventLogTurnedOffOpenVRDevicesEntryParser(),
    new EventLogLighthouseSetPowerStateEntryParser(),
    new EventLogGpuPowerLimitChangedEntryParser(),
    new EventLogSimpleBrightnessChangedEntryParser(),
    new EventLogHardwareBrightnessChangedEntryParser(),
    new EventLogSoftwareBrightnessChangedEntryParser(),
    new EventLogAcceptedInviteRequestEntryParser(),
    new EventLogStatusChangedOnPlayerCountChangeEntryParser(),
    new EventLogStatusChangedOnGeneralEventEntryParser(),
    new EventLogSleepDetectorEnableCancelledEntryParser(),
    new EventLogRenderResolutionChangedEntryParser(),
    new EventLogFadeDistanceChangedEntryParser(),
    new EventLogShutdownSequenceStartedEntryParser(),
    new EventLogShutdownSequenceCancelledEntryParser(),
    new EventLogWindowsPowerPolicySetEntryParser(),
    new EventLogMsiAfterburnerProfileSetEntryParser(),
    new EventLogChangedVRChatMicMuteStateEntryParser(),
    new EventLogChangedSystemMicMuteStateEntryParser(),
    new EventLogChangedSystemMicControllerButtonBehaviorEntryParser(),
    new EventLogChangedAudioDeviceVolumeEntryParser(),
    new EventLogMutedAudioDeviceEntryParser(),
    new EventLogUnmutedAudioDeviceEntryParser(),
    new EventLogBSBFanSpeedChangedEntryParser(),
    new EventLogBSBLedChangedEntryParser(),
  ];

  constructor(
    private sanitizer: DomSanitizer,
    private translate: TranslateService,
    private destroyRef: DestroyRef
  ) {}

  _entry?: EventLogEntry;
  @Input() set entry(entry: EventLogEntry | undefined) {
    this._entry = entry;
    this.rebuild();
  }

  get entry(): EventLogEntry | undefined {
    return this._entry;
  }

  ngOnInit() {
    this.ngOnChanges();
    this.translate.onLangChange
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.rebuild());
  }

  ngOnChanges() {
    this.parser = this.parsers.find((parser) => parser.entryType() === this.entry?.type);
    this.rebuild();
  }

  rebuild() {
    if (!this.parser) return;
    let key = this.parser.headerInfoTitle(this._entry);
    if (key) {
      this.headerInfoTitle = this.sanitizer.bypassSecurityTrustHtml(
        this.translate.instant(key, this.parser?.headerInfoTitleParams(this._entry) ?? {})
      );
    }
    key = this.parser.headerInfoSubTitle(this._entry);
    if (key) {
      this.headerInfoSubTitle = this.sanitizer.bypassSecurityTrustHtml(
        this.translate.instant(key, this.parser?.headerInfoSubTitleParams(this._entry) ?? {})
      );
    }
  }
}
