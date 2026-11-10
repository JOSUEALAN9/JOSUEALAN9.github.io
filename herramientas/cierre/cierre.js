/**
 * cierre.js — Cierre del mes de toda la cartera: una fila por empresa y un cuadro por paso (XML, validados, constancia,
 * opinión, buzón, estatales, voucheo, declaración). Arriba se elige el mes; en un despacho, cada empresa tiene su
 * responsable y «Solo los míos» deja las tuyas. Los datos salen de GET /api/cierre (modulos/tablero/router.py).
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var E = { datos: null, tabla: null, periodo: new URLSearchParams(location.search).get("periodo") || "", columnas: "" };
    var PASOS = {
        xml: ["XML", "XML del mes descargados"], validados: ["Validados", "Validados ante el SAT"], constancia: ["Constancia", "Constancia del mes"],
        opinion: ["32-D", "Opinión de cumplimiento del mes"], buzon: ["Buzón", "Buzón Tributario (hoy)"], estatales: ["Estatales", "Impuestos estatales presentados"],
        voucheo: ["Voucheo", "Voucheo del mes"], declaracion: ["Declaración", "Acuse de la declaración mensual guardado"]
    };
    var TEXTO = { ok: "Listo", pend: "Pendiente", mal: "Revisar", falta: "Falta", na: "No aplica" };
    var ICONO = {
        ok: '<svg viewBox="0 0 12 12"><path d="M2.5 6.3l2.3 2.3 4.7-5"/></svg>',
        pend: '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="3.6"/><path d="M6 4.2V6l1.2.8"/></svg>',
        mal: "!", falta: '<svg viewBox="0 0 12 12"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5"/></svg>'
    };
    var fecha = function (iso) { return new Date(iso + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" }).replace(".", ""); };
    var mayus = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };

    async function api(ruta, opciones) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }

    function cuadro(rfc, p) {
        if (!p) return '<span class="ci-e ci-e--na" title="No aplica">—</span>';
        var num = /^\d+$/.test(p.e), clase = num ? "num" : p.e;
        return '<a class="ci-e ci-e--' + clase + '" href="' + esc(p.pagina) + '" data-ir="' + esc(rfc) + '" title="' + esc(p.nota || TEXTO[p.e] || "") + '" aria-label="' + esc(p.nota || TEXTO[p.e] || "") + '">' +
            (num ? esc(p.e) : ICONO[p.e] || "") + "</a>";
    }
    function nombreDe(correo) {
        var m = (E.datos.equipo || []).find(function (x) { return x.correo === correo; });
        return m ? m.nombre : "";
    }
    function celdaResponsable(f) {
        var d = E.datos, yo = d.yo, opciones = [["", "Sin asignar"]];
        if (d.puede_asignar) d.equipo.forEach(function (m) { opciones.push([m.correo, m.nombre + (m.correo === yo ? " (yo)" : "")]); });
        else {
            opciones.push([yo, (nombreDe(yo) || "Yo") + " (yo)"]);
            if (f.responsable && f.responsable !== yo) opciones = [[f.responsable, nombreDe(f.responsable)]];      // de otra persona: solo se ve
        }
        return '<select class="ci-resp' + (f.responsable ? "" : " ci-resp--vacio") + '" data-responsable="' + esc(f.rfc) + '" aria-label="Responsable de ' + esc(f.alias) + '"' +
            (opciones.length === 1 ? " disabled" : "") + ">" +
            opciones.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === (f.responsable || "") ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>";
    }

    function filas() {
        var d = E.datos;
        return d.filas.map(function (f) {
            var r = { rfc: f.rfc, empresa: f.alias, situacion: f.situacion, avance: f.hechos + " de " + f.total, _f: f,
                      responsable_txt: f.responsable ? nombreDe(f.responsable) : "Sin asignar", mio: f.responsable === d.yo ? "Sí" : "No" };
            d.columnas.forEach(function (k) {
                var p = f.pasos[k];
                r[k] = !p ? "No aplica" : /^\d+$/.test(p.e) ? p.e + " por atender" : TEXTO[p.e] + (p.nota && p.e !== "ok" ? " (" + p.nota + ")" : "");
            });
            return r;
        });
    }

    function armarTabla() {
        var d = E.datos, firma = d.columnas.join(",") + "|" + (d.equipo ? "e" : "");
        if (E.tabla && E.columnas === firma) return;
        E.columnas = firma;
        var catalogo = [{ clave: "empresa", etiqueta: "Cliente", tipo: "texto" }]
            .concat(d.columnas.map(function (k) { return { clave: k, etiqueta: PASOS[k][0], tipo: "texto", titulo: PASOS[k][1] }; }))
            .concat([{ clave: "avance", etiqueta: "Avance", tipo: "texto" }, { clave: "situacion", etiqueta: "Situación", tipo: "texto" }])
            .concat(d.equipo ? [{ clave: "responsable_txt", etiqueta: "Responsable", tipo: "texto" }] : [])
            .concat([{ clave: "rfc", etiqueta: "RFC", tipo: "texto" }]);
        // En el celular el nombre ocupa menos para que se vean dos o tres pasos sin deslizar
        var anchos = { empresa: window.innerWidth < 560 ? 150 : 250, avance: 104, situacion: 120, responsable_txt: 160, rfc: 130 };
        d.columnas.forEach(function (k) { anchos[k] = k === "declaracion" ? 100 : k === "constancia" || k === "validados" || k === "estatales" || k === "voucheo" ? 90 : 70; });
        $("ci-tabla").innerHTML = "";
        E.tabla = FCTabla.estandar({
            contenedor: $("ci-tabla"), id: "cierre_v1", claveFila: "rfc", catalogo: catalogo,
            predeterminadas: ["empresa"].concat(d.columnas, ["avance"], d.equipo ? ["responsable_txt"] : []),
            anchoClave: anchos,
            buscar: { texto: "Buscar cliente o RFC…", campos: ["empresa", "rfc"] },
            rapidos: { clave: "situacion", valores: [{ valor: "Vencida", etiqueta: "Vencidas" }, { valor: "Vence pronto", etiqueta: "Vencen pronto" },
                                                      { valor: "Le falta algo", etiqueta: "Les falta algo" }, { valor: "Completo", etiqueta: "Completos" }] },
            filtros: d.equipo ? [{ clave: "responsable_txt", etiqueta: "Responsable" }, { clave: "mio", etiqueta: "Solo los míos", texto: function () { return "sí"; } }] : [],
            alFiltrar: function () { sincronizarMios(); },
            exportar: { nombre: "Cierre_del_mes.xlsx", hoja: "Cierre" },
            vacio: { titulo: "Todavía no tienes empresas", texto: "Regístralas en Clientes para ver aquí su cierre." },
            celda: function (c, r) {
                var f = r._f;
                if (c.clave === "empresa") return '<span class="ci-cli"><b>' + esc(f.alias) + "</b><small>" + esc(f.rfc) + "</small></span>";
                if (PASOS[c.clave]) return cuadro(f.rfc, f.pasos[c.clave]);
                if (c.clave === "avance") {
                    var tono = f.hechos === f.total ? "ok" : f.situacion === "Vencida" ? "error" : "";
                    return '<span title="' + esc(f.situacion) + '"><span class="ci-barrita' + (tono ? " ci-barrita--" + tono : "") + '"><i style="width:' + Math.round(100 * f.hechos / f.total) + '%"></i></span>' +
                        f.hechos + "/" + f.total + "</span>";
                }
                if (c.clave === "situacion") return '<span class="ui-estado ui-estado--' + (f.situacion === "Completo" ? "ok" : f.situacion === "Vencida" ? "error" : "aviso") + '">' + esc(f.situacion) + "</span>";
                if (c.clave === "responsable_txt") return celdaResponsable(f);
                return null;
            },
            alClic: function (r, visibles, ev) {
                if (ev && ev.target.closest("select, a")) return;
                irCon(r.rfc, "/inicio/");
            }
        });
    }

    // Si quitan el filtro desde su etiqueta, la casilla de arriba se entera
    function sincronizarMios() {
        setTimeout(function () {
            var puesto = !!$("ci-tabla").querySelector('.fct-chips [data-quitar="mio"]');
            if ($("ci-mios").checked === puesto) return;
            $("ci-mios").checked = puesto; recordarMios(puesto);
        }, 0);
    }

    async function irCon(rfc, pagina) {
        try { await Fiscontable.elegirEmpresa(rfc); } catch (e) { Fiscontable.toast(e.message); return; }
        location.href = pagina;
    }

    function pintar() {
        var d = E.datos, lista = filas();
        armarTabla();
        // Meses
        $("ci-meses").innerHTML = d.periodos.map(function (p) {
            return '<button type="button" data-periodo="' + esc(p.valor) + '" aria-pressed="' + (p.valor === d.periodo) + '"' +
                (p.valor === d.de_fabrica ? ' title="El mes que se declara ahora"' : "") + ">" + esc(p.texto) +
                (String(p.anio) !== String(new Date().getFullYear()) ? "<small>" + String(p.anio).slice(2) + "</small>" : "") + "</button>";
        }).join("");
        // Encabezado: mes, vencimiento
        var vence = d.dias < 0 ? '<span class="ci-vencida">venció el ' + esc(fecha(d.vence)) + "</span>"
            : "vence el <b>" + esc(fecha(d.vence)) + "</b>" + (d.dias === 0 ? " (hoy)" : d.dias === 1 ? " (mañana)" : " (en " + d.dias + " días)");
        $("ci-sub").innerHTML = "<b>" + esc(mayus(d.mes)) + " " + d.anio + "</b> · la declaración mensual " + vence + ". Fecha general: revisa la de cada régimen.";
        // Avance de la cartera
        var completas = d.filas.filter(function (f) { return f.hechos === f.total; }).length;
        var hechos = d.filas.reduce(function (s, f) { return s + f.hechos; }, 0), total = d.filas.reduce(function (s, f) { return s + f.total; }, 0);
        var pct = total ? Math.round(100 * hechos / total) : 0;
        $("ci-avance").hidden = !d.filas.length;
        $("ci-avance").innerHTML = "<span><b>" + completas + " de " + d.filas.length + "</b> empresa" + (d.filas.length === 1 ? "" : "s") + " con el cierre completo</span>" +
            '<span class="ci-barra"><i style="width:' + pct + '%"></i></span><small>' + pct + " % de los pasos</small>";
        $("ci-leyenda").hidden = !d.filas.length;
        // «Solo los míos»: solo tiene sentido con equipo
        $("ci-mios-caja").hidden = !d.equipo;
        E.tabla.ponerDatos(lista);
        E.tabla.filtrar("mio", d.equipo && $("ci-mios").checked ? "Sí" : null);
    }

    async function cargar() {
        if (E.tabla) E.tabla.cargando("Revisando el cierre de tus empresas…");
        else $("ci-tabla").innerHTML = '<div class="ui-vacio"><span>Revisando el cierre de tus empresas…</span></div>';
        try { E.datos = await api("/api/cierre" + (E.periodo ? "?periodo=" + encodeURIComponent(E.periodo) : "")); }
        catch (e) {
            if (E.tabla) E.tabla.error(e.message, cargar);
            else $("ci-tabla").innerHTML = '<div class="ui-vacio"><b>No se pudo cargar</b><span>' + esc(e.message) + '</span><button type="button" class="ui-btn ui-btn--secundario" id="ci-reintentar">Reintentar</button></div>';
            var b = $("ci-reintentar"); if (b) b.addEventListener("click", cargar);
            return;
        }
        pintar();
    }

    $("ci-meses").addEventListener("click", function (e) {
        var b = e.target.closest("[data-periodo]"); if (!b || b.getAttribute("aria-pressed") === "true") return;
        E.periodo = b.dataset.periodo;
        try { history.replaceState(null, "", location.pathname + "?periodo=" + E.periodo); } catch (x) { /* nada */ }
        cargar();
    });
    function recordarMios(si) { try { localStorage.setItem("fc-cierre-mios", si ? "1" : ""); } catch (x) { /* nada */ } }
    $("ci-mios").addEventListener("change", function () {
        recordarMios(this.checked);
        if (E.tabla) E.tabla.filtrar("mio", this.checked ? "Sí" : null);
    });
    try { $("ci-mios").checked = localStorage.getItem("fc-cierre-mios") === "1"; } catch (x) { /* nada */ }

    $("ci-tabla").addEventListener("click", function (e) {
        var a = e.target.closest("[data-ir]"); if (!a) return;
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
        e.preventDefault(); e.stopPropagation();
        irCon(a.dataset.ir, a.getAttribute("href"));
    }, true);
    $("ci-tabla").addEventListener("change", async function (e) {
        var s = e.target.closest("[data-responsable]"); if (!s) return;
        var f = E.datos.filas.find(function (x) { return x.rfc === s.dataset.responsable; }), antes = f.responsable || "";
        s.disabled = true;
        try {
            var r = await api("/api/cierre/responsable", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rfc: f.rfc, correo: s.value }) });
            f.responsable = r.responsable;
            Fiscontable.toast(r.responsable ? "Responsable: " + nombreDe(r.responsable) : "Quedó sin responsable");
        } catch (er) { f.responsable = antes || null; Fiscontable.toast(er.message); }
        E.tabla.ponerDatos(filas());
        E.tabla.filtrar("mio", $("ci-mios").checked ? "Sí" : null);
    });
    $("ci-tabla").addEventListener("click", function (e) { if (e.target.closest("[data-responsable]")) e.stopPropagation(); }, true);

    async function arrancar() {
        if (!(await Fiscontable.exigirModulo())) return;
        cargar();
    }
    arrancar();
})();
