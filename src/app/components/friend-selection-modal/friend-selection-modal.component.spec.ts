import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FriendSelectionModalComponent } from './friend-selection-modal.component';

describe('FriendSelectionModalComponent', () => {
  let component: FriendSelectionModalComponent;
  let fixture: ComponentFixture<FriendSelectionModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [FriendSelectionModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FriendSelectionModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
