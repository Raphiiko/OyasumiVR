import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SleepingAnimationPresetModalComponent } from './sleeping-animation-preset-modal.component';

describe('SleepingAnimationPresetModalComponent', () => {
  let component: SleepingAnimationPresetModalComponent;
  let fixture: ComponentFixture<SleepingAnimationPresetModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ SleepingAnimationPresetModalComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SleepingAnimationPresetModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
