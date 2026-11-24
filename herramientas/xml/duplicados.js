/**
 * duplicados.js — Posibles facturas duplicadas de Administración de XML (18-nov-2026).
 *
 *   XMLDuplicados.abrir({ rfc, lado, desde, hasta, periodo })          lado: "emitidos" | "recibidos" | "nomina"
 * Lista los grupos de facturas (emitidas o recibidas) que parecen la misma timbrada dos veces y deja decidir cada uno:
 * «Es duplicado» (y cuál sobra) o «No lo es». Lo decidido se guarda en el servidor y no se vuelve a preguntar; cuando la
 * que sobra queda cancelada ante el SAT, el grupo se resuelve solo.
 * Con lado "nomina" (18-nov, el dueño: «me va a decir duplicado y esta es la diferencia») son recibos de nómina del mismo
 * trabajador, fecha de pago, periodo e importes; arriba dice cuánto ISR retenido sobra por mes, que es lo que el SAT
 * ve como «diferencia por pagar».
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var fmt = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var D = { ctx: null, datos: null };

    async function post(ruta, cuerpo) {
        var resp;
        try {
            resp = await fetch(API + ruta, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
        } catch (e) { throw new Error("No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo."); }
        if (!resp.ok) throw new Error(await Fiscontable.leerError(resp));
        return resp.json();
    }
    function fecha(iso) { var s = String(iso || ""); return s.length >= 10 ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) + (s.length > 11 ? " " + s.slice(11, 16) : "") : ""; }
    function nomina() { return D.ctx.lado === "nomina"; }
    function emitidas() { return D.ctx.lado === "emitidos" || nomina(); }        // los recibos de nómina los timbra la empresa: los cancela ella
    function mesTxt(n) { return n ? n.charAt(0).toUpperCase() + n.slice(1) : ""; }

    function tarjeta(g, estado) {
        var quien = nomina() ? "Trabajador" : emitidas() ? "Cliente" : "Proveedor";
        var filas = g.facturas.map(function (f, i) {
            var sobra = estado === "duplicado" ? g.sobra === f.uuid : i === g.facturas.length - 1;      // de fábrica sobra la última
            return "<tr" + (estado === "duplicado" && g.sobra === f.uuid ? ' class="xd-sobra"' : "") + ">" +
                (estado === "pendiente" ? '<td class="xd-radio"><input type="radio" name="sobra-' + esc(g.id) + '" value="' + esc(f.uuid) + '"' + (sobra ? " checked" : "") +
                    ' aria-label="Esta es la que sobra"></td>' : '<td class="xd-radio">' + (estado === "duplicado" && sobra ? '<span class="xd-etq xd-etq--sobra">Sobra</span>' : "") + "</td>") +
                "<td>" + esc(fecha(f.fecha)) + "</td><td>" + esc(f.serie_folio || "—") + "</td>" +
                '<td class="xd-concepto" title="' + esc(f.concepto || "") + '">' + esc(f.concepto || "") + (f.conceptos > 1 ? " <small>+" + (f.conceptos - 1) + " más</small>" : "") + "</td>" +
                (nomina() ? '<td class="xd-num">' + (f.neto == null ? "" : "$" + fmt.format(f.neto)) + "</td>" : "<td>" + esc(f.metodo_pago || "") + "</td>") + "<td>" + esc(f.estado_sat) + "</td>" +
                '<td><button type="button" class="xml-enlace" data-ver="' + esc(f.uuid) + '" title="' + esc(f.uuid) + '">Ver</button></td></tr>';
        }).join("");
        var pie;
        if (estado === "pendiente") {
            pie = '<span class="xd-ayuda">Marca cuál sobra y decide:</span>' +
                '<button type="button" class="xml-btn" data-decidir="no">No es duplicado</button>' +
                '<button type="button" class="xml-btn xml-btn--primario" data-decidir="duplicado">Es duplicado</button>';
        } else if (estado === "duplicado") {
            pie = '<span class="xd-ayuda">' + (emitidas()
                    ? "Falta cancelar " + (nomina() ? "el" : "la") + " que sobra. Al quedar cancelad" + (nomina() ? "o" : "a") + " ante el SAT, este aviso se quita solo."
                    : "Pide a tu proveedor que cancele la que sobra. Al quedar cancelada ante el SAT, este aviso se quita solo.") + "</span>" +
                (emitidas() ? '<a class="xml-btn" href="/herramientas/xml/cancelaciones.html?rfc=' + encodeURIComponent(D.ctx.rfc) + '" target="_blank" rel="noopener">Ir a Cancelaciones</a>'
                            : '<button type="button" class="xml-btn" data-copiar>Copiar datos para el proveedor</button>') +
                '<button type="button" class="xml-enlace" data-decidir="">Deshacer</button>';
        } else {
            pie = '<span class="xd-ayuda">Lo marcaste como «no es duplicado».</span><button type="button" class="xml-enlace" data-decidir="">Deshacer</button>';
        }
        return '<article class="xd-grupo" data-grupo="' + esc(g.id) + '">' +
            '<header><div><strong>' + esc(g.contraparte_nombre || g.contraparte_rfc) + "</strong><small>" + esc(quien + " · " + g.contraparte_rfc + " · " + g.tipo) + "</small></div>" +
            (nomina()
                ? '<div class="xd-total"><strong>ISR retenido $' + fmt.format(g.isr) + "</strong><small>" + esc("Percepciones $" + fmt.format(g.total) + " · pagado el " + fecha(g.fecha_pago) +
                    (estado === "descartado" ? "" : " · si sobra" + (g.facturas.length > 2 ? "n" : "") + ": $" + fmt.format(g.isr_de_mas) + " de ISR de más")) + "</small></div></header>"
                : '<div class="xd-total"><strong>$' + fmt.format(g.total) + " " + esc(g.moneda) + "</strong><small>" + esc("Mismos conceptos" + (g.dias ? " · a " + g.dias + " día(s)" : " · el mismo día")) + "</small></div></header>") +
            '<div class="xd-tabla"><table><thead><tr><th>' + (estado === "pendiente" ? "Sobra" : "") + "</th><th>" + (nomina() ? "Timbrado" : "Fecha") + "</th><th>Serie y folio</th><th>" +
            (nomina() ? "Periodo pagado" : "Concepto") + "</th><th" + (nomina() ? ' class="xd-num">Neto' : ">Método") + "</th><th>Estado SAT</th><th></th></tr></thead><tbody>" +
            filas + "</tbody></table></div><footer>" + pie + "</footer></article>";
    }

    function seccion(titulo, grupos, estado, plegada) {
        if (!grupos.length) return "";
        var cuerpo = grupos.map(function (g) { return tarjeta(g, estado); }).join("");
        return plegada ? '<details class="xd-seccion"><summary>' + esc(titulo) + " (" + grupos.length + ")</summary>" + cuerpo + "</details>"
                       : '<section class="xd-seccion"><h3>' + esc(titulo) + " (" + grupos.length + ")</h3>" + cuerpo + "</section>";
    }

    /* Nómina: cuánto ISR retenido sobra por mes si lo pendiente y lo confirmado son repetidos. Es la cifra que se busca
       cuando el SAT marca una diferencia por pagar (retenido − enterado) y no se sabe de dónde sale. */
    function resumenNomina() {
        var r = D.datos.resumen;
        if (!r || !r.recibos_de_mas) return "";
        return '<div class="xd-resumen"><p><strong>' + r.recibos_de_mas + " recibo" + (r.recibos_de_mas === 1 ? "" : "s") + " de más: $" + fmt.format(r.isr_de_mas) + " de ISR retenido</strong> " +
            "(y $" + fmt.format(r.pagado_de_mas) + " de percepciones) que el SAT cuenta aunque sea el mismo pago. Si en ese mes tienes una diferencia por pagar de ISR de sueldos, " +
            "esta es la parte que viene de recibos repetidos.</p>" +
            '<ul class="xd-meses">' + r.por_mes.map(function (m) {
                return "<li><b>" + esc(mesTxt(m.nombre)) + "</b><span>" + m.recibos_de_mas + " recibo" + (m.recibos_de_mas === 1 ? "" : "s") + " de más</span><span>ISR $" + fmt.format(m.isr) + "</span></li>";
            }).join("") + "</ul>" +
            '<a class="xml-enlace" href="/herramientas/visores/?rfc=' + encodeURIComponent(D.ctx.rfc) + '" target="_blank" rel="noopener">Ver la diferencia de cada mes en Visores del SAT ›</a></div>';
    }

    function pintar() {
        var d = D.datos, cuerpo = $("dlg-dup-cuerpo");
        if (!d.pendientes.length && !d.duplicados.length && !d.descartados.length) {
            cuerpo.innerHTML = nomina()
                ? '<p class="xd-vacio"><strong>Sin recibos repetidos en este periodo.</strong> Se comparan los recibos de nómina vigentes del mismo trabajador con la misma fecha de pago, ' +
                  "el mismo periodo, las mismas percepciones y el mismo ISR.</p>"
                : '<p class="xd-vacio"><strong>Sin posibles duplicados en este periodo.</strong> Se comparan las facturas ' + (emitidas() ? "emitidas" : "recibidas") +
                " vigentes del mismo " + (emitidas() ? "cliente" : "proveedor") + ", con la misma moneda y el mismo total, los mismos conceptos (clave del SAT, cantidad e importe; " +
                "la descripción sin contar mayúsculas, acentos, espacios ni signos) y con hasta " + d.ventana_dias + " días de diferencia. Las de total $0.00 no se revisan.</p>";
            return;
        }
        cuerpo.innerHTML =
            (nomina() ? resumenNomina() : "") +
            (d.pendientes.length ? "" : '<p class="xd-vacio"><strong>No queda nada por revisar.</strong></p>') +
            seccion("Por revisar", d.pendientes, "pendiente") +
            seccion(emitidas() ? "Duplicados por cancelar" : "Duplicados por pedir que cancelen", d.duplicados, "duplicado") +
            seccion("Marcados como «no es duplicado»", d.descartados, "descartado", true);
    }

    function grupoDe(id) {
        var d = D.datos;
        return d.pendientes.concat(d.duplicados, d.descartados).find(function (g) { return g.id === id; });
    }

    async function cargar() {
        var x = D.ctx, cuerpo = $("dlg-dup-cuerpo");
        cuerpo.innerHTML = '<p class="xd-vacio">Comparando ' + (nomina() ? "los recibos" : "las facturas") + " del periodo…</p>";
        try {
            D.datos = await post("/api/xml/duplicados", { rfc: x.rfc, lado: x.lado, desde: x.desde, hasta: x.hasta });
            pintar();
            // 22-nov-2026: la tabla de atrás muestra la misma marca que el Excel; se le avisa lo que quedó
            document.dispatchEvent(new CustomEvent("fiscontable:duplicados", { detail: { rfc: x.rfc, lado: x.lado, desde: x.desde, hasta: x.hasta, marcas: D.datos.marcas || {} } }));
        } catch (e) {
            cuerpo.innerHTML = '<p class="xd-vacio xd-vacio--error"><strong>No se pudo comparar.</strong> ' + esc(e.message) + ' <button type="button" class="xml-enlace" data-reintentar>Reintentar</button></p>';
        }
    }

    function abrir(ctx) {
        D.ctx = ctx; D.datos = null;
        $("dlg-dup-titulo").textContent = "Posibles duplicados · " + (ctx.lado === "nomina" ? "Recibos de nómina" : "Facturas " + (ctx.lado === "emitidos" ? "emitidas" : "recibidas"));
        $("dlg-dup-sub").textContent = ctx.periodo;
        var dlg = $("dlg-duplicados");
        if (!dlg.open) dlg.showModal();
        cargar();
    }

    document.addEventListener("DOMContentLoaded", function () {
        var dlg = $("dlg-duplicados");
        if (!dlg) return;
        dlg.addEventListener("click", async function (e) {
            if (e.target.closest("[data-dup='cerrar']")) return dlg.close();
            if (e.target.closest("[data-reintentar]")) return cargar();
            var ver = e.target.closest("[data-ver]");
            if (ver) { if (Fiscontable.verCfdi) Fiscontable.verCfdi(D.ctx.rfc, ver.dataset.ver, [ver.dataset.ver]); return; }
            var art = e.target.closest(".xd-grupo"); if (!art) return;
            var g = grupoDe(art.dataset.grupo); if (!g) return;
            if (e.target.closest("[data-copiar]")) {
                var s = g.facturas.find(function (f) { return f.uuid === g.sobra; }) || g.facturas[g.facturas.length - 1];
                var texto = "Factura duplicada: favor de cancelar el CFDI " + (s.serie_folio ? "con folio " + s.serie_folio + ", " : "") + "UUID " + s.uuid + ", del " + fecha(s.fecha) +
                    ", por $" + fmt.format(g.total) + " " + g.moneda + ". Es el mismo que " + g.facturas.filter(function (f) { return f.uuid !== s.uuid; })
                        .map(function (f) { return (f.serie_folio ? "el folio " + f.serie_folio + " " : "") + "(UUID " + f.uuid + ")"; }).join(" y ") + ".";
                try { await navigator.clipboard.writeText(texto); Fiscontable.toast ? Fiscontable.toast("Copiado.") : null; } catch (err) { window.prompt("Copia el texto:", texto); }
                return;
            }
            var b = e.target.closest("[data-decidir]"); if (!b) return;
            var decision = b.dataset.decidir, sobra = null;
            if (decision === "duplicado") {
                var r = art.querySelector('input[type="radio"]:checked');
                sobra = r ? r.value : null;
            }
            art.querySelectorAll("button").forEach(function (x) { x.disabled = true; });        // sin dobles clics
            try {
                await post("/api/xml/duplicados/marcar", { rfc: D.ctx.rfc, uuids: g.facturas.map(function (f) { return f.uuid; }), decision: decision, sobra: sobra });
                await cargar();
            } catch (err) {
                art.querySelectorAll("button").forEach(function (x) { x.disabled = false; });
                Fiscontable.toast ? Fiscontable.toast(err.message) : Fiscontable.avisar(err.message);
            }
        });
    });

    window.XMLDuplicados = { abrir: abrir };
})();
