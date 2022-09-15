import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { OscScript } from '../../models/osc-script';
import { filter } from 'rxjs';
import { SimpleModalService } from 'ngx-simple-modal';
import { OscScriptModalComponent } from '../osc-script-modal/osc-script-modal.component';

@Component({
  selector: 'app-osc-script-button',
  templateUrl: './osc-script-button.component.html',
  styleUrls: ['./osc-script-button.component.scss'],
})
export class OscScriptButtonComponent implements OnInit {
  @Input() label: string = '';
  @Input() script?: OscScript;
  @Output() scriptChange = new EventEmitter<OscScript>();

  constructor(private modalService: SimpleModalService) {}

  ngOnInit(): void {
    // TODO: REMOVE, ONLY FOR DEBUGGING
    if (this.label === 'Upright') this.editScript();
  }

  isSet() {
    return !!this.script;
  }

  editScript() {
    this.modalService
      .addModal(OscScriptModalComponent, {
        scriptName: this.label,
        script: this.script,
      })
      .pipe(filter((data) => !!data))
      .subscribe((data) => {
        this.script = data.script;
        this.scriptChange.emit(this.script);
      });
  }
}
