/**
 * descargas.js — código de descargas/ (antes vivía dentro del HTML).
 */
const API_URL = Fiscontable.API;          // la dirección vive solo en assets/js/nucleo.js
const esc = Fiscontable.escapar;          // todo texto del servidor pasa por aquí antes de ir al HTML
let hayEnPreparacion = false;
let procesosConocidos = new Map();
let primeraCarga = true;

// M-19: por defecto se ve lo de HOY y de la empresa activa; los filtros se recuerdan en este navegador.
const FILTRO = (() => { try { return Object.assign({ cuando: "hoy", tipo: "", empresa: "activa" }, JSON.parse(localStorage.getItem("fc-descargas-filtro") || "{}")); } catch (e) { return { cuando: "hoy", tipo: "", empresa: "activa" }; } })();
let empresaActiva = null;

document.addEventListener("DOMContentLoaded", async () => {
    try { empresaActiva = await Fiscontable.empresaActiva(); } catch (e) { empresaActiva = null; }
    prepararFiltros();
    cargarDescargas();
    programarRefresco();
});
window.addEventListener("fiscontable:empresa", (e) => { empresaActiva = e.detail || null; prepararFiltros(); pintarDeNuevo(); });

function grupoTipo(t) {
    t = t || "";
    if (t.startsWith("programada_")) return "programada";
    if (/csf|opinion/.test(t)) return "constancias";
    if (/xml/.test(t)) return "xml";
    if (/declarac|voucheo/.test(t)) return "declaraciones";
    if (/buzon/.test(t)) return "buzon";
    return "otros";
}
const GRUPOS_TIPO = { "": "Todos los tipos", constancias: "Constancias y opiniones", xml: "XML", declaraciones: "Declaraciones y voucheo",
                      buzon: "Buzón", programada: "Programadas", otros: "Otros" };

function prepararFiltros() {
    const caja = document.getElementById("dsc-filtros");
    if (!caja) return;
    const nombre = empresaActiva ? (empresaActiva.alias || empresaActiva.rfc) : "";
    caja.innerHTML =
        '<div class="ctx-segmento" role="group" aria-label="Cuándo">' +
        [["hoy", "Hoy"], ["7", "7 días"], ["30", "30 días"], ["todo", "Todo"]].map(([v, t]) =>
            `<button type="button" data-cuando="${v}" aria-pressed="${FILTRO.cuando === v}">${t}</button>`).join("") + "</div>" +
        '<select class="ui-select" id="dsc-tipo" aria-label="Tipo">' + Object.entries(GRUPOS_TIPO).map(([v, t]) =>
            `<option value="${v}"${FILTRO.tipo === v ? " selected" : ""}>${esc(t)}</option>`).join("") + "</select>" +
        '<select class="ui-select" id="dsc-empresa" aria-label="Empresa">' +
            (nombre ? `<option value="activa"${FILTRO.empresa === "activa" ? " selected" : ""}>Solo ${esc(nombre)}</option>` : "") +
            `<option value="todas"${FILTRO.empresa !== "activa" || !nombre ? " selected" : ""}>Todas las empresas</option></select>`;
    caja.onclick = (e) => {
        const b = e.target.closest("[data-cuando]"); if (!b) return;
        FILTRO.cuando = b.dataset.cuando; guardarFiltro(); prepararFiltros(); pintarDeNuevo();
    };
    caja.onchange = (e) => {
        if (e.target.id === "dsc-tipo") FILTRO.tipo = e.target.value;
        if (e.target.id === "dsc-empresa") FILTRO.empresa = e.target.value;
        guardarFiltro(); pintarDeNuevo();
    };
}
function guardarFiltro() { try { localStorage.setItem("fc-descargas-filtro", JSON.stringify(FILTRO)); } catch (e) { /* nada */ } }
function pasaFiltro(p) {
    if (p.estado === "procesando") return true;                      // lo que sigue trabajando siempre se ve
    if (FILTRO.cuando !== "todo") {
        const f = new Date(String(p.creado_en).length <= 19 ? p.creado_en + "Z" : p.creado_en);
        const limite = new Date();
        if (FILTRO.cuando === "hoy") limite.setHours(0, 0, 0, 0); else limite.setDate(limite.getDate() - (+FILTRO.cuando));
        if (f < limite) return false;
    }
    if (FILTRO.tipo && grupoTipo(p.tipo) !== FILTRO.tipo) return false;
    if (FILTRO.empresa === "activa" && empresaActiva && p.clase === "individual" && p.titulo !== empresaActiva.rfc) return false;
    return true;
}
function pintarDeNuevo() { if (window._ultimosProcesos) pintarProcesos(window._ultimosProcesos); }

document.addEventListener("visibilitychange", () => {
    if (!document.hidden) cargarDescargas(true);
});

function programarRefresco() {
    const intervalo = (!document.hidden && hayEnPreparacion) ? 5000 : 60000;
    setTimeout(async () => {
        if (!document.hidden) await cargarDescargas(true);
        programarRefresco();
    }, intervalo);
}

function mostrarAviso(mensaje) {
    document.getElementById("aviso-texto").textContent = mensaje;
    document.getElementById("aviso").classList.remove("hidden");
}
function ocultarAviso() { document.getElementById("aviso").classList.add("hidden"); }

function avisar(titulo, cuerpo) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try { new Notification(titulo, { body: cuerpo }); } catch (e) {}
}

function formatearFecha(iso) {
    const fecha = new Date(iso + "Z");
    const hoy = new Date();
    const esHoy = fecha.toDateString() === hoy.toDateString();
    const hora = fecha.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    if (esHoy) return `Hoy a las ${hora}`;
    const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
    if (fecha.toDateString() === ayer.toDateString()) return `Ayer a las ${hora}`;
    return fecha.toLocaleDateString("es-MX", { day: "numeric", month: "long" });
}

// Los nombres son los mismos que en el panel de la barra (un solo lugar: Fiscontable.descargas)
function nombreDocumento(p) { return Fiscontable.descargas.nombre(p); }
function titulo(p) { return Fiscontable.descargas.titulo(p); }

async function descargar(url, nombre, boton) {
    const original = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = "Descargando...";
    try {
        const resp = await fetch(`${API_URL}${url}`, { credentials: "include" });
        if (!resp.ok) {
            mostrarAviso(resp.status === 404 ? await Fiscontable.leerError(resp) : "No se pudo descargar. Puede que el archivo ya haya expirado.");
            return;
        }
        Fiscontable.guardarArchivo(await resp.blob(), nombre || "documento");
    } catch (e) {
        mostrarAviso("No se pudo conectar con el servidor.");
    } finally {
        boton.disabled = false;
        boton.innerHTML = original;
    }
}

async function quitar(clase, id, boton) {
    boton.disabled = true;
    try {
        const resp = await fetch(`${API_URL}/api/procesos/${clase}/${id}`, {
            method: "DELETE", credentials: "include",
        });
        if (!resp.ok) { mostrarAviso("No se pudo quitar."); boton.disabled = false; return; }
        procesosConocidos.delete(id);
        await cargarDescargas(true);
    } catch (e) {
        mostrarAviso("No se pudo conectar con el servidor.");
        boton.disabled = false;
    }
}

function verMotivos(idProceso) {
    const p = (window._ultimosProcesos || []).find(x => x.id === idProceso);
    if (!p || !p.fallidos) return;

    // Se agrupan por motivo: es más útil ver "12 con e.firma vencida"
    // que una lista de 12 renglones repitiendo lo mismo.
    const grupos = {};
    p.fallidos.forEach(f => {
        const motivo = f.motivo || "Sin detalle";
        if (!grupos[motivo]) grupos[motivo] = { rfcs: [], reintentable: f.reintentable };
        grupos[motivo].rfcs.push(f.rfc);
    });

    let html = "";
    Object.entries(grupos).forEach(([motivo, datos]) => {
        const clases = datos.reintentable
            ? { caja: "nota nota--info", etiqueta: "sello sello--info" }
            : { caja: "nota nota--alerta", etiqueta: "sello sello--mal" };
        const etiqueta = datos.reintentable
            ? "Se puede volver a intentar"
            : "Hay que corregir la e.firma primero";
        html += `
        <div class="${clases.caja}" style="margin-bottom:14px">
            <div class="flex flex-wrap items-start justify-between gap-2 mb-2">
                <p style="font-weight:700">${esc(motivo)}</p>
                <span class="${clases.etiqueta}">${etiqueta}</span>
            </div>
            <p style="font-size:12.5px;letter-spacing:.02em;line-height:1.7">${esc(datos.rfcs.join(", "))}</p>
        </div>`;
    });

    document.getElementById("contenido-motivos").innerHTML = html;
    document.getElementById("modal-motivos").classList.add("modal-active");
}

function cerrarMotivos() {
    document.getElementById("modal-motivos").classList.remove("modal-active");
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarMotivos(); });

async function limpiarTodosLosFallidos() {
    if (!(await Fiscontable.confirmar({ titulo: "¿Quitar todas las que no se completaron?", texto: "Solo salen de esta lista; no se borra nada que ya se haya descargado.", si: "Quitar todas" }))) return;
    const fallidos = (window._ultimosProcesos || []).filter(p => p.estado !== "completado" && p.estado !== "procesando");
    for (const p of fallidos) {
        try {
            await fetch(`${API_URL}/api/procesos/${p.clase}/${p.id}`, { method: "DELETE", credentials: "include" });
        } catch (e) {}
    }
    await cargarDescargas(true);
}

async function cargarDescargas(silencioso = false) {
    if (!silencioso) ocultarAviso();

    try {
        const resp = await fetch(`${API_URL}/api/procesos`, { credentials: "include" });

        if (resp.status === 401 || resp.status === 403) {
            mostrarAviso("Tu sesión expiró. Recarga la página para volver a entrar.");
            return;
        }
        if (!resp.ok) {
            mostrarAviso("No pudimos conectar con el servidor. Intenta más tarde o contacta al administrador.");
            return;
        }

        const procesos = await resp.json();
        window._ultimosProcesos = procesos;
        hayEnPreparacion = procesos.some(p => p.estado === "procesando");

        procesos.forEach(p => {
            const previo = procesosConocidos.get(p.id);
            if (!primeraCarga && previo === "procesando" && p.estado !== "procesando") {
                avisar(
                    p.estado !== "completado" ? "No se pudo completar" : (/revisar|fall|no alcanz|cancelad/i.test(p.resumen || "") ? "Terminó, pero no salieron todos" : "Documento listo"),
                    titulo(p)
                );
            }
            procesosConocidos.set(p.id, p.estado);
        });
        primeraCarga = false;

        pintarProcesos(procesos);
    } catch (error) {
        if (!silencioso) mostrarAviso("No pudimos conectar con el servidor. Verifica tu conexión.");
    }
}

function pintarProcesos(todos) {
        // Lo programado para la madrugada no va aquí: avisa en la campana y vive en Configuración › Programaciones
        const D = Fiscontable.descargas;
        const procesos = D.sinProgramadas(todos).filter(pasaFiltro);
        const preparando = procesos.filter(p => p.estado === "procesando");
        const listos = procesos.filter(p => p.estado === "completado");
        const atencion = procesos.filter(p => p.estado !== "procesando" && p.estado !== "completado");

        document.getElementById("seccion-preparando").classList.toggle("hidden", preparando.length === 0);
        document.getElementById("seccion-listos").classList.toggle("hidden", listos.length === 0);
        document.getElementById("seccion-atencion").classList.toggle("hidden", atencion.length === 0);
        document.getElementById("estado-vacio").classList.toggle("hidden", procesos.length > 0);
        document.getElementById("vacio-titulo").textContent = todos.length ? "Nada con estos filtros" : "Todavía no has descargado nada";
        document.getElementById("vacio-texto").textContent = todos.length ? "Prueba con «7 días», «Todo» o «Todas las empresas»." : "Aquí aparecen tus constancias, opiniones, declaraciones y XML.";

        // Misma tarjeta y mismas acciones que el panel de Descargas de la barra
        document.getElementById("nota-programadas").innerHTML = D.notaProgramadas(todos);
        document.getElementById("lista-preparando").innerHTML = preparando.map(D.tarjeta).join("");
        tablaListos().ponerDatos(listos.map(filaLista));
        document.getElementById("lista-atencion").innerHTML = atencion.map(D.tarjeta).join("");
}


/* ---------- «Listos para descargar»: tabla estándar + detalle en el panel lateral (M-19) */
let tListos = null;
function resumenDe(p) {
    if (p.resumen) return p.resumen.replace(/^[^:]*:\s*/, "").replace(/\.$/, "");
    if (p.clase === "lote") return [`${p.exitosos} de ${p.total} obtenidos`].concat(p.reutilizados ? [`${p.reutilizados} ya los tenías`] : []).join(" · ");
    return "";
}
function filaLista(p) {
    return Object.assign({}, p, {
        documento: nombreDocumento(p), quien: Fiscontable.descargas.empresa(p), rfc_txt: p.clase === "lote" || p.titulo === "VARIOS" ? "" : p.titulo,
        tipo_txt: GRUPOS_TIPO[grupoTipo(p.tipo)] || "Otros", resultado: resumenDe(p),
        incompleto: (p.fallidos && p.fallidos.length) || /revisar|fall|no alcanz|cancelad/i.test(p.resumen || "") ? "Sí" : "No",
        en_mi_pc: p.en_pc && p.en_pc.rutas && p.en_pc.rutas.length ? "Sí" : "No"
    });
}
function tablaListos() {
    if (tListos) return tListos;
    tListos = FCTabla.estandar({
        contenedor: document.getElementById("tabla-dsc"), id: "descargas", claveFila: "id",
        catalogo: [
            { clave: "creado_en", etiqueta: "Fecha", tipo: "fecha" }, { clave: "documento", etiqueta: "Documento", tipo: "texto" },
            { clave: "quien", etiqueta: "Empresa", tipo: "texto" }, { clave: "rfc_txt", etiqueta: "RFC", tipo: "texto" }, { clave: "tipo_txt", etiqueta: "Tipo", tipo: "texto" },
            { clave: "resultado", etiqueta: "Resultado", tipo: "texto" }, { clave: "incompleto", etiqueta: "Faltaron", tipo: "texto" },
            { clave: "en_mi_pc", etiqueta: "En mi PC", tipo: "texto" }, { clave: "acciones", etiqueta: "Archivo", tipo: "texto" }
        ],
        predeterminadas: ["creado_en", "documento", "quien", "resultado", "acciones"],
        anchoClave: { documento: 240, quien: 170, resultado: 260, acciones: 130, tipo_txt: 170 },
        celda: (c, p) => {
            if (c.clave === "acciones") return p.url_descarga ? `<button type="button" class="ui-btn ui-btn--primario ui-btn--28" data-bajar="${esc(p.id)}">Descargar</button>` : "";
            if (c.clave === "incompleto") return p.incompleto === "Sí" ? '<span class="xml-sello xml-sello--ambar">Sí</span>' : "";
            return null;
        },
        buscar: { texto: "Buscar documento, empresa o RFC…", campos: ["documento", "quien", "rfc_txt", "resultado"] },
        filtros: [{ clave: "documento", etiqueta: "Documento" }, { clave: "incompleto", etiqueta: "Faltaron" }],
        vacio: { titulo: "Nada listo", texto: "" },
        alClic: (p, lista, ev) => {
            const b = ev && ev.target.closest("[data-bajar]");
            if (b) { descargar(p.url_descarga, p.nombre_descarga || "", b); return; }
            verDescarga(p, lista);
        }
    });
    return tListos;
}
function fechaLarga(iso) {
    const f = new Date(String(iso).length <= 19 ? iso + "Z" : iso);
    return isNaN(f) ? "" : f.toLocaleString("es-MX", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
const MODULO_DE = { constancias: ["/herramientas/constancias/", "Constancia fiscal"], xml: ["/herramientas/descarga-xml/", "Descarga masiva"],
                    declaraciones: ["/herramientas/declaraciones/", "Declaraciones"], buzon: ["/herramientas/buzon/", "Buzón Tributario"] };
function verDescarga(p, lista) {
    const ids = (lista || [p]).map(x => x.id);
    Fiscontable.panel({
        titulo: "Descarga", lista: ids, i: ids.indexOf(p.id),
        pintar: (id, cuerpo) => {
            const x = (window._ultimosProcesos || []).find(q => q.id === id);
            if (!x) { cuerpo.innerHTML = '<p class="xml-tenue">Ya no está en la lista.</p>'; return; }
            const f = filaLista(x), g = grupoTipo(x.tipo), mod = MODULO_DE[g] || (g === "programada" ? ["/configuracion/?seccion=programaciones", "Programaciones"] : null);
            const pc = x.en_pc && x.en_pc.rutas && x.en_pc.rutas.length;
            cuerpo.innerHTML = `<h4>${esc(f.documento)}</h4>
                <dl class="fc-panel__datos"><dt>Empresa</dt><dd>${esc(f.quien)}</dd><dt>Tipo</dt><dd>${esc(f.tipo_txt)}</dd>
                <dt>Fecha</dt><dd>${esc(fechaLarga(x.creado_en))}</dd>
                ${x.usuario ? `<dt>Pidió</dt><dd>${esc(x.usuario)}</dd>` : ""}
                ${f.resultado ? `<dt>Resultado</dt><dd>${esc(f.resultado)}</dd>` : ""}
                ${x.nombre_descarga ? `<dt>Archivo</dt><dd>${esc(x.nombre_descarga)}</dd>` : ""}
                ${pc ? `<dt>En tu equipo</dt><dd>${esc(Fiscontable.textoEnPc(x.en_pc))}</dd>` : ""}</dl>
                ${x.fallidos && x.fallidos.length ? `<p class="fc-panel__texto">Sin resultado para ${x.fallidos.length} contribuyente${x.fallidos.length === 1 ? "" : "s"}. <button type="button" class="xml-enlace" data-motivos>Ver por qué</button></p>` : ""}
                ${f.incompleto === "Sí" && !(x.fallidos && x.fallidos.length) ? '<p class="fc-panel__texto">No salieron todos. El detalle por RFC está en el módulo.</p>' : ""}
                <div class="fc-panel__acciones">
                    ${x.url_descarga ? '<button type="button" class="ui-btn ui-btn--primario ui-btn--32" data-p="bajar">Descargar</button>' : ""}
                    ${pc ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-p="pc">Abrir carpeta</button>' : ""}
                    ${mod ? `<a class="ui-btn ui-btn--terciario ui-btn--32" href="${mod[0]}">Ir a ${esc(mod[1])}</a>` : ""}
                    <button type="button" class="ui-btn ui-btn--terciario ui-btn--32" data-p="quitar">Quitar de la lista</button>
                </div>`;
            cuerpo.onclick = (e) => {
                if (e.target.closest("[data-motivos]")) { verMotivos(x.id); return; }
                const b = e.target.closest("[data-p]"); if (!b) return;
                if (b.dataset.p === "bajar") descargar(x.url_descarga, x.nombre_descarga || "", b);
                else if (b.dataset.p === "pc") Fiscontable.mostrarEnPc(x.en_pc, b);
                else if (b.dataset.p === "quitar") quitar(x.clase, x.id, b).then(() => { document.querySelector('.fc-cfdi--panel [data-pnl="cerrar"]').click(); });
            };
        }
    });
}

// Lo hizo el agente: le pide a esa PC que abra la carpeta donde quedó
function mostrarPc(id, boton) {
    const p = (window._ultimosProcesos || []).find(x => String(x.id) === String(id));
    if (p && p.en_pc) Fiscontable.mostrarEnPc(p.en_pc, boton);
}

// Las tarjetas son las del panel de la barra: sus botones se atienden con el mismo código
["lista-preparando", "lista-atencion"].forEach(id => {
    document.getElementById(id).addEventListener("click", e => Fiscontable.descargas.accion(e));
});
document.addEventListener("fc-descargas-cambio", () => cargarDescargas(true));
// «ver por qué» desde el panel de otra página: /descargas/?motivos=<id>
(function () {
    const id = new URLSearchParams(location.search).get("motivos");
    if (!id) return;
    const t = setInterval(() => { if (window._ultimosProcesos) { clearInterval(t); verMotivos(id); } }, 300);
    setTimeout(() => clearInterval(t), 10000);
})();
