/*
 * herramientas/xml/cancelaciones.js — Cancelaciones ante el SAT con el CSD de la empresa (vía MultiFacturas):
 *   · «Te piden cancelar»: solicitudes de proveedores que esperan respuesta (aceptar o rechazar, una por una).
 *   · «Cancelar emitidas»: cualquier CFDI emitido del mes (de la biblioteca), aunque no se timbrara aquí.
 *   · «Historial»: lo que se mandó, su resultado, «Revisar en el SAT» y el acuse.
 * Cada envío pide confirmar ese documento: no hay acciones en lote.
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    var TIPOS = { I: "Ingreso", E: "Egreso", P: "Pago", N: "Nómina", T: "Traslado" };
    var q = new URLSearchParams(location.search);
    var E = { empresas: [], rfc: null, anio: null, mes: null, vista: ["emitidas", "historial"].indexOf(q.get("vista")) >= 0 ? q.get("vista") : "recibidas",
              datos: null, emitidas: null, buscar: "", actual: null, ocupado: false };

    async function api(ruta, opciones) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function enviar(ruta, cuerpo) { return api(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo || {}) }); }
    function m(v) { return "$" + (Number(v) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function aviso(t, mal) { var a = $("aviso"); a.innerHTML = t || ""; a.className = "isn-aviso" + (mal ? " isn-aviso--error" : ""); a.hidden = !t; }
    function base() { return "/api/cancelaciones/" + encodeURIComponent(E.rfc); }
    function fecha(iso) {
        if (!iso) return "";
        var d = new Date(iso.length > 10 && !/Z|[+-]\d\d:\d\d$/.test(iso) ? iso + "Z" : iso);
        return isNaN(d) ? iso : d.toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    }
    function detalleUrl(u) { return "/herramientas/xml/detalle/?rfc=" + encodeURIComponent(E.rfc) + "&uuid=" + encodeURIComponent(u); }
    // El folio fiscal abre la factura (si su XML está en la biblioteca)
    function fechaCorta(iso) {
        var d = new Date((iso || "").slice(0, 10) + "T12:00:00");
        return isNaN(d) ? iso : d.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
    }
    function uuidCorto(u) { return '<a class="ca-uuid ca-liga" href="' + detalleUrl(u) + '" target="_blank" rel="noopener" title="Abrir la factura · ' + esc(u) + '">' + esc(u.slice(0, 8)) + "…" + esc(u.slice(-4)) + "</a>"; }
    function estadoSat(x) {
        if (!x || !x.estado_sat) return '<span class="ca-gris">Sin revisar</span>';
        var t = x.estado_sat + (x.estatus_cancelacion ? " · " + x.estatus_cancelacion : "");
        return '<span class="ca-pill ca-pill--' + (x.estado_sat === "Cancelado" ? "no" : /proceso/i.test(x.estatus_cancelacion || "") ? "proc" : "si") + '">' + esc(t) + "</span>";
    }

    /* ------------------------------------------------------------ inicio */
    async function iniciar() {
        if (!(await Fiscontable.exigirModulo("cancelaciones"))) return;
        try { E.empresas = await api("/api/xml/contribuyentes"); } catch (e) { E.empresas = []; }
        var activa = await Fiscontable.empresaActiva();
        E.rfc = (q.get("rfc") || (activa && activa.rfc) || (E.empresas[0] && E.empresas[0].rfc) || "").toUpperCase() || null;
        var hoy = new Date();
        E.anio = +(q.get("anio") || hoy.getFullYear());
        E.mes = +(q.get("mes") || hoy.getMonth() + 1);
        var anios = []; for (var a = hoy.getFullYear(); a >= hoy.getFullYear() - 5; a--) anios.push(a);
        $("sel-anio").innerHTML = anios.map(function (x) { return "<option" + (x === E.anio ? " selected" : "") + ">" + x + "</option>"; }).join("");
        $("sel-mes").innerHTML = MESES.map(function (n, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === E.mes ? " selected" : "") + ">" + n + "</option>"; }).join("");
        eventos();
        titulo();
        ponerVista(E.vista);
        await cargar();
    }

    function nombreEmpresa(rfc) {
        var c = E.empresas.find(function (x) { return x.rfc === rfc; });
        return (c && (c.alias || c.nombre)) || rfc;
    }
    function titulo() {
        $("empresa-etiqueta").textContent = E.rfc ? "Empresa · " + E.rfc : "Empresa";
        $("empresa-titulo").textContent = E.rfc ? nombreEmpresa(E.rfc) : "Elegir empresa";
    }
    function pintarMenu() {
        $("menu-empresa").innerHTML = '<div class="xml-otra__grupo">Empresas con XML</div>' + (E.empresas.length ? E.empresas.map(function (c) {
            return '<button type="button" data-rfc="' + esc(c.rfc) + '"' + (c.rfc === E.rfc ? ' class="xml-activa"' : "") + ">" + esc(c.alias || c.nombre || c.rfc) +
                " <span>" + esc(c.rfc) + "</span></button>";
        }).join("") : '<p class="xml-otra__nota">Carga primero sus XML en Administración de XML.</p>');
    }

    function ponerVista(v) {
        E.vista = v;
        document.querySelectorAll("[data-vista]").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.vista === v ? "true" : "false"); });
        ["recibidas", "emitidas", "historial"].forEach(function (k) { $("v-" + k).hidden = k !== v; });
        $("sel-mes").hidden = $("sel-anio").hidden = v !== "emitidas";
        var u = new URL(location.href); u.searchParams.set("vista", v); if (E.rfc) u.searchParams.set("rfc", E.rfc); history.replaceState(null, "", u);
        if (v === "emitidas" && E.rfc && !E.emitidas) cargarEmitidas();
    }

    /* ------------------------------------------------------------ datos */
    async function cargar() {
        E.emitidas = null;
        if (!E.rfc) { aviso("Elige una empresa."); return; }
        try { E.datos = await api(base()); aviso(""); }
        catch (e) { E.datos = null; aviso(esc(e.message), true); }
        pintarEstado();
        pintarPendientes();
        pintarHistorial();
        if (E.vista === "emitidas") cargarEmitidas();
    }

    async function cargarEmitidas() {
        $("tb-emit").innerHTML = '<tr><td colspan="7" class="xml-vacio">Cargando…</td></tr>';
        try { E.emitidas = (await api(base() + "/emitidas?anio=" + E.anio + "&mes=" + E.mes)).filas; }
        catch (e) { E.emitidas = []; aviso(esc(e.message), true); }
        pintarEmitidas();
        var pedido = (q.get("cancelar") || "").toUpperCase();
        if (pedido && !E.yaAbierto && E.emitidas.some(function (x) { return x.uuid === pedido; })) { E.yaAbierto = true; abrirCancelar(pedido); }
    }

    function pintarEstado() {
        var d = E.datos, caja = $("estado");
        if (!d) { caja.hidden = true; return; }
        var s = d.estado, t = [];
        if (s.pruebas) t.push('<b>Modo de pruebas:</b> todo va al ambiente de pruebas de MultiFacturas, sin efecto ante el SAT.');
        if (!s.listo) t.push("<b>Para cancelar o responder falta</b> " + esc(s.faltan.join(" y ")) + '. <a href="/herramientas/facturacion/">Ir a Facturar</a>');
        caja.innerHTML = t.join("<br>");
        caja.className = "ca-estado" + (s.listo ? "" : " ca-estado--falta");
        caja.hidden = !t.length;
        $("n-pend").textContent = d.pendientes.length ? "(" + d.pendientes.length + ")" : "";
        $("n-proc").textContent = d.en_proceso ? "(" + d.en_proceso + " en proceso)" : "";
        var rs = d.respuesta_sat;
        $("consultado").textContent = d.consultado_en ? "Última búsqueda en el SAT: " + fecha(d.consultado_en) +
            (rs && (rs.codigo || rs.texto) ? " · contestó: " + [rs.codigo, rs.texto].filter(Boolean).join(" ") + " (" + (rs.n || 0) + " solicitud(es))" : "") + "." :
            "Todavía no se ha buscado en el SAT. Las que avisa el Buzón Tributario salen aquí solas.";
    }

    function pintarPendientes() {
        var lista = (E.datos && E.datos.pendientes) || [];
        $("tb-pend").innerHTML = lista.length ? lista.map(function (p) {
            var x = p.xml;
            var origen = p.origen === "buzon" ? '<span class="ca-pill ca-pill--proc" title="El SAT la avisó en el Buzón Tributario">Avisada en el Buzón</span>'
                                              : '<span class="ca-pill ca-pill--si" title="La trajo la consulta del SAT">Encontrada en el SAT</span>';
            return "<tr><td>" + uuidCorto(p.uuid) + (p.pruebas ? ' <span class="ca-gris">(pruebas)</span>' : "") + '<span class="ca-bloque">' + origen + "</span>" +
                (p.limite ? '<span class="ca-gris ca-bloque">Responde a más tardar el ' + esc(fechaCorta(p.limite)) + "</span>" : "") + "</td>" +
                "<td class=\"fi-nombre\">" + (x ? esc(x.emisor.nombre || "") + "<small>" + esc(x.emisor.rfc || "") + "</small>"
                    : (p.emisor ? esc(p.emisor) + "<small>No tienes este XML en la biblioteca</small>" : '<span class="ca-gris">No tienes este XML en la biblioteca</span>')) + "</td>" +
                "<td>" + (x ? esc(x.fecha) : "") + "</td><td class=\"xml-num\">" + (x ? m(x.total) : "") + "</td><td>" + (x ? estadoSat(x) : "") + "</td>" +
                '<td class="ca-acciones"><button type="button" class="xml-btn" data-responder="1" data-uuid="' + esc(p.uuid) + '">Aceptar</button>' +
                '<button type="button" class="xml-btn" data-responder="0" data-uuid="' + esc(p.uuid) + '">Rechazar</button></td></tr>';
        }).join("") : '<tr><td colspan="6" class="xml-vacio">' + (E.datos && E.datos.consultado_en ? "No hay solicitudes esperando tu respuesta." : "Usa «Buscar en el SAT» para ver si alguien pidió cancelar una factura que recibiste.") + "</td></tr>";
    }

    function pintarEmitidas() {
        var b = E.buscar.toLowerCase();
        var lista = (E.emitidas || []).filter(function (x) {
            return !b || (x.folio + " " + (x.receptor.nombre || "") + " " + (x.receptor.rfc || "") + " " + x.uuid).toLowerCase().indexOf(b) >= 0;
        });
        $("tb-emit").innerHTML = lista.length ? lista.map(function (x) {
            var s = x.solicitud, cancelada = x.estado_sat === "Cancelado" || (s && s.estado === "cancelado");
            var proceso = s && (s.estado === "en_proceso" || s.estado === "sin_confirmar");
            return '<tr class="' + (cancelada ? "fi-cancelada" : "") + '"><td>' + esc(x.fecha) + '</td><td><a class="ca-liga" href="' + detalleUrl(x.uuid) + '" target="_blank" rel="noopener" title="Abrir la factura">' + esc(x.folio || x.uuid.slice(0, 8)) + "</a>" +
                (x.en_fiscontable ? ' <span class="ca-gris" title="Timbrada en Fiscontable">· Facturar</span>' : "") + "</td><td>" + esc(TIPOS[x.tipo] || x.tipo) + "</td>" +
                '<td class="fi-nombre">' + esc(x.receptor.nombre || "") + "<small>" + esc(x.receptor.rfc || "") + "</small></td>" +
                '<td class="xml-num">' + m(x.total) + "</td><td>" + estadoSat(x) + (s && !cancelada ? '<br><span class="ca-gris">' + esc(estadoTexto(s.estado)) + "</span>" : "") + "</td>" +
                '<td class="ca-acciones">' + (cancelada ? '<span class="ca-gris">Cancelada</span>' : proceso ? '<span class="ca-gris">Solicitud enviada</span>' :
                    '<button type="button" class="xml-btn ca-peligro-suave" data-cancelar="' + esc(x.uuid) + '">Cancelar…</button>') + "</td></tr>";
        }).join("") : '<tr><td colspan="7" class="xml-vacio">' + (E.emitidas && E.emitidas.length ? "Nada coincide con la búsqueda." :
            "No hay facturas emitidas de " + MESES[E.mes - 1] + " " + E.anio + " en la biblioteca. Descárgalas o cárgalas en Administración de XML.") + "</td></tr>";
    }

    function estadoTexto(e) {
        return { en_proceso: "En proceso (el receptor debe aceptar)", sin_confirmar: "Enviada, el SAT aún no la refleja", cancelado: "Cancelada",
                 error: "No se hizo", rechazo_receptor: "El receptor la rechazó", aceptada: "Aceptada", rechazada: "Rechazada" }[e] || e;
    }

    function pintarHistorial() {
        var lista = (E.datos && E.datos.historial) || [];
        $("tb-hist").innerHTML = lista.length ? lista.map(function (h) {
            var que = h.accion === "cancelar" ? "Cancelar (motivo " + esc(h.motivo || "") + ")" : h.accion === "aceptar" ? "Aceptaste" : "Rechazaste";
            var proceso = h.estado === "en_proceso" || h.estado === "sin_confirmar";
            return "<tr><td>" + esc(fecha(h.en)) + '<br><span class="ca-gris">' + esc(h.quien || "") + "</span></td><td>" + que + (h.pruebas ? ' <span class="ca-gris">(pruebas)</span>' : "") + "</td>" +
                "<td>" + uuidCorto(h.uuid) + "</td><td class=\"fi-nombre\">" + esc(h.contraparte.nombre || "") + "<small>" + esc(h.contraparte.rfc || "") + "</small></td>" +
                '<td class="xml-num">' + (h.total != null ? m(h.total) : "") + "</td>" +
                '<td class="fi-motivo"><span class="ca-pill ca-pill--' + (h.estado === "error" || h.estado === "rechazo_receptor" ? "no" : proceso ? "proc" : "si") + '">' + esc(estadoTexto(h.estado)) + "</span>" +
                (h.texto ? '<span class="ca-gris ca-bloque">' + esc(h.texto) + "</span>" : "") + (h.estado_sat ? '<span class="ca-gris ca-bloque">SAT: ' + esc(h.estado_sat) + "</span>" : "") + "</td>" +
                '<td class="ca-acciones">' + (proceso && !h.pruebas ? '<button type="button" class="xml-btn" data-revisar="' + h.id + '">Revisar en el SAT</button>' : "") +
                (h.hay_acuse ? '<button type="button" class="xml-enlace" data-acuse="' + h.id + '">Acuse</button>' : "") + "</td></tr>";
        }).join("") : '<tr><td colspan="7" class="xml-vacio">Todavía no hay cancelaciones ni respuestas de esta empresa.</td></tr>';
    }

    /* ------------------------------------------------------------ acciones */
    async function buscarPendientes() {
        var b = $("btn-buscar"); b.disabled = true; b.textContent = "Buscando…";
        try {
            var r = await enviar(base() + "/pendientes");
            E.datos.pendientes = r.pendientes; E.datos.consultado_en = r.consultado_en; E.datos.respuesta_sat = r.respuesta_sat;
            aviso(r.pendientes.length ? r.pendientes.length + " solicitud(es) esperan tu respuesta." : "No hay solicitudes de cancelación esperando tu respuesta.");
            pintarEstado(); pintarPendientes();
        } catch (e) { aviso(esc(e.message), true); }
        b.disabled = false; b.textContent = "Buscar en el SAT";
    }

    function abrirCancelar(uuid) {
        var x = (E.emitidas || []).find(function (f) { return f.uuid === uuid; }); if (!x) return;
        E.actual = x;
        $("mc-resumen").innerHTML = "<b>" + esc(x.folio || "Sin folio") + "</b> · " + esc(x.fecha) + " · " + m(x.total) + "<br>" + esc(x.receptor.nombre || "") + " (" + esc(x.receptor.rfc || "") + ")" +
            '<br><code class="ca-uuid">' + esc(x.uuid) + "</code>";
        var mot = E.datos.motivos;
        $("mc-motivo").innerHTML = '<option value="">Elige…</option>' + Object.keys(mot).map(function (k) { return '<option value="' + k + '">' + k + " · " + esc(mot[k]) + "</option>"; }).join("");
        $("mc-sust").value = ""; $("mc-sust-caja").hidden = true; $("mc-confirmo").checked = false; $("mc-error").hidden = true;
        $("mc-nota").textContent = (E.datos.estado.pruebas ? "Modo de pruebas: no tendrá efecto ante el SAT. " : "") +
            "Normalmente el receptor tiene que aceptarla (tiene 72 horas; si no responde, se cancela sola). No hace falta su aceptación si el total es de hasta $1,000, si es a público en general o si es nota de crédito, nómina o traslado. El motivo 01 necesita el folio de la factura que la sustituye.";
        validarCancelar();
        $("modal-cancelar").hidden = false;
    }
    function validarCancelar() {
        var mot = $("mc-motivo").value;
        $("mc-sust-caja").hidden = mot !== "01";
        $("mc-enviar").disabled = !mot || !$("mc-confirmo").checked || (mot === "01" && $("mc-sust").value.trim().length < 36) || E.ocupado;
    }
    async function enviarCancelar() {
        var x = E.actual; if (!x || E.ocupado) return;
        E.ocupado = true; validarCancelar(); $("mc-enviar").textContent = "Enviando…";
        try {
            var r = await enviar(base() + "/cancelar", { uuid: x.uuid, motivo: $("mc-motivo").value, uuid_sustitucion: $("mc-sust").value.trim() || null, confirmo: true });
            $("modal-cancelar").hidden = true;
            aviso(esc(r.mensaje));
            await cargar();
        } catch (e) { $("mc-error").textContent = e.message; $("mc-error").hidden = false; }
        E.ocupado = false; $("mc-enviar").textContent = "Cancelar factura"; validarCancelar();
    }

    function abrirResponder(uuid, acepta) {
        var p = E.datos.pendientes.find(function (f) { return f.uuid === uuid; }); if (!p) return;
        E.actual = { uuid: uuid, acepta: acepta };
        var x = p.xml;
        $("mr-titulo").textContent = acepta ? "Aceptar la cancelación" : "Rechazar la cancelación";
        $("mr-resumen").innerHTML = (x ? "<b>" + esc(x.emisor.nombre || "") + "</b> (" + esc(x.emisor.rfc || "") + ")<br>" + esc(x.folio || "") + " · " + esc(x.fecha) + " · " + m(x.total) + "<br>" : "") +
            '<code class="ca-uuid">' + esc(uuid) + "</code>";
        $("mr-nota").textContent = (E.datos.estado.pruebas ? "Modo de pruebas: no tendrá efecto ante el SAT. " : "") + (acepta ?
            "Al aceptar, esa factura queda cancelada: ya no cuenta como gasto ni para acreditar IVA." :
            "Al rechazar, la factura sigue vigente. Hazlo si la operación sí se hizo y la factura es correcta.");
        $("mr-confirmo-txt").textContent = acepta ? "Sí, acepto que se cancele" : "Sí, la rechazo (sigue vigente)";
        $("mr-confirmo").checked = false; $("mr-error").hidden = true;
        $("mr-enviar").textContent = acepta ? "Aceptar" : "Rechazar";
        $("mr-enviar").className = "xml-btn " + (acepta ? "ca-peligro" : "xml-btn--primario");
        $("mr-enviar").disabled = true;
        $("modal-responder").hidden = false;
    }
    async function enviarRespuesta() {
        var a = E.actual; if (!a || E.ocupado) return;
        E.ocupado = true; $("mr-enviar").disabled = true; $("mr-enviar").textContent = "Enviando…";
        try {
            var r = await enviar(base() + "/responder", { uuid: a.uuid, acepta: a.acepta, confirmo: true });
            $("modal-responder").hidden = true;
            aviso(esc(r.mensaje));
            await cargar();
        } catch (e) { $("mr-error").textContent = e.message; $("mr-error").hidden = false; $("mr-enviar").disabled = false; }
        E.ocupado = false; $("mr-enviar").textContent = a.acepta ? "Aceptar" : "Rechazar";
    }

    async function revisar(id, boton) {
        boton.disabled = true; boton.textContent = "Revisando…";
        try { var r = await enviar(base() + "/revisar/" + id); aviso("SAT: " + esc(r.sat.estado + (r.sat.estatus_cancelacion ? " · " + r.sat.estatus_cancelacion : "")) + " → " + esc(r.estado_texto)); await cargar(); }
        catch (e) { aviso(esc(e.message), true); boton.disabled = false; boton.textContent = "Revisar en el SAT"; }
    }

    async function bajarAcuse(id) {
        try {
            var r = await fetch(API + base() + "/acuse/" + id, { credentials: "include" });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            var nombre = ((r.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/) || [])[1] || "acuse.xml";
            var url = URL.createObjectURL(await r.blob()), a = document.createElement("a");
            a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        } catch (e) { aviso(esc(e.message), true); }
    }

    function eventos() {
        $("btn-empresa").addEventListener("click", function (e) { e.stopPropagation(); var mn = $("menu-empresa"); if (mn.hidden) pintarMenu(); mn.hidden = !mn.hidden; });
        $("menu-empresa").addEventListener("click", function (e) { e.stopPropagation(); var b = e.target.closest("[data-rfc]"); if (!b) return; $("menu-empresa").hidden = true; E.rfc = b.dataset.rfc; titulo(); ponerVista(E.vista); cargar(); });
        document.addEventListener("click", function () { $("menu-empresa").hidden = true; });
        document.querySelectorAll("[data-vista]").forEach(function (b) { b.addEventListener("click", function () { ponerVista(b.dataset.vista); }); });
        $("sel-anio").addEventListener("change", function () { E.anio = +this.value; cargarEmitidas(); });
        $("sel-mes").addEventListener("change", function () { E.mes = +this.value; cargarEmitidas(); });
        $("buscar").addEventListener("input", function () { E.buscar = this.value; pintarEmitidas(); });
        $("btn-buscar").addEventListener("click", buscarPendientes);
        $("tb-emit").addEventListener("click", function (e) { var b = e.target.closest("[data-cancelar]"); if (b) abrirCancelar(b.dataset.cancelar); });
        $("tb-pend").addEventListener("click", function (e) { var b = e.target.closest("[data-responder]"); if (b) abrirResponder(b.dataset.uuid, b.dataset.responder === "1"); });
        $("tb-hist").addEventListener("click", function (e) {
            var b = e.target.closest("[data-revisar]"); if (b) revisar(b.dataset.revisar, b);
            var a = e.target.closest("[data-acuse]"); if (a) bajarAcuse(a.dataset.acuse);
        });
        $("mc-motivo").addEventListener("change", validarCancelar);
        $("mc-sust").addEventListener("input", validarCancelar);
        $("mc-confirmo").addEventListener("change", validarCancelar);
        $("mc-cerrar").addEventListener("click", function () { $("modal-cancelar").hidden = true; });
        $("mc-enviar").addEventListener("click", enviarCancelar);
        $("mr-confirmo").addEventListener("change", function () { $("mr-enviar").disabled = !this.checked || E.ocupado; });
        $("mr-cerrar").addEventListener("click", function () { $("modal-responder").hidden = true; });
        $("mr-enviar").addEventListener("click", enviarRespuesta);
        document.querySelectorAll(".xml-modal").forEach(function (mo) { mo.addEventListener("click", function (e) { if (e.target === mo && !E.ocupado) mo.hidden = true; }); });
        document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !E.ocupado) { $("modal-cancelar").hidden = true; $("modal-responder").hidden = true; } });
    }

    document.addEventListener("DOMContentLoaded", iniciar);
})();
