# Guitar Tab Writer

A no-frills, single-page web app for writing **chords-over-lyrics** song sheets.
Paste in your verses, drop chords into brackets, and see them positioned above
the lyrics in real time. No accounts, no server, no build step.

**Live:** https://reprahkcin.github.io/guitar-tab-writer/

## Running it

Open the hosted version above, or open `index.html` locally in any browser
(double-click it, or drag it into a tab).

The hosted site is served over HTTPS, so **folder mode also works there** — no
local server needed. (Editing `file://` locally still can't use folder mode; run
`./serve.sh` for that.)

Everything runs locally in the page. Your songs are saved automatically in the
browser (localStorage), and you can also export/import them as files.

For **folder mode** (editing `.cho` files on disk, below) run it over localhost
instead, since the browser only allows file access from `http://`/`https://`:

```
./serve.sh            # serves on http://localhost:8137
```

then open that URL in Chrome or Edge.

## Folder mode — edit folders of charts on disk

The app starts in **browser mode** (songs in localStorage), so you can jot
something down instantly. When you're ready to keep charts as real files, you
**establish a collection** and the app switches to editing files on disk — good
for repos of songs you track in git. You can keep **several folders open at
once**; each open folder is a *library*.

- Click **Open folder** and pick a directory (Chrome/Edge only). The first time,
  your existing browser songs are **copied into that folder** as `.cho` files
  and the app switches to file-backed mode (your browser copy is kept as a
  backup). The folder is scanned recursively for `.cho` files.
- Click **+ Folder** to open **additional** folders. The sidebar groups songs
  under a collapsible header per folder, each with **↻ reload from disk** and
  **× close** controls.
- Edits **save straight back to the file** (auto-saved, debounced; or press
  **Cmd/Ctrl+S**, or the **Save** button). Then commit in that repo as usual.
- Folders are remembered. Next session the app reconnects the ones it still has
  permission for; any that need a fresh grant appear behind a single
  **Reconnect folders** button (browsers can't silently re-grant folder access
  on a cold start). Closing the **last** folder returns you to browser songs.
- **+ New** and **Import** land in the **active** folder, shown as
  `+ New → <folder>` at the top of the sidebar and marked with a dot on its
  header. Selecting a song makes its folder active; to target a different
  folder (including an **empty** one you just made in Finder), **click that
  folder's name** in the sidebar. The caret (▸/▾) collapses the group.
- Deleting is disabled in folder mode — manage files in your repo / file
  manager, then hit **↻** on the folder to resync.

The on-disk format is the same `.cho` used by Import/Export: a `{title}` /
`{artist}` / `{key}` / `{capo}` / `{transpose}` directive block, then the body
with inline `[chord]` tags. Round-trips losslessly.

## Writing syntax

- **Chords** go in square brackets, placed right before the syllable they land on:

  ```
  [G]When the night has [Em]come
  ```

  renders as:

  ```
  G                Em
  When the night has come
  ```

- **Section labels** use curly braces (or a lone bracketed word):

  ```
  {Verse 1}
  {Chorus}
  [Bridge]
  ```

- **Blank lines** are preserved as spacing.
- A line with only chords and no lyrics renders as an instrumental/chord line.
- **Chord palette**: every chord already used in the chart appears as a chip
  above the editor — click one to insert that `[chord]` at the cursor. New
  chords join the palette as you introduce them.
- **Section buttons**: a toolbar (Intro, Verse, Pre-Chorus, Chorus, Bridge,
  Solo, Outro) inserts a `{Section}` label at the cursor on its own line.
  **Verse** auto-increments to the next number already in the chart.
- **Clear chords**: the **Clear chords** button (editor header) strips every
  `[chord]` from the chart at once — handy for a complete re-harmonisation. It
  keeps lyrics, section labels, and `{page}` markers, and can be undone with
  Cmd/Ctrl+Z.
- **Page breaks** use `{page}` on its own line (or click **Insert page break**).
  On screen it shows as a labelled dashed divider; when you print, the page
  breaks there. `{pagebreak}` and `{newpage}` also work.

## Performance mode

Click **Perform** (top bar) for a full-screen stage view of the current song:

- **Newspaper columns** — the song flows across a configurable number of columns
  (**Columns** ±). The font **auto-sizes** so the chosen number of columns fits
  without the chord/lyric lines overlapping; on a wide monitor you can fit the
  whole song across several columns with no scrolling. **Size** ± overrides the
  font (bigger text may reduce the columns that fit and add pages); **Fit**
  shrinks the font until everything fits one screen.
- **Page turning** — <kbd>→</kbd>/<kbd>PageDown</kbd>/<kbd>Space</kbd> go
  forward, <kbd>←</kbd>/<kbd>PageUp</kbd> back. Long songs page sideways one
  screenful at a time; pedalling past the end flows into the **next song in the
  folder** (and back past the start into the previous one). Set an **AirTurn**
  (or any Bluetooth page turner) to send Left/Right Arrow.
- **`{page}`** markers force a hard column break, so you control where breaks
  land.
- **Toggleable panels** — **Chords**, **Lead**, **Scale**, and **Harp** each
  show/hide independently (all off by default) so lyrics and chord changes get
  the whole screen when you want.
- **Esc** exits. Column count, size, and panel choices are remembered.

## Printing

Click **Print** (top right) to open your browser's print dialog — from there you
can print on paper or "Save as PDF". The printout is a clean black-on-white
chord sheet with the song title and artist at the top; the editor, sidebar, and
toolbar are hidden. Chord lines stay glued to the lyric line below them, and
`{page}` markers force a new page.

Use the **Print** control in the preview header to lay the chart out in **1 or
2 columns** (2 is handy for fitting a long song on one page). Chord + lyric
pairs never split across a column, and the chord diagrams stay full-width above
the columns.

Every lyric line reserves a chord row above it, so lines with and without chords
share a uniform grid and even spacing (on screen and in print).

## Features

- Live preview as you type
- **Print / Save as PDF** with clean print styling and manual page breaks
- **Transpose** up/down by semitone (chords shift, e.g. G → A)
- **Capo** — set a capo fret; a "Capo N" banner shows the resulting sounding
  key, and the harmonica suggestions rise with the capo (see below)
- **Chord diagrams** — an auto-generated fretboard diagram for every chord used,
  each with a **voicing dropdown**: alternate barre positions (E/A/D shapes up
  the neck) and triad inversions on the top and middle string sets — handy for
  writing alternate parts
- **Rhythm & Lead sets** — two independent diagram rows plus a full-neck **scale
  map**, for sketching lead parts and solos against your rhythm voicings
- **Harmonica suggestions** — recommended harp keys for the song's sounding key
- Auto-save per song + a song list in the sidebar
- **Export** a song to a `.cho` text file, **Import** one back
- Slash chords (`[D/F#]`) and any suffix (`[Cadd9]`, `[Asus4]`, `[Bbm7]`) supported

## Capo, chord diagrams & harmonica

- **Capo**: type the chord *shapes* you finger, then set a capo fret. Two views
  of every chord matter, and the app shows both:
  - **Shape** (what you fret) = your chords + **transpose**. A capo does *not*
    change the shape — a G shape stays a G shape.
  - **Sounding** (what it actually sounds as) = shape + **capo**. This is what a
    capo-less bandmate plays, and what the harmonica must match.

  Example: song in G, Capo 2 → you fret a **G** shape, it sounds as **A**, use
  an **A** harp. Transpose +2 first and you fret an **A** shape that (with the
  same capo) sounds as **B**.

  A banner shows the capo, the offset, and the sounding key. Each chord diagram
  is labelled with what its shape *sounds as*. The **Chords above lyrics** toggle
  in that banner switches the sheet between **Shapes to fret** (for you) and
  **Sounding (for others)** — flip to Sounding to hand a bandmate the real
  chords. The harmonica always follows the sounding key.
- **Chord diagrams** render above the sheet (toggle with the **Chord diagrams**
  checkbox). Common open chords use their standard shapes; others fall back to
  movable barre shapes. Unusual chords show "shape n/a".
- **Voicing dropdown**: under each diagram, pick a different way to play the
  chord — the default shape, movable **E / A / D barre** forms further up the
  neck, or **triad inversions** (root / 1st / 2nd) on the top (G-B-e) and middle
  (D-G-B) string sets. Triads are compact three-note shapes, great for coming up
  with alternate parts and voice leading. Your pick per chord is remembered and
  prints with the sheet.

## Rhythm & Lead sets

The chord area has two independent rows (toggle the **Lead set** checkbox):

- **Rhythm** — your main parts; each chord defaults to the standard shape, with
  the voicing dropdown for swapping individual chords.
- **Lead** — the same chords defaulting to **triads up the neck** (each with its
  own voicing dropdown, kept separate from the rhythm choices), plus a **scale
  map**. The two sets remember different picks, so you can hold an open-chord
  rhythm voicing while the lead row shows a triad inversion to build a line from.

The **scale map** is a full-neck (15-fret) fretboard: the **root** is filled
orange, other **scale tones** teal. Pick the **root** (defaults to the song's
sounding key, or override it) and the **scale** — major/minor pentatonic, blues,
major, natural minor, Dorian, or Mixolydian.

**Chord-tone highlight**: click any chord's name (in the Rhythm or Lead row), or
use the **Chord** dropdown in the scale panel, to overlay that chord's notes on
the scale map. Each chord tone is labelled with its **interval degree**
(R, 3, 5, b7, …): tones that are in the scale get a gold ring with the label;
tones that fall *outside* the scale are drawn as hollow gold markers with the
label, so you can see the whole chord across the neck and aim for specific
targets (e.g. land on the 3 or the R). Click the same chord again to clear it.
Everything prints with the sheet.
- **Harmonica** suggests diatonic harp keys for the sounding key: 2nd position
  (cross harp — blues/folk), 1st (straight — melody), and 3rd (slant — minor).
  The song key is auto-detected from the first chord; override it with the
  dropdown. Toggle the panel with the **Harmonica** checkbox. Both diagrams and
  harmonica picks are included when you print.

## Files

- `index.html` — layout
- `styles.css` — styling (including print styles)
- `app.js` — editor, rendering, transpose/capo, storage, import/export
- `chords.js` — chord shape library, diagram SVGs, harmonica suggestions
