<script lang="ts">
	let _class = '';
	export { _class as class };
	export let clickable = false;
	export let active = false;
</script>

<div class="card {_class}" class:clickable class:active>
	<div class="card-slot">
		<slot />
	</div>
</div>

<style lang="scss">
	.card {
		@apply grid items-start relative rounded-[8px] bg-white bg-gray-800 bg-opacity-80 drop-shadow-[0_0_24px_rgba(0,0,0,1)] border border-gray-700 text-white overflow-hidden transition-all duration-200;
		&::before {
			content: '';
			@apply col-span-full row-span-full w-full h-full transition-all duration-200;
			background: radial-gradient(
				250px at 70% top,
				theme('colors.gray.600' / 80%) 0%,
				rgba(white, 0%) 100%
			);
		}
		&-slot {
			@apply col-span-full row-span-full w-full h-full;
		}

		&.clickable {
			&:hover {
				@apply cursor-pointer border-gray-500 shadow-[inset_0_0_32px_rgba(255,255,255,20%)] drop-shadow-[0_0_24px_rgba(200,200,255,30%)];
				// @apply drop-shadow-[0_0_4px_rgba(255,255,255,100%)];
			}
			&:active {
				@apply opacity-70 scale-95;
			}
		}

		&.active {
			@apply bg-cyan-700 border-cyan-600;
			&:hover {
				@apply border-cyan-400;
			}
			&::before {
				background: radial-gradient(
					250px at 70% top,
					theme('colors.cyan.500' / 80%) 0%,
					rgba(white, 0%) 100%
				);
			}
		}
	}
</style>
