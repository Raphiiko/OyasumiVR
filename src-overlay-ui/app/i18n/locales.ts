import { Translation } from '@jsverse/transloco';

export const LOCALE_LOADERS: Record<string, () => Promise<{ default: Translation }>> = {
  en: () => import('../../../src-ui/assets/i18n/en.json'),
  cn: () => import('../../../src-ui/assets/i18n/cn.json'),
  de: () => import('../../../src-ui/assets/i18n/de.json'),
  es: () => import('../../../src-ui/assets/i18n/es.json'),
  fr: () => import('../../../src-ui/assets/i18n/fr.json'),
  id: () => import('../../../src-ui/assets/i18n/id.json'),
  ja: () => import('../../../src-ui/assets/i18n/ja.json'),
  ko: () => import('../../../src-ui/assets/i18n/ko.json'),
  nl: () => import('../../../src-ui/assets/i18n/nl.json'),
  ru: () => import('../../../src-ui/assets/i18n/ru.json'),
  tw: () => import('../../../src-ui/assets/i18n/tw.json'),
  uk: () => import('../../../src-ui/assets/i18n/uk.json'),
};

export const DEBUG_LOCALE = 'DEBUG';
export const FALLBACK_LOCALE = 'en';

export const AVAILABLE_LOCALES = [...Object.keys(LOCALE_LOADERS), DEBUG_LOCALE];
