import { Component, DestroyRef, OnInit } from '@angular/core';
import { combineLatest, map, Observable, startWith } from 'rxjs';
import { LighthouseConsoleService } from 'src-ui/app/services/lighthouse-console.service';
import { fade } from '../../utils/animations';
import { Router } from '@angular/router';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { BackgroundService } from '../../services/background.service';
import { BrightnessCctAutomationService } from '../../services/brightness-cct-automation.service';
import { ModalService } from 'src-ui/app/services/modal.service';
import { DeveloperDebugModalComponent } from '../developer-debug-modal/developer-debug-modal.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  standalone: false,
})
export class DashboardNavbarComponent implements OnInit {
  settingErrors: Observable<boolean>;
  lighthouseConsoleErrors: Observable<boolean>;
  subMenu: SubMenu = 'GENERAL';
  updateAvailable: Observable<boolean>;

  constructor(
    private lighthouse: LighthouseConsoleService,
    private updateService: UpdateService,
    protected router: Router,
    protected background: BackgroundService,
    protected brightnessAutomation: BrightnessCctAutomationService,
    private modalService: ModalService,
    private destroyRef: DestroyRef
  ) {
    this.updateAvailable = this.updateService.updateAvailable.pipe(map((a) => !!a.update));
    this.lighthouseConsoleErrors = this.lighthouse.consoleStatus.pipe(
      takeUntilDestroyed(this.destroyRef),
      map((status) => !['UNKNOWN', 'SUCCESS', 'CHECKING'].includes(status)),
      startWith(false)
    );
    this.settingErrors = combineLatest([this.lighthouseConsoleErrors]).pipe(
      map((errorAreas: boolean[]) => !!errorAreas.find((a) => a))
    );
  }

  async ngOnInit(): Promise<void> {}

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
