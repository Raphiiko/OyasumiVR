import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SettingsDebugTabComponent } from './settings-debug-tab.component';

describe('SettingsDebugTabComponent', () => {
  let component: SettingsDebugTabComponent;
  let fixture: ComponentFixture<SettingsDebugTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SettingsDebugTabComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsDebugTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
