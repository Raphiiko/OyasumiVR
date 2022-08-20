import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BatterySettingsComponent } from './battery-settings.component';

describe('BatterySettingsComponent', () => {
  let component: BatterySettingsComponent;
  let fixture: ComponentFixture<BatterySettingsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [BatterySettingsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(BatterySettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
