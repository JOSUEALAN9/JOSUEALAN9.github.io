/**
 * admin.js — código de admin/ (antes vivía dentro del HTML).
 */
const API_URL = Fiscontable.API;          // la dirección vive solo en assets/js/nucleo.js
const esc = Fiscontable.escapar;          // todo texto del servidor pasa por aquí antes de ir al HTML
let usuariosCache = [];
let rolesCache = null;      // {modulos:[{clave,nombre}], roles:[...]} de /api/admin/roles
let correoEnAjustes = null;
const DIAS_DEMO = 7;

document.addEventListener("DOMContentLoaded", verificarAdminYCargar);

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
    if (!response) return "No pudimos conectar con el servidor. Intenta de nuevo más tarde.";
    if (response.status === 401 || response.status === 403) {
        try {
            const data = await response.json();
            return data.detail || "No tienes permiso para esto.";
        } catch { return "No tienes permiso para esto."; }
    }
    try {
        const data = await response.json();
        return data.detail || "Ocurrió un error inesperado.";
    } catch { return "Ocurrió un error inesperado."; }
}

async function verificarAdminYCargar() {
    try {
        const perfilResp = await fetch(`${API_URL}/api/mi-perfil`, { credentials: "include" });
        if (!perfilResp.ok) { mostrarAlerta("error", await interpretarError(perfilResp)); return; }
        const perfil = await perfilResp.json();

        if (perfil.rol !== "admin") {
            document.getElementById("bloqueo-no-admin").classList.remove("hidden");
            return;
        }
        document.getElementById("contenido-admin").classList.remove("hidden");
        document.getElementById("input-rol").addEventListener("change", alCambiarRolFormulario);
        await cargarRoles();
        await cargarUsuarios();
        await cargarProcesosAdmin();
    } catch (error) {
        mostrarAlerta("error", "No se pudo verificar tu acceso. Intenta de nuevo más tarde.");
    }
}


async function cargarProcesosAdmin() {
    try {
        const resp = await fetch(`${API_URL}/api/admin/procesos`, { credentials: "include" });
        if (!resp.ok) { mostrarAlerta("error", await interpretarError(resp)); return; }
        const procesos = await resp.json();

        const tbody = document.getElementById("tabla-procesos-admin");
        const vacio = document.getElementById("sin-procesos-admin");

        if (procesos.length === 0) {
            tbody.innerHTML = "";
            vacio.classList.remove("hidden");
            return;
        }
        vacio.classList.add("hidden");

        const nombres = { csf: "Constancia", opinion: "Opinión", "csf+opinion": "Constancia + Opinión" };
        const badges = {
            procesando: '<span class="text-xs font-bold px-2 py-1 rounded-full bg-blue-100 text-blue-700">En proceso</span>',
            completado: '<span class="text-xs font-bold px-2 py-1 rounded-full bg-green-100 text-green-700">Completado</span>',
            cancelado: '<span class="text-xs font-bold px-2 py-1 rounded-full bg-gray-100 text-gray-600">Cancelado</span>',
            interrumpido: '<span class="text-xs font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700">Interrumpido</span>',
        };

        tbody.innerHTML = procesos.map(p => {
            const badge = badges[p.estado] || '<span class="text-xs font-bold px-2 py-1 rounded-full bg-red-100 text-red-700">Error</span>';
            const motivos = (p.motivos && p.motivos.length)
                ? `<div class="mt-1.5">${p.motivos.map(m => `<span class="text-xs text-amber-700 block">${esc(m.cuantos)} × ${esc(m.motivo)}</span>`).join("")}</div>`
                : "";
            const avance = (p.clase === "lote" && p.estado === "procesando" && p.total)
                ? `<span class="text-xs text-slate-400 block">${esc(p.procesados)}/${esc(p.total)}${p.rfc_actual ? " · " + esc(p.rfc_actual) : ""}</span>` : "";
            const detener = p.estado === "procesando"
                ? `<button data-clase="${esc(p.clase)}" data-id="${esc(p.id)}" onclick="cancelarProcesoAdmin(this.dataset.clase, this.dataset.id, this)" class="text-xs font-bold text-slate-400 hover:text-red-600 border border-gray-200 rounded py-1 px-2.5 transition">Detener</button>`
                : "";
            const fecha = new Date(p.creado_en + "Z").toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
            return `
            <tr class="border-t border-gray-100">
                <td class="p-4 font-mono text-xs">${esc(p.usuario)}</td>
                <td class="p-4">
                    <span class="font-semibold">${esc(nombres[p.tipo] || p.tipo)}</span>
                    <span class="text-xs text-slate-400 block">${esc(p.titulo)}</span>
                    ${avance}
                    ${motivos}
                </td>
                <td class="p-4">${badge}</td>
                <td class="p-4 text-xs text-slate-500">${fecha}</td>
                <td class="p-4 text-right">${detener}</td>
            </tr>`;
        }).join("");

    } catch (error) {
        mostrarAlerta("error", "No se pudo cargar la actividad del portal.");
    }
}

async function cancelarProcesoAdmin(clase, id, boton) {
    if (!confirm("¿Detener este proceso? Se conservará lo que ya se haya generado.")) return;
    boton.disabled = true;
    boton.textContent = "...";
    try {
        const resp = await fetch(`${API_URL}/api/admin/procesos/${clase}/${id}/cancelar`, {
            method: "POST", credentials: "include",
        });
        if (!resp.ok) { mostrarAlerta("error", await interpretarError(resp)); boton.disabled = false; return; }
        mostrarAlerta("success", "Se detendrá al terminar el contribuyente en curso.");
        await cargarProcesosAdmin();
    } catch (error) {
        mostrarAlerta("error", "No se pudo conectar con el servidor.");
        boton.disabled = false;
    }
}

async function cargarUsuarios() {
    const resp = await fetch(`${API_URL}/api/usuarios`, { credentials: "include" });
    if (!resp.ok) { mostrarAlerta("error", await interpretarError(resp)); return; }
    usuariosCache = await resp.json();
    renderizarTabla();
}

function renderizarTabla() {
    const tbody = document.getElementById("tabla-usuarios");
    const hoyIso = new Date().toISOString();
    tbody.innerHTML = usuariosCache.map(u => {
        const expirado = u.fecha_expira && hoyIso > u.fecha_expira;
        const estatus = !u.activo
            ? `<span class="text-xs font-bold px-2 py-1 rounded-full bg-gray-100 text-gray-500">Desactivado</span>`
            : expirado
                ? `<span class="text-xs font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700">Vencido</span>`
                : `<span class="text-xs font-bold px-2 py-1 rounded-full bg-green-100 text-green-700">Vigente</span>`;
        return `
        <tr class="border-t border-gray-100">
            <td class="p-4 font-mono text-xs">${esc(u.correo)}</td>
            <td class="p-4">
                <span class="capitalize">${esc(u.rol)}</span>
                ${u.personalizado ? `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 ml-1" title="${esc(resumenAjustes(u))}">Personalizado</span>` : ""}
            </td>
            <td class="p-4 text-xs text-slate-500">${u.fecha_expira ? u.fecha_expira.slice(0, 10) : "Sin vencimiento"}</td>
            <td class="p-4">${estatus}</td>
            <td class="p-4 text-right whitespace-nowrap">
                ${u.rol === "admin" ? "" : `<button data-correo="${esc(u.correo)}" onclick="abrirAjustesUsuario(this.dataset.correo)" title="Ajustes propios (módulos y límite solo para esta persona)" class="text-xs font-bold text-slate-500 hover:text-slate-800 border border-gray-200 rounded-lg py-1 px-2 mr-2">Ajustes</button>`}
                <button data-correo="${esc(u.correo)}" onclick="editarUsuario(this.dataset.correo)" title="Editar" class="text-slate-400 hover:text-slate-800 transition mr-2">
                    <svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                </button>
                <button data-correo="${esc(u.correo)}" onclick="eliminarUsuario(this.dataset.correo)" title="Quitar acceso" class="text-gray-300 hover:text-red-500 transition">
                    <svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </td>
        </tr>`;
    }).join("");
}

async function guardarUsuario(e) {
    e.preventDefault();
    const correo = document.getElementById("input-correo").value.trim().toLowerCase();
    const rol = document.getElementById("input-rol").value;
    const fechaInput = document.getElementById("input-fecha").value;
    const fecha_expira = fechaInput ? new Date(fechaInput + "T23:59:59").toISOString() : null;

    try {
        const resp = await fetch(`${API_URL}/api/usuarios`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ correo, rol, fecha_expira, activo: true }),
        });
        if (!resp.ok) { mostrarAlerta("error", await interpretarError(resp)); return; }
        document.getElementById("form-usuario").reset();
        alCambiarRolFormulario();
        mostrarAlerta("success", "Usuario guardado.");
        await cargarUsuarios();
        await cargarRoles();
    } catch (error) {
        mostrarAlerta("error", "No se pudo conectar con el servidor. Intenta de nuevo más tarde.");
    }
}

function editarUsuario(correo) {
    const u = usuariosCache.find(x => x.correo === correo);
    if (!u) return;
    document.getElementById("input-correo").value = u.correo;
    document.getElementById("input-rol").value = u.rol;
    document.getElementById("input-fecha").value = u.fecha_expira ? u.fecha_expira.slice(0, 10) : "";
    document.getElementById("input-correo").scrollIntoView({ behavior: "smooth", block: "center" });
    mostrarAlerta("success", `Editando a ${u.correo}. Ajusta el rol o la vigencia y guarda.`);
}

async function eliminarUsuario(correo) {
    const confirmacion = confirm(
        `¿Quitar el acceso de ${correo}?\n\n` +
        `Se borra su rol, su nombre y su teléfono. Si vuelve a entrar, se le pedirán sus datos otra vez y entrará como Demo por 7 días.\n\n` +
        `Sus clientes y documentos NO se borran: los recupera al volver a entrar.\n\n` +
        `Si solo quieres cambiarle el rol o la vigencia, cancela y usa el botón del lápiz.`
    );
    if (!confirmacion) return;
    try {
        const resp = await fetch(`${API_URL}/api/usuarios/${encodeURIComponent(correo)}`, {
            method: "DELETE",
            credentials: "include",
        });
        if (!resp.ok) { mostrarAlerta("error", await interpretarError(resp)); return; }
        await cargarUsuarios();
    } catch (error) {
        mostrarAlerta("error", "No se pudo conectar con el servidor. Intenta de nuevo más tarde.");
    }
}


/* =====================================================================
 * Rol Demo en el formulario: siempre vence
 * ===================================================================== */
function alCambiarRolFormulario() {
    const rol = document.getElementById("input-rol").value;
    const fecha = document.getElementById("input-fecha");
    document.getElementById("etiqueta-fecha").textContent = rol === "demo" ? "Vence (obligatorio en Demo)" : "Vence (opcional)";
    if (rol === "demo" && !fecha.value) {
        const d = new Date(Date.now() + DIAS_DEMO * 86400000);
        fecha.value = d.toISOString().slice(0, 10);
    }
}

/* =====================================================================
 * Permisos por rol (cuadrícula)
 * ===================================================================== */
function nombreLimite(limite) {
    if (limite === null || limite === undefined) return "sin límite";
    if (limite === 0) return "sin descargas masivas";
    return `${limite} RFC al día`;
}

function nombresModulos(claves) {
    if (!rolesCache) return claves.join(", ");
    const mapa = Object.fromEntries(rolesCache.modulos.map(m => [m.clave, m.nombre]));
    return claves.map(c => mapa[c] || c).join(", ") || "ninguno";
}

async function cargarRoles() {
    try {
        const resp = await fetch(`${API_URL}/api/admin/roles`, { credentials: "include" });
        if (!resp.ok) { mostrarAlerta("error", await interpretarError(resp)); return; }
        rolesCache = await resp.json();
        renderizarRoles();
    } catch (error) {
        mostrarAlerta("error", "No se pudieron cargar los permisos por rol.");
    }
}

function renderizarRoles() {
    const mods = rolesCache.modulos;
    document.getElementById("cabeza-roles").innerHTML = `
        <tr>
            <th class="p-4">Rol</th>
            ${mods.map(m => `<th class="p-2 text-center">${esc(m.nombre)}</th>`).join("")}
            <th class="p-2 text-center">RFC/día</th>
            <th class="p-4"></th>
        </tr>`;

    document.getElementById("tabla-roles").innerHTML = rolesCache.roles.map(r => {
        const quien = r.actualizado_por
            ? `<span class="text-[11px] text-slate-400 block">Cambió: ${esc(r.actualizado_por)}${r.actualizado_en ? " · " + esc(new Date(r.actualizado_en + "Z").toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })) : ""}</span>`
            : "";
        const cabeza = `
            <td class="p-4 align-top">
                <span class="font-bold text-slate-800">${esc(r.nombre)}</span>
                <span class="text-xs text-slate-400">(${esc(r.usuarios)} ${r.usuarios === 1 ? "usuario" : "usuarios"})</span>
                ${quien}
            </td>`;
        if (!r.editable) {
            return `<tr class="border-t border-gray-100 bg-slate-50/60">${cabeza}
                <td class="p-4 text-xs text-slate-500" colspan="${mods.length + 2}">Todos los módulos y esta pantalla · sin límite · no se edita</td></tr>`;
        }
        return `
        <tr class="border-t border-gray-100" data-rol="${esc(r.rol)}">
            ${cabeza}
            ${mods.map(m => `
                <td class="p-2 text-center align-top">
                    <input type="checkbox" class="rol-modulo w-4 h-4" value="${esc(m.clave)}" ${r.modulos.includes(m.clave) ? "checked" : ""} aria-label="${esc(r.nombre)}: ${esc(m.nombre)}">
                </td>`).join("")}
            <td class="p-2 text-center align-top">
                <input type="number" min="0" max="10000" class="rol-limite w-20 text-sm border border-gray-300 rounded-lg p-1.5 text-center"
                       value="${r.limite_rfc_diario === null ? "" : esc(r.limite_rfc_diario)}" placeholder="∞">
            </td>
            <td class="p-4 text-right whitespace-nowrap align-top">
                <button data-rol="${esc(r.rol)}" onclick="guardarRol(this.dataset.rol)" class="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-1.5 px-3 rounded-lg">Guardar</button>
                ${r.fabrica ? `<button data-rol="${esc(r.rol)}" onclick="restaurarRol(this.dataset.rol)" class="text-xs text-slate-400 hover:text-slate-700 underline ml-2" title="${esc(nombresModulos(r.fabrica.modulos))} · ${esc(nombreLimite(r.fabrica.limite))}">Valores de fábrica</button>` : ""}
            </td>
        </tr>`;
    }).join("");
}

function leerFilaRol(rol) {
    const fila = document.querySelector(`#tabla-roles tr[data-rol="${CSS.escape(rol)}"]`);
    const modulos = Array.from(fila.querySelectorAll(".rol-modulo:checked")).map(c => c.value);
    const texto = fila.querySelector(".rol-limite").value.trim();
    const limite = texto === "" ? null : Number(texto);
    return { modulos, limite };
}

async function guardarRol(rol) {
    const actual = rolesCache.roles.find(r => r.rol === rol);
    const nuevo = leerFilaRol(rol);
    if (nuevo.limite !== null && (!Number.isInteger(nuevo.limite) || nuevo.limite < 0 || nuevo.limite > 10000)) {
        mostrarAlerta("error", "El límite debe ser un número entre 0 y 10,000, o vacío para sin límite.");
        return;
    }
    const agrega = nuevo.modulos.filter(m => !actual.modulos.includes(m));
    const quita = actual.modulos.filter(m => !nuevo.modulos.includes(m));
    const cambios = [];
    if (agrega.length) cambios.push(`podrá usar: ${nombresModulos(agrega)}`);
    if (quita.length) cambios.push(`ya no podrá usar: ${nombresModulos(quita)}`);
    if (nuevo.limite !== actual.limite_rfc_diario) cambios.push(`descargas masivas: ${nombreLimite(nuevo.limite)} (antes ${nombreLimite(actual.limite_rfc_diario)})`);
    if (!cambios.length) { mostrarAlerta("success", "No hay cambios que guardar."); return; }

    const personalizados = usuariosCache.filter(u => u.rol === rol && u.personalizado).length;
    const aviso = `${actual.nombre}:\n- ${cambios.join("\n- ")}\n\nAfecta a ${actual.usuarios} ${actual.usuarios === 1 ? "usuario" : "usuarios"}` +
        (personalizados ? ` (a ${personalizados} con ajustes propios no les cambia lo que tengan personalizado)` : "") + ".";
    if (!confirm(aviso)) return;

    try {
        const resp = await fetch(`${API_URL}/api/admin/roles/${encodeURIComponent(rol)}`, {
            method: "PUT", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modulos: nuevo.modulos, limite_rfc_diario: nuevo.limite }),
        });
        if (!resp.ok) { mostrarAlerta("error", await interpretarError(resp)); return; }
        mostrarAlerta("success", `Permisos de ${actual.nombre} guardados.`);
        await cargarRoles();
        await cargarUsuarios();
    } catch (error) {
        mostrarAlerta("error", "No se pudo conectar con el servidor.");
    }
}

async function restaurarRol(rol) {
    const r = rolesCache.roles.find(x => x.rol === rol);
    if (!confirm(`¿Regresar ${r.nombre} a sus valores de fábrica?\n\n${nombresModulos(r.fabrica.modulos)}\n${nombreLimite(r.fabrica.limite)}`)) return;
    try {
        const resp = await fetch(`${API_URL}/api/admin/roles/${encodeURIComponent(rol)}/restaurar`, { method: "POST", credentials: "include" });
        if (!resp.ok) { mostrarAlerta("error", await interpretarError(resp)); return; }
        mostrarAlerta("success", `${r.nombre} regresó a sus valores de fábrica.`);
        await cargarRoles();
        await cargarUsuarios();
    } catch (error) {
        mostrarAlerta("error", "No se pudo conectar con el servidor.");
    }
}

/* =====================================================================
 * Ajustes propios de un usuario
 * ===================================================================== */
function resumenAjustes(u) {
    return `Módulos: ${nombresModulos(u.modulos_efectivos || [])} · ${nombreLimite(u.limite_efectivo)}`;
}

function abrirAjustesUsuario(correo) {
    const u = usuariosCache.find(x => x.correo === correo);
    if (!u || !rolesCache) return;
    correoEnAjustes = correo;
    const delRol = rolesCache.roles.find(r => r.rol === u.rol) || { modulos: [], limite_rfc_diario: null };

    document.getElementById("ajustes-correo").textContent = `${u.correo} · rol ${u.rol}`;
    document.getElementById("ajustes-modulos-rol").textContent = `(${nombresModulos(delRol.modulos)})`;
    const propios = u.modulos_propios;
    document.querySelector(`input[name="ajustes-modo"][value="${propios ? "propios" : "rol"}"]`).checked = true;
    const marcados = propios || delRol.modulos;
    document.getElementById("ajustes-casillas").innerHTML = rolesCache.modulos.map(m => `
        <label class="text-sm flex items-center gap-2">
            <input type="checkbox" class="ajuste-modulo" value="${esc(m.clave)}" ${marcados.includes(m.clave) ? "checked" : ""}> ${esc(m.nombre)}
        </label>`).join("");

    const selLimite = document.getElementById("ajustes-limite-modo");
    const inpLimite = document.getElementById("ajustes-limite");
    selLimite.options[0].textContent = `El de su rol (${nombreLimite(delRol.limite_rfc_diario)})`;
    if (u.limite_propio === "rol") { selLimite.value = "rol"; inpLimite.value = ""; }
    else if (u.limite_propio === "sin") { selLimite.value = "sin"; inpLimite.value = ""; }
    else { selLimite.value = "numero"; inpLimite.value = u.limite_propio; }

    pintarModoAjustes();
    document.getElementById("dlg-ajustes").showModal();
}

function pintarModoAjustes() {
    const propios = document.querySelector('input[name="ajustes-modo"]:checked').value === "propios";
    document.querySelectorAll(".ajuste-modulo").forEach(c => { c.disabled = !propios; });
    document.getElementById("ajustes-casillas").style.opacity = propios ? "1" : "0.45";
    const conNumero = document.getElementById("ajustes-limite-modo").value === "numero";
    document.getElementById("ajustes-limite").style.display = conNumero ? "" : "none";
}

async function guardarAjustesUsuario(e) {
    e.preventDefault();
    const propios = document.querySelector('input[name="ajustes-modo"]:checked').value === "propios";
    const modulos = propios ? Array.from(document.querySelectorAll(".ajuste-modulo:checked")).map(c => c.value) : null;
    const modo = document.getElementById("ajustes-limite-modo").value;
    let limite = modo;
    if (modo === "numero") {
        limite = Number(document.getElementById("ajustes-limite").value);
        if (document.getElementById("ajustes-limite").value.trim() === "" || !Number.isInteger(limite) || limite < 0 || limite > 10000) {
            mostrarAlerta("error", "Escribe un número entre 0 y 10,000 para el límite.");
            return;
        }
    }
    try {
        const resp = await fetch(`${API_URL}/api/usuarios/${encodeURIComponent(correoEnAjustes)}/ajustes`, {
            method: "PUT", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modulos, limite }),
        });
        if (!resp.ok) { mostrarAlerta("error", await interpretarError(resp)); return; }
        document.getElementById("dlg-ajustes").close();
        mostrarAlerta("success", `Ajustes de ${correoEnAjustes} guardados.`);
        await cargarUsuarios();
    } catch (error) {
        mostrarAlerta("error", "No se pudo conectar con el servidor.");
    }
}
