/**
 * visores-sat.js — Visor del SAT dentro de Fiscontable: entra con la e.firma guardada, copia lo que el visor muestra
 * (tablas y capturas, mes por mes) y lo deja guardado para consultarlo después o bajarlo a Excel.
 * Servidor: modulos/visores/sat.py. Solo consulta: nada se presenta ni se envía.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var S = { empresa: null, lecturas: [], abierta: null, pantalla: 0, reloj: null, tope: 4 };
    var VIVA = { en_cola: 1, en_curso: 1 };
    var ESTADO = { en_cola: ["En espera", ""], en_curso: ["Leyendo…", "ui-estado--info"], completado: ["Guardada", "ui-estado--ok"],
                   detenido: ["Detenida", ""], error: ["No se pudo", "ui-estado--error"] };

    async function api(ruta, opciones) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r;
    }
    function fecha(iso) {
        var x = new Date(/Z$/.test(iso) ? iso : iso + "Z");
        return isNaN(x) ? "" : x.toLocaleString("es-MX", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    function decir(texto, mal) { var m = $("vs-msj"); m.textContent = texto || ""; m.className = "vs-msj" + (mal ? " vs-msj--mal" : ""); }

    function pintarLista() {
        if (!$("vs-leer")) return;                      // la página se bloqueó (módulo sin acceso)
        var caja = $("vs-lista");
        if (!S.lecturas.length) {
            caja.innerHTML = '<p class="vs-vacio">Todavía no hay lecturas guardadas de esta empresa. Pulsa «Leer el visor del SAT»: tarda de uno a tres minutos y puedes seguir trabajando mientras tanto.</p>';
            return;
        }
        caja.innerHTML = S.lecturas.map(function (l) {
            var e = ESTADO[l.estado] || [l.estado, ""], viva = VIVA[l.estado];
            return '<div class="vs-fila' + (S.abierta && S.abierta.id === l.id ? " vs-fila--abierta" : "") + '" data-id="' + esc(l.id) + '">' +
                '<div class="vs-fila__que"><b>' + esc((l.nombre || "Visor").split(" (")[0]) + " · " + esc(l.ejercicio) + '</b><span>' + esc(fecha(l.creada)) + (l.pantallas ? " · " + l.pantallas + " pantallas · " + l.tablas + " tablas" : "") + "</span>" +
                (l.mensaje && (viva || l.estado !== "completado") ? "<small>" + esc(l.mensaje) + "</small>" : "") + "</div>" +
                '<span class="ui-estado ' + e[1] + '">' + esc(e[0]) + "</span>" +
                '<div class="vs-fila__btn">' +
                (viva ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-detener>Detener</button>'
                      : (l.pantallas ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-ver>Ver</button>' +
                                       '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-excel>Excel</button>' : "") +
                        '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-borrar title="Borrar esta lectura">Borrar</button>') +
                "</div></div>";
        }).join("");
    }

    var NUM = /^-?\$?\s?[\d,]+(\.\d+)?$/;
    function tabla(t) {
        var num = (t.filas[0] || []).map(function (c) { return NUM.test(c); });      // columnas de números: a la derecha, con su encabezado
        return (t.titulo ? '<p class="vs-tabla__titulo">' + esc(t.titulo) + "</p>" : "") + '<div class="vs-tabla__caja"><table class="vs-tabla">' +
            (t.encabezados && t.encabezados.length ? "<thead><tr>" + t.encabezados.map(function (h, i) { return "<th" + (num[i] ? ' class="vs-num"' : "") + ">" + esc(h) + "</th>"; }).join("") + "</tr></thead>" : "") +
            "<tbody>" + t.filas.map(function (f) {
                return "<tr>" + f.map(function (c) { return "<td" + (NUM.test(c) ? ' class="vs-num"' : "") + ">" + esc(c) + "</td>"; }).join("") + "</tr>";
            }).join("") + "</tbody></table></div>";
    }
    function pintarDetalle() {
        if (!$("vs-leer")) return;                      // la página se bloqueó (módulo sin acceso)
        var caja = $("vs-detalle"), d = S.abierta;
        if (!d) { caja.hidden = true; caja.innerHTML = ""; return; }
        var p = d.detalle[S.pantalla] || d.detalle[0];
        caja.hidden = false;
        var esCruce = S.pantalla === "cruce";
        if (esCruce) p = null;
        caja.innerHTML = '<div class="vs-detalle__cab"><b>Lo que mostró el SAT · ejercicio ' + esc(d.ejercicio) + "</b><span>Leído el " + esc(fecha(d.creada)) + "</span>" +
            '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" id="vs-cerrar" style="margin-left:auto">Cerrar</button></div>' +
            (d.visor === "facturas" ? '<div class="vs-pantallas" role="tablist"><button type="button" role="tab" data-p="cruce" aria-selected="' + esCruce + '">Cruce con tus XML e IVA</button></div>' : "") +
            (esCruce ? '<div id="vs-cruce" class="vs-cruce"><p class="vs-vacio">Armando el cruce…</p></div>' : "") +
            '<div class="vs-pantallas" role="tablist">' + d.detalle.map(function (x, i) {
                return '<button type="button" role="tab" data-p="' + i + '" aria-selected="' + (i === S.pantalla) + '"' + (x.tablas.length ? "" : ' class="vs-sin"') + ">" + esc(x.etiqueta) + "</button>";
            }).join("") + "</div>" +
            (p ? (p.pares.length ? '<dl class="vs-pares">' + p.pares.slice(0, 12).map(function (q) { return "<div><dt>" + esc(q[0]) + "</dt><dd>" + esc(q[1]) + "</dd></div>"; }).join("") + "</dl>" : "") +
                 (p.tablas.length ? p.tablas.map(tabla).join("") : '<p class="vs-vacio">Esta pantalla no traía tablas' + (p.texto ? ". Texto que se veía: «" + esc(p.texto.slice(0, 400)) + (p.texto.length > 400 ? "…" : "") + "»" : ".") + "</p>") +
                 (p.archivo ? '<p><button type="button" class="ui-btn ui-btn--secundario ui-btn--32" id="vs-archivo">Bajar el Excel del SAT (' + esc(p.archivo) + ")</button></p>" : "") +
                 (p.captura ? '<div class="vs-captura"><button type="button" class="ui-btn ui-btn--secundario ui-btn--32" id="vs-ver-captura">Ver la captura de esta pantalla</button><div id="vs-img"></div></div>' : "")
               : "");
        if (esCruce) pintarCruce();
        var elegida = caja.querySelector('.vs-pantallas [aria-selected="true"]');
        if (elegida && elegida.scrollIntoView) elegida.scrollIntoView({ block: "nearest", inline: "center" });
    }

    var dinero = function (v) { return v == null ? "—" : "$" + Number(v).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    async function pintarCruce() {
        var caja = $("vs-cruce");
        try {
            var c = await (await api("/api/visores/sat/" + encodeURIComponent(S.abierta.id) + "/cruce")).json();
            if (!$("vs-cruce")) return;
            caja.innerHTML = '<p class="vs-vacio">' + esc(c.nota) + "</p>" + (c.secciones.length ? c.secciones.map(function (s) {
                var dif = function (v, n) { return v ? '<span class="vs-dif">' + (n ? (v > 0 ? "+" : "") + v : dinero(v)) + "</span>" : '<span class="vs-bien">✓</span>'; };
                return "<div><h4>" + esc(s.lado + " · " + s.tipo) + " — " + (s.diferencias ? s.diferencias + " mes(es) con diferencia" : "sin diferencias") + "</h4>" +
                    (s.consejo ? '<p class="vs-cruce__consejo">' + esc(s.consejo) + "</p>" : "") +
                    '<div class="vs-tabla__caja"><table class="vs-tabla"><thead><tr><th>Mes</th><th class="vs-num">SAT vigentes</th><th class="vs-num">Tus XML</th><th class="vs-num">Dif.</th>' +
                    '<th class="vs-num">SAT subtotal</th><th class="vs-num">Tus XML</th><th class="vs-num">Dif.</th><th class="vs-num">SAT IVA</th><th class="vs-num">Tus XML</th><th class="vs-num">Dif.</th>' +
                    (s.tipo === "Ingreso" ? '<th class="vs-num">IVA ' + (s.lado === "Emitidas" ? "cobrado" : "pagado") + " (papel)</th>" : "") + "</tr></thead><tbody>" +
                    s.filas.map(function (f) {
                        return "<tr><td>" + esc(f.nombre) + '</td><td class="vs-num">' + f.sat_vigentes + '</td><td class="vs-num">' + f.xml_vigentes + '</td><td class="vs-num">' + dif(f.dif_vigentes, true) +
                            '</td><td class="vs-num">' + dinero(f.sat_subtotal) + '</td><td class="vs-num">' + dinero(f.xml_subtotal) + '</td><td class="vs-num">' + dif(Math.abs(f.dif_subtotal) > 1 ? f.dif_subtotal : 0) +
                            '</td><td class="vs-num">' + dinero(f.sat_iva) + '</td><td class="vs-num">' + dinero(f.xml_iva) + '</td><td class="vs-num">' + dif(Math.abs(f.dif_iva) > 1 ? f.dif_iva : 0) + "</td>" +
                            (s.tipo === "Ingreso" ? '<td class="vs-num">' + dinero(f.iva_papel) + "</td>" : "") + "</tr>";
                    }).join("") + "</tbody></table></div></div>";
            }).join("") : '<p class="vs-vacio">Esta lectura no trae las tablas de «Todos» los métodos de pago para cruzar.</p>');
        } catch (e) { if ($("vs-cruce")) caja.innerHTML = '<p class="vs-vacio">' + esc(e.message) + "</p>"; }
    }

    async function cargar(silencio) {
        if (!$("vs-leer")) return;                      // la página se bloqueó (módulo sin acceso)
        if (!S.empresa) { $("vs-caja").hidden = true; return; }
        $("vs-caja").hidden = false;
        try {
            var r = await (await api("/api/visores/sat?rfc=" + encodeURIComponent(S.empresa.rfc))).json();
            S.lecturas = r.lecturas; S.tope = r.tope_diario;
            var sel = $("vs-visor");
            if (sel && !sel.options.length && r.visores) {
                sel.innerHTML = r.visores.map(function (v) { return '<option value="' + esc(v.clave) + '">' + esc(v.nombre) + "</option>"; }).join("");
                sel.value = r.visores.some(function (v) { return v.clave === "facturas"; }) ? "facturas" : r.visores[0].clave;
            }
            pintarLista();
            var viva = S.lecturas.some(function (l) { return VIVA[l.estado]; });
            $("vs-leer").disabled = viva;
            clearTimeout(S.reloj);
            if (viva) S.reloj = setTimeout(function () { cargar(true); }, 3000);
            else if (silencio && S.lecturas[0] && S.lecturas[0].estado === "completado" && S.lecturas[0].pantallas) { decir("✓ Lectura guardada."); abrir(S.lecturas[0].id); }
        } catch (e) { if (!silencio) decir(e.message, true); }
    }
    async function abrir(id) {
        try {
            S.abierta = await (await api("/api/visores/sat/" + encodeURIComponent(id))).json();
            var conTablas = S.abierta.detalle.findIndex(function (x) { return x.tablas.length; });
            S.pantalla = S.abierta.visor === "facturas" ? "cruce" : (conTablas < 0 ? 0 : conTablas);
            pintarLista(); pintarDetalle();
            $("vs-detalle").scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch (e) { decir(e.message, true); }
    }

    async function leer() {
        if (!S.empresa) return;
        var anio = Number($("vi-anio").value);
        var nombreVisor = $("vs-visor").selectedOptions[0] ? $("vs-visor").selectedOptions[0].text : "el visor";
        var si = await Fiscontable.confirmar({ titulo: "Leer " + nombreVisor.split(" (")[0].toLowerCase() + " de " + anio,
            texto: "Fiscontable entra al visor con la e.firma guardada de " + (S.empresa.alias || S.empresa.rfc) + ", copia lo que muestra mes por mes y lo deja guardado aquí. " +
                   "Solo consulta: no presenta ni envía nada. Tarda de uno a tres minutos.", si: "Leer el visor" });
        if (!si) return;
        $("vs-leer").disabled = true; decir("Pidiendo la lectura…");
        try {
            await api("/api/visores/sat/leer", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rfc: S.empresa.rfc, ejercicio: anio, visor: $("vs-visor").value || "ingresos_egresos" }) });
            decir("Leyendo el visor del SAT. Puedes seguir trabajando: al terminar aparece aquí y en la campana.");
            cargar(true);
        } catch (e) { decir(e.message, true); $("vs-leer").disabled = false; }
    }

    async function accion(e) {
        var fila = e.target.closest(".vs-fila"); if (!fila) return;
        var id = fila.dataset.id;
        try {
            if (e.target.closest("[data-ver]")) { abrir(id); }
            else if (e.target.closest("[data-excel]")) {
                var r = await api("/api/visores/sat/" + encodeURIComponent(id) + "/excel");
                var nombre = (/filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "") || [])[1] || "Visor_SAT.xlsx";
                var a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = nombre; a.click();
                setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
            } else if (e.target.closest("[data-detener]")) {
                await api("/api/visores/sat/" + encodeURIComponent(id) + "/detener", { method: "POST" }); decir("Deteniendo: se guarda lo copiado hasta ahí."); cargar(true);
            } else if (e.target.closest("[data-borrar]")) {
                if (!(await Fiscontable.confirmar({ titulo: "¿Borrar esta lectura?", texto: "Se borran sus tablas y sus capturas. Lo que diga el SAT no cambia: puedes volver a leerlo.", si: "Borrar", peligro: true }))) return;
                await api("/api/visores/sat/" + encodeURIComponent(id), { method: "DELETE" });
                if (S.abierta && S.abierta.id === id) { S.abierta = null; pintarDetalle(); }
                cargar();
            }
        } catch (er) { decir(er.message, true); }
    }

    async function arrancar() {
        if (!$("vs-leer")) return;                      // módulo sin acceso: la página ya muestra el aviso
        $("vs-leer").addEventListener("click", leer);
        $("vs-lista").addEventListener("click", accion);
        $("vs-detalle").addEventListener("click", async function (e) {
            var p = e.target.closest("[data-p]");
            if (p) { S.pantalla = p.dataset.p === "cruce" ? "cruce" : Number(p.dataset.p); pintarDetalle(); return; }
            if (e.target.closest("#vs-archivo")) {
                var x0 = S.abierta.detalle[S.pantalla];
                try {
                    var rr = await api("/api/visores/sat/" + encodeURIComponent(S.abierta.id) + "/archivo/" + x0.n);
                    var a0 = document.createElement("a"); a0.href = URL.createObjectURL(await rr.blob()); a0.download = x0.archivo; a0.click();
                    setTimeout(function () { URL.revokeObjectURL(a0.href); }, 4000);
                } catch (er) { decir(er.message, true); }
                return;
            }
            if (e.target.closest("#vs-cerrar")) { S.abierta = null; pintarLista(); pintarDetalle(); return; }
            if (e.target.closest("#vs-ver-captura")) {
                var x = S.abierta.detalle[S.pantalla], caja = $("vs-img");
                caja.innerHTML = '<p class="vs-vacio">Cargando la captura…</p>';
                try {
                    var b = await (await api("/api/visores/sat/" + encodeURIComponent(S.abierta.id) + "/captura/" + x.n)).blob();
                    var img = new Image(); img.alt = "Captura de la pantalla del SAT: " + x.etiqueta; img.src = URL.createObjectURL(b);
                    caja.innerHTML = ""; caja.appendChild(img);
                } catch (er) { caja.innerHTML = '<p class="vs-vacio">' + esc(er.message) + "</p>"; }
            }
        });
        async function empresa() {
            S.empresa = await Fiscontable.empresaActiva().catch(function () { return null; });
            S.abierta = null; pintarDetalle(); decir("");
            await cargar();
            var pedido = Fiscontable.url("sat");
            if (pedido && S.lecturas.some(function (l) { return l.id === pedido; })) abrir(pedido);
        }
        window.addEventListener("fiscontable:empresa", empresa);
        empresa();
    }
    arrancar();
})();
