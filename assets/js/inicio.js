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
    // Opinión y constancia cuentan solo si son del mes en curso (calendario): una de octubre ya no dice cómo está en noviembre
    function celdaOpinion(o) {
        if (!o) return sello("nada", "Sin consultar");
        var r = o.resultado || "Consultada";
        if (o.del_mes === false) return sello(/Negativa|No inscrito/.test(r) ? "error" : "aviso", "Falta la de " + o.mes_actual) +
            ' <small class="xml-tenue">la de ' + esc(o.mes) + ": " + esc(r.toLowerCase()) + "</small>";
        var porque = (o.motivos || []).length ? ' title="' + esc("Por qué: " + o.motivos.join(" · ")) + '"' : "";
        return '<span' + porque + ">" + sello(r === "Positiva" || r === "Inscrito sin obligaciones" ? "ok" : r === "Consultada" || /suspensi/i.test(r) ? "aviso" : "error", r) +
            ' <small class="xml-tenue">' + esc((o.motivos || []).length ? o.motivos[0].split(":")[0].slice(0, 60) + "…" : fecha(o.fecha)) + "</small></span>";
    }
    function celdaConstancia(c) {
        if (!c) return sello("nada", "Sin constancia");
        return c.del_mes ? sello("ok", "Del mes") + ' <small class="xml-tenue">' + esc(fecha(c.fecha)) + "</small>"
            : sello("aviso", "Falta la de " + c.mes_actual) + ' <small class="xml-tenue">la última es de ' + esc(c.mes) + "</small>";
    }
    function opinionVieja(f) { return f.opinion && f.opinion.del_mes === false; }
    function estadoFila(f) {
        if ((f.opinion && /Negativa|No inscrito/.test(f.opinion.resultado || "")) || f.listas || (f.buzon && f.buzon.pendientes)) return "Atender";
        if (!f.opinion || opinionVieja(f) || !f.constancia || !f.constancia.del_mes || (f.buzon && f.buzon.nuevos) || !f.efirma) return "Revisar";
        return "Al día";
    }

    /* Qué hay que atender en cada empresa, del más grave al más leve (rojo = atender, ámbar = revisar) */
    function motivos(f) {
        var m = [];
        if (f.opinion && /Negativa|No inscrito/.test(f.opinion.resultado || "")) m.push(["error", "Opinión " + f.opinion.resultado.toLowerCase()]);
        if (f.buzon && f.buzon.pendientes) m.push(["error", f.buzon.pendientes + " cancelación" + (f.buzon.pendientes === 1 ? "" : "es") + " por responder"]);
        if (f.listas) m.push(["error", f.listas + " en listas del SAT"]);
        if (f.buzon && f.buzon.nuevos) m.push(["aviso", f.buzon.nuevos + " sin leer en buzón"]);
        if (!f.opinion) m.push(["aviso", "Sin opinión"]);
        else if (opinionVieja(f)) m.push(["aviso", "Falta la opinión de " + f.opinion.mes_actual]);
        if (!f.constancia) m.push(["aviso", "Sin constancia"]);
        else if (!f.constancia.del_mes) m.push(["aviso", "Falta la constancia de " + f.constancia.mes_actual]);
        if (!f.efirma) m.push(["aviso", "Falta e.firma"]);
        return m;
    }

    var CATALOGO = [
        { clave: "empresa", etiqueta: "Empresa", tipo: "texto" },
        { clave: "estado", etiqueta: "Estado", tipo: "texto" },
        { clave: "atender", etiqueta: "Qué atender", tipo: "texto" },
        { clave: "opinion_txt", etiqueta: "Opinión 32-D", tipo: "texto" },
        { clave: "constancia_txt", etiqueta: "Constancia", tipo: "texto" },
        { clave: "cierre_txt", etiqueta: "Cierre del mes", tipo: "texto" },
        { clave: "buzon_nuevos", etiqueta: "Buzón sin leer", tipo: "numero" },
        { clave: "cancelaciones", etiqueta: "Cancelaciones por responder", tipo: "numero" },
        { clave: "listas", etiqueta: "En listas del SAT", tipo: "numero" },
        { clave: "xml_mes", etiqueta: "XML del mes", tipo: "texto" },
        { clave: "emitidos_mes", etiqueta: "Emitidos del mes", tipo: "numero" },
        { clave: "recibidos_mes", etiqueta: "Recibidos del mes", tipo: "numero" },
        { clave: "efirma_txt", etiqueta: "e.firma", tipo: "texto" },
        { clave: "rfc", etiqueta: "RFC", tipo: "texto" }
    ];
    // Filtros que se ponen desde los indicadores de arriba (también salen en «Filtros»)
    var FILTROS = [{ clave: "estado", etiqueta: "Estado" }, { clave: "f_opinion", etiqueta: "Opinión" }, { clave: "f_buzon", etiqueta: "Buzón" }, { clave: "f_cancel", etiqueta: "Cancelaciones" },
                   { clave: "f_listas", etiqueta: "Listas del SAT" }, { clave: "f_cierre", etiqueta: "Cierre del mes" }];

    /* Cierre del mes que se declara (el anterior): XML bajados, validados, constancia, opinión y declaración */
    function celdaCierre(c) {
        if (!c) return "";
        var falta = c.pasos.filter(function (p) { return !p.hecho; }).map(function (p) { return p.texto + (p.nota ? " (" + p.nota + ")" : ""); });
        var tono = c.hechos === c.total ? "ok" : c.hechos >= c.total - 2 ? "aviso" : "error";
        return '<span class="tb-cierre-celda" title="' + esc(falta.length ? "Falta: " + falta.join(" · ") : "Todo listo") + '">' +
            '<span class="tb-barrita tb-barrita--' + tono + '"><i style="width:' + Math.round(100 * c.hechos / c.total) + '%"></i></span>' +
            "<b>" + c.hechos + "/" + c.total + "</b></span>";
    }
    function pintarCierre(lista) {
        var caja = $("tb-cierre"); if (!caja) return;
        var con = lista.filter(function (f) { return f._f.cierre; });
        if (!con.length) { caja.hidden = true; return; }
        var c0 = con[0]._f.cierre, completas = con.filter(function (f) { return f._f.cierre.hechos === f._f.cierre.total; }).length;
        var hechos = con.reduce(function (s, f) { return s + f._f.cierre.hechos; }, 0), total = con.reduce(function (s, f) { return s + f._f.cierre.total; }, 0);
        var orden = [], por = {};
        con.forEach(function (f) {
            f._f.cierre.pasos.forEach(function (p) {
                if (!por[p.clave]) { por[p.clave] = { p: p, n: 0, de: 0 }; orden.push(p.clave); }
                por[p.clave].de++; if (p.hecho) por[p.clave].n++;
            });
        });
        var pasos = orden.map(function (k) {
            var x = por[k];
            return '<a class="tb-cierre__paso' + (x.n === x.de ? " tb-cierre__paso--ok" : "") + '" href="' + esc(x.p.pagina) + '"><span>' + esc(x.p.texto) + "</span><b>" + x.n + "/" + x.de + "</b></a>";
        }).join("");
        caja.hidden = false;
        caja.innerHTML = '<button type="button" class="tb-cierre__cabeza" data-filtro="f:f_cierre" title="Ver las empresas a las que les falta algo">' +
            "<span><b>Cierre de " + esc(c0.mes) + "</b> · " + completas + " de " + con.length + " empresa" + (con.length === 1 ? "" : "s") + " completa" + (con.length === 1 ? "" : "s") + "</span>" +
            '<span class="tb-barrita tb-barrita--ancha"><i style="width:' + Math.round(100 * hechos / total) + '%"></i></span><small>' + Math.round(100 * hechos / total) + " %</small></button>" +
            '<div class="tb-cierre__pasos">' + pasos + "</div>";
    }

    function filas() {
        return E.datos.empresas.map(function (f) {
            var m = motivos(f), em = f.xml_mes.emitido || 0, re = f.xml_mes.recibido || 0;
            return { rfc: f.rfc, empresa: f.alias || f.rfc, favorito: f.favorito, _f: f, _m: m, estado: estadoFila(f),
                     atender: m.map(function (x) { return x[1]; }).join(" · ") || "Nada pendiente",
                     opinion_txt: f.opinion ? (opinionVieja(f) ? "Falta la del mes (" + f.opinion.mes + ": " + (f.opinion.resultado || "consultada") + ")" : (f.opinion.resultado || "Consultada")) : "Sin consultar",
                     constancia_txt: f.constancia ? (f.constancia.del_mes ? "Del mes" : "Falta la del mes (última: " + f.constancia.mes + ")") : "Sin constancia",
                     buzon_nuevos: f.buzon ? f.buzon.nuevos : "", cancelaciones: f.buzon ? f.buzon.pendientes : "",
                     listas: f.listas || 0, emitidos_mes: em, recibidos_mes: re, xml_mes: em + " emitidos · " + re + " recibidos",
                     efirma_txt: f.efirma ? "Guardada" : "Falta",
                     f_opinion: !f.opinion || opinionVieja(f) || /Negativa|No inscrito/.test(f.opinion.resultado || "") ? "Negativa o sin consultar" : "",
                     f_buzon: f.buzon && f.buzon.nuevos ? "Con mensajes sin leer" : "",
                     f_cancel: f.buzon && f.buzon.pendientes ? "Por responder" : "",
                     f_listas: f.listas ? "Con proveedores o clientes en listas" : "",
                     cierre_txt: f.cierre ? f.cierre.hechos + " de " + f.cierre.total : "",
                     f_cierre: f.cierre && f.cierre.hechos < f.cierre.total ? "Le falta algo al cierre" : "" };
        });
    }

    function pintarResumen(lista) {
        var n = function (fn) { return lista.filter(fn).length; };
        var suma = function (fn) { return lista.reduce(function (s, f) { return s + (fn(f) || 0); }, 0); };
        var buzonMsj = suma(function (f) { return f._f.buzon && f._f.buzon.nuevos; }), cancel = suma(function (f) { return f._f.buzon && f._f.buzon.pendientes; });
        var neg = n(function (f) { return f._f.opinion && /Negativa|No inscrito/.test(f._f.opinion.resultado || ""); }), sinOp = n(function (f) { return !f._f.opinion || opinionVieja(f._f); });
        // [id, título, número, nota, tono]  — id: «e:<estado>» filtra por estado, «f:<clave>» por filtro
        var datos = [
            ["", "Empresas", lista.length, "en tu directorio", ""],
            ["e:Atender", "Por atender", n(function (f) { return f.estado === "Atender"; }), "algo urgente", "error"],
            ["e:Revisar", "Por revisar", n(function (f) { return f.estado === "Revisar"; }), "les falta algo", "aviso"],
            ["e:Al día", "Al día", n(function (f) { return f.estado === "Al día"; }), "sin pendientes", "ok"],
            ["f:f_cancel", "Cancelaciones", cancel, cancel ? "por responder en " + n(function (f) { return f.f_cancel; }) + " empresa(s)" : "nada por responder", cancel ? "error" : ""],
            ["f:f_listas", "En listas del SAT", n(function (f) { return f.f_listas; }), "empresas con proveedores o clientes", n(function (f) { return f.f_listas; }) ? "error" : ""],
            ["f:f_opinion", "Opinión 32-D", neg + sinOp, neg ? neg + " negativa(s) · " + sinOp + " sin la del mes" : sinOp + " sin la del mes", neg ? "error" : sinOp ? "aviso" : ""],
            ["f:f_buzon", "Buzón sin leer", buzonMsj, "en " + n(function (f) { return f.f_buzon; }) + " empresa(s)", buzonMsj ? "aviso" : ""]
        ];
        $("tb-resumen").innerHTML = datos.map(function (d) {
            return '<button type="button" class="tb-kpi' + (d[4] ? " tb-kpi--" + d[4] : "") + (!d[2] && d[0] ? " tb-kpi--cero" : "") + ((E.filtro || "") === d[0] ? " tb-kpi--activo" : "") +
                '" data-filtro="' + esc(d[0]) + '"><small>' + esc(d[1]) + "</small><b>" + d[2] + "</b><span>" + esc(d[3]) + "</span></button>";
        }).join("");
    }

    function pintarLado() {
        var v = (E.datos && E.datos.vencimientos) || [];
        $("tb-venc").innerHTML = v.length ? v.map(function (x) {
            return "<div><span>" + esc(x.titulo) + "</span><small>" + esc(fecha(x.fecha)) + (x.dias >= 0 ? " · en " + x.dias + " días" : " · venció") + "</small></div>";
        }).join("") : "<div><span>Nada próximo</span></div>";
        api("/api/actividad?limite=6").then(function (d) {
            $("tb-act").innerHTML = d.avisos.length ? d.avisos.map(function (a) {
                var dentro = "<span>" + esc(a.titulo) + "</span><small>" + esc(fecha(a.creada)) + "</small>";
                return a.enlace && a.enlace.charAt(0) === "/" ? '<a href="' + esc(a.enlace) + '">' + dentro + "</a>" : "<div>" + dentro + "</div>";
            }).join("") : "<div><span>Sin actividad reciente</span></div>";
        }).catch(function () { $("tb-act").innerHTML = "<div><span>—</span></div>"; });
    }

    async function cargarDespacho() {
        if (!E.tabla) {
            E.tabla = FCTabla.estandar({
                // De fábrica, solo lo que cabe a 100 % en una laptop; lo demás (XML del mes, e.firma, buzón…) en «Columnas».
                // id nuevo para que nadie se quede con el acomodo anterior de 7 columnas guardado en su navegador.
                contenedor: $("tb-tabla"), id: "tablero_v3", claveFila: "rfc", catalogo: CATALOGO,
                predeterminadas: ["empresa", "estado", "atender", "opinion_txt", "constancia_txt", "cierre_txt"],
                anchoClave: { empresa: 250, estado: 92, atender: 290, opinion_txt: 165, constancia_txt: 125, cierre_txt: 110, xml_mes: 170, efirma_txt: 90 },
                buscar: { texto: "Buscar empresa o RFC…", campos: ["empresa", "rfc"] },
                filtros: FILTROS,
                exportar: { nombre: "Tablero_empresas.xlsx", hoja: "Empresas" },
                vacio: { titulo: "Todavía no tienes empresas", texto: "Regístralas en Clientes: su nombre y su e.firma." },
                celda: function (c, r) {
                    var f = r._f;
                    if (c.clave === "empresa") return '<button type="button" class="tb-estrella' + (f.favorito ? " tb-estrella--si" : "") + '" data-estrella="' + esc(f.rfc) + '" aria-label="Favorita" title="Favorita">★</button>' +
                        "<b>" + esc(r.empresa) + '</b> <small class="xml-tenue">' + esc(f.rfc) + "</small>";
                    if (c.clave === "estado") return sello(r.estado === "Al día" ? "ok" : r.estado === "Revisar" ? "aviso" : "error", r.estado);
                    if (c.clave === "atender") {
                        if (!r._m.length) return sello("ok", "Nada pendiente");
                        var vis = r._m.slice(0, 2);
                        return '<span class="tb-motivos" title="' + esc(r.atender) + '">' + vis.map(function (x) { return '<span class="tb-motivo tb-motivo--' + x[0] + '">' + esc(x[1]) + "</span>"; }).join("") +
                            (r._m.length > 2 ? '<span class="tb-motivo tb-motivo--mas">+' + (r._m.length - 2) + "</span>" : "") + "</span>";
                    }
                    if (c.clave === "opinion_txt") return celdaOpinion(f.opinion);
                    if (c.clave === "constancia_txt") return celdaConstancia(f.constancia);
                    if (c.clave === "cierre_txt") return celdaCierre(f.cierre);
                    if (c.clave === "xml_mes") return (r.emitidos_mes + r.recibidos_mes) ? esc(r.emitidos_mes) + ' <small class="xml-tenue">emitidos</small> · ' + esc(r.recibidos_mes) + ' <small class="xml-tenue">recibidos</small>' : '<span class="xml-tenue">—</span>';
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
        pintarLado();
    }
    function pintarDespacho() {
        var lista = filas();
        pintarResumen(lista);
        pintarCierre(lista);
        E.tabla.ponerDatos(lista);
        // El indicador elegido: «e:…» filtra por estado, «f:…» por uno de los filtros
        var VALOR = { f_opinion: "Negativa o sin consultar", f_buzon: "Con mensajes sin leer", f_cancel: "Por responder", f_listas: "Con proveedores o clientes en listas", f_cierre: "Le falta algo al cierre" };
        var fil = E.filtro || "";
        FILTROS.forEach(function (x) { E.tabla.filtrar(x.clave, null); });
        if (fil.indexOf("f:") === 0) E.tabla.filtrar(fil.slice(2), VALOR[fil.slice(2)]);
        else if (fil.indexOf("e:") === 0) E.tabla.filtrar("estado", fil.slice(2));
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
                (d.cierre ? '<div class="ui-tarjeta"><p class="tb-titulo">Cierre de ' + esc(d.cierre.mes) + " " + celdaCierre(d.cierre) + '</p><div class="tb-lista">' +
                    d.cierre.pasos.map(function (p) {
                        return '<a href="' + esc(p.pagina) + '"><span>' + esc(p.texto) + "</span>" + (p.hecho ? sello("ok", "Listo") : sello("aviso", p.nota || "Falta")) + "</a>";
                    }).join("") + "</div></div>" : "") +
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
    ["tb-resumen", "tb-cierre"].forEach(function (id) {
        if ($(id)) $(id).addEventListener("click", function (e) {
            var b = e.target.closest("[data-filtro]"); if (!b) return;
            E.filtro = E.filtro === b.dataset.filtro ? null : (b.dataset.filtro || null); pintarDespacho();
        });
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
