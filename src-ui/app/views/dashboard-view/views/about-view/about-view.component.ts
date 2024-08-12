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
import { getClient } from '@tauri-apps/api/http';
import { vshrink } from '../../../../utils/animations';
import { shuffle } from 'lodash';
import { warn } from 'tauri-plugin-log-api';
import translationContributors from '../../../../../../docs/translation_contributors.json';

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
})
export class AboutViewComponent implements OnInit, AfterViewInit, OnDestroy {
  protected readonly FLAVOUR = FLAVOUR;
  protected translationContributors: TranslationContributor[] = translationContributors;
  private supportersScrolling = false;

  version?: string;

  @ViewChild('supportersList') supportersList?: ElementRef;

  protected supporterCache: CachedValue<SupporterTier[]> = new CachedValue<SupporterTier[]>(
    undefined,
    60 * 60 * 1000, // Cache for 1 hour
    'OYASUMIVR_SUPPORTERS'
  );

  constructor(private background: BackgroundService, private destroyRef: DestroyRef) {
    // Change flags in translation contributors for CN compliance.
    if (FLAVOUR === 'STEAM_CN') {
      const cnComplianceFix = (author: TranslationContributor): TranslationContributor => {
        if (author.flagCode === 'tw') author.flagCode = 'hk';
        if (author.langCode === 'tw') author.langCode = 'hk';
        return author;
      };

      this.translationContributors = this.translationContributors.map(cnComplianceFix);
    }

    // Rotate translation contributors matrix diagonally
    function mirrorMatrixDiagonally<T>(arr: T[], columns: number): T[] {
      const newArr = new Array<T>(arr.length);
      const rows = Math.ceil(arr.length / columns);
      for (let i = 0; i < arr.length; i++)
        newArr[(i % rows) * columns + Math.floor(i / rows)] = arr[i];
      return newArr;
    }
    this.translationContributors = mirrorMatrixDiagonally(this.translationContributors, 3);
  }

  async ngOnInit() {
    this.version = await getVersion();
    this.background.setBackground('/assets/img/about_bg.jpg');
    await this.supporterCache.waitForInitialisation();
    // Fetch supporters list if we don't have it yet (or if the cache expired)
    let supporters = this.supporterCache.get();
    if (supporters === undefined) {
      try {
        const client = await getClient();
        const response = await client.get<{ [tier: string]: string[] }>(
          'https://europe-west1-oyasumivr.cloudfunctions.net/getSupporters'
        );
        if (response.ok) {
          await this.supporterCache.set(
            Object.entries(response.data).map((entry) => ({
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
          list.scrollLeft += 0.5;
          if (list.scrollLeft < list.scrollWidth - list.clientWidth) {
            requestAnimationFrame(() => scrollToEnd());
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
