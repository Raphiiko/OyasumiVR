import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  FrameLimitAutomationsAppConfig,
  FrameLimitAutomationsConfig,
  FrameLimitConfigOption,
} from 'src-ui/app/models/automations';
import { AutomationConfigService } from 'src-ui/app/services/automation-config.service';
import {
  FrameLimiterPresets,
  FrameLimiterService,
} from 'src-ui/app/services/frame-limiter.service';
import { ModalService } from 'src-ui/app/services/modal.service';
import { vshrink } from 'src-ui/app/utils/animations';
import { OpenVRService } from 'src-ui/app/services/openvr.service';
import {
  FrameLimiterAddApplicationModalComponent,
  FrameLimiterAddApplicationModalOutputModel,
} from './modals/frame-limiter-add-application-modal/frame-limiter-add-application-modal.component';

@Component({
  selector: 'app-frame-limiter-view',
  templateUrl: './frame-limiter-view.component.html',
  styleUrls: ['./frame-limiter-view.component.scss'],
  standalone: false,
  animations: [vshrink()],
})
export class FrameLimiterViewComponent implements OnInit {
  config: FrameLimitAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.FRAME_LIMIT_AUTOMATIONS
  );
  activeFrameLimits: { [appId: number]: FrameLimitConfigOption | null } = {};
  constructor(
    private automationConfig: AutomationConfigService,
    private frameLimiterService: FrameLimiterService,
    private modalService: ModalService,
    private destroyRef: DestroyRef,
    public openvr: OpenVRService
  ) {}

  ngOnInit(): void {
    this.automationConfig.configs
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        map((configs) => configs.FRAME_LIMIT_AUTOMATIONS)
      )
      .subscribe((config) => (this.config = config));
    this.frameLimiterService.activeFrameLimits
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((limits) => (this.activeFrameLimits = limits));
  }

  removeLimiter(appId: number) {
    const newConfig = structuredClone(this.config);
    newConfig.configs = newConfig.configs.filter((c) => c.appId !== appId);
    this.automationConfig.updateAutomationConfig<FrameLimitAutomationsConfig>(
      'FRAME_LIMIT_AUTOMATIONS',
      newConfig
    );
  }

  addLimiter() {
    this.modalService
      .addModal<Record<string, never>, FrameLimiterAddApplicationModalOutputModel>(
        FrameLimiterAddApplicationModalComponent
      )
      .subscribe((result) => {
        if (result?.appId) {
          this.addLimiterForAppId(result.appId);
        }
      });
  }

  private addLimiterForAppId(appId: number) {
    const preset = FrameLimiterPresets.find((p) => p.appId === appId);
    if (!preset) return;

    const newConfig = structuredClone(this.config);
    // Check if app is already in the config
    if (newConfig.configs.some((c) => c.appId === appId)) {
      return; // App already exists in config
    }

    // Create a new app config
    const newAppConfig: FrameLimitAutomationsAppConfig = {
      appId: preset.appId,
      appLabel: preset.appLabel,
      onSleepEnable: 'DISABLED',
      onSleepDisable: 'DISABLED',
      onSleepPreparation: 'DISABLED',
    };

    newConfig.configs.push(newAppConfig);
    this.automationConfig.updateAutomationConfig<FrameLimitAutomationsConfig>(
      'FRAME_LIMIT_AUTOMATIONS',
      newConfig
    );
  }

  getAppIconForId(appId: number) {
    return (
      FrameLimiterPresets.find((app) => app.appId === appId)?.appIcon || 'assets/img/steam_icon.png'
    );
  }

  getActiveValueForId(appId: number): FrameLimitConfigOption | undefined {
    return this.activeFrameLimits[appId] ?? undefined;
  }

  onFrameLimitRequested(appId: number, value: FrameLimitConfigOption) {
    this.frameLimiterService.setFrameLimitForAppId(appId, value);
  }

  setEventFrameLimit(
    appId: number,
    value: FrameLimitConfigOption,
    automation: 'onSleepEnable' | 'onSleepDisable' | 'onSleepPreparation'
  ) {
    const appConfig = structuredClone(this.config.configs.find((c) => c.appId === appId));
    if (!appConfig) return;
    if (appConfig[automation] !== value) {
      appConfig[automation] = value;
    } else {
      appConfig[automation] = 'DISABLED';
    }
    const newConfig = structuredClone(this.config);
    newConfig.configs = newConfig.configs.map((c) => (c.appId === appId ? appConfig : c));
    this.automationConfig.updateAutomationConfig<FrameLimitAutomationsConfig>(
      'FRAME_LIMIT_AUTOMATIONS',
      newConfig
    );
  }

  toggleEventFrameLimit(
    appId: number,
    automation: 'onSleepEnable' | 'onSleepDisable' | 'onSleepPreparation'
  ) {
    const appConfig = structuredClone(this.config.configs.find((c) => c.appId === appId));
    if (!appConfig) return;
    if (appConfig[automation] === 'DISABLED') {
      this.setEventFrameLimit(appId, 1, automation);
    } else {
      this.setEventFrameLimit(appId, 'DISABLED', automation);
    }
  }

  trackByAppId(index: number, item: FrameLimitAutomationsAppConfig): number {
    return item.appId;
  }
}
