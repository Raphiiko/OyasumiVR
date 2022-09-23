import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UpdateModalComponent } from './update-modal.component';

describe('UpdateModalComponent', () => {
  let component: UpdateModalComponent;
  let fixture: ComponentFixture<UpdateModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ UpdateModalComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UpdateModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
