import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SleepDebugViewComponent } from './sleep-debug-view.component';

describe('SleepDebugViewComponent', () => {
  let component: SleepDebugViewComponent;
  let fixture: ComponentFixture<SleepDebugViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SleepDebugViewComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SleepDebugViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
