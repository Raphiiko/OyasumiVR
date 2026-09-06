import { Component, DestroyRef, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { vshrink } from '../../../../utils/animations';
import { AppSettingsService } from '../../../../services/app-settings.service';
import { APP_SETTINGS_DEFAULT, OSCTarget } from '../../../../models/settings';
import {
  asyncScheduler,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  Subject,
  tap,
  throttleTime,
} from 'rxjs';
import { OscService } from '../../../../services/osc.service';
import { flushOnDestroy } from '../../../../utils/rxjs-utils';
import { isEqual, pick } from 'lodash';
import { invoke } from '@tauri-apps/api/core';

@Component({
  selector: 'app-settings-osc-view',
  templateUrl: './settings-osc-view.component.html',
  styleUrls: ['./settings-osc-view.component.scss'],
  animations: [vshrink()],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class SettingsOscViewComponent implements OnInit {
  protected oscTargets: OSCTarget[] = structuredClone(APP_SETTINGS_DEFAULT.oscTargets);
  protected oscCustomTargetHost = structuredClone(APP_SETTINGS_DEFAULT.oscCustomTargetHost);
  protected oscCustomTargetPort = structuredClone(APP_SETTINGS_DEFAULT.oscCustomTargetPort);
  protected oscServerEnabled = structuredClone(APP_SETTINGS_DEFAULT.oscServerEnabled);

  // Validation states
  protected customTargetHostValidationState: 'valid' | 'invalid' | 'pending' = 'valid';
  protected customTargetPortValidationState: 'valid' | 'invalid' | 'pending' = 'valid';

  // Debouncing subjects
  protected customTargetHostChangeSubject = new Subject<string>();
  protected customTargetPortChangeSubject = new Subject<number>();

  // Alerts
  protected showVRCTargetWarning = false;

  private destroyed = false;
  // host edits share a generation across navigation-created views
  private static hostValidationGeneration = 0;

  constructor(
    private destroyRef: DestroyRef,
    private settingsService: AppSettingsService,
    private oscService: OscService
  ) {}

  async ngOnInit() {
    this.settingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => {
        this.oscTargets = [...settings.oscTargets];
        this.oscCustomTargetHost = settings.oscCustomTargetHost;
        this.oscCustomTargetPort = settings.oscCustomTargetPort;
        this.oscServerEnabled = settings.oscServerEnabled;
      });

    // must precede the flush hooks below, which run in registration order
    this.destroyRef.onDestroy(() => (this.destroyed = true));
    flushOnDestroy(this.customTargetHostChangeSubject, this.destroyRef);
    flushOnDestroy(this.customTargetPortChangeSubject, this.destroyRef);

    // each host edit supersedes pending DNS validation
    this.customTargetHostChangeSubject
      .pipe(
        tap(() => {
          SettingsOscViewComponent.hostValidationGeneration++;
          this.customTargetHostValidationState = 'pending';
        }),
        debounceTime(500),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(async (host) => {
        const generation = SettingsOscViewComponent.hostValidationGeneration;
        host = host.trim();
        // resolve the host independently of the port field
        const valid =
          !!host &&
          (await invoke<boolean>('osc_valid_addr', { addr: `${host}:1` }).catch(() => false));
        if (generation !== SettingsOscViewComponent.hostValidationGeneration) return;

        // save only the latest accepted host, including navigation flushes
        if (valid) {
          this.customTargetHostValidationState = 'valid';
          this.settingsService.updateSettings({
            oscCustomTargetHost: host,
          });
        } else if (!this.destroyed) {
          this.setTargetEnabled('CUSTOM', false);
          this.customTargetHostValidationState = 'invalid';
        }
      });

    // Setup debounced validation for custom target port
    this.customTargetPortChangeSubject
      .pipe(
        tap(() => (this.customTargetPortValidationState = 'pending')),
        debounceTime(500),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((port) => {
        if (this.isValidPort(port)) {
          this.customTargetPortValidationState = 'valid';
          this.settingsService.updateSettings({
            oscCustomTargetPort: port,
          });
        } else if (!this.destroyed) {
          this.setTargetEnabled('CUSTOM', false);
          this.customTargetPortValidationState = 'invalid';
        }
      });

    // Check if we're potentially targeting VRChat twice
    combineLatest([
      this.oscService.vrchatOscAddress,
      this.settingsService.settings.pipe(
        map((s) => pick(s, ['oscCustomTargetHost', 'oscCustomTargetPort', 'oscTargets'])),
        distinctUntilChanged((a, b) => isEqual(a, b))
      ),
    ])
      .pipe(
        throttleTime(1000, asyncScheduler, { leading: true, trailing: true }),
        map(([vrcOscAddress, { oscCustomTargetHost, oscCustomTargetPort, oscTargets }]) => {
          if (!oscTargets.includes('VRCHAT_OSCQUERY') || !oscTargets.includes('CUSTOM'))
            return false;
          if (
            oscCustomTargetHost.trim() !== '127.0.0.1' &&
            oscCustomTargetHost.trim() !== 'localhost'
          )
            return false;
          if (!vrcOscAddress || !vrcOscAddress.trim()) return false;
          const vrcPort = parseInt(vrcOscAddress.split(':')[1]);
          return vrcPort === oscCustomTargetPort;
        }),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((showAlert) => (this.showVRCTargetWarning = showAlert));
  }

  protected isTargetEnabled(target: OSCTarget): boolean {
    return this.oscTargets.includes(target);
  }

  protected setTargetEnabled(target: OSCTarget, enabled: boolean) {
    if (!enabled) {
      this.oscTargets = this.oscTargets.filter((t) => t !== target);
    } else if (!this.oscTargets.includes(target)) {
      this.oscTargets.push(target);
    }
    this.settingsService.updateSettings({
      oscTargets: [...this.oscTargets],
    });
  }

  private isValidPort(port: number): boolean {
    return Number.isInteger(port) && port >= 1 && port <= 65535;
  }

  protected setOscServerEnabled(enabled: boolean) {
    this.settingsService.updateSettings({
      oscServerEnabled: enabled,
    });
  }
}
