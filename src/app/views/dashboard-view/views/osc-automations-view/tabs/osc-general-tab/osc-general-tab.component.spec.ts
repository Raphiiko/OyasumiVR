import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OscGeneralTabComponent } from './osc-general-tab.component';

describe('OscGeneralTabComponent', () => {
  let component: OscGeneralTabComponent;
  let fixture: ComponentFixture<OscGeneralTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ OscGeneralTabComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(OscGeneralTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
