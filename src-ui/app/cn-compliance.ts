import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { LANGUAGES } from './globals';
import translationContributorData from '../../docs/translation_contributors.json';

let applied = false;

export async function initCnCompliance() {
  await applyCnCompliance();
  // The marker file answers on its own, but the Steam China launcher check only answers once
  // Steamworks has finished initializing.
  await listen<boolean>('STEAMWORKS_READY', () => applyCnCompliance());
}

async function applyCnCompliance() {
  if (applied) return;
  if (!(await invoke<boolean>('cn_compliance_mode'))) return;
  applied = true;
  LANGUAGES.filter((language) => language.flag === 'tw').forEach(
    (language) => (language.flag = 'hk')
  );
  const contributors: Array<{ langCode: string; flagCode?: string }> = translationContributorData;
  contributors.forEach((contributor) => {
    if (contributor.flagCode === 'tw') contributor.flagCode = 'hk';
    if (contributor.langCode === 'tw') contributor.langCode = 'hk';
  });
}
