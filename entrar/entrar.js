/**
 * entrar.js — Pantalla de entrada. «Entrar» lleva a API/auth/entrar (detrás de Cloudflare Access): Cloudflare pide
 * el correo y el código, y el servidor regresa a la persona a la página donde estaba (?volver=…).
 * Mensajes según cómo se llegó: ?motivo=sesion | salio | servidor.
 */
(function () {
    "use strict";
    var API = window.Fiscontable.API;
    var q = new URLSearchParams(location.search);
    var volver = q.get("volver") || "";
    // Solo páginas de esta misma web (el servidor también lo revisa)
    try { if (new URL(volver, location.href).origin !== location.origin) volver = ""; } catch (e) { volver = ""; }
    if (!volver || /\/entrar\//.test(volver)) volver = location.origin + "/";

    var boton = document.getElementById("en-entrar");
    boton.href = API + "/auth/entrar?volver=" + encodeURIComponent(volver);
    boton.addEventListener("click", function () {
        try { sessionStorage.removeItem("fc-entrar"); sessionStorage.setItem("fc-auto-entrar", String(Date.now())); } catch (e) { /* sin almacenamiento */ }
        boton.setAttribute("aria-busy", "true");
        boton.lastChild.textContent = " Abriendo…";
    });

    var MENSAJES = {
        sesion: ["Para continuar, entra con tu cuenta. Te regresamos a donde estabas.", ""],
        reconectando: ["Reconectando tu sesión…", ""],
        salio: ["Cerraste sesión. ¡Hasta pronto!", ""],
        servidor: ["El servidor no responde en este momento. Intenta en unos minutos.", "alerta"]
    };
    var caja = document.getElementById("en-aviso");
    function avisar(clave) {
        var m = MENSAJES[clave];
        if (!m) return;
        caja.textContent = m[0];
        caja.className = "en-aviso" + (m[1] ? " en-aviso--" + m[1] : "");
        caja.hidden = false;
    }
    // Si en este navegador ya se había entrado antes, no se pide el clic: se sigue solo (Cloudflare reconoce la sesión
    // o pide el código). Una vez por minuto como máximo, para no dar vueltas.
    var yaEntro = false, auto = 0;
    try { yaEntro = localStorage.getItem("fc-ya-entro") === "1"; auto = +sessionStorage.getItem("fc-auto-entrar") || 0; } catch (e) { /* sin almacenamiento */ }
    if (q.get("motivo") === "sesion" && yaEntro && Date.now() - auto > 60000) {
        try { sessionStorage.setItem("fc-auto-entrar", String(Date.now())); } catch (e) { /* sin almacenamiento */ }
        avisar("reconectando");
        boton.setAttribute("aria-busy", "true");
        setTimeout(function () { location.replace(boton.href); }, 700);
        return;
    }
    avisar(q.get("motivo"));

    // ¿Responde el servidor? (ruta pública que usan las PCs con el agente: contesta 401 sin token)
    var c = new AbortController();
    setTimeout(function () { c.abort(); }, 7000);
    fetch(API + "/agente/v1/hola", { signal: c.signal, cache: "no-store" })
        .then(function () { if (q.get("motivo") === "servidor") caja.hidden = true; })
        .catch(function () { avisar("servidor"); });
})();
