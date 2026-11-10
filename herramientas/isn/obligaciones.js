/*
 * herramientas/isn/obligaciones.js — Candado por obligación en Impuestos estatales (ISN, hospedaje, informativa,
 * profesiones, alcohol). La herramienta siempre se ve, pero si la empresa elegida no tiene esa obligación
 * (ni declaraciones de antes), «Por empresa» muestra un candado en vez de la captura, y las pestañas de los
 * impuestos que no tiene llevan 🔒. Desde el candado se puede activar la obligación (si de verdad la tiene).
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var NOMBRES = { isn: "impuesto sobre nóminas (ISN)", ish: "impuesto al hospedaje", ish_inf: "informativa del hospedaje",
                    prof: "ejercicio de profesiones", alc: "venta de bebidas alcohólicas" };
    var O = { isn: {}, est: {}, listo: null, verAunAsi: {} };

    function cargar() {
        if (O.listo) return O.listo;
        O.listo = Promise.all([
            fetch(API + "/api/isn/obligaciones", { credentials: "include" }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
            fetch(API + "/api/estatales/obligaciones", { credentials: "include" }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
        ]).then(function (x) { O.isn = x[0] || {}; O.est = x[1] || {}; });
        return O.listo;
    }

    function activa(imp, rfc) {
        if (!rfc) return true;
        if (imp === "isn") return !!(O.isn[rfc] && O.isn[rfc].obligacion);
        return !!(O.est[rfc] && O.est[rfc][imp] && O.est[rfc][imp].obligacion);
    }

    function pestanas(rfc) {
        document.querySelectorAll(".est-impuestos a").forEach(function (a) {
            var imp = a.dataset.imp || "isn";
            var sin = !!rfc && !activa(imp, rfc);
            a.classList.toggle("est-sin", sin);
            a.title = sin ? "Esta empresa no tiene la obligación de " + NOMBRES[imp] : "";
        });
    }

    /* o: {imp, rfc, nombre, periodos, vista, alActivar} → true si quedó bloqueada */
    function aplicar(o) {
        pestanas(o.rfc);
        var caja = document.getElementById("obl-candado");
        if (!caja) {
            caja = document.createElement("section");
            caja.id = "obl-candado";
            caja.className = "est-candado";
            caja.hidden = true;
            var vista = document.getElementById("vista-empresa");
            vista.parentNode.insertBefore(caja, vista);
        }
        var bloqueada = !!o.rfc && !activa(o.imp, o.rfc) && !o.periodos && !O.verAunAsi[o.imp + o.rfc];
        var enEmpresa = o.vista !== "masivo";
        caja.hidden = !(bloqueada && enEmpresa);
        document.getElementById("vista-empresa").hidden = !enEmpresa || bloqueada;
        if (bloqueada) {
            caja.innerHTML = '<div class="est-candado__icono" aria-hidden="true">🔒</div>' +
                "<h2>" + esc(o.nombre || o.rfc) + " no tiene la obligación de " + esc(NOMBRES[o.imp]) + "</h2>" +
                "<p>La herramienta está disponible, pero esta empresa no la tiene activada en sus obligaciones, por eso no se captura nada aquí. " +
                "Si sí la tiene (por ejemplo, es un cliente nuevo de este impuesto), actívala y ya puedes trabajarla.</p>" +
                '<div class="est-candado__botones">' +
                '<button type="button" class="xml-btn xml-btn--primario" data-obl-activar>Sí la tiene: activar</button>' +
                '<a class="xml-btn" href="/clientes/?rfc=' + encodeURIComponent(o.rfc) + '">Ver sus obligaciones</a></div>' +
                '<p class="est-candado__nota" id="obl-error" hidden></p>';
            caja.querySelector("[data-obl-activar]").onclick = function () { activar(o, this); };
        }
        return bloqueada;
    }

    async function activar(o, boton) {
        if (!(await Fiscontable.preguntar("¿Activar la obligación de " + NOMBRES[o.imp] + " para " + (o.nombre || o.rfc) + "?\n\nDesde ahora aparecerá en Masivo y en su ficha de cliente."))) return;
        boton.disabled = true;
        try {
            var r = o.imp === "isn"
                ? await fetch(API + "/api/isn/obligacion", { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
                                                              body: JSON.stringify({ rfc: o.rfc, activa: true, nombre: o.nombre || null }) })
                : await fetch(API + "/api/estatales/" + o.imp + "/obligacion", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
                                                                               body: JSON.stringify({ rfcs: [o.rfc], activa: true }) });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            if (o.imp === "isn") O.isn[o.rfc] = Object.assign({}, O.isn[o.rfc], { obligacion: true });
            else { O.est[o.rfc] = O.est[o.rfc] || {}; O.est[o.rfc][o.imp] = { obligacion: true }; }
            if (o.alActivar) o.alActivar();
        } catch (e) {
            var p = document.getElementById("obl-error");
            p.textContent = e.message; p.hidden = false; boton.disabled = false;
        }
    }

    window.EstObligaciones = { cargar: cargar, aplicar: aplicar, activa: activa };
})();
