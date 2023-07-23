// @generated by protobuf-ts 2.9.0 with parameter add_pb_suffix,force_server_none
// @generated from protobuf file "overlay-sidecar.proto" (package "OyasumiOverlaySidecar", syntax proto3)
// tslint:disable
import type { RpcTransport } from '@protobuf-ts/runtime-rpc';
import type { ServiceInfo } from '@protobuf-ts/runtime-rpc';
import { OyasumiOverlaySidecar } from './overlay-sidecar_pb';
import type { SetDebugTranslationsRequest } from './overlay-sidecar_pb';
import type { OyasumiSidecarState } from './overlay-sidecar_pb';
import type { ClearNotificationRequest } from './overlay-sidecar_pb';
import type { AddNotificationResponse } from './overlay-sidecar_pb';
import type { AddNotificationRequest } from './overlay-sidecar_pb';
import { stackIntercept } from '@protobuf-ts/runtime-rpc';
import type { PingResponse } from './overlay-sidecar_pb';
import type { Empty } from './overlay-sidecar_pb';
import type { UnaryCall } from '@protobuf-ts/runtime-rpc';
import type { RpcOptions } from '@protobuf-ts/runtime-rpc';
/**
 * @generated from protobuf service OyasumiOverlaySidecar.OyasumiOverlaySidecar
 */
export interface IOyasumiOverlaySidecarClient {
  /**
   * @generated from protobuf rpc: Ping(OyasumiOverlaySidecar.Empty) returns (OyasumiOverlaySidecar.PingResponse);
   */
  ping(input: Empty, options?: RpcOptions): UnaryCall<Empty, PingResponse>;
  /**
   * @generated from protobuf rpc: RequestStop(OyasumiOverlaySidecar.Empty) returns (OyasumiOverlaySidecar.Empty);
   */
  requestStop(input: Empty, options?: RpcOptions): UnaryCall<Empty, Empty>;
  /**
   * @generated from protobuf rpc: AddNotification(OyasumiOverlaySidecar.AddNotificationRequest) returns (OyasumiOverlaySidecar.AddNotificationResponse);
   */
  addNotification(
    input: AddNotificationRequest,
    options?: RpcOptions
  ): UnaryCall<AddNotificationRequest, AddNotificationResponse>;
  /**
   * @generated from protobuf rpc: ClearNotification(OyasumiOverlaySidecar.ClearNotificationRequest) returns (OyasumiOverlaySidecar.Empty);
   */
  clearNotification(
    input: ClearNotificationRequest,
    options?: RpcOptions
  ): UnaryCall<ClearNotificationRequest, Empty>;
  /**
   * @generated from protobuf rpc: SyncState(OyasumiOverlaySidecar.OyasumiSidecarState) returns (OyasumiOverlaySidecar.Empty);
   */
  syncState(
    input: OyasumiSidecarState,
    options?: RpcOptions
  ): UnaryCall<OyasumiSidecarState, Empty>;
  /**
   * @generated from protobuf rpc: SetDebugTranslations(OyasumiOverlaySidecar.SetDebugTranslationsRequest) returns (OyasumiOverlaySidecar.Empty);
   */
  setDebugTranslations(
    input: SetDebugTranslationsRequest,
    options?: RpcOptions
  ): UnaryCall<SetDebugTranslationsRequest, Empty>;
}
/**
 * @generated from protobuf service OyasumiOverlaySidecar.OyasumiOverlaySidecar
 */
export class OyasumiOverlaySidecarClient implements IOyasumiOverlaySidecarClient, ServiceInfo {
  typeName = OyasumiOverlaySidecar.typeName;
  methods = OyasumiOverlaySidecar.methods;
  options = OyasumiOverlaySidecar.options;
  constructor(private readonly _transport: RpcTransport) {}
  /**
   * @generated from protobuf rpc: Ping(OyasumiOverlaySidecar.Empty) returns (OyasumiOverlaySidecar.PingResponse);
   */
  ping(input: Empty, options?: RpcOptions): UnaryCall<Empty, PingResponse> {
    const method = this.methods[0],
      opt = this._transport.mergeOptions(options);
    return stackIntercept<Empty, PingResponse>('unary', this._transport, method, opt, input);
  }
  /**
   * @generated from protobuf rpc: RequestStop(OyasumiOverlaySidecar.Empty) returns (OyasumiOverlaySidecar.Empty);
   */
  requestStop(input: Empty, options?: RpcOptions): UnaryCall<Empty, Empty> {
    const method = this.methods[1],
      opt = this._transport.mergeOptions(options);
    return stackIntercept<Empty, Empty>('unary', this._transport, method, opt, input);
  }
  /**
   * @generated from protobuf rpc: AddNotification(OyasumiOverlaySidecar.AddNotificationRequest) returns (OyasumiOverlaySidecar.AddNotificationResponse);
   */
  addNotification(
    input: AddNotificationRequest,
    options?: RpcOptions
  ): UnaryCall<AddNotificationRequest, AddNotificationResponse> {
    const method = this.methods[2],
      opt = this._transport.mergeOptions(options);
    return stackIntercept<AddNotificationRequest, AddNotificationResponse>(
      'unary',
      this._transport,
      method,
      opt,
      input
    );
  }
  /**
   * @generated from protobuf rpc: ClearNotification(OyasumiOverlaySidecar.ClearNotificationRequest) returns (OyasumiOverlaySidecar.Empty);
   */
  clearNotification(
    input: ClearNotificationRequest,
    options?: RpcOptions
  ): UnaryCall<ClearNotificationRequest, Empty> {
    const method = this.methods[3],
      opt = this._transport.mergeOptions(options);
    return stackIntercept<ClearNotificationRequest, Empty>(
      'unary',
      this._transport,
      method,
      opt,
      input
    );
  }
  /**
   * @generated from protobuf rpc: SyncState(OyasumiOverlaySidecar.OyasumiSidecarState) returns (OyasumiOverlaySidecar.Empty);
   */
  syncState(
    input: OyasumiSidecarState,
    options?: RpcOptions
  ): UnaryCall<OyasumiSidecarState, Empty> {
    const method = this.methods[4],
      opt = this._transport.mergeOptions(options);
    return stackIntercept<OyasumiSidecarState, Empty>('unary', this._transport, method, opt, input);
  }
  /**
   * @generated from protobuf rpc: SetDebugTranslations(OyasumiOverlaySidecar.SetDebugTranslationsRequest) returns (OyasumiOverlaySidecar.Empty);
   */
  setDebugTranslations(
    input: SetDebugTranslationsRequest,
    options?: RpcOptions
  ): UnaryCall<SetDebugTranslationsRequest, Empty> {
    const method = this.methods[5],
      opt = this._transport.mergeOptions(options);
    return stackIntercept<SetDebugTranslationsRequest, Empty>(
      'unary',
      this._transport,
      method,
      opt,
      input
    );
  }
}
