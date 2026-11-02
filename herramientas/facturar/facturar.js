/*
 * herramientas/facturar/facturar.js — Facturar (CFDI 4.0, timbrado con MultiFacturas).
 *
 * La empresa que factura es la del selector de arriba. Tres vistas:
 *   Nueva factura  cliente, pago, conceptos y totales en vivo; antes de timbrar el servidor lo revisa
 *                  (sin gastar timbre) y se confirma con el resumen.
 *   Emitidas       sus facturas y notas de crédito: XML, PDF (representación impresa) y cancelar.
 *   Configuración  régimen, C.P., series y folios, el CSD (sello digital) y sus timbres.
 * Los totales se calculan igual que en el servidor (cada importe redondeado a centavos).
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };

    var F = { empresa: null, cfg: null, emisor: null, tipo: "I", conceptos: [], emitidas: [], detalles: {}, cancelando: null, ultimo: null };

    async function api(ruta, opciones) {
        var resp = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!resp.ok) throw new Error(await Fiscontable.leerError(resp));
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
    var dinero = function (v) { return "$" + Number(v || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var num = function (v) { var n = parseFloat(String(v == null ? "" : v).replace(/,/g, "")); return isNaN(n) ? 0 : n; };
    function opciones(mapa, actual, conClave, vacio) {
        return (vacio ? '<option value="">' + esc(vacio) + "</option>" : "") + Object.keys(mapa).map(function (k) {
            return '<option value="' + esc(k) + '"' + (k === actual ? " selected" : "") + ">" + esc(conClave === false ? mapa[k] : k + " · " + mapa[k]) + "</option>";
        }).join("");
    }
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
    function enLetra(total) {
        var entero = Math.floor(total + 1e-9), cent = Math.round((total - entero) * 100);
        if (cent === 100) { entero += 1; cent = 0; }
        var partes = [], mill = Math.floor(entero / 1e6), miles = Math.floor((entero % 1e6) / 1000), resto = entero % 1000;
        if (mill) partes.push(mill === 1 ? "UN MILLON" : cientos(mill) + " MILLONES");
        if (miles) partes.push(miles === 1 ? "MIL" : cientos(miles) + " MIL");
        if (resto) partes.push(cientos(resto));
        var texto = partes.join(" ") || "CERO";
        return texto + (mill && !miles && !resto ? " DE" : "") + " PESOS " + String(cent).padStart(2, "0") + "/100 M.N.";
    }

    /* ---------------------------------------------------- arranque */
    async function iniciar() {
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
        $("chip-modo").hidden = F.cfg.produccion;
        eventos();
        F.empresa = await Fiscontable.empresaActiva();
        window.addEventListener("fiscontable:empresa", function (ev) { F.empresa = ev.detail; elegirEmpresa(); });
        F.vista = Fiscontable.url("vista") || "nueva";     // con F5 se queda en la misma vista
        nuevaFactura();
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
    }

    function vista(nombre) {
        F.vista = nombre;
        document.querySelectorAll("[data-vista]").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.vista === nombre)); });
        if (!F.empresa) return;
        document.querySelectorAll("[data-panel]").forEach(function (p) { p.hidden = p.dataset.panel !== nombre; });
        Fiscontable.url({ vista: nombre === "nueva" ? null : nombre });
    }

    /* ---------------------------------------------------- emisor (encabezado, avisos y configuración) */
    function pintarEmisor() {
        var e = F.emisor, prod = F.cfg.produccion;
        var chip = $("chip-timbres");
        chip.hidden = !(prod && e.timbres !== null);
        chip.textContent = "Timbres: " + (e.timbres || 0);
        chip.className = "fa-chip" + ((e.timbres || 0) < 1 ? " fa-chip--mal" : "");
        $("punto-config").hidden = e.listo;
        var falta = $("falta-config");
        if (prod && !e.listo) {
            falta.innerHTML = "Para timbrar con <b>" + esc(e.alias) + "</b> falta: " + esc(e.faltan.join(", ")) +
                '. <button type="button" data-ir="config">Completar en Configuración</button>';
            falta.className = "fa-aviso fa-aviso--alerta";
            falta.hidden = false;
        } else if (!prod) {
            falta.innerHTML = "<b>Modo de pruebas:</b> se timbra con el RFC de prueba del SAT (" + esc(F.cfg.prueba.rfc) +
                "). No gasta timbres ni tiene validez fiscal; sirve para conocer el módulo. Tus series y folios sí avanzan.";
            falta.className = "fa-aviso";
            falta.hidden = false;
        } else {
            falta.hidden = true;
        }
        $("c-emisor").textContent = (e.razon_social || e.alias) + " · " + e.rfc;
        $("c-regimen").value = e.regimen || "";
        $("c-cp").value = e.cp || "";
        $("c-serie-i").value = e.serie_i;
        $("c-folio-i").value = e.folio_i;
        $("c-serie-e").value = e.serie_e;
        $("c-folio-e").value = e.folio_e;
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
        $("caja-timbres").hidden = e.timbres === null;
        $("c-timbres-empresa").textContent = e.timbres || 0;
        $("c-timbres-cuenta").textContent = F.cfg.timbres_cuenta || 0;
        pintarFolio();
    }

    function pintarFolio() {
        if (!F.emisor) return;
        var serie = F.tipo === "I" ? F.emisor.serie_i : F.emisor.serie_e;
        var folio = F.tipo === "I" ? F.emisor.folio_i : F.emisor.folio_e;
        $("t-folio").textContent = "Será " + (F.tipo === "I" ? "la factura " : "la nota de crédito ") + (serie ? serie + "-" : "") + folio + ".";
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
                folio_i: parseInt($("c-folio-i").value, 10) || 1, folio_e: parseInt($("c-folio-e").value, 10) || 1
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
            actualizarEmisor(Object.assign({}, F.emisor, { timbres: r.timbres_empresa }));
            $("msj-timbres").textContent = "✓ Listo.";
        } catch (e) { $("msj-timbres").textContent = e.message; }
    }

    /* ---------------------------------------------------- nueva factura */
    function conceptoVacio() {
        return { cantidad: 1, clave_unidad: "E48", clave_prod: "01010101", descripcion: "", valor_unitario: "", descuento: "", iva: "16", objeto_imp: "02", ret_isr: "", ret_iva: "" };
    }

    function nuevaFactura() {
        F.conceptos = [conceptoVacio()];
        ["r-rfc", "r-nombre", "r-cp", "rel-uuid", "p-condiciones"].forEach(function (id) { $(id).value = ""; });
        $("r-regimen").value = "";
        $("r-uso").value = F.tipo === "E" ? "G02" : "G03";
        $("t-error").hidden = true;
        pintarConceptos();
    }

    function ponerTipo(tipo) {
        F.tipo = tipo;
        document.querySelectorAll("[data-tipo]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.tipo === tipo)); });
        $("caja-relacion").hidden = tipo !== "E";
        if (tipo === "E" && $("r-uso").value === "G03") $("r-uso").value = "G02";
        if (tipo === "I" && $("r-uso").value === "G02") $("r-uso").value = "G03";
        pintarFolio();
    }

    function filaConcepto(c, i) {
        var cat = F.cfg.catalogos, ret = $("ver-retenciones").checked;
        var ivas = { "16": "16 %", "8": "8 % (frontera)", "0": "0 %", "exento": "Exento", "no": "No objeto de impuesto" };
        var ivaActual = c.objeto_imp === "01" ? "no" : c.iva;
        var retIsr = { "": "Sin retención", "10": "10 %", "1.25": "1.25 % (RESICO)" };
        var retIva = { "": "Sin retención", "10.6667": "2/3 del IVA (10.6667 %)", "4": "4 % (fletes)", "6": "6 % (subcontratación)", "16": "16 %" };
        return '<div class="fa-concepto" data-i="' + i + '">' +
            '<div class="fa-concepto__cabeza"><span>Concepto ' + (i + 1) + ' · <b data-importe>' + dinero(r2(num(c.cantidad) * num(c.valor_unitario))) + "</b></span>" +
            (F.conceptos.length > 1 ? '<button type="button" class="fa-quitar" data-quitar title="Quitar">✕</button>' : "") + "</div>" +
            '<div class="fa-rejilla fa-rejilla--concepto">' +
            '<label class="fa-campo k12"><span>Descripción</span><input data-c="descripcion" maxlength="1000" value="' + esc(c.descripcion) + '" placeholder="Lo que vendes o el servicio que das"></label>' +
            '<label class="fa-campo k2"><span>Cantidad</span><input data-c="cantidad" inputmode="decimal" value="' + esc(c.cantidad) + '"></label>' +
            '<label class="fa-campo k3"><span>Precio unitario</span><input data-c="valor_unitario" inputmode="decimal" value="' + esc(c.valor_unitario) + '" placeholder="0.00"></label>' +
            '<label class="fa-campo k2"><span>Descuento</span><input data-c="descuento" inputmode="decimal" value="' + esc(c.descuento) + '" placeholder="0.00"></label>' +
            '<label class="fa-campo k5"><span>IVA</span><select data-c="iva">' + opciones(ivas, ivaActual, false) + "</select></label>" +
            '<label class="fa-campo k6"><span>Clave de producto o servicio (SAT)</span><input data-c="clave_prod" inputmode="numeric" maxlength="8" class="fa-mono" value="' + esc(c.clave_prod) + '" title="8 dígitos del catálogo del SAT; 01010101 si no aplica otra"></label>' +
            '<label class="fa-campo k6"><span>Unidad</span><select data-c="clave_unidad">' + opciones(cat.unidades, c.clave_unidad, true) + "</select></label>" +
            (ret ? '<label class="fa-campo k6"><span>Retención de ISR</span><select data-c="ret_isr">' + opciones(retIsr, c.ret_isr, false) + "</select></label>" +
                   '<label class="fa-campo k6"><span>Retención de IVA</span><select data-c="ret_iva">' + opciones(retIva, c.ret_iva, false) + "</select></label>" : "") +
            "</div></div>";
    }

    function pintarConceptos() {
        $("conceptos").innerHTML = F.conceptos.map(filaConcepto).join("");
        calcular();
    }

    function calcular() {
        var sub = 0, desc = 0, iva = 0, ret = 0;
        F.conceptos.forEach(function (c, i) {
            var importe = r2(num(c.cantidad) * num(c.valor_unitario)), d = r2(num(c.descuento)), base = importe - d;
            sub += importe; desc += d;
            if (c.objeto_imp === "02") {
                var tasa = { "16": 0.16, "8": 0.08 }[c.iva] || 0;
                iva += r2(base * tasa);
                var ri = { "10.6667": 0.106667, "4": 0.04, "6": 0.06, "16": 0.16 }[c.ret_iva] || 0;
                var rs = { "10": 0.10, "1.25": 0.0125 }[c.ret_isr] || 0;
                ret += r2(base * ri) + r2(base * rs);
            }
            var el = document.querySelector('.fa-concepto[data-i="' + i + '"] [data-importe]');
            if (el) el.textContent = dinero(importe);
        });
        var total = r2(sub - desc + iva - ret);
        $("t-subtotal").textContent = dinero(sub);
        $("t-descuento").textContent = "-" + dinero(desc);
        $("t-iva").textContent = dinero(iva);
        $("t-ret").textContent = "-" + dinero(ret);
        $("t-total").textContent = dinero(total);
        document.querySelectorAll('[data-fila="descuento"]').forEach(function (x) { x.hidden = !desc; });
        document.querySelectorAll('[data-fila="retenciones"]').forEach(function (x) { x.hidden = !ret; });
        $("t-letra").textContent = total > 0 ? enLetra(total) : "";
        return { total: total };
    }

    function captura() {
        var rel = $("rel-uuid").value.trim();
        return {
            tipo: F.tipo, metodo_pago: $("p-metodo").value, forma_pago: $("p-forma").value,
            condiciones: $("p-condiciones").value.trim() || null,
            receptor: { rfc: $("r-rfc").value.trim().toUpperCase(), nombre: $("r-nombre").value.trim().toUpperCase(),
                        cp: $("r-cp").value.trim(), regimen: $("r-regimen").value, uso: $("r-uso").value },
            relacionados: F.tipo === "E" && rel ? { tipo_relacion: $("rel-tipo").value, uuids: [rel] } : null,
            conceptos: F.conceptos.map(function (c) {
                return { cantidad: c.cantidad, clave_prod: (c.clave_prod || "").trim(), clave_unidad: c.clave_unidad,
                         descripcion: c.descripcion, valor_unitario: c.valor_unitario, descuento: c.descuento || 0,
                         objeto_imp: c.objeto_imp, iva: c.iva, ret_isr: c.ret_isr, ret_iva: c.ret_iva };
            })
        };
    }

    async function prepararTimbrado() {
        var err = $("t-error");
        err.hidden = true;
        var b = $("btn-timbrar");
        b.disabled = true; b.textContent = "Revisando…";
        try {
            var cap = captura();
            var r = await enviar("/api/facturacion/revisar", "POST", { rfc: F.emisor.rfc, captura: cap });
            F.pendiente = cap;
            var t = r.totales, serie = F.tipo === "I" ? F.emisor.serie_i : F.emisor.serie_e, folio = F.tipo === "I" ? F.emisor.folio_i : F.emisor.folio_e;
            $("conf-titulo").textContent = F.tipo === "I" ? "¿Timbrar esta factura?" : "¿Timbrar esta nota de crédito?";
            $("conf-resumen").innerHTML = '<dl class="fa-resumen">' +
                "<dt>Folio</dt><dd>" + esc((serie ? serie + "-" : "") + folio) + "</dd>" +
                "<dt>Emisor</dt><dd>" + esc(r.emisor.nombre + " · " + r.emisor.rfc) + "</dd>" +
                "<dt>Cliente</dt><dd>" + esc(cap.receptor.nombre + " · " + cap.receptor.rfc) + "</dd>" +
                "<dt>Conceptos</dt><dd>" + cap.conceptos.length + "</dd>" +
                "<dt>Total</dt><dd>" + dinero(t.total) + "</dd></dl>";
            $("conf-nota").textContent = F.cfg.produccion
                ? "Se manda al SAT y gasta 1 timbre de la empresa. Una vez timbrada ya no se puede editar: solo cancelar."
                : "Modo de pruebas: no gasta timbres ni tiene validez fiscal.";
            $("dlg-confirmar").showModal();
        } catch (e) {
            err.textContent = e.message; err.hidden = false;
        }
        b.disabled = false; pintarFolio();
    }

    async function timbrar() {
        var b = $("btn-confirmar");
        b.disabled = true; b.textContent = "Timbrando…";
        try {
            var r = await enviar("/api/facturacion/timbrar", "POST", { rfc: F.emisor.rfc, captura: F.pendiente });
            $("dlg-confirmar").close();
            F.ultimo = r;
            if (F.tipo === "I") F.emisor.folio_i = parseInt(r.folio, 10) + 1; else F.emisor.folio_e = parseInt(r.folio, 10) + 1;
            if (F.cfg.produccion && F.emisor.timbres !== null) F.emisor.timbres = Math.max((F.emisor.timbres || 0) - 1, 0);
            pintarEmisor();
            $("listo-titulo").textContent = (F.tipo === "I" ? "Factura " : "Nota de crédito ") + (r.serie ? r.serie + "-" : "") + r.folio + " timbrada";
            $("listo-texto").textContent = "Total " + dinero(r.total) + (r.pruebas ? " · modo de pruebas (sin validez fiscal)" : r.biblioteca ? " · ya está en Administración de XML" : "");
            $("listo-uuid").textContent = r.uuid;
            $("dlg-listo").showModal();
            nuevaFactura();                 // ya quedó timbrada: el formulario se limpia para no repetirla por error
            await cargarEmitidas();
        } catch (e) {
            $("dlg-confirmar").close();
            $("t-error").textContent = e.message; $("t-error").hidden = false;
        }
        b.disabled = false; b.textContent = "Timbrar";
    }

    /* Clientes a los que ya les facturó: al escribir su RFC se llenan sus datos */
    async function llenarReceptor() {
        var rfc = $("r-rfc").value.trim().toUpperCase();
        if (rfc === "XAXX010101000") { publico(); return; }
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

    function publico() {
        $("r-rfc").value = "XAXX010101000";
        $("r-nombre").value = "PUBLICO EN GENERAL";
        $("r-cp").value = F.emisor && F.emisor.cp || "";
        $("r-regimen").value = "616";
        $("r-uso").value = "S01";
    }

    /* ---------------------------------------------------- emitidas */
    async function cargarEmitidas() {
        if (!F.empresa) return;
        try { F.emitidas = await json("/api/facturacion/comprobantes?rfc=" + encodeURIComponent(F.empresa.rfc)); }
        catch (e) { F.emitidas = []; $("filas-emitidas").innerHTML = '<tr><td colspan="6">' + esc(e.message) + "</td></tr>"; return; }
        var vistos = {};
        $("lista-receptores").innerHTML = F.emitidas.filter(function (x) { if (vistos[x.receptor_rfc]) return false; vistos[x.receptor_rfc] = 1; return true; })
            .map(function (x) { return '<option value="' + esc(x.receptor_rfc) + '">' + esc(x.receptor_nombre) + "</option>"; }).join("");
        $("lista-facturas").innerHTML = F.emitidas.filter(function (x) { return x.tipo === "I" && x.estado !== "cancelado"; })
            .map(function (x) { return '<option value="' + esc(x.uuid) + '">' + esc((x.serie ? x.serie + "-" : "") + x.folio + " · " + x.receptor_nombre + " · " + dinero(x.total)) + "</option>"; }).join("");
        pintarEmitidas();
    }

    function pintarEmitidas() {
        var q = $("buscar-emitidas").value.trim().toLowerCase(), f = $("filtro-tipo").value;
        var filas = F.emitidas.filter(function (x) {
            if (f === "cancelado" ? x.estado !== "cancelado" : f && x.tipo !== f) return false;
            return !q || [x.receptor_nombre, x.receptor_rfc, (x.serie || "") + x.folio, (x.serie || "") + "-" + x.folio, x.uuid].join(" ").toLowerCase().indexOf(q) !== -1;
        });
        $("filas-emitidas").innerHTML = filas.length ? filas.map(function (x) {
            var estado = x.estado === "cancelado" ? '<span class="fa-chip fa-chip--mal">Cancelada</span>' : '<span class="fa-chip fa-chip--ok">Vigente</span>';
            if (x.pruebas) estado += ' <span class="fa-chip fa-chip--prueba">Prueba</span>';
            return '<tr data-id="' + esc(x.id) + '"><td>' + esc(fechaCorta(x.fecha)) + "</td>" +
                "<td><b>" + esc((x.serie ? x.serie + "-" : "") + x.folio) + "</b><small>" + (x.tipo === "I" ? "Factura" : "Nota de crédito") + "</small></td>" +
                "<td>" + esc(x.receptor_nombre) + "<small>" + esc(x.receptor_rfc) + "</small></td>" +
                '<td class="fa-num">' + dinero(x.total) + "</td><td>" + estado + "</td>" +
                '<td class="fa-acc"><button type="button" class="fa-link" data-acc="xml">XML</button>' +
                '<button type="button" class="fa-link" data-acc="pdf">PDF</button>' +
                (x.estado !== "cancelado" ? '<button type="button" class="fa-link fa-link--rojo" data-acc="cancelar">Cancelar</button>' : "") + "</td></tr>";
        }).join("") : '<tr><td colspan="6">' + (F.emitidas.length ? "Nada coincide." : "Todavía no hay facturas de esta empresa.") + "</td></tr>";
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

    async function verPdf(id) {
        try {
            var d = await json("/api/facturacion/comprobantes/" + id);
            $("impresion").innerHTML = representacion(d);
            $("dlg-pdf").showModal();
        } catch (e) { aviso(e.message, "error"); }
    }

    function representacion(d) {
        var x = d.datos, f = x.factura, em = x.emisor, re = x.receptor, t = d.timbre || {}, cat = F.cfg.catalogos;
        var titulo = d.tipo === "I" ? "Factura" : "Nota de crédito";
        var filas = (x.conceptos || []).map(function (c) {
            var impuestos = ((c.Impuestos || {}).Traslados || []).map(function (i) { return i.TipoFactor === "Exento" ? "IVA exento" : "IVA " + (num(i.TasaOCuota) * 100).toFixed(0) + "%"; })
                .concat(((c.Impuestos || {}).Retenciones || []).map(function (i) { return "Ret. " + (i.Impuesto === "001" ? "ISR" : "IVA") + " " + (num(i.TasaOCuota) * 100).toFixed(4).replace(/\.?0+$/, "") + "%"; }));
            return "<tr><td>" + esc(c.ClaveProdServ) + "</td><td class='n'>" + esc(c.cantidad) + "</td><td>" + esc(c.ClaveUnidad + " " + (c.unidad || "")) + "</td>" +
                "<td>" + esc(c.descripcion) + (impuestos.length ? "<br><small>" + esc(impuestos.join(" · ")) + "</small>" : "") + "</td>" +
                "<td class='n'>" + dinero(c.valorunitario) + "</td><td class='n'>" + (c.Descuento ? dinero(c.Descuento) : "") + "</td><td class='n'>" + dinero(c.importe) + "</td></tr>";
        }).join("");
        var imp = x.impuestos || {};
        var rel = (x.CfdisRelacionados || []).map(function (r) { return "Relación " + r.TipoRelacion + ": " + (r.UUID || []).join(", "); }).join("<br>");
        return (d.pruebas ? '<div class="fi-prueba">MODO DE PRUEBAS · SIN VALIDEZ FISCAL</div>' : "") +
            (d.estado === "cancelado" ? '<div class="fi-cancelada">CANCELADA</div>' : "") +
            '<div class="fi-cabeza"><div><h1>' + esc(em.nombre) + "</h1><div>RFC " + esc(em.rfc) + "</div><div>Régimen " + esc(em.RegimenFiscal + " " + (cat.regimenes[em.RegimenFiscal] || "")) + "</div>" +
            "<div>Lugar de expedición " + esc(f.LugarExpedicion) + "</div></div>" +
            '<div class="fi-folio"><b>' + titulo + " " + esc((f.serie ? f.serie + "-" : "") + f.folio) + "</b><div>Fecha " + esc((f.fecha_expedicion || "").replace("T", " ")) + "</div>" +
            "<div>Folio fiscal</div><div class='fa-mono'>" + esc(d.uuid) + "</div></div></div>" +
            '<div class="fi-dos"><div class="fi-bloque"><h3>Cliente</h3><b>' + esc(re.nombre) + "</b><div>RFC " + esc(re.rfc) + "</div><div>C.P. " + esc(re.DomicilioFiscalReceptor) +
            " · Régimen " + esc(re.RegimenFiscalReceptor) + "</div><div>Uso CFDI " + esc(re.UsoCFDI + " " + (cat.usos[re.UsoCFDI] || "")) + "</div></div>" +
            '<div class="fi-bloque"><h3>Pago</h3><div>Método ' + esc(f.metodo_pago + " " + (cat.metodos_pago[f.metodo_pago] || "")) + "</div><div>Forma " + esc(f.forma_pago + " " + (cat.formas_pago[f.forma_pago] || "")) +
            "</div><div>Moneda MXN · Exportación 01</div>" + (f.condicionesDePago ? "<div>Condiciones: " + esc(f.condicionesDePago) + "</div>" : "") + (rel ? "<div>" + rel + "</div>" : "") + "</div></div>" +
            '<table class="fi-tabla"><thead><tr><th>Clave</th><th class="n">Cant.</th><th>Unidad</th><th>Descripción</th><th class="n">P. unitario</th><th class="n">Desc.</th><th class="n">Importe</th></tr></thead><tbody>' + filas + "</tbody></table>" +
            '<div class="fi-pie"><div><b>Importe con letra:</b> ' + esc(enLetra(num(f.total))) + "</div><table class='fi-totales'>" +
            "<tr><td>Subtotal</td><td class='n'>" + dinero(f.subtotal) + "</td></tr>" +
            (f.descuento ? "<tr><td>Descuento</td><td class='n'>-" + dinero(f.descuento) + "</td></tr>" : "") +
            (imp.TotalImpuestosTrasladados ? "<tr><td>IVA trasladado</td><td class='n'>" + dinero(imp.TotalImpuestosTrasladados) + "</td></tr>" : "") +
            (imp.TotalImpuestosRetenidos ? "<tr><td>Retenciones</td><td class='n'>-" + dinero(imp.TotalImpuestosRetenidos) + "</td></tr>" : "") +
            "<tr class='t'><td>Total</td><td class='n'>" + dinero(f.total) + "</td></tr></table></div>" +
            '<div class="fi-sellos">' + (d.qr ? '<img alt="Código QR" src="data:image/png;base64,' + esc(d.qr) + '">' : "<div></div>") + "<div>" +
            "<p><b>No. de certificado del emisor:</b> " + esc(t.certificado_no || "") + " · <b>Certificado del SAT:</b> " + esc(t.certificadoSAT || "") + " · <b>Fecha de timbrado:</b> " + esc(t.fecha_timbrado || "") + "</p>" +
            "<p><b>Sello digital del CFDI:</b> " + esc(t.sello || "") + "</p><p><b>Sello del SAT:</b> " + esc(t.selloSAT || "") + "</p>" +
            "<p><b>Cadena original del complemento de certificación digital del SAT:</b> " + esc(t.cadena || "") + "</p></div></div>" +
            '<p class="fi-leyenda">Este documento es una representación impresa de un CFDI 4.0.</p>';
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
        b.disabled = true; b.textContent = "Cancelando…";
        try {
            await enviar("/api/facturacion/comprobantes/" + F.cancelando.id + "/cancelar", "POST",
                { motivo: $("can-motivo").value, uuid_sustitucion: $("can-sust").value.trim() || null });
            $("dlg-cancelar").close();
            aviso("Se mandó la cancelación de " + $("can-folio").textContent + " al SAT.");
            cargarEmitidas();
        } catch (e) { $("can-error").textContent = e.message; $("can-error").hidden = false; }
        b.disabled = false; b.textContent = "Cancelar ante el SAT";
    }

    /* ---------------------------------------------------- eventos */
    function eventos() {
        document.querySelectorAll("[data-vista]").forEach(function (b) { b.addEventListener("click", function () { vista(b.dataset.vista); }); });
        document.addEventListener("click", function (ev) {
            var ir = ev.target.closest("[data-ir]"); if (ir) vista(ir.dataset.ir);
            var cerrar = ev.target.closest("[data-cerrar]"); if (cerrar) cerrar.closest("dialog").close();
        });
        document.querySelectorAll("[data-tipo]").forEach(function (b) { b.addEventListener("click", function () { ponerTipo(b.dataset.tipo); }); });
        $("btn-publico").addEventListener("click", publico);
        $("r-rfc").addEventListener("change", llenarReceptor);
        $("p-metodo").addEventListener("change", function () {
            if (this.value === "PPD") $("p-forma").value = "99";
            else if ($("p-forma").value === "99") $("p-forma").value = "03";
            $("p-forma").disabled = this.value === "PPD";
        });
        $("btn-concepto").addEventListener("click", function () { F.conceptos.push(conceptoVacio()); pintarConceptos(); });
        $("ver-retenciones").addEventListener("change", pintarConceptos);
        $("conceptos").addEventListener("input", function (ev) {
            var campo = ev.target.closest("[data-c]"); if (!campo) return;
            var i = +campo.closest("[data-i]").dataset.i, c = F.conceptos[i];
            if (campo.dataset.c === "iva") {
                c.objeto_imp = campo.value === "no" ? "01" : "02";
                c.iva = campo.value === "no" ? "16" : campo.value;
            } else c[campo.dataset.c] = campo.value;
            calcular();
        });
        $("conceptos").addEventListener("click", function (ev) {
            if (!ev.target.closest("[data-quitar]")) return;
            F.conceptos.splice(+ev.target.closest("[data-i]").dataset.i, 1);
            pintarConceptos();
        });
        $("btn-timbrar").addEventListener("click", prepararTimbrado);
        $("btn-confirmar").addEventListener("click", timbrar);
        $("listo-xml").addEventListener("click", function () { bajarXml(F.ultimo.id); });
        $("listo-pdf").addEventListener("click", function () { $("dlg-listo").close(); verPdf(F.ultimo.id); });
        $("listo-otra").addEventListener("click", function () { $("dlg-listo").close(); $("r-rfc").focus(); });
        $("buscar-emitidas").addEventListener("input", pintarEmitidas);
        $("filtro-tipo").addEventListener("change", pintarEmitidas);
        $("filas-emitidas").addEventListener("click", function (ev) {
            var b = ev.target.closest("[data-acc]"); if (!b) return;
            var id = b.closest("tr").dataset.id;
            if (b.dataset.acc === "xml") bajarXml(id);
            else if (b.dataset.acc === "pdf") verPdf(id);
            else abrirCancelar(id);
        });
        $("can-motivo").addEventListener("change", function () { $("can-sust-caja").hidden = this.value !== "01"; });
        $("btn-cancelar-ok").addEventListener("click", cancelar);
        $("btn-imprimir").addEventListener("click", function () { window.print(); });
        $("btn-guardar-config").addEventListener("click", guardarConfig);
        $("btn-guardar-csd").addEventListener("click", guardarCsd);
        $("btn-reemplazar-csd").addEventListener("click", function () { $("c-csd-form").hidden = false; this.hidden = true; });
        $("btn-quitar-csd").addEventListener("click", quitarCsd);
        $("btn-dar-timbres").addEventListener("click", function () { moverTimbres(1); });
        $("btn-quitar-timbres").addEventListener("click", function () { moverTimbres(-1); });
    }

    iniciar();
})();
