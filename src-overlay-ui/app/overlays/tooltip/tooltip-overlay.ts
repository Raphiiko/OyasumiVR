import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { IpcService } from '../../ipc/ipc.service';

@Component({
  selector: 'app-tooltip-overlay',
  templateUrl: './tooltip-overlay.html',
  styleUrl: './tooltip-overlay.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TooltipOverlay implements OnInit {
  private readonly ipc = inject(IpcService);

  protected readonly tooltip = this.ipc.tooltip;

  ngOnInit(): void {
    void window.OyasumiIPCOut.onUiReady();
  }
}
