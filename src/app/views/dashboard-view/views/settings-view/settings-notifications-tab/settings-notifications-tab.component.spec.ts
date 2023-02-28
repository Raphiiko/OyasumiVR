import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SettingsNotificationsTabComponent } from './settings-notifications-tab.component';

describe('SettingsVrchatTabComponent', () => {
  let component: SettingsNotificationsTabComponent;
  let fixture: ComponentFixture<SettingsNotificationsTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SettingsNotificationsTabComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsNotificationsTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
