import {
  Component,
  DestroyRef,
  OnInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { filter, map, Observable, startWith } from 'rxjs';
import { fade } from '../../utils/animations';
import { NavigationEnd, NavigationSkipped, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { BackgroundService } from '../../services/background.service';
import { BrightnessCctAutomationService } from '../../services/brightness-cct-automation.service';
import { ModalService } from 'src-ui/app/services/modal.service';
import { DeveloperDebugModalComponent } from '../developer-debug-modal/developer-debug-modal.component';
import { UpdateService } from 'src-ui/app/services/update.service';

function slideMenu(name = 'slideMenu', length = '.2s ease', root = true) {
  return trigger(name, [
    transition(':enter', [
      style({
        transform: root ? 'translateX(-100%)' : 'translateX(100%)',
        opacity: 0,
      }),
      animate(
        length,
        style({
          transform: 'translateX(0)',
          opacity: 1,
        })
      ),
    ]),
    transition(':leave', [
      style({
        transform: 'translateX(0)',
        opacity: 1,
        position: 'absolute',
        width: '100%',
        top: 0,
        left: 0,
      }),
      animate(
        length,
        style({
          transform: root ? 'translateX(-100%)' : 'translateX(100%)',
          opacity: 0,
          width: '100%',
          position: 'absolute',
          top: 0,
          left: 0,
        })
      ),
    ]),
  ]);
}

function blurMenu(name = 'blurMenu', length = '.2s ease') {
  return trigger(name, [
    state(
      'active',
      style({
        transform: 'translateX(0)',
        filter: 'blur(0)',
        width: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
      })
    ),
    state(
      'inactive',
      style({
        'pointer-events': 'none',
        transform: 'translateX(-2.5em)',
        width: '100%',
        filter: 'blur(1em)',
        position: 'absolute',
        top: 0,
        left: 0,
      })
    ),
    transition('inactive => active', [
      style({
        transform: 'translateX(-2.5em)',
        filter: 'blur(1em)',
      }),
      animate(
        length,
        style({
          transform: 'translateX(0)',
          filter: 'blur(0)',
        })
      ),
    ]),
    transition('active => inactive', [
      style({
        transform: 'translateX(0)',
        position: 'absolute',
        width: '100%',
        top: 0,
        left: 0,
        filter: 'blur(0)',
      }),
      animate(
        length,
        style({
          transform: 'translateX(-2.5em)',
          width: '100%',
          position: 'absolute',
          top: 0,
          left: 0,
          filter: 'blur(1em)',
        })
      ),
    ]),
  ]);
}

type SubMenu = 'GENERAL' | 'VRCHAT' | 'HARDWARE' | 'MISCELLANEOUS' | 'SETTINGS';

/** Dashboard routes listed in each submenu, relative to `/dashboard/`. */
const SUBMENU_ROUTES: Record<Exclude<SubMenu, 'GENERAL'>, string[]> = {
  HARDWARE: [
    'brightnessAutomations',
    'powerAutomations',
    'gpuAutomations',
    'resolutionAutomations',
    'audioVolumeAutomations',
    'systemMicMuteAutomations',
    'hmdAutomations',
  ],
  VRCHAT: [
    'oscAutomations',
    'statusAutomations',
    'autoInviteRequestAccept',
    'vrchatMicMuteAutomations',
    'vrchatAvatarAutomations',
    'vrchatGroupAutomations',
    'joinNotifications',
    'sleepAnimations',
  ],
  MISCELLANEOUS: [
    'chaperoneAutomations',
    'nightmareDetection',
    'frameLimitAutomations',
    'runAutomations',
  ],
  SETTINGS: [
    'settings/general',
    'settings/brightnessCct',
    'settings/notifications',
    'settings/hotkeys',
    'settings/osc',
    'settings/updates',
    'settings/integrations',
    'settings/advanced',
    'settings/troubleshooting',
  ],
};

@Component({
  selector: 'app-dashboard-navbar',
  templateUrl: './dashboard-navbar.component.html',
  styleUrls: ['./dashboard-navbar.component.scss'],
  animations: [
    fade(),
    // slideMenu('rootMenu', '.2s ease', true),
    blurMenu('rootMenu', '.2s ease'),
    slideMenu('subMenu', '.2s ease', false),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class DashboardNavbarComponent implements OnInit {
  subMenu: SubMenu = 'GENERAL';
  protected readonly subMenuRoutes = SUBMENU_ROUTES;
  updateAvailable: Observable<boolean>;

  constructor(
    private updateService: UpdateService,
    protected router: Router,
    protected background: BackgroundService,
    protected brightnessAutomation: BrightnessCctAutomationService,
    private modalService: ModalService,
    private destroyRef: DestroyRef,
    private cdr: ChangeDetectorRef
  ) {
    this.updateAvailable = this.updateService.updateAvailable.pipe(map((a) => !!a.update));
  }

  async ngOnInit(): Promise<void> {
    this.router.events
      .pipe(
        // the router emits NavigationSkipped, not NavigationEnd, for the current URL
        filter((e) => e instanceof NavigationEnd || e instanceof NavigationSkipped),
        startWith(null),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.openSubMenuForActiveRoute());
  }

  logoClicked = 0;

  async onLogoClick() {
    if (++this.logoClicked >= 3) {
      this.logoClicked = 0;
      this.modalService
        .addModal<DeveloperDebugModalComponent>(DeveloperDebugModalComponent)
        .subscribe();
    }
  }

  openSubMenu(subMenu: SubMenu) {
    this.subMenu = subMenu;
  }

  private openSubMenuForActiveRoute() {
    const subMenu = (Object.keys(SUBMENU_ROUTES) as (keyof typeof SUBMENU_ROUTES)[]).find((key) =>
      this.pathIsActive(SUBMENU_ROUTES[key])
    );
    this.subMenu = subMenu ?? 'GENERAL';
    this.cdr.markForCheck();
  }

  pathIsActive(strings: string[]): boolean {
    return strings.some((s) =>
      this.router.isActive('/dashboard/' + s, {
        matrixParams: 'ignored',
        queryParams: 'ignored',
        paths: 'subset',
        fragment: 'ignored',
      })
    );
  }
}
