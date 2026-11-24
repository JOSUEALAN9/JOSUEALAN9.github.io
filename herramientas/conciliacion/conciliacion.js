/**
 * conciliacion.js — Conciliación de facturas contra sus complementos de
 * pago y notas de crédito. Todo el cálculo lo hace el servidor
 * (modulos/conciliacion/motor.py, el mismo que usa Administración de XML);
 * aquí se piden los datos UNA vez por empresa, lado y periodo, y filtros,
 * orden y columnas pasan en el navegador.
 *
 * ¿Para quién? La empresa activa de la barra, o una conciliación rápida de
 * alguien sin registrar (sus XML se borran solos a los 7 días).
 *
 * Fechas (para que no se confundan): la tabla entra al periodo por FECHA DE
 * COBRO (la fecha de pago del complemento; de fábrica, es la del IVA) o por
 * FECHA DE EMISIÓN de la factura. Los conteos de «PPD del periodo» van
 * siempre por emisión y el «IVA cobrado» siempre por cobro: no cambian con
 * ese botón.
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
        forma_pago: 200, uso_cfdi: 190, estado_sat: 100, ajuste_manual: 200, falta_complemento: 280, error_cfdi: 280, condiciones_pago: 180,
        fecha_emision: 120, fecha_ultimo_pago: 150, fecha_ultimo_complemento: 150, tc_origen: 200 };
    /* Con qué fecha entra una factura al periodo. De fábrica, la de cobro: es la del IVA al flujo. */
    var BASE_FABRICA = "pago";
    var TARJETAS_EMISION = { ppd_sin_pago: 1, ppd_parcial: 1, falta_comp: 1, error_cfdi: 1 };      // filtros que solo tienen sentido por fecha de emisión

    var E = {
        perfil: null, empresa: null, contribuyentes: [], otras: [], rfc: null, otra: null, clientesLista: null,
        lado: leer("lado") || "emitidos", datos: null, regla: leer("regla") || "dof", movsPorFactura: {},
        estado: "", tarjeta: null, rapidos: {}, av: {}, busqueda: "", tablas: {}, filtradas: [], facturaAbierta: null,
        vistas: null, inicial: {}, vistaSel: {}, puedeCompartir: false, enDespacho: false, f2: null
    };

    /* ============================================================ utilidades */
    function guardar(k, v) { try { localStorage.setItem("conc:" + k, JSON.stringify(v)); } catch (e) { /* nada */ } }
    function leer(k) { try { return JSON.parse(localStorage.getItem("conc:" + k)); } catch (e) { return null; } }
    function avisar(t) { if (Fiscontable.aviso) Fiscontable.aviso(t); else Fiscontable.avisar(t); }
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
    function descargarBlob(blob, nombre) { Fiscontable.guardarArchivo(blob, nombre); }
    function puede(modulo) { return !!(E.perfil && (E.perfil.modulos_permitidos || []).indexOf(modulo) !== -1); }

    /* ============================================================ arranque */
    document.addEventListener("DOMContentLoaded", iniciar);
    var bandeja;

    async function iniciar() {
        if (!(await Fiscontable.exigirModulo("conciliacion"))) return;
        E.perfil = await Fiscontable.perfil();
        E.enDespacho = ((E.perfil && E.perfil.espacio) || {}).tipo === "despacho";
        // 18-nov: «Ampliar» deja solo la tabla (buscador, filtros, lo seleccionado y el avance de la validación)
        Fiscontable.ampliar({ en: ".xml-toolbar__der", quedan: [".xml-toolbar", "#avance-validacion", "#barra-seleccion", "#tablas-marco", ".xml-pie"] });
        var q = new URLSearchParams(location.search);
        if (q.get("lado") === "emitidos" || q.get("lado") === "recibidos") E.lado = q.get("lado");
        // 18-nov: abre en «Facturas PPD». «Inconsistencias» y «IVA del periodo» son la misma tabla con otro corte;
        // «Complementos de pago» es la tabla de Administración de XML (se navega). Ver pestanas-conciliacion.js.
        E.pestana = ["ppd", "errores", "iva"].indexOf(q.get("pestana")) !== -1 ? q.get("pestana") : "ppd";
        FCPestanasConc.pintar($("conc-vista"), E.pestana, elegirPestana, function () { return E.rfc || ""; });
        if (E.pestana === "errores") $("sel-base").value = "emision";      // lo mal emitido se cuenta por lo facturado
        else if (E.pestana === "iva") $("sel-base").value = "pago";         // el IVA, por lo cobrado o pagado
        else if (q.get("base") === "pago" || q.get("base") === "emision") $("sel-base").value = q.get("base");
        else if (leer("base2") === "pago" || leer("base2") === "emision") $("sel-base").value = leer("base2");
        else $("sel-base").value = BASE_FABRICA;
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
        E.selPeriodo = FCPeriodoMeses.crear({ contenedor: $("periodo-conc"), alCambiar: function () { cargarDatos(); }, conBoton: true });
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
    /* Dos tablas por lado: la de «Fiscontable» (y las vistas guardadas a partir de ella) y la de «Formato 2» (la hoja
       «Conciliacion» del programa anterior con nuestras columnas al final; se arma cuando se elige esa vista). */
    function prepararTablas() {
        ["emitidos", "recibidos"].forEach(function (lado) {
            var caja = document.createElement("div"), cajaF2 = document.createElement("div");
            caja.className = cajaF2.className = "xml-tabla-caja";
            caja.hidden = lado !== E.lado; cajaF2.hidden = true;
            $("tablas").appendChild(caja); $("tablas").appendChild(cajaF2);
            E.tablas[lado] = { caja: caja, tabla: null, cajaF2: cajaF2, f2: null, lista: false };
        });
    }

    /* La tabla que se ve (la de la vista activa). */
    function tabla() { var t = E.tablas[E.lado]; return baseActual() === "formato2" ? t.f2 : t.tabla; }

    async function asegurarTabla() {
        var t = E.tablas[E.lado];
        if (E.vistas === null) await cargarVistas();
        if (!t.tabla) {
            t.tabla = FCTabla.crear({
                caja: t.caja, id: "conc-" + E.lado, catalogo: E.datos.columnas, predeterminadas: E.datos.predeterminadas,
                sellos: SELLOS, etiquetas: { estado_conciliacion: nombreEstado }, anchoClave: ANCHOS, claveFila: "uuid",
                claseFila: function (f) { return f.estado_conciliacion === "Cancelada" ? "fila-cancelada" : ""; },
                alClic: abrirFactura,
                // 23-nov-2026 (decisión E): el folio es un enlace real a la factura (Ctrl+clic o clic medio: otra pestaña)
                ligaFila: function (f) { return puede("validador") && Fiscontable.urlFactura ? Fiscontable.urlFactura(E.rfc, f.uuid) : ""; },
                alSeleccionar: pintarSeleccion,
                alCambiarColumnas: alCambiarColumnas
            });
            t.tabla.iniciarColumnas(null);
        }
        if (!t.lista) { t.lista = true; vistaAlAbrir(); }
        if (baseActual() === "formato2" && !f2Listo()) await pedirF2();
        mostrarTabla();
    }

    function mostrarTabla() {
        var f2 = baseActual() === "formato2";
        Object.keys(E.tablas).forEach(function (l) {
            var t = E.tablas[l];
            t.caja.hidden = l !== E.lado || f2;
            t.cajaF2.hidden = l !== E.lado || !f2 || !t.f2;
        });
    }

    /* ============================================================ vistas */
    /* 23-nov-2026 (el dueño, A.6 del Avance 1): menú «Vista ▾» arriba de la tabla, el mismo servicio de Administración de
       XML. «Fiscontable» (la de siempre, la que viene puesta), «Formato 2» (la hoja «Conciliacion» del programa anterior, con
       nuestras columnas al final) y las vistas guardadas: «Mis vistas» y, en un despacho, «Del despacho». Mover, quitar o
       agregar columnas deja la vista «con cambios» y aparece «Guardar como vista nueva». Las dos de base nunca se
       sobrescriben. Lo acomodado sin guardar se recuerda en este navegador (por lado). */
    var BASES = { fiscontable: "Fiscontable", formato2: "Formato 2" };

    async function cargarVistas() {
        try {
            var d = await apiJSON("/api/conciliacion/vistas?con_estado=1");
            E.vistas = d.vistas || []; E.inicial = d.inicial || {}; E.puedeCompartir = !!d.puede_compartir;
        } catch (e) { E.vistas = []; E.inicial = {}; E.puedeCompartir = false; }
    }
    function selActual() { return E.vistaSel[E.lado] || { tipo: "fiscontable" }; }
    function vistaGuardada(id) { return (E.vistas || []).find(function (v) { return v.id === id && v.lado === E.lado; }) || null; }
    function baseActual() {
        var s = selActual();
        if (s.tipo === "guardada") return (vistaGuardada(s.id) || {}).base === "formato2" ? "formato2" : "fiscontable";
        return s.tipo === "formato2" ? "formato2" : "fiscontable";
    }
    function nombreVistaActual() {
        var s = selActual();
        return s.tipo === "guardada" ? ((vistaGuardada(s.id) || {}).nombre || "Fiscontable") : BASES[s.tipo] || "Fiscontable";
    }
    function claveDe(c) { return typeof c === "string" ? c : (c && c.clave) || ""; }
    function columnasDeVista(s) {
        var t = E.tablas[E.lado], cols;
        if (s.tipo === "guardada") { var v = vistaGuardada(s.id); cols = v ? v.columnas : null; }
        else if (s.tipo === "formato2") cols = E.f2 ? E.f2.columnas.map(function (c) { return c.clave; }) : [];
        if (!cols) cols = (E.datos && E.datos.predeterminadas) || [];
        return cols.map(function (c) { return typeof c === "string" ? { clave: c, ancho: 0 } : { clave: c.clave, ancho: c.ancho || 0 }; })
            .filter(function (c) { return !!c.clave; });
    }
    function firma(cols) { return cols.map(claveDe).join("|"); }
    function conCambios() {
        var t = tabla();
        if (!t || (baseActual() === "formato2" && !f2Listo())) return false;
        var hay = {};
        t.columnas().forEach(function (c) { hay[c.clave] = 1; });
        var esperadas = columnasDeVista(selActual()).filter(function (c) { return t.etiqueta(c.clave) !== c.clave || hay[c.clave]; });
        return firma(t.columnas()) !== firma(esperadas);
    }
    function recordar() { guardar("vista3:" + E.lado, { sel: selActual(), cambios: conCambios() }); }
    function alCambiarColumnas() { recordar(); pintarVistas(); }

    /* Al abrir un lado: lo que este navegador recuerda; si no, «Abrir siempre con esta vista» (de la persona); si no,
       «Fiscontable». Una vista con nombre de la versión anterior (guardada en este navegador) pasa a la nueva. */
    function vistaAlAbrir() {
        var local = leer("vista3:" + E.lado), s = local && local.sel, cambios = !!(local && local.cambios);
        if (!s) {
            var vieja = null;
            try { vieja = JSON.parse(localStorage.getItem("tabla:conc-" + E.lado + ":vista") || "null"); } catch (e) { vieja = null; }
            var v = vieja ? (E.vistas || []).find(function (x) { return x.lado === E.lado && x.nombre === vieja; }) : null;
            var ini = E.inicial[E.lado];
            s = v ? { tipo: "guardada", id: v.id } : typeof ini === "number" ? { tipo: "guardada", id: ini } : { tipo: ini === "formato2" ? "formato2" : "fiscontable" };
            cambios = !v && !!localStorage.getItem("tabla:conc-" + E.lado + ":cols") && !ini;          // lo acomodado antes, sin nombre
        }
        if (s.tipo === "guardada" && !vistaGuardada(s.id)) { s = { tipo: "fiscontable" }; cambios = false; }
        E.vistaSel[E.lado] = s;
        if (!cambios && baseActual() === "fiscontable") E.tablas[E.lado].tabla.aplicarVista({ columnas: columnasDeVista(s), nombre: nombreVistaActual() });
        E.tablas[E.lado].cambiosAlAbrir = cambios;
    }

    function pintarVistas() {
        if (!E.datos) return;
        var s = selActual(), cambios = conCambios(), v = s.tipo === "guardada" ? vistaGuardada(s.id) : null;
        $("nombre-vista").textContent = "Vista: " + nombreVistaActual() + (cambios ? " (con cambios)" : "");
        $("btn-guardar-vista").hidden = !cambios;
        function item(accion, valor, texto, clase, titulo) {
            return '<button type="button" role="menuitem" data-accion="' + accion + '" data-valor="' + esc(String(valor)) + '"' + (clase ? ' class="' + clase + '"' : "") +
                (titulo ? ' title="' + esc(titulo) + '"' : "") + ">" + texto + "</button>";
        }
        var activa = function (t, id) { return s.tipo === t && (t !== "guardada" || s.id === id) ? "xml-activa" : ""; };
        var h = [item("base", "fiscontable", "Fiscontable", activa("fiscontable"), "Nuestro diseño de siempre"),
                 item("base", "formato2", "Formato 2", activa("formato2"), "La hoja «Conciliacion» del reporte de pagos, tal cual, y al final nuestras columnas en pesos")];
        var deLado = (E.vistas || []).filter(function (x) { return x.lado === E.lado; });
        var mias = deLado.filter(function (x) { return !x.compartida || !E.enDespacho; });
        var desp = E.enDespacho ? deLado.filter(function (x) { return x.compartida; }) : [];
        var marca = function (x) { return esc(x.nombre) + (E.inicial[E.lado] === x.id ? " ★" : ""); };
        if (mias.length) { h.push('<p class="xml-menu__titulo">Mis vistas</p>'); mias.forEach(function (x) { h.push(item("vista", x.id, marca(x), activa("guardada", x.id))); }); }
        if (desp.length) { h.push('<p class="xml-menu__titulo">Del despacho</p>'); desp.forEach(function (x) { h.push(item("vista", x.id, marca(x), activa("guardada", x.id))); }); }
        h.push('<div class="xml-separador"></div>');
        if (cambios && v && v.puede_cambiar) h.push(item("guardar", v.id, "Guardar cambios en «" + esc(v.nombre) + "»"));
        h.push(item("nueva", "", "Guardar como vista nueva…"));
        if (cambios) h.push(item("deshacer", "", "Deshacer mis cambios"));
        var actual = s.tipo === "guardada" ? s.id : s.tipo;
        if ((E.inicial[E.lado] || "fiscontable") !== actual) h.push(item("inicial", actual, "Abrir siempre con esta vista ★"));
        if (v && E.puedeCompartir && E.enDespacho && (v.mia || v.compartida)) h.push(item("compartir", v.id, v.compartida ? "Dejar de compartir con el despacho" : "Compartir con el despacho"));
        if (v && v.puede_cambiar) h.push(item("borrar", v.id, "Borrar «" + esc(v.nombre) + "»", "xml-peligro"));
        $("menu-vistas").innerHTML = h.join("");
    }

    async function elegirVista(s) {
        E.vistaSel[E.lado] = s;
        guardar("vista3:" + E.lado, { sel: s, cambios: false });
        if (baseActual() === "formato2" && !f2Listo()) { pintarVistas(); await pedirF2(); }
        var t = tabla();
        if (t) t.aplicarVista({ columnas: columnasDeVista(s), nombre: nombreVistaActual() });
        mostrarTabla();
        recordar();
        pintarVistas();
        aplicar();
    }

    /* «Formato 2» en pantalla: el servidor lee el XML guardado de cada factura de la tabla (una vez por empresa, lado y
       periodo, cuando se elige esa vista). */
    function claveF2() { var r = rango(); return [E.rfc, E.lado, r.desde, r.hasta, (mesesSueltos() || []).join(","), $("sel-base").value, E.regla, E.datos ? E.datos.facturas.length : 0].join("|"); }
    function f2Listo() { return !!E.f2 && E.f2.clave === claveF2() && !!E.tablas[E.lado].f2; }
    async function pedirF2() {
        var clave = claveF2(), lado = E.lado;
        if (E.f2Pidiendo === clave) return;
        E.f2Pidiendo = clave;
        var carga = E.carga || Fiscontable.avisoCarga($("tablas-marco"), { junto: $("acciones-alcance") });
        E.carga = carga;
        carga.mostrar("Leyendo los XML para «Formato 2»…", "Sigue leyendo… un periodo grande tarda un poco más.");
        var r = rango(), d;
        try {
            d = await (await enviar("/api/conciliacion/formato2", { rfc: E.rfc, lado: lado, desde: r.desde, hasta: r.hasta, meses: mesesSueltos(),
                base: $("sel-base").value, regla: E.regla })).json();
        } catch (e) {
            if (E.f2Pidiendo === clave) E.f2Pidiendo = "";
            carga.quitar(); avisar(e.message);
            E.vistaSel[lado] = { tipo: "fiscontable" }; recordar(); pintarVistas(); mostrarTabla(); aplicar();
            return;
        }
        if (E.f2Pidiendo !== clave) return;
        E.f2Pidiendo = "";
        E.f2 = { clave: clave, columnas: d.columnas, filas: d.filas || {} };
        var t = E.tablas[lado];
        if (!t.f2) {
            t.f2 = FCTabla.crear({
                caja: t.cajaF2, id: "conc-f2-" + lado, catalogo: d.columnas, predeterminadas: d.columnas.map(function (c) { return c.clave; }),
                claveFila: "uuid", alClic: abrirFactura, alSeleccionar: pintarSeleccion, alCambiarColumnas: alCambiarColumnas,
                claseFila: function (f) { return f.estado_conciliacion === "Cancelada" ? "fila-cancelada" : ""; }
            });
            t.f2.iniciarColumnas(null);
            if (!t.cambiosAlAbrir) t.f2.aplicarVista({ columnas: columnasDeVista(selActual()), nombre: nombreVistaActual() });
        }
        carga.listo("Formato 2 · " + Object.keys(E.f2.filas).length.toLocaleString("es-MX") + " factura(s)");
    }

    /* Los renglones de la tabla de «Formato 2»: la factura (para filtros, detalle y selección) con sus celdas del formato. */
    function filasF2(filas) {
        var f2 = (E.f2 && E.f2.filas) || {};
        return filas.map(function (f) { return Object.assign({}, f, f2[f.uuid] || {}); });
    }

    /* «Guardar como vista nueva»: su nombre y, si eres el titular, si la ve todo el despacho. */
    function preguntarNombreVista() {
        var dlg = $("dlg-vista");
        $("vista-nombre").value = "";
        $("vista-error").hidden = true;
        $("vista-compartir-caja").hidden = !(E.puedeCompartir && E.enDespacho);
        $("vista-compartir").checked = false;
        $("dlg-vista-sub").textContent = "Con las columnas que ves ahora, en su orden (" + tabla().columnas().length + "). «Fiscontable» y «Formato 2» no cambian.";
        return new Promise(function (resolver) {
            var hecho = false;
            function terminar(valor) { if (hecho) return; hecho = true; dlg.removeEventListener("click", clic); dlg.removeEventListener("close", cerro); if (dlg.open) dlg.close(); resolver(valor); }
            function clic(e) {
                var b = e.target.closest("[data-vista-dlg]"); if (!b) return;
                if (b.dataset.vistaDlg !== "ok") return terminar(null);
                var n = $("vista-nombre").value.trim();
                if (!n) { $("vista-error").textContent = "Escribe el nombre de la vista."; $("vista-error").hidden = false; $("vista-nombre").focus(); return; }
                terminar({ nombre: n.slice(0, 60), compartida: !$("vista-compartir-caja").hidden && $("vista-compartir").checked });
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
            var r = await (await enviar("/api/conciliacion/vistas", Object.assign({ lado: E.lado, base: baseActual(),
                columnas: tabla().columnas().map(function (c) { return { clave: c.clave, ancho: c.ancho || 0 }; }) }, cuerpo), "PUT")).json();
            await cargarVistas();
            E.vistaSel[E.lado] = { tipo: "guardada", id: r.vista.id };
            tabla().marcarVista(r.vista.nombre);
            recordar(); pintarVistas();
            avisar("Vista «" + r.vista.nombre + "» guardada" + (r.vista.compartida ? " y compartida con el despacho." : "."));
        } catch (e) { avisar(e.message); }
    }

    async function accionVista(accion, valor) {
        $("menu-vistas").hidden = true;
        var s = selActual(), v = s.tipo === "guardada" ? vistaGuardada(s.id) : null;
        if (accion === "base") return elegirVista({ tipo: valor });
        if (accion === "vista") return elegirVista({ tipo: "guardada", id: +valor });
        if (accion === "deshacer") return elegirVista(s);
        if (accion === "nueva") {
            var r = await preguntarNombreVista();
            if (r) await guardarVista({ nombre: r.nombre, compartida: r.compartida || null, nueva: true });
            return;
        }
        if (accion === "guardar" && v) return guardarVista({ id: v.id, nombre: v.nombre });
        try {
            if (accion === "inicial") {
                await enviar("/api/conciliacion/vistas/inicial", { lado: E.lado, vista: String(valor) }, "PUT");
                E.inicial[E.lado] = /^\d+$/.test(String(valor)) ? +valor : valor;
                pintarVistas();
                avisar("Este lado abrirá siempre con «" + nombreVistaActual() + "».");
            } else if (accion === "compartir" && v) {
                await enviar("/api/conciliacion/vistas/" + v.id + "/compartir", { compartida: !v.compartida });
                await cargarVistas(); pintarVistas();
                avisar(v.compartida ? "«" + v.nombre + "» ya no se comparte con el despacho." : "«" + v.nombre + "» se compartió con el despacho.");
            } else if (accion === "borrar" && v) {
                if (!(await Fiscontable.preguntar("¿Borrar la vista «" + v.nombre + "»?" + (v.compartida ? " Es del despacho: dejarán de verla todos." : "")))) return;
                await api("/api/conciliacion/vistas/" + v.id, { method: "DELETE" });
                await cargarVistas();
                elegirVista({ tipo: "fiscontable" });
            }
        } catch (e) { avisar(e.message); }
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
        // G-02: la empresa activa ya está en la barra de arriba; aquí solo queda «Otro contribuyente ▾»
        var soloOtro = !!(rfc && !E.otra);
        boton.classList.toggle("ctx-campo--discreto", soloOtro);
        if (soloOtro) { $("empresa-etiqueta").textContent = ""; $("empresa-titulo").textContent = "Cambiar empresa"; }
        var aviso = $("aviso-otra");
        aviso.hidden = !E.otra;
        if (E.otra) {
            aviso.innerHTML = (reg ? "Estás viendo <strong>" + esc(nombreDe(E.otra)) + "</strong>, que no es tu empresa activa."
                : "<strong>" + esc(nombreDe(E.otra)) + "</strong> no está en tu directorio: sus XML se borran automáticamente " + Fiscontable.textoPlazo("xml_sin_registrar") + " después de la última carga." +
                  ' <a class="xml-enlace" href="/clientes/">Registrarla como cliente</a>') +
                (E.empresa ? ' <button type="button" class="xml-enlace" id="volver-empresa">Volver a ' + esc(E.empresa.alias || E.empresa.rfc) + "</button>" : "");
        }
    }

    function mostrarVacio() {
        $("contenido").hidden = true;
        $("ayuda-base").hidden = true;
        $("btn-agregar").hidden = true;          // el aviso de abajo ya trae su botón: no dos «Agregar XML»
        var caja = $("sin-empresa");
        caja.hidden = false;
        if (E.empresa) {
            caja.innerHTML = '<p class="ctx-vacio__titulo">' + esc(E.empresa.alias || E.empresa.rfc) + " todavía no tiene XML</p>" +
                "<p>Agrega sus facturas, complementos de pago y notas de crédito (o el ZIP de la descarga masiva del SAT). " +
                "Son los mismos XML de Administración de XML: lo que cargues aquí, allá también aparece.</p>" +
                '<div class="ctx-vacio__acciones"><button type="button" class="xml-btn xml-btn--primario" data-agregar>+ Agregar XML</button></div>';
        } else {
            caja.innerHTML = '<p class="ctx-vacio__titulo">¿De quién es la conciliación?</p>' +
                "<p>Elige una de tus empresas. Para trabajar con otro RFC, primero dalo de alta en Clientes (cuenta en el tope de tu plan).</p>" +
                '<div class="ctx-vacio__acciones"><button type="button" class="xml-btn xml-btn--primario" data-elegir>Elegir empresa</button>' +
                '<a class="xml-btn" href="/clientes/">+ Registrar empresa</a></div>';
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
        if (b.hasAttribute("data-nuevo")) { bandeja.abrir(); return; }
        if (b.dataset.otra) { refrescarBibliotecas(b.dataset.otra); return; }
        if (b.dataset.empresa) {
            if (E.empresa && E.empresa.rfc === b.dataset.empresa) { E.otra = null; E.rfc = null; refrescarBibliotecas(); }
            else await Fiscontable.elegirEmpresa(b.dataset.empresa);
            return;
        }
        if (b.dataset.borrar) {
            var rfc = b.dataset.borrar;
            if (!(await Fiscontable.preguntar("¿Borrar ya todos los XML de " + nombreDe(rfc) + " (" + rfc + ")?\n\nNo está en tu directorio; no quedará registro."))) return;
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
        $("btn-agregar").hidden = false;
        $("contenido").hidden = false;
        var hay = E.selPeriodo.hayEleccion();
        $("elige-periodo").hidden = hay;
        $("cuerpo-conc").hidden = !hay;
        $("ayuda-base").hidden = !hay;
        if (!hay) { E.nCarga = (E.nCarga || 0) + 1; E.datos = null; return; }      // lo que venga en camino ya no aplica (17-nov)
        guardar("lado", E.lado); guardar("base2", $("sel-base").value);
        var r = rango();
        var sueltos = mesesSueltos();
        var comun = "?rfc=" + encodeURIComponent(E.rfc) + "&lado=" + E.lado + "&base=" + $("sel-base").value +
            (r.desde ? "&desde=" + r.desde : "") + (r.hasta ? "&hasta=" + r.hasta : "") + (sueltos ? "&meses=" + sueltos.join(",") : "");
        // En la dirección queda el periodo tal como se eligió (cuadros o fechas), para recargar igual
        var est = E.selPeriodo.estado(), url = new URLSearchParams({ rfc: E.rfc, lado: E.lado, base: $("sel-base").value });
        if (E.selPeriodo.porFechas()) { if (est.desde) url.set("desde", est.desde); if (est.hasta) url.set("hasta", est.hasta); }
        else { url.set("anio", est.anio); url.set("meses", est.meses.join(",")); }
        if (E.pestana && E.pestana !== "ppd") url.set("pestana", E.pestana);       // la pestaña en la que estás se conserva al recargar
        history.replaceState(null, "", location.pathname + "?" + url.toString());
        $("conteo-filas").textContent = "";
        // 17-nov: etiqueta «Calculando…» sobre la tabla y, al llegar, «Actualizado · cuántas facturas» (pieza común de nucleo.js)
        E.carga = E.carga || Fiscontable.avisoCarga($("tablas-marco"), { junto: $("acciones-alcance") });      // arriba, como en Administración de XML
        var queCarga = E.selPeriodo.texto ? E.selPeriodo.texto() : "";
        if (queCarga.length > 34) queCarga = "los meses elegidos";
        E.carga.mostrar("Calculando " + (queCarga || "el periodo") + "…", "Sigue calculando… un periodo grande tarda un poco más.");
        $("tablas").classList.add("conc-cargando");               // G-10: la tabla se atenúa y el resumen muestra su forma, no «Calculando…»
        if (!E.datos) { $("tarjetas").innerHTML = '<div class="ctx-resumen__dato"><span class="ui-skel" style="width:90px"></span><span class="ui-skel" style="width:120px;height:18px;margin-top:6px"></span></div>'.repeat(3); $("pendientes").innerHTML = ""; }
        document.querySelectorAll("#lados .conc-lado").forEach(function (b) { b.classList.toggle("conc-lado--activo", b.dataset.lado === E.lado); });
        var datos;
        var yo = (E.nCarga = (E.nCarga || 0) + 1);           // si cambias el periodo mientras carga, gana el último
        try { datos = await apiJSON("/api/conciliacion/datos" + comun + "&regla=" + E.regla); }
        catch (e) { if (yo === E.nCarga) { E.carga.quitar(); avisar(e.message); $("conteo-filas").textContent = ""; $("tablas").classList.remove("conc-cargando"); } return; }
        if (yo !== E.nCarga || datos.lado !== E.lado || datos.rfc !== E.rfc) return;          // llegó tarde: ya cambiaste de lado o empresa
        E.datos = datos;
        $("tablas").classList.remove("conc-cargando");
        E.movsPorFactura = {};
        E.datos.movimientos.forEach(function (m) { (E.movsPorFactura[m.uuid_factura] = E.movsPorFactura[m.uuid_factura] || []).push(m); });
        await asegurarTabla();
        pintarAvisoValidar();
        pintarTarjetas();
        pintarPendientes();
        pintarChipsEstado();
        pintarRapidos();
        aplicar();
        E.carga.listo("Actualizado · " + (queCarga || "el periodo") + " · " + E.datos.facturas.length.toLocaleString("es-MX") + " factura(s)");
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
        // 18-nov: en un renglón (antes eran dos, con el botón abajo); el detalle, al pasar el cursor
        caja.innerHTML = '<span title="Facturas, pagos y notas de este lado que no se han validado ante el SAT"><strong>' + n.toLocaleString("es-MX") + " sin validar ante el SAT.</strong> " +
            "Si alguno está cancelado, el resultado cambia.</span>" +
            '<button type="button" class="xml-btn" id="validar-faltan">Validar los que faltan</button>';
    }

    /* «El periodo es por: Fecha de cobro | Fecha de emisión», con una línea que dice qué entra y para qué sirve. */
    function pintarBase() {
        var base = $("sel-base").value;
        document.querySelectorAll("#base [data-base]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.base === base)); });
        $("base-pago").textContent = textoLado("Fecha de cobro", "Fecha de pago");
        $("ayuda-base").innerHTML = base === "pago"
            ? "Entra lo <strong>" + textoLado("cobrado", "pagado") + " en el periodo</strong>, según la fecha de pago del complemento (las PUE, su fecha de emisión), aunque la factura sea de otro mes. " +
              "Es la que conviene para el <strong>IVA</strong>."
            : "Entran las <strong>facturas emitidas en el periodo</strong>, con todos sus pagos hasta hoy. Es la que conviene para saber qué " +
              textoLado("facturaste y qué te deben", "te facturaron y qué debes") + "; para el IVA usa «" + textoLado("Fecha de cobro", "Fecha de pago") + "».";
    }

    /* Lo pendiente de lo FACTURADO en el periodo (siempre por fecha de emisión) y el IVA cobrado (siempre por fecha
       de cobro). Lo calcula el servidor aparte de la tabla, así que dice lo mismo se vea como se vea. */
    function pintarPendientes() {
        var caja = $("pendientes"), p = E.datos.pendientes, iva = (E.datos.iva_periodo || {}).total;
        var errores = p && p.errores_cfdi ? p.errores_cfdi : { n: 0, pue_99: 0 };       // 17-nov: lo mal emitido va aparte de lo que le falta complemento
        FCPestanasConc.cuenta($("conc-vista"), "errores", errores.n);
        caja.hidden = resumenPlegado();            // 18-nov: plegado, el resumen es una sola línea (la de arriba) y la tabla sube
        if (!p || !iva || (!p.ppd && !p.falta_complemento.n && !errores.n && !iva.n)) { caja.innerHTML = ""; return; }
        function boton(clave, etiqueta, n, detalle, titulo) {
            return '<button type="button" data-pendiente="' + clave + '" title="' + esc(titulo) + '" class="ctx-resumen__dato' + (n ? " ctx-resumen__dato--alerta" : "") +
                (E.tarjeta === clave ? " ctx-resumen__dato--activo" : "") + '"' + (n ? "" : " disabled") + "><small>" + esc(etiqueta) + "</small><b>" + n.toLocaleString("es-MX") + "</b><span>" + esc(detalle) + "</span></button>";
        }
        var porTasa = [["16 %", iva.iva16], ["8 %", iva.iva8], ["otras", iva.iva_otras]].filter(function (t) { return t[1]; })
            .map(function (t) { return t[0] + ": $" + dinero(t[1]); }).join(" · ");
        var fuera = p.falta_complemento.fuera_de_plazo;
        caja.innerHTML =
            '<div class="ctx-resumen__dato" title="Facturas PPD emitidas en el periodo (por fecha de emisión), sin las canceladas"><small>' + textoLado("Facturas PPD emitidas", "Facturas PPD recibidas") + '</small><b>' + p.ppd.toLocaleString("es-MX") + "</b>" +
                "<span>" + (p.ppd ? p.ppd_pagadas.toLocaleString("es-MX") + " ya " + textoLado("cobradas", "pagadas") : "por fecha de emisión") + "</span></div>" +
            boton("ppd_sin_pago", textoLado("Pendientes de cobro", "Pendientes de pago"), p.sin_pago.n, p.sin_pago.n ? "$" + dinero(p.sin_pago.saldo_mxn) + " por " + textoLado("cobrar", "pagar") : "ninguna",
                "PPD emitidas en el periodo sin complemento de pago vigente. Clic para verlas.") +
            boton("ppd_parcial", textoLado("Cobro parcial", "Pago parcial"), p.parciales.n, p.parciales.n ? "$" + dinero(p.parciales.saldo_mxn) + " de saldo" : "ninguna",
                "PPD emitidas en el periodo con pagos que no completan el total. Clic para verlas.") +
            boton("falta_comp", "Complemento de pago pendiente", p.falta_complemento.n, !p.falta_complemento.n ? "ninguna" : fuera ? fuera + " ya fuera de plazo" : "revísalas",
                "PPD vencidas según sus condiciones de pago, marcadas como " + textoLado("cobradas", "pagadas") + " a mano, parcialidades que faltan, complemento cancelado sin reponer. Clic para verlas.") +
            '<div class="ctx-resumen__dato conc-iva" title="Por fecha de ' + textoLado("cobro", "pago") + ": complementos con fecha de pago en el periodo, facturas PUE emitidas en él y notas de crédito (restan). " +
                'El desglose por mes y por tasa va en el Excel."><small>IVA ' + textoLado("cobrado", "pagado") + " en el periodo</small><b>$" + dinero(iva.iva) + "</b>" +
                "<span>" + (porTasa || "sin IVA") + (iva.ret_iva ? " · retenido $" + dinero(iva.ret_iva) : "") + "</span></div>";
    }

    /* El resumen (los dos cuadros de cifras) nace plegado en una línea: la tabla es lo principal (el dueño, 18-nov: «eso me quitó
       toda la vista de la tabla»). «Ver resumen» lo abre y se recuerda en este navegador. */
    function resumenPlegado() {
        try { return localStorage.getItem("fc-conc-resumen") !== "abierto"; } catch (e) { return true; }
    }

    function pintarTarjetas() {
        var fs = E.datos.facturas, vivas = fs.filter(function (f) { return f.estado_conciliacion !== "Cancelada"; });
        function suma(k, lista) { return lista.reduce(function (s, f) { return s + (f[k] || 0); }, 0); }
        var abiertas = vivas.filter(function (f) { return ["Parcial", "Sin pago", "Pago a factura cancelada"].indexOf(f.estado_conciliacion) !== -1; });
        var canceladas = fs.length - vivas.length;
        if (!fs.length) { $("tarjetas").innerHTML = ""; return; }
        var saldo = suma("saldo_mxn", abiertas), porCobro = $("sel-base").value === "pago";
        // M-11: el resumen en pesos se puede plegar a una línea (se recuerda en este navegador)
        var plegado = resumenPlegado();
        $("tarjetas").classList.toggle("ctx-resumen--linea", plegado);
        if (plegado) {
            var ivaP = ((E.datos.iva_periodo || {}).total || {}).iva;
            $("tarjetas").innerHTML = '<span class="conc-linea conc-linea--dato">' +
                (porCobro ? textoLado("Cobrado", "Pagado") + " en el periodo <b>$" + dinero(suma("pagado_periodo_mxn", vivas)) + "</b>"
                          : "Facturado en el periodo <b>$" + dinero(suma("total_mxn", vivas)) + "</b>") + "</span>" +
                '<button type="button" data-tarjeta="saldo" title="Clic para ver solo las que tienen saldo" class="conc-linea' + (E.tarjeta === "saldo" ? " conc-linea--activa" : "") + '">' +
                textoLado("Por cobrar", "Por pagar") + " <b>$" + dinero(saldo) + "</b>" + (abiertas.length ? " · " + abiertas.length + " con saldo" : "") + "</button>" +
                (ivaP != null ? '<span class="conc-linea conc-linea--dato" title="Por fecha de ' + textoLado("cobro", "pago") + '; el desglose por mes y por tasa va en el Excel">IVA ' +
                    textoLado("cobrado", "pagado") + " <b>$" + dinero(ivaP) + "</b></span>" : "") +
                '<button type="button" class="xml-enlace conc-linea__ver" data-resumen="abrir">Ver resumen</button>';
            return;
        }
        $("tarjetas").innerHTML = '<button type="button" class="ctx-resumen__plegar" data-resumen="plegar" title="Dejar el resumen en una línea" aria-label="Plegar resumen">−</button>' +
            // Las cifras dicen de qué son, según con qué fecha se armó la tabla
            (porCobro
                ? '<div class="ctx-resumen__dato" title="Suma de lo ' + textoLado("cobrado", "pagado") + ' dentro del periodo (fecha de pago del complemento; las PUE, su emisión) de las facturas de la tabla">' +
                      "<small>" + textoLado("Cobrado", "Pagado") + " en el periodo</small><b>$" + dinero(suma("pagado_periodo_mxn", vivas)) + "</b><span>" + vivas.length.toLocaleString("es-MX") + " factura" + (vivas.length === 1 ? "" : "s") + "</span></div>" +
                  '<div class="ctx-resumen__dato"><small>Total de esas facturas</small><b>$' + dinero(suma("total_mxn", vivas)) + "</b><span>en pesos</span></div>"
                : '<div class="ctx-resumen__dato"><small>Facturado en el periodo</small><b>$' + dinero(suma("total_mxn", vivas)) + "</b><span>" + vivas.length.toLocaleString("es-MX") + " factura" + (vivas.length === 1 ? "" : "s") + ", en pesos</span></div>" +
                  '<div class="ctx-resumen__dato" title="Todos sus pagos cargados, sean del mes que sean"><small>' + textoLado("Cobrado", "Pagado") + " a hoy</small><b>$" + dinero(suma("pagado_mxn", vivas)) + "</b><span>en pesos</span></div>") +
            '<button type="button" data-tarjeta="saldo" title="Clic para ver solo las que tienen saldo" class="ctx-resumen__dato' +
                (abiertas.length ? " ctx-resumen__dato--alerta" : "") + (E.tarjeta === "saldo" ? " ctx-resumen__dato--activo" : "") + '">' +
                "<small>" + textoLado("Por cobrar", "Por pagar") + "</small><b>$" + dinero(saldo) + "</b>" +
                "<span>" + (abiertas.length ? abiertas.length + " factura" + (abiertas.length === 1 ? "" : "s") + " con saldo" : "todo " + textoLado("cobrado", "pagado")) + "</span></button>" +
            (canceladas ? '<div class="ctx-resumen__nota">' + canceladas + " cancelada" + (canceladas === 1 ? "" : "s") + " en el SAT · no cuenta" + (canceladas === 1 ? "" : "n") + "</div>" : "");
    }

    // 17-nov (nombres aprobados por el dueño): cómo se VE cada estado. Por dentro sigue siendo «Sin pago», «Parcial»… (los filtros
    // y el servidor comparan contra esos); aquí solo cambia el texto, según el lado. Igual que columnas.ESTADOS_TXT del servidor.
    var ESTADOS_TXT = {
        emitidos: { "Pagada": "Cobrada", "Pagada (PUE)": "Cobrada (PUE)", "Sin pago": "Pendiente de cobro", "Parcial": "Cobro parcial",
            "Cubierta con nota de crédito": "Saldada con nota de crédito", "Pagada (ajuste manual)": "Cobrada (ajuste manual)", "Pagada de más": "Cobrada de más" },
        recibidos: { "Sin pago": "Pendiente de pago", "Parcial": "Pago parcial", "Cubierta con nota de crédito": "Saldada con nota de crédito" }
    };
    function nombreEstado(e) { return (ESTADOS_TXT[E.lado] || {})[e] || e; }

    function pintarChipsEstado() {
        var cuenta = {};
        // Los estados se cuentan sobre lo que enseña la pestaña (en «Facturas PPD» las PUE no ocupan renglones)
        var corte = E.pestana === "ppd" ? PRUEBA.ppd : E.pestana === "errores" ? PRUEBA.error_cfdi : null;
        var universo = corte ? E.datos.facturas.filter(corte) : E.datos.facturas;
        universo.forEach(function (f) { cuenta[f.estado_conciliacion] = (cuenta[f.estado_conciliacion] || 0) + 1; });
        if (E.estado && !cuenta[E.estado]) E.estado = "";
        var h = ['<button type="button" class="xml-chip' + (!E.estado ? " xml-chip--activo" : "") + '" data-estado="">Todas<span>' + universo.length + "</span></button>"];
        ORDEN_ESTADOS.forEach(function (e) {
            if (cuenta[e]) h.push('<button type="button" class="xml-chip' + (E.estado === e ? " xml-chip--activo" : "") + '" data-estado="' + esc(e) + '">' +
                esc(nombreEstado(e)) + "<span>" + cuenta[e] + "</span></button>");
        });
        $("chips-estado").innerHTML = h.join("");
    }

    /* ============================================================ filtros */
    var RAPIDOS = [["alertas", "Con alertas"], ["falta_comp", "Complemento de pago pendiente"], ["error_cfdi", "Inconsistencias en CFDI"], ["ppd", "PPD"], ["pue", "PUE"], ["saldo", "Con saldo"], ["extranjera", "Moneda extranjera"],
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
        demas: function (f) { return f.estado_conciliacion === "Pagada de más"; },
        falta_comp: function (f) { return !!f.falta_complemento; },
        error_cfdi: function (f) { return !!f.error_cfdi; },
        ppd_sin_pago: function (f) { return f.metodo_pago === "PPD" && (f.estado_conciliacion === "Sin pago" || f.estado_conciliacion === "Pago a factura cancelada"); },
        ppd_parcial: function (f) { return f.metodo_pago === "PPD" && f.estado_conciliacion === "Parcial"; }
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

    /* Las pestañas de arriba: el mismo libro con otro corte. true = se atiende aquí (no se navega). */
    function elegirPestana(clave) {
        if (["ppd", "errores", "iva"].indexOf(clave) === -1) return false;          // «Complementos de pago» vive en otra página
        E.pestana = clave; E.estado = ""; E.tarjeta = null;
        Fiscontable.url({ pestana: clave === "ppd" ? null : clave });
        var base = clave === "errores" ? "emision" : clave === "iva" ? "pago" : $("sel-base").value;
        if (base !== $("sel-base").value) {
            $("sel-base").value = base;
            pintarBase();
            cargarDatos();
        } else if (E.datos) { pintarTarjetas(); pintarPendientes(); pintarChipsEstado(); aplicar(); }
        return true;
    }

    function aplicar() {
        if (!E.datos || !tabla()) return;
        if (baseActual() === "formato2" && !f2Listo()) { pedirF2().then(function () { if (f2Listo()) { mostrarTabla(); aplicar(); } }); return; }
        var q = E.busqueda.trim().toLowerCase(), av = E.av;
        var activos = Object.keys(E.rapidos).filter(function (k) { return E.rapidos[k]; });
        if (E.tarjeta) activos.push(E.tarjeta);
        if (E.pestana === "ppd") activos.push("ppd");                   // «Facturas PPD»: las PUE cuentan por dentro (IVA), pero no ocupan renglones
        else if (E.pestana === "errores") activos.push("error_cfdi");
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
        tabla().ponerFilas(baseActual() === "formato2" ? filasF2(E.filtradas) : E.filtradas);
        pintarVistas();
        var total = E.datos.facturas.length;
        $("conteo-filas").textContent = !total
            ? ($("sel-base").value === "pago"
                ? "No hay nada " + textoLado("cobrado", "pagado") + " en este periodo. Para ver lo facturado aunque no se haya " + textoLado("cobrado", "pagado") + ", cambia a «Fecha de emisión»"
                : "No hay facturas " + textoLado("emitidas", "recibidas") + " en este periodo (puede haber solo complementos de pago). Prueba otro periodo o «" + textoLado("Fecha de cobro", "Fecha de pago") + "»")
            : E.filtradas.length.toLocaleString("es-MX") + (E.filtradas.length !== total ? " de " + total.toLocaleString("es-MX") : "") + " factura(s)";
        pintarAlcance();
    }

    /* Las acciones de arriba usan lo seleccionado; si no hay selección, lo que ves. */
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
            "<div><small>" + textoLado("Por cobrar", "Por pagar") + " · saldo insoluto</small><b class=\"" + ((f.saldo || 0) < -0.005 ? "fc-negativo" : "") + '">' + dinero(f.saldo) + " " + esc(mon) + "</b></div></div>");
        function tablaMovs(lista) {
            if (!lista.length) return '<p class="conc-sub">' + (f.metodo_pago === "PUE" ? "Es PUE: se considera pagada al emitirse." : "No hay complementos de pago ni notas de crédito cargados para esta factura.") + "</p>";
            // Cada fecha con su nombre: la de pago es la que cuenta para el IVA; la del complemento es cuándo se emitió
            return '<div class="conc-scroll"><table class="conc-mini"><thead><tr><th title="La fecha de pago que dice el complemento (en una nota de crédito, su fecha de emisión). Es la que cuenta para el IVA.">Fecha de ' +
                textoLado("cobro", "pago") + '</th><th title="Cuándo se emitió el complemento de pago">Complemento emitido</th><th>Tipo</th><th>Comprobante</th><th class="num">Parc.</th>' +
                '<th class="num">Saldo antes</th><th class="num">Importe (' + esc(mon) + ')</th><th class="num">Saldo insoluto (' + esc(mon) + ')</th><th class="num">En pesos</th>' +
                '<th class="num">IVA en pesos</th><th class="num">Retenido en pesos</th><th>SAT</th></tr></thead><tbody>' +
                lista.map(function (m) {
                    var extra = m.moneda_pago && m.moneda_pago !== mon ? " (" + esc(m.moneda_pago) + ")" : "";
                    var esPago = m.tipo_fila === "Pago";
                    var tasas = [["16 %", m.iva16_mxn], ["8 %", m.iva8_mxn], ["otras", m.iva_otras_mxn]].filter(function (t) { return t[1]; })
                        .map(function (t) { return t[0] + ": " + dinero(t[1]); }).join(" · ");
                    var retenido = [["ISR", m.ret_isr_mxn], ["IVA", m.ret_iva_mxn]].filter(function (t) { return t[1]; })
                        .map(function (t) { return t[0] + ": " + dinero(t[1]); }).join(" · ");
                    return "<tr" + (m.cancelado ? ' class="conc-mov-cancelado"' : "") + "><td>" + esc(fechaMX(m.fecha)) + "</td>" +
                        "<td" + (m.fuera_de_plazo ? ' class="fc-negativo" title="Se emitió después del día 5 del mes siguiente al pago"' : "") + ">" + (esPago ? esc(fechaMX(m.fecha_emision_mov)) : "") + "</td><td>" +
                        esc(m.tipo_fila + (m.relacion && m.relacion !== "Nota de crédito" ? " · " + m.relacion : "")) + extra + "</td>" +
                        "<td>" + esc(m.serie_folio_mov || (m.uuid_mov || "").slice(0, 8)) + '</td><td class="num">' + esc(m.parcialidad || "") + "</td>" +
                        '<td class="num">' + dinero(m.saldo_anterior) + '</td><td class="num"><strong>' + dinero(m.importe) + '</strong></td><td class="num">' + dinero(m.saldo_insoluto) + "</td>" +
                        '<td class="num"' + (m.tc_usado ? ' title="Tipo de cambio ' + esc(fmtTc.format(m.tc_usado)) + (m.tc_origen ? " · " + esc(m.tc_origen) : "") + '"' : "") + ">" + dinero(m.importe_mxn) + "</td>" +
                        '<td class="num"' + (tasas ? ' title="' + esc(tasas) + (m.iva_prorrateado ? " · en proporción a lo pagado: el complemento no lo desglosa" : "") + '"' : "") + ">" + dinero(m.iva_mxn) + (m.iva_prorrateado ? "*" : "") + "</td>" +
                        '<td class="num"' + (retenido ? ' title="' + esc(retenido) + '"' : "") + ">" + dinero(m.ret_total_mxn) + "</td>" +
                        (m.cancelado ? '<td class="conc-nota-cancelado">Cancelado · no cuenta</td>' : "<td>" + esc(m.estado_sat || "") + "</td>") + "</tr>";
                }).join("") + "</tbody></table></div>" +
                (lista.some(function (m) { return m.iva_prorrateado; }) ? '<p class="conc-sub">* El complemento no desglosa impuestos: se calcularon en proporción a lo pagado.</p>' : "");
        }
        h.push("<h4>Pagos y notas de crédito</h4>" + tablaMovs(movs));
        if (previos.length) h.push("<h4>Aplicados a la factura que esta sustituye</h4>" + tablaMovs(previos));

        var errCfdi = f.error_cfdi ? f.error_cfdi.split("; ") : [];
        var avisos = (f.falta_complemento ? f.falta_complemento.split("; ").map(function (a) { return "Complemento de pago pendiente · " + a; }) : [])
            .concat(errCfdi.map(function (a) { return "Inconsistencia en el CFDI · " + a; }))
            .concat((f.alertas ? f.alertas.split("; ") : []).filter(function (a) { return errCfdi.indexOf(a) < 0; }));
        if (avisos.length) h.push('<ul class="conc-alertas">' + avisos.map(function (a) { return "<li>⚠ " + esc(a) + "</li>"; }).join("") + "</ul>");
        var ivaTasas = [["16 %", f.base16, f.iva16], ["8 %", f.base8, f.iva8], ["0 %", f.base0, 0], ["Exento", f.exento, null], ["Otras tasas", f.base_otras, f.iva_otras]]
            .filter(function (t) { return t[1] || t[2]; })
            .map(function (t) { return t[0] + ": base " + dinero(t[1] || 0) + (t[2] === null ? "" : " · IVA " + dinero(t[2] || 0)); }).join("<br>");
        h.push('<dl class="conc-datos">' +
            "<dt>Fecha de emisión de la factura</dt><dd>" + esc(fechaMX(f.fecha_emision)) + "</dd>" +
            (f.fecha_ultimo_pago && f.metodo_pago !== "PUE" ? "<dt>Fecha del último " + textoLado("cobro", "pago") + "</dt><dd>" + esc(fechaMX(f.fecha_ultimo_pago)) +
                " (según el complemento" + (f.fecha_ultimo_complemento ? ", emitido el " + esc(fechaMX(f.fecha_ultimo_complemento)) : "") + ")</dd>" : "") +
            (f.condiciones_pago ? "<dt>Condiciones de pago</dt><dd>" + esc(f.condiciones_pago) + (f.vence ? " · vence el " + esc(fechaMX(f.vence)) : "") + "</dd>" : "") +
            (ivaTasas ? "<dt>IVA de la factura (" + esc(mon) + ")</dt><dd>" + ivaTasas + "</dd>" : "") +
            (f.ret_total ? "<dt>Retenciones (" + esc(mon) + ")</dt><dd>" + (f.ret_isr ? "ISR " + dinero(f.ret_isr) + " · " : "") + (f.ret_iva ? "IVA " + dinero(f.ret_iva) + " · " : "") +
                "total retenido " + dinero(f.ret_total) + "</dd>" : "") +
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
            if (!(await Fiscontable.preguntar("¿Quitar el ajuste manual de esta factura? Volverá a su estado según sus pagos."))) return;
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
            // 23-nov-2026: el mismo avance que en Administración de XML: cuánto lleva, el % y, ya que se conoce el ritmo, cuánto falta
            var pct = r.porcentaje != null ? r.porcentaje : (r.total ? Math.floor(100 * r.hechos / r.total) : 100), c = r.conteo;
            $("validando-barra").style.width = pct + "%";
            var mx = function (n) { return (n || 0).toLocaleString("es-MX"); };
            var conteos = mx(c.Vigente) + " vigentes · " + mx(c.Cancelado) + " cancelados" +
                (c["No encontrado"] ? " · " + mx(c["No encontrado"]) + " no encontrados" : "") + (c.Error ? " · " + mx(c.Error) + " sin respuesta del SAT" : "");
            var detalle = r.hechos.toLocaleString("es-MX") + " de " + r.total.toLocaleString("es-MX") + " · " + conteos;
            $("validando-detalle").textContent = detalle;
            if (r.estado === "corriendo") {
                var m = r.minutos_faltan, faltan = m == null || m <= 0 ? "" : m <= 1 ? " · falta menos de un minuto" : m < 60 ? " · faltan unos " + m + " min"
                    : " · faltan cerca de " + Math.floor(m / 60) + " h" + (m % 60 ? " " + (m % 60) + " min" : "");
                $("validando-titulo").textContent = "Validando ante el SAT: " + r.hechos.toLocaleString("es-MX") + " de " + r.total.toLocaleString("es-MX") + " (" + pct + " %)" + faltan;
                $("validando-detalle").textContent = conteos;
                VAL.reloj = setTimeout(consultar, 1500);
                return;
            }
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
                partes.push('<strong style="color:rgb(var(--av-600))">El tipo de cambio de Banxico todavía no está conectado.</strong> Mientras tanto no hay columna de Banxico; tu tipo de cambio para el reporte sí funciona.');
            } else {
                partes.push("<strong>Banxico (dólar):</strong> " + (usd ? "último FIX del " + esc(fechaMX(usd.hasta)) + " = " + esc(fmtTc.format(usd.ultimo_valor)) +
                    " · " + usd.dias.toLocaleString("es-MX") + " días guardados desde " + esc(fechaMX(usd.desde)) : "todavía no hay datos (la primera descarga corre sola al arrancar)"));
                partes.push("Se actualiza solo a las " + esc(est.horarios) + (tarea.ultimo_exito ? " · última vez: " + esc(fechaMX(tarea.ultimo_exito.slice(0, 10))) + " " + esc(tarea.ultimo_exito.slice(11, 16)) : ""));
                if (tarea.error) partes.push('<span style="color:rgb(var(--er-600))">Último intento falló: ' + esc(tarea.error) + "</span>");
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
    /* 23-nov-2026 (el dueño, A y B del Avance 1): «Descargar Excel ▾» con dos opciones, sin preguntar moneda ni hojas (en
       pesos con el T.C. del DOF; las columnas de la moneda original se quedan) y AL CIERRE si el mes ya cerró:
       · «Reporte completo»: con «Fiscontable» (y las vistas guardadas a partir de ella) las hojas «Facturas PPD»,
         «Complementos de pago», «Documentos relacionados», «Complementos pendientes», «Inconsistencias» e «IVA cobrado»
         (o «IVA pagado»); con «Formato 2», las 5 hojas del programa anterior. Cada hoja sigue los filtros de su pestaña; con
         facturas marcadas con su casilla, solo esas con lo suyo.
       · «Esta tabla»: una hoja con lo que ves (las columnas de la vista en su orden, los renglones filtrados o marcados). */
    function filtrosDePantalla() {
        var rapidos = Object.keys(E.rapidos).filter(function (k) { return E.rapidos[k]; }), av = {};
        Object.keys(E.av).forEach(function (k) { if (E.av[k]) av[k] = E.av[k]; });
        return { pestana: E.pestana || "ppd", estado: E.estado || null, tarjeta: E.tarjeta || null, busqueda: E.busqueda.trim() || null,
                 rapidos: rapidos, av: av };
    }

    function exportarExcel(modo) {
        var t = tabla();
        if (!t) return;
        var r = rango();
        var cuerpo = { rfc: E.rfc, lado: E.lado, desde: r.desde, hasta: r.hasta, meses: mesesSueltos(), base: $("sel-base").value, regla: E.regla,
            tipo: modo === "tabla" ? "tabla" : "completo", vista_base: baseActual(), vista_nombre: nombreVistaActual() };
        var sel = t.seleccion;
        if (modo === "tabla") {
            // Lo que ves, en el orden en que lo ves (o solo lo marcado)
            var filas = t.filas().filter(function (f) { return !sel.size || sel.has(f.uuid); });
            if (!filas.length) { avisar("No hay facturas en la tabla."); return; }
            cuerpo.pestana = E.pestana || "ppd";
            cuerpo.columnas = t.columnas().map(function (c) { return c.clave; });
            cuerpo.uuids = filas.map(function (f) { return f.uuid; });
            // 24-nov-2026 (revisión): para que arriba de la hoja diga qué la recortó (lo marcado o los filtros), no siempre
            // «filtradas o marcadas»
            if (sel.size) cuerpo.marcadas = Array.from(sel);
            cuerpo.filtros = filtrosDePantalla();
        } else {
            if (sel.size) cuerpo.marcadas = Array.from(sel);
            cuerpo.filtros = filtrosDePantalla();
        }
        descargarExcel(modo, cuerpo);
    }

    async function descargarExcel(modo, cuerpo) {
        var boton = document.querySelector('.mod-acciones [data-excel="' + modo + '"]'), texto = boton.innerHTML;          // dentro de «Descargar Excel ▾»
        if (boton.disabled) return;
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
        // 18-nov: la explicación de «El periodo es por» es un globo; con el cursor sale sola y el «?» la abre al tocar
        $("base-info").addEventListener("click", function (e) {
            var caja = e.currentTarget.closest(".conc-base"), abierta = caja.classList.toggle("conc-base--abierta");
            e.currentTarget.setAttribute("aria-expanded", String(abierta));
        });
        document.addEventListener("click", function (e) {
            if (e.target.closest("#base-info")) return;
            var caja = document.querySelector(".conc-base--abierta");
            if (caja) { caja.classList.remove("conc-base--abierta"); $("base-info").setAttribute("aria-expanded", "false"); }
        });
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
            if (b.dataset.base === "pago" && TARJETAS_EMISION[E.tarjeta]) E.tarjeta = null;      // esos filtros son de lo facturado
            cargarDatos();
        });
        // Conteos de lo pendiente: son de lo FACTURADO en el periodo, así que al abrir uno la tabla pasa a «Fecha de emisión»
        $("pendientes").addEventListener("click", function (e) {
            var b = e.target.closest("[data-pendiente]"); if (!b || b.disabled) return;
            // 18-nov: lo mal emitido tiene su pestaña (ahí también salen las PUE); los demás cuadros son cortes de «Facturas PPD»
            if (b.dataset.pendiente === "error_cfdi") { FCPestanasConc.marcar($("conc-vista"), "errores"); elegirPestana("errores"); return; }
            if (E.pestana !== "ppd") { E.pestana = "ppd"; FCPestanasConc.marcar($("conc-vista"), "ppd"); }
            E.tarjeta = E.tarjeta === b.dataset.pendiente ? null : b.dataset.pendiente;
            E.estado = "";
            if (E.tarjeta && $("sel-base").value !== "emision") { $("sel-base").value = "emision"; cargarDatos(); return; }
            pintarTarjetas(); pintarPendientes(); pintarChipsEstado(); aplicar();
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
            var pl = e.target.closest("[data-resumen]");
            if (pl) {
                try { localStorage.setItem("fc-conc-resumen", pl.dataset.resumen === "plegar" ? "plegado" : "abierto"); } catch (x) { /* nada */ }
                pintarTarjetas(); pintarPendientes(); return;
            }
            var b = e.target.closest("[data-tarjeta]"); if (!b) return;
            E.tarjeta = E.tarjeta === b.dataset.tarjeta ? null : b.dataset.tarjeta;
            pintarTarjetas(); pintarPendientes(); aplicar();
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
            pintarRapidos(); pintarAvanzados(); pintarChipsEstado(); pintarTarjetas(); pintarPendientes(); aplicar();
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
        $("menu-vistas").addEventListener("click", function (e) { var b = e.target.closest("[data-accion]"); if (b) accionVista(b.dataset.accion, b.dataset.valor); });
        $("btn-guardar-vista").addEventListener("click", function () { accionVista("nueva"); });
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
