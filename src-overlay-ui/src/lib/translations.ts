import i18n from "sveltekit-i18n";
import type { Config } from "sveltekit-i18n";
import ipc from "$lib/services/ipc.service";

function getTranslationLoader(locale: string): () => Promise<Record<any, any>> {
  if (locale === "DEBUG") {
    return async () => {
      const translations = await ipc.getDebugTranslations();
      return translations ?? (await import(`../../../src-ui/assets/i18n/en.json`));
    };
  } else {
    return async () => (await import(`../../../src-ui/assets/i18n/${locale}.json`)).default;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const config: Config<{ [s: string]: any }> = {
  fallbackLocale: "en",
  cache: 0,
  log: {
    level: "error"
  },
  loaders: [
    ...["en", "cn", "fr", "ja", "ko", "nl", "tw", "es", "id", "DEBUG"].map((locale) => ({
      locale,
      key: "t",
      loader: getTranslationLoader(locale)
    }))
  ]
};

export const { t, locale, loading, translations, locales, addTranslations, loadTranslations } = new i18n(config);

export async function loadDebugTranslations() {
  await loadTranslations("en", "");
  await loadTranslations("DEBUG", "");
}
