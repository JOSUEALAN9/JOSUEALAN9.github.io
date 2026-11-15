/**
 * visores-panel.js — El módulo nuevo de Visores (15-nov, maqueta aprobada): una empresa, un año y cinco pestañas.
 *   Resumen · SAT contra tus XML · Facturas · Nómina · Cambios.
 * Todo sale de GET /api/visores/panel (modulos/visores/panel.py): la última lectura de cada visor del SAT para ese año.
 * «Leer ahora» pide el visor de facturas y el de nómina del patrón (solo consulta, con la e.firma guardada).
 * La gráfica y las tarjetas de tus XML siguen en visores.js; las lecturas con sus capturas, en visores-sat.js (Cambios).
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var P = { empresa: null, datos: null, vista: "resumen", cruce: 0, celda: 0, reloj: null };
    var VISTAS = ["resumen", "cruce", "facturas", "nomina", "cambios"];
    var NOMBRE_VISOR = { facturas: "facturas", nomina_patron: "nómina del patrón" };

    function dinero(v) { return v == null ? "—" : "$" + Number(v).toLocaleString("es-MX", { maximumFractionDigits: 0 }); }
    function num(v) { return v == null ? "—" : Number(v).toLocaleString("es-MX"); }
    function cuando(iso) {
        if (!iso) return "";
        var x = new Date(/Z$/.test(iso) ? iso : iso + "Z");
        return isNaN(x) ? "" : x.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    }
    function dia(iso) { var x = new Date(/Z$/.test(iso) ? iso : iso + "Z"); return isNaN(x) ? "" : x.toLocaleDateString("es-MX", { day: "numeric", month: "short" }); }
    function pill(texto, clase) { return '<span class="vn-pill vn-pill--' + clase + '">' + esc(texto) + "</span>"; }
    function vacio(titulo, texto) { return '<div class="vn-vacio"><b>' + esc(titulo) + "</b><span>" + esc(texto) + "</span></div>"; }
    async function api(ruta, op) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, op || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r;
    }
    function anio() { return Number($("vi-anio").value) || new Date().getFullYear(); }

    /* ---------- estado: cuándo se leyó y si hay una lectura en curso */
    function pintarEstado() {
        var d = P.datos, caja = $("vn-estado");
        if (!d) { caja.innerHTML = ""; return; }
        var curso = (d.en_curso || []).filter(function (x) { return Number(x.ejercicio) === d.anio; });
        if (curso.length) {
            caja.innerHTML = '<span class="vn-punto vn-punto--curso"></span>Leyendo ' + curso.map(function (x) { return NOMBRE_VISOR[x.visor] || x.visor; }).join(" y ") +
                " en el SAT… puedes seguir trabajando; se actualiza solo.";
            $("vn-leer").disabled = true;
            return;
        }
        $("vn-leer").disabled = false;
        var partes = [], f = d.lecturas.facturas, n = d.lecturas.nomina_patron;
        if (f) partes.push("facturas el " + cuando(f.terminada || f.creada));
        if (n) partes.push("nómina el " + cuando(n.terminada || n.creada));
        var punto = !partes.length ? "nada" : "bien";
        caja.innerHTML = '<span class="vn-punto vn-punto--' + punto + '"></span>' + (partes.length ? "Leído del SAT: " + partes.join(" · ") : "Todavía no se lee el visor del SAT de " + d.anio + " para esta empresa: pulsa «Leer ahora».");
    }

    /* ---------- Resumen */
    function cifra(titulo, valor, nota, clase, vista) {
        return '<button type="button" class="vi-cifra vi-cifra--btn"' + (vista ? ' data-ir="' + vista + '"' : "") + "><small>" + esc(titulo) + "</small><b>" + esc(valor) + "</b><span" + (clase ? ' class="' + clase + '"' : "") + ">" + nota + "</span></button>";
    }
    function notaXml(lado) {
        if (!lado || !lado.xml) return "tus XML: sin cruce todavía";
        var dn = lado.xml.vigentes - lado.vigentes;
        if (!lado.xml.meses_con_diferencia) return "tus XML: cuadra";
        return "tus XML: " + num(lado.xml.vigentes) + (dn ? " (" + (dn > 0 ? "+" : "") + dn + ")" : "") + " · " + lado.xml.meses_con_diferencia + " mes(es) con diferencia";
    }
    function pintarResumen() {
        var d = P.datos, r = d.resumen, h = "";
        if (!r.emitidas && !r.recibidas && !r.nomina) {
            $("vn-resumen").innerHTML = '<div style="grid-column:1/-1">' + vacio("Sin lecturas del SAT para " + d.anio, "Pulsa «Leer ahora»: Fiscontable entra a los visores del SAT con la e.firma guardada y aquí sale lo que dice el SAT junto a tus XML.") + "</div>";
            return;
        }
        var bien = function (x) { return x && x.xml && !x.xml.meses_con_diferencia ? "vn-bien" : "vn-ojo"; };
        var sinDatos = "La última lectura de facturas no trajo datos del SAT: dale «Leer ahora»";
        var lado = function (x, titulo) {
            if (!x) return "";
            if (x.sin_datos) return cifra(titulo, "Sin datos", esc(sinDatos), "vn-ojo", "cambios");
            return cifra(titulo, dinero(x.neto), esc(num(x.vigentes) + " facturas · " + notaXml(x)), bien(x), "cruce");
        };
        h += lado(r.emitidas, "Emitidas vigentes (SAT)") + lado(r.recibidas, "Recibidas vigentes (SAT)");
        if (r.emitidas && !r.emitidas.sin_datos) h += cifra("IVA trasladado (SAT)", dinero(r.emitidas.iva), "en tus facturas emitidas de ingreso", "", "facturas");
        if (r.nomina && (r.nomina.sueldos || r.nomina.asimilados)) {
            var dif = r.nomina.diferencia || 0;
            h += cifra("Nómina (SAT)", dinero((r.nomina.sueldos || 0) + (r.nomina.asimilados || 0)),
                esc("ISR retenido " + dinero(r.nomina.isr_retenido) + (Math.abs(dif) >= 1 ? " · sin enterar " + dinero(dif) + " en meses ya declarados" : " · lo declarado está enterado") +
                    (r.nomina.por_declarar ? " · por declarar " + dinero(r.nomina.por_declarar) : "")), Math.abs(dif) >= 1 ? "vn-mal" : "vn-bien", "nomina");
        } else if (d.lecturas.facturas) {
            h += cifra("Nómina (SAT)", "—", "Sin lectura de nómina este año", "", "nomina");
        }
        $("vn-resumen").innerHTML = h;
    }

    /* ---------- SAT contra tus XML */
    function pintarCruce() {
        var c = P.datos.cruce, caja = $("vn-cruce");
        if (!c || !c.secciones || !c.secciones.length) { caja.innerHTML = vacio("Sin cruce todavía", "Sale cuando se lee el visor de facturas del SAT de este año."); return; }
        var s = c.secciones[Math.min(P.cruce, c.secciones.length - 1)];
        var seg = '<div class="ctx-segmento vn-seg" role="group" aria-label="Qué cruzar">' + c.secciones.map(function (x, i) {
            return '<button type="button" data-cruce="' + i + '" aria-pressed="' + (i === P.cruce) + '">' + esc(x.lado + " · " + x.tipo) + (x.diferencias ? " (" + x.diferencias + ")" : "") + "</button>";
        }).join("") + "</div>";
        var marca = function (f) {
            if (!f.diferencia) return pill("Cuadra", "bien");
            if (f.dif_vigentes < 0) return pill("Faltan " + Math.abs(f.dif_vigentes) + " XML", "ojo");
            if (f.dif_vigentes > 0) return pill("Sobran " + f.dif_vigentes + " XML", "ojo");
            return pill("Importe distinto", "ojo");
        };
        caja.innerHTML = seg + (s.consejo ? '<p class="vs-cruce__consejo">' + esc(s.consejo) + "</p>" : "") +
            '<div class="vs-tabla__caja"><table class="vs-tabla"><thead><tr><th>Mes</th><th class="vs-num">Vigentes SAT</th><th class="vs-num">Tus XML</th>' +
            '<th class="vs-num">Subtotal SAT</th><th class="vs-num">Tus XML</th><th class="vs-num">IVA SAT</th><th class="vs-num">Tus XML</th>' +
            (s.tipo === "Ingreso" ? '<th class="vs-num">Papel de IVA</th>' : "") + "<th></th></tr></thead><tbody>" +
            s.filas.map(function (f) {
                return "<tr><td>" + esc(f.nombre.charAt(0).toUpperCase() + f.nombre.slice(1)) + '</td><td class="vs-num">' + num(f.sat_vigentes) + '</td><td class="vs-num">' + num(f.xml_vigentes) +
                    '</td><td class="vs-num">' + dinero(f.sat_subtotal) + '</td><td class="vs-num">' + dinero(f.xml_subtotal) + '</td><td class="vs-num">' + dinero(f.sat_iva) +
                    '</td><td class="vs-num">' + dinero(f.xml_iva) + "</td>" + (s.tipo === "Ingreso" ? '<td class="vs-num">' + dinero(f.iva_papel) + "</td>" : "") + "<td>" + marca(f) + "</td></tr>";
            }).join("") + "</tbody></table></div>" +
            '<p class="vi-nota">' + esc(c.nota || "") + " Faltan: descárgalos en Descarga masiva. Sobran: revisa si se cancelaron (Administración de XML).</p>";
    }

    /* ---------- Facturas */
    function pintarFacturas() {
        var f = P.datos.facturas, caja = $("vn-facturas");
        if (!f.celdas.length) { caja.innerHTML = vacio("Sin lectura de facturas", "Pulsa «Leer ahora» para traer del SAT las emitidas y recibidas de " + P.datos.anio + "."); return; }
        var sel = f.celdas[Math.min(P.celda, f.celdas.length - 1)];
        var partes = function (c) {
            var m = c.metodos, x = [];
            if (m.PUE) x.push("PUE " + dinero(m.PUE.neto));
            if (m.PPD) x.push("PPD " + dinero(m.PPD.neto));
            if (!x.length) x.push(num(c.todos.vigentes) + " CFDI");
            return x.map(function (t) { return "<em>" + esc(t) + "</em>"; }).join("");
        };
        var html = '<div class="vn-matriz">' + f.celdas.map(function (c, i) {
            return '<button type="button" class="vn-celda" data-celda="' + i + '" aria-pressed="' + (c === sel) + '"><small>' + esc(c.lado + " · " + c.tipo) + "</small><b>" +
                esc(c.tipo === "Pago" ? num(c.todos.vigentes) + " CFDI" : dinero(c.todos.neto)) + "</b><span>" + partes(c) + "</span></button>";
        }).join("") + "</div>";
        var metodos = Object.keys(sel.metodos);
        html += '<div class="vn-sub"><h2>' + esc(sel.lado + " · " + sel.tipo) + "</h2><span class=\"vi-nota\" style=\"margin:0\">Por mes, como lo muestra el SAT (vigentes, sin IVA)</span></div>" +
            '<div class="vs-tabla__caja"><table class="vs-tabla"><thead><tr><th>Mes</th>' + metodos.map(function (m) {
                return '<th class="vs-num">' + esc(m === "Todos" ? "Todas" : m) + ' · núm.</th><th class="vs-num">' + esc(m === "Todos" ? "Todas" : m) + " · importe</th>";
            }).join("") + "</tr></thead><tbody>";
        var meses = {};
        metodos.forEach(function (m) { sel.metodos[m].meses.forEach(function (x) { (meses[x.mes] = meses[x.mes] || { nombre: x.nombre })[m] = x; }); });
        html += Object.keys(meses).sort(function (a, b) { return a - b; }).map(function (k) {
            var fila = meses[k];
            return "<tr><td>" + esc(fila.nombre.charAt(0).toUpperCase() + fila.nombre.slice(1)) + "</td>" + metodos.map(function (m) {
                var x = fila[m]; return '<td class="vs-num">' + (x ? num(x.vigentes) : "—") + '</td><td class="vs-num">' + (x ? dinero(x.neto) : "—") + "</td>";
            }).join("") + "</tr>";
        }).join("") + "</tbody></table></div>";
        html += '<div class="vn-acciones"><button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-excel="facturas">Excel de esta lectura</button>' +
            (f.dudosas ? '<span class="vi-nota" style="margin:0">' + f.dudosas + " consulta(s) no terminaron de cargar en el SAT y no se usan.</span>" : "") + "</div>";
        caja.innerHTML = html;
    }

    /* ---------- Nómina */
    function pintarNomina() {
        var n = P.datos.nomina, caja = $("vn-nomina"), t = n.totales || {};
        if (!n.meses.length) { caja.innerHTML = vacio("Sin lectura de nómina", "Pulsa «Leer ahora» para traer del SAT la nómina del patrón de " + P.datos.anio + " (ISR retenido contra enterado, por mes)."); return; }
        var dif = t.diferencia || 0;
        var html = '<div class="vi-tarjetas">' +
            cifra("Sueldos y salarios (SAT)", dinero(t.sueldos), esc((t.trabajadores_sueldos || 0) + " trabajadores en el mes con más"), "") +
            cifra("Asimilados (SAT)", dinero(t.asimilados), esc((t.trabajadores_asimilados || 0) + " personas en el mes con más"), "") +
            cifra("ISR retenido (SAT)", dinero(t.isr_retenido), esc("enterado " + dinero(t.isr_enterado)), "") +
            cifra("Retenido sin enterar", dinero(dif), esc((Math.abs(dif) >= 1 ? "en meses ya declarados: revisa esos pagos" : "lo declarado está enterado") +
                (t.por_declarar ? " · por declarar " + dinero(t.por_declarar) : "")), Math.abs(dif) >= 1 ? "vn-mal" : "vn-bien") +
            "</div>";
        var celdas = function (x) {
            if (!x) return '<td class="vs-num">—</td><td class="vs-num">—</td><td class="vs-num">—</td>';
            var d = x.diferencia;
            return '<td class="vs-num">' + dinero(x.isr_retenido) + '</td><td class="vs-num">' + (x.isr_enterado == null ? pill("sin enterar", "ojo") : dinero(x.isr_enterado)) +
                '</td><td class="vs-num' + (d && Math.abs(d) >= 1 ? " vs-dif" : "") + '">' + (d == null ? "—" : dinero(d)) + "</td>";
        };
        html += '<div class="vs-tabla__caja"><table class="vs-tabla"><thead><tr><th rowspan="2">Mes</th><th colspan="3">Sueldos y salarios</th><th colspan="3">Asimilados</th><th colspan="2">Tus recibos (XML)</th></tr>' +
            '<tr><th class="vs-num">ISR retenido</th><th class="vs-num">Enterado</th><th class="vs-num">Diferencia</th><th class="vs-num">ISR retenido</th><th class="vs-num">Enterado</th><th class="vs-num">Diferencia</th>' +
            '<th class="vs-num">ISR retenido</th><th></th></tr></thead><tbody>' +
            n.meses.map(function (f) {
                var tus = f.cuadra_recibos == null ? (Object.keys(f.recibos || {}).length ? "" : pill("sin recibos", "ojo")) : f.cuadra_recibos ? pill("Cuadra", "bien") : pill("No cuadra", "mal");
                return "<tr><td>" + esc(f.nombre.charAt(0).toUpperCase() + f.nombre.slice(1)) + "</td>" + celdas(f.sueldos) + celdas(f.asimilados) +
                    '<td class="vs-num">' + (Object.keys(f.recibos || {}).length ? dinero(f.isr_recibos) : "—") + "</td><td>" + tus + "</td></tr>";
            }).join("") + "</tbody></table></div>";
        html += '<div class="vn-acciones">' + (n.archivo ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-archivo>Bajar el Excel del SAT (' + esc(n.archivo.nombre) + ")</button>" : "") +
            '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-excel="nomina_patron">Excel de esta lectura</button></div>' +
            '<p class="vi-nota">Retenido: el ISR de los CFDI de nómina que timbraste. Enterado: el que pagaste en tus declaraciones. La diferencia es lo retenido que el SAT no ve pagado. «Tus recibos» suma el ISR de los XML de nómina que tienes en la biblioteca, por mes de pago.</p>';
        caja.innerHTML = html;
    }

    /* ---------- Cambios */
    function pintarCambios() {
        var c = P.datos.cambios || [], caja = $("vn-cambios"), ant = P.datos.anteriores || {};
        if (!c.length) {
            caja.innerHTML = vacio(ant.facturas || ant.nomina_patron ? "Sin cambios" : "Todavía no hay con qué comparar",
                ant.facturas || ant.nomina_patron ? "Entre las dos últimas lecturas el SAT dice lo mismo." : "Cuando haya dos lecturas del mismo visor, aquí sale solo lo que cambió en el SAT.");
            return;
        }
        caja.innerHTML = '<ul class="vn-tiempo">' + c.map(function (x) { return "<li><time>" + esc(dia(x.fecha)) + "</time><span>" + esc(x.texto) + "</span></li>"; }).join("") + "</ul>";
    }

    function pintar() {
        if (!P.datos) return;
        pintarEstado(); pintarResumen(); pintarCruce(); pintarFacturas(); pintarNomina(); pintarCambios();
    }
    function ver(vista) {
        if (VISTAS.indexOf(vista) < 0) vista = "resumen";
        P.vista = vista;
        document.querySelectorAll("#vn-pestanas [data-vn]").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.vn === vista)); });
        document.querySelectorAll(".vn-panel").forEach(function (s) { s.hidden = s.dataset.panel !== vista; });
        Fiscontable.url({ vista: vista === "resumen" ? null : vista });
    }

    async function cargar() {
        clearTimeout(P.reloj);
        P.empresa = await Fiscontable.empresaActiva().catch(function () { return null; });
        if (!P.empresa) { P.datos = null; pintarEstado(); return; }
        try {
            var d = await (await api("/api/visores/panel?rfc=" + encodeURIComponent(P.empresa.rfc) + "&anio=" + anio())).json();
            if (!P.empresa || d.rfc !== P.empresa.rfc) return;
            P.datos = d; pintar();
            if ((d.en_curso || []).length) P.reloj = setTimeout(cargar, 8000);      // mientras lee, se actualiza solo
        } catch (e) {
            $("vn-estado").innerHTML = '<span class="vn-punto vn-punto--viejo"></span>' + esc(e.message);
        }
    }

    async function leerAhora() {
        if (!P.empresa) return;
        var si = await Fiscontable.confirmar({ titulo: "¿Leer los visores del SAT?",
            texto: "Fiscontable entra con la e.firma guardada de " + (P.empresa.alias || P.empresa.rfc) + " al visor de facturas y al de nómina del patrón de " + anio() +
                   ". Solo consulta: no presenta ni envía nada. Tarda unos minutos y puedes seguir trabajando.", si: "Leer ahora" });
        if (!si) return;
        $("vn-leer").disabled = true;
        var errores = [];
        for (var visor of ["facturas", "nomina_patron"]) {
            try {
                await api("/api/visores/sat/leer", { method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ rfc: P.empresa.rfc, ejercicio: anio(), visor: visor }) });
            } catch (e) { errores.push(NOMBRE_VISOR[visor] + ": " + e.message); }
        }
        if (errores.length) Fiscontable.toast(errores.join(" · "));
        else Fiscontable.toast("Leyendo los visores del SAT. Al terminar se actualiza aquí y te llega a la campana.");
        cargar();
    }

    async function bajar(ruta, nombrePorDefecto) {
        try {
            var r = await api(ruta);
            var nombre = (/filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "") || [])[1] || nombrePorDefecto;
            var a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = nombre; a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        } catch (e) { Fiscontable.toast(e.message); }
    }

    async function arrancar() {
        if (!$("vn-leer") || !(await Fiscontable.exigirModulo("iva"))) return;
        $("vn-pestanas").addEventListener("click", function (e) { var b = e.target.closest("[data-vn]"); if (b) ver(b.dataset.vn); });
        $("vn-leer").addEventListener("click", leerAhora);
        $("vi-anio").addEventListener("change", cargar);
        document.querySelector(".mod-pagina").addEventListener("click", function (e) {
            var ir = e.target.closest("[data-ir]"); if (ir) { ver(ir.dataset.ir); return; }
            var c = e.target.closest("[data-cruce]"); if (c) { P.cruce = Number(c.dataset.cruce); pintarCruce(); return; }
            var cel = e.target.closest("[data-celda]"); if (cel) { P.celda = Number(cel.dataset.celda); pintarFacturas(); return; }
            var x = e.target.closest("[data-excel]");
            if (x && P.datos) { var l = P.datos.lecturas[x.dataset.excel]; if (l) bajar("/api/visores/sat/" + encodeURIComponent(l.id) + "/excel", "Visor_SAT.xlsx"); return; }
            if (e.target.closest("[data-archivo]") && P.datos && P.datos.nomina.archivo) {
                var a = P.datos.nomina.archivo; bajar("/api/visores/sat/" + encodeURIComponent(a.lid) + "/archivo/" + a.n, a.nombre);
            }
        });
        window.addEventListener("fiscontable:empresa", function () { P.cruce = 0; P.celda = 0; cargar(); });
        ver(Fiscontable.url("vista") || (Fiscontable.url("sat") ? "cambios" : "resumen"));
        if (Fiscontable.url("sat")) { var det = document.querySelector('[data-panel="cambios"] details'); if (det) det.open = true; }   // aviso de la campana
        cargar();
    }
    arrancar();
})();
