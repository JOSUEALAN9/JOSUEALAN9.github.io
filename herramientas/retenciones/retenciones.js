/*
 * herramientas/retenciones/retenciones.js — CFDI de Retenciones e información de pagos de una empresa:
 * recibidas (las que le hicieron: bancos, clientes que retienen ISR/IVA, dividendos) y emitidas.
 * Llegan desde Descarga masiva (Tipo «Retenciones») o subiendo los XML. Exportar a Excel y bajar los XML.
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var q = new URLSearchParams(location.search);
    var E = { empresas: [], rfc: null, anio: "", lado: q.get("lado") === "emitida" ? "emitida" : "recibida", datos: null };

    async function api(ruta, opciones) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r;
    }
    function m(v) { return (Number(v) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function aviso(t, mal) { var a = $("aviso"); a.innerHTML = t || ""; a.className = "isn-aviso" + (mal ? " isn-aviso--error" : ""); a.hidden = !t; }
    function filtros() { return "?lado=" + E.lado + (E.anio ? "&anio=" + E.anio : ""); }
    function base() { return "/api/retenciones/" + encodeURIComponent(E.rfc); }
    function fecha(iso) {
        var d = new Date((iso || "").slice(0, 10) + "T12:00:00");
        return isNaN(d) ? (iso || "") : d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
    }

    async function iniciar() {
        if (!(await Fiscontable.exigirModulo("descarga_xml"))) return;
        try { E.empresas = await (await api("/api/clientes")).json(); } catch (e) { E.empresas = []; }
        var activa = await Fiscontable.empresaActiva();
        E.rfc = (q.get("rfc") || (activa && activa.rfc) || (E.empresas[0] && E.empresas[0].rfc) || "").toUpperCase() || null;
        eventos();
        pestanas();
        titulo();
        await cargar();
    }

    function nombreEmpresa(rfc) {
        var c = E.empresas.find(function (x) { return x.rfc === rfc; });
        return (c && (c.alias || c.razon_social || c.nombre)) || rfc;
    }
    function titulo() {
        $("empresa-etiqueta").textContent = E.rfc ? "Empresa · " + E.rfc : "Empresa";
        $("empresa-titulo").textContent = E.rfc ? nombreEmpresa(E.rfc) : "Elegir empresa";
        $("btn-pedir").href = "/herramientas/descarga-xml/" + (E.rfc ? "?rfc=" + encodeURIComponent(E.rfc) : "");
    }
    function pestanas() {
        [].forEach.call(document.querySelectorAll("[data-lado]"), function (b) { b.setAttribute("aria-selected", String(b.dataset.lado === E.lado)); });
        $("th-contraparte").textContent = E.lado === "recibida" ? "Retenedor" : "Receptor";
    }

    async function cargar() {
        aviso("");
        if (!E.rfc) { pintar({ filas: [], totales: {}, anios: [] }); aviso("Elige una empresa."); return; }
        $("tb").innerHTML = '<tr><td colspan="10" class="rt-vacio">Cargando…</td></tr>';
        try {
            E.datos = await (await api(base() + filtros())).json();
        } catch (e) { $("tb").innerHTML = ""; aviso(esc(e.message), true); return; }
        pintar(E.datos);
    }

    function cifra(t, v) { return '<div class="rt-cifra"><small>' + t + "</small><b>" + v + "</b></div>"; }
    function pintar(d) {
        var anios = d.anios || [];
        if (E.anio && anios.indexOf(E.anio) < 0) anios = [E.anio].concat(anios);
        $("sel-anio").innerHTML = '<option value="">Todos los años</option>' + anios.map(function (a) {
            return "<option" + (a === E.anio ? " selected" : "") + ">" + a + "</option>"; }).join("");
        var t = d.totales || {};
        $("cifras").innerHTML = cifra("Comprobantes", (t.cantidad || 0).toLocaleString("es-MX")) + cifra("Monto de operación", "$" + m(t.monto_operacion)) +
            cifra("ISR retenido", "$" + m(t.isr_retenido)) + cifra("IVA retenido", "$" + m(t.iva_retenido)) + cifra("Total retenido", "$" + m(t.monto_retenido));
        var hay = (d.filas || []).length;
        $("btn-zip").disabled = $("btn-excel").disabled = !hay;
        if (!hay) {
            $("tb").innerHTML = '<tr><td colspan="10" class="rt-vacio">Sin retenciones ' + (E.lado === "recibida" ? "recibidas" : "emitidas") +
                (E.anio ? " en " + esc(E.anio) : "") + '. Pídelas al SAT en Descarga masiva (Tipo «Retenciones») o sube los XML.</td></tr>';
            return;
        }
        $("tb").innerHTML = d.filas.map(function (f) {
            var rfc = E.lado === "recibida" ? f.rfc_emisor : f.rfc_receptor, nom = E.lado === "recibida" ? f.nombre_emisor : f.nombre_receptor;
            var periodo = f.ejercicio ? (f.mes_ini && f.mes_fin && f.mes_ini !== f.mes_fin ? +f.mes_ini + "–" + +f.mes_fin + "/" : (f.mes_ini ? +f.mes_ini + "/" : "")) + f.ejercicio : "";
            return "<tr><td>" + esc(fecha(f.fecha_exp)) + '</td><td title="' + esc(f.uuid) + '">' + esc(f.uuid.slice(0, 8)) + "…</td>" +
                '<td title="' + esc(nom || "") + '">' + esc(nom || rfc || "") + '<span class="rt-sub">' + esc(rfc || "") + "</span></td>" +
                '<td title="' + esc(f.desc_retenc || "") + '">' + esc(f.desc_retenc || "") + '<span class="rt-sub">Clave ' + esc(f.cve_retenc || "") + "</span></td>" +
                "<td>" + esc(periodo) + '</td><td class="xml-num">' + m(f.monto_operacion) + '</td><td class="xml-num">' + m(f.isr_retenido) +
                '</td><td class="xml-num">' + m(f.iva_retenido) + '</td><td class="xml-num"><b>' + m(f.monto_retenido) + "</b></td>" +
                '<td><button type="button" class="xml-btn" data-xml="' + esc(f.uuid) + '" title="Descargar el XML">XML</button></td></tr>';
        }).join("");
    }

    async function bajar(ruta, nombre, boton) {
        var texto = boton.textContent;
        boton.disabled = true; boton.textContent = "Descargando…";
        try { Fiscontable.guardarArchivo(await (await api(ruta)).blob(), nombre); }
        catch (e) { aviso(esc(e.message), true); }
        finally { boton.disabled = false; boton.textContent = texto; }
    }

    async function subir(archivos) {
        if (!archivos.length || !E.rfc) return;
        var fd = new FormData();
        [].forEach.call(archivos, function (a) { fd.append("archivos", a); });
        aviso("Subiendo " + archivos.length + " archivo(s)…");
        try {
            var r = await (await api(base() + "/subir", { method: "POST", body: fd })).json();
            aviso(r.nuevas + " nueva(s)" + (r.duplicadas ? ", " + r.duplicadas + " ya estaban" : "") +
                (r.ajenas ? ", " + r.ajenas + " de otra empresa" : "") + (r.rechazadas ? ", " + r.rechazadas + " no son retenciones" : "") + ".");
            var guardado = $("aviso").innerHTML;
            await cargar();
            aviso(guardado);
        } catch (e) { aviso(esc(e.message), true); }
        $("subir").value = "";
    }

    function eventos() {
        [].forEach.call(document.querySelectorAll("[data-lado]"), function (b) {
            b.addEventListener("click", function () { E.lado = b.dataset.lado; pestanas(); cargar(); });
        });
        $("sel-anio").addEventListener("change", function () { E.anio = this.value; cargar(); });
        $("btn-excel").addEventListener("click", function () {
            bajar(base() + "/excel" + filtros(), E.rfc + "_Retenciones_" + E.lado + "s" + (E.anio ? "_" + E.anio : "") + ".xlsx", this);
        });
        $("btn-zip").addEventListener("click", function () {
            bajar(base() + "/zip" + filtros(), E.rfc + "_Retenciones" + (E.anio ? "_" + E.anio : "") + ".zip", this);
        });
        $("tb").addEventListener("click", function (ev) {
            var b = ev.target.closest("[data-xml]");
            if (b) bajar(base() + "/xml/" + encodeURIComponent(b.dataset.xml), b.dataset.xml + ".xml", b);
        });
        $("subir").addEventListener("change", function () { subir(this.files); });
        $("btn-empresa").addEventListener("click", function () {
            var menu = $("menu-empresa");
            menu.innerHTML = E.empresas.length ? E.empresas.map(function (c) {
                return '<button type="button" data-rfc="' + esc(c.rfc) + '"' + (c.rfc === E.rfc ? ' class="xml-activa"' : "") + ">" +
                    esc(c.alias || c.razon_social || c.rfc) + " <span>" + esc(c.rfc) + "</span></button>";
            }).join("") : '<p class="xml-otra__nota">Agrega primero tus clientes.</p>';
            menu.hidden = !menu.hidden;
        });
        $("menu-empresa").addEventListener("click", function (ev) {
            var b = ev.target.closest("[data-rfc]");
            if (!b) return;
            E.rfc = b.dataset.rfc; $("menu-empresa").hidden = true; titulo(); cargar();
        });
        document.addEventListener("click", function (ev) {
            if (!ev.target.closest(".xml-menu")) $("menu-empresa").hidden = true;
        });
    }

    iniciar();
})();
