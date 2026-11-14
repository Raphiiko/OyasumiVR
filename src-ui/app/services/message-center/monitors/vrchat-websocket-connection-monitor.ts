import { inject } from '@angular/core';
import { VRChatService } from '../../vrchat-api/vrchat.service';
import { MessageMonitor } from './message-monitor';
import {
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  timer,
  of,
} from 'rxjs';

const STABLE_CONNECTION_DURATION = 5_000;
const WARNING_DELAY = 60_000;

export class VRChatWebsocketConnectionMonitor extends MessageMonitor {
  private vrchat = inject(VRChatService);

  public override async init(): Promise<void> {
    // VRChat opens a socket before it rejects the token, so a brief OPEN does not count as connected
    const stablyConnected = this.vrchat.websocketStatus.pipe(
      distinctUntilChanged(),
      switchMap((status) =>
        status === 'OPEN' ? timer(STABLE_CONNECTION_DURATION).pipe(map(() => true)) : of(false)
      ),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    combineLatest([this.vrchat.status.pipe(distinctUntilChanged()), stablyConnected])
      .pipe(
        switchMap(([authStatus, connected]) => {
          if (authStatus !== 'LOGGED_IN' || connected) return of(false);

          return timer(WARNING_DELAY).pipe(
            switchMap(() =>
              combineLatest([this.vrchat.status, stablyConnected]).pipe(
                map(
                  ([currentAuthStatus, currentlyConnected]) =>
                    currentAuthStatus === 'LOGGED_IN' && !currentlyConnected
                )
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
