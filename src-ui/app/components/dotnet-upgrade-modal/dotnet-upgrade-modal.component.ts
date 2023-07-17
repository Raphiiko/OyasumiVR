import { Component } from '@angular/core';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { fadeUp, hshrink } from '../../utils/animations';
import { DotnetService } from '../../services/dotnet.service';
import { filter, firstValueFrom, map, tap } from 'rxjs';
import { exit } from '@tauri-apps/api/process';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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

  constructor(private dotnetService: DotnetService, private modalService: ModalService) {
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
          if (runtimes.some((r) => r.status === 'INSTALL')) {
            this.automaticInstallationPossible = !runtimes.some(
              (r) => r.status === 'INSTALL' && !r.version
            );
          }
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
    for (const runtimeStatus of toInstall) {
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
          title: 'comp.dotnet-upgrade-modal.success.title',
          message: 'comp.dotnet-upgrade-modal.success.message',
          confirmButtonText: 'comp.dotnet-upgrade-modal.quit',
          showCancel: false,
        }
      : {
          title: 'comp.dotnet-upgrade-modal.failure.title',
          message: 'comp.dotnet-upgrade-modal.failure.message',
          confirmButtonText: 'comp.dotnet-upgrade-modal.quit',
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
      await exit(0);
    }
  }
}
