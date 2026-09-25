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
        conciliacion:  { nombre: "Facturas PPD",          acento: "#1D4ED8", suave: "#E8EFFD", permiso: "conciliacion" },
        validador:     { nombre: "Validador SAT",         acento: "#047857", suave: "#E6F4EF", permiso: "validador" },
        constancias:   { nombre: "Constancias",           acento: "#4338CA", suave: "#ECEBFB", permiso: "constancias" },
        opinion:       { nombre: "Opinión 32-D",          acento: "#0F766E", suave: "#E6F2F1", permiso: "opinion" },
        voucheo:       { nombre: "Voucheo",               acento: "#B45309", suave: "#FBF0E2", permiso: "voucheo" },
        declaraciones: { nombre: "Declaraciones",         acento: "#0369A1", suave: "#E4F1F9", permiso: "declaraciones" },
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
        descarga: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4",
        engrane:  "M10.3 4.3c.4-1.7 2.9-1.7 3.4 0a1.7 1.7 0 002.5 1.1c1.6-.9 3.3.8 2.4 2.4a1.7 1.7 0 001.1 2.5c1.7.4 1.7 2.9 0 3.4a1.7 1.7 0 00-1.1 2.5c.9 1.6-.8 3.3-2.4 2.4a1.7 1.7 0 00-2.5 1.1c-.4 1.7-2.9 1.7-3.4 0a1.7 1.7 0 00-2.5-1.1c-1.6.9-3.3-.8-2.4-2.4a1.7 1.7 0 00-1.1-2.5c-1.7-.4-1.7-2.9 0-3.4a1.7 1.7 0 001.1-2.5c-.9-1.6.8-3.3 2.4-2.4 1 .6 2.3.1 2.5-1.1zM15 12a3 3 0 11-6 0 3 3 0 016 0z",
        persona:  "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
        salir:    "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
        cerrar:   "M6 18L18 6M6 6l12 12",
        alerta:   "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
        candado:  "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z M16 11V7a4 4 0 00-8 0v4",
        flecha:   "M9 18l6-6-6-6"
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
                menuPerfilHTML() +
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
        voucheo: "Voucheo de impuestos"
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
            return '<div class="fc-item"><div class="fc-item__titulo">' + nuevo + t + "</div>" +
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
                        p.estado === "completado" ? "Documento listo" : "No se pudo completar",
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
        caja.style.cssText = "position:fixed;inset:0;z-index:90;background:rgba(16,27,45,.5);" +
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
        abrirModalPerfil: abrirModalPerfil
    });
})();
