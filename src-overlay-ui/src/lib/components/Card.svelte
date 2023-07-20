<script lang="ts">
	let _class = '';
	export { _class as class };
	export let clickable = false;
	export let small = false;
	export let active = false;
	export let activeColor: 'blue' | 'red' = 'blue';
	export let disabled = false;
</script>

<div class="wrapper {_class}" class:disabled>
	<div
		class="card active-color-{activeColor}"
		class:clickable
		class:active
		class:small
		class:disabled
	>
		<div class="card-slot">
			<slot />
		</div>
	</div>
</div>

<style lang="scss">
	.wrapper {
		@apply transition-all duration-500;
		&.disabled {
			@apply opacity-60;
		}
	}
	.card {
		@apply grid w-full h-full items-start relative rounded-[8px] bg-gray-800 bg-opacity-80 drop-shadow-[0_0_24px_rgba(0,0,0,1)] border border-gray-700 text-white transition-all duration-200;
		&::before {
			content: '';
			@apply col-span-full row-span-full w-full h-full transition-all duration-200;
			background: radial-gradient(
				250px at 70% top,
				theme('colors.gray.600' / 80%) 0%,
				rgba(white, 0%) 100%
			);
		}

		&.disabled {
			@apply opacity-60;
		}

		&.small::before {
			background: radial-gradient(
				70px at 70% top,
				theme('colors.gray.600' / 80%) 0%,
				rgba(white, 0%) 100%
			);
		}

		&-slot {
			@apply col-span-full row-span-full w-full h-full;
		}

		&.clickable:not(.disabled) {
			&:hover {
				@apply cursor-pointer border-gray-500 shadow-[inset_0_0_32px_rgba(255,255,255,20%)] drop-shadow-[0_0_24px_rgba(200,200,255,30%)];
			}

			&:active {
				@apply opacity-70 scale-95;
			}
		}

		&.active {
			&.active-color-blue {
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

			&.active-color-red {
				@apply bg-red-700 border-red-600;
				&:not(.disabled):hover {
					@apply border-red-400 drop-shadow-[0_0_24px_rgba(255,0,0,80%)];
				}

				&::before {
					background: radial-gradient(
						250px at 70% top,
						theme('colors.red.500' / 80%) 0%,
						rgba(white, 0%) 100%
					);
				}
			}
		}
	}
</style>
