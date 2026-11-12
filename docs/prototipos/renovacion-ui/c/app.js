/* Maqueta C · «Consola de torneo». Plain JavaScript, no dependencies, no build step.
   Shows window.DATOS (../datos.js) and nothing else; where a datum is null it says «sin datos». */
;(function () {
  'use strict'
  const D = window.DATOS
  const root = document.documentElement
  const $ = (s, r = document) => r.querySelector(s)
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s))
  if (!D) {
    $('#contenido').innerHTML = '<p style="padding:24px">No se pudo cargar ../datos.js</p>'
    return
  }

  /* ---------- Formatting ---------- */
  const NB = ' '
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  function fnum(v, dec = 1) {
    const r = Math.round(v * 10 ** dec) / 10 ** dec
    const parts = Math.abs(r).toString().split('.')
    return (r < 0 ? '−' : '') + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (parts[1] ? ',' + parts[1] : '')
  }
  const fdec = (v, d = 2) => v.toFixed(d).replace('.', ',')
  const pct = (v) => fnum(v) + NB + '%'
  const pctG = (v) => `${fnum(v)}<small>%</small>`
  const sig = (v) => (v > 0 ? '+' : '') + fnum(v)
  const fecha = (iso) => {
    const p = iso.split('-')
    return `${+p[2]}/${+p[1]}`
  }
  const rec = (r) => `${fnum(r.v, 0)}${NB}V · ${fnum(r.d, 0)}${NB}D · ${fnum(r.e, 0)}${NB}E`
  const norm = (s) =>
    String(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[-/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
  const plural = (n, uno, muchos) => (n === 1 ? uno : muchos)
  /* Escaped name where «ex» never ends up alone on the next line and a hyphenated word («Mega-Sceptile») is not split. */
  const nb = (s) =>
    esc(s)
      .replace(/[0-9A-Za-zÀ-ÿ]+(?:-[0-9A-Za-zÀ-ÿ]+)+/g, (w) => `<span class="nw">${w}</span>`)
      .replace(/ ex(?![0-9A-Za-zÀ-ÿ])/g, NB + 'ex')
  /* Wilson interval (95 %), the one the app uses for a win rate; in %, one decimal. */
  function wilson(v, n) {
    if (!n) return [0, 100]
    const z = 1.959964
    const p = v / n
    const den = 1 + (z * z) / n
    const centro = (p + (z * z) / (2 * n)) / den
    const medio = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den
    const r = (x) => Math.round(Math.max(0, Math.min(1, x)) * 1000) / 10
    return [r(centro - medio), r(centro + medio)]
  }

  /* ---------- Icons (drawn for this mock-up; no game art) ---------- */
  const I = {
    menu: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
    atras: '<path d="M15 5l-7 7 7 7"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    lupa: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    der: '<path d="M9 5l7 7-7 7"/>',
    hoy: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14M7 10v4M15.5 10v4M18 10v4"/>',
    mazos: '<rect x="4" y="7" width="11" height="14" rx="2"/><path d="M8 4h9a2 2 0 0 1 2 2v12"/>',
    cartas: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 7.5h14M12 10.5l1.2 2.3 2.3 1.2-2.3 1.2-1.2 2.3-1.2-2.3L8.5 14l2.3-1.2z"/>',
    meta: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 5.5H5c0 2.5 1.2 4 3.2 4.3M16 5.5h3c0 2.5-1.2 4-3.2 4.3M12 13v4M8.5 20h7M10 17h4"/>',
    pruebas: '<path d="M9.5 3h5M10 3v6l-5 9a1.5 1.5 0 0 0 1.3 2.3h11.4A1.5 1.5 0 0 0 19 18l-5-9V3M7.5 15h9"/>',
    mas: '<path d="M12 5v14M5 12h14"/>',
    play: '<path d="M8 5.5v13l10-6.5z"/>',
    reloj: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    alerta: '<path d="M12 4l9 15.5H3zM12 10v4.5M12 17.3v.2"/>',
    ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
    diana: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    etiqueta: '<path d="M4 4h7.5l8.5 8.5-7.5 7.5L4 11.5zM8.2 8.2v.1"/>',
    cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    regalo: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18M12 9v11M12 9c-1.5-4-6-4-5.5-1.5C6.8 9 9.5 9 12 9zM12 9c1.5-4 6-4 5.500-1.500C17.200 9 14.500 9 12 9z"/>',
    cpu: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/><path d="M10 3v3.5M14 3v3.5M10 17.5V21M14 17.5V21M3 10h3.5M3 14h3.5M17.5 10H21M17.5 14H21"/>',
    sube: '<path d="M4 16l5.5-5.5 3.5 3.5L20 7M14.5 7H20v5.5"/>',
    baja: '<path d="M4 8l5.5 5.5 3.5-3.5L20 17M14.5 17H20v-5.5"/>',
    lista: '<path d="M9.5 6.5h10.500M9.500 12h10.500M9.500 17.500h10.500M4 6.500l1 1 1.800-2M4 12l1 1 1.800-2M4 17.500l1 1 1.800-2"/>',
    puntos: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    espadas: '<path d="M4.500 4.500l10 10M4.500 4.500V8l7.500 7.500M4.500 4.500H8l7.500 7.500M19.500 4.500l-4.500 4.500M19.500 4.500V8l-2 2M19.500 4.500H16l-2 2M6 16l2.500 2.500M4.500 19.500L7.200 16.800M18 16l-2.500 2.500M19.500 19.500l-2.700-2.700"/>',
    lapiz: '<path d="M4 20l1-4.500L16.500 4l3.500 3.500L8.500 19zM14 6.500l3.500 3.500"/>',
    logo: '<path d="M9 3.500H4.500v17H9M15 3.500h4.500v17H15"/><circle cx="12" cy="12" r="2.600" fill="currentColor" stroke="none"/>',
  }
  const ic = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`

  /* Energy glyphs: generic shapes (leaf, flame, drop, bolt, eye, fist, moon, nut, swirl, star). */
  const EG = {
    grass: '<path d="M20 4c0 10-4 16-11 16-1.500 0-2.900-.4-4-1C5 10 10 4 20 4z"/><path class="v_" d="M6 18.500c3.200-4.300 6.600-7.600 10.500-10.500"/>',
    fire: '<path d="M12.300 2.500c.5 3.500 4.700 5.300 4.700 10.200a5 5 0 0 1-10 0c0-2.200.9-3.900 2.100-5.100.2 1.700.9 2.800 2 3.200-.5-2.900 0-5.900 1.200-8.300z"/>',
    water: '<path d="M12 2.800c3.600 4.400 6 7.700 6 11.200a6 6 0 0 1-12 0c0-3.500 2.400-6.800 6-11.200z"/>',
    lightning: '<path d="M13.500 2L5.500 13.200h5L9.300 22l9.200-12.200h-5.200z"/>',
    psychic: '<path fill-rule="evenodd" d="M12 5.500c4.300 0 7.600 2.400 9.700 6.500-2.100 4.100-5.400 6.500-9.700 6.500S4.400 16.100 2.300 12C4.400 7.900 7.700 5.500 12 5.500zm0 2.700a3.800 3.800 0 1 0 0 7.600 3.800 3.800 0 0 0 0-7.600z"/><circle cx="12" cy="12" r="1.700"/>',
    fighting: '<rect x="4.500" y="6" width="3.300" height="8" rx="1.650"/><rect x="8.400" y="4.500" width="3.300" height="9" rx="1.650"/><rect x="12.300" y="4.500" width="3.300" height="9" rx="1.650"/><rect x="16.200" y="6" width="3.300" height="8" rx="1.650"/><path d="M4.500 11.500h15V15a5 5 0 0 1-5 5h-5a5 5 0 0 1-5-5z"/><path class="v_" d="M8.500 15.500h6"/>',
    darkness: '<path d="M19.500 14.800A8.300 8.300 0 0 1 9.200 4.500a8.300 8.300 0 1 0 10.300 10.300z"/>',
    metal: '<path fill-rule="evenodd" d="M12 2.500l8.200 4.750v9.500L12 21.500l-8.200-4.750v-9.500zm0 5.800a3.700 3.700 0 1 0 0 7.400 3.700 3.700 0 0 0 0-7.400z"/>',
    dragon: '<path class="s_" d="M12.600 12.300c0-1.600-2.400-1.500-2.400.4 0 2.300 3.200 3.300 5 1.300 2-2.200 1.200-6.300-2.700-7.200-4.300-1-8 2.300-7.500 6.800.4 3.900 4 6.500 8.500 5.900"/>',
    colorless: '<path d="M12 2.500l2.300 7.200 7.200 2.300-7.200 2.300-2.300 7.200-2.300-7.200L2.500 12l7.200-2.300z"/>',
  }
  const en = (e, g) => `<span class="en e-${e}${g ? ' en--g' : ''}" role="img" aria-label="${D.energias[e].nombre}"><svg viewBox="0 0 24 24" aria-hidden="true">${EG[e]}</svg></span>`
  const ens = (es) => es.map((e) => en(e)).join('')
  const eclass = (es) => 'e-' + es[0] + (es[1] ? ' e2-' + es[1] : '')

  /* ---------- Small pieces ---------- */
  const ORI = '<i class="ori" role="img" aria-label="orientativo"></i>'
  const COB = '<i class="cob" role="img" aria-label="sin matchups medidos contra el meta"></i>'
  const sello = (k) => `<span class="sello sello--${k}" aria-hidden="true">${k.toUpperCase()}</span>`
  const resTok = (r, c = '') => `<span class="res res--${r[0].toLowerCase()} ${c}" aria-hidden="true">${r[0]}</span>`
  const nom = (m) => `<span class="nro">#${m.id}</span> ${nb(m.nombre)}`
  const deck = (id) => D.mazos.find((m) => m.id === +id)
  const PH = `onerror="this.parentNode.classList.add('roto');this.remove()"`
  /* When an image does not load: the type colour with its glyph (a plain card for trainers); the large thumbnail of the card sheet adds the name. */
  const GCARTA = '<path fill-rule="evenodd" d="M7.500 3h9A2.500 2.500 0 0 1 19 5.500v13a2.500 2.500 0 0 1-2.500 2.500h-9A2.500 2.500 0 0 1 5 18.500v-13A2.500 2.500 0 0 1 7.500 3zm0 2a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-13a.5.5 0 0 0-.5-.5z"/><path d="M9 7h6v4.500H9zM9 14h6v1.600H9z"/>'
  const glifo = (tipo) => `<svg class="mini__g" viewBox="0 0 24 24" aria-hidden="true">${EG[tipo] || GCARTA}</svg>`
  const mini = (url, nombre, tipo, cls = '') =>
    `<span class="mini ${cls} e-${tipo || 'none'}"><img src="${esc(url)}" alt="" loading="lazy" decoding="async" width="63" height="88" ${PH}><span class="mini__n" lang="es">${glifo(tipo)}<span>${esc(nombre)}</span></span></span>`
  const artes = (m, n = 3, cls = '') =>
    m.miniaturas
      .slice(0, n)
      .map((u, i) => {
        const de = (m.miniaturasDe || [])[i] || {}
        return `<span class="arte ${cls} e-${de.tipo || 'none'}" title="${esc(de.nombre || '')}"><img src="${esc(u)}" alt="${esc(de.nombre || '')}" loading="lazy" decoding="async" width="63" height="88" ${PH}><span class="mini__n" aria-hidden="true">${glifo(de.tipo)}</span></span>`
      })
      .join('')
  function ibar(s, cls = '') {
    if (!s) return `<span class="ib ib--sd ${cls}" aria-hidden="true"></span>`
    const t = s.ci[0] > 50 ? ' ib--win' : s.ci[1] < 50 ? ' ib--loss' : ''
    return `<span class="ib${t} ${cls}" style="--lo:${s.ci[0]}%;--hi:${s.ci[1]}%;--p:${s.pct}%" aria-hidden="true"><i class="ib__r"></i><i class="ib__p"></i></span>`
  }
  function dv(s) {
    const p = s.pct
    const c = p > 50 ? 'dv--win' : p < 50 ? 'dv--loss' : ''
    return `<span class="dv ${c}${s.orientativo ? ' dv--ori' : ''}" style="--l:${Math.min(50, p)}%;--w:${Math.max(Math.abs(p - 50), 1.5)}%;${c ? '' : '--c:var(--tx2)'}" aria-hidden="true"><i></i></span>`
  }
  function spark(vals, w = 64, h = 22) {
    const max = Math.max(...vals)
    const min = Math.min(...vals)
    const x = (i) => 3 + (i * (w - 8)) / (vals.length - 1)
    const y = (v) => h - 4 - ((v - min) / (max - min || 1)) * (h - 8)
    const d = vals.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join('')
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" pathLength="1"/><circle cx="${x(vals.length - 1).toFixed(1)}" cy="${y(vals[vals.length - 1]).toFixed(1)}" r="2.6"/></svg>`
  }
  const ticks = (arr) => `<span class="ticks" aria-hidden="true">${arr.map((r) => `<i class="${r === 'V' ? 'v_' : r === 'D' ? 'd_' : 'e_'}"></i>`).join('')}</span>`
  const barra = (w, i = 0, cls = '') => `<span class="barra ${cls}" style="--w:${Math.max(0, Math.min(100, w)).toFixed(1)}%;--i:${i}" aria-hidden="true"><i></i></span>`
  const cambios = (arr) =>
    `<div class="cambios">${arr.map((c) => `<span class="cmb ${c.trim().charAt(0) === '+' ? 'cmb--mas' : 'cmb--menos'}">${esc(c)}</span>`).join('')}</div>`
  /* A cell of a board: % and n, the small mark for «orientativo», and its micro-chart. */
  function celda(s, o = {}) {
    if (!s) return `<span class="cel cel--sd"><span class="cel__v">sin datos</span>${o.dv ? '' : ibar(null)}</span>`
    return `<span class="cel"><span class="cel__v"><b class="num">${pct(s.pct)}</b><span class="n">n${NB}${fnum(s.n, 0)}</span>${s.orientativo ? ORI : ''}${o.cob != null && o.cob < 30 ? COB : ''}</span>${o.dv ? dv(s) : ibar(s)}</span>`
  }
  /* A source in full (fichas and evidence sheets): %, n, record, interval with its ends, the word «orientativo». */
  function fuente(sel, titulo, s, o = {}) {
    const cab = `<div class="fu__h">${sel ? sello(sel) : ''}<span>${titulo}</span>${s && s.orientativo ? '<span class="et et--ojo">orientativo</span>' : ''}</div>${o.sub ? `<p class="fu__sub">${o.sub}</p>` : ''}`
    const nota = o.nota ? `<p class="fu__n">${o.nota}</p>` : ''
    if (!s) return `<div class="fu">${cab}<div class="fu__v"><b class="sd">sin datos</b></div>${nota}</div>`
    return `<div class="fu">${cab}<div class="fu__v"><b class="num">${pct(s.pct)}</b><span class="fu__ci"><span>n${NB}=${NB}${fnum(s.n, 0)}${s.record ? ' · ' + rec(s.record) : ''}</span><span>IC${NB}95${NB}%: ${fnum(s.ci[0])}–${pct(s.ci[1])}</span></span></div><div class="fu__eje"><span aria-hidden="true">0</span>${ibar(s, 'ib--g')}<span aria-hidden="true">100</span></div>${nota}</div>`
  }

  /* ---------- State ---------- */
  const LS = 'maqueta-c'
  const OPC = { tema: ['oscuro', 'claro', 'sistema'], movimiento: ['expresivo', 'sutil', 'ninguno'], vistas: ['arriba', 'abajo'] }
  let guardado = {}
  try {
    guardado = JSON.parse(localStorage.getItem(LS) || '{}') || {}
  } catch (e) {}
  const prefs = {
    tema: OPC.tema.includes(guardado.tema) ? guardado.tema : 'oscuro',
    movimiento: OPC.movimiento.includes(guardado.movimiento) ? guardado.movimiento : 'expresivo',
    vistas: OPC.vistas.includes(guardado.vistas) ? guardado.vistas : 'arriba',
    minis: guardado.minis !== false,
  }
  const mqClaro = window.matchMedia('(prefers-color-scheme: light)')
  const mqQuieto = window.matchMedia('(prefers-reduced-motion: reduce)')
  function aplicarPrefs() {
    const t = prefs.tema === 'sistema' ? (mqClaro.matches ? 'claro' : 'oscuro') : prefs.tema
    root.dataset.tema = t
    root.dataset.movimiento = mqQuieto.matches ? 'ninguno' : prefs.movimiento
    root.dataset.vistas = prefs.vistas
    root.dataset.minis = prefs.minis ? 'si' : 'no'
    const m = $('meta[name="theme-color"]')
    if (m) m.content = t === 'claro' ? '#F5F6F8' : '#0B0E13'
  }
  function setPref(k, v) {
    prefs[k] = v
    try {
      localStorage.setItem(LS, JSON.stringify(prefs))
    } catch (e) {}
    aplicarPrefs()
  }
  const mov = () => root.dataset.movimiento
  mqClaro.addEventListener('change', aplicarPrefs)
  mqQuieto.addEventListener('change', aplicarPrefs)

  const S = {
    sort: { dia: 'torneo', mazos: 'num', rival: 'cuota', arq: 'cuota', mu: 'peor', vari: 'pct' },
    filtro: { mazos: 'todos', arq: 'todos', jobs: 'todas', col: 'todas' },
    q: { mazos: '', col: '' },
    regMazo: D.partida.mazosRecientes[0].id,
    notaArq: false,
  }
  const mem = {}
  let R = null
  let cur = { key: null }
  let primera = true
  let ultimaFuera = '#/hoy'
  let porEnlace = false
  let anclaTras = null // id to bring under the header once the next route is painted
  const scrollMem = {}

  /* What was saved in this session (newest first) goes on top of what the data says: the day's record, the streak,
     the week, the session decks, each deck's «mías» and the list of last matches are all derived from both. */
  const sesion = []
  let quitada = false // «Deshacer» on the deep-linked saved state takes the last match of the data out
  let ult = null // the match «Deshacer» would undo
  const lanzadas = [] // tests launched from the launch sheet in this session (they do not run)
  let sucio = false
  const letra = (res) => res[0].toLowerCase()
  function partidasHoy() {
    const base = D.hoy.ultimasPartidas.map((p, i) => Object.assign({ ref: 'd' + i }, p)).slice(quitada ? 1 : 0)
    return sesion.map((s, i) => ({ ref: 's' + i, resultado: s.resultado, mazoId: s.mazo, mazo: deck(s.mazo).nombre, rival: s.rival, cuando: 'recién', modalidad: s.modalidad, empezo: s.empezo })).concat(base)
  }
  function delta(id) {
    const r = { v: 0, d: 0, e: 0 }
    sesion.forEach((s) => {
      if (id == null || s.mazo === id) r[letra(s.resultado)]++
    })
    const q = D.hoy.ultimasPartidas[0]
    if (quitada && (id == null || q.mazoId === id)) r[letra(q.resultado)]--
    return r
  }
  function sumar(stat, x) {
    if (!x.v && !x.d && !x.e) return stat
    const b = stat ? stat.record || stat : { v: 0, d: 0, e: 0 }
    const r = { v: b.v + x.v, d: b.d + x.d, e: b.e + x.e }
    const n = r.v + r.d + r.e
    if (!n) return null
    return Object.assign({}, stat, { record: r, v: r.v, d: r.d, e: r.e, n, pct: Math.round((r.v / n) * 1000) / 10, ci: wilson(r.v, n), orientativo: n < 30 })
  }
  const miasDe = (id, stat) => sumar(stat, delta(id))
  function recDia() {
    const x = delta()
    return { v: D.hoy.record.v + x.v, d: D.hoy.record.d + x.d, e: D.hoy.record.e + x.e }
  }
  function recHoy() {
    const r = recDia()
    return `${r.v}–${r.d}${r.e ? '–' + r.e : ''}`
  }
  /* After saving or undoing: the page behind the sheet is painted again with the new numbers. */
  function pintarRec(gira) {
    if (cur.key) {
      const y = window.scrollY
      pintarPagina(false)
      window.scrollTo(0, y)
    }
    $$('[data-rec]').forEach((el) => {
      el.textContent = recHoy()
      if (gira) {
        el.classList.remove('gira')
        void el.offsetWidth
        el.classList.add('gira')
      }
    })
  }

  /* Card index for the card sheet. */
  const CARTAS = {}
  function addCarta(c, extra) {
    const nombre = c.nombre || c.carta
    const k = c.id || nombre
    CARTAS[k] = Object.assign(CARTAS[k] || {}, c, extra || {}, { nombre, k })
  }
  D.mazo.cartas.pokemon.concat(D.mazo.cartas.entrenadores).forEach((c) => addCarta(c, { enMazo: c.cant }))
  D.buscar.cartas.forEach((c) => addCarta(c))
  D.cartas.coleccion.muestra.forEach((c) => addCarta(c))
  D.cartas.sobres.faltan.forEach((c) => addCarta(c))
  D.partida.cartasVistasEjemplo.forEach((c) => {
    if (!Object.values(CARTAS).some((x) => x.nombre === c.nombre)) addCarta({ nombre: c.nombre, imagen: c.imagen, tipo: c.tipo })
  })

  /* ---------- Routing ---------- */
  const VISTAS = ['lista', 'rinde', 'mejorar', 'notas']
  const VN = { lista: 'Lista', rinde: 'Rinde', mejorar: 'Mejorar', notas: 'Notas' }
  function parse() {
    const h = (location.hash || '#/hoy').slice(1)
    const i = h.indexOf('?')
    const path = i < 0 ? h : h.slice(0, i)
    const q = {}
    ;(i < 0 ? '' : h.slice(i + 1)).split('&').forEach((p) => {
      const j = p.indexOf('=')
      if (p) q[j < 0 ? p : p.slice(0, j)] = j < 0 ? '' : decodeURIComponent(p.slice(j + 1))
    })
    const seg = path.split('/').filter(Boolean)
    return { path: '/' + seg.join('/'), seg, q }
  }
  function resolver(r) {
    const a = r.seg[0]
    const b = r.seg[1]
    const c = r.seg[2]
    if (a === 'mazos') return { key: 'mazos', sec: 'mazos', fn: pageMazos }
    if (a === 'mazo' && deck(b)) {
      const v = VISTAS.includes(c) ? c : 'lista'
      return { key: 'mazo/' + +b, sec: 'mazos', fn: () => pageMazo(+b, v), view: +b === D.mazo.id ? v : null, id: +b }
    }
    if (a === 'cartas') return b === 'coleccion' ? { key: 'coleccion', sec: 'cartas', fn: pageColeccion } : { key: 'sobres', sec: 'cartas', fn: pageSobres }
    if (a === 'pruebas') return b === 'resultado' ? { key: 'resultado', sec: 'pruebas', fn: pageResultado } : { key: 'pruebas', sec: 'pruebas', fn: pagePruebas }
    if (a === 'meta') return b === 'arquetipo' ? { key: 'arquetipo', sec: 'meta', fn: pageArquetipo } : { key: 'meta', sec: 'meta', fn: pageMeta }
    if (a === 'menu') return { key: 'menu', sec: null, fn: pageMenu }
    r.path = '/hoy'
    return { key: 'hoy', sec: 'hoy', fn: pageHoy }
  }
  const tieneHoja = (q) => !!(q.hoja || q.detalle || q.ev)
  const hrefHoja = (params) =>
    '#' +
    R.path +
    '?' +
    Object.keys(params)
      .map((k) => k + '=' + encodeURIComponent(params[k]))
      .join('&')
  const ev = (k) => hrefHoja({ ev: k })

  function route() {
    const prev = R
    R = parse()
    let cambio = false
    Object.keys(OPC).forEach((k) => {
      if (R.q[k] && OPC[k].includes(R.q[k]) && prefs[k] !== R.q[k]) {
        prefs[k] = R.q[k]
        cambio = true
      }
    })
    if (cambio) aplicarPrefs()
    const def = resolver(R)
    if (def.key !== cur.key || cambio || sucio) {
      const mismo = def.key === cur.key
      sucio = false
      if (cur.key && !mismo) scrollMem[cur.key] = window.scrollY
      cur = def
      pintarPagina(!mismo)
      // A link starts at the top; «atrás» and the bottom bar return to where the screen was.
      if (!mismo) window.scrollTo(0, porEnlace ? 0 : scrollMem[def.key] || 0)
    } else if (def.view !== cur.view) {
      cur = def
      cambiarVista()
    }
    if (def.sec) mem[def.sec] = '#' + R.path
    if (def.key !== 'menu') ultimaFuera = '#' + R.path
    pintarNav()
    $$('a[data-hq]').forEach((a) => a.setAttribute('href', '#' + R.path + '?' + a.dataset.hq))
    syncHoja(prev)
    if (anclaTras) {
      const el = document.getElementById(anclaTras)
      anclaTras = null
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - top.offsetHeight)
    }
    primera = false
    porEnlace = false
  }

  /* ---------- Frame ---------- */
  const top = $('#top')
  const main = $('#contenido')
  const nav = $('#nav')
  const pie = $('#pie')
  const shell = $('#shell')
  const lanz = $('#lanz')
  const slotAbajo = $('#vistas-abajo')
  const NAV = [
    ['hoy', 'Hoy', '#/hoy'],
    ['mazos', 'Mazos', '#/mazos'],
    ['cartas', 'Cartas', '#/cartas'],
    ['meta', 'Meta', '#/meta'],
    ['pruebas', 'Pruebas', '#/pruebas'],
  ]
  function pintarNav() {
    const pend = D.hoy.pendientes.length
    const foco = $$('a', nav).indexOf(document.activeElement)
    nav.innerHTML = NAV.map(([k, t, raiz]) => {
      const on = cur.sec === k
      return `<a href="${on ? raiz : mem[k] || raiz}"${on ? ' aria-current="page"' : ''}>${ic(k)}<span>${t}</span>${k === 'hoy' && pend && !on ? `<i class="nav__p" role="img" aria-label="${pend} pendientes"></i>` : ''}</a>`
    }).join('')
    if (foco >= 0) $$('a', nav)[foco].focus({ preventScroll: true })
    const job = D.pruebas.trabajos.find((j) => j.estado === 'corriendo')
    lanz.href = hrefHoja({ hoja: 'buscar' })
    lanz.style.setProperty('--p', job ? job.progreso.pct : 0)
    lanz.setAttribute('aria-label', 'Lanzador: buscar y lanzar' + (job ? `. Prueba #${job.id} corriendo: ${pct(job.progreso.pct)}` : ''))
    lanz.innerHTML = `${ic('lupa')}<span class="lanz__t">Buscar · lanzar</span>`
  }
  const tabsHtml = (v) =>
    VISTAS.map((k) => `<button role="tab" id="tab-${k}" aria-selected="${k === v}" aria-controls="panel" tabindex="${k === v ? 0 : -1}" data-vista="${k}">${VN[k]}</button>`).join('')
  function pintarPagina(entra) {
    const pg = cur.fn()
    const menuBtn = `<a class="top__b" href="#/menu" aria-label="Menú: aspecto y ajustes"${cur.key === 'menu' ? ' aria-current="page"' : ''}>${ic('menu')}</a>`
    top.className = 'top' + (pg.atras ? ' top--f' : '')
    top.innerHTML = pg.atras
      ? `<a class="top__b" href="${pg.atras}" aria-label="Volver">${ic('atras')}</a><div class="top__tx"><h1 class="top__t top__t--f">${pg.titulo}</h1>${pg.sub && pg.titulo.replace(/<[^>]+>/g, '').length <= 30 ? `<span class="top__s">${pg.sub}</span>` : ''}</div>${pg.extra || ''}${menuBtn}`
      : `<svg class="ic top__logo" viewBox="0 0 24 24" aria-hidden="true">${I.logo}</svg><div class="top__tx"><h1 class="top__t">${pg.titulo}</h1>${pg.sub ? `<span class="top__s">${pg.sub}</span>` : ''}</div>${pg.extra || ''}${menuBtn}`
    main.innerHTML = pg.html
    main.className = 'main' + (cur.view ? ' con-vistas' : '')
    const abajo = !!cur.view && prefs.vistas === 'abajo'
    slotAbajo.innerHTML = abajo ? tabsHtml(cur.view) : ''
    if (abajo) {
      slotAbajo.setAttribute('role', 'tablist')
      slotAbajo.setAttribute('aria-label', 'Vistas del mazo')
    } else {
      slotAbajo.removeAttribute('role')
      slotAbajo.removeAttribute('aria-label')
    }
    pie.classList.toggle('con-vistas', abajo)
    document.title = `${pg.doc || pg.titulo.replace(/<[^>]+>/g, '')} · TCG Pocket · maqueta C`
    if (entra) animar(main)
  }
  function animar(el) {
    el.classList.remove('entra')
    void el.offsetWidth
    el.classList.add('entra')
    contar(el)
  }
  /* Numbers of the scoreboard count up (expresivo only). */
  function contar(scope) {
    if (mov() !== 'expresivo') return
    $$('[data-cu]', scope).forEach((el) => {
      const to = +el.dataset.cu
      const dec = +(el.dataset.dec || 0)
      const nodo = el.firstChild
      if (!nodo || nodo.nodeType !== 3) return
      const fin = nodo.nodeValue
      const t0 = performance.now()
      const paso = (t) => {
        const k = Math.min(1, (t - t0) / 520)
        const e = 1 - Math.pow(1 - k, 3)
        nodo.nodeValue = k < 1 ? (dec === 2 ? fdec(to * e, 2) : fnum(to * e, dec)) : fin
        if (k < 1) requestAnimationFrame(paso)
      }
      requestAnimationFrame(paso)
    })
  }
  function cambiarVista() {
    const v = cur.view
    $$('[role="tab"][data-vista]').forEach((t) => {
      const on = t.dataset.vista === v
      t.setAttribute('aria-selected', on)
      t.tabIndex = on ? 0 : -1
    })
    const panel = $('#panel')
    panel.innerHTML = VISTA[v](D.mazo)
    panel.setAttribute('aria-labelledby', 'tab-' + v)
    animar(panel)
    const ancla = $('#ancla-vistas')
    const y = ancla.offsetTop - top.offsetHeight
    if (window.scrollY > y) window.scrollTo(0, y)
    document.title = `#${D.mazo.id} ${D.mazo.nombre} · ${VN[v]} · TCG Pocket · maqueta C`
  }

  /* ---------- Boards (sortable tables) ---------- */
  const T = {}
  function thB(tabla, key, label, cls = '') {
    const on = S.sort[tabla] === key
    return `<button class="th__b ${cls}" data-sort="${tabla}:${key}" aria-pressed="${on}">${label}<span class="th__f" aria-hidden="true">${on ? '▾' : ''}</span>${on ? '<span class="sr">, ordenado por esta columna</span>' : ''}</button>`
  }
  function reTabla(nombre, foco) {
    const el = $(`[data-tabla="${nombre}"]`)
    if (!el) return
    const antes = {}
    $$('[data-k]', el).forEach((r) => (antes[r.dataset.k] = r.getBoundingClientRect().top))
    el.innerHTML = T[nombre]()
    if (foco) {
      const b = $(`[data-sort="${nombre}:${S.sort[nombre]}"]`, el) || $(foco, el)
      if (b) b.focus({ preventScroll: true })
    }
    if (mov() !== 'expresivo') return
    $$('[data-k]', el).forEach((r) => {
      const a = antes[r.dataset.k]
      const d = a == null ? 0 : a - r.getBoundingClientRect().top
      if (d) r.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1)' })
      else if (a == null) r.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240 })
    })
  }

  /* ---------- Hoy ---------- */
  function rachaHoy() {
    const u = partidasHoy()
    let n = 0
    while (n < u.length && u[n].resultado === u[0].resultado) n++
    return { letra: u[0].resultado[0], n, tira: u.slice(0, 6).map((p) => p.resultado[0]).reverse() }
  }
  /* The session decks with what was saved in this session: today's record, the last results and «mías». */
  function mazosSesion() {
    const filas = D.hoy.mazosSesion.map((m) => {
      const x = delta(m.id)
      const nuevas = sesion.filter((s) => s.mazo === m.id).map((s) => s.resultado[0]).reverse()
      const base = quitada && D.hoy.ultimasPartidas[0].mazoId === m.id ? m.racha.slice(0, -1) : m.racha
      return Object.assign({}, m, { hoy: { v: m.hoy.v + x.v, d: m.hoy.d + x.d, e: m.hoy.e + x.e }, racha: base.concat(nuevas).slice(-8), mias: sumar(m.mias, x) })
    })
    sesion
      .map((s) => s.mazo)
      .filter((id, i, a) => a.indexOf(id) === i && !filas.some((f) => f.id === id))
      .forEach((id) => {
        const m = deck(id)
        const x = delta(id)
        filas.push(Object.assign({}, m, { hoy: x, racha: sesion.filter((s) => s.mazo === id).map((s) => s.resultado[0]).reverse(), mias: sumar(m.mias, x) }))
      })
    return filas
  }
  T.dia = () => {
    const k = S.sort.dia
    const val = (m) => m[k]
    const filas = D.hoy.mazosDelDia.map((m) => Object.assign({}, m, { mias: miasDe(m.id, m.mias) })).sort((a, b) => (val(b) ? val(b).pct : -1) - (val(a) ? val(a).pct : -1))
    return (
      `<div class="th th--3">${thB('dia', 'torneo', sello('t') + 'Torneo')}${thB('dia', 'mias', sello('m') + 'Mías')}${thB('dia', 'laboratorio', sello('b') + 'Bots ' + D.hoy.mazosDelDia[0].laboratorio.bot)}</div>` +
      filas
        .map(
          (m) => `<a class="fila fila--e fila--dia ${eclass(m.energias)}" data-k="${m.id}" href="${ev('dia:' + m.id)}" aria-haspopup="dialog">
        <span class="fila__a">${artes(m)}</span><span class="fila__n">${nom(m)}</span><span class="fila__e">${ens(m.energias)}</span>
        <span class="c3">${celda(m.torneo, { cob: m.torneo ? m.torneo.cobertura : null })}${celda(m.mias)}${celda(m.laboratorio)}</span></a>`,
        )
        .join('')
    )
  }
  function regTira() {
    const rs = D.partida.mazosRecientes
    const sel = rs.find((m) => m.id === S.regMazo) || rs[0]
    return `<div class="reg__m">
      <a class="reg__d" href="${hrefHoja({ hoja: 'partida', m: sel.id })}" aria-haspopup="dialog">${ens(sel.energias)}<span><small>Registrar con</small>${nom(sel)}</span></a>
      ${rs
        .filter((m) => m.id !== sel.id)
        .map((m) => `<button class="reg__o" data-act="reg-mazo" data-id="${m.id}" aria-label="Cambiar a #${m.id} ${esc(m.nombre)}">${ens(m.energias)}<span>#${m.id}</span></button>`)
        .join('')}
    </div>
    <div class="teclas">${['Victoria', 'Derrota', 'Empate'].map((r) => `<a class="tecla" href="${hrefHoja({ hoja: 'partida', m: sel.id, r: r[0] })}" aria-haspopup="dialog">${resTok(r)}${r}</a>`).join('')}</div>`
  }
  const ICP = { turno: 'espadas', clasificar: 'etiqueta', situaciones: 'diana', simulacion: 'cpu', laboratorio: 'pruebas', promo: 'regalo', evento: 'cal' }
  function movimiento(a, sube, href) {
    return `<a href="${href || '#/meta'}"${href ? ' aria-haspopup="dialog"' : ''}><span class="k ${sube ? 'ok' : 'mal'}">${ic(sube ? 'sube' : 'baja', 'ic--s')}${sube ? 'Sube' : 'Baja'}${a.nuevo ? ' · nuevo' : ''}</span>
      <span class="fila__n">${nb(a.nombre)}</span>
      <span class="v"><b class="num ${sube ? 'ok' : 'mal'}">${sig(a.delta)}${NB}pts</b><span style="--c:var(${sube ? '--win' : '--loss'})">${spark(a.serie, 60, 22)}</span></span>
      <span class="t3">cuota ${pct(a.cuota)} en ${D.hoy.meta.dias}${NB}días</span></a>`
  }
  function pageHoy() {
    const h = D.hoy
    const s = sumar(h.semana, delta())
    const rango = h.rango.split(', ')
    const ra = rachaHoy()
    const rd = recDia()
    const sv = D.cartas.sobres
    const punt = (nombre) => {
      const a = sv.alternativas.find((x) => x.nombre === nombre)
      return a ? a.numeros.puntaje : null
    }
    const ult5 = partidasHoy()
    return {
      titulo: 'Hoy',
      sub: `${cap(h.fechaTexto)} · era ${D.era}`,
      html: `
      <div class="mar mar--hoy">
        <a class="mar__c" href="${ev('hoy')}" aria-haspopup="dialog"><span class="k">Hoy</span><span class="v" data-rec>${recHoy()}</span><span class="vd" aria-hidden="true"><i class="v_" style="flex:${rd.v}"></i><i class="d_" style="flex:${rd.d}"></i>${rd.e ? `<i class="e_" style="flex:${rd.e}"></i>` : ''}</span><span class="sr">victorias y derrotas de hoy</span></a>
        <a class="mar__c" href="${ev('hoy')}" aria-haspopup="dialog"><span class="k">Racha</span><span class="v">${ra.n}<small class="${ra.letra === 'V' ? 'ok' : ra.letra === 'D' ? 'mal' : ''}">${ra.letra}</small></span><span class="s">${ticks(ra.tira)}</span></a>
        <a class="mar__c" href="${ev('semana')}" aria-haspopup="dialog"><span class="k">Semana</span><span class="v" data-cu="${s.pct}" data-dec="1">${fnum(s.pct)}<small>%</small></span><span class="s">n${NB}${s.n}${s.orientativo ? ORI : ''}</span></a>
        <a class="mar__c" href="${ev('rango')}" aria-haspopup="dialog"><span class="k">Rango</span><span class="v">${esc(rango[1] ? rango[1].replace(/\s*puntos/, '') : rango[0])}</span><span class="s">${esc(rango[1] ? rango[0] : '')}</span></a>
      </div>
      <section class="reg" data-reg aria-label="Registrar partida">${regTira()}</section>
      <section class="sec"><div class="sec__h"><h2>¿Qué mazo llevo hoy?</h2><span>${h.mazosDelDia.length} mejores, sin ganador</span></div>
        <div data-tabla="dia">${T.dia()}</div>
        <p class="ley"><span>Punto e intervalo sobre 0–100; la marca es 50${NB}%.</span><span>${ORI} orientativo: menos de 30</span><span>${COB} sin matchups medidos</span><span>${esc(h.mazosDelDiaMeta)}</span><span>Tocá una fila: las tres fuentes, con su intervalo.</span></p>
        <a class="mas" href="#/mazos">Ver los ${D.mazos.length} mazos${ic('der')}</a>
      </section>
      <section class="sec"><div class="sec__h"><h2>¿Qué sobre abro?</h2><span>puntaje</span></div>
        <a class="sobre" href="#/cartas"><span class="sobre__n">${esc(h.sobre.nombre)}</span><span class="sobre__p"><b class="num">${fdec(sv.veredicto.numeros.puntaje)}</b></span><span class="sobre__x">${esc(h.sobre.expansion)}</span><span class="sobre__q">${nb(h.sobre.porque)}</span></a>
        ${h.sobre.alternativas
          .map((a, i) => {
            const p = punt(a.nombre)
            return `<a class="fila fila--lin" href="#/cartas?detalle=sobre&s=${i + 1}"><span><span class="fila__n"><span class="nro">${i + 2}.º</span> ${esc(a.nombre)}${a.expansion === a.nombre ? '' : ` <span class="t3">· ${esc(a.expansion)}</span>`}</span><span class="fila__s"><span>${nb(a.motivo)}</span></span></span><b class="num">${p == null ? '' : fdec(p)}</b></a>`
          })
          .join('')}
      </section>
      <section class="sec"><div class="sec__h"><h2>Pendientes</h2><span>${h.pendientes.length}</span></div>
        ${h.pendientes
          .map((p) => {
            const urg = p.tipo === 'turno' || p.tipo === 'promo' ? ' fila--urg' : ''
            const dentro = `${ic(ICP[p.tipo] || 'der')}<span><span class="fila__n">${nb(p.texto)}</span><span class="fila__s"><span>${nb(p.detalle)}</span></span></span>${ic('der', 'ic--s')}`
            // A pending item that points at this same screen has no screen of its own in the mock-up: it says so.
            return p.destino === '#/hoy'
              ? `<button class="fila fila--pend${urg}" data-act="nohace" data-t="En la app abre «${esc(p.detalle.split(':')[0])}». En la maqueta esa pantalla no está.">${dentro}</button>`
              : `<a class="fila fila--pend${urg}" href="${p.destino}">${dentro}</a>`
          })
          .join('')}
      </section>
      <section class="sec"><div class="sec__h"><h2>Novedades del meta</h2><span>últimos ${h.meta.dias} días</span></div>
        <div class="movs">${movimiento(h.meta.sube, true)}${movimiento(h.meta.baja, false)}</div>
      </section>
      <section class="sec"><div class="sec__h"><h2>Cómo vengo</h2><span>mazos de la sesión</span></div>
        <div class="th" style="grid-template-columns:minmax(0,.8fr) minmax(0,1fr) minmax(0,1.2fr);gap:0 12px;padding-left:16px"><span class="th__e">Hoy</span><span class="th__e">Últimas</span><span class="th__e">${sello('m')}&nbsp;Mías</span></div>
        ${mazosSesion()
          .map(
            (m) => `<a class="fila fila--e fila--arq ${eclass(m.energias)}" style="grid-template-columns:minmax(0,.8fr) minmax(0,1fr) minmax(0,1.2fr)" href="${ev('ses:' + m.id)}" aria-haspopup="dialog">
          <span class="fila__n"><span>${nom(m)}</span>${ens(m.energias)}</span>
          <span class="cel"><span class="cel__v"><b class="num">${m.hoy.v}–${m.hoy.d}${m.hoy.e ? '–' + m.hoy.e : ''}</b></span></span>
          <span class="cel">${ticks(m.racha)}</span>
          ${celda(m.mias)}</a>`,
          )
          .join('')}
        <div class="sec__h"><h2>Últimas partidas</h2><span>${ult5.length} · tocá una para corregirla</span></div>
        ${ult5
          .map(
            (p) =>
              `<a class="fila fila--par fila--par2" href="${hrefHoja({ hoja: 'partida', editar: p.ref })}" aria-haspopup="dialog">${resTok(p.resultado)}<span><span class="fila__n"><span class="nro">#${p.mazoId}</span> ${nb(p.mazo)}</span><span class="fila__s"><span>${p.rival ? 'contra ' + nb(p.rival) : 'sin rival anotado'}</span></span><span class="fila__s fila__s--t t3"><span>${esc(p.modalidad)}${p.empezo ? (p.empezo === 'yo' ? ' · empezaste vos' : ' · empezó el rival') : ''}</span><span>${esc(p.cuando)}</span></span></span><span class="sr">${p.resultado}</span></a>`,
          )
          .join('')}
      </section>
      <p class="pie-nota">${esc(D.aviso)}. Datos del ${fecha(D.generado)}.</p>`,
    }
  }

  /* ---------- Mazos ---------- */
  /* A table whose rows are not columns gets a sorter («Ordenar: …») instead of column headings. */
  const orden = (tabla, ops) => `<div class="ord" role="group" aria-label="Ordenar"><span class="ord__k" aria-hidden="true">Ordenar</span>${ops.map((o) => thB(tabla, o[0], o[1])).join('')}</div>`
  T.mazos = () => {
    const k = S.sort.mazos
    const f = S.filtro.mazos
    const q = norm(S.q.mazos)
    const todos = D.mazos.map((m) => {
      const x = delta(m.id)
      return x.v || x.d || x.e ? Object.assign({}, m, { mias: sumar(m.mias, x), ultima: sesion.some((s) => s.mazo === m.id) ? D.hoy.fecha : m.ultima }) : m
    })
    const por = {
      num: (a, b) => a.id - b.id,
      pct: (a, b) => (b.mias ? b.mias.pct : -1) - (a.mias ? a.mias.pct : -1),
      n: (a, b) => (b.mias ? b.mias.n : -1) - (a.mias ? a.mias.n : -1),
      ult: (a, b) => (b.ultima || '').localeCompare(a.ultima || ''),
    }
    const filas = todos
      .filter((m) => (f === 'partidas' ? m.mias : f === 'incompletos' ? !m.completo : true) && (!q || norm('#' + m.id + ' ' + m.nombre).includes(q)))
      .sort(por[k])
    const chip = (v, t, n) => `<button class="chip" data-filtro="mazos:${v}" aria-pressed="${f === v}">${t} <span class="num">${n}</span></button>`
    return `<div class="pega"><div class="chips">${chip('todos', 'Todos', todos.length)}${chip('partidas', 'Con partidas', todos.filter((m) => m.mias).length)}${chip('incompletos', 'Les falta', todos.filter((m) => !m.completo).length)}</div>
      ${orden('mazos', [
        ['num', 'N.º'],
        ['ult', 'Última'],
        ['n', 'n'],
        ['pct', sello('m') + '%'],
      ])}</div>
      ${
        filas.length
          ? filas
              .map(
                (m) => `<a class="fila fila--e fila--mz ${eclass(m.energias)}" data-k="${m.id}" href="#/mazo/${m.id}">
        <span class="fila__a">${artes(m, 2, m.miniaturas.length === 1 ? 'arte--w' : '')}${ens(m.energias.slice().reverse())}</span>
        <span><span class="fila__n">${nom(m)}</span>${m.completo && !m.ultima ? '' : `<span class="fila__s">${m.completo ? '' : `<span class="et et--ojo">${plural(m.falta, 'falta', 'faltan')} ${m.falta}</span>`}${m.ultima ? `<span>últ. ${fecha(m.ultima)}</span>` : ''}</span>`}</span>
        <span class="fila__v">${m.mias ? `<b class="num">${pct(m.mias.pct)}</b><span class="n">n${NB}${m.mias.n}${m.mias.orientativo ? ORI : ''}</span>` : '<span class="sd">sin datos</span>'}</span></a>`,
              )
              .join('')
          : `<p class="bus__v">Ningún mazo coincide con «${esc(S.q.mazos)}».</p>`
      }`
  }
  function pageMazos() {
    const ms = D.mazos
    const n = (f) => ms.filter(f).length
    const hoyN = n((m) => m.ultima === D.hoy.fecha || sesion.some((s) => s.mazo === m.id))
    const jug = n((m) => m.mias || sesion.some((s) => s.mazo === m.id))
    return {
      titulo: 'Mazos',
      sub: `${ms.length} armados · era ${D.era}`,
      html: `
      <div class="mar" style="grid-template-columns:minmax(0,.92fr) minmax(0,1.1fr) minmax(0,1.1fr) minmax(0,.88fr)">
        <div class="mar__c"><span class="k">Armados</span><span class="v" data-cu="${ms.length}">${ms.length}</span><span class="s">mazos</span></div>
        <div class="mar__c"><span class="k">Completos</span><span class="v" data-cu="${n((m) => m.completo)}">${n((m) => m.completo)}</span><span class="s">les falta a ${n((m) => !m.completo)}</span></div>
        <div class="mar__c"><span class="k">Jugados</span><span class="v" data-cu="${jug}">${jug}</span><span class="s">con partidas</span></div>
        <div class="mar__c"><span class="k">Hoy</span><span class="v" data-cu="${hoyN}">${hoyN}</span><span class="s">${plural(hoyN, 'mazo', 'mazos')}</span></div>
      </div>
      <section class="sec sec--pri">
        <div class="subnav subnav--c"><label class="campo">${ic('lupa')}<span class="sr">Buscar un mazo</span><input id="q-mazos" type="search" placeholder="Buscar por nombre o número" autocomplete="off" enterkeyhint="search" value="${esc(S.q.mazos)}"></label></div>
        <div data-tabla="mazos">${T.mazos()}</div>
        <p class="ley"><span>${sello('m')} mis partidas: % de victorias y n</span><span>${ORI} orientativo: menos de 30</span><span>Tocá una fila: abre la ficha, con el intervalo y el récord.</span></p>
      </section>`,
    }
  }

  /* ---------- Ficha del mazo ---------- */
  const PQ = D.pruebas.preguntas
  /* One of the three numbers of the header strip: source, % and n on one line; the chart and the interval are in «Rinde». */
  function numFuente(sel, titulo, s, href) {
    const dentro = `<span class="k">${sello(sel)}${titulo}</span>${s ? `<span class="fn__v"><b class="num">${fnum(s.pct)}<small>%</small></b><span class="n">n${NB}${fnum(s.n, 0)}${s.orientativo ? ORI : ''}</span></span>` : '<span class="fn__v sd">sin datos</span>'}`
    return href ? `<a class="fn" href="${href}">${dentro}</a>` : `<button class="fn" data-act="ir" data-a="fuentes">${dentro}</button>`
  }
  /* The compact header of a deck: thumbnails and state, the three numbers in a row, the note in two lines, the actions. */
  function cabFicha(m, o) {
    const hq = (p) => `hoja=lanzar&p=${p}&m=${m.id}`
    return `<div class="fch ${eclass(m.energias)}">
        <div class="fch__a"><span class="cab__a">${artes(o.artes || m, 3)}</span><span class="cab__t">${o.estado}</span></div>
        <div class="fch__n">${numFuente('m', 'Mías', o.mias, o.rinde)}${numFuente('t', 'Torneo', o.torneo, o.rinde)}${numFuente('b', 'Bots' + (o.bot ? ' ' + esc(o.bot) : ''), o.bots, o.rinde)}</div>
        ${o.nota ? `<a class="nota3" href="${o.notas}"><p>${esc(o.nota)}</p><span>ver más${ic('der', 'ic--s')}</span></a>` : ''}
      </div>
      <div class="acc3"><a class="tecla tecla--p" href="${hrefHoja({ hoja: 'partida', m: m.id })}" data-hq="hoja=partida&m=${m.id}" aria-haspopup="dialog">${ic('mas')}Registrar</a><a class="tecla" href="#${R.path}?${hq(PQ[0].id)}" data-hq="${hq(PQ[0].id)}" aria-haspopup="dialog" aria-label="Probar contra el meta">Probar vs meta</a><a class="tecla" href="#${R.path}?${hq(PQ[1].id)}" data-hq="${hq(PQ[1].id)}" aria-haspopup="dialog">Buscar mejoras</a></div>`
  }
  /* «Tu lista: falta N · Versión de torneo: faltan N», with the link to the pack. Two lines when nothing is missing;
     the block with the names only when something is. */
  function faltaBloque(o) {
    const parte = (n, uno) => (n == null ? '<span class="sd">sin datos</span>' : `<b class="${n ? 'ojo' : 'ok'}">${n === 1 || (uno && !n) ? 'falta' : 'faltan'} ${n}</b>`)
    if (!o.tu && !o.torneo) {
      return `<a class="falta1" href="#/cartas"><span class="falta1__t">Tu lista: ${parte(o.tu, true)} · Versión de torneo: ${parte(o.torneo)}</span><span class="falta1__d">${o.det || 'completo con tu colección'}</span><span class="falta1__s">Qué sobre abrir${ic('der', 'ic--s')}</span></a>`
    }
    const nombres = (a) => (a && a.length ? esc(a.join(', ')) : '')
    const hayFilas = !!(o.cartas && o.cartas.length)
    return `<div class="duo">
        <div><div class="k">Tu lista</div><div class="v">${parte(o.tu, true)}</div><div class="s">${nombres(o.tuCartas) || (o.tu ? (hayFilas ? '' : 'cuáles: sin datos en la maqueta') : 'completa con tu colección')}</div></div>
        <div><div class="k">Versión de torneo</div><div class="v">${parte(o.torneo)}</div><div class="s">${nombres(o.torneoCartas) || (o.torneo == null ? 'la maqueta no la trae para este mazo' : o.det || (o.torneo ? (hayFilas ? '' : 'cuáles: sin datos en la maqueta') : ''))}</div></div>
      </div>
      ${(o.cartas || [])
        .map(
          (c) =>
            `<a class="fila fila--carta" href="${ev('carta:' + c.carta)}" aria-haspopup="dialog"><span class="q ojo">${c.falta}<small>×</small></span>${mini(c.imagen, c.carta, c.tipo)}<span><span class="fila__n">${esc(c.carta)}</span><span class="fila__s">${cap(c.consejo)}: ${esc(c.sobre)}</span></span><span class="fila__v"><span class="num">${fnum(c.puntos, 0)}</span><span class="n">puntos</span></span></a>`,
        )
        .join('')}
      <a class="mas" href="#/cartas">Qué sobre abrir para lo que falta${o.dias ? ` · ~${o.dias} días` : ''}${ic('der')}</a>`
  }
  const filaCarta = (c) =>
    `<a class="fila fila--carta" href="${ev('carta:' + c.id)}" aria-haspopup="dialog"><span class="q">${c.cant}<small>×</small></span>${mini(c.imagen, c.nombre, c.tipo)}<span><span class="fila__n">${esc(c.nombre)}</span><span class="fila__s">${esc(c.clase)}<span class="mono">${esc(c.id)}</span></span></span><span class="fila__v">${c.tipo ? en(c.tipo) : ''}${c.puntos ? `<span class="n">${c.puntos}${NB}${plural(c.puntos, 'pt', 'pts')}</span>` : ''}</span></a>`
  const VISTA = {
    lista(z) {
      const f = z.falta
      const suma = (a) => a.reduce((t, c) => t + c.cant, 0)
      // How far the tournament version is comes from the text of the data («Está a 1 cambio: …»), the same one «Mejorar» shows.
      const cam = /a \d+ cambios?/.exec(z.mejorar[0].respuesta)
      return `<section class="sec">
        ${faltaBloque({ tu: f.tuLista.n, tuCartas: f.tuLista.cartas, torneo: f.torneo.n, torneoCartas: f.torneo.cartas, det: `${esc(f.torneo.lista)}${cam ? ', ' + cam[0] : ''}` })}
        <div class="sec__h"><h2>Pokémon</h2><span>${suma(z.cartas.pokemon)} cartas</span></div>${z.cartas.pokemon.map(filaCarta).join('')}</section>
      <section class="sec"><div class="sec__h"><h2>Entrenadores</h2><span>${suma(z.cartas.entrenadores)} cartas</span></div>${z.cartas.entrenadores.map(filaCarta).join('')}</section>
      <p class="pie-nota">Rev. ${z.revision} · ${suma(z.cartas.pokemon) + suma(z.cartas.entrenadores)} cartas · Energía: ${z.energias.map((e) => D.energias[e].nombre).join(', ')}. «pt»: los puntos que se lleva el rival si debilita a ese Pokémon. Tocá una carta: su ficha, con ediciones y dónde se consigue.</p>`
    },
    rinde(z) {
      const r = z.rinde
      return `<section class="sec"><div class="sec__h"><h2>Tres fuentes</h2><span>nunca se mezclan</span></div>
        ${fuente('m', 'Mis partidas', miasDe(z.id, r.mias))}
        ${r.torneo.filas
          .map((f) => {
            // «Arquetipo: Butterfree Mega Sceptile ex»: the kind in the label, the name under it.
            const i = f.etiqueta.indexOf(': ')
            return fuente('t', 'Torneo · ' + esc(i < 0 ? f.etiqueta : f.etiqueta.slice(0, i)), f, { sub: i < 0 ? '' : nb(f.etiqueta.slice(i + 2)), nota: `En ${f.listas} listas.` })
          })
          .join('')}
        <p class="txt" style="padding-top:8px">${esc(r.torneo.nota)}</p>
        ${fuente('b', 'Simulación · bot ' + esc(r.simulacion.bot), r.simulacion, { nota: esc(r.simulacion.nota) })}
        <p class="ley"><span>Punto: el porcentaje. Banda: el intervalo de 95${NB}%. Marca: 50${NB}%.</span></p>
      </section>
      <section class="sec e-${z.energias[0]}"><div class="sec__h"><h2>Mis partidas por semana</h2><span>% de victorias</span></div>${curvaSemanas(r.curva)}</section>
      <section class="sec"><div class="sec__h"><h2>Por rival</h2><span>cuota en el meta</span></div>
        <div data-tabla="rival">${T.rival()}</div>
        <p class="ley"><span>${ORI} orientativo: menos de 30</span><span>Barra: distancia al 50${NB}%.</span><span>Mías y Torneo ordenan del peor al mejor.</span><span>Tocá una fila: intervalo y récord.</span></p>
      </section>
      <section class="sec"><div class="sec__h"><h2>Empezar o ir segundo</h2><span>mis partidas</span></div>
        ${fuente(null, 'Empezando', r.empezar.primero)}${fuente(null, 'Yendo segundo', r.empezar.segundo)}
        <p class="txt" style="padding-top:10px">${esc(r.empezar.texto)}</p>
      </section>`
    },
    mejorar(z) {
      const lanzar = (p) => `#${R.path}?hoja=lanzar&p=${p.id}&m=${z.id}`
      return `<section class="sec e-${z.energias[0]}">${z.mejorar
        .map((p, i) => {
          const q = PQ.find((x) => x.titulo === p.pregunta)
          // «Medir de nuevo» launches the test of that question with this deck already set.
          const accion = p.destino && !(q && p.destino === '#/pruebas')
            ? `<a class="tecla" href="${p.destino}">${esc(p.accion)}${ic('der', 'ic--s')}</a>`
            : q
              ? `<a class="tecla" href="${lanzar(q)}" data-hq="hoja=lanzar&p=${q.id}&m=${z.id}" aria-haspopup="dialog">${ic('play', 'ic--s')}${esc(p.accion)}</a>`
              : `<button class="tecla" data-act="nohace" data-t="En la app, «${esc(p.accion)}» abre su pantalla con este mazo puesto. La maqueta no la trae.">${esc(p.accion)}</button>`
          return `<div class="preg"><h3>${esc(p.pregunta)}</h3><p class="preg__r">${esc(p.respuesta)}</p>
          ${i === 0 ? cambios(z.falta.torneo.cambios) : ''}${p.curva ? curvaTurnos(p.curva) : ''}
          <p class="preg__d">${esc(p.detalle)}</p>
          ${accion}</div>`
        })
        .join('')}</section>
      <section class="sec"><div class="sec__h"><h2>Lanzar una prueba</h2><span>con este mazo</span></div>
        <div class="pq">${PQ.map((p) => `<a class="pq__b" href="${lanzar(p)}" data-hq="hoja=lanzar&p=${p.id}&m=${z.id}" aria-haspopup="dialog">${esc(p.titulo)}<span>${ic('play', 'ic--s')}Lanzar</span></a>`).join('')}</div>
      </section>`
    },
    notas(z) {
      return `<section class="sec e-${z.energias[0]}"><div class="sec__h"><h2>Notas</h2><span>${z.notas.length} líneas</span></div>
        <ul class="lista-n">${z.notas.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        <button class="btn-l" data-act="nohace" data-t="En la app se edita acá mismo. En la maqueta las notas no se cambian.">${ic('lapiz', 'ic--s')}Editar las notas</button>
      </section>
      <section class="sec"><div class="sec__h"><h2>Revisiones y cambios</h2><span>va por la rev. ${z.revision}</span></div>
        ${z.revisiones
          .map(
            (r) =>
              `<div class="rev"><div class="rev__h"><b>rev. ${r.n}</b><span>${fecha(r.fecha)} · ${esc(r.origen)}</span></div>${r.nota ? `<p class="t2">${esc(r.nota)}</p>` : '<p class="sd">sin nota</p>'}${r.cambios ? cambios(r.cambios) : '<p class="sd">cambios: sin datos</p>'}</div>`,
          )
          .join('')}
      </section>`
    },
  }
  function curvaSemanas(c) {
    const W = 336
    const H = 96
    const x = (i) => W / c.length / 2 + (i * W) / c.length
    const y = (v) => H - 10 - v * 0.76
    const d = c.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.pct).toFixed(1)).join('')
    return `<div class="gwrap"><svg class="graf" viewBox="0 0 ${W} ${H}" style="--c:var(--e)" role="img" aria-label="Porcentaje de victorias por semana"><line class="eje" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}"/><line class="medio" x1="0" x2="${W}" y1="${y(50)}" y2="${y(50)}"/><path class="ar" d="${d}L${x(c.length - 1).toFixed(1)} ${y(0)}L${x(0).toFixed(1)} ${y(0)}Z"/><path class="l1" d="${d}" pathLength="1"/>${c.map((p, i) => `<circle class="p1" cx="${x(i).toFixed(1)}" cy="${y(p.pct).toFixed(1)}" r="${(3 + Math.min(p.n, 13) / 4.4).toFixed(1)}"/>`).join('')}</svg>
      <div class="gcols" style="--n:${c.length};--c:var(--e)">${c.map((p, i) => `<span class="${i === c.length - 1 ? 'hi' : ''}"><b>${pct(p.pct)}</b>n${NB}${p.n}<br>${fecha(p.semana)}</span>`).join('')}</div>
      <p class="t3" style="margin-top:8px">Punto más grande: más partidas esa semana. Línea punteada: 50${NB}%.</p></div>`
  }
  function curvaTurnos(c) {
    const W = 336
    const dos = c[0].meta != null
    const tope = Math.max(...c.map((p) => p.pct)) > 60 ? 100 : 60
    const H = tope === 100 ? 84 : 58
    const x = (i) => W / c.length / 2 + (i * W) / c.length
    const y = (v) => H - 8 - v * 0.7
    const linea = (k) => c.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[k]).toFixed(1)).join('')
    return `<div><svg class="graf" viewBox="0 0 ${W} ${H}" style="--c:var(--e)" role="img" aria-label="Curva acumulada por turno"><line class="eje" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}"/><line class="medio" x1="0" x2="${W}" y1="${y(50)}" y2="${y(50)}"/>${dos ? `<path class="l2" d="${linea('meta')}"/>` : ''}<path class="l1" d="${linea('pct')}" pathLength="1"/>${c.map((p, i) => `<circle class="p1" cx="${x(i).toFixed(1)}" cy="${y(p.pct).toFixed(1)}" r="3.4"/>`).join('')}</svg>
      <div class="gcols" style="--n:${c.length};--c:var(--e)">${c.map((p) => `<span>T${p.turno}<b>${fnum(p.pct)}</b>${dos ? fnum(p.meta) : ''}</span>`).join('')}</div>
      <p class="t3" style="margin-top:6px">${dos ? '% de partidas con el atacante listo: arriba, contra un rival pasivo (línea llena); abajo, contra el meta (punteada).' : '% de las veces que ya lo robaste, por turno (T0 = mano inicial).'}</p></div>`
  }
  T.rival = () => {
    const k = S.sort.rival
    const por = {
      cuota: (a, b) => b.cuota - a.cuota,
      mias: (a, b) => (a.mias ? a.mias.pct : 999) - (b.mias ? b.mias.pct : 999),
      torneo: (a, b) => (a.torneo ? a.torneo.pct : 999) - (b.torneo ? b.torneo.pct : 999),
    }
    const filas = D.mazo.rinde.porRival.map((r, i) => Object.assign({ i }, r)).sort(por[k])
    const max = Math.max(...filas.map((r) => r.cuota))
    return (
      `<div class="th th--3">${thB('rival', 'cuota', 'Cuota')}${thB('rival', 'mias', sello('m') + 'Mías')}${thB('rival', 'torneo', sello('t') + 'Torneo')}</div>` +
      filas
        .map((r) => {
          const a = D.meta.arquetipos.find((x) => x.nombre === r.rival)
          return `<a class="fila fila--arq${a ? ' fila--e ' + eclass(a.energias) : ''}" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:5px 0" data-k="${r.i}" href="${ev('rival:' + r.i)}" aria-haspopup="dialog"><span class="fila__n"><span>${nb(r.rival)}</span>${a ? `<span class="fila__s" style="flex-wrap:nowrap">${ens(a.energias)}</span>` : ''}</span><span class="cel"><span class="cel__v"><b class="num">${pct(r.cuota)}</b></span>${barra((r.cuota / max) * 100, 0)}</span>${celda(r.mias, { dv: 1 })}${celda(r.torneo, { dv: 1 })}</a>`
        })
        .join('')
    )
  }
  function pageMazo(id, v) {
    const z = D.mazo
    const m = deck(id)
    if (id !== z.id) {
      // The data brings one deck in full (#${z.id}); the others show what the data has about them, in the same frame.
      const d = D.hoy.mazosDelDia.find((x) => x.id === id)
      const pm = D.cartas.sobres.porMazo.find((x) => x.id === id)
      const mias = miasDe(id, m.mias)
      const jugo = m.ultima || sesion.some((s) => s.mazo === id)
      return {
        titulo: nom(m),
        doc: `#${m.id} ${m.nombre}`,
        atras: '#/mazos',
        extra: ens(m.energias),
        html: `${cabFicha(m, {
          artes: d || m,
          estado: `${m.completo ? 'Completo con tu colección' : `${plural(m.falta, 'Falta', 'Faltan')} ${m.falta} ${plural(m.falta, 'carta', 'cartas')}`}<br>${jugo ? 'última partida ' + (sesion.some((s) => s.mazo === id) ? 'hoy' : fecha(m.ultima)) : 'sin partidas'}`,
          mias,
          torneo: d ? d.torneo : null,
          bots: d ? d.laboratorio : null,
          bot: d ? d.laboratorio.bot : '',
        })}
        <section class="sec">${faltaBloque({ tu: pm ? pm.tuLista : m.falta, torneo: pm ? pm.torneo : null, dias: pm ? pm.dias : null, cartas: D.cartas.sobres.faltan.filter((c) => c.mazos.includes('#' + id)), det: pm ? '' : 'versión de torneo: la maqueta no la trae para este mazo' })}</section>
        <section class="sec" id="fuentes"><div class="sec__h"><h2>Tres fuentes</h2><span>nunca se mezclan</span></div>
          ${fuente('m', 'Mis partidas', mias, { nota: mias ? '' : 'Todavía no registraste partidas con este mazo.' })}
          ${d ? fuente('t', 'Torneo · su arquetipo contra el meta', d.torneo, { nota: `Matchups con datos: ${pct(d.torneo.cobertura)} del meta.` }) : fuente('t', 'Torneo', null, { nota: 'La maqueta trae el número de torneo solo de los tres mazos del inicio.' })}
          ${d ? fuente('b', 'Laboratorio · bot ' + esc(d.laboratorio.bot), d.laboratorio) : fuente('b', 'Laboratorio', null)}
        </section>
        <section class="sec"><p class="sec__p" style="padding-top:12px">Lista, Rinde, Mejorar y Notas están armadas para #${z.id} ${nb(z.nombre)}, el único mazo que los datos de la maqueta traen entero.</p>
          <a class="mas" href="#/mazo/${z.id}">Abrir la ficha de #${z.id}${ic('der')}</a></section>`,
      }
    }
    const r = z.rinde
    const ses = D.hoy.mazosSesion.find((x) => x.id === id) || m
    const base = '#/mazo/' + id
    return {
      titulo: nom(z),
      doc: `#${z.id} ${z.nombre} · ${VN[v]}`,
      atras: '#/mazos',
      extra: ens(z.energias),
      html: `
      ${cabFicha(z, {
        artes: ses,
        estado: `Rev. ${z.revision} · ${z.armado ? 'armado' : 'sin armar'} · ${z.valido ? 'válido' : 'no valida'}<br>${z.completo ? 'completo con tu colección' : 'incompleto'}`,
        mias: miasDe(id, r.mias),
        torneo: r.torneo,
        bots: r.simulacion,
        bot: r.simulacion.bot,
        rinde: base + '/rinde',
        nota: z.notasCortas,
        notas: base + '/notas',
      })}
      <div id="ancla-vistas"></div>
      ${prefs.vistas === 'arriba' ? `<div class="vistas" role="tablist" aria-label="Vistas del mazo">${tabsHtml(v)}</div>` : ''}
      <div class="panel" id="panel" role="tabpanel" aria-labelledby="tab-${v}" tabindex="-1">${VISTA[v](z)}</div>`,
    }
  }

  /* ---------- Cartas: Sobres y Colección ---------- */
  const segCartas = (cual) =>
    `<nav class="seg seg--top" aria-label="Cartas"><a href="#/cartas"${cual === 's' ? ' aria-current="page"' : ''}>Sobres</a><a href="#/cartas/coleccion"${cual === 'c' ? ' aria-current="page"' : ''}>Colección</a></nav>`
  const packs = () => [Object.assign({ motivo: null }, D.cartas.sobres.veredicto)].concat(D.cartas.sobres.alternativas)
  function pageSobres() {
    const s = D.cartas.sobres
    const v = s.veredicto
    const max = v.numeros.puntaje
    return {
      titulo: 'Cartas',
      doc: 'Cartas · Sobres',
      extra: segCartas('s'),
      html: `
      <div class="mar" style="--n:3">
        <button class="mar__c" data-act="ir" data-a="plazos" style="text-align:left"><span class="k ojo">Promo</span><span class="v">${esc(s.promo.quedan.split(' ')[0])}<small>${esc(s.promo.quedan.split(' ').slice(1).join(' '))}</small></span><span class="s">hasta el ${fecha(s.promo.vence)}</span></button>
        <button class="mar__c" data-act="ir" data-a="plazos" style="text-align:left"><span class="k">Cupón ★★</span><span class="v">${fecha(s.cupon.vence)}</span><span class="s">vence</span></button>
        <button class="mar__c" data-act="ir" data-a="faltan" style="text-align:left"><span class="k">Faltan</span><span class="v" data-cu="${s.faltanTotal}">${s.faltanTotal}</span><span class="s">para los mazos</span></button>
      </div>
      <section class="sec"><div class="sec__h"><h2>Conviene abrir</h2><span>puntaje</span></div>
        <div class="sobre"><span class="sobre__n">${esc(v.nombre)}</span><span class="sobre__p"><b class="num" data-cu="${v.numeros.puntaje}" data-dec="2">${fdec(v.numeros.puntaje)}</b></span><span class="sobre__x">${esc(v.expansion)} · <span class="mono">${esc(v.expansionId)}</span></span>
          <ul class="porque">${v.porque.map((p) => `<li>${nb(p)}</li>`).join('')}</ul></div>
        <div style="padding:0 12px 12px 16px"><a class="tecla" href="#/cartas?detalle=sobre" aria-haspopup="dialog">Ver los números${ic('der', 'ic--s')}</a></div>
      </section>
      <section class="sec"><div class="sec__h"><h2>Alternativas</h2><span>tocá una: sus números</span></div>
        ${s.alternativas
          .map(
            (a, i) => `<a class="fila fila--lin" href="#/cartas?detalle=sobre&s=${i + 1}" aria-haspopup="dialog"><span><span class="fila__n"><span class="nro">${i + 2}.º</span> <b>${esc(a.nombre)}</b> <span class="t3">· ${a.expansion === a.nombre ? '' : esc(a.expansion) + ' · '}${esc(a.expansionId)}</span></span><span class="fila__s"><span>${nb(a.motivo)}</span></span>${barra((a.numeros.puntaje / max) * 100, i)}</span><b class="num" style="font-size:19px">${fdec(a.numeros.puntaje)}</b></a>`,
          )
          .join('')}
      </section>
      <section class="sec"><div class="sec__h"><h2>Objetivos</h2><span>lo que ordena la recomendación</span></div>
        <div class="fila fila--lin"><span class="fila__n">${esc(s.objetivos)}</span><a class="tecla" href="${ev('obj')}" aria-haspopup="dialog">${ic('lapiz', 'ic--s')}Editar</a></div>
      </section>
      <section class="sec" id="plazos"><div class="sec__h"><h2>Con plazo</h2><span>promo y cupón</span></div>
        <div class="plazo"><b class="num ojo">Quedan ${esc(s.promo.quedan)}</b><span class="t3" style="align-self:center">sobres de promoción · hasta el ${fecha(s.promo.vence)}</span><p>${esc(s.promo.texto)}</p></div>
        <div class="plazo"><b class="num">Vence el ${fecha(s.cupon.vence)}</b><span class="t3" style="align-self:center">cupón ★★</span><p>${esc(s.cupon.texto)}</p></div>
      </section>
      <section class="sec" id="faltan"><div class="sec__h"><h2>Cartas que faltan</h2><span>${s.faltan.length} de ${s.faltanTotal}</span></div>
        ${s.faltan
          .map(
            (c) =>
              `<a class="fila fila--carta" href="${ev('carta:' + c.carta)}" aria-haspopup="dialog"><span class="q ojo">${c.falta}<small>×</small></span>${mini(c.imagen, c.carta, c.tipo)}<span><span class="fila__n">${esc(c.carta)} <span class="t3">para ${c.mazos.join(', ')}</span></span><span class="fila__s">${cap(c.consejo)}: ${esc(c.sobre)}</span></span><span class="fila__v"><span class="num">${fnum(c.puntos, 0)}</span><span class="n">puntos</span></span></a>`,
          )
          .join('')}
        <p class="ley"><span>A la derecha: lo que cuesta en puntos de sobre.</span><span>Comprar: con esos puntos. Abrir: conviene abrir ese sobre.</span></p>
        <button class="mas" data-act="nohace" data-t="La maqueta trae ${s.faltan.length} de las ${s.faltanTotal} cartas que faltan; en la app se abre la lista entera." style="width:100%">Ver las ${s.faltanTotal}${ic('der')}</button>
      </section>
      <section class="sec"><div class="sec__h"><h2>Completar cada mazo</h2><span>días abriendo sobres</span></div>
        ${s.porMazo
          .map((m) => {
            const d = deck(m.id)
            return `<a class="fila fila--e fila--lin ${d ? eclass(d.energias) : ''}" href="#/mazo/${m.id}"><span><span class="fila__n">${nom(m)}</span><span class="fila__s"><span>Tu lista: ${plural(m.tuLista, 'falta', 'faltan')} ${m.tuLista} · Versión de torneo: ${plural(m.torneo, 'falta', 'faltan')} ${m.torneo}</span></span></span><span class="fila__v"><b class="num">~${m.dias}</b><span class="n">días</span></span></a>`
          })
          .join('')}
      </section>`,
    }
  }
  T.col = () => {
    const c = D.cartas.coleccion
    const f = S.filtro.col
    const q = norm(S.q.col)
    const filas = c.muestra.filter((x) => (f === 'tengo' ? x.copias > 0 : f === 'faltan' ? x.copias === 0 : true) && (!q || norm(x.nombre + ' ' + x.id).includes(q)))
    const chip = (v, t, n) => `<button class="chip" data-filtro="col:${v}" aria-pressed="${f === v}">${t} <span class="num">${n}</span></button>`
    return `<div class="pega"><div class="chips">${chip('todas', 'Todas', c.muestra.length)}${chip('tengo', 'Tengo', c.muestra.filter((x) => x.copias > 0).length)}${chip('faltan', 'Me faltan', c.muestra.filter((x) => !x.copias).length)}</div>
      <div class="th" style="grid-template-columns:1fr auto"><span class="th__e">Carta · código · ediciones</span><span class="th__e">Copias</span></div></div>
      ${
        filas.length
          ? filas
              .map(
                (x) =>
                  `<a class="fila fila--carta" style="grid-template-columns:auto 1fr auto" data-k="${x.id}" href="${ev('carta:' + x.id)}" aria-haspopup="dialog">${mini(x.imagen, x.nombre, x.tipo)}<span><span class="fila__n">${esc(x.nombre)}</span><span class="fila__s"><span class="mono">${esc(x.id)}</span><span>${x.ediciones} ${plural(x.ediciones, 'edición', 'ediciones')}</span></span></span><span class="fila__v">${x.copias ? `<b class="num" style="font-size:19px">×${x.copias}</b>` : '<span class="et et--ojo">falta</span>'}${x.tipo ? en(x.tipo) : '<span class="n">Entrenador</span>'}</span></a>`,
              )
              .join('')
          : '<p class="bus__v">Ninguna carta de la muestra coincide.</p>'
      }`
  }
  function pageColeccion() {
    const c = D.cartas.coleccion
    const tot = c.cartasConUna + c.faltantes
    return {
      titulo: 'Cartas',
      doc: 'Cartas · Colección',
      extra: segCartas('c'),
      html: `
      <div class="sync">
        <div class="sync__t">${ic('ok', 'ok')}<span>Sincronizada <b style="color:var(--tx)">${esc(c.ultimaSyncTexto)}</b> · ${esc(c.fuente)}<br>Entraron ${c.ultimaSyncCambios.copias} copias y ${c.ultimaSyncCambios.nuevas} ${plural(c.ultimaSyncCambios.nuevas, 'carta nueva', 'cartas nuevas')}.</span></div>
        <div class="sync__b3"><a class="tecla tecla--p" href="${ev('sync')}" aria-haspopup="dialog">${ic('sync')}Sincronizar</a><button class="tecla" data-act="nohace" data-t="En la app arma el archivo para importar en el tracker. En la maqueta no se genera.">Tracker al día</button><a class="tecla" href="${ev('masacc')}" aria-haspopup="dialog" aria-label="Más acciones">${ic('puntos')}Más</a></div>
      </div>
      <div class="mar">
        <div class="mar__c"><span class="k">Copias</span><span class="v v--m" data-cu="${c.copias}">${fnum(c.copias, 0)}</span><span class="s">en total</span></div>
        <div class="mar__c"><span class="k">1 o más</span><span class="v v--m" data-cu="${c.cartasConUna}">${fnum(c.cartasConUna, 0)}</span><span class="s">cartas</span></div>
        <div class="mar__c"><span class="k">2 o más</span><span class="v v--m" data-cu="${c.cartasConDos}">${fnum(c.cartasConDos, 0)}</span><span class="s">cartas</span></div>
        <div class="mar__c"><span class="k ojo">Faltan</span><span class="v v--m" data-cu="${c.faltantes}">${fnum(c.faltantes, 0)}</span><span class="s">cartas</span></div>
      </div>
      <div class="sec sec--pri" style="padding:9px 12px 10px"><span class="vd" style="height:8px;margin:0" aria-hidden="true"><i style="flex:${c.cartasConDos};background:var(--tx)"></i><i style="flex:${c.cartasConUna - c.cartasConDos};background:var(--ctl)"></i><i style="flex:${c.faltantes};box-shadow:inset 0 0 0 1.5px var(--warn)"></i></span>
        <p class="t3" style="margin-top:6px">De ${fnum(tot, 0)} cartas: con 2 o más, con una sola y las que faltan.</p></div>
      <section class="sec"><div class="sec__h"><h2>${esc(c.expansionMuestra)}</h2><span>muestra de ${c.muestra.length} cartas</span></div>
        <div class="subnav subnav--c" style="border:0;padding-top:0"><label class="campo">${ic('lupa')}<span class="sr">Buscar una carta</span><input id="q-col" type="search" placeholder="Nombre o código" autocomplete="off" enterkeyhint="search" value="${esc(S.q.col)}"></label></div>
        <div data-tabla="col">${T.col()}</div>
      </section>`,
    }
  }

  /* ---------- Pruebas ---------- */
  const EST = { 'en cola': ['reloj', ''], corriendo: ['play', 'ok'], cancelada: ['ban', ''], terminada: ['ok', 'ok'], falló: ['alerta', 'ojo'] }
  T.jobs = () => {
    const f = S.filtro.jobs
    const filas = D.pruebas.trabajos.filter((j) => f === 'todas' || j.pregunta === f)
    const nuevas = lanzadas.filter((j) => f === 'todas' || j.pregunta === f)
    const pr = D.pruebas.preguntas.find((p) => p.id === f)
    return `<div class="pq">${D.pruebas.preguntas
      .map((p) => `<button class="pq__b" data-filtro="jobs:${p.id}" aria-pressed="${f === p.id}">${esc(p.titulo)}<span>${((n) => n + ' ' + plural(n, 'trabajo', 'trabajos'))(D.pruebas.trabajos.filter((j) => j.pregunta === p.id).length)}</span></button>`)
      .join('')}</div>
      <div class="pq__x${pr ? '' : ' pq__x--1'}">${pr ? `<span>${esc(pr.bajada)}</span><span class="teclas"><a class="tecla tecla--p" href="${hrefHoja({ hoja: 'lanzar', p: pr.id })}" aria-haspopup="dialog">${ic('play', 'ic--s')}Lanzar</a><button class="tecla" data-filtro="jobs:todas">Ver todas</button></span>` : `<span>Tocá una pregunta: filtra los trabajos de abajo.</span><a class="tecla" href="${hrefHoja({ hoja: 'lanzar' })}" aria-haspopup="dialog">${ic('play', 'ic--s')}Lanzar</a>`}</div>
      <div class="th" id="trabajos" style="grid-template-columns:1fr auto"><span class="th__e">Trabajo · qué dio</span><span class="th__e th__e--n">${filas.length + nuevas.length} de ${D.pruebas.trabajos.length + lanzadas.length}</span></div>
      ${nuevas
        .map((j) => {
          const m = deck(j.mazo)
          return `<div class="fila fila--job fila--nueva">${ic('reloj')}<span>
            <span class="fila__n">${esc(j.titulo)}${m ? ` · ${nom(m)}` : ''}</span>
            <span class="fila__s"><span class="et">en cola</span><span>lanzada recién · bot ${esc(j.bot)}</span></span>
            <span class="fila__s t3">Demo de la maqueta: no corre de verdad y se va al recargar.</span>
          </span></div>`
        })
        .join('')}
      ${filas
        .map((j) => {
          const e = EST[j.estado] || ['reloj', '']
          const p = j.progreso
          return `<a class="fila fila--job" data-k="${j.id}" href="${j.id === D.pruebas.resultado.id ? '#/pruebas/resultado/' + j.id : ev('job:' + j.id)}"${j.id === D.pruebas.resultado.id ? '' : ' aria-haspopup="dialog"'}>${ic(e[0], e[1])}<span>
            <span class="fila__n"><span class="nro">#${j.id}</span> ${nb(j.nombre)}</span>
            <span class="fila__s"><span class="et${j.estado === 'falló' ? ' et--ojo' : j.estado === 'corriendo' ? ' et--ok' : ''}">${esc(j.estado)}</span><span>${esc(j.tipo)} · ${esc(j.cuando)}</span></span>
            ${j.resultado ? `<span class="res-t">${nb(j.resultado)}</span>` : ''}
            ${p && j.estado !== 'terminada' ? `<span class="prog">${barra(p.pct, 0, j.estado === 'corriendo' ? 'barra--holo' : '')}<b class="num">${pct(p.pct)}</b></span><span class="fila__s t3">${fnum(p.hechas, 0)} de ${fnum(p.total, 0)} partidas${j.resultado ? '' : ' · todavía sin resultado'}</span>` : ''}
          </span></a>`
        })
        .join('')}`
  }
  function pagePruebas() {
    const p = D.pruebas
    const m = p.motor
    const job = p.trabajos.find((j) => j.id === m.trabajoActual)
    return {
      titulo: 'Pruebas',
      sub: 'Simulación y laboratorio, por pregunta',
      html: `
      <div class="mar" style="--n:3">
        <a class="mar__c" href="${ev('motor')}" aria-haspopup="dialog"><span class="k">Worker</span><span class="v v--m ${m.estado === 'en línea' ? 'ok' : 'ojo'}">${esc(m.estado)}</span><span class="s">${esc(m.worker)} · ${m.nucleos} núcleos</span></a>
        <a class="mar__c" href="${ev('job:' + m.trabajoActual)}" aria-haspopup="dialog"><span class="k">Jugando</span><span class="v">#${m.trabajoActual}</span>${job && job.progreso ? `<span class="s">${pct(job.progreso.pct)}</span>${barra(job.progreso.pct, 0, 'barra--holo')}` : ''}</a>
        <a class="mar__c" href="${ev('motor')}" aria-haspopup="dialog"><span class="k">Cola</span><span class="v" data-cu="${m.cola}">${m.cola}</span><span class="s">tandas · ${m.colaTrabajos} trabajos</span></a>
      </div>
      <section class="sec"><div class="sec__h"><h2>¿Qué querés saber?</h2><span>${PQ.length} preguntas</span></div>
        <div data-tabla="jobs">${T.jobs()}</div>
        <p class="ley"><span>${esc(p.resultado.nota)}</span></p>
      </section>
      <section class="sec"><div class="sec__h"><h2>Practicar</h2><span>contra el bot</span></div>
        <button class="fila fila--pend fila--urg" data-act="nohace" data-t="En la app sigue la partida contra el bot, en la mesa. La maqueta no la trae.">${ic('espadas')}<span><span class="fila__n">${nb(p.practicar.enCurso)}</span><span class="fila__s">Seguir la partida</span></span>${ic('der', 'ic--s')}</button>
        <button class="fila fila--pend" data-act="nohace" data-t="En la app abre las situaciones para resolver. La maqueta no las trae.">${ic('diana')}<span><span class="fila__n">Situaciones para resolver</span><span class="fila__s">Tus errores de las partidas con entrenador</span></span><b class="num">${p.practicar.situaciones}</b></button>
        <button class="fila fila--pend" data-act="nohace" data-t="En la app abre los ejercicios de cálculo. La maqueta no los trae.">${ic('lapiz')}<span><span class="fila__n">Ejercicios de cálculo</span><span class="fila__s">Hechos hoy</span></span><b class="num">${p.practicar.ejerciciosHoy}</b></button>
      </section>
      <section class="sec"><div class="sec__h"><h2>Motor</h2><span>worker ${esc(m.version)} · motor ${esc(m.motor)}</span></div>
        <a class="fila fila--pend" href="${ev('motor')}" aria-haspopup="dialog">${ic('cpu')}<span><span class="fila__n">Workers y cola</span><span class="fila__s">${esc(m.worker)}, ${esc(m.estado)} · ${m.cola} tandas en espera</span></span>${ic('der', 'ic--s')}</a>
        <button class="fila fila--pend" data-act="nohace" data-t="En la app abre la calibración: el banco contra los torneos. La maqueta no la trae.">${ic('diana')}<span><span class="fila__n">Calibración</span><span class="fila__s">El banco contra los torneos</span></span>${ic('der', 'ic--s')}</button>
        <button class="fila fila--pend" data-act="nohace" data-t="En la app abre el análisis de simulaciones. La maqueta no lo trae.">${ic('sube')}<span><span class="fila__n">Análisis</span><span class="fila__s">Tiempos y uso del motor</span></span>${ic('der', 'ic--s')}</button>
      </section>`,
    }
  }
  T.vari = () => {
    const r = D.pruebas.resultado
    const k = S.sort.vari
    const filas = [{ i: 'mejor', nombre: 'La mejor', cambios: r.mejor.cambios, pct: r.mejor.pct, n: r.mejor.n, ci: r.mejor.ci, mejor: true }]
      .concat(r.variantes.map((v, i) => Object.assign({ i }, v)))
      .concat([{ i: 'base', nombre: 'Tu lista', cambios: [], pct: r.base.pct, n: r.base.n, ci: r.base.ci, base: true }])
      .sort(k === 'pct' ? (a, b) => b.pct - a.pct : (a, b) => a.cambios.length - b.cambios.length)
    return (
      `<div class="th" style="grid-template-columns:1fr auto;gap:14px">${thB('vari', 'cam', 'Menos cambios')}${thB('vari', 'pct', '% vs meta', 'th__b--r')}</div>` +
      filas
        .map(
          (v) => `<a class="fila fila--lin${v.mejor ? ' fila--e' : ''}" style="${v.mejor ? '--e:var(--h2);--e2:var(--h3)' : ''}" data-k="${v.i}" href="${ev('var:' + v.i)}" aria-haspopup="dialog"><span><span class="fila__n"><b>${esc(v.nombre)}</b> <span class="t3">${v.base ? 'la lista de partida' : v.cambios.length + ' cambios'}</span></span>${ibar(v)}</span><span class="fila__v"><b class="num">${pct(v.pct)}</b><span class="n">n${NB}${fnum(v.n, 0)}</span></span></a>`,
        )
        .join('')
    )
  }
  function pageResultado() {
    const r = D.pruebas.resultado
    const z = deck(r.mazoId)
    return {
      titulo: `<span class="nro">#${r.id}</span> ${esc(r.titulo)}`,
      doc: `#${r.id} ${r.titulo}`,
      sub: '¿Qué le cambio? · terminada',
      atras: '#/pruebas',
      html: `
      <div class="mar" style="--n:3">
        <div class="mar__c"><span class="k">Tu lista</span><span class="v" data-cu="${r.base.pct}" data-dec="1">${fnum(r.base.pct)}<small>%</small></span><span class="s">n${NB}${fnum(r.base.n, 0)}</span>${ibar(r.base)}</div>
        <div class="mar__c"><span class="k">La mejor</span><span class="v" data-cu="${r.mejor.pct}" data-dec="1">${fnum(r.mejor.pct)}<small>%</small></span><span class="s">n${NB}${fnum(r.mejor.n, 0)}</span>${ibar(r.mejor)}</div>
        <div class="mar__c"><span class="k">Diferencia</span><span class="v ok">${sig(r.diferencia.pts)}<small>pts</small></span><span class="s">IC ${sig(r.diferencia.ci[0])} a ${sig(r.diferencia.ci[1])}</span></div>
      </div>
      <section class="sec sec--pri"><p class="preg__r" style="padding:12px 12px 8px 16px">${esc(r.veredicto)}</p>
        <div class="fila__s" style="padding:0 12px 12px 16px"><span class="et">¿Qué le cambio? · terminada</span><span class="et ${r.robusto ? 'et--ok' : 'et--ojo'}">${r.robusto ? 'robusto' : 'sensible al bot'}</span><span class="et">novedad: ${esc(r.mejor.novedad)}</span><span class="et">bot ${esc(r.bot)}</span></div>
        <p class="txt">${cap(esc(r.robustoTexto))}.</p>
      </section>
      <section class="sec"><div class="sec__h"><h2>Qué cambia la mejor</h2><span>${r.mejor.cambios.length} cambios</span></div>
        <div style="padding:0 12px 12px 16px">${cambios(r.mejor.cambios)}</div>
        <div class="teclas" style="padding:0 12px 12px 16px"><a class="tecla tecla--p" href="#/mazo/${r.mazoId}">Abrir #${r.mazoId}${ic('der', 'ic--s')}</a><button class="tecla" data-act="nohace" data-t="En la app guarda la mejor lista como una revisión nueva del mazo. En la maqueta no se guarda.">Guardar revisión</button></div>
      </section>
      <section class="sec"><div class="sec__h"><h2>Variantes</h2><span>${r.variantes.length + 2} listas</span></div>
        <div data-tabla="vari">${T.vari()}</div>
        <p class="ley"><span>Punto y barra: % e intervalo de 95${NB}% sobre 0–100, con la marca del 50${NB}%.</span><span>Tocá una fila: sus cambios.</span></p>
      </section>
      <section class="sec"><div class="sec__h"><h2>Por carta</h2><span>efecto medio</span></div>
        ${r.porCarta.map((c) => `<div class="fila fila--lin"><span class="fila__n">${esc(c.carta)}</span><span class="fila__s" style="justify-content:flex-end;text-align:right">${esc(c.efecto)}</span></div>`).join('')}
      </section>
      <section class="sec"><div class="sec__h"><h2>Ficha técnica</h2><span>#${r.mazoId} ${z ? esc(z.nombre) : ''}</span></div>
        <dl style="padding:0 12px 4px 16px">
          <div class="kv"><dt>Partidas</dt><dd>${fnum(r.partidas, 0)}</dd></div>
          <div class="kv"><dt>Rondas</dt><dd>${r.rondas}</dd></div>
          <div class="kv"><dt>Terminó porque</dt><dd class="t">${esc(r.fin)}</dd></div>
          <div class="kv"><dt>Contra</dt><dd class="t">${esc(r.contra)}</dd></div>
          <div class="kv"><dt>Bot</dt><dd>${esc(r.bot)}</dd></div>
        </dl>
        <p class="txt">${esc(r.nota)}</p>
      </section>`,
    }
  }

  /* ---------- Meta ---------- */
  const armado = (a) => /^armado/.test(a.tengo || '')
  /* Length of the windows of the share series, in days, from the data. */
  const VENT = ((v) => Math.round((Date.parse(v.hasta) - Date.parse(v.desde)) / 864e5))(D.meta.ventanasSerie[0])
  T.arq = () => {
    const k = S.sort.arq
    const f = S.filtro.arq
    const todos = D.meta.arquetipos
    const max = Math.max(...todos.map((a) => a.cuota))
    const filas = todos
      .filter((a) => (f === 'suben' ? a.tendencia > 0 : f === 'bajan' ? a.tendencia < 0 : f === 'sinarmar' ? !armado(a) : true))
      .sort(k === 'cuota' ? (a, b) => b.cuota - a.cuota : k === 'tend' ? (a, b) => b.tendencia - a.tendencia : (a, b) => b.pct - a.pct)
    const chip = (v, t, n) => `<button class="chip" data-filtro="arq:${v}" aria-pressed="${f === v}">${t} <span class="num">${n}</span></button>`
    return `<div class="pega"><div class="chips chips--j">${chip('todos', 'Todos', todos.length)}${chip('suben', 'Suben', todos.filter((a) => a.tendencia > 0).length)}${chip('bajan', 'Bajan', todos.filter((a) => a.tendencia < 0).length)}${chip('sinarmar', 'Sin armar', todos.filter((a) => !armado(a)).length)}</div>
      <div class="th th--arq">${thB('arq', 'cuota', 'Cuota')}${thB('arq', 'tend', D.meta.tendenciaDias + ' días')}${thB('arq', 'pct', '% vict.')}</div></div>
      ${
        filas.length
          ? filas
              .map(
                (a, i) => `<a class="fila fila--e fila--arq fila--arq1 ${eclass(a.energias)}" data-k="${a.id}" href="${a.id === D.meta.arquetipo.id ? '#/meta/arquetipo' : ev('arq:' + a.id)}"${a.id === D.meta.arquetipo.id ? '' : ' aria-haspopup="dialog"'}>
        <span class="fila__n"><span>${nb(a.nombre)}</span><span class="fila__s" style="flex-wrap:nowrap">${a.tengo ? `<span class="et">${esc(a.tengo)}</span>` : '<span class="et et--ojo">sin armar</span>'}${ens(a.energias)}</span></span>
        <span class="cel cel--l"><b class="num">${pct(a.cuota)}</b>${barra((a.cuota / max) * 100, i)}</span>
        <span class="cel cel--l" style="--c:var(${a.tendenciaClara ? (a.tendencia > 0 ? '--win' : '--loss') : '--tx3'})"><b class="num" style="color:var(${a.tendenciaClara ? '--c' : '--tx2'})">${sig(a.tendencia)}</b>${spark(a.serie, 46, 18)}</span>
        <span class="cel cel--l"><b class="num">${pct(a.pct)}</b><span class="n">n${NB}${fnum(a.n, 0)}</span>${a.orientativo ? ORI : ''}</span></a>`,
              )
              .join('')
          : `<p class="bus__v">${f === 'sinarmar' ? `Ninguno: tenés un mazo armado de cada uno de estos ${todos.length} arquetipos.` : 'Ningún arquetipo en este filtro.'}</p>`
      }`
  }
  function pageMeta() {
    const m = D.meta
    const evs = D.hoy.pendientes.filter((p) => p.tipo === 'evento')
    return {
      titulo: 'Meta',
      sub: `${m.era} · ${m.eraNombre} · ${m.formato}`,
      html: `
      <div class="mar" style="--n:3">
        <div class="mar__c"><span class="k">Torneos</span><span class="v" data-cu="${m.torneos}">${m.torneos}</span><span class="s">en la era</span></div>
        <div class="mar__c"><span class="k">Listas</span><span class="v" data-cu="${m.listas}">${fnum(m.listas, 0)}</span><span class="s">${fnum(m.ventanasSerie[m.ventanasSerie.length - 1].listas, 0)} en ${VENT} días</span></div>
        <div class="mar__c"><span class="k">Media</span><span class="v" data-cu="${m.media.pct}" data-dec="1">${fnum(m.media.pct)}<small>%</small></span><span class="s">n${NB}${fnum(m.media.n, 0)}</span></div>
      </div>
      <section class="sec sec--pri"><div class="sec__h"><h2>Qué se juega</h2><span>los ${m.arquetipos.length} más jugados</span></div>
        <div data-tabla="arq">${T.arq()}</div>
        <p class="ley"><span>Cuota: % de las listas.</span><span>${m.tendenciaDias} días: cambio de cuota en puntos, con su curva; en gris, puede ser ruido.</span><span>% vict.: de n partidas.</span><span>${ORI} orientativo: menos de 30</span><span>Etiqueta: «armado #N», «podés armarlo» o «sin armar».</span><span>Tocá una fila: intervalo y récord.</span></p>
        <p class="pie-nota" style="padding-bottom:12px">${esc(m.atribucion)}.</p>
      </section>
      <section class="sec"><div class="sec__h"><h2>Se mueve</h2><span>últimos ${D.hoy.meta.dias} días</span></div><div class="movs" style="border-top:1px solid var(--line)">${movimiento(D.hoy.meta.sube, true, ev('mov:sube'))}${movimiento(D.hoy.meta.baja, false, ev('mov:baja'))}</div></section>
      <section class="sec"><div class="sec__h"><h2>Eventos</h2><span>${evs.length} en curso</span></div>
        ${evs.length ? evs.map((e) => `<div class="fila fila--pend">${ic('cal')}<span><span class="fila__n">${esc(e.texto)}</span><span class="fila__s">${esc(e.detalle)}</span></span><span></span></div>`).join('') : '<p class="sec__p">sin datos</p>'}
      </section>`,
    }
  }
  T.mu = () => {
    const k = S.sort.mu
    const filas = D.meta.arquetipo.matchups
      .map((r, i) => Object.assign({ i }, r))
      .sort(k === 'peor' ? (a, b) => a.pct - b.pct : k === 'cuota' ? (a, b) => b.cuota - a.cuota : (a, b) => b.n - a.n)
    return (
      orden('mu', [
        ['peor', 'Peor primero'],
        ['n', 'n'],
        ['cuota', 'Cuota'],
      ]) +
      filas
        .map(
          (r) => `<a class="fila fila--lin fila--mu" data-k="${r.i}" href="${ev('mu:' + r.i)}" aria-haspopup="dialog"><span><span class="fila__n">${nb(r.rival)}</span>${dv(r)}</span><span class="fila__v"><b class="num ${r.ci[1] < 50 ? 'mal' : r.ci[0] > 50 ? 'ok' : ''}">${pct(r.pct)}</b><span class="n">n${NB}${r.n}${r.orientativo ? ORI : ''} · ${pct(r.cuota)}</span></span></a>`,
        )
        .join('')
    )
  }
  /* A note written as plain text: a line that starts with «- » or «1. » is a list item; any other line, a heading. */
  function notaLista(t) {
    let out = ''
    let abierta = false
    t.split('\n').forEach((l) => {
      const s = l.trim()
      const m = /^(-|\d+\.)\s+(.*)$/.exec(s)
      if (m) {
        if (!abierta) out += '<ul class="lista-n">'
        abierta = true
        out += `<li${m[1] === '-' ? '' : ` class="num-li" data-n="${esc(m[1])}"`}>${esc(m[2])}</li>`
      } else {
        if (abierta) out += '</ul>'
        abierta = false
        if (s) out += `<p class="nota-h">${esc(s)}</p>`
      }
    })
    return out + (abierta ? '</ul>' : '')
  }
  function notaArq() {
    const a = D.meta.arquetipo
    if (!S.notaArq) {
      const plano = a.nota
        .split('\n')
        .map((l) => l.trim().replace(/^(-|\d+\.)\s+/, ''))
        .filter(Boolean)
        .join(' · ')
      return `<button class="nota3 nota3--b" data-act="nota-arq" aria-expanded="false"><span class="nota3__k">${sello('m')}Mi nota contra este rival</span><p>${esc(plano)}</p><span>ver más${ic('der', 'ic--s')}</span></button>`
    }
    return `<div class="sec__h"><h2>Mi nota</h2><span>contra este rival</span></div><div class="nota-arq">${notaLista(a.nota)}</div><button class="btn-l" data-act="nota-arq" aria-expanded="true">ver menos${ic('der', 'ic--s')}</button>`
  }
  function pageArquetipo() {
    const a = D.meta.arquetipo
    return {
      titulo: nb(a.nombre),
      doc: a.nombre,
      sub: `Arquetipo · ${D.meta.era} ${D.meta.formato}`,
      atras: '#/meta',
      extra: ens(a.energias),
      html: `
      <div class="mar mar--arq e-${a.energias[0]}" style="--n:3">
        <div class="mar__c"><span class="k">${sello('t')}Torneos</span><span class="v" data-cu="${a.pct}" data-dec="1">${fnum(a.pct)}<small>%</small></span><span class="s">n${NB}${fnum(a.n, 0)}${a.orientativo ? ORI : ''}</span>${ibar(a)}<span class="s2">IC ${fnum(a.ci[0])}–${pct(a.ci[1])}<br>${a.record.v}–${a.record.d}–${a.record.e}</span></div>
        <div class="mar__c"><span class="k">Cuota</span><span class="v" data-cu="${a.cuota}" data-dec="1">${fnum(a.cuota)}<small>%</small></span><span class="s">en ${a.enListas} listas</span><span class="s" style="--c:var(--e);margin-top:2px">${spark(a.serie, 56, 12)}</span><span class="s2">${sig(a.tendencia)} pts / ${D.meta.tendenciaDias} días<br>${a.tengo ? esc(a.tengo) : 'sin armar'}</span></div>
        <div class="mar__c"><span class="k">${sello('m')}Vos</span>${a.misPartidas ? `<span class="v" data-cu="${a.misPartidas.pct}" data-dec="1">${fnum(a.misPartidas.pct)}<small>%</small></span><span class="s">n${NB}${a.misPartidas.n}${a.misPartidas.orientativo ? ORI : ''}</span>${ibar(a.misPartidas)}<span class="s2">IC ${fnum(a.misPartidas.ci[0])}–${pct(a.misPartidas.ci[1])}<br>${a.misPartidas.record.v}–${a.misPartidas.record.d}–${a.misPartidas.record.e}</span>` : '<span class="v v--m sd">sin datos</span>'}</div>
      </div>
      <p class="ley" style="border-top:0;background:var(--bg);border-bottom:1px solid var(--line)"><span>Punto e intervalo sobre 0–100, marca en 50${NB}%.</span><span>Récord: V–D–E.</span><span>${ORI} orientativo: menos de 30</span></p>
      <section class="sec sec--pri e-${a.energias[0]}" id="nota-arq">${notaArq()}</section>
      <section class="sec"><div class="sec__h"><h2>Matchups</h2><span>del peor al mejor</span></div>
        <div data-tabla="mu">${T.mu()}</div>
        <p class="ley"><span>Barra: distancia al 50${NB}%.</span><span>A la derecha: % de victorias; debajo, n y la cuota del rival en el meta.</span><span>Color en el número: el intervalo entero queda de un lado.</span><span>Tocá una fila: intervalo y récord.</span></p>
      </section>
      <section class="sec"><div class="sec__h"><h2>Listas más jugadas</h2><span>${a.listas.length}</span></div>
        ${a.listas
          .map(
            (l, i) =>
              `<a class="fila fila--lin" href="${ev('lst:' + i)}" aria-haspopup="dialog"><span><span class="fila__n">${esc(l.etiqueta)}</span><span class="fila__s"><span>${l.veces} veces</span>${l.tengo ? `<span class="et et--ojo">${esc(l.tengo)}: ${esc(l.faltaCartas.join(', '))}</span>` : ''}</span></span><span class="fila__v"><b class="num">${pct(l.pct)}</b><span class="n">n${NB}${l.n}${l.orientativo ? ORI : ''}</span></span></a>`,
          )
          .join('')}
      </section>`,
    }
  }

  /* ---------- Menú ---------- */
  function pageMenu() {
    const quieto = mqQuieto.matches
    // With «reduce motion» in the system the level in use is Ninguno: the control shows that, and the other two are off.
    const radio = (k, v, t) => {
      const forzado = k === 'movimiento' && quieto
      const on = forzado ? v === 'ninguno' : prefs[k] === v
      return `<button role="radio" aria-checked="${on}"${forzado && !on ? ' aria-disabled="true"' : ''} tabindex="${on ? 0 : -1}" data-pref="${k}:${v}">${t}</button>`
    }
    const MOV = { expresivo: 'Las hojas rebotan, los números cuentan, las filas viajan al ordenar y una victoria se festeja.', sutil: 'Solo fundidos cortos.', ninguno: 'Todo cambia al instante.' }
    const filas = [
      ['Ajustes', 'Notificaciones y preferencias de la app', 'menu'],
      ['Copia de seguridad', 'Copias, prueba de restauración y nube', 'sync'],
      ['Catálogo', `Cartas y sets · era ${D.era}`, 'cartas'],
      ['Tokens de API', 'Claude, workers y actividad', 'etiqueta'],
      ['Sesión', 'Cerrar sesión', 'ban'],
      ['Acerca de', 'Versión y licencias', 'logo'],
    ]
    return {
      titulo: 'Menú',
      sub: 'Aspecto, ajustes y sistema',
      atras: ultimaFuera,
      html: `
      <section class="sec sec--pri"><div class="sec__h"><h2>Aspecto</h2><span>se guarda en este navegador</span></div>
        <div class="op"><div class="op__h" id="l-tema">Tema<span>${prefs.tema === 'sistema' ? 'sigue al sistema: ' + root.dataset.tema : ''}</span></div><div class="seg" role="radiogroup" aria-labelledby="l-tema">${radio('tema', 'oscuro', 'Oscuro')}${radio('tema', 'claro', 'Claro')}${radio('tema', 'sistema', 'Sistema')}</div></div>
        <div class="op"><div class="op__h" id="l-mov">Movimiento<span>${quieto ? 'lo fija tu sistema' : ''}</span></div><div class="seg" role="radiogroup" aria-labelledby="l-mov">${radio('movimiento', 'expresivo', 'Expresivo')}${radio('movimiento', 'sutil', 'Sutil')}${radio('movimiento', 'ninguno', 'Ninguno')}</div><p>${quieto ? `Tu sistema pide menos movimiento: se usa «Ninguno» y los otros dos niveles quedan apagados. Guardado para cuando lo saques: ${cap(prefs.movimiento)}.` : MOV[prefs.movimiento]}</p></div>
        <div class="op"><div class="op__h" id="l-vis">Vistas de la ficha del mazo<span>para comparar</span></div><div class="seg" role="radiogroup" aria-labelledby="l-vis">${radio('vistas', 'arriba', 'Pestañas arriba')}${radio('vistas', 'abajo', 'Barra abajo')}</div></div>
        <div class="op"><button class="sw" role="switch" aria-checked="${prefs.minis}" data-act="minis">Miniaturas de cartas<i></i></button></div>
      </section>
      <section class="sec"><div class="sec__h"><h2>Sistema</h2><span>${filas.length}</span></div>
        ${filas.map((f) => `<button class="fila fila--pend" data-act="nohace" data-t="«${f[0]}» está en la app; la maqueta muestra solo dónde queda.">${ic(f[2])}<span><span class="fila__n">${f[0]}</span><span class="fila__s">${f[1]}</span></span>${ic('der', 'ic--s')}</button>`).join('')}
      </section>
      <p class="pie-nota">Maqueta C · «Consola de torneo». ${esc(D.aviso)}. Datos generados el ${fecha(D.generado)}/${D.generado.slice(0, 4)}.</p>`,
    }
  }

  /* ---------- Sheets ---------- */
  const hoja = $('#hoja')
  const velo = $('#velo')
  const sheet = { key: null, opener: null, viaApp: false }
  const cabHoja = (t, s, extra = '') =>
    `<header class="hj__h"><h2 id="hoja-t" tabindex="-1">${t}${s ? `<small>${s}</small>` : ''}</h2>${extra}<button class="x" data-act="cerrar" aria-label="Cerrar">${ic('x')}</button></header>`
  function syncHoja(prev) {
    const q = R.q
    const quiere = q.hoja === 'partida' ? 'partida' : q.hoja === 'buscar' ? 'buscar' : q.hoja === 'lanzar' ? 'lanzar' : q.detalle === 'sobre' ? 'sobre:' + (+q.s || 0) : q.ev ? 'ev:' + q.ev : null
    if (quiere === sheet.key) return
    if (!quiere) return ocultarHoja()
    mostrarHoja(quiere, !!prev && prev.path === R.path && !tieneHoja(prev.q))
  }
  function mostrarHoja(key, viaApp) {
    const estaba = !!sheet.key
    let html
    let cls = ''
    if (key === 'partida') {
      partidaInit(R.q)
      html = hojaPartida()
      cls = 'hoja--alta'
    } else if (key === 'buscar') {
      B.q = R.q.q != null ? R.q.q : primera ? D.buscar.consulta : ''
      B.tipo = 'todo'
      html = hojaBuscar()
      cls = 'hoja--alta'
    } else if (key === 'lanzar') {
      lanzarInit(R.q)
      html = hojaLanzar()
    } else if (key.indexOf('sobre:') === 0) html = hojaSobre(+key.slice(6))
    else html = hojaEv(key.slice(3))
    if (!html) {
      history.replaceState(null, '', '#' + R.path)
      R = parse()
      return ocultarHoja()
    }
    if (!estaba) {
      sheet.opener = document.activeElement
      sheet.viaApp = viaApp
    }
    sheet.key = key
    hoja.className = 'hoja ' + cls
    hoja.innerHTML = html
    hoja.hidden = false
    velo.hidden = false
    root.classList.add('fijo')
    shell.inert = true
    pie.inert = true
    void hoja.offsetHeight
    hoja.classList.add('on')
    velo.classList.add('on')
    contar(hoja)
    const foco = key === 'buscar' ? $('#q-bus') : $('#hoja-t')
    if (foco) foco.focus({ preventScroll: true })
    if (key === 'buscar') {
      const i = $('#q-bus')
      i.setSelectionRange(i.value.length, i.value.length)
    }
  }
  function ocultarHoja() {
    if (!sheet.key && hoja.hidden) return
    if (sheet.key === 'partida') ult = null
    sheet.key = null
    hoja.classList.remove('on')
    velo.classList.remove('on')
    shell.inert = false
    pie.inert = false
    root.classList.remove('fijo')
    const fin = () => {
      if (sheet.key) return
      hoja.hidden = true
      velo.hidden = true
      hoja.innerHTML = ''
    }
    const ms = mov() === 'expresivo' ? 320 : mov() === 'sutil' ? 160 : 0
    if (ms) setTimeout(fin, ms)
    else fin()
    // The page may have been painted again while the sheet was open: then the focus goes to the content.
    if (sheet.opener && document.contains(sheet.opener)) sheet.opener.focus({ preventScroll: true })
    else main.focus({ preventScroll: true })
    sheet.opener = null
  }
  function cerrarHoja() {
    if (!sheet.key) return
    if (sheet.viaApp) history.back()
    else {
      history.replaceState(null, '', '#' + R.path)
      route()
    }
  }
  let avisoT = 0
  function aviso(msg) {
    const el = $('#aviso')
    el.textContent = msg
    el.classList.add('on')
    clearTimeout(avisoT)
    avisoT = setTimeout(() => el.classList.remove('on'), 2600)
  }

  /* ----- Hoja de partida ----- */
  let P = null
  const RES = { V: 'Victoria', D: 'Derrota', E: 'Empate' }
  function partidaInit(q) {
    const ej = D.partida.ejemplo
    if (q.estado !== 'guardada') ult = null
    P = { mazo: deck(q.m) ? +q.m : S.regMazo, resultado: RES[q.r] || null, rival: '', empezo: null, vistas: [], modalidad: ej.modalidad, nota: '', notaOn: false, masRiv: false, pick: false, pickQ: '', estado: 'abierta', rango: null, editar: null }
    const pe = q.editar ? partidasHoy().find((p) => p.ref === q.editar) : null
    if (pe) {
      // Correcting a saved match: the same sheet, filled in.
      Object.assign(P, { mazo: pe.mazoId, resultado: pe.resultado, rival: pe.rival || '', empezo: pe.empezo || null, modalidad: pe.modalidad, editar: pe })
      return
    }
    if (q.estado === 'lista' || q.estado === 'guardada') {
      Object.assign(P, { mazo: ej.mazoId, resultado: ej.resultado, rival: ej.rival, empezo: ej.empezo, vistas: D.partida.cartasVistasEjemplo.map((c) => Object.assign({}, c)) })
    }
    if (q.estado === 'guardada') {
      P.estado = 'guardada'
      if (!ult && sesion.length) {
        // Back at the saved state through the browser history after saving in this session: it is that same match
        // again (nothing new is counted, and «Deshacer» undoes it).
        ult = sesion[0]
        Object.assign(P, ult, { vistas: ult.vistas.map((c) => Object.assign({}, c)), estado: 'guardada' })
        delete P.deDatos
      } else if (!ult) {
        // Opened straight in the saved state: it is the last match the data already counts (2–7 stays 2–7), unless
        // it was undone in this session; then it is one more.
        ult = Object.assign({}, P, { deDatos: !quitada })
        if (!ult.deDatos) {
          sesion.unshift(ult)
          pintarRec(false)
        }
      }
    }
  }
  const esEjemplo = (g) => {
    const ej = D.partida.ejemplo
    return g.mazo === ej.mazoId && g.resultado === ej.resultado && g.rival === ej.rival
  }
  function mazosHoja(id) {
    const rs = D.partida.mazosRecientes.slice()
    if (!rs.some((m) => m.id === id)) rs.unshift(deck(id))
    return rs
  }
  const selMazo = (id, act) =>
    `<div class="mz-sel" role="radiogroup" aria-label="Mazo">${mazosHoja(id)
      .map((m) => {
        const on = m.id === id
        return `<button role="radio" aria-checked="${on}" data-act="${act}" data-id="${m.id}" data-fk="mz-${m.id}" aria-label="#${m.id} ${esc(m.nombre)}">${ens(m.energias)}<span>${on ? nom(m) : '#' + m.id}</span></button>`
      })
      .join('')}</div>`
  /* Rival chips: the three most likely, all of them with «Más rivales», or the ones that match what is being typed. */
  function rivChips() {
    const sug = D.partida.rivalesSugeridos
    const elegido = P.rival && sug.includes(P.rival)
    if (elegido && !P.masRiv) return ''
    const q = elegido ? '' : norm(P.rival)
    const hits = q ? sug.filter((r) => norm(r).includes(q)) : sug
    if (q && !hits.length) return `<p class="riv__v">Ningún rival sugerido coincide: se guarda como lo escribiste.</p>`
    const vis = P.masRiv || q ? hits : hits.slice(0, 3)
    return (
      vis.map((r) => `<button class="chip" aria-pressed="${P.rival === r}" data-act="p-rival" data-v="${esc(r)}" data-fk="riv-${esc(r)}"><span>${nb(r)}</span></button>`).join('') +
      (P.masRiv || q || sug.length <= 3 ? '' : `<button class="chip chip--mas" data-act="p-masriv" data-fk="masriv">Más rivales (${sug.length - 3})</button>`)
    )
  }
  function sugCartas() {
    const sc = D.partida.sugerenciaPorCartas
    const todas = D.partida.cartasVistasEjemplo.every((c) => P.vistas.some((v) => v.nombre === c.nombre))
    if (!todas) return ''
    return P.rival === sc.rival
      ? `<p class="sug-c">${ic('ok', 'ok')}<span>Coincide con el rival: ${esc(sc.texto)}.</span></p>`
      : `<p class="sug-c"><span>Por esas cartas: <b>${nb(sc.rival)}</b>, ${esc(sc.texto)}.</span><button class="tecla" data-act="p-usar-sug" data-fk="usar">Usar</button></p>`
  }
  /* Card picker of «Cartas que vi»: a search field and up to six cards. The data brings the two of the example;
     the rest are other cards of the mock-up, so that searching can be tried. */
  function pickCands() {
    const q = norm(P.pickQ)
    const vistos = {}
    return D.partida.cartasVistasEjemplo
      .concat(Object.values(CARTAS).filter((c) => c.tipo && c.imagen))
      .filter((c) => !vistos[c.nombre] && (vistos[c.nombre] = true))
      .filter((c) => !q || norm(c.nombre).includes(q))
      .slice(0, 6)
  }
  function pickHtml() {
    const cs = pickCands()
    if (!cs.length) return '<p class="riv__v">Ninguna carta de la maqueta coincide.</p>'
    return cs
      .map((c) => {
        const v = P.vistas.find((x) => x.nombre === c.nombre)
        return `<button class="pk" aria-pressed="${!!v}" data-act="p-pick" data-n="${esc(c.nombre)}" data-fk="pk-${esc(c.nombre)}" aria-label="${esc(c.nombre)}${v ? `, ${v.cant} ${plural(v.cant, 'copia', 'copias')}` : ''}">${mini(c.imagen, c.nombre, c.tipo, 'mini--p')}<span>${nb(c.nombre)}</span>${v ? `<b>×${v.cant}</b>` : ''}</button>`
      })
      .join('')
  }
  function hojaPartida() {
    if (P.estado === 'guardada') return hojaGuardada()
    const falta = !P.resultado
    const ed = P.editar
    return `${cabHoja(ed ? 'Corregir partida' : 'Registrar partida', ed ? `guardada ${esc(ed.cuando)}` : '', `<span class="hj__m"><small>Hoy</small><span data-rec>${recHoy()}</span></span>`)}
    <div class="hj__b">
      <fieldset class="cmp"><legend>Mazo <small>cambiá en un toque</small></legend>${selMazo(P.mazo, 'p-mazo')}</fieldset>
      <fieldset class="cmp"><legend>Resultado</legend><div class="teclas" role="radiogroup" aria-label="Resultado">${['Victoria', 'Derrota', 'Empate']
        .map((r) => `<button class="tecla tecla--res" role="radio" aria-checked="${P.resultado === r}" data-act="p-res" data-v="${r}" data-fk="res-${r}">${resTok(r)}${r}</button>`)
        .join('')}</div></fieldset>
      <div class="cmp"><label for="rival">Rival <small>arquetipo</small></label>
        <div class="campo">${ic('lupa')}<input id="rival" type="text" value="${esc(P.rival)}" placeholder="Buscar o escribir…" autocomplete="off" enterkeyhint="done" data-fk="rival"><button class="x" data-act="p-rival-x" aria-label="Borrar el rival" data-fk="rivx" style="margin-right:-10px"${P.rival ? '' : ' hidden'}>${ic('x', 'ic--s')}</button></div>
        <div class="riv" id="riv">${rivChips()}</div></div>
      <fieldset class="cmp"><legend>¿Quién empezó?</legend><div class="seg" role="radiogroup" aria-label="Quién empezó">${[
        ['yo', 'Yo'],
        ['rival', 'El rival'],
      ]
        .map(([v, t]) => `<button role="radio" aria-checked="${P.empezo === v}" data-act="p-emp" data-v="${v}" data-fk="emp-${v}">${t}</button>`)
        .join('')}</div></fieldset>
      <div class="cmp"><span class="lbl">Cartas que vi <small>${P.vistas.length ? 'tocá una para quitarla' : 'opcional'}</small></span>
        <div class="vistasc">${P.vistas
          .map((c, i) => `<button class="vt" data-act="p-carta-del" data-i="${i}" data-fk="vt-${i}" aria-label="Quitar ${esc(c.nombre)}, ${c.cant} ${plural(c.cant, 'copia', 'copias')}">${mini(c.imagen, c.nombre, c.tipo)}<b>×${c.cant}</b></button>`)
          .join('')}<button class="vt vt--add" data-act="p-carta-add" data-fk="addc" aria-expanded="${P.pick}">${ic(P.pick ? 'x' : 'mas')}<span>${P.pick ? 'Listo' : 'Carta'}</span></button>${P.vistas.length ? `<span class="t2" style="flex:1;min-width:120px">${P.vistas.map((c) => `${esc(c.nombre)} ×${c.cant}`).join('<br>')}</span>` : ''}</div>
        ${
          P.pick
            ? `<div class="pick"><label class="campo">${ic('lupa')}<span class="sr">Buscar una carta</span><input id="pick-q" type="text" value="${esc(P.pickQ)}" placeholder="Buscar una carta…" autocomplete="off" enterkeyhint="search" data-fk="pickq"></label>
          <div class="pick__g" id="pick-g">${pickHtml()}</div>
          <p class="t3">Tocá una carta: ×1, ×2 y otra vez para quitarla. En la app salen primero las del rival elegido; la maqueta trae unas pocas.</p></div>`
            : ''
        }
        <div id="sugc">${sugCartas()}</div></div>
      <div class="cmp sec2"><label class="sr" for="modalidad">Modalidad</label><select id="modalidad" data-fk="mod">${D.partida.modalidades.map((m) => `<option${m === P.modalidad ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select>
        ${P.notaOn ? `<label class="sr" for="nota">Nota de la partida</label><textarea id="nota" rows="1" placeholder="Nota (opcional)" data-fk="notat">${esc(P.nota)}</textarea>` : `<button class="chip" data-act="p-nota" data-fk="nota">${ic('mas', 'ic--s')}Nota</button>`}</div>
    </div>
    <footer class="hj__f">${
      ed
        ? `<button class="tecla tecla--p" data-act="p-editar-ok" data-fk="guardar">Guardar cambios</button><button class="tecla" data-act="cerrar" style="flex:none">Cancelar</button>`
        : `<button class="tecla tecla--p" data-act="p-guardar" aria-disabled="${falta}" data-fk="guardar">${falta ? 'Falta el resultado' : 'Guardar partida'}</button>`
    }</footer>`
  }
  function hojaGuardada() {
    const g = ult
    const m = deck(g.mazo)
    const rsp = D.partida.respuesta
    const ej = esEjemplo(g)
    const texto = ej ? rsp.texto : `${g.resultado} con ${m.nombre}${g.rival ? ' contra ' + g.rival : ', sin rival anotado'}`
    let graf = ''
    if (ej) {
      const t = rsp.veredicto.texto
      const a = /\((\d+(?:,\d+)?)\s%\)/.exec(t)
      const b = /es (\d+(?:,\d+)?)\s%/.exec(t)
      if (a && b) {
        const va = parseFloat(a[1].replace(',', '.'))
        const vb = parseFloat(b[1].replace(',', '.'))
        graf = `<div class="dosp" aria-hidden="true"><span class="iz" style="--x:${va}%">vos ${pct(va)}</span><i class="yo" style="--x:${va}%"></i><i class="es" style="--x:${vb}%"></i><span class="ab" style="--x:${vb}%">esperable ${pct(vb)}</span></div>`
      }
    }
    const gana = g.resultado === 'Victoria'
    const chispas = gana
      ? `<div class="celebra" aria-hidden="true">${Array.from({ length: 14 }, (_, i) => {
          const an = (i / 14) * Math.PI * 2
          const e = Object.keys(D.energias)[i % 10]
          return `<i class="e-${e}" style="--i:${i};--dx:${(Math.cos(an) * (70 + (i % 3) * 26)).toFixed(0)}px;--dy:${(Math.sin(an) * (46 + (i % 2) * 22)).toFixed(0)}px"></i>`
        }).join('')}</div>`
      : ''
    return `${cabHoja(gana ? '¡Victoria guardada!' : 'Partida guardada', '', `<span class="hj__m"><small>Hoy</small><span data-rec class="gira">${recHoy()}</span></span>`)}
    <div class="hj__b" style="position:relative">${chispas}
      <p class="guard-t">${nb(texto)}.</p>
      <section class="resp"><h3>¿Mala racha?${ej && !g.deDatos ? '<span>veredicto de ejemplo</span>' : ''}</h3>${
        ej
          ? `<p class="resp__t">${nb(rsp.veredicto.titulo)}</p>${graf}<p>${esc(rsp.veredicto.texto)}</p>`
          : `<p>El veredicto se calcula al guardar. En la maqueta solo está escrito el del ejemplo: «${nb(rsp.texto)}».</p>`
      }</section>
      <section class="resp"><h3>¿Cambiaste de rango? <span>${rsp.rango.vigente ? '' : 'sin temporada'}</span></h3>
        <div class="riv riv--3" role="group" aria-label="Cambio de rango">${rsp.rango.opciones.map((o, i) => `<button class="chip" aria-pressed="${P.rango === i}" data-act="p-rango" data-i="${i}" data-fk="rg-${i}">${esc(o)}</button>`).join('')}</div>
        <p>${esc(rsp.rango.nota)}</p></section>
    </div>
    <footer class="hj__f" style="display:grid;gap:8px">
      <span class="lbl">Otra partida <small>con #${m.id}, el mismo mazo</small></span>
      <div class="teclas">${['Victoria', 'Derrota', 'Empate'].map((r) => `<button class="tecla" data-act="p-otra" data-v="${r}" data-fk="otra-${r}">${resTok(r)}${r}</button>`).join('')}</div>
      <div style="display:flex;gap:10px;align-items:center"><div class="ok-bar">${resTok(g.resultado, 'res--pop')}<span>Guardada: ${esc(g.resultado.toLowerCase())}${g.empezo ? (g.empezo === 'yo' ? ', empezaste vos' : ', empezó el rival') : ''}${g.vistas.length ? `, ${g.vistas.length} ${plural(g.vistas.length, 'carta vista', 'cartas vistas')}` : ''}.</span></div><button class="tecla tecla--des" data-act="p-deshacer" data-fk="deshacer">Deshacer</button></div>
    </footer>`
  }
  function rePartida(fk) {
    const b = $('.hj__b', hoja)
    const y = b ? b.scrollTop : 0
    hoja.innerHTML = hojaPartida()
    const b2 = $('.hj__b', hoja)
    if (b2) b2.scrollTop = y
    const f = fk && $(`[data-fk="${window.CSS && CSS.escape ? CSS.escape(fk) : fk}"]`, hoja)
    ;(f || $('#hoja-t')).focus({ preventScroll: true })
  }
  function estadoUrl(estado) {
    const q = Object.assign({}, R.q)
    delete q.r
    delete q.m
    delete q.editar
    if (estado) q.estado = estado
    else delete q.estado
    history.replaceState(null, '', hrefHoja(q))
    R = parse()
  }

  /* ----- Lanzador ----- */
  const B = { q: '', tipo: 'todo' }
  const PANT = [
    { t: 'Hoy', s: 'Resumen del día', h: '#/hoy', i: 'hoy', k: 'inicio partidas pendientes' },
    { t: 'Mazos', s: `${D.mazos.length} armados`, h: '#/mazos', i: 'mazos', k: 'listas' },
    { t: 'Sobres', s: 'Cartas · qué abrir', h: '#/cartas', i: 'cartas', k: 'sobre abrir cupon promo faltan' },
    { t: 'Colección', s: 'Cartas · sincronizar', h: '#/cartas/coleccion', i: 'mazos', k: 'coleccion sincronizar tracker csv' },
    { t: 'Meta', s: 'Torneos y eventos', h: '#/meta', i: 'meta', k: 'torneos arquetipos eventos' },
    { t: 'Pruebas', s: 'Simulación y laboratorio', h: '#/pruebas', i: 'pruebas', k: 'simulacion laboratorio motor practicar bot' },
    { t: 'Aspecto', s: 'Menú · tema y movimiento', h: '#/menu', i: 'menu', k: 'menu ajustes tema movimiento oscuro claro' },
    { t: D.meta.arquetipo.nombre, s: 'Meta › arquetipo · matchups', h: '#/meta/arquetipo', i: 'meta', x: 1 },
    { t: `#${D.mazo.id} ${D.mazo.nombre}`, s: 'Mazo › Rinde', h: `#/mazo/${D.mazo.id}/rinde`, i: 'mazos', x: 1 },
    { t: `#${D.mazo.id} ${D.mazo.nombre}`, s: 'Mazo › Mejorar', h: `#/mazo/${D.mazo.id}/mejorar`, i: 'mazos', x: 1 },
    { t: `#${D.mazo.id} ${D.mazo.nombre}`, s: 'Mazo › Notas', h: `#/mazo/${D.mazo.id}/notas`, i: 'mazos', x: 1 },
    { t: `#${D.pruebas.resultado.id} ${D.pruebas.resultado.titulo}`, s: 'Pruebas › resultado', h: `#/pruebas/resultado/${D.pruebas.resultado.id}`, i: 'pruebas', x: 1 },
  ]
  const ACC = [
    { t: 'Registrar partida', hoja: { hoja: 'partida' }, i: 'mas', k: 'cargar anotar victoria derrota' },
    { t: 'Sincronizar la colección', h: '#/cartas/coleccion?ev=sync', i: 'sync', k: 'traer juego' },
    { t: 'Tracker al día', h: '#/cartas/coleccion', i: 'lista', k: 'archivo importar' },
    { t: 'Probar un mazo contra el meta', h: '#/pruebas?hoja=lanzar&p=' + PQ[0].id, i: 'pruebas', k: 'lanzar simulacion prueba' },
    { t: 'Buscar mejoras para un mazo', h: '#/pruebas?hoja=lanzar&p=' + PQ[1].id, i: 'pruebas', k: 'lanzar laboratorio variantes cambio' },
    { t: 'Cambiar de tema', act: 'tema-alt', i: 'menu', k: 'oscuro claro aspecto' },
  ]
  function buscar(texto) {
    const n = norm(texto)
    const ws = n.split(' ').filter(Boolean)
    const hit = (t) => ws.every((w) => norm(t).includes(w))
    const ej = n === norm(D.buscar.consulta)
    const mazos = !n ? D.mazos : ej ? D.buscar.mazos.map((m) => deck(m.id) || m) : D.mazos.filter((m) => hit('#' + m.id + ' ' + m.nombre))
    const cartas = !n ? Object.values(CARTAS) : ej ? D.buscar.cartas : Object.values(CARTAS).filter((c) => hit(c.nombre + ' ' + (c.id || '')))
    const arqs = !n ? [] : ej ? D.buscar.arquetipos : D.meta.arquetipos.filter((a) => hit(a.nombre))
    const pant = (n ? PANT.filter((p) => hit(p.t + ' ' + (p.k || ''))) : PANT.filter((p) => !p.x)).concat(
      arqs.filter((a) => a.id !== D.meta.arquetipo.id).map((a) => ({ t: a.nombre, s: 'Meta › arquetipo', h: '#/meta?ev=arq:' + a.id, i: 'meta' })),
    )
    let acc = n ? ACC.filter((a) => hit(a.t + ' ' + (a.k || ''))) : ACC.slice()
    if (n && mazos[0]) {
      const m = mazos[0]
      acc = [
        { t: 'Registrar partida', s: `con #${m.id} ${m.nombre}`, hoja: { hoja: 'partida', m: m.id }, i: 'mas' },
        { t: 'Probar contra el meta', s: `#${m.id} ${m.nombre}`, h: `#/pruebas?hoja=lanzar&p=${PQ[0].id}&m=${m.id}`, i: 'pruebas' },
      ].concat(acc)
    }
    return { mazos, cartas, cartasTotal: ej ? D.buscar.cartasTotal : cartas.length, pant, acc, vacio: !n }
  }
  const FB = {
    pant: (p) => `<a class="bus__f" href="${p.h}">${ic(p.i || 'der')}<span class="fila__n">${esc(p.t)}<small>${esc(p.s || 'Pantalla')}</small></span>${ic('der', 'ic--s')}</a>`,
    acc: (a) =>
      a.act
        ? `<button class="bus__f" data-act="${a.act}" style="width:100%;text-align:left">${ic(a.i)}<span class="fila__n">${esc(a.t)}<small>Acción</small></span>${ic('play', 'ic--s')}</button>`
        : `<a class="bus__f" data-acc href="${a.hoja ? hrefHoja(a.hoja) : a.h}">${ic(a.i)}<span class="fila__n">${esc(a.t)}<small>${esc(a.s || 'Acción')}</small></span>${ic('play', 'ic--s')}</a>`,
    mazo: (m) =>
      `<a class="bus__f" href="#/mazo/${m.id}">${en(m.energias[0])}<span class="fila__n">${nom(m)}<small>${((s) => (s ? `${pct(s.pct)} · n${NB}${s.n} en mis partidas` : 'sin partidas'))(miasDe(m.id, m.mias))}${m.completo === false ? ` · ${plural(m.falta, 'falta', 'faltan')} ${m.falta}` : ''}</small></span>${ic('der', 'ic--s')}</a>`,
    carta: (c) =>
      `<a class="bus__f" href="${hrefHoja({ ev: 'carta:' + (c.id || c.nombre) })}">${mini(c.imagen, c.nombre, c.tipo, 'mini--p')}<span class="fila__n">${esc(c.nombre)}<small>${c.id ? esc(c.id) : 'carta'}${c.ediciones != null ? ` · ${c.ediciones} ${plural(c.ediciones, 'edición', 'ediciones')}` : ''}</small></span>${c.copias != null ? `<b class="num">×${c.copias}</b>` : '<span></span>'}</a>`,
  }
  function busRes() {
    const r = buscar(B.q)
    const t = B.tipo
    const grupo = (titulo, arr, fn, lim, total) => {
      if (!arr.length) return ''
      const ver = t === 'todo' ? arr.slice(0, lim) : arr
      const tot = total || arr.length
      return `<div class="bus__g"><h3><span>${titulo}</span><span class="bus__n">${ver.length < tot ? `${ver.length} de ${tot}` : tot}</span></h3>${ver.map(fn).join('')}</div>`
    }
    if (r.vacio && (t === 'todo' || t === 'pant' || t === 'acc')) {
      const acc = `<div class="bus__g"><h3><span>Acciones</span></h3>${r.acc.map(FB.acc).join('')}</div>`
      const ir = `<div class="bus__g"><h3><span>Ir a</span></h3><div class="bus__ir">${r.pant.map((p) => `<a href="${p.h}">${ic(p.i)}${esc(p.t)}</a>`).join('')}</div></div>`
      return t === 'acc' ? acc : t === 'pant' ? ir : acc + ir
    }
    const g = {
      mazos: grupo('Mazos', r.mazos, FB.mazo, 2),
      cartas: grupo('Cartas · una fila por carta', r.cartas, FB.carta, 3, r.cartasTotal),
      acc: grupo('Acciones', r.acc, FB.acc, 2),
      pant: grupo('Pantallas', r.pant, FB.pant, 2),
    }
    const html = t === 'todo' ? g.mazos + g.cartas + g.acc + g.pant : g[t]
    return html || `<p class="bus__v">Nada para «${esc(B.q)}»${t === 'todo' ? '' : ' en este grupo'}.</p>`
  }
  function busTipos() {
    const r = buscar(B.q)
    // Counts only while something is being searched: with the field empty they would be the size of the mock-up's index.
    const b = (k, t, n) => `<button data-act="b-tipo" data-v="${k}" aria-pressed="${B.tipo === k}">${t}${n == null || r.vacio ? '' : `<span>${n}</span>`}</button>`
    return b('todo', 'Todo') + b('pant', 'Pantallas', r.pant.length) + b('acc', 'Acciones', r.acc.length) + b('mazos', 'Mazos', r.mazos.length) + b('cartas', 'Cartas', r.cartasTotal)
  }
  function hojaBuscar() {
    return `<header class="hj__h" style="min-height:46px"><h2 id="hoja-t" tabindex="-1">Lanzador <span class="t3">· pantallas, acciones, mazos y cartas</span></h2></header>
    <div class="bus" id="bus-r">${busRes()}</div>
    <div class="bus__t" id="bus-t" role="group" aria-label="Qué buscar">${busTipos()}</div>
    <div class="bus__c"><label class="campo">${ic('lupa')}<span class="sr">Buscar</span><input id="q-bus" type="text" inputmode="search" value="${esc(B.q)}" placeholder="Buscar… probá «mega»" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"></label><button class="x" data-act="cerrar" aria-label="Cerrar el lanzador">${ic('x')}</button></div>`
  }
  function reBuscar() {
    $('#bus-r').innerHTML = busRes()
    $('#bus-t').innerHTML = busTipos()
  }

  /* ----- Lanzar una prueba ----- */
  let L = null
  function lanzarInit(q) {
    L = { p: PQ.some((x) => x.id === q.p) ? q.p : S.filtro.jobs !== 'todas' ? S.filtro.jobs : PQ[0].id, m: deck(q.m) ? +q.m : S.regMazo }
  }
  /* How many games a test of that question takes: what the latest one in the data took. */
  function refLanzar(p) {
    const js = D.pruebas.trabajos.filter((j) => j.pregunta === p)
    const j = js.find((x) => x.estado === 'terminada') || js[0]
    if (!j) return null
    const r = D.pruebas.resultado
    const n = j.resultado && /n = ([\d.]+)/.exec(j.resultado)
    return { j, n: j.id === r.id ? `${fnum(r.partidas, 0)} en ${r.rondas} rondas` : j.progreso ? fnum(j.progreso.total, 0) : n ? `${n[1]} por mazo` : null }
  }
  function hojaLanzar() {
    const p = PQ.find((x) => x.id === L.p)
    const m = deck(L.m)
    const ref = refLanzar(L.p)
    const mo = D.pruebas.motor
    const r = D.pruebas.resultado
    const contra = L.p === PQ[2].id ? 'otro mazo o una lista de mazos, que elegís al lanzar' : L.p === PQ[3].id ? `un rival pasivo y ${r.contra}` : r.contra
    return `${cabHoja('Lanzar una prueba', 'Queda en la cola de Pruebas')}
    <div class="hj__b">
      <fieldset class="cmp"><legend>Pregunta</legend><div class="pq pq--h" role="radiogroup" aria-label="Pregunta">${PQ.map((x) => `<button class="pq__b" role="radio" aria-checked="${x.id === L.p}" tabindex="${x.id === L.p ? 0 : -1}" data-act="l-preg" data-v="${x.id}" data-fk="lp-${x.id}">${esc(x.titulo)}</button>`).join('')}</div>
        <p class="t2">${esc(p.bajada)}</p></fieldset>
      <fieldset class="cmp"><legend>Mazo <small>cambiá en un toque</small></legend>${selMazo(L.m, 'l-mazo')}</fieldset>
      <dl class="lz">
        <div class="kv"><dt>Contra</dt><dd class="t">${cap(esc(contra))}</dd></div>
        <div class="kv"><dt>Bot</dt><dd class="t">${esc(r.bot)} · el de la última prueba</dd></div>
        <div class="kv"><dt>Partidas</dt><dd class="t">${ref && ref.n ? `${ref.n} · como la #${ref.j.id}` : '<span class="sd">sin datos</span>'}</dd></div>
        <div class="kv"><dt>Tiempo estimado</dt><dd class="t"><span class="sd">sin datos</span> · antes hay ${mo.cola} tandas de ${mo.colaTrabajos} trabajos</dd></div>
        <div class="kv"><dt>Worker</dt><dd class="t">${esc(mo.worker)} · ${esc(mo.estado)} · ${mo.nucleos} núcleos</dd></div>
      </dl>
    </div>
    <footer class="hj__f"><button class="tecla tecla--p" data-act="l-lanzar" data-fk="lanzar">${ic('play', 'ic--s')}Lanzar</button><button class="tecla" data-act="cerrar" style="flex:none">Cancelar</button></footer>`
  }
  function reLanzar(fk) {
    hoja.innerHTML = hojaLanzar()
    const f = fk && $(`[data-fk="${fk}"]`, hoja)
    ;(f || $('#hoja-t')).focus({ preventScroll: true })
  }

  /* ----- Los números de un sobre ----- */
  function hojaSobre(i) {
    const ps = packs()
    const p = ps[i]
    if (!p) return ''
    const n = p.numeros
    const max = Math.max(...ps.map((x) => x.numeros.puntaje))
    return `${cabHoja(esc(p.nombre), `${esc(p.expansion)} · ${esc(p.expansionId)} · ${i ? i + 1 + '.º por puntaje' : 'el recomendado'}`)}
    <div class="hj__b">
      <div class="tiles">
        <div><div class="k">Puntaje</div><div class="v" data-cu="${n.puntaje}" data-dec="2">${fdec(n.puntaje)}</div></div>
        <div><div class="k">Al menos una buscada</div><div class="v" data-cu="${n.alMenosUna}" data-dec="1">${fnum(n.alMenosUna)}<small style="font-size:15px;color:var(--tx2)"> %</small></div></div>
        <div><div class="k">Buscadas por sobre</div><div class="v" data-cu="${n.buscadas}" data-dec="2">${fdec(n.buscadas)}</div></div>
        <div><div class="k">Sobres para <span class="nw">50${NB}% · 90${NB}%</span></div><div class="v">${n.sobres50} · ${n.sobres90}</div></div>
      </div>
      ${p.motivo ? `<p class="t2" style="margin-bottom:8px">${esc(p.motivo)}.</p>` : ''}
      <p class="t3" style="margin-bottom:12px">«Al menos una buscada» cuenta los objetivos juntos: ${esc(D.cartas.sobres.objetivos)}. El porcentaje que el porqué da para la colección cuenta solo la colección.</p>
      <span class="lbl" style="margin-bottom:4px">Puntaje, contra los otros<small>es lo que ordena</small></span>
      ${ps.map((x, j) => `<div class="cmpb${j === i ? ' yo' : ''}"><span>${esc(x.nombre)}</span><b class="num">${fdec(x.numeros.puntaje)}</b>${barra((x.numeros.puntaje / max) * 100, j, j === i ? 'barra--holo' : '')}</div>`).join('')}
      <span class="lbl" style="margin:12px 0 4px">Al menos una buscada<small>por sobre · ${D.cartas.sobres.objetivos.split(' · ').length} objetivos</small></span>
      ${ps.map((x, j) => `<div class="cmpb${j === i ? ' yo' : ''}"><span>${esc(x.nombre)}</span><b class="num">${pct(x.numeros.alMenosUna)}</b>${barra(x.numeros.alMenosUna, j, j === i ? 'barra--holo' : '')}</div>`).join('')}
    </div>
    <footer class="hj__f"><button class="tecla tecla--p" data-act="cerrar">Listo</button></footer>`
  }

  /* ----- Evidencia: lo que hay detrás de una fila ----- */
  const accMazo = (id) =>
    `<a class="tecla tecla--p" href="#/mazo/${id}">Abrir la ficha${ic('der', 'ic--s')}</a><a class="tecla" href="${hrefHoja({ hoja: 'partida', m: id })}">${ic('mas', 'ic--s')}Registrar</a>`
  const cabMazo = (m) => `<div class="cab ${eclass(m.energias)}" style="padding:0 0 12px;background:none;border:0"><span class="cab__a">${artes(m, 3, 'arte--g')}</span></div>`
  const listo = '<button class="tecla" data-act="cerrar">Listo</button>'
  const EVB = {
    dia(id) {
      const m = D.hoy.mazosDelDia.find((x) => x.id === +id)
      if (!m) return null
      return {
        t: nom(m),
        s: 'Tres fuentes que no se mezclan',
        b:
          cabMazo(m) +
          fuente('t', 'Torneo · su arquetipo contra el meta', m.torneo, { nota: `Matchups con datos: ${pct(m.torneo.cobertura)} del meta. ${esc(D.hoy.mazosDelDiaMeta)}.` }) +
          ((s) => fuente('m', 'Mis partidas', s, { nota: s ? '' : 'Todavía no registraste partidas con este mazo.' }))(miasDe(m.id, m.mias)) +
          fuente('b', 'Laboratorio · bot ' + esc(m.laboratorio.bot), m.laboratorio, { nota: esc(D.pruebas.resultado.nota) }),
        f: accMazo(m.id),
      }
    },
    ses(id) {
      const m = mazosSesion().find((x) => x.id === +id)
      if (!m) return null
      return { t: nom(m), s: `Hoy ${m.hoy.v}–${m.hoy.d}${m.hoy.e ? '–' + m.hoy.e : ''} · últimas ${m.racha.length}: ${m.racha.join(' ')}`, b: cabMazo(m) + fuente('m', 'Mis partidas con este mazo', m.mias), f: accMazo(m.id) }
    },
    hoy() {
      const h = D.hoy
      return {
        t: `Hoy ${recHoy()}`,
        s: cap(h.fechaTexto),
        b: partidasHoy()
          .map((p) => `<div class="fila fila--par" style="padding-left:0;padding-right:0">${resTok(p.resultado)}<span><span class="fila__n"><span class="nro">#${p.mazoId}</span> ${nb(p.mazo)}</span><span class="fila__s"><span>${p.rival ? 'contra ' + nb(p.rival) : 'sin rival anotado'}</span>${p.empezo ? `<span class="nw">${p.empezo === 'yo' ? 'empezaste vos' : 'empezó el rival'}</span>` : ''}</span></span><span class="t3">${esc(p.cuando)}</span></div>`)
          .join(''),
        f: `<a class="tecla tecla--p" href="${hrefHoja({ hoja: 'partida' })}">${ic('mas', 'ic--s')}Registrar partida</a>${listo}`,
      }
    },
    semana() {
      const s = sumar(D.hoy.semana, delta())
      return { t: 'Esta semana', s: esc(s.etiqueta), b: fuente('m', 'Mis partidas', Object.assign({}, s, { record: { v: s.v, d: s.d, e: s.e } })) + `<p class="evb__n">Semana anterior: ${esc(s.anterior.texto)}, ${rec(s.anterior)}.</p>`, f: listo }
    },
    rango() {
      const h = D.hoy
      return { t: 'Rango', s: esc(h.rango), b: `<dl><div class="kv"><dt>Último anotado</dt><dd class="t">${esc(h.rango)}</dd></div><div class="kv"><dt>Temporada</dt><dd class="t">${esc(h.temporada)}</dd></div><div class="kv"><dt>Próxima</dt><dd class="t">${esc(h.proximaTemporada)}</dd></div></dl><p class="evb__n">${esc(D.partida.respuesta.rango.nota)}</p>`, f: listo }
    },
    rival(i) {
      const r = D.mazo.rinde.porRival[+i]
      if (!r) return null
      return { t: nb(r.rival), s: `${pct(r.cuota)} del meta · contra #${D.mazo.id} ${nb(D.mazo.nombre)}`, b: fuente('m', 'Mis partidas contra él', r.mias) + fuente('t', 'En torneos, mi arquetipo contra él', r.torneo), f: (r.rival === D.meta.arquetipo.nombre ? `<a class="tecla tecla--p" href="#/meta/arquetipo">Abrir el arquetipo${ic('der', 'ic--s')}</a>` : '') + listo }
    },
    arq(id) {
      const a = D.meta.arquetipos.find((x) => x.id === id)
      if (!a) return null
      const vs = D.meta.ventanasSerie
      return {
        t: nb(a.nombre),
        s: `${pct(a.cuota)} de las listas · en ${a.enListas} listas${a.tengo ? ' · ' + esc(a.tengo) : ''}`,
        b:
          fuente('t', 'En torneos', a) +
          `<div class="fu e-${a.energias[0]}"><div class="fu__h"><span>Cuota cada ${VENT} días</span></div><p class="fu__tag"><span class="et">${sig(a.tendencia)} pts en ${D.meta.tendenciaDias} días${a.tendenciaClara ? '' : ' · puede ser ruido'}</span></p><div class="gcols" style="--n:${a.serie.length};margin-top:8px">${a.serie.map((v, i) => `<span><b>${fnum(v)}</b>${fecha(vs[i].desde)}</span>`).join('')}</div></div>`,
        f: (a.id === D.meta.arquetipo.id ? `<a class="tecla tecla--p" href="#/meta/arquetipo">Abrir el arquetipo${ic('der', 'ic--s')}</a>` : '') + listo,
      }
    },
    mu(i) {
      const r = D.meta.arquetipo.matchups[+i]
      if (!r) return null
      return { t: `Contra ${nb(r.rival)}`, s: `${nb(D.meta.arquetipo.nombre)} en torneos · rival con ${pct(r.cuota)} del meta`, b: fuente('t', 'En torneos', r), f: listo }
    },
    lst(i) {
      const l = D.meta.arquetipo.listas[+i]
      if (!l) return null
      return { t: esc(l.etiqueta), s: `${l.veces} veces en torneos`, b: fuente('t', 'En torneos', l) + `<p class="evb__n">Para armarla: ${esc(l.tengo)} (${esc(l.faltaCartas.join(', '))}).</p>`, f: `<button class="tecla tecla--p" data-act="nohace" data-t="En la app arranca una partida contra el bot con esta lista. La maqueta no la juega.">Jugar contra esta lista</button>${listo}` }
    },
    var(i) {
      const r = D.pruebas.resultado
      const v = i === 'mejor' ? Object.assign({ nombre: 'La mejor' }, r.mejor) : i === 'base' ? Object.assign({ nombre: 'Tu lista', cambios: [] }, r.base) : r.variantes[+i]
      if (!v) return null
      return { t: esc(v.nombre), s: `Búsqueda #${r.id} · contra ${esc(r.contra)} · bot ${esc(r.bot)}`, b: fuente('b', 'Contra el meta', v) + `<div class="fu"><div class="fu__h"><span>${v.cambios.length ? v.cambios.length + ' cambios sobre tu lista' : 'Sin cambios: es la lista de partida'}</span></div><div style="margin-top:8px">${cambios(v.cambios)}</div></div>`, f: listo }
    },
    job(id) {
      const j = D.pruebas.trabajos.find((x) => x.id === +id)
      if (!j) return null
      const p = j.progreso
      return {
        t: `<span class="nro">#${j.id}</span> ${esc(j.nombre)}`,
        s: `${esc(j.tipo)} · ${esc(j.estado)} · ${esc(j.cuando)}`,
        b: `${j.resultado ? `<p class="preg__r" style="margin-bottom:12px">${esc(j.resultado)}</p>` : '<p class="sd" style="margin-bottom:12px">Todavía sin resultado.</p>'}${p ? `<dl><div class="kv"><dt>Avance</dt><dd>${pct(p.pct)}</dd>${barra(p.pct, 0, 'barra--holo')}</div><div class="kv"><dt>Partidas</dt><dd>${fnum(p.hechas, 0)} de ${fnum(p.total, 0)}</dd></div></dl>` : ''}`,
        f: (j.estado === 'falló' ? '<button class="tecla tecla--p" data-act="nohace" data-t="En la app vuelve a jugar solo los cruces que fallaron. La maqueta no corre pruebas.">Reintentar lo que falló</button>' : j.estado === 'en cola' ? '<button class="tecla tecla--p" data-act="nohace" data-t="En la app la pasa al frente de la cola. La maqueta no corre pruebas.">Adelantar</button>' : '') + listo,
      }
    },
    motor() {
      const m = D.pruebas.motor
      return { t: 'Motor', s: 'Workers y cola', b: `<dl><div class="kv"><dt>Worker</dt><dd class="t">${esc(m.worker)} · ${esc(m.estado)}</dd></div><div class="kv"><dt>Núcleos</dt><dd>${m.nucleos}</dd></div><div class="kv"><dt>Jugando</dt><dd>#${m.trabajoActual}</dd></div><div class="kv"><dt>En cola</dt><dd>${m.cola} tandas · ${m.colaTrabajos} trabajos</dd></div><div class="kv"><dt>Worker / motor</dt><dd class="t">${esc(m.version)} · ${esc(m.motor)}</dd></div></dl>`, f: listo }
    },
    carta(k) {
      const c = CARTAS[k]
      if (!c) return null
      const sd = '<span class="sd">sin datos</span>'
      // Editions the data knows by code: the same name with another code (the two Caterpie of #1, for instance).
      const eds = Object.values(CARTAS).filter((x) => x.id && x.nombre === c.nombre)
      const falta = D.cartas.sobres.faltan.find((x) => x.carta === c.nombre)
      const kv = (dt, dd) => `<div class="kv"><dt>${dt}</dt><dd class="t">${dd}</dd></div>`
      const arriba = [
        c.id ? ['Código', `<span class="mono">${esc(c.id)}</span>`] : null,
        ['Tipo', c.tipo ? en(c.tipo) + ' ' + D.energias[c.tipo].nombre : c.clase ? 'Entrenador' : sd],
        c.clase ? ['Clase', esc(c.clase)] : null,
        ['Copias jugables', c.copias != null ? (c.copias ? '×' + c.copias : 'ninguna') : sd],
      ].filter(Boolean)
      const otras = c.ediciones != null ? c.ediciones - eds.length : null
      return {
        t: esc(c.nombre),
        s: `Ficha de carta${c.ediciones != null ? ` · ${c.ediciones} ${plural(c.ediciones, 'edición', 'ediciones')}` : ''}`,
        b: `<div class="evb__c">${mini(c.imagen, c.nombre, c.tipo, 'mini--g')}<dl>${arriba.map((f) => `<div class="kv" style="grid-template-columns:1fr"><dt>${f[0]}</dt><dd style="text-align:left">${f[1]}</dd></div>`).join('')}</dl></div>
          <div class="fu"><div class="fu__h"><span>Ediciones</span><span class="et">${c.ediciones != null ? c.ediciones + ' en total' : 'total: sin datos'}</span></div><dl>
            ${eds.map((x) => kv(`<span class="mono">${esc(x.id)}</span>${x.id === c.id ? ' · esta' : ''}`, `${x.enMazo ? `×${x.enMazo} en #${D.mazo.id}` : ''}${x.enMazo ? ' · ' : ''}copias: ${eds.length === 1 && c.ediciones === 1 && c.copias != null ? '×' + c.copias : 'sin datos'}`)).join('')}
            ${otras ? kv(`${otras === 1 ? 'La otra edición' : `Las otras ${otras} ediciones`}`, `código y copias${otras === 1 ? '' : ' de cada una'}: sin datos`) : ''}
            ${!eds.length && otras == null ? kv('Códigos y copias de cada edición', sd) : ''}
          </dl></div>
          <div class="fu"><div class="fu__h"><span>Dónde se consigue</span>${falta ? `<span class="et et--ojo">${plural(falta.falta, 'falta', 'faltan')} ${falta.falta} para ${falta.mazos.join(', ')}</span>` : ''}</div><dl>
            ${kv('Sobre', falta ? esc(falta.sobre) : sd)}
            ${kv('Puntos de sobre', falta ? fnum(falta.puntos, 0) + ' puntos' : sd)}
            ${kv('Conviene', falta ? cap(esc(falta.consejo)) : sd)}
            ${kv('Intercambio', sd)}
          </dl></div>
          ${c.enMazo ? `<p class="evb__n">En #${D.mazo.id} ${nb(D.mazo.nombre)}: ×${c.enMazo}${c.puntos ? ` · da ${c.puntos} ${plural(c.puntos, 'punto', 'puntos')} al rival si la debilita` : ''}.</p>` : ''}`,
        f: listo,
      }
    },
    sync() {
      const c = D.cartas.coleccion
      return { t: 'Sincronizar', s: `Trae la colección del juego · ${esc(c.fuente)}`, b: `<dl><div class="kv"><dt>Última vez</dt><dd class="t">${esc(c.ultimaSyncTexto)}</dd></div><div class="kv"><dt>Qué entró</dt><dd class="t">${c.ultimaSyncCambios.copias} copias · ${c.ultimaSyncCambios.nuevas} ${plural(c.ultimaSyncCambios.nuevas, 'carta nueva', 'cartas nuevas')}</dd></div></dl><p class="evb__n">En la maqueta no se conecta: acá se vería qué entró, con miniaturas, y «Aplicar».</p>`, f: `<button class="tecla tecla--p" data-act="nohace" data-t="La maqueta no se conecta al juego: en la app trae la colección y muestra qué entró.">${ic('sync', 'ic--s')}Traer del juego</button>${listo}` }
    },
    obj() {
      const s = D.cartas.sobres
      return {
        t: 'Objetivos de los sobres',
        s: 'Lo que ordena la recomendación',
        b:
          s.objetivos
            .split(' · ')
            .map((o) => `<button class="sw" role="switch" aria-checked="true" data-act="sw">${esc(o)}<i></i></button>`)
            .join('') + '<p class="evb__n">En la maqueta se prenden y se apagan, pero la recomendación no se vuelve a calcular. En la app, cada objetivo abre su detalle (qué mazos, cuántas copias).</p>',
        f: listo,
      }
    },
    mov(k) {
      const a = D.hoy.meta[k]
      if (!a || !a.serie) return null
      const full = D.meta.arquetipos.find((x) => x.nombre === a.nombre)
      if (full) return EVB.arq(full.id)
      const vs = D.meta.ventanasSerie
      return {
        t: nb(a.nombre),
        s: `${pct(a.cuota)} de las listas${a.nuevo ? ' · nuevo en el meta' : ''}`,
        b: `<div class="fu"><div class="fu__h"><span>Cuota cada ${VENT} días</span></div><p class="fu__tag"><span class="et">${sig(a.delta)} pts en ${D.hoy.meta.dias} días</span></p><div class="gcols" style="--n:${a.serie.length};margin-top:8px">${a.serie.map((v, i) => `<span><b>${fnum(v)}</b>${vs[i] ? fecha(vs[i].desde) : ''}</span>`).join('')}</div></div>
          <p class="evb__n">No está entre los ${D.meta.arquetipos.length} arquetipos más jugados: su récord y sus matchups, sin datos en la maqueta.</p>`,
        f: listo,
      }
    },
    masacc() {
      return { t: 'Más acciones', s: 'Colección', b: ['Importar CSV', 'Exportar CSV', 'Ajustes manuales'].map((t) => `<button class="fila fila--pend" style="padding-left:0;padding-right:0" data-act="nohace" data-t="«${t}» está en la app; la maqueta muestra solo dónde queda.">${ic('lista')}<span class="fila__n">${t}</span>${ic('der', 'ic--s')}</button>`).join(''), f: listo }
    },
  }
  function hojaEv(key) {
    const i = key.indexOf(':')
    const tipo = i < 0 ? key : key.slice(0, i)
    const fn = EVB[tipo]
    const r = fn ? fn(i < 0 ? '' : key.slice(i + 1)) : null
    if (!r) return ''
    return `${cabHoja(r.t, r.s)}<div class="hj__b evb">${r.b}</div><footer class="hj__f">${r.f}</footer>`
  }

  /* ---------- Events ---------- */
  /* The views of the deck (Lista · Rinde · Mejorar · Notas) replace the history entry: «atrás» leaves the deck. */
  const esVista = (href) => {
    const m = /^#\/mazo\/(\d+)(?:\/(\w+))?$/.exec(href)
    return !!m && cur.key === 'mazo/' + +m[1] && cur.view != null && (!m[2] || VISTAS.includes(m[2]))
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a')
    if (a) {
      const href = a.getAttribute('href') || ''
      if (a.hasAttribute('data-salto')) {
        e.preventDefault()
        main.focus()
        return
      }
      if (href.charAt(0) !== '#') return
      if (hoja.contains(a)) {
        // A link inside a sheet replaces the sheet's history entry: «atrás» goes back to the page, not to the sheet.
        e.preventDefault()
        if (href === location.hash) return
        if (esVista(href) && sheet.viaApp) {
          // A view of the deck behind the sheet (from the launcher): the sheet's entry goes away and the view takes the
          // deck's own entry, so that one «atrás» still leaves the deck.
          window.addEventListener('hashchange', () => location.hash !== href && location.replace(href), { once: true })
          history.back()
          return
        }
        porEnlace = true
        location.replace(href)
        return
      }
      if (href === location.hash) {
        e.preventDefault()
        window.scrollTo({ top: 0, behavior: mov() === 'ninguno' ? 'auto' : 'smooth' })
      } else if (esVista(href) && !sheet.key) {
        e.preventDefault()
        location.replace(href)
      } else porEnlace = !nav.contains(a) || a.hasAttribute('aria-current')
      return
    }
    if (e.target === velo) return cerrarHoja()
    const b = e.target.closest('button')
    if (!b) return
    if (b.dataset.vista) {
      const href = `#/mazo/${D.mazo.id}${b.dataset.vista === 'lista' ? '' : '/' + b.dataset.vista}`
      if (href !== location.hash) location.replace(href)
      return
    }
    if (b.dataset.sort) {
      const p = b.dataset.sort.split(':')
      S.sort[p[0]] = p[1]
      return reTabla(p[0], true)
    }
    if (b.dataset.filtro) {
      const p = b.dataset.filtro.split(':')
      S.filtro[p[0]] = S.filtro[p[0]] === p[1] && p[0] === 'jobs' ? 'todas' : p[1]
      reTabla(p[0])
      const f = $(`[data-filtro="${p[0]}:${S.filtro[p[0]]}"]`)
      if (f) f.focus({ preventScroll: true })
      return
    }
    if (b.dataset.pref) {
      if (b.getAttribute('aria-disabled') === 'true') return aviso('Tu sistema pide menos movimiento: se usa «Ninguno».')
      const p = b.dataset.pref.split(':')
      setPref(p[0], p[1])
      pintarPagina(false)
      const f = $(`[data-pref="${b.dataset.pref}"]`)
      if (f) f.focus()
      return
    }
    const act = b.dataset.act
    if (!act) return
    if (act === 'cerrar') return cerrarHoja()
    if (act === 'nohace') return aviso(b.dataset.t || 'En la maqueta esto no hace nada: en la app abre su pantalla.')
    if (act === 'sw') return b.setAttribute('aria-checked', b.getAttribute('aria-checked') !== 'true')
    if (act === 'minis') {
      setPref('minis', !prefs.minis)
      b.setAttribute('aria-checked', prefs.minis)
      return
    }
    if (act === 'tema-alt') {
      setPref('tema', root.dataset.tema === 'claro' ? 'oscuro' : 'claro')
      return aviso('Tema ' + prefs.tema + '.')
    }
    if (act === 'ir') {
      const el = document.getElementById(b.dataset.a)
      if (el) el.scrollIntoView({ behavior: mov() === 'ninguno' ? 'auto' : 'smooth', block: 'start' })
      return
    }
    if (act === 'nota-arq') {
      S.notaArq = !S.notaArq
      const sec = $('#nota-arq')
      sec.innerHTML = notaArq()
      const f = $('[data-act="nota-arq"]', sec)
      if (f) f.focus({ preventScroll: true })
      return
    }
    if (act === 'reg-mazo') {
      S.regMazo = +b.dataset.id
      $('[data-reg]').innerHTML = regTira()
      const f = $('.reg__d')
      if (f) f.focus({ preventScroll: true })
      return
    }
    if (act === 'b-tipo') {
      B.tipo = b.dataset.v
      reBuscar()
      const f = $(`[data-act="b-tipo"][data-v="${B.tipo}"]`)
      if (f) f.focus()
      return
    }
    if (act === 'l-preg') {
      L.p = b.dataset.v
      return reLanzar('lp-' + L.p)
    }
    if (act === 'l-mazo') {
      L.m = +b.dataset.id
      return reLanzar('mz-' + L.m)
    }
    if (act === 'l-lanzar') {
      // Static: nothing runs. The test shows up first in the list of Pruebas, «en cola», for this session.
      const p = PQ.find((x) => x.id === L.p)
      lanzadas.unshift({ pregunta: L.p, titulo: p.titulo, mazo: L.m, bot: D.pruebas.resultado.bot })
      S.filtro.jobs = L.p
      sucio = true
      porEnlace = true
      location.replace('#/pruebas')
      // Once Pruebas is painted, the list of jobs goes right under the header, the new one first.
      anclaTras = 'trabajos'
      return aviso('Lanzada: quedó «en cola», primera en la lista. En la maqueta no corre.')
    }
    if (act.indexOf('p-') === 0) return actPartida(act, b)
  })
  function actPartida(act, b) {
    const fk = b.dataset.fk
    if (act === 'p-mazo') {
      P.mazo = +b.dataset.id
      S.regMazo = D.partida.mazosRecientes.some((m) => m.id === P.mazo) ? P.mazo : S.regMazo
      return rePartida('mz-' + P.mazo)
    }
    if (act === 'p-res') P.resultado = P.resultado === b.dataset.v ? null : b.dataset.v
    else if (act === 'p-rival') {
      P.rival = P.rival === b.dataset.v ? '' : b.dataset.v
      P.masRiv = false
      return rePartida(P.rival ? 'rivx' : 'rival')
    } else if (act === 'p-rival-x') {
      P.rival = ''
      return rePartida('rival')
    } else if (act === 'p-masriv') {
      P.masRiv = true
      rePartida('riv-' + D.partida.rivalesSugeridos[3])
      // The longer list pushes «¿Quién empezó?» and «Cartas que vi» down: the sheet scrolls just enough to keep them in sight.
      const fin = $('.hj__b .cmp:last-child', hoja)
      if (fin) fin.scrollIntoView({ block: 'nearest' })
      return
    } else if (act === 'p-emp') P.empezo = P.empezo === b.dataset.v ? null : b.dataset.v
    else if (act === 'p-carta-add') {
      P.pick = !P.pick
      P.pickQ = ''
      rePartida(P.pick ? 'pickq' : 'addc')
      const pk = $('.pick', hoja)
      if (pk) pk.scrollIntoView({ block: 'nearest' })
      return
    } else if (act === 'p-pick') {
      // One tap adds the card, the second makes it ×2, the third takes it out.
      const c = pickCands().find((x) => x.nombre === b.dataset.n)
      if (!c) return
      const i = P.vistas.findIndex((v) => v.nombre === c.nombre)
      if (i < 0) P.vistas.push({ nombre: c.nombre, imagen: c.imagen, tipo: c.tipo, cant: 1 })
      else if (P.vistas[i].cant < 2) P.vistas[i].cant++
      else P.vistas.splice(i, 1)
    } else if (act === 'p-carta-del') {
      P.vistas.splice(+b.dataset.i, 1)
      return rePartida('addc')
    } else if (act === 'p-usar-sug') {
      P.rival = D.partida.sugerenciaPorCartas.rival
      return rePartida('rivx')
    } else if (act === 'p-nota') {
      P.notaOn = true
      return rePartida('notat')
    } else if (act === 'p-rango') P.rango = P.rango === +b.dataset.i ? null : +b.dataset.i
    else if (act === 'p-editar-ok') {
      cerrarHoja()
      return aviso('En la app, la partida queda corregida. En la maqueta, la guardada no cambia.')
    } else if (act === 'p-guardar') {
      if (!P.resultado) return aviso('Falta el resultado: Victoria, Derrota o Empate.')
      P.estado = 'guardada'
      P.pick = false
      ult = Object.assign({}, P, { vistas: P.vistas.map((c) => Object.assign({}, c)) })
      sesion.unshift(ult)
      estadoUrl('guardada')
      rePartida('deshacer')
      pintarRec(true)
      if (navigator.vibrate && mov() === 'expresivo') navigator.vibrate(15)
      return
    } else if (act === 'p-deshacer') {
      const g = ult
      ult = null
      if (g.deDatos) quitada = true
      else sesion.splice(sesion.indexOf(g), 1)
      P = Object.assign({}, g, { estado: 'abierta', rango: null })
      delete P.deDatos
      estadoUrl(esEjemplo(P) ? 'lista' : '')
      rePartida('guardar')
      pintarRec(true)
      return aviso('Deshecha: la partida no quedó registrada.')
    } else if (act === 'p-otra') {
      const g = ult
      ult = null
      P = { mazo: g.mazo, resultado: b.dataset.v, rival: '', empezo: null, vistas: [], modalidad: g.modalidad, nota: '', notaOn: false, masRiv: false, pick: false, pickQ: '', estado: 'abierta', rango: null, editar: null }
      estadoUrl('')
      return rePartida('rival')
    }
    rePartida(fk)
  }
  document.addEventListener('input', (e) => {
    const t = e.target
    if (t.id === 'q-mazos') {
      S.q.mazos = t.value
      reTabla('mazos')
    } else if (t.id === 'q-col') {
      S.q.col = t.value
      reTabla('col')
    } else if (t.id === 'q-bus') {
      B.q = t.value
      reBuscar()
    } else if (t.id === 'rival' && P) {
      // Typing filters the suggested rivals in place; the field keeps the focus.
      P.rival = t.value
      P.masRiv = false
      $('#riv', hoja).innerHTML = rivChips()
      $('#sugc', hoja).innerHTML = sugCartas()
      $('[data-act="p-rival-x"]', hoja).hidden = !t.value
    } else if (t.id === 'pick-q' && P) {
      P.pickQ = t.value
      $('#pick-g', hoja).innerHTML = pickHtml()
    } else if (t.id === 'nota' && P) P.nota = t.value
  })
  document.addEventListener('change', (e) => {
    if (e.target.id === 'modalidad' && P) P.modalidad = e.target.value
  })
  /* Launcher results in the order they are seen (the list grows upwards from the field). */
  function busOrden() {
    return $$('#bus-r .bus__g')
      .reverse()
      .reduce((todo, g) => todo.concat($$('a, button', g)), [])
  }
  document.addEventListener('keydown', (e) => {
    const t = e.target
    if (e.key === 'Escape' && sheet.key) {
      e.preventDefault()
      return cerrarHoja()
    }
    if (sheet.key === 'buscar' && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && (t.id === 'q-bus' || (t.closest && t.closest('#bus-r')))) {
      // ↑ and ↓ walk the results; the field is below the last one.
      const fs = busOrden()
      const i = fs.indexOf(t)
      const j = t.id === 'q-bus' ? (e.key === 'ArrowUp' ? fs.length - 1 : -1) : i + (e.key === 'ArrowDown' ? 1 : -1)
      if (t.id === 'q-bus' && e.key === 'ArrowDown') return
      e.preventDefault()
      if (j >= 0 && j < fs.length) {
        fs[j].focus()
        fs[j].scrollIntoView({ block: 'nearest' })
      } else if (j >= fs.length) $('#q-bus').focus()
      return
    }
    if (e.key === 'Enter' && t.tagName === 'INPUT') {
      // Enter in a field never saves or launches a writing action.
      e.preventDefault()
      if (t.id === 'q-bus') {
        // Opens the first result that is a place (deck, card, screen); an action is never run with Enter.
        const primero = $('#bus-r a.bus__f:not([data-acc]), #bus-r .bus__ir a')
        if (primero) primero.click()
        else if ($('#bus-r [data-acc], #bus-r button.bus__f')) aviso('Enter no ejecuta acciones: tocá la que quieras.')
      } else t.blur()
      return
    }
    if (e.key === '/' && !sheet.key && !/INPUT|TEXTAREA|SELECT/.test(t.tagName)) {
      e.preventDefault()
      location.hash = hrefHoja({ hoja: 'buscar', q: '' })
      return
    }
    if (e.key === 'Tab' && sheet.key) {
      const f = $$('a[href], button:not([disabled]), input, select, textarea, [tabindex="0"]', hoja).filter((el) => el.offsetParent !== null)
      if (!f.length) return
      const i = f.indexOf(document.activeElement)
      if (e.shiftKey && i <= 0) {
        e.preventDefault()
        f[f.length - 1].focus()
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault()
        f[0].focus()
      }
      return
    }
    // Arrow keys inside tablists and radiogroups.
    const grupo = t.closest && t.closest('[role="tablist"], [role="radiogroup"]')
    if (grupo && /^Arrow|^Home$|^End$/.test(e.key)) {
      const items = $$('[role="tab"], [role="radio"]', grupo).filter((x) => x.getAttribute('aria-disabled') !== 'true')
      const i = items.indexOf(t)
      if (i < 0) return
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      e.preventDefault()
      items[j].focus()
      items[j].click()
      const again = $$('[role="tab"], [role="radio"]', t.isConnected ? grupo : document).find((x) => x.getAttribute('aria-selected') === 'true' || (x.dataset.fk && x.dataset.fk === items[j].dataset.fk))
      if (again && !items[j].isConnected) again.focus()
    }
  })
  window.addEventListener('hashchange', route)

  aplicarPrefs()
  route()
})()
