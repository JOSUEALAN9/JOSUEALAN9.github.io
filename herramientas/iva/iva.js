/*
 * herramientas/iva/iva.js — Papel de trabajo de IVA (flujo de efectivo).
 *
 * Empresa (la activa de la barra, o elegir otra con XML) y periodo con los
 * mismos cuadros de XML, Conciliación y Listas. Solo se calcula el periodo
 * elegido. Dos lados: emitidos (IVA cobrado) y recibidos (IVA acreditable).
 * El saldo a favor de meses anteriores se captura aquí (se recuerda en este
 * navegador por empresa y periodo).
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var ORIGEN = { PUE: "Factura PUE", PAGO: "Pago", NOTA: "Nota de crédito" };
    var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

    var E = { empresa: null, periodoGeneral: null, empresas: [], rfc: null, P: null, datos: null,
              lado: "emitido", perfil: null };

    async function api(ruta, opciones) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r;
    }
    async function apiJSON(ruta) { return (await api(ruta)).json(); }
    function avisar(t) { Fiscontable.aviso ? Fiscontable.aviso(t) : alert(t); }
    function m(v) { return Number(v || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function dmy(iso) { return iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : ""; }
    function guardarLocal(k, v) { try { localStorage.setItem("iva:" + k, v); } catch (e) { /* nada */ } }
    function leerLocal(k) { try { return localStorage.getItem("iva:" + k); } catch (e) { return null; } }

    /* ------------------------------------------------------------ arranque */
    async function iniciar() {
        if (!(await Fiscontable.exigirModulo("iva"))) return;
        E.P = FCPeriodoMeses.crear({ contenedor: $("periodo-iva"), alCambiar: cargar, alAvisar: avisar, conBoton: true });
        eventos();
        E.perfil = await Fiscontable.perfil();
        $("btn-conc").hidden = !(E.perfil && (E.perfil.modulos_permitidos || []).indexOf("conciliacion") !== -1);
        $("btn-xml").hidden = !(E.perfil && (E.perfil.modulos_permitidos || []).indexOf("validador") !== -1);
        E.empresa = await Fiscontable.empresaActiva();
        E.periodoGeneral = await Fiscontable.periodoActivo();
        E.urlPeriodo = Fiscontable.periodoDeUrl();                  // con F5 se vuelve al mismo periodo y lado
        if (Fiscontable.url("lado")) E.lado = Fiscontable.url("lado");
        try { E.empresas = await apiJSON("/api/iva/empresas"); } catch (e) { avisar(e.message); }
        abrirEmpresa(E.empresa && E.empresa.rfc);
        window.addEventListener("fiscontable:empresa", function (e) { E.empresa = e.detail; abrirEmpresa(e.detail && e.detail.rfc); });
        window.addEventListener("fiscontable:periodo", function (e) {
            E.periodoGeneral = e.detail;
            if (!E.rfc || !e.detail) return;
            E.P.poner({ anio: e.detail.slice(0, 4), meses: [e.detail.slice(5, 7)] });
            cargar();
        });
    }

    function nombreDe(rfc) {
        if (E.empresa && E.empresa.rfc === rfc) return E.empresa.alias || rfc;
        var c = E.empresas.find(function (x) { return x.rfc === rfc; });
        return (c && c.nombre) || rfc;
    }

    function abrirEmpresa(rfc) {
        E.rfc = rfc || null; E.datos = null;
        $("empresa-etiqueta").textContent = E.rfc ? "Empresa · " + E.rfc : "Empresa";
        $("empresa-titulo").textContent = E.rfc ? nombreDe(E.rfc) : "Elegir empresa";
        var c = E.rfc && E.empresas.find(function (x) { return x.rfc === E.rfc; });
        if (!c) {
            $("contenido").hidden = true;
            var caja = $("sin-empresa"); caja.hidden = false;
            caja.innerHTML = E.rfc
                ? '<p class="ctx-vacio__titulo">' + esc(nombreDe(E.rfc)) + ' todavía no tiene XML</p><p>El papel de trabajo sale de sus XML: cárgalos en Administración de XML o con la Descarga masiva.</p>'
                : '<p class="ctx-vacio__titulo">¿De qué empresa?</p><p>Elige una empresa en la barra de arriba o aquí.</p>' +
                  '<div class="ctx-vacio__acciones"><button type="button" class="xml-btn xml-btn--primario" data-elegir>Elegir empresa</button></div>';
            return;
        }
        $("sin-empresa").hidden = true;
        $("contenido").hidden = false;
        E.P.conteos(c.periodos || {});
        var deUrl = E.urlPeriodo; E.urlPeriodo = null;
        // Al cambiar de empresa se queda el periodo que estabas viendo; si no había, el general
        var actual = E.P.hayEleccion() ? E.P.estado() : null;
        E.P.poner(deUrl || actual || (E.periodoGeneral ? { anio: E.periodoGeneral.slice(0, 4), meses: [E.periodoGeneral.slice(5, 7)] } : null));
        cargar();
    }

    function pintarMenu() {
        $("menu-empresa").innerHTML = '<div class="xml-otra__grupo">Empresas con XML</div>' +
            (E.empresas.length ? E.empresas.map(function (c) {
                return '<button type="button" data-rfc="' + esc(c.rfc) + '"' + (c.rfc === E.rfc ? ' class="xml-activa"' : "") + ">" +
                    esc(c.nombre || c.rfc) + " <span>" + esc(c.rfc) + " · " + Object.keys(c.periodos || {}).reduce(function (t, k) { return t + (c.periodos[k] || 0); }, 0).toLocaleString("es-MX") + " XML</span></button>";
            }).join("") : '<p class="xml-otra__nota">Todavía no hay XML cargados.</p>');
    }

    /* ------------------------------------------------------------ datos */
    function clavePeriodo() {
        var est = E.P.estado();
        return E.rfc + ":" + (E.P.porFechas() ? est.desde + "_" + est.hasta : est.anio + "-" + est.meses.join("."));
    }

    async function cargar() {
        if (!E.rfc) return;
        var hay = E.P.hayEleccion();
        $("elige-periodo").hidden = hay;
        $("cuerpo").hidden = !hay;
        if (!hay) { E.datos = null; return; }
        var r = E.P.rango(), meses = E.P.meses();
        var q = new URLSearchParams({ rfc: E.rfc, desde: r.desde || "2000-01-01", hasta: r.hasta || new Date().toISOString().slice(0, 10) });
        if (meses) q.set("meses", meses.join(","));
        var pedido = q.toString();
        Fiscontable.url(Fiscontable.periodoAUrl(E.P.estado(), E.P.porFechas()));
        $("conteo").textContent = "Calculando…";
        try {
            var yo = (E.nCarga = (E.nCarga || 0) + 1);       // si cambias el periodo mientras carga, gana el último
            var datos = await apiJSON("/api/iva/papel?" + pedido);
            if (yo !== E.nCarga || E.rfc !== datos.rfc) return;
            E.datos = datos; E.pedido = pedido;
        } catch (e) { $("conteo").textContent = e.message; return; }
        $("saldo-favor").value = leerLocal("saldo:" + clavePeriodo()) || "";
        pintarResumen();
        pintarMarcas();
        pintar();
    }

    function filaRes(dt, dd, clase) {
        return "<dt" + (clase ? ' class="' + clase + '"' : "") + ">" + dt + "</dt><dd" + (clase ? ' class="' + clase + '"' : "") + ">" + dd + "</dd>";
    }

    function pintarResumen() {
        var te = E.datos.emitido.totales, tr = E.datos.recibido.totales, s = E.datos.resumen;
        $("res-cobrado").innerHTML =
            filaRes("Facturas PUE", m(te.iva_pue)) + filaRes("Cobrado con pagos", m(te.iva_pago)) +
            filaRes("Notas de crédito", m(te.iva_nota)) + filaRes("IVA cobrado", m(te.iva), "iva-total") +
            filaRes("Retenido por tus clientes", m(te.ret));
        $("res-acreditable").innerHTML =
            filaRes("Facturas PUE", m(tr.iva_pue)) + filaRes("Pagado con pagos", m(tr.iva_pago)) +
            filaRes("Notas de crédito", m(tr.iva_nota)) +
            (tr.no_acred ? filaRes("IVA pagado", m(tr.iva)) +
                filaRes('<button type="button" class="iva-link" data-ver-noacred>− No acreditable (marcas)</button>', m(-tr.no_acred), "iva-noacred") : "") +
            filaRes("IVA acreditable", m(tr.acreditable), "iva-total") +
            filaRes("Retuviste (a enterar)", m(tr.ret));
        var saldo = parseFloat($("saldo-favor").value) || 0;
        var final = Math.round((s.resultado_antes_saldo - saldo) * 100) / 100;
        $("res-resultado").innerHTML =
            filaRes("Cobrado − retenido", m(te.iva - te.ret)) + filaRes("− Acreditable", m(-tr.acreditable)) +
            (saldo ? filaRes("− Saldo a favor anterior", m(-saldo)) : "") +
            filaRes(final >= 0 ? "IVA a cargo" : "IVA a favor", m(Math.abs(final)), "iva-total " + (final >= 0 ? "iva-cargo" : "iva-favor"));
    }

    /* ---------- tablas estándar (una por pestaña) */
    var MONEDAS = [["b16", "Base 16 %"], ["i16", "IVA 16 %"], ["b8", "Base 8 %"], ["i8", "IVA 8 %"], ["b0", "Base 0 %"], ["bex", "Exentos"], ["ret", "IVA retenido"]];
    function catalogo(lado) {
        var c = [{ clave: "fecha", etiqueta: "Fecha", tipo: "fecha" }, { clave: "origen_txt", etiqueta: "Origen", tipo: "texto" },
                 { clave: "serie_folio", etiqueta: "Serie-Folio", tipo: "texto" }, { clave: "rfc", etiqueta: "RFC", tipo: "texto" },
                 { clave: "nombre", etiqueta: "Nombre", tipo: "texto" }]
            .concat(MONEDAS.map(function (x) { return { clave: x[0], etiqueta: x[1], tipo: "moneda" }; }));
        if (lado === "recibido") c.push({ clave: "no_acred", etiqueta: "No acreditable", tipo: "moneda" }, { clave: "marca_txt", etiqueta: "Marca fiscal", tipo: "texto" },
                                        { clave: "acred", etiqueta: "IVA no acreditable", tipo: "texto" });
        return c.concat([{ clave: "avisos_txt", etiqueta: "Avisos", tipo: "texto" }, { clave: "uuid", etiqueta: "UUID", tipo: "uuid" },
                         { clave: "uuid_factura", etiqueta: "UUID de la factura pagada", tipo: "uuid" }]);
    }
    var TABLAS = {};
    function tablaDe(lado) {
        if (TABLAS[lado]) return TABLAS[lado];
        var ppd = lado === "ppd";
        TABLAS[lado] = FCTabla.estandar(ppd ? {
            contenedor: $("tabla-iva-ppd"), id: "iva_ppd", claveFila: "uuid",
            catalogo: [{ clave: "fecha", etiqueta: "Fecha", tipo: "fecha" }, { clave: "lado_txt", etiqueta: "Lado", tipo: "texto" },
                       { clave: "uuid", etiqueta: "UUID", tipo: "uuid" }, { clave: "rfc", etiqueta: "RFC", tipo: "texto" },
                       { clave: "nombre", etiqueta: "Nombre", tipo: "texto" }, { clave: "total", etiqueta: "Total", tipo: "moneda" },
                       { clave: "moneda", etiqueta: "Moneda", tipo: "texto" }],
            predeterminadas: ["fecha", "lado_txt", "uuid", "rfc", "nombre", "total", "moneda"],
            anchoClave: { uuid: 300, nombre: 260 },
            buscar: { texto: "Buscar RFC, nombre o UUID…", campos: ["rfc", "nombre", "uuid"] },
            rapidos: { clave: "lado_txt", valores: [{ valor: "Emitida", etiqueta: "Emitidas" }, { valor: "Recibida", etiqueta: "Recibidas" }] },
            exportar: { nombre: function () { return E.rfc + "_PPD_sin_pago.xlsx"; }, hoja: "PPD sin pago", enBarra: false },
            vacio: { titulo: "Sin facturas PPD pendientes", texto: "" },
            alFiltrar: function (vis) { $("conteo").textContent = vis.length + " factura(s) PPD sin pago"; },
            alClic: abrirCfdi
        } : {
            contenedor: $("tabla-iva-" + lado), id: lado === "emitido" ? "iva" : "iva_recibido", claveFila: "_k",
            catalogo: catalogo(lado),
            predeterminadas: ["fecha", "origen_txt", "serie_folio", "rfc", "nombre", "b16", "i16", "b8", "i8", "b0", "bex", "ret"]
                .concat(lado === "recibido" ? ["no_acred", "marca_txt"] : []).concat(["avisos_txt"]),
            anchoClave: { origen_txt: 120, serie_folio: 110, rfc: 130, nombre: 230, avisos_txt: 260, marca_txt: 220, uuid: 300, uuid_factura: 300 },
            celda: function (c, f) {
                if (c.clave === "marca_txt") return celdaMarca(f);
                if (c.clave === "avisos_txt") return f.avisos_txt ? '<span class="iva-aviso" title="' + esc(f.avisos_txt) + '">' + esc(f.avisos_txt) + "</span>" : "";
                return null;
            },
            buscar: { texto: "Buscar RFC, nombre, folio o UUID…", campos: ["rfc", "nombre", "serie_folio", "uuid", "uuid_factura"] },
            filtros: [{ clave: "nombre", etiqueta: "Nombre" }].concat(lado === "recibido" ? [{ clave: "acred", etiqueta: "IVA no acreditable" }] : [])
                .concat([{ clave: "con_aviso", etiqueta: "Con avisos" }]),
            rapidos: { clave: "origen_txt", valores: [{ valor: "Factura PUE", etiqueta: "Facturas PUE" }, { valor: "Pago", etiqueta: "Pagos" }, { valor: "Nota de crédito", etiqueta: "Notas de crédito" }] },
            exportar: { nombre: function () { return E.rfc + "_IVA_" + (lado === "emitido" ? "cobrado" : "pagado") + ".xlsx"; }, hoja: lado === "emitido" ? "Emitidos" : "Recibidos", enBarra: false },
            vacio: { titulo: "Sin movimientos de IVA", texto: "No hay movimientos en el periodo elegido." },
            alFiltrar: function (vis) { $("conteo").textContent = vis.length + " movimiento(s)"; },
            alClic: abrirCfdi
        });
        return TABLAS[lado];
    }
    function abrirCfdi(f, lista, ev) {
        if (ev && ev.target.closest("[data-marca]")) return;               // la liga a Marcas se abre sola
        if (!E.perfil || (E.perfil.modulos_permitidos || []).indexOf("validador") === -1) return;
        Fiscontable.verCfdi(E.rfc, f.uuid, lista.map(function (x) { return x.uuid; }));
    }
    function puedeMarcas() { return !!(E.perfil && (E.perfil.modulos_permitidos || []).indexOf("marcas") !== -1); }

    // Liga a Marcas fiscales: la empresa, el mes y, si se da, el CFDI (o solo los «Por revisar»)
    function urlMarcas(lado, ym, uuid) {
        var q = new URLSearchParams({ rfc: E.rfc, anio: ym.slice(0, 4), mes: String(+ym.slice(5, 7)), lado: lado });
        if (uuid) q.set("uuid", uuid); else q.set("filtro", "revisar");
        return "/herramientas/xml/fiscal.html?" + q.toString();
    }

    function pintarMarcas() {
        var rv = E.datos.marcas_revisar || { emitidos: [], recibidos: [] }, caja = $("aviso-marcas");
        var n = rv.recibidos.length + rv.emitidos.length;
        E.porRevisar = {};
        rv.recibidos.forEach(function (x) { E.porRevisar[x.uuid] = x; });
        if (!n) { caja.hidden = true; return; }
        var lado = rv.recibidos.length ? "recibidos" : "emitidos", lista = rv[lado];
        var meses = {};
        rv.recibidos.concat(rv.emitidos).forEach(function (x) { meses[x.mes] = (meses[x.mes] || 0) + 1; });
        var porMes = Object.keys(meses).sort().map(function (k) { return MESES[+k.slice(5, 7) - 1] + " " + meses[k]; }).join(", ");
        caja.innerHTML = '<span class="iva-marcas__ico" aria-hidden="true">⚑</span><span><b>' + n + (n === 1 ? " CFDI está" : " CFDI están") +
            " «Por revisar» en Marcas fiscales</b> (" + [rv.recibidos.length ? rv.recibidos.length + " recibido(s)" : "", rv.emitidos.length ? rv.emitidos.length + " emitido(s)" : ""].filter(Boolean).join(", ") +
            (Object.keys(meses).length > 1 ? " · " + esc(porMes) : "") + "). Lo que marques ahí cambia este IVA; mientras no los revises, aquí se calculan tal como vienen en el XML." +
            '<br><small>Por ejemplo: ' + esc((lista[0].nombre || lista[0].rfc || "") + " — " + lista[0].texto) + "</small></span>" +
            (puedeMarcas() ? '<a class="xml-btn xml-btn--primario" target="_blank" rel="noopener" href="' + esc(urlMarcas(lado, lista[0].mes)) + '">Revisar en Marcas →</a>'
                           : '<small class="xml-tenue">Pide acceso al módulo Marcas fiscales para revisarlos.</small>');
        caja.hidden = false;
    }

    function textoMarca(f) {
        var pend = E.porRevisar && E.porRevisar[f.uuid_factura || f.uuid];
        return f.marca ? (f.marca.pct ? "Acreditable " + f.marca.pct + " %" : "No acreditable") + " · " + f.marca.motivo
             : pend ? "⚑ Por revisar · " + pend.texto : "";
    }
    function celdaMarca(f) {
        var pend = E.porRevisar && E.porRevisar[f.uuid_factura || f.uuid];
        var texto = f.marca_txt;
        if (!texto) return "";
        var clase = f.marca ? "iva-marca" : "iva-marca iva-marca--rev";
        return puedeMarcas() ? '<a class="' + clase + '" data-marca target="_blank" rel="noopener" href="' +
            esc(urlMarcas("recibidos", (pend && pend.mes) || f.fecha.slice(0, 7), f.uuid_factura || f.uuid)) + '" title="' + esc(texto + " — abrir en Marcas fiscales") + '">' + esc(texto) + "</a>"
            : '<span class="' + clase + '" title="' + esc(texto) + '">' + esc(texto) + "</span>";
    }

    function pintar() {
        var d = E.datos;
        var avisos = d.emitido.avisos.length + d.recibido.avisos.length;
        var ppd = d.emitido.ppd_sin_pago.length + d.recibido.ppd_sin_pago.length;
        var pest = [["emitido", "Emitidos (cobrado)", d.emitido.filas.length], ["recibido", "Recibidos (pagado)", d.recibido.filas.length]];
        if (ppd) pest.push(["ppd", "PPD sin pago", ppd]);
        if (E.lado === "ppd" && !ppd) E.lado = "emitido";
        $("pestanas").innerHTML = pest.map(function (p) {
            return '<button type="button" class="pestana' + (E.lado === p[0] ? " pestana--activa" : "") + '" data-lado="' + p[0] + '">' + p[1] +
                '<span class="xml-cuenta' + (p[0] === "ppd" ? " iva-cuenta--aviso" : "") + '">' + p[2] + "</span></button>";
        }).join("") + (avisos ? '<span class="xml-tenue iva-avisos-n">⚠ ' + avisos + " aviso(s)</span>" : "");
        ["emitido", "recibido", "ppd"].forEach(function (l) { $("tabla-iva-" + l).hidden = l !== E.lado; });
        var t = tablaDe(E.lado);
        if (E.lado === "ppd") {
            var filas = [];
            ["emitido", "recibido"].forEach(function (rol) {
                d[rol].ppd_sin_pago.forEach(function (x) { filas.push(Object.assign({ lado_txt: rol === "emitido" ? "Emitida" : "Recibida" }, x)); });
            });
            t.ponerDatos(filas);
            return;
        }
        t.ponerDatos(d[E.lado].filas.map(function (f, i) {
            var av = f.avisos || [];
            if (f.marca) av = av.filter(function (x) { return !/^IVA (no acreditable|acreditable al)/.test(x); });
            return Object.assign({}, f, { _k: i + ":" + f.uuid, origen_txt: ORIGEN[f.origen] || f.origen, avisos_txt: av.join(" · "),
                                          con_aviso: av.length ? "Sí" : "No", marca_txt: E.lado === "recibido" ? textoMarca(f) : "",
                                          acred: f.no_acred ? "Sí" : "No" });
        }));
    }

    /* ------------------------------------------------------------ acciones */
    async function exportar() {
        var b = $("btn-excel"), t = b.innerHTML;
        b.disabled = true; b.innerHTML = "<b>⏳</b>Generando…";
        try {
            var r = E.P.rango();
            var resp = await api("/api/iva/excel", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rfc: E.rfc, desde: r.desde || "2000-01-01", hasta: r.hasta || new Date().toISOString().slice(0, 10),
                                       meses: E.P.meses(), saldo_favor: parseFloat($("saldo-favor").value) || 0, nombre: nombreDe(E.rfc) })
            });
            var mt = /filename="?([^";]+)"?/.exec(resp.headers.get("Content-Disposition") || "");
            Fiscontable.guardarArchivo(await resp.blob(), mt ? mt[1] : E.rfc + "_Papel_IVA.xlsx");
        } catch (e) { avisar(e.message); }
        b.disabled = false; b.innerHTML = t;
    }

    function irA(ruta) {
        var est = E.P.estado(), q = new URLSearchParams({ rfc: E.rfc });
        if (E.P.porFechas()) { if (est.desde) q.set("desde", est.desde); if (est.hasta) q.set("hasta", est.hasta); }
        else if (est.anio) { q.set("anio", est.anio); q.set("meses", est.meses.join(",")); }
        window.open(ruta + "?" + q.toString(), "_blank", "noopener");
    }

    function verDetalle(abrir) {
        $("iva-detalle").hidden = !abrir;
        $("btn-detalle").setAttribute("aria-expanded", String(abrir));
        $("btn-detalle").textContent = abrir ? "Ocultar el detalle" : "Ver el detalle CFDI por CFDI";
        try { localStorage.setItem("fc-iva-detalle", abrir ? "1" : "0"); } catch (e) { /* sin almacenamiento */ }
    }
    function eventos() {
        var guardado = null; try { guardado = localStorage.getItem("fc-iva-detalle"); } catch (e) { /* nada */ }
        verDetalle(guardado === "1");
        $("btn-detalle").addEventListener("click", function () { verDetalle($("iva-detalle").hidden); });
        $("btn-empresa").addEventListener("click", function (e) { e.stopPropagation(); var mn = $("menu-empresa"); if (mn.hidden) pintarMenu(); mn.hidden = !mn.hidden; });
        $("menu-empresa").addEventListener("click", async function (e) {
            e.stopPropagation();
            var b = e.target.closest("[data-rfc]"); if (!b) return;
            $("menu-empresa").hidden = true;
            var c = E.empresas.find(function (x) { return x.rfc === b.dataset.rfc; });
            if (c && c.registrado && (!E.empresa || E.empresa.rfc !== c.rfc)) await Fiscontable.elegirEmpresa(c.rfc);
            else abrirEmpresa(b.dataset.rfc);
        });
        document.addEventListener("click", function () { $("menu-empresa").hidden = true; });
        $("sin-empresa").addEventListener("click", function (e) {
            if (e.target.closest("[data-elegir]")) { e.stopPropagation(); pintarMenu(); $("menu-empresa").hidden = false; }
        });
        $("pestanas").addEventListener("click", function (e) { var b = e.target.closest("[data-lado]"); if (b) { E.lado = b.dataset.lado; Fiscontable.url({ lado: E.lado }); pintar(); } });
        $("res-acreditable").addEventListener("click", function (e) {
            if (!e.target.closest("[data-ver-noacred]")) return;
            verDetalle(true); E.lado = "recibido"; Fiscontable.url({ lado: E.lado }); pintar(); tablaDe("recibido").filtrar("acred", "Sí");
            $("pestanas").scrollIntoView({ behavior: "smooth", block: "start" });
        });
        $("saldo-favor").addEventListener("input", function () { guardarLocal("saldo:" + clavePeriodo(), this.value); if (E.datos) pintarResumen(); });
        $("btn-excel").addEventListener("click", function () { if (E.datos) exportar(); });
        $("btn-excel-tabla").addEventListener("click", function () { if (E.datos) { verDetalle(true); tablaDe(E.lado).exportar(); } });
        $("btn-xml").addEventListener("click", function () { irA("/herramientas/xml/"); });
        $("btn-conc").addEventListener("click", function () { irA("/herramientas/conciliacion/"); });
    }

    document.addEventListener("DOMContentLoaded", iniciar);
})();
