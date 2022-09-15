import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OscScriptModalComponent } from './osc-script-modal.component';

describe('OscScriptModalComponent', () => {
  let component: OscScriptModalComponent;
  let fixture: ComponentFixture<OscScriptModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ OscScriptModalComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(OscScriptModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
