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

    var E = { empresa: null, periodoGeneral: null, empresas: [], rfc: null, P: null, datos: null,
              lado: "emitido", origen: "", busqueda: "", perfil: null };

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
        E.P = FCPeriodoMeses.crear({ contenedor: $("periodo-iva"), alCambiar: cargar, alAvisar: avisar });
        eventos();
        E.perfil = await Fiscontable.perfil();
        $("btn-conc").hidden = !(E.perfil && (E.perfil.modulos_permitidos || []).indexOf("conciliacion") !== -1);
        $("btn-xml").hidden = !(E.perfil && (E.perfil.modulos_permitidos || []).indexOf("validador") !== -1);
        E.empresa = await Fiscontable.empresaActiva();
        E.periodoGeneral = await Fiscontable.periodoActivo();
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
        E.P.poner(E.periodoGeneral ? { anio: E.periodoGeneral.slice(0, 4), meses: [E.periodoGeneral.slice(5, 7)] } : null);
        cargar();
    }

    function pintarMenu() {
        $("menu-empresa").innerHTML = '<div class="xml-otra__grupo">Empresas con XML</div>' +
            (E.empresas.length ? E.empresas.map(function (c) {
                return '<button type="button" data-rfc="' + esc(c.rfc) + '"' + (c.rfc === E.rfc ? ' class="xml-activa"' : "") + ">" +
                    esc(c.nombre || c.rfc) + " <span>" + esc(c.rfc) + "</span></button>";
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
        $("conteo").textContent = "Calculando…";
        try {
            var datos = await apiJSON("/api/iva/papel?" + pedido);
            if (E.rfc !== datos.rfc) return;
            E.datos = datos; E.pedido = pedido;
        } catch (e) { $("conteo").textContent = e.message; return; }
        $("saldo-favor").value = leerLocal("saldo:" + clavePeriodo()) || "";
        pintarResumen();
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
            filaRes("Notas de crédito", m(tr.iva_nota)) + filaRes("IVA acreditable", m(tr.iva), "iva-total") +
            filaRes("Retuviste (a enterar)", m(tr.ret));
        var saldo = parseFloat($("saldo-favor").value) || 0;
        var final = Math.round((s.resultado_antes_saldo - saldo) * 100) / 100;
        $("res-resultado").innerHTML =
            filaRes("Cobrado − retenido", m(te.iva - te.ret)) + filaRes("− Acreditable", m(-tr.iva)) +
            (saldo ? filaRes("− Saldo a favor anterior", m(-saldo)) : "") +
            filaRes(final >= 0 ? "IVA a cargo" : "IVA a favor", m(Math.abs(final)), "iva-total " + (final >= 0 ? "iva-cargo" : "iva-favor"));
    }

    var COLS = [
        ["fecha", "Fecha", 92], ["origen", "Origen", 120], ["serie_folio", "Serie-Folio", 110], ["rfc", "RFC", 130], ["nombre", "Nombre", 230],
        ["b16", "Base 16 %", 112, 1], ["i16", "IVA 16 %", 100, 1], ["b8", "Base 8 %", 100, 1], ["i8", "IVA 8 %", 90, 1],
        ["b0", "Base 0 %", 100, 1], ["bex", "Exentos", 100, 1], ["ret", "IVA retenido", 104, 1], ["avisos", "Avisos", 260]
    ];

    function pintar() {
        var d = E.datos, lado = d[E.lado === "ppd" ? "emitido" : E.lado];
        var avisos = d.emitido.avisos.length + d.recibido.avisos.length;
        var ppd = d.emitido.ppd_sin_pago.length + d.recibido.ppd_sin_pago.length;
        var pest = [["emitido", "Emitidos (cobrado)", d.emitido.filas.length], ["recibido", "Recibidos (pagado)", d.recibido.filas.length]];
        if (ppd) pest.push(["ppd", "PPD sin pago", ppd]);
        if (E.lado === "ppd" && !ppd) E.lado = "emitido";
        $("pestanas").innerHTML = pest.map(function (p) {
            return '<button type="button" class="pestana' + (E.lado === p[0] ? " pestana--activa" : "") + '" data-lado="' + p[0] + '">' + p[1] +
                '<span class="xml-cuenta' + (p[0] === "ppd" ? " iva-cuenta--aviso" : "") + '">' + p[2] + "</span></button>";
        }).join("");
        var q = E.busqueda.trim().toLowerCase();
        if (E.lado === "ppd") { pintarPpd(q); return; }
        $("origenes").innerHTML = [["", "Todos"], ["PUE", "Facturas PUE"], ["PAGO", "Pagos"], ["NOTA", "Notas de crédito"]].map(function (o) {
            var n = o[0] ? lado.filas.filter(function (f) { return f.origen === o[0]; }).length : lado.filas.length;
            return '<button type="button" class="xml-chip' + (E.origen === o[0] ? " xml-chip--activo" : "") + '" data-origen="' + o[0] + '">' + o[1] + "<span>" + n + "</span></button>";
        }).join("") + (avisos ? '<span class="xml-tenue" style="margin-left:6px">⚠ ' + avisos + " aviso(s)</span>" : "");
        var filas = lado.filas.filter(function (f) {
            if (E.origen && f.origen !== E.origen) return false;
            return !q || [f.rfc, f.nombre, f.serie_folio, f.uuid, f.uuid_factura].join(" ").toLowerCase().indexOf(q) !== -1;
        });
        $("thead").innerHTML = "<tr>" + COLS.map(function (c) {
            return "<th" + (c[3] ? ' class="xml-num"' : "") + ' style="width:' + c[2] + "px;min-width:" + c[2] + 'px">' + c[1] + "</th>";
        }).join("") + "</tr>";
        $("tbody").innerHTML = filas.slice(0, 2000).map(function (f) {
            return '<tr data-uuid="' + esc(f.uuid) + '" title="' + esc(f.uuid + (f.uuid_factura ? " · paga " + f.uuid_factura : "")) + '">' + COLS.map(function (c) {
                var v = f[c[0]];
                if (c[0] === "fecha") v = dmy(v);
                else if (c[0] === "origen") v = ORIGEN[v] || v;
                else if (c[0] === "avisos") return '<td class="iva-aviso" title="' + esc(v.join(" · ")) + '">' + esc(v.join(" · ")) + "</td>";
                else if (c[3]) return '<td class="xml-num' + (v < 0 ? " iva-neg" : "") + '">' + (v ? m(v) : "") + "</td>";
                return "<td>" + esc(v || "") + "</td>";
            }).join("") + "</tr>";
        }).join("");
        var suma = {};
        COLS.forEach(function (c) { if (c[3]) suma[c[0]] = filas.reduce(function (s, f) { return s + (f[c[0]] || 0); }, 0); });
        $("tfoot").innerHTML = filas.length ? "<tr>" + COLS.map(function (c, i) {
            return i === 0 ? "<td>Total (" + filas.length + ")</td>" : c[3] ? '<td class="xml-num">' + m(suma[c[0]]) + "</td>" : "<td></td>";
        }).join("") + "</tr>" : "";
        $("sin-filas").hidden = filas.length > 0;
        $("sin-filas").textContent = lado.filas.length ? "Nada coincide con los filtros." : "Sin movimientos de IVA en " + E.P.texto() + ".";
        $("conteo").textContent = filas.length + " movimiento(s)";
    }

    function pintarPpd(q) {
        $("origenes").innerHTML = '<span class="xml-tenue">Facturas PPD del periodo que todavía no tienen complemento de pago: su IVA no cuenta hasta que se paguen.</span>';
        var filas = [];
        ["emitido", "recibido"].forEach(function (rol) {
            E.datos[rol].ppd_sin_pago.forEach(function (x) { filas.push(Object.assign({ rol: rol }, x)); });
        });
        filas = filas.filter(function (f) { return !q || [f.rfc, f.nombre, f.uuid].join(" ").toLowerCase().indexOf(q) !== -1; });
        $("thead").innerHTML = '<tr><th style="width:92px">Fecha</th><th style="width:100px">Lado</th><th style="width:300px">UUID</th><th style="width:130px">RFC</th><th style="width:260px">Nombre</th><th class="xml-num" style="width:120px">Total</th><th style="width:70px">Moneda</th></tr>';
        $("tbody").innerHTML = filas.map(function (f) {
            return '<tr data-uuid="' + esc(f.uuid) + '"><td>' + dmy(f.fecha) + "</td><td>" + (f.rol === "emitido" ? "Emitida" : "Recibida") + "</td><td>" + esc(f.uuid) +
                "</td><td>" + esc(f.rfc || "") + "</td><td>" + esc(f.nombre || "") + '</td><td class="xml-num">' + m(f.total) + "</td><td>" + esc(f.moneda || "") + "</td></tr>";
        }).join("");
        $("tfoot").innerHTML = "";
        $("sin-filas").hidden = filas.length > 0;
        $("sin-filas").textContent = "Nada coincide con la búsqueda.";
        $("conteo").textContent = filas.length + " factura(s) PPD sin pago";
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
            var blob = await resp.blob(), url = URL.createObjectURL(blob), a = document.createElement("a");
            var mt = /filename="?([^";]+)"?/.exec(resp.headers.get("Content-Disposition") || "");
            a.href = url; a.download = mt ? mt[1] : E.rfc + "_Papel_IVA.xlsx"; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        } catch (e) { avisar(e.message); }
        b.disabled = false; b.innerHTML = t;
    }

    function irA(ruta) {
        var est = E.P.estado(), q = new URLSearchParams({ rfc: E.rfc });
        if (E.P.porFechas()) { if (est.desde) q.set("desde", est.desde); if (est.hasta) q.set("hasta", est.hasta); }
        else if (est.anio) { q.set("anio", est.anio); q.set("meses", est.meses.join(",")); }
        window.open(ruta + "?" + q.toString(), "_blank", "noopener");
    }

    function eventos() {
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
        $("pestanas").addEventListener("click", function (e) { var b = e.target.closest("[data-lado]"); if (b) { E.lado = b.dataset.lado; E.origen = ""; pintar(); } });
        $("origenes").addEventListener("click", function (e) { var b = e.target.closest("[data-origen]"); if (b) { E.origen = b.dataset.origen; pintar(); } });
        var reloj = null;
        $("buscar").addEventListener("input", function () { clearTimeout(reloj); var v = this.value; reloj = setTimeout(function () { E.busqueda = v; if (E.datos) pintar(); }, 150); });
        $("saldo-favor").addEventListener("input", function () { guardarLocal("saldo:" + clavePeriodo(), this.value); if (E.datos) pintarResumen(); });
        $("btn-excel").addEventListener("click", function () { if (E.datos) exportar(); });
        $("btn-xml").addEventListener("click", function () { irA("/herramientas/xml/"); });
        $("btn-conc").addEventListener("click", function () { irA("/herramientas/conciliacion/"); });
        $("tbody").addEventListener("click", function (e) {
            var tr = e.target.closest("tr[data-uuid]"); if (!tr || !E.perfil || (E.perfil.modulos_permitidos || []).indexOf("validador") === -1) return;
            window.open("/herramientas/xml/detalle/?rfc=" + encodeURIComponent(E.rfc) + "&uuid=" + encodeURIComponent(tr.dataset.uuid), "_blank", "noopener");
        });
    }

    document.addEventListener("DOMContentLoaded", iniciar);
})();
