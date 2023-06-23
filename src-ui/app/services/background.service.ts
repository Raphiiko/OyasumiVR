import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class BackgroundService {
  private _background: BehaviorSubject<string | null> = new BehaviorSubject<string | null>(null);
  public background: Observable<string | null> = this._background.asObservable();

  constructor() {}

  setBackground(url: string | null) {
    this._background.next(url);
  }
}
