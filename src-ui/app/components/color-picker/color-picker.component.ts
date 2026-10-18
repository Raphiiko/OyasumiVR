import { Component, ChangeDetectionStrategy, computed, input, model } from '@angular/core';

@Component({
  selector: 'app-color-picker',
  templateUrl: './color-picker.component.html',
  styleUrls: ['./color-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ColorPickerComponent {
  public readonly disabled = input(false);
  public readonly color = model<[number, number, number]>([255, 255, 255]);
  protected readonly hexValue = computed(() => this.rgbToHex(this.color()));

  constructor() {}

  protected get cssColor(): string {
    const color = this.color();
    return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
  }

  onColorChange(value: string) {
    this.color.set(this.hexToRgb(value));
  }

  private hexToRgb(hexColor: string): [number, number, number] {
    const hex = hexColor.replace('#', '');
    const rgbValues = [];

    for (let i = 0; i < 3; i++) {
      const colorPart = hex.slice(i * 2, i * 2 + 2);
      rgbValues.push(parseInt(colorPart, 16));
    }

    return rgbValues as [number, number, number];
  }

  private rgbToHex(rgb: [number, number, number]): string {
    const hex = ['#', ...rgb.map((value) => value.toString(16).padStart(2, '0'))];
    return hex.join('');
  }
}
