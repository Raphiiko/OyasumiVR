import '@angular/compiler';
import type { DestroyRef } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OVRActionBinding } from '../../models/ovr-action-binding';
import type { OVRDevice } from '../../models/ovr-device';
import { OVRInputEventAction, OVRInputEventActionSet } from '../../models/ovr-input-event';
import { OpenVRInputService } from '../../services/openvr-input.service';
import type { OpenVRService, OpenVRStatus } from '../../services/openvr.service';
import { ControllerBindingComponent } from './controller-binding.component';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const binding: OVRActionBinding = {
  devicePathName: '/user/hand/right',
  inputPathName: '/input/a',
  inputSourceType: 'button',
  localizedControllerType: 'Index Controller',
  localizedHand: 'Right Hand',
  localizedInputSource: 'A Button',
  modeName: 'button',
  slotName: 'click',
};

function controller(index: number, role: 'LeftHand' | 'RightHand'): OVRDevice {
  return { battery: 1, class: 'Controller', role, index, pose: {}, isTurningOff: false };
}

function createComponent() {
  const status = new BehaviorSubject<OpenVRStatus>('INITIALIZED');
  const devices = new BehaviorSubject<OVRDevice[]>([
    controller(1, 'LeftHand'),
    controller(2, 'RightHand'),
  ]);
  const openvr = {
    status,
    devices,
    isDashboardVisible: vi.fn(async () => false),
  } as unknown as OpenVRService;
  const destroyRef = { onDestroy: () => () => {} } as unknown as DestroyRef;
  const component = new ControllerBindingComponent(
    new OpenVRInputService(openvr),
    openvr,
    destroyRef
  );
  component.actionKey = OVRInputEventAction.OpenOverlay;
  return component;
}

describe('ControllerBindingComponent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps polling after a failed query and shows the next valid response', async () => {
    invoke.mockResolvedValueOnce(null).mockResolvedValue([binding]);
    const component = createComponent();

    component.ngOnInit();
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(component.activeBinding).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1000);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(component.activeBinding).toEqual(binding);
  });

  it('keeps polling after a rejected query', async () => {
    invoke.mockRejectedValueOnce('OPENVR_NOT_INITIALIZED').mockResolvedValue([binding]);
    const component = createComponent();

    component.ngOnInit();
    await vi.advanceTimersByTimeAsync(1000);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(component.activeBinding).toEqual(binding);
  });

  it('ignores a slow query that settles after a newer one', async () => {
    let failSlowQuery: (reason: unknown) => void = () => {};
    invoke
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (failSlowQuery = reject)))
      .mockResolvedValue([binding]);
    const component = createComponent();

    component.ngOnInit();
    await vi.advanceTimersByTimeAsync(1000);
    expect(component.activeBinding).toEqual(binding);

    failSlowQuery('SLOW_FAILURE');
    await vi.advanceTimersByTimeAsync(0);

    expect(component.activeBinding).toEqual(binding);
  });
});

describe('OpenVRInputService', () => {
  beforeEach(() => invoke.mockReset());

  it('drops bindings without a usable slot name', async () => {
    invoke.mockResolvedValue([binding, { ...binding, slotName: 'null' }]);
    const status = new BehaviorSubject<OpenVRStatus>('INITIALIZED');
    const service = new OpenVRInputService({ status } as unknown as OpenVRService);

    const bindings = await service.getActionBindings(
      OVRInputEventActionSet.Main,
      OVRInputEventAction.OpenOverlay
    );

    expect(bindings).toEqual([binding]);
  });
});
