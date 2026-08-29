import { Injectable } from '@angular/core';
import {
  EVENT_LOG_DEFAULT,
  EventLog,
  EventLogDraft,
  EventLogEntry,
} from '../models/event-log-entry';
import { async, BehaviorSubject, Observable, throttleTime } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

import { EVENT_LOG_STORE } from '../globals';
import { EventLogStoreWriter } from '../utils/event-log-store-writer';

const MAX_LOG_AGE = 48 * 60 * 60 * 1000;

@Injectable({
  providedIn: 'root',
})
export class EventLogService {
  private _eventLog: BehaviorSubject<EventLog> = new BehaviorSubject<EventLog>(
    structuredClone(EVENT_LOG_DEFAULT)
  );
  public eventLog: Observable<EventLog> = this._eventLog.asObservable();
  private storeWriter = new EventLogStoreWriter(EVENT_LOG_STORE);

  constructor() {}

  async init() {
    await this.loadEventLog();
    this._eventLog
      .pipe(throttleTime(5000, async, { leading: true, trailing: true }))
      .subscribe(() => this.saveEventLog());
  }

  public async clearLog() {
    const eventLog = structuredClone(EVENT_LOG_DEFAULT);
    this._eventLog.next(eventLog);
    await this.storeWriter.clear(eventLog);
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
    let log: EventLog | undefined = await EVENT_LOG_STORE.get<EventLog>('EVENT_LOG');
    if (!log) {
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
    const eventLog = this._eventLog.value;
    await this.storeWriter.save(eventLog);
  }
}
