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
        equipo: "M17 20h5v-2a3 3 0 00-5.4-1.8M17 20H7m10 0v-2c0-.7-.1-1.3-.4-1.8M7 20H2v-2a3 3 0 015.4-1.8M7 20v-2c0-.7.1-1.3.4-1.8m0 0a5 5 0 019.2 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
        tabla: "M4 5h16v14H4zM4 10h16M10 10v9M16 10v9"
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
        // 20-nov-2026, el dueño: cómo se llaman los archivos (configuracion/nombres-archivo.js; en el despacho, los pone el titular)
        { id: "nombres", grupo: "Tu cuenta", titulo: "Nombres de archivo", ico: ICO.factura,
          desc: "Cómo se llaman los XML, los PDF, los Excel y los ZIP que bajas o mandas en los envíos.",
          palabras: "nombres de archivo plantilla renombrar xml pdf excel zip paquete envío descarga serie folio uuid rfc periodo",
          pintar: function (c) { window.FcNombresArchivo.pintar(c, { api: api, enviar: enviar }); } },
        // 15-nov, el dueño: «solo una sección para eso»: XML automáticos, revisión del Buzón y lo programado, todo aquí. Lo que
        // aparezca en otro módulo (el botón «Automática» de Descarga XML, «Ver todas»…) trae a esta sección.
        { id: "automatico", grupo: "Tu cuenta", titulo: "Lo automático", ico: ICO.reloj,
          desc: "Todo lo que Fiscontable hace solo por tus empresas: sus XML y retenciones de madrugada, la revisión del Buzón y lo programado (constancias, opiniones, declaraciones).",
          palabras: "automatico automatica automáticos programar programaciones programado madrugada constancia opinión declaraciones xml descarga masiva retenciones buzón tributario revisión frecuencia validación listas bajar solos",
          pintar: pintarAutomatico },
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
        { id: "impuestos", grupo: "Módulos", titulo: "Impuestos por empresa", ico: ICO.balanza, modulo: "marcas",
          desc: "Cuándo cuenta cada impuesto (flujo o devengado), estatales, alcohol y las reglas que Fiscontable aprendió de cada empresa.",
          palabras: "impuestos reglas fiscales isr iva diot deducible no deducible flujo devengado cobrado facturado profesiones alcohol régimen paquete marcas",
          pintar: pintarImpuestos },
        // 20-nov-2026, el dueño: el «formato del despacho» del Excel · reporte completo (Recibidos y Emitidos). Lo define el titular
        // una vez y sale así para todos y en los Envíos por correo; los integrantes lo ven sin poder cambiarlo.
        { id: "formato_reportes", grupo: "Módulos", titulo: "Formato de los reportes", ico: ICO.tabla, modulo: "validador",
          desc: "Qué columnas y en qué orden lleva el «Excel · reporte completo» de Recibidos y Emitidos, también en los envíos por correo.",
          palabras: "formato reporte completo excel columnas orden recibidos emitidos administración xml despacho envíos plantilla fiscontable",
          pintar: pintarFormatoReportes },
        { id: "fabrica", grupo: "Administración", titulo: "Valores de fábrica", ico: ICO.admin, solo_admin: true,
          desc: "Lo que les sale por defecto a todas las cuentas (correos, horario, lo automático, bloqueo) y lo que no pueden cambiar.",
          palabras: "valores de fábrica por defecto predeterminados ajustes correos horario automático madrugada bloqueo bloquear", pintar: pintarFabrica },
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
    // Lo que antes tenía su propia sección y ahora vive en «Lo automático» (los enlaces viejos siguen sirviendo)
    var MUDADAS = { programaciones: ["automatico", "programado"], buzon: ["automatico", "buzon"], descarga_xml: ["automatico", "xml"] };

    function abrir(id, sub) {
        if (id === "perfil" && (sub === "pin" || sub === "olvide" || sub === "seguridad")) id = "seguridad";   // antes vivían en Mi perfil
        if (MUDADAS[id]) { sub = MUDADAS[id][1]; id = MUDADAS[id][0]; }
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
            // 22-nov-2026 (barrido de botones): el servidor aceptaba «12ab» como teléfono; aquí se dice qué está mal y dónde
            var tel = $("cf-telefono").value.trim();
            if (!$("cf-nombre").value.trim()) { aviso(c, false, "Escribe tu nombre."); $("cf-nombre").focus(); return; }
            if (tel && (!/^\+?[\d\s().-]+$/.test(tel) || tel.replace(/\D/g, "").length < 10)) {
                aviso(c, false, "Revisa el teléfono: escribe 10 dígitos (puede llevar espacios o guiones)."); $("cf-telefono").focus(); return;
            }
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
            }
            return;
        }
        // Vista normal: el tiempo se guarda al elegirlo; cambiar, quitar o crear el PIN abre sus campos solo al pedirlo
        var campoPin = function (id, etiqueta, nuevo) {
            return '<label class="cf-campo"><span>' + etiqueta + '</span><input id="' + id + '" type="password" inputmode="numeric" maxlength="6" autocomplete="' +
                (nuevo ? "new-password" : "off") + '"></label>';
        };
        caja.innerHTML = cabeza +
            '<div class="cf-campos"><label class="cf-campo"><span>Bloquear después de</span><select id="cf-bl-min"' + (b.minutos_bloqueado ? " disabled" : "") + ">" +
            [5, 10, 15, 20, 30, 45, 60].concat([5, 10, 15, 20, 30, 45, 60].indexOf(b.minutos) < 0 ? [b.minutos] : []).sort(function (x, y) { return x - y; })
                .map(function (m) { return '<option value="' + m + '"' + (m === b.minutos ? " selected" : "") + ">" + m + " minutos sin uso</option>"; }).join("") +
            "</select></label></div>" + (b.minutos_bloqueado ? '<p class="cf-texto">Los minutos de bloqueo los define Fiscontable.</p>' : "") +
            '<div class="cf-acciones" id="cf-bl-botones">' + (b.tiene_pin
                ? '<button type="button" class="cf-btn" data-bl="cambiar">Cambiar PIN</button>' +
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
            (pc ? "<dt>Empresas</dt><dd>" + pc.empresas_usadas + " de " + pc.empresas + (pc.ambito === "despacho" ? " <small>(entre todo el despacho)</small>" : "") + "</dd>" +
                (Number(pc.timbres) > 0 ? "<dt>" + (pc.timbres_periodo === "anio" ? "Timbres incluidos al año" : "Timbres al mes") + "</dt><dd>" + pc.timbres + "</dd>" : "") : "") +
            "<dt>Vigencia</dt><dd>" + esc(vence) + "</dd><dt>Módulos</dt><dd>" + esc(String((perfil.modulos_permitidos || []).length)) + " activos</dd></dl>" +
            '<a class="cf-btn cf-btn--principal" href="/creditos/"' + (incrustado ? ' target="_top"' : "") + ">Ver y recargar créditos</a></div>";
        if (cat && cat.planes && cat.planes.length) {
            var tarjeta = function (p) {
                var actual = pc && pc.clave === p.clave, pronto = !!p.proximamente;
                return '<div class="cf-plan' + (p.destacado ? " cf-plan--destacado" : "") + (actual ? " cf-plan--actual" : "") + '">' +
                    (actual ? '<span class="cf-plan__marca">Tu plan</span>' : pronto ? '<span class="cf-plan__marca">Próximamente</span>' : p.destacado ? '<span class="cf-plan__marca">Recomendado</span>' : "") +
                    "<h4>" + esc(p.nombre) + "</h4><small>" + esc(p.para || "") + "</small>" +
                    (p.cobro === "anual" ? '<p class="cf-plan__precio"><b>' + precio(p.precio_con_iva || p.precio) + "</b> al año por licencia</p>" +
                          '<p class="cf-plan__anual">' + (p.precio_con_iva ? "IVA incluido" : "más IVA") + (p.ambito === "despacho" && cat.despacho_minimo ? " · desde " + cat.despacho_minimo + " licencias" : "") + "</p>"
                        : '<p class="cf-plan__precio"><b>' + precio(p.precio) + "</b> al mes</p>" +
                          '<p class="cf-plan__anual">o ' + precio(p.precio_anual) + " al año" + (cat.meses_gratis_anual ? " (" + cat.meses_gratis_anual + " meses gratis)" : "") + "</p>") +
                    "<ul><li><b>" + p.empresas + "</b> empresas (RFC)" + (p.ambito === "despacho" ? " entre todo el despacho" : "") + "</li>" +
                    (Number(p.timbres) > 0 ? "<li><b>" + Number(p.timbres).toLocaleString("es-MX") + "</b> timbres " + (p.timbres_periodo === "anio" ? "al año" : "al mes") + "</li>" : "") + "</ul>" +
                    (actual || pronto ? "" : '<div class="cf-plan__acciones">' + quiero("Hola, me interesa el plan " + p.nombre + " de Fiscontable (" + (perfil.persona || perfil.correo || "") + ").") + "</div>") + "</div>";
            };
            var niveles = cat.niveles || {}, orden = Object.keys(niveles).length ? Object.keys(niveles) : [""];
            html += '<h3 class="cf-subtitulo">Planes</h3><p class="cf-texto">Una licencia por persona, válida 12 meses desde que se activa. Precios en pesos mexicanos.</p>';
            orden.forEach(function (nv) {
                var lista = cat.planes.filter(function (p) { return (!nv || (p.nivel || p.rol) === nv) && !p.proximamente && (!p.oculto || (pc && pc.clave === p.clave)); });   // lo que aún no se vende, o se vende por cotización, no se muestra (salvo que sea el tuyo)
                if (!lista.length) return;
                var info = niveles[nv];
                if (info) html += '<h4 class="cf-plan-nivel">' + esc(info.nombre) + " <small>" + esc(info.resumen || "") + "</small></h4>" +
                    (info.incluye && info.incluye.length ? '<p class="cf-texto cf-plan-incluye">' + info.incluye.map(esc).join(" · ") + ".</p>" : "");
                html += '<div class="cf-planes">' + lista.map(tarjeta).join("") + "</div>";
            });
            if (cat.despacho_minimo) html += '<p class="cf-texto cf-plan-incluye"><b>Despacho:</b> desde ' + cat.despacho_minimo + " licencias; todo el equipo trabaja sobre las mismas empresas, cada quien con sus permisos.</p>";
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
        var inv = !perfil.viendo_como && perfil.despacho && perfil.despacho.invitacion;
        if (inv) {
            texto = "Tienes una invitación pendiente al despacho «" + inv.despacho + "». Al aceptarla, tu acceso lo da la licencia del despacho. " + texto;
        } else if (e.etapa === "gracia") {
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

    /* Sub-pestañas de una sección (regla: nada de listas infinitas hacia abajo; una caja por tema). Toma las tarjetas
       que son hijas directas de c, en orden, y deja ver una a la vez. Recuerda la elegida en esta pestaña del navegador. */
    function subPestanas(c, nombres, llave) {
        var cajas = [].filter.call(c.children, function (x) { return x.classList.contains("cf-tarjeta"); });
        if (cajas.length < 2) return;
        var barra = document.createElement("div");
        barra.className = "cf-subtabs"; barra.setAttribute("role", "tablist");
        barra.innerHTML = cajas.map(function (_, i) { return '<button type="button" role="tab" data-sub="' + i + '">' + esc(nombres[i] || ("Parte " + (i + 1))) + "</button>"; }).join("");
        c.insertBefore(barra, cajas[0]);
        var elegir = function (i) {
            cajas.forEach(function (x, j) {
                x.hidden = j !== i; x.style.marginTop = "0";
                var h = x.querySelector(":scope > h3.cf-sub");          // el nombre ya está en la pestaña: no se repite
                if (h) h.hidden = true;
            });
            [].forEach.call(barra.children, function (b, j) { b.setAttribute("aria-selected", String(j === i)); });
            try { sessionStorage.setItem("cf-sub:" + llave, String(i)); } catch (e) { /* nada */ }
        };
        barra.addEventListener("click", function (e) { var b = e.target.closest("[data-sub]"); if (b) elegir(+b.dataset.sub); });
        var guardada = 0;
        try { guardada = +(sessionStorage.getItem("cf-sub:" + llave) || 0); } catch (e) { /* nada */ }
        elegir(guardada < cajas.length ? guardada : 0);
    }

    /* ---------- Valores de fábrica (administrador, 15-nov): lo que les sale por defecto a todos y lo que no pueden cambiar ---------- */
    async function pintarFabrica(c) {
        c.innerHTML = '<div class="cf-tarjeta"><p class="cf-texto">Cargando…</p></div>';
        try {
            var d = await api("/api/admin/fabrica");
            var control = function (a) {
                var id = "fb-" + a.clave.replace(/\./g, "-");
                if (a.tipo === "bool") return '<label class="ui-check cf-check"><input type="checkbox" id="' + id + '" data-fb="' + esc(a.clave) + '"' + (a.valor ? " checked" : "") + "> " + esc(a.titulo) + "</label>";
                var campo;
                if (a.tipo === "semana") {
                    return '<div class="cf-campo"><span>' + esc(a.titulo) + '</span><div class="cf-semana" id="' + id + '" data-fb="' + esc(a.clave) + '" data-fb-tipo="semana">' +
                        ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(function (n, i) {
                            return '<label class="ui-check"><input type="checkbox" value="' + i + '"' + ((a.valor || []).indexOf(i) >= 0 ? " checked" : "") + "> " + n + "</label>"; }).join("") + "</div></div>";
                }
                if (a.tipo === "casillas") {
                    return '<div class="cf-campo"><span>' + esc(a.titulo) + '</span><div class="cf-casillas" id="' + id + '" data-fb="' + esc(a.clave) + '" data-fb-tipo="casillas">' +
                        (a.opciones || []).map(function (o) {
                            return '<label class="ui-check"><input type="checkbox" value="' + esc(o.valor) + '"' + ((a.valor || []).indexOf(o.valor) >= 0 ? " checked" : "") + "> " + esc(o.texto) + "</label>"; }).join("") + "</div></div>";
                }
                if (a.tipo.indexOf("lista:") === 0) campo = '<input type="text" inputmode="numeric" id="' + id + '" data-fb="' + esc(a.clave) + '" data-fb-tipo="lista" value="' + esc((a.valor || []).join(", ")) + '">';
                else if (a.tipo === "hora") campo = '<input type="time" id="' + id + '" data-fb="' + esc(a.clave) + '" value="' + esc(a.valor) + '">';
                else if (a.tipo.indexOf("entero:") === 0) { var lim = a.tipo.split(":"); campo = '<input type="number" id="' + id + '" data-fb="' + esc(a.clave) + '" min="' + lim[1] + '" max="' + lim[2] + '" value="' + esc(a.valor) + '">'; }
                else campo = '<select id="' + id + '" data-fb="' + esc(a.clave) + '">' + a.tipo.split(":")[1].split(",").map(function (o) {
                    return '<option value="' + esc(o) + '"' + (o === a.valor ? " selected" : "") + ">" + esc({ ambos: "Emitidos y recibidos", recibidos: "Solo recibidos", emitidos: "Solo emitidos",
                        diaria: "Cada madrugada", semanal: "Cada semana", mensual: "Cada mes", quincenal: "Cada 15 días" }[o] || (o.charAt(0).toUpperCase() + o.slice(1))) + "</option>"; }).join("") + "</select>";
                return '<label class="cf-campo cf-campo--corto"><span>' + esc(a.titulo) + "</span>" + campo + "</label>";
            };
            c.innerHTML = '<p class="cf-texto cf-fabrica__intro">Quien no lo ha cambiado sigue lo de aquí, aunque lo cambies después. ' +
                "Marca «No lo pueden cambiar» para que nadie lo mueva en su cuenta.</p>" +
                d.grupos.map(function (g) {
                    return '<div class="cf-tarjeta">' + d.ajustes.filter(function (a) { return a.grupo === g; }).map(function (a) {
                        return '<div class="cf-fabrica' + (a.grupo === "Cuándo salen los correos" ? " cf-fabrica--detalle" : "") + '" data-fb-caja="' + esc(a.clave) + '"><div class="cf-fabrica__valor">' + control(a) + (a.ayuda ? '<small class="cf-fabrica__ayuda">' + esc(a.ayuda) + "</small>" : "") + "</div>" +
                            (a.global ? '<span class="cf-fabrica__fijo cf-fabrica__todas">Aplica a todas las cuentas</span>' :
                            '<label class="ui-check cf-fabrica__fijo"><input type="checkbox" data-fb-fijo="' + esc(a.clave) + '"' + (a.bloqueado ? " checked" : "") + "> No lo pueden cambiar</label>") + "</div>";
                    }).join("") +
                    '<div class="cf-acciones"><button type="button" class="cf-btn cf-btn--principal" data-fb-guardar>Guardar los valores de fábrica</button><span class="cf-msj"></span></div></div>';
                }).join("");
            // Lo programado (constancia, opinión y declaraciones) vive en «Lo automático» con una sola regla para todos (15-nov)
            subPestanas(c, d.grupos.map(function (g) { return { "Cuándo salen los correos": "Cuándo salen", "Horario de los correos": "Horario" }[g] || g; }), "fabrica");
            // Desde Ctrl+K (?seccion=fabrica&sub=<clave>): abre su pestaña y lo señala
            var pedido = Fiscontable.url("sub"), cajaPedida = pedido && c.querySelector('[data-fb-caja="' + pedido.replace(/"/g, "") + '"]');
            if (cajaPedida) {
                var tarjeta = cajaPedida.closest(".cf-tarjeta"), tarjetas = [].filter.call(c.children, function (x) { return x.classList.contains("cf-tarjeta"); });
                var boton = c.querySelector('.cf-subtabs [data-sub="' + tarjetas.indexOf(tarjeta) + '"]');
                if (boton) boton.click();
                cajaPedida.classList.add("cf-fabrica--senalada");
                setTimeout(function () { cajaPedida.scrollIntoView({ block: "center", behavior: "smooth" }); var x = cajaPedida.querySelector("input, select"); if (x) x.focus({ preventScroll: true }); }, 60);
            }
            c.querySelectorAll("[data-fb-guardar]").forEach(function (b) { b.addEventListener("click", async function () {
                var caja = b.closest(".cf-tarjeta");
                var cambios = {};
                c.querySelectorAll("[data-fb]").forEach(function (x) {
                    var v = x.dataset.fbTipo === "semana" ? [].map.call(x.querySelectorAll("input:checked"), function (y) { return +y.value; }) :
                        x.dataset.fbTipo === "casillas" ? [].map.call(x.querySelectorAll("input:checked"), function (y) { return y.value; }) :
                        x.dataset.fbTipo === "lista" ? x.value.split(/[\s,;]+/).filter(Boolean).map(Number) :
                        x.type === "checkbox" ? x.checked : (x.type === "number" ? +x.value : x.value);
                    cambios[x.dataset.fb] = { valor: v };
                });
                c.querySelectorAll("[data-fb-fijo]").forEach(function (x) { (cambios[x.dataset.fbFijo] = cambios[x.dataset.fbFijo] || {}).bloqueado = x.checked; });
                try { await enviar("/api/admin/fabrica", "PUT", { cambios: cambios }); aviso(caja, true, "✓ Guardado. Ya aplica a todas las cuentas que no lo habían cambiado."); }
                catch (e) { aviso(caja, false, e.message); }
            }); });
        } catch (e) { c.innerHTML = '<div class="cf-tarjeta"><p class="cf-msj cf-msj--mal">' + esc(e.message) + "</p></div>"; }
    }

    /* ---------- Avisos (G-13 / G-14): qué llega por correo ---------- */
    async function pintarAvisos(c) {
        c.innerHTML = '<div class="cf-tarjeta"><p class="cf-texto">Cargando…</p></div>';
        try {
            var p = await api("/api/actividad/preferencias");
            // Los 9 correos por tema (diseño del 14-nov): cada uno con su «cuándo»; los de fecha se pueden probar
            var temas = p.por_tema || Object.keys(p.tipos), conFecha = p.con_fecha || [], cuando = p.cuando || {};
            var otros = Object.keys(p.tipos).filter(function (t) { return temas.indexOf(t) < 0; });
            var bloq = p.bloqueados || [], fijo = function (clave) { return bloq.indexOf(clave) >= 0; };
            // 15-nov (el dueño): apagar un correo siempre se puede; lo que Fiscontable apagó y bloqueó no se puede prender
            var noPrende = p.no_se_prenden || [];
            var renglon = function (t) {
                var fx = fijo("correo." + t), cerrado = noPrende.indexOf(t) >= 0;
                return '<div class="cf-tema"><label class="ui-check cf-tema__check"><input type="checkbox" data-tipo="' + esc(t) + '"' + (p.correo[t] ? " checked" : "") + (cerrado ? " disabled" : "") + ">" +
                    '<span><b>' + esc(p.tipos[t]) + '</b><small>' + esc(cuando[t] || "Al momento") + (cerrado ? " · Apagado por Fiscontable" : fx ? " · Sus fechas las define Fiscontable" : "") + "</small></span></label></div>";
            };
            var probar = conFecha.filter(function (t) { return p.tipos[t]; });
            var h = p.horario || {};
            var hcampo = function (k, html) { return fijo("horario." + k) ? html.replace("<input", "<input disabled") : html; };
            var cajaHorario = '<div class="cf-tarjeta" style="margin-top:14px"><h3 class="cf-sub">Horario de los correos</h3>' +
                '<p class="cf-texto">Lo que pase de noche (revisiones de la madrugada) sale a la hora de inicio. La campana se marca al momento.</p>' +
                '<div class="cf-campos cf-horario">' +
                hcampo("inicio", '<label class="cf-campo"><span>Desde</span><input type="time" id="cf-h-inicio" value="' + esc(h.inicio || "08:00") + '"></label>') +
                hcampo("fin", '<label class="cf-campo"><span>Hasta</span><input type="time" id="cf-h-fin" value="' + esc(h.fin || "20:00") + '"></label>') + "</div>" +
                hcampo("sabado", '<label class="ui-check cf-check"><input type="checkbox" id="cf-h-sabado"' + (h.sabado ? " checked" : "") + "> También los sábados</label>") +
                hcampo("domingo", '<label class="ui-check cf-check"><input type="checkbox" id="cf-h-domingo"' + (h.domingo ? " checked" : "") + "> También los domingos</label>") +
                hcampo("urgentes", '<label class="ui-check cf-check"><input type="checkbox" id="cf-h-urgentes"' + (h.urgentes ? " checked" : "") +
                    "> Lo urgente sale al momento, a cualquier hora (notificación pendiente del Buzón, e.firma revocada)</label>") +
                (["inicio", "fin", "sabado", "domingo", "urgentes"].some(fijo) ? '<p class="cf-texto">Lo que está apagado lo define Fiscontable.</p>' : "") +
                '<div class="cf-acciones"><button type="button" class="cf-btn cf-btn--principal" id="cf-h-guardar">Guardar el horario</button><span class="cf-msj"></span></div></div>';
            c.innerHTML = '<div class="cf-tarjeta"><h3 class="cf-sub">Correos</h3>' +
                '<p class="cf-texto">Lo de cada empresa llega junto en su informe de la mañana; lo rápido, un correo por tema con todas tus empresas.</p>' +
                '<div class="cf-temas">' + temas.filter(function (t) { return p.tipos[t]; }).map(renglon).join("") + "</div>" +
                (otros.length ? '<details class="cf-otros"><summary>Otros avisos de la campana que también pueden ir por correo</summary>' +
                    '<div class="cf-temas">' + otros.map(renglon).join("") + "</div></details>" : "") +
                '<label class="cf-campo"><span>Avisar de e.firma y sellos por vencer cuando falten (días)</span><input type="text" id="cf-av-dias" inputmode="numeric" value="' +
                esc((p.dias_vence || []).join(", ")) + '"' + (fijo("vencimientos.dias") ? " disabled" : "") + "></label>" +
                '<p class="cf-texto">Un aviso por cada escalón. Si ya la renovaste, deja de avisar sola.' + (fijo("vencimientos.dias") ? " Estos días los define Fiscontable." : "") + "</p>" +
                '<label class="cf-campo"><span>Mandar los avisos a</span><input type="email" id="cf-av-destino" value="' + esc(p.destino || "") + '"></label>' +
                '<div class="cf-acciones"><button type="button" class="cf-btn cf-btn--principal" id="cf-av-guardar">Guardar</button>' +
                '<div class="cf-menu-prueba" id="cf-av-prueba-caja"><button type="button" class="cf-btn" id="cf-av-prueba-abrir" aria-haspopup="menu" aria-expanded="false">Mandar un correo de prueba ▾</button>' +
                '<div class="cf-menu-prueba__lista" role="menu"><button type="button" role="menuitem" id="cf-av-prueba"><b>Solo saber si me llegan</b><small>Un correo corto de prueba</small></button>' +
                probar.map(function (t) { return '<button type="button" role="menuitem" data-probar="' + esc(t) + '"><b>' + esc(p.tipos[t]) + "</b><small>Con lo de hoy, aunque no le toque</small></button>"; }).join("") +
                '</div></div><span class="cf-msj"></span></div>' +
                '<p class="cf-texto" style="margin-top:12px">Los correos salen por el mismo correo que usas en Facturar (el general de Fiscontable o el tuyo).</p></div>' +
                cajaHorario +
                '<div class="cf-tarjeta" id="cf-av-caja-quien" style="margin-top:14px"><h3 class="cf-sub">¿A quién más le llegan?</h3>' +
                '<p class="cf-texto">Además del correo de arriba. Nadie recibe datos de empresas o módulos que no puede ver en Fiscontable.</p>' +
                '<label class="cf-campo"><span>Copias (separa con comas)</span><input type="text" id="cf-av-copias" inputmode="email" autocomplete="off" placeholder="avisos@tudespacho.mx, socio@tudespacho.mx" value="' +
                esc((p.copias || []).join(", ")) + '"></label>' +
                (p.es_despacho ? '<label class="ui-check cf-check"><input type="checkbox" id="cf-av-responsables"' + (p.responsables ? " checked" : "") +
                    "> El aviso de una empresa, también a la persona que la tiene asignada</label>" : "") +
                '<label class="ui-check cf-check"><input type="checkbox" id="cf-av-cliente"' + (p.cliente ? " checked" : "") +
                    "> El informe de cada empresa, también a su cliente (el correo de su ficha)</label>" +
                '<label class="ui-check cf-check"><input type="checkbox" id="cf-av-importes"' + (p.importes ? " checked" : "") +
                    "> Poner importes en los correos (de fábrica, sin importes)</label>" +
                (p.puede_destinatarios ? '<div class="cf-acciones"><button type="button" class="cf-btn cf-btn--principal" id="cf-av-quien-guardar">Guardar</button><span class="cf-msj"></span></div>'
                    : '<p class="cf-texto">Solo el titular del despacho puede cambiar esto.</p>') + "</div>" +
                '<div class="cf-tarjeta" id="cf-av-caja-resumen" style="margin-top:14px"><h3 class="cf-sub">Resumen completo (opcional)</h3>' +
                '<p class="cf-texto">Si además quieres todo junto en un solo correo: cómo va tu cartera: el cierre del mes, lo que pasó y lo que está por vencer. ' +
                "Por empresa: notificaciones del Buzón, CFDI cancelados o con error, proveedores en listas del SAT, PPD sin complemento y trámites que no salieron. No lleva archivos.</p>" +
                '<div class="ctx-segmento cf-segmento" role="group" aria-label="Cada cuándo llega el resumen" id="cf-av-resumen">' +
                Object.keys(p.frecuencias_resumen || {}).map(function (f) {
                    return '<button type="button" data-resumen="' + esc(f) + '" aria-pressed="' + ((p.resumen || "") === f) + '">' + esc(p.frecuencias_resumen[f]) + "</button>";
                }).join("") + "</div>" +
                (p.equipo_resumen > 1 ? '<label class="ui-check cf-check"><input type="checkbox" id="cf-av-resumen-copia"' + (p.resumen_copia ? " checked" : "") +
                    "> Que cada persona de mi despacho reciba el de sus empresas (" + p.equipo_resumen + " personas)</label>" : "") +
                '<div class="cf-acciones"><button type="button" class="cf-btn" id="cf-av-resumen-ya">Mándame uno ahora</button><span class="cf-msj"></span></div></div>';
            subPestanas(c, ["Correos", "Horario", "A quién llegan", "Resumen completo"], "avisos");
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
            [["responsables", "cf-av-responsables"], ["cliente", "cf-av-cliente"], ["importes", "cf-av-importes"]].forEach(function (x) {
                if (fijo("correo." + x[0]) && $(x[1])) { $(x[1]).disabled = true; $(x[1]).parentNode.title = "Lo define Fiscontable"; }
            });
            if ($("cf-av-quien-guardar")) $("cf-av-quien-guardar").addEventListener("click", async function () {
                var b = this; b.disabled = true;
                try {
                    var copias = $("cf-av-copias").value.split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
                    var cuerpo = { correo: guardado.correo, destino: guardado.destino || null, dias_vence: guardado.dias_vence, copias: copias,
                                   cliente: $("cf-av-cliente").checked, importes: $("cf-av-importes").checked };
                    if ($("cf-av-cliente").disabled) delete cuerpo.cliente;
                    if ($("cf-av-importes").disabled) delete cuerpo.importes;
                    if ($("cf-av-responsables")) cuerpo.responsables = $("cf-av-responsables").checked;
                    guardado = await enviar("/api/actividad/preferencias", "PUT", cuerpo);
                    $("cf-av-copias").value = (guardado.copias || []).join(", ");
                    aviso(cajaQuien, true, "✓ Guardado." + (guardado.copias && guardado.copias.length ? " Copia a " + guardado.copias.length + " correo(s)." : ""));
                } catch (er) { aviso(cajaQuien, false, er.message); }
                finally { b.disabled = false; }
            });
            $("cf-av-resumen-ya").addEventListener("click", async function () {
                var b = this; b.disabled = true; aviso(cajaResumen, true, "Armándolo…");
                try { var r = await enviar("/api/actividad/resumen-ahora", "POST", {}); aviso(cajaResumen, true, r.mensaje || ("✓ Enviado a " + r.destino + ".")); }
                catch (er) { aviso(cajaResumen, false, er.message); }
                finally { b.disabled = false; }
            });
            $("cf-h-guardar").addEventListener("click", async function () {
                var caja = this.closest(".cf-tarjeta"), horario = {};
                [["inicio", "value"], ["fin", "value"], ["sabado", "checked"], ["domingo", "checked"], ["urgentes", "checked"]].forEach(function (x) {
                    var el = $("cf-h-" + x[0]); if (el && !el.disabled) horario[x[0]] = el[x[1]];
                });
                try {
                    guardado = await enviar("/api/actividad/preferencias", "PUT", { correo: guardado.correo, destino: guardado.destino || null, dias_vence: guardado.dias_vence, horario: horario });
                    aviso(caja, true, "✓ Guardado. Los correos salen de " + guardado.horario.inicio + " a " + guardado.horario.fin + ".");
                } catch (e) { aviso(caja, false, e.message); }
            });
            c.querySelectorAll("[data-probar]").forEach(function (b) {
                b.addEventListener("click", async function () {
                    b.disabled = true;
                    try { var r = await enviar("/api/actividad/tema-ahora", "POST", { tema: b.dataset.probar }); aviso(c, true, r.mensaje); }
                    catch (e) { aviso(c, false, e.message); }
                    finally { b.disabled = false; }
                });
            });
            $("cf-av-guardar").addEventListener("click", async function () {
                var correo = {};
                c.querySelectorAll("[data-tipo]").forEach(function (x) { correo[x.dataset.tipo] = x.checked; });
                var dias = $("cf-av-dias").value.split(/[^0-9]+/).map(Number).filter(function (n) { return n > 0 && n <= 365; });
                if (!dias.length) { aviso(c, false, "Escribe al menos un número de días (por ejemplo 30, 15, 5)."); return; }
                var destino = $("cf-av-destino").value.trim() || null;
                var cuerpo = { correo: correo, destino: destino, dias_vence: dias };
                try {
                    var g = null;
                    if ((destino || "").toLowerCase() !== (guardado.destino || "").toLowerCase()) {
                        // Cambiar a dónde llegan los avisos pide el PIN (14-nov)
                        var hecho = await Fiscontable.confirmarIdentidad("cambiar_correo_avisos", async function (conf) {
                            g = await enviar("/api/actividad/preferencias", "PUT", Object.assign({}, cuerpo, { confirmacion: conf }));
                        }, { titulo: "Cambiar el correo de los avisos", boton: "Cambiar",
                             resumen: '<p class="fc-identidad__aviso">Los avisos y los correos por tema van a llegar a <b>' + esc(destino || "tu correo de la cuenta") + "</b>.</p>" });
                        if (!hecho) return;
                    } else g = await enviar("/api/actividad/preferencias", "PUT", cuerpo);
                    guardado = g; $("cf-av-dias").value = (g.dias_vence || dias).join(", "); aviso(c, true, "✓ Guardado.");
                }
                catch (e) { aviso(c, false, e.message); }
            });
            // 22-nov-2026 (barrido de botones): los oyentes de abajo quedan en el documento al pasar a otra sección; sin esta
            // revisión, cada clic o Esc en Mi perfil, Seguridad… tronaba («Cannot read properties of null»)
            var cajaPrueba = $("cf-av-prueba-caja"), cerrarPrueba = function () {
                if (!cajaPrueba.isConnected) return;
                cajaPrueba.classList.remove("cf-menu-prueba--abierto"); var b = $("cf-av-prueba-abrir"); if (b) b.setAttribute("aria-expanded", "false");
            };
            $("cf-av-prueba-abrir").addEventListener("click", function () {
                var abierto = cajaPrueba.classList.toggle("cf-menu-prueba--abierto"); this.setAttribute("aria-expanded", String(abierto));
                cajaPrueba.classList.remove("cf-menu-prueba--arriba");
                var r = cajaPrueba.querySelector(".cf-menu-prueba__lista").getBoundingClientRect();
                if (abierto && r.bottom > document.documentElement.clientHeight - 8) cajaPrueba.classList.add("cf-menu-prueba--arriba");
            });
            cajaPrueba.addEventListener("click", function (e) { if (e.target.closest("[role=menuitem]")) cerrarPrueba(); });
            document.addEventListener("click", function (e) { if (!e.target.closest("#cf-av-prueba-caja")) cerrarPrueba(); });
            document.addEventListener("keydown", function (e) { if (e.key === "Escape") cerrarPrueba(); });
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
        // 15-nov (el dueño): una sola regla para todos (la pone el administrador en Valores de fábrica › Lo automático); aquí,
        // por empresa, solo encender o apagar y si se le manda al cliente. Ya no por documento ni con fechas propias.
        c.innerHTML = '<div class="cf-tarjeta"><p class="cf-texto">Cargando…</p></div>';
        try {
            var d = await api("/api/programacion"), nv = await api("/api/programacion-nuevas").catch(function () { return null; });
            var clientes = await api("/api/clientes").catch(function () { return []; });
            var fecha = function (iso) { return iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "—"; };
            var df = d.defecto || {}, dia = function (m, otro) { return String((df[m] || {}).dia || otro); };
            var DOCS = ["csf", "opinion", "declaraciones"], por = {};
            d.programaciones.forEach(function (x) { if (DOCS.indexOf(x.modulo) !== -1 && x.rfc) (por[x.rfc] = por[x.rfc] || []).push(x); });
            var filas = clientes.filter(function (x) { return x.efirma_guardada || por[x.rfc]; }).map(function (x) {
                var rs = por[x.rfc] || [], activa = rs.some(function (r) { return r.activa; });
                var prox = rs.filter(function (r) { return r.activa && r.proxima; }).map(function (r) { return r.proxima; }).sort()[0];
                var ult = rs.filter(function (r) { return r.ultima; }).sort(function (a, b) { return a.ultima < b.ultima ? 1 : -1; })[0];
                var mandable = rs.filter(function (r) { return r.mandar_cliente !== null && r.mandar_cliente !== undefined; });
                var mandar = mandable.some(function (r) { return r.mandar_cliente; }), correo = (mandable[0] || {}).correo_cliente || "";
                return '<tr data-rfc="' + esc(x.rfc) + '"' + (activa ? "" : ' class="cf-apagada"') + "><td><b>" + esc(x.alias || x.rfc) + "</b><small>" + esc(x.rfc) +
                    (x.efirma_guardada ? "" : " · sin e.firma") + "</small></td>" +
                    '<td><label class="cf-switch" title="Constancia, opinión y declaraciones"><input type="checkbox" data-prog-activa' + (activa ? " checked" : "") +
                    (x.efirma_guardada ? "" : " disabled") + "><span></span></label></td>" +
                    "<td>" + (mandable.length ? '<label class="ui-check" title="' + esc(correo ? "Se manda a " + correo : "Escribe el correo del cliente en su ficha para poder mandárselo") + '">' +
                        '<input type="checkbox" data-prog-mandar' + (mandar ? " checked" : "") + (correo || mandar ? "" : " disabled") + "> Constancia y opinión</label>" +
                        (correo ? "" : "<small>Sin correo del cliente</small>") : "—") + "</td>" +
                    "<td>" + (activa ? fecha(prox) : "—") + "</td><td>" + (ult ? fecha(ult.ultima) + (ult.resultado ? "<small>" + esc(ult.resultado) + "</small>" : "") : "—") + "</td></tr>";
            });
            c.innerHTML = '<div class="cf-tarjeta"><p class="cf-texto">Cada mes, de madrugada y con la e.firma de cada empresa: <b>constancia y opinión el día ' + esc(dia("csf", 1)) +
                "</b> y <b>declaraciones el día " + esc(dia("declaraciones", 20)) + "</b>. Las fechas las define Fiscontable; aquí eliges qué empresas y si se le manda a su cliente.</p>" +
                (nv ? '<label class="ui-check cf-nuevas"><input type="checkbox" id="cf-prog-nuevas"' + (nv.activa ? " checked" : "") + "> " +
                    "<span><b>Programar todas mis empresas con e.firma</b><small>Las nuevas entran solas. Si lo apagas, se quedan solo las que ya tienes encendidas.</small></span></label>" : "") +
                "</div>" +
                '<div class="cf-tarjeta cf-tarjeta--tabla" style="margin-top:12px"><table class="cf-tabla"><thead><tr><th>Empresa</th><th>Programado</th>' +
                '<th title="Le llega por correo al cliente cada vez que se descarga">Al cliente</th><th>Próxima</th><th>Última</th></tr></thead><tbody>' +
                (filas.length ? filas.join("") : '<tr><td colspan="5">Guarda la e.firma de tus empresas en Clientes y aquí salen programadas.</td></tr>') + "</tbody></table></div>" +
                '<p class="cf-msj"></p>';
            var chk = c.querySelector("#cf-prog-nuevas");
            if (chk) chk.addEventListener("change", async function () {
                try { await enviar("/api/programacion-nuevas", "PUT", { activa: chk.checked }); aviso(c, true, chk.checked ? "✓ Todas tus empresas con e.firma quedan programadas." : "✓ Las nuevas ya no entran solas."); pintarProgramaciones(c); }
                catch (x) { chk.checked = !chk.checked; aviso(c, false, x.message); }
            });
            c.onchange = async function (e) {
                var a = e.target.closest("[data-prog-activa]"), m = e.target.closest("[data-prog-mandar]");
                if (!a && !m) return;
                var el = a || m, rfc = el.closest("tr").dataset.rfc;
                el.disabled = true;
                try {
                    await enviar("/api/programacion/empresa/" + encodeURIComponent(rfc), "PUT", a ? { activa: a.checked } : { mandar_cliente: m.checked });
                    var msj = a ? (a.checked ? "✓ Programada." : "✓ Pausada: no se programa hasta que la vuelvas a encender.") :
                        (m.checked ? "✓ Se le mandará al cliente cada vez que se baje." : "✓ Ya no se le manda al cliente.");
                    if (a) await pintarProgramaciones(c);          // la fila cambia (próxima, apagada); el aviso, después
                    aviso(c, true, msj);
                } catch (x) { el.checked = !el.checked; aviso(c, false, x.message); }
                finally { el.disabled = false; }
            };
        } catch (e) { c.innerHTML = '<div class="cf-tarjeta"><p class="cf-msj cf-msj--mal">' + esc(e.message) + "</p></div>"; }
    }

    /* ---------- Lo automático (15-nov): XML y retenciones, Buzón y lo programado en una sola sección ---------- */
    function pintarAutomatico(c) {
        var mods = (perfil && perfil.modulos_permitidos) || [];
        var partes = [
            { clave: "xml", nombre: mods.indexOf("buzon") !== -1 ? "XML, retenciones y Buzón" : "XML y retenciones", si: mods.indexOf("descarga_xml") !== -1 || mods.indexOf("buzon") !== -1, pintar: pintarXmlAuto },
            { clave: "programado", nombre: "Lo programado", si: true, pintar: pintarProgramaciones }
        ].filter(function (p) { return p.si; });
        c.innerHTML = '<p class="cf-texto cf-auto__intro">Corre de madrugada con la e.firma guardada de cada empresa. Lo que se enciende solo al ' +
            "guardar una e.firma nueva lo verás aquí también.</p>" +
            '<div class="cf-auto__nosalio" hidden></div>' +
            partes.map(function (p) { return '<div class="cf-tarjeta cf-tarjeta--plana" data-auto-parte="' + p.clave + '"><div></div></div>'; }).join("");
        pintarNoSalio(c.querySelector(".cf-auto__nosalio"));
        partes.forEach(function (p) { p.pintar(c.querySelector('[data-auto-parte="' + p.clave + '"] > div')); });
        subPestanas(c, partes.map(function (p) { return p.nombre; }), "automatico");
        var pedido = Fiscontable.url("sub"), i = partes.map(function (p) { return p.clave; }).indexOf(pedido === "buzon" ? "xml" : pedido);   // el Buzón ya va en la tabla
        if (i >= 0) { var b = c.querySelector('.cf-subtabs [data-sub="' + i + '"]'); if (b) b.click(); }
        // «Cambiar/Programar» desde un módulo (?programar=csf&rfc=…): Lo programado, con esa empresa señalada. Ya no hay fecha
        // que elegir (15-nov): solo encender o pausar, y si se le manda al cliente.
        var pm = Fiscontable.url("programar"), prfc = Fiscontable.url("rfc");
        if (pm) {
            Fiscontable.url({ programar: null, rfc: null });
            var j = partes.map(function (p) { return p.clave; }).indexOf(pm === "buzon" || pm === "xml" ? "xml" : "programado");
            var bt = c.querySelector('.cf-subtabs [data-sub="' + j + '"]'); if (bt) bt.click();
            if (prfc) {
                var espera = setInterval(function () {
                    var fila = c.querySelector('[data-auto-parte] tr[data-rfc="' + prfc.replace(/"/g, "") + '"]');
                    if (!fila || !fila.offsetParent) return;
                    clearInterval(espera);
                    fila.classList.add("cf-fabrica--senalada"); fila.scrollIntoView({ block: "center" });
                }, 150);
                setTimeout(function () { clearInterval(espera); }, 8000);
            }
        }
    }

    /* 19-nov: «Reintentar lo que no salió» — lo de las madrugadas de la última semana que no salió (solo de esta cuenta) */
    async function pintarNoSalio(caja) {
        if (!caja) return;
        var d;
        try { d = await api("/api/programadas/no-salio"); } catch (e) { return; }
        if (!d || !d.total) { caja.hidden = true; return; }
        var que = Object.keys(d.por_modulo || {}).map(function (k) { return d.por_modulo[k] + " de " + k; }).join(", ");
        caja.innerHTML = '<div><b>' + d.total + (d.total === 1 ? " trámite de la madrugada no salió" : " trámites de la madrugada no salieron") + "</b>" +
            "<small>En la última semana" + (que ? ": " + esc(que) : "") + ". Se vuelven a programar en la madrugada que toca.</small></div>" +
            '<button type="button" class="cf-btn" data-reintentar>Reintentar lo que no salió</button>';
        caja.hidden = false;
        caja.querySelector("[data-reintentar]").addEventListener("click", async function (ev) {
            var b = ev.currentTarget; b.disabled = true;
            try {
                var r = await enviar("/api/programadas/reintentar", "POST", {});
                caja.innerHTML = '<div><b>✓ ' + esc(r.mensaje) + "</b><small>Lo verás en Descargas y aquí, en Lo programado.</small></div>";
            } catch (x) { b.disabled = false; aviso(caja.parentNode, false, x.message); }
        });
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
            var mods = (perfil && perfil.modulos_permitidos) || [], conXml = mods.indexOf("descarga_xml") !== -1, conBuzon = mods.indexOf("buzon") !== -1;
            var cfg = conXml ? await api("/api/descarga-xml/automatica") : { empresas: [], tipos: {}, frecuencias: {} };
            var clientes = await api("/api/clientes");
            // 15-nov (el dueño): el Buzón en esta misma lista; de fábrica, encendido en todas las empresas con e.firma
            var bz = conBuzon ? await api("/api/buzon").catch(function () { return null; }) : null, bzDe = {};
            ((bz && bz.empresas) || []).forEach(function (e) { bzDe[e.rfc] = e; });
            var nombre = {}; clientes.forEach(function (x) { nombre[x.rfc] = x.alias; });
            var porRfc = {}; cfg.empresas.forEach(function (e) { porRfc[e.rfc] = e; });
            var opc = function (mapa, v) { return Object.keys(mapa).map(function (k) { return '<option value="' + k + '"' + (k === v ? " selected" : "") + ">" + esc(mapa[k]) + "</option>"; }).join(""); };
            var dia = function (iso) { return iso ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" }) : ""; };
            // 15-nov (XML seguros): el cuadre UUID por UUID con la lista del SAT, mes por mes desde «Desde»
            var cuadre = function (e) {
                var q = e.cuadre;
                var expl = "Cuadre con la lista del SAT: cada semana (los meses viejos, cada mes) se compara UUID por UUID desde «Desde»; lo que falte se pide solo y los que pasen a cancelados se avisan.";
                if (!q) return '<small class="cf-auto__cuadre" title="' + esc(expl + " Empieza cuando terminen de bajar sus XML.") + '">Cuadre SAT: en espera</small>';
                var det = [expl, "Última revisión: " + (q.ultima ? dia(q.ultima) : "—")];
                if (q.faltaban) det.push("faltaban " + q.faltaban + (q.pedidos ? " (se pidieron " + q.pedidos + ")" : ""));
                // 19-nov: un mes cuenta cuando ya no espera XML; se vuelve a contar en cuanto termina de bajar lo que faltaba
                if (q.esperando) det.push(q.esperando + " mes(es) esperando los XML que faltaban" + (q.por_llegar ? " (" + q.por_llegar + " por llegar)" : "") + ": cuentan en cuanto terminen de bajar");
                if (q.cancelados_nuevos) det.push(q.cancelados_nuevos + " pasaron a cancelados");
                if (q.errores) det.push(q.errores + " mes(es) por volver a pedir");
                return '<small class="cf-auto__cuadre" data-cuadre title="' + esc(det.join(" · ")) + '">Cuadre SAT: ' + q.cuadrados + " de " + q.total + " meses" +
                    (q.cancelados_nuevos ? '<span class="cf-auto__cancelados">' + q.cancelados_nuevos + (q.cancelados_nuevos === 1 ? " cancelado" : " cancelados") + "</span>" : "") + "</small>";
            };
            // 19-nov: la primera vez se baja el historial desde «Desde» en varias noches (nunca a costa de lo del día)
            var historial = function (e) {
                var h = e.historial;
                if (!h) return "";
                return '<small class="cf-auto__historial" title="Lo de meses anteriores se baja de noche en noche, después de lo del día.">Cargando historial: ' +
                    h.hechos + " de " + h.total + " meses</small>";
            };
            var bzFrec = bz ? '<label class="cf-campo cf-campo--corto cf-auto__buzon"><span>Revisar los buzones</span><select id="cf-buzon-frec">' +
                Object.keys(bz.frecuencias).sort(function (a, b) { return (+a || 99) - (+b || 99); }).map(function (k) {
                    return '<option value="' + k + '"' + (+k === bz.frecuencia ? " selected" : "") + ">" + esc(bz.frecuencias[k]) + "</option>"; }).join("") + "</select></label>" : "";
            c.innerHTML = '<div class="cf-tarjeta cf-tarjeta--tabla">' + bzFrec + '<table class="cf-tabla cf-auto__tabla"><thead><tr><th>Empresa</th>' +
                (conXml ? "<th>XML</th><th>Qué</th><th>Retenciones</th><th>Cada cuánto</th><th>Desde</th><th>Próxima</th>" : "") +
                (conBuzon ? '<th title="Se guarda al momento">Buzón</th>' : "") + (conXml ? "<th></th>" : "") + "</tr></thead><tbody>" +
                clientes.map(function (x) {
                    var e = porRfc[x.rfc] || { activo: false, tipo: "ambos", frecuencia: "diaria" }, b = bzDe[x.rfc];
                    return '<tr data-rfc="' + esc(x.rfc) + '"><td><b>' + esc(x.alias) + "</b><small>" + esc(x.rfc) + (x.efirma_guardada ? "" : " · sin e.firma") + "</small></td>" +
                        (conXml ? '<td><label class="cf-switch"><input type="checkbox" data-c="activo"' + (e.activo ? " checked" : "") + (x.efirma_guardada ? "" : " disabled") + "><span></span></label></td>" +
                        '<td><select data-c="tipo">' + opc(cfg.tipos, e.tipo) + "</select></td>" +
                        '<td><label class="cf-switch" title="También sus CFDI de Retenciones"><input type="checkbox" data-c="retenciones"' + (e.retenciones ? " checked" : "") + "><span></span></label></td>" +
                        "<td><select data-c=\"frecuencia\">" + opc(cfg.frecuencias, e.frecuencia) + "</select></td>" +
                        '<td><select data-c="desde">' + Fiscontable.opcionesDesde(cfg.desde_minimo, cfg.mes_actual, e.desde || "") + "</select></td>" +
                        "<td>" + (e.activo && x.efirma_guardada ? "<b>" + esc(dia(e.proxima)) + "</b>" + (e.ultima ? "<small>Última: " + esc(dia(e.ultima)) + "</small>" : "") + historial(e) + cuadre(e) : "—") + "</td>" : "") +
                        (conBuzon ? '<td><label class="cf-switch" title="Revisar su Buzón Tributario"><input type="checkbox" data-buzon' + ((b ? b.activo : true) && x.efirma_guardada ? " checked" : "") +
                            (x.efirma_guardada ? "" : " disabled") + "><span></span></label></td>" : "") +
                        (conXml ? '<td class="cf-celda-acciones"><button type="button" class="cf-btn cf-btn--chico" data-guardar>Guardar</button>' +
                        (x.efirma_guardada ? ' <button type="button" class="cf-btn cf-btn--chico" data-ahora title="Pedir ahora el periodo programado">Descargar ahora</button>' : "") + "</td>" : "") + "</tr>";
                }).join("") + "</tbody></table><div class=\"cf-acciones\"><span class=\"cf-msj\"></span></div></div>";
            var fb = c.querySelector("#cf-buzon-frec");
            if (fb) fb.addEventListener("change", async function () {
                try { await enviar("/api/buzon/ajustes", "PUT", { frecuencia: +fb.value }); aviso(c, true, "✓ Buzones: " + fb.options[fb.selectedIndex].textContent.toLowerCase() + "."); }
                catch (x) { aviso(c, false, x.message); }
            });
            c.querySelectorAll("[data-buzon]").forEach(function (sw) {
                sw.addEventListener("change", async function () {
                    var rfc = sw.closest("tr").dataset.rfc; sw.disabled = true;
                    try { await enviar("/api/buzon/empresas/" + encodeURIComponent(rfc), "PUT", { activo: sw.checked }); aviso(c, true, "✓ " + (nombre[rfc] || rfc) + ": Buzón " + (sw.checked ? "encendido." : "apagado.")); }
                    catch (x) { sw.checked = !sw.checked; aviso(c, false, x.message); }
                    finally { sw.disabled = false; }
                });
            });
            c.querySelectorAll("[data-ahora]").forEach(function (b) {
                b.addEventListener("click", async function () {
                    var rfc = b.closest("tr").dataset.rfc;
                    b.disabled = true;
                    try {
                        var d = await enviar("/api/descarga-xml/automatica/" + encodeURIComponent(rfc) + "/ahora", "POST", {});
                        aviso(c, true, "✓ " + (nombre[rfc] || rfc) + ": se pidió del " + dia(d.desde) + " al " + dia(d.hasta) + ". Va en Descarga XML › Solicitudes.");
                    } catch (e) { aviso(c, false, e.message); }
                    b.disabled = false;
                });
            });
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

    /* ---------- Formato de los reportes (20-nov-2026, el dueño: «formato del despacho») ----------
       Una lista por pestaña (Recibidos, Emitidos): arriba, en su orden, las columnas que van en el reporte completo; abajo,
       las que no van. Se ordena arrastrando o con ↑ ↓ (en el celular no hay arrastre) y se marca o desmarca cada una. El
       folio fiscal no se puede quitar. Sin guardar nada sale el formato de Fiscontable, que es de donde parte la lista. */
    async function pintarFormatoReportes(c) {
        c.innerHTML = '<div class="cf-tarjeta"><p class="cf-texto">Cargando…</p></div>';
        var d;
        try { d = await api("/api/xml/formato-reporte"); }
        catch (e) { c.innerHTML = '<div class="cf-tarjeta"><p class="cf-msj cf-msj--mal">' + esc(e.message) + "</p></div>"; return; }
        var NOMBRES = { recibidos: "Recibidos", emitidos: "Emitidos" };
        var estado = {};                 // modulo → {orden: [claves marcadas], cambiado: bool}
        var fecha = function (iso) { return iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : ""; };
        function inicial(m) { var x = d.modulos[m]; return (x.guardado || x.fabrica).slice(); }
        Object.keys(NOMBRES).forEach(function (m) { estado[m] = { orden: inicial(m), cambiado: false }; });
        c.innerHTML = '<p class="cf-texto cf-fmt__intro">' + (d.despacho ? "Vale para todos en el despacho. " : "") +
            "«Excel de esta tabla» no cambia: sigue con las columnas que cada quien ve en pantalla.</p>" +
            (d.puede_editar ? "" : '<p class="cf-fmt__aviso">Solo ' + esc(d.titular || "el titular") + " (titular del despacho) lo puede cambiar. Así salen tus reportes.</p>") +
            Object.keys(NOMBRES).map(function (m) { return '<div class="cf-tarjeta" data-fmt="' + m + '"></div>'; }).join("");
        Object.keys(NOMBRES).forEach(function (m) { pintarLista(m); });
        subPestanas(c, Object.keys(NOMBRES).map(function (m) { return NOMBRES[m]; }), "formato_reportes");
        var pedido = Fiscontable.url("sub");
        if (pedido === "emitidos" || pedido === "recibidos") { var bt = c.querySelector('.cf-subtabs [data-sub="' + (pedido === "emitidos" ? 1 : 0) + '"]'); if (bt) bt.click(); }

        function pintarLista(m) {
            var caja = c.querySelector('[data-fmt="' + m + '"]'), x = d.modulos[m], st = estado[m], ed = d.puede_editar;
            var porClave = {}; x.catalogo.forEach(function (k) { porClave[k.clave] = k; });
            var van = st.orden.filter(function (k) { return porClave[k]; });
            var no = x.catalogo.filter(function (k) { return van.indexOf(k.clave) === -1; }).map(function (k) { return k.clave; });
            var origen = x.guardado ? "Formato del despacho" + (x.actualizado_en ? " · cambiado el " + fecha(x.actualizado_en) + (x.actualizado_por ? " por " + x.actualizado_por : "") : "")
                : "Formato de Fiscontable (de fábrica)";
            function fila(k, i, dentro) {
                var col = porClave[k], ob = col.obligatoria;
                return '<li class="cf-fmt__fila' + (dentro ? "" : " cf-fmt__fila--fuera") + '" data-clave="' + esc(k) + '"' + (ed && dentro ? ' draggable="true"' : "") + ">" +
                    (ed && dentro ? '<span class="cf-fmt__asa" aria-hidden="true">⋮⋮</span>' : '<span class="cf-fmt__asa cf-fmt__asa--vacia"></span>') +
                    '<label class="cf-fmt__nombre"><input type="checkbox" data-marca' + (dentro ? " checked" : "") + (ob || !ed ? " disabled" : "") + ">" +
                    "<span><b>" + esc(col.etiqueta) + "</b><small>" + esc(col.grupo || "") + (ob ? " · obligatoria" : "") + "</small></span></label>" +
                    (ed && dentro ? '<span class="cf-fmt__mover"><button type="button" class="cf-fmt__btn" data-mover="-1" aria-label="Subir ' + esc(col.etiqueta) + '"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
                        '<button type="button" class="cf-fmt__btn" data-mover="1" aria-label="Bajar ' + esc(col.etiqueta) + '"' + (i === van.length - 1 ? " disabled" : "") + ">↓</button></span>" : "") + "</li>";
            }
            caja.innerHTML = '<div class="cf-fmt__cab"><div><b>' + NOMBRES[m] + " · " + van.length + " columnas</b><small>" + esc(origen) + "</small></div>" +
                '<input type="search" class="cf-fmt__buscar" placeholder="Buscar una columna" aria-label="Buscar una columna"></div>' +
                '<div class="cf-fmt__marco"><ol class="cf-fmt__lista" data-lista="van">' + van.map(function (k, i) { return fila(k, i, true); }).join("") + "</ol>" +
                (no.length ? '<p class="cf-fmt__divisor">No van en el reporte (' + no.length + ")</p>" +
                    '<ul class="cf-fmt__lista" data-lista="no">' + no.map(function (k, i) { return fila(k, i, false); }).join("") + "</ul>" : "") + "</div>" +
                '<details class="cf-fmt__reglas"><summary>Cómo se arma el reporte</summary><ul>' +
                "<li>Una columna marcada que no trae datos en el periodo no sale. Las básicas (estado SAT, folio fiscal, serie, folio, fechas, emisor, receptor, forma y método de pago, subtotal, descuento, total, moneda, IVA 16 %, ISR e IVA retenidos) salen siempre, para que el Excel tenga la misma forma cada mes.</li>" +
                "<li>Con facturas en otra moneda, la moneda, el tipo de cambio y el total en pesos van junto al total aunque no estén marcados.</li>" +
                "<li>En el Excel de un mes ya cerrado, «Pago posterior al periodo» va sola junto al estado de pago (si lo marcaste).</li>" +
                "<li>«IEPS por tasa» y «Retenciones por tasa» se abren en las tasas que traiga el periodo. La banda de grupos sigue tu orden.</li>" +
                "<li>El folio fiscal (UUID) no se puede quitar: sin él no se identifica la factura. Sí puedes moverlo.</li></ul></details>" +
                (ed ? '<div class="cf-acciones"><button type="button" class="cf-btn cf-btn--principal" data-guardar' + (st.cambiado ? "" : " disabled") + ">Guardar formato</button>" +
                    '<button type="button" class="cf-btn" data-fabrica' + (x.guardado || st.cambiado ? "" : " disabled") + ">Volver al formato de Fiscontable</button>" +
                    '<span class="cf-msj">' + (st.cambiado ? "Sin guardar" : "") + "</span></div>" : "");
            var buscar = caja.querySelector(".cf-fmt__buscar");
            buscar.value = st.buscar || "";
            function filtrar() {
                var q = buscar.value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); st.buscar = buscar.value;
                caja.querySelectorAll(".cf-fmt__fila").forEach(function (li) {
                    li.hidden = !!q && li.textContent.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").indexOf(q) === -1;
                });
            }
            buscar.addEventListener("input", filtrar); filtrar();
            if (!ed) return;
            caja._van = van;
            if (caja.dataset.listo) { arrastrar(caja); return; }          // los eventos de la caja se ponen una sola vez (la lista se vuelve a pintar)
            caja.dataset.listo = "1";
            function cambio(nuevoOrden, foco) {
                estado[m].orden = nuevoOrden; estado[m].cambiado = true; pintarLista(m);
                if (foco) { var b = caja.querySelector('[data-clave="' + foco.clave + '"] ' + foco.sel); if (b && !b.disabled) b.focus(); else { b = caja.querySelector('[data-clave="' + foco.clave + '"] input'); if (b) b.focus(); } }
            }
            caja._cambio = cambio;
            arrastrar(caja);
            caja.addEventListener("change", function (ev) {
                var el = ev.target.closest("[data-marca]"); if (!el) return;
                var k = el.closest("li").dataset.clave, nuevo = caja._van.slice();
                if (el.checked) nuevo.push(k); else nuevo.splice(nuevo.indexOf(k), 1);
                cambio(nuevo, { clave: k, sel: "input" });
            });
            caja.addEventListener("click", async function (ev) {
                var van = caja._van, b = ev.target.closest("[data-mover]");
                if (b) {
                    var k = b.closest("li").dataset.clave, i = van.indexOf(k), j = i + (+b.dataset.mover), nuevo = van.slice();
                    if (j < 0 || j >= nuevo.length) return;
                    nuevo.splice(i, 1); nuevo.splice(j, 0, k);
                    cambio(nuevo, { clave: k, sel: '[data-mover="' + b.dataset.mover + '"]' });
                    return;
                }
                if (ev.target.closest("[data-guardar]")) {
                    var g = ev.target.closest("[data-guardar]"); g.disabled = true;
                    try {
                        d = await enviar("/api/xml/formato-reporte", "PUT", { modulo: m, columnas: van });
                        estado[m] = { orden: inicial(m), cambiado: false, buscar: estado[m].buscar }; pintarLista(m);
                        aviso(caja, true, "✓ Guardado. Así sale desde ahora el reporte completo de " + NOMBRES[m] + (d.despacho ? " para todo el despacho." : "."));
                    } catch (e) { g.disabled = false; aviso(caja, false, e.message); }
                    return;
                }
                if (ev.target.closest("[data-fabrica]")) {
                    if (!d.modulos[m].guardado) { estado[m] = { orden: inicial(m), cambiado: false }; pintarLista(m); return; }      // solo deshacer lo no guardado
                    if (!(await Fiscontable.confirmar({ titulo: "Volver al formato de Fiscontable", si: "Volver",
                        texto: "El reporte completo de " + NOMBRES[m] + " vuelve a salir con las columnas de fábrica" + (d.despacho ? " para todo el despacho" : "") + "." }))) return;
                    try {
                        d = await api("/api/xml/formato-reporte/" + m, { method: "DELETE" });
                        estado[m] = { orden: inicial(m), cambiado: false }; pintarLista(m);
                        aviso(caja, true, "✓ De vuelta al formato de Fiscontable.");
                    } catch (e) { aviso(caja, false, e.message); }
                }
            });
        }

        function arrastrar(caja) {
            // Arrastrar (computadora): se suelta sobre otra columna de las que van
            var arr = null, lista = caja.querySelector('[data-lista="van"]'), van = caja._van, cambio = caja._cambio;
            lista.addEventListener("dragstart", function (ev) { var li = ev.target.closest("li"); if (!li) return; arr = li.dataset.clave; ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", arr); li.classList.add("cf-fmt__fila--arrastrando"); });
            lista.addEventListener("dragend", function () { arr = null; lista.querySelectorAll(".cf-fmt__fila").forEach(function (x2) { x2.classList.remove("cf-fmt__fila--arrastrando", "cf-fmt__fila--destino"); }); });
            lista.addEventListener("dragover", function (ev) {
                var li = ev.target.closest("li"); if (!li || !arr) return;
                ev.preventDefault();
                lista.querySelectorAll(".cf-fmt__fila--destino").forEach(function (x2) { x2.classList.remove("cf-fmt__fila--destino"); });
                li.classList.add("cf-fmt__fila--destino");
            });
            lista.addEventListener("drop", function (ev) {
                var li = ev.target.closest("li"); if (!li || !arr) return;
                ev.preventDefault();
                var destino = li.dataset.clave, nuevo = van.slice(), i = nuevo.indexOf(arr);
                if (destino === arr || i === -1) return;
                nuevo.splice(i, 1); nuevo.splice(nuevo.indexOf(destino) + (van.indexOf(destino) > i ? 1 : 0), 0, arr);
                arr = null; cambio(nuevo);
            });
        }
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