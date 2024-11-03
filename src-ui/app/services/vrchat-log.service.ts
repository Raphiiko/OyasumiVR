import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { VRChatLogEvent } from '../models/vrchat-log-event';
import * as moment from 'moment';
import { listen } from '@tauri-apps/api/event';
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
  private _initialLoadComplete: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public initialLoadComplete: Observable<boolean> = this._initialLoadComplete.asObservable();
  private _logEvents: Subject<VRChatLogEvent> = new Subject<VRChatLogEvent>();
  public logEvents: Observable<VRChatLogEvent> = this._logEvents.asObservable();

  constructor() {}

  async init() {
    await listen<RawLogEvent>('VRC_LOG_EVENT', (event) => this.handleLogEvent(event.payload));
    await invoke('init_vrc_log_watcher');
  }

  private handleLogEvent(event: RawLogEvent) {
    switch (event.event) {
      case 'InitialLoadComplete':
        this._initialLoadComplete.next(true);
        break;
      case 'OnPlayerJoined': {
        const { displayName, userId } = this.parseNameAndId(event.data);
        this._logEvents.next({
          type: 'OnPlayerJoined',
          timestamp: moment.unix(event.time).toDate(),
          initialLoad: event.initialLoad,
          displayName,
          userId,
        });
        break;
      }
      case 'OnPlayerLeft': {
        const { displayName, userId } = this.parseNameAndId(event.data);
        this._logEvents.next({
          type: 'OnPlayerLeft',
          timestamp: moment.unix(event.time).toDate(),
          initialLoad: event.initialLoad,
          displayName,
          userId,
        });
        break;
      }
      case 'OnLocationChange':
        this._logEvents.next({
          type: 'OnLocationChange',
          timestamp: moment.unix(event.time).toDate(),
          instanceId: event.data,
          initialLoad: event.initialLoad,
        });
    }
  }

  private parseNameAndId(data: string): { displayName: string; userId: string } {
    const parts = data.split(' ');
    if (
      parts.length > 1 &&
      parts[parts.length - 1].startsWith('(') &&
      parts[parts.length - 1].endsWith(')')
    ) {
      return {
        displayName: parts.slice(0, parts.length - 1).join(' '),
        userId: parts[parts.length - 1].slice(1, -1),
      };
    } else {
      return {
        displayName: data,
        userId: '',
      };
    }
  }
}
