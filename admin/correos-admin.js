/*
 * admin/correos-admin.js — Sistema › Correos (solo admin). GET /api/admin/correos (core/actividad.bitacora_correos).
 * 22-nov-2026 (el dueño: «…que un correo no se manda»): qué correos salieron y cuáles no en los últimos tres días, con lo
 * que contestó el servidor de correo. No trae el cuerpo de ningún correo: a quién, asunto, de qué parte del sistema y cuándo.
 * La campana del administrador avisa cuando uno no sale («No salió un correo de Fiscontable») y abre esta pestaña.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var caja = document.getElementById("correos-admin");
    if (!caja) return;
    var soloFallas = null;                    // null: lo decide la primera carga (si hay fallas, empieza por ellas)
    var NOMBRES = { cuenta: "Cuenta y acceso", despacho: "Despacho", licencia: "Licencias", demo: "Demos", soporte: "Soporte", resumen: "Resumen",
                    informe_empresa: "Informe por empresa", aviso_admin: "Aviso al administrador", traspasos: "Entrega de empresas", entregas: "Envíos",
                    facturacion: "Facturar", directo: "Facturas, envíos y enlaces", prueba: "Correo de prueba", cotizacion: "Cotización",
                    declaraciones: "Declaraciones", isn: "Acuses", xml_cliente: "XML al cliente", csf: "Constancia", opinion: "Opinión" };

    function parte(modulo) {
        var m = String(modulo || "");
        if (m.indexOf("aviso:") === 0) return "Aviso de la campana";
        if (m.indexOf("boletin_") === 0) return "Correo por tema";
        if (m.indexOf("cliente:") === 0) return "Documento al cliente";
        return NOMBRES[m] || m || "—";
    }
    function cuando(t) {                      // la base guarda en UTC; se enseña en hora del centro de México
        var d = new Date(String(t || "").slice(0, 19) + "Z");
        if (isNaN(d)) return "—";
        return d.toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
    }

    async function pintar() {
        caja.innerHTML = '<span class="ui-skel" style="width:60%"></span>';
        var d;
        try {
            var r = await fetch(API + "/api/admin/correos?limite=100&horas=72" + (soloFallas ? "&solo_fallas=true" : ""), { credentials: "include" });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            d = await r.json();
        } catch (e) { caja.innerHTML = '<p class="ui-aviso ui-aviso--error">' + esc(e.message) + "</p>"; return; }
        if (soloFallas === null && d.fallas) { soloFallas = true; return pintar(); }
        if (soloFallas === null) soloFallas = false;
        var filas = d.correos || [];
        var resumen = "En los últimos 3 días salieron <b>" + (d.total - d.fallas).toLocaleString("es-MX") + "</b> correo(s)" +
            (d.fallas ? ' y <b class="cor-mal">' + d.fallas.toLocaleString("es-MX") + " no salieron</b>" : " y ninguno falló") + "." +
            (d.en_espera ? " Hay " + d.en_espera + " aviso(s) en espera: salen cuando abra el horario o se reintentan cada hora." : "");
        caja.innerHTML =
            '<div class="ui-tarjeta">' +
            '<div class="cor-cabeza"><h3 class="plz-titulo">Correos</h3>' +
            '<span class="cor-estado ' + (d.configurado ? "cor-estado--bien" : "cor-estado--mal") + '">' +
            (d.configurado ? "Correo general configurado" : "El correo general no está configurado") + "</span>" +
            '<label class="cor-filtro"><input type="checkbox" id="cor-solo"' + (soloFallas ? " checked" : "") + "> Solo los que no salieron</label>" +
            '<button type="button" class="ui-btn ui-btn--32" id="cor-actualizar">Actualizar</button></div>' +
            '<p class="xml-tenue plz-nota">' + resumen + " No se guarda el texto de ningún correo.</p>" +
            (filas.length ? '<div class="cor-lista"><table class="ui-tabla"><colgroup><col class="cor-c1"><col class="cor-c2"><col><col><col class="cor-c5"></colgroup>' +
                "<thead><tr><th>Cuándo</th><th>Resultado</th><th>Para</th><th>Asunto</th><th>De</th></tr></thead><tbody>" +
                filas.map(function (x) {
                    return '<tr' + (x.ok ? "" : ' class="cor-con-motivo"') + '><td class="cor-nw">' + esc(cuando(x.momento)) + "</td><td>" +
                        (x.ok ? '<span class="cor-bien">Salió</span>' : '<span class="cor-mal">No salió</span>') + "</td><td>" + esc(x.para || "—") + "</td><td>" +
                        esc(x.asunto || "—") + "</td><td>" + esc(parte(x.modulo)) + "</td></tr>" +
                        (x.ok ? "" : '<tr class="cor-motivo"><td></td><td colspan="4">' + esc(x.error || "El servidor de correo no dio el motivo.") + "</td></tr>");
                }).join("") + "</tbody></table></div>" +
                (filas.length >= 100 ? '<p class="xml-tenue plz-nota">Se muestran los 100 más recientes.</p>' : "")
                : '<p class="xml-tenue">' + (soloFallas ? "Ningún correo ha fallado en los últimos 3 días." : "Todavía no ha salido ningún correo.") + "</p>") +
            "</div>";
        document.getElementById("cor-solo").addEventListener("change", function () { soloFallas = this.checked; pintar(); });
        document.getElementById("cor-actualizar").addEventListener("click", pintar);
    }

    // Se carga al abrir la subpestaña (no al entrar a Administración)
    var boton = document.querySelector('#sub-sistema [data-sub="correos"]');
    if (boton) boton.addEventListener("click", pintar);
    var panel = document.querySelector('#panel-sistema [data-subpanel="correos"]');
    if (panel && !panel.hidden) pintar();
    window.FiscontableCorreosAdmin = { pintar: pintar };
})();
