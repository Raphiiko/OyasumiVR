import i18n from "sveltekit-i18n";
import type { Config } from "sveltekit-i18n";

/** @type {import("sveltekit-i18n").Config} */
const config: Config = ({
  fallbackLocale: "en",
  log: {
    level: "error"
  },
  loaders: [
    ...(["en", "cn", "fr", "ja", "ko", "nl", "tw"].map(locale => (
      {
        locale,
        key: "t",
        loader: async () => (
          await import((`../../../src-ui/assets/i18n/${locale}.json`))
        ).default
      }
    )))
  ]
});

export const { t, locale, locales, loading, loadTranslations } = new i18n(config);

