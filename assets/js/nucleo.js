/**
 * nucleo.js — lo que todas las páginas de Fiscontable comparten, en un
 * solo lugar. Se carga ANTES que cualquier otro script del portal.
 *
 *   Fiscontable.API        dirección del backend (el único lugar donde vive)
 *   Fiscontable.VERSION    versión de la interfaz (la cambia publicar.sh)
 *   Fiscontable.escapar(t) texto seguro para meter en HTML
 *   Fiscontable.leerError(resp) -> Promise<mensaje>  errores del servidor
 *                                   en lenguaje de contador
 *
 * barra.js agrega después lo de la barra superior (perfil, permisos,
 * panel de descargas) sobre este mismo objeto.
 */
(function () {
    "use strict";

    var VERSION = "202610070130";
    var API = "https://api.josuealan.com";

    function escapar(valor) {
        return String(valor == null ? "" : valor)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    async function leerError(resp) {
        if (!resp) return "No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.";
        if (resp.status === 401 || resp.status === 403) return "Tu sesión expiró. Recarga la página para entrar otra vez.";
        try {
            var d = await resp.json();
            if (typeof d.detail === "string" && d.detail) return d.detail;
        } catch (e) { /* sin cuerpo JSON */ }
        if (resp.status >= 500) return "Error inesperado en el servidor. Intenta en unos minutos.";
        return "Hubo un problema al procesar la solicitud (código " + resp.status + ").";
    }

    /* Guarda un archivo que llegó del servidor. Como la descarga empieza segundos después del clic (cuando el
       servidor termina), a veces el navegador ya no la toma como pedida por la persona y no la inicia, sin avisar.
       Por eso, además, queda un aviso con el enlace: un clic directo ahí siempre descarga. */
    function guardarArchivo(blob, nombre) {
        nombre = nombre || "archivo";
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url; a.download = nombre;
        document.body.appendChild(a); a.click(); a.remove();
        var previa = document.getElementById("fc-descarga-lista");
        if (previa) previa.remove();
        var caja = document.createElement("div");
        caja.id = "fc-descarga-lista";
        caja.setAttribute("role", "status");
        caja.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:9999;max-width:calc(100vw - 32px);display:flex;gap:10px;align-items:center;" +
            "background:#0f172a;color:#e2e8f0;border-radius:12px;padding:10px 12px 10px 14px;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 10px 30px rgba(15,23,42,.35)";
        var texto = document.createElement("span");
        texto.textContent = "¿No empezó la descarga?";
        var enlace = document.createElement("a");
        enlace.href = url; enlace.download = nombre;
        enlace.textContent = "Descargar " + nombre;
        enlace.style.cssText = "color:#5eead4;text-decoration:underline;overflow-wrap:anywhere";
        var cerrar = document.createElement("button");
        cerrar.type = "button"; cerrar.textContent = "×"; cerrar.setAttribute("aria-label", "Cerrar");
        cerrar.style.cssText = "background:none;border:0;color:#94a3b8;font-size:18px;line-height:1;cursor:pointer;padding:0 2px";
        cerrar.addEventListener("click", function () { caja.remove(); });
        enlace.addEventListener("click", function () { setTimeout(function () { caja.remove(); }, 400); });
        caja.appendChild(texto); caja.appendChild(enlace); caja.appendChild(cerrar);
        document.body.appendChild(caja);
        setTimeout(function () { caja.remove(); }, 60000);
        setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
    }

    console.info("Fiscontable — interfaz " + VERSION);

    window.Fiscontable = Object.assign(window.Fiscontable || {}, {
        API: API,
        VERSION: VERSION,
        escapar: escapar,
        leerError: leerError,
        guardarArchivo: guardarArchivo
    });
})();
