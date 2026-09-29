/**
 * catalogos.js — Catálogos del SAT para mostrar "616 - Sin obligaciones
 * fiscales" en vez de solo la clave. Una sola fuente para todos los
 * módulos: el backend (modulos/xml/catalogos.py), pedida una vez por
 * sesión del navegador.
 *
 *   await FCCatalogos.cargar();
 *   FCCatalogos.texto("regimen", "616")   -> "616 - Sin obligaciones fiscales"
 *   FCCatalogos.texto("uso_cfdi", "ZZZ")  -> "ZZZ"  (clave desconocida: tal cual)
 *   FCCatalogos.todos()                   -> { regimen: {...}, uso_cfdi: {...}, ... }
 *
 * Catálogos: regimen, uso_cfdi, forma_pago, metodo_pago, tipo_comprobante,
 * exportacion, tipo_relacion, periodicidad, meses, tipo_nomina,
 * periodicidad_nomina, tipo_percepcion, tipo_deduccion, tipo_otro_pago.
 */
(function () {
    "use strict";
    var LLAVE = "fc-catalogos";
    var datos = null, promesa = null;

    function cargar() {
        if (datos) return Promise.resolve(datos);
        if (!promesa) {
            promesa = (async function () {
                try {
                    var guardado = sessionStorage.getItem(LLAVE);
                    if (guardado) { datos = JSON.parse(guardado); return datos; }
                } catch (e) { /* sin almacenamiento */ }
                try {
                    var resp = await fetch(Fiscontable.API + "/api/xml/catalogos", { credentials: "include" });
                    if (!resp.ok) throw new Error("sin catálogos");
                    datos = await resp.json();
                    // Solo se guarda si llegó bien: un fallo no debe quedarse pegado toda la sesión.
                    try { sessionStorage.setItem(LLAVE, JSON.stringify(datos)); } catch (e) { /* nada */ }
                } catch (e) {
                    datos = {};          // la página funciona igual, mostrando solo las claves
                    promesa = null;      // y la siguiente llamada vuelve a intentar
                }
                return datos;
            })();
        }
        return promesa;
    }

    function descripcion(catalogo, clave) {
        var c = datos && datos[catalogo];
        return c && clave !== null && clave !== undefined ? (c[String(clave)] || "") : "";
    }

    function texto(catalogo, clave) {
        if (clave === null || clave === undefined || clave === "") return "";
        var d = descripcion(catalogo, clave);
        return d ? clave + " - " + d : String(clave);
    }

    window.FCCatalogos = {
        cargar: cargar,
        texto: texto,
        descripcion: descripcion,
        todos: function () { return datos || {}; }
    };
})();
