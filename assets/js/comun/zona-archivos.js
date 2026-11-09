/*
 * comun/zona-archivos.js — Zona para soltar o elegir archivos (reemplaza el «Seleccionar archivo» del navegador).
 *
 *   var z = FCZona.crear(contenedor, {
 *       acepta: ".cer,.key",            // extensiones permitidas
 *       varios: true,                   // más de un archivo a la vez
 *       titulo: "Suelta el .cer y el .key", detalle: "o haz clic para elegirlos",
 *       alElegir: function (archivos) {}  // Array de File (ya filtrados por extensión)
 *   });
 *   z.estado("ok" | "error" | "" , texto)   // línea de estado debajo
 *   z.limpiar()
 *
 * Funciona con teclado (Enter o Espacio abre el selector). Ver /ui/.
 */
(function () {
    "use strict";
    var esc = function (t) { return window.Fiscontable ? Fiscontable.escapar(t) : String(t); };
    var ICONO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M16 8l-4-4m0 0L8 8m4-4v12"/></svg>';

    function crear(contenedor, op) {
        op = op || {};
        var exts = (op.acepta || "").split(",").map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
        contenedor.innerHTML = '<div class="ui-zona" tabindex="0" role="button" aria-label="' + esc(op.titulo || "Elegir archivo") + '">' + ICONO +
            '<span class="ui-zona__texto"><b>' + esc(op.titulo || "Suelta el archivo aquí") + "</b><small>" + esc(op.detalle || "o haz clic para elegirlo") + "</small></span>" +
            '<input type="file" hidden' + (op.acepta ? ' accept="' + esc(op.acepta) + '"' : "") + (op.varios ? " multiple" : "") + "></div>" +
            '<p class="ui-zona__estado" hidden></p>';
        var zona = contenedor.querySelector(".ui-zona"), input = zona.querySelector("input"), linea = contenedor.querySelector(".ui-zona__estado");
        function entregar(lista) {
            var archivos = Array.prototype.slice.call(lista || []);
            var malos = archivos.filter(function (f) { return exts.length && !exts.some(function (e) { return f.name.toLowerCase().endsWith(e); }); });
            archivos = archivos.filter(function (f) { return malos.indexOf(f) === -1; });
            if (!op.varios) archivos = archivos.slice(0, 1);
            if (malos.length) estado("error", "No se usó " + malos.map(function (f) { return f.name; }).join(", ") + ": solo " + exts.join(" o ") + ".");
            if (archivos.length && op.alElegir) op.alElegir(archivos);
        }
        function estado(tipo, texto) {
            linea.hidden = !texto;
            linea.className = "ui-zona__estado" + (tipo ? " ui-zona__estado--" + tipo : "");
            linea.textContent = texto || "";
        }
        zona.addEventListener("click", function (e) { if (e.target !== input) input.click(); });
        zona.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
        input.addEventListener("change", function () { entregar(this.files); this.value = ""; });
        ["dragenter", "dragover"].forEach(function (ev) { zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.add("ui-zona--sobre"); }); });
        ["dragleave", "drop"].forEach(function (ev) { zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.remove("ui-zona--sobre"); }); });
        zona.addEventListener("drop", function (e) { entregar(e.dataTransfer.files); });
        return { estado: estado, limpiar: function () { estado("", ""); }, zona: zona };
    }

    window.FCZona = { crear: crear };
})();
