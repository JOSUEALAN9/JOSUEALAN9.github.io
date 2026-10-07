/*
 * acciones.js — Botones de acciones de los módulos de trámite (encabezado o columna).
 *
 * Solo disparan lo que la página ya tiene:
 *   data-ir-pestana="id"  → hace clic en esa pestaña (Por empresa / Masivo)
 *   data-programar        → abre "Programar descarga"
 */
(function () {
    "use strict";
    document.addEventListener("click", function (e) {
        var b = e.target.closest("[data-ir-pestana], [data-programar]");
        if (!b) return;
        if (b.dataset.irPestana) {
            var p = document.getElementById(b.dataset.irPestana);
            if (p) { p.click(); p.scrollIntoView({ block: "nearest" }); }
            return;
        }
        var abrir = document.querySelector('#programar-madrugada [data-fp="abrir"]');
        if (abrir) abrir.click();
    });
})();
