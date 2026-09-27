import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostBinding,
  Input,
  OnChanges,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

const svgCache = new Map<string, Promise<string>>();

/** Inlines an icon from `assets/icons`, so its fills can read the `--icon-*` theme variables. */
@Component({
  selector: 'app-icon',
  template: '',
  styleUrls: ['./icon.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class IconComponent implements OnChanges {
  @Input({ required: true }) name!: string;
  @HostBinding('innerHTML') svg?: SafeHtml;

  constructor(
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnChanges() {
    const name = this.name;
    if (!svgCache.has(name)) {
      svgCache.set(
        name,
        fetch(`/assets/icons/${name}.svg`).then((response) => response.text())
      );
    }
    const svg = await svgCache.get(name)!;

    // a newer name may have arrived while this one loaded
    if (name !== this.name) return;
    this.svg = this.sanitizer.bypassSecurityTrustHtml(svg);
    this.cdr.markForCheck();
  }
}
