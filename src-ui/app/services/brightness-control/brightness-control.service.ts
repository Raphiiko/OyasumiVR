import { Injectable } from '@angular/core';
import { DisplayBrightnessControlService } from './display-brightness-control.service';
import { ImageBrightnessControlService } from './image-brightness-control.service';
import { CancellableTask } from '../../utils/cancellable-task';

@Injectable({
  providedIn: 'root',
})
export class BrightnessControlService {
  private _activeTransition?: CancellableTask;

  public get activeTransition() {
    return this._activeTransition;
  }
  constructor(
    private displayBrightnessControl: DisplayBrightnessControlService,
    private imageBrightnessControl: ImageBrightnessControlService
  ) {}

  public async init() {}

  cancelActiveTransition() {
    this._activeTransition?.cancel();
    this._activeTransition = undefined;
  }
}
