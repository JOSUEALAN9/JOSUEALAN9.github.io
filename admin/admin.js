/**
 * admin.js — código de admin/ (antes vivía dentro del HTML).
 */
const API_URL = Fiscontable.API;          // la dirección vive solo en assets/js/nucleo.js
const esc = Fiscontable.escapar;          // todo texto del servidor pasa por aquí antes de ir al HTML
let usuariosCache = [];

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
            <td class="p-4 capitalize">${esc(u.rol)}</td>
            <td class="p-4 text-xs text-slate-500">${u.fecha_expira ? u.fecha_expira.slice(0, 10) : "Sin vencimiento"}</td>
            <td class="p-4">${estatus}</td>
            <td class="p-4 text-right whitespace-nowrap">
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
        mostrarAlerta("success", "Usuario guardado.");
        await cargarUsuarios();
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
        `Se borra su rol, su nombre y su teléfono. Si vuelve a entrar, se le pedirán sus datos otra vez y entrará con el rol más básico (Plus).\n\n` +
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
