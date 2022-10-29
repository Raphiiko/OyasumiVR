import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StatusAutomationsViewComponent } from './status-automations-view.component';

describe('StatusAutomationsViewComponent', () => {
  let component: StatusAutomationsViewComponent;
  let fixture: ComponentFixture<StatusAutomationsViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [StatusAutomationsViewComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(StatusAutomationsViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
