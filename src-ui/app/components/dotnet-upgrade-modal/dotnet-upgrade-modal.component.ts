import { Component } from '@angular/core';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { fadeUp, hshrink } from '../../utils/animations';
import { DotnetService, RuntimeCheckResult } from '../../services/dotnet.service';
import { filter, firstValueFrom, map, tap } from 'rxjs';
import { exit } from '@tauri-apps/api/process';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ModalService } from '../../services/modal.service';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../confirm-modal/confirm-modal.component';
import { info } from 'tauri-plugin-log-api';

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
  installing = false;

  constructor(private dotnetService: DotnetService, private modalService: ModalService) {
    super();
    dotnetService.status
      .pipe(
        filter(Boolean),
        map((result) => this.mapCheckResultToRuntimeStatus(result)),
        tap((runtimes) => (this.requiredRuntimes = runtimes))
      )
      .pipe(takeUntilDestroyed())
      .subscribe();
  }

  private mapCheckResultToRuntimeStatus(result: RuntimeCheckResult): RuntimeStatus[] {
    const runtimes: RuntimeStatus[] = [];
    if (result.netCore.status !== 'OK') {
      runtimes.push({
        type: 'netCore',
        name: '.NET Runtime',
        version: result.netCore.version,
        status: result.netCore.status,
      });
    }

    if (result.aspNetCore.status !== 'OK') {
      runtimes.push({
        type: 'aspNetCore',
        name: 'ASP.NET Core Runtime',
        version: result.aspNetCore.version,
        status: result.aspNetCore.status,
      });
    }
    return runtimes;
  }

  async quit() {
    await exit(0);
  }

  async installAutomatically() {
    this.installing = true;
    let toInstall = this.requiredRuntimes.filter((r) => r.status === 'INSTALL');
    this.dotnetService.markAllQueued();
    const competedList: string[] = [];
    // Install all runtimes
    for (const runtimeStatus of toInstall) {
      switch (runtimeStatus.type) {
        case 'netCore':
        case 'aspNetCore': {
          if (competedList.includes(runtimeStatus.type)) continue;
          await this.dotnetService.installDotNetHostingBundle(runtimeStatus.version!);
          competedList.push('netCore', 'aspNetCore');
          break;
        }
      }
    }
    let success = this.requiredRuntimes.every((r) => r.status === 'SUCCESS');
    // If success, check results again.
    if (success) {
      const result = await this.dotnetService.checkRuntimes();
      toInstall = this.mapCheckResultToRuntimeStatus(result).filter((r) => r.status === 'INSTALL');
      // If we're still missing some runtimes, try install those individually.
      for (const runtimeStatus of toInstall) {
        switch (runtimeStatus.type) {
          case 'netCore': {
            info(
              `[DotNet] Still missing .NET Core runtime (${runtimeStatus.version!}) after installing hosting bundle. Installing it individually now.`
            );
            await this.dotnetService.installNetCore(runtimeStatus.version!);
            break;
          }
          case 'aspNetCore': {
            info(
              `[DotNet] Still missing ASP.NET Core runtime (${runtimeStatus.version!}) after installing hosting bundle. Installing it individually now.`
            );
            await this.dotnetService.installAspNetCore(runtimeStatus.version!);
            break;
          }
        }
      }
      // Check for success again
      success = this.requiredRuntimes.every((r) => r.status === 'SUCCESS');
    }
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
