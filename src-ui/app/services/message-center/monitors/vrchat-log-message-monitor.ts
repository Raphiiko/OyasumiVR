import { inject } from '@angular/core';
import { VRChatService } from '../../vrchat.service';
import { MessageMonitor } from './message-monitor';
import { VRChatLogService } from '../../vrchat-log.service';
import { combineLatest, debounceTime, distinctUntilChanged, filter, map, merge } from 'rxjs';

export class VRChatLogMessageMonitor extends MessageMonitor {
  private vrchat = inject(VRChatService);
  private vrchatLog = inject(VRChatLogService);

  public override async init(): Promise<void> {
    combineLatest([
      merge(
        this.vrchat.vrchatProcessActive.pipe(
          distinctUntilChanged(),
          debounceTime(180000),
          filter(Boolean),
          map(() => true)
        ),
        this.vrchat.vrchatProcessActive.pipe(
          distinctUntilChanged(),
          filter((active) => !active),
          map(() => false)
        )
      ).pipe(distinctUntilChanged()),
      this.vrchatLog.logPath,
    ])
      .pipe(
        map(([vrcRunning, logPath]) => vrcRunning && !logPath),
        debounceTime(2000),
        distinctUntilChanged(),
      )
      .subscribe((issueFound) => {
        issueFound = true; // TODO: REMOVE THIS LINE AFTER TESTING
        if (issueFound) {
          this.messageCenter.addMessage({
            id: 'vrcLogMissing',
            title: 'message-center.messages.vrcLogMissing.title',
            message: 'message-center.messages.vrcLogMissing.message',
            hideable: true,
            actions: [],
            type: 'warning',
          });
        } else {
          this.messageCenter.removeMessage('vrcLogMissing');
        }
      });
  }
}
