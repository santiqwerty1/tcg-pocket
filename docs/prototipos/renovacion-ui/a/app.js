/* Maqueta A · «La respuesta primero». JavaScript sin compilar ni dependencias; ver ../ESPECIFICACION.md.
   Muestra solo window.DATOS (../datos.js). Las oraciones de veredicto que no vienen escritas en los datos salen de
   una regla simple sobre UNA fuente (nunca mezclan mis partidas, torneo y simulación) y están marcadas con «regla:».
   Lo único que la maqueta recuerda mientras está abierta: el borrador de la partida (hasta guardarlo o descartarlo),
   las partidas guardadas en la sesión (se suman al récord de hoy) y qué desplegados quedaron abiertos. */
;(function () {
  'use strict'
  const D = window.DATOS
  const $ = (s, r = document) => r.querySelector(s)
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s))
  const root = document.documentElement

  /* ───────────── Formato (español rioplatense: coma decimal, punto de miles, espacio fino antes de %) ───────────── */
  const NB = String.fromCharCode(160) // espacio de no separación, escrito así para que se vea en el código
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const grp = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  function num(x, d = 1, fixed = false) {
    let s = Math.abs(x).toFixed(d)
    if (!fixed && s.includes('.')) s = s.replace(/\.?0+$/, '')
    const [i, f] = s.split('.')
    return (x < 0 ? '−' : '') + grp(i) + (f ? ',' + f : '')
  }
  const pct = (x) => num(x) + NB + '%'
  const sgn = (x, d = 1) => (x > 0 ? '+' : x < 0 ? '−' : '') + num(Math.abs(x), d)
  const int = (n) => grp(String(Math.round(n)))
  const WJ = String.fromCharCode(0x2060) // «word joiner»: sin ancho, impide el corte de renglón
  const ciT = (c) => `${num(c[0])}–${WJ}${num(c[1])}${NB}%`
  /* El punto medio queda pegado a lo que tiene antes: si el renglón corta, corta después del punto y ningún
     renglón empieza con «· …». */
  const PM = NB + '· '
  const recT = (r) => `${int(r.v)}${NB}V${PM}${int(r.d)}${NB}D` + (r.e ? `${PM}${int(r.e)}${NB}E` : '')
  const dm = (iso) => {
    const p = iso.split('-')
    return `${+p[2]}/${+p[1]}`
  }
  const cuando = (iso) => (iso === D.generado ? 'hoy' : dm(iso))
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
  const plural = (n, uno, muchos) => (n === 1 ? uno : muchos)
  /* datos.js trae «1 cruces fallaron»: se corrige al mostrarlo, sin tocar el dato. */
  const lector = (s) => String(s).replace(/\b1 cruces fallaron\b/g, '1 cruce falló')

  /* ───────────── Íconos de interfaz (trazos propios) ───────────── */
  const I = {
    hoy: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17M9 15l2.2 2.2 4-4.2"/>',
    mazos: '<rect x="8" y="3.5" width="11.5" height="15.5" rx="2.5"/><path d="M4.5 8v10.5A2.5 2.5 0 0 0 7 21h7.5"/>',
    cartas:
      '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M12 8l1.2 2.8L16 12l-2.8 1.2L12 16l-1.2-2.8L8 12l2.8-1.2z"/>',
    meta: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5.2c0 2.2 1 3.6 2.9 4M16 6h2.8c0 2.2-1 3.600-2.900 4M12 13v4M8.500 20.500h7M10 17h4"/>',
    pruebas: '<path d="M9.5 3h5M10.5 3v6L5 18.300A1.800 1.800 0 0 0 6.600 21h10.800a1.800 1.800 0 0 0 1.600-2.700L13.500 9V3M7.600 15h8.800"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.500 4.500"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    back: '<path d="M14.500 5.500L8 12l6.500 6.500"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevR: '<path d="M9.500 6l6 6-6 6"/>',
    chevD: '<path d="M6 9.500l6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    sync: '<path d="M20 11A8 8 0 0 0 5.600 7.500L4 9.500M4 4.500v5h5M4 13a8 8 0 0 0 14.400 3.500l1.600-2M20 19.500v-5h-5"/>',
    clock: '<circle cx="12" cy="12" r="8.500"/><path d="M12 7.500V12l3 2"/>',
    turno: '<path d="M8 5.500v13l10.500-6.500z"/>',
    clasificar: '<path d="M4 5.500A1.500 1.500 0 0 1 5.500 4H12l8 8-7.500 7.500L4 11z"/><circle class="f" cx="8.500" cy="8.500" r="1.300"/>',
    situaciones: '<circle cx="12" cy="12" r="8.500"/><circle cx="12" cy="12" r="4.300"/><circle class="f" cx="12" cy="12" r="1.200"/>',
    simulacion:
      '<rect x="6" y="6" width="12" height="12" rx="2.500"/><path d="M10 10h4v4h-4zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    promo: '<rect x="4" y="9.500" width="16" height="10.500" rx="2"/><path d="M4 13.500h16M12 9.500V20M12 9.500C10.500 5 6 5.500 7.500 9.500M12 9.500C13.500 5 18 5.500 16.500 9.500"/>',
    evento: '<path d="M5.500 21V4M5.500 4.500H17l-2.200 4 2.200 4H5.500"/>',
    undo: '<path d="M8 8h7a5 5 0 0 1 0 10H9M8 8l3.500-3.500M8 8l3.500 3.500"/>',
    check: '<path d="M5 12.500l4.500 4.500L19 7.500"/>',
    info: '<circle cx="12" cy="12" r="8.500"/><path d="M12 11v5M12 7.800v.2"/>',
    dots: '<circle class="f" cx="6" cy="12" r="1.600"/><circle class="f" cx="12" cy="12" r="1.600"/><circle class="f" cx="18" cy="12" r="1.600"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.500 6.500l4 4"/>',
    user: '<circle cx="12" cy="8.500" r="3.500"/><path d="M5 20c.8-3.500 3.500-5.500 7-5.500s6.200 2 7 5.500"/>',
    bot: '<rect x="5" y="8.500" width="14" height="10.500" rx="3"/><path d="M12 4.500v4M9.500 13v1.500M14.500 13v1.500"/><circle class="f" cx="12" cy="4" r="1.300"/>',
    up: '<path d="M5 16l5-5 3.500 3.500L19 9M14.500 9H19v4.500"/>',
    down: '<path d="M5 8l5 5 3.500-3.500L19 15M14.500 15H19v-4.500"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.600 5.600L7 7M17 17l1.400 1.400M5.600 18.400L7 17M17 7l1.400-1.400"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    shield: '<path d="M12 3.500l7 2.500v5.500c0 4.500-3 7.500-7 9-4-1.500-7-4.500-7-9V6z"/>',
    book: '<path d="M5 4.500h10.500a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10.500"/>',
    key: '<circle cx="8" cy="15.500" r="3.500"/><path d="M10.500 13L19 4.500M15.500 8l2.500 2.500"/>',
    session: '<path d="M14 4.500h3.500a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14M10 8l-4 4 4 4M6 12h9"/>',
    grid: '<rect x="4" y="4" width="6.500" height="6.500" rx="1.500"/><rect x="13.500" y="4" width="6.500" height="6.500" rx="1.500"/><rect x="4" y="13.500" width="6.500" height="6.500" rx="1.500"/><rect x="13.500" y="13.500" width="6.500" height="6.500" rx="1.500"/>',
    list: '<path d="M8.500 6.500H20M8.500 12H20M8.500 17.500H20"/><circle class="f" cx="4.500" cy="6.500" r="1.200"/><circle class="f" cx="4.500" cy="12" r="1.200"/><circle class="f" cx="4.500" cy="17.500" r="1.200"/>',
    x: '<path d="M7 7l10 10M17 7L7 17"/>',
    alert: '<path d="M12 4l8.500 15h-17zM12 10v4M12 16.800v.2"/>',
    versus: '<path d="M4 8h13M13.500 4.500L17 8l-3.500 3.500M20 16H7M10.500 12.500L7 16l3.500 3.500"/>',
    turn: '<circle cx="12" cy="12" r="8.500"/><path d="M12 7v5l3.500 2"/>',
    star: '<path d="M12 3.500l2.600 5.400 5.900.8-4.300 4.100 1 5.900-5.200-2.800-5.200 2.800 1-5.900L3.500 9.700l5.900-.8z"/>',
  }
  const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[name] || ''}</svg>`
  const BRAND =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.500l8.200 4.750v9.500L12 21.500l-8.200-4.750v-9.500z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.300" fill="currentColor"/></svg>'

  /* ───────────── Energías: glifos genéricos dibujados para la app (no son los símbolos del juego) ───────────── */
  const G = {
    grass:
      '<path class="g" d="M19.200 4.600c.500 7.300-2.600 12.400-8.200 13.400-1.500.300-2.900.100-4.100-.400L5.200 19.900l-1.300-1.300 1.800-1.800c-.600-1.300-.800-2.800-.500-4.300C6.200 7 11.500 4.100 19.200 4.600z"/><path class="c" d="M8.600 15.200c2.200-3.100 4.700-5.200 7.400-6.700"/>',
    fire: '<path class="g" fill-rule="evenodd" d="M12.600 2.600c.400 3 2 4.600 3.500 6.300 1.500 1.700 2.600 3.400 2.600 5.700a6.700 6.700 0 0 1-13.400 0c0-2 .800-3.700 2.100-5 .200 1.500.800 2.500 1.800 3 .200-3.400 1-6.800 3.400-10zM12 13.400c1.500 1.500 2.300 2.600 2.300 3.800a2.300 2.300 0 0 1-4.600 0c0-1.200.800-2.300 2.300-3.800z"/>',
    water:
      '<path class="g" d="M12 2.800c3.300 4.200 6.300 7.700 6.300 11.400a6.300 6.300 0 0 1-12.600 0c0-3.700 3-7.200 6.300-11.400z"/><path class="c" d="M8.900 14.600c.200 1.600 1.300 2.800 2.900 3.100"/>',
    lightning: '<path class="g" d="M13.800 2.200L5.200 13.600h5.300L9.300 21.800l9.500-12.300h-5.700z"/>',
    psychic:
      '<path class="g" fill-rule="evenodd" d="M2.300 12c2.700-4.300 6-6.400 9.700-6.400s7 2.100 9.700 6.400c-2.700 4.300-6 6.400-9.700 6.400S5 16.300 2.300 12zM12 8.200a3.800 3.800 0 1 0 0 7.600 3.800 3.800 0 0 0 0-7.600z"/><circle class="g" cx="12" cy="12" r="1.800"/>',
    fighting:
      '<path class="g" d="M6 9.400C6 8 7.100 6.900 8.500 6.900h7.200c1.800 0 3.300 1.500 3.300 3.300v3.600c0 3.500-2.800 6.300-6.300 6.300h-1.200C8.500 20.100 6 17.600 6 14.500z"/><path class="c" d="M9.700 7.100v3.500M12.900 7.100v3.500M16 7.300v3.300M6.500 13.300h6c1 0 1.800.800 1.800 1.800"/>',
    darkness: '<path class="g" d="M20.300 14.200A8.600 8.600 0 1 1 9.800 3.700a7.600 7.600 0 0 0 10.500 10.500z"/>',
    metal:
      '<path class="g" fill-rule="evenodd" d="M12 2.600l8.100 4.700v9.400L12 21.400l-8.100-4.700V7.300zM12 8.500a3.500 3.500 0 1 0 0 7 3.500 3.500 0 0 0 0-7z"/>',
    dragon: '<path class="gs" d="M4.500 16.500V12a7.500 7.500 0 0 1 15 0 5.600 5.600 0 0 1-11.200 0 3.200 3.200 0 0 1 6.400 0"/>',
    colorless:
      '<path class="g" d="M12 2.800c.900 4.900 2.500 7.400 9.200 9.200-6.700 1.800-8.300 4.300-9.200 9.200-.900-4.900-2.500-7.400-9.200-9.200 6.700-1.800 8.300-4.300 9.200-9.200z"/>',
  }
  const E = D.energias
  const tk = (e, cls = '') =>
    e && G[e]
      ? `<span class="tk ${cls}" data-e="${e}" role="img" aria-label="${esc(E[e].nombre)}"><svg viewBox="0 0 24 24" aria-hidden="true">${G[e]}</svg></span>`
      : ''
  const tks = (list, cls = '') => `<span class="tks">${(list || []).map((e) => tk(e, cls)).join('')}</span>`
  const eNames = (list) => (list || []).map((e) => E[e].nombre).join(' y ')

  /* ───────────── Estado ───────────── */
  const store = {
    get() {
      try {
        return JSON.parse(localStorage.getItem('maqueta-a') || '{}') || {}
      } catch (e) {
        return {}
      }
    },
    set(o) {
      try {
        localStorage.setItem('maqueta-a', JSON.stringify(o))
      } catch (e) {}
    },
  }
  const saved = store.get()
  /* Desplegados abiertos (por id): se vuelven a abrir cuando la pantalla o la hoja se pintan de nuevo. */
  const abiertos = new Set()
  const OPC = { tema: ['oscuro', 'claro', 'sistema'], movimiento: ['expresivo', 'sutil', 'ninguno'], vistas: ['arriba', 'abajo'] }
  const S = {
    tema: OPC.tema.includes(saved.tema) ? saved.tema : 'oscuro',
    movimiento: OPC.movimiento.includes(saved.movimiento) ? saved.movimiento : 'expresivo',
    vistas: OPC.vistas.includes(saved.vistas) ? saved.vistas : 'arriba',
    minis: saved.minis !== false,
    orden: 'torneo',
    mazos: { q: '', orden: 'ultima', filtro: 'todos' },
    grilla: false,
    coleccion: { q: '', filtro: 'todas' },
    jobs: 'todas',
    metaOrden: 'cuota',
    resVista: 'resumen',
    buscar: D.buscar.consulta,
    partida: nuevaPartida(D.partida.mazosRecientes[0].id),
    sesion: [],
    sid: 0,
    lastByTab: {},
    scroll: {},
    depth: 0,
  }
  function nuevaPartida(mazoId, modalidad) {
    for (const id of ['rnote-full', 'pv-cuenta', 'rango-demo']) abiertos.delete(id)
    return {
      mazoId,
      resultado: null,
      rival: null,
      rivalQ: '',
      empezo: null,
      cartas: [],
      modalidad: modalidad || D.partida.modalidades[0],
      nota: false,
      notaTxt: '',
      guardada: false,
      sid: null,
      rango: null,
    }
  }
  const mqLight = window.matchMedia('(prefers-color-scheme: light)')
  const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)')
  const motion = () => root.dataset.movimiento
  function applySettings() {
    const tema = S.tema === 'sistema' ? (mqLight.matches ? 'claro' : 'oscuro') : S.tema
    root.dataset.tema = tema
    root.dataset.movimiento = mqReduce.matches ? 'ninguno' : S.movimiento
    root.dataset.vistas = S.vistas
    const tc = $('meta[name="theme-color"]')
    if (tc) tc.setAttribute('content', tema === 'claro' ? '#f3f4f7' : '#0b0d11')
    store.set({ tema: S.tema, movimiento: S.movimiento, vistas: S.vistas, minis: S.minis })
  }
  mqLight.addEventListener('change', applySettings)
  mqReduce.addEventListener('change', applySettings)

  /* ───────────── Piezas ───────────── */
  const deckById = (id) => D.mazos.find((m) => m.id === +id)
  const deckArts = (id) => {
    const ses = D.hoy.mazosSesion.find((m) => m.id === +id) || D.hoy.mazosDelDia.find((m) => m.id === +id)
    return ses || deckById(id)
  }
  const nbw = (t) =>
    esc(t)
      .replace(/ \/ /g, NB + '/ ')
      .replace(/[^\s\u00a0/]+-[^\s\u00a0/]+/g, (w) => `<span class="nb">${w}</span>`)
  /* Nombre de mazo: «#número» + nombre, en hasta dos líneas y nunca cortado. Lo que va después de la barra es un
     bloque que baja entero al renglón siguiente: así el corte cae después de «/» y no deja un «ex» solo. Nunca usa
     más renglones que el corte común (el bloque es más angosto que cualquier columna de la maqueta). */
  const dn = (id, nombre) => {
    const partes = nombre.split(' / ')
    const cuerpo = partes.map((p, i) => (i ? `<span class="dn__p">${nbw(p)}${i < partes.length - 1 ? NB + '/' : ''}</span>` : nbw(p) + (partes.length > 1 ? NB + '/' : ''))).join(' ')
    return `<span class="dn"><span class="dn__id">#${id}</span> ${cuerpo}</span>`
  }
  /* Reemplazo de una imagen que no carga: el color del tipo con su glifo de energía, o la inicial si la carta no
     tiene tipo. El nombre va escrito solo en los recuadros grandes (lo decide el CSS); en los chicos ya está al lado. */
  const inicial = (s) => (String(s || '').trim().charAt(0) || '?').toUpperCase()
  const fb = (cls, nombre, tipo) =>
    `<span class="${cls}">${tipo && G[tipo] ? `<svg viewBox="0 0 24 24">${G[tipo]}</svg>` : `<b>${esc(inicial(nombre))}</b>`}<span class="fb__n">${esc(nombre || '')}</span></span>`
  const img = (url) => (url ? `<img src="${esc(url)}" alt="" loading="lazy" width="63" height="88" onerror="this.parentNode.classList.add('is-fb');this.remove()">` : '')
  const thumb = (url, nombre, tipo, cls = '') =>
    S.minis ? `<span class="thumb ${cls}${url ? '' : ' is-fb'}" data-e="${tipo || 'none'}" aria-hidden="true">${fb('thumb__fb', nombre, tipo)}${img(url)}</span>` : ''
  const art = (url, de) =>
    `<span class="art${url ? '' : ' is-fb'}" data-e="${(de && de.tipo) || 'none'}" aria-hidden="true">${fb('art__fb', de && de.nombre, de && de.tipo)}${img(url)}</span>`
  const arts = (m, n = 3, cls = 'arts') =>
    S.minis && m && m.miniaturas
      ? `<span class="${cls}" data-n="${Math.min(n, m.miniaturas.length)}">${m.miniaturas
          .slice(0, n)
          .map((u, i) => art(u, m.miniaturasDe[i]))
          .join('')}</span>`
      : ''
  const res = (r, cls = '') => {
    const k = r.charAt(0).toUpperCase()
    const full = { V: 'Victoria', D: 'Derrota', E: 'Empate' }[k]
    return `<i class="res res--${k} ${cls}" role="img" aria-label="${full}">${k}</i>`
  }
  const om = (o) => (o && o.orientativo ? '<i class="om" aria-hidden="true"></i><span class="vh"> orientativo</span>' : '')
  const nm = (o) => (o && o.cobertura === 0 ? '<i class="nm" aria-hidden="true"></i><span class="vh"> sin matchups medidos</span>' : '')
  const nT = (o, extra = '') => `<span class="n">n${NB}${int(o.n)}${extra}${om(o)}</span>`
  const nil = '<b class="pct pct--nil">sin datos</b>'
  function ibar(o, opt = {}) {
    if (!o) return ''
    const ref = opt.ref == null ? 50 : opt.ref
    const a = o.ci[0]
    const b = o.ci[1]
    const tone = opt.tone === false ? '' : a > ref ? 'win' : b < ref ? 'loss' : ''
    return `<span class="ibar ${opt.cls || ''}" data-tone="${tone}" role="img" aria-label="${pct(o.pct)}; intervalo de 95${NB}% de ${ciT(o.ci)}"><i class="ibar__ref" style="left:${ref}%"></i><i class="ibar__ci" style="left:${a}%;width:${Math.max(b - a, 1.5)}%"></i><i class="ibar__dot" style="left:${o.pct}%"></i></span>`
  }
  const axis = (mid = `50${NB}%`) => `<div class="axis" aria-hidden="true"><span>0</span><span>${mid}</span><span>100${NB}%</span></div>`
  function spark(serie) {
    const w = 64
    const h = 26
    const p = 3
    const max = Math.max.apply(null, serie) || 1
    const pts = serie.map((v, i) => [p + (i * (w - 2 * p)) / (serie.length - 1), h - p - (v / max) * (h - 2 * p)])
    const d = pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('')
    const last = pts[pts.length - 1]
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path class="ar" d="${d}L${last[0].toFixed(1)} ${h}L${p} ${h}Z"/><path d="${d}"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.800"/></svg>`
  }
  /* Gráfico de líneas chico con los números escritos. series: [{ v: [..], cls, pt, lab: { idx: true }, pref: 'up' | 'down' }]
     Cada rótulo se ubica solo: de seis lugares alrededor de su punto elige el que queda más lejos de las líneas, de los
     otros puntos y de los rótulos ya puestos, sin salirse del gráfico ni pisar el eje. */
  function lineChart(o) {
    const w = 298 // el ancho que tiene en la tarjeta a 360 px: así 14 px del dibujo son 14 px en pantalla
    const h = o.h || 150
    const pad = Object.assign({ l: 34, r: 18, t: 30, b: o.sub ? 42 : 26 }, o.pad || {})
    const n = o.xs.length
    const X = (i) => pad.l + (i * (w - pad.l - pad.r)) / (n - 1)
    const Y = (v) => pad.t + (1 - v / 100) * (h - pad.t - pad.b)
    let out = ''
    for (const t of [0, 50, 100]) {
      out += `<line class="${t === 50 && o.ref50 ? 'ref' : 'grid'}" x1="${pad.l}" x2="${w - pad.r}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${pad.l - 7}" y="${Y(t) + 5}" text-anchor="end">${t}</text>`
    }
    o.xs.forEach((x, i) => {
      out += `<text x="${X(i)}" y="${h - (o.sub ? 22 : 6)}" text-anchor="middle">${esc(x.label)}</text>`
      if (o.sub) out += `<text x="${X(i)}" y="${h - 4}" text-anchor="middle">${esc(x.sub)}</text>`
    })
    const all = o.series.map((s) => s.v.map((v, i) => [X(i), Y(v)]))
    /* puntos de muestra sobre todas las líneas, para medir distancias */
    const muestras = []
    all.forEach((pts) => {
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1]
        const [x1, y1] = pts[i]
        const pasos = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 3))
        for (let k = 0; k <= pasos; k++) muestras.push([x0 + ((x1 - x0) * k) / pasos, y0 + ((y1 - y0) * k) / pasos])
      }
    })
    /* los números del eje también ocupan lugar */
    const puestos = [0, 50, 100].map((t) => ({ x0: pad.l - 7 - String(t).length * 8, x1: pad.l - 7, y0: Y(t) - 6, y1: Y(t) + 5 }))
    const dist = (b, p) => Math.hypot(Math.max(b.x0 - p[0], 0, p[0] - b.x1), Math.max(b.y0 - p[1], 0, p[1] - b.y1))
    const pisa = (a, b) => a.x0 < b.x1 + 2 && a.x1 > b.x0 - 2 && a.y0 < b.y1 + 1 && a.y1 > b.y0 - 1
    const LUGARES = [
      { dx: 0, dy: -13, a: 'middle', lado: 'up' },
      { dx: 0, dy: 25, a: 'middle', lado: 'down' },
      { dx: -9, dy: -9, a: 'end', lado: 'up' },
      { dx: 9, dy: -9, a: 'start', lado: 'up' },
      { dx: -9, dy: 21, a: 'end', lado: 'down' },
      { dx: 9, dy: 21, a: 'start', lado: 'down' },
    ]
    function ubicar(q, txt, pref) {
      const tw = txt.length * 7.9
      let mejor = null
      for (const L of LUGARES) {
        const x = q[0] + L.dx
        const y = q[1] + L.dy
        const b = { x0: L.a === 'middle' ? x - tw / 2 : L.a === 'end' ? x - tw : x, y0: y - 11, y1: y + 2 }
        b.x1 = b.x0 + tw
        if (b.x0 < 6 || b.x1 > w + 8 || b.y0 < 1 || b.y1 > Y(0) + 2) continue
        if (puestos.some((p) => pisa(b, p))) continue
        let d = Infinity
        for (const m of muestras) {
          if (Math.abs(m[0] - q[0]) < 1.5 && Math.abs(m[1] - q[1]) < 1.5) continue
          d = Math.min(d, dist(b, m))
        }
        const score = Math.min(d, 14) + (L.lado === pref ? 5 : 0) + (L.a === 'middle' ? 1 : 0)
        if (!mejor || score > mejor.score) mejor = { score, x, y, a: L.a, b }
      }
      if (!mejor) mejor = { x: q[0], y: q[1] - 13, a: 'middle', b: { x0: 0, x1: 0, y0: 0, y1: 0 } }
      puestos.push(mejor.b)
      return mejor
    }
    let marcas = ''
    o.series.forEach((s, si) => {
      const pts = all[si]
      const d = pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('')
      let len = 0
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
      if (s.area) out += `<path class="ar" d="${d}L${pts[pts.length - 1][0].toFixed(1)} ${Y(0)}L${pts[0][0].toFixed(1)} ${Y(0)}Z"/>`
      out += `<path class="${s.cls || 'ln'}" style="--len:${Math.ceil(len)}" d="${d}"/>`
      pts.forEach((q, i) => {
        const r = s.r ? s.r(i) : 3.4
        if (!s.dots || s.dots(i)) marcas += `<circle class="${s.pt || 'pt'}" cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${r}"/>`
      })
    })
    /* los rótulos van al final, sobre las líneas, con un halo del color del fondo */
    o.series.forEach((s, si) => {
      all[si].forEach((q, i) => {
        if (!s.lab || !s.lab[i]) return
        const txt = pct(s.v[i])
        const u = ubicar(q, txt, s.pref || 'up')
        marcas += `<text class="${s.vcls || 'v'}" x="${u.x.toFixed(1)}" y="${u.y.toFixed(1)}" text-anchor="${u.a}">${txt}</text>`
      })
    })
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(o.label)}">${out}${marcas}</svg>`
  }
const srcIcon = { torneo: 'meta', mias: 'user', laboratorio: 'bot', simulacion: 'bot' }
  const srcName = { torneo: 'Torneo', mias: 'Mis partidas', laboratorio: 'Laboratorio', simulacion: 'Simulación' }
  const spine = (energias) => `<i class="spine" aria-hidden="true">${(energias && energias.length ? energias : ['none']).map((e) => `<i data-e="${e}"></i>`).join('')}</i>`
  const wm = (e) => (e && G[e] ? `<span class="verdict__wm" aria-hidden="true"><span class="tk" data-e="${e}"><svg viewBox="0 0 24 24">${G[e]}</svg></span></span>` : '')
  const shine = '<i class="shine" aria-hidden="true"></i>'
  const dock = (inner) =>
    `<button class="dock__find" data-act="find" aria-label="Buscar pantallas, acciones, mazos y cartas">${ic('search')}</button>${inner}`
  const todo = (msg) => `data-act="todo" data-msg="${esc(msg)}"`
  const diff = (list) =>
    `<span class="diff">${list
      .map((c) => {
        const t = c.trim()
        const cls = /^\+/.test(t) ? 'in' : /^[−-]/.test(t) ? 'out' : ''
        return `<span class="${cls}">${esc(t)}</span>`
      })
      .join('')}</span>`
  const legendO = (extra = '') =>
    `<p class="legend"><span><i class="om"></i>orientativo: menos de 30 partidas${extra}</span></p>`

  /* ───────────── Hoy ───────────── */
  /* Partidas guardadas mientras dura la sesión de la maqueta: se suman al récord de hoy y se restan al deshacer. */
  const LETRA = { Victoria: 'v', Derrota: 'd', Empate: 'e' }
  const sesRec = (mazoId) =>
    S.sesion
      .filter((p) => mazoId == null || p.mazoId === mazoId)
      .reduce((r, p) => ((r[LETRA[p.resultado]] += 1), r), { v: 0, d: 0, e: 0 })
  const suma = (a, b) => ({ v: a.v + b.v, d: a.d + b.d, e: a.e + b.e })
  const recHoy = () => suma(D.hoy.record, sesRec())
  function recMazoHoy(id) {
    const base = (D.hoy.mazosSesion.find((m) => m.id === +id) || {}).hoy
    const s = sesRec(+id)
    return base || s.v + s.d + s.e ? suma(base || { v: 0, d: 0, e: 0 }, s) : null
  }
  const ultimas = () =>
    S.sesion
      .slice()
      .reverse()
      .map((p) => ({ resultado: p.resultado, mazoId: p.mazoId, mazo: deckById(p.mazoId).nombre, rival: p.rival || 'Sin rival', cuando: 'recién', modalidad: p.modalidad, empezo: p.empezo }))
      .concat(D.hoy.ultimasPartidas)
  function hoyOrden() {
    const k = S.orden
    return D.hoy.mazosDelDia
      .map((m, i) => ({ m, i }))
      .sort((a, b) => {
        const x = a.m[k]
        const y = b.m[k]
        if (x && y) return y.pct - x.pct || a.i - b.i
        if (x) return -1
        if (y) return 1
        return a.i - b.i
      })
      .map((o) => o.m)
  }
  /* regla: el porqué describe SOLO la fuente por la que está ordenado; nunca nombra un ganador (decisión de Santi). */
  function hoyPorque(list) {
    const k = S.orden
    const con = list.filter((m) => m[k])
    if (k === 'mias') {
      if (!con.length) return 'Por tus partidas: todavía no jugaste con ninguno de los tres.'
      return con.length === 1 ? `Por tus partidas, solo <b>#${con[0].id}</b> tiene datos.` : `Por tus partidas: ${con.length} de los tres tienen datos.`
    }
    if (k === 'torneo') {
      const top = con[0]
      const pisan = con.every((m) => m.torneo.ci[1] >= top.torneo.ci[0])
      return pisan ? 'Por torneo, los tres intervalos se pisan.' : 'Por torneo, los intervalos no se pisan del todo.'
    }
    const sobre = con.filter((m) => m.laboratorio.ci[0] > 50)
    return sobre.length === 1
      ? `Con bots, solo <b>#${sobre[0].id}</b> tiene el intervalo sobre 50${NB}%.`
      : `Con bots, ${sobre.length} de los tres tienen el intervalo sobre 50${NB}%.`
  }
  /* Las tres columnas de cada tarjeta caen justo debajo de «Torneo · Mis partidas · Laboratorio» del selector de
     orden, que hace de encabezado: cada número dice su fuente con el rótulo de arriba y con su ícono. */
  function hoyCelda(m, k) {
    const o = m[k]
    const sort = S.orden === k ? ' is-sort' : ''
    if (!o) return `<span class="hd__c${sort}"><span class="vh">${srcName[k]}: </span><b class="pct pct--nil">${ic(srcIcon[k])}sin datos</b></span>`
    return `<span class="hd__c${sort}"><span class="vh">${srcName[k]}: </span><b class="pct">${ic(srcIcon[k])}<span data-cu="${o.pct}">${pct(o.pct)}</span></b>${nT(o, (o.bot ? ` · ${esc(o.bot)}` : '') + nm(o))}</span>`
  }
  function tresFuentes(m) {
    const f = (k, titulo, extra) => {
      const o = m[k]
      if (!o) return `<div class="srcd">${ic(srcIcon[k])}<p class="srcd__h"><b>${titulo}</b><span>sin datos</span></p></div>`
      return `<div class="srcd">${ic(srcIcon[k])}<p class="srcd__h"><b>${titulo}</b><span>${pct(o.pct)} · n${NB}${int(o.n)}</span></p>${ibar(o)}<p class="srcd__d">IC${NB}95${NB}%: ${ciT(o.ci)}${o.record ? ` · ${recT(o.record)}` : ''}${o.orientativo ? ' · orientativo' : ''}${extra || ''}</p></div>`
    }
    return (
      f('torneo', 'Torneo · esperado contra el meta', m.torneo ? ` · matchups medidos: ${pct(m.torneo.cobertura)} del meta` : '') +
      f('mias', 'Mis partidas') +
      f('laboratorio', `Laboratorio${m.laboratorio ? ' · bot ' + esc(m.laboratorio.bot) : ''}`)
    )
  }
  function hoyMazosLista() {
    return hoyOrden()
      .map(
        (m) => `<li class="verdict hdc" data-e="${m.energias[0]}" data-key="${m.id}">
        ${spine(m.energias)}
        <button class="hd" data-act="toggle" data-t="hd-${m.id}" data-fid="hd-${m.id}" aria-expanded="false" aria-controls="hd-${m.id}">
          <span class="hd__top"><span class="hd__art">${S.minis && m.miniaturas ? art(m.miniaturas[0], m.miniaturasDe[0]) : ''}${tks(m.energias, S.minis ? 'tk--s' : '')}</span><span class="hd__name">${dn(m.id, m.nombre)}</span><span class="row__go">${ic('chevD', 'chev')}</span></span>
          <span class="hd__nums">${hoyCelda(m, 'torneo')}${hoyCelda(m, 'mias')}${hoyCelda(m, 'laboratorio')}</span>
        </button>
        <div class="hd__more" id="hd-${m.id}" hidden>${tresFuentes(m)}
          <div class="rowf" style="margin-top:8px"><a class="btn btn--sec btn--s btn--grow btn--fit" href="#/mazo/${m.id}">Abrir la ficha</a><button class="btn btn--sec btn--s btn--grow btn--fit" data-act="partida" data-mazo="${m.id}">Registrar con este</button></div>
        </div>
      </li>`,
      )
      .join('')
  }
  function hoyMazos() {
    const seg = ['torneo', 'mias', 'laboratorio']
      .map(
        (k) =>
          `<button class="seg__o" data-act="orden" data-v="${k}" data-fid="ord-${k}" aria-pressed="${S.orden === k}" aria-label="Ordenar por ${srcName[k].toLowerCase()}">${ic(srcIcon[k])}${srcName[k]}</button>`,
      )
      .join('')
    return `<section class="hm" aria-labelledby="hm-q">
      <div class="hm__head">
        <div class="hm__q"><p class="label" id="hm-q">¿Qué mazo llevo hoy?</p><button class="iconbtn" data-act="toggle" data-t="hm-nota" aria-expanded="false" aria-controls="hm-nota" aria-label="¿Qué es cada número?">${ic('info', 'ic--s')}</button></div>
        <h2 class="verdict__a">Tres candidatos, sin un ganador</h2>
        <p class="verdict__why" id="hm-why">${hoyPorque(hoyOrden())}</p>
        <p class="note" id="hm-nota" hidden>${esc(D.hoy.mazosDelDiaNota)} ${esc(D.hoy.mazosDelDiaMeta)}. Los del laboratorio son bots: una pista.</p>
      </div>
      <div class="hm__sort"><div class="seg" role="group" aria-label="Las tres fuentes: tocá una para ordenar">${seg}</div></div>
      <ol class="hm__list" id="hm-list">${hoyMazosLista()}</ol>
      <p class="legend"><span><i class="om"></i>orientativo: n${NB}<${NB}30</span>${D.hoy.mazosDelDia.some((m) => m.torneo && m.torneo.cobertura === 0) ? '<span><i class="nm"></i>sin matchups medidos</span>' : ''}</p>
    </section>`
  }
  function sobreTinte() {
    const v = D.cartas.sobres.veredicto
    return D.cartas.sobres.faltan.find((x) => x.sobre.indexOf(v.nombre) === 0 && x.tipo) || null
  }
  function hoySobre() {
    const s = D.hoy.sobre
    const v = D.cartas.sobres.veredicto
    const f = sobreTinte()
    const e = f ? f.tipo : 'none'
    const cards = f && S.minis ? `<span class="pack__cards">${thumb(f.imagen, f.carta, f.tipo)}${f.falta > 1 ? thumb(f.imagen, f.carta, f.tipo) : ''}</span>` : ''
    return `<a class="verdict" data-e="${e}" href="#/cartas" aria-labelledby="hs-q hs-a">
      ${spine([e])}${wm(f && f.tipo)}${shine}
      <span class="packf">
        ${cards}
        <span class="verdict__q" id="hs-q">¿Qué sobre abro?</span>
        <span class="verdict__a" id="hs-a">Abrí ${esc(s.nombre)}</span>
        <span class="verdict__why">${esc(s.porque)}</span>
      </span>
      <span class="sub rowf between"><span>${esc(s.expansion)} · <span class="mono">${esc(v.expansionId)}</span><br>Después: ${s.alternativas.map((a) => esc(a.nombre)).join(' · ')}</span><span class="row__go">${ic('chevR')}</span></span>
    </a>`
  }
  const pendIcon = { turno: 'turno', clasificar: 'clasificar', situaciones: 'situaciones', simulacion: 'simulacion', laboratorio: 'pruebas', promo: 'promo', evento: 'evento' }
  function hoyPend() {
    const conPlazo = (p) => p.tipo === 'promo' || p.tipo === 'evento'
    const todos = D.hoy.pendientes
    const fila = (p) => {
      const inner = `<span class="row__ic${conPlazo(p) ? ' row__ic--warn' : ''}">${ic(pendIcon[p.tipo] || 'info')}</span><span class="grow"><span class="row__t" style="display:block">${esc(p.texto)}</span><span class="row__d" style="display:block">${esc(p.detalle)}</span></span><span class="row__go">${ic('chevR')}</span>`
      return p.destino === '#/hoy'
        ? `<li><button class="row" ${todo('«Clasificar rivales» no está en la maqueta: va en Hoy → Mis partidas.')}>${inner}</button></li>`
        : `<li><a class="row" href="${p.destino}">${inner}</a></li>`
    }
    const plazo = todos.filter(conPlazo)
    const resto = todos.filter((p) => !conPlazo(p))
    /* de qué son los que quedan plegados: sale de sus tipos, sin repetir */
    const queEs = { turno: 'partida en curso', clasificar: 'rivales sin clasificar', situaciones: 'situaciones', simulacion: 'pruebas que terminaron', laboratorio: 'pruebas que terminaron' }
    const deQue = [...new Set(resto.map((p) => queEs[p.tipo]).filter(Boolean))].join(', ')
    return `<h2 class="h2">Pendientes <small>${todos.length} · ${plazo.length} con plazo</small></h2>
      <ul class="card rows">${plazo.map(fila).join('')}
        ${
          resto.length
            ? `<li><button class="row row--more" data-act="toggle" data-t="pend-resto" aria-expanded="false" aria-controls="pend-resto"><span class="grow"><span class="row__t" style="display:block">Ver los ${todos.length}</span><span class="row__d" style="display:block">${resto.length} más, sin plazo${deQue ? ': ' + deQue : ''}</span></span><span class="row__go">${ic('chevD', 'chev')}</span></button>
          <ul class="rows rows--in" id="pend-resto" hidden>${resto.map(fila).join('')}</ul></li>`
            : ''
        }
      </ul>`
  }
  function hoyMeta() {
    const m = D.hoy.meta
    const row = (o, sube) => `<a class="trend" href="#/meta">
        <span><span class="trend__n" style="display:block">${esc(o.nombre)}${o.nuevo ? ' <span class="badge badge--line">nuevo</span>' : ''}</span><span class="row__d" style="display:block">${sube ? 'Sube' : 'Baja'} · cuota ${pct(o.cuota)}</span></span>
        <span class="trend__r">${spark(o.serie)}<span class="delta rowf" style="gap:3px">${ic(sube ? 'up' : 'down', 'ic--xs')}${sgn(o.delta)}${NB}pts</span></span>
      </a>`
    return `<h2 class="h2">Novedades del meta <small>últimos ${m.dias} días</small></h2>
      <div class="card">${row(m.sube, true)}${row(m.baja, false)}</div>`
  }
  function semanaAnterior() {
    const a = D.hoy.semana.anterior
    const m = /IC\s*([\d,]+)–([\d,]+)/.exec(a.texto)
    return { pct: (a.v / a.n) * 100, n: a.n, ci: m ? [parseFloat(m[1].replace(',', '.')), parseFloat(m[2].replace(',', '.'))] : null, record: a }
  }
  const pillHTML = () => {
    const r = recHoy()
    return `<button class="top__pill" data-act="scroll" data-to="como-vengo" aria-label="Hoy: ${r.v} victorias y ${r.d} derrotas. Ver cómo vengo"><span>${res('V', 'res--s')}${r.v}<i class="res res--s res--D" style="margin-left:6px" aria-hidden="true">D</i>${r.d}</span></button>`
  }
  const hoyRecHTML = () => {
    const r = recHoy()
    return `<span>${r.v}–${r.d}</span><small>${recT(r)}</small>`
  }
  function sesionFilas() {
    return D.hoy.mazosSesion
      .map((m) => {
        const h = recMazoHoy(m.id)
        return `<a class="sess" href="#/mazo/${m.id}">
        ${tks(m.energias)}<span class="grow">${dn(m.id, m.nombre)}</span><span class="pct pct--m">${h.v}–${h.d}<span class="vh"> hoy (victorias–derrotas)</span></span>
        <span class="sess__r"><span class="streak" role="img" aria-label="Últimas ${m.racha.length}: ${m.racha.join(' ')}">${m.racha.map((r) => `<i class="res res--s res--${r}" aria-hidden="true">${r}</i>`).join('')}</span><span class="n">${pct(m.mias.pct)} · n${NB}${m.mias.n}${om(m.mias)}</span></span>
      </a>`
      })
      .join('')
  }
  function ultimasFilas() {
    return ultimas()
      .map(
        (p, i) => `<li><button class="match" data-act="jugada" data-i="${i}">${res(p.resultado)}<span class="match__t">${esc(p.rival)}</span><span class="match__w">${esc(p.cuando.replace(/^hoy /, ''))}</span>
        <span class="match__d">${dn(p.mazoId, p.mazo)}<br>${p.empezo ? (p.empezo === 'yo' ? 'empecé yo' : 'empezó el rival') + ' · ' : ''}${esc(p.modalidad)}</span></button></li>`,
      )
      .join('')
  }
  function hoyVengo() {
    const h = D.hoy
    const w = h.semana
    const prev = semanaAnterior()
    const nUlt = ultimas().length
    return `<h2 class="h2" id="como-vengo" tabindex="-1">Cómo vengo</h2>
      <div class="card">
        <div class="stack gap12" style="padding:14px">
          <div class="big3">
            <p class="label">Hoy</p><p class="label">${h.temporadaVigente ? 'Rango' : 'Último rango anotado'}</p>
            <p class="big3__rec" id="hoy-rec">${hoyRecHTML()}</p>
            <p style="font-weight:600;line-height:20px">${esc(h.rango)}</p>
          </div>
          <div class="week">
            <div><p class="wk__h"><span>Esta semana · ${esc(w.etiqueta)}<br>${recT(w)} · IC${NB}${ciT(w.ci)}</span><b class="pct pct--m">${pct(w.pct)} <span class="n">n${NB}${w.n}${om(w)}</span></b></p>${ibar(w)}</div>
            <div><p class="wk__h"><span>Semana anterior<br>${recT(prev.record)}${prev.ci ? ` · IC${NB}${ciT(prev.ci)}` : ''}</span><b class="pct pct--m">${pct(prev.pct)} <span class="n">n${NB}${prev.n}</span></b></p>${prev.ci ? ibar(prev) : ''}${axis()}</div>
          </div>
          ${legendO()}
          <p class="note">${esc(h.temporada)}. Próxima: ${esc(h.proximaTemporada)}.</p>
        </div>
        <ul class="rows rows--top">
          <li><button class="row row--more" data-act="toggle" data-t="ses-mazos" aria-expanded="false" aria-controls="ses-mazos"><span class="grow"><span class="row__t" style="display:block">Mazos de la sesión</span><span class="row__d" style="display:block">${h.mazosSesion.map((m) => '#' + m.id).join(' · ')} · hoy, racha y total</span></span><span class="row__go">${ic('chevD', 'chev')}</span></button>
            <div class="rows--in" id="ses-mazos" hidden><div id="ses-list">${sesionFilas()}</div>${legendO()}</div></li>
          <li><button class="row row--more" data-act="toggle" data-t="ult" aria-expanded="false" aria-controls="ult"><span class="grow"><span class="row__t" style="display:block">Últimas partidas</span><span class="row__d" style="display:block" id="ult-n">${nUlt} de hoy · tocá una para verla</span></span><span class="row__go">${ic('chevD', 'chev')}</span></button>
            <ul class="rows rows--in" id="ult" hidden>${ultimasFilas()}</ul></li>
        </ul>
      </div>`
  }
  /* Lo que cambia al guardar o deshacer una partida, sin volver a pintar la pantalla (no se cierran los desplegados). */
  function syncSesion() {
    const pill = $('.top__pill')
    if (pill) pill.outerHTML = pillHTML()
    const rec = $('#hoy-rec')
    if (rec) rec.innerHTML = hoyRecHTML()
    const ult = $('#ult')
    if (ult) ult.innerHTML = ultimasFilas()
    const n = $('#ult-n')
    if (n) n.textContent = `${ultimas().length} de hoy · tocá una para verla`
    const ses = $('#ses-list')
    if (ses) ses.innerHTML = sesionFilas()
    syncDock()
  }
  function vHoy() {
    const h = D.hoy
    return {
      tab: 'hoy',
      title: 'Hoy',
      sub: cap(h.fechaTexto.split(',')[0]) + ' ' + dm(h.fecha),
      pill: pillHTML(),
      html: hoyMazos() + hoySobre() + hoyPend() + hoyMeta() + hoyVengo() + `<p class="note">${esc(D.aviso)}.</p>`,
      dock: dock(dockPartida()),
    }
  }


  /* ───────────── Mazos ───────────── */
  function mazosFiltrados() {
    const f = S.mazos
    const q = f.q.trim().toLowerCase()
    let list = D.mazos.filter((m) => {
      if (q && !(m.nombre.toLowerCase().includes(q) || ('#' + m.id).includes(q) || String(m.id) === q)) return false
      if (f.filtro === 'jugados') return !!m.mias
      if (f.filtro === 'falta') return !m.completo
      return true
    })
    const by = {
      ultima: (a, b) => (b.ultima || '').localeCompare(a.ultima || '') || (b.mias ? b.mias.n : 0) - (a.mias ? a.mias.n : 0) || a.id - b.id,
      pct: (a, b) => (b.mias ? b.mias.pct : -1) - (a.mias ? a.mias.pct : -1) || a.id - b.id,
      numero: (a, b) => a.id - b.id,
      nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
    }
    return list.slice().sort(by[f.orden])
  }
  function mazosLista() {
    const list = mazosFiltrados()
    if (!list.length) return `<p class="find__empty">Ningún mazo coincide con «${esc(S.mazos.q)}».</p>`
    return (
      `<ul class="card rows">` +
      list
        .map(
          (m) => `<li><a class="dk" href="#/mazo/${m.id}">
          ${S.minis ? arts(m, 2, 'dk__arts') : tks(m.energias, 'tk--l')}
          <span class="dk__m">${dn(m.id, m.nombre)}<span class="dk__meta">${S.minis ? tks(m.energias, 'tk--s') : ''}${m.ultima ? `<span>última: ${cuando(m.ultima)}</span>` : ''}${
            m.completo ? '' : `<span class="badge badge--warn">falta ${m.falta}</span>`
          }</span></span>
          <span class="dk__num">${m.mias ? `<b class="pct">${pct(m.mias.pct)}</b>${nT(m.mias)}` : nil}</span>
        </a></li>`,
        )
        .join('') +
      `</ul>`
    )
  }
  function vMazos() {
    const total = D.mazos.length
    const falta = D.mazos.filter((m) => !m.completo).length
    const jug = D.mazos.filter((m) => m.mias).length
    const f = S.mazos
    const seg = [
      ['todos', 'Todos', total],
      ['jugados', 'Jugados', jug],
      ['falta', 'Falta carta', falta],
    ]
      .map(
        (o) =>
          `<button class="seg__o" data-act="mz-filtro" data-v="${o[0]}" data-fid="mzf-${o[0]}" aria-pressed="${f.filtro === o[0]}">${o[1]} <span class="chip__n">${o[2]}</span></button>`,
      )
      .join('')
    const opts = [
      ['ultima', 'Última partida'],
      ['pct', '% en mis partidas'],
      ['numero', 'Número'],
      ['nombre', 'Nombre'],
    ]
      .map((o) => `<option value="${o[0]}"${f.orden === o[0] ? ' selected' : ''}>${o[1]}</option>`)
      .join('')
    return {
      tab: 'mazos',
      title: 'Mazos',
      html: `<section class="stack gap6" style="padding:2px 2px 0">
          <p class="label">¿Qué tengo armado?</p>
          <h2 class="verdict__a">${total} mazos armados; a ${falta} les falta una carta o dos</h2>
          <p class="verdict__why">${total - falta} completos con tu colección · ${jug} con partidas tuyas.</p>
        </section>
        <div class="tools">
          <div class="tools__r" style="flex-wrap:nowrap">
            <label class="field grow">${ic('search')}<input class="input" id="mz-q" type="search" placeholder="Buscar mazo" aria-label="Buscar mazo por nombre o número" autocomplete="off" enterkeyhint="search" value="${esc(f.q)}"></label>
            <select class="select" id="mz-orden" aria-label="Ordenar por" style="flex:0 0 150px;width:150px">${opts}</select>
          </div>
          <div class="seg" role="group" aria-label="Filtrar">${seg}</div>
        </div>
        <div class="rowf between" style="padding:0 4px"><p class="label">Mazo</p><p class="label">Mis partidas · % y n</p></div>
        <div id="mz-list" style="margin-top:-6px">${mazosLista()}</div>
        ${legendO()}`,
      dock: dock(
        `<button class="btn btn--pri btn--grow" ${todo('«Nuevo mazo» abre el editor; en la maqueta no está.')}>${ic('plus')}Nuevo mazo</button><button class="btn btn--sec" ${todo('Importar un mazo y «Al azar» van acá; en la maqueta no están.')} aria-label="Más acciones de mazos">${ic('dots')}</button>`,
      ),
    }
  }

  /* ───────────── Ficha del mazo ───────────── */
  const VISTAS = [
    ['lista', 'Lista'],
    ['rinde', 'Rinde'],
    ['mejorar', 'Mejorar'],
    ['notas', 'Notas'],
  ]
  /* regla: una sola fuente (mis partidas); «parejo» si el intervalo de 95 % incluye el 50 %. */
  function mazoVeredicto(m) {
    const cls = m.ci[0] > 50 ? 'Ganador' : m.ci[1] < 50 ? 'Perdedor' : 'Parejo'
    return {
      a: `${cls} en tus partidas: ${pct(m.pct)}`,
      why: `n${NB}=${NB}${m.n}${m.orientativo ? ', orientativo' : ''} · IC${NB}${ciT(m.ci)}: ${m.ci[0] > 50 ? 'queda sobre el' : m.ci[1] < 50 ? 'queda bajo el' : 'incluye el'} 50${NB}%.`,
    }
  }
  function mazoHero(mz) {
    const r = mz.rinde
    const v = mazoVeredicto(r.mias)
    const cell = (k, o, extra) =>
      `<div class="src"><p class="src__k">${srcName[k]}</p>${o ? `<b class="pct pct--l" data-cu="${o.pct}">${pct(o.pct)}</b>${nT(o)}<span class="vh"> ${extra}</span>` : nil}</div>`
    const estado = [mz.armado ? 'armado' : 'sin armar', mz.valido ? 'válido' : 'no valida', mz.completo ? 'completo' : 'incompleto', `revisión ${mz.revision}`]
    const marca = [r.mias, r.torneo, r.simulacion].some((o) => o && o.orientativo)
    return `<section class="verdict hero" data-e="${mz.energias[0]}" aria-label="Resumen del mazo">
      ${spine(mz.energias)}${wm(mz.energias[0])}${shine}
      <div class="hero__name"><h1>${dn(mz.id, mz.nombre)}</h1>${tks(mz.energias, 'tk--l')}</div>
      <p class="hero__st">${estado.join(' · ')}</p>
      <div><p class="verdict__a verdict__a--s">${v.a}</p><p class="verdict__why">${v.why}</p></div>
      <div class="srcs">${cell('mias', r.mias, `${r.mias.record.v}-${r.mias.record.d}-${r.mias.record.e}<span class="vh"> victorias, derrotas y empates</span>`)}${cell('torneo', r.torneo, esc(r.torneo.etiqueta.toLowerCase()))}${cell('simulacion', r.simulacion, `bot ${esc(r.simulacion.bot)}`)}</div>
      ${marca ? legendO() : ''}
      <p class="hero__notes">${esc(mz.notas[0])} <button class="link link--in" data-act="tab" data-href="#/mazo/${mz.id}/notas" aria-label="Ver las ${mz.notas.length} notas y las ${mz.revisiones.length} revisiones">ver las ${mz.notas.length} notas</button></p>
    </section>`
  }
  function mazoMini(mz) {
    const a = deckArts(mz.id)
    return `<section class="verdict mini" data-e="${mz.energias[0]}" aria-label="Mazo">${spine(mz.energias)}<div class="rowf" style="gap:10px">${arts(a, 1)}<h1 class="grow mini__n">${dn(mz.id, mz.nombre)}</h1>${tks(mz.energias)}</div></section>`
  }
  function cartaFila(c, e) {
    const sub = [c.clase, `<span class="mono">${esc(c.id)}</span>`].join(' · ')
    const pts = c.puntos ? `<span class="cl__p" role="img" aria-label="Da ${c.puntos} ${plural(c.puntos, 'punto', 'puntos')}">${'<i></i>'.repeat(c.puntos)}<span>${c.puntos}${NB}${plural(c.puntos, 'pt', 'pts')}</span></span>` : ''
    return `<li><button class="cl" data-act="carta" data-id="${esc(c.id)}">${thumb(c.imagen, c.nombre, c.tipo || e) || '<span></span>'}<span class="cl__q">${c.cant}<small>×</small></span><span><span class="cl__n" style="display:block">${esc(c.nombre)}</span><span class="cl__d" style="display:block">${sub}</span></span>${pts || '<span></span>'}</button></li>`
  }
  /* «Tu lista: falta N · Versión de torneo: faltan N», con el enlace al sobre solo si falta algo. */
  function faltaBloque(tu, tor, extra) {
    const ok = (n) => (n === 0 ? ic('check') : ic('alert'))
    const col = (titulo, o) =>
      `<div><p class="label">${titulo}</p><p class="falta__v${o.n ? ' is-falta' : ''}">${ok(o.n)}${o.n === 1 ? 'Falta' : 'Faltan'} ${o.n}</p><p class="sub">${o.sub}</p></div>`
    const falta = tu.n > 0 || (tor && tor.n > 0)
    return `<section class="card falta${tor ? '' : ' falta--1'}" aria-label="Lo que falta conseguir">
        ${col('Tu lista', tu)}${tor ? col('Versión de torneo', tor) : ''}
        ${falta ? `<a class="falta__f" href="#/cartas"><span>${extra || 'Qué sobre abrir para conseguirlas'}</span><span class="rowf" style="gap:2px;color:var(--tx);font-weight:600">Ver sobres${ic('chevR', 'ic--s')}</span></a>` : ''}
      </section>`
  }
  function mazoLista(mz) {
    const f = mz.falta
    const sum = (l) => l.reduce((s, c) => s + c.cant, 0)
    const total = sum(mz.cartas.pokemon) + sum(mz.cartas.entrenadores)
    const ver = S.minis
      ? `<span class="seg seg--mini" role="group" aria-label="Ver las cartas como"><button class="seg__o" data-act="grilla" data-v="0" data-fid="gr-0" aria-pressed="${!S.grilla}" aria-label="Lista">${ic('list', 'ic--s')}</button><button class="seg__o" data-act="grilla" data-v="1" data-fid="gr-1" aria-pressed="${S.grilla}" aria-label="Grilla">${ic('grid', 'ic--s')}</button></span>`
      : ''
    const grupo = (titulo, list, extra) =>
      `<div class="card"><p class="grp${extra ? ' grp--ctl' : ''}"><span>${titulo}<b class="cnt">${sum(list)}</b></span>${extra || ''}</p>${
        S.grilla && S.minis
          ? `<ul class="cgrid">${list
              .map((c) => `<li><button class="cgrid__c" data-act="carta" data-id="${esc(c.id)}" aria-label="${c.cant} ${esc(c.nombre)}, ${esc(c.id)}">${thumb(c.imagen, c.nombre, c.tipo, 'thumb--l')}<span class="cgrid__q">×${c.cant}</span></button></li>`)
              .join('')}</ul>`
          : `<ul class="rows">${list.map((c) => cartaFila(c)).join('')}</ul>`
      }</div>`
    return `${faltaBloque(
      { n: f.tuLista.n, sub: f.tuLista.n ? esc(f.tuLista.cartas.join(', ')) : `Tenés las ${total}.` },
      { n: f.torneo.n, sub: f.torneo.n ? esc(f.torneo.cartas.join(', ')) : 'La podés armar.' },
    )}
      ${grupo('Pokémon', mz.cartas.pokemon, ver)}${grupo('Entrenadores', mz.cartas.entrenadores)}
      <p class="note">${total} cartas. Los puntos son los que da cada Pokémon al quedar fuera de combate.</p>`
  }
function fuente(k, titulo, o, cuerpo, nota) {
    return `<div class="source">
      <p class="source__h">${ic(srcIcon[k])}${titulo}${o && o.orientativo ? '<span class="badge badge--warn">orientativo</span>' : ''}</p>
      ${cuerpo}
      ${nota ? `<details class="fine"><summary>${ic('info')}Sobre esta fuente${ic('chevD', 'chev')}</summary><p>${esc(nota)}</p></details>` : ''}
    </div>`
  }
  const medida = (o, big = 'pct--xl') =>
    `<div class="source__m"><b class="pct ${big}" data-cu="${o.pct}">${pct(o.pct)}</b><span class="n">n${NB}=${NB}${int(o.n)}${PM}${recT(o.record)}<br>IC${NB}95${NB}%: ${ciT(o.ci)}</span></div>${ibar(o)}`
  function rivalFila(r, i) {
    const cel = (o) => (o ? `<span class="tr__num"><b class="pct pct--m">${pct(o.pct)}</b>${nT(o)}</span>` : `<span class="tr__num">${nil}</span>`)
    const ev = (k, o) =>
      o
        ? `<div class="ev"><p class="ev__h"><span>${ic(srcIcon[k])}${k === 'mias' ? 'Vos' : 'Torneo'} · ${recT(o.record)}</span><span>IC${NB}95${NB}%: ${ciT(o.ci)}</span></p>${ibar(o)}</div>`
        : ''
    return `<li><button class="tr cols-rival" data-act="toggle" data-t="rv-${i}" aria-expanded="false" aria-controls="rv-${i}">
        <span><span class="tr__name" style="display:block">${esc(r.rival)}</span><span class="tr__sub" style="display:block">cuota ${pct(r.cuota)}</span></span>${cel(r.mias)}${cel(r.torneo)}
      </button>
      <div class="trmore" id="rv-${i}" hidden>${ev('mias', r.mias)}${ev('torneo', r.torneo)}${axis()}<p class="note">${r.mias && r.mias.orientativo ? 'Vos: orientativo. ' : ''}${r.torneo && r.torneo.orientativo ? 'Torneo: orientativo.' : ''}</p></div></li>`
  }
  function mazoRinde(mz) {
    const r = mz.rinde
    const t = r.torneo
    const sub = t.filas
      .map(
        (f) => `<div class="subrow"><span><b style="font-weight:600">${esc(f.etiqueta)}</b><br><span class="n" style="white-space:normal">${recT(f.record)} · ${f.listas} listas · IC${NB}${ciT(f.ci)}</span></span><span class="tr__num"><b class="pct pct--l">${pct(f.pct)}</b>${nT(f)}</span>${ibar(f)}</div>`,
      )
      .join('')
    const semanas = r.curva
    const chart = lineChart({
      label: 'Porcentaje de victorias por semana: ' + semanas.map((s) => `${dm(s.semana)}: ${pct(s.pct)} (n ${s.n})`).join('; '),
      xs: semanas.map((s) => ({ label: dm(s.semana), sub: 'n ' + s.n })),
      sub: true,
      h: 188,
      ref50: true,
      series: [
        {
          v: semanas.map((s) => s.pct),
          cls: 'ln ln--e',
          pt: 'pt pt--e',
          r: (i) => 2.6 + Math.min(semanas[i].n, 13) / 6,
          lab: semanas.reduce((o, s, i) => ((o[i] = true), o), {}),
        },
      ],
    })
    const e = r.empezar
    const emp = (titulo, o) =>
      `<div class="cmp__r"><span class="cmp__k">${titulo}<small>${recT(o.record)} · IC${NB}${ciT(o.ci)}</small></span><span class="tr__num"><b class="pct pct--l">${pct(o.pct)}</b>${nT(o)}</span>${ibar(o)}</div>`
    return `<h2 class="h2" style="margin-top:0">Tres fuentes <small>nunca se mezclan</small></h2>
      <div class="card">
        ${fuente('mias', 'Mis partidas', r.mias, medida(r.mias))}
        ${fuente('torneo', 'Torneo · personas', t, sub + `<p class="legend"><span><i class="om"></i>en torneos, orientativo es menos de 30 listas</span></p>`, t.nota)}
        ${fuente('simulacion', `Simulación · bot ${esc(r.simulacion.bot)}`, r.simulacion, medida(r.simulacion) + axis(), r.simulacion.nota)}
      </div>
      <h2 class="h2">Contra cada rival <small>por cuota del meta</small></h2>
      <div class="card">
        <p class="thead cols-rival"><span>Rival</span><span>Vos</span><span>Torneo</span></p>
        <ul class="rows">${r.porRival.map(rivalFila).join('')}</ul>
      </div>
      ${legendO(' · tocá una fila: intervalo y récord')}
      <h2 class="h2">Tus partidas por semana</h2>
      <div class="card card--pad" data-e="${mz.energias[0]}">${chart}<p class="note">Punto más grande, más partidas esa semana. La línea punteada es el 50${NB}%.</p></div>
      <h2 class="h2">¿Importa empezar?</h2>
      <div class="card card--pad stack gap12">
        <p class="qa__a">${esc(e.texto)}</p>
        <div class="cmp">${emp('Empezando', e.primero)}${emp('Yendo segundo', e.segundo)}${axis()}</div>
        ${legendO()}
      </div>`
  }
  function mazoMejorar(mz) {
    const R = D.pruebas.resultado
    const qa = mz.mejorar
      .map((q, i) => {
        let extra = ''
        if (i === 0) extra = diff(mz.falta.torneo.cambios)
        if (q.destino && q.destino.indexOf('/pruebas/resultado/') > 0 && R)
          extra = `<div class="cmp" style="margin:2px 0 4px">
            <div class="cmp__r"><span class="cmp__k">La mejor variante</span><b class="pct pct--m">${pct(R.mejor.pct)} <span class="n">n${NB}${int(R.mejor.n)}</span></b>${ibar(R.mejor)}</div>
            <div class="cmp__r"><span class="cmp__k">Tu lista</span><b class="pct pct--m">${pct(R.base.pct)} <span class="n">n${NB}${int(R.base.n)}</span></b>${ibar(R.base)}</div>${axis()}</div>`
        if (q.curva && q.curva[0].meta != null) {
          const c = q.curva
          extra = `<div data-e="${mz.energias[0]}">${lineChart({
            label: 'Porcentaje de partidas con el atacante listo por turno: ' + c.map((p) => `turno ${p.turno}: ${pct(p.pct)} contra un rival pasivo, ${pct(p.meta)} contra el meta`).join('; '),
            xs: c.map((p) => ({ label: 'T' + p.turno })),
            h: 210,
            series: [
              { v: c.map((p) => p.pct), cls: 'ln ln--e', pt: 'pt pt--e', pref: 'up', dots: (k) => k === 3 || k === 4 || k === 7, lab: { 3: true, 4: true, 7: true } },
              { v: c.map((p) => p.meta), cls: 'ln ln--2', pt: 'pt pt--2', vcls: 'v2', pref: 'down', dots: (k) => k === 3 || k === 4 || k === 7, lab: { 3: true, 4: true, 7: true } },
            ],
          })}</div><p class="legend"><span><i class="sw" style="background:var(--e)" data-e="${mz.energias[0]}"></i>rival pasivo</span><span><i class="sw sw--2"></i>contra el meta de ${esc(D.era)}</span></p>`
        } else if (q.curva) {
          const c = q.curva
          extra = `<div data-e="${mz.energias[0]}">${lineChart({
            label: 'Probabilidad de tener la carta por turno: ' + c.map((p) => `turno ${p.turno}: ${pct(p.pct)}`).join('; '),
            xs: c.map((p) => ({ label: p.turno === 0 ? 'Mano' : 'T' + p.turno })),
            h: 172,
            series: [{ v: c.map((p) => p.pct), cls: 'ln ln--e', pt: 'pt pt--e', area: true, dots: (k) => k === 0 || k === 3 || k === 6, lab: { 0: true, 3: true, 6: true } }],
          })}</div>`
        }
        const accion = q.destino
          ? `<a class="btn btn--sec btn--s" href="${q.destino}">${esc(q.accion)}${ic('chevR', 'ic--s')}</a>`
          : `<button class="btn btn--sec btn--s" ${todo(`«${q.accion}» no está en la maqueta.`)}>${esc(q.accion)}</button>`
        return `<section class="card qa" aria-labelledby="qa-${i}"><p class="label" id="qa-${i}">${esc(q.pregunta)}</p><p class="qa__a">${esc(q.respuesta)}</p>${extra}<p class="qa__d">${esc(q.detalle)}</p>${accion}</section>`
      })
      .join('')
    return `<div class="launch">
        <button class="q" data-act="probar" data-q="meta"><span class="q__t">Probar contra el meta</span><span class="q__a">¿Cómo rinde?</span><span class="q__ic" aria-hidden="true">${ic('meta')}</span></button>
        <button class="q" data-act="probar" data-q="cambio"><span class="q__t">Buscar mejoras</span><span class="q__a">¿Qué le cambio?</span><span class="q__ic" aria-hidden="true">${ic('search')}</span></button>
      </div>${qa}
      <p class="note">${esc(D.pruebas.resultado.nota)}</p>`
  }
  function mazoNotas(mz) {
    const revs = mz.revisiones
      .map(
        (r) => `<li class="rev"><span class="rev__n" aria-hidden="true">${r.n}</span><div><p class="rev__h">Revisión ${r.n} · ${dm(r.fecha)}${r.n === mz.revision ? ' <span class="badge badge--line">actual</span>' : ''}</p><p class="rev__d">${esc(cap(r.origen))}${r.nota ? '. ' + esc(r.nota) : ' · sin nota'}</p>${r.cambios ? `<div style="margin-top:8px">${diff(r.cambios)}</div>` : ''}</div></li>`,
      )
      .join('')
    return `<h2 class="h2" style="margin-top:0">Notas <small>${mz.notas.length}</small></h2>
      <ol class="card rows notes">${mz.notas.map((n, i) => `<li><i aria-hidden="true">${i + 1}</i><span>${esc(n)}</span></li>`).join('')}</ol>
      <button class="btn btn--sec btn--s" style="align-self:flex-start" ${todo('Las notas se editan en el editor del mazo; en la maqueta no está.')}>${ic('edit', 'ic--s')}Editar las notas</button>
      <h2 class="h2">Revisiones y cambios <small>${mz.revisiones.length}</small></h2>
      <ol class="card rows">${revs}</ol>`
  }
  /* Los demás mazos: la maqueta no trae su ficha completa, pero sí lo que hay de ellos en Hoy, Mazos, Sobres y
     Meta. Se muestra eso (tres fuentes, qué falta, partidas de hoy) con las acciones a mano. */
  function vMazoCorto(m) {
    const full = D.mazo
    const dia = D.hoy.mazosDelDia.find((x) => x.id === m.id)
    const ses = D.hoy.mazosSesion.find((x) => x.id === m.id)
    const pm = D.cartas.sobres.porMazo.find((x) => x.id === m.id)
    const arq = D.meta.arquetipos.find((a) => new RegExp('#' + m.id + '$').test(a.tengo || ''))
    const faltan = D.cartas.sobres.faltan.filter((c) => c.mazos.includes('#' + m.id))
    const jugadas = ultimas()
      .map((p, i) => ({ p, i }))
      .filter((x) => x.p.mazoId === m.id)
    const h = recMazoHoy(m.id)
    const mias = m.mias || (dia && dia.mias) || null
    const v = mias
      ? mazoVeredicto(mias)
      : { a: 'Todavía sin partidas tuyas', why: dia ? 'Lo que hay es de torneo y de laboratorio: abajo, cada fuente por separado.' : 'Cuando registres la primera, acá va cómo te rinde.' }
    const estado = [m.completo ? 'completo' : `falta ${m.falta}`, eNames(m.energias), m.ultima ? `última partida: ${cuando(m.ultima)}` : 'sin partidas'].filter(Boolean)
    const fuentes = dia
      ? tresFuentes(dia)
      : `<div class="srcd">${ic('user')}<p class="srcd__h"><b>Mis partidas</b><span>${mias ? `${pct(mias.pct)} · n${NB}${int(mias.n)}` : 'sin datos'}</span></p>${mias ? `${ibar(mias)}<p class="srcd__d">IC${NB}95${NB}%: ${ciT(mias.ci)} · ${recT(mias.record)}${mias.orientativo ? ' · orientativo' : ''}</p>` : ''}</div>
         <p class="note" style="padding:6px 0 10px">Torneo y laboratorio de este mazo no están en la maqueta.</p>`
    const nFaltan = faltan.reduce((s, c) => s + c.falta, 0)
    const cuales = (n) => (n === 0 ? null : n === nFaltan ? esc(faltan.map((c) => `${c.falta} ${c.carta}`).join(', ')) : 'Cuáles: en Sobres.')
    const bloque = pm
      ? faltaBloque({ n: pm.tuLista, sub: cuales(pm.tuLista) || 'La tenés completa.' }, { n: pm.torneo, sub: cuales(pm.torneo) || 'La podés armar.' }, `Completo en ~${pm.dias} días abriendo sobres`)
      : faltaBloque({ n: m.falta, sub: cuales(m.falta) || 'Tenés todas las cartas.' }, null)
    return {
      tab: 'mazos',
      title: `Mazo <span class="mono">#${m.id}</span>`,
      docTitle: `#${m.id} ${m.nombre}`,
      ownH1: true,
      back: '#/mazos',
      e: m.energias[0],
      html: `<section class="verdict hero" data-e="${m.energias[0]}" aria-label="Resumen del mazo">
          ${spine(m.energias)}${wm(m.energias[0])}${shine}
          <div class="hero__name"><h1>${dn(m.id, m.nombre)}</h1>${tks(m.energias, 'tk--l')}</div>
          <p class="hero__st">${estado.map(esc).join(' · ')}</p>
          <div><p class="verdict__a verdict__a--s">${v.a}</p><p class="verdict__why">${v.why}</p></div>
          ${arts(deckArts(m.id), 3, 'arts hero__mini')}
        </section>
        ${bloque}
        <h2 class="h2">Tres fuentes <small>nunca se mezclan</small></h2>
        <div class="card" style="padding:4px 14px">${fuentes}</div>
        ${
          h || jugadas.length
            ? `<h2 class="h2">Hoy con este mazo <small>${h ? recT(h) : ''}</small></h2>
        <div class="card">${ses ? `<p class="rowf between" style="padding:12px 14px"><span class="sub">Últimas ${ses.racha.length}</span><span class="streak" role="img" aria-label="Últimas ${ses.racha.length}: ${ses.racha.join(' ')}">${ses.racha.map((r) => `<i class="res res--s res--${r}" aria-hidden="true">${r}</i>`).join('')}</span></p>` : ''}
          ${jugadas.length ? `<ul class="rows rows--top">${jugadas.map((x) => `<li><button class="match" data-act="jugada" data-i="${x.i}">${res(x.p.resultado)}<span class="match__t">${esc(x.p.rival)}</span><span class="match__w">${esc(x.p.cuando.replace(/^hoy /, ''))}</span><span class="match__d">${x.p.empezo ? (x.p.empezo === 'yo' ? 'empecé yo' : 'empezó el rival') + ' · ' : ''}${esc(x.p.modalidad)}</span></button></li>`).join('')}</ul>` : ''}
        </div>`
            : ''
        }
        ${
          arq
            ? `<h2 class="h2">Su arquetipo en torneos</h2>
        <ul class="card rows"><li><a class="row" href="${D.meta.arquetipo.id === arq.id ? '#/meta/arquetipo' : '#/meta'}">${tks(arq.energias)}<span class="grow"><span class="row__t" style="display:block">${esc(arq.nombre)}</span><span class="row__d" style="display:block">cuota ${pct(arq.cuota)} · rinde ${pct(arq.pct)}, n${NB}${int(arq.n)}</span></span><span class="row__go">${ic('chevR')}</span></a></li></ul>`
            : ''
        }
        <div class="card card--pad stack gap8"><p class="sub">Lista, Rinde, Mejorar y Notas completas: la maqueta las trae solo de <b style="color:var(--tx)">#${full.id} ${esc(full.nombre)}</b>.</p><a class="btn btn--sec btn--s" href="#/mazo/${full.id}" style="align-self:flex-start">Ver la ficha completa de <span class="mono">#${full.id}</span></a></div>`,
      dock: dock(`${dockPartida(m.id, false)}<button class="btn btn--sec" data-act="probar" data-fid="dock-probar">Probar</button>`),
    }
  }
  function vMazo(id, vista) {
    const mz = D.mazo
    if (+id !== mz.id) {
      const m = deckById(id)
      return m ? vMazoCorto(m) : vMazos()
    }
    const v = VISTAS.some((x) => x[0] === vista) ? vista : 'lista'
    const panel = { lista: mazoLista, rinde: mazoRinde, mejorar: mazoMejorar, notas: mazoNotas }[v](mz)
    return {
      tab: 'mazos',
      title: `Mazo <span class="mono">#${mz.id}</span>`,
      docTitle: `#${mz.id} ${mz.nombre}`,
      ownH1: true,
      back: '#/mazos',
      e: mz.energias[0],
      tabs: VISTAS.map((x) => ({ id: x[0], label: x[1], href: `#/mazo/${mz.id}${x[0] === 'lista' ? '' : '/' + x[0]}`, sel: x[0] === v })),
      tabsMovable: true,
      hero: v === 'lista' ? mazoHero(mz) : mazoMini(mz),
      panel,
      dock: dock(`${dockPartida(mz.id, false)}<button class="btn btn--sec" data-act="probar" data-fid="dock-probar">Probar</button>`),
    }
  }

/* ───────────── Cartas: Sobres y Colección ───────────── */
  const cartasTabs = (sel) => [
    { id: 'sobres', label: 'Sobres', href: '#/cartas', sel: sel === 'sobres' },
    { id: 'coleccion', label: 'Colección', href: '#/cartas/coleccion', sel: sel === 'coleccion' },
  ]
  const fechaCorta = (iso) => dm(iso)
  function numerosSobre(nu, top) {
    return `<dl class="kv">
      <div><dt>Al menos una carta buscada, por sobre</dt><dd>${pct(nu.alMenosUna)}</dd></div>
      <div><dt>Cartas buscadas esperadas por sobre</dt><dd>${num(nu.buscadas, 2, true)}</dd></div>
      <div><dt>Puntaje${top ? ' (el que ordena)' : ''}</dt><dd>${num(nu.puntaje, 2, true)}</dd></div>
      <div><dt>Sobres para llegar al 50${NB}% y al 90${NB}%</dt><dd>${nu.sobres50} <small>y</small> ${nu.sobres90}</dd></div>
    </dl>`
  }
  function vSobres() {
    const s = D.cartas.sobres
    const v = s.veredicto
    const f = sobreTinte()
    const e = f ? f.tipo : 'none'
    const max = v.numeros.puntaje
    const alts = s.alternativas
      .map(
        (a, i) => `<li><button class="alt" data-act="toggle" data-t="alt-${i}" aria-expanded="false" aria-controls="alt-${i}">
          <span class="alt__k" aria-hidden="true">${i + 2}</span>
          <span class="alt__n">${esc(a.nombre)} <small>· <span class="mono">${esc(a.expansionId)}</span></small></span>
          <span class="alt__s"><b class="pct pct--m">${num(a.numeros.puntaje, 2, true)}</b><span class="bar" style="width:64px"><i style="width:${(a.numeros.puntaje / max) * 100}%"></i></span></span>
          <span class="alt__m">${esc(a.motivo)}</span>
        </button><div class="more" id="alt-${i}" hidden><p class="sub" style="margin-bottom:8px">${esc(a.expansion)}</p>${numerosSobre(a.numeros)}</div></li>`,
      )
      .join('')
    /* el consejo va escrito, sin forma de botón: lo que se toca es la fila entera (abre la carta) */
    const consejo = (c) => (c.consejo === 'comprar' ? `<b class="miss__c miss__c--win">comprarla: ${int(c.puntos)}${NB}pts</b>` : `<b class="miss__c">abrir sobres</b> (comprarla sale ${int(c.puntos)}${NB}pts)`)
    const faltan = s.faltan
      .map(
        (c) => `<li><button class="miss" data-act="carta" data-id="f:${esc(c.carta)}">${thumb(c.imagen, c.carta, c.tipo) || '<span></span>'}<span><span class="miss__n" style="display:block">${esc(c.carta)} <span class="mono" style="color:var(--tx3);font-weight:500">${c.mazos.join(' ')}</span></span><span class="miss__d" style="display:block">${esc(c.sobre)} · ${consejo(c)}</span></span><span class="miss__q"><b class="pct pct--m">falta ${c.falta}</b><span class="row__go">${ic('chevR')}</span></span></button></li>`,
      )
      .join('')
    const maxDias = Math.max.apply(null, s.porMazo.map((m) => m.dias))
    const porMazo = s.porMazo
      .map((m) => {
        const d = deckById(m.id)
        return `<li><a class="pm" href="#/mazo/${m.id}" data-e="${d ? d.energias[0] : 'none'}"><span><span style="display:block">${dn(m.id, m.nombre)}</span><span class="pm__d" style="display:block">Tu lista: falta${m.tuLista === 1 ? '' : 'n'} ${m.tuLista} · Versión de torneo: falta${m.torneo === 1 ? '' : 'n'} ${m.torneo}</span></span><span class="pm__days">~${m.dias}<small>días</small></span><span class="row__go">${ic('chevR')}</span><span class="bar bar--e"><i style="width:${(m.dias / maxDias) * 100}%"></i></span></a></li>`
      })
      .join('')
    return {
      tab: 'cartas',
      title: 'Cartas',
      tabs: cartasTabs('sobres'),
      html: `<section class="verdict" data-e="${e}" aria-labelledby="sv-q sv-a">
          ${spine([e])}${wm(f && f.tipo)}${shine}
          <div class="pack">
            <div class="stack gap6"><p class="verdict__q" id="sv-q">¿Qué sobre abro?</p><h2 class="verdict__a" id="sv-a">Abrí ${esc(v.nombre)}</h2><p class="sub">${esc(v.expansion)} · <span class="mono">${esc(v.expansionId)}</span>${v.limitadoHasta ? ` · hasta el ${fechaCorta(v.limitadoHasta)}` : ''}</p></div>
            ${f && S.minis ? `<span class="pack__cards">${thumb(f.imagen, f.carta, f.tipo)}${f.falta > 1 ? thumb(f.imagen, f.carta, f.tipo) : ''}</span>` : ''}
          </div>
          <ul class="vlist">${v.porque.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
          <div class="rowf between" style="gap:12px;align-items:flex-end">
            <p><b class="pct pct--xl" data-cu="${v.numeros.alMenosUna}">${pct(v.numeros.alMenosUna)}</b><br><span class="n" style="white-space:normal">de al menos una buscada por sobre</span></p>
            <button class="btn btn--sec btn--s" data-act="sobre" data-fid="sobre-num" style="white-space:nowrap;flex:none">Ver los números</button>
          </div>
        </section>
        <div class="card"><div class="goal"><p class="goal__t"><b>Objetivos:</b> ${esc(s.objetivos)}</p><button class="goal__e" ${todo('Los objetivos se editan en una hoja (mazos, colección, misiones); en la maqueta no está.')} aria-label="Editar los objetivos">${ic('edit', 'ic--s')}Editar</button></div></div>
        <h2 class="h2">Si no, estos <small>por puntaje</small></h2>
        <ul class="card rows">${alts}</ul>
        <h2 class="h2">Con plazo</h2>
        <ul class="card rows">
          <li><button class="due" data-act="plazo" data-k="promo"><span class="row__ic row__ic--warn">${ic('promo')}</span><span class="due__h"><span>Sobres de promoción</span><span class="row__go">${ic('chevR')}</span></span><span class="plazo">${ic('clock', 'ic--xs')}quedan ${esc(s.promo.quedan)} · hasta el ${fechaCorta(s.promo.vence)}</span><span class="due__t">${esc(s.promo.texto)}</span></button></li>
          <li><button class="due" data-act="plazo" data-k="cupon"><span class="row__ic row__ic--warn">${ic('star')}</span><span class="due__h"><span>Cupón ★★</span><span class="row__go">${ic('chevR')}</span></span><span class="plazo">${ic('clock', 'ic--xs')}vence el ${fechaCorta(s.cupon.vence)}</span><span class="due__t">${esc(s.cupon.texto)}</span></button></li>
        </ul>
        <h2 class="h2">Cartas que faltan <small>${s.faltan.length} de ${s.faltanTotal}</small></h2>
        <ul class="card rows">${faltan}</ul>
        <p class="note">La maqueta trae ${s.faltan.length} de las ${s.faltanTotal}. Tocá una: para qué mazo es y de dónde sale.</p>
        <h2 class="h2">Por mazo <small>días hasta completarlo</small></h2>
        <ul class="card rows">${porMazo}</ul>`,
      dock: dock(`<button class="btn btn--pri btn--grow" ${todo('«Sincronizar» trae la colección del juego y muestra qué entró; en la maqueta no está conectado.')}>${ic('sync')}Sincronizar colección</button>`),
    }
  }
  function coleccionLista() {
    const c = D.cartas.coleccion
    const f = S.coleccion
    const q = f.q.trim().toLowerCase()
    const list = c.muestra.filter((x) => {
      if (q && !(x.nombre.toLowerCase().includes(q) || x.id.toLowerCase().includes(q))) return false
      if (f.filtro === 'tengo') return x.copias > 0
      if (f.filtro === 'falta') return x.copias === 0
      return true
    })
    if (!list.length) return `<p class="find__empty">Nada en la muestra con ese filtro.</p>`
    return `<ul class="card rows">${list
      .map(
        (x) => `<li><button class="cr" data-act="carta" data-id="${esc(x.id)}">${thumb(x.imagen, x.nombre, x.tipo, 'thumb--m') || '<span></span>'}<span><span class="cl__n" style="display:block">${esc(x.nombre)}</span><span class="cl__d" style="display:block"><span class="mono">${esc(x.id)}</span> · ${x.ediciones} ${plural(x.ediciones, 'edición', 'ediciones')}${x.tipo ? ' · ' + esc(E[x.tipo].nombre) : ''}</span></span><span class="cr__have${x.copias === 0 ? ' is-0' : ''}">${x.copias === 0 ? '0' : '×' + x.copias}<small>${x.copias === 0 ? 'no la tenés' : plural(x.copias, 'copia', 'copias')}</small></span></button></li>`,
      )
      .join('')}</ul>`
  }
  function vColeccion() {
    const c = D.cartas.coleccion
    const total = c.cartasConUna + c.faltantes
    const f = S.coleccion
    const seg = [
      ['todas', 'Todas'],
      ['tengo', 'Tengo'],
      ['falta', 'Me falta'],
    ]
      .map((o) => `<button class="seg__o" data-act="col-filtro" data-v="${o[0]}" data-fid="colf-${o[0]}" aria-pressed="${f.filtro === o[0]}">${o[1]}</button>`)
      .join('')
    return {
      tab: 'cartas',
      title: 'Cartas',
      tabs: cartasTabs('coleccion'),
      html: `<section class="verdict" data-e="none" aria-labelledby="cv-q cv-a">${spine()}
          <p class="verdict__q" id="cv-q">¿Qué tengo?</p>
          <h2 class="verdict__a" id="cv-a">Tenés ${int(c.cartasConUna)} de ${int(total)} cartas; te faltan ${int(c.faltantes)}</h2>
          <div class="stack gap6">
            <div class="share share--col" role="img" aria-label="${int(c.cartasConDos)} con dos copias o más, ${int(c.cartasConUna - c.cartasConDos)} con una sola y ${int(c.faltantes)} que faltan"><i class="a" style="width:${(c.cartasConDos / total) * 100}%"></i><i class="b" style="width:${((c.cartasConUna - c.cartasConDos) / total) * 100}%"></i><i class="rest"></i></div>
            <p class="sharek"><span><i class="a"></i><b>${int(c.cartasConDos)}</b> con 2 o más · ${pct((c.cartasConDos / total) * 100)}</span><span><i class="b"></i><b>${int(c.cartasConUna - c.cartasConDos)}</b> con 1</span><span><i class="r"></i><b>${int(c.faltantes)}</b> faltan</span><span>· ${int(c.copias)} copias</span></p>
          </div>
          <div class="colsync">
            <p class="rowf" style="align-items:flex-start;gap:10px">${ic('sync', 'ic--s')}<span class="grow"><b style="font-weight:600;color:var(--tx)">Última sincronización: ${esc(c.ultimaSyncTexto)}</b><br>${esc(c.fuente)} · entraron ${c.ultimaSyncCambios.copias} copias y ${c.ultimaSyncCambios.nuevas} carta${c.ultimaSyncCambios.nuevas === 1 ? '' : 's'} nueva${c.ultimaSyncCambios.nuevas === 1 ? '' : 's'}</span></p>
            <div class="rowf"><button class="btn btn--sec btn--s btn--grow" ${todo('«Tracker al día» arma el archivo para importar en el tracker; en la maqueta no está.')}>Tracker al día</button><button class="btn btn--ghost btn--s btn--grow" data-act="mas" data-fid="col-mas">Más acciones${ic('chevD', 'ic--s')}</button></div>
          </div>
        </section>
        <div class="tools">
          <div class="tools__r" style="flex-wrap:nowrap"><label class="field grow">${ic('search')}<input class="input" id="col-q" type="search" placeholder="Nombre o código" aria-label="Buscar en la colección" autocomplete="off" enterkeyhint="search" value="${esc(f.q)}"></label><button class="chip" style="min-height:48px;border-radius:13px" ${todo('El selector de expansión no está en la maqueta: la muestra es de ' + c.expansionMuestra + '.')} aria-label="Expansión: ${esc(c.expansionMuestra)}"><span class="mono">${esc((/\(([^)]+)\)/.exec(c.expansionMuestra) || [0, c.expansionMuestra])[1])}</span>${ic('chevD', 'ic--xs')}</button></div>
          <div class="seg" role="group" aria-label="Filtrar">${seg}</div>
        </div>
        <div class="rowf between" style="padding:0 4px;margin-bottom:-6px"><p class="label">${esc(c.expansionMuestra)}</p><p class="label">copias</p></div>
        <div id="col-list">${coleccionLista()}</div>
        <p class="note">Muestra de ${esc(c.expansionMuestra)}: ${c.muestra.length} cartas, una fila por carta con sus copias y sus ediciones. Tocá una para ver su ficha.</p>`,
      dock: dock(`<button class="btn btn--pri btn--grow" ${todo('«Sincronizar» trae la colección del juego y muestra qué entró; en la maqueta no está conectado.')}>${ic('sync')}Sincronizar</button>`),
    }
  }

  /* ───────────── Pruebas ───────────── */
  const pregIcon = { meta: 'meta', cambio: 'search', versus: 'versus', turno: 'turn' }
  const estadoJob = {
    terminada: ['check', 'job__s--ok'],
    corriendo: ['sync', 'job__s--run'],
    'en cola': ['clock', ''],
    cancelada: ['x', ''],
    falló: ['alert', 'job__s--bad'],
  }
  function jobFila(j) {
    const P = D.pruebas
    const st = estadoJob[j.estado] || ['info', '']
    const preg = P.preguntas.find((p) => p.id === j.pregunta)
    const prog = j.progreso && j.estado !== 'terminada' ? `<span class="bar${j.estado === 'corriendo' ? ' bar--tx' : ''}"><i style="width:${Math.max(j.progreso.pct, 1)}%"></i></span><span class="job__r">${j.estado === 'corriendo' ? `<b>${pct(j.progreso.pct)}</b> · ` : ''}${int(j.progreso.hechas)} de ${int(j.progreso.total)} partidas</span>` : ''
    const esR = P.resultado && P.resultado.id === j.id
    const inner = `<span class="job__s ${st[1]}">${ic(st[0], j.estado === 'corriendo' ? 'spin' : '')}</span>
      <span><span class="job__k" style="display:block"><span class="mono">#${j.id}</span> · ${esc(preg ? preg.titulo : j.tipo)} · ${esc(j.estado)}</span><span class="job__n" style="display:block">${esc(j.nombre)}</span></span>
      <span class="job__w">${esc(j.cuando.replace('hoy ', ''))}<span class="row__go">${ic('chevR')}</span></span>
      ${j.resultado ? `<span class="job__r">${esc(lector(j.resultado))}</span>` : ''}${prog}${!j.resultado && !prog ? '<span class="job__r">sin datos</span>' : ''}`
    /* Todas las filas se tocan: #14 abre su resultado completo; las demás, una hoja con lo que dio y qué hacer. */
    return esR
      ? `<li><a class="job" href="#/pruebas/resultado/${j.id}">${inner}<span class="job__r rowf" style="color:var(--tx);font-weight:600;gap:4px">Ver el resultado completo</span></a></li>`
      : `<li><button class="job" data-act="trabajo" data-id="${j.id}">${inner}</button></li>`
  }
  function jobsLista() {
    const list = D.pruebas.trabajos.filter((j) => j.estado !== 'corriendo' && j.estado !== 'en cola' && (S.jobs === 'todas' || j.pregunta === S.jobs))
    return list.length ? `<ul class="card rows">${list.map(jobFila).join('')}</ul>` : `<p class="find__empty">Sin trabajos para esa pregunta.</p>`
  }
  function vPruebas() {
    const P = D.pruebas
    const R = P.resultado
    const deck = deckById(R.mazoId)
    const ult = (id) => P.trabajos.find((j) => j.pregunta === id && j.resultado) || P.trabajos.find((j) => j.pregunta === id)
    const qs = P.preguntas
      .map((p) => {
        const j = ult(p.id)
        return `<button class="q" data-act="probar" data-q="${p.id}"><span class="q__t">${esc(p.titulo)}</span><span class="q__a">${j ? `<b class="mono">#${j.id}</b> · ${esc(j.estado)}` : 'sin pruebas'}</span><span class="q__ic" aria-hidden="true">${ic(pregIcon[p.id])}</span></button>`
      })
      .join('')
    const enCurso = P.trabajos.filter((j) => j.estado === 'corriendo' || j.estado === 'en cola')
    const m = P.motor
    const filtros = [['todas', 'Todas']]
      .concat(P.preguntas.map((p) => [p.id, { meta: 'Meta', cambio: 'Cambios', versus: 'Versus', turno: 'Turno' }[p.id]]))
      .map((o) => `<button class="seg__o" data-act="job-filtro" data-v="${o[0]}" data-fid="jf-${o[0]}" aria-pressed="${S.jobs === o[0]}">${o[1]}</button>`)
      .join('')
    const acceso = (icono, t, d) =>
      `<li><button class="row" ${todo(`«${t}» va en el apartado Motor; la maqueta trae solo este resumen.`)}><span class="row__ic">${ic(icono)}</span><span class="grow"><span class="row__t" style="display:block">${t}</span><span class="row__d" style="display:block">${d}</span></span><span class="row__go">${ic('chevR')}</span></button></li>`
    return {
      tab: 'pruebas',
      title: 'Pruebas',
      html: `<a class="verdict" data-e="${deck.energias[0]}" href="#/pruebas/resultado/${R.id}" aria-labelledby="pv-q pv-a">
          ${spine(deck.energias)}${wm(deck.energias[0])}${shine}
          <span class="verdict__q" id="pv-q">Terminó · ¿Qué le cambio?</span>
          <span class="rowf" style="gap:10px">${arts(deckArts(deck.id), 1)}<span>${dn(deck.id, deck.nombre)}</span></span>
          <span class="verdict__a verdict__a--s" id="pv-a">${esc(R.veredicto)}</span>
          <span class="rowf between sub"><span>${pct(R.base.pct)} → <b style="color:var(--tx)">${pct(R.mejor.pct)}</b> contra el meta (${esc(R.bot)})</span><span class="row__go">${ic('chevR')}</span></span>
        </a>
        <h2 class="h2">¿Qué querés saber? <small>y su última prueba</small></h2>
        <div class="qgrid">${qs}</div>
        <h2 class="h2">En curso <small>${enCurso.length}</small></h2>
        <ul class="card rows">${enCurso.map(jobFila).join('')}</ul>
        <h2 class="h2">Trabajos anteriores <small>qué dio cada uno</small></h2>
        <div class="seg" role="group" aria-label="Filtrar por pregunta">${filtros}</div>
        <div id="job-list">${jobsLista()}</div>
        <h2 class="h2">Practicar</h2>
        <ul class="card rows">
          <li><button class="row" ${todo('La partida contra el bot (la mesa) no está en la maqueta.')}><span class="row__ic">${ic('turno')}</span><span class="grow"><span class="row__t" style="display:block">Jugar contra el bot</span><span class="row__d" style="display:block">${esc(P.practicar.enCurso)}</span></span><span class="row__go">${ic('chevR')}</span></button></li>
          <li><button class="row" ${todo('«Situaciones para resolver» no está en la maqueta.')}><span class="row__ic">${ic('situaciones')}</span><span class="grow"><span class="row__t" style="display:block">Situaciones</span><span class="row__d" style="display:block">${P.practicar.situaciones} para resolver</span></span><span class="row__go">${ic('chevR')}</span></button></li>
          <li><button class="row" ${todo('«Ejercicios de cálculo» no está en la maqueta.')}><span class="row__ic">${ic('edit')}</span><span class="grow"><span class="row__t" style="display:block">Ejercicios</span><span class="row__d" style="display:block">${P.practicar.ejerciciosHoy} hechos hoy</span></span><span class="row__go">${ic('chevR')}</span></button></li>
        </ul>
        <h2 class="h2" id="motor">Motor <small>lo que hace andar las pruebas</small></h2>
        <div class="card">
          <p class="motor"><span class="live" aria-hidden="true"></span><span><b style="font-weight:600;display:block;line-height:20px">${esc(m.worker)}, ${esc(m.estado)}</b><span class="row__d" style="display:block">ahora juega el trabajo <span class="mono">#${m.trabajoActual}</span> · motor <span class="mono">${esc(m.motor)}</span></span></span></p>
          <ul class="rows rows--top">
            ${acceso('simulacion', 'Workers', `${esc(m.worker)} · ${m.nucleos} núcleos · versión ${esc(m.version)}`)}
            ${acceso('list', 'Cola', `${m.colaTrabajos} trabajos · ${m.cola} tandas esperan`)}
            ${acceso('sliders', 'Calibración', 'Los bots comparados con los torneos')}
            ${acceso('up', 'Análisis', 'Tiempos y rendimiento de las simulaciones')}
          </ul>
        </div>
        <p class="note">${esc(R.nota)}</p>`,
      dock: dock(`<button class="btn btn--pri btn--grow" data-act="probar" data-fid="dock-probar">${ic('plus')}Nueva prueba</button>`),
    }
  }
const RES_VISTAS = [
    ['resumen', 'Resumen'],
    ['carta', 'Por carta'],
    ['variantes', 'Variantes'],
    ['tecnico', 'Técnico'],
  ]
  function vResultado() {
    const R = D.pruebas.resultado
    const deck = deckById(R.mazoId)
    const e = deck.energias[0]
    const v = S.resVista
    let panel = ''
    if (v === 'resumen') {
      panel = `<div class="card card--pad stack gap12">
          <div class="cmp">
            <div class="cmp__r"><span class="cmp__k">La mejor variante<small>n${NB}=${NB}${int(R.mejor.n)} · IC${NB}${ciT(R.mejor.ci)}</small></span><b class="pct pct--l" data-cu="${R.mejor.pct}">${pct(R.mejor.pct)}</b>${ibar(R.mejor)}</div>
            <div class="cmp__r"><span class="cmp__k">Tu lista de partida<small>n${NB}=${NB}${int(R.base.n)} · IC${NB}${ciT(R.base.ci)}</small></span><b class="pct pct--l" data-cu="${R.base.pct}">${pct(R.base.pct)}</b>${ibar(R.base)}</div>
            ${axis()}
          </div>
          <p class="sub">Contra ${esc(R.contra)}. ${R.mejor.ci[0] > R.base.ci[1] ? 'Los dos intervalos no se pisan.' : 'Los dos intervalos se pisan.'}</p>
        </div>
        <h2 class="h2">Los cambios <small>${R.mejor.cambios.length}</small></h2>
        <div class="card card--pad stack gap10">${diff(R.mejor.cambios)}<p class="sub">Novedad: ${esc(R.mejor.novedad)}.</p></div>
        <div class="card card--pad rowf" style="align-items:flex-start;gap:12px"><span class="row__ic" style="background:color-mix(in srgb,var(--win) 20%,var(--s1));color:var(--win)">${ic('check')}</span><p><b style="font-weight:600">${R.robusto ? 'Robusto' : 'Sensible al bot'}</b><br><span class="sub">${esc(cap(R.robustoTexto))}.</span></p></div>`
    } else if (v === 'carta') {
      const max = Math.max.apply(null, R.porCarta.map((c) => Math.abs(parseFloat((/[+−-][\d,]+/.exec(c.efecto) || ['0'])[0].replace('−', '-').replace(',', '.')))))
      panel = `<div class="card"><p class="thead" style="grid-template-columns:1fr 96px 62px"><span>Carta</span><span>Efecto</span><span>Puntos</span></p><ul class="rows">${R.porCarta
        .map((c) => {
          const m = /^(entra|sale):\s*([+−-][\d,]+) puntos \((.+)\)$/.exec(c.efecto)
          if (!m) return `<li class="eff"><span>${esc(c.carta)}</span><span></span><span>${esc(c.efecto)}</span></li>`
          const val = parseFloat(m[2].replace('−', '-').replace(',', '.'))
          const wd = (Math.abs(val) / max) * 50
          return `<li class="eff"><span><b style="font-weight:600;display:block;line-height:20px">${esc(c.carta)}</b><span class="tr__sub">${m[1] === 'entra' ? 'cuando entra' : 'cuando sale'} · ${esc(m[3])}</span></span><span class="eff__b" aria-hidden="true"><i class="${val >= 0 ? 'pos' : 'neg'}" style="width:${wd}%"></i></span><b class="pct pct--m" style="text-align:right">${esc(m[2])}</b></li>`
        })
        .join('')}</ul></div><p class="note">Puntos de diferencia promedio entre las variantes que tienen el cambio y las que no.</p>`
    } else if (v === 'variantes') {
      panel = `<div class="card"><p class="thead cols-match"><span>Variante</span><span>Cambios</span><span>Contra el meta</span></p><ul class="rows">${R.variantes
        .map(
          (x, i) => `<li><button class="tr cols-match" data-act="toggle" data-t="var-${i}" aria-expanded="false" aria-controls="var-${i}"><span><span class="tr__name mono" style="display:block">${esc(x.nombre)}</span><span class="tr__sub" style="display:block">puesto ${i + 2}</span></span><span class="tr__num"><b class="pct pct--m">${x.cambios.length}</b><span class="n">cambios</span></span><span class="tr__num"><b class="pct pct--m">${pct(x.pct)}</b>${nT(x)}</span></button>
          <div class="trmore" id="var-${i}" hidden>${diff(x.cambios)}<div class="ev"><p class="ev__h"><span>IC${NB}95${NB}%</span><span>${ciT(x.ci)}</span></p>${ibar(x)}${axis()}</div></div></li>`,
        )
        .join('')}</ul></div><p class="note">La mejor (${pct(R.mejor.pct)}) está en Resumen. Tocá una fila: cambios e intervalo.</p>`
    } else {
      panel = `<div class="card card--pad"><dl class="facts"><dt>Bot</dt><dd class="mono">${esc(R.bot)}</dd><dt>Partidas</dt><dd>${int(R.partidas)}</dd><dt>Rondas</dt><dd>${R.rondas} · ${esc(R.fin)}</dd><dt>Contra</dt><dd>${esc(R.contra)}</dd><dt>Trabajo</dt><dd class="mono">#${R.id}</dd></dl></div>
        <p class="note">${esc(R.nota)}</p>`
    }
    return {
      tab: 'pruebas',
      title: `Resultado <span class="mono">#${R.id}</span>`,
      docTitle: `Resultado #${R.id}`,
      back: '#/pruebas',
      e,
      tabs: RES_VISTAS.map((x) => ({ id: x[0], label: x[1], act: 'res-vista', sel: x[0] === v })),
      hero:
        v !== 'resumen'
          ? `<section class="verdict mini" data-e="${e}" aria-label="Resultado" style="gap:4px">${spine(deck.energias)}<p class="mini__n">${dn(deck.id, deck.nombre)}</p><div class="rowf between" style="gap:12px"><span class="sub">${esc(R.titulo)}</span><b class="pct">${sgn(R.diferencia.pts)}${NB}pts</b></div></section>`
          : `<section class="verdict" data-e="${e}" aria-labelledby="rv-q rv-a">
          ${spine(deck.energias)}${wm(e)}${shine}
          <div><p class="verdict__q" id="rv-q">¿Qué le cambio?</p><p class="sub">${esc(R.titulo)}</p></div>
          <a class="rowf" href="#/mazo/${deck.id}" style="gap:10px;min-height:44px">${arts(deckArts(deck.id), 1)}<span>${dn(deck.id, deck.nombre)}</span><span class="row__go">${ic('chevR', 'ic--s')}</span></a>
          <h2 class="verdict__a verdict__a--s" id="rv-a">${esc(R.veredicto)}</h2>
          <div class="source__m"><b class="pct pct--xl">${sgn(R.diferencia.pts)}${NB}pts</b><span class="n" style="white-space:normal">IC ${sgn(R.diferencia.ci[0])} a ${sgn(R.diferencia.ci[1])}<br>bots ${esc(R.bot)}: es una pista</span></div>
        </section>`,
      panel,
      dock: dock(`<button class="btn btn--pri btn--grow" ${todo(`«Actualizar el mazo» crea la revisión ${D.mazo.revision + 1} de #${deck.id} con estos cambios; en la maqueta no guarda.`)}>Actualizar el mazo <span class="mono">#${deck.id}</span></button><button class="btn btn--sec" ${todo('«Guardar como mazo nuevo» y «Buscar variantes desde esta» van acá.')} aria-label="Más acciones del resultado">${ic('dots')}</button>`),
    }
  }

  /* ───────────── Meta ───────────── */
  function metaOrdenados() {
    const by = { cuota: (a, b) => b.cuota - a.cuota, pct: (a, b) => b.pct - a.pct, tendencia: (a, b) => b.tendencia - a.tendencia }
    return D.meta.arquetipos.slice().sort(by[S.metaOrden])
  }
  /* «N ventanas de D días»: sale de meta.ventanasSerie, no se escribe a mano */
  function ventanasT() {
    const v = D.meta.ventanasSerie
    const dias = Math.round((Date.parse(v[0].hasta) - Date.parse(v[0].desde)) / 864e5)
    return { n: v.length, dias, txt: `${v.length} ventanas de ${dias} días` }
  }
  function arqFila(a) {
    const M = D.meta
    const has = M.arquetipo && M.arquetipo.id === a.id
    const dId = (/#(\d+)/.exec(a.tengo || '') || [])[1]
    return `<li data-key="${a.id}"><button class="arq" data-act="toggle" data-t="arq-${a.id}" aria-expanded="false" aria-controls="arq-${a.id}">
        ${tks(a.energias)}
        <span><span class="tr__name" style="display:block">${esc(a.nombre)}</span><span class="arq__sub">${spark(a.serie)}${a.tengo ? `<span class="badge badge--line">${ic('check', 'ic--xs')}<span class="mono">#${dId}</span></span>` : '<span class="n">sin armar</span>'}</span></span>
        <span class="arq__q"><b class="pct pct--m">${pct(a.cuota)}</b><span class="n rowf" style="gap:2px${a.tendenciaClara ? ';color:var(--tx);font-weight:700' : ''}">${ic(a.tendencia >= 0 ? 'up' : 'down', 'ic--xs')}${sgn(a.tendencia)}</span></span>
        <span class="tr__num"><b class="pct pct--m">${pct(a.pct)}</b>${nT(a)}</span>
      </button>
      <div class="trmore" id="arq-${a.id}" hidden>
        <div class="ev"><p class="ev__h"><span>${ic('meta')}Torneo · ${recT(a.record)}</span><span>IC${NB}${ciT(a.ci)}</span></p>${ibar(a, { ref: M.media.pct })}<div class="axis" aria-hidden="true"><span>0</span><span>media ${pct(M.media.pct)}</span><span>100${NB}%</span></div></div>
        <dl class="facts"><dt>En listas</dt><dd>${int(a.enListas)} de ${int(M.listas)}</dd><dt>Cuota</dt><dd>${a.serie.map((v) => num(v)).join(' → ')}${NB}% <span style="color:var(--tx3)">(ventanas de ${ventanasT().dias} días)</span></dd><dt>Tendencia</dt><dd>${sgn(a.tendencia)} puntos en ${M.tendenciaDias} días${a.tendenciaClara ? ' · clara' : ' · puede ser ruido'}</dd><dt>Tengo</dt><dd>${a.tengo ? esc(a.tengo) : 'sin datos'}</dd></dl>
        <div class="rowf">${has ? `<a class="btn btn--sec btn--s btn--grow btn--fit" href="#/meta/arquetipo">Abrir el arquetipo</a>` : `<button class="btn btn--sec btn--s btn--grow btn--fit" ${todo('La maqueta trae la ficha solo de ' + M.arquetipo.nombre + '.')}>Abrir el arquetipo</button>`}${dId ? `<a class="btn btn--ghost btn--s btn--grow btn--fit" href="#/mazo/${dId}">Mi mazo <span class="mono">#${dId}</span></a>` : ''}</div>
      </div></li>`
  }
  function vMeta() {
    const M = D.meta
    const top = M.arquetipos.slice().sort((a, b) => b.cuota - a.cuota)
    const first = top[0]
    const suma = top.reduce((s, a) => s + a.cuota, 0)
    const dentro = first.ci[0] <= M.media.pct && first.ci[1] >= M.media.pct
    const armados = top.filter((a) => /^armado/.test(a.tengo || '')).length
    const seg = [
      ['cuota', 'Cuota'],
      ['pct', 'Rinde'],
      ['tendencia', 'Tendencia'],
    ]
      .map((o) => `<button class="seg__o" data-act="meta-orden" data-v="${o[0]}" data-fid="mo-${o[0]}" aria-pressed="${S.metaOrden === o[0]}">${o[1]}</button>`)
      .join('')
    const h = D.hoy.meta
    const nov = (o, sube) => `<div class="trend"><div><p class="trend__n">${esc(o.nombre)}${o.nuevo ? ' <span class="badge badge--line">nuevo</span>' : ''}</p><p class="row__d">${sube ? 'El que más sube' : 'El que más baja'} · cuota ${pct(o.cuota)}</p></div><div class="trend__r">${spark(o.serie)}<span class="delta rowf" style="gap:3px">${ic(sube ? 'up' : 'down', 'ic--xs')}${sgn(o.delta)}${NB}pts</span></div></div>`
    return {
      tab: 'meta',
      title: 'Meta',
      sub: `${M.era} · ${M.eraNombre} · ${M.formato}`,
      html: `<section class="verdict" data-e="${first.energias[0]}" aria-labelledby="mv-q mv-a">
          ${spine(first.energias)}${wm(first.energias[0])}${shine}
          <p class="verdict__q" id="mv-q">¿Qué se juega?</p>
          <h2 class="verdict__a" id="mv-a">${esc(first.nombre)} es lo más jugado: ${pct(first.cuota)}</h2>
          <p class="verdict__why">Rinde ${pct(first.pct)} (n${NB}=${NB}${int(first.n)}, IC${NB}${ciT(first.ci)}): ${dentro ? 'el intervalo incluye' : 'el intervalo no incluye'} la media de la era, ${pct(M.media.pct)}.</p>
          <div class="share" role="img" aria-label="Cuotas: ${top.map((a) => `${a.nombre} ${pct(a.cuota)}`).join('; ')}; el resto ${pct(100 - suma)}">${top.map((a) => `<i data-e="${a.energias[0]}" style="width:${a.cuota}%"></i>`).join('')}<i class="rest"></i></div>
          <p class="sharek">${top.slice(0, 3).map((a) => `<span><i data-e="${a.energias[0]}"></i>${esc(a.nombre.split(' ex ')[0].replace(/^Mega /, 'M. '))} ${num(a.cuota)}</span>`).join('')}<span><i class="rest"></i>fuera de los ${top.length}: ${num(100 - suma)}</span></p>
          <a class="rowf between sub" href="#/meta/arquetipo" style="min-height:44px;margin-bottom:-10px"><span>Sus matchups, del peor al mejor</span><span class="row__go">${ic('chevR')}</span></a>
        </section>
        <p class="sub" style="padding:0 2px">${M.torneos} torneos · ${int(M.listas)} listas · media de la era ${pct(M.media.pct)} (n${NB}${int(M.media.n)}) · tendencia a ${M.tendenciaDias} días</p>
        <h2 class="h2">Qué se mueve <small>últimos ${h.dias} días</small></h2>
        <div class="card">${nov(h.sube, true)}${nov(h.baja, false)}</div>
        <h2 class="h2">Los ${top.length} más jugados <small>${armados} de ${top.length} armados</small></h2>
        <p class="verdict__why" style="margin-top:-6px">Tenés armado un mazo de ${armados === top.length ? 'cada uno' : armados + ' de ellos'}: el número está al lado del nombre.</p>
        <div class="seg" role="group" aria-label="Ordenar por">${seg}</div>
        <div class="card">
          <p class="thead" style="grid-template-columns:minmax(0,1fr) 64px 74px"><span>Arquetipo</span><span>Cuota</span><span>Rinde</span></p>
          <ul class="rows" id="arq-list">${metaOrdenados().map(arqFila).join('')}</ul>
        </div>
        <p class="legend"><span>Curva: cuota en ${ventanasT().txt}. Flecha: cambio en ${M.tendenciaDias} días, en puntos; en negrita si es claro. Tilde: lo tenés armado.</span></p>
        <h2 class="h2">Eventos</h2>
        <ul class="card rows">${D.hoy.pendientes
          .filter((p) => p.tipo === 'evento')
          .map((p) => `<li><button class="row" data-act="plazo" data-k="evento"><span class="row__ic row__ic--warn">${ic('evento')}</span><span class="grow"><span class="row__t" style="display:block">${esc(p.texto)}</span><span class="row__d" style="display:block">${esc(p.detalle)}</span></span><span class="row__go">${ic('chevR')}</span></button></li>`)
          .join('')}</ul>
        <p class="note">${esc(M.atribucion)}. ${esc(D.aviso)}.</p>`,
      dock: dock(`<button class="btn btn--pri btn--grow" data-act="probar" data-q="meta">${ic('pruebas', 'ic--s')}Probar contra el meta</button>`),
    }
  }
  function muFila(m, i) {
    const d = m.pct - 50
    return `<li><button class="mu" data-act="toggle" data-t="mu-${i}" aria-expanded="false" aria-controls="mu-${i}">
        <span><span class="tr__name" style="display:block">${esc(m.rival)}</span><span class="tr__sub" style="display:block">cuota ${pct(m.cuota)}</span></span>
        <span class="dv" aria-hidden="true"><i class="${d >= 0 ? 'pos' : 'neg'}" style="width:${Math.min(50, Math.abs(d) * 2)}%"></i></span>
        <span class="tr__num"><b class="pct pct--m">${pct(m.pct)}</b>${nT(m)}</span>
      </button>
      <div class="trmore" id="mu-${i}" hidden><div class="ev"><p class="ev__h"><span>${ic('meta')}${recT(m.record)}</span><span>IC${NB}95${NB}%: ${ciT(m.ci)}</span></p>${ibar(m)}${axis()}</div></div></li>`
  }
  function vArquetipo() {
    const A = D.meta.arquetipo
    const M = D.meta
    const e = A.energias[0]
    const dId = (/#(\d+)/.exec(A.tengo || '') || [])[1]
    const yo = A.misPartidas
    const dentro = A.ci[0] <= M.media.pct && A.ci[1] >= M.media.pct
    const nota = A.nota.split('\n')
    const primera = (nota.find((l) => /^- /.test(l)) || nota[0]).replace(/^- /, '')
    const listas = A.listas
      .map(
        (l, i) => `<li><button class="lst" data-act="lista" data-i="${i}"><span><b style="font-weight:600;line-height:20px;display:block">${esc(l.etiqueta)}</b></span><span class="tr__num"><b class="pct pct--m">${pct(l.pct)}</b>${nT(l)}</span><span class="lst__d"><span>jugada ${l.veces} veces · IC${NB}${ciT(l.ci)}</span><span class="lst__f">${ic('alert', 'ic--xs')}${esc(l.tengo)}: ${esc(l.faltaCartas.join(', '))}</span></span><span class="row__go">${ic('chevR')}</span></button></li>`,
      )
      .join('')
    return {
      tab: 'meta',
      title: 'Arquetipo',
      docTitle: A.nombre,
      ownH1: true,
      back: '#/meta',
      e,
      html: `<section class="verdict" data-e="${e}" aria-labelledby="av-a">
          ${spine(A.energias)}${wm(e)}${shine}
          <div class="hero__name">${tks(A.energias, 'tk--l')}<h1 style="font:800 21px/26px var(--font-d);letter-spacing:-.015em" id="av-a">${esc(A.nombre)}</h1></div>
          <p class="hero__tags"><span class="badge">cuota ${pct(A.cuota)}</span><span class="badge">${int(A.enListas)} listas</span>${A.tengo ? `<span class="badge badge--line">${ic('check', 'ic--xs')}${esc(A.tengo)}</span>` : ''}</p>
          <p class="verdict__why"><strong>Rinde ${pct(A.pct)}</strong> en torneos (n${NB}=${NB}${int(A.n)}, ${recT(A.record)}). El intervalo, ${ciT(A.ci)}, ${dentro ? 'incluye' : 'no incluye'} la media de la era (${pct(M.media.pct)}).</p>
          ${ibar(A, { ref: M.media.pct })}<div class="axis" aria-hidden="true"><span>0</span><span>media ${pct(M.media.pct)}</span><span>100${NB}%</span></div>
          <div class="rowf between" style="border-top:1px solid color-mix(in srgb,var(--tx) 10%,transparent);padding-top:10px"><span class="sub">Cuota en ${ventanasT().txt}:<br><b style="color:var(--tx)">${A.serie.map((v) => num(v)).join(' → ')}${NB}%</b>${PM}${sgn(A.tendencia)}${NB}pts</span>${spark(A.serie)}</div>
        </section>
        <h2 class="h2">Vos contra él</h2>
        <div class="card card--pad stack gap8">
          <div class="source__m">${yo ? `<b class="pct pct--xl" data-cu="${yo.pct}">${pct(yo.pct)}</b><span class="n" style="white-space:normal">n${NB}=${NB}${yo.n}${om(yo)} · ${recT(yo.record)}<br>IC${NB}95${NB}%: ${ciT(yo.ci)}</span>` : nil}</div>
          ${yo ? ibar(yo) + axis() : ''}
          ${yo && yo.orientativo ? legendO() : ''}
        </div>
        <h2 class="h2">Mi nota</h2>
        <div class="card card--pad stack gap4">
          <p class="pre" id="arq-nota-corta">${esc(primera)}</p>
          <p class="pre" id="arq-nota" hidden>${esc(A.nota)}</p>
          <button class="link link--last" data-act="toggle" data-t="arq-nota" data-hide="arq-nota-corta" data-l0="ver la nota entera" data-l1="ver menos" aria-expanded="false" aria-controls="arq-nota" style="align-self:flex-start">ver la nota entera</button>
        </div>
        <h2 class="h2">Sus matchups <small>del peor al mejor</small></h2>
        <div class="card">
          <p class="thead cols-mu"><span>Contra</span><span>25 · 50 · 75</span><span>% y n</span></p>
          <ul class="rows">${A.matchups.map(muFila).join('')}</ul>
        </div>
        <p class="legend"><span>Cómo le va a ${esc(A.nombre)} contra cada uno, en torneos. Tocá una fila: intervalo y récord.</span></p>
        <h2 class="h2">Sus listas <small>${A.listas.length} más jugadas</small></h2>
        <ul class="card rows">${listas}</ul>
        <p class="note">${esc(M.atribucion)}.</p>`,
      dock: dock(
        `<button class="btn btn--pri btn--grow" data-act="partida" data-rival="${esc(A.nombre)}">Registrar contra este</button>${dId ? `<a class="btn btn--sec" href="#/mazo/${dId}" aria-label="Mi mazo de este arquetipo, número ${dId}"><span class="mono">#${dId}</span></a>` : ''}`,
      ),
    }
  }

  /* ───────────── Menú ───────────── */
  function vMenu() {
    /* con prefers-reduced-motion manda el sistema: «Ninguno» queda marcado y los otros dos, apagados */
    const fijo = (key) => key === 'movimiento' && mqReduce.matches
    const seg = (key, act, opts) =>
      `<div class="seg" role="group" aria-label="${key === 'tema' ? 'Tema' : key === 'movimiento' ? 'Movimiento' : 'Vistas de la ficha del mazo'}">${opts
        .map((o) => {
          const on = fijo(key) ? o[0] === 'ninguno' : S[key] === o[0]
          return `<button class="seg__o" data-act="${act}" data-v="${o[0]}" data-fid="${act}-${o[0]}" aria-pressed="${on}"${fijo(key) && !on ? ' aria-disabled="true"' : ''}>${o[1]}</button>`
        })
        .join('')}</div>`
    const movTxt = {
      expresivo: 'Las hojas entran con resorte, los números cuentan, las listas llegan de a una y una victoria se festeja.',
      sutil: 'Solo fundidos y deslizamientos cortos.',
      ninguno: 'Nada se mueve: todo aparece en su lugar.',
    }
    const acc = [
      ['sliders', 'Ajustes', 'Partidas, colección, notificaciones'],
      ['shield', 'Copia de seguridad', 'Copias y prueba de restauración'],
      ['book', 'Catálogo', 'Cartas, sets y sincronización con el tracker'],
      ['key', 'Tokens de API', 'Claude, workers y actividad'],
      ['session', 'Sesión', 'Dispositivos y cerrar sesión'],
      ['info', 'Acerca de', 'Versión, licencias y fuentes de datos'],
    ]
      .map(
        (a) => `<li><button class="row" ${todo(`«${a[1]}» no está en la maqueta: conserva lo que tiene hoy.`)}><span class="row__ic">${ic(a[0])}</span><span class="grow"><span class="row__t" style="display:block">${a[1]}</span><span class="row__d" style="display:block">${a[2]}</span></span><span class="row__go">${ic('chevR')}</span></button></li>`,
      )
      .join('')
    return {
      tab: null,
      title: 'Menú',
      back: '#/hoy',
      nodock: true,
      html: `<h2 class="h2" style="margin-top:0">Aspecto</h2>
        <div class="card">
          <div class="set"><p class="set__h">Tema <small>${S.tema === 'sistema' ? 'sigue al sistema: ' + root.dataset.tema : ''}</small></p>${seg('tema', 'tema', [['oscuro', 'Oscuro'], ['claro', 'Claro'], ['sistema', 'Sistema']])}</div>
          <div class="set"><p class="set__h">Movimiento <small>${mqReduce.matches ? 'lo fija el sistema' : ''}</small></p>${seg('movimiento', 'mov', [['expresivo', 'Expresivo'], ['sutil', 'Sutil'], ['ninguno', 'Ninguno']])}<p class="set__d">${mqReduce.matches ? 'Tu sistema pide reducir el movimiento: queda en «Ninguno» mientras lo pida.' : movTxt[S.movimiento]}</p></div>
          <div class="set set--row"><div><p class="set__h" id="minis-l">Miniaturas de cartas</p><p class="set__d">En listas, buscador y fichas. El texto sigue siendo lo principal.</p></div><button class="switch" role="switch" aria-checked="${S.minis}" aria-labelledby="minis-l" data-act="minis" data-fid="minis"></button></div>
        </div>
        <h2 class="h2">Para comparar <small>solo en la maqueta</small></h2>
        <div class="card">
          <div class="set"><p class="set__h">Vistas de la ficha del mazo</p>${seg('vistas', 'vistas', [['arriba', 'Pestañas arriba'], ['abajo', 'Barra abajo']])}<p class="set__d">Lista · Rinde · Mejorar · Notas: pegadas bajo el título (lo natural en esta dirección) o sobre el muelle.</p><a class="btn btn--sec btn--s" href="#/mazo/${D.mazo.id}" style="align-self:flex-start">Ver en el mazo <span class="mono">#${D.mazo.id}</span></a></div>
        </div>
        <h2 class="h2">Sistema</h2>
        <ul class="card rows">${acc}</ul>
        <p class="note">${esc(D.aviso)}. Datos del ${dm(D.generado)}, era ${esc(D.era)}. Las imágenes son enlaces a las del tracker; los íconos de energía son propios.</p>`,
    }
  }

  /* ───────────── Hojas ───────────── */
  /* El borrador de la partida vive en S.partida hasta que se guarda o se descarta a propósito: cerrar la hoja
     (afuera, ×, «atrás») no lo borra, y el muelle pasa a decir «Seguir la partida». */
  const hayBorrador = () => {
    const P = S.partida
    return !P.guardada && !!(P.resultado || P.rival || P.rivalQ.trim() || P.empezo || P.cartas.length || P.notaTxt.trim())
  }
  const dockPartidaInner = (icon) => (hayBorrador() ? `${icon ? ic('edit') : ''}Seguir la partida` : `${icon ? ic('plus') : ''}Registrar partida`)
  const dockPartida = (mazoId, icon = true) =>
    `<button class="btn btn--pri btn--grow" data-act="partida" data-dock="${icon ? 1 : 0}"${mazoId ? ` data-mazo="${mazoId}"` : ''} data-fid="dock-partida">${dockPartidaInner(icon)}</button>`
  function syncDock() {
    $$('#dock [data-dock]').forEach((b) => (b.innerHTML = dockPartidaInner(b.dataset.dock === '1')))
  }
  const copias = (list) => list.reduce((s, c) => s + c.cant, 0)
  function partidaForm() {
    const P = S.partida
    const deck = deckById(P.mazoId) || deckById(D.partida.mazosRecientes[0].id)
    const rec = D.partida.mazosRecientes
    const enRec = rec.some((m) => m.id === P.mazoId)
    const mazos = rec
      .map((m) => {
        const a = deckArts(m.id)
        const h = recMazoHoy(m.id)
        return `<button class="pdeck__o" data-e="${m.energias[0]}" data-act="p-deck" data-id="${m.id}" data-fid="pd-${m.id}" aria-pressed="${m.id === P.mazoId}" aria-label="Mazo ${m.id}: ${esc(m.nombre)}${h ? `; hoy ${h.v} victorias y ${h.d} derrotas` : ''}">${S.minis && a.miniaturas ? `<span class="pdeck__bg">${art(a.miniaturas[0], a.miniaturasDe[0])}</span>` : ''}<span class="pdeck__t"><b>#${m.id}</b>${h ? `<small>hoy ${h.v}–${h.d}</small>` : ''}</span></button>`
      })
      .join('')
    const resultados = ['Victoria', 'Derrota', 'Empate']
      .map((r) => `<button class="pres__o" data-r="${r}" data-act="p-res" data-fid="pr-${r}" aria-pressed="${P.resultado === r}">${res(r)}${r}</button>`)
      .join('')
    const A = D.meta.arquetipo
    let rival
    if (P.rival) {
      const nota = P.rival === A.nombre ? A.nota : ''
      const corta = (nota.split('\n').find((l) => /^- /.test(l)) || '').replace(/^- /, '')
      rival = `<div class="rivalsel"><span>${esc(P.rival)}</span><button class="iconbtn" data-act="p-rival-clear" data-fid="p-rival-clear" aria-label="Cambiar el rival">${ic('close', 'ic--s')}</button></div>
        ${
          nota
            ? `<div class="rnote"><div class="rnote__h"><p class="label">Tu nota contra este rival</p><button class="link" data-act="toggle" data-t="rnote-full" data-hide="rnote-corta" data-l0="ver entera" data-l1="ver menos" data-fid="rnote-ver" aria-expanded="false" aria-controls="rnote-full">ver entera</button></div><p class="rnote__t" id="rnote-corta">${esc(corta)}</p><p class="rnote__f" id="rnote-full" hidden>${esc(nota)}</p></div>`
            : ''
        }`
    } else {
      rival = `<label class="field">${ic('search')}<input class="input" id="p-rival" type="text" placeholder="Buscar o escribir el rival" aria-label="Rival" autocomplete="off" enterkeyhint="done" value="${esc(P.rivalQ)}"></label>
        <div class="rivals" id="p-rivals">${rivalesSug()}</div>`
    }
    const sug = D.partida.sugerenciaPorCartas
    const ejemplo = D.partida.cartasVistasEjemplo
    const todas = ejemplo.every((c) => P.cartas.some((x) => x.nombre === c.nombre))
    const vistas = P.cartas
      .map(
        (c, i) => `<button class="seen__c" data-act="p-card" data-i="${i}" data-fid="pc-${i}" aria-label="${esc(c.nombre)}, ${c.cant} ${plural(c.cant, 'copia', 'copias')}. Tocá para cambiar.">${thumb(c.imagen, c.nombre, c.tipo) || tk(c.tipo)}<span>${esc(c.nombre)}<small>×${c.cant}</small></span></button>`,
      )
      .join('')
    const hint = !P.cartas.length
      ? ''
      : todas
        ? P.rival === sug.rival
          ? `<p class="hintline">${ic('check')}<span>Coincide con el rival: ${esc(sug.texto)}.</span></p>`
          : `<p class="hintline"><span class="grow">Por las cartas: <b>${esc(sug.rival)}</b>, ${esc(sug.texto)}.</span><button class="btn btn--sec btn--s" data-act="p-rival" data-v="${esc(sug.rival)}">Usar</button></p>`
        : `<p class="hintline"><span>Tocá una carta para cambiar las copias.</span></p>`
    const falta = !P.resultado ? 'Falta el resultado' : ''
    const nC = P.cartas.length
    return {
      title: 'Registrar partida',
      body: `<div class="fl">
          <div class="pdeck" role="group" aria-label="Mazo: los recientes">${mazos}<button class="pdeck__o pdeck__o--other" ${todo(`«Otro» abre el selector con los ${D.mazos.length} mazos; en la maqueta no está.`)} aria-pressed="${!enRec}">Otro</button></div>
          <p class="pdeck__sel">${tks(deck.energias)}<span class="grow">${dn(deck.id, deck.nombre)}</span></p>
        </div>
        <div class="pres" role="group" aria-label="Resultado">${resultados}</div>
        <div class="fl"><p class="label">Rival</p>${rival}</div>
        <div class="fl fl--inline"><p class="label" id="p-emp">¿Quién empezó?</p><div class="seg seg--line" role="group" aria-labelledby="p-emp"><button class="seg__o" data-act="p-emp" data-v="yo" data-fid="pe-yo" aria-pressed="${P.empezo === 'yo'}">Yo</button><button class="seg__o" data-act="p-emp" data-v="rival" data-fid="pe-rival" aria-pressed="${P.empezo === 'rival'}">El rival</button></div></div>
        <div class="fl">
          <div class="fl__h"><p class="label">Cartas que vi${nC ? `<b class="cnt">${nC}</b>` : ''}</p><button class="btn btn--ghost btn--s" data-act="p-card-add" data-fid="p-card-add">${ic('plus', 'ic--s')}Agregar</button></div>
          ${vistas ? `<div class="seen">${vistas}</div>` : ''}${hint}
        </div>
        <div class="sec2"><select class="select grow" id="p-mod" aria-label="Modalidad">${D.partida.modalidades.map((m) => `<option${m === P.modalidad ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select><button class="btn btn--ghost btn--s" data-act="p-nota" data-fid="p-nota" aria-expanded="${P.nota}">${ic(P.nota ? 'close' : 'plus', 'ic--s')}${P.nota ? 'Quitar la nota' : 'Nota'}</button></div>
        ${P.nota ? `<input class="input" id="p-nota-in" type="text" placeholder="Nota de la partida (opcional)" aria-label="Nota de la partida" enterkeyhint="done" data-fid="p-nota-in" value="${esc(P.notaTxt)}">` : ''}`,
      foot: `<div class="savebar">${hayBorrador() ? `<button class="btn btn--ghost" data-act="p-descartar" data-fid="p-descartar">Descartar</button>` : ''}<button class="btn btn--pri btn--grow" data-act="p-save" data-fid="p-save"${falta ? ' aria-disabled="true"' : ''}>${falta || 'Guardar partida'}</button></div>`,
    }
  }
  function rivalesSug() {
    const q = S.partida.rivalQ.trim().toLowerCase()
    const list = D.partida.rivalesSugeridos.filter((r) => !q || r.toLowerCase().includes(q)).slice(0, 4)
    const libre = q && !D.partida.rivalesSugeridos.some((r) => r.toLowerCase() === q) ? `<button class="rival" data-act="p-rival" data-v="${esc(S.partida.rivalQ.trim())}">Usar «${esc(S.partida.rivalQ.trim())}»</button>` : ''
    return list.map((r) => `<button class="rival" data-act="p-rival" data-v="${esc(r)}">${esc(r)}</button>`).join('') + libre
  }
  /* Barra con dos marcas rotuladas: cada rótulo queda bajo (o sobre) su marca. */
  function barraRacha(yo, ref) {
    /* ancho estimado del rótulo (14 px): alcanza para centrarlo en su marca sin que se salga de la barra */
    const lado = (x, txt) => {
      const w = Math.round(txt.length * 7.6)
      return `left:clamp(0px, calc(${x}% - ${w / 2}px), calc(100% - ${w}px))`
    }
    const a = `vos: ${pct(yo.pct)}`
    const b = `esperable: ${pct(ref)}`
    return `<div class="rbar" role="img" aria-label="Vos: ${pct(yo.pct)}, con un intervalo de 95${NB}% de ${ciT(yo.ci)}. Esperable: ${pct(ref)}.">
        <p class="rbar__l" style="${lado(yo.pct, a)}">vos: <b>${pct(yo.pct)}</b></p>
        ${ibar(yo, { ref, tone: false })}
        <p class="rbar__l rbar__l--b" style="${lado(ref, b)}">esperable: <b>${pct(ref)}</b></p>
      </div>`
  }
  function partidaGuardada() {
    const P = S.partida
    const deck = deckById(P.mazoId)
    const R = D.partida.respuesta
    const ej = D.partida.ejemplo
    const esEj = P.resultado === ej.resultado && P.mazoId === ej.mazoId && P.rival === ej.rival
    const nC = P.cartas.length
    const detalles = [
      P.rival ? 'contra ' + P.rival : 'sin rival',
      P.empezo ? (P.empezo === 'yo' ? 'empecé yo' : 'empezó el rival') : null,
      nC ? `${nC} ${plural(nC, 'carta vista', 'cartas vistas')} (${copias(P.cartas)} ${plural(copias(P.cartas), 'copia', 'copias')})` : null,
      P.modalidad,
      P.notaTxt.trim() ? 'con nota' : null,
    ].filter(Boolean)
    let veredicto = ''
    if (P.resultado === 'Derrota' && esEj) {
      const partes = R.veredicto.titulo.split(' · ')
      const fr = R.veredicto.texto.split(/(?<=\.)\s+/)
      const yo = (D.mazo.rinde.porRival.find((r) => r.rival === P.rival) || {}).mias
      const esp = /es\s([\d,]+)\s%/.exec(R.veredicto.texto)
      const ref = esp ? parseFloat(esp[1].replace(',', '.')) : null
      veredicto = `<section class="verdict" data-e="none" style="gap:8px" aria-labelledby="pv-t">${spine()}
          <div class="hm__q"><p class="verdict__q">¿Mala racha?</p><button class="link" data-act="toggle" data-t="pv-cuenta" data-fid="pv-ver" aria-expanded="false" aria-controls="pv-cuenta">la cuenta de la racha</button></div>
          <h3 class="verdict__a verdict__a--s" id="pv-t">${esc(partes[0])}</h3>
          ${yo && ref != null ? barraRacha(yo, ref) : ''}
          <p class="verdict__why">${esc(fr.slice(0, 2).join(' '))}</p>
          <p class="verdict__why" id="pv-cuenta" hidden>${esc(fr.slice(2).join(' '))}</p>
        </section>`
    } else if (P.resultado === 'Derrota') {
      veredicto = `<section class="verdict" data-e="none" style="gap:6px">${spine()}<p class="verdict__q">¿Mala racha?</p><p class="verdict__why">Acá va el veredicto de este cruce. La maqueta lo trae solo para #${ej.mazoId} contra ${esc(ej.rival)}.</p></section>`
    }
    const rg = R.rango
    const opciones = `<div class="chips">${rg.opciones
      .map((o, i) => ({ o, i }))
      .sort((a, b) => /^Sigo/.test(b.o) - /^Sigo/.test(a.o))
      .map((x) => `<button class="chip" data-act="p-rango" data-v="${x.i}" data-fid="prg-${x.i}" aria-pressed="${P.rango === x.i}">${esc(x.o)}</button>`)
      .join('')}</div>`
    /* Sin temporada no se pregunta nada: una línea con el último rango, y la pregunta queda de muestra. */
    const rango = rg.vigente
      ? `<section class="card card--pad stack gap8" aria-labelledby="pr-t"><p class="label" id="pr-t">¿Cambiaste de rango?</p>${opciones}</section>`
      : `<section class="card rango" aria-label="Rango">
          <p class="rango__l"><b>Sin temporada en curso</b> · último rango: ${esc(rg.actual)}</p>
          <button class="link" data-act="toggle" data-t="rango-demo" data-fid="rango-ver" data-l0="cómo se pregunta en temporada" data-l1="ocultar la muestra" aria-expanded="false" aria-controls="rango-demo">cómo se pregunta en temporada</button>
          <div class="stack gap8 rango__demo" id="rango-demo" hidden><p class="label">Así se ve en temporada · ¿Cambiaste de rango?</p>${opciones}</div>
        </section>`
    return {
      title: 'Partida guardada',
      body: `<div class="saved" data-r="${P.resultado}" id="p-saved">${res(P.resultado)}<p class="saved__t">${P.resultado} con ${dn(deck.id, deck.nombre)}</p><p class="saved__d">${esc(detalles.join(PM))}</p></div>
        ${veredicto}
        ${rango}`,
      foot: `<div class="again"><p class="again__h">Otra con ${dn(deck.id, deck.nombre)}:</p>
        <div class="pres" role="group" aria-label="Registrar otra partida con el mismo mazo">${['Victoria', 'Derrota', 'Empate'].map((r) => `<button class="pres__o" data-r="${r}" data-act="p-otra" data-v="${r}" data-fid="po-${r}" style="min-height:48px">${res(r)}${r}</button>`).join('')}</div>
        <div class="again__r"><button class="btn btn--sec btn--s" data-act="p-undo" data-fid="p-undo">${ic('undo', 'ic--s')}${esc(R.deshacer)}</button><button class="btn btn--ghost btn--s" data-act="close" data-fid="p-listo">Listo</button></div></div>`,
    }
  }
/* Buscador: pantallas, acciones, mazos, cartas (una fila por carta) y arquetipos */
  function buscarIndice() {
    const mz = D.mazo
    const nm = `#${mz.id} ${mz.nombre}`
    const A = D.meta.arquetipo
    const pantallas = [
      { t: `Rinde · ${nm}`, d: 'Ficha del mazo · tres fuentes y rivales', h: `#/mazo/${mz.id}/rinde`, i: 'mazos' },
      { t: `Mejorar · ${nm}`, d: 'Ficha del mazo · qué le cambio', h: `#/mazo/${mz.id}/mejorar`, i: 'mazos' },
      { t: `Arquetipo · ${A.nombre}`, d: 'Meta · matchups del peor al mejor', h: '#/meta/arquetipo', i: 'meta' },
      { t: 'Hoy', d: 'Resumen del día', h: '#/hoy', i: 'hoy' },
      { t: 'Mazos', d: `Los ${D.mazos.length} armados`, h: '#/mazos', i: 'mazos' },
      { t: 'Sobres', d: 'Cartas · qué sobre abro', h: '#/cartas', i: 'cartas' },
      { t: 'Colección', d: 'Cartas · qué tengo y sincronizar', h: '#/cartas/coleccion', i: 'cartas' },
      { t: 'Meta', d: 'Torneos y eventos', h: '#/meta', i: 'meta' },
      { t: 'Pruebas', d: 'Simulación, laboratorio y practicar', h: '#/pruebas', i: 'pruebas' },
      { t: `Resultado #${D.pruebas.resultado.id}`, d: D.pruebas.resultado.titulo, h: `#/pruebas/resultado/${D.pruebas.resultado.id}`, i: 'pruebas' },
      { t: `Notas · ${nm}`, d: 'Ficha del mazo · notas y revisiones', h: `#/mazo/${mz.id}/notas`, i: 'mazos' },
      { t: 'Menú', d: 'Aspecto (tema, movimiento), ajustes, copia de seguridad, catálogo, tokens, sesión', h: '#/menu', i: 'menu' },
    ]
    const acciones = D.partida.mazosRecientes
      .map((m) => ({ t: `Registrar partida con #${m.id} ${m.nombre}`, d: 'Acción · abre la hoja con ese mazo', act: 'partida', mazo: m.id, i: 'plus' }))
      .concat([
        { t: `Probar #${mz.id} ${mz.nombre} contra el meta`, d: 'Acción · ¿Cómo rinde contra el meta?', act: 'probar', i: 'pruebas' },
        { t: 'Sincronizar la colección', d: 'Acción · traer del juego y ver qué entró', msg: '«Sincronizar» no está conectado en la maqueta.', i: 'sync' },
        { t: 'Tracker al día', d: 'Acción · archivo para importar en el tracker', msg: '«Tracker al día» no está en la maqueta.', i: 'sync' },
        { t: 'Cambiar el tema', d: 'Acción · oscuro, claro o sistema', h: '#/menu', i: 'sun' },
      ])
    return { pantallas, acciones }
  }
  function buscarResultados() {
    const q = S.buscar.trim().toLowerCase()
    const idx = buscarIndice()
    const hit = (s) => !q || String(s).toLowerCase().includes(q)
    const pantallas = (q ? idx.pantallas : idx.pantallas.slice(3).concat(idx.pantallas.slice(0, 3))).filter((p) => hit(p.t) || hit(p.d)).slice(0, q ? 3 : 12)
    const acciones = idx.acciones.filter((a) => hit(a.t)).slice(0, q ? 3 : 4)
    const esCons = q === D.buscar.consulta
    const mazosTodos = q ? D.mazos.filter((m) => hit(m.nombre) || ('#' + m.id).includes(q)) : []
    const mazos = esCons ? D.buscar.mazos.map((m) => deckById(m.id) || m) : mazosTodos
    const conocidas = []
    const seen = new Set()
    const add = (c) => {
      const n = c.nombre || c.carta
      if (!n || seen.has(n)) return
      seen.add(n)
      conocidas.push({ nombre: n, id: c.id, imagen: c.imagen, tipo: c.tipo, copias: c.copias, ediciones: c.ediciones })
    }
    D.buscar.cartas.forEach(add)
    D.cartas.coleccion.muestra.forEach(add)
    D.mazo.cartas.pokemon.concat(D.mazo.cartas.entrenadores).forEach(add)
    D.cartas.sobres.faltan.forEach(add)
    const cartas = q ? (esCons ? D.buscar.cartas : conocidas.filter((c) => hit(c.nombre) || hit(c.id || ''))) : []
    const arqs = q ? (esCons ? D.buscar.arquetipos : D.meta.arquetipos.filter((a) => hit(a.nombre))) : []
    const g = (titulo, n, total) => `<p class="find__g"><span class="label">${titulo}</span><span class="n">${total && total > n ? `${n} de ${total}` : n}</span></p>`
    let out = ''
    if (pantallas.length)
      out += g('Pantallas', pantallas.length) + pantallas.map((p) => `<a class="fr" href="${p.h}" data-act="find-go"><span class="fr__ic">${ic(p.i)}</span><span><span class="fr__t" style="display:block">${nbw(p.t)}</span><span class="fr__d" style="display:block">${esc(p.d)}</span></span><span class="row__go">${ic('chevR')}</span></a>`).join('')
    if (acciones.length)
      out +=
        g('Acciones', acciones.length) +
        acciones
          .map((a) => {
            const attrs = a.h ? `href="${a.h}" data-act="find-go"` : a.act === 'partida' ? `data-act="find-partida" data-mazo="${a.mazo}"` : a.act === 'probar' ? 'data-act="find-probar"' : todo(a.msg)
            const tag = a.h ? 'a' : 'button'
            return `<${tag} class="fr" ${attrs}><span class="fr__ic" style="background:var(--btn);color:var(--btn-tx)">${ic(a.i)}</span><span><span class="fr__t" style="display:block">${nbw(a.t)}</span><span class="fr__d" style="display:block">${esc(a.d)}</span></span><span></span></${tag}>`
          })
          .join('')
    if (mazos.length)
      out +=
        g('Mazos', mazos.length, mazosTodos.length) +
        mazos
          .map(
            (m) => `<a class="fr" href="#/mazo/${m.id}" data-act="find-go">${S.minis ? `<span style="display:grid;place-items:center">${art(m.miniaturas[0], m.miniaturasDe[0])}</span>` : `<span class="fr__ic">${tk(m.energias[0])}</span>`}<span><span class="fr__t" style="display:block">${dn(m.id, m.nombre)}</span><span class="fr__d rowf" style="gap:6px">${tks(m.energias, 'tk--s')}${esc(eNames(m.energias))}${m.completo ? '' : ` · falta ${m.falta}`}</span></span><span class="fr__k">${m.mias ? `<b>${pct(m.mias.pct)}</b>n${NB}${m.mias.n}` : 'sin datos'}</span></a>`,
          )
          .join('')
    if (cartas.length)
      out +=
        g('Cartas · una fila por carta', cartas.length, esCons ? D.buscar.cartasTotal : 0) +
        cartas
          .map(
            (c) => `<button class="fr" ${c.id ? `data-act="carta" data-id="${esc(c.id)}"` : `data-act="carta" data-id="f:${esc(c.nombre)}"`}>${thumb(c.imagen, c.nombre, c.tipo) || `<span class="fr__ic">${tk(c.tipo)}</span>`}<span><span class="fr__t" style="display:block">${esc(c.nombre)}</span><span class="fr__d" style="display:block">${c.id ? `<span class="mono">${esc(c.id)}</span>` : ''}${c.ediciones != null ? ` · ${c.ediciones} ${plural(c.ediciones, 'edición', 'ediciones')}` : ''}</span></span><span class="fr__k">${c.copias != null ? `<b>×${c.copias}</b>${plural(c.copias, 'copia', 'copias')}` : ''}</span></button>`,
          )
          .join('') +
        (esCons ? `<p class="note" style="padding:2px 4px 6px">La maqueta trae ${cartas.length} de las ${D.buscar.cartasTotal} cartas con «${esc(D.buscar.consulta)}».</p>` : '')
    if (arqs.length)
      out +=
        g('Arquetipos de torneo', arqs.length) +
        arqs
          .map((a) => {
            const full = D.meta.arquetipos.find((x) => x.id === a.id)
            const has = D.meta.arquetipo.id === a.id
            const inner = `<span class="fr__ic">${full ? tk(full.energias[0], 'tk--l') : ic('meta')}</span><span><span class="fr__t" style="display:block">${esc(a.nombre)}</span><span class="fr__d" style="display:block">${full ? `cuota ${pct(full.cuota)}${full.tengo ? ' · ' + esc(full.tengo) : ''}` : `fuera de los ${D.meta.arquetipos.length} más jugados`}</span></span><span class="fr__k">${full ? `<b>${pct(full.pct)}</b>n${NB}${int(full.n)}` : ''}</span>`
            return has ? `<a class="fr" href="#/meta/arquetipo" data-act="find-go">${inner}</a>` : `<a class="fr" href="#/meta" data-act="find-go">${inner}</a>`
          })
          .join('')
    if (!out) out = `<p class="find__empty">Nada con «${esc(S.buscar)}» en pantallas, acciones, mazos, cartas ni arquetipos.</p>`
    return out
  }
  function hojaBuscar() {
    return {
      title: 'Buscar',
      full: true,
      body: `<div id="find-res" class="stack gap4">${buscarResultados()}</div>`,
      foot: `<label class="field">${ic('search')}<input class="input" id="find-q" type="search" placeholder="Pantalla, acción, mazo o carta" aria-label="Buscar pantallas, acciones, mazos y cartas" autocomplete="off" enterkeyhint="search" value="${esc(S.buscar)}"></label>`,
      focus: '#find-q',
    }
  }
  function hojaSobre() {
    const s = D.cartas.sobres
    const v = s.veredicto
    const todos = [v].concat(s.alternativas)
    const max = v.numeros.puntaje
    return {
      title: `${v.nombre} · los números`,
      body: `<p class="sub">${esc(v.expansion)} · <span class="mono">${esc(v.expansionId)}</span> · ${v.limitadoHasta ? 'hasta el ' + fechaCorta(v.limitadoHasta) : 'no es por tiempo limitado'}</p>
        ${numerosSobre(v.numeros, true)}
        <div class="card card--pad stack gap10">
          <p class="label">Puntaje contra las alternativas</p>
          ${todos
            .map(
              (a, i) => `<div class="cmp__r" style="grid-template-columns:1fr auto"><span class="cmp__k">${esc(a.nombre)}${i === 0 ? ' <span class="badge badge--line">recomendado</span>' : ''}</span><b class="pct pct--m">${num(a.numeros.puntaje, 2, true)} <span class="n">· ${pct(a.numeros.alMenosUna)}</span></b><span class="bar bar--thick${i === 0 ? ' bar--tx' : ''}" style="grid-column:1/-1"><i style="width:${(a.numeros.puntaje / max) * 100}%"></i></span></div>`,
            )
            .join('')}
          <p class="note">Barra: puntaje. Al lado: probabilidad de al menos una carta buscada por sobre.</p>
        </div>
        <div class="stack gap6"><p class="label">Por qué</p><ul class="vlist">${v.porque.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`,
      foot: `<button class="btn btn--pri" data-act="close">Listo</button>`,
    }
  }
  function hojaProbar(q) {
    const P = D.pruebas
    const enFicha = /^\/mazo\/(\d+)/.exec(parse().path)
    const mz = (enFicha && deckById(enFicha[1])) || D.mazo
    const enMazo = !!enFicha
    return {
      title: enMazo ? `Probar #${mz.id}` : 'Nueva prueba',
      body:
        (enMazo ? `<p class="pdeck__sel">${tks(mz.energias)}<span>${dn(mz.id, mz.nombre)}</span></p>` : '<p class="sub">Elegí la pregunta; después el mazo, contra qué y cuánto, con el costo a la vista antes de lanzar.</p>') +
        `<ul class="card rows">${P.preguntas
          .map(
            (p) => `<li><button class="row" ${todo(`«${p.titulo}»: en la app acá va el formulario con el costo antes de encolar. La maqueta no lanza pruebas.`)}${q === p.id ? ' data-autofocus' : ''}><span class="row__ic">${ic(pregIcon[p.id])}</span><span class="grow"><span class="row__t" style="display:block">${esc(p.titulo)}</span><span class="row__d" style="display:block">${esc(p.bajada)}</span></span><span class="row__go">${ic('chevR')}</span></button></li>`,
          )
          .join('')}</ul>
        <p class="note">Motor: ${esc(P.motor.worker)}, ${esc(P.motor.estado)} · ${P.motor.colaTrabajos} trabajos en cola.</p>`,
      foot: `<button class="btn btn--sec" data-act="close">Cerrar</button>`,
    }
  }
  function hojaMas() {
    const rows = [
      ['Importar CSV', 'La exportación del tracker'],
      ['Exportar CSV', 'Tu colección, para guardar o compartir'],
      ['Ajustes manuales', 'Corregir copias a mano, con «Deshacer»'],
    ]
    return {
      title: 'Más acciones de la colección',
      body: `<ul class="card rows">${rows.map((r) => `<li><button class="row" ${todo(`«${r[0]}» no está en la maqueta.`)}><span class="grow"><span class="row__t" style="display:block">${r[0]}</span><span class="row__d" style="display:block">${r[1]}</span></span><span class="row__go">${ic('chevR')}</span></button></li>`).join('')}</ul>`,
      foot: `<button class="btn btn--sec" data-act="close">Cerrar</button>`,
    }
  }
  /* Una sola hoja de carta para toda la maqueta: la abren la lista del mazo, Colección, «Cartas que faltan» y el
     buscador. Junta lo que traen los datos de esa edición (id) o, en «faltan», de ese nombre. */
  const NOTA_CARTA = 'En la app, la ficha única suma todas las ediciones, de qué sobre sale cada una y el intercambio. La maqueta muestra lo que traen sus datos.'
  function hojaCarta(key) {
    const mz = D.mazo
    const enMazo = mz.cartas.pokemon.concat(mz.cartas.entrenadores)
    const filas = []
    const fila = (dt, dd) => filas.push(`<dt>${dt}</dt><dd>${dd}</dd>`)
    if (/^f:/.test(key || '')) {
      const f = D.cartas.sobres.faltan.find((x) => x.carta === key.slice(2))
      if (!f) return null
      fila('Te falta', `${f.falta} ${plural(f.falta, 'copia', 'copias')}`)
      fila(
        'Para',
        f.mazos
          .map((t) => {
            const d = deckById(t.replace('#', ''))
            return d ? dn(d.id, d.nombre) : esc(t)
          })
          .join('<br>'),
      )
      fila('Sale de', esc(f.sobre))
      fila('Consejo', f.consejo === 'comprar' ? `comprarla con puntos de sobre: ${int(f.puntos)}${NB}pts` : `abrir sobres (comprarla sale ${int(f.puntos)}${NB}pts)`)
      if (f.tipo) fila('Tipo', `${tk(f.tipo, 'tk--s')} ${esc(E[f.tipo].nombre)}`)
      return {
        title: f.carta,
        body: `<div class="bigcard">${thumb(f.imagen, f.carta, f.tipo, 'thumb--l') || ''}</div><dl class="facts">${filas.join('')}</dl><p class="note">${NOTA_CARTA}</p>`,
        foot: `<div class="savebar"><a class="btn btn--sec btn--grow" href="#/mazo/${f.mazos[0].replace('#', '')}" data-act="find-go">Abrir <span class="mono">${esc(f.mazos[0])}</span></a><button class="btn btn--pri btn--grow" data-act="close">Listo</button></div>`,
      }
    }
    const m = enMazo.filter((x) => x.id === key)
    const c = D.cartas.coleccion.muestra.find((x) => x.id === key) || D.buscar.cartas.find((x) => x.id === key)
    const base = m[0] || c
    if (!base) return null
    const tipo = base.tipo || (c && c.tipo) || null
    fila('Edición', `<span class="mono">${esc(base.id)}</span>`)
    if (m[0] || tipo) fila(m[0] ? 'Clase' : 'Tipo', [m[0] ? esc(m[0].clase) : '', tipo ? `${tk(tipo, 'tk--s')} ${esc(E[tipo].nombre)}` : ''].filter(Boolean).join(' · '))
    if (c) fila('Tenés', c.copias ? `${c.copias} ${plural(c.copias, 'copia', 'copias')} en ${c.ediciones} ${plural(c.ediciones, 'edición', 'ediciones')}` : `ninguna copia (${c.ediciones} ${plural(c.ediciones, 'edición', 'ediciones')})`)
    if (m.length) fila(`En <span class="mono">#${mz.id}</span>`, `${copias(m)} ${plural(copias(m), 'copia', 'copias')} de esta edición`)
    if (m[0] && m[0].puntos) fila('Puntos', `da ${m[0].puntos} al quedar fuera de combate`)
    return {
      title: base.nombre,
      body: `<div class="bigcard">${thumb(base.imagen, base.nombre, tipo, 'thumb--l') || ''}</div><dl class="facts">${filas.join('')}</dl><p class="note">${NOTA_CARTA}</p>`,
      foot: `<button class="btn btn--pri" data-act="close">Listo</button>`,
    }
  }
  /* Una partida de «Últimas partidas», al tocarla */
  function hojaJugada(i) {
    const p = ultimas()[+i]
    if (!p) return null
    const A = D.meta.arquetipo
    const det = ['contra ' + p.rival, p.empezo ? (p.empezo === 'yo' ? 'empecé yo' : 'empezó el rival') : null, p.modalidad].filter(Boolean)
    return {
      title: `Partida · ${p.cuando}`,
      body: `<div class="saved" data-r="${p.resultado}">${res(p.resultado)}<p class="saved__t">${p.resultado} con ${dn(p.mazoId, p.mazo)}</p><p class="saved__d">${esc(det.join(PM))}</p></div>
        <ul class="card rows">
          <li><a class="row" href="#/mazo/${p.mazoId}" data-act="find-go"><span class="row__ic">${ic('mazos')}</span><span class="grow"><span class="row__t" style="display:block">Abrir el mazo <span class="mono">#${p.mazoId}</span></span><span class="row__d" style="display:block">${esc(p.mazo)}</span></span><span class="row__go">${ic('chevR')}</span></a></li>
          ${p.rival === A.nombre ? `<li><a class="row" href="#/meta/arquetipo" data-act="find-go"><span class="row__ic">${ic('meta')}</span><span class="grow"><span class="row__t" style="display:block">Ver el rival en Meta</span><span class="row__d" style="display:block">${esc(A.nombre)} · tu nota y sus matchups</span></span><span class="row__go">${ic('chevR')}</span></a></li>` : ''}
          <li><button class="row" ${todo('Editar una partida (rival, quién empezó, cartas vistas, nota) no está en la maqueta.')}><span class="row__ic">${ic('edit')}</span><span class="grow"><span class="row__t" style="display:block">Editar</span><span class="row__d" style="display:block">Rival, quién empezó, cartas que viste, nota</span></span><span class="row__go">${ic('chevR')}</span></button></li>
        </ul>`,
      foot: `<button class="btn btn--pri" data-act="close">Listo</button>`,
    }
  }
  /* Una lista del arquetipo, al tocarla */
  function hojaLista(i) {
    const A = D.meta.arquetipo
    const l = A.listas[+i]
    if (!l) return null
    const partes = l.etiqueta.split(' · ')
    return {
      title: partes[0],
      body: `<p class="sub">${esc(A.nombre)}${partes[1] ? ' · ' + esc(partes.slice(1).join(' · ')) : ''}</p>
        <div class="card card--pad stack gap8">
          <div class="source__m"><b class="pct pct--xl">${pct(l.pct)}</b><span class="n">n${NB}=${NB}${int(l.n)}${om(l)} · torneos<br>IC${NB}95${NB}%: ${ciT(l.ci)}</span></div>
          ${ibar(l, { ref: D.meta.media.pct })}<div class="axis" aria-hidden="true"><span>0</span><span>media ${pct(D.meta.media.pct)}</span><span>100${NB}%</span></div>
        </div>
        <dl class="facts"><dt>Jugada</dt><dd>${l.veces} veces en la era</dd><dt>Con tu colección</dt><dd>${esc(l.tengo)}${l.faltaCartas.length ? ': ' + esc(l.faltaCartas.join(', ')) : ''}</dd></dl>
        <button class="btn btn--sec" ${todo('«Jugar contra esta lista» abre una partida contra el bot con la lista exacta; en la maqueta no está.')}>${ic('turno', 'ic--s')}Jugar contra esta lista</button>`,
      foot: `<div class="savebar">${l.faltaCartas.length ? `<a class="btn btn--sec btn--grow" href="#/cartas" data-act="find-go">Ver sobres</a>` : ''}<button class="btn btn--pri btn--grow" data-act="close">Listo</button></div>`,
    }
  }
  /* Un trabajo de Pruebas, al tocarlo: qué dio y qué se puede hacer con él */
  function hojaTrabajo(id) {
    const P = D.pruebas
    const j = P.trabajos.find((x) => x.id === +id)
    if (!j) return null
    const preg = P.preguntas.find((p) => p.id === j.pregunta)
    const st = estadoJob[j.estado] || ['info', '']
    const acc = {
      'en cola': [['Adelantar', '«Adelantar» pone el trabajo primero en la cola; la maqueta no encola.'], ['Cancelar', '«Cancelar» no está conectado en la maqueta.']],
      corriendo: [['Cancelar', '«Cancelar» no está conectado en la maqueta.']],
      falló: [['Reintentar lo que falló', '«Reintentar lo que falló» vuelve a jugar solo los cruces caídos; la maqueta no encola.']],
      cancelada: [['Repetir', '«Repetir» encola el mismo trabajo; la maqueta no encola.']],
      terminada: [['Repetir', '«Repetir» encola el mismo trabajo; la maqueta no encola.']],
    }[j.estado] || []
    const esR = P.resultado && P.resultado.id === j.id
    return {
      title: `Trabajo #${j.id}`,
      body: `<div class="stack gap4"><p class="label">${esc(preg ? preg.titulo : j.tipo)}</p><p class="qa__a">${esc(j.nombre)}</p>
          <p class="sub rowf" style="gap:8px"><span class="job__s ${st[1]}">${ic(st[0])}</span><span>${esc(cap(j.estado))} · ${esc(j.cuando)} · ${esc(j.tipo)}</span></p></div>
        ${j.progreso ? `<div class="card card--pad stack gap6"><p class="rowf between"><span class="sub">Partidas jugadas</span><b class="pct pct--m">${pct(j.progreso.pct)}</b></p><span class="bar bar--thick${j.estado === 'corriendo' ? ' bar--tx' : ''}"><i style="width:${Math.max(j.progreso.pct, 1)}%"></i></span><p class="sub">${int(j.progreso.hechas)} de ${int(j.progreso.total)}</p></div>` : ''}
        <div class="stack gap4"><p class="label">Qué dio</p><p class="pre" style="color:var(--tx)">${j.resultado ? esc(lector(j.resultado)) : j.estado === 'terminada' ? 'sin datos' : 'Todavía nada: ' + (j.estado === 'cancelada' ? 'se canceló antes de terminar.' : 'no terminó.')}</p></div>
        <p class="note">${esR ? 'Este es el resultado completo que trae la maqueta.' : `La maqueta trae el resultado completo solo de #${P.resultado.id}; de los demás, este resumen.`}</p>`,
      foot: `<div class="savebar">${acc.map((a) => `<button class="btn btn--sec btn--grow" ${todo(a[1])}>${a[0]}</button>`).join('')}${esR ? `<a class="btn btn--pri btn--grow" href="#/pruebas/resultado/${j.id}" data-act="find-go">Ver el resultado</a>` : `<button class="btn btn--pri btn--grow" data-act="close">Listo</button>`}</div>`,
    }
  }
  /* Lo que tiene plazo (promo, cupón, evento): el resumen y dónde sigue en la app */
  function hojaPlazo(k) {
    const s = D.cartas.sobres
    const ev = D.hoy.pendientes.find((p) => p.tipo === 'evento')
    const o = {
      promo: { t: 'Sobres de promoción', i: 'promo', plazo: `quedan ${s.promo.quedan} · hasta el ${dm(s.promo.vence)}`, txt: s.promo.texto, sigue: 'En la app sigue en Sobres → Sobres de promoción: qué batalla de evento ganar y cuántas victorias faltan.' },
      cupon: { t: 'Cupón ★★', i: 'star', plazo: `vence el ${dm(s.cupon.vence)}`, txt: s.cupon.texto, sigue: 'En la app sigue en Sobres → Cupón ★★: los sobres ordenados por lo que les dan a tus mazos.' },
      evento: ev ? { t: 'Evento', i: 'evento', plazo: (/hasta el [\d/]+/.exec(ev.texto) || [''])[0], txt: `${ev.texto.replace(/: hasta el [\d/]+$/, '')}. ${ev.detalle}`, sigue: 'En la app sigue en Meta → Eventos: las reglas completas y «Revisar un mazo» contra ellas.' } : null,
    }[k]
    if (!o) return null
    return {
      title: o.t,
      body: `<div class="rowf" style="align-items:flex-start;gap:12px"><span class="row__ic row__ic--warn">${ic(o.i)}</span><div class="stack gap6 grow">${o.plazo ? `<p class="plazo">${ic('clock', 'ic--xs')}${esc(o.plazo)}</p>` : ''}<p style="line-height:21px">${esc(o.txt)}</p></div></div>
        <p class="note">${o.sigue} La maqueta trae este resumen.</p>`,
      foot: `<button class="btn btn--pri" data-act="close">Listo</button>`,
    }
  }

/* ───────────── Marco: encabezado, pestañas, barra ───────────── */
  const NAV = [
    ['hoy', 'Hoy', '#/hoy'],
    ['mazos', 'Mazos', '#/mazos'],
    ['cartas', 'Cartas', '#/cartas'],
    ['meta', 'Meta', '#/meta'],
    ['pruebas', 'Pruebas', '#/pruebas'],
  ]
  function parse() {
    const h = location.hash.replace(/^#/, '') || '/hoy'
    const i = h.indexOf('?')
    const path = (i < 0 ? h : h.slice(0, i)).replace(/\/+$/, '') || '/hoy'
    const q = {}
    if (i >= 0)
      h.slice(i + 1)
        .split('&')
        .forEach((kv) => {
          const p = kv.split('=')
          if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' '))
        })
    return { path, q }
  }
  function resolve(path) {
    let m
    if (path === '/hoy') return vHoy()
    if (path === '/mazos') return vMazos()
    if ((m = /^\/mazo\/(\d+)(?:\/(\w+))?$/.exec(path))) return vMazo(m[1], m[2])
    if (path === '/cartas') return vSobres()
    if (path === '/cartas/coleccion') return vColeccion()
    if (path === '/pruebas') return vPruebas()
    if (/^\/pruebas\/resultado\/\d+$/.test(path)) return vResultado()
    if (path === '/meta') return vMeta()
    if (path === '/meta/arquetipo') return vArquetipo()
    if (path === '/menu') return vMenu()
    return vHoy()
  }
  const pageKey = (path) => path.replace(/^(\/mazo\/\d+)\/\w+$/, '$1')
  function tabsHTML(v) {
    if (!v.tabs) return ''
    return `<div class="tabs" role="tablist" aria-label="Vistas"${v.e ? ` data-e="${v.e}"` : ''}>${v.tabs
      .map(
        (t) =>
          `<button class="tab" role="tab" id="tab-${t.id}" aria-selected="${t.sel}" aria-controls="panel" tabindex="${t.sel ? 0 : -1}" data-act="${t.act || 'tab'}" ${t.href ? `data-href="${t.href}"` : `data-v="${t.id}"`} data-fid="tab-${t.id}">${t.label}</button>`,
      )
      .join('')}</div>`
  }
  let cur = { key: null, path: null, view: null }
  let entTimer = 0
  function renderPage(path, entering) {
    const fid = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-fid')
    const v = resolve(path)
    cur.view = v
    document.title = `${v.docTitle || v.title.replace(/<[^>]+>/g, '')} · TCG Pocket · maqueta A`
    $('#top').innerHTML =
      (v.back ? `<button class="iconbtn" data-act="back" data-parent="${v.back}" aria-label="Volver">${ic('back')}</button>` : `<span class="top__brand" aria-hidden="true">${BRAND}</span>`) +
      `<div class="top__titles"><${v.ownH1 ? 'p' : 'h1'} class="top__title">${v.title}</${v.ownH1 ? 'p' : 'h1'}>${v.sub ? `<p class="top__sub">${esc(v.sub)}</p>` : ''}</div>` +
      (v.pill || '') +
      (path === '/menu' ? '' : `<a class="iconbtn" href="#/menu" aria-label="Menú: aspecto, ajustes y sistema">${ic('menu')}</a>`)
    const abajo = v.tabsMovable && S.vistas === 'abajo'
    $('#tabs-top').innerHTML = abajo ? '' : tabsHTML(v)
    $('#tabs-bottom').innerHTML = abajo ? tabsHTML(v) : ''
    const main = $('#contenido')
    const sel = v.tabs && v.tabs.find((t) => t.sel)
    main.innerHTML = v.panel != null ? `${v.hero || ''}<div class="panel stack gap12" id="panel" role="tabpanel" aria-labelledby="tab-${sel.id}">${v.panel}</div>` : v.tabs ? `<div class="panel stack gap12" id="panel" role="tabpanel" aria-labelledby="tab-${sel.id}">${v.html}</div>` : v.html
    main.className = 'main' + (v.nodock ? ' has-nodock' : '') + (v.tabsMovable ? ' has-tabs' : '')
    reabrir(main)
    $('#dock').innerHTML = v.dock || ''
    $('#nav').innerHTML = NAV.map(
      (n) => `<a class="nav__a" href="${n[2]}" data-nav="${n[0]}"${v.tab === n[0] ? ' aria-current="page"' : ''}><span class="nav__i">${ic(n[0])}</span>${n[1]}${n[0] === 'hoy' && D.hoy.pendientes.length ? '<i class="nav__dot" aria-hidden="true"></i><span class="vh"> (hay pendientes)</span>' : ''}</a>`,
    ).join('')
    clearTimeout(entTimer)
    const target = entering === 'panel' || (v.tabs && v.panel == null) ? $('#panel') : main
    if (entering && target) {
      target.classList.add('is-entering')
      entTimer = setTimeout(() => target.classList.remove('is-entering'), 1500)
      countUp(target)
    }
    if (fid) {
      const el = document.querySelector(`[data-fid="${fid}"]`)
      if (el) el.focus({ preventScroll: true })
    }
    if (v.tab) S.lastByTab[v.tab] = '#' + path
  }
  function countUp(scope) {
    if (motion() !== 'expresivo') return
    const els = $$('[data-cu]', scope).map((el) => ({ el, v: parseFloat(el.dataset.cu), txt: el.textContent }))
    if (!els.length) return
    const t0 = performance.now()
    const dur = 620
    const done = () => els.forEach((f) => (f.el.textContent = f.txt))
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur)
      if (k >= 1) return done()
      const e = 1 - Math.pow(1 - k, 3)
      els.forEach((f) => (f.el.textContent = num(f.v * e, 1, true) + NB + '%'))
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
    setTimeout(done, dur + 250)
  }

  /* ───────────── Hojas: abrir, cerrar, foco ───────────── */
  const sheetRoot = $('#sheet-root')
  const shell = $('#shell')
  /* stack: desde qué dirección se abrió cada hoja con la app (no por URL). «Cerrar» vuelve una atrás; una hoja
     abierta desde otra (buscador → carta) vuelve a la anterior. */
  const sheet = { name: null, stack: [], opener: null, key: '' }
  function sheetSpec(name, q) {
    if (name === 'partida') return S.partida.guardada ? partidaGuardada() : partidaForm()
    if (name === 'buscar') return hojaBuscar()
    if (name === 'sobre') return hojaSobre()
    if (name === 'probar') return hojaProbar(q.q)
    if (name === 'mas') return hojaMas()
    if (name === 'carta') return hojaCarta(q.c)
    if (name === 'jugada') return hojaJugada(q.i)
    if (name === 'lista') return hojaLista(q.i)
    if (name === 'trabajo') return hojaTrabajo(q.id)
    if (name === 'plazo') return hojaPlazo(q.k)
    return null
  }
  function sheetHTML(sp) {
    return `<div class="sheet__grab" aria-hidden="true"></div>
      <header class="sheet__head"><h2 id="sheet-t">${esc(sp.title)}</h2><button class="iconbtn" data-act="close" aria-label="Cerrar">${ic('close')}</button></header>
      <div class="sheet__body">${sp.body}</div>
      ${sp.foot ? `<footer class="sheet__foot">${sp.foot}</footer>` : ''}`
  }
  function sheetRender(still) {
    const el = $('.sheet', sheetRoot)
    if (!el) return
    const sp = sheetSpec(sheet.name, parse().q)
    if (!sp) return
    const fid = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-fid')
    const sc = $('.sheet__body', el) ? $('.sheet__body', el).scrollTop : 0
    el.innerHTML = sheetHTML(sp)
    el.classList.toggle('is-still', !!still)
    reabrir(el)
    if (still) $('.sheet__body', el).scrollTop = sc
    if (fid) {
      const f = el.querySelector(`[data-fid="${fid}"]`)
      if (f) f.focus({ preventScroll: true })
      else el.focus({ preventScroll: true })
    }
    return sp
  }
  function sheetOpenDom(name, q) {
    clearTimeout(sheet.timer)
    sheet.name = name
    if (!sheet.opener) sheet.opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null
    const sp = sheetSpec(name, q)
    if (!sp) return
    sheetRoot.classList.remove('is-closing')
    sheetRoot.hidden = false
    sheetRoot.innerHTML = `<div class="backdrop" data-act="close"></div><section class="sheet${sp.full ? ' sheet--full' : ''}" role="dialog" aria-modal="true" aria-labelledby="sheet-t" tabindex="-1">${sheetHTML(sp)}</section>`
    shell.inert = true
    shell.setAttribute('aria-hidden', 'true')
    root.classList.add('has-sheet')
    root.style.overflow = 'hidden'
    const el = $('.sheet', sheetRoot)
    reabrir(el)
    if (sp.full) el.style.height = 'calc(100dvh - 36px - var(--kb))'
    const f = (sp.focus && $(sp.focus, el)) || $('[data-autofocus]', el) || el
    f.focus({ preventScroll: true })
    if (f.select && f.value) f.setSelectionRange(f.value.length, f.value.length)
  }
  function sheetCloseDom() {
    if (!sheet.name) return
    sheet.name = null
    shell.inert = false
    shell.removeAttribute('aria-hidden')
    root.classList.remove('has-sheet')
    root.style.overflow = ''
    const op = sheet.opener
    sheet.opener = null
    const fin = () => {
      sheetRoot.hidden = true
      sheetRoot.innerHTML = ''
      sheetRoot.classList.remove('is-closing')
    }
    if (motion() === 'ninguno') fin()
    else {
      sheetRoot.classList.add('is-closing')
      sheet.timer = setTimeout(fin, motion() === 'sutil' ? 160 : 240)
    }
    syncDock()
    const back = op && document.contains(op) ? op : $('[data-fid="dock-partida"]') || $('#contenido')
    if (back) back.focus({ preventScroll: true })
  }
  const hashWith = (path, q) => {
    const parts = Object.keys(q)
      .filter((k) => q[k] != null && q[k] !== '')
      .map((k) => `${k}=${encodeURIComponent(q[k])}`)
    return '#' + path + (parts.length ? '?' + parts.join('&') : '')
  }
  const sheetNameOf = (q) => q.hoja || (q.detalle === 'sobre' ? 'sobre' : null)
  function openSheet(name, extra) {
    const r = parse()
    const q = Object.assign({}, extra || {})
    if (name === 'sobre') q.detalle = 'sobre'
    else q.hoja = name
    if (!sheet.name) sheet.opener = document.activeElement
    const to = hashWith(r.path, q)
    if (to === location.hash) return
    sheet.stack.push(location.hash)
    intent = 'sheet'
    location.hash = to
  }
  let pendingNav = null
  function closeSheet(thenHref) {
    if (!sheet.name) {
      if (thenHref) go(thenHref)
      return
    }
    if (sheet.stack.length) {
      pendingNav = thenHref || null
      intent = 'sheet'
      /* para ir a otra pantalla se cierran todas las hojas apiladas de una vez */
      const n = thenHref ? sheet.stack.length : 1
      if (thenHref) sheet.stack.length = 0
      history.go(-n)
    } else {
      const r = parse()
      history.replaceState(null, '', thenHref || '#' + r.path)
      intent = thenHref ? 'link' : 'sheet'
      route()
    }
  }
  function replaceQ(q) {
    const r = parse()
    history.replaceState(null, '', hashWith(r.path, q))
  }

  /* ───────────── Rutas ───────────── */
  let intent = null // 'link' | 'tab' | 'sheet' | null (atrás/adelante)
  function go(href) {
    intent = intent || 'link'
    if (location.hash === href) route()
    else location.hash = href
  }
  function route() {
    const r = parse()
    if (sheet.stack.length && sheet.stack[sheet.stack.length - 1] === location.hash) sheet.stack.pop()
    if (!sheetNameOf(r.q)) sheet.stack.length = 0
    let changed = false
    for (const k of ['tema', 'movimiento', 'vistas'])
      if (r.q[k] && OPC[k].includes(r.q[k]) && S[k] !== r.q[k]) {
        S[k] = r.q[k]
        changed = true
      }
    if (changed) applySettings()
    const key = pageKey(r.path)
    const pageChanged = key !== cur.key
    const pathChanged = r.path !== cur.path
    if (pageChanged || pathChanged || changed) {
      if (cur.key) S.scroll[cur.key] = window.scrollY
      const restore = intent === null || intent === 'tab'
      renderPage(r.path, pageChanged ? true : pathChanged ? 'panel' : false)
      if (pageChanged) {
        cur.viaLink = intent === 'link'
        window.scrollTo(0, restore && S.scroll[key] != null ? S.scroll[key] : 0)
      } else if (pathChanged) scrollToPanel()
      cur.key = key
      cur.path = r.path
    }
    const name = sheetNameOf(r.q)
    if (name) {
      if (name === 'partida' && sheet.name !== 'partida' && !sheet.stack.length) partidaDesdeURL(r.q)
      if (sheet.name !== name || sheet.key !== JSON.stringify(r.q)) {
        if (sheet.name === name) sheetRender(true)
        else sheetOpenDom(name, r.q)
      }
      sheet.key = JSON.stringify(r.q)
    } else if (sheet.name) {
      sheetCloseDom()
      sheet.key = ''
    }
    intent = null
    if (pendingNav) {
      const h = pendingNav
      pendingNav = null
      intent = 'link'
      location.hash = h
    }
  }
  /* Estados de la hoja por dirección. Solo los dos estados de ejemplo pisan el borrador; «hoja=partida» a secas
     abre lo que haya (o una partida nueva si la anterior ya se guardó). */
  function partidaDesdeURL(q) {
    const ej = D.partida.ejemplo
    if (q.estado === 'guardada' && S.partida.guardada) return
    if (q.estado === 'lista' || q.estado === 'guardada') {
      S.partida = Object.assign(nuevaPartida(ej.mazoId, ej.modalidad), {
        resultado: ej.resultado,
        rival: ej.rival,
        empezo: ej.empezo,
        cartas: D.partida.cartasVistasEjemplo.map((c) => Object.assign({}, c)),
        guardada: q.estado === 'guardada',
      })
    } else if (!q.estado) {
      if (S.partida.guardada) S.partida = nuevaPartida(S.partida.mazoId, S.partida.modalidad)
      if (q.mazo && deckById(q.mazo)) S.partida.mazoId = +q.mazo
    }
  }
  function scrollToPanel() {
    const panel = $('#panel')
    if (!panel) return
    const top = panel.getBoundingClientRect().top + window.scrollY - 52 - (S.vistas === 'abajo' || !cur.view.tabs ? 8 : 56)
    if (window.scrollY > top) window.scrollTo(0, Math.max(0, top))
  }

  /* ───────────── Desplegados ───────────── */
  function abrir(btn, open) {
    const t = document.getElementById(btn.dataset.t)
    if (!t) return
    btn.setAttribute('aria-expanded', open)
    t.hidden = !open
    const h = btn.dataset.hide && document.getElementById(btn.dataset.hide)
    if (h) h.hidden = open
    if (btn.dataset.l1) btn.textContent = open ? btn.dataset.l1 : btn.dataset.l0
  }
  function reabrir(scope) {
    if (!scope || !abiertos.size) return
    $$('[data-act="toggle"]', scope).forEach((b) => {
      if (abiertos.has(b.dataset.t)) abrir(b, true)
    })
  }

  /* ───────────── Avisos y festejo ───────────── */
  function toast(msg, ms) {
    const box = $('#toasts')
    const el = document.createElement('div')
    el.className = 'toast'
    el.innerHTML = `<span>${esc(msg)}</span>`
    box.innerHTML = ''
    box.appendChild(el)
    clearTimeout(toast.t)
    toast.t = setTimeout(() => {
      el.classList.add('is-out')
      setTimeout(() => el.remove(), 260)
    }, ms || 3400)
  }
  function festejo(from) {
    if (motion() !== 'expresivo' || !from) return
    const r = from.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const cs = getComputedStyle(root)
    const colores = [cs.getPropertyValue('--win'), cs.getPropertyValue('--warn'), '#62a8ff', '#c792ff', '#9ad94b', '#ff8a4c']
    const fx = $('#fx')
    let out = ''
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + Math.random() * 0.4
      const d = 70 + Math.random() * 120
      out += `<i style="left:${cx - 6}px;top:${cy - 6}px;--dx:${(Math.cos(a) * d).toFixed(0)}px;--dy:${(Math.sin(a) * d - 40).toFixed(0)}px;--rot:${(Math.random() * 540 - 270).toFixed(0)}deg;--c:${colores[i % colores.length]};animation-delay:${(Math.random() * 90).toFixed(0)}ms"></i>`
    }
    fx.innerHTML = out
    setTimeout(() => (fx.innerHTML = ''), 1300)
  }
  /* FLIP: las filas viajan a su lugar nuevo al reordenar (solo con movimiento) */
  function flip(container, mutate) {
    const before = new Map()
    if (motion() !== 'ninguno') $$('[data-key]', container).forEach((el) => before.set(el.dataset.key, el.getBoundingClientRect().top))
    mutate()
    if (motion() === 'ninguno') return
    $$('[data-key]', container).forEach((el) => {
      const b = before.get(el.dataset.key)
      if (b == null) return
      const dy = b - el.getBoundingClientRect().top
      if (!dy) return
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
        duration: motion() === 'expresivo' ? 460 : 160,
        easing: motion() === 'expresivo' ? 'cubic-bezier(.2,1.25,.35,1)' : 'ease-out',
      })
    })
  }

  /* ───────────── Eventos ───────────── */
  const rerender = () => renderPage(parse().path, false)
  const A = {
    find: () => openSheet('buscar'),
    /* Abre la hoja con el borrador que haya: nada de lo cargado se pierde por cerrar y volver. */
    partida(el) {
      if (S.partida.guardada) S.partida = nuevaPartida(S.partida.mazoId, S.partida.modalidad)
      if (el.dataset.mazo) S.partida.mazoId = +el.dataset.mazo
      if (el.dataset.rival) {
        S.partida.rival = el.dataset.rival
        S.partida.rivalQ = ''
      }
      openSheet('partida')
    },
    jugada: (el) => openSheet('jugada', { i: el.dataset.i }),
    lista: (el) => openSheet('lista', { i: el.dataset.i }),
    trabajo: (el) => openSheet('trabajo', { id: el.dataset.id }),
    plazo: (el) => openSheet('plazo', { k: el.dataset.k }),
    probar: (el) => openSheet('probar', el.dataset.q ? { q: el.dataset.q } : null),
    mas: () => openSheet('mas'),
    sobre: () => openSheet('sobre'),
    carta: (el) => openSheet('carta', { c: el.dataset.id }),
    close: () => closeSheet(),
    back(el) {
      if (cur.viaLink) history.back()
      else {
        intent = 'tab'
        location.hash = el.dataset.parent
      }
    },
    todo: (el) => toast(el.dataset.msg || 'Esto no está en la maqueta.'),

    scroll(el) {
      const t = document.getElementById(el.dataset.to)
      if (!t) return
      window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 64, behavior: motion() === 'ninguno' ? 'auto' : 'smooth' })
      t.focus({ preventScroll: true })
    },
    toggle(el) {
      const open = el.getAttribute('aria-expanded') !== 'true'
      abrir(el, open)
      if (open) abiertos.add(el.dataset.t)
      else abiertos.delete(el.dataset.t)
    },
    orden(el) {
      if (S.orden === el.dataset.v) return
      S.orden = el.dataset.v
      $$('[data-act="orden"]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === S.orden))
      const list = $('#hm-list')
      flip(list, () => {
        list.innerHTML = hoyMazosLista()
        reabrir(list)
      })
      $('#hm-why').innerHTML = hoyPorque(hoyOrden())
    },
    tab(el) {
      const href = el.dataset.href
      if (location.hash.split('?')[0] === href) return
      history.replaceState(null, '', href)
      intent = 'tab'
      route()
      const t = document.querySelector(`[role="tab"][aria-selected="true"]`)
      if (t && el.getAttribute('role') === 'tab') t.focus({ preventScroll: true })
    },
    'res-vista'(el) {
      S.resVista = el.dataset.v
      renderPage(parse().path, 'panel')
      scrollToPanel()
      const t = document.querySelector(`[role="tab"][aria-selected="true"]`)
      if (t) t.focus({ preventScroll: true })
    },
    grilla(el) {
      S.grilla = el.dataset.v === '1'
      rerender()
    },
    'mz-filtro'(el) {
      S.mazos.filtro = el.dataset.v
      $$('[data-act="mz-filtro"]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === S.mazos.filtro))
      $('#mz-list').innerHTML = mazosLista()
    },
    'col-filtro'(el) {
      S.coleccion.filtro = el.dataset.v
      $$('[data-act="col-filtro"]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === S.coleccion.filtro))
      $('#col-list').innerHTML = coleccionLista()
    },
    'job-filtro'(el) {
      S.jobs = el.dataset.v
      $$('[data-act="job-filtro"]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === S.jobs))
      $('#job-list').innerHTML = jobsLista()
    },
    'meta-orden'(el) {
      if (S.metaOrden === el.dataset.v) return
      S.metaOrden = el.dataset.v
      $$('[data-act="meta-orden"]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === S.metaOrden))
      const list = $('#arq-list')
      flip(list, () => {
        list.innerHTML = metaOrdenados().map(arqFila).join('')
        reabrir(list)
      })
    },
    tema(el) {
      S.tema = el.dataset.v
      applySettings()
      rerender()
    },
    mov(el) {
      if (mqReduce.matches) return toast('Tu sistema pide reducir el movimiento: queda en «Ninguno».')
      S.movimiento = el.dataset.v
      applySettings()
      renderPage(parse().path, true)
    },
    vistas(el) {
      S.vistas = el.dataset.v
      applySettings()
      rerender()
    },
    minis() {
      S.minis = !S.minis
      applySettings()
      rerender()
    },
    /* hoja de partida */
    'p-deck'(el) {
      S.partida.mazoId = +el.dataset.id
      sheetRender(true)
    },
    'p-res'(el) {
      S.partida.resultado = S.partida.resultado === el.dataset.r ? null : el.dataset.r
      sheetRender(true)
      const b = $('.pres__o[aria-pressed="true"] .res', sheetRoot)
      if (b && motion() === 'expresivo') b.animate([{ transform: 'scale(.5)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.2,1.3,.35,1)' })
    },
    'p-rival'(el) {
      S.partida.rival = el.dataset.v
      S.partida.rivalQ = ''
      sheetRender(true)
      const f = $('[data-fid="p-rival-clear"]', sheetRoot)
      if (f) f.focus({ preventScroll: true })
    },
    'p-rival-clear'() {
      S.partida.rival = null
      sheetRender(true)
      const f = $('#p-rival', sheetRoot)
      if (f) f.focus({ preventScroll: true })
    },
    'p-emp'(el) {
      S.partida.empezo = S.partida.empezo === el.dataset.v ? null : el.dataset.v
      sheetRender(true)
    },
    'p-card-add'() {
      const next = D.partida.cartasVistasEjemplo.find((c) => !S.partida.cartas.some((x) => x.nombre === c.nombre))
      if (!next) return toast('En la app acá se busca la carta por nombre; la maqueta trae dos de ejemplo.')
      S.partida.cartas.push(Object.assign({}, next, { cant: 1 }))
      sheetRender(true)
    },
    'p-card'(el) {
      const c = S.partida.cartas[+el.dataset.i]
      if (c.cant >= 2) S.partida.cartas.splice(+el.dataset.i, 1)
      else c.cant++
      sheetRender(true)
    },
    /* «Nota» abre el campo; «Quitar la nota» lo cierra y borra lo escrito (es descartar a propósito). */
    'p-nota'() {
      S.partida.nota = !S.partida.nota
      if (!S.partida.nota) S.partida.notaTxt = ''
      sheetRender(true)
      const f = $('#p-nota-in', sheetRoot)
      if (f) f.focus({ preventScroll: true })
    },
    'p-descartar'() {
      S.partida = nuevaPartida(S.partida.mazoId, S.partida.modalidad)
      sheetRender(true)
      toast('Borrador descartado.')
    },
    'p-save'(el) {
      if (el.getAttribute('aria-disabled') === 'true') {
        const g = $('.pres', sheetRoot)
        if (g && motion() !== 'ninguno') g.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 220 })
        return
      }
      const P = S.partida
      /* un rival escrito y sin elegir también cuenta: nada de lo cargado se pierde */
      if (!P.rival && P.rivalQ.trim()) P.rival = P.rivalQ.trim()
      P.rivalQ = ''
      P.guardada = true
      P.sid = ++S.sid
      S.sesion.push({ sid: P.sid, mazoId: P.mazoId, resultado: P.resultado, rival: P.rival, empezo: P.empezo, modalidad: P.modalidad })
      replaceQ({ hoja: 'partida', estado: 'guardada' })
      sheet.key = JSON.stringify(parse().q)
      sheetRender(false)
      syncSesion()
      $('.sheet', sheetRoot).focus({ preventScroll: true })
      if (P.resultado === 'Victoria') festejo($('#p-saved .res', sheetRoot))
    },
    'p-undo'() {
      const P = S.partida
      S.sesion = S.sesion.filter((x) => x.sid !== P.sid)
      P.guardada = false
      P.sid = null
      replaceQ({ hoja: 'partida' })
      sheet.key = JSON.stringify(parse().q)
      sheetRender(true)
      syncSesion()
      toast('Partida deshecha: quedó el formulario como estaba.')
    },
    'p-otra'(el) {
      const prev = S.partida
      S.partida = nuevaPartida(prev.mazoId, prev.modalidad)
      S.partida.resultado = el.dataset.v
      replaceQ({ hoja: 'partida' })
      sheet.key = JSON.stringify(parse().q)
      sheetRender(false)
      $('.sheet', sheetRoot).focus({ preventScroll: true })
    },
    'p-rango'(el) {
      S.partida.rango = S.partida.rango === +el.dataset.v ? null : +el.dataset.v
      sheetRender(true)
    },
    /* buscador */
    'find-go'(el, ev) {
      ev.preventDefault()
      closeSheet(el.getAttribute('href'))
    },
    'find-partida'(el) {
      if (S.partida.guardada) S.partida = nuevaPartida(S.partida.mazoId, S.partida.modalidad)
      S.partida.mazoId = +el.dataset.mazo
      replaceQ({ hoja: 'partida' })
      route()
    },
    'find-probar'() {
      replaceQ({ hoja: 'probar', q: 'meta' })
      route()
    },
  }
  document.addEventListener('click', (ev) => {
    const nav = ev.target.closest('[data-nav]')
    if (nav) {
      ev.preventDefault()
      const tab = nav.dataset.nav
      const rootHref = NAV.find((n) => n[0] === tab)[2]
      const activo = cur.view && cur.view.tab === tab
      const href = activo ? rootHref : S.lastByTab[tab] || rootHref
      if (location.hash.split('?')[0] === href) {
        window.scrollTo({ top: 0, behavior: motion() === 'ninguno' ? 'auto' : 'smooth' })
        return
      }
      if (activo) S.scroll[pageKey(href.slice(1))] = 0
      intent = 'tab'
      location.hash = href
      return
    }
    const el = ev.target.closest('[data-act]')
    if (el) {
      const fn = A[el.dataset.act]
      if (fn) {
        if (el.tagName === 'A' && el.dataset.act !== 'find-go') ev.preventDefault()
        fn(el, ev)
      }
      return
    }
    const a = ev.target.closest('a[href^="#/"]')
    if (a) intent = 'link'
  })
  document.addEventListener('input', (ev) => {
    const t = ev.target
    if (t.id === 'mz-q') {
      S.mazos.q = t.value
      $('#mz-list').innerHTML = mazosLista()
    } else if (t.id === 'col-q') {
      S.coleccion.q = t.value
      $('#col-list').innerHTML = coleccionLista()
    } else if (t.id === 'find-q') {
      S.buscar = t.value
      $('#find-res').innerHTML = buscarResultados()
      $('.sheet__body', sheetRoot).scrollTop = 0
    } else if (t.id === 'p-rival') {
      S.partida.rivalQ = t.value
      $('#p-rivals').innerHTML = rivalesSug()
    } else if (t.id === 'p-nota-in') S.partida.notaTxt = t.value
  })
  document.addEventListener('change', (ev) => {
    const t = ev.target
    if (t.id === 'mz-orden') {
      S.mazos.orden = t.value
      $('#mz-list').innerHTML = mazosLista()
    } else if (t.id === 'p-mod') S.partida.modalidad = t.value
  })
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && sheet.name) {
      ev.preventDefault()
      closeSheet()
      return
    }
    if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') {
      // Enter en un campo nunca guarda: elige la primera sugerencia o cierra el teclado.
      ev.preventDefault()
      if (ev.target.id === 'p-rival') {
        const first = $('#p-rivals .rival')
        if (first) first.click()
        else ev.target.blur()
      } else if (ev.target.id === 'find-q') {
        const first = $('#find-res .fr')
        if (first) first.focus()
      } else ev.target.blur()
      return
    }
    if (ev.key === 'Tab' && sheet.name) {
      const el = $('.sheet', sheetRoot)
      const f = $$('a[href], button:not([disabled]), input, select, summary, [tabindex="0"]', el).filter((x) => x.offsetParent !== null)
      if (!f.length) return ev.preventDefault()
      const first = f[0]
      const last = f[f.length - 1]
      const act = document.activeElement
      if (ev.shiftKey && (act === first || act === el)) {
        ev.preventDefault()
        last.focus()
      } else if (!ev.shiftKey && (act === last || !el.contains(act))) {
        ev.preventDefault()
        first.focus()
      }
      return
    }
    const tab = ev.target.closest && ev.target.closest('[role="tab"]')
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) {
      ev.preventDefault()
      const tabs = $$('[role="tab"]', tab.parentElement)
      const i = tabs.indexOf(tab)
      const n = ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
      tabs[n].focus()
      tabs[n].click()
      return
    }
    if (ev.key === '/' && !sheet.name && !/INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) {
      ev.preventDefault()
      openSheet('buscar')
    }
  })
  window.addEventListener('hashchange', route)
  window.addEventListener(
    'scroll',
    () => {
      $('#top').classList.toggle('is-stuck', window.scrollY > 6)
    },
    { passive: true },
  )
  if (window.visualViewport) {
    const kb = () => root.style.setProperty('--kb', Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop) + 'px')
    window.visualViewport.addEventListener('resize', kb)
    window.visualViewport.addEventListener('scroll', kb)
  }
  try {
    history.scrollRestoration = 'manual'
  } catch (e) {}

  /* ───────────── Arranque ───────────── */
  if (!D) {
    $('#contenido').innerHTML = '<p style="padding:24px">No se pudo cargar ../datos.js.</p>'
    return
  }
  applySettings()
  intent = 'tab'
  route()
})()
