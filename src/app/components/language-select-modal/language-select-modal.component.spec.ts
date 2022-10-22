import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LanguageSelectModalComponent } from './language-select-modal.component';

describe('LanguageSelectModalComponent', () => {
  let component: LanguageSelectModalComponent;
  let fixture: ComponentFixture<LanguageSelectModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [LanguageSelectModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(LanguageSelectModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
