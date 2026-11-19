/**
 * autorizacion-efirma.js — La casilla «Confirmo que el titular de esta empresa me autorizó…» (19-nov-2026, Alan: sin
 * contrato aparte, con un texto amable).
 *
 * Va donde se registra una empresa con su e.firma, sus sellos o su contraseña del SAT, y donde se sube la e.firma de un
 * cliente (Clientes, Facturar, Constancias, Opinión, Declaraciones y Descarga masiva). El servidor guarda la constancia
 * (quién, cuándo, empresa, versión del texto, IP; core/legales.py) y no guarda credenciales sin ella (contesta 428).
 * Una empresa ya confirmada no la vuelve a pedir: la casilla se esconde sola.
 *
 *   var aut = FcAutorizacion.montar(contenedor, { rfc: "AAA010101AAA" });   // pinta la casilla (o nada, si ya está)
 *   aut.rfc("BBB020202BB2");        // otra empresa: vuelve a preguntar al servidor
 *   if (!aut.exigir()) return;      // sin marcar: la resalta y dice por qué
 *   cuerpo.append("autorizo", aut.valor());
 *
 *   FcAutorizacion.pedir({ rfc, nombre, origen })   // el aviso amable, una sola vez, para una empresa que ya tenía
 *                                                   // credenciales; Promise<boolean>
 *   FcAutorizacion.explicar()                       // «¿Qué hace Fiscontable con ellos?»
 */
(function () {
    "use strict";
    if (window.FcAutorizacion) return;

    var TEXTO = "Confirmo que el titular de esta empresa me autorizó a usar su e.firma y su contraseña del SAT para estos trámites.";
    var QUE_HACE = [
        "Se usan solo para lo que tú configures: descargar y revisar facturas, constancias, opiniones y declaraciones, y revisar el Buzón Tributario sin abrir notificaciones.",
        "Timbrar, cancelar o enviar algo al SAT, solo cuando tú lo pides y lo confirmas.",
        "Se guardan cifradas y puedes quitarlas cuando quieras desde la ficha de la empresa."
    ];
    var F = window.Fiscontable || {};
    var API = F.API || "";
    var esc = F.escapar || function (t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
    var cache = {};

    function estilos() {
        if (document.getElementById("fc-autoriza-css")) return;
        var s = document.createElement("style");
        s.id = "fc-autoriza-css";
        s.textContent =
            ".fc-autoriza{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:1px solid var(--linea,#e5e7eb);border-radius:12px;background:var(--papel,#f8fafc);min-width:0}" +
            ".fc-autoriza[hidden]{display:none!important}" +
            ".fc-autoriza__fila{display:flex;align-items:flex-start;gap:10px;font-size:13.5px;line-height:1.45;color:var(--texto,#111827);cursor:pointer;font-weight:500;text-transform:none;letter-spacing:0}" +
            ".fc-autoriza__fila input{flex:none;width:18px!important;height:18px;margin:1px 0 0!important;padding:0!important;accent-color:rgb(var(--ac-600,37 99 235));cursor:pointer}" +
            ".fc-autoriza__que{align-self:flex-start;margin-left:28px;border:0;background:none;padding:0;font:inherit;font-size:12.5px;font-weight:700;color:rgb(var(--ac-700,29 78 216));text-decoration:underline;cursor:pointer}" +
            ".fc-autoriza--falta{border-color:rgb(var(--er-600,185 28 28));background:rgb(var(--er-50,254 242 242))}" +
            ".fc-autoriza__error{margin-left:28px;font-size:12.5px;font-weight:600;color:rgb(var(--er-600,185 28 28))}" +
            ".fc-autoriza-dlg .fc-modal__cuerpo p{font-size:14px;line-height:1.5;color:var(--texto)}" +
            ".fc-autoriza-dlg ul{margin:0;padding-left:20px;list-style:disc;display:grid;gap:8px;font-size:14px;line-height:1.5;color:var(--texto)}" +
            ".fc-autoriza-dlg .fc-autoriza{background:none;border:0;padding:0}";
        document.head.appendChild(s);
    }

    function casilla() {
        estilos();
        return '<div class="fc-autoriza" data-autoriza-caja>' +
            '<label class="fc-autoriza__fila"><input type="checkbox" data-autoriza><span>' + esc(TEXTO) + "</span></label>" +
            '<button type="button" class="fc-autoriza__que" data-autoriza-que>¿Qué hace Fiscontable con ellos?</button>' +
            '<span class="fc-autoriza__error" data-autoriza-error hidden>Marca la casilla para seguir: así queda constancia de que el titular te autorizó.</span>' +
            "</div>";
    }

    function dialogo(html, clase) {
        estilos();
        var dlg = document.createElement("dialog");
        dlg.className = "fc-modal fc-modal--chica fc-autoriza-dlg" + (clase ? " " + clase : "");
        dlg.innerHTML = html;
        document.body.appendChild(dlg);
        dlg.addEventListener("close", function () { setTimeout(function () { dlg.remove(); }, 0); });
        dlg.showModal();
        return dlg;
    }

    function explicar() {
        var dlg = dialogo('<div class="fc-modal__cabeza"><div><h2>¿Qué hace Fiscontable con ellos?</h2>' +
            "<p>Con la e.firma, los sellos y la contraseña del SAT de tus clientes.</p></div>" +
            '<button type="button" class="fc-modal__cerrar" data-x aria-label="Cerrar">✕</button></div>' +
            '<div class="fc-modal__cuerpo"><ul>' + QUE_HACE.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul></div>" +
            '<div class="fc-modal__pie"><span></span><button type="button" class="ui-btn ui-btn--primario ui-btn--36" data-x>Entendido</button></div>', "fc-autoriza-que");
        dlg.querySelectorAll("[data-x]").forEach(function (b) { b.addEventListener("click", function () { dlg.close(); }); });
    }

    // Un solo escucha para todas las casillas de la página (también las que se pintan después)
    document.addEventListener("click", function (ev) {
        var b = ev.target.closest && ev.target.closest("[data-autoriza-que]");
        if (b) { ev.preventDefault(); explicar(); }
    });
    document.addEventListener("change", function (ev) {
        if (!ev.target.matches || !ev.target.matches("[data-autoriza]") || !ev.target.checked) return;
        var caja = ev.target.closest("[data-autoriza-caja]");
        if (caja) { caja.classList.remove("fc-autoriza--falta"); var e = caja.querySelector("[data-autoriza-error]"); if (e) e.hidden = true; }
    });

    async function estado(rfc) {
        rfc = String(rfc || "").trim().toUpperCase();
        if (!rfc) return { autorizada: false };
        if (cache[rfc] && cache[rfc].autorizada) return cache[rfc];
        try {
            var r = await fetch(API + "/api/clientes/" + encodeURIComponent(rfc) + "/autorizacion", { credentials: "include" });
            cache[rfc] = r.ok ? await r.json() : { autorizada: false };
        } catch (e) { cache[rfc] = { autorizada: false }; }
        return cache[rfc];
    }

    function montar(contenedor, op) {
        op = op || {};
        var caja = typeof contenedor === "string" ? document.getElementById(contenedor) : contenedor;
        if (!caja) return null;
        caja.innerHTML = casilla();
        var marco = caja.querySelector("[data-autoriza-caja]");
        var yaEsta = false, actual = "";
        var obj = {
            rfc: async function (rfc) {
                actual = String(rfc || "").trim().toUpperCase();
                yaEsta = false; marco.hidden = false;
                if (!actual || op.siempre) return obj;
                var e = await estado(actual);
                if (actual === String(rfc || "").trim().toUpperCase()) { yaEsta = !!e.autorizada; marco.hidden = yaEsta; }
                return obj;
            },
            marcada: function () { return yaEsta || !!caja.querySelector("[data-autoriza]").checked; },
            valor: function () { return obj.marcada() ? "true" : "false"; },
            exigir: function () {
                if (obj.marcada()) return true;
                marco.hidden = false;
                marco.classList.add("fc-autoriza--falta");
                marco.querySelector("[data-autoriza-error]").hidden = false;
                try { marco.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) { /* nada */ }
                caja.querySelector("[data-autoriza]").focus();
                return false;
            },
            limpiar: function () { caja.querySelector("[data-autoriza]").checked = false; marco.classList.remove("fc-autoriza--falta"); marco.querySelector("[data-autoriza-error]").hidden = true; },
            confirmada: function () { if (actual) cache[actual] = { autorizada: true }; yaEsta = true; marco.hidden = true; },
            mostrar: function (si) { marco.hidden = !si || yaEsta; },
            caja: marco
        };
        if (op.rfc) obj.rfc(op.rfc);
        return obj;
    }

    /* El aviso amable (una sola vez por empresa) para las que ya tenían credenciales guardadas antes de la casilla. */
    function pedir(op) {
        op = op || {};
        return new Promise(function (listo) {
            var nombre = op.nombre || op.rfc || "esta empresa";
            var dlg = dialogo('<div class="fc-modal__cabeza"><div><h2>Una confirmación rápida</h2>' +
                "<p>" + esc(nombre) + (op.nombre && op.rfc ? " · " + esc(op.rfc) : "") + "</p></div>" +
                '<button type="button" class="fc-modal__cerrar" data-no aria-label="Cerrar">✕</button></div>' +
                '<div class="fc-modal__cuerpo"><p>Ahora pedimos confirmar, una sola vez por empresa, que su titular te autorizó a usar sus datos de acceso al SAT. ' +
                "Todo sigue funcionando igual; solo queda la constancia.</p>" + casilla() +
                '<p class="ui-ayuda ui-ayuda--error" data-err hidden></p></div>' +
                '<div class="fc-modal__pie"><button type="button" class="ui-btn ui-btn--terciario ui-btn--36" data-no>Ahora no</button>' +
                '<button type="button" class="ui-btn ui-btn--primario ui-btn--36" data-si>Confirmar</button></div>');
            var hecho = false;
            dlg.querySelectorAll("[data-no]").forEach(function (b) { b.addEventListener("click", function () { dlg.close(); }); });
            dlg.addEventListener("close", function () { if (!hecho) listo(false); });
            dlg.querySelector("[data-si]").addEventListener("click", async function () {
                var b = this, err = dlg.querySelector("[data-err]");
                var marco = dlg.querySelector("[data-autoriza-caja]");
                if (!dlg.querySelector("[data-autoriza]").checked) {
                    marco.classList.add("fc-autoriza--falta"); marco.querySelector("[data-autoriza-error]").hidden = false; return;
                }
                b.disabled = true; err.hidden = true;
                try {
                    var r = await fetch(API + "/api/clientes/" + encodeURIComponent(op.rfc) + "/autorizacion", {
                        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ autorizo: true, origen: op.origen || "web" })
                    });
                    if (!r.ok) throw new Error(F.leerError ? await F.leerError(r) : "No se pudo guardar.");
                    cache[String(op.rfc).toUpperCase()] = await r.json();
                    hecho = true; dlg.close(); listo(true);
                } catch (e) { err.textContent = e.message || "No se pudo guardar. Intenta de nuevo."; err.hidden = false; b.disabled = false; }
            });
        });
    }

    /* El aviso dentro de una página (no una ventana): una franja amable con la casilla y «Confirmar». */
    function franja(contenedor, op) {
        op = op || {};
        var caja = typeof contenedor === "string" ? document.getElementById(contenedor) : contenedor;
        if (!caja) return;
        estilos();
        caja.innerHTML = '<div class="fc-autoriza fc-autoriza--franja" data-franja>' +
            '<b style="font-size:13.5px">Una confirmación rápida sobre ' + esc(op.nombre || op.rfc) + "</b>" +
            '<span style="font-size:13px;color:var(--texto-tenue)">Ahora pedimos confirmar, una sola vez por empresa, que su titular te autorizó a usar sus datos de acceso al SAT. Todo sigue funcionando igual.</span>' +
            casilla().replace('class="fc-autoriza"', 'class="fc-autoriza" style="padding:0;border:0;background:none"') +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button type="button" class="ui-btn ui-btn--primario ui-btn--32" data-franja-si>Confirmar</button>' +
            '<span class="ui-ayuda ui-ayuda--error" data-franja-err hidden></span></div></div>';
        caja.hidden = false;
        caja.querySelector("[data-franja-si]").addEventListener("click", async function () {
            var b = this, err = caja.querySelector("[data-franja-err]"), marco = caja.querySelector("[data-autoriza-caja]");
            if (!caja.querySelector("[data-autoriza]").checked) { marco.classList.add("fc-autoriza--falta"); marco.querySelector("[data-autoriza-error]").hidden = false; return; }
            b.disabled = true; err.hidden = true;
            try {
                var r = await fetch(API + "/api/clientes/" + encodeURIComponent(op.rfc) + "/autorizacion", {
                    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ autorizo: true, origen: op.origen || "web" })
                });
                if (!r.ok) throw new Error(F.leerError ? await F.leerError(r) : "No se pudo guardar.");
                cache[String(op.rfc).toUpperCase()] = await r.json();
                caja.innerHTML = ""; caja.hidden = true;
                if (op.alConfirmar) op.alConfirmar();
            } catch (e) { err.textContent = e.message || "No se pudo guardar."; err.hidden = false; b.disabled = false; }
        });
    }

    window.FcAutorizacion = { TEXTO: TEXTO, QUE_HACE: QUE_HACE, casilla: casilla, montar: montar, pedir: pedir, franja: franja, explicar: explicar, estado: estado };
})();
