<script lang="ts">
  import Overview from "./Overview.svelte";
  import AutomationConfig from "./AutomationConfig.svelte";
  import { onMount } from "svelte";
  import Dialog from "$lib/components/Dialog.svelte";
  import { blur, scale } from "svelte/transition";
  import ipc from "$lib/services/ipc.service";
  import { t } from "$lib/translations";
  import DeviceControl from "./DeviceControl.svelte";

  let { state } = ipc;

	// IPC & Readiness
	let ready: boolean = !window.CefSharp;
	window.OyasumiIPCIn.hideDashboard = async () => ((ready = false), void 1);
	window.OyasumiIPCIn.showDashboard = async () => ((ready = true), void 0);
	onMount(() => window.OyasumiIPCOut.onUiReady());

	// Dashboard mode
	type DashboardMode = 'OVERVIEW' | 'AUTOMATIONS' | 'DEVICE_CONTROL';
	let mode: DashboardMode = 'OVERVIEW';

	// Utilities
	function navigate(e: CustomEvent<{ mode: DashboardMode }>) {
		mode = e.detail.mode;
	}

	async function closeDashboard() {
		await window.OyasumiIPCOut_Dashboard.close();
	}

	// Shutdown Sequence
	let shutdownSequenceDialog = {
		shown: false,
		startDisabled: false,
		canStart: false,
		timeout: null as NodeJS.Timeout | null,
		inProgress: false
	};

	$: shutdownSequenceDialog.inProgress = $state.automations?.shutdownAutomations?.running ?? false;
	$: shutdownSequenceDialog.canStart = $state.automations?.shutdownAutomations?.canStart ?? false;

	function openShutdownSequence() {
		shutdownSequenceDialog.shown = true;
		shutdownSequenceDialog.startDisabled = true;
		if (shutdownSequenceDialog.timeout) clearTimeout(shutdownSequenceDialog.timeout);
		shutdownSequenceDialog.timeout = setTimeout(() => {
			shutdownSequenceDialog.startDisabled = false;
			shutdownSequenceDialog.timeout = null;
		}, 2000);
	}

	function closeShutdownSequence() {
		if (shutdownSequenceDialog.timeout) clearTimeout(shutdownSequenceDialog.timeout);
		shutdownSequenceDialog.shown = false;
		shutdownSequenceDialog.inProgress = false;
	}

	function startShutdownSequence() {
		shutdownSequenceDialog.inProgress = true;
		shutdownSequenceDialog.shown = false;
		ipc.startShutdownSequence();
		closeShutdownSequence();
	}
</script>

<main class:non-overlay={!window.CefSharp}>
	{#if ready}
		{#if mode === 'OVERVIEW'}
			<div
				class="stack-frame transition duration-700"
				class:blur-sm={shutdownSequenceDialog.shown || shutdownSequenceDialog.inProgress}
				class:opacity-80={shutdownSequenceDialog.shown || shutdownSequenceDialog.inProgress}
			>
				<Overview
					on:nav={navigate}
					on:openShutdownSequence={openShutdownSequence}
					on:closeDashboard={closeDashboard}
					shutdownSequenceDisabled={!shutdownSequenceDialog.canStart}
				/>
			</div>
		{:else if mode === 'AUTOMATIONS'}
			<div class="stack-frame">
				<AutomationConfig on:nav={navigate} />
			</div>
		{:else if mode === 'DEVICE_CONTROL'}
			<div class="stack-frame">
				<DeviceControl on:nav={navigate} on:closeDashboard={closeDashboard} />
			</div>
		{/if}
		{#if shutdownSequenceDialog.shown}
			<div class="stack-frame" transition:blur>
				<div transition:scale>
					<Dialog
						title="t.overlay.dashboard.shutdownSequence.dialog.title"
						message="t.overlay.dashboard.shutdownSequence.dialog.message"
						confirmText="t.overlay.dashboard.shutdownSequence.dialog.start"
						confirmColor="red"
						confirmDisabled={shutdownSequenceDialog.startDisabled ||
							shutdownSequenceDialog.inProgress ||
							!shutdownSequenceDialog.canStart}
						on:cancel={() => closeShutdownSequence()}
						on:confirm={() => startShutdownSequence()}
					/>
				</div>
			</div>
		{/if}
		{#if shutdownSequenceDialog.inProgress}
			<div class="stack-frame" transition:blur>
				<div class="w-[600px] h-[500px] bg-black blur-3xl opacity-80 rounded-full" />
			</div>
			<div class="stack-frame" transition:blur>
				<div class="flex flex-col items-center justify-center">
					<span class="text-4xl text-white glow-100"
						>{$t('t.shutdown-automations.overlay.title')}</span
					>
					<div class="mt-[110px] glow-100">
						<div class="large-spinner scale-[3]" />
					</div>
				</div>
			</div>
		{/if}
	{/if}
</main>

<style lang="scss">
	main {
		@apply w-[1024px] h-[1024px] select-none relative;
		background-size: cover;
		overflow: hidden;

		&.non-overlay {
			// Background for testing outside of VR
			background-image: url('https://media.discordapp.net/attachments/576683979298570246/1127657024654671932/VRChat_2023-06-12_20-46-39.988_4320x7680.png?width=1440&height=810');
		}
	}

	.stack-frame {
		@apply absolute top-0 left-0 w-full h-full flex flex-col items-center justify-center;
	}
</style>
