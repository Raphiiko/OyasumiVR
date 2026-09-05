import { ChangeDetectorRef, Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class UpdateModalComponent
  extends BaseModalComponent<UpdateModalInputModel, UpdateModalOutputModel>
  implements OnInit, UpdateModalInputModel
{
  update?: Update;
  currentVersion = '';
  get installing() {
    return this.updateService.installing();
  }

  constructor(
    private updateService: UpdateService,
    private cdr: ChangeDetectorRef
  ) {
    super();
  }

  async ngOnInit() {
    this.currentVersion = await getVersion();
    this.cdr.markForCheck();
  }

  async updateLater() {
    if (!this.installing) {
      this.close();
    }
  }

  async install() {
    if (this.installing) return;
    try {
      await this.updateService.installUpdate();
    } finally {
      this.cdr.markForCheck();
    }
  }

  protected readonly FLAVOUR = FLAVOUR;
}
