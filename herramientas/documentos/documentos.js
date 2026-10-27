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
        $("f-enviar").textContent = E.datos.sin_costo ? "Pedir (sin costo para ti)" : "Pedir · " + m(s.precio) + " créditos";
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
                '<button type="button" class="dc-enlace" data-ir="estatus">Estatus de pedidos</button>.', "ok");
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

    function filtroDe(clave) { return FILTROS.filter(function (f) { return f.clave === clave; })[0]; }
    function enFiltro(p, clave) { var f = filtroDe(clave); return !f.estados || f.estados.indexOf(p.estado) !== -1; }

    function filasVisibles() {
        var q = limpio($("buscar").value), qn = $("buscar").value.trim().toLowerCase(), doc = $("f-documento").value;
        return E.datos.pedidos.filter(function (p) {
            if (!enFiltro(p, E.filtro)) return false;
            if (doc && String(p.serviceid) !== doc) return false;
            if (!q) return true;
            var datos = Object.keys(p.datos || {}).map(function (k) { return p.datos[k]; }).join(" ");
            return (p.titular + " " + datos).indexOf(q) !== -1 || (p.nota || "").toLowerCase().indexOf(qn) !== -1 ||
                p.servicio.toLowerCase().indexOf(qn) !== -1 || String(p.id) === q;
        });
    }

    function pintarFiltros() {
        var ped = E.datos.pedidos;
        $("filtros").innerHTML = FILTROS.map(function (f) {
            var n = ped.filter(function (p) { return enFiltro(p, f.clave); }).length;
            if (!n && f.clave !== "todos" && f.clave !== E.filtro) return "";
            return '<button type="button" role="tab" class="dc-filtro dc-filtro--' + f.clave + '" data-filtro="' + f.clave + '" aria-selected="' + (f.clave === E.filtro) + '">' +
                f.nombre + " <b>" + n + "</b></button>";
        }).join("");
        // Documentos que aparecen en los pedidos (para filtrar)
        var sel = $("f-documento"), actual = sel.value, vistos = {};
        ped.forEach(function (p) { vistos[p.serviceid] = p.servicio; });
        sel.innerHTML = '<option value="">Todos los documentos</option>' + Object.keys(vistos).sort(function (a, b) { return vistos[a].localeCompare(vistos[b]); })
            .map(function (k) { return '<option value="' + k + '"' + (k === actual ? " selected" : "") + ">" + esc(vistos[k]) + "</option>"; }).join("");
        var n = ped.filter(function (p) { return EN_CURSO.indexOf(p.estado) !== -1; }).length;
        $("n-en-curso").hidden = !n;
        $("n-en-curso").textContent = n;
        $("actualizado").textContent = (E.visto ? "Actualizado a las " + E.visto.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "") +
            (n ? " · se actualiza sola cada 20 segundos mientras haya pedidos en proceso" : "");
    }

    function pintarPedidos() {
        pintarFiltros();
        var filas = filasVisibles(), hayFiltro = E.filtro !== "todos" || $("f-documento").value || $("buscar").value.trim();
        $("pedidos").innerHTML = filas.length ? filas.map(function (p) {
            var otros = Object.keys(p.datos || {}).filter(function (k) { return p.datos[k] !== p.titular; })
                .map(function (k) { return esc(k) + ": " + esc(p.datos[k]); }).join("<br>");
            var acciones = "";
            if (p.tiene_archivo) acciones += '<button type="button" class="dc-btn dc-btn--si" data-bajar="' + p.id + '">Descargar</button>';
            if (p.resultado) acciones += '<button type="button" class="dc-btn" data-copiar="' + p.id + '">Copiar</button>';
            if (EN_CURSO.indexOf(p.estado) !== -1 && p.estado !== "enviando") acciones += '<button type="button" class="dc-btn" data-actualizar="' + p.id + '">Actualizar</button>';
            return "<tr><td>" + p.id + "<br><small>" + fecha(p.creado_en) + "</small></td>" +
                "<td>" + esc(p.servicio) + (p.nota ? "<br><small>" + esc(p.nota) + "</small>" : "") + "</td>" +
                '<td class="dc-dato">' + esc(p.titular) + (otros ? "<br><small>" + otros + "</small>" : "") + "</td>" +
                '<td class="num">' + (p.precio ? m(p.precio) : "—") + "</td>" +
                "<td>" + estadoHtml(p) + "</td>" +
                '<td><div class="dc-acciones">' + acciones + "</div></td></tr>";
        }).join("") : '<tr><td colspan="6" class="dc-vacio">' + (hayFiltro ? "Nada coincide con el filtro." : "Aún no has pedido documentos.") + "</td></tr>";
    }

    /* Exportar lo que se ve (con los filtros) a CSV que Excel abre directo. */
    function exportar() {
        var filas = filasVisibles();
        var campo = function (v) { v = String(v == null ? "" : v).replace(/\r?\n/g, " "); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
        var lineas = [["Folio", "Fecha", "Documento", "Referencia", "Dato", "Otros datos", "Créditos", "Estado", "Respuesta", "Entregado"].map(campo).join(",")];
        filas.forEach(function (p) {
            var otros = Object.keys(p.datos || {}).filter(function (k) { return p.datos[k] !== p.titular; }).map(function (k) { return k + ": " + p.datos[k]; }).join(" | ");
            lineas.push([p.id, fecha(p.creado_en), p.servicio, p.nota, p.titular, otros, p.precio || 0, p.estado_texto,
                p.estado === "entregado" ? (p.resultado || (p.tiene_archivo ? "PDF descargado" : "")) : p.motivo, fecha(p.entregado_en)].map(campo).join(","));
        });
        var hoy = new Date().toISOString().slice(0, 10);
        Fiscontable.guardarArchivo(new Blob(["\ufeff" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" }), "Pedidos_documentos_" + hoy + ".csv");
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
        $("buscar").addEventListener("input", function () { if (E.datos) pintarPedidos(); });
        $("f-documento").addEventListener("change", function () { if (E.datos) pintarPedidos(); });
        $("filtros").addEventListener("click", function (e) {
            var b = e.target.closest("[data-filtro]");
            if (b) { E.filtro = b.dataset.filtro; pintarPedidos(); }
        });
        document.querySelectorAll("[data-vista]").forEach(function (b) { b.addEventListener("click", function () { verVista(b.dataset.vista); }); });
        $("aviso").addEventListener("click", function (e) { var b = e.target.closest("[data-ir]"); if (b) verVista(b.dataset.ir); });
        $("btn-exportar").addEventListener("click", function () { if (E.datos) exportar(); });
        $("btn-actualizar").addEventListener("click", async function () {
            var b = this;
            b.disabled = true; b.textContent = "Actualizando…";
            var curso = E.datos.pedidos.filter(function (p) { return EN_CURSO.indexOf(p.estado) !== -1 && p.estado !== "enviando"; }).slice(0, 10);
            await Promise.all(curso.map(function (p) { return api("/api/documentos/pedidos/" + p.id + "/actualizar", "POST").catch(function () { return null; }); }));
            await refrescar(true);
            if (curso.length) setTimeout(function () { refrescar(true); }, 4000);
            b.disabled = false; b.textContent = "Actualizar";
        });
        $("pedidos").addEventListener("click", function (e) {
            var b = e.target.closest("button");
            if (!b) return;
            if (b.dataset.bajar) bajar(Number(b.dataset.bajar), b);
            else if (b.dataset.actualizar) actualizarUno(Number(b.dataset.actualizar), b);
            else if (b.dataset.copiar) {
                var p = E.datos.pedidos.filter(function (x) { return x.id === Number(b.dataset.copiar); })[0];
                if (p && navigator.clipboard) navigator.clipboard.writeText(p.resultado).then(function () { b.textContent = "Copiado"; });
            }
        });
        document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && E.reloj) refrescar(); });
        arrancar();
    });
})();
