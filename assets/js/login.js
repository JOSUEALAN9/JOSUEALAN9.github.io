/**
 * login.js — Pantalla «Iniciar sesión» (fiscontable.app/login). El botón lleva a API/auth/entrar (detrás de Cloudflare Access): Cloudflare pide
 * el correo y el código, y el servidor regresa a la persona a la página donde estaba (?volver=…).
 * Mensajes según cómo se llegó (motivo): sesion | reconectando | salio | servidor.
 */
(function () {
    "use strict";
    var API = window.Fiscontable.API;
    // El motivo y la página de regreso llegan por dentro (barra.js los deja en esta pestaña); los de la dirección
    // (?motivo=…&volver=…) se siguen aceptando por enlaces viejos, y la dirección se limpia.
    var q = new URLSearchParams(location.search), datos = {};
    try {
        datos = JSON.parse(sessionStorage.getItem("fc-entrar-datos") || "{}") || {};
        sessionStorage.removeItem("fc-entrar-datos");
        if (!(Date.now() - (+datos.en || 0) < 600000)) datos = {};
    } catch (e) { datos = {}; }
    var motivo = datos.motivo || q.get("motivo") || "";
    var volver = datos.volver || q.get("volver") || "";
    if (!volver && document.referrer) volver = document.referrer;       // «Iniciar sesión» desde otra página de la web
    if (location.search && history.replaceState) history.replaceState(null, "", location.pathname);   // queda solo …/login
    // Solo páginas de esta misma web (el servidor también lo revisa), y nunca la propia pantalla de inicio de sesión
    var ruta = "";
    try { var u = new URL(volver, location.href); if (u.origin === location.origin) ruta = u.pathname; } catch (e) { /* inválida */ }
    if (!volver || !ruta || /^\/(login|entrar)(\/|\.html)?$/.test(ruta) || ruta.indexOf("/entrar/") === 0) volver = location.origin + "/";

    var boton = document.getElementById("en-entrar");
    boton.href = API + "/auth/entrar?volver=" + encodeURIComponent(volver);
    boton.addEventListener("click", function () {
        try { sessionStorage.removeItem("fc-entrar"); sessionStorage.setItem("fc-auto-entrar", String(Date.now())); } catch (e) { /* sin almacenamiento */ }
        boton.setAttribute("aria-busy", "true");
        boton.lastChild.textContent = " Abriendo…";
    });

    var MENSAJES = {
        sesion: ["Para continuar, inicia sesión. Te regresamos a donde estabas.", ""],
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
    if (motivo === "sesion" && yaEntro && Date.now() - auto > 60000) {
        try { sessionStorage.setItem("fc-auto-entrar", String(Date.now())); } catch (e) { /* sin almacenamiento */ }
        avisar("reconectando");
        boton.setAttribute("aria-busy", "true");
        setTimeout(function () { location.replace(boton.href); }, 700);
        return;
    }
    avisar(motivo);

    // ¿Responde el servidor? (ruta pública que usan las PCs con el agente: contesta 401 sin token)
    var c = new AbortController();
    setTimeout(function () { c.abort(); }, 7000);
    fetch(API + "/agente/v1/hola", { signal: c.signal, cache: "no-store" })
        .then(function () { if (motivo === "servidor") caja.hidden = true; })
        .catch(function () { avisar("servidor"); });
})();
