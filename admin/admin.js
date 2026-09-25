/**
 * admin.js — página de Administración, en tres pestañas:
 *   Usuarios · Permisos por rol · Actividad
 *
 * La pestaña abierta vive en la dirección (#usuarios, #permisos,
 * #actividad), así que recargar no te regresa al principio.
 * Todo texto que viene del servidor pasa por esc() antes de ir al HTML.
 */
const API_URL = Fiscontable.API;          // la dirección vive solo en assets/js/nucleo.js
const esc = Fiscontable.escapar;

const DIAS_DEMO = 7;
const ESTILO_ROL = {
    admin: { clase: "bg-slate-800 text-white", avatar: "bg-slate-800 text-white" },
    pro:   { clase: "bg-emerald-100 text-emerald-800", avatar: "bg-emerald-100 text-emerald-800" },
    plus:  { clase: "bg-sky-100 text-sky-800", avatar: "bg-sky-100 text-sky-800" },
    demo:  { clase: "bg-amber-100 text-amber-800", avatar: "bg-amber-100 text-amber-800" },
};
const NOMBRE_DOC = {
    csf: "Constancia", opinion: "Opinión", "csf+opinion": "Constancia + Opinión",
    declaraciones: "Declaraciones", voucheo: "Voucheo",
};
const INICIAL_DOC = { csf: "CSF", opinion: "32D", "csf+opinion": "C+O", declaraciones: "DEC", voucheo: "VOU" };

let usuariosCache = [];
let rolesCache = null;          // {modulos:[{clave,nombre}], roles:[...]}
let procesosCache = [];
let correoEnAjustes = null;
let filtroActividad = "todos";
let relojActividad = null;

document.addEventListener("DOMContentLoaded", verificarAdminYCargar);

/* =====================================================================
 * Utilidades
 * ===================================================================== */
const $ = id => document.getElementById(id);

function mostrarAlerta(tipo, mensaje) {
    const container = $("alert-container");
    const alertBox = $("alert-message");
    container.classList.remove("hidden");
    alertBox.className = tipo === "error"
        ? "p-4 rounded-lg text-sm font-semibold flex items-start gap-2 bg-amber-50 text-amber-800 border border-amber-200"
        : "p-4 rounded-lg text-sm font-semibold flex items-start gap-2 bg-green-50 text-green-700 border border-green-200";
    alertBox.innerHTML = `<span>${esc(mensaje)}</span>`;
    clearTimeout(mostrarAlerta._t);
    mostrarAlerta._t = setTimeout(() => container.classList.add("hidden"), 4500);
}

async function interpretarError(response) {
    if (!response) return "No pudimos conectar con el servidor. Intenta de nuevo más tarde.";
    try {
        const data = await response.json();
        if (typeof data.detail === "string" && data.detail) return data.detail;
    } catch { /* sin cuerpo */ }
    if (response.status === 401 || response.status === 403) return "No tienes permiso para esto.";
    return "Ocurrió un error inesperado.";
}

async function api(ruta, opciones = {}) {
    const resp = await fetch(`${API_URL}${ruta}`, { credentials: "include", ...opciones });
    if (!resp.ok) throw new Error(await interpretarError(resp));
    return resp.json();
}

function fechaCorta(iso) {
    if (!iso) return "";
    return new Date(iso.endsWith("Z") ? iso : iso + "Z").toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

function haceCuanto(iso) {
    const t = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    const min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return "hace un momento";
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `hace ${h} h`;
    return t.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function nombreLimite(limite) {
    if (limite === null || limite === undefined) return "sin límite";
    if (limite === 0) return "sin descargas masivas";
    return `hasta ${limite} RFC al día`;
}

function nombresModulos(claves) {
    if (!rolesCache) return claves.join(", ");
    const mapa = Object.fromEntries(rolesCache.modulos.map(m => [m.clave, m.nombre]));
    return claves.map(c => mapa[c] || c).join(", ") || "ninguno";
}

function sello(texto, clase) {
    return `<span class="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ${clase}">${esc(texto)}</span>`;
}

/* =====================================================================
 * Arranque y pestañas
 * ===================================================================== */
async function verificarAdminYCargar() {
    try {
        const perfil = await Fiscontable.perfil();
        if (!perfil || perfil._error) { mostrarAlerta("error", "No se pudo verificar tu acceso. Recarga la página."); return; }
        if (perfil.rol !== "admin") { $("bloqueo-no-admin").classList.remove("hidden"); return; }
        $("contenido-admin").classList.remove("hidden");

        prepararEventos();
        abrirPestana(location.hash.replace("#", "") || "usuarios");
        await cargarRoles();
        await Promise.all([cargarUsuarios(), cargarProcesosAdmin()]);
    } catch (error) {
        mostrarAlerta("error", "No se pudo verificar tu acceso. Intenta de nuevo más tarde.");
    }
}

function abrirPestana(nombre) {
    if (!["usuarios", "permisos", "actividad"].includes(nombre)) nombre = "usuarios";
    document.querySelectorAll("[data-pestana]").forEach(b => {
        const activa = b.dataset.pestana === nombre;
        b.classList.toggle("pestana--activa", activa);
        b.setAttribute("aria-selected", activa ? "true" : "false");
    });
    ["usuarios", "permisos", "actividad"].forEach(p => { $("panel-" + p).hidden = p !== nombre; });
    if (location.hash !== "#" + nombre) history.replaceState(null, "", "#" + nombre);

    // La actividad se refresca sola solo mientras está a la vista.
    clearInterval(relojActividad);
    if (nombre === "actividad") relojActividad = setInterval(cargarProcesosAdmin, 30000);
}

function prepararEventos() {
    document.querySelectorAll("[data-pestana]").forEach(b => b.addEventListener("click", () => abrirPestana(b.dataset.pestana)));
    document.querySelectorAll("[data-cerrar]").forEach(b => b.addEventListener("click", () => $(b.dataset.cerrar).close()));

    // Usuarios
    $("buscar-usuario").addEventListener("input", renderizarUsuarios);
    $("btn-agregar-usuario").addEventListener("click", () => abrirDialogoUsuario(null));
    $("input-rol").addEventListener("change", alCambiarRolFormulario);
    $("form-usuario").addEventListener("submit", guardarUsuario);
    $("tabla-usuarios").addEventListener("click", e => {
        const b = e.target.closest("button[data-accion]");
        if (!b) return;
        const correo = b.dataset.correo;
        if (b.dataset.accion === "ajustes") abrirAjustesUsuario(correo);
        if (b.dataset.accion === "editar") abrirDialogoUsuario(correo);
        if (b.dataset.accion === "quitar") eliminarUsuario(correo);
    });

    // Ajustes propios
    document.querySelectorAll('input[name="ajustes-modo"]').forEach(r => r.addEventListener("change", pintarModoAjustes));
    $("ajustes-limite-modo").addEventListener("change", pintarModoAjustes);
    $("form-ajustes").addEventListener("submit", guardarAjustesUsuario);

    // Permisos
    $("tarjetas-roles").addEventListener("change", e => {
        const tarjeta = e.target.closest("[data-rol]");
        if (tarjeta) marcarCambiosRol(tarjeta.dataset.rol);
    });
    $("tarjetas-roles").addEventListener("input", e => {
        const tarjeta = e.target.closest("[data-rol]");
        if (tarjeta) marcarCambiosRol(tarjeta.dataset.rol);
    });
    $("tarjetas-roles").addEventListener("click", e => {
        const b = e.target.closest("button[data-accion]");
        if (!b) return;
        if (b.dataset.accion === "guardar-rol") guardarRol(b.dataset.rol);
        if (b.dataset.accion === "restaurar-rol") restaurarRol(b.dataset.rol);
        if (b.dataset.accion === "deshacer-rol") renderizarRoles();
    });

    // Actividad
    $("filtros-actividad").addEventListener("click", e => {
        const b = e.target.closest("[data-filtro]");
        if (!b) return;
        filtroActividad = b.dataset.filtro;
        document.querySelectorAll("#filtros-actividad [data-filtro]").forEach(x => x.classList.toggle("adm-filtro--activo", x === b));
        renderizarActividad();
    });
    $("buscar-actividad").addEventListener("input", renderizarActividad);
    $("btn-actualizar-actividad").addEventListener("click", cargarProcesosAdmin);
    $("lista-actividad").addEventListener("click", e => {
        const b = e.target.closest("button[data-accion='detener']");
        if (b) cancelarProcesoAdmin(b.dataset.clase, b.dataset.id, b);
    });
}

/* =====================================================================
 * USUARIOS
 * ===================================================================== */
async function cargarUsuarios() {
    try {
        usuariosCache = await api("/api/usuarios");
        $("cuenta-usuarios").textContent = `(${usuariosCache.length})`;
        renderizarUsuarios();
    } catch (e) { mostrarAlerta("error", e.message); }
}

function venceTexto(u) {
    if (!u.fecha_expira) return `<span class="text-slate-400">Sin vencimiento</span>`;
    const dias = Math.ceil((new Date(u.fecha_expira.endsWith("Z") ? u.fecha_expira : u.fecha_expira + "Z") - Date.now()) / 86400000);
    const fecha = esc(fechaCorta(u.fecha_expira));
    if (dias < 0) return `<span class="text-slate-500">${fecha}</span>`;
    if (dias <= 7) return `<span class="text-amber-700 font-semibold">${fecha}</span><span class="block text-[11px] text-amber-600">${dias === 0 ? "vence hoy" : `en ${dias} ${dias === 1 ? "día" : "días"}`}</span>`;
    return `<span class="text-slate-600">${fecha}</span>`;
}

function renderizarUsuarios() {
    const texto = $("buscar-usuario").value.trim().toLowerCase();
    const lista = usuariosCache.filter(u => !texto || u.correo.includes(texto));
    $("sin-usuarios").classList.toggle("hidden", lista.length > 0);
    const hoyIso = new Date().toISOString();

    $("tabla-usuarios").innerHTML = lista.map(u => {
        const estilo = ESTILO_ROL[u.rol] || ESTILO_ROL.plus;
        const expirado = u.fecha_expira && hoyIso > u.fecha_expira;
        const estatus = !u.activo ? sello("Desactivado", "bg-gray-100 text-gray-500")
            : expirado ? sello("Vencido", "bg-amber-100 text-amber-700")
            : sello("Vigente", "bg-green-100 text-green-700");
        const personal = u.personalizado
            ? `<span class="block mt-1 text-[11px] font-bold text-violet-700" title="${esc(resumenAjustes(u))}">⚙ Personalizado</span>` : "";
        const icono = (d) => `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${d}"></path></svg>`;
        const lapiz = "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z";
        const bote = "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16";
        return `
        <tr class="border-t border-gray-100 hover:bg-slate-50/60">
            <td class="p-4">
                <div class="flex items-center gap-3">
                    <span class="adm-avatar ${estilo.avatar}">${esc(u.correo.charAt(0).toUpperCase())}</span>
                    <span class="font-mono text-xs text-slate-700 break-all">${esc(u.correo)}</span>
                </div>
            </td>
            <td class="p-4">${sello(u.rol.charAt(0).toUpperCase() + u.rol.slice(1), estilo.clase)}${personal}</td>
            <td class="p-4 text-xs">${venceTexto(u)}</td>
            <td class="p-4">${estatus}</td>
            <td class="p-4 text-right whitespace-nowrap">
                ${u.rol === "admin" ? "" : `<button data-accion="ajustes" data-correo="${esc(u.correo)}" title="Módulos y límite solo para esta persona" class="text-xs font-bold text-slate-600 hover:text-slate-900 border border-gray-200 hover:border-slate-400 rounded-lg py-1 px-2.5 mr-1">Ajustes</button>`}
                <button data-accion="editar" data-correo="${esc(u.correo)}" title="Cambiar rol o vigencia" class="p-1.5 text-slate-400 hover:text-slate-800 align-middle">${icono(lapiz)}</button>
                <button data-accion="quitar" data-correo="${esc(u.correo)}" title="Quitar acceso" class="p-1.5 text-gray-300 hover:text-red-500 align-middle">${icono(bote)}</button>
            </td>
        </tr>`;
    }).join("");
}

function abrirDialogoUsuario(correo) {
    const u = correo ? usuariosCache.find(x => x.correo === correo) : null;
    $("titulo-dlg-usuario").textContent = u ? "Editar usuario" : "Agregar usuario";
    $("input-correo").value = u ? u.correo : "";
    $("input-correo").readOnly = !!u;
    $("input-rol").value = u ? u.rol : "demo";
    $("input-fecha").value = u && u.fecha_expira ? u.fecha_expira.slice(0, 10) : "";
    alCambiarRolFormulario();
    $("dlg-usuario").showModal();
    (u ? $("input-rol") : $("input-correo")).focus();
}

function alCambiarRolFormulario() {
    const rol = $("input-rol").value;
    $("etiqueta-fecha").textContent = rol === "demo" ? "Vence (obligatorio)" : "Vence (opcional)";
    if (rol === "demo" && !$("input-fecha").value) {
        $("input-fecha").value = new Date(Date.now() + DIAS_DEMO * 86400000).toISOString().slice(0, 10);
    }
}

async function guardarUsuario(e) {
    e.preventDefault();
    const correo = $("input-correo").value.trim().toLowerCase();
    const rol = $("input-rol").value;
    const fechaInput = $("input-fecha").value;
    const fecha_expira = fechaInput ? new Date(fechaInput + "T23:59:59").toISOString() : null;
    try {
        await api("/api/usuarios", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ correo, rol, fecha_expira, activo: true }),
        });
        $("dlg-usuario").close();
        mostrarAlerta("success", `Usuario ${correo} guardado.`);
        await Promise.all([cargarUsuarios(), cargarRoles()]);
    } catch (err) { mostrarAlerta("error", err.message); }
}

async function eliminarUsuario(correo) {
    const confirmacion = confirm(
        `¿Quitar el acceso de ${correo}?\n\n` +
        `Se borra su rol, su nombre y su teléfono. Si vuelve a entrar, se le pedirán sus datos otra vez y entrará como Demo por ${DIAS_DEMO} días.\n\n` +
        `Sus clientes y documentos NO se borran: los recupera al volver a entrar.\n\n` +
        `Si solo quieres cambiarle el rol o la vigencia, cancela y usa el lápiz.`
    );
    if (!confirmacion) return;
    try {
        await api(`/api/usuarios/${encodeURIComponent(correo)}`, { method: "DELETE" });
        mostrarAlerta("success", `Se quitó el acceso de ${correo}.`);
        await Promise.all([cargarUsuarios(), cargarRoles()]);
    } catch (err) { mostrarAlerta("error", err.message); }
}

/* ---- Ajustes propios ---- */
function resumenAjustes(u) {
    return `Módulos: ${nombresModulos(u.modulos_efectivos || [])} · ${nombreLimite(u.limite_efectivo)}`;
}

function chipModulo(m, marcado, clase) {
    return `<label class="adm-chip"><input type="checkbox" class="${clase}" value="${esc(m.clave)}" ${marcado ? "checked" : ""}>${esc(m.nombre)}</label>`;
}

function abrirAjustesUsuario(correo) {
    const u = usuariosCache.find(x => x.correo === correo);
    if (!u || !rolesCache) return;
    correoEnAjustes = correo;
    const delRol = rolesCache.roles.find(r => r.rol === u.rol) || { modulos: [], limite_rfc_diario: null };

    $("ajustes-correo").textContent = `${u.correo} · rol ${u.rol}`;
    $("ajustes-modulos-rol").textContent = `(${nombresModulos(delRol.modulos)})`;
    document.querySelector(`input[name="ajustes-modo"][value="${u.modulos_propios ? "propios" : "rol"}"]`).checked = true;
    const marcados = u.modulos_propios || delRol.modulos;
    $("ajustes-casillas").innerHTML = rolesCache.modulos.map(m => chipModulo(m, marcados.includes(m.clave), "ajuste-modulo")).join("");

    const sel = $("ajustes-limite-modo");
    sel.options[0].textContent = `El de su rol (${nombreLimite(delRol.limite_rfc_diario)})`;
    if (u.limite_propio === "rol") { sel.value = "rol"; $("ajustes-limite").value = ""; }
    else if (u.limite_propio === "sin") { sel.value = "sin"; $("ajustes-limite").value = ""; }
    else { sel.value = "numero"; $("ajustes-limite").value = u.limite_propio; }

    pintarModoAjustes();
    $("dlg-ajustes").showModal();
}

function pintarModoAjustes() {
    const propios = document.querySelector('input[name="ajustes-modo"]:checked').value === "propios";
    document.querySelectorAll(".ajuste-modulo").forEach(c => { c.disabled = !propios; });
    $("ajustes-limite").style.display = $("ajustes-limite-modo").value === "numero" ? "" : "none";
}

async function guardarAjustesUsuario(e) {
    e.preventDefault();
    const propios = document.querySelector('input[name="ajustes-modo"]:checked').value === "propios";
    const modulos = propios ? Array.from(document.querySelectorAll(".ajuste-modulo:checked")).map(c => c.value) : null;
    const modo = $("ajustes-limite-modo").value;
    let limite = modo;
    if (modo === "numero") {
        const texto = $("ajustes-limite").value.trim();
        limite = Number(texto);
        if (texto === "" || !Number.isInteger(limite) || limite < 0 || limite > 10000) {
            mostrarAlerta("error", "Escribe un número entre 0 y 10,000 para el límite.");
            return;
        }
    }
    try {
        await api(`/api/usuarios/${encodeURIComponent(correoEnAjustes)}/ajustes`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modulos, limite }),
        });
        $("dlg-ajustes").close();
        mostrarAlerta("success", `Ajustes de ${correoEnAjustes} guardados.`);
        await cargarUsuarios();
    } catch (err) { mostrarAlerta("error", err.message); }
}

/* =====================================================================
 * PERMISOS POR ROL (una tarjeta por rol)
 * ===================================================================== */
async function cargarRoles() {
    try {
        rolesCache = await api("/api/admin/roles");
        renderizarRoles();
    } catch (e) { mostrarAlerta("error", e.message); }
}

function modoLimite(limite) {
    if (limite === null || limite === undefined) return "sin";
    if (limite === 0) return "cero";
    return "numero";
}

function renderizarRoles() {
    $("tarjetas-roles").innerHTML = rolesCache.roles.map(r => {
        const estilo = ESTILO_ROL[r.rol] || ESTILO_ROL.plus;
        const cuantos = `${r.usuarios} ${r.usuarios === 1 ? "usuario" : "usuarios"}`;
        if (!r.editable) {
            return `
            <div class="bg-white rounded-xl card-elevated border border-gray-200 p-5 flex flex-wrap items-center gap-3">
                ${sello(r.nombre, estilo.clase)}
                <span class="text-xs text-slate-400">${esc(cuantos)}</span>
                <span class="text-sm text-slate-500 sm:ml-auto">Todos los módulos y esta pantalla · sin límite · no se edita</span>
            </div>`;
        }
        const modo = modoLimite(r.limite_rfc_diario);
        const cambio = r.actualizado_por
            ? `Último cambio: ${esc(r.actualizado_por)}${r.actualizado_en ? " · " + esc(fechaCorta(r.actualizado_en)) : ""}` : "";
        return `
        <div class="bg-white rounded-xl card-elevated border border-gray-200 overflow-hidden" data-rol="${esc(r.rol)}">
            <div class="p-5 flex flex-wrap items-center gap-3 border-b border-gray-100">
                ${sello(r.nombre, estilo.clase)}
                <span class="text-xs text-slate-400">${esc(cuantos)}</span>
                <span class="text-[11px] text-slate-400 sm:ml-auto">${cambio}</span>
            </div>
            <div class="p-5 grid gap-5 md:grid-cols-[1fr_230px]">
                <div>
                    <p class="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">Módulos</p>
                    <div class="flex flex-wrap gap-2">
                        ${rolesCache.modulos.map(m => chipModulo(m, r.modulos.includes(m.clave), "rol-modulo")).join("")}
                    </div>
                </div>
                <div>
                    <p class="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">Descargas masivas</p>
                    <select class="rol-limite-modo w-full text-sm border border-gray-300 rounded-lg p-2.5 bg-white">
                        <option value="sin" ${modo === "sin" ? "selected" : ""}>Sin límite</option>
                        <option value="numero" ${modo === "numero" ? "selected" : ""}>Hasta un número al día</option>
                        <option value="cero" ${modo === "cero" ? "selected" : ""}>No incluye (de uno en uno)</option>
                    </select>
                    <div class="rol-limite-caja mt-2 flex items-center gap-2 ${modo === "numero" ? "" : "hidden"}">
                        <input type="number" min="1" max="10000" class="rol-limite w-24 text-sm border border-gray-300 rounded-lg p-2 text-center" value="${modo === "numero" ? esc(r.limite_rfc_diario) : ""}">
                        <span class="text-xs text-slate-500">RFC nuevos al día</span>
                    </div>
                </div>
            </div>
            <div class="px-5 py-3 bg-slate-50 border-t border-gray-100 flex flex-wrap items-center gap-3">
                ${r.fabrica ? `<button data-accion="restaurar-rol" data-rol="${esc(r.rol)}" class="text-xs text-slate-500 hover:text-slate-800 underline" title="${esc(nombresModulos(r.fabrica.modulos))} · ${esc(nombreLimite(r.fabrica.limite))}">Valores de fábrica</button>` : ""}
                <span class="rol-sin-guardar text-xs font-bold text-amber-700 ml-auto" hidden>Cambios sin guardar</span>
                <button data-accion="deshacer-rol" data-rol="${esc(r.rol)}" class="rol-deshacer text-xs font-bold text-slate-500 border border-gray-200 rounded-lg py-1.5 px-3 bg-white" hidden>Deshacer</button>
                <button data-accion="guardar-rol" data-rol="${esc(r.rol)}" class="rol-guardar bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-default text-white text-xs font-bold py-1.5 px-4 rounded-lg ml-auto" disabled>Guardar cambios</button>
            </div>
        </div>`;
    }).join("");
}

function tarjetaRol(rol) {
    return document.querySelector(`#tarjetas-roles [data-rol="${CSS.escape(rol)}"]`);
}

function leerTarjetaRol(rol) {
    const t = tarjetaRol(rol);
    const modulos = Array.from(t.querySelectorAll(".rol-modulo:checked")).map(c => c.value);
    const modo = t.querySelector(".rol-limite-modo").value;
    let limite = null;
    if (modo === "cero") limite = 0;
    if (modo === "numero") {
        const texto = t.querySelector(".rol-limite").value.trim();
        limite = texto === "" ? NaN : Number(texto);
    }
    return { modulos, limite };
}

function marcarCambiosRol(rol) {
    const t = tarjetaRol(rol);
    const actual = rolesCache.roles.find(r => r.rol === rol);
    // clase "hidden" y no el atributo: "flex" de Tailwind le gana al atributo hidden
    t.querySelector(".rol-limite-caja").classList.toggle("hidden", t.querySelector(".rol-limite-modo").value !== "numero");
    const nuevo = leerTarjetaRol(rol);
    const mismosModulos = nuevo.modulos.length === actual.modulos.length && nuevo.modulos.every(m => actual.modulos.includes(m));
    const hayCambios = !mismosModulos || !Object.is(nuevo.limite, actual.limite_rfc_diario);
    t.querySelector(".rol-guardar").disabled = !hayCambios;
    t.querySelector(".rol-sin-guardar").hidden = !hayCambios;
    t.querySelector(".rol-deshacer").hidden = !hayCambios;
    t.style.outline = hayCambios ? "2px solid #fcd34d" : "";
}

async function guardarRol(rol) {
    const actual = rolesCache.roles.find(r => r.rol === rol);
    const nuevo = leerTarjetaRol(rol);
    if (nuevo.limite !== null && (!Number.isInteger(nuevo.limite) || nuevo.limite < 1 || nuevo.limite > 10000)) {
        mostrarAlerta("error", "Escribe cuántos RFC al día: un número entre 1 y 10,000.");
        return;
    }
    const agrega = nuevo.modulos.filter(m => !actual.modulos.includes(m));
    const quita = actual.modulos.filter(m => !nuevo.modulos.includes(m));
    const cambios = [];
    if (agrega.length) cambios.push(`podrá usar: ${nombresModulos(agrega)}`);
    if (quita.length) cambios.push(`ya no podrá usar: ${nombresModulos(quita)}`);
    if (nuevo.limite !== actual.limite_rfc_diario) cambios.push(`descargas masivas: ${nombreLimite(nuevo.limite)} (antes ${nombreLimite(actual.limite_rfc_diario)})`);

    const personalizados = usuariosCache.filter(u => u.rol === rol && u.personalizado).length;
    const aviso = `${actual.nombre}:\n- ${cambios.join("\n- ")}\n\nAfecta a ${actual.usuarios} ${actual.usuarios === 1 ? "usuario" : "usuarios"}` +
        (personalizados ? ` (a ${personalizados} con ajustes propios no les cambia lo personalizado)` : "") + ".";
    if (!confirm(aviso)) return;

    try {
        await api(`/api/admin/roles/${encodeURIComponent(rol)}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modulos: nuevo.modulos, limite_rfc_diario: nuevo.limite }),
        });
        mostrarAlerta("success", `Permisos de ${actual.nombre} guardados.`);
        await Promise.all([cargarRoles(), cargarUsuarios()]);
    } catch (err) { mostrarAlerta("error", err.message); }
}

async function restaurarRol(rol) {
    const r = rolesCache.roles.find(x => x.rol === rol);
    if (!confirm(`¿Regresar ${r.nombre} a sus valores de fábrica?\n\n${nombresModulos(r.fabrica.modulos)}\n${nombreLimite(r.fabrica.limite)}`)) return;
    try {
        await api(`/api/admin/roles/${encodeURIComponent(rol)}/restaurar`, { method: "POST" });
        mostrarAlerta("success", `${r.nombre} regresó a sus valores de fábrica.`);
        await Promise.all([cargarRoles(), cargarUsuarios()]);
    } catch (err) { mostrarAlerta("error", err.message); }
}

/* =====================================================================
 * ACTIVIDAD
 * ===================================================================== */
async function cargarProcesosAdmin() {
    try {
        procesosCache = await api("/api/admin/procesos");
        const enProceso = procesosCache.filter(p => p.estado === "procesando").length;
        $("cuenta-actividad").textContent = enProceso ? `(${enProceso} en proceso)` : "";
        $("actualizado-actividad").textContent = "Actualizado " + new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
        renderizarResumen();
        renderizarActividad();
    } catch (e) { mostrarAlerta("error", e.message); }
}

function grupoEstado(estado) {
    if (estado === "procesando") return "procesando";
    if (estado === "completado") return "completado";
    return "error";     // error, interrumpido, cancelado: lo que merece una mirada
}

function renderizarResumen() {
    const hoy = new Date().toDateString();
    const deHoy = procesosCache.filter(p => new Date(p.creado_en + "Z").toDateString() === hoy);
    const tiles = [
        ["En proceso", procesosCache.filter(p => p.estado === "procesando").length, "text-blue-700"],
        ["Completados hoy", deHoy.filter(p => p.estado === "completado").length, "text-emerald-700"],
        ["Con problemas hoy", deHoy.filter(p => grupoEstado(p.estado) === "error").length, "text-amber-700"],
        ["Usuarios activos hoy", new Set(deHoy.map(p => p.usuario)).size, "text-slate-800"],
    ];
    $("resumen-actividad").innerHTML = tiles.map(([t, n, c]) => `
        <div class="bg-white rounded-xl border border-gray-200 p-4">
            <p class="text-2xl font-extrabold ${c}">${esc(n)}</p>
            <p class="text-xs text-slate-500 mt-0.5">${esc(t)}</p>
        </div>`).join("");
}

function renderizarActividad() {
    const texto = $("buscar-actividad").value.trim().toLowerCase();
    const lista = procesosCache.filter(p =>
        (filtroActividad === "todos" || grupoEstado(p.estado) === filtroActividad) &&
        (!texto || (p.usuario || "").toLowerCase().includes(texto) || (p.titulo || "").toLowerCase().includes(texto)));
    $("sin-actividad").classList.toggle("hidden", lista.length > 0);

    const estados = {
        procesando: ["En proceso", "bg-blue-100 text-blue-700"],
        completado: ["Completado", "bg-green-100 text-green-700"],
        cancelado: ["Cancelado", "bg-gray-100 text-gray-600"],
        interrumpido: ["Interrumpido", "bg-amber-100 text-amber-700"],
    };
    $("lista-actividad").innerHTML = lista.map(p => {
        const [txtEstado, clsEstado] = estados[p.estado] || ["Error", "bg-red-100 text-red-700"];
        const nombreDoc = NOMBRE_DOC[p.tipo] || (p.tipo ? p.tipo.charAt(0).toUpperCase() + p.tipo.slice(1) : "Documento");
        const inicial = INICIAL_DOC[p.tipo] || nombreDoc.slice(0, 3).toUpperCase();
        const avance = (p.clase === "lote" && p.estado === "procesando" && p.total)
            ? `<div class="mt-2 max-w-xs">
                   <div class="adm-barra"><span style="width:${Math.round(100 * (p.procesados || 0) / p.total)}%"></span></div>
                   <p class="text-[11px] text-slate-500 mt-1">${esc(p.procesados || 0)} de ${esc(p.total)}${p.rfc_actual ? " · ahora: " + esc(p.rfc_actual) : ""}</p>
               </div>` : "";
        const motivos = (p.motivos && p.motivos.length)
            ? `<div class="mt-2 flex flex-col gap-0.5">${p.motivos.map(m => `<span class="text-xs text-amber-800">⚠ ${esc(m.cuantos)} × ${esc(m.motivo)}</span>`).join("")}</div>` : "";
        const error = (!p.motivos || !p.motivos.length) && p.mensaje_error && p.estado !== "completado"
            ? `<p class="text-xs text-amber-800 mt-1">${esc(p.mensaje_error)}</p>` : "";
        const detener = p.estado === "procesando"
            ? `<button data-accion="detener" data-clase="${esc(p.clase)}" data-id="${esc(p.id)}" class="text-xs font-bold text-slate-500 hover:text-red-600 border border-gray-200 hover:border-red-200 rounded-lg py-1 px-2.5 mt-2">Detener</button>` : "";
        const fecha = new Date(p.creado_en + "Z").toLocaleString("es-MX", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
        return `
        <div class="bg-white rounded-xl border border-gray-200 p-4 flex gap-4 items-start hover:border-slate-300 transition">
            <span class="adm-avatar bg-slate-100 text-slate-600" style="width:44px;height:44px;font-size:11px;border-radius:10px">${esc(inicial)}</span>
            <div class="flex-grow min-w-0">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="font-bold text-slate-800">${esc(nombreDoc)}</span>
                    ${p.clase === "lote" ? sello("Lote", "bg-slate-100 text-slate-600") : ""}
                    <span class="font-mono text-xs text-slate-500">${esc(p.titulo)}</span>
                </div>
                <p class="text-xs text-slate-500 mt-0.5 truncate">${esc(p.usuario)}</p>
                ${avance}${motivos}${error}
            </div>
            <div class="text-right flex-none">
                ${sello(txtEstado, clsEstado)}
                <p class="text-[11px] text-slate-400 mt-1.5" title="${esc(fecha)}">${esc(haceCuanto(p.creado_en))}</p>
                ${detener}
            </div>
        </div>`;
    }).join("");
}

async function cancelarProcesoAdmin(clase, id, boton) {
    if (!confirm("¿Detener este proceso? Se conservará lo que ya se haya generado.")) return;
    boton.disabled = true;
    boton.textContent = "Deteniendo…";
    try {
        await api(`/api/admin/procesos/${encodeURIComponent(clase)}/${encodeURIComponent(id)}/cancelar`, { method: "POST" });
        mostrarAlerta("success", "Se detendrá al terminar el contribuyente en curso.");
        await cargarProcesosAdmin();
    } catch (err) {
        mostrarAlerta("error", err.message);
        boton.disabled = false;
        boton.textContent = "Detener";
    }
}
