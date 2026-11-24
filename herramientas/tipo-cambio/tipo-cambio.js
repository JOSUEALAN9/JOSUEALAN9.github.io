/**
 * tipo-cambio.js — Herramienta «Tipo de cambio» (23-nov-2026, el dueño: decisión F del Avance 1).
 * Para cualquier cuenta con sesión: desde y hasta (del 01/01/2017 a hoy), la tabla por día y «Descargar Excel» (hojas
 * «Por día» y «Serie FIX Banxico»). Los datos salen de lo que Fiscontable ya guarda de Banxico (/api/tipo-cambio), con las
 * mismas reglas que Conciliación de pagos. Dirección: /herramientas/tipo-cambio/?desde=AAAA-MM-DD&hasta=AAAA-MM-DD
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var f4 = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    var MINIMO = "2017-01-01";
    var E = { datos: null, n: 0, espera: null };

    function mx(iso) { return iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "—"; }
    function corta(iso) { return iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) : ""; }
    function num(v) { return v === null || v === undefined ? "—" : f4.format(v); }
    function hoyMx() {          // el día de México (la computadora puede estar en otra zona)
        try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date()); }
        catch (e) { return new Date().toISOString().slice(0, 10); }
    }
    function dos(n) { return (n < 10 ? "0" : "") + n; }
    function finDeMes(y, m) { return y + "-" + dos(m) + "-" + dos(new Date(Date.UTC(y, m, 0)).getUTCDate()); }
    function rango(tipo) {
        var h = hoyMx(), y = +h.slice(0, 4), m = +h.slice(5, 7);
        if (tipo === "anterior") { var y2 = m === 1 ? y - 1 : y, m2 = m === 1 ? 12 : m - 1; return [y2 + "-" + dos(m2) + "-01", finDeMes(y2, m2)]; }
        if (tipo === "anio") return [y + "-01-01", h];
        return [y + "-" + dos(m) + "-01", h];
    }
    function marcarRapido() {
        var d = $("tc-desde").value, h = $("tc-hasta").value;
        document.querySelectorAll("[data-rango]").forEach(function (b) {
            var r = rango(b.dataset.rango); b.setAttribute("aria-pressed", String(r[0] === d && r[1] === h));
        });
    }
    function error(t) { $("tc-error").textContent = t || ""; $("tc-error").hidden = !t; }
    function revisar() {
        var d = $("tc-desde").value, h = $("tc-hasta").value, hoy = hoyMx();
        if (!d || !h) return "Elige las dos fechas.";
        if (d < MINIMO) return "El tipo de cambio guardado empieza el 01/01/2017.";
        if (h > hoy) return "«Hasta» puede ser hoy como máximo.";
        if (d > h) return "«Desde» debe ser antes de «Hasta».";
        return "";
    }
    function consulta() { return "desde=" + encodeURIComponent($("tc-desde").value) + "&hasta=" + encodeURIComponent($("tc-hasta").value); }

    async function cargar() {
        marcarRapido();
        var mal = revisar();
        error(mal);
        $("tc-excel").disabled = !!mal;
        if (mal) return;
        try { history.replaceState(null, "", "?" + consulta()); } catch (e) { /* sin historial: no pasa nada */ }
        var n = ++E.n;
        $("tc-caja").classList.add("tc-cargando");
        try {
            var r = await fetch(API + "/api/tipo-cambio?" + consulta(), { credentials: "include" });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            var d = await r.json();
            if (n !== E.n) return;
            E.datos = d;
            pintar();
        } catch (e) {
            if (n === E.n) error(e.message || "No se pudo leer el tipo de cambio.");
        } finally {
            if (n === E.n) $("tc-caja").classList.remove("tc-cargando");
        }
    }

    function pintar() {
        var d = E.datos, hoy = d.hoy || {}, u = d.ultimo_fix;
        $("tc-hoy").textContent = num(hoy.tc);
        $("tc-hoy-sub").textContent = hoy.tc ? "Publicado en el DOF el " + mx(hoy.publicado) + " · FIX del " + mx(hoy.fix_determinado) : "Sin dato guardado para hoy";
        $("tc-ultimo").textContent = u ? num(u.valor) : "—";
        $("tc-ultimo-sub").textContent = u ? "Determinado el " + mx(u.fecha) : "Todavía no hay datos guardados";
        var vals = d.dias.map(function (x) { return x.tc; }).filter(function (v) { return v !== null && v !== undefined; });
        if (vals.length) {
            var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
            $("tc-rango").textContent = num(min) + " – " + num(max);
            $("tc-rango-sub").textContent = "El menor y el mayor que aplicaron del " + mx(d.desde) + " al " + mx(d.hasta);
        } else {
            $("tc-rango").textContent = "—"; $("tc-rango-sub").textContent = "Sin datos en estas fechas";
        }
        var hoyIso = hoyMx();
        $("tc-tbody").innerHTML = d.dias.map(function (x) {
            return '<tr class="' + (x.habil ? "" : "tc-inhabil") + (x.fecha === hoyIso ? " tc-hoy" : "") + '">' +
                "<td>" + esc(mx(x.fecha)) + "</td><td>" + esc(x.dia) + "</td>" +
                '<td class="tc-num tc-aplica">' + esc(num(x.tc)) + "</td>" +
                "<td>" + esc(mx(x.publicado)) + "</td><td>" + esc(mx(x.fix_determinado)) + "</td>" +
                '<td class="tc-num" title="' + esc(x.fix_anterior_fecha ? "Del " + mx(x.fix_anterior_fecha) : "") + '">' + esc(num(x.fix_anterior)) + "</td>" +
                '<td class="tc-num" title="' + esc(x.fix_mismo_fecha ? "Del " + mx(x.fix_mismo_fecha) : "") + '">' + esc(num(x.fix_mismo)) +
                (x.fix_mismo_fecha && x.fix_mismo_fecha !== x.fecha ? ' <small class="tc-de">(' + esc(corta(x.fix_mismo_fecha)) + ")</small>" : "") + "</td></tr>";
        }).join("");
        $("tc-vacio").hidden = !d.sin_datos;
        $("tc-excel").disabled = false;
    }

    async function descargar() {
        var b = $("tc-excel");
        if (b.disabled) return;
        var mal = revisar();
        if (mal) { error(mal); return; }
        b.disabled = true; b.classList.add("ui-btn--cargando");
        try {
            var r = await fetch(API + "/api/tipo-cambio/excel?" + consulta(), { credentials: "include" });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            var m = /filename="?([^";]+)"?/i.exec(r.headers.get("Content-Disposition") || "");
            Fiscontable.guardarArchivo(await r.blob(), m ? m[1] : "Tipo-de-cambio_USD.xlsx");
        } catch (e) { error(e.message || "No se pudo armar el Excel."); }
        b.disabled = false; b.classList.remove("ui-btn--cargando");
    }

    /* 24-nov-2026 (revisión): sin fechas en la dirección, el periodo activo de la barra (el mes en que se está trabajando,
       el que llevan los accesos «Con este periodo» de Conciliación y Administración de XML); si no hay, este mes. Al cambiar
       el periodo de la barra, la tabla lo sigue. */
    function delPeriodo(p) {
        if (!/^\d{4}-\d{2}$/.test(p || "")) return null;
        var d = p + "-01", h = finDeMes(+p.slice(0, 4), +p.slice(5, 7)), hoy = hoyMx();
        if (d < MINIMO || d > hoy) return null;
        return [d, h > hoy ? hoy : h];
    }
    function ponerRango(r) { $("tc-desde").value = r[0]; $("tc-hasta").value = r[1]; }

    document.addEventListener("DOMContentLoaded", async function () {
        // Como todas las páginas: sesión vencida, invitación pendiente o despacho suspendido, con el letrero de siempre
        if (!(await Fiscontable.exigirModulo())) return;
        var hoy = hoyMx(), q = new URLSearchParams(location.search), r = rango("mes");
        ["tc-desde", "tc-hasta"].forEach(function (id) { $(id).min = MINIMO; $(id).max = hoy; });
        var enDireccion = /^\d{4}-\d{2}-\d{2}$/.test(q.get("desde") || "") && /^\d{4}-\d{2}-\d{2}$/.test(q.get("hasta") || "");
        if (!enDireccion) {
            try { r = delPeriodo(await Fiscontable.periodoActivo()) || r; } catch (e) { /* sin periodo: este mes */ }
        }
        ponerRango(enDireccion ? [q.get("desde"), q.get("hasta")] : r);
        window.addEventListener("fiscontable:periodo", function (ev) {
            var x = delPeriodo(ev.detail); if (x) { ponerRango(x); cargar(); }
        });
        ["tc-desde", "tc-hasta"].forEach(function (id) {
            $(id).addEventListener("change", function () { clearTimeout(E.espera); E.espera = setTimeout(cargar, 250); });
        });
        document.querySelector(".tc-rapidos").addEventListener("click", function (e) {
            var b = e.target.closest("[data-rango]"); if (!b) return;
            var x = rango(b.dataset.rango); $("tc-desde").value = x[0]; $("tc-hasta").value = x[1]; cargar();
        });
        $("tc-excel").addEventListener("click", descargar);
        cargar();
    });
})();
