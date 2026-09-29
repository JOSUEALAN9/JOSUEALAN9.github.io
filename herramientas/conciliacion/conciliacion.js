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
        else if (leer("base")) $("sel-base").value = leer("base");
        E.urlPeriodo = q.get("desde") || q.get("hasta") ? { desde: q.get("desde"), hasta: q.get("hasta") } : null;

        bandeja = FCBandeja.crear({
            seccion: $("bandeja"), resultado: $("resultado-carga"), endpoint: "/api/conciliacion/cargar",
            destinoPreferido: function () { return E.rfc; },
            alTerminar: async function (destino) { await refrescarBibliotecas(destino); }
        });
        prepararTablas();
        prepararEventos();
        E.empresa = await Fiscontable.empresaActiva();
        $("btn-ir-xml").hidden = !puede("validador");
        await refrescarBibliotecas(q.get("rfc"));
        window.addEventListener("fiscontable:empresa", async function (ev) {
            E.empresa = ev.detail; E.otra = null; E.rfc = null;
            await refrescarBibliotecas();
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
                claseFila: function (f) { return f.estado_conciliacion === "Cancelada" ? "conc-cancelada" : ""; },
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
        $("sin-empresa").hidden = true;
        $("contenido").hidden = false;
        armarPeriodos(c);
        await cargarDatos();
        reanudarValidacion();
    }

    function pintarEncabezado() {
        var reg = E.otra && (E.contribuyentes.find(function (c) { return c.rfc === E.otra; }) || {}).registrado;
        $("empresa-titulo").textContent = E.otra ? nombreDe(E.otra) + " · " + E.otra + (reg ? "" : " (sin registrar)")
            : E.empresa ? (E.empresa.alias || "") + " · " + E.empresa.rfc
            : "Elige una empresa en la barra de arriba, o agrega XML de alguien sin registrar.";
        var aviso = $("aviso-otra");
        aviso.hidden = !E.otra;
        if (E.otra) {
            aviso.innerHTML = (reg ? "Estás viendo <strong>" + esc(nombreDe(E.otra)) + "</strong> (" + esc(E.otra) + "), que no es tu empresa activa."
                : "Conciliación rápida de <strong>" + esc(nombreDe(E.otra)) + "</strong> (" + esc(E.otra) + "), que no está en tu directorio. Sus XML se borran solos 7 días después de la última carga." +
                  ' <a class="xml-enlace" href="/clientes/">Registrarla como cliente</a>') +
                (E.empresa ? ' <button type="button" class="xml-enlace" id="volver-empresa">Volver a ' + esc(E.empresa.alias || E.empresa.rfc) + "</button>" : "");
        }
    }

    function mostrarVacio() {
        $("contenido").hidden = true;
        var caja = $("sin-empresa");
        caja.hidden = false;
        if (E.empresa) {
            caja.innerHTML = '<p class="xml-vacio__titulo">' + esc(E.empresa.alias || E.empresa.rfc) + " todavía no tiene XML</p>" +
                "<p>Arrastra aquí sus facturas, complementos de pago y notas de crédito (o el ZIP de la descarga del SAT) y presiona <strong>Procesar</strong>.<br>" +
                "Son los mismos XML de Administración de XML: lo que cargues aquí, allá también aparece.</p>";
            bandeja.abrir();
        } else {
            caja.innerHTML = '<p class="xml-vacio__titulo">¿De quién es la conciliación?</p>' +
                "<p>Elige la empresa con el botón de empresa de la barra de arriba.<br>¿Es de alguien que no tienes registrado? Da clic en <strong>Agregar XML</strong>: el portal detecta de quién son.</p>";
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
        h.push('<div class="xml-separador"></div><div class="xml-otra__grupo">Conciliación rápida (sin registrar)</div>');
        if (!E.otras.length) h.push('<p class="xml-otra__nota">Para conciliar a alguien sin registrar, usa <strong>Agregar XML</strong>.</p>');
        E.otras.forEach(function (c) {
            var dia = c.expira ? c.expira.slice(8, 10) + "/" + c.expira.slice(5, 7) : "";
            h.push('<div class="xml-otra__fila"><button type="button" data-otra="' + esc(c.rfc) + '"' + (c.rfc === E.rfc ? ' class="xml-activa"' : "") + ">" +
                esc(c.nombre || "Sin nombre") + " <span>" + esc(c.rfc) + (dia ? " · se borra el " + dia : "") + "</span></button>" +
                '<button type="button" class="xml-otra__borrar" data-borrar="' + esc(c.rfc) + '">Borrar</button></div>');
        });
        h.push('<div class="xml-separador"></div><button type="button" data-ir="/clientes/">+ Registrar empresa</button>');
        menu.innerHTML = h.join("");
    }

    async function accionMenuOtra(b) {
        $("menu-otra").hidden = true;
        if (b.dataset.ir) { location.href = b.dataset.ir; return; }
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
        var opciones = ['<option value="">Todos los periodos</option>'];
        var anios = {};
        (c.periodos || []).forEach(function (p) { anios[p.periodo.slice(0, 4)] = 1; });
        Object.keys(anios).sort().reverse().forEach(function (a) {
            opciones.push('<option value="a:' + a + '">Todo ' + a + "</option>");
            (c.periodos || []).filter(function (p) { return p.periodo.slice(0, 4) === a; }).forEach(function (p) {
                opciones.push('<option value="m:' + p.periodo + '">&nbsp;&nbsp;' + MESES[+p.periodo.slice(5, 7) - 1] + " " + a + "</option>");
            });
        });
        var elegido = null;
        if (E.urlPeriodo) {
            var d = E.urlPeriodo.desde || "", h = E.urlPeriodo.hasta || "";
            if (d.slice(8, 10) === "01" && h && d.slice(0, 7) === h.slice(0, 7)) elegido = "m:" + d.slice(0, 7);
            else if (d.slice(5) === "01-01" && h.slice(5) === "12-31" && d.slice(0, 4) === h.slice(0, 4)) elegido = "a:" + d.slice(0, 4);
            else {
                elegido = "r:" + d + "|" + h;
                opciones.push('<option value="' + esc(elegido) + '">Del ' + esc(fechaMX(d) || "inicio") + " al " + esc(fechaMX(h) || "hoy") + "</option>");
            }
            E.urlPeriodo = null;
        }
        var sel = $("sel-periodo");
        sel.innerHTML = opciones.join("");
        var valor = elegido || leer("periodo:" + c.rfc);
        if (valor && valor.indexOf("m:") === 0 && !sel.querySelector('option[value="' + valor + '"]')) {
            // Mes sin facturas emitidas (útil por fecha de pago): se agrega igual
            sel.insertAdjacentHTML("beforeend", '<option value="' + esc(valor) + '">' + MESES[+valor.slice(7, 9) - 1] + " " + esc(valor.slice(2, 6)) + "</option>");
        }
        // Primera vez: el año más reciente completo (las facturas y sus pagos suelen caer en meses distintos)
        if (!valor || !sel.querySelector('option[value="' + valor + '"]')) valor = c.periodos && c.periodos.length ? "a:" + c.periodos[0].periodo.slice(0, 4) : "";
        sel.value = valor;
    }

    function rango() {
        var v = $("sel-periodo").value;
        if (v.indexOf("m:") === 0) {
            var y = +v.slice(2, 6), m = +v.slice(7, 9);
            return { desde: v.slice(2) + "-01", hasta: v.slice(2) + "-" + String(new Date(y, m, 0).getDate()).padStart(2, "0") };
        }
        if (v.indexOf("a:") === 0) return { desde: v.slice(2) + "-01-01", hasta: v.slice(2) + "-12-31" };
        if (v.indexOf("r:") === 0) { var p = v.slice(2).split("|"); return { desde: p[0] || null, hasta: p[1] || null }; }
        return { desde: null, hasta: null };
    }

    /* ============================================================ datos */
    async function cargarDatos() {
        if (!E.rfc) return;
        guardar("periodo:" + E.rfc, $("sel-periodo").value);
        guardar("lado", E.lado); guardar("base", $("sel-base").value);
        var r = rango();
        var comun = "?rfc=" + encodeURIComponent(E.rfc) + "&lado=" + E.lado + "&base=" + $("sel-base").value +
            (r.desde ? "&desde=" + r.desde : "") + (r.hasta ? "&hasta=" + r.hasta : "");
        history.replaceState(null, "", location.pathname + comun);
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

    function pintarTarjetas() {
        var fs = E.datos.facturas, vivas = fs.filter(function (f) { return f.estado_conciliacion !== "Cancelada"; });
        function suma(k, lista) { return lista.reduce(function (s, f) { return s + (f[k] || 0); }, 0); }
        var abiertas = vivas.filter(function (f) { return ["Parcial", "Sin pago", "Pago a factura cancelada"].indexOf(f.estado_conciliacion) !== -1; });
        var demas = fs.filter(function (f) { return f.estado_conciliacion === "Pagada de más"; });
        var alertas = fs.filter(function (f) { return f.alertas; });
        function t(titulo, valor, nota, clase, filtro) {
            var tag = filtro ? "button" : "div";
            return "<" + tag + (filtro ? ' type="button" data-tarjeta="' + filtro + '" title="Clic para ver solo estas"' : "") + ' class="conc-tarjeta' + (clase ? " " + clase : "") +
                (filtro && E.tarjeta === filtro ? " conc-tarjeta--activa" : "") + '"><small>' + titulo + "</small><b>" + valor + "</b><span>" + nota + "</span></" + tag + ">";
        }
        var canceladas = fs.length - vivas.length;
        $("tarjetas").innerHTML =
            t("Facturas", vivas.length.toLocaleString("es-MX"), canceladas ? canceladas + " cancelada(s) aparte" : "en el periodo") +
            t("Total en pesos", "$" + dinero(suma("total_mxn", vivas)), "a TC de cada factura") +
            t(textoLado("Cobrado", "Pagado") + " en pesos", "$" + dinero(suma("pagado_mxn", vivas)), "con el TC de cada pago") +
            t(textoLado("Por cobrar", "Por pagar"), "$" + dinero(suma("saldo_mxn", abiertas)), abiertas.length + " factura(s) con saldo", abiertas.length ? "conc-tarjeta--alerta" : "", "saldo") +
            t("Pagadas de más", demas.length, demas.length ? "revisa complementos repetidos" : "ninguna", demas.length ? "conc-tarjeta--mal" : "", "demas") +
            t("Para revisar", alertas.length, alertas.length ? "facturas con alertas" : "todo en orden", alertas.length ? "conc-tarjeta--alerta" : "", "alertas");
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
        var h = ['<label>Emitida del<input type="date" data-av="desde" value="' + esc(E.av.desde || "") + '"></label>',
                 '<label>al<input type="date" data-av="hasta" value="' + esc(E.av.hasta || "") + '"></label>',
                 '<label>Total desde<input type="number" step="0.01" data-av="min" placeholder="0.00" value="' + esc(E.av.min || "") + '"></label>',
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
            if (av.desde && f.fecha_emision < av.desde) return false;
            if (av.hasta && f.fecha_emision > av.hasta) return false;
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
    }

    function hayFiltros() {
        return !!(E.estado || E.tarjeta || E.busqueda.trim() || Object.keys(E.rapidos).some(function (k) { return E.rapidos[k]; }) ||
            Object.keys(E.av).some(function (k) { return E.av[k]; }));
    }

    function pintarSeleccion(sel) {
        var n = sel.size;
        $("barra-seleccion").hidden = n === 0;
        $("texto-seleccion").textContent = n + " factura" + (n === 1 ? "" : "s") + " seleccionada" + (n === 1 ? "" : "s");
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
        h.push('<div class="xml-panel__cabeza"><h3>Factura ' + esc(f.serie_folio || f.uuid.slice(0, 8)) + '</h3><button type="button" class="xml-enlace" data-cerrar>Cerrar</button></div>');
        h.push('<p class="conc-sub">' + esc(f.contraparte_nombre || "") + " · " + esc(f.contraparte_rfc || "") + "</p>");
        h.push("<div>" + sello(nombreEstado(f.estado_conciliacion), SELLO_ESTADO[f.estado_conciliacion]) + " " +
            sello("SAT: " + (f.estado_sat || "Sin validar"), SELLOS.estado_sat[f.estado_sat || "Sin validar"]) + " " + sello(f.metodo_pago || "", "gris") +
            (f.detalle_estado ? ' <span class="conc-sub">' + esc(f.detalle_estado) + "</span>" : "") + "</div>");
        h.push('<div class="conc-cifras">' +
            "<div><small>Total</small><b>" + dinero(f.total) + " " + esc(mon) + "</b></div>" +
            "<div><small>" + textoLado("Cobrado", "Pagado") + "</small><b>" + dinero(f.pagado) + "</b></div>" +
            "<div><small>Notas de crédito</small><b>" + dinero(f.notas || 0) + "</b></div>" +
            "<div><small>" + textoLado("Por cobrar", "Por pagar") + '</small><b class="' + ((f.saldo || 0) < -0.005 ? "fc-negativo" : "") + '">' + dinero(f.saldo) + "</b></div></div>");
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

        var acciones = ['<button type="button" class="xml-btn" data-accion="validar">Validar esta factura y sus pagos</button>'];
        if (f.estado_conciliacion !== "Cancelada" && f.metodo_pago !== "PUE") {
            acciones.push(f.ajuste_manual ? '<button type="button" class="xml-btn" data-accion="quitar-ajuste">Quitar el ajuste manual</button>'
                : '<button type="button" class="xml-btn" data-accion="ajuste">Marcar como ' + textoLado("cobrada", "pagada") + " a mano…</button>");
        }
        if (puede("validador")) acciones.push('<a class="xml-btn" target="_blank" rel="noopener" href="/herramientas/xml/detalle/?rfc=' + encodeURIComponent(E.rfc) + "&uuid=" + encodeURIComponent(f.uuid) + '">Ver el XML</a>');
        h.push('<div class="conc-acciones">' + acciones.join("") + "</div>");
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

    async function accionTC(e) {
        if (e.target.closest("[data-cerrar]")) { $("panel-tc").hidden = true; return; }
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
        $("menu-excel").hidden = true;
        var r = rango();
        var cuerpo = { rfc: E.rfc, lado: E.lado, desde: r.desde, hasta: r.hasta, base: $("sel-base").value, regla: E.regla,
            columnas: tabla().columnas().map(function (c) { return c.clave; }), uuids: null };
        if (modo === "vista") {
            var sel = tabla().seleccion;
            if (sel.size) cuerpo.uuids = Array.from(sel);
            else if (hayFiltros()) cuerpo.uuids = E.filtradas.map(function (f) { return f.uuid; });
        }
        var boton = $("btn-excel");
        boton.disabled = true; boton.textContent = "Generando…";
        try {
            var resp = await enviar("/api/conciliacion/excel", cuerpo);
            var cd = resp.headers.get("Content-Disposition") || "", m = cd.match(/filename="?([^";]+)"?/);
            descargarBlob(await resp.blob(), m ? m[1] : "conciliacion.xlsx");
        } catch (e) { avisar(e.message); }
        boton.disabled = false; boton.textContent = "Excel ▾";
    }

    /* ============================================================ eventos */
    function cerrarMenus(excepto) {
        ["menu-excel", "menu-vistas", "menu-filtros", "menu-otra"].forEach(function (id) { if (id !== excepto) $(id).hidden = true; });
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
        $("sel-periodo").addEventListener("change", cargarDatos);
        $("sel-base").addEventListener("change", cargarDatos);
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
        [["btn-filtros", "menu-filtros"], ["btn-vistas", "menu-vistas"], ["btn-excel", "menu-excel"]].forEach(function (par) {
            $(par[0]).addEventListener("click", function (e) {
                e.stopPropagation(); cerrarMenus(par[1]); $(par[1]).hidden = !$(par[1]).hidden;
                if (par[1] === "menu-filtros" && !$(par[1]).hidden) pintarAvanzados();
            });
            $(par[1]).addEventListener("click", function (e) { e.stopPropagation(); });
        });
        document.addEventListener("click", function () { cerrarMenus(); });
        $("menu-excel").addEventListener("click", function (e) { var b = e.target.closest("[data-excel]"); if (b) exportarExcel(b.dataset.excel); });
        $("btn-columnas").addEventListener("click", function () { if (tabla()) tabla().abrirPanelColumnas(); });
        $("btn-validar").addEventListener("click", function () {
            if (E.datos) pedirValidacion(E.filtradas, hayFiltros() ? "de lo filtrado" : "de este periodo");
        });
        $("btn-validar-sel").addEventListener("click", function () {
            var sel = tabla().seleccion;
            pedirValidacion(E.datos.facturas.filter(function (f) { return sel.has(f.uuid); }), "de lo seleccionado");
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
