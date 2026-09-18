# Local and pull request checks

Install dependencies with `npm ci`, then run `npm run check` for the complete suite.
Formatting and validation report failures without fixing source files. Builds write output
directories and may refresh the bundled mDNS helper through the existing Rust build script.
Generated README validation runs in a temporary directory and leaves the checkout untouched.

The full suite needs Windows, Node 24.15 or newer supported by Angular, Rust 1.97.1,
MSVC C++ build tools, .NET 10, and protoc 35.1 on PATH. `rustup show` installs the
repository's Rust toolchain. C# compilation restores its NuGet dependencies.
`npm run check:quick` runs the portable formatting, lint, test, translation, and README
checks. Angular builds are also portable and can run separately.

## Commands

Names follow `check:<operation>:<component>`. Omitting the component runs that operation
across all supported components. `npm run check` runs every leaf check once.

| Operation | Components | Aggregate |
| --- | --- | --- |
| Formatting | `web`, `csharp`, each Rust component | `check:format` |
| Lint | `web`, each Rust component | `check:lint` |
| Tests | `web`, each Rust component | `check:test` |
| Compilation | `ui`, `overlay-ui`, `overlay-sidecar`, each Rust component | `check:build` |
| Translation validation | All locale catalogs | `check:translations` |
| Generated files | `readmes` | `check:generated` |

Rust components are `core`, `shared-rust`, `elevated-sidecar`, `privileged-launcher`,
`memory-watch`, and `signing-tool`. Each operation also has a `:rust` aggregate.
For example, `npm run check:lint:rust` runs Clippy on every crate, including test targets.

Web formatting covers maintained frontend, shared TypeScript, script, JSON, and workflow
files. Generated TypeScript clients and third-party OpenVR bindings are excluded from
formatting. C# formatting uses `dotnet format whitespace`; it does not enforce optional
code-style analyzers. Web tests use Vitest. There is no C# test suite yet.

Angular compilation checks templates and types as part of the build. Native builds use
the debug profile; the core disables `custom-protocol`, so it does not embed frontend
assets. These checks do not package, sign, publish, upload sourcemaps, or launch the app.
SteamVR, device integration, elevation, and desktop UI verification remain separate.

## Translation contracts

`check:translations` checks the flattened key order used by `npm run tl clean`, rejects
unknown keys, non-string values, empty entries, and placeholder entries, and parses every
message. Missing translated keys are allowed and use the English fallback.

Existing translations must preserve English argument names, semantic select cases,
exact numeric plural cases and offsets, HTML elements, and functional attributes such
as `href`, `target`, and `rel`. Text and translatable attributes such as `title` may differ.
Arguments may move or repeat. Plural categories follow the locale; a simple Japanese
count does not need English plural branches. Markup is checked for every ICU branch.

`scripts/translation-exceptions.json` records pre-existing mismatches, not approved
translations. Each record names the issue and fingerprints both the English and translated
text. Changing either message invalidates the exception. A valid correction passes even
if its old record remains; remove obsolete records when convenient. Avoid adding an
exception for a new defect. Review intentional localized links or markup differences
explicitly before recording an exception.

The README check regenerates Markdown and Steam descriptions from `docs/readmes/src`
and `docs/translation_contributors.json`, then compares the files byte for byte. It accepts
the root README symlink, its Windows checkout representation, or matching generated
content. `docs/readmes/generated/README.md` is a maintained directory notice, not generated
output. Run `npm run generate:readmes` to refresh generated output. Protobuf regeneration
is not part of this check yet; protocol changes still compile the affected consumers.

## GitHub selection

The Checks workflow runs on PRs targeting `develop` or `main`, pushes to either branch,
and manual requests. It uses standard GitHub-hosted Ubuntu and Windows runners, read-only
permissions, and no publishing credentials. Superseded runs are cancelled per PR or branch.
Native CI disables Rust debug symbols and incremental compilation to keep build output
within the hosted runner's disk space and shares one target directory across crates.
Local commands retain the normal debug defaults.

PR selection uses the complete diff from the merge base to the PR head. Push selection
uses the latest successful push run of this workflow whose commit is an ancestor of the
current commit. Cancelled or failed runs never advance that baseline. Without a usable
baseline, or when comparison fails, the workflow checks everything. Manual runs are full runs.

`scripts/select-checks.mjs` owns the dependency map. Locale edits select translation and
format checks, shared TypeScript selects both frontend builds, and shared Rust selects its
dependent crates. Protocol changes select both frontends, the core, elevated sidecar, and
C# sidecar. README source and generated-output changes select regeneration. Check scripts,
root dependency/toolchain configuration, workflows, and unknown paths select the full suite.

Require the `Checks passed` result in branch protection. It fails when selection or a
selected job fails or is cancelled. Unselected work passes without installing dependencies.
Branch protection itself is a repository setting and is not changed by this workflow.

The old development and release publishing workflows still name the retired self-hosted
runner. This validation workflow does not reactivate or migrate those publishing jobs.
