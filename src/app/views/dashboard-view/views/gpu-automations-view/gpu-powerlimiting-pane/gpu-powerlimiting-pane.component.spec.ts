import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GpuPowerlimitingPaneComponent } from './gpu-powerlimiting-pane.component';

describe('GpuPowerlimitingPaneComponent', () => {
  let component: GpuPowerlimitingPaneComponent;
  let fixture: ComponentFixture<GpuPowerlimitingPaneComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [GpuPowerlimitingPaneComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(GpuPowerlimitingPaneComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
