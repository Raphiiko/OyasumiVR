import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  BrightnessAutomationsConfig,
  BrightnessEvent,
} from '../../../../../../../models/automations';
import { AutomationConfigService } from '../../../../../../../services/automation-config.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, interval, map, startWith, switchMap } from 'rxjs';
import { BrightnessCctAutomationService } from '../../../../../../../services/brightness-cct-automation.service';
import { fade } from '../../../../../../../utils/animations';
import { AppSettingsService } from '../../../../../../../services/app-settings.service';
import { BrightnessEventViewModel } from '../brightness-automations-tab.component';
import { SleepService } from '../../../../../../../services/sleep.service';
import { uniq } from 'lodash';

@Component({
  selector: 'app-brightness-automations-list',
  templateUrl: './brightness-automations-list.component.html',
  styleUrls: ['./brightness-automations-list.component.scss'],
  animations: [fade()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class BrightnessAutomationsListComponent implements OnInit {
  protected config: BrightnessAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.BRIGHTNESS_AUTOMATIONS
  );
  @Input() events!: Array<BrightnessEventViewModel>;
  @Output() editEvent = new EventEmitter<BrightnessEventViewModel>();
  protected cctControlEnabled = false;
  protected hmdConnectAutomations: Record<BrightnessEvent, 'active' | 'potential' | false> = {
    AT_SUNRISE: false,
    AT_SUNSET: false,
    SLEEP_MODE_ENABLE: false,
    SLEEP_MODE_DISABLE: false,
    SLEEP_PREPARATION: false,
    HMD_CONNECT: false,
  };

  constructor(
    private automationConfigService: AutomationConfigService,
    private brightnessCctAutomations: BrightnessCctAutomationService,
    private destroyRef: DestroyRef,
    private appSettingsService: AppSettingsService,
    private sleepService: SleepService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.appSettingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => {
        this.cctControlEnabled = settings.cctControlEnabled;
        this.cdr.markForCheck();
      });
    this.events.forEach((event) => {
      combineLatest([
        this.brightnessCctAutomations.isBrightnessTransitionActive(event.name),
        this.brightnessCctAutomations.isCCTTransitionActive(event.name),
      ])
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(([brightnessActive, cctActive]) => {
          // events is an @Input, mutated in place, so the parent's view is only
          // rechecked because markForCheck also dirties every ancestor.
          event.inProgress = brightnessActive || cctActive;
          this.cdr.markForCheck();
        });
    });

    // Get configuration updates and refresh indicators when config changes
    this.automationConfigService.configs
      .pipe(
        map((configs) => configs.BRIGHTNESS_AUTOMATIONS),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((config) => {
        this.config = config;
        // Request refresh of HMD connect indicators when configurations change
        this.updateHmdConnectIndicators();
        this.cdr.markForCheck();
      });

    // Update HMD connect automation indicators based on sleep mode changes and timer
    combineLatest([
      this.sleepService.mode,
      interval(5000).pipe(startWith(0)), // Update every 5 seconds and initially
    ])
      .pipe(
        switchMap(() => this.updateHmdConnectIndicators()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  /**
   * Updates the HMD connect indicators based on the latest configuration
   */
  private updateHmdConnectIndicators() {
    return this.brightnessCctAutomations
      .determineHmdConnectAutomations()
      .then(
        ({
          brightnessAutomation,
          cctAutomation,
          potentialBrightnessAutomations,
          potentialCctAutomations,
        }) => {
          // Reset all indicators
          Object.keys(this.hmdConnectAutomations).forEach((key) => {
            this.hmdConnectAutomations[key as BrightnessEvent] = false;
          });

          // Set indicators for the automations that would be triggered
          if (brightnessAutomation) {
            this.hmdConnectAutomations[brightnessAutomation] = 'active';
          }
          if (cctAutomation) {
            this.hmdConnectAutomations[cctAutomation] = 'active';
          }

          // Set indicators for potential automations with higher transparency
          uniq([...potentialBrightnessAutomations, ...potentialCctAutomations])?.forEach(
            (automation) => {
              if (!this.hmdConnectAutomations[automation]) {
                this.hmdConnectAutomations[automation] = 'potential';
              }
            }
          );

          this.cdr.markForCheck();
        }
      );
  }

  toggleEvent(name: BrightnessEvent) {
    this.automationConfigService.updateAutomationConfig('BRIGHTNESS_AUTOMATIONS', {
      [name]: { ...this.config[name], enabled: !this.config[name].enabled },
    });
  }
}
