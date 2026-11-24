/*
 * herramientas/retenciones/retenciones.js — CFDI de Retenciones e información de pagos de una empresa:
 * recibidas (las que le hicieron: bancos, clientes que retienen ISR/IVA, dividendos) y emitidas.
 * Llegan desde Descarga masiva (Tipo «Retenciones») o subiendo los XML. Descargar Excel y bajar los XML.
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var q = new URLSearchParams(location.search);
    var E = { empresas: [], rfc: null, anio: "", lado: q.get("lado") === "emitida" ? "emitida" : "recibida", datos: null,
              ver: q.get("ver") === "papel" ? "papel" : "lista" };

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
        enlacePedir();
    }
    /* «Pedir al SAT» (19-nov, el dueño: no dejaba elegido el tipo): Descarga masiva abre con «Retenciones e información de pagos»
       por Web service y del lado de la pestaña que ves (emitidas o recibidas). */
    function enlacePedir() {
        var q = new URLSearchParams();
        if (E.rfc) q.set("rfc", E.rfc);
        q.set("tipo", "RET");
        q.set("lado", E.lado === "recibida" ? "recibidos" : "emitidos");
        $("btn-pedir").href = "/herramientas/descarga-xml/?" + q.toString();
    }
    function pestanas() {
        [].forEach.call(document.querySelectorAll("[data-lado]"), function (b) { b.setAttribute("aria-selected", String(b.dataset.lado === E.lado)); });
        $("th-contraparte").textContent = E.lado === "recibida" ? "Retenedor" : "Receptor";
        enlacePedir();
    }

    async function cargar() {
        aviso("");
        [].forEach.call(document.querySelectorAll("[data-ver]"), function (b) { b.setAttribute("aria-pressed", String(b.dataset.ver === E.ver)); });
        $("papel").hidden = E.ver !== "papel"; $("caja-lista").hidden = E.ver === "papel"; $("btn-zip").hidden = E.ver === "papel";
        if (E.ver === "papel") return cargarPapel();
        if (!E.rfc) { pintar({ filas: [], totales: {}, anios: [] }); aviso("Elige una empresa."); return; }
        $("tb").innerHTML = '<tr><td colspan="10" class="rt-vacio">Cargando…</td></tr>';
        E.carga = E.carga || Fiscontable.avisoCarga($("lista-marco"));          // 17-nov: «Cargando…» y «Actualizado» sobre la tabla
        E.carga.mostrar("Cargando retenciones" + (E.anio ? " de " + E.anio : "") + "…");
        try {
            E.datos = await (await api(base() + filtros())).json();
        } catch (e) { E.carga.quitar(); $("tb").innerHTML = ""; aviso(esc(e.message), true); return; }
        pintar(E.datos);
        E.carga.listo("Actualizado · " + ((E.datos.filas || []).length).toLocaleString("es-MX") + " retención(es)" + (E.anio ? " de " + E.anio : ""));
    }

    function cifra(t, v) { return '<div class="rt-cifra"><small>' + t + "</small><b>" + v + "</b></div>"; }
    function pintar(d) {
        var anios = d.anios || [];
        if (E.anio && anios.indexOf(E.anio) < 0) anios = [E.anio].concat(anios);
        $("sel-anio").innerHTML = '<option value="">Todos los años</option>' + anios.map(function (a) {
            return "<option" + (a === E.anio ? " selected" : "") + ">" + a + "</option>"; }).join("");
        var t = d.totales || {};
        // 23-nov-2026 (auditoría descarga_xml-6): las canceladas ante el SAT no suman; se ven en gris con su fecha
        $("cifras").innerHTML = cifra("Comprobantes", (t.cantidad || 0).toLocaleString("es-MX")) + cifra("Monto de operación", "$" + m(t.monto_operacion)) +
            cifra("ISR retenido", "$" + m(t.isr_retenido)) + cifra("IVA retenido", "$" + m(t.iva_retenido)) + cifra("Total retenido", "$" + m(t.monto_retenido)) +
            (t.canceladas ? cifra("Canceladas (no suman)", t.canceladas.toLocaleString("es-MX")) : "");
        notaEstado(t.sin_validar);
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
            var cancelada = f.estado_sat === "Cancelado", rara = f.estado_sat === "No encontrado";
            var chip = cancelada ? '<span class="rt-sub rt-estado rt-estado--cancelada">Cancelada' + (f.fecha_cancelacion ? " · " + esc(fecha(f.fecha_cancelacion)) : "") + "</span>"
                : (rara ? '<span class="rt-sub rt-estado rt-estado--rara" title="La lista del SAT no la trae: revísala">No aparece en el SAT</span>' : "");
            return '<tr' + (cancelada ? ' class="rt-fila--cancelada" title="Cancelada ante el SAT: no suma"' : "") + "><td>" + esc(fecha(f.fecha_exp)) + chip +
                '</td><td title="' + esc(f.uuid) + '">' + esc(f.uuid.slice(0, 8)) + "…</td>" +
                '<td title="' + esc(nom || "") + '">' + esc(nom || rfc || "") + '<span class="rt-sub">' + esc(rfc || "") + "</span></td>" +
                '<td title="' + esc(f.desc_retenc || "") + '">' + esc(f.desc_retenc || "") + '<span class="rt-sub">Clave ' + esc(f.cve_retenc || "") + "</span></td>" +
                "<td>" + esc(periodo) + '</td><td class="xml-num">' + m(f.monto_operacion) + '</td><td class="xml-num">' + m(f.isr_retenido) +
                '</td><td class="xml-num">' + m(f.iva_retenido) + '</td><td class="xml-num"><b>' + m(f.monto_retenido) + "</b></td>" +
                '<td><button type="button" class="xml-btn" data-xml="' + esc(f.uuid) + '" title="Descargar el XML">XML</button></td></tr>';
        }).join("");
    }

    /* Cuántas no se han revisado ante el SAT (23-nov-2026): su estado lo trae la lista de la madrugada */
    function notaEstado(n) {
        if (!n || $("aviso").classList.contains("isn-aviso--error")) return;
        aviso(n.toLocaleString("es-MX") + " retención(es) sin validar ante el SAT: su estado se revisa de madrugada con la e.firma de la empresa. Las canceladas no suman.");
    }

    /* ---------- Papel de trabajo: por mes y por quien retuvo (15-nov) ---------- */
    async function cargarPapel() {
        if (!E.rfc) { $("papel").innerHTML = ""; aviso("Elige una empresa."); return; }
        $("papel").innerHTML = '<p class="rt-papel__nota">Cargando…</p>';
        var p, lista;
        try {
            p = await (await api(base() + "/papel" + filtros())).json();
            if (!E.datos) E.datos = await (await api(base() + filtros())).json();
        } catch (e) { $("papel").innerHTML = ""; aviso(esc(e.message), true); return; }
        E.papel = p;
        pintarAnios((E.datos && E.datos.anios) || [], p.anio);
        var t = p.total || {};
        var canc = p.canceladas || [];
        $("cifras").innerHTML = cifra("Año", esc(p.anio)) + cifra("ISR retenido", "$" + m(t.isr_retenido)) + cifra("IVA retenido", "$" + m(t.iva_retenido)) +
            (t.ieps_retenido ? cifra("IEPS retenido", "$" + m(t.ieps_retenido)) : "") + cifra("Total retenido", "$" + m(t.monto_retenido)) +
            (canc.length ? cifra("Canceladas (no suman)", canc.length.toLocaleString("es-MX")) : "");
        notaEstado(p.sin_validar);
        $("btn-excel").disabled = !p.periodos.length;
        var quien = E.lado === "recibida" ? "Retenedor" : "Receptor";
        if (!p.periodos.length) {
            $("papel").innerHTML = '<p class="rt-papel__nota">Sin retenciones ' + (E.lado === "recibida" ? "recibidas" : "emitidas") + " de " + esc(p.anio) +
                ". Actívalas de noche en Configuración › Lo automático o pídelas en Descarga masiva (Tipo «Retenciones e información de pagos»).</p>";
            return;
        }
        var num = function (g) { return '<td class="xml-num">' + m(g.monto_operacion) + '</td><td class="xml-num">' + m(g.isr_retenido) + '</td><td class="xml-num">' +
            m(g.iva_retenido) + '</td><td class="xml-num">' + m(g.ieps_retenido) + '</td><td class="xml-num"><b>' + m(g.monto_retenido) + "</b></td>"; };
        var cab = '<th class="xml-num">Operación</th><th class="xml-num">ISR</th><th class="xml-num">IVA</th><th class="xml-num">IEPS</th><th class="xml-num">Total retenido</th>';
        // 18-nov: la explicación va en un globo junto al título (antes ocupaba un renglón arriba del papel)
        $("papel").innerHTML = '<h2 id="rt-papel-titulo">Por mes · ' + esc(p.anio) + "</h2>" +
            '<p class="rt-papel__nota" data-globo-en="#rt-papel-titulo" data-globo-nombre="Para qué sirve el papel de trabajo">' + (E.lado === "recibida"
                ? "Lo que le retuvieron a la empresa, para acreditarlo en la declaración del mes y en la anual."
                : "Lo que la empresa retuvo a terceros, para enterarlo en la declaración del mes.") + " Toca un mes para ver el detalle por " + quien.toLowerCase() + ".</p>" +
            '<div class="rt-papel__caja"><table><thead><tr><th>Periodo</th><th>' + quien + "es y CFDI</th>" + cab + "</tr></thead><tbody>" +
            p.periodos.map(function (per) {
                return '<tr data-per="' + esc(per.clave) + '" aria-expanded="false" tabindex="0"><td><b>' + esc(per.nombre) + "</b></td><td>" + per.filas.length + " " + (per.filas.length === 1 ? quien.toLowerCase() : quien.toLowerCase() + "es") + " · " +
                    per.totales.cantidad + " CFDI</td>" + num(per.totales) + "</tr>" +
                    per.filas.map(function (g) {
                        return '<tr class="rt-papel__det" data-de="' + esc(per.clave) + '" hidden><td>' + esc(g.nombre) + " <span class=\"rt-sub\">" + esc(g.rfc) +
                            "</span></td><td>" + esc(g.concepto || ("Clave " + g.clave)) + " · " + g.cantidad + "</td>" + num(g) + "</tr>";
                    }).join("");
            }).join("") + '</tbody><tfoot><tr><td>Total del año</td><td>' + t.cantidad + " CFDI</td>" + num(t) + "</tr></tfoot></table></div>" +
            '<h2>Por ' + quien.toLowerCase() + " en el año</h2>" +
            '<div class="rt-papel__caja"><table><thead><tr><th>' + quien + "</th><th>Concepto</th>" + cab + "</tr></thead><tbody>" +
            p.por_retenedor.map(function (g) {
                return "<tr><td>" + esc(g.nombre) + ' <span class="rt-sub">' + esc(g.rfc) + "</span></td><td>" + esc(g.concepto || ("Clave " + g.clave)) + " · " + g.cantidad + "</td>" + num(g) + "</tr>";
            }).join("") + "</tbody></table></div>" +
            (canc.length ? '<h2>Canceladas ante el SAT · no suman</h2><div class="rt-papel__caja"><table><thead><tr><th>Periodo</th><th>' + quien +
                "</th><th>Expedida</th><th>Cancelada</th>" + cab + "</tr></thead><tbody>" + canc.map(function (c) {
                    return '<tr class="rt-fila--cancelada"><td>' + esc(c.periodo) + "</td><td>" + esc(c.nombre || c.rfc) + ' <span class="rt-sub">' + esc(c.rfc) +
                        "</span></td><td>" + esc(fecha(c.fecha_exp)) + "</td><td>" + esc(c.fecha_cancelacion ? fecha(c.fecha_cancelacion) : "—") + "</td>" + num(c) + "</tr>";
                }).join("") + "</tbody></table></div>" : "");
        if (Fiscontable.globos) Fiscontable.globos($("papel"));
    }
    function pintarAnios(anios, actual) {
        if (actual && anios.indexOf(actual) < 0) anios = [actual].concat(anios);
        $("sel-anio").innerHTML = (E.ver === "papel" ? "" : '<option value="">Todos los años</option>') + anios.map(function (a) {
            return "<option" + (a === (E.anio || actual) ? " selected" : "") + ">" + a + "</option>"; }).join("");
    }

    async function bajar(ruta, nombre, boton) {
        var texto = boton.textContent;
        boton.disabled = true; boton.textContent = "Descargando…";
        // 24-nov-2026: el nombre lo pone el servidor (core/nombres: RFC primero); el de aquí solo si no viene
        try {
            var r = await api(ruta), mt = /filename="?([^";]+)"?/.exec(r.headers.get("Content-Disposition") || "");
            Fiscontable.guardarArchivo(await r.blob(), mt ? mt[1] : nombre);
        }
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
            b.addEventListener("click", function () { E.lado = b.dataset.lado; E.datos = null; pestanas(); cargar(); });
        });
        $("sel-anio").addEventListener("change", function () { E.anio = this.value; E.datos = null; cargar(); });
        // 24-nov-2026 (decisión A del dueño, Avance 2): un solo «Descargar Excel»: lo que ves (los comprobantes de la pestaña o el
        // papel de trabajo con sus tres tablas)
        $("btn-excel").addEventListener("click", function () {
            if (E.ver === "papel") return bajar(base() + "/papel/excel" + filtros(), E.rfc + "_Papel-Retenciones.xlsx", this);
            bajar(base() + "/excel" + filtros() + "&nombre=" + encodeURIComponent(nombreEmpresa(E.rfc)), E.rfc + "_Retenciones.xlsx", this);
        });
        [].forEach.call(document.querySelectorAll("[data-ver]"), function (b) {
            b.addEventListener("click", function () { E.ver = b.dataset.ver; cargar(); });
        });
        $("papel").addEventListener("click", abrirMes);
        $("papel").addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrirMes(ev); } });
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
            E.rfc = b.dataset.rfc; E.datos = null; $("menu-empresa").hidden = true; titulo(); cargar();
        });
        document.addEventListener("click", function (ev) {
            if (!ev.target.closest(".xml-menu")) $("menu-empresa").hidden = true;
        });
    }

    function abrirMes(ev) {
        var tr = ev.target.closest("tr[data-per]");
        if (!tr) return;
        var abierto = tr.getAttribute("aria-expanded") !== "true";
        tr.setAttribute("aria-expanded", String(abierto));
        [].forEach.call($("papel").querySelectorAll('tr[data-de="' + tr.dataset.per + '"]'), function (x) { x.hidden = !abierto; });
    }

    iniciar();
})();
