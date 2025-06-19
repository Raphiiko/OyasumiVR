<script lang="ts">
	import Notification from '$lib/components/Notification.svelte';
	import type { AddNotificationParams } from '$lib/models/AddNotificationParams';
	import ipcService from '$lib/services/ipc.service';

	let { addNotification, clearNotification } = ipcService.events;

	let notifications: AddNotificationParams[] = [];
	let activeNotification: AddNotificationParams | null = null;
	$: shownNotifications = notifications.slice(0, 3).reverse();

	$: if ($addNotification) {
		notifications = [...notifications, $addNotification];
		updateActiveNotification();
	}

	$: if ($clearNotification) {
		notifications = notifications.filter((n) => n.id !== $clearNotification);
		updateActiveNotification();
	}

	function updateActiveNotification() {
		if (!notifications.length) {
			activeNotification = null;
			return;
		}
		if (notifications[0] === activeNotification) return;
		activeNotification = notifications[0];
		let idToDismiss = activeNotification.id!;
		setTimeout(() => clearNotification.set(idToDismiss), activeNotification.duration);
	}

	function getNotificationClasses(index: number) {
		let blur = ['blur-none', 'blur-sm', 'blur-lg', 'blur-xl'][index] ?? '';
		let translate = ['translate-y-0', 'translate-y-[30px]', 'translate-y-[60px]'][index] ?? '';
		let scale = ['scale-[1]', 'scale-[0.9]', 'scale-[0.8]'][index] ?? '';
		let opacity = ['opacity-100', 'opacity-80', 'opacity-60', 'opacity-0'][index] ?? '';
		return [blur, opacity, translate, scale].join(' ').trim();
	}
</script>

<main>
	<div class="overflow-hidden relative flex justify-center items-center w-[1024px] h-[1024px]">
		{#each shownNotifications as notification, i (notification.id)}
			<div class="scale-[2]">
				<div
					class={'absolute top-0 left-0 w-full h-full flex justify-center items-center transition-all duration-[800ms] delay-[300ms] ' +
						getNotificationClasses(shownNotifications.length - i - 1)}
				>
					<Notification
						message={notification.message}
						duration={notification.duration}
						active={notification === activeNotification}
					/>
				</div>
			</div>
		{/each}
	</div>
</main>

<style lang="scss">
</style>
