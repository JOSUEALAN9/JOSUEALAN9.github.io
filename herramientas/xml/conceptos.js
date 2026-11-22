/**
 * conceptos.js — Reporte por conceptos de Administración de XML (18-nov-2026).
 *
 * Se abre desde Emitidas o Recibidas con lo que hay en pantalla (empresa, periodo, meses y facturas filtradas):
 *   XMLConceptos.abrir({ rfc, lado, desde, hasta, meses, uuids, periodo, alCerrar })
 * Primero completa, por tandas, los XML guardados antes de que se leyeran los impuestos de cada concepto (con avance);
 * luego pide el reporte y lo muestra en cuatro vistas: Detalle, Por producto, Por clave SAT y Por cliente/proveedor.
 * Las tablas son la estándar (FCTabla.estandar): búsqueda, filtros, columnas, vistas y Excel.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var fmt = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var num = function (n) { return Number(n || 0).toLocaleString("es-MX"); };
    var C = { ctx: null, datos: null, vista: "detalle", tablas: {}, turno: 0 };
    /* 18-nov (el dueño: «lo que necesitaba era el desglose por productos… dice detalle, producto, clave sat y proveedor, no
       entiendo eso»): la primera vista ES el desglose (un renglón por cada producto de cada factura); las otras tres son
       resúmenes de ese desglose. Los nombres y la línea de abajo lo dicen. */
    var VISTAS = [["detalle", "Desglose por concepto", "El desglose: un renglón por cada producto o servicio de cada factura, con los datos de su factura y sus impuestos."],
                  ["producto", "Resumen por producto", "Lo mismo, sumado: un renglón por cada descripción distinta, con su cantidad, importe y precios."],
                  ["clave", "Resumen por clave SAT", "Lo mismo, sumado por clave del SAT, se describa como se describa."],
                  ["contraparte", "", "Lo mismo, sumado: un renglón por cada cliente o proveedor."]];

    async function post(ruta, cuerpo) {
        var resp;
        try {
            resp = await fetch(API + ruta, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
        } catch (e) { throw new Error("No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo."); }
        if (!resp.ok) throw new Error(await Fiscontable.leerError(resp));
        return resp;
    }
    function cuerpo() {
        var x = C.ctx;
        return { rfc: x.rfc, lado: x.lado, desde: x.desde, hasta: x.hasta, meses: x.meses || null, uuids: x.uuids || null };
    }
    function quien(plural) { return C.ctx.lado === "emitidos" ? (plural ? "clientes" : "cliente") : (plural ? "proveedores" : "proveedor"); }

    function avance(hechos, total) {
        var caja = $("conceptos-avance");
        caja.hidden = false;
        $("conceptos-avance-texto").textContent = total
            ? "Preparando el reporte… " + num(Math.min(hechos, total)) + " de " + num(total) + " facturas"
            : "Armando el reporte…";
        $("conceptos-avance-barra").style.width = total ? Math.round(Math.min(hechos, total) / total * 100) + "%" : "100%";
    }

    async function abrir(ctx) {
        C.ctx = ctx; C.datos = null; C.vista = "detalle";
        var turno = ++C.turno;
        $("conceptos").hidden = false;
        $("conceptos-titulo").textContent = "Conceptos de las facturas " + (ctx.lado === "emitidos" ? "emitidas" : "recibidas");
        $("conceptos-sub").textContent = ctx.periodo + (ctx.uuids ? " · solo las " + num(ctx.uuids.length) + " facturas que tenías filtradas" : "");
        $("conceptos-resumen").hidden = true; $("conceptos-vistas").hidden = true; $("conceptos-tablas").hidden = true; $("conceptos-error").hidden = true;
        if ($("conceptos-nota")) $("conceptos-nota").textContent = "";
        avance(0, 0);
        try {
            // 1) Completar lo guardado antes (solo la primera vez de cada periodo; después esto regresa al instante)
            var hechos = 0, total = 0, r;
            do {
                r = await (await post("/api/xml/conceptos/preparar", cuerpo())).json();
                if (turno !== C.turno) return;
                hechos += r.hechos; total = Math.max(total, hechos + r.faltan);
                if (total) avance(hechos, total);
            } while (r.faltan > 0 && r.hechos > 0);
            // 2) El reporte
            avance(0, 0);
            var datos = await (await post("/api/xml/conceptos", cuerpo())).json();
            if (turno !== C.turno) return;
            C.datos = datos;
            $("conceptos-avance").hidden = true;
            pintar();
        } catch (e) {
            if (turno !== C.turno) return;
            $("conceptos-avance").hidden = true;
            var caja = $("conceptos-error"); caja.hidden = false;
            caja.innerHTML = "<strong>No se pudo armar el reporte.</strong> " + esc(e.message) + ' <button type="button" class="xml-enlace" id="conceptos-reintentar">Reintentar</button>';
            $("conceptos-reintentar").addEventListener("click", function () { abrir(ctx); });
        }
    }

    function dato(valor, etiqueta, titulo) {
        return '<div class="xc-dato"' + (titulo ? ' title="' + esc(titulo) + '"' : "") + "><strong>" + esc(valor) + "</strong><small>" + esc(etiqueta) + "</small></div>";
    }

    function pintar() {
        var r = C.datos.resumen, caja = $("conceptos-resumen");
        if (!r.conceptos) {
            caja.hidden = false;
            caja.innerHTML = '<p class="xc-vacio"><strong>No hay conceptos en este periodo.</strong> El reporte toma los ingresos y egresos de la pestaña en la que estás.</p>';
            return;
        }
        var avisos = [];
        if (r.cancelados) avisos.push(num(r.cancelados) + " factura(s) cancelada(s): salen en el detalle y no cuentan en los resúmenes");
        if (r.genericas) avisos.push(num(r.genericas) + " concepto(s) con la clave genérica 01010101");
        if (r.sin_tc) avisos.push(num(r.sin_tc) + " factura(s) en otra moneda sin tipo de cambio");
        if (r.sin_detalle) avisos.push(num(r.sin_detalle) + " factura(s) sin su archivo XML: sin impuestos por concepto");
        caja.hidden = false;
        caja.innerHTML = '<div class="xc-datos">' +
            dato(num(r.conceptos), "conceptos", "Renglones de producto o servicio que traen las facturas del periodo") + dato(num(r.facturas), "facturas") +
            // 18-nov (el dueño: «el de productos me deja dudas»): se dice qué se contó. Un «producto» aquí es una descripción distinta
            // (con su clave del SAT y su n.º de identificación); la misma cosa escrita de dos formas cuenta dos veces.
            dato(num(r.productos), "descripciones distintas", "Cuántas descripciones diferentes hay (misma clave del SAT, misma descripción y mismo n.º de identificación = una sola). " +
                "Si un proveedor escribe distinto la descripción en cada factura, cada una cuenta aparte; para agruparlas, usa «Por clave SAT».") +
            dato(num(C.datos.filas.clave.length), "claves del SAT", "Cuántas claves de producto o servicio del SAT distintas se usaron, se describan como se describan") +
            dato(num(r.contrapartes), quien(true)) +
            dato("$" + fmt.format(r.importe_mxn), "importe neto en pesos", "Importe menos descuento, en pesos con el tipo de cambio de cada factura; las notas de crédito restan") +
            dato("$" + fmt.format(r.iva_mxn), "IVA en pesos") + "</div>" +
            (avisos.length ? '<p class="xc-avisos">' + avisos.map(esc).join(" · ") + "</p>" : "");
        var seg = $("conceptos-vistas"); seg.hidden = false;
        seg.innerHTML = VISTAS.map(function (v) {
            var nombre = v[1] || "Resumen por " + quien(false), n = C.datos.filas[v[0]].length;
            return '<button type="button" role="tab" class="pestana' + (v[0] === C.vista ? " pestana--activa" : "") + '" aria-selected="' + (v[0] === C.vista) +
                '" data-vista="' + v[0] + '" title="' + esc(v[2]) + '">' + esc(nombre) + '<span class="xml-cuenta">' + num(n) + "</span></button>";
        }).join("");
        var tablas = $("conceptos-tablas"); tablas.hidden = false;
        tablas.innerHTML = VISTAS.map(function (v) { return '<div class="xc-tabla" data-tabla="' + v[0] + '"' + (v[0] === C.vista ? "" : " hidden") + "></div>"; }).join("");
        C.tablas = {};
        mostrar(C.vista);
    }

    function nombreArchivo(vista) {
        var x = C.ctx;
        return x.rfc + "_Conceptos_" + (x.lado === "emitidos" ? "Emitidas" : "Recibidas") + (vista === "detalle" ? "" : "_" + vista) + ".xlsx";
    }

    function crearTabla(vista) {
        var d = C.datos, cont = document.querySelector('#conceptos-tablas [data-tabla="' + vista + '"]');
        var filtros = {
            detalle: [{ clave: "tipo", etiqueta: "Tipo" }, { clave: "estado_sat", etiqueta: "Estado SAT" }, { clave: "contraparte_nombre", etiqueta: C.ctx.lado === "emitidos" ? "Cliente" : "Proveedor" },
                      { clave: "clave", etiqueta: "Clave SAT" }, { clave: "moneda", etiqueta: "Moneda" }, { clave: "objeto_imp", etiqueta: "Objeto de impuesto" }, { clave: "observacion", etiqueta: "Observaciones" }],
            producto: [{ clave: "clave", etiqueta: "Clave SAT" }, { clave: "unidad", etiqueta: "Unidad" }, { clave: "observacion", etiqueta: "Observaciones" }],
            clave: [{ clave: "observacion", etiqueta: "Observaciones" }],
            contraparte: []
        }[vista];
        var buscar = {
            detalle: { texto: "Buscar descripción, clave, nombre, RFC, folio…", campos: ["descripcion", "clave", "clave_sat", "no_identificacion", "contraparte_nombre", "contraparte_rfc", "serie_folio", "uuid"] },
            producto: { texto: "Buscar descripción o clave…", campos: ["descripcion", "clave", "clave_sat", "no_identificacion"] },
            clave: { texto: "Buscar clave o descripción del SAT…", campos: ["clave", "clave_sat"] },
            contraparte: { texto: "Buscar nombre o RFC…", campos: ["contraparte_nombre", "contraparte_rfc", "principal"] }
        }[vista];
        var t = FCTabla.estandar({
            contenedor: cont, id: "xml-conceptos-" + vista, claveFila: "id",
            catalogo: d.columnas[vista], predeterminadas: d.predeterminadas[vista],
            anchoClave: { descripcion: 320, clave_sat: 240, contraparte_nombre: 240, principal: 280, observacion: 220, clave: 110 },
            sellos: vista === "detalle" ? { estado_sat: { "Vigente": "verde", "Cancelado": "rojo", "Sin validar": "gris" } } : {},
            buscar: buscar, filtros: filtros,
            exportar: { nombre: function () { return nombreArchivo(vista); }, hoja: { detalle: "Conceptos", producto: "Resumen por producto", clave: "Resumen por clave SAT", contraparte: "Resumen por " + quien(false) }[vista],
                        extras: [{ texto: "Excel del reporte completo (4 hojas)", accion: excelCompleto }] },
            vacio: { titulo: "Sin renglones", texto: "Quita filtros para ver más." },
            alClic: function (f) {
                if (vista === "detalle") { if (Fiscontable.verCfdi) Fiscontable.verCfdi(C.ctx.rfc, f.uuid, [f.uuid]); return; }
                // De un resumen al detalle de esa clave o de ese cliente/proveedor
                mostrar("detalle");
                var det = C.tablas.detalle;
                ["clave", "contraparte_nombre"].forEach(function (k) { det.filtrar(k, null); });
                if (vista === "contraparte") det.filtrar("contraparte_nombre", f.contraparte_nombre);
                else det.filtrar("clave", f.clave);
            }
        });
        t.ponerDatos(d.filas[vista]);
        return t;
    }

    function mostrar(vista) {
        C.vista = vista;
        document.querySelectorAll("#conceptos-vistas .pestana").forEach(function (b) {
            var activa = b.dataset.vista === vista; b.classList.toggle("pestana--activa", activa); b.setAttribute("aria-selected", String(activa));
        });
        document.querySelectorAll("#conceptos-tablas .xc-tabla").forEach(function (el) { el.hidden = el.dataset.tabla !== vista; });
        var nota = $("conceptos-nota");                       // qué es lo que se está viendo, en una línea
        if (!nota) { nota = document.createElement("p"); nota.id = "conceptos-nota"; nota.className = "xc-nota"; $("conceptos-vistas").insertAdjacentElement("afterend", nota); }
        nota.textContent = (VISTAS.find(function (v) { return v[0] === vista; }) || [])[2] || "";
        if (!C.tablas[vista]) C.tablas[vista] = crearTabla(vista);
    }

    async function excelCompleto() {
        try {
            var resp = await post("/api/xml/conceptos/excel", cuerpo());
            var nombre = /filename="([^"]+)"/.exec(resp.headers.get("Content-Disposition") || "");
            Fiscontable.guardarArchivo(await resp.blob(), nombre ? nombre[1] : nombreArchivo("detalle"));
        } catch (e) { Fiscontable.toast ? Fiscontable.toast(e.message) : Fiscontable.avisar(e.message); }
    }

    function cerrar() {
        C.turno++;
        var alCerrar = C.ctx && C.ctx.alCerrar;
        C.ctx = null; C.datos = null; C.tablas = {};
        $("conceptos").hidden = true;
        $("conceptos-tablas").innerHTML = "";
        if (alCerrar) alCerrar();
    }

    document.addEventListener("DOMContentLoaded", function () {
        if (!$("conceptos")) return;
        $("conceptos-cerrar").addEventListener("click", cerrar);
        $("conceptos-excel").addEventListener("click", excelCompleto);
        $("conceptos-vistas").addEventListener("click", function (e) { var b = e.target.closest("[data-vista]"); if (b) mostrar(b.dataset.vista); });
    });

    window.XMLConceptos = { abrir: abrir, cerrar: cerrar, abierto: function () { return !!C.ctx; } };
})();
