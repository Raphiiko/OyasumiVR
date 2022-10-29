import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VRChatLoginModalComponent } from './vrchat-login-modal.component';

describe('VrchatLoginModalComponent', () => {
  let component: VRChatLoginModalComponent;
  let fixture: ComponentFixture<VRChatLoginModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [VRChatLoginModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(VRChatLoginModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
