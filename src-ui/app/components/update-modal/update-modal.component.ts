import { Component, OnInit } from '@angular/core';
import { Update } from '@tauri-apps/plugin-updater';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { UpdateService } from '../../services/update.service';
import { fadeUp, hshrink } from '../../utils/animations';
import { getVersion } from '../../utils/app-utils';
import { FLAVOUR } from '../../../build';

interface UpdateModalInputModel {
  update?: Update;
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
  update?: Update;
  currentVersion = '';
  installing = false;

  constructor(private updateService: UpdateService) {
    super();
  }

  async ngOnInit() {
    this.currentVersion = await getVersion();
  }

  async updateLater() {
    if (!this.installing) {
      this.close();
    }
  }

  async install() {
    this.installing = true;
    await this.updateService.installUpdate();
  }

  protected readonly FLAVOUR = FLAVOUR;
}
