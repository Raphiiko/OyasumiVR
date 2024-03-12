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
			sensitivity: 'LOWEST',
			activationWindow: false,
			activationWindowStart: [23, 0],
			activationWindowEnd: [7, 0]
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
			timeDelay: 0,
			running: false,
			canStart: false
		}
	},
	locale: 'en',
	deviceInfo: {
		controllers: [],
		trackers: []
	},
	brightnessState: {
		advancedMode: false,
		brightness: 100,
		hardwareBrightness: 100,
		softwareBrightness: 100,
		brightnessTransitioning: false,
		hardwareBrightnessTransitioning: false,
		softwareBrightnessTransitioning: false,
		brightnessTransitionTarget: 100,
		hardwareBrightnessTransitionTarget: 100,
		softwareBrightnessTransitionTarget: 100,
		hardwareBrightnessAvailable: false,
		hardwareMinBrightness: 20,
		hardwareMaxBrightness: 160
	},
	sleepPreparationAvailable: false,
	sleepPreparationTimedOut: false,
  systemMicMuted: false,
};
