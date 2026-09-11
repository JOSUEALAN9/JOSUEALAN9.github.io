/**
 * paso-cliente.js — el paso "¿Para quién?" que abre cada herramienta.
 *
 * Este patrón nació en Declaraciones y ahora lo usan también Constancias
 * y Opinión. La idea: antes de pedirte archivos, contraseñas o fechas,
 * la herramienta pregunta de quién es el trabajo. Elegir un cliente del
 * directorio o teclear un RFC suelto son dos caminos del mismo paso, no
 * dos módulos distintos.
 *
 * Cuando llegas desde la ficha de un cliente (?rfc=...&cliente=...) el
 * paso se resuelve solo y se colapsa a una línea.
 *
 *   PasoCliente.montar({
 *       contenedor: "paso-cliente",
 *       alElegir: function (elegido) { ... },   // {rfc, alias, esCliente, efirmaGuardada}
 *       alLimpiar: function () { ... }
 *   });
 */
(function () {
    "use strict";

    var API = "https://api.josuealan.com";
    var PATRON_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

    function esc(v) {
        return String(v == null ? "" : v)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    /** Un RFC mexicano válido: 12 para moral, 13 para física. */
    function rfcValido(rfc) {
        return (rfc.length === 12 || rfc.length === 13) && PATRON_RFC.test(rfc);
    }

    function montar(opciones) {
        var caja = typeof opciones.contenedor === "string"
            ? document.getElementById(opciones.contenedor)
            : opciones.contenedor;
        if (!caja) return null;

        var clientes = [];
        var elegido = null;

        caja.innerHTML =
            '<div class="pc-marco">' +
              '<div class="pc-abierto" id="pc-abierto">' +
                '<div class="pc-titulo">¿Para quién es este trabajo?</div>' +
                '<div class="pc-campos">' +
                  '<label class="pc-campo">' +
                    '<span class="pc-etiqueta">Uno de tus clientes</span>' +
                    '<select class="pc-control" id="pc-select" disabled>' +
                      '<option value="">Cargando tu directorio…</option></select>' +
                  "</label>" +
                  '<div class="pc-o"><span>o</span></div>' +
                  '<label class="pc-campo">' +
                    '<span class="pc-etiqueta">Un RFC que no tienes registrado</span>' +
                    '<input class="pc-control pc-rfc" id="pc-rfc" type="text" inputmode="text" ' +
                      'autocomplete="off" spellcheck="false" maxlength="13" placeholder="XAXX010101000">' +
                    '<span class="pc-pista" id="pc-pista"></span>' +
                  "</label>" +
                "</div>" +
              "</div>" +
              '<div class="pc-cerrado" id="pc-cerrado" hidden>' +
                '<div class="pc-quien">' +
                  '<span class="pc-inicial" id="pc-inicial">·</span>' +
                  '<span><span class="pc-nombre" id="pc-nombre"></span>' +
                  '<span class="pc-rfc-chico" id="pc-rfc-chico"></span></span>' +
                "</div>" +
                '<div class="pc-derecha">' +
                  '<span class="pc-sello" id="pc-sello" hidden></span>' +
                  '<button type="button" class="pc-cambiar" id="pc-cambiar">Cambiar</button>' +
                "</div>" +
              "</div>" +
            "</div>";

        var select = caja.querySelector("#pc-select");
        var campoRfc = caja.querySelector("#pc-rfc");
        var pista = caja.querySelector("#pc-pista");
        var abierto = caja.querySelector("#pc-abierto");
        var cerrado = caja.querySelector("#pc-cerrado");

        function limpiarPista() { pista.textContent = ""; pista.className = "pc-pista"; }

        function colapsar(datos) {
            elegido = datos;
            caja.querySelector("#pc-inicial").textContent = (datos.alias || datos.rfc).charAt(0).toUpperCase();
            caja.querySelector("#pc-nombre").textContent = datos.alias || "RFC sin registrar";
            caja.querySelector("#pc-rfc-chico").textContent = datos.rfc;

            var sello = caja.querySelector("#pc-sello");
            if (datos.efirmaGuardada) {
                sello.textContent = "e.firma guardada";
                sello.hidden = false;
            } else {
                sello.hidden = true;
            }

            abierto.hidden = true;
            cerrado.hidden = false;
            if (opciones.alElegir) opciones.alElegir(datos);
        }

        function reabrir() {
            elegido = null;
            cerrado.hidden = true;
            abierto.hidden = false;
            select.value = "";
            campoRfc.value = "";
            limpiarPista();
            if (opciones.alLimpiar) opciones.alLimpiar();
            select.focus();
        }

        caja.querySelector("#pc-cambiar").addEventListener("click", reabrir);

        select.addEventListener("change", function () {
            if (!select.value) return;
            campoRfc.value = "";
            limpiarPista();
            var c = clientes.find(function (x) { return x.rfc === select.value; });
            if (!c) return;
            colapsar({
                rfc: c.rfc,
                alias: c.alias,
                esCliente: true,
                efirmaGuardada: !!c.efirma_guardada
            });
        });

        // El RFC suelto se confirma con Enter o al salir del campo: así no
        // se dispara media consulta por cada letra que escribes.
        function confirmarRfcSuelto() {
            var rfc = campoRfc.value.trim().toUpperCase();
            if (!rfc) { limpiarPista(); return; }

            if (!rfcValido(rfc)) {
                pista.textContent = "Un RFC lleva 12 caracteres (moral) o 13 (física). Revisa este.";
                pista.className = "pc-pista pc-pista--mal";
                return;
            }
            limpiarPista();
            var yaEsCliente = clientes.find(function (x) { return x.rfc === rfc; });
            if (yaEsCliente) {
                colapsar({
                    rfc: yaEsCliente.rfc,
                    alias: yaEsCliente.alias,
                    esCliente: true,
                    efirmaGuardada: !!yaEsCliente.efirma_guardada
                });
                return;
            }
            colapsar({ rfc: rfc, alias: null, esCliente: false, efirmaGuardada: false });
        }

        campoRfc.addEventListener("input", function () {
            campoRfc.value = campoRfc.value.toUpperCase();
            limpiarPista();
        });
        campoRfc.addEventListener("blur", confirmarRfcSuelto);
        campoRfc.addEventListener("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); confirmarRfcSuelto(); }
        });

        async function cargarClientes() {
            try {
                var resp = await fetch(API + "/api/clientes", { credentials: "include" });
                if (!resp.ok) throw new Error();
                clientes = await resp.json();
            } catch (e) {
                clientes = [];
                select.innerHTML = '<option value="">No pudimos cargar tu directorio</option>';
                pista.textContent = "Puedes seguir con un RFC suelto mientras tanto.";
                pista.className = "pc-pista";
                resolverParametros();
                return;
            }

            select.disabled = false;
            select.innerHTML = '<option value="">Selecciona un cliente…</option>' +
                clientes.map(function (c) {
                    return '<option value="' + esc(c.rfc) + '">' + esc(c.alias) + " · " + esc(c.rfc) + "</option>";
                }).join("");

            if (!clientes.length) {
                select.innerHTML = '<option value="">Todavía no tienes clientes registrados</option>';
                select.disabled = true;
            }
            resolverParametros();
        }

        // Llegada desde la ficha de un cliente. Antes, si el RFC de la URL
        // no estaba en la lista, el select quedaba vacío y no pasaba nada
        // ni se avisaba; ahora cae al camino de RFC suelto.
        function resolverParametros() {
            var p = new URLSearchParams(window.location.search);
            var rfc = (p.get("rfc") || "").trim().toUpperCase();
            if (!rfc) return;

            var c = clientes.find(function (x) { return x.rfc === rfc; });
            if (c) {
                colapsar({ rfc: c.rfc, alias: c.alias, esCliente: true, efirmaGuardada: !!c.efirma_guardada });
                return;
            }
            if (rfcValido(rfc)) {
                colapsar({ rfc: rfc, alias: p.get("cliente") || null, esCliente: false, efirmaGuardada: false });
                return;
            }
            pista.textContent = "El RFC de la liga (" + esc(rfc) + ") no tiene forma válida. Escríbelo a mano.";
            pista.className = "pc-pista pc-pista--mal";
        }

        cargarClientes();

        return {
            elegido: function () { return elegido; },
            reabrir: reabrir,
            fijar: colapsar
        };
    }

    window.PasoCliente = { montar: montar, rfcValido: rfcValido };
})();
