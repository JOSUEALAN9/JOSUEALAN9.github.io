/*
 * inicio.js — Inicio como tablero (M-01).
 *
 *  · Mis empresas: una fila por empresa con lo que hay que atender (opinión 32-D, constancia, buzón, cancelaciones
 *    por responder, listas del SAT, XML del mes). Favoritas arriba; clic en la fila = trabajar con esa empresa.
 *  · Empresa activa: ingresos y gastos del mes y del año (de sus XML), IVA estimado, opinión, constancia, próximos
 *    vencimientos y sus últimos avisos.
 *  · e.firma y sellos (23-nov-2026): su tarjeta en las dos vistas, con el enlace al módulo Vencimientos.
 * Los accesos a los módulos están en la barra lateral y en Ctrl+K.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var E = { vista: null, datos: null, filtro: null, tabla: null, empresa: null };
    var dinero = function (v) { return "$" + Number(v || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var fecha = function (iso) { return iso ? new Date(String(iso).length <= 10 ? iso + "T12:00:00" : iso + (String(iso).length <= 19 ? "Z" : "")).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : ""; };

    async function api(ruta) {
        var r = await fetch(API + ruta, { credentials: "include" });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function guardarVista(v) { try { localStorage.setItem("fc-inicio-vista", v); } catch (e) { /* nada */ } }
    function vistaGuardada() { try { return localStorage.getItem("fc-inicio-vista"); } catch (e) { return null; } }

    /* ---------------------------------------------------------------- semáforo */
    function sello(tono, texto) { return '<span class="tb-sello tb-sello--' + tono + '">' + esc(texto) + "</span>"; }
    // Opinión y constancia cuentan solo si son del mes en curso (calendario): una de octubre ya no dice cómo está en noviembre.
    // 24-nov-2026 (auditoría madrugada-5): la revisión semanal del sentido también cuenta. Si es más nueva que el PDF guardado,
    // el servidor manda la de la revisión (fuente «revision», con revisada_en): el sello, el color y la fecha son los suyos.
    function tonoOpinion(r) {
        return r === "Positiva" || r === "Inscrito sin obligaciones" ? "ok" : r === "Consultada" || /suspensi/i.test(r) ? "aviso" : "error";
    }
    function deRevision(o) { return !!(o && o.fuente === "revision" && o.revisada_en); }
    function sinPdfDelMes(o) { return o.pdf_del_mes === false && o.del_mes !== false; }
    function notaRevision(o) { return "revisada el " + fecha(o.revisada_en) + (sinPdfDelMes(o) ? " · sin PDF del mes" : ""); }
    // En la celda, corto («revisada el 24 nov»); el resto va al pasar el cursor
    function notaRevisionCorta(o) { return "revisada el " + fecha(o.revisada_en).replace(/ \d{4}$/, ""); }
    function celdaOpinion(o) {
        if (!o) return sello("nada", "Sin consultar");
        var r = o.resultado || "Consultada", rev = deRevision(o);
        if (o.del_mes === false) return sello(/Negativa|No inscrito/.test(r) ? "error" : "aviso", "Falta la de " + o.mes_actual) +
            ' <small class="xml-tenue">la de ' + esc(o.mes) + ": " + esc(r.toLowerCase()) + (rev ? " (revisada)" : "") + "</small>";
        var titulo = (o.motivos || []).length ? "Por qué: " + o.motivos.join(" · ") : "";
        if (rev) titulo = "Revisión semanal en el SAT del " + fecha(o.revisada_en) + ": " + r.toLowerCase() + "." +
            (o.pdf && o.pdf.resultado && o.pdf.resultado !== r ? " El PDF guardado del " + fecha(o.pdf.fecha) + " dice " + o.pdf.resultado.toLowerCase() +
                ": pide una nueva antes de mandarla." : "") +
            (sinPdfDelMes(o) ? " Aún no está el PDF del mes (llega en lo programado o pídelo en Opinión 32-D)." : "");
        return '<span' + (titulo ? ' title="' + esc(titulo) + '"' : "") + ">" + sello(tonoOpinion(r), r) +
            ' <small class="xml-tenue">' + esc(rev ? notaRevisionCorta(o) : (o.motivos || []).length ? o.motivos[0].split(":")[0].slice(0, 60) + "…" : fecha(o.fecha)) + "</small></span>";
    }
    function textoOpinion(o) {
        if (!o) return "Sin consultar";
        var r = o.resultado || "Consultada";
        if (o.del_mes === false) return "Falta la del mes (" + o.mes + ": " + r.toLowerCase() + ")";
        return deRevision(o) ? r + " (" + notaRevision(o) + ")" : r;
    }
    function celdaConstancia(c) {
        if (!c) return sello("nada", "Sin constancia");
        return c.del_mes ? sello("ok", "Del mes") + ' <small class="xml-tenue">' + esc(fecha(c.fecha)) + "</small>"
            : sello("aviso", "Falta la de " + c.mes_actual) + ' <small class="xml-tenue">la última es de ' + esc(c.mes) + "</small>";
    }
    function opinionVieja(f) { return f.opinion && f.opinion.del_mes === false; }
    function opinionMala(f) { return !!(f.opinion && /Negativa|No inscrito/.test(f.opinion.resultado || "")); }
    function importantes(f) { return (f.buzon && f.buzon.importantes) || 0; }
    function comunicados(f) { return (f.buzon && f.buzon.comunicados) || 0; }
    function listasOtras(f) { return Math.max((f.listas || 0) - (f.listas_urgentes || 0), 0); }
    // 25-nov-2026 (el dueño, paquete avi): «Atender» = algo en «Requiere atención» de la campana (las mismas reglas del servidor,
    // core/avisos_reglas.py: f.atender). Una opinión que ya era negativa, un 69-B presunto o los comunicados del Buzón ya no son
    // «Atender»: la opinión y el presunto quedan en «Revisar»; los comunicados, en gris.
    function estadoFila(f) {
        if ((f.atender || []).length) return "Atender";
        if (opinionMala(f) || !f.opinion || opinionVieja(f) || !f.constancia || !f.constancia.del_mes || !f.efirma || listasOtras(f)) return "Revisar";
        return "Al día";
    }

    /* Qué hay que atender en cada empresa, del más grave al más leve (rojo = atender, ámbar = revisar, gris = comunicados) */
    function motivos(f) {
        var m = (f.atender || []).map(function (x) { return ["error", x.chip || x.titulo, x.grupo]; });
        if (opinionMala(f) && !(f.atender || []).some(function (x) { return x.grupo === "cumplimiento" && /Opini/.test(x.chip || ""); }))
            m.push(["aviso", "Opinión " + f.opinion.resultado.toLowerCase() + (deRevision(f.opinion) ? " (revisada el " + fecha(f.opinion.revisada_en) + ")" : ""), "cumplimiento"]);
        if (listasOtras(f)) m.push(["aviso", listasOtras(f) + " en 69-B presunto u otras listas", "cfdi"]);
        if (!f.opinion) m.push(["aviso", "Sin opinión", "cumplimiento"]);
        else if (opinionVieja(f)) m.push(["aviso", "Falta la opinión de " + f.opinion.mes_actual, "cumplimiento"]);
        if (!f.constancia) m.push(["aviso", "Sin constancia", "cumplimiento"]);
        else if (!f.constancia.del_mes) m.push(["aviso", "Falta la constancia de " + f.constancia.mes_actual, "cumplimiento"]);
        if (!f.efirma) m.push(["aviso", "Falta e.firma", "cumplimiento"]);
        if (comunicados(f)) m.push(["gris", comunicados(f) + " comunicado" + (comunicados(f) === 1 ? "" : "s") + " sin leer", "buzon"]);
        return m;
    }

    var CATALOGO = [
        { clave: "empresa", etiqueta: "Empresa", tipo: "texto" },
        { clave: "estado", etiqueta: "Estado", tipo: "texto" },
        { clave: "atender", etiqueta: "Qué atender", tipo: "texto" },
        { clave: "opinion_txt", etiqueta: "Opinión 32-D", tipo: "texto" },
        { clave: "constancia_txt", etiqueta: "Constancia", tipo: "texto" },
        { clave: "cierre_txt", etiqueta: "Cierre del mes", tipo: "texto" },
        { clave: "buzon_nuevos", etiqueta: "Buzón por atender", tipo: "numero" },
        { clave: "cancelaciones", etiqueta: "Cancelaciones por responder", tipo: "numero" },
        { clave: "listas", etiqueta: "En listas del SAT", tipo: "numero" },
        { clave: "xml_mes", etiqueta: "XML del mes", tipo: "texto" },
        { clave: "emitidos_mes", etiqueta: "Emitidos del mes", tipo: "numero" },
        { clave: "recibidos_mes", etiqueta: "Recibidos del mes", tipo: "numero" },
        { clave: "efirma_txt", etiqueta: "e.firma", tipo: "texto" },
        { clave: "rfc", etiqueta: "RFC", tipo: "texto" }
    ];
    // Filtros que se ponen desde los indicadores de arriba (también salen en «Filtros»)
    var FILTROS = [{ clave: "estado", etiqueta: "Estado" }, { clave: "f_opinion", etiqueta: "Opinión" }, { clave: "f_buzon", etiqueta: "Buzón" }, { clave: "f_cancel", etiqueta: "Cancelaciones" },
                   { clave: "f_listas", etiqueta: "Listas del SAT" }, { clave: "f_cierre", etiqueta: "Cierre del mes" }];

    /* Cierre del mes que se declara (el anterior): XML bajados, validados, constancia, opinión y declaración */
    function celdaCierre(c) {
        if (!c) return "";
        var falta = c.pasos.filter(function (p) { return !p.hecho; }).map(function (p) { return p.texto + (p.nota ? " (" + p.nota + ")" : ""); });
        var tono = c.hechos === c.total ? "ok" : c.hechos >= c.total - 2 ? "aviso" : "error";
        return '<span class="tb-cierre-celda" title="' + esc(falta.length ? "Falta: " + falta.join(" · ") : "Todo listo") + '">' +
            '<span class="tb-barrita tb-barrita--' + tono + '"><i style="width:' + Math.round(100 * c.hechos / c.total) + '%"></i></span>' +
            "<b>" + c.hechos + "/" + c.total + "</b></span>";
    }
    function pintarCierre(lista) {
        var caja = $("tb-cierre"); if (!caja) return;
        var con = lista.filter(function (f) { return f._f.cierre; });
        if (!con.length) { caja.hidden = true; return; }
        var c0 = con[0]._f.cierre, completas = con.filter(function (f) { return f._f.cierre.hechos === f._f.cierre.total; }).length;
        var hechos = con.reduce(function (s, f) { return s + f._f.cierre.hechos; }, 0), total = con.reduce(function (s, f) { return s + f._f.cierre.total; }, 0);
        var orden = [], por = {};
        con.forEach(function (f) {
            f._f.cierre.pasos.forEach(function (p) {
                if (!por[p.clave]) { por[p.clave] = { p: p, n: 0, de: 0 }; orden.push(p.clave); }
                por[p.clave].de++; if (p.hecho) por[p.clave].n++;
            });
        });
        var pasos = orden.map(function (k) {
            var x = por[k];
            return '<a class="tb-cierre__paso' + (x.n === x.de ? " tb-cierre__paso--ok" : "") + '" href="' + esc(x.p.pagina) + '"><span>' + esc(x.p.texto) + "</span><b>" + x.n + "/" + x.de + "</b></a>";
        }).join("");
        caja.hidden = false;
        caja.innerHTML = '<button type="button" class="tb-cierre__cabeza" data-filtro="f:f_cierre" title="Ver las empresas a las que les falta algo">' +
            "<span><b>Cierre de " + esc(c0.mes) + "</b> · " + completas + " de " + con.length + " empresa" + (con.length === 1 ? "" : "s") + " completa" + (con.length === 1 ? "" : "s") + "</span>" +
            '<span class="tb-barrita tb-barrita--ancha"><i style="width:' + Math.round(100 * hechos / total) + '%"></i></span><small>' + Math.round(100 * hechos / total) + " %</small></button>" +
            '<div class="tb-cierre__pasos">' + pasos + '<a class="tb-cierre__paso tb-cierre__paso--ver" href="/herramientas/cierre/"><span>Ver avance por cliente</span><b>→</b></a></div>';
    }

    function filas() {
        return E.datos.empresas.map(function (f) {
            var m = motivos(f), em = f.xml_mes.emitido || 0, re = f.xml_mes.recibido || 0;
            return { rfc: f.rfc, empresa: f.alias || f.rfc, favorito: f.favorito, _f: f, _m: m, estado: estadoFila(f),
                     atender: m.map(function (x) { return x[1]; }).join(" · ") || "Nada pendiente",
                     opinion_txt: textoOpinion(f.opinion),
                     constancia_txt: f.constancia ? (f.constancia.del_mes ? "Del mes" : "Falta la del mes (última: " + f.constancia.mes + ")") : "Sin constancia",
                     buzon_nuevos: f.buzon ? importantes(f) : "", cancelaciones: f.cancelaciones || 0,
                     listas: f.listas_urgentes || 0, emitidos_mes: em, recibidos_mes: re, xml_mes: em + " emitidos · " + re + " recibidos",
                     efirma_txt: f.efirma ? "Guardada" : "Falta",
                     f_opinion: !f.opinion || opinionVieja(f) || /Negativa|No inscrito/.test(f.opinion.resultado || "") ? "Negativa o sin consultar" : "",
                     f_buzon: importantes(f) ? "Con algo importante en el Buzón" : "",
                     f_cancel: f.cancelaciones ? "Por responder" : "",
                     f_listas: f.listas_urgentes ? "Con proveedores o clientes en listas" : "",
                     cierre_txt: f.cierre ? f.cierre.hechos + " de " + f.cierre.total : "",
                     f_cierre: f.cierre && f.cierre.hechos < f.cierre.total ? "Le falta algo al cierre" : "" };
        });
    }

    function pintarResumen(lista) {
        var n = function (fn) { return lista.filter(fn).length; };
        var suma = function (fn) { return lista.reduce(function (s, f) { return s + (fn(f) || 0); }, 0); };
        // 25-nov-2026 (el dueño): el Buzón cuenta solo lo que importa (notificaciones, cartas invitación, requerimientos y solicitudes
        // de cancelación); los comunicados normales van aparte, en gris
        var buzonMsj = suma(function (f) { return importantes(f._f); }), cancel = suma(function (f) { return f._f.cancelaciones; });
        var comun = suma(function (f) { return comunicados(f._f); });
        var neg = n(function (f) { return f._f.opinion && /Negativa|No inscrito/.test(f._f.opinion.resultado || ""); }), sinOp = n(function (f) { return !f._f.opinion || opinionVieja(f._f); });
        // [id, título, número, nota, tono]  — id: «e:<estado>» filtra por estado, «f:<clave>» por filtro
        var datos = [
            ["", "Empresas", lista.length, "en tu directorio", ""],
            ["e:Atender", "Por atender", n(function (f) { return f.estado === "Atender"; }), "algo urgente", "error"],
            ["e:Revisar", "Por revisar", n(function (f) { return f.estado === "Revisar"; }), "les falta algo", "aviso"],
            ["e:Al día", "Al día", n(function (f) { return f.estado === "Al día"; }), "sin pendientes", "ok"],
            ["f:f_cancel", "Cancelaciones", cancel, cancel ? "por responder en " + n(function (f) { return f.f_cancel; }) + " empresa(s)" : "nada por responder", cancel ? "error" : ""],
            ["f:f_listas", "En listas del SAT", n(function (f) { return f.f_listas; }), "empresas con proveedores o clientes", n(function (f) { return f.f_listas; }) ? "error" : ""],
            ["f:f_opinion", "Opinión 32-D", neg + sinOp, neg ? neg + " negativa(s) · " + sinOp + " sin revisar este mes" : sinOp + " sin revisar este mes", neg ? "error" : sinOp ? "aviso" : ""],
            ["f:f_buzon", "Buzón por atender", buzonMsj, (buzonMsj ? "en " + n(function (f) { return f.f_buzon; }) + " empresa(s)" : "nada importante") +
                (comun ? " · " + comun + " comunicado" + (comun === 1 ? "" : "s") + " sin leer" : ""), buzonMsj ? "error" : ""]
        ];
        $("tb-resumen").innerHTML = datos.map(function (d) {
            return '<button type="button" class="tb-kpi' + (d[4] ? " tb-kpi--" + d[4] : "") + (!d[2] && d[0] ? " tb-kpi--cero" : "") + ((E.filtro || "") === d[0] ? " tb-kpi--activo" : "") +
                '" data-filtro="' + esc(d[0]) + '"><small>' + esc(d[1]) + "</small><b>" + d[2] + "</b><span>" + esc(d[3]) + "</span></button>";
        }).join("");
    }

    /* ---------------------------------------------------------------- e.firma y sellos (23-nov-2026)
       Su propia tarjeta (los «Próximos vencimientos» son de declaraciones): «e.firma y sellos: 2 vencen en 30 días», los más
       urgentes y «Ver todos» al módulo Vencimientos. Sin el permiso de Clientes o sin empresas, no sale. */
    var VENC = "/herramientas/vencimientos/";
    var TONO_VENC = { vencido: "error", vence_30: "aviso", vence_90: "aviso", vigente: "ok", sin_cargar: "nada" };
    function fechaCorta(iso) { return iso ? String(iso).slice(8, 10) + "/" + String(iso).slice(5, 7) + "/" + String(iso).slice(0, 4) : ""; }
    // 24-nov-2026 (revisión venc1): sin el permiso de Clientes ni se pide (antes: un 403 en la consola y la tarjeta parpadeaba)
    function conVencimientos() { return !Fiscontable.permitido || Fiscontable.permitido({ permiso: "clientes" }); }
    function enDias(x) {        // «hoy», «mañana», «en 5 días» (antes: «en 0 días», «en 1 días»)
        return x.dias === 0 ? "hoy" : x.dias === 1 ? "mañana" : "en " + x.dias + " días";
    }
    function cuandoVence(x) {
        if (x.revocada) return "revocada por el SAT";
        if (x.dias === null || x.dias === undefined) return x.nota || "Sin fecha";
        if (x.dias < 0) return "venció el " + fechaCorta(x.hasta);
        return "vence el " + fechaCorta(x.hasta) + (x.dias === 0 ? " · hoy" : x.dias === 1 ? " · mañana" : x.dias <= 90 ? " · en " + x.dias + " días" : "");
    }
    function pintarEfirmas(pedido) {
        var caja = $("tb-efirmas"); if (!caja) return;
        if (!pedido && !conVencimientos()) { caja.hidden = true; return; }
        (pedido || api("/api/vencimientos/resumen")).then(function (d) {
            if (!d.empresas) { caja.hidden = true; return; }
            var c = d.conteo || {}, n30 = c.vence_30 || 0, nv = c.vencido || 0;
            var partes = [];
            if (n30) partes.push('<a class="tb-efirmas--aviso" href="' + VENC + '?estado=vence_30">' + n30 + " vence" + (n30 === 1 ? "" : "n") + " en 30 días</a>");
            if (nv) partes.push('<a class="tb-efirmas--error" href="' + VENC + '?estado=vencido">' + nv + " vencido" + (nv === 1 ? "" : "s") + "</a>");
            if (!partes.length) partes.push("<span>Nada vence en 30 días" + (d.proximo ? " · la próxima: " + esc(d.proximo.alias) + ", " + esc(fechaCorta(d.proximo.hasta)) : "") + "</span>");
            caja.innerHTML = '<div class="tb-efirmas__titulo"><b>e.firma y sellos:</b>' + partes.join('<span aria-hidden="true">·</span>') + "</div>" +
                (d.urgentes.length ? '<div class="tb-efirmas__pastillas">' + d.urgentes.map(function (x) {
                    return '<a class="tb-efirmas__pastilla tb-efirmas__pastilla--' + esc(x.estado) + '" href="' + VENC + "?q=" + encodeURIComponent(x.rfc) + '" title="' +
                        esc(x.alias + " · " + (x.origen === "efirma" ? "e.firma" : "sello digital") + " · " + cuandoVence(x)) + '"><span>' + esc(x.alias) + "</span>" +
                        esc((x.origen === "efirma" ? "e.firma " : "sello ") + (x.revocada ? "revocada" : x.dias < 0 ? "venció " + fechaCorta(x.hasta).slice(0, 5) : enDias(x))) + "</a>";
                }).join("") + "</div>" : "") +
                '<a class="tb-efirmas__todos" href="' + VENC + '">Ver todos →</a>';
            caja.hidden = false;
        }).catch(function () { caja.hidden = true; });
    }
    function pintarEfirmasEmpresa(rfc) {
        var caja = $("tb-efirmas-emp"); if (!caja) return;
        if (!conVencimientos()) { caja.remove(); return; }
        api("/api/vencimientos/resumen?rfc=" + encodeURIComponent(rfc)).then(function (d) {
            var filas = d.empresa || [];
            if (!filas.length) { caja.remove(); return; }
            filas.sort(function (a, b) { return a.origen === "efirma" ? -1 : b.origen === "efirma" ? 1 : 0; });
            caja.innerHTML = '<div class="tb-efirmas__cabeza"><p class="tb-titulo">e.firma y sellos</p><a href="' + VENC + "?q=" + encodeURIComponent(rfc) + '">Ver →</a></div><div class="tb-lista">' +
                filas.map(function (x) {
                    var t = x.revocada ? "Revocada" : { vencido: "Vencido", vence_30: "Vence pronto", vence_90: "En 90 días", vigente: "Vigente", sin_cargar: "Sin cargar" }[x.estado];
                    return '<a href="' + VENC + "?q=" + encodeURIComponent(rfc) + '"><span>' + esc(x.origen === "efirma" ? "e.firma" : "Sello digital (CSD)") + '</span><span class="tb-der">' +
                        sello(x.revocada ? "error" : TONO_VENC[x.estado], t) + " <small>" + esc(x.dias === null || x.dias === undefined ? (x.nota || "") : cuandoVence(x) + (x.fuente === "factura" && x.nota ? " · " + x.nota.toLowerCase() : "")) + "</small></span></a>";
                }).join("") + "</div>";
        }).catch(function () { caja.remove(); });
    }

    function pintarLado() {
        var v = (E.datos && E.datos.vencimientos) || [];
        $("tb-venc").innerHTML = v.length ? v.map(function (x) {
            return "<div><span>" + esc(x.titulo) + "</span><small>" + esc(fecha(x.fecha)) + (x.dias >= 0 ? " · en " + x.dias + " días" : " · venció") + "</small></div>";
        }).join("") : "<div><span>Nada próximo</span></div>";
        // 25-nov-2026 (paquete avi): lo último de la campana con sus reglas (el integrante no ve lo del equipo ni nadie lo de la VPS)
        api("/api/actividad/campana?modo=todas").then(function (d) {
            var recientes = d.recientes || [];
            $("tb-act").innerHTML = recientes.length ? recientes.map(function (a) {
                var dentro = "<span>" + esc(a.titulo) + "</span><small>" + esc(fecha(a.creada)) + "</small>";
                return a.enlace && a.enlace.charAt(0) === "/" ? '<a href="' + esc(a.enlace) + '">' + dentro + "</a>" : "<div>" + dentro + "</div>";
            }).join("") : "<div><span>Sin actividad reciente</span></div>";
        }).catch(function () { $("tb-act").innerHTML = "<div><span>—</span></div>"; });
    }

    async function cargarDespacho() {
        if (!E.tabla) {
            E.tabla = FCTabla.estandar({
                // De fábrica, solo lo que cabe a 100 % en una laptop; lo demás (XML del mes, e.firma, buzón…) en «Columnas».
                // id nuevo para que nadie se quede con el acomodo anterior de 7 columnas guardado en su navegador.
                contenedor: $("tb-tabla"), id: "tablero_v3", claveFila: "rfc", catalogo: CATALOGO,
                predeterminadas: ["empresa", "estado", "atender", "opinion_txt", "constancia_txt", "cierre_txt"],
                anchoClave: { empresa: 250, estado: 92, atender: 290, opinion_txt: 200, constancia_txt: 125, cierre_txt: 110, xml_mes: 170, efirma_txt: 90 },
                buscar: { texto: "Buscar empresa o RFC…", campos: ["empresa", "rfc"] },
                filtros: FILTROS,
                exportar: { nombre: "Tablero_empresas.xlsx", hoja: "Empresas" },
                vacio: { titulo: "Todavía no tienes empresas", texto: "Regístralas en Clientes: su nombre y su e.firma." },
                celda: function (c, r) {
                    var f = r._f;
                    if (c.clave === "empresa") return '<button type="button" class="tb-estrella' + (f.favorito ? " tb-estrella--si" : "") + '" data-estrella="' + esc(f.rfc) + '" aria-label="Favorita" title="Favorita">★</button>' +
                        "<b>" + esc(r.empresa) + '</b> <small class="xml-tenue">' + esc(f.rfc) + "</small>";
                    if (c.clave === "estado") return sello(r.estado === "Al día" ? "ok" : r.estado === "Revisar" ? "aviso" : "error", r.estado);
                    if (c.clave === "atender") {
                        if (!r._m.length) return sello("ok", "Nada pendiente");
                        var vis = r._m.slice(0, 2);
                        // 25-nov-2026 (el dueño): cada chip abre los avisos de la empresa en SU lugar, la ficha de la empresa
                        // (Clientes › la empresa › Avisos); no hay otra lista ni otra ventana con lo mismo
                        return '<span class="tb-motivos" title="' + esc(r.atender) + '">' + vis.map(function (x) {
                            return '<button type="button" class="tb-motivo tb-motivo--' + x[0] + '" data-avisos="' + esc(f.rfc) + '">' + esc(x[1]) + "</button>";
                        }).join("") + (r._m.length > 2 ? '<button type="button" class="tb-motivo tb-motivo--mas" data-avisos="' + esc(f.rfc) + '">+' + (r._m.length - 2) + "</button>" : "") + "</span>";
                    }
                    if (c.clave === "opinion_txt") return celdaOpinion(f.opinion);
                    if (c.clave === "constancia_txt") return celdaConstancia(f.constancia);
                    if (c.clave === "cierre_txt") return celdaCierre(f.cierre);
                    if (c.clave === "xml_mes") return (r.emitidos_mes + r.recibidos_mes) ? esc(r.emitidos_mes) + ' <small class="xml-tenue">emitidos</small> · ' + esc(r.recibidos_mes) + ' <small class="xml-tenue">recibidos</small>' : '<span class="xml-tenue">—</span>';
                    if (c.clave === "buzon_nuevos") return f.buzon ? (importantes(f) ? sello("error", importantes(f) + " por atender") : sello("nada", "—")) +
                        (comunicados(f) ? ' <small class="xml-tenue">' + comunicados(f) + " comunicado" + (comunicados(f) === 1 ? "" : "s") + "</small>" : "") : "";
                    if (c.clave === "cancelaciones") return f.cancelaciones ? sello("error", f.cancelaciones + " por responder") : "";
                    if (c.clave === "listas") return f.listas_urgentes ? sello("error", f.listas_urgentes + " en listas") : (f.listas ? sello("aviso", f.listas + " presunto u otras") : "");
                    if (c.clave === "efirma_txt") return f.efirma ? sello("ok", "Guardada") : sello("aviso", "Falta");
                    return null;
                },
                // 25-nov-2026 (el dueño): picar la empresa te cambia a ella, como siempre; sus avisos se abren con los chips de
                // «Qué atender»
                alClic: function (r) { trabajarCon(r.rfc); }
            });
            $("tb-tabla").addEventListener("click", function (e) {
                var b = e.target.closest("[data-estrella]");
                if (b) { e.stopPropagation(); marcarFavorita(b.dataset.estrella); return; }
                var chip = e.target.closest("[data-avisos]");
                if (chip) {
                    e.stopPropagation(); e.preventDefault();
                    verAvisos(chip.dataset.avisos);
                }
            }, true);
        }
        E.tabla.cargando("Revisando tus empresas…");
        // La tarjeta de e.firma y sellos se pide a la vez que el tablero: se pinta junto con él (sin empujar nada después)
        var pedidoVenc = conVencimientos() ? api("/api/vencimientos/resumen") : null;
        if (pedidoVenc) pedidoVenc.catch(function () { /* la tarjeta no sale */ });
        try { E.datos = await api("/api/tablero"); }
        catch (e) { E.tabla.error(e.message, cargarDespacho); return; }
        pintarDespacho();
        pintarLado();
        pintarEfirmas(pedidoVenc);
    }
    function pintarDespacho() {
        var lista = filas();
        pintarResumen(lista);
        pintarCierre(lista);
        E.tabla.ponerDatos(lista);
        // El indicador elegido: «e:…» filtra por estado, «f:…» por uno de los filtros
        var VALOR = { f_opinion: "Negativa o sin consultar", f_buzon: "Con mensajes sin leer", f_cancel: "Por responder", f_listas: "Con proveedores o clientes en listas", f_cierre: "Le falta algo al cierre" };
        var fil = E.filtro || "";
        FILTROS.forEach(function (x) { E.tabla.filtrar(x.clave, null); });
        if (fil.indexOf("f:") === 0) E.tabla.filtrar(fil.slice(2), VALOR[fil.slice(2)]);
        else if (fil.indexOf("e:") === 0) E.tabla.filtrar("estado", fil.slice(2));
    }
    async function marcarFavorita(rfc) {
        var f = E.datos.empresas.find(function (x) { return x.rfc === rfc; }); if (!f) return;
        try {
            var r = await fetch(API + "/api/clientes/" + encodeURIComponent(rfc) + "/favorito", { method: "PUT", credentials: "include",
                headers: { "Content-Type": "application/json" }, body: JSON.stringify({ favorito: !f.favorito }) });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            f.favorito = !f.favorito;
            E.datos.empresas.sort(function (a, b) { return (b.favorito - a.favorito) || (a.alias || a.rfc).localeCompare(b.alias || b.rfc); });
            pintarDespacho();
            window.dispatchEvent(new CustomEvent("fiscontable:favoritos"));
        } catch (e) { Fiscontable.toast(e.message); }
    }
    // Los avisos de una empresa viven en un solo lugar: su ficha, pestaña «Avisos»
    function verAvisos(rfc) { location.href = "/clientes/?editar=" + encodeURIComponent(rfc) + "&ficha=avisos"; }
    async function trabajarCon(rfc) {
        try { await Fiscontable.elegirEmpresa(rfc); } catch (e) { Fiscontable.toast(e.message); return; }
        verVista("empresa");
    }

    /* ---------------------------------------------------------------- vista de la empresa activa */
    async function cargarEmpresa() {
        var caja = $("tb-empresa");
        var empresa = await Fiscontable.empresaActiva();
        E.empresa = empresa;
        if (!empresa) {
            caja.innerHTML = '<div class="ui-vacio">' + Fiscontable.icono("edificio") + "<b>Elige una empresa</b><span>Arriba, en el selector de empresa, o haz clic en una fila de «Mis empresas».</span></div>";
            return;
        }
        caja.innerHTML = '<div class="tb-rejilla">' + '<div class="tb-cifra"><span class="ui-skel" style="width:60%"></span><span class="ui-skel" style="width:80%;height:22px"></span></div>'.repeat(4) + "</div>";
        var periodo = await Fiscontable.periodoActivo();
        var d;
        try { d = await api("/api/tablero/empresa?rfc=" + encodeURIComponent(empresa.rfc) + (periodo ? "&periodo=" + periodo : "")); }
        catch (e) { caja.innerHTML = '<div class="ui-falla">' + Fiscontable.icono("alerta") + "<b>No se pudo cargar</b><span>" + esc(e.message) + "</span></div>"; return; }
        var mes = d.mes_nombre.charAt(0).toUpperCase() + d.mes_nombre.slice(1);
        var cifra = function (titulo, valor, nota) { return '<div class="tb-cifra"><small>' + esc(titulo) + "</small><b>" + esc(valor) + "</b><span>" + esc(nota || "") + "</span></div>"; };
        var iva = d.iva_estimado;
        var op = d.opinion, co = d.constancia;
        caja.innerHTML =
            '<div class="tb-rejilla">' +
                cifra("Ingresos de " + d.mes_nombre, dinero(d.mes.ingresos), d.mes.n_emitidos + " facturas emitidas · sin IVA") +
                cifra("Gastos de " + d.mes_nombre, dinero(d.mes.gastos), d.mes.n_recibidos + " facturas recibidas · sin IVA") +
                cifra("IVA estimado de " + d.mes_nombre, (iva < 0 ? "-" : "") + dinero(Math.abs(iva)), iva >= 0 ? "a cargo (cobrado menos pagado en facturas)" : "a favor (cobrado menos pagado en facturas)") +
                cifra("En " + d.periodo.slice(0, 4), dinero(d.anio.ingresos), "ingresos · gastos " + dinero(d.anio.gastos)) +
            "</div>" +
            '<div class="tb-columnas">' +
                '<div class="ui-tarjeta"><p class="tb-titulo">Cumplimiento</p><div class="tb-lista">' +
                    '<a href="/herramientas/opinion/"><span>Opinión 32-D</span><span class="tb-der">' + celdaOpinion(op) + "</span></a>" +
                    '<a href="/herramientas/constancias/"><span>Constancia</span><span class="tb-der">' + celdaConstancia(co) + "</span></a>" +
                    '<a href="/herramientas/iva/"><span>Papel de trabajo de IVA de ' + esc(d.mes_nombre) + "</span><small>Abrir →</small></a>" +
                "</div></div>" +
                (d.cierre ? '<div class="ui-tarjeta"><p class="tb-titulo">Cierre de ' + esc(d.cierre.mes) + " " + celdaCierre(d.cierre) + '</p><div class="tb-lista">' +
                    d.cierre.pasos.map(function (p) {
                        return '<a href="' + esc(p.pagina) + '"><span>' + esc(p.texto) + "</span>" + (p.hecho ? sello("ok", "Listo") : sello("aviso", p.nota || "Falta")) + "</a>";
                    }).join("") + "</div></div>" : "") +
                '<div class="ui-tarjeta" id="tb-efirmas-emp"><p class="tb-titulo">e.firma y sellos</p><span class="ui-skel" style="width:70%"></span></div>' +
                '<div class="ui-tarjeta"><p class="tb-titulo">Próximos vencimientos</p><div class="tb-lista">' +
                    (d.vencimientos.length ? d.vencimientos.map(function (v) {
                        return "<div><span>" + esc(v.titulo) + "</span><small>" + esc(fecha(v.fecha)) + (v.dias >= 0 ? " · en " + v.dias + " días" : " · venció") + "</small></div>";
                    }).join("") : "<div><span>Nada próximo</span></div>") +
                '</div><p class="xml-tenue" style="font-size:12px;margin:8px 0 0">Fechas generales; revisa las de tu régimen.</p></div>' +
                // 25-nov-2026 (el dueño): aquí ya no se repite la lista de avisos de la empresa; viven en su ficha
                '<div class="ui-tarjeta"><p class="tb-titulo">Avisos</p><div class="tb-lista">' +
                    '<a href="/clientes/?editar=' + encodeURIComponent(empresa.rfc) + '&ficha=avisos"><span>' +
                    (d.avisos.length ? "Ver los avisos de esta empresa" : "Sin avisos de esta empresa") + "</span><small>En su ficha ›</small></a>" +
                "</div></div>" +
            "</div>" +
            '<p class="xml-tenue" style="font-size:12px;margin-top:12px">' + esc(mes) + " según los XML guardados (vigentes y sin validar; notas de crédito restan). Es un estimado: el cálculo fino está en IVA y Conciliación.</p>";
        pintarEfirmasEmpresa(empresa.rfc);
    }

    /* ---------------------------------------------------------------- el primer cuadro
       19-nov-2026 (el dueño: «brinquito» al cargar): el tablero se arma con varias respuestas (pasos, resumen, tabla) y cada
       una empujaba lo de abajo. Mientras llega lo primero queda invisible (main.tb-cargando, ocupa su lugar) y se descubre
       de una vez. Si algo tarda más de 5 s, se descubre igual. */
    var cargando = { pasos: true, vista: true };
    function descubrir(que) {
        if (que) cargando[que] = false;
        if (cargando.pasos || cargando.vista) return;
        var m = document.querySelector("main.tb-cargando"); if (m) m.classList.remove("tb-cargando");
    }
    setTimeout(function () { cargando.pasos = cargando.vista = false; descubrir(); }, 5000);

    /* ---------------------------------------------------------------- vistas */
    function verVista(v) {
        E.vista = v; guardarVista(v);
        document.querySelectorAll("#tb-vista [data-vista]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.vista === v)); });
        $("tb-despacho").hidden = v !== "despacho";
        $("tb-empresa").hidden = v !== "empresa";
        Promise.resolve(v === "despacho" ? cargarDespacho() : cargarEmpresa()).catch(function () { /* cada una enseña su error */ })
            .then(function () { descubrir("vista"); });
    }
    $("tb-vista").addEventListener("click", function (e) { var b = e.target.closest("[data-vista]"); if (b) verVista(b.dataset.vista); });
    ["tb-resumen", "tb-cierre"].forEach(function (id) {
        if ($(id)) $(id).addEventListener("click", function (e) {
            var b = e.target.closest("[data-filtro]"); if (!b) return;
            E.filtro = E.filtro === b.dataset.filtro ? null : (b.dataset.filtro || null); pintarDespacho();
        });
    });

    function recientes() {
        var cat = Fiscontable.catalogo || [];
        var rec = Fiscontable.recientes().slice(0, 6).map(function (c) { return cat.filter(function (m) { return m.clave === c; })[0]; })
            .filter(function (m) { return m && Fiscontable.permitido(m); });
        $("inicio-recientes").hidden = !rec.length;
        $("inicio-recientes-lista").innerHTML = rec.map(function (m) { return '<a href="' + esc(m.url) + '">' + esc(m.nombre) + "</a>"; }).join("");
    }

    /* ---------------------------------------------------------------- «Configura tu cuenta» (sección 8) */
    async function pasosCuenta() {
        var oculto = false; try { oculto = localStorage.getItem("fc-pasos-oculto") === "1"; } catch (e) { /* nada */ }
        if (oculto) return;
        var d; try { d = await api("/api/inicio/pasos"); } catch (e) { return; }
        if (d.hechos >= d.total) return;
        var caja = $("tb-pasos");
        caja.innerHTML = '<div class="tb-pasos__cabeza"><b>Configura tu cuenta</b><span class="xml-tenue">' + d.hechos + " de " + d.total + "</span>" +
            '<span class="tb-pasos__barra"><span style="width:' + Math.round(d.hechos * 100 / d.total) + '%"></span></span>' +
            '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28 tb-pasos__ocultar" id="tb-pasos-ocultar">Ocultar</button></div><ol>' +
            d.pasos.map(function (p) {
                var dentro = "<i>" + (p.hecho ? "✓" : "") + "</i><span>" + esc(p.titulo) + (p.detalle ? " <small>· " + esc(p.detalle) + "</small>" : "") + "</span>";
                var href = p.enlace || (p.accion === "perfil" ? "/configuracion/?seccion=perfil" : "#");
                return '<li class="' + (p.hecho ? "tb-paso--hecho" : "") + '">' + (p.hecho ? "<span>" + dentro + "</span>" : '<a href="' + esc(href) + '">' + dentro + "</a>") + "</li>";
            }).join("") + "</ol>";
        caja.hidden = false;
        $("tb-pasos-ocultar").addEventListener("click", function () { try { localStorage.setItem("fc-pasos-oculto", "1"); } catch (e) { /* nada */ } caja.hidden = true; });
    }

    var arrancado = false;
    document.addEventListener("fc:perfil", function (ev) {
        var p = ev.detail;
        var nombre = p && (p.nombre || (p.correo || "").split("@")[0]);
        $("saludo").textContent = nombre ? "Hola, " + nombre.split(" ")[0] : "Bienvenido";
        if (!p || arrancado) { if (!p) { cargando.pasos = cargando.vista = false; descubrir(); } return; }
        arrancado = true;
        recientes();
        if (/@fiscontable\.invalid$/.test(p.correo || "") || p.viendo_como) descubrir("pasos");
        // Cuenta de revisión (Microsoft Store): en vez de «Configura tu cuenta», un recorrido por la pantalla (una vez)
        var revision = /@fiscontable\.invalid$/.test(p.correo || "");
        if (revision) {
            var visto = false; try { visto = localStorage.getItem("fc-recorrido:revision") === "1"; } catch (e) { /* nada */ }
            if (!visto && Fiscontable.recorrido) setTimeout(function () {
                Fiscontable.recorrido("revision", ["Bienvenido a Fiscontable, el sistema para despachos contables en México. Esta cuenta de revisión " +
                    "tiene empresas de ejemplo: puedes recorrer todo, pero no guardar cambios. Te mostramos las partes principales; " +
                    "después, el botón «?» de cada pantalla explica cómo se usa."]);
            }, 1200);
        } else if (!p.viendo_como) {
            pasosCuenta().catch(function () { /* sin pasos */ }).then(function () { descubrir("pasos"); });
            // Cuentas nuevas: un recorrido por la pantalla, una sola vez (después queda en el botón «?» de cada módulo).
            // Espera a que el perfil esté completo para no encimarse con la ventana de bienvenida.
            var yaVio = true; try { yaVio = localStorage.getItem("fc-recorrido:bienvenida") === "1"; } catch (e) { /* nada */ }
            // Con una invitación pendiente a un despacho, primero la invitación: el recorrido sale ya dentro del despacho
            var invitado = !!(Fiscontable.invitacionPendiente && Fiscontable.invitacionPendiente());
            if (!yaVio && !invitado && p.rol !== "admin" && p.perfil_completo && Fiscontable.recorrido) setTimeout(function () {
                if (document.querySelector("dialog[open], .fc-tour, #fc-bloqueo-pantalla:not([hidden])")) return;
                Fiscontable.recorrido("bienvenida", ["Te damos la bienvenida a Fiscontable. Este recorrido muestra las partes principales de la pantalla; " +
                    "después, el botón «?» de cada módulo explica cómo se utiliza."]);
            }, 1500);
        }
        var e = p.empresa_activa;
        $("tb-vista-empresa").textContent = e ? (e.alias || e.rfc) : "Empresa activa";
        verVista(vistaGuardada() || (e ? "empresa" : "despacho"));
    });
    window.addEventListener("fiscontable:empresa", function (ev) {
        var e = ev.detail;
        $("tb-vista-empresa").textContent = e ? (e.alias || e.rfc) : "Empresa activa";
        if (E.vista === "empresa") cargarEmpresa();
    });
    window.addEventListener("fiscontable:periodo", function () { if (E.vista === "empresa") cargarEmpresa(); });
})();
