import { Component, OnInit } from '@angular/core';
import { UpdateManifest } from '@tauri-apps/api/updater';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { UpdateService } from '../../services/update.service';
import { fadeUp, hshrink } from '../../utils/animations';
import { getVersion } from '../../utils/app-utils';
import { FLAVOUR } from '../../../build';

interface UpdateModalInputModel {
  manifest?: UpdateManifest;
}

interface UpdateModalOutputModel {}

@Component({
    selector: 'app-update-modal',
    templateUrl: './update-modal.component.html',
    styleUrls: ['./update-modal.component.scss'],
    animations: [hshrink(), fadeUp()],
    standalone: false
})
export class UpdateModalComponent
  extends BaseModalComponent<UpdateModalInputModel, UpdateModalOutputModel>
  implements OnInit, UpdateModalInputModel
{
  manifest?: UpdateManifest;
  currentVersion = '';
  installing = false;

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

  protected readonly FLAVOUR = FLAVOUR;
}
