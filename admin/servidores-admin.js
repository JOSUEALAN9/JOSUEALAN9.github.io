/*
 * admin/servidores-admin.js — Sistema › Estado › tarjeta «Servidores» (solo admin). 20-nov-2026, Alan: «lo nuevo en un solo lugar».
 *   Quién atiende ahora (la Vostro, la VPS en solo lectura o la VPS trabajando), la última copia a la VPS, la versión del
 *   código de las dos máquinas, la corriente de la Vostro, la llave del relevo y los dos interruptores (solo de lectura, con
 *   enlace a Tareas automáticas, donde se cambian). Un solo botón: «Copiar ahora a la VPS» (con tu PIN).
 *   Se carga aparte de las demás tarjetas (/api/admin/sistema/servidores, sin ssh): si tarda o falla, no detiene la pantalla.
 */
(function () {
    "use strict";
    var caja = document.getElementById("tarjeta-servidores");
    if (!caja) return;
    var API = Fiscontable.API, esc = Fiscontable.escapar, ZONA = "America/Mexico_City";

    function horaCentro(iso) {
        if (!iso) return "";
        var s = String(iso);
        if (!/[zZ]|[+-]\d\d:\d\d$/.test(s)) s += "Z";            // lo que viene sin zona es UTC (la marca de la copia)
        var d = new Date(s);
        if (isNaN(d)) return "";
        return d.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: ZONA });
    }
    function chip(texto, tono) { return '<span class="srv-chip srv-chip--' + (tono || "gris") + '">' + esc(texto) + "</span>"; }
    function fila(etiqueta, valor, nota) {
        return '<div class="srv-fila"><dt>' + esc(etiqueta) + "</dt><dd>" + valor + (nota ? '<small>' + nota + "</small>" : "") + "</dd></div>";
    }

    function pintar(s) {
        var a = s.atiende || {}, c = s.copia || {}, v = s.version || {}, luz = s.corriente || {}, ll = s.llave || {}, i = s.interruptores || {};
        var tonoAtiende = a.clave === "vostro" ? "ok" : a.clave === "vps_trabaja" ? "azul" : "aviso";
        var copia = c.error ? chip("No se pudo leer", "mal")
            : !c.instalado ? chip("Sin copias automáticas", "aviso")
            : c.copiando ? chip("Copiando ahora…", "azul")
            : c.ultima_ok ? esc(horaCentro(c.ultima_ok)) + " " + (c.fallos ? chip("La última falló", "mal") : chip("Salió bien", "ok"))
            : chip("Todavía sin copias", "aviso");
        var notaCopia = c.fallos ? esc(c.fallos + " intento(s) fallido(s): " + (c.ultimo_error || "")) : (c.nota ? esc(c.nota) : "Hora del centro");
        var version = (v.vostro ? 'Vostro <code>' + esc(v.vostro) + "</code>" : "Vostro: sin revisar") + " · " +
            (v.vps ? 'VPS <code>' + esc(v.vps) + "</code>" : "VPS: sin revisar") + " " +
            (v.coinciden === true ? chip("Coinciden", "ok") : v.coinciden === false ? chip("Distintas", "aviso") : chip("Sin revisar", "gris"));
        var notaVersion = v.aviso ? "⚠ " + esc(v.aviso) : v.vps_desde ? "La de la VPS es la de la última copia (" + esc(horaCentro(v.vps_desde)) + ")." :
            "La de la VPS se sabe con la siguiente copia.";
        var corriente = luz.estado === "sin_datos" ? chip("Sin datos", "gris") : (luz.alerta ? chip("Atención", "mal") : chip("Bien", "ok"));
        var llave = (ll.relevo ? chip("Relevo prendido", "ok") : chip("Relevo apagado", "gris")) + " " +
            (ll.estado === "ok" ? chip("Vigilante: bien", "ok") : ll.estado === "sin_configurar" ? chip("Vigilante sin configurar", "gris") : chip("Vigilante: no pudo revisar", "mal"));
        var notaLlave = (ll.ultima_lectura ? "Última lectura de la llave: " + esc(horaCentro(ll.ultima_lectura.momento || ll.ultima_lectura)) +
            (ll.ultima_lectura.nivel ? " (" + esc(ll.ultima_lectura.nivel) + ")" : "") : "Sin lecturas de la llave registradas.") +
            (ll.urgentes_7d ? " · <b>" + esc(ll.urgentes_7d) + " URGENTE(S) en 7 días</b>" : "");
        var sw = function (prendido, nombre) { return '<span class="srv-sw' + (prendido ? " srv-sw--on" : "") + '" aria-label="' + esc(nombre + ": " + (prendido ? "prendido" : "apagado")) + '"><i></i>' + esc(nombre) + "</span>"; };
        var u = s.ultimo_trabajo || {};
        caja.innerHTML = '<div class="srv-cabeza"><p class="srv-titulo">Servidores</p>' +
            '<button type="button" class="srv-btn" id="srv-copiar"' + (c.copiando || a.clave !== "vostro" ? " disabled" : "") + ">Copiar ahora a la VPS</button></div>" +
            '<dl class="srv-lista">' +
            fila("Quién atiende ahora", chip(a.texto || "—", tonoAtiende)) +
            fila("Última copia a la VPS", copia, notaCopia) +
            fila("Versión del código", version, notaVersion) +
            fila("Corriente de la Vostro", corriente, esc(luz.texto || "")) +
            fila("Llave del relevo", llave, notaLlave) +
            fila("Interruptores", sw(i.relevo, "Relevo de la VPS") + sw(i.vps_trabaja, "La VPS trabaja cuando la Vostro cae"),
                 '<a href="#" id="srv-a-tareas">Se cambian en Tareas automáticas</a>' +
                 (u.noche ? " · Lo último que hizo la VPS: " + esc((u.resumen || "").replace(/^Lo que hizo la VPS con la Vostro caída /, "")) : "")) +
            '</dl><p class="srv-msj" id="srv-msj" role="status"></p>';
        document.getElementById("srv-a-tareas").addEventListener("click", function (ev) {
            ev.preventDefault();
            var b = document.querySelector('#sub-sistema [data-sub="tareas"]');
            if (b) b.click();
            setTimeout(function () { var x = document.querySelector("[data-vps-trabaja]"); if (x) x.scrollIntoView({ block: "center" }); }, 600);
        });
        document.getElementById("srv-copiar").addEventListener("click", async function (ev) {
            var b = ev.currentTarget, m = document.getElementById("srv-msj");
            b.disabled = true;
            try {
                var hecho = await Fiscontable.confirmarIdentidad("copiar_vps", async function (conf) {
                    var r = await fetch(API + "/api/admin/sistema/servidores/copiar", { method: "POST", credentials: "include",
                        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmacion: conf }) });
                    if (!r.ok) throw new Error(await Fiscontable.leerError(r));
                    var d = await r.json();
                    m.textContent = "✓ " + d.mensaje; m.className = "srv-msj srv-msj--ok";
                    return d;
                }, { titulo: "Copiar ahora a la VPS", boton: "Copiar ahora",
                     resumen: "<p>Manda ya a la VPS la copia de la base, los documentos y el código (la misma de cada 5 a 10 minutos).</p>" });
                if (hecho) setTimeout(cargar, 5000);
            } catch (e) { m.textContent = e.message; m.className = "srv-msj srv-msj--mal"; }
            b.disabled = false;
        });
    }

    async function cargar() {
        if (!caja.firstChild) caja.innerHTML = '<p class="srv-titulo">Servidores</p><p class="srv-nota">Sin revisar todavía…</p>';
        var listo = false;
        var reloj = setTimeout(function () { if (!listo) caja.querySelector(".srv-nota") && (caja.querySelector(".srv-nota").textContent = "Sin revisar (el servidor tarda en contestar)."); }, 4000);
        try {
            var r = await fetch(API + "/api/admin/sistema/servidores", { credentials: "include" });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            pintar(await r.json());
        } catch (e) {
            caja.innerHTML = '<p class="srv-titulo">Servidores</p><p class="srv-nota srv-nota--mal">Sin revisar: ' + esc(e.message) + "</p>";
        } finally { listo = true; clearTimeout(reloj); }
    }

    // admin.js avisa cada vez que carga Sistema (al abrir la pestaña y con «Actualizar»)
    window.addEventListener("fiscontable:sistema", cargar);
    if (document.getElementById("panel-sistema") && !document.getElementById("panel-sistema").hidden) cargar();
})();
