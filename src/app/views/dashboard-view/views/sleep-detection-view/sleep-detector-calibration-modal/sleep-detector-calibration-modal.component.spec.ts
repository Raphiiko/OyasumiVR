import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SleepDetectorCalibrationModalComponent } from './sleep-detector-calibration-modal.component';

describe('TimeEnableSleepmodeModalComponent', () => {
  let component: SleepDetectorCalibrationModalComponent;
  let fixture: ComponentFixture<SleepDetectorCalibrationModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SleepDetectorCalibrationModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SleepDetectorCalibrationModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
