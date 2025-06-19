import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { getVersion } from '../../../../utils/app-utils';
import { BackgroundService } from '../../../../services/background.service';
import { BUILD_ID, FLAVOUR } from '../../../../../build';
import { CachedValue } from '../../../../utils/cached-value';
import { filter, interval } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { vshrink } from '../../../../utils/animations';
import { shuffle } from 'lodash';
import { warn } from '@tauri-apps/plugin-log';
import translationContributorData from '../../../../../../docs/translation_contributors.json';
import { fetch } from '@tauri-apps/plugin-http';

interface SupporterTier {
  name: string;
  supporters: string[];
}

interface TranslationContributor {
  name: string;
  url?: string;
  langCode: string;
  flagCode?: string;
  langNameNative: string;
  langNameEnglish: string;
}

@Component({
  selector: 'app-about-view',
  templateUrl: './about-view.component.html',
  styleUrls: ['./about-view.component.scss'],
  animations: [vshrink()],
  standalone: false,
})
export class AboutViewComponent implements OnInit, AfterViewInit, OnDestroy {
  protected readonly FLAVOUR = FLAVOUR;
  protected translationContributors: TranslationContributor[] = [];
  private supportersScrolling = false;

  version?: string;

  @ViewChild('supportersList') supportersList?: ElementRef;

  protected supporterCache: CachedValue<SupporterTier[]> = new CachedValue<SupporterTier[]>(
    undefined,
    60 * 60 * 1000, // Cache for 1 hour
    'OYASUMIVR_SUPPORTERS'
  );

  constructor(
    private background: BackgroundService,
    private destroyRef: DestroyRef
  ) {
    let translationContributors: TranslationContributor[] = translationContributorData;
    // Change flags in translation contributors for CN compliance.
    if (FLAVOUR === 'STEAM_CN') {
      const cnComplianceFix = (author: TranslationContributor): TranslationContributor => {
        if (author.flagCode === 'tw') author.flagCode = 'hk';
        if (author.langCode === 'tw') author.langCode = 'hk';
        return author;
      };

      translationContributors = translationContributors.map((contribs) =>
        cnComplianceFix(contribs)
      );
    }

    this.buildTranslationContributors(translationContributors, 4);
  }

  private buildTranslationContributors(
    translationContributors: TranslationContributor[],
    columns: 4
  ) {
    const matrix: TranslationContributor[][] = [];
    const rows = Math.ceil(translationContributors.length / columns);
    let i = 0;
    for (let column = 0; column < columns; column++) {
      for (let row = 0; row < rows; row++) {
        if (i < translationContributors.length) {
          if (!matrix[column]) matrix[column] = [];
          matrix[column][row] = translationContributors[i];
          i++;
        }
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        if (matrix[column][row]) {
          this.translationContributors.push(matrix[column][row]);
        }
      }
    }
  }

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
      } catch (e) {
        // Ignore failure, we'll just not show the list.
      }
    } else {
      supporters = structuredClone(supporters);
      supporters.forEach((tier) => (tier.supporters = shuffle(tier.supporters)));
      await this.supporterCache.set(supporters);
    }
  }

  async ngAfterViewInit() {
    interval(1000)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter(() => !this.supportersScrolling)
      )
      .subscribe(() => {
        if (!this.supportersList) return;
        const list = this.supportersList.nativeElement as HTMLDivElement;
        if (list.scrollWidth <= list.clientWidth) return;
        this.supportersScrolling = true;
        const scrollToEnd = () => {
          if (!this.supportersScrolling) {
            list.scrollLeft = 0;
            list.style.opacity = '100%';
            return;
          }
          list.scrollLeft += 1;
          if (list.scrollLeft < list.scrollWidth - list.clientWidth) {
            setTimeout(() => scrollToEnd(), 16);
          } else {
            setTimeout(() => {
              list.style.opacity = '0%';
            }, 1500);
            setTimeout(() => {
              list.scrollLeft = 0;
              list.style.opacity = '100%';
              setTimeout(() => requestAnimationFrame(() => scrollToEnd()), 2000);
            }, 2000);
          }
        };
        setTimeout(() => requestAnimationFrame(() => scrollToEnd()), 2000);
      });
  }

  async ngOnDestroy() {
    this.background.setBackground(null);
  }

  protected readonly BUILD_ID = BUILD_ID;
}
