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
    function avisar(t) { Fiscontable.aviso ? Fiscontable.aviso(t) : Fiscontable.avisar(t); }
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
            if ($("dlg-sat").open) $("dlg-sat").close();
        } catch (e) { $("conteo").textContent = e.message; return; }
        $("saldo-favor").value = leerLocal("saldo:" + clavePeriodo()) || "";
        pintarResumen();
        pintarAvisosPapel();
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
        var x = aplicarSaldo(s.resultado_antes_saldo, parseFloat($("saldo-favor").value) || 0);
        $("res-resultado").innerHTML =
            filaRes("Cobrado − retenido", m(te.iva - te.ret)) + filaRes("− Acreditable", m(-tr.acreditable)) +
            (x.aplicado ? filaRes("− Saldo a favor anterior aplicado", m(-x.aplicado)) : "") +
            (x.aFavor ? filaRes("IVA a favor del periodo", m(x.aFavor), "iva-total iva-favor") : filaRes("IVA a cargo", m(x.aCargo), "iva-total iva-cargo")) +
            (x.queda ? filaRes("Saldo a favor anterior que queda por aplicar", m(x.queda)) : "");
    }

    // 23-nov-2026 (auditoría web-5): el saldo a favor de meses anteriores se acredita solo hasta lo que sale a cargo, como el
    // SAT; lo que sobra no es saldo a favor del periodo: se enseña aparte («queda por aplicar»). Igual en el Excel.
    function aplicarSaldo(resultado, saldo) {
        var r2 = function (v) { return Math.round(v * 100) / 100; };
        saldo = Math.max(saldo || 0, 0);
        var cargo = Math.max(resultado, 0), aplicado = r2(Math.min(saldo, cargo));
        return { aplicado: aplicado, aCargo: r2(cargo - aplicado), aFavor: r2(Math.max(-resultado, 0)), queda: r2(saldo - aplicado) };
    }

    // 23-nov-2026 (auditoría conc_visores-8): antes de usar estas cifras: CFDI del periodo sin validar ante el SAT (con
    // «Validar ahora»), listas del SAT que no están al día y meses cerrados en Marcas fiscales.
    function pintarAvisosPapel() {
        var d = E.datos, caja = $("aviso-papel");
        if (!caja) {
            caja = document.createElement("div"); caja.id = "aviso-papel"; caja.className = "iva-marcas"; caja.setAttribute("role", "status");
            $("aviso-marcas").parentNode.insertBefore(caja, $("aviso-marcas"));
            caja.addEventListener("click", function (e) { if (e.target.id === "iva-validar") validarAhora(); });
        }
        var lineas = [], n = (d.sin_validar || []).length, listas = d.listas_no_al_dia || [];
        var puede = E.perfil && (E.perfil.modulos_permitidos || []).indexOf("validador") !== -1;
        if (n) lineas.push("<b>" + n.toLocaleString("es-MX") + " CFDI del periodo sin validar</b> ante el SAT: si alguno está cancelado, el resultado cambia." +
            (puede ? ' <button type="button" class="xml-btn" id="iva-validar">Validar ahora</button>' : ""));
        if (listas.length) lineas.push("<b>Listas del SAT que no están al día:</b> " + listas.map(function (l) {
            return esc(l.nombre) + " (" + (l.estado === "Sin descargar" ? "sin descargar" : "al " + dmy(l.fecha)) + ")";
        }).join(", ") + ". El aviso de proveedores en listas puede no estar al día.");
        // 24-nov-2026 (revisión): los meses cerrados en UNA línea (un periodo de varios meses ya presentados no llena la caja)
        var cerr = d.meses_cerrados || [];
        if (cerr.length) {
            var nom = function (c) { return MESES[+c.mes.slice(5, 7) - 1] + " " + c.mes.slice(0, 4); };
            var cambian = cerr.reduce(function (t, c) { return t + (c.cambios || 0); }, 0), uno = cerr.length === 1;
            lineas.push("🔒 <b>" + (uno ? nom(cerr[0]).charAt(0).toUpperCase() + nom(cerr[0]).slice(1) + " está cerrado" : cerr.length + " meses están cerrados") +
                "</b> en Marcas fiscales" + (uno ? "" : " (" + cerr.slice(0, 6).map(nom).join(", ") + (cerr.length > 6 ? "…" : "") + ")") +
                ": se calcula" + (uno ? "" : "n") + " con las marcas del cierre" + (cambian ? " (con las de hoy cambiarían " + cambian + " CFDI)" : "") + ".");
        }
        caja.hidden = !lineas.length;
        caja.innerHTML = '<span class="iva-marcas__ico" aria-hidden="true">⚠</span><span>' + lineas.join("<br>") + "</span>";
    }
    async function validarAhora() {
        var b = $("iva-validar");
        if (!b || !E.datos) return;
        b.disabled = true; b.textContent = "Validando…";
        try {
            await api("/api/xml/validar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rfc: E.rfc, uuids: E.datos.sin_validar.slice(0, 20000) }) });   // el servidor valida hasta 20,000 por vez
        } catch (e) { avisar(e.message); b.disabled = false; b.textContent = "Validar ahora"; return; }
        var vueltas = 0;
        (async function esperar() {
            var r = null;
            try { r = await apiJSON("/api/xml/validacion?rfc=" + encodeURIComponent(E.rfc)); } catch (e) { r = null; }
            if (r && r.estado === "corriendo" && vueltas++ < 600) {
                var bb = $("iva-validar"); if (bb) bb.textContent = "Validando… " + (r.hechos || 0) + " de " + (r.total || 0);
                setTimeout(esperar, 3000); return;
            }
            cargar();
        })();
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
            exportar: { hoja: "PPD sin pago", enBarra: false, servidor: function () { return excelServidor("ppd"); } },
            vacio: { titulo: "Sin facturas PPD pendientes", texto: "" },
            alFiltrar: function (vis) { $("conteo").textContent = vis.length + " factura(s) PPD sin pago"; },
            ligaFila: ligaFila,          // 23-nov-2026 (decisión E): el folio/UUID, enlace real a la factura (Ctrl+clic: otra pestaña)
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
            exportar: { hoja: lado === "emitido" ? "Emitidos (cobrado)" : "Recibidos (pagado)", enBarra: false, totales: true,
                        servidor: function () { return excelServidor(lado); } },
            vacio: { titulo: "Sin movimientos de IVA", texto: "No hay movimientos en el periodo elegido." },
            alFiltrar: function (vis) { $("conteo").textContent = vis.length + " movimiento(s)"; },
            ligaFila: ligaFila,
            alClic: abrirCfdi
        });
        return TABLAS[lado];
    }
    /* 24-nov-2026 (decisión A del dueño, Avance 2): «Descargar Excel › Esta tabla» lo arma el servidor con lo que ves (columnas en
       su orden, filtros, búsqueda o lo marcado), con el encabezado de siempre y el nombre de todos («RFC_Papel-IVA-Emitidas_
       2026-10_tabla.xlsx»). Los importes ya van en pesos; con moneda extranjera van al final «Moneda» y «T.C. usado». */
    function excelServidor(lado) {
        var r = E.P.rango();
        return {
            ruta: "/api/iva/excel/tabla",
            cuerpo: { rfc: E.rfc, desde: r.desde || "2000-01-01", hasta: r.hasta || new Date().toISOString().slice(0, 10),
                      meses: E.P.meses(), pestana: lado, nombre: nombreDe(E.rfc) },
            extra: function (filas, cols) {
                var hay = filas.some(function (f) { return f.moneda && f.moneda !== "MXN" && f.moneda !== "XXX"; });
                var tiene = function (k) { return cols.some(function (c) { return c.clave === k; }); };
                if (!hay) return [];
                return [!tiene("moneda") && { clave: "moneda", etiqueta: "Moneda", tipo: "texto" },
                        lado !== "ppd" && !tiene("tc") && { clave: "tc", etiqueta: "T.C. usado (del CFDI)", tipo: "numero" }].filter(Boolean);
            }
        };
    }
    function ligaFila(f) {
        var puede = E.perfil && (E.perfil.modulos_permitidos || []).indexOf("validador") !== -1;
        return puede && Fiscontable.urlFactura ? Fiscontable.urlFactura(E.rfc, f.uuid) : "";
    }
    function abrirCfdi(f, lista, ev) {
        if (ev && ev.target.closest("[data-marca]")) return;               // la liga a Marcas se abre automáticamente
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

    /* ---------- Formato SAT (15-nov, el dueño: «algo como ver formato SAT y ya me muestra esas ventanas»): los mismos números
       del papel de trabajo, acomodados como la declaración de IVA del portal (IVA a cargo, IVA acreditable, Determinación y
       Pago). Cada renglón con importe abre su detalle: los CFDI que lo forman, como el «Capturar» del SAT. */
    var SAT = { pestana: "cargo", detalle: null };
    var PESTANAS_SAT = [["cargo", "IVA a cargo"], ["acreditable", "IVA acreditable"], ["determinacion", "Determinación"], ["pago", "Pago"]];
    function r2(v) { return Math.round((v || 0) * 100) / 100; }
    function calculoSat() {
        var te = E.datos.emitido.totales, tr = E.datos.recibido.totales;
        var saldoAnt = parseFloat($("saldo-favor").value) || 0;
        var neto = r2(te.iva - te.ret - tr.acreditable);
        var aCargo = Math.max(neto, 0), aFavor = Math.max(-neto, 0);
        var acred = r2(Math.min(saldoAnt, aCargo)), impuesto = r2(aCargo - acred);
        var frontera = function (s) { return !!(s.b8 || s.i8); };
        return {
            cargo: [
                ["Valor de los actos o actividades gravados a la tasa del 16 %", te.b16, { lado: "emitido", campo: "b16" }],
                frontera(te) && ["Valor de los actos o actividades gravados a la tasa del 8 % (región fronteriza)", te.b8, { lado: "emitido", campo: "b8" }, "+"],
                ["Valor de los actos o actividades gravados a la tasa del 0 % (exportación y otros)", te.b0, { lado: "emitido", campo: "b0" }, "+"],
                ["Suma de los actos o actividades gravados", r2(te.b16 + te.b8 + te.b0), null, "=", true],
                ["Valor de los actos o actividades por los que no se deba pagar el impuesto (exentos)", te.bex, { lado: "emitido", campo: "bex" }],
                ["IVA a cargo a la tasa del 16 %", te.i16, { lado: "emitido", campo: "i16" }],
                frontera(te) && ["IVA a cargo a la tasa del 8 %", te.i8, { lado: "emitido", campo: "i8" }],
                ["IVA a cargo", te.iva, null, "", true]
            ],
            acreditable: [
                ["Valor de los actos o actividades pagados a la tasa del 16 %", tr.b16, { lado: "recibido", campo: "b16" }],
                frontera(tr) && ["Valor de los actos o actividades pagados sujetos al estímulo de la región fronteriza", tr.b8, { lado: "recibido", campo: "b8" }],
                ["Valor de los demás actos o actividades pagados a la tasa del 0 %", tr.b0, { lado: "recibido", campo: "b0" }],
                ["Valor de los actos o actividades pagados por los que no se pagará el IVA (exentos)", tr.bex, { lado: "recibido", campo: "bex" }],
                ["IVA de actos o actividades pagados a la tasa del 16 %", tr.i16, { lado: "recibido", campo: "i16" }],
                frontera(tr) && ["IVA pagado sujeto al estímulo de la región fronteriza", tr.i8, { lado: "recibido", campo: "i8" }],
                tr.no_acred && ["IVA no acreditable (Marcas fiscales: efectivo, EFOS, proporción…)", -tr.no_acred, { lado: "recibido", campo: "no_acred" }, "−"],
                ["Total de IVA acreditable", tr.acreditable, null, "=", true]
            ],
            determinacion: [
                ["Total de IVA a cargo", te.iva],
                ["IVA retenido (el que te retuvieron tus clientes)", te.ret, { lado: "emitido", campo: "ret" }, "−"],
                ["Total de IVA acreditable", tr.acreditable, null, "−"],
                ["Otras cantidades a cargo del contribuyente", 0],
                ["Otras cantidades a favor del contribuyente", 0],
                ["Cantidad a cargo", aCargo, null, "", true],
                ["Saldo a favor", aFavor, null, "", true],
                ["Acreditamiento del saldo a favor de periodos anteriores (sin exceder la cantidad a cargo)", acred, null, "−"],
                ["Impuesto a cargo", impuesto, null, "=", true],
                ["Impuesto a favor", aFavor, null, "", true]
            ],
            pago: [
                ["A cargo", impuesto],
                ["Parte actualizada", 0, null, "+"],
                ["Recargos", 0, null, "+"],
                ["Total de contribuciones", impuesto, null, "=", true],
                ["¿Tienes compensaciones por aplicar?", 0],
                ["¿Tienes estímulos por aplicar?", 0],
                ["Total de aplicaciones", 0, null, "=", true],
                ["Cantidad a pagar", impuesto, null, "", true]
            ],
            saldoAnt: saldoAnt, retuviste: tr.ret
        };
    }
    function abrirSat() {
        if (!E.datos) return;
        SAT.detalle = null;
        $("sat-sub").textContent = nombreDe(E.rfc) + " · " + E.rfc + " · " + (E.datos.periodo_texto || "") + " · flujo de efectivo, con tus XML";
        pintarSat();
        if (!$("dlg-sat").open) $("dlg-sat").showModal();
    }
    function pintarSat() {
        var c = calculoSat();
        $("sat-pestanas").innerHTML = PESTANAS_SAT.map(function (p) {
            return '<button type="button" role="tab" data-sat-p="' + p[0] + '" aria-selected="' + (p[0] === SAT.pestana) + '">' + (p[0] === SAT.pestana ? "✓ " : "") + p[1] + "</button>";
        }).join("");
        var notas = {
            cargo: "Lo cobrado en el periodo: facturas PUE de su mes, PPD cuando se cobran (complementos) y menos notas de crédito. Lo cancelado no cuenta.",
            acreditable: "Lo pagado en el periodo, con las Marcas fiscales aplicadas (lo no acreditable resta)." + (c.retuviste ? " El IVA que tú retuviste (" + m(c.retuviste) + ") se entera aparte, en retenciones." : ""),
            determinacion: c.saldoAnt ? "Saldo a favor de periodos anteriores capturado: " + m(c.saldoAnt) + "." : "Si tienes saldo a favor de periodos anteriores, captúralo en el resumen («Saldo a favor de meses anteriores»).",
            pago: "Actualización y recargos solo si se presenta fuera de plazo: no se calculan aquí."
        };
        var cuerpo = $("sat-cuerpo");
        if (SAT.detalle) { cuerpo.innerHTML = detalleSat(SAT.detalle); $("sat-nota").textContent = "Clic en un renglón para ver su CFDI."; return; }
        cuerpo.innerHTML = '<p class="iva-sat__aviso">' + esc(notas[SAT.pestana]) + "</p>" + '<div class="iva-sat__lista">' +
            c[SAT.pestana].filter(Boolean).map(function (x, i) {
                var hay = x[2] && E.datos[x[2].lado].filas.some(function (f) { return Math.abs(f[x[2].campo] || 0) > 0.004; });
                return '<div class="iva-sat__fila' + (x[4] ? " iva-sat__fila--total" : "") + '"><span class="iva-sat__concepto">*' + esc(x[0]) + "</span>" +
                    '<span class="iva-sat__signo">' + (x[3] ? "(" + x[3] + ")" : "") + "</span>" +
                    '<span class="iva-sat__importe">' + m(x[1]) + "</span>" +
                    (hay ? '<button type="button" class="iva-sat__capturar" data-sat-det="' + i + '">Detalle</button>' : '<span class="iva-sat__capturar iva-sat__capturar--vacio"></span>') + "</div>";
            }).join("") + "</div>";
        $("sat-nota").textContent = "Los importes llevan centavos; el SAT los redondea a pesos al declarar.";
    }
    function detalleSat(d) {
        var filas = E.datos[d.lado].filas.filter(function (f) { return Math.abs(f[d.campo] || 0) > 0.004; });
        var total = filas.reduce(function (s, f) { return s + (f[d.campo] || 0); }, 0);
        var ORIGEN = { PUE: "Factura PUE", PAGO: "Pago", NOTA: "Nota de crédito" };
        return '<div class="iva-sat__det-cabeza"><button type="button" class="ui-btn ui-btn--terciario ui-btn--32" data-sat-volver>← Volver</button>' +
            "<div><b>Detalle de: " + esc(d.titulo) + "</b><small>" + filas.length + " movimiento(s) · " + m(d.campo === "no_acred" ? -total : total) + "</small></div></div>" +
            '<div class="iva-sat__det"><table class="iva-sat__tabla"><thead><tr><th>Fecha</th><th>Tipo</th><th>' + (d.lado === "emitido" ? "Cliente" : "Proveedor") +
            '</th><th>Folio</th><th class="num">Importe</th></tr></thead><tbody>' +
            filas.map(function (f) {
                return '<tr data-sat-uuid="' + esc(f.uuid) + '"><td>' + dmy(f.fecha) + "</td><td>" + esc(ORIGEN[f.origen] || f.origen) + "</td><td><b>" + esc(f.nombre || f.rfc) +
                    "</b><small>" + esc(f.rfc) + "</small></td><td>" + esc(f.serie_folio || f.uuid.slice(0, 8)) + '</td><td class="num">' + m(f[d.campo]) + "</td></tr>";
            }).join("") + "</tbody></table></div>";
    }
    function eventosSat() {
        $("btn-sat").addEventListener("click", abrirSat);
        $("dlg-sat").addEventListener("click", function (e) {
            if (e.target.closest("[data-sat-cerrar]")) { $("dlg-sat").close(); return; }
            var p = e.target.closest("[data-sat-p]");
            if (p) { SAT.pestana = p.dataset.satP; SAT.detalle = null; pintarSat(); return; }
            if (e.target.closest("[data-sat-volver]")) { SAT.detalle = null; pintarSat(); return; }
            var b = e.target.closest("[data-sat-det]");
            if (b) {
                var x = calculoSat()[SAT.pestana].filter(Boolean)[+b.dataset.satDet];
                SAT.detalle = { titulo: x[0], lado: x[2].lado, campo: x[2].campo }; pintarSat(); return;
            }
            var tr = e.target.closest("[data-sat-uuid]");
            if (tr) {
                var lista = [].map.call($("sat-cuerpo").querySelectorAll("[data-sat-uuid]"), function (r) { return r.dataset.satUuid; });
                Fiscontable.verCfdi(E.rfc, tr.dataset.satUuid, lista);
            }
        });
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
        $("saldo-favor").addEventListener("input", function () { guardarLocal("saldo:" + clavePeriodo(), this.value); if (E.datos) { pintarResumen(); if ($("dlg-sat").open) pintarSat(); } });
        $("btn-excel").addEventListener("click", function () { if (E.datos) exportar(); });
        $("btn-excel-tabla").addEventListener("click", async function () {
            if (!E.datos || this.disabled) return;
            var b = this, t = b.innerHTML;
            verDetalle(true);
            b.disabled = true; b.innerHTML = "<b>⏳</b>Generando…";
            try { await tablaDe(E.lado).exportar(); } catch (e) { avisar(e.message); }
            b.disabled = false; b.innerHTML = t;
        });
        $("btn-xml").addEventListener("click", function () { irA("/herramientas/xml/"); });
        $("btn-conc").addEventListener("click", function () { irA("/herramientas/conciliacion/"); });
        eventosSat();
    }

    document.addEventListener("DOMContentLoaded", iniciar);
})();
