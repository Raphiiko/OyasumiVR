import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OscAutomationsViewComponent } from './osc-automations-view.component';

describe('OscAutomationsViewComponent', () => {
  let component: OscAutomationsViewComponent;
  let fixture: ComponentFixture<OscAutomationsViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ OscAutomationsViewComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(OscAutomationsViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
