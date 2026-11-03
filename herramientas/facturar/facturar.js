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
              receptores: [], borradores: [], borradorId: null, tcManual: false, origen: "emitidas", vistaUrl: null, vistaNombre: "" };

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
        var hoy = new Date();
        $("g-periodicidad").innerHTML = opciones(c.periodicidades, "04", true);
        $("g-meses").innerHTML = opciones(c.meses_global, String(hoy.getMonth() + 1).padStart(2, "0"), true);
        $("g-anio").value = hoy.getFullYear();
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
        cargarReceptores();
        cargarBorradores();
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
        chip.hidden = false;
        chip.textContent = prod ? "Timbres: " + (e.timbres || 0) : "Mis timbres";
        chip.className = "fa-chip fa-chip--boton" + (prod && (e.timbres || 0) < 1 ? " fa-chip--mal" : "");
        $("punto-config").hidden = e.listo;
        var falta = $("falta-config");
        var faltan = e.faltan.slice();
        if (prod && (e.timbres || 0) < 1) faltan.push("pasarle timbres");
        if (prod && faltan.length) {
            falta.innerHTML = "Para timbrar con <b>" + esc(e.alias) + "</b> falta: " + esc(faltan.join(", ")) +
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
        pintarLogo();
        $("c-timbres-empresa").textContent = e.timbres || 0;
        $("c-timbres-cuenta").textContent = F.cfg.timbres_cuenta === null ? "Sin tope" : (F.cfg.timbres_cuenta || 0);
        $("c-timbres-pac").textContent = !prod ? "En modo de pruebas no se gastan timbres; lo que repartas aquí se usará cuando se active producción."
            : !F.cfg.panel ? "Falta configurar en el servidor el acceso al panel de MultiFacturas: avísale al administrador."
            : e.alta_pac ? "✓ Dada de alta en MultiFacturas. Lo que le pases aquí se le pasa también allá."
            : "La primera vez que le pases timbres se da de alta sola en MultiFacturas.";
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
            actualizarEmisor(Object.assign({}, F.emisor, { timbres: r.timbres_empresa, alta_pac: F.emisor.alta_pac || !!r.en_pac }));
            $("msj-timbres").textContent = r.en_pac ? "✓ Listo. En MultiFacturas puede tardar hasta 5 minutos en aplicarse." : "✓ Listo.";
        } catch (e) { $("msj-timbres").textContent = e.message; }
    }

    /* ---------------------------------------------------- nueva factura */
    function conceptoVacio() {
        return { cantidad: 1, clave_unidad: "E48", clave_prod: "01010101", descripcion: "", valor_unitario: "", descuento: "", iva: "16", objeto_imp: "02", ret_isr: "", ret_iva: "", no_identificacion: "" };
    }

    function nuevaFactura() {
        F.conceptos = [conceptoVacio()];
        F.borradorId = null; F.tcManual = false;
        ["r-rfc", "r-nombre", "r-cp", "rel-uuid", "p-condiciones", "r-buscar", "p-tc", "p-fecha", "p-notas"].forEach(function (id) { $(id).value = ""; });
        $("r-regimen").value = "";
        $("r-uso").value = F.tipo === "E" ? "G02" : "G03";
        $("p-moneda").value = "MXN";
        $("r-guardar").checked = true;
        $("r-aviso").hidden = true;
        $("t-error").hidden = true;
        $("estado-borrador").textContent = "";
        verMoneda();
        verFecha();
        verGlobal();
        pintarConceptos();
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
        $("p-fecha").value = "";                   // la fecha es la de hoy (o la que elijas), no la de la original
        $("p-notas").value = cap.notas || "";
        $("r-guardar").checked = cap.guardar_cliente !== false;
        var rel = cap.relacionados || {};
        $("rel-uuid").value = (rel.uuids || [])[0] || "";
        if (rel.tipo_relacion) $("rel-tipo").value = rel.tipo_relacion;
        var g = cap.global || {};
        if (g.periodicidad) $("g-periodicidad").value = g.periodicidad;
        if (g.meses) $("g-meses").value = g.meses;
        if (g.anio) $("g-anio").value = g.anio;
        F.conceptos = (cap.conceptos || []).map(function (c) { return Object.assign(conceptoVacio(), c, { descuento: c.descuento || "" }); });
        if (!F.conceptos.length) F.conceptos = [conceptoVacio()];
        if (F.conceptos.some(function (c) { return c.ret_isr || c.ret_iva; })) $("ver-retenciones").checked = true;
        verMoneda(); verFecha(); verGlobal(); pintarConceptos();
        $("t-error").hidden = true;
        var a = $("r-aviso");
        a.hidden = !(avisos && avisos.length);
        a.innerHTML = avisos && avisos.length ? "<b>Revisa:</b> " + avisos.map(esc).join(" · ") : "";
        vista("nueva");
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function ponerTipo(tipo) {
        F.tipo = tipo;
        document.querySelectorAll("[data-tipo]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.tipo === tipo)); });
        $("caja-relacion").hidden = tipo !== "E";
        if (tipo === "E" && $("r-uso").value === "G03") $("r-uso").value = "G02";
        if (tipo === "I" && $("r-uso").value === "G02") $("r-uso").value = "G03";
        pintarFolio();
        verGlobal();
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
        var mon = $("p-moneda").value;
        $("t-letra").textContent = total > 0 ? enLetra(total, mon) : "";
        document.querySelector("dt.fa-total").textContent = "Total " + (mon === "USD" ? "USD" : "");
        return { total: total };
    }

    function captura() {
        var rel = $("rel-uuid").value.trim();
        return {
            tipo: F.tipo, metodo_pago: $("p-metodo").value, forma_pago: $("p-forma").value,
            condiciones: $("p-condiciones").value.trim() || null,
            moneda: $("p-moneda").value, tipo_cambio: $("p-moneda").value === "USD" ? $("p-tc").value.trim() : null,
            fecha: $("p-fecha").value || null, notas: $("p-notas").value.trim() || null, guardar_cliente: $("r-guardar").checked,
            receptor: { rfc: $("r-rfc").value.trim().toUpperCase(), nombre: $("r-nombre").value.trim().toUpperCase(),
                        cp: $("r-cp").value.trim(), regimen: $("r-regimen").value, uso: $("r-uso").value },
            relacionados: F.tipo === "E" && rel ? { tipo_relacion: $("rel-tipo").value, uuids: [rel] } : null,
            global: { periodicidad: $("g-periodicidad").value, meses: $("g-meses").value, anio: $("g-anio").value.trim() },
            conceptos: F.conceptos.map(function (c) {
                return { cantidad: c.cantidad, clave_prod: (c.clave_prod || "").trim(), clave_unidad: c.clave_unidad,
                         descripcion: c.descripcion, valor_unitario: c.valor_unitario, descuento: c.descuento || 0,
                         objeto_imp: c.objeto_imp, iva: c.iva, ret_isr: c.ret_isr, ret_iva: c.ret_iva, no_identificacion: c.no_identificacion || "" };
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
                "<dt>Fecha de emisión</dt><dd>" + esc((r.fecha || "").replace("T", " ")) + (cap.fecha ? "" : " <small>(se pone al timbrar)</small>") + "</dd>" +
                "<dt>Conceptos</dt><dd>" + cap.conceptos.length + "</dd>" +
                "<dt>Total</dt><dd>" + dinero(t.total) + (r.moneda === "USD" ? " USD · T.C. " + esc(r.tipo_cambio) : "") + "</dd></dl>";
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
            if (F.cfg.produccion) F.emisor.timbres = Math.max((F.emisor.timbres || 0) - 1, 0);
            pintarEmisor();
            $("listo-titulo").textContent = (F.tipo === "I" ? "Factura " : "Nota de crédito ") + (r.serie ? r.serie + "-" : "") + r.folio + " timbrada";
            $("listo-texto").textContent = "Total " + dinero(r.total) + (r.pruebas ? " · modo de pruebas (sin validez fiscal)" : r.biblioteca ? " · ya está en Administración de XML" : "");
            $("listo-uuid").textContent = r.uuid;
            $("dlg-listo").showModal();
            nuevaFactura();                 // ya quedó timbrada: el formulario se limpia para no repetirla por error
            await cargarEmitidas();
            cargarReceptores();
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
        var opciones = F.receptores.map(function (r) { vistos[r.rfc] = 1; return '<option value="' + esc(r.rfc + " · " + r.nombre) + '"></option>'; });
        F.emitidas.forEach(function (x) {
            if (!vistos[x.receptor_rfc] && x.receptor_rfc !== "XAXX010101000") { vistos[x.receptor_rfc] = 1; opciones.push('<option value="' + esc(x.receptor_rfc + " · " + x.receptor_nombre) + '"></option>'); }
        });
        $("lista-receptores").innerHTML = opciones.join("");
    }

    function ponerReceptor(r) {
        $("r-rfc").value = r.rfc || ""; $("r-nombre").value = r.nombre || ""; $("r-cp").value = r.cp || "";
        if (r.regimen) $("r-regimen").value = r.regimen;
        if (r.uso && !(F.tipo === "E" && r.uso !== "G02")) $("r-uso").value = F.tipo === "E" ? "G02" : r.uso;
        verGlobal();
    }

    function elegirDelBuscador() {
        var rfc = ($("r-buscar").value.split(" · ")[0] || "").trim().toUpperCase();
        if (!rfc) return;
        var r = F.receptores.filter(function (x) { return x.rfc === rfc; })[0];
        if (r) ponerReceptor(r);
        else { $("r-rfc").value = rfc; $("r-nombre").value = ""; $("r-cp").value = ""; $("r-regimen").value = ""; llenarReceptor(); }
        $("r-buscar").value = "";
    }

    async function leerConstancia(archivo) {
        if (!archivo) return;
        var a = $("r-aviso");
        a.hidden = false; a.textContent = "Leyendo la constancia…";
        try {
            var cuerpo = new FormData(); cuerpo.append("archivo", archivo);
            var r = await json("/api/facturacion/leer-constancia", { method: "POST", body: cuerpo });
            ponerReceptor({ rfc: r.rfc, nombre: r.nombre, cp: r.cp, regimen: r.regimenes[0] || "" });
            var cat = F.cfg.catalogos.regimenes;
            a.innerHTML = "✓ Datos de su constancia" + (r.regimenes.length > 1
                ? ". Tiene varios regímenes: " + r.regimenes.map(function (k) { return esc(k + " " + (cat[k] || "")); }).join(", ") + "; elige el que corresponda a esta factura."
                : r.regimenes.length ? "." : ". No trae régimen vigente: elígelo.");
            if ($("r-guardar").checked && r.nombre) {
                try {
                    await enviar("/api/facturacion/receptores", "PUT", { rfc_emisor: F.emisor.rfc, rfc: r.rfc, nombre: r.nombre, cp: r.cp, regimen: r.regimenes[0] || null });
                    cargarReceptores();
                    a.innerHTML += " Quedó en sus clientes.";
                } catch (e) { /* se guarda al timbrar */ }
            }
        } catch (e) { a.textContent = e.message; }
        $("r-constancia").value = "";
    }

    async function llenarReceptor() {
        var rfc = $("r-rfc").value.trim().toUpperCase();
        if (rfc === "XAXX010101000") { publico(); return; }
        var guardado = F.receptores.filter(function (x) { return x.rfc === rfc; })[0];
        if (guardado) { if (!$("r-nombre").value) ponerReceptor(guardado); return; }
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
        verGlobal();
    }

    /* ---------------------------------------------------- emitidas */
    async function cargarEmitidas() {
        if (!F.empresa) return;
        try { F.emitidas = await json("/api/facturacion/comprobantes?rfc=" + encodeURIComponent(F.empresa.rfc)); }
        catch (e) { F.emitidas = []; $("filas-emitidas").innerHTML = '<tr><td colspan="6">' + esc(e.message) + "</td></tr>"; return; }
        cargarReceptores();
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
                '<td class="fa-acc"><button type="button" class="fa-link" data-acc="pdf">PDF</button>' +
                '<button type="button" class="fa-link" data-acc="xml">XML</button>' +
                '<button type="button" class="fa-link" data-acc="copiar" title="Una nueva igual a esta">Copiar</button>' +
                (x.pruebas ? "" : '<button type="button" class="fa-link" data-acc="sat" title="Consultar si está vigente o cancelada en el SAT">SAT</button>') +
                (x.hay_acuse ? '<button type="button" class="fa-link" data-acc="acuse">Acuse</button>' : "") +
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
            await bajarRespuesta(await api("/api/facturacion/comprobantes/" + id + "/pdf"), x ? (x.serie || "") + x.folio + ".pdf" : "factura.pdf");
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
        b.disabled = true; b.textContent = "Cancelando…";
        try {
            var r = await enviar("/api/facturacion/comprobantes/" + F.cancelando.id + "/cancelar", "POST",
                { motivo: $("can-motivo").value, uuid_sustitucion: $("can-sust").value.trim() || null });
            $("dlg-cancelar").close();
            aviso($("can-folio").textContent + ": " + r.mensaje + (r.acuse ? " El acuse queda en Emitidas." : ""));
            cargarEmitidas();
        } catch (e) { $("can-error").textContent = e.message; $("can-error").hidden = false; cargarEmitidas(); }
        b.disabled = false; b.textContent = "Cancelar ante el SAT";
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
        if (!$("p-moneda").value || $("p-moneda").value === "MXN")
            $("p-nota").textContent = $("p-fecha").value ? "Fecha de emisión elegida (el SAT acepta hasta 72 horas atrás)." : "Sin fecha: se pone la hora en que timbres. Puedes elegir una de hasta 72 horas atrás.";
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
            $("vista-marco").src = F.vistaUrl;
            $("dlg-vista").showModal();
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
            $("estado-borrador").textContent = "✓ Prefactura «" + r.nombre + "» guardada.";
            cargarBorradores();
        } catch (e) { $("t-error").textContent = e.message; $("t-error").hidden = false; }
    }

    function pintarBorradores() {
        $("lista-borradores").innerHTML = F.borradores.length ? F.borradores.map(function (x) {
            return '<div class="fa-item" data-id="' + esc(x.id) + '"><div class="fa-item__txt"><b>' + esc(x.nombre) + "</b><small>" +
                esc((x.tipo === "E" ? "Nota de crédito · " : "") + x.receptor + " · " + fechaCorta(x.actualizado_en + "Z")) + "</small></div>" +
                (x.total != null ? '<span class="fa-item__monto">' + dinero(x.total) + "</span>" : "") +
                '<button type="button" class="fa-btn fa-btn--suave" data-abrir>Abrir</button><button type="button" class="fa-quitar" data-borrar title="Borrar">✕</button></div>';
        }).join("") : '<p class="fa-vacio-chico">Todavía no hay prefacturas. Llena una factura y usa «Guardar prefactura».</p>';
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
        try {
            var r = clave.slice(0, 2) === "e:" ? await json("/api/facturacion/comprobantes/" + clave.slice(2) + "/captura")
                : await json("/api/facturacion/desde-xml?rfc=" + encodeURIComponent(F.empresa.rfc) + "&uuid=" + encodeURIComponent(clave.slice(2)));
            $("dlg-copiar").close();
            F.borradorId = null;
            ponerCaptura(r.captura, r.avisos);
            $("estado-borrador").textContent = "Copiada: revisa y timbra.";
        } catch (e) { aviso(e.message, "error"); }
    }

    async function copiarDeArchivo(archivo) {
        if (!archivo) return;
        try {
            var cuerpo = new FormData(); cuerpo.append("archivo", archivo);
            var r = await json("/api/facturacion/leer-xml", { method: "POST", body: cuerpo });
            F.borradorId = null;
            ponerCaptura(r.captura, r.avisos);
            $("estado-borrador").textContent = "Copiada de " + archivo.name + ": revisa y timbra.";
        } catch (e) { aviso(e.message, "error"); }
        $("subir-xml").value = "";
    }

    /* ---------------------------------------------------- logo */
    async function pintarLogo() {
        var caja = $("c-logo-vista");
        $("btn-quitar-logo").hidden = !F.emisor.logo;
        if (!F.emisor.logo) { caja.innerHTML = "<span>Sin logo</span>"; return; }
        try {
            var b = await (await api("/api/facturacion/emisores/" + encodeURIComponent(F.emisor.rfc) + "/logo?_=" + Date.now())).blob();
            caja.innerHTML = '<img alt="Logo" src="' + URL.createObjectURL(b) + '">';
        } catch (e) { caja.innerHTML = "<span>Sin logo</span>"; }
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
            if (t.bolsa !== undefined) {
                var b = t.bolsa || {};
                h += tarjeta("Bolsa general en MultiFacturas", b.timbres, b.timbres == null ? "Escríbela abajo una vez" :
                    (b.ultimo ? "Último movimiento: " + esc(b.ultimo.detalle) : "Ajustada el " + esc(fechaCorta((b.ajustado || "") + "Z"))), "fa-destacado");
            }
            if (!t.sin_tope) h += tarjeta("Sin repartir en tu cuenta", t.cuenta, "Te los asigna el administrador", "fa-destacado");
            h += tarjeta("Repartidos en tus empresas", t.en_empresas, t.empresas.length + " empresa" + (t.empresas.length === 1 ? "" : "s"));
            h += tarjeta("Facturas reales timbradas", t.facturas_reales, "Desde que se activó producción");
            h += "</div>";
            if (t.bolsa !== undefined) {
                h += '<p class="fa-nota">MultiFacturas no deja consultar la bolsa general por su API: escribe el «SALDO» que ves arriba en su panel y Fiscontable lo va bajando cada vez que le pasas timbres a una empresa.</p>' +
                     '<div class="fa-ajustar"><label class="fa-campo"><span>Saldo en el panel</span><input id="bolsa-n" type="number" min="0" value="' + esc((t.bolsa || {}).timbres == null ? "" : t.bolsa.timbres) + '"></label>' +
                     '<button type="button" id="btn-bolsa" class="fa-btn fa-btn--principal">Guardar</button><span id="msj-bolsa" class="fa-nota"></span></div>';
            }
            h += t.empresas.length ? '<table class="fa-tabla"><thead><tr><th>Empresa</th><th class="fa-num">En Fiscontable</th><th class="fa-num">En MultiFacturas</th></tr></thead><tbody>' +
                t.empresas.map(function (e) {
                    return "<tr><td>" + esc(e.nombre) + "<small>" + esc(e.rfc) + "</small></td><td class='fa-num'>" + e.timbres + "</td><td class='fa-num'>" +
                        (e.real != null ? e.real + (e.real !== e.timbres ? ' <small>(se iguala al timbrar)</small>' : "") : e.alta ? "—" : "<small>Sin alta aún</small>") + "</td></tr>";
                }).join("") + "</tbody></table>" : '<p class="fa-vacio-chico">Todavía no le has pasado timbres a ninguna empresa.</p>';
            $("timbres-cuerpo").innerHTML = h;
        } catch (e) { $("timbres-cuerpo").innerHTML = '<p class="fa-error">' + esc(e.message) + "</p>"; }
    }

    async function guardarBolsa() {
        var n = parseInt($("bolsa-n").value, 10);
        if (isNaN(n) || n < 0) { $("msj-bolsa").textContent = "Escribe el saldo."; return; }
        try { await enviar("/api/admin/facturacion/bolsa", "PUT", { timbres: n }); verTimbres(); }
        catch (e) { $("msj-bolsa").textContent = e.message; }
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
        $("r-buscar").addEventListener("change", elegirDelBuscador);
        $("r-constancia").addEventListener("change", function () { leerConstancia(this.files[0]); });
        $("p-moneda").addEventListener("change", verMoneda);
        $("p-tc").addEventListener("input", function () { F.tcManual = true; });
        $("p-fecha").addEventListener("change", function () { verFecha(); if ($("p-moneda").value === "USD" && !F.tcManual) { $("p-tc").value = ""; traerTipoCambio(); } });
        $("btn-vista").addEventListener("click", vistaPrevia);
        $("vista-bajar").addEventListener("click", function () { if (F.vistaBlob) Fiscontable.guardarArchivo(F.vistaBlob, F.vistaNombre); });
        $("btn-borrador").addEventListener("click", guardarBorrador);
        $("btn-ver-borradores").addEventListener("click", function () { pintarBorradores(); $("dlg-borradores").showModal(); });
        $("lista-borradores").addEventListener("click", async function (ev) {
            var it = ev.target.closest("[data-id]"); if (!it) return;
            var x = F.borradores.filter(function (b) { return b.id === it.dataset.id; })[0]; if (!x) return;
            if (ev.target.closest("[data-borrar]")) {
                if (!confirm("¿Borrar la prefactura «" + x.nombre + "»?")) return;
                try { await api("/api/facturacion/borradores/" + x.id, { method: "DELETE" }); if (F.borradorId === x.id) F.borradorId = null; await cargarBorradores(); pintarBorradores(); }
                catch (e) { aviso(e.message, "error"); }
                return;
            }
            $("dlg-borradores").close();
            ponerCaptura(x.captura);
            F.borradorId = x.id;
            $("estado-borrador").textContent = "Prefactura «" + x.nombre + "» abierta.";
        });
        $("btn-copiar").addEventListener("click", abrirCopiar);
        document.querySelectorAll("[data-origen]").forEach(function (b) { b.addEventListener("click", function () { ponerOrigen(b.dataset.origen); }); });
        $("copiar-buscar").addEventListener("input", pintarCopiar);
        $("lista-copiar").addEventListener("click", function (ev) { var it = ev.target.closest("[data-copiar]"); if (it) copiarDe(it.dataset.copiar); });
        $("subir-xml").addEventListener("change", function () { copiarDeArchivo(this.files[0]); });
        $("btn-limpiar").addEventListener("click", function () { if (confirm("¿Borrar lo capturado y empezar una factura nueva?")) nuevaFactura(); });
        $("chip-timbres").addEventListener("click", verTimbres);
        $("timbres-cuerpo").addEventListener("click", function (ev) { if (ev.target.closest("#btn-bolsa")) guardarBolsa(); });
        $("c-logo").addEventListener("change", function () { subirLogo(this.files[0]); });
        $("btn-quitar-logo").addEventListener("click", quitarLogo);
        $("r-rfc").addEventListener("change", llenarReceptor);
        $("r-rfc").addEventListener("input", verGlobal);
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
        $("listo-pdf").addEventListener("click", function () { verPdf(F.ultimo.id); });
        $("listo-otra").addEventListener("click", function () { $("dlg-listo").close(); $("r-rfc").focus(); });
        $("buscar-emitidas").addEventListener("input", pintarEmitidas);
        $("filtro-tipo").addEventListener("change", pintarEmitidas);
        $("filas-emitidas").addEventListener("click", function (ev) {
            var b = ev.target.closest("[data-acc]"); if (!b) return;
            var id = b.closest("tr").dataset.id;
            if (b.dataset.acc === "xml") bajarXml(id);
            else if (b.dataset.acc === "acuse") bajarAcuse(id);
            else if (b.dataset.acc === "pdf") verPdf(id);
            else if (b.dataset.acc === "copiar") copiarDe("e:" + id);
            else if (b.dataset.acc === "sat") revisarSat(id, b);
            else abrirCancelar(id);
        });
        $("can-motivo").addEventListener("change", function () { $("can-sust-caja").hidden = this.value !== "01"; });
        $("btn-cancelar-ok").addEventListener("click", cancelar);
        $("btn-guardar-config").addEventListener("click", guardarConfig);
        $("btn-guardar-csd").addEventListener("click", guardarCsd);
        $("btn-reemplazar-csd").addEventListener("click", function () { $("c-csd-form").hidden = false; this.hidden = true; });
        $("btn-quitar-csd").addEventListener("click", quitarCsd);
        $("btn-dar-timbres").addEventListener("click", function () { moverTimbres(1); });
        $("btn-quitar-timbres").addEventListener("click", function () { moverTimbres(-1); });
    }

    iniciar();
})();
