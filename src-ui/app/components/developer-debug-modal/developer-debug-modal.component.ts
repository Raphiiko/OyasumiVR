import { AfterViewInit, Component, DestroyRef, OnInit } from '@angular/core';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { fadeUp } from 'src-ui/app/utils/animations';
import { DeveloperDebugService } from '../../services/developer-debug/developer-debug.service';
import { AutomationConfigService } from '../../services/automation-config.service';

@Component({
  selector: 'app-debug-modal',
  templateUrl: './developer-debug-modal.component.html',
  styleUrls: ['./developer-debug-modal.component.scss'],
  animations: [fadeUp()],
})
export class DeveloperDebugModalComponent
  extends BaseModalComponent<any, any>
  implements OnInit, AfterViewInit
{
  protected activeTab = 'BRIGHTNESS_TESTING';

  constructor(
    public debug: DeveloperDebugService,
    private destroyRef: DestroyRef,
    private automationConfigService: AutomationConfigService
  ) {
    super();
  }

  ngOnInit() {}

  ngAfterViewInit() {}
}
