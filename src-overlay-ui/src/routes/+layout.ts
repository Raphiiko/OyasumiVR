import { browser } from "$app/environment";
import ipcService from "$lib/services/ipc.service";
import type { Load } from "@sveltejs/kit";
import { loadTranslations } from "$lib/translations";
import { get } from "svelte/store";
import _ from "lodash";

const { flattenDeep } = _;

export const trailingSlash = "always";
export const prerender = true;
export const ssr = false;

if (browser) {
}

export const load: Load = async ({ url }) => {
  const urlParams = new URLSearchParams(window.location.search);
  const corePort = parseInt(urlParams.get("corePort") ?? "0", 10);
  if (corePort > 0) await loadFonts(corePort);
  await ipcService.init();
  const { pathname } = url;
  await loadTranslations(get(ipcService.state).locale ?? "en", pathname);
  return {};
};

async function loadFonts(coreHttpPort: number) {
  const fontDefs: Array<{
    family: string;
    sets: string[];
    weights: number[];
    variants: string[];
  }> = [
    {
      family: "Poppins",
      sets: ["latin", "latin-ext"],
      weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
      variants: ["normal", "italic"]
    },
    {
      family: "Noto Sans JP",
      sets: ["japanese"],
      weights: [100, 300, 400, 500, 700, 900],
      variants: ["normal"]
    },
    {
      family: "Noto Sans KR",
      sets: ["korean"],
      weights: [100, 300, 400, 500, 700, 900],
      variants: ["normal"]
    },
    {
      family: "Noto Sans TC",
      sets: ["chinese-traditional"],
      weights: [100, 300, 400, 500, 700, 900],
      variants: ["normal"]
    },
    {
      family: "Noto Sans SC",
      sets: ["chinese-simplified"],
      weights: [100, 300, 400, 500, 700, 900],
      variants: ["normal"]
    }
  ];
  const loads = flattenDeep<Promise<FontFace>>(fontDefs.map((fontDef) => {
    return fontDef.sets.map((set) => {
      return fontDef.weights.map((weight) => {
        return fontDef.variants.map((variant) => {
          const fileName = `${fontDef.family
            .toLowerCase()
            .replace(/\s+/g, "-")}-${set}-${weight}-${variant}.woff2`;
          const fontUrl = `http://localhost:${coreHttpPort}/font/${fileName}`;
          const font = new FontFace(
            fontDef.family,
            `url(${fontUrl})`,
            {
              style: variant === "italic" ? "italic" : "normal",
              weight: weight.toString()
            }
          );
          (document.fonts as any).add(font);
          return font.load();
        });
      });
    });
  }));
  await Promise.all(loads);
  console.log("All fonts loaded!");
}
