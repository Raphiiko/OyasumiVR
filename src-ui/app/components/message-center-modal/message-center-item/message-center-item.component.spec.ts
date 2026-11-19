import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  MessageAction,
  MessageCenterService,
} from 'src-ui/app/services/message-center/message-center.service';
import { MessageCenterItemComponent } from './message-center-item.component';

vi.mock('src-ui/app/services/message-center/message-center.service', () => ({
  MessageCenterService: class {},
}));

function createItem() {
  const messageCenter = {
    hiddenMessageIds: new BehaviorSubject<string[]>([]),
  } as unknown as MessageCenterService;
  return runInInjectionContext(
    Injector.create({ providers: [] }),
    () => new MessageCenterItemComponent(messageCenter)
  );
}

describe('MessageCenterItemComponent', () => {
  it('keeps an action busy until its promise settles, also after the message is replaced', async () => {
    const item = createItem();
    let settle!: () => void;
    const pending = new Promise<void>((resolve) => (settle = resolve));
    const retry: MessageAction = { label: 'retry', action: () => pending };

    const run = item.runAction(retry);
    // a monitor re-adding the message hands the item new action objects with the same labels
    const replacedRetry: MessageAction = { label: 'retry', action: () => undefined };
    const replacedOther: MessageAction = { label: 'logs', action: () => undefined };

    expect(item.isBusy(replacedRetry)).toBe(true);
    expect(item.isBusy(replacedOther)).toBe(false);
    expect(item.anyBusy()).toBe(true);

    settle();
    await run;

    expect(item.isBusy(replacedRetry)).toBe(false);
    expect(item.anyBusy()).toBe(false);
  });

  it('clears the busy state when the promise rejects', async () => {
    const item = createItem();
    const failing: MessageAction = { label: 'retry', action: () => Promise.reject(new Error()) };

    await expect(item.runAction(failing)).rejects.toThrow();

    expect(item.anyBusy()).toBe(false);
  });
});
