import { Injectable } from '@angular/core';
import { readDir, BaseDirectory, readTextFile } from '@tauri-apps/api/fs';
import { metadata } from 'tauri-plugin-fs-extra-api';
import {
  BehaviorSubject,
  distinctUntilChanged,
  filter,
  interval,
  map,
  mergeMap,
  Observable,
  Subject,
  switchMap,
  take,
} from 'rxjs';
import { VRChatLogEvent, VRChatLogEventType } from '../models/vrchat-log-event';
import * as moment from 'moment';
import { readTextFromFile } from '../utils/fs';
import { listen } from '@tauri-apps/api/event';
import { DeviceUpdateEvent } from '../models/events';
import { invoke } from '@tauri-apps/api';

interface RawLogEvent {
  time: number;
  event: string;
  data: string;
  initialLoad: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class VRChatLogService {
  private _logEvents: Subject<VRChatLogEvent> = new Subject<VRChatLogEvent>();
  public logEvents: Observable<VRChatLogEvent> = this._logEvents.asObservable();

  constructor() {}

  async init() {
    await listen<RawLogEvent>('VRC_LOG_EVENT', (event) => this.handleLogEvent(event.payload));
    await invoke('init_vrc_log_watcher');
  }

  private handleLogEvent(event: RawLogEvent) {
    switch (event.event) {
      case 'OnPlayerJoined':
        this._logEvents.next({
          type: 'OnPlayerJoined',
          timestamp: moment.unix(event.time).toDate(),
          displayName: event.data,
          initialLoad: event.initialLoad,
        });
        break;
      case 'OnPlayerLeft':
        this._logEvents.next({
          type: 'OnPlayerLeft',
          timestamp: moment.unix(event.time).toDate(),
          displayName: event.data,
          initialLoad: event.initialLoad,
        });
        break;
      case 'OnLocationChange':
        this._logEvents.next({
          type: 'OnLocationChange',
          timestamp: moment.unix(event.time).toDate(),
          instanceId: event.data,
          initialLoad: event.initialLoad,
        });
    }
  }
}
