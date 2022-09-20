import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OscScriptCodeEditorComponent } from './osc-script-code-editor.component';

describe('OscScriptCodeEditorComponent', () => {
  let component: OscScriptCodeEditorComponent;
  let fixture: ComponentFixture<OscScriptCodeEditorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [OscScriptCodeEditorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(OscScriptCodeEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
