import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VRChatLoginTFAModalComponent } from './vrchat-login-tfa-modal.component';

describe('VrchatLoginTfaModalComponent', () => {
  let component: VRChatLoginTFAModalComponent;
  let fixture: ComponentFixture<VRChatLoginTFAModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ VRChatLoginTFAModalComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(VRChatLoginTFAModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
