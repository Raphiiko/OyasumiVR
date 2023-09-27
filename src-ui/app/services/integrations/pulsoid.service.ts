import { Injectable } from '@angular/core';
import { PULSOID_CLIENT_ID, PULSOID_REDIRECT_URI } from '../../globals';
import { shell } from '@tauri-apps/api';

@Injectable({
  providedIn: 'root',
})
export class PulsoidService {
  constructor() {}

  async login() {
    // Generate CSRF token
    const state = Math.random().toString(36).substring(7);
    // Construct a url with query parameters
    const url = new URL('https://pulsoid.net/oauth2/authorize');
    url.searchParams.append('client_id', PULSOID_CLIENT_ID);
    url.searchParams.append('redirect_uri', PULSOID_REDIRECT_URI);
    url.searchParams.append('response_type', 'token');
    url.searchParams.append('scope', 'data:heart_rate:read,profile:read');
    url.searchParams.append('state', state);
    console.log('Opening URL: ' + url.toString());
    await shell.open(url.toString());
  }

  public async handleDeepLink(
    path: string,
    params: Record<string, string[]>,
    fragmentParams: Record<string, string[]>
  ) {
    // TODO
    console.log('Handling Pulsoid deep link: ', {
      path,
      params,
      fragmentParams,
    });
  }
}
