<script lang="ts">
	import type { NotificationParams } from '$lib/models/notification-params';
	import { fly } from 'svelte/transition';
	import Notification from '../lib/components/Notification.svelte';

	let notifications: NotificationParams[] = [];
	let activeNotification: NotificationParams | null = null;
	$: shownNotifications = notifications.slice(0, 3).reverse();

	function getNotificationClasses(index: number) {
		let blur = ['blur-none', 'blur-sm', 'blur-lg', 'blur-xl'][index] ?? '';
		let translate = ['translate-y-0', 'translate-y-[30px]', 'translate-y-[60px]'][index] ?? '';
		let scale = ['scale-[1]', 'scale-[0.9]', 'scale-[0.8]'][index] ?? '';
		let opacity = ['opacity-100', 'opacity-80', 'opacity-60', 'opacity-0'][index] ?? '';
		return [blur, opacity, translate, scale].join(' ').trim();
	}

	export function addNotification(params: NotificationParams): string {
		if (!params.id) params.id = Math.random().toString(36);
		notifications = [...notifications, params];
		updateActiveNotification();
		return params.id;
	}

	export function dismissNotification(id: string) {
		notifications = notifications.filter((n) => n.id !== id);
		updateActiveNotification();
	}

	function updateActiveNotification() {
		if (!notifications.length) {
			activeNotification = null;
			return;
		}
		if (notifications[0] === activeNotification) return;
		activeNotification = notifications[0];
		setTimeout(() => dismissNotification(activeNotification!.id!), activeNotification.duration);
	}

	window.Oyasumi = Object.assign(window.Oyasumi || {}, {
		addNotification,
		dismissNotification
	});
</script>

<main>
	<div
		class="notification-container relative flex justify-center items-center w-[1024px] h-[1024px]"
	>
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
	.notification-container {
		// Background for testing outside of VR
		// background-image: url('https://media.discordapp.net/attachments/982943945711575100/1111662310558269601/VRChat_2023-05-25_20-25-37.516_7680x4320.png?width=1166&height=656');
		// background-size: cover;
		overflow: hidden;
	}
</style>
