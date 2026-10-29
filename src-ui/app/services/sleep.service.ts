import { Injectable, NgZone } from '@angular/core';
import {
  BehaviorSubject,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  Observable,
  Subject,
} from 'rxjs';
import { SleepModeStatusChangeReason } from '../models/sleep-mode';
import { SETTINGS_KEY_SLEEP_MODE, SETTINGS_STORE } from '../globals';
import { SleepingPose } from '../models/sleeping-pose';
import { info } from '@tauri-apps/plugin-log';
import { NotificationService } from './notification.service';
import { TranslocoService } from '@jsverse/transloco';
import { EventLogService } from './event-log.service';
import { EventLogSleepModeDisabled, EventLogSleepModeEnabled } from '../models/event-log-entry';
import { AppSettingsService } from './app-settings.service';
import { listen } from '@tauri-apps/api/event';
import { commands, events } from '../bindings';

@Injectable({
  providedIn: 'root',
})
export class SleepService {
  private _mode: BehaviorSubject<boolean | null> = new BehaviorSubject<boolean | null>(null);
  public mode: Observable<boolean> = this._mode.asObservable().pipe(
    filter((v) => v !== null),
    map((v) => v as boolean)
  );
  private _pose = new BehaviorSubject<SleepingPose>('UNKNOWN');
  /** The stable sleeping pose the core detects from the headset. */
  public pose: Observable<SleepingPose> = this._pose.pipe(distinctUntilChanged());

  private readonly _onSleepModeChange = new Subject<{
    mode: boolean;
    reason: SleepModeStatusChangeReason;
  }>();
  public readonly onSleepModeChange: Observable<{
    mode: boolean;
    reason: SleepModeStatusChangeReason;
  }> = this._onSleepModeChange.asObservable();

  constructor(
    private notifications: NotificationService,
    private eventLog: EventLogService,
    private appSettings: AppSettingsService,
    private translate: TranslocoService,
    private zone: NgZone
  ) {}

  async init() {
    // Load default settings
    const settings = await firstValueFrom(this.appSettings.settings);
    let mode: boolean;
    switch (settings.sleepModeStartupBehaviour) {
      case 'PERSIST':
        mode = (await SETTINGS_STORE.get<boolean>(SETTINGS_KEY_SLEEP_MODE)) || false;
        break;
      case 'ACTIVE':
        mode = true;
        break;
      case 'INACTIVE':
        mode = false;
        break;
    }
    this._mode.next(mode);
    // follow the core's pose, then catch up on a change sent before the listener
    let updated = false;
    // Tauri runs event callbacks outside Angular's zone, so views would not refresh
    await events.sleepingPoseUpdateEvent.listen((e) => {
      updated = true;
      this.zone.run(() => this._pose.next(e.payload));
    });
    const pose = await commands.sleepingPoseGet();
    // events and command results arrive on separate channels, so an event can be newer
    if (!updated) this._pose.next(pose);
    // Handle events
    await listen<boolean>('setSleepMode', (e) => {
      if (e.payload) {
        this.enableSleepMode({ type: 'MANUAL' });
      } else {
        this.disableSleepMode({ type: 'MANUAL' });
      }
    });
  }

  async forcePose(pose: SleepingPose) {
    await commands.sleepingPoseForce(pose);
  }

  async enableSleepMode(reason: SleepModeStatusChangeReason) {
    if (this._mode.value) return;
    reason.enabled = true;
    info(`[Sleep] Sleep mode enabled (reason=${reason.type})`);
    this.eventLog.logEvent({
      type: 'sleepModeEnabled',
      reason: reason,
    } as EventLogSleepModeEnabled);
    this._mode.next(true);
    this._onSleepModeChange.next({ mode: true, reason });
    await SETTINGS_STORE.set(SETTINGS_KEY_SLEEP_MODE, true);
    if (await this.notifications.notificationTypeEnabled('SLEEP_MODE_ENABLED')) {
      await this.notifications.send(
        this.translate.translate('notifications.sleepModeEnabled.content')
      );
    }
  }

  async disableSleepMode(reason: SleepModeStatusChangeReason) {
    if (!this._mode.value) return;
    reason.enabled = false;
    info(`[Sleep] Sleep mode disabled (reason=${reason.type})`);
    this.eventLog.logEvent({
      type: 'sleepModeDisabled',
      reason,
    } as EventLogSleepModeDisabled);
    this._mode.next(false);
    this._onSleepModeChange.next({ mode: false, reason });
    await SETTINGS_STORE.set(SETTINGS_KEY_SLEEP_MODE, false);
    if (await this.notifications.notificationTypeEnabled('SLEEP_MODE_DISABLED')) {
      await this.notifications.send(
        this.translate.translate('notifications.sleepModeDisabled.content')
      );
    }
  }
}
