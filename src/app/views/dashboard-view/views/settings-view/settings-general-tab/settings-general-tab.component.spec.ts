import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SettingsGeneralTabComponent } from './settings-general-tab.component';

describe('SettingsGeneralTabComponent', () => {
  let component: SettingsGeneralTabComponent;
  let fixture: ComponentFixture<SettingsGeneralTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ SettingsGeneralTabComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SettingsGeneralTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
