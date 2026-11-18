/**
 * envios.js — Envíos por correo (18-nov-2026).
 *
 * Alan: «que automaticemos el envío de los XML, PDF y Excel por correo… un ZIP por empresa y mes, se juntan todas las
 * empresas seleccionadas, se hace un ZIP y se manda; si pesa más, un enlace que vence. Esto es la necesidad de un despacho.»
 *
 * La página lista los envíos de la cuenta (cada uno: a quién, de qué empresas, qué lleva, cada cuánto) y deja crear,
 * cambiar, pausar, mandar ahora y ver el historial con su enlace. Todo lo demás (armar el ZIP, el correo, el programador)
 * lo hace el servidor: modulos/entregas.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var E = { envios: [], op: null, editando: null, histDe: null, reloj: 0, tope: 15 };

    async function api(ruta, op) {
        var resp;
        try { resp = await fetch(API + ruta, Object.assign({ credentials: "include" }, op || {})); }
        catch (e) { throw new Error("No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo."); }
        if (!resp.ok) throw new Error(await Fiscontable.leerError(resp));
        return resp.json();
    }
    function mandar(ruta, metodo, cuerpo) {
        return api(ruta, { method: metodo, headers: { "Content-Type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    }
    function cuando(iso, conHora) {
        if (!iso) return "";
        var d = new Date(iso.length <= 10 ? iso + "T12:00:00" : iso + (/Z|[+-]\d\d:?\d\d$/.test(iso) ? "" : "Z"));
        return d.toLocaleDateString("es-MX", { weekday: iso.length <= 10 ? "long" : undefined, day: "numeric", month: "short" }) +
            (conHora ? ", " + d.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" }) : "");
    }
    function peso(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
    function plural(n, uno, varios) { return n.toLocaleString("es-MX") + " " + (n === 1 ? uno : varios); }
    function nombreEmpresa(rfc) { var e = (E.op.empresas || []).find(function (x) { return x.rfc === rfc; }); return e ? e.alias : rfc; }
    var ESTADOS = { enviado: ["Enviado", "ok"], sin_novedades: ["Sin novedades (no se mandó)", "info"], sin_novedades_avisado: ["Sin novedades (se avisó)", "info"],
                    error: ["No salió", "error"], armando: ["Armándose…", "aviso"] };

    /* ============================================================ la lista */
    function lleva(c) {
        var xml = (c.xml || []).map(function (k) { return (E.op.xml.find(function (x) { return x.clave === k; }) || {}).nombre; }).filter(Boolean);
        var n = (c.excel || []).length;
        return (xml.length ? "XML y PDF de " + xml.join(", ").toLowerCase() : "") + (xml.length && n ? " · " : "") + (n ? plural(n, "Excel", "Excel") : "");
    }
    function ultimo(e) {
        if (e.en_curso) return '<p class="ev-ultimo">Se está armando ahora…</p>';
        var u = e.ultimo;
        if (!u) return '<p class="ev-ultimo">Todavía no se ha mandado.</p>';
        if (u.estado === "error") return '<p class="ev-ultimo ev-ultimo--error"><b>El último no salió</b> (' + esc(cuando(u.momento, true)) + "): " + esc(u.error || "") + "</p>";
        var txt = u.estado === "enviado" ? plural(u.comprobantes, "comprobante", "comprobantes") + " · " + peso(u.bytes) + (u.adjunto ? " · adjunto y enlace" : " · solo enlace")
            : "sin novedades";
        return '<p class="ev-ultimo">Último: ' + esc(cuando(u.momento, true)) + " · " + esc(txt) + "</p>";
    }
    function pintar() {
        var caja = $("ev-lista");
        if (!E.envios.length) {
            caja.innerHTML = '<div class="ui-vacio ev-vacio"><b>Todavía no tienes envíos</b><span>Crea uno para que los XML, PDF y Excel de tus empresas salgan solos por correo.</span>' +
                '<button type="button" class="ui-btn ui-btn--primario ui-btn--32" data-accion="nuevo">+ Nuevo envío</button></div>';
            return;
        }
        caja.innerHTML = E.envios.map(function (e) {
            var emp = e.empresas.slice(0, 3).map(nombreEmpresa).join(", ") + (e.empresas.length > 3 ? " y " + (e.empresas.length - 3) + " más" : "");
            return '<article class="ui-tarjeta ev-tarjeta' + (e.activa ? "" : " ev-tarjeta--pausado") + '" data-id="' + esc(e.id) + '">' +
                "<header><div><h2>" + esc(e.nombre) + "</h2><small>" + esc(e.cada) + " · " + (e.modo === "mes" ? "el mes completo" : "solo lo nuevo") + "</small></div>" +
                '<label class="ui-switch" title="' + (e.activa ? "Activo: se manda solo. Apágalo para pausarlo." : "Pausado: no se manda solo.") + '"><input type="checkbox" data-accion="activar"' +
                (e.activa ? " checked" : "") + ' aria-label="Activo"><span class="ui-switch__riel"></span></label></header>' +
                '<dl class="ev-datos"><div><dt>Para</dt><dd>' + esc(e.para.concat(e.cc || []).join(", ")) + "</dd></div>" +
                "<div><dt>Empresas</dt><dd>" + esc(plural(e.empresas.length, "empresa", "empresas") + ": " + emp) + "</dd></div>" +
                "<div><dt>Lleva</dt><dd>" + esc(lleva(e.contenido)) + "</dd></div>" +
                "<div><dt>Próximo</dt><dd>" + (e.activa ? esc(cuando(e.proxima)) + ", " + E.hora + ":00" : "pausado") + "</dd></div></dl>" +
                ultimo(e) +
                '<div class="ev-acciones"><button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-accion="enviar"' + (e.en_curso ? " disabled" : "") + ">Enviar ahora</button>" +
                '<button type="button" class="ui-btn ui-btn--terciario ui-btn--32" data-accion="historial">Historial</button>' +
                '<button type="button" class="ui-btn ui-btn--terciario ui-btn--32" data-accion="editar">Editar</button></div></article>';
        }).join("");
    }
    async function cargar() {
        var r = await api("/api/entregas");
        E.envios = r.envios; E.tope = r.tope_adjunto_mb; E.hora = r.hora;
        pintar();
        clearTimeout(E.reloj);
        if (E.envios.some(function (e) { return e.en_curso; })) E.reloj = setTimeout(function () { cargar().catch(function () { /* se reintenta al siguiente */ }); }, 4000);
    }

    /* ============================================================ el formulario */
    function pintarDias() {
        var f = $("ev-frecuencia").value, sel = $("ev-dia"), previo = sel.value;
        $("ev-dia-caja").hidden = f === "quincenal";
        if (f === "semanal") sel.innerHTML = E.op.dias_semana.map(function (d, i) { return '<option value="' + i + '">' + esc(d.charAt(0).toUpperCase() + d.slice(1)) + "</option>"; }).join("");
        else if (f === "mensual") { var h = ""; for (var i = 1; i <= 28; i++) h += '<option value="' + i + '">Día ' + i + "</option>"; sel.innerHTML = h; }
        if (sel.querySelector('option[value="' + previo + '"]')) sel.value = previo;
        $("ev-modo-mes-txt").textContent = f === "mensual" ? "El mes anterior completo, ya cerrado."
            : "El mes en curso completo cada vez (y, la primera semana, también el mes que acaba de cerrar).";
    }
    function pintarEmpresas() {
        var q = $("ev-emp-buscar").value.trim().toLowerCase(), marcadas = E.marcadas;
        var lista = E.op.empresas.filter(function (e) { return !q || e.alias.toLowerCase().indexOf(q) !== -1 || e.rfc.toLowerCase().indexOf(q) !== -1; });
        $("ev-empresas").innerHTML = lista.length ? lista.map(function (e) {
            return '<label class="ui-check"><input type="checkbox" value="' + esc(e.rfc) + '"' + (marcadas.has(e.rfc) ? " checked" : "") + "><span>" + esc(e.alias) +
                (e.alias !== e.rfc ? " <small>" + esc(e.rfc) + "</small>" : "") + "</span></label>";
        }).join("") : '<p class="ev-empresas__vacio">' + (E.op.empresas.length ? "Ninguna empresa coincide con la búsqueda." : "Todavía no tienes empresas en tu directorio.") + "</p>";
        $("ev-emp-cuenta").textContent = plural(marcadas.size, "elegida", "elegidas") + " de " + E.op.empresas.length;
    }
    function abrirForm(e) {
        E.editando = e || null;
        E.marcadas = new Set(e ? e.empresas : []);
        var c = e ? e.contenido : { xml: ["recibidos", "pagos"], excel: [{ que: "conciliacion_emitidos" }, { que: "pagos" }] };      // lo que pidió Alan, de fábrica
        $("ev-dlg-titulo").textContent = e ? "Editar envío" : "Nuevo envío";
        $("ev-dlg-sub").textContent = "Se manda solo, a las " + E.hora + " de la mañana del día que toque. El ZIP va adjunto si pesa hasta " + E.tope + " MB, y siempre con su enlace.";
        $("ev-nombre").value = e ? e.nombre : ""; $("ev-para").value = e ? e.para.join(", ") : ""; $("ev-cc").value = e ? (e.cc || []).join(", ") : "";
        $("ev-emp-buscar").value = "";
        $("ev-xml").innerHTML = E.op.xml.map(function (x) {
            return '<label class="ui-check"><input type="checkbox" value="' + esc(x.clave) + '"' + (c.xml.indexOf(x.clave) !== -1 ? " checked" : "") + "> " + esc(x.nombre) + "</label>";
        }).join("");
        $("ev-excel").innerHTML = E.op.excel.map(function (x) {
            var puesto = (c.excel || []).find(function (y) { return y.que === x.clave; });
            return '<div class="ev-excel__fila"><label class="ui-check"><input type="checkbox" value="' + esc(x.clave) + '"' + (puesto ? " checked" : "") + "> <span>" + esc(x.nombre) + "</span></label>" +
                '<select class="ui-select" data-vista="' + esc(x.clave) + '" aria-label="Columnas de ' + esc(x.nombre) + '"><option value="">Columnas de fábrica</option>' +
                x.vistas.map(function (v) { return '<option value="' + v.id + '"' + (puesto && puesto.vista === v.id ? " selected" : "") + ">Vista: " + esc(v.nombre) + "</option>"; }).join("") + "</select></div>";
        }).join("");
        $("ev-frecuencia").value = e ? e.frecuencia : "semanal";
        pintarDias();
        $("ev-dia").value = String(e ? e.dia : 0);
        $("ev-dias-enlace").value = String(e && [3, 7, 15, 30].indexOf(e.dias_enlace) !== -1 ? e.dias_enlace : 7);
        document.querySelector('input[name="ev-modo"][value="' + (e && e.modo === "mes" ? "mes" : "nuevo") + '"]').checked = true;
        $("ev-avisar").checked = !!(e && e.avisar_sin_novedades);
        $("ev-borrar").hidden = !e; $("ev-error").hidden = true;
        pintarEmpresas();
        if (!$("ev-dlg").open) $("ev-dlg").showModal();
        $("ev-nombre").focus();
    }
    function leerForm() {
        return {
            nombre: $("ev-nombre").value, para: $("ev-para").value, cc: $("ev-cc").value, empresas: Array.from(E.marcadas),
            contenido: {
                xml: Array.from($("ev-xml").querySelectorAll("input:checked")).map(function (i) { return i.value; }),
                excel: Array.from($("ev-excel").querySelectorAll("input:checked")).map(function (i) {
                    var v = $("ev-excel").querySelector('[data-vista="' + i.value + '"]').value;
                    return { que: i.value, vista: v ? Number(v) : null };
                })
            },
            frecuencia: $("ev-frecuencia").value, dia: Number($("ev-dia").value) || 0, modo: document.querySelector('input[name="ev-modo"]:checked').value,
            dias_enlace: Number($("ev-dias-enlace").value) || 7, avisar_sin_novedades: $("ev-avisar").checked, activa: E.editando ? E.editando.activa : true
        };
    }
    async function guardar() {
        var b = $("ev-guardar"), err = $("ev-error");
        err.hidden = true; b.disabled = true;
        try {
            await mandar("/api/entregas" + (E.editando ? "/" + E.editando.id : ""), E.editando ? "PUT" : "POST", leerForm());
            $("ev-dlg").close();
            await cargar();
            Fiscontable.toast(E.editando ? "Envío guardado." : "Envío creado. Puedes probarlo con «Enviar ahora».");
        } catch (e) { err.textContent = e.message; err.hidden = false; }
        finally { b.disabled = false; }
    }

    /* ============================================================ el historial */
    function hecho(v) {
        var est = ESTADOS[v.estado] || [v.estado, "info"];
        var lineas = (v.detalle.empresas || []).filter(function (d) { return d.meses.length; }).map(function (d) {
            return "<li><b>" + esc(d.alias) + "</b>: " + d.meses.map(function (m) {
                var partes = Object.keys(m.partes).map(function (p) { return m.partes[p] + " " + ((E.op.xml.find(function (x) { return x.clave === p; }) || {}).nombre || p).toLowerCase(); });
                if (m.excel.length) partes.push(plural(m.excel.length, "Excel", "Excel"));
                return esc(m.mes.slice(5) + "/" + m.mes.slice(0, 4) + " (" + partes.join(", ") + ")");
            }).join(" · ") + "</li>";
        }).join("");
        var pie = "";
        if (v.estado === "enviado") {
            pie = "<span>" + esc(peso(v.bytes) + (v.adjunto ? " · fue adjunto" : " · solo enlace") + " · " + plural(v.descargas, "descarga", "descargas")) + "</span>" +
                (v.enlace_activo ? "<span>El enlace vence el " + esc(cuando(v.vence)) + "</span>" +
                    '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-copiar="' + esc(v.url) + '">Copiar enlace</button>' +
                    '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-revocar="' + esc(v.id) + '">Revocar</button>'
                    : "<span>" + (v.revocado ? "Enlace revocado: el archivo ya se borró." : "Enlace vencido: el archivo ya se borró.") + "</span>");
        }
        return '<article class="ev-hecho"><header><b>' + esc(cuando(v.momento, true)) + '</b><span class="ui-estado ui-estado--' + est[1] + '">' + esc(est[0]) + "</span></header>" +
            (v.error ? '<p class="ev-hecho__error">' + esc(v.error) + "</p>" : "") +
            (lineas ? "<ul>" + lineas + "</ul>" : "") +
            '<div class="ev-hecho__pie"><span>A ' + esc((v.para || []).join(", ")) + " · " + esc(v.quien === "programado" ? "automático" : "lo pidió " + v.quien) + "</span>" + pie + "</div></article>";
    }
    async function cargarHistorial() {
        var e = E.histDe, cuerpo = $("ev-hist-cuerpo");
        try {
            var r = await api("/api/entregas/" + encodeURIComponent(e.id) + "/historial");
            cuerpo.innerHTML = r.envios.length ? '<div class="ev-hist">' + r.envios.map(hecho).join("") + "</div>"
                : '<div class="ui-vacio"><b>Todavía no se ha mandado</b><span>Pruébalo con «Enviar ahora» o espera al ' + esc(cuando(e.proxima)) + ".</span></div>";
            clearTimeout(E.relojHist);
            if ((r.en_curso || r.envios.some(function (v) { return v.estado === "armando"; })) && $("ev-hist").open) E.relojHist = setTimeout(cargarHistorial, 3000);
            else if (E.esperando) { E.esperando = false; cargar().catch(function () { /* nada */ }); }
        } catch (err) {
            cuerpo.innerHTML = '<div class="ui-falla"><b>No se pudo cargar el historial</b><span>' + esc(err.message) + "</span></div>";
        }
    }
    function abrirHistorial(e) {
        E.histDe = e;
        $("ev-hist-titulo").textContent = "Historial · " + e.nombre;
        $("ev-hist-sub").textContent = e.cada + " · " + plural(e.empresas.length, "empresa", "empresas");
        $("ev-hist-cuerpo").innerHTML = '<p class="ui-ayuda">Cargando…</p>';
        if (!$("ev-hist").open) $("ev-hist").showModal();
        cargarHistorial();
    }

    /* ============================================================ arranque */
    function de(el) { var a = el.closest("[data-id]"); return a ? E.envios.find(function (e) { return e.id === a.dataset.id; }) : null; }
    function fallo(e) { Fiscontable.toast(e.message); }

    async function iniciar() {
        if (!(await Fiscontable.exigirModulo("validador"))) return;
        try {
            E.op = await api("/api/entregas/opciones");
            await cargar();
        } catch (e) {
            $("ev-aviso").textContent = e.message; $("ev-aviso").hidden = false;
            return;
        }
        $("ev-nuevo").addEventListener("click", function () { abrirForm(null); });
        $("ev-lista").addEventListener("click", async function (ev) {
            var b = ev.target.closest("[data-accion]"); if (!b || b.type === "checkbox") return;
            var accion = b.dataset.accion, e = de(b);
            if (accion === "nuevo") return abrirForm(null);
            if (!e) return;
            if (accion === "editar") return abrirForm(e);
            if (accion === "historial") return abrirHistorial(e);
            if (accion === "enviar") {
                var si = await Fiscontable.confirmar({ titulo: "¿Mandar «" + e.nombre + "» ahora?", si: "Enviar ahora",
                    texto: "Se arma con lo que hay en este momento y sale a " + e.para.concat(e.cc || []).join(", ") + ". No cambia la fecha del próximo envío automático." });
                if (!si) return;
                b.disabled = true;
                try { await mandar("/api/entregas/" + encodeURIComponent(e.id) + "/enviar", "POST"); E.esperando = true; abrirHistorial(e); await cargar(); }
                catch (err) { b.disabled = false; fallo(err); }
            }
        });
        $("ev-lista").addEventListener("change", async function (ev) {
            var i = ev.target.closest('[data-accion="activar"]'); if (!i) return;
            var e = de(i); if (!e) return;
            try { await mandar("/api/entregas/" + encodeURIComponent(e.id), "PUT", Object.assign({}, e, { para: e.para.join(", "), cc: (e.cc || []).join(", "), activa: i.checked })); await cargar(); }
            catch (err) { i.checked = !i.checked; fallo(err); }
        });
        // formulario
        $("ev-frecuencia").addEventListener("change", pintarDias);
        $("ev-emp-buscar").addEventListener("input", pintarEmpresas);
        $("ev-empresas").addEventListener("change", function (ev) {
            if (ev.target.checked) E.marcadas.add(ev.target.value); else E.marcadas.delete(ev.target.value);
            $("ev-emp-cuenta").textContent = plural(E.marcadas.size, "elegida", "elegidas") + " de " + E.op.empresas.length;
        });
        $("ev-dlg").addEventListener("click", function (ev) {
            var b = ev.target.closest("[data-ev]"); if (!b) return;
            if (b.dataset.ev === "cerrar") return $("ev-dlg").close();
            if (b.dataset.ev === "todas") { $("ev-empresas").querySelectorAll("input").forEach(function (i) { E.marcadas.add(i.value); }); pintarEmpresas(); }
            if (b.dataset.ev === "ninguna") { E.marcadas.clear(); pintarEmpresas(); }
        });
        $("ev-form").addEventListener("submit", function (ev) { ev.preventDefault(); guardar(); });
        $("ev-guardar").addEventListener("click", guardar);
        $("ev-borrar").addEventListener("click", async function () {
            var e = E.editando; if (!e) return;
            var si = await Fiscontable.confirmar({ titulo: "¿Borrar «" + e.nombre + "»?", si: "Borrar", peligro: true,
                texto: "Deja de mandarse y se borran su historial y los archivos que sigan en el servidor: los enlaces que ya mandaste dejan de servir." });
            if (!si) return;
            try { await mandar("/api/entregas/" + encodeURIComponent(e.id), "DELETE"); $("ev-dlg").close(); await cargar(); Fiscontable.toast("Envío borrado."); }
            catch (err) { fallo(err); }
        });
        // historial
        $("ev-hist").addEventListener("click", async function (ev) {
            if (ev.target.closest('[data-ev="cerrar-hist"]')) { clearTimeout(E.relojHist); return $("ev-hist").close(); }
            var c = ev.target.closest("[data-copiar]");
            if (c) {
                try { await navigator.clipboard.writeText(c.dataset.copiar); Fiscontable.toast("Enlace copiado."); } catch (x) { window.prompt("Copia el enlace:", c.dataset.copiar); }
                return;
            }
            var r = ev.target.closest("[data-revocar]");
            if (r) {
                var si = await Fiscontable.confirmar({ titulo: "¿Revocar el enlace?", si: "Revocar", peligro: true, texto: "Deja de servir en este momento y el archivo se borra del servidor. Lo que ya se bajó o llegó adjunto no cambia." });
                if (!si) return;
                try { await mandar("/api/entregas/hechos/" + encodeURIComponent(r.dataset.revocar) + "/revocar", "POST"); await cargarHistorial(); }
                catch (err) { fallo(err); }
            }
        });
    }
    document.addEventListener("DOMContentLoaded", iniciar);
})();
