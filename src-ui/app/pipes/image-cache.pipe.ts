import { ChangeDetectorRef, OnDestroy, Pipe, PipeTransform } from '@angular/core';
import { Subscription } from 'rxjs';
import { ImageCacheService } from '../services/image-cache.service';

@Pipe({
  name: 'imageCache',
  pure: false,
  standalone: false,
})
export class ImageCachePipe implements PipeTransform, OnDestroy {
  private subscription: Subscription;

  constructor(
    private imageCache: ImageCacheService,
    private cdr: ChangeDetectorRef
  ) {
    // The port arrives once, after startup, and getImageUrl returns '' until it
    // does. markForCheck is what lets an OnPush view pick up that transition.
    this.subscription = this.imageCache.httpServerPort.subscribe(() => this.cdr.markForCheck());
  }

  transform(value?: string, ttl = 3600): string {
    if (!value) return '';
    return this.imageCache.getImageUrl(value, ttl);
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }
}
