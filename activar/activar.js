/* Antes iba en línea en la página (17-nov-2026: las páginas ya no llevan código en línea). */
(function () {
    "use strict";
    var F = window.Fiscontable, esc = F.escapar;
    function fecha(iso) { var d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }); }
    async function mias() {
        try {
            var r = await fetch(F.API + "/api/licencias/mias", { credentials: "include" });
            if (!r.ok) return;
            var d = await r.json(), filas = [];
            (d.propias || []).forEach(function (l) { filas.push([l, "Tuya"]); });
            if (d.despacho) (d.despacho.licencias || []).forEach(function (l) { filas.push([l, "Despacho «" + d.despacho.nombre + "»"]); });
            var vistos = {};
            filas = filas.filter(function (x) { if (vistos[x[0].id]) return false; vistos[x[0].id] = 1; return true; });
            document.getElementById("act-mias-caja").hidden = !filas.length;
            document.getElementById("act-mias").innerHTML = filas.map(function (x) {
                var l = x[0];
                return "<li><code>" + esc(l.clave) + "</code><span>" + esc(x[1]) + "</span><span>" + (l.tipo === "lugares" ? "+" + l.asientos + " lugares (con la vigencia del despacho)" :      // 20-nov-2026: lugares extra (H9)
                    (l.tipo === "despacho" ? l.asientos + " lugares · " : "") + l.meses + (l.meses === 1 ? " mes" : " meses")) + "</span><span>" + (l.estado === "revocada" ? "Cancelada" : "Vence el " + esc(fecha(l.vence_en))) + "</span></li>";
            }).join("");
        } catch (e) { /* no pasa nada */ }
    }
    F.activarLicencia(document.getElementById("act-forma"), { enfocar: true, alActivar: function () { mias(); } });
    mias();
})();
