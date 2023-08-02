import type { OyasumiSidecarState } from '../../../../src-grpc-web-client/overlay-sidecar_pb';
import {
	OyasumiSidecarAutomationsState_AutoAcceptInviteRequests_Mode,
	VrcStatus
} from '../../../../src-grpc-web-client/overlay-sidecar_pb';

export const DEFAULT_OYASUMI_STATE: OyasumiSidecarState = {
	sleepMode: false,
	vrcStatus: VrcStatus.Offline,
	vrcUsername: '',
	automations: {
		sleepModeEnableForSleepDetector: {
			enabled: false,
			sensitivity: 'LOWEST'
		},
		autoAcceptInviteRequests: {
			enabled: false,
			mode: OyasumiSidecarAutomationsState_AutoAcceptInviteRequests_Mode.Whitelist,
			playerCount: 1
		},
		changeStatusBasedOnPlayerCount: {
			enabled: false,
			threshold: 1
		},
		sleepingAnimations: {
			enabled: false,
			presetName: ''
		},
		shutdownAutomations: {
			sleepTriggerEnabled: false,
			timeDelay: 0
		}
	},
	locale: 'en',
	deviceInfo: {
		controllers: [],
		trackers: []
	}
};
