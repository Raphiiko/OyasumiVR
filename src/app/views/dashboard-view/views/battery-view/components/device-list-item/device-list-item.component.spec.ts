import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DeviceListItemComponent } from './device-list-item.component';

describe('DeviceListItemComponent', () => {
  let component: DeviceListItemComponent;
  let fixture: ComponentFixture<DeviceListItemComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [DeviceListItemComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DeviceListItemComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
