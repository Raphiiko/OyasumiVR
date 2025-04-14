import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
    selector: 'app-color-picker',
    templateUrl: './color-picker.component.html',
    styleUrls: ['./color-picker.component.scss'],
    standalone: false
})
export class ColorPickerComponent {
  @Input() public title?: string;
  @Input() public disabled = false;
  protected _color: [number, number, number] = [255, 255, 255];
  public get color(): [number, number, number] {
    return this._color;
  }

  @Input()
  public set color(value: [number, number, number]) {
    this._color = value;
    this.hexValue = this.rgbToHex(value);
  }

  @Output() public colorChange = new EventEmitter<[number, number, number]>();
  protected hexValue = '#ffffff';

  constructor() {}

  protected get cssColor(): string {
    return `rgb(${this.color[0]}, ${this.color[1]}, ${this.color[2]})`;
  }

  onColorChange(value: string) {
    this.color = this.hexToRgb(value);
    this.colorChange.emit(this.color);
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
