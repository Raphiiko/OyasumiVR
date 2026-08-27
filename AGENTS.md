# Agent instructions

Edit this file. `CLAUDE.md` imports it.

## The project

OyasumiVR is a Windows desktop app for VRChat users, built with Tauri.

| Directory              | What it is                                        |
| ---------------------- | ------------------------------------------------- |
| `src-ui`               | Angular frontend (the main window)                |
| `src-core`             | Rust Tauri backend                                |
| `src-overlay-sidecar`  | C# sidecar, renders the SteamVR overlays          |
| `src-overlay-ui`       | Angular frontend for the SteamVR overlays         |
| `src-elevated-sidecar` | Rust sidecar for actions that need admin rights   |
| `src-shared-ts`        | TypeScript shared between the frontends           |
| `src-shared-rust`      | Rust shared between the core and elevated sidecar |

The core talks to the sidecars over gRPC. The `.proto` files live in `proto`.

## Generated files

Change the source, then run the generator.

- `README.md` and `docs/readmes/generated`: edit `docs/readmes/src`, run `npm run generate:readmes`.
- `src-grpc-web-client`: edit `proto`, run `npm run generate:grpc-web-client`.

## Translations

Add and change English strings only, in `src-ui/assets/i18n/en.json`. Translators fill in the other
locales. `npm run tl set` writes `en.json` alone, which is what you want. To rename or remove a key,
use `npm run tl mv` or `npm run tl unset`, so the change reaches every locale file.

## Comments

A comment exists to make the code faster to read. That is the whole rule, and it holds in every
language here: TypeScript, Rust, C#, and Angular templates.

Most comments fail that test, so the default is no comment. A comment earns its line when it lets a
reader skip a block instead of parsing it, even when it says nothing the code doesn't already say.

Inside a function body, one line. A body comment that runs to a second line has turned into
rationale, and rationale goes in the PR description.

### Signposts

Above a block whose purpose isn't clear from its first line, put a short phrase naming what the
block does. Under ten words, lowercase, no full stop. Down the left edge they read as a table of
contents:

```ts
// resolve which devices the command applies to
// send the power state per device
// fall back to the last known state
```

- One per block. Name the step, not the syntax.
- Three or more distinct phases is the trigger. A function doing one thing needs none, however long
  it is.
- Ask first whether the block wants to be a named private function. A function name beats a comment:
  it survives refactoring, it can be searched for, and it shows up in a stack trace. Signpost when
  the blocks share local state, or when the order between them is the point.
- A signpost describes the block as it is now. Change the block, fix the signpost.

### Doc comments

JSDoc, Rust `///`, C# `///`. One line is the norm, two is common, more is an exception you earn.
Many members need none, because the name and the types already say it.

- Write what the signature cannot answer. Leave out a `@param` that spells the parameter name back
  in words, and a `@returns The result`.
- Earn a third line with side effects, what it throws or panics on, preconditions and call order,
  units, what an empty or zero return means, arguments that are mutually exclusive. One line each,
  and only the ones that apply.
- Ten obvious parameters need no prose. One parameter with a non-obvious contract does.

### Keep

- A one-line invariant a future edit could break: "this lock is shared with X, release it before
  sleeping".
- A one-line contract invisible from the signature: "empty result means empty, not pending".

### Delete on sight

- **Migration history.** Why a change was made, what an API used to be, what version something
  changed in, an issue number. Put it in the commit message. The code reads as though it was always
  written this way, and `git log` and `git blame` carry the rest.

  ```ts
  // X was removed in 0.13, so we now call Y instead
  // Renamed from foo() in v21
  ```

- **Design rationale.** Why this approach, why not the alternative, what would go wrong done
  differently. This reads as helpful, which is why it survives review. Put it in the PR description.
- **Restating a single line.** A signpost labels a block. A comment on one statement that already
  says the same thing is noise.
- **Naming what an operator or API already means.** "switchMap drops the previous request", "`?`
  propagates the error".

Fix comments in code you are already changing. Leave unrelated files for their own pull request.

### Four tests, in order

Run these on a body comment, and stop at the first one that answers. A doc comment gets one test:
could a caller answer this from the signature alone? If yes, cut it.

1. Is it a one-line invariant or an invisible contract? Keep it, and skip the rest.
2. Does it explain why, or what changed? Commit message or PR description.
3. Does it only repeat the statement under it? Delete it.
4. Does it let a reader skip a block? Keep it.

Nothing else earns a comment.

## Commit messages

Subject: `type(scope): imperative summary`. Lower case after the colon, no trailing period, 72
characters maximum. The summary carries the verb, so the type never repeats it. Write
`fix: pace audio meter retries after a read error`.

Take the type from this set and no other: `feat`, `fix`, `perf`, `refactor`, `docs`, `chore`.

The scope is optional and the set is open. Name the area a reader would search for: a top-level
directory (`ui`, `core`), a subsystem (`overlay`, `i18n`), or a feature (`lighthouse`, `mqtt`). Run
`git log --format=%s | grep -oP '^\w+\(\K[^)]+' | sort -u` and reuse a scope the log already carries
when one fits. Leave the scope out when the change spans several areas.

We squash-merge, so a pull request title is a commit subject. Give it the same shape.

Write a body unless the subject says everything. Cover these, in this order, one short paragraph
each, and drop the ones that do not apply:

1. What was wrong, and what the user saw.
2. Why it happened, with the concrete cause.
3. What the change does now.
4. A fact the reader needs later: a manual step, a follow-up, something you left out.
