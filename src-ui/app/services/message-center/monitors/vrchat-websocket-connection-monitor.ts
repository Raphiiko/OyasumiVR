import { inject } from '@angular/core';
import { VRChatService } from '../../vrchat-api/vrchat.service';
import { MessageMonitor } from './message-monitor';
import { combineLatest, debounceTime, distinctUntilChanged, map, switchMap, timer, of } from 'rxjs';

export class VRChatWebsocketConnectionMonitor extends MessageMonitor {
  private vrchat = inject(VRChatService);

  public override async init(): Promise<void> {
    combineLatest([
      this.vrchat.status.pipe(distinctUntilChanged()),
      this.vrchat.websocketStatus.pipe(distinctUntilChanged()),
    ])
      .pipe(
        switchMap(([authStatus, wsStatus]) => {
          // Check if both conditions are met: logged in and websocket closed
          const shouldMonitor = authStatus === 'LOGGED_IN' && wsStatus !== 'OPEN';

          if (!shouldMonitor) {
            // If not both conditions are met, don't show warning
            return of(false);
          }

          // If both conditions are met, wait 60 seconds and check if they're still true
          return timer(60000).pipe(
            switchMap(() =>
              combineLatest([this.vrchat.status, this.vrchat.websocketStatus]).pipe(
                map(([currentAuthStatus, currentWsStatus]) => {
                  // Show warning only if both conditions are still true after 60 seconds
                  return currentAuthStatus === 'LOGGED_IN' && currentWsStatus !== 'OPEN';
                })
              )
            )
          );
        }),
        distinctUntilChanged(),
        debounceTime(1000)
      )
      .subscribe((showWarning) => {
        if (showWarning) {
          this.messageCenter.addMessage({
            id: 'vrcWebsocketDisconnected',
            title: 'message-center.messages.vrcWebsocketDisconnected.title',
            message: 'message-center.messages.vrcWebsocketDisconnected.message',
            hideable: true,
            actions: [],
            type: 'warning',
          });
        } else {
          this.messageCenter.removeMessage('vrcWebsocketDisconnected');
        }
      });
  }
}
