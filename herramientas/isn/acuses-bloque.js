/**
 * acuses-bloque.js — Acuses en bloque para ISN e Impuestos estatales (misma pieza en las dos pantallas):
 * baja en un ZIP los acuses ya guardados de las declaraciones marcadas (con su pago en ceros) o los manda por correo.
 * No entra a Tributanet: junta lo que ya está guardado. Servidor: modulos/isn/acuses_bloque.py.
 *   AcusesBloque.conectar({ base: "/api/isn" | "/api/estatales", marcadas: function () → [{periodo}], que: "ISN" })
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    function ids(o) {
        return o.marcadas().filter(function (x) { return x.periodo && x.periodo.id && (x.periodo.tiene_acuse || x.periodo.tiene_pago_ceros); })
            .map(function (x) { return x.periodo.id; });
    }
    async function bajar(o, boton) {
        var lista = ids(o);
        if (!lista.length) { Fiscontable.toast("Ninguna de las marcadas tiene acuse guardado todavía."); return; }
        var texto = boton.textContent; boton.disabled = true; boton.textContent = "Juntando…";
        try {
            var r = await fetch(API + o.base + "/acuses/zip", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: lista, pago_ceros: true }) });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            var nombre = (/filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "") || [])[1] || "Acuses.zip";
            var a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = nombre; a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
            var n = r.headers.get("X-Acuses"), sin = Number(r.headers.get("X-Sin-Acuse") || 0);
            Fiscontable.toast((n ? n + " documento(s) en el ZIP" : "ZIP listo") + (sin ? " · " + sin + " declaración(es) sin acuse guardado" : "") + ".");
        } catch (e) { Fiscontable.toast(e.message); }
        finally { boton.disabled = false; boton.textContent = texto; }
    }
    function correo(o) {
        var lista = ids(o);
        if (!lista.length) { Fiscontable.toast("Ninguna de las marcadas tiene acuse guardado todavía."); return; }
        Fiscontable.enviarCorreo({ titulo: "Enviar " + lista.length + " acuse(s) de " + o.que + " por correo", ruta: o.base + "/acuses/correo",
                                   datos: { ids: lista, pago_ceros: true }, para: "" });
    }
    window.AcusesBloque = {
        conectar: function (o) {
            var b1 = document.getElementById("mv-acuses"), b2 = document.getElementById("mv-acuses-correo");
            if (b1) b1.addEventListener("click", function () { bajar(o, b1); });
            if (b2) b2.addEventListener("click", function () { correo(o); });
        },
        // Para prender o apagar los botones según lo marcado
        contar: function (o) {
            var n = ids(o).length;
            ["mv-acuses", "mv-acuses-correo"].forEach(function (id) { var b = document.getElementById(id); if (b) b.disabled = !n; });
            var b = document.getElementById("mv-acuses"); if (b) b.textContent = n ? "Bajar acuses (" + n + ")" : "Bajar acuses";
        }
    };
})();
