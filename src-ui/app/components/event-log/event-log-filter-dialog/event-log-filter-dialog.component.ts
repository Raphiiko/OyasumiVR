import { Component, OnInit } from '@angular/core';
import { BaseModalComponent } from '../../base-modal/base-modal.component';
import { EventLogType } from '../../../models/event-log-entry';
import { fadeUp } from '../../../utils/animations';

export interface EventLogFilterDialogInputModel {
  hiddenLogTypes: EventLogType[];
}

export interface EventLogFilterDialogOutputModel {
  hiddenLogTypes: EventLogType[];
}

interface Filter {
  id: EventLogFilter;
  eventLogTypes: EventLogType[];
}

export const EventLogFilters = [
  'SLEEP_MODE',
  'WINDOWS_POWER_POLICY',
  'BRIGHTNESS_CCT',
  'DEVICE_POWER',
  'GPU_CONTROL',
  'VRCHAT_STATUS',
  'VRCHAT_INVITES',
  'VRCHAT_AVATAR',
  'VRCHAT_GROUP',
  'AUDIO_CONTROL',
  'STEAMVR_SETTINGS',
  'SHUTDOWN_SEQUENCE',
  'BSB_CONTROL',
  'FRAME_LIMITING',
  'RUN_AUTOMATIONS',
] as const;

export type EventLogFilter = (typeof EventLogFilters)[number];

@Component({
  selector: 'app-event-log-filter-dialog',
  templateUrl: './event-log-filter-dialog.component.html',
  styleUrl: './event-log-filter-dialog.component.scss',
  animations: [fadeUp()],
  standalone: false,
})
export class EventLogFilterDialogComponent
  extends BaseModalComponent<EventLogFilterDialogInputModel, EventLogFilterDialogOutputModel>
  implements OnInit, EventLogFilterDialogInputModel
{
  protected readonly filters: Filter[] = [
    {
      id: 'SLEEP_MODE',
      eventLogTypes: ['sleepModeEnabled', 'sleepModeDisabled', 'sleepDetectorEnableCancelled'],
    },
    {
      id: 'WINDOWS_POWER_POLICY',
      eventLogTypes: ['windowsPowerPolicySet'],
    },
    {
      id: 'BRIGHTNESS_CCT',
      eventLogTypes: [
        'simpleBrightnessChanged',
        'hardwareBrightnessChanged',
        'softwareBrightnessChanged',
        'cctChanged',
      ],
    },
    {
      id: 'DEVICE_POWER',
      eventLogTypes: ['turnedOffOpenVRDevices', 'lighthouseSetPowerState'],
    },
    {
      id: 'GPU_CONTROL',
      eventLogTypes: ['gpuPowerLimitChanged', 'msiAfterburnerProfileSet'],
    },
    {
      id: 'VRCHAT_STATUS',
      eventLogTypes: ['statusChangedOnPlayerCountChange', 'statusChangedOnGeneralEvent'],
    },
    {
      id: 'VRCHAT_INVITES',
      eventLogTypes: ['acceptedInviteRequest', 'declinedInviteRequest', 'declinedInvite'],
    },
    {
      id: 'VRCHAT_AVATAR',
      eventLogTypes: ['vrchatAvatarChanged'],
    },
    {
      id: 'VRCHAT_GROUP',
      eventLogTypes: ['vrchatGroupChanged'],
    },
    {
      id: 'AUDIO_CONTROL',
      eventLogTypes: [
        'changedVRChatMicMuteState',
        'changedSystemMicMuteState',
        'changedSystemMicControllerButtonBehavior',
        'changedAudioDeviceVolume',
        'mutedAudioDevice',
        'unmutedAudioDevice',
      ],
    },
    {
      id: 'STEAMVR_SETTINGS',
      eventLogTypes: ['renderResolutionChanged', 'chaperoneFadeDistanceChanged'],
    },
    {
      id: 'SHUTDOWN_SEQUENCE',
      eventLogTypes: ['shutdownSequenceStarted', 'shutdownSequenceCancelled'],
    },
    {
      id: 'BSB_CONTROL',
      eventLogTypes: ['bsbFanSpeedChanged', 'bsbLedChanged'],
    },
    {
      id: 'FRAME_LIMITING',
      eventLogTypes: ['frameLimitChanged'],
    },
    {
      id: 'RUN_AUTOMATIONS',
      eventLogTypes: ['runAutomationExecuted'],
    },
  ];
  // Type this as the id field of the Filter interface
  selectedFilters: EventLogFilter[] = [];

  public set hiddenLogTypes(types: EventLogType[]) {
    this.selectedFilters = this.filters
      .filter((filter) => !types.some((type) => filter.eventLogTypes.includes(type)))
      .map((filter) => filter.id);
  }

  constructor() {
    super();
    this.result = { hiddenLogTypes: [] };
  }

  ngOnInit(): void {}

  async save() {
    this.result = { hiddenLogTypes: this.getHiddenTypesForFilters() };
    await this.close();
  }

  private getHiddenTypesForFilters(): EventLogType[] {
    return this.filters
      .filter((f) => !this.selectedFilters.includes(f.id))
      .map((f) => f.eventLogTypes)
      .flat()
      .filter(Boolean) as EventLogType[];
  }

  protected toggleFilter(id: EventLogFilter) {
    if (this.selectedFilters.includes(id)) {
      this.selectedFilters = this.selectedFilters.filter((f) => f !== id);
    } else {
      this.selectedFilters.push(id);
    }
  }

  selectNone() {
    this.selectedFilters = [];
  }

  selectAll() {
    this.selectedFilters = this.filters.map((f) => f.id);
  }
}
