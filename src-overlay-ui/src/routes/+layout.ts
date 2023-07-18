import { browser } from "$app/environment";
import ipcService from "$lib/services/ipc.service";
import type { Load } from "@sveltejs/kit";
import { loadTranslations } from "$lib/translations";
import { get } from "svelte/store";
import { fontLoader } from "src-shared-ts/src/font-loader";

export const trailingSlash = "always";
export const prerender = true;
export const ssr = false;

if (browser) {
}

export const load: Load = async ({ url }) => {
  // Obtain query params
  const urlParams = new URLSearchParams(window.location.search);
  const corePort = parseInt(urlParams.get("corePort") ?? "5177", 10);
  // If the core port was provided, initialize the font loader
  if (corePort > 0 && corePort < 65536) fontLoader.init(corePort);
  // Initialize IPC
  await ipcService.init();
  // Load translations
  const { pathname } = url;
  await loadTranslations(get(ipcService.state).locale ?? "en", pathname);

  return {};
};
