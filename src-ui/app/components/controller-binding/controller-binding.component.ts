import { Component, DestroyRef, Input, OnInit } from '@angular/core';
import { OVRInputEventAction, OVRInputEventActionSet } from '../../models/ovr-input-event';
import { OpenVRInputService } from 'src-ui/app/services/openvr-input.service';
import { filter, firstValueFrom, interval, pairwise, startWith, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OVRActionBinding } from '../../models/ovr-action-binding';
import { OpenVRService, OpenVRStatus } from '../../services/openvr.service';
import { fadeDown } from '../../utils/animations';

@Component({
  selector: 'app-controller-binding',
  templateUrl: './controller-binding.component.html',
  styleUrls: ['./controller-binding.component.scss'],
  animations: [fadeDown()],
  standalone: false,
})
export class ControllerBindingComponent implements OnInit {
  @Input() actionKey?: OVRInputEventAction;
  @Input('actionSetKey') actionSetKeyInput?: OVRInputEventActionSet;
  protected bindings: OVRActionBinding[] = [];
  protected error?:
    | 'MISSING_KEY'
    | 'STEAMVR_INACTIVE'
    | 'NO_CONTROLLERS'
    | 'MISSING_CONTROLLER'
    | 'DASHBOARD_OPEN'
    | 'UNKNOWN';
  protected steamVRActive = false;
  protected hasRightHand = false;
  protected hasLeftHand = false;
  protected dropdownOpen = false;

  get activeBinding(): OVRActionBinding | undefined {
    return this.bindings.length ? this.bindings[0] : undefined;
  }

  set actionSetKey(value: OVRInputEventActionSet | undefined) {
    this.actionSetKeyInput = value;
  }

  get actionSetKey(): OVRInputEventActionSet | undefined {
    if (this.actionSetKeyInput) return this.actionSetKeyInput;
    if (this.actionKey)
      return ('/' +
        this.actionKey
          .split('/')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .slice(0, 2)
          .join('/')) as OVRInputEventActionSet;
    return undefined;
  }

  constructor(
    protected openvrInputService: OpenVRInputService,
    private openvr: OpenVRService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit() {
    this.openvr.status
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        pairwise(),
        filter(([prev, current]) => current !== 'INITIALIZED' && prev === 'INITIALIZED'),
        tap(() => (this.dropdownOpen = false))
      )
      .subscribe();
    interval(1000)
      .pipe(
        startWith(void 0),
        takeUntilDestroyed(this.destroyRef),
        switchMap(() => this.refreshBindings())
      )
      .subscribe();
  }

  private async refreshBindings() {
    let error = undefined;
    let bindings: OVRActionBinding[] = [];
    let status: OpenVRStatus | undefined = undefined;
    await (async () => {
      if (!this.actionSetKey || !this.actionKey) {
        error = 'MISSING_KEY';
        return;
      }
      status = await firstValueFrom(this.openvr.status);
      if (status !== 'INITIALIZED') {
        error = 'STEAMVR_INACTIVE';
        return;
      }
      bindings = await this.openvrInputService.getActionBindings(this.actionSetKey, this.actionKey);
      if (bindings.length === 0) {
        const controllers = await firstValueFrom(this.openvr.devices).then((devices) =>
          devices.filter((d) => d.class === 'Controller')
        );
        if (controllers.length === 0) {
          error = 'NO_CONTROLLERS';
          return;
        }
        this.hasLeftHand = controllers.some((d) => d.role === 'LeftHand');
        this.hasRightHand = controllers.some((d) => d.role === 'RightHand');
        if (!this.hasLeftHand || !this.hasRightHand) {
          error = 'MISSING_CONTROLLER';
          return;
        }
        if (await this.openvr.isDashboardVisible()) {
          error = 'DASHBOARD_OPEN';
          return;
        }
        error = 'UNKNOWN';
      }
    })();
    this.error = error;
    this.bindings.splice(0, this.bindings.length);
    this.bindings.push(...bindings);
    this.steamVRActive = status === 'INITIALIZED';
  }

  tooltipText(): string | null {
    switch (this.error) {
      case 'MISSING_KEY':
        return 'Missing Action Set Key or Action Key';
      case 'STEAMVR_INACTIVE':
      case 'MISSING_CONTROLLER':
      case 'DASHBOARD_OPEN':
        return `comp.controller-binding.errors.${this.error}.tooltip`;
      case 'NO_CONTROLLERS':
        return `comp.controller-binding.errors.MISSING_CONTROLLER.tooltip`;
      case 'UNKNOWN':
      default:
        return null;
    }
  }

  clickOutsideDropdown() {
    if (this.dropdownOpen) {
      this.dropdownOpen = false;
    }
  }

  toggleDropdown() {
    if (this.dropdownOpen) {
      this.dropdownOpen = false;
    } else if (this.steamVRActive) {
      setTimeout(() => {
        this.dropdownOpen = !this.dropdownOpen;
      }, 0);
    }
  }

  async launchBindingConfiguration(showOnDesktop: boolean) {
    this.dropdownOpen = false;
    if (this.steamVRActive) await this.openvrInputService.launchBindingConfiguration(showOnDesktop);
  }
}
