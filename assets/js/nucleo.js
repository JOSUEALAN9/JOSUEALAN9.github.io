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

    var VERSION = "202609251331";
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

    console.info("Fiscontable — interfaz " + VERSION);

    window.Fiscontable = Object.assign(window.Fiscontable || {}, {
        API: API,
        VERSION: VERSION,
        escapar: escapar,
        leerError: leerError
    });
})();
