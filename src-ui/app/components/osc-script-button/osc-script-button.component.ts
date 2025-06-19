import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { OscScript } from '../../models/osc-script';
import { filter } from 'rxjs';
import { ModalService } from 'src-ui/app/services/modal.service';
import { OscScriptModalComponent } from '../osc-script-modal/osc-script-modal.component';

@Component({
  selector: 'app-osc-script-button',
  templateUrl: './osc-script-button.component.html',
  styleUrls: ['./osc-script-button.component.scss'],
  standalone: false,
})
export class OscScriptButtonComponent implements OnInit {
  @Input() label = '';
  @Input() script?: OscScript;
  @Output() scriptChange = new EventEmitter<OscScript>();

  constructor(private modalService: ModalService) {}

  ngOnInit(): void {}

  isSet() {
    return !!this.script;
  }

  editScript() {
    this.modalService
      .addModal(
        OscScriptModalComponent,
        {
          scriptName: this.label,
          script: this.script,
        },
        {
          closeOnEscape: false,
        }
      )
      .pipe(filter((data) => !!data))
      .subscribe((data) => {
        this.script = data?.script?.commands?.length ? data.script : undefined;
        this.scriptChange.emit(this.script);
      });
  }
}
