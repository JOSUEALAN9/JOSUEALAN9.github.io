/**
 * clientes.js — código de clientes/ (antes vivía dentro del HTML).
 */
const API_URL = Fiscontable.API;          // la dirección vive solo en assets/js/nucleo.js
const esc = Fiscontable.escapar;          // todo texto del servidor pasa por aquí antes de ir al HTML
let clientesCache = [];
let soloLectura = false;
let puedeGuardarEfirma = true;   // en la Demo no se guardan e.firmas (lo decide el servidor)
let sinConexion = false;
let espacioCli = null;           // despacho: {tipo: "personal"|"despacho", despacho: {...}, puede_cambiar} o null
let conIsn = false;              // el usuario tiene el módulo ISN: se muestran las obligaciones
let conXml = false;              // tiene Descarga masiva de XML: pestaña "Descarga de XML" en la ficha
let conFacturar = false;         // tiene Facturar: en Accesos va su sello digital (CSD), régimen y C.P.
let factCfg = null;              // /api/facturacion/config: catálogos y cómo va cada empresa para facturar
let xmlAuto = null;              // configuración de la descarga automática (todas sus empresas)
let obligaciones = {};           // {rfc: {obligacion, zona, completos}}

document.addEventListener("DOMContentLoaded", inicializar);
document.addEventListener("change", (e) => {
    if (e.target && e.target.id === "obl-isn") pintarDetalleIsn(obligaciones[rfcEnEdicion] || {});
    if (e.target && e.target.id === "nuevo-obl-isn") document.getElementById("nuevo-obl-zona").classList.toggle("hidden", !e.target.checked);
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { cerrarModalNuevoCliente(); cerrarModalEditar(); }
});

async function inicializar() {
    sinConexion = false;
    document.getElementById("banner-sin-conexion").classList.add("hidden");

    const perfilOk = await verificarPerfil();
    if (!perfilOk) {
        marcarSinConexion();
        return;
    }
    await cargarClientes();
    abrirDesdeUrl();
}

/* Accesos directos desde la barra: /clientes/?editar=RFC abre su ficha; ?nuevo=1 abre el alta */
function abrirDesdeUrl() {
    const q = new URLSearchParams(location.search);
    const rfc = (q.get("editar") || "").toUpperCase();
    if (rfc && (clientesCache || []).some(c => c.rfc === rfc)) abrirModalEditar(rfc, q.get("ficha"));
    else if (q.get("nuevo")) abrirModalNuevoCliente();
}

async function reintentar() {
    const boton = document.getElementById("btn-reintentar");
    boton.disabled = true;
    boton.textContent = "Reintentando...";
    await inicializar();
    boton.disabled = false;
    boton.textContent = "Reintentar";
}

function marcarSinConexion(mensaje) {
    sinConexion = true;
    document.getElementById("banner-sin-conexion-texto").textContent =
        mensaje || "No pudimos conectar con el servidor. Puede que tu sesión haya expirado o que el servidor no esté disponible en este momento.";
    document.getElementById("banner-sin-conexion").classList.remove("hidden");

    // No ofrecemos acciones que sabemos que van a fallar: es peor
    // dejar que llene el formulario completo para rebotarlo al final.
    const btnAgregar = document.getElementById("btn-agregar-cliente");
    btnAgregar.disabled = true;
    btnAgregar.classList.add("opacity-40", "cursor-not-allowed");
    btnAgregar.title = "No disponible sin conexión al servidor";

    document.getElementById("estado-vacio").classList.add("hidden");
    document.getElementById("lista-clientes").innerHTML = "";
}

async function verificarPerfil() {
    try {
        const resp = await fetch(`${API_URL}/api/mi-perfil`, { credentials: "include" });

        if (resp.status === 401 || resp.status === 403) {
            marcarSinConexion("Tu sesión con el servidor expiró. Reconéctala para continuar.");
            return false;
        }
        if (!resp.ok) return false;

        const perfil = await resp.json();
        soloLectura = perfil.solo_lectura;
        conIsn = (perfil.modulos_permitidos || []).indexOf("isn") !== -1;
        conXml = (perfil.modulos_permitidos || []).indexOf("descarga_xml") !== -1;
        conFacturar = (perfil.modulos_permitidos || []).indexOf("facturacion") !== -1;
        puedeGuardarEfirma = perfil.puede_guardar_efirma !== false;
        espacioCli = perfil.viendo_como ? null : (perfil.espacio || null);

        const btnAgregar = document.getElementById("btn-agregar-cliente");
        btnAgregar.disabled = false;
        btnAgregar.classList.remove("opacity-40", "cursor-not-allowed");
        btnAgregar.title = "";

        if (soloLectura) {
            document.getElementById("banner-solo-lectura").classList.remove("hidden");
            btnAgregar.classList.add("hidden");
        } else {
            document.getElementById("banner-solo-lectura").classList.add("hidden");
            btnAgregar.classList.remove("hidden");
        }
        return true;
    } catch (error) {
        return false;
    }
}

/* ---------------------------------------------------------------- alta de empresa
   Con su e.firma: el RFC, el nombre y la vigencia salen del .cer (se leen aquí, en el navegador).
   Sin e.firma: se escribe el RFC. El tipo de sociedad se adivina del nombre; la CIEC es opcional. */
let altaCer = null;                 // {rfc, nombre, vigenteHasta, vencido}

const SUFIJOS = [
    [/,?\s*S\.?\s*A\.?\s*P\.?\s*I\.?\s*DE\s*C\.?\s*V\.?$/i, "S.A.P.I. de C.V."],
    [/,?\s*S\.?\s*A\.?\s*S\.?\s*DE\s*C\.?\s*V\.?$/i, "S.A.S. de C.V."],
    [/,?\s*S\.?\s*C\.?\s*DE\s*R\.?\s*L\.?\s*DE\s*C\.?\s*V\.?$/i, "S.C. de R.L. de C.V."],
    [/,?\s*S\.?\s*DE\s*R\.?\s*L\.?\s*DE\s*C\.?\s*V\.?$/i, "S. de R.L. de C.V."],
    [/,?\s*S\.?\s*DE\s*R\.?\s*L\.?$/i, "S. de R.L."],
    [/,?\s*S\.?\s*A\.?\s*DE\s*C\.?\s*V\.?$/i, "S.A. de C.V."],
    [/,?\s*S\.?\s*A\.?\s*S\.?$/i, "S.A.S."],
    [/,?\s*S\.\s*C\.?$|,?\s+SC$/i, "S.C."],
    [/,?\s*A\.\s*C\.?$|,?\s+AC$/i, "A.C."],
    [/,?\s*S\.\s*A\.?$|,?\s+SA$/i, "S.A."],
];
function separarTipo(nombre) {
    nombre = (nombre || "").trim();
    for (const [re, tipo] of SUFIJOS) if (re.test(nombre)) return { nombre: nombre.replace(re, "").trim(), tipo };
    return { nombre, tipo: "" };
}

/* Pestañas del alta (las mismas que la ficha): Datos generales · Accesos · Obligaciones */
function ponerFichaAlta(nombre) {
    if (nombre === "obligaciones" && document.getElementById("alta-tab-obligaciones").hidden) nombre = "general";
    if (nombre === "facturar" && document.getElementById("alta-tab-facturar").hidden) nombre = "general";
    document.querySelectorAll("[data-alta-ficha][role=tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.altaFicha === nombre)));
    document.querySelectorAll("[data-alta-panel]").forEach(p => { p.hidden = p.dataset.altaPanel !== nombre; });
}

/* Con un .cer bueno el RFC queda fijo (sale del certificado); sin él, se escribe */
function rfcDesdeCer(d) {
    const campo = document.getElementById("input-rfc");
    campo.readOnly = !!d;
    campo.classList.toggle("bg-slate-50", !!d);
    if (d) campo.value = d.rfc;
    document.getElementById("alta-pista-efirma").hidden = !!d;
    document.getElementById("alta-punto-accesos").hidden = !d || d.vencido;
    const nombre = document.getElementById("input-alias").value.trim();
    document.getElementById("alta-titulo").textContent = nombre || "Registrar empresa";
    document.getElementById("alta-inicial").textContent = nombre ? nombre.charAt(0).toUpperCase() : "+";
    document.getElementById("alta-sub").textContent = d ? `${d.rfc} · tomado de su e.firma` : "Con su e.firma no escribes el RFC: sale del certificado.";
}

function errorAlta(texto) {
    const p = document.getElementById("alta-error");
    p.textContent = texto; p.hidden = !texto;
}

async function alElegirCer() {
    const archivo = document.getElementById("alta-cer").files[0];
    const info = document.getElementById("alta-cer-info");
    altaCer = null; errorAlta("");
    if (!archivo) { info.hidden = true; rfcDesdeCer(null); return; }
    const d = window.leerCertificado ? await leerCertificado(archivo) : null;
    info.hidden = false;
    if (!d || !d.rfc) {
        info.className = "alta-info alta-info--mal";
        info.textContent = "No se pudo leer ese archivo. Elige el certificado (.cer) de la e.firma, no el .key.";
        rfcDesdeCer(null);
        return;
    }
    altaCer = d;
    revisarEnDespacho(d.rfc);
    const hasta = d.vigenteHasta ? d.vigenteHasta.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "";
    info.className = "alta-info" + (d.vencido ? " alta-info--mal" : "");
    info.textContent = d.vencido ? `RFC ${d.rfc} · esta e.firma venció el ${hasta}: hay que renovarla en el SAT.`
        : `✓ RFC ${d.rfc}${d.nombre ? " · " + d.nombre : ""} · vigente hasta ${hasta}`;
    const nombre = document.getElementById("input-alias"), tipo = document.getElementById("input-tipo");
    const sep = separarTipo(d.nombre);
    if (!nombre.value.trim() && sep.nombre) nombre.value = sep.nombre;
    if (!tipo.value) tipo.value = d.rfc.length === 13 ? "Persona física" : sep.tipo;
    rfcDesdeCer(d);
    if (!document.getElementById("alta-key").files[0]) document.getElementById("alta-key").focus();
    else document.getElementById("alta-password").focus();
}

function abrirModalNuevoCliente() {
    if (sinConexion || soloLectura) return;
    document.getElementById("alta-tab-obligaciones").hidden = !conIsn;
    document.getElementById("alta-tab-facturar").hidden = !conFacturar || !puedeGuardarEfirma;
    if (conFacturar && puedeGuardarEfirma) llenarRegimenesAlta();
    document.getElementById("nuevo-obl-zona").classList.add("hidden");
    document.getElementById("alta-nota-demo").hidden = puedeGuardarEfirma;
    document.getElementById("alta-ciec-caja").hidden = !puedeGuardarEfirma;
    document.getElementById("alta-cer-info").hidden = true;
    altaCer = null;
    errorAlta("");
    rfcDesdeCer(null);
    ponerFichaAlta("general");
    pintarEspacioAlta();
    avisoDespacho(null);
    document.getElementById("modal-nuevo-cliente").classList.add("modal-active");
}

/* ---------------------------------------------------------------- despacho (Mi espacio / Despacho)
   Al registrar se dice dónde queda; si ya está en el despacho, se avisa (pedir acceso en vez de duplicarla).
   En el despacho, quien no puede registrar empresas manda una solicitud al titular. */
function soloSolicitud() {
    const e = espacioCli;
    return !!(e && e.tipo === "despacho" && !e.despacho.propia && !e.despacho.agregar);
}
function pintarEspacioAlta() {
    const caja = document.getElementById("alta-espacio"), boton = document.getElementById("btn-guardar-cliente");
    const e = espacioCli;
    boton.textContent = soloSolicitud() ? "Mandar solicitud al titular" : "Registrar empresa";
    if (!e || e.despacho.propia) { caja.hidden = true; return; }
    const enDespacho = e.tipo === "despacho";
    caja.className = "alta-espacio" + (enDespacho ? " alta-espacio--despacho" : "");
    caja.innerHTML = "<span>" + (enDespacho ? `Se guardará en el despacho <b>${esc(e.despacho.nombre)}</b>.` : "Se guardará en <b>Mi espacio</b> (solo tú la ves).") + "</span>" +
        (e.puede_cambiar ? ` <button type="button" data-alta-espacio="${enDespacho ? "personal" : "despacho"}">${enDespacho ? "¿Es tuya? Regístrala en Mi espacio" : "¿Es del despacho? Regístrala ahí"}</button>` : "") +
        (soloSolicitud() ? "<small>En el despacho, registrar empresas lo autoriza el titular: le mandamos una solicitud. Su e.firma la subes cuando la acepte.</small>" : "");
    caja.hidden = false;
}
async function cambiarEspacioSinAlta(clave) {
    await cambiarEspacioAlta(clave, "/clientes/");
}
async function cambiarEspacioAlta(clave, destino) {
    try {
        const r = await fetch(`${API_URL}/api/mi-perfil/espacio`, { method: "PUT", credentials: "include",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ espacio: clave }) });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        try { sessionStorage.setItem("fc-espacio-cambio", clave); } catch (x) { /* nada */ }
        location.href = destino || "/clientes/?nuevo=1";
    } catch (x) { errorAlta(x.message); }
}
let despachoRevisado = "";
async function revisarEnDespacho(rfc) {
    if (!espacioCli || espacioCli.despacho.propia || !RFC_VALIDO.test(rfc || "") || rfc === despachoRevisado) return;
    despachoRevisado = rfc;
    try {
        const r = await fetch(`${API_URL}/api/despacho/existe/${encodeURIComponent(rfc)}`, { credentials: "include" });
        if (!r.ok) return;
        const d = await r.json();
        if (rfc !== despachoRevisado || !d.existe) { if (rfc === despachoRevisado) avisoDespacho(null); return; }
        const nombre = esc(d.alias || rfc), enDespacho = espacioCli.tipo === "despacho";
        if (d.tengo_acceso && !enDespacho)
            avisoDespacho(`<b>${nombre}</b> ya está en el despacho y la tienes ahí. <button type="button" data-alta-espacio="despacho" data-sin-alta="1">Ir al despacho</button>. Si también la quieres en Mi espacio, continúa.`);
        else if (d.solicitud_pendiente)
            avisoDespacho(`<b>${nombre}</b> ya está en el despacho. Ya pediste acceso; recibirás un aviso cuando respondan.`);
        else if (!d.tengo_acceso)
            avisoDespacho(`<b>${nombre}</b> ya está en el despacho${enDespacho ? ", pero no la tienes asignada" : ""}. <button type="button" data-pedir-acceso="${esc(rfc)}">Pedir acceso</button>` +
                (enDespacho ? "" : " en lugar de duplicarla. Si de todos modos la quieres en Mi espacio, continúa."));
    } catch (x) { /* sin red: no pasa nada */ }
}
function avisoDespacho(html) {
    const caja = document.getElementById("alta-despacho-aviso");
    if (!html) { caja.hidden = true; caja.innerHTML = ""; despachoRevisado = html === null ? "" : despachoRevisado; return; }
    caja.innerHTML = html; caja.hidden = false;
}
async function pedirAccesoDespacho(rfc, boton) {
    boton.disabled = true;
    try {
        const r = await fetch(`${API_URL}/api/despacho/solicitudes`, { method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo: "acceso", rfc }) });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        const d = await r.json();
        avisoDespacho(d.estado === "aceptada" ? "Listo: ya tienes acceso. Está en el despacho." : "Listo: le avisamos al titular. Te llega un aviso cuando responda.");
    } catch (x) { boton.disabled = false; errorAlta(x.message); }
}
async function mandarSolicitudAlta(rfc, alias) {
    const r = await fetch(`${API_URL}/api/despacho/solicitudes`, { method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "alta", rfc, alias, tipo_sociedad: document.getElementById("input-tipo").value }) });
    if (!r.ok) throw new Error(await Fiscontable.leerError(r));
    cerrarModalNuevoCliente();
    mostrarAlerta("success", `Le mandamos la solicitud al titular para registrar ${alias} (${rfc}) en el despacho. Cuando la acepte aparecerá aquí; entonces sube su e.firma.`);
}
async function pasarAlDespacho(rfc) {
    const c = (clientesCache || []).find(x => x.rfc === rfc), e = espacioCli;
    if (!c || !e) return;
    const directo = e.despacho.agregar;
    const ok = await Fiscontable.confirmar({ titulo: `¿Pasar ${c.alias} al despacho «${e.despacho.nombre}»?`, si: directo ? "Pasar al despacho" : "Mandar solicitud",
        texto: directo ? "Pasa con todo su historial (XML, documentos, Buzón, facturas) y deja de estar en Mi espacio. El equipo la verá según sus permisos."
                       : "Le mandamos una solicitud al titular. Cuando la acepte, pasa con todo su historial y deja de estar en Mi espacio." });
    if (!ok) return;
    try {
        const r = await fetch(`${API_URL}/api/despacho/pasar`, { method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rfcs: [rfc] }) });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        const res = (await r.json()).resultados[0];
        if (!res.ok) throw new Error(res.motivo);
        mostrarAlerta("success", res.pasada ? `${c.alias} ya está en el despacho, con todo su historial.` : `Listo: le mandamos la solicitud al titular para pasar ${c.alias} al despacho.`);
        if (res.pasada) await cargarClientes();
    } catch (x) { mostrarAlerta("error", x.message); }
}
function cerrarModalNuevoCliente() {
    document.getElementById("modal-nuevo-cliente").classList.remove("modal-active");
    document.getElementById("form-nuevo-cliente").reset();
    const zA = document.getElementById("alta-zona-efirma"); if (zA && zA._pintar) zA._pintar();
    errorAlta("");
}

document.addEventListener("click", (e) => {
    const m = e.target.closest("[data-alta-ficha]");
    if (m) { ponerFichaAlta(m.dataset.altaFicha); return; }
    const ojo = e.target.closest("[data-ojo]");
    if (ojo) { const c = document.getElementById(ojo.dataset.ojo); c.type = c.type === "password" ? "text" : "password"; }
});
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("alta-cer").addEventListener("change", alElegirCer);
    // En cuanto corriges algo, el aviso de abajo se quita
    ["input", "change"].forEach(ev => document.getElementById("form-nuevo-cliente").addEventListener(ev, (e) => { if (e.target.id !== "alta-cer") errorAlta(""); }));
    document.getElementById("input-alias").addEventListener("input", () => rfcDesdeCer(altaCer && !altaCer.vencido ? altaCer : null));
    document.getElementById("input-alias").addEventListener("blur", (e) => {
        // Si escribieron "Constructora XYZ SA de CV", el tipo se separa automáticamente
        const sep = separarTipo(e.target.value), tipo = document.getElementById("input-tipo");
        if (sep.tipo) { tipo.value = sep.tipo; e.target.value = sep.nombre; }
    });
    document.getElementById("input-rfc").addEventListener("input", (e) => {
        const tipo = document.getElementById("input-tipo");
        if (e.target.value.trim().length === 13 && !tipo.value) tipo.value = "Persona física";
        revisarEnDespacho(e.target.value.trim().toUpperCase().replace(/[\s-]/g, ""));
    });
    document.getElementById("modal-nuevo-cliente").addEventListener("click", (e) => {
        const b = e.target.closest("[data-alta-espacio]");
        if (b) { e.preventDefault(); if (b.dataset.sinAlta) cambiarEspacioSinAlta(b.dataset.altaEspacio); else cambiarEspacioAlta(b.dataset.altaEspacio); return; }
        const p = e.target.closest("[data-pedir-acceso]");
        if (p) { e.preventDefault(); pedirAccesoDespacho(p.dataset.pedirAcceso, p); }
    });
});

function mostrarAlerta(tipo, mensaje) {
    const container = document.getElementById("alert-container");
    const alertBox = document.getElementById("alert-message");
    container.classList.remove("hidden");
    alertBox.className = tipo === "error"
        ? "p-4 rounded-lg text-sm font-semibold flex items-start gap-2 bg-amber-50 text-amber-800 border border-amber-200"
        : "p-4 rounded-lg text-sm font-semibold flex items-start gap-2 bg-green-50 text-green-700 border border-green-200";
    alertBox.innerHTML = `<span>${esc(mensaje)}</span>`;
    setTimeout(() => container.classList.add("hidden"), 4000);
}

async function interpretarError(response) {
    if (!response) return "No pudimos conectar con el servidor. Verifica tu conexión, intenta de nuevo más tarde o contacta al administrador.";
    if (response.status === 401 || response.status === 403) return "Tu sesión de acceso expiró. Recarga la página e inicia sesión de nuevo.";
    if (response.status === 409) return "Ya tienes un cliente registrado con ese RFC.";
    try {
        const data = await response.json();
        return data.detail || "Ocurrió un error inesperado.";
    } catch {
        return "Ocurrió un error inesperado.";
    }
}

async function cargarClientes() {
    try {
        const resp = await fetch(`${API_URL}/api/clientes`, { credentials: "include" });
        if (!resp.ok) {
            marcarSinConexion(await interpretarError(resp));
            return;
        }
        clientesCache = await resp.json();
        await cargarObligaciones();
        renderizarClientes();
    } catch (error) {
        marcarSinConexion();
    }
}

// Otros impuestos estatales de Quintana Roo (módulo Impuestos estatales): clave, nombre largo, nombre corto
const ESTATALES = [["ish", "Impuesto al hospedaje", "Hospedaje"], ["ish_inf", "Informativa del hospedaje", "ISH informativa"],
                   ["prof", "Ejercicio de profesiones", "Profesiones"], ["alc", "Venta de bebidas alcohólicas", "Alcohol"]];
let obligacionesEst = {};

async function cargarObligaciones() {
    if (!conIsn) { obligaciones = {}; obligacionesEst = {}; return; }
    try {
        const r = await fetch(`${API_URL}/api/isn/obligaciones`, { credentials: "include" });
        obligaciones = r.ok ? await r.json() : {};
    } catch (e) { obligaciones = {}; }
    try {
        const r = await fetch(`${API_URL}/api/estatales/obligaciones`, { credentials: "include" });
        obligacionesEst = r.ok ? await r.json() : {};
    } catch (e) { obligacionesEst = {}; }
}
function estatalesDe(rfc) { return ESTATALES.filter(([k]) => obligacionesEst[rfc] && obligacionesEst[rfc][k]); }

function tieneIsn(rfc) { const o = obligaciones[rfc]; return !!(o && o.obligacion); }

function badgeDocumento(cliente, tipo, etiqueta) {
    const doc = cliente.documentos.find(d => d.tipo === tipo);
    if (doc) {
        return `<span class="text-xs font-bold px-2 py-1 rounded-full bg-green-100 text-green-700">${etiqueta} ✓</span>`;
    }
    // Placeholder neutral -- aquí es donde en Fase 3 vivirá el
    // semáforo real (vigente / por vencer / vencido), no solo
    // "existe / no existe".
    return `<span class="text-xs font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-400">${etiqueta} —</span>`;
}

/* ---------------------------------------------------------------- buscar, filtrar y vista
   El filtro y la búsqueda quedan en la dirección (F5 / enlace), la vista (tarjetas o lista) en este navegador. */
const tieneDoc = (c, tipo) => (c.documentos || []).some(d => d.tipo === tipo);
const FILTROS = [
    ["", "Todos", () => true],
    ["sin-efirma", "Sin e.firma", c => !c.efirma_guardada],
    ["sin-ciec", "Sin contraseña SAT", c => !c.ciec_guardada],
    ["sin-constancia", "Sin constancia del mes", c => !tieneDoc(c, "csf")],
    ["sin-opinion", "Sin opinión del mes", c => !tieneDoc(c, "opinion")],
    ["con-efirma", "Con e.firma", c => !!c.efirma_guardada],
];
let filtroCli = Fiscontable.url("filtro") || "";
let busquedaCli = Fiscontable.url("q") || "";
let vistaCli = (() => { try { return localStorage.getItem("clientes:vista2") || "lista"; } catch (e) { return "lista"; } })();   // M-02: lista por defecto

function sinAcentos(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }

function clientesVisibles() {
    const f = (FILTROS.find(x => x[0] === filtroCli) || FILTROS[0])[2], q = sinAcentos(busquedaCli.trim());
    return clientesCache.filter(c => f(c) && (!q || sinAcentos(c.alias + " " + c.rfc + " " + (c.razon_social || "")).includes(q)))
        .sort((a, b) => (b.favorito ? 1 : 0) - (a.favorito ? 1 : 0));          // favoritas arriba (el resto, como vienen: por nombre)
}

/* M-02: avatar con iniciales (color estable por RFC), indicadores con ícono y tooltip, menú ⋯ con las acciones */
const TONOS_AVATAR = ["ac", "in", "ok", "av", "g"];
function avatar(c) {
    const palabras = String(c.alias || c.rfc).replace(/\b(S\.?A\.?|DE|C\.?V\.?|S\.?C\.?|R\.?L\.?|SAPI|SAS)\b/gi, " ").trim().split(/\s+/).filter(Boolean);
    const ini = ((palabras[0] || "?")[0] + ((palabras[1] || "")[0] || "")).toUpperCase();
    let h = 0; for (const ch of c.rfc) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    if (c.logo) return `<span class="cli-avatar cli-avatar--logo" data-logo="${esc(c.rfc)}" aria-hidden="true">${esc(ini)}</span>`;
    return `<span class="cli-avatar cli-avatar--${TONOS_AVATAR[h % TONOS_AVATAR.length]}" aria-hidden="true">${esc(ini)}</span>`;
}
/* Logos: se piden con la sesión (fetch) y se guardan como blob en esta página; si no carga, quedan las iniciales */
const LOGOS = new Map();
function logoDe(rfc) {
    if (!LOGOS.has(rfc)) LOGOS.set(rfc, fetch(`${API_URL}/api/clientes/${encodeURIComponent(rfc)}/logo`, { credentials: "include" })
        .then(r => r.ok ? r.blob() : null).then(b => b ? URL.createObjectURL(b) : null).catch(() => null));
    return LOGOS.get(rfc);
}
function pintarLogos(raiz) {
    (raiz || document).querySelectorAll("[data-logo]").forEach(el => {
        if (el.querySelector("img")) return;
        logoDe(el.dataset.logo).then(url => { if (url && !el.querySelector("img")) { const i = new Image(); i.alt = ""; i.src = url; el.appendChild(i); } });
    });
}
function olvidarLogo(rfc) { const p = LOGOS.get(rfc); LOGOS.delete(rfc); if (p) p.then(u => u && URL.revokeObjectURL(u)); }
function pintarLogoFicha(cliente) {
    const v = document.getElementById("editar-logo-vista");
    v.innerHTML = esc((cliente.alias || cliente.rfc).charAt(0).toUpperCase());
    v.removeAttribute("data-logo");
    if (cliente.logo) { v.dataset.logo = cliente.rfc; pintarLogos(v.parentNode); }
    document.getElementById("editar-logo-quitar").hidden = !cliente.logo;
}
async function cambiarLogo(archivo) {
    const c = clientesCache.find(x => x.rfc === rfcEnEdicion); if (!c) return;
    try {
        let r;
        if (archivo) {
            const fd = new FormData(); fd.append("logo", archivo);
            r = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(c.rfc)}/logo`, { method: "POST", credentials: "include", body: fd });
        } else {
            r = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(c.rfc)}/logo`, { method: "DELETE", credentials: "include" });
        }
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        c.logo = !!archivo;
        olvidarLogo(c.rfc);
        pintarLogoFicha(c);
        renderizarClientes();
        Fiscontable.toast(archivo ? "Logo guardado." : "Logo quitado.");
    } catch (e) { Fiscontable.toast(e.message); }
}
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("editar-logo").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) cambiarLogo(f); });
    document.getElementById("editar-logo-quitar").addEventListener("click", () => cambiarLogo(null));
});
function indicadores(c) {
    const ind = (ok, nombre, si, no) => `<span class="cli-ind ${ok ? "cli-ind--ok" : "cli-ind--falta"}" title="${esc(nombre + ": " + (ok ? si : no))}" aria-label="${esc(nombre + ": " + (ok ? si : no))}">${esc(nombre)}</span>`;
    return ind(c.efirma_guardada, "e.firma", "guardada", "falta") + ind(c.ciec_guardada, "CIEC", "guardada", "sin guardar") +
        ind(tieneDoc(c, "csf"), "CSF", "constancia del mes", "sin constancia del mes") + ind(tieneDoc(c, "opinion"), "32-D", "opinión del mes", "sin opinión del mes");
}
function obligacionesTexto(c) {
    const o = estatalesDe(c.rfc).map(([, , corto]) => corto);
    if (tieneIsn(c.rfc)) o.unshift("ISN");
    return o.join(" · ");
}
function menuAcciones(c) {
    const r = encodeURIComponent(c.rfc), a = encodeURIComponent(c.alias);
    const enlaces = [["Constancia", `/herramientas/constancias/?rfc=${r}&cliente=${a}`], ["Opinión 32-D", `/herramientas/opinion/?rfc=${r}&cliente=${a}`],
        ["Declaraciones", `/herramientas/declaraciones/?rfc=${r}&cliente=${a}`], ["Descargar XML", `/herramientas/descarga-xml/?rfc=${r}&cliente=${a}`]];
    if (tieneIsn(c.rfc)) enlaces.push(["ISN", `/herramientas/isn/?empresa=${r}`]);
    estatalesDe(c.rfc).forEach(([k, , corto]) => enlaces.push([corto, `/herramientas/isn/estatal.html?i=${k}&empresa=${r}`]));
    return `<div class="xml-menu cli-mas"><button type="button" class="ui-icono-btn" data-mas="${esc(c.rfc)}" aria-haspopup="true" aria-label="Acciones de ${esc(c.alias)}" title="Acciones">⋯</button>
        <div class="xml-menu__lista" hidden>
            ${soloLectura ? "" : `<button type="button" data-accion="editar" data-rfc="${esc(c.rfc)}">Abrir ficha</button>`}
            <button type="button" data-accion="trabajar" data-rfc="${esc(c.rfc)}">Trabajar con esta empresa</button>
            <div class="xml-separador"></div>
            ${enlaces.map(([t, h]) => `<a href="${h}">${esc(t)}</a>`).join("")}
            ${soloLectura ? "" : `<div class="xml-separador"></div>
            ${c.efirma_guardada ? `<button type="button" data-accion="olvidar" data-rfc="${esc(c.rfc)}">Olvidar la e.firma</button>` : ""}
            ${espacioCli && espacioCli.tipo === "personal" ? `<button type="button" data-accion="pasar" data-rfc="${esc(c.rfc)}">Pasar al despacho</button>` : ""}
            <button type="button" data-accion="quitar" data-rfc="${esc(c.rfc)}" class="xml-peligro">Quitar del directorio</button>`}
        </div></div>`;
}
function estrella(c) {
    return `<button type="button" class="cli-estrella${c.favorito ? " cli-estrella--si" : ""}" data-estrella="${esc(c.rfc)}" aria-pressed="${!!c.favorito}" title="${c.favorito ? "Quitar de favoritas" : "Marcar como favorita"}">★</button>`;
}
async function alternarFavorita(rfc) {
    const c = clientesCache.find(x => x.rfc === rfc); if (!c) return;
    try {
        const r = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(rfc)}/favorito`, { method: "PUT", credentials: "include",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ favorito: !c.favorito }) });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        c.favorito = !c.favorito; renderizarClientes();
        window.dispatchEvent(new CustomEvent("fiscontable:favoritos"));
    } catch (e) { mostrarAlerta("error", e.message); }
}
document.addEventListener("click", async e => {
    const est = e.target.closest("[data-estrella]");
    if (est) { e.stopPropagation(); alternarFavorita(est.dataset.estrella); return; }
    const mas = e.target.closest("[data-mas]");
    document.querySelectorAll(".cli-mas .xml-menu__lista").forEach(m => { if (!mas || m.parentNode !== mas.parentNode) m.hidden = true; });
    if (mas) { e.stopPropagation(); const m = mas.parentNode.querySelector(".xml-menu__lista"); m.hidden = !m.hidden; return; }
    const acc = e.target.closest(".cli-mas [data-accion]");
    if (acc) {
        e.stopPropagation();
        const rfc = acc.dataset.rfc;
        if (acc.dataset.accion === "editar") abrirModalEditar(rfc);
        else if (acc.dataset.accion === "olvidar") olvidarEfirma(rfc);
        else if (acc.dataset.accion === "quitar") eliminarCliente(rfc);
        else if (acc.dataset.accion === "pasar") pasarAlDespacho(rfc);
        else if (acc.dataset.accion === "trabajar") { try { await Fiscontable.elegirEmpresa(rfc); Fiscontable.toast("Trabajando con " + rfc + "."); } catch (x) { mostrarAlerta("error", x.message); } }
        return;
    }
    const tarjeta = e.target.closest("[data-ficha]");
    if (tarjeta && !e.target.closest("a,button") && !soloLectura) abrirModalEditar(tarjeta.dataset.ficha);
});

function pintarHerramientas() {
    const caja = document.getElementById("cli-herramientas");
    caja.hidden = clientesCache.length === 0;
    document.getElementById("cli-filtros").innerHTML = FILTROS.map(([clave, texto, fn]) =>
        `<button type="button" class="cli-filtro${clave === filtroCli ? " cli-filtro--activo" : ""}" data-filtro="${clave}">${esc(texto)}<b>${clientesCache.filter(fn).length}</b></button>`).join("");
    document.querySelectorAll("[data-vista]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.vista === vistaCli)));
    const buscar = document.getElementById("cli-buscar");
    if (buscar.value !== busquedaCli) buscar.value = busquedaCli;
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("cli-filtros").addEventListener("click", e => {
        const b = e.target.closest("[data-filtro]"); if (!b) return;
        filtroCli = b.dataset.filtro; Fiscontable.url({ filtro: filtroCli || null }); renderizarClientes();
    });
    document.querySelector(".cli-vista").addEventListener("click", e => {
        const b = e.target.closest("[data-vista]"); if (!b) return;
        vistaCli = b.dataset.vista;
        try { localStorage.setItem("clientes:vista2", vistaCli); } catch (err) { /* sin almacenamiento */ }
        renderizarClientes();
    });
    // «Sacar de los que ves»: lleva a Constancia u Opinión, pestaña Masivo, con esos clientes ya marcados
    const varios = document.getElementById("cli-varios");
    varios.addEventListener("click", e => {
        e.stopPropagation();
        const lista = varios.querySelector(".xml-menu__lista");
        if (e.target.closest("[data-varios]")) {
            const con = clientesVisibles().filter(c => c.efirma_guardada), sin = clientesVisibles().length - con.length;
            document.getElementById("cli-varios-nota").textContent = con.length
                ? `${con.length} con e.firma guardada${sin ? ` (${sin} sin e.firma no entran)` : ""}.` : "Ninguno de los que ves tiene e.firma guardada.";
            varios.querySelectorAll("[data-varios-ir]").forEach(b => { b.disabled = !con.length; });
            lista.hidden = !lista.hidden;
            return;
        }
        const ir = e.target.closest("[data-varios-ir]"); if (!ir) return;
        const rfcs = clientesVisibles().filter(c => c.efirma_guardada).map(c => c.rfc);
        if (rfcs.length) location.href = `/herramientas/${ir.dataset.variosIr}/?modo=masivo&rfcs=${encodeURIComponent(rfcs.join(","))}`;
    });
    document.addEventListener("click", () => { varios.querySelector(".xml-menu__lista").hidden = true; });
    document.getElementById("cli-buscar").addEventListener("input", e => {
        busquedaCli = e.target.value; Fiscontable.url({ q: busquedaCli.trim() || null }); renderizarClientes();
    });
});

function filaLista(c) {
    const ob = obligacionesTexto(c);
    return `<tr data-ficha="${esc(c.rfc)}" tabindex="0">
        <td class="cli-celda-nombre">${estrella(c)}${avatar(c)}<span class="cli-nombre"><b title="${esc(c.alias)}">${esc(c.alias)}</b><small class="cli-rfc">${esc(c.rfc)}${c.tipo_sociedad ? " · " + esc(c.tipo_sociedad) : ""}</small></span></td>
        <td><span class="cli-inds">${indicadores(c)}</span></td>
        <td class="cli-obl">${esc(ob)}</td>
        <td class="cli-celda-mas">${!c.efirma_guardada && puedeGuardarEfirma && !soloLectura ? `<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-rfc="${esc(c.rfc)}" onclick="event.stopPropagation();abrirModalEditar(this.dataset.rfc, 'accesos')">Subir e.firma</button>` : ""}${menuAcciones(c)}</td></tr>`;
}

function renderizarClientes() {
    const contenedor = document.getElementById("lista-clientes");
    const estadoVacio = document.getElementById("estado-vacio");
    const sinRes = document.getElementById("cli-sin-resultados");

    pintarHerramientas();
    if (clientesCache.length === 0) {
        contenedor.innerHTML = "";
        sinRes.hidden = true;
        estadoVacio.classList.remove("hidden");
        return;
    }
    estadoVacio.classList.add("hidden");

    const visibles = clientesVisibles();
    sinRes.hidden = visibles.length > 0;
    if (!visibles.length) {
        const f = FILTROS.find(x => x[0] === filtroCli);
        sinRes.textContent = busquedaCli.trim() ? "Ninguna empresa coincide con la búsqueda." : `Ninguna empresa en «${f ? f[1] : ""}». ✓`;
    }
    if (vistaCli === "lista") {
        contenedor.className = "";
        contenedor.innerHTML = visibles.length ? `<table class="cli-tabla"><thead><tr><th>Empresa</th><th>Accesos y documentos</th><th>Obligaciones</th><th></th></tr></thead>
            <tbody>${visibles.map(filaLista).join("")}</tbody></table>` : "";
        pintarLogos(contenedor);
        return;
    }
    // Tarjetas compactas: sin botones; clic abre la ficha y las acciones van en ⋯
    contenedor.className = "cli-tarjetas";
    contenedor.innerHTML = visibles.map(c => `<div class="cli-tarjeta" data-ficha="${esc(c.rfc)}" tabindex="0">
        <div class="cli-tarjeta__cabeza">${avatar(c)}<span class="cli-nombre"><b title="${esc(c.alias)}">${esc(c.alias)}</b><small class="cli-rfc">${esc(c.rfc)}</small></span>${estrella(c)}${menuAcciones(c)}</div>
        <span class="cli-inds">${indicadores(c)}</span>
        ${obligacionesTexto(c) ? `<small class="cli-obl">${esc(obligacionesTexto(c))}</small>` : ""}
    </div>`).join("");
    pintarLogos(contenedor);
}

const RFC_VALIDO = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

async function crearCliente(e) {
    e.preventDefault();
    errorAlta("");
    const alias = document.getElementById("input-alias").value.trim();
    const datos = new FormData();
    let rfc = "";
    // Lo que se puede revisar aquí se revisa aquí: el aviso sale abajo y te lleva a la pestaña donde se arregla
    const aviso = (pestana, texto, campo) => { ponerFichaAlta(pestana); errorAlta(texto); if (campo) document.getElementById(campo).focus(); };
    const cer = document.getElementById("alta-cer").files[0];
    const conEfirma = !!cer;
    if (conEfirma) {
        const key = document.getElementById("alta-key").files[0];
        const password = document.getElementById("alta-password").value;
        if (!altaCer) return aviso("accesos", "Ese archivo no es un certificado (.cer) válido. Quítalo o elige el correcto.");
        if (altaCer.vencido) return aviso("accesos", "Esa e.firma ya venció. Quítala y regístrala solo con el RFC; sube la nueva cuando la renueven.");
        if (!key) return aviso("accesos", "Falta la clave privada (.key) de la e.firma.");
        if (!/\.key$/i.test(key.name)) return aviso("accesos", "La clave privada debe ser el archivo .key (elegiste " + key.name + ").");
        if (!password) return aviso("accesos", "Falta la contraseña de la e.firma.", "alta-password");
        rfc = altaCer.rfc;
        datos.append("cer", cer); datos.append("key", key); datos.append("password", password);
    } else {
        rfc = document.getElementById("input-rfc").value.trim().toUpperCase().replace(/[\s-]/g, "");
        if (!rfc) return aviso("general", "Escribe su RFC, o sube su e.firma en Accesos y se obtiene automáticamente.", "input-rfc");
        if (!RFC_VALIDO.test(rfc)) return aviso("general", "Ese RFC no tiene la forma correcta: 12 caracteres para empresas (ABC010101AB1) o 13 para personas físicas.", "input-rfc");
        datos.append("rfc", rfc);
    }
    if (!alias) return aviso("general", "Escribe el nombre de la empresa (como la quieres ver en el sistema).", "input-alias");
    if ((clientesCache || []).some(c => c.rfc === rfc)) return aviso("general", `Ya tienes registrada esa empresa (${rfc}).`);
    if (soloSolicitud()) {
        try { await mandarSolicitudAlta(rfc, alias); } catch (x) { aviso("general", x.message); }
        return;
    }
    const fac = datosFacturarAlta();
    if (fac.error) return aviso("facturar", fac.error, fac.campo);
    datos.append("nombre", alias);
    datos.append("tipo_sociedad", document.getElementById("input-tipo").value);
    const ciec = (document.getElementById("alta-ciec") || {}).value || "";
    if (ciec.trim()) datos.append("ciec", ciec.trim());

    const boton = document.getElementById("btn-guardar-cliente");
    const originalTexto = boton.textContent;
    boton.disabled = true;
    boton.textContent = conEfirma ? "Revisando la e.firma…" : "Registrando…";

    try {
        const resp = await fetch(`${API_URL}/api/clientes/registrar`, { method: "POST", credentials: "include", body: datos });
        if (!resp.ok) {
            const msg = await interpretarError(resp);
            ponerFichaAlta(/e\.firma|\.key|\.cer|certificado|contraseña/i.test(msg) ? "accesos" : "general");
            errorAlta(msg);
            return;
        }
        const r = await resp.json();
        rfc = r.rfc;
        // Obligaciones marcadas en el alta
        let extra = "";
        if (conIsn && document.getElementById("nuevo-obl-isn").checked) {
            const r = await fetch(`${API_URL}/api/isn/obligacion`, {
                method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rfc, activa: true, zona: document.getElementById("nuevo-obl-zona").value, nombre: alias })
            });
            extra = r.ok ? " Con ISN Quintana Roo: llena sus datos o sube su último acuse desde su ficha."
                         : " No se pudo guardar la obligación de ISN: márcala desde su ficha.";
        }
        const est = conIsn ? Array.from(document.querySelectorAll("[data-nuevo-est]:checked")).map(c => c.dataset.nuevoEst) : [];
        let fallaron = 0;
        for (const k of est) {
            try {
                const re = await fetch(`${API_URL}/api/estatales/${k}/obligacion`, {
                    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rfcs: [rfc], activa: true })
                });
                if (!re.ok) fallaron++;
            } catch (err) { fallaron++; }
        }
        if (est.length) extra += fallaron ? " No se pudieron guardar todas sus obligaciones estatales: márcalas desde su ficha."
                                          : " Con " + est.map(k => ESTATALES.find(x => x[0] === k)[2].toLowerCase()).join(", ") + ": sube su último acuse desde su ficha y se llenan sus datos.";
        if (fac.hay) extra += await guardarFacturarAlta(rfc, fac);
        cerrarModalNuevoCliente();
        const partes = [`${alias} quedó registrada (${rfc})`];
        if (r.efirma_guardada) partes.push("con su e.firma guardada");
        if (r.ciec_guardada) partes.push("y su contraseña del SAT");
        mostrarAlerta("success", partes.join(" ") + "." + (r.avisos && r.avisos.length ? " " + r.avisos.join(" ") : "") + extra);
        await cargarClientes();
        // Si no había empresa activa, la recién registrada queda como activa
        try { const p = await Fiscontable.perfil(); if (p && !p.empresa_activa) await Fiscontable.elegirEmpresa(rfc); } catch (err) { /* no pasa nada */ }
        // Se queda abierta su ficha para seguir configurándola (accesos, obligaciones, XML automáticos, facturación)
        abrirModalEditar(rfc, "general");
    } catch (error) {
        mostrarAlerta("error", await interpretarError(null));
    } finally {
        boton.disabled = false;
        boton.textContent = originalTexto;
    }
}

/* Pestaña «Facturar» del alta: régimen, C.P., sello digital y manifiesto. Todo opcional; se guarda después de
   registrar la empresa con los mismos servicios que Facturar (que revisan el sello y el PDF). */
async function cargarFactCfg() {
    if (factCfg) return factCfg;
    const r = await fetch(`${API_URL}/api/facturacion/config`, { credentials: "include" });
    if (!r.ok) throw new Error(await Fiscontable.leerError(r));
    factCfg = await r.json();
    return factCfg;
}

async function llenarRegimenesAlta() {
    const sel = document.getElementById("alta-regimen");
    if (sel.options.length > 1) return;
    try {
        const reg = (await cargarFactCfg()).catalogos.regimenes;
        sel.innerHTML = '<option value="">Elige…</option>' + Object.keys(reg).map(k => `<option value="${esc(k)}">${esc(k + " · " + reg[k])}</option>`).join("");
    } catch (e) { /* sin catálogo: se llena en Facturar */ }
}

function datosFacturarAlta() {
    if (document.getElementById("alta-tab-facturar").hidden) return { hay: false };
    const v = id => document.getElementById(id);
    const d = { regimen: v("alta-regimen").value, cp: v("alta-cp").value.trim(), cer: v("alta-csd-cer").files[0],
                key: v("alta-csd-key").files[0], pass: v("alta-csd-pass").value, pdf: v("alta-man-pdf").files[0] };
    if (d.cp && !/^\d{5}$/.test(d.cp)) return { error: "El código postal son 5 dígitos (el de su constancia de situación fiscal).", campo: "alta-cp" };
    const algoDelSello = d.cer || d.key || d.pass;
    if (algoDelSello && (!d.cer || !d.key || !d.pass)) return { error: "Para el sello digital elige el .cer, el .key y escribe su contraseña (o déjalo vacío y súbelo después).", campo: d.pass ? null : "alta-csd-pass" };
    if (d.cer && !/\.cer$/i.test(d.cer.name)) return { error: "El certificado del sello debe ser un archivo .cer." };
    if (d.key && !/\.key$/i.test(d.key.name)) return { error: "La llave del sello debe ser un archivo .key." };
    d.hay = !!(d.regimen || d.cp || algoDelSello || d.pdf);
    return d;
}

async function guardarFacturarAlta(rfc, d) {
    const fallas = [], hecho = [];
    const pedir = async (ruta, opciones) => {
        const r = await fetch(`${API_URL}${ruta}`, Object.assign({ credentials: "include" }, opciones));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    };
    const base = `/api/facturacion/emisores/${encodeURIComponent(rfc)}`;
    if (d.regimen || d.cp) {
        try { await pedir(base, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ regimen: d.regimen || null, cp: d.cp || null }) }); hecho.push("régimen y C.P."); }
        catch (e) { fallas.push("régimen y C.P.: " + e.message); }
    }
    if (d.cer) {
        const c = new FormData(); c.append("cer", d.cer); c.append("key", d.key); c.append("password", d.pass);
        try { await pedir(base + "/csd", { method: "POST", body: c }); hecho.push("sello digital"); }
        catch (e) { fallas.push("sello digital: " + e.message); }
    }
    if (d.pdf) {
        const c = new FormData(); c.append("pac", "lunasoft"); c.append("pdf", d.pdf);
        try { await pedir(`/api/facturacion/manifiesto/${encodeURIComponent(rfc)}`, { method: "POST", body: c }); hecho.push("manifiesto"); }
        catch (e) { fallas.push("manifiesto: " + e.message); }
    }
    factCfg = null;                              // que Facturar y la ficha vuelvan a leer cómo quedó
    return (hecho.length ? " Para facturar quedó guardado: " + hecho.join(", ") + "." : "") +
           (fallas.length ? " No se guardó — " + fallas.join(" · ") + " Corrígelo en su ficha → Accesos." : "");
}

/* Manifiesto en la ficha (Accesos) */
async function pintarManifiestoFicha(cliente) {
    const caja = document.getElementById("editar-man");
    caja.hidden = !conFacturar || !puedeGuardarEfirma;
    if (caja.hidden) return;
    document.getElementById("man-pdf").value = "";
    document.getElementById("editar-mensaje-man").classList.add("hidden");
    const badge = document.getElementById("editar-estado-man");
    badge.textContent = "Revisando…";
    badge.className = "text-xs font-bold px-2 py-1 rounded-full flex-none bg-gray-100 text-gray-500";
    let m;
    try {
        const r = await fetch(`${API_URL}/api/facturacion/manifiesto/${encodeURIComponent(cliente.rfc)}`, { credentials: "include" });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        m = await r.json();
    } catch (e) { badge.textContent = ""; mensajeMan(false, e.message); return; }
    if (rfcEnEdicion !== cliente.rfc) return;
    const g = (m.pacs[0] || {}).guardado;
    badge.textContent = g ? "Firmado" : "Falta";
    badge.className = "text-xs font-bold px-2 py-1 rounded-full flex-none " + (g ? "bg-violet-100 text-violet-700" : "bg-amber-100 text-amber-800");
    const t = document.getElementById("man-guardado-texto");
    t.classList.toggle("hidden", !g);
    t.textContent = g ? "✓ " + [g.folio, g.firmado_en ? "firmado el " + fechaCorta(g.firmado_en) : "", g.revision && g.revision.nombre ? "por " + g.revision.nombre : ""].filter(Boolean).join(" · ") : "";
    document.getElementById("man-etiqueta").textContent = g ? "Reemplazar con otro PDF" : "PDF del manifiesto";
}

function mensajeMan(ok, texto) {
    const p = document.getElementById("editar-mensaje-man");
    p.textContent = texto; p.className = "text-xs mt-2 font-semibold " + (ok ? "text-emerald-700" : "text-red-600");
}

async function subirManifiestoFicha() {
    const rfc = rfcEnEdicion, pdf = document.getElementById("man-pdf").files[0];
    if (!rfc) return;
    if (!pdf) { mensajeMan(false, "Elige el PDF que descargaste de Luna Soft al firmar."); return; }
    const b = document.getElementById("btn-subir-man");
    b.disabled = true; b.textContent = "Revisando…";
    try {
        const c = new FormData(); c.append("pac", "lunasoft"); c.append("pdf", pdf);
        const r = await fetch(`${API_URL}/api/facturacion/manifiesto/${encodeURIComponent(rfc)}`, { method: "POST", credentials: "include", body: c });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        const d = await r.json();
        factCfg = null;
        await pintarManifiestoFicha(clientesCache.find(c => c.rfc === rfc) || { rfc });
        mensajeMan(true, "✓ Manifiesto revisado y guardado" + (d.revision && d.revision.folio ? " (" + d.revision.folio + ")" : "") + ". Ya puede timbrar.");
    } catch (e) { mensajeMan(false, e.message); }
    b.disabled = false; b.textContent = "Subir y revisar";
}

let rfcEnEdicion = null;

/* ---------------------------------------------------------------- ficha del cliente (pestañas)
   Datos generales · Accesos (e.firma y contraseña del SAT) · Obligaciones. ?editar=RFC&ficha=accesos abre directo. */
let fichaActual = "general";
const FICHAS = ["general", "accesos", "receptores", "xml", "obligaciones"];
function ponerFicha(nombre) {
    if (FICHAS.indexOf(nombre) === -1) nombre = "general";
    if (nombre === "obligaciones" && document.getElementById("tab-obligaciones").hidden) nombre = "general";
    if (nombre === "xml" && document.getElementById("tab-xml").hidden) nombre = "general";
    if (nombre === "receptores" && document.getElementById("tab-receptores").hidden) nombre = "general";
    fichaActual = nombre;
    document.querySelectorAll(".ficha-tabs [data-ficha]").forEach(b => {
        const si = b.dataset.ficha === nombre;
        b.setAttribute("aria-selected", String(si)); b.tabIndex = si ? 0 : -1;
    });
    document.querySelectorAll("#modal-editar-cliente [data-panel]").forEach(p => { p.hidden = p.dataset.panel !== nombre; });
}

function pintarEfirmaFicha(cliente, conservarMensaje) {
    const badge = document.getElementById("editar-estado-efirma");
    const guardada = !!cliente.efirma_guardada;
    badge.textContent = !puedeGuardarEfirma ? "No disponible en la prueba" : guardada ? "Guardada" : "No guardada";
    badge.className = "text-xs font-bold px-2 py-1 rounded-full flex-none " + (guardada ? "bg-violet-100 text-violet-700" : "bg-gray-100 text-gray-500");
    // Guardada: solo su estado y «Reemplazar»; el formulario aparece al pedirlo
    const cuando = cliente.efirma_guardada_en ? new Date(cliente.efirma_guardada_en + "Z").toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "";
    document.getElementById("efirma-guardada").hidden = !guardada || !puedeGuardarEfirma;
    document.getElementById("efirma-guardada-texto").textContent = "✓ Lista para los trámites" + (cuando ? " · guardada el " + cuando : "");
    document.getElementById("editar-efirma-form").classList.toggle("hidden", guardada || !puedeGuardarEfirma);
    document.getElementById("btn-olvidar-efirma").classList.toggle("hidden", !guardada);
    document.getElementById("btn-guardar-efirma").textContent = guardada ? "Guardar la nueva e.firma" : "Guardar e.firma";
    if (!conservarMensaje) ocultarMensajeEfirma();
}

function pintarResumenFicha(cliente) {
    const r = encodeURIComponent(cliente.rfc);
    const chip = (ok, si, no, accion) => `<button type="button" class="ficha-chip ${ok ? "ficha-chip--ok" : "ficha-chip--falta"}" ${accion}>${ok ? "✓ " + si : no}</button>`;
    document.getElementById("editar-resumen").innerHTML =
        chip(cliente.efirma_guardada, "e.firma", "Falta su e.firma", 'data-ir-ficha="accesos"') +
        chip(cliente.ciec_guardada, "Contraseña SAT", "Sin contraseña SAT", 'data-ir-ficha="accesos"') +
        chip(tieneDoc(cliente, "csf"), "Constancia del mes", "Sin constancia del mes", `onclick="location.href='/herramientas/constancias/?rfc=${r}'"`) +
        chip(tieneDoc(cliente, "opinion"), "Opinión del mes", "Sin opinión del mes", `onclick="location.href='/herramientas/opinion/?rfc=${r}'"`);
    document.getElementById("ficha-aviso-accesos").hidden = !!cliente.efirma_guardada || !puedeGuardarEfirma;
}

// «Leer de su constancia» del domicilio: la constancia guardada (o la del SAT si no hay) da domicilio, régimen y obligaciones
document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-leer-domicilio]"); if (!b) return;
    const rfc = rfcEnEdicion, caja = document.getElementById("editar-dato-domicilio");
    b.disabled = true; b.textContent = "Leyendo…";
    try {
        const r = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(rfc)}/obligaciones-fed`, { method: "POST", credentials: "include", body: new FormData() });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        await cargarClientes();
        const c = clientesCache.find(x => x.rfc === rfc); if (c && rfcEnEdicion === rfc) { pintarDatosFiscales(c); pintarObligaciones(c); }
    } catch (x) { caja.textContent = x.message; }
});

/* Sucursales (lugares de expedición): C.P. desde los que factura. La predeterminada (★) es la que propone Facturar. */
let sucDatos = null;
async function sucApi(ruta, metodo) {
    const r = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(rfcEnEdicion)}/sucursales${ruta || ""}`, { method: metodo || "GET", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: metodo === "PUT" ? JSON.stringify(sucApi.cuerpo) : undefined });
    if (!r.ok) throw new Error(await Fiscontable.leerError(r));
    return r.json();
}
function sucMensaje(texto, mal) {
    const m = document.getElementById("suc-msj");
    m.hidden = !texto; m.textContent = texto || ""; m.className = "text-xs " + (mal ? "text-red-600 font-semibold" : "text-slate-500");
}
function pintarSucursales(d) {
    sucDatos = d;
    const pred = d.predeterminado, fila = (cp, nombre, esFiscal) =>
        `<li class="suc-fila"><button type="button" class="suc-estrella${pred === cp ? " suc-estrella--si" : ""}" data-suc-pred="${esFiscal ? "fiscal" : esc(cp)}" title="${pred === cp ? "Predeterminada" : "Usar como predeterminada"}" aria-pressed="${pred === cp}">★</button>` +
        `<b>${esc(cp)}</b><span>${esc(nombre)}</span>` + (esFiscal ? "" : `<button type="button" class="suc-quitar" data-suc-quitar="${esc(cp)}" aria-label="Quitar">✕</button>`) + "</li>";
    document.getElementById("suc-lista").innerHTML =
        (d.cp_fiscal ? fila(d.cp_fiscal, "Domicilio fiscal", true) : '<li class="suc-fila"><span>Sin C.P. fiscal: se toma de su constancia.</span></li>') +
        d.sucursales.filter(x => x.cp !== d.cp_fiscal).map(x => fila(x.cp, x.nombre || "Sucursal", false)).join("");
}
async function cargarSucursales(rfc) {
    document.getElementById("suc-propuestas").hidden = true; sucMensaje("");
    document.getElementById("suc-lista").innerHTML = "";
    try { const d = await sucApi(); if (rfcEnEdicion === rfc) pintarSucursales(d); } catch (e) { sucMensaje(e.message, true); }
}
async function agregarSucursal(cp, nombre) {
    sucApi.cuerpo = { cp, nombre };
    pintarSucursales(await sucApi("", "PUT"));
}
document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("suc-form"); if (!form) return;
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const cp = document.getElementById("suc-cp").value.trim(), nombre = document.getElementById("suc-nombre").value.trim();
        if (!/^\d{5}$/.test(cp)) return sucMensaje("El código postal debe tener 5 dígitos.", true);
        try { await agregarSucursal(cp, nombre); form.reset(); sucMensaje(""); } catch (x) { sucMensaje(x.message, true); }
    });
    document.getElementById("suc-lista").addEventListener("click", async (e) => {
        const p = e.target.closest("[data-suc-pred]"), q = e.target.closest("[data-suc-quitar]");
        try {
            if (p) pintarSucursales(await sucApi("/" + encodeURIComponent(p.dataset.sucPred) + "/predeterminada", "POST"));
            if (q) pintarSucursales(await sucApi("/" + encodeURIComponent(q.dataset.sucQuitar), "DELETE"));
        } catch (x) { sucMensaje(x.message, true); }
    });
    document.getElementById("suc-xml").addEventListener("click", async () => {
        const caja = document.getElementById("suc-propuestas");
        sucMensaje("Leyendo sus XML emitidos…");
        try {
            const d = await sucApi("/desde-xml");
            const nuevas = d.lugares.filter(x => !x.registrada && !x.fiscal);
            sucMensaje(d.lugares.length ? "" : `Sin XML emitidos en ${d.anio}.`);
            caja.hidden = !nuevas.length;
            caja.innerHTML = nuevas.length ? nuevas.map(x => `<button type="button" class="suc-propuesta" data-suc-cp="${esc(x.cp)}">+ ${esc(x.cp)} <small>${x.xml.toLocaleString("es-MX")} XML</small></button>`).join("") : "";
            if (d.lugares.length && !nuevas.length) sucMensaje(`Los C.P. de sus XML de ${d.anio} ya están registrados.`);
        } catch (x) { sucMensaje(x.message, true); }
    });
    document.getElementById("suc-propuestas").addEventListener("click", async (e) => {
        const b = e.target.closest("[data-suc-cp]"); if (!b) return;
        try { await agregarSucursal(b.dataset.sucCp, ""); b.remove(); if (!document.querySelector("#suc-propuestas [data-suc-cp]")) document.getElementById("suc-propuestas").hidden = true; }
        catch (x) { sucMensaje(x.message, true); }
    });
});

/* Domicilio fiscal y régimen: salen de su constancia de situación fiscal (cada vez que se sube o se descarga una) */
function pintarDatosFiscales(cliente) {
    const dom = cliente.domicilio, regs = cliente.regimenes || [];
    document.getElementById("editar-dato-regimen").textContent = regs.length ? regs.join(", ") : "—";
    const caja = document.getElementById("editar-dato-domicilio");
    if (dom && (dom.calle || dom.colonia || dom.municipio)) {
        const linea1 = [dom.calle, dom.num_ext && "No. " + dom.num_ext, dom.num_int && "Int. " + dom.num_int].filter(Boolean).join(" ");
        const linea2 = [dom.colonia && "Col. " + dom.colonia, dom.localidad && dom.localidad !== dom.municipio ? dom.localidad : ""].filter(Boolean).join(", ");
        const linea3 = [dom.municipio, dom.estado, dom.cp && "C.P. " + dom.cp].filter(Boolean).join(", ");
        caja.textContent = [linea1, linea2, linea3].filter(Boolean).join("\n");
        caja.style.whiteSpace = "pre-line";
    } else {
        caja.innerHTML = (dom && dom.cp ? "C.P. " + esc(dom.cp) + " · " : "") +
            '<button type="button" class="underline font-semibold text-emerald-700" data-leer-domicilio>Leer de su constancia</button>';
        caja.style.whiteSpace = "";
    }
}

function abrirModalEditar(rfc, ficha) {
    if (sinConexion || soloLectura) return;
    const cliente = clientesCache.find(c => c.rfc === rfc);
    if (!cliente) return;

    rfcEnEdicion = rfc;
    document.getElementById("editar-titulo").textContent = cliente.alias;
    document.getElementById("editar-inicial").textContent = (cliente.alias || rfc).charAt(0).toUpperCase();
    pintarLogoFicha(cliente);
    document.getElementById("editar-rfc").textContent = rfc + (cliente.tipo_sociedad ? " · " + cliente.tipo_sociedad : "");
    document.getElementById("editar-alias").value = cliente.alias;
    // Sin tipo y con RFC de 13 caracteres: casi seguro es persona física (se propone; se guarda con «Guardar»)
    document.getElementById("editar-tipo").value = cliente.tipo_sociedad || (rfc.length === 13 ? "Persona física" : "");
    document.getElementById("editar-correo").value = cliente.correo_cliente || "";
    document.getElementById("editar-dato-rfc").textContent = rfc;
    document.getElementById("editar-dato-razon").textContent = cliente.razon_social || cliente.alias;
    pintarDatosFiscales(cliente);
    cargarSucursales(cliente.rfc);
    document.getElementById("editar-dato-alta").textContent = cliente.creado_en ? new Date(cliente.creado_en + "Z").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : "—";
    pintarCiec(cliente);
    pintarCsd(cliente);
    pintarManifiestoFicha(cliente);
    pintarReceptores(cliente);
    document.getElementById("editar-cer").value = "";
    document.getElementById("editar-key").value = "";
    document.getElementById("editar-password").value = "";
    const zE = document.getElementById("editar-zona-efirma"); if (zE && zE._pintar) zE._pintar();
    pintarEfirmaFicha(cliente);
    pintarResumenFicha(cliente);
    pintarObligaciones(cliente);
    pintarXmlAuto(cliente);
    ponerFicha(ficha || "general");
    document.getElementById("modal-editar-cliente").classList.add("modal-active");
}

document.addEventListener("click", (e) => {
    // Solo las pestañas de la ficha (las filas y tarjetas de clientes también llevan data-ficha, con su RFC)
    const t = e.target.closest(".ficha-tabs [data-ficha]");
    if (t) { ponerFicha(t.dataset.ficha); return; }
    const ir = e.target.closest("[data-ir-ficha]");
    if (ir) { ponerFicha(ir.dataset.irFicha); return; }
    if (e.target.closest("#btn-reemplazar-efirma")) {
        document.getElementById("efirma-guardada").hidden = true;
        document.getElementById("editar-efirma-form").classList.remove("hidden");
        document.getElementById("editar-cer").focus();
        return;
    }
    if (e.target.closest("#btn-reemplazar-csd")) {
        document.getElementById("csd-guardado").classList.add("hidden");
        document.getElementById("csd-form").classList.remove("hidden");
        document.getElementById("csd-cer").focus();
        return;
    }
    const irFacturar = e.target.closest("#csd-ir-facturar");
    if (irFacturar && rfcEnEdicion) {
        // Facturar trabaja con la empresa del selector de arriba: primero se elige esta
        e.preventDefault();
        const destino = irFacturar.href;
        Promise.resolve(Fiscontable.elegirEmpresa && Fiscontable.elegirEmpresa(rfcEnEdicion)).finally(() => { location.href = destino; });
        return;
    }
    if (e.target.closest("#btn-quitar-cliente") && rfcEnEdicion) {
        const rfc = rfcEnEdicion;
        cerrarModalEditar();
        eliminarCliente(rfc);
    }
});

/* Descarga automática de sus XML: desde qué mes, qué y cada cuánto. El mes más antiguo lo fija el admin. */
const fechaCorta = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
async function pintarXmlAuto(cliente) {
    document.getElementById("tab-xml").hidden = !conXml;
    if (!conXml) return;
    document.getElementById("xml-mensaje").classList.add("hidden");
    try {
        const r = await fetch(`${API_URL}/api/descarga-xml/automatica`, { credentials: "include" });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        xmlAuto = await r.json();
    } catch (e) {
        document.getElementById("xml-explica").textContent = e.message;
        return;
    }
    if (rfcEnEdicion !== cliente.rfc) return;
    const cfg = xmlAuto.empresas.find(x => x.rfc === cliente.rfc) || { activo: false, tipo: "ambos", frecuencia: "diaria" };
    const opciones = (mapa, actual) => Object.keys(mapa).map(k => `<option value="${k}"${k === actual ? " selected" : ""}>${esc(mapa[k])}</option>`).join("");
    document.getElementById("xml-tipo").innerHTML = opciones(xmlAuto.tipos, cfg.tipo);
    document.getElementById("xml-frecuencia").innerHTML = opciones(xmlAuto.frecuencias, cfg.frecuencia);
    document.getElementById("xml-desde").innerHTML = Fiscontable.opcionesDesde(xmlAuto.desde_minimo, xmlAuto.mes_actual, cfg.desde || "");
    document.getElementById("xml-correo").innerHTML = opciones(xmlAuto.correo || { "": "No" }, cfg.correo || "");
    document.getElementById("xml-correo-nota").textContent = cliente.correo_cliente
        ? "Un enlace seguro con sus XML y PDF del periodo, a " + cliente.correo_cliente + "."
        : "Primero escribe su correo en Datos generales.";
    document.getElementById("xml-correo").disabled = !cliente.correo_cliente && !cfg.correo;
    document.getElementById("xml-activo").checked = !!cfg.activo && !!cliente.efirma_guardada;
    document.getElementById("xml-activo").disabled = !cliente.efirma_guardada;
    document.getElementById("xml-sin-efirma").hidden = !!cliente.efirma_guardada;
    explicarXmlAuto(cfg);
}

function explicarXmlAuto(cfg) {
    const p = document.getElementById("xml-explica");
    if (!cfg || !cfg.activo) {
        p.textContent = "Inactiva. Al activarla, elige desde qué mes: la primera vez descarga todo desde ahí hasta ayer y después sigue al día.";
        return;
    }
    const partes = [];
    if (cfg.proxima && cfg.periodo) partes.push(`Próxima: ${fechaCorta(cfg.proxima)}, del ${fechaCorta(cfg.periodo.desde)} al ${fechaCorta(cfg.periodo.hasta)}.`);
    if (cfg.falta_historico) partes.push(`Esa vez descarga todo desde ${Fiscontable.nombreMes(cfg.desde).toLowerCase()}; después, solo lo reciente.`);
    else if (cfg.desde) partes.push(`Ya está bajado desde ${Fiscontable.nombreMes(cfg.desde).toLowerCase()}; sigue al día.`);
    if (cfg.ultima) partes.push(`Última: ${fechaCorta(cfg.ultima)}.`);
    p.textContent = partes.join(" ");
}

async function guardarXmlAuto() {
    if (!rfcEnEdicion) return;
    const boton = document.getElementById("btn-guardar-xml"), msj = document.getElementById("xml-mensaje");
    boton.disabled = true;
    try {
        const r = await fetch(`${API_URL}/api/descarga-xml/automatica/${encodeURIComponent(rfcEnEdicion)}`, {
            method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                activo: document.getElementById("xml-activo").checked,
                tipo: document.getElementById("xml-tipo").value,
                frecuencia: document.getElementById("xml-frecuencia").value,
                desde: document.getElementById("xml-desde").value || null,
                correo: document.getElementById("xml-correo").value
            })
        });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        const cfg = await r.json();
        explicarXmlAuto(cfg);
        msj.textContent = "Guardado.";
        msj.className = "text-xs text-emerald-700 font-semibold";
    } catch (e) {
        msj.textContent = e.message;
        msj.className = "text-xs text-red-600 font-semibold";
    }
    boton.disabled = false;
}

/* Obligaciones (hoy ISN de Quintana Roo): al activarla, la empresa aparece en ISN lista para llenar sus datos. */
/* Obligaciones federales (de su constancia): las ve cualquiera; las estatales solo con el módulo */
const PERIODO_FED = { mensual: "Mensual", bimestral: "Bimestral", anual: "Anual", otra: "" };
function pintarListaFed(d) {
    const lista = d && d.lista, caja = document.getElementById("fed-lista");
    document.getElementById("fed-fecha").textContent = d && d.leidas_en ? "· leídas el " + fechaCorta(d.leidas_en.slice(0, 10)) : "";
    caja.innerHTML = lista && lista.length ? lista.map(o => `
        <div class="flex items-start gap-2 text-sm border border-gray-200 rounded-lg px-3 py-2">
            <span class="text-[11px] font-bold px-2 py-0.5 rounded-full flex-none ${o.periodo === "mensual" ? "bg-violet-100 text-violet-700" : "bg-gray-100 text-gray-600"}">${esc(PERIODO_FED[o.periodo] || "Otra")}</span>
            <span class="min-w-0"><b class="font-semibold text-slate-800">${esc(o.descripcion)}</b>${o.vencimiento ? `<br><span class="text-xs text-slate-500">${esc(o.vencimiento)}</span>` : ""}</span>
        </div>`).join("")
        : lista ? `<p class="text-xs text-slate-500">Su constancia no tiene obligaciones vigentes: el cierre del mes no le pide declaración.</p>`
        : `<p class="text-xs text-slate-400">Todavía no se leen. Se leen solas con su próxima constancia, o usa los botones de arriba.</p>`;
}
async function cargarFed(rfc) {
    try {
        const r = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(rfc)}/obligaciones-fed`, { credentials: "include" });
        if (r.ok && rfcEnEdicion === rfc) pintarListaFed(await r.json());
    } catch (e) { /* sin conexión: se queda vacío */ }
}
async function leerFed(archivo) {
    const msj = document.getElementById("fed-mensaje"), rfc = rfcEnEdicion, fd = new FormData();
    if (archivo) fd.append("archivo", archivo);
    msj.className = "text-xs text-slate-500"; msj.textContent = "Leyendo la constancia…";
    try {
        const r = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(rfc)}/obligaciones-fed`, { method: "POST", credentials: "include", body: fd });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        const d = await r.json();
        pintarListaFed(d);
        msj.className = "text-xs text-emerald-700 font-semibold";
        msj.textContent = d.lista.length ? `✓ ${d.lista.length} obligaciones vigentes.` : "✓ Su constancia no tiene obligaciones (no le toca declaración mensual).";
        // La misma constancia trae su domicilio fiscal y régimen: se refresca su ficha
        await cargarClientes();
        const c = clientesCache.find(x => x.rfc === rfc); if (c && rfcEnEdicion === rfc) pintarDatosFiscales(c);
    } catch (e) { msj.className = "text-xs text-red-600 font-semibold"; msj.textContent = e.message; }
}
document.addEventListener("DOMContentLoaded", () => {
    const leer = document.getElementById("btn-fed-leer"), subir = document.getElementById("fed-subir");
    if (leer) leer.addEventListener("click", () => leerFed(null));
    if (subir) subir.addEventListener("change", () => { if (subir.files[0]) leerFed(subir.files[0]); subir.value = ""; });
});

function pintarObligaciones(cliente) {
    pintarListaFed(null);
    document.getElementById("fed-mensaje").className = "text-xs hidden";
    cargarFed(cliente.rfc);
    const caja = document.getElementById("editar-obligaciones");
    caja.classList.toggle("hidden", !conIsn);
    document.getElementById("tab-obligaciones").hidden = false;
    if (!conIsn) return;
    const o = obligaciones[cliente.rfc] || {};
    document.getElementById("obl-isn").checked = !!o.obligacion;
    document.getElementById("obl-zona").value = o.zona || "general";
    document.getElementById("obl-mensaje").classList.add("hidden");
    const r = encodeURIComponent(cliente.rfc);
    document.getElementById("obl-isn-datos").href = `/herramientas/isn/?empresa=${r}&abrir=datos`;
    document.getElementById("obl-isn-acuse").href = `/herramientas/isn/?empresa=${r}&abrir=acuse`;
    document.getElementById("obl-isn-descargar").href = `/herramientas/isn/?empresa=${r}&abrir=descargar`;
    pintarDetalleIsn(o);
    pintarEstatales(cliente.rfc);
}

function pintarEstatales(rfc) {
    const r = encodeURIComponent(rfc), act = obligacionesEst[rfc] || {};
    document.getElementById("obl-estatales").innerHTML = ESTATALES.map(([k, largo]) => {
        const o = act[k], url = `/herramientas/isn/estatal.html?i=${k}&empresa=${r}&abrir=`;
        const estado = !o ? "" : o.completos ? '<span class="text-emerald-700">✓ Datos completos.</span>'
                                             : '<span class="text-amber-700">Faltan datos: sube el último acuse y se llenan automáticamente.</span>';
        return `<div><label class="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" data-obl-est="${k}" class="w-4 h-4 accent-violet-600"${o ? " checked" : ""}> ${largo}</label>
            ${o ? `<div class="ml-6 mt-1 text-xs font-semibold flex flex-wrap" style="gap:4px 14px">${estado}
                <a class="text-violet-700 underline" href="${url}acuse">Subir el último acuse</a>
                <a class="text-violet-700 underline" href="${url}descargar">Descargarlo del portal</a>
                <a class="text-violet-700 underline" href="${url}datos">Datos de la declaración</a></div>` : ""}</div>`;
    }).join("");
}

function pintarDetalleIsn(o) {
    const activa = document.getElementById("obl-isn").checked;
    document.getElementById("obl-isn-detalle").classList.toggle("hidden", !activa);
    const estado = document.getElementById("obl-isn-estado");
    if (!o.obligacion) {
        estado.textContent = "Al guardar, llena sus datos (domicilio, giro, firma y sucursales): con el último acuse se llenan automáticamente.";
        estado.className = "text-xs text-slate-500";
    } else if (o.completos) {
        estado.textContent = "✓ Datos de la declaración completos.";
        estado.className = "text-xs font-semibold text-emerald-700";
    } else {
        estado.textContent = "Faltan datos de la declaración: llénalos o sube el último acuse.";
        estado.className = "text-xs font-semibold text-amber-700";
    }
}

async function guardarObligaciones() {
    if (!rfcEnEdicion) return;
    const boton = document.getElementById("btn-guardar-obligaciones");
    const msj = document.getElementById("obl-mensaje");
    const cliente = clientesCache.find(c => c.rfc === rfcEnEdicion) || {};
    const activa = document.getElementById("obl-isn").checked;
    const antes = obligaciones[rfcEnEdicion];
    const antesEst = obligacionesEst[rfcEnEdicion] || {};
    const cambiosEst = Array.from(document.querySelectorAll("[data-obl-est]")).filter(c => c.checked !== !!antesEst[c.dataset.oblEst]);
    const cambiaIsn = activa || !!antes;
    if (!cambiaIsn && !cambiosEst.length) { cerrarModalEditar(); return; }
    boton.disabled = true;
    try {
        if (cambiaIsn) {
            const r = await fetch(`${API_URL}/api/isn/obligacion`, {
                method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rfc: rfcEnEdicion, activa: activa, zona: document.getElementById("obl-zona").value, nombre: cliente.alias || null })
            });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        }
        for (const c of cambiosEst) {
            const r = await fetch(`${API_URL}/api/estatales/${c.dataset.oblEst}/obligacion`, {
                method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rfcs: [rfcEnEdicion], activa: c.checked })
            });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        }
        await cargarObligaciones();
        renderizarClientes();
        const o = obligaciones[rfcEnEdicion] || {};
        pintarDetalleIsn(o);
        pintarEstatales(rfcEnEdicion);
        const nuevasEst = cambiosEst.filter(c => c.checked).length;
        msj.textContent = "Guardado." + ((activa && !o.completos) || nuevasEst ? " Para llenar sus datos, sube el último acuse (enlaces de arriba)." : "");
        msj.className = "text-xs mt-2 text-emerald-700 font-semibold";
    } catch (e) {
        msj.textContent = e.message;
        msj.className = "text-xs mt-2 text-red-600 font-semibold";
    }
    boton.disabled = false;
}

/* Contraseña del SAT (CIEC) en la ficha */
function pintarCiec(cliente) {
    const caja = document.getElementById("editar-ciec");
    caja.classList.toggle("hidden", !puedeGuardarEfirma);
    const badge = document.getElementById("editar-estado-ciec");
    badge.textContent = cliente.ciec_guardada ? "Guardada" : "No guardada";
    badge.className = "text-xs font-bold px-2 py-1 rounded-full flex-none " + (cliente.ciec_guardada ? "bg-violet-100 text-violet-700" : "bg-gray-100 text-gray-500");
    document.getElementById("btn-olvidar-ciec").classList.toggle("hidden", !cliente.ciec_guardada);
    document.getElementById("btn-guardar-ciec").textContent = cliente.ciec_guardada ? "Cambiar" : "Guardar";
    const campo = document.querySelector("#editar-ciec input"); if (campo) campo.value = "";
    document.getElementById("editar-mensaje-ciec").classList.add("hidden");
}

function mensajeCiec(ok, texto) {
    const p = document.getElementById("editar-mensaje-ciec");
    p.textContent = texto; p.className = "text-xs mt-2 font-semibold " + (ok ? "text-emerald-700" : "text-red-600");
}

async function guardarCiec() {
    const campo = document.querySelector("#editar-ciec input");
    if (!campo.value.trim()) { mensajeCiec(false, "Escribe la contraseña del SAT."); campo.focus(); return; }
    const b = document.getElementById("btn-guardar-ciec"); b.disabled = true;
    try {
        const r = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(rfcEnEdicion)}/ciec`, {
            method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ciec: campo.value.trim() })
        });
        if (!r.ok) throw new Error(await interpretarError(r));
        await cargarClientes();
        pintarCiec(clientesCache.find(c => c.rfc === rfcEnEdicion) || { ciec_guardada: true });
        mensajeCiec(true, "✓ Contraseña guardada (cifrada).");
    } catch (e) { mensajeCiec(false, e.message); }
    b.disabled = false;
}

async function olvidarCiec() {
    if (!(await Fiscontable.confirmar({ titulo: "¿Olvidar la contraseña del SAT?", texto: "Se borra la contraseña guardada de " + rfcEnEdicion + ". La puedes volver a escribir en cualquier momento.", si: "Olvidar", peligro: true }))) return;
    try {
        const r = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(rfcEnEdicion)}/ciec`, { method: "DELETE", credentials: "include" });
        if (!r.ok) throw new Error(await interpretarError(r));
        await cargarClientes();
        pintarCiec(clientesCache.find(c => c.rfc === rfcEnEdicion) || { ciec_guardada: false });
        mensajeCiec(true, "Contraseña olvidada.");
    } catch (e) { mensajeCiec(false, e.message); }
}

/* Sello digital (CSD), régimen y C.P. para facturar: lo mismo que Facturar › Configuración, a la mano en la ficha */
async function pintarCsd(cliente) {
    const caja = document.getElementById("editar-csd");
    caja.hidden = !conFacturar || !puedeGuardarEfirma;
    if (caja.hidden) return;
    ["csd-cer", "csd-key", "csd-pass"].forEach(id => { document.getElementById(id).value = ""; });
    document.getElementById("editar-mensaje-csd").classList.add("hidden");
    const badge = document.getElementById("editar-estado-csd");
    badge.textContent = "Revisando…";
    badge.className = "text-xs font-bold px-2 py-1 rounded-full flex-none bg-gray-100 text-gray-500";
    try {
        if (!factCfg) {
            const r = await fetch(`${API_URL}/api/facturacion/config`, { credentials: "include" });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            factCfg = await r.json();
        }
    } catch (e) {
        badge.textContent = "";
        mensajeCsd(false, e.message);
        return;
    }
    if (rfcEnEdicion !== cliente.rfc) return;
    const em = factCfg.empresas.find(x => x.rfc === cliente.rfc) || { csd: null };
    const regimenes = factCfg.catalogos.regimenes;
    document.getElementById("csd-regimen").innerHTML = '<option value="">Elige…</option>' + Object.keys(regimenes)
        .map(k => `<option value="${esc(k)}"${k === em.regimen ? " selected" : ""}>${esc(k + " · " + regimenes[k])}</option>`).join("");
    document.getElementById("csd-cp").value = em.cp || "";
    const vencido = em.csd && em.csd.vence && em.csd.vence < new Date().toISOString().slice(0, 10);
    badge.textContent = !em.csd ? "No guardado" : vencido ? "Vencido" : "Guardado";
    badge.className = "text-xs font-bold px-2 py-1 rounded-full flex-none " +
        (!em.csd ? "bg-gray-100 text-gray-500" : vencido ? "bg-red-100 text-red-700" : "bg-violet-100 text-violet-700");
    document.getElementById("csd-guardado").classList.toggle("hidden", !em.csd);
    document.getElementById("csd-guardado-texto").textContent = em.csd
        ? "✓ Certificado " + (em.csd.no || "") + (em.csd.vence ? (vencido ? " · venció el " : " · vence el ") + fechaCorta(em.csd.vence) : "") : "";
    document.getElementById("csd-form").classList.toggle("hidden", !!em.csd);
    document.getElementById("btn-quitar-csd").hidden = !em.csd;
}

/* Receptores: a quién le factura esta empresa (los mismos que se eligen en Facturar) */
let receptoresFicha = [];
let editandoReceptor = null;
async function pintarReceptores(cliente) {
    const tab = document.getElementById("tab-receptores");
    tab.hidden = !conFacturar;
    document.getElementById("form-receptor").hidden = true;
    document.getElementById("rec-buscar").value = "";
    if (!conFacturar) return;
    const lista = document.getElementById("lista-receptores-ficha");
    lista.innerHTML = '<p class="text-xs text-slate-400">Cargando…</p>';
    try {
        if (!factCfg) {
            const r = await fetch(`${API_URL}/api/facturacion/config`, { credentials: "include" });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            factCfg = await r.json();
        }
        const r = await fetch(`${API_URL}/api/facturacion/receptores?rfc=${encodeURIComponent(cliente.rfc)}`, { credentials: "include" });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        receptoresFicha = await r.json();
    } catch (e) { lista.innerHTML = `<p class="text-xs text-red-600">${esc(e.message)}</p>`; return; }
    if (rfcEnEdicion !== cliente.rfc) return;
    const opc = (mapa, vacio) => `<option value="">${vacio}</option>` + Object.keys(mapa).map(k => `<option value="${esc(k)}">${esc(k + " · " + mapa[k])}</option>`).join("");
    document.getElementById("rec-regimen").innerHTML = opc(factCfg.catalogos.regimenes, "Elige…");
    document.getElementById("rec-uso").innerHTML = opc(factCfg.catalogos.usos, "Sin definir");
    document.getElementById("rec-pais").innerHTML = opc(factCfg.catalogos.paises || {}, "Elige…");
    listarReceptores();
}

function listarReceptores() {
    const q = sinAcentos(document.getElementById("rec-buscar").value.trim());
    const cat = factCfg ? factCfg.catalogos.regimenes : {};
    const filas = receptoresFicha.filter(r => !q || sinAcentos(r.nombre + " " + r.rfc).includes(q));
    document.getElementById("lista-receptores-ficha").innerHTML = filas.length ? filas.map(r => `
        <div class="ficha-caja flex items-center gap-3" style="padding:10px 12px">
            <div class="min-w-0 flex-1"><p class="text-sm font-bold text-slate-800 truncate">${esc(r.nombre)}</p>
                <p class="text-xs text-slate-500"><span class="font-mono">${esc(r.rfc)}</span>${r.residencia ? " · " + esc(r.residencia + " " + (r.num_reg_id || "")) : ""}${r.cp ? " · C.P. " + esc(r.cp) : ""}${r.regimen ? " · " + esc(r.regimen + " " + (cat[r.regimen] || "")) : ""}${r.correo ? " · " + esc(r.correo) : ""}${r.telefono ? " · WhatsApp " + esc(r.telefono) : ""}</p></div>
            <button type="button" class="text-xs font-bold text-violet-700 hover:underline" data-rec-editar="${esc(r.clave || r.rfc)}">Editar</button>
            <button type="button" class="text-xs font-bold text-red-600 hover:underline" data-rec-quitar="${esc(r.clave || r.rfc)}">Quitar</button>
        </div>`).join("") : `<p class="text-xs text-slate-400 text-center py-4">${receptoresFicha.length ? "Nada coincide." : "Todavía no hay clientes. Agrégalos aquí o se guardan solos al timbrar."}</p>`;
}

function verRecExtranjero() {
    const ext = document.getElementById("rec-rfc").value.trim().toUpperCase() === "XEXX010101000";
    document.querySelectorAll(".rec-ext").forEach(x => { x.hidden = !ext; });
}

function abrirFormReceptor(r) {
    editandoReceptor = r ? (r.clave || r.rfc) : null;
    document.getElementById("form-receptor-titulo").textContent = r ? "Editar cliente" : "Nuevo cliente";
    document.getElementById("rec-rfc").value = r ? r.rfc : "";
    document.getElementById("rec-rfc").disabled = !!r;
    document.getElementById("rec-nombre").value = r ? r.nombre : "";
    document.getElementById("rec-cp").value = r && r.cp || "";
    document.getElementById("rec-regimen").value = r && r.regimen || "";
    document.getElementById("rec-uso").value = r && r.uso || "";
    document.getElementById("rec-correo").value = r && r.correo || "";
    document.getElementById("rec-telefono").value = r && r.telefono || "";
    document.getElementById("rec-pais").value = r && r.residencia || "";
    document.getElementById("rec-taxid").value = r && r.num_reg_id || "";
    verRecExtranjero();
    document.getElementById("rec-mensaje").classList.add("hidden");
    document.getElementById("form-receptor").hidden = false;
    document.getElementById(r ? "rec-nombre" : "rec-rfc").focus();
}

function mensajeReceptor(ok, texto) {
    const p = document.getElementById("rec-mensaje");
    p.textContent = texto; p.className = "text-xs font-semibold " + (ok ? "text-emerald-700" : "text-red-600");
}

async function guardarReceptor() {
    const val = id => document.getElementById(id).value.trim();
    try {
        const r = await fetch(`${API_URL}/api/facturacion/receptores`, {
            method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rfc_emisor: rfcEnEdicion, rfc: val("rec-rfc").toUpperCase(), nombre: val("rec-nombre"), cp: val("rec-cp") || null,
                                   regimen: val("rec-regimen") || null, uso: val("rec-uso") || null, correo: val("rec-correo") || null,
                                   telefono: val("rec-telefono") || null, residencia: val("rec-pais") || null, num_reg_id: val("rec-taxid") || null })
        });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        const guardado = await r.json();
        receptoresFicha = receptoresFicha.filter(x => (x.clave || x.rfc) !== guardado.clave).concat([guardado]).sort((a, b) => a.nombre.localeCompare(b.nombre));
        document.getElementById("form-receptor").hidden = true;
        listarReceptores();
    } catch (e) { mensajeReceptor(false, e.message); }
}

async function leerConstanciaReceptor(archivo) {
    if (!archivo) return;
    mensajeReceptor(true, "Leyendo la constancia…");
    try {
        const cuerpo = new FormData(); cuerpo.append("archivo", archivo);
        const r = await fetch(`${API_URL}/api/facturacion/leer-constancia`, { method: "POST", credentials: "include", body: cuerpo });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        const d = await r.json();
        if (!editandoReceptor) document.getElementById("rec-rfc").value = d.rfc;
        else if (d.rfc !== editandoReceptor) throw new Error(`Esa constancia es de ${d.rfc}, no de ${editandoReceptor}.`);
        if (d.nombre) document.getElementById("rec-nombre").value = d.nombre;
        if (d.cp) document.getElementById("rec-cp").value = d.cp;
        if (d.regimenes.length) document.getElementById("rec-regimen").value = d.regimenes[0];
        mensajeReceptor(true, d.regimenes.length > 1 ? `✓ Leída. Tiene varios regímenes (${d.regimenes.join(", ")}): elige el que le corresponda.` : "✓ Leída: revisa y guarda.");
    } catch (e) { mensajeReceptor(false, e.message); }
    document.getElementById("rec-constancia").value = "";
}

async function quitarReceptor(rfc) {
    if (!(await Fiscontable.confirmar({ titulo: "¿Quitar a " + rfc.split(":")[0] + " de sus receptores?", si: "Quitar", peligro: true }))) return;
    try {
        const r = await fetch(`${API_URL}/api/facturacion/receptores/${encodeURIComponent(rfcEnEdicion)}/${encodeURIComponent(rfc)}`, { method: "DELETE", credentials: "include" });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        receptoresFicha = receptoresFicha.filter(x => (x.clave || x.rfc) !== rfc);
        listarReceptores();
    } catch (e) { Fiscontable.avisar(e.message); }
}

document.addEventListener("click", (e) => {
    if (e.target.closest("#btn-nuevo-receptor")) { abrirFormReceptor(null); return; }
    if (e.target.closest("#btn-importar-receptores")) {
        const rfc = rfcEnEdicion, nombre = document.getElementById("editar-titulo").textContent;
        Fiscontable.importarClientes({ rfc, nombre, alTerminar: () => { const c = { rfc }; if (rfcEnEdicion === rfc) pintarReceptores(c); } });
        return;
    }
    if (e.target.closest("#btn-cancelar-receptor")) { document.getElementById("form-receptor").hidden = true; return; }
    if (e.target.closest("#btn-guardar-receptor")) { guardarReceptor(); return; }
    const ed = e.target.closest("[data-rec-editar]");
    if (ed) { abrirFormReceptor(receptoresFicha.find(x => (x.clave || x.rfc) === ed.dataset.recEditar)); return; }
    const qu = e.target.closest("[data-rec-quitar]");
    if (qu) quitarReceptor(qu.dataset.recQuitar);
});
document.addEventListener("input", (e) => {
    if (e.target && e.target.id === "rec-buscar") listarReceptores();
    if (e.target && e.target.id === "rec-rfc") verRecExtranjero();
});
document.addEventListener("change", (e) => { if (e.target && e.target.id === "rec-constancia") leerConstanciaReceptor(e.target.files[0]); });

function mensajeCsd(ok, texto) {
    const p = document.getElementById("editar-mensaje-csd");
    p.textContent = texto;
    p.className = "text-xs mb-2 font-semibold " + (ok ? "text-emerald-700" : "text-red-600");
}

function ponerEmisor(nuevo) {
    if (factCfg) factCfg.empresas = factCfg.empresas.map(x => x.rfc === nuevo.rfc ? nuevo : x);
}

async function guardarFacturacion() {
    const rfc = rfcEnEdicion;
    if (!rfc || !factCfg) return;
    const em = factCfg.empresas.find(x => x.rfc === rfc) || {};
    const regimen = document.getElementById("csd-regimen").value, cp = document.getElementById("csd-cp").value.trim();
    const cer = document.getElementById("csd-cer").files[0], key = document.getElementById("csd-key").files[0];
    const pass = document.getElementById("csd-pass").value;
    const conArchivos = !!(cer || key || pass);
    if (cp && !/^\d{5}$/.test(cp)) { mensajeCsd(false, "El código postal son 5 dígitos (el de su constancia de situación fiscal)."); return; }
    if (conArchivos && (!cer || !key || !pass)) { mensajeCsd(false, "Para el sello elige el .cer, el .key y escribe su contraseña."); return; }
    const cambioDatos = (regimen || null) !== (em.regimen || null) || (cp || null) !== (em.cp || null);
    if (!cambioDatos && !conArchivos) { mensajeCsd(false, "No hay cambios que guardar."); return; }
    const b = document.getElementById("btn-guardar-csd");
    b.disabled = true; b.textContent = conArchivos ? "Revisando el sello…" : "Guardando…";
    try {
        if (cambioDatos) {
            const r = await fetch(`${API_URL}/api/facturacion/emisores/${encodeURIComponent(rfc)}`, {
                method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ regimen: regimen || null, cp: cp || null })
            });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            ponerEmisor(await r.json());
        }
        if (conArchivos) {
            const cuerpo = new FormData();
            cuerpo.append("cer", cer); cuerpo.append("key", key); cuerpo.append("password", pass);
            const r = await fetch(`${API_URL}/api/facturacion/emisores/${encodeURIComponent(rfc)}/csd`, { method: "POST", credentials: "include", body: cuerpo });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            ponerEmisor(await r.json());
        }
        await pintarCsd(clientesCache.find(c => c.rfc === rfc) || { rfc: rfc });
        const ahora = factCfg.empresas.find(x => x.rfc === rfc) || {};
        mensajeCsd(true, (conArchivos ? "✓ Sello guardado (cifrado)." : "✓ Guardado.") +
            (ahora.faltan && ahora.faltan.length ? " Para facturar falta: " + ahora.faltan.join(", ") + "." : " Ya puede facturar."));
    } catch (e) { mensajeCsd(false, e.message); }
    b.disabled = false; b.textContent = "Guardar";
}

async function quitarCsd() {
    const rfc = rfcEnEdicion;
    if (!rfc || !(await Fiscontable.confirmar({ titulo: "¿Quitar el sello digital (CSD)?", texto: "Esta empresa ya no podrá facturar hasta que subas otro.", si: "Quitar el sello", peligro: true, escribir: rfc }))) return;
    try {
        const r = await fetch(`${API_URL}/api/facturacion/emisores/${encodeURIComponent(rfc)}/csd`, { method: "DELETE", credentials: "include" });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        factCfg = null;                  // se vuelve a pedir para que diga bien lo que falta
        await pintarCsd(clientesCache.find(c => c.rfc === rfc) || { rfc: rfc });
        mensajeCsd(true, "Sello quitado.");
    } catch (e) { mensajeCsd(false, e.message); }
}

function cerrarModalEditar() {
    document.getElementById("modal-editar-cliente").classList.remove("modal-active");
    rfcEnEdicion = null;
}

function toggleEditarPassword() {
    const campo = document.getElementById("editar-password");
    campo.type = campo.type === "password" ? "text" : "password";
}

function mostrarMensajeEfirma(tipo, texto) {
    const p = document.getElementById("editar-mensaje-efirma");
    p.textContent = texto;
    p.className = tipo === "error"
        ? "text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5"
        : "text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg p-2.5";
    p.classList.remove("hidden");
}

function ocultarMensajeEfirma() {
    document.getElementById("editar-mensaje-efirma").classList.add("hidden");
}

async function guardarAlias() {
    const boton = document.getElementById("btn-guardar-alias");
    const alias = document.getElementById("editar-alias").value.trim();
    if (!alias) { mostrarAlerta("error", "El nombre no puede quedar vacío."); return; }

    const textoOriginal = boton.textContent;
    boton.disabled = true;
    boton.textContent = "...";
    try {
        const resp = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(rfcEnEdicion)}`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alias, tipo_sociedad: document.getElementById("editar-tipo").value, correo_cliente: document.getElementById("editar-correo").value.trim() }),
        });
        if (!resp.ok) { mostrarAlerta("error", await interpretarError(resp)); return; }
        mostrarAlerta("success", "Nombre actualizado.");
        await cargarClientes();
        const c = clientesCache.find(x => x.rfc === rfcEnEdicion);
        if (c) {
            document.getElementById("editar-titulo").textContent = c.alias;
            document.getElementById("editar-rfc").textContent = c.rfc + (c.tipo_sociedad ? " · " + c.tipo_sociedad : "");
            document.getElementById("editar-dato-razon").textContent = c.razon_social || c.alias;
        }
    } catch (error) {
        mostrarAlerta("error", "No se pudo conectar con el servidor.");
    } finally {
        boton.disabled = false;
        boton.textContent = textoOriginal;
    }
}

async function guardarEfirma() {
    const cer = document.getElementById("editar-cer").files[0];
    const key = document.getElementById("editar-key").files[0];
    const password = document.getElementById("editar-password").value;

    if (!cer || !key || !password) {
        mostrarMensajeEfirma("error", "Necesitamos el .cer, el .key y la contraseña para guardarla.");
        return;
    }
    ocultarMensajeEfirma();

    const boton = document.getElementById("btn-guardar-efirma");
    const textoOriginal = boton.textContent;
    boton.disabled = true;
    boton.textContent = "Verificando...";

    const formData = new FormData();
    formData.append("cer", cer);
    formData.append("key", key);
    formData.append("password", password);

    try {
        const resp = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(rfcEnEdicion)}/efirma`, {
            method: "POST",
            credentials: "include",
            body: formData,
        });
        if (!resp.ok) {
            mostrarMensajeEfirma("error", await interpretarError(resp));
            return;
        }
        const datos = await resp.json();
        let confirmacion = "e.firma guardada correctamente.";
        if (!datos.rfc_verificado || !datos.password_verificada) {
            confirmacion += " (No pudimos verificar todo por adelantado; se comprobará al usarla.)";
        }
        mostrarMensajeEfirma("exito", confirmacion);
        document.getElementById("editar-password").value = "";
        await cargarClientes();
        const actualizado = clientesCache.find(c => c.rfc === rfcEnEdicion);
        if (actualizado) abrirModalEditarSinLimpiarMensaje(actualizado);
    } catch (error) {
        mostrarMensajeEfirma("error", "No se pudo conectar con el servidor.");
    } finally {
        boton.disabled = false;
        boton.textContent = textoOriginal;
    }
}

function abrirModalEditarSinLimpiarMensaje(cliente) {
    pintarEfirmaFicha(cliente, true);
    pintarResumenFicha(cliente);
}

async function olvidarEfirmaDesdeModal() {
    if (!(await Fiscontable.confirmar({ titulo: "¿Olvidar la e.firma guardada?", texto: "Lo programado con ella (constancia, opinión, XML, buzón) deja de salir hasta que la vuelvas a subir.", si: "Olvidar la e.firma", peligro: true, escribir: rfcEnEdicion }))) return;
    try {
        const resp = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(rfcEnEdicion)}/efirma`, {
            method: "DELETE",
            credentials: "include",
        });
        if (!resp.ok) { mostrarMensajeEfirma("error", await interpretarError(resp)); return; }
        mostrarMensajeEfirma("exito", "e.firma eliminada.");
        await cargarClientes();
        const c = clientesCache.find(x => x.rfc === rfcEnEdicion);
        if (c) abrirModalEditarSinLimpiarMensaje(c);
    } catch (error) {
        mostrarMensajeEfirma("error", "No se pudo conectar con el servidor.");
    }
}

async function olvidarEfirma(rfc) {
    if (!(await Fiscontable.confirmar({ titulo: "¿Olvidar la e.firma guardada?", texto: "Lo programado con ella (constancia, opinión, XML, buzón) deja de salir hasta que la vuelvas a subir.", si: "Olvidar la e.firma", peligro: true, escribir: rfc }))) return;
    try {
        const resp = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(rfc)}/efirma`, {
            method: "DELETE",
            credentials: "include",
        });
        if (!resp.ok) {
            mostrarAlerta("error", await interpretarError(resp));
            return;
        }
        mostrarAlerta("success", "e.firma eliminada de este cliente.");
        await cargarClientes();
    } catch (error) {
        mostrarAlerta("error", "No se pudo conectar con el servidor.");
    }
}

async function eliminarCliente(rfc) {
    if (!(await Fiscontable.confirmar({ titulo: "¿Quitar a " + rfc + " de tus clientes?", texto: "No borra los documentos ya generados; solo lo saca de tu directorio y de sus programaciones.", si: "Quitar cliente", peligro: true, escribir: rfc }))) return;
    try {
        const resp = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(rfc)}`, {
            method: "DELETE",
            credentials: "include",
        });
        if (!resp.ok) {
            mostrarAlerta("error", await interpretarError(resp));
            return;
        }
        await cargarClientes();
    } catch (error) {
        mostrarAlerta("error", await interpretarError(null));
    }
}


/* Alta y ficha: zona para soltar el .cer y el .key juntos (FCZona). Llena los campos de siempre, así que la
   validación, la lectura del RFC y el guardado siguen igual. «Elegir por separado» muestra los dos campos. */
function prepararZonaEfirma(pref) {
    const caja = document.getElementById(pref + "-zona-efirma");
    if (!caja || !window.FCZona) { if (caja) caja.nextElementSibling.hidden = false; return; }
    const cer = document.getElementById(pref + "-cer"), key = document.getElementById(pref + "-key");
    const campos = caja.nextElementSibling;
    const z = FCZona.crear(caja, {
        acepta: ".cer,.key", varios: true, titulo: "Suelta aquí el .cer y el .key", detalle: "o haz clic para elegirlos (los dos a la vez)",
        alElegir: (archivos) => {
            const poner = (input, f) => { const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true })); };
            const c = archivos.find(f => /\.cer$/i.test(f.name)), k = archivos.find(f => /\.key$/i.test(f.name));
            if (c) poner(cer, c);
            if (k) poner(key, k);
            pintar();
        }
    });
    const pintar = () => {
        const c = cer.files[0], k = key.files[0];
        z.estado(c && k ? "ok" : c || k ? "" : "", c || k ? (c ? "✓ " + c.name : "Falta el .cer") + " · " + (k ? "✓ " + k.name : "falta el .key") : "");
    };
    [cer, key].forEach(i => i.addEventListener("change", pintar));
    const otra = document.createElement("button");
    otra.type = "button"; otra.className = "zona-efirma-separado"; otra.textContent = "Elegir por separado";
    otra.addEventListener("click", () => { campos.hidden = !campos.hidden; otra.textContent = campos.hidden ? "Elegir por separado" : "Ocultar los campos"; });
    caja.appendChild(otra);
    // Al limpiar el formulario (value = "") la línea de estado también se limpia
    caja._pintar = pintar;
}
document.addEventListener("DOMContentLoaded", () => { prepararZonaEfirma("alta"); prepararZonaEfirma("editar"); });

/* ---------------------------------------------------------------- Leer constancias (varias a la vez) */
document.addEventListener("DOMContentLoaded", () => {
    const b = document.getElementById("btn-constancias"), dlg = document.getElementById("dlg-constancias");
    if (!b || !dlg) return;
    let zona = null;
    const estados = { alta: "Alta nueva", actualizado: "Actualizado", omitido: "Omitido", error: "No se pudo" };
    async function leer(archivos) {
        const fd = new FormData();
        archivos.forEach(f => fd.append("archivos", f));
        fd.append("alta", document.getElementById("cs-alta").checked ? "true" : "false");
        zona.estado("", "Leyendo " + archivos.length + " constancia(s)…");
        try {
            const r = await fetch(`${API_URL}/api/clientes/constancias`, { method: "POST", credentials: "include", body: fd });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            const d = await r.json(), s = d.resumen;
            zona.estado("ok", `✓ ${s.actualizado} actualizado(s), ${s.alta} alta(s) nueva(s)` + (s.omitido ? `, ${s.omitido} omitido(s)` : "") + (s.error ? `, ${s.error} con error` : "") + ".");
            document.getElementById("cs-resultado").innerHTML = '<table class="cf-tabla" style="width:100%"><tbody>' + d.resultados.map(x =>
                `<tr><td><b>${esc(x.nombre || x.archivo)}</b><br><small class="xml-tenue">${esc((x.rfc || "") + (x.tipo ? " · " + (x.tipo === "csf" ? "constancia" : "opinión") : "") + (x.fecha ? " del " + x.fecha.split("-").reverse().join("/") : ""))}</small></td>` +
                `<td>${esc(estados[x.estado] || x.estado)}${x.mensaje ? `<br><small class="xml-tenue">${esc(x.mensaje)}</small>` : ""}</td>` +
                `<td style="text-align:right">${x.obligaciones != null ? (x.mensuales ? x.mensuales + " mensuales" : "sin declaración mensual") : ""}</td></tr>`).join("") + "</tbody></table>";
            await cargarClientes();
        } catch (e) { zona.estado("error", e.message); }
    }
    b.addEventListener("click", () => {
        if (!zona) zona = FCZona.crear(document.getElementById("cs-zona"), { acepta: ".pdf", varios: true, titulo: "Suelta aquí las constancias y opiniones (PDF)", detalle: "o haz clic para elegirlas; hasta 300 a la vez", alElegir: leer });
        document.getElementById("cs-resultado").innerHTML = ""; zona.estado("", "");
        dlg.showModal();
    });
    dlg.addEventListener("click", e => { if (e.target.closest("[data-cerrar]") || e.target === dlg) dlg.close(); });
});
