import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TimeEnableSleepModeModalComponent } from './time-enable-sleep-mode-modal.component';

describe('TimeEnableSleepmodeModalComponent', () => {
  let component: TimeEnableSleepModeModalComponent;
  let fixture: ComponentFixture<TimeEnableSleepModeModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [TimeEnableSleepModeModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TimeEnableSleepModeModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
