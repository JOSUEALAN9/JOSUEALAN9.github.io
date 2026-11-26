/**
 * descargas.js — código de descargas/ (antes vivía dentro del HTML).
 */
const API_URL = Fiscontable.API;          // la dirección vive solo en assets/js/nucleo.js
const esc = Fiscontable.escapar;          // todo texto del servidor pasa por aquí antes de ir al HTML
let hayEnPreparacion = false;
let procesosConocidos = new Map();
let primeraCarga = true;

// M-19: por defecto se ve lo de HOY; los filtros se recuerdan en este navegador. 25-nov-2026 (el dueño): el filtro de
// empresa es el alcance de arriba («Mis asignadas · Todas · Una empresa…»), el mismo del cajón de la barra.
const FILTRO = (() => { try { return Object.assign({ cuando: "hoy", tipo: "" }, JSON.parse(localStorage.getItem("fc-descargas-filtro") || "{}")); } catch (e) { return { cuando: "hoy", tipo: "" }; } })();
// El aviso de un envío (o el del paquete de la noche) trae «?paquete=<id>»: se abre viendo ese paquete, en su pestaña (19-nov,
// el dueño: «con el link podamos identificar el descargar correcto»; Z25). «Ver todas» lo quita.
let PAQUETE = new URLSearchParams(location.search).get("paquete") || "";
let paqueteUbicado = false;
let repintarControles = null;

document.addEventListener("DOMContentLoaded", async () => {
    const D = Fiscontable.descargas;
    if (new URLSearchParams(location.search).get("pestana") === "automaticas") D.pestana("automaticas");
    repintarControles = D.controles(document.getElementById("dsc-controles"), alCambiarControles);
    prepararFiltros();
    await cargarDescargas();
    D.automaticas(false).then(() => { if (repintarControles) repintarControles(); pintarDeNuevo(); });
    programarRefresco();
});
function alCambiarControles(que) {
    if (que === "alcance") { cargarDescargas(true); Fiscontable.descargas.automaticas(false).then(pintarDeNuevo); return; }   // ya se pidió al elegir
    pintarDeNuevo();
    if (Fiscontable.descargas.pestana() === "automaticas") Fiscontable.descargas.automaticas(false).then(pintarDeNuevo);
}

function grupoTipo(t) {
    t = t || "";
    if (t.startsWith("programada_")) return "programada";
    if (/csf|opinion/.test(t)) return "constancias";
    if (/^envio/.test(t)) return "envios";
    if (/xml/.test(t)) return "xml";
    if (/declarac|voucheo/.test(t)) return "declaraciones";
    if (/buzon/.test(t)) return "buzon";
    return "otros";
}
const GRUPOS_TIPO = { "": "Todos los tipos", constancias: "Constancias y opiniones", xml: "XML", declaraciones: "Declaraciones y voucheo",
                      buzon: "Buzón", envios: "Envíos", programada: "Programadas", otros: "Otros" };

function prepararFiltros() {
    const caja = document.getElementById("dsc-filtros");
    if (!caja) return;
    // 25-nov-2026 (revisión de Fable a mdes): el filtro de fechas va en pastillas (fc-chip), no en otra barra segmentada igual a la
    // de «Mis pedidos · Automáticas» de arriba: así se ve que es un filtro y no otra pestaña
    caja.innerHTML =
        '<div class="fc-chips dsc-cuando" role="group" aria-label="Cuándo"><span class="dsc-filtros__etq">Cuándo</span>' +
        [["hoy", "Hoy"], ["7", "7 días"], ["30", "30 días"], ["todo", "Todo"]].map(([v, t]) =>
            `<button type="button" class="fc-chip" data-cuando="${v}" aria-pressed="${FILTRO.cuando === v}">${t}</button>`).join("") + "</div>" +
        '<select class="ui-select" id="dsc-tipo" aria-label="Tipo">' + Object.entries(GRUPOS_TIPO).map(([v, t]) =>
            `<option value="${v}"${FILTRO.tipo === v ? " selected" : ""}>${esc(t)}</option>`).join("") + "</select>";
    caja.onclick = (e) => {
        const b = e.target.closest("[data-cuando]"); if (!b) return;
        FILTRO.cuando = b.dataset.cuando; guardarFiltro(); prepararFiltros(); pintarDeNuevo();
    };
    caja.onchange = (e) => {
        if (e.target.id === "dsc-tipo") FILTRO.tipo = e.target.value;
        guardarFiltro(); pintarDeNuevo();
    };
}
function guardarFiltro() { try { localStorage.setItem("fc-descargas-filtro", JSON.stringify(FILTRO)); } catch (e) { /* nada */ } }
function deUnaEmpresa() { const a = Fiscontable.descargas.alcance(); return !!a && a !== "todas" && a !== "asignadas"; }
function esElPaquete(p) { return !!PAQUETE && (p.grupo === PAQUETE || String(p.id) === PAQUETE); }
function pasaFiltro(p) {
    if (PAQUETE) {          // solo ese paquete: el entero si esta persona lo tiene; si no, los de sus empresas
        if (!esElPaquete(p)) return false;
        return !(p.tipo === "envio_parte" && Fiscontable.descargas.tieneEntero(p, window._ultimosProcesos));
    }
    // El paquete de una sola empresa: quien tiene todas las empresas lo ve con «Una empresa»; con «Todas» trabaja con el
    // entero (aunque ya lo haya quitado de su lista: los sueltos siguen ahí para su equipo, no para él)
    if (p.tipo === "envio_parte" && p.parte_de_todo && !deUnaEmpresa()) return false;
    if (p.estado === "procesando") return true;                      // lo que sigue trabajando siempre se ve
    if (FILTRO.cuando !== "todo") {
        const f = new Date(String(p.creado_en).length <= 19 ? p.creado_en + "Z" : p.creado_en);
        const limite = new Date();
        if (FILTRO.cuando === "hoy") limite.setHours(0, 0, 0, 0); else limite.setDate(limite.getDate() - (+FILTRO.cuando));
        if (f < limite) return false;
    }
    if (FILTRO.tipo && grupoTipo(p.tipo) !== FILTRO.tipo) return false;
    // Un envío de varias empresas deja el paquete entero y el de cada una. Con «Una empresa» se ve el suyo; con «Todas», el
    // entero (si esta persona lo tiene: en un despacho, quien tiene empresas limitadas solo recibe los suyos)
    if (p.tipo === "envio_parte" && !deUnaEmpresa() && Fiscontable.descargas.tieneEntero(p, window._ultimosProcesos)) return false;
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

function verTodas() { PAQUETE = ""; try { history.replaceState(null, "", location.pathname); } catch (e) { /* nada */ } pintarDeNuevo(); }
window.verTodas = verTodas;

/* «Limpiar lista»: quita lo que se está viendo en «Listos para descargar» (con los filtros puestos), de una vez. */
async function limpiarListos() {
    const D = Fiscontable.descargas;
    const listos = D.dePestana(window._ultimosProcesos || [], "pedidos").filter(pasaFiltro).filter(p => p.estado === "completado");
    if (!listos.length) return;
    const si = await Fiscontable.confirmar({
        titulo: "¿Quitar " + (listos.length === 1 ? "esta descarga" : "estas " + listos.length + " descargas") + " de la lista?", si: "Limpiar", peligro: true,
        texto: "Se quitan de Mis descargas y se borra su archivo de aquí. Son las que estás viendo con los filtros puestos. " +
               "Tus XML siguen en Administración de XML y lo que ya bajaste a tu equipo no se toca. De todos modos se borran solas a los días."
    });
    if (!si) return;
    try {
        const resp = await fetch(`${API_URL}/api/procesos/quitar`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ procesos: listos.map(p => ({ clase: p.clase, id: p.id })) }) });
        if (!resp.ok) { mostrarAviso(await Fiscontable.leerError(resp)); return; }
    } catch (e) { mostrarAviso("No se pudo conectar con el servidor."); return; }
    await cargarDescargas(true);
    document.dispatchEvent(new Event("fc-descargas-refrescar"));
}

async function limpiarTodosLosFallidos() {
    if (!(await Fiscontable.confirmar({ titulo: "¿Quitar todas las que no se completaron?", texto: "Solo salen de esta lista; no se borra nada que ya se haya descargado.", si: "Quitar todas" }))) return;
    const fallidos = Fiscontable.descargas.dePestana(window._ultimosProcesos || [], "pedidos").filter(p => p.estado !== "completado" && p.estado !== "procesando");
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
        // 22-nov-2026 (auditoría datos-1): la página pide todo lo que se guarda (7 días), no solo lo más reciente de todo el
        // despacho: así «7 días», «30 días» y «Todo» sí lo tienen aunque cada noche entren ~100 descargas automáticas
        // 25-nov-2026: con el alcance de arriba (Mis asignadas · Todas · Una empresa)
        const resp = await fetch(Fiscontable.descargas.urlProcesos("limite=3000"), { credentials: "include" });

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
        const D = Fiscontable.descargas;
        // 25-nov-2026: el aviso de un paquete (?paquete=) abre la pestaña donde está; el de la noche, su ronda abierta
        if (PAQUETE && !paqueteUbicado) {
            const p = todos.find(esElPaquete);
            if (p) {
                paqueteUbicado = true;
                if (D.pestana() !== p.pestana) { D.pestana(p.pestana); if (repintarControles) repintarControles(); }
                if (p.pestana === "automaticas" && p.noche && /^programada_/.test(p.tipo || "")) { D.resaltar(p.noche); PAQUETE = ""; }
            }
        }
        const auto = D.pestana() === "automaticas";
        document.getElementById("seccion-automaticas").hidden = !auto;
        document.getElementById("dsc-filtros").hidden = auto;
        if (auto) { pintarAutomaticas(todos); return; }
        // Lo programado para la madrugada y lo automático no van aquí: «Automáticas» (y Configuración › Lo automático)
        const procesos = D.dePestana(todos, "pedidos").filter(pasaFiltro);
        const preparando = procesos.filter(p => p.estado === "procesando");
        const listos = procesos.filter(p => p.estado === "completado");
        const atencion = procesos.filter(p => p.estado !== "procesando" && p.estado !== "completado");

        // 25-nov-2026 (revisión de Fable a mdes): la nota vivía dentro de «Listos para descargar», que se esconde cuando el paquete
        // ya no está: «Ese paquete ya no está» nunca se veía. Ahora va arriba de las secciones y cuenta todo lo del paquete.
        const nota = document.getElementById("dsc-paquete");
        if (nota) {
            nota.hidden = !PAQUETE;
            if (PAQUETE) nota.innerHTML = (procesos.length ? "Estás viendo solo el paquete de ese envío. " : "Ese paquete ya no está: se borró o pasaron sus días. ") +
                '<button type="button" class="xml-enlace" data-fc-clic="verTodas">Ver todas las descargas</button>';
        }
        const limpiar = document.getElementById("dsc-limpiar"); if (limpiar) limpiar.hidden = !!PAQUETE || !listos.length;
        document.getElementById("seccion-preparando").classList.toggle("hidden", preparando.length === 0);
        document.getElementById("seccion-listos").classList.toggle("hidden", listos.length === 0);
        document.getElementById("seccion-atencion").classList.toggle("hidden", atencion.length === 0);
        document.getElementById("estado-vacio").classList.toggle("hidden", procesos.length > 0 || !!PAQUETE);   // con ?paquete= lo dice la nota
        document.getElementById("vacio-titulo").textContent = todos.length ? "Nada con estos filtros" : "Todavía no has descargado nada";
        document.getElementById("vacio-texto").textContent = todos.length ? "Prueba con «7 días», «Todo» o «Todas» arriba." : "Aquí aparece lo que pides: constancias, opiniones, declaraciones, XML y reportes. Lo que Fiscontable hace solo está en «Automáticas».";

        // Misma tarjeta y mismas acciones que el panel de Descargas de la barra
        document.getElementById("nota-programadas").innerHTML = "";
        document.getElementById("lista-preparando").innerHTML = preparando.map(D.tarjeta).join("");
        tablaListos().ponerDatos(listos.map(filaLista));
        document.getElementById("lista-atencion").innerHTML = atencion.map(D.tarjeta).join("");
        // Lo que tienes enfrente ya lo viste: el número de «Descargas» baja aquí también (19-nov-2026). La bolita de
        // «nuevo» se queda en esta vista; desaparece la próxima vez.
        if (D.marcarVistos) D.marcarVistos(listos.concat(atencion).filter(p => !p.visto));
        const ret = document.getElementById("dsc-retencion"); if (ret) ret.style.visibility = "";
}

/* ---------- «Automáticas» (25-nov-2026): las rondas y lo automático con archivo, como en el cajón de la barra */
function pintarAutomaticas(todos) {
    const D = Fiscontable.descargas;
    ["seccion-preparando", "seccion-listos", "seccion-atencion", "estado-vacio"].forEach(id => document.getElementById(id).classList.add("hidden"));
    const notaPedidos = document.getElementById("dsc-paquete"); if (notaPedidos) notaPedidos.hidden = true;     // la de «Mis pedidos»
    document.getElementById("nota-programadas").innerHTML = "";
    const caja = document.getElementById("dsc-auto"), nota = document.getElementById("dsc-paquete-auto");
    const solo = PAQUETE ? todos.filter(pasaFiltro) : null;
    nota.hidden = !PAQUETE;
    if (PAQUETE) {
        nota.innerHTML = (solo.length ? "Estás viendo solo el paquete de ese envío. " : "Ese paquete ya no está: se borró o pasaron sus días. ") +
            '<button type="button" class="xml-enlace" data-fc-clic="verTodas">Ver todo lo automático</button>';
        D.ponerHtml(caja, solo.length ? '<div class="fc-filas">' + solo.map(p => D.tarjeta(p)).join("") + "</div>" : "");
    } else D.ponerHtml(caja, D.htmlAutomaticas(todos));
    const vistos = D.dePestana(todos, "automaticas").filter(p => p.clase !== "programada" && !p.visto);
    if (D.marcarVistos && vistos.length) D.marcarVistos(vistos);
    const ret = document.getElementById("dsc-retencion"); if (ret) ret.style.visibility = "";
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
        documento: Fiscontable.descargas.queEs(p) + " · " + (p.detalle || nombreDocumento(p)), quien: Fiscontable.descargas.empresa(p), rfc_txt: p.clase === "lote" || p.titulo === "VARIOS" ? "" : p.titulo,
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
        predeterminadas: ["creado_en", "quien", "documento", "resultado", "acciones"],          // 25-nov-2026: la empresa primero
        anchoClave: { documento: 240, quien: 170, resultado: 260, acciones: 130, tipo_txt: 170 },
        celda: (c, p) => {
            if (c.clave === "acciones") return p.url_descarga ? `<button type="button" class="ui-btn ui-btn--primario ui-btn--28" data-bajar="${esc(p.id)}">Descargar</button>` : "";
            if (c.clave === "documento") return Fiscontable.descargas.etiquetaQue(p);
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
            const f = filaLista(x), g = grupoTipo(x.tipo), mod = MODULO_DE[g] || (g === "programada" ? ["/configuracion/?seccion=automatico&sub=programado", "Lo automático"] : null);
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
// «Automáticas»: las rondas (abrir, buscar, chips, «Ver XML →») y las descargas de lo que dejó archivo
document.getElementById("dsc-auto").addEventListener("click", e => { if (!Fiscontable.descargas.clic(e, alCambiarControles)) Fiscontable.descargas.accion(e); });
document.getElementById("dsc-auto").addEventListener("input", e => Fiscontable.descargas.buscarEnRonda(e));
document.addEventListener("fc-descargas-cambio", () => cargarDescargas(true));
// «ver por qué» desde el panel de otra página: /descargas/?motivos=<id>
(function () {
    const id = new URLSearchParams(location.search).get("motivos");
    if (!id) return;
    const t = setInterval(() => { if (window._ultimosProcesos) { clearInterval(t); verMotivos(id); } }, 300);
    setTimeout(() => clearInterval(t), 10000);
})();
