import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BatteryViewComponent } from './battery-view.component';

describe('BatteryViewComponent', () => {
  let component: BatteryViewComponent;
  let fixture: ComponentFixture<BatteryViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [BatteryViewComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(BatteryViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
