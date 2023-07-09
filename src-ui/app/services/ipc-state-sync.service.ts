import { Injectable } from '@angular/core';
import { SleepService } from './sleep.service';
import { VRChatService } from './vrchat.service';
import { OyasumiAppState, VRCStatus } from 'src-grpc-web-client/deps/oyasumi-state_pb';
import { BehaviorSubject, combineLatest, filter, map, switchMap } from 'rxjs';
import { cloneDeep } from 'lodash';
import { UserStatus } from 'vrchat';
import { IPCService } from './ipc.service';
import { OyasumiOverlaySidecarClient } from 'src-grpc-web-client/overlay-sidecar_pb.client';

@Injectable({
  providedIn: 'root',
})
export class IPCStateSyncService {
  private state = new BehaviorSubject<OyasumiAppState>({
    sleepMode: false,
    vrcStatus: VRCStatus.VRCStatus_Offline,
    vrcUsername: '',
  });

  constructor(
    private sleepService: SleepService,
    private vrchatService: VRChatService,
    private ipcService: IPCService
  ) {}

  async init() {
    // Sync state to overlay sidecar
    combineLatest([this.state, this.ipcService.overlaySidecarClient])
      .pipe(filter(([, client]) => !!client))
      .subscribe(([state, client]) => client!.syncState(state));
    // Update state when sleep mode changes
    this.sleepService.mode.subscribe((sleepMode) => {
      this.state.next({ ...cloneDeep(this.state.value), sleepMode });
    });
    // Update the state when the VRChat user or their status changes.
    this.vrchatService.user.subscribe((user) => {
      this.state.next({
        ...cloneDeep(this.state.value),
        vrcUsername: user?.displayName ?? '',
        vrcStatus: this.mapVRCStatus(user?.status),
      });
    });
  }

  private mapVRCStatus(vrcStatus: UserStatus | undefined): VRCStatus {
    switch (vrcStatus) {
      case UserStatus.JoinMe:
        return VRCStatus.VRCStatus_JoinMe;
      case UserStatus.Active:
        return VRCStatus.VRCStatus_Active;
      case UserStatus.AskMe:
        return VRCStatus.VRCStatus_AskMe;
      case UserStatus.Busy:
        return VRCStatus.VRCStatus_Busy;
      default:
        return VRCStatus.VRCStatus_Offline;
    }
  }
}
