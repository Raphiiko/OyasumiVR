export const SETTINGS_FILE = 'settings.dat';
export const CACHE_FILE = 'cache.dat';
export const EVENT_LOG_FILE = 'event_log.dat';
export const NG_LOCALE_MAP: { [s: string]: string } = {
  en: 'en',
  nl: 'nl',
  ja: 'ja',
  fr: 'fr',
  ko: 'ko',
  cn: 'zh',
  tw: 'zh',
};
export const LANGUAGES: Array<{ code: string; label: string; flag?: string }> = [
  {
    code: 'en',
    label: 'English',
    flag: 'gb',
  },
  {
    code: 'nl',
    label: 'Nederlands',
  },
  {
    code: 'ja',
    label: '日本語',
    flag: 'jp',
  },
  {
    code: 'ko',
    label: '한국어',
    flag: 'kr',
  },
  {
    code: 'tw',
    label: '繁體中文',
  },
  {
    code: 'cn',
    label: '简体中文',
  },
  {
    code: 'fr',
    label: 'Français',
  },
];
