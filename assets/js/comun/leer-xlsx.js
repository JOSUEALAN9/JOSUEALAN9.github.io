/* leer-xlsx.js — Lee la primera hoja de un Excel (.xlsx) sin librerías de otros servidores (auditoría del 16-nov-2026).

   Constancias y Opinión leen el «directorio.xlsx» que sube la persona, en las mismas páginas donde se captura la
   e.firma. Antes traían SheetJS desde cdn.sheetjs.com: un script ajeno, sin sello de integridad, justo ahí. Ahora el
   archivo se abre con fflate (que ya servimos nosotros) y se lee con el analizador de XML del navegador.

   Fiscontable.leerXlsx(bytes) → [{Encabezado: valor, …}]   (primer renglón = encabezados; celdas vacías no aparecen;
   los números salen como número y lo demás como texto: igual que sheet_to_json). Lanza Error si no es un .xlsx. */
(function () {
    "use strict";
    function texto(bytes) { return new TextDecoder("utf-8").decode(bytes); }
    function xml(bytes) {
        var t = texto(bytes);
        if (/<!\s*(DOCTYPE|ENTITY)/i.test(t)) throw new Error("El Excel trae contenido no permitido.");
        var d = new DOMParser().parseFromString(t, "application/xml");
        if (d.getElementsByTagName("parsererror").length) throw new Error("El Excel está dañado.");
        return d;
    }
    function hijos(nodo, nombre) {
        var salida = [], todos = nodo.getElementsByTagName("*");
        for (var i = 0; i < todos.length; i++) if (todos[i].localName === nombre) salida.push(todos[i]);
        return salida;
    }
    function columna(ref) {                        // "AB12" → 27 (A = 0)
        var n = 0, m = /^([A-Z]+)/.exec(ref || "");
        if (!m) return -1;
        for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
        return n - 1;
    }
    function textoDe(si) {                         // un <si> o <is>: todos sus <t>, menos la guía fonética
        var partes = hijos(si, "t"), s = "";
        for (var i = 0; i < partes.length; i++) {
            var p = partes[i].parentNode;
            if (p && p.localName === "rPh") continue;
            s += partes[i].textContent;
        }
        return s;
    }
    function leerXlsx(bytes) {
        if (!window.fflate) throw new Error("No se pudo cargar el lector de Excel.");
        var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), archivos;
        var total = 0;
        try {
            archivos = window.fflate.unzipSync(u8, { filter: function (f) {
                if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^\/]+\.xml)$/.test(f.name)) return false;
                total += f.originalSize || 0;
                if (total > 60 * 1024 * 1024) throw new Error("El Excel es demasiado grande.");
                return true;
            } });
        } catch (e) {
            throw new Error(/demasiado grande/.test(e.message || "") ? e.message : "El archivo no es un Excel (.xlsx) que se pueda leer.");
        }
        if (!archivos["xl/workbook.xml"]) throw new Error("El archivo no es un Excel (.xlsx).");
        // La primera hoja, según el libro
        var libro = xml(archivos["xl/workbook.xml"]), hojas = hijos(libro, "sheet"), ruta = null;
        if (hojas.length && archivos["xl/_rels/workbook.xml.rels"]) {
            var rid = hojas[0].getAttribute("r:id") || hojas[0].getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
            var rels = hijos(xml(archivos["xl/_rels/workbook.xml.rels"]), "Relationship");
            for (var i = 0; i < rels.length; i++) if (rels[i].getAttribute("Id") === rid) {
                var destino = rels[i].getAttribute("Target") || "";
                ruta = destino.charAt(0) === "/" ? destino.slice(1) : "xl/" + destino.replace(/^\.\//, "");
            }
        }
        if (!ruta || !archivos[ruta]) {
            ruta = Object.keys(archivos).filter(function (n) { return /^xl\/worksheets\/[^\/]+\.xml$/.test(n); }).sort()[0];
        }
        if (!ruta) return [];
        var compartidos = [];
        if (archivos["xl/sharedStrings.xml"]) {
            var sis = hijos(xml(archivos["xl/sharedStrings.xml"]), "si");
            for (var j = 0; j < sis.length; j++) compartidos.push(textoDe(sis[j]));
        }
        var renglones = hijos(xml(archivos[ruta]), "row"), tabla = [];
        for (var r = 0; r < renglones.length; r++) {
            var celdas = hijos(renglones[r], "c"), fila = [], siguiente = 0;
            for (var k = 0; k < celdas.length; k++) {
                var c = celdas[k], col = columna(c.getAttribute("r"));
                if (col < 0) col = siguiente;
                siguiente = col + 1;
                var tipo = c.getAttribute("t"), v = hijos(c, "v")[0], valor;
                if (tipo === "inlineStr") valor = textoDe(c);
                else if (!v) continue;
                else if (tipo === "s") valor = compartidos[parseInt(v.textContent, 10)];
                else if (tipo === "str" || tipo === "e") valor = v.textContent;
                else if (tipo === "b") valor = v.textContent === "1";
                else { valor = Number(v.textContent); if (isNaN(valor)) valor = v.textContent; }
                if (valor === undefined || valor === "") continue;
                fila[col] = valor;
            }
            tabla.push(fila);
        }
        if (!tabla.length) return [];                 // los encabezados van en el primer renglón de la hoja (así lo lee también el servidor)
        var encabezados = tabla[0].map(function (h) { return h === undefined ? undefined : String(h).trim(); }), salida = [];
        for (var n = 1; n < tabla.length; n++) {
            var obj = {}, hay = false;
            for (var m = 0; m < tabla[n].length; m++) {
                if (tabla[n][m] === undefined || encabezados[m] === undefined) continue;
                obj[encabezados[m]] = tabla[n][m]; hay = true;
            }
            if (hay) salida.push(obj);
        }
        return salida;
    }
    window.Fiscontable = window.Fiscontable || {};
    window.Fiscontable.leerXlsx = leerXlsx;
})();
