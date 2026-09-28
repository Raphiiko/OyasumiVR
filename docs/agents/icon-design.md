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

Each icon uses three tones and an optional shade. Each tone has one job and one variable, which
`app-icon` defines in `src-ui/app/components/icon/icon.component.scss`:

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
| a VRChat status             | the status color                              |
| a primary button            | the button's text color                       |

Error and caution share one level, `--color-caution`.

## Using an icon

Place an icon with its file name:

```html
<app-icon name="sleep" />
```

`app-icon` inlines the SVG, because an `<img>` cannot read the theme variables. It is 1 em square,
so set its size with `font-size`. Name a file for what it depicts, not for the page that shows it
(`heart-pulse`, not `nightmare-detection`), so other pages can reuse it. Reuse an existing icon
before you draw a new one.

## SVG format

- A square `viewBox` cropped to the shape, with no background rectangle.
- Every fill and stroke names its tone through a variable, such as
  `style="fill:var(--icon-inner)"`, never a hex value. An element with a stroke and no fill states
  `fill:none`.

## Drawing a new icon

Icons come from QuiverAI's Arrow 2 model, through the web app at `app.quiver.ai`. Arrow follows a
reference image more closely than words, and drifts in color between requests.

1. Render a reference image: six to nine finished icons from this set on a dark navy background,
   drawn in pale lavender `#D2CBFF` with periwinkle `#616DE1` details. Arrow reproduces the style
   most reliably in these two colors.
2. Request up to eight icons in one prompt, as one sheet in a 4x2 grid, so they come out
   consistent. Describe the style from this document, name the two colors, and describe each icon
   as simple geometric parts.
3. Split the sheet into one SVG per icon: cut at the widest empty gaps between shapes, drop the
   background rectangle, and crop each `viewBox` to its shape.
4. Snap every fill and stroke to the nearest of body, accent, and shade.
5. Turn each accent shape that lies inside a body shape's bounds into the inner tone.
6. Check the result at 18 px and at 128 px in the pink tones before you commit it.
