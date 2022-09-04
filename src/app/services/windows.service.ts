import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/tauri';
import { BehaviorSubject, Observable, ReplaySubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class WindowsService {
  private _isElevated: ReplaySubject<boolean> = new ReplaySubject<boolean>();
  public isElevated: Observable<boolean> = this._isElevated.asObservable();

  constructor() {}

  async init() {
    this._isElevated.next(await this.checkIfElevated());
  }

  private async checkIfElevated(): Promise<boolean> {
    return invoke<boolean>('windows_is_elevated');
  }

  public relaunchWithElevation() {
    return invoke<boolean>('windows_relaunch_with_elevation');
  }
}
