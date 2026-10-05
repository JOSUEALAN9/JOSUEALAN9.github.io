/**
 * detalle.js — Detalle de un CFDI, en su propia pestaña.
 * Dirección: /herramientas/xml/detalle/?rfc=...&uuid=...
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var fm = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var fn = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 6 });
    var P = new URLSearchParams(location.search);
    var RFC = (P.get("rfc") || "").toUpperCase(), UUID = (P.get("uuid") || "").toUpperCase();

    var TIPOS = { I: "Ingreso", E: "Egreso", T: "Traslado", N: "Nómina", P: "Pago" };
    var FORMA = { "01": "Efectivo", "02": "Cheque nominativo", "03": "Transferencia electrónica", "04": "Tarjeta de crédito", "05": "Monedero electrónico",
        "06": "Dinero electrónico", "08": "Vales de despensa", "12": "Dación en pago", "15": "Condonación", "17": "Compensación", "28": "Tarjeta de débito",
        "29": "Tarjeta de servicios", "30": "Aplicación de anticipos", "99": "Por definir" };
    var IMP = { "001": "ISR", "002": "IVA", "003": "IEPS" };
    var RELACION = { "01": "Nota de crédito", "02": "Nota de débito", "03": "Devolución", "04": "Sustitución", "05": "Traslados previos",
        "06": "Factura por traslados", "07": "Aplicación de anticipo" };
    var PERCEPCION = { "001": "Sueldos", "002": "Aguinaldo", "003": "PTU", "019": "Horas extra", "020": "Prima dominical", "021": "Prima vacacional",
        "022": "Prima de antigüedad", "023": "Pagos por separación", "025": "Indemnizaciones", "028": "Comisiones", "029": "Vales de despensa", "038": "Otros ingresos por salarios", "046": "Asimilados" };
    var DEDUCCION = { "001": "IMSS", "002": "ISR", "003": "Aportaciones a retiro", "004": "Otros", "005": "Fondo de vivienda", "006": "Incapacidad", "007": "Pensión alimenticia",
        "009": "INFONAVIT", "010": "Crédito de vivienda", "011": "FONACOT", "012": "Anticipo de salarios", "020": "Ausentismo" };
    var OTRO = { "001": "Reintegro de ISR", "002": "Subsidio para el empleo", "003": "Viáticos", "004": "Saldo a favor", "999": "Pagos distintos" };

    function m(v) { return v === null || v === undefined ? "" : fm.format(v); }
    function f(s) { return s ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) + (s.length > 10 ? " " + s.slice(11, 16) : "") : ""; }
    function dato(etq, val) { return val === null || val === undefined || val === "" ? "" : '<div class="det-dato"><span>' + esc(etq) + "</span><strong>" + esc(val) + "</strong></div>"; }
    function liga(uuid, texto) { return '<a class="det-liga" href="?rfc=' + encodeURIComponent(RFC) + "&uuid=" + encodeURIComponent(uuid) + '" target="_blank" rel="noopener">' + esc(texto) + "</a>"; }
    function refCfdi(x) {
        if (!x.encontrado) return '<span class="xml-tenue" title="No está en la biblioteca">' + esc(x.uuid) + "</span>";
        return liga(x.uuid, (TIPOS[x.tipo] || "") + " " + (x.serie_folio || x.uuid.slice(0, 8))) +
            ' <span class="xml-tenue">' + esc(f(x.fecha)) + " · " + esc(x.contraparte || "") + " · $" + m(x.total) + " " + esc(x.moneda || "") + "</span>";
    }
    function sello(txt, tono) { return '<span class="xml-sello xml-sello--' + tono + '">' + esc(txt) + "</span>"; }
    // Clave con su descripción del catálogo del SAT ("616 - Sin obligaciones fiscales")
    function C(catalogo, clave) { return window.FCCatalogos ? FCCatalogos.texto(catalogo, clave) : (clave || ""); }

    document.addEventListener("DOMContentLoaded", async function () {
        if (!(await Fiscontable.exigirModulo("validador"))) return;
        if (window.FCCatalogos) {
            var cat = await FCCatalogos.cargar();
            // Las listas locales eran incompletas: se completan con el catálogo del servidor
            Object.assign(FORMA, cat.forma_pago || {});
            Object.assign(RELACION, cat.tipo_relacion || {});
            Object.assign(PERCEPCION, cat.tipo_percepcion || {});
            Object.assign(DEDUCCION, cat.tipo_deduccion || {});
            Object.assign(OTRO, cat.tipo_otro_pago || {});
        }
        if (!RFC || !UUID) { $("det-cargando").textContent = "Falta el RFC o el UUID en la dirección."; return; }
        try {
            var resp = await fetch(API + "/api/xml/detalle?rfc=" + encodeURIComponent(RFC) + "&uuid=" + encodeURIComponent(UUID), { credentials: "include" });
            if (!resp.ok) throw new Error(await Fiscontable.leerError(resp));
            pintar(await resp.json());
        } catch (e) { $("det-cargando").textContent = e.message; }
    });

    function pintar(r) {
        var d = r.cfdi;
        var titulo = (TIPOS[d.tipo] || "CFDI") + " " + ([d.serie, d.folio].filter(Boolean).join("-") || "");
        document.title = titulo + " · Fiscontable";
        var sellos = [sello("CFDI " + d.version, "gris"), sello(r.rol === "emitido" ? "Emitido" : "Recibido", "gris")];
        sellos.push('<span id="sello-sat">' + selloSAT(r) + "</span>");
        if (d.metodo_pago === "PPD" && d.tipo === "I" && r.conciliacion) {
            var ec = r.conciliacion.estado_pago;
            var color = { "Pagada": "verde", "Cubierta con nota de crédito": "verde", "Pagada (ajuste manual)": "verde", "Parcial": "ambar",
                          "Pago a factura cancelada": "ambar", "Sin pago": "rojo", "Pagada de más": "rojo" }[ec] || "gris";
            sellos.push(sello("PPD: " + ec, color));
        }
        var html = [];
        html.push('<div class="det-cabeza"><div><h1>' + esc(titulo) + '</h1><div class="det-uuid">' + esc(d.uuid) + '</div><div class="det-sellos">' + sellos.join("") + "</div></div>" +
            '<div class="det-acciones"><button type="button" class="xml-btn" id="btn-validar-uno">Validar ante el SAT</button><a class="xml-btn" href="' + API + "/api/xml/archivo?rfc=" + encodeURIComponent(RFC) + "&uuid=" + encodeURIComponent(d.uuid) + '">Descargar XML</a>' +
            '<a class="xml-btn" title="Consulta el SAT en ese momento y revisa las listas del SAT del emisor" href="' + API + "/api/xml/reporte-validacion?rfc=" + encodeURIComponent(RFC) + "&uuid=" + encodeURIComponent(d.uuid) + '">Reporte de validación (PDF)</a>' +
            '<button class="xml-btn" disabled title="Llega con la generación de PDF">PDF · próximamente</button>' +
            '<button class="xml-btn" onclick="window.print()">Imprimir</button></div></div>');

        if (r.alertas && r.alertas.length) {
            html.push('<div class="det-tarjeta det-alertas"><h2>Para revisar</h2><ul>' + r.alertas.map(function (a) { return "<li>⚠ " + esc(a) + "</li>"; }).join("") + "</ul></div>");
        }
        var em = d.emisor, re = d.receptor;
        html.push('<div class="det-partes">' +
            '<div class="det-parte"><h3>Emisor</h3><div class="det-nombre">' + esc(em.nombre || "") + '</div><div class="det-rfc">' + esc(em.rfc) + '</div><div class="det-linea">Régimen: ' + esc(C("regimen", em.regimen) || "—") + "</div>" +
            (d.nomina && d.nomina.registro_patronal ? '<div class="det-linea">Registro patronal ' + esc(d.nomina.registro_patronal) + "</div>" : "") +
            listasDe(r, "emisor") + "</div>" +
            '<div class="det-parte"><h3>Receptor</h3><div class="det-nombre">' + esc(re.nombre || "") + '</div><div class="det-rfc">' + esc(re.rfc) + "</div>" +
            '<div class="det-linea">Régimen: ' + esc(C("regimen", re.regimen) || "—") + "</div>" +
            (re.uso ? '<div class="det-linea">Uso del CFDI: ' + esc(C("uso_cfdi", re.uso)) + "</div>" : "") +
            (re.domicilio ? '<div class="det-linea">C.P. ' + esc(re.domicilio) + "</div>" : "") +
            (d.info_global ? '<div class="det-linea">Factura global: ' + esc(C("periodicidad", d.info_global.periodicidad)) +
                " · " + esc(C("meses", d.info_global.meses)) + " " + esc(d.info_global.anio || "") + "</div>" : "") +
            listasDe(r, "receptor") + "</div></div>");

        html.push('<div class="det-tarjeta"><h2>Comprobante</h2><div class="det-datos">' +
            dato("Fecha de emisión", f(d.fecha_emision)) + dato("Fecha de timbrado", f(d.fecha_timbrado)) +
            (d.tipo === "P" ? "" : dato("Forma de pago", C("forma_pago", d.forma_pago)) + dato("Método de pago", C("metodo_pago", d.metodo_pago)) +
                dato("Moneda", d.moneda) + dato("Tipo de cambio", d.tipo_cambio ? fn.format(d.tipo_cambio) : "")) +
            dato("Lugar de expedición", d.lugar_expedicion) + dato("Condiciones de pago", d.condiciones_pago) +
            dato("Exportación", C("exportacion", d.exportacion)) + dato("Complementos", (d.complementos || []).join(", ")) +
            dato("PAC", d.pac_rfc) + dato("Certificado SAT", d.no_cert_sat) + "</div></div>");

        if (d.tipo === "N" && d.nomina) html.push(nomina(d));
        else if (d.tipo === "P" && d.pagos) html.push(pagos(d, r));
        else html.push(conceptos(d));

        if (r.cobros && r.cobros.length || (d.metodo_pago === "PPD" && d.tipo === "I")) html.push(cobros(d, r));
        if (r.relacionados.length || r.relacionado_por.length) {
            html.push('<div class="det-tarjeta"><h2>CFDI relacionados</h2>' +
                r.relacionados.map(function (g) {
                    return '<p style="font-size:13px;font-weight:700;margin:6px 0">' + esc(g.tipo + " - " + (RELACION[g.tipo] || "")) + "</p><ul>" +
                        g.cfdi.map(function (x) { return '<li style="font-size:13px;margin:3px 0">' + refCfdi(x) + "</li>"; }).join("") + "</ul>";
                }).join("") +
                (r.relacionado_por.length ? '<p style="font-size:13px;font-weight:700;margin:10px 0 6px">Otros CFDI que hacen referencia a este</p><ul>' +
                    r.relacionado_por.map(function (x) { return '<li style="font-size:13px;margin:3px 0">' + esc((RELACION[x.tipo_relacion] || x.tipo_relacion) + ": ") + refCfdi(x) + "</li>"; }).join("") + "</ul>" : "") +
                "</div>");
        }
        $("det-cargando").hidden = true;
        $("det").innerHTML = html.join("");
        $("det").hidden = false;
        $("btn-validar-uno").addEventListener("click", validarAhora);
    }

    // En qué listas del SAT aparece el emisor o el receptor (69-B, 49 Bis, no localizados…)
    function listasDe(r, parte) {
        var info = r.listas_sat;
        if (!info) return "";
        var hits = info[parte] || [];
        if (!hits.length) {
            return Object.keys(info.fechas || {}).length
                ? '<div class="det-linea" style="color:#047857">✓ No aparece en las listas del SAT</div>' : "";
        }
        var color = { grave: "rojo", alerta: "ambar", informativo: "gris" };
        return '<div class="det-sellos" style="margin-top:6px">' + hits.map(function (h) {
            var fecha = h.fecha ? " · " + (h.fecha_tipo || "") + " " + h.fecha.slice(8, 10) + "/" + h.fecha.slice(5, 7) + "/" + h.fecha.slice(0, 4) : "";
            return sello(h.nombre_lista + ": " + h.situacion + fecha, color[h.gravedad] || "gris");
        }).join("") + '</div><div class="det-linea"><a class="det-liga" href="/herramientas/listas-sat/?rfc=' +
            encodeURIComponent((r.cfdi[parte] || {}).rfc || "") + '">Ver en Listas del SAT</a></div>';
    }

    function selloSAT(r) {
        // estado_sat_en es cuándo CONSULTAMOS al SAT, no cuándo se canceló: el servicio
        // público del SAT no da la fecha de cancelación. Por eso va aparte y rotulada.
        var consulta = r.estado_sat_en ? ' <span class="det-consultado">consultado el ' + esc(f(r.estado_sat_en).slice(0, 10)) + "</span>" : "";
        if (r.estado_sat === "Vigente") return sello("Vigente en el SAT", "verde") + consulta;
        if (r.estado_sat === "Cancelado") return sello("Cancelado en el SAT", "rojo") + consulta;
        if (r.estado_sat === "No encontrado") return sello("El SAT no lo encuentra", "ambar") + consulta;
        return sello("Sin validar ante el SAT", "gris");
    }

    async function validarAhora() {
        var b = $("btn-validar-uno");
        b.disabled = true; b.textContent = "Consultando al SAT…";
        try {
            var resp = await fetch(API + "/api/xml/validar-uno", { method: "POST", credentials: "include",
                headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rfc: RFC, uuid: UUID }) });
            if (!resp.ok) throw new Error(await Fiscontable.leerError(resp));
            var r = await resp.json();
            $("sello-sat").innerHTML = selloSAT({ estado_sat: r.estado, estado_sat_en: r.validado_en });
            b.textContent = "Validar de nuevo";
        } catch (e) {
            b.textContent = "Validar ante el SAT";
            Fiscontable.aviso ? Fiscontable.aviso(e.message) : alert(e.message);
        }
        b.disabled = false;
    }

    function conceptos(d) {
        var filas = (d.conceptos || []).map(function (c) {
            return "<tr><td>" + esc(c.clave || "") + '</td><td class="num">' + (c.cantidad != null ? fn.format(c.cantidad) : "") + "</td><td>" + esc(c.clave_unidad || c.unidad || "") +
                "</td><td>" + esc(c.descripcion || "") + '</td><td class="num">' + m(c.valor_unitario) + '</td><td class="num">' + m(c.descuento) + '</td><td class="num">' + m(c.importe) + "</td></tr>";
        }).join("");
        var imp = (d.traslados || []).map(function (t) {
            return "<tr><td>" + esc((IMP[t.impuesto] || t.impuesto) + " trasladado " + (t.factor === "Exento" ? "exento" : (t.tasa || "") + "%")) + "</td><td>$" + m(t.importe) + "</td></tr>";
        }).concat((d.retenciones || []).map(function (t) {
            return "<tr><td>" + esc((IMP[t.impuesto] || t.impuesto) + " retenido " + (t.tasa ? t.tasa + "%" : "")) + "</td><td>−$" + m(t.importe) + "</td></tr>";
        }));
        if (d.imp_locales) {
            (d.imp_locales.trasladados || []).forEach(function (x) { imp.push("<tr><td>" + esc((x.nombre || "Local") + " " + (x.tasa || "") + "%") + "</td><td>$" + m(x.importe) + "</td></tr>"); });
            (d.imp_locales.retenidos || []).forEach(function (x) { imp.push("<tr><td>" + esc((x.nombre || "Local") + " retenido " + (x.tasa || "") + "%") + "</td><td>−$" + m(x.importe) + "</td></tr>"); });
        }
        return '<div class="det-tarjeta"><h2>Conceptos (' + (d.conceptos || []).length + ')</h2><div class="det-scroll"><table class="det-tabla"><thead><tr><th>Clave</th><th class="num">Cantidad</th><th>Unidad</th><th>Descripción</th><th class="num">Valor unitario</th><th class="num">Descuento</th><th class="num">Importe</th></tr></thead><tbody>' +
            filas + '</tbody></table></div></div>' +
            '<div class="det-totales"><div></div><div class="det-tarjeta"><table class="det-suma"><tr><td>Subtotal</td><td>$' + m(d.subtotal) + "</td></tr>" +
            (d.descuento ? "<tr><td>Descuento</td><td>−$" + m(d.descuento) + "</td></tr>" : "") + imp.join("") +
            '<tr class="det-gran"><td>Total</td><td>$' + m(d.total) + " " + esc(d.moneda || "") + "</td></tr></table></div></div>";
    }

    function pagos(d, r) {
        var lista = d.pagos.pagos;
        var docs = r.facturas_pagadas;
        var totalPagado = lista.reduce(function (s, p) { return s + (p.monto || 0); }, 0);
        var monedas = Array.from(new Set(lista.map(function (p) { return p.moneda; }))).join(", ");
        var formas = Array.from(new Set(lista.map(function (p) { return (p.forma || "") + " " + (FORMA[p.forma] || ""); }))).join(", ");
        var fechas = Array.from(new Set(lista.map(function (p) { return f(p.fecha).slice(0, 10); }))).join(", ");
        var resumen = "Este comprobante registra " + (lista.length === 1 ? "un pago" : lista.length + " pagos") + " por <strong>$" + m(totalPagado) + " " + esc(monedas) +
            "</strong>, hecho el " + esc(fechas) + " por " + esc(formas.trim()) + ". " +
            (docs.length === 1 ? "Con ese dinero se pagó <strong>una factura</strong>:" : "Con ese dinero se pagaron <strong>" + docs.length + " facturas</strong>:");
        var sumaPagado = 0, sumaIva = 0;
        var filas = docs.map(function (x) {
            sumaPagado += x.pagado || 0; sumaIva += x.iva || 0;
            var sf = [x.serie, x.folio].filter(Boolean).join("-");
            var factura = x.factura.encontrado ? refCfdi(x.factura)
                : "<strong>" + esc(sf ? "Factura " + sf : "Factura") + '</strong> <span class="xml-tenue">— no está en tu biblioteca</span><br><span class="xml-tenue" style="font-family:ui-monospace,monospace;font-size:11.5px">' + esc(x.uuid) + "</span>";
            var queda = x.saldo_insoluto || 0;
            var estado = queda <= 0.009 ? sello("Liquidada", "verde") : sello("Quedan $" + m(queda), "ambar");
            return "<tr><td>" + factura + '</td><td class="num">' + esc(x.parcialidad || "") + '</td><td class="num">$' + m(x.saldo_anterior) +
                '</td><td class="num"><strong>$' + m(x.pagado) + '</strong></td><td class="num">$' + m(x.saldo_insoluto) + "</td><td>" + estado +
                '</td><td class="num">' + (x.iva != null ? "$" + m(x.iva) : "—") + "</td></tr>";
        }).join("");
        var detallePago = lista.length > 1 ? '<div class="det-scroll" style="margin-bottom:12px"><table class="det-tabla"><thead><tr><th>Fecha de pago</th><th>Forma</th><th>Moneda</th><th class="num">Tipo de cambio</th><th class="num">Monto</th><th>Núm. operación</th></tr></thead><tbody>' +
            lista.map(function (p) {
                return "<tr><td>" + esc(f(p.fecha)) + "</td><td>" + esc((p.forma || "") + " " + (FORMA[p.forma] || "")) + "</td><td>" + esc(p.moneda || "") +
                    '</td><td class="num">' + (p.tipo_cambio ? fn.format(p.tipo_cambio) : "") + '</td><td class="num">$' + m(p.monto) + "</td><td>" + esc(p.num_operacion || "") + "</td></tr>";
            }).join("") + "</tbody></table></div>" : "";
        var datosPago = lista.length === 1 ? '<div class="det-datos" style="margin-bottom:14px">' +
            dato("Fecha de pago", f(lista[0].fecha)) + dato("Forma de pago", formas.trim()) + dato("Moneda del pago", lista[0].moneda) +
            (lista[0].moneda !== "MXN" ? dato("Tipo de cambio", lista[0].tipo_cambio ? fn.format(lista[0].tipo_cambio) : "") : "") +
            dato("Monto del pago", "$" + m(lista[0].monto)) + dato("Núm. de operación", lista[0].num_operacion) + "</div>" : "";
        return '<div class="det-tarjeta"><h2>El pago (complemento ' + esc(d.pagos.version || "") + ")</h2>" + datosPago + detallePago +
            '<p style="font-size:14px;color:#334155;margin-bottom:10px">' + resumen + "</p>" +
            '<div class="det-scroll"><table class="det-tabla"><thead><tr><th>Factura pagada</th><th class="num">Núm. de pago</th><th class="num">Saldo antes</th><th class="num">Pagado aquí</th><th class="num">Saldo que queda</th><th></th><th class="num">IVA incluido</th></tr></thead><tbody>' +
            filas + '</tbody><tfoot><tr><td colspan="3">Total</td><td class="num">$' + m(sumaPagado) + '</td><td colspan="2"></td><td class="num">' + (sumaIva ? "$" + m(sumaIva) : "") + "</td></tr></tfoot></table></div>" +
            '<p class="xml-tenue" style="margin-top:10px">“Núm. de pago” es la parcialidad: 1 = primer pago de esa factura. “IVA incluido” es la parte de lo pagado que corresponde al IVA de cada factura (el IVA efectivamente cobrado o pagado).</p></div>';
    }

    function cobros(d, r) {
        if (!r.cobros.length) return '<div class="det-tarjeta"><h2>Pagos recibidos de esta factura</h2><p style="font-size:13.5px;color:#991b1b;font-weight:700">No hay ningún pago cargado para esta factura PPD. Saldo pendiente: $' + m(d.total) + "</p>" +
            '<p class="xml-tenue" style="margin-top:6px">Si ya se pagó, carga el XML del complemento de pago y aquí aparecerá.</p></div>';
        var vigentes = r.cobros.filter(function (c) { return !c.cancelado; });
        var conc = r.conciliacion || {};
        var liquidada = conc.estado_pago ? ["Pagada", "Cubierta con nota de crédito", "Pagada (ajuste manual)"].indexOf(conc.estado_pago) !== -1
            : (vigentes.length && vigentes[vigentes.length - 1].insoluto <= 0.009);
        var saldo = conc.saldo_insoluto !== undefined && conc.saldo_insoluto !== null ? conc.saldo_insoluto : (vigentes.length ? vigentes[vigentes.length - 1].insoluto : d.total);
        return '<div class="det-tarjeta"><h2>Pagos recibidos de esta factura</h2><div class="det-scroll"><table class="det-tabla"><thead><tr><th>Fecha de pago</th><th>Comprobante de pago</th><th>Forma</th><th class="num">Núm. de pago</th><th class="num">Saldo antes</th><th class="num">Pagado</th><th class="num">Saldo que queda</th></tr></thead><tbody>' +
            r.cobros.map(function (c) {
                return "<tr" + (c.cancelado ? ' style="color:#94a3b8;text-decoration:line-through" title="Cancelado en el SAT: no cuenta"' : "") + "><td>" + esc(f(c.fecha)) + "</td><td>" + (c.pago.encontrado ? liga(c.pago_uuid, "Pago " + (c.pago.serie_folio || c.pago_uuid.slice(0, 8))) : esc(c.pago_uuid.slice(0, 8))) + "</td><td>" + esc((c.forma || "") + " " + (FORMA[c.forma] || "")) +
                    '</td><td class="num">' + esc(c.parcialidad || "") + '</td><td class="num">$' + m(c.anterior) + '</td><td class="num"><strong>$' + m(c.pagado) + '</strong></td><td class="num">$' + m(c.insoluto) + "</td></tr>";
            }).join("") + "</tbody></table></div>" +
            '<p style="font-size:13.5px;font-weight:800;margin-top:10px;color:' + (liquidada ? "#166534" : "#92400e") + '">' +
            (conc.estado_pago === "Pagada de más" ? "Se aplicó $" + m(-saldo) + " más que el total: revisa si algún complemento se canceló y se volvió a emitir." :
             liquidada ? "Pagada por completo en " + (vigentes.length === 1 ? "un pago" : vigentes.length + " pagos") + "." : "Saldo pendiente: $" + m(saldo)) +
            (vigentes.length < r.cobros.length ? " Los tachados están cancelados en el SAT y no cuentan." : "") + "</p></div>";
    }

    function nomina(d) {
        var n = d.nomina, e = n.empleado || {};
        var per = n.percepciones.map(function (p) { return "<tr><td>" + esc(p.tipo + " " + (PERCEPCION[p.tipo] || "")) + "</td><td>" + esc(p.concepto || "") + '</td><td class="num">$' + m(p.gravado) + '</td><td class="num">$' + m(p.exento) + "</td></tr>"; }).join("");
        var ded = n.deducciones.map(function (x) { return "<tr><td>" + esc(x.tipo + " " + (DEDUCCION[x.tipo] || "")) + "</td><td>" + esc(x.concepto || "") + '</td><td class="num">$' + m(x.importe) + "</td></tr>"; }).join("");
        var otr = n.otros_pagos.map(function (x) { return "<tr><td>" + esc(x.tipo + " " + (OTRO[x.tipo] || "")) + "</td><td>" + esc(x.concepto || "") + '</td><td class="num">$' + m(x.importe) + (x.subsidio_causado != null ? ' <span class="xml-tenue">(causado $' + m(x.subsidio_causado) + ")</span>" : "") + "</td></tr>"; }).join("");
        return '<div class="det-tarjeta"><h2>Empleado</h2><div class="det-datos">' +
            dato("Núm. empleado", e.num_empleado) + dato("CURP", e.curp) + dato("NSS", e.nss) + dato("Puesto", e.puesto) + dato("Departamento", e.departamento) +
            dato("Inicio relación laboral", f(e.fecha_inicio)) + dato("Antigüedad", e.antiguedad) + dato("SDI", e.sdi != null ? "$" + m(e.sdi) : "") + dato("SBC", e.sbc != null ? "$" + m(e.sbc) : "") +
            dato("Tipo de nómina", n.tipo === "O" ? "Ordinaria" : n.tipo === "E" ? "Extraordinaria" : n.tipo) + dato("Fecha de pago", f(n.fecha_pago)) +
            dato("Periodo", f(n.fecha_inicial) + " al " + f(n.fecha_final)) + dato("Días pagados", n.dias) + "</div></div>" +
            '<div class="det-tarjeta"><h2>Percepciones</h2><table class="det-tabla"><thead><tr><th>Tipo</th><th>Concepto</th><th class="num">Gravado</th><th class="num">Exento</th></tr></thead><tbody>' + per +
            '</tbody><tfoot><tr><td colspan="2">Total percepciones $' + m(n.total_percepciones) + '</td><td class="num">$' + m(n.total_gravado) + '</td><td class="num">$' + m(n.total_exento) + "</td></tr></tfoot></table></div>" +
            (ded ? '<div class="det-tarjeta"><h2>Deducciones</h2><table class="det-tabla"><thead><tr><th>Tipo</th><th>Concepto</th><th class="num">Importe</th></tr></thead><tbody>' + ded + '</tbody><tfoot><tr><td colspan="2">Total deducciones</td><td class="num">$' + m(n.total_deducciones) + "</td></tr></tfoot></table></div>" : "") +
            (otr ? '<div class="det-tarjeta"><h2>Otros pagos</h2><table class="det-tabla"><thead><tr><th>Tipo</th><th>Concepto</th><th class="num">Importe</th></tr></thead><tbody>' + otr + "</tbody></table></div>" : "") +
            '<div class="det-totales"><div></div><div class="det-tarjeta"><table class="det-suma"><tr><td>Percepciones</td><td>$' + m(n.total_percepciones) + "</td></tr><tr><td>Otros pagos</td><td>$" + m(n.total_otros_pagos || 0) +
            "</td></tr><tr><td>Deducciones</td><td>−$" + m(n.total_deducciones || 0) + '</td></tr><tr class="det-gran"><td>Neto pagado</td><td>$' + m(d.total) + "</td></tr></table></div></div>";
    }
})();
