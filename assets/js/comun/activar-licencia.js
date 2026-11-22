/**
 * activar-licencia.js — Pieza única para activar una licencia (la usan /activar/ y Configuración → Plan y créditos).
 *
 *   Fiscontable.activarLicencia(contenedor, { alActivar: function (resultado) {…} })
 *
 * Campo con formato FSC-XXXX-XXXX-XXXX-XXXX (se acomoda solo al escribir o pegar), botón «Activar» y mensaje.
 * El servidor revisa todo (core/licencias.py): la clave, que no esté usada y los intentos.
 */
(function () {
    "use strict";
    var F = window.Fiscontable, esc = F.escapar;
    var ALFA = /[0-9A-HJKMNP-TV-Z]/;

    function formatear(texto) {
        var t = String(texto || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
        if (t.indexOf("FSC") === 0) t = t.slice(3);
        t = t.replace(/O/g, "0").replace(/[IL]/g, "1").replace(/U/g, "V").split("").filter(function (c) { return ALFA.test(c); }).join("").slice(0, 16);
        var partes = [];
        for (var i = 0; i < t.length; i += 4) partes.push(t.slice(i, i + 4));
        return { texto: t.length ? "FSC-" + partes.join("-") : "", completa: t.length === 16 };
    }

    function fechaLarga(iso) {
        var d = new Date(iso);
        return isNaN(d) ? iso : d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
    }

    F.activarLicencia = function (caja, opciones) {
        opciones = opciones || {};
        caja.classList.add("al");
        caja.innerHTML = '<form class="al__forma" novalidate>' +
            '<label class="ui-campo al__campo"><span class="ui-etiqueta">Clave de licencia</span>' +
            '<input class="ui-input al__clave" maxlength="24" placeholder="FSC-XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text"></label>' +
            '<button type="submit" class="ui-btn ui-btn--primario ui-btn--36 al__boton" disabled title="Escribe la clave completa (FSC-…)">Activar</button></form>' +
            '<form class="al__forma al__forma--nombre" novalidate hidden>' +
            '<label class="ui-campo al__campo"><span class="ui-etiqueta">Nombre de tu despacho</span>' +
            '<input class="ui-input al__nombre" maxlength="80" placeholder="Pérez y Asociados" autocomplete="organization"></label>' +
            '<button type="submit" class="ui-btn ui-btn--primario ui-btn--36 al__boton-nombre">Crear mi despacho</button></form>' +
            '<p class="al__msj" role="status" hidden></p>';
        var forma = caja.querySelector("form"), campo = caja.querySelector(".al__clave"), boton = caja.querySelector(".al__boton"), msj = caja.querySelector(".al__msj");
        var formaNombre = caja.querySelector(".al__forma--nombre"), campoNombre = caja.querySelector(".al__nombre"),
            botonNombre = caja.querySelector(".al__boton-nombre");

        function decir(html, tipo) { msj.innerHTML = html; msj.className = "al__msj" + (tipo ? " al__msj--" + tipo : ""); msj.hidden = !html; }

        campo.addEventListener("input", function () {
            var f = formatear(campo.value);
            campo.value = f.texto;
            boton.disabled = !f.completa;
            boton.title = f.completa ? "" : "Escribe la clave completa (FSC-…)";   // 22-nov-2026 (barrido de botones): dice por qué
            formaNombre.hidden = true;                 // otra clave: se vuelve a preguntar si hace falta
            decir("");
        });
        // 19-nov-2026 (ensayo de venta): si la clave es de un despacho y la persona aún no tiene uno, el servidor contesta
        // 409 «falta_nombre» (sin gastar la clave ni contar el intento) y aquí se pregunta cómo se llama el despacho.
        async function enviar(nombre) {
            var f = formatear(campo.value);
            if (!f.completa) return decir("La clave tiene 16 letras y números: FSC-XXXX-XXXX-XXXX-XXXX.", "error");
            var b = nombre === undefined ? boton : botonNombre;
            b.classList.add("ui-btn--cargando"); b.disabled = true;
            try {
                var cuerpo = { clave: f.texto, pedir_nombre: true };
                if (nombre !== undefined) cuerpo.nombre_despacho = nombre;
                var r = await fetch(F.API + "/api/licencias/activar", { method: "POST", credentials: "include",
                    headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
                if (r.status === 409) {
                    var d409 = null;
                    try { d409 = (await r.clone().json()).detail; } catch (er) { /* sin cuerpo */ }
                    if (d409 && d409.falta_nombre) {
                        formaNombre.hidden = false;
                        if (!campoNombre.value) campoNombre.value = d409.sugerido || "";
                        decir("Esta clave es de un despacho. Escribe cómo se llama: así lo verá tu equipo (lo puedes cambiar después en Mi despacho › Ajustes).", "");
                        campoNombre.focus(); campoNombre.select();
                        return;
                    }
                }
                if (!r.ok) throw new Error(await F.leerError(r));
                var d = await r.json();
                campo.value = ""; formaNombre.hidden = true; campoNombre.value = "";
                decir("<b>Licencia activada.</b> " + esc(d.plan) + " hasta el " + esc(fechaLarga(d.vence)) + "." +
                    (d.tipo === "despacho" ? " Tu despacho «" + esc(d.despacho) + "» tiene " + d.asientos + " lugares" +
                        (d.empresas ? " y hasta " + d.empresas + " empresas (RFC) entre todos" : "") + ". " : "") +
                    (d.timbres ? "Ya tienes " + Number(d.timbres).toLocaleString("es-MX") + " timbres de facturación incluidos. " : "") +
                    (d.tipo === "despacho" ? '<a href="/despacho/">Invita a tu equipo →</a>' : ""), "ok");
                if (opciones.alActivar) opciones.alActivar(d);
            } catch (er) {
                decir(esc(er.message), "error");
            } finally {
                b.classList.remove("ui-btn--cargando");
                boton.disabled = !formatear(campo.value).completa;
                botonNombre.disabled = !campoNombre.value.trim();
            }
        }
        forma.addEventListener("submit", function (e) { e.preventDefault(); enviar(); });
        formaNombre.addEventListener("submit", function (e) {
            e.preventDefault();
            if (!campoNombre.value.trim()) { campoNombre.focus(); return decir("Escribe el nombre de tu despacho.", "error"); }
            enviar(campoNombre.value.trim());
        });
        campoNombre.addEventListener("input", function () { botonNombre.disabled = !campoNombre.value.trim(); });
        if (opciones.enfocar) campo.focus();
        return { campo: campo };
    };
})();
