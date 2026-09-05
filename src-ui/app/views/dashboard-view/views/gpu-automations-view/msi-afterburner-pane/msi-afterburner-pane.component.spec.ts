import '@angular/compiler';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MsiAfterburnerPaneComponent } from './msi-afterburner-pane.component';
import { AUTOMATION_CONFIGS_DEFAULT } from '../../../../../models/automations';
import type { ExecutableReferenceStatus } from '../../../../../models/settings';

const openFile = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: openFile }));
type Dependencies = ConstructorParameters<typeof MsiAfterburnerPaneComponent>;
const typed = 'C:\\typed\\MSIAfterburner.exe';
const browsed = 'C:\\browsed\\MSIAfterburner.exe';

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
  const config = new BehaviorSubject(structuredClone(AUTOMATION_CONFIGS_DEFAULT.MSI_AFTERBURNER));
  const status = new BehaviorSubject<ExecutableReferenceStatus>('UNKNOWN');
  const setPath = vi.fn(async (path: string) =>
    config.next({ ...config.value, msiAfterburnerPath: path })
  );
  const gpu = {
    msiAfterburnerConfig: config,
    msiAfterburnerStatus: status,
    setMSIAfterburnerPath: setPath,
    setMSIAfterburnerProfileOnSleepEnable: vi.fn(),
    setMSIAfterburnerProfileOnSleepDisable: vi.fn(),
  };
  const component = new MsiAfterburnerPaneComponent(
    gpu as unknown as Dependencies[0],
    destroy as unknown as Dependencies[1]
  );
  component.ngOnInit();
  return { component, config, status, setPath, destroy, gpu };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('MSI path input', () => {
  it('saves the latest input after 500ms and forwards validation status', async () => {
    const h = setup();
    h.component.msiAfterburnerPathInputChange.next('C:\\partial');
    await vi.advanceTimersByTimeAsync(400);
    h.component.msiAfterburnerPathInputChange.next(typed);
    await vi.advanceTimersByTimeAsync(499);
    expect(h.setPath).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.setPath).toHaveBeenCalledExactlyOnceWith(typed);
    expect(h.config.value.msiAfterburnerPath).toBe(typed);
    h.status.next('CHECKING');
    expect(h.component.msiAfterburnerPathAlert?.loadingIndicator).toBe(true);
    h.status.next('SUCCESS');
    expect(h.component.msiAfterburnerPathAlert?.type).toBe('SUCCESS');
    h.status.next('INVALID_SIGNATURE');
    expect(h.component.msiAfterburnerPathAlert?.type).toBe('ERROR');
    h.destroy.run();
  });

  it('flushes pending input once when navigating away', async () => {
    const h = setup();
    h.component.msiAfterburnerPathInputChange.next(typed);
    await vi.advanceTimersByTimeAsync(100);
    h.destroy.run();
    expect(h.setPath).toHaveBeenCalledExactlyOnceWith(typed);
    expect(h.config.value.msiAfterburnerPath).toBe(typed);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.setPath).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'Browse supersedes pending text, including immediate navigation: %s',
    async (navigate) => {
      const h = setup();
      h.component.msiAfterburnerPathInputChange.next(typed);
      openFile.mockResolvedValueOnce(browsed);
      await h.component.browseForMsiAfterburner();
      expect(h.setPath).toHaveBeenCalledExactlyOnceWith(browsed);
      if (navigate) h.destroy.run();
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.config.value.msiAfterburnerPath).toBe(browsed);
      expect(h.setPath).toHaveBeenCalledTimes(1);
      if (!navigate) h.destroy.run();
    }
  );

  it('retains pending text when Browse is cancelled', async () => {
    const h = setup();
    h.component.msiAfterburnerPathInputChange.next(typed);
    openFile.mockResolvedValueOnce(null);
    await h.component.browseForMsiAfterburner();
    await vi.advanceTimersByTimeAsync(500);
    expect(h.setPath).toHaveBeenCalledExactlyOnceWith(typed);
    h.destroy.run();
  });

  it('accepts text entered after a Browse selection', async () => {
    const h = setup();
    openFile.mockResolvedValueOnce(browsed);
    await h.component.browseForMsiAfterburner();
    h.component.msiAfterburnerPathInputChange.next(typed);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.setPath.mock.calls.map(([path]) => path)).toEqual([browsed, typed]);
    h.destroy.run();
  });

  it('ignores a Browse result returned after navigation', async () => {
    const h = setup();
    let finish!: (path: string) => void;
    openFile.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    h.component.msiAfterburnerPathInputChange.next(typed);
    const browsing = h.component.browseForMsiAfterburner();
    h.destroy.run();
    finish(browsed);
    await browsing;
    expect(h.setPath).toHaveBeenCalledExactlyOnceWith(typed);
  });

  it('saves an empty path and preserves profile selection behavior', async () => {
    const h = setup();
    h.component.msiAfterburnerPathInputChange.next('');
    await vi.advanceTimersByTimeAsync(500);
    expect(h.setPath).toHaveBeenCalledExactlyOnceWith('');
    h.component.changeProfile('ON_ENABLE', h.component.profileOptions[2]);
    h.component.changeProfile('ON_DISABLE', h.component.profileOptions[3]);
    expect(h.gpu.setMSIAfterburnerProfileOnSleepEnable).toHaveBeenCalledWith(2);
    expect(h.gpu.setMSIAfterburnerProfileOnSleepDisable).toHaveBeenCalledWith(3);
    h.destroy.run();
  });
});
