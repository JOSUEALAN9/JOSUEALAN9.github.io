/*
 * herramientas/documentos/documentos.js — Pedir actas, constancias, semanas del IMSS… con créditos.
 *
 * El pedido se manda al proveedor y llega en minutos u horas: la lista de Mis pedidos se
 * actualiza sola mientras haya alguno en curso. Los créditos se apartan al pedir, se cobran
 * cuando llega el documento y se devuelven solos si el proveedor lo rechaza.
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var E = { datos: null, categoria: null, servicio: null, reloj: null, enviando: false, vista: "pedir", filtro: "todos", visto: null };
    var EN_CURSO = ["enviando", "en_cola", "en_proceso", "descargando"];
    var FILTROS = [
        { clave: "todos", nombre: "Todos", estados: null },
        { clave: "proceso", nombre: "En proceso", estados: EN_CURSO },
        { clave: "entregado", nombre: "Entregados", estados: ["entregado"] },
        { clave: "rechazado", nombre: "Rechazados", estados: ["rechazado", "error", "devuelto"] },
        { clave: "revisar", nombre: "En revisión", estados: ["revisar"] }
    ];
    var REGLAS = {
        curp: { re: /^[A-Z]{4}\d{6}[HMX][A-Z]{5}[A-Z0-9]\d$/, max: 18, ph: "18 caracteres", error: "debe ser una CURP de 18 caracteres." },
        rfc: { re: /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, max: 13, ph: "12 o 13 caracteres", error: "debe ser un RFC de 12 o 13 caracteres." },
        curp_rfc: { re: /^([A-Z]{4}\d{6}[HMX][A-Z]{5}[A-Z0-9]\d|[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})$/, max: 18, ph: "CURP o RFC", error: "debe ser una CURP (18) o un RFC (12 o 13)." },
        idcif: { re: /^\d{11}$/, max: 11, ph: "11 números", error: "debe tener 11 números.", numerico: true },
        nss: { re: /^\d{11}$/, max: 11, ph: "11 números", error: "debe tener 11 números.", numerico: true }
    };

    function m(v) { return Number(v || 0).toLocaleString("es-MX"); }
    function fecha(iso) {
        if (!iso) return "";
        var d = new Date(iso.length > 10 && !/Z$/.test(iso) ? iso + "Z" : iso);
        return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    }
    function limpio(v) { return String(v || "").toUpperCase().replace(/[\s\-./]/g, ""); }
    function aviso(html, tipo) {
        var a = $("aviso");
        a.innerHTML = html || "";
        a.className = "dc-aviso" + (tipo ? " dc-aviso--" + tipo : "");
        a.hidden = !html;
    }
    function servicioPorId(id) { return (E.datos.servicios || []).filter(function (s) { return s.serviceid === id; })[0]; }

    async function api(ruta, metodo, cuerpo) {
        var r;
        try {
            r = await fetch(API + ruta, { method: metodo || "GET", credentials: "include",
                headers: cuerpo ? { "Content-Type": "application/json" } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
        } catch (e) { r = null; }
        if (!r || !r.ok) {
            var err = new Error(await Fiscontable.leerError(r));
            err.status = r ? r.status : 0;
            throw err;
        }
        return r.json();
    }

    async function arrancar() {
        if (!(await Fiscontable.exigirModulo("documentos"))) return;
        try { E.datos = await api("/api/documentos"); } catch (e) { aviso(esc(e.message), "error"); return; }
        var cats = E.datos.categorias.filter(function (c) { return E.datos.servicios.some(function (s) { return s.categoria === c; }); });
        E.categoria = cats[0] || null;
        E.visto = new Date();
        pintarSaldo();
        pintarCategorias(cats);
        pintarServicios();
        pintarPedidos();
        verVista(location.hash === "#estatus" ? "estatus" : "pedir");
        vigilar();
    }

    function verVista(v) {
        E.vista = v;
        document.querySelectorAll("[data-vista]").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.vista === v ? "true" : "false"); });
        $("vista-pedir").hidden = v !== "pedir";
        $("vista-estatus").hidden = v !== "estatus";
        try { history.replaceState(null, "", v === "estatus" ? "#estatus" : location.pathname + location.search); } catch (e) { /* sin historial */ }
    }

    function pintarSaldo() {
        var s = $("dc-saldo");
        s.hidden = false;
        if (E.datos.sin_costo) {
            s.innerHTML = "Administrador · <b>tú no pagas</b>";
            s.removeAttribute("href");
        } else {
            s.innerHTML = "Saldo <b>" + m(E.datos.saldo) + "</b> créditos · <u>Recargar</u>";
        }
    }

    function pintarCategorias(cats) {
        $("categorias").innerHTML = cats.map(function (c) {
            return '<button type="button" role="tab" data-categoria="' + esc(c) + '" aria-selected="' + (c === E.categoria) + '">' + esc(c) + "</button>";
        }).join("");
        if (!cats.length) $("servicios").innerHTML = '<p class="dc-vacio">Por ahora no hay documentos disponibles.</p>';
    }

    function precioTexto(s) { return m(s.precio) + " créditos"; }

    function pintarServicios() {
        var lista = E.datos.servicios.filter(function (s) { return s.categoria === E.categoria; });
        $("servicios").innerHTML = lista.map(function (s) {
            return '<button type="button" class="dc-servicio" role="radio" data-servicio="' + s.serviceid + '" aria-checked="' + (E.servicio === s.serviceid) + '">' +
                "<b>" + esc(s.nombre) + "</b>" +
                '<span class="dc-servicio__pie"><span>' + esc(s.tiempo || "") + "</span><strong>" + precioTexto(s) + "</strong></span></button>";
        }).join("");
    }

    function elegir(id) {
        var s = servicioPorId(id);
        if (!s) return;
        E.servicio = id;
        pintarServicios();
        var campos = [{ nombre: "", etiqueta: s.principal.etiqueta, tipo: s.principal.tipo, ayuda: s.principal.ayuda }].concat(s.extras);
        $("f-titulo").textContent = s.nombre;
        $("f-campos").innerHTML = campos.map(function (c, i) {
            var r = REGLAS[c.tipo] || {};
            return '<label class="dc-campo">' + esc(c.etiqueta) +
                '<input data-i="' + i + '" data-tipo="' + esc(c.tipo) + '" data-nombre="' + esc(c.nombre) + '" data-etiqueta="' + esc(c.etiqueta) + '"' +
                ' maxlength="' + ((r.max || 20) + 4) + '" placeholder="' + esc(r.ph || "") + '"' + (r.numerico ? ' inputmode="numeric"' : ' autocapitalize="characters"') +
                ' spellcheck="false" required>' + (c.ayuda ? '<small>' + esc(c.ayuda) + "</small>" : "") + "</label>";
        }).join("");
        $("f-costo").innerHTML = E.datos.sin_costo ? "Los usuarios pagan <b>" + m(s.precio) + " créditos</b>. A ti no se te cobra: sale de tu saldo en UnlockerFast." :
            "Cuesta <b>" + m(s.precio) + " créditos</b>. Se apartan al pedir y se cobran cuando llega; si no se puede obtener, se te devuelven." +
            (E.datos.saldo < s.precio ? ' <span class="dc-falta">Te faltan ' + m(s.precio - E.datos.saldo) + ' créditos. <a href="/creditos/">Recargar</a></span>' : "");
        $("f-enviar").textContent = E.datos.sin_costo ? "Solicitar (sin costo para ti)" : "Solicitar · " + m(s.precio) + " créditos";
        $("f-error").hidden = true;
        $("form").hidden = false;
        var primero = $("f-campos").querySelector("input");
        if (primero) primero.focus({ preventScroll: true });
        $("form").scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function leerCampos() {
        var s = servicioPorId(E.servicio), principal = "", extras = {}, valores = [];
        var inputs = $("f-campos").querySelectorAll("input");
        for (var i = 0; i < inputs.length; i++) {
            var el = inputs[i], v = limpio(el.value), r = REGLAS[el.dataset.tipo];
            if (!v) return { error: "Falta " + el.dataset.etiqueta + ".", el: el };
            if (r && !r.re.test(v)) return { error: el.dataset.etiqueta + " " + r.error, el: el };
            if (valores.indexOf(v) !== -1 && el.dataset.tipo === "curp") return { error: "Las dos CURP son iguales.", el: el };
            valores.push(v);
            if (i === 0) principal = v; else extras[el.dataset.nombre] = v;
        }
        return { serviceid: s.serviceid, principal: principal, extras: extras, nota: $("f-nota").value.trim() };
    }

    async function enviar(ev) {
        ev.preventDefault();
        if (E.enviando) return;
        var d = leerCampos(), err = $("f-error");
        if (d.error) { err.textContent = d.error; err.hidden = false; d.el.focus(); return; }
        err.hidden = true;
        E.enviando = true;
        var b = $("f-enviar"), texto = b.textContent;
        b.disabled = true; b.textContent = "Enviando…";
        try {
            var r = await api("/api/documentos/pedidos", "POST", d);
            E.datos.pedidos.unshift(r.pedido);
            E.datos.saldo = r.saldo;
            pintarSaldo();
            pintarPedidos();
            aviso("Listo: pediste <b>" + esc(r.pedido.servicio) + "</b> (folio " + r.pedido.id + "). Llega en " +
                esc((servicioPorId(r.pedido.serviceid) || {}).tiempo || "unos minutos") + ". Puedes seguir pidiendo o cerrar la página; lo ves en " +
                '<button type="button" class="dc-enlace" data-ir="estatus">Mis solicitudes</button>.', "ok");
            $("f-campos").querySelectorAll("input").forEach(function (el) { el.value = ""; });
            $("f-nota").value = "";
            elegir(E.servicio);
            vigilar();
        } catch (e) {
            err.innerHTML = esc(e.message) + (e.status === 402 ? ' <a href="/creditos/">Recargar créditos</a>' : "");
            err.hidden = false;
        } finally {
            E.enviando = false;
            b.disabled = false; b.textContent = texto;
        }
    }

    function estadoHtml(p) {
        var s = servicioPorId(p.serviceid) || {};
        var t = '<span class="dc-sello dc-sello--' + esc(p.estado) + '">' + esc(p.estado_texto) + "</span>";
        if (EN_CURSO.indexOf(p.estado) !== -1) t += s.tiempo ? '<br><small>Suele tardar ' + esc(s.tiempo) + "</small>" : "";
        else if (p.estado === "entregado") {
            t += "<br><small>" + fecha(p.entregado_en) + "</small>";
            if (p.resultado) t += '<pre class="dc-resultado">' + conLigas(p.resultado) + "</pre>";
        } else if (p.estado === "rechazado") t += '<br><span class="dc-motivo">' + esc(p.motivo) + "</span>" + (p.precio ? "<br><small>Se te devolvieron los créditos.</small>" : "");
        else if (p.estado === "error") t += '<br><span class="dc-motivo">' + esc(p.motivo) + "</span>" + (p.precio ? "<br><small>No se te cobró.</small>" : "");
        else if (p.estado === "revisar") t += "<br><small>Lo está revisando el administrador. Si no se resuelve, se te devuelven los créditos.</small>";
        else if (p.estado === "devuelto") t += "<br><small>" + esc(p.motivo) + "</small>";
        return t;
    }

    /* Texto ya escapado con sus ligas https clicables (respuestas del proveedor). */
    function conLigas(texto) {
        return esc(texto).replace(/https?:\/\/[^\s<]+/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + "</a>"; });
    }

    function grupoDe(p) {
        for (var i = 1; i < FILTROS.length; i++) if (FILTROS[i].estados.indexOf(p.estado) !== -1) return FILTROS[i].clave;
        return "";
    }

    /* Datos sensibles (CURP, NSS, RFC) a medias: «DOHA90••••••••••». En el detalle, «Mostrar» los revela. */
    E.revelados = {};
    function enmascarar(v) {
        v = String(v == null ? "" : v);
        var limpio = v.replace(/\s/g, "");
        if (!/^[A-ZÑ&0-9]{10,18}$/i.test(limpio)) return esc(v);
        var deja = /^\d+$/.test(limpio) ? 3 : 6;
        return esc(limpio.slice(0, deja)) + '<span class="dc-oculto" aria-label="oculto">' + "•".repeat(limpio.length - deja) + "</span>";
    }
    function otrosDatos(p) {
        return Object.keys(p.datos || {}).filter(function (k) { return p.datos[k] !== p.titular; }).map(function (k) { return [k, p.datos[k]]; });
    }

    /* ---------- tabla estándar de «Mis solicitudes» */
    var SELLO_ESTADO = { entregado: "verde", rechazado: "rojo", error: "rojo", devuelto: "gris", revisar: "ambar" };
    var t = null;
    function tabla() {
        if (t) return t;
        var bAct = document.createElement("button");
        bAct.type = "button"; bAct.className = "xml-btn"; bAct.id = "btn-actualizar"; bAct.textContent = "Actualizar";
        bAct.addEventListener("click", actualizarTodo);
        t = FCTabla.estandar({
            contenedor: $("tabla-doc"), id: "documentos", claveFila: "id",
            catalogo: [
                { clave: "id", etiqueta: "Folio", tipo: "texto" }, { clave: "creado_en", etiqueta: "Fecha", tipo: "fecha" },
                { clave: "servicio", etiqueta: "Documento", tipo: "texto" }, { clave: "nota", etiqueta: "Referencia", tipo: "texto" },
                { clave: "titular", etiqueta: "Dato", tipo: "texto" }, { clave: "precio", etiqueta: "Créditos", tipo: "numero" },
                { clave: "estado_texto", etiqueta: "Estado", tipo: "texto" }, { clave: "archivo", etiqueta: "Archivo", tipo: "texto" },
                { clave: "entregado_en", etiqueta: "Entregado", tipo: "fecha" }, { clave: "motivo", etiqueta: "Motivo", tipo: "texto" }
            ],
            predeterminadas: ["id", "creado_en", "servicio", "nota", "titular", "precio", "estado_texto", "archivo"],
            anchoClave: { id: 80, servicio: 240, nota: 180, titular: 190, estado_texto: 150, archivo: 190, motivo: 260 },
            celda: function (c, p) {
                if (c.clave === "titular") return '<span class="dc-dato">' + enmascarar(p.titular) + "</span>";
                if (c.clave === "estado_texto") return '<span class="xml-sello xml-sello--' + (SELLO_ESTADO[p.estado] || (EN_CURSO.indexOf(p.estado) !== -1 ? "ambar" : "gris")) + '">' + esc(p.estado_texto) + "</span>";
                if (c.clave === "archivo") {
                    if (p.tiene_archivo) return '<span class="dc-acciones"><button type="button" class="dc-btn" data-ver="' + p.id + '">Ver</button><button type="button" class="dc-btn dc-btn--si" data-bajar="' + p.id + '">Descargar</button></span>';
                    if (p.resultado) return '<span class="dc-acciones"><button type="button" class="dc-btn" data-copiar="' + p.id + '">Copiar respuesta</button></span>';
                    return "";
                }
                return null;
            },
            buscar: { texto: "Buscar CURP, RFC, folio o referencia…", campos: ["buscable"] },
            filtros: [{ clave: "servicio", etiqueta: "Documento" }],
            rapidos: { clave: "grupo", valores: FILTROS.slice(1).map(function (f) { return { valor: f.clave, etiqueta: f.nombre }; }) },
            exportar: { nombre: function () { return "Solicitudes_documentos_" + new Date().toISOString().slice(0, 10) + ".xlsx"; }, hoja: "Mis solicitudes" },
            vacio: { titulo: "Aún no has solicitado documentos", texto: "Lo que pidas en «Solicitar documento» aparece aquí con su estado." },
            extra: [bAct],
            alClic: function (p, lista, ev) {
                var b = ev && ev.target.closest("button");
                if (b && accionBoton(b)) return;
                verSolicitud(p, lista);
            }
        });
        return t;
    }

    function pintarPedidos() {
        var ped = E.datos.pedidos;
        tabla().ponerDatos(ped.map(function (p) {
            return Object.assign({}, p, { grupo: grupoDe(p), archivo: p.tiene_archivo ? "PDF" : p.resultado ? "Respuesta" : "",
                buscable: [p.id, p.titular, p.nota, p.servicio].concat(Object.keys(p.datos || {}).map(function (k) { return p.datos[k]; })).join(" ").toLowerCase() });
        }));
        var n = ped.filter(function (p) { return EN_CURSO.indexOf(p.estado) !== -1; }).length;
        $("n-en-curso").hidden = !n;
        $("n-en-curso").textContent = n;
        $("actualizado").textContent = (E.visto ? "Actualizado a las " + E.visto.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "") +
            (n ? " · se actualiza sola cada 20 segundos mientras haya pedidos en proceso" : "");
        if (E.panel && E.panelId) {                        // el detalle abierto se actualiza con lo nuevo
            var abierto = ped.filter(function (x) { return x.id === E.panelId; })[0];
            if (abierto) E.panel.repintar();
        }
    }

    /* ---------- detalle en el panel lateral: datos, línea de tiempo y acciones */
    function pasos(p) {
        var s = servicioPorId(p.serviceid) || {}, curso = EN_CURSO.indexOf(p.estado) !== -1;
        var fin = { entregado: ["Entregada", "fc-paso--hecho", fecha(p.entregado_en)], rechazado: ["Rechazada", "fc-paso--mal", p.precio ? "Se te devolvieron los créditos." : ""],
                    error: ["Con error", "fc-paso--mal", p.precio ? "No se te cobró." : ""], devuelto: ["Devuelta", "fc-paso--mal", ""],
                    revisar: ["En revisión", "fc-paso--actual", "Lo está revisando el administrador. Si no se resuelve, se te devuelven los créditos."] }[p.estado]
                  || ["Entregada", "", s.tiempo ? "Suele tardar " + s.tiempo : ""];
        return '<ol class="fc-pasos">' +
            '<li class="fc-paso--hecho"><b>Recibida</b>' + esc(fecha(p.creado_en)) + "</li>" +
            '<li class="' + (curso ? "fc-paso--actual" : "fc-paso--hecho") + '"><b>En proceso</b>' + (curso && p.estado_texto !== "En proceso" ? esc(p.estado_texto) : "") + "</li>" +
            '<li class="' + fin[1] + '"><b>' + esc(fin[0]) + "</b>" + esc(fin[2]) + "</li></ol>";
    }
    function verSolicitud(p, lista) {
        var ids = (lista || [p]).map(function (x) { return x.id; });
        E.panel = Fiscontable.panel({
            titulo: "Solicitud", lista: ids, i: ids.indexOf(p.id),
            pintar: function (id, cuerpo) {
                var x = E.datos.pedidos.filter(function (q) { return q.id === id; })[0];
                E.panelId = id;
                if (!x) { cuerpo.innerHTML = '<p class="xml-tenue">Esta solicitud ya no está en la lista.</p>'; return; }
                var ver = !!E.revelados[x.id], dato = function (v) { return ver ? esc(v) : enmascarar(v); };
                var acciones = "";
                if (x.tiene_archivo) acciones += '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-ver="' + x.id + '">Ver</button><button type="button" class="ui-btn ui-btn--primario ui-btn--32" data-bajar="' + x.id + '">Descargar</button>';
                if (x.resultado) acciones += '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-copiar="' + x.id + '">Copiar respuesta</button>';
                if (EN_CURSO.indexOf(x.estado) !== -1 && x.estado !== "enviando") acciones += '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-actualizar="' + x.id + '">Consultar ahora</button>';
                cuerpo.innerHTML = "<h4>" + esc(x.servicio) + "</h4>" +
                    '<dl class="fc-panel__datos"><dt>Folio</dt><dd>' + x.id + "</dd>" +
                    (x.nota ? "<dt>Referencia</dt><dd>" + esc(x.nota) + "</dd>" : "") +
                    '<dt>Dato</dt><dd class="dc-dato">' + dato(x.titular) + ' <button type="button" class="dc-revelar" data-revelar="' + x.id + '">' + (ver ? "Ocultar" : "Mostrar") + "</button></dd>" +
                    otrosDatos(x).map(function (o) { return "<dt>" + esc(o[0]) + "</dt><dd>" + dato(o[1]) + "</dd>"; }).join("") +
                    "<dt>Créditos</dt><dd>" + (x.precio ? m(x.precio) : "Sin costo") + "</dd></dl>" +
                    pasos(x) +
                    (x.motivo && x.estado !== "entregado" ? '<p class="fc-panel__texto">' + esc(x.motivo) + "</p>" : "") +
                    (x.resultado ? '<pre class="fc-panel__texto">' + conLigas(x.resultado) + "</pre>" : "") +
                    (acciones ? '<div class="fc-panel__acciones">' + acciones + "</div>" : "");
                cuerpo.onclick = function (e) {
                    var rv = e.target.closest("[data-revelar]");
                    if (rv) { E.revelados[x.id] = !E.revelados[x.id]; E.panel.repintar(); return; }
                    var b = e.target.closest("button"); if (b) accionBoton(b);
                };
            }
        });
    }

    /* Botones de las filas y del detalle: Ver, Descargar, Copiar, Consultar ahora */
    function accionBoton(b) {
        if (b.dataset.bajar) { bajar(Number(b.dataset.bajar), b); return true; }
        if (b.dataset.ver) { ver(Number(b.dataset.ver), b); return true; }
        if (b.dataset.actualizar) { actualizarUno(Number(b.dataset.actualizar), b); return true; }
        if (b.dataset.copiar) {
            var p = E.datos.pedidos.filter(function (x) { return x.id === Number(b.dataset.copiar); })[0];
            if (p && navigator.clipboard) navigator.clipboard.writeText(p.resultado).then(function () { b.textContent = "Copiado"; });
            return true;
        }
        return false;
    }

    async function actualizarTodo() {
        var b = $("btn-actualizar");
        b.disabled = true; b.textContent = "Actualizando…";
        var curso = E.datos.pedidos.filter(function (p) { return EN_CURSO.indexOf(p.estado) !== -1 && p.estado !== "enviando"; }).slice(0, 10);
        await Promise.all(curso.map(function (p) { return api("/api/documentos/pedidos/" + p.id + "/actualizar", "POST").catch(function () { return null; }); }));
        await refrescar(true);
        if (curso.length) setTimeout(function () { refrescar(true); }, 4000);
        b.disabled = false; b.textContent = "Actualizar";
    }

    /* Mientras haya pedidos en curso, la lista se actualiza sola (solo con la página a la vista). */
    function vigilar() {
        clearInterval(E.reloj);
        var hay = E.datos.pedidos.some(function (p) { return EN_CURSO.indexOf(p.estado) !== -1; });
        if (hay) E.reloj = setInterval(refrescar, 20000);
    }

    async function refrescar(forzar) {
        if (!forzar && document.visibilityState !== "visible") return;
        var antes = {};
        E.datos.pedidos.forEach(function (p) { antes[p.id] = p.estado; });
        try {
            var r = await api("/api/documentos/pedidos");
            E.datos.pedidos = r.pedidos;
            E.datos.saldo = r.saldo;
            E.visto = new Date();
        } catch (e) { if (forzar) aviso(esc(e.message), "error"); return; }
        var llegaron = r.pedidos.filter(function (p) { return p.estado === "entregado" && antes[p.id] && antes[p.id] !== "entregado"; });
        if (llegaron.length) aviso("Llegó: " + llegaron.map(function (p) { return "<b>" + esc(p.servicio) + "</b> (folio " + p.id + ")"; }).join(", ") + "." +
            (E.vista !== "estatus" ? ' <button type="button" class="dc-enlace" data-ir="estatus">Ver estatus</button>' : ""), "ok");
        pintarSaldo();
        pintarPedidos();
        vigilar();
    }

    async function ver(id, boton) {
        var p = E.datos.pedidos.filter(function (x) { return x.id === id; })[0];
        boton.disabled = true;
        try {
            var r = await fetch(API + "/api/documentos/pedidos/" + id + "/archivo", { credentials: "include" });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            var blob = await r.blob();
            var base = (p ? p.servicio : "Documento").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
            if (/pdf/.test(blob.type)) Fiscontable.verPdf(blob, { titulo: (p ? p.servicio + " · " + p.titular : "Documento"), nombre: base + "_" + (p ? p.titular : id) + ".pdf" });
            else window.open(URL.createObjectURL(blob), "_blank");       // imagen: en otra pestaña
        } catch (e) { aviso(esc(e.message || "No se pudo abrir."), "error"); }
        boton.disabled = false;
    }

    async function bajar(id, boton) {
        var p = E.datos.pedidos.filter(function (x) { return x.id === id; })[0];
        boton.disabled = true;
        try {
            var r = await fetch(API + "/api/documentos/pedidos/" + id + "/archivo", { credentials: "include" });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            var blob = await r.blob();
            var ext = /png/.test(blob.type) ? ".png" : /jpe?g/.test(blob.type) ? ".jpg" : ".pdf";
            var base = (p ? p.servicio : "Documento").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
            Fiscontable.guardarArchivo(blob, base + "_" + (p ? p.titular : id) + ext);
        } catch (e) { aviso(esc(e.message || "No se pudo descargar."), "error"); }
        boton.disabled = false;
    }

    async function actualizarUno(id, boton) {
        boton.disabled = true; boton.textContent = "Consultando…";
        try { await api("/api/documentos/pedidos/" + id + "/actualizar", "POST"); } catch (e) { /* la lista lo dirá */ }
        setTimeout(refrescar, 4000);
    }

    document.addEventListener("DOMContentLoaded", function () {
        $("categorias").addEventListener("click", function (e) {
            var b = e.target.closest("[data-categoria]");
            if (!b) return;
            E.categoria = b.dataset.categoria;
            $("categorias").querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-selected", x === b ? "true" : "false"); });
            pintarServicios();
        });
        $("servicios").addEventListener("click", function (e) {
            var b = e.target.closest("[data-servicio]");
            if (b) elegir(Number(b.dataset.servicio));
        });
        $("f-campos").addEventListener("input", function (e) {
            if (e.target.tagName !== "INPUT") return;
            var pos = e.target.selectionStart, v = e.target.value.toUpperCase();
            if (v !== e.target.value) { e.target.value = v; e.target.setSelectionRange(pos, pos); }
            $("f-error").hidden = true;
        });
        $("form").addEventListener("submit", enviar);
        document.querySelectorAll("[data-vista]").forEach(function (b) { b.addEventListener("click", function () { verVista(b.dataset.vista); }); });
        $("aviso").addEventListener("click", function (e) { var b = e.target.closest("[data-ir]"); if (b) verVista(b.dataset.ir); });
        document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && E.reloj) refrescar(); });
        arrancar();
    });
})();
