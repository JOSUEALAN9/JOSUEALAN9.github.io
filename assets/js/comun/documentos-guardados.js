/* Ventana de documentos guardados (común a todos los módulos que guardan documentos): tabla con búsqueda, casillas
   para marcar varios o todos, «Ver» (visor de PDF de Fiscontable) y «Descargar» por documento, y descarga en ZIP
   de los marcados o de todos.
   Uso:
     Fiscontable.documentosGuardados({
       titulo, subtitulo,
       filtro: { etiqueta: "Ejercicio", opciones: [{valor, texto}], valor },        // opcional (un selector arriba)
       cargar: async function (valorFiltro) { return { nota, documentos: [{ id, celdas: [...], nombre, url }] }; },
       columnas: ["Mes", "Documento", …],
       zip: function (ids, valorFiltro) { return "url del ZIP"; }                    // opcional: si no, se arma aquí
     }) */
(function () {
    "use strict";
    var esc = function (t) { return Fiscontable.escapar(t == null ? "" : String(t)); };
    var E = {};

    function dialogo() {
        var d = document.getElementById("fc-docs");
        if (d) return d;
        d = document.createElement("dialog");
        d.id = "fc-docs";
        d.className = "fc-modal fc-modal--grande fc-modal--fija";
        d.innerHTML =
            '<div class="fc-modal__cabeza"><div><h2 data-d="titulo"></h2><p data-d="sub"></p></div><button type="button" class="fc-modal__cerrar" data-d="cerrar" aria-label="Cerrar">✕</button></div>' +
            '<div class="fc-modal__cuerpo">' +
            '  <div class="fc-docs-barra"><label class="fc-docs-filtro" data-d="filtro-caja" hidden><span data-d="filtro-etiqueta"></span><select data-d="filtro"></select></label>' +
            '    <input type="search" data-d="buscar" placeholder="Buscar…"><span class="fc-docs-nota" data-d="nota"></span></div>' +
            '  <div class="fc-docs-tabla-caja"><table class="fc-docs-tabla"><thead data-d="cabeza"></thead><tbody data-d="filas"></tbody></table></div>' +
            '  <p class="fc-ic-error" data-d="error" hidden></p>' +
            "</div>" +
            '<div class="fc-modal__pie"><span class="fc-docs-cuenta" data-d="cuenta"></span>' +
            '  <button type="button" class="fc-btn" data-d="zip-marcados" disabled>Descargar marcados (ZIP)</button>' +
            '  <button type="button" class="fc-btn fc-btn--principal" data-d="zip-todos">Descargar todo (ZIP)</button></div>';
        document.body.appendChild(d);
        var q = function (k) { return d.querySelector('[data-d="' + k + '"]'); };
        E.q = q;
        q("cerrar").addEventListener("click", function () { d.close(); });
        q("buscar").addEventListener("input", pintar);
        q("filtro").addEventListener("change", function () { cargar(this.value); });
        q("filas").addEventListener("change", function (ev) {
            var c = ev.target.closest("[data-sel]"); if (!c) return;
            if (c.checked) E.marcados[c.dataset.sel] = 1; else delete E.marcados[c.dataset.sel];
            contar();
        });
        d.querySelector("thead").addEventListener("change", function (ev) {
            if (!ev.target.matches("[data-todos]")) return;
            var v = ev.target.checked;
            visibles().forEach(function (x) { if (v) E.marcados[x.id] = 1; else delete E.marcados[x.id]; });
            pintar();
        });
        q("filas").addEventListener("click", function (ev) {
            var b = ev.target.closest("[data-accion]"); if (!b) return;
            var x = E.docs.filter(function (y) { return String(y.id) === b.dataset.id; })[0]; if (!x) return;
            if (b.dataset.accion === "ver") Fiscontable.verPdf(x.url, { titulo: x.titulo || x.nombre, nombre: x.nombre });
            else bajarUno(x, b);
        });
        q("zip-marcados").addEventListener("click", function () { zip(Object.keys(E.marcados), this); });
        q("zip-todos").addEventListener("click", function () { zip(E.docs.map(function (x) { return String(x.id); }), this); });
        return d;
    }

    async function cargar(valor) {
        E.filtroValor = valor; E.marcados = {};
        E.q("filas").innerHTML = '<tr><td colspan="99" class="fc-docs-vacio">Cargando…</td></tr>';
        E.q("error").hidden = true;
        try {
            var r = await E.op.cargar(valor);
            E.docs = r.documentos || [];
            E.q("nota").textContent = r.nota || "";
        } catch (e) { E.docs = []; E.q("error").textContent = e.message; E.q("error").hidden = false; }
        pintar();
    }

    function visibles() {
        var b = (E.q("buscar").value || "").trim().toLowerCase();
        return E.docs.filter(function (x) { return !b || x.celdas.join(" ").toLowerCase().indexOf(b) !== -1; });
    }

    function pintar() {
        var filas = visibles(), todos = filas.length && filas.every(function (x) { return E.marcados[x.id]; });
        E.q("cabeza").innerHTML = '<tr><th class="fc-docs-check"><input type="checkbox" data-todos title="Marcar todos"' + (todos ? " checked" : "") + "></th>" +
            E.op.columnas.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + '<th class="fc-docs-acc"></th></tr>';
        E.q("filas").innerHTML = filas.length ? filas.map(function (x) {
            return '<tr><td class="fc-docs-check"><input type="checkbox" data-sel="' + esc(x.id) + '"' + (E.marcados[x.id] ? " checked" : "") + "></td>" +
                x.celdas.map(function (c, i) { return "<td" + (i === 0 ? ' class="fc-docs-principal"' : "") + ">" + esc(c) + "</td>"; }).join("") +
                '<td class="fc-docs-acc"><button type="button" class="fc-docs-btn" data-accion="ver" data-id="' + esc(x.id) + '">' +
                '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2.5 12C4 7.5 7.7 5 12 5s8 2.5 9.5 7c-1.5 4.5-5.2 7-9.5 7s-8-2.5-9.5-7z"/><circle cx="12" cy="12" r="3"/></svg>Ver</button>' +
                '<button type="button" class="fc-docs-btn fc-docs-btn--icono" data-accion="bajar" data-id="' + esc(x.id) + '" title="Descargar" aria-label="Descargar">' +
                '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></button></td></tr>';
        }).join("") : '<tr><td colspan="99" class="fc-docs-vacio">' + (E.docs.length ? "Nada coincide con la búsqueda." : "Todavía no hay documentos guardados aquí.") + "</td></tr>";
        contar();
    }

    function contar() {
        var n = Object.keys(E.marcados).length;
        E.q("cuenta").textContent = E.docs.length ? (n ? n + " marcado" + (n === 1 ? "" : "s") + " de " : "") + E.docs.length + " documento" + (E.docs.length === 1 ? "" : "s") : "";
        E.q("zip-marcados").disabled = !n;
        E.q("zip-marcados").textContent = n ? "Descargar " + n + " marcado" + (n === 1 ? "" : "s") + " (ZIP)" : "Descargar marcados (ZIP)";
        E.q("zip-todos").disabled = !E.docs.length;
    }

    async function bajarUno(x, b) {
        b.disabled = true;
        try {
            var r = await fetch(x.url, { credentials: "include" });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            Fiscontable.guardarArchivo(await r.blob(), x.nombre);
        } catch (e) { E.q("error").textContent = e.message; E.q("error").hidden = false; }
        b.disabled = false;
    }

    function cargarJszip() {
        if (window.JSZip) return Promise.resolve(window.JSZip);
        return new Promise(function (ok, mal) {
            var s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
            s.onload = function () { ok(window.JSZip); }; s.onerror = function () { mal(new Error("No se pudo preparar el ZIP.")); };
            document.head.appendChild(s);
        });
    }

    async function zip(ids, b) {
        if (!ids.length) return;
        var texto = b.textContent; b.disabled = true; b.textContent = "Preparando ZIP…";
        try {
            var blob, nombre = (E.op.nombreZip || "Documentos") + ".zip";
            if (E.op.zip) {
                var r = await fetch(E.op.zip(ids, E.filtroValor), { credentials: "include" });
                if (!r.ok) throw new Error(await Fiscontable.leerError(r));
                var m = /filename="?([^";]+)"?/i.exec(r.headers.get("Content-Disposition") || "");
                if (m) nombre = m[1];
                blob = await r.blob();
            } else {
                var JSZip = await cargarJszip(), z = new JSZip(), usados = {};
                for (var i = 0; i < ids.length; i++) {
                    var x = E.docs.filter(function (y) { return String(y.id) === ids[i]; })[0]; if (!x) continue;
                    b.textContent = "Preparando ZIP… " + (i + 1) + "/" + ids.length;
                    var rr = await fetch(x.url, { credentials: "include" });
                    if (!rr.ok) continue;
                    var n = x.nombre; if (usados[n]) n = n.replace(/(\.[a-z0-9]+)?$/i, "_" + (++usados[n]) + "$1"); else usados[n] = 1;
                    z.file(n, await rr.blob());
                }
                blob = await z.generateAsync({ type: "blob" });
            }
            Fiscontable.guardarArchivo(blob, nombre);
        } catch (e) { E.q("error").textContent = e.message; E.q("error").hidden = false; }
        b.textContent = texto; contar();
    }

    Fiscontable.documentosGuardados = function (op) {
        var d = dialogo();
        E.op = op; E.docs = []; E.marcados = {};
        E.q("titulo").textContent = op.titulo || "Documentos guardados";
        E.q("sub").textContent = op.subtitulo || "";
        E.q("buscar").value = "";
        var f = op.filtro;
        E.q("filtro-caja").hidden = !f;
        if (f) {
            E.q("filtro-etiqueta").textContent = f.etiqueta;
            E.q("filtro").innerHTML = f.opciones.map(function (o) { return '<option value="' + esc(o.valor) + '"' + (String(o.valor) === String(f.valor) ? " selected" : "") + ">" + esc(o.texto) + "</option>"; }).join("");
        }
        d.showModal();
        cargar(f ? f.valor : null);
    };
})();
