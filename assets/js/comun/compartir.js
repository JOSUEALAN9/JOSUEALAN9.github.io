/* Compartir documentos en UN enlace (paquete): el cliente abre una página sin cuenta, ve la lista y baja cada PDF o
   XML, o todo en un ZIP. Se usa en Facturar › Emitidas y en Administración de XML.
     Fiscontable.compartir({ rfc, items: [{tipo: "comprobante", id} | {tipo: "xml", rfc, uuid}], titulo, correo, alListo })
     Fiscontable.enlacesCompartidos({ rfc }) */
(function () {
    "use strict";
    var esc = function (t) { return Fiscontable.escapar(t == null ? "" : String(t)); };
    var E = {};
    async function api(ruta, op) {
        var r = await fetch(Fiscontable.API + ruta, Object.assign({ credentials: "include" }, op || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    var enviar = function (ruta, metodo, cuerpo) { return api(ruta, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }); };
    var fecha = function (iso) { return iso ? new Date(iso + (iso.length <= 19 ? "Z" : "")).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "—"; };

    function dialogo() {
        var d = document.getElementById("fc-compartir");
        if (d) return d;
        d = document.createElement("dialog");
        d.id = "fc-compartir"; d.className = "fc-modal";
        d.innerHTML =
            '<div class="fc-modal__cabeza"><div><h2>Compartir por enlace</h2><p data-c="sub"></p></div><button type="button" class="fc-modal__cerrar" data-c="cerrar" aria-label="Cerrar">✕</button></div>' +
            '<div class="fc-modal__cuerpo">' +
            '  <div data-c="crear"><div class="fc-cmp-rejilla">' +
            '    <label class="fc-cmp-campo fc-cmp-campo--ancho"><span>Título (lo ve tu cliente)</span><input data-c="titulo" maxlength="120"></label>' +
            '    <label class="fc-cmp-campo"><span>Disponible</span><select data-c="dias"><option value="7">7 días</option><option value="30" selected>30 días</option><option value="90">90 días</option><option value="365">1 año</option><option value="0">Sin vencimiento</option></select></label>' +
            '    <label class="fc-cmp-campo fc-cmp-campo--todo"><span>Mensaje <i>(opcional)</i></span><textarea data-c="mensaje" rows="3" maxlength="1000" placeholder="Te comparto las facturas del mes…"></textarea></label>' +
            "  </div></div>" +
            '  <div data-c="listo" hidden>' +
            '    <p class="fc-cmp-ok">✓ Enlace listo. Quien lo abra ve los documentos y los baja (cada uno o todos en un ZIP), sin cuenta.</p>' +
            '    <div class="fc-cmp-enlace"><input data-c="url" readonly><button type="button" class="fc-btn fc-btn--principal" data-c="copiar">Copiar</button></div>' +
            '    <div class="fc-cmp-acciones"><a class="fc-btn" data-c="abrir" target="_blank" rel="noopener">Ver la página</a><a class="fc-btn" data-c="wa" target="_blank" rel="noopener">Mandar por WhatsApp</a>' +
            '      <button type="button" class="fc-btn" data-c="ver-correo">Mandar por correo</button></div>' +
            '    <div class="fc-cmp-correo" data-c="correo" hidden><div class="fc-cmp-rejilla">' +
            '      <label class="fc-cmp-campo fc-cmp-campo--ancho"><span>Para <i>(separa con comas)</i></span><input data-c="para"></label>' +
            '      <label class="fc-cmp-campo fc-cmp-campo--ancho"><span>Asunto</span><input data-c="asunto" maxlength="200"></label>' +
            '      <label class="fc-cmp-campo fc-cmp-campo--todo"><span>Mensaje <i>«(enlace)» se cambia por el enlace</i></span><textarea data-c="cuerpo" rows="5"></textarea></label>' +
            '      <label class="fc-cmp-check"><input type="checkbox" data-c="zip"> Adjuntar también el ZIP (PDF y XML), si pesa menos de 15 MB</label>' +
            '    </div><div class="fc-cmp-acciones"><button type="button" class="fc-btn fc-btn--principal" data-c="mandar">Mandar correo</button><span data-c="msj-correo" class="fc-cmp-nota"></span></div></div>' +
            "  </div>" +
            '  <p class="fc-ic-error" data-c="error" hidden></p>' +
            "</div>" +
            '<div class="fc-modal__pie"><button type="button" class="fc-btn" data-c="ver-lista">Enlaces compartidos</button><button type="button" class="fc-btn" data-c="cerrar">Cerrar</button>' +
            '<button type="button" class="fc-btn fc-btn--principal" data-c="crear-btn">Crear enlace</button></div>';
        document.body.appendChild(d);
        var q = function (k) { return d.querySelector('[data-c="' + k + '"]'); };
        E.q = q;
        d.addEventListener("click", function (ev) { if (ev.target.closest('[data-c="cerrar"]')) d.close(); });
        q("crear-btn").addEventListener("click", crear);
        q("copiar").addEventListener("click", function () {
            q("url").select();
            (navigator.clipboard ? navigator.clipboard.writeText(q("url").value) : Promise.reject()).then(function () { q("copiar").textContent = "✓ Copiado"; }, function () { document.execCommand("copy"); q("copiar").textContent = "✓ Copiado"; });
            setTimeout(function () { q("copiar").textContent = "Copiar"; }, 2000);
        });
        q("ver-correo").addEventListener("click", function () { q("correo").hidden = !q("correo").hidden; if (!q("correo").hidden) q("para").focus(); });
        q("mandar").addEventListener("click", mandar);
        q("ver-lista").addEventListener("click", function () { d.close(); Fiscontable.enlacesCompartidos({ rfc: E.op.rfc }); });
        return d;
    }

    async function crear() {
        var b = E.q("crear-btn"); b.disabled = true; b.textContent = "Creando…"; E.q("error").hidden = true;
        try {
            var r = await enviar("/api/paquetes", "POST", { rfc: E.op.rfc, titulo: E.q("titulo").value, mensaje: E.q("mensaje").value, dias: +E.q("dias").value, items: E.op.items });
            mostrarListo(r);
            if (E.op.alListo) E.op.alListo(r);
        } catch (e) { E.q("error").textContent = e.message; E.q("error").hidden = false; }
        b.disabled = false; b.textContent = "Crear enlace";
    }

    function mostrarListo(r) {
        E.paquete = r;
        E.q("crear").hidden = true; E.q("crear-btn").hidden = true; E.q("listo").hidden = false;
        E.q("url").value = r.url;
        E.q("abrir").href = r.url;
        var texto = (r.titulo || "Documentos") + (r.mensaje ? "\n" + r.mensaje : "") + "\n" + r.url;
        E.q("wa").href = "https://wa.me/?text=" + encodeURIComponent(texto);
        E.q("asunto").value = r.titulo || "Documentos";
        E.q("cuerpo").value = (r.mensaje ? r.mensaje + "\n\n" : "Hola, te comparto " + r.documentos + " documento" + (r.documentos === 1 ? "" : "s") + ". Puedes verlos y descargarlos (PDF y XML) aquí:\n\n") + "(enlace)\n\nSaludos.";
        E.q("para").value = E.op.correo || "";
        E.q("sub").textContent = r.documentos + " documento" + (r.documentos === 1 ? "" : "s") + (r.expira_en ? " · disponible hasta el " + fecha(r.expira_en) : " · sin vencimiento");
    }

    async function mandar() {
        var b = E.q("mandar"); b.disabled = true; E.q("msj-correo").textContent = "Mandando…";
        try {
            var r = await enviar("/api/paquetes/" + E.paquete.id + "/correo", "POST", { para: E.q("para").value, asunto: E.q("asunto").value, cuerpo: E.q("cuerpo").value, adjuntar_zip: E.q("zip").checked });
            E.q("msj-correo").textContent = "✓ Enviado a " + r.para.join(", ");
        } catch (e) { E.q("msj-correo").textContent = e.message; }
        b.disabled = false;
    }

    Fiscontable.compartir = function (op) {
        var d = dialogo();
        E.op = op; E.paquete = null;
        E.q("crear").hidden = false; E.q("crear-btn").hidden = false; E.q("listo").hidden = true; E.q("correo").hidden = true; E.q("error").hidden = true;
        E.q("titulo").value = op.titulo || ""; E.q("mensaje").value = ""; E.q("dias").value = "30"; E.q("msj-correo").textContent = ""; E.q("zip").checked = false;
        E.q("sub").textContent = op.items.length + " documento" + (op.items.length === 1 ? "" : "s") + " en un solo enlace";
        if (!d.open) d.showModal();
    };

    /* ---------- administrar los enlaces ya creados ---------- */
    function dialogoLista() {
        var d = document.getElementById("fc-enlaces");
        if (d) return d;
        d = document.createElement("dialog");
        d.id = "fc-enlaces"; d.className = "fc-modal fc-modal--grande";
        d.innerHTML = '<div class="fc-modal__cabeza"><div><h2>Enlaces compartidos</h2><p>Los paquetes que has compartido. Revoca uno para que deje de funcionar al instante.</p></div><button type="button" class="fc-modal__cerrar" data-e="cerrar" aria-label="Cerrar">✕</button></div>' +
            '<div class="fc-modal__cuerpo"><div class="fc-docs-tabla-caja"><table class="fc-docs-tabla"><thead><tr><th>Título</th><th>Docs.</th><th>Creado</th><th>Vence</th><th>Abierto / bajado</th><th>Estado</th><th></th></tr></thead><tbody data-e="filas"></tbody></table></div></div>' +
            '<div class="fc-modal__pie"><button type="button" class="fc-btn" data-e="cerrar">Cerrar</button></div>';
        document.body.appendChild(d);
        d.addEventListener("click", async function (ev) {
            if (ev.target.closest('[data-e="cerrar"]')) { d.close(); return; }
            var b = ev.target.closest("[data-acc]"); if (!b) return;
            var x = E.lista.filter(function (p) { return p.id === b.dataset.id; })[0]; if (!x) return;
            if (b.dataset.acc === "copiar") { try { await navigator.clipboard.writeText(x.url); b.textContent = "✓ Copiado"; } catch (e) { prompt("Copia el enlace:", x.url); } setTimeout(function () { b.textContent = "Copiar"; }, 1800); }
            if (b.dataset.acc === "revocar" && (await Fiscontable.preguntar("¿Revocar «" + x.titulo + "»? El enlace deja de funcionar al instante."))) {
                try { await api("/api/paquetes/" + x.id, { method: "DELETE" }); cargarLista(); } catch (e) { Fiscontable.avisar(e.message); }
            }
        });
        return d;
    }

    async function cargarLista() {
        var tb = document.querySelector('#fc-enlaces [data-e="filas"]');
        tb.innerHTML = '<tr><td colspan="7" class="fc-docs-vacio">Cargando…</td></tr>';
        try { E.lista = await api("/api/paquetes?rfc=" + encodeURIComponent(E.rfcLista || "")); }
        catch (e) { tb.innerHTML = '<tr><td colspan="7" class="fc-docs-vacio">' + esc(e.message) + "</td></tr>"; return; }
        tb.innerHTML = E.lista.length ? E.lista.map(function (x) {
            var chip = { activo: '<span class="fc-cmp-chip fc-cmp-chip--ok">Activo</span>', vencido: '<span class="fc-cmp-chip">Vencido</span>', revocado: '<span class="fc-cmp-chip fc-cmp-chip--mal">Revocado</span>' }[x.estado];
            return "<tr><td class='fc-docs-principal'>" + esc(x.titulo) + "</td><td>" + x.documentos + "</td><td>" + fecha(x.creado_en) + "</td><td>" + (x.expira_en ? fecha(x.expira_en) : "Nunca") + "</td>" +
                "<td>" + x.abierto + " / " + x.descargas + "</td><td>" + chip + '</td><td class="fc-docs-acc">' +
                (x.estado === "activo" ? '<a class="fc-docs-btn" href="' + esc(x.url) + '" target="_blank" rel="noopener">Ver</a><button type="button" class="fc-docs-btn" data-acc="copiar" data-id="' + esc(x.id) + '">Copiar</button>' +
                    '<button type="button" class="fc-docs-btn fc-cmp-rojo" data-acc="revocar" data-id="' + esc(x.id) + '">Revocar</button>' : "") + "</td></tr>";
        }).join("") : '<tr><td colspan="7" class="fc-docs-vacio">Todavía no has compartido paquetes de esta empresa.</td></tr>';
    }

    Fiscontable.enlacesCompartidos = function (op) {
        var d = dialogoLista();
        E.rfcLista = (op && op.rfc) || "";
        if (!d.open) d.showModal();
        cargarLista();
    };
})();
