import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';
import { warn } from '@tauri-apps/plugin-log';
import type { CurrentUser } from 'vrchat';
import type { VRChatApiSettings } from 'src-ui/app/models/vrchat-api-settings';
import { VRChatAPI, VRChatInviteRefusedError } from './vrchat-api';
import { UserStatus } from 'src-ui/app/models/vrchat';

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('src-ui/app/utils/app-utils', () => ({ getVersion: vi.fn(async () => '0.0.0') }));

const settings = {
  profiles: [{ id: 'p', authCookie: 'token' }],
  activeProfileId: 'p',
} as unknown as VRChatApiSettings;

async function createApi(user: Partial<CurrentUser> = {}) {
  const reportError = vi.fn();
  const api = new VRChatAPI(of(settings), async () => {}, reportError);
  await api.init(of({ id: 'usr_me', ...user } as CurrentUser), () => {});
  return { api, reportError };
}

describe('VRChatAPI.inviteUser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs a refused invite locally without reporting it', async () => {
    const body = { error: { message: "You can't invite that user", status_code: 403 } };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status: 403 }));
    const { api, reportError } = await createApi();
    await expect(api.inviteUser('usr_bob', 'wrld_x:1')).rejects.toEqual(
      new VRChatInviteRefusedError("You can't invite that user", JSON.stringify(body))
    );
    expect(reportError).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("You can't invite that user"));
  });

  it.each([
    ['no body', null],
    ['an HTML body', '<html><body>Forbidden</body></html>'],
    ['an error string', JSON.stringify({ error: 'Forbidden' })],
    ['a non-string message', JSON.stringify({ error: { message: 42 } })],
    ['an empty message', JSON.stringify({ error: { message: '' } })],
  ])('treats a 403 with %s as a refusal without a usable message', async (_, body) => {
    vi.mocked(fetch).mockResolvedValue(new Response(body, { status: 403 }));
    const { api, reportError } = await createApi();
    const refusal = await api.inviteUser('usr_bob', 'wrld_x:1').catch((e) => e);
    expect(refusal).toBeInstanceOf(VRChatInviteRefusedError);
    expect(refusal.vrchatMessage || undefined).toBeUndefined();
    expect(refusal.body).toBe(body ?? '');
    expect(reportError).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 403'));
  });

  it('reports other failed invites', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));
    const { api, reportError } = await createApi();
    await expect(api.inviteUser('usr_bob', 'wrld_x:1')).rejects.toBeInstanceOf(Response);
    expect(reportError).toHaveBeenCalledWith(new Error('VRChat invite request failed: HTTP 500'));
  });
});

describe('VRChatAPI.setStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  const sentBody = () => JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);

  it('skips a message VRChat stored with lookalike punctuation', async () => {
    const { api } = await createApi({
      status: UserStatus.JoinMe,
      statusDescription: 'Sleeping come cuddle up․',
    });
    await expect(api.setStatus(UserStatus.JoinMe, 'Sleeping come cuddle up.')).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends only the status when the message matches', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }));
    const { api } = await createApi({
      status: UserStatus.JoinMe,
      statusDescription: '（zzz）',
    });
    await expect(api.setStatus(UserStatus.Busy, '(zzz)')).resolves.toBe(true);
    expect(sentBody()).toEqual({ status: UserStatus.Busy });
  });

  it('sends a message that differs from the stored one', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }));
    const { api } = await createApi({
      status: UserStatus.JoinMe,
      statusDescription: 'Sleeping come cuddle up․',
    });
    await expect(api.setStatus(null, 'Sleeping come cuddle up!')).resolves.toBe(true);
    expect(sentBody()).toEqual({ statusDescription: 'Sleeping come cuddle up!' });
  });

  it('learns a rewrite VRChat returns three times in a row', async () => {
    const stored = 'zzz…';
    vi.mocked(fetch).mockImplementation(
      async () => new Response(JSON.stringify({ statusDescription: stored }), { status: 200 })
    );
    const { api } = await createApi({ status: UserStatus.JoinMe, statusDescription: stored });
    const onRewrite = vi.fn();
    api.setStatusMessageRewriteHandler(onRewrite);
    for (let i = 0; i < 3; i++) await expect(api.setStatus(null, 'zzz...')).resolves.toBe(true);
    expect(onRewrite).toHaveBeenCalledOnce();
    expect(onRewrite).toHaveBeenCalledWith('zzz...', stored);

    await expect(api.setStatus(null, 'zzz...')).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('learns nothing from a response without a status message', async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response('not json', { status: 200 }));
    const { api } = await createApi({ status: UserStatus.JoinMe, statusDescription: 'zzz…' });
    const onRewrite = vi.fn();
    api.setStatusMessageRewriteHandler(onRewrite);
    for (let i = 0; i < 4; i++) await expect(api.setStatus(null, 'zzz...')).resolves.toBe(true);
    expect(onRewrite).not.toHaveBeenCalled();
  });

  it.each([
    ['an unreadable response', () => new Response('not json', { status: 200 })],
    ['a failed response', () => new Response(null, { status: 500 })],
  ])('restarts the rewrite count after %s', async (_, interruption) => {
    const stored = 'zzz…';
    const rewrite = () =>
      new Response(JSON.stringify({ statusDescription: stored }), { status: 200 });
    vi.mocked(fetch)
      .mockImplementationOnce(async () => rewrite())
      .mockImplementationOnce(async () => rewrite())
      .mockImplementationOnce(async () => interruption())
      .mockImplementation(async () => rewrite());
    const { api } = await createApi({ status: UserStatus.JoinMe, statusDescription: stored });
    const onRewrite = vi.fn();
    api.setStatusMessageRewriteHandler(onRewrite);
    for (let i = 0; i < 5; i++) await api.setStatus(null, 'zzz...').catch(() => false);
    expect(onRewrite).not.toHaveBeenCalled();
    await api.setStatus(null, 'zzz...');
    expect(onRewrite).toHaveBeenCalledOnce();
  });

  it('restarts the rewrite count after a PUT without a message', async () => {
    const stored = 'zzz…';
    vi.mocked(fetch).mockImplementation(
      async () => new Response(JSON.stringify({ statusDescription: stored }), { status: 200 })
    );
    const { api } = await createApi({ status: UserStatus.JoinMe, statusDescription: stored });
    const onRewrite = vi.fn();
    api.setStatusMessageRewriteHandler(onRewrite);
    await api.setStatus(null, 'zzz...');
    await api.setStatus(null, 'zzz...');
    await api.setStatus(UserStatus.Busy, null);
    await api.setStatus(null, 'zzz...');
    await api.setStatus(null, 'zzz...');
    expect(onRewrite).not.toHaveBeenCalled();
  });

  it('compares a queued change against the user the previous PUT left', async () => {
    const user = new BehaviorSubject({
      id: 'usr_me',
      status: UserStatus.JoinMe,
      statusDescription: 'zero',
    } as CurrentUser);
    vi.mocked(fetch).mockImplementation(async () => new Response('{}', { status: 200 }));
    const api = new VRChatAPI(of(settings), async () => {}, vi.fn());
    await api.init(user, (patch) => user.next({ ...user.value, ...patch }));

    const first = api.setStatus(UserStatus.Busy, 'first');
    const second = api.setStatus(UserStatus.JoinMe, 'second');
    await Promise.all([first, second]);
    expect(user.value.status).toBe(UserStatus.JoinMe);
    expect(user.value.statusDescription).toBe('second');
  });
});
