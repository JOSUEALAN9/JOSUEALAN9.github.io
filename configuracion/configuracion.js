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
        balanza: "M12 3v18M5 7h14M5 7l-3 7a4 4 0 006 0zM19 7l-3 7a4 4 0 006 0zM8 21h8"
    };
    function ico(d) { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>'; }

    /* Las secciones: {id, grupo, titulo, desc, palabras, ver(perfil), pintar(caja)} */
    var SECCIONES = [
        { id: "perfil", grupo: "Tu cuenta", titulo: "Mi perfil", ico: ICO.persona, desc: "Tu nombre y teléfono de contacto.", palabras: "nombre teléfono correo cuenta pin bloqueo inactividad seguridad",
          pintar: pintarPerfil },
        { id: "plan", grupo: "Tu cuenta", titulo: "Plan y créditos", ico: ICO.creditos, desc: "Tu plan, su vigencia y tus créditos.", palabras: "plan créditos recargar vigencia pago",
          pintar: pintarPlan },
        { id: "agente", grupo: "Tu cuenta", titulo: "PC del contador", ico: ICO.pc, desc: "Conectar esta PC para que haga los trámites de tu cuenta.", palabras: "agente pc windows conectar",
          pintar: function (c) { enlaceA(c, "PC del contador", "Conecta tu computadora con Windows para que los trámites salgan desde ahí.", "/agente/", "Abrir PC del contador"); } },
        { id: "facturacion", grupo: "Módulos", titulo: "Facturar", ico: ICO.factura, modulo: "facturacion",
          desc: "Emisor, series y folios, sello digital, logo del PDF, correo a clientes y timbres.",
          palabras: "facturar cfdi timbres serie folio csd sello logo pdf correo smtp gmail régimen código postal multifacturas",
          marco: function (sub) { return "/herramientas/facturar/?vista=config&incrustado=1&dentro=1" + (sub ? "&sub=" + encodeURIComponent(sub) : ""); } },
        { id: "buzon", grupo: "Módulos", titulo: "Buzón tributario", ico: ICO.buzon, modulo: "buzon",
          desc: "Cada cuánto se revisan solos los buzones de tus empresas.", palabras: "buzón tributario notificaciones revisión automática frecuencia",
          pintar: pintarBuzon },
        { id: "descarga_xml", grupo: "Módulos", titulo: "Descarga automática de XML", ico: ICO.xml, modulo: "descarga_xml",
          desc: "Qué empresas bajan solas sus XML del SAT, desde qué mes y cada cuánto.", palabras: "descarga masiva xml automática sat madrugada",
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
            return { titulo: g, items: grupos[g].map(function (s) { return { id: s.id, nombre: s.titulo, svg: ico(s.ico), actual: s.id === actual }; }) };
        }));
    }

    var actual = null;
    function abrir(id, sub) {
        var s = visibles().filter(function (x) { return x.id === id; })[0] || visibles()[0];
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
        else location.href = "/";
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
    function pintarPerfil(c) {
        c.innerHTML = '<div class="cf-tarjeta"><div class="cf-campos">' +
            '<label class="cf-campo"><span>Nombre</span><input id="cf-nombre" maxlength="120" value="' + esc(perfil.nombre || "") + '"></label>' +
            '<label class="cf-campo"><span>Teléfono</span><input id="cf-telefono" inputmode="tel" maxlength="20" value="' + esc(perfil.telefono || "") + '"></label>' +
            '<label class="cf-campo"><span>Correo <i>(con el que entras; no se cambia aquí)</i></span><input value="' + esc(perfil.correo || "") + '" disabled></label></div>' +
            '<div class="cf-acciones"><button type="button" class="cf-btn cf-btn--principal" id="cf-guardar-perfil">Guardar</button><span class="cf-msj"></span></div></div>';
        $("cf-guardar-perfil").addEventListener("click", async function () {
            try {
                await enviar("/api/mi-perfil", "PUT", { nombre: $("cf-nombre").value.trim(), telefono: $("cf-telefono").value.trim() || null });
                perfil.nombre = $("cf-nombre").value.trim();
                aviso(c, true, "Guardado.");
            } catch (e) { aviso(c, false, e.message); }
        });
        pintarBloqueo(c);
    }

    /* Bloqueo por inactividad: minutos y PIN (el PIN se guarda solo como hash en el servidor) */
    function pintarBloqueo(c) {
        var b = perfil.bloqueo || { tiene_pin: false, minutos: 15 };
        var caja = document.createElement("div");
        caja.className = "cf-tarjeta"; caja.style.marginTop = "14px";
        caja.innerHTML = '<h3 class="cf-sub">Bloqueo por inactividad</h3>' +
            '<p class="cf-texto">Si dejas la computadora abierta, la pantalla se bloquea sola. ' + (b.tiene_pin ? "Se desbloquea con tu PIN, sin perder lo que estabas haciendo." :
                "Sin PIN, para seguir tienes que volver a entrar con tu correo; con PIN la desbloqueas al momento.") + "</p>" +
            '<div class="cf-campos"><label class="cf-campo"><span>Bloquear después de</span><select id="cf-bl-min">' +
            [5, 10, 15, 20, 30, 45, 60].map(function (m) { return '<option value="' + m + '"' + (m === b.minutos ? " selected" : "") + ">" + m + " minutos sin usarla</option>"; }).join("") + "</select></label>" +
            (b.tiene_pin ? '<label class="cf-campo"><span>PIN actual</span><input id="cf-bl-actual" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></label>' : "") +
            '<label class="cf-campo"><span>' + (b.tiene_pin ? "PIN nuevo <i>(déjalo vacío para no cambiarlo)</i>" : "Crea tu PIN <i>(4 a 6 números)</i>") + '</span><input id="cf-bl-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label></div>' +
            '<div class="cf-acciones"><button type="button" class="cf-btn cf-btn--principal" id="cf-bl-guardar">Guardar</button>' +
            (b.tiene_pin ? '<button type="button" class="cf-btn" id="cf-bl-quitar">Quitar PIN</button>' : "") + '<span class="cf-msj"></span></div>';
        c.appendChild(caja);
        var listo = function (nuevo, texto) { perfil.bloqueo = nuevo; c.removeChild(caja); pintarBloqueo(c); aviso(c.lastChild, true, texto); };
        $("cf-bl-guardar").addEventListener("click", async function () {
            var pin = $("cf-bl-pin").value.trim(), cuerpo = { minutos: +$("cf-bl-min").value };
            if (pin) { cuerpo.pin = pin; if ($("cf-bl-actual")) cuerpo.actual = $("cf-bl-actual").value.trim(); }
            try { listo(await enviar("/api/mi-perfil/pin", "PUT", cuerpo), pin ? "PIN guardado." : "Guardado."); }
            catch (e) { aviso(caja, false, e.message); }
        });
        if ($("cf-bl-quitar")) $("cf-bl-quitar").addEventListener("click", async function () {
            try { listo(await enviar("/api/mi-perfil/pin/quitar", "POST", { actual: $("cf-bl-actual").value.trim() }), "PIN quitado."); }
            catch (e) { aviso(caja, false, e.message); }
        });
    }

    function pintarPlan(c) {
        var vence = perfil.fecha_expira ? new Date(perfil.fecha_expira).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : "Sin vencimiento";
        c.innerHTML = '<div class="cf-tarjeta"><dl class="cf-datos"><dt>Plan</dt><dd>' + esc(perfil.plan_nombre || perfil.rol || "—") + "</dd>" +
            "<dt>Vigencia</dt><dd>" + esc(vence) + "</dd><dt>Módulos</dt><dd>" + esc(String((perfil.modulos_permitidos || []).length)) + " activos</dd></dl>" +
            '<a class="cf-btn cf-btn--principal" href="/creditos/"' + (incrustado ? ' target="_top"' : "") + ">Ver y recargar créditos</a></div>";
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
            c.innerHTML = '<div class="cf-tarjeta cf-tarjeta--tabla"><table class="cf-tabla"><thead><tr><th>Empresa</th><th>Automática</th><th>Qué</th><th>Cada cuánto</th><th>Desde</th><th></th></tr></thead><tbody>' +
                clientes.map(function (x) {
                    var e = porRfc[x.rfc] || { activo: false, tipo: "ambos", frecuencia: "diaria" };
                    return '<tr data-rfc="' + esc(x.rfc) + '"><td><b>' + esc(x.alias) + "</b><small>" + esc(x.rfc) + (x.efirma_guardada ? "" : " · sin e.firma") + "</small></td>" +
                        '<td><label class="cf-switch"><input type="checkbox" data-c="activo"' + (e.activo ? " checked" : "") + (x.efirma_guardada ? "" : " disabled") + "><span></span></label></td>" +
                        '<td><select data-c="tipo">' + opc(cfg.tipos, e.tipo) + "</select></td><td><select data-c=\"frecuencia\">" + opc(cfg.frecuencias, e.frecuencia) + "</select></td>" +
                        '<td><select data-c="desde">' + Fiscontable.opcionesDesde(cfg.desde_minimo, cfg.mes_actual, e.desde || "") + "</select></td>" +
                        '<td><button type="button" class="cf-btn cf-btn--chico" data-guardar>Guardar</button></td></tr>';
                }).join("") + "</tbody></table><div class=\"cf-acciones\"><span class=\"cf-msj\"></span></div></div>";
            c.querySelectorAll("[data-guardar]").forEach(function (b) {
                b.addEventListener("click", async function () {
                    var fila = b.closest("tr"), val = function (k) { var el = fila.querySelector('[data-c="' + k + '"]'); return el.type === "checkbox" ? el.checked : el.value; };
                    try {
                        await enviar("/api/descarga-xml/automatica/" + encodeURIComponent(fila.dataset.rfc), "PUT", { activo: val("activo"), tipo: val("tipo"), frecuencia: val("frecuencia"), desde: val("desde") || null });
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
            if (ev.origin !== location.origin || !ev.data || ev.data.fiscontable !== "config-listo" || ev.source === window) return;
            if (incrustado) listo();
        });
        try { perfil = await api("/api/mi-perfil"); }
        catch (e) { $("cf-cuerpo").innerHTML = '<p class="cf-msj cf-msj--mal">' + esc(e.message) + "</p>"; return; }
        menu = Fiscontable.riel($("cf-menu"), {
            id: "ajustes", cabeza: '<h1 class="cf-menu__titulo">Configuración</h1>', vacio: "Nada coincide.",
            buscar: { campo: true, texto: "Buscar en la configuración", alEscribir: function (texto) {
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