import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { EMPTY } from 'rxjs';
import { afterEach, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';

vi.mock('./app-routing.module', () => ({ routeAnimations: [] }));

afterEach(() => vi.unstubAllGlobals());

it('applies reduced motion to the body, follows changes, and removes its listener', () => {
  const media = Object.assign(new EventTarget(), { matches: true });
  const body = {};
  const setProperty = vi.fn();
  const injector = Injector.create({ providers: [] });
  vi.stubGlobal('window', { matchMedia: vi.fn(() => media) });
  vi.stubGlobal('document', { body });
  runInInjectionContext(
    injector,
    () =>
      new AppComponent(
        {} as any,
        {} as any,
        { settings: EMPTY } as any,
        {} as any,
        { setProperty } as any
      )
  );
  expect(setProperty).toHaveBeenLastCalledWith(body, '@.disabled', true);
  media.matches = false;
  media.dispatchEvent(new Event('change'));
  expect(setProperty).toHaveBeenLastCalledWith(body, '@.disabled', false);
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  expect(setProperty).toHaveBeenLastCalledWith(body, '@.disabled', true);
  injector.destroy();
  setProperty.mockClear();
  media.matches = false;
  media.dispatchEvent(new Event('change'));
  expect(setProperty).not.toHaveBeenCalled();
});
