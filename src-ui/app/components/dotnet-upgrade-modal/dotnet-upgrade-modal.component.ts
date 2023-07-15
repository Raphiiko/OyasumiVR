import { Component } from '@angular/core';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { fadeUp, hshrink } from '../../utils/animations';
import { DotnetService } from '../../services/dotnet.service';
import { filter, firstValueFrom, map, tap } from 'rxjs';
import { exit, relaunch } from '@tauri-apps/api/process';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import { ModalService } from '../../services/modal.service';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../confirm-modal/confirm-modal.component';

interface RuntimeStatus {
  type: 'netCore' | 'aspNetCore';
  name: string;
  version?: string;
  status: 'INSTALL' | 'QUEUED' | 'INSTALLING' | 'SUCCESS' | 'FAILED';
}

@Component({
  selector: 'app-dotnet-upgrade-modal',
  templateUrl: './dotnet-upgrade-modal.component.html',
  styleUrls: ['./dotnet-upgrade-modal.component.scss'],
  animations: [fadeUp(), hshrink()],
})
export class DotnetUpgradeModalComponent extends BaseModalComponent<any, any> {
  requiredRuntimes: RuntimeStatus[] = [];
  automaticInstallationPossible = false;
  installing = false;

  constructor(
    private dotnetService: DotnetService,
    private modalService: ModalService,
    private translate: TranslateService
  ) {
    super();
    dotnetService.status
      .pipe(
        filter(Boolean),
        map((status) => {
          const runtimes: RuntimeStatus[] = [];
          if (status.netCore.status !== 'OK') {
            runtimes.push({
              type: 'netCore',
              name: '.NET Runtime',
              version: status.netCore.version,
              status: status.netCore.status,
            });
          }

          if (status.aspNetCore.status !== 'OK') {
            runtimes.push({
              type: 'aspNetCore',
              name: 'ASP.NET Core Runtime',
              version: status.aspNetCore.version,
              status: status.aspNetCore.status,
            });
          }
          return runtimes;
        }),
        tap((runtimes) => {
          this.automaticInstallationPossible = runtimes.every(
            (runtime) => runtime.status === 'INSTALL'
          );
          this.requiredRuntimes = runtimes;
        })
      )
      .pipe(takeUntilDestroyed())
      .subscribe();
  }

  async quit() {
    await exit(0);
  }

  async installAutomatically() {
    this.installing = true;
    const toInstall = this.requiredRuntimes.filter((r) => r.status === 'INSTALL');
    this.dotnetService.markAllQueued();
    for (let runtimeStatus of toInstall) {
      switch (runtimeStatus.type) {
        case 'netCore': {
          await this.dotnetService.upgradeNetCore(runtimeStatus.version!);
          break;
        }
        case 'aspNetCore': {
          await this.dotnetService.upgradeAspNetCore(runtimeStatus.version!);
          break;
        }
      }
    }
    const success = this.requiredRuntimes.every((r) => r.status === 'SUCCESS');
    const modalInput: ConfirmModalInputModel = success
      ? {
          title: 'Installation Successful',
          message:
            'The required missing runtimes have been installed successfully. Please restart OyasumiVR in order to continue.',
          confirmButtonText: 'Restart OyasumiVR',
          showCancel: false,
        }
      : {
          title: 'Installation Failed',
          message:
            'The required missing runtimes could not be installed automatically. Please try to install them manually. You can check the log files for more information on what went wrong.\n\nIf you continue to experience issues, please reach out to @Raphiiko on Twitter, or in our Discord Server.',
          confirmButtonText: 'Quit OyasumiVR',
          showCancel: false,
        };
    const result = await firstValueFrom(
      this.modalService.addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(
        ConfirmModalComponent,
        modalInput,
        {
          closeOnEscape: false,
        }
      )
    );
    if (result.confirmed) {
      if (success) {
        await relaunch();
      } else {
        await exit(0);
      }
    }
  }
}
