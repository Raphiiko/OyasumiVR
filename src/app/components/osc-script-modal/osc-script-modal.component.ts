import { Component, OnInit } from '@angular/core';
import { SimpleModalComponent } from 'ngx-simple-modal';
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
})
export class OscScriptModalComponent
  extends SimpleModalComponent<OscScriptModalInputModel, OscScriptModalOutputModel>
  implements OnInit, OscScriptModalInputModel
{
  script?: OscScript;
  scriptName?: string;
  activeTab: 'SIMPLE' | 'SCRIPT' = 'SIMPLE';
  errorCount = 0;
  validated = true;

  constructor() {
    super();
  }

  ngOnInit(): void {
    if (!this.script) {
      this.script = {
        version: 1,
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
    setTimeout(() => (this.errorCount = errorCount));
  }

  setValidated(validated: boolean) {
    setTimeout(() => (this.validated = validated));
  }
}
