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
  activeTab: 'SIMPLE' | 'SCRIPT' = 'SCRIPT';

  constructor() {
    super();
  }

  ngOnInit(): void {
    if (!this.script) {
      this.script = {
        commands: [],
      };
    }
  }

  save() {

  }
}
