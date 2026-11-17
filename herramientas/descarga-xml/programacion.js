/* Antes iba en línea en la página (17-nov-2026: las páginas ya no llevan código en línea). */
FCProgramacion.linea({ modulo: "xml", contenedor: document.getElementById("linea-programa") });
(function () {
    function metodo() { var b = document.querySelector('.dm-modo[aria-selected="true"]'); if (b) document.getElementById("metodo-texto").textContent = b.querySelector("strong").textContent; }
    document.addEventListener("click", function (e) { if (e.target.closest(".dm-modo")) setTimeout(metodo, 0); });
    window.addEventListener("load", function () { setTimeout(metodo, 300); });
})();
