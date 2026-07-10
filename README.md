# Guitar Tab Writer

A no-frills, single-page web app for writing **chords-over-lyrics** song sheets.
Paste in your verses, drop chords into brackets, and see them positioned above
the lyrics in real time. No accounts, no server, no build step.

## Running it

Just open `index.html` in any browser (double-click it, or drag it into a tab).

Everything runs locally in the page. Your songs are saved automatically in the
browser (localStorage), and you can also export/import them as files.

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
- **Page breaks** use `{page}` on its own line (or click **Insert page break**).
  On screen it shows as a labelled dashed divider; when you print, the page
  breaks there. `{pagebreak}` and `{newpage}` also work.

## Printing

Click **Print** (top right) to open your browser's print dialog — from there you
can print on paper or "Save as PDF". The printout is a clean black-on-white
chord sheet with the song title and artist at the top; the editor, sidebar, and
toolbar are hidden. Chord lines stay glued to the lyric line below them, and
`{page}` markers force a new page.

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
major, natural minor, Dorian, or Mixolydian. Everything prints with the sheet.
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
