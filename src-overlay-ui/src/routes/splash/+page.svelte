<script lang="ts">
  import { t } from "$lib/translations";
  import { onMount } from "svelte";
  import logoIcon from "$lib/images/logo_icon.png";
  import { blur, fade, fly } from "svelte/transition";

  let ready = false;
	onMount(() => {
		ready = true;
		window.OyasumiIPCOut.onUiReady();
	});

	let showIcon = false;
	let showLogoText = false;
	let showTagLine = false;

	// setTimeout(() => {}, 100);
	setTimeout(() => {
		showIcon = true;
		setTimeout(() => {
			showLogoText = true;
			setTimeout(() => {
				showTagLine = true;
				setTimeout(() => {
					showIcon = false;
					showLogoText = false;
					showTagLine = false;
					setTimeout(() => {
            window.OyasumiIPCOut.dispose();
          }, 2000);
				}, 5000);
			}, 200);
		}, 200);
	}, 200);
</script>

{#if ready}
	<main
		class="w-[1024px] h-[1024px] overflow-hidden flex flex-col items-center justify-center relative select-none"
		class:non-overlay={!window.CefSharp}
	>
		{#if showIcon}
			<div class="stack-frame" transition:fade={{ duration: 800 }}>
				<div class="w-1/2 h-1/2 bg-black blur-[75px] rounded-full opacity-20 translate-y-[-20px]" />
			</div>
		{/if}
		{#if showLogoText}
			<div class="stack-frame" transition:fade={{ duration: 800 }}>
				>
				<div
					class="w-1/2 h-1/2 bg-black blur-[130px] rounded-full opacity-20 translate-y-[150px] scale-y-[0.3]"
				/>
			</div>
		{/if}
		{#if showIcon}
			<div class="stack-frame" in:blur={{ duration: 800 }} out:blur={{ duration: 1500 }}>
				<div
					class="w-[250px] h-[250px] overflow-hidden rounded-[50px] drop-shadow-[0_0_16px_rgba(255,255,255,100%)] translate-y-[-100px]"
				>
					<img src={logoIcon} class="w-full h-full" />
				</div>
			</div>
		{/if}
		<!-- LOGO TEXT -->
		{#if showLogoText}
			<div class="stack-frame" transition:blur={{ duration: 1500 }}>
				<div
					class="logo-text glow-100 translate-y-[120px]"
					in:fly={{ duration: 800, delay: 200, y: 100 }}
					out:blur={{ duration: 1500 }}
				>
					<span class="text-[80px] text-white font-extralight">Oyasumi</span>
					<span class="text-[80px] text-white font-medium">VR</span>
				</div>
			</div>
		{/if}
		<!-- TAGLINE -->
		{#if showTagLine}
			<div class="stack-frame" transition:blur={{ duration: 1500 }}>
				<div
					class="text-[28px] text-white opacity-80 glow-100 translate-x-[70px] translate-y-[170px]"
					in:fly={{ duration: 800, delay: 200, y: 100 }}
					out:blur={{ duration: 1500 }}
				>
					{$t('t.shared.logo.tagline')}
				</div>
			</div>
		{/if}
	</main>
{/if}

<style lang="scss">
	main {
		&.non-overlay {
			// Background for testing outside of VR
			background-image: url('https://media.discordapp.net/attachments/576683979298570246/1127657024654671932/VRChat_2023-06-12_20-46-39.988_4320x7680.png?width=1440&height=810');
			background-size: cover;
		}
	}

	.stack-frame {
		@apply absolute top-0 left-0 w-full h-full flex flex-col items-center justify-center;
	}

	.logo-text {
		* {
			letter-spacing: 0.025em;
		}
	}
</style>
