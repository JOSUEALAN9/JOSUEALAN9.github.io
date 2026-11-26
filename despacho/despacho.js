/**
 * despacho.js — Mi despacho. Lo ve cada persona del despacho:
 *   Equipo        quién está y con qué papel; el titular cambia permisos, invita y quita.
 *   Solicitudes   pedir acceso a una empresa; el titular y quienes aprueban aceptan o rechazan.
 *   Bitácora      quién hizo qué en las empresas del despacho (titular y quienes aprueban).
 *   Ajustes       nombre, correo de avisos y si las personas nuevas tienen su propio espacio (titular).
 * Mi espacio (20-nov-2026, el dueño): en Equipo el titular ve cuántas empresas lleva cada quien en su Mi espacio («4 de 10»,
 * nunca cuáles) y en Permisos › Mi espacio le cambia el tope, le apaga Mi espacio y le pasa o regresa timbres del
 * despacho; en Permisos › Módulos hay dos listas: «En el despacho» y «Extra en Mi espacio».
 * Fotos (23-nov-2026, el dueño: «la foto del equipo sí que se vea, y que al picarle te la abra en grande»): en Equipo sale la
 * foto de cada quien en su círculo (la chica, cuando la fila se ve; si no tiene, sus iniciales) y al picarle se abre en
 * grande con el visor compartido (assets/js/visor-foto.js). El servidor solo la da entre integrantes activos del despacho.
 * El servidor decide qué ve cada quien (modulos/despacho/router.py); aquí solo se pinta.
 */
(function () {
    "use strict";
    var F = window.Fiscontable, API = F.API, esc = F.escapar;
    var datos = null, filtroSol = "pendiente", edicion = null;
    var fotos = {}, vigia = null;                 // fotos chicas ya traídas: «correo|marca» → dirección local (se reusan al repintar)
    var AYUDA_PAPEL = {
        // 23-nov-2026 (auditoría despacho-3): el interruptor «registrar y quitar» ya manda también para quien aprueba,
        // y «Borrar todo» de una empresa del despacho solo lo hace el titular
        titular: "Administra el equipo, los permisos y los ajustes, y acepta solicitudes. Ve todo el despacho. Solo él puede borrar todo de una empresa.",
        aprobador: "Acepta o rechaza las solicitudes del equipo y ve la bitácora. Las suyas las resuelve el titular. Trabaja con lo que le permitas: registra o quita empresas solo si le prendes ese permiso.",
        miembro: "Trabaja con las empresas y los módulos que le des."
    };

    function $(id) { return document.getElementById(id); }

    async function pedir(ruta, opciones) {
        opciones = opciones || {};
        var conf = { method: opciones.method || "GET", credentials: "include" };
        if (opciones.body !== undefined) { conf.headers = { "Content-Type": "application/json" }; conf.body = JSON.stringify(opciones.body); }
        var r = await fetch(API + ruta, conf);
        if (!r.ok) throw new Error(await F.leerError(r));
        return r.json();
    }

    function fecha(iso) {
        if (!iso) return "";
        var d = new Date(/Z$|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
        return isNaN(d) ? iso : d.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    }

    function inicial(texto) { return esc(String(texto || "?").trim().charAt(0).toUpperCase()); }

    function aviso(texto) { if (F.toast) F.toast(texto); }

    // ------------------------------------------------------------------ cargar
    async function cargar() {
        try {
            datos = await pedir("/api/despacho");
        } catch (e) {
            $("dp-cargando").className = "ui-tarjeta ui-falla";
            $("dp-cargando").innerHTML = "<b>No se pudo cargar</b>" + esc(e.message) +
                '<button type="button" class="ui-btn ui-btn--secundario" id="dp-reintentar">Reintentar</button>';
            $("dp-reintentar").addEventListener("click", function () { location.reload(); });
            return;
        }
        $("dp-cargando").hidden = true;
        if (!datos.despacho) return pintarSin();
        pintar();
    }

    function pintarSin() {
        $("dp-sin").hidden = false;
        // 24-nov-2026 (auditoría del 22-nov, despacho-9): a quien el titular suspendió ya no le dice «No eres parte de un
        // despacho»: le dice de cuál y con quién hablar (el mismo texto del letrero de arriba)
        if (datos.suspendido) {
            $("dp-sin-titulo").textContent = "Tu acceso al despacho «" + datos.suspendido.despacho + "» está suspendido";
            $("dp-sin-texto").textContent = datos.suspendido.texto + " Mientras tanto no ves sus empresas.";
        }
        if (datos.salida) {                       // salió hace poco: su Mi espacio quedó en solo lectura
            $("dp-salida").hidden = false;
            $("dp-salida-texto").textContent = datos.salida.texto;
        }
        var inv = datos.invitacion;
        if (!inv) return;
        $("dp-invitacion").hidden = false;
        $("dp-invitacion-texto").textContent = ((inv.invito_nombre || inv.invito) ? (inv.invito_nombre || inv.invito) + " te invitó" : "Te invitaron") + " al despacho «" + inv.despacho +
            "» como " + inv.papel + ".";
    }

    function pintar() {
        var d = datos.despacho;
        $("dp-con").hidden = false;
        $("dp-titulo").textContent = d.nombre;
        var activos = datos.equipo.filter(function (m) { return m.estado === "activo"; }).length;
        $("dp-sub").textContent = datos.yo.nombre_papel + " · " + activos + (activos === 1 ? " persona" : " personas") +
            (d.vigente === false ? " · la licencia del despacho venció" : "");
        $("dp-invitar").hidden = !datos.titular;
        // 24-nov-2026 (auditoría del 21-nov, B1): el nombre lo puso Fiscontable al activar: que el titular lo confirme
        var porConfirmar = !!(datos.titular && d.ajustes && d.ajustes.nombre_por_confirmar);
        $("dp-nombre").hidden = !porConfirmar;
        if (porConfirmar && document.activeElement !== $("dp-nombre-campo")) $("dp-nombre-campo").value = d.nombre || "";
        document.querySelector('[data-vista="bitacora"]').hidden = !datos.aprueba;
        document.querySelector('[data-vista="ajustes"]').hidden = !datos.titular;
        var n = datos.pendientes || 0;
        $("dp-n-pendientes").hidden = !n;
        $("dp-n-pendientes").textContent = n;
        $("dp-sol-titulo").textContent = datos.aprueba ? "Solicitudes del equipo" : "Mis solicitudes";
        // Pedir acceso solo tiene sentido si no tiene todas las empresas
        document.querySelector(".dp-pedir").hidden = datos.yo.empresas === null;
        $("dp-salir").hidden = datos.titular && datos.equipo.filter(function (m) { return m.papel === "titular"; }).length <= 1;
        pintarYo();
        pintarEquipo();
        if (datos.titular) llenarAjustes();
        var q = new URLSearchParams(location.search).get("vista");
        mostrarVista(q && document.querySelector('[data-vista="' + q + '"]:not([hidden])') ? q : "equipo");
    }

    // ------------------------------------------------------------------ vistas
    function mostrarVista(clave) {
        document.querySelectorAll(".dp-vistas [data-vista]").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.vista === clave)); });
        document.querySelectorAll("[data-panel]").forEach(function (p) { p.hidden = p.dataset.panel !== clave; });
        var url = new URL(location.href);
        if (clave === "equipo") url.searchParams.delete("vista"); else url.searchParams.set("vista", clave);
        history.replaceState(null, "", url.pathname + url.search);
        if (clave === "solicitudes") cargarSolicitudes();
        if (clave === "bitacora") cargarBitacora();
        if (clave === "tramites") cargarTramites();
    }

    // ------------------------------------------------------------------ equipo
    function resumenPermisos(m) {
        if (m.papel === "titular") return "Todo el despacho";
        var partes = [];
        partes.push(m.empresas === null ? "Todas las empresas" : m.empresas.length + (m.empresas.length === 1 ? " empresa" : " empresas"));
        partes.push(m.modulos === null ? "todos los módulos" : m.modulos.length + (m.modulos.length === 1 ? " módulo" : " módulos"));
        if (m.agregar_propio) partes.push("registra empresas");
        if (m.solo_lectura) partes.push("solo consulta");
        if (m.sin_conexion) partes.push("su PC trabaja sin conexión");
        return partes.join(" · ");
    }

    // Mi espacio de una persona tal como lo ve el titular: solo números (nunca cuáles empresas)
    function textoMiEspacio(m) {
        var e = m.mi_espacio || {};
        if (!e.aplica) return "";
        if (!e.encendido) return "Sin Mi espacio";
        if (e.licencia_propia) return "Mi espacio con su licencia propia";
        if (e.en_proceso) return "Mi espacio en proceso";
        return "Mi espacio: " + e.empresas + " de " + (e.tope == null ? "sin tope" : e.tope) + (e.timbres ? " · " + e.timbres + (e.timbres === 1 ? " timbre" : " timbres") : "");
    }

    function chipMiEspacio(m) {
        var e = m.mi_espacio || {};
        if (!e.aplica || !e.encendido || e.licencia_propia || e.en_proceso || e.tope == null) return "";
        var pasado = e.empresas > e.tope;
        return '<span class="dp-chip-me' + (pasado ? " dp-chip-me--pasado" : "") + '" title="Empresas en su Mi espacio (solo el número; no ves cuáles)">' +
            "Mi espacio <b>" + e.empresas + " de " + e.tope + "</b></span>";
    }

    // ------------------------------------------------------------------ fotos del equipo (23-nov-2026)
    function rutaFoto(m, tam) {
        return "/api/despacho/miembros/" + encodeURIComponent(m.correo) + "/foto?tam=" + tam + "&v=" + encodeURIComponent(m.foto);
    }

    // El círculo: con foto es un botón que la abre en grande; sin foto, las iniciales como siempre
    function circulo(m) {
        var clase = "dp-inicial" + (m.papel === "titular" ? " dp-inicial--titular" : "");
        if (!m.foto) return '<span class="' + clase + '">' + inicial(m.nombre || m.correo) + "</span>";
        var ya = fotos[m.correo + "|" + m.foto];
        return '<button type="button" class="' + clase + (ya ? " dp-inicial--foto" : "") + '" data-foto="' + esc(m.correo) + '" title="Ver foto"' +
            ' aria-label="Ver foto de ' + esc(m.nombre || m.correo) + '">' + (ya ? '<img src="' + ya + '" alt="">' : inicial(m.nombre || m.correo)) + "</button>";
    }

    // Carga diferida: la foto chica se pide cuando su fila se ve (con pocas personas es casi enseguida)
    function cargarFotos() {
        var pendientes = [].filter.call($("dp-equipo").querySelectorAll("[data-foto]"), function (b) { return !b.querySelector("img"); });
        if (vigia) vigia.disconnect();
        if (!pendientes.length) return;
        if (!("IntersectionObserver" in window)) { pendientes.forEach(traerFoto); return; }
        vigia = new IntersectionObserver(function (vistas) {
            vistas.forEach(function (v) { if (v.isIntersecting) { vigia.unobserve(v.target); traerFoto(v.target); } });
        }, { rootMargin: "200px" });
        pendientes.forEach(function (b) { vigia.observe(b); });
    }

    function miembroDe(correo) { return (datos.equipo || []).filter(function (x) { return x.correo === correo; })[0]; }

    async function traerFoto(boton) {
        var m = miembroDe(boton.dataset.foto);
        if (!m || !m.foto) return;
        var llave = m.correo + "|" + m.foto;
        try {
            if (!fotos[llave]) {
                var r = await fetch(API + rutaFoto(m, "chica"), { credentials: "include" });
                if (!r.ok) throw new Error(r.status);
                fotos[llave] = URL.createObjectURL(await r.blob());
            }
            if (!boton.isConnected) return;
            boton.innerHTML = '<img src="' + fotos[llave] + '" alt="">';
            boton.classList.add("dp-inicial--foto");
        } catch (e) {
            // No llegó (se quitó la foto o ya no está en el despacho): se queda con sus iniciales, sin botón
            if (!boton.isConnected) return;
            var span = document.createElement("span");
            span.className = boton.className.replace(" dp-inicial--foto", "");
            span.textContent = boton.textContent;
            boton.replaceWith(span);
        }
    }

    function verFoto(boton) {
        var m = miembroDe(boton.dataset.foto);
        if (!m || !m.foto || !F.verFoto) return;
        F.verFoto({ titulo: (m.nombre || m.correo) + (m.correo === datos.yo.correo ? " (tú)" : ""), sub: m.nombre_papel,
                    ruta: rutaFoto(m, "grande"), previa: fotos[m.correo + "|" + m.foto] || null, volverA: boton });
    }

    function pintarEquipo() {
        var lista = datos.equipo;
        $("dp-n-equipo").textContent = lista.length + (lista.length === 1 ? " persona" : " personas");
        $("dp-equipo").innerHTML = lista.length ? lista.map(function (m) {
            var estado = m.estado === "invitado" ? '<span class="ui-estado ui-estado--aviso">Invitación pendiente</span>'
                : m.estado === "suspendido" ? '<span class="ui-estado ui-estado--error">Suspendido</span>' : "";
            return "<li>" + circulo(m) +
                '<span class="dp-quien"><strong>' + esc(m.nombre || m.correo) + (m.correo === datos.yo.correo ? " (tú)" : "") + "</strong>" +
                // 25-nov-2026 (paquete dpe): quien no es titular no ve el resumen de permisos: sin el « · » suelto tras el correo
                "<small>" + (m.nombre ? esc(m.correo) + (datos.titular ? " · " : "") : "") + (datos.titular ? esc(resumenPermisos(m)) : "") + "</small>" +
                (datos.titular && textoMiEspacio(m) ? '<small class="dp-quien-me">' + esc(textoMiEspacio(m)) + "</small>" : "") + "</span>" +
                '<span class="dp-lado">' + estado + (datos.titular ? chipMiEspacio(m) : "") + '<span class="dp-etiqueta dp-etiqueta--' + esc(m.papel) + '">' + esc(m.nombre_papel) + "</span>" +
                // 21-nov-2026 (auditoría M1): a quien se le venció el enlace de 72 h (o no le llegó) se le manda uno nuevo
                (datos.titular && m.estado === "invitado" ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-reenviar="' + esc(m.correo) +
                    '" title="Le manda un enlace nuevo (vence en 72 horas)">Reenviar invitación</button>' : "") +
                // 23-nov-2026 (el dueño, Avance 1 · I.2): el enlace para mandarlo por WhatsApp o copiarlo, sin correo
                (datos.titular && m.estado === "invitado" ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-enlace="' + esc(m.correo) +
                    '" title="Para mandarle la invitación por WhatsApp o copiarla">Enlace</button>' : "") +
                (datos.titular ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-editar="' + esc(m.correo) + '">Permisos</button>' : "") +
                "</span></li>";
        }).join("") : '<li class="dp-lista__vacio">Todavía no hay nadie en el equipo.</li>';
        cargarFotos();
    }

    function pintarYo() {
        // 23-nov-2026 (auditoría contradicciones-4): el camino de Mi espacio solo se menciona cuando Mi espacio existe
        var ayuda = $("dp-pedir-ayuda");
        if (ayuda && datos.mi_espacio && datos.mi_espacio.listo) ayuda.innerHTML = 'Escribe su RFC. Para pasar una empresa de Mi espacio al despacho, usa <a href="/clientes/">Clientes</a> → «Pasar al despacho».';
        var caja = $("dp-yo");
        if (datos.titular) { caja.hidden = true; return; }
        var y = datos.yo;
        caja.hidden = false;
        caja.innerHTML = '<div class="dp-caja-cabeza"><h2>Tus permisos en el despacho</h2><span class="dp-tenue">Los decide el titular</span></div>' +
            // en solo consulta, lo primero (el letrero de la barra lo dice para toda la página; aquí, qué significa para sus permisos)
            (y.solo_lectura ? '<p class="ui-aviso ui-aviso--aviso dp-yo-consulta" id="dp-yo-consulta"><span><b>Solo consulta.</b> Con estos permisos ves y descargas, ' +
                "pero no cambias nada ni haces trámites ante el SAT.</span></p>" : "") +
            '<ul class="dp-filas">' + filaEmpresas(y) + filaModulos(y) + filaRegistrar(y) + filaMiEspacio(y) + "</ul>";
    }

    // ------------------------------------------------------------------ «Tus permisos en el despacho» (lo ve quien no es titular)
    // 25-nov-2026, el dueño: «se ve muy feo, pide más formato». Antes eran cuatro columnas de texto y los módulos una lista
    // larguísima separada por comas. Ahora una fila por permiso (ícono, qué es y el valor en negritas); lo largo (empresas
    // asignadas, módulos) en pastillas, con «Ver cuáles» cuando son muchos; los módulos agrupados como en el menú de módulos
    // (los grupos de barra.js) y los que tienen efecto fiscal con un punto ámbar. «Solo consulta» se dice arriba.
    // El tope de Mi espacio y cuántas empresas lleva ya no se ven aquí: solo el titular, en Equipo (el servidor ya no se los
    // manda a la persona; si llega al tope al dar de alta, el mensaje de ese momento le dice que se lo pida al titular).
    var GRUPO_MODULO = {
        clientes: "Clientes",
        validador: "Comprobantes", marcas: "Comprobantes", descarga_xml: "Comprobantes", envios: "Comprobantes", cancelaciones: "Comprobantes",
        conciliacion: "Cierre del mes", iva: "Cierre del mes", isn: "Cierre del mes", isn_presentar: "Cierre del mes", voucheo: "Cierre del mes",
        constancias: "Cumplimiento", opinion: "Cumplimiento", declaraciones: "Cumplimiento", buzon: "Cumplimiento", buzon_abrir: "Cumplimiento",
        facturacion: "Facturación", documentos: "Documentos"
    };
    var ORDEN_GRUPOS = ["Clientes", "Comprobantes", "Cierre del mes", "Cumplimiento", "Facturación", "Documentos", "Otros"];
    // Lo que hagas ahí cuenta ante el SAT (son los trámites que el ambiente de pruebas no deja hacer, core/ambiente.py)
    var EFECTO_FISCAL = {
        facturacion: "timbra facturas ante el SAT",
        cancelaciones: "cancela facturas y responde las solicitudes de cancelación ante el SAT",
        buzon_abrir: "al abrir una notificación, el contribuyente queda notificado",
        isn_presentar: "presenta declaraciones estatales"
    };
    var POCOS_MODULOS = 6, POCAS_EMPRESAS = 4;       // hasta aquí se ven las pastillas sin «Ver cuáles»
    var ICONO = {
        empresas: "M3 21h18M5 21V5a2 2 0 012-2h6a2 2 0 012 2v16m0-12h2a2 2 0 012 2v10M8.5 7.5h3m-3 4h3m-3 4h3",
        modulos: "M4.5 4.5h5.5V10H4.5zM14 4.5h5.5V10H14zM4.5 14h5.5v5.5H4.5zM14 14h5.5v5.5H14z",
        registrar: "M10 21H5a2 2 0 01-2-2V5a2 2 0 012-2h8a2 2 0 012 2v5M7 7.5h4M7 11.5h4M7 15.5h2m9-1.5v7m-3.5-3.5h7",
        miEspacio: "M15.5 7.5a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0zM5 20.5v-.5a5.5 5.5 0 015.5-5.5h3a5.5 5.5 0 015.5 5.5v.5"
    };

    function icono(d) {
        return '<span class="dp-fila__ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
            'stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg></span>';
    }

    function fila(clave, ico, que, valor) {
        return '<li class="dp-fila" data-permiso="' + clave + '">' + icono(ico) + '<div class="dp-fila__cuerpo"><span class="dp-fila__que">' + que + "</span>" +
            '<div class="dp-fila__valor">' + valor + "</div></div></li>";
    }

    // «Ver cuáles»: el botón y su panel (las pastillas). Con pocas, las pastillas se ven sin botón.
    function verCuales(id, cuantos, pocos, contenido) {
        var abierto = cuantos <= pocos;
        return { boton: abierto ? "" : '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28 dp-ver" data-ver="' + id + '" aria-expanded="false" aria-controls="' + id + '">' +
                        '<span>Ver cuáles</span><svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.2 7.2a.75.75 0 011.06 0L10 10.94l3.74-3.74a.75.75 0 111.06 1.06l-4.27 4.27a.75.75 0 01-1.06 0L5.2 8.26a.75.75 0 010-1.06z" clip-rule="evenodd"/></svg></button>',
                 panel: '<div class="dp-fila__panel" id="' + id + '"' + (abierto ? "" : " hidden") + ">" + contenido + "</div>" };
    }

    function linea(valor, boton, extra) {
        return '<div class="dp-fila__linea"><b>' + esc(valor) + "</b>" + (extra || "") + (boton || "") + "</div>";
    }

    function plural(n, uno, varios) { return n + " " + (n === 1 ? uno : varios); }

    function filaEmpresas(y) {
        if (y.empresas === null) return fila("empresas", ICONO.empresas, "Empresas", linea("Todas las del despacho"));
        var lista = y.empresas_detalle || y.empresas.map(function (r) { return { rfc: r, nombre: r }; });
        if (!lista.length) {
            return fila("empresas", ICONO.empresas, "Empresas", linea("Ninguna todavía") +
                '<p class="dp-fila__nota">Pide acceso a una en <a href="?vista=solicitudes" data-ir-vista="solicitudes">Solicitudes</a>.</p>');
        }
        var pastillas = '<ul class="dp-pastillas">' + lista.map(function (e) {
            return '<li class="dp-pastilla" title="' + esc(e.nombre + " · " + e.rfc) + '">' + esc(e.nombre) + "</li>";
        }).join("") + "</ul>";
        var v = verCuales("dp-yo-empresas", lista.length, POCAS_EMPRESAS, pastillas);
        return fila("empresas", ICONO.empresas, "Empresas", linea(plural(lista.length, "asignada", "asignadas"), v.boton) + v.panel);
    }

    function pastillaModulo(m, marcar) {
        var fiscal = marcar && EFECTO_FISCAL[m.clave];
        return '<li class="dp-pastilla' + (fiscal ? " dp-pastilla--fiscal" : "") + '" title="' + esc(m.nombre + (fiscal ? " · Con efecto fiscal: " + fiscal : "")) + '">' +
            esc(String(m.nombre || m.clave).split(" (")[0]) + (fiscal ? '<span class="sr-only"> (con efecto fiscal)</span>' : "") + "</li>";
    }

    function modulosPorGrupo(lista, marcar) {
        var grupos = {};
        lista.forEach(function (m) { var g = GRUPO_MODULO[m.clave] || "Otros"; (grupos[g] = grupos[g] || []).push(m); });
        return '<div class="dp-modgrupos">' + ORDEN_GRUPOS.filter(function (g) { return grupos[g]; }).map(function (g) {
            return '<div class="dp-modgrupo"><span>' + esc(g) + '</span><ul class="dp-pastillas">' +
                grupos[g].map(function (m) { return pastillaModulo(m, marcar); }).join("") + "</ul></div>";
        }).join("") + "</div>";
    }

    function leyendaFiscal(lista) {
        var abre = lista.some(function (m) { return m.clave === "buzon_abrir"; });
        return '<p class="dp-leyenda-fiscal"><span class="dp-punto-fiscal" aria-hidden="true"></span><span><b>Con efecto fiscal:</b> cuenta ante el SAT.' +
            (abre ? " Al abrir una notificación del Buzón, el contribuyente queda notificado." : "") + "</span></p>";
    }

    function filaModulos(y) {
        var todos = y.modulos === null;
        // Solo lo que el plan del despacho trae (lo mismo que deja usar el servidor), en el orden del catálogo
        var lista = datos.modulos.filter(function (m) { return todos || y.modulos.indexOf(m.clave) >= 0; });
        if (!lista.length) return fila("modulos", ICONO.modulos, "Módulos", linea("Ninguno") + '<p class="dp-fila__nota">Pídele al titular los que necesites.</p>');
        // En solo consulta no se hace nada con efecto fiscal: la marca sobra (ya lo dice el aviso de arriba)
        var marcar = !y.solo_lectura, fiscales = marcar ? lista.filter(function (m) { return EFECTO_FISCAL[m.clave]; }) : [];
        var dato = (todos ? '<span class="dp-fila__dato">' + plural(lista.length, "módulo", "módulos") + "</span>" : "") +
            (fiscales.length ? '<span class="dp-marca-fiscal"><span class="dp-punto-fiscal" aria-hidden="true"></span>' + fiscales.length + " con efecto fiscal</span>" : "");
        var contenido = modulosPorGrupo(lista, marcar) + (fiscales.length ? leyendaFiscal(fiscales) : "");
        var v = verCuales("dp-yo-modulos", lista.length, POCOS_MODULOS, contenido);
        return fila("modulos", ICONO.modulos, "Módulos", linea(todos ? "Todos los del despacho" : plural(lista.length, "módulo", "módulos"), v.boton, dato) + v.panel);
    }

    function filaRegistrar(y) {
        // En solo consulta tampoco puede dar de alta: lo que sí puede es pedirlo
        var si = y.agregar && !y.solo_lectura;
        return fila("registrar", ICONO.registrar, "Registrar empresas", si
            ? linea("Sí", "", '<span class="dp-fila__dato">las das de alta y las quitas en <a href="/clientes/">Clientes</a></span>')
            : linea("Con solicitud al titular", "", '<span class="dp-fila__dato">pídelo en <a href="?vista=solicitudes" data-ir-vista="solicitudes">Solicitudes</a></span>'));
    }

    function filaMiEspacio(y) {
        var e = y.mi_espacio || {}, html;
        if (!y.personal) html = linea("No") + '<p class="dp-fila__nota">Trabajas solo con las empresas del despacho.</p>';
        else if (e.licencia_propia) html = linea("Sí, con tu licencia propia", "", '<span class="dp-fila__dato">solo tú ves tus empresas</span>');
        else if (e.en_proceso) html = linea("En proceso") + '<p class="dp-fila__nota">Muy pronto vas a poder tener aquí tus propias empresas.</p>';
        else {
            html = linea("Sí", "", '<span class="dp-fila__dato">solo tú ves tus empresas</span>');
            if (e.timbres > 0) html += '<p class="dp-fila__nota dp-fila__nota--fuerte">Tienes ' + plural(e.timbres, "timbre", "timbres") + " para facturar en Mi espacio.</p>";
            // Lo que el titular le dio solo para Mi espacio (si en el despacho ya tiene todos, no hay nada extra)
            var extra = y.modulos === null ? [] : datos.modulos.filter(function (m) { return (y.modulos_personal || []).indexOf(m.clave) >= 0; });
            if (extra.length) html += '<div class="dp-fila__extra"><span>Además, en Mi espacio:</span><ul class="dp-pastillas">' +
                extra.map(function (m) { return pastillaModulo(m, true); }).join("") + "</ul></div>";
        }
        return fila("mi-espacio", ICONO.miEspacio, "Mi espacio", html);
    }

    function alternarVer(boton) {
        var panel = $(boton.dataset.ver), abrir = boton.getAttribute("aria-expanded") !== "true";
        if (!panel) return;
        panel.hidden = !abrir;
        boton.setAttribute("aria-expanded", String(abrir));
        boton.querySelector("span").textContent = abrir ? "Ocultar" : "Ver cuáles";
    }

    // ------------------------------------------------------------------ ventana de permisos / invitar
    function mostrarPestana(clave) {
        document.querySelectorAll("#dp-modal [data-pest]").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.pest === clave)); });
        document.querySelectorAll("#dp-modal [data-pest-panel]").forEach(function (p) { p.hidden = p.dataset.pestPanel !== clave; });
    }

    // «Extra en Mi espacio»: lo del plan que no tiene en el despacho (si en el despacho tiene todos, no hay nada extra)
    function pintarExtra(marcados) {
        var todos = document.querySelector('input[name="dp-mod"]:checked').value === "todos";
        var enDespacho = todos ? null : [].map.call($("dp-modulos").querySelectorAll("input:checked"), function (i) { return i.value; });
        if (marcados === undefined) marcados = [].map.call($("dp-modulos-extra").querySelectorAll("input:checked"), function (i) { return i.value; });
        var libres = enDespacho === null ? [] : datos.modulos.filter(function (x) { return enDespacho.indexOf(x.clave) < 0 && x.clave !== "clientes"; });
        $("dp-modulos-extra").innerHTML = libres.length ? libres.map(function (x) {
            return '<label class="ui-check"><input type="checkbox" value="' + esc(x.clave) + '"' + (marcados.indexOf(x.clave) >= 0 ? " checked" : "") + "> " + esc(x.nombre) + "</label>";
        }).join("") : '<p class="dp-tenue">' + (enDespacho === null ? "Ya usa todos los módulos del despacho, también en su Mi espacio." : "No queda nada más en el plan del despacho.") + "</p>";
    }

    function pintarMiEspacio() {
        var me = datos.mi_espacio || {}, m = edicion.miembro, e = (m && m.mi_espacio) || {};
        var listo = me.listo !== false, propia = !!e.licencia_propia;
        var maximo = me.tope_maximo == null ? 1000 : me.tope_maximo;
        $("dp-mi-proceso").hidden = listo;
        $("dp-mi-ayuda").textContent = listo ? "Sus empresas de Mi espacio solo las ve esa persona; tú ves cuántas tiene, nunca cuáles."
            : "Mi espacio está en proceso: todavía no se usa con la licencia del despacho. Lo que elijas aquí queda guardado para cuando esté listo.";
        $("dp-mi-propia").hidden = !propia;
        $("dp-mi-tope-caja").hidden = propia;
        $("dp-mi-timbres-caja").hidden = propia || !m || m.estado === "invitado" || !listo;
        $("dp-tope").max = maximo;
        $("dp-tope-ayuda").textContent = "De 0 a " + maximo + ". No cuentan en las empresas del despacho.";
        var tope = e.tope != null ? e.tope : maximo;
        $("dp-tope").value = m && e.tope_propio ? tope : "";              // vacío = el de fábrica del despacho
        $("dp-tope").placeholder = String(maximo) + " (de fábrica)";
        $("dp-mi-conteo").textContent = m && e.empresas != null ? e.empresas + " de " + tope : "Todavía ninguna";
        avisoTope();
        $("dp-mi-timbres").textContent = e.timbres != null ? String(e.timbres) : "0";
        $("dp-mi-timbres-ayuda").textContent = "Los que le pases salen de los " + (me.timbres_despacho || 0) + " sin repartir del despacho" +
            (e.timbres_usados ? ". Ya usó " + e.timbres_usados + ": esos no se pueden regresar." : ". Puedes regresar los que no use.");
        $("dp-timbres-msj").hidden = true;
        $("dp-timbres-cantidad").value = "";
    }

    function avisoTope() {
        var m = edicion && edicion.miembro, e = (m && m.mi_espacio) || {}, v = $("dp-tope").value.trim();
        var tope = v === "" ? ((datos.mi_espacio || {}).tope_maximo) : parseInt(v, 10);
        var pasado = m && e.empresas != null && tope != null && !isNaN(tope) && e.empresas > tope;
        $("dp-tope-aviso").hidden = !pasado;
        if (pasado) $("dp-tope-aviso").textContent = "Tiene " + e.empresas + ". No se borra nada: puede seguir trabajando con ellas, pero no podrá dar de alta otra hasta tener menos de " + tope + ".";
    }

    async function moverTimbres(accion) {
        var m = edicion && edicion.miembro, n = parseInt($("dp-timbres-cantidad").value, 10), msj = $("dp-timbres-msj");
        function decir(t, mal) { msj.textContent = t; msj.className = "dp-mi-msj" + (mal ? " dp-mi-msj--mal" : ""); msj.hidden = false; }
        if (!m) return;
        if (!(n > 0)) return decir("Escribe cuántos timbres.", true);
        var boton = $(accion === "pasar" ? "dp-timbres-pasar" : "dp-timbres-regresar");
        boton.disabled = true; boton.classList.add("ui-btn--cargando");
        try {
            var r = await pedir("/api/despacho/miembros/" + encodeURIComponent(m.correo) + "/timbres/" + accion, { method: "POST", body: { cantidad: n } });
            datos = await pedir("/api/despacho");
            edicion.miembro = datos.equipo.filter(function (x) { return x.correo === m.correo; })[0] || m;
            pintarMiEspacio();
            pintarEquipo();
            decir(accion === "pasar" ? "Listo: le pasaste " + n + (n === 1 ? " timbre." : " timbres.") : "Listo: regresaron " + r.regresados + " al despacho.");
        } catch (e) { decir(e.message, true); }
        finally { boton.disabled = false; boton.classList.remove("ui-btn--cargando"); }
    }

    function abrirModal(miembro) {
        edicion = { invitar: !miembro, miembro: miembro || null };
        var m = miembro || { papel: "miembro", empresas: null, modulos: null, agregar_propio: false, solo_lectura: false,
                             personal: datos.despacho.ajustes ? datos.despacho.ajustes.personal_de_fabrica !== false : true, estado: "activo" };
        $("dp-modal-titulo").textContent = miembro ? "Permisos de " + (miembro.nombre || miembro.correo) : "Invitar a alguien";
        $("dp-modal-sub").textContent = miembro ? miembro.correo : "Recibe un aviso para unirse al despacho.";
        $("dp-campo-correo").hidden = !!miembro;
        $("dp-correo").value = "";
        $("dp-quitar").hidden = !miembro;
        $("dp-campo-suspender").hidden = !miembro || miembro.estado === "invitado";
        $("dp-guardar").textContent = miembro ? "Guardar" : "Invitar";
        $("dp-papel").innerHTML = datos.papeles.map(function (p) {
            return '<option value="' + esc(p.clave) + '"' + (p.clave === m.papel ? " selected" : "") + ">" + esc(p.nombre) + "</option>";
        }).join("");
        document.querySelector('input[name="dp-emp"][value="' + (m.empresas === null ? "todas" : "algunas") + '"]').checked = true;
        document.querySelector('input[name="dp-mod"][value="' + (m.modulos === null ? "todos" : "algunos") + '"]').checked = true;
        var elegidas = m.empresas || [], mods = m.modulos || datos.modulos.map(function (x) { return x.clave; });
        $("dp-empresas").innerHTML = (datos.empresas || []).length ? datos.empresas.map(function (e) {
            return '<label class="ui-check" data-buscar="' + esc((e.alias + " " + e.rfc).toLowerCase()) + '"><input type="checkbox" value="' + esc(e.rfc) + '"' +
                (elegidas.indexOf(e.rfc) >= 0 ? " checked" : "") + "><span>" + esc(e.alias) + "<small>" + esc(e.rfc) + "</small></span></label>";
        }).join("") : '<p class="dp-tenue">El despacho todavía no tiene empresas.</p>';
        $("dp-empresas-buscar").value = "";
        $("dp-modulos").innerHTML = datos.modulos.map(function (x) {
            return '<label class="ui-check"><input type="checkbox" value="' + esc(x.clave) + '"' + (mods.indexOf(x.clave) >= 0 ? " checked" : "") + "> " + esc(x.nombre) + "</label>";
        }).join("");
        pintarExtra(m.modulos_personal || []);
        $("dp-agregar").checked = !!m.agregar_propio;
        $("dp-personal").checked = !!m.personal;
        $("dp-lectura").checked = !!m.solo_lectura;
        $("dp-sin-conexion").checked = !!m.sin_conexion;
        $("dp-suspender").checked = m.estado === "suspendido";
        $("dp-modal-error").hidden = true;
        pintarMiEspacio();
        mostrarPestana("despacho");
        actualizarModal();
        $("dp-modal").showModal();
        if (!miembro) $("dp-correo").focus();
    }

    function actualizarModal() {
        var papel = $("dp-papel").value, titular = papel === "titular";
        $("dp-papel-ayuda").textContent = AYUDA_PAPEL[papel] || "";
        $("dp-grupo-empresas").hidden = titular;
        // El titular usa todo, también en su Mi espacio: no hay módulos que elegir
        document.querySelector('#dp-modal [data-pest="modulos"]').hidden = titular;
        if (titular && document.querySelector('#dp-modal [data-pest="modulos"]').getAttribute("aria-selected") === "true") mostrarPestana("despacho");
        $("dp-agregar").closest("label").hidden = $("dp-lectura").closest("label").hidden = $("dp-sin-conexion").closest("label").hidden = titular;
        $("dp-empresas-caja").hidden = document.querySelector('input[name="dp-emp"]:checked').value !== "algunas";
        $("dp-modulos").hidden = document.querySelector('input[name="dp-mod"]:checked').value !== "algunos";
    }

    function errorModal(texto) { $("dp-modal-error").textContent = texto; $("dp-modal-error").hidden = false; }

    async function guardarModal() {
        var papel = $("dp-papel").value;
        var cuerpo = { papel: papel, personal: $("dp-personal").checked };
        if (papel !== "titular") {
            if (document.querySelector('input[name="dp-emp"]:checked').value === "todas") cuerpo.todas_las_empresas = true;
            else cuerpo.empresas = [].map.call($("dp-empresas").querySelectorAll("input:checked"), function (i) { return i.value; });
            if (document.querySelector('input[name="dp-mod"]:checked').value === "todos") cuerpo.todos_los_modulos = true;
            else cuerpo.modulos = [].map.call($("dp-modulos").querySelectorAll("input:checked"), function (i) { return i.value; });
            cuerpo.modulos_personal = [].map.call($("dp-modulos-extra").querySelectorAll("input:checked"), function (i) { return i.value; });
            cuerpo.agregar = $("dp-agregar").checked;
            cuerpo.solo_lectura = $("dp-lectura").checked;
            cuerpo.sin_conexion = $("dp-sin-conexion").checked;
        }
        if (!$("dp-mi-tope-caja").hidden) {               // Mi espacio: tope por persona (vacío = el de fábrica del despacho)
            var tope = $("dp-tope").value.trim(), maximo = parseInt($("dp-tope").max, 10);
            if (tope === "") { if (!edicion.invitar) cuerpo.tope_de_fabrica = true; }
            else if (!/^\d+$/.test(tope) || parseInt(tope, 10) > maximo) { mostrarPestana("mi"); return errorModal("Las empresas de Mi espacio van de 0 a " + maximo + "."); }
            else cuerpo.tope_personal = parseInt(tope, 10);
        }
        if (edicion.invitar) {
            cuerpo.correo = $("dp-correo").value.trim().toLowerCase();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cuerpo.correo)) return errorModal("Escribe un correo válido.");
        } else if (edicion.miembro.estado !== "invitado") {
            cuerpo.estado = $("dp-suspender").checked ? "suspendido" : "activo";
        }
        // Invitar o cambiar a una persona pide confirmar que eres tú (PIN, o código por correo si no tienes PIN)
        var invitar = edicion.invitar, correoMiembro = invitar ? null : edicion.miembro.correo;
        var hecho = await F.confirmarIdentidad(invitar ? "invitar_miembro" : "cambiar_miembro", function (c) {
            cuerpo.confirmacion = c;
            return invitar ? pedir("/api/despacho/invitar", { method: "POST", body: cuerpo })
                : pedir("/api/despacho/miembros/" + encodeURIComponent(correoMiembro), { method: "PUT", body: cuerpo });
        });
        if (!hecho) return;
        $("dp-modal").close();
        aviso(invitar ? "Invitación enviada a " + cuerpo.correo + "." : "Permisos guardados.");
        try { await recargar(); } catch (e) { aviso(e.message); }
    }

    async function quitar() {
        var m = edicion && edicion.miembro;
        if (!m) return;
        var ok = await F.confirmar({ titulo: "¿Quitar a " + (m.nombre || m.correo) + " del despacho?", peligro: true, si: "Quitar",
            texto: "Deja de ver las empresas del despacho. Su Mi espacio queda 30 días en solo lectura para esa persona y los timbres que le pasaste y no usó regresan al despacho." });
        if (!ok) return;
        var hecho = await F.confirmarIdentidad("quitar_miembro", function (c) {
            return pedir("/api/despacho/miembros/" + encodeURIComponent(m.correo), { method: "DELETE", body: { confirmacion: c } });
        });
        if (!hecho) return;
        $("dp-modal").close();
        aviso("Listo, ya no está en el despacho.");
        try { await recargar(); } catch (e) { errorModal(e.message); }
    }

    async function recargar() {
        datos = await pedir("/api/despacho");
        if (!datos.despacho) { location.reload(); return; }
        var vista = new URLSearchParams(location.search).get("vista") || "equipo";
        pintar();
        mostrarVista(document.querySelector('[data-vista="' + vista + '"]:not([hidden])') ? vista : "equipo");
    }

    // ------------------------------------------------------------------ solicitudes
    async function cargarSolicitudes() {
        var caja = $("dp-solicitudes");
        caja.innerHTML = '<li class="dp-lista__vacio">Cargando…</li>';
        try {
            var r = await pedir("/api/despacho/solicitudes" + (filtroSol ? "?estado=" + filtroSol : ""));
            pintarSolicitudes(r.solicitudes || []);
        } catch (e) {
            caja.innerHTML = '<li class="dp-lista__vacio">' + esc(e.message) + "</li>";
        }
    }

    function pintarSolicitudes(lista) {
        var yo = datos.yo.correo;
        $("dp-solicitudes").innerHTML = lista.length ? lista.map(function (s) {
            var estado = s.estado === "pendiente" ? '<span class="ui-estado ui-estado--aviso">Pendiente</span>'
                : s.estado === "aceptada" ? '<span class="ui-estado ui-estado--ok">Aceptada</span>'
                : s.estado === "rechazada" ? '<span class="ui-estado ui-estado--error">Rechazada</span>' : '<span class="ui-estado">Cancelada</span>';
            var acciones = "";
            // 20-nov-2026 (auditoría H8): la solicitud de quien aprueba la resuelve el titular
            var dePapel = ((datos.equipo || []).filter(function (m) { return m.correo === s.de_correo; })[0] || {}).papel;
            var alTitular = !datos.titular && (dePapel === "aprobador" || dePapel === "titular");
            if (s.estado === "pendiente" && datos.aprueba && s.de_correo !== yo && alTitular)
                acciones = '<small class="dp-sol-nota">La resuelve el titular</small>';
            else if (s.estado === "pendiente" && datos.aprueba && s.de_correo !== yo)
                acciones = '<button type="button" class="ui-btn ui-btn--primario ui-btn--28" data-aceptar="' + s.id + '">Aceptar</button>' +
                    '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-rechazar="' + s.id + '">Rechazar</button>';
            else if (s.estado === "pendiente" && s.de_correo === yo)
                acciones = '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-cancelar="' + s.id + '">Cancelar</button>';
            var resuelta = s.resuelta_por && s.estado !== "pendiente" ? " · " + (s.estado === "cancelada" ? "cancelada" : "por " + s.resuelta_por) + " " + fecha(s.resuelta_en) : "";
            return '<li><span class="dp-sol-texto"><b>' + esc(s.tipo_texto) + "</b>" +
                "<span>" + esc(s.nombre || "") + ' <span class="dp-rfc">' + esc(s.rfc) + "</span></span>" +
                "<small>" + (s.de_correo === yo ? "Tú" : esc(s.de_correo)) + " · " + esc(fecha(s.creada)) + esc(resuelta) + "</small>" +
                (s.nota ? '<small class="dp-sol-nota">«' + esc(s.nota) + "»</small>" : "") +
                (s.respuesta ? "<small>Respuesta: " + esc(s.respuesta) + "</small>" : "") + "</span>" +
                '<span class="dp-lado">' + estado + acciones + "</span></li>";
        }).join("") : '<li class="dp-lista__vacio">' + (filtroSol ? "No hay solicitudes pendientes." : "Todavía no hay solicitudes.") + "</li>";
    }

    async function responder(id, acepta, boton) {
        if (!acepta && !(await F.confirmar({ titulo: "¿Rechazar la solicitud?", si: "Rechazar", peligro: true }))) return;
        boton.classList.add("ui-btn--cargando");
        try {
            var r = await pedir("/api/despacho/solicitudes/" + id + "/" + (acepta ? "aceptar" : "rechazar"), { method: "POST", body: {} });
            aviso(acepta ? (r.resultado || "Solicitud aceptada.") : "Solicitud rechazada.");
            await recargar();
            mostrarVista("solicitudes");
        } catch (e) {
            boton.classList.remove("ui-btn--cargando");
            aviso(e.message);
        }
    }

    async function cancelarSolicitud(id, boton) {
        boton.classList.add("ui-btn--cargando");
        try {
            await pedir("/api/despacho/solicitudes/" + id, { method: "DELETE" });
            cargarSolicitudes();
        } catch (e) { boton.classList.remove("ui-btn--cargando"); aviso(e.message); }
    }

    async function pedirAcceso(ev) {
        ev.preventDefault();
        var rfc = $("dp-pedir-rfc").value.trim().toUpperCase(), nota = $("dp-pedir-nota");
        function decir(texto) { nota.textContent = texto; nota.hidden = false; }
        if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) return decir("Ese RFC no tiene la forma correcta (12 o 13 caracteres).");
        try {
            var e = await pedir("/api/despacho/existe/" + encodeURIComponent(rfc));
            // 23-nov-2026 (auditoría contradicciones-4): mientras Mi espacio esté apagado no existe «Pasar al despacho»
            if (!e.existe) return decir((datos && datos.mi_espacio && datos.mi_espacio.listo)
                ? "Esa empresa no está en el despacho. Si es tuya, regístrala en Mi espacio y luego pásala al despacho desde Clientes."
                : "Esa empresa no está en el despacho. Pídele al titular que la registre (o regístrala en Clientes si tienes permiso).");
            if (e.tengo_acceso) return decir("Ya tienes acceso a " + (e.alias || rfc) + ".");
            if (e.solicitud_pendiente) return decir("Ya pediste acceso a " + (e.alias || rfc) + "; está pendiente.");
            var r = await pedir("/api/despacho/solicitudes", { method: "POST", body: { tipo: "acceso", rfc: rfc } });
            $("dp-pedir-rfc").value = "";
            decir(r.estado === "aceptada" ? "Listo: ya tienes acceso a " + (e.alias || rfc) + "." : "Listo: le avisamos al titular. Te llega un aviso cuando responda.");
            cargarSolicitudes();
        } catch (er) { decir(er.message); }
    }

    // ------------------------------------------------------------------ bitácora
    async function cargarBitacora() {
        var sel = $("dp-bit-persona");
        if (sel.options.length <= 1) {
            sel.insertAdjacentHTML("beforeend", datos.equipo.map(function (m) {
                return '<option value="' + esc(m.correo) + '">' + esc(m.nombre || m.correo) + "</option>";
            }).join(""));
        }
        var cuerpo = $("dp-bitacora");
        cuerpo.innerHTML = '<tr><td colspan="5">Cargando…</td></tr>';
        try {
            var r = await pedir("/api/despacho/bitacora" + (sel.value ? "?correo=" + encodeURIComponent(sel.value) : ""));
            var nombres = {};
            datos.equipo.forEach(function (m) { nombres[m.correo] = m.nombre || m.correo; });
            cuerpo.innerHTML = r.eventos.length ? r.eventos.map(function (e) {
                return "<tr><td>" + esc(fecha(e.en)) + "</td><td>" + esc(nombres[e.correo] || e.correo) + "</td><td>" + esc(e.accion) +
                    (e.detalle ? "<small>" + esc(e.detalle) + "</small>" : "") + '</td><td class="dp-rfc">' + esc((e.rfc || "").replace(/,/g, ", ")) + "</td><td>" + resultadoBit(e.resultado) + "</td></tr>";
            }).join("") : '<tr><td colspan="5">Sin movimientos todavía.</td></tr>';
        } catch (e) {
            cuerpo.innerHTML = '<tr><td colspan="5">' + esc(e.message) + "</td></tr>";
        }
    }

    /* 19-nov-2026 (el dueño): el renglón de «Pidió…» dice cómo salió (el servidor lo une con el registro de trámites).
       Los demás movimientos (cambios, descargas) no llevan resultado. */
    function resultadoBit(r) {
        if (!r) return "";
        var clase = { bien: "dp-tra-ok", mal: "dp-tra-mal", proceso: "dp-tra-proceso", sin: "dp-tra-sin" }[r.estado] || "dp-tra-sin";
        var marca = { bien: "✓ ", mal: "✕ " }[r.estado] || "";
        var t = String(r.texto || ""), i = t.indexOf(": ");
        // «No salió: <motivo>»: el motivo va abajo, en chico (como en Trámites con el SAT)
        if (r.estado === "mal" && i > 0) return '<span class="' + clase + '">' + marca + esc(t.slice(0, i)) + "</span><small>" + esc(t.slice(i + 2)) + "</small>";
        return '<span class="' + clase + '">' + marca + esc(t) + "</span>";
    }

    // ------------------------------------------------------------------ trámites con el SAT (registro)
    /* El titular y quien aprueba ven los de todo el despacho (y filtran por persona); los demás, los suyos. */
    async function cargarTramites() {
        var sel = $("dp-tra-persona");
        sel.hidden = !datos.aprueba;
        $("dp-tra-titulo").textContent = datos.aprueba ? "Trámites con el SAT del despacho" : "Mis trámites con el SAT";
        if (datos.aprueba && sel.options.length <= 1) {
            sel.insertAdjacentHTML("beforeend", datos.equipo.map(function (m) {
                return '<option value="' + esc(m.correo) + '">' + esc(m.nombre || m.correo) + "</option>";
            }).join(""));
        }
        var cuerpo = $("dp-tramites");
        cuerpo.innerHTML = '<tr><td colspan="5">Cargando…</td></tr>';
        try {
            var q = [];
            if (datos.aprueba && sel.value) q.push("correo=" + encodeURIComponent(sel.value));
            if ($("dp-tra-ok").value) q.push("ok=" + $("dp-tra-ok").value);
            var r = await pedir("/api/despacho/tramites" + (q.length ? "?" + q.join("&") : ""));
            var nombres = {};
            datos.equipo.forEach(function (m) { nombres[m.correo] = m.nombre || m.correo; });
            cuerpo.innerHTML = r.filas.length ? r.filas.map(function (f) {
                var res = f.ok ? '<span class="dp-tra-ok">✓ salió</span>' : '<span class="dp-tra-mal">✕ no salió</span>';
                var seg = f.segundos != null ? " · " + Math.round(f.segundos) + " s" : "";
                return "<tr><td>" + esc(fecha(f.inicio)) + "</td><td>" + esc(f.automatico ? "Automático (programado)" : (nombres[f.pidio] || f.pidio || "—")) + "</td><td>" + esc(r.tramites[f.tipo] || f.tipo) +
                    '<span class="dp-tra-como">' + esc((r.vias[f.via] || "") + seg) + "</span></td>" +
                    '<td class="dp-rfc">' + esc(f.rfc || "") + "</td><td>" + res + (f.motivo ? "<small>" + esc(f.motivo) + "</small>" : "") + "</td></tr>";
            }).join("") : '<tr><td colspan="5">Todavía no hay trámites.</td></tr>';
        } catch (e) {
            cuerpo.innerHTML = '<tr><td colspan="5">' + esc(e.message) + "</td></tr>";
        }
    }

    // ------------------------------------------------------------------ ajustes
    function llenarAjustes() {
        var d = datos.despacho;
        $("dp-aj-nombre").value = d.nombre || "";
        $("dp-aj-contacto").value = d.contacto || "";
        $("dp-aj-personal").checked = !d.ajustes || d.ajustes.personal_de_fabrica !== false;
        var me = datos.mi_espacio || {};
        $("dp-aj-proceso").hidden = me.listo !== false;
        $("dp-aj-ayuda").textContent = (me.listo === false ? "Mi espacio está en proceso: todavía no se usa con la licencia del despacho. " : "") +
            "Cada persona puede tener hasta " + (me.tope_maximo == null ? "las empresas que quiera" : me.tope_maximo + " empresas") +
            " en su Mi espacio, aparte de las del despacho. Su tope, sus módulos extra y sus timbres se cambian en Equipo → Permisos → Mi espacio.";
        cargarMigraciones();
    }

    async function guardarNombre(ev) {
        ev.preventDefault();
        var boton = ev.target.querySelector("[type=submit]"), nombre = $("dp-nombre-campo").value.trim();
        if (!nombre) return;
        boton.classList.add("ui-btn--cargando");
        try {
            datos = await pedir("/api/despacho/ajustes", { method: "PUT", body: { nombre: nombre } });
            pintar();
            aviso("Listo: tu despacho se llama «" + datos.despacho.nombre + "».");
        } catch (e) { aviso(e.message); } finally { boton.classList.remove("ui-btn--cargando"); }
    }

    async function guardarAjustes(ev) {
        ev.preventDefault();
        var boton = ev.target.querySelector("[type=submit]");
        boton.classList.add("ui-btn--cargando");
        try {
            datos = await pedir("/api/despacho/ajustes", { method: "PUT", body: { nombre: $("dp-aj-nombre").value.trim(),
                contacto: $("dp-aj-contacto").value.trim(), personal_de_fabrica: $("dp-aj-personal").checked } });
            pintar();
            mostrarVista("ajustes");
            aviso("Ajustes guardados.");
        } catch (e) { aviso(e.message); } finally { boton.classList.remove("ui-btn--cargando"); }
    }

    // ------------------------------------------------------------------ solicitar migración (titular)
    var EST_MIG = { pendiente: ["Pendiente", "aviso"], en_curso: ["En curso", "info"], atendida: ["Atendida", "ok"], rechazada: ["No aprobada", "error"] };
    async function cargarMigraciones() {
        try {
            var l = (await pedir("/api/despacho/migracion")).solicitudes;
            $("dp-mig-lista").innerHTML = l.map(function (s) {
                var e = EST_MIG[s.estado] || [s.estado, ""];
                return "<li><span><b>" + esc(s.origen) + "</b><small>" + (s.empresas ? s.empresas.length + (s.empresas.length === 1 ? " empresa" : " empresas") : "Todas sus empresas") +
                    " · " + esc(fecha(s.creada)) + (s.motivo ? " · " + esc(s.motivo) : "") + '</small></span><span class="ui-estado ui-estado--' + e[1] + '">' + esc(e[0]) + "</span></li>";
            }).join("");
        } catch (e) { $("dp-mig-lista").innerHTML = ""; }
    }
    function errorMig(t) { $("dp-mig-error").textContent = t || ""; $("dp-mig-error").hidden = !t; }
    function abrirMigracion() {
        $("dp-mig-forma").reset(); $("dp-mig-rfcs").hidden = true; errorMig("");
        $("dp-mig-dlg").showModal(); $("dp-mig-origen").focus();
    }
    async function enviarMigracion() {
        var origen = $("dp-mig-origen").value.trim().toLowerCase(), empresas = null;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(origen)) return errorMig("Escribe el correo de la cuenta que entrega las empresas.");
        if (document.querySelector('input[name="dp-mig-cuales"]:checked').value === "algunas") {
            empresas = $("dp-mig-rfcs").value.toUpperCase().split(/[\s,;]+/).filter(Boolean);
            if (!empresas.length) return errorMig("Escribe al menos un RFC.");
        }
        errorMig("");
        $("dp-mig-dlg").close();
        var hecho = await F.confirmarIdentidad("solicitar_migracion", function (c) {
            return pedir("/api/despacho/migracion", { method: "POST", body: { origen: origen, empresas: empresas, nota: $("dp-mig-nota").value.trim(), confirmacion: c } });
        });
        if (hecho) { aviso("Solicitud enviada. Te avisaremos por correo cuando quede atendida."); cargarMigraciones(); }
        else $("dp-mig-dlg").showModal();
    }

    // ------------------------------------------------------------------ invitación y salida
    async function responderInvitacion(acepta) {
        if (!acepta && !(await F.confirmar({ titulo: "¿Rechazar la invitación?", si: "Rechazar", peligro: true }))) return;
        try {
            await pedir("/api/despacho/invitacion/" + (acepta ? "aceptar" : "rechazar"), { method: "POST" });
            if (acepta) { try { sessionStorage.setItem("fc-espacio-cambio", "despacho"); } catch (e) { /* nada */ } }
            location.reload();
        } catch (e) { aviso(e.message); }
    }

    async function salir() {
        var ok = await F.confirmar({ titulo: "¿Salir del despacho «" + datos.despacho.nombre + "»?", peligro: true, si: "Salir",
            texto: "Dejas de ver sus empresas. Lo que pasaste al despacho se queda en el despacho. Si tu Mi espacio va con la licencia del despacho, queda 30 días en solo lectura y los timbres del despacho que no usaste regresan." });
        if (!ok) return;
        try {
            await pedir("/api/despacho/salir", { method: "POST" });
            location.href = "/";
        } catch (e) { aviso(e.message); }
    }

    async function reenviarInvitacion(b) {
        var correo = b.dataset.reenviar, texto = b.textContent;
        b.disabled = true; b.textContent = "Mandando…";
        try {
            var r = await pedir("/api/despacho/miembros/" + encodeURIComponent(correo) + "/reenviar", { method: "POST", body: {} });
            aviso(r.como === "enlace" ? "Listo: le mandamos a " + correo + " un enlace nuevo. Vence en 72 horas."
                                      : "Listo: le volvimos a mandar la invitación a " + correo + ".");
            b.textContent = "Reenviada";
        } catch (err) {
            aviso(err.message);
            b.disabled = false; b.textContent = texto;
        }
    }

    /* 23-nov-2026 (el dueño, Avance 1 · I.2): «Enlace» de una invitación pendiente. Con el PIN del titular, el servidor da un
       enlace (72 h, una sola vez; el del correo deja de servir) o, si la persona ya tiene contraseña, la página del despacho,
       con el mensaje ya escrito. No manda correo. Aquí: copiar el enlace, copiar el mensaje o abrir WhatsApp con el mensaje. */
    async function sacarEnlace(b) {
        var correo = b.dataset.enlace, m = miembroDe(correo) || { correo: correo }, r = null;
        var hecho = await F.confirmarIdentidad("invitar_miembro", async function (c) {
            r = await pedir("/api/despacho/miembros/" + encodeURIComponent(correo) + "/enlace", { method: "POST", body: { confirmacion: c } });
            return r;
        }, { titulo: "Enlace de la invitación", boton: "Sacar el enlace",
             resumen: '<p class="fc-identidad__aviso">Es para mandarle la invitación a <b>' + esc(m.nombre || correo) + "</b> por WhatsApp o copiarla. " +
                      "Si todavía no tiene cuenta, el enlace que le mandamos por correo deja de servir.</p>" });
        if (!hecho || !r) return;
        var dlg = $("dp-enlace-dlg");
        $("dp-enlace-sub").textContent = correo;
        $("dp-enlace-url").value = r.enlace;
        $("dp-enlace-msj").value = r.mensaje;
        $("dp-enlace-nota").textContent = r.como === "enlace"
            ? "Sirve una sola vez. Vence el " + new Date(r.vence).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short" }) +
              " a las " + new Date(r.vence).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit" }) +
              (/\.$/.test(new Date(r.vence).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit" })) ? " " : ". ") +
              "El enlace del correo ya no sirve."
            : "Ya tiene cuenta en Fiscontable: el enlace la lleva a Mi despacho, donde acepta la invitación.";
        $("dp-enlace-wa").href = "https://wa.me/?text=" + encodeURIComponent(r.mensaje);
        ["dp-enlace-copiar", "dp-enlace-copiar-msj"].forEach(function (id) { $(id).textContent = id === "dp-enlace-copiar" ? "Copiar enlace" : "Copiar mensaje"; });
        dlg.showModal();
    }
    async function copiar(boton, texto, listo) {
        var antes = boton.textContent;
        try { await navigator.clipboard.writeText(texto); boton.textContent = listo; }
        catch (e) {
            // Sin permiso del navegador para copiar: se deja seleccionado para copiarlo a mano
            var campo = boton.id === "dp-enlace-copiar" ? $("dp-enlace-url") : $("dp-enlace-msj");
            campo.focus(); campo.select(); boton.textContent = "Cópialo a mano";        // (en el teléfono no hay Ctrl+C)
        }
        setTimeout(function () { boton.textContent = antes; }, 2200);
    }

    // ------------------------------------------------------------------ eventos
    document.querySelector(".dp-vistas").addEventListener("click", function (e) {
        var b = e.target.closest("[data-vista]");
        if (b) mostrarVista(b.dataset.vista);
    });
    document.querySelector(".dp-filtro").addEventListener("click", function (e) {
        var b = e.target.closest("[data-filtro]");
        if (!b) return;
        filtroSol = b.dataset.filtro;
        document.querySelectorAll(".dp-filtro [data-filtro]").forEach(function (x) { x.setAttribute("aria-selected", String(x === b)); });
        cargarSolicitudes();
    });
    $("dp-equipo").addEventListener("click", function (e) {
        var f = e.target.closest("[data-foto]");
        if (f) return verFoto(f);
        var r = e.target.closest("[data-reenviar]");
        if (r) return reenviarInvitacion(r);
        var en = e.target.closest("[data-enlace]");
        if (en) return sacarEnlace(en);
        var b = e.target.closest("[data-editar]");
        if (b) abrirModal(datos.equipo.filter(function (m) { return m.correo === b.dataset.editar; })[0]);
    });
    // «Tus permisos en el despacho»: «Ver cuáles» y el enlace a Solicitudes (sin recargar la página)
    $("dp-yo").addEventListener("click", function (e) {
        var b = e.target.closest("[data-ver]");
        if (b) return alternarVer(b);
        var a = e.target.closest("[data-ir-vista]");
        if (a) { e.preventDefault(); mostrarVista(a.dataset.irVista); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
    $("dp-solicitudes").addEventListener("click", function (e) {
        var b = e.target.closest("[data-aceptar],[data-rechazar],[data-cancelar]");
        if (!b) return;
        if (b.dataset.cancelar) cancelarSolicitud(b.dataset.cancelar, b);
        else responder(b.dataset.aceptar || b.dataset.rechazar, !!b.dataset.aceptar, b);
    });
    $("dp-invitar").addEventListener("click", function () { abrirModal(null); });
    $("dp-papel").addEventListener("change", actualizarModal);
    $("dp-forma").addEventListener("change", function (e) {
        if (e.target.name === "dp-emp" || e.target.name === "dp-mod") actualizarModal();
        if (e.target.name === "dp-mod" || e.target.closest("#dp-modulos")) pintarExtra();
    });
    document.querySelector("#dp-modal .dp-modal-vistas").addEventListener("click", function (e) {
        var b = e.target.closest("[data-pest]");
        if (b) mostrarPestana(b.dataset.pest);
    });
    $("dp-tope").addEventListener("input", avisoTope);
    $("dp-tope-fabrica").addEventListener("click", function () { $("dp-tope").value = ""; avisoTope(); });
    $("dp-timbres-cantidad").addEventListener("keydown", function (e) { if (e.key === "Enter") e.preventDefault(); });   // no guarda la ventana
    $("dp-timbres-pasar").addEventListener("click", function () { moverTimbres("pasar"); });
    $("dp-timbres-regresar").addEventListener("click", function () { moverTimbres("regresar"); });
    $("dp-forma").addEventListener("submit", function (e) { e.preventDefault(); guardarModal(); });
    $("dp-empresas-buscar").addEventListener("input", function () {
        var q = this.value.trim().toLowerCase();
        $("dp-empresas").querySelectorAll("[data-buscar]").forEach(function (l) { l.hidden = q && l.dataset.buscar.indexOf(q) < 0; });
    });
    $("dp-guardar").addEventListener("click", guardarModal);
    $("dp-quitar").addEventListener("click", quitar);
    $("dp-modal").addEventListener("click", function (e) { if (e.target.closest("[data-cerrar]") || e.target === this) this.close(); });
    $("dp-pedir").addEventListener("submit", pedirAcceso);
    $("dp-bit-persona").addEventListener("change", cargarBitacora);
    $("dp-tra-persona").addEventListener("change", cargarTramites);
    $("dp-tra-ok").addEventListener("change", cargarTramites);
    $("dp-ajustes").addEventListener("submit", guardarAjustes);
    $("dp-nombre-forma").addEventListener("submit", guardarNombre);
    $("dp-aceptar").addEventListener("click", function () { responderInvitacion(true); });
    $("dp-rechazar").addEventListener("click", function () { responderInvitacion(false); });
    $("dp-salir").addEventListener("click", salir);
    $("dp-mig-abrir").addEventListener("click", abrirMigracion);
    $("dp-mig-enviar").addEventListener("click", enviarMigracion);
    $("dp-mig-forma").addEventListener("submit", function (e) { e.preventDefault(); enviarMigracion(); });
    $("dp-mig-forma").addEventListener("change", function (e) {
        if (e.target.name === "dp-mig-cuales") { $("dp-mig-rfcs").hidden = e.target.value !== "algunas"; if (!$("dp-mig-rfcs").hidden) $("dp-mig-rfcs").focus(); }
    });
    $("dp-mig-dlg").addEventListener("click", function (e) { if (e.target.closest("[data-mig-cerrar]")) this.close(); });
    $("dp-enlace-dlg").addEventListener("click", function (e) { if (e.target.closest("[data-enlace-cerrar]")) this.close(); });
    $("dp-enlace-dlg").addEventListener("close", function () { $("dp-enlace-url").value = ""; $("dp-enlace-msj").value = ""; $("dp-enlace-wa").href = "#"; });
    $("dp-enlace-copiar").addEventListener("click", function () { copiar(this, $("dp-enlace-url").value, "Enlace copiado ✓"); });
    $("dp-enlace-copiar-msj").addEventListener("click", function () { copiar(this, $("dp-enlace-msj").value, "Mensaje copiado ✓"); });

    cargar();
})();
