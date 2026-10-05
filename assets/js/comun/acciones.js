/*
 * acciones.js — Columna de acciones (como Mi Admin) de los módulos de trámite.
 *
 * Los botones solo llevan a lo que la página ya tiene:
 *   data-ir-pestana="id"  → hace clic en esa pestaña (Un contribuyente / Varios a la vez)
 *   data-programar        → abre "Programar para la madrugada"
 */
(function () {
    "use strict";
    document.addEventListener("click", function (e) {
        var b = e.target.closest(".mod-acciones [data-ir-pestana], .mod-acciones [data-programar]");
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
