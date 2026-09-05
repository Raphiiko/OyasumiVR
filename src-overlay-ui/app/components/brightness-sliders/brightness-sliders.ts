import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { throttle } from 'lodash';
import { IpcService } from '../../ipc/ipc.service';
import { BrightnessSlider } from '../brightness-slider/brightness-slider';

@Component({
  selector: 'app-brightness-sliders',
  templateUrl: './brightness-sliders.html',
  styleUrl: './brightness-sliders.scss',
  imports: [BrightnessSlider, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrightnessSliders {
  private readonly ipc = inject(IpcService);

  readonly brightnessState = computed(() => this.ipc.state().brightnessState);

  readonly setSimpleBrightness = throttle(
    (value: number) => void this.ipc.setBrightness('SIMPLE', value),
    16,
    { leading: true, trailing: true }
  );

  readonly setSoftwareBrightness = throttle(
    (value: number) => void this.ipc.setBrightness('SOFTWARE', value),
    16,
    { leading: true, trailing: true }
  );

  readonly setHardwareBrightness = throttle(
    (value: number) => void this.ipc.setBrightness('HARDWARE', value),
    16,
    { leading: true, trailing: true }
  );
}
