/*
 * admin/errores-servidor-admin.js — Sistema › Errores del servidor (solo admin). GET /api/admin/errores-servidor
 * (backend: core/error_500.py). 23-nov-2026 (el dueño: «me sale que el servidor no pudo… ¿cómo puedes saber qué pasó?»):
 * cada error inesperado queda con un código corto (E-7F3A) que la persona ve en el mensaje y puede dictar; aquí se ve
 * cuándo, quién, en qué parte, el mensaje y la traza (plegada). Se busca por código. La campana del administrador avisa la
 * primera vez de cada error en la hora y abre esta pestaña con el código ya buscado (/admin/?error=E-7F3A#errores-servidor).
 * Mismo patrón que admin/correos-admin.js.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var caja = document.getElementById("errores-servidor-admin");
    if (!caja) return;
    var buscado = "";
    try { buscado = new URLSearchParams(location.search).get("error") || ""; } catch (e) { /* sin parámetros */ }

    function cuando(t) {                      // la base guarda en UTC; se enseña en hora del centro de México
        var d = new Date(String(t || "").slice(0, 19) + "Z");
        if (isNaN(d)) return "—";
        return d.toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
    }
    function tipoCorto(t) { return String(t || "Error").split(".").pop(); }

    async function pintar() {
        caja.innerHTML = '<span class="ui-skel" style="width:60%"></span>';
        var d;
        try {
            var r = await fetch(API + "/api/admin/errores-servidor?limite=200" + (buscado ? "&codigo=" + encodeURIComponent(buscado) : ""), { credentials: "include" });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            d = await r.json();
        } catch (e) { caja.innerHTML = '<p class="ui-aviso ui-aviso--error">' + esc(e.message) + "</p>"; return; }
        var filas = d.errores || [];
        var resumen = d.ultimas_24h ? "En las últimas 24 horas hubo <b class=\"ers-mal\">" + d.ultimas_24h.toLocaleString("es-MX") + "</b> error(es)."
            : "En las últimas 24 horas no hubo ningún error.";
        resumen += " Se guardan los últimos " + d.tope + " (hasta " + d.dias + " días); RFC, correos y contraseñas se tapan.";
        caja.innerHTML =
            '<div class="ui-tarjeta">' +
            '<div class="ers-cabeza"><h3 class="plz-titulo">Errores del servidor</h3>' +
            '<form class="ers-buscar" id="ers-buscar" role="search"><label class="sr-only" for="ers-codigo">Buscar por código</label>' +
            '<input class="ui-input ers-codigo" id="ers-codigo" autocomplete="off" spellcheck="false" maxlength="8" placeholder="p. ej. E-7F3A" value="' + esc(buscado) + '">' +
            '<button type="submit" class="ui-btn ui-btn--32">Buscar</button>' +
            (buscado ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" id="ers-todos">Ver todos</button>' : "") + "</form>" +
            '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" id="ers-actualizar">Actualizar</button></div>' +
            '<p class="xml-tenue plz-nota">' + resumen + " La persona ve el código en el mensaje y lo puede dictar o mandarlo con «Informar un error».</p>" +
            (filas.length ? '<div class="ers-lista"><table class="ui-tabla"><colgroup><col class="ers-c1"><col class="ers-c2"><col class="ers-c3"><col class="ers-c4"><col></colgroup>' +
                "<thead><tr><th>Cuándo</th><th>Código</th><th>Quién</th><th>Dónde</th><th>Qué pasó</th></tr></thead><tbody>" +
                filas.map(function (x) {
                    var donde = (x.modulo ? "<b>" + esc(x.modulo) + "</b><br>" : "") + '<span class="ers-ruta">' + esc((x.metodo || "") + " " + (x.ruta || "")) + "</span>" +
                        (x.pantalla ? '<br><span class="xml-tenue">desde ' + esc(x.pantalla) + "</span>" : "");
                    var quien = x.persona ? esc(x.persona) + (x.cuenta && x.cuenta !== "su cuenta" ? '<br><span class="xml-tenue">' + esc(x.cuenta) + "</span>" : "") : '<span class="xml-tenue">Sin sesión</span>';
                    return '<tr data-ers="' + esc(x.codigo) + '"><td class="ers-nw" data-l="Cuándo">' + esc(cuando(x.momento)) + '</td><td class="ers-nw" data-l="Código"><b class="ers-cod">' + esc(x.codigo) + '</b></td><td data-l="Quién">' + quien +
                        '</td><td data-l="Dónde">' + donde + '</td><td data-l="Qué pasó"><span class="ers-mal">' + esc(tipoCorto(x.tipo)) + "</span>" + (x.mensaje ? ": " + esc(x.mensaje) : "") +
                        (x.traza ? '<details class="ers-traza"><summary>Ver la traza</summary><pre>' + esc(x.traza) + "</pre></details>" : "") + "</td></tr>";
                }).join("") + "</tbody></table></div>" +
                (filas.length >= 200 ? '<p class="xml-tenue plz-nota">Se muestran los 200 más recientes. Busca por código para ver uno en particular.</p>' : "")
                : '<p class="xml-tenue ers-vacio">' + (buscado ? "No hay ningún error con el código <b>" + esc(buscado) + "</b>. Revisa que esté bien escrito (son una E y cuatro letras o números) o que no tenga más de " + d.dias + " días."
                    : "Ningún error del servidor guardado. Cuando algo falle, aparece aquí con su código.") + "</p>") +
            "</div>";
        document.getElementById("ers-buscar").addEventListener("submit", function (e) {
            e.preventDefault(); buscado = document.getElementById("ers-codigo").value.trim(); pintar();
        });
        var todos = document.getElementById("ers-todos");
        if (todos) todos.addEventListener("click", function () { buscado = ""; pintar(); });
        document.getElementById("ers-actualizar").addEventListener("click", pintar);
        if (buscado && filas.length === 1) { var t = caja.querySelector(".ers-traza"); if (t) t.open = true; }
    }

    // Se carga al abrir la subpestaña (no al entrar a Administración)
    var boton = document.querySelector('#sub-sistema [data-sub="errores-servidor"]');
    if (boton) boton.addEventListener("click", pintar);
    var panel = document.querySelector('#panel-sistema [data-subpanel="errores-servidor"]');
    if (panel && !panel.hidden) pintar();
    window.FiscontableErroresServidor = { pintar: pintar, buscar: function (c) { buscado = c || ""; pintar(); } };
})();
