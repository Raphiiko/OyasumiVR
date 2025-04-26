<script lang="ts">
	import { onMount } from 'svelte';
	import { clamp } from 'lodash';
	import { getCSSColorForCCT } from 'src-shared-ts/src/cct-utils';
	import { fade } from 'svelte/transition';

	export let label = '';
	export let min = 1000;
	export let max = 10000;
	export let step = 50;
	export let snapValues = [6600];
	export let snapDistance = 400;
	export let value = 6600;
	export let disabled = false;
	export let isTransitioning = false;
	export let transitionTarget = 0.0;
	export let onValueChange: (value: number) => void = () => {};

	let dragging = false;

	let dragProgression = 0.65;

	$: renderProgression = dragging ? dragProgression : (value - min) / (max - min);
	$: renderValue = Math.round(renderProgression * (max - min) + min) + 'K';
	$: cssColorForCCT = getCSSColorForCCT(renderProgression * (max - min) + min);

	function startDragging(event: MouseEvent) {
		if (dragging) return;
		dragging = true;
		handleMouseMove(event);
	}

	function handleMouseMove(event: MouseEvent) {
		if (!dragging) return;
    // Determine the progress
		const rangeGuide = document.querySelector('.brightness-slider-bar-range-guide') as HTMLElement;
		const barBounds = rangeGuide.getBoundingClientRect();
		let progress = clamp((event.pageX - barBounds.left) / barBounds.width, 0.0, 1.0);
    // Convert the progress to the value
		let value = Math.round(progress * (max - min) + min);
		// Snap to the nearest snap value if it's within the snap distance
		if (snapValues.length > 0) {
			const snapValue = snapValues.find((v) => Math.abs(v - value) <= snapDistance);
			if (snapValue) value = snapValue;
		}
		// Snap to the nearest step
		if (step) value = Math.round(value / step) * step;
		// Convert value back to progress
    progress = (value - min) / (max - min);
		dragProgression = progress;
		onValueChange(value);
	}

	function handleMouseUp() {
		dragging = false;
	}

	onMount(() => {
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
		return () => {
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	});
</script>

<div
	class="brightness-slider-container relative"
	class:disabled
	class:transitioning={isTransitioning}
>
	<div class="w-full h-full absolute top-0 left-0 bg-black blur-3xl opacity-r50 rounded-full z-0" />
	<div class="brightness-slider-title-row z-10">
		{#if !dragging}
			<span class="glow-80" transition:fade|global={{ duration: 100 }}>{label}</span>
		{:else}
			<span class="glow-80" transition:fade|global={{ duration: 100 }}>{renderValue}</span>
		{/if}
	</div>
	<div class="brightness-slider-bar-area z-10" on:mousedown={startDragging} class:dragging>
		<div class="brightness-slider-bar-pre glow-80" style="flex: {renderProgression * 100}" />
		<div class="brightness-slider-thumb glow-80" style:background-color={cssColorForCCT} />
		<div class="brightness-slider-bar-post glow-80" style="flex: {(1 - renderProgression) * 100}" />
		<div class="brightness-slider-bar-range-guide" />
	</div>
</div>

<style lang="scss">
	.brightness-slider {
		&-container {
			@apply flex flex-col items-stretch pb-4 pt-2 transition-all;
			&.disabled {
				opacity: 0.5;
				pointer-events: none;
			}

			&.transitioning {
				@keyframes thumb-glow {
					0% {
						filter: drop-shadow(0 0 6px rgba(white, 0.5));
						opacity: 0.25;
						transform: scale(0.9);
					}

					40% {
						filter: drop-shadow(0 0 6px rgba(white, 1));
						opacity: 1;
						transform: scale(1);
					}

					80% {
						filter: drop-shadow(0 0 6px rgba(white, 0.5));
						opacity: 0.25;
						transform: scale(0.9);
					}

					100% {
						filter: drop-shadow(0 0 6px rgba(white, 0.5));
						opacity: 0.25;
						transform: scale(0.9);
					}
				}

				@keyframes track-glow {
					0% {
						filter: drop-shadow(0 0 6px rgba(white, 0.5));
						opacity: 0.25;
					}

					40% {
						filter: drop-shadow(0 0 6px rgba(white, 1));
						opacity: 1;
					}

					80% {
						filter: drop-shadow(0 0 6px rgba(white, 0.5));
						opacity: 0.25;
					}

					100% {
						filter: drop-shadow(0 0 6px rgba(white, 0.5));
						opacity: 0.25;
					}
				}

				.brightness-slider-bar-area {
					.brightness-slider-bar-pre,
					.brightness-slider-bar-post {
						animation: track-glow 2s ease-out infinite normal;
					}

					.brightness-slider-thumb {
						@apply w-14 h-14 border-4;
						animation: thumb-glow 2s ease-out infinite normal;

						span {
							opacity: 1;
						}

						&:hover {
							@apply w-16 h-16 border-8;
						}
					}
				}
			}
		}

		&-title-row {
			@apply mb-4 relative h-8 w-full;

			span {
				@apply text-2xl text-white text-center inline-block absolute top-0 left-auto right-auto w-full;
			}
		}

		&-bar-area {
			@apply relative flex flex-row items-center h-10;
			&:hover,
			&.dragging {
				@apply cursor-pointer;
				.brightness-slider-thumb {
					@apply w-16 h-16 border-4;
				}
			}

			&:not(.dragging) {
				.brightness-slider-bar-pre,
				.brightness-slider-bar-post {
					transition: all 0.15s ease;
				}
			}
		}

		&-bar-range-guide {
			@apply absolute top-0 left-0 w-full h-full pointer-events-none;
		}

		&-bar-pre,
		&-bar-post {
			@apply h-0.5;
			&:after {
				@apply absolute top-0 h-full bg-white rounded-full;
				content: '';
			}
		}

		&-bar-pre {
			flex: 50;

			&:after {
				width: calc(100% - 1em);
				left: 0;
			}
		}

		&-bar-post {
			@apply opacity-50;
			flex: 50;

			&:after {
				width: calc(100% - 1em);
				right: 0;
			}
		}

		&-thumb {
			@apply w-8 h-8 border-2 border-white rounded-full transition-all bg-blue-300;
			flex-shrink: 0;
		}
	}
</style>
