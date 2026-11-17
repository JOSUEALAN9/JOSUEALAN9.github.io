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
            $("vn-leer").disabled = true; $("vn-leer-caja").classList.add("vn-leer--ocupado");
            return;
        }
        $("vn-leer").disabled = false; $("vn-leer-caja").classList.remove("vn-leer--ocupado");
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
        if (lado.xml.parcial) return "tus XML: " + num(lado.xml.vigentes) + " · no comparable (el SAT cuenta solo una parte)";   // 17-nov
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
            var rn = r.nomina, sin = rn.sin_enterar || 0, mas = rn.de_mas || 0;
            h += cifra("Nómina (SAT)", dinero((rn.sueldos || 0) + (rn.asimilados || 0)),
                esc("ISR retenido " + dinero(rn.isr_retenido) + (sin >= 1 ? " · sin enterar " + dinero(sin) : mas >= 1 ? " · enterado de más " + dinero(mas) : " · lo declarado está enterado") +
                    (rn.por_declarar ? " · por declarar " + dinero(rn.por_declarar) : "")), sin >= 1 ? "vn-mal" : mas >= 1 ? "vn-ojo" : "vn-bien", "nomina");
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
            if (f.no_comparable) return pill("No comparable", "ojo");          // 17-nov: el SAT cuenta solo una parte de las recibidas
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
            '<div class="vn-acciones"><button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-cruce-excel title="Todas las hojas del cruce (emitidas, recibidas y nómina) con sus diferencias">Excel del cruce</button></div>' +
            '<p class="vi-nota">' + esc(c.nota || "") + (s.parcial ? "" : " Faltan: descárgalos en Descarga masiva. Sobran: revisa si se cancelaron (Administración de XML).") + "</p>";
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
        html += '<div class="vn-acciones"><button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-excel="facturas" title="Lo arma Fiscontable con las tablas que leyó">Excel de Fiscontable</button>' +
            (f.dudosas ? '<span class="vi-nota" style="margin:0">' + f.dudosas + " consulta(s) no terminaron de cargar en el SAT y no se usan.</span>" : "") + "</div>";
        caja.innerHTML = html;
    }

    /* ---------- Nómina */
    // 15-nov (pruebas 1 de Alan): tus XML separados en sueldos y asimilados, la diferencia del SAT con su signo (entre
    // paréntesis en el SAT = enteraste DE MÁS) y el Excel del SAT o por qué no salió.
    function tarjetaDiferencia(t) {
        var meses = function (l) { return (l || []).join(", "); };
        var extra = t.por_declarar ? " · por declarar " + dinero(t.por_declarar) : "";
        if (t.sin_enterar >= 1)
            return cifra("Retenido sin enterar", dinero(t.sin_enterar), esc("en " + meses(t.meses_sin_enterar) + ": revisa esos pagos" +
                (t.de_mas >= 1 ? " · enterado de más " + dinero(t.de_mas) : "") + extra), "vn-mal");
        if (t.de_mas >= 1)
            return cifra("Enterado de más", dinero(t.de_mas), esc("en " + meses(t.meses_de_mas) + ": pagaste más de lo retenido" + extra), "vn-ojo");
        return cifra("Retenido sin enterar", dinero(0), esc("lo declarado está enterado" + extra), "vn-bien");
    }
    function pintarNomina() {
        var n = P.datos.nomina, caja = $("vn-nomina"), t = n.totales || {};
        if (!n.meses.length) { caja.innerHTML = vacio("Sin lectura de nómina", "Pulsa «Leer ahora» para traer del SAT la nómina del patrón de " + P.datos.anio + " (ISR retenido contra enterado, por mes)."); return; }
        var hayAsim = n.meses.some(function (f) { return f.asimilados || f.xml_asimilados; });
        var grupo = hayAsim && P.nomGrupo === "asimilados" ? "asimilados" : "sueldos";
        var html = '<div class="vi-tarjetas">' +
            cifra("Sueldos y salarios (SAT)", dinero(t.sueldos), esc((t.trabajadores_sueldos || 0) + " trabajadores en el mes con más"), "") +
            cifra("Asimilados (SAT)", dinero(t.asimilados), esc((t.trabajadores_asimilados || 0) + " personas en el mes con más"), "") +
            cifra("ISR retenido (SAT)", dinero(t.isr_retenido), esc("enterado " + dinero(t.isr_enterado)), "") +
            tarjetaDiferencia(t) + "</div>";
        if (hayAsim) html += '<div class="ctx-segmento vn-seg" role="group" aria-label="Qué nómina ver">' +
            [["sueldos", "Sueldos y salarios"], ["asimilados", "Asimilados"]].map(function (g) {
                return '<button type="button" data-nomgrupo="' + g[0] + '" aria-pressed="' + (g[0] === grupo) + '">' + g[1] + "</button>";
            }).join("") + "</div>";
        var difSat = function (d) {
            if (d == null) return '<td class="vs-num">—</td>';
            if (d >= 1) return '<td class="vs-num vs-dif" title="Retenido que el SAT no ve enterado">' + dinero(d) + "</td>";
            if (d <= -1) return '<td class="vs-num vn-de-mas" title="Enteraste más de lo retenido">−' + dinero(-d) + "</td>";
            return '<td class="vs-num">' + dinero(0) + "</td>";
        };
        var hayMixto = null;          // 17-nov: un mes que cuadra porque el SAT cuenta en sueldos el ISR de asimilados de quien también cobró sueldo
        html += '<div class="vs-tabla__caja"><table class="vs-tabla"><thead><tr><th rowspan="2">Mes</th><th colspan="3">SAT</th><th colspan="3">Tus recibos (XML)</th></tr>' +
            '<tr><th class="vs-num">ISR retenido</th><th class="vs-num">Enterado</th><th class="vs-num">Diferencia</th>' +
            '<th class="vs-num">ISR retenido</th><th class="vs-num">Contra el SAT</th><th></th></tr></thead><tbody>' +
            n.meses.map(function (f) {
                var x = f[grupo] || null, xml = f["xml_" + grupo], dx = f["dif_xml_" + grupo], cu = f["cuadra_" + grupo];
                var estado = cu == null ? (xml == null ? pill("sin recibos", "ojo") : (x ? "" : pill("sin SAT", "ojo"))) : cu ? pill(f.mixto ? "Cuadra *" : "Cuadra", "bien") : pill("No cuadra", "mal");
                if (f.mixto) hayMixto = f.mixto;
                return "<tr><td>" + esc(f.nombre.charAt(0).toUpperCase() + f.nombre.slice(1)) + "</td>" +
                    '<td class="vs-num">' + (x ? dinero(x.isr_retenido) : "—") + "</td>" +
                    '<td class="vs-num">' + (!x ? "—" : x.isr_enterado == null ? pill("sin enterar", "ojo") : dinero(x.isr_enterado)) + "</td>" +
                    (x ? difSat(x.isr_enterado == null ? null : x.diferencia) : '<td class="vs-num">—</td>') +
                    '<td class="vs-num" title="' + esc((f["recibos_" + grupo] || 0) + " recibo(s)") + '">' + (xml == null ? "—" : dinero(xml)) + "</td>" +
                    '<td class="vs-num' + (dx != null && Math.abs(dx) >= 1 && xml != null && x ? " vs-dif" : "") + '">' + (dx == null || xml == null || !x ? "—" : dinero(dx)) + "</td>" +
                    "<td>" + estado + "</td></tr>";
            }).join("") + "</tbody></table></div>";
        html += '<div class="vn-acciones">' + (n.archivo ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-archivo title="El archivo que da el SAT en el Detalle mensual">Excel del SAT (detalle mensual)</button>' : "") +
            '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-excel="nomina_patron" title="Lo arma Fiscontable con las tablas que leyó">Excel de Fiscontable</button></div>' +
            (!n.archivo && n.excel_motivo ? '<p class="vi-nota vn-aviso">El Excel del SAT no salió en esta lectura: ' + esc(n.excel_motivo) + ".</p>" : "") +
            (hayMixto ? '<p class="vi-nota">* Cuadra: el SAT cuenta en sueldos ' + dinero(hayMixto.isr_asimilados) + " de ISR de asimilados de " + num(hayMixto.trabajadores) +
                " trabajador(es) que ese mes también cobraron sueldo (su renglón de asimilados es solo de pagos exclusivos de asimilados).</p>" : "") +
            '<p class="vi-nota">Retenido: el ISR de los CFDI de nómina que timbraste. Enterado: el que pagaste en tus declaraciones. Diferencia en rojo: retenido que el SAT no ve pagado; con signo menos: enteraste más de lo retenido (el SAT la pone entre paréntesis). «Tus recibos» suma el ISR de tus XML de nómina de ' +
            (grupo === "asimilados" ? "asimilados (régimen 05 a 11)" : "sueldos y salarios") + ", por mes de pago.</p>";
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

    /* «Leer ahora ▾» (15-nov, Alan: «un desplegable de selección rápida: le paso el puntero o doy clic y sale ahí mismo»):
       facturas y nómina, solo facturas o solo nómina; al elegir, empieza a leer. */
    function menuLeer(abrir) {
        var caja = $("vn-leer-caja");
        caja.classList.toggle("vn-leer--abierto", abrir);
        $("vn-leer").setAttribute("aria-expanded", String(abrir));
    }
    async function leerAhora(visores) {
        if (!P.empresa || !visores.length) return;
        menuLeer(false);
        // 15-nov (Alan): si ya se leyó hoy, preguntar antes de volver a entrar al SAT (cada lectura cuenta para el tope)
        var d = P.datos || {}, hoy = new Date().toDateString();
        var deHoy = visores.filter(function (v) {
            var l = (d.lecturas || {})[v], t = l && (l.terminada || l.creada);
            return t && new Date(/([zZ]|[+-]\d\d:\d\d)$/.test(t) ? t : t + "Z").toDateString() === hoy;
        });
        if (deHoy.length) {
            var lleva = d.lecturas_hoy || 0, tope = d.tope_diario || 0;
            var si = await Fiscontable.confirmar({
                titulo: "Ya leíste hoy",
                texto: ("Ya leíste " + deHoy.map(function (v) { var l = d.lecturas[v]; return NOMBRE_VISOR[v] + " el " + cuando(l.terminada || l.creada); }).join(" y ")).replace(/\.?$/, ".") +
                    " ¿Leer otra vez? Llevas " + lleva + (tope ? " de " + tope : "") + " lecturas de esta empresa en las últimas 24 horas" +
                    (visores.length > 1 ? "; esta cuenta " + visores.length : "") + ".",
                si: "Leer otra vez", no: "No" });
            if (!si) return;
        }
        $("vn-leer").disabled = true; $("vn-leer-caja").classList.add("vn-leer--ocupado");
        var errores = [];
        for (var visor of visores) {
            try {
                await api("/api/visores/sat/leer", { method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ rfc: P.empresa.rfc, ejercicio: anio(), visor: visor }) });
            } catch (e) { errores.push(NOMBRE_VISOR[visor] + ": " + e.message); }
        }
        $("vn-leer-caja").classList.remove("vn-leer--ocupado");
        if (errores.length) Fiscontable.toast(errores.join(" · "));
        else Fiscontable.toast("Leyendo " + visores.map(function (v) { return NOMBRE_VISOR[v]; }).join(" y ") + " del SAT" +
            (visores.length > 1 ? ", uno después del otro" : "") + ". Al terminar se actualizan aquí todas las pestañas y te llega a la campana.");
        $("vn-leer").disabled = false;
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
        $("vn-leer").addEventListener("click", function (e) { e.stopPropagation(); menuLeer(!$("vn-leer-caja").classList.contains("vn-leer--abierto")); });
        $("vn-leer-menu").addEventListener("click", function (e) {
            var b = e.target.closest("[data-leer]"); if (!b) return;
            e.stopPropagation(); leerAhora(b.dataset.leer.split(","));
        });
        document.addEventListener("click", function (e) { if (!e.target.closest("#vn-leer-caja")) menuLeer(false); });
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") menuLeer(false); });
        $("vi-anio").addEventListener("change", cargar);
        document.querySelector(".mod-pagina").addEventListener("click", function (e) {
            var ir = e.target.closest("[data-ir]"); if (ir) { ver(ir.dataset.ir); return; }
            var c = e.target.closest("[data-cruce]"); if (c) { P.cruce = Number(c.dataset.cruce); pintarCruce(); return; }
            var cel = e.target.closest("[data-celda]"); if (cel) { P.celda = Number(cel.dataset.celda); pintarFacturas(); return; }
            var ng = e.target.closest("[data-nomgrupo]"); if (ng) { P.nomGrupo = ng.dataset.nomgrupo; pintarNomina(); return; }
            if (e.target.closest("[data-cruce-excel]") && P.empresa) {
                bajar("/api/visores/cruce/excel?rfc=" + encodeURIComponent(P.empresa.rfc) + "&anio=" + anio(), "Cruce_SAT_" + P.empresa.rfc + "_" + anio() + ".xlsx"); return;
            }
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
