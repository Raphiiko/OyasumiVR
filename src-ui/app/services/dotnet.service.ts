import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { error, warn } from 'tauri-plugin-log-api';
import { Client, getClient, ResponseType } from '@tauri-apps/api/http';
import { BehaviorSubject } from 'rxjs';
import { ModalService } from './modal.service';
import { DotnetUpgradeModalComponent } from '../components/dotnet-upgrade-modal/dotnet-upgrade-modal.component';
import { cloneDeep } from 'lodash';

const DOTNET_VERSION = '7.0';
const NETCORE_VERSION_URL = `https://dotnetcli.azureedge.net/dotnet/Runtime/${DOTNET_VERSION}/latest.version`;
const ASPNETCORE_VERSION_URL = `https://dotnetcli.azureedge.net/dotnet/aspnetcore/Runtime/${DOTNET_VERSION}/latest.version`;

type StatusResponse =
  | 'INSTALL_NETCORE'
  | 'UPGRADE_NETCORE'
  | 'DOWNGRADE_NETCORE'
  | 'INSTALL_ASPNETCORE'
  | 'UPGRADE_ASPNETCORE'
  | 'DOWNGRADE_ASPNETCORE';

type CheckResultItem = {
  status: 'OK' | 'INSTALL' | 'QUEUED' | 'INSTALLING' | 'FAILED' | 'SUCCESS';
  version?: string;
};

interface CheckResult {
  netCore: CheckResultItem;
  aspNetCore: CheckResultItem;
}

@Injectable({
  providedIn: 'root',
})
export class DotnetService {
  private http!: Client;
  private _status = new BehaviorSubject<CheckResult | null>(null);
  public status = this._status.asObservable();

  constructor(private modalService: ModalService) {}

  public async init() {
    // this.status.pipe(filter(Boolean)).subscribe(async (status) => {});
    this.http = await getClient();
    try {
      const status = await this.checkRuntimes();
      if (status.netCore.status !== 'OK' || status.aspNetCore.status !== 'OK') {
        this.modalService
          .addModal(DotnetUpgradeModalComponent, {}, { closeOnEscape: false })
          .subscribe();
      }
      this._status.next(status);
    } catch (e) {
      error('[DotNet] Could not check for .NET runtime issues: ' + e);
    }
  }

  private async checkRuntimes(): Promise<CheckResult> {
    const result: CheckResult = {
      netCore: { status: 'OK' },
      aspNetCore: { status: 'OK' },
    };
    const status = await invoke<StatusResponse[]>('check_dotnet_upgrades_required');
    if (!status.length) return result;
    // We found issues, let's get the currently installed versions
    let netCoreVersion;
    let aspNetCoreVersion;
    try {
      netCoreVersion = await invoke<string>('get_net_core_version');
      aspNetCoreVersion = await invoke<string>('get_asp_net_core_version');
    } catch (e) {
      warn('[DotNet] Could not get installed .NET runtime versions: ' + e);
      throw e;
    }
    // Let's get the latest versions too
    let latestNetCoreVersion;
    let latestAspNetCoreVersion;
    try {
      latestNetCoreVersion = await this.getLatestVersion(NETCORE_VERSION_URL);
      latestAspNetCoreVersion = await this.getLatestVersion(ASPNETCORE_VERSION_URL);
    } catch (e) {
      warn('[DotNet] Could not get latest .NET runtime versions: ' + e);
    }
    // Check if we need to upgrade netcore
    if (
      status.some((r) => ['INSTALL_NETCORE', 'UPGRADE_NETCORE', 'DOWNGRADE_NETCORE'].includes(r))
    ) {
      result.netCore = {
        status: 'INSTALL',
        version: latestNetCoreVersion ?? undefined,
      };
      // If the new netcore version is higher than the current aspnetcore version, we need to upgrade aspnetcore too
      if (
        !aspNetCoreVersion ||
        (result.netCore.version &&
          (await invoke<boolean>('is_semver_higher', {
            a: result.netCore.version,
            b: aspNetCoreVersion,
          })))
      ) {
        result.aspNetCore = {
          status: 'INSTALL',
          version: latestAspNetCoreVersion ?? undefined,
        };
      }
    }
    // Check if we need to upgrade aspnetcore
    if (
      status.some((r) =>
        ['INSTALL_ASPNETCORE', 'UPGRADE_ASPNETCORE', 'DOWNGRADE_ASPNETCORE'].includes(r)
      )
    ) {
      result.aspNetCore = {
        status: 'INSTALL',
        version: latestAspNetCoreVersion ?? undefined,
      };
      // If the new aspnetcore version is higher than the current netcore version, we need to upgrade netcore too
      if (
        !netCoreVersion ||
        (latestAspNetCoreVersion &&
          (await invoke<boolean>('is_semver_higher', {
            a: latestAspNetCoreVersion,
            b: netCoreVersion,
          })))
      ) {
        result.netCore = {
          status: 'INSTALL',
          version: latestNetCoreVersion ?? undefined,
        };
      }
    }
    return result;
  }

  private async getLatestVersion(url: string): Promise<string> {
    const response = await this.http.get<string>(url, { responseType: ResponseType.Text });
    if (!response.ok) throw new Error('Could not get latest version');
    return response.data;
  }

  public async upgradeNetCore(version: string): Promise<void> {
    if (this._status.value) {
      const status = cloneDeep(this._status.value);
      status.netCore = { status: 'INSTALLING', version };
      this._status.next(status);
    }
    try {
      await invoke('upgrade_net_core', { version });
      if (this._status.value) {
        const status = cloneDeep(this._status.value);
        status.netCore = { status: 'SUCCESS', version };
        this._status.next(status);
      }
    } catch (e) {
      error('[DotNet] Could not upgrade .NET Core: ' + e);
      if (this._status.value) {
        const status = cloneDeep(this._status.value);
        status.netCore = { status: 'FAILED', version };
        this._status.next(status);
      }
    }
  }

  public async upgradeAspNetCore(version: string): Promise<void> {
    if (this._status.value) {
      const status = cloneDeep(this._status.value);
      status.aspNetCore = { status: 'INSTALLING', version };
      this._status.next(status);
    }
    try {
      await invoke('upgrade_asp_net_core', { version });
      if (this._status.value) {
        const status = cloneDeep(this._status.value);
        status.aspNetCore = { status: 'SUCCESS', version };
        this._status.next(status);
      }
    } catch (e) {
      error('[DotNet] Could not upgrade ASP.NET Core: ' + e);
      if (this._status.value) {
        const status = cloneDeep(this._status.value);
        status.aspNetCore = { status: 'FAILED', version };
        this._status.next(status);
      }
    }
  }

  markAllQueued() {
    if (this._status.value) {
      const status = cloneDeep(this._status.value);
      Object.values(status).forEach((e) => {
        if (e.status === 'INSTALL') e.status = 'QUEUED';
      });
      this._status.next(status);
    }
  }
}
