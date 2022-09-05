import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PowerLimitInputComponent } from './power-limit-input.component';

describe('PowerLimitInputComponent', () => {
  let component: PowerLimitInputComponent;
  let fixture: ComponentFixture<PowerLimitInputComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [PowerLimitInputComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PowerLimitInputComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
