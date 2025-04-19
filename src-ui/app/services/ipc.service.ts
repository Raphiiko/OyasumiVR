import { Injectable } from '@angular/core';
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import { invoke } from '@tauri-apps/api/core';
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

  constructor() {}

  public async init() {
    // Listen for sidecars starting/stopping
    listen<number>('OVERLAY_SIDECAR_STARTED', (e) => this.onOverlaySidecarStarted(e.payload));
    listen('OVERLAY_SIDECAR_STOPPED', () => this.onOverlaySidecarStopped());
    listen<number>('ELEVATED_SIDECAR_STARTED', (e) => this.onElevatedSidecarStarted(e.payload));
    listen('ELEVATED_SIDECAR_STOPPED', () => this.onElevatedSidecarStopped());
    // Get current sidecar status
    invoke<number | undefined>('overlay_sidecar_get_grpc_web_port').then((port) => {
      if (port) this.onOverlaySidecarStarted(port);
      else this.onOverlaySidecarStopped();
    });
    invoke<number | undefined>('elevated_sidecar_get_grpc_web_port').then((port) => {
      if (port) this.onElevatedSidecarStarted(port);
      else this.onElevatedSidecarStopped();
    });
  }

  public getOverlaySidecarClient(): OyasumiOverlaySidecarClient | null {
    return this._overlaySidecarClient.value ?? null;
  }

  public getElevatedSidecarClient(): OyasumiElevatedSidecarClient | null {
    return this._elevatedSidecarClient.value ?? null;
  }

  private onOverlaySidecarStarted(port: number) {
    this._overlaySidecarClient.next(
      new OyasumiOverlaySidecarClient(
        new GrpcWebFetchTransport({
          baseUrl: `http://localhost:${port}`,
        })
      )
    );
  }

  private onOverlaySidecarStopped() {
    this._overlaySidecarClient.next(undefined);
  }

  private onElevatedSidecarStarted(port: number) {
    this._elevatedSidecarClient.next(
      new OyasumiElevatedSidecarClient(
        new GrpcWebFetchTransport({
          baseUrl: `http://localhost:${port}`,
        })
      )
    );
  }

  private onElevatedSidecarStopped() {
    this._elevatedSidecarClient.next(undefined);
  }
}
