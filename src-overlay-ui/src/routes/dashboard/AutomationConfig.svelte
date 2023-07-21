<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import Card from '$lib/components/Card.svelte';
	import { blur, scale } from 'svelte/transition';
	import VisualToggle from '$lib/components/VisualToggle.svelte';
	import ipcService from '$lib/services/ipc.service';
	import { derived, get } from 'svelte/store';
	import {
		OyasumiSidecarAutomationsState,
		OyasumiSidecarAutomationsState_AutoAcceptInviteRequests,
		OyasumiSidecarAutomationsState_AutoAcceptInviteRequests_Mode,
		OyasumiSidecarAutomationsState_ChangeStatusBasedOnPlayerCount,
		OyasumiSidecarAutomationsState_ShutdownAutomations,
		OyasumiSidecarAutomationsState_SleepingAnimations
	} from '../../../../src-grpc-web-client/overlay-sidecar_pb';
	import { t } from '$lib/translations';
	import Clickable from '$lib/components/Clickable.svelte';

	$: _t = $t;
	const { state } = ipcService;

	let viewAutomations = derived(state, (state) =>
		Object.entries(state.automations ?? {}).map(
			(e) =>
				({
					id: e[0],
					data: e[1]
				} as {
					id: keyof OyasumiSidecarAutomationsState;
					data: OyasumiSidecarAutomationsState[keyof OyasumiSidecarAutomationsState];
				})
		)
	);

	$: isAutomationEnabled = function <
		T extends keyof OyasumiSidecarAutomationsState = keyof OyasumiSidecarAutomationsState
	>(automationId: T, automation: OyasumiSidecarAutomationsState[T]): boolean {
		switch (automationId) {
			case 'shutdownAutomations': {
				let a = automation as OyasumiSidecarAutomationsState_ShutdownAutomations;
				return !!a.sleepTriggerEnabled;
			}
			default: {
				let a = automation as Exclude<
					OyasumiSidecarAutomationsState[T],
					OyasumiSidecarAutomationsState_ShutdownAutomations
				>;
				return !!a!.enabled;
			}
		}
	};

	$: getTitle = function (automationId: keyof OyasumiSidecarAutomationsState): string {
		return _t(`t.overlay.dashboard.automations.${automationId}.title`);
	};

	$: getSubTitle = function <
		T extends keyof OyasumiSidecarAutomationsState = keyof OyasumiSidecarAutomationsState
	>(automationId: T, automation: OyasumiSidecarAutomationsState[T]): string | null {
		switch (automationId) {
			case 'autoAcceptInviteRequests': {
				let a = automation as OyasumiSidecarAutomationsState_AutoAcceptInviteRequests;
				const { mode, isDisabled } = (() => {
					switch (a.mode!) {
						case OyasumiSidecarAutomationsState_AutoAcceptInviteRequests_Mode.Disabled:
							return {
								mode: _t(`t.overlay.dashboard.automations.autoAcceptInviteRequests.mode.Disabled`),
								isDisabled: true
							};
						case OyasumiSidecarAutomationsState_AutoAcceptInviteRequests_Mode.Whitelist:
							return {
								mode: _t(`t.overlay.dashboard.automations.autoAcceptInviteRequests.mode.Whitelist`),
								isDisabled: false
							};
						case OyasumiSidecarAutomationsState_AutoAcceptInviteRequests_Mode.Blacklist:
							return {
								mode: _t(`t.overlay.dashboard.automations.autoAcceptInviteRequests.mode.Blacklist`),
								isDisabled: false
							};
					}
				})();
				if (isDisabled) return mode;
				return _t(
					`t.overlay.dashboard.automations.autoAcceptInviteRequests.subtitle.${
						a.playerCount === 1 ? 'singular' : 'plural'
					}`,
					{
						mode,
						playerCount: a.playerCount
					}
				);
			}
			case 'changeStatusBasedOnPlayerCount': {
				let a = automation as OyasumiSidecarAutomationsState_ChangeStatusBasedOnPlayerCount;
				return _t(
					`t.overlay.dashboard.automations.changeStatusBasedOnPlayerCount.subtitle.${
						a.threshold === 1 ? 'singular' : 'plural'
					}`,
					{ threshold: a.threshold }
				);
			}
			case 'sleepingAnimations': {
				let a = automation as OyasumiSidecarAutomationsState_SleepingAnimations;
				return a.presetName ? a.presetName : _t(`t.oscAutomations.sleepingAnimations.customPreset`);
			}
			case 'shutdownAutomations': {
				let a = automation as OyasumiSidecarAutomationsState_ShutdownAutomations;
				let seconds = Math.floor((a.timeDelay ?? 0) / 1000);
				let time = '';
				if (seconds < 60) {
					time = _t(
						`t.overlay.dashboard.automations.shutdownAutomations.seconds.${
							seconds === 1 ? 'singular' : 'plural'
						}`,
						{ seconds }
					);
				} else {
					let minutes = Math.round(seconds / 60) + '';
					time = _t(
						`t.overlay.dashboard.automations.shutdownAutomations.minutes.${
							minutes === '1' ? 'singular' : 'plural'
						}`,
						{ minutes }
					);
				}
				return _t(`t.overlay.dashboard.automations.shutdownAutomations.subtitle`, { time });
			}
			default: {
				return null;
			}
		}
	};

	function getIcon<
		T extends keyof OyasumiSidecarAutomationsState = keyof OyasumiSidecarAutomationsState
	>(automationId: T): string {
		const m: Record<keyof OyasumiSidecarAutomationsState, string> = {
			autoAcceptInviteRequests: 'mark_email_read',
			changeStatusBasedOnPlayerCount: 'circle',
			sleepingAnimations: 'bedtime',
			shutdownAutomations: 'settings_power'
		};
		return m[automationId] ?? 'question_mark';
	}

	const dispatch = createEventDispatcher();
</script>

<div transition:scale>
	<div class="flex flex-col items-center justify-center w-[500px]" transition:blur>
		<div class="w-full relative h-14">
			<div
				class="absolute top-0 left-0 w-full h-full p-4 text-white text-3xl dark-glow-80 flex flex-row items-center justify-center"
			>
				<span class="glow-80">{$t(`t.overlay.dashboard.automations.title`)}</span>
			</div>
			<Clickable
				class="absolute top-0 left-0 w-full h-full flex flex-row items-center justify-start"
				on:click={() => dispatch('nav', { mode: 'OVERVIEW' })}
			>
				<Card clickable={true} small>
					<i class="material-icons m-4 glow">arrow_back</i>
				</Card>
			</Clickable>
		</div>
		<div class="w-[100px] h-[2px] rounded-full bg-white bg-opacity-80 mt-8 mb-6 glow-100" />
		{#each $viewAutomations as automation}
			<Clickable class="w-full" on:click={() => ipcService.toggleAutomation(automation.id)}>
				<Card class="w-full mb-6" clickable={true}>
					<div class="flex flex-row items-center p-4">
						<div class="flex-shrink-0 flex flex-row items-center">
							<i class="material-icons text-3xl glow mr-4">{getIcon(automation.id)}</i>
						</div>
						<div class="flex-1 flex flex-col items-start justify-center">
							<span class="text-[1.25em] font-medium">{getTitle(automation.id)}</span>
							{#if getSubTitle(automation.id, automation.data)}
								<span class="text-1xl opacity-70"
									>{getSubTitle(automation.id, automation.data)}</span
								>
							{/if}
						</div>
						<div class="flex-shrink-0 flex flex-row items-center">
							<VisualToggle active={isAutomationEnabled(automation.id, automation.data)} />
						</div>
					</div>
				</Card>
			</Clickable>
		{/each}
	</div>
</div>

<style lang="scss">
</style>
