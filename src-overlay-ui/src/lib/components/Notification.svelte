<script lang="ts">
  import { blur, fade, slide } from "svelte/transition";
  import logo from "$lib/images/logo.png";
  import { delay, of, startWith } from "rxjs";

  export let message = '';
	export let duration = 3000;
	export let active = false;

	$: _active = of(active).pipe(delay(800), startWith(false));
</script>

<main>
	<div
		class="notification relative w-[400px] grid items-start bg-gray-800 bg-opacity-80 drop-shadow-[0_0_24px_rgba(0,0,0,1)]"
		in:fade={{ duration: 800 }}
		out:blur={{ duration: 1000 }}
	>
		<!-- Gradient BG overlay -->
		<div class="notification-bg col-span-full row-span-full h-full w-full" />
		<!-- Bottom "Handle" + Glow -->
		<div
			class="absolute -bottom-1.5 left-[50%] -translate-x-1/2 w-16 h-2 bg-white rounded-lg drop-shadow-xl"
		/>
		<div class="col-span-full row-span-full h-full w-full overflow-hidden relative">
			<div
				class="absolute bottom-0 left-[50%] -translate-x-1/2 translate-y-1 w-16 h-1 shadow-[0_0_60px_30px_#fff5]"
			/>
		</div>
		<!-- Content -->
		<div
			class="notification-content col-span-full row-span-full flex flex-col justify-start items-center text-white"
			in:slide={{ duration: 800 }}
		>
			<img
				src={logo}
				alt="Oyasumi Logo"
				class="w-[150px] h-[24px] drop-shadow-[0_0_4px_rgba(255,255,255,100%)] m-4"
			/>
			<div
				class="h-[1px] w-[300px] relative bg-white bg-opacity-20 drop-shadow-[0_0_4px_rgba(255,255,255,100%)] rounded-xl overflow-hidden"
				in:blur={{ duration: 200, delay: 400 }}
				out:blur={{ duration: 400, delay: 200 }}
			>
				<div
					class="h-[1px] w-0 bg-white left-0 top-0 absolute"
					style="
					transition: all {duration - 800}ms linear;
					width: {$_active ? '100%' : '0%'};
				"
				/>
			</div>
			<span
				class="text-sm text-center m-4 whitespace-pre-line"
				in:blur={{ duration: 400, delay: 600 }}
				out:blur={{ duration: 400 }}>{message}</span
			>
		</div>
	</div>
</main>

<style lang="scss">
	.notification {
		border: 1px solid theme('colors.gray.700');
		border-radius: 8px;
		&-bg {
			border-radius: 8px;
			background: radial-gradient(
				250px at 70% top,
				theme('colors.gray.600' / 80%) 0%,
				rgba(white, 0%) 100%
			);
		}
	}
</style>
