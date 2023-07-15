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
  const urlParams = new URLSearchParams(window.location.search);
  const corePort = parseInt(urlParams.get("corePort") ?? "0", 10);
  if (corePort > 0) fontLoader.init(corePort);
  await ipcService.init();
  const { pathname } = url;
  await loadTranslations(get(ipcService.state).locale ?? "en", pathname);
  return {};
};
