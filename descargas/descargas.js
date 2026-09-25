/**
 * descargas.js — código de descargas/ (antes vivía dentro del HTML).
 */
const API_URL = Fiscontable.API;          // la dirección vive solo en assets/js/nucleo.js
const esc = Fiscontable.escapar;          // todo texto del servidor pasa por aquí antes de ir al HTML
let hayEnPreparacion = false;
let procesosConocidos = new Map();
let primeraCarga = true;

document.addEventListener("DOMContentLoaded", () => {
    cargarDescargas();
    revisarEstadoNotificaciones();
    programarRefresco();
});

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

function revisarEstadoNotificaciones() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
        document.getElementById("banner-notif").classList.remove("hidden");
    }
}
async function pedirPermisoNotificaciones() {
    if (!("Notification" in window)) return;
    await Notification.requestPermission();
    document.getElementById("banner-notif").classList.add("hidden");
}
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
            mostrarAviso("No se pudo descargar. Puede que el archivo ya haya expirado.");
            return;
        }
        const blob = await resp.blob();
        const a = document.createElement("a");
        a.href = window.URL.createObjectURL(blob);
        a.download = nombre || "documento";
        a.click();
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

function tarjetaLista(p) {
    let resumen = formatearFecha(p.creado_en);
    if (p.clase === "lote") {
        const partes = [`${p.exitosos} de ${p.total} obtenidos`];
        if (p.reutilizados) partes.push(`${p.reutilizados} ya los tenías`);
        resumen = partes.join(" · ") + " · " + formatearFecha(p.creado_en);
    }
    const avisoFallidos = (p.fallidos && p.fallidos.length)
        ? `<button data-id="${esc(p.id)}" onclick="verMotivos(this.dataset.id)" class="text-xs text-amber-700 hover:text-amber-900 underline mt-1.5">
               Sin resultado para ${p.fallidos.length} contribuyente${p.fallidos.length === 1 ? "" : "s"} — ver por qué
           </button>`
        : "";
    return `
    <div class="bg-white rounded-xl card-elevated border border-gray-200 p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex-grow">
                <h3 class="font-bold text-slate-800">${esc(titulo(p))}</h3>
                <p class="text-xs text-slate-500 mt-0.5">${esc(resumen)}</p>
                ${avisoFallidos}
            </div>
            <div class="flex items-center gap-2 flex-none">
                <button data-url="${esc(p.url_descarga)}" data-nombre="${esc(p.nombre_descarga || "")}" onclick="descargar(this.dataset.url, this.dataset.nombre, this)" class="bg-green-600 hover:bg-green-500 text-white text-xs font-bold py-2 px-4 rounded-lg transition">Descargar</button>
                <button data-clase="${esc(p.clase)}" data-id="${esc(p.id)}" onclick="quitar(this.dataset.clase, this.dataset.id, this)" title="Quitar de la lista" class="text-gray-300 hover:text-red-500 transition p-1">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
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

    const botonReintentar = puedeReintentar
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
                    <p class="text-xs text-slate-400 mt-0.5">${formatearFecha(p.creado_en)}</p>
                </div>
            </div>
            <div class="flex items-center gap-2 flex-none">
                ${botonReintentar}
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
        const ruta = clase === "lote" ? `/api/lotes/${id}/cancelar` : `/api/trabajos/${id}/cancelar`;
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
                    p.estado === "completado" ? "Documento listo" : "No se pudo completar",
                    titulo(p)
                );
            }
            procesosConocidos.set(p.id, p.estado);
        });
        primeraCarga = false;

        const preparando = procesos.filter(p => p.estado === "procesando");
        const listos = procesos.filter(p => p.estado === "completado");
        const atencion = procesos.filter(p => p.estado !== "procesando" && p.estado !== "completado");

        document.getElementById("seccion-preparando").classList.toggle("hidden", preparando.length === 0);
        document.getElementById("seccion-listos").classList.toggle("hidden", listos.length === 0);
        document.getElementById("seccion-atencion").classList.toggle("hidden", atencion.length === 0);
        document.getElementById("estado-vacio").classList.toggle("hidden", procesos.length > 0);

        document.getElementById("lista-preparando").innerHTML = preparando.map(tarjetaPreparando).join("");
        document.getElementById("lista-listos").innerHTML = listos.map(tarjetaLista).join("");
        document.getElementById("lista-atencion").innerHTML = atencion.map(tarjetaAtencion).join("");

    } catch (error) {
        if (!silencioso) mostrarAviso("No pudimos conectar con el servidor. Verifica tu conexión.");
    }
}
