/*
 * periodo-meses.js — Periodo con cuadros de año, meses y fechas exactas (como Mi Admin).
 * El mismo de Administración de XML, para Conciliación y Listas del SAT.
 *
 *   var p = FCPeriodoMeses.crear({ contenedor: el, alCambiar: function () { ... } });
 *   p.conteos({ "2026-08": 120, ... })   cuántos XML hay por mes (se pintan en los cuadros)
 *   p.poner({ anio: "2026", meses: ["08"] }) | p.poner({ desde, hasta }) | p.poner(null)
 *   p.hayEleccion(), p.porFechas(), p.rango() -> {desde, hasta}, p.meses() -> ["2026-08", ...] | null,
 *   p.texto() -> "agosto de 2026", p.dentro("2026-08-10") -> true/false
 *
 * Reglas: "Todo el año" marca los 12 meses; con todos marcados, un clic en un mes quita solo
 * ese; un clic en el año activo lo desmarca. Las fechas exactas mandan sobre año y meses.
 * Sin año o sin meses no hay periodo (la página no carga nada).
 */
(function () {
    "use strict";
    var CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    var LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    var DOCE = CORTO.map(function (_, i) { return String(i + 1).padStart(2, "0"); });
    function dmy(iso) { return iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : ""; }

    function crear(cfg) {
        var raiz = cfg.contenedor;
        var E = { anio: "", meses: new Set(), fechas: { desde: "", hasta: "" }, conteos: {} };
        raiz.classList.add("xml-periodo");
        raiz.setAttribute("aria-label", "Periodo");
        raiz.innerHTML =
            '<div class="xml-periodo__fila"><span class="xml-periodo__etiqueta">Año</span><div class="xml-periodo__chips" data-p="anios"></div></div>' +
            '<div class="xml-periodo__fila"><span class="xml-periodo__etiqueta">Meses</span><div class="xml-periodo__chips" data-p="meses"></div></div>' +
            '<div class="xml-periodo__fila"><span class="xml-periodo__etiqueta">Fechas</span><div class="xml-periodo__chips xml-periodo__fechas">' +
            '<label>Del <input type="date" data-p="desde"></label><label>al <input type="date" data-p="hasta"></label>' +
            '<button type="button" class="xml-enlace" data-p="quitar" hidden>Quitar fechas</button></div></div>';
        function $(n) { return raiz.querySelector('[data-p="' + n + '"]'); }

        function porFechas() { return !!(E.fechas.desde || E.fechas.hasta); }
        function hayEleccion() { return porFechas() || (!!E.anio && E.meses.size > 0); }

        function pintar() {
            raiz.classList.toggle("xml-periodo--fechas", porFechas());
            var porAnio = {};
            Object.keys(E.conteos).forEach(function (p) { porAnio[p.slice(0, 4)] = (porAnio[p.slice(0, 4)] || 0) + E.conteos[p]; });
            if (E.anio && !(E.anio in porAnio)) porAnio[E.anio] = 0;
            var anios = Object.keys(porAnio).sort().reverse();
            $("anios").innerHTML = anios.length ? anios.map(function (a) {
                return '<button type="button" class="xml-mes xml-mes--todo' + (E.anio === a ? " xml-mes--activo" : "") + (porAnio[a] ? "" : " xml-mes--cero") +
                    '" data-anio="' + a + '" aria-pressed="' + (E.anio === a) + '">' + a + "<small>" + porAnio[a].toLocaleString("es-MX") + "</small></button>";
            }).join("") : '<span class="xml-tenue">Todavía no hay XML.</span>';
            if (!E.anio) { $("meses").innerHTML = '<span class="xml-tenue">Elige un año.</span>'; return; }
            var total = DOCE.reduce(function (s, mm) { return s + (E.conteos[E.anio + "-" + mm] || 0); }, 0);
            $("meses").innerHTML = '<button type="button" class="xml-mes xml-mes--todo' + (E.meses.size === 12 ? " xml-mes--activo" : "") +
                '" data-mes="todo" aria-pressed="' + (E.meses.size === 12) + '">Todo el año<small>' + total.toLocaleString("es-MX") + "</small></button>" +
                DOCE.map(function (mm, i) {
                    var n = E.conteos[E.anio + "-" + mm] || 0, on = E.meses.has(mm);
                    return '<button type="button" class="xml-mes' + (on ? " xml-mes--activo" : "") + (n ? "" : " xml-mes--cero") +
                        '" data-mes="' + mm + '" aria-pressed="' + on + '" title="' + LARGO[i] + " " + E.anio + '">' + CORTO[i] + "<small>" + n.toLocaleString("es-MX") + "</small></button>";
                }).join("");
        }

        function limpiarFechas() {
            E.fechas = { desde: "", hasta: "" };
            $("desde").value = ""; $("hasta").value = ""; $("quitar").hidden = true;
        }
        function cambio() { pintar(); if (cfg.alCambiar) cfg.alCambiar(); }

        $("anios").addEventListener("click", function (e) {
            var b = e.target.closest("[data-anio]"); if (!b) return;
            if (E.anio === b.dataset.anio) { E.anio = ""; E.meses = new Set(); }
            else E.anio = b.dataset.anio;
            limpiarFechas(); cambio();
        });
        $("meses").addEventListener("click", function (e) {
            var b = e.target.closest("[data-mes]"); if (!b) return;
            var m = b.dataset.mes;
            if (m === "todo") E.meses = E.meses.size === 12 ? new Set() : new Set(DOCE);
            else if (E.meses.has(m)) E.meses.delete(m);
            else E.meses.add(m);
            limpiarFechas(); cambio();
        });
        ["desde", "hasta"].forEach(function (k) {
            $(k).addEventListener("change", function () {
                E.fechas = { desde: $("desde").value, hasta: $("hasta").value };
                $("quitar").hidden = !porFechas();
                cambio();
            });
        });
        $("quitar").addEventListener("click", function () { limpiarFechas(); cambio(); });

        var api = {
            conteos: function (c) { E.conteos = c || {}; pintar(); },
            poner: function (v) {
                limpiarFechas(); E.anio = ""; E.meses = new Set();
                if (v && (v.desde || v.hasta)) {
                    E.fechas = { desde: v.desde || "", hasta: v.hasta || "" };
                    $("desde").value = E.fechas.desde; $("hasta").value = E.fechas.hasta; $("quitar").hidden = false;
                } else if (v && v.anio) { E.anio = v.anio; E.meses = new Set(v.meses || []); }
                pintar();
            },
            hayEleccion: hayEleccion,
            porFechas: porFechas,
            rango: function () {
                if (porFechas()) return { desde: E.fechas.desde || null, hasta: E.fechas.hasta || null };
                if (!hayEleccion()) return { desde: null, hasta: null };
                var ms = Array.from(E.meses).sort(), ultimo = new Date(+E.anio, +ms[ms.length - 1], 0).getDate();
                return { desde: E.anio + "-" + ms[0] + "-01", hasta: E.anio + "-" + ms[ms.length - 1] + "-" + String(ultimo).padStart(2, "0") };
            },
            meses: function () { return !porFechas() && hayEleccion() ? Array.from(E.meses).sort().map(function (m) { return E.anio + "-" + m; }) : null; },
            /* ¿Los meses elegidos van seguidos? (si no, el servidor necesita la lista) */
            seguidos: function () {
                var ms = Array.from(E.meses).map(Number).sort(function (a, b) { return a - b; });
                return ms.every(function (m, i) { return !i || m === ms[i - 1] + 1; });
            },
            texto: function () {
                if (porFechas()) return "del " + (dmy(E.fechas.desde) || "inicio") + " al " + (dmy(E.fechas.hasta) || "hoy");
                if (!hayEleccion()) return "";
                if (E.meses.size === 12) return "todo " + E.anio;
                var ms = Array.from(E.meses).sort().map(function (m) { return LARGO[+m - 1]; });
                return (ms.length > 1 ? ms.slice(0, -1).join(", ") + " y " + ms[ms.length - 1] : ms[0]) + " de " + E.anio;
            },
            dentro: function (fecha) {
                fecha = (fecha || "").slice(0, 10);
                if (porFechas()) return (!E.fechas.desde || fecha >= E.fechas.desde) && (!E.fechas.hasta || fecha <= E.fechas.hasta);
                return !!E.anio && fecha.slice(0, 4) === E.anio && E.meses.has(fecha.slice(5, 7));
            },
            estado: function () { return { anio: E.anio, meses: Array.from(E.meses).sort(), desde: E.fechas.desde, hasta: E.fechas.hasta }; }
        };
        pintar();
        return api;
    }

    window.FCPeriodoMeses = { crear: crear };
})();
