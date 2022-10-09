import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SettingsUpdatesTabComponent } from './settings-updates-tab.component';

describe('SettingsUpdatesTabComponent', () => {
  let component: SettingsUpdatesTabComponent;
  let fixture: ComponentFixture<SettingsUpdatesTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SettingsUpdatesTabComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsUpdatesTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
