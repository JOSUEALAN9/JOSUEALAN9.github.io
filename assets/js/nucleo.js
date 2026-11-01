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

    var VERSION = "202611012100";
    var API = "https://api.josuealan.com";

    function escapar(valor) {
        return String(valor == null ? "" : valor)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    async function leerError(resp) {
        if (!resp) return "No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.";
        var d = null;
        try { d = await resp.json(); } catch (e) { /* sin cuerpo JSON */ }
        var detalle = d && typeof d.detail === "string" ? d.detail : "";
        // 401/403 del inicio de sesión (Access) = sesión vencida; otros 403 traen su motivo (plan, sesión cerrada…)
        if (resp.status === 401 || (resp.status === 403 && (!detalle || /token de (cloudflare )?access|access no trae/i.test(detalle))))
            return "Tu sesión expiró. Recarga la página para entrar otra vez.";
        if (detalle) return detalle;
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

    /* Lo que hizo el agente (la PC del contador) ya quedó guardado en esa PC: no se vuelve a bajar solo.
       Se dice dónde quedó y un botón le pide a esa PC que abra la carpeta (Mostrar en mi PC). */
    function carpetaEnPc(ruta) {
        var r = String(ruta || "").replace(/\//g, "\\");
        var i = Math.max(r.lastIndexOf("\\"), 0);
        var carpeta = i ? r.slice(0, i) : r;
        var m = carpeta.match(/(Documents|Documentos)\\.*/i);
        return m ? m[0] : carpeta;
    }

    function textoEnPc(enPc) {
        if (!enPc || !enPc.rutas || !enPc.rutas.length) return "";
        var n = enPc.rutas.length;
        return "Quedó guardado en tu PC «" + (enPc.pc || "PC") + "»: " + carpetaEnPc(enPc.rutas[0]) +
            (n > 1 ? " (" + n + " archivos)" : "");
    }

    async function mostrarEnPc(enPc, boton) {
        if (boton) { boton.disabled = true; boton.textContent = "Avisando a tu PC…"; }
        try {
            var r = await fetch(API + "/api/agentes/" + enPc.agente_id + "/abrir", {
                method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ruta: enPc.rutas[0] })
            });
            if (!r.ok) throw new Error(await leerError(r));
            if (boton) boton.textContent = "✓ Se abrirá en «" + (enPc.pc || "tu PC") + "»";
        } catch (e) {
            if (boton) { boton.textContent = "No se pudo: " + e.message; }
        }
        if (boton) setTimeout(function () { boton.disabled = false; boton.textContent = "Mostrar en mi PC"; }, 5000);
    }

    function cajaEnPc(enPc, alDescargar) {
        var caja = document.createElement("div");
        caja.className = "fc-en-pc";
        caja.style.cssText = "margin-top:10px;padding:11px 13px;border:1px solid #BBE5D2;background:#F0FBF6;border-radius:10px;" +
            "font-size:13px;color:#065F46;display:flex;flex-wrap:wrap;gap:8px;align-items:center";
        var t = document.createElement("span");
        t.textContent = textoEnPc(enPc);
        t.style.flex = "1 1 260px";
        caja.appendChild(t);
        var b = document.createElement("button");
        b.type = "button"; b.className = "fc-btn"; b.textContent = "Mostrar en mi PC";
        b.addEventListener("click", function () { mostrarEnPc(enPc, b); });
        caja.appendChild(b);
        if (alDescargar) {
            var d = document.createElement("button");
            d.type = "button"; d.className = "fc-btn fc-btn--discreto"; d.textContent = "Descargar aquí";
            d.addEventListener("click", function () { alDescargar(d); });
            caja.appendChild(d);
        }
        return caja;
    }

    console.info("Fiscontable — interfaz " + VERSION);

    window.Fiscontable = Object.assign(window.Fiscontable || {}, {
        API: API,
        VERSION: VERSION,
        escapar: escapar,
        leerError: leerError,
        guardarArchivo: guardarArchivo,
        textoEnPc: textoEnPc,
        mostrarEnPc: mostrarEnPc,
        cajaEnPc: cajaEnPc
    });
})();
