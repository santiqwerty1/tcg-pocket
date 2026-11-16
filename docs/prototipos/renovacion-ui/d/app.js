/* Maqueta D · «Fusión»: the skin and the way of use of B, the answer first of A and the boards of C.
   Plain JavaScript: a hash router, one render function per screen, one sheet layer and ONE frame driven by a description of
   each route (its views and its main action). Everything it shows comes from window.DATOS (../datos.js); nothing is invented. */
(function () {
  'use strict'
  const D = window.DATOS
  const root = document.documentElement
  const $ = (sel, el) => (el || document).querySelector(sel)
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel))
  /* what a table holds under a key that comes from the address: only its own entries, never what every object inherits
     («constructor», «toString», «__proto__» typed by hand in an address are unknown keys like any other) */
  const own = (table, k) => (k != null && Object.prototype.hasOwnProperty.call(table, k) ? table[k] : undefined)
  const NB = ' '
  /* The browser's own scroll restoration is switched off: this page keeps the scroll of every screen itself (see «Scroll», next to
     the router). Left to the browser, «atrás» moved the page to the scroll of the entry it was going to BEFORE the screen being
     left could be read, and a reload restored the page by an anchor element while the entrance animation still had the content
     14 px lower: every reload left the page 14 px further down. */
  try { history.scrollRestoration = 'manual' } catch (e) { /* a browser without it restores as it always did */ }

  /* ───────────── Formatting ───────────── */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })
  const nf1 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const nf2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const num = (v) => nf.format(v)
  /* a percentage as the app writes it: up to one decimal, never a forced «,0» («50 %», «51,1 %») */
  const pct = (v) => nf.format(v) + NB + '%'
  /* the same inside a column of a board or of a list, where they have to line up: always one decimal («50,0 %» under «56,3 %») */
  const pct1 = (v) => nf1.format(v) + NB + '%'
  const nTxt = (n) => 'n' + NB + '=' + NB + nf.format(n)
  const ciTxt = (ci) => 'IC' + NB + '95' + NB + '%: ' + nf1.format(ci[0]) + '–' + nf1.format(ci[1]) + NB + '%'
  const ciShort = (ci) => 'IC' + NB + nf1.format(ci[0]) + '–' + nf1.format(ci[1])
  /* a record is one datum: no line ends inside «303 V · 291 D · 6 E» (it used to break before a «·») */
  const recTxt = (r) => num(r.v) + NB + 'V' + NB + '·' + NB + num(r.d) + NB + 'D' + (r.e ? NB + '·' + NB + num(r.e) + NB + 'E' : '')
  /* points and trends carry one decimal too, like the percentages («+2,0» over «−1,6») */
  const signed = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + nf1.format(Math.abs(v))
  /* A Pokémon's name is never split, wherever it is written: «ex» and the lone letter of «Mega-Charizard Y ex» stay with the word
     before them (a no-break space) — glue — and a hyphenated name («Mega-Sceptile») never breaks at its hyphen (a word joiner
     after it). Never used for attributes.
     · run(text)   both rules: running text (the sentences of the data name decks and cards) and a name that has the room. In a
                   sentence the slash of a deck's name stays at the end of its line («#82 Mega-Altaria ex /», then «Espeon»), as
                   in a title, and so does the «·» between two data («… profundidad 3 ·», then «C1»: SEP, below); a figure
                   stays with its unit («+16,3 puntos») and a figure made of several pieces is never split between two
                   lines: «n = 750», an interval («30,0–66,5 %»: a line may end after a dash) and «+9,9 a +16,4»;
     · soft(name)  only the glue: the narrow tiles and captions of a card (70 to 112 px), where «Mega-Sceptile ex» cannot go in
                   one line and the hyphen is the one decent place to break it. */
  const glue = (s) => s.replace(/ ([XY]) (?=ex(?![\p{L}\p{N}]))/gu, NB + '$1 ').replace(/(?<=[\p{L}\p{N}]) ex(?![\p{L}\p{N}])/gu, NB + 'ex')
  const joined = (s) => s.replace(/-(?=\p{L})/gu, '-\u2060')
  /* one piece that never breaks (white-space: nowrap), for what is HTML: the text inside stays as it is */
  const nb = (html) => '<span class="nb">' + html + '</span>'
  /* Two rules for a line made of several data («para #24 … · Suicune · A4a», «comprar · 150 pts · Charizard · A1»):
     · tight(text)   a datum that is ONE thing («Suicune · A4a», «comprar · 150 pts», «Mega-Charizard Y ex») is never split: its
                     spaces are no-break spaces and its hyphens carry a word joiner. It stays plain text (no «nowrap»), so in a
                     column narrower than the datum the last resort of the CSS (overflow-wrap) can still break it;
     · SEP           the «·» between two data: a line may END with it, it never STARTS with it (a no-break space before, a
                     plain one after). */
  const tight = (s) => joined(esc(s)).replace(/ /g, NB)
  const SEP = NB + '· '
  const WHOLE = /\bn = \d[\d.]*|[+−-]?\d[\d.,]*–[+−-]?\d[\d.,]*(?:[ \u00a0]%)?|[+−]\d[\d.,]* a [+−]\d[\d.,]*/g
  const run = (s) => joined(glue(esc(s))).replace(/ \/ /g, NB + '/ ').replace(/ · /g, SEP).replace(/(\d) (?=(?:puntos?|pts?|veces|vez|d[ií]as?)(?![\p{L}\p{N}]))/gu, '$1' + NB).replace(WHOLE, nb)
  const soft = (s) => glue(esc(s))
  const plain = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  /* Searching, one rule for every field that filters by what is typed (the launcher, the filter of Mazos, the search of
     Colección, the suggested rivals): the text is cut into words and EVERY word has to be in the name, in any order. A hyphen
     and a slash count as a space on both sides, so «mega charizard» and «mega-charizard» both find the deck «Mega-Charizard Y ex
     / Entei ex» and the rival «Mega Charizard Y ex Entei ex»; a word typed with its hyphen («b4-103») is looked for as that
     phrase («b4 103»), so a code stays exact.
     · flat(text)    lower case, no accents, hyphen and slash as spaces: the SAME length as the text (positions still match)
     · wordsOf(q)    the words of what was typed
     · finds(words, text)   true when the text holds them all (no words: everything matches) */
  const flat = (s) => plain(s).replace(/[-/]/g, ' ')
  const squash = (s) => flat(s).replace(/\s+/g, ' ').trim()
  const wordsOf = (q) => String(q).split(/\s+/).map(squash).filter(Boolean)
  const finds = (words, text) => { const t = squash(text); return words.every((w) => t.indexOf(w) >= 0) }
  function dayTxt(iso) {
    const diff = Math.round((Date.parse(D.hoy.fecha) - Date.parse(iso)) / 86400000)
    if (diff === 0) return 'hoy'
    if (diff === 1) return 'ayer'
    const p = iso.split('-')
    return Number(p[2]) + '/' + Number(p[1])
  }
  const shortDate = (iso) => { const p = iso.split('-'); return Number(p[2]) + '/' + Number(p[1]) }

  /* ───────────── Icons (drawn for this mock-up) ───────────── */
  const ICON = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    stack: '<path d="M12 3.5 3.5 8l8.5 4.5L20.5 8 12 3.5Z"/><path d="m3.5 12 8.5 4.5 8.5-4.5"/><path d="m3.5 16 8.5 4.5 8.5-4.5"/>',
    cards: '<rect x="3.2" y="5.2" width="10" height="14" rx="2" transform="rotate(-9 8.2 12.2)"/><rect x="10.8" y="4.8" width="10" height="14" rx="2" transform="rotate(9 15.8 11.8)"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M8.5 20h7M10 17h4v3h-4z"/>',
    flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M7.6 15h8.8"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h10M18 17h2"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="16" cy="17" r="2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    back: '<path d="m14.5 5-7 7 7 7"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    right: '<path d="m9.5 5 7 7-7 7"/>',
    left: '<path d="m14.5 5-7 7 7 7"/>',
    down: '<path d="m5 9.5 7 7 7-7"/>',
    more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
    sync: '<path d="M4.5 11a7.5 7.5 0 0 1 13-4.5L20 9M20 4.5V9h-4.5M19.5 13a7.5 7.5 0 0 1-13 4.5L4 15M4 19.5V15h4.5"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4"/>',
    play: '<path d="M8 5.5v13l10.5-6.5L8 5.5Z"/>',
    tag: '<path d="M4 4h7.5l8.5 8.5-7.5 7.5L4 11.5V4Z"/><circle cx="8.3" cy="8.3" r="1.2"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="10" y="10" width="4" height="4"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    gift: '<rect x="4" y="10" width="16" height="10" rx="1.5"/><path d="M3 7h18v3H3zM12 7v13M12 7c-1.5-4-6-3.5-5 0M12 7c1.5-4 6-3.5 5 0"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    up: '<path d="m4 16 5.5-5.5 3.5 3.5L20 7M15 7h5v5"/>',
    downtrend: '<path d="m4 8 5.5 5.5L13 10l7 7M15 17h5v-5"/>',
    person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    bot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4.5V8M9.5 13v1.5M14.5 13v1.5"/><circle cx="12" cy="3.5" r="1"/>',
    list: '<path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20M4 6.5h.5M4 12h.5M4 17.5h.5"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
    undo: '<path d="M8.5 7.5 4 12l4.5 4.5M4 12h10.5a5 5 0 0 1 0 10H12"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.5v.5"/>',
    save: '<path d="M12 3.5v10M8 9.5l4 4 4-4M5 16.5v3.5h14v-3.5"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16.5 6.5l3 3M14 9l2 2"/>',
    door: '<path d="M10 4H5v16h5M14 8l4 4-4 4M9 12h9"/>',
    medal: '<circle cx="12" cy="14.5" r="5.5"/><path d="M8.5 3.5 12 9l3.5-5.5M12 12.5v4"/>',
    vs: '<rect x="3.5" y="6" width="7" height="12" rx="1.5"/><rect x="13.5" y="6" width="7" height="12" rx="1.5"/><path d="M12 9v6"/>',
  }
  const ico = (name, size) => '<svg width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>'
  const CHEV = ico('right', 18)

  /* Energy glyphs: generic shapes drawn for the app (leaf, flame, drop, bolt, eye, fist, moon, hexagon, swirl, spark). */
  const GLYPH = {
    grass: '<path fill="currentColor" d="M19.5 4C11 4 5 8.2 5 15.2c0 1.1.2 2.1.5 3C8 13 11.5 9.8 16 8.2c-4 2.4-6.8 5.8-8.4 10.9.9.6 2 .9 3.2.9 6.4 0 9.2-7 8.7-16Z"/>',
    fire: '<path fill="currentColor" d="M12.6 2c.6 3.3-1.2 5-2.8 6.8C8.3 10.5 7 12.2 7 14.6 7 17.7 9.3 20.5 12.4 20.5c3 0 5.1-2.5 5.1-5.4 0-1.9-.8-3.3-1.7-4.5-.3 1.2-.9 2-1.8 2.6.4-3.5-.3-7.8-1.4-11.2Z"/>',
    water: '<path fill="currentColor" d="M12 2.5c3 4 6 7.4 6 11.2a6 6 0 0 1-12 0c0-3.8 3-7.2 6-11.2Z"/>',
    lightning: '<path fill="currentColor" d="M13.6 2 5 13.3h5.2L9 22l9-12h-5.3L13.6 2Z"/>',
    psychic: '<path fill="currentColor" fill-rule="evenodd" d="M2 12c2.6-4.4 6-6.6 10-6.6s7.4 2.2 10 6.6c-2.6 4.4-6 6.6-10 6.6S4.6 16.4 2 12Zm10-3.6a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Zm0 2.2a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Z"/>',
    fighting: '<path fill="currentColor" d="M6.5 10.8V8.3a1.6 1.6 0 0 1 3.2 0v-.8a1.6 1.6 0 0 1 3.2 0v.5a1.6 1.6 0 0 1 3.2 0v.9a1.5 1.5 0 0 1 3 0V14c0 3.9-2.7 6.5-6.5 6.5-3 0-5-1.4-6.2-3.9l-2-3a1.5 1.5 0 0 1 2.4-1.8l-.3-1Z"/>',
    darkness: '<path fill="currentColor" d="M20 14.3A8.5 8.5 0 0 1 9.7 4 8.5 8.5 0 1 0 20 14.3Z"/>',
    metal: '<path fill="currentColor" fill-rule="evenodd" d="m12 2.5 8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5L12 2.5Zm0 5.5-3.5 2v4l3.5 2 3.5-2v-4L12 8Z"/>',
    dragon: '<path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M12 12.3a1.8 1.8 0 1 0-1.8-1.8c0 2.7 2.2 4.4 4.8 4.4 3 0 5-2.4 5-5.3C20 6 16.9 3.6 13 3.6 8 3.6 4 7.3 4 12.3c0 4.6 3.6 8.2 8.2 8.2 2.4 0 4.4-.8 6-2.2"/>',
    colorless: '<path fill="currentColor" d="M12 2.5c.9 5 2.6 6.7 9.5 9.5-6.9 2.8-8.6 4.5-9.5 9.5-.9-5-2.6-6.7-9.5-9.5 6.9-2.8 8.6-4.5 9.5-9.5Z"/>',
    /* a card with no type (a trainer): the outline of a card */
    none: '<path fill="currentColor" fill-rule="evenodd" d="M7.5 3h9A2.5 2.5 0 0 1 19 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18.5v-13A2.5 2.5 0 0 1 7.5 3Zm.5 3v12h8V6H8Zm2 2.5h4v4h-4v-4Z"/>',
  }
  const gem = (e, cls) => '<span class="gem ' + (cls || '') + '" data-e="' + e + '" role="img" aria-label="' + esc((D.energias[e] || {}).nombre || e) + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + (GLYPH[e] || GLYPH.colorless) + '</svg></span>'
  const gems = (list, cls) => '<span class="gems">' + list.map((e) => gem(e, cls)).join('') + '</span>'
  const acc = (list) => '--acc:var(--e-' + list[0] + ');' + (list[1] ? '--acc2:var(--e-' + list[1] + ');' : '')
  /* the name of a deck («Mega-Charizard Y ex / Entei ex»), in up to two lines and never cut. A Pokémon's name is never split:
     «ex» and a lone letter stay with the word before them («Mega-Charizard Y ex» is one piece), and what comes after the slash
     is one piece too. So a line can only end after the number, between two real words, or at the slash: after it when
     «#N first name /» fits in the first line, before it when only «#N first name» does. */
  const unsplit = (part) => part.split(' ').reduce((groups, w) => { if (groups.length && /^(ex|[A-Z])$/.test(w)) groups[groups.length - 1] += ' ' + w; else groups.push(w); return groups }, [])
    .map((g) => (g.indexOf(' ') < 0 ? joined(esc(g)) : '<span class="nb">' + joined(esc(g)) + '</span>')).join(' ')
  const dn = (name) => {
    /* «Cachorros (Growlithe / Lillipup)»: what is in brackets is one piece, slash and all */
    const par = /^(.*\S) (\([^()]*\))$/.exec(name)
    if (par) return unsplit(par[1]) + ' <span class="nb">' + joined(esc(par[2])) + '</span>'
    const at = name.lastIndexOf(' / ')
    /* the piece after the slash carries the word joiner too: narrower than 360 px its pieces may break at their spaces
       (estilos.css), and even then never at a hyphen */
    return at < 0 ? unsplit(name) : unsplit(name.slice(0, at)) + ' / <span class="nb">' + joined(esc(name.slice(at + 3))) + '</span>'
  }
  /* the name of an archetype («Mega Mewtwo X ex Mew ex»: no slash): «ex» and a lone letter stay with the word before them, so a
     second line never starts with «ex» */
  const an = (name) => esc(name).replace(/ (ex|[A-Z])(?= |$)/g, NB + '$1')
  const energyNames = (list) => list.map((e) => D.energias[e].nombre).join(' y ')

  /* ───────────── Thumbnails ───────────── */
  const imgTag = (src, alt) => '<img src="' + esc(src) + '" alt="' + esc(alt || '') + '" loading="lazy" decoding="async" width="63" height="88" onerror="this.parentNode.classList.add(\'failed\')">'
  /* no image (it failed, or thumbnails are off): a tile on the type colour. A small one shows the glyph of the type (the name is
     written right beside it); a big one (the grid, the card sheet) shows the name. Which one is decided in the CSS. */
  const thumb = (src, name, type, cls) => '<span class="thumb ' + (cls || '') + '" data-e="' + (type || 'none') + '">' + imgTag(src, '') + '<span class="thumb-g" aria-hidden="true"><svg viewBox="0 0 24 24">' + (GLYPH[type] || GLYPH.none) + '</svg></span><span class="thumb-name">' + soft(name) + '</span></span>'
  const crop = (src, name, type, mode) => '<span class="crop ' + (mode || 'tall') + '" data-e="' + (type || 'none') + '">' + imgTag(src, name) + '<span class="thumb-name" aria-hidden="true">' + soft(name) + '</span></span>'
  /* the strip of crops; if an image fails, one tile on the type colour takes its place: the glyph of the type and the first name,
     whole — or just the glyph where the row is narrow or the name does not fit whole (fitTiles; it is written right beside) */
  const art = (deck, max) => '<span class="art" data-e="' + (deck.miniaturasDe[0].tipo || 'none') + '">' + deck.miniaturas.slice(0, max || 3).map((src, i) => crop(src, deck.miniaturasDe[i].nombre, deck.miniaturasDe[i].tipo)).join('') +
    '<span class="art-fb" aria-hidden="true"><svg viewBox="0 0 24 24">' + (GLYPH[deck.miniaturasDe[0].tipo] || GLYPH.colorless) + '</svg><span>' + run(deck.miniaturasDe[0].nombre) + '</span></span></span>'
  /* The tile that takes the place of a deck's art when an image fails shows the first name only if it holds it whole (the name
     breaks between two real words and nowhere else); otherwise it is just the glyph. It is measured, because it depends on the
     font that is in use: when an image fails, when the fonts arrive and when the window changes its width. */
  function fitTiles(scope) {
    $$('.art-fb', scope || document).forEach((fb) => {
      const name = fb.lastElementChild
      fb.classList.remove('named', 'tight')
      if (!fb.offsetWidth || !name || !name.offsetWidth) return     // not on screen (the images are there), or a row whose tile never carries the name
      fb.classList.add(name.scrollWidth > name.clientWidth + 1 || name.offsetHeight > fb.clientHeight ? 'tight' : 'named')
    })
  }
  function packArt(code) {
    const id = 'pk' + (++packArt.n)
    return '<span class="pack" aria-hidden="true"><svg viewBox="0 0 70 98"><defs>' +
      '<linearGradient id="' + id + 'a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3fd6c6"/><stop offset=".5" stop-color="#8b9cff"/><stop offset="1" stop-color="#e6a4ff"/></linearGradient>' +
      '<linearGradient id="' + id + 'b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="M5 8l5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5V90l-5 5-5-5-5 5-5-5-5 5-5-5-5 5-5-5-5 5-5-5-5 5-5-5Z" fill="url(#' + id + 'a)"/>' +
      '<path d="M5 13h60v3H5zM5 82h60v3H5z" fill="#0b0f14" opacity=".2"/>' +
      '<path d="M10 16h18L16 82H5V34Z" fill="url(#' + id + 'b)" opacity=".55"/>' +
      '<circle cx="35" cy="41" r="15" fill="#0b0f14" opacity=".92"/>' +
      '<path d="M35 29c1 6.5 3.5 9 10 12-6.5 3-9 5.5-10 12-1-6.5-3.5-9-10-12 6.5-3 9-5.5 10-12Z" fill="url(#' + id + 'a)"/>' +
      '</svg><span class="pack-code">' + esc(code) + '</span></span>'
  }
  packArt.n = 0

  /* ───────────── Small charts and marks ───────────── */
  const ORI = '<i class="ori" role="img" aria-label="orientativo"></i>'
  const COV = '<i class="cov" role="img" aria-label="sin cruces con datos en el meta"></i>'
  /* a tournament number whose archetype has no matchup with data in the meta (cobertura 0): it carries the mark COV wherever it is written */
  const noCover = (st) => Boolean(st) && st.cobertura === 0
  const COV_KEY = '<span>' + COV + 'sin cruces con datos</span>'
  const SHAPE = {
    v: '<circle cx="6" cy="6" r="4.6" fill="currentColor"/>',
    d: '<path d="m2.6 2.6 6.8 6.8M9.4 2.6 2.6 9.4" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>',
    e: '<path d="M2 4.2h8M2 7.8h8" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>',
  }
  const shape = (r, s) => '<svg width="' + (s || 12) + '" height="' + (s || 12) + '" viewBox="0 0 12 12" aria-hidden="true">' + SHAPE[r] + '</svg>'
  const RES = { v: 'Victoria', d: 'Derrota', e: 'Empate' }
  const RES_KEY = { Victoria: 'v', Derrota: 'd', Empate: 'e' }
  function icBar(p, ci, o) {
    o = o || {}
    const min = o.min == null ? 0 : o.min
    const max = o.max == null ? 100 : o.max
    const x = (v) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))
    return '<div class="ic" role="img" aria-label="' + esc(pct(p) + (ci ? ', ' + ciTxt(ci) : '')) + '">' +
      (min <= 50 && max >= 50 && !o.noMid ? '<i class="mid" style="left:' + x(50) + '%"></i>' : '') +
      (ci ? '<i class="band" style="left:' + x(ci[0]) + '%;width:' + (x(ci[1]) - x(ci[0])) + '%"></i>' : '') +
      (o.ref != null ? '<i class="ref" style="left:' + x(o.ref) + '%"></i>' : '') +
      '<i class="pt" style="left:' + x(p) + '%"></i></div>'
  }
  function spark(series, w, h) {
    w = w || 58; h = h || 22
    const max = Math.max.apply(null, series.concat(0.1))
    const pts = series.map((v, i) => [3 + (i * (w - 7)) / (series.length - 1), h - 4 - (v / max) * (h - 8)])
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('')
    const last = pts[pts.length - 1]
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc('Cuota en ' + series.length + ' ventanas de ' + winDays() + ' días: ' + series.map(pct).join(', ')) + '">' +
      '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.7" fill="currentColor"/></svg>'
  }
  /* Diverging bar around a centre: range = how far from the centre fills half the bar. */
  function divBar(v, centre, range) {
    centre = centre == null ? 50 : centre
    range = range || 50
    const w = Math.min(50, (Math.abs(v - centre) / range) * 50)
    return '<div class="divbar" aria-hidden="true">' + (v >= centre ? '<i class="up" style="left:50%;width:' + w + '%"></i>' : '<i class="down" style="left:' + (50 - w) + '%;width:' + w + '%"></i>') + '</div>'
  }
  function plot(xs, series) {
    const n = xs.length
    const X = (i) => (i / (n - 1)) * 100
    const Y = (v) => 100 - v
    const path = (ys) => ys.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(2) + ' ' + Y(v).toFixed(2)).join('')
    let html = '<div class="plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      [0, 50, 100].map((g) => '<line class="grid" x1="0" x2="100" y1="' + g + '" y2="' + g + '"/>').join('') +
      series.slice().reverse().map((s) => '<path class="' + s.cls + '" d="' + path(s.ys) + '"/>').join('') + '</svg>'
    html += [100, 50, 0].map((v) => '<span class="yl" style="top:' + (100 - v) + '%">' + v + NB + '%</span>').join('')
    html += xs.map((x, i) => '<span class="xl" style="left:' + X(i) + '%">' + esc(x) + '</span>').join('')
    /* Labels: the last point of each series is labelled to the right of the plot; the others go above or below the point,
       whichever keeps clear of the 50 % line and of the other series (heights in px: the plot is 132 px tall). */
    const H = 132
    const py = (v) => ((100 - v) / 100) * H
    const ends = []
    series.forEach((s, k) => s.labels.forEach((i) => {
      const y = py(s.ys[i])
      const cls = k ? ' b' : ''
      html += '<i class="pt' + cls + '" style="left:' + X(i) + '%;top:' + Y(s.ys[i]) + '%"></i>'
      if (i === n - 1) { ends.push({ y: y, cls: cls, text: pct(s.ys[i]) }); return }
      const others = series.filter((o) => o !== s).map((o) => py(o.ys[i]))
      const cost = (top, bottom, natural) => (top - 3 <= H / 2 && bottom + 3 >= H / 2 ? 4 : 0) + (top < -20 || bottom > H - 2 ? 3 : 0) + others.reduce((a, oy) => a + (oy >= top - 6 && oy <= bottom + 6 ? 3 : 0), 0) + (natural ? 0 : 1)
      const up = cost(y - 24, y - 8, k === 0) <= cost(y + 8, y + 24, k !== 0)
      html += '<span class="val' + cls + (up ? ' up' : ' down') + (i === 0 ? ' start' : '') + '" style="left:' + X(i) + '%;top:' + Y(s.ys[i]) + '%">' + pct(s.ys[i]) + '</span>'
    }))
    ends.sort((a, b) => a.y - b.y).forEach((e, j, all) => { if (j && e.y - all[j - 1].y < 17) e.y = all[j - 1].y + 17 })
    ends.forEach((e) => { html += '<span class="val end' + e.cls + '" style="top:' + e.y.toFixed(1) + 'px">' + e.text + '</span>' })
    return html + '</div>'
  }
  const changeTags = (list) => '<div class="changes">' + list.map((c) => '<span class="tag ' + (/^\+/.test(c) ? 'plus' : 'minus') + '">' + esc(c) + '</span>').join('') + '</div>'
  const streak = (r, fresh) => '<span class="streak" role="img" aria-label="Últimas ' + r.length + ': ' + r.join(' ') + '">' + r.map((x, i) => '<i class="dot ' + x.toLowerCase() + (i === r.length - 1 ? ' last' + (fresh ? ' new' : '') : '') + '"></i>').join('') + '</span>'
  const distBar = (r) => '<span class="dist" aria-hidden="true">' + ['v', 'd', 'e'].map((k) => (r[k] ? '<i class="' + k + '" style="flex:' + r[k] + '"></i>' : '')).join('') + '</span>'

  /* ───────────── State ───────────── */
  /* Two layers. «saved» is what the menu (Aspecto) chose and is the only thing written to localStorage. «fromUrl» holds the
     parameters tema / movimiento / vistas for this load only: a link without parameters always opens as saved (dark and the
     views in the fixed row when nothing was chosen). */
  const STORE = 'maquetaD.aspecto.v1'
  const saved = { tema: 'oscuro', movimiento: 'expresivo', vistas: 'abajo', miniaturas: 'si' }
  try { Object.assign(saved, JSON.parse(localStorage.getItem(STORE) || '{}')) } catch (e) { /* file:// without storage */ }
  const fromUrl = {}
  /* What the menu chooses wins over every address that was already in the history. Each entry of the history is stamped with
     the moment it was first drawn (render: «t» in its state); «menuAt» keeps when the menu last changed each key. A parameter
     that arrives in an entry older than that choice («Volver», atrás, adelante) no longer changes the look, and is taken out of
     the address. A NEW address with the parameter still applies in place, and so does any parameter after a reload. */
  const menuAt = {}
  const clock = () => (performance.timeOrigin || 0) + performance.now()
  const isStale = (k, t) => Boolean(menuAt[k]) && t != null && t <= menuAt[k]
  const pref = (k) => fromUrl[k] || saved[k]
  const reduceMotion = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false }
  const lightScheme = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : { matches: false }
  const motion = () => (reduceMotion.matches ? 'ninguno' : pref('movimiento'))
  function applyPrefs() {
    const dark = pref('tema') === 'sistema' ? !lightScheme.matches : pref('tema') !== 'claro'
    root.dataset.tema = dark ? 'oscuro' : 'claro'
    root.dataset.movimiento = motion()
    root.dataset.vistas = pref('vistas')
    root.dataset.miniaturas = pref('miniaturas')
    const meta = $('meta[name="theme-color"]')
    if (meta) meta.content = dark ? '#0a0e14' : '#f1eee8'
  }
  function setPref(k, v) {
    saved[k] = v
    delete fromUrl[k]
    menuAt[k] = clock()
    try { localStorage.setItem(STORE, JSON.stringify(saved)) } catch (e) { /* ignore */ }
    applyPrefs()
  }
  const OPTIONS = { tema: ['oscuro', 'claro', 'sistema'], movimiento: ['expresivo', 'sutil', 'ninguno'], vistas: ['abajo', 'arriba'] }
  /* t: when the entry that carries these parameters was first drawn (nothing: it is the load itself) */
  function prefsFromUrl(params, t) {
    let changed = false
    Object.keys(OPTIONS).forEach((k) => {
      const v = params[k]
      if (!v || OPTIONS[k].indexOf(v) < 0 || isStale(k, t)) return
      if (pref(k) !== v) { fromUrl[k] = v; changed = true }
    })
    if (changed) applyPrefs()
    return changed
  }

  /* What the screens remember while the page is open. ui.open = keys of the rows and notes that are unfolded;
     ui.sort[boardId] = { k: column, rev: reversed } for each sortable board. */
  const ui = { deckFilter: 'todos', deckQuery: '', listMode: 'lista', jobFilter: 'todas', metaFilter: 'todos', colFilter: 'todas', colQuery: '', open: new Set(), sort: { pick: { k: 'torneo', rev: false } } }
  const deckInfo = (id) => D.hoy.mazosSesion.find((m) => m.id === id) || D.hoy.mazosDelDia.find((m) => m.id === id) || D.mazos.find((m) => m.id === id)
  const deckName = (id) => { const m = D.mazos.find((x) => x.id === id); return m ? m.nombre : '' }
  const deckLabel = (id) => { const m = D.mazos.find((x) => x.id === id); return m ? '#' + m.id + ' ' + m.nombre : '#' + id }
  const CARDS = {}
  ;[].concat(D.mazo.cartas.pokemon, D.mazo.cartas.entrenadores, D.buscar.cartas, D.cartas.coleccion.muestra).forEach((c) => { CARDS[c.id] = Object.assign({}, CARDS[c.id], c) })
  /* Cards the data shows without their code (the ones missing in Sobres, the ones seen in the example match): they are kept by
     name («n:Espeon»), with what the data says about them, so the launcher finds every card the mock-up shows somewhere. */
  const cardNamed = (name) => Object.keys(CARDS).map((k) => CARDS[k]).find((c) => c.nombre === name)
  D.cartas.sobres.faltan.forEach((f) => { const c = cardNamed(f.carta); if (c) c.falta = f; else CARDS['n:' + f.carta] = { nombre: f.carta, imagen: f.imagen, tipo: f.tipo, falta: f } })
  D.partida.cartasVistasEjemplo.forEach((c) => { if (!cardNamed(c.nombre)) CARDS['n:' + c.nombre] = { nombre: c.nombre, imagen: c.imagen, tipo: c.tipo } })
  const cardKey = (c) => c.id || 'n:' + c.nombre
  const plural = (n, one, many) => (n === 1 ? one : many)

  /* ───────────── The session: what was saved in this visit, on top of what the data says ─────────────
     Nothing is ever counted twice and nothing is counted without «Guardar»: every number that depends on the matches (the day's
     record, the streak, the week, each deck's «hoy», its dots and its «mías», the list of last matches) is DERIVED from the data
     plus these three variables. Saving adds one entry to «sesion»; «Deshacer» takes that entry out, or, when the saved state was
     opened by its direct link (the match is the last one the data already counts), sets «quitada». */
  const sesion = []          // matches saved in this visit, newest first: { id, deckId, result: 'v' | 'd' | 'e', rival, rivalPicked, started, seen, mode, note }
  let quitada = false        // the last match of the data was undone
  let ult = null             // the match the saved state shows: the one «Deshacer» would undo
  let matchSeq = 0
  let freshDeck = null       // deck whose newest dot pops in on the next paint (right after saving)
  const LAST = D.hoy.ultimasPartidas[0]
  const zero = () => ({ v: 0, d: 0, e: 0 })
  const addRec = (a, b) => ({ v: a.v + b.v, d: a.d + b.d, e: a.e + b.e })
  /* what this visit changed, for one deck or (no id) for the day */
  function delta(id) {
    const r = zero()
    sesion.forEach((s) => { if (id == null || s.deckId === id) r[s.result] += 1 })
    if (quitada && LAST && (id == null || LAST.mazoId === id)) r[RES_KEY[LAST.resultado]] -= 1
    return r
  }
  /* the same, for any cut of the matches (one deck against one rival, one deck when it started…): pred(match) picks them.
     A match is { deckId, result, rival, started }. */
  function deltaOf(pred) {
    const r = zero()
    sesion.forEach((s) => { if (pred(s)) r[s.result] += 1 })
    if (quitada && LAST) {
      const g = { deckId: LAST.mazoId, result: RES_KEY[LAST.resultado], rival: LAST.rival, started: LAST.empezo }
      if (pred(g)) r[g.result] -= 1
    }
    return r
  }
  /* Wilson interval of 95 %: the one the app uses; only for the numbers this visit changed (the rest come written in the data) */
  function wilson(v, n) {
    if (!n) return [0, 100]
    const z = 1.959964
    const p = v / n
    const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n)
    const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n)
    const r1 = (x) => Math.round(Math.max(0, Math.min(1, x)) * 1000) / 10
    return [r1(centre - half), r1(centre + half)]
  }
  /* a stat of the data ({ pct, n, ci, record } or with v / d / e at the top, or null) plus a delta; untouched when the delta is empty */
  function withDelta(stat, x) {
    if (!x.v && !x.d && !x.e) return stat
    const r = addRec(stat ? stat.record || stat : zero(), x)
    const n = r.v + r.d + r.e
    if (n <= 0) return null
    return Object.assign({}, stat, { record: r, v: r.v, d: r.d, e: r.e, n: n, pct: Math.round((r.v / n) * 1000) / 10, ci: wilson(r.v, n), orientativo: n < 30 })
  }
  const dayRecord = () => addRec(D.hoy.record, delta())
  const recShort = (r) => r.v + '–' + r.d + (r.e ? '–' + r.e : '')
  const recWords = (r) => r.v + ' ' + plural(r.v, 'victoria', 'victorias') + ', ' + r.d + ' ' + plural(r.d, 'derrota', 'derrotas') + (r.e ? ' y ' + r.e + ' ' + plural(r.e, 'empate', 'empates') : '')
  /* «mías» of a deck as it stands now: use it wherever a screen shows a deck's own matches */
  const miasOf = (id, base) => withDelta(base, delta(id))
  const weekNow = () => withDelta(D.hoy.semana, delta())
  /* today's matches, newest first: the ones of this visit and then the ones the data brings */
  function todaysMatches() {
    const fromData = D.hoy.ultimasPartidas.map((g, i) => ({ ref: 'd' + i, deckId: g.mazoId, result: RES_KEY[g.resultado], rival: g.rival, started: g.empezo, mode: g.modalidad, when: g.cuando, seen: null, note: '' }))
    return sesion.map((s) => Object.assign({}, s, { ref: 's' + s.id, when: 'recién' })).concat(fromData.slice(quitada ? 1 : 0))
  }
  /* the streak that is running: how many of the same result in a row, counting back from the last match */
  function streakNow() {
    const all = todaysMatches()
    if (!all.length) return null
    let n = 0
    while (n < all.length && all[n].result === all[0].result) n += 1
    return { r: all[0].result, n: n }
  }
  /* the decks on the table: the ones of the data, plus any other deck a match was saved with in this visit */
  function sessionDecks() {
    const letters = (id) => sesion.filter((s) => s.deckId === id).map((s) => s.result.toUpperCase()).reverse()
    const rows = D.hoy.mazosSesion.map((m) => {
      const base = quitada && LAST && LAST.mazoId === m.id ? m.racha.slice(0, -1) : m.racha
      return Object.assign({}, m, { hoy: addRec(m.hoy, delta(m.id)), racha: base.concat(letters(m.id)).slice(-8) })
    })
    sesion.slice().reverse().forEach((s) => {
      if (rows.some((r) => r.id === s.deckId)) return
      const m = deckInfo(s.deckId)
      if (m) rows.push(Object.assign({}, m, { hoy: delta(m.id), racha: letters(m.id).slice(-8) }))
    })
    return rows
  }
  /* the decks of the data with what this visit changed: «mías» and the day they were last played */
  const liveDecks = () => D.mazos.map((m) => {
    const x = delta(m.id)
    return x.v || x.d || x.e ? Object.assign({}, m, { mias: withDelta(m.mias, x), ultima: sesion.some((s) => s.deckId === m.id) ? D.hoy.fecha : m.ultima }) : m
  })
  const isExample = (g) => { const ex = D.partida.ejemplo; return g.deckId === ex.mazoId && g.result === RES_KEY[ex.resultado] && g.rival === ex.rival }
  /* true while the matches are exactly the ones of the data (so what the data says about the last match still holds) */
  const stateIsData = () => (!quitada && !sesion.length) || (quitada && sesion.length === 1 && isExample(sesion[0]) && sesion[0].started === D.partida.ejemplo.empezo)
  /* The visit survives a RELOAD of its tab (pulling the page down, the phone bringing the tab back after the game): the matches
     saved in it are kept in sessionStorage — written after every save, undo and delete — and read again only when this load is a
     reload or a step back to the page. Any other way in (the direct link, a typed address, a new tab) starts from the data, as
     the contract of the mock-ups asks, and forgets what was kept. Without this a reload with «Partida guardada» open showed the
     example match of the data as the one just saved, and «Deshacer» then took a match out of the data. */
  const VISIT = 'maquetaD.visita.v1'
  function keepVisit() {
    try { sessionStorage.setItem(VISIT, JSON.stringify({ datos: D.generado, sesion: sesion, quitada: quitada, seq: matchSeq })) } catch (e) { /* no storage (a page opened from the disk in some browsers): the visit lives in memory only */ }
  }
  ;(function restoreVisit() {
    try {
      const nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null
      const old = performance.navigation ? performance.navigation.type : 0
      const type = nav ? nav.type : old === 1 ? 'reload' : old === 2 ? 'back_forward' : 'navigate'
      if (type !== 'reload' && type !== 'back_forward') { sessionStorage.removeItem(VISIT); return }
      const v = JSON.parse(sessionStorage.getItem(VISIT) || 'null')
      if (!v || v.datos !== D.generado || !Array.isArray(v.sesion)) return
      /* only what this page itself could have written: a deck and a mode of the data, a result, text for the rival and the note,
         and — of the cards seen — the ones of the example, looked up by name (nothing kept is ever used as markup) */
      const text = (x) => (typeof x === 'string' ? x : '')
      const games = v.sesion.map((g) => (g && Number.isInteger(g.id) && g.id > 0 && D.mazos.some((m) => m.id === g.deckId) && own(RES, g.result) ? {
        id: g.id, deckId: g.deckId, result: g.result, rival: text(g.rival), rivalPicked: g.rivalPicked === true && Boolean(text(g.rival)), started: g.started === 'yo' || g.started === 'rival' ? g.started : null,
        seen: (Array.isArray(g.seen) ? g.seen : []).map((c) => D.partida.cartasVistasEjemplo.find((x) => c && x.nombre === c.nombre)).filter(Boolean).map((c) => Object.assign({}, c)),
        mode: D.partida.modalidades.indexOf(g.mode) >= 0 ? g.mode : D.partida.modalidades[0], note: text(g.note),
      } : null))
      if (games.some((g) => !g) || new Set(games.map((g) => g.id)).size !== games.length) return
      games.forEach((g) => sesion.push(g))
      quitada = v.quitada === true && Boolean(LAST)
      matchSeq = Math.max.apply(null, games.map((g) => g.id).concat(Number.isInteger(v.seq) ? v.seq : 0, 0))
    } catch (e) { /* nothing kept, or nothing that can be read: the visit starts from the data */ }
  })()

  /* ───────────── Pieces of D ─────────────
     Written once and used by every screen (the hand-over note d-notas.md says how to use each one).
     · badge, srcLegend    the three sources, never mixed: M (mis partidas), T (torneos), B (bots)
     · ORI, COV            the small marks: «orientativo» (n < 30) and «sin cruces con datos»
     · mIc, mZoom, mBar, spark, streak, distBar    micro-charts for a cell or a row
     · cellPct, cellNum    the cell of a board: a percentage with its n over its interval, or any number over its micro-chart
     · scoreboard          cells with a number, its unit or n and a micro-chart; a cell opens its evidence in a sheet (EVIDENCE)
     · verdictLine         the question, the answer in one line and its short why
     · board               flat rows separated by lines, a header that sorts by ONE column at a time, rows that open in place (BOARDS)
     · dueStrip            the deadline chips
     · srcBlock            one source in full (%, n, interval, record), for an opened row or an evidence sheet */
  const SRC = { m: ['M', 'Mis partidas'], t: ['T', 'Torneos'], b: ['B', 'Bots'] }
  /* the badge is decoration when the name of the source is written next to it (a header, the legend); alone = true gives it a name */
  const badge = (k, alone) => '<span class="src src-' + k + '"' + (alone ? ' role="img" aria-label="' + SRC[k][1] + '"' : ' aria-hidden="true"') + '>' + SRC[k][0] + '</span>'
  /* one legend per screen says what each badge is */
  const srcLegend = (bot) => ['m', 't', 'b'].map((k) => '<span class="src-key">' + badge(k) + (k === 'm' ? 'mis partidas' : k === 't' ? 'torneos' : 'bots' + (bot ? ' ' + esc(bot) : '')) + '</span>').join('')
  const ORI_KEY = '<span>' + ORI + 'orientativo: n' + NB + '&lt;' + NB + '30</span>'
  const nShort = (n) => 'n' + NB + num(n)
  /* micro-chart: point and interval on 0–100 with the 50 % mark; null draws an empty dashed track. The numbers are written beside it. */
  const mIc = (s) => (s ? '<span class="mic" aria-hidden="true"><i class="mic-band" style="left:' + s.ci[0] + '%;width:' + (s.ci[1] - s.ci[0]) + '%"></i><i class="mic-pt" style="left:' + s.pct + '%"></i></span>' : '<span class="mic none" aria-hidden="true"></span>')
  /* micro-chart: point and interval on a scale cut to [lo, hi] (when every value sits in a narrow range), with a mark at «ref» */
  const mZoom = (s, lo, hi, ref) => {
    const x = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))
    return '<span class="mic zoom" aria-hidden="true">' + (ref != null ? '<i class="mic-ref" style="left:' + x(ref).toFixed(1) + '%"></i>' : '') + '<i class="mic-band" style="left:' + x(s.ci[0]).toFixed(1) + '%;width:' + (x(s.ci[1]) - x(s.ci[0])).toFixed(1) + '%"></i><i class="mic-pt" style="left:' + x(s.pct).toFixed(1) + '%"></i></span>'
  }
  /* micro-chart: a bar from 0 to max */
  const mBar = (v, max, cls) => '<span class="mbar ' + (cls || '') + '" aria-hidden="true"><i style="width:' + Math.max(0, Math.min(100, (v / (max || 100)) * 100)).toFixed(1) + '%"></i></span>'
  /* a board cell for a percentage: «59,3 % n 41» with its marks, over its interval; null says «sin datos» (never 0 %).
     o = { count, mark, chart: false | html,
           src: 'm' | 't' | 'b' — the badge of the source INSIDE the cell, next to its micro-chart (mode «one»: the number carries
                its badge also when the head of the board has scrolled away),
           lead: 'n' — the board is sorted by n: the n goes first and in bold, the percentage after it } */
  function cellPct(s, o) {
    o = o || {}
    const chart = o.chart === false ? '' : o.chart || mIc(s || null)
    const foot = o.src ? '<span class="bcell-c">' + badge(o.src, true) + chart + '</span>' : chart
    if (!s) return '<span class="bcell none"><span class="bcell-v"><span class="nd">sin datos</span></span>' + foot + '</span>'
    const p = '<b' + (o.count ? ' data-count="' + s.pct + '" data-dec="1"' : '') + '>' + pct1(s.pct) + '</b>'
    const n = '<span class="n">' + nShort(s.n) + '</span>'
    return '<span class="bcell' + (o.lead === 'n' ? ' by-n' : '') + '"><span class="bcell-v">' + (o.lead === 'n' ? n + p : p + n) + (s.orientativo ? ORI : '') + (o.mark || '') + '</span>' + foot + '</span>'
  }
  /* a board cell for any other number: the value, an optional unit after it, and its micro-chart under it */
  const cellNum = (value, chart, unit) => '<span class="bcell"><span class="bcell-v"><b>' + value + '</b>' + (unit ? '<span class="n">' + unit + '</span>' : '') + '</span>' + (chart || '') + '</span>'
  /* one source in full: its badge and name, %, n, the interval drawn and written, the record when the data brings it */
  function srcBlock(k, name, s, extra) {
    const head = '<span class="source-name">' + badge(k) + '<span>' + name + '</span></span>'
    if (!s) return '<div class="source"><div class="source-head">' + head + '<span class="nd">sin datos</span></div></div>'
    return '<div class="source"><div class="source-head">' + head + '<span class="source-val">' + pct(s.pct) + '<small> ' + nTxt(s.n) + '</small></span></div>' + icBar(s.pct, s.ci) +
      '<div class="source-foot">' + nb(ciTxt(s.ci)) + (s.record ? SEP + recTxt(s.record) : '') + (s.orientativo ? SEP + 'orientativo: menos de 30 partidas' : '') + (extra || '') + '</div></div>'
  }

  /* Scoreboard. cells = [{ k: label, v: html of the number, f: html of the foot (unit, n, micro-chart), ev: key of EVIDENCE or
     nothing, aria: the whole cell said in words }]. o = { label, cols: grid template when the cells are not equal }.
     A cell with «ev» is a button that opens the sheet «?hoja=ev&de=<ev>». */
  function scoreboard(cells, o) {
    o = o || {}
    return '<section class="score" style="--n:' + cells.length + (o.cols ? ';--cols:' + o.cols : '') + '" aria-label="' + esc(o.label || 'Marcador') + '">' + cells.map((c) => {
      const inner = '<span class="score-k">' + c.k + '</span><span class="score-v">' + c.v + '</span><span class="score-f">' + (c.f || '') + '</span>'
      return c.ev
        ? '<button class="score-cell" data-a="evidence" data-k="' + esc(c.ev) + '" data-f="score-' + esc(c.ev) + '" aria-haspopup="dialog"' + (c.aria ? ' aria-label="' + esc(c.aria) + '"' : '') + '>' + inner + '</button>'
        : '<div class="score-cell"' + (c.aria ? ' role="img" aria-label="' + esc(c.aria) + '"' : '') + '>' + inner + '</div>'
    }).join('') + '</section>'
  }

  /* Verdict line. o = { q: the question (the heading of the section), a: the answer in one line, why: its short reason,
     id / whyId: ids, when something has to point at them or rewrite the why }. */
  const verdictLine = (o) => '<div class="vline">' + (o.q ? '<h2 class="vline-q"' + (o.id ? ' id="' + o.id + '"' : '') + '>' + o.q + '</h2>' : '') + '<p class="vline-a">' + o.a + '</p>' +
    (o.why ? '<p class="vline-why"' + (o.whyId ? ' id="' + o.whyId + '" aria-live="polite"' : '') + '>' + o.why + '</p>' : '') + '</div>'

  /* Sortable board. Register it once, BOARDS.<id> = () => board({ … }), and write BOARDS.<id>() where it goes: tapping a header
     sorts by that column (again: the other way round) and the board draws itself again in place. Options:
       id        key of the board: ui.sort[id] = { k, rev } keeps its order; a row's unfolded state is ui.open «id:key»
       label     what the table is, for a screen reader
       cols      [{ k, label, badge: 'm' | 't' | 'b', long: name for «Ordenar por …», asc: true if smaller goes first, words: [first way, other way],
                    cap, capBadge: mode 'one' — what the value column is called while the board is sorted by this one, and its badge
                    (by default the label and the badge of the column) }]
       rows      the data rows
       key       (row) => its id
       value     (row, colKey) => number or string to sort by; null always goes last
       mode      'all' (default): every column has its cell in each row, under its header (the header is a row of column titles that sort)
                 'one': name on the left and ONE value column, the one the board is sorted by. Its head is two things, so it never
                 reads as titles over the wrong column: a bar «Ordenar» with one option per column, and under it the caption of
                 the two columns that exist — «lead» over the names and, over the cells, the name of what they show now
       cellWidth mode 'one': width in px of that cell (104 by default), the same in every row so the micro-charts share their axis
       name      (row) => html of the name (use deckLine for a deck)
       cell      (row, colKey) => html of one cell (cellPct, or anything with a micro-chart)
       detail    (row) => html that opens in place when the row is tapped (optional)
       href      (row) => where the row goes when it has no detail (optional)
       energies  (row) => list of energies for the spine of the row (optional; only to identify a deck)
       rowClass  one more class for every row (optional: «deck-row» gives the rows of Mazos their art)
       lead      mode 'one': a plain label over the names («Arquetipo», «Mazo»)
       empty     what to say when there are no rows
       foot      html under the rows: the legend
     BOARDS.<id>.after = () => { … } runs after each new order (to rewrite a verdict that depends on it). */
  const BOARDS = {}
  const safeId = (s) => String(s).replace(/[^\w-]/g, '_')
  function board(o) {
    const st = ui.sort[o.id] || (ui.sort[o.id] = { k: o.cols[0].k, rev: false })
    const col = o.cols.find((c) => c.k === st.k) || o.cols[0]
    const sign = (col.asc ? 1 : -1) * (st.rev ? -1 : 1)
    const rows = o.rows.map((r, i) => ({ r: r, i: i, v: o.value(r, col.k) })).sort((a, b) => {
      if (a.v == null || b.v == null) return (a.v == null ? 1 : 0) - (b.v == null ? 1 : 0) || a.i - b.i
      return (typeof a.v === 'string' ? a.v.localeCompare(b.v, 'es') : a.v - b.v) * sign || a.i - b.i
    }).map((x) => x.r)
    const one = o.mode === 'one'
    /* one column to choose from is no choice: that board keeps the plain head (its label over the names, the column over its cells) */
    const bar = one && o.cols.length > 1
    const th = (c) => {
      const on = c.k === col.k
      const words = c.words || (c.asc ? ['de menor a mayor', 'de mayor a menor'] : ['de mayor a menor', 'de menor a mayor'])
      const now = st.rev ? words[1] : words[0]
      return '<button class="board-th" data-a="board-sort" data-b="' + o.id + '" data-k="' + c.k + '" data-f="th-' + o.id + '-' + c.k + '" aria-pressed="' + on + '" aria-label="' +
        esc('Ordenar por ' + (c.long || c.label.toLowerCase()) + (on ? ': es el orden actual, ' + now + '. Otro toque lo invierte' : '')) + '">' + (bar ? '<span class="th-face">' : '') + (c.badge ? badge(c.badge) : '') + '<span>' + c.label + '</span><i class="sort-arrow' + (on && sign > 0 ? ' up' : '') + '" aria-hidden="true"></i>' + (bar ? '</span>' : '') + '</button>'
    }
    const capBadge = col.capBadge === undefined ? col.badge : col.capBadge
    const head = bar
      ? '<div class="board-head sortbar" role="group" aria-label="Ordenar: una columna a la vez"><span class="board-sort-l" aria-hidden="true">Ordenar</span>' + o.cols.map(th).join('') + '</div>' +
        '<div class="board-cap"><span class="board-cap-l">' + (o.lead || '') + '</span><span class="board-cap-v">' + (capBadge ? badge(capBadge) : '') + '<span>' + (col.cap || col.label) + '</span></span></div>'
      : '<div class="board-head" role="group" aria-label="Ordenar: una columna a la vez">' + (o.lead ? '<span class="board-hl">' + o.lead + '</span>' : '') + o.cols.map(th).join('') + '</div>'
    const row = (r) => {
      const key = o.id + ':' + o.key(r)
      const id = 'bd-' + safeId(key)
      const det = o.detail ? o.detail(r) : null
      const href = det == null && o.href ? o.href(r) : null
      const open = det != null && ui.open.has(key)
      const en = o.energies ? o.energies(r) : null
      const cells = one ? o.cell(r, col.k) : '<span class="board-cells">' + o.cols.map((c) => o.cell(r, c.k)).join('') + '</span>'
      const inner = '<span class="board-name">' + o.name(r) + '</span>' + (det != null && !one ? '<span class="chev">' + ico('down', 18) + '</span>' : '') + cells
      const cls = 'board-row ' + (one ? 'one' : 'all') + (en ? ' spine' : '') + (o.rowClass ? ' ' + o.rowClass : '')
      const style = en ? ' style="' + acc(en) + '"' : ''
      if (det != null) return '<li data-row="' + esc(key) + '"><button class="' + cls + '"' + style + ' data-a="toggle" data-k="' + esc(key) + '" data-f="row-' + esc(key) + '" aria-expanded="' + open + '" aria-controls="' + id + '">' + inner + '</button><div class="detail" id="' + id + '"' + (open ? '' : ' hidden') + '>' + det + '</div></li>'
      if (href) return '<li data-row="' + esc(key) + '"><a class="' + cls + '"' + style + ' href="' + esc(href) + '">' + inner + '</a></li>'
      return '<li data-row="' + esc(key) + '"><div class="' + cls + '"' + style + '>' + inner + '</div></li>'
    }
    return '<section class="card board' + (o.lead && !bar ? ' lead' : '') + '" data-board="' + o.id + '" data-sort="' + col.k + '"' + (one && o.cellWidth ? ' style="--cell-w:' + o.cellWidth + 'px"' : '') + ' aria-label="' + esc(o.label) + '">' + head +
      (rows.length ? '<ul class="board-rows">' + rows.map(row).join('') + '</ul>' : '<p class="empty">' + (o.empty || 'Nada para mostrar.') + '</p>') + (o.foot || '') + '</section>'
  }
  /* a deck in the name cell of a board: its energy gems, «#número» and the name in up to two lines */
  const deckLine = (m) => gems(m.energias, 'sm') + '<span class="deck-name"><span class="deck-num">#' + m.id + '</span> ' + dn(m.nombre) + '</span>'
  /* draws a board again after its order changed: the rows glide to their new place («expresivo» only) and the focus stays on the header */
  function boardRefresh(id, focusKey) {
    const old = $('[data-board="' + id + '"]')
    if (!old || !BOARDS[id]) return
    const before = {}
    $$('[data-row]', old).forEach((li) => { before[li.dataset.row] = li.getBoundingClientRect().top })
    const box = document.createElement('div')
    box.innerHTML = BOARDS[id]()
    const next = box.firstElementChild
    old.replaceWith(next)
    $$('[data-count]', next).forEach((n) => { n.dataset.done = '1' })
    const target = focusKey && $('[data-f="' + focusKey + '"]', next)
    if (target) target.focus({ preventScroll: true })
    if (BOARDS[id].after) BOARDS[id].after()
    if (root.dataset.movimiento !== 'expresivo') return
    $$('[data-row]', next).forEach((li) => {
      const was = before[li.dataset.row]
      const move = was == null ? 0 : was - li.getBoundingClientRect().top
      if (move && li.animate) li.animate([{ transform: 'translateY(' + move + 'px)' }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1)' })
    })
  }

  /* Deadline chips. chips = [{ href | ev, icon, label, value, aria, advice: true for what is advice and not a deadline }]:
     «href» makes the chip a link; «ev» makes it a button that opens that evidence sheet (the whole text of the deadline). */
  const dueChip = (c) => {
    const inner = '<span class="label">' + ico(c.icon, 14) + '<span>' + esc(c.label) + '</span></span><b>' + run(c.value) + '</b>'
    const cls = 'due-chip' + (c.advice ? ' advice' : '')
    return c.ev ? '<button class="' + cls + '" data-a="evidence" data-k="' + esc(c.ev) + '" data-f="due-' + esc(c.ev) + '" aria-haspopup="dialog" aria-label="' + esc(c.aria) + '">' + inner + '</button>'
      : '<a class="' + cls + '" href="' + esc(c.href) + '" aria-label="' + esc(c.aria) + '">' + inner + '</a>'
  }
  const dueStrip = (chips, label) => (!chips.length ? '' : chips.some((c) => c.ev)
    ? '<div class="dues" role="group" aria-label="' + esc(label) + '">' + chips.map(dueChip).join('') + '</div>'
    : '<nav class="dues" aria-label="' + esc(label) + '">' + chips.map(dueChip).join('') + '</nav>')

  /* ───────────── Screens ───────────── */
  const sec = (title, aux) => '<div class="sec"><h2>' + title + '</h2>' + (aux ? '<span class="aux">' + aux + '</span>' : '') + '</div>'

  /* Hoy: scoreboard, deadline chips, la mesa, «¿Cuál llevo hoy?», the pack, pendientes, the meta, the last matches */
  function hoyScore() {
    const h = D.hoy
    const rec = dayRecord()
    const played = rec.v + rec.d + rec.e
    const st = streakNow()
    const w = weekNow()
    const rank = h.rango.split(', ')
    const points = rank[1] ? rank[1].replace(/\s*puntos?$/, '') : ''
    /* the last five: what fits in the cell at 360 px */
    const lastOnes = todaysMatches().slice(0, 5).map((g) => g.result.toUpperCase()).reverse()
    /* a number longer than usual («10–12», «12.345») goes a size down instead of leaving its cell */
    const fit = (text, max) => { const n = String(text).length; return n > max + 2 ? ' class="tight more"' : n > max ? ' class="tight"' : '' }
    const stWord = st ? st.n + ' ' + (st.r === 'v' ? plural(st.n, 'victoria', 'victorias') : st.r === 'd' ? plural(st.n, 'derrota', 'derrotas') : plural(st.n, 'empate', 'empates')) : ''
    return scoreboard([
      { k: 'Hoy', ev: 'hoy', v: '<span id="day-rec"' + fit(recShort(rec), 4) + '>' + recShort(rec) + '</span>', f: played ? distBar(rec) : '<span class="nd">sin partidas</span>', aria: 'Hoy: ' + recWords(rec) + '. Abre las partidas de hoy' },
      { k: 'Racha', ev: 'racha', v: st ? st.n + '<small class="' + st.r + '">' + NB + st.r.toUpperCase() + '</small>' : '<span class="nd">sin datos</span>', f: lastOnes.length ? streak(lastOnes) : '', aria: st ? 'Racha: ' + stWord + (st.n > 1 ? (st.r === 'e' ? ' seguidos' : ' seguidas') : '') + '. Abre el detalle' : 'Racha: sin datos' },
      { k: badge('m') + 'Semana', ev: 'semana', v: w ? '<span' + fit(nf.format(w.pct), 4) + '><span data-count="' + w.pct + '" data-unit="">' + nf.format(w.pct) + '</span><small>' + NB + '%</small></span>' : '<span class="nd">sin datos</span>', f: w ? '<span class="n">' + nShort(w.n) + (w.orientativo ? ORI : '') + '</span>' + mIc(w) : '', aria: w ? 'Semana ' + h.semana.etiqueta + ': ' + pct(w.pct) + ', ' + nTxt(w.n) + (w.orientativo ? ', orientativo' : '') + '. Abre el intervalo y la semana anterior' : 'Semana: sin datos' },
      { k: 'Rango', ev: 'rango', v: '<span' + fit(points || rank[0], 5) + '>' + esc(points || rank[0]) + '</span>', f: points ? '<span class="n">' + esc(rank[0]) + '</span>' : '', aria: 'Rango: ' + h.rango + '. Abre la temporada' },
    ], { label: 'Marcador del día', cols: '.9fr .86fr 1.16fr 1.08fr' })
  }
  const PEND_ICON = { turno: 'play', clasificar: 'tag', situaciones: 'target', simulacion: 'cpu', laboratorio: 'flask', promo: 'gift', evento: 'calendar' }
  const DUE = { promo: 'Promo', evento: 'Evento' }
  /* what has a deadline, in one line (the label and what the text says after its last colon), and the pack to open with them */
  function hoyDues() {
    const h = D.hoy
    const chips = h.pendientes.filter((p) => DUE[p.tipo]).map((p) => ({ href: pendDest(p), icon: PEND_ICON[p.tipo], label: DUE[p.tipo], value: p.texto.slice(p.texto.lastIndexOf(': ') + 2), aria: p.texto }))
    if (h.sobre) chips.push({ href: '#/cartas', icon: 'cards', label: 'Abrir', value: h.sobre.nombre, aria: 'Conviene abrir el sobre ' + h.sobre.nombre + '. Abre Sobres', advice: true })
    return dueStrip(chips, 'Para hoy: lo que tiene plazo y el sobre que conviene abrir')
  }
  /* La mesa: one row per deck of the session. V / D / E open the sheet with the deck and the result already chosen; they never save. */
  function deckCard(m) {
    return '<article class="deck-card" style="' + acc(m.energias) + '">' +
      '<a class="deck-head" href="#/mazo/' + m.id + '" aria-label="Abrir el mazo ' + m.id + ', ' + esc(m.nombre) + '">' + gems(m.energias) +
      '<span class="deck-name"><span class="deck-num">#' + m.id + '</span> ' + dn(m.nombre) + '</span>' + art(m) + '</a>' +
      '<div class="deck-foot"><div class="deck-today"><span>Hoy ' + recTxt(m.hoy) + '</span>' + (m.racha.length ? streak(m.racha, freshDeck === m.id) : '') + '</div>' +
      '<div class="vde letters" role="group" aria-label="Registrar una partida con el mazo ' + m.id + '">' +
      ['v', 'd', 'e'].map((r) => '<button class="vde-btn ' + r + '" data-a="match-open" data-deck="' + m.id + '" data-res="' + r + '" data-f="mesa-' + m.id + '-' + r + '" aria-haspopup="dialog" aria-label="' + RES[r] + ' con el mazo ' + m.id + ': abre la hoja para guardarla">' +
        '<span class="vde-face">' + shape(r, 13) + '<b aria-hidden="true">' + RES[r].charAt(0) + '</b></span></button>').join('') +
      '</div></div></article>'
  }
  /* «¿Cuál llevo hoy?»: the candidates with their three sources in sight; sorted by one source at a time, never a combined score */
  const pickBot = () => { const m = D.hoy.mazosDelDia.find((x) => x.laboratorio); return m ? m.laboratorio.bot : '' }
  const pickRows = () => D.hoy.mazosDelDia.map((m) => Object.assign({}, m, { mias: miasOf(m.id, m.mias) }))
  const COUNT_WORD = ['Ningún', 'Un', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis']
  function pickWhy() {
    const rows = pickRows()
    const k = ui.sort.pick.k
    const have = rows.filter((m) => m[k])
    const total = (COUNT_WORD[rows.length] || String(rows.length)).toLowerCase()
    /* Every variant fits in ONE line at 360 px (328 px of text; arreglos-1/medir-porque.mjs): the line has no room reserved for
       a second one, and a sentence that took two pushed the whole board down 19 px when its column was chosen. */
    const some = (n) => (COUNT_WORD[n] || String(n)).toLowerCase().replace(/^un$/, 'uno')
    if (k === 'mias') {
      if (!have.length) return 'Tus partidas: todavía no jugaste con ninguno.'
      if (have.length === 1) return 'Tus partidas: solo <b>#' + have[0].id + '</b> tiene datos' + (have[0].mias.orientativo ? ', orientativos.' : '.')
      return 'Tus partidas: ' + (have.length === rows.length ? 'los ' + total : some(have.length)) + ' tienen datos.'
    }
    if (k === 'torneo') {
      if (!have.length) return 'Por torneo: ninguno tiene datos.'
      if (have.length === 1) return 'Por torneo: solo <b>#' + have[0].id + '</b> tiene datos.'
      const top = have.reduce((a, b) => (b.torneo.pct > a.torneo.pct ? b : a))
      const overlap = have.every((m) => m.torneo.ci[1] >= top.torneo.ci[0])
      return overlap ? 'Por torneo, los ' + (have.length === rows.length ? total : have.length) + ' intervalos se pisan.' : 'Por torneo, los intervalos no se pisan del todo.'
    }
    const over = have.filter((m) => m.laboratorio.ci[0] > 50)
    const what = ' el intervalo sobre 50' + NB + '%.'
    if (over.length === 1) return 'Con bots, solo <b>#' + over[0].id + '</b> tiene' + what
    return 'Con bots, ' + (!over.length ? 'ninguno tiene' : over.length === rows.length ? 'todos tienen' : some(over.length) + ' tienen') + what
  }
  function pickDetail(m) {
    return srcBlock('t', 'Torneo: su arquetipo contra el meta', m.torneo, m.torneo ? SEP + 'cruces con datos: ' + pct(m.torneo.cobertura) + ' del meta' : '') +
      srcBlock('m', 'Mis partidas', m.mias) +
      srcBlock('b', 'Laboratorio: bots' + (m.laboratorio ? ' ' + esc(m.laboratorio.bot) : ''), m.laboratorio) +
      '<p class="fine">El récord viene solo en «Mis partidas»: los datos de la maqueta no lo traen para torneo ni para bots.</p>' +
      '<div class="pick-foot">' + art(m) + '<a class="btn" href="#/mazo/' + m.id + '">Abrir la ficha</a><button class="btn" data-a="match-open" data-deck="' + m.id + '" data-f="pick-reg-' + m.id + '" aria-haspopup="dialog">Registrar con este</button></div>'
  }
  BOARDS.pick = () => {
    const bot = pickBot()
    const open = ui.open.has('pick-nota')
    return board({
      id: 'pick', label: 'Los candidatos de hoy, con sus tres fuentes',
      cols: [{ k: 'torneo', label: 'Torneo', badge: 't', long: 'torneo' }, { k: 'mias', label: 'Mías', badge: 'm', long: 'mis partidas' }, { k: 'laboratorio', label: 'Bots' + (bot ? ' ' + esc(bot) : ''), badge: 'b', long: 'bots del laboratorio' }],
      rows: pickRows(), key: (m) => m.id, value: (m, k) => (m[k] ? m[k].pct : null), energies: (m) => m.energias, name: deckLine,
      cell: (m, k) => cellPct(m[k], { count: true, mark: k === 'torneo' && noCover(m.torneo) ? COV : '' }),
      detail: pickDetail,
      foot: '<p class="legend">' + srcLegend(bot) + ORI_KEY + (D.hoy.mazosDelDia.some((m) => noCover(m.torneo)) ? COV_KEY : '') + '</p>' +
        '<button class="linkrow board-more" data-a="toggle" data-k="pick-nota" data-f="pick-nota" aria-expanded="' + open + '" aria-controls="pick-nota"><span>Qué es cada número</span><span class="chev">' + ico('down', 18) + '</span></button>' +
        '<div class="detail" id="pick-nota"' + (open ? '' : ' hidden') + '><p class="note">' + esc(D.hoy.mazosDelDiaNota) + '</p><p class="fine">' + esc(D.hoy.mazosDelDiaMeta) + '. Punto e intervalo sobre ' + nb('0–100') + '; la marca es 50' + NB + '%. Tocá una fila: intervalo y récord de cada fuente.</p></div>',
    })
  }
  BOARDS.pick.after = () => { const why = $('#pick-why'); if (why) why.innerHTML = pickWhy() }
  function pickSection() {
    const n = D.hoy.mazosDelDia.length
    return '<section class="pick" id="pick" aria-labelledby="pick-q">' +
      verdictLine({ q: '¿Cuál llevo hoy?', id: 'pick-q', a: (COUNT_WORD[n] || n) + ' ' + plural(n, 'candidato', 'candidatos') + ', sin un ganador', why: pickWhy(), whyId: 'pick-why' }) + BOARDS.pick() + '</section>'
  }
  /* The recommended pack: the ticket, the whole reason and the way to its numbers */
  function packCard() {
    const h = D.hoy
    const v = D.cartas.sobres.veredicto
    return '<section class="holo shine pack-card" aria-label="Sobre recomendado"><a class="pack-main" href="#/cartas" aria-label="' + esc('Conviene abrir ' + h.sobre.nombre + '. ' + h.sobre.porque + ' Abre Sobres') + '">' + packArt(v.expansionId) +
      '<span class="pack-row-main"><span class="kicker h">Conviene abrir</span><span class="pack-row-name">' + esc(h.sobre.nombre) + NB + '<span class="deck-num">· ' + esc(v.expansionId) + '</span></span><span class="pack-row-why">' + run(h.sobre.porque) + '</span></span></a>' +
      /* the numbers open over Hoy: closing the sheet leaves this screen where it was */
      '<button class="linkrow" data-a="numbers" data-f="hoy-numbers" aria-haspopup="dialog"><span>Ver los números</span>' + CHEV + '</button></section>'
  }
  /* Pendientes: what has a deadline first; four on the page and the rest one tap away, like the last matches. */
  const PEND_SHOWN = 4
  /* where a row leads. The shared data knows one address for everything of Pruebas; in D that section has views, and the game
     against the bot and the spots to solve live in «Practicar»: a row opens the screen that shows what it announces */
  const PEND_DEST = { turno: '#/pruebas/practicar', situaciones: '#/pruebas/practicar' }
  const pendDest = (p) => own(PEND_DEST, p.tipo) || p.destino
  function pendList() {
    const all = D.hoy.pendientes.slice().sort((a, b) => (DUE[b.tipo] ? 1 : 0) - (DUE[a.tipo] ? 1 : 0))
    const open = ui.open.has('pend') || all.length <= PEND_SHOWN + 1
    /* a destination that is this same screen would be a dead tap: it says what the app opens instead */
    const row = (p) => {
      /* every one of these leads to another screen of the app: the arrow says so (a row that opens in place carries none) */
      const inner = '<span class="pend-ico">' + ico(PEND_ICON[p.tipo] || 'info', 20) + '</span><span><span class="pend-t" style="display:block">' + run(p.texto) + '</span><span class="pend-d" style="display:block">' + run(p.detalle) + '</span></span>' + CHEV
      return pendDest(p) === '#/hoy'
        ? '<li><button class="pend" data-a="static" data-msg="En la app abre «' + esc(p.detalle.split(':')[0]) + '». La maqueta no trae esa pantalla.">' + inner + '</button></li>'
        : '<li><a class="pend' + (DUE[p.tipo] ? ' due' : '') + '" href="' + esc(pendDest(p)) + '">' + inner + '</a></li>'
    }
    return '<ul class="card rows">' + (open ? all : all.slice(0, PEND_SHOWN)).map(row).join('') +
      (open ? '' : '<li><button class="linkrow" data-a="pend-more" aria-expanded="false" aria-controls="pend"><span>Ver los ' + all.length + '</span><span class="chev">' + ico('down', 18) + '</span></button></li>') + '</ul>'
  }
  /* The last matches: three on the page, the rest of today's one tap away. Tapping one opens it in the sheet, to correct it. */
  const GAMES_SHOWN = 3
  const startedTxt = (s) => (s === 'yo' ? 'empecé yo' : 'empezó el rival')
  function gamesList() {
    const all = todaysMatches()
    if (!all.length) return '<div class="card empty">Todavía no hay partidas de hoy.</div>'
    const open = ui.open.has('games') || all.length <= GAMES_SHOWN
    const row = (g) => '<li><button class="game" data-a="match-edit" data-ref="' + g.ref + '" data-f="game-' + g.ref + '" aria-haspopup="dialog"><span class="res ' + g.result + '" role="img" aria-label="' + RES[g.result] + '">' + g.result.toUpperCase() + '</span><span><span class="row-title"><span class="deck-num">#' + g.deckId + '</span> ' + dn(deckName(g.deckId)) + '</span>' +
      '<span class="game-sub">' + (g.rival ? 'contra ' + run(g.rival) : 'sin rival anotado') + SEP + nb(esc(g.when)) + SEP + esc(g.mode) + (g.started ? SEP + nb(startedTxt(g.started)) : '') + '</span></span></button></li>'
    return '<ul class="card rows">' + (open ? all : all.slice(0, GAMES_SHOWN)).map(row).join('') +
      (open ? '' : '<li><button class="linkrow" data-a="games-more" aria-expanded="false" aria-controls="games"><span>Ver las ' + all.length + '</span><span class="chev">' + ico('down', 18) + '</span></button></li>') + '</ul>'
  }
  function viewHoy() {
    const h = D.hoy
    const decks = sessionDecks()
    const news = (kind, a) => '<a class="card news-tile" href="#/meta" aria-label="' + esc((kind === 'sube' ? 'Sube' : 'Baja') + ': ' + a.nombre + ', ' + signed(a.delta) + ' puntos de cuota; ahora ' + pct(a.cuota) + ' del meta. Abre Meta') + '">' +
      '<span class="label">' + ico(kind === 'sube' ? 'up' : 'downtrend', 16) + (kind === 'sube' ? 'Sube' : 'Baja') + (a.nuevo ? ' · nuevo' : '') + '</span>' +
      '<span class="news-name">' + an(a.nombre) + '</span><span class="news-row"><span class="news-delta">' + signed(a.delta) + '<small>pts</small></span>' + spark(a.serie, 46, 26) + '</span>' +
      '<span class="news-now">ahora ' + pct(a.cuota) + ' del meta</span></a>'
    const games = todaysMatches().length
    return hoyScore() + hoyDues() +
      '<div class="mesa-head"><h2 class="label">En la mesa</h2><span class="mesa-sub">' + plural(decks.length, 'el mazo que venís jugando', 'los ' + decks.length + ' que venís jugando') + '</span></div>' +
      '<div class="mesa" id="mesa">' + decks.map(deckCard).join('') + '</div>' +
      pickSection() + packCard() +
      sec('Pendientes', h.pendientes.length + ' · con plazo primero') + '<div id="pend">' + pendList() + '</div>' +
      sec('Novedades del meta', '<span class="src-key">' + badge('t') + 'cuota · ' + h.meta.dias + ' días</span>') +
      '<div class="news">' + news('sube', h.meta.sube) + news('baja', h.meta.baja) + '</div>' +
      sec('Últimas partidas', games ? 'tocá una para corregirla' : '') + '<div id="games">' + gamesList() + '</div>' +
      '<p class="demo-note">' + ico('info', 16) + '<span>' + esc(D.aviso) + '.</span></p>'
  }

  /* Mazos: the verdict in one line, the chips and ONE board, sorted by one column at a time (N.º · Última · n · %).
     A row is the deck (its art, «#N name» in up to two lines, what is missing) and, on the right, its own matches: % and n over
     their interval, with the badge M inside the cell. What the board is sorted by is the figure in bold: the %, the n (it goes
     first), or — sorted by «Última» — the day it was last played, which takes the place of the interval.
     The filter by name or number lives in the header of the screen (resolve), so eight rows fit in the first screen. */
  function mazosVerdict() {
    const all = D.mazos
    const miss = all.filter((m) => !m.completo)
    const head = all.length + ' ' + plural(all.length, 'mazo armado', 'mazos armados')
    if (!miss.length) return head + ', todos completos'
    const lo = Math.min.apply(null, miss.map((m) => m.falta))
    const hi = Math.max.apply(null, miss.map((m) => m.falta))
    const what = hi === 1 ? 'una carta' : lo === 1 && hi === 2 ? 'una carta o dos' : lo === hi ? hi + ' cartas' : 'entre ' + lo + ' y ' + hi + ' cartas'
    return head + '; a ' + miss.length + plural(miss.length, ' le falta ', ' les falta ') + what
  }
  /* the decks that match what is typed in the filter; the chips cut that list, and each chip counts what it would show */
  const DECK_CHIPS = [['todos', 'Todos', () => true], ['jugados', 'Con partidas', (m) => Boolean(m.mias)], ['falta', 'Incompletos', (m) => !m.completo]]
  function deckMatches() {
    const words = wordsOf(ui.deckQuery)
    return liveDecks().filter((m) => finds(words, '#' + m.id + ' ' + m.nombre))
  }
  const deckRows = () => deckMatches().filter((DECK_CHIPS.find((c) => c[0] === ui.deckFilter) || DECK_CHIPS[0])[2])
  /* the number on each chip, in place (the field keeps the focus while it is typed in) */
  function paintChipCounts(action, chips, list) {
    $$('[data-a="' + action + '"]').forEach((b) => { const c = chips.find((x) => x[0] === b.dataset.v); const n = $('.count', b); if (c && n) n.textContent = list.filter(c[2]).length })
  }
  /* the name cell of a deck in Mazos: two thumbnails (the gems take their place when thumbnails are off), «#N name» and the tag */
  const deckRowName = (m) => art(m, 2) + gems(m.energias, 'sm') + '<span class="deck-name"><span class="deck-num">#' + m.id + '</span> ' + dn(m.nombre) +
    (m.completo ? '' : ' <span class="tag warn">' + plural(m.falta, 'falta', 'faltan') + ' ' + m.falta + '</span>') + '</span>'
  BOARDS.mazos = () => board({
    id: 'mazos', label: 'Tus mazos', mode: 'one', cellWidth: 90, rowClass: 'deck-row', lead: 'Mazo',
    cols: [
      { k: 'id', label: 'N.º', asc: true, long: 'número de mazo', cap: '% vict.', capBadge: 'm' },
      { k: 'ultima', label: 'Última', long: 'última partida', words: ['la más nueva primero', 'la más vieja primero'], cap: 'Última' },
      { k: 'n', label: '<span class="lc">n</span>', long: 'cantidad de partidas', cap: 'Partidas', capBadge: 'm' },
      { k: 'pct', label: '%', badge: 'm', long: 'porcentaje de victorias en mis partidas', cap: '% vict.' },
    ],
    rows: deckRows(), key: (m) => m.id,
    value: (m, k) => (k === 'id' ? m.id : k === 'ultima' ? m.ultima : m.mias ? m.mias[k] : null),
    energies: (m) => m.energias, name: deckRowName, href: (m) => '#/mazo/' + m.id,
    /* always «M % n», with the badge inside the cell: over its interval; sorted by n, the n first and in bold; sorted by
       «Última», the day takes the place of the interval and is the figure in bold */
    cell: (m, k) => (k !== 'ultima' || !m.ultima ? cellPct(m.mias, { src: 'm', lead: k === 'n' ? 'n' : null })
        : '<span class="bcell by-last"><span class="bcell-v">' + (m.mias ? '<b>' + pct1(m.mias.pct) + '</b><span class="n">' + nShort(m.mias.n) + '</span>' + (m.mias.orientativo ? ORI : '') : '<span class="nd">sin datos</span>') + '</span><span class="bcell-c">' + badge('m', true) + '<b>' + dayTxt(m.ultima) + '</b></span></span>'),
    empty: ui.deckQuery.trim() ? 'Ningún mazo coincide con «' + esc(ui.deckQuery.trim()) + '»' + (ui.deckFilter === 'todos' ? '.' : ' en este filtro.') : 'Ningún mazo en este filtro.',
    foot: '<p class="legend"><span class="src-key">' + badge('m') + 'mis partidas con cada mazo</span>' + ORI_KEY + '<span>Punto e intervalo sobre ' + nb('0–100') + '; la marca es 50' + NB + '%.</span></p>',
  })
  /* the list again after a filter changed: in place and without the glide of a new order */
  function boardPaint(id) {
    const old = $('[data-board="' + id + '"]')
    if (old) old.outerHTML = BOARDS[id]()
  }
  const paintDecks = () => boardPaint('mazos')
  const deckFilterField = () => '<div class="top-filter">' + ico('search', 18) + '<input class="field" type="search" id="deck-q" placeholder="Filtrar mazos" aria-label="Filtrar mazos por nombre o número" value="' + esc(ui.deckQuery) + '" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"></div>'
  function viewMazos() {
    /* the chips count the decks that match what is typed: the number on a chip is the number of rows it shows */
    const list = deckMatches()
    return verdictLine({ a: mazosVerdict() }) +
      '<div class="chipline" role="group" aria-label="Qué mazos mostrar">' + DECK_CHIPS.map((c) => '<button class="chip" data-a="deck-filter" data-v="' + c[0] + '" aria-pressed="' + (ui.deckFilter === c[0]) + '">' + c[1] + ' <span class="count">' + list.filter(c[2]).length + '</span></button>').join('') + '</div>' +
      BOARDS.mazos()
  }

  /* Ficha del mazo. On this page the header of the app IS the deck (deckTop): back, its energy, «#N name» in up to two lines
     and one line with the three sources. It stays in the four views and while scrolling: 72 px with the name in one line and
     92 px with two. The big header of B (the art, the state, the three big numbers, the notes, «Probar» and «Mejoras») opens
     the view Lista and scrolls away with it. */
  const VISTAS = [['lista', 'Lista'], ['rinde', 'Rinde'], ['mejorar', 'Mejorar'], ['notas', 'Notas']]
  const deckTabs = (id) => VISTAS.map((v) => [v[0], v[1], '#/mazo/' + id + (v[0] === 'lista' ? '' : '/' + v[0])])
  /* The three sources of a deck, as far as the data brings them: the whole deck (#1) has the three; a candidate of «¿Cuál llevo
     hoy?» has its tournament number and its laboratory score; of any other deck the data brings only «mías» (known: false). */
  function deckSources(id) {
    const base = liveDecks().find((m) => m.id === id)
    if (D.mazo.id === id) {
      const r = D.mazo.rinde
      return { known: true, m: miasOf(id, r.mias), t: r.torneo, b: r.simulacion, bot: r.simulacion.bot, tName: 'Torneo, ' + r.torneo.etiqueta.toLowerCase() }
    }
    const pick = D.hoy.mazosDelDia.find((m) => m.id === id)
    if (pick) return { known: true, m: base.mias, t: pick.torneo, b: pick.laboratorio, bot: pick.laboratorio ? pick.laboratorio.bot : '', tName: 'Torneo, su arquetipo contra el meta', pick: pick }
    return { known: false, m: base.mias }
  }
  /* the fixed header of a deck page: it takes the place of the app's header */
  function deckTop(id) {
    const m = D.mazos.find((x) => x.id === id)
    const s = deckSources(id)
    /* the same marks the number carries in «¿Cuál llevo hoy?»: «orientativo», and «sin cruces con datos» for a tournament
       number whose archetype has no matchup with data in the meta */
    const one = (k, st) => '<span class="dsrc">' + badge(k) + (st ? '<b>' + pct(st.pct) + '</b><span class="n">' + nShort(st.n) + '</span>' + (st.orientativo ? ORI : '') + (noCover(st) ? COV : '') : '<span class="nd">sin datos</span>') + '</span>'
    const words = (name, st) => name + ': ' + (st ? pct(st.pct) + ', ' + nTxt(st.n) + (st.orientativo ? ', orientativo' : '') + (noCover(st) ? ', sin cruces con datos en el meta' : '') : 'sin datos')
    const line = one('m', s.m) + (s.known ? one('t', s.t) + one('b', s.b) : '<span class="dsrc rest">' + badge('t') + badge('b') + '<span class="nd">no vienen en la maqueta</span></span>')
    const said = 'Tres fuentes, nunca mezcladas. ' + words('Mis partidas', s.m) + '. ' +
      (s.known ? words(s.tName, s.t) + '. ' + words('Bots' + (s.bot ? ' ' + s.bot : ''), s.b) + '.' : 'Torneo y bots: la maqueta no los trae para este mazo.')
    return '<a class="back" href="#/mazos" data-a="back" aria-label="Volver a Mazos">' + ico('back', 24) + '</a>' +
      '<div class="deck-top-id">' + gems(m.energias) + '<h1 class="deck-top-name"><span class="deck-num">#' + m.id + '</span> ' + dn(m.nombre) + '</h1></div>' +
      '<button class="iconbtn" data-a="sheet" data-s="mazo" data-f="deck-more" aria-haspopup="dialog" aria-label="Más de este mazo: otro mazo, acciones y el menú de la app">' + ico('more', 22) + '</button>' +
      '<div class="deck-top-src" role="img" aria-label="' + esc(said) + '">' + line + '</div>'
  }
  /* one of the three big numbers of the hero: its badge, %, n and the interval as text (a bar this narrow cannot be read) */
  function triCell(k, label, s, more) {
    return '<span class="triad-cell"><span class="label">' + badge(k) + label + '</span>' + (s ? '<b data-count="' + s.pct + '">' + pct(s.pct) + '</b><span class="n">' + nShort(s.n) + (s.orientativo ? ORI : '') + '</span><span class="n">' + (more || nb(ciShort(s.ci))) + '</span>' : '<span class="nd" style="margin-top:6px">sin datos</span>') + '</span>'
  }
  const deckFan = (id) => {
    const pics = deckInfo(id)
    const cls = pics.miniaturas.length >= 3 ? '' : pics.miniaturas.length === 2 ? ' two' : ' one'
    return '<div class="fan' + cls + '" aria-hidden="true">' + pics.miniaturas.slice(0, 3).map((src, i) => thumb(src, pics.miniaturasDe[i].nombre, pics.miniaturasDe[i].tipo)).join('') + '</div>'
  }
  /* the state of a deck in one line («armado · válido · completo»): parts = [[is it right, how it reads when it is, when it is not], …];
     what is not right goes in the warning colour, and the mark in front says whether everything is */
  const stateLine = (parts) => {
    const all = parts.every((p) => p[0])
    return '<p class="hero-state' + (all ? ' ok' : '') + '">' + ico(all ? 'check' : 'info', 16) + '<span>' + parts.map((p) => (p[0] ? p[1] : '<b class="bad">' + p[2] + '</b>')).join(' · ') + '</span></p>'
  }
  function viewMazo(id, vista) {
    const base = liveDecks().find((m) => m.id === id)
    if (D.mazo.id !== id) return deckPartial(base)
    /* no «enter» here: the page comes in as a whole; the class is for a change of view (swap) */
    return '<div class="panel" id="panel" role="tabpanel" tabindex="-1" aria-labelledby="tab-' + vista + '" style="' + acc(base.energias) + '">' + deckPanel(D.mazo, vista) + '</div>'
  }
  function deckPanel(m, vista) {
    if (vista === 'rinde') return panelRinde(m)
    if (vista === 'mejorar') return panelMejorar(m)
    if (vista === 'notas') return panelNotas(m)
    return deckHero(m) + panelLista(m)
  }
  /* the big header of B, only in Lista: it scrolls away (the name and the three sources stay in the fixed header) */
  function deckHero(m) {
    const id = m.id
    const r = m.rinde
    const s = deckSources(id)
    return '<section class="hero spine" aria-label="Resumen del mazo"><div class="hero-top"><div class="hero-id">' +
      '<div class="hero-kicker"><span>' + esc(energyNames(m.energias)) + ' · rev. ' + m.revision + '</span></div>' +
      stateLine([[m.armado, 'armado', 'sin armar'], [m.valido, 'válido', 'no valida'], [m.completo, 'completo', 'incompleto']]) + '</div>' + deckFan(id) + '</div>' +
      '<a class="triad" href="#/mazo/' + id + '/rinde" data-a="tab" data-href="#/mazo/' + id + '/rinde" aria-label="' + esc('Tres fuentes, nunca mezcladas. Mis partidas: ' + (s.m ? pct(s.m.pct) + ', ' + nTxt(s.m.n) + ', ' + ciTxt(s.m.ci) : 'sin datos') + '. Torneo, ' + r.torneo.etiqueta.toLowerCase() + ': ' + pct(r.torneo.pct) + ', ' + nTxt(r.torneo.n) + ', ' + ciTxt(r.torneo.ci) + (r.torneo.orientativo ? ', orientativo' : '') + '. Simulación con bots ' + r.simulacion.bot + ': ' + pct(r.simulacion.pct) + ', ' + nTxt(r.simulacion.n) + ', ' + ciTxt(r.simulacion.ci) + '. Abre Rinde') + '">' +
      triCell('m', 'Mías', s.m) + triCell('t', 'Torneo', r.torneo) + triCell('b', 'Bots', r.simulacion) + '</a>' +
      '<a class="notes-teaser" href="#/mazo/' + id + '/notas" data-a="tab" data-href="#/mazo/' + id + '/notas"><span class="nt-text">' + run(m.notasCortas) + '</span><span class="more">ver más</span></a>' +
      '<div class="hero-actions two"><button class="btn" data-a="launch" data-q="meta" data-deck="' + id + '" data-f="hero-probar" aria-haspopup="dialog" aria-label="Probar contra el meta">' + ico('trophy', 16) + 'Probar</button>' +
      '<button class="btn" data-a="launch" data-q="cambio" data-deck="' + id + '" data-f="hero-mejoras" aria-haspopup="dialog" aria-label="Buscar mejoras">' + ico('flask', 16) + 'Mejoras</button></div></section>'
  }
  /* The two answers, each with its name: «Tu lista: falta N · Versión de torneo: faltan N». o = { tu, torneo (null: the data does
     not bring it), sub: one more line, cards: rows of what is missing, cardsOf: 'torneo' when those cards are missing from the
     tournament version and not from the deck's own list (each row then says so), days }. It is a link to Sobres only when
     something is missing. */
  function needBlock(o) {
    const item = (label, n, one) => '<span class="need-item' + (n ? ' lacks' : n === 0 ? ' ok' : '') + '">' + ico(n === 0 ? 'check' : 'info', 16) + '<span>' + label + ': <b>' + (n == null ? 'la maqueta no la trae' : (n === 1 || (one && !n) ? 'falta ' : 'faltan ') + n) + '</b></span></span>'
    const body = '<span class="need-items">' + item('Tu lista', o.tu, true) + item('Versión de torneo', o.torneo) + (o.sub ? '<span class="need-sub">' + o.sub + '</span>' : '') + '</span>'
    /* nothing missing, and no card of this deck among the ones Sobres lists as missing: only the two answers */
    if (!o.tu && !o.torneo && !(o.cards && o.cards.length)) return '<section class="card need" aria-label="Qué te falta conseguir">' + body + '</section>'
    const cards = (o.cards || []).map((c) => '<li class="miss">' + thumb(c.imagen, c.carta, c.tipo) + '<div><div class="row-title">' + esc(c.carta) + '</div>' + (o.cardsOf === 'torneo' ? '<div class="row-sub">para la versión de torneo</div>' : '') + '<div class="row-sub">' + tight(c.consejo + (c.consejo === 'comprar' ? ' · ' + num(c.puntos) + ' pts' : ' sobres')) + SEP + tight(c.sobre) + '</div>' +
      /* what the card costs in points, also when the advice is to open packs (as Sobres says it): a line of its own */
      (c.consejo !== 'comprar' && c.puntos != null ? '<div class="row-sub">' + tight('comprarla: ' + num(c.puntos) + ' pts') + '</div>' : '') + '</div>' +
      '<div class="miss-need">×' + c.falta + '<small>' + plural(c.falta, 'falta', 'faltan') + '</small></div></li>').join('')
    return '<section class="card rows need-card" aria-label="Qué te falta conseguir"><div class="need">' + body + '</div>' + (cards ? '<ul>' + cards + '</ul>' : '') +
      '<a class="linkrow" href="#/cartas"><span>Qué sobre abrir' + (o.days ? ' · completo en unos ' + o.days + ' días' : '') + '</span>' + CHEV + '</a></section>'
  }
  /* Lista: the two answers, list or grid, and the dense rows (quantity, thumbnail, name, stage · code, energy, points) */
  function cardGroups(m) {
    const total = (list) => list.reduce((a, c) => a + c.cant, 0)
    const row = (c) => '<li><button class="card-row" data-a="card" data-c="' + esc(c.id) + '" data-f="card-' + esc(c.id) + '" aria-haspopup="dialog"><span class="qty' + (c.cant === 1 ? ' one' : '') + '">' + c.cant + '<small>×</small></span>' + thumb(c.imagen, c.nombre, c.tipo) +
      '<span class="cr-main"><span class="row-title">' + esc(c.nombre) + '</span><span class="row-sub">' + esc(c.clase) + ' · <span class="code">' + esc(c.id) + '</span></span></span>' +
      '<span class="cr-end">' + (c.tipo ? gem(c.tipo, 'sm') : '') + (c.puntos ? '<span class="n"><span class="sr">da </span>' + c.puntos + NB + plural(c.puntos, 'pt', 'pts') + '</span>' : '') + '</span></button></li>'
    const cell = (c) => '<button class="grid-card" data-a="card" data-c="' + esc(c.id) + '" data-f="card-' + esc(c.id) + '" aria-haspopup="dialog" aria-label="' + c.cant + ' ' + esc(c.nombre) + ', ' + esc(c.id) + '">' + (c.cant > 1 ? '<span class="x2">×' + c.cant + '</span>' : '') + thumb(c.imagen, c.nombre, c.tipo) + '<span class="gname">' + soft(c.nombre) + '</span></button>'
    const toggle = '<div class="seg" role="group" aria-label="Cómo ver la lista"><button data-a="list-mode" data-v="lista" aria-pressed="' + (ui.listMode === 'lista') + '" aria-label="Ver como lista">' + ico('list', 18) + '</button><button data-a="list-mode" data-v="grilla" aria-pressed="' + (ui.listMode === 'grilla') + '" aria-label="Ver como grilla">' + ico('grid', 18) + '</button></div>'
    const group = (title, list, first) => '<section class="card rows"><div class="group-head"><h2>' + title + ' <span>' + total(list) + ' cartas</span></h2>' + (first ? toggle : '') + '</div>' +
      (ui.listMode === 'grilla' ? '<div class="cards-grid">' + list.map(cell).join('') + '</div>' : '<ul>' + list.map(row).join('') + '</ul>') + '</section>'
    return group('Pokémon', m.cartas.pokemon, true) + group('Entrenadores', m.cartas.entrenadores) +
      /* the points are written in the rows of the list only: the grid shows no «pt» to explain */
      '<p class="fine list-foot">' + (total(m.cartas.pokemon) + total(m.cartas.entrenadores)) + ' cartas. ' + (ui.listMode === 'grilla' ? '' : '«pt»: los puntos que se lleva el rival si debilita a ese Pokémon. ') + 'Tocá una carta: su ficha, con sus ediciones.</p>'
  }
  function panelLista(m) {
    const f = m.falta
    /* how far the tournament version is comes from the text of the data («Está a 1 cambio: …»), the same one «Mejorar» shows */
    const far = /a \d+ cambios?/.exec(m.mejorar[0].respuesta)
    return needBlock({ tu: f.tuLista.n, torneo: f.torneo.n, sub: esc(f.torneo.lista) + (far ? ', ' + far[0] + ' de la tuya' : ''), cards: [] }) +
      '<div class="list-box" id="lista">' + cardGroups(m) + '</div>'
  }
  /* One source with everything in sight (a deck page shows it all): its badge and name, the % big, n, record and interval
     written, and a bar from 0 to 100 with the 50 % mark. o = { sub: second line of the name, extra: after n, count: count up,
     none: what to say when there is no data } */
  function srcLane(k, name, s, o) {
    o = o || {}
    const head = '<div class="lane-head"><span class="lane-name">' + badge(k) + '<span>' + name + (o.sub ? '<small>' + o.sub + '</small>' : '') + '</span></span>' +
      (s ? '<span class="lane-pct"' + (o.count ? ' data-count="' + s.pct + '"' : '') + '>' + pct(s.pct) + '</span>' : '<span class="nd">sin datos</span>') + '</div>'
    if (!s) return '<div class="lane">' + head + (o.none ? '<p class="lane-foot">' + o.none + '</p>' : '') + '</div>'
    return '<div class="lane">' + head + '<div class="lane-bar"><span aria-hidden="true">0</span>' + icBar(s.pct, s.ci) + '<span aria-hidden="true">100</span></div>' +
      '<p class="lane-foot"><span>' + nTxt(s.n) + (o.extra ? ' ' + o.extra : '') + (s.record ? SEP + recTxt(s.record) : '') + '</span><span>' + nb(ciTxt(s.ci)) + (s.orientativo ? ' · <span class="nb">' + ORI + 'orientativo</span>' : '') + '</span></p></div>'
  }
  /* A's rule, with one source only (mis partidas): «parejo» when the interval of 95 % includes 50 % */
  function deckVerdict(s) {
    if (!s) return { a: 'Todavía sin partidas tuyas con este mazo', why: 'El veredicto sale solo de tus partidas: torneos y bots van aparte, abajo.' }
    const kind = s.ci[0] > 50 ? 'Ganador' : s.ci[1] < 50 ? 'Perdedor' : 'Parejo'
    return { a: kind + ' en tus partidas: ' + pct(s.pct), why: nTxt(s.n) + (s.orientativo ? ', orientativo' : '') + ' · el intervalo, ' + nb(nf1.format(s.ci[0]) + '–' + nf1.format(s.ci[1]) + NB + '%') + ', ' + (s.ci[0] > 50 ? 'queda sobre el' : s.ci[1] < 50 ? 'queda bajo el' : 'incluye el') + ' 50' + NB + '%.' }
  }
  /* a rival in a board: the same energy tokens Meta gives its archetype. An archetype that is not among the most played of the
     data («Vespiquen ex Shuckle ex» in the matchups) takes them from the deck of the data with that very name (#14 «Vespiquen
     ex / Shuckle ex»): the same Pokémon, the same energy. With neither, an empty place, so every name starts at the same spot. */
  const rivalEnergies = (name) => {
    const a = D.meta.arquetipos.find((r) => r.nombre === name)
    if (a) return a.energias
    const key = squash(name)
    const deck = D.mazos.find((m) => squash(m.nombre) === key)
    return deck ? deck.energias : null
  }
  const rivalGems = (name) => { const en = rivalEnergies(name); return en ? gems(en, 'sm') : '<span class="gems" aria-hidden="true"></span>' }
  /* «Por rival»: the rows of the data with what this visit changed in «mías» (a match saved against that rival with this deck) */
  const rivalRows = () => D.mazo.rinde.porRival.map((x, i) => Object.assign({}, x, { i: i, mias: withDelta(x.mias, deltaOf((g) => g.deckId === D.mazo.id && g.rival === x.rival)) }))
  function rivalDetail(x) {
    const a = D.meta.arquetipos.find((r) => r.nombre === x.rival)
    return '<dl class="kv"><dt>Cuota del meta</dt><dd>' + pct(x.cuota) + '</dd></dl>' + srcBlock('m', 'Vos contra él', x.mias) + srcBlock('t', 'En torneos', x.torneo) +
      '<div class="row-actions">' + (a && a.id === D.meta.arquetipo.id ? '<a class="btn" href="#/meta/arquetipo">Abrir el arquetipo</a>' : '') +
      '<button class="btn" data-a="match-open" data-deck="' + D.mazo.id + '" data-rival="' + esc(x.rival) + '" data-f="rv-reg-' + x.i + '" aria-haspopup="dialog">Registrar contra este</button></div>'
  }
  BOARDS.rival = () => {
    const rows = rivalRows()
    const max = Math.max.apply(null, rows.map((x) => x.cuota))
    const cells = rows.reduce((a, x) => a.concat([x.mias, x.torneo]), []).filter(Boolean)
    /* when every cell is «orientativo» the mark on each one is noise: it is said once, in the legend */
    const allOri = cells.length > 0 && cells.every((s) => s.orientativo)
    const plainStat = (s) => (s && allOri ? Object.assign({}, s, { orientativo: false }) : s)
    const worst = ['del peor al mejor', 'del mejor al peor']
    return board({
      id: 'rival', label: 'Contra cada rival', mode: 'one', cellWidth: 104, lead: 'Rival',
      cols: [{ k: 'cuota', label: 'Cuota', long: 'cuota del meta' }, { k: 'mias', label: 'Mías', badge: 'm', long: 'mis partidas contra cada rival', asc: true, words: worst }, { k: 'torneo', label: 'Torneo', badge: 't', long: 'torneos', asc: true, words: worst }],
      rows: rows, key: (x) => x.i, value: (x, k) => (k === 'cuota' ? x.cuota : x[k] ? x[k].pct : null),
      energies: (x) => rivalEnergies(x.rival),
      name: (x) => rivalGems(x.rival) + '<span class="arq-name">' + an(x.rival) + '</span>',
      cell: (x, k) => (k === 'cuota' ? cellNum(pct1(x.cuota), mBar(x.cuota, max)) : cellPct(plainStat(x[k]), { src: k === 'mias' ? 'm' : 't' })),
      detail: rivalDetail,
      foot: '<p class="legend"><span>' + ORI + (!allOri ? 'orientativo: menos de 30 partidas' : cells.every((s) => s.n < 30) ? 'Todo orientativo: ningún cruce llega a 30 partidas.' : 'Todo orientativo: pocos datos en cada cruce.') + '</span><span>«Mías» y «Torneo» ordenan del peor al mejor.</span><span>Tocá una fila: las otras cifras, con intervalo y récord.</span></p>',
    })
  }
  /* The weekly curve (A's): one point per week, bigger with more matches; its number, its n and its Monday are written under it. */
  function weekCurve(curva, id) {
    const today = Date.parse(D.hoy.fecha)
    const rows = curva.map((c) => {
      const age = (today - Date.parse(c.semana)) / 86400000
      const now = age >= 0 && age < 7
      /* the week that is running counts what was saved in this visit */
      return Object.assign({ now: now }, (now ? withDelta(c, delta(id)) : c) || { semana: c.semana, pct: null, n: 0 })
    })
    const max = Math.max.apply(null, rows.map((c) => c.n).concat(1))
    const X = (i) => ((i + 0.5) / rows.length) * 100
    const drawn = rows.map((c, i) => ({ c: c, x: X(i) })).filter((p) => p.c.pct != null)
    const path = drawn.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(2) + ' ' + (100 - p.c.pct).toFixed(2)).join('')
    const said = 'Porcentaje de victorias por semana: ' + rows.map((c) => 'semana del ' + shortDate(c.semana) + ', ' + (c.pct == null ? 'sin datos' : pct(c.pct) + ' (' + nTxt(c.n) + ')')).join('; ')
    return '<div class="wk" role="img" aria-label="' + esc(said) + '"><div class="wk-plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<line class="grid" x1="0" x2="100" y1="0" y2="0"/><line class="half" x1="0" x2="100" y1="50" y2="50"/><line class="grid" x1="0" x2="100" y1="100" y2="100"/>' + (path ? '<path d="' + path + '"/>' : '') + '</svg>' +
      [100, 50, 0].map((v) => '<span class="wk-y" style="top:' + (100 - v) + '%">' + v + NB + '%</span>').join('') +
      drawn.map((p) => '<i class="wk-pt' + (p.c.now ? ' now' : '') + '" style="left:' + p.x.toFixed(2) + '%;top:' + (100 - p.c.pct).toFixed(2) + '%;--d:' + (7 + (9 * p.c.n) / max).toFixed(1) + 'px"></i>').join('') + '</div>' +
      '<div class="wk-cols">' + rows.map((c) => '<span' + (c.now ? ' class="now"' : '') + '>' + (c.pct == null ? '<span class="nd">sin datos</span>' : '<b>' + pct(c.pct) + '</b><span>' + nShort(c.n) + '</span>') + '<span>' + shortDate(c.semana) + '</span></span>').join('') + '</div></div>' +
      '<p class="fine wk-note">Punto más grande: más partidas esa semana. Línea punteada: 50' + NB + '%. Cada columna es una semana y empieza el lunes indicado' + (rows.length && rows[rows.length - 1].now ? '; la última está en curso.' : '.') + '</p>'
  }
  /* «¿Importa empezar?»: the sentence of the data and the two cuts. With matches saved in this visit the numbers move, and the
     sentence is written again without the part only the app can say (whether the difference may be chance). */
  function startCard(m) {
    const e = m.rinde.empezar
    const d1 = deltaOf((g) => g.deckId === m.id && g.started === 'yo')
    const d2 = deltaOf((g) => g.deckId === m.id && g.started === 'rival')
    const moved = [d1, d2].some((x) => x.v || x.d || x.e)
    const first = withDelta(e.primero, d1)
    const second = withDelta(e.segundo, d2)
    const part = (s) => (s ? pct(s.pct) + ' (' + nTxt(s.n) + ')' : 'sin datos')
    return '<section class="card pad pair"><p class="q-answer">' + (moved ? 'Empezando ganás el ' + part(first) + ' y yendo segundo el ' + part(second) + '.' : run(e.texto)) + '</p>' +
      srcBlock('m', 'Empezando', first) + srcBlock('m', 'Yendo segundo', second) +
      (moved ? '<p class="fine">Con las partidas de esta visita. Si la diferencia puede ser azar lo dice la app, que la calcula de nuevo.</p>' : '') + '</section>'
  }
  function panelRinde(m) {
    const r = m.rinde
    const mine = miasOf(m.id, r.mias)
    const v = deckVerdict(mine)
    const open = ui.open.has('src-nota')
    const kind = (f) => { const at = f.etiqueta.indexOf(': '); return at < 0 ? { name: 'Torneo · ' + run(f.etiqueta), sub: '' } : { name: 'Torneo · ' + run(f.etiqueta.slice(0, at)), sub: run(f.etiqueta.slice(at + 2)) } }
    return verdictLine({ q: '¿Cómo rinde?', a: v.a, why: v.why }) +
      sec('Tres fuentes', 'nunca se mezclan') +
      '<section class="card lanes" aria-label="Tres fuentes, nunca mezcladas">' + srcLane('m', 'Mis partidas', mine, { count: true, none: 'Todavía no registraste partidas con este mazo.' }) +
      r.torneo.filas.map((f) => srcLane('t', kind(f).name, f, { sub: kind(f).sub, extra: 'en ' + f.listas + ' listas', count: true })).join('') +
      srcLane('b', 'Simulación · bots ' + esc(r.simulacion.bot), r.simulacion, { count: true }) +
      '<p class="legend">' + srcLegend(r.simulacion.bot) + '<span>' + ORI + 'orientativo: menos de 30 partidas, o pocas listas en torneos</span></p>' +
      '<button class="linkrow board-more" data-a="toggle" data-k="src-nota" data-f="src-nota" aria-expanded="' + open + '" aria-controls="src-nota"><span>Sobre estas fuentes</span><span class="chev">' + ico('down', 18) + '</span></button>' +
      '<div class="detail" id="src-nota"' + (open ? '' : ' hidden') + '><p class="note"><b>Torneo.</b> ' + esc(r.torneo.nota) + '</p><p class="note"><b>Simulación.</b> ' + esc(r.simulacion.nota) + '</p><p class="fine">Punto e intervalo de 95' + NB + '% sobre ' + nb('0–100') + '; la marca es 50' + NB + '%.</p></div></section>' +
      sec('Por rival', 'una columna a la vez') + BOARDS.rival() +
      sec('Semana a semana', '<span class="src-key">' + badge('m') + 'mis partidas</span>') +
      '<section class="card pad">' + weekCurve(r.curva, m.id) + '</section>' +
      sec('¿Importa empezar?', '<span class="src-key">' + badge('m') + 'mis partidas</span>') + startCard(m)
  }
  function panelMejorar(m) {
    const card = (q, i) => {
      let chart = ''
      if (q.curva && q.curva[0].meta != null) {
        chart = plot(q.curva.map((c) => String(c.turno)), [{ cls: 'l1', ys: q.curva.map((c) => c.pct), labels: [3, 4, 7] }, { cls: 'l2', ys: q.curva.map((c) => c.meta), labels: [3, 7] }]) +
          '<div class="plot-legend"><span><i></i>contra un rival pasivo</span><span><i class="b"></i>contra el meta de ' + esc(D.era) + '</span><span class="muted">eje: turno</span></div>'
      } else if (q.curva) {
        chart = plot(q.curva.map((c) => (c.turno === 0 ? 'mano' : String(c.turno))), [{ cls: 'l1', ys: q.curva.map((c) => c.pct), labels: [0, 3, 6] }]) +
          '<div class="plot-legend"><span><i></i>la tenés en la mano</span><span class="muted">eje: turno</span></div>'
      }
      /* the action: a link when the data says where it goes; the test of that question, with this deck, when it goes to Pruebas */
      const ask = D.pruebas.preguntas.find((p) => p.titulo === q.pregunta)
      const btn = q.destino && !(ask && q.destino === '#/pruebas') ? '<a class="btn" href="' + esc(q.destino) + '">' + esc(q.accion) + '</a>'
        : ask ? '<button class="btn" data-a="launch" data-q="' + ask.id + '" data-deck="' + m.id + '" data-f="mej-' + i + '" aria-haspopup="dialog">' + esc(q.accion) + '</button>'
          : '<button class="btn" data-a="static" data-msg="' + esc('En la app, «' + q.accion + '» abre su pantalla con este mazo puesto. La maqueta no la trae.') + '">' + esc(q.accion) + '</button>'
      /* the changes as «+1 / −1» chips: the tournament version's, and the ones of the last search when the sentence of the data
         ends with exactly the changes of the result the mock-up brings (then the sentence keeps its number and the chips say the rest) */
      const res = D.pruebas.resultado
      const at = q.destino === '#/pruebas/resultado/' + res.id ? q.respuesta.lastIndexOf(' con ') : -1
      const same = at >= 0 && q.respuesta.slice(at + 5).replace(/\.$/, '') === res.mejor.cambios.join(', ')
      const chips = i === 0 ? changeTags(m.falta.torneo.cambios) : same ? changeTags(res.mejor.cambios) : ''
      /* where the numbers of this answer come from: the tournament version (torneos), a test of Pruebas (bots) or a plain
         calculation (the opening hand: no source) */
      const src = i === 0 ? ['t', 'torneos'] : /^#\/pruebas/.test(q.destino || '') ? ['b', 'bots ' + esc(m.rinde.simulacion.bot)] : null
      /* (h2, like the groups of the list: under the h1 of the deck these are the sections of the view — with h3 a screen reader
         met a level that hung from nothing, and in Mejorar the h2 «Lanzar una prueba» came after its own h3) */
      return '<section class="card q-card"><div class="q-head"><h2>' + run(q.pregunta) + '</h2>' + (src ? '<span class="src-key">' + badge(src[0]) + src[1] + '</span>' : '') + '</div><p class="q-answer">' + (same ? run(q.respuesta.slice(0, at)) + ' con estos cambios:' : run(q.respuesta)) + '</p>' + chips + chart + '<p class="note">' + run(q.detalle) + '</p>' + btn + '</section>'
    }
    return m.mejorar.map(card).join('') + sec('Lanzar una prueba', 'con este mazo') +
      '<div class="launch">' + D.pruebas.preguntas.map((p) => '<button class="btn" data-a="launch" data-q="' + p.id + '" data-deck="' + m.id + '" data-f="lanzar-' + p.id + '" aria-haspopup="dialog">' + ico(Q_ICON[p.id], 18) + '<span>' + esc(p.titulo) + '</span></button>').join('') + '</div>' + deckLegend(m)
  }
  /* the three badges of the fixed header, said once at the foot of a view that has no board to carry the legend */
  const deckLegend = (m) => '<p class="legend page-legend">' + srcLegend(m.rinde.simulacion.bot) + '</p>'
  function panelNotas(m) {
    return sec('Notas', m.notas.length + ' ' + plural(m.notas.length, 'línea', 'líneas')) +
      '<section class="card pad"><ul class="bullets">' + m.notas.map((n) => '<li>' + run(n) + '</li>').join('') + '</ul><button class="btn" style="margin-top:14px" data-a="static" data-msg="En la app las notas se editan acá mismo. En la maqueta no se cambian.">' + ico('pencil', 16) + 'Editar las notas</button></section>' +
      sec('Revisiones y cambios', 'la más nueva primero') +
      '<section class="card timeline">' + m.revisiones.map((r) => '<div class="rev"><div class="rev-head"><b>Rev. ' + r.n + '</b><span>' + shortDate(r.fecha) + ' · ' + esc(r.origen) + '</span></div>' +
        (r.nota ? '<p class="note">' + esc(r.nota) + '</p>' : '<p class="fine">Sin nota.</p>') + (r.cambios ? changeTags(r.cambios.map((c) => c.replace(/^([+−-])\s+/, '$1' + NB))) : '<p class="fine">Cambios: sin datos.</p>') + '</div>').join('') + '</section>' + deckLegend(m)
  }
  /* A deck the data does not bring whole: the same fixed header, what there is about it (the state, what is missing, its
     sources) and the way to the one that is complete. */
  function deckPartial(base) {
    const id = base.id
    const s = deckSources(id)
    const pm = D.cartas.sobres.porMazo.find((x) => x.id === id)
    const missing = D.cartas.sobres.faltan.filter((c) => c.mazos.indexOf('#' + id) >= 0)
    const tu = pm ? pm.tuLista : base.completo ? 0 : base.falta
    /* The deck's own list is complete and Sobres still lists cards for it: they are missing from its TOURNAMENT version (the
       missing cards of Sobres are counted against the tournament versions). Then that answer is their count — said as what it
       is, a count over the cards the mock-up lists — and each row says which version it belongs to. A complete deck never
       shows a missing card without a name, nor a tournament version that «does not come» next to its own missing card. */
    const ofTourney = !pm && tu === 0 && missing.length > 0
    const sob = D.cartas.sobres
    const played = base.ultima ? 'última partida: ' + dayTxt(base.ultima) : 'sin partidas tuyas'
    return '<section class="hero spine" style="' + acc(base.energias) + '" aria-label="Resumen del mazo"><div class="hero-top"><div class="hero-id">' +
      '<div class="hero-kicker"><span>' + esc(energyNames(base.energias)) + '</span></div>' +
      stateLine([[base.completo, 'completo', plural(base.falta, 'falta', 'faltan') + ' ' + base.falta + ' ' + plural(base.falta, 'carta', 'cartas')]]) + '<div class="hero-meta">' + played + '</div></div>' + deckFan(id) + '</div></section>' +
      needBlock({ tu: tu, torneo: pm ? pm.torneo : ofTourney ? missing.reduce((a, c) => a + c.falta, 0) : null, cards: missing, cardsOf: ofTourney ? 'torneo' : null, days: pm ? pm.dias : null,
        sub: ofTourney && sob.faltan.length < sob.faltanTotal ? 'Lo de la versión de torneo sale de Sobres, que acá lista ' + sob.faltan.length + ' de las ' + sob.faltanTotal + ' cartas que faltan.' : '' }) +
      sec('Tres fuentes', 'nunca se mezclan') +
      '<section class="card lanes" aria-label="Tres fuentes, nunca mezcladas">' + srcLane('m', 'Mis partidas', s.m, { count: true, none: 'Todavía no registraste partidas con este mazo.' }) +
      (s.known
        ? srcLane('t', 'Torneo · su arquetipo contra el meta', s.t, { count: true, extra: s.t && s.t.cobertura != null ? '· <span class="nb">' + (noCover(s.t) ? COV : '') + 'cruces con datos: ' + pct(s.t.cobertura) + '</span> del meta' : '' }) + srcLane('b', 'Laboratorio · bots' + (s.bot ? ' ' + esc(s.bot) : ''), s.b, { count: true })
        : '<div class="lane"><div class="lane-head"><span class="lane-name">' + badge('t') + badge('b') + '<span>Torneo y bots</span></span><span class="nd">no vienen en la maqueta</span></div><p class="lane-foot">La maqueta los trae del mazo #' + D.mazo.id + ' y de los ' + D.hoy.mazosDelDia.length + ' candidatos de «¿Cuál llevo hoy?».</p></div>') +
      '<p class="legend">' + srcLegend(s.bot) + ORI_KEY + (noCover(s.t) ? COV_KEY : '') + '</p></section>' +
      '<section class="card pad"><p class="note">La maqueta trae la ficha completa (lista, cómo rinde, qué mejorar y notas) solo del mazo #' + D.mazo.id + '. De este se muestra lo que hay en los datos compartidos.</p><a class="btn" style="margin-top:12px" href="#/mazo/' + D.mazo.id + '">Abrir ' + run(deckLabel(D.mazo.id)) + '</a></section>'
  }

  /* Cartas. Its views (Sobres · Colección) go in the fixed row, with «Sincronizar» as the action; no scoreboard.
     Sobres: the verdict card with the ticket and its reasons, what has a deadline (only while it is alive), the goals in one
     line, the alternatives as a board (one column: the score, with its bar), the cards that are missing and the days per deck. */
  const CARTAS_TABS = [['sobres', 'Sobres', '#/cartas'], ['coleccion', 'Colección', '#/cartas/coleccion']]
  /* a deadline is alive until its day is over */
  const alive = (iso) => Boolean(iso) && Date.parse(iso) >= Date.parse(D.hoy.fecha)
  /* a sentence of the data, «Head: advice.», in its two parts (the advice with its capital letter) */
  const headAndRest = (text) => { const at = text.indexOf(': '); return at < 0 ? ['', text] : [text.slice(0, at), text.charAt(at + 2).toUpperCase() + text.slice(at + 3)] }
  const leftTxt = (quedan) => (/^1\D/.test(quedan) ? 'queda ' : 'quedan ') + quedan
  function sobresDues() {
    const s = D.cartas.sobres
    const chips = []
    if (s.promo && alive(s.promo.vence)) chips.push({ ev: 'promo', icon: 'gift', label: 'Promo', value: leftTxt(s.promo.quedan), aria: 'Sobres de promoción: ' + leftTxt(s.promo.quedan) + ', hasta el ' + shortDate(s.promo.vence) + '. Abre qué conviene' })
    if (s.cupon && alive(s.cupon.vence)) chips.push({ ev: 'cupon', icon: 'tag', label: 'Cupón ★★', value: 'vence el ' + shortDate(s.cupon.vence), aria: 'Cupón de dos estrellas: vence el ' + shortDate(s.cupon.vence) + '. Abre qué conviene' })
    return dueStrip(chips, 'Con plazo')
  }
  /* a deck named inside a line («para #24 Mega-Charizard Y ex / Entei ex»): its number stays with its first name, each name
     stays whole and, as in every sentence (run), the slash stays at the end of its line: a line never starts with it */
  const deckRef = (ref) => {
    const m = D.mazos.find((x) => x.id === Number(String(ref).replace('#', '')))
    if (!m) return tight(String(ref))
    const par = /^(.*\S) (\([^()]*\))$/.exec(m.nombre)
    const at = par ? -1 : m.nombre.lastIndexOf(' / ')
    return '#' + m.id + NB + (par ? tight(par[1]) + ' ' + tight(par[2]) : at < 0 ? tight(m.nombre) : tight(m.nombre.slice(0, at)) + NB + '/ ' + tight(m.nombre.slice(at + 3)))
  }
  BOARDS.alt = () => {
    const s = D.cartas.sobres
    const top = s.veredicto.numeros.puntaje
    return board({
      id: 'alt', label: 'Alternativas al sobre recomendado', mode: 'one', cellWidth: 92, lead: 'Sobre · qué da',
      cols: [{ k: 'puntaje', label: 'Puntaje', long: 'puntaje' }],
      rows: s.alternativas.map((a, i) => Object.assign({ i: i }, a)), key: (a) => a.i, value: (a) => a.numeros.puntaje,
      name: (a) => '<span><span class="row-title">' + esc(a.nombre) + NB + '<span class="deck-num">· ' + esc(a.expansionId) + '</span></span><span class="row-sub">' + run(a.motivo) + '</span></span>',
      cell: (a) => cellNum(nf2.format(a.numeros.puntaje), mBar(a.numeros.puntaje, top)),
      detail: (a) => '<dl class="kv"><dt>Expansión</dt><dd>' + esc(a.expansion) + '</dd><dt>Al menos una buscada por sobre</dt><dd>' + pct(a.numeros.alMenosUna) + '</dd><dt>Cartas buscadas por sobre</dt><dd>' + nf2.format(a.numeros.buscadas) + '</dd>' +
        '<dt>Sobres para 50' + NB + '%' + NB + '/ 90' + NB + '%</dt><dd>' + a.numeros.sobres50 + NB + '/' + NB + a.numeros.sobres90 + '</dd></dl>',
      foot: '<p class="legend wrap"><span>Barra: el puntaje contra el del recomendado, ' + nf2.format(top) + '.</span><span>Tocá una fila: sus números.</span></p>',
    })
  }
  BOARDS.bydeck = () => {
    const rows = D.cartas.sobres.porMazo
    const max = Math.max.apply(null, rows.map((m) => m.dias).concat(1))
    const lacks = (n) => plural(n, 'falta', 'faltan') + ' ' + n
    return board({
      id: 'bydeck', label: 'Qué le falta a cada mazo y en cuántos días queda completo', mode: 'one', cellWidth: 92, lead: 'Mazo · las dos respuestas',
      cols: [{ k: 'dias', label: 'Días', asc: true, long: 'días para completarlo', words: ['el más cercano primero', 'el más lejano primero'] }],
      rows: rows, key: (m) => m.id, value: (m) => m.dias, energies: (m) => { const d = D.mazos.find((x) => x.id === m.id); return d ? d.energias : null },
      name: (m) => '<span><span class="deck-name"><span class="deck-num">#' + m.id + '</span> ' + dn(m.nombre) + '</span><span class="row-sub">tu lista: <b>' + lacks(m.tuLista) + '</b> · torneo: <b>' + lacks(m.torneo) + '</b></span></span>',
      href: (m) => '#/mazo/' + m.id,
      cell: (m) => cellNum('~' + m.dias, mBar(m.dias, max), plural(m.dias, 'día', 'días')),
      foot: '<p class="legend wrap"><span>Días: en cuántos queda completo, más o menos.</span><span>Tocá un mazo: su ficha.</span></p>',
    })
  }
  function viewSobres() {
    const s = D.cartas.sobres
    const v = s.veredicto
    const miss = (c) => '<li class="miss">' + thumb(c.imagen, c.carta, c.tipo) + '<div><div class="row-title">' + esc(c.carta) + '</div><div class="row-sub">para ' + c.mazos.map(deckRef).join(' y ') + SEP + tight(c.sobre) + '</div>' +
      '<div class="miss-tags"><span class="tag">' + esc(c.consejo) + (c.consejo === 'comprar' ? ' · ' + num(c.puntos) + NB + 'pts' : ' sobres') + '</span>' + (c.consejo === 'comprar' ? '' : '<span class="miss-alt">comprarla: ' + num(c.puntos) + NB + 'pts</span>') + '</div></div>' +
      '<div class="miss-need">×' + c.falta + '<small>' + plural(c.falta, 'falta', 'faltan') + '</small></div></li>'
    return '<section class="holo shine verdict-pack" aria-labelledby="vp-h"><div class="vp-top">' + packArt(v.expansionId) + '<div><div class="kicker h">Conviene abrir</div><h2 class="big-name" id="vp-h">' + esc(v.nombre) + '</h2>' +
      '<div class="fine">' + esc(v.expansion) + NB + '·' + NB + esc(v.expansionId) + '</div><div class="vp-hit"><span class="vp-stat"><b data-count="' + v.numeros.alMenosUna + '">' + pct(v.numeros.alMenosUna) + '</b><span>al menos una por sobre</span></span><span class="vp-stat"><b>' + nf2.format(v.numeros.puntaje) + '</b><span>puntaje</span></span></div></div></div>' +
      '<ul class="why">' + v.porque.map((p) => '<li>' + run(p) + '</li>').join('') + '</ul>' +
      '<button class="linkrow" data-a="numbers" data-f="numbers" aria-haspopup="dialog"><span>Ver los números</span>' + CHEV + '</button></section>' +
      sobresDues() +
      '<button class="card goals" data-a="sheet" data-s="objetivos" data-f="goals" aria-haspopup="dialog"><span class="goals-text"><b>Buscás</b>' + esc(s.objetivos).replace(/ · /g, SEP) + '</span><span class="edit">' + ico('pencil', 16) + 'Editar</span></button>' +
      sec('Alternativas', 'a la venta · por puntaje') + BOARDS.alt() +
      sec('Cartas que faltan', s.faltan.length + ' de ' + s.faltanTotal) +
      '<section class="card rows"><ul>' + s.faltan.map(miss).join('') + '</ul>' + (s.faltan.length < s.faltanTotal ? '<button class="linkrow board-more" data-a="static" data-msg="La maqueta trae ' + s.faltan.length + ' de las ' + s.faltanTotal + ' cartas que faltan."><span>Ver las ' + s.faltanTotal + '</span>' + CHEV + '</button>' : '') + '</section>' +
      sec('Por mazo', 'en cuántos días') + BOARDS.bydeck()
  }

  /* Cartas: Colección — the last synchronization with «Tracker al día» and «Más acciones» in sight (to synchronize is the
     action of the fixed row), the summary with its bar, the search, the chips and the rows with their thumbnail */
  function colRows() {
    const words = wordsOf(ui.colQuery)
    return D.cartas.coleccion.muestra.filter((x) => finds(words, x.nombre + ' ' + x.id))
  }
  const COL_CHIPS = [['todas', 'Todas', () => true], ['tengo', 'Tengo', (x) => x.copias > 0], ['faltan', 'Me faltan', (x) => x.copias === 0]]
  const colShown = () => colRows().filter((COL_CHIPS.find((c) => c[0] === ui.colFilter) || COL_CHIPS[0])[2])
  /* what the list is, next to its title: the sample, or how many of it are in sight when the text or a chip cuts it */
  const colCountTxt = () => { const all = D.cartas.coleccion.muestra.length; const n = colShown().length; return n < all ? n + ' de ' + all + ' de la muestra' : 'muestra de ' + all + ' cartas' }
  /* the list again after the text or a chip changed, with the counts of the chips and of the title */
  function paintCol() {
    $('#col-list').innerHTML = colList()
    paintChipCounts('col-filter', COL_CHIPS, colRows())
    const n = $('#col-count')
    if (n) n.textContent = colCountTxt()
  }
  function colList() {
    const list = colShown()
    if (!list.length) return '<div class="card empty">' + (ui.colQuery.trim() ? 'Nada en la muestra con «' + esc(ui.colQuery.trim()) + '»' + (ui.colFilter === 'todas' ? '.' : ' en este filtro.') : 'Nada en la muestra con este filtro.') + '</div>'
    return '<section class="card rows"><ul>' + list.map((x) => '<li><button class="col-row' + (x.copias ? '' : ' missing') + '" data-a="card" data-c="' + esc(x.id) + '" data-f="col-' + esc(x.id) + '" aria-haspopup="dialog">' + thumb(x.imagen, x.nombre, x.tipo) +
      '<span><span class="row-title">' + esc(x.nombre) + '</span><span class="row-sub"><span class="code">' + esc(x.id) + '</span> · ' + x.ediciones + plural(x.ediciones, ' edición', ' ediciones') + '</span></span>' +
      '<span class="row-end"><b>' + (x.copias ? '×' + x.copias : '0') + '</b><span>' + (x.copias ? plural(x.copias, 'copia jugable', 'copias jugables') : 'te falta') + '</span><span class="pips" aria-hidden="true"><i class="' + (x.copias > 0 ? 'on' : '') + '"></i><i class="' + (x.copias > 1 ? 'on' : '') + '"></i></span></span></button></li>').join('') + '</ul></section>'
  }
  function viewColeccion() {
    const c = D.cartas.coleccion
    const one = c.cartasConUna - c.cartasConDos
    const ch = c.ultimaSyncCambios
    /* the chips count the cards that match what is typed, like the ones of Mazos */
    const found = colRows()
    return '<section class="card sync" aria-label="Sincronización con el juego"><div class="sync-top"><span class="sync-ico" id="sync-ico">' + ico('sync', 22) + '</span><div><div class="row-title">Sincronizada ' + esc(c.ultimaSyncTexto) + '</div>' +
      '<div class="row-sub">' + esc(c.fuente) + SEP + plural(ch.copias + ch.nuevas, 'entró ', 'entraron ') + ch.copias + plural(ch.copias, ' copia', ' copias') + ' y ' + ch.nuevas + plural(ch.nuevas, ' carta nueva', ' cartas nuevas') + '</div></div></div>' +
      '<div class="sync-actions"><button class="btn" data-a="static" data-msg="' + esc(TRACKER_MSG) + '">Tracker al día</button>' +
      '<button class="btn" data-a="sheet" data-s="coleccion" data-f="col-more" aria-haspopup="dialog">Más acciones</button></div></section>' +
      '<section class="card summary" aria-label="Resumen de la colección"><div class="summary-top"><div><span class="label">Tenés</span><div class="stat-big" style="margin-top:4px"><span data-count="' + c.cartasConUna + '" data-unit="">' + num(c.cartasConUna) + '</span><small> de ' + num(c.cartasConUna + c.faltantes) + ' cartas</small></div></div><span class="summary-copies"><b>' + num(c.copias) + '</b> copias</span></div>' +
      '<div class="dist" role="img" aria-label="' + esc(num(c.cartasConDos) + ' cartas con dos o más copias, ' + num(one) + ' con una sola y ' + num(c.faltantes) + ' que faltan') + '"><i class="two" style="flex:' + c.cartasConDos + '"></i><i class="one" style="flex:' + one + '"></i><i class="zero" style="flex:' + c.faltantes + '"></i></div>' +
      '<div class="keys"><div><b><i style="background:var(--tx)"></i>' + num(c.cartasConDos) + '</b>con 2 o más</div><div><b><i style="background:var(--tx3)"></i>' + num(one) + '</b>con una sola</div><div><b><i style="box-shadow:inset 0 0 0 1.5px var(--ctl-line)"></i>' + num(c.faltantes) + '</b>te faltan</div></div></section>' +
      '<div class="filters"><div class="col-search">' + ico('search', 18) + '<input class="field" type="search" id="col-q" placeholder="Buscar: nombre o código" aria-label="Buscar en la colección por nombre o código" value="' + esc(ui.colQuery) + '" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"></div>' +
      '<div class="chipline" role="group" aria-label="Qué cartas mostrar">' + COL_CHIPS.map((f) => '<button class="chip" data-a="col-filter" data-v="' + f[0] + '" aria-pressed="' + (ui.colFilter === f[0]) + '">' + f[1] + ' <span class="count">' + found.filter(f[2]).length + '</span></button>').join('') + '</div></div>' +
      sec(esc(c.expansionMuestra), '<span id="col-count">' + colCountTxt() + '</span>') +
      '<div id="col-list">' + colList() + '</div>'
  }

  /* Pruebas. Its views (Pruebas · Practicar · Motor) go in the fixed row, with «+» (a new test) as the action; no scoreboard.
     Pruebas: first the last result that finished, as the verdict; one line about the engine only while something is running or
     broken; the four questions; the list of jobs with what each one gave. */
  const PRUEBAS_TABS = [['pruebas', 'Pruebas', '#/pruebas'], ['practicar', 'Practicar', '#/pruebas/practicar'], ['motor', 'Motor', '#/pruebas/motor']]
  const Q_ICON = { meta: 'trophy', cambio: 'flask', versus: 'vs', turno: 'clock' }
  const Q_SHORT = { meta: 'Meta', cambio: 'Cambio', versus: 'Versus', turno: 'Turno' }
  const STATE = { 'en cola': ['wait', 'en cola'], corriendo: ['run', 'corriendo'], cancelada: ['off', 'cancelada'], terminada: ['done', 'terminada'], 'falló': ['fail', 'falló'] }
  function jobRow(j) {
    const st = STATE[j.estado] || ['off', j.estado]
    /* in the app every job opens its result: the arrow says it leads to another screen */
    const inner = '<span class="job-top"><span class="state ' + st[0] + '"><i></i>' + esc(st[1]) + '</span><span class="job-kind"><span class="nb">#' + j.id + ' · ' + esc(j.tipo) + '</span> · <span class="nb">' + esc(j.cuando) + '</span></span>' + CHEV + '</span>' +
      '<span class="job-name">' + run(j.nombre) + '</span>' +
      (j.progreso ? '<span class="job-prog"><span class="prog"><i style="width:' + j.progreso.pct + '%"></i></span><span>' + num(j.progreso.hechas) + ' de ' + num(j.progreso.total) + ' · ' + pct(j.progreso.pct) + '</span></span>' : '') +
      '<span class="job-result' + (j.resultado ? '' : ' none') + '">' + (j.resultado ? run(j.resultado) : 'Sin resultado: ' + (j.estado === 'cancelada' ? 'se canceló.' : 'todavía no terminó.')) + '</span>'
    return j.id === D.pruebas.resultado.id ? '<li><a class="job" href="#/pruebas/resultado/' + j.id + '">' + inner + '</a></li>' : '<li><button class="job" data-a="static" data-msg="La maqueta trae el detalle solo de la búsqueda #' + D.pruebas.resultado.id + '.">' + inner + '</button></li>'
  }
  function jobList() {
    const list = D.pruebas.trabajos.filter((j) => ui.jobFilter === 'todas' || j.pregunta === ui.jobFilter)
    return list.length ? '<ul class="card rows">' + list.map(jobRow).join('') + '</ul>' : '<div class="card empty">Ningún trabajo de esta pregunta.</div>'
  }
  /* the last result that finished, as the verdict: its sentence in two parts (the answer, and the rest as its why) and the way to it */
  function pruebasTop() {
    const p = D.pruebas
    const j = p.trabajos.find((x) => x.estado === 'terminada' && x.resultado)
    if (!j) return verdictLine({ q: 'Lo último que terminó', a: 'Todavía no terminó ninguna prueba', why: 'Cuando termine una, lo que dio va primero acá.' })
    const ask = p.preguntas.find((x) => x.id === j.pregunta)
    const r = p.resultado.id === j.id ? p.resultado : null
    const text = r ? r.veredicto : j.resultado
    const cut = /^(.*?) \((IC[^)]*)\) (.*)$/.exec(text)
    const inner = '<span class="lr-main"><span class="row-title">' + run(j.nombre) + '</span>' +
      (r ? '<span class="row-sub">tu lista ' + pct(r.base.pct) + ' → la mejor <b>' + pct(r.mejor.pct) + '</b></span>' : '') +
      '<span class="row-sub lr-facts"><span>#' + j.id + ' · ' + esc(j.cuando) + '</span>' + (r ? '<span>' + badge('b') + ' bots ' + esc(r.bot) + ' · ' + nShort(r.mejor.n) + ' por lista</span>' : '<span>' + esc(j.tipo) + '</span>') + '</span></span>' + CHEV
    return verdictLine({ q: 'Terminó · ' + esc(ask ? ask.titulo : j.tipo), a: run(cut ? cut[1] : text), why: cut ? run(cut[2] + ' ' + cut[3]) : '' }) +
      (r ? '<a class="card last-res" href="#/pruebas/resultado/' + j.id + '" aria-label="' + esc('Ver el resultado ' + j.id + ': ' + j.nombre) + '">' + inner + '</a>'
        : '<button class="card last-res" data-a="static" data-msg="La maqueta trae el detalle solo de la búsqueda #' + p.resultado.id + '.">' + inner + '</button>')
  }
  /* one line about the engine, and only while something is running or broken; it leads to the view Motor */
  function engineLine() {
    const m = D.pruebas.motor
    const job = D.pruebas.trabajos.find((j) => j.id === m.trabajoActual && j.estado === 'corriendo')
    const down = m.estado !== 'en línea'
    if (!job && !down) return ''
    const queue = m.cola + ' ' + plural(m.cola, 'tanda', 'tandas') + ' en cola'
    const text = down ? 'Worker ' + esc(m.estado) + ' · ' + queue : 'Jugando #' + job.id + ' · <b>' + pct(job.progreso.pct) + '</b> · ' + queue
    return '<a class="engine-line' + (down ? ' down' : '') + '" href="#/pruebas/motor" data-a="tab" data-href="#/pruebas/motor" aria-label="' + esc((down ? 'El worker está ' + m.estado : 'El motor está jugando el trabajo ' + job.id + ', va ' + pct(job.progreso.pct)) + '; ' + queue + '. Abre Motor') + '">' +
      '<i class="el-dot" aria-hidden="true"></i><span class="el-text">' + text + '</span>' + (job && !down ? '<span class="prog" aria-hidden="true"><i style="width:' + job.progreso.pct + '%"></i></span>' : '') + CHEV + '</a>'
  }
  function viewPruebas(sub) {
    if (sub === 'practicar') return viewPracticar()
    if (sub === 'motor') return viewMotor()
    const p = D.pruebas
    const count = (id) => p.trabajos.filter((j) => j.pregunta === id).length
    const filters = [['todas', 'Todas']].concat(p.preguntas.map((q) => [q.id, Q_SHORT[q.id]]))
    return pruebasTop() + engineLine() +
      sec('¿Qué querés saber?', 'tocá una: la lanza') +
      '<div class="q-grid">' + p.preguntas.map((q) => '<button class="card q-tile" data-a="launch" data-q="' + q.id + '" data-f="q-' + q.id + '" aria-haspopup="dialog"><span class="q-tile-top"><span class="q-tile-ico">' + ico(Q_ICON[q.id], 18) + '</span><span class="q-tile-foot">' + count(q.id) + plural(count(q.id), ' trabajo', ' trabajos') + ico('plus', 18) + '</span></span>' +
      '<span class="q-tile-title">' + esc(q.titulo) + '</span></button>').join('') + '</div>' +
      sec('Trabajos', '<span class="src-key">' + badge('b') + 'bots</span> · qué dio cada uno') +
      '<div class="chipline fit" role="group" aria-label="Filtrar los trabajos por pregunta">' + filters.map((f) => '<button class="chip" data-a="job-filter" data-v="' + f[0] + '" aria-pressed="' + (ui.jobFilter === f[0]) + '">' + f[1] + ' <span class="count">' + (f[0] === 'todas' ? p.trabajos.length : count(f[0])) + '</span></button>').join('') + '</div>' +
      '<div id="job-list">' + jobList() + '</div>' +
      '<p class="demo-note">' + ico('bot', 16) + '<span>' + esc(p.resultado.nota) + '</span></p>'
  }
  /* Practicar: the game against the bot that is going on, the spots to solve and the drills */
  function viewPracticar() {
    const pr = D.pruebas.practicar
    const cut = pr.enCurso ? /^(.*?): (.*?) contra (.*)$/.exec(pr.enCurso) : null
    const row = (icon, title, sub, end, msg) => '<li><button class="row" data-a="static" data-msg="' + esc(msg) + '"><span class="menu-ico">' + ico(icon, 20) + '</span><span class="row-main"><span class="row-title">' + title + '</span><span class="row-sub">' + sub + '</span></span>' + end + '</button></li>'
    return verdictLine({ q: 'Contra el bot · en curso', a: !pr.enCurso ? 'Ninguna partida en curso' : cut ? run(cut[1] + ' con') + ' <span class="whole">' + run(cut[2]) + '</span>' : run(pr.enCurso), why: cut ? run('Contra ' + cut[3] + '.') : '' }) +
      (pr.enCurso ? '<button class="btn block go-on" data-a="static" data-msg="En la app sigue la partida contra el bot, en la mesa. La maqueta no la trae.">' + ico('play', 16) + 'Seguir la partida</button>' : '') +
      sec('Para practicar') +
      '<ul class="card rows">' +
      row('target', 'Situaciones para resolver', 'Tus errores de las partidas con entrenador', '<span class="row-end"><b>' + pr.situaciones + '</b><span>' + plural(pr.situaciones, 'pendiente', 'pendientes') + '</span></span>' + CHEV, 'En la app abre las situaciones para resolver. La maqueta no las trae.') +
      row('grid', 'Ejercicios de cálculo', 'Robo y daño para KO', '<span class="row-end"><b>' + pr.ejerciciosHoy + '</b><span>hoy</span></span>' + CHEV, 'En la app abre los ejercicios de cálculo. La maqueta no los trae.') +
      row('bot', 'Nueva partida contra el bot', 'Contra un mazo tuyo o una lista de torneo', CHEV, 'En la app elegís tu mazo y el rival, y arranca la partida. La maqueta no la trae.') + '</ul>'
  }
  /* Motor: the state of the worker as a board (C's), the queue, and the way to calibration and analysis */
  function viewMotor() {
    const p = D.pruebas
    const m = p.motor
    /* «Jugando» only while that job is running: the same rule as the engine line of Pruebas */
    const job = p.trabajos.find((j) => j.id === m.trabajoActual && j.estado === 'corriendo' && j.progreso)
    const up = m.estado === 'en línea'
    const queued = p.trabajos.filter((j) => j.estado === 'corriendo').concat(p.trabajos.filter((j) => j.estado === 'en cola'))
    const bank = p.preguntas[0].bajada.slice(p.preguntas[0].bajada.indexOf(': ') + 2)
    const bankText = bank.charAt(0).toUpperCase() + bank.slice(1).replace(/\.$/, '')
    const links = [['target', 'Calibración', 'Compara los bots contra los torneos', 'En la app abre la calibración: el banco contra los torneos. La maqueta no la trae.'], ['up', 'Análisis', 'Tiempos, partidas y uso del motor', 'En la app abre el análisis de simulaciones. La maqueta no lo trae.'], ['trophy', 'Banco del meta', bankText, 'En la app abre el banco del meta, con sus listas. La maqueta no lo trae.']]
    return scoreboard([
      { k: 'Worker', v: '<span class="tight ' + (up ? 'ok' : 'bad') + '">' + esc(m.estado) + '</span>', f: '<span class="n">' + esc(m.worker) + '</span>', aria: 'Worker ' + m.worker + ': ' + m.estado },
      { k: 'Jugando', v: job ? '#' + job.id : '<span class="nd">nada</span>', f: job ? '<span class="n">' + pct(job.progreso.pct) + '</span>' + mBar(job.progreso.pct, 100) : '', aria: job ? 'Jugando el trabajo ' + job.id + ': va ' + pct(job.progreso.pct) : 'No está jugando nada' },
      { k: 'Cola', v: num(m.cola), f: '<span class="n">' + plural(m.cola, 'tanda', 'tandas') + '</span>', aria: 'Cola: ' + m.cola + ' ' + plural(m.cola, 'tanda', 'tandas') + ' de partidas esperando, de ' + m.colaTrabajos + ' ' + plural(m.colaTrabajos, 'trabajo', 'trabajos') },
    ], { label: 'Estado del motor', cols: '1.22fr .92fr .86fr' }) +
      '<p class="fine engine-facts"><span class="nb">' + m.nucleos + ' ' + plural(m.nucleos, 'núcleo', 'núcleos') + ' para simular</span> · <span class="nb">worker ' + esc(m.version) + '</span> · <span class="nb">motor <span class="code mono">' + esc(m.motor) + '</span></span></p>' +
      sec('La cola', m.colaTrabajos + ' ' + plural(m.colaTrabajos, 'trabajo', 'trabajos') + ' · ' + m.cola + ' ' + plural(m.cola, 'tanda', 'tandas')) +
      (queued.length ? '<ul class="card rows">' + queued.map(jobRow).join('') + '</ul>' : '<div class="card empty">Nada en cola.</div>') +
      sec('Más del motor') +
      '<ul class="card rows">' + links.map((r) => '<li><button class="row" data-a="static" data-msg="' + esc(r[3]) + '"><span class="menu-ico">' + ico(r[0], 20) + '</span><span class="row-main"><span class="row-title">' + r[1] + '</span><span class="row-sub">' + esc(r[2]) + '</span></span>' + CHEV + '</button></li>').join('') + '</ul>'
  }

  /* Un resultado: B's headline (the gain, with «Tu lista» and «La mejor» on one scale), the sentence, the changes, what each
     card weighs, the variants as a sortable board and the technical part folded. «Actualizar el mazo» is the fixed action. */
  const resRows = () => {
    const r = D.pruebas.resultado
    return [Object.assign({ key: 'mejor', nombre: 'La mejor' }, r.mejor)].concat(r.variantes.map((v, i) => Object.assign({ key: 'v' + i }, v))).concat([Object.assign({ key: 'base', nombre: 'Tu lista', cambios: [] }, r.base)])
  }
  /* the scale every interval of the result shares: the tens around all of them (40–70 with the data of the mock-up) */
  const resScale = () => { const rows = resRows(); return [Math.floor(Math.min.apply(null, rows.map((v) => v.ci[0])) / 10) * 10, Math.ceil(Math.max.apply(null, rows.map((v) => v.ci[1])) / 10) * 10] }
  BOARDS.vari = () => {
    const r = D.pruebas.resultado
    const sc = resScale()
    const byChanges = (ui.sort.vari || {}).k === 'cambios'
    const maxChanges = Math.max.apply(null, resRows().map((v) => v.cambios.length).concat(1))
    return board({
      id: 'vari', label: 'Las listas que probó la búsqueda', mode: 'one', cellWidth: 116, lead: 'Lista',
      cols: [{ k: 'pct', label: '% vs meta', badge: 'b', long: 'porcentaje contra el meta, con bots' }, { k: 'cambios', label: 'Cambios', asc: true, long: 'cantidad de cambios sobre tu lista', words: ['menos cambios primero', 'más cambios primero'] }],
      rows: resRows(), key: (v) => v.key, value: (v, k) => (k === 'pct' ? v.pct : v.cambios.length),
      /* under the name, the figure the value column is not showing: the changes, or (sorted by them) the percentage with its badge */
      name: (v) => '<span><span class="row-title">' + esc(v.nombre) + '</span><span class="row-sub">' + (byChanges ? badge('b', true) + ' ' + pct1(v.pct) + ' · ' + nShort(v.n) : v.key === 'base' ? 'la lista de partida' : v.cambios.length + ' ' + plural(v.cambios.length, 'cambio', 'cambios')) + '</span></span>',
      cell: (v, k) => (k === 'cambios' ? cellNum(String(v.cambios.length), mBar(v.cambios.length, maxChanges), plural(v.cambios.length, 'cambio', 'cambios'))
        : cellPct(v, { src: 'b', chart: mZoom(v, sc[0], sc[1], v.key === 'base' ? null : r.base.pct) })),
      detail: (v) => '<p class="fine">' + nb(ciTxt(v.ci)) + ' · ' + nTxt(v.n) + '</p>' + (v.cambios.length ? changeTags(v.cambios) : '<p class="fine">Sin cambios: es la lista de la que partió la búsqueda.</p>'),
      foot: '<p class="legend wrap"><span class="src-key">' + badge('b') + 'bots ' + esc(r.bot) + '</span><span>Punto e intervalo sobre ' + nb(sc[0] + '–' + sc[1] + NB + '%') + '.</span><span><i class="refmark"></i>tu lista: ' + pct(r.base.pct) + '</span><span>Tocá una fila: IC y cambios.</span></p>',
    })
  }
  function viewResultado() {
    const r = D.pruebas.resultado
    const job = D.pruebas.trabajos.find((j) => j.id === r.id)
    const ask = job ? D.pruebas.preguntas.find((q) => q.id === job.pregunta) : null
    const sc = resScale()
    const z = { min: sc[0], max: sc[1], noMid: true }
    const open = ui.open.has('res-tec')
    const effect = (e) => {
      const mt = /(entra|sale): ([+−-])(\d+(?:,\d+)?) puntos \((\d+) variantes\)/.exec(e.efecto)
      if (!mt) return '<li class="effect"><span class="row-title">' + esc(e.carta) + '</span><span></span><span class="fine">' + esc(e.efecto) + '</span></li>'
      const val = (mt[2] === '+' ? 1 : -1) * parseFloat(mt[3].replace(',', '.'))
      return '<li class="effect"><span><span class="row-title">' + (mt[1] === 'entra' ? 'Poner ' : 'Sacar ') + esc(e.carta) + '</span><span class="row-sub">en ' + mt[4] + ' variantes</span></span>' + divBar(val, 0, 3) + '<b>' + signed(val) + '</b></li>'
    }
    const duo = (who, s, o, cls) => '<div class="duo-row' + cls + '"><span class="who">' + who + '</span>' + icBar(s.pct, s.ci, o) + '<span class="duo-val"><b>' + pct1(s.pct) + '</b><small>' + nShort(s.n) + '</small></span></div>'
    return '<section class="holo shine res-hero" aria-labelledby="res-h"><div><div class="kicker h">' + esc(ask ? ask.titulo : 'Resultado') + ' · búsqueda #' + r.id + '</div><h1 class="big-name res-title" id="res-h">' + esc(r.titulo) + '</h1>' +
      '<a class="res-deck" href="#/mazo/' + r.mazoId + '">sobre ' + run(deckLabel(r.mazoId)) + '</a></div>' +
      '<div class="gain"><b data-count="' + r.diferencia.pts + '" data-unit="" data-signed>' + signed(r.diferencia.pts) + '</b><span>puntos sobre tu lista<br>' + nb('IC' + NB + '95' + NB + '%: ' + signed(r.diferencia.ci[0]) + ' a ' + signed(r.diferencia.ci[1])) + '</span></div>' +
      '<div class="duo zoom">' + duo('Tu lista', r.base, z, '') + duo('La mejor', r.mejor, Object.assign({ ref: r.base.pct }, z), ' best') +
      '<div class="icscale" aria-hidden="true"><span>' + sc[0] + NB + '%</span><span>' + num((sc[0] + sc[1]) / 2) + NB + '%</span><span>' + sc[1] + NB + '%</span></div></div>' +
      '<p class="res-src"><span class="src-key">' + badge('b') + 'bots ' + esc(r.bot) + ', contra ' + esc(r.contra) + '</span><span><i class="refmark"></i>marca: tu lista</span></p>' +
      '<p class="note res-verdict">' + run(r.veredicto) + '</p><div><div class="label" style="margin-bottom:6px">Los cambios de la mejor</div>' + changeTags(r.mejor.cambios) + '</div>' +
      '<p class="fine"><span class="tag ' + (r.robusto ? 'ok' : 'warn') + '">' + (r.robusto ? 'robusto' : 'sensible al bot') + '</span> ' + run(r.robustoTexto.replace(/^robusto: /, '')) + ' · novedad: ' + esc(r.mejor.novedad) + '</p>' +
      '<button class="btn block" data-a="static" data-msg="En la app guarda la mejor lista como un mazo nuevo. La maqueta no escribe.">Guardar como mazo nuevo</button></section>' +
      sec('Qué pesa cada carta', 'puntos, en promedio') +
      '<section class="card rows"><ul>' + r.porCarta.map(effect).join('') + '</ul></section>' +
      sec('Variantes', resRows().length + ' listas · una columna a la vez') + BOARDS.vari() +
      '<section class="card rows fold"><button class="linkrow" data-a="toggle" data-k="res-tec" data-f="res-tec" aria-expanded="' + open + '" aria-controls="res-tec"><span>Cómo se hizo</span><span class="chev">' + ico('down', 18) + '</span></button>' +
      '<div class="detail" id="res-tec"' + (open ? '' : ' hidden') + '><dl class="kv"><dt>Partidas</dt><dd>' + num(r.partidas) + '</dd><dt>Rondas</dt><dd>' + r.rondas + '</dd><dt>Terminó porque</dt><dd>' + esc(r.fin) + '</dd><dt>Bot</dt><dd>' + esc(r.bot) + '</dd><dt>Contra</dt><dd>' + esc(r.contra) + '</dd></dl></div></section>' +
      '<p class="demo-note">' + ico('bot', 16) + '<span>' + esc(r.nota) + '</span></p>'
  }

  /* Meta: the scoreboard of the era, the verdict in one line, the event that is going on and ONE board, «Qué se juega», sorted
     by one column at a time (the share with its bar, the trend with its curve, the win rate with its interval and its n).
     A row opens in place: the other figures, «Abrir el arquetipo» and «Probar contra este». */
  const built = (a) => /^armado/.test(a.tengo || '')
  const winDays = () => { const w = D.meta.ventanasSerie[0]; return Math.round((Date.parse(w.hasta) - Date.parse(w.desde)) / 86400000) }
  const META_FILTERS = [['todos', 'Todos', () => true], ['suben', 'Suben', (a) => a.tendencia > 0], ['bajan', 'Bajan', (a) => a.tendencia < 0], ['sinarmar', 'Sin armar', (a) => !built(a)]]
  const ownTag = (a) => (a.tengo ? '<span class="tag' + (built(a) ? '' : ' warn') + '">' + esc(a.tengo) + '</span>' : '<span class="tag warn">sin armar</span>')
  function metaDetail(a) {
    const m = D.meta
    const full = a.id === m.arquetipo.id
    return '<dl class="kv"><dt>Cuota del meta</dt><dd>' + pct(a.cuota) + ' · en ' + num(a.enListas) + ' listas</dd>' +
      '<dt class="wide">Cuota en las ' + a.serie.length + ' ventanas de ' + winDays() + NB + 'días</dt><dd class="wide">' + a.serie.map((v) => nf1.format(v)).join(' · ') + NB + '%</dd>' +
      '<dt>En ' + m.tendenciaDias + NB + 'días</dt><dd>' + signed(a.tendencia) + NB + 'pts · ' + (a.tendenciaClara ? 'cambio claro' : 'puede ser azar') + '</dd></dl>' +
      srcBlock('t', 'En torneos', a) +
      '<div class="row-actions">' + (full ? '<a class="btn" href="#/meta/arquetipo">Abrir el arquetipo</a>' : '<button class="btn" data-a="static" data-msg="' + esc('La maqueta trae la ficha solo de ' + m.arquetipo.nombre + '.') + '">Abrir el arquetipo</button>') +
      '<button class="btn" data-a="launch" data-q="versus" data-rival="' + esc(a.nombre) + '" data-f="meta-test-' + esc(a.id) + '" aria-haspopup="dialog">Probar contra este</button></div>'
  }
  BOARDS.meta = () => {
    const m = D.meta
    const max = Math.max.apply(null, m.arquetipos.map((a) => a.cuota))
    const f = META_FILTERS.find((x) => x[0] === ui.metaFilter) || META_FILTERS[0]
    const rows = m.arquetipos.filter(f[2])
    return board({
      id: 'meta', label: 'Qué se juega: los arquetipos más jugados', mode: 'one', cellWidth: 104, lead: 'Arquetipo',
      cols: [
        { k: 'cuota', label: 'Cuota', long: 'cuota del meta' },
        { k: 'tendencia', label: m.tendenciaDias + ' días', long: 'tendencia de la cuota en ' + m.tendenciaDias + ' días', words: ['los que más suben primero', 'los que más bajan primero'], cap: m.tendenciaDias + ' días · pts' },
        { k: 'pct', label: '% vict.', badge: 't', long: 'porcentaje de victorias en torneos' },
      ],
      rows: rows, key: (a) => a.id, value: (a, k) => a[k], energies: (a) => a.energias,
      name: (a) => gems(a.energias, 'sm') + '<span class="arq-name">' + an(a.nombre) + ' ' + ownTag(a) + '</span>',
      cell: (a, k) => (k === 'cuota' ? cellNum(pct1(a.cuota), mBar(a.cuota, max))
        : k === 'tendencia' ? '<span class="bcell trend' + (a.tendenciaClara ? ' clear' : '') + '"><span class="bcell-v"><b>' + signed(a.tendencia) + '</b><span class="n">pts</span></span>' + spark(a.serie, 92, 18) + '</span>'
          : cellPct(a, { src: 't' })),
      detail: metaDetail,
      empty: f[0] === 'sinarmar' ? 'Ninguno: tenés un mazo armado de cada uno de estos ' + m.arquetipos.length + ' arquetipos.' : 'Ningún arquetipo en este filtro.',
      foot: '<p class="legend wrap"><span class="src-key">' + badge('t') + 'torneos</span>' + (m.arquetipos.some((a) => a.orientativo) ? '<span>' + ORI + 'orientativo</span>' : '') + '<span>«' + m.tendenciaDias + NB + 'días»: puntos de cuota; en negrita, cambio claro.</span><span>Curva: la cuota en ' + m.ventanasSerie.length + ' ventanas de ' + winDays() + NB + 'días, cada una contra su máximo.</span><span>Tocá una fila: las otras cifras.</span></p>',
    })
  }
  function viewMeta() {
    const m = D.meta
    const ev = D.hoy.pendientes.find((p) => p.tipo === 'evento')
    const first = m.arquetipos.reduce((a, b) => (b.cuota > a.cuota ? b : a))
    const where = first.ci[0] > m.media.pct ? 'queda sobre' : first.ci[1] < m.media.pct ? 'queda bajo' : 'incluye'
    const last = m.ventanasSerie[m.ventanasSerie.length - 1]
    const evAt = ev ? ev.texto.lastIndexOf(': ') : -1
    const big = (v) => '<span data-count="' + v + '" data-unit="">' + nf.format(v) + '</span><small>' + NB + '%</small>'
    return scoreboard([
      { k: 'Torneos', ev: 'torneos', v: num(m.torneos), f: '<span class="n">era ' + esc(m.era) + '</span>', aria: m.torneos + ' torneos en la era ' + m.era + '. Abre el detalle de la era' },
      { k: 'Listas', ev: 'listas', v: num(m.listas), f: '<span class="n">' + num(last.listas) + ' en ' + winDays() + ' días</span>', aria: num(m.listas) + ' listas; ' + num(last.listas) + ' en los últimos ' + winDays() + ' días. Abre el detalle de la era' },
      { k: badge('t') + 'Media', ev: 'media', v: big(m.media.pct), f: '<span class="n">' + nShort(m.media.n) + '</span>', aria: 'Media de victorias de la era, en torneos: ' + pct(m.media.pct) + ', ' + nTxt(m.media.n) + '. Abre el detalle de la era' },
    ], { label: 'Marcador de la era' }) +
      verdictLine({ q: '¿Qué se juega?', a: '<span class="whole">' + esc(first.nombre) + '</span> es lo más jugado: <span class="nb">' + pct(first.cuota) + '</span>', why: badge('t') + ' Gana el ' + pct(first.pct) + ' (' + nTxt(first.n) + '): su intervalo, <span class="nb">' + nf1.format(first.ci[0]) + '–' + nf1.format(first.ci[1]) + NB + '%</span>, ' + where + ' la media de la era.' }) +
      (ev ? '<section class="card event" aria-label="Evento en curso"><div class="label">' + ico('calendar', 14) + '<span>Evento en curso</span>' + (evAt >= 0 ? '<b class="event-due">' + esc(ev.texto.slice(evAt + 2)) + '</b>' : '') + '</div><div class="row-title">' + esc(evAt >= 0 ? ev.texto.slice(0, evAt) : ev.texto) + '</div><p class="row-sub">' + esc(ev.detalle) + '</p></section>' : '') +
      sec('Qué se juega', 'los ' + m.arquetipos.length + ' más jugados') +
      '<div class="chipline fit" role="group" aria-label="Qué arquetipos mostrar">' + META_FILTERS.map((c) => '<button class="chip" data-a="meta-filter" data-v="' + c[0] + '" aria-pressed="' + (ui.metaFilter === c[0]) + '">' + c[1] + ' <span class="count">' + m.arquetipos.filter(c[2]).length + '</span></button>').join('') + '</div>' +
      BOARDS.meta() +
      '<p class="demo-note">' + ico('info', 16) + '<span>' + esc(m.atribucion) + '. ' + esc(m.eraNombre) + ' (' + esc(m.era) + '), ' + esc(m.formato) + '. Las ventanas van del ' + shortDate(m.ventanasSerie[0].desde) + ' al ' + shortDate(last.hasta) + '. ' + esc(D.aviso) + '.</span></p>'
  }
  /* A plain-text note with «- » bullets and numbered steps becomes headings and lists. */
  function noteHtml(text) {
    const out = []
    let list = null
    text.split('\n').forEach((line) => {
      const item = /^- (.*)$/.exec(line) || /^\d+\. (.*)$/.exec(line)
      const tag = !item ? null : /^-/.test(line) ? 'ul' : 'ol'
      if (item) { if (!list || list.tag !== tag) { list = { tag: tag, items: [] }; out.push(list) } list.items.push(item[1]) } else { list = null; if (line.trim()) out.push(line) }
    })
    return out.map((x, i) => (typeof x === 'string' ? '<div class="label" style="margin:' + (i ? 14 : 0) + 'px 0 8px">' + esc(x) + '</div>' : '<' + x.tag + ' class="bullets small' + (x.tag === 'ol' ? ' steps' : '') + '">' + x.items.map((it) => '<li>' + run(it) + '</li>').join('') + '</' + x.tag + '>')).join('')
  }

  /* Un arquetipo: its name, its scoreboard (torneos · cuota · vos), the verdict in one line, two actions, my note, the matchups
     as a board (worst first · n · share) and the lists. «Registrar contra este» is the fixed action. */
  /* «vos contra él» as it stands now: the data plus the matches saved against him in this visit, with any deck */
  const arqMine = () => { const a = D.meta.arquetipo; return withDelta(a.misPartidas, deltaOf((g) => g.rival === a.nombre)) }
  const arqTrend = () => { const a = D.meta.arquetipo; const row = D.meta.arquetipos.find((x) => x.id === a.id); return row ? row.tendenciaClara : null }
  function arqVerdict(a, mine) {
    const media = D.meta.media.pct
    const t = a.ci[0] > media ? ['Rinde sobre la media', 'queda sobre'] : a.ci[1] < media ? ['Rinde bajo la media', 'queda bajo'] : ['Rinde como la media', 'incluye']
    const y = !mine ? ['todavía no jugaste contra él', ''] : mine.ci[1] < 50 ? ['a vos te viene ganando', 'queda bajo el'] : mine.ci[0] > 50 ? ['vos le venís ganando', 'queda sobre el'] : ['con vos viene parejo', 'incluye el']
    return {
      a: t[0] + '; ' + y[0],
      why: '<span class="nb">' + badge('t') + ' ' + pct(a.pct) + '</span> (' + nTxt(a.n) + '): el intervalo ' + t[1] + ' la media de la era, ' + pct(media) + '. ' +
        (mine ? '<span class="nb">' + badge('m') + ' ' + pct(mine.pct) + '</span> (' + nTxt(mine.n) + (mine.orientativo ? ', orientativo' : '') + '): el intervalo ' + y[1] + ' 50' + NB + '%.' : '<span class="nb">' + badge('m') + ' sin datos</span>: no hay partidas tuyas contra él.'),
    }
  }
  BOARDS.mu = () => {
    const a = D.meta.arquetipo
    const maxShare = Math.max.apply(null, a.matchups.map((x) => x.cuota))
    return board({
      id: 'mu', label: 'Matchups de ' + a.nombre + ' en torneos', mode: 'one', cellWidth: 104, lead: 'Rival',
      cols: [{ k: 'pct', label: '% vict.', badge: 't', asc: true, long: 'porcentaje de victorias contra cada rival', words: ['del peor al mejor', 'del mejor al peor'] }, { k: 'n', label: '<span class="lc">n</span>', long: 'cantidad de partidas', cap: 'Partidas', capBadge: 't' }, { k: 'cuota', label: 'Cuota', long: 'cuota del rival en el meta' }],
      rows: a.matchups.map((x, i) => Object.assign({ i: i }, x)), key: (x) => x.i, value: (x, k) => x[k],
      energies: (x) => rivalEnergies(x.rival),
      name: (x) => rivalGems(x.rival) + '<span class="arq-name">' + an(x.rival) + '</span>',
      cell: (x, k) => (k === 'cuota' ? cellNum(pct1(x.cuota), mBar(x.cuota, maxShare)) : cellPct(x, { src: 't', lead: k === 'n' ? 'n' : null })),
      detail: (x) => srcBlock('t', esc(a.nombre) + ' contra él', x) + '<dl class="kv"><dt>Cuota del rival en el meta</dt><dd>' + pct(x.cuota) + '</dd></dl>',
      foot: '<p class="legend wrap"><span class="src-key">' + badge('t') + 'torneos</span><span class="src-key">' + badge('m') + 'mis partidas</span>' + (a.matchups.some((x) => x.orientativo) ? '<span>' + ORI + 'orientativo</span>' : '') + '<span>«% vict.» ordena del peor al mejor.</span><span>Punto e intervalo sobre ' + nb('0–100') + '; la marca es 50' + NB + '%.</span><span>Tocá una fila: IC y récord.</span></p>',
    })
  }
  BOARDS.listas = () => {
    const a = D.meta.arquetipo
    const max = Math.max.apply(null, a.listas.map((l) => l.veces).concat(1))
    const parts = (l) => { const at = l.etiqueta.indexOf(' · '); return at < 0 ? [l.etiqueta, ''] : [l.etiqueta.slice(0, at), l.etiqueta.slice(at + 3)] }
    return board({
      id: 'listas', label: 'Las listas más jugadas de ' + a.nombre, mode: 'one', cellWidth: 104, lead: 'Lista',
      cols: [{ k: 'veces', label: 'Veces', long: 'veces que se jugó' }, { k: 'pct', label: '% vict.', badge: 't', long: 'porcentaje de victorias en torneos' }],
      rows: a.listas.map((l, i) => Object.assign({ i: i }, l)), key: (l) => l.i, value: (l, k) => l[k],
      name: (l) => '<span><span class="row-title">' + esc(parts(l)[0]) + '</span>' + (parts(l)[1] ? '<span class="row-sub">' + esc(parts(l)[1]) + '</span>' : '') + (l.tengo ? '<span class="row-sub"><span class="tag' + (/^falta/.test(l.tengo) ? ' warn' : '') + '">' + esc(l.tengo) + (l.faltaCartas && l.faltaCartas.length ? ': ' + esc(l.faltaCartas.join(', ')) : '') + '</span></span>' : '') + '</span>',
      cell: (l, k) => (k === 'veces' ? cellNum(num(l.veces), mBar(l.veces, max), plural(l.veces, 'vez', 'veces')) : cellPct(l, { src: 't' })),
      detail: (l) => srcBlock('t', 'Esta lista, en torneos', l) + '<p class="fine">Jugada ' + l.veces + ' ' + plural(l.veces, 'vez', 'veces') + '.' + (l.faltaCartas && l.faltaCartas.length ? ' Para armarla te falta: ' + esc(l.faltaCartas.join(', ')) + '.' : '') + '</p>',
      foot: '<p class="legend wrap"><span class="src-key">' + badge('t') + 'torneos</span><span>Tocá una fila: IC' + NB + '95' + NB + '% y qué te falta.</span></p>',
    })
  }
  function viewArquetipo() {
    const a = D.meta.arquetipo
    const mine = arqMine()
    const v = arqVerdict(a, mine)
    const deckId = Number((/#(\d+)/.exec(a.tengo || '') || [])[1])
    const big = (x) => '<span data-count="' + x + '" data-unit="">' + nf.format(x) + '</span><small>' + NB + '%</small>'
    return '<div class="arq-id"><h1 class="arq-title">' + an(a.nombre) + '</h1><p class="arq-sub">' + gems(a.energias, 'sm') + '<span>Arquetipo · ' + esc(energyNames(a.energias)) + ' · en ' + num(a.enListas) + ' listas</span>' + ownTag(a) + '</p></div>' +
      scoreboard([
        { k: badge('t') + 'Torneos', ev: 'arq-torneos', v: big(a.pct), f: '<span class="n">' + nShort(a.n) + (a.orientativo ? ORI : '') + '</span>' + mIc(a), aria: 'En torneos: ' + pct(a.pct) + ', ' + nTxt(a.n) + (a.orientativo ? ', orientativo' : '') + '. Abre el intervalo y el récord' },
        { k: 'Cuota', ev: 'arq-cuota', v: big(a.cuota), f: '<span class="n">' + signed(a.tendencia) + NB + 'pts</span>' + spark(a.serie, 36, 16), aria: 'Cuota del meta: ' + pct(a.cuota) + '; ' + signed(a.tendencia) + ' puntos en ' + D.meta.tendenciaDias + ' días. Abre la cuota por ventana' },
        { k: badge('m') + 'Vos', ev: 'arq-vos', v: mine ? big(mine.pct) : '<span class="nd">sin datos</span>', f: mine ? '<span class="n">' + nShort(mine.n) + (mine.orientativo ? ORI : '') + '</span>' + mIc(mine) : '', aria: mine ? 'Vos contra él: ' + pct(mine.pct) + ', ' + nTxt(mine.n) + (mine.orientativo ? ', orientativo' : '') + '. Abre el intervalo y el récord' : 'Vos contra él: sin datos' },
      ], { label: 'Marcador del arquetipo' }) +
      verdictLine({ q: '¿Cómo le va?', a: v.a, why: v.why }) +
      '<div class="row-actions"><button class="btn" data-a="static" data-msg="En la app arranca una partida contra el bot con una lista de este arquetipo. La maqueta no la trae.">Jugar contra el bot</button>' +
      (deckId && D.mazos.some((m) => m.id === deckId) ? '<a class="btn" href="#/mazo/' + deckId + '">Mi mazo #' + deckId + '</a>' : '') + '</div>' +
      sec('Mi nota', '<span class="src-key">' + badge('m') + 'contra este rival</span>') +
      '<section class="card pad note-card">' + noteHtml(a.nota) + '<button class="btn" style="margin-top:12px" data-a="static" data-msg="En la app abre tu nota entera, para leerla o cambiarla. La maqueta trae este comienzo.">Ver la nota entera</button></section>' +
      sec('Matchups', 'una columna a la vez') + BOARDS.mu() +
      sec('Listas más jugadas', a.listas.length + ' listas') + BOARDS.listas() +
      '<p class="demo-note">' + ico('info', 16) + '<span>' + esc(D.meta.atribucion) + '.</span></p>'
  }

  /* Menú */
  function viewMenu() {
    const now = { tema: pref('tema'), movimiento: motion(), vistas: pref('vistas') }
    const NAME = { tema: 'Tema', movimiento: 'Movimiento', vistas: 'Dónde van las vistas' }
    const seg = (key, opts) => '<div class="seg" role="radiogroup" aria-label="' + NAME[key] + '">' + opts.map((o) => '<button role="radio" data-a="pref" data-k="' + key + '" data-v="' + o[0] + '" data-f="pref-' + key + '-' + o[0] + '" aria-checked="' + (now[key] === o[0]) + '"' + (key === 'movimiento' && reduceMotion.matches && o[0] !== 'ninguno' ? ' aria-disabled="true"' : '') + '>' + o[1] + '</button>').join('') + '</div>'
    /* icon, title, second line and — true — whether that line starts with a proper name (the notice goes on after a colon:
       its first letter goes to lower case, except a name's) */
    const links = [['sliders', 'Ajustes de la app', 'Pedir quién empezó, notificaciones, imágenes en la mesa'], ['save', 'Copia de seguridad', 'Descargar, restaurar y la copia en la nube'], ['book', 'Catálogo', 'Cartas y expansiones cargadas'], ['key', 'Tokens de API', 'Claude, workers y actividad', true], ['door', 'Sesión', 'Cerrar sesión en este dispositivo'], ['info', 'Acerca de', 'Versión y licencias']]
    return '<h2 class="label" style="margin-top:6px">Aspecto</h2>' +
      '<section class="card" style="margin-top:8px"><div class="setting"><div class="setting-head"><b>Tema</b><span class="fine">' + (pref('tema') === 'sistema' ? 'sigue al sistema: ahora ' + root.dataset.tema : 'oscuro por defecto') + '</span></div>' + seg('tema', [['oscuro', 'Oscuro'], ['claro', 'Claro'], ['sistema', 'Sistema']]) + '</div>' +
      '<div class="setting"><div class="setting-head"><b>Movimiento</b><span class="fine">' + (reduceMotion.matches ? 'tu sistema pide reducirlo: queda en Ninguno' : 'tres niveles') + '</span></div>' + seg('movimiento', [['expresivo', 'Expresivo'], ['sutil', 'Sutil'], ['ninguno', 'Ninguno']]) +
      '<div class="motion-demo" id="motion-demo"><button class="btn quiet" data-a="motion-demo">Probar</button>' + gem('psychic', 'lg') + '</div></div>' +
      '<div class="setting"><div class="setting-head"><b>Dónde van las vistas</b></div>' + seg('vistas', [['abajo', 'Abajo, con la acción'], ['arriba', 'Arriba, en pestañas']]) +
      '<p class="fine">' + 'Las de la ficha del mazo, Cartas y Pruebas. ' + (now.vistas === 'abajo' ? 'Abajo: en la fila fija, a la izquierda de la acción.' : 'Arriba: pestañas pegadas bajo el encabezado; la fila fija queda solo para la acción, con su texto.') + '</p></div>' +
      '<div class="setting"><div class="setting-row"><div><b style="font:700 17px/1.1 var(--font-display)">Miniaturas de cartas</b><div class="fine">Apagadas: solo texto; en la grilla, el nombre sobre el color del tipo</div></div><button class="switch" role="switch" aria-checked="' + (pref('miniaturas') === 'si') + '" aria-label="Miniaturas de cartas" data-a="pref-thumbs"></button></div></div></section>' +
      '<h2 class="label" style="margin-top:22px">Ajustes y sistema</h2>' +
      '<ul class="card rows" style="margin-top:8px">' + links.map((l) => '<li><button class="row" data-a="static" data-msg="' + esc('En la app abre «' + l[1] + '»: ' + (l[3] ? l[2] : l[2].charAt(0).toLowerCase() + l[2].slice(1)) + '. La maqueta llega hasta acá.') + '"><span class="menu-ico">' + ico(l[0], 20) + '</span><span class="row-main"><span class="row-title">' + l[1] + '</span><span class="row-sub">' + l[2] + '</span></span>' + CHEV + '</button></li>').join('') + '</ul>' +
      '<p class="demo-note">' + ico('info', 16) + '<span>Maqueta D · «Fusión». Datos del ' + shortDate(D.generado) + ', era ' + esc(D.era) + '. ' + esc(D.aviso) + '.</span></p>'
  }
  /* ───────────── Sheets ───────────── */
  /* the head of every sheet: the title (it takes the focus when the sheet opens), an optional second line and an optional piece
     before the close button (the day's record in the match sheet) */
  const sheetHead = (title, extra, sub) => '<div class="sheet-head"><h2 class="sheet-title" id="sheet-title" tabindex="-1">' + title + (sub ? '<small>' + sub + '</small>' : '') + '</h2>' + (extra || '') + '<button class="iconbtn" data-a="sheet-close" aria-label="Cerrar">' + ico('close', 22) + '</button></div>'
  const dayChip = () => '<span class="day-chip"><small>Hoy</small><b>' + recShort(dayRecord()) + '</b></span>'

  /* Registrar partida. M is the form; the saved state shows «ult» (see «The session», above). */
  const M = {}
  const copyCard = (c) => Object.assign({}, c)
  const blankMatch = () => ({ deckId: sesion.length ? sesion[0].deckId : D.partida.mazosRecientes[0].id, other: null, result: null, rival: '', rivalPicked: false, started: null, seen: [], seenUnknown: false, mode: D.partida.modalidades[0], note: '', noteOpen: false, saved: false, rank: null, hint: false, fresh: false, edit: null })
  const isRecent = (id) => D.partida.mazosRecientes.some((d) => d.id === id)
  /* A rival is «chosen» when it is an archetype (one of the suggested ones, or one Meta lists): then the sheet shows the note
     against it. Anything else is text typed by hand, and under it go the suggestions. A match saved in this visit keeps which
     of the two it was (rivalPicked); for the ones of the data and for a rival that comes in the address, the name decides. */
  const knownRival = (name) => Boolean(name) && (D.partida.rivalesSugeridos.indexOf(name) >= 0 || LZ_RIVALS.some((a) => a.nombre === name))
  const pickedOf = (g) => (g.rivalPicked == null ? knownRival(g.rival) : Boolean(g.rivalPicked && g.rival))
  const exampleMatch = () => { const ex = D.partida.ejemplo; return { deckId: ex.mazoId, result: RES_KEY[ex.resultado], rival: ex.rival, rivalPicked: true, started: ex.empezo, seen: D.partida.cartasVistasEjemplo.map(copyCard), mode: ex.modalidad } }
  function matchSet(fields) {
    /* the deck the sheet came with, when it is not one of the recent three: it stays as the fourth option, so choosing
       another one by mistake can be undone without closing the sheet */
    const other = M.other
    Object.keys(M).forEach((k) => { delete M[k] })
    Object.assign(M, blankMatch(), fields)
    if (!isRecent(M.deckId)) M.other = M.deckId
    else if (other != null && !('other' in fields)) M.other = other
  }
  /* which state of the sheet is on screen ('form' | 'saved'): its body goes back to the top only when that changes */
  let matchShown = null
  /* Opens the sheet in the state its address asks for. It never counts a match: the saved state shows either the match saved in
     this visit (coming back through the history is that same match again) or the last one the data already counts.
     Returns false when the address asks to correct a match that is not there: then there is no sheet. */
  function matchInit(p) {
    /* correcting a match that is not there (it was deleted or undone and its address came back through the history, or it never
       existed): there is nothing to correct, so there is no sheet — never an empty «Registrar partida» under the address of
       another one. Nothing is touched: whatever is open stays as it is until the frame closes it. */
    const g = p.editar ? todaysMatches().find((x) => x.ref === p.editar) : null
    if (p.editar && !g) return false
    ui.open.delete('calc')
    matchSet({ other: null })
    const deck = Number(p.mazo)
    if (D.mazos.some((m) => m.id === deck)) { M.deckId = deck; if (!isRecent(deck)) M.other = deck }
    if (own(RES, p.res)) M.result = p.res
    if (p.rival) { M.rival = p.rival; M.rivalPicked = knownRival(p.rival) }
    if (p.estado !== 'guardada') ult = null
    if (g) {
      /* correcting a saved match: the same sheet, filled in */
      const known = g.seen || (g.ref === 'd0' && isExample(g) ? D.partida.cartasVistasEjemplo : null)
      matchSet({ deckId: g.deckId, result: g.result, rival: g.rival || '', rivalPicked: pickedOf(g), started: g.started || null, seen: (known || []).map(copyCard), seenUnknown: !known, mode: g.mode, note: g.note || '', noteOpen: Boolean(g.note), edit: g })
      return true
    }
    if (p.estado === 'lista') matchSet(exampleMatch())
    if (p.estado === 'guardada') {
      if (sesion.length) ult = sesion[0]
      else if (!quitada) ult = Object.assign(exampleMatch(), { note: '', fromData: true })
      else {
        /* the last match of the data was undone and nothing else was saved: there is no saved match to show, only the form */
        ult = null
        matchSet(exampleMatch())
        replaceEntry(history.state, sheetHash('hoja=partida&estado=lista'))
        return true
      }
      matchSet({ deckId: ult.deckId, mode: ult.mode, saved: true })
    }
    return true
  }
  const recentThumb = (id) => { const d = deckInfo(id); return crop(d.miniaturas[0], d.miniaturasDe[0].nombre, d.miniaturasDe[0].tipo) }
  function deckRadios(action) {
    return D.partida.mazosRecientes.map((d) => '<button class="m-deck" role="radio" aria-checked="' + (M.deckId === d.id) + '" style="' + acc(d.energias) + '" data-a="' + action + '" data-deck="' + d.id + '" data-f="deck-' + d.id + '" aria-label="Mazo ' + d.id + ', ' + esc(d.nombre) + '">' + recentThumb(d.id) + '<span class="m-deck-t"><b>#' + d.id + '</b> <small>' + run(deckInfo(d.id).miniaturasDe[0].nombre) + '</small></span></button>').join('')
  }
  function rivalArea() {
    const arche = D.meta.arquetipo
    if (M.rivalPicked && M.rival) {
      if (M.rival === arche.nombre) {
        const line = (arche.nota.split('\n').find((l) => /^- /.test(l)) || '').replace(/^- /, '')
        return '<button class="rival-note tap" style="display:block;width:100%;text-align:left" data-a="static" data-msg="En la app abre tu nota entera contra este rival."><span class="rival-note-text"><b style="color:var(--tx)">Tu nota: </b>' + run(line) + '</span></button>'
      }
      return '<div class="rival-note"><p>Sin nota tuya contra este rival. La podés escribir desde su ficha, en Meta.</p></div>'
    }
    const words = wordsOf(M.rival)
    const list = D.partida.rivalesSugeridos.filter((r) => finds(words, r)).slice(0, 4)
    if (!list.length) return '<div class="rival-note"><p>Ningún rival sugerido con ese texto: se guarda tal cual lo escribiste.</p></div>'
    return '<div class="rival-grid" role="group" aria-label="Rivales sugeridos">' + list.map((r) => '<button class="rival-opt" data-a="match-rival" data-v="' + esc(r) + '" aria-pressed="' + (M.rival === r) + '">' + an(r) + '</button>').join('') + '</div>'
  }
  function matchForm() {
    const sug = D.partida.sugerenciaPorCartas
    const inRecent = isRecent(M.deckId)
    const copies = M.seen.reduce((a, c) => a + c.cant, 0)
    /* the fourth option: the deck the sheet came with (it can be chosen again after trying another one), or the way to the rest */
    const listMsg = 'En la app abre la lista de tus mazos; acá están los tres de la sesión.'
    const fourth = M.other == null
      ? '<button class="m-deck other" role="radio" aria-checked="false" data-a="static" data-f="deck-otro" data-msg="' + listMsg + '">Otro…</button>'
      : '<button class="m-deck other" role="radio" aria-checked="' + !inRecent + '" ' + (inRecent ? 'data-a="match-deck" data-deck="' + M.other + '"' : 'data-a="static" data-msg="' + listMsg + '"') + ' data-f="deck-' + M.other + '" aria-label="Mazo ' + M.other + ', ' + esc(deckName(M.other)) + '">#' + M.other + '</button>'
    const seen = M.seen.length
      ? M.seen.map((c, i) => '<button class="seen-card" data-a="match-seen-del" data-i="' + i + '" data-f="seen-' + i + '" aria-label="Quitar ' + esc(c.nombre) + ', ' + c.cant + ' ' + plural(c.cant, 'copia', 'copias') + '">' + thumb(c.imagen, c.nombre, c.tipo) + '<span class="x">×' + c.cant + '</span><span class="nm">' + run(c.nombre) + '</span></button>').join('')
      : '<span class="seen-empty">' + (M.seenUnknown ? 'La maqueta no trae las de esta partida.' : 'Todavía ninguna.') + '</span>'
    return '<div class="stack">' +
      '<div><div class="fld-label"><span class="label" id="m-deck-l">Mazo</span><span class="val">' + run(deckLabel(M.deckId)) + '</span></div><div class="m-decks" role="radiogroup" aria-labelledby="m-deck-l">' + deckRadios('match-deck') +
      fourth + '</div></div>' +
      '<div class="m-results" role="radiogroup" aria-label="Resultado">' + ['v', 'd', 'e'].map((r) => '<button class="m-result ' + r + '" role="radio" aria-checked="' + (M.result === r) + '" data-a="match-result" data-v="' + r + '" data-f="res-' + r + '">' + shape(r, 14) + RES[r] + '</button>').join('') + '</div>' +
      '<div><div class="fld-label"><label class="label" for="m-rival">Rival</label></div><div class="rival-box"><textarea class="field" id="m-rival" rows="1" placeholder="Arquetipo del rival" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">' + esc(M.rival) + '</textarea>' +
      '<button class="rival-clear" data-a="match-rival-clear" aria-label="Borrar el rival"' + (M.rival ? '' : ' hidden') + '>' + ico('close', 18) + '</button></div><div class="rival-area" id="rival-area">' + rivalArea() + '</div></div>' +
      '<div class="started-row"><span class="label" id="m-st-l">¿Quién empezó?</span><div class="seg" role="radiogroup" aria-labelledby="m-st-l"><button role="radio" aria-checked="' + (M.started === 'yo') + '" data-a="match-start" data-v="yo" data-f="st-yo">Empecé yo</button><button role="radio" aria-checked="' + (M.started === 'rival') + '" data-a="match-start" data-v="rival" data-f="st-rival">Empezó el rival</button></div></div>' +
      '<div><div class="fld-label"><span class="label">Cartas que vi</span>' + (M.seen.length ? '<span class="fine">' + copies + ' ' + plural(copies, 'copia', 'copias') + ' · tocá una para quitarla</span>' : '') + '</div><div class="seen">' + seen +
      /* with two cards listed the button is «+» alone: the two names stay whole and the row stays one line at 360 px */
      '<button class="btn' + (M.seen.length > 1 ? ' solo' : '') + '" data-a="match-seen" data-f="seen-add" aria-label="Agregar una carta que viste">' + ico('plus', M.seen.length > 1 ? 20 : 16) + (M.seen.length > 1 ? '' : 'Carta') + '</button></div>' +
      (M.seen.length ? '<button class="hint-line" style="border:0;background:none;width:100%;text-align:left;min-height:44px" data-a="match-rival" data-v="' + esc(sug.rival) + '">' + ico('check', 16) + '<span>Por esas cartas: <b>' + an(sug.rival) + '</b>, ' + esc(sug.texto) + (M.rival === sug.rival ? '.' : '. Tocá para usarlo.') + '</span></button>' : '') + '</div>' +
      '<div class="second"><select class="field" id="m-mode" aria-label="Modalidad">' + D.partida.modalidades.map((m) => '<option' + (m === M.mode ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + '</select>' +
      '<button class="btn" data-a="match-note" data-f="note" aria-expanded="' + M.noteOpen + '">' + ico('pencil', 16) + (M.noteOpen ? 'Sin nota' : 'Agregar nota') + '</button></div>' +
      (M.noteOpen ? '<textarea class="field" id="m-note" rows="2" style="height:72px;padding:10px 14px" placeholder="Nota de la partida" aria-label="Nota de la partida">' + esc(M.note) + '</textarea>' : '') +
      (M.edit && /^s/.test(M.edit.ref) ? '<button class="btn quiet del" data-a="match-delete" data-f="del">' + ico('undo', 16) + 'Eliminar esta partida</button>' : '') + '</div>'
  }
  /* a rank name («Ultra Ball 4») and «1.094 puntos» stay whole when the option takes two lines */
  const rankTxt = (o) => esc(o).replace(/(\p{L}+) Ball( \d+)?/gu, (m) => m.replace(/ /g, NB)).replace(/(\d) puntos/g, '$1' + NB + 'puntos')
  /* «vos contra lo esperable» (A's bar): your rate with its interval, and the mark of what was to be expected */
  function expectBar(yo, ref) {
    const x = (v) => Math.max(0, Math.min(100, v))
    /* each label sits over (or under) its mark without leaving the bar: its width is estimated from its text */
    const at = (v, text) => { const w = Math.round(text.length * 7.3) + 24; return 'left:clamp(0px, calc(' + x(v) + '% - ' + w / 2 + 'px), calc(100% - ' + w + 'px))' }
    const a = 'vos ' + pct(yo.pct) + ' ' + nShort(yo.n)
    const b = 'esperable ' + pct(ref)
    return '<div class="xbar" role="img" aria-label="' + esc('Vos, en tus partidas: ' + pct(yo.pct) + ', ' + nTxt(yo.n) + ', ' + ciTxt(yo.ci) + '. Lo esperable según torneos: ' + pct(ref) + '.') + '">' +
      '<span class="xbar-l" style="' + at(yo.pct, a) + '">' + badge('m') + 'vos <b>' + pct(yo.pct) + '</b> ' + nShort(yo.n) + '</span>' +
      '<div class="ic"><i class="band" style="left:' + x(yo.ci[0]) + '%;width:' + (x(yo.ci[1]) - x(yo.ci[0])) + '%"></i><i class="ref" style="left:' + x(ref) + '%"></i><i class="pt" style="left:' + x(yo.pct) + '%"></i></div>' +
      '<span class="xbar-l below" style="' + at(ref, b) + '">' + badge('t') + 'esperable <b>' + pct(ref) + '</b></span></div>'
  }
  /* «¿Mala racha?». The data brings the verdict of one match: the example, which is the last one of the day. For any other match
     it says so; and when the matches are no longer the ones of the data, the numbers are marked as the example's. */
  function luckBlock(g) {
    const a = D.partida.respuesta.veredicto
    const ex = D.partida.ejemplo
    const kicker = '<div class="kicker h">¿Mala racha?</div>'
    if (!g || !isExample(g)) return '<section class="holo verdict" aria-label="¿Mala racha?">' + kicker + '<p>El veredicto se calcula en la app con tus partidas y los torneos. La maqueta trae solo el del ejemplo: ' + run(ex.resultado + ' con ' + deckLabel(ex.mazoId) + ' contra ' + ex.rival) + '.</p></section>'
    const title = a.titulo.split(' · ')
    const odds = /1 de cada (\d+) veces/.exec(a.texto)
    const exp = /es (\d+(?:,\d+)?)\s%/.exec(a.texto)
    const ref = exp ? parseFloat(exp[1].replace(',', '.')) : null
    const row = D.mazo.id === g.deckId ? D.mazo.rinde.porRival.find((x) => x.rival === g.rival) : null
    const yo = row ? row.mias : null
    const calcOpen = ui.open.has('calc')
    const stale = !stateIsData()
    return '<section class="holo verdict" aria-label="¿Mala racha?"><div class="verdict-top">' + kicker + (stale ? '<span class="tag">números del ejemplo</span>' : '') + '</div>' +
      '<h3>' + run(title[0]) + '<small>' + run(title.slice(1).join(' · ')) + (odds ? ' · pasa 1 de cada ' + odds[1] + ' veces' : '') + '</small></h3>' +
      (yo && ref != null ? expectBar(yo, ref) : '') +
      '<button class="linkrow calc" data-a="toggle" data-k="calc" data-f="calc" aria-expanded="' + calcOpen + '" aria-controls="calc"><span>Ver el cálculo</span><span class="chev">' + ico('down', 18) + '</span></button>' +
      '<div class="detail" id="calc"' + (calcOpen ? '' : ' hidden') + '><p>' + run(a.texto) + '</p>' + (stale ? '<p>Es el veredicto del ejemplo de los datos: en la app se calcula de nuevo con cada partida.</p>' : '') + '</div></section>'
  }
  function matchAnswer() {
    const a = D.partida.respuesta
    const g = ult
    const r = g.result
    const row = sessionDecks().find((m) => m.id === g.deckId)
    const fresh = M.fresh
    M.fresh = false
    const party = fresh && r === 'v' ? '<span class="celebrate" aria-hidden="true">' + Array.from({ length: 16 }, (_, i) => { const ang = (i / 16) * Math.PI * 2; const dist = 46 + ((i * 37) % 44); return '<i style="--dx:' + Math.round(Math.cos(ang) * dist) + 'px;--dy:' + Math.round(Math.sin(ang) * dist * 0.8 - 14) + 'px;background:' + ['#3fd6c6', '#8b9cff', '#e6a4ff', '#ffd43b'][i % 4] + ';animation-delay:' + (180 + (i % 5) * 28) + 'ms"></i>' }).join('') + '</span><span class="plus-one" aria-hidden="true">+1 V</span>' : ''
    /* always built here, so the deck carries its number */
    const text = RES[r] + ' con ' + deckLabel(g.deckId) + (g.rival ? ' contra ' + g.rival : '') + (g.started ? ' · ' + startedTxt(g.started) : '')
    return '<div class="stack flip' + (fresh ? ' in' : '') + '"><div class="banner">' + party + '<span class="res ' + r + '" aria-hidden="true">' + r.toUpperCase() + '</span><div class="banner-t"><b>Guardada</b></div>' +
      '<button class="btn" data-a="match-undo" data-f="undo">' + ico('undo', 16) + esc(a.deshacer) + '</button><p class="banner-text">' + run(text) + '</p>' +
      (row ? '<div class="banner-streak"><span class="deck-num">#' + g.deckId + '</span><span>hoy ' + recTxt(row.hoy) + '</span>' + (row.racha.length ? streak(row.racha, fresh) : '') + '</div>' : '') + '</div>' +
      luckBlock(g) +
      '<div><div class="fld-label"><span class="label">¿Cambiaste de rango?</span><span class="fine">' + rankTxt(a.rango.actual) + '</span></div><div class="rank-opts" role="group" aria-label="Cambio de rango">' + a.rango.opciones.map((o, i) => '<button data-a="match-rank" data-v="' + i + '" data-f="rank-' + i + '" aria-pressed="' + (M.rank === i) + '">' + rankTxt(o) + '</button>').join('') + '</div>' +
      (a.rango.vigente ? '' : '<p class="fine rank-note">Sin temporada en curso: es el último rango anotado.</p>') + '</div></div>'
  }
  function sheetPartida() {
    let foot
    if (M.saved) {
      foot = '<div class="again"><div class="again-top"><span class="label" id="again-l">Otra con #' + ult.deckId + ' · ' + esc(ult.mode) + '</span><button class="btn quiet done" data-a="sheet-close" data-f="done">Listo</button></div><div class="vde" role="group" aria-labelledby="again-l">' +
        ['v', 'd', 'e'].map((x) => '<button class="vde-btn ' + x + '" data-a="match-again" data-v="' + x + '" data-f="again-' + x + '">' + shape(x) + RES[x] + '</button>').join('') + '</div></div>'
    } else if (M.edit) {
      foot = '<button class="btn primary big" data-a="match-edit-ok" data-f="save">Guardar cambios</button><button class="btn big quiet" style="flex:none" data-a="sheet-close" data-f="cancel">Cancelar</button>'
    } else {
      foot = (M.result ? '' : '<span class="hint" id="m-hint"' + (M.hint ? ' style="color:var(--warn);font-weight:600"' : '') + '>Falta el<br>resultado</span>') + '<button class="btn primary big" data-a="match-save" data-f="save" aria-disabled="' + !M.result + '"' + (M.result ? '' : ' aria-describedby="m-hint"') + '>Guardar partida</button>'
    }
    return sheetHead(M.saved ? 'Partida guardada' : M.edit ? 'Corregir partida' : 'Registrar partida', dayChip(), M.edit && !M.saved ? 'guardada ' + esc(M.edit.when) : '') +
      '<div class="sheet-body" style="overflow-x:hidden">' + (M.saved ? matchAnswer() : matchForm()) + '</div><div class="sheet-foot">' + foot + '</div>'
  }
  /* The rival is written in a field of one line that takes a second one (and a third) when the name does not fit: a long name
     in a narrow window («Mega Charizard Y ex Entei ex» at 277 px, the page zoom of 130 %) used to be cut by the edge of the
     field, with no other place in the sheet where it could be read whole. It is a textarea that never holds a line break
     (Enter does not write one, and one that is pasted becomes a space). Run after the field is drawn, after every change of its
     text and when the window or the font changes. */
  function fitRival() {
    const f = $('#m-rival')
    if (!f) return
    f.style.height = ''
    const border = f.offsetHeight - f.clientHeight
    if (f.scrollHeight > f.clientHeight + 1) f.style.height = (f.scrollHeight + border) + 'px'
  }
  function matchRender(focusKey) {
    const sheet = $('.sheet')
    if (!sheet) return
    const keep = focusKey || (document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.f : null)
    const scroll = $('.sheet-body', sheet) ? $('.sheet-body', sheet).scrollTop : 0
    const state = M.saved ? 'saved' : 'form'
    sheet.innerHTML = sheetPartida()
    /* another state of the sheet (saved, undone, «Otra con…»): a notice said in the one before («Deshecho: la partida no quedó
       guardada.») must not stay on screen over this one («Partida guardada»). What the action itself says comes after this. */
    if (state !== matchShown) clearToast()
    /* back to the top only when the sheet changed of state (saved, undone, «Otra con…»); marking an option keeps the place,
       so what was just tapped stays in sight */
    $('.sheet-body', sheet).scrollTop = state === matchShown ? scroll : 0
    matchShown = state
    const target = keep && $('[data-f="' + keep + '"]', sheet)
    if (target) { target.focus({ preventScroll: true }); if (focusKey) target.classList.add('just') } else $('#sheet-title', sheet).focus({ preventScroll: true })
    rove(sheet)
    countUp(sheet, 'spartida')
    fitRival()
    sheetMore()
  }

  /* Buscador y lanzador (C's, with B's skin): it finds and it runs. The field is at the bottom and keeps the focus; ↑ and ↓
     move the highlight, Enter runs it. The type tabs narrow the list without typing more. */
  const LZ = { q: '', type: 'todo', hi: -1 }
  const LZ_TYPES = [['todo', 'Todo'], ['pantallas', 'Pantallas'], ['acciones', 'Acciones'], ['mazos', 'Mazos'], ['cartas', 'Cartas']]
  const TRACKER_MSG = 'En la app arma el archivo para importar en el tracker, con la colección como está. La maqueta no lo arma.'
  const SYNC_MSG = 'En la app trae la colección del juego y te muestra qué entró. La última: ' + D.cartas.coleccion.ultimaSyncTexto + '.'
  /* one row per card: the editions of a card are one entry (the first one seen gives the image and the code) */
  const CARD_LIST = (() => {
    const by = {}
    const out = []
    ;[D.buscar.cartas, D.cartas.coleccion.muestra, D.mazo.cartas.pokemon, D.mazo.cartas.entrenadores].forEach((list) => list.forEach((c) => {
      if (!by[c.nombre]) { by[c.nombre] = Object.assign({}, c); out.push(by[c.nombre]); return }
      Object.keys(c).forEach((k) => { if (by[c.nombre][k] == null) by[c.nombre][k] = c[k] })
    }))
    /* and the ones the data names without a code, after the rest */
    Object.keys(CARDS).filter((k) => /^n:/.test(k)).forEach((k) => { const c = CARDS[k]; if (by[c.nombre]) { if (c.falta) by[c.nombre].falta = c.falta } else out.push(c) })
    return out
  })()
  /* the decks and the archetypes the launcher searches: the mock-up's own, plus any the app's sample brings that they lack */
  const LZ_DECKS = D.mazos.concat(D.buscar.mazos.filter((m) => !D.mazos.some((x) => x.id === m.id)))
  const LZ_RIVALS = D.meta.arquetipos.concat(D.buscar.arquetipos.filter((a) => !D.meta.arquetipos.some((x) => x.id === a.id)))
  const lzWords = () => wordsOf(LZ.q)
  function launcherFind() {
    const words = lzWords()
    const has = words.length > 0
    const hit = (text) => finds(words, text)
    const main = D.mazo
    const res = D.pruebas.resultado
    const resJob = D.pruebas.trabajos.find((j) => j.id === res.id)
    /* the decks used last: the ones a match was saved with in this visit (newest first), then the recent ones of the data —
       the same order the table of Hoy and a new match sheet follow */
    const recents = sesion.map((g) => g.deckId).concat(D.partida.mazosRecientes.map((d) => d.id)).filter((id, i, all) => all.indexOf(id) === i)
      .map((id) => D.mazos.find((m) => m.id === id) || D.partida.mazosRecientes.find((d) => d.id === id)).filter(Boolean)
    /* Every query is searched in the same lists, so a longer text never finds what a shorter one did not: the decks, the cards
       and the archetypes the mock-up holds (LZ_DECKS, CARD_LIST, LZ_RIVALS: the sample the app's search returned for «mega» is
       part of them). Every count — of a tab, of a group — is a count of what the mock-up lists. The one thing it cannot count
       is how many cards the app would find: the data says it for its example query, and the head of the group then adds it,
       named as what it is («8 · 45 en la app»). */
    /* (only for that very text: «mega-» lists the same as «mega» here, but what the app would count for it the data does not say) */
    const fromApi = has && plain(LZ.q.trim()) === plain(D.buscar.consulta)
    const decks = !has ? D.mazos : LZ_DECKS.filter((m) => hit('#' + m.id + ' ' + m.nombre))
    const cards = !has ? CARD_LIST : CARD_LIST.filter((c) => hit(c.nombre + ' ' + (c.id || '')))
    /* the rival that has its own page in the mock-up goes first: it is the one that can be opened whole */
    const rivals = (!has ? [] : LZ_RIVALS.filter((a) => hit(a.nombre))).slice().sort((a, b) => (b.id === D.meta.arquetipo.id) - (a.id === D.meta.arquetipo.id))
    const allScreens = [
      { i: 'sun', t: 'Hoy', s: 'El marcador, la mesa y el resumen del día', h: '#/hoy', k: 'inicio pendientes partidas' },
      { i: 'stack', t: 'Mazos', s: D.mazos.length + ' armados', h: '#/mazos', k: 'lista decks' },
      { i: 'cards', t: 'Sobres', s: 'Cartas · qué sobre abrir y por qué', h: '#/cartas', k: 'packs promo cupon faltan' },
      { i: 'cards', t: 'Colección', s: 'Cartas · sincronizar y buscar', h: '#/cartas/coleccion', k: 'tracker csv' },
      { i: 'trophy', t: 'Meta', s: 'Qué se juega en torneos', h: '#/meta', k: 'torneos arquetipos eventos' },
      { i: 'flask', t: 'Pruebas', s: 'Las cuatro preguntas y los trabajos', h: '#/pruebas', k: 'simulacion laboratorio' },
      { i: 'play', t: 'Practicar', s: 'Pruebas · jugar contra el bot, situaciones, ejercicios', h: '#/pruebas/practicar', k: 'jugar' },
      { i: 'cpu', t: 'Motor', s: 'Pruebas · workers, cola, calibración', h: '#/pruebas/motor', k: 'worker analisis' },
      { i: 'sliders', t: 'Menú', s: 'Aspecto, ajustes y sistema', h: '#/menu', k: 'tema movimiento vistas copia seguridad catalogo tokens sesion' },
      /* screens inside a screen: only when they are searched for */
      { i: 'stack', t: 'Rinde · mazo #' + main.id, s: main.nombre + ' · tres fuentes y rivales', h: '#/mazo/' + main.id + '/rinde', deep: true },
      { i: 'stack', t: 'Mejorar · mazo #' + main.id, s: main.nombre + ' · qué le cambio', h: '#/mazo/' + main.id + '/mejorar', deep: true },
      { i: 'stack', t: 'Notas · mazo #' + main.id, s: main.nombre + ' · notas y revisiones', h: '#/mazo/' + main.id + '/notas', deep: true },
      { i: 'flask', t: 'Resultado #' + res.id, s: res.titulo + ' · búsqueda de variantes', h: '#/pruebas/resultado/' + res.id, deep: true },
      { i: 'cards', t: 'Los números de ' + D.cartas.sobres.veredicto.nombre, s: 'Sobres · las cuatro cifras y las alternativas', h: '#/cartas?detalle=sobre', deep: true, k: 'puntaje sobre recomendado' },
    ].filter((s) => (has ? hit(s.t + ' ' + s.s + ' ' + (s.k || '')) : !s.deep))
    /* what matches in its own name goes before what matches only in its second line or its keywords */
    const byName = (list) => list.map((x, i) => ({ x: x, i: i, far: hit(x.t) ? 0 : 1 })).sort((a, b) => a.far - b.far || a.i - b.i).map((o) => o.x)
    const act = (icon, t, s, a, attrs, k, freq) => ({ icon: icon, t: t, s: s, a: a, attrs: attrs || '', k: k || '', freq: Boolean(freq) })
    const regWith = (m, freq) => act('plus', 'Registrar partida con #' + m.id, m.nombre, 'match-open', 'data-deck="' + m.id + '"', '', freq)
    let actions = [act('plus', 'Registrar partida', 'Abre la hoja de partida', 'match-open', '', 'cargar anotar victoria derrota empate', true)]
      .concat(recents.map((m, i) => regWith(m, i === 0)))
      .concat([
        act('trophy', 'Probar #' + main.id + ' contra el meta', main.nombre + ' · abre «Nueva prueba»', 'launch', 'data-q="meta" data-deck="' + main.id + '"', 'simulacion', true),
        act('sync', 'Sincronizar la colección', 'Trae las cartas del juego', 'sync-go', '', 'traer juego tracker cartas', true),
        act('flask', 'Nueva prueba', 'Las cuatro preguntas de Pruebas', 'launch', '', 'simulacion laboratorio lanzar', true),
        act('flask', 'Buscar mejoras para #' + main.id, main.nombre + ' · abre «Nueva prueba»', 'launch', 'data-q="cambio" data-deck="' + main.id + '"', 'laboratorio variantes'),
        act('save', 'Tracker al día', 'Colección · arma el archivo para el tracker', 'static', 'data-msg="' + esc(TRACKER_MSG) + '"', 'exportar coleccion archivo'),
        act('sliders', 'Cambiar tema, movimiento o vistas', 'Menú · Aspecto', 'go', 'data-href="#/menu"', 'oscuro claro aspecto'),
      ])
    /* searching: the actions that match, and the first decks found get their own «Registrar partida con…» */
    const screens = has ? byName(allScreens) : allScreens
    if (has) actions = byName(actions.filter((x) => hit(x.t + ' ' + x.s + ' ' + x.k))).concat(decks.filter((m) => !recents.some((d) => d.id === m.id)).slice(0, 2).map((m) => regWith(m)))
    const last = recents.map((m) => ({ deck: m })).concat(resJob ? [{ i: 'flask', t: 'Resultado #' + res.id, s: res.titulo + ' · terminó ' + resJob.cuando, h: '#/pruebas/resultado/' + res.id }] : [])
    /* cardsApp: how many cards the APP finds for this text, when the data says it and it is more than the mock-up lists */
    return { has: has, raw: LZ.q.trim(), screens: screens, actions: actions, decks: decks, cards: cards, cardsApp: fromApi && D.buscar.cartasTotal > cards.length ? D.buscar.cartasTotal : null, rivals: rivals, last: last }
  }
  /* the text of a result with what was typed underlined (the first word); never used for attributes */
  function lzMark(text) {
    const w = lzWords()[0]
    if (!w) return run(text)
    const at = flat(text).indexOf(w)
    return (at < 0 ? esc(text) : esc(text.slice(0, at)) + '<mark>' + esc(text.slice(at, at + w.length)) + '</mark>' + esc(text.slice(at + w.length))).replace(/-(?=\p{L})/gu, '-⁠')
  }
  /* every result is an option of the list: a real link or button (it can be tapped), out of the Tab order (the arrows reach it) */
  let lzCount = 0
  const lzOpt = (tag, attrs, inner) => '<' + tag + ' class="s-row" role="option" id="lz-' + (lzCount++) + '" tabindex="-1" aria-selected="false" ' + attrs + '>' + inner + '</' + tag + '>'
  /* the energies of a deck or of an archetype in the launcher: all of them, as everywhere else (#84 is Planta AND Psíquico: with
     only the first one it read as one more Planta deck). One token is the big one; two are two tokens side by side, a little
     over each other, in the same 36 px — so every title of the list starts at the same place. Each token says its name. */
  const lzGems = (list) => (list.length > 1 ? '<span class="gems lz-gems">' + list.map((e) => gem(e)).join('') + '</span>' : gem(list[0], 'lg'))
  const LZ_ROW = {
    screen: (s) => lzOpt('a', 'href="' + s.h + '" data-a="go" data-href="' + s.h + '"', '<span class="s-ico">' + ico(s.i, 20) + '</span><span class="s-main"><span class="s-title">' + lzMark(s.t) + '</span><span class="s-sub">' + lzMark(s.s) + '</span></span>' + CHEV),
    action: (a) => lzOpt('button', 'data-a="' + a.a + '" ' + a.attrs, '<span class="s-ico run">' + ico(a.icon, 20) + '</span><span class="s-main"><span class="s-title">' + lzMark(a.t) + '</span><span class="s-sub">' + lzMark(a.s) + '</span></span><span class="s-go">' + ico('play', 16) + '</span>'),
    deck: (m) => {
      const s = miasOf(m.id, m.mias)
      return lzOpt('a', 'href="#/mazo/' + m.id + '" data-a="go" data-href="#/mazo/' + m.id + '"', lzGems(m.energias) + '<span class="s-main"><span class="s-title"><span class="deck-num">#' + m.id + '</span> ' + lzMark(m.nombre) + '</span>' +
        '<span class="s-sub">' + (s ? badge('m') + '<span class="sr">mis partidas: </span> ' + pct(s.pct) + ' · ' + nShort(s.n) + (s.orientativo ? ORI : '') : 'sin partidas') + (m.completo === false ? ' · ' + plural(m.falta, 'falta', 'faltan') + ' ' + m.falta : '') + '</span></span>' + CHEV)
    },
    card: (c) => lzOpt('button', 'data-a="card" data-c="' + esc(cardKey(c)) + '"', thumb(c.imagen, c.nombre, c.tipo) + '<span class="s-main"><span class="s-title">' + lzMark(c.nombre) + '</span><span class="s-sub">' +
      (c.copias != null ? (c.copias ? c.copias + ' ' + plural(c.copias, 'copia jugable', 'copias jugables') : 'no la tenés') + ' · ' + c.ediciones + ' ' + plural(c.ediciones, 'edición', 'ediciones')
        : c.id ? esc(c.clase || 'Carta') + ' · ' + esc(c.id)
          : c.falta ? 'te ' + plural(c.falta.falta, 'falta', 'faltan') + ' ' + c.falta.falta + ' para ' + tight(c.falta.mazos.join(' y ')) + SEP + tight(c.falta.sobre)
            : 'Carta' + (c.tipo ? ' · ' + esc(D.energias[c.tipo].nombre) : '')) + '</span></span>' + (c.tipo ? gem(c.tipo) : '')),
    rival: (a) => {
      const full = D.meta.arquetipos.find((x) => x.id === a.id)
      const own = a.id === D.meta.arquetipo.id
      const href = own ? '#/meta/arquetipo' : '#/meta'
      /* the archetype of the data has its page; any other one among the most played opens Meta with its row unfolded */
      return lzOpt('a', 'href="' + href + '" ' + (!own && full ? 'data-a="rival-go" data-id="' + esc(a.id) + '"' : 'data-a="go" data-href="' + href + '"'), (full ? lzGems(full.energias) : '<span class="s-ico">' + ico('trophy', 20) + '</span>') + '<span class="s-main"><span class="s-title">' + lzMark(a.nombre) + '</span>' +
        '<span class="s-sub">' + (full ? pct(full.cuota) + ' del meta' : 'Arquetipo de torneo') + (own ? ' · abre su ficha' : full ? ' · abre su fila en Meta' : ' · abre Meta') + '</span></span>' + CHEV)
    },
  }
  function launcherResults() {
    const f = launcherFind()
    const t = LZ.type
    lzCount = 0
    /* more: what goes after the count of a group (how many the app finds, when the data says it) */
    const group = (title, rows, fn, cap, more, noCount) => {
      if (!rows.length) return ''
      const shown = t === 'todo' ? rows.slice(0, cap) : rows
      const all = rows.length
      const gid = 'lzg-' + safeId(title)
      return '<div class="search-group" role="group" aria-labelledby="' + gid + '"><div class="sg-head"><h3 id="' + gid + '">' + title + '</h3>' + (noCount ? '' : '<span>' + (shown.length < all ? shown.length + ' de ' + all : all) + (more || '') + '</span>') + '</div>' + shown.map(fn).join('') + '</div>'
    }
    let html
    if (!f.has && t === 'todo') {
      /* nothing typed: it is a launcher — what is done most, and the last things */
      html = group('Acciones frecuentes', f.actions.filter((a) => a.freq), LZ_ROW.action, 9, '', true) + group('Lo último', f.last, (x) => (x.deck ? LZ_ROW.deck(x.deck) : LZ_ROW.screen(x)), 9, '', true)
    } else {
      const g = {
        pantallas: () => group('Pantallas', f.screens, LZ_ROW.screen, 2),
        acciones: () => group('Acciones', f.actions, LZ_ROW.action, 2),
        mazos: () => group('Mazos', f.decks, LZ_ROW.deck, 2),
        cartas: () => group('Cartas · una fila por carta', f.cards, LZ_ROW.card, 3, f.cardsApp ? ' · ' + f.cardsApp + NB + 'en la app' : ''),
        rivales: () => group('Rivales', f.rivals, LZ_ROW.rival, f.rivals.length),
      }
      html = t === 'todo' ? g.pantallas() + g.acciones() + g.mazos() + g.cartas() + g.rivales() : g[t]()
    }
    const where = (LZ_TYPES.find((x) => x[0] === t) || LZ_TYPES[0])[1]
    return html || '<p class="empty">' + (f.has ? 'Nada con «' + esc(f.raw) + '»' + (t === 'todo' ? ' en la maqueta.' : ' en ' + where + '.') : 'Nada para mostrar.') + '</p>'
  }
  function launcherTypes() {
    const f = launcherFind()
    /* every type says how many it holds, searching or not: it is always what the tab lists */
    const n = { pantallas: f.screens.length, acciones: f.actions.length, mazos: f.decks.length, cartas: f.cards.length }
    return LZ_TYPES.map((x) => '<button data-a="lz-type" data-v="' + x[0] + '" data-f="lz-' + x[0] + '" aria-pressed="' + (LZ.type === x[0]) + '">' + x[1] + (x[0] !== 'todo' ? '<span>' + n[x[0]] + '</span>' : '') + '</button>').join('')
  }
  /* moves the highlight to result i (clamped) and tells the field which one it is */
  function launcherHi(i) {
    const opts = $$('#search-results [role="option"]')
    const input = $('#search-q')
    LZ.hi = opts.length ? Math.max(0, Math.min(opts.length - 1, i)) : -1
    opts.forEach((o, k) => { const on = k === LZ.hi; o.classList.toggle('hi', on); o.setAttribute('aria-selected', on) })
    if (input) { if (LZ.hi >= 0) input.setAttribute('aria-activedescendant', opts[LZ.hi].id); else input.removeAttribute('aria-activedescendant') }
    return LZ.hi >= 0 ? opts[LZ.hi] : null
  }
  function launcherPaint() {
    $('#search-results').innerHTML = launcherResults()
    $('#lz-types').innerHTML = launcherTypes()
    $('#search-body').scrollTop = 0
    launcherHi(0)
    sheetMore()
  }
  function sheetBuscar(params) {
    /* the address of the contract (no «q») opens with its example query; the magnifier and «/» open it empty */
    LZ.q = params.q != null ? params.q : D.buscar.consulta
    LZ.type = 'todo'
    return '<div class="sheet-head"><h2 class="sheet-title" id="sheet-title" tabindex="-1">Buscar y lanzar</h2></div>' +
      '<div class="search-body" id="search-body"><div class="search-list" id="search-results" role="listbox" aria-label="Resultados">' + launcherResults() + '</div></div>' +
      '<div class="lz-types" id="lz-types" role="group" aria-label="Acotar por tipo">' + launcherTypes() + '</div>' +
      '<div class="search-foot"><div class="search-input">' + ico('search', 20) + '<input class="field" id="search-q" type="text" inputmode="search" role="combobox" aria-expanded="true" aria-controls="search-results" aria-haspopup="listbox" aria-autocomplete="list" placeholder="Buscar o lanzar…" value="' + esc(LZ.q) + '" aria-label="Buscar pantallas, acciones, mazos, cartas y rivales" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"></div>' +
      '<button class="iconbtn lz-close" data-a="sheet-close" aria-label="Cerrar el buscador">' + ico('close', 22) + '</button></div>'
  }
  /* Los números del sobre */
  function sheetSobre() {
    const s = D.cartas.sobres
    const v = s.veredicto
    const all = [{ nombre: v.nombre, expansionId: v.expansionId, numeros: v.numeros, best: true }].concat(s.alternativas)
    const tile = (label, value, cap, count) => '<div class="num-tile"><span class="label">' + label + '</span><b' + (count != null ? ' data-count="' + count + '"' : '') + '>' + value + '</b><span>' + cap + '</span></div>'
    return sheetHead('Los números de ' + esc(v.nombre)) + '<div class="sheet-body"><div class="stack">' +
      '<div class="num-grid">' + tile('Al menos una', pct(v.numeros.alMenosUna), 'de sacar una carta buscada en un sobre', v.numeros.alMenosUna) + tile('Buscadas', nf2.format(v.numeros.buscadas), 'cartas buscadas por sobre, en promedio') +
      tile('Puntaje', nf2.format(v.numeros.puntaje), 'el número que ordena los sobres') + tile('Sobres', v.numeros.sobres50 + ' y ' + v.numeros.sobres90, 'para llegar a 50' + NB + '% y a 90' + NB + '% de al menos una') + '</div>' +
      '<div><div class="fld-label"><span class="label">Contra las alternativas</span><span class="fine">al menos una buscada</span></div>' +
      all.map((a) => '<div class="cmp"><span class="cmp-name">' + esc(a.nombre) + NB + '<span class="deck-num">· ' + esc(a.expansionId) + '</span><small>puntaje ' + nf2.format(a.numeros.puntaje) + ' · ' + nf2.format(a.numeros.buscadas) + ' buscadas</small></span><span class="hbar' + (a.best ? ' hot' : '') + '"><i style="width:' + a.numeros.alMenosUna + '%"></i></span><b>' + pct1(a.numeros.alMenosUna) + '</b></div>').join('') + '</div>' +
      '<p class="fine">Buscás: ' + esc(s.objetivos).replace(/ · /g, SEP) + '.</p></div></div>' +
      '<div class="sheet-foot"><button class="btn big quiet" data-a="sheet-close">Listo</button></div>'
  }
  function sheetCarta(params) {
    const c = own(CARDS, params.c)
    if (!c) return sheetHead('Carta') + '<div class="sheet-body"><p class="note">Esa carta no está en los datos de la maqueta.</p></div>'
    const inDeck = [].concat(D.mazo.cartas.pokemon, D.mazo.cartas.entrenadores).find((x) => x.id === c.id)
    const rows = c.id ? [['Código', '<span class="code">' + esc(c.id) + '</span>']] : []
    if (c.clase) rows.push(['Clase', esc(c.clase)])
    if (c.tipo) rows.push(['Tipo', '<span class="nb">' + gem(c.tipo, 'sm') + ' ' + esc(D.energias[c.tipo].nombre) + '</span>'])
    /* a value that is one thing is written whole («×1 para» and «#5 y #85» are two): the one that does not fit beside its label
       goes under it (.kv-pair), it is never split with its separator at the start of a line */
    if (c.falta) {
      rows.push(['Te ' + plural(c.falta.falta, 'falta', 'faltan'), tight('×' + c.falta.falta + ' para') + ' ' + tight(c.falta.mazos.join(' y '))], ['Sale de', tight(c.falta.sobre)], ['Conviene', tight(c.falta.consejo === 'comprar' ? 'comprar · ' + num(c.falta.puntos) + ' pts' : c.falta.consejo + ' sobres')])
      /* what it costs in points is a datum of the card, not of the advice: when the advice is to open packs, the sheet says
         it too (Sobres writes «abrir sobres · comprarla: 500 pts») */
      if (c.falta.consejo !== 'comprar' && c.falta.puntos != null) rows.push(['Comprarla', tight(num(c.falta.puntos) + ' pts')])
    }
    if (c.puntos) rows.push(['Si la debilitan', tight('da ' + c.puntos + (c.puntos === 1 ? ' punto' : ' puntos'))])
    if (c.copias != null) rows.push(['Copias jugables', c.copias ? String(c.copias) : tight('no la tenés')], ['Ediciones', String(c.ediciones)])
    if (inDeck) rows.push(['En ' + deckLabel(D.mazo.id).split(' ')[0], '×' + inDeck.cant])
    /* the editions of this card that the data of the mock-up brings (same name), this one first */
    const inList = (x) => [].concat(D.mazo.cartas.pokemon, D.mazo.cartas.entrenadores).find((y) => y.id === x.id)
    const same = Object.keys(CARDS).map((k) => CARDS[k]).filter((x) => x.nombre === c.nombre).sort((a, b) => (b.id === c.id) - (a.id === c.id))
    const editions = same.length < 2 ? '' : '<div class="eds"><div class="fld-label"><span class="label">Ediciones</span><span class="fine">' + same.length + ' en los datos de la maqueta</span></div><ul class="ev-list">' +
      same.map((x) => '<li class="ed">' + thumb(x.imagen, x.nombre, x.tipo) + '<span><span class="row-title"><span class="code">' + esc(x.id) + '</span>' + (x.id === c.id ? ' · esta' : '') + '</span><span class="row-sub">' + (x.clase ? esc(x.clase) : 'Carta') + '</span></span>' +
        '<span class="ed-end">' + (inList(x) ? '×' + inList(x).cant + ' en ' + deckLabel(D.mazo.id).split(' ')[0] : 'no está en ' + deckLabel(D.mazo.id).split(' ')[0]) + '</span></li>').join('') + '</ul></div>'
    return sheetHead(esc(c.nombre)) + '<div class="sheet-body"><div class="card-view">' + thumb(c.imagen, c.nombre, c.tipo) + '<dl class="kv pairs">' + rows.map((r) => '<div class="kv-pair"><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>').join('') + '</dl></div>' + editions +
      '<p class="fine" style="margin-top:14px">En la app, esta hoja es la ficha única de la carta, con sus ediciones adentro: cuántas tenés, de qué sobre sale, puntos e intercambio.</p></div>' +
      '<div class="sheet-foot"><button class="btn big quiet" data-a="sheet-close">Listo</button></div>'
  }
  /* Nueva prueba: the four questions. One comes chosen when the sheet is opened from a question, from a deck or from the launcher. */
  function sheetLanzar(params) {
    const qs = D.pruebas.preguntas
    const q = qs.find((p) => p.id === params.q) || null
    const deck = Number(params.mazo)
    const jobs = q ? D.pruebas.trabajos.filter((j) => j.pregunta === q.id) : []
    return sheetHead('Nueva prueba') + '<div class="sheet-body"><div class="stack">' +
      '<div><div class="fld-label"><span class="label" id="ln-l">¿Qué querés saber?</span></div><div class="ln-qs" role="radiogroup" aria-labelledby="ln-l">' +
      qs.map((p) => '<button class="ln-q" role="radio" aria-checked="' + (q === p) + '" data-a="launch-q" data-v="' + p.id + '" data-f="ln-' + p.id + '">' + ico(Q_ICON[p.id], 18) + '<span>' + esc(p.titulo) + '</span></button>').join('') + '</div></div>' +
      '<p class="note">' + (q ? esc(q.bajada) : 'Elegí una de las cuatro preguntas.') + '</p>' +
      '<div class="banner" style="grid-template-columns:auto minmax(0,1fr)"><span class="s-ico">' + ico('stack', 20) + '</span><div class="banner-t"><span class="label" style="display:block;margin-bottom:2px">Con el mazo</span>' + (D.mazos.some((m) => m.id === deck) ? run(deckLabel(deck)) : 'Lo elegís al lanzar, o pegás una lista') + '</div></div>' +
      (params.rival ? '<div class="banner" style="grid-template-columns:auto minmax(0,1fr)"><span class="s-ico">' + ico('trophy', 20) + '</span><div class="banner-t"><span class="label" style="display:block;margin-bottom:2px">Contra</span>' + esc(params.rival) + '</div></div>' : '') +
      (jobs.length ? '<div><div class="fld-label"><span class="label">Lo último que dio</span><span class="fine"><span class="src-key">' + badge('b') + 'bots</span> · ' + jobs.length + plural(jobs.length, ' trabajo', ' trabajos') + '</span></div><ul class="card rows" style="background:var(--s2);box-shadow:none">' + jobs.map(jobRow).join('') + '</ul></div>' : '') + '</div></div>' +
      '<div class="sheet-foot"><button class="btn primary big" data-a="launch-go" data-f="launch-go" aria-disabled="' + !q + '">Lanzar la prueba</button></div>'
  }
  const ACTIONS = {
    mazo: ['Acciones del mazo', [['pencil', 'Editar'], ['stack', 'Duplicar'], ['save', 'Exportar…'], ['check', 'Marcar «en el juego»'], ['book', 'Archivar'], ['close', 'Eliminar']]],
    coleccion: ['Más acciones', [['save', 'Importar CSV', 'En la app importa la colección desde un CSV del tracker. La maqueta no lo hace.'], ['save', 'Exportar CSV', 'En la app descarga la colección como CSV. La maqueta no lo hace.'], ['pencil', 'Ajustes manuales', 'En la app corregís a mano las copias de una carta. La maqueta no lo hace.']]],
  }
  function sheetAcciones(params) {
    if (params.de === 'objetivos') {
      const parts = D.cartas.sobres.objetivos.split(' · ')
      return sheetHead('Qué buscás en los sobres') + '<div class="sheet-body">' + parts.map((p, i) => '<div class="setting-row" style="min-height:56px' + (i ? ';border-top:1px solid var(--line)' : '') + '"><b style="font:600 17px/1.2 var(--font-display)">' + esc(p) + '</b><button class="switch" role="switch" aria-checked="true" aria-label="' + esc(p) + '" data-a="static" data-msg="En la maqueta los objetivos no se cambian."></button></div>').join('') +
        '<p class="fine" style="margin-top:10px">Casi nunca los cambiás: por eso en Sobres ocupan una línea.</p></div><div class="sheet-foot"><button class="btn big quiet" data-a="sheet-close">Listo</button></div>'
    }
    /* Each list of actions belongs to its screen: the deck's to a deck page, «Más acciones» to Colección. No «de» (an address
       written by hand): the one of the screen that is open, if it has one. A «de» that is not one of the sheets, or the
       actions of a deck asked for on a screen that is no deck («Acciones del mazo» over Colección or Hoy): no sheet. */
    const page = current ? current.route : null
    const onDeck = Boolean(page && page.deckId != null)
    const de = params.de != null ? params.de : onDeck ? 'mazo' : page && page.viewKey === 'coleccion' ? 'coleccion' : null
    const def = de === 'mazo' && !onDeck ? null : own(ACTIONS, de)
    if (!def) return null
    const rows = def[1].map((a) => '<button class="act" data-a="static"' + (a[2] ? ' data-msg="' + esc(a[2]) + '"' : '') + '>' + '<span class="menu-ico">' + ico(a[0], 20) + '</span>' + a[1] + '</button>').join('')
    const at = def === ACTIONS.mazo && current ? D.mazos.findIndex((m) => m.id === current.route.deckId) : -1
    if (at < 0) return sheetHead(def[0]) + '<div class="sheet-body">' + rows + '</div>'
    /* on a deck page the header is the deck, so this sheet also carries what the app's header has elsewhere: the way to the
       decks next to this one and to the menu */
    const near = (step, word) => {
      const m = D.mazos[(at + step + D.mazos.length) % D.mazos.length]
      return '<a class="deck-near" href="#/mazo/' + m.id + '" style="' + acc(m.energias) + '"><span class="label">' + word + '</span><span class="deck-name"><span class="deck-num">#' + m.id + '</span> ' + dn(m.nombre) + '</span></a>'
    }
    return sheetHead('Mazo #' + D.mazos[at].id, '', (at + 1) + ' de ' + D.mazos.length + ' · ' + run(D.mazos[at].nombre)) +
      '<div class="sheet-body"><nav class="deck-nears" aria-label="Otro mazo">' + near(-1, 'Anterior') + near(1, 'Siguiente') + '</nav>' + rows +
      '<a class="act" href="#/menu"><span class="menu-ico">' + ico('sliders', 20) + '</span>Menú de la app: aspecto y ajustes</a></div>'
  }

  /* Evidence: what is behind a cell of a scoreboard, in a sheet («?hoja=ev&de=<key>»). A screen adds its own:
     EVIDENCE.<key> = (params) => ({ title, sub, body: html, foot: html of an action before «Listo» }) — or null when there is nothing to show. */
  const EVIDENCE = {}
  function sheetEv(params) {
    const fn = own(EVIDENCE, params.de)
    const ev = fn ? fn(params) : null
    if (!ev) return null
    return sheetHead(ev.title, '', ev.sub) + '<div class="sheet-body"><div class="stack">' + ev.body + '</div></div>' +
      '<div class="sheet-foot">' + (ev.foot || '') + '<button class="btn big quiet" data-a="sheet-close" data-f="ev-done"' + (ev.foot ? ' style="flex:none"' : '') + '>Listo</button></div>'
  }
  /* one match, as a row of an evidence sheet */
  const evGame = (g) => '<li class="ev-game"><span class="res ' + g.result + '" role="img" aria-label="' + RES[g.result] + '">' + g.result.toUpperCase() + '</span><span><span class="row-title"><span class="deck-num">#' + g.deckId + '</span> ' + dn(deckName(g.deckId)) + '</span>' +
    '<span class="game-sub">' + (g.rival ? 'contra ' + run(g.rival) : 'sin rival anotado') + SEP + nb(esc(g.when)) + '</span></span></li>'
  EVIDENCE.hoy = () => {
    const rec = dayRecord()
    const n = rec.v + rec.d + rec.e
    const games = todaysMatches()
    return {
      title: 'Hoy ' + recShort(rec),
      sub: esc(D.hoy.fechaTexto),
      body: (n ? '<div class="ev-block">' + distBar(rec) + '<p class="ev-cap"><b>' + recTxt(rec) + '</b> · ' + n + ' ' + plural(n, 'partida', 'partidas') + '</p></div>' : '<p class="note">Todavía no hay partidas de hoy.</p>') +
        '<div><div class="fld-label"><span class="label">Por mazo</span><span class="fine">hoy, y sus últimas partidas</span></div><ul class="ev-list">' + sessionDecks().map((m) => '<li class="ev-deck" style="' + acc(m.energias) + '"><span class="deck-name"><span class="deck-num">#' + m.id + '</span> ' + dn(m.nombre) + '</span><span class="ev-right"><span>' + recTxt(m.hoy) + '</span>' + (m.racha.length ? streak(m.racha) : '') + '</span></li>').join('') + '</ul></div>' +
        (games.length ? '<div><div class="fld-label"><span class="label">Las últimas</span><span class="fine">' + (games.length < n ? games.length + ' de ' + n + ': las que trae la maqueta' : '') + '</span></div><ul class="ev-list">' + games.map(evGame).join('') + '</ul></div>' : ''),
      foot: '<button class="btn primary big" data-a="match-open" data-f="ev-reg">' + ico('plus', 18) + 'Registrar partida</button>',
    }
  }
  EVIDENCE.racha = () => {
    ui.open.delete('calc')
    const st = streakNow()
    const games = todaysMatches()
    const shown = games.slice(0, 8)
    const word = st ? (st.r === 'v' ? plural(st.n, 'victoria', 'victorias seguidas') : st.r === 'd' ? plural(st.n, 'derrota', 'derrotas seguidas') : plural(st.n, 'empate', 'empates seguidos')) : ''
    return {
      title: st ? 'Racha: ' + st.n + ' ' + word : 'Racha',
      sub: 'contando hacia atrás desde la última partida',
      body: (shown.length ? '<div class="ev-block"><div class="ev-dots">' + streak(shown.map((g) => g.result.toUpperCase()).reverse()) + '</div><p class="ev-cap">' + plural(shown.length, 'La última partida de hoy', 'Las últimas ' + shown.length + ' de hoy, la más nueva a la derecha') + '. La maqueta no trae las anteriores.</p></div>' : '<p class="note">Todavía no hay partidas de hoy.</p>') +
        (games.length ? luckBlock(games[0]) : ''),
    }
  }
  EVIDENCE.semana = () => {
    const w = weekNow()
    const prev = D.hoy.semana.anterior
    const before = prev && prev.n ? { pct: Math.round((prev.v / prev.n) * 1000) / 10, n: prev.n, ci: wilson(prev.v, prev.n), record: { v: prev.v, d: prev.d, e: prev.e }, orientativo: prev.n < 30 } : null
    return {
      title: 'Semana ' + esc(D.hoy.semana.etiqueta),
      sub: 'tus partidas, con todos los mazos',
      body: srcBlock('m', 'Esta semana', w ? Object.assign({}, w, { record: w.record || { v: w.v, d: w.d, e: w.e } }) : null) + srcBlock('m', 'La semana anterior', before) + '<p class="fine">Punto e intervalo de 95' + NB + '% sobre ' + nb('0–100') + '; la marca es 50' + NB + '%.</p>',
    }
  }
  EVIDENCE.rango = () => {
    const h = D.hoy
    return {
      title: 'Rango',
      sub: h.temporadaVigente ? 'temporada en curso' : 'sin temporada en curso',
      body: '<dl class="kv"><dt class="wide">Último anotado</dt><dd class="wide">' + rankTxt(h.rango) + '</dd><dt class="wide">Temporada</dt><dd class="wide">' + esc(h.temporada) + '</dd><dt class="wide">Próxima</dt><dd class="wide">' + esc(h.proximaTemporada) + '</dd></dl>' +
        '<p class="note">' + esc(D.partida.respuesta.rango.nota) + '</p>',
    }
  }
  /* Cartas: what has a deadline, with the whole advice of the data (the chips of Sobres open these) */
  EVIDENCE.promo = () => {
    const pr = D.cartas.sobres.promo
    if (!pr) return null
    const parts = headAndRest(pr.texto)
    const pend = D.hoy.pendientes.find((p) => p.tipo === 'promo')
    /* of the line of Pendientes, only what the advice above does not say already (its hour): «faltan 15 copias» was read twice,
       one line under the other */
    const more = pend ? pend.detalle.replace(/\.$/, '').split('; ').filter((part) => pr.texto.indexOf(part.split(' en ')[0]) < 0).join('; ') : ''
    return {
      title: 'Sobres de promoción', sub: esc(leftTxt(pr.quedan)) + ' · hasta el ' + shortDate(pr.vence),
      body: '<div class="ev-block">' + (parts[0] ? '<p class="ev-cap"><b>' + esc(parts[0]) + '</b></p>' : '') + '<p class="ev-text">' + run(parts[1]) + '</p></div>' + (more ? '<p class="note">' + esc(more) + '.</p>' : ''),
    }
  }
  EVIDENCE.cupon = () => {
    const c = D.cartas.sobres.cupon
    if (!c) return null
    const parts = headAndRest(c.texto)
    return { title: 'Cupón ★★', sub: 'vence el ' + shortDate(c.vence), body: '<div class="ev-block">' + (parts[0] ? '<p class="ev-cap"><b>' + esc(parts[0]) + '</b></p>' : '') + '<p class="ev-text">' + run(parts[1]) + '</p></div>' }
  }
  /* Meta: the era behind the three cells of its scoreboard — the tournaments and the lists, window by window */
  const winTxt = (w) => shortDate(w.desde) + ' al ' + shortDate(w.hasta)
  function eraSheet() {
    const m = D.meta
    const max = Math.max.apply(null, m.ventanasSerie.map((w) => w.listas).concat(1))
    return {
      title: esc(m.eraNombre) + ' (' + esc(m.era) + ')', sub: esc(m.formato) + ' · los torneos de la era',
      body: '<dl class="kv"><dt>Torneos</dt><dd>' + num(m.torneos) + '</dd><dt>Listas</dt><dd>' + num(m.listas) + '</dd><dt>' + badge('t') + ' Media de victorias</dt><dd>' + pct(m.media.pct) + ' · ' + nTxt(m.media.n) + '</dd></dl>' +
        '<div><div class="fld-label"><span class="label">Listas por ventana de ' + winDays() + NB + 'días</span></div><ul class="ev-list">' +
        m.ventanasSerie.map((w) => '<li class="ev-win"><span class="ev-win-t">' + winTxt(w) + '<small>' + w.torneos + ' ' + plural(w.torneos, 'torneo', 'torneos') + '</small></span>' + mBar(w.listas, max) + '<b>' + num(w.listas) + '</b></li>').join('') + '</ul></div>' +
        '<p class="fine">' + esc(m.atribucion) + '.</p>',
    }
  }
  EVIDENCE.torneos = EVIDENCE.listas = EVIDENCE.media = eraSheet
  /* An archetype: what is behind each cell of its scoreboard */
  EVIDENCE['arq-torneos'] = () => {
    const a = D.meta.arquetipo
    return {
      title: 'En torneos', sub: an(a.nombre),
      body: srcBlock('t', 'Contra todo el meta', a) + '<dl class="kv"><dt>En listas</dt><dd>' + num(a.enListas) + '</dd><dt>Media de la era</dt><dd>' + pct(D.meta.media.pct) + ' · ' + nTxt(D.meta.media.n) + '</dd></dl>' +
        '<p class="fine">Punto e intervalo de 95' + NB + '% sobre ' + nb('0–100') + '; la marca es 50' + NB + '%. ' + esc(D.meta.atribucion) + '.</p>',
    }
  }
  EVIDENCE['arq-cuota'] = () => {
    const a = D.meta.arquetipo
    const clear = arqTrend()
    const max = Math.max.apply(null, a.serie.concat(0.1))
    return {
      title: 'Cuota: ' + pct(a.cuota), sub: 'de las listas de la era · en ' + num(a.enListas) + ' listas',
      body: '<div><div class="fld-label"><span class="label">Cuota por ventana de ' + winDays() + NB + 'días</span></div><ul class="ev-list">' +
        D.meta.ventanasSerie.map((w, i) => (a.serie[i] == null ? '' : '<li class="ev-win"><span class="ev-win-t">' + winTxt(w) + '<small>' + num(w.listas) + ' listas</small></span>' + mBar(a.serie[i], max) + '<b>' + pct1(a.serie[i]) + '</b></li>')).join('') + '</ul></div>' +
        '<dl class="kv"><dt>Tendencia en ' + D.meta.tendenciaDias + NB + 'días</dt><dd>' + signed(a.tendencia) + NB + 'pts' + (clear == null ? '' : clear ? ' · cambio claro' : ' · puede ser azar') + '</dd></dl>',
    }
  }
  EVIDENCE['arq-vos'] = () => {
    const a = D.meta.arquetipo
    const mine = arqMine()
    const main = rivalRows().find((x) => x.rival === a.nombre)
    const games = todaysMatches().filter((g) => g.rival === a.nombre)
    return {
      title: 'Vos contra él', sub: an(a.nombre),
      body: srcBlock('m', 'Con todos tus mazos', mine) + (main ? srcBlock('m', 'Con ' + run(deckLabel(D.mazo.id)), main.mias) : '') +
        (games.length ? '<div><div class="fld-label"><span class="label">Hoy contra él</span><span class="fine">' + games.length + ' ' + plural(games.length, 'partida', 'partidas') + ' con ese nombre de rival</span></div><ul class="ev-list">' + games.map(evGame).join('') + '</ul></div>' : ''),
      foot: '<button class="btn primary big" data-a="match-open" data-rival="' + esc(a.nombre) + '" data-f="ev-reg">' + ico('plus', 18) + 'Registrar contra este</button>',
    }
  }
  /* kind of sheet → function (params) => html of the sheet, or null when there is nothing to show (the sheet does not open) */
  const SHEETS = { partida: (p) => { if (!matchInit(p)) return null; matchShown = M.saved ? 'saved' : 'form'; return sheetPartida() }, buscar: sheetBuscar, sobre: sheetSobre, carta: sheetCarta, lanzar: sheetLanzar, acciones: sheetAcciones, ev: sheetEv }

  /* ───────────── Router and frame ─────────────
     A route is a description: resolve(path) returns
       { tab, key, viewKey, title, sub | back, right, view: () => html,
         views:  { label, items: [[key, label, href], …], active, controls } — the views of the screen, or nothing,
         action: { icon, label, aria, text, a: action of ACT, data: { … } } — its main action, or nothing,
         swap:   () => { … } — optional: changes only the panel when another view of the same page is chosen }
     and the frame does the rest: the header, the fixed row above the bar (views on the left, action on the right) and, with
     «vistas=arriba», the sticky tabs at the top of the content. A screen only declares its views and its action. */
  const TABS = [['hoy', 'Hoy', 'sun', '#/hoy'], ['mazos', 'Mazos', 'stack', '#/mazos'], ['cartas', 'Cartas', 'cards', '#/cartas'], ['meta', 'Meta', 'trophy', '#/meta'], ['pruebas', 'Pruebas', 'flask', '#/pruebas']]
  const tabMem = {}
  TABS.forEach((t) => { tabMem[t[0]] = t[3] })
  /* Scroll. Three memories, all kept by this page (the browser's own restoration is off):
     · scrollMem[path]   where each screen was last left: what a tab of the bar goes back to («each tab remembers where it was»);
     · yMem[t]           where each ENTRY of the history is, by its stamp: «atrás» and «adelante» come back to exactly that
                         (the same screen can be in two entries, each with its own place);
     · history.state.y   the same, written into the entry itself a moment after the page stops moving: what a reload, or
                         coming back from another page, restores.
     The two in memory follow every scroll event, so nothing is lost when «atrás» comes right after a scroll. */
  const scrollMem = {}
  const yMem = {}
  let yTimer = null
  /* writes where the page is into the entry that is on screen; never into another one (between a step through the history and
     its render the entry is already the next one, while the page still shows the old screen) */
  function rememberScroll() {
    clearTimeout(yTimer)
    const st = history.state
    if (!current || current.t == null || !st || st.t !== current.t) return
    const y = Math.round(window.scrollY)
    if (st.y === y) return
    try { history.replaceState(Object.assign({}, st, { y: y }), '', location.href) } catch (e) { /* no History API: the memories above still work */ }
  }
  const stack = []
  let current = null
  let navIntent = null
  /* The place of each entry in the history («i» in its state, next to its stamp «t»). Only the ORDER matters: it tells which
     way a step through the history went when it did not change the address (see «popstate», at the end of «Events»).
     Where the browser has the Navigation API its own index is used. Otherwise: a new entry is always the last one
     (history.length − 1), and an entry whose address this page replaces through a navigation — which empties its state —
     keeps the place it had (keptIndex, taken right before: swapEntry). */
  let keptIndex = null
  function navIndex() {
    try { const e = window.navigation && window.navigation.currentEntry; return e && typeof e.index === 'number' && e.index >= 0 ? e.index : null } catch (err) { return null }
  }
  function entryIndex() {
    const st = history.state
    const nav = navIndex()
    return nav != null ? nav : st && typeof st.i === 'number' ? st.i : keptIndex != null ? keptIndex : history.length - 1
  }
  /* the address of the entry that is open is replaced through a navigation («hashchange» then draws it): same entry, same place */
  function swapEntry(hash) {
    const st = history.state
    keptIndex = st && typeof st.i === 'number' ? st.i : null
    location.replace(hash)
  }
  /* the address this page last knew the entry on screen by: a step through the history that leaves it as it is changed no
     address, and no «hashchange» will come to draw anything (see «popstate») */
  let lastHref = location.href
  let lastFocus = null
  let lastFocusKey = null
  let lastTap = null          // what was tapped or clicked, only while its action runs: the opener of the sheet that action opens
  let closing = false
  let pendingView = null
  let pendingReveal = null    // key of a board row to bring into view, with the focus, once its page is drawn and no sheet is open
  let menuFrom = '/hoy'       // the screen the Menu was opened from: where its «Volver» leads (render keeps it in the Menu's own entry)
  let menuSeen = false

  /* The guard against double taps. Right after a sheet opens or closes, and right after a match is saved or undone, what is under
     the finger is no longer what was tapped: for a moment the second tap of a double tap must not act on what just appeared
     there. It is the SAME SPOT that is held, not the screen: a transparent patch (#guarda) of GUARD_R px around the tap that
     raised the guard takes whatever lands on it while the guard lasts (a click, and the focus a text field would take),
     and every other control answers at once — «V» on the table and then «Guardar partida», «Guardar partida» and then «Listo»
     are two deliberate taps on two places, however quick. Only while a sheet is still on its way in (o.whole: the entrance of
     «expresivo» and of «sutil»; nothing with «ninguno») the patch is the whole window: what is tapped then is not yet where it
     will be. A click that comes from the keyboard has no place: the click listener drops it while the guard lasts (see
     «Events»). Clicks made by code are not held. */
  let guardUntil = 0          // until when a click made by a key is dropped
  let guardTimer = null
  let guardWhole = 0          // until when the patch is the whole window
  let guardPatch = null       // { x, y, until }: the spot that is held
  const GUARD_R = 40
  function guardSync() {
    clearTimeout(guardTimer)
    const now = performance.now()
    const whole = guardWhole > now
    const patch = guardPatch && guardPatch.until > now ? guardPatch : null
    let el = document.getElementById('guarda')
    if (!whole && !patch) { if (el) el.hidden = true; return }
    if (!el) { el = document.createElement('div'); el.id = 'guarda'; el.setAttribute('aria-hidden', 'true'); document.body.appendChild(el) }
    el.style.cssText = whole ? 'inset:0' : 'left:' + (patch.x - GUARD_R) + 'px;top:' + (patch.y - GUARD_R) + 'px;width:' + (2 * GUARD_R) + 'px;height:' + (2 * GUARD_R) + 'px'
    el.hidden = false
    /* next: the whole window shrinks to the patch, or the patch goes away */
    guardTimer = setTimeout(guardSync, Math.max(1, Math.ceil((whole ? guardWhole : patch.until) - now) + 1))
  }
  /* ms: how long the spot of the tap is held (and the clicks of a key dropped). o.whole: how long the whole window is held;
     o.at: the spot, when it is not the one of the last tap (a sheet dragged down: where the finger let go). A guard raised by
     no tap at all (a key, «atrás») holds no spot. */
  function guard(ms, o) {
    const now = performance.now()
    if (now + ms > guardUntil) guardUntil = now + ms
    const at = o && o.at ? o.at : lastHit && now - lastHit.t < DOUBLE_MS ? lastHit : null
    if (at) guardPatch = { x: at.x, y: at.y, until: now + ms }
    if (o && o.whole && now + o.whole > guardWhole) guardWhole = now + o.whole
    guardSync()
  }
  const guarded = () => performance.now() < guardUntil
  const GUARD_OPEN = 450     // a sheet opened by a tap: its foot is now where the page was
  const GUARD_CLOSE = 350    // a sheet closed: the page under it
  const GUARD_SAVE = 450     // a match saved or undone, «Otra con #N»: the foot of the sheet changed under the finger
  const GUARD_PAGE = 350     // a link took the page to another screen, or a «ver más» put a row where its button was
  /* how long a sheet takes to be where it stays, by level of motion: the spring of «expresivo» crosses its place at about
     240 ms (and is within a few px of it from then on), the fade of «sutil» lasts 150 ms, «ninguno» draws it in place */
  const GUARD_MOVING = { expresivo: 260, sutil: 150, ninguno: 0 }

  function parseHash(hash) {
    const raw = (hash == null ? location.hash : hash).replace(/^#/, '') || '/hoy'
    const cut = raw.indexOf('?')
    const path = (cut < 0 ? raw : raw.slice(0, cut)).replace(/\/+$/, '') || '/hoy'
    const params = Object.create(null)
    new URLSearchParams(cut < 0 ? '' : raw.slice(cut + 1)).forEach((v, k) => { params[k] = v })
    return { path: path, params: params }
  }
  function resolve(path) {
    const seg = path.split('/').filter(Boolean)
    const more = '<a class="iconbtn" href="#/menu" aria-label="Menú: aspecto, ajustes y sistema">' + ico('sliders', 22) + '</a>'
    if (seg[0] === 'hoy' && seg.length === 1) {
      return { tab: 'hoy', key: path, title: 'Hoy', sub: D.hoy.fechaTexto + ' · era ' + D.era, right: more, view: viewHoy, action: { icon: 'plus', label: 'Registrar partida', a: 'match-open' } }
    }
    if (seg[0] === 'mazos' && seg.length === 1) {
      /* no second line under the title: the verdict line says how many there are; the filter of the list takes that room */
      return { tab: 'mazos', key: path, title: 'Mazos', sub: '', get right() { return deckFilterField() + more }, view: viewMazos, action: { icon: 'plus', label: 'Nuevo mazo', a: 'static', data: { msg: 'En la app abre el editor de mazos. La maqueta no lo trae: casi siempre los armás con Claude.' } } }
    }
    if (seg[0] === 'mazo' && seg.length <= 3) {
      const id = Number(seg[1])
      const vista = seg[2] || 'lista'
      const at = D.mazos.findIndex((m) => m.id === id)
      if (at < 0 || !VISTAS.some((v) => v[0] === vista)) return null
      const full = D.mazo.id === id
      return {
        tab: 'mazos', key: '/mazo/' + id, viewKey: full ? vista : 'lista', back: ['#/mazos', 'Mazos'], view: () => viewMazo(id, vista), deckId: id,
        /* the header of this page is the deck itself: it stays in the four views and while scrolling */
        top: () => deckTop(id), topClass: 'deck-top', topStyle: acc(D.mazos[at].energias),
        views: full ? { label: 'Vistas del mazo', items: deckTabs(id), active: vista, controls: 'panel' } : null,
        action: { icon: 'plus', label: 'Registrar partida', aria: 'Registrar partida con este mazo', a: 'match-open', data: { deck: id } },
        /* another view of the same deck: only the panel changes (the header, the tabs and the row stay), and it opens at its start */
        swap: () => {
          const panel = $('#panel')
          const lost = !document.activeElement || document.activeElement === document.body || panel.contains(document.activeElement)
          panel.innerHTML = deckPanel(D.mazo, vista)
          panel.setAttribute('aria-labelledby', 'tab-' + vista)
          panel.className = 'panel'
          void panel.offsetWidth
          panel.className = 'panel enter'
          window.scrollTo(0, 0)
          /* the view was chosen from inside the panel («ver más», the three numbers): what had the focus is gone, the new view takes it */
          if (lost) panel.focus({ preventScroll: true })
          countUp(panel, 'v/mazo/' + id + '/' + vista)
        },
      }
    }
    if (seg[0] === 'cartas' && (seg.length === 1 || (seg.length === 2 && seg[1] === 'coleccion'))) {
      const col = seg[1] === 'coleccion'
      return {
        tab: 'cartas', key: path, title: 'Cartas', sub: col ? 'Colección' : 'Sobres', right: more, view: col ? viewColeccion : viewSobres, viewKey: col ? 'coleccion' : 'sobres',
        views: { label: 'Vistas de Cartas', items: CARTAS_TABS, active: col ? 'coleccion' : 'sobres' },
        action: { icon: 'sync', label: 'Sincronizar', aria: 'Sincronizar la colección con el juego', text: true, a: 'sync' },
      }
    }
    if (seg[0] === 'pruebas') {
      if (seg.length === 1 || (seg.length === 2 && (seg[1] === 'practicar' || seg[1] === 'motor'))) {
        const sub = seg[1] || ''
        return {
          tab: 'pruebas', key: path, title: 'Pruebas', sub: sub === 'practicar' ? 'Practicar' : sub === 'motor' ? 'Motor' : 'Simulación y laboratorio, por pregunta', right: more, view: () => viewPruebas(sub), viewKey: sub || 'pruebas',
          views: { label: 'Vistas de Pruebas', items: PRUEBAS_TABS, active: sub || 'pruebas' },
          action: { icon: 'plus', label: 'Nueva prueba', a: 'launch' },
        }
      }
      if (seg[1] === 'resultado' && Number(seg[2]) === D.pruebas.resultado.id) {
        const deck = D.pruebas.resultado.mazoId
        return { tab: 'pruebas', key: path, back: ['#/pruebas', 'Pruebas'], doc: 'Resultado #' + D.pruebas.resultado.id, view: viewResultado, right: '', action: { label: 'Actualizar el mazo #' + deck, a: 'static', data: { msg: 'En la app guarda la mejor lista como una revisión nueva del mazo #' + deck + '. La maqueta no escribe.' } } }
      }
      return null
    }
    if (seg[0] === 'meta' && seg.length === 1) {
      return { tab: 'meta', key: path, title: 'Meta', sub: 'Torneos y eventos · era ' + D.meta.era, right: more, view: viewMeta, action: { icon: 'trophy', label: 'Probar contra el meta', a: 'launch', data: { q: 'meta' } } }
    }
    if (seg[0] === 'meta' && seg[1] === 'arquetipo' && seg.length === 2) {
      return { tab: 'meta', key: path, back: ['#/meta', 'Meta'], doc: D.meta.arquetipo.nombre, view: viewArquetipo, right: '', action: { icon: 'plus', label: 'Registrar contra este', aria: 'Registrar una partida contra ' + D.meta.arquetipo.nombre, a: 'match-open', data: { rival: D.meta.arquetipo.nombre } } }
    }
    if (seg[0] === 'menu' && seg.length === 1) return { tab: null, key: path, back: ['#' + menuFrom, 'Volver'], title: 'Menú', view: viewMenu, right: '' }
    return null
  }
  /* The header. A route may bring its own (top: () => html, with topClass and topStyle): the deck page does, and its header is
     the deck. Whatever its height, «--tabs-top» follows it, so the sticky tabs of «vistas=arriba» stop right under it. */
  function renderTop(route) {
    const head = $('#encabezado')
    head.className = 'top' + (route.top ? ' ' + route.topClass : route.back ? ' has-back' : '')
    head.style.cssText = route.top && route.topStyle ? route.topStyle : ''
    head.innerHTML = route.top ? route.top()
      : route.back
        ? '<a class="back" href="' + route.back[0] + '" data-a="back" aria-label="Volver' + (route.back[1] === 'Volver' ? '' : ' a ' + route.back[1]) + '">' + ico('back', 24) + '<span>' + route.back[1] + '</span></a>' + (route.title ? '<h1 class="top-title here">' + route.title + '</h1>' : '') + '<span class="top-space"></span>' + route.right
        : '<div class="top-titles"><h1 class="top-title">' + route.title + '</h1>' + (route.sub ? '<span class="top-sub">' + esc(route.sub) + '</span>' : '') + '</div>' + route.right
    syncTop()
  }
  function syncTop() {
    /* its exact height, not a whole number of pixels: a header that grew to two lines under its title measures 67.6 px, and the
       sticky tabs must start right there (rounded up they left a line of 0.4 px where the content showed through) */
    const h = $('#encabezado').getBoundingClientRect().height
    if (h) root.style.setProperty('--tabs-top', (Math.round(h * 100) / 100) + 'px')
  }
  /* the views of a screen as tabs: in the fixed row («abajo») or sticky at the top («arriba»); only one of the two exists at a time */
  function tablist(v, cls) {
    return '<div class="' + cls + '" role="tablist" aria-label="' + esc(v.label) + '">' + v.items.map((it) => '<button class="view-tab" role="tab" id="tab-' + it[0] + '" aria-selected="' + (it[0] === v.active) + '" aria-controls="' + (v.controls || 'principal') + '" tabindex="' + (it[0] === v.active ? 0 : -1) + '" data-a="tab" data-href="' + it[2] + '">' + it[1] + '</button>').join('') + '</div>'
  }
  /* the main action: with its text, or (next to three or four views) only its icon, 48 × 48, with its name for a screen reader */
  function fixedAction(a, iconOnly) {
    const data = Object.keys(a.data || {}).map((k) => ' data-' + k + '="' + esc(a.data[k]) + '"').join('')
    const name = iconOnly ? ' aria-label="' + esc(a.aria || a.label) + '" title="' + esc(a.aria || a.label) + '"' : a.aria ? ' aria-label="' + esc(a.aria) + '"' : ''
    return '<button class="fr-action' + (iconOnly ? ' icon' : '') + '" data-a="' + a.a + '"' + data + ' data-f="fixed-action"' + name + (a.a === 'match-open' || a.a === 'launch' ? ' aria-haspopup="dialog"' : '') + '>' +
      (a.icon ? ico(a.icon, iconOnly ? 24 : 20) : '') + (iconOnly ? '' : '<span>' + esc(a.label) + '</span>') + '</button>'
  }
  /* THE fixed row, one line above the tab bar: the views of the screen on the left and its main action on the right.
     No views: the action takes the whole row, with its text. Views below: the action is «+» alone (or keeps its text when the
     route says text: true). Views above («vistas=arriba»): only the action, with its text. Neither: no row at all. */
  function renderFixedRow(route) {
    const below = Boolean(route.views) && pref('vistas') === 'abajo'
    let html = ''
    if (below) html = tablist(route.views, 'fr-views') + (route.action ? fixedAction(route.action, !route.action.text) : '')
    else if (route.action) html = fixedAction(route.action, false)
    root.dataset.fila = html ? (below ? 'vistas' : 'accion') : 'no'
    $('#fila').innerHTML = html
  }
  /* the content of a screen; with «vistas=arriba» the frame puts the sticky tabs first (or where the view wrote <!--vistas-->) */
  function pageHtml(route) {
    const html = route.view()
    const bar = route.views && pref('vistas') === 'arriba' ? '<div class="tabs-bar">' + tablist(route.views, 'tabs-top') + '</div>' : ''
    return html.indexOf('<!--vistas-->') >= 0 ? html.replace('<!--vistas-->', bar) : bar + html
  }
  function paint(route, enter) {
    renderTop(route)
    const main = $('#principal')
    main.className = enter ? 'enter' : ''
    main.innerHTML = pageHtml(route)
    renderFixedRow(route)
    rove(main)
  }
  /* where what opened the sheet is in the document (the control itself or, once the page was drawn again, the one that took
     its place: same data-f) and how tall it is, or null when there is none. It is its place in the LAYOUT, not where an
     entrance animation has it right now (the detail of a row comes in from 6 px above): the animations of what holds it are
     put aside while it is measured — they have only just started, or their content is about to be drawn again. */
  function openerPlace() {
    const el = lastFocus && lastFocus !== document.body && document.contains(lastFocus) ? lastFocus : lastFocusKey ? $('#app [data-f="' + lastFocusKey + '"]') : null
    if (!el || !el.getClientRects().length) return null
    const held = []
    for (let n = el; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).animationName !== 'none') { held.push([n, n.style.animation]); n.style.animation = 'none' }
    const r = el.getBoundingClientRect()
    held.forEach((h) => { h[0].style.animation = h[1] })
    return { top: r.top + window.scrollY, h: r.height }
  }
  /* the same screen with new numbers or another look (a match saved or undone, a setting of the menu): no entrance, same place.
     Under a sheet, «the same place» is where what opened the sheet is: a match saved from a row that was unfolded puts a deck
     on the table above it and a block inside it, and with the same scroll as before the row and its button ended 150 px
     lower, behind the fixed row — the sheet closed onto another part of the page, with the focus on a button out of sight.
     So the page follows its opener: when the sheet closes, it is where it was tapped. Only a page that is at its very top
     stays there, as with the browser's own scroll anchoring (a save from the table makes the scoreboard 3 px taller: not
     worth leaving the top for) — unless that would leave the opener out of sight. */
  function repaint() {
    if (!current) return
    const y = window.scrollY
    const was = sheetIsOpen() ? openerPlace() : null
    paint(current.route, false)
    $$('#principal [data-count]').forEach((n) => { n.dataset.done = '1' })
    const now = was ? openerPlace() : null
    let to = y
    if (now) {
      /* in sight: between the header and the fixed row (hidden while the sheet is open: its place is told by the bar under it) */
      const bar = $('#barra').getBoundingClientRect()
      const css = getComputedStyle(root)
      const bottom = (bar.height ? bar.top : window.innerHeight) - (root.dataset.fila === 'no' ? 0 : (parseFloat(css.getPropertyValue('--row-h')) || 60) + 8)
      const at = now.top - y
      const hidden = at < $('#encabezado').getBoundingClientRect().bottom || at + now.h > bottom
      /* (to the fraction of a pixel: rounded, a few saves in a row would walk the page a pixel at a time) */
      if (y >= 1 || hidden) to = Math.max(0, y + now.top - was.top)
    }
    window.scrollTo(0, to)
    /* the second tap of a double tap («Guardar partida» twice) finds the page where this very tap sent it: still the same tap */
    if (Math.abs(to - y) >= 1 && lastHit) lastHit.toSy = Math.round(window.scrollY)
  }
  function renderTabbar(route) {
    $('#barra').innerHTML = TABS.map((t) => '<a class="tab" href="' + t[3] + '" data-tab="' + t[0] + '"' + (route.tab === t[0] ? ' aria-current="page"' : '') + '><span class="tab-ico">' + ico(t[2], 22) + '</span>' + t[1] + '</a>').join('') +
      '<button class="tab-search" data-a="search-open" data-f="tab-search" aria-haspopup="dialog" aria-label="Buscar y lanzar: pantallas, acciones, mazos y cartas">' + ico('search', 20) + '</button>'
  }
  const counted = new Set()
  function countUp(scope, key) {
    if (root.dataset.movimiento !== 'expresivo') return
    $$('[data-count]', scope).forEach((el, i) => {
      if (el.dataset.done) return
      el.dataset.done = '1'
      /* only the first time a number is seen: coming back to a view never shows values on their way up */
      const id = key + '|' + i + '|' + el.dataset.count
      if (counted.has(id)) return
      counted.add(id)
      const target = parseFloat(el.dataset.count)
      const final = el.innerHTML
      const unit = el.dataset.unit == null ? NB + '%' : el.dataset.unit
      /* on its way up a number shows the decimals it ends with: one inside a column (data-dec), none for a whole number */
      const dec = el.dataset.dec != null ? Number(el.dataset.dec) : Number.isInteger(target) ? 0 : 1
      const fmt = new Intl.NumberFormat('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
      const t0 = performance.now()
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 620)
        if (k >= 1 || !el.isConnected) { el.innerHTML = final; return }
        const v = target * (1 - Math.pow(1 - k, 3))
        el.textContent = ('signed' in el.dataset && v > 0 ? '+' : '') + fmt.format(v) + unit
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    })
  }
  const sheetIsOpen = () => !$('#capa-hoja').hidden
  /* what identifies a sheet: the page it is over, its kind and the parameters that change what it shows */
  const sigOf = (path, kind, p) => JSON.stringify([path, kind, p.c, p.q, p.de, p.mazo, p.res, p.rival, p.estado, p.editar])
  const sheetKindOf = (params) => { const k = params.hoja || (params.detalle === 'sobre' ? 'sobre' : null); return k && own(SHEETS, k) ? k : null }
  /* the parameters of look (tema, movimiento, vistas) that the address carries, as the end of a query: a sheet opened over a
     page, and the page again when the sheet closes, keep them, so the look does not change on a reload */
  function lookQuery() {
    const p = parseHash().params
    return Object.keys(OPTIONS).filter((k) => p[k] != null && OPTIONS[k].indexOf(p[k]) >= 0).map((k) => k + '=' + p[k]).join('&')
  }
  /* another address of the entry that is open (another view of the page), with the parameters of look this address carries:
     a view replaces the entry, and a reload of it has to show the same look */
  function withLook(hash) {
    const has = parseHash(hash).params
    const p = parseHash().params
    const look = Object.keys(OPTIONS).filter((k) => has[k] == null && p[k] != null && OPTIONS[k].indexOf(p[k]) >= 0).map((k) => k + '=' + p[k]).join('&')
    return look ? hash + (hash.indexOf('?') < 0 ? '?' : '&') + look : hash
  }
  /* takes parameters out of the address of the entry that is open (same entry, same state) */
  function dropParams(keys) {
    const raw = location.hash
    const cut = raw.indexOf('?')
    if (cut < 0) return
    const rest = raw.slice(cut + 1).split('&').filter((pair) => keys.indexOf(pair.split('=')[0]) < 0)
    const next = raw.slice(0, cut) + (rest.length ? '?' + rest.join('&') : '')
    if (next !== raw) replaceEntry(history.state, next)
  }
  function render() {
    draw()
    /* whatever was drawn, the entry that is open knows where its page is (a sheet's entry too: a reload finds the page under it) */
    rememberScroll()
    lastHref = location.href
  }
  function draw() {
    closing = false
    if (pendingView) {
      /* a view of the page under a sheet was chosen in that sheet: the sheet's entry is gone, now the view takes the page's entry */
      const hash = withLook(pendingView)
      pendingView = null
      if (location.hash !== hash) { navIntent = 'view'; swapEntry(hash); return }
    }
    const r = parseHash()
    /* the stamp of this entry: the moment it was first drawn. Without the History API (a page opened from the disk in a browser
       that refuses it) there is no stamp and every address counts as new. */
    let born = history.state && history.state.t
    if (!born) {
      born = clock()
      try { history.replaceState(Object.assign({}, history.state, { t: born, i: entryIndex() }), '', location.href) } catch (e) { born = null }
    }
    /* (the place kept for an entry that was being replaced is for the draw that follows the replacement, and for no other) */
    keptIndex = null
    const place = born != null && history.state && typeof history.state.i === 'number' ? history.state.i : null
    /* an address that comes back («Volver», atrás, adelante) with a parameter of look the menu has since overridden: the
       parameter is taken out of that entry, so the address says what is on screen and a reload keeps the menu's choice */
    const old = Object.keys(OPTIONS).filter((k) => r.params[k] != null && isStale(k, born))
    if (old.length) {
      dropParams(old)
      old.forEach((k) => { delete r.params[k] })
    }
    const lookChanged = prefsFromUrl(r.params, born)
    if (r.path === '/menu') {
      /* The Menu keeps, in its own entry, the screen it was opened from: «Volver» leads there also after a reload and when the
         Menu is reached again with «atrás» or «adelante» (then the screen just left is NOT where it was opened from). */
      const st = history.state
      let from = st && typeof st.from === 'string' && st.from.charAt(0) === '/' && st.from !== r.path ? st.from : null
      if (!from) {
        /* the first time this entry is drawn: it was opened from the screen that is on (a link, the launcher, a typed address).
           Without the History API an entry cannot keep it: a step through the history to the Menu uses what the Menu last knew. */
        const here = current && current.path !== r.path ? current.path : null
        /* another address of the Menu while the Menu is the screen that is on (a parameter of look added by hand): it was not
           opened from anywhere new, it keeps what it knew */
        const still = current && current.path === r.path && menuSeen ? menuFrom : null
        from = (born == null && !navIntent && menuSeen ? menuFrom : here) || still || (stack.length ? stack[stack.length - 1] : '/hoy')
        try { history.replaceState(Object.assign({}, history.state, { from: from }), '', location.href) } catch (e) { /* kept in memory only */ }
      }
      menuFrom = from
      menuSeen = true
    }
    const route = resolve(r.path)
    if (!route) { swapEntry('#/hoy'); return }
    const kind = navIntent || (current ? 'pop' : 'first')
    navIntent = null
    const samePage = current && current.key === route.key
    const sameView = samePage && current.viewKey === route.viewKey
    const tabFocus = document.activeElement && /^tab-/.test(document.activeElement.id || '') ? document.activeElement.id : null
    const prevSig = current ? current.sig : null
    const main = $('#principal')
    /* where the screen being left is: with the browser's restoration off, the page has not moved since it was last used */
    if (current && !sameView) { scrollMem[current.path] = Math.round(window.scrollY); if (current.t != null) yMem[current.t] = scrollMem[current.path] }
    if (!samePage) {
      if (kind === 'pop') { const at = stack.lastIndexOf(r.path); stack.length = at >= 0 ? at : 0 } else if (kind !== 'view' && current && r.path !== current.path) stack.push(current.path)
      /* a link led here: for a moment the taps are dropped, so a double tap on a row never acts on the screen it opened.
         (Not for a tab of the bar, whose second tap goes back to the start of its section; nor for atrás and adelante.) */
      if ((kind === 'link' || kind === 'up') && current) guard(GUARD_PAGE)
      if (current) dropOldToast()
      paint(route, true)
      if (!current || current.tab !== route.tab) renderTabbar(route)
      /* a link opens a screen at its top; a tab of the bar and «Volver» of the header («up»), where that screen was last left;
         a step through the history (and a reload, which is the same entry again), where THAT entry was */
      const entryY = born != null && yMem[born] != null ? yMem[born] : history.state && typeof history.state.y === 'number' ? history.state.y : null
      window.scrollTo(0, kind === 'tab' || kind === 'up' ? scrollMem[r.path] || 0 : kind === 'pop' ? (entryY != null ? entryY : scrollMem[r.path] || 0) : kind === 'first' ? entryY || 0 : 0)
      if (kind === 'first' && entryY && document.fonts && document.fonts.ready) {
        /* a reload: the fonts arrive after this first layout and the text above flows again (the page may even be too short
           for its place until then). Once they are in, the page goes to its place again, unless it was moved by hand meanwhile. */
        let moved = false
        const stop = () => { moved = true }
        ;['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((type) => window.addEventListener(type, stop, { once: true, passive: true, capture: true }))
        document.fonts.ready.then(() => { if (!moved && current && current.t === born) window.scrollTo(0, entryY) })
      }
      countUp(main, 'p' + r.path)
    } else if (lookChanged) {
      /* same screen, another look: a link that only adds tema / movimiento / vistas to the screen already open draws it again in place */
      const y = window.scrollY
      paint(route, false)
      $$('[data-count]', main).forEach((n) => { n.dataset.done = '1' })
      window.scrollTo(0, y)
    } else if (!sameView) {
      /* same page, another view: only the panel changes when the route knows how; the tabs stay where they are */
      if (route.swap && $('#panel')) {
        route.swap()
        $$('[role="tab"]').forEach((t) => { const on = t.id === 'tab-' + route.viewKey; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1 })
      } else { paint(route, false); window.scrollTo(0, 0) }
    }
    document.title = (route.doc || route.title || (route.deckId ? deckLabel(route.deckId) : route.back ? route.back[1] : 'TCG Pocket')) + ' · maqueta D'
    /* a view chosen with the keyboard keeps the focus on its tab, also when the row was drawn again */
    if (tabFocus && (!document.activeElement || document.activeElement.id !== tabFocus)) { const again = document.getElementById(tabFocus); if (again) again.focus({ preventScroll: true }) }
    if (route.tab) tabMem[route.tab] = '#' + r.path
    const sheetKind = sheetKindOf(r.params)
    const sig = sheetKind ? sigOf(r.path, sheetKind, r.params) : null
    /* t: the stamp of the entry this screen was drawn for (nothing without the History API) */
    current = { path: r.path, key: route.key, viewKey: route.viewKey, tab: route.tab, sig: sig, route: route, t: born, i: place }
    if (!sig) { closeLayer(); reveal(); return }
    if (sig === prevSig && sheetIsOpen()) return
    if (openSheet(sheetKind, r.params)) { syncSig(); return }
    /* A sheet that cannot open: the match it corrected was deleted and «adelante» came back to its entry, or its key is unknown.
       · The sheet's own entry — the one a tap made over its page — is stepped out of, as closing it does. Rewritten as the bare
         page it would be a second entry with the address of the page before it: the next «atrás» would change nothing.
       · An address that came with the sheet in it has no page of its own behind: that entry becomes the bare page. */
    current.sig = null
    if (history.state && history.state.over) history.back()
    else replaceEntry(born != null ? { t: born, i: place } : null, pageHash())
    closeLayer()
  }
  /* brings the row asked for in «pendingReveal» into view and gives it the focus (the launcher: a rival → its row in Meta) */
  function reveal() {
    if (!pendingReveal) return
    const li = $('[data-row="' + pendingReveal + '"]')
    pendingReveal = null
    if (!li) return
    li.scrollIntoView({ block: 'center' })
    const row = $('.board-row', li)
    if (row && row.focus) row.focus({ preventScroll: true })
  }
  /* Another view of the screen that is open (Sobres ↔ Colección, Pruebas ↔ Practicar ↔ Motor, the four of a deck)? Going from
     one to another never makes a new entry of the history, whatever leads there — the view switcher, a second tap on the tab
     of the bar, a link, the launcher: the view takes the place of the one that was open. So «atrás» leaves the screen (it
     never walks back through its views) and no two entries in a row end up with the same address — which is what happened
     when «Colección» was reached again from a «Sobres» that had been pushed after it: the step back between the two changed
     nothing on screen. */
  const isSibling = (path) => Boolean(current && current.route.views && path !== current.path && current.route.views.items.some((it) => parseHash(it[2]).path === path))
  function viewTo(href) {
    /* the same entry with another view: the parameters of look of the address stay in it */
    const to = withLook(href)
    /* already there? The address says it, not «aria-selected»: the address changes at once and the tabs only when the page
       is drawn, a moment later. With the arrows pressed faster than that (a key held down on a slow phone), the tab still
       drawn as chosen is not where the address is, and going back to it was dropped: one tab chosen, the focus on another. */
    if (parseHash(to).path === parseHash().path) return
    navIntent = 'view'
    swapEntry(to)
  }
  function go(hash, intent) {
    if (!intent && isSibling(parseHash(hash).path)) { viewTo(hash); return }
    navIntent = intent || 'link'
    if (location.hash === hash) render(); else location.hash = hash
  }
  const basePath = () => '#' + (current ? current.path : '/hoy')
  /* the page that is open and a sheet over it, each with the parameters of look its address came with */
  const pageHash = () => { const look = lookQuery(); return basePath() + (look ? '?' + look : '') }
  const sheetHash = (query) => { const look = lookQuery(); return basePath() + '?' + query + (look ? '&' + look : '') }
  /* The History API, with a way out: a browser that refuses it for a page opened from the disk falls back to plain hash
     navigation (the sheets then open and close the same; only «adelante» after closing one is lost). */
  function pushEntry(state, hash) { try { history.pushState(state, '', hash); lastHref = location.href } catch (e) { location.hash = hash } }
  function replaceEntry(state, hash) { try { history.replaceState(state, '', hash); lastHref = location.href } catch (e) { location.replace(hash) } }
  /* the state of an entry that starts again as a new one (no stamp, no mark of a sheet) but stays where it is in the history */
  const placeOnly = () => { const st = history.state; return st && typeof st.i === 'number' ? { i: st.i } : null }
  /* the address changed without a navigation (replaceState): the sheet that is open is the one of the new address */
  function syncSig() { const h = parseHash(); const k = sheetKindOf(h.params); current.sig = k ? sigOf(h.path, k, h.params) : null }
  /* the open sheet moves to another state (saved, undone, another question): same history entry, new address */
  function setSheetUrl(query) { replaceEntry(history.state, sheetHash(query)); syncSig() }

  /* Sheets and the history. A sheet opened from its own page is ONE new entry marked { over: true }: «atrás» (or Escape, «Listo»,
     the scrim) closes it and lands on the page. A sheet that came with the address (a direct link) has no entry of its own:
     closing it rewrites that entry as the bare page. While a sheet is open, its states and any other sheet replace the entry. */
  function openSheet(kind, params) {
    const make = own(SHEETS, kind)
    const html = make ? make(params) : null
    if (html == null) return false
    const layer = $('#capa-hoja')
    if (layer.hidden) {
      /* where the focus goes back when the sheet closes: what was tapped (on some phones a tap gives no focus), or what has the focus */
      lastFocus = lastTap || document.activeElement
      lastFocusKey = lastFocus && lastFocus.dataset && lastFocus.dataset.f ? lastFocus.dataset.f : null
    }
    /* opened by a tap or a click (not by the address, the history or the «/» key): while the sheet is on its way in every tap
       is dropped, and after that only one on the spot that was tapped */
    if (lastTap) guard(GUARD_OPEN, { whole: GUARD_MOVING[root.dataset.movimiento] || 0 })
    layer.innerHTML = '<div class="scrim" data-a="sheet-close"></div><section class="sheet' + (kind === 'buscar' ? ' tall' : '') + '" data-sheet="' + kind + '" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' + html + '</section>'
    layer.hidden = false
    root.classList.add('sheet-open')
    $('#app').setAttribute('inert', '')
    if (kind === 'buscar') {
      const field = $('#search-q')
      field.focus({ preventScroll: true })
      field.setSelectionRange(field.value.length, field.value.length)
      launcherHi(0)
    } else if ($('#sheet-title')) $('#sheet-title').focus({ preventScroll: true })
    rove(layer)
    countUp(layer, 's' + kind)
    fitRival()
    sheetMore()
    return true
  }
  /* When the body of a sheet does not fit (a short screen, the browser bars), a fade over the foot says there is more below. */
  function sheetMore() {
    const sheet = $('.sheet')
    if (!sheet) return
    const body = $('.sheet-body, .search-body', sheet)
    sheet.classList.toggle('more', !!body && body.scrollHeight - body.scrollTop - body.clientHeight > 6)
  }
  function closeLayer(keepFocus) {
    const layer = $('#capa-hoja')
    if (layer.hidden) return
    guard(GUARD_CLOSE)
    layer.hidden = true
    layer.innerHTML = ''
    root.classList.remove('sheet-open')
    $('#app').removeAttribute('inert')
    if (!keepFocus) {
      /* back to what opened it; the page may have been drawn again meanwhile, so the opener is looked up by its key too */
      const opener = lastFocus && lastFocus !== document.body && document.contains(lastFocus) ? lastFocus : lastFocusKey ? $('[data-f="' + lastFocusKey + '"]') : null
      if (opener) opener.focus({ preventScroll: true }); else $('#principal').focus({ preventScroll: true })
    }
    lastFocus = null
    lastFocusKey = null
  }
  function closeSheet() {
    if (!sheetIsOpen() || closing) return
    guard(GUARD_CLOSE)
    navIntent = 'sheet'
    if (history.state && history.state.over) {
      closing = true
      setTimeout(() => { closing = false }, 700)
      history.back()
    } else { replaceEntry(history.state, pageHash()); render() }
  }
  function showSheet(query) {
    const hash = sheetHash(query)
    if (sheetIsOpen()) replaceEntry(history.state, hash)
    else pushEntry({ over: true }, hash)
    navIntent = 'sheet'
    render()
  }
  /* Leaving through a link inside a sheet: the sheet's entry is replaced, so «atrás» returns to the page under it and never to the sheet. */
  function leaveSheetTo(hash) {
    if (!sheetIsOpen()) { go(hash); return }
    if (hash === basePath()) { closeSheet(); return }
    const over = Boolean(history.state && history.state.over)
    const to = parseHash(hash)
    const dest = resolve(to.path)
    /* a sheet of the page that is open (the launcher → «Los números de …» while in Sobres): it takes the place of this sheet in
       the same entry, which stays marked as a sheet's entry, so «atrás» closes it and lands on the page */
    if (dest && to.path === current.path && sheetKindOf(to.params)) { showSheet(hash.slice(hash.indexOf('?') + 1)); return }
    closeLayer(true)
    /* the sheet is gone and what opened it may be too: the focus goes to the content, never to nowhere */
    $('#principal').focus({ preventScroll: true })
    current.sig = null
    /* another view of the page under the sheet (the same deck; Sobres from Colección; Motor from Pruebas) */
    const sameKey = Boolean(dest && (dest.key === current.key || isSibling(to.path)))
    if (over && sameKey) {
      /* one «atrás» must still leave the page: the sheet's entry is stepped out of and the view takes the page's entry */
      pendingView = hash
      navIntent = 'sheet'
      history.back()
      return
    }
    navIntent = sameKey ? 'view' : 'link'
    /* (another view of the page under a sheet that came with the address: the same entry, so it keeps its parameters of look) */
    if (over || sameKey) { replaceEntry(placeOnly(), sameKey ? withLook(hash) : hash); render(); return }
    replaceEntry(history.state, pageHash())
    location.hash = hash
  }

  let toastTimer = null
  let toastAt = 0             // when the notice on screen was raised
  function clearToast() {
    clearTimeout(toastTimer)
    const box = $('#avisos')
    if (box) box.innerHTML = ''
  }
  function toast(msg) {
    const box = $('#avisos')
    box.innerHTML = '<div class="toast">' + esc(msg) + '</div>'
    clearTimeout(toastTimer)
    toastAt = performance.now()
    toastTimer = setTimeout(() => { box.innerHTML = '' }, 3600)
  }
  /* A notice is about the screen it was raised on: when another screen is drawn, a notice that was already there goes away
     (it used to stay its 3.6 s over the next screen, and over the sheet opened there: «acá están los tres de la sesión» over a
     sheet that showed four). One raised by the very action that leads to the new screen («Sincronizar la colección» in the
     launcher: it goes to Colección and says what the app would do) is younger than the navigation and stays. */
  const TOAST_FRESH = 400
  function dropOldToast() { if (toastAt && performance.now() - toastAt > TOAST_FRESH) clearToast() }

  /* What a tap opens IN PLACE has to be seen. A row that sat right above the fixed row opened its detail behind it, and a button
     right above the foot of a sheet opened its field behind the foot: nothing on screen changed and the tap looked dead. So after
     «box» is shown under «anchor» (the control that opened it), the page — or the body of the sheet they are in — moves just
     enough to show the box whole above whatever is fixed at the bottom, and never so far that the anchor itself leaves the
     screen at the top. The place of the box is taken from the layout (its offset from the anchor), not from where its entrance
     animation has it right now. Returns how far it moved (0: it was in sight already). */
  function bringUp(anchor, box) {
    if (!anchor || !box) return 0
    const body = anchor.closest('.sheet-body')
    let top
    let bottom
    if (body) {
      const r = body.getBoundingClientRect()
      top = r.top
      bottom = r.bottom - 8
    } else {
      top = $('#encabezado').getBoundingClientRect().bottom
      const tabs = $('.tabs-bar')
      if (tabs) { const t = tabs.getBoundingClientRect(); if (t.top <= top + 1) top = t.bottom }
      /* the fixed row has a fade over the last pixels above it (the same 16 px the focus keeps clear: «scroll-padding» in the
         CSS); with no row (or with the bars put away by a keyboard) the limit is the bar, or the window */
      const row = $('#fila').getBoundingClientRect()
      const bar = $('#barra').getBoundingClientRect()
      bottom = row.height ? row.top - 16 : bar.height ? bar.top - 8 : window.innerHeight - 8
    }
    const a = anchor.getBoundingClientRect()
    const over = a.top + (box.offsetTop - anchor.offsetTop) + box.offsetHeight - bottom
    const by = Math.round(Math.min(over, a.top - top - 8))
    if (by < 1) return 0
    /* the second tap of a double tap finds the page on its way to (or at) the place this very tap sent it: it is still the same
       tap, not a tap on what has just arrived under the finger (see «A double tap is ONE tap») */
    if (lastHit) { if (body) lastHit.toBy = lastHit.by + by; else lastHit.toSy = lastHit.sy + by }
    ;(body || window).scrollBy({ top: by, behavior: root.dataset.movimiento === 'ninguno' ? 'auto' : 'smooth' })
    return by
  }

  /* ───────────── Events ───────────── */
  const NOT_HERE = 'Solo en la app: la maqueta no lo hace.'
  const ACT = {
    'match-open': (el) => {
      const deck = el.dataset.deck || (current.route.deckId ? current.route.deckId : '')
      showSheet('hoja=partida' + (deck ? '&mazo=' + deck : '') + (el.dataset.res ? '&res=' + el.dataset.res : '') + (el.dataset.rival ? '&rival=' + encodeURIComponent(el.dataset.rival) : ''))
    },
    'match-edit': (el) => showSheet('hoja=partida&editar=' + el.dataset.ref),
    /* «Saltar al contenido»: the focus goes to the content; the address (the route) stays as it is */
    skip: () => $('#principal').focus(),
    'search-open': () => showSheet('hoja=buscar&q='),
    'sheet-close': () => closeSheet(),
    evidence: (el) => showSheet('hoja=ev&de=' + el.dataset.k),
    sheet: (el) => showSheet('hoja=acciones&de=' + el.dataset.s),
    launch: (el) => showSheet('hoja=lanzar' + (el.dataset.q ? '&q=' + el.dataset.q : '') + (el.dataset.deck ? '&mazo=' + el.dataset.deck : '') + (el.dataset.rival ? '&rival=' + encodeURIComponent(el.dataset.rival) : '')),
    numbers: () => showSheet('detalle=sobre'),
    'launch-q': (el) => {
      const p = Object.assign({}, parseHash().params, { q: el.dataset.v })
      setSheetUrl('hoja=lanzar&q=' + p.q + (p.mazo ? '&mazo=' + p.mazo : '') + (p.rival ? '&rival=' + encodeURIComponent(p.rival) : ''))
      $('.sheet').innerHTML = sheetLanzar(p)
      rove($('.sheet'))
      const b = $('.sheet [data-f="ln-' + p.q + '"]')
      if (b) b.focus({ preventScroll: true })
      sheetMore()
    },
    'launch-go': (el) => toast(el.getAttribute('aria-disabled') === 'true' ? 'Elegí primero una de las cuatro preguntas.' : 'En la maqueta no se lanza nada: en la app se encola y avisa cuando termina.'),
    card: (el) => showSheet('hoja=carta&c=' + encodeURIComponent(el.dataset.c)),
    go: (el) => leaveSheetTo(el.dataset.href),
    /* a rival chosen in the launcher: Meta, with every archetype listed and the row of that one unfolded and in sight */
    'rival-go': (el) => {
      const key = 'meta:' + el.dataset.id
      ui.metaFilter = 'todos'
      ui.open.add(key)
      pendingReveal = key
      /* Meta is the page under the launcher: it is drawn again now, and closing the launcher shows the row */
      if (current.path === '/meta') repaint()
      leaveSheetTo('#/meta')
    },
    'sync-go': () => { leaveSheetTo('#/cartas/coleccion'); toast(SYNC_MSG) },
    static: (el) => toast(el.dataset.msg || NOT_HERE),
    toggle: (el, e) => {
      const k = el.dataset.k
      const open = !ui.open.has(k)
      if (open) ui.open.add(k); else ui.open.delete(k)
      el.setAttribute('aria-expanded', open)
      const box = document.getElementById(el.getAttribute('aria-controls'))
      if (box) box.hidden = !open
      /* what opened is brought into sight: a row right above the fixed row opened its detail behind it. (Only for a tap, a
         click or a key of the person: a click made by code opens the row and leaves the page where it is.) */
      if (box && open && e && e.isTrusted) bringUp(el, box)
      sheetMore()
    },
    'board-sort': (el) => {
      const st = ui.sort[el.dataset.b]
      if (!st) return
      if (st.k === el.dataset.k) st.rev = !st.rev; else { st.k = el.dataset.k; st.rev = false }
      boardRefresh(el.dataset.b, el.dataset.f)
    },
    /* a type chosen with the pointer leaves the focus where it was (the field: what is typed next still goes into it, and the
       arrows and Enter keep working); chosen with the keyboard, the focus stays on its tab */
    'lz-type': (el) => {
      const onTab = Boolean(document.activeElement && document.activeElement.closest('#lz-types'))
      LZ.type = el.dataset.v
      launcherPaint()
      const b = onTab ? $('[data-f="lz-' + LZ.type + '"]') : null
      if (b) b.focus({ preventScroll: true })
    },
    /* the rest of the list comes in where the button was: a second tap must not follow the row that took its place */
    'pend-more': () => { guard(GUARD_PAGE); ui.open.add('pend'); $('#pend').innerHTML = pendList(); const b = $('#pend li:nth-child(' + (PEND_SHOWN + 1) + ') .pend'); if (b) b.focus({ preventScroll: true }) },
    'games-more': () => { guard(GUARD_PAGE); ui.open.add('games'); $('#games').innerHTML = gamesList(); const b = $('#games li:nth-child(' + (GAMES_SHOWN + 1) + ') .game'); if (b) b.focus({ preventScroll: true }) },
    'deck-filter': (el) => { ui.deckFilter = el.dataset.v; $$('[data-a="deck-filter"]').forEach((b) => b.setAttribute('aria-pressed', b === el)); paintDecks() },
    'job-filter': (el) => { ui.jobFilter = el.dataset.v; $$('[data-a="job-filter"]').forEach((b) => b.setAttribute('aria-pressed', b === el)); $('#job-list').innerHTML = jobList() },
    'meta-filter': (el) => { ui.metaFilter = el.dataset.v; $$('[data-a="meta-filter"]').forEach((b) => b.setAttribute('aria-pressed', b === el)); boardPaint('meta') },
    'col-filter': (el) => { ui.colFilter = el.dataset.v; $$('[data-a="col-filter"]').forEach((b) => b.setAttribute('aria-pressed', b === el)); paintCol() },
    /* list or grid: only the cards are drawn again (the rest of the view stays as it is) */
    'list-mode': (el) => {
      const box = $('#lista')
      if (!box || ui.listMode === el.dataset.v) return
      ui.listMode = el.dataset.v
      box.innerHTML = cardGroups(D.mazo)
      const b = $('[data-a="list-mode"][data-v="' + ui.listMode + '"]', box)
      if (b) b.focus({ preventScroll: true })
    },
    /* a view replaces the history entry: «atrás» leaves the screen, it does not walk back through its views */
    tab: (el) => viewTo(el.dataset.href),
    /* «Volver» of the header: a step back in the history when the screen it leads to is the one before this; when it is not
       (the screen was reached through a tab of the bar, through «Siguiente», after a reload), it goes there as a new entry and
       — intent «up» — the screen opens where it was last left, as it does after a step back */
    back: (el) => { if (stack.length && '#' + stack[stack.length - 1] === el.getAttribute('href')) history.back(); else go(el.getAttribute('href'), 'up') },
    pref: (el) => {
      if (el.getAttribute('aria-disabled') === 'true') { toast('Tu sistema pide reducir el movimiento: queda en «Ninguno».'); return }
      setPref(el.dataset.k, el.dataset.v)
      /* the choice wins over the parameter this very address may carry: it leaves the address, so a reload keeps the choice */
      dropParams([el.dataset.k])
      repaint()
      const b = $('[data-f="' + el.dataset.f + '"]')
      if (b) b.focus({ preventScroll: true })
    },
    'pref-thumbs': (el) => { setPref('miniaturas', pref('miniaturas') === 'si' ? 'no' : 'si'); el.setAttribute('aria-checked', pref('miniaturas') === 'si') },
    'motion-demo': () => { const d = $('#motion-demo'); d.classList.toggle('go') },
    sync: () => { const i = $('#sync-ico'); if (i && i.animate && root.dataset.movimiento !== 'ninguno') i.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: root.dataset.movimiento === 'expresivo' ? 900 : 300, easing: 'ease-in-out' }); toast(SYNC_MSG) },
    'match-deck': (el) => { M.deckId = Number(el.dataset.deck); matchRender('deck-' + M.deckId) },
    'match-result': (el) => { M.result = M.result === el.dataset.v ? null : el.dataset.v; M.hint = false; matchRender('res-' + el.dataset.v) },
    'match-rival': (el) => { M.rival = el.dataset.v; M.rivalPicked = true; matchRender('st-yo') },
    'match-rival-clear': () => { M.rival = ''; M.rivalPicked = false; matchRender(); const f = $('#m-rival'); if (f) f.focus({ preventScroll: true }) },
    'match-start': (el) => { M.started = M.started === el.dataset.v ? null : el.dataset.v; matchRender('st-' + el.dataset.v) },
    'match-seen': () => {
      const next = D.partida.cartasVistasEjemplo.find((c) => !M.seen.some((s) => s.nombre === c.nombre))
      if (next) { M.seen.push(copyCard(next)); M.seenUnknown = false; toast('En la app se abre el buscador de cartas en esta misma hoja; acá entran las del ejemplo.') } else toast('La maqueta trae dos cartas de ejemplo.')
      matchRender('seen-add')
    },
    'match-seen-del': (el) => { M.seen.splice(Number(el.dataset.i), 1); matchRender('seen-add') },
    /* «Sin nota» means it: the field goes away and so does what was written in it */
    'match-note': () => {
      M.noteOpen = !M.noteOpen
      if (!M.noteOpen) M.note = ''
      matchRender('note')
      /* the field comes in under the button, which is the last thing of the form: right above the foot of the sheet, where the
         field was left behind it (matchRender keeps the body where it was). It is brought into sight and takes the focus, ready
         to be typed in. */
      const field = M.noteOpen ? $('#m-note') : null
      if (field) { bringUp($('.sheet [data-f="note"]'), field); field.focus({ preventScroll: true }) }
    },
    /* Guardar: the only place where a match is counted */
    'match-save': () => {
      if (M.saved || M.edit) return
      if (!M.result) { M.hint = true; matchRender('save'); return }
      ult = { id: ++matchSeq, deckId: M.deckId, result: M.result, rival: M.rival.trim(), rivalPicked: Boolean(M.rivalPicked && M.rival.trim()), started: M.started, seen: M.seen.map(copyCard), mode: M.mode, note: M.note }
      sesion.unshift(ult)
      keepVisit()
      Object.assign(M, { saved: true, rank: null, fresh: true, hint: false })
      ui.open.delete('calc')
      setSheetUrl('hoja=partida&estado=guardada')
      /* the focus goes to the title of the answer, not to «Deshacer»: a second Enter must not undo what the first one saved.
         And the foot changed under the finger («Otra con #N» is where «Guardar» was): the next taps are dropped for a moment. */
      matchRender('sheet-title')
      guard(GUARD_SAVE)
      freshDeck = ult.deckId
      repaint()
      freshDeck = null
    },
    'match-edit-ok': () => { closeSheet(); toast('En la app la partida queda corregida. La maqueta no cambia la que ya estaba guardada.') },
    /* Deshacer: takes out exactly the match the saved state shows, and leaves the form as it was, ready to save again */
    'match-undo': () => {
      const g = ult
      if (!g || !M.saved) return
      ult = null
      if (g.fromData) quitada = true
      else { const at = sesion.indexOf(g); if (at >= 0) sesion.splice(at, 1) }
      keepVisit()
      matchSet({ deckId: g.deckId, result: g.result, rival: g.rival, rivalPicked: pickedOf(g), started: g.started, seen: g.seen.map(copyCard), mode: g.mode, note: g.note || '', noteOpen: Boolean(g.note) })
      setSheetUrl(isExample(M) && M.started === D.partida.ejemplo.empezo && M.seen.length === D.partida.cartasVistasEjemplo.length ? 'hoja=partida&estado=lista' : 'hoja=partida&mazo=' + M.deckId + '&res=' + M.result)
      matchRender('save')
      guard(GUARD_SAVE)
      repaint()
      toast('Deshecho: la partida no quedó guardada.')
    },
    /* «Eliminar esta partida», in «Corregir partida»: only for a match saved in this visit (the ones of the data are not changed) */
    'match-delete': () => {
      const g = M.edit
      const at = g ? sesion.findIndex((s) => 's' + s.id === g.ref) : -1
      if (at < 0) return
      if (ult === sesion[at]) ult = null
      sesion.splice(at, 1)
      keepVisit()
      repaint()
      closeSheet()
      toast('Eliminada: esa partida ya no cuenta.')
    },
    'match-rank': (el) => {
      const i = Number(el.dataset.v)
      M.rank = M.rank === i ? null : i
      matchRender('rank-' + i)
      if (M.rank === i && /^Otro/.test(D.partida.respuesta.rango.opciones[i])) toast('En la app abre la lista de rangos para elegir otro. La maqueta solo lo marca.')
    },
    /* «Otra con #N»: the saved match stays saved; the form comes back with the same deck and the result just tapped */
    'match-again': (el) => {
      const g = ult
      if (!g) return
      ult = null
      matchSet({ deckId: g.deckId, result: el.dataset.v, mode: g.mode })
      setSheetUrl('hoja=partida&mazo=' + M.deckId + '&res=' + M.result)
      matchRender()
      /* «Guardar partida» is now where the three buttons were: a second tap must not save this one too */
      guard(GUARD_SAVE)
    },
  }
  /* A double tap is ONE tap. The first tap may have changed what is under the finger (a chosen option that a second tap would
     un-choose, a card that slid into the place of the one just removed, the note that appeared where the suggested rival was):
     a second tap or click at the same spot within DOUBLE_MS is dropped, whatever lies there now. Only where a second tap has a
     meaning of its own does it go on: a tab of the bar (back to the start of its section) and a column of a board (the other way
     round). Keys and clicks made by code are never held; and a tap after the page or the sheet was scrolled is never a twin. */
  const DOUBLE_MS = 400
  const DOUBLE_PX = 30
  const MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform || '')
  let lastHit = null          // the last tap or click on a control: { t, x, y, sy, by } and, when that tap itself moved the page or the body of the sheet (bringUp), where it sent them: toSy, toBy
  const tapsTwice = (el) => Boolean(el.closest('.tab, [data-a="board-sort"]'))
  document.addEventListener('click', (e) => {
    /* A click on a link with the key that sends it somewhere else is the browser's: Ctrl (⌘ on a Mac) opens it in another
       tab, Shift in another window, Alt saves it, and Ctrl on a Mac is the menu of the link. This page then stays exactly as
       it is — no action runs here and no intent is left behind for the next step through the history. (The key that means
       nothing to the browser — ⌘ / Windows away from a Mac — is a plain click, and so is any key on a button.) */
    if ((e.ctrlKey || e.shiftKey || e.altKey || (MAC && e.metaKey) || e.button > 0) && e.target.closest('a[href]')) return
    /* the guard against double taps. A pointer on the spot that is held never gets here (the patch #guarda takes it), and a
       pointer anywhere else is a tap on another control: it goes on. This drops the click a key makes (Enter or Space on what
       has the focus), which has no place of its own. A click made by code (the launcher's Enter) goes on. */
    if (guarded() && e.isTrusted && e.detail === 0) { e.preventDefault(); e.stopPropagation(); return }
    /* whatever this click does, the entry that is open knows where its page is before it (a tap right after a scroll too) */
    rememberScroll()
    if (e.isTrusted && e.detail > 0 && e.target.closest('a, button, [data-a]')) {
      const now = performance.now()
      /* the same spot of the same content: if the page or the body of the sheet was moved between the two taps, what is under
         the finger is another thing that was tapped on purpose */
      const body = $('#capa-hoja .sheet-body, #capa-hoja .search-body')
      const at = { t: now, x: e.clientX, y: e.clientY, sy: Math.round(window.scrollY), by: body ? Math.round(body.scrollTop) : 0 }
      /* (moved by hand, that is: when the first tap itself brought what it opened into sight, the page is on its way from where
         it was to where that tap sent it, and a second tap that finds it there is still its twin) */
      const same = (v, from, to) => v >= Math.min(from, to == null ? from : to) - 2 && v <= Math.max(from, to == null ? from : to) + 2
      const twin = lastHit && now - lastHit.t < DOUBLE_MS && Math.hypot(at.x - lastHit.x, at.y - lastHit.y) < DOUBLE_PX && same(at.sy, lastHit.sy, lastHit.toSy) && same(at.by, lastHit.by, lastHit.toBy)
      /* a third tap finds the page where the first one sent it, too */
      if (twin) Object.assign(at, { sy: lastHit.sy, by: lastHit.by, toSy: lastHit.toSy, toBy: lastHit.toBy })
      lastHit = at
      if (twin && !tapsTwice(e.target)) { e.preventDefault(); e.stopPropagation(); return }
    }
    const tab = e.target.closest('.tab')
    if (tab) {
      e.preventDefault()
      const t = tab.dataset.tab
      const rootHash = TABS.find((x) => x[0] === t)[3]
      /* a tab remembers where it was; tapping the one that is open goes back to its start, and then to the top */
      if (current.tab === t) { if ('#' + current.path !== rootHash) go(rootHash); else window.scrollTo({ top: 0, behavior: root.dataset.movimiento === 'ninguno' ? 'auto' : 'smooth' }) } else go(tabMem[t], 'tab')
      return
    }
    const el = e.target.closest('[data-a]')
    if (el && ACT[el.dataset.a]) {
      if (el.tagName === 'A') e.preventDefault()
      lastTap = el
      try { ACT[el.dataset.a](el, e) } finally { lastTap = null }
      return
    }
    const link = e.target.closest('a[href^="#/"]')
    if (link) {
      const href = link.getAttribute('href')
      if (sheetIsOpen()) { e.preventDefault(); leaveSheetTo(href); return }
      if (href === location.hash) { e.preventDefault(); window.scrollTo({ top: 0, behavior: root.dataset.movimiento === 'ninguno' ? 'auto' : 'smooth' }); return }
      /* a link to a sheet of the page that is open: it opens as every sheet does (one entry of its own, that «atrás» closes) */
      const to = parseHash(href)
      if (current && to.path === current.path && sheetKindOf(to.params)) { e.preventDefault(); lastTap = link; try { showSheet(href.slice(href.indexOf('?') + 1)) } finally { lastTap = null } return }
      /* a link to another view of this screen is a change of view: it takes the place of this one in its entry */
      if (isSibling(to.path)) { e.preventDefault(); viewTo(href); return }
      navIntent = 'link'
    }
  })
  /* pressing a type tab of the launcher with the pointer leaves the focus where it was: in the field, the keyboard of the phone
     stays as it is and what is typed next still goes into it. The same for the guard against double taps: the tap it swallows
     must not take the focus away from the sheet that just opened (it went to <body>, and Tab then left the sheet). */
  document.addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('#lz-types button, #guarda')) e.preventDefault() })
  /* The bar drawn at the top of a sheet is a handle: dragging the head of the sheet down closes it; a short drag springs back.
     (Only the head: the body scrolls.) The sheet follows the finger; its entrance animation is switched off for good once it
     has been dragged, or it would run again when the drag ends. */
  let drag = null
  document.addEventListener('pointerdown', (e) => {
    const head = e.target.closest && e.target.closest('.sheet-head')
    if (!head || e.button > 0 || e.target.closest('button, a, input, select, textarea')) return
    drag = { id: e.pointerId, y: e.clientY, sheet: head.closest('.sheet'), dy: 0, on: false }
  })
  document.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return
    drag.dy = Math.max(0, e.clientY - drag.y)
    if (!drag.on && drag.dy < 8) return
    drag.on = true
    drag.sheet.classList.add('dragged')
    drag.sheet.style.transition = 'none'
    drag.sheet.style.transform = 'translateY(' + drag.dy + 'px)'
  })
  const dragEnd = (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const d = drag
    drag = null
    if (!d.on) return
    const close = e.type === 'pointerup' && d.dy > 80 && d.sheet.isConnected && sheetIsOpen()
    const still = root.dataset.movimiento === 'ninguno'
    d.sheet.style.transition = still ? 'none' : 'transform 160ms ' + (close ? 'ease-in' : 'ease-out')
    d.sheet.style.transform = close ? 'translateY(100%)' : ''
    if (close) { guard(GUARD_CLOSE + 160, { at: { x: e.clientX, y: e.clientY } }); setTimeout(closeSheet, still ? 0 : 160) } else setTimeout(() => { d.sheet.style.transition = '' }, 200)
  }
  document.addEventListener('pointerup', dragEnd)
  document.addEventListener('pointercancel', dragEnd)
  document.addEventListener('input', (e) => {
    const t = e.target
    if (t.id === 'deck-q') { ui.deckQuery = t.value; paintDecks(); paintChipCounts('deck-filter', DECK_CHIPS, deckMatches()) }
    if (t.id === 'col-q') { ui.colQuery = t.value; paintCol() }
    if (t.id === 'search-q') { LZ.q = t.value; launcherPaint() }
    if (t.id === 'm-rival') {
      /* one line of text, whatever is pasted or dictated: a line break becomes a space */
      if (/[\r\n]/.test(t.value)) t.value = t.value.replace(/\s*[\r\n]+\s*/g, ' ')
      M.rival = t.value
      M.rivalPicked = false
      $('#rival-area').innerHTML = rivalArea()
      const x = $('.rival-clear')
      if (x) x.hidden = !t.value
      const was = t.offsetHeight
      fitRival()
      /* the field took another line while it is being typed in: it stays whole above the foot of the sheet */
      const body = t.offsetHeight > was ? t.closest('.sheet-body') : null
      if (body) { const over = t.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom + 6; if (over > 0) body.scrollTop += over }
      sheetMore()
    }
    if (t.id === 'm-note') M.note = t.value
  })
  /* the rival field never takes a line break (a keyboard whose Enter does not come as a key: it comes as this) */
  document.addEventListener('beforeinput', (e) => { if (e.target.id === 'm-rival' && (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph')) e.preventDefault() })
  document.addEventListener('change', (e) => {
    const t = e.target
    if (t.id === 'm-mode') M.mode = t.value
  })
  let leftByEnter = null      // the field that Enter took the focus from (touch: it closes the keyboard), until the focus is somewhere again
  document.addEventListener('focusin', () => { leftByEnter = null })
  document.addEventListener('keydown', (e) => {
    const layer = $('#capa-hoja')
    const open = !layer.hidden
    const t = e.target
    const is = (sel) => Boolean(t.matches && t.matches(sel))
    if (e.key === 'Escape' && open) { e.preventDefault(); if (!e.repeat) closeSheet(); return }
    /* Enter or Space held down: it presses once. Otherwise «Guardar partida» and then «Deshacer», which takes its place, would
       fire one after the other for as long as the key is down. (Only on a control: in a field a held space still writes spaces,
       and on the page it still scrolls.) */
    if (e.repeat && (e.key === 'Enter' || e.key === ' ') && t.closest && t.closest('button, a[href], [role="button"]')) { e.preventDefault(); return }
    if (t.id === 'search-q' && !e.isComposing) {
      /* the launcher: the field keeps the focus, the arrows move the highlight and Enter runs it */
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const row = launcherHi(LZ.hi + (e.key === 'ArrowDown' ? 1 : -1)); if (row) row.scrollIntoView({ block: 'nearest' }); return }
      if (e.key === 'Enter') { e.preventDefault(); const row = $('#search-results .hi'); if (row && !e.repeat) row.click(); return }
    }
    /* Enter in a field never saves. On a touch screen it closes the keyboard of the phone (the field lets go of the focus); with
       a real keyboard there is nothing to close and the focus stays in the field, so Tab goes on from it. */
    if (e.key === 'Enter' && is('input, #m-rival')) { e.preventDefault(); if (coarse.matches) { leftByEnter = t; t.blur() } return }
    if (e.key === '/' && !open && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) { e.preventDefault(); showSheet('hoja=buscar&q='); return }
    if (e.key === 'Tab' && open) {
      /* the focus stays inside the sheet */
      const items = $$('a[href], button, input, select, textarea, [tabindex="0"]', layer).filter((x) => !x.disabled && x.tabIndex >= 0 && x.offsetParent !== null)
      if (!items.length) { e.preventDefault(); return }
      const active = document.activeElement
      const at = items.indexOf(active)
      /* the focus is not in the sheet at all (a tap on a dead spot left it on <body>): Tab enters the sheet, it never walks the page
         under it. When it was Enter in a field of the sheet that left it there (a touch screen with a keyboard attached), Tab
         goes on from that field, as it does on a page. */
      if (!layer.contains(active)) {
        e.preventDefault()
        const from = leftByEnter && layer.contains(leftByEnter) ? items.indexOf(leftByEnter) : -1
        leftByEnter = null
        if (from >= 0) items[(from + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus()
        else items[e.shiftKey ? items.length - 1 : 0].focus()
        return
      }
      if (at < 0) {
        /* the focus is in the sheet on something that is no stop of Tab (the title, which takes it when the sheet opens): Tab goes
           on from where it is, in the order of the document, and turns round only past the first or the last stop */
        const next = items.findIndex((x) => active.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING)
        e.preventDefault()
        if (e.shiftKey) items[((next < 0 ? items.length : next) - 1 + items.length) % items.length].focus()
        else items[next < 0 ? 0 : next].focus()
        return
      }
      if (e.shiftKey && at === 0) { e.preventDefault(); items[items.length - 1].focus() } else if (!e.shiftKey && at === items.length - 1) { e.preventDefault(); items[0].focus() }
      return
    }
    const horizontal = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
    if (is('[role="tab"]') && (horizontal || e.key === 'Home' || e.key === 'End')) {
      const tabs = $$('[role="tab"]', t.parentNode)
      const at = tabs.indexOf(t)
      const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : tabs[(at + horizontal + tabs.length) % tabs.length]
      e.preventDefault()
      next.focus()
      next.click()
      return
    }
    /* a group of radios is one stop of Tab; the arrows move inside it and choose (the pattern of a radio group). What is not
       a choice of the mock-up («Otro…», an option the system forbids) only takes the focus. */
    const step = horizontal || { ArrowDown: 1, ArrowUp: -1 }[e.key]
    if (is('[role="radio"]') && step) {
      const radios = $$('[role="radio"]', t.closest('[role="radiogroup"]') || t.parentNode)
      const next = radios[(radios.indexOf(t) + step + radios.length) % radios.length]
      e.preventDefault()
      const key = next.dataset.f
      next.focus()
      if (next.dataset.a !== 'static' && next.getAttribute('aria-disabled') !== 'true' && next.getAttribute('aria-checked') !== 'true') {
        next.click()
        /* the group was drawn again: the focus follows the option just chosen */
        const again = key && $('[data-f="' + key + '"]')
        if (again && document.activeElement !== again) again.focus({ preventScroll: true })
      }
    }
  })
  /* One stop of Tab per group of radios: the chosen one (or the first, when none is) is the one Tab reaches. Run after anything
     that draws radios. */
  function roveGroup(g, stop) {
    const radios = $$('[role="radio"]', g)
    const at = stop ? radios.indexOf(stop) : Math.max(0, radios.findIndex((r) => r.getAttribute('aria-checked') === 'true'))
    radios.forEach((r, i) => { r.tabIndex = i === at ? 0 : -1 })
  }
  function rove(scope) {
    $$('[role="radiogroup"]', scope || document).forEach((g) => {
      /* drawn again around the focus (the option just chosen): the stop stays where the focus is */
      const on = document.activeElement
      roveGroup(g, on && on.matches && on.matches('[role="radio"]') && g.contains(on) ? on : null)
    })
  }
  /* While the focus is inside a group, its stop of Tab is the radio that has the focus — also one that only took it (what is no
     choice of the mock-up, an option the system forbids; with the arrows or with a click): Tab and Shift+Tab then leave the
     group from there, forwards and backwards, instead of landing on the chosen radio of the same group. When the focus leaves
     the group, the stop goes back to the chosen one. */
  document.addEventListener('focusin', (e) => {
    const r = e.target
    const g = r.matches && r.matches('[role="radio"]') ? r.closest('[role="radiogroup"]') : null
    if (g) roveGroup(g, r)
  })
  document.addEventListener('focusout', (e) => {
    const g = e.target.closest ? e.target.closest('[role="radiogroup"]') : null
    if (g && !(e.relatedTarget && g.contains(e.relatedTarget))) roveGroup(g)
  })
  /* A touch keyboard shrinks the viewport (interactive-widget=resizes-content): while it is up, the bottom bars step aside.
     A keyboard is up only while a text field has the focus: a window that gets shorter with no field focused (split screen with
     the game, a pop-up view) keeps its bars. «kbBase» is how tall the window was when the field took the focus. */
  const coarse = window.matchMedia ? matchMedia('(pointer: coarse)') : { matches: false }
  const isTextField = (el) => Boolean(el && el.matches && el.matches('input, textarea') && !el.readOnly && !el.disabled)
  let kbBase = null
  let lastWidth = window.innerWidth
  function syncTyping() {
    if (!coarse.matches || !isTextField(document.activeElement)) { kbBase = null; root.classList.remove('typing'); return }
    if (kbBase == null || window.innerHeight > kbBase) kbBase = window.innerHeight
    root.classList.toggle('typing', window.innerHeight < kbBase - 140)
  }
  document.addEventListener('focusin', syncTyping)
  /* the focus that goes from one field to another keeps the keyboard up: only leaving the fields puts the bars back */
  document.addEventListener('focusout', (e) => { if (!isTextField(e.relatedTarget)) { kbBase = null; root.classList.remove('typing') } })
  window.addEventListener('resize', () => {
    /* another width is another screen (the phone turned): what the height was before says nothing now */
    if (window.innerWidth !== lastWidth) { lastWidth = window.innerWidth; kbBase = null }
    syncTyping()
    fitRival()
    sheetMore()
    syncTop()
    fitTiles()
  })
  /* the header changes its height (a deck name that takes two lines, a font that arrives late): the sticky tabs follow it */
  if (window.ResizeObserver) new ResizeObserver(syncTop).observe($('#encabezado'))
  /* scroll does not bubble: listened on the way down */
  document.addEventListener('scroll', (e) => { if (e.target.classList && (e.target.classList.contains('sheet-body') || e.target.classList.contains('search-body'))) sheetMore() }, true)
  window.addEventListener('hashchange', render)
  /* A step through the history that does not change the address. This page's own controls never leave two entries in a row
     with the same address (a view takes the place of its entry; a sheet that cannot open is stepped out of), but an address
     written by hand still can: an unknown one becomes «Hoy» right after «Hoy», a sheet that came with the address is closed
     onto its page, a view typed after another one is changed back. A step between two such entries fires «popstate» and no
     «hashchange»: nothing is drawn, «atrás» looked dead, and the page stopped recording its place (the entry that is open was
     no longer the one it knew). So: the entry that is open now is taken as the one on screen, and the step goes on, the same
     way, to the entry the person meant — the next one with another address. Which way is told by the place of the two entries
     («i»); when it cannot be told, when there is no entry further on, or when the step before this one was already such a jump
     the other way round (two places that disagree: it would go to and fro), it stays here. */
  let lastJump = null         // { dir, at }: the jump just made over an entry with the same address
  window.addEventListener('popstate', () => {
    const st = history.state
    /* another address: «hashchange» comes right after and draws it */
    if (location.href !== lastHref) { lastJump = null; return }
    if (!current || !st || st.t == null || st.t === current.t) return
    const nav = navIndex()
    const i = nav != null ? nav : typeof st.i === 'number' ? st.i : null
    const dir = i != null && current.i != null && i !== current.i ? (i < current.i ? -1 : 1) : 0
    current.t = st.t
    current.i = i
    const now = performance.now()
    const back = lastJump && now - lastJump.at < 1500 && lastJump.dir === -dir
    if (dir && !back) { lastJump = { dir: dir, at: now }; history.go(dir); return }
    lastJump = null
    /* it stays: this entry learns where its page is */
    rememberScroll()
  })
  /* an image did not load (its own «onerror» marks it; the event does not bubble, so it is caught on its way down): the tile
     that takes its place is measured once it is drawn */
  document.addEventListener('error', (e) => {
    const art = e.target && e.target.tagName === 'IMG' && e.target.closest ? e.target.closest('.art') : null
    if (art) requestAnimationFrame(() => fitTiles(art))
  }, true)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fitTiles(); fitRival(); sheetMore() })
  /* where the screen that is open is, kept up to date: in memory at once (whatever comes next finds it), and in its history
     entry a moment after the page stops moving (writing the history on every scroll event would flood it) */
  window.addEventListener('scroll', () => {
    if (!current) return
    const y = Math.round(window.scrollY)
    scrollMem[current.path] = y
    if (current.t != null) yMem[current.t] = y
    clearTimeout(yTimer)
    yTimer = setTimeout(rememberScroll, 140)
  }, { passive: true })
  /* leaving the document (a reload, another page) or going to the background: the entry gets where the page is right now, also
     when that comes right after a scroll («beforeunload» is the last moment the browser still takes it for a reload) */
  window.addEventListener('beforeunload', rememberScroll)
  window.addEventListener('pagehide', rememberScroll)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') rememberScroll() })
  /* the system changed its theme or asked for less motion (or stopped asking): the page follows, and the Menu, if it is the
     screen that is open (under a sheet too), says what holds now — the level that is on, its line, the options that can be chosen */
  const systemChanged = () => {
    applyPrefs()
    if (!current || current.path !== '/menu') return
    const key = document.activeElement && document.activeElement.dataset && $('#principal').contains(document.activeElement) ? document.activeElement.dataset.f : null
    repaint()
    const again = key && $('#principal [data-f="' + key + '"]')
    if (again) again.focus({ preventScroll: true })
  }
  if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', systemChanged)
  if (lightScheme.addEventListener) lightScheme.addEventListener('change', systemChanged)

  prefsFromUrl(parseHash().params)
  applyPrefs()
  render()
})()
