/*
 * admin/tareas-admin.js — Sistema › Tareas automáticas (solo admin). 19-nov-2026, huecos 2 y 3 del INVENTARIO.
 *   · Madrugada: la noche que viene (si lo del día cabe y desde qué hora), cuántos trámites a la vez en la Vostro y la
 *     VPS, y «Reintentar lo que no salió» de todas las cuentas (modulos/programadas/motor.py).
 *   · Tareas automáticas: cada tarea del reloj del servidor con su última corrida, cuánto tardó, si salió, su próximo
 *     horario y «Correr ahora» (core/programador.py). Incluye la vigilancia del respaldo a la VPS.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var caja = document.getElementById("tareas-admin");
    if (!caja) return;

    async function api(ruta, op) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, op || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function mandar(ruta, metodo, cuerpo) { return api(ruta, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo || {}) }); }
    function msj(id, ok, texto) { var m = document.getElementById(id); if (m) { m.textContent = texto; m.className = "tar-msj " + (ok ? "tar-msj--ok" : "tar-msj--mal"); } }
    // Todo en hora del centro (la de las tareas), aunque la computadora esté en otra zona
    var ZONA = "America/Mexico_City";
    var diaDe = function (d) { return d.toLocaleDateString("en-CA", { timeZone: ZONA }); };
    var cuando = function (iso) {
        if (!iso) return "—";
        var d = new Date(iso), hoy = new Date(), un = 864e5;
        var h = d.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit", timeZone: ZONA });
        if (diaDe(d) === diaDe(hoy)) return "hoy " + h;
        if (diaDe(d) === diaDe(new Date(hoy - un))) return "ayer " + h;
        if (diaDe(d) === diaDe(new Date(+hoy + un))) return "mañana " + h;
        return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: ZONA }) + " " + h;
    };
    // Las tareas en tres grupos (la lista completa no cabe en una pantalla): de madrugada, durante el día y cada hora
    var GRUPOS = [["noche", "Tareas de madrugada"], ["dia", "Durante el día"], ["hora", "Cada hora"]];
    var grupoDe = function (x) { return x.horas.length >= 12 ? "hora" : x.horas.every(function (h) { return h <= 6; }) ? "noche" : "dia"; };
    var grupoActivo = null;
    var tardo = function (s) {
        if (s == null) return "—";
        if (s < 1) return "menos de 1 s";
        if (s < 90) return Math.round(s) + " s";
        if (s < 5400) return Math.round(s / 60) + " min";
        return (s / 3600).toFixed(1) + " h";
    };
    var horas = function (h) { return h >= 1 ? h.toFixed(1).replace(".0", "") + " h" : Math.round(h * 60) + " min"; };

    function tarjetaMadrugada(m) {
        var p = m.proyeccion || {}, c = m.config, ns = m.no_salio || {};
        var del = Object.values(p.del_dia || {}).reduce(function (a, b) { return a + b; }, 0);
        var fondo = Object.values(p.fondo || {}).reduce(function (a, b) { return a + b; }, 0);
        var estado = p.error ? '<p class="tar-aviso tar-aviso--mal">' + esc(p.error) + "</p>"
            : p.cabe ? '<p class="tar-aviso tar-aviso--ok">✓ Lo del día cabe: ' + esc(del) + " trámites, unas " + esc(horas(p.horas_del_dia)) +
                " (con margen), desde las " + esc(p.inicio) + " hasta las " + esc(p.fin) + ".</p>"
            : '<p class="tar-aviso tar-aviso--mal">⚠ Lo del día no cabe: ' + esc(del) + " trámites, unas " + esc(horas(p.horas_del_dia)) +
                ", y desde las " + esc(p.inicio) + " solo hay " + esc(horas(p.horas_disponibles)) + ". Sube los trámites a la vez o usa la VPS.</p>";
        var numero = function (k, titulo, ayuda) {
            var l = m.limites[k] || [0, 9];
            return '<label class="tar-campo"><span>' + esc(titulo) + '</span><input type="number" min="' + l[0] + '" max="' + l[1] + '" data-mad="' + k +
                '" value="' + esc(c[k]) + '"><small>' + esc(ayuda) + " (de fábrica " + esc(m.fabrica[k]) + ")</small></label>";
        };
        var hora = function (k, titulo) {
            return '<label class="tar-campo"><span>' + esc(titulo) + '</span><input type="time" data-mad="' + k + '" value="' + esc(c[k]) + '"><small>De fábrica ' + esc(m.fabrica[k]) + "</small></label>";
        };
        return '<div class="ui-tarjeta tar-bloque" data-vista="madrugada"' + (grupoActivo === "madrugada" ? "" : " hidden") + '><h3 class="tar-titulo">La madrugada</h3>' +
            '<p class="tar-nota">Lo del día (lo de los envíos, lo que piden las cuentas, los XML del día y el Buzón) va primero y debe terminar antes de las ' +
            esc(c.fin) + "; lo que falte sigue de mañana, despacio, hasta las " + esc(c.fin_extendido) + ". El historial y el cuadre de meses viejos se reparten en varias noches.</p>" +
            estado +
            (fondo ? '<p class="tar-nota">Historial y cuadre de esta noche: ' + esc(fondo) + " trámites (unas " + esc(horas(p.horas_fondo || 0)) + ")" +
                (p.fondo_cabe_hoy ? "." : "; lo que no quepa sigue la noche siguiente.") + "</p>" : "") +
            '<div class="tar-reintentar"><div><b>' + (ns.total ? esc(ns.total) + " trámite(s) no salieron" : "Todo salió") + "</b> <small>en la última semana, de todas las cuentas" +
            (ns.de_lotes ? " · " + esc(ns.de_lotes) + " de lotes subidos (hay que volver a subirlos)" : "") + "</small></div>" +
            '<button type="button" class="tar-btn" id="tar-reintentar"' + (ns.total ? "" : " disabled") + ">Reintentar lo que no salió</button></div>" +
            '<span class="tar-msj" id="tar-msj-reintentar"></span>' +
            '<details class="tar-config"><summary>Cuántos a la vez y horario</summary><div class="tar-rejilla">' +
            numero("vostro_portal", "Portal en la Vostro", "Constancia, opinión, declaraciones, Buzón") +
            numero("vostro_ws", "Web service en la Vostro", "e.firmas distintas a la vez; 0 = como antes") +
            numero("vps_portal", "Portal en la VPS", "Otra IP; 0 = no se usa de madrugada") +
            numero("cuadre_por_noche", "Listas del cuadre por noche", "En todo el servidor") +
            hora("inicio", "Inicio") + hora("fin", "Fin") + hora("inicio_minimo", "Lo más temprano si no cabe") + hora("fin_extendido", "Lo del día, de mañana hasta") +
            '</div><div class="tar-acciones"><button type="button" class="tar-btn tar-btn--primario" id="tar-guardar-mad">Guardar</button><span class="tar-msj" id="tar-msj-mad"></span></div>' +
            "</details></div>";
    }

    function tarjetaTareas(t) {
        var fallan = {};
        t.tareas.forEach(function (x) { if (x.fallando_desde || (x.ultima && x.ultima.ok === 0)) fallan[grupoDe(x)] = (fallan[grupoDe(x)] || 0) + 1; });
        var filtro = '<div class="tar-filtro" role="tablist"><button type="button" role="tab" data-grupo="madrugada" aria-selected="' + (grupoActivo === "madrugada") + '"' +
            (grupoActivo === "madrugada" ? ' class="tar-filtro--activo"' : "") + ">La madrugada</button>" + GRUPOS.map(function (g) {
            var n = t.tareas.filter(function (x) { return grupoDe(x) === g[0]; }).length;
            return '<button type="button" role="tab" data-grupo="' + g[0] + '" aria-selected="' + (g[0] === grupoActivo) + '"' + (g[0] === grupoActivo ? ' class="tar-filtro--activo"' : "") + ">" +
                esc(g[1]) + " <small>" + n + "</small>" + (fallan[g[0]] ? '<span class="tar-punto" title="Con falla"></span>' : "") + "</button>";
        }).join("") + "</div>";
        var filas = t.tareas.map(function (x) {
            var u = x.ultima, ok = u ? u.ok === 1 : !x.error;
            var estado = x.corriendo ? '<span class="tar-chip tar-chip--azul">Corriendo</span>'
                : !u && !x.ultima_corrida ? '<span class="tar-chip">Sin correr</span>'
                : ok ? '<span class="tar-chip tar-chip--ok">Salió</span>' : '<span class="tar-chip tar-chip--mal">Falló</span>';
            var detalle = u ? (u.resumen || "") : (x.error || x.resultado || "");
            if (x.fallando_desde) detalle = "Fallando desde " + cuando(x.fallando_desde) + ". " + detalle;
            return '<tr data-tarea="' + esc(x.tarea) + '" data-grupo="' + grupoDe(x) + '"' + (grupoDe(x) === grupoActivo ? "" : " hidden") + '><td data-t="Tarea"><b>' + esc(x.nombre) + "</b>" + (x.aparte ? "<small>en su propio hilo</small>" : "") + "</td>" +
                '<td data-t="Última"' + (u || x.ultima_corrida ? "" : ' class="tar-vacio"') + ">" + esc(cuando(u ? u.inicio : x.ultima_corrida)) + "</td>" +
                '<td data-t="Tardó"' + (u ? "" : ' class="tar-vacio"') + ">" + esc(u ? tardo(u.segundos) : "—") + "</td>" +
                '<td data-t="Resultado">' + estado + '<small class="tar-detalle" title="' + esc(detalle) + '">' + esc(detalle.slice(0, 140)) + "</small></td>" +
                '<td data-t="Próxima">' + esc(cuando(x.proxima)) + "<small>" + esc(x.horas.length === 24 ? "cada hora" : x.horas.length > 6 ? "de " + x.horas[0] + " a " + x.horas[x.horas.length - 1] + " h" : "a las " + x.horas.join(", ") + " h") + "</small></td>" +
                '<td><button type="button" class="tar-btn tar-btn--chico" data-correr' + (x.corriendo ? " disabled" : "") + ">Correr ahora</button></td></tr>";
        }).join("");
        var r = t.respaldo || {};
        var resp = r.error ? esc(r.error) : !r.instalado ? "No está instalado en este equipo (la copia corre con systemd en la Vostro)." :
            "Última copia buena: " + esc(cuando(r.ultima_ok)) + (r.fallos ? " · ⚠ " + esc(r.fallos) + " intento(s) fallido(s): " + esc(r.ultimo_error) : "") +
            (r.automatico ? "" : " · ⚠ la copia automática está apagada");
        var fallando = t.tareas.filter(function (x) { return x.fallando_desde; }).length;
        return { filtro: filtro, tarjeta: '<div class="ui-tarjeta tar-bloque" data-vista="tareas"' + (grupoActivo === "madrugada" ? " hidden" : "") + '><h3 class="tar-titulo">Tareas automáticas</h3>' +
            '<p class="tar-nota">Lo que el servidor hace solo, a su hora (hora del centro). Si una falla, te avisamos en la campana y por correo en tu horario: una vez al día mientras siga fallando y otra cuando se recupere.</p>' +
            (fallando ? '<p class="tar-aviso tar-aviso--mal">⚠ ' + fallando + " tarea(s) fallando ahora.</p>" : "") +
            '<p class="tar-nota"><b>Respaldo a la VPS:</b> ' + resp + "</p>" +
            '<div class="tar-tabla-caja"><table class="tar-tabla"><thead><tr><th>Tarea</th><th>Última</th><th>Tardó</th><th>Resultado</th><th>Próxima</th><th></th></tr></thead><tbody>' +
            filas + '</tbody></table></div><span class="tar-msj" id="tar-msj-correr"></span></div>' };
    }

    async function pintar() {
        caja.innerHTML = '<span class="ui-skel" style="width:60%"></span>';
        var m, t;
        try { m = await api("/api/admin/sistema/madrugada"); t = await api("/api/admin/sistema/tareas"); }
        catch (e) { caja.innerHTML = '<p class="ui-aviso ui-aviso--error">' + esc(e.message) + "</p>"; return; }
        if (!grupoActivo) {                        // abre donde hay algo que ver: una tarea que falla o, si no, la madrugada
            var falla = t.tareas.filter(function (x) { return x.fallando_desde || (x.ultima && x.ultima.ok === 0); })[0];
            grupoActivo = falla ? grupoDe(falla) : "madrugada";
        }
        var tareas = tarjetaTareas(t);
        caja.innerHTML = tareas.filtro + tarjetaMadrugada(m) + tareas.tarjeta;
        var br = document.getElementById("tar-reintentar");
        br.addEventListener("click", async function () {
            if (!confirm("¿Volver a programar lo que no salió en la última semana (de todas las cuentas)? Va en la madrugada que toca.")) return;
            br.disabled = true;
            try { var r = await mandar("/api/admin/sistema/madrugada/reintentar", "POST"); msj("tar-msj-reintentar", true, "✓ " + r.mensaje); }
            catch (e) { msj("tar-msj-reintentar", false, e.message); br.disabled = false; }
        });
        document.getElementById("tar-guardar-mad").addEventListener("click", async function (ev) {
            var b = ev.currentTarget, valores = {};
            caja.querySelectorAll("[data-mad]").forEach(function (i) { valores[i.dataset.mad] = i.type === "number" ? +i.value : i.value; });
            b.disabled = true;
            try { await mandar("/api/admin/sistema/madrugada", "PUT", { valores: valores }); msj("tar-msj-mad", true, "✓ Guardado. Cuenta desde la siguiente vuelta del turno."); }
            catch (e) { msj("tar-msj-mad", false, e.message); }
            b.disabled = false;
        });
        caja.querySelectorAll(".tar-filtro [data-grupo]").forEach(function (b) {
            b.addEventListener("click", function () {
                grupoActivo = b.dataset.grupo;
                caja.querySelectorAll(".tar-filtro [data-grupo]").forEach(function (o) { var si = o === b; o.classList.toggle("tar-filtro--activo", si); o.setAttribute("aria-selected", si); });
                caja.querySelectorAll(".tar-tabla tbody tr").forEach(function (tr) { tr.hidden = tr.dataset.grupo !== grupoActivo; });
                caja.querySelector('[data-vista="madrugada"]').hidden = grupoActivo !== "madrugada";
                caja.querySelector('[data-vista="tareas"]').hidden = grupoActivo === "madrugada";
            });
        });
        caja.querySelectorAll("[data-correr]").forEach(function (b) {
            b.addEventListener("click", async function () {
                var tarea = b.closest("tr").dataset.tarea, nombre = b.closest("tr").querySelector("b").textContent;
                if (!confirm("¿Correr «" + nombre + "» ahora? Hace lo mismo que a su hora.")) return;
                b.disabled = true;
                try {
                    var r = await mandar("/api/admin/sistema/tareas/" + encodeURIComponent(tarea) + "/correr", "POST");
                    msj("tar-msj-correr", true, "✓ " + nombre + ": " + r.mensaje);
                    setTimeout(pintar, 4000);
                } catch (e) { msj("tar-msj-correr", false, nombre + ": " + e.message); b.disabled = false; }
            });
        });
    }

    // Se pinta al abrir la subpestaña (y desde #tareas, el enlace de los avisos)
    var boton = document.querySelector('#sub-sistema [data-sub="tareas"]');
    if (boton) boton.addEventListener("click", pintar);
    if (!document.querySelector('[data-subpanel="tareas"]').hidden) pintar();
    window.addEventListener("fiscontable:tareas-admin", pintar);
})();
