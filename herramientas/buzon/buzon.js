/*
 * herramientas/buzon/buzon.js — Buzón Tributario de todas las empresas.
 *
 * "Todas mis empresas": lo que hay que atender en cada una (nuevos, cancelaciones por responder con
 * su fecha límite, notificaciones pendientes) y el estado de la última revisión; "Revisar ahora".
 * "Por empresa": comunicados (contenido completo, categoría, estado en el SAT y en Fiscontable),
 * solicitudes de cancelación (con el CFDI de tu biblioteca), notificaciones (pendientes sin abrir y
 * notificadas con sus PDF), archivados y el historial de revisiones.
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var E = { panel: null, vista: "todas", rfc: null, detalle: null, seccion: "comunicados", abierto: null, reloj: null, trabajo: null };
    var URL_BUZON_SAT = "https://wwwmat.sat.gob.mx/personas/iniciar-sesion";
    var URL_CANCELACION_SAT = "https://portalcfdi.facturaelectronica.sat.gob.mx/";
    var PRIORIDAD = { 1: "alta", 2: "media", 3: "baja" };

    function m(v) { return Number(v || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function fechaHora(iso) {
        if (!iso) return "";
        var d = new Date(iso.length > 10 && !/Z$/.test(iso) ? iso + "Z" : iso);
        return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) + " " + d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    }
    function fechaLocal(iso) {          // fechas del SAT (hora de México, sin zona)
        if (!iso) return "";
        var d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
        var t = d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
        return iso.length > 10 ? t + " " + iso.slice(11, 16) : t;
    }
    function diaSemana(iso) { return new Date(iso + "T12:00:00").toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" }); }
    function hoy() { return new Date().toISOString().slice(0, 10); }
    function aviso(html, tipo) { var a = $("aviso"); a.innerHTML = html || ""; a.className = "bz-aviso" + (tipo ? " bz-aviso--" + tipo : ""); a.hidden = !html; }

    async function api(ruta, metodo, cuerpo) {
        var r;
        try {
            r = await fetch(API + ruta, { method: metodo || "GET", credentials: "include",
                headers: cuerpo ? { "Content-Type": "application/json" } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
        } catch (e) { r = null; }
        if (!r || !r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }

    // ------------------------------------------------------------------ arranque
    async function arrancar() {
        if (!(await Fiscontable.exigirModulo("buzon"))) return;
        await cargarPanel();
        var activa = null;
        try { activa = await Fiscontable.empresaActiva(); } catch (e) { /* sin empresa */ }
        var con = E.panel.empresas.filter(function (e) { return e.efirma; });
        E.rfc = (activa && E.panel.empresas.some(function (e) { return e.rfc === activa.rfc; })) ? activa.rfc : (con[0] || E.panel.empresas[0] || {}).rfc || null;
        var h = location.hash.replace("#", "");
        if (h.indexOf("empresa=") === 0) { E.rfc = decodeURIComponent(h.slice(8)); verVista("empresa"); }
        else verVista("todas");
        if (E.panel.trabajo && E.panel.trabajo.estado === "procesando") vigilarTrabajo(E.panel.trabajo.job_id);
    }

    async function cargarPanel() {
        try { E.panel = await api("/api/buzon"); } catch (e) { aviso(esc(e.message), "error"); return; }
        var sel = $("frecuencia");
        sel.innerHTML = Object.keys(E.panel.frecuencias).sort(function (a, b) { return (+a || 99) - (+b || 99); })
            .map(function (k) { return '<option value="' + k + '"' + (+k === E.panel.frecuencia ? " selected" : "") + ">" + esc(E.panel.frecuencias[k]) + "</option>"; }).join("");
        $("caja-diagnostico").hidden = !E.panel.es_admin;
        pintarResumen();
        pintarEmpresas();
        pintarSelectorEmpresa();
        if (E.panel.es_admin) cargarDiagnosticos();
    }

    function verVista(v) {
        E.vista = v;
        document.querySelectorAll("[data-vista]").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.vista === v ? "true" : "false"); });
        $("vista-todas").hidden = v !== "todas";
        $("vista-empresa").hidden = v !== "empresa";
        try { history.replaceState(null, "", v === "empresa" && E.rfc ? "#empresa=" + encodeURIComponent(E.rfc) : location.pathname); } catch (e) { /* */ }
        if (v === "empresa") cargarEmpresa();
    }

    // ------------------------------------------------------------------ todas mis empresas
    function pintarResumen() {
        var r = E.panel.resumen;
        var tarjetas = [
            { n: r.pendientes, t: "Notificaciones pendientes", d: "Sin abrir en el SAT", c: "roja" },
            { n: r.cancelaciones, t: "Cancelaciones por responder", d: "Dentro del plazo de 3 días hábiles", c: "ambar" },
            { n: r.por_atender, t: "Nuevos por ver", d: "Comunicados y notificaciones", c: "azul" },
            { n: r.errores, t: "Revisiones con error", d: r.sin_efirma ? r.sin_efirma + " empresa(s) sin e.firma guardada" : "Todo se pudo revisar", c: r.errores ? "roja" : "gris" }
        ];
        $("resumen").innerHTML = tarjetas.map(function (x) {
            return '<div class="bz-tarjeta bz-tarjeta--' + (x.n ? x.c : "gris") + '"><strong>' + x.n + "</strong><span>" + x.t + "</span><small>" + esc(x.d) + "</small></div>";
        }).join("");
    }

    function filtradas() {
        var q = $("buscar").value.trim().toLowerCase(), solo = $("solo-atender").checked;
        return E.panel.empresas.filter(function (e) {
            if (solo && !(e.nuevos || e.pendientes || e.cancelaciones || e.estado === "error")) return false;
            return !q || (e.alias + " " + e.rfc).toLowerCase().indexOf(q) !== -1;
        });
    }

    function estadoRevision(e) {
        if (!e.efirma) return '<span class="bz-sello bz-sello--gris">Sin e.firma</span><br><a class="bz-liga" href="/clientes/?editar=' + encodeURIComponent(e.rfc) + '">Guardarla en Mis clientes</a>';
        if (e.estado === "revisando") return '<span class="bz-sello bz-sello--azul">Revisando…</span>';
        var t = e.ultima_revision ? fechaHora(e.ultima_revision) : "Nunca";
        var sello = e.estado === "error" ? '<span class="bz-sello bz-sello--roja">Error</span> ' : e.estado === "ok" ? '<span class="bz-sello bz-sello--verde">OK</span> ' : "";
        return sello + "<small>" + t + "</small>" + (e.estado === "error" && e.mensaje ? '<br><small class="bz-error">' + esc(e.mensaje) + "</small>" : "") +
            (e.proxima && e.activo ? "<br><small>Próxima: " + (e.proxima === "esta noche" ? "esta noche" : fechaLocal(e.proxima)) + "</small>" : "");
    }

    function pintarEmpresas() {
        var filas = filtradas();
        $("empresas").innerHTML = filas.length ? filas.map(function (e) {
            var canc = e.cancelaciones ? '<b class="bz-ambar">' + e.cancelaciones + "</b> · vence " + esc(diaSemana(e.limite_cancelacion)) : '<span class="bz-tenue">—</span>';
            return '<tr data-rfc="' + esc(e.rfc) + '"' + (e.efirma ? "" : ' class="bz-sin-efirma"') + ">" +
                '<td class="bz-check"><input type="checkbox" class="bz-elegir" value="' + esc(e.rfc) + '"' + (e.efirma ? "" : " disabled") + ' aria-label="Elegir ' + esc(e.rfc) + '"></td>' +
                '<td><button type="button" class="bz-empresa-btn" data-abrir="' + esc(e.rfc) + '"><b>' + esc(e.alias || e.rfc) + "</b><small>" + esc(e.rfc) + "</small></button></td>" +
                '<td class="num">' + (e.nuevos ? '<span class="bz-cuenta">' + e.nuevos + "</span>" : '<span class="bz-tenue">0</span>') + "</td>" +
                "<td>" + canc + "</td>" +
                '<td class="num">' + (e.pendientes ? '<span class="bz-cuenta bz-cuenta--roja">' + e.pendientes + "</span>" : '<span class="bz-tenue">0</span>') + "</td>" +
                "<td>" + estadoRevision(e) + "</td>" +
                '<td><label class="bz-switch"><input type="checkbox" data-activo="' + esc(e.rfc) + '"' + (e.activo && e.efirma ? " checked" : "") + (e.efirma ? "" : " disabled") +
                '><span></span></label></td>' +
                '<td><button type="button" class="bz-btn" data-abrir="' + esc(e.rfc) + '">Abrir</button></td></tr>';
        }).join("") : '<tr><td colspan="8" class="bz-vacio">' + (E.panel.empresas.length ? "Nada coincide con el filtro." : "Aún no tienes empresas en Mis clientes.") + "</td></tr>";
        actualizarBotonRevisar();
    }

    function elegidas() { return Array.prototype.map.call(document.querySelectorAll(".bz-elegir:checked"), function (c) { return c.value; }); }
    function actualizarBotonRevisar() {
        var n = elegidas().length, b = $("btn-revisar");
        b.disabled = !n || !!E.trabajo;
        b.textContent = n ? "Revisar ahora (" + n + ")" : "Revisar ahora";
    }

    async function cargarDiagnosticos() {
        try {
            var r = await api("/api/admin/buzon/diagnosticos");
            $("caja-diagnosticos").hidden = !r.diagnosticos.length;
            $("diagnosticos").innerHTML = r.diagnosticos.slice(0, 15).map(function (d) {
                return '<li><button type="button" class="bz-liga" data-diag="' + esc(d.nombre) + '">' + esc(d.nombre) + "</button> <small>" +
                    d.archivos + " archivos · " + esc(d.pasos.join(", ")) + "</small></li>";
            }).join("");
        } catch (e) { /* no es admin o no hay */ }
    }

    // ------------------------------------------------------------------ revisar ahora
    async function revisar(rfcs) {
        try {
            var t = await api("/api/buzon/revisar", "POST", { rfcs: rfcs, diagnostico: $("con-diagnostico").checked });
            aviso("");
            vigilarTrabajo(t.job_id, t);
        } catch (e) { aviso(esc(e.message), "error"); }
    }

    function pintarTrabajo(t) {
        var r = t.renglones || [];
        var listos = r.filter(function (x) { return ["ok", "parcial", "error", "cancelado"].indexOf(x.estado) !== -1; }).length;
        $("progreso").hidden = false;
        var abrir = t.tipo === "buzon_abrir";
        $("progreso-titulo").textContent = abrir ? (t.estado === "procesando" ? "Abriendo la notificación…" : "Apertura terminada")
            : (t.estado === "procesando" ? "Revisando el buzón…" : "Revisión terminada");
        $("progreso-cuenta").textContent = listos + " de " + r.length;
        var NOM = { en_fila: "En fila", revisando: abrir ? "Abriendo en el SAT…" : "Revisando…", ok: "Listo", parcial: "Listo con avisos", error: "Error", cancelado: "Detenido" };
        $("progreso-lista").innerHTML = r.map(function (x) {
            return '<li class="bz-progreso__' + esc(x.estado) + '"><b>' + esc(x.alias || x.rfc) + "</b>" + (x.folio ? " · folio <code>" + esc(x.folio) + "</code>" : "") + " " + esc(NOM[x.estado] || x.estado) +
                (x.mensaje ? " · <small>" + esc(x.mensaje) + "</small>" : "") + "</li>";
        }).join("") + (t.tiene_diagnostico && t.estado !== "procesando" ? '<li>El ZIP con el diagnóstico quedó en <button type="button" class="bz-liga" id="ver-descargas">Descargas</button>.</li>' : "");
    }

    function vigilarTrabajo(jobId, inicial) {
        E.trabajo = jobId;
        actualizarBotonRevisar();
        $("btn-revisar-una").disabled = true;
        if (inicial) pintarTrabajo(inicial);
        clearInterval(E.reloj);
        E.reloj = setInterval(async function () {
            var t;
            try { t = await api("/api/buzon/trabajo?job_id=" + encodeURIComponent(jobId)); } catch (e) { return; }
            if (!t || !t.job_id) return;
            pintarTrabajo(t);
            if (t.estado !== "procesando") {
                clearInterval(E.reloj);
                E.trabajo = null;
                $("btn-revisar-una").disabled = false;
                await cargarPanel();
                if (E.vista === "empresa") cargarEmpresa();
            }
        }, 4000);
    }

    // ------------------------------------------------------------------ por empresa
    function pintarSelectorEmpresa() {
        $("empresa").innerHTML = E.panel.empresas.map(function (e) {
            var marcas = (e.pendientes ? " · " + e.pendientes + " pendiente(s)" : "") + (e.nuevos ? " · " + e.nuevos + " nuevo(s)" : "");
            return '<option value="' + esc(e.rfc) + '"' + (e.rfc === E.rfc ? " selected" : "") + ">" + esc((e.alias || e.rfc) + " — " + e.rfc + marcas) + "</option>";
        }).join("");
    }

    async function cargarEmpresa() {
        if (!E.rfc) { $("contenido").innerHTML = '<p class="bz-vacio">Agrega empresas en Mis clientes.</p>'; return; }
        $("empresa").value = E.rfc;
        try { E.detalle = await api("/api/buzon/empresas/" + encodeURIComponent(E.rfc)); } catch (e) { aviso(esc(e.message), "error"); return; }
        var e = E.detalle.empresa || {};
        $("empresa-estado").innerHTML = estadoRevision(e);
        $("btn-revisar-una").disabled = !e.efirma || !!E.trabajo;
        pintarPestanas();
        pintarSeccion();
    }

    function conteos() {
        var c = E.detalle.comunicados, n = E.detalle.notificaciones, h = E.detalle.hoy;
        return {
            comunicados: c.filter(function (x) { return !x.archivado && !x.visto; }).length,
            cancelaciones: c.filter(function (x) { return x.categoria === "cancelacion" && !x.archivado && (x.datos.limite || "") >= h; }).length,
            notificaciones: n.filter(function (x) { return x.estado === "pendiente"; }).length,
            notificaciones_nuevas: n.filter(function (x) { return x.estado === "notificado" && !x.visto; }).length,
            archivados: c.filter(function (x) { return x.archivado; }).length
        };
    }

    function pintarPestanas() {
        var k = conteos();
        var P = [
            ["comunicados", "Comunicados", k.comunicados, "azul"],
            ["cancelaciones", "Solicitudes de cancelación", k.cancelaciones, "ambar"],
            ["notificaciones", "Notificaciones", k.notificaciones || k.notificaciones_nuevas, k.notificaciones ? "roja" : "azul"],
            ["archivados", "Archivados", 0, ""],
            ["revisiones", "Revisiones", 0, ""]
        ];
        $("pestanas").innerHTML = P.map(function (p) {
            return '<button type="button" role="tab" data-seccion="' + p[0] + '" aria-selected="' + (E.seccion === p[0]) + '">' + p[1] +
                (p[2] ? ' <span class="bz-insignia bz-insignia--' + p[3] + '">' + p[2] + "</span>" : "") + "</button>";
        }).join("");
    }

    function pintarSeccion() {
        var s = E.seccion;
        if (s === "comunicados") $("contenido").innerHTML = listaComunicados(E.detalle.comunicados.filter(function (c) { return !c.archivado; }), "Aún no hay comunicados. Pulsa Revisar ahora.");
        else if (s === "archivados") $("contenido").innerHTML = listaComunicados(E.detalle.comunicados.filter(function (c) { return c.archivado; }), "No has archivado comunicados.");
        else if (s === "cancelaciones") $("contenido").innerHTML = cancelaciones();
        else if (s === "notificaciones") $("contenido").innerHTML = notificaciones();
        else $("contenido").innerHTML = revisiones();
    }

    /* El contenido como lo muestra el SAT: **negritas**, tablas (celdas separadas por tabulador),
       pasos numerados y viñetas; ligas clicables. Todo se escapa antes de dar formato. */
    function enLinea(t) {
        var h = esc(t).replace(/\*\*([^*]+?)\*\*/g, "<b>$1</b>").replace(/\*\*/g, "");
        h = h.replace(/^((?:Nombre|RFC|Folio|Remitente):.*)$/, "<b>$1</b>").replace(/^(Fundamento legal:)/, "<b>$1</b>");
        return h.replace(/https?:\/\/[^\s<]+/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + "</a>"; });
    }

    // Texto guardado sin marcas (revisiones viejas o el SAT sin etiquetas): se reconstruye el formato del SAT
    // con reglas sencillas: tabla de "periodo  $importe", títulos en negritas y los pasos numerados.
    var IMPORTE = /^(.+?)\s+(-?\$\s?[\d,]+(?:\.\d{1,2})?)$/;
    function darFormato(lineas) {
        var out = [], i = 0, pasos = false;
        while (i < lineas.length) {
            var l = lineas[i].trim(), sig = (lineas[i + 1] || "").trim();
            if (!l) { i++; continue; }
            // Encabezado de tabla seguido de renglones con importe
            if (l.indexOf("$") === -1 && l.length < 90 && !/[:.]$/.test(l) && IMPORTE.test(sig) && l.indexOf(" ") > 0) {
                var corte = l.indexOf(" ");
                out.push(l.slice(0, corte) + "\t" + l.slice(corte + 1)); i++;
                while (i < lineas.length && IMPORTE.test(lineas[i].trim())) {
                    var mm = lineas[i].trim().match(IMPORTE); out.push(mm[1] + "\t" + mm[2]); i++;
                }
                continue;
            }
            if (pasos && (l.length > 260 || /^(Te |Fundamento|¡|Si requieres|En el SAT|Atentamente)/.test(l))) pasos = 0;
            if (pasos) { out.push(pasos + ". " + l); pasos++; i++; continue; }
            if (/^Pasos\b.*:$/i.test(l)) { pasos = 1; out.push("**" + l + "**"); i++; continue; }
            if ((out.length === 0 && /^Comunicado$/i.test(l)) || (/^Apreciable\b.*:$/.test(l) && l.length < 120) ||
                /^Fecha de corte\b/i.test(l) || /^¡.*!$/.test(l)) l = "**" + l + "**";
            out.push(l); i++;
        }
        return out;
    }

    function contenidoHtml(texto) {
        var lineas = String(texto || "").split("\n"), html = "", i = 0, m;
        if (!/[\t*]/.test(texto || "") && !lineas.some(function (x) { return /^\d{1,2}\.\s/.test(x); })) lineas = darFormato(lineas);
        while (i < lineas.length) {
            var l = lineas[i];
            if (l.indexOf("\t") !== -1) {
                var filas = [];
                while (i < lineas.length && lineas[i].indexOf("\t") !== -1) {
                    filas.push(lineas[i].replace(/\t+$/, "").split("\t"));
                    i++;
                }
                html += '<table class="bz-ctabla">' + filas.map(function (f, n) {
                    var celda = n === 0 ? "th" : "td";
                    return "<tr>" + f.map(function (c) { return "<" + celda + ">" + enLinea(c.trim()) + "</" + celda + ">"; }).join("") + "</tr>";
                }).join("") + "</table>";
                continue;
            }
            if (/^\d{1,2}\.\s+/.test(l) || /^•\s+/.test(l)) {
                var ordenada = /^\d/.test(l), items = [];
                while (i < lineas.length && (m = lineas[i].match(ordenada ? /^\d{1,2}\.\s+(.*)$/ : /^•\s+(.*)$/))) { items.push(m[1]); i++; }
                var t = ordenada ? "ol" : "ul";
                html += "<" + t + ' class="bz-clista">' + items.map(function (x) { return "<li>" + enLinea(x) + "</li>"; }).join("") + "</" + t + ">";
                continue;
            }
            html += "<p>" + enLinea(l) + "</p>";
            i++;
        }
        return html;
    }

    function listaComunicados(lista, vacio) {
        if (!lista.length) return '<p class="bz-vacio">' + vacio + "</p>";
        return '<ul class="bz-mensajes">' + lista.map(function (c) {
            var abierto = E.abierto === c.id;
            return '<li class="bz-msj' + (c.visto ? "" : " bz-msj--nuevo") + (abierto ? " bz-msj--abierto" : "") + '" data-id="' + c.id + '">' +
                '<button type="button" class="bz-msj__fila" data-abrir-msj="' + c.id + '" aria-expanded="' + abierto + '">' +
                '<span class="bz-punto" title="' + (c.visto ? "Visto" : "Nuevo") + '"></span>' +
                '<span class="bz-msj__fecha">' + esc(fechaLocal(c.fecha)) + "</span>" +
                '<span class="bz-msj__asunto">' + esc(c.asunto) + "</span>" +
                '<span class="bz-cat bz-cat--' + PRIORIDAD[c.prioridad] + '">' + esc(c.categoria_nombre) + "</span>" +
                '<span class="bz-msj__sat">' + (c.estado_sat === "leido" ? "Leído en el SAT" : c.estado_sat === "no_leido" ? "No leído en el SAT" : "") + "</span></button>" +
                (abierto ? '<div class="bz-msj__cuerpo">' +
                    (c.folio ? '<p class="bz-nota">Folio: <b>' + esc(c.folio) + "</b></p>" : "") +
                    (c.categoria === "cancelacion" ? tarjetaCancelacion(c, true) : "") +
                    (c.contenido ? '<div class="bz-texto">' + contenidoHtml(c.contenido) + "</div>" : '<p class="bz-nota">El SAT no mandó el texto en la lista. Ábrelo en el <a href="' + URL_BUZON_SAT + '" target="_blank" rel="noopener">Buzón del SAT</a>.</p>') +
                    '<div class="bz-acciones"><button type="button" class="bz-btn" data-visto="' + c.id + '" data-valor="' + (c.visto ? 0 : 1) + '">' + (c.visto ? "Marcar como nuevo" : "Marcar como visto") + "</button>" +
                    '<button type="button" class="bz-btn" data-archivar="' + c.id + '" data-valor="' + (c.archivado ? 0 : 1) + '">' + (c.archivado ? "Sacar de archivados" : "Archivar") + "</button></div></div>" : "") +
                "</li>";
        }).join("") + "</ul>";
    }

    function tarjetaCancelacion(c, dentro) {
        var d = c.datos || {}, h = E.detalle.hoy, vencida = d.limite && d.limite < h;
        var urg = !vencida && d.limite && (new Date(d.limite) - new Date(h)) / 864e5 <= 1;
        var cfdis = (d.cfdi || (d.uuids || []).map(function (u) { return { uuid: u }; })).map(function (x) {
            var info = x.en_biblioteca ? "En tu biblioteca: <b>$" + m(x.total) + "</b>" + (x.moneda && x.moneda !== "MXN" ? " " + esc(x.moneda) : "") + " · " + esc(fechaLocal(x.fecha)) +
                ' · <a class="bz-liga" target="_blank" rel="noopener" href="/herramientas/xml/detalle/?rfc=' + encodeURIComponent(E.rfc) + "&uuid=" + encodeURIComponent(x.uuid) + '">Ver CFDI</a>'
                : '<span class="bz-tenue">No está en tu biblioteca de XML</span>';
            return '<li><code>' + esc(x.uuid) + "</code><br><small>" + info + "</small></li>";
        }).join("");
        return '<div class="bz-cancel' + (vencida ? " bz-cancel--vencida" : urg ? " bz-cancel--urgente" : "") + (dentro ? " bz-cancel--dentro" : "") + '">' +
            '<div class="bz-cancel__cabeza"><div><b>' + esc(d.emisor || "Emisor sin nombre") + "</b> pide cancelar " + ((d.uuids || []).length === 1 ? "una factura" : (d.uuids || []).length + " facturas") +
            '<br><small>Recibida el ' + esc(fechaLocal(c.fecha)) + "</small></div>" +
            '<div class="bz-cancel__plazo">' + (d.limite ? (vencida ? "Plazo vencido el " + esc(diaSemana(d.limite)) : "Responde a más tardar el <b>" + esc(diaSemana(d.limite)) + "</b>") : "") + "</div></div>" +
            (cfdis ? '<ul class="bz-uuids">' + cfdis + "</ul>" : "") +
            '<p class="bz-nota">Acepta o rechaza en el <a class="bz-liga" target="_blank" rel="noopener" href="' + URL_CANCELACION_SAT + '">portal de facturas del SAT</a> (Cancelación → solicitudes recibidas). Plazo: 3 días hábiles desde que la recibiste.</p></div>';
    }

    function cancelaciones() {
        var lista = E.detalle.comunicados.filter(function (c) { return c.categoria === "cancelacion" && !c.archivado; });
        if (!lista.length) return '<p class="bz-vacio">No hay solicitudes de cancelación.</p>';
        var h = E.detalle.hoy;
        lista.sort(function (a, b) { var va = (a.datos.limite || "") < h, vb = (b.datos.limite || "") < h; return va - vb || (a.datos.limite || "").localeCompare(b.datos.limite || ""); });
        return lista.map(function (c) {
            return tarjetaCancelacion(c, false).replace("</div></div>", "</div></div>") +
                '<div class="bz-acciones bz-acciones--cancel"><button type="button" class="bz-btn" data-archivar="' + c.id + '" data-valor="1">Ya la respondí · archivar</button></div>';
        }).join("");
    }

    function notificaciones() {
        var n = E.detalle.notificaciones, pend = n.filter(function (x) { return x.estado === "pendiente"; }), notif = n.filter(function (x) { return x.estado === "notificado"; });
        var puedeAbrir = !!(E.panel && E.panel.puede_abrir && E.detalle.empresa && E.detalle.empresa.efirma);
        var html = "";
        if (pend.length) {
            html += '<div class="bz-pendientes"><h3>Notificaciones pendientes (' + pend.length + ")</h3>" +
                "<p><b>Las revisiones nunca las abren.</b> Si la abres con tu e.firma quedas notificado en ese momento y empiezan a correr los plazos. " +
                "Si no la abres, el SAT te tiene por notificado al cuarto día después del aviso.</p>" +
                '<div class="bz-tabla-caja"><table class="bz-tabla"><thead><tr><th>Folio</th><th>Autoridad</th><th>Acto</th><th>Aviso</th>' + (puedeAbrir ? "<th></th>" : "") + "</tr></thead><tbody>" +
                pend.map(function (x) {
                    var ap = x.apertura && x.apertura.estado === "error" ? '<span class="bz-apertura">Último intento de abrirla: ' + esc(x.apertura.mensaje) + "</span>" : "";
                    return "<tr><td><code>" + esc(x.folio) + "</code>" + ap + "</td><td>" + esc(x.autoridad) + "</td><td>" + esc(x.acto) + "</td><td>" + esc(fechaLocal(x.fecha_aviso)) + "</td>" +
                        (puedeAbrir ? '<td><button type="button" class="bz-btn bz-btn--peligro" data-abrir-notif="' + x.id + '"' + (E.trabajo ? " disabled" : "") + ">Abrir y quedar notificado</button></td>" : "") + "</tr>";
                }).join("") +
                "</tbody></table></div><p>" + (puedeAbrir ? "Puedes abrirla desde aquí (el robot firma con la e.firma guardada) o " : "") +
                '<a class="bz-liga" target="_blank" rel="noopener" href="' + URL_BUZON_SAT + '">abrirla en el Buzón del SAT</a>' + (puedeAbrir ? "" : " y después pulsar Revisar ahora para que aquí aparezcan sus documentos") + ".</p></div>";
        }
        html += "<h3 class=\"bz-subtitulo\">Notificadas</h3>";
        if (!notif.length) return html + '<p class="bz-vacio">No hay notificaciones.</p>';
        var NOM = { aviso: "Aviso", acto: "Acto administrativo", acuse: "Acuse", flujo1: "Documento 1", flujo2: "Documento 2", flujo3: "Documento 3" };
        return html + '<div class="bz-tabla-caja"><table class="bz-tabla"><thead><tr><th>Folio</th><th>Autoridad</th><th>Acto</th><th>Notificada</th><th>Documentos</th></tr></thead><tbody>' +
            notif.map(function (x) {
                var abierta = x.abierta_en ? '<span class="bz-abierta">Abierta desde Fiscontable el ' + esc(fechaHora(x.abierta_en)) + (x.abierta_por ? " por " + esc(x.abierta_por) : "") + "</span>" : "";
                return '<tr' + (x.visto ? "" : ' class="bz-fila-nueva"') + "><td><code>" + esc(x.folio) + "</code>" + (x.visto ? "" : ' <span class="bz-sello bz-sello--azul">Nueva</span>') + abierta + "</td><td>" + esc(x.autoridad) + "</td><td>" + esc(x.acto) + "</td>" +
                    "<td>" + esc(fechaLocal(x.fecha_notificacion)) + '</td><td><div class="bz-acciones">' +
                    (x.documentos.length ? ["aviso", "acto", "acuse", "flujo1", "flujo2", "flujo3"].filter(function (k) { return x.documentos.indexOf(k) !== -1; }).map(function (k) {
                        return '<button type="button" class="bz-btn' + (k === "acto" ? " bz-btn--si" : "") + '" data-doc="' + x.id + '" data-clave="' + k + '" data-folio="' + esc(x.folio) + '">' + NOM[k] + "</button>";
                    }).join("") : '<small class="bz-tenue">Se bajan en la siguiente revisión</small>') + "</div></td></tr>";
            }).join("") + "</tbody></table></div>";
    }

    function revisiones() {
        var r = E.detalle.revisiones;
        if (!r.length) return '<p class="bz-vacio">Esta empresa aún no se ha revisado.</p>';
        var ORIGEN = { manual: "Revisar ahora", madrugada: "Madrugada", abrir: "Abrir notificación" };
        return '<div class="bz-tabla-caja"><table class="bz-tabla"><thead><tr><th>Cuándo</th><th>Cómo</th><th>Resultado</th><th class="num">Nuevos</th></tr></thead><tbody>' +
            r.map(function (x) {
                var s = x.estado === "ok" ? "verde" : x.estado === "parcial" ? "ambar" : x.estado === "revisando" ? "azul" : "roja";
                var t = { ok: "OK", parcial: "Con avisos", error: "Error", revisando: "Revisando" }[x.estado] || x.estado;
                return "<tr><td>" + esc(fechaHora(x.inicio)) + "</td><td>" + esc(ORIGEN[x.origen] || x.origen) + '</td><td><span class="bz-sello bz-sello--' + s + '">' + t + "</span> <small>" + esc(x.mensaje || "") + '</small></td><td class="num">' + (x.nuevos || 0) + "</td></tr>";
            }).join("") + "</tbody></table></div>";
    }

    async function marcar(ruta, ids, valor) {
        try { await api(ruta, "POST", { ids: ids, valor: !!valor }); } catch (e) { aviso(esc(e.message), "error"); return; }
        var tabla = ruta.indexOf("notificaciones") !== -1 ? E.detalle.notificaciones : E.detalle.comunicados;
        var campo = ruta.indexOf("archivar") !== -1 ? "archivado" : "visto";
        tabla.forEach(function (x) { if (ids.indexOf(x.id) !== -1) x[campo] = !!valor; });
        pintarPestanas();
        pintarSeccion();
        refrescarConteoPanel();
    }

    async function refrescarConteoPanel() {
        try { E.panel = await api("/api/buzon"); pintarResumen(); pintarEmpresas(); pintarSelectorEmpresa(); } catch (e) { /* */ }
    }

    async function bajarDocumento(b) {
        b.disabled = true;
        try {
            var r = await fetch(API + "/api/buzon/notificaciones/" + b.dataset.doc + "/" + b.dataset.clave, { credentials: "include" });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            var nom = { aviso: "Aviso", acto: "Acto", acuse: "Acuse", flujo1: "Documento_1", flujo2: "Documento_2", flujo3: "Documento_3" }[b.dataset.clave] || b.dataset.clave;
            Fiscontable.guardarArchivo(await r.blob(), E.rfc + "_" + b.dataset.folio.replace(/[^A-Za-z0-9]+/g, "_") + "_" + nom + ".pdf");
            var n = E.detalle.notificaciones.filter(function (x) { return x.id === +b.dataset.doc; })[0];
            if (n && !n.visto) marcar("/api/buzon/notificaciones/visto", [n.id], 1);
        } catch (e) { aviso(esc(e.message), "error"); }
        b.disabled = false;
    }

    // ------------------------------------------------------------------ abrir una notificación pendiente
    function pedirApertura(id) {
        var x = E.detalle.notificaciones.filter(function (n) { return n.id === id; })[0];
        if (!x) return;
        E.porAbrir = x;
        var emp = E.detalle.empresa || {};
        $("dlg-abrir-datos").innerHTML = "<dt>Empresa</dt><dd>" + esc((emp.alias || emp.rfc) + " — " + emp.rfc) + "</dd>" +
            "<dt>Folio</dt><dd><code>" + esc(x.folio) + "</code></dd><dt>Autoridad</dt><dd>" + esc(x.autoridad || "—") + "</dd>" +
            "<dt>Acto</dt><dd>" + esc(x.acto || "—") + "</dd><dt>Aviso</dt><dd>" + esc(fechaLocal(x.fecha_aviso) || "—") + "</dd>";
        $("abrir-entiendo").checked = false;
        $("abrir-confirmar").disabled = true;
        $("abrir-diag-caja").hidden = !E.panel.es_admin;
        $("dlg-abrir").showModal();
    }

    async function abrirNotificacion() {
        var x = E.porAbrir;
        if (!x || !$("abrir-entiendo").checked) return;
        try {
            var t = await api("/api/buzon/notificaciones/abrir", "POST", { rfc: E.rfc, folio: x.folio, entiendo: true,
                diagnostico: E.panel.es_admin && $("abrir-diag").checked });
            aviso("");
            vigilarTrabajo(t.job_id, t);
            pintarSeccion();
        } catch (e) { aviso(esc(e.message), "error"); }
    }

    async function bajarDiagnostico(nombre) {
        try {
            var r = await fetch(API + "/api/admin/buzon/diagnosticos/" + encodeURIComponent(nombre), { credentials: "include" });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            Fiscontable.guardarArchivo(await r.blob(), nombre + ".zip");
        } catch (e) { aviso(esc(e.message), "error"); }
    }

    // ------------------------------------------------------------------ eventos
    document.addEventListener("DOMContentLoaded", function () {
        document.querySelectorAll("[data-vista]").forEach(function (b) { b.addEventListener("click", function () { verVista(b.dataset.vista); }); });
        $("buscar").addEventListener("input", pintarEmpresas);
        $("solo-atender").addEventListener("change", pintarEmpresas);
        $("todas").addEventListener("change", function () {
            var v = this.checked;
            document.querySelectorAll(".bz-elegir:not(:disabled)").forEach(function (c) { c.checked = v; });
            actualizarBotonRevisar();
        });
        $("frecuencia").addEventListener("change", async function () {
            try { await api("/api/buzon/ajustes", "PUT", { frecuencia: +this.value }); aviso("Listo: revisión automática " + esc(this.options[this.selectedIndex].text.toLowerCase()) + ".", "ok"); await cargarPanel(); }
            catch (e) { aviso(esc(e.message), "error"); }
        });
        $("tabla-empresas").addEventListener("change", async function (e) {
            if (e.target.classList.contains("bz-elegir")) { actualizarBotonRevisar(); return; }
            var rfc = e.target.dataset.activo;
            if (!rfc) return;
            try { await api("/api/buzon/empresas/" + encodeURIComponent(rfc), "PUT", { activo: e.target.checked }); await cargarPanel(); }
            catch (err) { aviso(esc(err.message), "error"); e.target.checked = !e.target.checked; }
        });
        $("tabla-empresas").addEventListener("click", function (e) {
            var b = e.target.closest("[data-abrir]");
            if (b) { E.rfc = b.dataset.abrir; E.seccion = "comunicados"; E.abierto = null; verVista("empresa"); }
        });
        $("btn-revisar").addEventListener("click", function () { revisar(elegidas()); });
        $("btn-revisar-una").addEventListener("click", function () { if (E.rfc) revisar([E.rfc]); });
        $("progreso").addEventListener("click", function (e) { if (e.target.id === "ver-descargas" && Fiscontable.abrirDescargas) Fiscontable.abrirDescargas(); });
        $("diagnosticos").addEventListener("click", function (e) { var b = e.target.closest("[data-diag]"); if (b) bajarDiagnostico(b.dataset.diag); });
        $("empresa").addEventListener("change", function () {
            E.rfc = this.value; E.abierto = null;
            try { Fiscontable.elegirEmpresa(E.rfc); } catch (e) { /* */ }
            verVista("empresa");
        });
        window.addEventListener("fiscontable:empresa", function (ev) {
            if (ev.detail && ev.detail.rfc && ev.detail.rfc !== E.rfc && E.panel && E.panel.empresas.some(function (x) { return x.rfc === ev.detail.rfc; })) {
                E.rfc = ev.detail.rfc; if (E.vista === "empresa") cargarEmpresa();
            }
        });
        $("pestanas").addEventListener("click", function (e) {
            var b = e.target.closest("[data-seccion]");
            if (b) { E.seccion = b.dataset.seccion; pintarPestanas(); pintarSeccion(); }
        });
        $("btn-vistos").addEventListener("click", function () {
            var ids = E.detalle.comunicados.filter(function (c) { return !c.visto; }).map(function (c) { return c.id; });
            var nids = E.detalle.notificaciones.filter(function (n) { return n.estado === "notificado" && !n.visto; }).map(function (n) { return n.id; });
            if (ids.length) marcar("/api/buzon/comunicados/visto", ids, 1);
            if (nids.length) marcar("/api/buzon/notificaciones/visto", nids, 1);
        });
        $("contenido").addEventListener("click", function (e) {
            var b = e.target.closest("button");
            if (!b) return;
            if (b.dataset.abrirMsj) {
                var id = +b.dataset.abrirMsj;
                E.abierto = E.abierto === id ? null : id;
                var c = E.detalle.comunicados.filter(function (x) { return x.id === id; })[0];
                if (E.abierto && c && !c.visto) marcar("/api/buzon/comunicados/visto", [id], 1);
                else pintarSeccion();
            } else if (b.dataset.visto) marcar("/api/buzon/comunicados/visto", [+b.dataset.visto], +b.dataset.valor);
            else if (b.dataset.archivar) { E.abierto = null; marcar("/api/buzon/comunicados/archivar", [+b.dataset.archivar], +b.dataset.valor); }
            else if (b.dataset.doc) bajarDocumento(b);
            else if (b.dataset.abrirNotif) pedirApertura(+b.dataset.abrirNotif);
        });
        $("abrir-entiendo").addEventListener("change", function () { $("abrir-confirmar").disabled = !this.checked; });
        $("abrir-cancelar").addEventListener("click", function () { $("dlg-abrir").close(); });
        $("form-abrir").addEventListener("submit", function () { if ($("abrir-entiendo").checked) abrirNotificacion(); });
        arrancar();
    });
})();
