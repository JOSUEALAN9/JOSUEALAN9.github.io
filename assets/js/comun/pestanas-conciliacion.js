/* pestanas-conciliacion.js — La barra de pestañas de Conciliación de pagos (18-nov-2026). La usan dos páginas: Conciliación
   (Facturas PPD, Inconsistencias, IVA del periodo) y Administración de XML abierta como «Complementos de pago».
     FCPestanasConc.pintar(caja, activa, alElegir)     alElegir(clave) → true si la página la atiende; si no, se navega
     FCPestanasConc.cuenta(caja, clave, n)             número junto a una pestaña (p. ej. inconsistencias) */
(function () {
    "use strict";
    var PESTANAS = [["ppd", "Facturas PPD", "Facturas a crédito y sus pagos"], ["pagos", "Complementos de pago", "Los complementos de pago emitidos y recibidos"],
                    ["errores", "Inconsistencias", "Facturas mal emitidas: PUE con forma de pago 99, parcialidades repetidas, pagos en otra moneda…"],
                    ["iva", "IVA del periodo", "Lo cobrado o pagado en el periodo: PPD por fecha de pago y PUE por fecha de emisión"]];
    function destino(clave, rfc) {
        var q = new URLSearchParams();
        if (rfc) q.set("rfc", rfc);
        if (clave === "pagos") { q.set("vista", "pagos"); return "/herramientas/xml/?" + q.toString(); }
        q.set("pestana", clave);
        return "/herramientas/conciliacion/?" + q.toString();
    }
    function pintar(caja, activa, alElegir, rfc) {
        if (!caja) return;
        caja.hidden = false;
        caja.innerHTML = PESTANAS.map(function (p) {
            return '<button type="button" role="tab" data-pestana="' + p[0] + '" aria-selected="' + (p[0] === activa) + '" title="' + p[2] + '">' + p[1] + "</button>";
        }).join("");
        caja.onclick = function (e) {
            var b = e.target.closest("[data-pestana]"); if (!b) return;
            var clave = b.dataset.pestana;
            if (alElegir && alElegir(clave) === true) {
                caja.querySelectorAll("[data-pestana]").forEach(function (x) { x.setAttribute("aria-selected", String(x === b)); });
                return;
            }
            location.href = destino(clave, typeof rfc === "function" ? rfc() : rfc);
        };
    }
    function cuenta(caja, clave, n) {
        var b = caja && caja.querySelector('[data-pestana="' + clave + '"]'); if (!b) return;
        var p = PESTANAS.find(function (x) { return x[0] === clave; });
        b.textContent = p[1] + (n ? " (" + Number(n).toLocaleString("es-MX") + ")" : "");
    }
    window.FCPestanasConc = { pintar: pintar, cuenta: cuenta };
})();
