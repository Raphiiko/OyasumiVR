import { Component, OnInit } from '@angular/core';
import { UpdateManifest } from '@tauri-apps/api/updater';
import { SimpleModalComponent } from 'ngx-simple-modal';
import { UpdateService } from '../../services/update.service';
import { fadeUp, hshrink } from '../../utils/animations';
import { getVersion } from '../../utils/app-utils';

interface UpdateModalInputModel {
  manifest?: UpdateManifest;
}

interface UpdateModalOutputModel {}

@Component({
  selector: 'app-update-modal',
  templateUrl: './update-modal.component.html',
  styleUrls: ['./update-modal.component.scss'],
  animations: [hshrink(), fadeUp()],
})
export class UpdateModalComponent
  extends SimpleModalComponent<UpdateModalInputModel, UpdateModalOutputModel>
  implements OnInit, UpdateModalInputModel
{
  manifest?: UpdateManifest;
  currentVersion: string = '';
  installing: boolean = false;

  constructor(private update: UpdateService) {
    super();
  }

  async ngOnInit() {
    this.currentVersion = await getVersion();
  }

  async updateLater() {
    if (!this.installing) {
      await this.close();
    }
  }

  async install() {
    this.installing = true;
    await this.update.installUpdate();
  }
}
