import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { EventLogService } from '../../services/event-log.service';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { EventLogEntry, EventLogType } from '../../models/event-log-entry';
import { EventLogEntryParsers } from './event-log-entry/event-log-entry-parsers.service';
import { fade, hshrink, noop, vshrink } from '../../utils/animations';
import { ModalService } from 'src-ui/app/services/modal.service';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../confirm-modal/confirm-modal.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppSettingsService } from '../../services/app-settings.service';
import {
  EventLogCause,
  EventLogGroup,
  EventLogItem,
  eventLogItemTime,
  groupEventLog,
} from './event-log-grouping';

const CAUSE_ICONS: Record<EventLogCause, string> = {
  sleepModeEnabled: 'sleep',
  sleepModeDisabled: 'sleep-off',
  sleepPreparation: 'bed',
  sunset: 'sunset',
  sunrise: 'sunrise',
};

/** A row in the filter popover; `id` names its key under `comp.event-log.filters.categories`. */
interface FilterCategory {
  id: string;
  group: string;
  icon: string;
  types: EventLogType[];
}

const category = (group: string, icon: string, id: string, types: EventLogType[]) => ({
  id,
  group,
  icon,
  types,
});

// an empty group draws its rows without a group header
const FILTER_CATEGORIES: FilterCategory[] = [
  category('', 'sleep', 'sleepMode', [
    'sleepModeEnabled',
    'sleepModeDisabled',
    'sleepDetectorEnableCancelled',
  ]),
  category('vrchat', 'status', 'vrchatStatus', [
    'statusChangedOnPlayerCountChange',
    'statusChangedOnGeneralEvent',
  ]),
  category('vrchat', 'invite', 'vrchatInvites', [
    'acceptedInviteRequest',
    'declinedInviteRequest',
    'failedInviteRequest',
    'declinedInvite',
  ]),
  category('vrchat', 'mic-off', 'vrchatMicMute', ['changedVRChatMicMuteState']),
  category('vrchat', 'avatar', 'vrchatAvatar', ['vrchatAvatarChanged']),
  category('vrchat', 'group', 'vrchatGroup', ['vrchatGroupChanged']),
  category('hardware', 'base-station', 'devicePower', [
    'turnedOffOpenVRDevices',
    'lighthouseSetPowerState',
  ]),
  category('hardware', 'battery-settings', 'windowsPowerPolicy', ['windowsPowerPolicySet']),
  category('hardware', 'gpu', 'gpu', ['gpuPowerLimitChanged', 'msiAfterburnerProfileSet']),
  category('hardware', 'brightness-cct', 'brightnessCct', [
    'simpleBrightnessChanged',
    'hardwareBrightnessChanged',
    'softwareBrightnessChanged',
    'cctChanged',
  ]),
  category('hardware', 'fan', 'bigscreenBeyond', ['bsbFanSpeedChanged', 'bsbLedChanged']),
  category('hardware', 'volume', 'volume', [
    'changedAudioDeviceVolume',
    'mutedAudioDevice',
    'unmutedAudioDevice',
  ]),
  category('hardware', 'mic', 'systemMic', [
    'changedSystemMicMuteState',
    'changedSystemMicControllerButtonBehavior',
  ]),
  category('hardware', 'resolution', 'resolution', ['renderResolutionChanged']),
  category('general', 'shutdown', 'shutdownSequence', [
    'shutdownSequenceStarted',
    'shutdownSequenceCancelled',
    'shutdownSequenceStepFailed',
  ]),
  category('general', 'chaperone', 'fadeDistance', ['chaperoneFadeDistanceChanged']),
  category('general', 'monitor-gauge', 'frameLimiting', ['frameLimitChanged']),
  category('general', 'run', 'runCommands', ['runAutomationExecuted']),
];

const FILTER_GROUP_ICONS: Record<string, string> = {
  vrchat: 'vrchat',
  hardware: 'headset',
  general: 'automations',
};

const FILTER_GROUPS = [...new Set(FILTER_CATEGORIES.map((c) => c.group))].map((id) => ({
  id,
  icon: FILTER_GROUP_ICONS[id],
  categories: FILTER_CATEGORIES.filter((c) => c.group === id),
}));

@Component({
  selector: 'app-event-log',
  templateUrl: './event-log.component.html',
  styleUrls: ['./event-log.component.scss'],
  animations: [vshrink(), noop(), fade(), hshrink()],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class EventLogComponent implements OnInit, AfterViewInit {
  private readonly pageSize = 10;
  private showCount = new BehaviorSubject<number>(this.pageSize);
  protected entries = 0;

  protected itemsInView: Observable<EventLogItem[]>;
  protected expandedGroups = new Set<string>();
  animationPause = true;
  clearHover = false;
  filterHover = false;
  filters = new BehaviorSubject<EventLogType[]>([]);
  protected readonly categories = FILTER_CATEGORIES;
  protected readonly filterGroups = FILTER_GROUPS;
  protected categoryCounts: Record<string, number> = {};

  constructor(
    private eventLog: EventLogService,
    private cdr: ChangeDetectorRef,
    private modalService: ModalService,
    private appSettings: AppSettingsService,
    private parsers: EventLogEntryParsers
  ) {
    this.itemsInView = combineLatest([this.eventLog.eventLog, this.showCount, this.filters]).pipe(
      map(
        ([log, showCount, filters]) =>
          [groupEventLog(log.logs, filters), showCount] as [EventLogItem[], number]
      ),
      tap(([items]) => {
        this.entries = items.length;
        this.cdr.detectChanges();
      }),
      map(([items, showCount]) => items.slice(0, showCount)),
      takeUntilDestroyed()
    );
    this.eventLog.eventLog.pipe(takeUntilDestroyed()).subscribe((log) => {
      this.categoryCounts = {};
      for (const c of FILTER_CATEGORIES) {
        this.categoryCounts[c.id] = log.logs.filter((e) => c.types.includes(e.type)).length;
      }
    });
    this.appSettings.settings.pipe(takeUntilDestroyed()).subscribe((settings) => {
      this.filters.next(settings.eventLogTypesHidden);
    });
  }

  ngOnInit(): void {}

  ngAfterViewInit() {
    this.animationPause = false;
    this.cdr.detectChanges();
  }

  get pages(): number[] {
    const pages = Math.ceil(this.entries / this.pageSize);
    return Array.from(Array(pages).keys()).map((key) => key + 1);
  }

  protected causeIcon(group: EventLogGroup): string {
    return CAUSE_ICONS[group.cause];
  }

  protected groupTime(group: EventLogGroup): number {
    return eventLogItemTime(group);
  }

  protected warningCount(group: EventLogGroup): number {
    return group.entries.filter((entry) => this.parsers.isWarning(entry)).length;
  }

  /** False when the entry happened within the same second as its group header. */
  protected showEntryTime(entry: EventLogEntry, group: EventLogGroup): boolean {
    return Math.floor(entry.time / 1000) !== Math.floor(this.groupTime(group) / 1000);
  }

  protected toggleGroup(group: EventLogGroup) {
    if (!this.expandedGroups.delete(group.id)) this.expandedGroups.add(group.id);
  }

  showMore() {
    this.showCount.next(
      this.showCount.value + Math.min(this.pageSize, this.entries - this.showCount.value)
    );
  }

  hasMore(): boolean {
    return this.showCount.value < this.entries;
  }

  clearLog() {
    this.modalService
      .addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(ConfirmModalComponent, {
        title: 'comp.event-log.clearLogModal.title',
        message: 'comp.event-log.clearLogModal.message',
      })
      .subscribe((data) => {
        if (data?.confirmed) {
          this.eventLog.clearLog();
        }
      });
  }

  protected isHidden(category: FilterCategory): boolean {
    return category.types.some((t) => this.filters.value.includes(t));
  }

  protected get hiddenCategories(): FilterCategory[] {
    return FILTER_CATEGORIES.filter((c) => this.isHidden(c));
  }

  protected toggleCategory(category: FilterCategory) {
    this.setHidden([category], !this.isHidden(category));
  }

  protected toggleFilterGroup(group: (typeof FILTER_GROUPS)[number]) {
    this.setHidden(
      group.categories,
      group.categories.every((c) => !this.isHidden(c))
    );
  }

  protected groupAllShown(group: (typeof FILTER_GROUPS)[number]): boolean {
    return group.categories.every((c) => !this.isHidden(c));
  }

  protected showAll() {
    this.saveFilters([]);
  }

  private setHidden(categories: FilterCategory[], hidden: boolean) {
    const types = categories.flatMap((c) => c.types);
    const rest = this.filters.value.filter((t) => !types.includes(t));
    this.saveFilters(hidden ? [...rest, ...types] : rest);
  }

  private saveFilters(hidden: EventLogType[]) {
    this.filters.next(hidden);
    this.appSettings.updateSettings({ eventLogTypesHidden: hidden });
  }
}
