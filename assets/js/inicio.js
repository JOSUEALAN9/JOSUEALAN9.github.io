/*
 * inicio.js — Inicio como tablero (M-01).
 *
 *  · Mis empresas: una fila por empresa con lo que hay que atender (opinión 32-D, constancia, buzón, cancelaciones
 *    por responder, listas del SAT, XML del mes). Favoritas arriba; clic en la fila = trabajar con esa empresa.
 *  · Empresa activa: ingresos y gastos del mes y del año (de sus XML), IVA estimado, opinión, constancia, próximos
 *    vencimientos y sus últimos avisos.
 * Los accesos a los módulos están en la barra lateral y en Ctrl+K.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var E = { vista: null, datos: null, filtro: null, tabla: null, empresa: null };
    var dinero = function (v) { return "$" + Number(v || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var fecha = function (iso) { return iso ? new Date(String(iso).length <= 10 ? iso + "T12:00:00" : iso + (String(iso).length <= 19 ? "Z" : "")).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : ""; };

    async function api(ruta) {
        var r = await fetch(API + ruta, { credentials: "include" });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function guardarVista(v) { try { localStorage.setItem("fc-inicio-vista", v); } catch (e) { /* nada */ } }
    function vistaGuardada() { try { return localStorage.getItem("fc-inicio-vista"); } catch (e) { return null; } }

    /* ---------------------------------------------------------------- semáforo */
    function sello(tono, texto) { return '<span class="tb-sello tb-sello--' + tono + '">' + esc(texto) + "</span>"; }
    function celdaOpinion(o) {
        if (!o) return sello("nada", "Sin consultar");
        var r = o.resultado || "Consultada";
        return sello(r === "Positiva" || r === "Inscrito sin obligaciones" ? "ok" : r === "Consultada" ? "aviso" : "error", r) + ' <small class="xml-tenue">' + esc(fecha(o.fecha)) + "</small>";
    }
    function celdaConstancia(c) {
        if (!c) return sello("nada", "Sin constancia");
        return sello(c.del_mes ? "ok" : "aviso", c.del_mes ? "Del mes" : "De hace " + c.dias + " días");
    }
    function estadoFila(f) {
        if ((f.opinion && /Negativa|No inscrito/.test(f.opinion.resultado || "")) || f.listas || (f.buzon && f.buzon.pendientes)) return "Atender";
        if (!f.opinion || !f.constancia || !f.constancia.del_mes || (f.buzon && f.buzon.nuevos) || !f.efirma) return "Revisar";
        return "Al día";
    }

    var CATALOGO = [
        { clave: "empresa", etiqueta: "Empresa", tipo: "texto" },
        { clave: "estado", etiqueta: "Estado", tipo: "texto" },
        { clave: "opinion_txt", etiqueta: "Opinión 32-D", tipo: "texto" },
        { clave: "constancia_txt", etiqueta: "Constancia", tipo: "texto" },
        { clave: "buzon_nuevos", etiqueta: "Buzón sin leer", tipo: "numero" },
        { clave: "cancelaciones", etiqueta: "Cancelaciones por responder", tipo: "numero" },
        { clave: "listas", etiqueta: "En listas del SAT", tipo: "numero" },
        { clave: "emitidos_mes", etiqueta: "Emitidos del mes", tipo: "numero" },
        { clave: "recibidos_mes", etiqueta: "Recibidos del mes", tipo: "numero" },
        { clave: "efirma_txt", etiqueta: "e.firma", tipo: "texto" },
        { clave: "rfc", etiqueta: "RFC", tipo: "texto" }
    ];

    function filas() {
        return E.datos.empresas.map(function (f) {
            return { rfc: f.rfc, empresa: f.alias || f.rfc, favorito: f.favorito, _f: f, estado: estadoFila(f),
                     opinion_txt: f.opinion ? (f.opinion.resultado || "Consultada") : "Sin consultar",
                     constancia_txt: f.constancia ? (f.constancia.del_mes ? "Del mes" : "Vieja") : "Sin constancia",
                     buzon_nuevos: f.buzon ? f.buzon.nuevos : "", cancelaciones: f.buzon ? f.buzon.pendientes : "",
                     listas: f.listas || 0, emitidos_mes: f.xml_mes.emitido || 0, recibidos_mes: f.xml_mes.recibido || 0,
                     efirma_txt: f.efirma ? "Guardada" : "Falta" };
        });
    }

    function pintarResumen(lista) {
        var n = function (fn) { return lista.filter(fn).length; };
        var datos = [
            ["", "Empresas", lista.length, false],
            ["Atender", "Por atender", n(function (f) { return f.estado === "Atender"; }), true],
            ["Revisar", "Por revisar", n(function (f) { return f.estado === "Revisar"; }), false],
            ["Al día", "Al día", n(function (f) { return f.estado === "Al día"; }), false]
        ];
        $("tb-resumen").innerHTML = datos.map(function (d) {
            return '<button type="button" class="tb-dato' + (d[3] && d[2] ? " tb-dato--alerta" : "") + ((E.filtro || "") === d[0] ? " tb-dato--activo" : "") + '" data-filtro="' + esc(d[0]) + '">' +
                "<small>" + esc(d[1]) + "</small><b>" + d[2] + "</b></button>";
        }).join("");
    }

    async function cargarDespacho() {
        if (!E.tabla) {
            E.tabla = FCTabla.estandar({
                contenedor: $("tb-tabla"), id: "tablero", claveFila: "rfc", catalogo: CATALOGO,
                predeterminadas: ["empresa", "estado", "opinion_txt", "constancia_txt", "buzon_nuevos", "cancelaciones", "listas", "emitidos_mes", "recibidos_mes", "efirma_txt"],
                anchoClave: { empresa: 260, estado: 110, opinion_txt: 200, constancia_txt: 150, cancelaciones: 120 },
                buscar: { texto: "Buscar empresa o RFC…", campos: ["empresa", "rfc"] },
                rapidos: { clave: "estado", valores: [{ valor: "Atender", etiqueta: "Por atender" }, { valor: "Revisar", etiqueta: "Por revisar" }, { valor: "Al día", etiqueta: "Al día" }] },
                exportar: { nombre: "Tablero_empresas.xlsx", hoja: "Empresas" },
                vacio: { titulo: "Todavía no tienes empresas", texto: "Regístralas en Clientes: su nombre y su e.firma." },
                celda: function (c, r) {
                    var f = r._f;
                    if (c.clave === "empresa") return '<button type="button" class="tb-estrella' + (f.favorito ? " tb-estrella--si" : "") + '" data-estrella="' + esc(f.rfc) + '" aria-label="Favorita" title="Favorita">★</button>' +
                        "<b>" + esc(r.empresa) + '</b> <small class="xml-tenue">' + esc(f.rfc) + "</small>";
                    if (c.clave === "estado") return sello(r.estado === "Al día" ? "ok" : r.estado === "Revisar" ? "aviso" : "error", r.estado);
                    if (c.clave === "opinion_txt") return celdaOpinion(f.opinion);
                    if (c.clave === "constancia_txt") return celdaConstancia(f.constancia);
                    if (c.clave === "buzon_nuevos") return f.buzon ? (f.buzon.nuevos ? sello("aviso", f.buzon.nuevos + " sin leer") : sello("nada", "—")) : "";
                    if (c.clave === "cancelaciones") return f.buzon && f.buzon.pendientes ? sello("error", f.buzon.pendientes + " por responder") : "";
                    if (c.clave === "listas") return f.listas ? sello("error", f.listas + " en listas") : "";
                    if (c.clave === "efirma_txt") return f.efirma ? sello("ok", "Guardada") : sello("aviso", "Falta");
                    return null;
                },
                alClic: function (r) { trabajarCon(r.rfc); }
            });
            $("tb-tabla").addEventListener("click", function (e) {
                var b = e.target.closest("[data-estrella]"); if (!b) return;
                e.stopPropagation();
                marcarFavorita(b.dataset.estrella);
            }, true);
        }
        E.tabla.cargando("Revisando tus empresas…");
        try { E.datos = await api("/api/tablero"); }
        catch (e) { E.tabla.error(e.message, cargarDespacho); return; }
        pintarDespacho();
    }
    function pintarDespacho() {
        var lista = filas();
        pintarResumen(lista);
        E.tabla.ponerDatos(lista);
        E.tabla.rapido(E.filtro || null);
    }
    async function marcarFavorita(rfc) {
        var f = E.datos.empresas.find(function (x) { return x.rfc === rfc; }); if (!f) return;
        try {
            var r = await fetch(API + "/api/clientes/" + encodeURIComponent(rfc) + "/favorito", { method: "PUT", credentials: "include",
                headers: { "Content-Type": "application/json" }, body: JSON.stringify({ favorito: !f.favorito }) });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            f.favorito = !f.favorito;
            E.datos.empresas.sort(function (a, b) { return (b.favorito - a.favorito) || (a.alias || a.rfc).localeCompare(b.alias || b.rfc); });
            pintarDespacho();
            window.dispatchEvent(new CustomEvent("fiscontable:favoritos"));
        } catch (e) { Fiscontable.toast(e.message); }
    }
    async function trabajarCon(rfc) {
        try { await Fiscontable.elegirEmpresa(rfc); } catch (e) { Fiscontable.toast(e.message); return; }
        verVista("empresa");
    }

    /* ---------------------------------------------------------------- vista de la empresa activa */
    async function cargarEmpresa() {
        var caja = $("tb-empresa");
        var empresa = await Fiscontable.empresaActiva();
        E.empresa = empresa;
        if (!empresa) {
            caja.innerHTML = '<div class="ui-vacio">' + Fiscontable.icono("edificio") + "<b>Elige una empresa</b><span>Arriba, en el selector de empresa, o haz clic en una fila de «Mis empresas».</span></div>";
            return;
        }
        caja.innerHTML = '<div class="tb-rejilla">' + '<div class="tb-cifra"><span class="ui-skel" style="width:60%"></span><span class="ui-skel" style="width:80%;height:22px"></span></div>'.repeat(4) + "</div>";
        var periodo = await Fiscontable.periodoActivo();
        var d;
        try { d = await api("/api/tablero/empresa?rfc=" + encodeURIComponent(empresa.rfc) + (periodo ? "&periodo=" + periodo : "")); }
        catch (e) { caja.innerHTML = '<div class="ui-falla">' + Fiscontable.icono("alerta") + "<b>No se pudo cargar</b><span>" + esc(e.message) + "</span></div>"; return; }
        var mes = d.mes_nombre.charAt(0).toUpperCase() + d.mes_nombre.slice(1);
        var cifra = function (titulo, valor, nota) { return '<div class="tb-cifra"><small>' + esc(titulo) + "</small><b>" + esc(valor) + "</b><span>" + esc(nota || "") + "</span></div>"; };
        var iva = d.iva_estimado;
        var op = d.opinion, co = d.constancia;
        caja.innerHTML =
            '<div class="tb-rejilla">' +
                cifra("Ingresos de " + d.mes_nombre, dinero(d.mes.ingresos), d.mes.n_emitidos + " facturas emitidas · sin IVA") +
                cifra("Gastos de " + d.mes_nombre, dinero(d.mes.gastos), d.mes.n_recibidos + " facturas recibidas · sin IVA") +
                cifra("IVA estimado de " + d.mes_nombre, (iva < 0 ? "-" : "") + dinero(Math.abs(iva)), iva >= 0 ? "a cargo (cobrado menos pagado en facturas)" : "a favor (cobrado menos pagado en facturas)") +
                cifra("En " + d.periodo.slice(0, 4), dinero(d.anio.ingresos), "ingresos · gastos " + dinero(d.anio.gastos)) +
            "</div>" +
            '<div class="tb-columnas">' +
                '<div class="ui-tarjeta"><p class="tb-titulo">Cumplimiento</p><div class="tb-lista">' +
                    '<a href="/herramientas/opinion/"><span>Opinión 32-D</span>' + celdaOpinion(op) + "</a>" +
                    '<a href="/herramientas/constancias/"><span>Constancia</span>' + celdaConstancia(co) + "</a>" +
                    '<a href="/herramientas/iva/"><span>Papel de trabajo de IVA de ' + esc(d.mes_nombre) + "</span><small>Abrir →</small></a>" +
                "</div></div>" +
                '<div class="ui-tarjeta"><p class="tb-titulo">Próximos vencimientos</p><div class="tb-lista">' +
                    (d.vencimientos.length ? d.vencimientos.map(function (v) {
                        return "<div><span>" + esc(v.titulo) + "</span><small>" + esc(fecha(v.fecha)) + (v.dias >= 0 ? " · en " + v.dias + " días" : " · venció") + "</small></div>";
                    }).join("") : "<div><span>Nada próximo</span></div>") +
                '</div><p class="xml-tenue" style="font-size:12px;margin:8px 0 0">Fechas generales; revisa las de tu régimen.</p></div>' +
                '<div class="ui-tarjeta"><p class="tb-titulo">Últimos avisos</p><div class="tb-lista">' +
                    (d.avisos.length ? d.avisos.map(function (a) {
                        var dentro = "<span>" + esc(a.titulo) + "</span><small>" + esc(fecha(a.creada)) + "</small>";
                        return a.enlace && a.enlace.charAt(0) === "/" ? '<a href="' + esc(a.enlace) + '">' + dentro + "</a>" : "<div>" + dentro + "</div>";
                    }).join("") : "<div><span>Sin avisos de esta empresa</span></div>") +
                "</div></div>" +
            "</div>" +
            '<p class="xml-tenue" style="font-size:12px;margin-top:12px">' + esc(mes) + " según los XML guardados (vigentes y sin validar; notas de crédito restan). Es un estimado: el cálculo fino está en IVA y Conciliación.</p>";
    }

    /* ---------------------------------------------------------------- vistas */
    function verVista(v) {
        E.vista = v; guardarVista(v);
        document.querySelectorAll("#tb-vista [data-vista]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.vista === v)); });
        $("tb-despacho").hidden = v !== "despacho";
        $("tb-empresa").hidden = v !== "empresa";
        if (v === "despacho") cargarDespacho(); else cargarEmpresa();
    }
    $("tb-vista").addEventListener("click", function (e) { var b = e.target.closest("[data-vista]"); if (b) verVista(b.dataset.vista); });
    $("tb-resumen").addEventListener("click", function (e) {
        var b = e.target.closest("[data-filtro]"); if (!b) return;
        E.filtro = b.dataset.filtro || null; pintarDespacho();
    });

    function recientes() {
        var cat = Fiscontable.catalogo || [];
        var rec = Fiscontable.recientes().slice(0, 6).map(function (c) { return cat.filter(function (m) { return m.clave === c; })[0]; })
            .filter(function (m) { return m && Fiscontable.permitido(m); });
        $("inicio-recientes").hidden = !rec.length;
        $("inicio-recientes-lista").innerHTML = rec.map(function (m) { return '<a href="' + esc(m.url) + '">' + esc(m.nombre) + "</a>"; }).join("");
    }

    /* ---------------------------------------------------------------- «Configura tu cuenta» (sección 8) */
    async function pasosCuenta() {
        var oculto = false; try { oculto = localStorage.getItem("fc-pasos-oculto") === "1"; } catch (e) { /* nada */ }
        if (oculto) return;
        var d; try { d = await api("/api/inicio/pasos"); } catch (e) { return; }
        if (d.hechos >= d.total) return;
        var caja = $("tb-pasos");
        caja.innerHTML = '<div class="tb-pasos__cabeza"><b>Configura tu cuenta</b><span class="xml-tenue">' + d.hechos + " de " + d.total + "</span>" +
            '<span class="tb-pasos__barra"><span style="width:' + Math.round(d.hechos * 100 / d.total) + '%"></span></span>' +
            '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28 tb-pasos__ocultar" id="tb-pasos-ocultar">Ocultar</button></div><ol>' +
            d.pasos.map(function (p) {
                var dentro = "<i>" + (p.hecho ? "✓" : "") + "</i><span>" + esc(p.titulo) + (p.detalle ? " <small>· " + esc(p.detalle) + "</small>" : "") + "</span>";
                var href = p.enlace || (p.accion === "perfil" ? "/configuracion/?seccion=perfil" : "#");
                return '<li class="' + (p.hecho ? "tb-paso--hecho" : "") + '">' + (p.hecho ? "<span>" + dentro + "</span>" : '<a href="' + esc(href) + '">' + dentro + "</a>") + "</li>";
            }).join("") + "</ol>";
        caja.hidden = false;
        $("tb-pasos-ocultar").addEventListener("click", function () { try { localStorage.setItem("fc-pasos-oculto", "1"); } catch (e) { /* nada */ } caja.hidden = true; });
    }

    var arrancado = false;
    document.addEventListener("fc:perfil", function (ev) {
        var p = ev.detail;
        var nombre = p && (p.nombre || (p.correo || "").split("@")[0]);
        $("saludo").textContent = nombre ? "Hola, " + nombre.split(" ")[0] : "Bienvenido";
        if (!p || arrancado) return;
        arrancado = true;
        recientes();
        if (!p.viendo_como) pasosCuenta();
        var e = p.empresa_activa;
        $("tb-vista-empresa").textContent = e ? (e.alias || e.rfc) : "Empresa activa";
        verVista(vistaGuardada() || (e ? "empresa" : "despacho"));
    });
    window.addEventListener("fiscontable:empresa", function (ev) {
        var e = ev.detail;
        $("tb-vista-empresa").textContent = e ? (e.alias || e.rfc) : "Empresa activa";
        if (E.vista === "empresa") cargarEmpresa();
    });
    window.addEventListener("fiscontable:periodo", function () { if (E.vista === "empresa") cargarEmpresa(); });
})();
