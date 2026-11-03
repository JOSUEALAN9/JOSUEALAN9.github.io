/* Importar clientes desde XML (Facturar y Mis clientes): lee los receptores de las facturas que EMITIÓ la empresa
   (XML subidos o de Administración de XML), los junta por RFC y deja revisarlos antes de guardarlos en «sus clientes».
   Uso: Fiscontable.importarClientes({ rfc, nombre, alTerminar: function (guardados) {} }) */
(function () {
    "use strict";
    var esc = function (t) { return Fiscontable.escapar(t == null ? "" : String(t)); };
    var cat = null, E = {};

    async function api(ruta, op) {
        var r = await fetch(Fiscontable.API + ruta, Object.assign({ credentials: "include" }, op || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function opciones(mapa, actual, vacio) {
        return (vacio ? '<option value="">' + esc(vacio) + "</option>" : "") +
            Object.keys(mapa).map(function (k) { return '<option value="' + esc(k) + '"' + (k === actual ? " selected" : "") + ">" + esc(k + " · " + mapa[k]) + "</option>"; }).join("");
    }

    function dialogo() {
        var d = document.getElementById("fc-importar-clientes");
        if (d) return d;
        d = document.createElement("dialog");
        d.id = "fc-importar-clientes";
        d.className = "fc-modal fc-modal--grande fc-modal--fija";
        d.innerHTML =
            '<div class="fc-modal__cabeza"><div><h2>Importar clientes de XML</h2><p data-ic="sub"></p></div><button type="button" class="fc-modal__cerrar" data-ic="cerrar" aria-label="Cerrar">✕</button></div>' +
            '<div class="fc-modal__cuerpo">' +
            '  <div class="fc-ic-fuentes" data-ic="fuentes">' +
            '    <label class="fc-ic-fuente"><span>⤒</span><span><b>Subir XML o ZIP</b><small>Facturas que emitió esta empresa, aunque no se hayan timbrado aquí.</small></span><input type="file" data-ic="archivos" accept=".xml,.zip,application/xml,text/xml,application/zip" multiple hidden></label>' +
            '    <button type="button" class="fc-ic-fuente" data-ic="biblioteca"><span>🗂</span><span><b>De Administración de XML</b><small>Todas las facturas emitidas de esta empresa que ya están guardadas.</small></span></button>' +
            "  </div>" +
            '  <p class="fc-ic-resumen" data-ic="resumen" hidden></p>' +
            '  <div class="fc-ic-barra" data-ic="barra" hidden><input type="search" data-ic="buscar" placeholder="Buscar por nombre o RFC…">' +
            '    <button type="button" class="fc-ic-filtro" data-filtro="todos" aria-pressed="true">Todos</button><button type="button" class="fc-ic-filtro" data-filtro="nuevo" aria-pressed="false">Nuevos</button>' +
            '    <button type="button" class="fc-ic-filtro" data-filtro="distinto" aria-pressed="false">Con cambios</button><button type="button" class="fc-ic-filtro" data-filtro="igual" aria-pressed="false">Ya guardados</button></div>' +
            '  <div class="fc-ic-tabla-caja" data-ic="tabla" hidden><table class="fc-ic-tabla"><thead><tr><th><input type="checkbox" data-ic="todos" title="Marcar todos los que se ven"></th><th>Cliente</th><th>C.P.</th><th>Régimen</th><th>Uso del CFDI</th><th>Estado</th><th>Facturas</th></tr></thead><tbody data-ic="filas"></tbody></table></div>' +
            '  <p class="fc-ic-error" data-ic="error" hidden></p>' +
            "</div>" +
            '<div class="fc-modal__pie"><span class="fc-ic-cuenta" data-ic="cuenta"></span><button type="button" class="fc-btn" data-ic="cerrar">Cancelar</button><button type="button" class="fc-btn fc-btn--principal" data-ic="guardar" disabled>Guardar</button></div>';
        document.body.appendChild(d);
        var q = function (k) { return d.querySelector('[data-ic="' + k + '"]'); };
        d.addEventListener("click", function (ev) {
            if (ev.target.closest('[data-ic="cerrar"]')) d.close();
            var f = ev.target.closest("[data-filtro]");
            if (f) { E.filtro = f.dataset.filtro; d.querySelectorAll("[data-filtro]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === f)); }); pintar(); }
        });
        q("archivos").addEventListener("change", function () {
            var cuerpo = new FormData(); cuerpo.append("rfc", E.rfc);
            Array.prototype.forEach.call(this.files, function (a) { cuerpo.append("archivos", a); });
            this.value = "";
            leer(api("/api/facturacion/receptores/leer-xml", { method: "POST", body: cuerpo }));
        });
        q("biblioteca").addEventListener("click", function () {
            leer(api("/api/facturacion/receptores/desde-biblioteca", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rfc: E.rfc }) }));
        });
        q("buscar").addEventListener("input", pintar);
        q("todos").addEventListener("change", function () { var v = this.checked; visibles().forEach(function (x) { x.sel = v; }); pintar(); });
        q("filas").addEventListener("input", function (ev) {
            var tr = ev.target.closest("[data-i]"); if (!tr) return;
            var x = E.lista[+tr.dataset.i], k = ev.target.dataset.c;
            if (k === "sel") x.sel = ev.target.checked; else x[k] = ev.target.value;
            if (k === "sel") contar();
        });
        q("filas").addEventListener("change", function (ev) { if (ev.target.matches("select")) ev.target.dispatchEvent(new Event("input", { bubbles: true })); });
        q("guardar").addEventListener("click", guardar);
        E.q = q;
        return d;
    }

    async function leer(promesa) {
        var q = E.q;
        q("error").hidden = true;
        q("resumen").hidden = false; q("resumen").textContent = "Leyendo los XML…";
        try {
            var r = await promesa;
            E.lista = r.clientes.map(function (x) { return Object.assign({ sel: x.estado !== "igual" }, x); });
            var n = function (k) { return E.lista.filter(function (x) { return x.estado === k; }).length; };
            var notas = [];
            if (r.recibidas) notas.push(r.recibidas + " eran facturas recibidas (de proveedores)");
            if (r.otras) notas.push(r.otras + " son de otra empresa");
            if (r.publico) notas.push(r.publico + " a público en general");
            if (r.rechazados) notas.push(r.rechazados + " archivo(s) no eran CFDI");
            q("resumen").innerHTML = "<b>" + r.leidos + " XML leídos · " + E.lista.length + " clientes:</b> " + n("nuevo") + " nuevos, " + n("distinto") + " con datos distintos a los guardados y " + n("igual") + " ya guardados igual." +
                (notas.length ? "<br>No se importaron: " + esc(notas.join(" · ")) + "." : "") +
                (E.lista.some(function (x) { return x.faltan.length; }) ? "<br>Los XML viejos (CFDI 3.3) no traen C.P. ni régimen del cliente: complétalos aquí o después con su constancia." : "");
            ["barra", "tabla"].forEach(function (k) { q(k).hidden = !E.lista.length; });
            pintar();
        } catch (e) { q("resumen").hidden = true; q("error").textContent = e.message; q("error").hidden = false; }
    }

    function visibles() {
        var b = (E.q("buscar").value || "").trim().toLowerCase();
        return (E.lista || []).filter(function (x) {
            return (E.filtro === "todos" || x.estado === E.filtro) && (!b || (x.nombre + " " + x.rfc + " " + (x.num_reg_id || "")).toLowerCase().indexOf(b) !== -1);
        });
    }

    function pintar() {
        var filas = visibles();
        E.q("filas").innerHTML = filas.length ? filas.map(function (x) {
            var i = E.lista.indexOf(x), dist = (x.distintos || []).map(function (c) { return { nombre: "nombre", cp: "C.P.", regimen: "régimen" }[c]; });
            var chip = x.estado === "nuevo" ? '<span class="fc-ic-chip fc-ic-chip--nuevo">Nuevo</span>'
                : x.estado === "distinto" ? '<span class="fc-ic-chip fc-ic-chip--distinto" title="Guardado: ' + esc([x.guardado.nombre, x.guardado.cp, x.guardado.regimen].filter(Boolean).join(" · ")) + '">Cambió ' + esc(dist.join(", ")) + "</span>"
                : '<span class="fc-ic-chip fc-ic-chip--igual">Ya está</span>';
            if (x.faltan.length) chip += '<span class="fc-ic-chip fc-ic-chip--falta">Falta ' + esc(x.faltan.join(" y ")) + "</span>";
            return '<tr data-i="' + i + '" class="fc-ic--' + x.estado + '"><td><input type="checkbox" data-c="sel"' + (x.sel ? " checked" : "") + "></td>" +
                '<td><input data-c="nombre" value="' + esc(x.nombre) + '"><small>' + esc(x.rfc + (x.residencia ? " · " + x.residencia + " " + (x.num_reg_id || "") : "")) + "</small></td>" +
                '<td><input data-c="cp" class="fc-ic-cp" inputmode="numeric" maxlength="5" value="' + esc(x.cp) + '"></td>' +
                '<td><select data-c="regimen">' + opciones(cat.regimenes, x.regimen, "Elige…") + "</select></td>" +
                '<td><select data-c="uso">' + opciones(cat.usos, x.uso) + "</select></td><td>" + chip + '</td><td style="text-align:right">' + x.veces + "</td></tr>";
        }).join("") : '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px">Nada coincide.</td></tr>';
        contar();
    }

    function contar() {
        var n = (E.lista || []).filter(function (x) { return x.sel; }).length;
        E.q("cuenta").textContent = E.lista && E.lista.length ? n + " de " + E.lista.length + " marcados" : "";
        E.q("guardar").disabled = !n;
        E.q("guardar").textContent = n ? "Guardar " + n + " cliente" + (n === 1 ? "" : "s") : "Guardar";
    }

    async function guardar() {
        var b = E.q("guardar"), elegidos = E.lista.filter(function (x) { return x.sel; });
        b.disabled = true; E.q("error").hidden = true;
        try {
            var r = await api("/api/facturacion/receptores/lote", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rfc: E.rfc, clientes: elegidos.map(function (x) { return { rfc: x.rfc, nombre: x.nombre, cp: x.cp, regimen: x.regimen, uso: x.uso, residencia: x.residencia, num_reg_id: x.num_reg_id }; }) }) });
            if (r.errores.length) {
                E.q("error").textContent = r.guardados + " guardados. Falta corregir " + r.errores.length + ": " + r.errores.slice(0, 3).join(" · ") + (r.errores.length > 3 ? "…" : "");
                E.q("error").hidden = false;
            } else document.getElementById("fc-importar-clientes").close();
            if (E.alTerminar) E.alTerminar(r.guardados);
        } catch (e) { E.q("error").textContent = e.message; E.q("error").hidden = false; }
        b.disabled = false; contar();
    }

    Fiscontable.importarClientes = async function (op) {
        var d = dialogo();
        E.rfc = op.rfc; E.alTerminar = op.alTerminar; E.lista = []; E.filtro = "todos";
        if (!cat) {
            try { cat = (await api("/api/facturacion/config")).catalogos; } catch (e) { cat = { regimenes: {}, usos: {} }; }
        }
        E.q("sub").textContent = "Los clientes de las facturas que emitió " + (op.nombre || op.rfc) + ". Revisa sus datos antes de guardarlos; los que ya tienes se actualizan sin perder su correo ni su WhatsApp.";
        ["resumen", "barra", "tabla", "error"].forEach(function (k) { E.q(k).hidden = true; });
        E.q("buscar").value = "";
        d.querySelectorAll("[data-filtro]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.filtro === "todos")); });
        contar();
        d.showModal();
    };
})();
