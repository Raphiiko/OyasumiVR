import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BatteryAutomationsViewComponent } from './battery-automations-view.component';

describe('BatteryViewComponent', () => {
  let component: BatteryAutomationsViewComponent;
  let fixture: ComponentFixture<BatteryAutomationsViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [BatteryAutomationsViewComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(BatteryAutomationsViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
