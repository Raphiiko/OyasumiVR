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
      defaultPrevented: false,
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

  it('opens new-window links in the browser', () => {
    const h = setup(false);
    const event = h.click(new FakeAnchor('https://example.com/', '_blank'));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(openUrl).toHaveBeenCalledWith('https://example.com/');
  });

  it('leaves in-app links and other protocols to the webview', () => {
    const h = setup(false);
    h.click(new FakeAnchor('https://example.com/'));
    h.click(new FakeAnchor('file:///C:/Windows', '_blank'));
    expect(openUrl).not.toHaveBeenCalled();
  });
});
