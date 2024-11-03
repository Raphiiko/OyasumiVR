export type VRChatLogEventType = 'OnPlayerJoined' | 'OnPlayerLeft' | 'OnLocationChange';

export type VRChatLogEvent =
  | VRChatOnPlayerJoinedEvent
  | VRChatOnPlayerLeftEvent
  | VRChatOnLocationChangeEvent;

interface VRChatLogEventBase {
  type: VRChatLogEventType;
  timestamp: Date;
  initialLoad: boolean;
}

export interface VRChatOnPlayerJoinedEvent extends VRChatLogEventBase {
  type: 'OnPlayerJoined';
  displayName: string;
  userId: string;
}

export interface VRChatOnPlayerLeftEvent extends VRChatLogEventBase {
  type: 'OnPlayerLeft';
  displayName: string;
  userId: string;
}

export interface VRChatOnLocationChangeEvent extends VRChatLogEventBase {
  type: 'OnLocationChange';
  instanceId: string;
}
