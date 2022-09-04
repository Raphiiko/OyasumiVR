import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TimeDisableSleepModeModalComponent } from './time-disable-sleep-mode-modal.component';

describe('TimeEnableSleepmodeModalComponent', () => {
  let component: TimeDisableSleepModeModalComponent;
  let fixture: ComponentFixture<TimeDisableSleepModeModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ TimeDisableSleepModeModalComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TimeDisableSleepModeModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
