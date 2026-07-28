# Jam Tab Writer

A no-frills, single-page web app for writing **chords-over-lyrics** song sheets.
Paste in your verses, drop chords into brackets, and see them positioned above
the lyrics in real time. No accounts, no server, no build step.

**Live:** https://reprahkcin.github.io/jam-tab-writer/

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

### Where charts live: systems, colours & the breadcrumb

Charts can live in three places, and each is **colour-coded** so they never look
like they belong together:

- ⚪ **Browser** — localStorage, the neutral default.
- 🟢 **Collection** — your managed home folder (always green, with a ring).
- 🔵 **External folders** — ad-hoc folders you open for a task (each a distinct
  colour from a palette).

A **breadcrumb under the song title** always shows where the current chart is
saved: the system's colour, the folder path (subfolders included), the file
name, and a live state (`Saving…` / `Saved ✓` / `Draft` / `Save failed`).

### The Collection

Click **Collection** to set up a managed home folder. **Important:** the folder
you pick in the dialog is the **parent** — a folder named
`GuitarTabWriterCollection` is created *inside* it to hold your charts. So pick a
location like *Documents*, not an existing collection folder. (The picker opens
in Documents by default.) It reconnects each session like any other folder.

### Subfolders & where new charts go

- Each folder shows as a **collapsible tree**: subfolders nest (with counts) and
  even **empty** subfolders appear so you can aim at them.
- **New charts go to a target** you control, shown as `+ New → Folder / sub` and
  highlighted in the tree. Click any folder or subfolder name to change it;
  selecting a chart points the target at that chart's folder. **+ New**,
  **Import**, and **PDF drop** all create files there.
- The **+** on any folder row creates a **subfolder on disk** inside it.
- **Hover** any chart or folder to see its path *within the collection* (e.g.
  `Collection/verses/hard-sun.cho`). The **◎** button on a folder **shows its
  location on disk** — browsers can't open Finder or reveal the absolute path, so
  this re-opens the system folder dialog focused on that folder (its full path is
  visible there; close the dialog when done).
- If a remembered folder has been moved or deleted, it's dropped from the sidebar
  on the next launch (with a brief note) instead of erroring.
- **+ New** asks for a **file name** — that names the `.cho` file only. The
  song's **title** and **artist** are set separately inside the editor and can
  differ from the file name.

## Convert a PDF chart

Drag a chords-over-lyrics PDF anywhere onto the window (or pick it via
**Import**) and it's converted to an editable draft — chords lifted into inline
`[chord]` tags over the lyrics, sections turned into `{labels}`, title/artist/key
scraped from the header. It opens in the editor unsaved so you can review and
fix the odd chord before keeping it (in folder mode, hit **Save** to write it
into the active folder).

- PDFs that carry a real text layer convert instantly.
- Image-only PDFs (e.g. Ultimate Guitar's exported charts) are read with OCR.
  The first such conversion downloads the OCR engine (~6 MB, from a CDN) and then
  caches it; conversion needs an internet connection that first time. Keep the
  tab visible while it works.
- Pure tablature (ASCII fret numbers, not chords-over-lyrics) can't be
  meaningfully converted. Treat all output as a **draft** to skim, not a
  finished chart — it's the same engine as the `tools/` batch converter.

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
- **Keyboard chord placement** (no mouse trip to the palette):
  - **Alt/Option + 1–9** drops the corresponding palette chord at the caret. The
    chip shows its number (the first nine chords in the song).
  - **Type `[`** (or **Cmd/Ctrl + K**) to open a type-ahead popup at the caret
    over your song's chords plus common ones. Keep typing to filter, **↑/↓** to
    pick, **Enter/Tab** to insert (the `]` is added for you), **Esc** to cancel.
    Typing a chord that isn't listed works too — it's inserted as you typed it.

  Position the caret with the arrow keys and you can chord an entire song without
  touching the mouse.
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

## Metronome & tuner

Two utilities open as small floating panels from the header:

- **Metronome** — set the tempo (BPM stepper + slider, or **Tap** the beat),
  pick the beats per measure (2/3/4/6, with an accented downbeat), and **Start**.
  A row of dots pulses on the beat. Uses the Web Audio clock for steady timing.
- **Tuner** — pick a tuning, click **Start**, allow microphone access, then play
  one string. Readings are measured against the strings of the chosen tuning
  rather than the nearest chromatic note, so half a semitone flat on the low E
  reads as *"tighten the 6th"*, not *"that's a nicely tuned D#"*.
  - **String row** — each chip shows a string over the pitch it's aiming at in
    Hz. The one you're playing lights up; it earns a **✓** once you've brought it
    in tune, so you can see at a glance which strings are still to do.
    **Click a chip** to lock the tuner to that string (click again to unlock);
    while locked, playing anything else says which string to play instead.
  - **Meter** — a fixed scale spanning a full semitone either way (±100 cents),
    labelled at −100/−50/0/+50/+100 so you can read the remaining distance off
    it rather than watching the needle peg. Past a semitone it pegs anyway and an
    arrow points the way. The green band *is* the in-tune window (±5 cents), so
    the needle sitting in the green and the words underneath can never disagree.
    Flat is to the left (tighten), sharp to the right (loosen).
  - **What to do** — under the meter, in words: *"Tighten a touch — 8¢ flat"*,
    *"Loosen a lot — 47¢ sharp"*, *"In tune — hold it"*.
  - Readings are median-smoothed over several frames, so the number settles
    instead of flickering. Needs the HTTPS site or localhost for mic access.

## Performance mode

Click **Perform** (top bar) for a full-screen stage view of the current song:

- **Auto-fit** (on by default) — **Fit** lights up and every song sizes itself to
  exactly one screen at the largest text that will fit, picking both the column
  count and the font. It re-fits on each song change, when a panel is toggled,
  and when the window resizes, so pedalling through a set never means stopping to
  work the ± steppers. A song too long to fit even at the smallest size falls
  back to paging.
- **Newspaper columns** — the song flows across a number of columns (**Columns**
  ±). Touching **Columns** or **Size** ± turns auto-fit off so your choice sticks;
  click **Fit** to hand sizing back. With auto-fit off the font still auto-sizes
  to whatever column count you pick, so chord/lyric lines never overlap.
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
- **Esc** exits. Auto-fit, column count, size, and panel choices are remembered.

## Riffs & solos

Below the editor, the **Riffs & Solos** panel lets you author tablature. Click
**+ Add riff**, give it a name, and fill in the grid — six string rows (high e
down to low E), one column per step. Click a cell and type the fret; two-digit
frets (10, 12) just work, no dash-alignment to fight. **+ step / − step** grow or
trim the length, and you can add as many riffs as you like.

Add a **technique** after a fret to link it to the next step: **h** hammer-on,
**p** pull-off, **b** bend, **/** slide up, **\\** slide down. Type `5h` in one
cell and `7` in the next and it renders `5h7`.

Each riff renders as clean tab in the preview and — for now — **prints on its own
page**, after the chart. Riffs are saved with the song as standard ChordPro
`{start_of_tab: Label}` … `{end_of_tab}` blocks, so they round-trip through your
`.cho` files in folder mode.

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
- **Drop a PDF** to convert it to an editable chart (text layer or OCR) — see
  "Convert a PDF chart" above
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

## Instruments — the jam

Charts are organized **by instrument**. A row of chips at the top of the preview
is your jam roster — switch each instrument on or off. Every instrument you turn
on gets its own section with **its chord diagrams and its scale map**, stacked so
you can see the whole band at once. Two global toggles, **Chords** and
**Scales**, hide those rows across every instrument.

- **Guitar 1 / Guitar 2** — two guitar parts (your first and second guitar).
  Both show fretboard diagrams with the voicing dropdown; **Guitar 1** defaults
  to standard open shapes, **Guitar 2** to **triads up the neck**, and each
  remembers its own picks — hold an open rhythm voicing on one while the other
  builds a line from a triad inversion.
- **Ukulele** — a 4-string (gCEA) fretboard diagram per chord, voicings found
  automatically; anything unreachable shows "shape n/a".
- **Mandolin** — a 4-course (GDAE, fifths) diagram per chord, plus a mandolin
  scale map.
- **Piano** — a keyboard per chord with the chord tones highlighted (root
  orange, other tones gold) and labelled by interval degree (R/3/5/7 …), plus a
  piano scale roll.
- **Bass** — a scale map on the bass neck (EADG); no chord grid.
- **Harmonica** — its own panel (see below), toggled from the roster like the
  rest.

The lineup is **global** — one jam applies to every song. Fretted-instrument
voicings and piano inversions are remembered per chord; the scale root, scale
type, and focused chord are shared across all the instruments' scale maps.

The **scale map** is a full-neck (15-fret) fretboard: the **root** is filled
orange, other **scale tones** teal. Pick the **root** (defaults to the song's
sounding key, or override it) and the **scale** — major/minor pentatonic, blues,
major, natural minor, Dorian, or Mixolydian.

**Chord-tone highlight**: click any chord's name, or use the **Chord** dropdown
in the scale controls, to overlay that chord's notes on **every** scale map. Each
chord tone is labelled with its **interval degree**
(R, 3, 5, b7, …): tones that are in the scale get a gold ring with the label;
tones that fall *outside* the scale are drawn as hollow gold markers with the
label, so you can see the whole chord across the neck and aim for specific
targets (e.g. land on the 3 or the R). Click the same chord again to clear it.
Everything prints with the sheet.
- **Harmonica** suggests diatonic harp keys for the sounding key: 2nd position
  (cross harp — blues/folk), 1st (straight — melody), and 3rd (slant — minor).
  The song key is auto-detected from the first chord; override it with the
  dropdown. Toggle it from the instrument roster. Both diagrams and harmonica
  picks are included when you print.

## Files

- `index.html` — layout
- `styles.css` — styling (including print styles)
- `app.js` — editor, rendering, transpose/capo, storage, import/export
- `chords.js` — chord shape library, diagram SVGs, harmonica suggestions
