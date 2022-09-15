import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SleepingPoseViewerComponent } from './sleeping-pose-viewer.component';

describe('ModelViewerComponent', () => {
  let component: SleepingPoseViewerComponent;
  let fixture: ComponentFixture<SleepingPoseViewerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SleepingPoseViewerComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SleepingPoseViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
