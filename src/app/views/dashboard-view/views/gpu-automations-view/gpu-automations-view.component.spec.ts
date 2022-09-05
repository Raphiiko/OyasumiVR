import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GpuAutomationsViewComponent } from './gpu-automations-view.component';

describe('GpuAutomationsViewComponent', () => {
  let component: GpuAutomationsViewComponent;
  let fixture: ComponentFixture<GpuAutomationsViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [GpuAutomationsViewComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(GpuAutomationsViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
