/**
 * envios.js — Envíos por correo (18-nov-2026).
 *
 * Alan: «que automaticemos el envío de los XML, PDF y Excel por correo… un ZIP por empresa y mes, se juntan todas las
 * empresas seleccionadas, se hace un ZIP y se manda; si pesa más, un enlace que vence. Esto es la necesidad de un despacho.»
 * Y por la tarde: «que no sea solo lo nuevo… se valida lo que se vaya a enviar»; «envío 1, envío 2… hasta 5… se check y se
 * habilita»; «a un grupo o a cada cliente»; «igual para las constancias y opiniones»; los correos, «como el Cloudflare».
 *
 * La página lista los envíos de la cuenta (hasta 5: a quién, qué llevan, cada cuánto), deja crear, cambiar, pausar, mandar
 * ahora y ver el historial con su enlace, y trae la tabla de casillas «Envío 1…5» por empresa. En un despacho, los envíos y
 * sus destinatarios los define el titular; los demás solo marcan sus empresas. Todo lo demás (verificar contra el SAT,
 * armar el ZIP, el correo, el programador) lo hace el servidor: modulos/entregas.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var E = { envios: [], op: null, editando: null, histDe: null, reloj: 0, tope: 15, max: 5, titular: true, correos: {} };

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
    function de(lista, clave) { return (lista.find(function (x) { return x.clave === clave; }) || {}).nombre || clave; }
    var ESTADOS = { enviado: ["Enviado", "ok"], sin_novedades: ["Nada que mandar (no se envió)", "info"], sin_novedades_avisado: ["Nada que mandar (se avisó)", "info"],
                    error: ["No salió", "error"], armando: ["Verificando y armando…", "aviso"] };
    var VERIFICA = { completo: "ok", parcial: "aviso", pendiente: "aviso", sin: "aviso" };

    /* ============================================================ correos como pastillas
       Como el campo de correos de Cloudflare: se escribe uno y con Enter, coma, espacio o al salir del campo queda como
       pastilla con su «×»; Retroceso en el campo vacío quita la última; pegar varios los separa. */
    var CORREO = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/;
    function pastillas(caja) {
        var lista = [], campo = document.createElement("input");
        campo.type = "email"; campo.autocomplete = "off"; campo.spellcheck = false; campo.setAttribute("aria-label", "Agregar correo");
        caja.appendChild(campo);
        function pintar() {
            caja.querySelectorAll(".ev-pastilla").forEach(function (p) { p.remove(); });
            lista.forEach(function (c, i) {
                var p = document.createElement("span"); p.className = "ev-pastilla";
                p.innerHTML = "<span>" + esc(c) + '</span><button type="button" data-quitar="' + i + '" aria-label="Quitar ' + esc(c) + '">×</button>';
                caja.insertBefore(p, campo);
            });
            campo.placeholder = lista.length ? "" : (caja.dataset.vacio || "");
        }
        function agregar(texto) {
            var malos = [];
            String(texto || "").split(/[\s,;]+/).forEach(function (c) {
                c = c.trim().toLowerCase();
                if (!c) return;
                if (!CORREO.test(c)) malos.push(c); else if (lista.indexOf(c) === -1) lista.push(c);
            });
            caja.classList.toggle("ev-correos--error", !!malos.length);
            campo.value = malos.join(" ");
            pintar();
            caja.dispatchEvent(new CustomEvent("cambio"));
            return !malos.length;
        }
        campo.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === "," || e.key === ";" || e.key === " ") { if (campo.value.trim()) { e.preventDefault(); agregar(campo.value); } else if (e.key !== "Enter") e.preventDefault(); }
            else if (e.key === "Backspace" && !campo.value && lista.length) { lista.pop(); pintar(); caja.dispatchEvent(new CustomEvent("cambio")); }
        });
        campo.addEventListener("blur", function () { if (campo.value.trim()) agregar(campo.value); });
        campo.addEventListener("paste", function (e) {
            var t = (e.clipboardData || window.clipboardData).getData("text");
            if (/[\s,;]/.test(t.trim())) { e.preventDefault(); agregar(campo.value + " " + t); }
        });
        campo.addEventListener("input", function () { caja.classList.remove("ev-correos--error"); });
        caja.addEventListener("click", function (e) {
            var q = e.target.closest("[data-quitar]");
            if (q) { lista.splice(Number(q.dataset.quitar), 1); pintar(); caja.dispatchEvent(new CustomEvent("cambio")); }
            campo.focus();
        });
        pintar();
        return {
            poner: function (v) { lista = (v || []).slice(); campo.value = ""; caja.classList.remove("ev-correos--error"); pintar(); },
            valores: function () { if (campo.value.trim()) agregar(campo.value); return lista.slice(); },
            pendiente: function () { return campo.value.trim(); },
            tiene: function (c) { return lista.indexOf(c) !== -1; },
            alternar: function (c, dentro) { var i = lista.indexOf(c); if (dentro && i === -1) lista.push(c); if (!dentro && i !== -1) lista.splice(i, 1); pintar(); }
        };
    }

    /* ============================================================ la lista */
    function lleva(c) {
        var xml = (c.xml || []).map(function (k) { return de(E.op.xml, k); });
        var n = (c.excel || []).length, docs = (c.docs || []).map(function (k) { return k === "csf" ? "constancia" : "opinión 32-D"; });
        return [xml.length ? "XML y PDF de " + xml.join(", ").toLowerCase() : "", n ? plural(n, "Excel", "Excel") : "", docs.join(" y ")].filter(Boolean).join(" · ");
    }
    function ultimo(e) {
        if (e.en_curso) return '<p class="ev-ultimo">Se está verificando y armando ahora…</p>';
        var u = e.ultimo;
        if (!u) return '<p class="ev-ultimo">Todavía no se ha mandado.</p>';
        if (u.estado === "error") return '<p class="ev-ultimo ev-ultimo--error"><b>El último no salió</b> (' + esc(cuando(u.momento, true)) + "): " + esc(u.error || "") + "</p>";
        var txt = u.estado === "enviado" ? plural(u.comprobantes, "comprobante", "comprobantes") + " · " + peso(u.bytes) + (u.adjunto ? " · adjunto y enlace" : " · solo enlace")
            : "nada que mandar";
        return '<p class="ev-ultimo">Último: ' + esc(cuando(u.momento, true)) + " · " + esc(txt) + "</p>";
    }
    function pintar() {
        var caja = $("ev-lista");
        caja.classList.toggle("ev-solo-lectura", !E.titular);
        $("ev-nuevo").hidden = !E.titular || E.envios.length >= E.max;
        if (!E.envios.length) {
            caja.innerHTML = '<div class="ui-vacio ev-vacio"><b>Todavía no hay envíos</b><span>' + (E.titular
                ? "Crea hasta " + E.max + " para que los XML, PDF, Excel, constancias y opiniones de tus empresas salgan solos por correo."
                : "Los define el titular del despacho. Cuando existan, aquí marcas cuáles de tus empresas van en cada uno.") + "</span>" +
                (E.titular ? '<button type="button" class="ui-btn ui-btn--primario ui-btn--32" data-accion="nuevo">+ Nuevo envío</button>' : "") + "</div>";
            pintarMatriz();
            return;
        }
        caja.innerHTML = E.envios.map(function (e) {
            var emp = e.empresas.length ? plural(e.empresas.length, "empresa", "empresas") + ": " + e.empresas.slice(0, 3).map(nombreEmpresa).join(", ") +
                (e.empresas.length > 3 ? " y " + (e.empresas.length - 3) + " más" : "") : "ninguna todavía: márcalas abajo";
            var para = e.destino === "cliente" ? "cada cliente, a su correo" + (e.para.concat(e.cc || []).length ? " · copia a " + e.para.concat(e.cc || []).join(", ") : "")
                : e.para.concat(e.cc || []).join(", ");
            return '<article class="ui-tarjeta ev-tarjeta' + (e.activa ? "" : " ev-tarjeta--pausado") + '" data-id="' + esc(e.id) + '">' +
                '<header><div><h2><span class="ev-num">' + e.numero + "</span>" + esc(e.nombre) + "</h2><small>" + esc(e.cada) + " · " + (e.modo === "mes" ? "el mes completo, verificado" : "solo lo nuevo") + "</small></div>" +
                '<label class="ui-switch" title="' + (e.activa ? "Encendido: se manda solo. Apágalo para pausarlo." : "Apagado: no se manda solo.") + '"><input type="checkbox" data-accion="activar"' +
                (e.activa ? " checked" : "") + ' aria-label="Encendido"><span class="ui-switch__riel"></span></label></header>' +
                '<dl class="ev-datos"><div><dt>Para</dt><dd>' + esc(para) + "</dd></div>" +
                "<div><dt>Empresas</dt><dd>" + esc(emp) + "</dd></div>" +
                "<div><dt>Lleva</dt><dd>" + esc(lleva(e.contenido)) + "</dd></div>" +
                "<div><dt>Próximo</dt><dd>" + (e.activa ? esc(cuando(e.proxima)) + ", " + E.hora + ":00" : "apagado") + "</dd></div></dl>" +
                ultimo(e) +
                '<div class="ev-acciones"><button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-accion="enviar"' + (e.en_curso || !e.empresas.length ? " disabled" : "") + ">Enviar ahora</button>" +
                '<button type="button" class="ui-btn ui-btn--terciario ui-btn--32" data-accion="historial">Historial</button>' +
                '<button type="button" class="ui-btn ui-btn--terciario ui-btn--32" data-accion="editar">Editar</button></div></article>';
        }).join("");
        pintarMatriz();
    }
    async function cargar() {
        var r = await api("/api/entregas");
        E.envios = r.envios; E.tope = r.tope_adjunto_mb; E.hora = r.hora; E.limite = r.hora_limite; E.max = r.max; E.titular = r.titular;
        pintar();
        clearTimeout(E.reloj);
        if (E.envios.some(function (e) { return e.en_curso; })) E.reloj = setTimeout(function () { cargar().catch(function () { /* se reintenta al siguiente */ }); }, 4000);
    }

    /* ============================================================ las casillas «Envío 1…5» por empresa */
    function visibles() {
        var q = $("ev-matriz-buscar").value.trim().toLowerCase();
        return E.op.empresas.filter(function (e) { return !q || e.alias.toLowerCase().indexOf(q) !== -1 || e.rfc.toLowerCase().indexOf(q) !== -1; });
    }
    function pintarMatriz() {
        var sec = $("ev-matriz");
        sec.hidden = !E.envios.length || !E.op.empresas.length;
        if (sec.hidden) return;
        var lista = visibles();
        $("ev-matriz-enc").innerHTML = "<tr><th>Empresa</th>" + E.envios.map(function (e) {
            var todas = lista.length && lista.every(function (x) { return e.empresas.indexOf(x.rfc) !== -1; });
            return '<th class="ev-col' + (e.activa ? "" : " ev-col--apagado") + '"><label title="Marcar o quitar todas las que ves en «' + esc(e.nombre) + '»"><span>Envío ' + e.numero + "</span><small>" + esc(e.nombre) +
                '</small><input type="checkbox" data-todas="' + esc(e.id) + '"' + (todas ? " checked" : "") + ' aria-label="Todas las que ves en Envío ' + e.numero + '"></label></th>';
        }).join("") + "</tr>";
        $("ev-matriz-cuerpo").innerHTML = lista.length ? lista.map(function (x) {
            return "<tr><td>" + esc(x.alias) + (x.alias !== x.rfc ? " <small>" + esc(x.rfc) + "</small>" : "") + "</td>" + E.envios.map(function (e) {
                return '<td class="ev-col"><input type="checkbox" data-envio="' + esc(e.id) + '" data-rfc="' + esc(x.rfc) + '"' + (e.empresas.indexOf(x.rfc) !== -1 ? " checked" : "") +
                    ' aria-label="' + esc(x.alias) + " en Envío " + e.numero + '"></td>';
            }).join("") + "</tr>";
        }).join("") : '<tr><td colspan="' + (E.envios.length + 1) + '">Ninguna empresa coincide con la búsqueda.</td></tr>';
    }
    async function asignar(id, rfcs, dentro, casilla) {
        try {
            var r = await mandar("/api/entregas/" + encodeURIComponent(id) + "/empresas", "POST", { rfcs: rfcs, dentro: dentro });
            var e = E.envios.find(function (x) { return x.id === id; });
            if (e) e.empresas = r.empresas;
            pintar();
        } catch (err) { if (casilla) casilla.checked = !casilla.checked; Fiscontable.toast(err.message); }
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
    function pintarDestino() {
        var cliente = document.querySelector('input[name="ev-destino"]:checked').value === "cliente";
        $("ev-para-etq").innerHTML = cliente ? "Copia <i>(opcional: además del correo de cada cliente)</i>" : "Para";
    }
    function pintarUsuarios() {
        var us = E.op.usuarios || [];
        $("ev-usuarios-caja").hidden = !us.length;
        $("ev-usuarios").innerHTML = us.map(function (u) {
            return '<label class="ui-check"><input type="checkbox" value="' + esc(u.correo) + '"' + (E.correos.cc.tiene(u.correo) ? " checked" : "") + "> <span>" + esc(u.nombre) +
                (u.nombre !== u.correo ? " <small>" + esc(u.correo) + "</small>" : "") + "</span></label>";
        }).join("");
    }
    function pintarEmpresas() {
        var q = $("ev-emp-buscar").value.trim().toLowerCase(), marcadas = E.marcadas;
        var lista = E.op.empresas.filter(function (e) { return !q || e.alias.toLowerCase().indexOf(q) !== -1 || e.rfc.toLowerCase().indexOf(q) !== -1; });
        $("ev-empresas").innerHTML = lista.length ? lista.map(function (e) {
            return '<label class="ui-check"><input type="checkbox" value="' + esc(e.rfc) + '"' + (marcadas.has(e.rfc) ? " checked" : "") + "><span>" + esc(e.alias) +
                (e.alias !== e.rfc ? " <small>" + esc(e.rfc) + "</small>" : "") + "</span></label>";
        }).join("") : '<p class="ev-empresas__vacio">' + (E.op.empresas.length ? "Ninguna empresa coincide con la búsqueda." : "Todavía no tienes empresas en tu directorio.") + "</p>";
        $("ev-emp-cuenta").textContent = plural(marcadas.size, "elegida", "elegidas") + " de " + E.op.empresas.length + " · también se marcan después, con sus casillas";
    }
    function abrirForm(e) {
        E.editando = e || null;
        E.marcadas = new Set(e ? e.empresas : []);
        var c = e ? e.contenido : { xml: ["recibidos", "pagos"], excel: [{ que: "conciliacion_emitidos" }, { que: "pagos" }], docs: [] };      // lo que pidió Alan, de fábrica
        $("ev-dlg-titulo").textContent = e ? "Editar Envío " + e.numero : "Nuevo envío";
        $("ev-dlg-sub").textContent = "Se manda solo, a las " + E.hora + " de la mañana del día que toque. El ZIP va adjunto si pesa hasta " + E.tope + " MB, y siempre con su enlace.";
        $("ev-verifica-txt").textContent = "Antes de mandar se pide al SAT la lista de cada empresa para comprobar que estén todos los XML, y se valida el estado de lo que va. " +
            "Si a las " + E.limite + ":00 el SAT no ha contestado, sale con la anotación de qué empresa quedó sin verificar.";
        $("ev-nombre").value = e ? e.nombre : ""; $("ev-nombre").placeholder = e ? "" : "Envío " + (E.envios.length + 1) + " (o el nombre que quieras)";
        E.correos.para.poner(e ? e.para : []); E.correos.cc.poner(e ? e.cc : []);
        document.querySelector('input[name="ev-destino"][value="' + (e && e.destino === "cliente" ? "cliente" : "grupo") + '"]').checked = true;
        pintarDestino(); pintarUsuarios();
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
        $("ev-docs").innerHTML = E.op.docs.map(function (x) {
            return '<label class="ui-check"><input type="checkbox" value="' + esc(x.clave) + '"' + ((c.docs || []).indexOf(x.clave) !== -1 ? " checked" : "") + "> " + esc(x.nombre) + "</label>";
        }).join("");
        $("ev-frecuencia").value = e ? e.frecuencia : "semanal";
        pintarDias();
        $("ev-dia").value = String(e ? e.dia : 0);
        $("ev-dias-enlace").value = String(e && [3, 7, 15, 30].indexOf(e.dias_enlace) !== -1 ? e.dias_enlace : 7);
        document.querySelector('input[name="ev-modo"][value="' + (e && e.modo === "nuevo" ? "nuevo" : "mes") + '"]').checked = true;
        $("ev-avisar").checked = !!(e && e.avisar_sin_novedades);
        $("ev-borrar").hidden = !e; $("ev-error").hidden = true;
        pintarEmpresas();
        if (!$("ev-dlg").open) $("ev-dlg").showModal();
        $("ev-nombre").focus();
    }
    function leerForm() {
        return {
            nombre: $("ev-nombre").value, para: E.correos.para.valores().join(", "), cc: E.correos.cc.valores().join(", "), empresas: Array.from(E.marcadas),
            destino: document.querySelector('input[name="ev-destino"]:checked').value,
            contenido: {
                xml: Array.from($("ev-xml").querySelectorAll("input:checked")).map(function (i) { return i.value; }),
                excel: Array.from($("ev-excel").querySelectorAll("input:checked")).map(function (i) {
                    var v = $("ev-excel").querySelector('[data-vista="' + i.value + '"]').value;
                    return { que: i.value, vista: v ? Number(v) : null };
                }),
                docs: Array.from($("ev-docs").querySelectorAll("input:checked")).map(function (i) { return i.value; })
            },
            frecuencia: $("ev-frecuencia").value, dia: Number($("ev-dia").value) || 0, modo: document.querySelector('input[name="ev-modo"]:checked').value,
            dias_enlace: Number($("ev-dias-enlace").value) || 7, avisar_sin_novedades: $("ev-avisar").checked, activa: E.editando ? E.editando.activa : true
        };
    }
    async function guardar() {
        var b = $("ev-guardar"), err = $("ev-error");
        err.hidden = true;
        var datos = leerForm();
        if (E.correos.para.pendiente() || E.correos.cc.pendiente()) {           // lo escrito no es un correo: no se guarda a medias
            err.textContent = "Revisa los correos: «" + (E.correos.para.pendiente() || E.correos.cc.pendiente()) + "» no parece un correo."; err.hidden = false;
            return;
        }
        b.disabled = true;
        try {
            await mandar("/api/entregas" + (E.editando ? "/" + E.editando.id : ""), E.editando ? "PUT" : "POST", datos);
            $("ev-dlg").close();
            await cargar();
            Fiscontable.toast(E.editando ? "Envío guardado." : "Envío creado. Marca sus empresas y pruébalo con «Enviar ahora».");
        } catch (e) { err.textContent = e.message; err.hidden = false; }
        finally { b.disabled = false; }
    }

    /* ============================================================ el historial */
    function hecho(v) {
        var est = ESTADOS[v.estado] || [v.estado, "info"];
        var lineas = (v.detalle.empresas || []).filter(function (d) { return d.meses.length || (d.docs || []).length || d.verificacion; }).map(function (d) {
            var meses = d.meses.map(function (m) {
                var partes = Object.keys(m.partes).map(function (p) { return m.partes[p] + " " + de(E.op.xml, p).toLowerCase(); });
                if (m.excel.length) partes.push(plural(m.excel.length, "Excel", "Excel"));
                return esc(m.mes.slice(5) + "/" + m.mes.slice(0, 4) + " (" + partes.join(", ") + ")");
            }).join(" · ");
            var docs = (d.docs || []).map(function (x) { return (x.tipo === "csf" ? "constancia" : "opinión 32-D") + (x.fecha ? " del " + x.fecha.slice(8, 10) + "/" + x.fecha.slice(5, 7) : ""); })
                .concat((d.sin_docs || []).map(function (x) { return "sin " + (x === "csf" ? "constancia" : "opinión 32-D") + " guardada"; })).join(", ");
            var ver = d.verificacion ? '<br><small><span class="ui-estado ui-estado--' + (VERIFICA[d.verificacion.estado] || "info") + '">' + esc(d.verificacion.texto) + "</span>" +
                (d.validacion && d.validacion.pendientes ? " · " + d.validacion.pendientes + " sin validar su estado (el SAT no respondió)" : "") + "</small>" : "";
            return "<li><b>" + esc(d.alias) + "</b>: " + ([meses || (docs ? "" : "nada del periodo"), esc(docs)].filter(Boolean).join(" · ")) + ver + "</li>";
        }).join("");
        var pie = "";
        // Si el correo falló pero el archivo sí se armó, su enlace sirve igual: se puede copiar y mandar a mano
        if (v.estado === "enviado" || (v.estado === "error" && v.enlace_activo)) {
            pie = "<span>" + esc(peso(v.bytes) + (v.estado === "error" ? " · el archivo sí se armó" : v.adjunto ? " · fue adjunto" : " · solo enlace") + " · " + plural(v.descargas, "descarga", "descargas")) + "</span>" +
                (v.enlace_activo ? "<span>El enlace vence el " + esc(cuando(v.vence)) + "</span>" +
                    '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-copiar="' + esc(v.url) + '">Copiar enlace</button>' +
                    (E.titular ? '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-revocar="' + esc(v.id) + '">Revocar</button>' : "")
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
        $("ev-hist-titulo").textContent = "Historial · Envío " + e.numero + (e.nombre !== "Envío " + e.numero ? " · " + e.nombre : "");
        $("ev-hist-sub").textContent = e.cada + " · " + plural(e.empresas.length, "empresa", "empresas");
        $("ev-hist-cuerpo").innerHTML = '<p class="ui-ayuda">Cargando…</p>';
        if (!$("ev-hist").open) $("ev-hist").showModal();
        cargarHistorial();
    }

    /* ============================================================ arranque */
    function deTarjeta(el) { var a = el.closest("[data-id]"); return a ? E.envios.find(function (e) { return e.id === a.dataset.id; }) : null; }
    function fallo(e) { Fiscontable.toast(e.message); }
    function cuerpoDe(e, cambios) {      // un envío tal como está, listo para volver a guardarlo con algún cambio
        return Object.assign({}, e, { para: e.para.join(", "), cc: (e.cc || []).join(", ") }, cambios);
    }

    async function iniciar() {
        if (!(await Fiscontable.exigirModulo("validador"))) return;
        E.correos.para = pastillas($("ev-para")); E.correos.cc = pastillas($("ev-cc"));
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
            var accion = b.dataset.accion, e = deTarjeta(b);
            if (accion === "nuevo") return abrirForm(null);
            if (!e) return;
            if (accion === "editar") return abrirForm(e);
            if (accion === "historial") return abrirHistorial(e);
            if (accion === "enviar") {
                var aQuien = e.destino === "cliente" ? "cada cliente, a su correo" : e.para.concat(e.cc || []).join(", ");
                var si = await Fiscontable.confirmar({ titulo: "¿Mandar el Envío " + e.numero + " ahora?", si: "Enviar ahora",
                    texto: "Se verifica y se arma con lo que hay en este momento, y sale a " + aQuien + ". No cambia la fecha del próximo envío automático." });
                if (!si) return;
                b.disabled = true;
                try { await mandar("/api/entregas/" + encodeURIComponent(e.id) + "/enviar", "POST"); E.esperando = true; abrirHistorial(e); await cargar(); }
                catch (err) { b.disabled = false; fallo(err); }
            }
        });
        $("ev-lista").addEventListener("change", async function (ev) {
            var i = ev.target.closest('[data-accion="activar"]'); if (!i) return;
            var e = deTarjeta(i); if (!e) return;
            try { await mandar("/api/entregas/" + encodeURIComponent(e.id), "PUT", cuerpoDe(e, { activa: i.checked })); await cargar(); }
            catch (err) { i.checked = !i.checked; fallo(err); }
        });
        // casillas por empresa
        $("ev-matriz-buscar").addEventListener("input", pintarMatriz);
        $("ev-matriz").addEventListener("change", function (ev) {
            var c = ev.target;
            if (c.dataset.envio) return asignar(c.dataset.envio, [c.dataset.rfc], c.checked, c);
            if (c.dataset.todas) return asignar(c.dataset.todas, visibles().map(function (x) { return x.rfc; }), c.checked, c);
        });
        // formulario
        $("ev-frecuencia").addEventListener("change", pintarDias);
        document.querySelectorAll('input[name="ev-destino"]').forEach(function (r) { r.addEventListener("change", pintarDestino); });
        $("ev-usuarios").addEventListener("change", function (ev) { E.correos.cc.alternar(ev.target.value, ev.target.checked); });
        $("ev-cc").addEventListener("cambio", pintarUsuarios);
        $("ev-emp-buscar").addEventListener("input", pintarEmpresas);
        $("ev-empresas").addEventListener("change", function (ev) {
            if (ev.target.checked) E.marcadas.add(ev.target.value); else E.marcadas.delete(ev.target.value);
            $("ev-emp-cuenta").textContent = plural(E.marcadas.size, "elegida", "elegidas") + " de " + E.op.empresas.length + " · también se marcan después, con sus casillas";
        });
        $("ev-dlg").addEventListener("click", function (ev) {
            var b = ev.target.closest("[data-ev]"); if (!b) return;
            if (b.dataset.ev === "cerrar") return $("ev-dlg").close();
            if (b.dataset.ev === "todas") { $("ev-empresas").querySelectorAll("input").forEach(function (i) { E.marcadas.add(i.value); }); pintarEmpresas(); }
            if (b.dataset.ev === "ninguna") { E.marcadas.clear(); pintarEmpresas(); }
        });
        $("ev-form").addEventListener("submit", function (ev) { ev.preventDefault(); });      // Enter en un campo de correos agrega la pastilla, no guarda
        $("ev-guardar").addEventListener("click", guardar);
        $("ev-borrar").addEventListener("click", async function () {
            var e = E.editando; if (!e) return;
            var si = await Fiscontable.confirmar({ titulo: "¿Borrar el Envío " + e.numero + "?", si: "Borrar", peligro: true,
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
