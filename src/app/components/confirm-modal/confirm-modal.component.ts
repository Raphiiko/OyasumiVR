import { Component, OnInit } from '@angular/core';
import { BaseModalComponent } from 'src/app/components/base-modal/base-modal.component';
import { fadeUp } from 'src/app/utils/animations';
import { TString } from '../../models/translatable-string';

export interface ConfirmModalInputModel {
  title?: TString;
  message?: TString;
  confirmButtonText?: TString;
  cancelButtonText?: TString;
  showCancel?: boolean;
}

export interface ConfirmModalOutputModel {
  confirmed: boolean;
}

@Component({
  selector: 'app-confirm-modal',
  templateUrl: './confirm-modal.component.html',
  styleUrls: ['./confirm-modal.component.scss'],
  animations: [fadeUp()],
})
export class ConfirmModalComponent
  extends BaseModalComponent<ConfirmModalInputModel, ConfirmModalOutputModel>
  implements OnInit, ConfirmModalInputModel
{
  title?: TString;
  message?: TString;
  confirmButtonText?: TString;
  cancelButtonText?: TString;
  showCancel?: boolean;

  constructor() {
    super();
    this.result = { confirmed: false };
  }

  ngOnInit(): void {
    if (this.showCancel === undefined) this.showCancel = true;
  }

  async cancel() {
    await this.close();
  }

  async confirm() {
    this.result = { confirmed: true };
    await this.close();
  }
}
