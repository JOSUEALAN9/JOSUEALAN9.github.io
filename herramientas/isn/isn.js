/*
 * herramientas/isn/isn.js — ISN: calcular, capturar, cargar Excel y leer acuses.
 *
 * Empresa: la activa de la barra o cualquiera con periodos de ISN. Por año, una
 * fila por mes y tipo. Presentar con el robot de Tributanet: siguiente entrega.
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    var E = { empresa: null, empresas: [], rfc: null, anio: new Date().getFullYear(), datos: null, editando: null, periodoGeneral: null };

    async function api(ruta, opciones) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r;
    }
    function json(ruta, metodo, cuerpo) {
        return api(ruta, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }).then(function (r) { return r.json(); });
    }
    function m(v) { return v == null ? "" : Number(v).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function aviso(texto, error) { var a = $("aviso"); a.textContent = texto || ""; a.className = "isn-aviso" + (error ? " isn-aviso--error" : ""); a.hidden = !texto; }
    async function bajar(resp, porDefecto) {
        var blob = await resp.blob(), url = URL.createObjectURL(blob), a = document.createElement("a");
        var mt = /filename="?([^";]+)"?/.exec(resp.headers.get("Content-Disposition") || "");
        a.href = url; a.download = mt ? mt[1] : porDefecto; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }

    /* ------------------------------------------------------------ empresa y año */
    async function iniciar() {
        if (!(await Fiscontable.exigirModulo("isn"))) return;
        eventos();
        $("f-mes").innerHTML = MESES.map(function (n, i) { return '<option value="' + (i + 1) + '">' + n + "</option>"; }).join("");
        E.empresa = await Fiscontable.empresaActiva();
        E.periodoGeneral = await Fiscontable.periodoActivo();
        if (E.periodoGeneral) E.anio = +E.periodoGeneral.slice(0, 4);
        await cargarEmpresas();
        abrir(E.empresa ? E.empresa.rfc : (E.empresas[0] && E.empresas[0].rfc));
        window.addEventListener("fiscontable:empresa", function (e) { E.empresa = e.detail; if (e.detail) abrir(e.detail.rfc); });
    }

    async function cargarEmpresas() {
        try { E.empresas = await (await api("/api/isn/empresas")).json(); } catch (e) { E.empresas = []; }
    }

    function nombreDe(rfc) {
        var c = E.empresas.find(function (x) { return x.rfc === rfc; });
        if (E.empresa && E.empresa.rfc === rfc) return E.empresa.alias || rfc;
        return (c && c.nombre) || rfc;
    }

    function abrir(rfc) {
        E.rfc = rfc || null;
        $("empresa-etiqueta").textContent = E.rfc ? "Empresa · " + E.rfc : "Empresa";
        $("empresa-titulo").textContent = E.rfc ? nombreDe(E.rfc) : "Elegir empresa";
        cargar();
    }

    function pintarMenu() {
        var lista = E.empresas.slice();
        if (E.empresa && !lista.some(function (c) { return c.rfc === E.empresa.rfc; })) lista.unshift({ rfc: E.empresa.rfc, nombre: E.empresa.alias, periodos: 0 });
        $("menu-empresa").innerHTML = '<div class="xml-otra__grupo">Empresas</div>' + (lista.length ? lista.map(function (c) {
            return '<button type="button" data-rfc="' + esc(c.rfc) + '"' + (c.rfc === E.rfc ? ' class="xml-activa"' : "") + ">" + esc(c.nombre || c.rfc) +
                " <span>" + esc(c.rfc) + " · " + (c.periodos || 0) + " periodo(s)</span></button>";
        }).join("") : '<p class="xml-otra__nota">Todavía no hay periodos. Captura uno o carga el Excel.</p>');
    }

    /* ------------------------------------------------------------ tabla */
    async function cargar() {
        if (!E.rfc) { E.datos = { periodos: [], anios: [], tasa_sugerida: {} }; pintar(); return; }
        try {
            E.datos = await (await api("/api/isn/periodos?rfc=" + encodeURIComponent(E.rfc) + "&anio=" + E.anio)).json();
        } catch (e) { aviso(e.message, true); return; }
        pintar();
    }

    function pintarAnios() {
        var anios = new Set((E.datos.anios || []).concat([E.anio, new Date().getFullYear()]));
        $("sel-anio").innerHTML = Array.from(anios).sort().reverse().map(function (a) {
            return '<option value="' + a + '"' + (+a === +E.anio ? " selected" : "") + ">" + a + "</option>";
        }).join("");
    }

    var COLS = [["mes_nombre", "Mes", 96], ["tipo", "Tipo", 110], ["estado", "Estado", 64], ["municipio", "Municipio", 140],
                ["trab", "Trabajadores", 100, 1], ["base", "Base", 120, 1], ["tasa", "Tasa", 64, 1], ["impuesto", "Impuesto a cargo", 130, 1],
                ["presentada", "Estatus", 120], ["acuse_importe", "Pagado (acuse)", 120, 1], ["diferencia", "Diferencia", 100, 1],
                ["folio", "Folio", 110], ["fecha_presentacion", "Presentada el", 110], ["acuse", "Acuse", 70], ["avisos", "Avisos", 260]];

    function pintar() {
        pintarAnios();
        var filas = E.datos.periodos;
        var porPresentar = filas.filter(function (f) { return !f.presentada; });
        var suma = function (k, l) { return l.reduce(function (s, f) { return s + (f[k] || 0); }, 0); };
        $("resumen").innerHTML = E.rfc && filas.length
            ? '<div class="ctx-resumen__dato"><small>Impuesto del año</small><b>$' + m(suma("impuesto", filas)) + "</b></div>" +
              '<div class="ctx-resumen__dato"><small>Pagado según acuses</small><b>$' + m(suma("acuse_importe", filas)) + "</b></div>" +
              '<div class="ctx-resumen__dato' + (porPresentar.length ? " ctx-resumen__dato--alerta" : "") + '"><small>Por presentar</small><b>' + porPresentar.length +
              "</b><span>$" + m(suma("impuesto", porPresentar)) + "</span></div>"
            : "";
        $("thead").innerHTML = "<tr>" + COLS.map(function (c) {
            return "<th" + (c[3] ? ' class="xml-num"' : "") + ' style="width:' + c[2] + "px;min-width:" + c[2] + 'px">' + c[1] + "</th>";
        }).join("") + "</tr>";
        $("tbody").innerHTML = filas.map(function (f) {
            return '<tr data-id="' + f.id + '">' + COLS.map(function (c) {
                switch (c[0]) {
                    case "trab": return '<td class="xml-num">' + ((f.trabajadores_sm || 0) + (f.trabajadores_otro || 0)) + "</td>";
                    case "tasa": return '<td class="xml-num">' + (f.tasa != null ? (f.tasa * 100).toLocaleString("es-MX", { maximumFractionDigits: 2 }) + " %" : "") + "</td>";
                    case "presentada": return "<td>" + (f.presentada ? '<span class="xml-sello xml-sello--verde">Presentada</span>' : '<span class="xml-sello xml-sello--ambar">Por presentar</span>') + "</td>";
                    case "diferencia": return '<td class="xml-num' + (f.diferencia ? " isn-dif" : "") + '">' + (f.diferencia ? m(f.diferencia) : "") + "</td>";
                    case "acuse": return "<td>" + (f.tiene_acuse ? '<a class="xml-enlace" data-acuse="' + f.id + '" href="' + API + "/api/isn/acuse/" + f.id + '">PDF</a>' : "") + "</td>";
                    case "avisos": return '<td title="' + esc(f.avisos.join(" · ")) + '" style="color:#b45309">' + esc(f.avisos.join(" · ")) + "</td>";
                    default: return "<td" + (c[3] ? ' class="xml-num"' : "") + ">" + (c[3] ? m(f[c[0]]) : esc(f[c[0]] == null ? "" : f[c[0]])) + "</td>";
                }
            }).join("") + "</tr>";
        }).join("");
        $("sin-filas").hidden = filas.length > 0;
        $("sin-filas").textContent = !E.rfc ? "Elige una empresa, captura un periodo o carga el Excel." : "Sin periodos de " + E.anio + ". Captura uno, carga el Excel o lee los acuses.";
    }

    /* ------------------------------------------------------------ captura */
    function abrirForm(f) {
        E.editando = f || null;
        $("form-titulo").textContent = f ? "Periodo " + f.mes_nombre + " " + f.anio + " · " + f.tipo : "Nuevo periodo";
        $("f-rfc").value = f ? f.rfc : (E.rfc || "");
        $("f-rfc").readOnly = !!f;
        $("f-estado").value = f ? f.estado : "QROO";
        $("f-municipio").value = f ? (f.municipio || "") : ((E.datos.periodos[0] || {}).municipio || "");
        $("f-anio").value = f ? f.anio : E.anio;
        $("f-mes").value = f ? f.mes : (E.periodoGeneral && +E.periodoGeneral.slice(0, 4) === +E.anio ? +E.periodoGeneral.slice(5, 7) : new Date().getMonth() + 1);
        $("f-tipo").value = f ? f.tipo : "Normal";
        $("f-tsm").value = f ? f.trabajadores_sm : 0;
        $("f-rsm").value = f ? f.remuneraciones_sm : 0;
        $("f-tot").value = f ? f.trabajadores_otro : 0;
        $("f-rot").value = f ? f.remuneraciones_otro : 0;
        var sugerida = (E.datos.tasa_sugerida || {})[$("f-estado").value];
        $("f-tasa").value = f && f.tasa != null ? +(f.tasa * 100).toFixed(4) : (sugerida != null ? +(sugerida * 100).toFixed(4) : "");
        $("f-notas").value = f ? (f.notas || "") : "";
        $("form-borrar").hidden = !f;
        $("form-error").hidden = true;
        $("modal").hidden = false;
        recalcular();
        (f ? $("f-tsm") : $("f-rfc")).focus();
    }

    function recalcular() {
        var base = (+$("f-rsm").value || 0) + (+$("f-rot").value || 0), tasa = +$("f-tasa").value;
        $("c-base").textContent = m(base);
        $("c-trab").textContent = (+$("f-tsm").value || 0) + (+$("f-tot").value || 0);
        $("c-imp").textContent = tasa ? "$" + Math.round(base * tasa / 100).toLocaleString("es-MX") : "Lo calcula el portal";
    }

    async function guardar(e) {
        e.preventDefault();
        var cuerpo = {
            rfc: $("f-rfc").value.trim().toUpperCase(), estado: $("f-estado").value, municipio: $("f-municipio").value.trim(),
            anio: +$("f-anio").value, mes: +$("f-mes").value, tipo: $("f-tipo").value,
            trabajadores_sm: +$("f-tsm").value || 0, remuneraciones_sm: +$("f-rsm").value || 0,
            trabajadores_otro: +$("f-tot").value || 0, remuneraciones_otro: +$("f-rot").value || 0,
            tasa: $("f-tasa").value === "" ? null : +$("f-tasa").value, notas: $("f-notas").value.trim() || null,
            nombre: nombreDe($("f-rfc").value.trim().toUpperCase())
        };
        try {
            var f = await json("/api/isn/periodo", "PUT", cuerpo);
            $("modal").hidden = true;
            aviso("Guardado: " + f.mes_nombre + " " + f.anio + (f.impuesto != null ? " · impuesto a cargo $" + m(f.impuesto) : "") + ".");
            E.anio = f.anio;
            await cargarEmpresas();
            abrir(f.rfc);
        } catch (err) { $("form-error").textContent = err.message; $("form-error").hidden = false; }
    }

    /* ------------------------------------------------------------ eventos */
    function eventos() {
        $("btn-empresa").addEventListener("click", function (e) { e.stopPropagation(); var mn = $("menu-empresa"); if (mn.hidden) pintarMenu(); mn.hidden = !mn.hidden; });
        $("menu-empresa").addEventListener("click", function (e) {
            e.stopPropagation(); var b = e.target.closest("[data-rfc]"); if (!b) return;
            $("menu-empresa").hidden = true; abrir(b.dataset.rfc);
        });
        document.addEventListener("click", function () { $("menu-empresa").hidden = true; });
        $("sel-anio").addEventListener("change", function () { E.anio = +this.value; cargar(); });
        $("btn-nuevo").addEventListener("click", function () { abrirForm(null); });
        $("tbody").addEventListener("click", function (e) {
            if (e.target.closest("[data-acuse]")) return;
            var tr = e.target.closest("tr[data-id]"); if (!tr) return;
            abrirForm(E.datos.periodos.find(function (f) { return f.id === +tr.dataset.id; }));
        });
        ["f-tsm", "f-rsm", "f-tot", "f-rot", "f-tasa"].forEach(function (id) { $(id).addEventListener("input", recalcular); });
        $("f-estado").addEventListener("change", function () {
            if (E.editando) return;
            var s = (E.datos.tasa_sugerida || {})[this.value];
            if (s != null) { $("f-tasa").value = +(s * 100).toFixed(4); recalcular(); }
        });
        $("form").addEventListener("submit", guardar);
        $("form-cancelar").addEventListener("click", function () { $("modal").hidden = true; });
        $("modal").addEventListener("click", function (e) { if (e.target === this) this.hidden = true; });
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") $("modal").hidden = true; });
        $("form-borrar").addEventListener("click", async function () {
            if (!E.editando || !confirm("¿Borrar " + E.editando.mes_nombre + " " + E.editando.anio + " (" + E.editando.tipo + ")? También se borra su acuse guardado.")) return;
            try { await api("/api/isn/periodo/" + E.editando.id, { method: "DELETE" }); $("modal").hidden = true; await cargarEmpresas(); cargar(); }
            catch (err) { $("form-error").textContent = err.message; $("form-error").hidden = false; }
        });
        $("btn-plantilla").addEventListener("click", async function () {
            try { await bajar(await api("/api/isn/plantilla"), "Plantilla_ISN.xlsx"); } catch (e) { aviso(e.message, true); }
        });
        $("btn-excel").addEventListener("click", function () { $("in-excel").click(); });
        $("in-excel").addEventListener("change", async function () {
            var f = this.files[0]; this.value = ""; if (!f) return;
            var fd = new FormData(); fd.append("archivo", f);
            try {
                var r = await (await api("/api/isn/excel", { method: "POST", body: fd })).json();
                aviso("Se cargaron " + r.cargados + " periodo(s)" + (r.rfcs.length ? " de " + r.rfcs.join(", ") : "") + "." +
                      (r.errores.length ? "\nNo se cargaron:\n" + r.errores.join("\n") : ""), r.errores.length > 0);
                await cargarEmpresas();
                if (r.rfcs.length && r.rfcs.indexOf(E.rfc) === -1) abrir(r.rfcs[0]); else cargar();
            } catch (e) { aviso(e.message, true); }
        });
        $("btn-acuses").addEventListener("click", function () { $("in-acuses").click(); });
        $("in-acuses").addEventListener("change", async function () {
            var archivos = Array.from(this.files); this.value = ""; if (!archivos.length) return;
            var fd = new FormData(); archivos.forEach(function (a) { fd.append("archivos", a); });
            aviso("Leyendo " + archivos.length + " acuse(s)…");
            try {
                var r = await (await api("/api/isn/acuses", { method: "POST", body: fd })).json();
                var malos = r.resultados.filter(function (x) { return x.error; });
                var conAviso = r.resultados.filter(function (x) { return !x.error && x.avisos.length; });
                aviso("Se leyeron " + r.leidos + " de " + archivos.length + " acuse(s)." +
                      (conAviso.length ? "\nRevisa: " + conAviso.map(function (x) { return x.rfc + " " + MESES[x.mes - 1] + " " + x.anio + ": " + x.avisos.join(" "); }).join("\n") : "") +
                      (malos.length ? "\nNo se leyeron:\n" + malos.map(function (x) { return x.archivo + ": " + x.error; }).join("\n") : ""),
                      malos.length > 0 || conAviso.length > 0);
                await cargarEmpresas();
                var buenos = r.resultados.filter(function (x) { return !x.error; });
                if (buenos.length) { E.anio = buenos[0].anio; abrir(buenos.some(function (x) { return x.rfc === E.rfc; }) ? E.rfc : buenos[0].rfc); }
            } catch (e) { aviso(e.message, true); }
        });
        $("btn-exportar").addEventListener("click", async function () {
            if (!E.rfc) return;
            try { await bajar(await api("/api/isn/exportar?rfc=" + encodeURIComponent(E.rfc) + "&anio=" + E.anio), E.rfc + "_ISN_" + E.anio + ".xlsx"); }
            catch (e) { aviso(e.message, true); }
        });
    }

    document.addEventListener("DOMContentLoaded", iniciar);
})();
