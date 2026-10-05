/**
 * conciliacion.js — Conciliación de facturas contra sus complementos de
 * pago y notas de crédito. Todo el cálculo lo hace el servidor
 * (modulos/conciliacion/motor.py, el mismo que usa Administración de XML);
 * aquí se piden los datos UNA vez por empresa, lado y periodo, y filtros,
 * orden y columnas pasan en el navegador.
 *
 * ¿Para quién? La empresa activa de la barra, o una conciliación rápida de
 * alguien sin registrar (sus XML se borran solos a los 7 días).
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    var fmt = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var fmtTc = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 4, maximumFractionDigits: 6 });

    var SELLO_ESTADO = { "Pagada": "verde", "Pagada (PUE)": "verde", "Cubierta con nota de crédito": "verde", "Pagada (ajuste manual)": "verde",
        "Parcial": "ambar", "Sin pago": "rojo", "Pagada de más": "rojo", "Pago a factura cancelada": "ambar", "Cancelada": "gris" };
    var ORDEN_ESTADOS = ["Pagada", "Pagada (PUE)", "Parcial", "Sin pago", "Pagada de más", "Pago a factura cancelada",
        "Cubierta con nota de crédito", "Pagada (ajuste manual)", "Cancelada"];
    var SELLOS = {
        estado_conciliacion: SELLO_ESTADO,
        estado_sat: { "Vigente": "verde", "Cancelado": "rojo", "Sin validar": "gris", "No encontrado": "ambar" }
    };
    var ANCHOS = { contraparte_nombre: 250, estado_conciliacion: 150, detalle_estado: 230, alertas: 260, conceptos: 280, serie_folio: 110,
        forma_pago: 200, uso_cfdi: 190, estado_sat: 100, ajuste_manual: 200 };

    var E = {
        perfil: null, empresa: null, contribuyentes: [], otras: [], rfc: null, otra: null, clientesLista: null,
        lado: leer("lado") || "emitidos", datos: null, regla: leer("regla") || "dof", movsPorFactura: {},
        estado: "", tarjeta: null, rapidos: {}, av: {}, busqueda: "", tablas: {}, filtradas: [], facturaAbierta: null
    };

    /* ============================================================ utilidades */
    function guardar(k, v) { try { localStorage.setItem("conc:" + k, JSON.stringify(v)); } catch (e) { /* nada */ } }
    function leer(k) { try { return JSON.parse(localStorage.getItem("conc:" + k)); } catch (e) { return null; } }
    function avisar(t) { if (Fiscontable.aviso) Fiscontable.aviso(t); else alert(t); }
    function dinero(v) { return v === null || v === undefined || v === "" ? "" : fmt.format(v); }
    function fechaMX(v) { var s = String(v || ""); return s.length >= 10 ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : s; }
    function textoLado(emitidos, recibidos) { return E.lado === "emitidos" ? emitidos : recibidos; }

    async function api(ruta, opciones) {
        var resp;
        try { resp = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {})); }
        catch (e) { throw new Error("No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo."); }
        if (!resp.ok) throw new Error(await Fiscontable.leerError(resp));
        return resp;
    }
    async function apiJSON(ruta, opciones) { return (await api(ruta, opciones)).json(); }
    function enviar(ruta, cuerpo, metodo) {
        return api(ruta, { method: metodo || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    }
    function descargarBlob(blob, nombre) {
        var url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }
    function puede(modulo) { return !!(E.perfil && (E.perfil.modulos_permitidos || []).indexOf(modulo) !== -1); }

    /* ============================================================ arranque */
    document.addEventListener("DOMContentLoaded", iniciar);
    var bandeja;

    async function iniciar() {
        if (!(await Fiscontable.exigirModulo("conciliacion"))) return;
        E.perfil = await Fiscontable.perfil();
        var q = new URLSearchParams(location.search);
        if (q.get("lado") === "emitidos" || q.get("lado") === "recibidos") E.lado = q.get("lado");
        if (q.get("base") === "pago" || q.get("base") === "emision") $("sel-base").value = q.get("base");
        else if (leer("base") === "pago" || leer("base") === "emision") $("sel-base").value = leer("base");
        // Periodo que llega en el enlace: meses sueltos (?anio=&meses=) o fechas (?desde=&hasta=)
        if (q.get("anio")) E.urlPeriodo = { anio: q.get("anio"), meses: (q.get("meses") || "").split(",").filter(function (m) { return /^\d\d$/.test(m); }) };
        else if (q.get("desde") || q.get("hasta")) E.urlPeriodo = { desde: q.get("desde") || "", hasta: q.get("hasta") || "" };
        else E.urlPeriodo = null;

        bandeja = FCBandeja.crear({
            seccion: $("bandeja"), resultado: $("resultado-carga"), endpoint: "/api/conciliacion/cargar",
            destinoPreferido: function () { return E.rfc; },
            alTerminar: async function (destino) { await refrescarBibliotecas(destino); }
        });
        prepararTablas();
        prepararEventos();
        E.empresa = await Fiscontable.empresaActiva();
        E.periodoGeneral = await Fiscontable.periodoActivo();
        // Periodo de ESTA página (cuadros como en Administración de XML): arranca en el general;
        // cambiarlo aquí no mueve el general.
        E.selPeriodo = FCPeriodoMeses.crear({ contenedor: $("periodo-conc"), alCambiar: function () { cargarDatos(); } });
        $("btn-ir-xml").hidden = !puede("validador");
        await refrescarBibliotecas(q.get("rfc"));
        window.addEventListener("fiscontable:empresa", async function (ev) {
            E.empresa = ev.detail; E.otra = null; E.rfc = null;
            await refrescarBibliotecas();
        });
        window.addEventListener("fiscontable:periodo", function (ev) {
            E.periodoGeneral = ev.detail;
            if (!E.rfc || !ev.detail) return;
            E.selPeriodo.poner({ anio: ev.detail.slice(0, 4), meses: [ev.detail.slice(5, 7)] });
            cargarDatos();
        });
    }

    /* ============================================================ tablas (una por lado) */
    function prepararTablas() {
        ["emitidos", "recibidos"].forEach(function (lado) {
            var caja = document.createElement("div");
            caja.className = "xml-tabla-caja";
            caja.hidden = lado !== E.lado;
            $("tablas").appendChild(caja);
            E.tablas[lado] = { caja: caja, tabla: null };
        });
        E.menuVistas = FCTabla.menuVistas({
            menu: $("menu-vistas"), etiqueta: $("nombre-vista"),
            tabla: {
                vistaActual: function () { return tabla() ? tabla().vistaActual() : ""; },
                columnas: function () { return tabla().columnas(); },
                aplicarVista: function (v) { tabla().aplicarVista(v); },
                marcarVista: function (n) { tabla().marcarVista(n); }
            },
            listar: async function () {
                var todas = await apiJSON("/api/conciliacion/vistas");
                return todas.filter(function (v) { return v.lado === E.lado; });
            },
            guardar: function (nombre, pred, cols) {
                return enviar("/api/conciliacion/vistas", { lado: E.lado, nombre: nombre, columnas: cols, predeterminada: !!pred }, "PUT");
            },
            borrar: function (v) { return api("/api/conciliacion/vistas/" + v.id, { method: "DELETE" }); }
        });
    }

    function tabla() { return E.tablas[E.lado].tabla; }

    async function asegurarTabla() {
        var t = E.tablas[E.lado];
        await E.menuVistas.recargar();
        if (!t.tabla) {
            t.tabla = FCTabla.crear({
                caja: t.caja, id: "conc-" + E.lado, catalogo: E.datos.columnas, predeterminadas: E.datos.predeterminadas,
                sellos: SELLOS, anchoClave: ANCHOS, claveFila: "uuid",
                claseFila: function (f) { return f.estado_conciliacion === "Cancelada" ? "fila-cancelada" : ""; },
                alClic: abrirFactura,
                alSeleccionar: pintarSeleccion,
                alCambiarColumnas: function () { E.menuVistas.pintar(); }
            });
            t.tabla.iniciarColumnas(E.menuVistas.predeterminada());
            E.menuVistas.pintar();
        }
        Object.keys(E.tablas).forEach(function (l) { E.tablas[l].caja.hidden = l !== E.lado; });
    }

    /* ============================================================ empresas */
    function nombreDe(rfc) {
        if (E.empresa && E.empresa.rfc === rfc) return E.empresa.alias || rfc;
        var c = E.contribuyentes.find(function (x) { return x.rfc === rfc; });
        return (c && c.nombre) || rfc;
    }

    async function refrescarBibliotecas(rfcPreferido) {
        try { E.contribuyentes = await apiJSON("/api/conciliacion/contribuyentes"); } catch (e) { avisar(e.message); return; }
        E.otras = E.contribuyentes.filter(function (c) { return !c.registrado; });
        var activa = E.empresa ? E.empresa.rfc : null;
        var rfc = rfcPreferido || E.rfc || activa;
        if (rfc && rfc !== activa && !E.contribuyentes.some(function (c) { return c.rfc === rfc; })) rfc = activa;
        E.otra = rfc && rfc !== activa ? rfc : null;
        E.rfc = rfc;
        pintarEncabezado();
        var c = rfc && E.contribuyentes.find(function (x) { return x.rfc === rfc; });
        if (!c) { mostrarVacio(); return; }
        armarPeriodos(c);
        await cargarDatos();
        reanudarValidacion();
    }

    function pintarEncabezado() {
        var reg = E.otra && (E.contribuyentes.find(function (c) { return c.rfc === E.otra; }) || {}).registrado;
        var boton = $("btn-otra");
        var rfc = E.otra || (E.empresa && E.empresa.rfc);
        $("empresa-etiqueta").textContent = rfc ? "Empresa · " + rfc : "Empresa";
        $("empresa-titulo").innerHTML = E.otra ? esc(nombreDe(E.otra)) + (reg ? "" : '<span class="ctx-marca">sin registrar</span>')
            : E.empresa ? esc(E.empresa.alias || E.empresa.rfc) : "Elegir empresa";
        boton.classList.toggle("ctx-campo--vacio", !rfc);
        var aviso = $("aviso-otra");
        aviso.hidden = !E.otra;
        if (E.otra) {
            aviso.innerHTML = (reg ? "Estás viendo <strong>" + esc(nombreDe(E.otra)) + "</strong>, que no es tu empresa activa."
                : "<strong>" + esc(nombreDe(E.otra)) + "</strong> no está en tu directorio: sus XML se borran solos 7 días después de la última carga." +
                  ' <a class="xml-enlace" href="/clientes/">Registrarla como cliente</a>') +
                (E.empresa ? ' <button type="button" class="xml-enlace" id="volver-empresa">Volver a ' + esc(E.empresa.alias || E.empresa.rfc) + "</button>" : "");
        }
    }

    function mostrarVacio() {
        $("contenido").hidden = true;
        $("ayuda-base").hidden = true;
        var caja = $("sin-empresa");
        caja.hidden = false;
        if (E.empresa) {
            caja.innerHTML = '<p class="ctx-vacio__titulo">' + esc(E.empresa.alias || E.empresa.rfc) + " todavía no tiene XML</p>" +
                "<p>Agrega sus facturas, complementos de pago y notas de crédito (o el ZIP de la descarga masiva del SAT). " +
                "Son los mismos XML de Administración de XML: lo que cargues aquí, allá también aparece.</p>" +
                '<div class="ctx-vacio__acciones"><button type="button" class="xml-btn xml-btn--primario" data-agregar>+ Agregar XML</button></div>';
        } else {
            caja.innerHTML = '<p class="ctx-vacio__titulo">¿De quién es la conciliación?</p>' +
                "<p>Elige una de tus empresas, o trabaja sin registrar: agrega los XML y el portal detecta solo de quién son. " +
                "Lo que cargues sin registrar se borra a los 7 días.</p>" +
                '<div class="ctx-vacio__acciones"><button type="button" class="xml-btn xml-btn--primario" data-elegir>Elegir empresa</button>' +
                '<button type="button" class="xml-btn" data-agregar>Trabajar sin registrar</button></div>';
        }
    }

    async function pintarMenuOtra() {
        var menu = $("menu-otra");
        if (E.clientesLista === null) {
            menu.innerHTML = '<p class="xml-otra__nota">Cargando…</p>';
            try { E.clientesLista = await apiJSON("/api/clientes"); } catch (e) { E.clientesLista = []; }
        }
        var activa = E.empresa ? E.empresa.rfc : null;
        var h = ['<div class="xml-otra__grupo">Tus empresas</div>'];
        if (!E.clientesLista.length) h.push('<p class="xml-otra__nota">Todavía no tienes empresas registradas.</p>');
        E.clientesLista.forEach(function (c) {
            h.push('<button type="button" data-empresa="' + esc(c.rfc) + '"' + (c.rfc === E.rfc ? ' class="xml-activa"' : "") + ">" + esc(c.alias) +
                " <span>" + esc(c.rfc) + (c.rfc === activa ? " · empresa activa" : "") + "</span></button>");
        });
        h.push('<div class="xml-separador"></div><div class="xml-otra__grupo">Sin registrar · se borran a los 7 días</div>');
        E.otras.forEach(function (c) {
            var dia = c.expira ? c.expira.slice(8, 10) + "/" + c.expira.slice(5, 7) : "";
            h.push('<div class="xml-otra__fila"><button type="button" data-otra="' + esc(c.rfc) + '"' + (c.rfc === E.rfc ? ' class="xml-activa"' : "") + ">" +
                esc(c.nombre || "Sin nombre") + " <span>" + esc(c.rfc) + (dia ? " · se borra el " + dia : "") + "</span></button>" +
                '<button type="button" class="xml-otra__borrar" data-borrar="' + esc(c.rfc) + '">Borrar</button></div>');
        });
        h.push('<button type="button" data-nuevo>+ Trabajar sin registrar <span>Agrega XML de alguien que no está en tu directorio</span></button>');
        h.push('<div class="xml-separador"></div><button type="button" data-ir="/clientes/">+ Registrar empresa <span>Para conservar sus XML sin límite de tiempo</span></button>');
        menu.innerHTML = h.join("");
    }

    async function accionMenuOtra(b) {
        $("menu-otra").hidden = true;
        if (b.dataset.ir) { location.href = b.dataset.ir; return; }
        if (b.hasAttribute("data-nuevo")) { bandeja.abrir(); return; }
        if (b.dataset.otra) { refrescarBibliotecas(b.dataset.otra); return; }
        if (b.dataset.empresa) {
            if (E.empresa && E.empresa.rfc === b.dataset.empresa) { E.otra = null; E.rfc = null; refrescarBibliotecas(); }
            else await Fiscontable.elegirEmpresa(b.dataset.empresa);
            return;
        }
        if (b.dataset.borrar) {
            var rfc = b.dataset.borrar;
            if (!confirm("¿Borrar ya todos los XML de " + nombreDe(rfc) + " (" + rfc + ")?\n\nNo está en tu directorio; no quedará registro.")) return;
            try {
                await enviar("/api/conciliacion/borrar-biblioteca", { rfc: rfc });
                if (E.rfc === rfc) { E.rfc = null; E.otra = null; }
                await refrescarBibliotecas();
            } catch (e) { avisar(e.message); }
        }
    }

    /* ============================================================ periodo */
    function armarPeriodos(c) {
        var conteos = {};
        (c.periodos || []).forEach(function (p) { conteos[p.periodo] = p.n; });
        E.selPeriodo.conteos(conteos);
        // Orden de prioridad: el enlace (p. ej. desde Administración de XML), luego el periodo
        // general. Sin ninguno, no se carga nada hasta elegir.
        if (E.urlPeriodo) { E.selPeriodo.poner(E.urlPeriodo); E.urlPeriodo = null; }
        else if (E.periodoGeneral) E.selPeriodo.poner({ anio: E.periodoGeneral.slice(0, 4), meses: [E.periodoGeneral.slice(5, 7)] });
        else E.selPeriodo.poner(null);
    }

    function rango() { return E.selPeriodo.rango(); }

    /* Meses sueltos (enero y marzo): el servidor necesita la lista; si van seguidos basta el rango. */
    function mesesSueltos() { var m = E.selPeriodo.meses(); return m && !E.selPeriodo.seguidos() ? m : null; }

    /* ============================================================ datos */
    async function cargarDatos() {
        if (!E.rfc) return;
        pintarBase();
        $("sin-empresa").hidden = true;
        $("contenido").hidden = false;
        var hay = E.selPeriodo.hayEleccion();
        $("elige-periodo").hidden = hay;
        $("cuerpo-conc").hidden = !hay;
        $("ayuda-base").hidden = !hay;
        if (!hay) { E.datos = null; return; }
        guardar("lado", E.lado); guardar("base", $("sel-base").value);
        var r = rango();
        var sueltos = mesesSueltos();
        var comun = "?rfc=" + encodeURIComponent(E.rfc) + "&lado=" + E.lado + "&base=" + $("sel-base").value +
            (r.desde ? "&desde=" + r.desde : "") + (r.hasta ? "&hasta=" + r.hasta : "") + (sueltos ? "&meses=" + sueltos.join(",") : "");
        // En la dirección queda el periodo tal como se eligió (cuadros o fechas), para recargar igual
        var est = E.selPeriodo.estado(), url = new URLSearchParams({ rfc: E.rfc, lado: E.lado, base: $("sel-base").value });
        if (E.selPeriodo.porFechas()) { if (est.desde) url.set("desde", est.desde); if (est.hasta) url.set("hasta", est.hasta); }
        else { url.set("anio", est.anio); url.set("meses", est.meses.join(",")); }
        history.replaceState(null, "", location.pathname + "?" + url.toString());
        $("conteo-filas").textContent = "Calculando…";
        document.querySelectorAll("#lados .conc-lado").forEach(function (b) { b.classList.toggle("conc-lado--activo", b.dataset.lado === E.lado); });
        var datos;
        try { datos = await apiJSON("/api/conciliacion/datos" + comun + "&regla=" + E.regla); }
        catch (e) { avisar(e.message); $("conteo-filas").textContent = ""; return; }
        if (datos.lado !== E.lado || datos.rfc !== E.rfc) return;          // llegó tarde: ya cambiaste de lado o empresa
        E.datos = datos;
        E.movsPorFactura = {};
        E.datos.movimientos.forEach(function (m) { (E.movsPorFactura[m.uuid_factura] = E.movsPorFactura[m.uuid_factura] || []).push(m); });
        await asegurarTabla();
        pintarAvisoValidar();
        pintarTarjetas();
        pintarChipsEstado();
        pintarRapidos();
        aplicar();
        if (!$("panel-tc").hidden) pintarPanelTC();
        if (!$("panel-factura").hidden && E.facturaAbierta) {
            var f = E.datos.facturas.find(function (x) { return x.uuid === E.facturaAbierta; });
            if (f) abrirFactura(f); else $("panel-factura").hidden = true;
        }
    }

    function pintarAvisoValidar() {
        var n = E.datos.sin_validar.length, caja = $("aviso-validar");
        caja.hidden = !n;
        if (!n) return;
        caja.innerHTML = "<span><strong>" + n.toLocaleString("es-MX") + " comprobante(s)</strong> de este lado (facturas, pagos y notas) no se han validado ante el SAT. " +
            "Si alguno está cancelado, el resultado cambia.</span>" +
            '<button type="button" class="xml-btn" id="validar-faltan">Validar los que faltan</button>';
    }

    /* "Lo facturado | Lo cobrado": cambia qué facturas entran al periodo.
       (El análisis a detalle del flujo de efectivo irá en el módulo de IVA cobrado.) */
    function pintarBase() {
        var base = $("sel-base").value;
        document.querySelectorAll("#base [data-base]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.base === base)); });
        $("base-pago").textContent = textoLado("Lo cobrado", "Lo pagado");
        // Una línea corta; la explicación queda al pasar el mouse
        $("ayuda-base").textContent = base === "pago" ? textoLado("Lo cobrado", "Lo pagado") + " en el periodo, de cualquier mes de factura."
            : "Facturas del periodo con todos sus pagos.";
        $("ayuda-base").title = base === "pago" ? "¿Cuánto dinero " + textoLado("entró", "salió") + "?" : "¿Cómo quedó lo que se facturó?";
    }

    function pintarTarjetas() {
        var fs = E.datos.facturas, vivas = fs.filter(function (f) { return f.estado_conciliacion !== "Cancelada"; });
        function suma(k, lista) { return lista.reduce(function (s, f) { return s + (f[k] || 0); }, 0); }
        var abiertas = vivas.filter(function (f) { return ["Parcial", "Sin pago", "Pago a factura cancelada"].indexOf(f.estado_conciliacion) !== -1; });
        var canceladas = fs.length - vivas.length;
        if (!fs.length) { $("tarjetas").innerHTML = ""; return; }
        var saldo = suma("saldo_mxn", abiertas);
        $("tarjetas").innerHTML =
            '<div class="ctx-resumen__dato"><small>Total en pesos</small><b>$' + dinero(suma("total_mxn", vivas)) + "</b></div>" +
            '<div class="ctx-resumen__dato"><small>' + textoLado("Cobrado", "Pagado") + " en pesos</small><b>$" + dinero(suma("pagado_mxn", vivas)) + "</b></div>" +
            '<button type="button" data-tarjeta="saldo" title="Clic para ver solo las que tienen saldo" class="ctx-resumen__dato' +
                (abiertas.length ? " ctx-resumen__dato--alerta" : "") + (E.tarjeta === "saldo" ? " ctx-resumen__dato--activo" : "") + '">' +
                "<small>" + textoLado("Por cobrar", "Por pagar") + "</small><b>$" + dinero(saldo) + "</b>" +
                "<span>" + (abiertas.length ? abiertas.length + " factura" + (abiertas.length === 1 ? "" : "s") + " con saldo" : "todo " + textoLado("cobrado", "pagado")) + "</span></button>" +
            (canceladas ? '<div class="ctx-resumen__nota">' + canceladas + " cancelada" + (canceladas === 1 ? "" : "s") + " en el SAT · no cuenta" + (canceladas === 1 ? "" : "n") + "</div>" : "");
    }

    function nombreEstado(e) { return e; }

    function pintarChipsEstado() {
        var cuenta = {};
        E.datos.facturas.forEach(function (f) { cuenta[f.estado_conciliacion] = (cuenta[f.estado_conciliacion] || 0) + 1; });
        if (E.estado && !cuenta[E.estado]) E.estado = "";
        var h = ['<button type="button" class="xml-chip' + (!E.estado ? " xml-chip--activo" : "") + '" data-estado="">Todas<span>' + E.datos.facturas.length + "</span></button>"];
        ORDEN_ESTADOS.forEach(function (e) {
            if (cuenta[e]) h.push('<button type="button" class="xml-chip' + (E.estado === e ? " xml-chip--activo" : "") + '" data-estado="' + esc(e) + '">' +
                esc(nombreEstado(e)) + "<span>" + cuenta[e] + "</span></button>");
        });
        $("chips-estado").innerHTML = h.join("");
    }

    /* ============================================================ filtros */
    var RAPIDOS = [["alertas", "Con alertas"], ["ppd", "PPD"], ["pue", "PUE"], ["saldo", "Con saldo"], ["extranjera", "Moneda extranjera"],
        ["notas", "Con notas de crédito"], ["sinvalidar", "Sin validar"], ["ajuste", "Con ajuste manual"]];
    var PRUEBA = {
        alertas: function (f) { return !!f.alertas; },
        ppd: function (f) { return f.metodo_pago === "PPD"; },
        pue: function (f) { return f.metodo_pago === "PUE"; },
        saldo: function (f) { return ["Parcial", "Sin pago", "Pago a factura cancelada"].indexOf(f.estado_conciliacion) !== -1; },
        extranjera: function (f) { return !!f.moneda && f.moneda !== "MXN"; },
        notas: function (f) { return !!f.num_notas; },
        sinvalidar: function (f) { return (f.estado_sat || "Sin validar") === "Sin validar"; },
        ajuste: function (f) { return !!f.ajuste_manual; },
        demas: function (f) { return f.estado_conciliacion === "Pagada de más"; }
    };
    var CAMPOS_AV = {
        contraparte: { etiqueta: function () { return textoLado("Cliente", "Proveedor"); }, valor: function (f) { return f.contraparte_nombre; } },
        moneda: { etiqueta: function () { return "Moneda"; }, valor: function (f) { return f.moneda; } },
        sat: { etiqueta: function () { return "Estado SAT"; }, valor: function (f) { return f.estado_sat || "Sin validar"; } },
        forma: { etiqueta: function () { return "Forma de pago"; }, valor: function (f) { return f.forma_pago; } }
    };

    function pintarRapidos() {
        $("rapidos").innerHTML = RAPIDOS.map(function (r) {
            return '<button type="button" class="xml-chip' + (E.rapidos[r[0]] ? " xml-chip--activo" : "") + '" data-rapido="' + r[0] + '">' + r[1] + "</button>";
        }).join("");
        var n = Object.keys(E.rapidos).filter(function (k) { return E.rapidos[k]; }).length +
            Object.keys(E.av).filter(function (k) { return E.av[k]; }).length;
        $("cuenta-filtros").hidden = !n; $("cuenta-filtros").textContent = n;
        $("btn-filtros").classList.toggle("xml-btn--activo", n > 0);
    }

    function pintarAvanzados() {
        var fs = E.datos ? E.datos.facturas : [];
        var h = ['<label>Total desde<input type="number" step="0.01" data-av="min" placeholder="0.00" value="' + esc(E.av.min || "") + '"></label>',
                 '<label>hasta<input type="number" step="0.01" data-av="max" placeholder="sin tope" value="' + esc(E.av.max || "") + '"></label>',
                 '<label>Días con saldo, más de<input type="number" step="1" data-av="dias" placeholder="0" value="' + esc(E.av.dias || "") + '"></label>'];
        Object.keys(CAMPOS_AV).forEach(function (k) {
            var c = CAMPOS_AV[k], valores = {};
            fs.forEach(function (f) { var v = c.valor(f); if (v) valores[v] = 1; });
            var lista = Object.keys(valores).sort(function (a, b) { return a.localeCompare(b, "es"); });
            if (lista.length < 2 && !E.av[k]) return;
            h.push("<label>" + esc(c.etiqueta()) + '<select data-av="' + k + '"><option value="">Todos</option>' +
                lista.map(function (v) { return '<option value="' + esc(v) + '"' + (E.av[k] === v ? " selected" : "") + ">" + esc(v) + "</option>"; }).join("") + "</select></label>");
        });
        $("avanzados").innerHTML = h.join("");
    }

    function textoBusqueda(f) {
        if (f._q === undefined) f._q = [f.uuid, f.serie_folio, f.contraparte_rfc, f.contraparte_nombre, f.conceptos].filter(Boolean).join(" ").toLowerCase();
        return f._q;
    }

    function aplicar() {
        if (!E.datos || !tabla()) return;
        var q = E.busqueda.trim().toLowerCase(), av = E.av;
        var activos = Object.keys(E.rapidos).filter(function (k) { return E.rapidos[k]; });
        if (E.tarjeta) activos.push(E.tarjeta);
        var min = av.min ? +av.min : null, max = av.max ? +av.max : null, dias = av.dias ? +av.dias : null;
        E.filtradas = E.datos.facturas.filter(function (f) {
            if (E.estado && f.estado_conciliacion !== E.estado) return false;
            for (var i = 0; i < activos.length; i++) if (!PRUEBA[activos[i]](f)) return false;
            if (min !== null && (f.total || 0) < min) return false;
            if (max !== null && (f.total || 0) > max) return false;
            if (dias !== null && !((f.dias_saldo || 0) > dias)) return false;
            for (var k in CAMPOS_AV) if (av[k] && CAMPOS_AV[k].valor(f) !== av[k]) return false;
            return !q || textoBusqueda(f).indexOf(q) !== -1;
        });
        tabla().ponerFilas(E.filtradas);
        var total = E.datos.facturas.length;
        $("conteo-filas").textContent = !total
            ? "No hay facturas " + textoLado("emitidas", "recibidas") + " en este periodo (puede haber solo complementos de pago). Prueba otro periodo o «Según fecha de pago»"
            : E.filtradas.length.toLocaleString("es-MX") + (E.filtradas.length !== total ? " de " + total.toLocaleString("es-MX") : "") + " factura(s)";
        pintarAlcance();
    }

    /* Las acciones de la derecha usan lo seleccionado; si no hay selección, lo que ves. */
    function pintarAlcance() {
        var sel = tabla() ? tabla().seleccion.size : 0, n = sel || (E.filtradas || []).length;
        $("acciones-alcance").textContent = !n ? "No hay facturas en la tabla."
            : sel ? "Sobre las " + n.toLocaleString("es-MX") + " seleccionadas." : "Sobre las " + n.toLocaleString("es-MX") + " facturas que ves.";
        if (!n || $("avance-validacion").hidden) $("btn-validar").disabled = !n;    // mientras valida, sigue apagado
    }

    function hayFiltros() {
        return !!(E.estado || E.tarjeta || E.busqueda.trim() || Object.keys(E.rapidos).some(function (k) { return E.rapidos[k]; }) ||
            Object.keys(E.av).some(function (k) { return E.av[k]; }));
    }

    function pintarSeleccion(sel) {
        var n = sel.size;
        $("barra-seleccion").hidden = n === 0;
        $("texto-seleccion").textContent = n + " factura" + (n === 1 ? "" : "s") + " seleccionada" + (n === 1 ? "" : "s");
        pintarAlcance();
    }

    /* ============================================================ detalle de una factura */
    function sello(texto, color) { return '<span class="xml-sello xml-sello--' + (color || "gris") + '">' + esc(texto) + "</span>"; }

    function abrirFactura(f) {
        E.facturaAbierta = f.uuid;
        var p = $("panel-factura");
        var movs = (E.movsPorFactura[f.uuid] || []).slice().sort(function (a, b) {
            return (a.fecha || "").localeCompare(b.fecha || "") || (a.parcialidad || 0) - (b.parcialidad || 0);
        });
        var previos = [];
        (f.sustituye_a || "").split(", ").filter(Boolean).forEach(function (u) { previos = previos.concat(E.movsPorFactura[u] || []); });
        var mon = f.moneda || "MXN";
        var h = [];
        var verFactura = puede("validador") ? '<a class="xml-btn" target="_blank" rel="noopener" href="/herramientas/xml/detalle/?rfc=' +
            encodeURIComponent(E.rfc) + "&uuid=" + encodeURIComponent(f.uuid) + '">Ver factura</a>' : "";
        h.push('<div class="xml-panel__cabeza"><h3>Factura ' + esc(f.serie_folio || f.uuid.slice(0, 8)) + '</h3>' +
            '<div class="conc-cabeza-acciones">' + verFactura + '<button type="button" class="xml-enlace" data-cerrar>Cerrar</button></div></div>');
        h.push('<p class="conc-sub">' + esc(f.contraparte_nombre || "") + " · " + esc(f.contraparte_rfc || "") + "</p>");
        h.push("<div>" + sello(nombreEstado(f.estado_conciliacion), SELLO_ESTADO[f.estado_conciliacion]) + " " +
            sello("SAT: " + (f.estado_sat || "Sin validar"), SELLOS.estado_sat[f.estado_sat || "Sin validar"]) + " " + sello(f.metodo_pago || "", "gris") +
            (f.detalle_estado ? ' <span class="conc-sub">' + esc(f.detalle_estado) + "</span>" : "") + "</div>");
        h.push('<div class="conc-cifras">' +
            "<div><small>Total</small><b>" + dinero(f.total) + " " + esc(mon) + "</b></div>" +
            "<div><small>" + textoLado("Cobrado", "Pagado") + "</small><b>" + dinero(f.pagado) + "</b></div>" +
            "<div><small>Notas de crédito</small><b>" + dinero(f.notas || 0) + "</b></div>" +
            "<div><small>" + textoLado("Por cobrar", "Por pagar") + '</small><b class="' + ((f.saldo || 0) < -0.005 ? "fc-negativo" : "") + '">' + dinero(f.saldo) + "</b></div></div>");
        function tablaMovs(lista) {
            if (!lista.length) return '<p class="conc-sub">' + (f.metodo_pago === "PUE" ? "Es PUE: se considera pagada al emitirse." : "No hay complementos de pago ni notas de crédito cargados para esta factura.") + "</p>";
            return '<div class="conc-scroll"><table class="conc-mini"><thead><tr><th>Fecha</th><th>Tipo</th><th>Comprobante</th><th class="num">Parc.</th>' +
                '<th class="num">Saldo antes</th><th class="num">Importe</th><th class="num">Saldo después</th><th class="num">En pesos</th><th>SAT</th></tr></thead><tbody>' +
                lista.map(function (m) {
                    var extra = m.moneda_pago && m.moneda_pago !== mon ? " (" + esc(m.moneda_pago) + ")" : "";
                    return "<tr" + (m.cancelado ? ' class="conc-mov-cancelado"' : "") + "><td>" + esc(fechaMX(m.fecha)) + "</td><td>" +
                        esc(m.tipo_fila + (m.relacion && m.relacion !== "Nota de crédito" ? " · " + m.relacion : "")) + extra + "</td>" +
                        "<td>" + esc(m.serie_folio_mov || (m.uuid_mov || "").slice(0, 8)) + '</td><td class="num">' + esc(m.parcialidad || "") + "</td>" +
                        '<td class="num">' + dinero(m.saldo_anterior) + '</td><td class="num"><strong>' + dinero(m.importe) + '</strong></td><td class="num">' + dinero(m.saldo_insoluto) + "</td>" +
                        '<td class="num">' + dinero(m.importe_mxn) + "</td>" +
                        (m.cancelado ? '<td class="conc-nota-cancelado">Cancelado · no cuenta</td>' : "<td>" + esc(m.estado_sat || "") + "</td>") + "</tr>";
                }).join("") + "</tbody></table></div>";
        }
        h.push("<h4>Pagos y notas de crédito</h4>" + tablaMovs(movs));
        if (previos.length) h.push("<h4>Aplicados a la factura que esta sustituye</h4>" + tablaMovs(previos));

        if (f.alertas) h.push('<ul class="conc-alertas">' + f.alertas.split("; ").map(function (a) { return "<li>⚠ " + esc(a) + "</li>"; }).join("") + "</ul>");
        h.push('<dl class="conc-datos">' +
            "<dt>Emitida el</dt><dd>" + esc(fechaMX(f.fecha_emision)) + "</dd>" +
            (mon !== "MXN" ? "<dt>Tipo de cambio</dt><dd>" + esc(f.tipo_cambio ? fmtTc.format(f.tipo_cambio) : "—") +
                (f.tc_banxico_emision ? " · Banxico " + esc(fmtTc.format(f.tc_banxico_emision)) + " (FIX del " + esc(fechaMX(f.fecha_fix_emision)) + ")" : "") + "</dd>" : "") +
            "<dt>" + textoLado("Cobrado", "Pagado") + " en pesos</dt><dd>$" + dinero(f.pagado_mxn) + (f.fluctuacion_mxn ? " · fluctuación cambiaria $" + dinero(f.fluctuacion_mxn) : "") + "</dd>" +
            (f.ajuste_manual ? "<dt>Ajuste manual</dt><dd>" + esc(f.ajuste_manual) + "</dd>" : "") +
            (f.sustituye_a ? "<dt>Sustituye a</dt><dd>" + esc(f.sustituye_a) + "</dd>" : "") +
            (f.sustituida_por ? "<dt>La sustituye</dt><dd>" + esc(f.sustituida_por) + "</dd>" : "") +
            "<dt>UUID</dt><dd>" + esc(f.uuid) + "</dd></dl>");

        var acciones = [];
        if (f.estado_conciliacion !== "Cancelada" && f.metodo_pago !== "PUE") {
            acciones.push(f.ajuste_manual ? '<button type="button" class="xml-btn" data-accion="quitar-ajuste">Quitar el ajuste manual</button>'
                : '<button type="button" class="xml-btn" data-accion="ajuste">Marcar como ' + textoLado("cobrada", "pagada") + " a mano…</button>");
        }
        if (acciones.length) h.push('<div class="conc-acciones">' + acciones.join("") + "</div>");
        p.innerHTML = h.join("");
        p.hidden = false;
        $("panel-tc").hidden = true;
    }

    async function accionFactura(accion) {
        var f = E.datos.facturas.find(function (x) { return x.uuid === E.facturaAbierta; });
        if (!f) return;
        if (accion === "validar") {
            iniciarValidacion(uuidsDe([f]));
        } else if (accion === "ajuste") {
            preguntar("Marcar como " + textoLado("cobrada", "pagada") + " a mano",
                "<p>La factura " + esc(f.serie_folio || "") + " quedará como <strong>" + textoLado("Cobrada", "Pagada") + " (ajuste manual)</strong>. No es un pago real: siempre se verá como ajuste, en la tabla y en el Excel.</p>" +
                '<textarea id="motivo-ajuste" rows="3" maxlength="200" placeholder="Motivo (por ejemplo: pagó en efectivo, se compensó contra otra factura)"></textarea>',
                [{ texto: "Guardar ajuste", primario: true, accion: async function () {
                    var motivo = ($("motivo-ajuste").value || "").trim();
                    if (!motivo) { avisar("Escribe el motivo."); return false; }
                    await enviar("/api/conciliacion/ajuste", { rfc: E.rfc, uuid: f.uuid, motivo: motivo });
                    await cargarDatos();
                } }]);
            setTimeout(function () { var t = $("motivo-ajuste"); if (t) t.focus(); }, 50);
        } else if (accion === "quitar-ajuste") {
            if (!confirm("¿Quitar el ajuste manual de esta factura? Volverá a su estado según sus pagos.")) return;
            try { await enviar("/api/conciliacion/ajuste/quitar", { rfc: E.rfc, uuid: f.uuid }); await cargarDatos(); } catch (e) { avisar(e.message); }
        }
    }

    /* ============================================================ ventana de preguntas */
    function preguntar(titulo, cuerpoHTML, botones) {
        $("modal-titulo").textContent = titulo;
        $("modal-cuerpo").innerHTML = cuerpoHTML;
        $("modal-acciones").innerHTML = botones.map(function (b, i) {
            return '<button type="button" class="xml-btn' + (b.primario ? " xml-btn--primario" : "") + '" data-i="' + i + '">' + esc(b.texto) + "</button>";
        }).join("") + '<button type="button" class="xml-enlace" data-i="cancelar">Cancelar</button>';
        $("modal").hidden = false;
        $("modal-acciones").onclick = async function (e) {
            var b = e.target.closest("[data-i]");
            if (!b) return;
            if (b.dataset.i === "cancelar") { $("modal").hidden = true; return; }
            try {
                var r = await botones[+b.dataset.i].accion();
                if (r !== false) $("modal").hidden = true;
            } catch (err) { avisar(err.message); }
        };
    }

    /* ============================================================ validar ante el SAT */
    var VAL = { reloj: null, siguiente: 0 };

    function uuidsDe(facturas) {
        var s = new Set();
        facturas.forEach(function (f) {
            s.add(f.uuid);
            (E.movsPorFactura[f.uuid] || []).forEach(function (m) { if (m.uuid_mov) s.add(m.uuid_mov); });
        });
        return Array.from(s);
    }

    function pedirValidacion(facturas, origen) {
        var uuids = uuidsDe(facturas);
        if (!uuids.length) { avisar("No hay comprobantes para validar."); return; }
        var sinValidar = new Set(E.datos.sin_validar);
        var faltan = uuids.filter(function (u) { return sinValidar.has(u); });
        var ya = uuids.length - faltan.length;
        if (!ya) { iniciarValidacion(uuids); return; }
        var botones = [];
        if (faltan.length) botones.push({ texto: "Validar solo los que faltan (" + faltan.length.toLocaleString("es-MX") + ")", primario: true, accion: function () { iniciarValidacion(faltan); } });
        botones.push({ texto: "Validar todos de nuevo (" + uuids.length.toLocaleString("es-MX") + ")", primario: !faltan.length, accion: function () { iniciarValidacion(uuids); } });
        preguntar("Validar ante el SAT", "<p>" + uuids.length.toLocaleString("es-MX") + " comprobantes " + origen + " (facturas, pagos y notas); " +
            ya.toLocaleString("es-MX") + " ya se habían validado. ¿Qué quieres hacer?</p>", botones);
    }

    async function iniciarValidacion(uuids) {
        try { await enviar("/api/conciliacion/validar", { rfc: E.rfc, uuids: uuids }); } catch (e) { avisar(e.message); return; }
        VAL.siguiente = 0;
        seguirValidacion();
    }

    function seguirValidacion() {
        clearTimeout(VAL.reloj);
        $("avance-validacion").hidden = false;
        $("avance-validacion").classList.remove("xml-validando--listo");
        $("btn-detener").hidden = false;
        $("btn-validar").disabled = true;
        (async function consultar() {
            var r;
            try { r = await apiJSON("/api/conciliacion/validacion?desde=" + VAL.siguiente); } catch (e) { VAL.reloj = setTimeout(consultar, 4000); return; }
            if (r.estado === "ninguno") { $("avance-validacion").hidden = true; $("btn-validar").disabled = false; return; }
            VAL.siguiente = r.siguiente;
            var pct = r.total ? Math.round(100 * r.hechos / r.total) : 100, c = r.conteo;
            $("validando-barra").style.width = pct + "%";
            var detalle = r.hechos.toLocaleString("es-MX") + " de " + r.total.toLocaleString("es-MX") + " · " + c.Vigente + " vigentes · " + c.Cancelado + " cancelados" +
                (c["No encontrado"] ? " · " + c["No encontrado"] + " no encontrados" : "") + (c.Error ? " · " + c.Error + " sin respuesta del SAT" : "");
            $("validando-detalle").textContent = detalle;
            if (r.estado === "corriendo") { $("validando-titulo").textContent = "Validando ante el SAT…"; VAL.reloj = setTimeout(consultar, 1500); return; }
            $("validando-titulo").textContent = (r.estado === "detenido" ? "Validación detenida." : "Validación terminada.") + " Conciliación actualizada.";
            $("avance-validacion").classList.add("xml-validando--listo");
            $("btn-detener").hidden = true;
            $("btn-validar").disabled = false;
            if (c.Error) $("validando-detalle").textContent = detalle + " — vuelve a validar esos más tarde.";
            if (r.rfc === E.rfc) await cargarDatos();       // lo cancelado cambia los saldos
            VAL.reloj = setTimeout(function () { $("avance-validacion").hidden = true; }, 15000);
        })();
    }

    async function reanudarValidacion() {
        try {
            var r = await apiJSON("/api/conciliacion/validacion?desde=0");
            if (r.estado === "corriendo" && r.rfc === E.rfc) { VAL.siguiente = 0; seguirValidacion(); }
        } catch (e) { /* nada */ }
    }

    /* ============================================================ tipos de cambio */
    function gruposTC() {
        var grupos = {};
        E.datos.movimientos.forEach(function (m) {
            if (m.cancelado || !m.fecha) return;
            var moneda = m.moneda_factura && m.moneda_factura !== "MXN" ? m.moneda_factura : (m.moneda_pago && m.moneda_pago !== "MXN" ? m.moneda_pago : null);
            if (!moneda) return;
            var k = m.fecha + "|" + moneda;
            var g = grupos[k] = grupos[k] || { fecha: m.fecha, moneda: moneda, n: 0, tcs: [], banxico: m.tc_banxico, fix: m.fecha_fix,
                ajuste: m.tc_ajuste, motivo: m.motivo_ajuste_tc, dif: 0 };
            g.n++;
            var tcXml = m.tc_implicito || (m.moneda_pago !== "MXN" ? m.tc_pago : null);
            if (tcXml) g.tcs.push(tcXml);
            g.dif += m.dif_tc_mxn || 0;
        });
        return Object.keys(grupos).sort().reverse().map(function (k) { return grupos[k]; });
    }

    async function pintarPanelTC() {
        var p = $("panel-tc"), reglas = E.datos.reglas || {}, filas = gruposTC();
        var h = [];
        h.push('<div class="xml-panel__cabeza"><h3>Tipos de cambio</h3><button type="button" class="xml-enlace" data-cerrar>Cerrar</button></div>');
        h.push('<div class="conc-caja"><strong>¿Qué tipo de cambio de Banxico le toca a cada fecha?</strong><br>' +
            '<select id="sel-regla">' + Object.keys(reglas).map(function (r) { return '<option value="' + esc(r) + '"' + (r === E.regla ? " selected" : "") + ">" + esc(reglas[r]) + "</option>"; }).join("") + "</select>" +
            '<p class="conc-sub" style="margin-top:6px">Ejemplo: para un pago del lunes 31 de agosto, la regla del DOF toma el publicado el viernes 28 (el FIX del jueves 27).</p></div>');
        h.push('<div class="conc-caja" id="estado-banxico">Revisando la descarga de Banxico…</div>');
        h.push('<div class="conc-caja"><strong>Validar contra la fuente oficial</strong><br>' +
            "Descarga la serie del dólar que tiene el portal para este periodo (fecha del FIX, fecha en que se publicó en el DOF y valor) y compárala con la de Banxico." +
            '<div class="conc-acciones" style="margin-top:8px"><button type="button" class="xml-btn" id="btn-serie-tc">Descargar serie (CSV, abre en Excel)</button>' +
            '<a class="xml-btn" target="_blank" rel="noopener" href="https://www.banxico.org.mx/tipcamb/main.do?page=tip&amp;idioma=sp">Comparar en Banxico</a></div></div>');
        h.push('<p class="conc-sub">Cada fecha con pagos o notas en moneda extranjera. <strong>Tu tipo de cambio para el reporte</strong> no cambia los XML ni la tabla de Banxico: ' +
            "se usa en las columnas «TC contable» y «Diferencia vs TC contable» y en el Excel, solo para esta empresa. Déjalo vacío para usar el de Banxico.</p>");
        if (!filas.length) h.push('<p class="conc-sub"><strong>No hay pagos en moneda extranjera en este periodo.</strong></p>');
        else {
            h.push('<div class="conc-scroll"><table class="conc-mini"><thead><tr><th>Fecha</th><th>Moneda</th><th class="num">Docs</th><th class="num">TC del XML</th>' +
                '<th class="num">TC Banxico</th><th class="num">Diferencia en pesos</th><th>Tu tipo de cambio para el reporte</th><th></th></tr></thead><tbody>' +
                filas.map(function (g) {
                    var min = g.tcs.length ? Math.min.apply(null, g.tcs) : null, max = g.tcs.length ? Math.max.apply(null, g.tcs) : null;
                    var xml = min !== null ? fmtTc.format(min) + (max - min > 0.00005 ? " a " + fmtTc.format(max) : "") : "—";
                    return '<tr data-fecha="' + esc(g.fecha) + '" data-moneda="' + esc(g.moneda) + '"><td>' + esc(fechaMX(g.fecha)) + "</td><td>" + esc(g.moneda) + '</td><td class="num">' + g.n + "</td>" +
                        '<td class="num">' + xml + '</td><td class="num">' + (g.banxico ? fmtTc.format(g.banxico) + '<br><span class="conc-sub">FIX del ' + esc(fechaMX(g.fix)) + "</span>" : "—") + "</td>" +
                        '<td class="num' + (g.dif < -0.005 ? " fc-negativo" : "") + '">' + (g.ajuste || g.banxico ? dinero(g.dif) : "") + "</td>" +
                        '<td><input class="conc-tc-input" type="number" step="0.0001" min="0" data-tc value="' + (g.ajuste ? esc(g.ajuste) : "") + '" placeholder="Banxico"> ' +
                        '<input class="conc-tc-motivo" type="text" maxlength="200" data-motivo value="' + esc(g.motivo || "") + '" placeholder="Motivo"></td>' +
                        '<td><button type="button" class="xml-btn" data-guardar-tc>Guardar</button>' + (g.ajuste ? ' <button type="button" class="xml-enlace" data-quitar-tc>Quitar</button>' : "") + "</td></tr>";
                }).join("") + "</tbody></table></div>");
        }
        p.innerHTML = h.join("");
        p.hidden = false;
        $("panel-factura").hidden = true;
        try {
            var est = await apiJSON("/api/conciliacion/tipos-cambio/estado");
            var caja = $("estado-banxico");
            if (!caja) return;
            var usd = (est.monedas || {}).USD, tarea = est.tarea || {}, partes = [];
            if (!est.token_configurado) {
                partes.push('<strong style="color:#92400e">Falta configurar el token de Banxico en el servidor.</strong> Mientras tanto no hay columna de Banxico; tu tipo de cambio para el reporte sí funciona.');
            } else {
                partes.push("<strong>Banxico (dólar):</strong> " + (usd ? "último FIX del " + esc(fechaMX(usd.hasta)) + " = " + esc(fmtTc.format(usd.ultimo_valor)) +
                    " · " + usd.dias.toLocaleString("es-MX") + " días guardados desde " + esc(fechaMX(usd.desde)) : "todavía no hay datos (la primera descarga corre sola al arrancar)"));
                partes.push("Se actualiza solo a las " + esc(est.horarios) + (tarea.ultimo_exito ? " · última vez: " + esc(fechaMX(tarea.ultimo_exito.slice(0, 10))) + " " + esc(tarea.ultimo_exito.slice(11, 16)) : ""));
                if (tarea.error) partes.push('<span style="color:#b91c1c">Último intento falló: ' + esc(tarea.error) + "</span>");
            }
            if (est.es_admin) partes.push('<button type="button" class="xml-btn" id="btn-actualizar-tc" style="margin-top:6px">Actualizar ahora</button>');
            caja.innerHTML = partes.join("<br>");
        } catch (e) { var c = $("estado-banxico"); if (c) c.textContent = e.message; }
    }

    /* Serie del FIX que tiene el portal, para compararla con la oficial.
       La fecha de publicación en el DOF es el siguiente día de la serie. */
    async function descargarSerieTC(boton) {
        var r = rango(), hoy = new Date().toISOString().slice(0, 10);
        var hasta = r.hasta || hoy, desde = r.desde;
        if (!desde) { var d = new Date(); d.setFullYear(d.getFullYear() - 1); desde = d.toISOString().slice(0, 10); }
        // Unos días antes del inicio: así el primer día del periodo también tiene su FIX publicado
        var antes = new Date(desde + "T12:00:00"); antes.setDate(antes.getDate() - 10);
        boton.disabled = true;
        try {
            var serie = await apiJSON("/api/conciliacion/tipos-cambio/serie?moneda=USD&desde=" + antes.toISOString().slice(0, 10) + "&hasta=" + hasta);
            if (!serie.length) { avisar("El portal todavía no tiene tipos de cambio de Banxico para esas fechas."); return; }
            var lineas = ["Fecha del FIX (Banxico),Publicado en el DOF,Tipo de cambio USD"];
            serie.forEach(function (x, i) {
                var pub = serie[i + 1] ? fechaMX(serie[i + 1].fecha) : "pendiente";
                lineas.push(fechaMX(x.fecha) + "," + pub + "," + x.valor);
            });
            // BOM: para que Excel respete los acentos
            descargarBlob(new Blob(["\ufeff" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" }),
                "TipoCambio_USD_" + desde + "_a_" + hasta + ".csv");
        } catch (err) { avisar(err.message); }
        finally { boton.disabled = false; }
    }

    async function accionTC(e) {
        if (e.target.closest("[data-cerrar]")) { $("panel-tc").hidden = true; return; }
        if (e.target.id === "btn-serie-tc") { descargarSerieTC(e.target); return; }
        if (e.target.id === "btn-actualizar-tc") {
            e.target.disabled = true; e.target.textContent = "Actualizando…";
            try { await enviar("/api/conciliacion/tipos-cambio/actualizar", {}); await cargarDatos(); pintarPanelTC(); }
            catch (err) { avisar(err.message); e.target.disabled = false; e.target.textContent = "Actualizar ahora"; }
            return;
        }
        var tr = e.target.closest("tr[data-fecha]");
        if (!tr) return;
        if (e.target.closest("[data-guardar-tc]")) {
            var valor = parseFloat(tr.querySelector("[data-tc]").value), motivo = tr.querySelector("[data-motivo]").value.trim();
            if (!valor) { avisar("Escribe el tipo de cambio (o usa «Quitar» para volver al de Banxico)."); return; }
            if (!motivo) { avisar("Escribe el motivo del ajuste: queda en el reporte."); return; }
            try {
                await enviar("/api/conciliacion/tipos-cambio/ajuste", { rfc: E.rfc, fecha: tr.dataset.fecha, moneda: tr.dataset.moneda, valor: valor, motivo: motivo }, "PUT");
                await cargarDatos();
            } catch (err) { avisar(err.message); }
        } else if (e.target.closest("[data-quitar-tc]")) {
            try {
                await enviar("/api/conciliacion/tipos-cambio/ajuste/quitar", { rfc: E.rfc, fecha: tr.dataset.fecha, moneda: tr.dataset.moneda });
                await cargarDatos();
            } catch (err) { avisar(err.message); }
        }
    }

    /* ============================================================ Excel */
    async function exportarExcel(modo) {
        var r = rango();
        var cuerpo = { rfc: E.rfc, lado: E.lado, desde: r.desde, hasta: r.hasta, meses: mesesSueltos(), base: $("sel-base").value, regla: E.regla,
            columnas: tabla().columnas().map(function (c) { return c.clave; }), uuids: null };
        if (modo === "vista") {
            var sel = tabla().seleccion;
            if (sel.size) cuerpo.uuids = Array.from(sel);
            else if (hayFiltros()) cuerpo.uuids = E.filtradas.map(function (f) { return f.uuid; });
        }
        var boton = document.querySelector('.mod-acciones [data-excel="' + modo + '"]'), texto = boton.innerHTML;
        boton.disabled = true; boton.innerHTML = "<b>⏳</b>Generando…";
        try {
            var resp = await enviar("/api/conciliacion/excel", cuerpo);
            var cd = resp.headers.get("Content-Disposition") || "", m = cd.match(/filename="?([^";]+)"?/);
            descargarBlob(await resp.blob(), m ? m[1] : "conciliacion.xlsx");
        } catch (e) { avisar(e.message); }
        boton.disabled = false; boton.innerHTML = texto;
    }

    /* ============================================================ eventos */
    function cerrarMenus(excepto) {
        ["menu-vistas", "menu-filtros", "menu-otra"].forEach(function (id) { if (id !== excepto) $(id).hidden = true; });
    }

    function prepararEventos() {
        $("btn-agregar").addEventListener("click", function () { if (bandeja.abierta()) bandeja.cerrar(); else bandeja.abrir(); });
        $("lados").addEventListener("click", async function (e) {
            var b = e.target.closest("[data-lado]");
            if (!b || b.dataset.lado === E.lado || !E.rfc) return;
            E.lado = b.dataset.lado; E.estado = ""; E.tarjeta = null; E.av = {};
            $("panel-factura").hidden = true;
            await cargarDatos();
        });
        $("base").addEventListener("click", function (e) {
            var b = e.target.closest("[data-base]");
            if (!b || $("sel-base").value === b.dataset.base) return;
            $("sel-base").value = b.dataset.base;
            cargarDatos();
        });
        $("sin-empresa").addEventListener("click", function (e) {
            var b = e.target.closest("button");
            if (!b) return;
            if (b.dataset.otra) { refrescarBibliotecas(b.dataset.otra); return; }
            if (b.hasAttribute("data-agregar")) { bandeja.abrir(); return; }
            if (b.hasAttribute("data-elegir")) { e.stopPropagation(); cerrarMenus("menu-otra"); $("menu-otra").hidden = false; pintarMenuOtra(); }
        });
        $("btn-otra").addEventListener("click", function (e) {
            e.stopPropagation(); cerrarMenus("menu-otra");
            $("menu-otra").hidden = !$("menu-otra").hidden;
            if (!$("menu-otra").hidden) pintarMenuOtra();
        });
        $("menu-otra").addEventListener("click", function (e) { e.stopPropagation(); var b = e.target.closest("button"); if (b) accionMenuOtra(b); });
        $("aviso-otra").addEventListener("click", function (e) { if (e.target.id === "volver-empresa") { E.otra = null; E.rfc = null; refrescarBibliotecas(); } });
        $("aviso-validar").addEventListener("click", function (e) { if (e.target.id === "validar-faltan") iniciarValidacion(E.datos.sin_validar); });
        $("tarjetas").addEventListener("click", function (e) {
            var b = e.target.closest("[data-tarjeta]"); if (!b) return;
            E.tarjeta = E.tarjeta === b.dataset.tarjeta ? null : b.dataset.tarjeta;
            pintarTarjetas(); aplicar();
        });
        $("chips-estado").addEventListener("click", function (e) {
            var b = e.target.closest("[data-estado]"); if (!b) return;
            E.estado = b.dataset.estado; pintarChipsEstado(); aplicar();
        });
        $("rapidos").addEventListener("click", function (e) {
            var b = e.target.closest("[data-rapido]"); if (!b) return;
            E.rapidos[b.dataset.rapido] = !E.rapidos[b.dataset.rapido]; pintarRapidos(); aplicar();
        });
        $("avanzados").addEventListener("input", function (e) {
            var k = e.target.dataset.av; if (!k) return;
            E.av[k] = e.target.value; pintarRapidos(); aplicar();
        });
        $("quitar-filtros").addEventListener("click", function () {
            E.rapidos = {}; E.av = {}; E.estado = ""; E.tarjeta = null;
            pintarRapidos(); pintarAvanzados(); pintarChipsEstado(); pintarTarjetas(); aplicar();
        });
        var reloj = null;
        $("buscar").addEventListener("input", function () {
            clearTimeout(reloj); var v = this.value;
            reloj = setTimeout(function () { E.busqueda = v; aplicar(); }, 150);
        });
        [["btn-filtros", "menu-filtros"], ["btn-vistas", "menu-vistas"]].forEach(function (par) {
            $(par[0]).addEventListener("click", function (e) {
                e.stopPropagation(); cerrarMenus(par[1]); $(par[1]).hidden = !$(par[1]).hidden;
                if (par[1] === "menu-filtros" && !$(par[1]).hidden) pintarAvanzados();
            });
            $(par[1]).addEventListener("click", function (e) { e.stopPropagation(); });
        });
        document.addEventListener("click", function () { cerrarMenus(); });
        document.querySelector(".mod-acciones").addEventListener("click", function (e) {
            var b = e.target.closest("[data-excel]"); if (b && !b.disabled && E.datos) exportarExcel(b.dataset.excel);
        });
        $("btn-listas").addEventListener("click", function () {
            var q = new URLSearchParams({ empresa: E.rfc || "" }), est = E.selPeriodo.estado();
            if (E.selPeriodo.porFechas()) { if (est.desde) q.set("desde", est.desde); if (est.hasta) q.set("hasta", est.hasta); }
            else if (est.anio) { q.set("anio", est.anio); q.set("meses", est.meses.join(",")); }
            window.open("/herramientas/listas-sat/?" + q.toString(), "_blank", "noopener");
        });
        $("btn-columnas").addEventListener("click", function () { if (tabla()) tabla().abrirPanelColumnas(); });
        // Lo seleccionado; si no hay selección, lo que ves
        $("btn-validar").addEventListener("click", function () {
            if (!E.datos) return;
            var sel = tabla().seleccion;
            if (sel.size) pedirValidacion(E.datos.facturas.filter(function (f) { return sel.has(f.uuid); }), "de lo seleccionado");
            else pedirValidacion(E.filtradas, hayFiltros() ? "de lo filtrado" : "de este periodo");
        });
        $("btn-limpiar-sel").addEventListener("click", function () { tabla().limpiarSeleccion(); });
        $("btn-detener").addEventListener("click", function () { enviar("/api/conciliacion/validacion/detener", {}).catch(function () {}); });
        $("btn-tc").addEventListener("click", function () { if (E.datos) pintarPanelTC(); });
        $("panel-tc").addEventListener("click", accionTC);
        $("panel-tc").addEventListener("change", function (e) {
            if (e.target.id === "sel-regla") { E.regla = e.target.value; guardar("regla", E.regla); cargarDatos(); }
        });
        $("panel-factura").addEventListener("click", function (e) {
            if (e.target.closest("[data-cerrar]")) { $("panel-factura").hidden = true; E.facturaAbierta = null; return; }
            var b = e.target.closest("[data-accion]"); if (b) accionFactura(b.dataset.accion);
        });
        $("modal").addEventListener("click", function (e) { if (e.target.id === "modal") $("modal").hidden = true; });
        document.addEventListener("keydown", function (e) {
            if (e.key !== "Escape") return;
            if (!$("modal").hidden) { $("modal").hidden = true; return; }
            $("panel-factura").hidden = true; $("panel-tc").hidden = true;
        });
    }
})();
