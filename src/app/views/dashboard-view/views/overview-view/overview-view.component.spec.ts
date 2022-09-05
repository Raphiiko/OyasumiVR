import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OverviewViewComponent } from './overview-view.component';

describe('OverviewViewComponent', () => {
  let component: OverviewViewComponent;
  let fixture: ComponentFixture<OverviewViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [OverviewViewComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(OverviewViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
