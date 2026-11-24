/*
 * assets/js/comun/automatico.js — «Lo automático» por día (23-nov-2026, el dueño: «me gustaría presionar y [ver] el
 * desglose, si se hizo o no»; «lo abres y te da el detalle así bonito, con nuestro estilo»).
 *   · Arriba: hoy, ayer u otro de los últimos 30 días; el total de la noche y, si hubo documentos, su paquete.
 *   · Un renglón por proceso con su semáforo (salió / con avisos / no salió / no alcanzó / en curso / no le tocaba), su
 *     total («XML del día: 48 de 50 empresas») y su hora de inicio y fin.
 *   · Al picarlo: el desglose por empresa (estado, por qué, máquina, hora, intentos), «Solo lo que no salió» y
 *     «Reintentar lo que no salió» (del proceso o de una empresa). «No alcanzó» se explica al pasar el cursor o tocar el chip.
 * Lo usan Administración › Sistema › Tareas automáticas › Resumen (todas las cuentas, con filtro de cuenta y las tareas del
 * reloj) y Configuración › Lo automático › Anoche (la cuenta; en el despacho, solo las empresas de cada quien). El anuncio
 * de la campana abre aquí. El servidor: modulos/programadas/resumen.py.
 *   FcAutomatico.pintar(caja, { base: "/api/programadas/automatico", admin: false, dia: "2026-11-24" })
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var NO_ALCANZO = "No se alcanzó a intentar porque terminó el horario de la madrugada. No es una falla del SAT ni de la e.firma: faltó tiempo.";
    // «Salió» no lleva explicación (24-nov, revisión: subrayar y abrir un «Salió bien.» en cada renglón era ruido)
    var AYUDA = {
        revisar: "La e.firma o la contraseña tiene un problema (vencida, revocada o no corresponde). No se reintenta sola: arréglala en Clientes.",
        fallo: "Se intentó varias veces esa noche y el SAT no lo dio.",
        no_alcanzo: NO_ALCANZO,
        paso: "No alcanzó esa madrugada ni la mañana: pasó a la noche siguiente, a la cabeza de la fila.",
        reprogramada: "Alguien pulsó «Reintentar»: va en la madrugada que toca.",
        en_curso: "Se está haciendo ahora.", programado: "Programado para esa madrugada.",
        sigue: "El historial y el cuadre se reparten a propósito en varias noches: sigue solo.",
        cancelada: "Se canceló."
    };
    // 24-nov-2026 (madrugada-8): lo que ni siquiera llegó a la fila (no se pudo programar) se explica distinto. Revisión: sin
    // «a un lado» (en el celular el motivo va abajo) ni «la noche siguiente» (la lista de un envío se vuelve a pedir antes de mandarlo)
    var SIN_PROGRAMAR = "No se pudo programar. El motivo dice qué pasó y cuándo se vuelve a intentar solo: no hace falta reintentarlo a mano.";
    var LEYENDA = [["verde", "Salió"], ["ambar", "Con avisos"], ["rojo", "No salió"], ["naranja", "No alcanzó"], ["azul", "En curso"], ["gris", "No le tocaba"]];
    var FLECHA = '<svg class="au-flecha" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    var DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"], MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

    async function pedir(ruta, op) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, op || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function mandar(ruta, cuerpo) { return pedir(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo || {}) }); }
    // explica: el texto al pasar el cursor; con toque (fuera del renglón, que ya es un botón) también se abre debajo
    function chip(color, texto, explica, sinToque) {
        if (!explica) return '<span class="au-chip au-chip--' + esc(color) + '">' + esc(texto) + "</span>";
        return '<span class="au-chip au-chip--' + esc(color) + '" title="' + esc(explica) + '"' +
            (sinToque ? "" : ' tabindex="0" role="button" data-explica="' + esc(explica) + '"') + ">" + esc(texto) + "</span>";
    }
    function nombreDia(iso, hoy) {
        var d = new Date(iso + "T12:00:00"), h = new Date(hoy + "T12:00:00"), dif = Math.round((h - d) / 864e5);
        var base = DIAS[d.getDay()] + " " + d.getDate() + " " + MESES[d.getMonth()];
        return dif === 0 ? "Hoy · " + base : dif === 1 ? "Ayer · " + base : base;
    }
    function horas(p) { return p.inicio && p.fin && p.inicio !== p.fin ? p.inicio + " a " + p.fin : (p.inicio || p.fin || ""); }

    function pintar(caja, op) {
        op = op || {};
        var base = op.base || "/api/programadas/automatico";
        var est = { dia: op.dia || Fiscontable.url("dia") || null, cuenta: op.cuenta || "", abiertos: {}, soloMal: {}, datos: null };
        caja.classList.add("au");

        function consulta(extra) {
            var q = new URLSearchParams();
            if (est.dia) q.set("dia", est.dia);
            if (est.cuenta) q.set("cuenta", est.cuenta);
            Object.keys(extra || {}).forEach(function (k) { q.set(k, extra[k]); });
            var t = q.toString();
            return t ? "?" + t : "";
        }

        async function cargar() {
            caja.innerHTML = '<span class="ui-skel" style="width:60%"></span><span class="ui-skel" style="width:90%"></span>';
            try { est.datos = await pedir(base + consulta()); }
            catch (e) { caja.innerHTML = '<p class="ui-aviso ui-aviso--error">' + esc(e.message) + "</p>"; return; }
            est.dia = est.datos.noche;
            if (op.url !== false) Fiscontable.url({ dia: est.dia === est.datos.hoy ? null : est.dia });
            dibujar();
        }

        function cabeza(d) {
            var ayer = (d.dias[1] || {}).dia;
            var otros = d.dias.map(function (x) {
                return '<option value="' + esc(x.dia) + '"' + (x.dia === d.noche ? " selected" : "") + ">" + esc(nombreDia(x.dia, d.hoy)) + (x.con_algo ? "" : " · sin madrugada") + "</option>";
            }).join("");
            var cuentas = op.admin ? '<select class="au-select au-cuenta" data-au="cuenta" aria-label="Cuenta"><option value="">Todas las cuentas</option>' +
                (d.cuentas || []).map(function (c) { return '<option value="' + esc(c.correo) + '"' + (c.correo === est.cuenta ? " selected" : "") + ">" + esc(c.nombre) + "</option>"; }).join("") +
                (est.cuenta && !(d.cuentas || []).some(function (c) { return c.correo === est.cuenta; }) ? '<option value="' + esc(est.cuenta) + '" selected>' + esc(est.cuenta) + "</option>" : "") +
                "</select>" : "";
            return '<div class="au-cabeza"><div class="au-dias" role="group" aria-label="Día">' +
                '<button type="button" class="au-dia" data-dia="' + esc(d.hoy) + '" aria-pressed="' + (d.noche === d.hoy) + '">Hoy</button>' +
                (ayer ? '<button type="button" class="au-dia" data-dia="' + esc(ayer) + '" aria-pressed="' + (d.noche === ayer) + '">Ayer</button>' : "") +
                '<select class="au-select" data-au="dia" aria-label="Otro día">' + otros + "</select></div>" + cuentas + "</div>";
        }

        function total(d) {
            var r = d.resumen, partes = [];
            if (!r.total) return "";
            var bien = r.bien + (r.sigue || 0);          // el historial que avanza noche con noche también va bien
            if (bien) partes.push("<strong>" + bien + "</strong> proceso" + (bien === 1 ? "" : "s") + " bien");
            if (r.con_algo) partes.push("<strong>" + r.con_algo + "</strong> con algo que revisar");
            if (r.en_curso) partes.push("<strong>" + r.en_curso + "</strong> en curso");
            if (r.inicio) partes.push("empezó " + esc(r.inicio) + (r.fin ? ", terminó " + esc(r.fin) : ""));
            return '<div class="au-total"><b>' + esc(d.titulo) + (op.admin && !est.cuenta ? " · todas las cuentas" : "") + "</b>" +
                '<span class="au-total__cifras">' + partes.join(" · ") + "</span>" +
                (d.paquete ? '<a class="au-paquete" href="' + esc(d.paquete.enlace) + '">Documentos de la noche</a>' : "") + "</div>";
        }

        function renglon(p) {
            var abierto = !!est.abiertos[p.clave];
            var explica = p.color === "naranja" ? (p.explica || NO_ALCANZO) : "";
            return '<li class="au-proc" data-clave="' + esc(p.clave) + '"><button type="button" class="au-fila" aria-expanded="' + abierto + '"' +
                (p.color === "gris" && !p.total ? " disabled" : "") + '>' +
                '<span class="au-luz au-luz--' + esc(p.color) + '" aria-hidden="true"></span>' +
                '<span class="au-nombre"><b>' + esc(p.nombre) + "</b><small>" + esc(p.texto || "") + "</small></span>" +
                chip(p.color, p.etiqueta, explica, true) + '<span class="au-hora">' + esc(horas(p)) + "</span>" + (p.color === "gris" && !p.total ? "<span></span>" : FLECHA) +
                '</button><div class="au-desglose" data-desglose' + (abierto ? "" : " hidden") + "></div></li>";
        }

        // 24-nov-2026 (madrugada-7): el reinicio del servidor (apagón) en un solo renglón de la noche
        function notas(d) {
            return (d.notas || []).map(function (n) { return '<p class="au-aviso" role="note">' + esc(n) + "</p>"; }).join("");
        }

        function dibujar() {
            var d = est.datos;
            var procesos = d.procesos || [];
            caja.innerHTML = cabeza(d) + total(d) + notas(d) + (procesos.length ? '<ul class="au-lista">' + procesos.map(renglon).join("") + "</ul>" +
                '<p class="au-leyenda">' + LEYENDA.map(function (x) { return '<span><i class="au-luz au-luz--' + x[0] + '"></i>' + esc(x[1]) + "</span>"; }).join("") + "</p>"
                : '<div class="au-vacio"><b>Esa noche no hubo nada automático' + (op.admin ? "" : " para tus empresas") + ".</b>" +
                  "Lo que Fiscontable hace solo (XML, Buzón, constancias, opiniones, declaraciones) aparece aquí al día siguiente.</div>");
            procesos.forEach(function (p) { if (est.abiertos[p.clave]) abrir(p.clave); });
        }

        async function abrir(clave) {
            var li = caja.querySelector('.au-proc[data-clave="' + clave + '"]');
            if (!li) return;
            var zona = li.querySelector("[data-desglose]");
            zona.hidden = false;
            li.querySelector(".au-fila").setAttribute("aria-expanded", "true");
            zona.innerHTML = '<span class="ui-skel" style="width:70%"></span>';
            var x;
            try { x = await pedir(base + "/" + encodeURIComponent(clave) + consulta()); }
            catch (e) { zona.innerHTML = '<p class="au-msj au-msj--mal">' + esc(e.message) + "</p>"; return; }
            zona.innerHTML = desglose(x);
            var filtro = zona.querySelector("[data-au=solo]");
            if (filtro) filtro.addEventListener("change", function () {
                est.soloMal[clave] = filtro.checked;
                zona.querySelectorAll("tbody tr").forEach(function (tr) { tr.hidden = filtro.checked && tr.dataset.bien === "1"; });
            });
        }

        function desglose(x) {
            var es = x.empresas || [], reloj = x.clave === "reloj", envios = x.clave === "envios";
            var mal = es.filter(function (e) { return e.estado !== "salio"; }).length;
            var h = [];
            if (x.no_alcanzo || x.explica) h.push('<div class="au-explica"><b>' + (x.no_alcanzo ? "¿Qué es «No alcanzó»?" : "Qué pasó") + "</b>" + esc(x.explica) + "</div>");
            if (x.nota) h.push('<p class="au-nota">' + esc(x.nota) + "</p>");
            if (x.de_lote) h.push('<p class="au-nota">' + x.de_lote + " de un lote subido no se pueden reintentar: vuelve a subir el lote.</p>");
            var puede = est.datos.puede_reintentar !== false;
            h.push('<div class="au-herr">' + (es.length && mal && mal < es.length ? '<label><input type="checkbox" data-au="solo"' + (est.soloMal[x.clave] ? " checked" : "") +
                "> Solo lo que no salió (" + mal + ")</label>" : "<span></span>") +
                (x.reintentables && puede ? '<button type="button" class="ui-btn ui-btn--primario ui-btn--32" data-au="reintentar">Reintentar lo que no salió (' + x.reintentables + ")</button>" : "") +
                "</div>");
            if (!es.length) { h.push('<p class="au-nota">' + (reloj ? "Ese día no corrió." : "Nada que mostrar de este proceso esa noche.") + "</p>"); return h.join(""); }
            var cols = reloj ? ["Tarea", "Estado", "Resultado", "Hora", ""] : envios ? ["Envío", "Estado", "Detalle", "Hora"]
                : ["Empresa", "Estado", "Por qué", "Máquina", "Hora", "Intentos", ""];
            var filas = es.map(function (e) {
                var explica = e.sin_programar ? SIN_PROGRAMAR : e.estado === "no_alcanzo" ? (x.explica || NO_ALCANZO) : (AYUDA[e.estado] || "");
                var oculto = est.soloMal[x.clave] && e.estado === "salio";
                var accion = "";
                if (!reloj && !envios && puede) {
                    if (e.reintentable && x.reintentables) accion = '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-au="reintentar-uno" data-rfc="' + esc(e.rfc) + '"' +
                        (e.cuenta ? ' data-cuenta="' + esc(e.cuenta) + '"' : "") + ">Reintentar</button>";
                    else if (e.estado === "revisar" && !op.admin) accion = '<a class="au-enlace" href="/clientes/?editar=' + encodeURIComponent(e.rfc) + '&ficha=accesos">Arreglar e.firma</a>';
                }
                if (reloj) return '<tr data-bien="' + (e.estado === "salio" ? 1 : 0) + '"' + (oculto ? " hidden" : "") + '><td data-t="Tarea"><b>' + esc(e.nombre) + "</b>" +
                    (e.intentos > 1 ? "<small>" + esc(e.intentos) + " corridas ese día</small>" : "") + '</td><td data-t="Estado">' + chip(e.color, e.etiqueta) +
                    '</td><td data-t="Resultado">' + esc(e.por_que) + '</td><td data-t="Hora">' + esc(e.hora) + "</td><td>" +
                    (op.admin && e.tarea ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-au="correr" data-tarea="' + esc(e.tarea) + '">Correr ahora</button>' : "") +
                    "</td></tr>";
                if (envios) return '<tr data-bien="' + (e.estado === "salio" ? 1 : 0) + '"' + (oculto ? " hidden" : "") + '><td data-t="Envío"><b>' + esc(e.nombre) + "</b>" +
                    (e.cuenta ? "<small>" + esc(e.cuenta) + "</small>" : "") + '</td><td data-t="Estado">' + chip(e.color, e.etiqueta) + '</td><td data-t="Detalle">' + esc(e.por_que) +
                    '</td><td data-t="Hora">' + esc(e.hora) + "</td></tr>";
                return '<tr data-bien="' + (e.estado === "salio" ? 1 : 0) + '"' + (oculto ? " hidden" : "") + '><td data-t="Empresa"><b>' + esc(e.nombre) + "</b><small>" +
                    esc([e.rfc !== e.nombre ? e.rfc : "", e.que || "", e.cuenta || ""].filter(Boolean).join(" · ")) + "</small></td>" +
                    '<td data-t="Estado">' + chip(e.color, e.etiqueta, explica) + '</td><td data-t="Por qué">' + esc(e.por_que || "—") + "</td>" +
                    '<td data-t="Máquina">' + esc(e.maquina || "") + '</td><td data-t="Hora">' + esc(e.hora && e.fin && e.hora !== e.fin ? e.hora + " a " + e.fin : e.hora || e.fin || "") +
                    '</td><td data-t="Intentos">' + esc(e.intentos || "") + "</td><td>" + accion + "</td></tr>";
            }).join("");
            h.push('<div class="au-tabla-caja"><table class="au-tabla"><thead><tr>' + cols.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") +
                "</tr></thead><tbody>" + filas + '</tbody></table></div><span class="au-msj" data-au="msj"></span>');
            return h.join("");
        }

        function aviso(zona, ok, texto) {
            var m = zona && zona.querySelector("[data-au=msj]");
            if (!m) { if (!ok) alert(texto); return; }
            m.textContent = texto; m.className = "au-msj " + (ok ? "au-msj--ok" : "au-msj--mal");
        }

        async function reintentar(boton) {
            var li = boton.closest(".au-proc"), clave = li.dataset.clave, zona = li.querySelector("[data-desglose]");
            var rfc = boton.dataset.rfc || null, p = (est.datos.procesos || []).filter(function (x) { return x.clave === clave; })[0] || {};
            var pregunta = rfc ? "¿Volver a programar " + rfc + " (" + (p.nombre || "este proceso") + ")? Va en la madrugada que toca."
                : "¿Volver a programar lo que no salió de «" + (p.nombre || clave) + "»? Va en la madrugada que toca, antes que lo demás.";
            if (!(await Fiscontable.preguntar(pregunta, { si: "Reintentar" }))) return;
            boton.disabled = true;
            try {
                var cuerpo = { dia: est.dia };
                if (rfc) cuerpo.rfc = rfc;
                if (op.admin && (boton.dataset.cuenta || est.cuenta)) cuerpo.cuenta = boton.dataset.cuenta || est.cuenta;
                var r = await mandar(base + "/" + encodeURIComponent(clave) + "/reintentar", cuerpo);
                aviso(zona, true, "✓ " + r.mensaje);
                setTimeout(cargar, 1500);
            } catch (e) { aviso(zona, false, e.message); boton.disabled = false; }
        }

        async function correr(boton) {
            var tarea = boton.dataset.tarea, zona = boton.closest("[data-desglose]"), fila = boton.closest("tr");
            var nombre = fila ? fila.querySelector("b").textContent : "esta tarea";
            if (!(await Fiscontable.preguntar("¿Correr «" + nombre + "» ahora? Hace lo mismo que a su hora.", { si: "Correr ahora" }))) return;
            boton.disabled = true;
            try {
                var r = await mandar("/api/admin/sistema/tareas/" + encodeURIComponent(tarea) + "/correr");
                aviso(zona, true, "✓ " + r.mensaje);
            } catch (e) { aviso(zona, false, e.message); boton.disabled = false; }
        }

        function explicar(c) {
            var abierto = c.nextElementSibling && c.nextElementSibling.classList.contains("au-pop");
            caja.querySelectorAll(".au-pop").forEach(function (x) { x.remove(); });
            if (abierto) return;
            var pop = document.createElement("span");
            pop.className = "au-pop"; pop.setAttribute("role", "note");
            pop.textContent = c.dataset.explica;
            c.insertAdjacentElement("afterend", pop);
        }

        caja.addEventListener("click", function (e) {
            var c = e.target.closest(".au-chip[data-explica]");
            if (c) { e.stopPropagation(); e.preventDefault(); explicar(c); return; }
            var b = e.target.closest("[data-dia]");
            if (b) { est.dia = b.dataset.dia; est.abiertos = {}; cargar(); return; }
            var r = e.target.closest("[data-au=reintentar], [data-au=reintentar-uno]");
            if (r) { reintentar(r); return; }
            var k = e.target.closest("[data-au=correr]");
            if (k) { correr(k); return; }
            var f = e.target.closest(".au-fila");
            if (f && !f.disabled) {
                var clave = f.closest(".au-proc").dataset.clave;
                est.abiertos[clave] = !est.abiertos[clave];
                if (est.abiertos[clave]) abrir(clave);
                else { f.setAttribute("aria-expanded", "false"); f.closest(".au-proc").querySelector("[data-desglose]").hidden = true; }
            }
        });
        caja.addEventListener("keydown", function (e) {
            var c = e.target.closest && e.target.closest(".au-chip[data-explica]");
            if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); explicar(c); }
        });
        caja.addEventListener("change", function (e) {
            if (e.target.dataset.au === "dia") { est.dia = e.target.value; est.abiertos = {}; cargar(); }
            else if (e.target.dataset.au === "cuenta") { est.cuenta = e.target.value; est.abiertos = {}; cargar(); }
        });
        cargar();
        return { recargar: cargar };
    }

    window.FcAutomatico = { pintar: pintar, NO_ALCANZO: NO_ALCANZO };
})();
