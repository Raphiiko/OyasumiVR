// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface Platform {}
	}
	declare interface Window {
		Oyasumi: OyasumiOverlayWebAPI;
	}
}

interface OyasumiOverlayWebAPI {
	addNotification(params: NotificationParams): string;
	dismissNotification(id: string): void;
}

export {};
