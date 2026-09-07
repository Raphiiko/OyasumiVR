import '@angular/compiler';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AUTOMATION_CONFIGS_DEFAULT } from '../../../../models/automations';
import { RunAutomationsViewComponent } from './run-automations-view.component';

const fields = [
  ['onSleepModeEnable', 'updateOnSleepModeEnable'],
  ['onSleepModeDisable', 'updateOnSleepModeDisable'],
  ['onSleepPreparation', 'updateOnSleepPreparation'],
] as const;

async function setup() {
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
  const commands = {
    getCommands: vi.fn(async () => 'rem saved command'),
    updateCommands: vi.fn(async () => {}),
    testCommands: vi.fn(),
  };
  const configs = structuredClone(AUTOMATION_CONFIGS_DEFAULT);
  configs.RUN_AUTOMATIONS.onSleepModeEnableCommands = 'rem saved command';
  type Dependencies = ConstructorParameters<typeof RunAutomationsViewComponent>;
  const component = new RunAutomationsViewComponent(
    destroy,
    {
      configs: new BehaviorSubject(configs),
    } as Dependencies[1],
    commands as unknown as Dependencies[2]
  );
  component.ngOnInit();
  await vi.advanceTimersByTimeAsync(500);
  return { component, commands, destroy };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it.each(fields)('saves the latest %s edit once when leaving early', async (event, edit) => {
  const h = await setup();
  expect(h.component[`${event}Commands`]).toBe('rem saved command');
  await h.component[edit]('rem first edit');
  await vi.advanceTimersByTimeAsync(200);
  await h.component[edit]('rem latest edit');
  expect(h.commands.updateCommands).not.toHaveBeenCalled();

  h.destroy.run();
  await vi.advanceTimersByTimeAsync(2000);

  expect(h.commands.updateCommands).toHaveBeenCalledExactlyOnceWith(event, 'rem latest edit');
  expect(h.commands.testCommands).not.toHaveBeenCalled();
});

it.each(fields)('keeps the one-second save delay for %s', async (event, edit) => {
  const h = await setup();
  await h.component[edit]('rem changed command');
  await vi.advanceTimersByTimeAsync(999);
  expect(h.commands.updateCommands).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(h.commands.updateCommands).toHaveBeenCalledExactlyOnceWith(event, 'rem changed command');

  h.destroy.run();
  expect(h.commands.updateCommands).toHaveBeenCalledTimes(1);
  expect(h.commands.testCommands).not.toHaveBeenCalled();
});

it.each(fields)('does not write unchanged %s text on destruction', async (_event, edit) => {
  const h = await setup();
  await h.component[edit]('rem saved command');
  h.destroy.run();
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.commands.updateCommands).not.toHaveBeenCalled();
  expect(h.commands.testCommands).not.toHaveBeenCalled();
});
