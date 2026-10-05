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
        recibidos: [["alertas", "Con alertas"], ["listas", "En listas del SAT"], ["cancelados", "Cancelados"], ["sinvalidar", "Sin validar"], ["ppd", "PPD"], ["sinpago", "PPD sin pago"], ["retenciones", "Con retenciones"], ["extranjera", "Moneda extranjera"], ["relacionados", "Con relacionados"]],
        emitidos: [["alertas", "Con alertas"], ["listas", "En listas del SAT"], ["cancelados", "Cancelados"], ["sinvalidar", "Sin validar"], ["ppd", "PPD"], ["sinpago", "PPD sin pago"], ["retenciones", "Con retenciones"], ["extranjera", "Moneda extranjera"], ["relacionados", "Con relacionados"]],
        pagos: [["alertas", "Con alertas"], ["listas", "En listas del SAT"], ["cancelados", "Cancelados"], ["sinvalidar", "Sin validar"], ["nocargada", "Factura no cargada"], ["extranjera", "Moneda extranjera"]],
        nomina: [["alertas", "Con alertas"], ["cancelados", "Cancelados"], ["sinvalidar", "Sin validar"]]
    };
    var PRUEBA_RAPIDO = {
        ppd: function (f) { return f.metodo_pago === "PPD"; },
        sinpago: function (f) { return f.estado_pago === "Sin pago" || f.estado_pago === "Parcial" || f.estado_pago === "Pago a factura cancelada"; },
        retenciones: function (f) { return !!(f.ret_isr || f.ret_iva || f.ret_ieps); },
        extranjera: function (f) { var m = f.moneda || f.moneda_p; return !!m && m !== "MXN" && m !== "XXX"; },
        relacionados: function (f) { return !!f.cfdi_relacionados; },
        nocargada: function (f) { return f.docto_encontrado === "No"; },
        alertas: function (f) { return !!f.alertas; },
        listas: function (f) { return !!f.listas_sat; },
        cancelados: function (f) { return f.estado_sat === "Cancelado"; },
        sinvalidar: function (f) { return !f.estado_sat || f.estado_sat === "Sin validar"; }
    };
    var ANCHO_TIPO = { moneda: 122, numero: 90, fecha: 104, uuid: 130, texto: 160 };
    var ANCHO_CLAVE = { emisor_nombre: 250, receptor_nombre: 250, contraparte_nombre: 250, conceptos: 300, serie_folio: 130,
        estado_pago: 120, estado_sat: 100, forma_pago: 210, forma_pago_p: 210, uso_cfdi: 190, docto_encontrado: 90 };

    var E = {
        contribuyentes: [], rfc: null, periodo: "", datos: null, P: null, cuentas: {}, cargado: null,
        modulo: "recibidos", sub: "", rapidos: {}, busqueda: "",
        orden: { clave: null, dir: 1 }, seleccion: new Set(),
        columnas: {}, vistas: [], vistaActual: {},
        filas: [], altoFila: 35, av: {}, otras: [], clientesLista: null
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
        prepararBandeja();
        // Periodo de ESTA página (cuadros de año, meses y fechas; el mismo de Conciliación y Listas)
        E.P = FCPeriodoMeses.crear({ contenedor: $("periodo-xml"), alCambiar: function () { alCambiarPeriodo(); }, alAvisar: avisar });
        prepararEventos();
        var perfil = await Fiscontable.perfil();
        $("btn-conciliacion").hidden = !(perfil && (perfil.modulos_permitidos || []).indexOf("conciliacion") !== -1);
        await cargarVistas();
        E.empresa = await Fiscontable.empresaActiva();
        E.periodoGeneral = await Fiscontable.periodoActivo();
        // Periodo de ESTA página (como en Mi Admin): año + meses, varios a la vez. Arranca en
        // el general; cambiarlo aquí no mueve el general.
        await refrescarBibliotecas();
        // Si cambias de empresa en la barra, la página se actualiza sola
        window.addEventListener("fiscontable:empresa", async function (e) {
            E.empresa = e.detail; E.otra = null; E.rfc = null;
            $("bandeja").hidden = true;
            await refrescarBibliotecas();
        });
        // Y si cambias el periodo general, esta página lo sigue
        window.addEventListener("fiscontable:periodo", function (e) {
            E.periodoGeneral = e.detail;
            if (!E.rfc || !e.detail) return;
            E.P.poner({ anio: e.detail.slice(0, 4), meses: [e.detail.slice(5, 7)] });
            cargarRegistros();
        });
    }

    function nombreDe(rfc) {
        if (E.empresa && E.empresa.rfc === rfc) return E.empresa.alias || rfc;
        var c = E.contribuyentes.find(function (x) { return x.rfc === rfc; });
        return (c && c.nombre) || rfc;
    }

    /* La biblioteca que se ve: la de la empresa activa, o la de un RFC sin
       registrar que se cargó con la herramienta rápida. */
    async function refrescarBibliotecas(rfcPreferido) {
        try { E.contribuyentes = await apiJSON("/api/xml/contribuyentes"); } catch (e) { avisar(e.message); return; }
        var otras = E.otras = E.contribuyentes.filter(function (c) { return !c.registrado; });
        var activa = E.empresa ? E.empresa.rfc : null;
        var rfc = rfcPreferido || E.rfc || activa;
        if (rfc && rfc !== activa && !otras.some(function (c) { return c.rfc === rfc; })) rfc = activa;
        E.otra = rfc && rfc !== activa ? rfc : null;
        if (rfc !== E.rfc) $("bandeja").hidden = true;      // al cambiar de vista, la bandeja se cierra
        E.rfc = rfc;
        pintarEncabezado();
        var c = rfc && E.contribuyentes.find(function (x) { return x.rfc === rfc; });
        $("btn-periodo").disabled = !c;
        if (!c) { mostrarVacio(); return; }
        armarPeriodos(c);
        await cargarRegistros();
    }

    function pintarEncabezado() {
        var boton = $("btn-otra");
        var rfc = E.otra || (E.empresa && E.empresa.rfc);
        $("empresa-etiqueta").textContent = rfc ? "Empresa · " + rfc : "Empresa";
        $("empresa-titulo").innerHTML = E.otra ? esc(nombreDe(E.otra)) + '<span class="ctx-marca">sin registrar</span>'
            : E.empresa ? esc(E.empresa.alias || E.empresa.rfc) : "Elegir empresa";
        boton.classList.toggle("ctx-campo--vacio", !rfc);
        boton.title = rfc ? "Cambiar de empresa" : "Elige de quién son los XML";
        var aviso = $("aviso-otra");
        aviso.hidden = !E.otra;
        if (E.otra) {
            aviso.innerHTML = "<strong>" + esc(nombreDe(E.otra)) + "</strong> no está en tu directorio: sus XML se borran solos 7 días después de la última carga." +
                ' <a class="xml-enlace" href="/clientes/">Registrarla como cliente</a>' +
                (E.empresa ? ' <button type="button" class="xml-enlace" id="volver-empresa">Volver a ' + esc(E.empresa.alias || E.empresa.rfc) + "</button>" : "");
        }
    }

    function mostrarVacio() {
        $("contenido").hidden = true;
        var caja = $("sin-empresa");
        caja.hidden = false;
        if (E.empresa) {
            caja.innerHTML = '<p class="ctx-vacio__titulo">' + esc(E.empresa.alias || E.empresa.rfc) + " todavía no tiene XML</p>" +
                "<p>Agrega sus XML, una carpeta o el ZIP de la descarga masiva del SAT. Nada se guarda hasta que presiones <strong>Procesar</strong>.</p>" +
                '<div class="ctx-vacio__acciones"><button type="button" class="xml-btn xml-btn--primario" data-agregar>+ Agregar XML</button></div>';
        } else {
            caja.innerHTML = '<p class="ctx-vacio__titulo">¿De quién son los XML?</p>' +
                "<p>Elige una de tus empresas, o trabaja sin registrar: agrega los XML y el portal detecta solo de quién son. " +
                "Lo que cargues sin registrar se borra a los 7 días.</p>" +
                '<div class="ctx-vacio__acciones"><button type="button" class="xml-btn xml-btn--primario" data-elegir>Elegir empresa</button>' +
                '<button type="button" class="xml-btn" data-agregar>Trabajar sin registrar</button></div>';
        }
    }


    /* Menú "Abrir otra empresa": tus empresas (cambia la empresa activa) y las
       que cargaste sin registrar (se borran solas a los 7 días). */
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
                ' <span>' + esc(c.rfc) + (c.rfc === activa ? " · empresa activa" : "") + "</span></button>");
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
        if (b.hasAttribute("data-nuevo")) { abrirBandeja(); return; }
        if (b.dataset.otra) { refrescarBibliotecas(b.dataset.otra); return; }
        if (b.dataset.empresa) {
            if (E.empresa && E.empresa.rfc === b.dataset.empresa) { E.otra = null; E.rfc = null; refrescarBibliotecas(); }
            else await Fiscontable.elegirEmpresa(b.dataset.empresa);     // la barra avisa y la página se actualiza
            return;
        }
        if (b.dataset.borrar) {
            var rfc = b.dataset.borrar;
            if (!confirm("¿Borrar ya todos los XML de " + nombreDe(rfc) + " (" + rfc + ")?\n\nNo está en tu directorio; no quedará registro.")) return;
            try {
                await apiJSON("/api/xml/borrar-biblioteca", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rfc: rfc }) });
                if (E.rfc === rfc) { E.rfc = null; E.otra = null; }
                await refrescarBibliotecas();
            } catch (e) { avisar(e.message); }
        }
    }

    var MES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    var DOCE = MES_CORTO.map(function (_, i) { return String(i + 1).padStart(2, "0"); });

    /* Periodo de esta página: un año y los meses marcados (o un rango de fechas exactas).
       Solo se carga lo elegido; sin año o sin meses no se carga nada. Arranca en el periodo
       general; si no hay, espera a que elijas. Los cuadros (comun/periodo-meses.js) dicen
       cuántos XML hay de la pestaña en la que estás, sin cargarlos. */
    function armarPeriodos(c) {
        E.busqueda = ""; $("buscar").value = "";
        E.seleccion.clear();
        E.cuentas = {};                                        // "AAAA-MM" -> {total, modulos}
        (c.periodos || []).forEach(function (p) { if (p.periodo) E.cuentas[p.periodo] = { n: p.n, modulos: p.modulos || {} }; });
        E.cargado = null;
        E.P.poner(E.periodoGeneral ? { anio: E.periodoGeneral.slice(0, 4), meses: [E.periodoGeneral.slice(5, 7)] } : null);
        pintarPeriodo();
    }

    function porFechas() { return E.P.porFechas(); }
    function hayEleccion() { return E.P.hayEleccion(); }
    function anioElegido() { return E.P.estado().anio; }

    function enPeriodo(f) {
        if (porFechas()) return true;                          // el servidor ya filtró por fechas exactas
        var est = E.P.estado(), p = f._periodo || "";
        return p.slice(0, 4) === est.anio && est.meses.indexOf(p.slice(5, 7)) !== -1;
    }

    function filasPeriodo(modulo) {
        return E.datos && E.datos[modulo] ? E.datos[modulo].filas.filter(enPeriodo) : [];
    }

    function textoPeriodo() { return hayEleccion() ? E.P.texto() : "ningún periodo"; }

    /* Desde-hasta que cubre lo elegido (es lo que se pide al servidor, a Conciliación y a Excel). */
    function rangoPeriodo() { return E.P.rango(); }
    function mesesElegidos() { return E.P.meses(); }

    function cuantos(periodo) {
        var c = E.cuentas[periodo];
        return c ? (c.modulos[E.modulo] || 0) : 0;
    }

    // Los números de los cuadros son de la pestaña en la que estás
    function pintarPeriodo() {
        var m = {};
        Object.keys(E.cuentas || {}).forEach(function (p) { m[p] = cuantos(p); });
        E.P.conteos(m);
    }

    /* Si lo elegido cabe en lo que ya se cargó, se filtra aquí; si no, se pide al servidor. */
    function alCambiarPeriodo() {
        E.seleccion.clear();
        var r = rangoPeriodo();
        var cabe = E.cargado && E.cargado.rfc === E.rfc && hayEleccion() && !porFechas() && !E.cargado.fechas &&
            r.desde >= E.cargado.desde && r.hasta <= E.cargado.hasta;
        if (cabe) {
            pintarPeriodo(); pintarPestanas(); pintarSubfiltros(); aplicar();
        } else {
            cargarRegistros();
        }
    }

    async function cargarRegistros() {
        if (!E.rfc) return;
        $("sin-empresa").hidden = true;
        $("contenido").hidden = false;
        pintarPeriodo();
        var r = rangoPeriodo();
        // Sin elección no se trae ningún XML (solo la forma de la tabla)
        var desde = hayEleccion() ? r.desde : "1900-01-01", hasta = hayEleccion() ? r.hasta : "1900-01-01";
        var q = "?rfc=" + encodeURIComponent(E.rfc) + (desde ? "&desde=" + desde : "") + (hasta ? "&hasta=" + hasta : "");
        $("conteo-filas").textContent = "Cargando…";
        try {
            E.datos = (await apiJSON("/api/xml/registros" + q)).modulos;
        } catch (e) { avisar(e.message); return; }
        E.cargado = hayEleccion() ? { rfc: E.rfc, desde: r.desde, hasta: r.hasta, fechas: porFechas() } : null;
        E.seleccion.clear();
        pintarPestanas();
        cambiarModulo(E.modulo, true);
        reanudarValidacion();
    }

    /* Las acciones de la derecha usan lo seleccionado; si no hay selección, lo que ves. */
    function uuidsParaAcciones() {
        if (E.seleccion.size) return Array.from(E.seleccion);
        return Array.from(new Set((E.filas || []).map(function (f) { return f.uuid; })));
    }

    function pintarAlcance() {
        var n = uuidsParaAcciones().length;
        $("acciones-alcance").textContent = !n ? "No hay XML en la tabla."
            : E.seleccion.size ? "Sobre los " + n.toLocaleString("es-MX") + " seleccionados." : "Sobre los " + n.toLocaleString("es-MX") + " XML que ves.";
        $("btn-zip").disabled = $("btn-pdf").disabled = !n;
    }

    /* ============================================================ minimódulos */
    function contarUuid(filas) {
        var s = new Set();
        filas.forEach(function (f) { s.add(f.uuid); });
        return s.size;
    }

    function pintarPestanas() {
        $("pestanas").innerHTML = MODULOS.map(function (m) {
            var n = contarUuid(filasPeriodo(m.clave));
            return '<button type="button" class="pestana' + (m.clave === E.modulo ? " pestana--activa" : "") + '" data-modulo="' + m.clave + '">' +
                m.nombre + '<span class="xml-cuenta">' + n + "</span></button>";
        }).join("");
    }

    function cambiarModulo(modulo, conservarSub) {
        E.modulo = modulo;
        if (!conservarSub) E.sub = "";
        E.rapidos = {};
        E.av = {};
        E.orden = { clave: null, dir: 1 };
        E.seleccion.clear();
        document.querySelectorAll("#pestanas .pestana").forEach(function (b) { b.classList.toggle("pestana--activa", b.dataset.modulo === modulo); });
        pintarPeriodo();
        prepararColumnas();
        pintarSubfiltros();
        pintarRapidos();
        pintarVistas();
        aplicar();
    }

    function pintarSubfiltros() {
        var filas = filasPeriodo(E.modulo);
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
        var opciones = RAPIDOS[E.modulo];
        $("rapidos").innerHTML = opciones.map(function (r) {
            return '<button type="button" class="xml-chip' + (E.rapidos[r[0]] ? " xml-chip--activo" : "") + '" data-rapido="' + r[0] + '">' + r[1] + "</button>";
        }).join("");
        var n = Object.keys(E.rapidos).filter(function (k) { return E.rapidos[k]; }).length +
            Object.keys(E.av).filter(function (k) { return E.av[k] !== "" && E.av[k] !== undefined; }).length;
        $("cuenta-filtros").hidden = !n;
        $("cuenta-filtros").textContent = n;
        $("btn-filtros").classList.toggle("xml-btn--activo", n > 0);
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
        if (!leerLocal("mig:listas:" + E.modulo)) {                // una vez: quitar Listas del SAT, que entró de fábrica
            if (local) { local = local.filter(function (c) { return c.clave !== "listas_sat"; }); guardarLocal("cols:" + E.modulo, local); }
            guardarLocal("mig:listas:" + E.modulo, 1);
        }
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

    function vistaActualObj() {
        var actual = E.vistaActual[E.modulo] || "";
        return E.vistas.find(function (v) { return v.modulo === E.modulo && v.nombre === actual; }) || null;
    }

    function pintarVistas() {
        var propias = E.vistas.filter(function (v) { return v.modulo === E.modulo; });
        var v = vistaActualObj();
        $("nombre-vista").textContent = v ? v.nombre : "Vista de fábrica";
        function item(accion, nombre, texto, clase) {
            return '<button type="button" data-accion="' + accion + '" data-nombre="' + esc(nombre) + '"' + (clase ? ' class="' + clase + '"' : "") + ">" + texto + "</button>";
        }
        var h = [item("aplicar", "", "Vista de fábrica", !v ? "xml-activa" : "")];
        propias.forEach(function (p) {
            h.push(item("aplicar", p.nombre, esc(p.nombre) + (p.predeterminada ? " ★" : ""), v && p.nombre === v.nombre ? "xml-activa" : ""));
        });
        h.push('<div class="xml-separador"></div>');
        if (v) h.push(item("guardar", v.nombre, "Guardar cambios en «" + esc(v.nombre) + "»"));
        h.push(item("nueva", "", "Guardar como vista nueva…"));
        if (v) h.push(item("pred", v.nombre, v.predeterminada ? "Ya no abrir siempre con esta vista" : "Abrir siempre con esta vista ★"));
        if (v) h.push(item("borrar", v.nombre, "Borrar «" + esc(v.nombre) + "»", "xml-peligro"));
        $("menu-vistas").innerHTML = h.join("");
    }

    function aplicarVista(nombre) {
        var v = E.vistas.find(function (x) { return x.modulo === E.modulo && x.nombre === nombre; });
        E.columnas[E.modulo] = (v ? v.columnas : columnasDeFabrica()).filter(function (c) { return colPorClave(c.clave); });
        E.vistaActual[E.modulo] = v ? v.nombre : "";
        guardarColumnasLocal();
        pintarVistas();
        pintarTabla();
        if (!$("panel-columnas").hidden) pintarPanelColumnas();
    }

    async function guardarVista(nombre, predeterminada, columnas) {
        try {
            await api("/api/xml/vistas", { method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ modulo: E.modulo, nombre: nombre, columnas: columnas || E.columnas[E.modulo], predeterminada: !!predeterminada }) });
            await cargarVistas();
            E.vistaActual[E.modulo] = nombre;
            guardarColumnasLocal();
            pintarVistas();
        } catch (e) { avisar(e.message); }
    }

    async function accionVista(accion, nombre) {
        $("menu-vistas").hidden = true;
        var v = vistaActualObj();
        if (accion === "aplicar") aplicarVista(nombre);
        else if (accion === "guardar" && v) guardarVista(v.nombre, v.predeterminada);
        else if (accion === "nueva") {
            var n = prompt("Nombre de la vista nueva (por ejemplo: Revisión de IVA):", "");
            if (n && n.trim()) guardarVista(n.trim().slice(0, 60), false);
        }
        else if (accion === "pred" && v) guardarVista(v.nombre, !v.predeterminada, v.columnas);
        else if (accion === "borrar" && v) {
            if (!confirm("¿Borrar la vista «" + v.nombre + "»?")) return;
            try {
                await api("/api/xml/vistas/" + v.id, { method: "DELETE" });
                await cargarVistas();
                aplicarVista("");
            } catch (e) { avisar(e.message); }
        }
    }

    /* ============================================================ filtrar y ordenar */
    function textoBusqueda(f) {
        if (f._q === undefined) {
            f._q = [f.uuid, f.serie_folio, f.emisor_rfc, f.emisor_nombre, f.receptor_rfc, f.receptor_nombre, f.conceptos,
                f.docto_uuid, f.docto_serie_folio, f.curp, f.num_empleado].filter(Boolean).join(" ").toLowerCase();
        }
        return f._q;
    }

    function importeDe(f) { return E.modulo === "pagos" ? (f.importe_pagado != null ? f.importe_pagado : f.monto_pago) : f.total; }
    var CAMPOS_AV = {
        metodo: { etiqueta: "Método de pago", valor: function (f) { return f.metodo_pago; }, modulos: ["recibidos", "emitidos"] },
        forma: { etiqueta: "Forma de pago", valor: function (f) { return f.forma_pago || f.forma_pago_p; }, modulos: ["recibidos", "emitidos", "pagos"] },
        moneda: { etiqueta: "Moneda", valor: function (f) { return f.moneda || f.moneda_p; }, modulos: ["recibidos", "emitidos", "pagos"] },
        uso: { etiqueta: "Uso CFDI", valor: function (f) { return f.uso_cfdi; }, modulos: ["recibidos", "emitidos"] },
        sat: { etiqueta: "Estado SAT", valor: function (f) { return f.estado_sat || "Sin validar"; }, modulos: ["recibidos", "emitidos", "pagos", "nomina"] }
    };

    function pintarAvanzados() {
        var filas = E.datos[E.modulo].filas;
        var h = ['<label>Importe desde<input type="number" step="0.01" data-av="min" placeholder="0.00" value="' + esc(E.av.min || "") + '"></label>',
                 '<label>hasta<input type="number" step="0.01" data-av="max" placeholder="sin tope" value="' + esc(E.av.max || "") + '"></label>'];
        Object.keys(CAMPOS_AV).forEach(function (k) {
            var c = CAMPOS_AV[k];
            if (c.modulos.indexOf(E.modulo) === -1) return;
            var valores = {};
            filas.forEach(function (f) { var v = c.valor(f); if (v) valores[v] = 1; });
            var lista = Object.keys(valores).sort();
            if (lista.length < 2 && !E.av[k]) return;
            h.push("<label>" + c.etiqueta + '<select data-av="' + k + '"><option value="">Todos</option>' +
                lista.map(function (v) { return '<option value="' + esc(v) + '"' + (E.av[k] === v ? " selected" : "") + ">" + esc(v) + "</option>"; }).join("") + "</select></label>");
        });
        $("avanzados").innerHTML = h.join("");
    }

    function aplicar() {
        var filas = filasPeriodo(E.modulo);
        var q = E.busqueda.trim().toLowerCase();
        var activos = Object.keys(E.rapidos).filter(function (k) { return E.rapidos[k]; });
        var av = E.av;
        var min = av.min !== undefined && av.min !== "" ? +av.min : null, max = av.max !== undefined && av.max !== "" ? +av.max : null;
        E.filas = filas.filter(function (f) {
            if (E.sub && f._sub !== E.sub) return false;
            for (var i = 0; i < activos.length; i++) if (!PRUEBA_RAPIDO[activos[i]](f)) return false;
            if (min !== null || max !== null) {
                var imp = importeDe(f);
                if (imp === undefined || imp === null) return false;
                if (min !== null && imp < min) return false;
                if (max !== null && imp > max) return false;
            }
            for (var k in CAMPOS_AV) if (av[k] && CAMPOS_AV[k].valor(f) !== av[k]) return false;
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
        estado_pago: { "Pagada": "verde", "Parcial": "ambar", "Sin pago": "rojo", "Pagada de más": "rojo", "Pago a factura cancelada": "ambar",
                       "Cubierta con nota de crédito": "verde", "Pagada (ajuste manual)": "verde" },
        estado_sat: { "Vigente": "verde", "Cancelado": "rojo", "Sin validar": "gris", "No encontrado": "ambar" },
        docto_encontrado: { "Sí": "verde", "No": "ambar" }
    };

    function celda(c, f, fija) {
        var v = f[c.clave];
        if (c.clave === "alertas") {
            var n = v ? v.split("; ").length : 0;
            return "<td" + (fija ? ' class="xml-fija xml-fija--ultima" style="left:36px"' : "") + (n ? ' title="' + esc(v) + '"' : "") + ">" +
                (n ? '<span class="xml-alerta">⚠ ' + n + "</span> " + esc(v.split("; ")[0]) : "") + "</td>";
        }
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
        if (!E.filas.length) {
            // ¿Faltan datos en el periodo, o los esconden los filtros? Son dos mensajes distintos.
            var delPeriodo = filasPeriodo(E.modulo).length;
            var nombreMod = (MODULOS.find(function (m) { return m.clave === E.modulo; }) || {}).nombre || "";
            var anio = anioElegido();
            var conXml = anio ? DOCE.filter(function (mm) { return cuantos(anio + "-" + mm); }).map(function (mm) { return MES_CORTO[+mm - 1]; }) : [];
            $("sin-filas").textContent = !hayEleccion() ? "Elige un año y al menos un mes (o un rango de fechas) para ver los XML."
                : delPeriodo ? "No hay registros con estos filtros."
                : "No hay XML de " + nombreMod + " en " + textoPeriodo() + "." +
                  (porFechas() ? "" : conXml.length ? " En " + anio + " sí hay en: " + conXml.join(", ") + "." : " En " + anio + " no hay de este tipo.");
        }
        $("conteo-filas").textContent = E.filas.length.toLocaleString("es-MX") + " registro(s)";
        pintarAlcance();
        pintarFilas(true);
        pintarSeleccion();
    }

    var ultimoInicio = -1;
    function pintarFilas(forzar) {
        if (!E.datos || !E.columnas[E.modulo]) return;     // aún no hay tabla (p. ej. cambio de tamaño al cargar)
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
            var clases = (sel ? "xml-sel " : "") + (f.estado_sat === "Cancelado" ? "fila-cancelada" : "");
            html.push('<tr data-i="' + i + '"' + (clases.trim() ? ' class="' + clases.trim() + '"' : "") + ">" +
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
        pintarAlcance();
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
        var r = rangoPeriodo();
        var cuerpo = { rfc: E.rfc, desde: r.desde, hasta: r.hasta, meses: mesesElegidos(), modo: modo };
        if (modo === "vista") {
            cuerpo.modulo = E.modulo;
            cuerpo.sub = E.sub || null;
            cuerpo.columnas = E.columnas[E.modulo].map(function (c) { return c.clave; });
            var filtrado = E.busqueda.trim() || Object.keys(E.rapidos).some(function (k) { return E.rapidos[k]; }) ||
                Object.keys(E.av).some(function (k) { return E.av[k]; });
            cuerpo.uuids = filtrado ? Array.from(new Set(E.filas.map(function (f) { return f.uuid; }))) : null;
        }
        var boton = document.querySelector('.mod-acciones [data-excel="' + modo + '"]');
        var texto = boton.innerHTML;
        boton.disabled = true; boton.innerHTML = "<b>⏳</b>Generando…";
        try {
            var resp = await postJSON("/api/xml/excel", cuerpo);
            descargarBlob(await resp.blob(), nombreArchivo(resp, "reporte.xlsx"));
        } catch (e) { avisar(e.message); }
        boton.disabled = false; boton.innerHTML = texto;
    }

    /* Conciliación: se abre con la misma empresa, periodo y lado (lee la misma biblioteca). */
    function abrirConciliacion() {
        var r = rangoPeriodo();
        var lado = E.modulo === "recibidos" ? "recibidos" : "emitidos";
        if (E.modulo === "pagos") lado = E.sub === "recibidos" ? "recibidos" : "emitidos";
        var periodo = porFechas() ? (r.desde ? "&desde=" + r.desde : "") + (r.hasta ? "&hasta=" + r.hasta : "")
            : hayEleccion() ? "&anio=" + anioElegido() + "&meses=" + E.P.estado().meses.join(",") : "";
        location.href = "/herramientas/conciliacion/?rfc=" + encodeURIComponent(E.rfc) + "&lado=" + lado + "&base=emision" + periodo;
    }

    async function descargarZip() {
        var uuids = uuidsParaAcciones();
        var boton = $("btn-zip"), texto = boton.innerHTML;
        boton.disabled = true; boton.innerHTML = "<b>⏳</b>Preparando…";
        try {
            var resp = await postJSON("/api/xml/zip", { rfc: E.rfc, uuids: uuids });
            descargarBlob(await resp.blob(), nombreArchivo(resp, "xml.zip"));
        } catch (e) { avisar(e.message); }
        boton.disabled = false; boton.innerHTML = texto;
    }

    /* XML a PDF (representación impresa): uno = PDF; varios = ZIP (hasta 300). */
    async function descargarPdf() {
        var uuids = uuidsParaAcciones();
        if (uuids.length > 300) { avisar("Saca hasta 300 PDF a la vez: selecciona o filtra menos XML (hay " + uuids.length.toLocaleString("es-MX") + ")."); return; }
        var boton = $("btn-pdf"), texto = boton.innerHTML;
        boton.disabled = true; boton.innerHTML = "<b>⏳</b>Generando " + uuids.length + "…";
        try {
            var resp = uuids.length === 1
                ? await api("/api/xml/pdf?rfc=" + encodeURIComponent(E.rfc) + "&uuid=" + encodeURIComponent(uuids[0]))
                : await postJSON("/api/xml/pdfs", { rfc: E.rfc, uuids: uuids });
            descargarBlob(await resp.blob(), nombreArchivo(resp, uuids.length === 1 ? "cfdi.pdf" : "cfdi_pdf.zip"));
        } catch (e) { avisar(e.message); }
        boton.disabled = false; boton.innerHTML = texto;
    }

    /* Las listas negras viven en su herramienta: se abre en otra pestaña con esta empresa y este periodo. */
    function abrirListas() {
        var q = new URLSearchParams({ empresa: E.rfc || "" });
        var est = E.P.estado();
        if (porFechas()) { if (est.desde) q.set("desde", est.desde); if (est.hasta) q.set("hasta", est.hasta); }
        else if (hayEleccion()) { q.set("anio", est.anio); q.set("meses", est.meses.join(",")); }
        window.open("/herramientas/listas-sat/?" + q.toString(), "_blank", "noopener");
    }

    async function quitarSeleccion() {
        var n = E.seleccion.size;
        if (!confirm("¿Quitar " + n + " XML de la biblioteca de " + E.rfc + "?\n\nSe borran el archivo y su registro. Puedes volver a cargarlos después.")) return;
        try {
            await postJSON("/api/xml/quitar", { rfc: E.rfc, uuids: Array.from(E.seleccion) });
            E.seleccion.clear();
            await refrescarBibliotecas(E.rfc);
        } catch (e) { avisar(e.message); }
    }

    /* ============================================================ validar ante el SAT */
    var VAL = { reloj: null, siguiente: 0 };

    function estadoPorUuid() {
        var m = {};
        MODULOS.forEach(function (mod) { E.datos[mod.clave].filas.forEach(function (f) { m[f.uuid] = f.estado_sat || "Sin validar"; }); });
        return m;
    }

    function pedirValidacion() {
        var uuids = E.seleccion.size ? Array.from(E.seleccion) : Array.from(new Set(E.filas.map(function (f) { return f.uuid; })));
        if (!uuids.length) { avisar("No hay XML en la tabla para validar."); return; }
        var estados = estadoPorUuid();
        var faltan = uuids.filter(function (u) { return (estados[u] || "Sin validar") === "Sin validar"; });
        var yaVal = uuids.length - faltan.length;
        var origen = E.seleccion.size ? "seleccionados" : "de esta tabla";
        if (!yaVal) { iniciarValidacion(uuids); return; }
        $("modal-validar-texto").textContent = "De los " + uuids.length.toLocaleString("es-MX") + " XML " + origen + ", " +
            yaVal.toLocaleString("es-MX") + " ya se habían validado. ¿Qué quieres hacer?";
        $("modal-validar-acciones").innerHTML =
            (faltan.length ? '<button type="button" class="xml-btn xml-btn--primario" data-val="faltan">Validar solo los que faltan (' + faltan.length.toLocaleString("es-MX") + ")</button>" : "") +
            '<button type="button" class="xml-btn' + (faltan.length ? "" : " xml-btn--primario") + '" data-val="todos">Validar todos de nuevo (' + uuids.length.toLocaleString("es-MX") + ")</button>" +
            '<button type="button" class="xml-enlace" data-val="cancelar">Cancelar</button>';
        $("modal-validar").hidden = false;
        $("modal-validar-acciones").onclick = function (e) {
            var b = e.target.closest("[data-val]");
            if (!b) return;
            $("modal-validar").hidden = true;
            if (b.dataset.val === "faltan") iniciarValidacion(faltan);
            else if (b.dataset.val === "todos") iniciarValidacion(uuids);
        };
    }

    async function iniciarValidacion(uuids) {
        try {
            await apiJSON("/api/xml/validar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rfc: E.rfc, uuids: uuids }) });
        } catch (e) { avisar(e.message); return; }
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
            try { r = await apiJSON("/api/xml/validacion?desde=" + VAL.siguiente); } catch (e) { VAL.reloj = setTimeout(consultar, 4000); return; }
            if (r.estado === "ninguno") { $("avance-validacion").hidden = true; $("btn-validar").disabled = false; return; }
            VAL.siguiente = r.siguiente;
            aplicarCambiosSAT(r.cambios);
            var pct = r.total ? Math.round(100 * r.hechos / r.total) : 100;
            $("validando-barra").style.width = pct + "%";
            var c = r.conteo;
            var detalle = r.hechos.toLocaleString("es-MX") + " de " + r.total.toLocaleString("es-MX") + " · " + c.Vigente + " vigentes · " + c.Cancelado + " cancelados" +
                (c["No encontrado"] ? " · " + c["No encontrado"] + " no encontrados" : "") + (c.Error ? " · " + c.Error + " sin respuesta del SAT" : "");
            $("validando-detalle").textContent = detalle;
            if (r.estado === "corriendo") { $("validando-titulo").textContent = "Validando ante el SAT…"; VAL.reloj = setTimeout(consultar, 1500); return; }
            $("validando-titulo").textContent = r.estado === "detenido" ? "Validación detenida." : "Validación terminada.";
            $("avance-validacion").classList.add("xml-validando--listo");
            $("btn-detener").hidden = true;
            $("btn-validar").disabled = false;
            if (c.Error) $("validando-detalle").textContent = detalle + " — vuelve a validar esos más tarde.";
            VAL.reloj = setTimeout(function () { $("avance-validacion").hidden = true; }, 15000);
        })();
    }

    function aplicarCambiosSAT(cambios) {
        if (!cambios || !cambios.length) return;
        var m = {};
        cambios.forEach(function (c) { m[c.uuid] = c; });
        MODULOS.forEach(function (mod) {
            E.datos[mod.clave].filas.forEach(function (f) {
                var c = m[f.uuid];
                if (!c) return;
                f.estado_sat = c.estado_sat;
                f.estado_sat_en = c.estado_sat_en;
                var lista = (f.alertas ? f.alertas.split("; ") : []).filter(function (a) { return a !== "Cancelado en el SAT" && a !== "El SAT no lo encuentra"; });
                if (c.estado_sat === "Cancelado") lista.unshift("Cancelado en el SAT");
                if (c.estado_sat === "No encontrado") lista.unshift("El SAT no lo encuentra");
                if (lista.length) f.alertas = lista.join("; "); else delete f.alertas;
            });
        });
        pintarFilas(true);
    }

    async function reanudarValidacion() {
        try {
            var r = await apiJSON("/api/xml/validacion?desde=0");
            if (r.estado === "corriendo" && r.rfc === E.rfc) { VAL.siguiente = 0; seguirValidacion(); }
        } catch (e) { /* nada */ }
    }

    /* ============================================================ bandeja de carga */
    /* Los XML se leen en el navegador (también los de un ZIP) para mostrar un
       resumen antes de guardar. Nada llega al servidor hasta "Procesar", y solo
       se envían los XML de la empresa elegida. Los de otras empresas se quedan
       en la bandeja por si quieres procesarlos después para otra. */
    var GENERICOS = { XAXX010101000: 1, XEXX010101000: 1 };
    var LIMITE_LOTE = 40 * 1024 * 1024, LIMITE_ARCHIVOS = 400;
    var BJ = { xml: new Map(), invalidos: [], destino: null, cargandoZip: null, leyendo: 0, clientes: null };

    function abrirBandeja() {
        $("bandeja").hidden = false;
        pintarBandeja();
        if (BJ.clientes === null) {
            BJ.clientes = {};
            apiJSON("/api/clientes").then(function (lista) {
                lista.forEach(function (c) { BJ.clientes[c.rfc] = c.alias; });
                pintarBandeja();
            }).catch(function () { /* sin directorio: se ordena solo por frecuencia */ });
        }
    }

    function leerXML(nombre, bytes) {
        if (bytes.length > 5 * 1024 * 1024) { BJ.invalidos.push({ archivo: nombre, motivo: "Pesa más de 5 MB." }); return; }
        var texto = new TextDecoder("utf-8").decode(bytes);
        var doc = new DOMParser().parseFromString(texto, "application/xml");
        var raiz = doc.documentElement;
        if (!raiz || raiz.localName !== "Comprobante" || doc.getElementsByTagName("parsererror").length) {
            BJ.invalidos.push({ archivo: nombre, motivo: "No es un CFDI." }); return;
        }
        var tfd = doc.getElementsByTagNameNS("*", "TimbreFiscalDigital")[0];
        var em = doc.getElementsByTagNameNS("*", "Emisor")[0], re = doc.getElementsByTagNameNS("*", "Receptor")[0];
        function at(el, n) { return el ? (el.getAttribute(n) || el.getAttribute(n.charAt(0).toLowerCase() + n.slice(1)) || "") : ""; }
        var uuid = at(tfd, "UUID").toUpperCase();
        if (!uuid) { BJ.invalidos.push({ archivo: nombre, motivo: "No está timbrado." }); return; }
        BJ.xml.set(uuid, { nombre: nombre, bytes: bytes, tipo: at(raiz, "TipoDeComprobante"),
            er: at(em, "Rfc").toUpperCase(), en: at(em, "Nombre"), rr: at(re, "Rfc").toUpperCase(), rn: at(re, "Nombre") });
    }

    function cargarJSZip() {
        if (window.JSZip) return Promise.resolve();
        if (!BJ.cargandoZip) {
            BJ.cargandoZip = new Promise(function (ok, mal) {
                var sc = document.createElement("script");
                sc.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
                sc.onload = ok; sc.onerror = function () { BJ.cargandoZip = null; mal(new Error("No se pudo abrir el ZIP (falló la descarga del lector de ZIP).")); };
                document.head.appendChild(sc);
            });
        }
        return BJ.cargandoZip;
    }

    async function agregarArchivos(archivos) {
        abrirBandeja();
        var utiles = archivos.filter(function (f) { return /\.(xml|zip)$/i.test(f.name); });
        if (!utiles.length) { avisar("No encontré XML ni ZIP en lo que agregaste."); return; }
        var leyendo = $("leyendo");
        leyendo.hidden = false;
        leyendo.textContent = "Leyendo…";
        BJ.leyendo++;
        pintarBandeja();
        var hechos = 0;
        for (var i = 0; i < utiles.length; i++) {
            var f = utiles[i];
            try {
                if (/\.zip$/i.test(f.name)) {
                    await cargarJSZip();
                    var zip = await window.JSZip.loadAsync(f);
                    var entradas = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir && /\.xml$/i.test(n); });
                    for (var j = 0; j < entradas.length; j++) {
                        leerXML(entradas[j].split("/").pop(), await zip.files[entradas[j]].async("uint8array"));
                        if (++hechos % 50 === 0) { leyendo.textContent = "Leyendo… " + hechos + " XML"; await new Promise(function (r) { setTimeout(r, 0); }); }
                    }
                } else {
                    leerXML(f.name, new Uint8Array(await f.arrayBuffer()));
                    if (++hechos % 50 === 0) { leyendo.textContent = "Leyendo… " + hechos + " XML"; await new Promise(function (r) { setTimeout(r, 0); }); }
                }
            } catch (e) {
                BJ.invalidos.push({ archivo: f.name, motivo: e.message && e.message.indexOf("ZIP") !== -1 ? e.message : "No se pudo leer." });
            }
        }
        BJ.leyendo--;
        leyendo.hidden = BJ.leyendo <= 0;
        pintarBandeja();
    }

    function candidatos() {
        var cuenta = {}, nombres = {};
        BJ.xml.forEach(function (x) {
            var lista = x.tipo === "N" ? [x.er] : [x.er, x.rr];
            lista.forEach(function (r) {
                if (!r || GENERICOS[r]) return;
                cuenta[r] = (cuenta[r] || 0) + 1;
                if (!nombres[r]) nombres[r] = r === x.er ? x.en : x.rn;
            });
        });
        var mios = BJ.clientes || {};
        return Object.keys(cuenta).sort(function (a, b) { return (!!mios[b] - !!mios[a]) || (cuenta[b] - cuenta[a]); })
            .slice(0, 12)
            .map(function (r) { return { rfc: r, nombre: mios[r] || nombres[r], n: cuenta[r], cliente: !!mios[r] }; });
    }

    function deDestino(x, d) { return x.tipo === "N" ? x.er === d : (x.er === d || x.rr === d); }

    function pintarBandeja() {
        var caja = $("bandeja-resumen");
        if (!BJ.xml.size && !BJ.invalidos.length) { caja.innerHTML = ""; return; }
        var cands = candidatos();
        var actual = E.rfc;
        // Destino: el que ya elegiste; si no, la empresa que estás viendo (si aparece); si no, el RFC que más se repite
        if (!BJ.destino || !cands.some(function (c) { return c.rfc === BJ.destino; })) {
            BJ.destino = actual && cands.some(function (c) { return c.rfc === actual; }) ? actual : (cands[0] ? cands[0].rfc : null);
        }
        var d = BJ.destino;
        var n = { recibidos: 0, emitidos: 0, nomina: 0, pagos: 0, ajenos: 0 };
        BJ.xml.forEach(function (x) {
            if (!d || !deDestino(x, d)) { n.ajenos++; return; }
            if (x.tipo === "N") n.nomina++;
            else if (x.tipo === "P") n.pagos++;
            else if (x.er === d) n.emitidos++;
            else n.recibidos++;
        });
        var total = n.recibidos + n.emitidos + n.nomina + n.pagos;
        var opciones = cands.map(function (c) {
            return '<option value="' + esc(c.rfc) + '"' + (c.rfc === d ? " selected" : "") + ">" +
                esc((c.nombre || "Sin nombre") + " · " + c.rfc + " (" + c.n + " XML)" + (c.cliente ? "" : " · sin registrar")) + "</option>";
        }).join("");
        function cifra(v, t, ajena) { return v ? '<div class="xml-cifra' + (ajena ? " xml-cifra--ajena" : "") + '"><b>' + v.toLocaleString("es-MX") + "</b><span>" + t + "</span></div>" : ""; }
        caja.innerHTML = '<div class="xml-resumen">' +
            (cands.length ? '<div class="xml-resumen__destino">Estos XML son de <select id="sel-destino">' + opciones + "</select></div>" : "") +
            '<div class="xml-resumen__cifras">' +
                cifra(n.recibidos, "Recibidos") + cifra(n.emitidos, "Emitidos") + cifra(n.nomina, "Nómina") + cifra(n.pagos, "Pagos") +
                cifra(n.ajenos, "de otras empresas (no se cargan ahora)", true) + cifra(BJ.invalidos.length, "no son CFDI", true) +
            "</div>" +
            '<div class="xml-resumen__acciones">' +
                '<button type="button" id="btn-procesar" class="xml-btn xml-btn--primario"' + (total && !BJ.leyendo ? "" : " disabled") + ">" +
                    (BJ.leyendo ? "Leyendo archivos…" : "Procesar " + total.toLocaleString("es-MX") + " XML") + "</button>" +
                '<button type="button" id="btn-vaciar" class="xml-enlace">Vaciar bandeja</button>' +
            "</div></div>";
    }

    async function procesar() {
        var d = BJ.destino;
        var cand = candidatos().find(function (c) { return c.rfc === d; });
        var lista = [];
        BJ.xml.forEach(function (x, uuid) { if (deDestino(x, d)) lista.push([uuid, x]); });
        if (!lista.length) return;
        var lotes = [], actual = [], peso = 0;
        lista.forEach(function (par) {
            if (actual.length && (peso + par[1].bytes.length > LIMITE_LOTE || actual.length >= LIMITE_ARCHIVOS)) { lotes.push(actual); actual = []; peso = 0; }
            actual.push(par); peso += par[1].bytes.length;
        });
        if (actual.length) lotes.push(actual);

        var boton = $("btn-procesar");
        boton.disabled = true;
        var tot = { nuevos: 0, duplicados: 0, rechazados: [], tambien: {} };
        for (var i = 0; i < lotes.length; i++) {
            boton.textContent = "Procesando… " + Math.round(100 * i / lotes.length) + "%";
            var fd = new FormData();
            lotes[i].forEach(function (par) { fd.append("archivos", new Blob([par[1].bytes], { type: "application/xml" }), par[1].nombre); });
            fd.append("rfc", d);
            try {
                var r = await apiJSON("/api/xml/cargar", { method: "POST", body: fd });
                tot.nuevos += r.nuevos; tot.duplicados += r.duplicados;
                tot.rechazados = tot.rechazados.concat(r.rechazados);
                (r.tambien_de || []).forEach(function (t) {
                    var x = tot.tambien[t.rfc] = tot.tambien[t.rfc] || { rfc: t.rfc, nombre: t.nombre, uuids: [] };
                    x.uuids = x.uuids.concat(t.uuids);
                });
                lotes[i].forEach(function (par) { BJ.xml.delete(par[0]); });
            } catch (e) {
                tot.rechazados.push({ archivo: "Parte " + (i + 1) + " de " + lotes.length, motivo: e.message });
            }
        }
        var nombre = (cand && cand.nombre) || nombreDe(d);
        var preguntas = Object.keys(tot.tambien).map(function (k) {
            var t = tot.tambien[k];
            return '<div class="xml-pregunta" data-a="' + esc(t.rfc) + '" data-uuids="' + esc(t.uuids.join(",")) + '"><span><strong>' + t.uuids.length +
                "</strong> de estos XML también son de <strong>" + esc(t.nombre || t.rfc) + "</strong> (" + esc(t.rfc) + "), que está en tu directorio. ¿Agregarlos también a su biblioteca?</span>" +
                '<button type="button" class="xml-btn" data-copiar="si">Sí, agregar</button><button type="button" class="xml-enlace" data-copiar="no">No</button></div>';
        }).join("");
        $("resultado-carga").innerHTML = '<div class="xml-resultado' + (tot.rechazados.length ? " xml-resultado--error" : "") + '" data-de="' + esc(d) + '">' +
            '<button type="button" class="xml-resultado__cerrar" title="Cerrar" data-cerrar-resultado>×</button>' +
            "<strong>" + esc(nombre) + ": " + tot.nuevos.toLocaleString("es-MX") + " XML nuevos guardados" + (tot.duplicados ? " · " + tot.duplicados + " ya estaban" : "") + "</strong>" +
            (tot.rechazados.length ? "<ul>" + tot.rechazados.slice(0, 15).map(function (r) { return "<li>" + esc(r.archivo) + " — " + esc(r.motivo) + "</li>"; }).join("") + "</ul>" : "") +
            preguntas + (BJ.xml.size ? '<p style="margin-top:8px">Quedaron ' + BJ.xml.size.toLocaleString("es-MX") +
                ' XML de otras empresas en la bandeja. <button type="button" class="xml-enlace" data-abrir-bandeja>Abrir la bandeja</button></p>' : "") + "</div>";
        pintarBandeja();
        // Si no estabas viendo ninguna biblioteca, se abre la que acabas de cargar
        await refrescarBibliotecas(E.rfc && E.contribuyentes.some(function (c) { return c.rfc === E.rfc; }) ? E.rfc : d);
        // Al procesar, la bandeja se cierra: ya estás administrando. Lo que quedó de otras empresas espera ahí.
        if (!BJ.xml.size) BJ.invalidos = [];
        $("bandeja").hidden = true;
    }

    async function responderCopia(boton) {
        var caja = boton.closest(".xml-pregunta");
        if (boton.dataset.copiar === "no") { caja.remove(); return; }
        boton.disabled = true;
        try {
            var r = await apiJSON("/api/xml/copiar", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ de_rfc: boton.closest("[data-de]").dataset.de, a_rfc: caja.dataset.a, uuids: caja.dataset.uuids.split(",") }) });
            caja.innerHTML = "<span>Listo: se agregaron " + r.copiados + " XML a la biblioteca de " + esc(caja.dataset.a) + ".</span>";
        } catch (e) { boton.disabled = false; avisar(e.message); }
    }

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

    async function archivosDeSoltar(e) {
        var archivos = [];
        var items = e.dataTransfer.items;
        if (items && items.length && items[0].webkitGetAsEntry) {
            var entradas = Array.prototype.map.call(items, function (it) { return it.webkitGetAsEntry(); }).filter(Boolean);
            await Promise.all(entradas.map(function (en) { return leerEntrada(en, archivos); }));
        } else {
            archivos = Array.prototype.slice.call(e.dataTransfer.files);
        }
        return archivos;
    }

    function prepararBandeja() {
        $("btn-agregar").addEventListener("click", function () { if ($("bandeja").hidden) abrirBandeja(); else $("bandeja").hidden = true; });
        $("cerrar-bandeja").addEventListener("click", function () { $("bandeja").hidden = true; });
        $("in-archivos").addEventListener("change", function (e) { agregarArchivos(Array.prototype.slice.call(e.target.files)); e.target.value = ""; });
        $("in-carpeta").addEventListener("change", function (e) { agregarArchivos(Array.prototype.slice.call(e.target.files)); e.target.value = ""; });
        $("bandeja-resumen").addEventListener("change", function (e) { if (e.target.id === "sel-destino") { BJ.destino = e.target.value; pintarBandeja(); } });
        $("bandeja-resumen").addEventListener("click", function (e) {
            if (e.target.id === "btn-procesar") procesar();
            if (e.target.id === "btn-vaciar") { BJ.xml.clear(); BJ.invalidos = []; BJ.destino = null; pintarBandeja(); }
        });
        $("resultado-carga").addEventListener("click", function (e) {
            if (e.target.closest("[data-cerrar-resultado]")) { $("resultado-carga").innerHTML = ""; return; }
            if (e.target.closest("[data-abrir-bandeja]")) { abrirBandeja(); return; }
            var b = e.target.closest("[data-copiar]"); if (b) responderCopia(b);
        });
        // Soltar archivos en cualquier parte de la página
        var profundidad = 0, velo = $("velo-soltar");
        function conArchivos(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") !== -1; }
        document.addEventListener("dragenter", function (e) { if (!conArchivos(e)) return; e.preventDefault(); profundidad++; velo.hidden = false; });
        document.addEventListener("dragover", function (e) { if (conArchivos(e)) e.preventDefault(); });
        document.addEventListener("dragleave", function (e) { if (!conArchivos(e)) return; if (--profundidad <= 0) { profundidad = 0; velo.hidden = true; } });
        document.addEventListener("drop", async function (e) {
            if (!conArchivos(e)) return;
            e.preventDefault(); profundidad = 0; velo.hidden = true;
            agregarArchivos(await archivosDeSoltar(e));
        });
    }

    /* ============================================================ eventos */
    function cerrarMenus(excepto) {
        ["menu-vistas", "menu-filtros", "menu-otra"].forEach(function (id) { if (id !== excepto) $(id).hidden = true; });
    }

    function prepararEventos() {

        $("btn-otra").addEventListener("click", function (e) {
            e.stopPropagation(); cerrarMenus("menu-otra");
            $("menu-otra").hidden = !$("menu-otra").hidden;
            if (!$("menu-otra").hidden) pintarMenuOtra();
        });
        $("menu-otra").addEventListener("click", function (e) { e.stopPropagation(); var b = e.target.closest("button"); if (b) accionMenuOtra(b); });
        $("btn-validar").addEventListener("click", pedirValidacion);
        $("btn-conciliacion").addEventListener("click", abrirConciliacion);
        $("btn-detener").addEventListener("click", function () { apiJSON("/api/xml/validacion/detener", { method: "POST" }).catch(function () {}); });
        $("modal-validar").addEventListener("click", function (e) { if (e.target.id === "modal-validar") $("modal-validar").hidden = true; });
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") { $("modal-validar").hidden = true; $("panel-columnas").hidden = true; } });
        $("avanzados").addEventListener("input", function (e) {
            var k = e.target.dataset.av; if (!k) return;
            E.av[k] = e.target.value; pintarRapidos(); aplicar();
        });
        $("sin-empresa").addEventListener("click", function (e) {
            var b = e.target.closest("button");
            if (!b) return;
            if (b.dataset.otra) { refrescarBibliotecas(b.dataset.otra); return; }
            if (b.hasAttribute("data-agregar")) { abrirBandeja(); return; }
            if (b.hasAttribute("data-elegir")) { e.stopPropagation(); cerrarMenus("menu-otra"); $("menu-otra").hidden = false; pintarMenuOtra(); }
        });
        $("aviso-otra").addEventListener("click", function (e) { if (e.target.id === "volver-empresa") { E.otra = null; E.rfc = null; refrescarBibliotecas(); } });
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
        $("quitar-filtros").addEventListener("click", function () { E.rapidos = {}; E.av = {}; pintarRapidos(); pintarAvanzados(); aplicar(); });
        var reloj = null;
        $("buscar").addEventListener("input", function () {
            clearTimeout(reloj);
            var v = this.value;
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
        $("menu-vistas").addEventListener("click", function (e) { var b = e.target.closest("[data-accion]"); if (b) accionVista(b.dataset.accion, b.dataset.nombre); });
        document.querySelector(".mod-acciones").addEventListener("click", function (e) {
            var b = e.target.closest("[data-excel]"); if (b && !b.disabled) exportarExcel(b.dataset.excel);
        });
        $("btn-zip").addEventListener("click", descargarZip);
        $("btn-listas").addEventListener("click", abrirListas);
        $("btn-pdf").addEventListener("click", descargarPdf);
        $("btn-quitar").addEventListener("click", quitarSeleccion);
        $("btn-limpiar-sel").addEventListener("click", function () { E.seleccion.clear(); pintarTabla(); });
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
