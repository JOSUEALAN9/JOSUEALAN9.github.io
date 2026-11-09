/*
 * ui/ui.js — Página de muestra del sistema visual (solo admin).
 * Pinta la paleta con su contraste real (leído de los tokens de common.css), los botones en sus tamaños y estados,
 * y deja probar el mensaje temporal, la ventana y la opción A/B (se guarda en este navegador).
 */
(function () {
    "use strict";
    var $ = function (id) { return document.getElementById(id); };
    var esc = Fiscontable.escapar;

    // Contraste WCAG contra blanco, con el color que de verdad está usando la página
    function rgbDe(token) {
        var v = getComputedStyle(document.documentElement).getPropertyValue("--" + token).trim().split(/\s+/).map(Number);
        return v.length === 3 && v.every(function (n) { return !isNaN(n); }) ? v : [0, 0, 0];
    }
    function luz(c) {
        var f = function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    }
    function contraste(c) { var l = luz(c); return (1.05) / (l + 0.05); }

    function pintarPaletas() {
        var grupos = {
            ac: ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"].map(function (n) { return ["ac-" + n, n + (n === "600" ? " · acción" : n === "500" ? " · logo" : "")]; }),
            g: ["0", "50", "100", "200", "300", "400", "500", "600", "700", "800", "900"].map(function (n) {
                var uso = { "900": " · texto", "600": " · secundario", "500": " · terciario", "400": " · deshabilitado", "200": " · bordes", "50": " · fondo" }[n] || "";
                return ["g-" + n, n + uso];
            }),
            estados: [["ok-600", "Éxito"], ["av-600", "Aviso"], ["er-600", "Error"], ["in-600", "Info"], ["ok-50", "Éxito fondo"], ["av-50", "Aviso fondo"], ["er-50", "Error fondo"], ["in-50", "Info fondo"]]
        };
        document.querySelectorAll("[data-paleta]").forEach(function (caja) {
            caja.innerHTML = grupos[caja.dataset.paleta].map(function (x) {
                var c = contraste(rgbDe(x[0])), malo = c < 4.5;
                return '<div class="uv-color"><i style="background:rgb(var(--' + x[0] + '))"></i><span><b>' + esc(x[1]) + "</b><br>" +
                    '<em class="' + (malo ? "uv-malo" : "") + '">' + c.toFixed(1) + ":1" + (malo ? " · no para texto" : "") + "</em></span></div>";
            }).join("");
        });
    }

    function pintarBotones() {
        var tipos = [["primario", "Guardar"], ["secundario", "Exportar"], ["terciario", "Ver detalle"], ["peligro", "Cancelar factura"]];
        $("uv-botones").innerHTML = tipos.map(function (t) {
            var b = function (extra, tam, txt) {
                return '<button type="button" class="ui-btn ui-btn--' + t[0] + (tam ? " ui-btn--" + tam : "") + (extra === "cargando" ? " ui-btn--cargando" : "") + '"' +
                    (extra === "deshabilitado" ? " disabled" : "") + ">" + esc(txt || t[1]) + "</button>";
            };
            return "<tr><th>" + esc(t[0].charAt(0).toUpperCase() + t[0].slice(1)) + "</th><td>" + b("", "28") + "</td><td>" + b("") + "</td><td>" + b("", "36") +
                "</td><td>" + b("deshabilitado") + "</td><td>" + b("cargando") + "</td></tr>";
        }).join("");
    }

    function pintarFilas() {
        var filas = [["A-1037", "03/10/2026", "Cliente del Caribe SA de CV", "CCA010101AB1", "G03", "ok", "Vigente", 10000],
                     ["A-1038", "05/10/2026", "Servicios Integrales de Quintana Roo y la Península SC", "SIQ990101AB1", "G03", "ok", "Vigente", 12500],
                     ["A-1039", "08/10/2026", "Publico en general", "XAXX010101000", "S01", "error", "Cancelado", 3200],
                     ["A-1040", "12/10/2026", "Hotel Mahahual", "HMA150101AB1", "G01", "aviso", "En proceso", 18700],
                     ["A-1041", "20/10/2026", "Abarrotes Doña Mary", "AAD800101AB1", "G03", "", "Sin validar", 4000],
                     ["A-1042", "28/10/2026", "Transportes del Sureste", "TSU120101AB1", "G03", "ok", "Vigente", 10000]];
        var m = function (n) { return "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
        $("uv-filas").innerHTML = filas.map(function (f) {
            return '<tr><td class="ui-fija"><input type="checkbox" aria-label="Elegir"> <a class="ui-folio" href="#" data-sin-ir>' + esc(f[0]) + "</a></td><td>" + esc(f[1]) + '</td><td title="' + esc(f[2]) + '">' + esc(f[2]) +
                '</td><td class="mono">' + esc(f[3]) + "</td><td>" + esc(f[4]) + '</td><td><span class="ui-estado' + (f[5] ? " ui-estado--" + f[5] : "") + '">' + esc(f[6]) + "</span></td>" +
                '<td class="num">' + m(f[7]) + '</td><td class="num">' + m(f[7] * 0.16) + '</td><td class="num">' + m(f[7] * 1.16) + "</td></tr>";
        }).join("");
    }

    function marcarOpcion() {
        var actual = document.documentElement.dataset.tema === "b" ? "b" : "a";
        document.querySelectorAll(".uv-opcion").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.tema === actual)); });
    }

    function eventos() {
        document.querySelector(".uv-opciones").addEventListener("click", function (e) {
            var b = e.target.closest("[data-tema]"); if (!b) return;
            if (b.dataset.tema === "b") document.documentElement.dataset.tema = "b"; else delete document.documentElement.dataset.tema;
            try { localStorage.setItem("fc-tema", b.dataset.tema); } catch (err) { /* sin almacenamiento */ }
            marcarOpcion(); pintarPaletas();
            Fiscontable.toast("Opción " + b.dataset.tema.toUpperCase() + " aplicada en este navegador.");
        });
        $("uv-descargar").addEventListener("click", function (e) {
            e.stopPropagation();
            var menu = $("uv-descargar-menu"); menu.hidden = !menu.hidden; this.setAttribute("aria-expanded", String(!menu.hidden));
        });
        $("uv-descargar-menu").addEventListener("click", function (e) {
            var b = e.target.closest("button"); if (!b) return;
            this.hidden = true; Fiscontable.toast("Descargando " + b.textContent + "…");
        });
        document.addEventListener("click", function () { $("uv-descargar-menu").hidden = true; });
        $("uv-chips").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) b.parentElement.remove(); });
        $("uv-toast").addEventListener("click", function () { Fiscontable.toast("Guardado. Ya puedes timbrar con esta empresa."); });
        $("uv-modal-abrir").addEventListener("click", function () { $("uv-modal").showModal(); });
        $("uv-modal").addEventListener("click", function (e) { if (e.target === this || e.target.closest("[data-cerrar]")) this.close(); });
        document.addEventListener("click", function (e) { if (e.target.closest("[data-sin-ir]")) e.preventDefault(); });
    }

    async function iniciar() {
        var p = await Fiscontable.perfil();
        if (!p || p._error || p.rol !== "admin") { $("uv-solo-admin").hidden = false; return; }
        $("uv-contenido").hidden = false;
        pintarPaletas(); pintarBotones(); pintarFilas(); marcarOpcion(); eventos();
    }
    iniciar();
})();
