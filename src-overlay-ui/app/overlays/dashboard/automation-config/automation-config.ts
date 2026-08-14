import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  OyasumiSidecarAutomationsState,
  OyasumiSidecarAutomationsState_AutoAcceptInviteRequests,
  OyasumiSidecarAutomationsState_AutoAcceptInviteRequests_Mode,
  OyasumiSidecarAutomationsState_ChangeStatusBasedOnPlayerCount,
  OyasumiSidecarAutomationsState_ShutdownAutomations,
  OyasumiSidecarAutomationsState_SleepingAnimations,
  OyasumiSidecarAutomationsState_SleepModeEnableForSleepDetector,
} from 'src-grpc-web-client/overlay-sidecar_pb';
import { IpcService } from '../../../ipc/ipc.service';

type AutomationId = keyof OyasumiSidecarAutomationsState;
type AutomationData = OyasumiSidecarAutomationsState[AutomationId];

interface AutomationView {
  id: AutomationId;
  icon: string;
  title: string;
  subtitle: string | null;
  enabled: boolean;
}

const ICONS: Record<AutomationId, string> = {
  autoAcceptInviteRequests: 'mark_email_read',
  changeStatusBasedOnPlayerCount: 'circle',
  sleepingAnimations: 'settings_accessibility',
  shutdownAutomations: 'settings_power',
  sleepModeEnableForSleepDetector: 'bedtime',
};

@Component({
  selector: 'app-dashboard-automation-config',
  imports: [TranslocoPipe],
  templateUrl: './automation-config.html',
  styleUrl: './automation-config.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AutomationConfig {
  private readonly ipc = inject(IpcService);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$);

  readonly navigate = output<'OVERVIEW'>();

  readonly automations = computed<AutomationView[]>(() => {
    const lang = this.lang();
    const entries = Object.entries(this.ipc.state().automations ?? {}) as [
      AutomationId,
      AutomationData,
    ][];
    return entries.map(([id, data]) => ({
      id,
      icon: ICONS[id] ?? 'question_mark',
      title: this.translate(`overlay.dashboard.automations.${id}.title`, undefined, lang),
      subtitle: this.subtitle(id, data, lang),
      enabled: this.isEnabled(id, data),
    }));
  });

  toggle(id: AutomationId): void {
    void this.ipc.toggleAutomation(id);
  }

  private isEnabled(id: AutomationId, data: AutomationData): boolean {
    if (id === 'shutdownAutomations') {
      return !!(data as OyasumiSidecarAutomationsState_ShutdownAutomations).triggersEnabled;
    }
    return !!(data as { enabled: boolean }).enabled;
  }

  private subtitle(id: AutomationId, data: AutomationData, lang?: string): string | null {
    const t = (key: string, params?: Record<string, unknown>) => this.translate(key, params, lang);
    switch (id) {
      case 'autoAcceptInviteRequests': {
        const automation = data as OyasumiSidecarAutomationsState_AutoAcceptInviteRequests;
        const mode = t(
          `overlay.dashboard.automations.autoAcceptInviteRequests.mode.${
            OyasumiSidecarAutomationsState_AutoAcceptInviteRequests_Mode[automation.mode]
          }`
        );
        if (
          automation.mode === OyasumiSidecarAutomationsState_AutoAcceptInviteRequests_Mode.Disabled
        ) {
          return mode;
        }
        return t('overlay.dashboard.automations.autoAcceptInviteRequests.subtitle', {
          mode,
          playerCount: automation.playerCount,
        });
      }
      case 'changeStatusBasedOnPlayerCount': {
        const automation = data as OyasumiSidecarAutomationsState_ChangeStatusBasedOnPlayerCount;
        return t('overlay.dashboard.automations.changeStatusBasedOnPlayerCount.subtitle', {
          threshold: automation.threshold,
        });
      }
      case 'sleepingAnimations': {
        const automation = data as OyasumiSidecarAutomationsState_SleepingAnimations;
        return automation.presetName
          ? automation.presetName
          : t('oscAutomations.sleepingAnimations.customPreset');
      }
      case 'shutdownAutomations': {
        const automation = data as OyasumiSidecarAutomationsState_ShutdownAutomations;
        return t('overlay.dashboard.automations.shutdownAutomations.subtitle', {
          triggerCount: automation.triggersConfigured,
        });
      }
      case 'sleepModeEnableForSleepDetector': {
        const automation = data as OyasumiSidecarAutomationsState_SleepModeEnableForSleepDetector;
        const subtitleKey = automation.activationWindow
          ? 'withActivationWindow'
          : 'withoutActivationWindow';
        return t(
          `overlay.dashboard.automations.sleepModeEnableForSleepDetector.subtitle.${subtitleKey}`,
          {
            sensitivity: t(
              `sleep-detection.modals.enableForSleepDetector.sensitivity.presets.${automation.sensitivity}`
            ),
            startTime: this.formatTime(automation.activationWindowStart),
            endTime: this.formatTime(automation.activationWindowEnd),
          }
        );
      }
      default:
        return null;
    }
  }

  private translate(key: string, params?: Record<string, unknown>, lang?: string): string {
    return this.transloco.translate<string>(key, params, lang);
  }

  private formatTime(input: number[]): string {
    const [hour, minute] = input;
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }
}
