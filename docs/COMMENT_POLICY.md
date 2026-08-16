# Comment policy

Applies to every language in this repository: TypeScript, Rust, C#, and Angular templates.

A comment exists to make the code faster to read. That is the whole rule. Everything below follows
from it.

Most comments fail that test: they add reading work without adding information, so the default is
still no comment. A comment that lets someone skip a block instead of parsing it has paid for its
line, even when it says nothing the code doesn't already say.

One line, for anything sitting inside a function body. A body comment that needs a second line has
turned into rationale, and rationale goes in the PR description. Doc comments get slightly more
room, see below.

## Signposts

Above a block whose purpose isn't clear from its first line, put a short phrase naming what the
block does. Under ten words, lowercase, no full stop. Down the left edge they read as a table of
contents:

```ts
// resolve which devices the command applies to
// send the power state per device
// fall back to the last known state
```

- One per block, never one per line. Name the step, not the syntax.
- Three or more distinct phases is the trigger. A function doing one thing needs none, however long
  it is.
- Ask first whether the block wants to be a named private function. A function name beats a comment:
  it survives refactoring, it can be searched for, and it shows up in a stack trace. Signpost when
  extraction would be worse, which usually means the blocks share local state, or the order between
  them is the point.
- A signpost describes the block as it is now. Change the block, fix the signpost.

## Doc comments

JSDoc, Rust `///`, C# `///`. Same instinct as everywhere else, the shortest thing that does the job.
One line is the norm, two is common, more is an exception you have to earn. Plenty of members need
none at all, because the name and the types already say it.

Length isn't free here either. A docblock nobody reads to the end is a docblock nobody reads, and
every redundant line is one more thing that has to stay true.

- Never restate the signature. No `@param` spelling the parameter name back in words, no
  `@returns The result`. If the types answer it, leave it out.
- Past two lines only for what a caller genuinely cannot see: side effects, what it throws or panics
  on and when, preconditions and call order, units, what an empty or zero return means, arguments
  that are mutually exclusive. One line each, and only the ones that actually apply.
- A big signature is not itself a reason to write more. Ten obvious parameters need no prose. One
  parameter with a non-obvious contract does.
- No rationale, no alternatives weighed, no history, at any length.

## Also worth keeping

- A one-line invariant a future edit could plausibly break: "this lock is shared with X, release it
  before sleeping".
- A one-line contract that is invisible from the signature: "empty result means empty, not pending".

## Delete on sight

- **Migration history.** Why a change was made, what an API used to be, what version something
  changed in, an issue number. Never write these:

  ```ts
  // X was removed in 0.13, so we now call Y instead
  // Borrowed rather than cloned: the new bindings no longer derive Clone
  // Version 1 syntax, because version 2 escapes differently
  // Renamed from foo() in v21
  ```

  The code should read as though it was always written this way. A reader six months out does not
  care what it used to be, that is what `git log` and `git blame` are for, and these comments go
  stale the moment the surrounding code moves on.

- **Design rationale.** Why this approach, why not the alternative, what would go wrong done
  differently. This is the most common failure and it reads as helpful, which is why it survives
  review. It still belongs in the PR description.
- **Restating a single line.** A signpost labels a block. A comment sitting on one statement that
  already says the same thing is just noise.
- **Naming what an operator or API already means.** "switchMap drops the previous request", "`?`
  propagates the error", "await waits for the task".

Do this in code you are already changing. Don't sweep unrelated files in a PR about something else,
that costs a reviewer more than the comments do.

## Three tests, in order

For a body comment. Stop at the first test that answers. For a doc comment there is one test: could
a caller answer this from the signature alone? If yes, cut it.

1. Is it a one-line invariant or an invisible contract, as above? Keep it, the rest of the tests do
   not apply.
2. Does it explain why, or what changed? PR description.
3. Does it only repeat the statement under it? Delete it.
4. Does it let a reader skip a block they would otherwise have to read line by line? Keep it.

Nothing else earns a comment.

The same rules apply in templates. A signpost above a big block is fine; an HTML comment explaining
a class or a structural directive is the same failure in another file type.
