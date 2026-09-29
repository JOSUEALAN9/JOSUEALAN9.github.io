/**
 * admin.js — página de Administración, en tres pestañas:
 *   Usuarios · Permisos por rol · Actividad · Sistema
 *
 * La pestaña abierta vive en la dirección (#usuarios, #permisos,
 * #actividad, #sistema), así que recargar no te regresa al principio.
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
    declaraciones: "Declaraciones", voucheo: "Voucheo", descarga_xml: "Descarga masiva de XML",
};
const INICIAL_DOC = { csf: "CSF", opinion: "32D", "csf+opinion": "C+O", declaraciones: "DEC", voucheo: "VOU", descarga_xml: "XML" };

let usuariosCache = [];
let rolesCache = null;          // {modulos:[{clave,nombre}], roles:[...]}
let procesosCache = [];
let correoEnAjustes = null;
let filtroActividad = "todos";
let relojActividad = null;
const PESTANAS = ["usuarios", "permisos", "actividad", "sistema"];

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

// El servidor guarda UTC sin zona ("2026-09-25T21:40:00"); git sí la trae ("+00:00").
function aFecha(iso) {
    return new Date(/([zZ]|[+-]\d\d:\d\d)$/.test(iso) ? iso : iso + "Z");
}

function fechaCorta(iso) {
    if (!iso) return "";
    return aFecha(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

function haceCuanto(iso) {
    const t = aFecha(iso);
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
    if (!PESTANAS.includes(nombre)) nombre = "usuarios";
    document.querySelectorAll("[data-pestana]").forEach(b => {
        const activa = b.dataset.pestana === nombre;
        b.classList.toggle("pestana--activa", activa);
        b.setAttribute("aria-selected", activa ? "true" : "false");
    });
    PESTANAS.forEach(p => { $("panel-" + p).hidden = p !== nombre; });
    if (location.hash !== "#" + nombre) history.replaceState(null, "", "#" + nombre);

    // La actividad se refresca sola solo mientras está a la vista.
    clearInterval(relojActividad);
    if (nombre === "actividad") relojActividad = setInterval(cargarProcesosAdmin, 30000);
    if (nombre === "sistema") cargarSistema();
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

    prepararEventosSistema();

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


/* =====================================================================
 * SISTEMA — estado, portal, acciones, log y bitácora
 * Cada botón llama a un endpoint fijo; ninguno manda comandos.
 * ===================================================================== */
let estadoSistema = null;

function prepararEventosSistema() {
    $("btn-actualizar-sistema").addEventListener("click", cargarSistema);
    $("chk-mantenimiento").addEventListener("change", cambiarMantenimiento);
    $("btn-publicar-aviso").addEventListener("click", publicarAviso);
    $("btn-quitar-aviso").addEventListener("click", quitarAviso);
    $("btn-reiniciar").addEventListener("click", reiniciarServidor);
    $("btn-reiniciar-vscode").addEventListener("click", reiniciarVSCode);
    $("btn-revisar-atorados").addEventListener("click", revisarAtorados);
    $("btn-limpiar-vencidos").addEventListener("click", () => limpiarCache(null));
    $("btn-limpiar-rfc").addEventListener("click", () => limpiarCache($("rfc-cache").value.trim().toUpperCase()));
    $("btn-ver-log").addEventListener("click", verLog);
    $("log-lineas").addEventListener("change", () => { if (!$("caja-log").hidden) verLog(); });
    $("tarjetas-estado").addEventListener("click", e => {
        if (e.target.closest("#btn-probar-proxy")) probarProxy();
        if (e.target.closest("#btn-actualizar-tc")) actualizarTipoCambio(e.target.closest("#btn-actualizar-tc"));
    });
}

function tamano(bytes) {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
    if (bytes >= 1e3) return Math.round(bytes / 1e3) + " KB";
    return bytes + " B";
}

function duracion(desdeIso) {
    const min = Math.floor((Date.now() - aFecha(desdeIso)) / 60000);
    if (min < 1) return "hace un momento";
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 48) return `hace ${h} h ${min % 60} min`;
    return `hace ${Math.floor(h / 24)} días`;
}

function tarjeta(titulo, cuerpo, tono) {
    const borde = tono === "mal" ? "border-amber-300" : "border-gray-200";
    return `<div class="bg-white rounded-xl card-elevated border ${borde} p-4">
        <p class="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">${esc(titulo)}</p>${cuerpo}</div>`;
}

async function cargarSistema() {
    try {
        estadoSistema = await api("/api/admin/sistema/estado");
        pintarEstado();
        pintarPortal();
        await cargarBitacora();
    } catch (err) { mostrarAlerta("error", err.message); }
}

function pintarEstado() {
    const e = estadoSistema;
    const b = e.backend || {};
    let version = `<p class="text-sm text-slate-400">No se pudo leer git.</p>`;
    let alertaGit = "";
    if (b.disponible) {
        const avisos = [];
        if (b.cambios_sin_commit) avisos.push(`${b.cambios_sin_commit} cambio(s) sin commit`);
        if (b.commits_sin_subir) avisos.push(`${b.commits_sin_subir} commit(s) sin subir a GitHub`);
        alertaGit = avisos.join(" · ");
        version = `
            <p class="text-sm"><span class="font-mono font-bold text-slate-800">${esc(b.commit)}</span>
               <span class="text-slate-600">${esc(b.mensaje)}</span></p>
            <p class="text-[11px] text-slate-400 mt-1">Backend · ${esc(fechaCorta(b.fecha))} · Interfaz ${esc(Fiscontable.VERSION || "")}</p>
            ${alertaGit ? `<p class="text-xs font-bold text-amber-700 mt-2">⚠ ${esc(alertaGit)}</p>` : `<p class="text-xs font-bold text-emerald-700 mt-2">✓ Todo guardado en git</p>`}`;
    }
    const corriendo = e.corriendo.lotes + e.corriendo.trabajos;
    const servidor = `
        <p class="text-sm text-slate-800 font-semibold">Encendido ${esc(duracion(e.encendido_desde))}</p>
        <p class="text-xs text-slate-500 mt-1">${corriendo
            ? `En curso: ${esc(e.corriendo.lotes)} lote(s) y ${esc(e.corriendo.trabajos)} trabajo(s)`
            : "Nada corriendo ahora"}</p>`;
    const usado = e.disco.total - e.disco.libre;
    const pct = Math.round(100 * usado / e.disco.total);
    const disco = `
        <div class="adm-barra"><span style="width:${pct}%;${pct > 85 ? "background:#f59e0b" : ""}"></span></div>
        <p class="text-xs text-slate-600 mt-2"><strong>${esc(tamano(e.disco.libre))}</strong> libres de ${esc(tamano(e.disco.total))}</p>
        <div class="mt-2 grid grid-cols-2 gap-x-3 text-[11px] text-slate-500">
            ${Object.entries(e.disco.partes).map(([k, v]) => `<span>${esc(k)}</span><span class="text-right font-mono">${esc(tamano(v))}</span>`).join("")}
        </div>`;
    const proxy = e.proxy_configurado
        ? `<p id="texto-proxy" class="text-sm text-slate-600">Sin probar todavía.</p>
           <button type="button" id="btn-probar-proxy" class="mt-2 text-xs font-bold text-slate-700 border border-gray-200 hover:border-slate-400 rounded-lg py-1.5 px-3">Probar ahora</button>`
        : `<p class="text-sm text-amber-700">Sin configurar: falta <span class="font-mono text-xs">FISCONTABLE_PROXY_URL</span> en el servidor.</p>`;
    const respaldo = e.ultimo_respaldo
        ? `<p class="text-sm text-slate-700">${esc(fechaCorta(e.ultimo_respaldo))}</p>`
        : `<p class="text-sm text-amber-700 font-semibold">Sin respaldos automáticos</p>
           <p class="text-[11px] text-slate-500 mt-1">La base, los documentos y las e.firmas guardadas solo existen en la Vostro.</p>`;

    // Tipo de cambio de Banxico (se descarga solo a las 6:00 y 18:00)
    const tc = e.tipo_cambio || {};
    const usd = (tc.monedas || {}).USD;
    const tarea = tc.tarea || {};
    const tcMal = !tc.token_configurado || !!tarea.error || !usd;
    const tipoCambio = !tc.token_configurado
        ? `<p class="text-sm text-amber-700">Sin configurar: falta <span class="font-mono text-xs">FISCONTABLE_BANXICO_TOKEN</span> en el servidor.</p>`
        : `<p class="text-sm text-slate-800">${usd ? `FIX del ${esc(usd.hasta)}: <strong>${esc(Number(usd.ultimo_valor).toFixed(4))}</strong>` : "Todavía sin datos"}</p>
           <p class="text-[11px] text-slate-500 mt-1">${usd ? `${esc(usd.dias)} días desde ${esc(usd.desde)} · ` : ""}Solo a las ${esc(tc.horarios || "6:00 y 18:00")}</p>
           ${tarea.ultimo_exito ? `<p class="text-[11px] text-slate-500">Última descarga: ${esc(haceCuanto(tarea.ultimo_exito))}</p>` : ""}
           ${tarea.error ? `<p class="text-xs font-bold text-amber-700 mt-1">⚠ ${esc(tarea.error)}</p>` : ""}
           <button type="button" id="btn-actualizar-tc" class="mt-2 text-xs font-bold text-slate-700 border border-gray-200 hover:border-slate-400 rounded-lg py-1.5 px-3">Actualizar ahora</button>`;

    $("tarjetas-estado").innerHTML =
        tarjeta("Versión en producción", version, alertaGit ? "mal" : "") +
        tarjeta("Servidor", servidor) +
        tarjeta("Disco", disco, pct > 85 ? "mal" : "") +
        tarjeta("Proxy de Oracle", proxy, e.proxy_configurado ? "" : "mal") +
        tarjeta("Respaldo", respaldo, e.ultimo_respaldo ? "" : "mal") +
        tarjeta("Tipo de cambio Banxico", tipoCambio, tcMal ? "mal" : "");
    $("alerta-sistema").textContent = (alertaGit || e.mantenimiento.activo) ? "•" : "";
}

function pintarPortal() {
    const e = estadoSistema;
    $("chk-mantenimiento").checked = !!e.mantenimiento.activo;
    $("estado-mantenimiento").textContent = e.mantenimiento.activo ? "Activo: los demás no pueden iniciar descargas nuevas." : "Desactivado.";
    $("estado-mantenimiento").className = "text-xs font-bold mt-3 " + (e.mantenimiento.activo ? "text-amber-700" : "text-slate-400");
    if (e.aviso) {
        $("aviso-texto").value = e.aviso.texto;
        $("aviso-tipo").value = e.aviso.tipo || "info";
        $("aviso-hasta").value = e.aviso.hasta ? e.aviso.hasta.slice(0, 10) : "";
    }
    $("btn-quitar-aviso").hidden = !e.aviso;
    $("btn-publicar-aviso").textContent = e.aviso ? "Actualizar" : "Publicar";
}

async function actualizarTipoCambio(boton) {
    boton.disabled = true;
    boton.textContent = "Actualizando…";
    try {
        const r = await api("/api/conciliacion/tipos-cambio/actualizar", { method: "POST" });
        mostrarAlerta("exito", r.mensaje || "Tipos de cambio actualizados.");
    } catch (err) { mostrarAlerta("error", err.message); }
    await cargarSistema();
}

async function probarProxy() {
    $("texto-proxy").textContent = "Probando…";
    try {
        const r = await api("/api/admin/sistema/proxy");
        $("texto-proxy").textContent = (r.ok ? "✓ " : "⚠ ") + r.mensaje;
        $("texto-proxy").className = "text-sm " + (r.ok ? "text-emerald-700" : "text-amber-700");
    } catch (err) { $("texto-proxy").textContent = err.message; }
}

async function cambiarMantenimiento() {
    const activo = $("chk-mantenimiento").checked;
    const pregunta = activo
        ? "¿Activar el modo mantenimiento?\n\nNadie más podrá iniciar descargas nuevas hasta que lo desactives. Lo que ya corre, termina."
        : "¿Desactivar el modo mantenimiento? Todos vuelven a poder iniciar descargas.";
    if (!confirm(pregunta)) { $("chk-mantenimiento").checked = !activo; return; }
    try {
        await api("/api/admin/sistema/mantenimiento", {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activo }),
        });
        mostrarAlerta("success", activo ? "Modo mantenimiento activado." : "Modo mantenimiento desactivado.");
        if (Fiscontable.recargarLetreros) Fiscontable.recargarLetreros();
        await cargarSistema();
    } catch (err) { mostrarAlerta("error", err.message); $("chk-mantenimiento").checked = !activo; }
}

async function publicarAviso() {
    const texto = $("aviso-texto").value.trim();
    if (!texto) { mostrarAlerta("error", "Escribe el texto del aviso."); return; }
    const fecha = $("aviso-hasta").value;
    try {
        await api("/api/admin/sistema/aviso", {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ texto, tipo: $("aviso-tipo").value, hasta: fecha ? new Date(fecha + "T23:59:59").toISOString() : null }),
        });
        mostrarAlerta("success", "Aviso publicado. Cada usuario lo verá al abrir o recargar una página.");
        if (Fiscontable.recargarLetreros) Fiscontable.recargarLetreros();
        await cargarSistema();
    } catch (err) { mostrarAlerta("error", err.message); }
}

async function quitarAviso() {
    if (!confirm("¿Quitar el aviso de todas las páginas?")) return;
    try {
        await api("/api/admin/sistema/aviso", { method: "DELETE" });
        $("aviso-texto").value = ""; $("aviso-hasta").value = "";
        mostrarAlerta("success", "Aviso quitado.");
        if (Fiscontable.recargarLetreros) Fiscontable.recargarLetreros();
        await cargarSistema();
    } catch (err) { mostrarAlerta("error", err.message); }
}

async function reiniciarServidor() {
    const e = estadoSistema || { corriendo: { lotes: 0, trabajos: 0 } };
    const corriendo = e.corriendo.lotes + e.corriendo.trabajos;
    const aviso = corriendo
        ? `Hay ${e.corriendo.lotes} lote(s) y ${e.corriendo.trabajos} trabajo(s) en curso.\n\n` +
          "Los lotes quedarán como interrumpidos y se podrán reanudar con confirmación. Los trabajos sueltos en curso se pierden y habrá que pedirlos otra vez.\n\n¿Reiniciar de todos modos?"
        : "¿Reiniciar el servidor? Vuelve solo en unos segundos.";
    if (!confirm(aviso)) return;

    const boton = $("btn-reiniciar");
    boton.disabled = true;
    const antes = e.encendido_desde;
    try {
        await api("/api/admin/sistema/reiniciar", { method: "POST" });
    } catch (err) { mostrarAlerta("error", err.message); boton.disabled = false; return; }

    boton.textContent = "Reiniciando…";
    // Se espera a que el servidor conteste con una hora de encendido distinta.
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
            const nuevo = await api("/api/admin/sistema/estado");
            if (nuevo.encendido_desde !== antes) {
                mostrarAlerta("success", "El servidor ya volvió.");
                boton.disabled = false; boton.textContent = "Reiniciar";
                estadoSistema = nuevo; pintarEstado(); await cargarBitacora();
                return;
            }
        } catch { /* sigue apagado */ }
    }
    boton.disabled = false; boton.textContent = "Reiniciar";
    mostrarAlerta("error", "El servidor no ha vuelto después de un minuto. Revisa por SSH: systemctl status fiscontable");
}

async function reiniciarVSCode() {
    if (!confirm("¿Reiniciar el túnel de VS Code? Si tienes VS Code abierto, se desconectará un momento.")) return;
    try {
        const r = await api("/api/admin/sistema/reiniciar-vscode", { method: "POST" });
        mostrarAlerta("success", r.mensaje);
        await cargarBitacora();
    } catch (err) { mostrarAlerta("error", err.message); }
}

async function revisarAtorados() {
    const caja = $("caja-atorados");
    caja.hidden = false;
    caja.innerHTML = `<p class="text-slate-400">Revisando…</p>`;
    try {
        const r = await api("/api/admin/sistema/atorados");
        if (!r.procesos.length) {
            caja.innerHTML = `<p class="text-emerald-700 font-semibold">✓ No hay procesos atorados.</p>`;
            return;
        }
        caja.innerHTML = `
            <ul class="flex flex-col gap-1 mb-3">${r.procesos.map(p => `
                <li class="text-xs text-slate-600"><span class="font-bold">${esc(NOMBRE_DOC[p.tipo] || p.tipo)}</span>
                    ${p.clase === "lote" ? `(lote, ${esc(p.procesados)} de ${esc(p.total)})` : ""} · ${esc(p.usuario)} ·
                    sin avance desde ${esc(haceCuanto(p.actualizado_en))}</li>`).join("")}
            </ul>
            <button type="button" id="btn-cancelar-atorados" class="text-xs font-bold text-red-600 border border-red-200 hover:bg-red-50 rounded-lg py-1.5 px-3">Cancelar estos ${r.procesos.length}</button>`;
        $("btn-cancelar-atorados").addEventListener("click", cancelarAtorados);
    } catch (err) { caja.innerHTML = `<p class="text-amber-700">${esc(err.message)}</p>`; }
}

async function cancelarAtorados() {
    if (!confirm("¿Cancelar los procesos atorados? Quedarán como cancelados.")) return;
    try {
        const r = await api("/api/admin/sistema/atorados/cancelar", { method: "POST" });
        mostrarAlerta("success", `Se cancelaron ${r.trabajos} trabajo(s) y ${r.lotes} lote(s).`);
        await revisarAtorados();
        await Promise.all([cargarBitacora(), cargarProcesosAdmin()]);
    } catch (err) { mostrarAlerta("error", err.message); }
}

async function limpiarCache(rfc) {
    if (rfc !== null && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) { mostrarAlerta("error", "Escribe un RFC válido."); return; }
    const pregunta = rfc
        ? `¿Borrar los documentos guardados de ${rfc}?\n\nLa próxima vez que alguien los pida, se sacarán otra vez del SAT.`
        : "¿Borrar ahora los documentos que ya vencieron?";
    if (!confirm(pregunta)) return;
    try {
        const r = await api("/api/admin/sistema/cache/limpiar", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rfc }),
        });
        mostrarAlerta("success", r.mensaje);
        if (rfc) $("rfc-cache").value = "";
        await cargarSistema();
    } catch (err) { mostrarAlerta("error", err.message); }
}

async function verLog() {
    const caja = $("caja-log");
    caja.hidden = false;
    caja.textContent = "Cargando…";
    try {
        const r = await api(`/api/admin/sistema/log?lineas=${encodeURIComponent($("log-lineas").value)}`);
        caja.textContent = r.ok ? r.lineas.join("\n") : r.mensaje;
        caja.scrollTop = caja.scrollHeight;
        $("btn-ver-log").textContent = "Actualizar log";
    } catch (err) { caja.textContent = err.message; }
}

async function cargarBitacora() {
    try {
        const filas = await api("/api/admin/sistema/bitacora?limite=50");
        $("sin-bitacora").classList.toggle("hidden", filas.length > 0);
        $("lista-bitacora").innerHTML = filas.map(b => `
            <div class="px-5 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span class="text-sm font-semibold text-slate-800">${esc(b.accion)}</span>
                ${b.detalle ? `<span class="text-xs text-slate-500">${esc(b.detalle)}</span>` : ""}
                <span class="ml-auto text-[11px] text-slate-400 whitespace-nowrap" title="${esc(new Date(b.cuando + "Z").toLocaleString("es-MX"))}">${esc(b.quien)} · ${esc(haceCuanto(b.cuando))}</span>
            </div>`).join("");
    } catch (err) { mostrarAlerta("error", err.message); }
}
