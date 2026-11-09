/*
 * herramientas/facturar/facturar.js — Facturar (CFDI 4.0, timbrado con MultiFacturas).
 *
 * La empresa que factura es la del selector de arriba. Tres vistas:
 *   Nueva factura  cliente, pago, conceptos y totales en vivo; antes de timbrar el servidor lo revisa
 *                  (sin gastar timbre) y se confirma con el resumen.
 *   Emitidas       sus facturas y notas de crédito: XML, PDF (representación impresa) y cancelar.
 *   Configuración  régimen, C.P., series y folios, logo, el CSD (sello digital) y sus timbres.
 * Además: sus clientes guardados (y leer su constancia), prefacturas, copiar otra factura (emitida aquí, de
 * Administración de XML o subiendo el XML), fecha de emisión, dólares con su tipo de cambio y la vista previa en PDF.
 * El PDF lo arma el servidor (el mismo formato que Administración de XML).
 * Los totales se calculan igual que en el servidor (cada importe redondeado a centavos).
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };

    var F = { empresa: null, cfg: null, emisor: null, tipo: "I", conceptos: [], emitidas: [], detalles: {}, cancelando: null, ultimo: null,
              receptores: [], borradores: [], borradorId: null, tcManual: false, origen: "emitidas", vistaUrl: null, vistaNombre: "",
              relaciones: [], claveEnvio: null, sustituye: null, pendientes: [], pgSel: {}, pgClave: null, correo: null, waId: null, coId: null };
    function nuevaClave() {
        return window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    }
    function fechaLocal(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }

    async function api(ruta, opciones) {
        var resp = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!resp.ok) { var err = new Error(await Fiscontable.leerError(resp)); err.status = resp.status; throw err; }
        return resp;
    }
    async function json(ruta, opciones) { return (await api(ruta, opciones)).json(); }
    function enviar(ruta, metodo, cuerpo) {
        return json(ruta, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    }

    function aviso(texto, tipo) {
        var a = $("aviso");
        a.textContent = texto || "";
        a.className = "fa-aviso" + (tipo ? " fa-aviso--" + tipo : "");
        a.hidden = !texto;
    }
    var r2 = function (v) { return Math.round((Number(v) + Number.EPSILON) * 100) / 100; };
    var dinero = function (v) { v = Number(v || 0); return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var num = function (v) { var n = parseFloat(String(v == null ? "" : v).replace(/,/g, "")); return isNaN(n) ? 0 : n; };
    function opciones(mapa, actual, conClave, vacio) {
        return (vacio ? '<option value="">' + esc(vacio) + "</option>" : "") + Object.keys(mapa).map(function (k) {
            return '<option value="' + esc(k) + '"' + (k === actual ? " selected" : "") + ">" + esc(conClave === false ? mapa[k] : k + " · " + mapa[k]) + "</option>";
        }).join("");
    }
    function bajarRespuesta(resp, nombre) {
        var m = /filename="?([^";]+)"?/i.exec(resp.headers.get("Content-Disposition") || "");
        return resp.blob().then(function (b) { Fiscontable.guardarArchivo(b, m ? m[1] : nombre); });
    }
    function hoyLocal() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
    function fechaCorta(iso) {
        if (!iso) return "";
        var d = new Date(iso.length <= 19 ? iso : iso);
        return isNaN(d) ? iso : d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
    }

    /* ---------------------------------------------------- importe con letra */
    var UNI = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE", "DIEZ", "ONCE", "DOCE", "TRECE",
        "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE", "VEINTIUN", "VEINTIDOS", "VEINTITRES",
        "VEINTICUATRO", "VEINTICINCO", "VEINTISEIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"];
    var DEC = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
    var CEN = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];
    function cientos(n) {
        if (n === 100) return "CIEN";
        var c = Math.floor(n / 100), r = n % 100, t = CEN[c];
        if (r) t += (t ? " " : "") + (r < 30 ? UNI[r] : DEC[Math.floor(r / 10)] + (r % 10 ? " Y " + UNI[r % 10] : ""));
        return t;
    }
    function enLetra(total, moneda) {
        var entero = Math.floor(total + 1e-9), cent = Math.round((total - entero) * 100);
        if (cent === 100) { entero += 1; cent = 0; }
        var partes = [], mill = Math.floor(entero / 1e6), miles = Math.floor((entero % 1e6) / 1000), resto = entero % 1000;
        if (mill) partes.push(mill === 1 ? "UN MILLON" : cientos(mill) + " MILLONES");
        if (miles) partes.push(miles === 1 ? "MIL" : cientos(miles) + " MIL");
        if (resto) partes.push(cientos(resto));
        var texto = partes.join(" ") || "CERO";
        var nombre = moneda === "USD" ? " DOLARES " : " PESOS ", suf = moneda === "USD" ? "/100 USD" : "/100 M.N.";
        return texto + (mill && !miles && !resto ? " DE" : "") + nombre + String(cent).padStart(2, "0") + suf;
    }

    /* ---------------------------------------------------- arranque */
    async function iniciar() {
        F.incrustado = Fiscontable.url("incrustado") === "1";      // abierta dentro de Configuración (ventana sobre otro módulo)
        if (F.incrustado) document.body.classList.add("fa-incrustado");
        if (!(await Fiscontable.exigirModulo("facturacion"))) return;
        try { F.cfg = await json("/api/facturacion/config"); }
        catch (e) { aviso(e.message, "error"); return; }
        var c = F.cfg.catalogos;
        $("r-regimen").innerHTML = opciones(c.regimenes, "", true, "Elige…");
        $("r-uso").innerHTML = opciones(c.usos, "G03", true);
        $("p-metodo").innerHTML = opciones(c.metodos_pago, "PUE", true);
        $("p-forma").innerHTML = opciones(c.formas_pago, "03", true);
        $("rel-tipo").innerHTML = opciones(c.tipos_relacion, "01", true);
        $("c-regimen").innerHTML = opciones(c.regimenes, "", true, "Elige…");
        $("can-motivo").innerHTML = opciones(c.motivos_cancelacion, "02", true);
        $("p-moneda").innerHTML = opciones(c.monedas || { MXN: "Peso mexicano" }, "MXN", true);
        $("pg-moneda").innerHTML = opciones(c.monedas || { MXN: "Peso mexicano" }, "MXN", true);
        $("pg-forma").innerHTML = opciones(Object.keys(c.formas_pago).filter(function (k) { return k !== "99"; })
            .reduce(function (o, k) { o[k] = c.formas_pago[k]; return o; }, {}), "03", true);
        $("r-pais").innerHTML = opciones(c.paises || {}, "USA", true, "Elige el país…");
        var hoy = new Date();
        $("g-periodicidad").innerHTML = opciones(c.periodicidades, "04", true);
        $("g-meses").innerHTML = opciones(c.meses_global, String(hoy.getMonth() + 1).padStart(2, "0"), true);
        $("g-anio").value = hoy.getFullYear();
        $("chip-modo").hidden = F.cfg.produccion;
        eventos();
        F.empresa = await Fiscontable.empresaActiva();
        window.addEventListener("fiscontable:empresa", function (ev) { F.empresa = ev.detail; elegirEmpresa(); });
        F.vista = F.incrustado ? "config" : (Fiscontable.url("vista") || "nueva");     // con F5 se queda en la misma vista
        window.addEventListener("fiscontable:config", recargarConfig);
        nuevaFactura();
        irPaso(1);
        elegirEmpresa();
        vista(F.vista);
    }

    function elegirEmpresa() {
        var hay = !!F.empresa;
        $("sin-empresa").hidden = hay;
        document.querySelectorAll("[data-panel]").forEach(function (p) { if (!hay) p.hidden = true; });
        if (!hay) { $("chip-timbres").hidden = true; return; }
        F.emisor = F.cfg.empresas.filter(function (e) { return e.rfc === F.empresa.rfc; })[0] || null;
        if (!F.emisor) { aviso("Esa empresa no está en tu directorio.", "error"); return; }
        aviso("");
        pintarEmisor();
        vista(F.vista || "nueva");
        cargarEmitidas();
        cargarReceptores();
        cargarBorradores();
        cargarPendientes();
        cargarProductos();
        cargarRecurrentes();
    }

    async function cargarRecurrentes() {
        var caja = $("recurrentes-hoy");
        try { F.recurrentes = await json("/api/facturacion/recurrentes?rfc=" + encodeURIComponent(F.empresa.rfc)); } catch (e) { F.recurrentes = []; }
        caja.hidden = !F.recurrentes.length;
        caja.innerHTML = F.recurrentes.length ? "<b>Hoy toca facturar:</b> " + F.recurrentes.map(function (x) {
            return '<button type="button" class="fa-link" data-recurrente="' + esc(x.id) + '">' + esc(x.nombre) + (x.total != null ? " (" + dinero(x.total) + ")" : "") + "</button>" +
                (x.recurrente.error ? ' <small class="fa-mal">no se pudo timbrar sola: ' + esc(x.recurrente.error) + "</small>" : "");
        }).join(" · ") : "";
    }

    function vista(nombre) {
        F.vista = nombre;
        document.querySelectorAll("[data-vista]").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.vista === nombre)); });
        if (!F.empresa) return;
        document.querySelectorAll("[data-panel]").forEach(function (p) { p.hidden = p.dataset.panel !== nombre; });
        Fiscontable.url({ vista: nombre === "nueva" ? null : nombre });
        if (nombre === "config") ponerSub(Fiscontable.url("sub") || F.sub || "emisor");
        if (nombre === "pagos") cargarPendientes();
    }

    /* ---------------------------------------------------- emisor (encabezado, avisos y configuración) */
    function pintarEmisor() {
        var e = F.emisor, prod = F.cfg.produccion;
        var chip = $("chip-timbres");
        chip.hidden = false;
        chip.textContent = prod ? "Timbres: " + (e.timbres || 0) : "Mis timbres";
        chip.className = "fa-chip fa-chip--boton" + (prod && (e.timbres || 0) < 1 ? " fa-chip--mal" : "");
        $("punto-config").hidden = e.listo;
        var falta = $("falta-config");
        if (!prod) {
            falta.innerHTML = "<b>Modo de pruebas:</b> se timbra con el RFC de prueba del SAT (" + esc(F.cfg.prueba.rfc) +
                "). No gasta timbres ni tiene validez fiscal; sirve para conocer el módulo. Tus series y folios sí avanzan.";
            falta.className = "fa-aviso";
            falta.hidden = false;
        } else {
            falta.hidden = true;
        }
        pintarActivar();
        $("punto-manifiesto").hidden = !!e.manifiesto || !prod;
        if (F.man && F.man.rfc !== e.rfc) F.man = null;
        if (F.sub === "manifiesto") cargarManifiesto();
        $("cinta-nombre").textContent = e.razon_social || e.alias;
        $("cinta-datos").textContent = [e.rfc, e.regimen ? "Régimen " + e.regimen : "", e.cp ? "C.P. " + e.cp : ""].filter(Boolean).join(" · ");
        $("c-emisor").textContent = (e.razon_social || e.alias) + " · " + e.rfc;
        $("c-emisor-cab").textContent = (e.razon_social || e.alias) + " · " + e.rfc;
        $("punto-sello").hidden = !!e.csd;
        $("c-regimen").value = e.regimen || "";
        $("c-cp").value = e.cp || "";
        $("c-serie-i").value = e.serie_i;
        $("c-folio-i").value = e.folio_i;
        $("c-serie-e").value = e.serie_e;
        $("c-folio-e").value = e.folio_e;
        $("c-serie-p").value = e.serie_p || "P";
        $("c-folio-p").value = e.folio_p || 1;
        $("c-pref-dias").value = String(F.cfg.prefacturas_dias == null ? 3 : F.cfg.prefacturas_dias);
        var csd = $("c-csd-estado");
        if (e.csd) {
            var vencido = e.csd.vence && e.csd.vence < new Date().toISOString().slice(0, 10);
            csd.textContent = vencido ? "Vencido" : "Guardado";
            csd.className = "fa-chip " + (vencido ? "fa-chip--mal" : "fa-chip--ok");
            $("c-csd-guardado").textContent = "✓ Certificado " + (e.csd.no || "") + (e.csd.vence ? " · vence el " + fechaCorta(e.csd.vence + "T12:00:00") : "");
        } else {
            csd.textContent = "Falta";
            csd.className = "fa-chip fa-chip--gris";
        }
        $("c-csd-guardado").hidden = !e.csd;
        $("c-csd-form").hidden = !!e.csd;
        $("btn-reemplazar-csd").hidden = !e.csd;
        $("btn-quitar-csd").hidden = !e.csd;
        pintarLogo();
        $("c-timbres-empresa").textContent = e.timbres || 0;
        $("c-timbres-cuenta").textContent = F.cfg.timbres_cuenta === null ? "Sin tope" : (F.cfg.timbres_cuenta || 0);
        $("c-timbres-pac").textContent = !prod ? "En modo de pruebas no se gastan timbres; lo que repartas aquí se usará cuando se active producción."
            : !F.cfg.panel ? "Falta configurar en el servidor el acceso al panel de MultiFacturas: avísale al administrador."
            : e.alta_pac ? "✓ Dada de alta en MultiFacturas. Lo que le pases aquí se le pasa también allá."
            : "La primera vez que le pases timbres se da de alta sola en MultiFacturas.";
        pintarFolio();
    }

    /* ---------------------------------------------------- manifiesto del PAC (uno por empresa y PAC) */
    async function cargarManifiesto() {
        if (!F.emisor) return;
        if (F.man && F.man.rfc === F.emisor.rfc) { pintarManifiesto(); return; }
        $("c-man-pacs").innerHTML = '<p class="fa-nota">Cargando…</p>';
        try { F.man = await json("/api/facturacion/manifiesto/" + encodeURIComponent(F.emisor.rfc)); }
        catch (e) { $("c-man-pacs").innerHTML = '<p class="fa-nota">' + esc(e.message) + "</p>"; return; }
        pintarManifiesto();
    }

    function pintarManifiesto() {
        var m = F.man;
        $("c-man-estado").textContent = m.firmado ? "Guardado" : "Falta";
        $("c-man-estado").className = "fa-chip " + (m.firmado ? "fa-chip--ok" : "fa-chip--gris");
        $("c-man-pacs").innerHTML = m.pacs.map(function (p) {
            var g = p.guardado, rv = (g && g.revision) || {};
            var abrir = '<a class="fa-btn ' + (g ? "fa-btn--suave" : "fa-btn--principal") + '" href="' + esc(p.url) + '" target="_blank" rel="noopener">Abrir página de ' + esc(p.nombre) + " para firmar ↗</a>";
            var datos = g ? [
                g.folio ? "Folio <b>" + esc(g.folio) + "</b>" : "",
                rv.nombre ? "Firmó <b>" + esc(rv.nombre) + "</b>" : "",
                rv.serie ? "e.firma núm. " + esc(rv.serie) : "",
                rv.sello_verificado ? "✓ Sello comprobado con la e.firma guardada" : ""
            ].filter(Boolean).join(" · ") : "";
            return '<div class="fa-man-pac' + (g ? " fa-man-pac--ok" : "") + '" data-pac="' + p.id + '">' +
                '<div class="fa-man-pac__cabeza"><div><small>' + esc(p.etiqueta) + "</small><b>" + esc(p.nombre) + "</b></div>" +
                '<span class="fa-chip ' + (g ? "fa-chip--ok" : "fa-chip--gris") + '">' + (g ? "✓ Firmado" + (g.firmado_en ? " el " + fechaCorta(g.firmado_en + "T12:00:00") : "") : "Sin manifiesto") + "</span></div>" +
                (g ? '<p class="fa-nota">' + datos + (g.hay_pdf ? ' · <button type="button" class="fa-link" data-man-bajar="pdf">Ver PDF</button>' : "") + "</p>" : "") +
                '<div class="fa-man-acciones">' + abrir +
                (g ? '<button type="button" class="fa-link" data-man-reemplazar>Reemplazar PDF</button><button type="button" class="fa-link fa-link--rojo" data-man-quitar>Quitar</button>' : "") + "</div>" +
                '<div class="fa-rejilla fa-man-subir"' + (g ? " hidden" : "") + ">" +
                '<label class="fa-campo fa-c4"><span>Manifiesto en PDF (el que descargaste al firmar)</span><input type="file" accept=".pdf,application/pdf" class="fa-archivo" data-man-pdf></label>' +
                '<div class="fa-campo fa-c2 fa-al-fondo"><button type="button" class="fa-btn fa-btn--principal fa-ancho" data-man-guardar>Subir y revisar</button></div></div></div>';
        }).join("");
    }

    async function manifiestoClic(ev) {
        var caja = ev.target.closest("[data-pac]"); if (!caja || !F.emisor) return;
        var pac = caja.dataset.pac, base = "/api/facturacion/manifiesto/" + encodeURIComponent(F.emisor.rfc);
        if (ev.target.closest("[data-man-reemplazar]")) { caja.querySelector(".fa-man-subir").hidden = false; return; }
        var b = ev.target.closest("[data-man-bajar]");
        if (b) {
            try {
                var r = await api(base + "/" + pac + "/" + b.dataset.manBajar);
                var url = URL.createObjectURL(await r.blob()), a = document.createElement("a");
                a.href = url; a.download = "Manifiesto_" + pac + "_" + F.emisor.rfc + "." + b.dataset.manBajar;
                document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
            } catch (e) { $("msj-man").textContent = e.message; }
            return;
        }
        if (ev.target.closest("[data-man-quitar]")) {
            if (!confirm("¿Quitar el acuse guardado de este PAC? (no cambia nada en el PAC ni en el SAT)")) return;
            try { F.man = await json(base + "/" + pac, { method: "DELETE" }); despuesManifiesto("Acuse quitado."); }
            catch (e) { $("msj-man").textContent = e.message; }
            return;
        }
        var g = ev.target.closest("[data-man-guardar]");
        if (g) {
            var pdf = caja.querySelector("[data-man-pdf]").files[0];
            if (!pdf) { $("msj-man").textContent = "Elige el PDF del manifiesto que descargaste de Luna Soft."; return; }
            var cuerpo = new FormData();
            cuerpo.append("pac", pac);
            cuerpo.append("pdf", pdf);
            g.disabled = true; g.textContent = "Revisando…"; $("msj-man").textContent = "";
            try {
                F.man = await json(base, { method: "POST", body: cuerpo });
                var rv = F.man.revision || {};
                despuesManifiesto("✓ Manifiesto revisado y guardado" + (rv.folio ? " (" + rv.folio + ")" : "") + ". Ya puedes timbrar con esta empresa.");
            } catch (e) { $("msj-man").textContent = e.message; g.disabled = false; g.textContent = "Subir y revisar"; }
        }
    }

    function despuesManifiesto(texto) {
        $("msj-man").textContent = texto;
        actualizarEmisor(Object.assign({}, F.emisor, { manifiesto: F.man.firmado }));
    }

    function pintarFolio() {
        if (!F.emisor) return;
        var serie = F.tipo === "I" ? F.emisor.serie_i : F.emisor.serie_e;
        var folio = F.tipo === "I" ? F.emisor.folio_i : F.emisor.folio_e;
        $("t-folio").textContent = "Será " + (F.tipo === "I" ? "la factura " : "la nota de crédito ") + (serie ? serie + "-" : "") + folio + ".";
        $("cinta-folio").innerHTML = "<small>" + (F.tipo === "I" ? "Siguiente factura" : "Siguiente nota") + "</small><b>" + esc((serie ? serie + "-" : "") + folio) + "</b>";
        $("btn-timbrar").textContent = F.tipo === "I" ? "Timbrar factura" : "Timbrar nota de crédito";
    }

    function actualizarEmisor(nuevo) {
        F.cfg.empresas = F.cfg.empresas.map(function (e) { return e.rfc === nuevo.rfc ? nuevo : e; });
        F.emisor = nuevo;
        pintarEmisor();
    }

    async function guardarConfig() {
        var b = $("btn-guardar-config");
        b.disabled = true;
        $("msj-config").textContent = "";
        try {
            actualizarEmisor(await enviar("/api/facturacion/emisores/" + encodeURIComponent(F.emisor.rfc), "PUT", {
                regimen: $("c-regimen").value || null, cp: $("c-cp").value.trim() || null,
                serie_i: $("c-serie-i").value.trim(), serie_e: $("c-serie-e").value.trim(),
                folio_i: parseInt($("c-folio-i").value, 10) || 1, folio_e: parseInt($("c-folio-e").value, 10) || 1,
                serie_p: $("c-serie-p").value.trim(), folio_p: parseInt($("c-folio-p").value, 10) || 1
            }));
            $("msj-config").textContent = "✓ Guardado.";
        } catch (e) { $("msj-config").textContent = e.message; }
        b.disabled = false;
    }

    async function guardarCsd() {
        var cer = $("c-cer").files[0], key = $("c-key").files[0], pass = $("c-pass").value;
        if (!cer || !key || !pass) { $("msj-csd").textContent = "Elige el .cer, el .key y escribe la contraseña."; return; }
        var cuerpo = new FormData();
        cuerpo.append("cer", cer); cuerpo.append("key", key); cuerpo.append("password", pass);
        var b = $("btn-guardar-csd");
        b.disabled = true; b.textContent = "Revisando…";
        $("msj-csd").textContent = "";
        try {
            actualizarEmisor(await json("/api/facturacion/emisores/" + encodeURIComponent(F.emisor.rfc) + "/csd", { method: "POST", body: cuerpo }));
            $("c-pass").value = ""; $("c-cer").value = ""; $("c-key").value = "";
            $("msj-csd").textContent = "✓ CSD guardado.";
        } catch (e) { $("msj-csd").textContent = e.message; }
        b.disabled = false; b.textContent = "Guardar CSD";
    }

    async function quitarCsd() {
        if (!confirm("¿Quitar el CSD guardado de esta empresa? Ya no podrá timbrar hasta que subas otro.")) return;
        try {
            await api("/api/facturacion/emisores/" + encodeURIComponent(F.emisor.rfc) + "/csd", { method: "DELETE" });
            actualizarEmisor(Object.assign({}, F.emisor, { csd: null, listo: false, faltan: F.emisor.faltan.concat(["CSD (sello digital)"]) }));
        } catch (e) { $("msj-csd").textContent = e.message; }
    }

    async function moverTimbres(signo) {
        var n = parseInt($("c-timbres-n").value, 10);
        if (!n || n < 1) { $("msj-timbres").textContent = "Escribe cuántos."; return; }
        try {
            var r = await enviar("/api/facturacion/timbres/" + encodeURIComponent(F.emisor.rfc), "PUT", { cantidad: signo * n });
            F.cfg.timbres_cuenta = r.timbres_cuenta;
            actualizarEmisor(Object.assign({}, F.emisor, { timbres: r.timbres_empresa, alta_pac: F.emisor.alta_pac || !!r.en_pac }));
            $("msj-timbres").textContent = r.en_pac ? "✓ Listo. En MultiFacturas puede tardar hasta 5 minutos en aplicarse." : "✓ Listo.";
        } catch (e) { $("msj-timbres").textContent = e.message; }
    }

    /* ---------------------------------------------------- nueva factura */
    function estadoCaptura(texto) { $("estado-borrador").textContent = texto; $("estado-borrador").hidden = !texto; }

    function conceptoVacio() {
        return { cantidad: 1, clave_unidad: "E48", clave_prod: "01010101", descripcion: "", valor_unitario: "", descuento: "", iva: "16", objeto_imp: "02",
                 ret_isr: "", ret_iva: "", no_identificacion: "", cuenta_predial: "", modo: "unitario", final: "", producto_id: null, seis: false, error: null };
    }

    function nuevaFactura() {
        F.conceptos = [conceptoVacio()]; F.abierto = 0;
        F.borradorId = null; F.tcManual = false; F.relaciones = []; F.claveEnvio = nuevaClave(); F.sustituye = null; F.notaFecha = "";
        $("rel-activar").checked = false; $("p-nota").textContent = "";
        ["r-rfc", "r-nombre", "r-cp", "rel-uuid", "p-condiciones", "r-buscar", "p-tc", "p-fecha", "p-notas", "r-taxid", "p-pedido", "t-objetivo"].forEach(function (id) { $(id).value = ""; });
        $("objetivo-form").hidden = true; $("btn-ajustar").setAttribute("aria-expanded", "false");
        F.clienteGuardado = null; F.clienteNuevo = false; F.recurrenteId = null;
        pintarRelaciones();
        $("r-regimen").value = "";
        $("r-uso").value = F.tipo === "E" ? "G02" : "G03";
        $("p-moneda").value = "MXN";
        $("r-guardar").checked = true;
        $("r-aviso").hidden = true;
        $("t-error").hidden = true;
        estadoCaptura("");
        verMoneda();
        verFecha();
        verGlobal();
        verExtranjero();
        verRelaciones();
        pintarRelaciones();
        pintarConceptos();
        pintarCliente();
        if (F.paso) irPaso(1);
    }

    /* Llena el formulario con una captura (prefactura o factura copiada) */
    function ponerCaptura(cap, avisos) {
        cap = cap || {};
        ponerTipo(cap.tipo === "E" ? "E" : "I");
        var r = cap.receptor || {};
        $("r-rfc").value = r.rfc || ""; $("r-nombre").value = r.nombre || ""; $("r-cp").value = r.cp || "";
        $("r-regimen").value = r.regimen || ""; $("r-uso").value = r.uso || (F.tipo === "E" ? "G02" : "G03");
        $("r-buscar").value = "";
        $("p-metodo").value = cap.metodo_pago || "PUE";
        $("p-forma").value = cap.forma_pago || "03";
        $("p-forma").disabled = $("p-metodo").value === "PPD";
        $("p-condiciones").value = cap.condiciones || "";
        $("p-moneda").value = cap.moneda === "USD" ? "USD" : "MXN";
        $("p-tc").value = cap.tipo_cambio || ""; F.tcManual = !!cap.tipo_cambio;
        $("p-fecha").value = "";
        F.notaFecha = "";
        if (cap.fecha && !cap.fecha_original) {
            var fp = new Date(cap.fecha.slice(0, 19)), minp = new Date(Date.now() - 71 * 3600000 + 10 * 60000);
            if (!isNaN(fp) && fp >= minp && fp <= new Date()) { $("p-fecha").value = cap.fecha.slice(0, 16); F.notaFecha = "Fecha de la prefactura: se timbra con ella (el SAT la acepta hasta " + fechaCorta(new Date(fp.getTime() + 71 * 3600000 + 50 * 60000).toISOString()) + ")."; }
            else if (!isNaN(fp)) { $("p-fecha").value = fechaLocal(minp); F.notaFecha = "La prefactura tenía fecha del " + fechaCorta(cap.fecha) + ", que el SAT ya no acepta: quedó la más antigua posible (72 horas). Bórrala para usar la de hoy."; }
        }
        if (cap.fecha_original) {
            // La original dentro de las 72 horas: se queda su fecha; si es más vieja, la más antigua que el SAT acepta
            var orig = new Date(cap.fecha_original.slice(0, 19)), min = new Date(Date.now() - 71 * 3600000 + 10 * 60000);
            if (!isNaN(orig)) {
                if (orig >= min && orig <= new Date()) { $("p-fecha").value = cap.fecha_original.slice(0, 16); F.notaFecha = "Se quedó la fecha de la original."; }
                else { $("p-fecha").value = fechaLocal(min); F.notaFecha = "La original es del " + fechaCorta(cap.fecha_original) + ": quedó la fecha más antigua que el SAT acepta (72 horas). Bórrala para usar la de hoy."; }
            }
        }
        $("p-notas").value = cap.notas || "";
        $("p-pedido").value = cap.pedido || "";
        $("r-guardar").checked = cap.guardar_cliente !== false;
        var rel = cap.relacionados || [];
        F.relaciones = (Array.isArray(rel) ? rel : [rel]).filter(function (g) { return g && (g.uuids || []).length; })
            .map(function (g) { return { tipo_relacion: g.tipo_relacion || (F.tipo === "E" ? "01" : "04"), uuids: g.uuids.slice() }; });
        $("rel-activar").checked = F.relaciones.length > 0;
        $("rel-uuid").value = "";
        $("r-pais").value = r.residencia || "USA"; $("r-taxid").value = r.num_reg_id || "";
        F.claveEnvio = nuevaClave();
        var g = cap.global || {};
        if (g.periodicidad) $("g-periodicidad").value = g.periodicidad;
        if (g.meses) $("g-meses").value = g.meses;
        if (g.anio) $("g-anio").value = g.anio;
        F.conceptos = (cap.conceptos || []).map(function (c) { return Object.assign(conceptoVacio(), c, { descuento: c.descuento || "", seis: !!c.seis_decimales }); });
        if (!F.conceptos.length) F.conceptos = [conceptoVacio()];
        F.abierto = F.conceptos.length === 1 && conceptoEnBlanco(F.conceptos[0]) ? 0 : -1;
        marcarErrores();

        var claveR = (r.rfc || "").toUpperCase() === "XEXX010101000" ? "XEXX010101000:" + String(r.num_reg_id || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase() : (r.rfc || "").toUpperCase();
        var yaGuardado = (F.receptores || []).filter(function (x) { return (x.clave || x.rfc) === claveR; })[0];
        F.clienteGuardado = yaGuardado ? { nombre: yaGuardado.nombre || "", cp: yaGuardado.cp || "", regimen: yaGuardado.regimen || "" } : null;
        F.clienteNuevo = false; $("r-actualizar").checked = false;
        verMoneda(); verFecha(); verGlobal(); verExtranjero(); pintarConceptos(); pintarRelaciones(); verRelaciones(); pintarCliente();
        verFecha();
        $("t-error").hidden = true;
        var a = $("r-aviso");
        a.hidden = !(avisos && avisos.length);
        a.innerHTML = avisos && avisos.length ? "<b>Revisa:</b> " + avisos.map(esc).join(" · ") : "";
        vista("nueva");
        irPaso(1);
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function ponerTipo(tipo) {
        F.tipo = tipo;
        $("tipo-doc").value = tipo;
        $("t-titulo").textContent = tipo === "E" ? "Nota de crédito" : "Factura";
        $("rel-tipo").value = tipo === "E" ? "01" : "04";
        $("btn-anticipo").hidden = tipo !== "I";
        verRelaciones();
        if (tipo === "E" && $("r-uso").value === "G03") $("r-uso").value = "G02";
        if (tipo === "I" && $("r-uso").value === "G02") $("r-uso").value = "G03";
        pintarFolio();
        verGlobal();
    }

    /* Impuestos más comunes en un solo menú; «Personalizado» abre los de cada tipo en el detalle del concepto */
    var IMPUESTOS = {
        "16": ["IVA 16%", "02", "16", "", ""], "8": ["IVA 8% (frontera)", "02", "8", "", ""], "0": ["IVA 0%", "02", "0", "", ""],
        "exento": ["Exento de IVA", "02", "exento", "", ""], "no": ["No objeto de imp.", "01", "16", "", ""],
        "hon": ["IVA 16% · honorarios", "02", "16", "10", "10.6667"], "resico": ["IVA 16% · RESICO", "02", "16", "1.25", ""],
        "resico2": ["IVA 16% · RESICO e IVA", "02", "16", "1.25", "10.6667"], "flete": ["IVA 16% · fletes", "02", "16", "", "4"],
        "sub": ["IVA 16% · subcontrat.", "02", "16", "", "6"], "exhon": ["Exento · ret. ISR 10%", "02", "exento", "10", ""], "otro": ["Personalizado…", null, null, null, null]
    };
    var DETALLE_IMP = { hon: "Retiene ISR 10 % e IVA 2/3 (persona moral que paga honorarios o arrendamiento)", resico: "Retiene ISR 1.25 % (RESICO persona física a persona moral)",
        resico2: "Retiene ISR 1.25 % e IVA 2/3", exhon: "Exento de IVA y retiene ISR 10 % (p. ej. honorarios médicos a una persona moral)", flete: "Retiene IVA 4 % (autotransporte de carga)", sub: "Retiene IVA 6 % (servicios con personal puesto a disposición)" };
    function impuestoDe(c) {
        if (c.objeto_imp === "01") return "no";
        var k = Object.keys(IMPUESTOS).filter(function (k) { var x = IMPUESTOS[k]; return x[1] === "02" && x[2] === c.iva && x[3] === (c.ret_isr || "") && x[4] === (c.ret_iva || ""); })[0];
        return k || "otro";
    }
    function ponerImpuesto(c, k) {
        var x = IMPUESTOS[k]; if (!x || !x[1]) return;
        c.objeto_imp = x[1]; c.iva = x[2]; c.ret_isr = x[3]; c.ret_iva = x[4];
    }
    function tasas(c) {
        if (c.objeto_imp !== "02") return { t: 0, ri: 0, rs: 0 };
        return { t: { "16": 0.16, "8": 0.08 }[c.iva] || 0, ri: { "10.6667": 0.106667, "4": 0.04, "6": 0.06, "16": 0.16 }[c.ret_iva] || 0, rs: { "10": 0.10, "1.25": 0.0125 }[c.ret_isr] || 0 };
    }
    /* ---------- cuentas exactas, iguales a las del servidor (enteros en millonésimas, sin errores de punto flotante) ----------
       Concepto normal: importe, base e impuestos al centavo. Concepto con «seis» (precio final que no cuadra al centavo):
       hasta 6 decimales, como permite el Anexo 20. El resumen (subtotal, descuento, impuestos por tasa y total) va al centavo. */
    var MIL = 1000000n;
    function aMicro(v) {
        var s = String(v == null ? "" : v).replace(/[,\s$]/g, "");
        if (!s || isNaN(+s)) return 0n;
        if (/e/i.test(s)) s = (+s).toFixed(8);
        var neg = s.charAt(0) === "-"; if (neg) s = s.slice(1);
        var p = s.split("."), fr = (p[1] || "") + "0000000";
        var x = BigInt(p[0] || "0") * MIL + BigInt(fr.slice(0, 6)) + (+fr.charAt(6) >= 5 ? 1n : 0n);
        return neg ? -x : x;
    }
    function porRed(a, b, dec) {          // a·b (millonésimas) redondeado (mitad hacia arriba) a 2 o 6 decimales
        var u = dec === 2 ? 10000n * MIL : MIL, p = a * b;
        return (p + u / 2n) / u * (u / MIL);
    }
    function red2(x) { return (x + 5000n) / 10000n * 10000n; }
    function deMicro(x) { return Number(x) / 1e6; }
    var TASA_IVA = { "16": 160000n, "8": 80000n, "0": 0n }, TASA_RIVA = { "10.6667": 106667n, "4": 40000n, "6": 60000n, "16": 160000n }, TASA_RISR = { "10": 100000n, "1.25": 12500n };
    function cuentasConcepto(c, unitario) {
        var dec = c.seis ? 6 : 2;
        var imp = porRed(aMicro(c.cantidad), aMicro(unitario == null ? c.valor_unitario : unitario), dec);
        var ds = dec === 2 ? red2(aMicro(c.descuento)) : aMicro(c.descuento);
        if (ds > imp) ds = imp;
        var base = imp - ds, obj = c.objeto_imp === "02";
        var tasa = obj ? TASA_IVA[c.iva] : undefined;
        return { imp: imp, ds: ds, base: base, grupoIva: tasa === undefined ? null : c.iva,
                 iva: tasa ? porRed(base, tasa, dec) : 0n, riva: obj && TASA_RIVA[c.ret_iva] ? porRed(base, TASA_RIVA[c.ret_iva], dec) : 0n,
                 risr: obj && TASA_RISR[c.ret_isr] ? porRed(base, TASA_RISR[c.ret_isr], dec) : 0n };
    }
    function totalesDe(lista) {
        var sub = 0n, ds = 0n, ivas = {}, riva = 0n, risr = 0n;
        lista.forEach(function (c) {
            var x = c._cuentas || cuentasConcepto(c);
            sub += x.imp; ds += x.ds; riva += x.riva; risr += x.risr;
            if (x.grupoIva) ivas[x.grupoIva] = (ivas[x.grupoIva] || 0n) + x.iva;
        });
        var iva = Object.keys(ivas).reduce(function (a, k) { return a + red2(ivas[k]); }, 0n), ret = red2(riva) + red2(risr);
        sub = red2(sub); ds = red2(ds);
        return { importe: deMicro(sub), descuento: deMicro(ds), base: deMicro(sub - ds), iva: deMicro(iva), ret: deMicro(ret), total: deMicro(sub - ds + iva - ret) };
    }
    /* El total de un solo concepto (como si fuera la única línea de la factura) */
    function totalConcepto(c, unitario) {
        var x = cuentasConcepto(c, unitario), t = totalesDe([{ _cuentas: x }]);
        t.importeExacto = deMicro(x.imp);
        return t;
    }
    /* Precio final → unitario. Primero busca un importe al centavo (la factura queda «normal»); si con centavos no existe
       ese total (el IVA redondeado se salta algunos), usa hasta 6 decimales en ese concepto. evaluar(c) da el total que
       se quiere cuadrar (por defecto el del concepto solo); resto es lo que le toca a este concepto, para el arranque. */
    function resolverUnitario(c, objetivo, evaluar, resto) {
        evaluar = evaluar || function (cc) { return totalConcepto(cc).total; };
        objetivo = r2(objetivo);
        var q = num(c.cantidad) || 1, x = tasas(c), k = 1 + x.t - x.ri - x.rs;
        var est = (resto == null ? objetivo : resto) / k + num(c.descuento), mejor = null;
        function u6(imp) { return Math.round(imp / q * 1e6) / 1e6; }
        function anota(u, seis) {
            var t = evaluar(Object.assign({}, c, { valor_unitario: String(u), seis: seis })), dif = r2(t - objetivo);
            if (!mejor || Math.abs(dif) < Math.abs(mejor.dif) - 1e-9) mejor = { unitario: u, seis: seis, dif: dif, total: t };
            return { exacto: dif === 0, t: t };
        }
        for (var p = 0; p <= 80; p++) {
            for (var sg = 1; sg >= -1; sg -= 2) {
                var imp = r2(est + sg * p * 0.01);
                if (imp > 0 && anota(u6(imp), false).exacto) return mejor;
                if (!p) break;
            }
        }
        var centro = r2(est);
        for (var a = 0; a <= 6; a++) {
            for (var sg2 = 1; sg2 >= -1; sg2 -= 2) {
                var previo = null;
                for (var m = -5000; m < 5000; m += 25) {
                    var imp6 = Math.round((centro + sg2 * a * 0.01) * 1e6 + m) / 1e6;
                    if (imp6 <= 0) continue;
                    var r = anota(u6(imp6), true);
                    if (r.exacto) return mejor;
                    if (previo !== null && (previo - objetivo) * (r.t - objetivo) < 0) {    // brincó el objetivo: revisa de una en una
                        for (var m2 = m - 24; m2 < m; m2++) if (anota(u6(Math.round((centro + sg2 * a * 0.01) * 1e6 + m2) / 1e6), true).exacto) return mejor;
                    }
                    previo = r.t;
                }
                if (!a) break;
            }
        }
        return mejor;
    }
    function aplicarFinal(c) {
        if (c.modo !== "final") return;
        var objetivo = num(c.final);
        if (!(objetivo > 0)) { c.valor_unitario = ""; c.difFinal = null; c.seis = false; return; }
        var r = resolverUnitario(c, objetivo);
        c.valor_unitario = String(r.unitario); c.seis = r.seis; c.difFinal = r.dif;
    }
    function dineroExacto(v) {     // con los decimales que lleve (2 a 6)
        var t = Math.abs(v).toFixed(6).replace(/0+$/, ""), p = t.split(".");
        return (v < 0 ? "-$" : "$") + Number(p[0]).toLocaleString("es-MX") + "." + (p[1] || "").padEnd(2, "0");
    }
    function subPrecio(c) {
        return (num(c.valor_unitario) ? "unit. " + esc(c.valor_unitario) : "precio final") + (c.seis ? ' · <span class="fa-seis" title="Para cuadrar al centavo, este concepto lleva hasta 6 decimales (lo permite el SAT); los totales van al centavo.">6 dec.</span>' : "") +
            (c.difFinal ? ' <b class="fa-mal">dif ' + dinero(c.difFinal) + "</b>" : "");
    }

    var icono = function (n) { return window.Fiscontable && Fiscontable.icono ? Fiscontable.icono(n) : ""; };
    function botonIcono(nombre, dato, titulo, extra) {
        return '<button type="button" class="ui-icono-btn' + (extra ? " " + extra : "") + '" ' + dato + ' aria-label="' + titulo + '" title="' + titulo + '">' + icono(nombre) + "</button>";
    }
    function textoClave(c) {
        return (c.clave_prod ? c.clave_prod + " · " + c.clave_unidad : "Sin clave del SAT") + (c.no_identificacion ? " · " + c.no_identificacion : "") + (c.cuenta_predial ? " · predial " + c.cuenta_predial : "");
    }
    function conceptoEnBlanco(c) { return !(c.descripcion || "").trim() && !num(c.valor_unitario) && !num(c.final); }
    /* Lo que le falta a un renglón para poder timbrarse ("" = completo) */
    function errorConcepto(c) {
        if (!(c.descripcion || "").trim()) return "Falta la descripción.";
        if (!(num(c.cantidad) > 0)) return "La cantidad debe ser mayor a cero.";
        if (c.modo === "final" ? !(num(c.final) > 0) : !(num(c.valor_unitario) > 0)) return c.modo === "final" ? "Falta el precio con impuestos." : "Falta el precio.";
        if (!(c.clave_prod || "").trim()) return "Falta la clave del SAT del producto.";
        if (!c.clave_unidad) return "Falta la unidad del SAT.";
        if (num(c.descuento) < 0 || num(c.descuento) > r2(num(c.cantidad) * num(c.valor_unitario))) return "El descuento no puede ser mayor que el importe.";
        if (c.pendiente) return "Venía con un problema en el Excel: revísalo y guárdalo.";
        return "";
    }
    function marcarErrores() { F.conceptos.forEach(function (c, i) { if (i !== F.abierto) c.error = errorConcepto(c) || null; }); }
    function agregarConceptos(nuevos, revisar) {
        var soloVacio = F.conceptos.length === 1 && conceptoEnBlanco(F.conceptos[0]);
        F.conceptos = (soloVacio ? [] : F.conceptos).concat(nuevos);
        F.abierto = -1;
        if (revisar !== false) marcarErrores();
        pintarConceptos();
    }

    function filaConcepto(c, i) {
        var imp = c._otro ? "otro" : impuestoDe(c), t = totalConcepto(c), abierto = i === F.abierto, varios = F.conceptos.length > 1;
        var importe = '<td class="fa-num fa-conc__importe" data-importe>' + (c.seis ? dineroExacto(t.importeExacto) : dinero(t.importe)) + "</td>";
        var error = c.error ? '<small class="fa-conc__err" role="alert">' + esc(c.error) + "</small>" : "";
        if (!abierto) {
            var precio = c.modo === "final"
                ? (num(c.final) ? dinero(num(c.final)) : "—") + '<small class="fa-conc__sub">incluye impuestos</small>'
                : (num(c.valor_unitario) ? (c.seis ? dineroExacto(num(c.valor_unitario)) : dinero(num(c.valor_unitario))) : "—");
            return '<tr class="fa-conc__fila fa-conc--guardado' + (c.error ? " fa-conc--error" : "") + '" data-i="' + i + '" tabindex="0" title="Toca para editar">' +
                '<td class="fa-num" data-campo="cantidad">' + esc(c.cantidad || "") + "</td>" +
                '<td class="fa-conc__prod" data-campo="descripcion"><span class="fa-conc__texto">' + (c.descripcion ? esc(c.descripcion) : '<i class="fa-conc__vacio">Sin descripción</i>') + "</span>" +
                '<small class="fa-conc__sub">' + esc(textoClave(c)) + "</small>" + error + "</td>" +
                '<td class="fa-num" data-campo="' + (c.modo === "final" ? "final" : "valor_unitario") + '">' + precio + "</td>" +
                '<td class="fa-num" data-campo="descuento">' + (num(c.descuento) ? dinero(num(c.descuento)) : "—") + "</td>" +
                '<td data-campo="impuesto">' + esc((IMPUESTOS[imp] || IMPUESTOS.otro)[0].replace("Personalizado…", "Personalizado")) + "</td>" + importe +
                '<td class="fa-conc__acc">' + botonIcono("lapiz", "data-editar", "Editar") + botonIcono("copiar", "data-duplicar", "Duplicar") +
                (varios ? botonIcono("basura", "data-quitar", "Quitar", "ui-icono-btn--peligro") : "") + "</td></tr>";
        }
        var celdaPrecio = (c.modo === "final"
                ? '<input data-c="final" inputmode="decimal" class="fa-num fa-conc__final" value="' + esc(c.final) + '" placeholder="0.00" aria-label="Precio con impuestos">' +
                  '<small class="fa-conc__sub">' + subPrecio(c) + "</small>"
                : '<input data-c="valor_unitario" inputmode="decimal" class="fa-num" value="' + esc(c.valor_unitario) + '" placeholder="0.00" aria-label="Precio unitario">') +
            '<label class="ui-check fa-conc__incl" title="Escribe lo que paga el receptor por este renglón y se calcula el precio sin impuestos, exacto al centavo"><input type="checkbox" data-c="modo"' + (c.modo === "final" ? " checked" : "") + "> Incluye impuestos</label>";
        var fila = '<tr class="fa-conc__fila fa-conc--abierto' + (c.error ? " fa-conc--error" : "") + '" data-i="' + i + '">' +
            '<td><input data-c="cantidad" inputmode="decimal" class="fa-num" value="' + esc(c.cantidad) + '" aria-label="Cantidad"></td>' +
            '<td class="fa-conc__prod"><div class="fa-prod"><input data-c="descripcion" maxlength="1000" value="' + esc(c.descripcion) + '" placeholder="Escribe o busca un producto…" autocomplete="off" aria-label="Descripción">' +
            '<div class="fa-prod__sug" hidden></div></div><small class="fa-conc__sub">' + esc(textoClave(c)) + "</small></td>" +
            "<td>" + celdaPrecio + "</td>" +
            '<td><input data-c="descuento" inputmode="decimal" class="fa-num" value="' + esc(c.descuento) + '" placeholder="0.00" aria-label="Descuento"></td>' +
            '<td><select data-c="impuesto" aria-label="Impuesto" title="' + esc(DETALLE_IMP[imp] || IMPUESTOS[imp][0]) + '">' + Object.keys(IMPUESTOS).map(function (k) { return '<option value="' + k + '"' + (k === imp ? " selected" : "") + ">" + esc(IMPUESTOS[k][0]) + "</option>"; }).join("") + "</select></td>" +
            importe +
            '<td class="fa-conc__acc">' + botonIcono("palomita", "data-guardar-fila", "Guardar renglón (Enter)", "ui-icono-btn--ok") + botonIcono("copiar", "data-duplicar", "Duplicar") +
            (varios ? botonIcono("basura", "data-quitar", "Quitar", "ui-icono-btn--peligro") : "") + "</td></tr>";
        var retIsr = { "": "Sin retención", "10": "10 %", "1.25": "1.25 % (RESICO)" };
        var retIva = { "": "Sin retención", "10.6667": "2/3 del IVA", "4": "4 % (fletes)", "6": "6 % (subcontratación)", "16": "16 %" };
        var ivas = { "16": "16 %", "8": "8 %", "0": "0 %", "exento": "Exento" };
        return fila + '<tr class="fa-conc__detalle" data-i="' + i + '"><td colspan="7">' + (c.error ? '<p class="fa-conc__err fa-conc__err--caja" role="alert">' + esc(c.error) + "</p>" : "") +
            '<div class="fa-rejilla fa-rejilla--detalle">' +
            '<div class="fa-campo fa-c3"><span>Clave del SAT</span><div class="fa-clave" data-clave="prod" data-i="' + i + '"></div></div>' +
            '<div class="fa-campo fa-c3"><span>Unidad del SAT</span><div class="fa-clave" data-clave="unidad" data-i="' + i + '"></div></div>' +
            '<label class="fa-campo fa-c2"><span>Código <i>(no. identificación)</i></span><input data-c="no_identificacion" maxlength="100" value="' + esc(c.no_identificacion) + '"></label>' +
            '<label class="fa-campo fa-c2"><span>Cuenta predial</span><input data-c="cuenta_predial" maxlength="150" value="' + esc(c.cuenta_predial) + '"></label>' +
            (imp === "otro" ? '<label class="fa-campo fa-c2"><span>IVA</span><select data-c="iva">' + opciones(ivas, c.iva, false) + "</select></label>" +
                '<label class="fa-campo fa-c2"><span>Retención de ISR</span><select data-c="ret_isr">' + opciones(retIsr, c.ret_isr || "", false) + "</select></label>" +
                '<label class="fa-campo fa-c2"><span>Retención de IVA</span><select data-c="ret_iva">' + opciones(retIva, c.ret_iva || "", false) + "</select></label>" : "") +
            '<div class="fa-campo fa-c6 fa-conc__nota"><p class="fa-nota">Base ' + dinero(t.base) + " · IVA " + dinero(t.iva) + (t.ret ? " · retenciones " + dinero(t.ret) : "") +
            " · <b>total del renglón " + dinero(t.total) + '</b> · <button type="button" class="fa-link" data-guardar-prod>' + (c.producto_id ? "Actualizar en el catálogo" : "Guardar en el catálogo") + "</button></p>" +
            '<p class="fa-nota fa-conc__teclas">Enter guarda y abre otro renglón · Tab pasa al siguiente campo · Esc cierra</p></div>' +
            "</div></td></tr>";
    }

    function pintarConceptos() {
        if (F.abierto == null || F.abierto >= F.conceptos.length) F.abierto = -1;
        $("conceptos").innerHTML = F.conceptos.map(filaConcepto).join("");
        document.querySelectorAll("#conceptos .fa-clave").forEach(function (caja) {
            var c = F.conceptos[+caja.dataset.i];
            widgetClave(caja, caja.dataset.clave, caja.dataset.clave === "prod" ? c.clave_prod : c.clave_unidad, function (clave, texto) {
                if (caja.dataset.clave === "prod") c.clave_prod = clave; else { c.clave_unidad = clave; c.unidad = texto; }
                refrescarSub(+caja.dataset.i);
            });
        });
        calcular();
    }

    /* Abre el renglón i para editarlo. El que estaba abierto se guarda solo: si está completo queda limpio;
       si le falta algo se queda marcado con su error (sin perder lo escrito). Un renglón totalmente en blanco se quita. */
    function abrirConcepto(i, campo) {
        var previo = F.abierto;
        if (previo === i) return;
        if (previo >= 0 && F.conceptos[previo]) {
            var c = F.conceptos[previo];
            if (conceptoEnBlanco(c) && F.conceptos.length > 1 && i !== -1) { F.conceptos.splice(previo, 1); if (i > previo) i--; }
            else c.error = errorConcepto(c) || null;
        }
        F.abierto = i;
        pintarConceptos();
        if (i >= 0) enfocarConcepto(i, campo);
    }
    function enfocarConcepto(i, campo) {
        var fila = document.querySelector('.fa-conc__fila[data-i="' + i + '"]');
        var el = fila && (fila.querySelector('[data-c="' + (campo || "descripcion") + '"]') || fila.querySelector('[data-c="descripcion"]'));
        if (el) { el.focus(); if (el.select && el.tagName === "INPUT" && el.type !== "checkbox") el.select(); }
    }
    /* Guardar el renglón abierto: si le falta algo, se queda abierto y dice qué; nuevo=true abre uno en blanco debajo */
    function guardarConcepto(nuevo) {
        var i = F.abierto, c = F.conceptos[i];
        if (!c) return;
        c.pendiente = false;
        c.error = errorConcepto(c) || null;
        if (c.error) { pintarConceptos(); enfocarConcepto(i, /descripci/.test(c.error) ? "descripcion" : /cantidad/.test(c.error) ? "cantidad" : /precio/i.test(c.error) ? (c.modo === "final" ? "final" : "valor_unitario") : "descripcion"); return; }
        if (nuevo) { F.conceptos.splice(i + 1, 0, conceptoVacio()); F.abierto = i + 1; pintarConceptos(); enfocarConcepto(i + 1); }
        else { F.abierto = -1; pintarConceptos(); }
    }
    /* Antes de pasar a revisar/timbrar: guarda el abierto, quita renglones en blanco y dice el primero con error */
    function revisarConceptos() {
        if (F.conceptos.length > 1) F.conceptos = F.conceptos.filter(function (c) { return !conceptoEnBlanco(c); });
        if (!F.conceptos.length) F.conceptos = [conceptoVacio()];
        F.abierto = -1;
        F.conceptos.forEach(function (c) { c.error = errorConcepto(c) || null; });
        pintarConceptos();
        var malo = F.conceptos.findIndex(function (c) { return c.error; });
        return malo === -1 ? "" : "Revisa el renglón " + (malo + 1) + ": " + F.conceptos[malo].error;
    }

    function refrescarSub(i) {
        var c = F.conceptos[i], fila = document.querySelector('.fa-conc__fila[data-i="' + i + '"]');
        if (!fila) return;
        fila.querySelector(".fa-conc__prod .fa-conc__sub").textContent = textoClave(c);
    }

    function calcular() {
        F.conceptos.forEach(function (c, i) {
            var el = document.querySelector('.fa-conc__fila[data-i="' + i + '"] [data-importe]');
            if (el) { var t = totalConcepto(c); el.textContent = c.seis ? dineroExacto(t.importeExacto) : dinero(t.importe); }
        });
        var tt = totalesDe(F.conceptos), sub = tt.importe, desc = tt.descuento, iva = tt.iva, ret = tt.ret, total = tt.total;
        $("t-subtotal").textContent = dinero(sub);
        $("t-descuento").textContent = "-" + dinero(desc);
        $("t-iva").textContent = dinero(iva);
        $("t-ret").textContent = "-" + dinero(ret);
        $("t-total").textContent = dinero(total);
        document.querySelectorAll('[data-fila="descuento"]').forEach(function (x) { x.hidden = !desc; });
        document.querySelectorAll('[data-fila="retenciones"]').forEach(function (x) { x.hidden = !ret; });
        var mon = $("p-moneda").value;
        $("t-letra").textContent = total > 0 ? enLetra(total, mon) : "";
        document.querySelector("dt.fa-total").textContent = "Total " + (mon === "USD" ? "USD" : "");
        var obj = num($("t-objetivo").value);
        if (!F.cuadrando) $("t-objetivo-nota").innerHTML = obj > 0 ? (r2(obj) === total ? '<b class="fa-bien">Cuadra exacto con ' + dinero(obj) + "</b>" : "Diferencia " + dinero(r2(total - obj)) + ": toca «Ajustar».")
            : "Se cambia el precio del último renglón para que la factura llegue exacta al centavo, con impuestos y retenciones.";
        return { total: total };
    }

    /* «El total debe ser X»: el último concepto pasa a precio final y se resuelve contra el total de TODA la factura */
    function cuadrarTotal() {
        var obj = r2(num($("t-objetivo").value));
        if (!(obj > 0) || !F.conceptos.length) return;
        var n = F.conceptos.length - 1, ultimo = F.conceptos[n];
        var otros = totalesDe(F.conceptos.slice(0, -1)).total;
        var evaluar = function (cc) { var lista = F.conceptos.slice(); lista[n] = cc; return totalesDe(lista).total; };
        var r = resolverUnitario(ultimo, obj, evaluar, r2(obj - otros));
        ultimo.modo = "final"; ultimo.final = String(r2(obj - otros));
        ultimo.valor_unitario = String(r.unitario); ultimo.seis = r.seis; ultimo.difFinal = r.dif; ultimo.error = null;
        F.cuadrando = !!r.dif;
        pintarConceptos();
        F.cuadrando = false;
        if (!r.dif) return;
        var cerca = [];
        [-1, 1].forEach(function (sg) {
            for (var k = 1; k <= 5; k++) {
                if (!resolverUnitario(ultimo, r2(obj + sg * k * 0.01), evaluar, r2(obj - otros + sg * k * 0.01)).dif) { cerca.push(r2(obj + sg * k * 0.01)); break; }
            }
        });
        $("t-objetivo-nota").innerHTML = dinero(obj) + " no sale exacto con esa cantidad. Lo más cerca: " +
            cerca.map(function (x) { return '<button type="button" class="fa-link" data-objetivo="' + x + '">' + dinero(x) + "</button>"; }).join(" o ") + ". También puedes dejar la cantidad en 1.";
    }

    /* ---------- buscador de claves del SAT (producto o unidad) ---------- */
    var esperaClave = null;
    function widgetClave(caja, tipo, valor, alCambiar) {
        caja.innerHTML = '<input class="fa-clave__in" autocomplete="off" placeholder="' + (tipo === "prod" ? "Busca por palabra o clave…" : "Pieza, servicio, hora…") + '" value="' + esc(valor || "") + '"><div class="fa-clave__lista" hidden></div>';
        var input = caja.querySelector("input"), lista = caja.querySelector(".fa-clave__lista");
        if (valor) json("/api/facturacion/sat/claves?tipo=" + tipo + "&q=" + encodeURIComponent(valor) + "&rfc=" + encodeURIComponent(F.emisor ? F.emisor.rfc : ""))
            .then(function (r) { var x = r.filter(function (y) { return y.clave === valor; })[0]; if (x && document.activeElement !== input) input.value = x.clave + " · " + x.texto; }).catch(function () {});
        function buscar() {
            clearTimeout(esperaClave);
            esperaClave = setTimeout(async function () {
                try {
                    var r = await json("/api/facturacion/sat/claves?tipo=" + tipo + "&q=" + encodeURIComponent(input.value.split(" · ")[0].trim()) + "&rfc=" + encodeURIComponent(F.emisor ? F.emisor.rfc : ""));
                    lista.innerHTML = r.length ? r.map(function (x) { return '<button type="button" data-k="' + esc(x.clave) + '" data-t="' + esc(x.texto) + '"><b>' + esc(x.clave) + "</b> " + esc(x.texto) + (x.similares ? "<small>" + esc(x.similares) + "</small>" : "") + "</button>"; }).join("")
                        : '<p class="fa-vacio-chico">Nada coincide.</p>';
                    lista.hidden = false;
                } catch (e) { lista.hidden = true; }
            }, 180);
        }
        input.addEventListener("focus", function () { input.select(); buscar(); });
        input.addEventListener("input", buscar);
        input.addEventListener("blur", function () { setTimeout(function () { lista.hidden = true; }, 180); });
        lista.addEventListener("mousedown", function (ev) {
            var b = ev.target.closest("[data-k]"); if (!b) return;
            ev.preventDefault();
            input.value = b.dataset.k + " · " + b.dataset.t; lista.hidden = true; input.blur();
            alCambiar(b.dataset.k, b.dataset.t);
        });
        caja.valor = function () { return input.value.split(" · ")[0].trim(); };
    }

    /* ---------- catálogo de productos (por empresa) ---------- */
    async function cargarProductos() {
        if (!F.empresa) return;
        try { F.productos = await json("/api/facturacion/productos?rfc=" + encodeURIComponent(F.empresa.rfc)); } catch (e) { F.productos = []; }
        pintarProductos();
    }

    function textoImpuesto(p) { return (IMPUESTOS[impuestoDe(p)] || IMPUESTOS.otro)[0].replace("Personalizado…", "Personalizado"); }

    function pintarProductos() {
        if (!$("prod-lista")) return;
        var q = ($("prod-buscar").value || "").trim().toLowerCase(), lista = F.productos || [];
        var filas = lista.filter(function (p) { return !q || [p.nombre, p.codigo, p.clave_prod, p.descripcion].join(" ").toLowerCase().indexOf(q) !== -1; });
        $("prod-cuenta").textContent = lista.length ? "(" + lista.length + ")" : "";
        $("prod-lista").innerHTML = filas.length ? filas.map(function (p) {
            return '<div class="fa-item" data-prod="' + esc(p.id) + '"><span class="fa-opcion__ini">' + esc((p.nombre || "·").charAt(0)) + '</span><div class="fa-item__txt"><b>' + esc(p.nombre) + "</b><small>" +
                esc([p.codigo, p.clave_prod + " · " + p.clave_unidad, textoImpuesto(p), p.cuenta_predial ? "predial " + p.cuenta_predial : ""].filter(Boolean).join(" · ")) + "</small></div>" +
                '<span class="fa-item__monto">' + (p.precio != null ? dinero(p.precio) + (p.precio_con_impuestos ? " <small>final</small>" : "") : "") + "</span></div>";
        }).join("") : '<p class="fa-vacio-chico">' + (lista.length ? "Nada coincide." : "Todavía no hay productos. Agrégalos o impórtalos de tus XML.") + "</p>";
    }

    function abrirProducto(p) {
        F.prodEditando = p || null;
        $("pr-titulo").textContent = p ? "Editar producto" : "Nuevo producto o servicio";
        $("pr-codigo").value = p ? p.codigo || "" : ""; $("pr-nombre").value = p ? p.nombre : "";
        $("pr-precio").value = p && p.precio != null ? p.precio : ""; $("pr-con").value = p && p.precio_con_impuestos ? "1" : "0";
        $("pr-predial").value = p ? p.cuenta_predial || "" : ""; $("pr-descripcion").value = p ? p.descripcion || "" : "";
        var propio = p && impuestoDe(p) === "otro";
        $("pr-impuesto").innerHTML = Object.keys(IMPUESTOS).filter(function (k) { return k !== "otro"; }).map(function (k) { return '<option value="' + k + '">' + esc(IMPUESTOS[k][0]) + "</option>"; }).join("") +
            (propio ? '<option value="otro">Personalizado (se queda como está)</option>' : "");
        $("pr-impuesto").value = p ? impuestoDe(p) : "16";
        F.prClave = p ? p.clave_prod : ""; F.prUnidad = p ? p.clave_unidad : "E48";
        widgetClave($("pr-clave"), "prod", F.prClave, function (k) { F.prClave = k; });
        widgetClave($("pr-unidad"), "unidad", F.prUnidad, function (k) { F.prUnidad = k; });
        $("btn-pr-borrar").hidden = !p; $("pr-error").hidden = true;
        $("dlg-producto").showModal();
    }

    function productoDeFormulario() {
        var k = IMPUESTOS[$("pr-impuesto").value], e = F.prodEditando;
        if (!k[1] && e) k = [null, e.objeto_imp, e.iva, e.ret_isr || "", e.ret_iva || ""];
        return { id: F.prodEditando ? F.prodEditando.id : null, rfc: F.emisor.rfc, codigo: $("pr-codigo").value.trim(), nombre: $("pr-nombre").value.trim(),
                 descripcion: $("pr-descripcion").value.trim() || null, clave_prod: $("pr-clave").valor ? $("pr-clave").valor() : F.prClave,
                 clave_unidad: $("pr-unidad").valor ? $("pr-unidad").valor() : F.prUnidad, precio: $("pr-precio").value === "" ? null : num($("pr-precio").value),
                 precio_con_impuestos: $("pr-con").value === "1", objeto_imp: k[1], iva: k[2], ret_isr: k[3] || null, ret_iva: k[4] || null,
                 cuenta_predial: $("pr-predial").value.replace(/[^0-9a-zA-Z]/g, "") || null };
    }

    async function guardarProducto() {
        try {
            await enviar("/api/facturacion/productos", "PUT", productoDeFormulario());
            $("dlg-producto").close();
            await cargarProductos();
        } catch (e) { $("pr-error").textContent = e.message; $("pr-error").hidden = false; }
    }

    /* Un producto del catálogo llena el concepto */
    function usarProducto(c, p) {
        c.descripcion = p.descripcion || p.nombre; c.clave_prod = p.clave_prod; c.clave_unidad = p.clave_unidad; c.unidad = p.unidad;
        c.no_identificacion = p.codigo || ""; c.cuenta_predial = p.cuenta_predial || ""; c.producto_id = p.id;
        ponerImpuesto(c, impuestoDe(p)); if (impuestoDe(p) === "otro") { c.objeto_imp = p.objeto_imp; c.iva = p.iva; c.ret_isr = p.ret_isr || ""; c.ret_iva = p.ret_iva || ""; }
        if (p.precio != null) {
            if (p.precio_con_impuestos) { c.modo = "final"; c.final = String(r2(p.precio * (num(c.cantidad) || 1))); aplicarFinal(c); }
            else { c.modo = "unitario"; c.valor_unitario = String(p.precio); }
        }
        api("/api/facturacion/productos/" + p.id + "/usado", { method: "POST" }).catch(function () {});
    }

    /* Al escribir la descripción: primero los productos guardados de la empresa y, debajo, las claves del SAT que
       coinciden (antes solo salían los guardados; con el catálogo vacío no salía nada). */
    var esperaSug = null, nSug = 0;
    function sugerirProductos(input) {
        var caja = input.parentNode.querySelector(".fa-prod__sug"), q = input.value.trim().toLowerCase();
        var lista = (F.productos || []).filter(function (p) { return !q || [p.nombre, p.codigo, p.clave_prod].join(" ").toLowerCase().indexOf(q) !== -1; }).slice(0, 8);
        var propios = lista.map(function (p) { return '<button type="button" data-prod="' + esc(p.id) + '"><b>' + esc(p.nombre) + "</b><small>" + esc((p.codigo ? p.codigo + " · " : "") + p.clave_prod + " · " + textoImpuesto(p)) + "</small><span>" + (p.precio != null ? dinero(p.precio) : "") + "</span></button>"; }).join("");
        var pintar = function (sat) {
            var h = (propios ? '<p class="fa-prod__grupo">Tus productos</p>' + propios : "") +
                (sat && sat.length ? '<p class="fa-prod__grupo">Claves del SAT</p>' + sat.map(function (x) {
                    return '<button type="button" data-sat="' + esc(x.clave) + '" data-sat-texto="' + esc(x.texto) + '"><b>' + esc(x.clave) + " · " + esc(x.texto) + "</b>" +
                        (x.similares ? "<small>" + esc(x.similares) + "</small>" : "") + "</button>";
                }).join("") : "");
            caja.innerHTML = h;
            caja.hidden = !h;
        };
        pintar(null);
        clearTimeout(esperaSug);
        if (q.length < 3) return;
        var yo = ++nSug;
        esperaSug = setTimeout(function () {
            json("/api/facturacion/sat/claves?tipo=prod&q=" + encodeURIComponent(q) + "&rfc=" + encodeURIComponent(F.emisor ? F.emisor.rfc : ""))
                .then(function (r) { if (yo === nSug && document.activeElement === input) pintar(r.slice(0, 8)); })
                .catch(function () {});
        }, 220);
    }

    async function guardarConceptoEnCatalogo(i) {
        var c = F.conceptos[i];
        try {
            var p = await enviar("/api/facturacion/productos", "PUT", { id: c.producto_id, rfc: F.emisor.rfc, codigo: c.no_identificacion, nombre: (c.descripcion || "").slice(0, 200),
                clave_prod: c.clave_prod, clave_unidad: c.clave_unidad, precio: c.modo === "final" ? r2(num(c.final) / (num(c.cantidad) || 1)) : num(c.valor_unitario),
                precio_con_impuestos: c.modo === "final", objeto_imp: c.objeto_imp, iva: c.iva, ret_isr: c.ret_isr || null, ret_iva: c.ret_iva || null, cuenta_predial: c.cuenta_predial || null });
            c.producto_id = p.id;
            await cargarProductos();
            aviso("✓ «" + p.nombre + "» quedó en el catálogo de esta empresa.");
        } catch (e) { aviso(e.message, "error"); }
    }

    /* ---------- importar productos de XML (al catálogo o a esta factura) ---------- */
    function abrirImportar(r, destino) {
        F.importar = { lista: r.productos.map(function (x) { return Object.assign({ sel: x.clave_valida !== false }, x); }), destino: destino };
        $("im-titulo").textContent = destino === "factura" ? "Conceptos para esta factura" : "Productos para el catálogo";
        $("im-resumen").textContent = r.leidos + " XML leídos · " + r.productos.length + " productos distintos" + (r.rechazados ? " · " + r.rechazados + " archivo(s) no eran CFDI" : "") +
            ". Revisa el nombre, el precio y el impuesto antes de " + (destino === "factura" ? "agregarlos." : "guardarlos.");
        $("im-guardar-caja").hidden = destino !== "factura";
        $("btn-im-ok").textContent = destino === "factura" ? "Agregar a la factura" : "Guardar en el catálogo";
        $("im-buscar").value = ""; $("im-error").hidden = true;
        pintarImportar();
        $("dlg-importar").showModal();
    }

    function pintarImportar() {
        var q = $("im-buscar").value.trim().toLowerCase(), imp = Object.keys(IMPUESTOS).filter(function (k) { return k !== "otro"; });
        $("im-filas").innerHTML = F.importar.lista.map(function (x, i) {
            if (q && [x.nombre, x.clave_prod].join(" ").toLowerCase().indexOf(q) === -1) return "";
            var k = impuestoDe(x);
            return '<tr data-im="' + i + '"' + (x.clave_valida === false ? ' class="fa-im--mal" title="La clave ya no está vigente: cámbiala antes de usarlo"' : "") + '><td><input type="checkbox" data-im-c="sel"' + (x.sel ? " checked" : "") + "></td>" +
                '<td><input data-im-c="nombre" value="' + esc(x.nombre) + '"></td><td class="fa-mono">' + esc(x.clave_prod) + "</td><td>" + esc(x.clave_unidad) + "</td>" +
                '<td><input data-im-c="precio" class="fa-num" inputmode="decimal" value="' + esc(x.precio == null ? "" : x.precio) + '"></td>' +
                '<td><select data-im-c="impuesto">' + imp.map(function (z) { return '<option value="' + z + '"' + (z === k ? " selected" : "") + ">" + esc(IMPUESTOS[z][0]) + "</option>"; }).join("") +
                (k === "otro" ? '<option value="otro" selected>Como en el XML</option>' : "") + "</select></td><td class='fa-num'>" + x.veces + "</td></tr>";
        }).join("") || '<tr><td colspan="7" class="fa-vacio-chico">Nada coincide.</td></tr>';
    }

    async function confirmarImportar() {
        var elegidos = F.importar.lista.filter(function (x) { return x.sel; });
        if (!elegidos.length) { $("im-error").textContent = "Marca al menos uno."; $("im-error").hidden = false; return; }
        var b = $("btn-im-ok"); b.disabled = true;
        try {
            if (F.importar.destino !== "factura" || $("im-guardar").checked) {
                var r = await enviar("/api/facturacion/productos/lote", "POST", { rfc: F.emisor.rfc, productos: elegidos.map(function (x) {
                    return { codigo: x.codigo, nombre: x.nombre, clave_prod: x.clave_prod, clave_unidad: x.clave_unidad, precio: x.precio === "" ? null : num(x.precio),
                             precio_con_impuestos: false, objeto_imp: x.objeto_imp, iva: x.iva, ret_isr: x.ret_isr || null, ret_iva: x.ret_iva || null };
                }) });
                await cargarProductos();
                if (r.errores.length) aviso(r.guardados + " guardados; " + r.errores.length + " con algo que corregir: " + r.errores.slice(0, 2).join(" · "), "alerta");
                else if (F.importar.destino !== "factura") aviso("✓ " + r.guardados + " productos en el catálogo.");
            }
            if (F.importar.destino === "factura") {
                var nuevos = elegidos.map(function (x) {
                    return Object.assign(conceptoVacio(), { descripcion: x.nombre, clave_prod: x.clave_prod, clave_unidad: x.clave_unidad, valor_unitario: String(x.precio == null ? "" : x.precio),
                        objeto_imp: x.objeto_imp, iva: x.iva, ret_isr: x.ret_isr || "", ret_iva: x.ret_iva || "", no_identificacion: x.codigo || "" });
                });
                agregarConceptos(nuevos);
            }
            $("dlg-importar").close();
        } catch (e) { $("im-error").textContent = e.message; $("im-error").hidden = false; }
        b.disabled = false;
    }

    async function leerXmlProductos(archivos, destino) {
        if (!archivos || !archivos.length) return;
        var cuerpo = new FormData();
        Array.prototype.forEach.call(archivos, function (a) { cuerpo.append("archivos", a); });
        try { abrirImportar(await json("/api/facturacion/productos/leer-xml", { method: "POST", body: cuerpo }), destino); }
        catch (e) { aviso(e.message, "error"); }
    }

    function captura() {
        var rfcR = $("r-rfc").value.trim().toUpperCase();
        return {
            clave_envio: F.claveEnvio,
            tipo: F.tipo, metodo_pago: $("p-metodo").value, forma_pago: $("p-forma").value,
            condiciones: $("p-condiciones").value.trim() || null,
            moneda: $("p-moneda").value, tipo_cambio: $("p-moneda").value === "USD" ? $("p-tc").value.trim() : null,
            fecha: $("p-fecha").value || null, notas: $("p-notas").value.trim() || null, pedido: $("p-pedido").value.trim() || null,
            guardar_cliente: F.clienteGuardado ? $("r-actualizar").checked : $("r-guardar").checked,
            receptor: { rfc: $("r-rfc").value.trim().toUpperCase(), nombre: $("r-nombre").value.trim().toUpperCase(),
                        cp: $("r-cp").value.trim(), regimen: $("r-regimen").value, uso: $("r-uso").value,
                        residencia: rfcR === "XEXX010101000" ? $("r-pais").value : null, num_reg_id: rfcR === "XEXX010101000" ? $("r-taxid").value.trim() : null },
            relacionados: ($("rel-activar").checked || F.tipo === "E") && F.relaciones.length ? F.relaciones : null,
            global: { periodicidad: $("g-periodicidad").value, meses: $("g-meses").value, anio: $("g-anio").value.trim() },
            conceptos: F.conceptos.filter(function (c, i) { return !conceptoEnBlanco(c) || F.conceptos.length === 1; }).map(function (c) {
                return { cantidad: c.cantidad, clave_prod: (c.clave_prod || "").trim(), clave_unidad: c.clave_unidad,
                         descripcion: c.descripcion, valor_unitario: c.valor_unitario, descuento: c.descuento || 0,
                         objeto_imp: c.objeto_imp, iva: c.iva, ret_isr: c.ret_isr, ret_iva: c.ret_iva, no_identificacion: c.no_identificacion || "",
                         cuenta_predial: c.cuenta_predial || "", modo: c.modo, final: c.final, producto_id: c.producto_id || null, unidad: c.unidad || null,
                         seis_decimales: !!c.seis };
            })
        };
    }

    // En producción no se timbra sin manifiesto: en vez de un error, la ventana que explica y deja subirlo
    function faltaManifiesto() {
        if (!F.cfg || !F.cfg.produccion || !F.emisor || F.emisor.manifiesto) return false;
        F.actAbierto = "manifiesto"; pintarActivar();
        $("activar").scrollIntoView({ behavior: "smooth", block: "start" });
        var err = $("t-error"); err.textContent = "Falta el manifiesto del PAC: complétalo arriba, en «Activar facturación»."; err.hidden = false;
        return true;
    }

    function abrirManifiesto(alTimbrar) {
        var d = $("dlg-manifiesto");
        $("mdlg-rfc").textContent = F.emisor.rfc;
        $("mdlg-pdf").value = ""; $("mdlg-subir").disabled = true;
        $("mdlg-msj").textContent = ""; $("mdlg-msj").className = "fa-nota";
        $("mdlg-despues").textContent = alTimbrar ? "Ahora no" : "Recordármelo después";
        if (!d.open) d.showModal();
    }

    async function subirManifiestoDlg() {
        var pdf = $("mdlg-pdf").files[0], b = $("mdlg-subir");
        if (!pdf) return;
        var cuerpo = new FormData();
        cuerpo.append("pac", "lunasoft"); cuerpo.append("pdf", pdf);
        b.disabled = true; b.textContent = "Revisando…"; $("mdlg-msj").textContent = "";
        try {
            F.man = await json("/api/facturacion/manifiesto/" + encodeURIComponent(F.emisor.rfc), { method: "POST", body: cuerpo });
            actualizarEmisor(Object.assign({}, F.emisor, { manifiesto: F.man.firmado }));
            $("dlg-manifiesto").close();
            aviso("✓ Manifiesto revisado y guardado" + (F.man.revision && F.man.revision.folio ? " (" + F.man.revision.folio + ")" : "") + ". Ya puedes timbrar con " + (F.emisor.alias || F.emisor.rfc) + ".", "ok");
        } catch (e) { $("mdlg-msj").textContent = e.message; $("mdlg-msj").className = "fa-error"; }
        b.disabled = !$("mdlg-pdf").files[0]; b.textContent = "Subir y revisar";
    }

    // Al entrar con una empresa sin manifiesto (producción) se recuerda una vez por sesión
    function recordarManifiesto() {
        if (!F.cfg || !F.cfg.produccion || !F.emisor || F.emisor.manifiesto || F.emisor.faltan.length) return;
        var clave = "fa-man-recordado:" + F.emisor.rfc;
        try { if (sessionStorage.getItem(clave)) return; sessionStorage.setItem(clave, "1"); } catch (e) { /* sin almacenamiento */ }
        abrirManifiesto(false);
    }

    async function prepararTimbrado() {
        if (faltaManifiesto()) return;
        var err = $("t-error");
        err.hidden = true;
        var malo = revisarConceptos();
        if (malo) { err.textContent = malo; err.hidden = false; return; }
        var b = $("btn-timbrar");
        b.disabled = true; b.textContent = "Revisando…";
        try {
            var cap = captura();
            var r = await enviar("/api/facturacion/revisar", "POST", { rfc: F.emisor.rfc, captura: cap });
            F.pendiente = cap; F.confirmando = null;
            var t = r.totales, serie = F.tipo === "I" ? F.emisor.serie_i : F.emisor.serie_e, folio = F.tipo === "I" ? F.emisor.folio_i : F.emisor.folio_e;
            $("conf-titulo").textContent = F.tipo === "I" ? "¿Timbrar esta factura?" : "¿Timbrar esta nota de crédito?";
            $("conf-resumen").innerHTML = '<dl class="fa-resumen">' +
                "<dt>Folio</dt><dd>" + esc((serie ? serie + "-" : "") + folio) + "</dd>" +
                "<dt>Emisor</dt><dd>" + esc(r.emisor.nombre + " · " + r.emisor.rfc) + "</dd>" +
                "<dt>Receptor</dt><dd>" + esc(cap.receptor.nombre + " · " + cap.receptor.rfc) + "</dd>" +
                "<dt>Fecha de emisión</dt><dd>" + esc((r.fecha || "").replace("T", " ")) + (cap.fecha ? "" : " <small>(se pone al timbrar)</small>") + "</dd>" +
                "<dt>Conceptos</dt><dd>" + cap.conceptos.length + "</dd>" +
                "<dt>Total</dt><dd>" + dinero(t.total) + (r.moneda === "USD" ? " USD · T.C. " + esc(r.tipo_cambio) : "") + "</dd></dl>";
            $("conf-nota").textContent = F.cfg.produccion
                ? "Se manda al SAT y gasta 1 timbre de la empresa. Una vez timbrada ya no se puede editar: solo cancelar."
                : "Modo de pruebas: no gasta timbres ni tiene validez fiscal.";
            var pref = F.borradores.filter(function (x) { return x.id === F.borradorId; })[0];
            $("conf-pref").hidden = !pref || !!pref.recurrente;
            if (pref && !pref.recurrente) {
                var dias = F.cfg.prefacturas_dias == null ? 3 : F.cfg.prefacturas_dias;
                $("conf-pref-chk").checked = dias !== 0;
                $("conf-pref-txt").innerHTML = "Conservar la prefactura «" + esc(pref.nombre) + "» " + (dias > 0 ? dias + " día" + (dias === 1 ? "" : "s") : dias < 0 ? "siempre" : "") +
                    " para reutilizarla <small class='fa-nota'>(se cambia en Configuración)</small>";
            }
            $("dlg-confirmar").showModal();
        } catch (e) {
            err.textContent = e.message; err.hidden = false;
        }
        b.disabled = false; pintarFolio();
    }

    async function timbrar() {
        if (F.confirmando === "pago") return timbrarPago();
        var b = $("btn-confirmar");
        if (b.disabled) return;
        b.disabled = true; b.textContent = "Timbrando…";
        try {
            var r;
            if (F.borradorId) F.pendiente.prefactura = { id: F.borradorId, conservar: $("conf-pref").hidden ? null : $("conf-pref-chk").checked };
            try { r = await enviar("/api/facturacion/timbrar", "POST", { rfc: F.emisor.rfc, captura: F.pendiente }); }
            catch (e) {
                if (e.status === 428) { $("dlg-confirmar").close(); F.emisor.manifiesto = false; abrirManifiesto(true); return; }
                if (e.status !== 409 || !confirm(e.message + "\n\nAcepta solo si de verdad es otra factura.")) throw e;
                F.pendiente.confirmar_duplicado = true;
                r = await enviar("/api/facturacion/timbrar", "POST", { rfc: F.emisor.rfc, captura: F.pendiente });
            }
            $("dlg-confirmar").close();
            F.ultimo = r;
            if (F.recurrenteId) { api("/api/facturacion/borradores/" + F.recurrenteId + "/recurrente/hecha", { method: "POST" }).then(cargarRecurrentes).catch(function () {}); }
            if (F.tipo === "I") F.emisor.folio_i = parseInt(r.folio, 10) + 1; else F.emisor.folio_e = parseInt(r.folio, 10) + 1;
            if (F.cfg.produccion) F.emisor.timbres = Math.max((F.emisor.timbres || 0) - 1, 0);
            pintarEmisor();
            $("listo-titulo").textContent = (F.tipo === "I" ? "Factura " : "Nota de crédito ") + (r.serie ? r.serie + "-" : "") + r.folio + " timbrada";
            $("listo-texto").textContent = "Total " + dinero(r.total) + (r.pruebas ? " · modo de pruebas (sin validez fiscal)" : r.biblioteca ? " · ya está en Administración de XML" : "");
            $("listo-uuid").textContent = r.uuid;
            $("dlg-listo").showModal();
            var sustituye = F.sustituye;
            nuevaFactura();                 // ya quedó timbrada: el formulario se limpia para no repetirla por error
            irPaso(1);
            await cargarEmitidas();
            cargarReceptores();
            cargarBorradores();
            cargarPendientes();
            if (sustituye) {                // ya está la correcta: sigue cancelar la original con motivo 01
                $("dlg-listo").close();
                abrirCancelar(sustituye);
                $("can-motivo").value = "01"; $("can-sust").value = r.uuid; $("can-sust-caja").hidden = false;
                $("can-error").textContent = "La que la sustituye ya quedó timbrada (" + (r.serie ? r.serie + "-" : "") + r.folio + "). Ahora cancela la original con motivo 01.";
                $("can-error").hidden = false;
            }
        } catch (e) {
            $("dlg-confirmar").close();
            $("t-error").textContent = e.message; $("t-error").hidden = false;
        }
        b.disabled = false; b.textContent = "Timbrar";
    }

    /* Sus clientes (guardados en Mis clientes o al timbrar): al elegirlo o escribir su RFC se llenan sus datos */
    async function cargarReceptores() {
        if (!F.empresa) return;
        try { F.receptores = await json("/api/facturacion/receptores?rfc=" + encodeURIComponent(F.empresa.rfc)); }
        catch (e) { F.receptores = []; }
        var vistos = {};
        var opciones = F.receptores.map(function (r) { vistos[r.rfc] = 1; return '<option value="' + esc((r.clave || r.rfc) + " · " + r.nombre) + '"></option>'; });
        F.emitidas.forEach(function (x) {
            if (!vistos[x.receptor_rfc] && x.receptor_rfc !== "XAXX010101000") { vistos[x.receptor_rfc] = 1; opciones.push('<option value="' + esc(x.receptor_rfc + " · " + x.receptor_nombre) + '"></option>'); }
        });
        $("lista-receptores").innerHTML = opciones.join("");
    }

    function ponerReceptor(r, guardado) {
        F.clienteGuardado = guardado ? { nombre: r.nombre || "", cp: r.cp || "", regimen: r.regimen || "" } : null;
        F.clienteNuevo = false;
        $("r-rfc").value = r.rfc || ""; $("r-nombre").value = r.nombre || ""; $("r-cp").value = r.cp || "";
        if (r.residencia) $("r-pais").value = r.residencia;
        $("r-taxid").value = r.num_reg_id || "";
        verExtranjero();
        if (r.regimen) $("r-regimen").value = r.regimen;
        if (r.uso && !(F.tipo === "E" && r.uso !== "G02")) $("r-uso").value = F.tipo === "E" ? "G02" : r.uso;
        verGlobal();
        pintarCliente();
    }

    /* Selector de cliente: sus clientes guardados (y a quién ya le facturó), con búsqueda */
    function clientesDisponibles() {
        var vistos = {}, lista = F.receptores.map(function (r) { vistos[r.rfc] = 1; return r; });
        F.emitidas.forEach(function (x) {
            if (!vistos[x.receptor_rfc] && x.receptor_rfc !== "XAXX010101000" && x.receptor_rfc !== "XEXX010101000") {
                vistos[x.receptor_rfc] = 1; lista.push({ rfc: x.receptor_rfc, nombre: x.receptor_nombre, previo: x.id });
            }
        });
        return lista;
    }

    function abrirSelector(abrir) {
        var panel = $("sel-cliente-panel");
        panel.hidden = !abrir;
        if (abrir) { $("r-buscar").value = ""; pintarSelector(); setTimeout(function () { $("r-buscar").focus(); }, 30); }
    }

    function pintarSelector() {
        var q = $("r-buscar").value.trim().toLowerCase(), cat = F.cfg.catalogos.regimenes;
        var lista = clientesDisponibles().filter(function (r) { return !q || (r.nombre + " " + r.rfc + " " + (r.num_reg_id || "")).toLowerCase().indexOf(q) !== -1; }).slice(0, 80);
        var rfcQ = q.toUpperCase();
        var nuevo = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfcQ) && !lista.some(function (r) { return r.rfc === rfcQ; });
        $("sel-cliente-lista").innerHTML = (nuevo ? '<button type="button" class="fa-opcion" data-rfc-nuevo="' + esc(rfcQ) + '"><span class="fa-opcion__ini">+</span><span><b>Usar ' + esc(rfcQ) + "</b><small>RFC nuevo: completa sus datos</small></span></button>" : "") +
            (lista.length ? lista.map(function (r, i) {
                return '<button type="button" class="fa-opcion" role="option" data-i="' + i + '"><span class="fa-opcion__ini">' + esc((r.nombre || r.rfc).charAt(0)) + "</span><span><b>" + esc(r.nombre || r.rfc) + "</b><small>" +
                    esc(r.rfc + (r.residencia ? " · " + r.residencia + " " + (r.num_reg_id || "") : "") + (r.cp ? " · C.P. " + r.cp : "") + (r.regimen ? " · " + r.regimen + " " + (cat[r.regimen] || "") : "")) + "</small></span></button>";
            }).join("") : (nuevo ? "" : '<p class="fa-vacio-chico">' + (q ? "Nadie coincide. Escribe el RFC completo para usarlo." : "Todavía no hay receptores guardados.") + "</p>"));
        F.selLista = lista;
    }

    function elegirCliente(r) {
        abrirSelector(false);
        if (r.previo && !r.cp) { quitarCliente(); $("r-rfc").value = r.rfc; llenarReceptor().then(pintarCliente); }
        else ponerReceptor(r, true);
        pintarCliente();
    }

    /* Quitar al cliente de ESTA factura (no lo borra de sus clientes guardados) */
    function quitarCliente() {
        ["r-rfc", "r-nombre", "r-cp", "r-taxid"].forEach(function (id) { $(id).value = ""; });
        $("r-regimen").value = ""; $("r-uso").value = F.tipo === "E" ? "G02" : "G03";
        F.clienteGuardado = null; $("r-actualizar").checked = false;
        verExtranjero(); verGlobal(); pintarCliente();
    }

    function cambioVsGuardado() {
        var g = F.clienteGuardado; if (!g) return false;
        return ($("r-nombre").value.trim().toUpperCase() !== (g.nombre || "").toUpperCase()) || $("r-cp").value.trim() !== (g.cp || "") || $("r-regimen").value !== (g.regimen || "");
    }

    function pintarCliente() {
        var rfc = $("r-rfc").value.trim().toUpperCase(), nombre = $("r-nombre").value.trim().toUpperCase();
        $("cli-tarjeta").hidden = !(rfc || nombre || F.clienteNuevo);
        $("cli-vacio").hidden = !$("cli-tarjeta").hidden;
        $("btn-elegir-texto").textContent = $("cli-tarjeta").hidden ? "Elegir receptor" : "Cambiar receptor";
        $("cli-nombre").textContent = nombre || (rfc ? "Sin nombre" : "Receptor nuevo");
        $("cli-ini").textContent = (nombre || rfc || "+").charAt(0);
        $("cli-origen").textContent = rfc === "XAXX010101000" ? "Público en general" : rfc === "XEXX010101000" ? "Extranjero" : F.clienteGuardado ? "De sus clientes" : rfc ? "Nuevo: se guarda al timbrar" : "";
        $("fila-guardar").hidden = !!F.clienteGuardado || rfc === "XAXX010101000";
        $("fila-actualizar").hidden = !cambioVsGuardado();
        $("t-cliente").textContent = rfc ? (nombre || rfc) + " · " + rfc : "Sin receptor";
    }

    function elegirDelBuscador() { pintarSelector(); }

    async function leerConstancia(archivo) {
        if (!archivo) return;
        var a = $("r-aviso");
        a.hidden = false; a.textContent = "Leyendo la constancia…";
        try {
            var cuerpo = new FormData(); cuerpo.append("archivo", archivo);
            var r = await json("/api/facturacion/leer-constancia", { method: "POST", body: cuerpo });
            abrirSelector(false);
            ponerReceptor({ rfc: r.rfc, nombre: r.nombre, cp: r.cp, regimen: r.regimenes[0] || "" });
            var cat = F.cfg.catalogos.regimenes;
            a.innerHTML = "✓ Datos de su constancia" + (r.regimenes.length > 1
                ? ". Tiene varios regímenes: " + r.regimenes.map(function (k) { return esc(k + " " + (cat[k] || "")); }).join(", ") + "; elige el que corresponda a esta factura."
                : r.regimenes.length ? "." : ". No trae régimen vigente: elígelo.");
            if ($("r-guardar").checked && r.nombre) {
                try {
                    await enviar("/api/facturacion/receptores", "PUT", { rfc_emisor: F.emisor.rfc, rfc: r.rfc, nombre: r.nombre, cp: r.cp, regimen: r.regimenes[0] || null });
                    cargarReceptores();
                    a.innerHTML += " Quedó en sus receptores.";
                } catch (e) { /* se guarda al timbrar */ }
            }
        } catch (e) { a.textContent = e.message; }
        $("r-constancia").value = "";
    }

    async function llenarReceptor() {
        var rfc = $("r-rfc").value.trim().toUpperCase();
        if (rfc === "XAXX010101000") { publico(); return; }
        var guardado = F.receptores.filter(function (x) { return x.rfc === rfc; })[0];
        if (guardado) { if (!$("r-nombre").value) ponerReceptor(guardado, true); return; }
        var previo = F.emitidas.filter(function (x) { return x.receptor_rfc === rfc; })[0];
        if (!previo) return;
        try {
            var d = F.detalles[previo.id] || (F.detalles[previo.id] = await json("/api/facturacion/comprobantes/" + previo.id));
            var r = d.datos.receptor || {};
            if (!$("r-nombre").value) $("r-nombre").value = r.nombre || "";
            if (!$("r-cp").value) $("r-cp").value = r.DomicilioFiscalReceptor || "";
            if (!$("r-regimen").value) $("r-regimen").value = r.RegimenFiscalReceptor || "";
            if (F.tipo === "I" && r.UsoCFDI && r.UsoCFDI !== "G02") $("r-uso").value = r.UsoCFDI;
        } catch (e) { /* sin datos previos */ }
    }

    function verGlobal() {
        $("caja-global").hidden = !(F.tipo === "I" && $("r-rfc").value.trim().toUpperCase() === "XAXX010101000");
    }

    function publico() {
        $("r-rfc").value = "XAXX010101000";
        $("r-nombre").value = "PUBLICO EN GENERAL";
        $("r-cp").value = F.emisor && F.emisor.cp || "";
        $("r-regimen").value = "616";
        $("r-uso").value = "S01";
        verGlobal(); verExtranjero(); pintarCliente();
        if (F.tipo === "I") $("p-nota").textContent = "Público en general: en el paso 2 elige el periodo de la factura global.";
    }

    /* ---------------------------------------------------- emitidas */
    async function cargarEmitidas() {
        if (!F.empresa) return;
        try { F.emitidas = await json("/api/facturacion/comprobantes?rfc=" + encodeURIComponent(F.empresa.rfc)); }
        catch (e) { F.emitidas = []; $("filas-emitidas").innerHTML = '<tr><td colspan="6">' + esc(e.message) + "</td></tr>"; return; }
        cargarReceptores();
        $("lista-facturas").innerHTML = F.emitidas.filter(function (x) { return x.tipo !== "P" && x.estado !== "cancelado"; })
            .map(function (x) { return '<option value="' + esc(x.uuid) + '">' + esc((x.serie ? x.serie + "-" : "") + x.folio + " · " + x.receptor_nombre + " · " + dinero(x.total)) + "</option>"; }).join("");
        pintarEmitidas();
    }

    function pintarEmitidas() {
        var q = $("buscar-emitidas").value.trim().toLowerCase(), f = $("filtro-tipo").value;
        var filas = F.emitidas.filter(function (x) {
            if (f === "cancelado" ? x.estado !== "cancelado" : f && x.tipo !== f) return false;
            return !q || [x.receptor_nombre, x.receptor_rfc, (x.serie || "") + x.folio, (x.serie || "") + "-" + x.folio, x.uuid].join(" ").toLowerCase().indexOf(q) !== -1;
        });
        F.emitVisibles = filas.map(function (x) { return x.id; });
        F.selEmit = F.selEmit || {};
        $("filas-emitidas").innerHTML = filas.length ? filas.map(function (x) {
            var estado = x.estado === "cancelado" ? '<span class="fa-chip fa-chip--mal">Cancelada</span>'
                : x.estado === "cancelando" ? '<span class="fa-chip fa-chip--proceso" title="Se pidió la cancelación; el SAT la está procesando">Cancelación en proceso</span>'
                : '<span class="fa-chip fa-chip--ok">Vigente</span>';
            if (x.pruebas) estado += ' <span class="fa-chip fa-chip--prueba">Prueba</span>';
            var mas = [
                ["correo", "Mandar por correo"], ["whatsapp", "Mandar por WhatsApp"],
                x.tipo !== "P" ? ["copiar", "Copiar (una nueva igual)"] : null,
                x.saldo > 0.004 && x.estado === "timbrado" ? ["pago", "Registrar un pago"] : null,
                x.pruebas ? null : ["sat", "Revisar en el SAT"],
                x.hay_acuse ? ["acuse", "Acuse de cancelación"] : null,
                x.estado === "timbrado" ? ["cancelar", "Cancelar", true] : null
            ].filter(Boolean);
            return '<tr data-id="' + esc(x.id) + '"' + (F.selEmit[x.id] ? ' class="fa-fila-sel"' : "") + '><td class="fa-col-check"><input type="checkbox" data-sel' + (F.selEmit[x.id] ? " checked" : "") + "></td><td>" + esc(fechaCorta(x.fecha)) + "</td>" +
                "<td><b>" + esc((x.serie ? x.serie + "-" : "") + x.folio) + "</b><small>" + ({ I: "Factura", E: "Nota de crédito", P: "Recibo de pago" }[x.tipo] || "") + (x.metodo === "PPD" ? " · PPD" : "") + "</small></td>" +
                "<td>" + esc(x.receptor_nombre) + "<small>" + esc(x.receptor_rfc) + "</small></td>" +
                '<td class="fa-num">' + dinero(x.total) + (x.moneda === "USD" ? " <small>USD</small>" : "") +
                (x.saldo != null && x.estado !== "cancelado" ? (x.saldo > 0.004 ? '<span class="fa-saldo">Saldo ' + dinero(x.saldo) + "</span>" : '<span class="fa-saldo fa-saldo--ok">Pagada</span>') : "") +
                "</td><td>" + estado + "</td>" +
                '<td class="fa-acc"><div class="fa-acc__caja">' +
                '<button type="button" class="fa-acc-btn" data-acc="pdf" title="Ver el PDF"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2.5 12C4 7.5 7.7 5 12 5s8 2.5 9.5 7c-1.5 4.5-5.2 7-9.5 7s-8-2.5-9.5-7z"/><circle cx="12" cy="12" r="3"/></svg>PDF</button>' +
                '<button type="button" class="fa-acc-btn" data-acc="xml" title="Descargar el XML"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>XML</button>' +
                '<div class="fa-mas"><button type="button" class="fa-acc-btn fa-acc-btn--mas" data-menu aria-label="Más acciones" title="Más acciones">⋯</button>' +
                '<div class="fa-mas__menu" hidden>' + mas.map(function (m) { return '<button type="button" data-acc="' + m[0] + '"' + (m[2] ? ' class="fa-mas__rojo"' : "") + ">" + m[1] + "</button>"; }).join("") + "</div></div>" +
                "</div></td></tr>";
        }).join("") : '<tr><td colspan="7">' + (F.emitidas.length ? "Nada coincide." : "Todavía no hay facturas de esta empresa.") + "</td></tr>";
        pintarSeleccion();
    }

    function pintarSeleccion() {
        var ids = Object.keys(F.selEmit || {}), n = ids.length;
        $("sel-emitidas").hidden = !n;
        $("sel-cuenta").textContent = n + (n === 1 ? " marcada" : " marcadas");
        var vis = F.emitVisibles || [];
        $("sel-todas").checked = vis.length > 0 && vis.every(function (id) { return F.selEmit[id]; });
        $("sel-todas").indeterminate = !$("sel-todas").checked && vis.some(function (id) { return F.selEmit[id]; });
    }

    async function bajarZip() {
        var ids = Object.keys(F.selEmit || {}), b = $("btn-zip");
        if (!ids.length) return;
        b.disabled = true; b.textContent = "Preparando ZIP…";
        try {
            var resp = await api("/api/facturacion/comprobantes/zip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ids, contenido: $("sel-contenido").value }) });
            var m = /filename="?([^";]+)"?/i.exec(resp.headers.get("Content-Disposition") || "");
            Fiscontable.guardarArchivo(await resp.blob(), m ? m[1] : "Facturas.zip");
        } catch (e) { aviso(e.message, "error"); }
        b.disabled = false; b.textContent = "Descargar ZIP";
    }

    async function bajarXml(id) {
        try {
            var resp = await api("/api/facturacion/comprobantes/" + id + "/xml");
            var m = /filename="?([^";]+)"?/i.exec(resp.headers.get("Content-Disposition") || "");
            var x = F.emitidas.filter(function (e) { return e.id === id; })[0];
            var nombre = m ? m[1] : x ? x.rfc_emisor + "_" + (x.serie || "") + x.folio + "_" + x.uuid + ".xml" : "factura.xml";
            Fiscontable.guardarArchivo(await resp.blob(), nombre);
        } catch (e) { aviso(e.message, "error"); }
    }

    async function bajarAcuse(id) {
        try {
            var resp = await api("/api/facturacion/comprobantes/" + id + "/acuse");
            var x = F.emitidas.filter(function (e) { return e.id === id; })[0];
            Fiscontable.guardarArchivo(await resp.blob(), "Acuse_cancelacion_" + (x ? (x.serie || "") + x.folio : id) + ".xml");
        } catch (e) { aviso(e.message, "error"); }
    }

    async function verPdf(id) {
        try {
            var x = F.emitidas.filter(function (e) { return e.id === id; })[0];
            var resp = await api("/api/facturacion/comprobantes/" + id + "/pdf");
            var m = /filename="?([^";]+)"?/i.exec(resp.headers.get("Content-Disposition") || "");
            Fiscontable.verPdf(await resp.blob(), { titulo: x ? ({ I: "Factura ", E: "Nota de crédito ", P: "Recibo de pago " }[x.tipo] || "") + (x.serie ? x.serie + "-" : "") + x.folio + " · " + x.receptor_nombre : "Comprobante",
                                                   nombre: m ? m[1] : "comprobante.pdf" });
        } catch (e) { aviso(e.message, "error"); }
    }

    async function revisarSat(id, boton) {
        if (boton) { boton.disabled = true; boton.textContent = "…"; }
        try {
            var r = await json("/api/facturacion/comprobantes/" + id + "/estado-sat", { method: "POST" });
            var x = F.emitidas.filter(function (e) { return e.id === id; })[0];
            aviso((x ? (x.serie ? x.serie + "-" : "") + x.folio + ": " : "") + "en el SAT está " + r.estado.toLowerCase() +
                  (r.estatus_cancelacion ? " (" + r.estatus_cancelacion.toLowerCase() + ")" : "") + (r.es_cancelable && r.estado === "Vigente" ? " · " + r.es_cancelable : "") + ".");
            await cargarEmitidas();
        } catch (e) { aviso(e.message, "error"); if (boton) { boton.disabled = false; boton.textContent = "SAT"; } }
    }

    function abrirCancelar(id) {
        var x = F.emitidas.filter(function (e) { return e.id === id; })[0];
        if (!x) return;
        F.cancelando = x;
        $("can-folio").textContent = (x.serie ? x.serie + "-" : "") + x.folio;
        $("can-motivo").value = "02";
        $("can-sust").value = "";
        $("can-sust-caja").hidden = true;
        $("can-error").hidden = true;
        $("dlg-cancelar").showModal();
    }

    async function cancelar() {
        var b = $("btn-cancelar-ok");
        if (b.disabled) return;
        b.disabled = true; b.textContent = "Cancelando…";
        try {
            var r = await enviar("/api/facturacion/comprobantes/" + F.cancelando.id + "/cancelar", "POST",
                { motivo: $("can-motivo").value, uuid_sustitucion: $("can-sust").value.trim() || null });
            $("dlg-cancelar").close();
            aviso($("can-folio").textContent + ": " + r.mensaje + (r.acuse ? " El acuse queda en Emitidas." : ""), r.pendiente ? "alerta" : "");
            cargarEmitidas();
        } catch (e) { $("can-error").textContent = e.message; $("can-error").hidden = false; cargarEmitidas(); }
        b.disabled = false; b.textContent = "Cancelar ante el SAT";
    }

    /* ---------------------------------------------------- CFDI relacionados */
    function nombreDe(uuid) {
        var x = F.emitidas.filter(function (e) { return e.uuid === uuid; })[0];
        return x ? (x.serie ? x.serie + "-" : "") + x.folio : "";
    }

    function verRelaciones() {
        var forzado = F.tipo === "E";
        if (forzado) $("rel-activar").checked = true;
        $("rel-activar").disabled = forzado;
        $("rel-obligatorio").textContent = forzado ? "Obligatorio en notas de crédito" : $("rel-activar").checked ? "Activado" : "Agregar";
        $("rel-explica").textContent = forzado ? "La nota de crédito se relaciona con la factura que corrige (tipo 01)."
            : "Solo si sustituye a otra (04), aplica un anticipo (07) u otra relación. Apagado no se manda nada.";
        $("rel-cuerpo").hidden = !$("rel-activar").checked;
    }

    function pintarRelaciones() {
        var cat = F.cfg.catalogos.tipos_relacion;
        $("rel-lista").innerHTML = F.relaciones.map(function (g, i) {
            return '<div class="fa-rel" data-g="' + i + '"><b>' + esc(g.tipo_relacion + " · " + (cat[g.tipo_relacion] || "")) + '</b><div class="fa-rel__uuids">' +
                g.uuids.map(function (u, j) { var n = nombreDe(u); return "<span>" + (n ? "<b>" + esc(n) + "</b> " : "") + esc(u) + ' <button type="button" data-quitar-rel="' + i + ":" + j + '" title="Quitar">✕</button></span>'; }).join("") +
                "</div></div>";
        }).join("");
        var tipos = F.relaciones.map(function (g) { return g.tipo_relacion; });
        $("rel-nota").textContent = tipos.indexOf("07") !== -1 && F.tipo === "I"
            ? "Anticipo: esta es la factura del total. Después timbra una nota de crédito por el anticipo, relación 07 a esta factura, forma de pago 30 «Aplicación de anticipos»."
            : tipos.indexOf("04") !== -1 ? "Sustitución: después cancela la original con motivo 01 y el folio fiscal de esta." : "";
    }

    function agregarRelacion() {
        var texto = $("rel-uuid").value.trim(), tipo = $("rel-tipo").value;
        var m = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/.exec(texto);
        if (!m) { $("rel-nota").textContent = "Elige una factura de la lista o pega su folio fiscal (UUID)."; return; }
        var uuid = m[0].toUpperCase(), g = F.relaciones.filter(function (x) { return x.tipo_relacion === tipo; })[0];
        if (!g) { g = { tipo_relacion: tipo, uuids: [] }; F.relaciones.push(g); }
        if (g.uuids.indexOf(uuid) === -1) g.uuids.push(uuid);
        $("rel-uuid").value = "";
        pintarRelaciones();
    }

    function aplicarAnticipo() {
        $("rel-tipo").value = "07";
        $("rel-uuid").focus();
        $("rel-nota").textContent = "Elige la factura del anticipo (clave 84111506) y da «Agregar»: esta factura del total queda relacionada 07.";
    }

    function verExtranjero() {
        var ext = $("r-rfc").value.trim().toUpperCase() === "XEXX010101000";
        $("caja-extranjero").hidden = !ext;
    }

    function extranjero() {
        $("r-rfc").value = "XEXX010101000";
        if ($("r-nombre").value === "PUBLICO EN GENERAL") $("r-nombre").value = "";
        $("r-cp").value = F.emisor && F.emisor.cp || "";
        $("r-regimen").value = "616";
        $("r-uso").value = "S01";
        F.clienteGuardado = null; F.clienteNuevo = true;
        verExtranjero(); verGlobal(); pintarCliente();
        $("r-nombre").focus();
    }

    /* ---------------------------------------------------- complemento de pago (Pagos) */
    async function cargarPendientes() {
        if (!F.empresa) return;
        try { F.pendientes = await json("/api/facturacion/pagos/pendientes?rfc=" + encodeURIComponent(F.empresa.rfc)); }
        catch (e) { F.pendientes = []; }
        $("n-pendientes").textContent = F.pendientes.length;
        $("n-pendientes").hidden = !F.pendientes.length;
        Object.keys(F.pgSel).forEach(function (u) { if (!F.pendientes.some(function (x) { return x.uuid === u; })) delete F.pgSel[u]; });
        if (!$("pg-fecha").value) $("pg-fecha").value = fechaLocal(new Date());
        $("pg-fecha").max = fechaLocal(new Date());
        pintarPendientes();
    }

    function receptorSel() {
        var u = Object.keys(F.pgSel)[0], x = F.pendientes.filter(function (p) { return p.uuid === u; })[0];
        return x ? x.receptor.rfc : null;
    }

    function equivalencia(x) {
        var mp = $("pg-moneda").value, tc = num($("pg-tc").value);
        if (x.moneda === mp) return 1;
        if (x.moneda === "USD" && mp === "MXN") return tc ? 1 / tc : 0;
        if (x.moneda === "MXN" && mp === "USD") return tc || 0;
        return 0;
    }

    function pintarPendientes() {
        var q = $("pg-buscar").value.trim().toLowerCase(), rsel = receptorSel();
        var filas = F.pendientes.filter(function (x) {
            return !q || [x.receptor.nombre, x.receptor.rfc, x.serie_folio].join(" ").toLowerCase().indexOf(q) !== -1;
        });
        $("pg-lista").innerHTML = filas.length ? filas.map(function (x) {
            var sel = F.pgSel[x.uuid] != null, otro = rsel && rsel !== x.receptor.rfc;
            return '<div class="fa-pg' + (sel ? " fa-pg--sel" : "") + '" data-uuid="' + esc(x.uuid) + '"' + (otro ? ' style="opacity:.45"' : "") + ">" +
                '<input type="checkbox" data-pg-sel' + (sel ? " checked" : "") + (otro ? ' disabled title="Un recibo de pago es de un solo receptor"' : "") + ">" +
                '<div class="fa-item__txt"><b>' + esc(x.serie_folio + " · " + x.receptor.nombre) + "</b><small>" +
                esc(fechaCorta(x.fecha) + " · total " + dinero(x.total) + (x.moneda === "USD" ? " USD" : "") + (x.pagado ? " · pagado " + dinero(x.pagado) : "") + " · parcialidad " + x.parcialidad) + "</small></div>" +
                '<div class="fa-pg__abono"><small>Saldo ' + dinero(x.saldo) + '</small><input data-pg-monto inputmode="decimal" value="' + esc(sel ? F.pgSel[x.uuid] : "") + '" placeholder="' + esc(x.saldo.toFixed(2)) + '"' + (sel ? "" : " disabled") + "></div></div>";
        }).join("") : '<p class="fa-vacio-chico">' + (F.pendientes.length ? "Nada coincide." : "No hay facturas PPD pendientes de pago. Las facturas a crédito se timbran con método PPD y forma 99.") + "</p>";
        resumenPago();
    }

    function resumenPago() {
        var mp = $("pg-moneda").value, total = 0, n = 0, faltaEq = false, lineas = [];
        $("pg-caja-tc").hidden = mp === "MXN" && !Object.keys(F.pgSel).some(function (u) { var x = F.pendientes.filter(function (p) { return p.uuid === u; })[0]; return x && x.moneda !== "MXN"; });
        Object.keys(F.pgSel).forEach(function (u) {
            var x = F.pendientes.filter(function (p) { return p.uuid === u; })[0]; if (!x) return;
            var abono = num(F.pgSel[u] === "" ? x.saldo : F.pgSel[u]), eq = equivalencia(x);
            if (!eq) faltaEq = true; else total += abono / eq;
            n++; lineas.push(esc(x.serie_folio) + ": " + dinero(abono) + (x.moneda !== mp ? " " + x.moneda : ""));
        });
        $("pg-resumen").innerHTML = n ? lineas.join("<br>") + '<br><b style="font-size:17px;color:rgb(var(--g-900))">Pago: ' + dinero(r2(total)) + " " + mp + "</b>" +
            (faltaEq ? '<br><span style="color:rgb(var(--er-600))">Escribe el tipo de cambio del día del pago.</span>' : "") : "Marca al menos una factura.";
        $("btn-pg-timbrar").disabled = !n || faltaEq;
        $("pg-folio").textContent = F.emisor ? "Será el recibo " + (F.emisor.serie_p || "P") + "-" + (F.emisor.folio_p || 1) + "." : "";
    }

    /* Si el pago o alguna factura es en dólares, trae el FIX de Banxico del día del pago (se puede cambiar) */
    function tcDelPago() {
        var mp = $("pg-moneda").value;
        var hace = mp !== "MXN" || Object.keys(F.pgSel).some(function (u) { var x = F.pendientes.filter(function (p) { return p.uuid === u; })[0]; return x && x.moneda !== mp; });
        if (!hace || $("pg-tc").value) return;
        json("/api/facturacion/tipo-cambio?fecha=" + ($("pg-fecha").value || hoyLocal()).slice(0, 10)).then(function (r) {
            if (r.valor && !$("pg-tc").value) { $("pg-tc").value = r.valor; resumenPago(); }
        }).catch(function () {});
    }

    function pagoCaptura() {
        return { clave_envio: F.pgClave || (F.pgClave = nuevaClave()), fecha: $("pg-fecha").value, forma_pago: $("pg-forma").value,
                 moneda: $("pg-moneda").value, tipo_cambio: $("pg-tc").value.trim() || null, num_operacion: $("pg-operacion").value.trim() || null,
                 monto: $("pg-monto").value.trim() || null,
                 doctos: Object.keys(F.pgSel).map(function (u) {
                     var x = F.pendientes.filter(function (p) { return p.uuid === u; })[0];
                     return { uuid: u, pagado: F.pgSel[u] === "" ? x.saldo : F.pgSel[u], equivalencia: equivalencia(x) };
                 }) };
    }

    async function prepararPago() {
        if (faltaManifiesto()) return;
        var err = $("pg-error"); err.hidden = true;
        try {
            var cap = pagoCaptura();
            var r = await enviar("/api/facturacion/pagos/revisar", "POST", { rfc: F.emisor.rfc, pago: cap });
            F.pendientePago = cap; F.confirmando = "pago";
            $("conf-titulo").textContent = "¿Timbrar el recibo de pago?";
            $("conf-resumen").innerHTML = '<dl class="fa-resumen"><dt>Folio</dt><dd>' + esc(r.serie + "-" + r.folio) + "</dd><dt>Receptor</dt><dd>" + esc(r.receptor_nombre + " · " + r.receptor_rfc) +
                "</dd><dt>Fecha del pago</dt><dd>" + esc(cap.fecha.replace("T", " ")) + "</dd><dt>Pago</dt><dd>" + dinero(r.monto) + " " + esc(r.moneda) + "</dd>" +
                r.doctos.map(function (d) { var x = F.pendientes.filter(function (p) { return p.uuid === d.uuid; })[0]; return "<dt>" + esc(x ? x.serie_folio : d.uuid.slice(0, 8)) + "</dt><dd>parcialidad " + d.parcialidad + " · " + dinero(d.pagado) + " · queda " + dinero(d.saldo_insoluto) + "</dd>"; }).join("") + "</dl>";
            $("conf-nota").textContent = F.cfg.produccion ? "Se manda al SAT y gasta 1 timbre de la empresa." : "Modo de pruebas: no gasta timbres ni tiene validez fiscal.";
            $("dlg-confirmar").showModal();
        } catch (e) { err.textContent = e.message; err.hidden = false; }
    }

    async function timbrarPago() {
        var b = $("btn-confirmar");
        if (b.disabled) return;
        b.disabled = true; b.textContent = "Timbrando…";
        try {
            var r = await enviar("/api/facturacion/pagos/timbrar", "POST", { rfc: F.emisor.rfc, pago: F.pendientePago });
            $("dlg-confirmar").close();
            F.ultimo = r; F.pgSel = {}; F.pgClave = null; F.confirmando = null;
            F.emisor.folio_p = parseInt(r.folio, 10) + 1;
            if (F.cfg.produccion) F.emisor.timbres = Math.max((F.emisor.timbres || 0) - 1, 0);
            pintarEmisor();
            ["pg-operacion", "pg-monto"].forEach(function (id) { $(id).value = ""; });
            $("listo-titulo").textContent = "Recibo de pago " + r.serie + "-" + r.folio + " timbrado";
            $("listo-texto").textContent = "Pago " + dinero(r.total) + (r.pruebas ? " · modo de pruebas (sin validez fiscal)" : "");
            $("listo-uuid").textContent = r.uuid;
            $("dlg-listo").showModal();
            await cargarEmitidas();
            cargarPendientes();
        } catch (e) { $("dlg-confirmar").close(); $("pg-error").textContent = e.message; $("pg-error").hidden = false; }
        F.confirmando = null;
        b.disabled = false; b.textContent = "Timbrar";
    }

    /* ---------------------------------------------------- correo y WhatsApp */
    var PROVEEDORES = { gmail: ["smtp.gmail.com", 587, "(en Gmail: «contraseña de aplicación», no la normal)"], outlook: ["smtp.office365.com", 587, "(la de tu cuenta de Outlook)"],
                        zoho: ["smtp.zoho.com", 587, "(o una contraseña de aplicación de Zoho)"], otro: ["", 587, "(la que te dio tu proveedor de correo)"] };

    async function cargarCorreo() {
        try { F.correo = await json("/api/facturacion/correo"); } catch (e) { $("msj-correo").textContent = e.message; return; }
        var c = F.correo;
        ponerModoCorreo(c.modo);
        $("c-correo-sistema").textContent = c.sistema ? "Sale de " + c.sistema + " y te responden a ti" : "Todavía no está configurado en el servidor";
        document.querySelector('[data-modo-correo="fiscontable"]').disabled = !c.sistema;
        $("c-smtp-host").value = c.smtp_host; $("c-smtp-puerto").value = c.smtp_puerto; $("c-smtp-usuario").value = c.smtp_usuario;
        $("c-smtp-clave").value = ""; $("c-smtp-clave").placeholder = c.clave_guardada ? "Guardada (escribe otra para cambiarla)" : "••••••••";
        $("c-proveedor").value = /gmail/.test(c.smtp_host) ? "gmail" : /office365|outlook/.test(c.smtp_host) ? "outlook" : /zoho/.test(c.smtp_host) ? "zoho" : c.smtp_host ? "otro" : "gmail";
        if (!c.smtp_host) ponerProveedor();
        $("c-correo-nombre").value = c.remitente_nombre || (F.emisor && (F.emisor.razon_social || F.emisor.alias)) || "";
        $("c-correo-responder").value = c.responder_a; $("c-correo-cc").value = c.cc;
        $("c-correo-asunto").value = c.asunto; $("c-correo-cuerpo").value = c.cuerpo;
        $("c-correo-pdf").checked = c.adjuntar_pdf; $("c-correo-xml").checked = c.adjuntar_xml; $("c-correo-enlace").checked = c.con_enlace; $("c-correo-auto").checked = c.al_timbrar;
        $("c-correo-vars").innerHTML = "Puedes usar: " + Object.keys(c.variables).map(function (k) { return "<b>{" + esc(k) + "}</b> " + esc(c.variables[k]); }).join(" · ");
        var listo = c.modo === "fiscontable" ? !!c.sistema : !!(c.smtp_host && c.smtp_usuario && c.clave_guardada);
        $("c-correo-estado").textContent = listo ? "Listo" : "Sin configurar";
        $("c-correo-estado").className = "fa-chip " + (listo ? "fa-chip--ok" : "fa-chip--gris");
    }

    function ponerModoCorreo(modo) {
        F.modoCorreo = modo;
        document.querySelectorAll("[data-modo-correo]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.modoCorreo === modo)); });
        $("c-smtp").hidden = modo !== "propio";
    }

    function ponerProveedor() {
        var p = PROVEEDORES[$("c-proveedor").value];
        if (p[0]) $("c-smtp-host").value = p[0];
        $("c-smtp-puerto").value = p[1];
        $("c-smtp-ayuda").textContent = p[2];
    }

    async function guardarCorreo() {
        $("msj-correo").textContent = "Guardando…";
        try {
            var puerto = parseInt($("c-smtp-puerto").value, 10) || 587;
            F.correo = await enviar("/api/facturacion/correo", "PUT", {
                modo: F.modoCorreo, smtp_host: $("c-smtp-host").value.trim(), smtp_puerto: puerto, smtp_usuario: $("c-smtp-usuario").value.trim(),
                smtp_clave: $("c-smtp-clave").value || null, smtp_seguridad: puerto === 465 ? "ssl" : "starttls",
                remitente: $("c-smtp-usuario").value.trim(), remitente_nombre: $("c-correo-nombre").value.trim(), responder_a: $("c-correo-responder").value.trim(),
                cc: $("c-correo-cc").value.trim(), asunto: $("c-correo-asunto").value.trim(), cuerpo: $("c-correo-cuerpo").value,
                adjuntar_pdf: $("c-correo-pdf").checked, adjuntar_xml: $("c-correo-xml").checked, con_enlace: $("c-correo-enlace").checked, al_timbrar: $("c-correo-auto").checked });
            await cargarCorreo();
            $("msj-correo").textContent = "✓ Guardado. Manda una prueba para confirmar.";
        } catch (e) { $("msj-correo").textContent = e.message; }
    }

    async function probarCorreo() {
        var para = $("c-correo-prueba").value.trim() || $("c-correo-responder").value.trim();
        if (!para) { $("msj-correo").textContent = "Escribe a qué correo mandar la prueba."; return; }
        $("msj-correo").textContent = "Mandando prueba…";
        try { await enviar("/api/facturacion/correo/probar", "POST", { para: para }); $("msj-correo").textContent = "✓ Se mandó a " + para + ". Revisa la bandeja (y spam)."; }
        catch (e) { $("msj-correo").textContent = e.message; }
    }

    async function abrirCorreo(id) {
        var x = F.emitidas.filter(function (e) { return e.id === id; })[0];
        F.coId = id;
        $("co-folio").textContent = x ? (x.serie ? x.serie + "-" : "") + x.folio : "";
        $("co-error").hidden = true;
        try {
            var b = await json("/api/facturacion/comprobantes/" + id + "/correo");
            $("co-para").value = b.para; $("co-cc").value = b.cc; $("co-asunto").value = b.asunto; $("co-cuerpo").value = b.cuerpo;
            $("co-pdf").checked = b.adjuntar_pdf; $("co-xml").checked = b.adjuntar_xml; $("co-enlace").checked = b.con_enlace; $("co-zip").checked = false;
            $("co-historial").innerHTML = b.envios.length ? "<b>Envíos:</b> " + b.envios.map(function (e) {
                return esc(fechaCorta(e.cuando + "Z") + " · " + e.canal + (e.para ? " a " + e.para : "") + " · " + (e.estado === "ok" ? "✓" : "✗ " + (e.detalle || "")));
            }).join("<br>") : "";
            $("dlg-correo").showModal();
            if (!b.para) $("co-para").focus();
        } catch (e) { aviso(e.message, "error"); }
    }

    async function mandarCorreo() {
        var b = $("btn-co-enviar");
        if (b.disabled) return;
        b.disabled = true; b.textContent = "Mandando…"; $("co-error").hidden = true;
        try {
            var r = await enviar("/api/facturacion/comprobantes/" + F.coId + "/enviar", "POST", {
                para: $("co-para").value, cc: $("co-cc").value, asunto: $("co-asunto").value, cuerpo: $("co-cuerpo").value,
                adjuntar_pdf: $("co-pdf").checked, adjuntar_xml: $("co-xml").checked, adjuntar_zip: $("co-zip").checked, con_enlace: $("co-enlace").checked, guardar_correo: $("co-guardar").checked });
            $("dlg-correo").close();
            aviso("✓ " + $("co-folio").textContent + " se mandó a " + r.para.join(", ") + ".");
            cargarReceptores();
        } catch (e) { $("co-error").textContent = e.message; $("co-error").hidden = false; }
        b.disabled = false; b.textContent = "Mandar";
    }

    async function abrirWhatsapp(id, nuevo) {
        var x = F.emitidas.filter(function (e) { return e.id === id; })[0];
        F.waId = id;
        $("wa-folio").textContent = x ? (x.serie ? x.serie + "-" : "") + x.folio : "";
        $("wa-error").hidden = true;
        try {
            var r = await json("/api/facturacion/comprobantes/" + id + "/enlace" + (nuevo ? "?nuevo=true" : ""), { method: "POST" });
            if (!nuevo || !$("wa-tel").value) $("wa-tel").value = r.telefono || "";
            $("wa-texto").value = r.mensaje; $("wa-url").textContent = r.url;
            if (!$("dlg-whatsapp").open) $("dlg-whatsapp").showModal();
        } catch (e) { aviso(e.message, "error"); }
    }

    function abrirWa() {
        var tel = $("wa-tel").value.replace(/[^\d]/g, "");
        if (tel.length === 10) tel = "52" + tel;
        window.open("https://wa.me/" + tel + "?text=" + encodeURIComponent($("wa-texto").value), "_blank", "noopener");
        var x = F.emitidas.filter(function (e) { return e.id === F.waId; })[0];
        var r = x && F.receptores.filter(function (c) { return c.rfc === x.receptor_rfc && c.clave === c.rfc; })[0];
        if (r && tel && ("+" + tel) !== r.telefono) {               // el número queda en sus clientes para la próxima
            enviar("/api/facturacion/receptores", "PUT", Object.assign({}, r, { rfc_emisor: F.emisor.rfc, telefono: "+" + tel })).then(cargarReceptores).catch(function () {});
        }
    }

    /* ---------------------------------------------------- moneda y fecha */
    function verMoneda() {
        var usd = $("p-moneda").value === "USD";
        $("caja-tc").hidden = !usd;
        if (usd && !F.tcManual && !$("p-tc").value) traerTipoCambio();
        calcular();
    }

    async function traerTipoCambio() {
        var dia = ($("p-fecha").value || hoyLocal()).slice(0, 10);
        try {
            var r = await json("/api/facturacion/tipo-cambio?fecha=" + dia);
            if (F.tcManual) return;
            if (r.valor) { $("p-tc").value = r.valor; $("p-nota").textContent = "Tipo de cambio: FIX de Banxico del " + fechaCorta(r.fecha + "T12:00:00") + " (publicado en el DOF). Puedes cambiarlo."; }
            else $("p-nota").textContent = r.motivo || "";
        } catch (e) { $("p-nota").textContent = "No se pudo traer el tipo de cambio: escríbelo."; }
    }

    function verFecha() {
        var ahora = new Date(), min = new Date(ahora.getTime() - 71 * 3600000);
        var local = function (d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
        $("p-fecha").max = local(ahora); $("p-fecha").min = local(min);
        $("p-nota-fecha").textContent = F.notaFecha || ($("p-fecha").value ? "Elegida: el SAT acepta hasta 72 horas atrás." : "Vacía: la hora en que timbres (o elige una de hasta 72 h atrás).");
    }

    /* ---------------------------------------------------- configuración (sub-pestañas, ventana sobre el módulo) */
    function ponerSub(sub) {
        F.sub = sub;
        document.querySelectorAll("[data-sub]").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.sub === sub)); });
        document.querySelectorAll("[data-subpanel]").forEach(function (p) { p.hidden = p.dataset.subpanel !== sub; });
        if (sub === "correo" && !F.correo) cargarCorreo();
        if (sub === "manifiesto") cargarManifiesto();
        if (!F.incrustado) Fiscontable.url({ sub: sub === "emisor" ? null : sub });
    }

    function abrirConfig(sub) {
        if (Fiscontable.abrirConfiguracion) Fiscontable.abrirConfiguracion("facturacion", sub || (F.emisor && !F.emisor.csd ? "sello" : null));
        else { vista("config"); if (sub) ponerSub(sub); }
    }

    async function recargarConfig() {
        try { F.cfg = await json("/api/facturacion/config"); } catch (e) { return; }
        elegirEmpresa();
    }

    function configListo() {
        if (F.incrustado && window.parent !== window) window.parent.postMessage({ fiscontable: "config-listo", seccion: "facturacion" }, location.origin);
        else vista("nueva");
    }

    /* ---------------------------------------------------- tarjeta «Activar facturación» (4 requisitos)
       Se ve mientras falte algo y vuelve sola si el sello está por vencer (30 días) o se acaban los timbres. */
    var LUNA_URL = "https://firmamanifiesto.lunasoft.net/";
    function diasPara(fecha) { return fecha ? Math.ceil((new Date(fecha + "T12:00:00") - new Date()) / 864e5) : null; }
    function fechaLarga(fecha) { return fecha ? fechaCorta(fecha.slice(0, 10) + "T12:00:00") : ""; }

    function requisitos() {
        var e = F.emisor, prod = F.cfg.produccion, cat = F.cfg.catalogos.regimenes;
        var dias = e.csd ? diasPara(e.csd.vence) : null, t = e.timbres || 0;
        var sello = !e.csd ? { estado: "falta", detalle: "Sube el .cer y el .key del sello digital (no los de la e.firma) y su contraseña." }
            : dias != null && dias < 0 ? { estado: "falta", detalle: "Venció el " + fechaLarga(e.csd.vence) + ". Tramita uno nuevo en CertiSAT y súbelo aquí.", boton: "Subir el nuevo" }
            : dias != null && dias <= 30 ? { estado: "aviso", detalle: "Vence en " + dias + " día" + (dias === 1 ? "" : "s") + " (" + fechaLarga(e.csd.vence) + "). Tramita el nuevo en CertiSAT y súbelo aquí.", boton: "Subir el nuevo" }
            : { estado: "ok", detalle: "Certificado " + (e.csd.no || "") + (e.csd.vence ? " · vence el " + fechaLarga(e.csd.vence) : "") };
        return [
            { id: "datos", titulo: "Datos fiscales", estado: e.regimen && e.cp ? "ok" : "falta",
              detalle: e.regimen && e.cp ? "Régimen " + e.regimen + " " + (cat[e.regimen] || "") + " · C.P. " + e.cp : "Régimen fiscal y código postal, como vienen en su constancia." },
            Object.assign({ id: "sello", titulo: "Sello digital (CSD)" }, sello),
            { id: "manifiesto", titulo: "Manifiesto del PAC", estado: e.manifiesto ? "ok" : prod ? "falta" : "pendiente",
              detalle: e.manifiesto ? "Firmado y guardado." : "Se firma una sola vez en la página de Luna Soft con la e.firma de la empresa; luego subes aquí el PDF." },
            { id: "timbres", titulo: "Timbres", estado: !prod ? "pendiente" : t > 0 ? "ok" : "falta",
              detalle: !prod ? "En modo de pruebas no se gastan timbres." : t > 0 ? t + " disponible" + (t === 1 ? "" : "s") + " para esta empresa." : "Esta empresa ya no tiene timbres: pásale de tu cuenta." }
        ];
    }

    /* Sin lo necesario para timbrar no se deja capturar: antes se llenaba toda la factura y el error salía al final.
       Producción: todo lo que falte (datos, sello, manifiesto, timbres). Pruebas: solo los datos fiscales (lo demás
       lo pone el SAT de prueba). Aplica a la factura nueva y al recibo de pago. */
    function minus(t) { return t.charAt(0).toLowerCase() + t.slice(1); }      // «sello digital (CSD)», no «(csd)»
    function pintarBloqueo(reqs) {
        var prod = F.cfg.produccion;
        var faltan = reqs.filter(function (r) { return r.estado === "falta" && (prod || r.id === "datos"); });
        ["vista-nueva", "vista-pagos"].forEach(function (id) {
            var vista = $(id); if (!vista) return;
            var lay = vista.querySelector(".fa-layout"), aviso = vista.querySelector(".fa-bloqueo");
            var bloquear = faltan.length > 0 && !F.incrustado;
            if (lay) { lay.classList.toggle("fa-layout--bloqueado", bloquear); if (bloquear) lay.setAttribute("inert", ""); else lay.removeAttribute("inert"); }
            if (!bloquear) { if (aviso) aviso.hidden = true; return; }
            if (!aviso) {
                aviso = document.createElement("div");
                aviso.className = "fa-bloqueo"; aviso.setAttribute("role", "status");
                lay.parentNode.insertBefore(aviso, lay);
                aviso.addEventListener("click", function (e) {
                    var b = e.target.closest("[data-ir-activar]"); if (!b) return;
                    if (id === "vista-pagos") vista("nueva");
                    F.actAbierto = b.dataset.irActivar; pintarActivar();
                    $("activar").scrollIntoView({ behavior: "smooth", block: "start" });
                });
            }
            aviso.hidden = false;
            aviso.innerHTML = icono("candado") + '<div><b>' + (id === "vista-pagos" ? "Para hacer recibos de pago" : "Para llenar facturas") + ", primero completa lo que falta" +
                (id === "vista-pagos" ? " en «Activar facturación»" : " arriba") + ':</b> ' + esc(faltan.map(function (r) { return minus(r.titulo); }).join(", ")) + ".</div>" +
                '<button type="button" class="ui-btn ui-btn--primario ui-btn--32" data-ir-activar="' + faltan[0].id + '">Completar ' + esc(minus(faltan[0].titulo)) + "</button>";
        });
    }

    function pintarActivar() {
        var caja = $("activar"); if (!caja || !F.emisor) return;
        var reqs = requisitos(), prod = F.cfg.produccion;
        pintarBloqueo(reqs);
        var listos = reqs.filter(function (r) { return r.estado === "ok"; }).length;
        var mostrar = reqs.some(function (r) { return r.estado === "falta" || r.estado === "aviso"; }) || (!prod && listos < 2);
        caja.hidden = !mostrar || F.incrustado;
        if (caja.hidden) return;
        if (F.actAbierto && !reqs.some(function (r) { return r.id === F.actAbierto; })) F.actAbierto = null;
        var completo = listos === 4 || reqs.every(function (r) { return r.estado !== "falta"; });
        $("act-titulo").textContent = completo ? "Revisa tu facturación" : "Activar facturación de " + (F.emisor.alias || F.emisor.rfc);
        $("act-sub").textContent = (completo ? "" : listos + " de 4 listos. ") +
            (prod ? "Hasta completar lo que falta, esta empresa no puede timbrar." : "En modo de pruebas ya puedes timbrar de prueba; esto es lo que se necesita para timbrar de verdad.");
        $("act-barra").style.width = (listos * 25) + "%";
        $("act-pasos").innerHTML = reqs.map(function (r, n) {
            var abierto = F.actAbierto === r.id;
            var marca = r.estado === "ok" ? icono("palomita") : String(n + 1);
            var boton = r.boton || (r.estado === "ok" ? "Cambiar" : r.estado === "pendiente" ? "Ver" : "Completar");
            return '<li class="fa-act fa-act--' + r.estado + (abierto ? " fa-act--abierto" : "") + '" data-req="' + r.id + '">' +
                '<div class="fa-act__fila"><span class="fa-act__marca" aria-hidden="true">' + marca + "</span>" +
                '<div class="fa-act__txt"><b>' + esc(r.titulo) + '</b><small>' + esc(r.detalle) + "</small></div>" +
                '<button type="button" class="ui-btn ' + (r.estado === "ok" || r.estado === "pendiente" ? "ui-btn--terciario" : "ui-btn--secundario") + ' ui-btn--28" data-act-abrir aria-expanded="' + abierto + '">' + (abierto ? "Cerrar" : esc(boton)) + "</button></div>" +
                (abierto ? '<div class="fa-act__cuerpo">' + cuerpoRequisito(r.id) + "</div>" : "") + "</li>";
        }).join("");
        montarZonas();
    }

    function cuerpoRequisito(id) {
        var e = F.emisor, cat = F.cfg.catalogos.regimenes;
        if (id === "datos") return '<p class="fa-nota">Tómalos de un documento (te enseña de qué fecha es antes de usarlos) o escríbelos.</p>' +
            '<div class="fa-act__botones"><button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-act-origen="constancia">De la constancia descargada en Fiscontable</button>' +
            '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-act-origen="xml">De su última factura emitida</button></div>' +
            '<div class="fa-act__zona" data-zona="constancia"></div><div id="act-propuesta"></div>' +
            '<div class="fa-act__campos"><label class="ui-campo"><span class="ui-etiqueta">Régimen fiscal</span><select id="act-regimen" class="ui-select">' + opciones(cat, e.regimen || "", true, "Elige…") + "</select></label>" +
            '<label class="ui-campo fa-act__cp"><span class="ui-etiqueta">C.P. fiscal</span><input id="act-cp" class="ui-input" inputmode="numeric" maxlength="5" value="' + esc(e.cp || "") + '"></label>' +
            '<button type="button" class="ui-btn ui-btn--primario ui-btn--36" data-act-guardar-datos>Guardar</button></div><p class="fa-act__msj" id="act-msj"></p>';
        if (id === "sello") return '<p class="fa-nota">Es el <b>Certificado de Sello Digital</b> que se tramita en CertiSAT; no es la e.firma. Suelta los dos archivos juntos.</p>' +
            '<div class="fa-act__zona" data-zona="csd"></div>' +
            '<div class="fa-act__campos"><label class="ui-campo"><span class="ui-etiqueta">Contraseña de la llave (.key)</span><input id="act-pass" type="password" class="ui-input" autocomplete="new-password"></label>' +
            '<button type="button" class="ui-btn ui-btn--primario ui-btn--36" data-act-guardar-csd>Revisar y guardar</button></div><p class="fa-act__msj" id="act-msj"></p>';
        if (id === "manifiesto") return '<ol class="fa-act__lista"><li>Abre la página de Luna Soft (nuestro proveedor de timbrado) y fírmalo con la <b>e.firma</b> de ' + esc(e.alias || e.rfc) + ".</li>" +
            "<li>Descarga el PDF que te da al terminar y súbelo aquí. Revisamos que sea de este RFC.</li></ol>" +
            '<div class="fa-act__botones"><a class="ui-btn ui-btn--secundario ui-btn--28" href="' + LUNA_URL + '" target="_blank" rel="noopener">Abrir Luna Soft para firmar</a></div>' +
            '<div class="fa-act__zona" data-zona="manifiesto"></div><p class="fa-act__msj" id="act-msj"></p>';
        var prod = F.cfg.produccion, cuenta = F.cfg.timbres_cuenta;
        if (!prod) return '<p class="fa-nota">En modo de pruebas no se gastan timbres. Cuando se active producción, aquí le pasas timbres de tu cuenta.</p>';
        if (cuenta === 0) return '<p class="fa-nota">Tu cuenta no tiene timbres sin repartir. Pídele más al administrador.</p>';
        return '<p class="fa-nota">' + (cuenta == null ? "Tu cuenta no tiene tope de timbres." : "Tu cuenta tiene <b>" + cuenta + "</b> sin repartir.") + "</p>" +
            '<div class="fa-act__campos"><label class="ui-campo fa-act__cp"><span class="ui-etiqueta">¿Cuántos le pasas?</span><input id="act-timbres" class="ui-input" inputmode="numeric" value="' + (cuenta ? Math.min(cuenta, 50) : 50) + '"></label>' +
            '<button type="button" class="ui-btn ui-btn--primario ui-btn--36" data-act-timbres>Pasar timbres</button></div><p class="fa-act__msj" id="act-msj"></p>';
    }

    function msjAct(texto, tipo) { var m = $("act-msj"); if (m) { m.textContent = texto || ""; m.className = "fa-act__msj" + (tipo ? " fa-act__msj--" + tipo : ""); } }
    function siguienteRequisito() {
        var r = requisitos().filter(function (x) { return x.estado === "falta" || x.estado === "aviso"; })[0];
        F.actAbierto = r ? r.id : null;
    }

    function montarZonas() {
        if (!window.FCZona) return;
        document.querySelectorAll("#act-pasos [data-zona]").forEach(function (caja) {
            var tipo = caja.dataset.zona;
            if (tipo === "constancia") FCZona.crear(caja, { acepta: ".pdf", titulo: "O suelta aquí su constancia en PDF", detalle: "La Constancia de Situación Fiscal de " + (F.emisor.alias || F.emisor.rfc),
                alElegir: function (fs) { leerConstanciaEmisor(fs[0]); } });
            if (tipo === "csd") {
                F.actCsd = {};
                var z = FCZona.crear(caja, { acepta: ".cer,.key", varios: true, titulo: "Suelta aquí el .cer y el .key", detalle: "o haz clic para elegirlos (los dos a la vez)",
                    alElegir: function (fs) {
                        fs.forEach(function (f) { if (/\.cer$/i.test(f.name)) F.actCsd.cer = f; if (/\.key$/i.test(f.name)) F.actCsd.key = f; });
                        z.estado(F.actCsd.cer && F.actCsd.key ? "ok" : "", (F.actCsd.cer ? "Certificado: " + F.actCsd.cer.name : "Falta el .cer") + " · " + (F.actCsd.key ? "Llave: " + F.actCsd.key.name : "falta el .key"));
                        if (F.actCsd.cer && F.actCsd.key) $("act-pass").focus();
                    } });
            }
            if (tipo === "manifiesto") FCZona.crear(caja, { acepta: ".pdf", titulo: "Suelta aquí el PDF del manifiesto", detalle: "El que descargaste de Luna Soft al firmar",
                alElegir: function (fs) { subirManifiestoAct(fs[0]); } });
        });
    }

    // Lo leído de un documento se enseña con su fecha; solo se usa si la persona confirma
    function proponerDatos(r, origen) {
        var cat = F.cfg.catalogos.regimenes, caja = $("act-propuesta"); if (!caja) return;
        F.actPropuesta = r;
        var dias = r.fecha ? -diasPara(r.fecha.slice(0, 10)) : null;
        var de = origen === "xml" ? "Factura emitida el " + fechaLarga(r.fecha) : "Constancia del " + fechaLarga(r.fecha);
        var viejo = dias != null && dias > 90;
        var reg = r.regimenes || [];
        caja.innerHTML = '<div class="ui-aviso ' + (viejo ? "ui-aviso--aviso" : "") + ' fa-act__propuesta"><div>' +
            "<b>" + esc(r.fecha ? de : origen === "xml" ? "Última factura emitida" : "Constancia sin fecha") + "</b>" + (dias != null ? " (hace " + dias + " día" + (dias === 1 ? "" : "s") + ")" : "") +
            ". " + (viejo ? "Tiene más de 3 meses: si cambió el régimen o el domicilio después, usa una constancia más reciente." : "Revisa que siga igual: si cambió el régimen o el domicilio después de esa fecha, usa una más reciente.") +
            '<dl class="fa-act__dl">' + (r.nombre ? "<dt>Nombre</dt><dd>" + esc(r.nombre) + (F.emisor.rfc.length === 12 ? " <small>(sin régimen de capital, como lo pide el CFDI 4.0)</small>" : "") + "</dd>" : "") +
            "<dt>Régimen</dt><dd>" + (reg.length > 1 ? '<select id="act-prop-reg" class="ui-select">' + reg.map(function (k) { return '<option value="' + esc(k) + '">' + esc(k + " · " + (cat[k] || "")) + "</option>"; }).join("") + "</select>"
                : reg.length ? esc(reg[0] + " · " + (cat[reg[0]] || "")) : "<i>No trae régimen vigente</i>") + "</dd>" +
            "<dt>C.P. fiscal</dt><dd>" + esc(r.cp || "—") + "</dd></dl>" +
            '<div class="fa-act__botones"><button type="button" class="ui-btn ui-btn--primario ui-btn--28" data-act-usar>Sí, usar estos datos</button>' +
            '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-act-descartar>No</button></div></div></div>';
    }

    async function traerDatos(origen, b) {
        msjAct(""); b.classList.add("ui-btn--cargando");
        try { proponerDatos(await json("/api/facturacion/emisores/" + encodeURIComponent(F.emisor.rfc) + "/datos-fiscales?origen=" + origen), origen); }
        catch (e) { msjAct(e.message, "error"); }
        b.classList.remove("ui-btn--cargando");
    }

    async function leerConstanciaEmisor(archivo) {
        msjAct("Leyendo la constancia…");
        try {
            var cuerpo = new FormData(); cuerpo.append("archivo", archivo);
            var r = await json("/api/facturacion/leer-constancia", { method: "POST", body: cuerpo });
            if (r.rfc !== F.emisor.rfc) { msjAct("Esa constancia es de " + r.rfc + ", no de " + F.emisor.rfc + ".", "error"); return; }
            msjAct(""); proponerDatos(r, "constancia");
        } catch (e) { msjAct(e.message, "error"); }
    }

    async function guardarDatosAct(regimen, cp) {
        msjAct("");
        try {
            actualizarEmisor(await enviar("/api/facturacion/emisores/" + encodeURIComponent(F.emisor.rfc), "PUT", { regimen: regimen || null, cp: (cp || "").trim() || null }));
            siguienteRequisito(); pintarActivar();
            Fiscontable.toast("Datos fiscales guardados.");
        } catch (e) { msjAct(e.message, "error"); }
    }

    async function guardarCsdAct(b) {
        var c = F.actCsd || {}, pass = $("act-pass").value;
        if (!c.cer || !c.key || !pass) { var f = [!c.cer ? "el .cer" : "", !c.key ? "el .key" : "", !pass ? "la contraseña" : ""].filter(Boolean); msjAct("Falta" + (f.length > 1 ? "n " : " ") + f.slice(0, -1).join(", ") + (f.length > 1 ? " y " : "") + f[f.length - 1] + ".", "error"); return; }
        var cuerpo = new FormData(); cuerpo.append("cer", c.cer); cuerpo.append("key", c.key); cuerpo.append("password", pass);
        b.classList.add("ui-btn--cargando"); b.disabled = true; msjAct("");
        try {
            actualizarEmisor(await json("/api/facturacion/emisores/" + encodeURIComponent(F.emisor.rfc) + "/csd", { method: "POST", body: cuerpo }));
            F.actCsd = {}; siguienteRequisito(); pintarActivar();
            Fiscontable.toast("Sello digital guardado.");
        } catch (e) { msjAct(e.message, "error"); b.classList.remove("ui-btn--cargando"); b.disabled = false; }
    }

    async function subirManifiestoAct(pdf) {
        msjAct("Revisando el manifiesto…");
        var cuerpo = new FormData(); cuerpo.append("pac", "lunasoft"); cuerpo.append("pdf", pdf);
        try {
            F.man = await json("/api/facturacion/manifiesto/" + encodeURIComponent(F.emisor.rfc), { method: "POST", body: cuerpo });
            actualizarEmisor(Object.assign({}, F.emisor, { manifiesto: F.man.firmado }));
            siguienteRequisito(); pintarActivar();
            Fiscontable.toast("Manifiesto revisado y guardado" + (F.man.revision && F.man.revision.folio ? " (" + F.man.revision.folio + ")" : "") + ".");
        } catch (e) { msjAct(e.message, "error"); }
    }

    async function pasarTimbresAct(b) {
        var n = parseInt($("act-timbres").value, 10);
        if (!n || n < 1) { msjAct("Escribe cuántos.", "error"); return; }
        b.disabled = true; msjAct("");
        try {
            var r = await enviar("/api/facturacion/timbres/" + encodeURIComponent(F.emisor.rfc), "PUT", { cantidad: n });
            F.cfg.timbres_cuenta = r.timbres_cuenta;
            actualizarEmisor(Object.assign({}, F.emisor, { timbres: r.timbres_empresa, alta_pac: F.emisor.alta_pac || !!r.en_pac }));
            siguienteRequisito(); pintarActivar();
            Fiscontable.toast(r.en_pac ? "Listo. En MultiFacturas puede tardar hasta 5 minutos en aplicarse." : "Timbres pasados.");
        } catch (e) { msjAct(e.message, "error"); b.disabled = false; }
    }

    function activarClic(ev) {
        var li = ev.target.closest("[data-req]"); if (!li) return;
        var b;
        if (ev.target.closest("[data-act-abrir]")) { F.actAbierto = F.actAbierto === li.dataset.req ? null : li.dataset.req; pintarActivar(); return; }
        if ((b = ev.target.closest("[data-act-origen]"))) { traerDatos(b.dataset.actOrigen, b); return; }
        if (ev.target.closest("[data-act-usar]")) {
            var r = F.actPropuesta || {}, sel = $("act-prop-reg");
            guardarDatosAct(sel ? sel.value : (r.regimenes || [])[0] || $("act-regimen").value, r.cp || $("act-cp").value);
            return;
        }
        if (ev.target.closest("[data-act-descartar]")) { $("act-propuesta").innerHTML = ""; F.actPropuesta = null; return; }
        if (ev.target.closest("[data-act-guardar-datos]")) { guardarDatosAct($("act-regimen").value, $("act-cp").value); return; }
        if ((b = ev.target.closest("[data-act-guardar-csd]"))) { guardarCsdAct(b); return; }
        if ((b = ev.target.closest("[data-act-timbres]"))) pasarTimbresAct(b);
    }

    /* ---------------------------------------------------- pasos */
    function irPaso(n) {
        F.paso = n;
        document.querySelectorAll("[data-paso]").forEach(function (b) {
            b.setAttribute("aria-selected", String(+b.dataset.paso === n));
            b.classList.toggle("fa-paso--hecho", +b.dataset.paso < n);
        });
        document.querySelectorAll("[data-paso-panel]").forEach(function (p) { p.hidden = +p.dataset.pasoPanel !== n; });
        $("btn-paso-atras").hidden = n === 1;
        $("btn-paso-sig").textContent = n === 4 ? (F.tipo === "E" ? "Timbrar nota de crédito" : "Timbrar factura") : "Siguiente →";
        $("paso-error").hidden = true;
        if (n === 4) revisarPaso4();
    }

    function faltaPaso(n) {
        if (n === 1) {
            if (!$("r-rfc").value.trim()) return "Elige el receptor.";
            if (!$("r-nombre").value.trim() || !$("r-cp").value.trim() || !$("r-regimen").value) return "Completa los datos fiscales del receptor (nombre, C.P. y régimen).";
            if ($("p-moneda").value === "USD" && !num($("p-tc").value)) return "Escribe el tipo de cambio.";
        }
        if (n === 2 && F.tipo === "E" && !F.relaciones.length) return "La nota de crédito necesita la factura que corrige.";
        if (n === 3) { var malo = revisarConceptos(); if (malo) return malo; }
        return "";
    }

    function siguientePaso() {
        if (F.paso === 4) return prepararTimbrado();
        var falta = faltaPaso(F.paso || 1);
        if (falta) { $("paso-error").textContent = falta; $("paso-error").hidden = false; return; }
        irPaso((F.paso || 1) + 1);
    }

    async function revisarPaso4() {
        var cont = $("revision"), cap = captura();
        cont.innerHTML = '<p class="fa-nota">Revisando con las mismas reglas del timbrado…</p>';
        $("paso4-marco").innerHTML = "";
        try {
            var r = await enviar("/api/facturacion/revisar", "POST", { rfc: F.emisor.rfc, captura: cap });
            var serie = F.tipo === "I" ? F.emisor.serie_i : F.emisor.serie_e, folio = F.tipo === "I" ? F.emisor.folio_i : F.emisor.folio_e;
            var rel = (cap.relacionados || []).map(function (g) { return g.tipo_relacion + " · " + g.uuids.length + " CFDI"; }).join(", ");
            cont.innerHTML = '<div class="fa-revision__ok">✓ Todo en orden para timbrar</div><dl class="fa-resumen fa-resumen--dos">' +
                "<dt>Folio</dt><dd>" + esc((serie ? serie + "-" : "") + folio) + "</dd><dt>Fecha</dt><dd>" + esc((r.fecha || "").replace("T", " ")) + (cap.fecha ? "" : " <small>(al timbrar)</small>") + "</dd>" +
                "<dt>Emisor</dt><dd>" + esc(r.emisor.nombre) + "</dd><dt>Receptor</dt><dd>" + esc(cap.receptor.nombre + " · " + cap.receptor.rfc) + "</dd>" +
                "<dt>Pago</dt><dd>" + esc(cap.metodo_pago + " · forma " + cap.forma_pago) + "</dd><dt>Total</dt><dd><b>" + dinero(r.totales.total) + "</b>" + (r.moneda === "USD" ? " USD · T.C. " + esc(r.tipo_cambio) : "") + "</dd>" +
                (rel ? "<dt>Relacionados</dt><dd>" + esc(rel) + "</dd>" : "") + "</dl>";
            var resp = await api("/api/facturacion/vista-previa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rfc: F.emisor.rfc, captura: cap }) });
            var m = /filename="?([^";]+)"?/i.exec(resp.headers.get("Content-Disposition") || "");
            var blob = await resp.blob();
            if (F.vistaUrl) URL.revokeObjectURL(F.vistaUrl);
            F.vistaUrl = URL.createObjectURL(blob); F.vistaBlob = blob; F.vistaNombre = m ? m[1] : "Vista_previa.pdf";
            Fiscontable.pdfEn($("paso4-marco"), blob);
        } catch (e) {
            cont.innerHTML = '<div class="fa-error">' + esc(e.message) + "</div>";
        }
    }

    /* ---------------------------------------------------- vista previa */
    async function vistaPrevia() {
        var err = $("t-error"), b = $("btn-vista");
        err.hidden = true; b.disabled = true; b.textContent = "Revisando…";
        try {
            var resp = await api("/api/facturacion/vista-previa", { method: "POST", headers: { "Content-Type": "application/json" },
                                                                    body: JSON.stringify({ rfc: F.emisor.rfc, captura: captura() }) });
            var m = /filename="?([^";]+)"?/i.exec(resp.headers.get("Content-Disposition") || "");
            var blob = await resp.blob();
            if (F.vistaUrl) URL.revokeObjectURL(F.vistaUrl);
            F.vistaUrl = URL.createObjectURL(blob); F.vistaBlob = blob; F.vistaNombre = m ? m[1] : "Vista_previa.pdf";
            Fiscontable.verPdf(blob, { titulo: "Vista previa · sin validez fiscal", nombre: F.vistaNombre });
        } catch (e) { err.textContent = e.message; err.hidden = false; }
        b.disabled = false; b.textContent = "Vista previa PDF";
    }

    /* ---------------------------------------------------- prefacturas */
    async function cargarBorradores() {
        if (!F.empresa) return;
        try { F.borradores = await json("/api/facturacion/borradores?rfc=" + encodeURIComponent(F.empresa.rfc)); }
        catch (e) { F.borradores = []; }
        $("n-borradores").textContent = F.borradores.length;
        $("n-borradores").hidden = !F.borradores.length;
    }

    async function guardarBorrador() {
        var cap = captura(), actual = F.borradores.filter(function (x) { return x.id === F.borradorId; })[0];
        var nombre = prompt("Nombre de la prefactura", actual ? actual.nombre : (cap.receptor.nombre || cap.receptor.rfc || "Prefactura"));
        if (nombre === null) return;
        try {
            var r = await enviar("/api/facturacion/borradores", "POST", { id: F.borradorId, rfc: F.emisor.rfc, nombre: nombre, captura: cap, total: calcular().total });
            F.borradorId = r.id;
            estadoCaptura("✓ Prefactura «" + r.nombre + "» guardada.");
            cargarBorradores();
        } catch (e) { $("t-error").textContent = e.message; $("t-error").hidden = false; }
    }

    function abrirPrefactura(x, recurrente) {
        if (F.vista !== "nueva") vista("nueva");
        ponerCaptura(x.captura, (x.captura || {}).avisos_excel);
        F.borradorId = x.id;
        F.recurrenteId = recurrente ? x.id : null;
        estadoCaptura(recurrente ? "Recurrente «" + x.nombre + "»: revísala y timbra; la próxima fecha se calcula sola." : "Prefactura «" + x.nombre + "» abierta.");
        irPaso(1);
    }

    function pintarBorradores() {
        $("lista-borradores").innerHTML = F.borradores.length ? F.borradores.map(function (x) {
            var marca = (x.timbrada_en ? '<span class="fa-chip-mini fa-chip-mini--timbrada" title="' + esc(x.expira_en ? "Se borra sola el " + fechaCorta(x.expira_en + "Z") : "Se conserva") + '">Timbrada ' + esc(x.folio_timbrado || "") + "</span>" : "") +
                (x.origen === "excel" && !x.timbrada_en ? ((x.captura && x.captura.avisos_excel || []).length ? '<span class="fa-chip-mini fa-chip-mini--corregir">Por corregir</span>' : '<span class="fa-chip-mini fa-chip-mini--excel">Excel</span>') : "");
            return '<div class="fa-item' + (x.timbrada_en ? " fa-item--timbrada" : "") + '" data-id="' + esc(x.id) + '"><div class="fa-item__txt"><b>' + esc(x.nombre) + marca + "</b><small>" +
                esc((x.tipo === "E" ? "Nota de crédito · " : "") + x.receptor + " · " + (x.timbrada_en ? "timbrada el " + fechaCorta(x.timbrada_en + "Z") + (x.expira_en ? " · se borra el " + fechaCorta(x.expira_en + "Z") : "") : fechaCorta(x.actualizado_en + "Z"))) + "</small></div>" +
                (x.total != null ? '<span class="fa-item__monto">' + dinero(x.total) + "</span>" : "") +
                '<button type="button" class="fa-ico' + (x.recurrente && x.recurrente.activo ? " fa-ico--activo" : "") + '" data-repetir title="' +
                esc(x.recurrente && x.recurrente.activo ? textoRepetir(x.recurrente) : "Repetirla cada semana, quincena o mes") + '">↻</button>' +
                '<button type="button" class="fa-btn fa-btn--suave" data-abrir>Abrir</button><button type="button" class="fa-quitar" data-borrar title="Borrar">✕</button></div>' +
                (F.repitiendo === x.id ? formaRepetir(x) : "");
        }).join("") : '<p class="fa-vacio-chico">Todavía no hay prefacturas. Llena una factura y usa «Guardar prefactura».</p>';
    }

    var DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
    function textoRepetir(r) {
        var cada = r.cada === "semana" ? "Cada " + DIAS[r.dia || 0] : r.cada === "quincena" ? "Cada quincena (1 y 16)" : "Cada mes, el día " + (r.dia || 1);
        return cada + " · " + (r.modo === "timbrar" ? "se timbra sola" : "te avisa") + (r.proxima ? " · próxima " + fechaCorta(r.proxima + "T12:00:00") : "");
    }
    function formaRepetir(x) {
        var r = x.recurrente || { activo: true, cada: "mes", dia: 1, modo: "avisar" };
        var dias = r.cada === "semana" ? DIAS.map(function (d, i) { return '<option value="' + i + '"' + (+r.dia === i ? " selected" : "") + ">" + d + "</option>"; }).join("")
            : Array.from({ length: 28 }, function (_, i) { return '<option value="' + (i + 1) + '"' + (+r.dia === i + 1 ? " selected" : "") + ">" + (i + 1) + "</option>"; }).join("");
        return '<div class="fa-repetir" data-rep-id="' + esc(x.id) + '"><label class="fa-campo"><span>Cada</span><select data-rep="cada">' +
            '<option value="semana"' + (r.cada === "semana" ? " selected" : "") + '>Semana</option><option value="quincena"' + (r.cada === "quincena" ? " selected" : "") + '>Quincena</option><option value="mes"' + (r.cada === "mes" ? " selected" : "") + ">Mes</option></select></label>" +
            '<label class="fa-campo"' + (r.cada === "quincena" ? " hidden" : "") + "><span>" + (r.cada === "semana" ? "Día" : "Día del mes") + '</span><select data-rep="dia">' + dias + "</select></label>" +
            '<label class="fa-campo"><span>Ese día</span><select data-rep="modo"><option value="avisar"' + (r.modo !== "timbrar" ? " selected" : "") + '>Avisarme para revisarla</option><option value="timbrar"' + (r.modo === "timbrar" ? " selected" : "") + ">Timbrarla sola</option></select></label>" +
            '<div class="fa-repetir__acc">' + (x.recurrente && x.recurrente.activo ? '<button type="button" class="fa-link fa-link--rojo" data-rep-quitar>Dejar de repetir</button>' : "") +
            '<button type="button" class="fa-btn fa-btn--principal fa-btn--chico" data-rep-guardar>Guardar</button></div>' +
            '<p class="fa-nota">' + (r.modo === "timbrar" ? "Se timbra a las 7 de la mañana con la fecha de ese día, sin preguntarte; si falla, te aparece el aviso en Facturar." : "Ese día te aparece arriba de la factura para abrirla, revisarla y timbrarla.") + "</p></div>";
    }
    async function guardarRepetir(caja, activo) {
        var datos = { activo: activo, cada: caja.querySelector('[data-rep="cada"]').value, dia: +(caja.querySelector('[data-rep="dia"]').value || 1), modo: caja.querySelector('[data-rep="modo"]').value };
        try {
            await enviar("/api/facturacion/borradores/" + caja.dataset.repId + "/recurrente", "PUT", datos);
            F.repitiendo = null; await cargarBorradores(); pintarBorradores(); cargarRecurrentes();
        } catch (e) { aviso(e.message, "error"); }
    }

    /* ---------------------------------------------------- Excel: conceptos de esta factura y facturación masiva */
    async function bajarPlantilla(ruta, boton) {
        var t = boton.textContent; boton.disabled = true; boton.textContent = "Preparando…";
        try {
            var r = await api(ruta + "?rfc=" + encodeURIComponent(F.emisor.rfc));
            var m = /filename="?([^";]+)"?/i.exec(r.headers.get("Content-Disposition") || "");
            Fiscontable.guardarArchivo(await r.blob(), m ? m[1] : "Plantilla.xlsx");
        } catch (e) { aviso(e.message, "error"); }
        boton.disabled = false; boton.textContent = t;
    }

    function zonaArchivo(zona, input, alElegir) {
        input.addEventListener("change", function () { if (this.files[0]) alElegir(this.files[0]); this.value = ""; });
        ["dragenter", "dragover"].forEach(function (ev) { zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.add("fa-zona--sobre"); }); });
        ["dragleave", "drop"].forEach(function (ev) { zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.remove("fa-zona--sobre"); }); });
        zona.addEventListener("drop", function (e) { var f = e.dataTransfer.files[0]; if (f) alElegir(f); });
    }

    /* Cómo queda cada concepto, para no revolverse: unitario sin IVA, lo que equivale con IVA (como en el ticket),
       importe, descuento, IVA y total. filas: [{descripcion, cantidad, unitario, con_iva, importe, descuento, iva, retenciones, total}] */
    function tablaDesglose(filas) {
        var n = function (v, dec) { return Number(v || 0).toLocaleString("es-MX", { minimumFractionDigits: dec == null ? 2 : dec, maximumFractionDigits: 6 }); };
        var t = filas.reduce(function (a, x) { a.imp += x.importe; a.desc += x.descuento; a.iva += x.iva; a.ret += x.retenciones; a.total += x.total; return a; }, { imp: 0, desc: 0, iva: 0, ret: 0, total: 0 });
        var conRet = t.ret > 0;
        return '<table class="fa-desglose"><thead><tr><th>Concepto</th><th class="fa-num">Cant.</th><th class="fa-num">P. unitario<small>sin IVA</small></th><th class="fa-num">Equivale<small>con IVA</small></th>' +
            '<th class="fa-num">Importe</th><th class="fa-num">Descuento</th><th class="fa-num">IVA</th>' + (conRet ? '<th class="fa-num">Retenciones</th>' : "") + '<th class="fa-num">Total</th></tr></thead><tbody>' +
            filas.map(function (x) {
                return "<tr><td>" + esc(x.descripcion) + '</td><td class="fa-num">' + n(x.cantidad, 0) + '</td><td class="fa-num">$' + n(x.unitario) + '</td><td class="fa-num"><b>$' + n(x.con_iva) + "</b></td>" +
                    '<td class="fa-num">$' + n(x.importe) + '</td><td class="fa-num">' + (x.descuento ? "−$" + n(x.descuento) : "—") + '</td><td class="fa-num">$' + n(x.iva) + "</td>" +
                    (conRet ? '<td class="fa-num">' + (x.retenciones ? "−$" + n(x.retenciones) : "—") + "</td>" : "") + '<td class="fa-num"><b>' + dinero(x.total) + "</b></td></tr>";
            }).join("") + '</tbody><tfoot><tr><td colspan="4">Totales</td><td class="fa-num">$' + n(t.imp) + '</td><td class="fa-num">' + (t.desc ? "−$" + n(t.desc) : "—") +
            '</td><td class="fa-num">$' + n(t.iva) + "</td>" + (conRet ? '<td class="fa-num">−$' + n(t.ret) + "</td>" : "") + '<td class="fa-num"><b>' + dinero(r2(t.total)) + "</b></td></tr></tfoot></table>" +
            '<p class="fa-nota">«Equivale con IVA» es el precio unitario con IVA, antes del descuento: compáralo con el de tu ticket.</p>';
    }

    function modoResultado(dlg, hay) {
        dlg.querySelectorAll(".fa-pasos-excel, .fa-zona").forEach(function (x) { x.hidden = hay; });
        var otro = dlg.querySelector(".fa-otro-archivo");
        if (otro) otro.hidden = !hay;
    }

    function abrirExcel() {
        F.xe = null; $("xe-resultado").hidden = true; $("btn-xe-ok").disabled = true; $("btn-xe-ok").textContent = "Agregar conceptos";
        modoResultado($("dlg-excel"), false);
        if (!$("dlg-excel").open) $("dlg-excel").showModal();
    }

    async function leerExcelConceptos(archivo) {
        var caja = $("xe-resultado");
        caja.hidden = false; caja.innerHTML = '<p class="fa-nota">Leyendo ' + esc(archivo.name) + "…</p>";
        var cuerpo = new FormData(); cuerpo.append("rfc", F.emisor.rfc); cuerpo.append("archivo", archivo);
        try {
            var r = await json("/api/facturacion/excel/conceptos", { method: "POST", body: cuerpo });
            F.xe = r;
            modoResultado($("dlg-excel"), true);
            var lista = function (xs, clase) { return xs.length ? '<ul class="fa-xe-lista ' + clase + '">' + xs.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : ""; };
            var np = r.productos_nuevos || [];
            caja.innerHTML = (np.length ? '<label class="fa-interruptor fa-conf-pref" style="margin-bottom:10px"><input type="checkbox" id="xe-guardar-prod" checked> Guardar en tu catálogo ' +
                    np.filter(function (x) { return x.accion === "nuevo"; }).length + " producto(s) nuevo(s) y corregir " + np.filter(function (x) { return x.accion !== "nuevo"; }).length + " de la hoja «Productos nuevos»</label>" : "") +
                '<p class="fa-xe-ok">' + (r.conceptos.length ? "✓ " + r.conceptos.length + " concepto" + (r.conceptos.length === 1 ? "" : "s") + " listo" + (r.conceptos.length === 1 ? "" : "s") + " para agregar" : "No hay conceptos que agregar") + "</p>" +
                (r.avisos.length ? '<p class="fa-nota" style="margin-top:8px"><b>Entran, pero revisa:</b></p>' + lista(r.avisos, "fa-xe-aviso") : "") +
                (r.errores.length ? '<p class="fa-nota" style="margin-top:8px"><b>Estos renglones no entraron:</b></p>' + lista(r.errores, "fa-xe-mal") : "");
            if (r.conceptos.length) {
                caja.innerHTML += tablaDesglose(r.conceptos.map(function (c0) {
                    var c = Object.assign(conceptoVacio(), c0, { seis: !!c0.seis_decimales }), t = totalConcepto(c), x = tasas(c);
                    return { descripcion: c.descripcion, cantidad: num(c.cantidad), unitario: num(c.valor_unitario), con_iva: r2(num(c.valor_unitario) * (1 + x.t)),
                             importe: t.importeExacto, descuento: num(c.descuento), iva: t.iva, retenciones: t.ret, total: t.total };
                }));
            }
            $("btn-xe-ok").disabled = !r.conceptos.length;
            $("btn-xe-ok").textContent = r.conceptos.length ? "Agregar " + r.conceptos.length + " concepto" + (r.conceptos.length === 1 ? "" : "s") : "Agregar conceptos";
        } catch (e) { caja.innerHTML = '<p class="fa-error">' + esc(e.message) + "</p>"; }
    }

    async function guardarAltasProductos(lista) {
        if (!lista || !lista.length) return;
        var r = await enviar("/api/facturacion/productos/lote", "POST", { rfc: F.emisor.rfc, productos: lista });
        await cargarProductos();
        if (r.errores.length) aviso("Productos: " + r.guardados + " guardados; " + r.errores.slice(0, 2).join(" · "), "alerta");
    }

    async function agregarExcel() {
        if (!F.xe || !F.xe.conceptos.length) return;
        if ($("xe-guardar-prod") && $("xe-guardar-prod").checked) {
            try { await guardarAltasProductos(F.xe.productos_nuevos); } catch (e) { aviso(e.message, "error"); }
        }
        var nuevos = F.xe.conceptos.map(function (c) { return Object.assign(conceptoVacio(), c, { seis: !!c.seis_decimales }); });
        agregarConceptos(nuevos, true);
        pintarConceptos();
        $("dlg-excel").close();
        aviso("✓ Se agregaron " + nuevos.length + " concepto" + (nuevos.length === 1 ? "" : "s") + " desde Excel." + (F.xe.avisos.length ? " Completa la clave del SAT de los que se abrieron." : ""));
    }

    function abrirMasiva() {
        F.xm = null;
        ["xm-resumen", "xm-tabla", "xm-error"].forEach(function (id) { $(id).hidden = true; });
        $("btn-xm-ok").disabled = true; $("btn-xm-ok").textContent = "Guardar como prefacturas";
        $("btn-xm-timbrar").disabled = true; $("btn-xm-timbrar").textContent = "Timbrar";
        $("dlg-masiva").querySelector("[data-cerrar]").textContent = "Cancelar";
        modoResultado($("dlg-masiva"), false);
        if (!$("dlg-masiva").open) $("dlg-masiva").showModal();
    }

    async function leerMasiva(archivo) {
        $("xm-error").hidden = true;
        $("xm-resumen").hidden = false; $("xm-resumen").textContent = "Leyendo y revisando cada factura de " + archivo.name + "…";
        $("xm-tabla").hidden = true;
        var cuerpo = new FormData(); cuerpo.append("rfc", F.emisor.rfc); cuerpo.append("archivo", archivo);
        try {
            var r = await json("/api/facturacion/excel/masiva", { method: "POST", body: cuerpo });
            F.xm = r.facturas;
            modoResultado($("dlg-masiva"), true);
            var buenas = r.facturas.filter(function (f) { return !f.errores.length; });
            var total = buenas.reduce(function (a, f) { return a + (f.total || 0); }, 0);
            F.xmAltas = { productos: r.productos_nuevos || [], clientes: r.clientes_nuevos || [] };
            var cuenta = function (xs, que) { var n = xs.filter(function (x) { return x.accion === "nuevo"; }).length, c = xs.length - n; return (n ? n + " " + que + (n === 1 ? " nuevo" : "s nuevos") : "") + (n && c ? " y " : "") + (c ? c + " por corregir" : ""); };
            var altas = [F.xmAltas.productos.length ? cuenta(F.xmAltas.productos, "producto") : "", F.xmAltas.clientes.length ? cuenta(F.xmAltas.clientes, "receptor") : ""].filter(Boolean);
            $("xm-resumen").innerHTML = "<b>" + r.facturas.length + " factura" + (r.facturas.length === 1 ? "" : "s") + " en el archivo:</b> " + buenas.length + " lista" + (buenas.length === 1 ? "" : "s") +
                " (" + dinero(total) + ")" + (r.facturas.length - buenas.length ? " y " + (r.facturas.length - buenas.length) + " con algo que corregir en el Excel." : ".") +
                (altas.length ? '<label class="fa-interruptor fa-conf-pref" style="margin-top:10px;display:flex"><input type="checkbox" id="xm-guardar-altas" checked> Guardar en tu catálogo y en sus receptores: ' + esc(altas.join(" · ")) + "</label>" : "") +
                (r.facturas.length - buenas.length ? '<label class="fa-interruptor fa-conf-pref" style="margin-top:10px;display:flex"><input type="checkbox" id="xm-con-errores" checked> Guardar también ' +
                    (r.facturas.length - buenas.length === 1 ? "la que tiene errores como prefactura" : "las " + (r.facturas.length - buenas.length) + " con errores como prefacturas") + " «por corregir» (con lo que sí entró y los renglones a revisar), para terminarlas aquí en la web</label>" : "") +
                (r.errores_catalogo.length ? '<ul class="fa-xe-lista fa-xe-mal">' + r.errores_catalogo.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "");
            $("xm-filas").innerHTML = r.facturas.map(function (f) {
                var fecha = f.captura.fecha ? fechaCorta(f.captura.fecha + ":00") + " " + f.captura.fecha.slice(11, 16) : "Al timbrar";
                return '<tr data-xm="' + esc(f.clave) + '" class="' + (f.errores.length ? "fa-fila-mal" : "") + '"><td><b>' + esc(f.clave) + "</b></td><td>" + esc(f.cliente.nombre || "—") + "<small>" + esc(f.cliente.rfc || "") + "</small></td>" +
                    "<td>" + esc(fecha) + (f.vence ? "<small>timbrar antes del " + esc(fechaCorta(f.vence + ":00") + " " + f.vence.slice(11, 16)) + "</small>" : "") + "</td>" +
                    '<td class="fa-num">' + f.conceptos + '</td><td class="fa-num">' + (f.total != null ? dinero(f.total) : "—") + (f.nota ? "<small>" + esc(f.nota) + "</small>" : "") +
                    (f.desglose ? '<button type="button" class="fa-link" data-desglose="' + esc(f.clave) + '">Ver desglose</button>' : "") + "</td><td data-estado>" +
                    (f.errores.length ? '<span class="fa-estado-mal">' + f.errores.map(esc).join("<br>") + "</span>" : '<span class="fa-estado-ok">✓ Lista</span>') +
                    ((f.avisos || []).length ? '<small class="fa-xe-aviso">' + f.avisos.map(esc).join("<br>") + "</small>" : "") + "</td></tr>";
            }).join("");
            $("xm-tabla").hidden = false;
            $("btn-xm-ok").disabled = !r.facturas.length; $("btn-xm-timbrar").disabled = !buenas.length;
            $("btn-xm-ok").textContent = buenas.length ? "Solo guardar como prefactura" + (buenas.length === 1 ? "" : "s") : "Guardar como prefacturas por corregir";
            $("btn-xm-timbrar").textContent = buenas.length ? "Timbrar " + buenas.length + " factura" + (buenas.length === 1 ? "" : "s") : "Timbrar";
        } catch (e) { $("xm-resumen").hidden = true; $("xm-error").textContent = e.message; $("xm-error").hidden = false; }
    }

    async function guardarAltasExcel() {
        if (!$("xm-guardar-altas") || !$("xm-guardar-altas").checked || !F.xmAltas) return;
        await guardarAltasProductos(F.xmAltas.productos);
        if (F.xmAltas.clientes.length) { await enviar("/api/facturacion/receptores/lote", "POST", { rfc: F.emisor.rfc, clientes: F.xmAltas.clientes }); cargarReceptores(); }
        F.xmAltas = null;
    }

    /* Timbrar de una vez las que estén bien, una por una (cada una con su clave de envío: el mismo Excel no se timbra
       dos veces). La que falle se queda como prefactura con el motivo. */
    async function timbrarMasiva() {
        var buenas = (F.xm || []).filter(function (f) { return !f.errores.length; });
        if (!buenas.length || faltaManifiesto()) return;
        var total = buenas.reduce(function (a, f) { return a + (f.total || 0); }, 0);
        if (!confirm("¿Timbrar " + buenas.length + " factura" + (buenas.length === 1 ? "" : "s") + " por " + dinero(total) + "?" +
                     (F.cfg.produccion ? "\n\nSe mandan al SAT y gastan " + buenas.length + " timbre" + (buenas.length === 1 ? "" : "s") + " de la empresa." : "\n\nModo de pruebas: no gasta timbres.") +
                     "\nLas que fallen quedan como prefactura.")) return;
        var bT = $("btn-xm-timbrar"), bG = $("btn-xm-ok");
        bT.disabled = true; bG.disabled = true; F.xmCorriendo = true;
        try { await guardarAltasExcel(); } catch (e) { aviso(e.message, "error"); }
        var bien = 0, mal = 0;
        for (var i = 0; i < buenas.length; i++) {
            var f = buenas[i], celda = document.querySelector('[data-xm="' + CSS.escape(f.clave) + '"] [data-estado]');
            bT.textContent = "Timbrando " + (i + 1) + " de " + buenas.length + "…";
            if (celda) celda.innerHTML = '<span class="fa-nota">Timbrando…</span>';
            try {
                var r = await enviar("/api/facturacion/timbrar", "POST", { rfc: F.emisor.rfc, captura: Object.assign({}, f.captura, { confirmar_duplicado: true }) });
                bien++; f.errores = ["timbrada"];
                if (celda) celda.innerHTML = '<span class="fa-estado-ok">✓ ' + esc((r.serie ? r.serie + "-" : "") + r.folio) + (r.repetido ? " (ya estaba)" : "") + "</span>";
            } catch (e) {
                mal++; f.errores = [e.message];
                try { await enviar("/api/facturacion/borradores", "POST", { rfc: F.emisor.rfc, nombre: "Excel · " + f.clave + " · " + (f.cliente.nombre || f.cliente.rfc), captura: f.captura, total: f.total }); } catch (e2) { /* se ve en la tabla */ }
                if (celda) celda.innerHTML = '<span class="fa-estado-mal">' + esc(e.message) + "<br><b>Quedó como prefactura.</b></span>";
            }
        }
        var corregir = 0;
        try { corregir = await guardarPorCorregir(); } catch (e) { aviso(e.message, "error"); }
        F.xmCorriendo = false;
        bT.textContent = "Listo"; $("dlg-masiva").querySelector("[data-cerrar]").textContent = "Cerrar";
        $("xm-resumen").innerHTML = "<b>Listo:</b> " + bien + " timbrada" + (bien === 1 ? "" : "s") + (mal ? " y " + mal + " con error al timbrar (quedaron como prefactura)." : ".") +
            (corregir ? " " + corregir + " quedaron en Prefacturas «por corregir»." : "") + " Las timbradas ya están en Emitidas.";
        cargarEmitidas(); cargarBorradores(); cargarRecurrentes();
        if (F.cfg.produccion) json("/api/facturacion/config").then(function (c) { F.cfg.empresas = c.empresas; F.emisor = c.empresas.filter(function (x) { return x.rfc === F.emisor.rfc; })[0] || F.emisor; pintarEmisor(); }).catch(function () {});
    }

    function porCorregir() {
        if (!$("xm-con-errores") || !$("xm-con-errores").checked) return [];
        return (F.xm || []).filter(function (f) { return f.errores.length && f.errores[0] !== "timbrada" && !f.yaGuardada; });
    }

    async function guardarPorCorregir() {
        var malas = porCorregir();
        if (!malas.length) return 0;
        await enviar("/api/facturacion/excel/masiva/guardar", "POST", { rfc: F.emisor.rfc, facturas: malas.map(function (f) { f.yaGuardada = true; return { clave: f.clave, captura: f.captura, total: null, errores: f.errores }; }) });
        return malas.length;
    }

    async function guardarMasiva() {
        var buenas = (F.xm || []).filter(function (f) { return !f.errores.length; }).concat(porCorregir());
        if (!buenas.length) return;
        var b = $("btn-xm-ok"); b.disabled = true; b.textContent = "Guardando…";
        try {
            await guardarAltasExcel();
            var r = await enviar("/api/facturacion/excel/masiva/guardar", "POST", { rfc: F.emisor.rfc, facturas: buenas.map(function (f) { return { clave: f.clave, captura: f.captura, total: f.total, errores: f.errores }; }) });
            $("dlg-masiva").close();
            await cargarBorradores(); pintarBorradores();
            if (!$("dlg-borradores").open) $("dlg-borradores").showModal();
            aviso("✓ " + r.guardadas + " prefactura" + (r.guardadas === 1 ? "" : "s") + " desde Excel. Ábrelas, revísalas y tímbralas.");
        } catch (e) { $("xm-error").textContent = e.message; $("xm-error").hidden = false; b.disabled = false; }
    }

    /* ---------------------------------------------------- copiar otra factura */
    function abrirCopiar() {
        $("copiar-buscar").value = "";
        ponerOrigen(F.origen);
        $("dlg-copiar").showModal();
    }

    function ponerOrigen(origen) {
        F.origen = origen;
        document.querySelectorAll("[data-origen]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.origen === origen)); });
        pintarCopiar();
    }

    var esperaCopiar = null;
    async function pintarCopiar() {
        var q = $("copiar-buscar").value.trim().toLowerCase(), cont = $("lista-copiar");
        var item = function (id, titulo, sub, total) {
            return '<div class="fa-item" data-copiar="' + esc(id) + '"><div class="fa-item__txt"><b>' + esc(titulo) + "</b><small>" + esc(sub) + "</small></div>" +
                '<span class="fa-item__monto">' + dinero(total) + '</span><button type="button" class="fa-btn fa-btn--suave">Copiar</button></div>';
        };
        if (F.origen === "emitidas") {
            var filas = F.emitidas.filter(function (x) {
                return !q || [x.receptor_nombre, x.receptor_rfc, (x.serie || "") + x.folio, (x.serie || "") + "-" + x.folio].join(" ").toLowerCase().indexOf(q) !== -1;
            }).slice(0, 60);
            cont.innerHTML = filas.length ? filas.map(function (x) {
                return item("e:" + x.id, (x.serie ? x.serie + "-" : "") + x.folio + " · " + x.receptor_nombre, fechaCorta(x.fecha) + " · " + x.receptor_rfc + (x.pruebas ? " · prueba" : ""), x.total);
            }).join("") : '<p class="fa-vacio-chico">' + (F.emitidas.length ? "Nada coincide." : "Todavía no hay facturas emitidas aquí.") + "</p>";
            return;
        }
        cont.innerHTML = '<p class="fa-vacio-chico">Buscando…</p>';
        clearTimeout(esperaCopiar);
        esperaCopiar = setTimeout(async function () {
            try {
                var xs = await json("/api/facturacion/xml-recientes?rfc=" + encodeURIComponent(F.empresa.rfc) + "&q=" + encodeURIComponent(q));
                cont.innerHTML = xs.length ? xs.map(function (x) {
                    return item("x:" + x.uuid, (x.serie || x.folio ? (x.serie ? x.serie + "-" : "") + (x.folio || "") + " · " : "") + (x.nombre || x.rfc),
                                (x.rol === "emitido" ? "Emitido a " : "Recibido de ") + x.rfc + " · " + fechaCorta(x.fecha) + " · " + x.conceptos + " concepto" + (x.conceptos === 1 ? "" : "s"), x.total);
                }).join("") : '<p class="fa-vacio-chico">No hay XML de esta empresa en Administración de XML' + (q ? " que coincidan" : "") + ".</p>";
            } catch (e) { cont.innerHTML = '<p class="fa-vacio-chico">' + esc(e.message) + "</p>"; }
        }, 250);
    }

    async function copiarDe(clave) {
        if (F.vista === "pagos") vista("nueva");
        try {
            var r = clave.slice(0, 2) === "e:" ? await json("/api/facturacion/comprobantes/" + clave.slice(2) + "/captura")
                : await json("/api/facturacion/desde-xml?rfc=" + encodeURIComponent(F.empresa.rfc) + "&uuid=" + encodeURIComponent(clave.slice(2)));
            $("dlg-copiar").close();
            F.borradorId = null;
            ponerCaptura(r.captura, r.avisos);
            estadoCaptura("Copiada: revisa y timbra.");
        } catch (e) { aviso(e.message, "error"); }
    }

    async function copiarDeArchivo(archivo) {
        if (!archivo) return;
        try {
            var cuerpo = new FormData(); cuerpo.append("archivo", archivo); cuerpo.append("rfc", F.emisor.rfc);
            var r = await json("/api/facturacion/leer-xml", { method: "POST", body: cuerpo });
            F.borradorId = null;
            ponerCaptura(r.captura, r.avisos);
            estadoCaptura("Copiada de " + archivo.name + ": revisa y timbra.");
        } catch (e) { aviso(e.message, "error"); }
        $("subir-xml").value = "";
    }

    /* ---------------------------------------------------- logo */
    async function pintarLogo() {
        var caja = $("c-logo-vista");
        $("btn-quitar-logo").hidden = !F.emisor.logo;
        var cinta = $("cinta-logo"), inicial = (F.emisor.razon_social || F.emisor.alias || "·").charAt(0);
        if (!F.emisor.logo) { caja.innerHTML = "<span>Sin logo</span>"; cinta.textContent = inicial; return; }
        try {
            var b = await (await api("/api/facturacion/emisores/" + encodeURIComponent(F.emisor.rfc) + "/logo?_=" + Date.now())).blob();
            var url = URL.createObjectURL(b);
            caja.innerHTML = '<img alt="Logo" src="' + url + '">';
            cinta.innerHTML = '<img alt="" src="' + url + '">';
        } catch (e) { caja.innerHTML = "<span>Sin logo</span>"; cinta.textContent = inicial; }
    }

    async function subirLogo(archivo) {
        if (!archivo) return;
        $("msj-logo").textContent = "Subiendo…";
        try {
            var cuerpo = new FormData(); cuerpo.append("logo", archivo);
            actualizarEmisor(await json("/api/facturacion/emisores/" + encodeURIComponent(F.emisor.rfc) + "/logo", { method: "POST", body: cuerpo }));
            $("msj-logo").textContent = "✓ Logo guardado: ya sale en los PDF.";
        } catch (e) { $("msj-logo").textContent = e.message; }
        $("c-logo").value = "";
    }

    async function quitarLogo() {
        try {
            await api("/api/facturacion/emisores/" + encodeURIComponent(F.emisor.rfc) + "/logo", { method: "DELETE" });
            actualizarEmisor(Object.assign({}, F.emisor, { logo: false }));
            $("msj-logo").textContent = "Logo quitado.";
        } catch (e) { $("msj-logo").textContent = e.message; }
    }

    /* ---------------------------------------------------- mis timbres */
    async function verTimbres() {
        $("timbres-cuerpo").innerHTML = '<p class="fa-nota">Consultando MultiFacturas…</p>';
        $("dlg-timbres").showModal();
        try {
            var t = await json("/api/facturacion/timbres-resumen");
            var tarjeta = function (titulo, valor, nota, clase) {
                return '<div class="' + (clase || "") + '"><small>' + esc(titulo) + "</small><b>" + (valor == null ? "—" : Number(valor).toLocaleString("es-MX")) + "</b>" + (nota ? "<em>" + nota + "</em>" : "") + "</div>";
            };
            var h = "";
            if (!t.produccion) h += '<p class="fa-aviso">Modo de pruebas: no se gastan timbres. Los que repartas se usarán cuando se active producción.</p>';
            h += '<div class="fa-timbres-grande">';
            if (!t.sin_tope) h += tarjeta("Sin repartir en tu cuenta", t.cuenta, "Te los asigna el administrador", "fa-destacado");
            // Solo lo de este usuario: los timbres de sus empresas (RFC). La bolsa general de MultiFacturas está en Administración.
            h += tarjeta("En tus empresas", t.en_empresas, t.empresas.length + " empresa" + (t.empresas.length === 1 ? "" : "s"), t.sin_tope ? "fa-destacado" : "");
            h += tarjeta("Facturas reales timbradas", t.facturas_reales, "Desde que se activó producción");
            h += "</div>";
            h += t.empresas.length ? '<table class="fa-tabla"><thead><tr><th>Empresa</th><th class="fa-num">En Fiscontable</th><th class="fa-num">En MultiFacturas</th></tr></thead><tbody>' +
                t.empresas.map(function (e) {
                    return "<tr><td>" + esc(e.nombre) + "<small>" + esc(e.rfc) + "</small></td><td class='fa-num'>" + e.timbres + "</td><td class='fa-num'>" +
                        (e.real != null ? e.real + (e.real !== e.timbres ? ' <small>(se iguala al timbrar)</small>' : "") : e.alta ? "—" : "<small>Sin alta aún</small>") + "</td></tr>";
                }).join("") + "</tbody></table>" : '<p class="fa-vacio-chico">Todavía no le has pasado timbres a ninguna empresa.</p>';
            $("timbres-cuerpo").innerHTML = h;
        } catch (e) { $("timbres-cuerpo").innerHTML = '<p class="fa-error">' + esc(e.message) + "</p>"; }
    }

    /* ---------------------------------------------------- eventos */
    function eventos() {
        document.querySelectorAll("[data-vista]").forEach(function (b) { b.addEventListener("click", function () { vista(b.dataset.vista); }); });
        document.addEventListener("click", function (ev) {
            var ir = ev.target.closest("[data-ir]"); if (ir) { if (ir.dataset.ir === "config") abrirConfig(ir.dataset.irSub); else vista(ir.dataset.ir); }
            var cerrar = ev.target.closest("[data-cerrar]"); if (cerrar) cerrar.closest("dialog").close();
        });
        $("tipo-doc").addEventListener("change", function () { ponerTipo(this.value); });
        $("btn-publico").addEventListener("click", publico);
        $("btn-extranjero").addEventListener("click", extranjero);
        $("r-rfc").addEventListener("input", verExtranjero);
        $("btn-relacionar").addEventListener("click", agregarRelacion);
        $("rel-uuid").addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); agregarRelacion(); } });
        $("btn-anticipo").addEventListener("click", aplicarAnticipo);
        $("rel-lista").addEventListener("click", function (ev) {
            var q = ev.target.closest("[data-quitar-rel]"); if (!q) return;
            var ij = q.dataset.quitarRel.split(":"), g = F.relaciones[+ij[0]];
            g.uuids.splice(+ij[1], 1);
            if (!g.uuids.length) F.relaciones.splice(+ij[0], 1);
            pintarRelaciones();
        });
        $("pg-buscar").addEventListener("input", pintarPendientes);
        $("pg-lista").addEventListener("change", function (ev) {
            var fila = ev.target.closest("[data-uuid]"); if (!fila || !ev.target.matches("[data-pg-sel]")) return;
            if (ev.target.checked) F.pgSel[fila.dataset.uuid] = ""; else delete F.pgSel[fila.dataset.uuid];
            pintarPendientes();
            tcDelPago();
        });
        $("pg-lista").addEventListener("input", function (ev) {
            var fila = ev.target.closest("[data-uuid]"); if (!fila || !ev.target.matches("[data-pg-monto]")) return;
            F.pgSel[fila.dataset.uuid] = ev.target.value.trim();
            resumenPago();
        });
        ["pg-moneda", "pg-tc"].forEach(function (id) { $(id).addEventListener("input", resumenPago); });
        $("pg-moneda").addEventListener("change", function () { tcDelPago(); resumenPago(); });
        $("pg-fecha").addEventListener("change", function () { $("pg-tc").value = ""; tcDelPago(); });
        $("btn-pg-timbrar").addEventListener("click", prepararPago);
        document.querySelectorAll("[data-modo-correo]").forEach(function (b) { b.addEventListener("click", function () { if (!b.disabled) ponerModoCorreo(b.dataset.modoCorreo); }); });
        $("c-proveedor").addEventListener("change", ponerProveedor);
        $("btn-guardar-correo").addEventListener("click", guardarCorreo);
        $("btn-probar-correo").addEventListener("click", probarCorreo);
        $("btn-co-enviar").addEventListener("click", mandarCorreo);
        $("btn-wa-abrir").addEventListener("click", abrirWa);
        $("btn-wa-nuevo").addEventListener("click", function () { if (confirm("El enlace anterior dejará de servir. ¿Crear uno nuevo?")) abrirWhatsapp(F.waId, true); });
        $("btn-wa-copiar").addEventListener("click", function () {
            navigator.clipboard && navigator.clipboard.writeText($("wa-url").textContent).then(function () { $("btn-wa-copiar").textContent = "✓ Copiado"; });
        });
        $("btn-sustituta").addEventListener("click", function () {
            var orig = F.cancelando;
            $("dlg-cancelar").close();
            copiarDe("e:" + orig.id).then(function () {
                F.sustituye = orig.id;
                F.relaciones = [{ tipo_relacion: "04", uuids: [orig.uuid] }];
                pintarRelaciones();
                estadoCaptura("Sustituye a " + (orig.serie ? orig.serie + "-" : "") + orig.folio + ": corrige lo necesario y timbra; luego se cancela la original con motivo 01.");
            });
        });
        $("r-buscar").addEventListener("input", pintarSelector);
        $("r-buscar").addEventListener("keydown", function (ev) {
            if (ev.key === "Enter") { ev.preventDefault(); var b = $("sel-cliente-lista").querySelector(".fa-opcion"); if (b) b.click(); }
            if (ev.key === "Escape") abrirSelector(false);
        });
        $("btn-elegir-cliente").addEventListener("click", function () { abrirSelector($("sel-cliente-panel").hidden); });
        $("btn-importar-clientes").addEventListener("click", function () {
            abrirSelector(false);
            Fiscontable.importarClientes({ rfc: F.emisor.rfc, nombre: F.emisor.razon_social || F.emisor.alias, alTerminar: function (n) { cargarReceptores(); if (n) aviso("✓ " + n + " receptor" + (n === 1 ? "" : "es") + " guardado" + (n === 1 ? "" : "s") + "."); } });
        });
        $("btn-cli-quitar").addEventListener("click", function () { quitarCliente(); F.clienteNuevo = false; pintarCliente(); });
        $("sel-cliente-lista").addEventListener("click", function (ev) {
            var b = ev.target.closest(".fa-opcion"); if (!b) return;
            if (b.dataset.rfcNuevo) { abrirSelector(false); quitarCliente(); F.clienteNuevo = true; $("r-rfc").value = b.dataset.rfcNuevo; llenarReceptor().then(pintarCliente); pintarCliente(); $("r-nombre").focus(); return; }
            elegirCliente(F.selLista[+b.dataset.i]);
        });
        document.addEventListener("click", function (ev) { if (!ev.target.closest("#sel-cliente")) abrirSelector(false); });
        $("btn-nuevo-cliente").addEventListener("click", function () {
            abrirSelector(false);
            quitarCliente(); F.clienteNuevo = true; pintarCliente();
            $("r-rfc").focus();
        });
        ["r-rfc", "r-nombre", "r-cp", "r-regimen", "r-uso"].forEach(function (id) { $(id).addEventListener("change", pintarCliente); $(id).addEventListener("input", function () { $("fila-actualizar").hidden = !cambioVsGuardado(); }); });
        $("rel-activar").addEventListener("change", verRelaciones);
        document.querySelectorAll("[data-paso]").forEach(function (b) {
            b.addEventListener("click", function () {
                var n = +b.dataset.paso;
                if (n > (F.paso || 1)) { for (var k = F.paso || 1; k < n; k++) { var f = faltaPaso(k); if (f) { irPaso(k); $("paso-error").textContent = f; $("paso-error").hidden = false; return; } } }
                irPaso(n);
            });
        });
        $("btn-paso-sig").addEventListener("click", siguientePaso);
        $("btn-paso-atras").addEventListener("click", function () { irPaso(Math.max(1, (F.paso || 1) - 1)); });
        $("paso4-bajar").addEventListener("click", function () { if (F.vistaBlob) Fiscontable.guardarArchivo(F.vistaBlob, F.vistaNombre); });
        $("r-constancia").addEventListener("change", function () { leerConstancia(this.files[0]); });
        $("p-moneda").addEventListener("change", verMoneda);
        $("p-tc").addEventListener("input", function () { F.tcManual = true; });
        $("p-fecha").addEventListener("change", function () { verFecha(); if ($("p-moneda").value === "USD" && !F.tcManual) { $("p-tc").value = ""; traerTipoCambio(); } });
        $("btn-vista").addEventListener("click", vistaPrevia);
        $("btn-borrador").addEventListener("click", guardarBorrador);
        $("btn-ver-borradores").addEventListener("click", function () { pintarBorradores(); $("dlg-borradores").showModal(); });
        $("lista-borradores").addEventListener("change", function (ev) {
            var rep = ev.target.closest(".fa-repetir"); if (!rep || ev.target.dataset.rep === "dia") return;
            var x = F.borradores.filter(function (b) { return b.id === rep.dataset.repId; })[0];
            x.recurrente = Object.assign({}, x.recurrente || { activo: false }, { cada: rep.querySelector('[data-rep="cada"]').value, modo: rep.querySelector('[data-rep="modo"]').value });
            if (ev.target.dataset.rep === "cada") x.recurrente.dia = x.recurrente.cada === "semana" ? 0 : 1;
            pintarBorradores();
        });
        $("lista-borradores").addEventListener("click", async function (ev) {
            var rep = ev.target.closest(".fa-repetir");
            if (rep) {
                if (ev.target.closest("[data-rep-guardar]")) guardarRepetir(rep, true);
                if (ev.target.closest("[data-rep-quitar]")) guardarRepetir(rep, false);
                return;
            }
            var it = ev.target.closest("[data-id]"); if (!it) return;
            if (ev.target.closest("[data-repetir]")) { F.repitiendo = F.repitiendo === it.dataset.id ? null : it.dataset.id; pintarBorradores(); return; }
            var x = F.borradores.filter(function (b) { return b.id === it.dataset.id; })[0]; if (!x) return;
            if (ev.target.closest("[data-borrar]")) {
                if (!confirm("¿Borrar la prefactura «" + x.nombre + "»?")) return;
                try { await api("/api/facturacion/borradores/" + x.id, { method: "DELETE" }); if (F.borradorId === x.id) F.borradorId = null; await cargarBorradores(); pintarBorradores(); }
                catch (e) { aviso(e.message, "error"); }
                return;
            }
            $("dlg-borradores").close();
            abrirPrefactura(x);
        });
        $("btn-copiar").addEventListener("click", abrirCopiar);
        document.querySelectorAll("[data-origen]").forEach(function (b) { b.addEventListener("click", function () { ponerOrigen(b.dataset.origen); }); });
        $("copiar-buscar").addEventListener("input", pintarCopiar);
        $("lista-copiar").addEventListener("click", function (ev) { var it = ev.target.closest("[data-copiar]"); if (it) copiarDe(it.dataset.copiar); });
        $("subir-xml").addEventListener("change", function () { copiarDeArchivo(this.files[0]); });
        $("btn-cambiar-emisor").addEventListener("click", function (ev) { ev.stopPropagation(); var b = document.getElementById("fc-btn-empresa"); if (b) b.click(); });
        $("recurrentes-hoy").addEventListener("click", async function (ev) {
            var b = ev.target.closest("[data-recurrente]"); if (!b) return;
            await cargarBorradores();
            var x = F.borradores.filter(function (y) { return y.id === b.dataset.recurrente; })[0];
            if (x) abrirPrefactura(x, true);
        });
        /* Atajos: Ctrl+Enter siguiente paso / timbrar · Ctrl+S prefactura · Alt+N nueva · Alt+C agregar concepto */
        document.addEventListener("keydown", function (ev) {
            if (F.vista !== "nueva" || !F.emisor || document.querySelector("dialog[open]")) return;
            var ctrl = ev.ctrlKey || ev.metaKey;
            if (ctrl && ev.key === "Enter") { ev.preventDefault(); siguientePaso(); }
            else if (ctrl && (ev.key === "s" || ev.key === "S")) { ev.preventDefault(); guardarBorrador(); }
            else if (ev.altKey && (ev.key === "n" || ev.key === "N")) { ev.preventDefault(); if (confirm("¿Empezar una factura nueva? Se borra lo capturado.")) { nuevaFactura(); irPaso(1); } }
            else if (ev.altKey && (ev.key === "c" || ev.key === "C")) { ev.preventDefault(); if (F.paso !== 3) irPaso(3); $("btn-concepto").click(); }
        });
        $("btn-limpiar").addEventListener("click", function () { if (confirm("¿Borrar lo capturado y empezar una factura nueva?")) nuevaFactura(); });
        document.querySelectorAll("[data-sub]").forEach(function (b) { b.addEventListener("click", function () { ponerSub(b.dataset.sub); }); });
        $("btn-configurar").addEventListener("click", function () { abrirConfig(); });
        $("btn-config-listo").addEventListener("click", configListo);
        $("chip-timbres").addEventListener("click", verTimbres);
        $("c-logo").addEventListener("change", function () { subirLogo(this.files[0]); });
        $("btn-quitar-logo").addEventListener("click", quitarLogo);
        $("r-rfc").addEventListener("change", llenarReceptor);
        $("r-rfc").addEventListener("input", verGlobal);
        $("p-metodo").addEventListener("change", function () {
            if (this.value === "PPD") $("p-forma").value = "99";
            else if ($("p-forma").value === "99") $("p-forma").value = "03";
            $("p-forma").disabled = this.value === "PPD";
        });
        $("btn-concepto").addEventListener("click", function () {
            F.conceptos.push(conceptoVacio());
            abrirConcepto(F.conceptos.length - 1);
        });
        $("conceptos").addEventListener("input", function (ev) {
            var campo = ev.target.closest("[data-c]"); if (!campo) return;
            var i = +campo.closest("[data-i]").dataset.i, c = F.conceptos[i], k = campo.dataset.c;
            c.pendiente = false;
            if (c.error) { c.error = null; document.querySelectorAll('#conceptos [data-i="' + i + '"] .fa-conc__err').forEach(function (x) { x.remove(); }); var tr0 = document.querySelector('.fa-conc__fila[data-i="' + i + '"]'); if (tr0) tr0.classList.remove("fa-conc--error"); }
            if (k === "modo") {
                c.modo = campo.checked ? "final" : "unitario";
                if (c.modo === "final" && !c.final) c.final = String(totalConcepto(c).total || "");
                if (c.modo !== "final") { c.seis = false; c.difFinal = null; }
                aplicarFinal(c); pintarConceptos(); enfocarConcepto(i, c.modo === "final" ? "final" : "valor_unitario"); return;
            }
            if (k === "impuesto") { c._otro = campo.value === "otro"; if (!c._otro) ponerImpuesto(c, campo.value); aplicarFinal(c); pintarConceptos(); enfocarConcepto(i, "impuesto"); return; }
            c[k] = campo.value;
            if (k === "descripcion") { c.producto_id = null; sugerirProductos(campo); }
            if (k === "iva" || k === "ret_isr" || k === "ret_iva") { aplicarFinal(c); pintarConceptos(); enfocarConcepto(i, k); return; }
            if (k === "final" || ((k === "cantidad" || k === "descuento") && c.modo === "final")) {
                aplicarFinal(c);
                var sub = campo.closest("tr").querySelector("td:nth-child(3) .fa-conc__sub");
                if (sub) sub.innerHTML = subPrecio(c);
            }
            if (k === "no_identificacion" || k === "cuenta_predial") refrescarSub(i);
            calcular();
        });
        $("conceptos").addEventListener("change", function (ev) {
            if (ev.target.matches('select[data-c="impuesto"], input[data-c="modo"]')) ev.target.dispatchEvent(new Event("input", { bubbles: true }));
            // El SAT solo acepta letras y números en la cuenta predial: guiones, puntos y espacios se quitan solos
            if (ev.target.matches('input[data-c="cuenta_predial"]') && /[^0-9a-zA-Z]/.test(ev.target.value)) {
                ev.target.value = ev.target.value.replace(/[^0-9a-zA-Z]/g, "");
                ev.target.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        $("conceptos").addEventListener("focusin", function (ev) { if (ev.target.matches('[data-c="descripcion"]')) sugerirProductos(ev.target); });
        $("conceptos").addEventListener("focusout", function (ev) {
            if (!ev.target.matches('[data-c="descripcion"]')) return;
            var caja = ev.target.parentNode.querySelector(".fa-prod__sug"); setTimeout(function () { caja.hidden = true; }, 180);
        });
        $("conceptos").addEventListener("keydown", function (ev) {
            var fila = ev.target.closest("[data-i]"); if (!fila) return;
            var i = +fila.dataset.i;
            if (i !== F.abierto) {      // renglón guardado: Enter o Espacio lo abre
                if ((ev.key === "Enter" || ev.key === " ") && ev.target === fila) { ev.preventDefault(); abrirConcepto(i); }
                return;
            }
            if (ev.key === "Escape") { var sug = fila.querySelector(".fa-prod__sug:not([hidden])"); if (sug) { sug.hidden = true; return; } ev.preventDefault(); abrirConcepto(-1); return; }
            if (ev.key !== "Enter" || ev.target.closest(".fa-clave") || ev.target.tagName === "BUTTON") return;
            ev.preventDefault();
            var caja = fila.querySelector(".fa-prod__sug"); if (caja) caja.hidden = true;
            if (ev.target.matches("[data-c]")) ev.target.dispatchEvent(new Event("change", { bubbles: true }));
            guardarConcepto(true);
        });
        $("conceptos").addEventListener("mousedown", function (ev) {
            var bs = ev.target.closest(".fa-prod__sug [data-sat]");
            if (bs) {                 // clave del SAT elegida desde la descripción: se pone la clave; lo escrito se queda
                ev.preventDefault();
                var k = +bs.closest("[data-i]").dataset.i, cc = F.conceptos[k];
                cc.clave_prod = bs.dataset.sat;
                if (!(cc.descripcion || "").trim()) cc.descripcion = bs.dataset.satTexto;
                cc.error = null; pintarConceptos(); enfocarConcepto(k, "cantidad");
                return;
            }
            var b = ev.target.closest(".fa-prod__sug [data-prod]"); if (!b) return;
            ev.preventDefault();
            var i = +b.closest("[data-i]").dataset.i, p = (F.productos || []).filter(function (x) { return x.id === b.dataset.prod; })[0];
            if (p) { usarProducto(F.conceptos[i], p); F.conceptos[i].error = null; pintarConceptos(); enfocarConcepto(i, "cantidad"); }
        });
        $("conceptos").addEventListener("click", function (ev) {
            var fila = ev.target.closest("[data-i]"); if (!fila) return;
            var i = +fila.dataset.i;
            if (ev.target.closest("[data-quitar]")) {
                F.conceptos.splice(i, 1);
                if (F.abierto === i) F.abierto = -1; else if (F.abierto > i) F.abierto--;
                if (!F.conceptos.length) { F.conceptos = [conceptoVacio()]; F.abierto = 0; }
                pintarConceptos();
            }
            else if (ev.target.closest("[data-duplicar]")) {
                F.conceptos.splice(i + 1, 0, Object.assign({}, F.conceptos[i], { error: null, producto_id: F.conceptos[i].producto_id }));
                if (F.abierto > i) F.abierto++;
                abrirConcepto(i + 1);
            }
            else if (ev.target.closest("[data-guardar-fila]")) guardarConcepto(false);
            else if (ev.target.closest("[data-guardar-prod]")) guardarConceptoEnCatalogo(i);
            else if (i !== F.abierto) { var celda = ev.target.closest("[data-campo]"); abrirConcepto(i, celda ? celda.dataset.campo : null); }
        });
        $("btn-conc-excel").addEventListener("click", abrirExcel);
        $("btn-xe-plantilla").addEventListener("click", function () { bajarPlantilla("/api/facturacion/excel/plantilla-conceptos", this); });
        zonaArchivo($("xe-zona"), $("xe-archivo"), leerExcelConceptos);
        $("btn-xe-ok").addEventListener("click", agregarExcel);
        $("btn-masiva").addEventListener("click", function () { $("dlg-borradores").close(); abrirMasiva(); });
        $("btn-xm-plantilla").addEventListener("click", function () { bajarPlantilla("/api/facturacion/excel/plantilla-masiva", this); });
        zonaArchivo($("xm-zona"), $("xm-archivo"), leerMasiva);
        $("btn-xm-ok").addEventListener("click", guardarMasiva);
        $("btn-xm-timbrar").addEventListener("click", timbrarMasiva);
        document.querySelectorAll(".fa-otro-archivo").forEach(function (b) {
            b.addEventListener("click", function () {
                var dlg = b.closest("dialog");
                if (F.xmCorriendo) return;
                if (dlg.id === "dlg-masiva") abrirMasiva(); else abrirExcel();
            });
        });
        $("xm-filas").addEventListener("click", function (ev) {
            var b = ev.target.closest("[data-desglose]"); if (!b) return;
            var tr = b.closest("tr"), sig = tr.nextElementSibling;
            if (sig && sig.classList.contains("fa-fila-desglose")) { sig.remove(); b.textContent = "Ver desglose"; return; }
            var f = (F.xm || []).filter(function (x) { return x.clave === b.dataset.desglose; })[0]; if (!f) return;
            tr.insertAdjacentHTML("afterend", '<tr class="fa-fila-desglose"><td colspan="6">' + tablaDesglose(f.desglose) + "</td></tr>");
            b.textContent = "Ocultar desglose";
        });
        $("c-pref-dias").addEventListener("change", async function () {
            var v = +this.value;
            try { await enviar("/api/facturacion/preferencias", "PUT", { prefacturas_dias: v }); F.cfg.prefacturas_dias = v; $("msj-pref").textContent = "✓ Guardado. Al timbrar te lo pregunta con esto ya marcado."; }
            catch (e) { $("msj-pref").textContent = e.message; }
        });
        $("conc-xml").addEventListener("change", function () { leerXmlProductos(this.files, "factura"); this.value = ""; });
        $("btn-catalogo").addEventListener("click", function () { abrirConfig("productos"); });
        $("btn-ajustar").addEventListener("click", function () {
            var caja = $("objetivo-form"); caja.hidden = !caja.hidden; this.setAttribute("aria-expanded", String(!caja.hidden));
            if (!caja.hidden) { if (!$("t-objetivo").value) $("t-objetivo").value = calcular().total ? String(calcular().total) : ""; $("t-objetivo").focus(); $("t-objetivo").select(); calcular(); }
        });
        $("t-objetivo").addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); cuadrarTotal(); } });
        $("btn-objetivo").addEventListener("click", cuadrarTotal);
        $("t-objetivo-nota").addEventListener("click", function (ev) { var b = ev.target.closest("[data-objetivo]"); if (b) { $("t-objetivo").value = b.dataset.objetivo; cuadrarTotal(); } });
        $("t-objetivo").addEventListener("input", calcular);
        $("prod-buscar").addEventListener("input", pintarProductos);
        $("btn-prod-nuevo").addEventListener("click", function () { abrirProducto(null); });
        $("prod-lista").addEventListener("click", function (ev) { var it = ev.target.closest("[data-prod]"); if (it) abrirProducto((F.productos || []).filter(function (p) { return p.id === it.dataset.prod; })[0]); });
        $("btn-pr-guardar").addEventListener("click", guardarProducto);
        $("btn-pr-borrar").addEventListener("click", async function () {
            if (!F.prodEditando || !confirm("¿Borrar «" + F.prodEditando.nombre + "» del catálogo?")) return;
            try { await api("/api/facturacion/productos/" + F.prodEditando.id, { method: "DELETE" }); $("dlg-producto").close(); cargarProductos(); } catch (e) { $("pr-error").textContent = e.message; $("pr-error").hidden = false; }
        });
        $("prod-xml").addEventListener("change", function () { leerXmlProductos(this.files, "catalogo"); this.value = ""; });
        $("btn-prod-biblioteca").addEventListener("click", async function () {
            var b = this; b.disabled = true; b.textContent = "Leyendo XML…";
            try { abrirImportar(await enviar("/api/facturacion/productos/desde-biblioteca", "POST", { rfc: F.emisor.rfc }), "catalogo"); } catch (e) { aviso(e.message, "error"); }
            b.disabled = false; b.textContent = "Desde Administración de XML";
        });
        $("im-buscar").addEventListener("input", pintarImportar);
        $("im-todos").addEventListener("change", function () { var v = this.checked; F.importar.lista.forEach(function (x) { x.sel = v; }); pintarImportar(); });
        $("im-filas").addEventListener("input", function (ev) {
            var tr = ev.target.closest("[data-im]"); if (!tr) return;
            var x = F.importar.lista[+tr.dataset.im], k = ev.target.dataset.imC;
            if (k === "sel") x.sel = ev.target.checked;
            else if (k === "impuesto") { if (ev.target.value !== "otro") ponerImpuesto(x, ev.target.value); }
            else x[k] = ev.target.value;
        });
        $("im-filas").addEventListener("change", function (ev) { if (ev.target.matches("select, input[type=checkbox]")) ev.target.dispatchEvent(new Event("input", { bubbles: true })); });
        $("btn-im-ok").addEventListener("click", confirmarImportar);
        $("btn-timbrar").addEventListener("click", prepararTimbrado);
        $("btn-confirmar").addEventListener("click", timbrar);
        $("listo-xml").addEventListener("click", function () { bajarXml(F.ultimo.id); });
        $("listo-correo").addEventListener("click", function () { $("dlg-listo").close(); abrirCorreo(F.ultimo.id); });
        $("listo-wa").addEventListener("click", function () { $("dlg-listo").close(); abrirWhatsapp(F.ultimo.id); });
        $("listo-pdf").addEventListener("click", function () { verPdf(F.ultimo.id); });
        $("listo-otra").addEventListener("click", function () { $("dlg-listo").close(); if (F.vista === "nueva") $("r-rfc").focus(); });
        $("buscar-emitidas").addEventListener("input", pintarEmitidas);
        $("filtro-tipo").addEventListener("change", pintarEmitidas);
        $("filas-emitidas").addEventListener("change", function (ev) {
            if (!ev.target.matches("[data-sel]")) return;
            var tr = ev.target.closest("tr"), id = tr.dataset.id;
            if (ev.target.checked) F.selEmit[id] = 1; else delete F.selEmit[id];
            tr.classList.toggle("fa-fila-sel", ev.target.checked);
            pintarSeleccion();
        });
        $("sel-todas").addEventListener("change", function () {
            var v = this.checked;
            (F.emitVisibles || []).forEach(function (id) { if (v) F.selEmit[id] = 1; else delete F.selEmit[id]; });
            pintarEmitidas();
        });
        $("btn-sel-quitar").addEventListener("click", function () { F.selEmit = {}; pintarEmitidas(); });
        $("btn-zip").addEventListener("click", bajarZip);
        $("btn-compartir-sel").addEventListener("click", function () {
            var ids = Object.keys(F.selEmit || {}); if (!ids.length) return;
            var xs = F.emitidas.filter(function (e) { return F.selEmit[e.id]; });
            var clientes = Array.from(new Set(xs.map(function (e) { return e.receptor_nombre; })));
            var r = (F.receptores || []).filter(function (c) { return xs.length && c.rfc === xs[0].receptor_rfc; })[0];
            Fiscontable.compartir({ rfc: F.emisor.rfc, items: ids.map(function (id) { return { tipo: "comprobante", id: id }; }),
                titulo: "Facturas de " + (F.emisor.razon_social || F.emisor.alias) + (clientes.length === 1 ? " para " + clientes[0] : ""), correo: clientes.length === 1 && r ? r.correo : "" });
        });
        $("btn-enlaces").addEventListener("click", function () { Fiscontable.enlacesCompartidos({ rfc: F.emisor.rfc }); });
        Fiscontable.perfil().then(function (pf) { $("btn-ir-cancelaciones").hidden = ((pf && pf.modulos_permitidos) || []).indexOf("cancelaciones") === -1; });
        $("btn-ir-cancelaciones").addEventListener("click", function () { if (F.emisor) this.href = "/herramientas/xml/cancelaciones.html?rfc=" + encodeURIComponent(F.emisor.rfc); });
        document.addEventListener("click", function (ev) {
            if (!ev.target.closest(".fa-mas")) document.querySelectorAll(".fa-mas__menu").forEach(function (m) { m.hidden = true; });
        });
        $("filas-emitidas").addEventListener("click", function (ev) {
            var menu = ev.target.closest("[data-menu]");
            if (menu) {
                var caja = menu.nextElementSibling, abrir = caja.hidden;
                document.querySelectorAll(".fa-mas__menu").forEach(function (m) { m.hidden = true; });
                caja.hidden = !abrir;
                if (abrir) {                 // si no cabe abajo, se abre hacia arriba
                    caja.classList.remove("fa-mas__menu--arriba");
                    if (caja.getBoundingClientRect().bottom > window.innerHeight - 8) caja.classList.add("fa-mas__menu--arriba");
                }
                return;
            }
            var b = ev.target.closest("[data-acc]"); if (!b) return;
            var m0 = b.closest(".fa-mas__menu"); if (m0) m0.hidden = true;
            var id = b.closest("tr").dataset.id;
            if (b.dataset.acc === "xml") bajarXml(id);
            else if (b.dataset.acc === "acuse") bajarAcuse(id);
            else if (b.dataset.acc === "pdf") verPdf(id);
            else if (b.dataset.acc === "copiar") copiarDe("e:" + id);
            else if (b.dataset.acc === "correo") abrirCorreo(id);
            else if (b.dataset.acc === "whatsapp") abrirWhatsapp(id);
            else if (b.dataset.acc === "pago") {
                var x = F.emitidas.filter(function (e) { return e.id === id; })[0];
                F.pgSel = {}; F.pgSel[x.uuid] = "";
                vista("pagos");
            }
            else if (b.dataset.acc === "sat") revisarSat(id, b);
            else abrirCancelar(id);
        });
        $("can-motivo").addEventListener("change", function () { $("can-sust-caja").hidden = this.value !== "01"; });
        $("btn-cancelar-ok").addEventListener("click", cancelar);
        $("btn-guardar-config").addEventListener("click", guardarConfig);
        $("btn-guardar-csd").addEventListener("click", guardarCsd);
        $("act-pasos").addEventListener("click", activarClic);
        $("act-pasos").addEventListener("keydown", function (ev) { if (ev.key === "Enter" && ev.target.id === "act-pass") { ev.preventDefault(); guardarCsdAct(document.querySelector("[data-act-guardar-csd]")); } });
        $("c-man-pacs").addEventListener("click", manifiestoClic);
        $("mdlg-pdf").addEventListener("change", function () { $("mdlg-subir").disabled = !this.files[0]; });
        $("mdlg-subir").addEventListener("click", subirManifiestoDlg);
        $("mdlg-despues").addEventListener("click", function () { $("dlg-manifiesto").close(); });
        $("btn-reemplazar-csd").addEventListener("click", function () { $("c-csd-form").hidden = false; this.hidden = true; });
        $("btn-quitar-csd").addEventListener("click", quitarCsd);
        $("btn-dar-timbres").addEventListener("click", function () { moverTimbres(1); });
        $("btn-quitar-timbres").addEventListener("click", function () { moverTimbres(-1); });
    }

    iniciar();
})();
