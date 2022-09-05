import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SleepDetectionViewComponent } from './sleep-detection-view.component';

describe('SleepDetectionViewComponent', () => {
  let component: SleepDetectionViewComponent;
  let fixture: ComponentFixture<SleepDetectionViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SleepDetectionViewComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SleepDetectionViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
