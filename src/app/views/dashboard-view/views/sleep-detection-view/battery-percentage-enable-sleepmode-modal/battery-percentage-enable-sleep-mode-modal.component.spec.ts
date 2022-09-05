import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BatteryPercentageEnableSleepModeModalComponent } from './battery-percentage-enable-sleep-mode-modal.component';

describe('TimeEnableSleepmodeModalComponent', () => {
  let component: BatteryPercentageEnableSleepModeModalComponent;
  let fixture: ComponentFixture<BatteryPercentageEnableSleepModeModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [BatteryPercentageEnableSleepModeModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(BatteryPercentageEnableSleepModeModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
