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
import { VRChatLogEvent } from '../models/vrchat-log-event';
import * as moment from 'moment';
import { readTextFromFile } from '../utils/fs';

// 450000

@Injectable({
  providedIn: 'root',
})
export class VRChatLogService {
  private _initialLoadComplete: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public initialLoadComplete: Observable<boolean> = this._initialLoadComplete
    .asObservable()
    .pipe(distinctUntilChanged());
  private lastReadFile: string | null = null;
  private lastReadLine: number = -1;
  private _logEvents: Subject<VRChatLogEvent> = new Subject<VRChatLogEvent>();
  public logEvents: Observable<VRChatLogEvent> = this._logEvents
    .asObservable()
    .pipe(map((event) => ((event.fromFirstLoad = !this._initialLoadComplete.value), event)));

  constructor() {}

  async init() {
    let isParsing = false;
    interval(1000)
      .pipe(
        filter(() => !isParsing),
        switchMap(async () => {
          isParsing = true;
          await this.parseLatestLog();
          isParsing = false;
        })
      )
      .subscribe();
  }

  private async parseLatestLog() {
    // Get log path
    const logPath = await this.getLatestLogPath();
    if (!logPath) return;
    // Read lines from log file
    const skipLines =
      this.lastReadFile === logPath && this.lastReadLine >= 0 ? this.lastReadLine + 1 : 0;
    const log = await readTextFromFile(logPath, skipLines);
    let lines = log !== null ? log.split(/\r?\n/) : [];
    if (lines.length > 0) {
      lines.forEach((line) => {
        [
          this.parseLineOnPlayerJoined,
          this.parseLineOnPlayerLeft,
          this.parseLineOnLocationChange,
        ].find((parser) => parser.bind(this)(line));
      });
    }
    // Save lines we have read
    this.lastReadLine = (this.lastReadFile === logPath ? this.lastReadLine : -1) + lines.length;
    this.lastReadFile = logPath;
    if (!this._initialLoadComplete.value) this._initialLoadComplete.next(true);
  }

  private async getLatestLogPath(): Promise<string | null> {
    // Get all log paths
    const logPaths = (
      await readDir('AppData\\LocalLow\\VRChat\\VRChat', {
        dir: BaseDirectory.Home,
      })
    )
      .filter(
        (entry) => entry.name && entry.name.startsWith('output_log_') && entry.name.endsWith('.txt')
      )
      .map((entry) => entry.path);
    // Return null if none found
    if (logPaths.length === 0) return null;
    // Fetch log file creation dates
    let meta = await Promise.all(
      logPaths.map(async (path) => ({
        path,
        createdAt: await metadata(path).then((data) => data.createdAt),
      }))
    );
    // Sort by creation date
    meta = meta.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    // Get most recent file
    return meta[0].path;
  }

  // Line parsers
  private parseLineOnPlayerJoined(line: string): boolean {
    if (line.includes('[Behaviour] OnPlayerJoined') && !line.includes('] OnPlayerJoined:')) {
      let offset = line.lastIndexOf('] OnPlayerJoined');
      if (offset < 0) return true;
      offset += 17;
      if (offset >= line.length) return true;
      const displayName = line.substring(offset).trim();
      this._logEvents.next({
        type: 'OnPlayerJoined',
        displayName,
        timestamp: this.parseTimestampFromLog(line),
      });
      return true;
    }
    return false;
  }

  private parseLineOnPlayerLeft(line: string): boolean {
    if (
      line.includes('[Behaviour] OnPlayerLeft') &&
      !line.includes('] OnPlayerLeftRoom') &&
      !line.includes('] OnPlayerLeft:')
    ) {
      let offset = line.lastIndexOf('] OnPlayerLeft');
      if (offset < 0) return true;
      offset += 15;
      if (offset >= line.length) return true;
      const displayName = line.substring(offset).trim();
      this._logEvents.next({
        type: 'OnPlayerLeft',
        displayName,
        timestamp: this.parseTimestampFromLog(line),
      });
      return true;
    }
    return false;
  }

  private parseLineOnLocationChange(line: string): boolean {
    if (
      line.includes('[Behaviour] Joining ') &&
      !line.includes('] Joining or Creating Room: ') &&
      !line.includes('] Joining friend: ')
    ) {
      let offset = line.lastIndexOf('] Joining ');
      if (offset < 0) return true;
      offset += 10;
      if (offset >= line.length) return true;
      const locationName = line.substring(offset);
      this._logEvents.next({
        type: 'OnLocationChange',
        instanceId: locationName,
        timestamp: this.parseTimestampFromLog(line),
      });
      return true;
    }
    return false;
  }

  // Utility parsers
  private parseTimestampFromLog(line: string): Date {
    const parsedTimestamp = moment(line.substring(0, 19), 'YYYY.MM.DD HH:mm:ss');
    return parsedTimestamp.toDate();
  }
}
