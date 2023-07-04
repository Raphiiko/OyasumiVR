import { Injectable } from '@angular/core';
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import { invoke } from '@tauri-apps/api';
import { listen } from '@tauri-apps/api/event';
import { BehaviorSubject } from 'rxjs';
import { OyasumiElevatedSidecarClient } from 'src-grpc-web-client/elevated-sidecar_pb.client';
import { OyasumiOverlaySidecarClient } from 'src-grpc-web-client/overlay-sidecar_pb.client';

@Injectable({
  providedIn: 'root',
})
export class IPCService {
  private _overlaySidecarClient = new BehaviorSubject<OyasumiOverlaySidecarClient | undefined>(
    undefined
  );
  private _elevatedSidecarClient = new BehaviorSubject<OyasumiElevatedSidecarClient | undefined>(
    undefined
  );

  public readonly overlaySidecarClient = this._overlaySidecarClient.asObservable();
  public readonly elevatedSidecarClient = this._elevatedSidecarClient.asObservable();

  constructor() {
    listen<number>('OVERLAY_SIDECAR_STARTED', (e) => this.onOverlaySidecarStarted(e.payload));
    listen('OVERLAY_SIDECAR_STOPPED', () => this.onOverlaySidecarStopped());
    listen<number>('ELEVATED_SIDECAR_STARTED', (e) => this.onElevatedSidecarStarted(e.payload));
    listen('ELEVATED_SIDECAR_STOPPED', () => this.onElevatedSidecarStopped());
    invoke<number | undefined>('overlay_sidecar_get_grpc_web_port').then((port) => {
      if (port) this.onOverlaySidecarStarted(port);
      else this.onOverlaySidecarStopped();
    });
    invoke<number | undefined>('elevated_sidecar_get_grpc_web_port').then((port) => {
      if (port) this.onElevatedSidecarStarted(port);
      else this.onElevatedSidecarStopped();
    });
    // this.onOverlaySidecarStarted(5175);
  }

  onOverlaySidecarStarted(port: number) {
    this._overlaySidecarClient.next(
      new OyasumiOverlaySidecarClient(
        new GrpcWebFetchTransport({
          baseUrl: `http://localhost:${port}`,
        })
      )
    );
  }

  onOverlaySidecarStopped() {
    this._overlaySidecarClient.next(undefined);
  }

  onElevatedSidecarStarted(port: number) {
    this._elevatedSidecarClient.next(
      new OyasumiElevatedSidecarClient(
        new GrpcWebFetchTransport({
          baseUrl: `http://localhost:${port}`,
        })
      )
    );
  }

  onElevatedSidecarStopped() {
    this._elevatedSidecarClient.next(undefined);
  }
}
