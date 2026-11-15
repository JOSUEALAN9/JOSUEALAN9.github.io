/*
 * admin/plazos-admin.js — Sistema › Plazos y valores (solo admin).
 *   · Plazos de guardado (C-01): cuántos días se guarda cada cosa antes de borrarse sola.
 *   · Las programaciones por defecto (C-02) se mudaron a Configuración › Valores de fábrica › Lo programado (15-nov).
 * Cada valor tiene mínimo y máximo para que un error de captura no borre de más.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var caja = document.getElementById("plazos-admin");
    if (!caja) return;

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
            // 15-nov, Alan: lo de fábrica en un solo lugar → las programaciones por defecto viven en Valores de fábrica
            '<div class="ui-tarjeta"><h3 class="plz-titulo">Programaciones por defecto</h3>' +
            '<p class="xml-tenue plz-nota">Se cambiaron a <a href="/configuracion/?seccion=fabrica&amp;sub=programado.csf">Configuración › Valores de fábrica › Lo programado</a>.</p></div>';

        document.getElementById("plz-guardar-ret").addEventListener("click", async function () {
            var v = {}, msj = document.getElementById("plz-msj-ret");
            caja.querySelectorAll("[data-ret]").forEach(function (i) { v[i.dataset.ret] = +i.value; });
            try { await put("/api/admin/plazos", { retencion: v }); msj.textContent = "✓ Guardado."; msj.className = "plz-msj plz-msj--ok"; }
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
