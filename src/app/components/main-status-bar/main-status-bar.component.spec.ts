import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MainStatusBarComponent } from './main-status-bar.component';

describe('MainStatusBarComponent', () => {
  let component: MainStatusBarComponent;
  let fixture: ComponentFixture<MainStatusBarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ MainStatusBarComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MainStatusBarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
