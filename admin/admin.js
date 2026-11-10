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
    programada_csf: "Programada · Constancias", programada_opinion: "Programada · Opiniones",
    programada_declaraciones: "Programada · Declaraciones", programada_xml: "Programada · Descarga de XML",
};
const INICIAL_DOC = { csf: "CSF", opinion: "32D", "csf+opinion": "C+O", declaraciones: "DEC", voucheo: "VOU", descarga_xml: "XML",
    programada_csf: "🌙", programada_opinion: "🌙", programada_declaraciones: "🌙", programada_xml: "🌙" };

let usuariosCache = [];
let rolesCache = null;          // {modulos:[{clave,nombre}], roles:[...]}
let procesosCache = [];
let correoEnAjustes = null;
let filtroActividad = "todos";
let relojActividad = null;
const PESTANAS = ["usuarios", "permisos", "actividad", "creditos", "documentos", "despachos", "licencias", "demos", "sistema"];

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
    if (nombre === "actividad") { pintarSesionesActividad(true); relojActividad = setInterval(() => { cargarProcesosAdmin(); pintarSesionesActividad(true); }, 30000); }
    if (nombre === "sistema") cargarSistema();
    if (nombre === "creditos" && window.CreditosAdmin) window.CreditosAdmin.cargar();
    if (nombre === "documentos" && window.DocumentosAdmin) window.DocumentosAdmin.cargar();
    if (nombre === "despachos" && window.DespachosAdmin) window.DespachosAdmin.cargar();
    if (nombre === "licencias" && window.LicenciasAdmin) window.LicenciasAdmin.cargar();
    if (nombre === "demos" && window.DemosAdmin) window.DemosAdmin.cargar();
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
        if (b.dataset.accion === "ver-como") verComo(correo);
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
    $("fecha-actividad").addEventListener("change", renderizarActividad);
    $("tipo-actividad").addEventListener("change", renderizarActividad);
    $("btn-ver-actividad").addEventListener("click", () => abrirVentana("Toda la actividad", "bloque-actividad", renderizarActividad));
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
                ${u.rol === "admin" ? "" : `<button data-accion="ver-como" data-correo="${esc(u.correo)}" title="Ver Fiscontable como esta persona (solo lectura, 60 min)" class="text-xs font-bold text-slate-600 hover:text-slate-900 border border-gray-200 hover:border-slate-400 rounded-lg py-1 px-2.5 mr-1">Ver como</button>`}
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
    cargarPlanesInfo();
}

/* Mensaje para mejorar el plan (con WhatsApp y correo) y próximos desarrollos: lo ven todos los usuarios */
let planesCargados = false;
async function cargarPlanesInfo() {
    if (planesCargados) return;
    try {
        const d = await api("/api/admin/planes-info");
        planesCargados = true;
        $("plan-texto").value = d.contacto.texto || "";
        $("plan-wa").value = d.contacto.whatsapp || "";
        $("plan-correo").value = d.contacto.correo || "";
        $("lista-proximos").innerHTML = "";
        (d.proximos || []).forEach(filaProximo);
        if (!d.proximos.length) filaProximo();
    } catch (e) { $("msj-planes").textContent = e.message; $("msj-planes").className = "text-xs font-semibold text-red-600"; }
}

function filaProximo(x) {
    x = x || {};
    const fila = document.createElement("div");
    fila.className = "grid grid-cols-1 sm:grid-cols-12 gap-2 items-center border border-gray-200 rounded-lg p-2";
    fila.innerHTML = `
        <input data-p="titulo" maxlength="80" class="sm:col-span-4 text-sm border border-gray-300 rounded-lg p-2" placeholder="Nombre (ej. Voucheo federal)">
        <input data-p="desc" maxlength="240" class="sm:col-span-5 text-sm border border-gray-300 rounded-lg p-2" placeholder="Qué hará">
        <input data-p="etiqueta" maxlength="24" class="sm:col-span-2 text-sm border border-gray-300 rounded-lg p-2" placeholder="En camino" list="etiquetas-proximos">
        <button type="button" data-quitar class="sm:col-span-1 text-xs font-bold text-red-600 hover:underline" title="Quitar">Quitar</button>`;
    fila.querySelector('[data-p="titulo"]').value = x.titulo || "";
    fila.querySelector('[data-p="desc"]').value = x.desc || "";
    fila.querySelector('[data-p="etiqueta"]').value = x.etiqueta || "";
    $("lista-proximos").appendChild(fila);
}

async function guardarPlanesInfo() {
    const msj = $("msj-planes"), b = $("btn-guardar-planes");
    const proximos = Array.from($("lista-proximos").children).map(f => ({
        titulo: f.querySelector('[data-p="titulo"]').value.trim(), desc: f.querySelector('[data-p="desc"]').value.trim(),
        etiqueta: f.querySelector('[data-p="etiqueta"]').value.trim()
    })).filter(x => x.titulo);
    b.disabled = true; msj.textContent = "Guardando…"; msj.className = "text-xs font-semibold text-slate-500";
    try {
        const d = await api("/api/admin/planes-info", {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contacto: { texto: $("plan-texto").value, whatsapp: $("plan-wa").value, correo: $("plan-correo").value }, proximos })
        });
        $("plan-wa").value = d.contacto.whatsapp || "";
        msj.textContent = "✓ Guardado. Cada usuario lo ve al recargar su página."; msj.className = "text-xs font-semibold text-emerald-700";
    } catch (e) { msj.textContent = e.message; msj.className = "text-xs font-semibold text-red-600"; }
    b.disabled = false;
}

document.addEventListener("DOMContentLoaded", () => {
    if (!$("caja-planes")) return;
    $("btn-proximo-mas").addEventListener("click", () => filaProximo());
    $("lista-proximos").addEventListener("click", e => { const q = e.target.closest("[data-quitar]"); if (q) q.parentElement.remove(); });
    $("btn-guardar-planes").addEventListener("click", guardarPlanesInfo);
    const dl = document.createElement("datalist");
    dl.id = "etiquetas-proximos";
    dl.innerHTML = ["En camino", "Pronto", "En pruebas", "Este mes"].map(t => `<option value="${t}">`).join("");
    document.body.appendChild(dl);
});

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
    t.style.outline = hayCambios ? "2px solid rgb(var(--av-200))" : "";
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
        renderizarRecientes();
        llenarTiposActividad();
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

function nombreDocDe(p) {
    return NOMBRE_DOC[p.tipo] || (p.tipo ? p.tipo.charAt(0).toUpperCase() + p.tipo.slice(1) : "Documento");
}

/* Lo más reciente a la vista (5); lo demás, con filtros, en la ventana. */
function renderizarRecientes() {
    const ultimos = procesosCache.slice().sort((a, b) => (b.creado_en || "").localeCompare(a.creado_en || "")).slice(0, 5);
    const color = { procesando: "text-blue-700", completado: "text-emerald-700" };
    $("actividad-recientes").innerHTML = ultimos.length ? ultimos.map(p => `
        <div class="px-4 py-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span class="text-sm font-semibold text-slate-800">${esc(nombreDocDe(p))}</span>
            <span class="font-mono text-xs text-slate-500">${esc(p.titulo)}</span>
            <span class="text-xs text-slate-500 truncate">${esc(p.usuario)}</span>
            <span class="ml-auto text-[11px] font-bold ${color[grupoEstado(p.estado)] || "text-amber-700"}">${esc(p.estado === "procesando" ? "En proceso" : p.estado === "completado" ? "Completado" : "Con problemas")}</span>
            <span class="text-[11px] text-slate-400">${esc(haceCuanto(p.creado_en))}</span>
        </div>`).join("") : `<p class="p-6 text-center text-sm text-slate-400">No hay actividad todavía.</p>`;
    $("btn-ver-actividad").textContent = `Ver toda la actividad (${procesosCache.length})`;
}

function llenarTiposActividad() {
    const sel = $("tipo-actividad"), actual = sel.value;
    const tipos = [...new Set(procesosCache.map(p => p.tipo).filter(Boolean))];
    sel.innerHTML = `<option value="">Todos los tipos</option>` +
        tipos.map(t => [t, NOMBRE_DOC[t] || t]).sort((a, b) => a[1].localeCompare(b[1])).map(([t, n]) => `<option value="${esc(t)}">${esc(n)}</option>`).join("");
    sel.value = tipos.includes(actual) ? actual : "";
}

function renderizarActividad() {
    const texto = $("buscar-actividad").value.trim().toLowerCase();
    const dias = $("fecha-actividad").value, tipo = $("tipo-actividad").value;
    const desde = dias === "" ? null : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - Number(dias)); return d; })();
    const lista = procesosCache.filter(p =>
        (filtroActividad === "todos" || grupoEstado(p.estado) === filtroActividad) &&
        (!tipo || p.tipo === tipo) &&
        (!desde || new Date(p.creado_en + "Z") >= desde) &&
        (!texto || (p.usuario || "").toLowerCase().includes(texto) || (p.titulo || "").toLowerCase().includes(texto)));
    $("sin-actividad").classList.toggle("hidden", lista.length > 0);
    $("cuenta-filtrada-actividad").textContent = `${lista.length} de ${procesosCache.length} procesos.`;

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
                    ${p.clase === "programada" ? sello("Madrugada", "bg-indigo-100 text-indigo-700") : ""}
                    <span class="font-mono text-xs text-slate-500">${esc(p.titulo)}</span>
                </div>
                <p class="text-xs text-slate-500 mt-0.5 truncate">${esc(p.usuario)}</p>
                ${p.clase === "programada" && p.progreso ? `<p class="text-xs text-indigo-700 mt-1">${esc(p.progreso)}</p>` : ""}
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

/* Ventana para lo largo: mueve un bloque de la página adentro y lo regresa al cerrar
   (así sus botones y eventos siguen siendo los mismos). */
let ventanaBloque = null;
function abrirVentana(titulo, idBloque, alAbrir) {
    cerrarVentana();
    const bloque = $(idBloque);
    const marca = document.createComment("lugar-" + idBloque);
    bloque.parentNode.insertBefore(marca, bloque);
    ventanaBloque = { bloque, marca };
    $("ventana-titulo").textContent = titulo;
    $("ventana-cuerpo").appendChild(bloque);
    bloque.hidden = false;
    $("ventana").hidden = false;
    if (alAbrir) alAbrir();
}
function cerrarVentana() {
    if (!ventanaBloque) { $("ventana").hidden = true; return; }
    const { bloque, marca } = ventanaBloque;
    bloque.hidden = true;
    marca.parentNode.insertBefore(bloque, marca);
    marca.remove();
    ventanaBloque = null;
    $("ventana").hidden = true;
}

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
    // Subpestañas de Sistema (la última se recuerda en este navegador)
    const abrirSub = nombre => {
        document.querySelectorAll("#sub-sistema [data-sub]").forEach(b => b.classList.toggle("adm-sub--activa", b.dataset.sub === nombre));
        document.querySelectorAll("#panel-sistema [data-subpanel]").forEach(p => { p.hidden = p.dataset.subpanel !== nombre; });
        try { localStorage.setItem("fc-admin-sub", nombre); } catch (e) { /* sin almacenamiento */ }
    };
    $("sub-sistema").addEventListener("click", e => { const b = e.target.closest("[data-sub]"); if (b) abrirSub(b.dataset.sub); });
    try { const s = localStorage.getItem("fc-admin-sub"); if (s && document.querySelector(`#sub-sistema [data-sub="${s}"]`)) abrirSub(s); } catch (e) { /* nada */ }
    $("btn-abrir-log").addEventListener("click", () => abrirVentana("Log del servidor", "bloque-log", verLog));
    $("btn-ver-bitacora").addEventListener("click", () => abrirVentana("Bitácora de administración", "bloque-bitacora", pintarBitacoraToda));
    $("buscar-bitacora").addEventListener("input", pintarBitacoraToda);
    $("quien-bitacora").addEventListener("change", pintarBitacoraToda);
    $("btn-sat-config").addEventListener("click", () => abrirVentana("Estado del SAT: configuración e historial", "bloque-sat-config"));
    $("btn-ver-listas").addEventListener("click", () => abrirVentana("Listas del SAT", "bloque-listas"));
    $("btn-listas-actualizar").addEventListener("click", actualizarListas);
    $("btn-url-49bis").addEventListener("click", guardarUrl49bis);
    $("ventana-cerrar").addEventListener("click", cerrarVentana);
    $("ventana").addEventListener("click", e => { if (e.target.id === "ventana") cerrarVentana(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("ventana").hidden) cerrarVentana(); });
    $("log-lineas").addEventListener("change", () => { if (!$("caja-log").hidden) verLog(); });
    $("btn-sat-revisar-todos").addEventListener("click", () => revisarSAT(null));
    $("btn-sat-efirma").addEventListener("click", guardarEfirmaSAT);
    $("chk-sat-activo").addEventListener("change", cambiarActivoSAT);
    $("sat-servicios").addEventListener("click", e => {
        const b = e.target.closest("[data-sat-revisar]");
        if (b) revisarSAT(b.dataset.satRevisar);
    });
    ["input", "change"].forEach(ev => $("tarjetas-estado").addEventListener(ev, cambioCampo));
    $("tarjetas-estado").addEventListener("click", clicTarjeta);
    $("actividad-sesiones").addEventListener("click", clicTarjeta);
    ["input", "change"].forEach(ev => $("actividad-sesiones").addEventListener(ev, cambioCampo));
}

function cambioCampo(e) {
    const campo = e.target.closest("[data-guarda]");
    if (campo) marcarPorGuardar(campo);
}

function clicTarjeta(e) {
    {
        if (e.target.closest("#btn-ver-registro")) abrirRegistro();
        if (e.target.closest("#btn-config-trabajos")) abrirTrabajadores();
        if (e.target.closest("#btn-probar-proxy")) probarProxy();
        if (e.target.closest("#btn-actualizar-tc")) actualizarTipoCambio(e.target.closest("#btn-actualizar-tc"));
        if (e.target.closest("#btn-respaldar")) respaldarAhora(e.target.closest("#btn-respaldar"));
        if (e.target.closest("#btn-revisar-vps")) revisarVps();
        if (e.target.closest("#btn-guardar-trabajos")) guardarTrabajos(e.target.closest("#btn-guardar-trabajos"));
        if (e.target.closest("#btn-guardar-inhabiles")) guardarInhabiles(e.target.closest("#btn-guardar-inhabiles"));
        if (e.target.closest("#btn-guardar-xml-auto")) guardarXmlAutoAdmin(e.target.closest("#btn-guardar-xml-auto"));
        if (e.target.closest("#btn-ver-timbres")) ventana("dlg-timbres", "Timbres de facturación", cuerpoTimbres);
        if (e.target.closest("#btn-asignar-timbres")) asignarTimbres(e.target.closest("#btn-asignar-timbres"));
        if (e.target.closest("#btn-errores-pac")) abrirErroresPac();
        if (e.target.closest("#btn-actualizar-saldo")) actualizarSaldoPac(e.target.closest("#btn-actualizar-saldo"));
        if (e.target.closest("#btn-bolsa")) guardarBolsa(e.target.closest("#btn-bolsa"));
        if (e.target.closest("[data-copiar-error]")) copiarErrorPac(e.target.closest("[data-copiar-error]"));
        if (e.target.closest("#btn-max-pcs")) guardarMaxPcs(e.target.closest("#btn-max-pcs"));
        if (e.target.closest("#btn-revisar-instalador")) revisarInstalador(e.target.closest("#btn-revisar-instalador"));
        if (e.target.closest("#btn-max-sesiones")) guardarMaxSesiones(e.target.closest("#btn-max-sesiones"));
        if (e.target.closest("#btn-registro-sesiones")) abrirRegistroSesiones();
        if (e.target.closest("[data-cerrar-sesion]")) cerrarSesionWeb(e.target.closest("[data-cerrar-sesion]"));
        if (e.target.closest("[data-quitar-pc]")) quitarPc(e.target.closest("[data-quitar-pc]"));
        if (e.target.closest("#btn-probar-trabajador")) probarTrabajador(e.target.closest("#btn-probar-trabajador"));
        if (e.target.closest("#btn-ver-inhabiles")) ventana("dlg-inhabiles", "Días inhábiles del SAT", cuerpoInhabiles);
        if (e.target.closest("#btn-ver-pcs")) { ventana("dlg-pcs", "PCs con el agente", cuerpoPcs); cargarRevisionTienda(); }
        if (e.target.closest("[data-revision]")) codigoRevision(e.target.closest("[data-revision]"));
        if (e.target.closest("#btn-ver-conectados")) ventana("dlg-conectados", "Conectados ahora", cuerpoConectados);
    }
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
        try { estadoTrabajadores = await api("/api/admin/trabajadores"); } catch (e) { estadoTrabajadores = null; }
        try { diasInhabiles = await api("/api/admin/sistema/dias-inhabiles"); } catch (e) { diasInhabiles = null; }
        try { xmlAutoAdmin = await api("/api/admin/sistema/xml-automatica"); } catch (e) { xmlAutoAdmin = null; }
        try { timbresAdmin = await api("/api/admin/facturacion/timbres"); } catch (e) { timbresAdmin = null; }
        try { pcsAgentes = await api("/api/admin/agentes"); } catch (e) { pcsAgentes = null; }
        try { sesionesWeb = await api("/api/admin/sesiones"); } catch (e) { sesionesWeb = null; }
        pintarEstado();
        pintarPortal();
        await cargarEstadoSAT();
        cargarListasAdmin();
        await cargarBitacora();
    } catch (err) { mostrarAlerta("error", err.message); }
}

let estadoTrabajadores = null;
let diasInhabiles = null;
let xmlAutoAdmin = null;
let timbresAdmin = null;
let pcsAgentes = null;
let sesionesWeb = null;

// Ventanas de las tarjetas (mismo diseño que «Ver registro"): el contenido sale de una función,
// así se vuelve a pintar después de cada acción (desconectar, cerrar sesión…)
const VENTANAS = {};
function ventana(id, titulo, cuerpo) {
    VENTANAS[id] = { titulo, cuerpo };
    let d = document.getElementById(id);
    if (!d) {
        d = document.createElement("dialog");
        d.id = id;
        d.className = "adm-js"; d.style.cssText = "width:min(var(--modal-mediana),calc(100vw - 32px));max-height:calc(100vh - 48px);border:0;border-radius:20px;padding:0;box-shadow:var(--sombra-alta)";
        document.body.appendChild(d);
        ["input", "change"].forEach(ev => d.addEventListener(ev, cambioCampo));
        d.addEventListener("click", e => { if (e.target.closest("[data-cerrar]")) d.close(); else clicTarjeta(e); });
    }
    pintarVentana(id);
    d.showModal();
}
function pintarVentana(id) {
    const v = VENTANAS[id], d = document.getElementById(id);
    if (!v || !d) return;
    d.innerHTML = `<div style="padding:16px 18px;border-bottom:1px solid rgb(var(--g-200));display:flex;justify-content:space-between;align-items:center">
        <b>${esc(v.titulo)}</b><button type="button" data-cerrar class="text-slate-400 hover:text-red-500 text-lg">✕</button></div>
        <div style="padding:14px 18px;overflow:auto;max-height:calc(88vh - 60px)">${v.cuerpo()}</div>`;
}
function refrescarVentana(id) { const d = document.getElementById(id); if (d && d.open) pintarVentana(id); }

const botonVer = (id, texto) => `<button type="button" id="${id}" class="text-xs font-bold text-slate-700 border border-gray-200 hover:border-slate-400 rounded-lg py-1.5 px-3">${texto}</button>`;

// Sesiones (pestaña Actividad): de entrada solo cuántos hay; la lista y el tope, en su ventana
async function pintarSesionesActividad(recargar) {
    const caja = $("actividad-sesiones");
    if (!caja) return;
    if (recargar || !sesionesWeb) { try { sesionesWeb = await api("/api/admin/sesiones"); } catch (e) { caja.hidden = true; return; } }
    caja.hidden = false;
    caja.innerHTML = `<div class="flex-1 min-w-[200px]"><p class="text-xs font-bold text-slate-500 uppercase tracking-wide">En la web ahora</p>${tarjetaSesiones()}</div>`;
}

function tarjetaSesiones() {
    const d = sesionesWeb, n = d.activas.length;
    const cuentas = new Set(d.activas.map(x => x.correo)).size;
    return `<p class="text-3xl font-extrabold text-slate-800">${n}<span class="text-sm font-semibold text-slate-500 ml-2">conectado${n === 1 ? "" : "s"} ahora</span></p>
        <p class="text-[11px] text-slate-500 mt-1">${n ? `${cuentas} cuenta${cuentas === 1 ? "" : "s"} · actividad en los últimos ${esc(d.activa_min)} min` : "Nadie más en este momento."}${d.max_por_cuenta ? ` · tope: ${esc(d.max_por_cuenta)} por cuenta` : ""}</p>
        <div class="flex gap-2 mt-3">${botonVer("btn-ver-conectados", "Ver conectados")}${botonVer("btn-registro-sesiones", "Ver registro")}</div>`;
}

function cuerpoConectados() {
    const d = sesionesWeb;
    const fila = (x, conBoton) => `<li class="flex items-start justify-between gap-2 py-1">
        <span><span class="inline-block w-2 h-2 rounded-full mr-1 ${x.activa ? "bg-emerald-500" : x.cerrada_en ? "bg-red-400" : "bg-gray-300"}"></span>
        <b>${esc(x.correo)}</b> · ${esc(x.navegador || "?")}
        <span class="block text-slate-400">red ${esc(x.ip || "?")}${x.pais ? " (" + esc(x.pais) + ")" : ""} · entró ${esc(haceCuanto(x.inicio))} · ${x.activa ? "activa ahora" : "última actividad " + esc(haceCuanto(x.ultimo))}${x.cerrada_en ? " · cerrada por " + esc(x.cerrada_por) : ""}</span></span>
        ${conBoton && !x.cerrada_en ? `<button type="button" data-cerrar-sesion="${esc(x.clave)}" data-correo="${esc(x.correo)}" class="text-[11px] text-slate-500 hover:text-red-600 border border-gray-200 rounded-lg py-0.5 px-2 flex-none">Cerrar</button>` : ""}</li>`;
    const activas = d.activas.map(x => fila(x, true)).join("");
    return `<p class="text-[11px] text-slate-500">Conectados ahora (actividad en los últimos ${esc(d.activa_min)} min): ${d.activas.length}</p>
        ${activas ? `<ul class="text-xs text-slate-600 mt-1 divide-y divide-gray-100">${activas}</ul>` : '<p class="text-xs text-slate-400 mt-1">Nadie más en este momento.</p>'}
        <div class="flex flex-wrap items-center gap-2 mt-2 text-xs">Sesiones al mismo tiempo por cuenta
            <input id="max-sesiones" data-guarda="btn-max-sesiones" type="number" min="0" max="20" value="${esc(d.max_por_cuenta)}" class="border border-gray-200 rounded-lg py-1 px-2 w-16">
            ${botonGuardar("btn-max-sesiones")}
            <span class="text-[11px] text-slate-400">0 = sin tope · los administradores no tienen tope</span></div>`;
}

async function guardarMaxSesiones(boton) {
    estadoGuardar(boton, "guardando");
    try {
        const r = await api("/api/admin/sesiones/max", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ max_por_cuenta: +$("max-sesiones").value }) });
        sesionesWeb.max_por_cuenta = r.max_por_cuenta; $("max-sesiones").value = r.max_por_cuenta;
        estadoGuardar(boton, "ok");
    } catch (err) { mostrarAlerta("error", err.message); estadoGuardar(boton, "error"); }
}

async function cerrarSesionWeb(boton) {
    if (!confirm(`¿Cerrar esta sesión de ${boton.dataset.correo}? Ya no podrá usar la web desde ahí hasta que cierre sesión y vuelva a entrar.`)) return;
    try {
        await api(`/api/admin/sesiones/${boton.dataset.cerrarSesion}/cerrar`, { method: "POST" });
        sesionesWeb = await api("/api/admin/sesiones");
        pintarEstado();
        pintarSesionesActividad();
        refrescarVentana("dlg-conectados");
        const dlg = document.getElementById("dlg-sesiones");
        if (dlg && dlg.open) buscarSesiones();
    } catch (err) { mostrarAlerta("error", err.message); }
}

function tarjetaPcs() {
    const d = pcsAgentes, ag = d.agentes || [];
    const con = ag.filter(a => a.conectado).length, porAprobar = ag.filter(a => !a.aprobado).length;
    const i = d.instalador || {}, a = i.actual;
    const instalador = !i.configurado ? '<span class="text-amber-700">Falta la llave de GitHub</span>'
        : i.error ? '<span class="text-red-700">Instalador: revisar</span>' : a ? `Instalador ${esc(a.version)}` : "Sin instalador";
    return `<p class="text-3xl font-extrabold text-slate-800">${ag.length}<span class="text-sm font-semibold text-slate-500 ml-2">PC${ag.length === 1 ? "" : "s"} vinculada${ag.length === 1 ? "" : "s"}</span></p>
        <p class="text-[11px] text-slate-500 mt-1">${con} conectada${con === 1 ? "" : "s"} ahora${porAprobar ? ` · <b class="text-amber-700">${porAprobar} por aprobar</b>` : ""} · máx. ${esc(d.max_pcs)} por cuenta · ${instalador}</p>
        <div class="flex gap-2 mt-3">${botonVer("btn-ver-pcs", "Ver PCs")}</div>`;
}

function cuerpoPcs() {
    const d = pcsAgentes;
    const filas = (d.agentes || []).map(a => `<li class="flex items-start justify-between gap-2 py-1">
        <span><span class="inline-block w-2 h-2 rounded-full mr-1 ${a.conectado ? "bg-emerald-500" : "bg-gray-300"}"></span>
        <b>${esc(a.nombre)}</b> · ${esc(a.owner_email)}${a.aprobado ? "" : ' · <span class="text-amber-700 font-bold">por aprobar</span>'}
        <span class="block text-slate-400">${a.ip ? "red " + esc(a.ip) + " · " : ""}${a.conectado ? "conectada" : "visto " + esc(haceCuanto(a.ultimo_contacto))}</span></span>
        <button type="button" data-quitar-pc="${esc(a.id)}" data-nombre="${esc(a.nombre)}" class="text-[11px] text-slate-500 hover:text-red-600 border border-gray-200 rounded-lg py-0.5 px-2 flex-none">Desconectar</button></li>`).join("");
    return `<p class="text-[11px] text-slate-500">Todas las PCs vinculadas, de todas las cuentas. Una PC nueva no recibe trámites hasta que su dueño la aprueba.</p>
        ${filas ? `<ul class="text-[11px] text-slate-600 mt-1 divide-y divide-gray-100">${filas}</ul>` : '<p class="text-[11px] text-slate-400 mt-1">Ninguna todavía.</p>'}
        ${tarjetaInstalador(d.instalador)}
        <div class="flex items-center gap-2 mt-2 text-xs">Máximo de PCs por cuenta
            <input id="max-pcs" data-guarda="btn-max-pcs" type="number" min="1" max="50" value="${esc(d.max_pcs)}" class="border border-gray-200 rounded-lg py-1 px-2 w-16">
            ${botonGuardar("btn-max-pcs")}</div>
        <div id="rev-tienda" class="mt-3 pt-2 border-t border-gray-100 text-[11px] text-slate-600">${cuerpoRevisionTienda()}</div>`;
}

// Código para que el equipo de Microsoft pruebe el agente al revisarlo en la Tienda: dura días, sirve en varias PCs
// y solo conecta una cuenta de demostración (sin clientes ni e.firma). Se quita en cuanto aprueben la app.
let revisionTienda = null;
function cuerpoRevisionTienda() {
    const r = revisionTienda;
    const titulo = '<b class="block text-slate-700">Revisión de Microsoft Store</b>';
    if (!r) return titulo + '<span class="text-slate-400">Cargando…</span>';
    if (!r.activo) return `${titulo}<span class="block">Genera un código para las notas de certificación. Solo conecta la cuenta de demostración (sin clientes ni e.firma).</span>
        <button type="button" data-revision="crear" class="mt-1 text-[11px] border border-gray-200 rounded-lg py-0.5 px-2 hover:bg-gray-50">Generar código (30 días)</button>`;
    return `${titulo}<span class="block">Código: <b class="font-mono text-slate-800 text-xs">${esc(r.codigo)}</b> · vence ${esc(new Date(r.expira).toLocaleDateString("es-MX"))} · usado ${esc(r.usos)} de ${esc(r.max_usos)} · ${esc(r.pcs)} PC(s) conectadas</span>
        <span class="flex gap-2 mt-1"><button type="button" data-revision="copiar" class="text-[11px] border border-gray-200 rounded-lg py-0.5 px-2 hover:bg-gray-50">Copiar código</button>
        <button type="button" data-revision="crear" class="text-[11px] border border-gray-200 rounded-lg py-0.5 px-2 hover:bg-gray-50">Generar otro</button>
        <button type="button" data-revision="quitar" class="text-[11px] border border-gray-200 rounded-lg py-0.5 px-2 hover:text-red-600">Quitar y desconectar</button></span>`;
}
function pintarRevisionTienda() { const c = document.getElementById("rev-tienda"); if (c) c.innerHTML = cuerpoRevisionTienda(); }
async function cargarRevisionTienda() {
    try { revisionTienda = await api("/api/admin/agentes/revision"); } catch (e) { revisionTienda = { activo: false }; }
    pintarRevisionTienda();
}
async function codigoRevision(boton) {
    const que = boton.dataset.revision;
    if (que === "copiar") {
        try { await navigator.clipboard.writeText(revisionTienda.codigo); boton.textContent = "¡Copiado!"; } catch (e) { boton.textContent = revisionTienda.codigo; }
        setTimeout(() => { boton.textContent = "Copiar código"; }, 2000);
        return;
    }
    if (que === "quitar" && !(await Fiscontable.confirmar({ titulo: "¿Quitar el código de revisión?", texto: "Deja de servir y se desconectan las PCs de la cuenta de demostración.", si: "Quitar", peligro: true }))) return;
    if (que === "crear" && revisionTienda && revisionTienda.activo && !(await Fiscontable.confirmar({ titulo: "¿Generar otro código?", texto: "El código actual deja de servir. Si ya lo pusiste en las notas de certificación, cámbialo también ahí.", si: "Generar" }))) return;
    boton.disabled = true;
    try {
        revisionTienda = await api("/api/admin/agentes/revision", que === "quitar" ? { method: "DELETE" }
            : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dias: 30, max_usos: 20 }) });
        pintarRevisionTienda();
    } catch (err) { mostrarAlerta("error", err.message); boton.disabled = false; }
}

function tarjetaInstalador(i) {
    if (!i) return "";
    const a = i.actual;
    const linea = a ? `Instalador en la Vostro: <b>versión ${esc(a.version)}</b> · ${Math.round(a.tamano / 1048576)} MB · bajado ${esc(haceCuanto(a.bajado))}`
                    : "La Vostro todavía no tiene el instalador.";
    const falta = !i.configurado ? '<span class="block text-amber-700">Falta la llave de GitHub de solo lectura (FISCONTABLE_GITHUB_TOKEN en /etc/fiscontable.env). Sin ella no se bajan versiones nuevas.</span>' : "";
    const error = i.error ? `<span class="block text-red-700">${esc(i.error)}</span>` : "";
    const revisado = i.intento ? `<span class="block text-slate-400">Última revisión en GitHub: ${esc(haceCuanto(i.intento))} (sola cada hora)</span>` : "";
    return `<div class="mt-3 pt-2 border-t border-gray-100 text-[11px] text-slate-600">${linea}${falta}${error}${revisado}
        <button type="button" id="btn-revisar-instalador" class="mt-1 text-[11px] border border-gray-200 rounded-lg py-0.5 px-2 hover:bg-gray-50">Revisar ahora en GitHub</button></div>`;
}

async function revisarInstalador(boton) {
    boton.disabled = true; boton.textContent = "Revisando…";
    try {
        pcsAgentes.instalador = await api("/api/admin/agentes/instalador/revisar", { method: "POST" });
        pintarEstado();
        refrescarVentana("dlg-pcs");
    } catch (err) { mostrarAlerta("error", err.message); boton.disabled = false; boton.textContent = "Revisar ahora en GitHub"; }
}

async function guardarMaxPcs(boton) {
    estadoGuardar(boton, "guardando");
    try {
        const r = await api("/api/admin/agentes/max", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ max_pcs: +$("max-pcs").value }) });
        pcsAgentes.max_pcs = r.max_pcs; $("max-pcs").value = r.max_pcs;
        estadoGuardar(boton, "ok");
    } catch (err) { mostrarAlerta("error", err.message); estadoGuardar(boton, "error"); }
}

async function quitarPc(boton) {
    if (!confirm(`¿Desconectar "${boton.dataset.nombre}"? Dejará de hacer trámites hasta que su dueño la vuelva a vincular.`)) return;
    try {
        await api(`/api/admin/agentes/${boton.dataset.quitarPc}`, { method: "DELETE" });
        pcsAgentes = await api("/api/admin/agentes");
        pintarEstado();
        refrescarVentana("dlg-pcs");
    } catch (err) { mostrarAlerta("error", err.message); }
}

// Plazos del Buzón (cuándo queda notificada y cuándo surte efectos): los de ley se calculan solos;
// aquí van los que declare el SAT (vacaciones, días de la RMF).
const fechaLarga = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
function tarjetaInhabiles() {
    const d = diasInhabiles, hoy = new Date().toISOString().slice(0, 10);
    const extra = (d.dias || []).filter(x => x >= hoy).sort();
    const proximo = (d.dias || []).concat(d.de_ley || []).filter(x => x >= hoy).sort()[0];
    return `<p class="text-sm text-slate-800">${proximo ? `Próximo inhábil: <b>${esc(fechaLarga(proximo))}</b>` : "Sin próximos días inhábiles"}</p>
        <p class="text-[11px] text-slate-500 mt-1">${extra.length ? `${extra.length} declarado${extra.length === 1 ? "" : "s"} por el SAT por venir` : "Ninguno extra del SAT por venir"} · además de los de ley</p>
        <div class="flex gap-2 mt-3">${botonVer("btn-ver-inhabiles", "Ver y editar")}</div>`;
}

function cuerpoInhabiles() {
    const d = diasInhabiles;
    const corto = fechaLarga;
    return `<p class="text-[11px] text-slate-500">Además de los de ley (sábados, domingos, art. 12 del CFF y jueves y viernes santos), los que declare el SAT. Una fecha por renglón, AAAA-MM-DD. Se usan en los plazos del Buzón.</p>
        <textarea id="txt-inhabiles" data-guarda="btn-guardar-inhabiles" rows="4" class="mt-2 w-full border border-gray-200 rounded-lg p-2 text-xs font-mono" placeholder="2026-11-02">${esc((d.dias || []).join("\n"))}</textarea>
        <div class="mt-2">${botonGuardar("btn-guardar-inhabiles")}</div>
        <p class="text-[11px] text-slate-400 mt-2">De ley: ${esc((d.de_ley || []).map(corto).join(" · "))}</p>`;
}

async function guardarInhabiles(boton) {
    const dias = $("txt-inhabiles").value.split(/[\s,]+/).map(x => x.trim()).filter(Boolean);
    estadoGuardar(boton, "guardando");
    try {
        diasInhabiles = Object.assign(diasInhabiles || {}, await api("/api/admin/sistema/dias-inhabiles", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dias }) }));
        $("txt-inhabiles").value = (diasInhabiles.dias || []).join("\n");
        estadoGuardar(boton, "ok");
        pintarEstado();
    } catch (err) { mostrarAlerta("error", err.message); estadoGuardar(boton, "error"); }
}
// Desde qué mes pueden pedir sus XML en automático las cuentas ("Descargar desde" de cada empresa).
// El admin no tiene ese tope en sus propias empresas.
function tarjetaXmlAuto() {
    const d = xmlAutoAdmin, hoy = new Date();
    const actual = hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0");
    return `<p class="text-sm text-slate-800">Las cuentas pueden bajar desde <b>${esc(Fiscontable.nombreMes(d.desde_minimo).toLowerCase())}</b></p>
        <p class="text-[11px] text-slate-500 mt-1">Cada quien elige en la ficha de la empresa desde qué mes; no pueden ir antes de este. Tú sí, en tus empresas.</p>
        <div class="flex items-center gap-2 mt-3">
            <input type="month" id="xml-auto-minimo" data-guarda="btn-guardar-xml-auto" value="${esc(d.desde_minimo)}" min="${esc(d.tope_admin)}" max="${actual}" class="border border-gray-200 rounded-lg p-1.5 text-xs">
            ${botonGuardar("btn-guardar-xml-auto")}
        </div>`;
}

async function guardarXmlAutoAdmin(boton) {
    estadoGuardar(boton, "guardando");
    try {
        xmlAutoAdmin = Object.assign(xmlAutoAdmin || {}, await api("/api/admin/sistema/xml-automatica", {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ desde_minimo: $("xml-auto-minimo").value })
        }));
        pintarEstado();
        estadoGuardar($("btn-guardar-xml-auto"), "ok");
    } catch (err) { mostrarAlerta("error", err.message); estadoGuardar(boton, "error"); }
}
// Facturar: el admin le da timbres a cada cuenta; la cuenta los reparte entre sus empresas.
function tarjetaTimbres() {
    const d = timbresAdmin, con = d.cuentas.filter(c => c.bolsa || c.en_empresas);
    const total = d.cuentas.reduce((a, c) => a + (c.sin_tope ? 0 : c.bolsa) + c.en_empresas, 0);
    return `<p class="text-sm text-slate-800">${d.produccion ? "<b>Producción</b>: se timbra de verdad" : "<b>Modo de pruebas</b>: sin validez fiscal"}</p>
        <p class="text-[11px] ${d.panel ? "text-emerald-700" : "text-amber-700"} mt-1">${d.panel ? "✓ Conectado al panel de MultiFacturas" : "Sin conexión al panel de MultiFacturas (faltan sus claves en el servidor)"}</p>
        ${d.bolsa && d.bolsa.timbres != null ? `<div class="mt-2 rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3"><p class="text-[11px] font-bold uppercase tracking-wide text-indigo-700">Saldo general en MultiFacturas</p>
            <p class="text-2xl font-extrabold text-slate-900 leading-tight">${Number(d.bolsa.timbres).toLocaleString("es-MX")}</p>
            <p class="text-[11px] ${d.bolsa.fuente === "panel" ? "text-emerald-700" : "text-slate-500"}">${d.bolsa.fuente === "panel" ? "✓ Real, leído de tu panel de MultiFacturas" + (d.bolsa.leido_en ? " " + haceCuanto(d.bolsa.leido_en) : "") : "Escrito a mano (se baja al repartir)"}</p>
            ${d.bolsa.fuente === "panel" || d.bolsa.error ? `<div class="flex items-center gap-2 mt-2"><button type="button" id="btn-actualizar-saldo" class="whitespace-nowrap text-xs font-bold text-slate-700 bg-white border border-gray-200 hover:border-slate-400 rounded-lg py-1.5 px-3">↻ Actualizar</button>
            <span class="text-[11px] text-slate-500">Se vuelve a leer solo al abrir esta página si pasaron ${d.bolsa.cada_min || 5} min, y al pasar o quitar timbres.</span></div>` : ""}</div>` : `<p class="text-[11px] text-amber-700 mt-1">Saldo general de MultiFacturas sin registrar: escríbelo en «Ver y asignar».</p>`}
        ${d.bolsa && d.bolsa.error ? `<p class="text-[11px] text-amber-700 mt-1">No se pudo leer de tu panel: ${esc(d.bolsa.error)}</p>` : ""}
        <p class="text-[11px] text-slate-500 mt-1">${con.length} cuenta${con.length === 1 ? "" : "s"} con timbres · ${total.toLocaleString("es-MX")} asignados en total</p>
        <div class="flex gap-2 mt-3">${botonVer("btn-ver-timbres", "Ver y asignar")}${botonVer("btn-errores-pac", "Errores del PAC")}</div>`;
}

// «↻ Actualizar»: vuelve a leer en este momento el saldo general del panel de MultiFacturas.
async function actualizarSaldoPac(boton) {
    boton.disabled = true;
    boton.textContent = "Leyendo del panel…";
    try {
        timbresAdmin = await api("/api/admin/facturacion/timbres?actualizar=true");
        if (timbresAdmin.bolsa && timbresAdmin.bolsa.error) mostrarAlerta("error", "No se pudo leer de tu panel: " + timbresAdmin.bolsa.error);
        else mostrarAlerta("exito", "Saldo general actualizado: " + Number(timbresAdmin.bolsa.timbres).toLocaleString("es-MX") + " timbres.");
    } catch (err) { mostrarAlerta("error", err.message); }
    pintarEstado();
}

// Rastreo de errores (como lo pide MultiFacturas): cada rechazo del PAC queda con su número de seguimiento (FC-…),
// que también le sale al contador en el mensaje; «Copiar para soporte» junta todo lo que piden (con su bitácora).
let erroresPac = [];
async function abrirErroresPac() {
    try { erroresPac = await api("/api/admin/facturacion/errores-pac"); } catch (err) { return mostrarAlerta("error", err.message); }
    ventana("dlg-errores-pac", "Errores del PAC (rastreo para soporte)", cuerpoErroresPac);
}
function cuerpoErroresPac() {
    const filas = erroresPac.map(x => `<tr class="border-t border-gray-100 align-top">
        <td class="py-2 pr-3 whitespace-nowrap"><b class="font-mono">${esc(x.id)}</b><span class="block text-[11px] text-slate-400">${esc((x.creado_en || "").slice(0, 16).replace("T", " "))} UTC</span></td>
        <td class="py-2 pr-3">${esc(x.operacion)}${x.pruebas ? ' <span class="text-[10px] font-bold text-amber-700">PRUEBA</span>' : ""}<span class="block text-[11px] text-slate-400">${esc(x.rfc || "")} · ${esc(x.referencia || "")}</span><span class="block text-[11px] text-slate-400">${esc(x.owner_email)}</span></td>
        <td class="py-2 pr-3">${esc(x.mensaje)}</td>
        <td class="py-2 text-right"><button type="button" data-copiar-error="${esc(x.id)}" class="text-xs font-bold text-slate-700 border border-gray-200 hover:border-slate-400 rounded-lg py-1.5 px-3 whitespace-nowrap">Copiar para soporte</button></td></tr>`).join("");
    return `<p class="text-xs text-slate-500 mb-3">Los rechazos de los últimos 90 días. A soporte de MultiFacturas mándale el número de seguimiento con lo que copia el botón (código, servidor, tiempo, versión y su bitácora).</p>
        <table class="w-full text-xs"><thead><tr class="text-left text-slate-500"><th class="pb-2">Seguimiento</th><th class="pb-2">Qué</th><th class="pb-2">Mensaje</th><th></th></tr></thead>
        <tbody>${filas || '<tr><td colspan="4" class="py-6 text-center text-slate-400">Sin errores del PAC. 🎉</td></tr>'}</tbody></table>`;
}
async function copiarErrorPac(boton) {
    boton.disabled = true;
    try {
        const x = await api("/api/admin/facturacion/errores-pac/" + encodeURIComponent(boton.dataset.copiarError));
        const texto = [`Seguimiento: ${x.id}`, `Fecha (UTC): ${x.creado_en}`, `RFC emisor: ${x.rfc}`, `Operación: ${x.operacion} · ${x.referencia}`,
            `Modo: ${x.pruebas ? "pruebas" : "producción"}`, `Código MF: ${x.codigo}`, `Mensaje: ${x.mensaje}`, `Servidor: ${x.servidor}`,
            `Ejecución: ${x.ejecucion}`, `Versión del kit: ${x.version_kit}`, `Respuesta del PAC: ${x.original}`, `Bitácora (error_debug_log_xml_pac):`, x.debug].join("\n");
        try { await navigator.clipboard.writeText(texto); boton.textContent = "✓ Copiado"; }
        catch (e) { Fiscontable.guardarArchivo(new Blob([texto], { type: "text/plain;charset=utf-8" }), `Error_PAC_${x.id}.txt`); boton.textContent = "✓ Descargado"; }
    } catch (err) { mostrarAlerta("error", err.message); }
    setTimeout(() => { boton.disabled = false; boton.textContent = "Copiar para soporte"; }, 2500);
}

function cuerpoTimbres() {
    const d = timbresAdmin;
    const filas = d.cuentas.filter(c => !c.sin_tope || c.empresas.length || c.en_empresas).map(c => `<tr class="border-t border-gray-100 align-top"><td class="py-2 pr-3">${esc(c.correo)}${c.sin_tope ? ' <span class="text-[10px] font-bold text-indigo-700">TÚ · ADMIN</span>' : ""}${c.nombre ? `<span class="block text-[11px] text-slate-400">${esc(c.nombre)}</span>` : ""}
            ${c.empresas.length ? `<span class="block mt-1 text-[11px] text-slate-600">${c.empresas.map(e => `${esc(e.nombre)} <span class="font-mono text-slate-400">${esc(e.rfc)}</span> · <b>${e.timbres}</b>`).join("<br>")}</span>` : ""}</td>
        <td class="py-2 pr-3 text-right">${c.sin_tope ? '<span class="text-slate-400">Sin tope</span>' : c.bolsa}</td><td class="py-2 pr-3 text-right font-bold">${c.en_empresas}</td><td class="py-2 text-right">${c.emitidas}</td></tr>`).join("");
    const b = d.bolsa || {};
    const bolsa = b.fuente === "panel"
        ? `<p class="text-sm text-slate-800 mb-3">Saldo general en MultiFacturas: <b>${Number(b.timbres).toLocaleString("es-MX")}</b> <span class="text-[11px] text-emerald-700">✓ real, leído de tu panel</span></p>`
        : `${b.error ? `<p class="text-[11px] text-amber-700 mb-1">No se pudo leer de tu panel: ${esc(b.error)}</p>` : ""}
           <div class="flex flex-wrap items-end gap-2 mb-3"><label class="text-xs font-bold text-slate-600">Saldo general en MultiFacturas <span class="font-normal text-slate-400">(el «SALDO» de arriba en tu panel)</span>
           <input id="bolsa-n" type="number" min="0" value="${b.timbres == null ? "" : b.timbres}" class="block mt-1 w-32 border border-gray-200 rounded-lg p-1.5 text-xs"></label>
           <button type="button" id="btn-bolsa" class="text-xs font-bold text-white bg-slate-800 hover:bg-slate-700 rounded-lg py-2 px-3">Guardar</button></div>`;
    return bolsa + `<p class="text-[11px] text-slate-500">La cuenta reparte sus timbres entre sus empresas (Facturar → Configuración). Cada factura timbrada gasta uno de su empresa. Tú no tienes tope. Con número negativo se los quitas (solo de lo que no ha repartido).</p>
        <div class="flex flex-wrap items-end gap-2 mt-3">
            <label class="text-xs font-bold text-slate-600">Cuenta<select id="timbres-correo" class="block mt-1 border border-gray-200 rounded-lg p-1.5 text-xs">${d.cuentas.filter(c => !c.sin_tope).map(c => `<option>${esc(c.correo)}</option>`).join("")}</select></label>
            <label class="text-xs font-bold text-slate-600">Timbres<input id="timbres-n" type="number" value="100" class="block mt-1 w-24 border border-gray-200 rounded-lg p-1.5 text-xs"></label>
            <button type="button" id="btn-asignar-timbres" class="text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg py-2 px-3">Asignar</button>
        </div>
        <table class="w-full text-xs mt-4"><thead><tr class="text-left text-slate-500"><th class="pb-1">Cuenta</th><th class="pb-1 text-right pr-3">Sin repartir</th><th class="pb-1 text-right pr-3">En sus empresas</th><th class="pb-1 text-right">Facturas</th></tr></thead><tbody>${filas || '<tr><td colspan="4" class="py-2 text-slate-400">Sin cuentas.</td></tr>'}</tbody></table>`;
}

async function guardarBolsa(boton) {
    const n = parseInt($("bolsa-n").value, 10);
    if (isNaN(n) || n < 0) return mostrarAlerta("error", "Escribe el saldo general.");
    boton.disabled = true;
    try {
        await api("/api/admin/facturacion/bolsa", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timbres: n }) });
        timbresAdmin = await api("/api/admin/facturacion/timbres");
        pintarEstado(); refrescarVentana("dlg-timbres");
        mostrarAlerta("success", "Saldo general guardado.");
    } catch (err) { mostrarAlerta("error", err.message); boton.disabled = false; }
}

async function asignarTimbres(boton) {
    const correo = $("timbres-correo").value, n = parseInt($("timbres-n").value, 10);
    if (!correo || !n) return mostrarAlerta("error", "Elige la cuenta y cuántos timbres.");
    boton.disabled = true;
    try {
        await api("/api/admin/facturacion/timbres", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ correo, cantidad: n }) });
        timbresAdmin = await api("/api/admin/facturacion/timbres");
        pintarEstado();
        refrescarVentana("dlg-timbres");
        mostrarAlerta("success", `${n > 0 ? "Se asignaron" : "Se quitaron"} ${Math.abs(n)} timbres a ${correo}.`);
    } catch (err) { mostrarAlerta("error", err.message); boton.disabled = false; }
}

const NOMBRE_MODO = { local: "Vostro", vps: "VPS de Oracle", alternar: "Alternar (mitad y mitad)", agente: "PC del contador (agente)" };
const nombreTrabajador = (t) => t === "vps" ? "VPS" : (t || "").startsWith("agente:") ? "PC " + t.slice(7) : "Vostro";

// Tarjeta corta: dónde va cada trámite, agrupado; lo demás (cambiar, probar la VPS) en su ventana
const COLOR_MODO = { local: "bg-slate-100 text-slate-700", vps: "bg-sky-100 text-sky-800", alternar: "bg-indigo-100 text-indigo-800", agente: "bg-emerald-100 text-emerald-800" };
function tarjetaTrabajadores() {
    const t = estadoTrabajadores;
    if (!t) return "";
    const grupos = {};
    const CORTO_RESP = { local: "Vostro", vps: "VPS", alternar: "alternar" };
    Object.keys(t.tramites).forEach(k => {
        const m = t.ajustes[k] || "local", r = (t.respaldos || {})[k] || "local";
        (grupos[m] = grupos[m] || []).push(t.tramites[k].replace(/ \(.*\)$/, "") + (m === "agente" && r !== "local" ? ` (sin PC: ${CORTO_RESP[r]})` : ""));
    });
    const filas = ["agente", "alternar", "vps", "local"].filter(m => grupos[m]).map(m =>
        `<li class="flex items-start gap-2 py-1"><span class="text-[11px] font-bold px-2 py-0.5 rounded-full flex-none ${COLOR_MODO[m]}">${esc(NOMBRE_MODO[m] || m)}</span>
         <span class="text-xs text-slate-700">${grupos[m].map(esc).join(" · ")}</span></li>`).join("");
    return `<ul class="divide-y divide-gray-100">${filas}</ul>
        <div class="flex gap-2 mt-3">
            <button type="button" id="btn-config-trabajos" class="text-xs font-bold text-white bg-slate-800 hover:bg-slate-700 rounded-lg py-1.5 px-3">Cambiar</button>
            <button type="button" id="btn-ver-registro" class="text-xs font-bold text-slate-700 border border-gray-200 hover:border-slate-400 rounded-lg py-1.5 px-3">Ver registro</button></div>`;
}

function abrirTrabajadores() {
    const t = estadoTrabajadores;
    let d = document.getElementById("dlg-trabajos");
    if (!d) {
        d = document.createElement("dialog");
        d.id = "dlg-trabajos";
        d.className = "adm-js"; d.style.cssText = "width:min(var(--modal-mediana),calc(100vw - 32px));max-height:calc(100vh - 48px);border:0;border-radius:20px;padding:0;box-shadow:var(--sombra-alta)";
        document.body.appendChild(d);
        ["input", "change"].forEach(ev => d.addEventListener(ev, e => {
            const c = e.target.closest("[data-guarda]"); if (c) marcarPorGuardar(c);
            const sel = e.target.closest("[data-trabajo]");                       // «PC del contador» muestra su respaldo
            if (sel) { const r = d.querySelector(`[data-sin-pc="${sel.dataset.trabajo}"]`); if (r) r.hidden = sel.value !== "agente"; }
        }));
        d.addEventListener("click", e => {
            if (e.target.closest("[data-cerrar]")) d.close();
            if (e.target.closest("#btn-guardar-trabajos")) guardarTrabajos(e.target.closest("#btn-guardar-trabajos"));
            if (e.target.closest("#btn-probar-trabajador")) probarTrabajador(e.target.closest("#btn-probar-trabajador"));
        });
    }
    const resp = t.respaldos || {};
    const filas = Object.entries(t.tramites).map(([clave, nombre]) => {
        const soloVostro = !!(t.modos_de || {})[clave];
        const sinPc = soloVostro ? '<span class="text-xs text-slate-500">Vostro</span>'
            : `<select data-respaldo="${esc(clave)}" data-guarda="btn-guardar-trabajos" class="border border-gray-200 rounded-lg py-1 px-2 text-xs">
                ${["local", "vps", "alternar"].map(m => `<option value="${m}" ${(resp[clave] || "local") === m ? "selected" : ""}>${esc(NOMBRE_MODO[m])}</option>`).join("")}</select>`;
        return `<tr class="border-t border-gray-100">
        <td class="py-2 pr-3 text-sm text-slate-800">${esc(nombre)}</td>
        <td class="py-2 text-right"><select data-trabajo="${esc(clave)}" data-guarda="btn-guardar-trabajos" class="border border-gray-200 rounded-lg py-1.5 px-2 text-sm">
            ${((t.modos_de || {})[clave] || t.modos).map(m => `<option value="${esc(m)}" ${t.ajustes[clave] === m ? "selected" : ""}>${esc(NOMBRE_MODO[m] || m)}</option>`).join("")}
        </select>
        <div class="mt-1 text-xs text-slate-500" data-sin-pc="${esc(clave)}" ${t.ajustes[clave] === "agente" ? "" : "hidden"}>Si no tiene su PC lista: ${sinPc}</div></td></tr>`;
    }).join("");
    d.innerHTML = `<div style="padding:16px 18px;border-bottom:1px solid rgb(var(--g-200));display:flex;justify-content:space-between;align-items:center">
            <b>¿Dónde se hace cada trámite?</b><button type="button" data-cerrar class="text-slate-400 hover:text-red-500 text-lg">✕</button></div>
        <div style="padding:14px 18px;overflow:auto;max-height:calc(88vh - 60px)">
            <table class="w-full"><tbody>${filas}</tbody></table>
            <div class="flex gap-2 mt-3">${botonGuardar("btn-guardar-trabajos")}</div>
            <ul class="mt-4 text-xs text-slate-600 space-y-1.5 list-disc pl-5">
                <li><b>Vostro:</b> el servidor de la oficina.</li>
                <li><b>VPS de Oracle:</b> el servidor en la nube (otra IP). <b>Alternar:</b> mitad y mitad entre los dos.</li>
                <li><b>PC del contador (agente):</b> en la PC de la cuenta que lo pide, con su internet. Si esa cuenta no tiene una PC
                    conectada y aprobada (o está apagada, en pausa, fuera de su horario o ese trámite no está marcado en esa PC),
                    va al momento a lo que elijas en «Si no tiene su PC lista» (Vostro, VPS o alternar), sin esperar.
                    Si la PC empieza y falla, lo termina la Vostro.</li>
            </ul>
            <div class="mt-4 pt-3 border-t border-gray-100">
                <p class="text-sm font-bold text-slate-800">Probar la VPS</p>
                <div class="flex gap-2 mt-2"><input id="rfc-probar-vps" placeholder="RFC con e.firma guardada" maxlength="13" class="border border-gray-200 rounded-lg py-1.5 px-2 text-sm w-48 uppercase">
                    <button type="button" id="btn-probar-trabajador" class="text-xs font-bold text-slate-700 border border-gray-200 hover:border-slate-400 rounded-lg py-1.5 px-3">Probar</button></div>
                <p id="texto-probar-trabajador" class="text-[11px] text-slate-500 mt-1">Baja la constancia de ese RFC desde la VPS (sin guardarla) para ver si el SAT acepta la IP de Oracle.</p>
            </div>
        </div>`;
    d.showModal();
}

// Botones Guardar de las tarjetas: "Sin cambios" (apagado) → "Guardar cambios" al tocar algo →
// "Guardando…" → "✓ Guardado". Cada campo dice qué botón activa con data-guarda.
const CLASE_GUARDAR = "text-xs font-bold text-white rounded-lg py-1.5 px-3 ";
function botonGuardar(id) {
    return `<button type="button" id="${id}" disabled class="${CLASE_GUARDAR}bg-slate-400">Sin cambios</button>`;
}
function marcarPorGuardar(campo) {
    const b = document.getElementById(campo.dataset.guarda);
    if (!b) return;
    b.disabled = false; b.textContent = "Guardar cambios"; b.className = CLASE_GUARDAR + "bg-amber-600 hover:bg-amber-500";
}
function estadoGuardar(boton, estado) {
    if (estado === "guardando") { boton.disabled = true; boton.textContent = "Guardando…"; return; }
    if (estado === "error") { boton.disabled = false; boton.textContent = "Guardar cambios"; return; }
    boton.disabled = true; boton.textContent = "✓ Guardado"; boton.className = CLASE_GUARDAR + "bg-emerald-600";
    setTimeout(() => { if (boton.textContent === "✓ Guardado") { boton.textContent = "Sin cambios"; boton.className = CLASE_GUARDAR + "bg-slate-400"; } }, 2500);
}

async function guardarTrabajos(boton) {
    const ajustes = {}, respaldos = {};
    document.querySelectorAll("select[data-trabajo]").forEach(s => { ajustes[s.dataset.trabajo] = s.value; });
    document.querySelectorAll("select[data-respaldo]").forEach(s => { respaldos[s.dataset.respaldo] = s.value; });
    estadoGuardar(boton, "guardando");
    try {
        await api("/api/admin/trabajadores", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ajustes, respaldos }) });
        estadoTrabajadores.ajustes = ajustes;
        estadoTrabajadores.respaldos = Object.assign(estadoTrabajadores.respaldos || {}, respaldos);
        estadoGuardar(boton, "ok");
        pintarEstado();                     // la tarjeta resumen se actualiza detrás de la ventana
        return;
    } catch (err) { mostrarAlerta("error", err.message); estadoGuardar(boton, "error"); }
}

async function probarTrabajador(boton) {
    const rfc = ($("rfc-probar-vps").value || "").trim().toUpperCase();
    const t = $("texto-probar-trabajador");
    if (rfc.length < 12) { t.textContent = "Escribe un RFC de tu directorio que tenga e.firma guardada."; return; }
    boton.disabled = true;
    t.className = "text-[11px] text-slate-500 mt-1";
    t.textContent = "La VPS está bajando la constancia… (10 a 30 s)";
    try {
        const r = await api("/api/admin/trabajadores/probar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rfc }) });
        t.className = "text-[11px] mt-1 " + (r.ok ? "text-emerald-700" : "text-amber-700");
        t.textContent = r.ok ? `✓ El SAT aceptó la IP de Oracle: constancia en ${r.segundos} s (${tamano(r.tamano_pdf)}).`
            : `⚠ No se pudo desde la VPS: ${r.motivo}`;
        estadoTrabajadores = await api("/api/admin/trabajadores");
    } catch (err) { t.textContent = err.message; }
    boton.disabled = false;
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
        <div class="adm-barra"><span style="width:${pct}%;${pct > 85 ? "background:rgb(var(--av-600))" : ""}"></span></div>
        <p class="text-xs text-slate-600 mt-2"><strong>${esc(tamano(e.disco.libre))}</strong> libres de ${esc(tamano(e.disco.total))}</p>
        <div class="mt-2 grid grid-cols-2 gap-x-3 text-[11px] text-slate-500">
            ${Object.entries(e.disco.partes).map(([k, v]) => `<span>${esc(k)}</span><span class="text-right font-mono">${esc(tamano(v))}</span>`).join("")}
        </div>`;
    const proxy = e.proxy_configurado
        ? `<p id="texto-proxy" class="text-sm text-slate-600">Sin probar todavía.</p>
           <button type="button" id="btn-probar-proxy" class="mt-2 text-xs font-bold text-slate-700 border border-gray-200 hover:border-slate-400 rounded-lg py-1.5 px-3">Probar ahora</button>`
        : `<p class="text-sm text-amber-700">Sin configurar: falta <span class="font-mono text-xs">FISCONTABLE_PROXY_URL</span> en el servidor.</p>`;
    const r = e.respaldo || {};
    const hora = iso => aFecha(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    const viejo = !r.ultima_ok || (Date.now() - aFecha(r.ultima_ok)) > 26 * 3600 * 1000;
    const respaldoMal = !r.instalado || !r.automatico || r.fallos > 0 || viejo;
    const botonesRespaldo = `<div class="flex flex-wrap gap-2 mt-2">
            <button type="button" id="btn-respaldar" class="text-xs font-bold text-slate-700 border border-gray-200 hover:border-slate-400 rounded-lg py-1.5 px-3 disabled:opacity-40" ${r.copiando ? "disabled" : ""}>${r.copiando ? "Copiando…" : "Respaldar ahora"}</button>
            <button type="button" id="btn-revisar-vps" class="text-xs font-bold text-slate-700 border border-gray-200 hover:border-slate-400 rounded-lg py-1.5 px-3">Revisar la VPS</button>
        </div><p id="texto-vps" class="text-[11px] text-slate-500 mt-1"></p>`;
    const respaldo = !r.instalado
        ? `<p class="text-sm text-amber-700 font-semibold">Sin respaldos automáticos</p>
           <p class="text-[11px] text-slate-500 mt-1">La base, los documentos y las e.firmas guardadas solo existen en la Vostro.</p>`
        : `<p class="text-sm text-slate-800">${r.copiando ? "<strong>Copiando a la VPS ahora…</strong>"
                : r.ultima_ok ? `Última copia a la VPS: <strong>${esc(haceCuanto(r.ultima_ok))}</strong>` : "Todavía sin copias"}</p>
           ${r.ultima_completa ? `<p class="text-[11px] text-slate-500 mt-1">Completa: ${esc(haceCuanto(r.ultima_completa))}</p>` : ""}
           <p class="text-[11px] text-slate-500">${r.programado_para ? `Hubo cambios: la siguiente copia va a las ${esc(hora(r.programado_para))}`
                : "Sin cambios pendientes de copiar"}${r.noche ? ` · De la noche: ${esc(hora(r.noche))}${r.noche_hecha ? " ✓" : ""}` : ""}</p>
           ${!r.automatico ? `<p class="text-xs font-bold text-amber-700 mt-1">⚠ La copia automática está apagada (respaldo-vps.timer).</p>` : ""}
           ${r.fallos ? `<p class="text-xs font-bold text-amber-700 mt-1">⚠ ${esc(r.fallos)} intento(s) fallido(s): ${esc(r.ultimo_error)}</p>` : ""}
           ${botonesRespaldo}`;

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
        tarjeta("Respaldo en la VPS", respaldo, respaldoMal ? "mal" : "") +
        (estadoTrabajadores ? tarjeta("Trabajadores (VPS y PCs)", tarjetaTrabajadores()) : "") +
        (diasInhabiles ? tarjeta("Días inhábiles del SAT", tarjetaInhabiles()) : "") +
        (xmlAutoAdmin ? tarjeta("Descarga automática de XML", tarjetaXmlAuto()) : "") +
        (timbresAdmin ? tarjeta("Timbres de facturación", tarjetaTimbres()) : "") +
        (pcsAgentes ? tarjeta("PCs con el agente", tarjetaPcs()) : "") +
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

// ---------------------------------------------------------------- Estado del SAT
let estadoSAT = null;
let relojSAT = null;

const SAT_ESTADOS = {
    funciona: { texto: "Funciona", clase: "bg-emerald-50 text-emerald-700 border-emerald-200", punto: "rgb(var(--ok-600))" },
    lento: { texto: "Lento", clase: "bg-amber-50 text-amber-700 border-amber-200", punto: "rgb(var(--av-600))" },
    falla: { texto: "No responde", clase: "bg-red-50 text-red-700 border-red-200", punto: "rgb(var(--er-600))" },
    sin_revisar: { texto: "Sin revisar", clase: "bg-slate-50 text-slate-500 border-slate-200", punto: "rgb(var(--g-400))" },
};

function horaCorta(iso) {
    return iso ? aFecha(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "";
}

function faltaPara(iso) {
    const min = Math.round((aFecha(iso) - Date.now()) / 60000);
    if (min <= 0) return "en cualquier momento";
    if (min < 60) return `en ${min} min`;
    return `en ${Math.floor(min / 60)} h ${min % 60} min`;
}

async function cargarEstadoSAT() {
    try {
        estadoSAT = await api("/api/admin/estado-sat");
    } catch (err) {
        $("sat-servicios").innerHTML = `<p class="p-5 text-sm text-amber-700">${esc(err.message)}</p>`;
        return;
    }
    pintarEstadoSAT();
    // Mientras algo se está revisando o está por revisarse, se actualiza solo
    clearTimeout(relojSAT);
    const pronto = estadoSAT.servicios.some(s => s.revisando || (s.proxima_revision && aFecha(s.proxima_revision) - Date.now() < 120000));
    if (pronto && !$("panel-sistema").hidden) relojSAT = setTimeout(cargarEstadoSAT, 15000);
}

function pintarEstadoSAT() {
    const e = estadoSAT;
    const r = e.ritmo;
    $("sat-ritmo").textContent = `Cada ${r.normal_min[0] / 60}–${r.normal_min[1] / 60} h al azar; si falla, cada ${r.vigilancia_min[0]}–${r.vigilancia_min[1]} min`;
    $("sat-servicios").innerHTML = e.servicios.map(s => {
        const st = SAT_ESTADOS[s.estado] || SAT_ESTADOS.sin_revisar;
        const detalle = [];
        if (s.ultima_revision) detalle.push(`Revisado ${haceCuanto(s.ultima_revision)}${s.segundos != null ? ` (${Math.round(s.segundos)} s, ${s.nivel === "completa" ? "con e.firma" : "sin e.firma"})` : ""}`);
        if (s.desde && s.estado !== "sin_revisar") detalle.push(`${s.estado === "falla" ? "Caído" : "Así"} desde las ${horaCorta(s.desde)}`);
        if (s.modo === "vigilancia" && s.estado !== "falla") detalle.push(`Confirmando que volvió: ${s.confirmaciones} de ${s.confirmaciones_necesarias}`);
        if (e.activo && s.proxima_revision && !s.revisando) detalle.push(`Siguiente revisión ${faltaPara(s.proxima_revision)}`);
        return `<div class="p-4 flex flex-wrap items-start gap-3">
            <span class="mt-1.5 w-2.5 h-2.5 rounded-full flex-none" style="background:${st.punto}"></span>
            <div class="flex-grow min-w-[220px]">
                <div class="flex flex-wrap items-center gap-2">
                    <p class="font-bold text-slate-800 text-sm">${esc(s.nombre)}</p>
                    <span class="text-[11px] font-bold border rounded-full px-2 py-0.5 ${st.clase}">${s.revisando ? "Revisando…" : st.texto}</span>
                    ${s.modo === "vigilancia" ? `<span class="text-[11px] font-bold text-amber-700">Vigilando</span>` : ""}
                </div>
                ${s.mensaje ? `<p class="text-xs text-slate-600 mt-1">${esc(s.mensaje)}</p>` : ""}
                <p class="text-[11px] text-slate-400 mt-1">${esc(detalle.join(" · "))}</p>
            </div>
            <button type="button" data-sat-revisar="${esc(s.servicio)}" class="text-xs font-bold text-slate-700 border border-gray-200 hover:border-slate-400 rounded-lg py-1.5 px-3"${s.revisando ? " disabled" : ""}>Revisar ahora</button>
        </div>`;
    }).join("");

    const sel = $("sat-efirma");
    const opciones = [`<option value="">Sin e.firma (solo la pantalla de acceso)</option>`]
        .concat(e.opciones_efirma.map(o => `<option value="${esc(o.rfc)}">${esc(o.nombre)} · ${esc(o.rfc)}</option>`));
    if (e.efirma && !e.opciones_efirma.some(o => o.rfc === e.efirma.rfc)) {
        opciones.push(`<option value="${esc(e.efirma.rfc)}">${esc(e.efirma.rfc)} (de otro administrador)</option>`);
    }
    sel.innerHTML = opciones.join("");
    sel.value = e.efirma ? e.efirma.rfc : "";
    $("chk-sat-activo").checked = !!e.activo;
    $("sat-resumen-config").textContent = (e.activo ? "Revisión automática activada" : "Revisión automática PAUSADA") +
        " · " + (e.efirma ? "con e.firma " + e.efirma.rfc : "sin e.firma (solo la pantalla de acceso)");

    $("sat-historial").innerHTML = e.historial.length
        ? `<table class="w-full"><tbody>${e.historial.map(h => {
            const st = SAT_ESTADOS[h.estado] || SAT_ESTADOS.sin_revisar;
            return `<tr class="border-t border-gray-50 align-top">
                <td class="py-1.5 pr-3 whitespace-nowrap text-slate-400">${esc(aFecha(h.momento).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }))}</td>
                <td class="py-1.5 pr-3 whitespace-nowrap text-slate-700">${esc(h.nombre)}</td>
                <td class="py-1.5 pr-3 whitespace-nowrap font-bold" style="color:${st.punto}">${esc(st.texto)}</td>
                <td class="py-1.5 text-slate-500">${esc(h.mensaje || "")}${h.motivo && h.motivo !== "programada" ? ` <span class="text-slate-400">(${esc(h.motivo)})</span>` : ""}</td>
            </tr>`;
        }).join("")}</tbody></table>`
        : `<p class="text-slate-400">Todavía no hay revisiones.</p>`;

    const caido = e.activo && e.servicios.some(s => s.estado === "falla");
    if (caido) $("alerta-sistema").textContent = "•";
}

async function revisarSAT(servicio) {
    try {
        const r = await api("/api/admin/estado-sat/revisar", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ servicio }),
        });
        mostrarAlerta("success", r.mensaje);
    } catch (err) { mostrarAlerta("error", err.message); }
    setTimeout(cargarEstadoSAT, 1500);
}

async function guardarEfirmaSAT() {
    const rfc = $("sat-efirma").value || null;
    try {
        await api("/api/admin/estado-sat/efirma", {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rfc }),
        });
        mostrarAlerta("success", rfc ? "Listo: las revisiones entrarán con esa e.firma. Se revisa todo en un momento."
                                     : "Listo: las revisiones solo abrirán la pantalla de acceso.");
    } catch (err) { mostrarAlerta("error", err.message); }
    await cargarEstadoSAT();
}

async function cambiarActivoSAT() {
    const activo = $("chk-sat-activo").checked;
    if (!activo && !confirm("¿Pausar la revisión automática del SAT?\n\nSe quita el letrero y la madrugada deja de consultarla.")) {
        $("chk-sat-activo").checked = true; return;
    }
    try {
        await api("/api/admin/estado-sat/activo", {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activo }),
        });
        mostrarAlerta("success", activo ? "Revisión automática activada." : "Revisión automática pausada.");
        if (Fiscontable.recargarLetreros) Fiscontable.recargarLetreros();
    } catch (err) { mostrarAlerta("error", err.message); $("chk-sat-activo").checked = !activo; }
    await cargarEstadoSAT();
}

// ---------------------------------------------------------------- Listas del SAT
let listasReloj = null;
async function cargarListasAdmin() {
    let e;
    try { e = await api("/api/listas-sat/estado"); }
    catch (err) { $("resumen-listas").textContent = err.message; return; }
    const listas = e.listas;
    const errores = listas.filter(l => l.error);
    const fechas = listas.map(l => l.actualizado_al).filter(Boolean).sort();
    const revisadas = listas.map(l => l.revisada_en).filter(Boolean).sort();
    $("resumen-listas").innerHTML = e.actualizando
        ? `<span class="font-semibold text-blue-700">Actualizando las listas…</span>`
        : `<span class="font-semibold">${listas.length - errores.length} de ${listas.length} listas al día</span>` +
          (fechas.length ? ` · la más reciente publicada al ${esc(fechaCorta(fechas[fechas.length - 1]))}` : "") +
          (revisadas.length ? ` · revisadas ${esc(haceCuanto(revisadas[0]))}` : " · todavía no se descargan") +
          ` · ${esc(e.horario)}` +
          (errores.length ? `<p class="text-xs font-bold text-amber-700 mt-1">⚠ Con error: ${errores.map(l => esc(l.nombre)).join(", ")}. Ábrelas en «Ver listas».</p>` : "");
    $("listas-estado").innerHTML = listas.map(l => `
        <div class="bg-white rounded-lg border ${l.error ? "border-amber-300" : "border-gray-200"} p-3">
            <p class="text-sm font-bold text-slate-800">${esc(l.nombre)}</p>
            <p class="text-[11px] text-slate-500">${esc(l.descripcion)}</p>
            <p class="text-[11px] text-slate-600 mt-1">${l.registros != null ? `${Number(l.registros).toLocaleString("es-MX")} ${l.registros === 1 ? "registro" : "registros"}${l.actualizado_al ? " · al " + esc(fechaCorta(l.actualizado_al)) : ""}` : "Todavía no se descarga"}</p>
            ${l.revisada_en ? `<p class="text-[11px] text-slate-400">Revisada ${esc(haceCuanto(l.revisada_en))}</p>` : ""}
            ${l.error ? `<p class="text-[11px] font-bold text-amber-700 mt-1">⚠ ${esc(l.error)}</p>` : ""}
        </div>`).join("");
    const l49 = listas.find(l => l.lista === "49bis");
    if (l49 && !$("url-49bis").value) $("url-49bis").value = l49.url || "";
    $("btn-listas-actualizar").disabled = e.actualizando;
    clearTimeout(listasReloj);
    if (e.actualizando) listasReloj = setTimeout(cargarListasAdmin, 10000);
    if (errores.length) $("alerta-sistema").textContent = "•";
}

async function actualizarListas() {
    if (!confirm("¿Descargar ahora todas las listas del SAT?\n\nTarda unos minutos; solo se reemplazan las que cambiaron.")) return;
    try {
        const r = await api("/api/listas-sat/actualizar", { method: "POST" });
        mostrarAlerta("success", r.mensaje);
    } catch (err) { mostrarAlerta("error", err.message); }
    setTimeout(cargarListasAdmin, 1500);
}

async function guardarUrl49bis() {
    try {
        await api("/api/listas-sat/url-49bis", { method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: $("url-49bis").value.trim() }) });
        mostrarAlerta("success", "Enlace guardado. Se usa en la siguiente actualización.");
    } catch (err) { mostrarAlerta("error", err.message); }
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

async function respaldarAhora(boton) {
    const completo = confirm("¿Copia COMPLETA (compara archivo por archivo, tarda más)?\n\nAceptar = completa · Cancelar = solo lo que cambió");
    boton.disabled = true;
    boton.textContent = "Copiando…";
    try {
        await api("/api/admin/sistema/respaldo", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completo }),
        });
        mostrarAlerta("ok", "Copia a la VPS en curso. Esta tarjeta se actualiza sola cuando termine.");
    } catch (err) { mostrarAlerta("error", err.message); }
    vigilarRespaldo();
}

let relojRespaldo = null;
function vigilarRespaldo() {
    clearInterval(relojRespaldo);
    let vueltas = 0;
    relojRespaldo = setInterval(async () => {
        vueltas++;
        try {
            estadoSistema = await api("/api/admin/sistema/estado");
            pintarEstado();
            if (!(estadoSistema.respaldo || {}).copiando && vueltas > 1) clearInterval(relojRespaldo);
        } catch (err) { clearInterval(relojRespaldo); }
        if (vueltas > 120) clearInterval(relojRespaldo);
    }, 5000);
}

async function revisarVps() {
    const t = $("texto-vps");
    t.textContent = "Preguntando a la VPS…";
    try {
        const r = await api("/api/admin/sistema/respaldo/vps");
        t.className = "text-[11px] mt-1 " + (r.ok && !r.atendiendo ? "text-emerald-700" : "text-amber-700");
        t.textContent = r.ok || r.atendiendo
            ? `${r.mensaje} Datos en la VPS: ${tamano(r.datos)} · disco libre ${tamano(r.disco_libre)}` +
              (r.copia_en_vps ? ` · última copia recibida ${haceCuanto(r.copia_en_vps)}` : "") +
              (r.historial ? ` · Historial: ${r.historial.fotos} foto(s) de la base` + (r.historial.desde ? ` desde el ${r.historial.desde}` : "") +
                  `, ${r.historial.dias_archivos} día(s) de archivos (${tamano(r.historial.tamano || 0)})` : "")
            : r.mensaje;
    } catch (err) { t.textContent = err.message; }
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

let bitacoraCache = [];

function filaBitacora(b) {
    return `<div class="px-5 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span class="text-sm font-semibold text-slate-800">${esc(b.accion)}</span>
        ${b.detalle ? `<span class="text-xs text-slate-500">${esc(b.detalle)}</span>` : ""}
        <span class="ml-auto text-[11px] text-slate-400 whitespace-nowrap" title="${esc(new Date(b.cuando + "Z").toLocaleString("es-MX"))}">${esc(b.quien)} · ${esc(haceCuanto(b.cuando))}</span>
    </div>`;
}

async function cargarBitacora() {
    try {
        bitacoraCache = await api("/api/admin/sistema/bitacora?limite=300");
        $("sin-bitacora").classList.toggle("hidden", bitacoraCache.length > 0);
        $("lista-bitacora").innerHTML = bitacoraCache.slice(0, 5).map(filaBitacora).join("");
        const quienes = [...new Set(bitacoraCache.map(b => b.quien))].sort();
        const sel = $("quien-bitacora"), actual = sel.value;
        sel.innerHTML = `<option value="">Todos</option>` + quienes.map(q => `<option value="${esc(q)}">${esc(q)}</option>`).join("");
        sel.value = quienes.includes(actual) ? actual : "";
        if (!$("ventana").hidden && ventanaBloque && ventanaBloque.bloque.id === "bloque-bitacora") pintarBitacoraToda();
    } catch (err) { mostrarAlerta("error", err.message); }
}

function pintarBitacoraToda() {
    const q = $("buscar-bitacora").value.trim().toLowerCase(), quien = $("quien-bitacora").value;
    const filas = bitacoraCache.filter(b => (!quien || b.quien === quien) &&
        (!q || `${b.accion} ${b.detalle || ""} ${b.quien}`.toLowerCase().includes(q)));
    $("cuenta-bitacora").textContent = `${filas.length} de ${bitacoraCache.length} registros (los más recientes primero).`;
    $("lista-bitacora-toda").innerHTML = filas.map(filaBitacora).join("") ||
        `<p class="p-6 text-center text-sm text-slate-400">Nada coincide.</p>`;
}


// ------------------------------------------------------------ ventanas "Ver registro" (mismo diseño para todas)
// filtros: html de los <label> con sus campos; cabeceras: títulos de la tabla. Buscar = Enter o el botón.
function dialogoRegistro(id, titulo, filtros, cabeceras, buscar, exportar) {
    let d = document.getElementById(id);
    if (!d) {
        d = document.createElement("dialog");
        d.id = id;
        d.className = "adm-js"; d.style.cssText = "width:min(var(--modal-grande),calc(100vw - 32px));max-height:calc(100vh - 48px);border:0;border-radius:20px;padding:0;box-shadow:var(--sombra-alta)";
        d.innerHTML = `<div style="padding:16px 18px;border-bottom:1px solid rgb(var(--g-200));display:flex;justify-content:space-between;align-items:center">
                <b>${esc(titulo)}</b><button type="button" data-cerrar class="text-slate-400 hover:text-red-500 text-lg">✕</button></div>
            <div style="padding:12px 18px" class="flex flex-wrap gap-2 items-end text-xs">${filtros}
                <button type="button" data-buscar class="font-bold text-white bg-slate-800 hover:bg-slate-700 rounded-lg py-1.5 px-3">Buscar</button>
                <button type="button" data-csv class="font-bold text-slate-700 border border-gray-200 rounded-lg py-1.5 px-3">Exportar CSV</button>
                <span data-total class="text-slate-500 ml-auto"></span></div>
            <div style="padding:0 18px 16px;overflow:auto;max-height:60vh"><table class="w-full text-xs"><thead class="text-left text-slate-500"><tr>
                ${cabeceras.map((c, i) => `<th class="${i ? "" : "py-1"}">${esc(c)}</th>`).join("")}</tr></thead><tbody data-filas></tbody></table></div>`;
        document.body.appendChild(d);
        d.querySelector("[data-cerrar]").addEventListener("click", () => d.close());
        d.querySelector("[data-buscar]").addEventListener("click", buscar);
        d.querySelector("[data-csv]").addEventListener("click", exportar);
        d.addEventListener("keydown", e => { if (e.key === "Enter") buscar(); });
    }
    d.showModal();
    buscar();
    return d;
}

function csvDe(nombre, cabeceras, filas) {
    const celda = x => '"' + String(x == null ? "" : x).replace(/"/g, '""') + '"';
    const lineas = [cabeceras.map(celda).join(",")].concat(filas.map(f => f.map(celda).join(",")));
    Fiscontable.guardarArchivo(new Blob(["\ufeff" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" }), nombre);
}

const CAMPO = "border border-gray-200 rounded-lg py-1 px-2";

// ------------------------------------------------------------ registro de trabajadores
let registroActual = [];

function abrirRegistro() {
    dialogoRegistro("dlg-registro", "Registro de trabajadores", `
        <label>Quién<br><select id="reg-trabajador" class="${CAMPO}"></select></label>
        <label>Trámite<br><select id="reg-tipo" class="${CAMPO}"></select></label>
        <label>RFC<br><input id="reg-rfc" class="${CAMPO} w-32 uppercase"></label>
        <label>Resultado<br><select id="reg-ok" class="${CAMPO}"><option value="">Todos</option><option value="1">Bien</option><option value="0">Falló</option></select></label>
        <label>Desde<br><input id="reg-desde" type="date" class="${CAMPO}"></label>
        <label>Hasta<br><input id="reg-hasta" type="date" class="${CAMPO}"></label>`,
        ["Cuándo", "Quién", "Trámite", "RFC", "Seg.", "Resultado"], buscarRegistro, exportarRegistro);
}

async function buscarRegistro() {
    const v = id => (document.getElementById(id).value || "").trim();
    const q = new URLSearchParams({ trabajador: v("reg-trabajador"), tipo: v("reg-tipo"), rfc: v("reg-rfc"), ok: v("reg-ok"), desde: v("reg-desde"), hasta: v("reg-hasta") });
    const total = document.querySelector("#dlg-registro [data-total]"), cuerpo = document.querySelector("#dlg-registro [data-filas]");
    total.textContent = "Buscando…";
    try {
        const r = await api("/api/admin/trabajadores/registro?" + q);
        registroActual = r.filas;
        const selT = $("reg-trabajador"), actualT = selT.value;
        selT.innerHTML = '<option value="">Todos</option>' + r.trabajadores.map(t => `<option value="${esc(t)}">${esc(t === "local" ? "Vostro (sin navegador)" : nombreTrabajador(t))}</option>`).join("");
        selT.value = actualT;
        const selP = $("reg-tipo"), actualP = selP.value;
        selP.innerHTML = '<option value="">Todos</option>' + Object.entries(r.tramites).map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join("");
        selP.value = actualP;
        total.textContent = `${r.filas.length} registro${r.filas.length === 1 ? "" : "s"}` + (r.filas.length >= 500 ? " (los 500 más recientes)" : "");
        cuerpo.innerHTML = r.filas.map(f => `<tr class="border-t border-gray-100">
            <td class="py-1">${esc(fechaHoraCorta(f.inicio))}</td><td>${esc(f.trabajador === "local" ? "Vostro" : nombreTrabajador(f.trabajador))}</td>
            <td>${esc(r.tramites[f.tipo] || f.tipo)}</td><td class="font-mono">${esc(f.rfc || "")}</td><td>${f.segundos ? esc(f.segundos) : ""}</td>
            <td>${f.ok ? '<span class="text-emerald-700">✓ bien</span>' : '<span class="text-red-700">✗ ' + esc(f.motivo || "falló") + "</span>"}</td></tr>`).join("") ||
            '<tr><td colspan="6" class="py-3 text-slate-400">Sin registros con esos filtros.</td></tr>';
    } catch (err) { total.textContent = err.message; }
}

function fechaHoraCorta(iso) {
    const f = new Date(iso);
    return isNaN(f) ? iso : f.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function exportarRegistro() {
    csvDe("Registro_trabajadores.csv", ["Cuando", "Quien", "Tramite", "RFC", "Segundos", "Resultado", "Motivo"],
        registroActual.map(f => [fechaHoraCorta(f.inicio), f.trabajador, f.tipo, f.rfc, f.segundos, f.ok ? "bien" : "fallo", f.motivo]));
}

// ------------------------------------------------------------ registro de sesiones en la web
let sesionesActual = [];

function abrirRegistroSesiones() {
    const d = dialogoRegistro("dlg-sesiones", "Registro de sesiones en la web", `
        <label>Cuenta<br><input id="ses-correo" list="ses-correos" class="${CAMPO} w-48" placeholder="correo"><datalist id="ses-correos"></datalist></label>
        <label>Red (IP)<br><input id="ses-ip" class="${CAMPO} w-32"></label>
        <label>Estado<br><select id="ses-estado" class="${CAMPO}"><option value="">Todas</option><option value="activas">Conectadas ahora</option><option value="cerradas">Cerradas por Administración</option></select></label>
        <label>Desde<br><input id="ses-desde" type="date" class="${CAMPO}"></label>
        <label>Hasta<br><input id="ses-hasta" type="date" class="${CAMPO}"></label>`,
        ["Entró", "Última actividad", "Cuenta", "Navegador", "Red", "Peticiones", "Estado", ""], buscarSesiones, exportarSesiones);
    if (!d.dataset.listo) {
        d.dataset.listo = "1";
        d.addEventListener("click", e => { const b = e.target.closest("[data-cerrar-sesion]"); if (b) cerrarSesionWeb(b); });
    }
}

async function buscarSesiones() {
    const d = document.getElementById("dlg-sesiones"), total = d.querySelector("[data-total]"), cuerpo = d.querySelector("[data-filas]");
    const v = id => (document.getElementById(id).value || "").trim();
    total.textContent = "Buscando…";
    try {
        const r = await api("/api/admin/sesiones/registro?" + new URLSearchParams({ correo: v("ses-correo"), ip: v("ses-ip"), estado: v("ses-estado"), desde: v("ses-desde"), hasta: v("ses-hasta") }));
        sesionesActual = r.filas;
        $("ses-correos").innerHTML = r.correos.map(c => `<option value="${esc(c)}">`).join("");
        total.textContent = `${r.filas.length} sesi${r.filas.length === 1 ? "ón" : "ones"}` + (r.filas.length >= r.limite ? ` (las ${r.limite} más recientes)` : "");
        cuerpo.innerHTML = r.filas.map(x => `<tr class="border-t border-gray-100 align-top">
            <td class="py-1">${esc(fechaHoraCorta(x.inicio))}</td><td>${esc(fechaHoraCorta(x.ultimo))}</td><td>${esc(x.correo)}</td>
            <td>${esc(x.navegador || "?")}</td><td>${esc(x.ip || "?")}${x.pais ? " (" + esc(x.pais) + ")" : ""}</td><td>${esc(x.peticiones)}</td>
            <td>${x.cerrada_en ? `<span class="text-red-700">cerrada por ${esc(x.cerrada_por)}</span>` : x.activa ? '<span class="text-emerald-700">conectada</span>' : "terminó"}</td>
            <td>${!x.cerrada_en ? `<button type="button" data-cerrar-sesion="${esc(x.clave)}" data-correo="${esc(x.correo)}" class="text-[11px] text-slate-500 hover:text-red-600 border border-gray-200 rounded-lg py-0.5 px-2">Cerrar</button>` : ""}</td></tr>`).join("") ||
            '<tr><td colspan="8" class="py-3 text-slate-400">Sin sesiones con esos filtros.</td></tr>';
    } catch (err) { total.textContent = err.message; }
}

function exportarSesiones() {
    csvDe("Registro_sesiones.csv", ["Entro", "Ultima actividad", "Cuenta", "Navegador", "Red", "Pais", "Peticiones", "Estado"],
        sesionesActual.map(x => [fechaHoraCorta(x.inicio), fechaHoraCorta(x.ultimo), x.correo, x.navegador, x.ip, x.pais, x.peticiones,
            x.cerrada_en ? "cerrada por " + x.cerrada_por : x.activa ? "conectada" : "termino"]));
}


// N-04: «Ver como» — el admin ve la plataforma como esa persona (solo lectura, 60 min, queda en la bitácora)
async function verComo(correo) {
    if (!confirm("¿Ver Fiscontable como " + correo + "?\n\nEs solo lectura (no se puede cambiar nada), dura 60 minutos y queda en la bitácora. Sales con «Salir» en el letrero de arriba.")) return;
    try {
        const r = await fetch(`${Fiscontable.API}/api/admin/ver-como`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ correo }) });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        location.href = "/";
    } catch (e) { alert(e.message); }
}
