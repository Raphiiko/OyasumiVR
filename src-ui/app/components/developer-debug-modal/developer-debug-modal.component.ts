import { AfterViewInit, Component, OnInit } from '@angular/core';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { fadeUp } from 'src-ui/app/utils/animations';
import { DeveloperDebugService } from '../../services/developer-debug/developer-debug.service';

@Component({
    selector: 'app-debug-modal',
    templateUrl: './developer-debug-modal.component.html',
    styleUrls: ['./developer-debug-modal.component.scss'],
    animations: [fadeUp()],
    standalone: false
})
export class DeveloperDebugModalComponent
  extends BaseModalComponent<any, any>
  implements OnInit, AfterViewInit
{
  protected activeTab = 'MISC_TESTING';

  constructor(public debug: DeveloperDebugService) {
    super();
  }

  ngOnInit() {}

  ngAfterViewInit() {}
}
