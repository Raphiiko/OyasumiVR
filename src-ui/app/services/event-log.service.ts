import { Injectable } from '@angular/core';
import {
  EVENT_LOG_DEFAULT,
  EventLog,
  EventLogDraft,
  EventLogEntry,
} from '../models/event-log-entry';
import { async, BehaviorSubject, Observable, throttleTime } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { Store } from '@tauri-apps/plugin-store';
import { EVENT_LOG_FILE } from '../globals';

import { migrateEventLog } from '../migrations/event-log.migrations';

const MAX_LOG_AGE = 48 * 60 * 60 * 1000;

@Injectable({
  providedIn: 'root',
})
export class EventLogService {
  private store = new Store(EVENT_LOG_FILE);
  private _eventLog: BehaviorSubject<EventLog> = new BehaviorSubject<EventLog>(
    structuredClone(EVENT_LOG_DEFAULT)
  );
  public eventLog: Observable<EventLog> = this._eventLog.asObservable();

  constructor() {}

  async init() {
    await this.loadEventLog();
    this._eventLog
      .pipe(throttleTime(5000, async, { leading: true, trailing: true }))
      .subscribe(() => this.saveEventLog());
  }

  public clearLog() {
    this._eventLog.next(structuredClone(EVENT_LOG_DEFAULT));
  }

  public logEvent(event: EventLogDraft) {
    const fullEvent = { ...event, id: uuidv4(), time: Date.now() } as EventLogEntry;
    const events = this._eventLog.value.logs;
    // Add new event
    events.splice(0, 0, fullEvent);
    // Remove events that are too old
    while (true) {
      const cutoff = Date.now() - MAX_LOG_AGE;
      const index = events.findIndex((e) => e.time < cutoff);
      if (index !== -1) {
        events.splice(index, 1);
        continue;
      }
      break;
    }
    // Update the event log
    this._eventLog.next(this._eventLog.value);
  }

  private async loadEventLog() {
    let log: EventLog | null = await this.store.get<EventLog>('EVENT_LOG');
    if (log) {
      log = migrateEventLog(log);
    } else {
      log = this._eventLog.value;
    }
    // Remove events that are too old
    const events = log.logs;
    while (true) {
      const cutoff = Date.now() - MAX_LOG_AGE;
      const index = events.findIndex((e) => e.time < cutoff);
      if (index !== -1) {
        events.splice(index, 1);
        continue;
      }
      break;
    }
    // Update the event log
    this._eventLog.next(log);
  }

  private async saveEventLog() {
    await this.store.set('EVENT_LOG', this._eventLog.value);
    await this.store.save();
  }
}
