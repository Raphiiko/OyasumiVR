<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { blurFly } from '$lib/utils/transitions';
	import logo from '$lib/images/logo.png';
	import deviceControlIcon from '$lib/images/icon_device_control.png';
	import Card from '$lib/components/Card.svelte';
	import BrightnessSliders from '$lib/components/BrightnessSliders.svelte';
	import ColorTempSlider from '$lib/components/ColorTempSlider.svelte';
	import ipc from '$lib/services/ipc.service';
	import { get, writable, derived } from 'svelte/store';
	import { createEventDispatcher, onDestroy } from 'svelte';
	import { t } from '$lib/translations';
	import Clickable from '$lib/components/Clickable.svelte';
	import throttle from 'just-throttle';

	// Input & Output
	const dispatch = createEventDispatcher();
	export let shutdownSequenceDisabled = true;

	// Animation settings
	let animationSpeed = 300;
	let staggerOffset = 50;
	let flyYTransform = 30;

	$: time = new Date();
	$: timeHours = time.getHours().toString().padStart(2, '0');
	$: timeMinutes = time.getMinutes().toString().padStart(2, '0');

	const { state, vrcLoggedIn } = ipc;

	$: cctState = $state.cctState;
	$: sleepPreparationEnabled =
		$state.sleepPreparationAvailable && !$state.sleepPreparationTimedOut && !$state.sleepMode;

	const sliderMode = writable<'BRIGHTNESS' | 'COLOR_TEMP'>('BRIGHTNESS');
	const sliderModeButtonMode = derived(sliderMode, (sliderMode) => {
		return (sliderMode === 'BRIGHTNESS' ? 'COLOR_TEMP' : 'BRIGHTNESS') as
			| 'BRIGHTNESS'
			| 'COLOR_TEMP';
	});

	// Set the slider mode back to BRIGHTNESS if CCT control is disabled
	// TODO: TEST
	$: {
		if (!$state.cctState?.enabled && $sliderMode === 'COLOR_TEMP') {
			sliderMode.set('BRIGHTNESS');
		}
	}

	function toggleSleepMode() {
		const mode = !get(state).sleepMode;
		ipc.setSleepMode(mode);
		if (mode) setTimeout(() => dispatch('closeDashboard'), 500);
	}
</script>

<div class="flex flex-col w-[500px]">
	<!-- LOGO HEADER -->
	<div
		class="flex flex-col items-center justify-center w-full px-[80px] mb-4"
		transition:blurFly|global={{ duration: animationSpeed, y: flyYTransform }}
	>
		<img src={logo} alt="Oyasumi Logo" class="glow-100" />
	</div>
	<div
		class="grid grid-cols-3 gap-6 w-full auto-rows-fr mt-5 before:multi-[w-0;pb-[100%];row-start-1;row-end-1;col-start-1;col-end-1]"
	>
		<!-- SLEEP MODE TOGGLE -->
		<div
			class="col-span-3 col-start-1 col-end-3 row-start-1 row-end-1 w-full h-full"
			transition:blurFly|global={{
				duration: animationSpeed,
				y: flyYTransform,
				delay: staggerOffset
			}}
		>
			<Clickable on:click={toggleSleepMode}>
				<Card clickable={true} active={$state.sleepMode} class="w-full h-full">
					<div class="flex flex-row items-center justify-center w-full h-full p-4">
						<i class="material-icons glow text-8xl flex-shrink-0">nights_stay</i>
						<div class="flex-1 flex flex-col items-center justify-center text-center pl-4">
							<span class="opacity-60 text-xl">{$t('t.overlay.dashboard.overview.sleepMode')}</span>
							<span class="text-3xl whitespace-nowrap"
								>{$state.sleepMode
									? $t('t.overlay.dashboard.overview.active')
									: $t('t.overlay.dashboard.overview.inactive')}</span
							>
						</div>
					</div>
				</Card>
			</Clickable>
		</div>
		<!-- SLEEP PREPARATION-->
		<div
			transition:blurFly|global={{
				duration: animationSpeed,
				y: flyYTransform,
				delay: staggerOffset * 2
			}}
		>
			<Clickable
				on:click={() => {
					if (sleepPreparationEnabled) ipc.prepareForSleep();
				}}
				tooltip={$t('t.overlay.dashboard.overview.tooltip.prepareForSleep')}
			>
				<Card
					class="w-full h-full"
					clickable={true}
					disabled={!sleepPreparationEnabled}
					active={$state.sleepPreparationTimedOut}
				>
					<div class="flex flex-row items-center justify-center w-full h-full p-6">
						<i class="material-icons-outlined glow text-8xl flex-shrink-0">bedtime</i>
					</div>
				</Card>
			</Clickable>
		</div>
		<!-- AUTOMATION CONFIG -->
		<div
			transition:blurFly|global={{
				duration: animationSpeed,
				y: flyYTransform,
				delay: staggerOffset * 3
			}}
		>
			<Clickable
				on:click={() => {
					dispatch('nav', { mode: 'AUTOMATIONS' });
				}}
				tooltip={$t('t.overlay.dashboard.overview.tooltip.automations')}
			>
				<Card clickable={true} class="w-full h-full">
					<div class="flex flex-row items-center justify-center w-full h-full p-6">
						<i class="material-icons glow text-8xl flex-shrink-0">settings_suggest</i>
					</div>
				</Card>
			</Clickable>
		</div>
		<!-- DEVICE CONTROL -->
		<div
			transition:blurFly|global={{
				duration: animationSpeed,
				y: flyYTransform,
				delay: staggerOffset * 4
			}}
		>
			<Clickable
				on:click={() => {
					dispatch('nav', { mode: 'DEVICE_CONTROL' });
				}}
				tooltip={$t('t.overlay.dashboard.overview.tooltip.deviceControl')}
			>
				<Card clickable={true} class="w-full h-full">
					<div
						class="flex flex-row items-center justify-center w-full h-full p-6 pointer-events-none"
					>
						<img src={deviceControlIcon} class="glow w-8/12" />
					</div>
				</Card>
			</Clickable>
		</div>
		<!-- SHUTDOWN SEQUENCE -->
		<div
			transition:blurFly|global={{
				duration: animationSpeed,
				y: flyYTransform,
				delay: staggerOffset * 5
			}}
		>
			<Clickable
				on:click={() => {
					if (!shutdownSequenceDisabled) dispatch('openShutdownSequence');
				}}
				tooltip={$t('t.overlay.dashboard.overview.tooltip.shutdown')}
			>
				<Card clickable={true} class="w-full h-full" disabled={shutdownSequenceDisabled}>
					<div class="flex flex-row items-center justify-center w-full h-full p-6">
						<i class="material-icons glow text-8xl flex-shrink-0">settings_power</i>
					</div>
				</Card>
			</Clickable>
		</div>
	</div>
	<!-- STATUS BAR -->
	<div
		class="mt-6 z-10 grid grid-cols-6 gap-6"
		transition:blurFly|global={{
			duration: animationSpeed,
			y: flyYTransform,
			delay: staggerOffset * 6
		}}
	>
		{#if !!cctState}
			<Card class={cctState.enabled ? 'col-span-5' : 'col-span-6'}>
				<div class="flex flex-row items-center p-3 text-xl font-semibold">
					{#if $vrcLoggedIn}
						<div class="flex-shrink-0 flex flex-row items-center" transition:fade|global>
							<div
								class="rounded-full w-4 h-4 mr-2 glow transition-all
                    vrc-status-color-{$state.vrcStatus}
                  "
							/>
							<span>{$state.vrcUsername}</span>
						</div>
					{/if}
					<div class="flex-1 flex flex-row items-center justify-end">
						<span>{timeHours}</span><span class="blink">:</span><span>{timeMinutes}</span>
						<i class="material-icons-round ml-2 opacity-60">access_time</i>
					</div>
				</div>
			</Card>
			{#if cctState.enabled}
				<Clickable
					tooltip={$t('t.overlay.dashboard.overview.tooltip.sliderMode.' + $sliderModeButtonMode)}
					on:click={() => sliderMode.set($sliderModeButtonMode)}
				>
					<Card class="col-span-1 w-full h-full relative" clickable={true}>
						{#if $sliderModeButtonMode === 'COLOR_TEMP'}
							<div
								transition:fade={{
									duration: 100
								}}
								class="flex flex-row items-center justify-center w-full h-full absolute top-0 left-0"
							>
								<i class="material-icons text-3xl">thermostat</i>
							</div>
						{:else if $sliderModeButtonMode === 'BRIGHTNESS'}
							<div
								transition:fade={{
									duration: 100
								}}
								class="flex flex-row items-center justify-center w-full h-full absolute top-0 left-0"
							>
								<i class="material-icons text-3xl">wb_sunny</i>
							</div>
						{/if}
					</Card>
				</Clickable>
			{/if}
		{/if}
	</div>
	<!-- BRIGHTNESS SLIDERS -->
	<div
		class="relative w-full h-60"
		transition:blurFly|global={{
			duration: animationSpeed,
			y: flyYTransform,
			delay: staggerOffset * 7
		}}
	>
		{#if $sliderMode === 'BRIGHTNESS'}
			<div
				class="mt-6 z-0 absolute top-0 left-0 w-full"
				transition:blurFly={{
					duration: animationSpeed,
					y: flyYTransform
				}}
			>
				<BrightnessSliders />
			</div>
		{:else if $sliderMode === 'COLOR_TEMP'}
			<div
				class="mt-6 z-0 absolute top-0 left-0 w-full"
				transition:blurFly={{
					duration: animationSpeed,
					y: flyYTransform
				}}
			>
				{#if !!cctState}
					<ColorTempSlider
						label={$t('t.overlay.colorTemp')}
						min={cctState.min}
						max={cctState.max}
						value={cctState.value}
						isTransitioning={cctState.transitioning}
						transitionTarget={cctState.transitionTarget}
						onValueChange={throttle((value) => ipc.setColorTemperature(value), 16, {
							leading: true,
							trailing: true
						})}
					/>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style lang="scss">
	.blink {
		animation: blinker 1s linear infinite;
	}

	@keyframes blinker {
		50% {
			opacity: 0;
		}
	}
</style>
