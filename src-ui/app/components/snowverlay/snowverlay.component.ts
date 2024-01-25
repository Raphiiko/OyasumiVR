import { Component } from '@angular/core';

@Component({
  selector: 'app-snowverlay',
  templateUrl: './snowverlay.component.html',
  styleUrls: ['./snowverlay.component.scss'],
})
export class SnowverlayComponent {
  protected readonly flakes = new Array(100).fill(0);
}
