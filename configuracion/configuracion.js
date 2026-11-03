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
        sistema: "M4 6h16M4 12h16M4 18h10"
    };
    function ico(d) { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>'; }

    /* Las secciones: {id, grupo, titulo, desc, palabras, ver(perfil), pintar(caja)} */
    var SECCIONES = [
        { id: "perfil", grupo: "Tu cuenta", titulo: "Mi perfil", ico: ICO.persona, desc: "Tu nombre y teléfono de contacto.", palabras: "nombre teléfono correo cuenta",
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

    function pintarMenu() {
        var q = Fiscontable.sinAcentos ? Fiscontable.sinAcentos($("cf-buscar").value) : $("cf-buscar").value.toLowerCase();
        q = (q || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        var grupos = {}, orden = [];
        visibles().forEach(function (s) {
            var texto = (s.titulo + " " + s.desc + " " + s.palabras).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
            if (q && texto.indexOf(q) === -1) return;
            if (!grupos[s.grupo]) { grupos[s.grupo] = []; orden.push(s.grupo); }
            grupos[s.grupo].push(s);
        });
        $("cf-secciones").innerHTML = orden.length ? orden.map(function (g) {
            return '<p class="cf-grupo">' + esc(g) + "</p>" + grupos[g].map(function (s) {
                return '<button type="button" class="cf-item' + (s.id === actual ? " cf-item--activo" : "") + '" data-seccion="' + s.id + '" title="' + esc(s.titulo) + '">' + ico(s.ico) + "<span>" + esc(s.titulo) + "</span></button>";
            }).join("");
        }).join("") : '<p class="cf-vacio">Nada coincide con «' + esc($("cf-buscar").value) + "».</p>";
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
        compactar(!!s.marco);
        if (s.marco) {
            caja.innerHTML = '<iframe class="cf-marco" title="' + esc(s.titulo) + '" src="' + esc(s.marco(sub)) + '"></iframe>';
            return;
        }
        s.pintar(caja);
    }

    var FIJO = "fiscontable.config.menu";
    function fijado() { try { return localStorage.getItem(FIJO) === "abierto"; } catch (e) { return false; } }
    function compactar(quiere) {
        document.body.classList.toggle("cf-compacto", quiere && !fijado());
        var b = $("cf-fijar");
        if (b) { b.title = fijado() ? "Reducir el menú a íconos" : "Dejar el menú abierto"; b.setAttribute("aria-pressed", String(fijado())); }
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
                aviso(c, true, "✓ Guardado.");
            } catch (e) { aviso(c, false, e.message); }
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
        $("cf-buscar").addEventListener("input", function () {
            pintarMenu();
            var primero = $("cf-secciones").querySelector("[data-seccion]");
            if (primero && $("cf-buscar").value.trim()) abrir(primero.dataset.seccion);
        });
        $("cf-secciones").addEventListener("click", function (ev) { var b = ev.target.closest("[data-seccion]"); if (b) abrir(b.dataset.seccion); });
        $("cf-fijar").addEventListener("click", function () {
            try { localStorage.setItem(FIJO, fijado() ? "compacto" : "abierto"); } catch (e) { /* sin almacenamiento */ }
            compactar(document.body.classList.contains("cf-con-marco"));
        });
        abrir(Fiscontable.url("seccion") || "perfil", Fiscontable.url("sub"));
    }

    iniciar();
})();
