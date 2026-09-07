import '@angular/compiler';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { APP_SETTINGS_DEFAULT } from '../../../../models/settings';
import { SettingsOscViewComponent } from './settings-osc-view.component';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

class TestComponent extends SettingsOscViewComponent {
  editHost(host: string) {
    this.customTargetHostChangeSubject.next(host);
  }
  get validity() {
    return this.customTargetHostValidationState;
  }
}

function setup() {
  const callbacks = new Set<() => void>();
  const destroy = {
    destroyed: false,
    onDestroy: (callback: () => void) => {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    run: () => {
      destroy.destroyed = true;
      [...callbacks].forEach((callback) => callback());
    },
  };
  const updateSettings = vi.fn(async () => {});
  type Dependencies = ConstructorParameters<typeof SettingsOscViewComponent>;
  const component = new TestComponent(
    destroy as Dependencies[0],
    {
      settings: new BehaviorSubject(structuredClone(APP_SETTINGS_DEFAULT)),
      updateSettings,
    } as unknown as Dependencies[1],
    { vrchatOscAddress: new BehaviorSubject(null) } as unknown as Dependencies[2]
  );
  void component.ngOnInit();
  return { component, updateSettings, destroy };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it('persists a trimmed localhost only after backend acceptance', async () => {
  vi.mocked(invoke).mockResolvedValue(true);
  const h = setup();
  h.component.editHost(' localhost ');
  expect(h.component.validity).toBe('pending');
  expect(h.updateSettings).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(500);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('osc_valid_addr', { addr: 'localhost:1' });
  expect(h.component.validity).toBe('valid');
  expect(h.updateSettings).toHaveBeenCalledExactlyOnceWith({ oscCustomTargetHost: 'localhost' });
  h.destroy.run();
});

it.each([false, new Error('native failure')])(
  'does not save a rejected host: %s',
  async (result) => {
    if (result instanceof Error) vi.mocked(invoke).mockRejectedValue(result);
    else vi.mocked(invoke).mockResolvedValue(result);
    const h = setup();
    h.component.editHost('unresolvable.invalid');
    await vi.advanceTimersByTimeAsync(500);
    expect(h.component.validity).toBe('invalid');
    expect(h.updateSettings).not.toHaveBeenCalledWith({
      oscCustomTargetHost: 'unresolvable.invalid',
    });
    expect(h.updateSettings).toHaveBeenCalledWith({ oscTargets: ['VRCHAT_OSCQUERY'] });
    h.destroy.run();
  }
);

it('ignores an old response as soon as a new host is typed', async () => {
  let resolveOld!: (value: boolean) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      })
  );
  vi.mocked(invoke).mockResolvedValueOnce(true);
  const h = setup();
  h.component.editHost('old.local');
  await vi.advanceTimersByTimeAsync(500);
  h.component.editHost('localhost');
  resolveOld(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(h.component.validity).toBe('pending');
  expect(h.updateSettings).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(500);
  expect(h.updateSettings).toHaveBeenCalledExactlyOnceWith({ oscCustomTargetHost: 'localhost' });
  h.destroy.run();
});

it('finishes validation for a valid edit flushed on navigation', async () => {
  vi.mocked(invoke).mockResolvedValue(true);
  const h = setup();
  h.component.editHost('localhost');
  h.destroy.run();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.updateSettings).toHaveBeenCalledExactlyOnceWith({ oscCustomTargetHost: 'localhost' });
});

it('ignores a successful old lookup after navigation and a newer edit', async () => {
  let resolveOld!: (value: boolean) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      })
  );
  vi.mocked(invoke).mockResolvedValueOnce(true);
  const old = setup();
  old.component.editHost('old.local');
  await vi.advanceTimersByTimeAsync(500);
  old.destroy.run();
  const current = setup();
  current.component.editHost('localhost');
  await vi.advanceTimersByTimeAsync(500);
  resolveOld(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(old.updateSettings).not.toHaveBeenCalled();
  expect(current.updateSettings).toHaveBeenCalledExactlyOnceWith({
    oscCustomTargetHost: 'localhost',
  });
  current.destroy.run();
});

it.each(['localhost.', 'vrchat_pc', '10.0.0.5.example.test'])(
  'uses backend acceptance for %s',
  async (host) => {
    vi.mocked(invoke).mockResolvedValue(true);
    const h = setup();
    h.component.editHost(host);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.updateSettings).toHaveBeenCalledExactlyOnceWith({ oscCustomTargetHost: host });
    h.destroy.run();
  }
);
