# Icon design

OyasumiVR draws its icons from one custom set in `src-ui/assets/icons`. Draw every new icon to these
rules, so it sits beside the others without standing out. Generic symbols (a warning triangle, a
question mark in a circle, a chevron) keep their usual shape and take on this style.

## Style

- **Plush and solid.** Chunky filled silhouettes with heavily rounded corners. No outlines, no
  gradients, no painted shading.
- **Geometric.** Build shapes from perfect circles, rounded rectangles, straight lines, and smooth
  symmetric curves. Keep symmetric objects symmetric and corner radii consistent. An icon that looks
  drawn by hand fails, even when its concept is right.
- **Both sizes.** Every icon reads at 18 px in the sidebar and looks full at 96 to 128 px on a
  SteamVR overlay button. Check both before you keep an icon.
- **Real logos.** A third-party brand (VRChat, SteamVR) keeps its real silhouette, drawn in the
  set's tones.

## Tones

Each icon uses three tones and an optional shade. Each tone has one job and one variable, defined
for `app-icon` and `svg.svg-icon` in `src-ui/styles.scss`:

| Tone   | Variable        | Job                                                              |
| ------ | --------------- | ---------------------------------------------------------------- |
| body   | `--icon-body`   | the silhouette, in a pale tint of the accent                     |
| inner  | `--icon-inner`  | a detail that sits inside the body: letters, holes, hubs, dots   |
| accent | `--icon-accent` | a part that sticks out onto the background: rings, sparkles, a z |
| shade  | `--icon-shade`  | a clean even-width edge where one part overlaps another          |

The accent is the base color: `--icon-color` when an ancestor sets it, `--color-primary` otherwise.
It reads well against the dark background but too weakly against the pale body, so it never sits
inside the body: the pink primary on its body measures 2.33:1. The other three tones derive from the
base color in OKLCH. They keep its hue and set a fixed lightness. For every base color the app uses,
the theme and severity colors, the VRChat status colors, white, and the text grays, the inner tone
measures at least 4.78:1 against the body (5.36:1 for the pink). A formula this simple cannot hold
4.5:1 for every possible color, so measure a new base color before you use it.

Set `--icon-color` where the context has its own color:

| Context                     | `--icon-color`                                |
| --------------------------- | --------------------------------------------- |
| anywhere else               | unset, so the primary applies                 |
| an alert, toast, or message | its severity color, such as `--color-warning` |
| a primary button            | white, set in `styles/buttons.scss`           |

Error and caution share one level, `--color-caution`.

A control whose states set its text color, such as a window button or a slider marker, draws its
icon in one tone: add `class="icon-mono"`, and all four tones become `currentColor`. A power button
(`button.btn-power`) needs no class. Its icons take the state color at rest and turn one tone on
hover, where the button fills with that color.

A plain colored dot, such as a VRChat status, is `<span class="status-dot">` with a background
color, not an icon.

## Using an icon

Place an icon with its file name:

```html
<app-icon name="sleep" />
```

`app-icon` draws the file through `<use href="/assets/icons/sleep.svg#icon">`, because an `<img>`
cannot read the tone variables. It is 1 em square, so set its size with `font-size`. Name a file for
what it depicts, not for the page that shows it (`heart-pulse`, not `nightmare-detection`), so other
pages can reuse it. Reuse an existing icon before you draw a new one.

Angular creates no components inside `[innerHTML]`, so an HTML string built in TypeScript, such as a
select-box `htmlPrefix`, uses the same file directly:

```html
<svg class="svg-icon"><use href="/assets/icons/mic.svg#icon" /></svg>
```

The sanitizer strips `<svg>` from plain strings, so wrap such a string in
`bypassSecurityTrustHtml`. Only fixed strings from the codebase belong there, never user input.

## SVG format

- The root `<svg>` has `id="icon"`, which the `<use>` references point at.
- A square `viewBox` cropped to the shape, with no background rectangle.
- Every fill and stroke names its tone through a variable, such as
  `style="fill:var(--icon-inner)"`, never a hex value. An element with a stroke and no fill states
  `fill:none`.

## Drawing a new icon

1. Draw against finished icons from this set, and draw a related group together, so the shapes and
   proportions stay consistent. Describe each icon to yourself as simple geometric parts.
2. Draw in two working colors: one for the body, and one for details and parts.
3. Save one SVG per icon. Drop any background rectangle, and crop the `viewBox` square to the
   shape, measuring rotated shapes after their transform.
4. Map every fill and stroke to a tone variable: body, accent, or shade.
5. Mark each detail that lies inside the body as the inner tone.
6. Check the icon at 18 px and at 128 px in the pink tones before you commit it.
