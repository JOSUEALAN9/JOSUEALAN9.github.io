/**
 * visores.js — Visor de impuestos: facturado contra cobrado (o pagado), mes por mes, de la empresa activa.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var E = { lado: "ingresos", datos: null, tabla: null, empresa: null };
    var dinero = function (v) { return "$" + Number(v || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var corto = function (v) {
        var n = Math.abs(v || 0), s = v < 0 ? "-" : "";
        return n >= 1e6 ? s + "$" + (n / 1e6).toFixed(1) + " M" : n >= 1e3 ? s + "$" + Math.round(n / 1e3) + " mil" : s + "$" + Math.round(n);
    };
    // Lo que cambia entre Ingresos y Gastos: qué campos se muestran y con qué nombre
    var LADO = {
        ingresos: { fact: "facturado", factIva: "facturado_iva", flujo: "cobrado", flujoIva: "cobrado_iva", n: "n_facturas",
                    tFact: "Facturado", tFlujo: "Cobrado", pend: "por_cobrar", tPend: "Por cobrar (PPD sin pago)", tN: "facturas emitidas" },
        egresos:  { fact: "recibido", factIva: "recibido_iva", flujo: "pagado", flujoIva: "pagado_iva", n: "n_recibidas",
                    tFact: "Gastos facturados", tFlujo: "Pagado", pend: "por_pagar", tPend: "Por pagar (PPD sin pago)", tN: "facturas recibidas" }
    };

    async function api(ruta) {
        var r = await fetch(API + ruta, { credentials: "include" });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }

    function cifra(titulo, valor, nota, clase, barra) {
        return '<div class="vi-cifra' + (clase ? " " + clase : "") + '"><small>' + esc(titulo) + "</small><b>" + esc(valor) + "</b><span>" + esc(nota || "") + "</span>" +
            (barra != null ? '<div class="vi-barra"><i style="width:' + Math.max(0, Math.min(100, barra)) + '%"></i></div>' : "") + "</div>";
    }

    function pintarTarjetas() {
        var d = E.datos, L = LADO[E.lado], t = d.totales, pend = d[L.pend];
        var pct = t[L.fact] ? Math.round(100 * t[L.flujo] / t[L.fact]) : 0;
        var iva = t.iva_resultado;
        $("vi-tarjetas").innerHTML =
            cifra(L.tFact + " en " + d.anio, dinero(t[L.fact]), t[L.n] + " " + L.tN + " · IVA " + dinero(t[L.factIva])) +
            cifra(L.tFlujo + " en " + d.anio, dinero(t[L.flujo]), pct + " % de lo facturado · IVA " + dinero(t[L.flujoIva]), "", pct) +
            cifra(L.tPend, dinero(pend.total), pend.n + " factura" + (pend.n === 1 ? "" : "s") + " PPD sin complemento (total con IVA)", "vi-cifra--gasto") +
            cifra("IVA del año (flujo)", (iva < 0 ? "-" : "") + dinero(Math.abs(iva)), iva >= 0 ? "a cargo: cobrado − retenido − acreditable" : "a favor: cobrado − retenido − acreditable", "vi-cifra--gasto");
    }

    function pintarGrafica() {
        var L = LADO[E.lado], meses = E.datos.meses;
        var max = Math.max.apply(null, meses.map(function (m) { return Math.max(m[L.fact], m[L.flujo], 0); }).concat([1]));
        $("vi-grafica").innerHTML = '<div class="vi-grafica__titulo"><b>Mes por mes</b>' +
            '<span class="vi-ley"><i class="c-fact"></i>' + esc(L.tFact) + '</span><span class="vi-ley"><i class="c-cobr"></i>' + esc(L.tFlujo) + "</span>" +
            '<span style="margin-left:auto">Clic en un mes para abrir su IVA</span></div>' +
            '<div class="vi-cols">' + meses.map(function (m) {
                var h = function (v) { return Math.max(0, Math.round(100 * v / max)); };
                return '<div class="vi-col" data-mes="' + m.mes + '" title="' + esc(m.nombre + ": " + L.tFact.toLowerCase() + " " + dinero(m[L.fact]) + " · " + L.tFlujo.toLowerCase() + " " + dinero(m[L.flujo])) + '">' +
                    '<i class="c-fact" style="height:' + h(m[L.fact]) + '%"></i><i class="c-cobr" style="height:' + h(m[L.flujo]) + '%"></i></div>';
            }).join("") + "</div>" +
            '<div class="vi-meses">' + meses.map(function (m) { return "<span>" + esc(m.nombre.slice(0, 3)) + "</span>"; }).join("") + "</div>";
    }

    function filas() {
        var L = LADO[E.lado];
        return E.datos.meses.map(function (m) {
            return { mes: m.mes, nombre: m.nombre.charAt(0).toUpperCase() + m.nombre.slice(1), n: m[L.n],
                     fact: m[L.fact], fact_iva: m[L.factIva], flujo: m[L.flujo], flujo_iva: m[L.flujoIva],
                     dif: Math.round((m[L.fact] - m[L.flujo]) * 100) / 100,
                     retenido: m.retenido_por_clientes, acreditable: m.iva_acreditable, resultado: m.iva_resultado };
        });
    }
    function pintarTabla() {
        var L = LADO[E.lado];
        if (E.tabla) { E.tabla.ponerDatos(filas()); return; }
        E.tabla = FCTabla.estandar({
            contenedor: $("vi-tabla"), id: "visores", claveFila: "mes",
            catalogo: [
                { clave: "nombre", etiqueta: "Mes", tipo: "texto" },
                { clave: "n", etiqueta: "Facturas", tipo: "numero" },
                { clave: "fact", etiqueta: "Facturado (sin IVA)", tipo: "moneda" },
                { clave: "fact_iva", etiqueta: "IVA facturado", tipo: "moneda" },
                { clave: "flujo", etiqueta: "Cobrado / pagado (sin IVA)", tipo: "moneda" },
                { clave: "flujo_iva", etiqueta: "IVA cobrado / pagado", tipo: "moneda" },
                { clave: "dif", etiqueta: "Facturado − flujo", tipo: "moneda" },
                { clave: "retenido", etiqueta: "IVA retenido por clientes", tipo: "moneda" },
                { clave: "acreditable", etiqueta: "IVA acreditable", tipo: "moneda" },
                { clave: "resultado", etiqueta: "IVA del mes", tipo: "moneda" }
            ],
            predeterminadas: ["nombre", "n", "fact", "fact_iva", "flujo", "flujo_iva", "dif", "resultado"],
            exportar: { nombre: "Visor_de_impuestos.xlsx", hoja: "Por mes" },
            vacio: { titulo: "Sin datos", texto: "No hay XML de este año en la biblioteca." },
            alClic: function (r) { abrirIva(r.mes); }
        });
        E.tabla.ponerDatos(filas());
    }
    function abrirIva(mes) { location.href = "/herramientas/iva/?anio=" + mes.slice(0, 4) + "&meses=" + parseInt(mes.slice(5, 7), 10); }

    function pintar() {
        if (!E.datos) return;
        pintarTarjetas(); pintarGrafica(); pintarTabla();
    }

    async function cargar() {
        E.empresa = await Fiscontable.empresaActiva().catch(function () { return null; });
        if (!E.empresa) {
            $("vi-cuerpo").hidden = true; $("vi-sin").hidden = false;
            $("vi-sin").innerHTML = '<p class="ctx-vacio__titulo">Elige una empresa arriba, en el selector de empresa.</p>';
            return;
        }
        $("vi-sin").hidden = true; $("vi-cuerpo").hidden = false;
        $("vi-tarjetas").innerHTML = '<div class="vi-cifra"><span class="ui-skel" style="width:60%"></span><span class="ui-skel" style="width:80%;height:22px"></span></div>'.repeat(4);
        if (E.tabla) E.tabla.cargando();
        try {
            E.datos = await api("/api/visores/anio?rfc=" + encodeURIComponent(E.empresa.rfc) + "&anio=" + $("vi-anio").value);
            pintar();
        } catch (e) {
            $("vi-tarjetas").innerHTML = '<div class="ui-falla" style="grid-column:1/-1">' + Fiscontable.icono("alerta") + "<b>No se pudo cargar</b><span>" + esc(e.message) + "</span></div>";
            $("vi-grafica").innerHTML = "";
        }
    }

    async function arrancar() {
        if (!(await Fiscontable.exigirModulo("iva"))) return;
        var hoy = new Date(), a0 = Number(Fiscontable.url("anio")) || hoy.getFullYear();
        var anios = []; for (var a = hoy.getFullYear(); a >= hoy.getFullYear() - 5; a--) anios.push(a);
        $("vi-anio").innerHTML = anios.map(function (a) { return '<option value="' + a + '"' + (a === a0 ? " selected" : "") + ">" + a + "</option>"; }).join("");
        $("vi-anio").addEventListener("change", function () { Fiscontable.url({ anio: this.value }); cargar(); });
        $("vi-lado").addEventListener("click", function (e) {
            var b = e.target.closest("[data-lado]"); if (!b) return;
            E.lado = b.dataset.lado;
            this.querySelectorAll("[data-lado]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
            pintar();
        });
        $("vi-grafica").addEventListener("click", function (e) { var c = e.target.closest("[data-mes]"); if (c) abrirIva(c.dataset.mes); });
        window.addEventListener("fiscontable:empresa", cargar);
        cargar();
    }
    arrancar();
})();
