// generar.mjs — Arma las páginas públicas de Fiscontable (portada de ventas y páginas legales) en español e inglés.
// Uso:  npm run sitio      (o: node sitio/generar.mjs)
// Una sola plantilla: los textos de la portada viven en textos.mjs y el contenido de las páginas legales en
// contenido/*.html. Lo que sale (index.html, en/…, privacidad/…, terminos/…) se sube tal cual; no edites esos
// archivos a mano: cambia aquí y vuelve a generar. Esta carpeta no se publica (.assetsignore).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { T } from "./textos.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url)), RAIZ = join(AQUI, "..");
const V = (/var VERSION = "(\d+)"/.exec(readFileSync(join(RAIZ, "assets/js/nucleo.js"), "utf8")) || [])[1] || "1";
const DOMINIO = "https://fiscontable.app";
// ¿El Agente ya está publicado en Microsoft Store? Al publicarse: true, y volver a generar (cambia la portada y la ayuda).
const EN_TIENDA = false;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// El logo en línea, con la pastilla «app» en su propio grupo para poder animarla (assets/css/marca.css)
function logo() {
    let t = readFileSync(join(RAIZ, "assets/marca/fiscontable-logo-app-oscuro.svg"), "utf8").replace(/<title>.*?<\/title>/, "");
    t = t.replace(/<svg [^>]*>/, '<svg class="fc-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 291.17 77.25" role="img" aria-label="Fiscontable">');
    const i = t.indexOf('<rect x="159.58"'), j = t.lastIndexOf("</g></svg>");
    if (i < 0 || j < i) throw new Error("El logo cambió: no encuentro la pastilla «app».");
    return t.slice(0, i) + '<g class="fc-logo__app">' + t.slice(i, j) + "</g></g></svg>";
}
const LOGO = logo();

const ICONOS = {
    descarga: "M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1 .5 7.97M12 11v9m0 0l-3-3m3 3l3-3",
    xml: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M10.5 12.5L8.5 14.5l2 2M13.5 12.5l2 2-2 2",
    escudo: "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6zM9 12l2 2 4-4",
    buzon: "M4 13l2.5-7h11L20 13M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5M4 13h4.5a3.5 3.5 0 0 0 7 0H20",
    alerta: "M12 9v4m0 3.5v.01M4.5 19h15a1 1 0 0 0 .87-1.5l-7.5-13a1 1 0 0 0-1.74 0l-7.5 13A1 1 0 0 0 4.5 19z",
    cruce: "M7 7h11m0 0l-3-3m3 3l-3 3M17 17H6m0 0l3 3m-3-3l3-3",
    factura: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
    equipo: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.87M15.5 3.13a3.5 3.5 0 0 1 0 6.75",
    candado: "M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3",
    telefono: "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2",
    lista: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
    reloj: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
    monitor: "M4 5h16v11H4zM9 20h6M12 16v4",
    check: "M5 12.5l4.5 4.5L19 7.5",
    flecha: "M5 12h14m0 0l-5-5m5 5l-5 5"
};
const ico = (n, clase = "") => `<svg class="st-ico ${clase}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONOS[n]}"/></svg>`;
const WINDOWS = '<svg class="st-win" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5.5l8-1.2v7.2H3zM12 4.2L21 3v8.5h-9zM3 12.5h8v7.2l-8-1.2zM12 12.5h9V21l-9-1.2z"/></svg>';

// ------------------------------------------------------------------ piezas comunes
function cabeza(t, { titulo, descripcion, canonica, alterna, css = [], indexar = true }) {
    const es = t.idioma === "es";
    return `<!DOCTYPE html>
<html lang="${t.idioma}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(titulo)}</title>
    <meta name="description" content="${esc(descripcion)}">
    <meta name="theme-color" content="#161513">${indexar ? "" : '\n    <meta name="robots" content="noindex">'}
    <link rel="canonical" href="${DOMINIO}${canonica}">
    <link rel="alternate" hreflang="es" href="${DOMINIO}${es ? canonica : alterna}">
    <link rel="alternate" hreflang="en" href="${DOMINIO}${es ? alterna : canonica}">
    <link rel="alternate" hreflang="x-default" href="${DOMINIO}${es ? canonica : alterna}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Fiscontable">
    <meta property="og:title" content="${esc(titulo)}">
    <meta property="og:description" content="${esc(descripcion)}">
    <meta property="og:url" content="${DOMINIO}${canonica}">
    <meta property="og:image" content="${DOMINIO}/assets/marca/compartir.png">
    <meta property="og:locale" content="${es ? "es_MX" : "en_US"}">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" href="/assets/marca/favicon.svg?v=${V}" type="image/svg+xml">
    <link rel="alternate icon" href="/assets/marca/favicon.ico?v=${V}">
    <link rel="apple-touch-icon" href="/assets/marca/apple-touch-icon.png?v=${V}">
    <link rel="preload" href="/assets/fuentes/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="stylesheet" href="/assets/css/marca.css?v=${V}">
    <link rel="stylesheet" href="/assets/css/sitio.css?v=${V}">${css.map((c) => `\n    <link rel="stylesheet" href="${c}?v=${V}">`).join("")}
`;
}

function barra(t, { ancla = "", entra = false } = {}) {
    const n = t.nav, base = ancla ? "" : t.ruta;
    return `<header class="st-barra" id="st-barra">
    <div class="st-contenedor st-barra__dentro">
        <a class="st-barra__logo${entra ? " fc-logo--entra" : ""}" href="${t.ruta}" aria-label="Fiscontable">${LOGO}</a>
        <nav class="st-nav" id="st-nav" aria-label="${esc(n.menu)}">
            <a href="${base}#funciones">${n.funciones}</a>
            <a href="${base}#agente">${n.agente}</a>
            <a href="${base}#seguridad">${n.seguridad}</a>
            <a href="${base}#preguntas">${n.dudas}</a>
            <span class="st-nav__botones">
                <a class="st-btn st-btn--fantasma" href="/login" data-entrar="${esc(n.tablero)}">${n.entrar}</a>
                <a class="st-btn st-btn--principal" href="${base}#registro">${n.demo}</a>
            </span>
        </nav>
        <button type="button" class="st-barra__menu" id="st-menu" aria-controls="st-nav" aria-expanded="false" aria-label="${esc(n.menu)}"><span></span><span></span><span></span></button>
    </div>
</header>`;
}

function pie(t, { ancla = "" } = {}) {
    const p = t.pie, n = t.nav, r = t.rutas, base = ancla ? "" : t.ruta;
    return `<footer class="st-pie">
    <div class="st-contenedor st-pie__dentro">
        <div class="st-pie__marca">
            <a href="${t.ruta}" class="st-pie__logo"><img src="/assets/marca/fiscontable-logo-app-oscuro.svg?v=${V}" alt="Fiscontable" width="128" height="34"></a>
            <p>${p.lema}</p>
        </div>
        <nav aria-label="${esc(p.producto)}"><b>${p.producto}</b>
            <a href="${base}#funciones">${n.funciones}</a><a href="${base}#agente">${n.agente}</a><a href="${base}#seguridad">${n.seguridad}</a><a href="${base}#preguntas">${n.dudas}</a></nav>
        <nav aria-label="${esc(p.cuenta)}"><b>${p.cuenta}</b>
            <a href="/login">${n.entrar}</a><a href="${base}#registro">${n.demo}</a><a href="/login#licencia">${p.activar}</a><a href="${r.soporte}">${p.soporte}</a></nav>
        <nav aria-label="${esc(p.legal)}"><b>${p.legal}</b>
            <a href="${r.privacidad}">${p.privacidad}</a><a href="${r.terminos}">${p.terminos}</a><a href="${r.cookies}">${p.cookies}</a></nav>
    </div>
    <div class="st-contenedor"><div class="st-pie__base">
        <span>${p.derechos}</span>
        <a class="st-pie__idioma" href="${t.otraPagina || t.otra}" hreflang="${t.idioma === "es" ? "en" : "es"}" lang="${t.idioma === "es" ? "en" : "es"}">${t.otraNombre}</a>
    </div></div>
</footer>`;
}

// ------------------------------------------------------------------ maquetas (dibujadas con HTML: no son fotos)
const EMPRESAS = ["Comercializadora Aurora", "Ferretera del Valle", "Clínica Santa Lucía", "Transportes Rivera", "Café Orquídea", "Constructora Miralta"];
const ESTADOS = [                      // XML, constancia, 32-D, buzón, declaración
    ["ok", "ok", "ok", "ok", "ok"],
    ["ok", "ok", "mal", "2", "ok"],
    ["ok", "pend", "ok", "ok", "pend"],
    ["falta", "ok", "ok", "ok", "pend"],
    ["ok", "ok", "ok", "ok", "ok"],
    ["ok", "ok", "ok", "1", "ok"]
];
function marca(e) {
    if (e === "ok") return '<i class="mk-e mk-e--ok"><svg viewBox="0 0 12 12"><path d="M2.5 6.3l2.3 2.3 4.7-5"/></svg></i>';
    if (e === "pend") return '<i class="mk-e mk-e--pend"><svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="3.6"/><path d="M6 4.2V6l1.2.8"/></svg></i>';
    if (e === "mal") return '<i class="mk-e mk-e--mal">!</i>';
    if (e === "falta") return '<i class="mk-e mk-e--falta"><svg viewBox="0 0 12 12"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5"/></svg></i>';
    return `<i class="mk-e mk-e--num">${e}</i>`;
}
function maquetaCierre(t) {
    const m = t.maqueta;
    return `<figure class="mk mk-cierre" aria-label="${esc(m.lector)}">
    <div class="mk-barra" aria-hidden="true"><i></i><i></i><i></i><b>${m.ventana}</b></div>
    <div class="mk-cuerpo" aria-hidden="true">
        <div class="mk-cab"><div><small>${m.cab}</small><strong>${m.mes}</strong></div>
            <div class="mk-meses">${m.meses.map((x, i) => `<span${i === 2 ? ' class="act"' : ""}>${x}</span>`).join("")}</div></div>
        <div class="mk-filtros">${m.filtros.map((f, i) => `<span${i === 0 ? ' class="act"' : ""}>${f[0]} <b>${f[1]}</b></span>`).join("")}</div>
        <div class="mk-tabla">
            <div class="mk-fila mk-fila--cab">${m.columnas.map((c) => `<span>${c}</span>`).join("")}</div>
            ${EMPRESAS.map((e, i) => `<div class="mk-fila"><span class="mk-cli"><b>${e}</b><small${m.vence[i] === "vencida" || m.vence[i] === "overdue" ? ' class="mk-vencida"' : ""}>${m.vence[i]}</small></span>${ESTADOS[i].map(marca).join("")}</div>`).join("\n            ")}
        </div>
    </div>
    <figcaption>${m.pie}</figcaption>
</figure>`;
}
function maquetaXml(t) {
    const m = t.maquetaXml;
    return `<div class="mk mk-chica" aria-hidden="true">
    <div class="mk-cuerpo">
        <div class="mk-cab"><div><strong>${m.titulo}</strong></div><span class="mk-sello">${m.sub}</span></div>
        ${m.filas.map((f) => `<div class="mk-renglon"><i class="mk-e mk-e--ok"><svg viewBox="0 0 12 12"><path d="M2.5 6.3l2.3 2.3 4.7-5"/></svg></i><b>${f[0]}</b><span>${f[1]}</span></div>`).join("\n        ")}
        <div class="mk-total">${ico("descarga")}${m.pie}</div>
    </div>
</div>`;
}
function maquetaEquipo(t) {
    const m = t.maquetaEquipo;
    return `<div class="mk mk-chica" aria-hidden="true">
    <div class="mk-cuerpo">
        <div class="mk-cab"><div><strong>${m.titulo}</strong></div></div>
        ${m.filas.map((f, i) => `<div class="mk-persona"><i class="mk-avatar mk-avatar--${i}">${f[0]}</i><span><b>${f[1]}</b><small>${f[3]}</small></span><em${i === 0 ? ' class="act"' : ""}>${f[2]}</em></div>`).join("\n        ")}
    </div>
</div>`;
}
function maquetaAgente(t) {
    const v = t.agente.ventana;
    return `<div class="mk mk-agente" aria-hidden="true">
    <div class="mk-barra mk-barra--clara"><svg viewBox="0 0 64 64"><use href="/assets/marca/simbolos.svg?v=${V}#fiscontable"></use></svg><b>${v.titulo}</b><span>—  ☐  ✕</span></div>
    <div class="mk-cuerpo">
        ${v.filas.map((f, i) => `<p><span>${f[0]}</span><b>${i === 0 ? '<i class="mk-punto"></i>' : ""}${f[1]}</b></p>`).join("\n        ")}
    </div>
    <div class="mk-bandeja"><i class="mk-punto"></i><svg viewBox="0 0 64 64"><use href="/assets/marca/simbolos.svg?v=${V}#fiscontable"></use></svg><span>12:41</span></div>
</div>`;
}

// ------------------------------------------------------------------ portada
function portada(t) {
    const h = t.heroe, f = t.funciones, a = t.agente, s = t.seguridad, r = t.registro, d = t.dudas;
    const datos = { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Fiscontable", url: DOMINIO + t.ruta,
        applicationCategory: "BusinessApplication", operatingSystem: "Web, Windows 10, Windows 11", inLanguage: "es-MX", description: t.descripcion,
        publisher: { "@type": "Organization", name: "Fiscontable", url: DOMINIO } };
    return cabeza(t, { titulo: t.titulo, descripcion: t.descripcion, canonica: t.ruta, alterna: t.otra, css: ["/assets/css/forma-demo.css"] }) +
`    <script type="application/ld+json">${JSON.stringify(datos)}</script>
</head>
<body class="st">
<a class="st-saltar" href="#contenido">${t.idioma === "es" ? "Ir al contenido" : "Skip to content"}</a>
${barra(t, { ancla: "si", entra: true })}

<main id="contenido">
<section class="st-heroe">
    <div class="st-fondo" aria-hidden="true"><i class="st-luz st-luz--verde"></i><i class="st-luz st-luz--arena"></i></div>
    <div class="st-contenedor st-heroe__dentro">
        <div class="st-heroe__texto">
            <span class="st-chip">${h.chip}</span>
            <h1>${h.h1a} <em>${h.h1b}</em></h1>
            <p class="st-heroe__sub">${h.sub}</p>
            <div class="st-heroe__botones">
                <a class="st-btn st-btn--principal st-btn--grande" href="#registro">${h.demo}</a>
                <a class="st-btn st-btn--fantasma st-btn--grande" href="#funciones">${h.ver}</a>
            </div>
            <ul class="st-heroe__nota">${h.nota.map((x) => `<li>${ico("check")}${x}</li>`).join("")}</ul>
        </div>
        <div class="st-heroe__arte">${maquetaCierre(t)}</div>
    </div>
</section>

<section class="st-seccion st-seccion--clara" id="funciones">
    <div class="st-contenedor">
        <header class="st-titulo"><span class="st-chip">${f.chip}</span><h2>${f.h2}</h2><p>${f.sub}</p></header>
        <div class="st-modulos">
            ${f.lista.map((m) => `<article class="st-modulo">${ico(m[0])}<h3>${m[1]}</h3><p>${m[2]}</p></article>`).join("\n            ")}
        </div>
    </div>
</section>

<section class="st-seccion st-seccion--clara st-seccion--pegada">
    <div class="st-contenedor st-focos">
        ${t.focos.map((x, i) => `<article class="st-foco${i % 2 ? " st-foco--al-reves" : ""}">
            <div class="st-foco__texto"><span class="st-chip">${x.chip}</span><h2>${x.h2}</h2><p>${x.texto}</p>
                <ul class="st-puntos">${x.puntos.map((p) => `<li>${ico("check")}${p}</li>`).join("")}</ul></div>
            <div class="st-foco__arte">${i === 0 ? maquetaXml(t) : maquetaEquipo(t)}</div>
        </article>`).join("\n        ")}
    </div>
</section>

<section class="st-seccion st-seccion--arena" id="agente">
    <div class="st-contenedor st-foco">
        <div class="st-foco__texto"><span class="st-chip">${WINDOWS}${a.chip}</span><h2>${a.h2}</h2><p>${a.texto}</p>
            <ul class="st-puntos">${a.puntos.map((p) => `<li>${ico("check")}${p}</li>`).join("")}</ul>
            <div class="st-foco__botones"><a class="st-btn st-btn--oscuro" href="${t.rutas.soporte}#agente">${a.boton} ${ico("flecha")}</a><span class="st-tienda">${WINDOWS}${EN_TIENDA ? a.tiendaLista : a.tienda}</span></div>
        </div>
        <div class="st-foco__arte">${maquetaAgente(t)}</div>
    </div>
</section>

<section class="st-seccion" id="seguridad">
    <div class="st-contenedor">
        <header class="st-titulo"><span class="st-chip">${s.chip}</span><h2>${s.h2}</h2><p>${s.sub}</p></header>
        <div class="st-seguros">
            ${s.lista.map((m) => `<article class="st-seguro">${ico(m[0])}<div><h3>${m[1]}</h3><p>${m[2]}</p></div></article>`).join("\n            ")}
        </div>
        <p class="st-centro"><a class="st-liga" href="${t.rutas.privacidad}">${s.enlace} ${ico("flecha")}</a></p>
    </div>
</section>

<section class="st-seccion st-seccion--clara">
    <div class="st-contenedor">
        <header class="st-titulo"><span class="st-chip">${t.pasos.chip}</span><h2>${t.pasos.h2}</h2></header>
        <ol class="st-pasos">
            ${t.pasos.lista.map((p, i) => `<li><span>${i + 1}</span><h3>${p[0]}</h3><p>${p[1]}</p></li>`).join("\n            ")}
        </ol>
    </div>
</section>

<section class="st-seccion st-registro" id="registro">
    <div class="st-fondo" aria-hidden="true"><i class="st-luz st-luz--verde"></i></div>
    <div class="st-contenedor st-registro__dentro">
        <div class="st-registro__texto"><span class="st-chip">${r.chip}</span><h2>${r.h2}</h2><p>${r.sub}</p>
            <ul class="st-puntos">${r.puntos.map((p) => `<li>${ico("check")}${p}</li>`).join("")}</ul>
            <p class="st-registro__otros">${r.licencia} <a href="/login#licencia">${r.licenciaEnlace}</a><br>${r.cuenta} <a href="/login">${r.cuentaEnlace}</a></p>
        </div>
        <div class="st-registro__forma" id="st-forma-demo" data-forma-demo data-idioma="${t.idioma}"><noscript>${t.registro.sinJs}</noscript></div>
    </div>
</section>

<section class="st-seccion st-seccion--clara" id="preguntas">
    <div class="st-contenedor st-dudas">
        <header class="st-titulo st-titulo--izq"><span class="st-chip">${d.chip}</span><h2>${d.h2}</h2></header>
        <div class="st-dudas__lista">
            ${d.lista.map((q) => `<details><summary>${q[0]}</summary><p>${q[1]}</p></details>`).join("\n            ")}
        </div>
    </div>
</section>

<section class="st-cierre">
    <div class="st-contenedor"><h2>${t.cierre.h2}</h2><a class="st-btn st-btn--principal st-btn--grande" href="#registro">${t.cierre.boton}</a></div>
</section>
</main>

${pie(t, { ancla: "si" })}
<script src="/assets/js/nucleo.js?v=${V}"></script>
<script src="/assets/js/comun/forma-demo.js?v=${V}"></script>
<script src="/assets/js/sitio.js?v=${V}"></script>
</body>
</html>
`;
}

// ------------------------------------------------------------------ páginas de texto (privacidad, términos, cookies, ayuda)
const LEGALES = [
    { clave: "privacidad", es: ["/privacidad/", "Aviso de privacidad"], en: ["/en/privacy/", "Privacy notice"] },
    { clave: "terminos", es: ["/terminos/", "Términos y condiciones"], en: ["/en/terms/", "Terms and conditions"] },
    { clave: "cookies", es: ["/cookies/", "Cookies"], en: ["/en/cookies/", "Cookies"] },
    { clave: "soporte", es: ["/soporte/", "Ayuda y soporte"], en: ["/en/support/", "Help and support"] }
];
function paginaTexto(t, l) {
    const [ruta, titulo] = l[t.idioma], otra = l[t.idioma === "es" ? "en" : "es"][0];
    const crudo = readFileSync(join(AQUI, "contenido", `${l.clave}.${t.idioma}.html`), "utf8");
    const m = /^<!--\s*descripcion:\s*(.*?)\s*-->\s*/.exec(crudo);
    const descripcion = m ? m[1] : titulo;
    // Bloques que dependen de si el Agente ya está en la Tienda: <!--si-tienda-->…<!--/si-tienda--> y <!--no-tienda-->…<!--/no-tienda-->
    const quita = EN_TIENDA ? "no-tienda" : "si-tienda", deja = EN_TIENDA ? "si-tienda" : "no-tienda";
    const cuerpo = (m ? crudo.slice(m[0].length) : crudo).replace(new RegExp(`<!--${quita}-->[\\s\\S]*?<!--/${quita}-->\\n?`, "g"), "").replace(new RegExp(`<!--/?${deja}-->\\n?`, "g"), "");
    const tt = Object.assign({}, t, { otraPagina: otra });
    return cabeza(t, { titulo: `${titulo} | Fiscontable`, descripcion, canonica: ruta, alterna: otra }) +
`</head>
<body class="st st--texto">
<a class="st-saltar" href="#contenido">${t.idioma === "es" ? "Ir al contenido" : "Skip to content"}</a>
${barra(t)}
<main id="contenido" class="st-texto">
    <div class="st-contenedor st-texto__dentro">
${cuerpo.trim().split("\n").map((x) => "        " + x).join("\n")}
    </div>
</main>
${pie(tt)}
<script src="/assets/js/contacto-publico.js?v=${V}"></script>
<script src="/assets/js/sitio.js?v=${V}"></script>
</body>
</html>
`;
}

// ------------------------------------------------------------------ escribir
function escribir(ruta, html) {
    const destino = join(RAIZ, ruta.replace(/^\//, ""), "index.html");
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, html);
    return ruta;
}
const hechas = [];
for (const idioma of ["es", "en"]) {
    const t = T[idioma];
    hechas.push(escribir(t.ruta, portada(t)));
    for (const l of LEGALES) hechas.push(escribir(l[idioma][0], paginaTexto(t, l)));
}
// Página «no encontrada» (Cloudflare y GitHub Pages sirven /404.html)
writeFileSync(join(RAIZ, "404.html"), cabeza(T.es, { titulo: "No encontramos esa página | Fiscontable", descripcion: "La página que buscas no existe o cambió de lugar.", canonica: "/", alterna: "/en/", indexar: false }) +
`</head>
<body class="st">
${barra(T.es)}
<main id="contenido" class="st-cierre st-perdida">
    <div class="st-contenedor"><span class="st-chip">Error 404</span><h2>No encontramos esa página</h2>
        <p>Puede que el enlace esté incompleto o que la página haya cambiado de lugar.<br><span lang="en">We could not find that page.</span></p>
        <div class="st-heroe__botones"><a class="st-btn st-btn--principal st-btn--grande" href="/inicio/">Ir a mi tablero</a><a class="st-btn st-btn--fantasma st-btn--grande" href="/?sitio">Página principal</a></div></div>
</main>
${pie(T.es)}
<script src="/assets/js/sitio.js?v=${V}"></script>
</body>
</html>
`);
// Mapa del sitio (solo páginas públicas)
writeFileSync(join(RAIZ, "sitemap.xml"), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    hechas.concat(["/login", "/demo"]).map((r) => `  <url><loc>${DOMINIO}${r}</loc></url>`).join("\n") + "\n</urlset>\n");
console.log("Páginas generadas (v=" + V + "):", hechas.join("  "));
