import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MsiAfterburnerPaneComponent } from './msi-afterburner-pane.component';

describe('MsiAfterburnerPaneComponent', () => {
  let component: MsiAfterburnerPaneComponent;
  let fixture: ComponentFixture<MsiAfterburnerPaneComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [MsiAfterburnerPaneComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MsiAfterburnerPaneComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
