/* Antes iba en línea en la página (17-nov-2026: las páginas ya no llevan código en línea). */

(function () {   // pestañas del historial (se recuerda la última)
    function ver(t) {
        document.querySelectorAll("[data-cr-tab]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.crTab === t)); });
        document.querySelectorAll("[data-cr-panel]").forEach(function (p) { p.hidden = p.dataset.crPanel !== t; });
        try { localStorage.setItem("fc-creditos-tab", t); } catch (e) { /* nada */ }
    }
    document.querySelector(".cr-pestanas").addEventListener("click", function (e) { var b = e.target.closest("[data-cr-tab]"); if (b) ver(b.dataset.crTab); });
    var t = null; try { t = localStorage.getItem("fc-creditos-tab"); } catch (e) { /* nada */ }
    if (t) ver(t);
})();
