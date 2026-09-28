// ---- Example song and guided tour -------------------------------------------
// A new user opens the app to an example song that fills every chart — chords
// of several kinds, sections, a strumming pattern, a riff — so the reference
// has something to show from the first second. The tour walks the whole app
// using it, on demand, from the Help dialog. Tours are drawn by driver.js
// (vendor/driver, MIT), loaded before this file.
//
// Loaded before app.js; everything here reaches app.js's globals (songs, prefs,
// selectSong, importDraft, setRightTab …) only when it runs, never at load.

// The example itself, written as a .cho file so it goes through the same
// parser as any import. The lyrics are original, and they teach the syntax.
const EXAMPLE_CHO = `{title: Brackets and Bars}
{artist: The Example Band}
{key: G}
{tempo: 96}

{Intro}
[G]    [Cadd9]    [Em]    [D]

{Verse 1}
[G]Write the words the way you [Cadd9]sing them,
[Em]drop a chord in [D]brackets where it falls,
[G]right before the syllable it [Cadd9]lands on,
[Am7]and the chart lines [D]up above it all.

{Chorus}
[C]Brackets and [G]bars, [D]that's all it [Em]takes,
[C]every song you [G]love was a [D]sketch once too.
[C]Shift the key or [G]slide a capo [D/F#]on it,
[Am7]every chord will [Dsus4]follow [D]you.

{Verse 2}
[G]Name a section in the curly [Cadd9]braces,
[Em]Verse or Chorus, [D]each one on its own,
[G]sketch a strumming pattern, tab a [Cadd9]riff out,
[Am7]print it for the [D]band to take home.

{Bridge}
[Em]Hit Perform and [C]let it scroll,
[G]open Learn and [D]read the key,
[Em]tune it up, count [C]four, and roll,
[Am7]take it from the [Dsus4]top with [D]me.

{Chorus}
[C]Brackets and [G]bars, [D]that's all it [Em]takes,
[C]every song you [G]love was a [D]sketch once too.
[C]Shift the key or [G]slide a capo [D/F#]on it,
[Am7]every chord will [Dsus4]follow [D]you.

{Outro}
[G]    [Cadd9]    [G]

{start_of_strum: Verse}
1 & 2 & 3 & 4 &
D - D U - U D U
{end_of_strum}

{start_of_strum: Chorus}
1 & 2 & 3 & 4 &
D - D U x U D U
{end_of_strum}

{start_of_tab: Intro riff}
e|-------------------------------------3----------|
B|----------3-----------------------3-----3-------|
G|-------0-----0--------0--------0-----------0----|
D|----0-----------0-h2--------2-----------------2-|
A|-------------------------3----------------------|
E|-3----------------------------------------------|
{end_of_tab}
`;

// Set once a browser has been offered the example, so deleting it is final.
const EXAMPLE_SEEN_KEY = 'gtw.exampleSeen';

// Open the example: the copy already in the list if there is one, else a fresh
// one. In the browser that's a saved song like any other; with a folder open
// it's an unsaved draft, so nothing lands on disk unless you press Save.
function openExampleSong() {
  const have = songs.find((s) => s.example);
  if (have) { selectSong(have.id); return have; }
  importDraft(EXAMPLE_CHO, 'Brackets and Bars');
  const s = currentSong();
  s.example = true;
  if (mode === 'local') saveSongs(songs);
  renderList();
  return s;
}

// A first visit — nothing in this browser, no folders waiting — opens on the
// example, with an offer of the tour. Anyone else is marked as having seen it,
// so emptying a library later never brings it back uninvited.
async function maybeSeedExample() {
  let seen = false;
  try { seen = localStorage.getItem(EXAMPLE_SEEN_KEY) === '1'; } catch { return; }
  if (seen) return;
  const markSeen = () => { try { localStorage.setItem(EXAMPLE_SEEN_KEY, '1'); } catch { /* private mode */ } };
  if (mode !== 'local' || songs.length) { markSeen(); return; }
  let saved = null;
  try { saved = await idbGet('libraries'); } catch { /* no IndexedDB */ }
  if ((saved && saved.length) || mode !== 'local' || songs.length) { markSeen(); return; }
  openExampleSong();
  markSeen();
  showTourInvite();
}

// A quiet card in the corner, once: take the tour now, or not.
function showTourInvite() {
  if (document.getElementById('tour-invite')) return;
  const card = document.createElement('div');
  card.id = 'tour-invite';
  card.className = 'tour-invite';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Welcome');
  card.innerHTML = '<div class="ti-title">Welcome to Jam Tab Writer</div>' +
    '<div class="ti-body">This is an example song, there to show how a chart comes together. ' +
    'Change it, delete it, or take a two-minute tour of everything the app does.</div>' +
    '<div class="ti-actions"><button class="ti-go">Take the tour</button><button class="ti-later">Not now</button></div>' +
    '<div class="ti-foot">The tour is always in Help, the <b>?</b> button.</div>';
  document.body.appendChild(card);
  card.querySelector('.ti-go').addEventListener('click', () => { card.remove(); startTour(); });
  card.querySelector('.ti-later').addEventListener('click', () => card.remove());
}

// ---- The tour -----------------------------------------------------------------

const tourPhone = () => window.matchMedia('(max-width: 760px)').matches;

// Bring a step's part of the app on screen before pointing at it: the pane on
// a desktop (the Split view shows everything, one right-hand tab at a time),
// or the tab on a phone.
function tourReveal(where) {
  if (!where) return;
  if (tourPhone()) {
    const tab = { songs: 'songs', strip: 'edit', edit: 'edit', chart: 'chart', ref: 'charts', header: 'tools' }[where];
    if (tab && !document.body.classList.contains('tab-' + tab)) setPhoneTab(tab);
    return;
  }
  const layout = prefs.layout || 'split';
  let want = layout;
  if (where === 'edit' && layout === 'preview') want = 'split';
  if ((where === 'chart' || where === 'ref') && layout === 'editor') want = 'split';
  if (want !== layout) { prefs.layout = want; applyLayout(); renderPreview(); }
  if ((where === 'chart' || where === 'ref') && (prefs.layout || 'split') === 'split' && prefs.rightTab !== where) setRightTab(where);
}

// The steps. `where` is what tourReveal shows first; `only` keeps a step to
// one kind of screen. Descriptions are HTML.
function tourSteps(exampleStays) {
  const A = ALT_LABEL, C = IS_MAC ? '⌘' : 'Ctrl+';
  return [
    { title: 'Welcome to Jam Tab Writer',
      text: 'A notebook for writing and playing songs: type the lyrics, drop in chords, and it lays out a chart ' +
        'and the charts every player in the room needs. This tour walks through it using the example song, ' +
        '<b>Brackets and Bars</b>. Use the buttons or the arrow keys; <b>Esc</b> leaves at any time, and puts you back where you were.' },

    { el: '#phone-tabs', where: 'edit', only: 'phone', title: 'Getting around',
      text: 'On a phone the app is five tabs: Songs, Edit, the Chart, Charts for the band, and Tools. The tour moves between them for you.' },

    // The library
    { el: '#sidebar-head', where: 'songs', title: 'Your songs',
      text: 'Every song in your library. <b>New</b> starts a blank chart. <b>Import</b> opens a .cho or .txt file, ' +
        'or turns a PDF chart into one you can edit.' },
    { el: '.source-row', where: 'songs', title: 'Where songs live',
      text: 'In this browser, or in a folder on your computer as plain .cho files you can back up, sync or keep in git. ' +
        'Switch here. A song you import into a folder stays a draft until you press Save.' },
    { el: '.search-row', where: 'songs', title: 'Search and setlists',
      text: 'Search by title, artist or lyric. <b>Setlists</b> puts songs in running order and performs them one after another.' },

    // The song strip
    { el: '#workspace > .meta-row:not(.meta-cards)', where: 'strip', title: 'The song',
      text: 'The title and artist head the printed chart.' +
        (tourPhone() ? '' : ' <b>View</b> sets the layout: Split shows the editor and chart side by side; Editor and Preview give one of them the full width.') },
    { el: '.key-card', where: 'strip', title: 'Key, transpose and capo',
      text: '<b>Transpose</b> moves every chord up or down. <b>Capo</b> keeps the shapes you play and says what key they sound in, ' +
        'so a bandmate without a capo can follow. <b>Shapes</b>, when it shows, picks a key whose open chords suit your fingers and sets both for you.' },
    { el: '.tempo-card', where: 'strip', title: 'Tempo',
      text: 'The song’s beats per minute. <b>Count in</b> clicks four beats at it before you start.' },
    { el: '.tuning-card', where: 'strip', title: 'Tuning',
      text: 'An alternate tuning for the song, such as Drop D or DADGAD. The chart carries a reminder; the chord diagrams stay in standard tuning.' },

    // The editor
    { el: '#editor', where: 'edit', side: 'right', title: 'The editor',
      text: 'Type the lyrics the way you sing them. A chord goes in square brackets just before the syllable it lands on, ' +
        'as in <code>[G]Hello</code>. A section name goes in curly braces on a line of its own, as in <code>{Chorus}</code>. ' +
        'The chart redraws as you type, and the song saves itself.' },
    { el: '#section-bar', where: 'edit', title: 'Sections',
      text: 'Click a chip to put that section label at the cursor. <b>{ }</b> starts one you name yourself.' },
    { el: '.chord-row', where: 'edit', title: 'Chords',
      text: `This song’s chords, numbered. Click one, or press <kbd>${A}1</kbd>–<kbd>9</kbd>, to put it at the cursor. ` +
        '<b>[ ]</b>, or typing <kbd>[</kbd>, searches every chord there is. <b>Replace…</b> swaps one chord for another all through the song.' },
    { el: '.editor-pane .pane-head', where: 'edit', title: 'Editor tools',
      text: '<b>Page break</b> starts a new printed page. <b>Dictate</b>, where your browser can, types what you sing. ' +
        '<b>Reprocess</b> tidies an imported chart, and <b>Clear chords</b> strips them so you can write new ones.' },
    { el: '#riffs-authoring', where: 'edit', title: 'Parts',
      text: '<b>+ Pattern</b> adds a strumming pattern: click a slot to cycle it through down, up, muted and skip. ' +
        '<b>+ Riff</b> adds a tab grid for a riff or a solo. Patterns print with the chart; each riff gets a page of its own. The example has two patterns and a riff.' },

    // The chart
    { el: '#pane-resizer', where: 'chart', only: 'desktop', title: 'Make room',
      text: 'Drag to share the width between the editor and the chart. Double-click to even it up again.' },
    { el: '.pane-tabs', where: 'chart', only: 'desktop', title: 'Chart and Reference',
      text: 'The right-hand column has two tabs: the chart you read, and the reference charts for the band. The Preview view shows both side by side.' },
    { el: '#roadmap', where: 'chart', title: 'The form',
      text: 'The song’s sections in order. Click one to jump the chart to it.' },
    { el: '#preview-body', where: 'chart', side: 'left', title: 'The chart',
      text: `Chords sit over the syllables they belong to. Drag a chord along its line, or onto another line, and the editor follows; <kbd>${C}Z</kbd> undoes it. ` +
        'The strumming patterns sit above it, and the riffs follow it.' },
    { el: '.view-toggles', where: 'chart', title: 'Numbers',
      text: 'Shows the chords as Nashville numbers, 1 to 7 in the key, so the band can play along in any key you call.' },
    { el: '.print-ctl', where: 'chart', title: 'Share, export and print',
      text: '<b>Share</b> makes a link, and a QR code, that opens this song on any device. <b>Export</b> downloads it as a .cho file. ' +
        '<b>Print</b> holds the paper options, one or two columns, and the print itself.' },
    { el: '#song-summary', where: 'chart', only: 'phone', title: 'Key, tempo and tuning',
      text: 'On the chart tabs the song’s key, tempo and tuning fold into this line. Tap it to open them.' },
    { el: '#mbar-perform', where: 'chart', only: 'phone', title: 'Perform',
      text: 'The chart full screen for the stage, with auto-scroll and bigger type.' },

    // The reference
    { el: '#instrument-bar', where: 'ref', title: 'Instruments',
      text: 'Switch on the instruments in the room: guitars, lap steel, mandolin, ukulele, piano, bass, harmonica. Each one gets its own charts below.' },
    { el: '#theory-panel', where: 'ref', title: 'Theory',
      text: 'The key, its signature and relative minor, and the key’s chords as numerals, with the ones this song uses picked out.' },
    { el: '#harmonica-panel', where: 'ref', title: 'Harmonica',
      text: 'Which harp to reach for in this key: cross harp for blues and folk, straight, or slant.' },
    { el: '#instrument-panels .sp-ctls', where: 'ref', title: 'Scale maps',
      text: 'Pick the root and scale for the fret maps below, and a chord to light up inside them.' },
    { el: '#instrument-panels .inst-panel', where: 'ref', title: 'Chord charts',
      text: 'Every chord in the song, for each instrument, with a menu of other voicings under it. Click a chord’s name to light its notes on the scale map. ' +
        'Fold any section from its heading; it stays folded.' },

    // Tools and modes
    { el: '#metro-btn', where: 'header', title: 'Metronome',
      text: 'A click, with a drum grid to build a groove on.' },
    { el: '#tuner-btn', where: 'header', title: 'Tuner',
      text: 'Listens through your microphone. Pick the instrument and tuning, and it takes you string by string.' },
    { el: '#capture-btn', where: 'header', title: 'Record',
      text: 'Records takes from your audio interface. Press <kbd>R</kbd> anywhere, even on stage, to catch an idea. Takes are kept with the song.' },
    { el: '#learn-btn', where: 'header', title: 'Learn',
      text: 'Theory charts to study and print: chords, keys, inversions and rhythm.' },
    { el: '#perform-btn', where: 'header', only: 'desktop', title: 'Perform',
      text: 'The chart full screen for the stage: columns, type size, auto-scroll, and song to song through a setlist.' },
    { el: '#help-btn', where: 'header', title: 'Help',
      text: 'Come back here for this tour, the example song, and the keyboard shortcuts. <kbd>?</kbd> opens it too.' },

    { title: 'That’s the tour',
      text: exampleStays
        ? 'The example song stays in your list to play with: change it, print it, or delete it. Start a song of your own with <b>New</b>.'
        : 'You’re back where you were. The example song is in Help whenever you want it, and <b>New</b> starts a song of your own.' },
  ];
}

// Run the tour on the example song, then put everything back: the song you
// had open, the view, the right-hand tab, the phone tab. An example the tour
// opened just for itself goes again, unless you changed it along the way.
function startTour() {
  if (!(window.driver && window.driver.js && window.driver.js.driver)) {
    alert('The tour could not load. Reload the page and try again.');
    return;
  }
  closeHelp();
  document.getElementById('tour-invite')?.remove();
  const before = { id: currentId, layout: prefs.layout, rightTab: prefs.rightTab, phoneTab: prefs.phoneTab };
  const existed = songs.some((s) => s.example);
  const ex = openExampleSong();
  const stamp = ex.updated;
  const phone = tourPhone();

  // Keep the steps this screen has; each one's pane is revealed as the tour
  // moves onto it (driver.js looks ahead at the next step's element, so the
  // reveal can't ride along with that lookup).
  const plan = tourSteps(existed)
    .filter((st) => !st.only || st.only === (phone ? 'phone' : 'desktop'))
    .filter((st) => !st.el || document.querySelector(st.el));
  const steps = plan.map((st) => ({
    element: st.el || undefined,
    popover: { title: st.title, description: st.text, side: phone ? undefined : st.side },
  }));
  let tour = null;
  const go = (dir) => {
    const to = (tour.getActiveIndex() ?? 0) + dir;
    if (to < 0) return;
    if (to >= plan.length) { tour.destroy(); return; }
    tourReveal(plan[to].where);
    requestAnimationFrame(() => tour.moveTo(to)); // after the revealed pane has laid out
  };

  tour = window.driver.js.driver({
    steps,
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Done',
    popoverClass: 'jtw-tour',
    overlayOpacity: 0.6,
    stagePadding: 6,
    stageRadius: 8,
    smoothScroll: true,
    onNextClick: () => go(1),
    onPrevClick: () => go(-1),
    onDestroyed: () => {
      const s = songs.find((x) => x.id === ex.id);
      let removed = false;
      if (!existed && s && s.updated === stamp) {
        songs = songs.filter((x) => x.id !== ex.id);
        if (mode === 'local') saveSongs(songs);
        removed = true;
      }
      prefs.layout = before.layout;
      applyLayout();
      setRightTab(before.rightTab);
      if (phone) setPhoneTab(before.phoneTab || 'edit'); else prefs.phoneTab = before.phoneTab;
      savePrefs();
      if (before.id && songs.some((x) => x.id === before.id)) selectSong(before.id);
      else if (removed) {
        if (songs.length) selectSong([...songs].sort((a, b) => b.updated - a.updated)[0].id);
        else showEmptyState();
      }
      renderList();
    },
  });
  tour.drive();
}

// The Help dialog's two ways in.
document.getElementById('help-tour').addEventListener('click', startTour);
document.getElementById('help-example').addEventListener('click', () => { closeHelp(); openExampleSong(); });
