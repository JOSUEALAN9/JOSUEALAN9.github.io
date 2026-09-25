/**
 * paso-cliente.js — el paso "¿Para quién?" que abre cada herramienta.
 *
 * Este patrón nació en Declaraciones y ahora lo usan también Constancias
 * y Opinión. La idea: antes de pedirte archivos, contraseñas o fechas,
 * la herramienta pregunta de quién es el trabajo. Elegir un cliente del
 * directorio o subir la e.firma de alguien que no está registrado son dos
 * caminos del mismo paso, no dos módulos distintos.
 *
 * Camino "Con una e.firma": ya no se teclea el RFC. Para alguien que no
 * está en el directorio siempre hace falta su e.firma, y el .cer ya trae
 * el RFC, el nombre y la vigencia. Se lee en el navegador
 * (assets/js/comun/leer-cer.js) y el .cer viaja en `elegido.cer` para que el
 * módulo no lo vuelva a pedir. Solo si el .cer no se puede leer aparece
 * el campo para escribir el RFC a mano.
 *
 * Cuando llegas desde la ficha de un cliente (?rfc=...&cliente=...) el
 * paso se resuelve solo y se colapsa a una línea.
 *
 *   PasoCliente.montar({
 *       contenedor: "paso-cliente",
 *       alElegir: function (elegido) { ... },
 *           // {rfc, alias, esCliente, efirmaGuardada,
 *           //  cer (File, solo si llegó por e.firma), nombreCert, vigenteHasta}
 *       alLimpiar: function () { ... }
 *   });
 */
(function () {
    "use strict";

    var API = window.Fiscontable.API;
    var PATRON_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

    var esc = window.Fiscontable.escapar;

    function fechaCorta(f) {
        return f.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
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
                  '<div class="pc-campo">' +
                    '<span class="pc-etiqueta">Alguien que no tienes registrado</span>' +
                    '<label class="pc-control" for="pc-cer" id="pc-cer-boton" tabindex="0" role="button" ' +
                      'style="display:block;box-sizing:border-box;cursor:pointer;text-align:center;font-weight:600;color:var(--acento)">' +
                      "Subir su e.firma (.cer)</label>" +
                    '<input type="file" id="pc-cer" accept=".cer" ' +
                      'style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none">' +
                  "</div>" +
                "</div>" +
                '<span class="pc-pista" id="pc-pista"></span>' +
                '<label class="pc-campo" id="pc-manual" style="display:none;margin-top:10px;max-width:320px">' +
                  '<span class="pc-etiqueta">Escribe su RFC</span>' +
                  '<input class="pc-control pc-rfc" id="pc-rfc" type="text" inputmode="text" ' +
                    'autocomplete="off" spellcheck="false" maxlength="13" placeholder="XAXX010101000">' +
                "</label>" +
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
        var campoCer = caja.querySelector("#pc-cer");
        var botonCer = caja.querySelector("#pc-cer-boton");
        var bloqueManual = caja.querySelector("#pc-manual");
        var cerPendiente = null;     // .cer que no se pudo leer: viaja con el RFC tecleado
        var pista = caja.querySelector("#pc-pista");
        var abierto = caja.querySelector("#pc-abierto");
        var cerrado = caja.querySelector("#pc-cerrado");

        function limpiarPista() { pista.textContent = ""; pista.className = "pc-pista"; }

        function colapsar(datos) {
            elegido = datos;
            caja.querySelector("#pc-inicial").textContent = (datos.alias || datos.rfc).charAt(0).toUpperCase();
            caja.querySelector("#pc-nombre").textContent = datos.alias || datos.nombreCert || "RFC sin registrar";
            var linea = datos.rfc;
            if (datos.vigenteHasta) {
                var dias = Math.floor((datos.vigenteHasta - new Date()) / 86400000);
                linea += " · e.firma vigente hasta " + fechaCorta(datos.vigenteHasta) +
                    (dias <= 30 ? " (vence en " + dias + (dias === 1 ? " día)" : " días)") : "");
            }
            caja.querySelector("#pc-rfc-chico").textContent = linea;

            var sello = caja.querySelector("#pc-sello");
            if (datos.efirmaGuardada) {
                sello.textContent = "e.firma guardada";
                sello.hidden = false;
            } else if (!datos.esCliente) {
                sello.textContent = "No está en tu directorio";
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
            campoCer.value = "";
            cerPendiente = null;
            bloqueManual.style.display = "none";
            botonCer.textContent = "Subir su e.firma (.cer)";
            limpiarPista();
            if (opciones.alLimpiar) opciones.alLimpiar();
            select.focus();
        }

        caja.querySelector("#pc-cambiar").addEventListener("click", reabrir);

        select.addEventListener("change", function () {
            if (!select.value) return;
            campoRfc.value = "";
            campoCer.value = "";
            cerPendiente = null;
            bloqueManual.style.display = "none";
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
            colapsar({ rfc: rfc, alias: null, esCliente: false, efirmaGuardada: false, cer: cerPendiente });
        }

        /* ---- Camino "Con una e.firma" ---- */

        function pistaMal(texto) { pista.textContent = texto; pista.className = "pc-pista pc-pista--mal"; }

        botonCer.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); campoCer.click(); }
        });

        campoCer.addEventListener("change", async function () {
            var archivo = campoCer.files[0];
            if (!archivo) return;
            select.value = "";
            bloqueManual.style.display = "none";
            cerPendiente = null;
            pista.className = "pc-pista";
            pista.textContent = "Leyendo el certificado…";
            botonCer.textContent = archivo.name;

            var cert = typeof window.leerCertificado === "function" ? await window.leerCertificado(archivo) : null;

            if (!cert || !cert.rfc) {
                // Respaldo: el .cer sí se usa, pero el RFC se escribe a mano.
                cerPendiente = archivo;
                bloqueManual.style.display = "block";
                pistaMal("No pudimos leer el RFC de este archivo. Revisa que sea el .cer de la e.firma " +
                    "(no el .key ni el de sellos) o escribe el RFC abajo.");
                campoRfc.focus();
                return;
            }
            if (cert.vencido) {
                campoCer.value = "";
                botonCer.textContent = "Subir su e.firma (.cer)";
                pistaMal("La e.firma de " + (cert.nombre || cert.rfc) + " venció el " + fechaCorta(cert.vigenteHasta) +
                    ". El SAT no la va a aceptar; hace falta la e.firma vigente.");
                return;
            }

            limpiarPista();
            var c = clientes.find(function (x) { return x.rfc === cert.rfc; });
            colapsar({
                rfc: cert.rfc,
                alias: c ? c.alias : null,
                esCliente: !!c,
                efirmaGuardada: !!(c && c.efirma_guardada),
                cer: archivo,
                nombreCert: cert.nombre,
                vigenteHasta: cert.vigenteHasta
            });
        });

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
                pista.textContent = "Puedes seguir subiendo la e.firma mientras tanto.";
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
            pista.textContent = "El RFC de la liga (" + esc(rfc) + ") no tiene forma válida. Elige al cliente o sube su e.firma.";
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
