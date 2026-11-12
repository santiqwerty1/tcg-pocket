/* Maqueta B · «El mazo al centro». Plain JavaScript: a hash router, one render function per screen and one sheet layer.
   Everything it shows comes from window.DATOS (../datos.js); nothing is invented. */
(function () {
  'use strict'
  const D = window.DATOS
  const root = document.documentElement
  const $ = (sel, el) => (el || document).querySelector(sel)
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel))
  const NB = ' '

  /* ───────────── Formatting ───────────── */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })
  const nf1 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const nf2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const num = (v) => nf.format(v)
  /* percentages always carry one decimal, so a column of them lines up («50,0 %» under «56,3 %») */
  const pct = (v) => nf1.format(v) + NB + '%'
  const nTxt = (n) => 'n' + NB + '=' + NB + nf.format(n)
  const ciTxt = (ci) => 'IC' + NB + '95' + NB + '%: ' + nf1.format(ci[0]) + '–' + nf1.format(ci[1]) + NB + '%'
  const ciShort = (ci) => 'IC' + NB + nf1.format(ci[0]) + '–' + nf1.format(ci[1])
  const recTxt = (r) => num(r.v) + NB + 'V · ' + num(r.d) + NB + 'D' + (r.e ? ' · ' + num(r.e) + NB + 'E' : '')
  /* points and trends carry one decimal too, like the percentages («+2,0» over «−1,6») */
  const signed = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + nf1.format(Math.abs(v))
  /* running text: a hyphenated name («Mega-Sceptile») never breaks at its hyphen (a word joiner after it); never used for attributes */
  const run = (s) => esc(s).replace(/-(?=\p{L})/gu, '-\u2060')
  const plain = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
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
  }
  const gem = (e, cls) => '<span class="gem ' + (cls || '') + '" data-e="' + e + '" role="img" aria-label="' + esc((D.energias[e] || {}).nombre || e) + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + (GLYPH[e] || GLYPH.colorless) + '</svg></span>'
  const gems = (list, cls) => '<span class="gems">' + list.map((e) => gem(e, cls)).join('') + '</span>'
  const acc = (list) => '--acc:var(--e-' + list[0] + ');' + (list[1] ? '--acc2:var(--e-' + list[1] + ');' : '')
  const dn = (name) => { const at = name.lastIndexOf(' / '); return at < 0 ? run(name) : run(name.slice(0, at)) + ' / <span class="nb">' + esc(name.slice(at + 3)) + '</span>' }
  const energyNames = (list) => list.map((e) => D.energias[e].nombre).join(' y ')

  /* ───────────── Thumbnails ───────────── */
  const imgTag = (src, alt) => '<img src="' + esc(src) + '" alt="' + esc(alt || '') + '" loading="lazy" decoding="async" width="63" height="88" onerror="this.parentNode.classList.add(\'failed\')">'
  const thumb = (src, name, type, cls) => '<span class="thumb ' + (cls || '') + '" data-e="' + (type || 'none') + '">' + imgTag(src, '') + '<span class="thumb-name">' + esc(name) + '</span></span>'
  const crop = (src, name, type, mode) => '<span class="crop ' + (mode || 'tall') + '" data-e="' + (type || 'none') + '">' + imgTag(src, name) + '<span class="thumb-name" aria-hidden="true">' + esc(name) + '</span></span>'
  /* the strip of crops; if an image fails, one tile on the type colour takes its place (first name, or just the glyph in narrow rows) */
  const art = (deck, max) => '<span class="art" data-e="' + (deck.miniaturasDe[0].tipo || 'none') + '">' + deck.miniaturas.slice(0, max || 3).map((src, i) => crop(src, deck.miniaturasDe[i].nombre, deck.miniaturasDe[i].tipo)).join('') +
    '<span class="art-fb" aria-hidden="true"><svg viewBox="0 0 24 24">' + (GLYPH[deck.miniaturasDe[0].tipo] || GLYPH.colorless) + '</svg><span>' + esc(deck.miniaturasDe[0].nombre) + '</span></span></span>'
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
      '<rect x="15" y="63" width="40" height="15" rx="7.5" fill="#fff" opacity=".9"/></svg><span class="pack-code">' + esc(code) + '</span></span>'
  }
  packArt.n = 0

  /* ───────────── Small charts and marks ───────────── */
  const ORI = '<i class="ori" role="img" aria-label="orientativo"></i>'
  const COV = '<i class="cov" role="img" aria-label="sin cruces con datos en el meta"></i>'
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
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc('Cuota en cinco ventanas de 3 días: ' + series.map(pct).join(', ')) + '">' +
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
  function sourceBlock(icon, name, s, extra) {
    const head = '<span class="source-name">' + (icon ? ico(icon, 16) : '') + name + '</span>'
    if (!s) return '<div class="source"><div class="source-head">' + head + '<span class="nd">sin datos</span></div></div>'
    return '<div class="source"><div class="source-head">' + head + '<span class="source-val">' + pct(s.pct) + '<small>' + nTxt(s.n) + '</small></span></div>' + icBar(s.pct, s.ci) +
      '<div class="source-foot">' + ciTxt(s.ci) + (s.record ? ' · ' + recTxt(s.record) : '') + (s.orientativo ? ' · orientativo: menos de 30 partidas' : '') + (extra || '') + '</div></div>'
  }
  const changeTags = (list) => '<div class="changes">' + list.map((c) => '<span class="tag ' + (/^\+/.test(c) ? 'plus' : 'minus') + '">' + esc(c) + '</span>').join('') + '</div>'
  const streak = (r, fresh) => '<span class="streak" role="img" aria-label="Últimas ' + r.length + ': ' + r.join(' ') + '">' + r.map((x, i) => '<i class="dot ' + x.toLowerCase() + (i === r.length - 1 ? ' last' + (fresh ? ' new' : '') : '') + '"></i>').join('') + '</span>'
  const distBar = (r) => '<span class="dist" aria-hidden="true">' + ['v', 'd', 'e'].map((k) => (r[k] ? '<i class="' + k + '" style="flex:' + r[k] + '"></i>' : '')).join('') + '</span>'

  /* ───────────── State ───────────── */
  /* Two layers. «saved» is what the menu (Aspecto) chose and is the only thing written to localStorage. «fromUrl» holds the
     parameters tema / movimiento / vistas for this load only: a link without parameters always opens as saved (dark and dock
     below when nothing was chosen). */
  const STORE = 'maquetaB.aspecto.v2'
  const saved = { tema: 'oscuro', movimiento: 'expresivo', vistas: 'abajo', miniaturas: 'si' }
  try { Object.assign(saved, JSON.parse(localStorage.getItem(STORE) || '{}')) } catch (e) { /* file:// without storage */ }
  const fromUrl = {}
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
    try { localStorage.setItem(STORE, JSON.stringify(saved)) } catch (e) { /* ignore */ }
    applyPrefs()
  }
  const OPTIONS = { tema: ['oscuro', 'claro', 'sistema'], movimiento: ['expresivo', 'sutil', 'ninguno'], vistas: ['abajo', 'arriba'] }
  function prefsFromUrl(params) {
    let changed = false
    Object.keys(OPTIONS).forEach((k) => { if (params[k] && OPTIONS[k].indexOf(params[k]) >= 0 && pref(k) !== params[k]) { fromUrl[k] = params[k]; changed = true } })
    if (changed) applyPrefs()
    return changed
  }

  const ui = { pickSort: 'torneo', deckSort: 'ultima', deckFilter: 'todos', deckQuery: '', listMode: 'lista', jobFilter: 'todas', metaSort: 'cuota', colFilter: 'todas', colQuery: '', open: new Set() }
  const session = {}
  D.hoy.mazosSesion.forEach((m) => { session[m.id] = { hoy: Object.assign({}, m.hoy), racha: m.racha.slice(), fresh: false } })
  const day = Object.assign({}, D.hoy.record)
  const deckInfo = (id) => D.hoy.mazosSesion.find((m) => m.id === id) || D.hoy.mazosDelDia.find((m) => m.id === id) || D.mazos.find((m) => m.id === id)
  const deckLabel = (id) => { const m = D.mazos.find((x) => x.id === id); return m ? '#' + m.id + ' ' + m.nombre : '#' + id }
  const CARDS = {}
  ;[].concat(D.mazo.cartas.pokemon, D.mazo.cartas.entrenadores, D.buscar.cartas, D.cartas.coleccion.muestra).forEach((c) => { CARDS[c.id] = Object.assign({}, CARDS[c.id], c) })

  /* ───────────── Screens ───────────── */
  const sec = (title, aux) => '<div class="sec"><h2>' + title + '</h2>' + (aux ? '<span class="aux">' + aux + '</span>' : '') + '</div>'

  /* Hoy */
  function deckCard(m) {
    const s = session[m.id]
    return '<article class="deck-card" style="' + acc(m.energias) + '">' +
      '<a class="deck-head" href="#/mazo/' + m.id + '" aria-label="Abrir el mazo ' + m.id + ', ' + esc(m.nombre) + '">' + gems(m.energias) +
      '<span class="deck-name"><span class="deck-num">#' + m.id + '</span> ' + dn(m.nombre) + '</span>' + art(m) + '</a>' +
      '<div class="deck-foot"><div class="deck-today"><span>Hoy ' + recTxt(s.hoy) + '</span>' + streak(s.racha, s.fresh) + '</div>' +
      /* shape + letter: the same V / D / E of «Hoy 0 V · 5 D» next to it, with air to spare at 360 px and with any font */
      '<div class="vde letters" role="group" aria-label="Registrar una partida con el mazo ' + m.id + '">' +
      ['v', 'd', 'e'].map((r) => '<button class="vde-btn ' + r + '" data-a="match-open" data-deck="' + m.id + '" data-res="' + r + '" aria-label="' + RES[r] + ' con el mazo ' + m.id + '">' + shape(r, 13) + '<b aria-hidden="true">' + RES[r].charAt(0) + '</b></button>').join('') +
      '</div></div></article>'
  }
  const dayRec = () => 'Hoy ' + recTxt(day)
  const SOURCE = { torneo: 'Torneo', mias: 'Mías', laboratorio: 'Lab' }
  const SOURCE_LONG = { torneo: 'torneo', mias: 'mis partidas', laboratorio: 'laboratorio' }
  function pickTable() {
    const key = ui.pickSort
    const rows = D.hoy.mazosDelDia.slice().sort((a, b) => (b[key] ? b[key].pct : -1) - (a[key] ? a[key].pct : -1))
    const cell = (m, k) => {
      const s = m[k]
      const on = k === key ? ' on' : ''
      if (!s) return '<span class="cell' + on + '"><span class="nd">sin datos</span></span>'
      return '<span class="cell' + on + '"><b data-count="' + s.pct + '">' + pct(s.pct) + '</b><span class="n">' + nTxt(s.n) + (s.orientativo ? ORI : '') + (k === 'torneo' && s.cobertura === 0 ? COV : '') + '</span></span>'
    }
    const row = (m) => {
      const k = 'pick-' + m.id
      const open = ui.open.has(k)
      return '<li><button class="pick-grid pick-row" style="' + acc(m.energias) + '" data-a="toggle" data-k="' + k + '" aria-expanded="' + open + '" aria-controls="' + k + '">' +
        '<span class="pick-name"><span class="deck-num">#' + m.id + '</span> ' + dn(m.nombre) + '</span>' + cell(m, 'torneo') + cell(m, 'mias') + cell(m, 'laboratorio') + '</button>' +
        '<div class="detail" id="' + k + '"' + (open ? '' : ' hidden') + '>' +
        sourceBlock('trophy', 'Torneo: contra el meta', m.torneo, m.torneo ? ' · cruces con datos: ' + pct(m.torneo.cobertura) + ' del meta' : '') +
        sourceBlock('person', 'Mis partidas', m.mias) +
        sourceBlock('bot', 'Laboratorio: bots ' + (m.laboratorio ? m.laboratorio.bot : ''), m.laboratorio) +
        '<p class="fine">Récord: solo en «Mis partidas». Los datos de la maqueta no lo traen para Torneo ni para Laboratorio.</p>' +
        '<div class="pick-foot">' + art(m) + '<a class="btn" href="#/mazo/' + m.id + '">Abrir #' + m.id + '</a></div></div></li>'
    }
    const k = 'pick-nota'
    return '<section class="holo pick" id="pick" aria-labelledby="pick-h"><div class="pick-grid pick-head"><h2 class="pick-title" id="pick-h">¿Cuál llevo?</h2>' +
      '<div class="pick-sort" role="group" aria-label="Ordenar los tres mazos por fuente">' +
      Object.keys(SOURCE).map((s) => '<button data-a="pick-sort" data-v="' + s + '" aria-pressed="' + (s === key) + '" aria-label="Ordenar por ' + SOURCE_LONG[s] + (s === key ? ': es el orden actual, de mayor a menor' : '') + '">' + SOURCE[s] + '<i class="sort-arrow" aria-hidden="true"></i></button>').join('') +
      '</div></div><ul>' + rows.map(row).join('') + '</ul>' +
      '<p class="legend"><span><i class="sort-arrow on" aria-hidden="true"></i>ordena: tocá otra columna</span><span>' + ORI + 'orientativo: n' + NB + '&lt;' + NB + '30</span><span>' + COV + 'sin cruces con datos</span></p>' +
      '<button class="linkrow" style="border-top:1px solid var(--line)" data-a="toggle" data-k="' + k + '" aria-expanded="' + ui.open.has(k) + '" aria-controls="' + k + '"><span>Los 3 mejores, sin ganador: qué es cada número</span><span class="chev">' + ico('down', 18) + '</span></button>' +
      '<div class="detail" id="' + k + '"' + (ui.open.has(k) ? '' : ' hidden') + '><p class="note">' + esc(D.hoy.mazosDelDiaNota) + '</p><p class="fine">' + esc(D.hoy.mazosDelDiaMeta) + '.</p></div></section>'
  }
  const PEND_ICON = { turno: 'play', clasificar: 'tag', situaciones: 'target', simulacion: 'cpu', laboratorio: 'flask', promo: 'gift', evento: 'calendar' }
  const DUE = { promo: 'Promo', evento: 'Evento' }
  /* Pendientes: what has a deadline first; four on the page and the rest one tap away, like the last matches. */
  const PEND_SHOWN = 4
  function pendList() {
    const all = D.hoy.pendientes.slice().sort((a, b) => (DUE[b.tipo] ? 1 : 0) - (DUE[a.tipo] ? 1 : 0))
    const open = ui.open.has('pend') || all.length <= PEND_SHOWN + 1
    /* a destination that is this same screen would be a dead tap: it says what the app opens instead */
    const row = (p) => {
      const inner = '<span class="pend-ico">' + ico(PEND_ICON[p.tipo] || 'info', 20) + '</span><span><span class="pend-t" style="display:block">' + run(p.texto) + '</span><span class="pend-d" style="display:block">' + run(p.detalle) + '</span></span>'
      return p.destino === '#/hoy'
        ? '<li><button class="pend" data-a="static" data-msg="En la app abre «' + esc(p.detalle.split(':')[0]) + '». La maqueta no trae esa pantalla.">' + inner + '</button></li>'
        : '<li><a class="pend' + (DUE[p.tipo] ? ' due' : '') + '" href="' + esc(p.destino) + '">' + inner + '</a></li>'
    }
    return '<ul class="card rows">' + (open ? all : all.slice(0, PEND_SHOWN)).map(row).join('') +
      (open ? '' : '<li><button class="linkrow" data-a="pend-more" aria-expanded="false" aria-controls="pend"><span>Ver los ' + all.length + ' pendientes</span><span class="chev">' + ico('down', 18) + '</span></button></li>') + '</ul>'
  }
  function viewHoy() {
    const h = D.hoy
    const v = D.cartas.sobres.veredicto
    /* what has a deadline goes above everything, in one line: the label and what the text says after its last colon */
    const dues = h.pendientes.filter((p) => DUE[p.tipo])
    const chip = (href, icon, label, value, aria, cls) => '<a class="due-chip' + (cls || '') + '" href="' + esc(href) + '" aria-label="' + esc(aria) + '"><span class="label">' + ico(icon, 14) + '<span>' + label + '</span></span><b>' + esc(value) + '</b></a>'
    /* …and the pack to open goes with them, so the first screen already answers «qué sobre abrir»; its reason is in the row under the table */
    const dueStrip = '<nav class="dues" aria-label="Para hoy: lo que tiene plazo y el sobre que conviene abrir">' + dues.map((p) => chip(p.destino, PEND_ICON[p.tipo], DUE[p.tipo], p.texto.slice(p.texto.lastIndexOf(': ') + 2), p.texto)).join('') +
      chip('#/cartas', 'cards', 'Abrir', h.sobre.nombre, 'Conviene abrir el sobre ' + h.sobre.nombre + '. Abre Sobres', ' advice') + '</nav>'
    const news = (kind, a) => '<a class="card news-tile" href="#/meta" aria-label="' + esc((kind === 'sube' ? 'Sube' : 'Baja') + ': ' + a.nombre + ', ' + signed(a.delta) + ' puntos de cuota; ahora ' + pct(a.cuota) + ' del meta. Abre Meta') + '">' +
      '<span class="label">' + ico(kind === 'sube' ? 'up' : 'downtrend', 16) + (kind === 'sube' ? 'Sube' : 'Baja') + (a.nuevo ? ' · nuevo' : '') + '</span>' +
      '<span class="news-name">' + esc(a.nombre) + '</span><span class="news-row"><span class="news-delta">' + signed(a.delta) + '<small>pts</small></span>' + spark(a.serie, 54, 26) + '</span>' +
      '<span class="news-now">ahora ' + pct(a.cuota) + ' del meta</span></a>'
    const w = h.semana
    /* the short reason: up to «y tiene…», without the parenthesis; the whole one is in Sobres */
    const why = h.sobre.porque.split(' y tiene ')[0].replace(/\s*\([^)]*\)/g, '').replace(/[.:]$/, '') + '.'
    return dueStrip + '<div class="mesa-head"><h2 class="label">En la mesa</h2><span class="mesa-sub">los ' + h.mazosSesion.length + ' que venís jugando</span><span class="mesa-rec" id="day-rec">' + dayRec() + '</span></div>' +
      '<div class="mesa" id="mesa">' + h.mazosSesion.map(deckCard).join('') + '</div>' + pickTable() +
      '<a class="holo shine pack-row" href="#/cartas" aria-label="' + esc('Sobre recomendado: ' + h.sobre.nombre + '. ' + h.sobre.porque + ' Abre Sobres') + '">' + packArt(v.expansionId) +
      '<span class="pack-row-main"><span class="kicker h">Conviene abrir</span><span class="pack-row-name">' + esc(h.sobre.nombre) + ' <span class="deck-num">· ' + esc(v.expansionId) + '</span></span><span class="pack-row-why">' + run(why) + '</span></span>' +
      '<span class="pack-row-go">ver' + CHEV + '</span></a>' +
      sec('Pendientes', h.pendientes.length + ' · con plazo primero') +
      '<div id="pend">' + pendList() + '</div>' +
      sec('Se mueve el meta', 'puntos de cuota · ' + h.meta.dias + ' días') +
      '<div class="news">' + news('sube', h.meta.sube) + news('baja', h.meta.baja) + '</div>' +
      sec('Cómo venís') +
      '<section class="card standing"><div class="standing-top"><div><div class="label">Hoy</div><div class="stat-big" style="margin-top:6px">' + day.v + '<small>V</small> ' + day.d + '<small>D</small>' + (day.e ? ' ' + day.e + '<small>E</small>' : '') + '</div>' +
      '<div style="margin-top:9px">' + distBar(day).replace('class="dist"', 'class="dist" style="height:8px"') + '</div><div class="stat-cap">' + (day.v + day.d + day.e) + ' partidas</div></div>' +
      '<div><div class="label">Semana ' + esc(w.etiqueta) + '</div><div class="stat-big" style="margin-top:6px">' + pct(w.pct) + '</div><div style="margin-top:7px">' + icBar(w.pct, w.ci) + '</div>' +
      '<div class="stat-cap">' + nTxt(w.n) + (w.orientativo ? ORI + ' orientativo' : '') + ' · ' + recTxt(w) + '<br>' + ciTxt(w.ci) + '</div></div></div>' +
      '<p class="fine">La semana anterior: ' + esc(w.anterior.texto) + ', ' + recTxt(w.anterior) + '.</p>' +
      '<div class="rank"><span class="rank-ico">' + ico('medal', 22) + '</span><div><div class="row-title">' + esc(h.rango) + '</div><div class="row-sub">' + esc(h.temporada) + '. ' + (h.temporadaVigente ? '' : 'Es el último rango anotado. ') + esc(h.proximaTemporada) + '.</div></div></div></section>' +
      sec('Últimas partidas', h.ultimasPartidas.length + ' de hoy') + '<div id="games">' + gamesList() + '</div>' +
      '<p class="demo-note">' + ico('info', 16) + '<span>' + esc(D.aviso) + '.</span></p>'
  }
  /* The last matches: three on the page, the rest of today's one tap away (the page is long enough as it is). */
  const GAMES_SHOWN = 3
  function gamesList() {
    const all = D.hoy.ultimasPartidas
    const open = ui.open.has('games') || all.length <= GAMES_SHOWN
    const row = (g) => {
      const r = RES_KEY[g.resultado]
      return '<li><button class="game"data-a="static" data-msg="En la app abre la partida para corregirla o borrarla."><span class="res ' + r + '" role="img" aria-label="' + g.resultado + '">' + r.toUpperCase() + '</span><span><span class="row-title"><span class="deck-num">#' + g.mazoId + '</span> ' + dn(g.mazo) + '</span><span class="game-sub">contra ' + run(g.rival) + ' · <span class="nb">' + esc(g.cuando) + '</span> · ' + esc(g.modalidad) + ' · <span class="nb">' + (g.empezo === 'yo' ? 'empecé yo' : 'empezó el rival') + '</span></span></span></button></li>'
    }
    return '<ul class="card rows">' + (open ? all : all.slice(0, GAMES_SHOWN)).map(row).join('') +
      (open ? '' : '<li><button class="linkrow" data-a="games-more" aria-expanded="false" aria-controls="games"><span>Ver las ' + all.length + ' de hoy</span><span class="chev">' + ico('down', 18) + '</span></button></li>') + '</ul>'
  }

  /* Mazos */
  const DECK_SORTS = [['ultima', 'Últimos jugados'], ['pct', '% de mis partidas'], ['numero', 'Número'], ['nombre', 'Nombre']]
  function deckList() {
    const q = plain(ui.deckQuery.trim())
    let list = D.mazos.filter((m) => !q || plain('#' + m.id + ' ' + m.nombre).indexOf(q) >= 0 || String(m.id) === q.replace('#', ''))
    if (ui.deckFilter === 'jugados') list = list.filter((m) => m.mias)
    if (ui.deckFilter === 'falta') list = list.filter((m) => !m.completo)
    const by = {
      ultima: (a, b) => (b.ultima || '').localeCompare(a.ultima || '') || (b.mias ? b.mias.n : 0) - (a.mias ? a.mias.n : 0) || a.id - b.id,
      pct: (a, b) => (b.mias ? b.mias.pct : -1) - (a.mias ? a.mias.pct : -1) || a.id - b.id,
      numero: (a, b) => a.id - b.id,
      nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
    }
    list = list.slice().sort(by[ui.deckSort])
    if (!list.length) return '<div class="card empty">Ningún mazo coincide con «' + esc(ui.deckQuery) + '».</div>'
    return '<ul class="card rows">' + list.map((m) => '<li><a class="deck-row" href="#/mazo/' + m.id + '" style="' + acc(m.energias) + '">' + art(m, 2) +
      '<span class="deck-row-main"><span class="deck-name" style="display:block"><span class="deck-num">#' + m.id + '</span> ' + dn(m.nombre) + '</span><span class="deck-row-sub">' + gems(m.energias, 'sm') +
      '<span>' + (m.ultima ? 'jugado ' + dayTxt(m.ultima) : 'sin partidas') + '</span>' + (m.completo ? '' : '<span class="tag warn">falta ' + m.falta + '</span>') + '</span></span>' +
      '<span class="row-end">' + (m.mias ? '<b>' + pct(m.mias.pct) + '</b><span>' + nTxt(m.mias.n) + (m.mias.orientativo ? ORI : '') + '</span>' : '<span class="nd">sin datos</span>') + '</span></a></li>').join('') + '</ul>' +
      '<p class="legend" style="padding:10px 2px 0"><span>' + ORI + 'orientativo: menos de 30 partidas</span><span>El porcentaje es de tus partidas con cada mazo.</span></p>'
  }
  function viewMazos() {
    const counts = { todos: D.mazos.length, jugados: D.mazos.filter((m) => m.mias).length, falta: D.mazos.filter((m) => !m.completo).length }
    const chips = [['todos', 'Todos'], ['jugados', 'Con partidas'], ['falta', 'Incompletos']]
    return '<div class="filters"><div class="filters-line"><input class="field" type="search" id="deck-q" placeholder="Filtrar mazos" aria-label="Filtrar mazos por nombre o número" value="' + esc(ui.deckQuery) + '" autocomplete="off" enterkeyhint="done">' +
      '<select class="field" id="deck-sort" aria-label="Ordenar los mazos">' + DECK_SORTS.map((o) => '<option value="' + o[0] + '"' + (o[0] === ui.deckSort ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>' +
      '<div class="chipline" role="group" aria-label="Filtros">' + chips.map((c) => '<button class="chip" data-a="deck-filter" data-v="' + c[0] + '" aria-pressed="' + (ui.deckFilter === c[0]) + '">' + c[1] + ' <span class="count">' + counts[c[0]] + '</span></button>').join('') + '</div></div>' +
      '<div id="deck-list">' + deckList() + '</div>'
  }

  /* Ficha del mazo */
  const VISTAS = [['lista', 'Lista'], ['rinde', 'Rinde'], ['mejorar', 'Mejorar'], ['notas', 'Notas']]
  function tablist(items, active, cls, label, controls) {
    return '<div class="' + cls + '" role="tablist" aria-label="' + label + '">' + items.map((it) => '<button class="dock-tab" role="tab" id="tab-' + it[0] + '" aria-selected="' + (it[0] === active) + '" aria-controls="' + (controls || 'principal') + '" tabindex="' + (it[0] === active ? 0 : -1) + '" data-a="tab" data-href="' + it[2] + '">' + it[1] + '</button>').join('') + '</div>'
  }
  const deckTabs = (id) => VISTAS.map((v) => [v[0], v[1], '#/mazo/' + id + (v[0] === 'lista' ? '' : '/' + v[0])])
  /* one source in the header: %, n and the interval as text (a bar this narrow cannot be read); what each one is, in Rinde */
  function triCell(label, s, more) {
    return '<span class="triad-cell"><span class="label">' + label + '</span>' + (s ? '<b data-count="' + s.pct + '">' + pct(s.pct) + '</b><span class="n">' + nTxt(s.n) + (s.orientativo ? ORI : '') + '</span><span class="n">' + (more || ciShort(s.ci)) + '</span>' : '<span class="nd" style="margin-top:6px">sin datos</span>') + '</span>'
  }
  function viewMazo(id, vista) {
    const base = D.mazos.find((m) => m.id === id)
    const full = D.mazo.id === id ? D.mazo : null
    const pics = deckInfo(id)
    const fanCls = pics.miniaturas.length >= 3 ? '' : pics.miniaturas.length === 2 ? ' two' : ' one'
    let hero = '<section class="hero spine" style="' + acc(base.energias) + '"><div class="hero-top"><div class="hero-id"><div class="hero-kicker">' + gems(base.energias) + '<span>#' + id + ' · ' + esc(energyNames(base.energias)) + (full ? ' · rev. ' + full.revision : '') + '</span></div>' +
      '<h1 class="hero-name">' + dn(base.nombre) + '</h1>' + (full ? '' : '<div class="hero-meta">' + (base.completo ? 'lo tenés completo' : 'te falta ' + base.falta) + (base.ultima ? ' · jugado ' + dayTxt(base.ultima) : '') + '</div>') + '</div>' +
      '<div class="fan' + fanCls + '" aria-hidden="true">' + pics.miniaturas.slice(0, 3).map((src, i) => thumb(src, pics.miniaturasDe[i].nombre, pics.miniaturasDe[i].tipo)).join('') + '</div></div>'
    if (!full) {
      hero += '<div class="triad" style="grid-template-columns:1fr">' + triCell('Mis partidas', base.mias, base.mias ? ciTxt(base.mias.ci) + ' · ' + recTxt(base.mias.record) : '') + '</div>' +
        '<div class="hero-actions" style="grid-template-columns:1fr"><button class="btn primary" data-a="match-open" data-deck="' + id + '">' + ico('plus', 16) + 'Registrar partida con este mazo</button></div></section>'
      return hero + '<section class="card pad"><p class="note">La maqueta trae la ficha completa (lista, cómo rinde, qué mejorar y notas) solo del mazo #' + D.mazo.id + '. De este se muestra lo que hay en los datos compartidos.</p><a class="btn" style="margin-top:12px" href="#/mazo/' + D.mazo.id + '">Abrir ' + esc(deckLabel(D.mazo.id)) + '</a></section>'
    }
    const r = full.rinde
    hero += '<a class="triad" href="#/mazo/' + id + '/rinde" data-a="tab" data-href="#/mazo/' + id + '/rinde" aria-label="' + esc('Tres fuentes, nunca mezcladas. Mis partidas: ' + pct(r.mias.pct) + ', ' + nTxt(r.mias.n) + '. Torneo, ' + r.torneo.etiqueta.toLowerCase() + ': ' + pct(r.torneo.pct) + ', ' + nTxt(r.torneo.n) + '. Simulación con bots ' + r.simulacion.bot + ': ' + pct(r.simulacion.pct) + ', ' + nTxt(r.simulacion.n) + '. Abre Rinde') + '">' +
      triCell('Mías', r.mias) + triCell('Torneo', r.torneo) + triCell('Bots', r.simulacion) + '</a>' +
      '<a class="notes-teaser" href="#/mazo/' + id + '/notas" data-a="tab" data-href="#/mazo/' + id + '/notas"><span class="nt-text">' + run(full.notasCortas) + '</span><span class="more">ver más</span></a>' +
      '<div class="hero-actions"><button class="btn primary" data-a="match-open" data-deck="' + id + '">Registrar partida</button>' +
      '<button class="btn" data-a="launch" data-q="meta" data-deck="' + id + '" aria-label="Probar contra el meta" title="Probar contra el meta">' + ico('trophy', 16) + 'Probar</button><button class="btn" data-a="launch" data-q="cambio" data-deck="' + id + '" aria-label="Buscar mejoras" title="Buscar mejoras">' + ico('flask', 16) + 'Mejoras</button></div></section>'
    /* «arriba»: the tabs go right under the header, before the deck header, so they are on top without scrolling */
    return topTabs(deckTabs(id), vista, 'Vistas del mazo', 'panel') + hero + '<div class="panel enter" id="panel" role="tabpanel" aria-labelledby="tab-' + vista + '" style="' + acc(base.energias) + '">' + deckPanel(full, vista) + '</div>'
  }
  function deckPanel(m, vista) {
    if (vista === 'rinde') return panelRinde(m)
    if (vista === 'mejorar') return panelMejorar(m)
    if (vista === 'notas') return panelNotas(m)
    return panelLista(m)
  }
  function panelLista(m) {
    const f = m.falta
    const total = (list) => list.reduce((a, c) => a + c.cant, 0)
    const row = (c) => '<li><button class="card-row" data-a="card" data-c="' + esc(c.id) + '"><span class="qty' + (c.cant === 1 ? ' one' : '') + '">' + c.cant + '</span>' + thumb(c.imagen, c.nombre, c.tipo) +
      '<span><span class="row-title">' + esc(c.nombre) + '</span><span class="row-sub">' + esc(c.clase) + ' · <span class="code">' + esc(c.id) + '</span></span></span>' +
      '<span class="row-end">' + (c.puntos ? '<span class="tag">da ' + c.puntos + (c.puntos === 1 ? ' pt' : ' pts') + '</span>' : '') + '</span></button></li>'
    const cell = (c) => '<button class="grid-card" data-a="card" data-c="' + esc(c.id) + '" aria-label="' + c.cant + ' ' + esc(c.nombre) + '">' + (c.cant > 1 ? '<span class="x2">×' + c.cant + '</span>' : '') + thumb(c.imagen, c.nombre, c.tipo) + '<span class="gname">' + esc(c.nombre) + '</span></button>'
    const toggle = '<div class="seg" role="group" aria-label="Cómo ver la lista"><button data-a="list-mode" data-v="lista" aria-pressed="' + (ui.listMode === 'lista') + '" aria-label="Ver como lista">' + ico('list', 18) + '</button><button data-a="list-mode" data-v="grilla" aria-pressed="' + (ui.listMode === 'grilla') + '" aria-label="Ver como grilla">' + ico('grid', 18) + '</button></div>'
    const group = (title, list, first) => '<section class="card rows"><div class="group-head"><h3>' + title + ' <span>' + total(list) + ' cartas</span></h3>' + (first ? toggle : '') + '</div>' +
      (ui.listMode === 'grilla' ? '<div class="cards-grid">' + list.map(cell).join('') + '</div>' : '<ul>' + list.map(row).join('') + '</ul>') + '</section>'
    const need = (label, n) => '<span class="need-item' + (n ? ' miss' : '') + '">' + (n ? '' : ico('check', 16)) + '<span>' + label + ': <b>' + (n === 0 ? 'no falta nada' : n === 1 ? 'falta 1' : 'faltan ' + n) + '</b></span></span>'
    return '<a class="card need" href="#/cartas" aria-label="Qué te falta conseguir; abre Sobres">' + need('Tu lista', f.tuLista.n) + need('Versión de torneo', f.torneo.n) + CHEV + '</a>' +
      group('Pokémon', m.cartas.pokemon, true) + group('Entrenadores', m.cartas.entrenadores)
  }
  function lane(icon, name, s, extra, note) {
    return '<div class="lane"><div class="lane-head"><span class="lane-name">' + ico(icon, 18) + '<span>' + name + '</span></span><span class="lane-pct" data-count="' + s.pct + '">' + pct(s.pct) + '</span></div>' + icBar(s.pct, s.ci) +
      '<div class="lane-foot"><span>' + nTxt(s.n) + (extra ? ' ' + extra : '') + ' · ' + ciTxt(s.ci) + '</span><span>' + recTxt(s.record) + (s.orientativo ? ' · <span class="tag warn">orientativo</span>' : '') + '</span>' + (note ? '<span class="fine">' + esc(note) + '</span>' : '') + '</div></div>'
  }
  function panelRinde(m) {
    const r = m.rinde
    const cells = r.porRival.reduce((a, x) => a.concat([x.mias, x.torneo]), []).filter(Boolean)
    /* when every cell is «orientativo» the mark on each one is noise: it is said once, in the legend */
    const allOri = cells.length > 0 && cells.every((s) => s.orientativo)
    const rtCell = (s) => (s ? '<span class="rt-cell"><b>' + pct(s.pct) + '</b><span class="n">' + nTxt(s.n) + (s.orientativo && !allOri ? ORI : '') + '</span>' + divBar(s.pct) + '</span>' : '<span class="rt-cell"><span class="nd">sin datos</span></span>')
    const rival = (x, i) => {
      const k = 'rv-' + i
      const open = ui.open.has(k)
      return '<li><button class="rt-grid rt-row" data-a="toggle" data-k="' + k + '" aria-expanded="' + open + '" aria-controls="' + k + '"><span class="rt-name">' + esc(x.rival) + '<small>' + pct(x.cuota) + ' del meta</small></span>' + rtCell(x.mias) + rtCell(x.torneo) + '</button>' +
        '<div class="detail" id="' + k + '"' + (open ? '' : ' hidden') + '>' + sourceBlock('person', 'Vos contra él', x.mias) + sourceBlock('trophy', 'En torneos', x.torneo) + '</div></li>'
    }
    const THIN = 5
    const running = (c) => { const d = (Date.parse(D.hoy.fecha) - Date.parse(c.semana)) / 86400000; return d >= 0 && d < 7 }
    const cols = r.curva.map((c) => '<div class="col' + (c.n < THIN ? ' thin' : '') + (running(c) ? ' now' : '') + '"><b>' + pct(c.pct) + '</b><i style="height:calc((100% - 20px) * ' + c.pct / 100 + ')"></i><span class="x">' + shortDate(c.semana) + '<br>' + nTxt(c.n) + '</span></div>').join('')
    const e = r.empezar
    return sec('Tres fuentes', 'nunca se mezclan') +
      '<section class="card">' + lane('person', 'Mis partidas', r.mias) +
      r.torneo.filas.map((f, i) => lane('trophy', 'Torneo · ' + esc(f.etiqueta), f, 'en ' + f.listas + ' listas', i === r.torneo.filas.length - 1 ? r.torneo.nota : '')).join('') +
      lane('bot', 'Simulación · bots ' + esc(r.simulacion.bot), r.simulacion, '', r.simulacion.nota) + '</section>' +
      sec('Contra cada rival', 'por cuota del meta') +
      '<section class="card rows"><div class="rt-grid rt-head"><span>Rival</span><span>Vos</span><span>Torneo</span></div><ul>' + r.porRival.map(rival).join('') + '</ul>' +
      '<p class="legend" style="padding:10px 14px 12px;border-top:1px solid var(--line)"><span>' + ORI + (allOri ? 'Todo orientativo: ningún cruce llega a 30 partidas.' : 'orientativo: n' + NB + '&lt;' + NB + '30') + '</span><span>La barra marca la distancia a 50' + NB + '%. Tocá una fila: IC y récord.</span></p></section>' +
      sec('Semana a semana', 'tus partidas') +
      '<section class="card pad"><div class="cols" role="img" aria-label="' + esc('Porcentaje de victorias por semana: ' + r.curva.map((c) => shortDate(c.semana) + ' ' + pct(c.pct) + ' (' + nTxt(c.n) + ')').join('; ')) + '"><i class="half" style="bottom:84px"></i>' + cols + '</div>' +
      '<p class="legend" style="margin-top:8px"><span><i class="key now"></i>semana en curso</span><span><i class="key thin"></i>menos de ' + THIN + ' partidas</span><span><i class="key half"></i>50' + NB + '%</span></p>' +
      '<p class="fine" style="margin-top:4px">Cada columna es una semana; empieza el lunes indicado.</p></section>' +
      sec('¿Importa empezar?') +
      '<section class="card pad pair">' + sourceBlock('', 'Empezando', e.primero) + sourceBlock('', 'Yendo segundo', e.segundo) + '<p class="note">' + esc(e.texto) + '</p></section>'
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
      const btn = q.destino ? '<a class="btn" href="' + esc(q.destino) + '">' + esc(q.accion) + '</a>' : '<button class="btn" data-a="static">' + esc(q.accion) + '</button>'
      return '<section class="card q-card"><h3>' + esc(q.pregunta) + '</h3><p class="q-answer">' + run(q.respuesta) + '</p>' + (i === 0 ? changeTags(m.falta.torneo.cambios) : '') + chart + '<p class="note">' + run(q.detalle) + '</p>' + btn + '</section>'
    }
    const launch = { meta: 'trophy', cambio: 'flask', versus: 'vs', turno: 'clock' }
    return m.mejorar.map(card).join('') + sec('Lanzar una prueba', 'con este mazo') +
      '<div class="launch">' + D.pruebas.preguntas.map((p) => '<button class="btn" data-a="launch" data-q="' + p.id + '" data-deck="' + m.id + '">' + ico(launch[p.id], 18) + '<span>' + esc(p.titulo) + '</span></button>').join('') + '</div>'
  }
  function panelNotas(m) {
    return '<section class="card pad"><ul class="bullets">' + m.notas.map((n) => '<li>' + run(n) + '</li>').join('') + '</ul><button class="btn" style="margin-top:14px" data-a="static">' + ico('pencil', 16) + 'Editar las notas</button></section>' +
      sec('Revisiones y cambios', 'la más nueva primero') +
      '<section class="card timeline">' + m.revisiones.map((r) => '<div class="rev"><div class="rev-head"><b>Rev. ' + r.n + '</b><span>' + shortDate(r.fecha) + ' · ' + esc(r.origen) + '</span></div>' +
        (r.nota ? '<p class="note">' + esc(r.nota) + '</p>' : '<p class="fine">Sin nota.</p>') + (r.cambios ? changeTags(r.cambios.map((c) => c.replace(/^([+−-])\s+/, '$1' + NB))) : '') + '</div>').join('') + '</section>'
  }

  /* Cartas: Sobres */
  const CARTAS_TABS = [['sobres', 'Sobres', '#/cartas'], ['coleccion', 'Colección', '#/cartas/coleccion']]
  const topTabs = (tabs, active, label, controls) => (pref('vistas') === 'arriba' ? '<div class="tabs-bar">' + tablist(tabs, active, 'tabs-top', label, controls) + '</div>' : '')
  function viewSobres() {
    const s = D.cartas.sobres
    const v = s.veredicto
    const deckOf = (ref) => { const id = Number(String(ref).replace('#', '')); return D.mazos.some((m) => m.id === id) ? deckLabel(id) : String(ref) }
    const alt = (a, i) => {
      const k = 'alt-' + i
      const open = ui.open.has(k)
      return '<li><button class="alt" data-a="toggle" data-k="' + k + '" aria-expanded="' + open + '" aria-controls="' + k + '"><span><span class="row-title">' + esc(a.nombre) + ' <span class="deck-num">· ' + esc(a.expansionId) + '</span></span><span class="row-sub">' + run(a.motivo) + '</span></span>' +
        '<span class="alt-score"><b>' + pct(a.numeros.alMenosUna) + '</b><span class="hbar"><i style="width:' + a.numeros.alMenosUna + '%"></i></span><span class="alt-pts">puntaje ' + nf2.format(a.numeros.puntaje) + '</span></span></button>' +
        '<div class="detail" id="' + k + '"' + (open ? '' : ' hidden') + '><dl class="kv"><dt>Al menos una buscada por sobre</dt><dd>' + pct(a.numeros.alMenosUna) + '</dd><dt>Cartas buscadas por sobre</dt><dd>' + nf2.format(a.numeros.buscadas) + '</dd><dt>Sobres para 50' + NB + '% / 90' + NB + '%</dt><dd>' + a.numeros.sobres50 + ' / ' + a.numeros.sobres90 + '</dd><dt>Expansión</dt><dd>' + esc(a.expansion) + '</dd></dl></div></li>'
    }
    const miss = (c) => '<li class="miss">' + thumb(c.imagen, c.carta, c.tipo) + '<div><div class="row-title">' + esc(c.carta) + '</div><div class="row-sub">para ' + run(c.mazos.map(deckOf).join(' y ')) + ' · ' + esc(c.sobre) + '</div>' +
      '<div class="miss-tags"><span class="tag' + (c.consejo === 'comprar' ? ' ok' : '') + '">' + esc(c.consejo) + (c.consejo === 'comprar' ? ' · ' + num(c.puntos) + ' pts' : ' sobres') + '</span>' + (c.consejo === 'comprar' ? '' : '<span class="miss-alt">comprarla: ' + num(c.puntos) + ' pts</span>') + '</div></div>' +
      '<div class="miss-need">×' + c.falta + '<small>' + (c.falta === 1 ? 'falta' : 'faltan') + '</small></div></li>'
    return topTabs(CARTAS_TABS, 'sobres', 'Vistas de Cartas') +
      '<section class="holo shine verdict-pack" aria-labelledby="vp-h"><div class="vp-top">' + packArt(v.expansionId) + '<div><div class="kicker h">Conviene abrir</div><h2 class="big-name" id="vp-h">' + esc(v.nombre) + '</h2>' +
      '<div class="fine">' + esc(v.expansion) + ' · ' + esc(v.expansionId) + '</div><div class="vp-hit"><span class="vp-stat"><b data-count="' + v.numeros.alMenosUna + '">' + pct(v.numeros.alMenosUna) + '</b><span>al menos una por sobre</span></span><span class="vp-stat"><b>' + nf2.format(v.numeros.puntaje) + '</b><span>puntaje</span></span></div></div></div>' +
      '<ul class="why">' + v.porque.map((p) => '<li>' + run(p) + '</li>').join('') + '</ul>' +
      '<a class="linkrow" href="#/cartas?detalle=sobre"><span>Ver los números</span>' + CHEV + '</a></section>' +
      sec('Alternativas', 'al menos una · puntaje') +
      '<section class="card rows"><ul>' + s.alternativas.map(alt).join('') + '</ul></section>' +
      '<button class="card goals" data-a="sheet" data-s="objetivos"><span class="goals-text"><b>Buscás</b>' + esc(s.objetivos) + '</span><span class="edit">' + ico('pencil', 16) + 'Editar</span></button>' +
      sec('Con plazo') +
      '<section class="card due-card"><span class="due-ico">' + ico('gift', 22) + '</span><div><div class="due-head"><b>Sobres de promoción</b><span class="tag warn">quedan ' + esc(s.promo.quedan) + ' · hasta el ' + shortDate(s.promo.vence) + '</span></div><p class="note" style="margin-top:6px">' + run(s.promo.texto) + '</p></div></section>' +
      '<section class="card due-card"><span class="due-ico" style="color:var(--tx2);background:var(--s3)">' + ico('tag', 22) + '</span><div><div class="due-head"><b>Cupón ★★</b><span class="tag">vence el ' + shortDate(s.cupon.vence) + '</span></div><p class="note" style="margin-top:6px">' + esc(s.cupon.texto) + '</p></div></section>' +
      sec('Cartas que faltan', s.faltan.length + ' de ' + s.faltanTotal) +
      '<section class="card rows"><ul>' + s.faltan.map(miss).join('') + '</ul><button class="linkrow" style="border-top:1px solid var(--line)" data-a="static"><span>Ver las ' + s.faltanTotal + '</span>' + CHEV + '</button></section>' +
      sec('Por mazo', 'las dos respuestas') +
      '<section class="card rows"><ul>' + s.porMazo.map((m) => '<li><a class="bydeck" href="#/mazo/' + m.id + '"><span><span class="row-title"><span class="deck-num">#' + m.id + '</span> ' + dn(m.nombre) + '</span><span class="row-sub">completo en unos ' + m.dias + ' días</span></span>' +
        '<span class="bydeck-nums"><span>tu lista</span><b>falta ' + m.tuLista + '</b><span>torneo</span><b>faltan ' + m.torneo + '</b></span></a></li>').join('') + '</ul></section>'
  }

  /* Cartas: Colección */
  function colList() {
    const c = D.cartas.coleccion
    const q = plain(ui.colQuery.trim())
    let list = c.muestra.filter((x) => !q || plain(x.nombre + ' ' + x.id).indexOf(q) >= 0)
    if (ui.colFilter === 'tengo') list = list.filter((x) => x.copias > 0)
    if (ui.colFilter === 'faltan') list = list.filter((x) => x.copias === 0)
    if (!list.length) return '<div class="card empty">Nada en la muestra con ese filtro.</div>'
    return '<section class="card rows"><ul>' + list.map((x) => '<li><button class="col-row' + (x.copias ? '' : ' missing') + '" data-a="card" data-c="' + esc(x.id) + '">' + thumb(x.imagen, x.nombre, x.tipo) +
      '<span><span class="row-title">' + esc(x.nombre) + '</span><span class="row-sub"><span class="code">' + esc(x.id) + '</span> · ' + x.ediciones + (x.ediciones === 1 ? ' edición' : ' ediciones') + '</span></span>' +
      '<span class="row-end"><b>' + (x.copias ? '×' + x.copias : '0') + '</b><span>' + (x.copias ? 'copias jugables' : 'te falta') + '</span><span class="pips" aria-hidden="true"><i class="' + (x.copias > 0 ? 'on' : '') + '"></i><i class="' + (x.copias > 1 ? 'on' : '') + '"></i></span></span></button></li>').join('') + '</ul></section>'
  }
  function viewColeccion() {
    const c = D.cartas.coleccion
    const one = c.cartasConUna - c.cartasConDos
    const filters = [['todas', 'Todas'], ['tengo', 'Tengo'], ['faltan', 'Me faltan']]
    return topTabs(CARTAS_TABS, 'coleccion', 'Vistas de Cartas') +
      '<section class="card sync"><div class="sync-top"><span class="sync-ico" id="sync-ico">' + ico('sync', 22) + '</span><div><div class="row-title">Sincronizada ' + esc(c.ultimaSyncTexto) + '</div><div class="row-sub">' + esc(c.fuente) + ' · entraron ' + c.ultimaSyncCambios.copias + ' copias y ' + c.ultimaSyncCambios.nuevas + ' carta nueva</div></div></div>' +
      '<div class="sync-actions"><button class="btn primary big" data-a="sync">' + ico('sync', 20) + 'Sincronizar con el juego</button><button class="btn" data-a="static">Tracker al día</button><button class="btn" data-a="sheet" data-s="coleccion">Más acciones</button></div></section>' +
      '<section class="card summary"><div class="summary-top"><div><span class="label">Tenés</span><div class="stat-big" style="margin-top:4px"><span data-count="' + c.cartasConUna + '" data-unit="">' + num(c.cartasConUna) + '</span><small>de ' + num(c.cartasConUna + c.faltantes) + ' cartas</small></div></div><span class="summary-copies"><b>' + num(c.copias) + '</b> copias</span></div>' +
      '<div class="dist" role="img" aria-label="' + esc(num(c.cartasConDos) + ' cartas con dos o más copias, ' + num(one) + ' con una sola y ' + num(c.faltantes) + ' que faltan') + '"><i class="two" style="flex:' + c.cartasConDos + '"></i><i class="one" style="flex:' + one + '"></i><i class="zero" style="flex:' + c.faltantes + '"></i></div>' +
      '<div class="keys"><div><b><i style="background:var(--tx)"></i>' + num(c.cartasConDos) + '</b>con 2 o más</div><div><b><i style="background:var(--tx3)"></i>' + num(one) + '</b>con una sola</div><div><b><i style="box-shadow:inset 0 0 0 1.5px var(--ctl-line)"></i>' + num(c.faltantes) + '</b>te faltan</div></div></section>' +
      '<div class="filters"><input class="field" type="search" id="col-q" placeholder="Buscar: nombre o código" aria-label="Buscar en la colección" value="' + esc(ui.colQuery) + '" autocomplete="off" enterkeyhint="done">' +
      '<div class="seg" role="group" aria-label="Qué mostrar">' + filters.map((f) => '<button data-a="col-filter" data-v="' + f[0] + '" aria-pressed="' + (ui.colFilter === f[0]) + '">' + f[1] + '</button>').join('') + '</div></div>' +
      '<div class="listbar" style="margin-top:16px"><span class="label">' + esc(c.expansionMuestra) + '</span><span class="fine">muestra de ' + c.muestra.length + ' cartas</span></div>' +
      '<div id="col-list" style="margin-top:8px">' + colList() + '</div>'
  }

  /* Pruebas */
  const PRUEBAS_TABS = [['pruebas', 'Pruebas', '#/pruebas'], ['practicar', 'Practicar', '#/pruebas/practicar'], ['motor', 'Motor', '#/pruebas/motor']]
  const Q_ICON = { meta: 'trophy', cambio: 'flask', versus: 'vs', turno: 'clock' }
  const Q_SHORT = { meta: 'Meta', cambio: 'Cambio', versus: 'Versus', turno: 'Turno' }
  const STATE = { 'en cola': ['wait', 'en cola'], corriendo: ['run', 'corriendo'], cancelada: ['off', 'cancelada'], terminada: ['done', 'terminada'], 'falló': ['fail', 'falló'] }
  function jobRow(j) {
    const st = STATE[j.estado] || ['off', j.estado]
    const inner = '<span class="job-top"><span class="state ' + st[0] + '"><i></i>' + esc(st[1]) + '</span><span class="job-kind"><span class="nb">#' + j.id + ' · ' + esc(j.tipo) + '</span> · <span class="nb">' + esc(j.cuando) + '</span></span></span>' +
      '<span class="job-name">' + run(j.nombre) + '</span>' +
      (j.progreso ? '<span class="job-prog"><span class="prog"><i style="width:' + j.progreso.pct + '%"></i></span><span>' + num(j.progreso.hechas) + ' de ' + num(j.progreso.total) + ' · ' + pct(j.progreso.pct) + '</span></span>' : '') +
      '<span class="job-result' + (j.resultado ? '' : ' none') + '">' + (j.resultado ? run(j.resultado) : 'Sin resultado: ' + (j.estado === 'cancelada' ? 'se canceló.' : 'todavía no terminó.')) + '</span>'
    return j.id === D.pruebas.resultado.id ? '<li><a class="job" href="#/pruebas/resultado/' + j.id + '">' + inner + '</a></li>' : '<li><button class="job" data-a="static" data-msg="La maqueta trae el detalle solo de la búsqueda #' + D.pruebas.resultado.id + '.">' + inner + '</button></li>'
  }
  function jobList() {
    const list = D.pruebas.trabajos.filter((j) => ui.jobFilter === 'todas' || j.pregunta === ui.jobFilter)
    return '<ul class="card rows">' + list.map(jobRow).join('') + '</ul>'
  }
  function viewPruebas(sub) {
    const p = D.pruebas
    const head = topTabs(PRUEBAS_TABS, sub || 'pruebas', 'Vistas de Pruebas')
    if (sub === 'practicar') {
      return head + '<section class="holo live"><div class="kicker h">Partida en curso</div><p class="q-answer">' + run(p.practicar.enCurso) + '</p><button class="btn primary" data-a="static">' + ico('play', 16) + 'Seguir la partida</button></section>' +
        '<ul class="card rows"><li><button class="row" data-a="static"><span class="menu-ico">' + ico('target', 20) + '</span><span class="row-main"><span class="row-title">Situaciones para resolver</span><span class="row-sub">Tus errores de las partidas con entrenador</span></span><span class="row-end"><b>' + p.practicar.situaciones + '</b><span>pendientes</span></span></button></li>' +
        '<li><button class="row" data-a="static"><span class="menu-ico">' + ico('grid', 20) + '</span><span class="row-main"><span class="row-title">Ejercicios de cálculo</span><span class="row-sub">Robo y daño para KO</span></span><span class="row-end"><b>' + p.practicar.ejerciciosHoy + '</b><span>hoy</span></span></button></li>' +
        '<li><button class="row" data-a="static"><span class="menu-ico">' + ico('bot', 20) + '</span><span class="row-main"><span class="row-title">Nueva partida contra el bot</span><span class="row-sub">Contra un mazo tuyo o una lista de torneo</span></span>' + CHEV + '</button></li></ul>'
    }
    if (sub === 'motor') {
      const m = p.motor
      const bank = p.preguntas[0].bajada.slice(p.preguntas[0].bajada.indexOf(': ') + 2)
      const bankText = bank.charAt(0).toUpperCase() + bank.slice(1).replace(/\.$/, '')
      return head + '<section class="card facts"><div class="fact"><span class="label">Worker</span><b>' + esc(m.worker) + '</b><span class="state done" style="margin-top:6px"><i></i>' + esc(m.estado) + '</span></div>' +
        '<div class="fact"><span class="label">Núcleos</span><b>' + m.nucleos + '</b><span class="fine">en uso para simular</span></div>' +
        '<div class="fact"><span class="label">Cola</span><b>' + m.cola + ' tandas</b><span class="fine">de partidas esperando</span></div>' +
        '<div class="fact"><span class="label">Trabajos</span><b>' + m.colaTrabajos + ' activos</b><span class="fine">ahora corre el #' + m.trabajoActual + '</span></div></section>' +
        '<p class="demo-note">' + ico('cpu', 16) + '<span>Worker ' + esc(m.version) + ' · motor ' + esc(m.motor) + '.</span></p>' +
        '<ul class="card rows">' + [['Calibración', 'Compara los bots contra los torneos'], ['Análisis', 'Tiempos, partidas y uso del motor'], ['Banco del meta', bankText]].map((r) => '<li><button class="row" data-a="static"><span class="row-main"><span class="row-title">' + r[0] + '</span><span class="row-sub">' + r[1] + '</span></span>' + CHEV + '</button></li>').join('') + '</ul>'
    }
    const count = (id) => p.trabajos.filter((j) => j.pregunta === id).length
    const filters = [['todas', 'Todas']].concat(p.preguntas.map((q) => [q.id, Q_SHORT[q.id]]))
    return head + '<div class="q-grid">' + p.preguntas.map((q) => '<button class="card q-tile" data-a="launch" data-q="' + q.id + '"><span class="q-tile-top"><span class="q-tile-ico">' + ico(Q_ICON[q.id], 18) + '</span><span class="q-tile-foot">' + count(q.id) + (count(q.id) === 1 ? ' trabajo' : ' trabajos') + ico('plus', 18) + '</span></span>' +
      '<span class="q-tile-title">' + esc(q.titulo) + '</span></button>').join('') + '</div>' +
      sec('Trabajos', 'qué dio cada uno') +
      '<div class="seg" role="group" aria-label="Filtrar los trabajos por pregunta">' + filters.map((f) => '<button data-a="job-filter" data-v="' + f[0] + '" aria-pressed="' + (ui.jobFilter === f[0]) + '">' + f[1] + '</button>').join('') + '</div>' +
      '<div id="job-list">' + jobList() + '</div>'
  }

  /* Un resultado */
  function viewResultado() {
    const r = D.pruebas.resultado
    const z = { min: 40, max: 70, noMid: true }
    const effect = (e) => {
      const mt = /(entra|sale): ([+−-])(\d+(?:,\d+)?) puntos \((\d+) variantes\)/.exec(e.efecto)
      if (!mt) return '<li class="effect"><span class="row-title">' + esc(e.carta) + '</span><span></span><span class="fine">' + esc(e.efecto) + '</span></li>'
      const val = (mt[2] === '+' ? 1 : -1) * parseFloat(mt[3].replace(',', '.'))
      return '<li class="effect"><span><span class="row-title">' + (mt[1] === 'entra' ? 'Poner ' : 'Sacar ') + esc(e.carta) + '</span><span class="row-sub">en ' + mt[4] + ' variantes</span></span>' + divBar(val, 0, 3) + '<b>' + signed(val) + '</b></li>'
    }
    const variant = (v, i) => {
      const k = 'var-' + i
      const open = ui.open.has(k)
      return '<li><button class="var-row zoom" data-a="toggle" data-k="' + k + '" aria-expanded="' + open + '" aria-controls="' + k + '"><span class="vn">' + esc(v.nombre) + '</span>' + icBar(v.pct, v.ci, { min: 40, max: 70, noMid: true, ref: r.base.pct }) +
        '<span class="var-val"><b>' + pct(v.pct) + '</b><small>' + nTxt(v.n) + '</small></span><span class="chev">' + ico('down', 18) + '</span></button>' +
        '<div class="detail" id="' + k + '"' + (open ? '' : ' hidden') + '><p class="fine">' + ciTxt(v.ci) + ' · ' + v.cambios.length + ' cambios sobre tu lista</p>' + changeTags(v.cambios) + '</div></li>'
    }
    return '<section class="holo shine res-hero"><div><div class="kicker h">¿Qué le cambio? · búsqueda #' + r.id + '</div><h1 class="big-name" style="font-size:24px;margin-top:4px">' + esc(r.titulo) + '</h1>' +
      '<a class="fine" style="display:inline-flex;align-items:center;min-height:44px;text-decoration:underline;text-underline-offset:3px" href="#/mazo/' + r.mazoId + '">sobre ' + esc(deckLabel(r.mazoId)) + '</a></div>' +
      '<div class="gain"><b data-count="' + r.diferencia.pts + '" data-unit="" data-signed>' + signed(r.diferencia.pts) + '</b><span>puntos contra el meta<br>IC' + NB + '95' + NB + '%: ' + signed(r.diferencia.ci[0]) + ' a ' + signed(r.diferencia.ci[1]) + '</span></div>' +
      '<div class="duo zoom"><div class="duo-row"><span class="who">Tu lista</span>' + icBar(r.base.pct, r.base.ci, z) + '<b>' + pct(r.base.pct) + '</b></div>' +
      '<div class="duo-row best"><span class="who">La mejor</span>' + icBar(r.mejor.pct, r.mejor.ci, { min: 40, max: 70, noMid: true, ref: r.base.pct }) + '<b>' + pct(r.mejor.pct) + '</b></div>' +
      '<div class="icscale" style="margin:-4px 74px 0 96px"><span>40' + NB + '%</span><span>55' + NB + '%</span><span>70' + NB + '%</span></div></div>' +
      '<p class="note">' + esc(r.veredicto) + '</p><div><div class="label" style="margin-bottom:6px">Los cambios de la mejor</div>' + changeTags(r.mejor.cambios) + '</div>' +
      '<p class="fine"><span class="tag ok">' + (r.robusto ? 'robusto' : 'sensible al bot') + '</span> ' + esc(r.robustoTexto.replace(/^robusto: /, '')) + ' · novedad: ' + esc(r.mejor.novedad) + ' · ' + nTxt(r.mejor.n) + ' por lista</p>' +
      '<div class="sync-actions"><button class="btn primary" data-a="static">Actualizar el mazo #' + r.mazoId + '</button><button class="btn" data-a="static">Guardar como mazo nuevo</button></div></section>' +
      sec('Qué pesa cada carta', 'puntos') +
      '<section class="card rows"><ul>' + r.porCarta.map(effect).join('') + '</ul></section>' +
      sec('Otras variantes', 'escala 40–70' + NB + '%') +
      '<section class="card rows"><ul>' + r.variantes.map(variant).join('') + '</ul><p class="legend" style="padding:10px 14px 12px;border-top:1px solid var(--line)"><span><i class="refmark"></i>tu lista: ' + pct(r.base.pct) + '</span><span>Tocá una fila: IC y cambios.</span></p></section>' +
      sec('Cómo se hizo') +
      '<section class="card facts"><div class="fact"><span class="label">Partidas</span><b>' + num(r.partidas) + '</b></div><div class="fact"><span class="label">Rondas</span><b>' + r.rondas + '</b><span class="fine">' + esc(r.fin) + '</span></div>' +
      '<div class="fact"><span class="label">Bot</span><b>' + esc(r.bot) + '</b></div><div class="fact"><span class="label">Contra</span><b style="font-size:17px">' + esc(r.contra) + '</b></div></section>' +
      '<p class="demo-note">' + ico('bot', 16) + '<span>' + esc(r.nota) + '</span></p>'
  }

  /* Meta */
  const trendTxt = (a) => (a.tendencia > 0 ? '▲' : a.tendencia < 0 ? '▼' : '') + NB + nf1.format(Math.abs(a.tendencia))
  function archList() {
    const m = D.meta
    const maxShare = Math.max.apply(null, m.arquetipos.map((a) => a.cuota))
    const by = { cuota: (a, b) => b.cuota - a.cuota, pct: (a, b) => b.pct - a.pct, tendencia: (a, b) => b.tendencia - a.tendencia }
    return '<section class="card rows"><ul>' + m.arquetipos.slice().sort(by[ui.metaSort]).map((a) => {
      const k = 'ar-' + a.id
      const open = ui.open.has(k)
      return '<li><button class="arch" style="' + acc(a.energias) + '" data-a="toggle" data-k="' + k + '" aria-expanded="' + open + '" aria-controls="' + k + '">' +
        '<span class="arch-name">' + gems(a.energias, 'sm') + '<span>' + esc(a.nombre) + '</span></span><span class="arch-sub"><span>gana ' + pct(a.pct) + ' · ' + nTxt(a.n) + (a.orientativo ? ORI : '') + '</span><span class="tag ok">' + esc(a.tengo) + '</span></span>' +
        '<span class="arch-trend">' + spark(a.serie) + '<span' + (a.tendenciaClara ? ' style="color:var(--tx);font-weight:700"' : ' style="color:var(--tx3)"') + '>' + trendTxt(a) + '</span></span>' +
        '<span class="arch-share"><b>' + pct(a.cuota) + '</b><span>del meta</span></span><span class="arch-bar"><i style="width:' + (a.cuota / maxShare) * 100 + '%"></i></span></button>' +
        '<div class="detail" id="' + k + '"' + (open ? '' : ' hidden') + '>' + sourceBlock('trophy', 'En torneos', a) +
        '<dl class="kv"><dt>En listas</dt><dd>' + num(a.enListas) + '</dd><dt class="wide">Cuota por ventana de 3 días</dt><dd class="wide">' + a.serie.map((v) => nf1.format(v)).join(' · ') + NB + '%</dd><dt class="wide">Tendencia en ' + m.tendenciaDias + ' días</dt><dd class="wide">' + signed(a.tendencia) + ' pts' + (a.tendenciaClara ? ' · cambio claro' : ' · puede ser azar') + '</dd></dl>' +
        (a.id === m.arquetipo.id ? '<a class="btn" href="#/meta/arquetipo">Abrir el arquetipo</a>' : '<p class="fine">La maqueta trae la ficha solo de ' + esc(m.arquetipo.nombre) + '.</p>') + '</div></li>'
    }).join('') + '</ul><p class="legend" style="padding:10px 14px 12px;border-top:1px solid var(--line)"><span>Tendencia en negrita: cambio claro. En gris: puede ser azar.</span><span>Cada línea muestra la forma de su tendencia, no la escala: va contra su propio máximo.</span><span>Tocá una fila: IC y récord.</span></p></section>'
  }
  function viewMeta() {
    const m = D.meta
    const ev = D.hoy.pendientes.find((p) => p.tipo === 'evento')
    const sorts = [['cuota', 'Cuota'], ['pct', '% que gana'], ['tendencia', 'Tendencia']]
    return '<section class="card scope"><b>' + esc(m.eraNombre) + ' (' + esc(m.era) + ') · ' + esc(m.formato) + '</b><span class="fine">' + m.torneos + ' torneos · ' + num(m.listas) + ' listas · media ' + pct(m.media.pct) + ' (' + nTxt(m.media.n) + ')</span></section>' +
      (ev ? '<section class="card event"><span class="due-ico">' + ico('calendar', 22) + '</span><div><div class="label">Evento en curso</div><div class="row-title" style="margin-top:3px">' + esc(ev.texto) + '</div><p class="row-sub">' + esc(ev.detalle) + '</p></div></section>' : '') +
      sec('Qué se juega', 'tendencia de ' + m.tendenciaDias + ' días') +
      '<div class="sortline"><span class="label">Orden</span><div class="seg" role="group" aria-label="Ordenar los arquetipos">' + sorts.map((s) => '<button data-a="meta-sort" data-v="' + s[0] + '" aria-pressed="' + (ui.metaSort === s[0]) + '">' + s[1] + '</button>').join('') + '</div></div>' +
      '<div id="arch-list">' + archList() + '</div>' +
      '<p class="demo-note">' + ico('info', 16) + '<span>' + esc(m.atribucion) + '. La línea de cada fila es la cuota en cinco ventanas de 3 días, del ' + shortDate(m.ventanasSerie[0].desde) + ' al ' + shortDate(m.ventanasSerie[m.ventanasSerie.length - 1].hasta) + '. ' + esc(D.aviso) + '.</span></p>'
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
    return out.map((x, i) => (typeof x === 'string' ? '<div class="label" style="margin:' + (i ? 14 : 0) + 'px 0 8px">' + esc(x) + '</div>' : '<' + x.tag + ' class="bullets small' + (x.tag === 'ol' ? ' steps' : '') + '">' + x.items.map((it) => '<li>' + esc(it) + '</li>').join('') + '</' + x.tag + '>')).join('')
  }
  function viewArquetipo() {
    const a = D.meta.arquetipo
    const mine = a.misPartidas
    const deckId = Number((/#(\d+)/.exec(a.tengo) || [])[1])
    const cellFull = (label, s) => '<div class="triad-cell"><span class="label">' + label + '</span><b data-count="' + s.pct + '">' + pct(s.pct) + '</b>' + icBar(s.pct, s.ci) + '<span class="n">' + nTxt(s.n) + (s.orientativo ? ORI + ' orientativo' : '') + '<br>' + ciTxt(s.ci) + '<br>' + recTxt(s.record) + '</span></div>'
    const mu = (x, i) => {
      const k = 'mu-' + i
      const open = ui.open.has(k)
      return '<li><button class="mu" data-a="toggle" data-k="' + k + '" aria-expanded="' + open + '" aria-controls="' + k + '"><span class="mu-name">' + esc(x.rival) + '<small>' + pct(x.cuota) + ' del meta</small></span>' + divBar(x.pct, 50, 25) +
        '<span class="mu-val"><b>' + pct(x.pct) + '</b><span>' + nTxt(x.n) + (x.orientativo ? ORI : '') + '</span></span></button>' +
        '<div class="detail" id="' + k + '"' + (open ? '' : ' hidden') + '>' + sourceBlock('trophy', esc(a.nombre) + ' contra él, en torneos', x) + '</div></li>'
    }
    return '<section class="hero spine" style="' + acc(a.energias) + '"><div class="hero-top"><div class="hero-id"><div class="hero-kicker">' + gems(a.energias) + '<span>Arquetipo · ' + esc(energyNames(a.energias)) + '</span></div><h1 class="hero-name">' + esc(a.nombre) + '</h1>' +
      '<div class="hero-meta">' + pct(a.cuota) + ' del meta · en ' + num(a.enListas) + ' listas · ' + esc(a.tengo) + '</div></div>' +
      '<div class="arch-trend" style="margin-top:6px">' + spark(a.serie, 84, 34) + '<span>' + trendTxt(a) + ' pts</span></div></div>' +
      '<div class="vs" aria-label="Dos fuentes, nunca mezcladas">' + cellFull('En torneos', a) + cellFull('Vos contra él', mine) + '</div>' +
      '<div class="hero-actions lines" style="grid-template-columns:1fr 1.3fr .9fr"><button class="btn primary" data-a="match-open" data-rival="' + esc(a.nombre) + '">Registrar partida</button><button class="btn" data-a="static">Jugar contra el bot</button>' + (deckId ? '<a class="btn" href="#/mazo/' + deckId + '">Mi mazo #' + deckId + '</a>' : '') + '</div></section>' +
      sec('Mi nota') + '<section class="card pad" style="' + acc(a.energias) + '">' + noteHtml(a.nota) + '<button class="btn" style="margin-top:12px" data-a="static">Ver la nota entera</button></section>' +
      sec('Matchups', 'del peor al mejor') +
      '<section class="card rows"><ul>' + a.matchups.map(mu).join('') + '</ul><p class="legend" style="padding:10px 14px 12px;border-top:1px solid var(--line)"><span>Cómo le va a este arquetipo contra cada rival. La barra marca la distancia a 50' + NB + '% (borde: 25 y 75' + NB + '%).</span><span>Tocá una fila: IC y récord.</span></p></section>' +
      sec('Listas más jugadas') +
      '<section class="card rows"><ul>' + a.listas.map((l, i) => {
        const k = 'ls-' + i
        const open = ui.open.has(k)
        return '<li><button class="row" style="align-items:flex-start" data-a="toggle" data-k="' + k + '" aria-expanded="' + open + '" aria-controls="' + k + '"><span class="row-main"><span class="row-title">' + esc(l.etiqueta) + '</span><span class="row-sub">jugada ' + l.veces + ' veces · <span class="tag warn">' + esc(l.tengo) + ': ' + esc(l.faltaCartas.join(', ')) + '</span></span></span>' +
          '<span class="row-end"><b>' + pct(l.pct) + '</b><span>' + nTxt(l.n) + (l.orientativo ? ORI : '') + '</span></span></button>' +
          '<div class="detail" id="' + k + '"' + (open ? '' : ' hidden') + '>' + sourceBlock('trophy', 'Esta lista, en torneos', l) + '</div></li>'
      }).join('') + '</ul><p class="legend" style="padding:10px 14px 12px;border-top:1px solid var(--line)"><span>Tocá una fila: IC' + NB + '95' + NB + '%.</span></p></section>' +
      '<p class="demo-note">' + ico('info', 16) + '<span>' + esc(D.meta.atribucion) + '.</span></p>'
  }

  /* Menú */
  function viewMenu() {
    const now = { tema: pref('tema'), movimiento: motion(), vistas: pref('vistas') }
    const seg = (key, opts) => '<div class="seg" role="radiogroup" aria-label="' + key + '">' + opts.map((o) => '<button role="radio" data-a="pref" data-k="' + key + '" data-v="' + o[0] + '" aria-checked="' + (now[key] === o[0]) + '"' + (key === 'movimiento' && reduceMotion.matches && o[0] !== 'ninguno' ? ' aria-disabled="true"' : '') + '>' + o[1] + '</button>').join('') + '</div>'
    const links = [['sliders', 'Ajustes de la app', 'Pedir quién empezó, notificaciones, imágenes en la mesa'], ['save', 'Copia de seguridad', 'Descargar, restaurar y la copia en la nube'], ['book', 'Catálogo', 'Cartas y expansiones cargadas'], ['key', 'Tokens de API', 'Claude, workers y actividad'], ['door', 'Sesión', 'Cerrar sesión en este dispositivo'], ['info', 'Acerca de', 'Versión y licencias']]
    return '<h2 class="label" style="margin-top:6px">Aspecto</h2>' +
      '<section class="card" style="margin-top:8px"><div class="setting"><div class="setting-head"><b>Tema</b><span class="fine">' + (pref('tema') === 'sistema' ? 'sigue al sistema: ahora ' + root.dataset.tema : 'oscuro por defecto') + '</span></div>' + seg('tema', [['oscuro', 'Oscuro'], ['claro', 'Claro'], ['sistema', 'Sistema']]) + '</div>' +
      '<div class="setting"><div class="setting-head"><b>Movimiento</b><span class="fine">' + (reduceMotion.matches ? 'tu sistema pide reducirlo: queda en Ninguno' : 'tres niveles') + '</span></div>' + seg('movimiento', [['expresivo', 'Expresivo'], ['sutil', 'Sutil'], ['ninguno', 'Ninguno']]) +
      '<div class="motion-demo" id="motion-demo"><button class="btn quiet" data-a="motion-demo">Probar</button>' + gem('psychic', 'lg') + '</div></div>' +
      '<div class="setting"><div class="setting-head"><b>Cambio de vista en las fichas</b></div>' + seg('vistas', [['abajo', 'Abajo, en el dock'], ['arriba', 'Arriba, pestañas']]) + '</div>' +
      '<div class="setting"><div class="setting-row"><div><b style="font:700 17px/1.1 var(--font-display)">Miniaturas de cartas</b><div class="fine">Apagadas: solo texto; en la grilla, el nombre sobre el color del tipo</div></div><button class="switch" role="switch" aria-checked="' + (pref('miniaturas') === 'si') + '" aria-label="Miniaturas de cartas" data-a="pref-thumbs"></button></div></div></section>' +
      '<h2 class="label" style="margin-top:22px">Ajustes y sistema</h2>' +
      '<ul class="card rows" style="margin-top:8px">' + links.map((l) => '<li><button class="row" data-a="static" data-msg="' + esc('En la app abre «' + l[1] + '»: ' + l[2].charAt(0).toLowerCase() + l[2].slice(1) + '. La maqueta llega hasta acá.') + '"><span class="menu-ico">' + ico(l[0], 20) + '</span><span class="row-main"><span class="row-title">' + l[1] + '</span><span class="row-sub">' + l[2] + '</span></span>' + CHEV + '</button></li>').join('') + '</ul>' +
      '<p class="demo-note">' + ico('info', 16) + '<span>Maqueta B · «El mazo al centro». Datos del ' + shortDate(D.generado) + ', era ' + esc(D.era) + '. ' + esc(D.aviso) + '.</span></p>'
  }

  /* ───────────── Sheets ───────────── */
  const sheetHead = (title) => '<div class="sheet-head"><h2 class="sheet-title" id="sheet-title" tabindex="-1">' + title + '</h2><button class="iconbtn" data-a="sheet-close" aria-label="Cerrar">' + ico('close', 22) + '</button></div>'

  /* Registrar partida */
  const M = {}
  function matchInit(params) {
    const ex = D.partida.ejemplo
    const preset = params.estado === 'lista' || params.estado === 'guardada'
    Object.assign(M, {
      deckId: Number(params.mazo) || (preset ? ex.mazoId : D.partida.mazosRecientes[0].id),
      result: params.res || (preset ? RES_KEY[ex.resultado] : null),
      rival: params.rival || (preset ? ex.rival : ''),
      rivalPicked: Boolean(params.rival || preset),
      started: preset ? ex.empezo : null,
      seen: preset ? D.partida.cartasVistasEjemplo.slice() : [],
      mode: preset ? ex.modalidad : D.partida.modalidades[0],
      note: '', noteOpen: false, saved: params.estado === 'guardada', example: params.estado === 'guardada', applied: false, rank: null, hint: false, fresh: params.estado === 'guardada',
    })
    ui.open.delete('calc')
  }
  const matchIsExample = () => { const ex = D.partida.ejemplo; return M.deckId === ex.mazoId && M.result === RES_KEY[ex.resultado] && M.rival === ex.rival }
  const recentThumb = (id) => { const d = deckInfo(id); return crop(d.miniaturas[0], d.miniaturasDe[0].nombre, d.miniaturasDe[0].tipo) }
  function deckRadios(action) {
    return D.partida.mazosRecientes.map((d) => '<button class="m-deck" role="radio" aria-checked="' + (M.deckId === d.id) + '" style="' + acc(d.energias) + '" data-a="' + action + '" data-deck="' + d.id + '" data-f="deck-' + d.id + '" aria-label="Mazo ' + d.id + ', ' + esc(d.nombre) + '">' + recentThumb(d.id) + '<span class="m-deck-t"><b>#' + d.id + '</b> <small>' + esc(deckInfo(d.id).miniaturasDe[0].nombre) + '</small></span></button>').join('')
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
    const q = plain(M.rival.trim())
    const list = D.partida.rivalesSugeridos.filter((r) => !q || plain(r).indexOf(q) >= 0).slice(0, 4)
    if (!list.length) return '<div class="rival-note"><p>Ningún rival sugerido con ese texto: se guarda tal cual lo escribiste.</p></div>'
    return '<div class="rival-grid" role="group" aria-label="Rivales sugeridos">' + list.map((r) => '<button class="rival-opt" data-a="match-rival" data-v="' + esc(r) + '" aria-pressed="' + (M.rival === r) + '">' + esc(r) + '</button>').join('') + '</div>'
  }
  function matchForm() {
    const sug = D.partida.sugerenciaPorCartas
    const inRecent = D.partida.mazosRecientes.some((d) => d.id === M.deckId)
    const seen = M.seen.length ? M.seen.map((c) => '<span class="seen-card">' + thumb(c.imagen, c.nombre, c.tipo) + '<span class="x">×' + c.cant + '</span><span class="nm">' + esc(c.nombre) + '</span></span>').join('') : '<span class="seen-empty">Todavía ninguna.</span>'
    return '<div class="stack">' +
      '<div><div class="fld-label"><span class="label" id="m-deck-l">Mazo</span><span class="val">' + esc(deckLabel(M.deckId)) + '</span></div><div class="m-decks" role="radiogroup" aria-labelledby="m-deck-l">' + deckRadios('match-deck') +
      '<button class="m-deck other" role="radio" aria-checked="' + !inRecent + '" data-a="static" data-msg="En la app abre la lista de tus mazos; acá están los tres de la sesión.">' + (inRecent ? 'Otro…' : '#' + M.deckId) + '</button></div></div>' +
      '<div class="m-results" role="radiogroup" aria-label="Resultado">' + ['v', 'd', 'e'].map((r) => '<button class="m-result ' + r + '" role="radio" aria-checked="' + (M.result === r) + '" data-a="match-result" data-v="' + r + '" data-f="res-' + r + '">' + shape(r, 14) + RES[r] + '</button>').join('') + '</div>' +
      '<div><div class="fld-label"><label class="label" for="m-rival">Rival</label></div><div class="rival-box"><input class="field" id="m-rival" type="text" placeholder="Arquetipo del rival" value="' + esc(M.rival) + '" autocomplete="off" autocapitalize="off" enterkeyhint="done">' +
      (M.rival ? '<button class="rival-clear" data-a="match-rival-clear" aria-label="Borrar el rival">' + ico('close', 18) + '</button>' : '') + '</div><div class="rival-area" id="rival-area">' + rivalArea() + '</div></div>' +
      '<div class="started-row"><span class="label" id="m-st-l">¿Quién empezó?</span><div class="seg" role="radiogroup" aria-labelledby="m-st-l"><button role="radio" aria-checked="' + (M.started === 'yo') + '" data-a="match-start" data-v="yo" data-f="st-yo">Empecé yo</button><button role="radio" aria-checked="' + (M.started === 'rival') + '" data-a="match-start" data-v="rival" data-f="st-rival">Empezó el rival</button></div></div>' +
      '<div><div class="fld-label"><span class="label">Cartas que vi</span>' + (M.seen.length ? '<span class="fine">' + M.seen.reduce((a, c) => a + c.cant, 0) + ' copias</span>' : '') + '</div><div class="seen">' + seen +
      '<button class="btn" data-a="match-seen" data-f="seen-add">' + ico('plus', 16) + 'Carta</button></div>' +
      (M.seen.length ? '<button class="hint-line" style="border:0;background:none;width:100%;text-align:left;min-height:44px" data-a="match-rival" data-v="' + esc(sug.rival) + '">' + ico('check', 16) + '<span>Por esas cartas: <b>' + esc(sug.rival) + '</b>, ' + esc(sug.texto) + (M.rival === sug.rival ? '.' : '. Tocá para usarlo.') + '</span></button>' : '') + '</div>' +
      '<div class="second"><select class="field" id="m-mode" aria-label="Modalidad">' + D.partida.modalidades.map((m) => '<option' + (m === M.mode ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + '</select>' +
      '<button class="btn" data-a="match-note" data-f="note" aria-expanded="' + M.noteOpen + '">' + ico('pencil', 16) + (M.noteOpen ? 'Sin nota' : 'Agregar nota') + '</button></div>' +
      (M.noteOpen ? '<textarea class="field" id="m-note" rows="2" style="height:72px;padding:10px 14px" placeholder="Nota de la partida" aria-label="Nota de la partida">' + esc(M.note) + '</textarea>' : '') + '</div>'
  }
  /* a rank name («Ultra Ball 4») and «1.094 puntos» stay whole when the option takes two lines */
  const rankTxt = (o) => esc(o).replace(/(\p{L}+) Ball( \d+)?/gu, (m) => m.replace(/ /g, NB)).replace(/(\d) puntos/g, '$1' + NB + 'puntos')
  function matchAnswer() {
    const a = D.partida.respuesta
    const r = M.result
    const s = session[M.deckId]
    const isEx = matchIsExample()
    const odds = isEx ? /1 de cada (\d+)/.exec(a.veredicto.texto) : null
    const fresh = M.fresh
    M.fresh = false
    const party = fresh && r === 'v' && M.applied ? '<span class="celebrate" aria-hidden="true">' + Array.from({ length: 16 }, (_, i) => { const ang = (i / 16) * Math.PI * 2; const dist = 46 + ((i * 37) % 44); return '<i style="--dx:' + Math.round(Math.cos(ang) * dist) + 'px;--dy:' + Math.round(Math.sin(ang) * dist * 0.8 - 14) + 'px;background:' + ['#3fd6c6', '#8b9cff', '#e6a4ff', '#ffd43b'][i % 4] + ';animation-delay:' + (180 + (i % 5) * 28) + 'ms"></i>' }).join('') + '</span><span class="plus-one" aria-hidden="true">+1 V</span>' : ''
    /* always built here, so the deck carries its number */
    const text = RES[r] + ' con ' + deckLabel(M.deckId) + (M.rival ? ' contra ' + M.rival : '') + (M.started ? ' · ' + (M.started === 'yo' ? 'empecé yo' : 'empezó el rival') : '')
    /* the verdict shows its title, the odds and its first sentence; the rest of the calculation opens on demand */
    const cut = a.veredicto.texto.indexOf('. ') + 1
    const lead = cut ? a.veredicto.texto.slice(0, cut) : a.veredicto.texto
    const rest = cut ? a.veredicto.texto.slice(cut + 1) : ''
    const calcOpen = ui.open.has('calc')
    const ex = D.partida.ejemplo
    return '<div class="stack flip' + (fresh ? ' in' : '') + '"><div class="banner">' + party + '<span class="res ' + r + '" aria-hidden="true">' + r.toUpperCase() + '</span><div class="banner-t"><b>Guardada</b></div>' +
      '<button class="btn" data-a="match-undo" data-f="undo">' + ico('undo', 16) + esc(a.deshacer) + '</button><p class="banner-text">' + run(text) + '</p>' +
      (s ? '<div class="banner-streak"><span class="deck-num">#' + M.deckId + '</span><span>hoy ' + recTxt(s.hoy) + '</span>' + streak(s.racha, fresh && M.applied) + '</div>' : '') + '</div>' +
      '<section class="holo verdict" aria-label="¿Mala racha?"><div class="kicker h">¿Mala racha?</div>' +
      (isEx ? '<h3>' + esc(a.veredicto.titulo.split(' · ')[0]) + '<small>' + esc(a.veredicto.titulo.split(' · ').slice(1).join(' · ')) + '</small></h3>' +
        (odds ? '<div class="odds"><span class="odds-dots" aria-hidden="true">' + Array.from({ length: Number(odds[1]) }, (_, i) => '<i class="' + (i === 0 ? 'on' : '') + '"></i>').join('') + '</span><span>pasa 1 de cada ' + odds[1] + ' veces</span></div>' : '') +
        '<p>' + esc(lead) + '</p>' + (rest ? '<button class="linkrow calc" data-a="toggle" data-k="calc" data-f="calc" aria-expanded="' + calcOpen + '" aria-controls="calc"><span>Ver el cálculo</span><span class="chev">' + ico('down', 18) + '</span></button><div class="detail" id="calc"' + (calcOpen ? '' : ' hidden') + '><p>' + esc(rest) + '</p></div>' : '')
        : '<p>El veredicto se calcula en la app con tus partidas y los torneos. La maqueta trae solo el del ejemplo: ' + run(ex.resultado + ' con ' + deckLabel(ex.mazoId) + ' contra ' + ex.rival) + '.</p>') + '</section>' +
      '<div><div class="fld-label"><span class="label">¿Cambiaste de rango?</span><span class="fine">' + esc(a.rango.actual) + '</span></div><div class="rank-opts" role="group" aria-label="Cambio de rango">' + a.rango.opciones.map((o, i) => '<button data-a="match-rank" data-v="' + i + '" data-f="rank-' + i + '" aria-pressed="' + (M.rank === i) + '">' + rankTxt(o) + '</button>').join('') + '</div>' +
      (a.rango.vigente ? '' : '<p class="fine rank-note">Sin temporada en curso: es el último rango anotado.</p>') + '</div></div>'
  }
  function sheetPartida() {
    const foot = M.saved ? '<div class="again"><div class="again-top"><span class="label" id="again-l">Otra con #' + M.deckId + ' · ' + esc(M.mode) + '</span><button class="btn quiet done" data-a="sheet-close">Listo</button></div><div class="vde" role="group" aria-labelledby="again-l">' + ['v', 'd', 'e'].map((x) => '<button class="vde-btn ' + x + '" data-a="match-again" data-v="' + x + '" data-f="again-' + x + '">' + shape(x) + RES[x] + '</button>').join('') + '</div></div>' :
      (M.result ? '' : '<span class="hint" id="m-hint"' + (M.hint ? ' style="color:var(--warn);font-weight:600"' : '') + '>Falta el<br>resultado</span>') + '<button class="btn primary big" data-a="match-save" data-f="save" aria-disabled="' + !M.result + '"' + (M.result ? '' : ' aria-describedby="m-hint"') + '>Guardar partida</button>'
    return sheetHead(M.saved ? 'Partida guardada' : 'Registrar partida') + '<div class="sheet-body" style="overflow-x:hidden">' + (M.saved ? matchAnswer() : matchForm()) + '</div><div class="sheet-foot">' + foot + '</div>'
  }
  function matchRender(focusKey) {
    const sheet = $('.sheet')
    if (!sheet) return
    const keep = focusKey || (document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.f : null)
    const scroll = $('.sheet-body', sheet) ? $('.sheet-body', sheet).scrollTop : 0
    sheet.innerHTML = sheetPartida()
    $('.sheet-body', sheet).scrollTop = M.saved ? 0 : scroll
    const target = keep && $('[data-f="' + keep + '"]', sheet)
    if (target) { target.focus({ preventScroll: true }); if (focusKey) target.classList.add('just') } else $('#sheet-title', sheet).focus({ preventScroll: true })
    countUp(sheet, 'spartida')
    sheetMore()
  }
  function matchApply(sign) {
    const s = session[M.deckId]
    const letter = M.result.toUpperCase()
    if (sign > 0) { day[M.result] += 1; if (s) { s.hoy[M.result] += 1; s.prev = s.racha.slice(); s.racha = s.racha.concat(letter).slice(-8); s.fresh = true } } else { day[M.result] -= 1; if (s) { s.hoy[M.result] -= 1; s.racha = s.prev || s.racha; s.fresh = false } }
    M.applied = sign > 0
    if ($('#mesa')) { $('#mesa').innerHTML = D.hoy.mazosSesion.map(deckCard).join(''); $('#day-rec').innerHTML = dayRec() }
  }

  /* Buscador / lanzador */
  let searchQuery = ''
  const searchOpen = new Set()
  function searchResults() {
    const raw = searchQuery.trim()
    const q = plain(raw)
    const hit = (text) => !q || plain(text).indexOf(q) >= 0
    const mark = (text) => {
      if (!q) return run(text)
      const at = plain(text).indexOf(q)
      /* the same word joiner as run(): the pieces around the mark carry no attributes */
      return (at < 0 ? esc(text) : esc(text.slice(0, at)) + '<mark>' + esc(text.slice(at, at + q.length)) + '</mark>' + esc(text.slice(at + q.length))).replace(/-(?=\p{L})/gu, '-\u2060')
    }
    const arche = D.meta.arquetipo
    const screens = [
      ['sun', 'Hoy', 'La mesa y el resumen del día', '#/hoy', 'inicio resumen mesa pendientes'], ['stack', 'Mazos', D.mazos.length + ' armados', '#/mazos', 'lista decks'],
      ['cards', 'Sobres', 'Qué sobre abrir y por qué', '#/cartas', 'cartas packs promo cupon'], ['cards', 'Colección', 'Sincronizar y buscar cartas', '#/cartas/coleccion', 'cartas tracker csv'],
      ['trophy', 'Meta', 'Qué se juega en torneos', '#/meta', 'torneos arquetipos eventos'], ['flask', 'Pruebas', 'Preguntas y trabajos', '#/pruebas', 'simulacion laboratorio'],
      ['play', 'Practicar', 'Jugar contra el bot, situaciones, ejercicios', '#/pruebas/practicar', 'bot jugar'], ['cpu', 'Motor', 'Workers, cola, calibración', '#/pruebas/motor', 'worker analisis'],
      ['sliders', 'Menú', 'Aspecto, ajustes y sistema', '#/menu', 'tema movimiento ajustes copia seguridad tokens sesion'],
    ].filter((s) => hit(s[1] + ' ' + s[4]))
    const actions = [['plus', 'Registrar partida', 'Con cualquier mazo', 'match-open', '']]
    D.partida.mazosRecientes.forEach((d) => actions.push(['plus', 'Registrar partida con #' + d.id + ' ' + d.nombre, '', 'match-open', 'data-deck="' + d.id + '"']))
    actions.push(['trophy', 'Probar ' + deckLabel(D.mazo.id) + ' contra el meta', '', 'launch', 'data-q="meta" data-deck="' + D.mazo.id + '"'], ['sync', 'Sincronizar la colección', 'Trae las cartas del juego', 'go', 'data-href="#/cartas/coleccion"'], ['sliders', 'Cambiar tema o movimiento', 'Menú: Aspecto', 'go', 'data-href="#/menu"'])
    const acts = actions.filter((a) => hit(a[1]))
    const fromApi = raw.toLowerCase() === D.buscar.consulta
    const decks = fromApi ? D.buscar.mazos : (q ? D.mazos.filter((m) => hit('#' + m.id + ' ' + m.nombre)).slice(0, 5) : D.partida.mazosRecientes)
    const arches = fromApi ? D.buscar.arquetipos : (q ? D.meta.arquetipos.filter((a) => hit(a.nombre)).slice(0, 5) : [])
    const allCards = Object.keys(CARDS).map((k) => CARDS[k])
    const cards = fromApi ? D.buscar.cartas : (q ? allCards.filter((c) => hit(c.nombre + ' ' + c.id)).slice(0, 6) : [])
    const cardsTotal = fromApi ? D.buscar.cartasTotal : cards.length
    const group = (title, aux, rows, cap, more) => {
      if (!rows.length) return ''
      const open = searchOpen.has(title) || rows.length <= cap
      return '<section class="search-group"><div class="sg-head"><h3>' + title + '<span>' + aux + '</span></h3>' + (open ? '' : '<button class="s-more" data-a="search-more" data-k="' + title + '">' + more + '</button>') + '</div>' + (open ? rows : rows.slice(0, cap)).join('') + '</section>'
    }
    const gScreens = group('Pantallas', screens.length, screens.map((s) => '<a class="s-row" href="' + s[3] + '" data-a="go" data-href="' + s[3] + '"><span class="s-ico">' + ico(s[0], 20) + '</span><span class="s-main"><span class="s-title" style="display:block">' + mark(s[1]) + '</span><span class="s-sub" style="display:block">' + esc(s[2]) + '</span></span>' + CHEV + '</a>'), q ? 2 : 10, 'ver las ' + screens.length)
    const gActions = group('Acciones', acts.length, acts.map((a) => '<button class="s-row" data-a="' + a[3] + '" ' + a[4] + '><span class="s-ico">' + ico(a[0], 20) + '</span><span class="s-main"><span class="s-title" style="display:block">' + mark(a[1]) + '</span>' + (a[2] ? '<span class="s-sub" style="display:block">' + esc(a[2]) + '</span>' : '') + '</span></button>'), q ? 2 : 3, 'ver las ' + acts.length)
    const gDecks = group('Mazos', q ? decks.length : 'de la sesión', decks.map((m) => '<a class="s-row" href="#/mazo/' + m.id + '" data-a="go" data-href="#/mazo/' + m.id + '">' + gem(m.energias[0], 'lg') + '<span class="s-main"><span class="s-title" style="display:block"><span class="deck-num">#' + m.id + '</span> ' + mark(m.nombre) + '</span></span>' + CHEV + '</a>'), q ? 2 : 3, 'ver los ' + decks.length)
    const gCards = group('Cartas', cards.length + (cardsTotal > cards.length ? ' de ' + cardsTotal : ''), cards.map((c) => '<button class="s-row" data-a="card" data-c="' + esc(c.id) + '">' + thumb(c.imagen, c.nombre, c.tipo) + '<span class="s-main"><span class="s-title" style="display:block">' + mark(c.nombre) + '</span><span class="s-sub" style="display:block">' + (c.copias != null ? (c.copias ? c.copias + ' copias jugables' : 'no la tenés') + ' · ' + c.ediciones + (c.ediciones === 1 ? ' edición' : ' ediciones') : esc(c.clase || '') + ' · ' + esc(c.id)) + '</span></span>' + (c.tipo ? gem(c.tipo) : '') + '</button>'), 2, 'ver las ' + cards.length)
    const gRivals = group('Rivales', arches.length, arches.map((a) => { const href = a.id === arche.id ? '#/meta/arquetipo' : '#/meta'; return '<a class="s-row" href="' + href + '" data-a="go" data-href="' + href + '"><span class="s-ico">' + ico('trophy', 20) + '</span><span class="s-main"><span class="s-title" style="display:block">' + mark(a.nombre) + '</span><span class="s-sub" style="display:block">Arquetipo de torneo</span></span>' + CHEV + '</a>' }), 2, 'ver los ' + arches.length)
    /* with nothing typed it is a launcher: actions and the session decks come first */
    const html = q ? gScreens + gActions + gDecks + gCards + gRivals : gActions + gDecks + gScreens
    return html || '<div class="empty">Nada con «' + esc(raw) + '» en la maqueta.</div>'
  }
  function sheetBuscar() {
    return sheetHead('Buscar') + '<div class="search-body" id="search-results">' + searchResults() + '</div>' +
      '<div class="search-foot"><div class="search-input">' + ico('search', 20) + '<input class="field" id="search-q" type="text" inputmode="search" placeholder="Pantallas, mazos, cartas…" value="' + esc(searchQuery) + '" aria-label="Buscar pantallas, acciones, mazos y cartas" autocomplete="off" autocapitalize="off" enterkeyhint="search"></div></div>'
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
      all.map((a) => '<div class="cmp"><span class="cmp-name">' + esc(a.nombre) + ' <span class="deck-num">· ' + esc(a.expansionId) + '</span><small>puntaje ' + nf2.format(a.numeros.puntaje) + ' · ' + nf2.format(a.numeros.buscadas) + ' buscadas</small></span><span class="hbar' + (a.best ? ' hot' : '') + '"><i style="width:' + a.numeros.alMenosUna + '%"></i></span><b>' + pct(a.numeros.alMenosUna) + '</b></div>').join('') + '</div>' +
      '<p class="fine">Buscás: ' + esc(s.objetivos) + '.</p></div></div>' +
      '<div class="sheet-foot"><button class="btn big quiet" data-a="sheet-close">Listo</button></div>'
  }
  function sheetCarta(params) {
    const c = CARDS[params.c]
    if (!c) return sheetHead('Carta') + '<div class="sheet-body"><p class="note">Esa carta no está en los datos de la maqueta.</p></div>'
    const inDeck = [].concat(D.mazo.cartas.pokemon, D.mazo.cartas.entrenadores).find((x) => x.id === c.id)
    const rows = [['Código', '<span class="code">' + esc(c.id) + '</span>']]
    if (c.clase) rows.push(['Clase', esc(c.clase)])
    if (c.tipo) rows.push(['Tipo', gem(c.tipo, 'sm') + ' ' + esc(D.energias[c.tipo].nombre)])
    if (c.puntos) rows.push(['Si la debilitan', 'da ' + c.puntos + (c.puntos === 1 ? ' punto' : ' puntos')])
    if (c.copias != null) rows.push(['Copias jugables', c.copias ? String(c.copias) : 'no la tenés'], ['Ediciones', String(c.ediciones)])
    if (inDeck) rows.push(['En ' + deckLabel(D.mazo.id).split(' ')[0], '×' + inDeck.cant])
    return sheetHead(esc(c.nombre)) + '<div class="sheet-body"><div class="card-view">' + thumb(c.imagen, c.nombre, c.tipo) + '<dl class="kv" style="grid-template-columns:auto 1fr;gap:8px 12px">' + rows.map((r) => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('') + '</dl></div>' +
      '<p class="fine" style="margin-top:14px">En la app, esta hoja es la ficha única de la carta, con sus ediciones adentro: cuántas tenés, de qué sobre sale, puntos e intercambio.</p></div>' +
      '<div class="sheet-foot"><button class="btn big quiet" data-a="sheet-close">Listo</button></div>'
  }
  function sheetLanzar(params) {
    const q = D.pruebas.preguntas.find((p) => p.id === params.q) || D.pruebas.preguntas[0]
    const jobs = D.pruebas.trabajos.filter((j) => j.pregunta === q.id)
    const deck = Number(params.mazo)
    return sheetHead(esc(q.titulo)) + '<div class="sheet-body"><div class="stack"><p class="note">' + esc(q.bajada) + '</p>' +
      '<div class="banner" style="grid-template-columns:auto minmax(0,1fr)"><span class="s-ico">' + ico('stack', 20) + '</span><div class="banner-t"><span class="label" style="display:block;margin-bottom:2px">Con el mazo</span>' + (deck ? esc(deckLabel(deck)) : 'Lo elegís al lanzar, o pegás una lista') + '</div></div>' +
      (jobs.length ? '<div><div class="fld-label"><span class="label">Lo último que dio</span><span class="fine">' + jobs.length + (jobs.length === 1 ? ' trabajo' : ' trabajos') + '</span></div><ul class="card rows" style="background:var(--s2);box-shadow:none">' + jobs.map(jobRow).join('') + '</ul></div>' : '') + '</div></div>' +
      '<div class="sheet-foot"><button class="btn primary big" data-a="static" data-msg="En la maqueta no se lanza nada: en la app se encola y avisa cuando termina.">Lanzar la prueba</button></div>'
  }
  const ACTIONS = {
    mazo: ['Acciones del mazo', [['pencil', 'Editar'], ['stack', 'Duplicar'], ['save', 'Exportar…'], ['check', 'Marcar «en el juego»'], ['book', 'Archivar'], ['close', 'Eliminar']]],
    coleccion: ['Más acciones', [['save', 'Importar CSV'], ['save', 'Exportar CSV'], ['pencil', 'Ajustes manuales']]],
  }
  function sheetAcciones(params) {
    if (params.de === 'objetivos') {
      const parts = D.cartas.sobres.objetivos.split(' · ')
      return sheetHead('Qué buscás en los sobres') + '<div class="sheet-body">' + parts.map((p, i) => '<div class="setting-row" style="min-height:56px' + (i ? ';border-top:1px solid var(--line)' : '') + '"><b style="font:600 17px/1.2 var(--font-display)">' + esc(p) + '</b><button class="switch" role="switch" aria-checked="true" aria-label="' + esc(p) + '" data-a="static" data-msg="En la maqueta los objetivos no se cambian."></button></div>').join('') +
        '<p class="fine" style="margin-top:10px">Casi nunca los cambiás: por eso en Sobres ocupan una línea.</p></div><div class="sheet-foot"><button class="btn big quiet" data-a="sheet-close">Listo</button></div>'
    }
    const def = ACTIONS[params.de] || ACTIONS.mazo
    return sheetHead(def[0]) + '<div class="sheet-body">' + def[1].map((a) => '<button class="act" data-a="static">' + '<span class="menu-ico">' + ico(a[0], 20) + '</span>' + a[1] + '</button>').join('') + '</div>'
  }
  const SHEETS = { partida: sheetPartida, buscar: sheetBuscar, sobre: sheetSobre, carta: sheetCarta, lanzar: sheetLanzar, acciones: sheetAcciones }

  /* ───────────── Router ───────────── */
  const TABS = [['hoy', 'Hoy', 'sun', '#/hoy'], ['mazos', 'Mazos', 'stack', '#/mazos'], ['cartas', 'Cartas', 'cards', '#/cartas'], ['meta', 'Meta', 'trophy', '#/meta'], ['pruebas', 'Pruebas', 'flask', '#/pruebas']]
  const tabMem = {}
  TABS.forEach((t) => { tabMem[t[0]] = t[3] })
  const scrollMem = {}
  const stack = []
  let current = null
  let navIntent = null
  let sheetPushed = false
  let lastFocus = null

  function parseHash() {
    const raw = location.hash.replace(/^#/, '') || '/hoy'
    const cut = raw.indexOf('?')
    const path = (cut < 0 ? raw : raw.slice(0, cut)).replace(/\/+$/, '') || '/hoy'
    const params = {}
    new URLSearchParams(cut < 0 ? '' : raw.slice(cut + 1)).forEach((v, k) => { params[k] = v })
    return { path: path, params: params }
  }
  function resolve(path) {
    const seg = path.split('/').filter(Boolean)
    const more = '<a class="iconbtn" href="#/menu" aria-label="Menú: aspecto, ajustes y sistema">' + ico('sliders', 22) + '</a>'
    if (seg[0] === 'hoy' && seg.length === 1) return { tab: 'hoy', key: path, title: 'Hoy', sub: D.hoy.fechaTexto + ' · era ' + D.era, right: more, view: viewHoy, cta: true }
    if (seg[0] === 'mazos' && seg.length === 1) return { tab: 'mazos', key: path, title: 'Mazos', sub: D.mazos.length + ' armados', right: more, view: viewMazos }
    if (seg[0] === 'mazo' && seg.length <= 3) {
      const id = Number(seg[1])
      const vista = seg[2] || 'lista'
      const at = D.mazos.findIndex((m) => m.id === id)
      if (at < 0 || !VISTAS.some((v) => v[0] === vista)) return null
      const prev = D.mazos[(at + D.mazos.length - 1) % D.mazos.length].id
      const next = D.mazos[(at + 1) % D.mazos.length].id
      const full = D.mazo.id === id
      return {
        tab: 'mazos', key: '/mazo/' + id, viewKey: full ? vista : 'lista', back: ['#/mazos', 'Mazos'], view: () => viewMazo(id, vista), tabs: full ? deckTabs(id) : null, tabsLabel: 'Vistas del mazo', deckId: id,
        right: '<span class="pager"><a class="iconbtn" href="#/mazo/' + prev + '" aria-label="Mazo anterior">' + ico('left', 20) + '</a><span class="pager-n">' + (at + 1) + '/' + D.mazos.length + '</span><a class="iconbtn" href="#/mazo/' + next + '" aria-label="Mazo siguiente">' + ico('right', 20) + '</a></span>' +
          '<button class="iconbtn" data-a="sheet" data-s="mazo" aria-label="Acciones del mazo">' + ico('more', 22) + '</button>',
      }
    }
    if (seg[0] === 'cartas' && (seg.length === 1 || (seg.length === 2 && seg[1] === 'coleccion'))) {
      const col = seg[1] === 'coleccion'
      return { tab: 'cartas', key: path, title: 'Cartas', sub: col ? 'Colección' : 'Sobres', right: more, view: col ? viewColeccion : viewSobres, tabs: CARTAS_TABS, viewKey: col ? 'coleccion' : 'sobres', tabsLabel: 'Vistas de Cartas' }
    }
    if (seg[0] === 'pruebas') {
      if (seg.length === 1 || (seg.length === 2 && (seg[1] === 'practicar' || seg[1] === 'motor'))) {
        const sub = seg[1] || ''
        return { tab: 'pruebas', key: path, title: 'Pruebas', sub: sub === 'practicar' ? 'Practicar' : sub === 'motor' ? 'Motor' : 'Simulación y laboratorio, por pregunta', right: more, view: () => viewPruebas(sub), tabs: PRUEBAS_TABS, viewKey: sub || 'pruebas', tabsLabel: 'Vistas de Pruebas' }
      }
      if (seg[1] === 'resultado' && Number(seg[2]) === D.pruebas.resultado.id) return { tab: 'pruebas', key: path, back: ['#/pruebas', 'Pruebas'], view: viewResultado, right: '' }
      return null
    }
    if (seg[0] === 'meta' && seg.length === 1) return { tab: 'meta', key: path, title: 'Meta', sub: 'Torneos y eventos · era ' + D.meta.era, right: more, view: viewMeta }
    if (seg[0] === 'meta' && seg[1] === 'arquetipo') return { tab: 'meta', key: path, back: ['#/meta', 'Meta'], view: viewArquetipo, right: '' }
    if (seg[0] === 'menu') return { tab: null, key: path, back: ['#' + (current && current.path !== path ? current.path : stack.length ? stack[stack.length - 1] : '/hoy'), 'Volver'], title: 'Menú', view: viewMenu, right: '' }
    return null
  }
  function renderTop(route) {
    $('#encabezado').className = 'top' + (route.back ? ' has-back' : '')
    $('#encabezado').innerHTML = route.back
      ? '<a class="back" href="' + route.back[0] + '" data-a="back" aria-label="Volver' + (route.back[1] === 'Volver' ? '' : ' a ' + route.back[1]) + '">' + ico('back', 24) + '<span>' + route.back[1] + '</span></a>' + (route.title ? '<h1 class="top-title here">' + route.title + '</h1>' : '') + '<span class="top-space"></span>' + route.right
      : '<div class="top-titles"><h1 class="top-title">' + route.title + '</h1><span class="top-sub">' + esc(route.sub) + '</span></div>' + route.right
  }
  function renderDock(route) {
    let left = ''
    if (route.cta) left = '<button class="dock-cta" data-a="match-open">' + ico('plus', 20) + 'Registrar partida</button>'
    else if (route.tabs && pref('vistas') === 'abajo') left = tablist(route.tabs, route.viewKey, 'dock-tabs', route.tabsLabel, route.deckId ? 'panel' : 'principal')
    /* the dock exists only where there are views or a main action; the search is always at the end of the bar below */
    root.dataset.dock = left ? 'si' : 'no'
    $('#dock').innerHTML = left
  }
  function renderTabbar(route) {
    $('#barra').innerHTML = TABS.map((t) => '<a class="tab" href="' + t[3] + '" data-tab="' + t[0] + '"' + (route.tab === t[0] ? ' aria-current="page"' : '') + '><span class="tab-ico">' + ico(t[2], 22) + '</span>' + t[1] + '</a>').join('') +
      '<button class="tab-search" data-a="search-open" aria-label="Buscar pantallas, acciones, mazos y cartas">' + ico('search', 20) + '</button>'
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
      const dec = el.dataset.unit == null || !Number.isInteger(target) ? 1 : 0
      const fmt = new Intl.NumberFormat('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
      const t0 = performance.now()
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 620)
        if (k >= 1) { el.innerHTML = final; return }
        const v = target * (1 - Math.pow(1 - k, 3))
        el.textContent = ('signed' in el.dataset && v > 0 ? '+' : '') + fmt.format(v) + unit
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    })
  }
  function render() {
    const r = parseHash()
    const lookChanged = prefsFromUrl(r.params)
    const route = resolve(r.path)
    if (!route) { location.replace('#/hoy'); return }
    const kind = navIntent || (current ? 'pop' : 'first')
    navIntent = null
    const samePage = current && current.key === route.key
    const sameView = samePage && current.viewKey === route.viewKey
    if (current && !sameView) scrollMem[current.path] = window.scrollY
    if (!samePage) {
      if (kind === 'pop') { const at = stack.lastIndexOf(r.path); stack.length = at >= 0 ? at : 0 } else if (kind !== 'view' && current && r.path !== current.path) stack.push(current.path)
      renderTop(route)
      const main = $('#principal')
      main.className = 'enter'
      main.innerHTML = route.view()
      renderDock(route)
      if (!current || current.tab !== route.tab) renderTabbar(route)
      window.scrollTo(0, kind === 'pop' || kind === 'tab' ? scrollMem[r.path] || 0 : 0)
      countUp(main, 'p' + r.path)
      document.title = (route.title || (route.deckId ? deckLabel(route.deckId) : route.back ? route.back[1] : 'TCG Pocket')) + ' · maqueta B'
    } else if (lookChanged) {
      /* same screen, another look: a link that only adds tema / movimiento / vistas to the screen already open draws it again in place */
      const y = window.scrollY
      $('#principal').className = ''
      $('#principal').innerHTML = route.view()
      renderDock(route)
      window.scrollTo(0, y)
    } else if (!sameView) {
      /* same deck, another view: only the panel changes */
      const panel = $('#panel')
      const full = D.mazo
      panel.innerHTML = deckPanel(full, route.viewKey)
      panel.setAttribute('aria-labelledby', 'tab-' + route.viewKey)
      panel.className = 'panel'
      void panel.offsetWidth
      panel.className = 'panel enter'
      $$('[role="tab"]').forEach((t) => { const on = t.id === 'tab-' + route.viewKey; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1 })
      const top = panel.getBoundingClientRect().top + window.scrollY - (pref('vistas') === 'arriba' ? 118 : 62)
      if (window.scrollY > top) window.scrollTo(0, top)
      countUp(panel, 'v' + r.path)
    }
    if (route.tab) tabMem[route.tab] = '#' + r.path
    const sheetKind = r.params.hoja || (r.params.detalle === 'sobre' ? 'sobre' : null)
    const sig = sheetKind ? JSON.stringify([sheetKind, r.params.c, r.params.q, r.params.de, r.params.mazo]) : null
    const hadSheet = current && current.sig
    if (sig && SHEETS[sheetKind]) {
      if (!hadSheet) sheetPushed = kind !== 'first' && samePage
      if (sig !== (current && current.sig)) openSheet(sheetKind, r.params)
    } else if (hadSheet) closeLayer()
    current = { path: r.path, key: route.key, viewKey: route.viewKey, tab: route.tab, sig: sig, route: route }
  }
  function go(hash, intent) { navIntent = intent || 'link'; if (location.hash === hash) render(); else location.hash = hash }
  const basePath = () => '#' + (current ? current.path : '/hoy')

  function openSheet(kind, params) {
    const layer = $('#capa-hoja')
    if (layer.hidden) lastFocus = document.activeElement
    if (kind === 'partida') matchInit(params)
    if (kind === 'buscar') searchOpen.clear()
    if (kind === 'buscar') searchQuery = params.q != null ? params.q : (params.hoja === 'buscar' && !sheetPushed ? D.buscar.consulta : '')
    layer.innerHTML = '<div class="scrim" data-a="sheet-close"></div><section class="sheet' + (kind === 'buscar' ? ' tall' : '') + '" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' + SHEETS[kind](params) + '</section>'
    layer.hidden = false
    root.classList.add('sheet-open')
    $('#app').setAttribute('inert', '')
    const first = kind === 'buscar' ? $('#search-q') : $('#sheet-title')
    if (first) first.focus({ preventScroll: true })
    countUp(layer, 's' + kind)
    sheetMore()
  }
  /* When the body of a sheet does not fit (a short screen, the browser bars), a fade over the foot says there is more below. */
  function sheetMore() {
    const sheet = $('.sheet')
    if (!sheet) return
    const body = $('.sheet-body, .search-body', sheet)
    sheet.classList.toggle('more', !!body && body.scrollHeight - body.scrollTop - body.clientHeight > 6)
  }
  function closeLayer() {
    const layer = $('#capa-hoja')
    if (layer.hidden) return
    layer.hidden = true
    layer.innerHTML = ''
    root.classList.remove('sheet-open')
    $('#app').removeAttribute('inert')
    sheetPushed = false
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true })
    lastFocus = null
  }
  function closeSheet() {
    if ($('#capa-hoja').hidden) return
    navIntent = 'sheet'
    if (sheetPushed) history.back(); else location.replace(basePath())
  }
  /* Leaving through a link inside a sheet: the sheet's history entry is replaced, so «atrás» returns to the page under it. */
  function leaveSheetTo(hash) {
    const pushed = sheetPushed
    closeLayer()
    current.sig = null
    navIntent = 'link'
    if (location.hash === hash) render(); else if (pushed) location.replace(hash); else location.hash = hash
  }
  function sheetHash(query) { return basePath() + '?' + query }
  function showSheet(query) {
    if (!$('#capa-hoja').hidden) { navIntent = 'sheet'; location.replace(sheetHash(query)) } else go(sheetHash(query), 'sheet')
  }

  let toastTimer = null
  function toast(msg) {
    const box = $('#avisos')
    box.innerHTML = '<div class="toast">' + esc(msg) + '</div>'
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { box.innerHTML = '' }, 3600)
  }

  /* ───────────── Events ───────────── */
  const ACT = {
    'match-open': (el) => showSheet('hoja=partida' + (el.dataset.deck ? '&mazo=' + el.dataset.deck : current.route.deckId ? '&mazo=' + current.route.deckId : '') + (el.dataset.res ? '&res=' + el.dataset.res : '') + (el.dataset.rival ? '&rival=' + encodeURIComponent(el.dataset.rival) : '')),
    'search-open': () => showSheet('hoja=buscar&q='),
    'sheet-close': () => closeSheet(),
    'search-more': (el) => { searchOpen.add(el.dataset.k); const box = $('#search-results'); const y = box.scrollTop; box.innerHTML = searchResults(); box.scrollTop = y; sheetMore() },
    sheet: (el) => showSheet('hoja=acciones&de=' + el.dataset.s),
    launch: (el) => showSheet('hoja=lanzar&q=' + el.dataset.q + (el.dataset.deck ? '&mazo=' + el.dataset.deck : '')),
    card: (el) => showSheet('hoja=carta&c=' + encodeURIComponent(el.dataset.c)),
    go: (el) => leaveSheetTo(el.dataset.href),
    static: (el) => toast(el.dataset.msg || 'Solo en la app: la maqueta no lo hace.'),
    toggle: (el) => {
      const k = el.dataset.k
      const open = !ui.open.has(k)
      if (open) ui.open.add(k); else ui.open.delete(k)
      el.setAttribute('aria-expanded', open)
      const box = document.getElementById(el.getAttribute('aria-controls'))
      if (box) box.hidden = !open
      sheetMore()
    },
    'pend-more': () => { ui.open.add('pend'); $('#pend').innerHTML = pendList(); const b = $('#pend li:nth-child(' + (PEND_SHOWN + 1) + ') .pend'); if (b) b.focus({ preventScroll: true }) },
    'games-more': () => { ui.open.add('games'); $('#games').innerHTML = gamesList(); const b = $('#games li:nth-child(' + (GAMES_SHOWN + 1) + ') .game'); if (b) b.focus({ preventScroll: true }) },
    'pick-sort': (el) => { ui.pickSort = el.dataset.v; $('#pick').outerHTML = pickTable(); $$('#pick [data-count]').forEach((n) => { n.dataset.done = '1' }); const b = $('#pick [data-v="' + ui.pickSort + '"]'); if (b) b.focus({ preventScroll: true }) },
    'deck-filter': (el) => { ui.deckFilter = el.dataset.v; $$('[data-a="deck-filter"]').forEach((b) => b.setAttribute('aria-pressed', b === el)); $('#deck-list').innerHTML = deckList() },
    'job-filter': (el) => { ui.jobFilter = el.dataset.v; $$('[data-a="job-filter"]').forEach((b) => b.setAttribute('aria-pressed', b === el)); $('#job-list').innerHTML = jobList() },
    'meta-sort': (el) => { ui.metaSort = el.dataset.v; $$('[data-a="meta-sort"]').forEach((b) => b.setAttribute('aria-pressed', b === el)); $('#arch-list').innerHTML = archList() },
    'col-filter': (el) => { ui.colFilter = el.dataset.v; $$('[data-a="col-filter"]').forEach((b) => b.setAttribute('aria-pressed', b === el)); $('#col-list').innerHTML = colList() },
    'list-mode': (el) => { ui.listMode = el.dataset.v; $('#panel').innerHTML = panelLista(D.mazo); const b = $('#panel [data-a="list-mode"][data-v="' + ui.listMode + '"]'); if (b) b.focus({ preventScroll: true }) },
    tab: (el) => { navIntent = 'view'; location.replace(el.dataset.href) },
    back: (el) => { if (stack.length && '#' + stack[stack.length - 1] === el.getAttribute('href')) { history.back() } else go(el.getAttribute('href')) },
    pref: (el) => {
      if (el.getAttribute('aria-disabled') === 'true') { toast('Tu sistema pide reducir el movimiento: queda en «Ninguno».'); return }
      setPref(el.dataset.k, el.dataset.v); const y = window.scrollY; $('#principal').className = ''; $('#principal').innerHTML = viewMenu(); renderDock(current.route); window.scrollTo(0, y); const b = $('[data-a="pref"][data-k="' + el.dataset.k + '"][data-v="' + el.dataset.v + '"]'); if (b) b.focus({ preventScroll: true }) },
    'pref-thumbs': (el) => { setPref('miniaturas', pref('miniaturas') === 'si' ? 'no' : 'si'); el.setAttribute('aria-checked', pref('miniaturas') === 'si') },
    'motion-demo': () => { const d = $('#motion-demo'); d.classList.toggle('go') },
    sync: (el) => { const i = $('#sync-ico'); if (i && i.animate && root.dataset.movimiento !== 'ninguno') i.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: root.dataset.movimiento === 'expresivo' ? 900 : 300, easing: 'ease-in-out' }); toast('En la app trae la colección del juego y te muestra qué entró. La última: ' + D.cartas.coleccion.ultimaSyncTexto + '.') },
    'match-deck': (el) => { M.deckId = Number(el.dataset.deck); matchRender('deck-' + M.deckId) },
    'match-result': (el) => { M.result = M.result === el.dataset.v ? null : el.dataset.v; M.hint = false; matchRender('res-' + el.dataset.v) },
    'match-rival': (el) => { M.rival = el.dataset.v; M.rivalPicked = true; matchRender('st-yo') },
    'match-rival-clear': () => { M.rival = ''; M.rivalPicked = false; matchRender(); const f = $('#m-rival'); if (f) f.focus({ preventScroll: true }) },
    'match-start': (el) => { M.started = M.started === el.dataset.v ? null : el.dataset.v; matchRender('st-' + el.dataset.v) },
    'match-seen': () => {
      const next = D.partida.cartasVistasEjemplo.find((c) => !M.seen.some((s) => s.nombre === c.nombre))
      if (next) { M.seen.push(next); toast('En la app se abre el buscador de cartas en esta misma hoja; acá entran las del ejemplo.') } else toast('La maqueta trae dos cartas de ejemplo.')
      matchRender('seen-add')
    },
    'match-note': () => { M.noteOpen = !M.noteOpen; matchRender('note') },
    'match-save': () => {
      if (!M.result) { M.hint = true; matchRender('save'); return }
      M.saved = true; M.example = false; M.rank = null; M.fresh = true
      ui.open.delete('calc')
      matchApply(1)
      history.replaceState(null, '', sheetHash('hoja=partida&estado=guardada'))
      matchRender('undo')
    },
    'match-undo': () => {
      if (M.applied) matchApply(-1)
      M.saved = false
      history.replaceState(null, '', sheetHash('hoja=partida'))
      matchRender('save')
      toast('Deshecho: la partida no quedó guardada.')
    },
    'match-rank': (el) => {
      const i = Number(el.dataset.v)
      M.rank = M.rank === i ? null : i
      matchRender('rank-' + i)
      if (M.rank === i && /^Otro/.test(D.partida.respuesta.rango.opciones[i])) toast('En la app abre la lista de rangos para elegir otro. La maqueta solo lo marca.')
    },
    'match-again': (el) => {
      Object.keys(session).forEach((k) => { session[k].fresh = false })
      Object.assign(M, { result: el.dataset.v, rival: '', rivalPicked: false, started: null, seen: [], note: '', noteOpen: false, saved: false, example: false, applied: false, rank: null, hint: false })
      history.replaceState(null, '', sheetHash('hoja=partida'))
      matchRender('save')
    },
  }
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab')
    if (tab) {
      e.preventDefault()
      const t = tab.dataset.tab
      const rootHash = TABS.find((x) => x[0] === t)[3]
      if (current.tab === t) { if ('#' + current.path !== rootHash) go(rootHash); else window.scrollTo({ top: 0, behavior: root.dataset.movimiento === 'ninguno' ? 'auto' : 'smooth' }) } else go(tabMem[t], 'tab')
      return
    }
    const el = e.target.closest('[data-a]')
    if (el && ACT[el.dataset.a]) {
      if (el.tagName === 'A') e.preventDefault()
      ACT[el.dataset.a](el)
      return
    }
    const link = e.target.closest('a[href^="#/"]')
    if (link) {
      navIntent = 'link'
      if (!$('#capa-hoja').hidden) { e.preventDefault(); leaveSheetTo(link.getAttribute('href')) }
    }
  })
  document.addEventListener('input', (e) => {
    const t = e.target
    if (t.id === 'deck-q') { ui.deckQuery = t.value; $('#deck-list').innerHTML = deckList() }
    if (t.id === 'col-q') { ui.colQuery = t.value; $('#col-list').innerHTML = colList() }
    if (t.id === 'search-q') { searchQuery = t.value; searchOpen.clear(); $('#search-results').innerHTML = searchResults(); $('#search-results').scrollTop = 0; sheetMore() }
    if (t.id === 'm-rival') { M.rival = t.value; M.rivalPicked = false; $('#rival-area').innerHTML = rivalArea(); sheetMore() }
    if (t.id === 'm-note') M.note = t.value
  })
  document.addEventListener('change', (e) => {
    const t = e.target
    if (t.id === 'deck-sort') { ui.deckSort = t.value; $('#deck-list').innerHTML = deckList() }
    if (t.id === 'm-mode') M.mode = t.value
  })
  document.addEventListener('keydown', (e) => {
    const layer = $('#capa-hoja')
    if (e.key === 'Escape' && !layer.hidden) { e.preventDefault(); closeSheet(); return }
    /* Enter in a field never saves: it only closes the keyboard */
    if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); if (e.target.id !== 'search-q') e.target.blur(); return }
    if (e.key === 'Tab' && !layer.hidden) {
      const items = $$('a[href], button, input, select, textarea, [tabindex="0"]', layer).filter((x) => !x.disabled && x.offsetParent !== null)
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || !layer.contains(document.activeElement))) { e.preventDefault(); last.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      return
    }
    const horizontal = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
    if (e.target.matches('[role="tab"]') && (horizontal || e.key === 'Home' || e.key === 'End')) {
      const tabs = $$('[role="tab"]', e.target.parentNode)
      const at = tabs.indexOf(e.target)
      const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : tabs[(at + horizontal + tabs.length) % tabs.length]
      e.preventDefault()
      const id = next.id
      next.click()
      const again = document.getElementById(id)
      if (again) again.focus()
      return
    }
    if (e.target.matches('[role="radio"]') && horizontal) {
      const radios = $$('[role="radio"]', e.target.parentNode)
      const next = radios[(radios.indexOf(e.target) + horizontal + radios.length) % radios.length]
      e.preventDefault()
      next.focus()
    }
  })
  /* A touch keyboard shrinks the viewport (interactive-widget=resizes-content): while it is up, the bottom bars step aside. */
  const coarse = window.matchMedia ? matchMedia('(pointer: coarse)') : { matches: false }
  let fullHeight = window.innerHeight
  let lastWidth = window.innerWidth
  window.addEventListener('resize', () => {
    if (window.innerWidth !== lastWidth) { lastWidth = window.innerWidth; fullHeight = window.innerHeight }
    fullHeight = Math.max(fullHeight, window.innerHeight)
    root.classList.toggle('typing', coarse.matches && window.innerHeight < fullHeight - 140)
    sheetMore()
  })
  /* scroll does not bubble: listened on the way down */
  document.addEventListener('scroll', (e) => { if (e.target.classList && (e.target.classList.contains('sheet-body') || e.target.classList.contains('search-body'))) sheetMore() }, true)
  window.addEventListener('hashchange', render)
  if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', () => applyPrefs())
  if (lightScheme.addEventListener) lightScheme.addEventListener('change', () => applyPrefs())

  prefsFromUrl(parseHash().params)
  applyPrefs()
  render()
})()
