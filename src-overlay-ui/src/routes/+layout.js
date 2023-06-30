import { browser } from '$app/environment';
import ipcService from '$lib/services/ipc.service';

export const trailingSlash = 'always';
export const prerender = true;

if (browser) {
	ipcService.init();
}
