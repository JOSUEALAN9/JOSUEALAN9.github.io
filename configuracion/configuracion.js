/*
 * configuracion/configuracion.js — Configuración general de Fiscontable (al estilo de la de Chrome).
 *
 * Un menú a la izquierda (con buscador) y una sección a la derecha. Las secciones de un módulo con su propia pantalla
 * de configuración la abren dentro (Facturar, Administración); las demás se pintan aquí. Cada módulo puede abrir su
 * sección directo con Fiscontable.abrirConfiguracion("seccion"): en ese modo (?incrustado=1&seccion=…) la página
 * muestra solo esa sección y «Listo» cierra la ventana para quedarse en el módulo.
 * Lo de Administración solo aparece para el admin; lo de cada módulo, solo si la cuenta lo tiene.
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var incrustado = Fiscontable.url("incrustado") === "1";
    var perfil = null;

    async function api(ruta, opciones) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.status === 204 ? null : r.json();
    }
    function enviar(ruta, metodo, cuerpo) {
        return api(ruta, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    }

    var ICO = {
        persona: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",
        creditos: "M12 8c-2.2 0-4 .9-4 2s1.8 2 4 2 4 .9 4 2-1.8 2-4 2m0-8V6m0 10v2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
        pc: "M4 5h16v10H4zM2 19h20M9 15v4M15 15v4",
        factura: "M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9zM14 3v6h6M9 13h6M9 17h4",
        buzon: "M4 6h16v12H4zM4 7l8 6 8-6",
        xml: "M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12",
        admin: "M12 3l8 4v5c0 5-3.4 8.5-8 9-4.6-.5-8-4-8-9V7z",
        sistema: "M4 6h16M4 12h16M4 18h10",
        balanza: "M12 3v18M5 7h14M5 7l-3 7a4 4 0 006 0zM19 7l-3 7a4 4 0 006 0zM8 21h8",
        modulos: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
        campana: "M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 00-4-5.7V5a2 2 0 10-4 0v.3A6 6 0 006 11v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
        reloj: "M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
        candado: "M6 11h12v9H6zM8 11V8a4 4 0 018 0v3M12 15v2",
        equipo: "M17 20h5v-2a3 3 0 00-5.4-1.8M17 20H7m10 0v-2c0-.7-.1-1.3-.4-1.8M7 20H2v-2a3 3 0 015.4-1.8M7 20v-2c0-.7.1-1.3.4-1.8m0 0a5 5 0 019.2 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
    };
    function ico(d) { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>'; }

    /* Las secciones: {id, grupo, titulo, desc, palabras, ver(perfil), pintar(caja)} */
    var SECCIONES = [
        { id: "perfil", grupo: "Tu cuenta", titulo: "Mi perfil", ico: ICO.persona, desc: "Tu foto, tu nombre, tu teléfono y cómo se ven las tablas.",
          palabras: "nombre teléfono correo cuenta foto imagen densidad tablas compacta preferencias", pintar: pintarPerfil },
        { id: "seguridad", grupo: "Tu cuenta", titulo: "Seguridad", ico: ICO.candado, desc: "Tu contraseña, la verificación en dos pasos, las sesiones abiertas y el bloqueo por inactividad.",
          palabras: "seguridad contraseña clave dos pasos verificación código autenticación sesiones abiertas equipos de confianza pin bloqueo inactividad",
          pintar: function (c) { pintarSeguridad(c); pintarBloqueo(c); } },
        { id: "plan", grupo: "Tu cuenta", titulo: "Plan y créditos", ico: ICO.creditos, desc: "Tu plan, su vigencia y tus créditos.", palabras: "plan créditos recargar vigencia pago",
          pintar: pintarPlan },
        { id: "avisos", grupo: "Tu cuenta", titulo: "Avisos", ico: ICO.campana, desc: "Qué avisos te llegan también por correo, a qué dirección, y el resumen de tu cartera.",
          palabras: "avisos correo notificaciones campana actividad email resumen semanal diario lunes cartera", pintar: pintarAvisos },
        { id: "programaciones", grupo: "Tu cuenta", titulo: "Programaciones", ico: ICO.reloj, desc: "Todo lo que se ejecuta automáticamente: qué, de qué empresa, cada cuánto y cuándo toca.",
          palabras: "programar programaciones automático madrugada constancia opinión declaraciones xml buzón validación listas", pintar: pintarProgramaciones },
        { id: "despacho", grupo: "Tu cuenta", titulo: "Mi despacho", ico: ICO.equipo, solo_despacho: true,
          desc: "Tu equipo, sus permisos, las solicitudes y quién hizo qué.", palabras: "despacho equipo miembros permisos titular solicitudes bitácora espacio invitar",
          ir: "/despacho/" },
        // Una sola página para el Agente: este apartado abre /agente/ directo
        { id: "agente", grupo: "Tu cuenta", titulo: "Conectar esta PC", ico: ICO.pc, desc: "Fiscontable Agente en tu computadora con Windows.", palabras: "agente pc windows conectar contador",
          ir: "/agente/" },
        { id: "facturacion", grupo: "Módulos", titulo: "Facturar", ico: ICO.factura, modulo: "facturacion",
          desc: "Emisor, series y folios, sello digital, logo del PDF, correo a clientes y timbres.",
          palabras: "facturar cfdi timbres serie folio csd sello logo pdf correo smtp gmail régimen código postal multifacturas",
          marco: function (sub) { return "/herramientas/facturar/?vista=config&incrustado=1&dentro=1" + (sub ? "&sub=" + encodeURIComponent(sub) : ""); } },
        { id: "buzon", grupo: "Módulos", titulo: "Buzón tributario", ico: ICO.buzon, modulo: "buzon",
          desc: "Cada cuánto se revisan solos los buzones de tus empresas.", palabras: "buzón tributario notificaciones revisión automática frecuencia",
          pintar: pintarBuzon },
        { id: "descarga_xml", grupo: "Módulos", titulo: "XML automáticos", ico: ICO.xml, modulo: "descarga_xml",
          desc: "Qué empresas descargan automáticamente sus XML del SAT, desde qué mes y cada cuánto.", palabras: "descarga masiva automática de xml sat madrugada bajar solos",
          pintar: pintarXmlAuto },
        { id: "impuestos", grupo: "Módulos", titulo: "Impuestos por empresa", ico: ICO.balanza, modulo: "marcas",
          desc: "Cuándo cuenta cada impuesto (flujo o devengado), estatales, alcohol y las reglas que Fiscontable aprendió de cada empresa.",
          palabras: "impuestos reglas fiscales isr iva diot deducible no deducible flujo devengado cobrado facturado profesiones alcohol régimen paquete marcas",
          pintar: pintarImpuestos },
        { id: "admin", grupo: "Administración", titulo: "Panel de administración", ico: ICO.admin, solo_admin: true,
          desc: "Usuarios, permisos por rol, actividad, créditos, documentos y sistema.", palabras: "usuarios permisos roles actividad créditos documentos sistema servidor respaldo trabajadores timbres bolsa",
          marco: function (sub) { return "/admin/?incrustado=1&dentro=1" + (sub ? "#" + sub : ""); } }
    ];

    function visibles() {
        var mods = (perfil && perfil.modulos_permitidos) || [];
        return SECCIONES.filter(function (s) {
            if (s.solo_admin) return perfil && perfil.rol === "admin";
            if (s.solo_despacho) return !!(perfil && perfil.despacho && perfil.despacho.id);
            return !s.modulo || mods.indexOf(s.modulo) !== -1;
        });
    }

    // El menú es la misma pieza que la barra de módulos (Fiscontable.riel): plegar, grupos y nombres al pasar el cursor
    var menu = null;
    function pintarMenu() {
        var q = ((menu && menu.entrada && menu.entrada.value) || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        var grupos = {}, orden = [];
        visibles().forEach(function (s) {
            var texto = (s.titulo + " " + s.desc + " " + s.palabras).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
            if (q && texto.indexOf(q) === -1) return;
            if (!grupos[s.grupo]) { grupos[s.grupo] = []; orden.push(s.grupo); }
            grupos[s.grupo].push(s);
        });
        if (menu) menu.pintar(orden.map(function (g) {
            return { titulo: g, svg: ico({ "Tu cuenta": ICO.persona, "Módulos": ICO.modulos, "Administración": ICO.admin }[g] || ICO.sistema),
                     items: grupos[g].map(function (s) { return { id: s.id, nombre: s.titulo, svg: ico(s.ico), actual: s.id === actual }; }) };
        }));
    }

    var actual = null;
    function abrir(id, sub) {
        if (id === "perfil" && (sub === "pin" || sub === "olvide" || sub === "seguridad")) id = "seguridad";   // antes vivían en Mi perfil
        var s = visibles().filter(function (x) { return x.id === id; })[0] || visibles()[0];
        if (s.ir) { (incrustado ? window.top : window).location.href = s.ir; return; }
        actual = s.id;
        if (!incrustado) Fiscontable.url({ seccion: s.id, sub: sub || null });
        pintarMenu();
        var cuerpo = $("cf-cuerpo");
        cuerpo.innerHTML = '<header class="cf-cabeza"><div><h2>' + esc(s.titulo) + "</h2><p>" + esc(s.desc) + "</p></div>" +
            (incrustado ? '<button type="button" class="cf-btn cf-btn--principal" id="cf-listo">Listo</button>' : "") + "</header>" +
            (s.subs && !s.marco ? "" : "") + '<div id="cf-seccion"></div>';
        if (incrustado) $("cf-listo").addEventListener("click", listo);
        var caja = $("cf-seccion");
        document.body.classList.toggle("cf-con-marco", !!s.marco);
        if (s.marco) {
            caja.innerHTML = '<iframe class="cf-marco" title="' + esc(s.titulo) + '" src="' + esc(s.marco(sub)) + '"></iframe>';
            return;
        }
        s.pintar(caja);
    }


    function listo() {
        if (window.parent !== window) window.parent.postMessage({ fiscontable: "config-listo", seccion: actual }, location.origin);
        else location.href = "/inicio/";
    }

    function aviso(caja, ok, texto) {
        var p = caja.querySelector(".cf-msj");
        if (!p) return;
        p.textContent = texto; p.className = "cf-msj " + (ok ? "cf-msj--ok" : "cf-msj--mal");
    }

    function enlaceA(c, titulo, texto, href, boton) {
        c.innerHTML = '<div class="cf-tarjeta"><p class="cf-texto">' + esc(texto) + '</p><a class="cf-btn cf-btn--principal" href="' + href + '"' + (incrustado ? ' target="_top"' : "") + ">" + esc(boton) + "</a></div>";
    }

    /* ---------- Mi perfil ---------- */
    /* M-20: foto de perfil. Se recorta cuadrada aquí (con zoom) y el servidor la vuelve a encoger a 256×256. */
    function pintarFoto(caja) {
        caja.innerHTML = '<div class="cf-tarjeta cf-foto"><div class="cf-foto__vista"><canvas width="256" height="256" id="cf-foto-lienzo" aria-label="Vista previa"></canvas></div>' +
            '<div class="cf-foto__lado"><b>Foto de perfil</b><p class="cf-texto">Sale en la barra de arriba. JPG, PNG o WebP de hasta 3 MB.</p>' +
            '<input type="file" id="cf-foto-archivo" accept="image/png,image/jpeg,image/webp" hidden>' +
            '<label class="cf-foto__zoom" id="cf-foto-zoom-caja" hidden>Acercar <input type="range" id="cf-foto-zoom" min="1" max="3" step="0.05" value="1"></label>' +
            '<div class="cf-acciones"><button type="button" class="cf-btn" id="cf-foto-elegir">Elegir imagen</button>' +
            '<button type="button" class="cf-btn cf-btn--principal" id="cf-foto-guardar" hidden>Guardar foto</button>' +
            '<button type="button" class="cf-btn" id="cf-foto-quitar"' + (perfil.foto ? "" : " hidden") + '>Quitar</button><span class="cf-msj"></span></div></div></div>';
        var lienzo = $("cf-foto-lienzo"), ctx = lienzo.getContext("2d"), img = null, zoom = 1;
        function dibujar() {
            ctx.fillStyle = "#e5e7eb"; ctx.fillRect(0, 0, 256, 256);
            if (!img) return;
            var lado = Math.min(img.width, img.height) / zoom, sx = (img.width - lado) / 2, sy = (img.height - lado) / 2;
            ctx.drawImage(img, sx, sy, lado, lado, 0, 0, 256, 256);
        }
        dibujar();
        if (perfil.foto) fetch(API + "/api/mi-perfil/foto?v=" + encodeURIComponent(perfil.foto), { credentials: "include" }).then(function (r) { return r.ok ? r.blob() : null; })
            .then(function (b) { if (!b) return; var i = new Image(); i.onload = function () { if (!img) ctx.drawImage(i, 0, 0, 256, 256); }; i.src = URL.createObjectURL(b); });
        $("cf-foto-elegir").addEventListener("click", function () { $("cf-foto-archivo").click(); });
        $("cf-foto-archivo").addEventListener("change", function () {
            var f = this.files[0]; this.value = "";
            if (!f) return;
            if (f.size > 3 * 1024 * 1024) { aviso(caja, false, "La imagen pesa más de 3 MB."); return; }
            var i = new Image();
            i.onload = function () { img = i; zoom = 1; $("cf-foto-zoom").value = 1; $("cf-foto-zoom-caja").hidden = false; $("cf-foto-guardar").hidden = false; dibujar(); };
            i.onerror = function () { aviso(caja, false, "No se pudo abrir esa imagen."); };
            i.src = URL.createObjectURL(f);
        });
        $("cf-foto-zoom").addEventListener("input", function () { zoom = +this.value; dibujar(); });
        $("cf-foto-guardar").addEventListener("click", async function () {
            try {
                var r = await enviar("/api/mi-perfil/foto", "PUT", { imagen: lienzo.toDataURL("image/jpeg", 0.9) });
                perfil.foto = r.foto; aviso(caja, true, "Guardada.");
                [window, window.top].forEach(function (w) { try { if (w.Fiscontable && w.Fiscontable.ponerFoto) w.Fiscontable.ponerFoto(r.foto); } catch (x) { /* otro origen */ } });
                $("cf-foto-guardar").hidden = true; $("cf-foto-quitar").hidden = false;
            } catch (e) { aviso(caja, false, e.message); }
        });
        $("cf-foto-quitar").addEventListener("click", async function () {
            try { await api("/api/mi-perfil/foto", { method: "DELETE" }); perfil.foto = null; img = null; dibujar(); this.hidden = true; aviso(caja, true, "Foto quitada.");
                [window, window.top].forEach(function (w) { try { if (w.Fiscontable && w.Fiscontable.ponerFoto) w.Fiscontable.ponerFoto(null); } catch (x) { /* otro origen */ } }); }
            catch (e) { aviso(caja, false, e.message); }
        });
    }

    function pintarPerfil(c) {
        var cajaFoto = document.createElement("div");
        c.innerHTML = '<div class="cf-tarjeta"><div class="cf-campos">' +
            '<label class="cf-campo"><span>Nombre</span><input id="cf-nombre" maxlength="120" value="' + esc(perfil.nombre || "") + '"></label>' +
            '<label class="cf-campo"><span>Teléfono</span><input id="cf-telefono" inputmode="tel" maxlength="20" value="' + esc(perfil.telefono || "") + '"></label>' +
            '<label class="cf-campo"><span>Correo <i>(con el que entras; no se cambia aquí)</i></span><input value="' + esc(perfil.persona || perfil.correo || "") + '" disabled></label></div>' +
            '<div class="cf-acciones"><button type="button" class="cf-btn cf-btn--principal" id="cf-guardar-perfil">Guardar</button><span class="cf-msj"></span></div></div>';
        c.insertBefore(cajaFoto, c.firstChild); cajaFoto.style.marginBottom = "12px"; pintarFoto(cajaFoto);
        $("cf-guardar-perfil").addEventListener("click", async function () {
            try {
                await enviar("/api/mi-perfil", "PUT", { nombre: $("cf-nombre").value.trim(), telefono: $("cf-telefono").value.trim() || null });
                perfil.nombre = $("cf-nombre").value.trim();
                aviso(c, true, "Guardado.");
            } catch (e) { aviso(c, false, e.message); }
        });
        pintarPreferencias(c);
    }

    /* Seguridad (inicio de sesión propio, core/cuentas.py): contraseña, verificación en dos pasos y sesiones abiertas.
       Las piezas de contraseña y de dos pasos son las mismas de /login (assets/js/comun/cuenta.js). */
    async function pintarSeguridad(c, previa) {
        var caja = previa || document.createElement("div");
        caja.className = "cf-tarjeta"; caja.style.marginTop = "14px";
        if (!previa) c.appendChild(caja);
        caja.innerHTML = '<h3 class="cf-sub">Inicio de sesión</h3><p class="cf-texto">Cargando…</p>';
        var d;
        try { d = await api("/api/mi-cuenta"); } catch (e) { caja.innerHTML = '<h3 class="cf-sub">Inicio de sesión</h3><p class="cf-msj cf-msj--mal">' + esc(e.message) + "</p>"; return; }
        var admin = perfil && perfil.rol === "admin";
        function fecha(iso) { var x = new Date(/Z$/.test(iso) ? iso : iso + "Z"); return isNaN(x) ? "" : x.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
        // «Chrome en Windows» en lugar del texto técnico del navegador
        function equipo(ua) {
            ua = ua || "";
            var nav = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
            var so = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone o iPad" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
            return nav && so ? nav + " en " + so : nav || so || "Navegador";
        }
        caja.innerHTML = '<h3 class="cf-sub">Inicio de sesión</h3>' +
            (d.propio ? "" : '<p class="cf-texto">Hoy entras con un código que llega a tu correo. Cuando se active el inicio de sesión con contraseña, usarás la que pongas aquí' +
                (admin ? " (se activa en Administración → Usuarios)." : ".") + "</p>") +
            '<div class="cf-seg"><div class="cf-seg__cab"><b>Contraseña</b><span>' + (d.tiene_clave ? "Puesta" + (d.clave_cambiada ? " · cambiada el " + esc(fecha(d.clave_cambiada)) : "") : "Sin contraseña todavía") + "</span>" +
                '<button type="button" class="cf-btn" id="cf-seg-clave">' + (d.tiene_clave ? "Cambiar" : "Crear contraseña") + "</button></div>" +
                '<form class="cf-seg__cuerpo" id="cf-seg-clave-forma" hidden novalidate>' +
                    (d.tiene_clave ? '<label class="cf-campo"><span>Contraseña actual</span><input type="password" id="cf-seg-actual" autocomplete="current-password" maxlength="128"></label>' : "") +
                    '<div id="cf-seg-nueva"></div><div class="cf-acciones"><button type="submit" class="cf-btn cf-btn--principal">Guardar contraseña</button><span class="cf-msj"></span></div></form></div>' +
            '<div class="cf-seg"><div class="cf-seg__cab"><b>Verificación en dos pasos</b><span>' + (d.totp_activo ? "Activa · " + d.respaldo_restantes + " códigos de respaldo" : "Apagada") + "</span>" +
                (d.totp_activo ? (admin ? "" : '<button type="button" class="cf-btn" id="cf-seg-quitar">Quitar</button>') : '<button type="button" class="cf-btn" id="cf-seg-2fa">Activar</button>') + "</div>" +
                '<div class="cf-seg__cuerpo" id="cf-seg-2fa-caja" hidden></div>' +
                (!d.totp_activo ? '<p class="cf-texto">Al iniciar sesión, además de tu contraseña se pide un código. ' +
                    (admin ? "La cuenta de administrador usa siempre la app de autenticación." : "Sin la app, el código llega a tu correo; con la app es más seguro y no dependes del correo.") + "</p>" : "") + "</div>" +
            (d.equipos && d.equipos.length ? '<div class="cf-seg"><div class="cf-seg__cab"><b>Equipos de confianza</b><span>' + d.equipos.length + '</span></div>' +
                '<p class="cf-texto">En estos equipos no se pide el código al iniciar sesión. Se quitan solos a los 30 días o al cambiar tu contraseña.</p><ul class="cf-seg__lista">' +
                d.equipos.map(function (q) {
                    return "<li><span>" + esc(equipo(q.ua)) + (q.actual ? " · este equipo" : "") +
                        "<small>" + esc(q.ip || "") + " · desde " + esc(fecha(q.creado)) + " · última vez " + esc(fecha(q.ultimo_uso)) + "</small></span>" +
                        '<button type="button" class="cf-btn" data-quitar-equipo="' + esc(q.id) + '">Quitar</button></li>';
                }).join("") + "</ul></div>" : "") +
            (d.sesiones && d.sesiones.length ? '<div class="cf-seg"><div class="cf-seg__cab"><b>Sesiones abiertas</b><span>' + d.sesiones.length + "</span></div><ul class=\"cf-seg__lista\">" +
                d.sesiones.map(function (s) {
                    return "<li><span>" + esc(equipo(s.ua)) + "<small>" + esc(s.ip || "") + " · última vez " + esc(fecha(s.ultimo_uso)) + "</small></span>" +
                        (s.actual ? '<span class="cf-texto">Esta</span>' : '<button type="button" class="cf-btn" data-cerrar-sesion="' + esc(s.id) + '">Cerrar</button>') + "</li>";
                }).join("") + "</ul></div>" : "");
        var campo = null;
        $("cf-seg-clave").addEventListener("click", function () {
            var f = $("cf-seg-clave-forma"); f.hidden = !f.hidden;
            if (!f.hidden && !campo) campo = Fiscontable.campoClave($("cf-seg-nueva"), { confirmar: true });
        });
        $("cf-seg-clave-forma").addEventListener("submit", async function (e) {
            e.preventDefault();
            var msj = this.querySelector(".cf-msj"), falta = campo.revisar();
            if (falta) { msj.textContent = falta; msj.className = "cf-msj cf-msj--mal"; return; }
            try {
                await enviar("/api/mi-cuenta/clave", "PUT", { actual: ($("cf-seg-actual") || {}).value || null, nueva: campo.valor() });
                msj.textContent = "✓ Contraseña guardada. Se cerraron tus otras sesiones."; msj.className = "cf-msj";
                setTimeout(function () { pintarDeNuevo(); }, 1600);
            } catch (er) { msj.textContent = er.message; msj.className = "cf-msj cf-msj--mal"; }
        });
        if ($("cf-seg-2fa")) $("cf-seg-2fa").addEventListener("click", function () {
            var cj = $("cf-seg-2fa-caja"); cj.hidden = false; this.hidden = true;
            Fiscontable.dosPasos(cj, { preparar: function () { return api("/api/mi-cuenta/2fa/preparar", { method: "POST" }); },
                activar: function (codigo) { return enviar("/api/mi-cuenta/2fa/activar", "POST", { codigo: codigo }); },
                alTerminar: pintarDeNuevo });
        });
        if ($("cf-seg-quitar")) $("cf-seg-quitar").addEventListener("click", async function () {
            var clave = prompt("Para quitar la verificación en dos pasos, escribe tu contraseña:");
            if (!clave) return;
            try { await enviar("/api/mi-cuenta/2fa/quitar", "POST", { clave: clave }); pintarDeNuevo(); } catch (er) { Fiscontable.avisar(er.message); }
        });
        caja.addEventListener("click", async function (e) {
            var q = e.target.closest("[data-quitar-equipo]");
            if (q) {
                try { await api("/api/mi-cuenta/equipos/" + encodeURIComponent(q.dataset.quitarEquipo), { method: "DELETE" }); q.closest("li").remove(); } catch (er) { Fiscontable.avisar(er.message); }
                return;
            }
            var b = e.target.closest("[data-cerrar-sesion]");
            if (!b) return;
            try { await api("/api/mi-cuenta/sesiones/" + encodeURIComponent(b.dataset.cerrarSesion), { method: "DELETE" }); b.closest("li").remove(); } catch (er) { Fiscontable.avisar(er.message); }
        });
        function pintarDeNuevo() { pintarSeguridad(c, caja); }
    }

    /* Preferencias de esta computadora: densidad de las tablas */
    function pintarPreferencias(c) {
        var actual = "normal"; try { actual = localStorage.getItem("fc-densidad") || "normal"; } catch (e) { /* nada */ }
        var caja = document.createElement("div");
        caja.className = "cf-tarjeta"; caja.style.marginTop = "14px";
        caja.innerHTML = '<h3 class="cf-sub">Tamaño de las tablas</h3><p class="cf-texto">Compacta muestra más renglones en pantalla.</p>' +
            '<div class="ctx-segmento" role="group" aria-label="Tamaño de las tablas" id="cf-densidad">' +
            [["normal", "Normal"], ["compacta", "Compacta"]].map(function (o) {
                return '<button type="button" data-densidad="' + o[0] + '" aria-pressed="' + (actual === o[0]) + '">' + o[1] + "</button>";
            }).join("") + "</div>";
        c.appendChild(caja);
        caja.addEventListener("click", function (e) {
            var b = e.target.closest("[data-densidad]"); if (!b) return;
            try { localStorage.setItem("fc-densidad", b.dataset.densidad); } catch (x) { /* nada */ }
            caja.querySelectorAll("[data-densidad]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
            [document.documentElement, window.top !== window ? window.top.document.documentElement : null].forEach(function (h) {
                try { if (h) h.classList.toggle("fc-compacta", b.dataset.densidad === "compacta"); } catch (x) { /* otro origen */ }
            });
        });
    }

    /* Bloqueo por inactividad: minutos y PIN (el PIN se guarda automáticamente como hash en el servidor) */
    function pintarBloqueo(c, modo) {
        var b = perfil.bloqueo || { tiene_pin: false, minutos: 15 };
        var sub = Fiscontable.url("sub");
        if (!modo && b.tiene_pin && sub === "olvide") modo = "olvide";
        var caja = document.createElement("div");
        caja.className = "cf-tarjeta"; caja.style.marginTop = "14px";
        var estado = b.tiene_pin ? '<span class="ui-estado ui-estado--ok">PIN activo</span>' : '<span class="ui-estado">Sin PIN</span>';
        var cabeza = '<h3 class="cf-sub cf-sub--estado">Bloqueo por inactividad ' + estado + "</h3>";
        var min = b.restablecer_min || 15;
        if (modo === "olvide") {
            // «Olvidé mi PIN»: solo recién entrado con el correo (el servidor lo vuelve a revisar)
            caja.innerHTML = cabeza + (b.puede_restablecer
                ? '<p class="cf-texto">Crea un PIN nuevo. Disponible ' + min + " minutos después de iniciar sesión.</p>" +
                  '<div class="cf-campos"><label class="cf-campo"><span>PIN nuevo <i>(4 a 6 números)</i></span><input id="cf-bl-nuevo" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label></div>' +
                  '<div class="cf-acciones"><button type="button" class="cf-btn cf-btn--principal" id="cf-bl-rest">Guardar PIN nuevo</button>' +
                  '<button type="button" class="cf-btn" id="cf-bl-rest-quitar">Quitar PIN</button>' +
                  '<button type="button" class="cf-btn" id="cf-bl-cancelar">Cancelar</button><span class="cf-msj"></span></div>'
                : '<p class="cf-texto">Para crear un PIN nuevo, vuelve a iniciar sesión.</p>' +
                  '<div class="cf-acciones"><button type="button" class="cf-btn cf-btn--principal" id="cf-bl-reentrar">Volver a iniciar sesión</button>' +
                  '<button type="button" class="cf-btn" id="cf-bl-cancelar">Cancelar</button><span class="cf-msj"></span></div>');
            c.appendChild(caja);
            var otraVez = function () { c.removeChild(caja); pintarBloqueo(c, "normal"); };
            $("cf-bl-cancelar").addEventListener("click", otraVez);
            if ($("cf-bl-reentrar")) $("cf-bl-reentrar").addEventListener("click", async function () {
                try { localStorage.setItem("fc-olvide-pin", "1"); } catch (e) { /* sin almacenamiento */ }
                if (perfil.sesion_propia) {
                    try { await fetch(Fiscontable.API + "/publico/cuenta/salir", { method: "POST", credentials: "include" }); } catch (e) { /* igual sigue */ }
                    window.top.location.href = "/login";
                    return;
                }
                window.top.location.href = Fiscontable.API + "/cdn-cgi/access/logout";
            });
            var restablecer = async function (pin) {
                try {
                    perfil.bloqueo = await enviar("/api/mi-perfil/pin/restablecer", "POST", { pin: pin });
                    c.removeChild(caja); pintarBloqueo(c, "normal"); aviso(c.lastChild, true, pin ? "PIN nuevo guardado." : "PIN quitado.");
                } catch (e) { aviso(caja, false, e.message); }
            };
            if ($("cf-bl-rest")) {
                setTimeout(function () { caja.scrollIntoView({ block: "center" }); $("cf-bl-nuevo").focus(); }, 80);
                $("cf-bl-rest").addEventListener("click", function () {
                    var pin = $("cf-bl-nuevo").value.trim();
                    if (!pin) { aviso(caja, false, "Escribe el PIN nuevo."); return; }
                    restablecer(pin);
                });
                $("cf-bl-rest-quitar").addEventListener("click", function () { restablecer(null); });
            }
            return;
        }
        // Vista normal: el tiempo se guarda al elegirlo; cambiar, quitar o crear el PIN abre sus campos solo al pedirlo
        var campoPin = function (id, etiqueta, nuevo) {
            return '<label class="cf-campo"><span>' + etiqueta + '</span><input id="' + id + '" type="password" inputmode="numeric" maxlength="6" autocomplete="' +
                (nuevo ? "new-password" : "off") + '"></label>';
        };
        caja.innerHTML = cabeza +
            '<div class="cf-campos"><label class="cf-campo"><span>Bloquear después de</span><select id="cf-bl-min">' +
            [5, 10, 15, 20, 30, 45, 60].map(function (m) { return '<option value="' + m + '"' + (m === b.minutos ? " selected" : "") + ">" + m + " minutos sin uso</option>"; }).join("") +
            "</select></label></div>" +
            '<div class="cf-acciones" id="cf-bl-botones">' + (b.tiene_pin
                ? '<button type="button" class="cf-btn" data-bl="cambiar">Cambiar PIN</button><button type="button" class="cf-btn" data-bl="quitar">Quitar PIN</button>' +
                  '<button type="button" class="cf-link" data-bl="olvide">Olvidé mi PIN</button>'
                : '<button type="button" class="cf-btn cf-btn--principal" data-bl="crear">Crear PIN</button>') + '<span class="cf-msj"></span></div>' +
            '<div id="cf-bl-forma" hidden></div>';
        c.appendChild(caja);
        var forma = $("cf-bl-forma"), botones = $("cf-bl-botones");
        var listo = function (nuevo, texto) { perfil.bloqueo = Object.assign({}, perfil.bloqueo, nuevo); c.removeChild(caja); pintarBloqueo(c, "normal"); aviso(c.lastChild, true, texto); };
        var cerrarForma = function () { forma.hidden = true; forma.innerHTML = ""; botones.hidden = false; };
        var abrirForma = function (tipo) {
            var campos = tipo === "cambiar" ? campoPin("cf-bl-actual", "PIN actual") + campoPin("cf-bl-pin", "PIN nuevo <i>(4 a 6 números)</i>", true)
                : tipo === "quitar" ? campoPin("cf-bl-actual", "PIN actual")
                : campoPin("cf-bl-pin", "PIN <i>(4 a 6 números)</i>", true);
            var boton = tipo === "quitar" ? "Quitar PIN" : "Guardar";
            forma.innerHTML = '<div class="cf-campos">' + campos + '</div><div class="cf-acciones"><button type="button" class="cf-btn cf-btn--principal" id="cf-bl-ok">' + boton +
                '</button><button type="button" class="cf-btn" id="cf-bl-cancelar">Cancelar</button><span class="cf-msj"></span></div>';
            botones.hidden = true; forma.hidden = false;
            setTimeout(function () { var i = forma.querySelector("input"); if (i) i.focus(); }, 30);
            $("cf-bl-cancelar").addEventListener("click", cerrarForma);
            var hacer = async function () {
                try {
                    if (tipo === "quitar") return listo(await enviar("/api/mi-perfil/pin/quitar", "POST", { actual: $("cf-bl-actual").value.trim() }), "PIN quitado.");
                    var pin = $("cf-bl-pin").value.trim();
                    if (!pin) { aviso(forma, false, "Escribe el PIN nuevo."); return; }
                    var cuerpo = { minutos: +$("cf-bl-min").value, pin: pin };
                    if ($("cf-bl-actual")) cuerpo.actual = $("cf-bl-actual").value.trim();
                    listo(await enviar("/api/mi-perfil/pin", "PUT", cuerpo), "PIN guardado.");
                } catch (e) { aviso(forma, false, e.message); }
            };
            $("cf-bl-ok").addEventListener("click", hacer);
            forma.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.tagName === "INPUT") hacer(); });
        };
        botones.addEventListener("click", function (e) {
            var x = e.target.closest("[data-bl]"); if (!x) return;
            if (x.dataset.bl === "olvide") { c.removeChild(caja); pintarBloqueo(c, "olvide"); return; }
            abrirForma(x.dataset.bl);
        });
        $("cf-bl-min").addEventListener("change", async function () {
            try { perfil.bloqueo = Object.assign({}, perfil.bloqueo, await enviar("/api/mi-perfil/pin", "PUT", { minutos: +this.value })); aviso(botones, true, "Guardado."); }
            catch (e) { aviso(botones, false, e.message); }
        });
        // Llegó desde el aviso «Crear mi PIN» (tras volver a entrar por inactividad)
        if (!modo && !b.tiene_pin && sub === "pin") setTimeout(function () { caja.scrollIntoView({ block: "center" }); abrirForma("crear"); }, 80);
    }

    function pintarPlan(c) {
        var vence = perfil.fecha_expira ? new Date(perfil.fecha_expira).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : "Sin vencimiento";
        var pc = perfil.plan_comercial, info = perfil.planes || {}, cat = info.catalogo, contacto = info.contacto || {};
        var precio = function (v) { return "$" + Number(v || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 }); };
        var quiero = function (texto) {
            var b = "";
            if (contacto.whatsapp) b += '<a class="cf-btn cf-btn--principal" target="_blank" rel="noopener" href="https://wa.me/' + esc(contacto.whatsapp) + "?text=" + encodeURIComponent(texto) + '">WhatsApp</a>';
            if (contacto.correo) b += '<a class="cf-btn" href="mailto:' + esc(contacto.correo) + "?subject=" + encodeURIComponent("Plan de Fiscontable") + "&body=" + encodeURIComponent(texto) + '">Correo</a>';
            return b || '<span class="cf-texto">' + esc(contacto.texto || "Contacta al administrador.") + "</span>";
        };
        var html = '<div class="cf-tarjeta"><dl class="cf-datos"><dt>Plan</dt><dd>' + esc(pc ? pc.nombre : (perfil.plan_nombre || perfil.rol || "—")) + "</dd>" +
            (pc ? "<dt>Empresas</dt><dd>" + pc.empresas_usadas + " de " + pc.empresas + "</dd>" + (Number(pc.timbres) > 0 ? "<dt>Timbres al mes</dt><dd>" + pc.timbres + "</dd>" : "") : "") +
            "<dt>Vigencia</dt><dd>" + esc(vence) + "</dd><dt>Módulos</dt><dd>" + esc(String((perfil.modulos_permitidos || []).length)) + " activos</dd></dl>" +
            '<a class="cf-btn cf-btn--principal" href="/creditos/"' + (incrustado ? ' target="_top"' : "") + ">Ver y recargar créditos</a></div>";
        if (cat && cat.planes && cat.planes.length) {
            var tarjeta = function (p) {
                var actual = pc && pc.clave === p.clave, pronto = !!p.proximamente;
                return '<div class="cf-plan' + (p.destacado ? " cf-plan--destacado" : "") + (actual ? " cf-plan--actual" : "") + '">' +
                    (actual ? '<span class="cf-plan__marca">Tu plan</span>' : pronto ? '<span class="cf-plan__marca">Próximamente</span>' : p.destacado ? '<span class="cf-plan__marca">Recomendado</span>' : "") +
                    "<h4>" + esc(p.nombre) + "</h4><small>" + esc(p.para || "") + "</small>" +
                    '<p class="cf-plan__precio"><b>' + precio(p.precio) + "</b> al mes</p>" +
                    '<p class="cf-plan__anual">o ' + precio(p.precio_anual) + " al año" + (cat.meses_gratis_anual ? " (" + cat.meses_gratis_anual + " meses gratis)" : "") + "</p>" +
                    "<ul><li><b>" + p.empresas + "</b> empresas (RFC)</li>" + (Number(p.timbres) > 0 ? "<li><b>" + Number(p.timbres).toLocaleString("es-MX") + "</b> timbres al mes</li>" : "") + "</ul>" +
                    (actual || pronto ? "" : '<div class="cf-plan__acciones">' + quiero("Hola, me interesa el plan " + p.nombre + " de Fiscontable (" + (perfil.persona || perfil.correo || "") + ").") + "</div>") + "</div>";
            };
            var niveles = cat.niveles || {}, orden = Object.keys(niveles).length ? Object.keys(niveles) : [""];
            html += '<h3 class="cf-subtitulo">Planes</h3><p class="cf-texto">Cada licencia es para una persona y su PC con Fiscontable Agente. Precios más IVA.</p>';
            orden.forEach(function (nv) {
                var lista = cat.planes.filter(function (p) { return (!nv || (p.nivel || p.rol) === nv) && !p.proximamente; });   // lo que aún no se vende no se muestra
                if (!lista.length) return;
                var info = niveles[nv];
                if (info) html += '<h4 class="cf-plan-nivel">' + esc(info.nombre) + " <small>" + esc(info.resumen || "") + "</small></h4>" +
                    (info.incluye && info.incluye.length ? '<p class="cf-texto cf-plan-incluye">' + info.incluye.map(esc).join(" · ") + ".</p>" : "");
                html += '<div class="cf-planes">' + lista.map(tarjeta).join("") + "</div>";
            });
            if (cat.despacho_minimo) html += '<p class="cf-texto cf-plan-incluye"><b>Despacho:</b> junta ' + cat.despacho_minimo + " licencias o más; los RFC de todas se suman en una sola cartera.</p>";
            if ((cat.incluye || []).length) html += '<p class="cf-texto cf-plan-incluye"><b>Todos incluyen:</b> ' + cat.incluye.map(esc).join(" · ") + ".</p>";
            if ((cat.timbres || []).length) html += '<h3 class="cf-subtitulo">Timbres extra</h3><div class="cf-timbres">' + cat.timbres.map(function (t) {
                return '<div class="cf-timbre"><b>' + Number(t.timbres).toLocaleString("es-MX") + "</b> timbres<span>" + precio(t.precio) + "</span><small>" +
                    "$" + (t.precio / t.timbres).toFixed(2) + " cada uno</small></div>";
            }).join("") + "</div>";
        }
        html += '<h3 class="cf-subtitulo">Activar una licencia</h3><div class="cf-tarjeta"><p class="cf-texto">¿Te dimos una clave (FSC-…)? Actívala aquí: ' +
            'se aplica a tu cuenta y, si es de despacho, crea tu despacho.</p><div id="cf-licencia"></div></div>';
        html += '<h3 class="cf-subtitulo">Tus documentos</h3><div class="cf-tarjeta" id="cf-ciclo"><p class="cf-texto">Cargando…</p></div>';
        c.innerHTML = html;
        if (window.Fiscontable.activarLicencia) Fiscontable.activarLicencia($("cf-licencia"), { alActivar: function () { setTimeout(function () { location.reload(); }, 2500); } });
        pintarCiclo($("cf-ciclo"));
    }

    /* Plan vencido (core/ciclo_cuenta.py): la etapa, las fechas y lo que la persona puede hacer. «Descargar todo» siempre. */
    async function pintarCiclo(caja) {
        var fecha = function (t) { return t ? new Date(t).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : ""; };
        var propia = !perfil.persona || perfil.persona === perfil.correo;
        var e = {};
        try { e = await api("/api/mi-cuenta/ciclo"); } catch (x) { e = {}; }
        var texto = "Descarga en un archivo ZIP todo lo que tienes en Fiscontable: XML, constancias, opiniones y declaraciones, acomodados por empresa.";
        var botones = propia ? '<button type="button" class="cf-btn cf-btn--principal" data-ciclo="exportar">Descargar todo</button>' : "";
        if (e.etapa === "gracia") {
            texto = "Tu plan venció el " + fecha(e.vence) + ". La cuenta sigue funcionando hasta el " + fecha(e.gracia_hasta) + "; después quedará en solo lectura.";
        } else if (e.etapa === "solo_lectura") {
            texto = "Tu plan venció el " + fecha(e.vence) + " y la cuenta está en solo lectura. " +
                (e.efirmas_eliminadas ? "Las e.firmas guardadas ya se eliminaron. " : "Las e.firmas guardadas se eliminan el " + fecha(e.efirmas_el) + ". ") +
                "La cuenta y sus documentos se eliminan el " + fecha(e.cuenta_el) + ".";
            if (propia && e.credenciales) botones += '<button type="button" class="cf-btn" data-ciclo="borrar">Eliminar e.firmas guardadas</button>';
            if (propia && !e.no_renueva && !e.efirmas_eliminadas) botones += '<button type="button" class="cf-btn" data-ciclo="no-renueva">No voy a renovar</button>';
        }
        if (!propia) texto += " Esto lo hace el titular desde su cuenta.";
        caja.innerHTML = '<p class="cf-texto">' + esc(texto) + "</p>" + (botones ? '<div class="cf-acciones">' + botones + '<span class="cf-msj"></span></div>' : "");
        caja.addEventListener("click", async function (ev) {
            var b = ev.target.closest("[data-ciclo]");
            if (!b) return;
            var que = b.dataset.ciclo;
            try {
                if (que === "exportar") {
                    b.disabled = true;
                    await enviar("/api/mi-cuenta/exportar", "POST", {});
                    aviso(caja, true, "Preparando el archivo. Quedará en «Mis descargas».");
                    if (Fiscontable.refrescarDescargas) Fiscontable.refrescarDescargas();
                } else if (que === "borrar") {
                    if (!(await Fiscontable.confirmar({ titulo: "Eliminar e.firmas guardadas", peligro: true, si: "Eliminar",
                        texto: "Se eliminan las e.firmas y contraseñas guardadas de todas tus empresas. No se puede deshacer." }))) return;
                    var r = await enviar("/api/mi-cuenta/ciclo/borrar-efirmas", "POST", {});
                    aviso(caja, true, "Listo: se eliminaron las de " + r.empresas + " empresa" + (r.empresas === 1 ? "" : "s") + ".");
                    b.remove();
                } else if (que === "no-renueva") {
                    if (!(await Fiscontable.confirmar({ titulo: "No voy a renovar", si: "Confirmar",
                        texto: "Tus e.firmas guardadas se eliminarán en 5 días. Tus documentos siguen disponibles para descargar hasta el " + fecha(e.cuenta_el) + "." }))) return;
                    var n = await enviar("/api/mi-cuenta/ciclo/no-renueva", "POST", {});
                    aviso(caja, true, "Recibido. Las e.firmas se eliminan el " + fecha(n.efirmas_el) + ".");
                    b.remove();
                }
            } catch (x) { b.disabled = false; aviso(caja, false, x.message); }
        });
    }

    /* ---------- Buzón tributario ---------- */
    async function pintarBuzon(c) {
        c.innerHTML = '<div class="cf-tarjeta"><p class="cf-texto">Cargando…</p></div>';
        try {
            var p = await api("/api/buzon");
            var ops = Object.keys(p.frecuencias).sort(function (a, b) { return (+a || 99) - (+b || 99); });
            c.innerHTML = '<div class="cf-tarjeta"><label class="cf-campo cf-campo--corto"><span>Revisión automática de los buzones</span><select id="cf-buzon-frec">' +
                ops.map(function (k) { return '<option value="' + k + '"' + (+k === p.frecuencia ? " selected" : "") + ">" + esc(p.frecuencias[k]) + "</option>"; }).join("") + "</select></label>" +
                '<p class="cf-texto">Se revisa con la e.firma guardada de cada empresa activa en el Buzón. ' + esc(String((p.empresas || []).filter(function (e) { return e.activo; }).length)) +
                " empresa(s) activas.</p>" + '<div class="cf-acciones"><a class="cf-btn" href="/herramientas/buzon/"' + (incrustado ? ' target="_top"' : "") + '>Elegir empresas en el Buzón</a><span class="cf-msj"></span></div></div>';
            $("cf-buzon-frec").addEventListener("change", async function () {
                try { await enviar("/api/buzon/ajustes", "PUT", { frecuencia: +this.value }); aviso(c, true, "✓ Guardado."); }
                catch (e) { aviso(c, false, e.message); }
            });
        } catch (e) { c.innerHTML = '<div class="cf-tarjeta"><p class="cf-msj cf-msj--mal">' + esc(e.message) + "</p></div>"; }
    }

    /* ---------- Avisos (G-13 / G-14): qué llega por correo ---------- */
    async function pintarAvisos(c) {
        c.innerHTML = '<div class="cf-tarjeta"><p class="cf-texto">Cargando…</p></div>';
        try {
            var p = await api("/api/actividad/preferencias");
            c.innerHTML = '<div class="cf-tarjeta"><p class="cf-texto">Todos los avisos llegan a la campana de arriba. Marca los que quieres recibir también por correo.</p>' +
                Object.keys(p.tipos).map(function (t) {
                    return '<label class="ui-check cf-check"><input type="checkbox" data-tipo="' + esc(t) + '"' + (p.correo[t] ? " checked" : "") + "> " + esc(p.tipos[t]) + "</label>";
                }).join("") +
                '<label class="cf-campo"><span>Avisar de e.firma y sellos por vencer cuando falten (días)</span><input type="text" id="cf-av-dias" inputmode="numeric" value="' +
                esc((p.dias_vence || []).join(", ")) + '"></label>' +
                '<p class="cf-texto">De fábrica: 3 meses, 2 meses, 1 mes y luego 15, 10, 5, 2 y 1 días. Si ya la renovaste, deja de avisar sola.</p>' +
                '<label class="cf-campo"><span>Mandar los avisos a</span><input type="email" id="cf-av-destino" value="' + esc(p.destino || "") + '"></label>' +
                '<div class="cf-acciones"><button type="button" class="cf-btn cf-btn--principal" id="cf-av-guardar">Guardar</button>' +
                '<button type="button" class="cf-btn" id="cf-av-prueba">Mandar un correo de prueba</button><span class="cf-msj"></span></div>' +
                '<p class="cf-texto" style="margin-top:12px">Los correos salen por el mismo correo que usas en Facturar (el general de Fiscontable o el tuyo).</p></div>' +
                '<div class="cf-tarjeta" id="cf-av-caja-quien" style="margin-top:14px"><h3 class="cf-sub">¿A quién más le llegan?</h3>' +
                '<p class="cf-texto">Además del correo de arriba. Nadie recibe datos de empresas o módulos que no puede ver en Fiscontable.</p>' +
                '<label class="cf-campo"><span>Copias (separa con comas)</span><input type="text" id="cf-av-copias" inputmode="email" autocomplete="off" placeholder="avisos@tudespacho.mx, socio@tudespacho.mx" value="' +
                esc((p.copias || []).join(", ")) + '"></label>' +
                (p.es_despacho ? '<label class="ui-check cf-check"><input type="checkbox" id="cf-av-responsables"' + (p.responsables ? " checked" : "") +
                    "> El aviso de una empresa, también a la persona que la tiene asignada</label>" : "") +
                '<label class="ui-check cf-check"><input type="checkbox" id="cf-av-cliente"' + (p.cliente ? " checked" : "") +
                    "> El aviso de una empresa (Buzón, e.firma por vencer) y su resumen, también a su cliente (el correo de su ficha)</label>" +
                '<label class="ui-check cf-check"><input type="checkbox" id="cf-av-importes"' + (p.importes ? " checked" : "") +
                    "> Poner importes en el resumen (de fábrica, sin importes)</label>" +
                (p.puede_destinatarios ? '<div class="cf-acciones"><button type="button" class="cf-btn cf-btn--principal" id="cf-av-quien-guardar">Guardar</button><span class="cf-msj"></span></div>'
                    : '<p class="cf-texto">Solo el titular del despacho puede cambiar esto.</p>') + "</div>" +
                '<div class="cf-tarjeta" id="cf-av-caja-resumen" style="margin-top:14px"><h3 class="cf-sub">Resumen por correo</h3>' +
                '<p class="cf-texto">Un solo correo con cómo va tu cartera: el cierre del mes, lo que pasó y lo que está por vencer. ' +
                "Por empresa: notificaciones del Buzón, CFDI cancelados o con error, proveedores en listas del SAT, PPD sin complemento y trámites que no salieron. No lleva archivos.</p>" +
                '<div class="ctx-segmento cf-segmento" role="group" aria-label="Cada cuándo llega el resumen" id="cf-av-resumen">' +
                Object.keys(p.frecuencias_resumen || {}).map(function (f) {
                    return '<button type="button" data-resumen="' + esc(f) + '" aria-pressed="' + ((p.resumen || "") === f) + '">' + esc(p.frecuencias_resumen[f]) + "</button>";
                }).join("") + "</div>" +
                (p.equipo_resumen > 1 ? '<label class="ui-check cf-check"><input type="checkbox" id="cf-av-resumen-copia"' + (p.resumen_copia ? " checked" : "") +
                    "> Que cada persona de mi despacho reciba el de sus empresas (" + p.equipo_resumen + " personas)</label>" : "") +
                '<div class="cf-acciones"><button type="button" class="cf-btn" id="cf-av-resumen-ya">Mándame uno ahora</button><span class="cf-msj"></span></div></div>';
            var guardado = p;                                   // lo último que quedó guardado (el resumen se guarda automáticamente, sin tocar lo demás)
            var cajaResumen = $("cf-av-caja-resumen");
            $("cf-av-resumen").addEventListener("click", async function (e) {
                var b = e.target.closest("[data-resumen]"); if (!b || b.getAttribute("aria-pressed") === "true") return;
                var botones = cajaResumen.querySelectorAll("[data-resumen]");
                botones.forEach(function (x) { x.disabled = true; });
                try {
                    guardado = await enviar("/api/actividad/preferencias", "PUT",
                        { correo: guardado.correo, destino: guardado.destino || null, dias_vence: guardado.dias_vence, resumen: b.dataset.resumen });
                    botones.forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
                    aviso(cajaResumen, true, b.dataset.resumen ? "✓ Listo: te llegará a " + guardado.destino + "." : "✓ Apagado: ya no te llegará.");
                } catch (er) { aviso(cajaResumen, false, er.message); }
                finally { botones.forEach(function (x) { x.disabled = false; }); }
            });
            if ($("cf-av-resumen-copia")) $("cf-av-resumen-copia").addEventListener("change", async function () {
                var c2 = this; c2.disabled = true;
                try {
                    guardado = await enviar("/api/actividad/preferencias", "PUT",
                        { correo: guardado.correo, destino: guardado.destino || null, dias_vence: guardado.dias_vence, resumen_copia: c2.checked });
                    aviso(cajaResumen, true, c2.checked ? "✓ Cada persona recibirá el de sus empresas." : "✓ Solo te llegará a ti.");
                } catch (er) { c2.checked = !c2.checked; aviso(cajaResumen, false, er.message); }
                finally { c2.disabled = false; }
            });
            var cajaQuien = $("cf-av-caja-quien");
            if (!p.puede_destinatarios) cajaQuien.querySelectorAll("input").forEach(function (x) { x.disabled = true; });
            if ($("cf-av-quien-guardar")) $("cf-av-quien-guardar").addEventListener("click", async function () {
                var b = this; b.disabled = true;
                try {
                    var copias = $("cf-av-copias").value.split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
                    var cuerpo = { correo: guardado.correo, destino: guardado.destino || null, dias_vence: guardado.dias_vence, copias: copias,
                                   cliente: $("cf-av-cliente").checked, importes: $("cf-av-importes").checked };
                    if ($("cf-av-responsables")) cuerpo.responsables = $("cf-av-responsables").checked;
                    guardado = await enviar("/api/actividad/preferencias", "PUT", cuerpo);
                    $("cf-av-copias").value = (guardado.copias || []).join(", ");
                    aviso(cajaQuien, true, "✓ Guardado." + (guardado.copias && guardado.copias.length ? " Copia a " + guardado.copias.length + " correo(s)." : ""));
                } catch (er) { aviso(cajaQuien, false, er.message); }
                finally { b.disabled = false; }
            });
            $("cf-av-resumen-ya").addEventListener("click", async function () {
                var b = this; b.disabled = true; aviso(cajaResumen, true, "Armándolo…");
                try { var r = await enviar("/api/actividad/resumen-ahora", "POST", {}); aviso(cajaResumen, true, "✓ Enviado a " + r.destino + "."); }
                catch (er) { aviso(cajaResumen, false, er.message); }
                finally { b.disabled = false; }
            });
            $("cf-av-guardar").addEventListener("click", async function () {
                var correo = {};
                c.querySelectorAll("[data-tipo]").forEach(function (x) { correo[x.dataset.tipo] = x.checked; });
                var dias = $("cf-av-dias").value.split(/[^0-9]+/).map(Number).filter(function (n) { return n > 0 && n <= 365; });
                if (!dias.length) { aviso(c, false, "Escribe al menos un número de días (por ejemplo 30, 15, 5)."); return; }
                try {
                    var g = await enviar("/api/actividad/preferencias", "PUT", { correo: correo, destino: $("cf-av-destino").value.trim() || null, dias_vence: dias });
                    guardado = g; $("cf-av-dias").value = (g.dias_vence || dias).join(", "); aviso(c, true, "✓ Guardado.");
                }
                catch (e) { aviso(c, false, e.message); }
            });
            $("cf-av-prueba").addEventListener("click", async function () {
                var b = this; b.disabled = true;
                try { var r = await enviar("/api/actividad/correo-prueba", "POST", { destino: $("cf-av-destino").value.trim() || null }); aviso(c, true, "✓ Enviado a " + r.destino + "."); }
                catch (e) { aviso(c, false, e.message); }
                finally { b.disabled = false; }
            });
        } catch (e) { c.innerHTML = '<div class="cf-tarjeta"><p class="cf-msj cf-msj--mal">' + esc(e.message) + "</p></div>"; }
    }

    /* ---------- Programaciones (G-09 / C-02): todo lo que se hace automáticamente, en una lista ---------- */
    var PAGINA_MODULO = { csf: "/herramientas/constancias/", opinion: "/herramientas/opinion/", declaraciones: "/herramientas/declaraciones/",
                          xml: "/herramientas/descarga-xml/", buzon: "/herramientas/buzon/", validador: "/herramientas/validador/", listas: "/herramientas/listas-sat/" };
    async function pintarProgramaciones(c) {
        c.innerHTML = '<div class="cf-tarjeta"><p class="cf-texto">Cargando…</p></div>';
        try {
            var d = await api("/api/programacion"), nv = await api("/api/programacion-nuevas").catch(function () { return null; });
            var fecha = function (iso) { return iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "—"; };
            var df = (nv && nv.defecto) || {}, regla = function (r) { return r ? (r.frecuencia === "semanal" ? "cada semana" : "el día " + r.dia + " de cada mes") : ""; };
            c.innerHTML = '<div class="cf-tarjeta"><p class="cf-texto">Lo programado se ejecuta en horario nocturno con la e.firma registrada de cada empresa. ' +
                "Para cambiar una, ábrela en su módulo (con esa empresa elegida arriba) y usa «Cambiar» en la línea de programación.</p>" +
                (nv ? '<label class="ui-check cf-nuevas"><input type="checkbox" id="cf-prog-nuevas"' + (nv.activa ? " checked" : "") + "> " +
                    "<span><b>Programar solas las empresas nuevas</b><small>Cuando una empresa guarde su e.firma: constancia " + esc(regla(df.csf)) +
                    ", opinión " + esc(regla(df.opinion)) + ", declaraciones " + esc(regla(df.declaraciones)) + " y sus XML cada día. Solo lo que tu plan incluye; después lo cambias como cualquier otra.</small></span></label>" : "") +
                "</div>" +
                '<div class="cf-tarjeta cf-tarjeta--tabla" style="margin-top:12px"><table class="cf-tabla"><thead><tr><th>Qué</th><th>Empresa</th><th>Cada cuánto</th><th>Próxima</th><th>Última</th><th title="Le llega por correo al cliente cada vez que se descarga">Al cliente</th><th></th></tr></thead><tbody>' +
                (d.programaciones.length ? d.programaciones.map(function (x) {
                    var pausable = ["csf", "opinion", "declaraciones", "xml"].indexOf(x.modulo) !== -1 && x.rfc;
                    return "<tr" + (x.activa ? "" : ' class="cf-apagada"') + "><td><b>" + esc(x.nombre) + "</b></td><td>" + esc(x.alias || "") + (x.rfc ? "<small>" + esc(x.rfc) + "</small>" : "") + "</td>" +
                        "<td>" + esc(x.regla || "") + (x.activa ? "" : " <small>(pausada)</small>") + "</td><td>" + fecha(x.proxima) + "</td>" +
                        "<td>" + fecha(x.ultima) + (x.resultado ? "<small>" + esc(x.resultado) + "</small>" : "") + "</td>" +
                        "<td>" + (x.mandar_cliente === null || x.mandar_cliente === undefined ? "" :
                            '<label class="ui-check" title="' + esc(x.correo_cliente ? "Se manda a " + x.correo_cliente : "Escribe el correo del cliente en su ficha para poder mandárselo") + '">' +
                            '<input type="checkbox" data-mandar="' + esc(x.modulo) + '" data-rfc="' + esc(x.rfc) + '"' + (x.mandar_cliente ? " checked" : "") + (x.correo_cliente || x.mandar_cliente ? "" : " disabled") + "> Mandar</label>" +
                            (x.correo_cliente ? "" : "<small>Sin correo del cliente</small>")) + "</td>" +
                        '<td class="cf-celda-acciones">' + (pausable ? '<button type="button" class="cf-btn cf-btn--chico" data-pausa="' + esc(x.modulo) + '" data-rfc="' + esc(x.rfc) + '" data-activa="' + (x.activa ? "1" : "") + '">' + (x.activa ? "Pausar" : "Reanudar") + "</button> " : "") +
                        '<a class="cf-btn cf-btn--chico" href="' + PAGINA_MODULO[x.modulo] + '"' + (incrustado ? ' target="_top"' : "") + ">Abrir</a></td></tr>";
                }).join("") : '<tr><td colspan="7">Todavía no programas nada.</td></tr>') + "</tbody></table></div>" +
                '<p class="cf-msj"></p>';
            var chk = c.querySelector("#cf-prog-nuevas");
            if (chk) chk.addEventListener("change", async function () {
                try { await enviar("/api/programacion-nuevas", "PUT", { activa: chk.checked }); aviso(c, true, chk.checked ? "Las empresas nuevas se programarán automáticamente." : "Las empresas nuevas ya no se programan automáticamente."); }
                catch (x) { chk.checked = !chk.checked; aviso(c, false, x.message); }
            });
            c.onchange = async function (e) {
                var m = e.target.closest("[data-mandar]"); if (!m) return;
                m.disabled = true;
                try {
                    await enviar("/api/programacion/" + m.dataset.mandar + "/mandar-cliente", "PUT", { rfc: m.dataset.rfc, activa: m.checked });
                    aviso(c, true, m.checked ? "✓ Se le mandará al cliente cada vez que se baje." : "✓ Ya no se le manda al cliente.");
                } catch (x) { m.checked = !m.checked; aviso(c, false, x.message); }
                finally { m.disabled = false; }
            };
            c.onclick = async function (e) {
                var b = e.target.closest("[data-pausa]"); if (!b) return;
                b.disabled = true;
                try { await enviar("/api/programacion/" + b.dataset.pausa, "PUT", { rfc: b.dataset.rfc, activa: !b.dataset.activa }); pintarProgramaciones(c); }
                catch (x) { aviso(c, false, x.message); b.disabled = false; }
            };
        } catch (e) { c.innerHTML = '<div class="cf-tarjeta"><p class="cf-msj cf-msj--mal">' + esc(e.message) + "</p></div>"; }
    }

    /* ---------- Descarga automática de XML ---------- */
    /* Impuestos por empresa: el paquete de reglas según su régimen y lo que se cambió o aprendió */
    async function pintarImpuestos(c) {
        c.innerHTML = '<div class="cf-tarjeta"><p class="cf-texto">Cargando…</p></div>';
        try {
            var lista = await api("/api/fiscal/paquetes");
            var mom = function (v) { return v === "cobrado" ? "flujo" : "devengado"; };
            c.innerHTML = '<div class="cf-tarjeta"><p class="cf-texto">Cada empresa recibe un paquete según su régimen: <b>persona física y RESICO al flujo</b> (cobrado y pagado); ' +
                "<b>persona moral</b> con ISR devengado e IVA al flujo. Encima van las reglas de ley (efectivo de más de $2,000, combustible en efectivo, S01, 69-B, restaurantes al 8.5 %) " +
                "y las sugerencias de lo que no suele ser indispensable. Lo que marcas a mano con «¿siempre así?» se vuelve regla de esa empresa.</p></div>" +
                '<div class="cf-tarjeta cf-tarjeta--tabla" style="margin-top:12px"><table class="cf-tabla"><thead><tr><th>Empresa</th><th>Paquete</th><th>ISR · IVA</th><th>Estatales</th><th>Aprendidas</th><th></th></tr></thead><tbody>' +
                (lista.length ? lista.map(function (x) {
                    return "<tr><td><b>" + esc(x.nombre) + "</b><small>" + esc(x.rfc) + (x.regimen ? " · régimen " + esc(x.regimen) : "") + "</small></td>" +
                        "<td>" + esc(x.paquete) + (x.personalizada ? ' <small>con ajustes</small>' : "") + "</td>" +
                        "<td>" + mom(x.momento.isr) + " · " + mom(x.momento.iva) + "</td>" +
                        "<td>" + ([x.prof ? "Profesiones" : "", x.alc ? "Alcohol" : ""].filter(Boolean).join(", ") || "—") + "</td>" +
                        "<td>" + (x.aprendidas || "—") + "</td>" +
                        '<td><a class="cf-btn cf-btn--chico" href="/herramientas/xml/fiscal.html?rfc=' + encodeURIComponent(x.rfc) + '&config=1">Ver y cambiar</a></td></tr>';
                }).join("") : '<tr><td colspan="6">Registra tus empresas en Clientes.</td></tr>') + "</tbody></table></div>";
        } catch (e) { c.innerHTML = '<div class="cf-tarjeta"><p class="cf-msj cf-msj--mal">' + esc(e.message) + "</p></div>"; }
    }

    async function pintarXmlAuto(c) {
        c.innerHTML = '<div class="cf-tarjeta"><p class="cf-texto">Cargando…</p></div>';
        try {
            var cfg = await api("/api/descarga-xml/automatica");
            var clientes = await api("/api/clientes");
            var nombre = {}; clientes.forEach(function (x) { nombre[x.rfc] = x.alias; });
            var porRfc = {}; cfg.empresas.forEach(function (e) { porRfc[e.rfc] = e; });
            var opc = function (mapa, v) { return Object.keys(mapa).map(function (k) { return '<option value="' + k + '"' + (k === v ? " selected" : "") + ">" + esc(mapa[k]) + "</option>"; }).join(""); };
            c.innerHTML = '<div class="cf-tarjeta cf-tarjeta--tabla"><table class="cf-tabla"><thead><tr><th>Empresa</th><th>Automática</th><th>Qué</th><th>Retenciones</th><th>Cada cuánto</th><th>Desde</th><th></th></tr></thead><tbody>' +
                clientes.map(function (x) {
                    var e = porRfc[x.rfc] || { activo: false, tipo: "ambos", frecuencia: "diaria" };
                    return '<tr data-rfc="' + esc(x.rfc) + '"><td><b>' + esc(x.alias) + "</b><small>" + esc(x.rfc) + (x.efirma_guardada ? "" : " · sin e.firma") + "</small></td>" +
                        '<td><label class="cf-switch"><input type="checkbox" data-c="activo"' + (e.activo ? " checked" : "") + (x.efirma_guardada ? "" : " disabled") + "><span></span></label></td>" +
                        '<td><select data-c="tipo">' + opc(cfg.tipos, e.tipo) + "</select></td>" +
                        '<td><label class="cf-switch" title="También sus CFDI de Retenciones"><input type="checkbox" data-c="retenciones"' + (e.retenciones ? " checked" : "") + "><span></span></label></td>" +
                        "<td><select data-c=\"frecuencia\">" + opc(cfg.frecuencias, e.frecuencia) + "</select></td>" +
                        '<td><select data-c="desde">' + Fiscontable.opcionesDesde(cfg.desde_minimo, cfg.mes_actual, e.desde || "") + "</select></td>" +
                        '<td><button type="button" class="cf-btn cf-btn--chico" data-guardar>Guardar</button></td></tr>';
                }).join("") + "</tbody></table><div class=\"cf-acciones\"><span class=\"cf-msj\"></span></div></div>";
            c.querySelectorAll("[data-guardar]").forEach(function (b) {
                b.addEventListener("click", async function () {
                    var fila = b.closest("tr"), val = function (k) { var el = fila.querySelector('[data-c="' + k + '"]'); return el.type === "checkbox" ? el.checked : el.value; };
                    try {
                        await enviar("/api/descarga-xml/automatica/" + encodeURIComponent(fila.dataset.rfc), "PUT", { activo: val("activo"), tipo: val("tipo"), frecuencia: val("frecuencia"), desde: val("desde") || null, retenciones: val("retenciones") });
                        aviso(c, true, "✓ " + (nombre[fila.dataset.rfc] || fila.dataset.rfc) + " guardada.");
                    } catch (e) { aviso(c, false, e.message); }
                });
            });
        } catch (e) { c.innerHTML = '<div class="cf-tarjeta"><p class="cf-msj cf-msj--mal">' + esc(e.message) + "</p></div>"; }
    }

    async function iniciar() {
        if (incrustado) document.body.classList.add("cf-incrustado");
        // «Listo» de una sección abierta adentro (Facturar, Administración): si esta página está en la ventana de un
        // módulo, la cierra; si es la página completa, solo confirma.
        window.addEventListener("message", function (ev) {
            if (ev.origin !== location.origin || !ev.data || ev.source === window) return;
            // Una sección que vive en un marco (Administración) cambió de pestaña: se guarda en la dirección para que
            // al recargar se vuelva a esa misma pestaña
            if (ev.data.fiscontable === "config-sub" && !incrustado && typeof ev.data.sub === "string" && /^[a-z0-9_-]{1,30}$/.test(ev.data.sub)) {
                Fiscontable.url({ sub: ev.data.sub }); return;
            }
            if (ev.data.fiscontable !== "config-listo") return;
            if (incrustado) listo();
        });
        try { perfil = await api("/api/mi-perfil"); }
        catch (e) { $("cf-cuerpo").innerHTML = '<p class="cf-msj cf-msj--mal">' + esc(e.message) + "</p>"; return; }
        menu = Fiscontable.riel($("cf-menu"), {
            id: "ajustes", cabeza: '<h1 class="cf-menu__titulo">Configuración</h1>', vacio: "Nada coincide.",
            buscar: { campo: true, texto: "Buscar un ajuste", alEscribir: function (texto) {
                pintarMenu();
                var primero = $("cf-menu").querySelector("[data-riel]");
                if (primero && texto.trim()) abrir(primero.dataset.riel);
            } },
            alElegir: function (id) { abrir(id); }
        });
        abrir(Fiscontable.url("seccion") || "perfil", Fiscontable.url("sub"));
    }

    iniciar();
})();