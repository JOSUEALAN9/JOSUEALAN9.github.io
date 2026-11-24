/*
 * admin/tareas-admin.js — Sistema › Tareas automáticas (solo admin). 19-nov-2026, huecos 2 y 3 del INVENTARIO.
 *   · Madrugada: la noche que viene (si lo del día cabe y desde qué hora), cuántos trámites a la vez en la Vostro y la
 *     VPS, y «Reintentar lo que no salió» de todas las cuentas (modulos/programadas/motor.py).
 *   · 19-nov-2026 (el dueño): qué máquina (Vostro o VPS) hizo cada cosa anoche y cuánto tardó cada una; el plan cuenta las
 *     dos máquinas; «Web service en la VPS» y «Usar las PCs con el Agente en la madrugada» (de fábrica apagado).
 *   · 19-nov-2026 (el dueño): «Relevo de la VPS si se cae la Vostro» (de fábrica apagado, hasta que esté el Vault de Oracle) y
 *     el resumen de la última madrugada de relevo que la Vostro importó (core/relevo_vps.py).
 *   · Tareas automáticas: cada tarea del reloj del servidor con su última corrida, cuánto tardó, si salió, su próximo
 *     horario y «Correr ahora» (core/programador.py). Incluye la vigilancia del respaldo a la VPS.
 *   · 20-nov-2026 (el dueño): «Vigilante de la llave del relevo» (core/vigilante_boveda.py): última revisión, lecturas de la
 *     llave en 7 días (normales y urgentes) y estado.
 *   · 20-nov-2026 (el dueño): «La VPS trabaja cuando la Vostro cae» (core/respaldo_trabaja.py), arriba de todo.
 *   · 23-nov-2026 (el dueño: «presionar y [ver] el desglose, si se hizo o no»): la primera pestaña, «Resumen», es «Lo
 *     automático» por día de todas las cuentas (assets/js/comun/automatico.js; modulos/programadas/resumen.py).
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
    var TRAMITE = { xml_webservice: "XML por Web service", xml_portal: "XML del portal", buzon: "Buzón", constancia: "Constancia",
        opinion: "Opinión", declaraciones: "Declaraciones" };
    var hhmm = function (iso) { return iso ? String(iso).slice(11, 16) : "—"; };

    // 19-nov-2026 (el dueño): qué máquina hizo cada cosa anoche y cuánto tardó cada una (motor.resumen_equipos)
    function bloqueAnoche(a, c) {
        if (!a || a.error) return a && a.error ? '<p class="tar-aviso tar-aviso--mal">' + esc(a.error) + "</p>" : "";
        var titulo = a.noche === diaDe(new Date()) ? "Esta madrugada" : "La madrugada del " + esc(a.noche.slice(8, 10) + "/" + a.noche.slice(5, 7));
        if (!a.equipos.length) return '<div class="tar-anoche"><h4 class="tar-sub">' + titulo + '</h4><p class="tar-nota">Todavía no hay trámites de madrugada que mostrar.</p></div>';
        var tarjetas = a.equipos.map(function (e) {
            var tipos = Object.keys(e.por_tipo).map(function (k) {
                var t = e.por_tipo[k];
                return '<span class="tar-chip">' + esc(TRAMITE[k] || k) + " " + esc(t.n) + (t.mediana ? " · " + esc(tardo(t.mediana)) + " c/u" : "") + "</span>";
            }).join(" ");
            var extra = e.equipo === "vps" && a.pasos_ws_vps && a.pasos_ws_vps.n
                ? '<small>Y ' + esc(a.pasos_ws_vps.n) + " paso(s) del Web service (revisar y bajar paquetes) · " + esc(tardo(a.pasos_ws_vps.segundos)) + "</small>" : "";
            return '<div class="tar-equipo" data-equipo="' + esc(e.equipo) + '"><div class="tar-equipo__cabeza"><b>' + esc(e.nombre) + "</b><span>" +
                esc(hhmm(e.inicio)) + " a " + esc(hhmm(e.fin)) + (e.duracion != null ? " · " + esc(tardo(e.duracion)) : "") + "</span></div>" +
                '<p class="tar-equipo__cifras"><b>' + esc(e.tramites) + "</b> trámites · " + esc(e.salieron) + " salieron" +
                (e.no_salieron ? ' · <span class="tar-mal">' + esc(e.no_salieron) + " no</span>" : "") + (e.en_curso ? " · " + esc(e.en_curso) + " en curso" : "") +
                " · " + esc(e.rfcs) + " empresa(s) · trabajo " + esc(tardo(e.segundos)) + "</p>" +
                '<div class="tar-equipo__tipos">' + tipos + "</div>" + extra + "</div>";
        }).join("");
        var vps = a.vps || {}, avisos = "";
        if (vps.caida) avisos += '<p class="tar-aviso tar-aviso--mal">⚠ La VPS dejó de contestar' + (vps.desde ? " a las " + esc(hhmm(vps.desde)) : "") + ": lo suyo lo hizo la Vostro. <small>" + esc(vps.motivo || "") + "</small></p>";
        if (a.n_movidos) avisos += '<p class="tar-nota">' + esc(a.n_movidos) + " empresa(s) pasaron de la VPS a la Vostro: " +
            a.movidos.slice(0, 5).map(function (m) { return "<b>" + esc(m.rfc) + "</b> (" + esc((m.motivo || "").replace(/^VPS: /, "")) + ")"; }).join(", ") + (a.n_movidos > 5 ? "…" : "") + "</p>";
        return '<div class="tar-anoche"><h4 class="tar-sub">' + titulo + ' <small>qué hizo cada máquina · cada empresa en una sola</small></h4><div class="tar-equipos">' + tarjetas + "</div>" + avisos + "</div>";
    }

    // 19-nov-2026 (el dueño): la última madrugada de relevo (la VPS sola con la Vostro caída), ya importada en la Vostro
    function bloqueRelevo(r) {
        var u = (r && r.ultimo) || {};
        if (!u.noche) return "";
        var detalle = String(u.resumen_vps || u.resumen || "").replace(/^Madrugada de relevo del \d\d\/\d\d:\s*/, "");
        return '<p class="tar-nota tar-relevo" data-relevo-ultimo><b>Madrugada de relevo del ' + esc(u.noche.slice(8, 10) + "/" + u.noche.slice(5, 7)) +
            "</b> (la Vostro estuvo caída y la VPS hizo lo del día): " + esc(detalle) + " <small>Importada " + esc(cuando(u.importado_en)) + ".</small></p>";
    }

    function tarjetaMadrugada(m) {
        var p = m.proyeccion || {}, c = m.config, ns = m.no_salio || {};
        var del = Object.values(p.del_dia || {}).reduce(function (a, b) { return a + b; }, 0);
        var fondo = Object.values(p.fondo || {}).reduce(function (a, b) { return a + b; }, 0);
        var estado = p.error ? '<p class="tar-aviso tar-aviso--mal">' + esc(p.error) + "</p>"
            : p.cabe ? '<p class="tar-aviso tar-aviso--ok">✓ Lo del día cabe: ' + esc(del) + " trámites, unas " + esc(horas(p.horas_del_dia)) +
                " (con margen), desde las " + esc(p.inicio) + " hasta las " + esc(p.fin) + ".</p>"
            : '<p class="tar-aviso tar-aviso--mal">⚠ Lo del día no cabe: ' + esc(del) + " trámites, unas " + esc(horas(p.horas_del_dia)) +
                ", y desde las " + esc(p.inicio) + " solo hay " + esc(horas(p.horas_disponibles)) + ". Sube los trámites a la vez o usa la VPS.</p>";
        // El plan cuenta las dos máquinas; si la VPS no contesta, todo en la Vostro (con aviso)
        var cr = p.carriles || {};
        var maquinas = p.error ? "" : !p.vps_configurada ? '<p class="tar-nota">Solo la Vostro: la VPS está en 0 en «Cuántos a la vez».</p>'
            : p.vps ? '<p class="tar-nota">Cuenta con las dos máquinas: la Vostro (' + esc(cr.vostro_portal) + " de portal + " + esc(cr.vostro_ws) +
                " de Web service) y la VPS (" + esc(cr.vps_portal) + " + " + esc(cr.vps_ws) + "). Cada empresa va completa a una de las dos.</p>"
            : '<p class="tar-aviso tar-aviso--mal">⚠ La VPS no contestó: el cálculo es solo con la Vostro (' + esc(cr.vostro_portal) + " de portal + " + esc(cr.vostro_ws) + " de Web service).</p>";
        var numero = function (k, titulo, ayuda) {
            var l = m.limites[k] || [0, 9];
            return '<label class="tar-campo"><span>' + esc(titulo) + '</span><input type="number" min="' + l[0] + '" max="' + l[1] + '" data-mad="' + k +
                '" value="' + esc(c[k]) + '"><small>' + esc(ayuda) + ' <span class="tar-fab">(de fábrica ' + esc(m.fabrica[k]) + ")</span></small></label>";
        };
        var hora = function (k, titulo) {
            return '<label class="tar-campo"><span>' + esc(titulo) + '</span><input type="time" data-mad="' + k + '" value="' + esc(c[k]) + '"><small>De fábrica ' + esc(m.fabrica[k]) + "</small></label>";
        };
        // 19-nov-2026 (el dueño, disyuntor): qué servicio del SAT tiene la fila en pausa y por qué (core/disyuntor)
        var sat = m.sat || {}, pausados = (sat.servicios || []).filter(function (x) { return x.pausado; });
        var satHtml = '<div class="tar-sat">' + (sat.error ? '<p class="tar-aviso tar-aviso--mal">' + esc(sat.error) + "</p>"
            : pausados.length ? pausados.map(function (x) {
                return '<p class="tar-aviso tar-aviso--mal" data-sat-pausa="' + esc(x.servicio) + '">' + esc(x.texto) +
                    (x.por === "revisor" ? " <small>Sigue sola cuando el revisor lo vea bien 3 veces seguidas" + (x.confirmaciones ? " (va " + esc(x.confirmaciones) + " de 3)" : "") + ".</small>"
                        : " <small>Sigue sola: se vuelve a probar " + esc(cuando(x.reanuda_en ? x.reanuda_en.replace(/(Z|[+-]\d\d:\d\d)?$/, "Z") : null)) + ".</small>") + "</p>";
            }).join("") : '<p class="tar-aviso tar-aviso--ok">✓ El SAT responde en todos sus servicios: la fila no está en pausa.</p>') +
            '<p class="tar-nota">' + (sat.revisor_activo ? "Si el revisor del SAT ve caído un servicio, lo de ese servicio espera sin gastar intentos y sigue solo cuando vuelve."
                : "El revisor del SAT está apagado: la fila lleva su propia cuenta (más del 20 % de errores 500, 503, 504 o tiempo agotado pausa ese servicio y se reanuda solo).") + "</p></div>";
        return '<div class="ui-tarjeta tar-bloque" data-vista="madrugada"' + (grupoActivo === "madrugada" ? "" : " hidden") + '><h3 class="tar-titulo">La madrugada</h3>' + satHtml +
            '<p class="tar-nota">Lo del día (lo de los envíos, lo que piden las cuentas, los XML del día y el Buzón) va primero y debe terminar antes de las ' +
            esc(c.fin) + "; lo que falte sigue de mañana, despacio, hasta las " + esc(c.fin_extendido) + ". El historial y el cuadre de meses viejos se reparten en varias noches.</p>" +
            estado + maquinas + (m.vps_version && m.vps_version.mensaje ? '<p class="tar-aviso tar-aviso--mal" data-vps-version>⚠ ' +
                esc(m.vps_version.mensaje) + " <small>Mientras, lo hace la Vostro.</small></p>" : "") + bloqueAnoche(m.anoche, c) + bloqueRelevo(m.relevo) +
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
            numero("vps_ws", "Web service en la VPS", "Solicitudes, revisiones y paquetes; 0 = no se usa") +
            numero("cuadre_por_noche", "Listas del cuadre por noche", "En todo el servidor") +
            hora("inicio", "Inicio") + hora("fin", "Fin") + hora("inicio_minimo", "Lo más temprano si no cabe") + hora("fin_extendido", "Lo del día, de mañana hasta") +
            '</div><div class="tar-switches"><label class="tar-switch"><input type="checkbox" data-mad="usar_agente"' + (c.usar_agente ? " checked" : "") + '><span>Usar las PCs con el Agente en la madrugada</span>' +
            "<small>Apagado, la madrugada no cuenta con las PCs del contador: solo la Vostro y la VPS (de fábrica apagado).</small></label>" +
            '<label class="tar-switch"><input type="checkbox" data-relevo' + ((m.relevo || {}).activo ? " checked" : "") + '><span>Relevo de la VPS si se cae la Vostro</span>' +
            "<small>Con la Vostro caída, la VPS hace sola lo del día (nunca facturar, cancelar, DIOT ni envíos). Necesita el Vault de Oracle " +
            "(de fábrica apagado).</small></label></div>" +
            '<div class="tar-acciones"><button type="button" class="tar-btn tar-btn--primario" id="tar-guardar-mad">Guardar</button><span class="tar-msj" id="tar-msj-mad"></span></div>' +
            "</details></div>";
    }

    // 20-nov-2026 (el dueño): el vigilante de la llave del relevo (core/vigilante_boveda.py): cada hora pregunta a la auditoría
    // de Oracle quién leyó el secreto «fiscontable-relevo». Última revisión, lecturas en 7 días y estado.
    function lineaLlave(v) {
        if (!v) return "";
        var chip = v.estado === "ok" ? '<span class="tar-chip tar-chip--ok">Bien</span>'
            : v.estado === "sin_configurar" ? '<span class="tar-chip">Sin configurar</span>'
            : '<span class="tar-chip tar-chip--mal">No pudo revisar</span>';
        var n = v.normales_7d || 0, u = v.urgentes_7d || 0;
        var lecturas = "Lecturas en 7 días: " + n + (n === 1 ? " normal" : " normales") + ", " +
            (u ? "<b>" + u + (u === 1 ? " URGENTE" : " URGENTES") + "</b>" : "0 urgentes");
        var detalle = v.estado === "sin_configurar" ? ' <small class="tar-llave-ayuda">Faltan las variables FISCONTABLE_OCI_AUDIT_… de la Vostro (pasos en docs/prd/vigilante_boveda.md).</small>'
            : v.estado === "error" ? ' <small class="tar-llave-ayuda">' + esc(v.error || v.texto || "") + (v.fallando_desde ? " · desde " + esc(cuando(v.fallando_desde)) : "") + "</small>" : "";
        return '<p class="' + (u ? "tar-aviso tar-aviso--mal" : "tar-nota") + ' tar-llave" data-vigilante-llave><b>Vigilante de la llave del relevo:</b> ' + chip +
            " · Última revisión: " + esc(cuando(v.ultima_revision)) + " · " + lecturas + detalle + "</p>";
    }

    // 20-nov-2026 (el dueño): el vigilante de corriente de la Vostro (core/corriente.py): «Corriente: normal / en batería desde
    // las … / sin detector». El texto lo arma el servidor; aquí solo se pinta (en rojo mientras no haya luz).
    function lineaCorriente(c) {
        if (!c || !c.texto) return "";
        return '<p class="' + (c.alerta ? "tar-aviso tar-aviso--mal" : "tar-nota") + '" data-corriente="' + esc(c.estado || "") + '"><b>Corriente:</b> ' + esc(c.texto) + "</p>";
    }

    function tarjetaTareas(t) {
        var fallan = {};
        t.tareas.forEach(function (x) { if (x.fallando_desde || (x.ultima && x.ultima.ok === 0)) fallan[grupoDe(x)] = (fallan[grupoDe(x)] || 0) + 1; });
        var filtro = '<div class="tar-filtro" role="tablist"><button type="button" role="tab" data-grupo="resumen" aria-selected="' + (grupoActivo === "resumen") + '"' +
            (grupoActivo === "resumen" ? ' class="tar-filtro--activo"' : "") + ">Resumen</button>" +
            '<button type="button" role="tab" data-grupo="madrugada" aria-selected="' + (grupoActivo === "madrugada") + '"' +
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
        // 19-nov-2026 (el dueño): la VPS contestó «versión distinta» (el código le llega con la copia, 5-10 min después de un cambio)
        var vv = t.vps_version && t.vps_version.mensaje ? '<p class="tar-aviso tar-aviso--mal" data-vps-version>⚠ ' + esc(t.vps_version.mensaje) +
            " <small>Mientras, lo hace la Vostro.</small></p>" : "";
        var fallando = t.tareas.filter(function (x) { return x.fallando_desde; }).length;
        return { filtro: filtro, tarjeta: '<div class="ui-tarjeta tar-bloque" data-vista="tareas"' + (grupoActivo === "madrugada" || grupoActivo === "resumen" ? " hidden" : "") + '><h3 class="tar-titulo">Tareas automáticas</h3>' +
            '<p class="tar-nota">Lo que el servidor hace solo, a su hora (hora del centro). Si una falla, te avisamos en la campana y por correo en tu horario: una vez al día mientras siga fallando y otra cuando se recupere.</p>' +
            (fallando ? '<p class="tar-aviso tar-aviso--mal">⚠ ' + fallando + " tarea(s) fallando ahora.</p>" : "") +
            '<p class="tar-nota"><b>Respaldo a la VPS:</b> ' + resp + "</p>" + lineaCorriente(t.corriente) + vv + lineaLlave(t.vigilante_boveda) +
            '<div class="tar-tabla-caja"><table class="tar-tabla"><thead><tr><th>Tarea</th><th>Última</th><th>Tardó</th><th>Resultado</th><th>Próxima</th><th></th></tr></thead><tbody>' +
            filas + '</tbody></table></div><span class="tar-msj" id="tar-msj-correr"></span></div>' };
    }

    // 20-nov-2026 (el dueño, docs/prd/vps_trabaja.md): «La VPS trabaja cuando la Vostro cae» (de fábrica apagado). Con la Vostro
    // caída, la VPS deja de ser solo lectura para una lista cerrada (XML, validar, reportes, conciliación, envíos, ZIP, constancia,
    // opinión, declaraciones, Buzón solo listar, alta de empresa). Necesita el relevo prendido (la llave del Vault).
    function bloqueTrabaja(v) {
        v = v || {};
        var u = v.ultimo || {};
        return '<div class="ui-tarjeta tar-bloque tar-trabaja" data-vps-trabaja>' +
            '<label class="tar-switch"><input type="checkbox" data-trabaja' + (v.activo ? " checked" : "") + (!v.relevo && !v.activo ? " disabled" : "") +
            '><span>La VPS trabaja cuando la Vostro cae</span><small>' +
            (v.relevo ? "Con la Vostro caída, en la VPS se puede descargar y validar XML, sacar reportes, conciliar, mandar envíos y dar de alta empresas. " +
                "Facturar, cancelar, DIOT y lo demás esperan a la Vostro. Al volver, la Vostro junta todo sin duplicar (de fábrica apagado)."
                : "Necesita prendido «Relevo de la VPS si se cae la Vostro» (La madrugada › Cuántos a la vez y horario): la VPS trabaja con la llave del Vault de Oracle.") +
            (u.noche ? "<br><b>Última vez:</b> " + esc((u.resumen || "").replace(/^Lo que hizo la VPS con la Vostro caída /, "")) + " · importado " + esc(cuando(u.importado_en)) : "") +
            '</small></label><span class="tar-msj" id="tar-msj-trabaja"></span></div>';
    }

    async function pintar() {
        caja.innerHTML = '<span class="ui-skel" style="width:60%"></span>';
        var m, t;
        try { m = await api("/api/admin/sistema/madrugada"); t = await api("/api/admin/sistema/tareas"); }
        catch (e) { caja.innerHTML = '<p class="ui-aviso ui-aviso--error">' + esc(e.message) + "</p>"; return; }
        if (!grupoActivo) grupoActivo = "resumen";          // 23-nov-2026: abre en el resumen (ahí también sale lo que falló)
        m.vps_version = t.vps_version;
        var tareas = tarjetaTareas(t);
        caja.innerHTML = tareas.filtro + bloqueTrabaja(t.vps_trabaja) +
            '<div class="ui-tarjeta tar-bloque" data-vista="resumen"' + (grupoActivo === "resumen" ? "" : " hidden") + '>' +
            '<p class="tar-nota">Lo que el servidor hizo solo cada día, de todas las cuentas. Pica un proceso para ver cada empresa.</p>' +
            '<div data-resumen></div></div>' + tarjetaMadrugada(m) + tareas.tarjeta;
        var resumen = caja.querySelector("[data-resumen]");
        var pintarResumen = function () {
            if (resumen.dataset.listo || !window.FcAutomatico) return;
            resumen.dataset.listo = "1";
            window.FcAutomatico.pintar(resumen, { base: "/api/admin/sistema/automatico", admin: true, url: false });
        };
        if (grupoActivo === "resumen") pintarResumen();
        var sw = caja.querySelector("[data-trabaja]");
        sw.addEventListener("change", async function () {
            var prender = sw.checked;
            if (prender && !confirm("¿Prender «La VPS trabaja cuando la Vostro cae»? Con la Vostro caída, la VPS pedirá la llave al Vault (te llega el aviso) y aceptará XML, reportes, envíos y altas de empresa. Llega a la VPS con la siguiente copia.")) {
                sw.checked = false; return;
            }
            sw.disabled = true;
            try {
                var r = await mandar("/api/admin/sistema/vps-trabaja", "PUT", { activo: prender });
                sw.checked = !!r.activo;
                msj("tar-msj-trabaja", true, prender ? "✓ Prendido. Llega a la VPS con la siguiente copia (5 a 10 min)." : "✓ Apagado: con la Vostro caída, la VPS vuelve a ser solo de consulta.");
            } catch (e) { sw.checked = !prender; msj("tar-msj-trabaja", false, e.message); }
            sw.disabled = false;
        });
        var br = document.getElementById("tar-reintentar");
        br.addEventListener("click", async function () {
            if (!confirm("¿Volver a programar lo que no salió en la última semana (de todas las cuentas)? Va en la madrugada que toca.")) return;
            br.disabled = true;
            try { var r = await mandar("/api/admin/sistema/madrugada/reintentar", "POST"); msj("tar-msj-reintentar", true, "✓ " + r.mensaje); }
            catch (e) { msj("tar-msj-reintentar", false, e.message); br.disabled = false; }
        });
        document.getElementById("tar-guardar-mad").addEventListener("click", async function (ev) {
            var b = ev.currentTarget, valores = {};
            caja.querySelectorAll("[data-mad]").forEach(function (i) { valores[i.dataset.mad] = i.type === "checkbox" ? i.checked : i.type === "number" ? +i.value : i.value; });
            var rel = caja.querySelector("[data-relevo]"), relevo = rel ? rel.checked : false, antes = !!(m.relevo || {}).activo;
            if (relevo && !antes && !confirm("¿Prender el relevo de la VPS? Úsalo solo si ya están el Vault y el permiso en Oracle: cada vez que la VPS pida la llave te llega un correo.")) {
                rel.checked = false; relevo = false;
            }
            b.disabled = true;
            try {
                await mandar("/api/admin/sistema/madrugada", "PUT", { valores: valores });
                if (relevo !== antes) { var r = await mandar("/api/admin/sistema/relevo", "PUT", { activo: relevo }); m.relevo = r; }
                msj("tar-msj-mad", true, "✓ Guardado. Cuenta desde la siguiente vuelta del turno." + (relevo !== antes ? (relevo ? " El relevo llega a la VPS con la siguiente copia." : " Relevo apagado.") : ""));
            }
            catch (e) { msj("tar-msj-mad", false, e.message); }
            b.disabled = false;
        });
        caja.querySelectorAll(".tar-filtro [data-grupo]").forEach(function (b) {
            b.addEventListener("click", function () {
                grupoActivo = b.dataset.grupo;
                caja.querySelectorAll(".tar-filtro [data-grupo]").forEach(function (o) { var si = o === b; o.classList.toggle("tar-filtro--activo", si); o.setAttribute("aria-selected", si); });
                caja.querySelectorAll(".tar-tabla tbody tr").forEach(function (tr) { tr.hidden = tr.dataset.grupo !== grupoActivo; });
                caja.querySelector('[data-vista="madrugada"]').hidden = grupoActivo !== "madrugada";
                caja.querySelector('[data-vista="tareas"]').hidden = grupoActivo === "madrugada" || grupoActivo === "resumen";
                caja.querySelector('[data-vista="resumen"]').hidden = grupoActivo !== "resumen";
                if (grupoActivo === "resumen") pintarResumen();
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
