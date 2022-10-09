import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SettingsVRChatTabComponent } from './settings-vrchat-tab.component';

describe('SettingsVrchatTabComponent', () => {
  let component: SettingsVRChatTabComponent;
  let fixture: ComponentFixture<SettingsVRChatTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SettingsVRChatTabComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsVRChatTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
