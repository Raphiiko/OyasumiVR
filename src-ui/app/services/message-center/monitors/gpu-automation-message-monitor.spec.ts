import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationConfigService } from '../../automation-config.service';
import {
  ElevatedFeaturesFailure,
  ElevatedFeaturesOperation,
  ElevatedSidecarService,
} from '../../elevated-sidecar.service';
import { GpuAutomationsService } from '../../gpu-automations.service';
import { NvmlService } from '../../nvml.service';
import { MessageCenterService, MessageItem } from '../message-center.service';
import { GpuAutomationMessageMonitor } from './gpu-automation-message-monitor';

vi.mock('../../automation-config.service', () => ({ AutomationConfigService: class {} }));
vi.mock('../../elevated-sidecar.service', () => ({ ElevatedSidecarService: class {} }));
vi.mock('../../gpu-automations.service', () => ({
  GpuAutomationsService: class {},
  MSI_AFTERBURNER_ERROR_STATUSES: [],
}));
vi.mock('../../nvml.service', () => ({ NvmlService: class {} }));
vi.mock('../message-center.service', () => ({ MessageCenterService: class {} }));
vi.mock('@angular/router', () => ({ Router: class {} }));

const MESSAGE_ID = 'gpuAutomationsSidecarNotRunning';

describe('GpuAutomationMessageMonitor', () => {
  let sidecarStarted: BehaviorSubject<boolean>;
  let operation: BehaviorSubject<ElevatedFeaturesOperation>;
  let failure: BehaviorSubject<ElevatedFeaturesFailure | null>;
  let messages: Map<string, MessageItem>;

  beforeEach(async () => {
    vi.useFakeTimers();
    sidecarStarted = new BehaviorSubject(false);
    operation = new BehaviorSubject<ElevatedFeaturesOperation>('idle');
    failure = new BehaviorSubject<ElevatedFeaturesFailure | null>(null);
    messages = new Map();
    const messageCenter = {
      addMessage: (message: MessageItem) => messages.set(message.id, message),
      removeMessage: (id: string) => messages.delete(id),
    } as unknown as MessageCenterService;
    const gpuAutomations = {
      isEnabled: () => new BehaviorSubject(true),
      powerLimitsConfig: new BehaviorSubject({
        onSleepEnable: { enabled: false },
        onSleepDisable: { enabled: false },
      }),
      msiAfterburnerConfig: new BehaviorSubject({
        onSleepEnableProfile: 0,
        onSleepDisableProfile: 0,
      }),
      msiAfterburnerStatus: new BehaviorSubject('SUCCESS'),
    };
    const injector = Injector.create({
      providers: [
        { provide: NvmlService, useValue: { status: new BehaviorSubject('Initialized') } },
        { provide: GpuAutomationsService, useValue: gpuAutomations },
        {
          provide: ElevatedSidecarService,
          useValue: { sidecarStarted, operation, failure },
        },
        { provide: AutomationConfigService, useValue: {} },
        { provide: Router, useValue: {} },
      ],
    });
    const monitor = runInInjectionContext(
      injector,
      () => new GpuAutomationMessageMonitor(messageCenter)
    );
    await monitor.init();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const enableFailure: ElevatedFeaturesFailure = {
    operation: 'enable',
    result: { result: 'installFailed' },
  };

  it('shows the message once automations have lacked a sidecar for 5 seconds', async () => {
    await vi.advanceTimersByTimeAsync(4_900);
    expect(messages.has(MESSAGE_ID)).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    expect(messages.has(MESSAGE_ID)).toBe(true);
  });

  it('shows no message for an enable that starts before the 5 seconds pass', async () => {
    await vi.advanceTimersByTimeAsync(1_000);
    operation.next('enabling');
    await vi.advanceTimersByTimeAsync(30_000);

    expect(messages.has(MESSAGE_ID)).toBe(false);
  });

  it('keeps a shown message while an enable runs', async () => {
    await vi.advanceTimersByTimeAsync(5_000);
    operation.next('enabling');
    await vi.advanceTimersByTimeAsync(30_000);

    expect(messages.has(MESSAGE_ID)).toBe(true);
  });

  it('shows no message while an elevated features failure is published', async () => {
    failure.next(enableFailure);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(messages.has(MESSAGE_ID)).toBe(false);
  });

  it.each([
    ['the sidecar starts', () => sidecarStarted.next(true)],
    ['a failure is published', () => failure.next(enableFailure)],
  ])('removes a shown message at once when %s', async (_, clearCondition) => {
    await vi.advanceTimersByTimeAsync(5_000);
    expect(messages.has(MESSAGE_ID)).toBe(true);

    clearCondition();

    expect(messages.has(MESSAGE_ID)).toBe(false);
  });
});
