/* vista.js — Antes de que cargue la barra: ¿esta página se abrió como «Recibos de nómina» o como la pestaña «Complementos
   de pago» de Conciliación de pagos? (18-nov-2026). La tabla es la misma de Administración de XML; cambian el módulo del
   menú, el título y qué pestañas se ven. Va en archivo aparte porque las páginas no llevan código en línea. */
(function () {
    "use strict";
    var v = new URLSearchParams(location.search).get("vista"), h = document.getElementById("app-header");
    var VISTAS = { nomina: ["recibos_nomina", "Recibos de nómina"], pagos: ["conciliacion", "Conciliación de pagos"] };
    if (!h || !VISTAS[v]) return;
    h.setAttribute("data-modulo", VISTAS[v][0]);
    h.setAttribute("data-titulo", VISTAS[v][1]);
    h.setAttribute("data-modulo-fijo", "1");
    document.title = (v === "pagos" ? "Complementos de pago · Conciliación de pagos" : VISTAS[v][1]) + " · Fiscontable";
    document.documentElement.setAttribute("data-xml-vista", v);
})();
