import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  OnDestroy,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { throttle } from 'lodash';
import { BrightnessSliders } from '../../../components/brightness-sliders/brightness-sliders';
import { ColorTempSlider } from '../../../components/color-temp-slider/color-temp-slider';
import { Tooltip } from '../../../directives/tooltip';
import { IpcService } from '../../../ipc/ipc.service';

type SliderMode = 'BRIGHTNESS' | 'COLOR_TEMP';

@Component({
  selector: 'app-dashboard-overview',
  imports: [BrightnessSliders, ColorTempSlider, Tooltip, TranslocoPipe],
  templateUrl: './overview.html',
  styleUrl: './overview.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Overview implements OnDestroy {
  private readonly ipc = inject(IpcService);

  readonly shutdownSequenceDisabled = input(true);
  readonly navigate = output<'AUTOMATIONS' | 'DEVICE_CONTROL'>();
  readonly openShutdownSequence = output<void>();
  readonly closeDashboard = output<void>();

  readonly state = this.ipc.state;
  readonly vrcLoggedIn = this.ipc.vrcLoggedIn;
  readonly cctState = computed(() => this.state().cctState);
  readonly sleepPreparationEnabled = computed(() => {
    const state = this.state();
    return state.sleepPreparationAvailable && !state.sleepPreparationTimedOut && !state.sleepMode;
  });

  private readonly now = signal(new Date());
  readonly timeHours = computed(() => this.pad(this.now().getHours()));
  readonly timeMinutes = computed(() => this.pad(this.now().getMinutes()));

  readonly sliderMode = signal<SliderMode>('BRIGHTNESS');
  readonly sliderModeButtonMode = computed<SliderMode>(() =>
    this.sliderMode() === 'BRIGHTNESS' ? 'COLOR_TEMP' : 'BRIGHTNESS'
  );

  readonly setColorTemperature = throttle(
    (value: number) => void this.ipc.setColorTemperature(value),
    16,
    { leading: true, trailing: true }
  );

  private readonly clock = setInterval(() => this.now.set(new Date()), 1000);

  constructor() {
    effect(() => {
      if (this.state().cctState?.enabled) return;
      this.sliderMode.set('BRIGHTNESS');
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.clock);
  }

  toggleSleepMode(): void {
    const mode = !this.state().sleepMode;
    void this.ipc.setSleepMode(mode);
    if (mode) setTimeout(() => this.closeDashboard.emit(), 500);
  }

  prepareForSleep(): void {
    if (this.sleepPreparationEnabled()) void this.ipc.prepareForSleep();
  }

  requestShutdownSequence(): void {
    if (!this.shutdownSequenceDisabled()) this.openShutdownSequence.emit();
  }

  private pad(value: number): string {
    return value.toString().padStart(2, '0');
  }
}
