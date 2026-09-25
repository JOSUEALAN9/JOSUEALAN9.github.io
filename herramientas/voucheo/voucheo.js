/**
 * voucheo.js — código de herramientas/voucheo/ (antes vivía dentro del HTML).
 */
const API_URL = Fiscontable.API;          // la dirección vive solo en assets/js/nucleo.js
const esc = Fiscontable.escapar;          // todo texto del servidor pasa por aquí antes de ir al HTML

document.addEventListener("DOMContentLoaded", async () => {
    await verificarPermisos();
});

function bloquearModulo(mensaje) {
    document.querySelectorAll("#form-nuevo, #form-actualizar, #selector-impuesto").forEach(el => el.classList.add("hidden"));
    document.getElementById("tabs-container")?.classList.add("hidden");
    document.getElementById("panel-bloqueo-texto").textContent = mensaje;
    document.getElementById("panel-bloqueo").classList.remove("hidden");
    document.getElementById("panel-bloqueo").classList.add("flex");
}

async function verificarPermisos() {
    try {
        const resp = await fetch(`${API_URL}/api/mi-perfil`, { credentials: "include" });

        if (resp.status === 401 || resp.status === 403) {
            bloquearModulo("Tu sesión expiró. Recarga la página para iniciar sesión de nuevo.");
            return false;
        }
        if (!resp.ok) {
            bloquearModulo("No pudimos conectar con el servidor. Intenta de nuevo más tarde.");
            return false;
        }

        const perfil = await resp.json();

        if (perfil.solo_lectura) {
            bloquearModulo("Tu acceso venció. No puedes generar documentos hasta que se renueve.");
            return false;
        }
        // AQUÍ VALIDAMOS EL MÓDULO VOUCHEO
        if (!(perfil.modulos_permitidos || []).includes("voucheo")) {
            bloquearModulo("Tu plan actual no incluye el módulo de Voucheo. Contacta al administrador si necesitas acceso.");
            return false;
        }
        return true;
    } catch (error) {
        bloquearModulo("No pudimos conectar con el servidor. Verifica tu conexión.");
        return false;
    }
}

function switchTab(modo) {
    const isNuevo = modo === 'nuevo';

    // Estilos de pestañas
    document.getElementById('tab-nuevo').className = isNuevo 
        ? "flex-1 py-4 text-sm font-bold text-amber-700 border-b-2 border-amber-600 transition flex justify-center items-center gap-2 bg-white" 
        : "flex-1 py-4 text-sm font-semibold text-slate-500 border-b-2 border-transparent hover:text-slate-700 transition flex justify-center items-center gap-2";

    document.getElementById('tab-actualizar').className = !isNuevo 
        ? "flex-1 py-4 text-sm font-bold text-amber-700 border-b-2 border-amber-600 transition flex justify-center items-center gap-2 bg-white" 
        : "flex-1 py-4 text-sm font-semibold text-slate-500 border-b-2 border-transparent hover:text-slate-700 transition flex justify-center items-center gap-2";

    // Mostrar/Ocultar formularios
    document.getElementById('form-nuevo').classList.toggle('hidden', !isNuevo);
    document.getElementById('form-nuevo').classList.toggle('flex', isNuevo);

    document.getElementById('form-actualizar').classList.toggle('hidden', isNuevo);
    document.getElementById('form-actualizar').classList.toggle('flex', !isNuevo);

    ocultarAlerta();
    ocultarResultado();
}

function limpiarFormularios() {
    document.getElementById('form-nuevo').reset();
    document.getElementById('form-actualizar').reset();
    ocultarAlerta();
    ocultarResultado();
}

function ocultarResultado() {
    document.getElementById('panel-resultado').classList.add('hidden');
    document.getElementById('panel-resultado').classList.remove('flex');
}

function mostrarAlerta(tipo, mensaje) {
    const container = document.getElementById('alert-container');
    const alertBox = document.getElementById('alert-message');
    container.classList.remove('hidden');

    if(tipo === 'error') {
        alertBox.className = "p-4 rounded-lg text-sm font-semibold flex items-start gap-2 bg-amber-50 text-amber-800 border border-amber-200";
        alertBox.innerHTML = `<svg class="w-5 h-5 flex-none mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> <span>${esc(mensaje)}</span>`;
    } else {
        alertBox.className = "p-4 rounded-lg text-sm font-semibold flex items-start gap-2 bg-green-50 text-green-700 border border-green-200";
        alertBox.innerHTML = `<svg class="w-5 h-5 flex-none mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> <span>${esc(mensaje)}</span>`;
    }
}

function ocultarAlerta() { document.getElementById('alert-container').classList.add('hidden'); }

function toggleLoadingState(btnId, isLoading, originalHTML) {
    const btn = document.getElementById(btnId);
    if (isLoading) {
        btn.disabled = true;
        btn.innerHTML = `<svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Procesando acuses...`;
    } else {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

async function interpretarError(response) {
    if (!response) return "No pudimos conectar con el servidor. Verifica tu conexión a internet.";
    if (response.status === 401 || response.status === 403) return "Tu sesión expiró o no tienes permiso para este módulo.";
    try {
        const data = await response.json();
        // El detail puede ser un texto simple, o un objeto
        // {mensaje, omitidos} cuando NINGÚN acuse se pudo procesar.
        if (data.detail && typeof data.detail === "object") {
            let texto = data.detail.mensaje || "No se pudo procesar ningún acuse.";
            if (Array.isArray(data.detail.omitidos) && data.detail.omitidos.length) {
                texto += " " + data.detail.omitidos.map(o => `${o.archivo}: ${o.motivo}`).join(" · ");
            }
            return texto;
        }
        return data.detail || "Error interno del servidor.";
    } catch {
        return `Error HTTP ${response.status}. Intenta de nuevo.`;
    }
}

function mostrarResultado(nombreArchivo, historialId, reporte) {
    document.getElementById('resultado-nombre-archivo').textContent = nombreArchivo;
    document.getElementById('btn-descargar-resultado').href =
        `${API_URL}/api/voucheo/historial/${historialId}/descargar`;

    const procesados = reporte.procesados || [];
    const omitidos = reporte.omitidos || [];

    const wrapProcesados = document.getElementById('resultado-procesados-wrap');
    const listaProcesados = document.getElementById('resultado-procesados-lista');
    listaProcesados.innerHTML = "";
    if (procesados.length) {
        document.getElementById('resultado-procesados-count').textContent = procesados.length;
        procesados.forEach(p => {
            const li = document.createElement('li');
            li.className = "border-l-2 border-green-400 pl-2";
            let linea = `<strong>${esc(p.mes)}</strong> (${esc(p.hoja || String(p.tipo || '').replace(/_/g, ' '))}) — ${esc(p.archivo)}`;
            if (p.aviso) linea += `<br><span class="text-slate-500">${esc(p.aviso)}</span>`;
            if (p.aviso_diferencia) linea += `<br><span class="text-amber-700">⚠️ ${esc(p.aviso_diferencia)}</span>`;
            li.innerHTML = linea;
            listaProcesados.appendChild(li);
        });
        wrapProcesados.classList.remove('hidden');
    } else {
        wrapProcesados.classList.add('hidden');
    }

    const wrapOmitidos = document.getElementById('resultado-omitidos-wrap');
    const listaOmitidos = document.getElementById('resultado-omitidos-lista');
    listaOmitidos.innerHTML = "";
    if (omitidos.length) {
        document.getElementById('resultado-omitidos-count').textContent = omitidos.length;
        omitidos.forEach(o => {
            const li = document.createElement('li');
            li.className = "border-l-2 border-amber-400 pl-2";
            li.innerHTML = `<strong>${esc(o.archivo)}</strong><br><span>${esc(o.motivo)}</span>`;
            listaOmitidos.appendChild(li);
        });
        wrapOmitidos.classList.remove('hidden');
    } else {
        wrapOmitidos.classList.add('hidden');
    }

    document.getElementById('panel-resultado').classList.remove('hidden');
    document.getElementById('panel-resultado').classList.add('flex');
}

async function procesarVoucheo(e, modo) {
    e.preventDefault();
    ocultarAlerta();
    ocultarResultado();

    const btnId = modo === 'nuevo' ? 'btn-nuevo' : 'btn-actualizar';
    const boton = document.getElementById(btnId);
    const originalHTML = boton.innerHTML;

    const tipoImpuesto = document.querySelector('input[name="tipo_impuesto"]:checked').value;
    const inputPdfs = document.getElementById(modo === 'nuevo' ? 'pdf_nuevo' : 'pdf_actualizar').files;
    const inputExcel = modo === 'actualizar' ? document.getElementById('excel_actualizar').files[0] : null;

    if (inputPdfs.length === 0) {
        mostrarAlerta('error', 'Debes seleccionar al menos un acuse en formato PDF.');
        return;
    }

    toggleLoadingState(btnId, true, originalHTML);

    const formData = new FormData();
    formData.append("modo", modo);
    formData.append("impuesto_seleccionado", tipoImpuesto);

    for (let i = 0; i < inputPdfs.length; i++) {
        formData.append("acuses_pdf", inputPdfs[i]);
    }
    if (inputExcel) {
        formData.append("archivo_excel", inputExcel);
    }

    try {
        const response = await fetch(`${API_URL}/api/voucheo/generar`, {
            method: "POST",
            credentials: "include",
            body: formData
        });

        if (!response.ok) {
            mostrarAlerta('error', await interpretarError(response));
            toggleLoadingState(btnId, false, originalHTML);
            return;
        }

        const data = await response.json();
        mostrarResultado(data.nombre_archivo, data.historial_id, data.reporte || {});

        const omitidosN = (data.reporte && data.reporte.omitidos) ? data.reporte.omitidos.length : 0;
        if (omitidosN > 0) {
            mostrarAlerta('error', `Papel de trabajo generado, pero ${omitidosN} archivo(s) no se cargaron. Revisa el detalle abajo.`);
        } else {
            mostrarAlerta('success', '¡Papel de trabajo generado con éxito!');
        }

    } catch (error) {
        mostrarAlerta('error', await interpretarError(null));
    } finally {
        toggleLoadingState(btnId, false, originalHTML);
    }
}
