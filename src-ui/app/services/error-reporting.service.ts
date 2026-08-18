import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import * as Sentry from '@sentry/angular';
import { distinctUntilChanged, map } from 'rxjs';
import { FLAVOUR } from '../../build';
import { environment } from '../../environments/environment';
import { getVersion } from '../utils/app-utils';
import { TelemetryService } from './telemetry.service';

const DSN = 'https://a08e4e04b7a24cafb5eb6c4ff701e52e@sentry.raphii.co/1';

@Injectable({ providedIn: 'root' })
export class ErrorReportingService {
  private active = false;
  private update = Promise.resolve();

  constructor(private telemetry: TelemetryService) {}

  init() {
    this.telemetry.settings
      .pipe(
        map((settings) => settings.enabled),
        distinctUntilChanged()
      )
      .subscribe((enabled) => {
        this.update = this.update.then(() => this.setEnabled(enabled)).catch(() => {});
      });
  }

  private async setEnabled(consented: boolean) {
    const enabled = consented && environment.production && FLAVOUR !== 'DEV';
    if (enabled === this.active) return;
    this.active = enabled;
    if (!enabled) {
      await Sentry.close(0).catch(() => false);
      return;
    }
    try {
      const version = await getVersion();
      Sentry.init({
        dsn: DSN,
        release: version,
        sampleRate: 0.5,
        sendDefaultPii: false,
        sendClientReports: false,
        enableLogs: false,
        enableMetrics: false,
        maxBreadcrumbs: 0,
        transportOptions: { bufferSize: 2 },
        beforeBreadcrumb: () => null,
        integrations: (defaults) =>
          defaults.filter(
            (integration) => !['Breadcrumbs', 'BrowserSession'].includes(integration.name)
          ),
        beforeSend: async (event) => {
          if (!this.active || isExpected(event)) return null;
          const issue = issueKey(event);
          sanitize(event, version);
          return (await invoke<boolean>('allow_ui_event', { issue }).catch(() => false))
            ? event
            : null;
        },
      });
    } catch {
      this.active = false;
    }
  }
}

function isExpected(event: Sentry.ErrorEvent): boolean {
  const exception = event.exception?.values?.[0];
  const text =
    `${exception?.type ?? ''} ${exception?.value ?? ''} ${event.message ?? ''}`.toLowerCase();
  return (
    text.includes('aborterror') ||
    text.includes('cancelederror') ||
    text.includes('cancellederror') ||
    text.includes('resizeobserver loop') ||
    text.includes('the operation was aborted')
  );
}

function issueKey(event: Sentry.ErrorEvent): string {
  const exception = event.exception?.values?.[0];
  const frame = exception?.stacktrace?.frames?.at(-1);
  return [exception?.type ?? 'error', frame?.filename ?? '', frame?.function ?? '']
    .join(':')
    .slice(0, 512);
}

function sanitize(event: Sentry.ErrorEvent, version: string) {
  event.user = undefined;
  event.request = undefined;
  event.breadcrumbs = [];
  event.extra = undefined;
  event.modules = undefined;
  event.transaction = undefined;
  event.contexts = {
    os: { name: 'Windows' },
    runtime: { name: 'WebView2' },
  };
  event.tags = { component: 'ui', platform: 'windows', app_version: version };
  if (event.message) event.message = 'ui error';
  for (const exception of event.exception?.values ?? []) {
    exception.value = exception.type ?? 'ui error';
    for (const frame of exception.stacktrace?.frames ?? []) {
      frame.abs_path = undefined;
      frame.vars = undefined;
      frame.pre_context = undefined;
      frame.context_line = undefined;
      frame.post_context = undefined;
      if (frame.filename) frame.filename = safeFilename(frame.filename);
    }
  }
}

function safeFilename(value: string): string {
  return value.replaceAll('\\', '/').split('/').at(-1)?.split('?')[0] ?? '';
}
