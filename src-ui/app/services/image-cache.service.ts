import { Injectable } from '@angular/core';
import { commands } from 'src-ui/app/bindings';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ImageCacheService {
  httpServerPort = new BehaviorSubject<number | null>(null);

  constructor() {}

  async init() {
    while (!this.httpServerPort.value) {
      const port = (await commands.getHttpServerPort()) || null;
      if (port) this.httpServerPort.next(port);
      else await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  getImageUrl(remoteUrl: string, ttl = 3600) {
    if (!this.httpServerPort.value) return '';
    return (
      'http://localhost:' +
      this.httpServerPort.value +
      '/image_cache/get?url=' +
      encodeURIComponent(remoteUrl) +
      '&ttl=' +
      ttl
    );
  }
}
