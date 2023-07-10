import { browser } from "$app/environment";
import ipcService from "$lib/services/ipc.service";
import type { Load } from "@sveltejs/kit";
import { loadTranslations, locale } from "$lib/translations";
import { get } from "svelte/store";

export const trailingSlash = "always";
export const prerender = true;
export const ssr = false;

if (browser) {
}

export const load: Load = async ({ url }) => {
  await ipcService.init();
  const { pathname } = url;
  await loadTranslations(get(ipcService.state).locale ?? 'en', pathname);
  return {};
};
