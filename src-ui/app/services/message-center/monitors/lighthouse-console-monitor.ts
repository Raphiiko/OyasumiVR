import { MessageCenterService } from '../message-center.service';
import { MessageMonitor } from './message-monitor';
import { LighthouseConsoleService } from '../../lighthouse-console.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef, inject } from '@angular/core';
import { ExecutableReferenceStatus } from 'src-ui/app/models/settings';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Router } from '@angular/router';

export class LighthouseConsoleMonitor extends MessageMonitor {
  private destroyRef = inject(DestroyRef);
  private lighthouseConsole = inject(LighthouseConsoleService);
  private router = inject(Router);

  constructor(messageCenter: MessageCenterService) {
    super(messageCenter);
  }

  public init(): void {
    this.lighthouseConsole.consoleStatus
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((status) => {
        console.warn('lighthouseConsoleStatus', status);
        if (
          (
            [
              'NOT_FOUND',
              'PERMISSION_DENIED',
              'INVALID_FILENAME',
              'UNKNOWN_ERROR',
              'INVALID_EXECUTABLE',
            ] as ExecutableReferenceStatus[]
          ).includes(status)
        ) {
          this.messageCenter.addMessage({
            id: 'lighthouseConsoleError',
            type: 'warning',
            title: 'message-center.messages.lighthouseConsoleError.title',
            message: 'message-center.messages.lighthouseConsoleError.message',
            hideable: true,
            actions: [
              {
                label: 'message-center.actions.moreInfo',
                action: () =>
                  openUrl(
                    'https://raphii.co/oyasumivr/hidden/troubleshooting/lighthouse-console-unavailable/'
                  ),
              },
              {
                label: 'message-center.actions.configure',
                action: () => {
                  this.router.navigate(['/dashboard/settings/general']);
                  this.messageCenter.toggle();
                },
              },
            ],
          });
        } else {
          this.messageCenter.removeMessage('lighthouseConsoleError');
        }
      });
  }
}
