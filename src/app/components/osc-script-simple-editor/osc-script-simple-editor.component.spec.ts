import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OscScriptSimpleEditorComponent } from './osc-script-simple-editor.component';

describe('OscScriptSimpleEditorComponent', () => {
  let component: OscScriptSimpleEditorComponent;
  let fixture: ComponentFixture<OscScriptSimpleEditorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [OscScriptSimpleEditorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(OscScriptSimpleEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
