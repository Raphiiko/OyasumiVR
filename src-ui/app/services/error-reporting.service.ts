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
    return this.update;
  }

  private async setEnabled(consented: boolean) {
    const enabled = consented && environment.production && FLAVOUR !== 'DEV';
    if (enabled === this.active) return;
    this.active = enabled;
    await invoke('set_error_reporting_enabled', { enabled }).catch(() => {});
    if (!enabled) {
      await Sentry.close(0).catch(() => false);
      return;
    }
    try {
      const version = await getVersion();
      Sentry.init({
        dsn: DSN,
        release: version,
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
          sanitize(event, version);
          const issue = issueKey(event);
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
  return [
    exception?.type ?? 'error',
    exception?.value ?? event.message ?? '',
    frame?.filename ?? '',
    frame?.function ?? '',
  ]
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
  event.logentry = undefined;
  event.logger = undefined;
  event.fingerprint = undefined;
  event.threads = undefined;
  event.debug_meta = undefined;
  event.contexts = {
    os: { name: 'Windows' },
    runtime: { name: 'WebView2' },
  };
  event.tags = { component: 'ui', platform: 'windows', app_version: version };
  if (event.message) event.message = sanitizeText(event.message);
  for (const exception of event.exception?.values ?? []) {
    exception.module = undefined;
    if (exception.mechanism) exception.mechanism.data = undefined;
    if (exception.value) exception.value = sanitizeText(exception.value);
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

function sanitizeText(value: string): string {
  return value
    .replace(
      /\bauthorization\s*[:=]\s*\S+(?:\s+\S+)?/gi,
      '[redacted]'
    )
    .replace(/\bbearer\s+\S+/gi, '[redacted]')
    .replace(/(token|password|secret|api[_-]?key)\s*[:=]?\s*\S+/gi, '[redacted]')
    .replace(/\b(user(name)?|display\s*name|account\s*id)\s*[:=]\s*\S+/gi, '[redacted]')
    .replace(/"[a-z]:\\[^"\r\n]+"/gi, '[redacted]')
    .replace(/\b[a-z]:\\[^\r\n]+/gi, '[redacted]')
    .replace(/https?:\/\/\S+/gi, '[redacted]')
    .replace(/\b(device\s*)?serial(\s*number)?\s*[:=]\s*\S+/gi, '[redacted]')
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, '[redacted]')
    .replace(/\b(?:usr|auth|file|avtr|wrld|grp)_[a-z0-9-]+\b/gi, '[redacted]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[redacted]')
    .replace(/\b\d{8,}\b/g, '[redacted]')
    .slice(0, 512);
}

function safeFilename(value: string): string {
  return value.replaceAll('\\', '/').split('/').at(-1)?.split('?')[0] ?? '';
}
