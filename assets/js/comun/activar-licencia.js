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
            '<button type="submit" class="ui-btn ui-btn--primario ui-btn--36 al__boton" disabled>Activar</button></form>' +
            '<p class="al__msj" role="status" hidden></p>';
        var forma = caja.querySelector("form"), campo = caja.querySelector(".al__clave"), boton = caja.querySelector(".al__boton"), msj = caja.querySelector(".al__msj");

        function decir(html, tipo) { msj.innerHTML = html; msj.className = "al__msj" + (tipo ? " al__msj--" + tipo : ""); msj.hidden = !html; }

        campo.addEventListener("input", function () {
            var f = formatear(campo.value);
            campo.value = f.texto;
            boton.disabled = !f.completa;
            decir("");
        });
        forma.addEventListener("submit", async function (e) {
            e.preventDefault();
            var f = formatear(campo.value);
            if (!f.completa) return decir("La clave tiene 16 letras y números: FSC-XXXX-XXXX-XXXX-XXXX.", "error");
            boton.classList.add("ui-btn--cargando"); boton.disabled = true;
            try {
                var r = await fetch(F.API + "/api/licencias/activar", { method: "POST", credentials: "include",
                    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clave: f.texto }) });
                if (!r.ok) throw new Error(await F.leerError(r));
                var d = await r.json();
                campo.value = "";
                decir("<b>Licencia activada.</b> " + esc(d.plan) + " hasta el " + esc(fechaLarga(d.vence)) + "." +
                    (d.tipo === "despacho" ? " Tu despacho «" + esc(d.despacho) + "» tiene " + d.asientos + " lugares. " +
                        '<a href="/despacho/">Invita a tu equipo →</a>' : ""), "ok");
                if (opciones.alActivar) opciones.alActivar(d);
            } catch (er) {
                decir(esc(er.message), "error");
                boton.disabled = false;
            } finally {
                boton.classList.remove("ui-btn--cargando");
            }
        });
        if (opciones.enfocar) campo.focus();
        return { campo: campo };
    };
})();
