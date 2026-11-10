/**
 * login.js — Pantalla «Iniciar sesión» (fiscontable.app/login). Dos modos, según lo que el administrador active
 * (GET /publico/cuenta/modo):
 *   · Cloudflare: el botón lleva a API/auth/entrar (detrás de Cloudflare Access), que pide el correo y el código y
 *     regresa a la persona a la página donde estaba.
 *   · Propio (core/cuentas.py del servidor): correo y contraseña, y siempre un segundo paso: el código de la app o
 *     un código que llega por correo (se salta en un equipo de confianza). También: cambiar una contraseña temporal,
 *     configurar dos pasos (administrador), «olvidé», enlace del correo (#enlace=…) y crear cuenta con licencia
 *     (#licencia, desde la página principal).
 * Mensajes según cómo se llegó (motivo): sesion | reconectando | salio | servidor.
 */
(function () {
    "use strict";
    var F = window.Fiscontable, API = F.API;
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

    var quiereLicencia = location.hash === "#licencia";
    var enlace = "";
    var mEnlace = /[#&]enlace=([A-Za-z0-9_\-]{20,})/.exec(location.hash);
    if (mEnlace) { enlace = mEnlace[1]; history.replaceState(null, "", location.pathname); }   // el enlace no se queda en la barra

    // Pegar el enlace del correo (o #licencia) en una pestaña que ya estaba en /login solo cambia el «#»: se vuelve a cargar
    window.addEventListener("hashchange", function () { if (/[#&]enlace=|^#licencia$/.test(location.hash)) location.reload(); });

    function $(id) { return document.getElementById(id); }
    var caja = $("en-aviso"), titulo = $("en-titulo"), sub = $("en-sub");
    var TITULOS = {
        access: ["Inicia sesión", ""],
        entrar: ["Inicia sesión", ""],
        codigo: ["Verificación en dos pasos", "Escribe el código de 6 dígitos de tu app de autenticación."],
        correo: ["Revisa tu correo", ""],
        cambiar: ["Crea tu contraseña", "Tu contraseña actual es temporal. Elige una nueva para continuar."],
        dospasos: ["Protege tu cuenta", "La cuenta de administrador requiere verificación en dos pasos."],
        olvide: ["Restablecer contraseña", "Escribe tu correo y te enviaremos un enlace para crear una nueva."],
        enlace: ["Crea tu contraseña", ""],
        licencia: ["Crea tu cuenta", "Escribe tu correo y tu clave de licencia. Te enviaremos un enlace para crear tu contraseña."]
    };
    var MENSAJES = {
        sesion: ["Tu sesión terminó. Vuelve a iniciar sesión.", ""],
        reconectando: ["Reconectando…", ""],
        salio: ["Cerraste sesión.", ""],
        servidor: ["El servicio no está disponible en este momento. Intenta de nuevo en unos minutos.", "alerta"]
    };
    function avisarTexto(texto, tipo) {
        caja.textContent = texto || "";
        caja.className = "en-aviso" + (tipo ? " en-aviso--" + tipo : "");
        caja.hidden = !texto;
    }
    function avisar(clave) { var m = MENSAJES[clave]; if (m) avisarTexto(m[0], m[1]); }

    function panel(nombre, t) {
        document.querySelectorAll("[data-panel]").forEach(function (p) { p.hidden = p.dataset.panel !== nombre; });
        var tt = t || TITULOS[nombre] || TITULOS.entrar;
        titulo.textContent = tt[0];
        sub.textContent = tt[1] || "";
        sub.hidden = !tt[1];
        var p = document.querySelector('[data-panel="' + nombre + '"]');
        var primero = p && p.querySelector("input:not([type=checkbox])");
        if (primero && nombre !== "access") setTimeout(function () { primero.focus(); }, 30);
    }

    function irVolver() {
        try { sessionStorage.removeItem("fc-entrar"); localStorage.setItem("fc-ya-entro", "1"); } catch (e) { /* sin almacenamiento */ }
        location.replace(volver);
    }

    // ------------------------------------------------------------------ con Cloudflare
    function modoAccess() {
        panel("access");
        var boton = $("en-entrar");
        boton.href = API + "/auth/entrar?volver=" + encodeURIComponent(volver);
        boton.addEventListener("click", function () {
            try { sessionStorage.removeItem("fc-entrar"); sessionStorage.setItem("fc-auto-entrar", String(Date.now())); } catch (e) { /* sin almacenamiento */ }
            boton.setAttribute("aria-busy", "true");
            boton.lastChild.textContent = " Abriendo…";
        });
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
    }

    // ------------------------------------------------------------------ inicio de sesión propio
    var reto = null, campoCambiar = null, campoEnlace = null;

    async function post(ruta, cuerpo) {
        var r;
        try {
            r = await fetch(API + ruta, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo || {}) });
        } catch (e) { throw new Error("No pudimos conectar con el servidor. Revisa tu internet e intenta de nuevo."); }
        var d = null;
        try { d = await r.json(); } catch (e) { /* sin cuerpo */ }
        if (!r.ok) throw new Error((d && typeof d.detail === "string" && d.detail) || "Algo salió mal (código " + r.status + "). Intenta de nuevo.");
        return d || {};
    }

    function ocupado(forma, si) {
        var b = forma.querySelector("[type=submit]");
        if (!b) return;
        if (si) { b.dataset.texto = b.textContent; b.textContent = "Un momento…"; b.disabled = true; }
        else { b.textContent = b.dataset.texto || b.textContent; b.disabled = false; }
    }

    function siguiente(r) {
        if (r.paso === "listo") return irVolver();
        reto = r.reto;
        avisarTexto("");
        if (r.paso === "codigo") panel("codigo");
        else if (r.paso === "correo") {
            panel("correo", ["Revisa tu correo", "Enviamos un código de 6 dígitos a " + (r.correo_visible || "tu correo") + ". Vence en 10 minutos."]);
            esperarReenvio();
        }
        else if (r.paso === "cambiar") { panel("cambiar"); campoCambiar = F.campoClave($("en-clave-cambiar"), { confirmar: true, oscuro: true }); campoCambiar.entrada.focus(); }
        else if (r.paso === "configurar_2fa") {
            panel("dospasos");
            F.dosPasos($("en-dospasos"), { oscuro: true,
                preparar: function () { return post("/publico/cuenta/2fa/preparar", { reto: reto }); },
                activar: function (c) { return post("/publico/cuenta/2fa/activar", { reto: reto, codigo: c }); },
                alTerminar: irVolver });
        }
    }

    // «Enviar otro código»: una vez por minuto (el servidor también lo cuida)
    var relojReenvio = null;
    function esperarReenvio() {
        var b = $("en-reenviar"), quedan = 60;
        clearInterval(relojReenvio);
        b.disabled = true;
        (function pintar() { b.textContent = quedan > 0 ? "Enviar otro código (" + quedan + " s)" : "Enviar otro código"; b.disabled = quedan > 0; })();
        relojReenvio = setInterval(function () {
            quedan--;
            b.textContent = quedan > 0 ? "Enviar otro código (" + quedan + " s)" : "Enviar otro código";
            b.disabled = quedan > 0;
            if (quedan <= 0) clearInterval(relojReenvio);
        }, 1000);
    }

    function alFallarReto(er) {
        // El paso intermedio venció: de vuelta al correo y la contraseña
        if (/Pasó mucho tiempo|Demasiados intentos/.test(er.message)) { panel("entrar"); avisarTexto(er.message, "alerta"); return true; }
        return false;
    }

    function prepararPropio() {
        var formas = {};
        document.querySelectorAll("form[data-panel]").forEach(function (f) { formas[f.dataset.panel] = f; });
        document.querySelectorAll("[data-ir]").forEach(function (b) {
            b.addEventListener("click", function () { avisarTexto(""); panel(b.dataset.ir); });
        });
        document.querySelectorAll("[data-ver]").forEach(function (b) {
            b.addEventListener("click", function () {
                var i = b.parentNode.querySelector("input");
                i.type = i.type === "password" ? "text" : "password";
                b.textContent = i.type === "password" ? "Ver" : "Ocultar";
            });
        });
        formas.entrar.addEventListener("submit", async function (e) {
            e.preventDefault();
            var f = this, correo = f.correo.value.trim(), clave = f.clave.value;
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) { f.correo.focus(); return avisarTexto("Escribe tu correo.", "alerta"); }
            if (!clave) { f.clave.focus(); return avisarTexto("Escribe tu contraseña.", "alerta"); }
            ocupado(f, true);
            try { siguiente(await post("/publico/cuenta/entrar", { correo: correo, clave: clave, recordar: f.recordar.checked })); }
            catch (er) { avisarTexto(er.message, "alerta"); f.clave.select(); }
            finally { ocupado(f, false); }
        });
        formas.codigo.addEventListener("submit", async function (e) {
            e.preventDefault();
            var f = this, codigo = f.codigo.value.trim();
            if (!/^\d{6}$|^\d{4}-?\d{4}$/.test(codigo)) return avisarTexto("Escribe los 6 dígitos de tu app o un código de respaldo.", "alerta");
            ocupado(f, true);
            try { siguiente(await post("/publico/cuenta/codigo", { reto: reto, codigo: codigo })); }
            catch (er) { if (!alFallarReto(er)) { avisarTexto(er.message, "alerta"); f.codigo.select(); } }
            finally { ocupado(f, false); }
        });
        formas.correo.addEventListener("submit", async function (e) {
            e.preventDefault();
            var f = this, codigo = f.codigo.value.replace(/\D/g, "");
            if (codigo.length !== 6) return avisarTexto("Escribe los 6 dígitos del código que te enviamos.", "alerta");
            ocupado(f, true);
            try { siguiente(await post("/publico/cuenta/correo", { reto: reto, codigo: codigo })); }
            catch (er) { if (!alFallarReto(er)) { avisarTexto(er.message, "alerta"); f.codigo.select(); } }
            finally { ocupado(f, false); }
        });
        $("en-reenviar").addEventListener("click", async function () {
            var b = this;
            b.disabled = true;
            try { var r = await post("/publico/cuenta/correo/reenviar", { reto: reto }); avisarTexto(r.mensaje, ""); formas.correo.codigo.value = ""; formas.correo.codigo.focus(); esperarReenvio(); }
            catch (er) { if (!alFallarReto(er)) { avisarTexto(er.message, "alerta"); b.disabled = false; } }
        });
        formas.cambiar.addEventListener("submit", async function (e) {
            e.preventDefault();
            var falta = campoCambiar && campoCambiar.revisar();
            if (falta) return avisarTexto(falta, "alerta");
            ocupado(this, true);
            try { siguiente(await post("/publico/cuenta/cambiar", { reto: reto, nueva: campoCambiar.valor() })); }
            catch (er) { if (!alFallarReto(er)) avisarTexto(er.message, "alerta"); }
            finally { ocupado(this, false); }
        });
        formas.olvide.addEventListener("submit", async function (e) {
            e.preventDefault();
            var f = this, correo = f.correo.value.trim();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) { f.correo.focus(); return avisarTexto("Escribe tu correo.", "alerta"); }
            ocupado(f, true);
            try { var r = await post("/publico/cuenta/olvide", { correo: correo }); avisarTexto(r.mensaje, ""); f.reset(); }
            catch (er) { avisarTexto(er.message, "alerta"); }
            finally { ocupado(f, false); }
        });
        formas.licencia.clave.addEventListener("input", function () {
            var v = this.value.toUpperCase().replace(/[^0-9A-Z]/g, "");
            if (v.indexOf("FSC") === 0) v = v.slice(3);
            v = v.slice(0, 16);
            this.value = v ? "FSC-" + (v.match(/.{1,4}/g) || []).join("-") : "";
        });
        formas.licencia.addEventListener("submit", async function (e) {
            e.preventDefault();
            var f = this, correo = f.correo.value.trim(), clave = f.clave.value.trim();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) { f.correo.focus(); return avisarTexto("Escribe tu correo.", "alerta"); }
            if (clave.replace(/[^0-9A-Z]/gi, "").length < 19) { f.clave.focus(); return avisarTexto("La clave tiene la forma FSC-XXXX-XXXX-XXXX-XXXX.", "alerta"); }
            ocupado(f, true);
            try { var r = await post("/publico/cuenta/licencia", { correo: correo, clave: clave }); avisarTexto(r.mensaje, ""); f.reset(); }
            catch (er) { avisarTexto(er.message, "alerta"); }
            finally { ocupado(f, false); }
        });
        formas.enlace.addEventListener("submit", async function (e) {
            e.preventDefault();
            var falta = campoEnlace && campoEnlace.revisar();
            if (falta) return avisarTexto(falta, "alerta");
            ocupado(this, true);
            try {
                var r = await post("/publico/cuenta/enlace", { t: enlace, clave: campoEnlace.valor() });
                if (r.licencia_error) avisarTexto("Tu contraseña quedó lista, pero la licencia no se activó: " + r.licencia_error, "alerta");
                if (r.paso === "listo" && r.licencia_error) { setTimeout(function () { siguiente(r); }, 3500); return; }
                siguiente(r);
            } catch (er) { avisarTexto(er.message, "alerta"); }
            finally { ocupado(this, false); }
        });
    }

    async function abrirEnlace() {
        prepararPropio();
        try {
            var e = await post("/publico/cuenta/enlace/ver", { t: enlace });
            var t = e.tipo === "restablecer" ? ["Restablecer contraseña", "Elige una contraseña nueva para " + e.correo_visible + "."]
                : [(e.nombre ? "Hola, " + e.nombre : "Crea tu contraseña"), "Crea la contraseña con la que entrarás a Fiscontable (" + e.correo_visible + ")."];
            panel("enlace", t);
            campoEnlace = F.campoClave($("en-clave-enlace"), { confirmar: true, oscuro: true });
            campoEnlace.entrada.focus();
        } catch (er) {
            panel("entrar");
            avisarTexto(er.message, "alerta");
        }
    }

    // ¿Cloudflare o propio? Lo decide el administrador. Si no se puede saber, se queda como siempre (Cloudflare).
    var cm = new AbortController();
    setTimeout(function () { cm.abort(); }, 6000);
    fetch(API + "/publico/cuenta/modo", { cache: "no-store", signal: cm.signal })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (m) {
            if (enlace) return abrirEnlace();
            if (m && m.propio) {
                prepararPropio();
                panel(quiereLicencia ? "licencia" : "entrar");
                if (MENSAJES[motivo] && motivo !== "reconectando") avisar(motivo);
                return;
            }
            modoAccess();
        });
})();
