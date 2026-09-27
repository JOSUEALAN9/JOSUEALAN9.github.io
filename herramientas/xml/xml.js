/**
 * xml.js — Administración de XML.
 *
 * Flujo: se cargan los XML (el servidor los lee y los acomoda por
 * contribuyente); aquí se piden UNA vez las filas del contribuyente y
 * periodo elegidos, y todo lo demás (minimódulos, filtros, orden,
 * columnas) pasa en el navegador sin volver a pedir nada.
 *
 * La tabla dibuja solo las filas que se ven (desplazamiento virtual), así
 * que miles de registros no la traban.
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };

    var MODULOS = [
        { clave: "recibidos", nombre: "Recibidos" },
        { clave: "emitidos", nombre: "Emitidos" },
        { clave: "nomina", nombre: "Nómina" },
        { clave: "pagos", nombre: "Pagos" }
    ];
    var SUBS = {
        recibidos: [["ingresos", "Ingresos"], ["egresos", "Egresos"], ["traslados", "Traslados"]],
        emitidos: [["ingresos", "Ingresos"], ["egresos", "Egresos"], ["traslados", "Traslados"]],
        pagos: [["recibidos", "Recibidos"], ["emitidos", "Emitidos"]],
        nomina: []
    };
    var RAPIDOS = {
        recibidos: [["ppd", "PPD"], ["sinpago", "PPD sin pago"], ["retenciones", "Con retenciones"], ["extranjera", "Moneda extranjera"], ["relacionados", "Con relacionados"]],
        emitidos: [["ppd", "PPD"], ["sinpago", "PPD sin pago"], ["retenciones", "Con retenciones"], ["extranjera", "Moneda extranjera"], ["relacionados", "Con relacionados"]],
        pagos: [["nocargada", "Factura no cargada"], ["extranjera", "Moneda extranjera"]],
        nomina: []
    };
    var PRUEBA_RAPIDO = {
        ppd: function (f) { return f.metodo_pago === "PPD"; },
        sinpago: function (f) { return f.estado_pago === "Sin pago" || f.estado_pago === "Parcial"; },
        retenciones: function (f) { return !!(f.ret_isr || f.ret_iva || f.ret_ieps); },
        extranjera: function (f) { var m = f.moneda || f.moneda_p; return !!m && m !== "MXN" && m !== "XXX"; },
        relacionados: function (f) { return !!f.cfdi_relacionados; },
        nocargada: function (f) { return f.docto_encontrado === "No"; }
    };
    var ANCHO_TIPO = { moneda: 122, numero: 90, fecha: 104, uuid: 130, texto: 160 };
    var ANCHO_CLAVE = { emisor_nombre: 250, receptor_nombre: 250, contraparte_nombre: 250, conceptos: 300, serie_folio: 130,
        estado_pago: 120, estado_sat: 100, forma_pago: 210, forma_pago_p: 210, uso_cfdi: 190, docto_encontrado: 90 };

    var E = {
        contribuyentes: [], rfc: null, periodo: "", datos: null,
        modulo: "recibidos", sub: "", rapidos: {}, busqueda: "",
        orden: { clave: null, dir: 1 }, seleccion: new Set(),
        columnas: {}, vistas: [], vistaActual: {},
        filas: [], altoFila: 35
    };

    var fmtMoneda = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var fmtNumero = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 4 });

    /* ============================================================ utilidades */
    async function api(ruta, opciones) {
        var resp;
        try {
            resp = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        } catch (e) {
            throw new Error("No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.");
        }
        if (!resp.ok) throw new Error(await Fiscontable.leerError(resp));
        return resp;
    }
    async function apiJSON(ruta, opciones) { return (await api(ruta, opciones)).json(); }
    function postJSON(ruta, cuerpo) {
        return api(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    }
    function avisar(texto, tipo) { Fiscontable.aviso ? Fiscontable.aviso(texto) : alert(texto); }
    function guardarLocal(clave, valor) { try { localStorage.setItem("xml:" + clave, JSON.stringify(valor)); } catch (e) { /* nada */ } }
    function leerLocal(clave) { try { return JSON.parse(localStorage.getItem("xml:" + clave)); } catch (e) { return null; } }
    function descargarBlob(blob, nombre) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }
    function nombreArchivo(resp, porDefecto) {
        var cd = resp.headers.get("Content-Disposition") || "";
        var m = cd.match(/filename="?([^";]+)"?/);
        return m ? m[1] : porDefecto;
    }
    var MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

    /* ============================================================ arranque */
    document.addEventListener("DOMContentLoaded", iniciar);

    async function iniciar() {
        if (!(await Fiscontable.exigirModulo("validador"))) return;
        prepararCarga();
        prepararEventos();
        await Promise.all([cargarVistas(), cargarContribuyentes()]);
    }

    async function cargarContribuyentes(rfcPreferido) {
        try {
            E.contribuyentes = await apiJSON("/api/xml/contribuyentes");
        } catch (e) { avisar(e.message); return; }
        var hay = E.contribuyentes.length > 0;
        $("sin-datos").hidden = hay;
        $("contenido").hidden = !hay;
        if (!hay) { $("panel-carga").hidden = false; return; }

        $("sel-contribuyente").innerHTML = E.contribuyentes.map(function (c) {
            return '<option value="' + esc(c.rfc) + '">' + esc((c.nombre || "Sin nombre") + " · " + c.rfc + " (" + c.total + ")") + "</option>";
        }).join("");
        $("sel-forzar").innerHTML = '<option value="">Detectar solo (recomendado)</option>' + E.contribuyentes.map(function (c) {
            return '<option value="' + esc(c.rfc) + '">' + esc((c.nombre || "") + " · " + c.rfc) + "</option>";
        }).join("");
        var elegido = rfcPreferido || E.rfc || leerLocal("rfc");
        if (!E.contribuyentes.some(function (c) { return c.rfc === elegido; })) elegido = E.contribuyentes[0].rfc;
        $("sel-contribuyente").value = elegido;
        await elegirContribuyente(elegido);
    }

    async function elegirContribuyente(rfc) {
        E.rfc = rfc;
        E.busqueda = ""; $("buscar").value = "";
        guardarLocal("rfc", rfc);
        E.seleccion.clear();
        var c = E.contribuyentes.find(function (x) { return x.rfc === rfc; });
        var opciones = ['<option value="">Todos los periodos</option>'];
        var anios = {};
        (c.periodos || []).forEach(function (p) { anios[p.periodo.slice(0, 4)] = (anios[p.periodo.slice(0, 4)] || 0) + p.n; });
        Object.keys(anios).sort().reverse().forEach(function (a) {
            opciones.push('<option value="a:' + a + '">Todo ' + a + " (" + anios[a] + ")</option>");
            (c.periodos || []).filter(function (p) { return p.periodo.slice(0, 4) === a; }).forEach(function (p) {
                opciones.push('<option value="m:' + p.periodo + '">&nbsp;&nbsp;' + MESES[+p.periodo.slice(5, 7) - 1] + " " + a + " (" + p.n + ")</option>");
            });
        });
        $("sel-periodo").innerHTML = opciones.join("");
        // Por defecto, el mes más reciente con XML
        var recordado = leerLocal("periodo:" + rfc);
        $("sel-periodo").value = recordado && $("sel-periodo").querySelector('option[value="' + recordado + '"]') ? recordado
            : (c.periodos && c.periodos.length ? "m:" + c.periodos[0].periodo : "");
        await cargarRegistros();
    }

    function rangoPeriodo() {
        var v = $("sel-periodo").value;
        if (v.indexOf("m:") === 0) {
            var y = +v.slice(2, 6), m = +v.slice(7, 9);
            var ultimo = new Date(y, m, 0).getDate();
            return { desde: v.slice(2) + "-01", hasta: v.slice(2) + "-" + String(ultimo).padStart(2, "0") };
        }
        if (v.indexOf("a:") === 0) return { desde: v.slice(2) + "-01-01", hasta: v.slice(2) + "-12-31" };
        return { desde: null, hasta: null };
    }

    async function cargarRegistros() {
        guardarLocal("periodo:" + E.rfc, $("sel-periodo").value);
        var r = rangoPeriodo();
        var q = "?rfc=" + encodeURIComponent(E.rfc) + (r.desde ? "&desde=" + r.desde + "&hasta=" + r.hasta : "");
        $("conteo-filas").textContent = "Cargando…";
        try {
            E.datos = (await apiJSON("/api/xml/registros" + q)).modulos;
        } catch (e) { avisar(e.message); return; }
        E.seleccion.clear();
        var c = E.contribuyentes.find(function (x) { return x.rfc === E.rfc; });
        $("resumen-contrib").textContent = c ? c.total + " XML en su biblioteca" : "";
        if (!E.datos[E.modulo] || !E.datos[E.modulo].filas.length) {
            var primero = MODULOS.find(function (m) { return E.datos[m.clave].filas.length; });
            E.modulo = primero ? primero.clave : "recibidos";
            E.sub = "";
        }
        pintarPestanas();
        cambiarModulo(E.modulo, true);
    }

    /* ============================================================ minimódulos */
    function contarUuid(filas) {
        var s = new Set();
        filas.forEach(function (f) { s.add(f.uuid); });
        return s.size;
    }

    function pintarPestanas() {
        $("pestanas").innerHTML = MODULOS.map(function (m) {
            var n = contarUuid(E.datos[m.clave].filas);
            return '<button type="button" class="pestana' + (m.clave === E.modulo ? " pestana--activa" : "") + '" data-modulo="' + m.clave + '"' +
                (n ? "" : " disabled") + ">" + m.nombre + '<span class="xml-cuenta">' + n + "</span></button>";
        }).join("");
    }

    function cambiarModulo(modulo, conservarSub) {
        E.modulo = modulo;
        if (!conservarSub) E.sub = "";
        E.rapidos = {};
        E.orden = { clave: null, dir: 1 };
        E.seleccion.clear();
        document.querySelectorAll("#pestanas .pestana").forEach(function (b) { b.classList.toggle("pestana--activa", b.dataset.modulo === modulo); });
        prepararColumnas();
        pintarSubfiltros();
        pintarRapidos();
        pintarVistas();
        aplicar();
    }

    function pintarSubfiltros() {
        var filas = E.datos[E.modulo].filas;
        var subs = SUBS[E.modulo];
        if (!subs.length) { $("subfiltros").innerHTML = ""; return; }
        var html = ['<button type="button" class="xml-chip' + (E.sub === "" ? " xml-chip--activo" : "") + '" data-sub="">Todos<span>' + contarUuid(filas) + "</span></button>"];
        subs.forEach(function (s) {
            var n = contarUuid(filas.filter(function (f) { return f._sub === s[0]; }));
            if (n) html.push('<button type="button" class="xml-chip' + (E.sub === s[0] ? " xml-chip--activo" : "") + '" data-sub="' + s[0] + '">' + s[1] + "<span>" + n + "</span></button>");
        });
        $("subfiltros").innerHTML = html.join("");
    }

    function pintarRapidos() {
        $("rapidos").innerHTML = RAPIDOS[E.modulo].map(function (r) {
            return '<button type="button" class="xml-chip' + (E.rapidos[r[0]] ? " xml-chip--activo" : "") + '" data-rapido="' + r[0] + '">' + r[1] + "</button>";
        }).join("");
    }

    /* ============================================================ columnas y vistas */
    function catalogo() { return E.datos[E.modulo].columnas; }
    function colPorClave(clave) { return catalogo().find(function (c) { return c.clave === clave; }); }
    function anchoDefecto(c) { return ANCHO_CLAVE[c.clave] || ANCHO_TIPO[c.tipo] || 150; }

    function columnasDeFabrica() {
        return E.datos[E.modulo].predeterminadas.filter(colPorClave).map(function (k) { return { clave: k, ancho: 0 }; });
    }

    function prepararColumnas() {
        // Orden de prioridad: lo último que acomodaste (local) → tu vista predeterminada → de fábrica
        var local = leerLocal("cols:" + E.modulo);
        var pred = E.vistas.find(function (v) { return v.modulo === E.modulo && v.predeterminada; });
        var cols = local || (pred && pred.columnas) || columnasDeFabrica();
        E.vistaActual[E.modulo] = local ? (leerLocal("vista:" + E.modulo) || "") : (pred ? pred.nombre : "");
        E.columnas[E.modulo] = cols.filter(function (c) { return colPorClave(c.clave); });
        if (!E.columnas[E.modulo].length) E.columnas[E.modulo] = columnasDeFabrica();
    }

    function guardarColumnasLocal() {
        guardarLocal("cols:" + E.modulo, E.columnas[E.modulo]);
        guardarLocal("vista:" + E.modulo, E.vistaActual[E.modulo] || "");
    }

    async function cargarVistas() {
        try { E.vistas = await apiJSON("/api/xml/vistas"); } catch (e) { E.vistas = []; }
    }

    function pintarVistas() {
        var propias = E.vistas.filter(function (v) { return v.modulo === E.modulo; });
        var actual = E.vistaActual[E.modulo] || "";
        $("sel-vista").innerHTML = '<option value="">Vista: de fábrica</option>' + propias.map(function (v) {
            return '<option value="' + esc(v.nombre) + '">Vista: ' + esc(v.nombre) + (v.predeterminada ? " ★" : "") + "</option>";
        }).join("") + (actual && propias.some(function (v) { return v.nombre === actual; }) ? '<option value="__borrar">Borrar esta vista…</option>' : "");
        $("sel-vista").value = propias.some(function (v) { return v.nombre === actual; }) ? actual : "";
    }

    function aplicarVista(nombre) {
        if (nombre === "__borrar") { borrarVista(); return; }
        var v = E.vistas.find(function (x) { return x.modulo === E.modulo && x.nombre === nombre; });
        E.columnas[E.modulo] = (v ? v.columnas : columnasDeFabrica()).filter(function (c) { return colPorClave(c.clave); });
        E.vistaActual[E.modulo] = v ? v.nombre : "";
        guardarColumnasLocal();
        pintarVistas();
        pintarTabla();
        if (!$("panel-columnas").hidden) pintarPanelColumnas();
    }

    async function guardarVista() {
        var nombre = prompt("Nombre de la vista (por ejemplo: Revisión de IVA):", E.vistaActual[E.modulo] || "Mi vista");
        if (!nombre || !nombre.trim()) return;
        var pred = confirm("¿Usar esta vista siempre que abras " + MODULOS.find(function (m) { return m.clave === E.modulo; }).nombre + "?");
        try {
            await api("/api/xml/vistas", { method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ modulo: E.modulo, nombre: nombre.trim(), columnas: E.columnas[E.modulo], predeterminada: pred }) });
            await cargarVistas();
            E.vistaActual[E.modulo] = nombre.trim();
            guardarColumnasLocal();
            pintarVistas();
        } catch (e) { avisar(e.message); }
    }

    async function borrarVista() {
        var actual = E.vistaActual[E.modulo];
        var v = E.vistas.find(function (x) { return x.modulo === E.modulo && x.nombre === actual; });
        if (!v || !confirm("¿Borrar la vista \"" + v.nombre + "\"?")) { pintarVistas(); return; }
        try {
            await api("/api/xml/vistas/" + v.id, { method: "DELETE" });
            await cargarVistas();
            aplicarVista("");
        } catch (e) { avisar(e.message); }
    }

    /* ============================================================ filtrar y ordenar */
    function textoBusqueda(f) {
        if (f._q === undefined) {
            f._q = [f.uuid, f.serie_folio, f.emisor_rfc, f.emisor_nombre, f.receptor_rfc, f.receptor_nombre, f.conceptos,
                f.docto_uuid, f.docto_serie_folio, f.curp, f.num_empleado].filter(Boolean).join(" ").toLowerCase();
        }
        return f._q;
    }

    function aplicar() {
        var filas = E.datos[E.modulo].filas;
        var q = E.busqueda.trim().toLowerCase();
        var activos = Object.keys(E.rapidos).filter(function (k) { return E.rapidos[k]; });
        E.filas = filas.filter(function (f) {
            if (E.sub && f._sub !== E.sub) return false;
            for (var i = 0; i < activos.length; i++) if (!PRUEBA_RAPIDO[activos[i]](f)) return false;
            return !q || textoBusqueda(f).indexOf(q) !== -1;
        });
        if (E.orden.clave) {
            var k = E.orden.clave, d = E.orden.dir;
            var tipo = (colPorClave(k) || {}).tipo;
            E.filas.sort(function (a, b) {
                var x = a[k], y = b[k];
                if (x == null) return 1;
                if (y == null) return -1;
                if (tipo === "moneda" || tipo === "numero") return (x - y) * d;
                return String(x).localeCompare(String(y), "es") * d;
            });
        }
        pintarTabla();
    }

    /* ============================================================ tabla */
    function formato(c, v) {
        if (v === undefined || v === null || v === "") return "";
        if (c.tipo === "moneda") return fmtMoneda.format(v);
        if (c.tipo === "numero") return fmtNumero.format(v);
        if (c.tipo === "fecha") { var s = String(v); return s.length >= 10 ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : s; }
        return String(v);
    }

    var SELLOS = {
        estado_pago: { "Pagada": "verde", "Parcial": "ambar", "Sin pago": "rojo" },
        estado_sat: { "Vigente": "verde", "Cancelado": "rojo", "Sin validar": "gris" },
        docto_encontrado: { "Sí": "verde", "No": "ambar" }
    };

    function celda(c, f, fija) {
        var v = f[c.clave];
        var clase = c.tipo === "moneda" || c.tipo === "numero" ? "xml-num" : (c.tipo === "uuid" ? "xml-uuid" : "");
        if (fija) clase += " xml-fija xml-fija--ultima";
        var txt = formato(c, v);
        var sello = SELLOS[c.clave] && SELLOS[c.clave][v];
        var html = sello ? '<span class="xml-sello xml-sello--' + sello + '">' + esc(txt) + "</span>" : esc(txt);
        return "<td" + (clase ? ' class="' + clase.trim() + '"' : "") + (fija ? ' style="left:36px"' : "") + (txt.length > 18 ? ' title="' + esc(txt) + '"' : "") + ">" + html + "</td>";
    }

    function visibles() {
        return E.columnas[E.modulo].map(function (x) {
            var c = colPorClave(x.clave);
            return c ? Object.assign({}, c, { ancho: x.ancho || anchoDefecto(c) }) : null;
        }).filter(Boolean);
    }

    function pintarTabla() {
        var cols = visibles();
        $("colgroup").innerHTML = '<col style="width:36px">' + cols.map(function (c) { return '<col style="width:' + c.ancho + 'px">'; }).join("");
        $("tabla").style.width = (36 + cols.reduce(function (s, c) { return s + c.ancho; }, 0)) + "px";

        var todasSel = E.filas.length > 0 && E.filas.every(function (f) { return E.seleccion.has(f.uuid); });
        $("thead").innerHTML = "<tr>" +
            '<th class="xml-check xml-fija" style="left:0"><input type="checkbox" id="sel-todas"' + (todasSel ? " checked" : "") + ' title="Seleccionar todo lo filtrado"></th>' +
            cols.map(function (c, i) {
                var orden = E.orden.clave === c.clave ? (E.orden.dir > 0 ? "▲" : "▼") : "";
                var fija = i === 0 ? " xml-fija xml-fija--ultima" : "";
                return '<th data-clave="' + esc(c.clave) + '" class="' + (c.tipo === "moneda" || c.tipo === "numero" ? "xml-num" : "") + fija + '"' +
                    (i === 0 ? ' style="left:36px"' : "") + ' title="' + esc(c.etiqueta + " · " + c.grupo) + '"><span class="xml-th-txt" draggable="true">' + esc(c.etiqueta) + "</span>" +
                    '<span class="xml-orden">' + orden + '</span><span class="xml-asa" data-asa="' + esc(c.clave) + '"></span></th>';
            }).join("") + "</tr>";

        // Totales de las columnas de importes (de lo filtrado)
        $("tfoot").innerHTML = E.filas.length ? "<tr>" + '<td class="xml-fija" style="left:0"></td>' + cols.map(function (c, i) {
            var fija = i === 0 ? ' class="xml-fija xml-fija--ultima" style="left:36px"' : (c.tipo === "moneda" ? ' class="xml-num"' : "");
            if (i === 0) return "<td" + fija + ">Total (" + contarUuid(E.filas) + ")</td>";
            if (c.tipo !== "moneda") return "<td></td>";
            var s = 0;
            for (var j = 0; j < E.filas.length; j++) s += E.filas[j][c.clave] || 0;
            return "<td" + fija + ">" + fmtMoneda.format(s) + "</td>";
        }).join("") + "</tr>" : "";

        $("sin-filas").hidden = E.filas.length > 0;
        $("conteo-filas").textContent = E.filas.length.toLocaleString("es-MX") + " registro(s)";
        pintarFilas(true);
        pintarSeleccion();
    }

    var ultimoInicio = -1;
    function pintarFilas(forzar) {
        var caja = $("tabla-caja");
        var alto = E.altoFila;
        var visiblesN = Math.ceil(caja.clientHeight / alto) + 1;
        var inicio = Math.max(0, Math.floor(caja.scrollTop / alto) - 15);
        if (!forzar && Math.abs(inicio - ultimoInicio) < 8) return;
        ultimoInicio = inicio;
        var fin = Math.min(E.filas.length, inicio + visiblesN + 30);
        var cols = visibles();
        var html = [];
        if (inicio > 0) html.push('<tr aria-hidden="true" style="height:' + (inicio * alto) + 'px"><td colspan="' + (cols.length + 1) + '" style="padding:0;border:0"></td></tr>');
        for (var i = inicio; i < fin; i++) {
            var f = E.filas[i];
            var sel = E.seleccion.has(f.uuid);
            html.push('<tr data-i="' + i + '"' + (sel ? ' class="xml-sel"' : "") + ">" +
                '<td class="xml-check xml-fija" style="left:0"><input type="checkbox" data-sel="' + i + '"' + (sel ? " checked" : "") + "></td>" +
                cols.map(function (c, j) { return celda(c, f, j === 0); }).join("") + "</tr>");
        }
        if (fin < E.filas.length) html.push('<tr aria-hidden="true" style="height:' + ((E.filas.length - fin) * alto) + 'px"><td colspan="' + (cols.length + 1) + '" style="padding:0;border:0"></td></tr>');
        $("tbody").innerHTML = html.join("");
        var muestra = $("tbody").querySelector("tr[data-i]");
        if (muestra && Math.abs(muestra.offsetHeight - E.altoFila) > 1) { E.altoFila = muestra.offsetHeight; }
    }

    function pintarSeleccion() {
        var n = E.seleccion.size;
        $("barra-seleccion").hidden = n === 0;
        $("texto-seleccion").textContent = n + " XML seleccionado" + (n === 1 ? "" : "s");
    }

    function abrirDetalle(f) {
        window.open("/herramientas/xml/detalle/?rfc=" + encodeURIComponent(E.rfc) + "&uuid=" + encodeURIComponent(f.uuid), "_blank", "noopener");
    }

    /* ============================================================ arrastrar y ancho de columnas */
    var arrastrada = null;
    function moverColumna(de, a, despues) {
        var lista = E.columnas[E.modulo];
        var i = lista.findIndex(function (c) { return c.clave === de; });
        if (i < 0 || de === a) return;
        var item = lista.splice(i, 1)[0];
        var j = lista.findIndex(function (c) { return c.clave === a; });
        lista.splice(despues ? j + 1 : j, 0, item);
        guardarColumnasLocal();
        pintarTabla();
        if (!$("panel-columnas").hidden) pintarPanelColumnas();
    }

    function prepararEncabezados() {
        var thead = $("thead");
        thead.addEventListener("dragstart", function (e) {
            if (!e.target.closest || !e.target.closest(".xml-th-txt")) return;
            var th = e.target.closest("th[data-clave]");
            if (!th) return;
            arrastrada = th.dataset.clave;
            th.classList.add("xml-arrastrando");
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", arrastrada);
        });
        thead.addEventListener("dragover", function (e) {
            var th = e.target.closest("th[data-clave]");
            if (!th || !arrastrada) return;
            e.preventDefault();
            thead.querySelectorAll(".xml-destino").forEach(function (x) { x.classList.remove("xml-destino"); });
            th.classList.add("xml-destino");
        });
        thead.addEventListener("drop", function (e) {
            var th = e.target.closest("th[data-clave]");
            if (!th || !arrastrada) return;
            e.preventDefault();
            var r = th.getBoundingClientRect();
            moverColumna(arrastrada, th.dataset.clave, e.clientX > r.left + r.width / 2);
            arrastrada = null;
        });
        thead.addEventListener("dragend", function () {
            arrastrada = null;
            thead.querySelectorAll(".xml-arrastrando,.xml-destino").forEach(function (x) { x.classList.remove("xml-arrastrando", "xml-destino"); });
        });
        thead.addEventListener("mousedown", function (e) {
            var asa = e.target.closest("[data-asa]");
            if (!asa) return;
            e.preventDefault(); e.stopPropagation();
            var clave = asa.dataset.asa;
            var th = asa.parentElement;
            var inicioX = e.clientX, anchoIni = th.getBoundingClientRect().width;
            var idx = Array.prototype.indexOf.call(th.parentElement.children, th);
            var col = $("colgroup").children[idx];
            function mover(ev) {
                var w = Math.max(60, Math.round(anchoIni + ev.clientX - inicioX));
                col.style.width = w + "px";
                $("tabla").style.width = Array.prototype.reduce.call($("colgroup").children, function (s, c) { return s + parseInt(c.style.width, 10); }, 0) + "px";
            }
            function soltar() {
                document.removeEventListener("mousemove", mover);
                document.removeEventListener("mouseup", soltar);
                var x = E.columnas[E.modulo].find(function (c) { return c.clave === clave; });
                if (x) x.ancho = parseInt(col.style.width, 10);
                guardarColumnasLocal();
            }
            document.addEventListener("mousemove", mover);
            document.addEventListener("mouseup", soltar);
        });
        thead.addEventListener("click", function (e) {
            if (e.target.closest("[data-asa]")) return;
            if (e.target.id === "sel-todas") {
                var marcar = e.target.checked;
                E.filas.forEach(function (f) { if (marcar) E.seleccion.add(f.uuid); else E.seleccion.delete(f.uuid); });
                pintarFilas(true); pintarSeleccion();
                return;
            }
            var th = e.target.closest("th[data-clave]");
            if (!th) return;
            var k = th.dataset.clave;
            E.orden = E.orden.clave === k ? { clave: k, dir: -E.orden.dir } : { clave: k, dir: 1 };
            aplicar();
        });
    }

    /* ============================================================ panel de columnas */
    function pintarPanelColumnas() {
        var q = $("buscar-columna").value.trim().toLowerCase();
        var vis = E.columnas[E.modulo];
        var visSet = new Set(vis.map(function (c) { return c.clave; }));
        $("lista-visibles").innerHTML = vis.map(function (x) {
            var c = colPorClave(x.clave);
            if (!c || (q && c.etiqueta.toLowerCase().indexOf(q) === -1)) return "";
            return '<li draggable="true" data-clave="' + esc(c.clave) + '"><span class="xml-agarre">⋮⋮</span>' + esc(c.etiqueta) +
                '<button type="button" data-ocultar="' + esc(c.clave) + '" title="Ocultar">×</button></li>';
        }).join("");
        var grupos = {};
        catalogo().forEach(function (c) {
            if (visSet.has(c.clave) || (q && (c.etiqueta + " " + c.grupo).toLowerCase().indexOf(q) === -1)) return;
            (grupos[c.grupo] = grupos[c.grupo] || []).push(c);
        });
        $("lista-disponibles").innerHTML = Object.keys(grupos).map(function (g) {
            return '<div class="xml-grupo">' + esc(g) + "</div>" + grupos[g].map(function (c) {
                return '<label class="xml-disp"><input type="checkbox" data-mostrar="' + esc(c.clave) + '"> ' + esc(c.etiqueta) + "</label>";
            }).join("");
        }).join("") || '<p class="xml-tenue" style="padding:10px">Ya están todas visibles.</p>';
    }

    function prepararPanelColumnas() {
        $("btn-columnas").addEventListener("click", function () { $("panel-columnas").hidden = false; pintarPanelColumnas(); });
        $("cerrar-columnas").addEventListener("click", function () { $("panel-columnas").hidden = true; });
        $("buscar-columna").addEventListener("input", pintarPanelColumnas);
        $("btn-fabrica").addEventListener("click", function () { aplicarVista(""); });
        $("lista-disponibles").addEventListener("change", function (e) {
            var k = e.target.dataset.mostrar;
            if (!k) return;
            E.columnas[E.modulo].push({ clave: k, ancho: 0 });
            guardarColumnasLocal(); pintarPanelColumnas(); pintarTabla();
        });
        var lista = $("lista-visibles"), arr = null;
        lista.addEventListener("click", function (e) {
            var k = e.target.dataset.ocultar;
            if (!k) return;
            if (E.columnas[E.modulo].length === 1) return;
            E.columnas[E.modulo] = E.columnas[E.modulo].filter(function (c) { return c.clave !== k; });
            guardarColumnasLocal(); pintarPanelColumnas(); pintarTabla();
        });
        lista.addEventListener("dragstart", function (e) { var li = e.target.closest("li"); if (li) { arr = li.dataset.clave; e.dataTransfer.setData("text/plain", arr); } });
        lista.addEventListener("dragover", function (e) {
            var li = e.target.closest("li"); if (!li || !arr) return;
            e.preventDefault();
            lista.querySelectorAll(".xml-destino").forEach(function (x) { x.classList.remove("xml-destino"); });
            li.classList.add("xml-destino");
        });
        lista.addEventListener("drop", function (e) {
            var li = e.target.closest("li"); if (!li || !arr) return;
            e.preventDefault();
            moverColumna(arr, li.dataset.clave, false);
            arr = null;
        });
    }

    /* ============================================================ acciones */
    async function exportarExcel(modo) {
        $("menu-excel").hidden = true;
        var r = rangoPeriodo();
        var cuerpo = { rfc: E.rfc, desde: r.desde, hasta: r.hasta, modo: modo };
        if (modo === "vista") {
            cuerpo.modulo = E.modulo;
            cuerpo.sub = E.sub || null;
            cuerpo.columnas = E.columnas[E.modulo].map(function (c) { return c.clave; });
            var filtrado = E.busqueda.trim() || Object.keys(E.rapidos).some(function (k) { return E.rapidos[k]; });
            cuerpo.uuids = filtrado ? Array.from(new Set(E.filas.map(function (f) { return f.uuid; }))) : null;
        }
        var boton = $("btn-excel");
        boton.disabled = true; boton.textContent = "Generando…";
        try {
            var resp = await postJSON("/api/xml/excel", cuerpo);
            descargarBlob(await resp.blob(), nombreArchivo(resp, "reporte.xlsx"));
        } catch (e) { avisar(e.message); }
        boton.disabled = false; boton.textContent = "Excel ▾";
    }

    async function descargarZip() {
        try {
            var resp = await postJSON("/api/xml/zip", { rfc: E.rfc, uuids: Array.from(E.seleccion) });
            descargarBlob(await resp.blob(), nombreArchivo(resp, "xml.zip"));
        } catch (e) { avisar(e.message); }
    }

    async function quitarSeleccion() {
        var n = E.seleccion.size;
        if (!confirm("¿Quitar " + n + " XML de la biblioteca de " + E.rfc + "?\n\nSe borran el archivo y su registro. Puedes volver a cargarlos después.")) return;
        try {
            await postJSON("/api/xml/quitar", { rfc: E.rfc, uuids: Array.from(E.seleccion) });
            E.seleccion.clear();
            await cargarContribuyentes(E.rfc);
        } catch (e) { avisar(e.message); }
    }

    /* ============================================================ carga de XML */
    var LIMITE_LOTE = 40 * 1024 * 1024, LIMITE_ARCHIVOS = 400, LIMITE_ZIP = 95 * 1024 * 1024;

    function leerEntrada(entrada, salida) {
        return new Promise(function (resolver) {
            if (entrada.isFile) {
                entrada.file(function (f) { salida.push(f); resolver(); }, function () { resolver(); });
            } else if (entrada.isDirectory) {
                var lector = entrada.createReader(), todas = [];
                (function leer() {
                    lector.readEntries(function (lote) {
                        if (!lote.length) { Promise.all(todas.map(function (x) { return leerEntrada(x, salida); })).then(resolver); return; }
                        todas = todas.concat(Array.prototype.slice.call(lote));
                        leer();
                    }, function () { resolver(); });
                })();
            } else resolver();
        });
    }

    async function subir(archivos) {
        var utiles = archivos.filter(function (f) { return /\.(xml|zip)$/i.test(f.name); });
        if (!utiles.length) { avisar("No encontré archivos XML ni ZIP en lo que elegiste."); return; }
        var grandes = utiles.filter(function (f) { return /\.zip$/i.test(f.name) && f.size > LIMITE_ZIP; });
        if (grandes.length) { avisar("El ZIP " + grandes[0].name + " pesa más de 95 MB. Divídelo en partes más chicas."); return; }
        // Lotes: cada ZIP va solo; los XML sueltos en grupos de hasta 40 MB / 400 archivos
        var lotes = [], actual = [], peso = 0;
        utiles.forEach(function (f) {
            if (/\.zip$/i.test(f.name)) { lotes.push([f]); return; }
            if (actual.length && (peso + f.size > LIMITE_LOTE || actual.length >= LIMITE_ARCHIVOS)) { lotes.push(actual); actual = []; peso = 0; }
            actual.push(f); peso += f.size;
        });
        if (actual.length) lotes.push(actual);

        var forzar = $("sel-forzar").value;
        var total = { nuevos: 0, duplicados: 0, encontrados: 0, rechazados: [], por: {} };
        $("progreso-carga").hidden = false;
        $("resultado-carga").innerHTML = "";
        $("btn-cargar").disabled = true;
        for (var i = 0; i < lotes.length; i++) {
            $("barra-carga").style.width = Math.round(100 * i / lotes.length) + "%";
            $("texto-carga").textContent = "Leyendo parte " + (i + 1) + " de " + lotes.length + "…";
            var fd = new FormData();
            lotes[i].forEach(function (f) { fd.append("archivos", f, f.webkitRelativePath ? f.name : f.name); });
            if (forzar) fd.append("rfc", forzar);
            try {
                var r = await apiJSON("/api/xml/cargar", { method: "POST", body: fd });
                total.nuevos += r.nuevos; total.duplicados += r.duplicados; total.encontrados += r.xml_encontrados;
                total.rechazados = total.rechazados.concat(r.rechazados);
                r.por_contribuyente.forEach(function (p) {
                    var x = total.por[p.rfc] = total.por[p.rfc] || { rfc: p.rfc, nombre: p.nombre, nuevos: 0, duplicados: 0 };
                    x.nuevos += p.nuevos; x.duplicados += p.duplicados;
                });
            } catch (e) {
                total.rechazados.push({ archivo: "Parte " + (i + 1), motivo: e.message });
            }
        }
        $("barra-carga").style.width = "100%";
        $("texto-carga").textContent = "Listo.";
        $("btn-cargar").disabled = false;
        var por = Object.keys(total.por).map(function (k) { return total.por[k]; }).sort(function (a, b) { return (b.nuevos + b.duplicados) - (a.nuevos + a.duplicados); });
        $("resultado-carga").innerHTML =
            '<div class="xml-resultado' + (total.nuevos ? "" : " xml-resultado--error") + '">' +
            "<strong>" + total.encontrados + " XML leídos · " + total.nuevos + " nuevos · " + total.duplicados + " ya estaban</strong>" +
            (por.length ? "<ul>" + por.map(function (p) {
                return "<li>" + esc((p.nombre || "") + " · " + p.rfc) + ": " + p.nuevos + " nuevos" + (p.duplicados ? ", " + p.duplicados + " ya estaban" : "") + "</li>";
            }).join("") + "</ul>" : "") +
            (total.rechazados.length ? "<p style=\"margin-top:8px\"><strong>No se cargaron " + total.rechazados.length + ":</strong></p><ul>" +
                total.rechazados.slice(0, 15).map(function (r) { return "<li>" + esc(r.archivo) + " — " + esc(r.motivo) + "</li>"; }).join("") +
                (total.rechazados.length > 15 ? "<li>… y " + (total.rechazados.length - 15) + " más</li>" : "") + "</ul>" : "") +
            "</div>";
        if (total.nuevos) await cargarContribuyentes(por.length ? por[0].rfc : null);
        setTimeout(function () { $("progreso-carga").hidden = true; }, 1500);
        // Si todo entró bien, la zona de carga se pliega sola para dejarle espacio a la tabla.
        if (total.nuevos && !total.rechazados.length) setTimeout(function () { $("panel-carga").hidden = true; }, 6000);
    }

    function prepararCarga() {
        $("btn-cargar").addEventListener("click", function () { $("panel-carga").hidden = !$("panel-carga").hidden; });
        $("in-archivos").addEventListener("change", function (e) { subir(Array.prototype.slice.call(e.target.files)); e.target.value = ""; });
        $("in-carpeta").addEventListener("change", function (e) { subir(Array.prototype.slice.call(e.target.files)); e.target.value = ""; });
        var zona = $("zona-carga");
        ["dragenter", "dragover"].forEach(function (t) { zona.addEventListener(t, function (e) { e.preventDefault(); zona.classList.add("xml-zona--encima"); }); });
        ["dragleave", "drop"].forEach(function (t) { zona.addEventListener(t, function () { zona.classList.remove("xml-zona--encima"); }); });
        zona.addEventListener("drop", async function (e) {
            e.preventDefault();
            var archivos = [];
            var items = e.dataTransfer.items;
            if (items && items.length && items[0].webkitGetAsEntry) {
                var entradas = Array.prototype.map.call(items, function (it) { return it.webkitGetAsEntry(); }).filter(Boolean);
                await Promise.all(entradas.map(function (en) { return leerEntrada(en, archivos); }));
            } else {
                archivos = Array.prototype.slice.call(e.dataTransfer.files);
            }
            subir(archivos);
        });
    }

    /* ============================================================ eventos */
    function prepararEventos() {
        $("sel-contribuyente").addEventListener("change", function () { E.modulo = "recibidos"; elegirContribuyente(this.value); });
        $("sel-periodo").addEventListener("change", cargarRegistros);
        $("pestanas").addEventListener("click", function (e) {
            var b = e.target.closest(".pestana");
            if (b && !b.disabled) cambiarModulo(b.dataset.modulo);
        });
        $("subfiltros").addEventListener("click", function (e) {
            var b = e.target.closest("[data-sub]");
            if (!b) return;
            E.sub = b.dataset.sub; pintarSubfiltros(); aplicar();
        });
        $("rapidos").addEventListener("click", function (e) {
            var b = e.target.closest("[data-rapido]");
            if (!b) return;
            E.rapidos[b.dataset.rapido] = !E.rapidos[b.dataset.rapido]; pintarRapidos(); aplicar();
        });
        var reloj = null;
        $("buscar").addEventListener("input", function () {
            clearTimeout(reloj);
            var v = this.value;
            reloj = setTimeout(function () { E.busqueda = v; aplicar(); }, 150);
        });
        $("sel-vista").addEventListener("change", function () { aplicarVista(this.value); });
        $("btn-guardar-vista").addEventListener("click", guardarVista);
        $("btn-excel").addEventListener("click", function (e) { e.stopPropagation(); $("menu-excel").hidden = !$("menu-excel").hidden; });
        document.addEventListener("click", function () { $("menu-excel").hidden = true; });
        $("menu-excel").addEventListener("click", function (e) { var b = e.target.closest("[data-excel]"); if (b) exportarExcel(b.dataset.excel); });
        $("btn-zip").addEventListener("click", descargarZip);
        $("btn-quitar").addEventListener("click", quitarSeleccion);
        $("btn-limpiar-sel").addEventListener("click", function () { E.seleccion.clear(); pintarFilas(true); pintarSeleccion(); pintarTabla(); });
        $("tabla-caja").addEventListener("scroll", function () { pintarFilas(false); }, { passive: true });
        window.addEventListener("resize", function () { pintarFilas(true); });
        $("tbody").addEventListener("click", function (e) {
            var chk = e.target.closest("[data-sel]");
            if (chk) {
                var f = E.filas[+chk.dataset.sel];
                if (chk.checked) E.seleccion.add(f.uuid); else E.seleccion.delete(f.uuid);
                chk.closest("tr").classList.toggle("xml-sel", chk.checked);
                pintarSeleccion();
                return;
            }
            if (e.target.closest(".xml-check")) return;
            var tr = e.target.closest("tr[data-i]");
            if (tr) abrirDetalle(E.filas[+tr.dataset.i]);
        });
        prepararEncabezados();
        prepararPanelColumnas();
    }
})();
