<script lang="ts">
	import {
		fly,
		type FlyParams,
		blur,
		type BlurParams,
		fade,
		type TransitionConfig
	} from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import logo from '$lib/images/logo.png';
	import Card from '$lib/components/Card.svelte';
	import BrightnessSlider from '$lib/components/BrightnessSlider.svelte';
	import { onMount } from 'svelte';
	import ipcService from '$lib/services/ipc.service';
	import { get } from 'svelte/store';

	// Animation settings
	let animationSpeed = 400;
	let staggerOffset = 80;
	let flyYTransform = 40;

	let ready = false;
	window.OyasumiIPCIn.hideDashboard = async () => ((ready = false), void 0);
	window.OyasumiIPCIn.showDashboard = async () => ((ready = true), void 0);
	onMount(() => window.OyasumiIPCOut.onUiReady());

	$: time = new Date();
	$: timeHours = time.getHours().toString().padStart(2, '0');
	$: timeMinutes = time.getMinutes().toString().padStart(2, '0');

	const { sleepMode, vrcLoggedIn, vrcStatus, vrcUsername } = ipcService;

	function toggleSleepMode() {
		ipcService.setSleepMode(!get(sleepMode));
	}

	function blurFly(node: Element, options?: FlyParams & BlurParams): TransitionConfig {
		const flyTransition = fly(node, options);
		const blurTransition = blur(node, options);

		return {
			duration: options?.duration ?? 300,
			delay: options?.delay ?? 0,
			easing: options?.easing ?? backOut,
			css: (t: number, u: number) => `
            ${flyTransition.css!(t, u)};
            ${blurTransition.css!(t, u)}
        `
		};
	}
</script>

<main>
	{#if ready}
		<div class="dashboard-container">
			<div
				class="logo-container"
				transition:blurFly={{ duration: animationSpeed, y: flyYTransform }}
			>
				<img src={logo} alt="Oyasumi Logo" />
			</div>
			<div class="action-container">
				<div
					class="action-large"
					on:click={toggleSleepMode}
					transition:blurFly={{
						duration: animationSpeed,
						y: flyYTransform,
						delay: staggerOffset * 1
					}}
				>
					<Card clickable={true} active={$sleepMode} class="w-full h-full">
						<div class="action-contents">
							<i class="material-icons">nights_stay</i>
							<div class="sleep-mode-info">
								<span>Sleep Mode</span>
								<span>{$sleepMode ? 'Active' : 'Inactive'}</span>
							</div>
						</div>
					</Card>
				</div>
				<div
					transition:blurFly={{
						duration: animationSpeed,
						y: flyYTransform,
						delay: staggerOffset * 2
					}}
					on:mouseenter={() => window.OyasumiIPCOut_Dashboard.showToolTip('Automations')}
					on:mouseleave={() => window.OyasumiIPCOut_Dashboard.showToolTip(null)}
				>
					<Card clickable={true} class="w-full h-full">
						<div class="action-contents">
							<i class="material-icons">settings_suggest</i>
						</div>
					</Card>
				</div>
				<div
					transition:blurFly={{
						duration: animationSpeed,
						y: flyYTransform,
						delay: staggerOffset * 3
					}}
					on:mouseenter={() => window.OyasumiIPCOut_Dashboard.showToolTip('Shutdown Sequence')}
					on:mouseleave={() => window.OyasumiIPCOut_Dashboard.showToolTip(null)}
				>
					<Card clickable={true} class="w-full h-full">
						<div class="action-contents">
							<i class="material-icons">power_off</i>
						</div>
					</Card>
				</div>
				<div
					transition:blurFly={{
						duration: animationSpeed,
						y: flyYTransform,
						delay: staggerOffset * 4
					}}
					on:mouseenter={() => window.OyasumiIPCOut_Dashboard.showToolTip('Device Control')}
					on:mouseleave={() => window.OyasumiIPCOut_Dashboard.showToolTip(null)}
				>
					<Card clickable={true} class="w-full h-full">
						<div class="action-contents">
							<i class="material-icons">settings_power</i>
						</div>
					</Card>
				</div>
			</div>
			<div
				class="status-bar mt-6"
				transition:blurFly={{
					duration: animationSpeed,
					y: flyYTransform,
					delay: staggerOffset * 5
				}}
			>
				<Card class="w-full h-full">
					<div class="flex flex-row items-center p-3 text-xl font-semibold">
						{#if $vrcLoggedIn}
							<div class="flex-shrink-0 flex flex-row items-center" transition:fade>
								<div
									class="rounded-full w-4 h-4 mr-2 drop-shadow-[0_0_4px_rgba(255,255,255,40%)] transition-all
                    vrc-status-color-{$vrcStatus.replaceAll(' ', '-')}
                  "
								/>
								<span>{$vrcUsername}</span>
							</div>
						{/if}
						<div class="flex-1 flex flex-row items-center justify-end">
							<span>{timeHours}</span><span class="blink">:</span><span>{timeMinutes}</span>
							<i class="material-icons-round ml-2 opacity-60">access_time</i>
						</div>
					</div>
				</Card>
			</div>
			<div class="mt-6">
				<BrightnessSlider />
			</div>
			<div class="mt-6">
				<BrightnessSlider />
			</div>
		</div>
	{/if}
</main>

<style lang="scss">
	main {
		@apply flex flex-col items-center justify-center w-[1024px] h-[1024px] select-none;
		// Background for testing outside of VR
		// background-image: url('https://media.discordapp.net/attachments/982943945711575100/1111662310558269601/VRChat_2023-05-25_20-25-37.516_7680x4320.png?width=1166&height=656');
		// background-size: cover;
		overflow: hidden;
	}
	.dashboard-container {
		@apply flex flex-col w-[500px];
	}
	.logo-container {
		@apply flex flex-col items-center justify-center w-full px-[80px] mb-4;
		img {
			@apply drop-shadow-[0_0_4px_rgba(255,255,255,100%)];
		}
	}
	.action-container {
		@apply grid grid-cols-3 gap-6 w-full auto-rows-fr mt-5;
		&::before {
			content: '';
			width: 0;
			padding-bottom: 100%;
			grid-row: 1 / 1;
			grid-column: 1 / 1;
		}
		.action-large {
			@apply col-span-3 col-start-1 col-end-4 row-start-1 row-end-1 w-full h-full;
		}
		.action-contents {
			@apply flex flex-row items-center justify-center w-full h-full p-6;
			.material-icons {
				@apply text-8xl drop-shadow-[0_0_8px_rgba(255,255,255,40%)] flex-shrink-0;
				line-height: 0;
			}
			.sleep-mode-info {
				@apply flex-1 flex flex-col items-end justify-center pr-2;
				span {
					&:first-child {
						@apply opacity-60 text-2xl;
					}
					&:last-child {
						@apply text-5xl;
					}
				}
			}
		}
	}
	.blink {
		animation: blinker 1s linear infinite;
	}

	@keyframes blinker {
		50% {
			opacity: 0;
		}
	}
</style>
