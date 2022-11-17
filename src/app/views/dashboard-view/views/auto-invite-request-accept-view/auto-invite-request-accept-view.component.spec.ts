import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AutoInviteRequestAcceptViewComponent } from './auto-invite-request-accept-view.component';

describe('AutoInviteRequestAcceptViewComponent', () => {
  let component: AutoInviteRequestAcceptViewComponent;
  let fixture: ComponentFixture<AutoInviteRequestAcceptViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ AutoInviteRequestAcceptViewComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AutoInviteRequestAcceptViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
