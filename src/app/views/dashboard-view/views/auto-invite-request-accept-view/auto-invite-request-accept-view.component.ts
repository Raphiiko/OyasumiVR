import { Component, OnInit } from '@angular/core';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';
import { TString } from '../../../../models/translatable-string';
import { SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-auto-invite-request-accept-view',
  templateUrl: './auto-invite-request-accept-view.component.html',
  styleUrls: ['./auto-invite-request-accept-view.component.scss'],
})
export class AutoInviteRequestAcceptViewComponent implements OnInit {
  listModeOptions: SelectBoxItem[] = [
    {
      id: 'DISABLED',
      label: 'Disabled',
      subLabel: 'Accept from everyone',
    },
    {
      id: 'WHITELIST',
      label: 'Whitelist',
      subLabel: 'Accept from friends on the list',
    },
    {
      id: 'BLACKLIST',
      label: 'Blacklist',
      subLabel: 'Accept from friends not on the list',
    },
  ];

  constructor() {}

  ngOnInit(): void {}
}
