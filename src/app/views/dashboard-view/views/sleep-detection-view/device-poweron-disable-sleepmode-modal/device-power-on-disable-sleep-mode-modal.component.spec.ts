import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DevicePowerOnDisableSleepModeModalComponent } from './device-power-on-disable-sleep-mode-modal.component';

describe('TimeEnableSleepmodeModalComponent', () => {
  let component: DevicePowerOnDisableSleepModeModalComponent;
  let fixture: ComponentFixture<DevicePowerOnDisableSleepModeModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ DevicePowerOnDisableSleepModeModalComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DevicePowerOnDisableSleepModeModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
