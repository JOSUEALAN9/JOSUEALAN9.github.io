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
    // Lo que el robot va haciendo con un envío en curso (18-nov): fila, lista del SAT, validación una por una, armado
    function textoAvance(a) {
        var miles = function (n) { return Number(n || 0).toLocaleString("es-MX"); };
        if (!a) return "Se está verificando y armando ahora…";
        if (a.fase === "fila") return "En la fila: empieza en cuanto termine el envío anterior.";
        if (a.fase === "verificando") return "Pidiendo al SAT la lista del mes…";
        if (a.fase === "validando") return a.total ? "Validando ante el SAT: " + miles(a.hechos) + " de " + miles(a.total) + "…" : "Validando ante el SAT…";
        if (a.fase === "esperando") return "Esperando la lista del SAT: llegaron " + miles(a.hechos) + " de " + miles(a.total) + " empresas (espera hasta " + (E.esperaListas || 15) + " min)…";
        return "Armando el ZIP y mandando el correo…";
    }
    function ultimo(e) {
        if (e.en_curso) return '<p class="ev-ultimo ev-ultimo--avance">' + esc(textoAvance(e.avance)) + "</p>";
        var u = e.ultimo;
        if (!u) return '<p class="ev-ultimo">Todavía no se ha mandado.</p>';
        if (u.estado === "error") return '<p class="ev-ultimo ev-ultimo--error"><b>El último no salió</b> (' + esc(cuando(u.momento, true)) + "): " + esc(u.error || "") + "</p>";
        var txt = u.estado === "enviado" ? plural(u.comprobantes, "comprobante", "comprobantes") + " · " + peso(u.bytes) + (u.en_descargas ? " · en Mis descargas" : u.adjunto ? " · adjunto y enlace" : " · solo enlace")
            : "nada que mandar";
        return '<p class="ev-ultimo">Último: ' + esc(cuando(u.momento, true)) + " · " + esc(txt) + "</p>";
    }
    function pintar() {
        var caja = $("ev-lista");
        caja.classList.toggle("ev-solo-lectura", !E.titular);
        $("ev-nuevo").hidden = !E.titular || E.envios.length >= E.max || !E.envios.length;      // vacío: el botón va en el propio aviso, uno solo
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
                "<div><dt>Próximo</dt><dd>" + (e.activa ? esc(cuando(e.proxima)) + ", " + E.hora + ":00" + (e.periodo_proximo ? " · lleva " + esc(e.periodo_proximo) : "") : "apagado") + "</dd></div></dl>" +
                ultimo(e) +
                '<div class="ev-acciones"><button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-accion="enviar"' + (e.en_curso || !e.empresas.length ? " disabled" : "") + ">Enviar ahora</button>" +
                '<button type="button" class="ui-btn ui-btn--terciario ui-btn--32" data-accion="historial">Historial</button>' +
                (E.titular && E.envios.length < E.max ? '<button type="button" class="ui-btn ui-btn--terciario ui-btn--32" data-accion="duplicar" title="Otro envío con esta misma configuración">Duplicar</button>' : "") +
                '<button type="button" class="ui-btn ui-btn--terciario ui-btn--32" data-accion="editar">Editar</button></div></article>';
        }).join("");
        pintarMatriz();
    }
    async function cargar() {
        var r = await api("/api/entregas");
        E.envios = r.envios; E.tope = r.tope_adjunto_mb; E.hora = r.hora; E.limite = r.hora_limite; E.max = r.max; E.titular = r.titular; E.esperaListas = r.espera_listas_min;
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
        // Plegada para el titular (ya marca las empresas en el formulario); abierta para quien solo puede marcar las suyas
        if (!E.matrizVista) { E.matrizVista = true; sec.open = !E.titular; }
        var marcadas = new Set(); E.envios.forEach(function (e) { e.empresas.forEach(function (r) { marcadas.add(r); }); });
        $("ev-matriz-cuenta").textContent = plural(marcadas.size, "empresa marcada", "empresas marcadas") + " de " + E.op.empresas.length;
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

    /* ============================================================ el formulario, en pasos */
    var PASOS = ["A quién", "Empresas", "Qué lleva", "Cuándo", "Mensaje"];
    var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    function mesTxt(m) { return MESES[Number(m.slice(5, 7)) - 1] + " " + m.slice(0, 4); }
    function periodoTxt(meses) {          // ["2026-10", "2026-11"] -> «octubre y noviembre 2026» (igual que el servidor)
        meses = meses.slice().sort();
        if (!meses.length) return "";
        var mismo = meses.every(function (m) { return m.slice(0, 4) === meses[0].slice(0, 4); });
        var partes = meses.map(function (m) { return mismo ? MESES[Number(m.slice(5, 7)) - 1] : mesTxt(m); });
        return (partes.length > 1 ? partes.slice(0, -1).join(", ") + " y " + partes[partes.length - 1] : partes[0]) + (mismo ? " " + meses[0].slice(0, 4) : "");
    }
    function mesDe(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
    function mesesDeHoy(frecuencia, cierre) {      // lo que llevaría «el mes completo» si saliera hoy
        var h = new Date(), actual = mesDe(h), anterior = mesDe(new Date(h.getFullYear(), h.getMonth() - 1, 1));
        return frecuencia === "mensual" ? [anterior] : (cierre !== false && h.getDate() <= 7) ? [anterior, actual] : [actual];
    }
    function pintarDias() {
        var f = $("ev-frecuencia").value, sel = $("ev-dia"), previo = sel.value;
        $("ev-dia-caja").hidden = f === "quincenal";
        if (f === "semanal") sel.innerHTML = E.op.dias_semana.map(function (d, i) { return '<option value="' + i + '">' + esc(d.charAt(0).toUpperCase() + d.slice(1)) + "</option>"; }).join("");
        else if (f === "mensual") { var h = ""; for (var i = 1; i <= 28; i++) h += '<option value="' + i + '">Día ' + i + "</option>"; sel.innerHTML = h; }
        if (sel.querySelector('option[value="' + previo + '"]')) sel.value = previo;
        pintarPeriodo();
    }
    function pintarPeriodo() {
        var mes = document.querySelector('input[name="ev-modo"]:checked').value === "mes", f = $("ev-frecuencia").value, cierre = $("ev-cierre").checked;
        $("ev-cierre-caja").hidden = !mes || f === "mensual";          // el mensual ES el cierre: siempre manda el mes anterior
        $("ev-modo-mes-txt").textContent = f === "mensual" ? "El mes anterior completo, ya cerrado."
            : cierre ? "El mes en curso completo cada vez (y, la primera semana, también el mes que acaba de cerrar)." : "El mes en curso completo cada vez.";
        $("ev-periodo-txt").textContent = mes ? "Si saliera hoy llevaría " + periodoTxt(mesesDeHoy(f, cierre)) + ". Para mandar otro mes una sola vez, usa «Enviar ahora» y elígelo ahí."
            : "Lleva lo que haya llegado desde el envío anterior. Para mandar un mes completo una sola vez, usa «Enviar ahora» y elígelo ahí.";
    }
    function pintarDestino() {
        var cliente = document.querySelector('input[name="ev-destino"]:checked').value === "cliente";
        $("ev-para-etq").innerHTML = cliente ? "Copia <i>(opcional: además del correo de cada cliente)</i>" : "Para";
        pintarLugar();
    }
    /* Dónde queda el paquete: en el correo (enlace que vence, con o sin adjunto) o en «Mis descargas» (el correo solo
       avisa). A cada cliente siempre va por correo: el cliente no entra a Fiscontable. */
    function enDescargas() { return document.querySelector('input[name="ev-lugar"]:checked').value === "descargas"; }
    function pintarLugar() {
        var cliente = document.querySelector('input[name="ev-destino"]:checked').value === "cliente";
        var desc = document.querySelector('input[name="ev-lugar"][value="descargas"]');
        if (cliente && desc.checked) document.querySelector('input[name="ev-lugar"][value="correo"]').checked = true;
        desc.disabled = cliente;
        $("ev-lugar-desc-txt").textContent = cliente ? "No aplica cuando va a cada cliente: el cliente no entra a Fiscontable."
            : "El correo y la campana solo avisan que ya está listo; se baja al entrar. En un despacho, cada persona ve lo de sus empresas. Se conserva " + (E.op.dias_descargas || 7) + " días.";
        var d = enDescargas();
        $("ev-adjuntar-caja").hidden = d; $("ev-dias-enlace-caja").hidden = d;
    }
    function pintarUsuarios() {
        var us = E.op.usuarios || [];
        $("ev-usuarios-caja").hidden = !us.length;
        $("ev-usuarios").innerHTML = us.map(function (u) {
            return '<label class="ui-check"><input type="checkbox" value="' + esc(u.correo) + '"' + (E.correos.cc.tiene(u.correo) ? " checked" : "") + "> <span>" + esc(u.nombre) +
                (u.nombre !== u.correo ? " <small>" + esc(u.correo) + "</small>" : "") + "</span></label>";
        }).join("");
    }
    /* --- empresas: lista desplegable con buscador; las elegidas, abajo, como pastillas */
    function pintarEmpresas() {
        var q = $("ev-emp-buscar").value.trim().toLowerCase(), marcadas = E.marcadas;
        var lista = E.op.empresas.filter(function (e) { return !q || e.alias.toLowerCase().indexOf(q) !== -1 || e.rfc.toLowerCase().indexOf(q) !== -1; });
        $("ev-empresas").innerHTML = lista.length ? lista.map(function (e) {
            return '<label class="ui-check" role="option" aria-selected="' + marcadas.has(e.rfc) + '"><input type="checkbox" value="' + esc(e.rfc) + '"' + (marcadas.has(e.rfc) ? " checked" : "") + "><span>" + esc(e.alias) +
                (e.alias !== e.rfc ? " <small>" + esc(e.rfc) + "</small>" : "") + "</span></label>";
        }).join("") : '<p class="ev-empresas__vacio">' + (E.op.empresas.length ? "Ninguna empresa coincide con la búsqueda." : "Todavía no tienes empresas en tu directorio.") + "</p>";
        pintarElegidas();
    }
    function pintarElegidas() {
        var n = E.marcadas.size, total = E.op.empresas.length;
        $("ev-combo-boton").textContent = n ? plural(n, "empresa elegida", "empresas elegidas") + " de " + total : "Elegir empresas (" + total + ")";
        var elegidas = E.op.empresas.filter(function (e) { return E.marcadas.has(e.rfc); });
        $("ev-elegidas").innerHTML = elegidas.length ? elegidas.map(function (e) {
            return '<span class="ev-pastilla" title="' + esc(e.rfc) + '"><span>' + esc(e.alias) + '</span><button type="button" data-quitar-empresa="' + esc(e.rfc) + '" aria-label="Quitar ' + esc(e.alias) + '">×</button></span>';
        }).join("") : '<span class="ev-elegidas__vacio">Ninguna todavía.</span>';
    }
    function abrirCombo(si) {
        $("ev-combo-panel").hidden = !si; $("ev-combo-boton").setAttribute("aria-expanded", String(si));
        $("ev-combo").classList.toggle("ev-combo--abierto", si);
        if (si) { $("ev-emp-buscar").value = ""; pintarEmpresas(); $("ev-emp-buscar").focus(); }
    }
    /* --- el correo: plantillas, palabras entre llaves y cómo llegaría */
    function plantillaActual() {
        var a = $("ev-asunto").value.trim(), m = $("ev-mensaje").value.trim();
        var p = E.op.plantillas.find(function (x) { return x.asunto === a && x.mensaje.trim() === m; });
        return p ? p.clave : "";
    }
    function pintarPlantillas() {
        var actual = plantillaActual();
        $("ev-plantillas").innerHTML = E.op.plantillas.map(function (x) {
            return '<button type="button" class="ev-chip" data-plantilla="' + esc(x.clave) + '" aria-pressed="' + (x.clave === actual) + '">' + esc(x.nombre) + "</button>";
        }).join("") + '<span class="ev-chip ev-chip--nota" aria-hidden="' + (actual ? "true" : "false") + '"' + (actual ? " hidden" : "") + ">Personalizado</span>";
    }
    function valoresEjemplo() {
        var elegidas = E.op.empresas.filter(function (e) { return E.marcadas.has(e.rfc); }).map(function (e) { return e.alias; });
        var cliente = document.querySelector('input[name="ev-destino"]:checked').value === "cliente";
        if (cliente && elegidas.length) elegidas = elegidas.slice(0, 1);
        var empresas = !elegidas.length ? "tus empresas" : elegidas.length === 1 ? elegidas[0] : elegidas.length <= 3 ? elegidas.slice(0, -1).join(", ") + " y " + elegidas[elegidas.length - 1] : elegidas.length + " empresas";
        var hoy = new Date(), mes = document.querySelector('input[name="ev-modo"]:checked').value === "mes" ? mesesDeHoy($("ev-frecuencia").value, $("ev-cierre").checked) : [mesDe(hoy)];
        var c = leerForm().contenido, partes = c.xml.map(function (k) { return "12 " + de(E.op.xml, k).toLowerCase(); });
        if (c.excel.length) partes.push(plural(c.excel.length, "Excel", "Excel"));
        var vence = new Date(hoy.getTime() + (Number($("ev-dias-enlace").value) || 7) * 86400000);
        var detalle = "· " + (elegidas[0] || "Tu empresa") + ", " + mesTxt(mes[mes.length - 1]) + ": " + (partes.join(", ") || "sus documentos") + "." +
            (elegidas.length > 1 && !cliente ? "\n· … y así cada empresa" : "") +
            (enDescargas() ? "\n\nYa está listo en tu cuenta de Fiscontable, en «Mis descargas» (2.4 MB).\nSe conserva " + (E.op.dias_descargas || 7) + " días; después se borra. En un despacho, cada persona ve lo de sus empresas."
                : "\n\nDescárgalo aquí (2.4 MB): https://…\nEl enlace vence el " + vence.toLocaleDateString("es-MX") + "; después el archivo se borra." + ($("ev-adjuntar").checked ? " También va adjunto a este correo." : ""));
        return { envio: $("ev-nombre").value.trim() || (E.editando ? "Envío " + E.editando.numero : "Envío " + (E.envios.length + 1)), periodo: periodoTxt(mes),
                 fecha: hoy.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" }), empresas: empresas, detalle: detalle };
    }
    function poner(texto, v) { return texto.replace(/\{([a-z_]+)\}/g, function (todo, k) { return Object.prototype.hasOwnProperty.call(v, k) ? v[k] : todo; }); }
    function pintarVista() {
        var v = valoresEjemplo(), m = $("ev-mensaje").value.trim() || E.op.plantillas[0].mensaje;
        if (m.indexOf("{detalle}") === -1) m += "\n\n{detalle}";
        $("ev-vista-asunto").textContent = poner($("ev-asunto").value.trim() || E.op.plantillas[0].asunto, Object.assign({}, v, { detalle: "" }));
        $("ev-vista-cuerpo").textContent = poner(m, v);
        pintarPlantillas();
    }
    function palabrasRaras(texto, enAsunto) {
        var claves = E.op.variables.map(function (x) { return x.clave; }), raras = [];
        texto.replace(/\{([^{}\n]*)\}/g, function (todo, k) { if (claves.indexOf(k) === -1 || (enAsunto && k === "detalle")) raras.push(todo); return todo; });
        return raras;
    }
    /* --- pasos */
    function errorDePaso(n) {
        if (n === 1) {
            var mal = E.correos.para.pendiente() || E.correos.cc.pendiente();
            if (mal) return "Revisa los correos: «" + mal + "» no parece un correo.";
            if (document.querySelector('input[name="ev-destino"]:checked').value === "grupo" && !E.correos.para.valores().length) return "Escribe al menos un correo en «Para».";
        }
        if (n === 3) {
            var c = leerForm().contenido;
            if (!c.xml.length && !c.excel.length && !c.docs.length) return "Marca al menos una cosa que mandar (XML y PDF, algún Excel, la constancia o la opinión).";
        }
        if (n === 5) {
            var r = palabrasRaras($("ev-asunto").value, true).concat(palabrasRaras($("ev-mensaje").value, false));
            if (r.length) return "No se reconoce " + r[0] + ". Usa las palabras de la lista de abajo.";
        }
        return "";
    }
    function pintarPasos() {
        $("ev-pasos").innerHTML = PASOS.map(function (t, i) {
            var n = i + 1;
            return '<li><button type="button" data-ir="' + n + '" class="' + (n < E.paso ? "ev-pasos--hecho" : "") + '"' + (n === E.paso ? ' aria-current="step"' : "") + '><span class="ev-pasos__num">' + n +
                '</span><span class="ev-pasos__txt">' + esc(t) + "</span></button></li>";
        }).join("");
        document.querySelectorAll("#ev-form .ev-paso").forEach(function (s) { s.hidden = Number(s.dataset.paso) !== E.paso; });
        $("ev-atras").hidden = E.paso === 1;
        $("ev-siguiente").hidden = E.paso === PASOS.length;
        $("ev-guardar").hidden = !E.editando && E.paso !== PASOS.length;          // al editar se puede guardar desde cualquier paso
        $("ev-siguiente").className = "ui-btn ui-btn--36 " + ($("ev-guardar").hidden ? "ui-btn--primario" : "ui-btn--secundario");
        $("ev-base").hidden = !E.nota || E.paso !== 1;
        if (E.paso === 5) pintarVista();
        if (E.paso === 4) pintarPeriodo();
    }
    function irA(n) {
        var err = $("ev-error");
        err.hidden = true; abrirCombo(false);
        for (var p = E.paso; p < n; p++) {           // hacia adelante, cada paso de en medio tiene que estar bien
            var e = errorDePaso(p);
            if (e) { E.paso = p; pintarPasos(); err.textContent = e; err.hidden = false; return false; }
        }
        E.paso = Math.min(Math.max(n, 1), PASOS.length);
        pintarPasos();
        $("ev-form").scrollTop = 0;
        return true;
    }
    function abrirForm(e, base, copia) {
        E.editando = e || null;
        var de_ = e || base || null, todo = e || (copia ? base : null);          // «todo»: también nombre, correos y empresas
        E.marcadas = new Set(todo ? todo.empresas : []);
        E.nota = !e && base ? (copia ? "Es una copia de «" + base.nombre + "»: cambia lo que quieras y guarda." :
            "Empieza con lo mismo que «" + base.nombre + "» (qué lleva, cuándo y el mensaje). Cambia lo que quieras.") : "";
        $("ev-base").textContent = E.nota;
        var c = de_ ? de_.contenido : { xml: ["recibidos", "pagos"], excel: [{ que: "conciliacion_emitidos" }, { que: "pagos" }], docs: [] };      // lo que pidió Alan, de fábrica
        $("ev-dlg-titulo").textContent = e ? "Editar Envío " + e.numero : "Nuevo envío";
        $("ev-dlg-sub").textContent = "Se manda solo, a las " + E.hora + " de la mañana del día que toque. En el último paso eliges si llega por correo o se queda en Mis descargas.";
        $("ev-verifica-txt").textContent = "Antes de mandar se pide al SAT la lista de cada empresa para comprobar que estén todos los XML, y se valida el estado de todo lo que va. " +
            "Si a las " + E.limite + ":00 el SAT no ha entregado la lista, sale con la anotación de qué empresa quedó sin comparar.";
        $("ev-nombre").value = e ? e.nombre : copia ? (base.nombre + " (copia)").slice(0, 80) : "";
        $("ev-nombre").placeholder = e ? "" : "Envío " + (E.envios.length + 1) + " (o el nombre que quieras)";
        E.correos.para.poner(todo ? todo.para : []); E.correos.cc.poner(todo ? todo.cc : []);
        document.querySelector('input[name="ev-destino"][value="' + (de_ && de_.destino === "cliente" ? "cliente" : "grupo") + '"]').checked = true;
        pintarDestino(); pintarUsuarios();
        $("ev-emp-buscar").value = ""; abrirCombo(false);
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
        // En qué moneda van los Excel (pesos de fábrica) y qué hojas lleva la conciliación («Para compartir» de fábrica)
        $("ev-moneda").innerHTML = E.op.monedas.map(function (m) { return '<option value="' + esc(m.clave) + '">' + esc(m.nombre) + "</option>"; }).join("");
        $("ev-moneda").value = c.moneda || "xml";
        var cj = E.op.conciliacion, hc = c.conciliacion || "compartir";
        $("ev-conc").innerHTML = Object.keys(cj.juegos).map(function (k) { return '<option value="' + esc(k) + '">' + esc(cj.nombres[k]) + " (" + cj.juegos[k].length + " hojas)</option>"; }).join("") +
            '<option value="">Elegir hojas…</option>';
        E.hojasConc = new Set(Array.isArray(hc) ? hc : cj.juegos[hc] || cj.juegos.compartir);
        $("ev-conc").value = Array.isArray(hc) ? "" : (cj.juegos[hc] ? hc : "compartir");
        $("ev-conc-hojas").innerHTML = cj.hojas.map(function (h) { return '<label class="ui-check"><input type="checkbox" value="' + esc(h.clave) + '"> <span>' + esc(h.nombre) + "</span></label>"; }).join("");
        pintarConc();
        $("ev-frecuencia").value = de_ ? de_.frecuencia : "semanal";
        document.querySelector('input[name="ev-modo"][value="' + (de_ && de_.modo === "nuevo" ? "nuevo" : "mes") + '"]').checked = true;
        pintarDias();
        $("ev-dia").value = String(de_ ? de_.dia : 0);
        $("ev-dias-enlace").value = String(de_ && [3, 5, 7].indexOf(de_.dias_enlace) !== -1 ? de_.dias_enlace : 7);          // una semana como máximo (18-nov)
        $("ev-avisar").checked = !!(de_ && de_.avisar_sin_novedades);
        $("ev-cierre").checked = de_ ? de_.cierre !== false : true;
        pintarPeriodo();
        $("ev-remitente").value = de_ && de_.remitente && de_.remitente !== E.op.remitente ? de_.remitente : "";
        $("ev-remitente").placeholder = E.op.remitente;
        $("ev-adjuntar").checked = de_ ? de_.adjuntar !== false : true;
        document.querySelector('input[name="ev-lugar"][value="' + (de_ && de_.en_descargas ? "descargas" : "correo") + '"]').checked = true;
        pintarLugar();
        $("ev-adjuntar-txt").textContent = "(si pesa hasta " + E.tope + " MB). Sin adjunto, solo con el enlace, es menos probable que caiga en correo no deseado.";
        $("ev-asunto").value = de_ && de_.asunto ? de_.asunto : E.op.plantillas[0].asunto;
        $("ev-mensaje").value = de_ && de_.mensaje ? de_.mensaje : E.op.plantillas[0].mensaje;
        $("ev-variables").innerHTML = E.op.variables.map(function (x) {
            return '<button type="button" class="ev-chip ev-chip--palabra" data-palabra="' + esc(x.clave) + '" title="' + esc(x.nombre) + '">{' + esc(x.clave) + "}</button>";
        }).join("");
        E.campoTexto = $("ev-mensaje");
        $("ev-borrar").hidden = !e; $("ev-error").hidden = true;
        pintarEmpresas();
        E.paso = 1; pintarPasos();
        if (!$("ev-dlg").open) $("ev-dlg").showModal();
        $("ev-nombre").focus();
    }
    // Las hojas de la conciliación solo se preguntan si el envío lleva un Excel de conciliación
    function pintarConc() {
        var lleva = !!$("ev-excel").querySelector('input[value^="conciliacion_"]:checked'), propio = $("ev-conc").value === "";
        $("ev-conc-caja").hidden = !lleva;
        $("ev-conc-hojas").hidden = !lleva || !propio;
        $("ev-conc-hojas").querySelectorAll("input").forEach(function (i) { i.checked = E.hojasConc.has(i.value); });
    }
    function leerForm() {
        var juego = $("ev-conc").value, orden = E.op.conciliacion.hojas.map(function (h) { return h.clave; });
        var hojas = juego || orden.filter(function (k) { return E.hojasConc.has(k); });
        return {
            nombre: $("ev-nombre").value, para: E.correos.para.valores().join(", "), cc: E.correos.cc.valores().join(", "), empresas: Array.from(E.marcadas),
            destino: document.querySelector('input[name="ev-destino"]:checked').value,
            contenido: {
                xml: Array.from($("ev-xml").querySelectorAll("input:checked")).map(function (i) { return i.value; }),
                excel: Array.from($("ev-excel").querySelectorAll("input:checked")).map(function (i) {
                    var v = $("ev-excel").querySelector('[data-vista="' + i.value + '"]').value;
                    return { que: i.value, vista: v ? Number(v) : null };
                }),
                docs: Array.from($("ev-docs").querySelectorAll("input:checked")).map(function (i) { return i.value; }),
                moneda: $("ev-moneda").value || "xml", conciliacion: (Array.isArray(hojas) && !hojas.length) ? "compartir" : hojas
            },
            frecuencia: $("ev-frecuencia").value, dia: Number($("ev-dia").value) || 0, modo: document.querySelector('input[name="ev-modo"]:checked').value,
            dias_enlace: Number($("ev-dias-enlace").value) || 7, avisar_sin_novedades: $("ev-avisar").checked, activa: E.editando ? E.editando.activa : true,
            asunto: $("ev-asunto").value, mensaje: $("ev-mensaje").value, remitente: $("ev-remitente").value, adjuntar: $("ev-adjuntar").checked,
            cierre: $("ev-cierre").checked, en_descargas: enDescargas()
        };
    }
    async function guardar() {
        var b = $("ev-guardar"), err = $("ev-error");
        err.hidden = true;
        for (var p = 1; p <= PASOS.length; p++) {          // si algo falta, se abre ese paso y lo dice
            var falta = errorDePaso(p);
            if (falta) { E.paso = p; pintarPasos(); err.textContent = falta; err.hidden = false; return; }
        }
        var datos = leerForm();
        b.disabled = true;
        try {
            await mandar("/api/entregas" + (E.editando ? "/" + E.editando.id : ""), E.editando ? "PUT" : "POST", datos);
            $("ev-dlg").close();
            await cargar();
            Fiscontable.toast(E.editando ? "Envío guardado." : datos.empresas.length ? "Envío creado. Pruébalo con «Enviar ahora»." : "Envío creado. Marca sus empresas y pruébalo con «Enviar ahora».");
        } catch (e) { err.textContent = e.message; err.hidden = false; }
        finally { b.disabled = false; }
    }

    /* ============================================================ «Enviar ahora»: a quién y de qué periodo */
    function abrirAhora(e) {
        E.ahoraDe = e;
        var aQuien = e.destino === "cliente" ? "cada cliente, a su correo" : e.para.concat(e.cc || []).join(", ");
        $("ev-ahora-titulo").textContent = "¿Mandar el Envío " + e.numero + " ahora?";
        $("ev-ahora-sub").textContent = "Sale a " + aQuien + ".";
        $("ev-ahora-siempre").textContent = e.modo === "mes" ? "Lleva " + periodoTxt(e.meses_hoy || mesesDeHoy(e.frecuencia, e.cierre)) + ", completo." : "Lo que llegó desde el envío anterior.";
        var h = new Date(), ops = "";
        for (var i = 0; i < 13; i++) { var m = mesDe(new Date(h.getFullYear(), h.getMonth() - i, 1)); ops += '<option value="' + m + '"' + (i === 1 ? " selected" : "") + ">" + esc(mesTxt(m).replace(/^./, function (c) { return c.toUpperCase(); })) + "</option>"; }
        $("ev-ahora-mes").innerHTML = ops;
        document.querySelector('input[name="ev-ahora-periodo"][value="siempre"]').checked = true;
        $("ev-ahora-mes-caja").hidden = true;
        $("ev-ahora-nota").textContent = "Se valida ante el SAT el estado de cada comprobante y se espera hasta " + (E.esperaListas || 15) +
            " minutos a que entregue la lista de cada empresa (para comprobar que no falte ninguno). No cambia la fecha del próximo envío automático.";
        $("ev-ahora-si").disabled = false;
        if (!$("ev-ahora").open) $("ev-ahora").showModal();
    }
    async function mandarAhora() {
        var e = E.ahoraDe, b = $("ev-ahora-si"); if (!e) return;
        var otro = document.querySelector('input[name="ev-ahora-periodo"]:checked').value === "otro";
        b.disabled = true;
        try {
            await mandar("/api/entregas/" + encodeURIComponent(e.id) + "/enviar", "POST", { meses: otro ? [$("ev-ahora-mes").value] : [] });
            $("ev-ahora").close(); E.esperando = true; abrirHistorial(e); await cargar();
        } catch (err) { b.disabled = false; fallo(err); }
    }

    /* ============================================================ el historial */
    /* Cada envío hecho, en corto: cuándo, cómo quedó, cuánto llevó y sus botones (copiar el enlace, revocarlo). El
       detalle por empresa va plegado: se abre al tocarlo (18-nov, Alan: «que me dé lo importante… sin tener expandido
       todo el detalle»). */
    function hecho(v) {
        var est = ESTADOS[v.estado] || [v.estado, "info"];
        var conAlgo = (v.detalle.empresas || []).filter(function (d) { return d.meses.length || (d.docs || []).length || d.verificacion; });
        var verificadas = conAlgo.filter(function (d) { return d.verificacion; });
        var porRevisar = verificadas.filter(function (d) { return d.verificacion.estado !== "completo"; }).length;
        var lineas = conAlgo.map(function (d) {
            var meses = d.meses.map(function (m) {
                var partes = Object.keys(m.partes).map(function (p) {
                    var x = E.op.xml.find(function (y) { return y.clave === p; }) || { nombre: p, uno: p };
                    return m.partes[p].toLocaleString("es-MX") + " " + (m.partes[p] === 1 ? x.uno : x.nombre.toLowerCase());
                });
                if (m.excel.length) partes.push(plural(m.excel.length, "Excel", "Excel"));
                return esc(m.mes.slice(5) + "/" + m.mes.slice(0, 4) + " (" + partes.join(", ") + ")");
            }).join(" · ");
            var docs = (d.docs || []).map(function (x) { return (x.tipo === "csf" ? "constancia" : "opinión 32-D") + (x.fecha ? " del " + x.fecha.slice(8, 10) + "/" + x.fecha.slice(5, 7) : ""); })
                .concat((d.sin_docs || []).map(function (x) { return "sin " + (x === "csf" ? "constancia" : "opinión 32-D") + " guardada"; })).join(", ");
            var ver = d.verificacion ? '<br><small><span class="ui-estado ui-estado--' + (VERIFICA[d.verificacion.estado] || "info") + '">' + esc(d.verificacion.texto) + "</span>" +
                (d.validacion && d.validacion.pendientes ? " · " + d.validacion.pendientes + " sin validar su estado (el SAT no respondió)" : "") + "</small>" : "";
            return "<li><b>" + esc(d.alias) + "</b>: " + ([meses || (docs ? "" : "nada del periodo"), esc(docs)].filter(Boolean).join(" · ")) + ver + "</li>";
        }).join("");
        var pie = "", enDesc = v.detalle && v.detalle.descargas;
        if (enDesc && v.estado === "enviado") {          // se quedó en «Mis descargas»: no hay enlace que copiar ni que revocar
            pie = "<span>" + esc(peso(v.bytes) + " · en Mis descargas (se conserva " + enDesc + " días)") + "</span>" +
                (v.detalle.aviso_fallo ? '<span class="ev-hecho__aviso">El correo de aviso no salió: ' + esc(v.detalle.aviso_fallo) + "</span>" : "") +
                '<a class="ui-btn ui-btn--terciario ui-btn--28" href="/descargas/">Abrir Mis descargas</a>';
        }
        // Si el correo falló pero el archivo sí se armó, su enlace sirve igual: se puede copiar y mandar a mano
        else if (v.estado === "enviado" || (v.estado === "error" && v.enlace_activo)) {
            pie = "<span>" + esc(peso(v.bytes) + (v.estado === "error" ? " · el archivo sí se armó" : v.adjunto ? " · fue adjunto" : " · solo enlace") + " · " + plural(v.descargas, "descarga", "descargas")) + "</span>" +
                (v.enlace_activo ? "<span>El enlace vence el " + esc(cuando(v.vence)) + "</span>" +
                    '<span class="ev-hecho__botones"><button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-copiar="' + esc(v.url) + '">Copiar enlace</button>' +
                    (E.titular ? '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-revocar="' + esc(v.id) + '">Revocar</button>' : "") + "</span>"
                    : "<span>" + (v.revocado ? "Enlace revocado: el archivo ya se borró." : "Enlace vencido: el archivo ya se borró.") + "</span>");
        }
        var resumen = [];
        if (conAlgo.length) resumen.push(plural(conAlgo.length, "empresa", "empresas"));
        if (v.comprobantes) resumen.push(plural(v.comprobantes, "comprobante", "comprobantes"));
        var lista = !verificadas.length ? "" : porRevisar
            ? '<span class="ui-estado ui-estado--aviso">' + (porRevisar === verificadas.length && porRevisar > 1 ? "Ninguna" : porRevisar + " de " + verificadas.length) +
              (porRevisar === verificadas.length && porRevisar > 1 ? " con su lista del SAT completa" : " con algo por revisar en su lista del SAT") + "</span>"
            : '<span class="ui-estado ui-estado--ok">Todo verificado contra el SAT</span>';
        return '<article class="ev-hecho"><header><b>' + esc(cuando(v.momento, true)) + '</b><span class="ui-estado ui-estado--' + est[1] + '">' + esc(est[0]) + "</span></header>" +
            (v.error ? '<p class="ev-hecho__error">' + esc(v.error) + "</p>" : "") +
            (resumen.length || lista ? '<p class="ev-hecho__resumen">' + (resumen.length ? "<b>" + esc(resumen.join(" · ")) + "</b>" : "") + lista + "</p>" : "") +
            '<div class="ev-hecho__pie"><span>A ' + esc((v.para || []).join(", ")) + " · " + esc(v.quien === "programado" ? "automático" : "lo pidió " + v.quien) + "</span>" + pie + "</div>" +
            (lineas ? '<details class="ev-hecho__det"><summary>Detalle por empresa</summary><ul>' + lineas + "</ul></details>" : "") + "</article>";
    }
    async function cargarHistorial() {
        var e = E.histDe, cuerpo = $("ev-hist-cuerpo");
        try {
            var r = await api("/api/entregas/" + encodeURIComponent(e.id) + "/historial");
            cuerpo.innerHTML = (r.en_curso ? '<p class="ev-ultimo ev-ultimo--avance" id="ev-hist-avance">' + esc(textoAvance(r.avance)) + "</p>" : "") +
                (r.envios.length ? '<div class="ev-hist">' + r.envios.map(hecho).join("") + "</div>"
                : '<div class="ui-vacio"><b>Todavía no se ha mandado</b><span>Pruébalo con «Enviar ahora» o espera al ' + esc(cuando(e.proxima)) + ".</span></div>");
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
        if (!(await Fiscontable.exigirModulo("envios"))) return;
        E.correos.para = pastillas($("ev-para")); E.correos.cc = pastillas($("ev-cc"));
        try {
            E.op = await api("/api/entregas/opciones");
            await cargar();
        } catch (e) {
            $("ev-aviso").textContent = e.message; $("ev-aviso").hidden = false;
            return;
        }
        // Un envío nuevo arranca con la configuración del último que se hizo (Alan: «una vez lo configuro y ya está para todo»)
        function nuevo() { abrirForm(null, E.envios.length ? E.envios[E.envios.length - 1] : null, false); }
        $("ev-nuevo").addEventListener("click", nuevo);
        $("ev-lista").addEventListener("click", async function (ev) {
            var b = ev.target.closest("[data-accion]"); if (!b || b.type === "checkbox") return;
            var accion = b.dataset.accion, e = deTarjeta(b);
            if (accion === "nuevo") return nuevo();
            if (!e) return;
            if (accion === "editar") return abrirForm(e);
            if (accion === "duplicar") return abrirForm(null, e, true);
            if (accion === "historial") return abrirHistorial(e);
            if (accion === "enviar") return abrirAhora(e);
        });
        $("ev-ahora").addEventListener("click", function (ev) { if (ev.target.closest('[data-ev="cerrar-ahora"]')) $("ev-ahora").close(); });
        $("ev-ahora").addEventListener("change", function (ev) {
            if (ev.target.name === "ev-ahora-periodo") $("ev-ahora-mes-caja").hidden = ev.target.value !== "otro";
        });
        $("ev-ahora-si").addEventListener("click", mandarAhora);
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
        document.querySelectorAll('input[name="ev-modo"]').forEach(function (r) { r.addEventListener("change", pintarPeriodo); });
        $("ev-cierre").addEventListener("change", pintarPeriodo);
        $("ev-emp-buscar").addEventListener("input", pintarEmpresas);
        $("ev-empresas").addEventListener("change", function (ev) {
            if (ev.target.checked) E.marcadas.add(ev.target.value); else E.marcadas.delete(ev.target.value);
            var op = ev.target.closest('[role="option"]'); if (op) op.setAttribute("aria-selected", String(ev.target.checked));
            pintarElegidas();
        });
        $("ev-combo-boton").addEventListener("click", function () { abrirCombo($("ev-combo-panel").hidden); });
        $("ev-dlg").addEventListener("keydown", function (ev) {          // Esc con la lista abierta cierra la lista, no el formulario
            if (ev.key === "Escape" && !$("ev-combo-panel").hidden) { ev.preventDefault(); abrirCombo(false); $("ev-combo-boton").focus(); }
        });
        $("ev-dlg").addEventListener("cancel", function (ev) { if (!$("ev-combo-panel").hidden) ev.preventDefault(); });
        $("ev-dlg").addEventListener("click", function (ev) {
            var q = ev.target.closest("[data-quitar-empresa]");
            if (q) { E.marcadas.delete(q.dataset.quitarEmpresa); return pintarEmpresas(); }
            var ir = ev.target.closest("[data-ir]");
            if (ir) return irA(Number(ir.dataset.ir));
            var pl = ev.target.closest("[data-plantilla]");
            if (pl) {
                var x = E.op.plantillas.find(function (y) { return y.clave === pl.dataset.plantilla; });
                $("ev-asunto").value = x.asunto; $("ev-mensaje").value = x.mensaje; return pintarVista();
            }
            var pa = ev.target.closest("[data-palabra]");
            if (pa) {          // la palabra entra donde está el cursor del último campo que se tocó ({detalle} solo en el mensaje)
                var campo = pa.dataset.palabra === "detalle" ? $("ev-mensaje") : (E.campoTexto || $("ev-mensaje")), t = "{" + pa.dataset.palabra + "}";
                var ini = campo.selectionStart == null ? campo.value.length : campo.selectionStart, fin = campo.selectionEnd == null ? ini : campo.selectionEnd;
                campo.value = campo.value.slice(0, ini) + t + campo.value.slice(fin);
                campo.focus(); campo.setSelectionRange(ini + t.length, ini + t.length);
                return pintarVista();
            }
            var b = ev.target.closest("[data-ev]"); if (!b) return;
            if (b.dataset.ev === "cerrar") return $("ev-dlg").close();
            if (b.dataset.ev === "atras") return irA(E.paso - 1);
            if (b.dataset.ev === "siguiente") return irA(E.paso + 1);
            if (b.dataset.ev === "combo-listo") { abrirCombo(false); return $("ev-combo-boton").focus(); }
            if (b.dataset.ev === "todas") { $("ev-empresas").querySelectorAll("input").forEach(function (i) { E.marcadas.add(i.value); }); pintarEmpresas(); }
            if (b.dataset.ev === "ninguna") { E.marcadas.clear(); pintarEmpresas(); }
        });
        $("ev-adjuntar").addEventListener("change", pintarVista);
        document.querySelectorAll('input[name="ev-lugar"]').forEach(function (r) { r.addEventListener("change", function () { pintarLugar(); pintarVista(); }); });
        $("ev-excel").addEventListener("change", pintarConc);
        $("ev-conc").addEventListener("change", function () {
            var j = E.op.conciliacion.juegos[$("ev-conc").value];
            if (j) E.hojasConc = new Set(j);
            pintarConc();
        });
        $("ev-conc-hojas").addEventListener("change", function (ev) {
            if (ev.target.checked) E.hojasConc.add(ev.target.value); else E.hojasConc.delete(ev.target.value);
        });
        ["ev-asunto", "ev-mensaje"].forEach(function (id) {
            $(id).addEventListener("focus", function () { E.campoTexto = $(id); });
            $(id).addEventListener("input", pintarVista);
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
