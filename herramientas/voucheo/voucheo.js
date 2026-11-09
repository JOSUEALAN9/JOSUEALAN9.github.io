/**
 * voucheo.js — Voucheo estatal como papel de trabajo permanente.
 *
 * Cada empresa tiene un Excel por año que vive en el servidor: los acuses nuevos se cargan encima (ya no hay que
 * subir el Excel cada vez). También se puede llenar con los acuses guardados en Impuestos estatales, o subir un
 * Excel propio para que sea el guardado.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
    var E = { papeles: [], clientes: [], tabla: null };

    async function api(ruta, op) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, op || {}));
        if (!r.ok) {
            var texto = await Fiscontable.leerError(r);
            throw new Error(texto);
        }
        return r.headers.get("content-type") && r.headers.get("content-type").indexOf("json") !== -1 ? r.json() : r;
    }
    function fecha(iso) {
        return iso ? new Date(iso + (iso.length <= 19 ? "Z" : "")).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "";
    }

    /* ---------- resultado de una carga: qué entró y qué no */
    function pintarResultado(r) {
        var caja = $("vo-resultado"), rep = r.reporte || { procesados: [], omitidos: [] };
        var bien = rep.procesados || [], mal = rep.omitidos || [];
        caja.hidden = false;
        caja.className = "ui-aviso vo-resultado" + (mal.length ? " ui-aviso--aviso" : "");
        caja.innerHTML = "<div style=\"flex:1\"><h3>" + (bien.length ? "✓ Se cargaron " + bien.length + " acuse(s) en " + esc(r.papel ? (r.papel.nombre || r.papel.rfc) + " · " + r.papel.anio : r.nombre_archivo) : "No se cargó ningún acuse") + "</h3>" +
            (bien.length ? "<ul>" + bien.map(function (p) {
                return "<li>" + esc(p.mes) + " · " + esc(p.hoja || p.tipo) + (p.aviso ? " — <i>" + esc(p.aviso) + "</i>" : "") + (p.aviso_diferencia ? " — <b>" + esc(p.aviso_diferencia) + "</b>" : "") + "</li>";
            }).join("") + "</ul>" : "") +
            (mal.length ? "<p style=\"margin:8px 0 0;font-weight:600\">No se cargaron " + mal.length + ":</p><ul>" + mal.map(function (o) {
                return "<li>" + esc(o.archivo || "") + " — " + esc(o.motivo || "") + "</li>";
            }).join("") + "</ul>" : "") + "</div>" +
            (r.papel ? '<button type="button" class="ui-btn ui-btn--primario" data-bajar="' + esc(r.papel.rfc) + '" data-anio="' + esc(r.papel.anio) + '">Descargar Excel</button>' : "");
    }
    function pintarError(msj) {
        var caja = $("vo-resultado");
        caja.hidden = false; caja.className = "ui-aviso ui-aviso--error vo-resultado";
        caja.innerHTML = "<div>" + esc(msj) + "</div>";
    }

    /* ---------- cargar acuses */
    async function subirAcuses(archivos) {
        var fd = new FormData();
        fd.append("modo", "nuevo");
        fd.append("impuesto_seleccionado", "estatal");
        archivos.forEach(function (f) { fd.append("acuses_pdf", f); });
        E.zona.estado("", "Leyendo " + archivos.length + " acuse(s)…");
        try {
            var r = await api("/api/voucheo/generar", { method: "POST", body: fd });
            E.zona.estado("ok", "Listo.");
            pintarResultado(r);
            await cargarPapeles();
        } catch (e) { E.zona.estado("error", ""); pintarError(e.message); }
    }

    async function desdeEstatales() {
        var b = $("vo-estatales"), fd = new FormData();
        fd.append("rfc", $("vo-empresa").value); fd.append("anio", $("vo-anio").value);
        b.disabled = true; b.textContent = "Leyendo acuses…";
        try { pintarResultado(await api("/api/voucheo/desde-estatales", { method: "POST", body: fd })); await cargarPapeles(); }
        catch (e) { pintarError(e.message); }
        finally { b.disabled = false; b.textContent = "Actualizar"; }
    }

    async function subirExcel(archivos) {
        var rfc = $("vo-empresa").value, anio = $("vo-anio").value;
        var ya = E.papeles.some(function (p) { return p.rfc === rfc && p.anio === anio; });
        if (ya && !(await Fiscontable.confirmar({ titulo: "¿Reemplazar el papel de " + rfc + " " + anio + "?", texto: "El Excel guardado se cambia por el que subes. Descarga antes el actual si lo quieres conservar.", si: "Reemplazar" }))) return;
        var fd = new FormData(); fd.append("archivo_excel", archivos[0]);
        E.zonaExcel.estado("", "Subiendo…");
        try {
            await api("/api/voucheo/papeles/" + encodeURIComponent(rfc) + "/" + anio + "/reemplazar", { method: "POST", body: fd });
            E.zonaExcel.estado("ok", "✓ Ahora es el papel guardado de " + rfc + " " + anio + ".");
            await cargarPapeles();
        } catch (e) { E.zonaExcel.estado("error", e.message); }
    }

    async function bajar(rfc, anio, boton) {
        if (boton) boton.disabled = true;
        try {
            var r = await api("/api/voucheo/papeles/" + encodeURIComponent(rfc) + "/" + anio + "/descargar");
            var p = E.papeles.find(function (x) { return x.rfc === rfc && x.anio === anio; });
            Fiscontable.guardarArchivo(await r.blob(), (p && p.nombre_archivo) || rfc + "_Voucheo_Estatal_" + anio + ".xlsx");
        } catch (e) { pintarError(e.message); }
        finally { if (boton) boton.disabled = false; }
    }

    async function quitar(rfc, anio) {
        if (!(await Fiscontable.confirmar({ titulo: "¿Borrar el papel de trabajo de " + rfc + " " + anio + "?", texto: "Se borra el Excel guardado con todo lo cargado. Descárgalo antes si lo necesitas.", si: "Borrar", peligro: true, escribir: rfc }))) return;
        try { await api("/api/voucheo/papeles/" + encodeURIComponent(rfc) + "/" + anio, { method: "DELETE" }); await cargarPapeles(); }
        catch (e) { pintarError(e.message); }
    }

    /* ---------- tabla de papeles */
    function filas() {
        return E.papeles.map(function (p) {
            return { id: p.rfc + "|" + p.anio, rfc: p.rfc, empresa: p.nombre || p.rfc, anio: p.anio, acuses: p.acuses,
                     meses_txt: (p.meses || []).length + " de 12", _meses: p.meses || [], actualizado: p.actualizado_en, _p: p };
        });
    }
    function tabla() {
        if (E.tabla) return E.tabla;
        E.tabla = FCTabla.estandar({
            contenedor: $("vo-tabla"), id: "voucheo", claveFila: "id",
            catalogo: [
                { clave: "empresa", etiqueta: "Empresa", tipo: "texto" },
                { clave: "rfc", etiqueta: "RFC", tipo: "texto" },
                { clave: "anio", etiqueta: "Año", tipo: "texto" },
                { clave: "meses_txt", etiqueta: "Meses con acuse", tipo: "texto" },
                { clave: "acuses", etiqueta: "Acuses cargados", tipo: "numero" },
                { clave: "actualizado", etiqueta: "Actualizado", tipo: "fecha" },
                { clave: "acciones", etiqueta: "", tipo: "texto" }
            ],
            predeterminadas: ["empresa", "anio", "meses_txt", "actualizado", "acciones"],
            anchoClave: { empresa: 260, anio: 70, meses_txt: 330, actualizado: 120, acciones: 180 },
            buscar: { texto: "Buscar empresa o RFC…", campos: ["empresa", "rfc"] },
            exportar: { nombre: "Papeles_de_voucheo.xlsx", hoja: "Papeles" },
            vacio: { titulo: "Todavía no hay papeles de trabajo", texto: "Suelta arriba los acuses de una empresa y se crea el suyo." },
            celda: function (c, r) {
                if (c.clave === "empresa") return "<b>" + esc(r.empresa) + '</b> <small class="xml-tenue">' + esc(r.rfc) + "</small>";
                if (c.clave === "meses_txt") return '<span class="vo-meses">' + MESES.map(function (m) {
                    return '<span class="vo-mes' + (r._meses.indexOf(m) !== -1 ? " vo-mes--si" : "") + '" title="' + m.toLowerCase() + '">' + m.slice(0, 3) + "</span>";
                }).join("") + "</span>";
                if (c.clave === "actualizado") return esc(fecha(r.actualizado));
                if (c.clave === "acciones") return '<span class="vo-acciones"><button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-bajar="' + esc(r.rfc) + '" data-anio="' + esc(r.anio) + '">Descargar</button>' +
                    '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-quitar="' + esc(r.rfc) + '" data-anio="' + esc(r.anio) + '">Borrar</button></span>';
                return null;
            }
        });
        return E.tabla;
    }
    async function cargarPapeles() {
        try { E.papeles = await api("/api/voucheo/papeles"); tabla().ponerDatos(filas()); }
        catch (e) { tabla().error(e.message, cargarPapeles); }
    }

    async function arrancar() {
        if (!(await Fiscontable.exigirModulo("voucheo"))) return;
        $("vo-cuerpo").hidden = false;
        E.zona = FCZona.crear($("vo-zona"), { acepta: ".pdf", varios: true, titulo: "Suelta aquí los acuses en PDF", detalle: "o haz clic para elegirlos (puedes mezclar meses y empresas)", alElegir: subirAcuses });
        E.zonaExcel = FCZona.crear($("vo-zona-excel"), { acepta: ".xlsx", titulo: "Suelta tu Excel de voucheo", detalle: "de la empresa y el año elegidos arriba", alElegir: subirExcel });
        var hoy = new Date(), anios = [];
        for (var a = hoy.getFullYear(); a >= hoy.getFullYear() - 4; a--) anios.push(a);
        // En enero todavía se trabaja el año anterior
        var anioDefecto = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();
        $("vo-anio").innerHTML = anios.map(function (a) { return '<option value="' + a + '"' + (a === anioDefecto ? " selected" : "") + ">" + a + "</option>"; }).join("");
        try { E.clientes = await api("/api/clientes"); } catch (e) { E.clientes = []; }
        var activa = await Fiscontable.empresaActiva().catch(function () { return null; });
        $("vo-empresa").innerHTML = E.clientes.length ? E.clientes.map(function (c) {
            return '<option value="' + esc(c.rfc) + '"' + (activa && activa.rfc === c.rfc ? " selected" : "") + ">" + esc(c.alias || c.rfc) + "</option>";
        }).join("") : '<option value="">Registra tus empresas en Clientes</option>';
        $("vo-estatales").disabled = !E.clientes.length;
        $("vo-estatales").addEventListener("click", desdeEstatales);
        document.addEventListener("click", function (e) {
            var b = e.target.closest("[data-bajar]");
            if (b) { e.stopPropagation(); bajar(b.dataset.bajar, b.dataset.anio, b); return; }
            var q = e.target.closest("[data-quitar]");
            if (q) { e.stopPropagation(); quitar(q.dataset.quitar, q.dataset.anio); }
        });
        tabla().cargando();
        cargarPapeles();
    }
    arrancar();
})();
