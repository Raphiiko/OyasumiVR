import { Injectable } from '@angular/core';
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import { BehaviorSubject } from 'rxjs';
import { OyasumiElevatedSidecarClient } from 'src-grpc-web-client/elevated-sidecar_pb.client';
import { OyasumiOverlaySidecarClient } from 'src-grpc-web-client/overlay-sidecar_pb.client';
import { commands, events } from '../bindings';

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
    events.overlaySidecarStartedEvent.listen((e) => this.onOverlaySidecarStarted(e.payload));
    events.overlaySidecarStoppedEvent.listen(() => this.onOverlaySidecarStopped());
    events.elevatedSidecarStartedEvent.listen((e) => this.onElevatedSidecarStarted(e.payload));
    events.elevatedSidecarStoppedEvent.listen(() => this.onElevatedSidecarStopped());
    // Get current sidecar status
    commands.overlaySidecarGetGrpcWebPort().then((port) => {
      if (port) this.onOverlaySidecarStarted(port);
      else this.onOverlaySidecarStopped();
    });
    commands.elevatedSidecarGetGrpcWebPort().then((port) => {
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
