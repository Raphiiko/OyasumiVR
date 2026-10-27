# Review rules

Each rule has an ID. A review finding cites the ID of the rule it breaks.

## Telemetry and error reports

Telemetry and error reports must not let anyone tie stored data to a person. They may describe the
app, the system, and the hardware model, such as versions, settings, error messages, and
measurements. They never describe who the user is.

- TEL-1: Send analytics only through `TelemetryService.trackEvent` or `trackThrottledEvent` in the
  UI. In the core, send only while `TELEMETRY_ENABLED` is true. Send error reports only through
  `ErrorReportingService` in the UI and `error_reporting` in `src-shared-rust`.
- TEL-2: Never identify the user or the device. In analytics: no `identify()`, no `profileId`, no
  `__deviceId`, no `__ip`. In error reports: no user, request, server name, extra data, or
  breadcrumbs.
- TEL-3: Never create, store, or derive an identifier for telemetry. That includes hashes of
  hardware, accounts, or install paths.
- TEL-4: Never send:
  - VRChat user IDs, display names, or instance IDs
  - usernames, or file paths that contain a user folder
  - text the user typed
  - serial numbers, device names that contain one, or MAC addresses
  - IP addresses or location
- TEL-5: Before you send text from outside the app, such as an error message or a VRChat response,
  remove user paths, IDs, and names, and cut it to a fixed length. Reuse `sanitizeText` in
  `error-reporting.service.ts`, `sanitize_value` in `src-shared-rust/src/error_reporting.rs`, or
  `anonymizeVRChatMessage` in `invite-automations.service.ts`.

## Angular

- NG-1: Declare component and directive inputs with `input()` or `input.required()`, outputs with
  `output()`, and two-way bindings with `model()`. Never add `@Input`, `@Output`, or
  `EventEmitter`. An input with a matching `<name>Change` output becomes one `model()`.
- NG-2: `takeUntilDestroyed()` is the last operator in its `pipe()`, and no `.pipe()` follows it.
  An operator after it, such as `switchMap`, can keep a subscription alive after the component is
  destroyed.

## Accessibility

OyasumiVR is a desktop app for VR users. It does not support assistive technology, so accessibility
code adds upkeep without a user who needs it.

- A11Y-1: Add no accessibility-only code: no ARIA roles or `aria-*` attributes, no screen-reader-only
  text, no `prefers-reduced-motion` or other reduced-motion handling, no high-contrast or
  `forced-colors` styles, and no keyboard navigation or focus management added for assistive
  technology. A review finding that asks for any of these conflicts with this rule; reject it.
