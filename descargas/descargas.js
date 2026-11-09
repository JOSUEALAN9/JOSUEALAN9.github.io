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
                      buzon: "Buzón", programada: "Programadas de madrugada", otros: "Otros" };

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

function nombreDocumento(p) {
    const tipos = {
        "csf": "Constancia de Situación Fiscal",
        "opinion": "Opinión de Cumplimiento",
        "csf+opinion": "Constancia y Opinión",
        "programada_csf": "🌙 Programada · Constancias",
        "programada_opinion": "🌙 Programada · Opiniones",
        "programada_declaraciones": "🌙 Programada · Declaraciones",
        "programada_xml": "🌙 Programada · Descarga de XML",
        "programada_buzon": "🌙 Programada · Buzón Tributario",
        "descarga_xml": "Descarga masiva de XML",
        "declaraciones": "Declaraciones",
        "voucheo": "Voucheo de impuestos",
        "buzon_revisar": "Revisión del Buzón Tributario",
        "buzon_abrir": "Apertura de notificación del Buzón",
    };
    return tipos[p.tipo] || p.tipo;
}

function titulo(p) {
    if (p.clase === "lote") {
        const n = p.total || "varios";
        return `${nombreDocumento(p)} — ${n} contribuyentes`;
    }
    return `${nombreDocumento(p)} — ${p.titulo}`;
}

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

function tarjetaPreparando(p) {
    let detalle = "Preparando...";
    let barra = "";
    if (p.clase === "lote" && p.total > 0) {
        const pct = Math.round((p.procesados / p.total) * 100);
        detalle = `${p.procesados} de ${p.total}${p.rfc_actual ? " · " + p.rfc_actual : ""}`;
        barra = `<div class="progress-track mt-2"><div class="progress-fill bg-blue-500" style="width:${pct}%"></div></div>`;
    }
    if (p.clase === "programada") detalle = p.progreso || "Programada para la madrugada.";
    return `
    <div class="bg-white rounded-xl card-elevated border border-gray-200 p-5">
        <div class="flex items-start gap-3">
            <svg class="animate-spin h-5 w-5 text-blue-500 flex-none mt-0.5" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
            <div class="flex-grow">
                <h3 class="font-bold text-slate-800">${esc(titulo(p))}</h3>
                <p class="text-xs text-slate-500 mt-0.5">${esc(detalle)}</p>
                ${barra}
            </div>
            <button data-clase="${esc(p.clase)}" data-id="${esc(p.id)}" onclick="cancelar(this.dataset.clase, this.dataset.id, this)" class="text-xs font-bold text-slate-400 hover:text-red-600 border border-gray-200 hover:border-red-200 rounded-lg py-1.5 px-3 transition flex-none">
                Detener
            </button>
        </div>
    </div>`;
}

function tarjetaAtencion(p) {
    const motivo = p.mensaje_error || "No se pudo completar.";

    // El botón de reintentar SOLO aparece si el problema fue del
    // SAT. Si fue la e.firma (contraseña, vencida, revocada,
    // archivos que no corresponden), reintentar no serviría de
    // nada: hay que corregir los archivos primero.
    const puedeReintentar = p.clase === "lote"
        ? (p.reintentables || 0) > 0
        : p.reintentable === true;

    // Lote que se cortó (reinicio del servidor): reanudar sigue donde se quedó (lo que ya salió no se vuelve a
    // pedir al SAT ni gasta del contador del día); y lo que sí salió se puede bajar desde ya.
    const faltan = Math.max((p.total || 0) - (p.exitosos || 0), 0);
    const botonReanudar = p.clase === "lote" && p.se_puede_reanudar
        ? `<button data-id="${esc(p.id)}" onclick="reanudar(this.dataset.id, this)" class="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2 px-4 rounded-lg transition">Reanudar ${faltan ? "los " + faltan + " que faltan" : "el lote"}</button>`
        : "";
    const botonParcial = p.clase === "lote" && p.parcial
        ? `<button data-url="${esc(p.url_descarga)}" data-nombre="${esc(p.nombre_descarga || "Lote_parcial.zip")}" onclick="descargar(this.dataset.url, this.dataset.nombre, this)" class="bg-green-600 hover:bg-green-500 text-white text-xs font-bold py-2 px-4 rounded-lg transition">Bajar lo que salió${p.exitosos ? " (" + p.exitosos + ")" : ""}</button>`
        : "";
    const avisoFallidos = p.clase === "lote" && p.fallidos && p.fallidos.length
        ? `<button data-id="${esc(p.id)}" onclick="verMotivos(this.dataset.id)" class="text-xs text-amber-700 hover:text-amber-900 underline mt-1">Sin resultado para ${p.fallidos.length} — ver por qué</button>`
        : "";
    const avance = p.clase === "lote" && p.total
        ? `<p class="text-xs text-slate-600 mt-1">${p.exitosos || 0} de ${p.total} listos${p.reutilizados ? " · " + p.reutilizados + " ya los tenías" : ""}</p>`
        : "";
    const avisoVencido = p.clase === "lote" && p.estado === "interrumpido" && !p.se_puede_reanudar
        ? `<p class="text-xs text-slate-500 mt-1">Ya no se puede reanudar (pasaron más de 72 h o se descartó). Para los que faltan, vuelve a subir el lote: lo que ya salió se aprovecha.</p>`
        : "";

    const botonReintentar = puedeReintentar && !botonReanudar
        ? `<button data-clase="${esc(p.clase)}" data-id="${esc(p.id)}" onclick="reintentar(this.dataset.clase, this.dataset.id, this)" class="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold py-2 px-4 rounded-lg transition">Reintentar${p.clase === "lote" ? " los " + p.reintentables : ""}</button>`
        : "";
    return `
    <div class="bg-white rounded-xl border border-amber-200 p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex items-start gap-3 flex-grow">
                <svg class="w-5 h-5 text-amber-500 flex-none mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <div>
                    <h3 class="font-bold text-slate-800">${esc(titulo(p))}</h3>
                    <p class="text-xs text-amber-800 mt-1">${esc(motivo)}</p>
                    ${avance}${avisoVencido}
                    <p class="text-xs text-slate-400 mt-0.5">${formatearFecha(p.creado_en)}</p>
                    ${avisoFallidos}
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 flex-none">
                ${botonParcial}${botonReanudar}${botonReintentar}
                <button data-clase="${esc(p.clase)}" data-id="${esc(p.id)}" onclick="quitar(this.dataset.clase, this.dataset.id, this)" title="Quitar de la lista" class="text-gray-300 hover:text-red-500 transition p-1">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
        </div>
    </div>`;
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

async function cancelar(clase, id, boton) {
    if (!confirm("¿Detener esta descarga? Se conservará lo que ya se haya generado.")) return;
    boton.disabled = true;
    boton.textContent = "Deteniendo...";
    try {
        const ruta = clase === "lote" ? `/api/lotes/${id}/cancelar`
            : clase === "programada" ? `/api/programadas/${id}/cancelar` : `/api/trabajos/${id}/cancelar`;
        const resp = await fetch(`${API_URL}${ruta}`, { method: "POST", credentials: "include" });
        if (!resp.ok) {
            mostrarAviso("No se pudo detener. Puede que ya haya terminado.");
            boton.disabled = false; boton.textContent = "Detener";
            return;
        }
        const datos = await resp.json();
        if (datos.mensaje) mostrarAviso(datos.mensaje);
        await cargarDescargas(true);
    } catch (e) {
        mostrarAviso("No se pudo conectar con el servidor.");
        boton.disabled = false; boton.textContent = "Detener";
    }
}

async function reintentar(clase, id, boton) {
    const original = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = "Reintentando...";
    try {
        if (clase === "lote") {
            const resp = await fetch(`${API_URL}/api/lotes/${id}/reintentar`, {
                method: "POST", credentials: "include",
            });
            const datos = await resp.json();
            if (!resp.ok) {
                mostrarAviso(datos.detail || "No se pudo reintentar.");
                return;
            }
            let mensaje = "";
            if (datos.lanzados.length) mensaje += `Se están generando de nuevo: ${datos.lanzados.join(", ")}. `;
            if (datos.sin_efirma.length) {
                mensaje += `Estos necesitan que subas su e.firma desde el módulo: ${datos.sin_efirma.map(s => s.rfc).join(", ")}.`;
            }
            mostrarAviso(mensaje || "Nada que reintentar.");
        } else {
            mostrarAviso("Para reintentar este documento, vuelve al módulo y genéralo de nuevo.");
        }
        await cargarDescargas(true);
    } catch (e) {
        mostrarAviso("No se pudo conectar con el servidor.");
    } finally {
        boton.disabled = false;
        boton.innerHTML = original;
    }
}

async function reanudar(id, boton) {
    const original = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = "Reanudando...";
    try {
        const resp = await fetch(`${API_URL}/api/lotes/${id}/reanudar`, { method: "POST", credentials: "include" });
        if (!resp.ok) {
            mostrarAviso(await Fiscontable.leerError(resp));
            return;
        }
        mostrarAviso("Se reanudó el lote. Sigue donde se quedó; lo que ya había salido no se vuelve a pedir al SAT.");
        await cargarDescargas(true);
    } catch (e) {
        mostrarAviso("No se pudo conectar con el servidor.");
    } finally {
        boton.disabled = false;
        boton.innerHTML = original;
    }
}

async function limpiarTodosLosFallidos() {
    if (!confirm("¿Quitar de la lista todas las descargas que no se completaron?")) return;
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
        const procesos = todos.filter(pasaFiltro);
        const preparando = procesos.filter(p => p.estado === "procesando");
        const listos = procesos.filter(p => p.estado === "completado");
        const atencion = procesos.filter(p => p.estado !== "procesando" && p.estado !== "completado");

        document.getElementById("seccion-preparando").classList.toggle("hidden", preparando.length === 0);
        document.getElementById("seccion-listos").classList.toggle("hidden", listos.length === 0);
        document.getElementById("seccion-atencion").classList.toggle("hidden", atencion.length === 0);
        document.getElementById("estado-vacio").classList.toggle("hidden", procesos.length > 0);
        document.getElementById("vacio-titulo").textContent = todos.length ? "Nada con estos filtros" : "Todavía no has descargado nada";
        document.getElementById("vacio-texto").textContent = todos.length ? "Prueba con «7 días», «Todo» o «Todas las empresas»." : "Aquí aparecen tus constancias, opiniones, declaraciones y XML.";

        document.getElementById("lista-preparando").innerHTML = preparando.map(tarjetaPreparando).join("");
        tablaListos().ponerDatos(listos.map(filaLista));
        document.getElementById("lista-atencion").innerHTML = atencion.map(tarjetaAtencion).join("");
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
        documento: nombreDocumento(p).replace(/^🌙 /, ""), quien: p.clase === "lote" ? `${p.total || "Varios"} contribuyentes` : p.titulo,
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
            { clave: "quien", etiqueta: "Empresa", tipo: "texto" }, { clave: "tipo_txt", etiqueta: "Tipo", tipo: "texto" },
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
        buscar: { texto: "Buscar documento o empresa…", campos: ["documento", "quien", "resultado"] },
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
                ${pc ? `<dt>En tu PC</dt><dd>${esc(Fiscontable.textoEnPc(x.en_pc))}</dd>` : ""}</dl>
                ${x.fallidos && x.fallidos.length ? `<p class="fc-panel__texto">Sin resultado para ${x.fallidos.length} contribuyente${x.fallidos.length === 1 ? "" : "s"}. <button type="button" class="xml-enlace" data-motivos>Ver por qué</button></p>` : ""}
                ${f.incompleto === "Sí" && !(x.fallidos && x.fallidos.length) ? '<p class="fc-panel__texto">No salieron todos. El detalle por RFC está en el módulo.</p>' : ""}
                <div class="fc-panel__acciones">
                    ${x.url_descarga ? '<button type="button" class="ui-btn ui-btn--primario ui-btn--32" data-p="bajar">Descargar</button>' : ""}
                    ${pc ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-p="pc">Mostrar en mi PC</button>' : ""}
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
