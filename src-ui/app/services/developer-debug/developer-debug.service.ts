import { Injectable } from '@angular/core';
import { SleepDetectionDebugger } from './sleep-detection-debugger';

@Injectable({
  providedIn: 'root',
})
export class DeveloperDebugService {
  public sleepDetectionDebugger = new SleepDetectionDebugger();

  constructor() {}

  async init() {}
}
