/**
 * barra.js — el marco de Fiscontable, en un solo lugar (antes app-header.js).
 * Requiere assets/js/nucleo.js cargado antes.
 *
 * Antes cada página dibujaba su propia navegación: el mismo botón se
 * llamaba "Inicio", "Menú", "Volver" o "Clientes" según dónde estuvieras,
 * y sólo la portada tenía perfil y descargas. Ahora las doce páginas
 * montan esto y se comportan igual.
 *
 * Cómo se usa — una línea en el <body> y una en el <head>:
 *
 *   <div id="app-header"
 *        data-modulo="constancias"
 *        data-titulo="Constancias de Situación Fiscal"
 *        data-migas="Herramientas|/herramientas/"></div>
 *
 * data-modulo   clave del módulo: fija el color de acento y el permiso.
 * data-titulo   nombre de la página (último tramo de la ruta de migas).
 * data-migas    tramos anteriores, "Texto|ruta" separados por ";".
 *               La portada se agrega sola al principio; omítelo en ella.
 *
 * Lo que queda disponible para las páginas:
 *   Fiscontable.perfil()             -> Promise<perfil|null>  (se pide una vez)
 *   Fiscontable.exigirModulo(clave)  -> Promise<bool>  bloquea la vista si no
 *   Fiscontable.bloquear(mensaje)
 *   Fiscontable.aviso(mensaje, {acciones})
 *   Fiscontable.ocultarAviso()
 *   Fiscontable.abrirDescargas() / cerrarDescargas()
 *   Fiscontable.refrescarDescargas()   úsalo al lanzar un proceso nuevo
 *   Fiscontable.API                    la URL base del backend
 */
(function () {
    "use strict";

    var API = window.Fiscontable.API;

    // Un solo lugar donde vive la identidad de cada módulo: nombre,
    // color y clave de permiso. Agregar un módulo nuevo es una línea.
    var MODULOS = {
        portada:       { nombre: "Fiscontable",           acento: "#0E9F6E", suave: "#E8F6F0", permiso: null },
        clientes:      { nombre: "Mis clientes",          acento: "#6D28D9", suave: "#F1EBFD", permiso: null },
        herramientas:  { nombre: "Herramientas",          acento: "#0E9F6E", suave: "#E8F6F0", permiso: null },
        conciliacion:  { nombre: "Conciliación",          acento: "#1D4ED8", suave: "#E8EFFD", permiso: "conciliacion" },
        iva:           { nombre: "Papel de trabajo de IVA", acento: "#7C3AED", suave: "#F1EBFE", permiso: "iva" },
        validador:     { nombre: "Validador SAT",         acento: "#047857", suave: "#E6F4EF", permiso: "validador" },
        xml:           { nombre: "Administración de XML", acento: "#0E7490", suave: "#E0F2F7", permiso: "validador" },
        constancias:   { nombre: "Constancias",           acento: "#4338CA", suave: "#ECEBFB", permiso: "constancias" },
        opinion:       { nombre: "Opinión 32-D",          acento: "#0F766E", suave: "#E6F2F1", permiso: "opinion" },
        voucheo:       { nombre: "Voucheo",               acento: "#B45309", suave: "#FBF0E2", permiso: "voucheo" },
        declaraciones: { nombre: "Declaraciones",         acento: "#0369A1", suave: "#E4F1F9", permiso: "declaraciones" },
        descarga_xml:  { nombre: "Descarga masiva de XML", acento: "#0E7490", suave: "#E0F2F7", permiso: "descarga_xml" },
        descargas:     { nombre: "Mis descargas",         acento: "#334155", suave: "#EEF1F5", permiso: null },
        admin:         { nombre: "Administración",        acento: "#BE123C", suave: "#FCE9EE", permiso: null }
    };

    var ancla = document.getElementById("app-header");
    if (!ancla) return;

    var clave = ancla.dataset.modulo || "portada";
    var modulo = MODULOS[clave] || MODULOS.portada;

    document.documentElement.style.setProperty("--acento", modulo.acento);
    document.documentElement.style.setProperty("--acento-suave", modulo.suave);

    /* ---------------------------------------------------------- útiles */

    var esc = window.Fiscontable.escapar;

    function ico(d, ancho) {
        return '<svg fill="none" stroke="currentColor" stroke-width="' + (ancho || 2) +
            '" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="' + d + '"/></svg>';
    }

    var D = {
        rayo:     "M13 10V3L4 14h7v7l9-11h-7z",
        edificio: "M3 21h18M5 21V7l7-4 7 4v14M9 9h1m-1 4h1m4-4h1m-1 4h1M10 21v-4h4v4",
        descarga: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4",
        engrane:  "M10.3 4.3c.4-1.7 2.9-1.7 3.4 0a1.7 1.7 0 002.5 1.1c1.6-.9 3.3.8 2.4 2.4a1.7 1.7 0 001.1 2.5c1.7.4 1.7 2.9 0 3.4a1.7 1.7 0 00-1.1 2.5c.9 1.6-.8 3.3-2.4 2.4a1.7 1.7 0 00-2.5 1.1c-.4 1.7-2.9 1.7-3.4 0a1.7 1.7 0 00-2.5-1.1c-1.6.9-3.3-.8-2.4-2.4a1.7 1.7 0 00-1.1-2.5c-1.7-.4-1.7-2.9 0-3.4a1.7 1.7 0 001.1-2.5c-.9-1.6.8-3.3 2.4-2.4 1 .6 2.3.1 2.5-1.1zM15 12a3 3 0 11-6 0 3 3 0 016 0z",
        persona:  "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
        salir:    "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
        cerrar:   "M6 18L18 6M6 6l12 12",
        alerta:   "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
        candado:  "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z M16 11V7a4 4 0 00-8 0v4",
        flecha:   "M9 18l6-6-6-6",
        calendario: "M8 7V3m8 4V3M4 11h16M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
    };

    /* ------------------------------------------------------- la barra */

    function migasDesdeDatos() {
        var tramos = [];
        if (clave !== "portada") tramos.push({ texto: "Inicio", href: "/" });
        (ancla.dataset.migas || "").split(";").forEach(function (t) {
            if (!t.trim()) return;
            var p = t.split("|");
            tramos.push({ texto: p[0].trim(), href: (p[1] || "/").trim() });
        });
        return tramos;
    }

    function pintarBarra() {
        var tramos = migasDesdeDatos();
        var titulo = ancla.dataset.titulo || modulo.nombre;

        // En el teléfono no cabe la ruta completa, así que el último
        // tramo (el "padre") se convierte en una flecha de regresar y el
        // resto se esconde. En pantalla grande se ve la ruta entera.
        var migas = tramos.map(function (t, i) {
            var esPadre = i === tramos.length - 1;
            return '<a class="fc-miga' + (esPadre ? " fc-miga--padre" : "") + '" href="' + esc(t.href) + '"' +
                (esPadre ? ' aria-label="Regresar a ' + esc(t.texto) + '"' : "") + ">" +
                '<span class="fc-miga__sep">' + ico(D.flecha, 2.2) + "</span>" +
                "<span>" + esc(t.texto) + "</span></a>";
        }).join("");

        if (clave !== "portada") {
            migas += '<span class="fc-miga fc-miga--actual">' +
                '<span class="fc-miga__sep">' + ico(D.flecha, 2.2) + "</span>" +
                "<span>" + esc(titulo) + "</span></span>";
        }

        ancla.outerHTML =
            '<header class="fc-barra">' +
              '<div class="fc-barra__interior">' +
                '<a class="fc-marca" href="/">' +
                  '<span class="fc-marca__sello">' + ico(D.rayo) + "</span>" +
                  '<span class="fc-marca__nombre">Fiscontable</span>' +
                "</a>" +
                '<nav class="fc-migas" aria-label="Ruta">' + migas + "</nav>" +
                '<div class="fc-acciones">' +
                  '<button type="button" class="fc-accion fc-empresa" id="fc-btn-empresa" aria-haspopup="menu" aria-expanded="false" hidden>' +
                    ico(D.edificio) +
                    '<span class="fc-accion__etiqueta fc-empresa__nombre" id="fc-empresa-nombre">Elegir empresa</span>' +
                    '<span class="fc-empresa__flecha" aria-hidden="true">▾</span>' +
                  "</button>" +
                  '<button type="button" class="fc-accion fc-empresa fc-empresa--vacia" id="fc-btn-periodo" aria-haspopup="dialog" aria-expanded="false" hidden>' +
                    ico(D.calendario) +
                    '<span class="fc-accion__etiqueta fc-empresa__nombre" id="fc-periodo-nombre">Elegir periodo</span>' +
                    '<span class="fc-empresa__flecha" aria-hidden="true">▾</span>' +
                  "</button>" +
                  '<button type="button" class="fc-accion" id="fc-btn-descargas" aria-haspopup="dialog" aria-label="Mis descargas">' +
                    ico(D.descarga) +
                    '<span class="fc-accion__etiqueta">Descargas</span>' +
                    '<span class="fc-contador" id="fc-contador" hidden>0</span>' +
                  "</button>" +
                  '<a class="fc-accion" id="fc-enlace-admin" href="/admin/" hidden>' +
                    ico(D.engrane) + '<span class="fc-accion__etiqueta">Administración</span>' +
                  "</a>" +
                  '<button type="button" class="fc-accion" id="fc-btn-perfil" aria-haspopup="menu" aria-expanded="false">' +
                    '<span class="fc-avatar" id="fc-avatar">·</span>' +
                    '<span class="fc-accion__etiqueta" id="fc-nombre-corto"></span>' +
                  "</button>" +
                "</div>" +
                menuPerfilHTML() + menuEmpresasHTML() +
              "</div>" +
            "</header>" +
            avisoHTML();
    }

    function menuPerfilHTML() {
        return '<div class="fc-menu" id="fc-menu" role="menu" hidden>' +
            '<div class="fc-menu__cabeza">' +
              '<div class="fc-menu__nombre" id="fc-menu-nombre">—</div>' +
              '<div class="fc-menu__dato" id="fc-menu-correo"></div>' +
              '<div class="fc-menu__dato" id="fc-menu-telefono"></div>' +
            "</div>" +
            '<div class="fc-menu__fila"><span>Plan</span><span class="fc-menu__plan" id="fc-menu-plan">—</span></div>' +
            '<div class="fc-menu__fila"><span>Vigencia</span><span class="fc-menu__valor" id="fc-menu-vigencia">—</span></div>' +
            '<div class="fc-menu__acciones">' +
              '<button type="button" class="fc-menu__boton" id="fc-btn-editar-perfil" role="menuitem">' +
                ico(D.persona) + "Editar mi perfil</button>" +
              '<a class="fc-menu__boton fc-menu__boton--salir" href="/cdn-cgi/access/logout" role="menuitem">' +
                ico(D.salir) + "Cerrar sesión</a>" +
            "</div></div>";
    }

    /* --------------------------------------------- selector de empresa */
    /* La empresa en la que estás trabajando. Se guarda en el servidor
       (te sigue en cualquier PC) y los módulos la usan para resolver solos
       el paso "¿Para quién?". Las herramientas rápidas (un RFC sin
       registrar) siguen disponibles en cada módulo sin tocar este selector. */
    function menuEmpresasHTML() {
        return '<div class="fc-menu fc-empresas" id="fc-empresas" role="menu" hidden>' +
            '<div class="fc-empresas__cabeza"><div class="fc-menu__nombre">¿En qué empresa trabajas?</div>' +
              '<input type="search" class="fc-empresas__buscar" id="fc-empresas-buscar" placeholder="Buscar por nombre o RFC…" autocomplete="off"></div>' +
            '<div class="fc-empresas__lista" id="fc-empresas-lista"></div>' +
            '<div class="fc-empresas__pie">' +
              '<button type="button" class="fc-empresas__ninguna" id="fc-empresa-ninguna">Quitar empresa activa</button>' +
              '<a class="fc-empresas__nueva" href="/clientes/">+ Registrar empresa</a>' +
            "</div></div>";
    }

    var clientesCache = null;

    function pintarEmpresa() {
        var e = perfilActual && perfilActual.empresa_activa;
        var boton = document.getElementById("fc-btn-empresa");
        if (!boton) return;
        boton.hidden = false;
        boton.classList.toggle("fc-empresa--vacia", !e);
        document.getElementById("fc-empresa-nombre").textContent = e ? (e.alias || e.rfc) : "Elegir empresa";
        boton.title = e ? (e.alias || "") + " · " + e.rfc + " — cambiar de empresa" : "Elige la empresa en la que vas a trabajar";
        document.getElementById("fc-empresa-ninguna").hidden = !e;
    }

    function pintarListaEmpresas() {
        var q = (document.getElementById("fc-empresas-buscar").value || "").trim().toLowerCase();
        var activa = perfilActual && perfilActual.empresa_activa ? perfilActual.empresa_activa.rfc : null;
        var lista = (clientesCache || []).filter(function (c) {
            return !q || (c.alias + " " + c.rfc + " " + (c.razon_social || "")).toLowerCase().indexOf(q) !== -1;
        });
        var caja = document.getElementById("fc-empresas-lista");
        if (clientesCache === null) { caja.innerHTML = '<p class="fc-empresas__nada">Cargando tu directorio…</p>'; return; }
        if (!clientesCache.length) {
            caja.innerHTML = '<p class="fc-empresas__nada">Todavía no tienes empresas registradas. Regístralas en <a href="/clientes/">Mis clientes</a>.</p>';
            return;
        }
        caja.innerHTML = lista.length ? lista.map(function (c) {
            return '<button type="button" class="fc-empresas__item' + (c.rfc === activa ? " fc-empresas__item--activa" : "") + '" data-rfc="' + esc(c.rfc) + '" role="menuitem">' +
                '<span class="fc-empresas__inicial">' + esc((c.alias || c.rfc).charAt(0).toUpperCase()) + "</span>" +
                '<span class="fc-empresas__texto"><strong>' + esc(c.alias) + "</strong><small>" + esc(c.rfc) + "</small></span>" +
                (c.rfc === activa ? '<span class="fc-empresas__check">✓</span>' : "") + "</button>";
        }).join("") : '<p class="fc-empresas__nada">Ninguna coincide con la búsqueda.</p>';
    }

    async function abrirEmpresas() {
        var panel = document.getElementById("fc-empresas");
        var boton = document.getElementById("fc-btn-empresa");
        document.getElementById("fc-menu").hidden = true;
        panel.hidden = false;
        boton.setAttribute("aria-expanded", "true");
        var interior = panel.parentElement.getBoundingClientRect();
        var r = boton.getBoundingClientRect();
        panel.style.right = Math.max(12, interior.right - r.right) + "px";
        var buscar = document.getElementById("fc-empresas-buscar");
        buscar.value = "";
        pintarListaEmpresas();
        if (window.innerWidth > 700) buscar.focus();
        if (clientesCache === null) {
            try {
                var resp = await fetch(API + "/api/clientes", { credentials: "include" });
                clientesCache = resp.ok ? await resp.json() : [];
            } catch (e) { clientesCache = []; }
            pintarListaEmpresas();
        }
    }

    function cerrarEmpresas() {
        var panel = document.getElementById("fc-empresas");
        if (!panel || panel.hidden) return;
        panel.hidden = true;
        document.getElementById("fc-btn-empresa").setAttribute("aria-expanded", "false");
    }

    async function elegirEmpresa(rfc) {
        cerrarEmpresas();
        try {
            var resp = await fetch(API + "/api/mi-perfil/empresa", {
                method: "PUT", credentials: "include",
                headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rfc: rfc })
            });
            if (!resp.ok) throw new Error(await window.Fiscontable.leerError(resp));
            var r = await resp.json();
            perfilActual.empresa_activa = r.empresa_activa;
            promesaPerfil = Promise.resolve(perfilActual);
            pintarEmpresa();
            window.dispatchEvent(new CustomEvent("fiscontable:empresa", { detail: r.empresa_activa }));
        } catch (e) {
            aviso(e.message || "No se pudo cambiar de empresa.");
        }
    }

    function prepararEmpresas() {
        var boton = document.getElementById("fc-btn-empresa");
        if (!boton) return;
        boton.addEventListener("click", function (e) {
            e.stopPropagation();
            if (document.getElementById("fc-empresas").hidden) abrirEmpresas(); else cerrarEmpresas();
        });
        var panel = document.getElementById("fc-empresas");
        panel.addEventListener("click", function (e) {
            e.stopPropagation();
            var item = e.target.closest("[data-rfc]");
            if (item) elegirEmpresa(item.dataset.rfc);
        });
        document.getElementById("fc-empresas-buscar").addEventListener("input", pintarListaEmpresas);
        document.getElementById("fc-empresas-buscar").addEventListener("keydown", function (e) {
            if (e.key === "Enter") { var primero = panel.querySelector("[data-rfc]"); if (primero) elegirEmpresa(primero.dataset.rfc); }
        });
        document.getElementById("fc-empresa-ninguna").addEventListener("click", function () { elegirEmpresa(null); });
        document.addEventListener("click", cerrarEmpresas);
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") cerrarEmpresas(); });
    }

    /* --------------------------------------------- selector de periodo */
    /* Componente único para elegir periodo. Lo usa el selector general de la
       barra (solo mes y año) y lo reutiliza cualquier módulo con opciones
       extra (todo el año, todos los periodos, cuántos XML hay por mes):

         var sel = Fiscontable.selectorPeriodo({
             boton: el, etiqueta: el,          // el botón y dónde escribir el texto
             valor: "m:2025-10",               // "m:AAAA-MM" | "a:AAAA" | "t:" | "r:AAAA-MM-DD|AAAA-MM-DD" | null
             permitirAnio: true, permitirTodos: true, permitirQuitar: false,
             permitirRango: true,              // "Rango de fechas": del día X al día Y
             conteos: { "2025-10": 12 },       // opcional: se muestran en cada mes
             general: "2025-10",               // opcional: ofrece "volver al general"
             alCambiar: function (valor) {}
         });
         sel.poner(v); sel.conteos(obj); sel.general(p); sel.valor(); sel.abrir();
    */
    var MESES_LARGOS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    var MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

    function textoPeriodo(v) {
        if (!v) return "Elegir periodo";
        if (v === "t:") return "Todos los periodos";
        if (v.indexOf("a:") === 0) return "Todo " + v.slice(2);
        if (v.indexOf("m:") === 0) return MESES_LARGOS[+v.slice(7, 9) - 1] + " " + v.slice(2, 6);
        if (v.indexOf("r:") === 0) return textoRango(v.slice(2).split("|"));
        return v;
    }

    /** "3 ene – 15 mar 2026", "20 dic 2025 – 10 ene 2026", "Desde 1 ene 2026"… */
    function textoRango(r) {
        function dia(f, conAnio) {
            return +f.slice(8, 10) + " " + MESES_CORTOS[+f.slice(5, 7) - 1].toLowerCase() + (conAnio ? " " + f.slice(0, 4) : "");
        }
        var d = r[0] || "", h = r[1] || "";
        if (d && h) return dia(d, d.slice(0, 4) !== h.slice(0, 4)) + " – " + dia(h, true);
        if (d) return "Desde " + dia(d, true);
        if (h) return "Hasta " + dia(h, true);
        return "Rango de fechas";
    }

    function selectorPeriodo(o) {
        var st = { valor: o.valor || null, conteos: o.conteos || {}, general: o.general || null, anio: null };
        var pop = document.createElement("div");
        pop.className = "fc-periodo";
        pop.setAttribute("role", "dialog");
        pop.setAttribute("aria-label", "Elegir periodo");
        pop.hidden = true;
        document.body.appendChild(pop);

        function anioInicial() {
            var v = st.valor;
            if (v && (v.indexOf("m:") === 0 || v.indexOf("a:") === 0)) return +v.slice(2, 6);
            if (v && v.indexOf("r:") === 0 && /^\d{4}/.test(v.slice(2))) return +v.slice(2, 6);
            var llaves = Object.keys(st.conteos).sort();
            return llaves.length ? +llaves[llaves.length - 1].slice(0, 4) : new Date().getFullYear();
        }

        function pintar() {
            var a = st.anio, hayConteos = Object.keys(st.conteos).length > 0, totalAnio = 0;
            var meses = MESES_CORTOS.map(function (nombre, i) {
                var clave = a + "-" + String(i + 1).padStart(2, "0");
                var n = st.conteos[clave] || 0;
                totalAnio += n;
                var activo = st.valor === "m:" + clave;
                return '<button type="button" class="fc-periodo__mes' + (activo ? " fc-periodo__mes--activo" : "") +
                    (hayConteos && !n ? " fc-periodo__mes--vacio" : "") + '" data-mes="' + clave + '"' +
                    ' title="' + MESES_LARGOS[i] + " " + a + (hayConteos ? " · " + n + " XML" : "") + '">' +
                    "<span>" + nombre + "</span>" + (hayConteos && n ? "<small>" + n.toLocaleString("es-MX") + "</small>" : "") + "</button>";
            }).join("");
            var pie = [];
            if (o.permitirAnio) pie.push('<button type="button" class="fc-periodo__opcion' + (st.valor === "a:" + a ? " fc-periodo__opcion--activa" : "") +
                '" data-anio-completo="' + a + '">Todo ' + a + (hayConteos && totalAnio ? " <small>" + totalAnio.toLocaleString("es-MX") + "</small>" : "") + "</button>");
            if (o.permitirTodos) pie.push('<button type="button" class="fc-periodo__opcion' + (st.valor === "t:" ? " fc-periodo__opcion--activa" : "") +
                '" data-todos>Todos los periodos</button>');
            if (st.general && st.valor !== "m:" + st.general) pie.push('<button type="button" class="fc-periodo__general" data-general>' +
                "Volver al periodo general · " + esc(textoPeriodo("m:" + st.general)) + "</button>");
            if (o.permitirQuitar && st.valor) pie.push('<button type="button" class="fc-periodo__quitar" data-quitar>Quitar periodo</button>');
            if (o.permitirRango) {
                // Días exactos, en el mismo lugar que los meses: así no hay un segundo
                // filtro de fechas en otro panel que choque con el periodo.
                var r = st.valor && st.valor.indexOf("r:") === 0 ? st.valor.slice(2).split("|") : rangoDe(st.valor, a);
                pie.push('<div class="fc-periodo__rango' + (st.valor && st.valor.indexOf("r:") === 0 ? " fc-periodo__rango--activo" : "") + '">' +
                    "<span>Rango de fechas</span>" +
                    '<label><small>Del</small><input type="date" data-rango-desde value="' + esc(r[0] || "") + '"></label>' +
                    '<label><small>al</small><input type="date" data-rango-hasta value="' + esc(r[1] || "") + '"></label>' +
                    '<button type="button" class="fc-periodo__aplicar" data-rango>Aplicar</button></div>');
            }
            pop.innerHTML =
                '<div class="fc-periodo__cabeza">' +
                  '<button type="button" class="fc-periodo__flecha" data-anio="-1" aria-label="Año anterior">‹</button>' +
                  "<strong>" + a + "</strong>" +
                  '<button type="button" class="fc-periodo__flecha" data-anio="1" aria-label="Año siguiente">›</button>' +
                "</div>" +
                '<div class="fc-periodo__meses">' + meses + "</div>" +
                (pie.length ? '<div class="fc-periodo__pie">' + pie.join("") + "</div>" : "");
        }

        /** Fechas con las que se abre el rango: las del mes o año elegido, o el año que se ve. */
        function rangoDe(v, anio) {
            if (v && v.indexOf("m:") === 0) {
                var y = +v.slice(2, 6), m = +v.slice(7, 9);
                return [v.slice(2) + "-01", v.slice(2) + "-" + String(new Date(y, m, 0).getDate()).padStart(2, "0")];
            }
            if (v && v.indexOf("a:") === 0) return [v.slice(2) + "-01-01", v.slice(2) + "-12-31"];
            return [anio + "-01-01", anio + "-12-31"];
        }

        function aplicarRango() {
            var d = pop.querySelector("[data-rango-desde]").value, h = pop.querySelector("[data-rango-hasta]").value;
            if (!d && !h) return;
            if (d && h && d > h) { var t = d; d = h; h = t; }
            elegir("r:" + d + "|" + h);
        }

        function posicionar() {
            var r = o.boton.getBoundingClientRect();
            var ancho = pop.offsetWidth || 300;
            pop.style.top = Math.round(r.bottom + 6) + "px";
            pop.style.left = Math.round(Math.max(12, Math.min(r.left, window.innerWidth - ancho - 12))) + "px";
        }

        function abrir() {
            st.anio = anioInicial();
            pintar();
            pop.hidden = false;
            o.boton.setAttribute("aria-expanded", "true");
            posicionar();
            if (o.alAbrir) o.alAbrir();
        }
        function cerrar() {
            if (pop.hidden) return;
            pop.hidden = true;
            o.boton.setAttribute("aria-expanded", "false");
        }
        function etiqueta() {
            if (o.etiqueta) o.etiqueta.textContent = textoPeriodo(st.valor);
            o.boton.classList.toggle("fc-sin-periodo", !st.valor);
        }
        function elegir(v) {
            st.valor = v;
            cerrar();
            etiqueta();
            if (o.alCambiar) o.alCambiar(v);
        }

        o.boton.addEventListener("click", function () { if (pop.hidden) abrir(); else cerrar(); });
        pop.addEventListener("click", function (e) {
            var b = e.target.closest("button");
            if (!b) return;
            if (b.dataset.anio) { st.anio += +b.dataset.anio; pintar(); return; }
            if (b.dataset.mes) { elegir("m:" + b.dataset.mes); return; }
            if (b.dataset.anioCompleto) { elegir("a:" + b.dataset.anioCompleto); return; }
            if (b.hasAttribute("data-todos")) { elegir("t:"); return; }
            if (b.hasAttribute("data-general")) { elegir("m:" + st.general); return; }
            if (b.hasAttribute("data-quitar")) { elegir(null); return; }
            if (b.hasAttribute("data-rango")) aplicarRango();
        });
        pop.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && e.target.matches("[data-rango-desde], [data-rango-hasta]")) { e.preventDefault(); aplicarRango(); }
        });
        // pointerdown (no click): así se cierra aunque otro menú detenga el clic
        document.addEventListener("pointerdown", function (e) {
            if (!pop.hidden && !pop.contains(e.target) && !o.boton.contains(e.target)) cerrar();
        }, true);
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") cerrar(); });
        window.addEventListener("resize", cerrar);
        etiqueta();

        return {
            poner: function (v) { st.valor = v || null; etiqueta(); },
            valor: function () { return st.valor; },
            conteos: function (c) { st.conteos = c || {}; },
            general: function (g) { st.general = g || null; },
            abrir: abrir,
            cerrar: cerrar
        };
    }

    /* El periodo general (mes y año) se guarda en el servidor, igual que la
       empresa: te sigue en cualquier PC. Los módulos lo precargan; cambiar el
       periodo dentro de un módulo NO lo toca. */
    var selectorGeneral = null;

    function pintarPeriodo() {
        var boton = document.getElementById("fc-btn-periodo");
        if (!boton) return;
        var p = perfilActual && perfilActual.periodo_activo;
        boton.hidden = false;
        boton.classList.toggle("fc-empresa--vacia", !p);
        boton.title = p ? "Periodo general: " + textoPeriodo("m:" + p) + " — cambiar" : "Elige el periodo en el que vas a trabajar";
        if (!selectorGeneral) {
            selectorGeneral = selectorPeriodo({
                boton: boton, etiqueta: document.getElementById("fc-periodo-nombre"),
                valor: p ? "m:" + p : null, permitirQuitar: true,
                alAbrir: function () { cerrarEmpresas(); var m = document.getElementById("fc-menu"); if (m) m.hidden = true; },
                alCambiar: elegirPeriodoGeneral
            });
        } else {
            selectorGeneral.poner(p ? "m:" + p : null);
        }
    }

    async function elegirPeriodoGeneral(valor) {
        var periodo = valor && valor.indexOf("m:") === 0 ? valor.slice(2) : null;
        try {
            var resp = await fetch(API + "/api/mi-perfil/periodo", {
                method: "PUT", credentials: "include",
                headers: { "Content-Type": "application/json" }, body: JSON.stringify({ periodo: periodo })
            });
            if (!resp.ok) throw new Error(await window.Fiscontable.leerError(resp));
            var r = await resp.json();
            perfilActual.periodo_activo = r.periodo_activo;
            promesaPerfil = Promise.resolve(perfilActual);
            pintarPeriodo();
            window.dispatchEvent(new CustomEvent("fiscontable:periodo", { detail: r.periodo_activo }));
        } catch (e) {
            pintarPeriodo();      // regresa el botón al valor que sí quedó guardado
            aviso(e.message || "No se pudo cambiar el periodo.");
        }
    }

    function avisoHTML() {
        return '<div class="fc-aviso" id="fc-aviso" role="status" hidden>' +
            '<span style="flex:none;width:18px;height:18px;margin-top:1px">' + ico(D.alerta) + "</span>" +
            '<div style="flex:1"><div id="fc-aviso-texto"></div>' +
            '<div class="fc-aviso__acciones" id="fc-aviso-acciones"></div></div></div>';
    }

    /* --------------------------------------------- panel de descargas */

    function pintarPanel() {
        var envoltorio = document.createElement("div");
        envoltorio.innerHTML =
            '<div class="fc-velo" id="fc-velo" hidden></div>' +
            '<aside class="fc-panel" id="fc-panel" role="dialog" aria-modal="true" aria-label="Mis descargas" hidden>' +
              '<div class="fc-panel__cabeza">' +
                "<div><div class=\"fc-panel__titulo\">Mis descargas</div>" +
                '<div class="fc-panel__sub" id="fc-panel-sub">Documentos listos y en preparación</div></div>' +
                '<button type="button" class="fc-panel__cerrar" id="fc-panel-cerrar" aria-label="Cerrar">' + ico(D.cerrar) + "</button>" +
              "</div>" +
              '<div class="fc-panel__cuerpo" id="fc-panel-cuerpo"></div>' +
              '<div class="fc-panel__pie"><a class="fc-btn" href="/descargas/" style="width:100%;justify-content:center">Ver el historial completo</a></div>' +
            "</aside>";
        while (envoltorio.firstChild) document.body.appendChild(envoltorio.firstChild);
    }

    var panelAbierto = false;
    var temporizador = null;
    var ultimaLista = [];
    var ultimoEstado = new Map();
    var primerSondeo = true;

    /* --- Qué procesos ya viste ---------------------------------------
       El contador tiene dos significados distintos y antes los mezclaba:
       lo que está corriendo (se limpia solo al terminar) y lo que acabó
       y todavía no has visto (eso sí hay que darlo por visto). Se guarda
       en el navegador para que siga valiendo cuando cambias de módulo.  */

    var LLAVE_VISTOS = "fc:procesos-vistos";

    function leerVistos() {
        try {
            return new Set(JSON.parse(localStorage.getItem(LLAVE_VISTOS) || "[]"));
        } catch (e) {
            return new Set();
        }
    }

    function guardarVistos(conjunto) {
        try {
            localStorage.setItem(LLAVE_VISTOS, JSON.stringify(Array.from(conjunto)));
        } catch (e) { /* si el navegador no deja guardar, el contador sigue funcionando */ }
    }

    var vistos = leerVistos();

    /** Da por visto todo lo que ya terminó (bien o mal). Lo que sigue
        corriendo se deja fuera: cuando acabe volverá a contar como nuevo. */
    function marcarComoVistos(procesos) {
        var antes = vistos.size;
        procesos.forEach(function (p) {
            if (p.estado !== "procesando") vistos.add(p.id);
        });
        // Se poda lo que el servidor ya borró, para que la lista no crezca sin fin.
        var vigentes = new Set(procesos.map(function (p) { return p.id; }));
        vistos.forEach(function (id) { if (!vigentes.has(id)) vistos.delete(id); });

        if (vistos.size !== antes) guardarVistos(vistos);
    }

    function abrirDescargas() {
        var velo = document.getElementById("fc-velo");
        var panel = document.getElementById("fc-panel");
        velo.hidden = false; panel.hidden = false;
        requestAnimationFrame(function () {
            velo.classList.add("abierto");
            panel.classList.add("abierto");
        });
        document.body.classList.add("fc-sin-scroll");
        panelAbierto = true;
        document.getElementById("fc-panel-cerrar").focus();

        if (ultimaLista.length) {
            pintarLista(ultimaLista);
            marcarComoVistos(ultimaLista);
            refrescarContador(ultimaLista);
        }
        sondear();
    }

    function cerrarDescargas() {
        var velo = document.getElementById("fc-velo");
        var panel = document.getElementById("fc-panel");
        velo.classList.remove("abierto");
        panel.classList.remove("abierto");
        document.body.classList.remove("fc-sin-scroll");
        panelAbierto = false;
        setTimeout(function () {
            if (panelAbierto) return;
            velo.hidden = true; panel.hidden = true;
        }, 260);
        var boton = document.getElementById("fc-btn-descargas");
        if (boton) boton.focus();
    }

    function fecha(iso) {
        if (!iso) return "";
        var f = new Date(iso + "Z");
        if (isNaN(f)) return "";
        var hoy = new Date();
        var hora = f.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
        if (f.toDateString() === hoy.toDateString()) return "Hoy " + hora;
        var ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
        if (f.toDateString() === ayer.toDateString()) return "Ayer " + hora;
        return f.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
    }

    var NOMBRES = {
        csf: "Constancia de Situación Fiscal",
        opinion: "Opinión de Cumplimiento",
        "csf+opinion": "Constancia y Opinión",
        declaraciones: "Declaraciones",
        voucheo: "Voucheo de impuestos",
        descarga_xml: "Descarga masiva de XML",
        programada_csf: "Programada · Constancias",
        programada_opinion: "Programada · Opiniones",
        programada_declaraciones: "Programada · Declaraciones",
        programada_xml: "Programada · Descarga de XML"
    };

    function tituloProceso(p) {
        var base = NOMBRES[p.tipo] || p.tipo || "Documento";
        if (p.clase === "lote") return base + " — " + (p.total || "varios") + " contribuyentes";
        return base + (p.titulo ? " — " + p.titulo : "");
    }

    function tarjeta(p) {
        var t = esc(tituloProceso(p));
        var nuevo = p.estado !== "procesando" && !vistos.has(p.id)
            ? '<span class="fc-punto" title="Nuevo desde la última vez"></span>' : "";

        if (p.estado === "procesando") {
            var detalle = "Preparando…", barra = "";
            if (p.clase === "lote" && p.total > 0) {
                var pct = Math.round((p.procesados / p.total) * 100);
                detalle = p.procesados + " de " + p.total + (p.rfc_actual ? " · " + esc(p.rfc_actual) : "");
                barra = '<div class="progress-track" style="margin-top:9px"><div class="progress-fill" style="width:' + pct + '%"></div></div>';
            } else if (p.progreso) {
                detalle = esc(p.progreso);
            }
            return '<div class="fc-item"><div class="fc-item__titulo">' + t + "</div>" +
                '<div class="fc-item__detalle">' + detalle + "</div>" + barra +
                '<div class="fc-item__acciones"><button type="button" class="fc-btn fc-btn--discreto" ' +
                'data-accion="detener" data-clase="' + esc(p.clase) + '" data-id="' + esc(p.id) + '">Detener</button></div></div>';
        }

        if (p.estado === "completado") {
            var resumen = fecha(p.creado_en);
            if (p.clase === "lote") resumen = p.exitosos + " de " + p.total + " obtenidos · " + resumen;
            var incompleta = false;
            if (p.resumen) {         // madrugada: "1 listo, 2 fallaron"
                var noche = p.resumen.replace(/^[^:]*:\s*/, "").replace(/\.$/, "");
                incompleta = /revisar|fall|no alcanz|cancelad/i.test(noche);
                resumen = noche + " · " + resumen;
            }
            return '<div class="fc-item' + (incompleta ? " fc-item--alerta" : "") + '"><div class="fc-item__titulo">' + nuevo + t + "</div>" +
                '<div class="fc-item__detalle">' + esc(resumen) + "</div>" +
                '<div class="fc-item__acciones">' +
                '<button type="button" class="fc-btn fc-btn--principal" data-accion="descargar" ' +
                'data-url="' + esc(p.url_descarga) + '" data-nombre="' + esc(p.nombre_descarga || "documento") + '">Descargar</button>' +
                '<button type="button" class="fc-btn fc-btn--discreto" data-accion="quitar" ' +
                'data-clase="' + esc(p.clase) + '" data-id="' + esc(p.id) + '">Quitar</button>' +
                "</div></div>";
        }

        return '<div class="fc-item fc-item--alerta"><div class="fc-item__titulo">' + nuevo + t + "</div>" +
            '<div class="fc-item__detalle">' + esc(p.mensaje_error || "No se pudo completar.") + "</div>" +
            '<div class="fc-item__acciones">' +
            '<a class="fc-btn" href="/descargas/">Ver detalle</a>' +
            '<button type="button" class="fc-btn fc-btn--discreto" data-accion="quitar" ' +
            'data-clase="' + esc(p.clase) + '" data-id="' + esc(p.id) + '">Quitar</button>' +
            "</div></div>";
    }

    function pintarLista(procesos) {
        var cuerpo = document.getElementById("fc-panel-cuerpo");
        if (!cuerpo) return;

        if (!procesos.length) {
            cuerpo.innerHTML = '<div class="fc-vacio">Todavía no hay nada aquí.<br>' +
                "Lo que generes va a aparecer en esta lista.</div>";
            return;
        }

        var grupos = [
            ["En preparación", procesos.filter(function (p) { return p.estado === "procesando"; })],
            ["Listos para descargar", procesos.filter(function (p) { return p.estado === "completado"; })],
            ["Sin resultado", procesos.filter(function (p) { return p.estado !== "procesando" && p.estado !== "completado"; })]
        ];

        cuerpo.innerHTML = grupos.filter(function (g) { return g[1].length; }).map(function (g) {
            return '<div class="fc-grupo"><div class="fc-grupo__titulo">' + g[0] + "</div>" +
                g[1].map(tarjeta).join("") + "</div>";
        }).join("");
    }

    function avisarNavegador(titulo, cuerpo) {
        if (!("Notification" in window) || Notification.permission !== "granted") return;
        try { new Notification(titulo, { body: cuerpo }); } catch (e) { /* sin permiso real */ }
    }

    /**
     * Recalcula el número del botón y devuelve cuántos procesos siguen
     * corriendo. El número suma dos cosas: lo que corre (se descuenta solo
     * al terminar) y lo que ya terminó pero no has visto (se descuenta al
     * abrir el panel). Si no hay ni una ni otra, el número desaparece.
     */
    function refrescarContador(procesos) {
        var activos = procesos.filter(function (p) { return p.estado === "procesando"; }).length;
        var nuevos = procesos.filter(function (p) {
            return p.estado !== "procesando" && !vistos.has(p.id);
        }).length;
        var total = activos + nuevos;

        var contador = document.getElementById("fc-contador");
        if (contador) {
            contador.textContent = total;
            contador.hidden = total === 0;
            contador.style.background = activos ? "#F59E0B" : "#12B76A";
            contador.style.color = activos ? "#241503" : "#FFFFFF";
        }

        var boton = document.getElementById("fc-btn-descargas");
        if (boton) {
            boton.classList.toggle("fc-accion--activa", activos > 0);
            boton.setAttribute("aria-label", activos
                ? "Mis descargas — " + activos + " en proceso"
                : (nuevos ? "Mis descargas — " + nuevos + " sin ver" : "Mis descargas"));
        }
        return activos;
    }

    async function sondear() {
        try {
            var resp = await fetch(API + "/api/procesos", { credentials: "include" });
            if (!resp.ok) { programar(); return; }
            var procesos = await resp.json();
            ultimaLista = procesos;

            var activos = refrescarContador(procesos);

            // Aviso del navegador cuando algo pasa de "procesando" a terminado.
            procesos.forEach(function (p) {
                var antes = ultimoEstado.get(p.id);
                if (!primerSondeo && antes === "procesando" && p.estado !== "procesando") {
                    avisarNavegador(
                        p.estado !== "completado" ? "No se pudo completar" : (/revisar|fall|no alcanz|cancelad/i.test(p.resumen || "") ? "Terminó, pero no salieron todos" : "Documento listo"),
                        tituloProceso(p)
                    );
                }
                ultimoEstado.set(p.id, p.estado);
            });
            primerSondeo = false;

            if (panelAbierto) {
                pintarLista(procesos);
                // Estás viéndolos: dejan de ser novedad, y el número baja
                // en el momento, sin esperar al siguiente sondeo.
                marcarComoVistos(procesos);
                refrescarContador(procesos);
            }
            programar(activos > 0);
        } catch (e) {
            programar();
        }
    }

    function programar(hayActivos) {
        clearTimeout(temporizador);
        // Si hay algo corriendo y el panel está abierto, seguimos de cerca.
        // Si no, apenas lo suficiente para que el contador no mienta.
        var espera = hayActivos ? (panelAbierto ? 3000 : 10000) : (panelAbierto ? 8000 : 45000);
        temporizador = setTimeout(function () {
            if (!document.hidden) sondear();
            else programar(hayActivos);
        }, espera);
    }

    async function accionPanel(e) {
        var boton = e.target.closest("[data-accion]");
        if (!boton) return;
        var accion = boton.dataset.accion;
        var original = boton.textContent;
        boton.disabled = true;

        try {
            if (accion === "descargar") {
                boton.textContent = "Descargando…";
                var r = await fetch(API + boton.dataset.url, { credentials: "include" });
                if (!r.ok) throw new Error();
                var blob = await r.blob();
                var url = URL.createObjectURL(blob);
                var a = document.createElement("a");
                a.href = url; a.download = boton.dataset.nombre;
                a.click();
                setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
            } else if (accion === "quitar") {
                await fetch(API + "/api/procesos/" + boton.dataset.clase + "/" + boton.dataset.id,
                    { method: "DELETE", credentials: "include" });
                ultimoEstado.delete(boton.dataset.id);
                await sondear();
                return;
            } else if (accion === "detener") {
                boton.textContent = "Deteniendo…";
                var ruta = boton.dataset.clase === "lote"
                    ? "/api/lotes/" + boton.dataset.id + "/cancelar"
                    : boton.dataset.clase === "programada"
                        ? "/api/programadas/" + boton.dataset.id + "/cancelar"
                        : "/api/trabajos/" + boton.dataset.id + "/cancelar";
                await fetch(API + ruta, { method: "POST", credentials: "include" });
                await sondear();
                return;
            }
        } catch (err) {
            aviso("No se pudo completar esa acción. Revisa tu conexión e intenta de nuevo.");
        } finally {
            boton.disabled = false;
            boton.textContent = original;
        }
    }

    /* ------------------------------------------------------- el perfil */

    var promesaPerfil = null;
    var perfilActual = null;

    // El modal vive aquí, no en la portada: así "Editar mi perfil"
    // funciona desde cualquier módulo sin mandarte de vuelta al inicio.
    function pintarModalPerfil() {
        var caja = document.createElement("div");
        caja.id = "fc-modal-perfil";
        caja.className = "fixed inset-0 hidden items-center justify-center p-4";
        // display:none propio: antes dependía de la clase "hidden" de Tailwind, y si el
        // CDN de Tailwind no cargaba, la ventana quedaba invisible ENCIMA de toda la página
        // bloqueando los clics. .modal-active (common.css) la muestra con !important.
        caja.style.cssText = "display:none;position:fixed;inset:0;z-index:90;background:rgba(16,27,45,.5);" +
            "backdrop-filter:blur(2px);align-items:center;justify-content:center;padding:16px";
        caja.innerHTML =
            '<div style="background:#fff;width:100%;max-width:420px;border-radius:var(--radio);' +
            'box-shadow:var(--sombra-alta);overflow:hidden">' +
              '<div style="padding:18px 20px;border-bottom:1px solid var(--linea)">' +
                '<div style="font-size:16px;font-weight:700" id="fc-mp-titulo">Mi perfil</div>' +
                '<div style="font-size:13px;color:var(--texto-tenue);margin-top:3px" id="fc-mp-sub"></div>' +
              "</div>" +
              '<form id="fc-mp-form" style="padding:20px;display:flex;flex-direction:column;gap:14px">' +
                '<label style="display:block"><span style="font-size:13px;font-weight:600">Nombre completo</span>' +
                  '<input id="fc-mp-nombre" type="text" required placeholder="Ej. Alan Sánchez" ' +
                  'style="width:100%;margin-top:6px;padding:11px;border:1px solid var(--linea);border-radius:10px;font:inherit;font-size:14px"></label>' +
                '<label style="display:block"><span style="font-size:13px;font-weight:600">Teléfono</span> ' +
                  '<span style="font-size:12.5px;color:var(--texto-tenue)">(opcional)</span>' +
                  '<input id="fc-mp-telefono" type="tel" placeholder="Ej. 998 123 4567" ' +
                  'style="width:100%;margin-top:6px;padding:11px;border:1px solid var(--linea);border-radius:10px;font:inherit;font-size:14px"></label>' +
                '<label style="display:block"><span style="font-size:13px;font-weight:600">Correo</span>' +
                  '<input id="fc-mp-correo" type="text" readonly class="campo-solo-lectura" ' +
                  'style="width:100%;margin-top:6px;padding:11px;border:1px solid var(--linea);border-radius:10px;font:inherit;font-size:14px">' +
                  '<span style="display:block;font-size:12px;color:var(--texto-tenue);margin-top:5px">' +
                  "Viene de tu acceso y no se cambia aquí.</span></label>" +
                '<div style="display:flex;gap:10px;margin-top:4px">' +
                  '<button type="button" class="fc-btn" id="fc-mp-cancelar" style="flex:1;justify-content:center;padding:11px">Cancelar</button>' +
                  '<button type="submit" class="fc-btn fc-btn--principal" id="fc-mp-guardar" style="flex:1;justify-content:center;padding:11px">Guardar</button>' +
                "</div>" +
              "</form></div>";
        document.body.appendChild(caja);

        document.getElementById("fc-mp-cancelar").addEventListener("click", cerrarModalPerfil);
        document.getElementById("fc-mp-form").addEventListener("submit", guardarPerfil);
    }

    function abrirModalPerfil(esPrimeraVez) {
        if (!perfilActual) return;
        var caja = document.getElementById("fc-modal-perfil");
        document.getElementById("fc-menu").hidden = true;
        document.getElementById("fc-mp-nombre").value = perfilActual.nombre || "";
        document.getElementById("fc-mp-telefono").value = perfilActual.telefono || "";
        document.getElementById("fc-mp-correo").value = perfilActual.correo || "";
        document.getElementById("fc-mp-titulo").textContent = esPrimeraVez ? "Te damos la bienvenida" : "Mi perfil";
        document.getElementById("fc-mp-sub").textContent = esPrimeraVez
            ? "Sólo falta tu nombre para personalizar tu espacio. Lo puedes cambiar después."
            : "Actualiza tus datos de contacto.";
        document.getElementById("fc-mp-cancelar").style.display = esPrimeraVez ? "none" : "";
        caja.dataset.noCerrable = esPrimeraVez ? "true" : "false";
        caja.classList.add("modal-active");
        document.getElementById("fc-mp-nombre").focus();
    }

    function cerrarModalPerfil() {
        document.getElementById("fc-modal-perfil").classList.remove("modal-active");
    }

    async function guardarPerfil(e) {
        e.preventDefault();
        var boton = document.getElementById("fc-mp-guardar");
        boton.disabled = true;
        boton.textContent = "Guardando…";
        try {
            var resp = await fetch(API + "/api/mi-perfil", {
                method: "PUT",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    nombre: document.getElementById("fc-mp-nombre").value.trim(),
                    telefono: document.getElementById("fc-mp-telefono").value.trim()
                })
            });
            if (!resp.ok) { aviso("No se pudo guardar tu perfil. Intenta de nuevo."); return; }
            promesaPerfil = Promise.resolve(await resp.json());
            pintarPerfil(await promesaPerfil);
            cerrarModalPerfil();
        } catch (err) {
            aviso("No se pudo guardar tu perfil. Revisa tu conexión e intenta de nuevo.");
        } finally {
            boton.disabled = false;
            boton.textContent = "Guardar";
        }
    }

    function perfil() {
        if (!promesaPerfil) {
            promesaPerfil = (async function () {
                try {
                    var resp = await fetch(API + "/api/mi-perfil", { credentials: "include" });
                    if (resp.status === 401 || resp.status === 403) return { _error: "sesion" };
                    if (!resp.ok) return { _error: "servidor" };
                    return await resp.json();
                } catch (e) {
                    return { _error: "conexion" };
                }
            })();
        }
        return promesaPerfil;
    }

    function vigencia(p) {
        if (!p.activo) return "Desactivado";
        if (!p.fecha_expira) return "Sin vencimiento";
        var f = new Date(p.fecha_expira);
        var texto = f.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
        return p.expirado ? "Venció el " + texto : "Hasta " + texto;
    }

    function pintarPerfil(p) {
        perfilActual = p;
        var nombre = p.nombre || (p.correo || "").split("@")[0] || "Tu cuenta";

        document.getElementById("fc-avatar").textContent = nombre.charAt(0).toUpperCase();
        document.getElementById("fc-nombre-corto").textContent = nombre.split(" ")[0];
        document.getElementById("fc-menu-nombre").textContent = p.nombre || "Sin nombre";
        document.getElementById("fc-menu-correo").textContent = p.correo || "";
        document.getElementById("fc-menu-telefono").textContent = p.telefono || "Sin teléfono";
        document.getElementById("fc-menu-plan").textContent = p.rol || "—";
        document.getElementById("fc-menu-vigencia").textContent = vigencia(p);

        if (p.rol === "admin") document.getElementById("fc-enlace-admin").hidden = false;
        pintarLetreros(p);
        pintarEmpresa();
        pintarPeriodo();

        if (p.solo_lectura) {
            aviso("Tu acceso venció. Puedes consultar tu directorio, pero no generar documentos. " +
                "Contacta al administrador para renovarlo.");
        }
        // Primer ingreso: pedimos el nombre una sola vez, caiga donde caiga.
        if (!p.perfil_completo) abrirModalPerfil(true);
        document.dispatchEvent(new CustomEvent("fc:perfil", { detail: p }));
    }

    function manejarErrorPerfil(tipo) {
        var acciones = [
            { texto: "Reconectar sesión", href: API + "/" },
            { texto: "Reintentar", accion: function () { promesaPerfil = null; iniciarPerfil(); } }
        ];
        if (tipo === "sesion") {
            aviso("Tu sesión con el servidor expiró. Reconéctala para continuar.", acciones);
        } else {
            aviso("No pudimos conectar con el servidor. Puede que tu sesión haya expirado o que el " +
                "servidor no esté disponible ahora mismo.", acciones);
        }
        document.dispatchEvent(new CustomEvent("fc:perfil", { detail: null }));
    }

    async function iniciarPerfil() {
        ocultarAviso();
        var p = await perfil();
        if (p && p._error) { manejarErrorPerfil(p._error); return; }
        pintarPerfil(p);
    }

    /* ------------------------------------------------ letreros globales */
    /* Los publica el administrador desde Administración → Sistema y llegan
       con /api/mi-perfil: el modo mantenimiento (no se cierra) y el aviso
       global (se puede cerrar; vuelve a salir si el aviso cambia). */

    function pintarLetreros(p) {
        var viejo = document.getElementById("fc-letreros");
        if (viejo) viejo.remove();
        var barra = document.querySelector(".fc-barra");
        if (!barra) return;

        var caja = document.createElement("div");
        caja.id = "fc-letreros";

        function letrero(texto, colores, cerrable, alCerrar) {
            var fila = document.createElement("div");
            fila.setAttribute("role", "status");
            fila.style.cssText = "display:flex;align-items:flex-start;gap:12px;justify-content:center;" +
                "padding:10px 16px;font-size:13.5px;font-weight:600;line-height:1.4;" + colores;
            var t = document.createElement("span");
            t.textContent = texto;
            t.style.maxWidth = "900px";
            fila.appendChild(t);
            if (cerrable) {
                var b = document.createElement("button");
                b.type = "button";
                b.textContent = "✕";
                b.title = "Ocultar este aviso";
                b.setAttribute("aria-label", "Ocultar este aviso");
                b.style.cssText = "background:none;border:0;cursor:pointer;font-size:14px;opacity:.7;padding:0 4px;color:inherit";
                b.addEventListener("click", function () { fila.remove(); alCerrar(); });
                fila.appendChild(b);
            }
            caja.appendChild(fila);
        }

        if (p.mantenimiento) {
            letrero("Portal en mantenimiento: por ahora no se pueden iniciar descargas nuevas. Lo que ya estaba corriendo sigue." +
                (p.rol === "admin" ? " (Tú, como administrador, sigues pudiendo usar todo.)" : ""),
                "background:#FEF3C7;color:#78350F;border-bottom:1px solid #FCD34D", false);
        }
        if (p.aviso && p.aviso.texto) {
            var clave = "fc-aviso-oculto:" + (p.aviso.publicado_en || "") + ":" + p.aviso.texto;
            var oculto = false;
            try { oculto = localStorage.getItem("fc-aviso-oculto") === clave; } catch (e) { /* sin almacenamiento */ }
            if (!oculto) {
                letrero(p.aviso.texto,
                    p.aviso.tipo === "atencion"
                        ? "background:#FFF7ED;color:#9A3412;border-bottom:1px solid #FDBA74"
                        : "background:#EFF6FF;color:#1E3A8A;border-bottom:1px solid #BFDBFE",
                    true,
                    function () { try { localStorage.setItem("fc-aviso-oculto", clave); } catch (e) { /* nada */ } });
            }
        }
        // Lo pone solo el monitor del SAT (Administración → Sistema) mientras un servicio no responde.
        if (p.sat_fallas && p.sat_fallas.length) {
            var claveSat = "fc-sat-oculto:" + p.sat_fallas.map(function (s) { return s.servicio + "@" + (s.desde || ""); }).join(",");
            var ocultoSat = false;
            try { ocultoSat = localStorage.getItem("fc-sat-oculto") === claveSat; } catch (e) { /* sin almacenamiento */ }
            if (!ocultoSat) {
                var nombres = p.sat_fallas.map(function (s) { return s.nombre; });
                var lista = nombres.length > 1 ? nombres.slice(0, -1).join(", ") + " y " + nombres[nombres.length - 1] : nombres[0];
                letrero("El SAT no está respondiendo en: " + lista + ". Lo que pidas ahí puede fallar; conviene intentarlo más tarde. " +
                    "Este aviso se quita solo cuando vuelva.",
                    "background:#FEF2F2;color:#991B1B;border-bottom:1px solid #FECACA",
                    true,
                    function () { try { localStorage.setItem("fc-sat-oculto", claveSat); } catch (e) { /* nada */ } });
            }
        }
        if (caja.children.length) barra.insertAdjacentElement("afterend", caja);
    }

    /* ------------------------------------------------ avisos y bloqueo */

    function aviso(mensaje, acciones) {
        var caja = document.getElementById("fc-aviso");
        if (!caja) return;
        document.getElementById("fc-aviso-texto").textContent = mensaje;
        var zona = document.getElementById("fc-aviso-acciones");
        zona.innerHTML = "";
        (acciones || []).forEach(function (a) {
            var el;
            if (a.href) {
                el = document.createElement("a");
                el.href = a.href; el.target = "_blank"; el.rel = "noopener";
            } else {
                el = document.createElement("button");
                el.type = "button";
                el.addEventListener("click", a.accion);
            }
            el.className = "fc-btn";
            el.textContent = a.texto;
            zona.appendChild(el);
        });
        caja.hidden = false;
    }

    function ocultarAviso() {
        var caja = document.getElementById("fc-aviso");
        if (caja) caja.hidden = true;
    }

    function bloquear(mensaje) {
        var main = document.querySelector("main");
        if (!main) return;
        main.innerHTML = '<div class="fc-bloqueo">' + ico(D.candado, 1.6) +
            "<p>" + esc(mensaje) + "</p>" +
            '<a class="fc-btn fc-btn--principal" style="margin-top:16px" href="/herramientas/">Ver mis herramientas</a></div>';
    }

    /**
     * Verifica que el usuario pueda usar este módulo ANTES de que llene
     * nada. Antes sólo Herramientas lo hacía; Declaraciones, Validador y
     * Conciliación dejaban que el backend rechazara al final.
     */
    async function exigirModulo(permiso) {
        var requerido = permiso || modulo.permiso;
        var p = await perfil();

        if (!p || p._error) {
            bloquear(p && p._error === "sesion"
                ? "Tu sesión expiró. Recarga la página para entrar de nuevo."
                : "No pudimos conectar con el servidor. Intenta más tarde o contacta al administrador.");
            return false;
        }
        if (p.solo_lectura) {
            bloquear("Tu acceso venció. No puedes generar documentos hasta que se renueve. " +
                "Contacta al administrador.");
            return false;
        }
        if (requerido && !(p.modulos_permitidos || []).includes(requerido)) {
            bloquear("Tu plan actual no incluye " + modulo.nombre + ". " +
                "Contacta al administrador si necesitas acceso.");
            return false;
        }
        return true;
    }

    /* ------------------------------------------------------- arranque */

    pintarBarra();
    pintarPanel();
    pintarModalPerfil();

    document.getElementById("fc-btn-descargas").addEventListener("click", abrirDescargas);
    document.getElementById("fc-panel-cerrar").addEventListener("click", cerrarDescargas);
    document.getElementById("fc-velo").addEventListener("click", cerrarDescargas);
    document.getElementById("fc-panel-cuerpo").addEventListener("click", accionPanel);

    prepararEmpresas();

    var btnPerfil = document.getElementById("fc-btn-perfil");
    var menu = document.getElementById("fc-menu");

    btnPerfil.addEventListener("click", function (e) {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
        btnPerfil.setAttribute("aria-expanded", String(!menu.hidden));
    });

    document.getElementById("fc-btn-editar-perfil").addEventListener("click", function () {
        menu.hidden = true;
        abrirModalPerfil(false);
    });

    document.addEventListener("click", function (e) {
        if (!menu.hidden && !menu.contains(e.target) && !btnPerfil.contains(e.target)) {
            menu.hidden = true;
            btnPerfil.setAttribute("aria-expanded", "false");
        }
    });

    // ESC cierra lo más superficial primero. Antes sólo funcionaba en
    // 3 de las 12 páginas, y con reglas distintas en cada una.
    document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        if (panelAbierto) { cerrarDescargas(); return; }
        if (!menu.hidden) { menu.hidden = true; btnPerfil.setAttribute("aria-expanded", "false"); return; }
        document.querySelectorAll(".modal-active").forEach(function (m) {
            if (m.dataset.noCerrable === "true") return;
            m.classList.remove("modal-active");
        });
    });

    document.addEventListener("visibilitychange", function () {
        if (!document.hidden) sondear();
    });

    // Un solo temporizador vivo por página, y se apaga al salir: antes
    // cada módulo dejaba su propio setInterval corriendo.
    window.addEventListener("pagehide", function () { clearTimeout(temporizador); });

    // Tablas anchas: se envuelven en un carril con desplazamiento lateral
    // para que en el teléfono se puedan ver de lado en vez de romper la
    // página. Funciona en cualquier módulo, presente o futuro.
    document.querySelectorAll("main table").forEach(function (tabla) {
        if (tabla.closest(".fc-carril")) return;
        var carril = document.createElement("div");
        carril.className = "fc-carril";
        tabla.parentNode.insertBefore(carril, tabla);
        carril.appendChild(tabla);
    });

    iniciarPerfil();
    sondear();

    Object.assign(window.Fiscontable, {
        modulo: clave,
        perfil: perfil,
        exigirModulo: exigirModulo,
        bloquear: bloquear,
        aviso: aviso,
        ocultarAviso: ocultarAviso,
        abrirDescargas: abrirDescargas,
        cerrarDescargas: cerrarDescargas,
        refrescarDescargas: sondear,
        abrirModalPerfil: abrirModalPerfil,
        // La empresa elegida en el selector general (o null). Los módulos también
        // pueden escuchar window "fiscontable:empresa" para enterarse de un cambio.
        elegirEmpresa: function (rfc) { return elegirEmpresa(rfc); },
        empresaActiva: function () {
            return perfil().then(function (p) { return p && !p._error ? (p.empresa_activa || null) : null; });
        },
        // Periodo general ("AAAA-MM" o null). Evento: window "fiscontable:periodo".
        periodoActivo: function () {
            return perfil().then(function (p) { return p && !p._error ? (p.periodo_activo || null) : null; });
        },
        elegirPeriodo: function (periodo) { return elegirPeriodoGeneral(periodo ? "m:" + periodo : null); },
        // Componente reutilizable para cualquier módulo (ver comentario arriba)
        selectorPeriodo: selectorPeriodo,
        textoPeriodo: textoPeriodo,
        // Para Administración → Sistema: vuelve a pedir el perfil y repinta los letreros.
        recargarLetreros: async function () {
            promesaPerfil = null;
            var p = await perfil();
            if (p && !p._error) { perfilActual = p; pintarLetreros(p); }
        }
    });
})();
