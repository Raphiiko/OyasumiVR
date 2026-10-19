import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExternalLinkService } from './external-link.service';
import { OpenVRService } from './openvr.service';
import { ToastService } from './toast.service';

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));
vi.mock('@tauri-apps/plugin-log', () => ({ error: vi.fn() }));
vi.mock('./openvr.service', () => ({ OpenVRService: class {} }));

class FakeAnchor {
  constructor(
    public href: string,
    public target = ''
  ) {}
}
vi.stubGlobal('HTMLAnchorElement', FakeAnchor);

function setup(dashboardVisible: boolean) {
  const show = vi.fn();
  const injector = Injector.create({
    providers: [
      { provide: OpenVRService, useValue: { isDashboardVisible: async () => dashboardVisible } },
      { provide: ToastService, useValue: { show } },
    ],
  });
  const service = runInInjectionContext(injector, () => new ExternalLinkService());
  const click = (anchor: FakeAnchor, init: Partial<MouseEvent> = {}) => {
    const event = {
      button: 0,
      composedPath: () => [anchor],
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      ...init,
    };
    (service as unknown as { onClick(e: unknown): void }).onClick(event);
    return event;
  };
  return { service, show, click };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('ExternalLinkService', () => {
  it('shows a toast while the SteamVR dashboard is visible', async () => {
    const h = setup(true);
    await h.service.open('https://example.com/');
    expect(openUrl).toHaveBeenCalledWith('https://example.com/');
    expect(h.show).toHaveBeenCalledWith({ title: 'toasts.externalLink.opened' });
  });

  it('shows no toast on the desktop', async () => {
    const h = setup(false);
    await h.service.open('https://example.com/');
    expect(openUrl).toHaveBeenCalled();
    expect(h.show).not.toHaveBeenCalled();
  });

  it('shows a toast for new-window and ctrl clicked links, and leaves the click alone', async () => {
    const h = setup(true);
    const event = h.click(new FakeAnchor('https://example.com/', '_blank'));
    h.click(new FakeAnchor('https://example.com/'), { ctrlKey: true });
    await vi.waitFor(() => expect(h.show).toHaveBeenCalledTimes(2));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('shows no toast for in-app links and other protocols', async () => {
    const h = setup(true);
    h.click(new FakeAnchor('https://example.com/'));
    h.click(new FakeAnchor('file:///C:/Windows', '_blank'));
    h.click(new FakeAnchor('https://example.com/', '_blank'), { button: 1 });
    await new Promise((resolve) => setTimeout(resolve));
    expect(h.show).not.toHaveBeenCalled();
  });
});
