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

## Tests

- TEST-1: Keep a test when it guards a contract that a plausible, type-correct edit could break. Typical cases are migrations, byte formats and parsing, numeric bounds, enum-to-implementation mapping, ordering, races and lifecycle, security and persisted-data boundaries, and input validation. The title names the trigger and the required outcome in plain words. Each `it.each` row title names its own case. The assertions must fail on that wrong edit. "A call happened" or "success returned" does not count.
- TEST-2: Delete assertions that only restate a literal from the code, framework behaviour (`should create`, DI), or what the compiler proves. Keep protocol values, safety defaults, and routing that something external depends on, when no other test covers them.
- TEST-3: Test each contract once, at the lowest layer that exercises it. A boundary layer keeps its own tests only for what it adds: validation, conversion, routing, response shape. Cases with the same setup and assertions become one `it.each`. Remove redundant cases, never distinct failure modes.
- TEST-4: Never sleep or poll on real time. Use fake timers or an injected clock, restore them after each test, and await async work directly.
- TEST-5: A bug fix adds a test only when the bug can return through a plausible edit and the test fails without the fix. Extend an existing test only when it guards the same contract. Titles describe behaviour, never the bug or ticket.
- TEST-6: A reviewer does not ask for tests by default. A missing test is a finding only when TEST-1 holds for the changed code and no existing test covers it.
- TEST-7: Do not test plain forwarding to Tauri, BLE, OSC, or another external API. Test what the adapter adds: encoding, parsing, routing, validation, ordering, concurrency, cancellation, cleanup, error handling. Mock only the external boundary.
- TEST-8: Keep the code that enforces the contract real. Mock only external or unrelated dependencies. Assert observable results or required external effects, not private details. Drive the code through public inputs, not private fields. Assert only what the contract fixes, so a harmless change to an incidental count or list does not break the test. Reset mutable fixtures between tests.
- TEST-9: A new feature gets tests only for TEST-1 contracts. Coverage percentages and test counts never justify a test. Use a snapshot only when the whole serialized output is the contract, and keep it small.
- TEST-10: Compare a format or a calculation against an independent literal. A round trip through the same encoder and decoder misses a change made on both sides.
