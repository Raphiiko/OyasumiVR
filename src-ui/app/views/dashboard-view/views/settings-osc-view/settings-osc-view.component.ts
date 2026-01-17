import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { vshrink } from 'src-ui/app/utils/animations';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { APP_SETTINGS_DEFAULT, OSCTarget } from 'src-ui/app/models/settings';
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
import { OscService } from 'src-ui/app/services/osc.service';
import { isEqual, pick } from 'lodash';

@Component({
  selector: 'app-settings-osc-view',
  templateUrl: './settings-osc-view.component.html',
  styleUrls: ['./settings-osc-view.component.scss'],
  animations: [vshrink()],
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

    // Setup debounced validation for custom target host
    this.customTargetHostChangeSubject
      .pipe(
        tap(() => (this.customTargetHostValidationState = 'pending')),
        debounceTime(500),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((host) => {
        if (this.isValidHostname(host)) {
          this.customTargetHostValidationState = 'valid';
          this.settingsService.updateSettings({
            oscCustomTargetHost: host,
          });
        } else {
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
        } else {
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
        takeUntilDestroyed(this.destroyRef),
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
        distinctUntilChanged()
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

  private isValidHostname(host: string): boolean {
    if (!host || !host.trim()) {
      return false;
    }

    const trimmedHost = host.trim();

    // Check if it's a valid IPv4 address
    const ipv4Regex =
      /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (ipv4Regex.test(trimmedHost)) {
      return true;
    }

    // If it looks like an IP address but failed the IPv4 test, reject it (probably false)
    const looksLikeIp = /^\d+\.\d+\.\d+\.\d+/.test(trimmedHost);
    if (looksLikeIp) {
      return false;
    }

    // Check if it's a valid hostname/domain name
    const hostnameRegex =
      /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (hostnameRegex.test(trimmedHost) && trimmedHost.length <= 253) {
      return true;
    }

    return false;
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
