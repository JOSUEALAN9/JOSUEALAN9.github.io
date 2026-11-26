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

    /* 18-nov (el dueño: «administración de xml solo emitidas y recibidas, nómina aparte»): esta página enseña Recibidos y
       Emitidos. La misma tabla se abre con ?vista=nomina («Recibos de nómina», en el menú) o ?vista=pagos (la pestaña
       «Complementos de pago» de Conciliación de pagos): entonces solo trae esa pestaña. Ver vista.js. */
    var VISTA = (function () { var v = new URLSearchParams(location.search).get("vista"); return v === "nomina" || v === "pagos" ? v : ""; })();
    var MODULOS = [
        { clave: "recibidos", nombre: "Recibidos" },
        { clave: "emitidos", nombre: "Emitidos" },
        { clave: "nomina", nombre: "Nómina" },
        { clave: "pagos", nombre: "Pagos" }
    ].filter(function (m) { return VISTA ? m.clave === VISTA : (m.clave === "recibidos" || m.clave === "emitidos"); });
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
        estado_pago: 120, estado_sat: 100, forma_pago: 210, forma_pago_p: 210, uso_cfdi: 190, docto_encontrado: 90,
        // 17-nov: la vista de fábrica trae muchas columnas (como el reporte completo); las de dato corto van angostas
        serie: 74, folio: 88, version: 72, tipo_desc: 104, moneda: 78, moneda_saldo: 84, tipo_cambio: 92, exportacion: 124,
        lugar_expedicion: 96, estado_expedicion: 128, metodo_pago: 96, num_conceptos: 84, num_pagos: 84, emisor_rfc: 128,
        receptor_rfc: 128, pac_rfc: 122, receptor_domicilio: 84, tipo_relacion: 168, cfdi_relacionados: 150,
        emisor_regimen: 200, receptor_regimen: 200, no_cert_sat: 172, no_cert_emisor: 172, claves_prod_serv: 150, alertas: 200,
        // 19-nov-2026: nómina (régimen con su descripción y el grupo corto) y pagos
        tipo_nomina: 120, tipo_regimen: 210, grupo_nomina: 110, docto_serie_folio: 120, docto_uuid: 130 };

    var E = {
        contribuyentes: [], rfc: null, periodo: "", datos: null, P: null, cuentas: {}, cargado: null,
        modulo: "recibidos", sub: "", rapidos: {}, busqueda: "",
        orden: { clave: null, dir: 1 }, seleccion: new Set(),
        columnas: {}, vistas: [], vistaSel: {}, inicial: {}, f2Columnas: null, f2Hecho: {},
        filas: [], altoFila: 35, av: {}, otras: [], clientesLista: null,
        pagosPor: "emision"            // pestaña Pagos: periodo por fecha de "emision" o de "pago" (FechaPago)
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
    function postJSON(ruta, cuerpo, extra) {
        return api(ruta, Object.assign({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }, extra || {}));
    }
    /* 23-nov-2026 (auditoría web-3 y web-4): las partes de la carga son seguras de repetir (el servidor no guarda dos veces
       el mismo XML) y son un trabajo que inició la persona: la pantalla no se bloquea mientras suben y, si se bloquea, la
       carga espera al desbloqueo y sigue donde iba (nucleo.js). */
    var PARTE = { fcRepetible: true, fcTrabajo: true };
    function avisar(texto, tipo) { Fiscontable.aviso ? Fiscontable.aviso(texto) : Fiscontable.avisar(texto); }
    // 26-nov-2026 (el dueño): lo que salió bien, verde y junto a lo que se pulsó (o a «cerca»); se quita solo
    function listo(texto, cerca) { if (Fiscontable.listo) Fiscontable.listo(texto, cerca); else avisar(texto); }
    function guardarLocal(clave, valor) { try { localStorage.setItem("xml:" + clave, JSON.stringify(valor)); } catch (e) { /* nada */ } }
    function leerLocal(clave) { try { return JSON.parse(localStorage.getItem("xml:" + clave)); } catch (e) { return null; } }
    function borrarLocal(clave) { try { localStorage.removeItem("xml:" + clave); } catch (e) { /* nada */ } }
    E.pagosPor = leerLocal("pagosPor") === "pago" ? "pago" : "emision";
    E.ocultarVacias = leerLocal("ocultarVacias") === true;          // 25-nov-2026: solo la pantalla, en este navegador
    // Importes en pesos en la tabla: con «Usar esto siempre» arranca así; si no, en su moneda hasta que lo pidas
    E.moneda = (function () { var p = Fiscontable.monedaReportes.leer(); return p.siempre ? p.modo : ""; })();
    E.convertido = {};
    function descargarBlob(blob, nombre) { Fiscontable.guardarArchivo(blob, nombre); }
    function nombreArchivo(resp, porDefecto) {
        var cd = resp.headers.get("Content-Disposition") || "";
        var u = cd.match(/filename\*=UTF-8''([^;]+)/i);          // el nombre con acentos («Nómina») viene aquí
        if (u) { try { return decodeURIComponent(u[1]); } catch (e) { /* se usa el otro */ } }
        var m = cd.match(/filename="?([^";]+)"?/);
        return m ? m[1] : porDefecto;
    }
    var MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

    /* ============================================================ arranque */
    document.addEventListener("DOMContentLoaded", iniciar);

    async function iniciar() {
        if (!(await Fiscontable.exigirModulo("validador"))) return;
        Fiscontable.perfil().then(function (pf) {          // Marcas fiscales y Cancelaciones tienen su propio permiso
            var m = (pf && pf.modulos_permitidos) || [];
            $("btn-fiscal").hidden = m.indexOf("marcas") === -1;
            E.enDespacho = ((pf && pf.espacio) || {}).tipo === "despacho";
            $("btn-cancelaciones").hidden = m.indexOf("cancelaciones") === -1;
        });
        prepararBandeja();
        retomarTodas();
        // Periodo de ESTA página (cuadros de año, meses y fechas; el mismo de Conciliación y Listas)
        E.P = FCPeriodoMeses.crear({ contenedor: $("periodo-xml"), alCambiar: function () { alCambiarPeriodo(); }, alAvisar: avisar,
                                     conBoton: true, alcanza: periodoYaCargado });
        prepararEventos();
        // 18-nov: «Ampliar» deja solo la tabla (buscador, filtros, lo seleccionado y el avance de la validación)
        Fiscontable.ampliar({ en: ".xml-toolbar__der", quedan: [".xml-toolbar", "#filtros-activos", "#aviso-moneda", "#avance-validacion", "#barra-seleccion", "#tabla-marco", ".xml-pie"] });
        var perfil = await Fiscontable.perfil();
        $("btn-conciliacion").hidden = !(perfil && (perfil.modulos_permitidos || []).indexOf("conciliacion") !== -1);
        // 23-nov-2026: las columnas de marcas fiscales solo para quien tiene Marcas fiscales (las demás, como siempre)
        E.sinMarcas = !(perfil && (perfil.rol === "admin" || (perfil.modulos_permitidos || []).indexOf("marcas") !== -1));
        E.enDespacho = ((perfil && perfil.espacio) || {}).tipo === "despacho";
        await cargarVistas();
        E.empresa = await Fiscontable.empresaActiva();
        E.urlPeriodo = Fiscontable.periodoDeUrl();
        var tab = Fiscontable.url("tab");
        if (!VISTA && (tab === "nomina" || tab === "pagos")) {            // un enlace de antes: esas pestañas ya viven en su propia vista
            var qv = new URLSearchParams(location.search); qv.delete("tab"); qv.set("vista", tab);
            location.replace(location.pathname + "?" + qv.toString()); return;
        }
        if (VISTA) {
            E.modulo = VISTA;
            $("xml-titulo").textContent = VISTA === "nomina" ? "Recibos de nómina" : "Conciliación de pagos";
            $("pestanas").hidden = true;                                   // una sola pestaña: no hace falta la barra
            document.querySelectorAll('[data-excel="completo"]').forEach(function (b) { b.hidden = true; });
            if (VISTA === "pagos" && window.FCPestanasConc) FCPestanasConc.pintar($("conc-vista"), "pagos", null, function () { return E.rfc || ""; });
        } else if (tab && MODULOS.some(function (m) { return m.clave === tab; })) E.modulo = tab;
        E.periodoGeneral = await Fiscontable.periodoActivo();
        // Periodo de ESTA página (como en Mi Admin): año + meses, varios a la vez. Arranca en
        // el general; cambiarlo aquí no mueve el general.
        await refrescarBibliotecas();
        // Si cambias de empresa en la barra, la página se actualiza automáticamente
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
        // G-02: la empresa activa ya está en la barra de arriba; aquí solo queda «Otro contribuyente ▾»
        var soloOtro = !!(rfc && !E.otra);
        boton.classList.toggle("ctx-campo--discreto", soloOtro);
        if (soloOtro) { $("empresa-etiqueta").textContent = ""; $("empresa-titulo").textContent = "Cambiar empresa"; }
        boton.title = rfc ? "Cambiar de empresa" : "Elige de quién son los XML";
        var aviso = $("aviso-otra");
        aviso.hidden = !E.otra;
        if (E.otra) {
            aviso.innerHTML = "<strong>" + esc(nombreDe(E.otra)) + "</strong> no está en tu directorio: sus XML se borran automáticamente " + Fiscontable.textoPlazo("xml_sin_registrar") + " después de la última carga." +
                ' <a class="xml-enlace" href="/clientes/">Registrarla como cliente</a>' +
                (E.empresa ? ' <button type="button" class="xml-enlace" id="volver-empresa">Volver a ' + esc(E.empresa.alias || E.empresa.rfc) + "</button>" : "");
        }
    }

    function mostrarVacio() {
        $("contenido").hidden = true;
        $("btn-agregar").hidden = true;          // el aviso de abajo ya trae su botón: no dos «Agregar XML»
        var caja = $("sin-empresa");
        caja.hidden = false;
        if (E.empresa) {
            caja.innerHTML = '<p class="ctx-vacio__titulo">' + esc(E.empresa.alias || E.empresa.rfc) + " todavía no tiene XML</p>" +
                "<p>Agrega sus XML, una carpeta o el ZIP de la descarga masiva del SAT. Nada se guarda hasta que presiones <strong>Procesar</strong>.</p>" +
                '<div class="ctx-vacio__acciones"><button type="button" class="xml-btn xml-btn--primario" data-agregar>+ Agregar XML</button></div>';
        } else {
            caja.innerHTML = '<p class="ctx-vacio__titulo">¿De quién son los XML?</p>' +
                "<p>Elige una de tus empresas. Para trabajar con otro RFC, primero dalo de alta en Clientes (cuenta en el tope de tu plan).</p>" +
                '<div class="ctx-vacio__acciones"><button type="button" class="xml-btn xml-btn--primario" data-elegir>Elegir empresa</button>' +
                '<a class="xml-btn" href="/clientes/">+ Registrar empresa</a></div>';
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
        if (E.otras.length) h.push('<div class="xml-separador"></div><div class="xml-otra__grupo">Sin registrar · solo consulta, se borran a los ' + Fiscontable.textoPlazo("xml_sin_registrar") + '</div>');
        E.otras.forEach(function (c) {
            var dia = c.expira ? c.expira.slice(8, 10) + "/" + c.expira.slice(5, 7) : "";
            h.push('<div class="xml-otra__fila"><button type="button" data-otra="' + esc(c.rfc) + '"' + (c.rfc === E.rfc ? ' class="xml-activa"' : "") + ">" +
                esc(c.nombre || "Sin nombre") + " <span>" + esc(c.rfc) + (dia ? " · se borra el " + dia : "") + "</span></button>" +
                '<button type="button" class="xml-otra__borrar" data-borrar="' + esc(c.rfc) + '">Borrar</button></div>');
        });
        h.push('<div class="xml-separador"></div><button type="button" data-ir="/clientes/">+ Registrar empresa <span>Para trabajar con otro RFC, primero dalo de alta</span></button>');
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
            if (!(await Fiscontable.preguntar("¿Borrar ya todos los XML de " + nombreDe(rfc) + " (" + rfc + ")?\n\nNo está en tu directorio; no quedará registro."))) return;
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
        E.cuentasPago = null;                                  // por mes de pago: se vuelven a pedir
        (c.periodos || []).forEach(function (p) { if (p.periodo) E.cuentas[p.periodo] = { n: p.n, modulos: p.modulos || {} }; });
        E.cargado = null;
        // Con F5 o un enlace se vuelve al mismo periodo; si no, el periodo general
        var deUrl = E.urlPeriodo;
        E.urlPeriodo = null;
        var actual = E.P.hayEleccion() ? E.P.estado() : null;      // al cambiar de empresa se queda el periodo que veías
        E.P.poner(deUrl || actual || (E.periodoGeneral ? { anio: E.periodoGeneral.slice(0, 4), meses: [E.periodoGeneral.slice(5, 7)] } : null));
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
        if (E.modulo === "pagos" && E.pagosPor === "pago") return (E.cuentasPago || {})[periodo] || 0;   // por mes de pago
        var c = E.cuentas[periodo];
        return c ? (c.modulos[E.modulo] || 0) : 0;
    }

    /* Números de los meses en Pagos por fecha de pago: se piden una vez por empresa. */
    async function cargarCuentasPago() {
        if (!E.rfc || E.pagosPor !== "pago" || (E.cuentasPago && E.cuentasPagoRfc === E.rfc)) return;
        try { E.cuentasPago = await apiJSON("/api/xml/pagos-por-mes?rfc=" + encodeURIComponent(E.rfc)); E.cuentasPagoRfc = E.rfc; }
        catch (e) { E.cuentasPago = {}; }
        pintarPeriodo();
    }

    // Los números de los cuadros son de la pestaña en la que estás
    function pintarPeriodo() {
        var m = {};
        Object.keys(E.cuentas || {}).forEach(function (p) { m[p] = cuantos(p); });
        E.P.conteos(m);
    }

    /* Si lo elegido cabe en lo que ya se cargó, se filtra aquí; si no, se pide al servidor. */
    // ¿Lo elegido cabe en lo que ya se trajo? Entonces se filtra aquí, sin botón ni espera.
    function rangoCubierto() {
        var r = rangoPeriodo();
        return !!(E.cargado && E.cargado.rfc === E.rfc && hayEleccion() && !porFechas() && !E.cargado.fechas && E.cargado.pagosPor === E.pagosPor &&
            r.desde >= E.cargado.desde && r.hasta <= E.cargado.hasta);
    }
    /* 18-nov: cada pestaña se pide al abrirla (el servidor arma solo esa). Lo elegido ya está aquí si el periodo cabe en
       lo cargado Y esta pestaña ya se trajo. */
    function moduloCargado(m) { return !!(E.modsCargados && E.modsCargados[m]); }
    function periodoYaCargado() { return rangoCubierto() && moduloCargado(E.modulo); }

    /* Aviso sobre la tabla (17-nov): mientras llega un periodo se ve «Cargando…» y la tabla anterior se atenúa (para que no se
       confunda con la nueva); al llegar dice «Actualizado · periodo · cuántos XML» unos segundos. */
    var CARGA = Fiscontable.avisoCarga($("tabla-marco"), { atenuar: true, junto: $("acciones-alcance") });      // arriba, junto a «Sobre los N XML que ves»
    function periodoCorto() { var t = textoPeriodo(); return t.length > 34 ? "los meses elegidos" : t; }     // muchos meses sueltos no caben en la etiqueta
    function mostrarCarga() {
        if (hayEleccion()) CARGA.mostrar("Cargando " + periodoCorto() + "…", "Sigue cargando " + periodoCorto() + "… un periodo grande tarda un poco más.");
        else CARGA.mostrar("Cargando…");
    }
    function quitarCarga() { CARGA.quitar(); }
    function avisarListo() {
        if (!hayEleccion()) return CARGA.quitar();
        var total = MODULOS.reduce(function (t, m) { return t + (cuentaPestana(m.clave) || 0); }, 0);
        CARGA.listo("Actualizado · " + periodoCorto() + " · " + total.toLocaleString("es-MX") + " XML");
        // Desde Visores («Revisar y marcar»): …&duplicados=1 abre el diálogo en cuanto está el periodo, una sola vez
        if (ABRIR_DUPLICADOS) { ABRIR_DUPLICADOS = false; abrirDuplicados(); }
    }
    var ABRIR_DUPLICADOS = new URLSearchParams(location.search).get("duplicados") === "1";

    function alCambiarPeriodo() {
        E.seleccion.clear();
        Fiscontable.url(Fiscontable.periodoAUrl(E.P.estado(), porFechas()));
        // 17-nov (el dueño: todo el año → quitar todo → octubre, y la tabla salió vacía). Al quitar todos los meses se pedía al
        // servidor «nada» y esa respuesta, si llegaba después de elegir octubre (que ya estaba cargado y se pinta al
        // instante), borraba la tabla. Ahora: sin periodo elegido y con datos de esta empresa no se pide nada (lo cargado
        // se conserva), y cualquier carga que siga en camino se descarta cuando lo elegido se resuelve aquí.
        var sinEleccion = !hayEleccion() && !porFechas() && E.datos && E.cargado && E.cargado.rfc === E.rfc;
        if (periodoYaCargado() || sinEleccion) {
            E.nCarga = (E.nCarga || 0) + 1;
            pintarPeriodo(); pintarPestanas(); pintarSubfiltros(); aplicar();
            if (sinEleccion) quitarCarga(); else avisarListo();
        } else {
            cargarRegistros();
        }
    }

    /* opciones.pestana: se abrió una pestaña que aún no se había traído. Se pide con el mismo periodo que ya está cargado
       (si lo elegido cabe en él) y se SUMA a lo que hay; cualquier otra carga empieza de cero, porque algo pudo cambiar. */
    async function cargarRegistros(opciones) {
        if (!E.rfc) return;
        $("sin-empresa").hidden = true;
        $("btn-agregar").hidden = false;
        $("contenido").hidden = false;
        pintarPeriodo();
        var dePestana = !!(opciones && opciones.pestana), moduloPedido = E.modulo;
        var r = dePestana && rangoCubierto() ? { desde: E.cargado.desde, hasta: E.cargado.hasta } : rangoPeriodo();
        // Sin elección no se trae ningún XML (solo la forma de la tabla)
        var desde = hayEleccion() ? r.desde : "1900-01-01", hasta = hayEleccion() ? r.hasta : "1900-01-01";
        var q = "?rfc=" + encodeURIComponent(E.rfc) + (desde ? "&desde=" + desde : "") + (hasta ? "&hasta=" + hasta : "") +
            (E.pagosPor === "pago" ? "&pagos_por=pago" : "") + (E.moneda ? "&convertir=" + E.moneda : "") + "&solo=" + moduloPedido;
        var clavePedido = [E.rfc, desde, hasta, E.pagosPor, E.moneda || ""].join("|");
        $("conteo-filas").textContent = "Cargando…";
        mostrarCarga();
        var yo = (E.nCarga = (E.nCarga || 0) + 1), rfcPedido = E.rfc;     // si cambias el periodo mientras carga, gana el último
        var pedido = { hay: hayEleccion(), fechas: porFechas(), pagosPor: E.pagosPor };       // lo que se pidió (no lo que haya elegido al llegar)
        try {
            var respuesta = await apiJSON("/api/xml/registros" + q), llegaron = respuesta.modulos;
            if (yo !== E.nCarga || rfcPedido !== E.rfc) return;
            var trae = respuesta.solo || MODULOS.map(function (m) { return m.clave; });     // un servidor anterior responde todo
            if (dePestana && E.datos && E.claveCargada === clavePedido) {
                trae.forEach(function (m) { E.datos[m] = llegaron[m]; E.modsCargados[m] = true; });
            } else {
                E.datos = llegaron; E.modsCargados = {};
                trae.forEach(function (m) { E.modsCargados[m] = true; });
            }
            E.claveCargada = clavePedido;
            E.conteos = respuesta.conteos || null;                // cuántos XML tiene cada pestaña (las que aún no se abren)
            E.banxico = respuesta.banxico || {};                  // para ofrecer el tipo de cambio del DOF al sacar el Excel
            E.convertido = respuesta.convertido || {};            // {modo, con, convertidas, sin_tc} si la tabla viene en pesos
        } catch (e) { if (yo === E.nCarga) { quitarCarga(); $("conteo-filas").textContent = "No se pudo cargar."; avisar(e.message); } return; }
        E.cargado = pedido.hay ? { rfc: E.rfc, desde: r.desde, hasta: r.hasta, fechas: pedido.fechas, pagosPor: pedido.pagosPor } : null;
        Fiscontable.url(Fiscontable.periodoAUrl(E.P.estado(), porFechas()));
        cargarCuentasPago();
        E.seleccion.clear();
        pintarPestanas();
        cambiarModulo(E.modulo, true);
        pintarMoneda();
        avisarListo();
        reanudarValidacion();
    }

    /* Trae, sin cambiar de pestaña, las que falten del periodo ya cargado (p. ej. antes del Excel completo, que pregunta
       por las monedas de todas). Si algo falla, se sigue con lo que hay. */
    async function traerPestanas(lista) {
        var faltan = lista.filter(function (m) { return !moduloCargado(m); });
        if (!faltan.length || !E.cargado || !E.datos) return;
        var yo = E.nCarga, clave = E.claveCargada;
        try {
            var resp = await apiJSON("/api/xml/registros?rfc=" + encodeURIComponent(E.rfc) + "&desde=" + E.cargado.desde + "&hasta=" + E.cargado.hasta +
                (E.pagosPor === "pago" ? "&pagos_por=pago" : "") + (E.moneda ? "&convertir=" + E.moneda : "") + "&solo=" + faltan.join(","));
            if (yo !== E.nCarga || clave !== E.claveCargada) return;
            (resp.solo || faltan).forEach(function (m) { E.datos[m] = resp.modulos[m]; E.modsCargados[m] = true; });
            pintarPestanas();
        } catch (e) { /* se sigue con lo cargado */ }
    }

    /* Las acciones de arriba usan lo seleccionado; si no hay selección, lo que ves. */
    function uuidsParaAcciones() {
        if (E.seleccion.size) return Array.from(E.seleccion);
        return Array.from(new Set((E.filas || []).map(function (f) { return f.uuid; })));
    }

    function pintarAlcance() {
        var n = uuidsParaAcciones().length;
        $("acciones-alcance").textContent = !n ? "No hay XML en la tabla."
            : E.seleccion.size ? (n === 1 ? "Sobre el seleccionado." : "Sobre los " + n.toLocaleString("es-MX") + " seleccionados.")
            : (n === 1 ? "Sobre el XML que ves." : "Sobre los " + n.toLocaleString("es-MX") + " XML que ves.");
        $("btn-zip").disabled = $("btn-pdf").disabled = $("btn-zip-completo").disabled = $("btn-compartir").disabled = !n;
        // 25-nov-2026 (el dueño): «Formato 2 para importar (sin títulos)» solo aparece con una vista de «Formato 2»
        var imp = document.querySelector('.mod-acciones [data-excel="importar"]');
        if (imp) imp.hidden = !(conF2() && baseActual() === "formato2") || enConceptos();
    }

    /* ============================================================ minimódulos */
    /* El número de cada pestaña: de lo cargado si ya se abrió; si no, de las cuentas por mes (o de lo que dijo el servidor
       cuando el periodo es por fechas). null = todavía no se sabe (no se pinta número). */
    function cuentaPestana(m) {
        if (moduloCargado(m)) return contarUuid(filasPeriodo(m));
        if (!hayEleccion()) return 0;
        var meses = mesesElegidos();
        if (meses && meses.length) {
            return meses.reduce(function (t, p) {
                if (m === "pagos" && E.pagosPor === "pago") return t + ((E.cuentasPago || {})[p] || 0);
                var c = E.cuentas && E.cuentas[p];
                return t + (c ? (c.modulos[m] || 0) : 0);
            }, 0);
        }
        return E.conteos && E.conteos[m] !== null && E.conteos[m] !== undefined ? E.conteos[m] : null;
    }
    function contarUuid(filas) {
        var s = new Set();
        filas.forEach(function (f) { s.add(f.uuid); });
        return s.size;
    }

    function pintarPestanas() {
        $("pestanas").innerHTML = MODULOS.map(function (m) {
            var n = cuentaPestana(m.clave);
            return '<button type="button" role="tab" class="pestana' + (m.clave === E.modulo ? " pestana--activa" : "") + '" aria-selected="' + (m.clave === E.modulo) + '" data-modulo="' + m.clave + '">' +
                m.nombre + (n === null ? "" : '<span class="xml-cuenta">' + n + "</span>") + "</button>";
        }).join("") + (enConceptos() ? '<button type="button" role="tab" class="pestana pestana--activa" aria-selected="true" data-modulo="conceptos">Conceptos' +
            '<span class="xml-cuenta xc-cerrar" data-cerrar-conceptos title="Cerrar el reporte">✕</span></button>' : "");
        if (enConceptos()) document.querySelectorAll('#pestanas .pestana:not([data-modulo="conceptos"])').forEach(function (b) { b.classList.remove("pestana--activa"); b.setAttribute("aria-selected", "false"); });
        pintarBotonConceptos();
    }
    function pintarBotonConceptos() {
        var ver = E.modulo === "recibidos" || E.modulo === "emitidos";
        if ($("btn-conceptos")) $("btn-conceptos").hidden = !ver;
        if ($("btn-duplicados")) $("btn-duplicados").hidden = !(ver || E.modulo === "nomina");      // 18-nov: también en Recibos de nómina
    }
    function abrirDuplicados() {
        if (!E.rfc || !hayEleccion()) return avisar("Elige empresa y periodo para buscar duplicados.");
        if (E.modulo !== "recibidos" && E.modulo !== "emitidos" && E.modulo !== "nomina") return;
        var r = rangoPeriodo();
        XMLDuplicados.abrir({ rfc: E.rfc, lado: E.modulo, desde: r.desde, hasta: r.hasta, periodo: textoPeriodo() });
    }

    /* Reporte por conceptos (herramientas/xml/conceptos.js): toma la empresa, el periodo y las facturas que se ven */
    function enConceptos() { return !!(window.XMLConceptos && XMLConceptos.abierto()); }
    function abrirConceptos() {
        if (!E.rfc || !hayEleccion()) return avisar("Elige empresa y periodo para armar el reporte.");
        if (E.modulo !== "recibidos" && E.modulo !== "emitidos") return;
        var r = rangoPeriodo();
        var filtrado = E.busqueda.trim() || E.sub || Object.keys(E.rapidos).some(function (k) { return E.rapidos[k]; }) || Object.keys(E.av).some(function (k) { return E.av[k]; });
        $("contenido").classList.add("xml--conceptos");
        XMLConceptos.abrir({
            rfc: E.rfc, lado: E.modulo, desde: r.desde, hasta: r.hasta, meses: mesesElegidos(), periodo: textoPeriodo(),
            uuids: filtrado ? Array.from(new Set(E.filas.map(function (f) { return f.uuid; }))) : null,
            alCerrar: function () { $("contenido").classList.remove("xml--conceptos"); pintarPestanas(); }
        });
        pintarPestanas();
        var pc = document.querySelector('#pestanas [data-modulo="conceptos"]');       // en el celular la barra de pestañas se desliza: que se vea la nueva
        if (pc && pc.scrollIntoView) pc.scrollIntoView({ block: "nearest", inline: "end" });
    }

    function cambiarModulo(modulo, conservarSub) {
        if (enConceptos()) XMLConceptos.cerrar();
        E.modulo = modulo;
        if (!VISTA) Fiscontable.url({ tab: modulo });
        if (!conservarSub) E.sub = "";
        E.rapidos = {};
        E.av = {};
        E.orden = { clave: null, dir: 1 };
        E.seleccion.clear();
        document.querySelectorAll("#pestanas .pestana").forEach(function (b) { b.classList.toggle("pestana--activa", b.dataset.modulo === modulo); b.setAttribute("aria-selected", String(b.dataset.modulo === modulo)); });
        pintarPeriodo();
        prepararColumnas();
        pintarSubfiltros();
        pintarRapidos();
        pintarVistas();
        pintarBotonExcel();
        pintarBotonConceptos();
        aplicar();
    }

    /* 23-nov-2026 (el dueño, A.1-A.2): UN solo «Descargar Excel», que dice siempre eso. Sale como ves la tabla: la vista
       activa (columnas y orden), tus filtros o lo marcado con la casilla, en pesos y al cierre si el mes ya cerró. */
    function pintarBotonExcel() {
        var b = document.querySelector('.mod-acciones [data-excel="unico"]');
        if (!b || b.disabled) return;
        b.title = enConceptos() ? "La tabla del reporte por conceptos como la ves: el desglose o el resumen que tengas abierto, con tus filtros y tu búsqueda"
            : "Como ves la tabla: la vista «" + nombreVistaActual() + "», tus filtros (o lo marcado con la casilla), en pesos y, si el mes ya cerró, al cierre";
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
        if (E.modulo === "pagos") {
            html.push('<span class="xml-pagos-por" role="group" aria-label="Periodo de los pagos">Periodo por ' +
                [["emision", "fecha de emisión"], ["pago", "fecha de pago"]].map(function (o) {
                    return '<button type="button" class="xml-chip' + (E.pagosPor === o[0] ? " xml-chip--activo" : "") + '" data-pagos-por="' + o[0] + '"' +
                        (o[0] === "pago" ? ' title="Complementos cuyo pago (FechaPago) cae en los meses elegidos, aunque se hayan emitido en otro mes"' : "") + ">" + o[1] + "</button>";
                }).join("") + "</span>");
        }
        $("subfiltros").innerHTML = html.join("");
        $("btn-zip-origen").hidden = E.modulo !== "pagos";
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
        pintarFiltrosActivos();
    }

    // G-04: los filtros puestos se ven como etiquetas que se quitan con un clic
    function pintarFiltrosActivos() {
        var caja = $("filtros-activos"); if (!caja) return;
        var chips = [], dinero = function (v) { return "$" + Number(v).toLocaleString("es-MX", { minimumFractionDigits: 2 }); };
        (RAPIDOS[E.modulo] || []).forEach(function (r) { if (E.rapidos[r[0]]) chips.push(["r:" + r[0], r[1]]); });
        Object.keys(E.av).forEach(function (k) {
            var v = E.av[k]; if (v === "" || v === undefined || v === null) return;
            chips.push(["a:" + k, k === "min" ? "Importe desde " + dinero(v) : k === "max" ? "Importe hasta " + dinero(v) : ((CAMPOS_AV[k] || {}).etiqueta || k) + ": " + v]);
        });
        caja.hidden = !chips.length;
        caja.innerHTML = chips.map(function (c) {
            return '<span class="ui-chip">' + esc(c[1]) + '<button type="button" data-quitar-filtro="' + esc(c[0]) + '" aria-label="Quitar filtro ' + esc(c[1]) + '">×</button></span>';
        }).join("") + (chips.length > 1 ? '<button type="button" class="xml-enlace" data-quitar-filtro="*">Quitar todos</button>' : "");
    }

    /* ============================================================ columnas y vistas */
    /* 23-nov-2026 (el dueño, A.6 del Avance 1): menú «Vista ▾» arriba de la tabla.
         «Fiscontable»: la de siempre (la de fábrica de la pestaña; en Recibidas con las marcas fiscales y en las dos con
           «Posible duplicado»). «Formato 2»: el reporte de 148 columnas tal cual (solo Emitidas y Recibidas). Y las vistas
           guardadas: las de la persona y las que el titular compartió con el despacho (se guardan en el servidor).
         Mover, quitar o agregar columnas deja la vista «sin guardar» (insignia en el botón «Vista ▾»; 25-nov-2026: ya no hay
         botón suelto) y el menú ofrece guardar los cambios, guardarla como nueva o deshacer. Las dos de base nunca se
         sobrescriben. El Excel sale con las columnas que se ven, aunque no estén guardadas.
       Lo que se acomodó sin guardar se recuerda en este navegador (por pestaña) hasta que se elija otra vista. */
    var BASES = { fiscontable: "Fiscontable", formato2: "Formato 2" };
    function conF2(m) { m = m || E.modulo; return m === "recibidos" || m === "emitidos"; }
    function selActual() { return E.vistaSel[E.modulo] || { tipo: "fiscontable" }; }
    function vistaGuardada(id) { return (E.vistas || []).find(function (v) { return v.id === id && v.modulo === E.modulo; }) || null; }
    function baseActual() {
        var s = selActual();
        if (s.tipo === "formato2") return "formato2";
        if (s.tipo === "guardada") return (vistaGuardada(s.id) || {}).base || "fiscontable";
        return "fiscontable";
    }
    function nombreVistaActual() {
        var s = selActual();
        return s.tipo === "guardada" ? ((vistaGuardada(s.id) || {}).nombre || "Fiscontable") : BASES[s.tipo] || "Fiscontable";
    }
    function catalogoFiscontable() {
        var todas = (E.datos && E.datos[E.modulo] && E.datos[E.modulo].columnas) || [];
        return E.sinMarcas ? todas.filter(function (c) { return c.clave.indexOf("fiscal_") !== 0; }) : todas;
    }
    /* 25-nov-2026 (el dueño): una vista que parte de «Formato 2» puede llevar también columnas de «Fiscontable»
       («Observaciones», «Posible duplicado», las marcas fiscales…). El catálogo es el de «Formato 2» (sus 148, igual que
       siempre) y después el de «Fiscontable» sin las que dicen lo mismo que una de «Formato 2» (el servidor las marca con
       «igual»). «Formato 2» como vista de base sigue siendo exactamente sus 148: agregar otra la deja «sin guardar».
       Los valores de las dos familias ya viven en el mismo renglón. Se arma una vez por pestaña y catálogo (se pide mucho). */
    var CAT = { firma: null, lista: [], mapa: {} };
    function catalogo() {
        var base = baseActual(), bloque = E.datos && E.datos[E.modulo];
        if (CAT.firma === E.modulo + "|" + base + "|" + (E.sinMarcas ? 1 : 0) && CAT.bloque === bloque && CAT.f2 === E.f2Columnas) return CAT.lista;
        var lista;
        if (base === "formato2") {
            var f2 = E.f2Columnas || [], cubiertas = {};
            f2.forEach(function (c) { if (c.igual) cubiertas[c.igual] = 1; });
            lista = !f2.length ? [] : f2.concat(catalogoFiscontable().filter(function (c) { return !cubiertas[c.clave]; })
                .map(function (c) { return Object.assign({}, c, { familia: "Fiscontable" }); }));
        } else lista = catalogoFiscontable();
        var mapa = Object.create(null);
        lista.forEach(function (c) { mapa[c.clave] = c; });
        CAT = { firma: E.modulo + "|" + base + "|" + (E.sinMarcas ? 1 : 0), bloque: bloque, f2: E.f2Columnas, lista: lista, mapa: mapa };
        return lista;
    }
    function colPorClave(clave) { catalogo(); return CAT.mapa[clave]; }
    function anchoDefecto(c) { return ANCHO_CLAVE[c.clave] || ANCHO_TIPO[c.tipo] || 150; }

    /* En Recibidos y Emitidos «RFC contraparte» es el emisor o el receptor: el servidor dice a cuál
       equivale y las vistas que la tenían pasan a esa columna (una sola, no dos con lo mismo). Las familias por tasa
       («@ieps_tasas», «@ret_tasas», del antiguo formato del despacho) se abren en las tasas que traiga el periodo. */
    var FAMILIAS = { "@ieps_tasas": function (c) { return c.grupo === "IEPS" && c.clave !== "ieps_total"; },
                     "@ret_tasas": function (c) { return c.grupo === "Retenciones por tasa"; } };
    function sinRepetidas(cols) {
        var alias = (E.datos[E.modulo] && E.datos[E.modulo].alias) || {}, vistas = {}, abiertas = [];
        (cols || []).forEach(function (c) {
            c = typeof c === "string" ? { clave: c, ancho: 0 } : c;
            if (FAMILIAS[c.clave]) catalogo().filter(FAMILIAS[c.clave]).forEach(function (x) { abiertas.push({ clave: x.clave, ancho: 0 }); });
            else abiertas.push(alias[c.clave] ? { clave: alias[c.clave], ancho: 0 } : { clave: c.clave, ancho: c.ancho || 0 });
        });
        return abiertas.filter(function (c) { if (vistas[c.clave]) return false; vistas[c.clave] = 1; return !!colPorClave(c.clave); });
    }

    function columnasDeFabrica() {
        return E.datos[E.modulo].predeterminadas.filter(colPorClave).map(function (k) { return { clave: k, ancho: 0 }; });
    }
    function columnasDeVista(s) {
        if (s.tipo === "formato2") return (E.f2Columnas || []).map(function (c) { return { clave: c.clave, ancho: 0 }; });
        if (s.tipo === "guardada") { var v = vistaGuardada(s.id); if (v) return sinRepetidas(v.columnas); }
        return columnasDeFabrica();
    }
    function firma(cols) { return (cols || []).map(function (c) { return c.clave; }).join(","); }
    function conCambios() {
        var cols = E.columnas[E.modulo];
        return !!cols && cols.length > 0 && firma(cols) !== firma(columnasDeVista(selActual()));
    }
    function inicialDe(m) {
        var x = (E.inicial || {})[m];
        if (x === "formato2" && conF2(m)) return { tipo: "formato2" };
        if (typeof x === "number") return { tipo: "guardada", id: x };
        return { tipo: "fiscontable" };
    }

    /* Una sola vez: lo que este navegador tenía acomodado con la versión anterior («cols:» y «vista:») pasa al menú nuevo.
       Si venía de una vista con nombre, esa vista (ya está en el servidor); si no, «Fiscontable» con esos cambios. */
    function migrarLocalViejo() {
        var viejas = leerLocal("cols:" + E.modulo);
        if (leerLocal("vista3:" + E.modulo) || !Array.isArray(viejas) || !viejas.length) return;
        var nombre = leerLocal("vista:" + E.modulo), v = nombre ? (E.vistas || []).find(function (x) { return x.modulo === E.modulo && x.nombre === nombre; }) : null;
        // Lo acomodado sin nombre antes de las columnas base del 19-nov ya se soltaba una vez: se sigue soltando
        if (!nombre && !leerLocal("mig:fabrica3:" + E.modulo)) { borrarLocal("cols:" + E.modulo); borrarLocal("vista:" + E.modulo); return; }
        var sel = v ? { tipo: "guardada", id: v.id } : { tipo: "fiscontable" };
        E.vistaSel[E.modulo] = sel;
        var cols = sinRepetidas(viejas);
        guardarLocal("vista3:" + E.modulo, { sel: sel, cols: cols.length && firma(cols) !== firma(columnasDeVista(sel)) ? cols : null });
        borrarLocal("cols:" + E.modulo); borrarLocal("vista:" + E.modulo);
    }

    function prepararColumnas() {
        // Orden de prioridad: lo que dejaste en este navegador → con lo que abres siempre esta pestaña → «Fiscontable»
        migrarLocalViejo();
        var local = leerLocal("vista3:" + E.modulo);
        var s = local && local.sel ? local.sel : inicialDe(E.modulo);
        if ((s.tipo === "guardada" && !vistaGuardada(s.id)) || (s.tipo === "formato2" && !conF2())) { s = { tipo: "fiscontable" }; local = null; }
        E.vistaSel[E.modulo] = s;
        if (baseActual() === "formato2" && !f2Listo()) { E.columnas[E.modulo] = []; pedirF2(); return; }
        var cols = local && local.cols ? sinRepetidas(local.cols) : columnasDeVista(s);
        E.columnas[E.modulo] = cols.length ? cols : columnasDeVista(s);
        if (!E.columnas[E.modulo].length) E.columnas[E.modulo] = columnasDeFabrica();
        empezarHistoria(false);               // 26-nov-2026 (x1): si es lo mismo que ya se tenía, Ctrl+Z sigue sirviendo
    }

    function guardarColumnasLocal() {
        guardarLocal("vista3:" + E.modulo, { sel: selActual(), cols: conCambios() ? E.columnas[E.modulo] : null });
        anotarPaso();                         // 26-nov-2026 (x1): para Ctrl+Z
        pintarVistas();
    }

    /* ============================================================ deshacer y rehacer los cambios de columnas
       26-nov-2026 (el dueño, x1: «me gusta, ¿Ctrl+Z no lo regresa?»): Ctrl+Z (Cmd+Z en Mac) deshace el último cambio de columnas de
       la vista (mover, quitar, ocultar, agregar o cambiar el ancho), varios pasos hacia atrás; Ctrl+Y o Ctrl+Mayús+Z lo rehace. Cada
       pestaña lleva los suyos. No se activa mientras escribes en un campo de texto ni con una ventana abierta. Elegir otra vista
       (o guardarla) empieza de cero; «Deshacer mis cambios» y «Restablecer» cuentan como un paso más (Ctrl+Z los regresa). Un
       aviso corto dice qué se deshizo. Todo cambio de columnas pasa por guardarColumnasLocal(): ahí se anota (anotarPaso). */
    var PASOS_MAX = 50;
    var HIST = {};                            // {modulo: {ultimo, sel, atras: [paso], adelante: [paso]}}; paso = {cols, movida}
    var MOVIDA = { clave: null };             // la columna que movió moverColumna (con dos vecinas que se cruzan no se sabe cuál fue)
    function copiaColumnas(cols) {
        // el ancho de fábrica cuenta como 0: tocar el borde de una columna sin moverlo no es un cambio
        return (cols || []).map(function (c) {
            var x = c.ancho ? colPorClave(c.clave) : null;
            return { clave: c.clave, ancho: c.ancho && !(x && c.ancho === anchoDefecto(x)) ? c.ancho : 0 };
        });
    }
    function mismasColumnas(a, b) { return JSON.stringify(copiaColumnas(a)) === JSON.stringify(copiaColumnas(b)); }
    function historia() { return HIST[E.modulo] || (HIST[E.modulo] = { ultimo: null, sel: "", atras: [], adelante: [] }); }
    // El punto de partida: al abrir la pestaña (si no es lo mismo que ya se tenía), al elegir otra vista o al guardarla
    function empezarHistoria(deCero) {
        var h = historia(), ahora = copiaColumnas(E.columnas[E.modulo]), sel = JSON.stringify(selActual());
        if (deCero || !h.ultimo || h.sel !== sel || !mismasColumnas(h.ultimo, ahora)) { h.atras = []; h.adelante = []; }
        h.ultimo = ahora; h.sel = sel;
    }
    function anotarPaso() {
        var h = historia(), ahora = copiaColumnas(E.columnas[E.modulo]);
        if (!ahora.length) return;                       // «Formato 2» mientras lee sus columnas
        if (h.ultimo && h.ultimo.length && !mismasColumnas(h.ultimo, ahora)) {
            h.atras.push({ cols: h.ultimo, movida: MOVIDA.clave });
            if (h.atras.length > PASOS_MAX) h.atras.shift();
            h.adelante = [];
        }
        h.ultimo = ahora; h.sel = JSON.stringify(selActual()); MOVIDA.clave = null;
    }
    function nombreColumna(clave) { var c = colPorClave(clave); return "«" + (c ? c.etiqueta : clave) + "»"; }
    /* Qué hizo el paso que va de `antes` a `despues`, en palabras: deshecho ? lo que regresa : lo que vuelve a pasar */
    function textoPaso(antes, despues, deshecho, pista) {
        var a = antes.map(function (c) { return c.clave; }), d = despues.map(function (c) { return c.clave; });
        var quitadas = a.filter(function (k) { return d.indexOf(k) < 0; }), puestas = d.filter(function (k) { return a.indexOf(k) < 0; });
        if (quitadas.length === 1 && !puestas.length) return nombreColumna(quitadas[0]) + (deshecho ? " volvió a la tabla" : " se ocultó otra vez");
        if (puestas.length === 1 && !quitadas.length) return nombreColumna(puestas[0]) + (deshecho ? " salió de la tabla" : " volvió a la tabla");
        if (!quitadas.length && !puestas.length && a.join() !== d.join()) {
            var i = 0; while (a[i] === d[i]) i++;
            var sin = function (lista, k) { return lista.filter(function (x) { return x !== k; }).join(); };
            var movida = pista && a.indexOf(pista) !== d.indexOf(pista) ? pista : sin(a, d[i]) === sin(d, d[i]) ? d[i] : a[i];
            return nombreColumna(movida) + (deshecho ? " regresó a su lugar" : " se movió otra vez");
        }
        if (!quitadas.length && !puestas.length) {
            var x = despues.filter(function (c, j) { return c.ancho !== antes[j].ancho; })[0];
            if (x) return "el ancho de " + nombreColumna(x.clave);
        }
        return "los cambios de columnas";
    }
    function deshacerColumnas(rehacer) {
        var h = historia(), de = rehacer ? h.adelante : h.atras, hacia = rehacer ? h.atras : h.adelante;
        if (!de.length || !h.ultimo) return false;
        var ahora = h.ultimo, paso = de.pop(), destino = paso.cols;
        hacia.push({ cols: ahora, movida: paso.movida });   // el mismo paso, visto desde el otro lado
        h.ultimo = copiaColumnas(destino);                  // anotarPaso ya no lo cuenta como un cambio nuevo
        E.columnas[E.modulo] = copiaColumnas(destino);
        if (E.orden.clave && !destino.some(function (c) { return c.clave === E.orden.clave; })) E.orden = { clave: null, dir: 1 };
        cerrarMenuColumna(false);
        guardarColumnasLocal(); aplicar();
        if (!$("panel-columnas").hidden) pintarPanelColumnas();
        var texto = rehacer ? textoPaso(ahora, destino, false, paso.movida) : textoPaso(destino, ahora, true, paso.movida);
        texto = (rehacer ? "Rehecho: " : "Deshecho: ") + texto + ".";
        // el aviso de arriba «Ocultaste «X»… Deshacer» ya no aplica después de deshacer o rehacer con el teclado
        var arriba = document.getElementById("fc-aviso"), suTexto = document.getElementById("fc-aviso-texto");
        if (arriba && !arriba.hidden && suTexto && /^Ocultaste «/.test(suTexto.textContent) && Fiscontable.ocultarAviso) Fiscontable.ocultarAviso();
        if (Fiscontable.toast) Fiscontable.toast(texto); else avisar(texto);
        return true;
    }
    function escribiendo(el) {
        if (!el || !el.tagName) return false;
        if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
        return el.tagName === "INPUT" && !/^(checkbox|radio|button|submit|reset|range|color|file|image)$/i.test(el.type || "text");
    }
    document.addEventListener("keydown", function (e) {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented) return;
        var k = (e.key || "").toLowerCase(), rehacer = (k === "z" && e.shiftKey) || (k === "y" && !e.shiftKey);
        if (!(k === "z" && !e.shiftKey) && !rehacer) return;
        // Revisión del 26-nov-2026: «Validar con el SAT» no es un <dialog> (es .xml-modal): con ella abierta tampoco
        if (escribiendo(e.target) || escribiendo(document.activeElement) || document.querySelector("dialog[open], .xml-modal:not([hidden])") || enConceptos()) return;
        if (deshacerColumnas(rehacer)) e.preventDefault();
    });

    async function cargarVistas() {
        try {
            var d = await apiJSON("/api/xml/vistas?con_estado=1");
            E.vistas = d.vistas || []; E.inicial = d.inicial || {}; E.puedeCompartir = !!d.puede_compartir;
            E.puedeProponer = d.puede_proponer !== undefined ? !!d.puede_proponer : false;
        } catch (e) { E.vistas = []; E.inicial = {}; E.puedeCompartir = false; E.puedeProponer = false; }
    }

    /* 25-nov-2026 (el dueño: la barra «abarca mucho espacio»): el botón dice solo el nombre de la vista (cortado si es largo)
       y una insignia chica «sin guardar»; ya no hay botón suelto «Guardar como vista nueva». Con cambios, el menú empieza
       por lo que se hace con ellos: «Guardar cambios en «X»» (si es tuya), «Guardar como vista nueva…» y «Deshacer». */
    function pintarVistas() {
        var s = selActual(), cambios = conCambios(), v = s.tipo === "guardada" ? vistaGuardada(s.id) : null;
        if (E.datos) pintarMoneda();
        $("nombre-vista").textContent = nombreVistaActual();
        $("vista-sin-guardar").hidden = !cambios;
        $("btn-vistas").title = "Vista: " + nombreVistaActual() + (cambios ? " · tiene cambios sin guardar" : "") + ". Fiscontable, Formato 2 o tus vistas guardadas";
        function item(accion, valor, texto, clase, titulo) {
            return '<button type="button" role="menuitem" data-accion="' + accion + '" data-valor="' + esc(String(valor)) + '"' + (clase ? ' class="' + clase + '"' : "") +
                (titulo ? ' title="' + esc(titulo) + '"' : "") + ">" + texto + "</button>";
        }
        var activa = function (t, id) { return s.tipo === t && (t !== "guardada" || s.id === id) ? "xml-activa" : ""; };
        var h = [];
        if (cambios) {
            h.push('<p class="xml-menu__titulo">Cambios sin guardar</p>');
            if (v && v.puede_cambiar) h.push(item("guardar", v.id, "Guardar cambios en «" + esc(v.nombre) + "»", "xml-menu__principal"));
            h.push(item("nueva", "", "Guardar como vista nueva…", v && v.puede_cambiar ? "" : "xml-menu__principal"));
            h.push(item("deshacer", "", "Deshacer mis cambios"));
            h.push('<div class="xml-separador"></div>');
        }
        h.push(item("base", "fiscontable", "Fiscontable", activa("fiscontable"), "Nuestro diseño de siempre: las columnas con datos de esta pestaña"));
        if (conF2()) h.push(item("base", "formato2", "Formato 2", activa("formato2"), "El reporte «Facturas» de 148 columnas, tal cual"));
        // 24-nov-2026 (revisión): fuera de un despacho no hay «Del despacho» ni «Compartir»: todas son «Mis vistas»
        var mias = E.vistas.filter(function (x) { return x.modulo === E.modulo && (!x.compartida || !E.enDespacho); });
        var desp = E.enDespacho ? E.vistas.filter(function (x) { return x.modulo === E.modulo && x.compartida; }) : [];
        if (mias.length) {
            h.push('<p class="xml-menu__titulo">Mis vistas</p>');
            mias.forEach(function (x) { h.push(item("vista", x.id, esc(x.nombre) + (E.inicial[E.modulo] === x.id ? " ★" : ""), activa("guardada", x.id))); });
        }
        if (desp.length) {
            h.push('<p class="xml-menu__titulo">Del despacho</p>');
            desp.forEach(function (x) { h.push(item("vista", x.id, esc(x.nombre) + (E.inicial[E.modulo] === x.id ? " ★" : ""), activa("guardada", x.id))); });
        }
        h.push('<div class="xml-separador"></div>');
        if (!cambios) h.push(item("nueva", "", "Guardar como vista nueva…"));
        if (v && v.puede_cambiar) h.push(item("renombrar", v.id, "Cambiar nombre…"));
        var actual = s.tipo === "guardada" ? s.id : s.tipo;
        var yaInicial = (E.inicial[E.modulo] || "fiscontable") === actual;
        if (!yaInicial) h.push(item("inicial", actual, "Abrir siempre con esta vista ★"));
        if (v && E.puedeCompartir && E.enDespacho && (v.mia || v.compartida)) h.push(item("compartir", v.id, v.compartida ? "Dejar de compartir con el despacho" : "Compartir con el despacho"));
        // 25-nov-2026, el dueño: cualquier integrante propone una vista suya; el titular la aprueba desde su campana
        if (v && v.mia && !v.compartida && E.puedeProponer && E.enDespacho) {
            h.push(v.propuesta === "pendiente" ? '<p class="xml-menu__nota" role="note">Propuesta al despacho: falta que el titular la apruebe.</p>'
                : item("proponer", v.id, "Proponer al despacho…", "", "Le llega al titular en su campana; si la aprueba, la ve todo el despacho"));
        }
        if (v && v.puede_cambiar) h.push(item("borrar", v.id, "Borrar «" + esc(v.nombre) + "»", "xml-peligro"));
        $("menu-vistas").innerHTML = h.join("");
    }

    function elegirVista(s) {
        var misma = JSON.stringify(s) === JSON.stringify(selActual());   // «Deshacer mis cambios» o «Restablecer»: un paso más (x1)
        E.vistaSel[E.modulo] = s;
        if (baseActual() === "formato2" && !f2Listo()) {
            E.columnas[E.modulo] = [];
            guardarLocal("vista3:" + E.modulo, { sel: s, cols: null });
            pintarVistas(); pintarTabla(); pedirF2(); return;
        }
        E.columnas[E.modulo] = columnasDeVista(s);
        if (misma) anotarPaso(); else empezarHistoria(true);
        guardarLocal("vista3:" + E.modulo, { sel: s, cols: null });
        if (E.orden.clave && !colPorClave(E.orden.clave)) E.orden = { clave: null, dir: 1 };
        pintarVistas();
        aplicar();
        if (!$("panel-columnas").hidden) pintarPanelColumnas();
    }

    /* «Guardar como vista nueva» (o, con o.vista, «Cambiar nombre…»): su nombre y, si eres el titular, si la ve todo el
       despacho. 25-nov-2026 (el dueño: «al guardar que haga algo para reemplazar la que tengo»): si el nombre ya es de una
       vista que puedes cambiar, regresa {reemplazar: esa vista} para preguntar «¿La reemplazo?»; si es de una que no puedes
       cambiar (del despacho), lo dice aquí mismo. */
    var RESERVADOS = { "fiscontable": 1, "formato 2": 1, "formato2": 1, "vista de fábrica": 1, "vista de fabrica": 1 };
    function mismoNombre(a, b) { return String(a || "").replace(/\s+/g, " ").trim().toLowerCase() === String(b || "").replace(/\s+/g, " ").trim().toLowerCase(); }
    function preguntarNombreVista(o) {
        o = o || {};
        var dlg = $("dlg-vista"), renombrar = !!o.vista;
        $("dlg-vista-titulo").textContent = renombrar ? "Cambiar nombre" : "Guardar como vista nueva";
        $("vista-dlg-ok").textContent = renombrar ? "Cambiar nombre" : "Guardar vista";
        $("vista-nombre").value = o.nombre || "";
        $("vista-error").hidden = true;
        $("vista-compartir-caja").hidden = renombrar || !(E.puedeCompartir && E.enDespacho);
        $("vista-compartir").checked = false;
        $("dlg-vista-sub").textContent = renombrar ? "Solo cambia el nombre de «" + o.vista.nombre + "»; sus columnas guardadas quedan igual." +
                (conCambios() ? " Tus cambios sin guardar se quedan como están." : "")
            : "Con las columnas que ves ahora, en su orden (" + E.columnas[E.modulo].length + "). «Fiscontable» y «Formato 2» no cambian.";
        function error(texto) { $("vista-error").textContent = texto; $("vista-error").hidden = false; $("vista-nombre").focus(); }
        return new Promise(function (resolver) {
            var hecho = false;
            function terminar(valor) { if (hecho) return; hecho = true; dlg.removeEventListener("click", clic); dlg.removeEventListener("close", cerro); if (dlg.open) dlg.close(); resolver(valor); }
            function clic(e) {
                var b = e.target.closest("[data-vista-dlg]"); if (!b) return;
                if (b.dataset.vistaDlg !== "ok") return terminar(null);
                var n = $("vista-nombre").value.replace(/\s+/g, " ").trim().slice(0, 60);
                if (!n) return error("Escribe el nombre de la vista.");
                if (RESERVADOS[n.toLowerCase()]) return error("«" + n + "» es el nombre de una vista de base; elige otro.");
                var otra = (E.vistas || []).find(function (x) { return x.modulo === E.modulo && mismoNombre(x.nombre, n) && (!renombrar || x.id !== o.vista.id); });
                var compartida = !$("vista-compartir-caja").hidden && $("vista-compartir").checked;
                if (otra && renombrar) return error("Ya hay una vista «" + otra.nombre + "» en esta pestaña; elige otro nombre.");
                if (otra && !otra.puede_cambiar) return error("«" + otra.nombre + "» es una vista del despacho y solo el titular la cambia; elige otro nombre.");
                terminar({ nombre: n, compartida: compartida, reemplazar: otra || null });
            }
            function cerro() { terminar(null); }
            dlg.addEventListener("click", clic);
            dlg.addEventListener("close", cerro);
            $("vista-nombre").onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); dlg.querySelector('[data-vista-dlg="ok"]').click(); } };
            dlg.showModal();
            setTimeout(function () { $("vista-nombre").focus(); }, 30);
        });
    }

    async function guardarVista(cuerpo) {
        try {
            var r = await (await api("/api/xml/vistas", { method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(Object.assign({ modulo: E.modulo, base: baseActual(), columnas: E.columnas[E.modulo] }, cuerpo)) })).json();
            await cargarVistas();
            E.vistaSel[E.modulo] = { tipo: "guardada", id: r.vista.id };
            guardarLocal("vista3:" + E.modulo, { sel: E.vistaSel[E.modulo], cols: null });
            E.columnas[E.modulo] = columnasDeVista(E.vistaSel[E.modulo]);
            empezarHistoria(true);            // 26-nov-2026 (x1): ya quedó guardada
            pintarVistas(); pintarTabla();
            listo("Vista «" + r.vista.nombre + "» guardada" + (r.vista.compartida ? " y compartida con el despacho." : "."), $("btn-vistas"));
            return true;
        } catch (e) { avisar(e.message); return false; }
    }

    async function accionVista(accion, valor) {
        $("menu-vistas").hidden = true;
        $("btn-vistas").setAttribute("aria-expanded", "false");
        var s = selActual(), v = s.tipo === "guardada" ? vistaGuardada(s.id) : null;
        if (accion === "base") return elegirVista({ tipo: valor });
        if (accion === "vista") return elegirVista({ tipo: "guardada", id: +valor });
        if (accion === "deshacer") return elegirVista(s);
        if (accion === "nueva") return guardarComoNueva("");
        if (accion === "guardar" && v) return guardarVista({ id: v.id, nombre: v.nombre });
        if (accion === "renombrar" && v) return cambiarNombre(v);
        if (accion === "proponer" && v) return proponerVista(v);
        if (accion === "inicial") {
            try {
                await api("/api/xml/vistas/inicial", { method: "PUT", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ modulo: E.modulo, vista: String(valor) }) });
                E.inicial[E.modulo] = /^\d+$/.test(String(valor)) ? +valor : String(valor);
                pintarVistas();
                listo("Esta pestaña abrirá siempre con «" + nombreVistaActual() + "».", $("btn-vistas"));
            } catch (e) { avisar(e.message); }
            return;
        }
        if (accion === "compartir" && v) {
            try {
                await api("/api/xml/vistas/" + v.id + "/compartir", { method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ compartida: !v.compartida }) });
                await cargarVistas(); pintarVistas();
                listo(v.compartida ? "«" + v.nombre + "» ya no se comparte; queda como tuya." : "«" + v.nombre + "» ya la ve todo el despacho.", $("btn-vistas"));
            } catch (e) { avisar(e.message); }
            return;
        }
        if (accion === "borrar" && v) {
            if (!(await Fiscontable.preguntar("¿Borrar la vista «" + v.nombre + "»?" + (v.compartida ? " Es del despacho: dejarán de verla todos." : "")))) return;
            try {
                await api("/api/xml/vistas/" + v.id, { method: "DELETE" });
                await cargarVistas();
                elegirVista({ tipo: "fiscontable" });
            } catch (e) { avisar(e.message); }
        }
    }

    async function guardarComoNueva(nombre) {
        await cargarVistas();                     // por si en otra pestaña se guardó una con ese nombre
        var r = await preguntarNombreVista({ nombre: nombre });
        if (!r) return;
        if (r.reemplazar) {
            var x = r.reemplazar;
            var si = await Fiscontable.confirmar({ titulo: "¿La reemplazo?", si: "Reemplazar", no: "Elegir otro nombre",
                texto: (x.compartida ? "Ya hay una vista del despacho «" : "Ya tienes una vista «") + x.nombre + "» en esta pestaña. Sus columnas cambian por las que ves ahora (" +
                    E.columnas[E.modulo].length + ")" + (x.compartida ? " y así la verán todos en el despacho." : ".") });
            if (!si) return guardarComoNueva(r.nombre);
            return guardarVista({ id: x.id, nombre: x.nombre, compartida: r.compartida ? true : null });
        }
        return guardarVista({ nombre: r.nombre, compartida: r.compartida || null, nueva: true });
    }

    /* «Cambiar nombre…»: solo el nombre; las columnas guardadas quedan igual y lo que tengas sin guardar, también. */
    async function cambiarNombre(v) {
        var r = await preguntarNombreVista({ nombre: v.nombre, vista: v });
        if (!r || r.nombre === v.nombre) return;
        try {
            await api("/api/xml/vistas", { method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ modulo: E.modulo, id: v.id, nombre: r.nombre, base: v.base, columnas: v.columnas }) });
            await cargarVistas();
            pintarVistas(); pintarBotonExcel();
            listo("La vista ahora se llama «" + r.nombre + "».", $("btn-vistas"));
        } catch (e) { avisar(e.message); }
    }

    /* «Proponer al despacho…» (25-nov-2026, el dueño): le llega al titular en su campana con «Aprobar» y «Rechazar». */
    async function proponerVista(v) {
        var cambios = conCambios();
        var si = await Fiscontable.confirmar({ titulo: "Proponer «" + v.nombre + "» al despacho", si: cambios ? "Guardar y proponer" : "Proponer",
            texto: (cambios ? "Primero se guardan tus cambios en «" + v.nombre + "». " : "") + "Le llega al titular en su campana. Si la aprueba, " +
                "la verán todos en su menú «Vista» y desde entonces solo el titular la cambia." });
        if (!si) return;
        if (cambios && !(await guardarVista({ id: v.id, nombre: v.nombre }))) return;
        try {
            var r = await (await api("/api/xml/vistas/" + v.id + "/proponer", { method: "POST" })).json();
            await cargarVistas(); pintarVistas();
            listo(r.mensaje || "Se la propusiste al titular.", $("btn-vistas"));
        } catch (e) { avisar(e.message); }
    }

    /* «Formato 2» en pantalla: sus 148 columnas con lo que trae cada XML (el servidor lee el XML guardado; se pide una vez
       por empresa, periodo y pestaña, cuando se elige esa vista). */
    function claveF2() { var r = rangoPeriodo(); return [E.rfc, E.modulo, r.desde, r.hasta, E.claveCargada].join("|"); }
    function f2Listo() { return !!E.f2Columnas && (E.f2Hecho || {})[E.modulo] === claveF2(); }
    async function pedirF2() {
        var clave = claveF2(), m = E.modulo;
        if (E.f2Pidiendo === clave) return;
        E.f2Pidiendo = clave;
        $("conteo-filas").textContent = "Leyendo los XML para «Formato 2»…";
        // 25-nov-2026: el aviso de «cargando» sobre la tabla, para que no parezca trabada (la primera vez lee cada XML)
        CARGA.mostrar("Leyendo los XML para «Formato 2»…", "Sigue leyendo los XML para «Formato 2»… un periodo grande tarda un poco más.");
        var r = rangoPeriodo();
        try {
            var d = await (await postJSON("/api/xml/formato2", { rfc: E.rfc, desde: r.desde, hasta: r.hasta, modulo: m, meses: mesesElegidos() })).json();
            if (E.f2Pidiendo !== clave) return;
            E.f2Columnas = d.columnas;
            (E.datos[m].filas || []).forEach(function (f) {
                var x = d.filas[f.uuid] || {};
                E.f2Columnas.forEach(function (c) { if (x[c.clave] !== undefined) f[c.clave] = x[c.clave]; else delete f[c.clave]; });
            });
            E.f2Hecho = E.f2Hecho || {}; E.f2Hecho[m] = clave;
        } catch (e) { avisar(e.message); E.vistaSel[m] = { tipo: "fiscontable" }; }
        finally { if (E.f2Pidiendo === clave) { E.f2Pidiendo = ""; CARGA.quitar(); } }
        if (m !== E.modulo) return;
        var local = leerLocal("vista3:" + m);
        var cols = local && local.cols && baseActual() === "formato2" ? sinRepetidas(local.cols) : columnasDeVista(selActual());
        E.columnas[m] = cols.length ? cols : columnasDeVista(selActual());
        empezarHistoria(false);               // 26-nov-2026 (x1)
        pintarVistas();
        aplicar();
        if (!$("panel-columnas").hidden) pintarPanelColumnas();
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

    /* 22-nov-2026 (el dueño: lo marcado en «Posibles duplicados» no se veía ni en la tabla ni en el Excel): la misma frase
       que lleva el Excel en Observaciones, como una marca ⧉ en la primera columna (se vea la columna que se vea) y al
       inicio de «Alertas». Las marcas llegan aparte (/api/xml/duplicados), después de pintar la tabla: no la frenan. */
    var DUP = { clave: "", marcas: {}, pidiendo: "", fiscales: null };
    function marcaDup(f) { return (E.modulo === "recibidos" || E.modulo === "emitidos") && f.uuid ? DUP.marcas[f.uuid] : null; }
    function chipDup(m) {
        return '<button type="button" class="xml-dup xml-dup--' + (m.estado === "sobra" ? "sobra" : "pendiente") + '" data-dup title="' + esc(m.texto) +
            '" aria-label="' + esc(m.texto) + '">⧉</button>';
    }
    function claveDup() {
        if (!E.rfc || !hayEleccion() || (E.modulo !== "recibidos" && E.modulo !== "emitidos")) return "";
        var r = rangoPeriodo();
        return r && r.desde && r.hasta ? [E.rfc, E.modulo, r.desde, r.hasta].join("|") : "";
    }
    /* 23-nov-2026 (A.8): con las marcas llegan también las marcas fiscales de cada factura (Deducible, IVA acreditable,
       Motivo…; las calcula Marcas fiscales, por mes y guardadas). Se ponen en el renglón para verlas, ordenarlas y filtrarlas. */
    var CLAVES_FISCALES = ["fiscal_isr", "fiscal_iva", "fiscal_diot", "fiscal_motivo", "fiscal_estado", "fiscal_no_deducible", "fiscal_iva_no_acreditable"];
    async function pedirMarcasDup() {
        var clave = claveDup();
        if (!clave || (clave === DUP.clave && DUP.datos === E.claveCargada) || clave === DUP.pidiendo || !E.filas.length) return;
        DUP.pidiendo = clave;
        var r = rangoPeriodo(), cargada = E.claveCargada;
        try {
            var d = await (await postJSON("/api/xml/marcas", { rfc: E.rfc, lado: E.modulo, desde: r.desde, hasta: r.hasta, fiscales: !E.sinMarcas })).json();
            if (DUP.pidiendo !== clave) return;
            DUP.fiscales = d.fiscales; DUP.datos = cargada;
            ponerMarcasDup(clave, d.duplicados, true);
        } catch (e) { /* es un adorno de la tabla: si no llega, la tabla sigue igual y el diálogo lo dirá */ }
        finally { if (DUP.pidiendo === clave) DUP.pidiendo = ""; }
    }
    /* 24-nov-2026 (a2dec, decisión B del dueño): la columna «Observaciones» (se agrega desde el catálogo) dice lo mismo que el
       Excel v6. El servidor manda sus frases (f._obs = [[tipo, texto]]) sin la de posible duplicado, que llega aparte; aquí se
       arman igual que modulos/conciliacion/observaciones.texto: de lo más grave a lo informativo, «Revisar:» donde toca. */
    var OBS_ORDEN = { error: 0, revisar: 1, falta: 2, duplicada: 3, vencida: 4, vence: 5, info: 6 };
    function textoObs(items) {
        var vistos = {}, salida = [];
        items.map(function (x, i) { return [x, i]; }).sort(function (a, b) {
            var oa = OBS_ORDEN[a[0][0]] !== undefined ? OBS_ORDEN[a[0][0]] : 9, ob = OBS_ORDEN[b[0][0]] !== undefined ? OBS_ORDEN[b[0][0]] : 9;
            return oa - ob || a[1] - b[1];
        }).forEach(function (p) {
            var tipo = p[0][0], t = String(p[0][1] || "");
            if (!t || vistos[t]) return;
            vistos[t] = 1;
            if (tipo === "error" || tipo === "revisar" || tipo === "falta") {
                if (t.length > 1 && t[0] !== t[0].toLowerCase() && t[1] === t[1].toLowerCase()) t = t[0].toLowerCase() + t.slice(1);
                t = "Revisar: " + t;
            }
            salida.push(t);
        });
        return salida.join(" ");
    }
    function ponerObservaciones(f, x) {
        var items = (f._obs || []).slice();
        if (x && x.tipo && x.frase && Number(f.total) !== 0) items.push([x.tipo, x.frase]);      // total 0.00 no se revisa (D.2)
        var t = items.length ? textoObs(items) : "";
        if (t) f.observaciones = t; else delete f.observaciones;
    }
    function ponerMarcasDup(clave, marcas, forzar) {
        var antes = JSON.stringify(DUP.marcas);
        DUP.clave = clave; DUP.marcas = marcas || {};
        var m = clave.split("|")[1];
        if (E.datos && E.datos[m]) {
            (E.datos[m].filas || []).forEach(function (f) {
                var x = DUP.marcas[f.uuid];
                if (x) f.duplicado = x.texto; else delete f.duplicado;
                if (m === "recibidos" || m === "emitidos") ponerObservaciones(f, x);
                if (DUP.fiscales) {
                    var fz = DUP.fiscales[f.uuid] || {};
                    CLAVES_FISCALES.forEach(function (k) { if (fz[k] !== undefined && fz[k] !== null && fz[k] !== "") f[k] = fz[k]; else delete f[k]; });
                }
            });
        }
        if (clave === claveDup() && (forzar || JSON.stringify(DUP.marcas) !== antes)) {
            if (E.ocultarVacias) { olvidarVacias(); pintarTabla(); }       // «Observaciones» o una marca pudo dejar de estar vacía
            else pintarFilas(true);
        }
    }

    function celda(c, f, fija) {
        var v = f[c.clave];
        var dup = marcaDup(f);
        if (c.clave === "alertas") {
            if (dup) v = dup.texto.replace(/\.$/, "") + (v ? "; " + v : "");
            var n = v ? v.split("; ").length : 0;
            return "<td" + (fija ? ' class="xml-fija xml-fija--ultima" style="left:36px"' : "") + (n ? ' title="' + esc(v) + '"' : "") + ">" +
                (n ? '<span class="xml-alerta">⚠ ' + n + "</span> " + esc(v.split("; ")[0]) : "") + (fija && dup ? chipDup(dup) : "") + "</td>";
        }
        var clase = c.tipo === "moneda" || c.tipo === "numero" ? "xml-num" : (c.tipo === "uuid" ? "xml-uuid" : "");
        if (fija) clase += " xml-fija xml-fija--ultima";
        var txt = formato(c, v);
        var sello = SELLOS[c.clave] && SELLOS[c.clave][v];
        var html = sello ? '<span class="xml-sello xml-sello--' + sello + '">' + esc(txt) + "</span>"
            : v === "No viene en CFDI 3.3" ? '<span class="xml-tenue">' + esc(txt) + "</span>"       // D.3 (23-nov-2026): en gris
            : c.clave === "observaciones" && /^Revisar:/.test(txt) ? '<span class="xml-obs-revisar">' + esc(txt) + "</span>" : esc(txt);   // como el Excel: en rojo
        if (fija && dup) html += chipDup(dup);
        return "<td" + (clase ? ' class="' + clase.trim() + '"' : "") + (fija ? ' style="left:36px"' : "") + (txt.length > 18 ? ' title="' + esc(txt) + '"' : "") + ">" + html + "</td>";
    }

    function visibles() {
        var cols = E.columnas[E.modulo].map(function (x) {
            var c = colPorClave(x.clave);
            return c ? Object.assign({}, c, { ancho: x.ancho || anchoDefecto(c) }) : null;
        }).filter(Boolean);
        // 25-nov-2026: «Ocultar columnas vacías» (panel Columnas) esconde aquí, solo en la pantalla, las que no traen nada en
        // lo que se ve. No toca E.columnas: la vista no queda «sin guardar» y el Excel sale con las columnas de la vista.
        var vacias = columnasVacias();
        if (vacias) {
            var llenas = cols.filter(function (c) { return !vacias[c.clave]; });
            if (llenas.length) cols = llenas;
        }
        return cols;
    }

    /* Las columnas de la vista que no traen ningún dato en lo que se ve (E.filas), o null si el interruptor está apagado o no
       hay renglones. Vacío = sin valor; en importes y números, también 0 (como las columnas opcionales de la vista de
       fábrica). Se recalcula cuando cambian los renglones, las columnas o llegan las marcas aparte. */
    var VAC = { filas: null, firma: "", vacias: null, n: 0 };
    function columnasVacias() {
        if (!E.ocultarVacias || !E.filas || !E.filas.length || !E.columnas[E.modulo]) return null;
        var firmaC = E.modulo + "|" + firma(E.columnas[E.modulo]);
        if (VAC.filas === E.filas && VAC.firma === firmaC && VAC.vacias) return VAC.vacias;
        var vacias = {}, n = 0;
        E.columnas[E.modulo].forEach(function (x) {
            var c = colPorClave(x.clave);
            if (!c) return;
            var num = c.tipo === "moneda" || c.tipo === "numero";
            for (var i = 0; i < E.filas.length; i++) {
                var v = E.filas[i][c.clave];
                if (v !== undefined && v !== null && v !== "" && !(num && v === 0)) return;
            }
            vacias[c.clave] = 1; n++;
        });
        VAC = { filas: E.filas, firma: firmaC, vacias: vacias, n: n };
        return vacias;
    }
    function olvidarVacias() { VAC.filas = null; }

    function pintarTabla() {
        var cols = visibles();
        $("colgroup").innerHTML = '<col style="width:36px">' + cols.map(function (c) { return '<col style="width:' + c.ancho + 'px">'; }).join("");
        $("tabla").style.width = (36 + cols.reduce(function (s, c) { return s + c.ancho; }, 0)) + "px";

        var todasSel = E.filas.length > 0 && E.filas.every(function (f) { return E.seleccion.has(f.uuid); });
        // Un solo ⋮ en el orden del Tab (con 148 columnas serían 148 paradas): las flechas pasan al de al lado
        var tabClave = MC.tab && cols.some(function (x) { return x.clave === MC.tab; }) ? MC.tab : (cols[0] || {}).clave;
        $("thead").innerHTML = "<tr>" +
            '<th class="xml-check xml-fija" style="left:0"><input type="checkbox" id="sel-todas"' + (todasSel ? " checked" : "") + ' title="Seleccionar todo lo filtrado"></th>' +
            cols.map(function (c, i) {
                var orden = E.orden.clave === c.clave ? (E.orden.dir > 0 ? "▲" : "▼") : "";
                var fija = i === 0 ? " xml-fija xml-fija--ultima" : "";
                // 25-nov-2026 (el dueño: «¿puedo seleccionar la columna y quitarla?»): ⋮ abre el menú de la columna (también con
                // clic derecho); el clic en el nombre sigue ordenando y arrastrarlo, moviéndola
                return '<th data-clave="' + esc(c.clave) + '" class="' + (c.tipo === "moneda" || c.tipo === "numero" ? "xml-num" : "") + fija + '"' +
                    (i === 0 ? ' style="left:36px"' : "") + ' title="' + esc(c.etiqueta + " · " + (c.familia ? c.familia + " · " : "") + c.grupo) + '"' +
                    (E.orden.clave === c.clave ? ' aria-sort="' + (E.orden.dir > 0 ? "ascending" : "descending") + '"' : "") +
                    '><span class="xml-th-txt" draggable="true">' + esc(c.etiqueta) + "</span>" +
                    '<span class="xml-orden">' + orden + '</span><button type="button" class="xml-th-menu" data-col-menu="' + esc(c.clave) + '" aria-haspopup="menu" ' +
                    'tabindex="' + (c.clave === tabClave ? "0" : "-1") + '" ' +
                    'aria-label="Opciones de la columna ' + esc(c.etiqueta) + '" title="Ordenar, mover u ocultar esta columna">⋮</button>' +
                    '<span class="xml-asa" data-asa="' + esc(c.clave) + '"></span></th>';
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
        var ocultas = E.ocultarVacias && VAC.vacias && VAC.filas === E.filas ? E.columnas[E.modulo].length - cols.length : 0;
        $("conteo-filas").textContent = E.filas.length.toLocaleString("es-MX") + " registro(s)" +
            (ocultas > 0 ? " · " + ocultas + " columna" + (ocultas === 1 ? " vacía oculta" : "s vacías ocultas") : "");
        pintarAlcance();
        pintarFilas(true);
        pintarSeleccion();
        pedirMarcasDup();
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
        ligarFolios(cols);
        var muestra = $("tbody").querySelector("tr[data-i]");
        if (muestra && Math.abs(muestra.offsetHeight - E.altoFila) > 1) { E.altoFila = muestra.offsetHeight; }
    }
    /* 23-nov-2026, el dueño (decisión E): el folio (y la serie-folio y el UUID) es un enlace real a la página de la factura:
       Ctrl/Cmd+clic o clic medio la abren en otra pestaña; el clic normal sigue abriendo el mini detalle (la regla es de
       barra.js). Se pone después de pintar, solo en las celdas de texto simple, para no cambiar cómo se arma cada celda. */
    var LIGADAS = { folio: 1, serie_folio: 1, uuid: 1 };
    function ligarFolios(cols) {
        if (!E.rfc || !Fiscontable.urlFactura) return;
        var pos = [];
        cols.forEach(function (c, j) { if (LIGADAS[c.clave]) pos.push(j + 1); });          // +1: la casilla va primero
        if (!pos.length) return;
        $("tbody").querySelectorAll("tr[data-i]").forEach(function (tr) {
            var f = E.filas[+tr.dataset.i];
            if (!f || !f.uuid) return;
            pos.forEach(function (k) {
                var td = tr.children[k], t = td && td.firstChild;
                if (!t || t.nodeType !== 3 || !t.nodeValue) return;
                var a = document.createElement("a");
                a.className = "fc-liga-factura"; a.href = Fiscontable.urlFactura(E.rfc, f.uuid);
                td.insertBefore(a, t); a.appendChild(t);
            });
        });
    }

    function pintarSeleccion() {
        var n = E.seleccion.size;
        $("barra-seleccion").hidden = n === 0;
        // 25-nov-2026 (el dueño: «marqué 3 y salieron 2»): lo marcado se queda aunque cambies el chip, la búsqueda o un filtro, y
        // va completo al Excel; si alguna marcada ya no se ve en la tabla, se dice aquí
        var ocultas = 0;
        if (n) {
            var vistas = new Set((E.filas || []).map(function (f) { return f.uuid; }));
            E.seleccion.forEach(function (u) { if (!vistas.has(u)) ocultas++; });
        }
        $("texto-seleccion").textContent = n + " XML seleccionado" + (n === 1 ? "" : "s") +
            (ocultas ? " · " + ocultas + (ocultas === 1 ? " no se ve" : " no se ven") + " con estos filtros" : "");
        pintarAlcance();
    }

    function abrirDetalle(f) {
        var lista = (E.tabla && E.tabla.filas ? E.tabla.filas() : E.filas || []).map(function (x) { return x.uuid; }).filter(Boolean);
        Fiscontable.verCfdi(E.rfc, f.uuid, lista);
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
        MOVIDA.clave = de;                    // 26-nov-2026 (x1): para decir cuál se movió al deshacer
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
        // 25-nov-2026: clic derecho en un encabezado = el mismo menú del ⋮
        thead.addEventListener("contextmenu", function (e) {
            var th = e.target.closest("th[data-clave]");
            if (!th) return;
            e.preventDefault();
            // Con la tecla de menú (o Mayús+F10) no hay posición del ratón: se abre junto a su ⋮
            abrirMenuColumna(th.dataset.clave, e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : null);
        });
        // Flechas izquierda/derecha (Inicio/Fin) entre los ⋮ de los encabezados
        thead.addEventListener("keydown", function (e) {
            var bm = e.target.closest && e.target.closest("[data-col-menu]");
            if (!bm || ["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(e.key) === -1) return;
            var todos = Array.prototype.slice.call(thead.querySelectorAll("[data-col-menu]")), i = todos.indexOf(bm);
            var j = e.key === "Home" ? 0 : e.key === "End" ? todos.length - 1 : Math.max(0, Math.min(todos.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)));
            if (j === i || !todos[j]) return;
            e.preventDefault();
            bm.setAttribute("tabindex", "-1"); todos[j].setAttribute("tabindex", "0"); MC.tab = todos[j].dataset.colMenu;
            todos[j].focus();
            if (todos[j].scrollIntoView) todos[j].closest("th").scrollIntoView({ block: "nearest", inline: "nearest" });
        });
        thead.addEventListener("click", function (e) {
            if (e.target.closest("[data-asa]")) return;
            var bm = e.target.closest("[data-col-menu]");
            if (bm) {
                e.stopPropagation();                       // si no, el clic en la página lo cerraría al momento
                if (MC.clave === bm.dataset.colMenu && !$("menu-columna").hidden) cerrarMenuColumna(true);
                else abrirMenuColumna(bm.dataset.colMenu);
                return;
            }
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

    /* ============================================================ menú de una columna
       25-nov-2026 (el dueño: «¿puedo seleccionar la columna y quitarla?»): el ⋮ de cada encabezado (o clic derecho) abre
       ordenar, mover a la izquierda o a la derecha y ocultar esa columna, sin ir al panel. Con teclado: Tab hasta el ⋮,
       Enter; flechas arriba y abajo; Esc lo cierra y regresa al ⋮. Mover y ocultar dejan la vista «sin guardar». */
    var MC = { clave: null };
    function botonMenuColumna(clave) {
        var lista = $("thead").querySelectorAll("[data-col-menu]");
        for (var i = 0; i < lista.length; i++) if (lista[i].dataset.colMenu === clave) return lista[i];
        return null;
    }
    function abrirMenuColumna(clave, punto) {
        var cols = visibles(), i = cols.findIndex(function (c) { return c.clave === clave; });
        if (i < 0) return;
        cerrarMenus("menu-columna");
        var c = cols[i], num = c.tipo === "moneda" || c.tipo === "numero", fecha = c.tipo === "fecha";
        var dir = E.orden.clave === clave ? E.orden.dir : 0;
        function item(accion, texto, apagado, clase) {
            return '<button type="button" role="menuitem" data-mc="' + accion + '"' + (apagado ? " disabled" : "") + (clase ? ' class="' + clase + '"' : "") + ">" + texto + "</button>";
        }
        var h = ['<p class="xml-menu__titulo" title="' + esc(c.etiqueta) + '">' + esc(c.etiqueta) + "</p>",
            item("asc", (dir > 0 ? "✓ " : "") + (num ? "Ordenar de menor a mayor" : fecha ? "Ordenar del más antiguo al más reciente" : "Ordenar de la A a la Z"), false, dir > 0 ? "xml-activa" : ""),
            item("desc", (dir < 0 ? "✓ " : "") + (num ? "Ordenar de mayor a menor" : fecha ? "Ordenar del más reciente al más antiguo" : "Ordenar de la Z a la A"), false, dir < 0 ? "xml-activa" : "")];
        if (dir) h.push(item("sin-orden", "Quitar el orden"));
        h.push('<div class="xml-separador"></div>',
            item("izq", "Mover a la izquierda", i === 0), item("der", "Mover a la derecha", i === cols.length - 1),
            '<div class="xml-separador"></div>', item("ocultar", "Ocultar esta columna", cols.length <= 1, "xml-peligro"));
        var menu = $("menu-columna");
        menu.innerHTML = h.join("");
        MC.clave = clave; MC.tab = clave;
        MC.scroll = [$("tabla-caja").scrollLeft, $("tabla-caja").scrollTop];
        var boton = botonMenuColumna(clave);
        if (boton) boton.setAttribute("aria-expanded", "true");
        menu.hidden = false;
        // Junto al ⋮ (o donde se hizo clic derecho), sin salirse de la pantalla. En el celular el CSS lo pone a todo lo ancho.
        var r = punto ? { left: punto.x, right: punto.x, top: punto.y, bottom: punto.y } : (boton || $("thead")).getBoundingClientRect();
        var alto = menu.offsetHeight, ancho = menu.offsetWidth;
        var arriba = r.bottom + 4 + alto > window.innerHeight - 8 ? Math.max(8, r.top - alto - 4) : r.bottom + 4;
        menu.style.top = arriba + "px";
        menu.style.left = window.innerWidth <= 700 ? "" : Math.max(8, Math.min(punto ? r.left : r.right - ancho, window.innerWidth - ancho - 8)) + "px";
        var primero = menu.querySelector("button:not([disabled])");
        if (primero) primero.focus();
    }
    function cerrarMenuColumna(regresar) {
        var menu = $("menu-columna");
        if (menu.hidden) return;
        menu.hidden = true;
        var b = MC.clave && botonMenuColumna(MC.clave);
        if (b) { b.setAttribute("aria-expanded", "false"); if (regresar) b.focus(); }
    }
    function accionColumna(accion) {
        var clave = MC.clave, cols = visibles(), i = cols.findIndex(function (c) { return c.clave === clave; });
        cerrarMenuColumna(false);
        if (i < 0) return;
        var c = cols[i], foco = clave;
        if (accion === "asc" || accion === "desc") { E.orden = { clave: clave, dir: accion === "asc" ? 1 : -1 }; aplicar(); }
        else if (accion === "sin-orden") { E.orden = { clave: null, dir: 1 }; aplicar(); }
        else if (accion === "izq" && i > 0) moverColumna(clave, cols[i - 1].clave, false);
        else if (accion === "der" && i < cols.length - 1) moverColumna(clave, cols[i + 1].clave, true);
        else if (accion === "ocultar" && cols.length > 1) {
            var antes = E.columnas[E.modulo].slice();
            E.columnas[E.modulo] = E.columnas[E.modulo].filter(function (x) { return x.clave !== clave; });
            if (E.orden.clave === clave) E.orden = { clave: null, dir: 1 };
            foco = (cols[i + 1] || cols[i - 1]).clave;
            MC.tab = foco;
            guardarColumnasLocal(); aplicar();
            if (!$("panel-columnas").hidden) pintarPanelColumnas();
            var deshacer = function () {
                // 26-nov-2026 (x1): si sigue siendo el último paso, el mismo de Ctrl+Z (así Ctrl+Y lo vuelve a ocultar)
                var h = historia(), ult = h.atras[h.atras.length - 1];
                if (ult && mismasColumnas(ult.cols, antes) && deshacerColumnas(false)) return;
                E.columnas[E.modulo] = antes; guardarColumnasLocal(); aplicar();
                if (!$("panel-columnas").hidden) pintarPanelColumnas();
                if (Fiscontable.aviso) Fiscontable.aviso("Volvió «" + c.etiqueta + "».");
            };
            if (Fiscontable.aviso) Fiscontable.aviso("Ocultaste «" + c.etiqueta + "». La regresas desde «Columnas» o aquí.", [{ texto: "Deshacer", accion: deshacer }]);
            else listo("Ocultaste «" + c.etiqueta + "».");
        }
        var b = botonMenuColumna(foco);
        if (b) b.focus();
    }
    function prepararMenuColumna() {
        var menu = $("menu-columna");
        menu.addEventListener("click", function (e) {
            e.stopPropagation();
            var b = e.target.closest("[data-mc]");
            if (b && !b.disabled) accionColumna(b.dataset.mc);
        });
        menu.addEventListener("keydown", function (e) {
            var botones = Array.prototype.filter.call(menu.querySelectorAll("button"), function (b) { return !b.disabled; });
            var i = botones.indexOf(document.activeElement);
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                var j = e.key === "ArrowDown" ? (i + 1) % botones.length : (i - 1 + botones.length) % botones.length;
                if (botones[j]) botones[j].focus();
            } else if (e.key === "Home" || e.key === "End") {
                e.preventDefault();
                var x = botones[e.key === "Home" ? 0 : botones.length - 1]; if (x) x.focus();
            } else if (e.key === "Escape") {
                e.preventDefault(); e.stopPropagation(); cerrarMenuColumna(true);
            } else if (e.key === "Tab") {
                cerrarMenuColumna(false);
            }
        });
        // Si la tabla se desplaza, el menú ya no queda junto a su columna: se cierra (un ajuste de 1-2 px del navegador, no)
        $("tabla-caja").addEventListener("scroll", function () {
            var c = $("tabla-caja");
            if (!MC.scroll || Math.abs(c.scrollLeft - MC.scroll[0]) > 4 || Math.abs(c.scrollTop - MC.scroll[1]) > 4) cerrarMenuColumna(false);
        }, { passive: true });
        window.addEventListener("resize", function () { cerrarMenuColumna(false); });
    }

    /* ============================================================ panel de columnas */
    function pintarPanelColumnas() {
        var bruto = $("buscar-columna").value.trim(), q = bruto.toLowerCase();
        var vis = E.columnas[E.modulo] || [];
        var visSet = new Set(vis.map(function (c) { return c.clave; }));
        var coincide = function (c) { return !q || (c.etiqueta + " " + c.grupo + " " + (c.familia || "")).toLowerCase().indexOf(q) !== -1; };
        // 25-nov-2026: «Ocultar columnas vacías» (solo la pantalla): las que esconde siguen en la lista, marcadas «vacía»
        $("ocultar-vacias").checked = !!E.ocultarVacias;
        var vacias = columnasVacias() || {}, nVacias = Object.keys(vacias).length;
        $("cuenta-vacias").textContent = E.ocultarVacias && nVacias ? "(" + nVacias + " en lo que ves)" : "";
        var itemsVis = vis.map(function (x) {
            var c = colPorClave(x.clave);
            if (!c || !coincide(c)) return "";
            return '<li draggable="true" data-clave="' + esc(c.clave) + '"' + (vacias[c.clave] ? ' class="xml-lista__vacia"' : "") + '><span class="xml-agarre">⋮⋮</span>' + esc(c.etiqueta) +
                (vacias[c.clave] ? ' <small class="xml-tenue">vacía</small>' : "") +
                '<button type="button" data-ocultar="' + esc(c.clave) + '" title="Ocultar" aria-label="Ocultar ' + esc(c.etiqueta) + '">×</button></li>';
        }).filter(Boolean);
        $("lista-visibles").innerHTML = itemsVis.join("");
        $("lista-visibles").hidden = !itemsVis.length;
        // Disponibles: por grupo. En una vista que parte de «Formato 2», primero sus columnas y después las de «Fiscontable»
        // (25-nov-2026, el dueño), cada familia con su título y las de «Fiscontable» en sus grupos de siempre.
        var mezcla = baseActual() === "formato2", familias = {}, orden = [];
        catalogo().forEach(function (c) {
            if (visSet.has(c.clave) || !coincide(c)) return;
            var f = mezcla ? (c.familia || "Formato 2") : "";
            if (!familias[f]) { familias[f] = {}; orden.push(f); }
            (familias[f][c.grupo] = familias[f][c.grupo] || []).push(c);
        });
        var disp = orden.map(function (f) {
            var grupos = familias[f];
            return (f ? '<div class="xml-grupo xml-grupo--familia">' + esc(f) + "</div>" : "") + Object.keys(grupos).map(function (g) {
                return (g !== f ? '<div class="xml-grupo' + (f ? " xml-grupo--sub" : "") + '">' + esc(g) + "</div>" : "") + grupos[g].map(function (c) {
                    return '<label class="xml-disp"><input type="checkbox" data-mostrar="' + esc(c.clave) + '"> ' + esc(c.etiqueta) + "</label>";
                }).join("");
            }).join("");
        }).join("");
        // 25-nov-2026 (el dueño escribió «obser» y le decía «Ya están todas visibles»): cada caso con su mensaje
        var con = "«" + bruto + "»";
        var msjVis = "", msjDisp = "";
        if (q && !itemsVis.length && !disp) msjDisp = "No hay columnas con " + con + ".";
        else {
            if (q && !itemsVis.length) msjVis = "Ninguna de las visibles tiene " + con + ".";
            if (!disp) msjDisp = q ? "Las que tienen " + con + " ya están visibles." : "Ya están todas visibles.";
        }
        $("visibles-vacio").textContent = msjVis;
        $("visibles-vacio").hidden = !msjVis;
        $("lista-disponibles").innerHTML = disp || '<p class="xml-tenue xml-panel__vacio">' + esc(msjDisp) + "</p>";
    }

    function prepararPanelColumnas() {
        $("btn-columnas").addEventListener("click", function () { $("panel-columnas").hidden = false; pintarPanelColumnas(); });
        $("cerrar-columnas").addEventListener("click", function () { $("panel-columnas").hidden = true; });
        $("buscar-columna").addEventListener("input", pintarPanelColumnas);
        $("ocultar-vacias").addEventListener("change", function () {
            E.ocultarVacias = this.checked;
            guardarLocal("ocultarVacias", E.ocultarVacias);
            olvidarVacias(); pintarTabla(); pintarPanelColumnas();
        });
        $("btn-fabrica").addEventListener("click", function () { elegirVista(selActual()); });
        $("btn-moneda").addEventListener("click", elegirMoneda);
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
    /* «Descargar Excel» (23-nov-2026, el dueño, decisión A del Avance 1): un solo botón por pestaña. Sale como ves la tabla:
       las columnas de la vista activa en su orden (aunque no la hayas guardado), los renglones de la pantalla (periodo,
       pestaña, chip, búsqueda y filtros) o, si marcaste renglones con su casilla, solo esos. En pesos con el T.C. del DOF
       sin preguntar (las columnas de la moneda original se quedan) y, si el mes ya cerró, al cierre con «Pago posterior al
       periodo». Con «Formato 2», sus 148 columnas. Con el reporte por conceptos abierto, su Excel.
       25-nov-2026 (el dueño): «Formato 2» también con nuestro formato (los mismos 148 nombres y en su orden); formato
       "importar" = «Formato 2 para importar (sin títulos)», como antes. Con renglones marcados se manda cuántos son: van
       todos (aunque el chip esconda alguno) y el Excel dice «Selección: N facturas marcadas». */
    /* 26-nov-2026 (el dueño: «¿si descargo el Excel sale sin eso?»): con «Ocultar columnas vacías», el Excel sale como se ve
       (sin esas columnas), salvo «Formato 2», que es un formato fijo para importar: siempre con sus 148 columnas en su orden.
       (26-nov-2026, el dueño: «quita eso de “Sin la columna vacía, como lo ves.”… solo Descargar Excel»): la línea que lo decía
       debajo de «Descargar Excel» se quitó; el Excel sale igual. */
    function esFormato2Fijo() { return selActual().tipo === "formato2"; }
    function columnasParaExcel() {
        var todas = E.columnas[E.modulo].map(function (c) { return c.clave; });
        if (esFormato2Fijo() || !E.ocultarVacias) return todas;
        var vacias = columnasVacias();
        if (!vacias) return todas;
        var llenas = todas.filter(function (k) { return !vacias[k]; });
        return llenas.length ? llenas : todas;
    }
    // 26-nov-2026 (el dueño: «le cambié el ajuste y siempre salió la misma leyenda»): lo que eligió en «Importes» (XML, DOF o
    // sin convertir) va al servidor; sin elegir nunca, el servidor usa su valor de fábrica: el T.C. del XML, como la
    // pantalla (antes el DOF, decisión A.4)
    function convertirParaExcel() {
        var p = Fiscontable.monedaReportes.leer();
        return p.deFabrica ? null : p.modo;
    }
    async function exportarExcel(formato) {
        var boton = document.querySelector('.mod-acciones [data-excel="' + (formato === "importar" ? "importar" : "unico") + '"]');
        if (!boton || boton.disabled) return;
        if (enConceptos()) { if (XMLConceptos.excel) XMLConceptos.excel(boton); return; }
        if (!E.rfc || !hayEleccion()) return avisar("Elige empresa y periodo para descargar el Excel.");
        if (baseActual() === "formato2" && !f2Listo()) return avisar("Espera a que termine de leer los XML de «Formato 2».");
        var r = rangoPeriodo();
        var cuerpo = { rfc: E.rfc, desde: r.desde, hasta: r.hasta, meses: mesesElegidos(), modo: "vista", pagos_por: E.pagosPor,
                       modulo: E.modulo, sub: E.sub || null, columnas: columnasParaExcel(),
                       vista_base: baseActual(), vista_nombre: nombreVistaActual() };
        var conv = convertirParaExcel();
        if (conv !== null) cuerpo.convertir = conv;
        if (E.orden.clave) { cuerpo.orden_clave = E.orden.clave; cuerpo.orden_dir = E.orden.dir; }
        var filtrado = E.busqueda.trim() || Object.keys(E.rapidos).some(function (k) { return E.rapidos[k]; }) ||
            Object.keys(E.av).some(function (k) { return E.av[k]; });
        cuerpo.uuids = E.seleccion.size ? Array.from(E.seleccion) : filtrado ? Array.from(new Set(E.filas.map(function (f) { return f.uuid; }))) : null;
        if (E.seleccion.size) cuerpo.marcadas = E.seleccion.size;
        if (formato === "importar" && baseActual() === "formato2") cuerpo.formato_excel = "importar";
        var texto = boton.innerHTML;
        boton.disabled = true; boton.innerHTML = "<b>⏳</b>Generando…";
        try {
            var resp = await postJSON("/api/xml/excel", cuerpo);
            descargarBlob(await resp.blob(), nombreArchivo(resp, "reporte.xlsx"));
        } catch (e) { avisar(e.message); }
        boton.disabled = false; boton.innerHTML = texto;
    }

    /* [["USD", 3], ["EUR", 1]]: cuántos CFDI hay en cada moneda extranjera (en Pagos cuentan la moneda del
       pago y la de la factura pagada). */
    function monedasExtranjeras(filas) {
        var porMoneda = {};
        (filas || []).forEach(function (f) {
            [f.moneda, f.moneda_p, f.docto_moneda].forEach(function (m) {
                if (!m || m === "MXN" || m === "XXX") return;
                (porMoneda[m] = porMoneda[m] || new Set()).add(f.uuid);
            });
        });
        return Object.keys(porMoneda).sort().map(function (m) { return [m, porMoneda[m].size]; });
    }

    /* «Hay CFDI en otra moneda»: en pesos con el tipo de cambio del XML, con el del DOF (Banxico), o sin convertir.
       proposito: "excel" (al descargar) o "ver" (el botón «Importes» de la tabla). Devuelve {modo: "xml" | "dof" | "",
       siempre: bool} o null si se cancela. Con «Usar esto siempre» queda guardado para la tabla y para todos los Excel. */
    function dofDisponible(monedas) {
        return !!(E.banxico || {}).USD && monedas.some(function (m) { return m[0] === "USD"; });
    }

    function preguntarMoneda(monedas, proposito) {
        var dlg = $("dlg-moneda"), ver = proposito === "ver";
        var lista = monedas.map(function (m) { return m[1].toLocaleString("es-MX") + " en " + m[0]; });
        $("dlg-moneda-titulo").textContent = ver ? "Importes en otra moneda" : "Hay CFDI en otra moneda";
        $("dlg-moneda-sub").textContent = (ver ? "En este periodo hay " : "En lo que vas a descargar hay ") +
            (lista.length > 1 ? lista.slice(0, -1).join(", ") + " y " + lista[lista.length - 1] : lista[0]) + ".";
        $("dlg-moneda-pregunta").textContent = ver ? "¿Cómo quieres ver los importes?" : "¿Cómo quieres los importes en el Excel?";
        $("dlg-moneda-ok").textContent = ver ? "Aplicar" : "Descargar Excel";
        var usd = (E.banxico || {}).USD, hayDolares = monedas.some(function (m) { return m[0] === "USD"; });
        var dof = dlg.querySelector('input[value="dof"]');
        var dia = function (f) { return f.slice(8, 10) + "/" + f.slice(5, 7) + "/" + f.slice(0, 4); };
        dof.disabled = !usd || !hayDolares;
        $("dlg-moneda-dof").textContent = !usd ? "Todavía no hay tipos de cambio de Banxico cargados."
            : !hayDolares ? "Banxico solo da el del dólar, y aquí no hay CFDI en dólares."
            : "El publicado en el DOF el día anterior a la emisión (art. 20 del CFF); en los pagos, a la fecha de pago. Hay del dólar hasta el " +
              dia(usd.hasta) + (monedas.length > 1 ? "; para las demás monedas se usa el del XML." : ".");
        var pref = Fiscontable.monedaReportes.leer();
        var previa = ver ? (E.moneda || "") : (E.moneda || pref.modo);      // al ver: lo que hay ahora; al descargar: lo que ves o lo último
        if (previa === "dof" && dof.disabled) previa = "xml";
        dlg.querySelectorAll('input[name="moneda-conv"]').forEach(function (i) { i.checked = i.value === previa; });
        $("moneda-siempre").checked = pref.siempre;
        return new Promise(function (resolver) {
            var elegido = null;
            function cerrar(e) {
                var b = e.target.closest("[data-moneda]");
                if (!b) return;
                if (b.dataset.moneda === "ok") {
                    var marcado = dlg.querySelector('input[name="moneda-conv"]:checked');
                    elegido = { modo: marcado ? marcado.value : "", siempre: $("moneda-siempre").checked };
                    Fiscontable.monedaReportes.guardar(elegido.modo, elegido.siempre);
                }
                dlg.close();
            }
            dlg.addEventListener("click", cerrar);
            dlg.addEventListener("close", function alCerrar() {
                dlg.removeEventListener("click", cerrar);
                dlg.removeEventListener("close", alCerrar);
                resolver(elegido);
            });
            dlg.showModal();
        });
    }

    /* El botón «Importes» de la tabla y el aviso de que va en pesos. Solo aparecen si el periodo trae otra moneda. */
    function monedasDelPeriodo() {
        return monedasExtranjeras(["recibidos", "emitidos", "pagos"].reduce(function (t, m) { return t.concat(filasPeriodo(m)); }, []));
    }

    function pintarMoneda() {
        var boton = $("btn-moneda"), aviso = $("aviso-moneda"), c = E.convertido || {};
        var hay = monedasDelPeriodo().length > 0;
        if (baseActual() === "formato2") {
            // 24-nov-2026 (revisión): «Formato 2» trae los importes como el reporte original (al T.C. de cada factura): aquí
            // el botón no cambia nada, así que no se ofrece
            boton.hidden = true; aviso.hidden = !hay; aviso.title = "";
            // (26-nov-2026, el dueño: «era T.C. del XML y no de la factura; se queda del XML») decía «de su factura»
            aviso.textContent = "«Formato 2»: lo que viene en otra moneda va en pesos al tipo de cambio del XML, como el reporte original (en pantalla y en el Excel).";
            return;
        }
        boton.hidden = !hay && !c.modo;
        boton.textContent = "Importes: " + (c.modo ? "en pesos" : "en su moneda");
        aviso.hidden = !c.modo;
        if (c.modo) {
            // 18-nov (el dueño: «más corto»): solo qué se hizo con lo que venía en otra moneda
            // (26-nov-2026, el dueño: «era T.C. del XML y no de la factura; se queda del XML») decía «de su factura»: ahora «del XML»,
            // como la leyenda del Excel («Moneda extranjera convertida al T.C. del XML.») y la ventana «Importes»
            aviso.textContent = "Importes en otra moneda: en pesos, al tipo de cambio " + (c.modo === "dof" ? "del DOF" : "del XML") +
                (c.sin_tc ? " (" + c.sin_tc + " sin tipo de cambio siguen en su moneda)" : "") + ".";
            // 26-nov-2026 (el dueño: «no menciones del DOF cuando es del XML»): decía «“Descargar Excel” los pone siempre en pesos con
            // el T.C. del DOF». Desde ese día el Excel sigue lo elegido en «Importes» y, sin haber elegido nunca, sale como la
            // pantalla: al T.C. del XML (el dueño: «el Excel por defecto sale convertido al T.C. de la factura», que es el del XML).
            var paraExcel = convertirParaExcel();
            aviso.title = Number(c.convertidas || 0).toLocaleString("es-MX") + " renglón(es) convertidos con " + c.con + "." +
                ((paraExcel === null ? "xml" : paraExcel) === c.modo ? " «Descargar Excel» sale igual." : "");
            var b = document.createElement("button"); b.type = "button"; b.textContent = "Cambiar"; b.addEventListener("click", elegirMoneda);
            aviso.appendChild(b);
        }
    }

    async function elegirMoneda() {
        var monedas = monedasDelPeriodo();
        if (!monedas.length) return;
        var r = await preguntarMoneda(monedas, "ver");
        if (r === null) return;
        E.moneda = r.modo;
        cargarRegistros();
    }

    /* Conciliación: se abre con la misma empresa, periodo y lado (lee la misma biblioteca). */
    /* El periodo de esta página, para abrir otra con el mismo (junto con la empresa). */
    function periodoParaUrl() {
        var r = rangoPeriodo();
        return porFechas() ? (r.desde ? "&desde=" + r.desde : "") + (r.hasta ? "&hasta=" + r.hasta : "")
            : hayEleccion() ? "&anio=" + anioElegido() + "&meses=" + E.P.estado().meses.join(",") : "";
    }
    function abrirConciliacion() {
        var lado = E.modulo === "recibidos" ? "recibidos" : "emitidos";
        if (E.modulo === "pagos") lado = E.sub === "recibidos" ? "recibidos" : "emitidos";
        location.href = "/herramientas/conciliacion/?rfc=" + encodeURIComponent(E.rfc) + "&lado=" + lado + "&base=emision" + periodoParaUrl();
    }
    /* «Ir a»: Complementos de pago, Recibos de nómina o de regreso a Administración de XML, con la misma empresa y periodo. */
    function irA(destino) {
        location.href = "/herramientas/xml/?" + (destino === "xml" ? "" : "vista=" + destino + "&") + "rfc=" + encodeURIComponent(E.rfc || "") + periodoParaUrl();
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

    /* PDF de varios CFDI (con o sin su XML), sin tope. Pocos: el servidor manda el ZIP y se baja al momento. Muchos:
       responde {en_cola, job_id, total, mensaje}, lo arma en segundo plano y lo deja en «Mis descargas»; aquí se sigue
       el avance («123 de 436») y se avisa al terminar. */
    async function pedirPaquetePdf(ruta, uuids, boton, porDefecto) {
        var texto = boton.innerHTML;
        boton.disabled = true; boton.innerHTML = "<b>⏳</b>Generando " + uuids.length.toLocaleString("es-MX") + "…";
        try {
            var resp = await postJSON(ruta, { rfc: E.rfc, uuids: uuids, en_cola: true });
            if ((resp.headers.get("Content-Type") || "").indexOf("application/json") === 0) {
                var r = await resp.json();
                avisoPaquete(r.mensaje);
                if (Fiscontable.refrescarDescargas) Fiscontable.refrescarDescargas();
                seguirPaquete(r.job_id, r.total);
            } else descargarBlob(await resp.blob(), nombreArchivo(resp, porDefecto));
        } catch (e) { avisar(e.message); }
        boton.disabled = false; boton.innerHTML = texto;
    }

    var PAQ = { texto: null };      // el último aviso de avance que pusimos (para no pisar un aviso de otra cosa)
    function avisoPaquete(texto, acciones) {
        PAQ.texto = texto;
        if (Fiscontable.aviso) Fiscontable.aviso(texto, acciones); else Fiscontable.avisar(texto);
    }
    function avisoPaqueteALaVista() {
        var caja = document.getElementById("fc-aviso"), t = document.getElementById("fc-aviso-texto");
        return !!(caja && t && !caja.hidden && t.textContent === PAQ.texto);
    }

    function seguirPaquete(jobId, total) {
        var fallas = 0;
        async function vuelta() {
            var r;
            try { r = await apiJSON("/api/xml/paquete/" + encodeURIComponent(jobId)); fallas = 0; }
            catch (e) { if (++fallas < 5) setTimeout(vuelta, 6000); return; }      // sin conexión un momento, o lo quitaron de Mis descargas
            if (r.estado === "procesando") {
                var n = r.total || total;
                if (r.hechos != null && avisoPaqueteALaVista())
                    avisoPaquete("Armando tu ZIP: " + r.hechos.toLocaleString("es-MX") + " de " + n.toLocaleString("es-MX") +
                        " comprobantes. Puedes seguir trabajando; al terminar queda en Mis descargas.");
                setTimeout(vuelta, 3000);
                return;
            }
            if (Fiscontable.refrescarDescargas) Fiscontable.refrescarDescargas();
            var verDescargas = { texto: "Abrir Mis descargas", accion: function () { if (Fiscontable.abrirDescargas) Fiscontable.abrirDescargas(); } };
            if (r.estado === "completado") {
                var acciones = r.partes > 1 ? [verDescargas] : [{ texto: "Descargar", accion: function () { bajarPaquete(r); } }, verDescargas];
                avisoPaquete("Tu ZIP está listo: " + (r.progreso || (total.toLocaleString("es-MX") + " comprobantes")) +
                    (r.partes > 1 ? ". Los " + r.partes + " archivos están en Mis descargas." : ". También queda en Mis descargas."), acciones);
            } else if (r.estado !== "cancelado") {
                avisoPaquete(r.mensaje_error || "No se pudo armar el paquete. Vuelve a pedirlo.");
            }
        }
        setTimeout(vuelta, 2000);
    }

    async function bajarPaquete(r) {
        try {
            var resp = await api(r.url_descarga);
            descargarBlob(await resp.blob(), r.nombre_descarga || nombreArchivo(resp, "cfdi.zip"));
        } catch (e) { avisar(e.message); }
    }

    async function descargarZipCompleto() {
        await pedirPaquetePdf("/api/xml/zip-completo", uuidsParaAcciones(), $("btn-zip-completo"), "pdf_y_xml.zip");
    }

    /* El enlace sí tiene tope: quien lo abre (sin cuenta) ve la lista completa y arma su ZIP en ese momento. */
    function compartirXml() {
        var uuids = uuidsParaAcciones();
        if (!uuids.length) { avisar("No hay XML en lo que ves."); return; }
        if (uuids.length > 300) {
            avisar("Un enlace para compartir lleva hasta 300 comprobantes, porque quien lo abre los ve en una lista y los baja ahí mismo. Tienes " +
                uuids.length.toLocaleString("es-MX") + ": selecciona o filtra menos, o baja «PDF y XML (ZIP)» y envía ese archivo.");
            return;
        }
        var nombre = (E.empresa && (E.empresa.alias || E.empresa.nombre)) || E.rfc;
        Fiscontable.compartir({ rfc: E.rfc, items: uuids.map(function (u) { return { tipo: "xml", rfc: E.rfc, uuid: u }; }), titulo: "CFDI de " + nombre });
    }

    /* Pagos: los XML de las facturas que pagaron los complementos que ves (o los seleccionados). */
    async function descargarZipOrigen() {
        var elegidos = E.seleccion.size ? E.seleccion : null;
        var filas = (E.filas || []).filter(function (f) { return !elegidos || elegidos.has(f.uuid); });
        var doctos = Array.from(new Set(filas.map(function (f) { return f.docto_uuid; }).filter(Boolean)));
        var faltan = new Set(filas.filter(function (f) { return f.docto_uuid && f.docto_encontrado === "No"; }).map(function (f) { return f.docto_uuid; }));
        var hay = doctos.filter(function (u) { return !faltan.has(u); });
        if (!hay.length) { avisar(doctos.length ? "Ninguna de esas facturas está en tu biblioteca (" + doctos.length + " sin cargar)." : "No hay facturas relacionadas en lo que ves."); return; }
        var boton = $("btn-zip-origen"), texto = boton.innerHTML;
        boton.disabled = true; boton.innerHTML = "<b>⏳</b>Preparando…";
        try {
            var resp = await postJSON("/api/xml/zip", { rfc: E.rfc, uuids: hay });
            descargarBlob(await resp.blob(), "facturas_pagadas.zip");
            if (faltan.size) avisar(hay.length + " factura(s) en el ZIP. " + faltan.size + " no están en tu biblioteca (descárgalas del SAT para tenerlas).");
        } catch (e) { avisar(e.message); }
        boton.disabled = false; boton.innerHTML = texto;
    }

    /* XML a PDF (representación impresa): uno = PDF; varios = ZIP (si son muchos, en segundo plano: pedirPaquetePdf). */
    async function descargarPdf() {
        var uuids = uuidsParaAcciones();
        if (uuids.length !== 1) { await pedirPaquetePdf("/api/xml/pdfs", uuids, $("btn-pdf"), "cfdi_pdf.zip"); return; }
        var boton = $("btn-pdf"), texto = boton.innerHTML;
        boton.disabled = true; boton.innerHTML = "<b>⏳</b>Generando…";
        try {
            var resp = await api("/api/xml/pdf?rfc=" + encodeURIComponent(E.rfc) + "&uuid=" + encodeURIComponent(uuids[0]));
            descargarBlob(await resp.blob(), nombreArchivo(resp, "cfdi.pdf"));
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

    /* 25-nov-2026, el dueño: «quitar de la biblioteca debe pedir PIN». Una sola ventana con lo que se quita y el PIN
       (Fiscontable.confirmarIdentidad, acción «quitar_xml»); el servidor también lo exige. */
    async function quitarSeleccion() {
        var n = E.seleccion.size, rfc = E.rfc, uuids = Array.from(E.seleccion);
        if (!n) return;
        var hecho = await Fiscontable.confirmarIdentidad("quitar_xml", function (conf) {
            return postJSON("/api/xml/quitar", { rfc: rfc, uuids: uuids, confirmacion: conf });
        }, { titulo: "Quitar " + n + " XML de la biblioteca", peligro: true, boton: "Quitar " + n + " XML",
             resumen: "<p class=\"fc-identidad__aviso\">Vas a quitar <b>" + n + " XML</b> de la biblioteca de <b>" + esc(nombreDe(rfc)) +
                      "</b> (" + esc(rfc) + ").</p><p class=\"fc-identidad__pie\">Se borran el archivo y su registro. Puedes volver a cargarlos después.</p>" });
        if (!hecho) return;
        E.seleccion.clear();
        try { await refrescarBibliotecas(rfc); } catch (e) { avisar(e.message); }
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

    /* 23-nov-2026 (el dueño: «el porcentaje de avance está bien»): el avance dice cuánto lleva, el % y, ya que se conoce
       el ritmo, cuánto falta. El servidor lo estima con lo observado; mientras no hay suficiente, sin tiempo. */
    function miles(n) { return (n || 0).toLocaleString("es-MX"); }
    function textoFaltan(min, alcanza, hasta) {
        if (min == null || min <= 0) return "";
        var t = min <= 1 ? " · falta menos de un minuto"
            : min < 60 ? " · faltan unos " + min + " min"
            : " · faltan cerca de " + Math.floor(min / 60) + " h" + (min % 60 ? " " + (min % 60) + " min" : "");
        return t + (alcanza === false ? " (lo que no alcance antes de las " + horaLocal(hasta) + ", la otra madrugada)" : "");
    }
    /* El corte es a las 6:30 del centro; en Cancún son las 7:30: se dice en la hora de quien lo ve (23-nov-2026, revisión) */
    function horaLocal(iso) {
        var d = iso ? new Date(iso) : null;
        if (!d || isNaN(d.getTime())) return "6:30";
        return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
    }

    function seguirValidacion() {
        clearTimeout(VAL.reloj);
        $("avance-validacion").hidden = false;
        $("avance-validacion").classList.remove("xml-validando--listo");
        $("btn-detener").hidden = false;
        $("btn-validar").disabled = true;
        if ($("aviso-fondo")) $("aviso-fondo").hidden = true;          // mientras, el avance va aquí (no dos avisos)
        (async function consultar() {
            var r;
            try { r = await apiJSON("/api/xml/validacion?desde=" + VAL.siguiente + "&rfc=" + encodeURIComponent(E.rfc || "")); } catch (e) { VAL.reloj = setTimeout(consultar, 4000); return; }
            if (r.estado === "ninguno") { $("avance-validacion").hidden = true; $("btn-validar").disabled = false; return; }
            VAL.siguiente = r.siguiente;
            aplicarCambiosSAT(r.cambios);
            var pct = r.porcentaje != null ? r.porcentaje : (r.total ? Math.floor(100 * r.hechos / r.total) : 100);
            $("validando-barra").style.width = pct + "%";
            var c = r.conteo;
            var conteos = miles(c.Vigente) + " vigentes · " + miles(c.Cancelado) + " cancelados" +
                (c["No encontrado"] ? " · " + miles(c["No encontrado"]) + " no encontrados" : "") + (c.Error ? " · " + miles(c.Error) + " sin respuesta del SAT" : "");
            if (r.estado === "corriendo") {
                $("validando-titulo").textContent = "Validando ante el SAT: " + miles(r.hechos) + " de " + miles(r.total) + " (" + pct + " %)" + textoFaltan(r.minutos_faltan);
                $("validando-detalle").textContent = conteos;
                VAL.reloj = setTimeout(consultar, 1500);
                return;
            }
            var detalle = miles(r.hechos) + " de " + miles(r.total) + " · " + conteos;
            $("validando-titulo").textContent = r.estado === "detenido" ? "Validación detenida." : "Validación terminada.";
            $("validando-detalle").textContent = detalle;
            $("avance-validacion").classList.add("xml-validando--listo");
            $("btn-detener").hidden = true;
            $("btn-validar").disabled = false;
            if (c.Error) $("validando-detalle").textContent = detalle + " — vuelve a validar esos más tarde.";
            vigilarFondo(r);                                           // cuántos siguen sin validar, ya con lo de ahora
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
        olvidarVacias();
        pintarFilas(true);
    }

    async function reanudarValidacion() {
        try {
            var r = await apiJSON("/api/xml/validacion?desde=0&rfc=" + encodeURIComponent(E.rfc || ""));
            if (r.estado === "corriendo" && r.rfc === E.rfc) { VAL.siguiente = 0; seguirValidacion(); }
            vigilarFondo(r);
        } catch (e) { /* nada */ }
    }

    /* El aviso de arriba de la tabla. 23-nov-2026 (el dueño: «las validaciones no se deben hacer en el momento, sino en la
       noche, madrugada, para no afectar lo que se quiera hacer»): lo que entra por carga o descarga ya no se valida al
       momento, lo valida la madrugada (de 1:00 a 6:30). De día dice cuántos de esta empresa siguen sin validar; mientras la
       madrugada valida los de esta empresa, el avance con su barra; al terminar, la tabla se actualiza sola con su estado.
       Si se prende el ajuste «validar_xml_al_momento», el aviso de antes (en_fondo: los que esperan en la cola). */
    var FONDO = { reloj: null, corria: false, rfc: null };
    function vigilarFondo(r) {
        var caja = $("aviso-fondo");
        if (!caja) {
            caja = document.createElement("div");
            caja.id = "aviso-fondo"; caja.setAttribute("role", "status");
            $("contenido").insertBefore(caja, $("contenido").firstChild);
        }
        clearTimeout(FONDO.reloj);
        r = r || {};
        var a = r.avance || {}, noche = a.madrugada || {}, emp = noche.empresa, enFondo = r.en_fondo || 0, cada = 0;
        if (FONDO.rfc !== E.rfc) FONDO.corria = false;              // otra empresa: lo de la anterior ya no cuenta
        function pintar(clase, giro, texto, pct) {
            caja.className = "xml-aviso-fondo" + (clase ? " " + clase : "");
            caja.innerHTML = (giro ? '<span class="xml-giro" aria-hidden="true"></span>' : "") + '<span class="xml-aviso-fondo__texto"></span>' +
                (pct != null ? '<span class="xml-aviso-fondo__barra" aria-hidden="true"><span></span></span>' : "");
            caja.querySelector(".xml-aviso-fondo__texto").textContent = texto;
            if (pct != null) caja.querySelector(".xml-aviso-fondo__barra span").style.width = pct + "%";
            caja.hidden = false;
        }
        if (r.estado === "corriendo" && r.rfc === E.rfc) {
            caja.hidden = true;                                       // «Validar estado SAT» lleva su propio avance
        } else if (noche.estado === "corriendo" && emp && emp.pendientes > 0) {
            pintar("xml-aviso-fondo--corriendo", true, "Validando ante el SAT: " + miles(emp.hechos) + " de " + miles(emp.total) +
                " (" + emp.porcentaje + " %)" + textoFaltan(emp.minutos_faltan, emp.alcanza, noche.hasta), emp.porcentaje);
            FONDO.corria = true; FONDO.rfc = E.rfc; cada = 15000;
        } else if (enFondo > 0) {
            pintar("", true, "Validando " + miles(enFondo) + " XML ante el SAT en segundo plano (vigente, cancelado, si es cancelable). Se actualizan automáticamente.");
            FONDO.corria = true; FONDO.rfc = E.rfc; cada = 15000;
        } else {
            if (FONDO.corria) { FONDO.corria = false; caja.hidden = true; cargarRegistros(); return; }   // ya terminó: la tabla con los estados nuevos
            var n = a.sin_validar || 0, cuando = noche.estado === "corriendo" ? "la próxima madrugada" : "esta madrugada";
            if (n > 0) {
                pintar("xml-aviso-fondo--dia", false, n === 1
                    ? "1 XML de esta empresa todavía sin validar ante el SAT. Se valida solo " + cuando + "; si lo necesitas ya, usa «Validar estado SAT»."
                    : miles(n) + " XML de esta empresa todavía sin validar ante el SAT. Se validan solos " + cuando + "; si necesitas alguno ya, usa «Validar estado SAT».");
                cada = 300000;                                        // de día, cada 5 min basta (por si la página se queda abierta en la noche)
            } else {
                caja.hidden = true;
            }
        }
        if (cada) FONDO.reloj = setTimeout(refrescarFondo, cada);
    }
    async function refrescarFondo() {
        if (!E.rfc) return;
        try { vigilarFondo(await apiJSON("/api/xml/validacion?desde=0&rfc=" + encodeURIComponent(E.rfc))); }
        catch (e) { FONDO.reloj = setTimeout(refrescarFondo, 30000); }
    }

    /* ============================================================ bandeja de carga */
    /* Los XML se leen en el navegador (también los de un ZIP) para mostrar un
       resumen antes de guardar. Nada llega al servidor hasta "Procesar", y solo
       se envían los XML de la empresa elegida. Los de otras empresas se quedan
       en la bandeja por si quieres procesarlos después para otra. */
    var GENERICOS = { XAXX010101000: 1, XEXX010101000: 1 };
    var LIMITE_LOTE = 40 * 1024 * 1024, LIMITE_ARCHIVOS = 400;
    var BJ = { xml: new Map(), invalidos: [], destino: null, cargandoZip: null, leyendo: 0, clientes: null, todas: null };

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
        if (!bytes.length) { BJ.invalidos.push({ archivo: nombre, motivo: NO_XML.vacio }); return; }
        if (bytes.length > 5 * 1024 * 1024) { BJ.invalidos.push({ archivo: nombre, motivo: "Pesa más de 5 MB." }); return; }
        // 26-nov-2026 (el dueño: «facturaci�n»): un XML que dice UTF-8 y trae los acentos en latin-1 se lee como windows-1252 (el
        // servidor hace lo mismo, core/cfdi.acentos_bien); antes salía «�» en la bandeja
        var texto;
        try { texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
        catch (e) { texto = new TextDecoder("windows-1252").decode(bytes); }
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
                sc.src = "/assets/js/terceros/jszip.min.js";
                sc.onload = ok; sc.onerror = function () { BJ.cargandoZip = null; mal(new Error("No se pudo abrir el ZIP (falló la descarga del lector de ZIP).")); };
                document.head.appendChild(sc);
            });
        }
        return BJ.cargandoZip;
    }

    // 25-nov-2026 (hueco H6, el dueño): un PDF u otro archivo ya no se ignora en silencio: queda en «no son CFDI» con su
    // motivo y se avisa. El PDF que llega junto con su XML (mismo nombre, como en los ZIP de Fiscontable) se omite sin aviso:
    // ese XML sí se carga y el PDF se arma solo. Lo mismo hace el servidor (modulos/xml/biblioteca.expandir_archivos).
    var NO_XML = { pdf: "Es un PDF: aquí se cargan los XML de las facturas (o un ZIP con ellos). Carga su XML; el PDF se arma solo.",
        otro: "No es un XML ni un ZIP: aquí se cargan los XML de las facturas (o un ZIP con ellos).", vacio: "El archivo está vacío." };
    function separarArchivos(archivos) {
        function raiz(n) { return String(n || "").split("/").pop().replace(/\.[^.]*$/, "").toLowerCase(); }
        var conXml = {}, utiles = [], fuera = [];
        archivos.forEach(function (f) { if (/\.xml$/i.test(f.name)) conXml[raiz(f.name)] = true; });
        archivos.forEach(function (f) {
            var pdf = /\.pdf$/i.test(f.name);
            if (/\.(xml|zip)$/i.test(f.name)) utiles.push(f);
            else if (!(pdf && conXml[raiz(f.name)])) fuera.push({ archivo: f.name, motivo: pdf ? NO_XML.pdf : NO_XML.otro });
        });
        var texto = "";
        if (fuera.length === 1) texto = "«" + fuera[0].archivo + "» no se carga. " + fuera[0].motivo;
        else if (fuera.length) {
            var pdfs = fuera.filter(function (x) { return x.motivo === NO_XML.pdf; }).length;
            texto = fuera.length + " archivos no se cargan porque no son XML ni ZIP" + (pdfs ? " (" + pdfs + " PDF)" : "") +
                ". Aquí se cargan los XML de las facturas (o un ZIP con ellos).";
        }
        return { utiles: utiles, fuera: fuera, texto: texto };
    }

    async function agregarArchivos(archivos) {
        abrirBandeja();
        var sep = separarArchivos(archivos), utiles = sep.utiles;
        BJ.invalidos = BJ.invalidos.concat(sep.fuera);
        if (sep.texto) avisar(sep.texto);
        if (!utiles.length) { if (!sep.texto) avisar("No encontré XML ni ZIP en lo que agregaste."); pintarBandeja(); return; }
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
                    if (!entradas.length) BJ.invalidos.push({ archivo: f.name, motivo: "El ZIP no trae ningún XML." });
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
            .filter(function (r) { return !!mios[r]; })      // 20-nov-2026 (el dueño): solo empresas dadas de alta; lo demás no se carga
            .slice(0, 12)
            .map(function (r) { return { rfc: r, nombre: mios[r] || nombres[r], n: cuenta[r], cliente: true }; });
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
        // 20-nov-2026 (el dueño): con XML de dos o más empresas, «Procesar todas» carga cada uno a su empresa de un jalón
        var todas = empresasDeLaBandeja(), ocupado = !!BJ.todas || !!BJ.leyendo;
        var conTodas = todas.empresas >= 2;
        caja.innerHTML = '<div class="xml-resumen">' +
            (cands.length ? '<div class="xml-resumen__destino">Estos XML son de <select id="sel-destino">' + opciones + "</select></div>" : "") +
            '<div class="xml-resumen__cifras">' +
                cifra(n.recibidos, "Recibidos") + cifra(n.emitidos, "Emitidos") + cifra(n.nomina, "Nómina") + cifra(n.pagos, "Pagos") +
                cifra(n.ajenos, cands.length ? "de otras empresas o sin dar de alta (no se cargan ahora)" : "de RFC sin dar de alta: da de alta la empresa en Clientes", true) + cifra(BJ.invalidos.length, "no son CFDI", true) +
            "</div>" +
            '<div class="xml-resumen__acciones">' +
                '<button type="button" id="btn-procesar" class="xml-btn xml-btn--primario"' + (total && !ocupado ? "" : " disabled") + ">" +
                    (BJ.leyendo ? "Leyendo archivos…" : "Procesar " + total.toLocaleString("es-MX") + " XML") + "</button>" +
                (conTodas ? '<button type="button" id="btn-procesar-todas" class="xml-btn"' + (ocupado ? " disabled" : "") +
                    ' title="Carga cada XML a su empresa (las ' + todas.empresas + ') y al final te muestra un resumen por empresa">' +
                    (BJ.todas ? "Procesando todas…" : "Procesar todas · " + todas.empresas + " empresas") + "</button>" : "") +
                '<button type="button" id="btn-vaciar" class="xml-enlace"' + (BJ.todas ? " disabled" : "") + ">Vaciar bandeja</button>" +
            "</div>" +
            (conTodas && !BJ.todas ? '<p class="xml-resumen__nota">«Procesar todas» guarda ' + todas.xml.toLocaleString("es-MX") +
                " XML, cada uno en su empresa. Lo de RFC sin dar de alta se queda en la bandeja.</p>" : "") +
            "</div>";
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
                var r = await apiJSON("/api/xml/cargar", Object.assign({ method: "POST", body: fd }, PARTE));
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

    /* ============================================================ «Procesar todas» (20-nov-2026, el dueño) */
    /* Cada XML de la bandeja va a CADA empresa dada de alta que sea su emisor o su receptor (la nómina, al patrón), de un
       jalón. Los XML suben por partes y el servidor los guarda en segundo plano (modulos/xml/carga_todas.py) mientras
       esta página muestra el avance. Doble clic, otra pestaña o un corte a media subida: la «clave» de la bandeja hace
       que el servidor regrese la misma carga (y solo se suben las partes que faltan); nada se carga dos veces.
       Lo que no entró a ninguna empresa (RFC sin alta, o empresas del despacho que no son tuyas) se queda en la bandeja. */
    var PARTE_TODAS_BYTES = 8 * 1024 * 1024, PARTE_TODAS_XML = 200;

    function empresasDeLaBandeja() {
        var mios = BJ.clientes || {}, vistas = {}, xml = 0;
        BJ.xml.forEach(function (x) {
            var lista = (x.tipo === "N" ? [x.er] : [x.er, x.rr]).filter(function (r) { return r && !GENERICOS[r] && mios[r]; });
            if (lista.length) xml++;
            lista.forEach(function (r) { vistas[r] = 1; });
        });
        return { empresas: Object.keys(vistas).length, xml: xml };
    }

    function claveBandeja(uuids) {
        // FNV-1a de 32 bits con dos semillas: la misma bandeja da la misma clave (no es para seguridad)
        var a = 0x811c9dc5, b = 0x01000193, texto = uuids.join(",");
        for (var i = 0; i < texto.length; i++) {
            var c = texto.charCodeAt(i);
            a = Math.imul(a ^ c, 16777619) >>> 0;
            b = Math.imul(b ^ c, 2246822519) >>> 0;
        }
        return uuids.length + "-" + a.toString(16) + b.toString(16);
    }

    function pintarAvanceTodas() {
        var t = BJ.todas;
        if (!t) return;
        var pct = t.total ? Math.round(100 * t.hechos / t.total) : 0;
        var texto = t.fase === "subiendo" ? "Subiendo los XML… " + t.hechos.toLocaleString("es-MX") + " de " + t.total.toLocaleString("es-MX")
            : "Guardando cada XML en su empresa… " + t.hechos.toLocaleString("es-MX") + " de " + t.total.toLocaleString("es-MX");
        var nota = t.fase === "subiendo" ? "No cierres esta página hasta que terminen de subir."
            : "Ya puedes seguir trabajando: esto sigue en el servidor aunque cierres la página.";
        $("resultado-carga").innerHTML = '<div class="xml-todas xml-todas--avance" role="status" aria-live="polite">' +
            '<div class="xml-todas__titulo"><span class="xml-giro"></span><strong>Procesar todas</strong></div>' +
            '<div class="xml-avance" aria-hidden="true"><span style="width:' + Math.max(3, pct) + '%"></span></div>' +
            '<p class="xml-todas__linea">' + texto + ' <span class="xml-tenue">· ' + pct + ' %</span></p>' +
            '<p class="xml-tenue">' + nota + "</p></div>";
    }

    async function procesarTodas() {
        if (BJ.todas || BJ.leyendo) return;                  // un segundo clic mientras corre: nada
        var lista = [];
        BJ.xml.forEach(function (x, uuid) { lista.push([uuid, x]); });
        if (!lista.length) return;
        lista.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });   // las mismas partes cada vez
        var partes = [], actual = [], peso = 0;
        lista.forEach(function (par) {
            if (actual.length && (peso + par[1].bytes.length > PARTE_TODAS_BYTES || actual.length >= PARTE_TODAS_XML)) { partes.push(actual); actual = []; peso = 0; }
            actual.push(par); peso += par[1].bytes.length;
        });
        if (actual.length) partes.push(actual);
        BJ.enviados = new Set(lista.map(function (p) { return p[0]; }));     // lo que se agregue mientras corre no se toca
        BJ.invalidosEnviados = BJ.invalidos.slice();                          // los que el navegador ya vio que no son CFDI
        BJ.todas = { fase: "subiendo", hechos: 0, total: lista.length };
        pintarBandeja(); pintarAvanceTodas();
        try {
            var ini = await (await postJSON("/api/xml/carga-todas", { clave: claveBandeja(lista.map(function (p) { return p[0]; })),
                                                                       total: lista.length, partes: partes.length }, PARTE)).json();
            var faltan = ini.faltan || [], subidos = lista.length - faltan.reduce(function (t, i) { return t + partes[i].length; }, 0);
            BJ.todas.hechos = subidos; pintarAvanceTodas();
            for (var k = 0; k < faltan.length; k++) {
                var i = faltan[k], fd = new FormData();
                partes[i].forEach(function (par) { fd.append("archivos", new Blob([par[1].bytes], { type: "application/xml" }), par[1].nombre); });
                fd.append("indice", String(i));
                try { await api("/api/xml/carga-todas/" + encodeURIComponent(ini.job_id) + "/parte", Object.assign({ method: "POST", body: fd }, PARTE)); }
                catch (e) {                                    // un tropiezo de la red: un reintento antes de rendirse
                    await new Promise(function (r) { setTimeout(r, 1500); });
                    await api("/api/xml/carga-todas/" + encodeURIComponent(ini.job_id) + "/parte", Object.assign({ method: "POST", body: fd }, PARTE));
                }
                BJ.todas.hechos += partes[i].length; pintarAvanceTodas();
            }
            BJ.todas = { fase: "guardando", hechos: 0, total: lista.length, job: ini.job_id };
            pintarAvanceTodas();
            await seguirTodas(ini.job_id);
        } catch (e) {
            BJ.todas = null;
            pintarBandeja();
            $("resultado-carga").innerHTML = '<div class="xml-resultado xml-resultado--error"><button type="button" class="xml-resultado__cerrar" title="Cerrar" data-cerrar-resultado>×</button>' +
                "<strong>No se terminó de procesar.</strong> " + esc(e.message) +
                ' <span>Vuelve a pulsar «Procesar todas»: lo que ya subió no se sube otra vez y nada se duplica.</span></div>';
        }
    }

    async function seguirTodas(jobId) {
        var espera = 600, fallas = 0;
        while (true) {
            await new Promise(function (r) { setTimeout(r, espera); });
            var est;
            try { est = await apiJSON("/api/xml/carga-todas/" + encodeURIComponent(jobId), PARTE); fallas = 0; }
            catch (e) { if (++fallas >= 5) throw e; continue; }
            if (est.estado === "procesando" || est.estado === "recibiendo") {
                BJ.todas = { fase: "guardando", hechos: est.hechos || 0, total: est.total || 0, job: jobId };
                pintarAvanceTodas();
                espera = Math.min(2000, espera + 200);
                continue;
            }
            await terminarTodas(est);
            return;
        }
    }

    async function terminarTodas(est) {
        BJ.todas = null;
        var r = est.resumen;
        if (r) {
            // Lo que entró sale de la bandeja; lo que no entró a ninguna empresa se queda (con su aviso)
            var fuera = new Set(r.fuera || []);
            var enviados = BJ.enviados || new Set(BJ.xml.keys());
            Array.from(BJ.xml.keys()).forEach(function (u) { if (enviados.has(u) && !fuera.has(u)) BJ.xml.delete(u); });
            BJ.enviados = null;
            if (!BJ.xml.size) BJ.invalidos = [];
            BJ.destino = null;
        }
        pintarBandeja();
        pintarResultadoTodas(est);
        $("bandeja").hidden = true;
        await refrescarBibliotecas(E.rfc && E.contribuyentes.some(function (c) { return c.rfc === E.rfc; }) ? E.rfc : null);
    }

    function pintarResultadoTodas(est) {
        var r = est.resumen || { empresas: [], nuevos: 0, repetidos: 0, rechazados_empresa: 0, sin_permiso: 0, no_registrados: { n: 0, rfcs: [] }, n_no_leidos: 0 };
        var n = function (v) { return (v || 0).toLocaleString("es-MX"); };
        var error = est.estado === "error";
        var titulo = error ? "La carga se detuvo a medias" :
            r.empresas.length ? "Listo: " + n(r.nuevos) + " XML nuevos en " + r.empresas.length + (r.empresas.length === 1 ? " empresa" : " empresas") :
            "No se cargó ningún XML";
        var filas = r.empresas.map(function (e) {
            var motivos = (e.motivos || []).length ? '<details class="xml-todas__motivos"><summary>Por qué</summary><ul>' +
                e.motivos.map(function (m) { return "<li>" + esc(m.archivo) + " — " + esc(m.motivo) + "</li>"; }).join("") + "</ul></details>" : "";
            return '<tr><th scope="row"><strong>' + esc(e.nombre || e.rfc) + "</strong><small>" + esc(e.rfc) + "</small>" + motivos + "</th>" +
                '<td class="xml-todas__nuevo" data-et="nuevos">' + n(e.nuevos) + '</td><td data-et="repetidos">' + n(e.repetidos) + '</td><td data-et="rechazados" class="' +
                (e.rechazados ? "xml-todas__mal" : "") + '">' + n(e.rechazados) + "</td></tr>";
        }).join("");
        var notas = [];
        if (r.sin_permiso) notas.push('<li class="xml-todas__nota--aviso"><b>' + n(r.sin_permiso) + " XML sin permiso" +
            ":</b> son de empresas del despacho que no están entre las tuyas. Si los necesitas, pide acceso en Clientes.</li>");
        if (r.tambien_sin_permiso) notas.push("<li><b>" + n(r.tambien_sin_permiso) + "</b> " + (r.tambien_sin_permiso === 1 ? "XML también es" : "XML también son") +
            " de una empresa del despacho que no es tuya: se guardaron solo en la tuya.</li>");
        var nr = r.no_registrados || { n: 0, rfcs: [] };
        if (nr.n) notas.push('<li class="xml-todas__nota--aviso"><b>' + n(nr.n) + " XML de RFC sin dar de alta</b>" +
            (nr.rfcs.length ? " (" + nr.rfcs.slice(0, 3).map(function (x) { return esc(x.rfc); }).join(", ") + (nr.rfcs.length > 3 ? "…" : "") + ")" : "") +
            ". Da de alta la empresa en Clientes y vuelve a cargarlos.</li>");
        var malos = (r.no_leidos || []).concat(BJ.invalidosEnviados || []);
        r.n_no_leidos = (r.n_no_leidos || 0) + (BJ.invalidosEnviados || []).length;
        if (r.n_no_leidos) notas.push('<li><b>' + n(r.n_no_leidos) + (r.n_no_leidos === 1 ? " archivo no se pudo leer" : " archivos no se pudieron leer") + "</b> (no son CFDI o están dañados)." +
            '<details class="xml-todas__motivos"><summary>Ver cuáles</summary><ul>' + malos.slice(0, 50).map(function (m) { return "<li>" + esc(m.archivo) + " — " + esc(m.motivo) + "</li>"; }).join("") + "</ul></details></li>");
        if (error && est.mensaje) notas.unshift('<li class="xml-todas__nota--aviso">' + esc(est.mensaje) + "</li>");
        $("resultado-carga").innerHTML = '<div class="xml-todas' + (error || !r.empresas.length ? " xml-todas--aviso" : "") + '" data-todas-listo>' +
            '<button type="button" class="xml-resultado__cerrar" title="Cerrar" data-cerrar-resultado>×</button>' +
            '<div class="xml-todas__titulo"><strong>' + titulo + "</strong>" +
                (r.repetidos ? '<span class="xml-tenue">· ' + n(r.repetidos) + " ya estaban</span>" : "") + "</div>" +
            (filas ? '<div class="xml-todas__caja"><table class="xml-todas__tabla"><thead><tr><th scope="col">Empresa</th><th scope="col">Nuevos</th>' +
                '<th scope="col" title="Ya estaban en su biblioteca: no se duplican">Repetidos</th><th scope="col">Rechazados</th></tr></thead><tbody>' + filas + "</tbody></table></div>" : "") +
            (notas.length ? '<ul class="xml-todas__notas">' + notas.join("") + "</ul>" : "") +
            (BJ.xml.size ? '<p class="xml-todas__pie">Quedaron ' + n(BJ.xml.size) + ' XML en la bandeja. <button type="button" class="xml-enlace" data-abrir-bandeja>Abrir la bandeja</button></p>' : "") +
            "</div>";
    }

    async function retomarTodas() {
        // Si recargaste la página mientras se guardaban, el avance sigue aquí
        try {
            var est = await apiJSON("/api/xml/carga-todas");
            if (!est || !est.job_id || est.estado !== "procesando") return;
            BJ.todas = { fase: "guardando", hechos: est.hechos || 0, total: est.total || 0, job: est.job_id };
            pintarAvanceTodas();
            await seguirTodas(est.job_id);
        } catch (e) { BJ.todas = null; /* sin carga en curso o servidor anterior: nada */ }
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
            if (e.target.id === "btn-procesar-todas") procesarTodas();
            if (e.target.id === "btn-vaciar" && !BJ.todas) { BJ.xml.clear(); BJ.invalidos = []; BJ.destino = null; pintarBandeja(); }
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
        if (excepto !== "menu-columna") cerrarMenuColumna(false);
        $("btn-vistas").setAttribute("aria-expanded", String(!$("menu-vistas").hidden));
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
        document.querySelectorAll("[data-ir]").forEach(function (b) {
            b.hidden = b.dataset.ir === "xml" ? !VISTA : b.dataset.ir === VISTA;           // no se ofrece ir a donde ya estás
            b.addEventListener("click", function () { irA(b.dataset.ir); });
        });
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
            if (b && b.dataset.modulo === "conceptos") { if (e.target.closest("[data-cerrar-conceptos]")) XMLConceptos.cerrar(); return; }
            if (!b || b.disabled) return;
            var m = b.dataset.modulo;
            if (moduloCargado(m) || !E.datos) return cambiarModulo(m);
            // Esa pestaña aún no se ha traído: se pide ahora (solo ella) y al llegar se pinta
            if (enConceptos()) XMLConceptos.cerrar();
            E.modulo = m; E.sub = "";
            if (!VISTA) Fiscontable.url({ tab: m });
            document.querySelectorAll("#pestanas .pestana").forEach(function (x) { x.classList.toggle("pestana--activa", x.dataset.modulo === m); x.setAttribute("aria-selected", String(x.dataset.modulo === m)); });
            pintarBotonConceptos();
            cargarRegistros({ pestana: true });
        });
        $("subfiltros").addEventListener("click", function (e) {
            var pp = e.target.closest("[data-pagos-por]");
            if (pp) {
                if (pp.dataset.pagosPor === E.pagosPor) return;
                E.pagosPor = pp.dataset.pagosPor; guardarLocal("pagosPor", E.pagosPor);
                E.cargado = null; cargarRegistros();               // otro criterio: se vuelve a pedir al servidor
                return;
            }
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
        $("filtros-activos").addEventListener("click", function (e) {
            var b = e.target.closest("[data-quitar-filtro]"); if (!b) return;
            var k = b.dataset.quitarFiltro;
            if (k === "*") { E.rapidos = {}; E.av = {}; }
            else if (k.indexOf("r:") === 0) delete E.rapidos[k.slice(2)];
            else delete E.av[k.slice(2)];
            pintarRapidos(); pintarAvanzados(); aplicar();
        });
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
                if (par[1] === "menu-vistas") $("btn-vistas").setAttribute("aria-expanded", String(!$("menu-vistas").hidden));
            });
            $(par[1]).addEventListener("click", function (e) { e.stopPropagation(); });
        });
        document.addEventListener("click", function () { cerrarMenus(); });
        $("menu-vistas").addEventListener("click", function (e) { var b = e.target.closest("[data-accion]"); if (b) accionVista(b.dataset.accion, b.dataset.valor); });
        document.querySelector(".mod-acciones").addEventListener("click", function (e) {
            var b = e.target.closest("[data-excel]"); if (b && !b.disabled) exportarExcel(b.dataset.excel);
        });
        $("btn-zip").addEventListener("click", descargarZip);
        $("btn-zip-completo").addEventListener("click", descargarZipCompleto);
        $("btn-compartir").addEventListener("click", compartirXml);
        $("btn-enlaces").addEventListener("click", function () { Fiscontable.enlacesCompartidos({ rfc: E.rfc }); });
        $("btn-zip-origen").addEventListener("click", descargarZipOrigen);
        $("btn-listas").addEventListener("click", abrirListas);
        $("btn-conceptos").addEventListener("click", abrirConceptos);
        $("btn-duplicados").addEventListener("click", abrirDuplicados);
        $("btn-cancelaciones").addEventListener("click", function () {
            var q = new URLSearchParams({ rfc: E.rfc || "" });
            if (E.modulo === "emitidos") q.set("vista", "emitidas");
            location.href = "/herramientas/xml/cancelaciones.html?" + q.toString();
        });
        $("btn-fiscal").addEventListener("click", function () {
            var est = E.P.estado(), q = new URLSearchParams({ rfc: E.rfc || "" });
            var mes = (hayEleccion() && est.meses && est.meses.length) ? String(est.meses[0]).slice(-2) : (est.desde || "").slice(5, 7);
            var anio = hayEleccion() ? est.anio : (est.desde || "").slice(0, 4);
            if (anio) q.set("anio", anio);
            if (mes) q.set("mes", +mes);
            q.set("lado", E.modulo === "recibidos" ? "recibidos" : "emitidos");
            location.href = "/herramientas/xml/fiscal.html?" + q.toString();
        });
        $("btn-pdf").addEventListener("click", descargarPdf);
        // 23-nov-2026: si el titular cambia las vistas del despacho en Configuración, el menú se pone al día
        window.addEventListener("fiscontable:config", function (ev) { if (ev.detail && ev.detail.seccion === "vistas_despacho") cargarVistas().then(pintarVistas); });
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
            if (e.target.closest("[data-dup]")) return abrirDuplicados();          // la marca ⧉ lleva a decidir el grupo
            var tr = e.target.closest("tr[data-i]");
            if (tr) abrirDetalle(E.filas[+tr.dataset.i]);
        });
        // El diálogo avisa cada vez que compara (al abrir y después de marcar): la tabla se pone al día sin volver a pedir
        document.addEventListener("fiscontable:duplicados", function (e) {
            var x = e.detail || {};
            if (x.lado !== "recibidos" && x.lado !== "emitidos") return;
            ponerMarcasDup([x.rfc, x.lado, x.desde, x.hasta].join("|"), x.marcas);
        });
        prepararEncabezados();
        prepararMenuColumna();
        prepararPanelColumnas();
    }
})();
