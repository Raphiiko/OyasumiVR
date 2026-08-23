import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { getVersion } from '../../../../utils/app-utils';
import { BackgroundService } from '../../../../services/background.service';
import { BUILD_ID, FLAVOUR } from '../../../../../build';
import { CachedValue } from '../../../../utils/cached-value';
import { vshrink } from '../../../../utils/animations';
import { shuffle } from 'lodash';
import { warn } from '@tauri-apps/plugin-log';
import translationContributorData from '../../../../../../docs/translation_contributors.json';
import { fetch } from '@tauri-apps/plugin-http';

interface SupporterTier {
  name: string;
  supporters: string[];
}

interface Contributor {
  name: string;
  url?: string;
  type: 'programming' | 'soundFx';
}

interface TranslationContributor {
  name: string;
  url?: string;
  langCode: string;
  flagCode?: string;
  langNameNative: string;
  langNameEnglish: string;
}

interface ContributionGroup {
  type: Contributor['type'];
  contributors: Contributor[];
}

interface TranslationLanguage {
  langCode: string;
  flagCode?: string;
  langNameNative: string;
  contributors: TranslationContributor[];
}

@Component({
  selector: 'app-about-view',
  templateUrl: './about-view.component.html',
  styleUrls: ['./about-view.component.scss'],
  animations: [vshrink()],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class AboutViewComponent implements OnInit, AfterViewInit, OnDestroy {
  protected readonly FLAVOUR = FLAVOUR;
  protected readonly BUILD_ID = BUILD_ID;

  protected readonly contributors: Contributor[] = [
    { name: 'neuroblack', url: 'https://github.com/neuroblack', type: 'programming' },
    { name: 'góngo', url: 'https://github.com/TheMrGong', type: 'programming' },
    { name: 'Fanyatsu', url: 'https://fanyat.su', type: 'programming' },
    { name: 'BenjaminZehowlt', url: 'https://github.com/BenjaminZehowlt', type: 'programming' },
    { name: 'sofoxe1', url: 'https://github.com/sofoxe1', type: 'programming' },
    { name: 'coolGi', url: 'https://github.com/coolGi69', type: 'programming' },
    { name: 'spaecd', type: 'soundFx' },
  ];

  protected readonly contributionGroups: ContributionGroup[] = groupByType(this.contributors);

  protected readonly translationLanguages: TranslationLanguage[] = groupByLanguage(
    translationContributorData
  );

  version?: string;

  @ViewChild('rail') private rail?: ElementRef<HTMLElement>;
  @ViewChild('railContent') private railContent?: ElementRef<HTMLElement>;
  private railObserver?: ResizeObserver;

  protected supporterCache: CachedValue<SupporterTier[]> = new CachedValue<SupporterTier[]>(
    undefined,
    60 * 60 * 1000, // Cache for 1 hour
    'OYASUMIVR_SUPPORTERS'
  );

  constructor(private background: BackgroundService) {}

  async ngOnInit() {
    this.version = await getVersion();
    this.background.setBackground('/assets/img/about_bg.jpg');
    await this.supporterCache.waitForInitialisation();
    // Fetch supporters list if we don't have it yet (or if the cache expired)
    let supporters = this.supporterCache.get();
    if (supporters === undefined) {
      try {
        const response = await fetch('https://getsupporters-fgf7bxmuba-ew.a.run.app');
        if (response.ok) {
          const data: { [tier: string]: string[] } = await response.json();
          await this.supporterCache.set(
            Object.entries(data).map((entry) => ({
              name: entry[0],
              supporters: shuffle(entry[1]),
            }))
          );
        } else {
          warn('Could not fetch supporters list: ' + JSON.stringify(response));
        }
      } catch {
        // Ignore failure, we'll just not show the list.
      }
    } else {
      supporters = structuredClone(supporters);
      supporters.forEach((tier) => (tier.supporters = shuffle(tier.supporters)));
      await this.supporterCache.set(supporters);
    }
  }

  ngAfterViewInit() {
    const el = this.rail?.nativeElement;
    if (!el) return;
    // the rail's own box never changes when its content grows, so observe both
    this.railObserver = new ResizeObserver(() => this.updateRailFade());
    this.railObserver.observe(el);
    if (this.railContent) this.railObserver.observe(this.railContent.nativeElement);
    this.updateRailFade();
  }

  // a class binding here would re-enter change detection, so toggle on the element
  protected updateRailFade() {
    const el = this.rail?.nativeElement;
    if (!el) return;
    const scrollable = el.scrollHeight - el.clientHeight;
    el.classList.toggle('at-start', el.scrollTop <= 1);
    el.classList.toggle('at-end', scrollable - el.scrollTop <= 1);
  }

  async ngOnDestroy() {
    this.railObserver?.disconnect();
    this.background.setBackground(null);
  }
}

function groupByType(contributors: Contributor[]): ContributionGroup[] {
  const groups: ContributionGroup[] = [];
  for (const contributor of contributors) {
    let group = groups.find((g) => g.type === contributor.type);
    if (!group) groups.push((group = { type: contributor.type, contributors: [] }));
    group.contributors.push(contributor);
  }
  return groups;
}

function groupByLanguage(contributors: TranslationContributor[]): TranslationLanguage[] {
  const languages: TranslationLanguage[] = [];
  for (const contributor of contributors) {
    let language = languages.find(
      (l) => l.langCode === contributor.langCode && l.flagCode === contributor.flagCode
    );
    if (!language) {
      languages.push(
        (language = {
          langCode: contributor.langCode,
          flagCode: contributor.flagCode,
          langNameNative: contributor.langNameNative,
          contributors: [],
        })
      );
    }
    language.contributors.push(contributor);
  }
  return languages;
}
