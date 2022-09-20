import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OscScriptButtonComponent } from './osc-script-button.component';

describe('OscScriptButtonComponent', () => {
  let component: OscScriptButtonComponent;
  let fixture: ComponentFixture<OscScriptButtonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [OscScriptButtonComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(OscScriptButtonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
