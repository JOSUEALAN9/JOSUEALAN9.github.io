/**
 * clientes.js — código de clientes/ (antes vivía dentro del HTML).
 */
const API_URL = Fiscontable.API;          // la dirección vive solo en assets/js/nucleo.js
const esc = Fiscontable.escapar;          // todo texto del servidor pasa por aquí antes de ir al HTML
let clientesCache = [];
let soloLectura = false;
let sinConexion = false;

document.addEventListener("DOMContentLoaded", inicializar);
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

function abrirModalNuevoCliente() {
    if (sinConexion || soloLectura) return;
    document.getElementById("modal-nuevo-cliente").classList.add("modal-active");
    document.getElementById("input-rfc").focus();
}
function cerrarModalNuevoCliente() {
    document.getElementById("modal-nuevo-cliente").classList.remove("modal-active");
    document.getElementById("form-nuevo-cliente").reset();
}

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
        renderizarClientes();
    } catch (error) {
        marcarSinConexion();
    }
}

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

function renderizarClientes() {
    const contenedor = document.getElementById("lista-clientes");
    const estadoVacio = document.getElementById("estado-vacio");

    if (clientesCache.length === 0) {
        contenedor.innerHTML = "";
        estadoVacio.classList.remove("hidden");
        return;
    }
    estadoVacio.classList.add("hidden");

    contenedor.innerHTML = clientesCache.map(cliente => {
        const rfcCodificado = encodeURIComponent(cliente.rfc);
        const aliasCodificado = encodeURIComponent(cliente.alias);
        return `
        <div class="bg-white rounded-xl card-elevated border border-gray-200 p-5 flex flex-col gap-3">
            <div class="flex justify-between items-start gap-2">
                <div>
                    <h3 class="font-bold text-slate-800 leading-tight">${esc(cliente.alias)}</h3>
                    <p class="text-xs text-slate-400 font-mono">${esc(cliente.rfc)}</p>
                </div>
                <div class="flex items-center gap-1 flex-none">
                    <button data-rfc="${esc(cliente.rfc)}" onclick="abrirModalEditar(this.dataset.rfc)" title="Editar cliente" class="text-gray-300 hover:text-violet-600 transition ${soloLectura ? 'hidden' : ''}">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                    </button>
                    <button data-rfc="${esc(cliente.rfc)}" onclick="eliminarCliente(this.dataset.rfc)" title="Quitar del directorio" class="text-gray-300 hover:text-red-500 transition ${soloLectura ? 'hidden' : ''}">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            </div>

            <div class="flex gap-2 flex-wrap items-center">
                ${badgeDocumento(cliente, "csf", "Constancia")}
                ${badgeDocumento(cliente, "opinion", "Opinión")}
                ${cliente.efirma_guardada
                    ? `<span class="text-xs font-bold px-2 py-1 rounded-full bg-violet-100 text-violet-700 flex items-center gap-1">
                           <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                           e.firma guardada
                       </span>${soloLectura ? '' : `<button data-rfc="${esc(cliente.rfc)}" onclick="olvidarEfirma(this.dataset.rfc)" class="text-xs text-slate-400 hover:text-red-500 underline transition">olvidar</button>`}`
                    : `<span class="text-xs font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-400">Sin e.firma guardada</span>`
                }
            </div>

            <div class="atajos">
                <a href="/herramientas/constancias/?rfc=${rfcCodificado}&cliente=${aliasCodificado}" style="--tono:#4338CA;--tono-suave:#ECEBFB">Constancia</a>
                <a href="/herramientas/opinion/?rfc=${rfcCodificado}&cliente=${aliasCodificado}" style="--tono:#0F766E;--tono-suave:#E6F2F1">Opinión</a>
                <a href="/herramientas/declaraciones/?rfc=${rfcCodificado}&cliente=${aliasCodificado}" style="--tono:#0369A1;--tono-suave:#E4F1F9">Declaraciones</a>
            </div>
        </div>`;
    }).join("");
}

async function crearCliente(e) {
    e.preventDefault();
    const boton = document.getElementById("btn-guardar-cliente");
    const originalTexto = boton.textContent;
    boton.disabled = true;
    boton.textContent = "Guardando...";

    const rfc = document.getElementById("input-rfc").value.trim().toUpperCase();
    const alias = document.getElementById("input-alias").value.trim();

    try {
        const resp = await fetch(`${API_URL}/api/clientes`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rfc, alias }),
        });
        if (!resp.ok) {
            mostrarAlerta("error", await interpretarError(resp));
            return;
        }
        cerrarModalNuevoCliente();
        mostrarAlerta("success", "Cliente agregado.");
        await cargarClientes();
    } catch (error) {
        mostrarAlerta("error", await interpretarError(null));
    } finally {
        boton.disabled = false;
        boton.textContent = originalTexto;
    }
}

let rfcEnEdicion = null;

function abrirModalEditar(rfc) {
    if (sinConexion || soloLectura) return;
    const cliente = clientesCache.find(c => c.rfc === rfc);
    if (!cliente) return;

    rfcEnEdicion = rfc;
    document.getElementById("editar-rfc").textContent = rfc;
    document.getElementById("editar-alias").value = cliente.alias;
    document.getElementById("editar-cer").value = "";
    document.getElementById("editar-key").value = "";
    document.getElementById("editar-password").value = "";
    ocultarMensajeEfirma();

    const badge = document.getElementById("editar-estado-efirma");
    const btnOlvidar = document.getElementById("btn-olvidar-efirma");
    if (cliente.efirma_guardada) {
        badge.textContent = "Guardada";
        badge.className = "text-xs font-bold px-2 py-1 rounded-full flex-none bg-violet-100 text-violet-700";
        btnOlvidar.classList.remove("hidden");
        document.getElementById("btn-guardar-efirma").textContent = "Reemplazar e.firma";
    } else {
        badge.textContent = "No guardada";
        badge.className = "text-xs font-bold px-2 py-1 rounded-full flex-none bg-gray-100 text-gray-500";
        btnOlvidar.classList.add("hidden");
        document.getElementById("btn-guardar-efirma").textContent = "Guardar e.firma";
    }

    document.getElementById("modal-editar-cliente").classList.add("modal-active");
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
    if (!alias) { mostrarAlerta("error", "El alias no puede estar vacío."); return; }

    const textoOriginal = boton.textContent;
    boton.disabled = true;
    boton.textContent = "...";
    try {
        const resp = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(rfcEnEdicion)}`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alias }),
        });
        if (!resp.ok) { mostrarAlerta("error", await interpretarError(resp)); return; }
        mostrarAlerta("success", "Alias actualizado.");
        await cargarClientes();
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
    const badge = document.getElementById("editar-estado-efirma");
    badge.textContent = "Guardada";
    badge.className = "text-xs font-bold px-2 py-1 rounded-full flex-none bg-violet-100 text-violet-700";
    document.getElementById("btn-olvidar-efirma").classList.remove("hidden");
    document.getElementById("btn-guardar-efirma").textContent = "Reemplazar e.firma";
}

async function olvidarEfirmaDesdeModal() {
    if (!confirm("¿Olvidar la e.firma guardada de este cliente? Tendrás que subirla de nuevo la próxima vez.")) return;
    try {
        const resp = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(rfcEnEdicion)}/efirma`, {
            method: "DELETE",
            credentials: "include",
        });
        if (!resp.ok) { mostrarMensajeEfirma("error", await interpretarError(resp)); return; }
        mostrarMensajeEfirma("exito", "e.firma eliminada.");
        const badge = document.getElementById("editar-estado-efirma");
        badge.textContent = "No guardada";
        badge.className = "text-xs font-bold px-2 py-1 rounded-full flex-none bg-gray-100 text-gray-500";
        document.getElementById("btn-olvidar-efirma").classList.add("hidden");
        document.getElementById("btn-guardar-efirma").textContent = "Guardar e.firma";
        await cargarClientes();
    } catch (error) {
        mostrarMensajeEfirma("error", "No se pudo conectar con el servidor.");
    }
}

async function olvidarEfirma(rfc) {
    if (!confirm("¿Olvidar la e.firma guardada de este cliente? La próxima vez que generes su constancia, tendrás que subirla de nuevo.")) return;
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
    if (!confirm(`¿Quitar a este cliente de tu directorio? Esto no borra los documentos ya generados, solo lo saca de esta lista.`)) return;
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
