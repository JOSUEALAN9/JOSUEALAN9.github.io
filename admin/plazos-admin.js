/*
 * admin/plazos-admin.js — Sistema › Plazos y valores (solo admin).
 *   · Plazos de guardado (C-01): cuántos días se guarda cada cosa antes de borrarse sola.
 *   · Programaciones por defecto (C-02): lo que se propone al programar Constancia, Opinión, Declaraciones, XML y Buzón.
 * Cada valor tiene mínimo y máximo para que un error de captura no borre de más.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var caja = document.getElementById("plazos-admin");
    if (!caja) return;
    var DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

    async function api(ruta, op) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, op || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function put(ruta, cuerpo) { return api(ruta, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }); }

    async function pintar() {
        caja.innerHTML = '<span class="ui-skel" style="width:60%"></span>';
        var d;
        try { d = await api("/api/admin/plazos"); } catch (e) { caja.innerHTML = '<p class="ui-aviso ui-aviso--error">' + esc(e.message) + "</p>"; return; }
        var pd = d.prog_defecto;
        var selDia = function (id, frec, dia) {
            var ops = frec === "semanal" ? DIAS.map(function (n, i) { return [i, n]; }) : Array.from({ length: 28 }, function (_, i) { return [i + 1, "día " + (i + 1)]; });
            return '<select class="ui-select" id="' + id + '">' + ops.map(function (o) { return '<option value="' + o[0] + '"' + (+o[0] === +dia ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>";
        };
        var fila = function (m, nombre) {
            return "<tr><td><b>" + nombre + '</b></td><td><select class="ui-select" data-frec="' + m + '"><option value="mensual"' + (pd[m].frecuencia === "mensual" ? " selected" : "") +
                '>Cada mes</option><option value="semanal"' + (pd[m].frecuencia === "semanal" ? " selected" : "") + ">Cada semana</option></select></td><td>" + selDia("pd-dia-" + m, pd[m].frecuencia, pd[m].dia) + "</td></tr>";
        };
        caja.innerHTML =
            '<div class="ui-tarjeta" style="margin-bottom:16px"><h3 class="plz-titulo">Plazos de guardado</h3>' +
            '<p class="xml-tenue plz-nota">Cuántos días se guarda cada cosa antes de borrarse sola. Los cambios aplican desde la siguiente limpieza.</p>' +
            '<table class="ui-tabla"><thead><tr><th>Qué</th><th class="num">Días</th><th>De fábrica</th></tr></thead><tbody>' +
            Object.keys(d.retencion).map(function (k) {
                var v = d.retencion[k];
                return "<tr><td>" + esc(v.titulo) + '</td><td class="num"><input type="number" class="ui-input plz-num" data-ret="' + esc(k) + '" min="' + v.min + '" max="' + v.max + '" value="' + v.valor + '"></td>' +
                    '<td class="xml-tenue">' + v.defecto + " (entre " + v.min + " y " + v.max + ")</td></tr>";
            }).join("") +
            d.fijos.map(function (f) { return "<tr><td>" + esc(f[0]) + '</td><td colspan="2" class="xml-tenue">' + esc(f[1]) + "</td></tr>"; }).join("") +
            '</tbody></table><div class="plz-acciones"><button type="button" class="ui-btn ui-btn--primario ui-btn--32" id="plz-guardar-ret">Guardar plazos</button><span class="plz-msj" id="plz-msj-ret"></span></div></div>' +
            '<div class="ui-tarjeta"><h3 class="plz-titulo">Programaciones por defecto</h3>' +
            '<p class="xml-tenue plz-nota">Lo que se propone cuando alguien programa por primera vez. Cada cuenta lo puede cambiar por empresa.</p>' +
            '<table class="ui-tabla"><thead><tr><th>Qué</th><th>Cada cuánto</th><th>Qué día</th></tr></thead><tbody>' +
            fila("csf", "Constancia") + fila("opinion", "Opinión 32-D") + fila("declaraciones", "Declaraciones") +
            '<tr><td><b>XML</b></td><td><select class="ui-select" id="pd-xml-frec">' + Object.keys(d.frecuencias_xml).map(function (k) {
                return '<option value="' + k + '"' + (pd.xml.frecuencia === k ? " selected" : "") + ">" + esc(d.frecuencias_xml[k]) + "</option>"; }).join("") +
            '</select></td><td><select class="ui-select" id="pd-xml-tipo">' + Object.keys(d.tipos_xml).map(function (k) {
                return '<option value="' + k + '"' + (pd.xml.tipo === k ? " selected" : "") + ">" + esc(d.tipos_xml[k]) + "</option>"; }).join("") + "</select></td></tr>" +
            '</tbody></table><div class="plz-acciones"><button type="button" class="ui-btn ui-btn--primario ui-btn--32" id="plz-guardar-pd">Guardar</button><span class="plz-msj" id="plz-msj-pd"></span></div></div>';

        caja.querySelectorAll("[data-frec]").forEach(function (s) {
            s.addEventListener("change", function () {
                var m = s.dataset.frec, celda = document.getElementById("pd-dia-" + m).parentNode;
                celda.innerHTML = selDia("pd-dia-" + m, s.value, s.value === "semanal" ? 0 : 1);
            });
        });
        document.getElementById("plz-guardar-ret").addEventListener("click", async function () {
            var v = {}, msj = document.getElementById("plz-msj-ret");
            caja.querySelectorAll("[data-ret]").forEach(function (i) { v[i.dataset.ret] = +i.value; });
            try { await put("/api/admin/plazos", { retencion: v }); msj.textContent = "✓ Guardado."; msj.className = "plz-msj plz-msj--ok"; }
            catch (e) { msj.textContent = e.message; msj.className = "plz-msj plz-msj--mal"; }
        });
        document.getElementById("plz-guardar-pd").addEventListener("click", async function () {
            var v = {}, msj = document.getElementById("plz-msj-pd");
            ["csf", "opinion", "declaraciones"].forEach(function (m) {
                v[m] = { frecuencia: caja.querySelector('[data-frec="' + m + '"]').value, dia: +document.getElementById("pd-dia-" + m).value };
            });
            v.xml = { frecuencia: document.getElementById("pd-xml-frec").value, tipo: document.getElementById("pd-xml-tipo").value };
            try { await put("/api/admin/plazos", { prog_defecto: v }); msj.textContent = "✓ Guardado."; msj.className = "plz-msj plz-msj--ok"; }
            catch (e) { msj.textContent = e.message; msj.className = "plz-msj plz-msj--mal"; }
        });
    }

    var cargado = false;
    function revisar() {
        var panel = caja.closest("[data-subpanel]");
        if (!cargado && panel && !panel.hidden) { cargado = true; pintar(); }
    }
    new MutationObserver(revisar).observe(caja.closest("[data-subpanel]"), { attributes: true, attributeFilter: ["hidden"] });
    document.addEventListener("DOMContentLoaded", revisar);
})();
