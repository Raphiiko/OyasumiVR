import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SleepDetectorEnableSleepModeModalComponent } from './sleep-detector-enable-sleep-mode-modal.component';

describe('TimeEnableSleepmodeModalComponent', () => {
  let component: SleepDetectorEnableSleepModeModalComponent;
  let fixture: ComponentFixture<SleepDetectorEnableSleepModeModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SleepDetectorEnableSleepModeModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SleepDetectorEnableSleepModeModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
