import { TestBed } from '@angular/core/testing';

import { PulsoidService } from './pulsoid.service';

describe('PulsoidService', () => {
  let service: PulsoidService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PulsoidService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
