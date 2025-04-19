import { Pipe, PipeTransform } from '@angular/core';
import { ImageCacheService } from '../services/image-cache.service';

@Pipe({
  name: 'imageCache',
  pure: false,
  standalone: false,
})
export class ImageCachePipe implements PipeTransform {
  constructor(private imageCache: ImageCacheService) {}

  transform(value?: string, ttl = 3600): string {
    if (!value) return '';
    return this.imageCache.getImageUrl(value, ttl);
  }
}
