import ipcService from '$lib/services/ipc.service';
import type { Load } from '@sveltejs/kit';
import { loadTranslations } from '$lib/translations';
import { get } from 'svelte/store';
import { fontLoader } from 'src-shared-ts/src/font-loader';

export const trailingSlash = 'always';
export const prerender = true;
export const ssr = false;

export const load: Load = async ({ url }) => {
	// Obtain query params
	const urlParams = new URLSearchParams(window.location.search);
	const corePort = parseInt(urlParams.get('corePort') ?? '5177', 10);
	// If the core port was provided, initialize the font loader
	if (corePort > 0 && corePort < 65536) fontLoader.init(corePort);
	// Load fonts from Google if running outside of the overlay (development mode)
	if (!window.CefSharp) loadDevFonts();
	// Initialize IPC
	await ipcService.init();
	// Load translations
	const { pathname } = url;
	await loadTranslations(get(ipcService.state).locale ?? 'en', pathname);

	return {};
};

function loadDevFonts() {
	const link = document.createElement('link');
	link.href =
		'https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap';
	link.rel = 'stylesheet';
	document.head.appendChild(link);
}
