import '@angular/compiler';
import {
  ChangeDetectorRef,
  DestroyRef,
  ElementRef,
  EnvironmentInjector,
  Injector,
  runInInjectionContext,
} from '@angular/core';
import { describe, expect, it } from 'vitest';
import { SliderSettingComponent } from './slider-setting.component';

describe('SliderSettingComponent', () => {
  it('emits a typed value that is still debouncing when it is destroyed', () => {
    // the injector is the DestroyRef the model's output registers with, as a view's would be
    const injector = Injector.create({ providers: [] }) as EnvironmentInjector;
    const cdr = { markForCheck: () => {} } as unknown as ChangeDetectorRef;
    const component = runInInjectionContext(
      injector,
      () => new SliderSettingComponent(injector as DestroyRef, cdr, {} as ElementRef)
    );
    const emitted: number[] = [];
    component.value.subscribe((value) => emitted.push(value));

    component.ngOnInit();
    component['input$'].next('42');

    // Angular runs ngOnDestroy before the DestroyRef callbacks
    component.ngOnDestroy();
    injector.destroy();

    expect(emitted).toEqual([42]);
  });
});
