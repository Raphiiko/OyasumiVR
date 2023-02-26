import { Component, OnInit } from '@angular/core';
import { SimpleModalComponent } from 'ngx-simple-modal';
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
  extends SimpleModalComponent<ConfirmModalInputModel, ConfirmModalOutputModel>
  implements OnInit, ConfirmModalInputModel
{
  title?: TString;
  message?: TString;
  confirmButtonText?: TString;
  cancelButtonText?: TString;
  showCancel?: boolean;

  constructor() {
    super();
  }

  ngOnInit(): void {
    if (this.showCancel === undefined) this.showCancel = true;
  }

  async cancel() {
    this.result = { confirmed: false };
    await this.close();
  }

  async confirm() {
    this.result = { confirmed: true };
    await this.close();
  }
}
