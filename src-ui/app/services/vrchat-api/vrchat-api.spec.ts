import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';
import { warn } from '@tauri-apps/plugin-log';
import type { CurrentUser } from 'vrchat';
import type { VRChatApiSettings } from 'src-ui/app/models/vrchat-api-settings';
import { VRChatAPI } from './vrchat-api';

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('src-ui/app/utils/app-utils', () => ({ getVersion: vi.fn(async () => '0.0.0') }));

const settings = {
  profiles: [{ id: 'p', authCookie: 'token' }],
  activeProfileId: 'p',
} as unknown as VRChatApiSettings;

async function createApi() {
  const reportError = vi.fn();
  const api = new VRChatAPI(of(settings), async () => {}, reportError);
  await api.init(of({ id: 'usr_me' } as CurrentUser), () => {});
  return { api, reportError };
}

describe('VRChatAPI.inviteUser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs a refused invite locally without reporting it', async () => {
    const body = { error: { message: "You can't invite that user", status_code: 403 } };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status: 403 }));
    const { api, reportError } = await createApi();
    await expect(api.inviteUser('usr_bob', 'wrld_x:1')).rejects.toBeInstanceOf(Response);
    expect(reportError).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("You can't invite that user"));
  });

  it('reports other failed invites', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));
    const { api, reportError } = await createApi();
    await expect(api.inviteUser('usr_bob', 'wrld_x:1')).rejects.toBeInstanceOf(Response);
    expect(reportError).toHaveBeenCalledWith(new Error('VRChat invite request failed: HTTP 500'));
  });
});
