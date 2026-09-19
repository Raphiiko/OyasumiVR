import {
  ChangeDetectorRef,
  Component,
  OnInit,
  ChangeDetectionStrategy,
  Input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslocoModule } from '@jsverse/transloco';
import { TooltipDirective } from '../../directives/tooltip.directive';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getVersion } from '../../utils/app-utils';
import { BUILD_ID, FLAVOUR } from '../../../build';
import { MessageCenterService } from '../../services/message-center/message-center.service';
import { fade } from '../../utils/animations';

@Component({
  selector: 'app-window-titlebar',
  templateUrl: './window-titlebar.component.html',
  styleUrls: ['./window-titlebar.component.scss'],
  standalone: true,
  imports: [CommonModule, TranslocoModule, TooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [fade()],
})
export class WindowTitlebarComponent implements OnInit {
  @Input() messageCenterEnabled = true;
  version = '0.0.0';
  showVersionExtras = false;

  constructor(
    protected messageCenter: MessageCenterService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    this.version = await getVersion();
    this.cdr.markForCheck();
  }

  async minimize() {
    await getCurrentWebviewWindow().minimize();
  }

  async maximize() {
    await getCurrentWebviewWindow().toggleMaximize();
  }

  async close() {
    await getCurrentWebviewWindow().close();
  }

  protected readonly FLAVOUR = FLAVOUR;
  protected readonly BUILD_ID = BUILD_ID;
}
