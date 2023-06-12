import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  bufferTime,
  combineLatest,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  merge,
  Observable,
  startWith,
  Subject,
} from 'rxjs';
import { SleepModeStatusChangeReason } from '../models/sleep-mode';
import { SETTINGS_FILE, SETTINGS_KEY_SLEEP_MODE } from '../globals';
import { Store } from 'tauri-plugin-store-api';
import { SleepingPose } from '../models/sleeping-pose';
import { uniq } from 'lodash';
import { OpenVRService } from './openvr.service';
import { OVRDevicePose } from '../models/ovr-device';
import { SleepingPoseDetector } from '../utils/sleeping-pose-detector';
import * as THREE from 'three';
import { info } from 'tauri-plugin-log-api';
import { NotificationService } from './notification.service';
import { TranslateService } from '@ngx-translate/core';
import { EventLogService } from './event-log.service';
import { EventLogSleepModeDisabled, EventLogSleepModeEnabled } from '../models/event-log-entry';
import { AppSettingsService } from './app-settings.service';

@Injectable({
  providedIn: 'root',
})
export class SleepService {
  private store = new Store(SETTINGS_FILE);
  private _mode: BehaviorSubject<boolean | null> = new BehaviorSubject<boolean | null>(null);
  public mode: Observable<boolean> = this._mode.asObservable().pipe(
    filter((v) => v !== null),
    map((v) => v as boolean)
  );
  private poseDetector: SleepingPoseDetector = new SleepingPoseDetector();
  private forcePose$: Subject<SleepingPose> = new Subject<SleepingPose>();

  public pose: Observable<SleepingPose> = merge(
    combineLatest([this.openvr.devices, this.openvr.devicePoses]).pipe(
      map(([devices, poses]) => {
        const hmdDevice = devices.find((d) => d.class === 'HMD');
        if (!hmdDevice) return null;
        return poses[hmdDevice.index] || null;
      }),
      filter((hmdPose) => hmdPose !== null),
      map((hmdPose) => this.getSleepingPoseForDevicePose(hmdPose!)),
      bufferTime(1000),
      filter((buffer) => buffer.length >= 2 && uniq(buffer).length === 1),
      map((buffer) => buffer[0] as SleepingPose)
    ),
    this.forcePose$
  ).pipe(startWith('UNKNOWN' as SleepingPose), distinctUntilChanged()) as Observable<SleepingPose>;

  constructor(
    private openvr: OpenVRService,
    private notifications: NotificationService,
    private translate: TranslateService,
    private eventLog: EventLogService,
    private appSettings: AppSettingsService
  ) {}

  async init() {
    const settings = await firstValueFrom(this.appSettings.settings);
    let mode: boolean;
    switch (settings.sleepModeStartupBehaviour) {
      case 'PERSIST':
        mode = (await this.store.get<boolean>(SETTINGS_KEY_SLEEP_MODE)) || false;
        break;
      case 'ACTIVE':
        mode = true;
        break;
      case 'INACTIVE':
        mode = false;
        break;
    }
    this._mode.next(mode);
  }

  forcePose(pose: SleepingPose) {
    this.forcePose$.next(pose);
  }

  getPoseDetectorScene(): THREE.Scene {
    return this.poseDetector.getScene();
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
    await this.store.set(SETTINGS_KEY_SLEEP_MODE, true);
    await this.store.save();
    await this.notifications.send(
      this.translate.instant('notifications.sleepModeEnabled.title'),
      this.translate.instant('notifications.sleepModeEnabled.content')
    );
  }

  async disableSleepMode(reason: SleepModeStatusChangeReason) {
    if (!this._mode.value) return;
    reason.enabled = false;
    info(`[Sleep] Sleep mode disabled (reason=${reason.type})`);
    this.eventLog.logEvent({
      type: 'sleepModeDisabled',
      reason: reason,
    } as EventLogSleepModeDisabled);
    this._mode.next(false);
    await this.store.set(SETTINGS_KEY_SLEEP_MODE, false);
    await this.store.save();
    await this.notifications.send(
      this.translate.instant('notifications.sleepModeDisabled.title'),
      this.translate.instant('notifications.sleepModeDisabled.content')
    );
  }

  private getSleepingPoseForDevicePose(pose: OVRDevicePose): SleepingPose {
    if (!pose) return this.poseDetector.sleepingPose;
    this.poseDetector.processOrientation(pose.quaternion);
    return this.poseDetector.sleepingPose;
  }
}
