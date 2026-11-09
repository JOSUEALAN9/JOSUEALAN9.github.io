/*
 * comun/programacion.js — Programación unificada (G-09). Una sola pieza en todos los módulos que trabajan con el SAT.
 *
 *   FCProgramacion.linea({ modulo: "csf" | "opinion" | "declaraciones" | "xml" | "buzon" | "validador" | "listas",
 *                          contenedor: elemento })
 *       Una línea: «Programado · mensual, día 1 · próxima: 01/12/2026 · Cambiar · Ver todas».
 *       Usa la empresa activa de la barra de arriba (y se actualiza si cambia).
 *   FCProgramacion.abrir(modulo)    abre el ajuste rápido (frecuencia, día, todas mis empresas, aviso por correo).
 *
 * Lo que corre de madrugada sigue siendo el turno de siempre (pausas, reintentos, e.firma guardada).
 */
(function () {
    "use strict";
    var esc = function (t) { return Fiscontable.escapar(t); };
    var DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
    var lineas = [];          // {modulo, contenedor}
    var dlg = null, actual = null;

    async function api(ruta, op) {
        var r = await fetch(Fiscontable.API + ruta, Object.assign({ credentials: "include" }, op || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    async function rfcActivo() { try { var e = await Fiscontable.empresaActiva(); return e ? e.rfc : ""; } catch (x) { return ""; } }
    async function leer(modulo) {
        var rfc = await rfcActivo();
        return api("/api/programacion/" + modulo + (rfc ? "?rfc=" + encodeURIComponent(rfc) : ""));
    }

    function pintarLinea(l, d) {
        var activa = d.activa, auto = !d.editable;
        l.contenedor.innerHTML = '<div class="fpu">' +
            '<span class="ui-estado ' + (activa ? "ui-estado--ok" : "") + '">' + esc(d.linea) + "</span>" +
            '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-fpu="cambiar">' +
                (auto ? "Avisos" : activa ? "Cambiar" : "Programar") + "</button>" +
            '<a class="fpu__todas" href="/configuracion/?seccion=programaciones">Ver todas</a></div>';
        l.contenedor.querySelector("[data-fpu=cambiar]").addEventListener("click", function () { abrir(l.modulo); });
    }
    async function refrescar() {
        for (var i = 0; i < lineas.length; i++) {
            try { pintarLinea(lineas[i], await leer(lineas[i].modulo)); }
            catch (e) { lineas[i].contenedor.innerHTML = ""; }
        }
    }

    function opciones(lista, valor) {
        return lista.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(valor) ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("");
    }
    function diasDe(frec, dia) {
        if (frec === "semanal") return opciones(DIAS.map(function (n, i) { return [i, "Los " + n]; }), dia);
        var l = []; for (var i = 1; i <= 28; i++) l.push([i, "Día " + i]);
        return opciones(l, dia);
    }

    function formulario(d) {
        var m = d.modulo, r = d.regla || {}, def = d.defecto || {}, h = [];
        if (m === "csf" || m === "opinion" || m === "declaraciones") {
            var frec = r.frecuencia || def.frecuencia || "mensual", dia = r.dia != null ? r.dia : (def.dia != null ? def.dia : 1);
            h.push('<label class="ui-check"><input type="checkbox" data-c="activa"' + (d.activa || !d.regla ? " checked" : "") + "> Hacerlo solo</label>");
            h.push('<div class="fpu-fila"><label>Cada cuánto<select class="ui-select" data-c="frecuencia">' +
                   opciones(Object.keys(d.frecuencias).map(function (k) { return [k, d.frecuencias[k]]; }), frec) + "</select></label>" +
                   '<label>Qué día<select class="ui-select" data-c="dia">' + diasDe(frec, dia) + "</select></label></div>");
        } else if (m === "xml") {
            h.push('<label class="ui-check"><input type="checkbox" data-c="activa"' + (d.activa || !d.regla ? " checked" : "") + "> Bajar los XML solos</label>");
            h.push('<div class="fpu-fila"><label>Cada cuánto<select class="ui-select" data-c="frecuencia">' +
                   opciones(Object.keys(d.frecuencias).map(function (k) { return [k, d.frecuencias[k]]; }), r.frecuencia || def.frecuencia || "diaria") + "</select></label>" +
                   '<label>Qué XML<select class="ui-select" data-c="tipo">' +
                   opciones(Object.keys(d.tipos).map(function (k) { return [k, d.tipos[k]]; }), r.tipo || def.tipo || "ambos") + "</select></label></div>");
        } else if (m === "buzon") {
            h.push('<label>Cada cuánto se revisa<select class="ui-select" data-c="dias">' +
                   opciones(Object.keys(d.frecuencias).map(function (k) { return [k, d.frecuencias[k]]; }), (d.regla || {}).dias) + "</select></label>");
        } else {
            h.push('<p class="xml-tenue">' + esc(d.linea.replace(/^Automático · /, "")) + ".</p>");
        }
        if (m !== "buzon" && d.editable) h.push('<label class="ui-check"><input type="checkbox" data-c="todas"> Lo mismo para todas mis empresas con e.firma</label>');
        h.push('<label class="ui-check"><input type="checkbox" data-c="avisar"' + (d.avisar_correo ? " checked" : "") + "> " +
               (d.editable ? "Avisarme por correo cuando termine" : "Avisarme por correo cuando cambie algo") + "</label>");
        h.push('<p class="xml-tenue fpu-nota">' + (d.editable ? "Se hace de madrugada con la e.firma guardada de cada empresa. " : "") +
               'Los avisos también llegan a la campana de arriba. <a href="/configuracion/?seccion=programaciones">Ver todas las programaciones</a></p>');
        return h.join("");
    }

    async function abrir(modulo) {
        if (!dlg) {
            dlg = document.createElement("dialog");
            dlg.className = "ui-modal fpu-dlg";
            dlg.innerHTML = '<div class="ui-modal__cuerpo"><h3 class="fpu-titulo"></h3><p class="fpu-empresa xml-tenue"></p><div class="fpu-form"></div>' +
                '<p class="fpu-error" hidden></p></div><div class="ui-modal__pie">' +
                '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-fpu="cerrar">Cancelar</button>' +
                '<button type="button" class="ui-btn ui-btn--primario ui-btn--32" data-fpu="guardar">Guardar</button></div>';
            document.body.appendChild(dlg);
            dlg.addEventListener("click", function (e) {
                var b = e.target.closest("[data-fpu]"); if (!b) return;
                if (b.dataset.fpu === "cerrar") dlg.close(); else guardar();
            });
            dlg.addEventListener("change", function (e) {
                if (e.target.dataset.c === "frecuencia" && actual && /^(csf|opinion|declaraciones)$/.test(actual.modulo))
                    dlg.querySelector("[data-c=dia]").innerHTML = diasDe(e.target.value, e.target.value === "semanal" ? 0 : 1);
            });
        }
        var err = dlg.querySelector(".fpu-error"); err.hidden = true;
        try { actual = await leer(modulo); }
        catch (e) { Fiscontable.toast(e.message); return; }
        var empresa = null; try { empresa = await Fiscontable.empresaActiva(); } catch (x) { /* nada */ }
        dlg.querySelector(".fpu-titulo").textContent = "Programar · " + actual.nombre;
        dlg.querySelector(".fpu-empresa").textContent = actual.editable && actual.modulo !== "buzon"
            ? (empresa ? "Empresa: " + (empresa.alias || empresa.rfc) : "Elige una empresa arriba o marca «todas mis empresas».")
            : "Para todas tus empresas";
        dlg.querySelector(".fpu-form").innerHTML = formulario(actual);
        dlg.showModal();
    }

    async function guardar() {
        var v = function (c) { var el = dlg.querySelector("[data-c=" + c + "]"); return el ? (el.type === "checkbox" ? el.checked : el.value) : undefined; };
        var cuerpo = { rfc: await rfcActivo(), todas: !!v("todas"), activa: v("activa") === undefined ? true : v("activa"), avisar_correo: !!v("avisar") };
        if (v("frecuencia") !== undefined) cuerpo.frecuencia = v("frecuencia");
        if (v("dia") !== undefined) cuerpo.dia = +v("dia");
        if (v("tipo") !== undefined) cuerpo.tipo = v("tipo");
        if (v("dias") !== undefined) { cuerpo.dias = +v("dias"); cuerpo.activa = +v("dias") > 0; }
        if (cuerpo.todas && !confirm("¿Aplicar esta programación a todas tus empresas con e.firma guardada?")) return;
        var boton = dlg.querySelector("[data-fpu=guardar]"); boton.disabled = true;
        try {
            await api("/api/programacion/" + actual.modulo, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
            dlg.close();
            Fiscontable.toast("Programación guardada.");
            refrescar();
        } catch (e) {
            var err = dlg.querySelector(".fpu-error"); err.textContent = e.message; err.hidden = false;
        } finally { boton.disabled = false; }
    }

    function linea(o) {
        if (!o || !o.contenedor) return;
        lineas.push({ modulo: o.modulo, contenedor: o.contenedor });
        refrescar();
    }
    window.addEventListener("fiscontable:empresa", refrescar);
    window.FCProgramacion = { linea: linea, abrir: abrir, refrescar: refrescar };
})();
