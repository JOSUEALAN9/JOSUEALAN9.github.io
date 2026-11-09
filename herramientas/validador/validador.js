/**
 * validador.js — Validador (M-13).
 *
 * Entra con los XML de la empresa y el periodo de la barra de arriba (recibidos o emitidos) y muestra el último
 * estado que se conoce de cada uno, sin consultar al SAT. "Validar en el SAT" consulta los que se ven (o los
 * seleccionados) y guarda el estado en su biblioteca; si cambió respecto a la última vez, se marca.
 * Cargar XML externos queda como opción secundaria: se leen en el navegador y no se guardan.
 * La tabla es la estándar (FCTabla.estandar): filtros, columnas, vistas y Excel (una hoja por estado).
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    var ESTADOS = ["Vigente", "En proceso", "Cancelado", "No encontrado", "Sin respuesta", "Sin validar"];
    var E = { origen: "empresa", rol: "recibido", empresa: null, periodo: null, filas: [], detener: false, corriendo: false, externos: [] };
    var $ = function (id) { return document.getElementById(id); };

    /* ---------- estado del SAT en grupos claros */
    function estadoLimpio(estado, cancelacion) {
        if (!estado) return "Sin validar";
        if (/Cancelado/i.test(estado)) return "Cancelado";
        if (/Vigente/i.test(estado)) return /proceso/i.test(cancelacion || "") ? "En proceso" : "Vigente";
        if (/No Encontrado/i.test(estado)) return "No encontrado";
        return "Sin respuesta";
    }
    function mesTexto(f) { return /^\d{4}-\d{2}/.test(f || "") ? MESES[+f.slice(5, 7) - 1] + " " + f.slice(0, 4) : ""; }

    /* ---------- tabla estándar */
    var CATALOGO = [
        { clave: "rfc", etiqueta: "RFC", tipo: "texto" },
        { clave: "nombre", etiqueta: "Nombre", tipo: "texto" },
        { clave: "uuid", etiqueta: "UUID", tipo: "uuid" },
        { clave: "fecha", etiqueta: "Fecha", tipo: "fecha" },
        { clave: "mes", etiqueta: "Mes", tipo: "texto" },
        { clave: "tipo", etiqueta: "Tipo", tipo: "texto" },
        { clave: "subtotal", etiqueta: "Subtotal", tipo: "moneda" },
        { clave: "traslados", etiqueta: "Traslados", tipo: "moneda" },
        { clave: "retenciones", etiqueta: "Retenciones", tipo: "moneda" },
        { clave: "total", etiqueta: "Total", tipo: "moneda" },
        { clave: "estado", etiqueta: "Estado SAT", tipo: "texto" },
        { clave: "cambio", etiqueta: "Cambió", tipo: "texto" },
        { clave: "cancelable", etiqueta: "Es cancelable", tipo: "texto" },
        { clave: "cancelacion", etiqueta: "Estado de la cancelación", tipo: "texto" },
        { clave: "revisado", etiqueta: "Última revisión", tipo: "fecha" },
        { clave: "rfc_emisor", etiqueta: "RFC emisor", tipo: "texto" },
        { clave: "rfc_receptor", etiqueta: "RFC receptor", tipo: "texto" }
    ];
    var SELLO = { "Vigente": "verde", "En proceso": "ambar", "Cancelado": "rojo", "No encontrado": "ambar", "Sin respuesta": "gris", "Sin validar": "gris" };
    var sellos = { estado: SELLO };

    var t = FCTabla.estandar({
        contenedor: $("tabla-val"), id: "validador", claveFila: "uuid",
        catalogo: CATALOGO,
        predeterminadas: ["rfc", "nombre", "fecha", "tipo", "total", "estado", "cambio", "cancelacion", "revisado"],
        anchoClave: { rfc: 130, nombre: 220, cancelacion: 200, cambio: 150 },
        sellos: sellos,
        celda: function (c, f) {
            if (c.clave === "cambio" && f.cambio) return '<span class="val-cambio" title="' + esc(f.cambio) + '">' + esc(f.cambio) + "</span>";
            return null;
        },
        buscar: { texto: "Buscar RFC, nombre o UUID…", campos: ["rfc", "nombre", "uuid"] },
        filtros: [{ clave: "tipo", etiqueta: "Tipo", texto: function (v) { return { I: "Ingreso", E: "Egreso", P: "Pago", T: "Traslado", N: "Nómina" }[v] || v; } },
                  { clave: "mes", etiqueta: "Mes" }, { clave: "nombre", etiqueta: "Nombre" }],
        rapidos: { clave: "estado", valores: ESTADOS.map(function (e) { return { valor: e, etiqueta: e }; }).concat([]) },
        exportar: { nombre: function () { return (E.origen === "empresa" && E.empresa ? E.empresa.rfc + "_" : "") + "Validacion_XML.xlsx"; },
                    hoja: "Todos", porValor: { clave: "estado", valores: ["Cancelado", "En proceso", "No encontrado", "Sin respuesta"] } },
        vacio: { titulo: "Sin XML", texto: "Elige empresa y periodo arriba, o carga XML externos." },
        alClic: function (f, lista) {
            if (E.origen === "empresa" && E.empresa) Fiscontable.verCfdi(E.empresa.rfc, f.uuid, lista.map(function (x) { return x.uuid; }));
        },
        alSeleccionar: function (sel) { $("btnValidar").innerHTML = "<b>✓</b>" + (sel.size ? "Validar " + sel.size + " seleccionados" : "Validar en el SAT"); }
    });

    function pintar() {
        t.ponerDatos(E.filas);
        $("btnReintentar").hidden = !E.filas.some(function (f) { return f.estado === "Sin respuesta"; });
        $("btnVolverEmpresa").hidden = E.origen !== "externos";
        $("seg-rol").hidden = E.origen !== "empresa";
        $("origenTexto").textContent = E.origen === "externos" ? "XML externos · no se guardan" :
            (E.empresa ? (E.empresa.alias || E.empresa.rfc) + " · " + mesTexto((E.periodo || "") + "-01") : "");
        var cambios = E.filas.filter(function (f) { return f.cambio; }).length;
        if (cambios) Fiscontable.toast && Fiscontable.toast(cambios + " XML cambiaron de estado desde la última revisión.");
    }

    /* ---------- XML de la empresa: lo último que se sabe, sin consultar al SAT */
    async function cargarEmpresa() {
        E.origen = "empresa";
        E.empresa = await Fiscontable.empresaActiva();
        E.periodo = await Fiscontable.periodoActivo();
        if (!E.empresa) { E.filas = []; pintar(); t.mensaje("Elige una empresa", "Usa el selector de la barra de arriba."); return; }
        if (!E.periodo) { E.filas = []; pintar(); t.mensaje("Elige un periodo", "Usa el periodo de la barra de arriba."); return; }
        var p = E.periodo, ultimo = new Date(+p.slice(0, 4), +p.slice(5, 7), 0).getDate();
        var q = new URLSearchParams({ rfc: E.empresa.rfc, desde: p + "-01", hasta: p + "-" + String(ultimo).padStart(2, "0"), rol: E.rol });
        t.cargando("Leyendo los XML de " + (E.empresa.alias || E.empresa.rfc) + "…");
        try {
            var r = await fetch(API + "/api/validador/empresa?" + q, { credentials: "include" });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            var d = await r.json();
            E.filas = d.cfdi.map(function (c) {
                var parte = E.rol === "emitido" ? c.receptor : c.emisor;
                return { uuid: c.uuid, rfc: parte.rfc || "", nombre: parte.nombre || "", fecha: c.fecha, mes: mesTexto(c.fecha),
                         tipo: (c.tipo || "").toUpperCase(), subtotal: +c.subtotal || 0, traslados: +c.traslados || 0,
                         retenciones: +c.retenciones || 0, total: +c.total || 0,
                         estado: estadoLimpio(c.estado_sat, c.estatus_cancelacion), cancelable: c.es_cancelable || "",
                         cancelacion: c.estatus_cancelacion || "", revisado: c.estado_sat_en || "", cambio: "",
                         rfc_emisor: c.emisor.rfc || "", rfc_receptor: c.receptor.rfc || "" };
            });
            pintar();
        } catch (e) { t.error(e.message, cargarEmpresa); }
    }

    /* ---------- consulta al SAT, uno por uno (con avance y Detener) */
    async function consultarUno(f) {
        try {
            var cuerpo = E.origen === "empresa"
                ? { url: "/api/validador/empresa/validar", datos: { rfc: E.empresa.rfc, uuid: f.uuid } }
                : { url: "/validar-factura/", datos: { rfc_emisor: f.rfc_emisor, rfc_receptor: f.rfc_receptor, total: Number(f.total).toFixed(2), uuid: f.uuid } };
            var r = await fetch(API + cuerpo.url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo.datos) });
            if (!r.ok) throw new Error();
            return await r.json();
        } catch (e) { return { estado: "Sin respuesta", es_cancelable: "", estatus_cancelacion: "El SAT no respondió" }; }
    }
    async function validar(lista) {
        if (E.corriendo || !lista.length) return;
        E.corriendo = true; E.detener = false;
        $("avance").hidden = false;
        var porUuid = new Map(E.filas.map(function (f) { return [f.uuid, f]; }));
        for (var i = 0; i < lista.length && !E.detener; i++) {
            $("avance-texto").textContent = (i + 1) + " de " + lista.length;
            $("avance-barra").style.width = Math.round((i + 1) * 100 / lista.length) + "%";
            var f = lista[i], r = await consultarUno(f);
            var antes = f.estado, nuevo = estadoLimpio(r.estado || "Sin respuesta", r.estatus_cancelacion);
            var g = porUuid.get(f.uuid);
            Object.assign(g, { estado: nuevo, cancelable: r.es_cancelable || "", cancelacion: r.estatus_cancelacion || "",
                               revisado: r.validado_en || new Date().toISOString() });
            if (antes !== "Sin validar" && antes !== "Sin respuesta" && nuevo !== "Sin respuesta" && antes !== nuevo) g.cambio = "Antes: " + antes;
            if (i % 10 === 9) t.ponerDatos(E.filas);
        }
        E.corriendo = false;
        $("avance").hidden = true;
        pintar();
    }

    /* ---------- XML externos (no se guardan) */
    var dialogo = $("modalCarga");
    function agregarExternos(archivos) {
        archivos.forEach(function (a) {
            if (!E.externos.some(function (x) { return x.name === a.name && x.size === a.size; })) E.externos.push(a);
        });
        $("lblStagedCount").textContent = E.externos.length;
        $("btnProcesarStaged").disabled = !E.externos.length;
    }
    var zona = FCZona.crear($("zona-carga"), { acepta: ".xml", varios: true, titulo: "Suelta los XML aquí", detalle: "o haz clic para elegirlos", alElegir: agregarExternos });
    $("folderInputArr").addEventListener("change", function () {
        agregarExternos(Array.prototype.filter.call(this.files, function (f) { return f.name.toLowerCase().endsWith(".xml"); })); this.value = "";
    });
    $("btnAbrirCarga").addEventListener("click", function () { zona.limpiar(); dialogo.showModal(); });
    $("btnCerrarModal").addEventListener("click", function () { dialogo.close(); });

    function impuestos(doc, comp, etiqueta) {
        var todos = Array.prototype.slice.call(doc.getElementsByTagName(etiqueta));
        var abuelo = function (n) { return n.parentNode && n.parentNode.parentNode ? n.parentNode.parentNode.parentNode : null; };
        var del = todos.filter(function (n) { return abuelo(n) === comp; });        // el resumen del comprobante (no sumar dos veces)
        return del.length ? del : todos.filter(function (n) { return abuelo(n) && /Concepto$/.test(abuelo(n).nodeName); });
    }
    $("btnProcesarStaged").addEventListener("click", async function () {
        dialogo.close();
        if (E.origen !== "externos") { E.origen = "externos"; E.filas = []; t.limpiar(); }
        var parser = new DOMParser(), ya = new Set(E.filas.map(function (f) { return f.uuid; })), nuevos = [], malos = 0, repetidos = 0;
        for (var k = 0; k < E.externos.length; k++) {
            var doc = parser.parseFromString(await E.externos[k].text(), "text/xml");
            var comp = doc.getElementsByTagName("cfdi:Comprobante")[0] || doc.getElementsByTagName("Comprobante")[0];
            var tim = doc.getElementsByTagName("tfd:TimbreFiscalDigital")[0] || doc.getElementsByTagName("TimbreFiscalDigital")[0];
            var uuid = tim && (tim.getAttribute("UUID") || "").toUpperCase();
            if (!comp || !uuid) { malos++; continue; }
            if (ya.has(uuid)) { repetidos++; continue; }
            ya.add(uuid);
            var em = doc.getElementsByTagName("cfdi:Emisor")[0] || doc.getElementsByTagName("Emisor")[0];
            var re = doc.getElementsByTagName("cfdi:Receptor")[0] || doc.getElementsByTagName("Receptor")[0];
            var fecha = (comp.getAttribute("Fecha") || "").split("T")[0];
            var tras = 0, ret = 0;
            impuestos(doc, comp, "cfdi:Traslado").forEach(function (n) { if (n.parentNode.nodeName === "cfdi:Traslados") tras += parseFloat(n.getAttribute("Importe") || 0); });
            impuestos(doc, comp, "cfdi:Retencion").forEach(function (n) { if (n.parentNode.nodeName === "cfdi:Retenciones") ret += parseFloat(n.getAttribute("Importe") || 0); });
            var f = { uuid: uuid, rfc_emisor: em ? em.getAttribute("Rfc") || "" : "", rfc_receptor: re ? re.getAttribute("Rfc") || "" : "",
                      fecha: fecha, mes: mesTexto(fecha), tipo: (comp.getAttribute("TipoDeComprobante") || "").toUpperCase(),
                      subtotal: parseFloat(comp.getAttribute("SubTotal") || 0), traslados: tras, retenciones: ret,
                      total: parseFloat(comp.getAttribute("Total") || 0), estado: "Sin validar", cancelable: "", cancelacion: "", revisado: "", cambio: "" };
            f.rfc = f.rfc_emisor; f.nombre = em ? em.getAttribute("Nombre") || "" : "";
            E.filas.push(f); nuevos.push(f);
        }
        E.externos = []; $("lblStagedCount").textContent = "0"; $("btnProcesarStaged").disabled = true;
        var avisos = [];
        if (malos) avisos.push(malos + " archivo(s) no son CFDI timbrados y no se validaron.");
        if (repetidos) avisos.push(repetidos + " ya estaban en la tabla.");
        if (avisos.length) Fiscontable.toast(avisos.join(" "));
        pintar();
        await validar(nuevos);
    });

    /* ---------- acciones */
    $("btnValidar").addEventListener("click", function () {
        var sel = t.tabla.seleccion, vis = t.visibles();
        validar(sel.size ? vis.filter(function (f) { return sel.has(f.uuid); }) : vis);
    });
    $("btnReintentar").addEventListener("click", function () { validar(E.filas.filter(function (f) { return f.estado === "Sin respuesta"; })); });
    $("btnDetener").addEventListener("click", function () { E.detener = true; });
    $("btnVolverEmpresa").addEventListener("click", function () { t.limpiar(); cargarEmpresa(); });
    $("seg-rol").addEventListener("click", function (e) {
        var b = e.target.closest("[data-rol]"); if (!b || E.corriendo) return;
        E.rol = b.dataset.rol;
        this.querySelectorAll("[data-rol]").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        cargarEmpresa();
    });

    document.addEventListener("DOMContentLoaded", async function () {
        await Fiscontable.exigirModulo("validador");
        if (window.FCProgramacion) FCProgramacion.linea({ modulo: "validador", contenedor: $("linea-programa") });
        cargarEmpresa();
    });
    ["fiscontable:empresa", "fiscontable:periodo"].forEach(function (ev) {
        window.addEventListener(ev, function () { if (E.origen === "empresa" && !E.corriendo) cargarEmpresa(); });
    });
})();
