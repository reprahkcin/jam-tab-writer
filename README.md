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
- **Chord diagrams** — an auto-generated fretboard diagram for every chord used
- **Harmonica suggestions** — recommended harp keys for the song's sounding key
- Auto-save per song + a song list in the sidebar
- **Export** a song to a `.cho` text file, **Import** one back
- Slash chords (`[D/F#]`) and any suffix (`[Cadd9]`, `[Asus4]`, `[Bbm7]`) supported

## Capo, chord diagrams & harmonica

- **Capo**: type the chord *shapes* you finger, then set a capo fret. The capo
  raises the pitch those shapes sound at, so the sheet keeps showing the same
  shapes while a banner reads e.g. *"Capo 2 — these shapes sound in A"*. Because
  the capo raises the sounding pitch, the harmonica suggestion rises with it
  (Capo 2 on G shapes sounds in A → cross harp goes from C to D). Transpose, by
  contrast, moves the shapes on the sheet themselves.
- **Chord diagrams** render above the sheet (toggle with the **Chord diagrams**
  checkbox). Common open chords use their standard shapes; others fall back to
  movable barre shapes. Unusual chords show "shape n/a".
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
