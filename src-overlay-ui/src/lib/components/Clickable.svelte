<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let tooltip: string = '';
	let _class = '';
	export { _class as class };

	let set = false;

	function onEnter() {
		if (!tooltip) return;
		set = true;
		window.OyasumiIPCOut.showToolTip(tooltip);
	}

	function onLeave() {
		if (!tooltip && !set) return;
		set = false;
		window.OyasumiIPCOut.showToolTip(null);
	}

	function onClick(e: MouseEvent) {
		e.preventDefault();
		dispatch('click');
	}

	const dispatch = createEventDispatcher();
</script>

<div
	class="w-full h-full {_class}"
	on:mouseenter={onEnter}
	on:mouseleave={onLeave}
	on:click={onClick}
>
	<slot />
</div>
