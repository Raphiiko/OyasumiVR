import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  model,
  viewChild,
} from '@angular/core';
import 'vanilla-colorful/rgb-color-picker.js';
import type { RgbColorPicker } from 'vanilla-colorful/rgb-color-picker.js';
import { SettingRowLift } from '../setting-row/setting-row-lift';

type Rgb = [number, number, number];

const PRESETS: Rgb[] = [
  [0, 0, 0],
  [255, 255, 255],
  [255, 147, 41],
  [255, 0, 0],
  [255, 80, 0],
  [255, 200, 0],
  [0, 255, 0],
  [0, 255, 200],
  [0, 160, 255],
  [0, 40, 255],
  [140, 0, 255],
  [255, 0, 140],
];

let nextPopoverId = 0;

@Component({
  selector: 'app-color-picker',
  templateUrl: './color-picker.component.html',
  styleUrls: ['./color-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ColorPickerComponent implements AfterViewInit {
  public readonly disabled = input(false);
  public readonly color = model<Rgb>([255, 255, 255]);
  protected readonly hexValue = computed(() => rgbToHex(this.color()));
  protected readonly cssColor = computed(() => `rgb(${this.color().join(', ')})`);
  protected readonly presets = PRESETS;
  protected readonly popoverId = `color-picker-${nextPopoverId++}`;

  private readonly pickerHost = viewChild.required<ElementRef<HTMLElement>>('pickerHost');
  private readonly picker = document.createElement('rgb-color-picker') as RgbColorPicker;
  private readonly lift = new SettingRowLift();

  constructor() {
    this.picker.addEventListener('color-changed', (e) => {
      const { r, g, b } = e.detail.value;
      this.color.set([r, g, b]);
    });
    effect(() => {
      const [r, g, b] = this.color();
      this.picker.color = { r, g, b };
    });
  }

  ngAfterViewInit() {
    this.pickerHost().nativeElement.append(this.picker);
  }

  /** Runs before popovertarget opens the panel, so the panel joins the top layer above the row. */
  protected raiseRow(panel: HTMLElement) {
    if (!panel.matches(':popover-open')) this.lift.raise();
  }

  protected onToggle(event: ToggleEvent, panel: HTMLElement) {
    if (event.newState === 'open') this.lift.place(panel);
    else this.lift.lower();
  }

  protected isSelected(preset: Rgb): boolean {
    return preset.every((v, i) => v === this.color()[i]);
  }

  /** Applies a typed hex value, then rewrites the field so rejected input does not linger. */
  protected setHex(field: HTMLInputElement) {
    const hex = field.value.trim().replace('#', '');
    if (/^[0-9a-f]{6}$/i.test(hex)) this.color.set(hexToRgb(hex));
    field.value = this.hexValue();
  }

  /** Applies a typed channel value clamped to 0-255, then rewrites the field to match. */
  protected setChannel(index: number, field: HTMLInputElement) {
    const channel = Math.round(Number(field.value));
    if (field.value.trim() !== '' && Number.isFinite(channel)) {
      const color = [...this.color()] as Rgb;
      color[index] = Math.min(255, Math.max(0, channel));
      this.color.set(color);
    }
    field.value = String(this.color()[index]);
  }
}

function hexToRgb(hex: string): Rgb {
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function rgbToHex(rgb: Rgb): string {
  return rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
}
