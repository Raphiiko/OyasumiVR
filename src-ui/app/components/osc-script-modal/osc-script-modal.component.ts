import {
  ChangeDetectorRef,
  Component,
  inject,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { OscScript } from '../../models/osc-script';
import { fadeUp } from '../../utils/animations';

interface OscScriptModalInputModel {
  script?: OscScript;
  scriptName?: string;
}

interface OscScriptModalOutputModel {
  script?: OscScript;
}

@Component({
  selector: 'app-osc-script-modal',
  templateUrl: './osc-script-modal.component.html',
  styleUrls: ['./osc-script-modal.component.scss'],
  animations: [fadeUp()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class OscScriptModalComponent
  extends BaseModalComponent<OscScriptModalInputModel, OscScriptModalOutputModel>
  implements OnInit, OscScriptModalInputModel
{
  script?: OscScript;
  scriptName?: string;
  activeTab: 'SIMPLE' | 'SCRIPT' = 'SIMPLE';
  errorCount = 0;
  validated = true;

  private cdr = inject(ChangeDetectorRef);

  constructor() {
    super();
  }

  ngOnInit(): void {
    if (!this.script) {
      this.script = {
        version: 3,
        commands: [],
      };
    }
  }

  async save() {
    this.result = {
      script: this.script,
    };
    await this.close();
  }

  setErrorCount(errorCount: number) {
    setTimeout(() => {
      this.errorCount = errorCount;
      this.cdr.markForCheck();
    });
  }

  setValidated(validated: boolean) {
    setTimeout(() => {
      this.validated = validated;
      this.cdr.markForCheck();
    });
  }
}
