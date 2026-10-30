import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { VRChatLogEvent } from '../models/vrchat-log-event';
import { commands, events, VRCLogEvent } from 'src-ui/app/bindings';

@Injectable({
  providedIn: 'root',
})
export class VRChatLogService {
  private readonly _initialLoadComplete: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(
    false
  );
  public readonly initialLoadComplete: Observable<boolean> =
    this._initialLoadComplete.asObservable();
  private readonly _logEvents: Subject<VRChatLogEvent> = new Subject<VRChatLogEvent>();
  public readonly logEvents: Observable<VRChatLogEvent> = this._logEvents.asObservable();
  private readonly _logPath = new BehaviorSubject<string | null>(null);
  public readonly logPath: Observable<string | null> = this._logPath.asObservable();

  constructor() {}

  async init() {
    await events.vrcLogEvent.listen((event) => this.handleLogEvent(event.payload));
    await events.vrcLogCurrentFileEvent.listen((event) => this._logPath.next(event.payload));
    await commands.initVrcLogWatcher();
  }

  private handleLogEvent(event: VRCLogEvent) {
    switch (event.event) {
      case 'InitialLoadComplete':
        this._initialLoadComplete.next(true);
        break;
      case 'OnPlayerJoined': {
        const { displayName, userId } = this.parseNameAndId(event.data);
        this._logEvents.next({
          type: 'OnPlayerJoined',
          timestamp: new Date(event.time),
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
          timestamp: new Date(event.time),
          initialLoad: event.initialLoad,
          displayName,
          userId,
        });
        break;
      }
      case 'OnLocationChange':
        this._logEvents.next({
          type: 'OnLocationChange',
          timestamp: new Date(event.time),
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
