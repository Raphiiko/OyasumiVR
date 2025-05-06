import { inject } from '@angular/core';
import { VRChatService } from '../../vrchat.service';
import { MessageMonitor } from './message-monitor';
import { VRChatLogService } from '../../vrchat-log.service';
import { combineLatest, debounceTime, distinctUntilChanged, filter, map, merge } from 'rxjs';
import { openUrl } from '@tauri-apps/plugin-opener';

export class VRChatLogMessageMonitor extends MessageMonitor {
  private vrchat = inject(VRChatService);
  private vrchatLog = inject(VRChatLogService);

  public override async init(): Promise<void> {
    combineLatest([
      merge(
        this.vrchat.vrchatProcessActive.pipe(
          distinctUntilChanged(),
          debounceTime(60000),
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
        distinctUntilChanged()
      )
      .subscribe((issueFound) => {
        if (issueFound) {
          this.messageCenter.addMessage({
            id: 'vrcLogMissing',
            title: 'message-center.messages.vrcLogMissing.title',
            message: 'message-center.messages.vrcLogMissing.message',
            hideable: true,
            actions: [
              {
                label: 'message-center.actions.moreInfo',
                action: () =>
                  openUrl(
                    'https://raphii.co/oyasumivr/hidden/troubleshooting/vrchat-logs-required/'
                  ),
              },
            ],
            type: 'warning',
          });
        } else {
          this.messageCenter.removeMessage('vrcLogMissing');
        }
      });
  }
}
