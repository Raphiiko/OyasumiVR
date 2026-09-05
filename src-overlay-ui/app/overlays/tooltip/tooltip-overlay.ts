import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  OnInit,
} from '@angular/core';
import { IpcService } from '../../ipc/ipc.service';

@Component({
  selector: 'app-tooltip-overlay',
  templateUrl: './tooltip-overlay.html',
  styleUrl: './tooltip-overlay.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TooltipOverlay implements OnInit {
  private readonly ipc = inject(IpcService);

  protected readonly shown = computed(() => !!this.ipc.tooltip());
  // Retained while fading out, so the card does not blank before it has gone.
  protected readonly text = linkedSignal<string | null, string>({
    source: () => this.ipc.tooltip(),
    computation: (tooltip, previous) => tooltip ?? previous?.value ?? '',
  });

  ngOnInit(): void {
    void window.OyasumiIPCOut.onUiReady();
  }
}
