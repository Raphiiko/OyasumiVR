<script lang="ts">
	import ipcService from '$lib/services/ipc.service';
	import { blur, scale } from 'svelte/transition';
	import Card from '$lib/components/Card.svelte';
	import { createEventDispatcher } from 'svelte';
	import controllerIcon from '$lib/images/icon_controller.png';
	import trackerIcon from '$lib/images/icon_tracker.png';
	import { get } from 'svelte/store';
	import { t } from '$lib/translations';
	import Clickable from '$lib/components/Clickable.svelte';

	const { state } = ipcService;
	const dispatch = createEventDispatcher();

	$: _t = $t;
	$: activeControllers = ($state.deviceInfo?.controllers ?? []).filter(
		(d) => d.canPowerOff && !d.isTurningOff
	);
	$: activeTrackers = ($state.deviceInfo?.trackers ?? []).filter(
		(d) => d.canPowerOff && !d.isTurningOff
	);
	$: canTurnOffAllControllers =
		activeControllers.length > 0 && Date.now() - turnOffAllControllersLastPressed > 400;
	$: canTurnOffAllTrackers =
		activeTrackers.length > 0 && Date.now() - turnOffAllTrackersLastPressed > 400;
	$: canTurnOffAllControllersAndTrackers =
		canTurnOffAllControllers &&
		canTurnOffAllTrackers &&
		Date.now() - turnOffAllControllersAndTrackersLastPressed > 400;

	let turnOffAllControllersLastPressed = 0;
	let turnOffAllTrackersLastPressed = 0;
	let turnOffAllControllersAndTrackersLastPressed = 0;

	function turnOffAllControllers() {
		if (!canTurnOffAllControllers) return;
		turnOffAllControllersLastPressed = Date.now();
		ipcService.addNotification(_t('t.notifications.turningOffControllers.content'), 3000);
		ipcService.turnOffOVRDevices((get(state).deviceInfo?.controllers || []).map((d) => d.index));
		setTimeout(() => {
			turnOffAllControllersLastPressed = turnOffAllControllersLastPressed;
			dispatch('closeDashboard');
		}, 500);
	}

	function turnOffAllTrackers() {
		if (!canTurnOffAllTrackers) return;
		turnOffAllTrackersLastPressed = Date.now();
		ipcService.addNotification(_t('t.notifications.turningOffTrackers.content'), 3000);
		ipcService.turnOffOVRDevices((get(state).deviceInfo?.trackers || []).map((d) => d.index));
		setTimeout(() => {
			turnOffAllTrackersLastPressed = turnOffAllTrackersLastPressed;
		}, 500);
	}

	function turnOffAllControllersAndTrackers() {
		if (!canTurnOffAllControllersAndTrackers) return;
		turnOffAllControllersAndTrackersLastPressed = Date.now();
		ipcService.addNotification(
			_t('t.notifications.turningOffControllersAndTrackers.content'),
			3000
		);
		const _state = get(state);
		ipcService.turnOffOVRDevices([
			...(_state.deviceInfo?.trackers || []).map((d) => d.index),
			...(_state.deviceInfo?.controllers || []).map((d) => d.index)
		]);
		setTimeout(() => {
			turnOffAllControllersAndTrackersLastPressed = turnOffAllControllersAndTrackersLastPressed;
			dispatch('closeDashboard');
		}, 500);
	}
</script>

<div transition:scale|global>
	<div class="flex flex-col items-center justify-center w-[500px]" transition:blur|global>
		<!-- HEADER -->
		<div class="w-full relative h-14">
			<div
				class="absolute top-0 left-0 w-full h-full p-4 text-white text-3xl dark-glow-80 flex flex-row items-center justify-center"
			>
				<span class="glow-80">{$t(`t.overlay.dashboard.deviceControl.title`)}</span>
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
		<div class="action-grid grid grid-cols-3 gap-6 w-full auto-rows-fr mt-4">
			<!-- TURN OFF CONTROLLERS -->
			<Clickable
				class="w-full mb-6 col-start-1 row-start-1"
				on:click={turnOffAllControllers}
				tooltip={$t('t.overlay.dashboard.deviceControl.turnOff.AllControllers')}
			>
				<Card class="h-full" clickable disabled={!canTurnOffAllControllers}>
					<div class="flex flex-col justify-center items-center w-full h-full">
						<img src={controllerIcon} class="glow w-[72px]" />
					</div>
				</Card>
			</Clickable>
			<!-- TURN OFF TRACKERS -->
			<Clickable
				class="w-full mb-6"
				on:click={turnOffAllTrackers}
				tooltip={$t('t.overlay.dashboard.deviceControl.turnOff.AllTrackers')}
			>
				<Card class="h-full" clickable disabled={!canTurnOffAllTrackers}>
					<div class="flex flex-col justify-center items-center w-full h-full">
						<img src={trackerIcon} class="glow w-[72px]" />
					</div>
				</Card>
			</Clickable>
			<!-- TURN OFF CONTROLLERS AND TRACKERS -->
			<Clickable
				class="w-full mb-6"
				on:click={turnOffAllControllersAndTrackers}
				tooltip={$t('t.overlay.dashboard.deviceControl.turnOff.AllControllersAndTrackers')}
			>
				<Card class="h-full" clickable disabled={!canTurnOffAllControllersAndTrackers}>
					<div class="flex flex-col justify-center items-center w-full h-full">
						<img src={controllerIcon} class="glow w-[64px]" />
						<img src={trackerIcon} class="glow w-[64px]" />
					</div>
				</Card>
			</Clickable>
		</div>
	</div>
</div>

<style lang="scss">
	.action-grid {
		&::before {
			content: '';
			width: 0;
			padding-bottom: 100%;
			grid-row: 1 / 1;
			grid-column: 1 / 1;
		}
	}
</style>
