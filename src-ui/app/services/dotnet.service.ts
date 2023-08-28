import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { error } from 'tauri-plugin-log-api';
import { Client, getClient } from '@tauri-apps/api/http';
import { BehaviorSubject } from 'rxjs';
import { ModalService } from './modal.service';
import { DotnetUpgradeModalComponent } from '../components/dotnet-upgrade-modal/dotnet-upgrade-modal.component';
import { cloneDeep } from 'lodash';

type StatusResponse = Record<'DOTNETCORE' | 'ASPNETCORE', string>;

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

  // V2 requires a specific patch version for each runtime
  private async checkRuntimes(): Promise<CheckResult> {
    const result: CheckResult = {
      netCore: { status: 'OK' },
      aspNetCore: { status: 'OK' },
    };
    const status = await invoke<StatusResponse>('check_dotnet_install_required');
    if (status.DOTNETCORE) {
      result.netCore = {
        status: 'INSTALL',
        version: status.DOTNETCORE,
      };
    }
    if (status.ASPNETCORE) {
      result.aspNetCore = {
        status: 'INSTALL',
        version: status.ASPNETCORE,
      };
    }
    return result;
  }

  public async installNetCore(version: string): Promise<void> {
    if (this._status.value) {
      const status = cloneDeep(this._status.value);
      status.netCore = { status: 'INSTALLING', version };
      this._status.next(status);
    }
    try {
      await invoke('install_net_core', { version });
      if (this._status.value) {
        const status = cloneDeep(this._status.value);
        status.netCore = { status: 'SUCCESS', version };
        this._status.next(status);
      }
    } catch (e) {
      error('[DotNet] Could not install .NET Core: ' + e);
      if (this._status.value) {
        const status = cloneDeep(this._status.value);
        status.netCore = { status: 'FAILED', version };
        this._status.next(status);
      }
    }
  }

  public async installAspNetCore(version: string): Promise<void> {
    if (this._status.value) {
      const status = cloneDeep(this._status.value);
      status.aspNetCore = { status: 'INSTALLING', version };
      this._status.next(status);
    }
    try {
      await invoke('install_asp_net_core', { version });
      if (this._status.value) {
        const status = cloneDeep(this._status.value);
        status.aspNetCore = { status: 'SUCCESS', version };
        this._status.next(status);
      }
    } catch (e) {
      error('[DotNet] Could not install ASP.NET Core: ' + e);
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
