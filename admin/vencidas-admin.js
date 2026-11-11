/*
 * admin/vencidas-admin.js — Sistema › Cuentas vencidas (solo admin). core/ciclo_cuenta.py en el servidor.
 *   · Cuentas por eliminar: cumplieron su plazo con todos sus avisos; se eliminan solo al confirmar aquí.
 *   · Plazos: gracia, e.firmas, cuenta y sus avisos.
 *   · Correos: el texto de cada aviso, editable, con prueba a tu correo.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var caja = document.getElementById("vencidas-admin");
    if (!caja) return;

    async function api(ruta, op) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, op || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function mandar(ruta, metodo, cuerpo) { return api(ruta, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo || {}) }); }
    function msj(id, ok, texto) { var m = document.getElementById(id); if (m) { m.textContent = texto; m.className = "plz-msj " + (ok ? "plz-msj--ok" : "plz-msj--mal"); } }
    var fecha = function (t) { return t ? new Date(t).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "—"; };

    async function pintar() {
        caja.innerHTML = '<span class="ui-skel" style="width:60%"></span>';
        var d, c;
        try { d = await api("/api/admin/cuentas-vencidas"); c = await api("/api/admin/correos-sistema"); }
        catch (e) { caja.innerHTML = '<p class="ui-aviso ui-aviso--error">' + esc(e.message) + "</p>"; return; }
        var lista = d.por_eliminar || [];
        caja.innerHTML =
            '<div class="ui-tarjeta" style="margin-bottom:16px"><h3 class="plz-titulo">Por eliminar</h3>' +
            '<p class="xml-tenue plz-nota">Cuentas vencidas que cumplieron su plazo y recibieron todos sus avisos. Solo se eliminan al confirmar.</p>' +
            (lista.length ? '<table class="ui-tabla"><thead><tr><th>Cuenta</th><th>Venció</th><th class="num">Empresas</th><th class="num">XML</th><th></th></tr></thead><tbody>' +
                lista.map(function (x) {
                    return "<tr><td><b>" + esc(x.correo) + "</b>" + (x.nombre ? '<br><span class="xml-tenue">' + esc(x.nombre) + "</span>" : "") + "</td><td>" + fecha(x.vence) +
                        '</td><td class="num">' + x.empresas + '</td><td class="num">' + Number(x.xml).toLocaleString("es-MX") +
                        '</td><td class="num"><button type="button" class="ui-btn ui-btn--peligro ui-btn--32" data-eliminar="' + esc(x.correo) + '">Eliminar</button></td></tr>';
                }).join("") + "</tbody></table>" : '<p class="xml-tenue">No hay cuentas por eliminar.</p>') +
            '<span class="plz-msj" id="ven-msj-lista"></span></div>' +

            '<div class="ui-tarjeta" style="margin-bottom:16px"><h3 class="plz-titulo">Plazos</h3>' +
            '<p class="xml-tenue plz-nota">Días contados desde que vence el plan.</p>' +
            '<table class="ui-tabla"><thead><tr><th>Qué</th><th class="num">Días</th><th>De fábrica</th></tr></thead><tbody>' +
            d.campos.map(function (v) {
                return "<tr><td>" + esc(v.titulo) + '</td><td class="num"><input type="number" class="ui-input plz-num" data-plazo="' + esc(v.clave) + '" min="' + v.min +
                    '" max="' + v.max + '" value="' + d.plazos[v.clave] + '"></td><td class="xml-tenue">' + v.defecto + " (entre " + v.min + " y " + v.max + ")</td></tr>";
            }).join("") +
            '</tbody></table><div class="plz-acciones"><button type="button" class="ui-btn ui-btn--primario ui-btn--32" id="ven-guardar-plazos">Guardar plazos</button>' +
            '<span class="plz-msj" id="ven-msj-plazos"></span></div></div>' +

            '<div class="ui-tarjeta"><h3 class="plz-titulo">Correos</h3>' +
            '<p class="xml-tenue plz-nota">Campos disponibles: {saludo} {fecha} {gracia} {fecha_efirmas} {fecha_cuenta} {enlace}. Deja ambos vacíos para volver al texto de fábrica.</p>' +
            c.correos.map(function (x) {
                return '<details class="ven-correo"><summary><b>' + esc(x.titulo) + "</b>" + (x.propio ? ' <span class="xml-tenue">· editado</span>' : "") + "</summary>" +
                    '<label class="ven-campo"><span>Asunto</span><input type="text" class="ui-input" maxlength="150" data-asunto="' + esc(x.clave) + '" value="' + esc(x.asunto) + '"></label>' +
                    '<label class="ven-campo"><span>Texto</span><textarea class="ui-input" rows="7" maxlength="4000" data-cuerpo="' + esc(x.clave) + '">' + esc(x.cuerpo) + "</textarea></label>" +
                    '<div class="plz-acciones"><button type="button" class="ui-btn ui-btn--primario ui-btn--32" data-guardar="' + esc(x.clave) + '">Guardar</button>' +
                    '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-prueba="' + esc(x.clave) + '">Enviarme una prueba</button>' +
                    '<span class="plz-msj" id="ven-msj-' + esc(x.clave) + '"></span></div></details>';
            }).join("") + "</div>";
    }

    caja.addEventListener("click", async function (ev) {
        var b = ev.target.closest("button");
        if (!b) return;
        try {
            if (b.dataset.eliminar) {
                var correo = b.dataset.eliminar;
                if (!(await Fiscontable.confirmar({ titulo: "Eliminar cuenta", peligro: true, si: "Eliminar", escribir: correo,
                    texto: "Se eliminan sus empresas, XML, documentos y ajustes, y queda sin acceso. No se puede deshacer." }))) return;
                b.disabled = true;
                await mandar("/api/admin/cuentas-vencidas/eliminar", "POST", { correo: correo });
                await pintar();
                msj("ven-msj-lista", true, "✓ Cuenta eliminada: " + correo);
            } else if (b.id === "ven-guardar-plazos") {
                var v = {};
                caja.querySelectorAll("[data-plazo]").forEach(function (i) { v[i.dataset.plazo] = +i.value; });
                await mandar("/api/admin/cuentas-vencidas/plazos", "PUT", { plazos: v });
                msj("ven-msj-plazos", true, "✓ Guardado.");
            } else if (b.dataset.guardar) {
                var k = b.dataset.guardar;
                await mandar("/api/admin/correos-sistema/" + encodeURIComponent(k), "PUT", {
                    asunto: caja.querySelector('[data-asunto="' + k + '"]').value, cuerpo: caja.querySelector('[data-cuerpo="' + k + '"]').value });
                msj("ven-msj-" + k, true, "✓ Guardado.");
            } else if (b.dataset.prueba) {
                var r = await mandar("/api/admin/correos-sistema/" + encodeURIComponent(b.dataset.prueba) + "/prueba", "POST");
                msj("ven-msj-" + b.dataset.prueba, true, "✓ Enviado a " + r.para + ". Usa el texto guardado.");
            }
        } catch (e) {
            b.disabled = false;
            var id = b.dataset.eliminar ? "ven-msj-lista" : b.id === "ven-guardar-plazos" ? "ven-msj-plazos" : "ven-msj-" + (b.dataset.guardar || b.dataset.prueba);
            msj(id, false, e.message);
        }
    });

    var cargado = false;
    function revisar() {
        var panel = caja.closest("[data-subpanel]");
        if (!cargado && panel && !panel.hidden) { cargado = true; pintar(); }
    }
    new MutationObserver(revisar).observe(caja.closest("[data-subpanel]"), { attributes: true, attributeFilter: ["hidden"] });
    document.addEventListener("DOMContentLoaded", revisar);
})();
