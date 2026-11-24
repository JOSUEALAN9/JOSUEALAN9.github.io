/*
 * vencimientos.js — Vencimientos de e.firma y sellos digitales (CSD) de todas tus empresas (23-nov-2026).
 *
 * El dueño: «un módulo donde vea empresa, tipo e.firma, sellos CSD, fecha de expiración, algo bonito para recordatorio».
 *  · Arriba, cinco indicadores (vencidos, en 30 días, en 90 días, vigentes, sin cargar): cada uno filtra la tabla.
 *  · La línea de tiempo: los vencidos a la izquierda y los próximos 12 meses; cada marca es una e.firma (círculo) o un
 *    sello (rombo) con el color de su estado; al pasar el cursor o al tocarla dice de quién es. Picar un mes filtra la tabla.
 *  · La tabla (en el celular, tarjetas): ordenable, con buscador, filtro por tipo y el botón para renovar o subir.
 *  · «Descargar Excel» baja lo que se ve (filtros, búsqueda y orden): regla del Excel único (23-nov-2026).
 * ?q=RFC abre buscando esa empresa; ?estado=vence_30 abre con ese indicador puesto (los enlaces de Inicio).
 * Los datos salen de GET /api/vencimientos (modulos/vencimientos/router.py).
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var E = { datos: null, estado: null, tipo: "", mes: null, q: "", orden: { clave: "", dir: 1 }, mas: 8, globoFijo: false };
    var POR_PAGINA = 8;                   // tarjetas del celular que se ven de una vez («Ver más»)
    var MARCAS_POR_MES = 10;              // marcas que caben en la columna de un mes; lo demás, «+N»
    var INDICADORES = [
        ["vencido", "Vencidos", "ya no sirven"],
        ["vence_30", "En 30 días", "renuévalos ya"],
        ["vence_90", "En 90 días", "para planear"],
        ["vigente", "Vigentes", "más de 90 días"],
        ["sin_cargar", "Sin cargar", "sin fecha conocida"]
    ];
    var ESTADO_CORTO = { vencido: "Vencido", vence_30: "Vence pronto", vence_90: "Vence en 90 días", vigente: "Vigente", sin_cargar: "Sin cargar" };
    var ORDEN_ESTADO = { vencido: 0, vence_30: 1, vence_90: 2, vigente: 3, sin_cargar: 4 };
    var TIPO_CORTO = { efirma: "e.firma", csd: "Sello CSD" };
    var MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    var MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

    function fecha(iso) { return iso ? String(iso).slice(8, 10) + "/" + String(iso).slice(5, 7) + "/" + String(iso).slice(0, 4) : ""; }
    function plural(n, uno, varios) { return n + " " + (n === 1 ? uno : varios); }
    function cuando(r) {
        var d = r.dias;
        if (r.revocada) return "revocada por el SAT";             // cuenta con los vencidos aunque su fecha diga otra cosa
        if (d === null || d === undefined) return "";
        if (d < 0) return d === -1 ? "venció ayer" : "venció hace " + plural(-d, "día", "días");
        if (d === 0) return "vence hoy";
        if (d === 1) return "vence mañana";
        if (d <= 90) return "en " + d + " días";
        var m = Math.round(d / 30.4);
        return "en " + plural(m, "mes", "meses");
    }
    function sinAcentos(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
    function claveMes(iso) { return String(iso || "").slice(0, 7); }

    async function api(ruta, opciones) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r;
    }

    /* ---------------------------------------------------------------- filtros */
    function pasa(r, excepto) {
        if (E.tipo && excepto !== "tipo" && r.origen !== E.tipo) return false;
        if (E.estado && excepto !== "estado" && r.estado !== E.estado) return false;
        if (E.mes && excepto !== "mes") {
            if (E.mes === "vencidos" ? r.estado !== "vencido" : (r.estado === "vencido" || claveMes(r.hasta) !== E.mes)) return false;
        }
        if (E.q && excepto !== "q") {
            var t = sinAcentos(r.alias + " " + r.rfc);
            if (t.indexOf(E.q) === -1) return false;
        }
        return true;
    }
    function ordenar(lista) {
        var k = E.orden.clave, d = E.orden.dir;
        if (!k) return lista;                                       // el del servidor: lo más urgente primero
        var val = function (r) {
            if (k === "estado") return ORDEN_ESTADO[r.estado] * 100000 + (r.dias === null ? 0 : r.dias);
            if (k === "tipo") return (r.origen === "efirma" ? "0" : "1") + sinAcentos(r.alias);
            if (k === "alias") return sinAcentos(r.alias) + (r.origen === "efirma" ? "0" : "1");
            return r[k] || null;
        };
        return lista.slice().sort(function (a, b) {
            var x = val(a), y = val(b);
            if (x === null && y === null) return 0;
            if (x === null) return 1;                                // sin fecha, siempre al final
            if (y === null) return -1;
            return (x < y ? -1 : x > y ? 1 : 0) * d;
        });
    }
    function visibles() { return ordenar(E.datos.renglones.filter(function (r) { return pasa(r); })); }
    function textoFiltros() {
        var t = [];
        if (E.estado) t.push(INDICADORES.filter(function (x) { return x[0] === E.estado; })[0][1]);
        if (E.mes) t.push(E.mes === "vencidos" ? "Vencidos" : "Vencen en " + MESES_LARGO[+E.mes.slice(5, 7) - 1] + " " + E.mes.slice(0, 4));
        if (E.tipo) t.push(TIPO_CORTO[E.tipo]);
        if (E.q) t.push("«" + $("vc-buscar").value.trim() + "»");
        return t.join(" · ");
    }

    /* ---------------------------------------------------------------- pintar */
    function pintarIndicadores() {
        var base = E.datos.renglones.filter(function (r) { return pasa(r, "estado"); });
        $("vc-kpis").innerHTML = INDICADORES.map(function (x) {
            var n = base.filter(function (r) { return r.estado === x[0]; }).length;
            var activo = E.estado === x[0];
            return '<button type="button" class="vc-kpi vc-kpi--' + x[0] + (n ? "" : " vc-kpi--cero") + '" data-estado="' + x[0] + '" aria-pressed="' + activo + '"' +
                ' title="' + esc(activo ? "Quitar el filtro" : "Ver solo: " + x[1].toLowerCase()) + '"><small>' + esc(x[1]) + "</small><b>" + n + "</b><span>" + esc(x[2]) + "</span></button>";
        }).join("");
    }

    function pintarTiempo() {
        var hoy = E.datos.hoy, y = +hoy.slice(0, 4), m = +hoy.slice(5, 7) - 1;
        var base = E.datos.renglones.filter(function (r) { return r.hasta && pasa(r, "mes") && (!E.estado || r.estado === E.estado); });
        var cols = [{ clave: "vencidos", titulo: "Vencidos", sub: "", items: [] }];
        var meses = {};
        for (var i = 0; i < 12; i++) {
            var mm = (m + i) % 12, yy = y + Math.floor((m + i) / 12);
            var k = yy + "-" + String(mm + 1).padStart(2, "0");
            var col = { clave: k, titulo: MESES[mm], sub: (i === 0 || mm === 0) ? String(yy) : "", items: [] };
            meses[k] = col; cols.push(col);
        }
        var despues = 0;
        base.forEach(function (r) {
            if (r.estado === "vencido") cols[0].items.push(r);
            else if (meses[claveMes(r.hasta)]) meses[claveMes(r.hasta)].items.push(r);
            else despues++;
        });
        $("vc-meses").innerHTML = cols.map(function (c) {
            c.items.sort(function (a, b) { return (a.dias || 0) - (b.dias || 0); });
            var vis = c.items.slice(0, c.clave === "vencidos" ? MARCAS_POR_MES + 4 : MARCAS_POR_MES), resto = c.items.length - vis.length;
            var marcas = vis.map(function (r) {
                return '<button type="button" class="vc-marca vc-marca--' + r.estado + (r.origen === "csd" ? " vc-marca--csd" : "") + '" data-marca="' + esc(r.id) + '"' +
                    ' aria-label="' + esc(r.alias + ", " + r.tipo + ", " + (r.dias < 0 ? "venció el " : "vence el ") + fecha(r.hasta)) + '"></button>';
            }).join("") + (resto > 0 ? '<button type="button" class="vc-mas" data-mas="' + c.clave + '" aria-label="' + plural(resto, "más", "más") + '">+' + resto + "</button>" : "");
            var activo = E.mes === c.clave;
            var n = c.items.length;
            return '<div class="vc-mes' + (c.clave === "vencidos" ? " vc-mes--vencidos" : "") + '">' +
                '<div class="vc-mes__marcas">' + marcas + "</div>" +
                '<button type="button" class="vc-mes__pie" data-mes="' + c.clave + '" aria-pressed="' + activo + '"' + (n ? "" : " disabled") +
                ' title="' + esc(n ? (activo ? "Quitar el filtro" : "Ver solo " + (c.clave === "vencidos" ? "los vencidos" : "lo de " + MESES_LARGO[+c.clave.slice(5, 7) - 1])) : "Nada este mes") + '">' +
                "<b>" + esc(c.titulo) + "</b><small>" + (n ? n + (c.sub ? " · " + c.sub : "") : (c.sub || "—")) + "</small></button></div>";
        }).join("");
        var nota = $("vc-tiempo-nota");
        var sinFecha = E.datos.renglones.filter(function (r) { return !r.hasta && pasa(r, "mes") && (!E.estado || r.estado === E.estado); }).length;
        var partes = [];
        if (despues) partes.push(plural(despues, "vence", "vencen") + " después de 12 meses");
        if (sinFecha) partes.push(plural(sinFecha, "sin fecha conocida (sin cargar)", "sin fecha conocida (sin cargar)"));
        nota.hidden = !partes.length;
        nota.textContent = partes.length ? "Además: " + partes.join(" · ") + "." : "";
        E.columnas = cols;
    }

    function celdaEstado(r) {
        var t = r.revocada ? "Revocada" : ESTADO_CORTO[r.estado];
        return '<span class="vc-estado vc-estado--' + (r.revocada ? "vencido" : r.estado) + '">' + esc(t) + "</span>" +
            (r.nota ? '<span class="vc-nota"' + (r.fuente === "factura" ? ' title="El sello no está en Facturar: es el que trae su última factura emitida en Administración de XML."' : "") + ">" + esc(r.nota) + "</span>" : "");
    }
    function celdaTipo(r) { return '<span class="vc-tipo vc-tipo--' + r.origen + '"><i aria-hidden="true"></i>' + esc(TIPO_CORTO[r.origen]) + "</span>"; }
    function botonAccion(r) {
        if (!r.accion) return '<span class="vc-tenue" title="' + esc(r.origen === "csd" ? "El sello se tramita en CertiSAT; se sube en Facturar si ahí facturas." : "") + '">—</span>';
        var principal = r.accion.texto === "Renovar" || r.accion.texto === "Subir";
        return '<button type="button" class="ui-btn ui-btn--28 ' + (principal ? "ui-btn--secundario" : "ui-btn--terciario") + '" data-accion="' + esc(r.id) + '"' +
            ' title="' + esc(r.origen === "efirma" ? "Abre su ficha en Clientes, en la e.firma" : "Abre Facturar › Sello digital con esta empresa") + '">' + esc(r.accion.texto) + "</button>";
    }

    function pintarTabla() {
        var lista = visibles();
        $("vc-filas").innerHTML = lista.map(function (r) {
            return "<tr>" +
                '<td class="vc-emp"><b title="' + esc(r.alias) + '">' + esc(r.alias) + "</b><small>" + esc(r.rfc) + "</small></td>" +
                "<td>" + celdaTipo(r) + "</td>" +
                '<td><span class="vc-serie">' + (r.serie ? esc(r.serie) : '<span class="vc-tenue">—</span>') + "</span></td>" +
                '<td class="vc-num">' + (r.desde ? esc(fecha(r.desde)) : '<span class="vc-tenue">—</span>') + "</td>" +
                '<td class="vc-num">' + (r.hasta ? esc(fecha(r.hasta)) + '<span class="vc-cuando vc-cuando--' + r.estado + '">' + esc(cuando(r)) + "</span>" : '<span class="vc-tenue">—</span>') + "</td>" +
                "<td>" + celdaEstado(r) + "</td>" +
                '<td class="vc-accion">' + botonAccion(r) + "</td></tr>";
        }).join("");
        $("vc-sin-filas").hidden = !!lista.length;
        var tarjetas = lista.slice(0, E.mas).map(function (r) {
            return '<article class="vc-tarjeta">' +
                '<div class="vc-tarjeta__emp"><b title="' + esc(r.alias) + '">' + esc(r.alias) + "</b><small>" + esc(r.rfc) + "</small></div>" +
                '<div class="vc-accion">' + botonAccion(r) + "</div>" +
                '<div class="vc-tarjeta__linea">' + celdaEstado(r).replace('class="vc-nota"', 'class="vc-nota" hidden') + celdaTipo(r) + "</div>" +
                '<div class="vc-tarjeta__linea">' + (r.hasta ? "<span>Vence <b>" + esc(fecha(r.hasta)) + '</b></span><span class="vc-cuando vc-cuando--' + r.estado + '">' + esc(cuando(r)) + "</span>"
                    : "<span>Sin fecha</span>") + (r.serie ? '<span class="vc-serie">' + esc(r.serie) + "</span>" : "") + "</div>" +
                (r.nota ? '<div class="vc-tarjeta__linea"><span class="vc-nota">' + esc(r.nota) + "</span></div>" : "") +
                "</article>";
        }).join("");
        var resto = lista.length - Math.min(lista.length, E.mas);
        $("vc-tarjetas").innerHTML = (lista.length ? tarjetas : '<p class="vc-vacio-filtros">Nada con estos filtros.</p>') +
            (resto > 0 ? '<button type="button" class="ui-btn ui-btn--secundario vc-vermas" id="vc-vermas">Ver ' + Math.min(resto, POR_PAGINA) + " más (quedan " + resto + ")</button>" : "");
        $("vc-cuenta").textContent = lista.length === E.datos.renglones.length ? plural(lista.length, "renglón", "renglones")
            : lista.length + " de " + E.datos.renglones.length;
        var bx = $("vc-excel");
        bx.disabled = !lista.length;
        bx.title = lista.length ? "Descarga lo que ves en la tabla (" + plural(lista.length, "renglón", "renglones") + ")" : "No hay renglones que descargar";
        document.querySelectorAll(".vc-tabla th[data-orden]").forEach(function (th) {
            var s = E.orden.clave === th.dataset.orden ? (E.orden.dir > 0 ? "ascending" : "descending") : "none";
            th.setAttribute("aria-sort", s);
        });
        $("vc-orden").value = E.orden.clave === "alias" || E.orden.clave === "hasta" || E.orden.clave === "tipo" ? E.orden.clave : "";
    }

    function pintarFiltros() {
        var chips = [];
        if (E.estado) chips.push(["estado", INDICADORES.filter(function (x) { return x[0] === E.estado; })[0][1]]);
        if (E.mes) chips.push(["mes", E.mes === "vencidos" ? "Vencidos" : "Vencen en " + MESES_LARGO[+E.mes.slice(5, 7) - 1]]);
        $("vc-filtros").innerHTML = chips.map(function (c) {
            return '<span class="ui-chip">' + esc(c[1]) + '<button type="button" data-quitar="' + c[0] + '" aria-label="Quitar filtro">×</button></span>';
        }).join("");
        document.querySelectorAll("#vc-tipos [data-tipo]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.tipo === E.tipo)); });
    }

    function pintarAvisos() {
        var a = E.datos.avisos || {}, dias = (a.dias || []).slice();
        var lista = dias.length > 1 ? dias.slice(0, -1).join(", ") + " y " + dias[dias.length - 1] : String(dias[0] || "");
        // 24-nov-2026 (revisión venc1): el correo sale por escalones, igual que la campana (core/boletines.py), no «cada lunes»
        $("vc-avisos").innerHTML = Fiscontable.icono("campana") + "<span>Te avisamos en la campana" + (a.correo ? " y por correo («e.firma y sellos por vencer»)" : "") +
            " cuando falten " + esc(lista) + " días, y una vez al vencer." + (a.correo ? "" : " El correo de «e.firma y sellos por vencer» lo tienes apagado.") +
            " Si el sello no está en Facturar, tomamos el de su última factura emitida (dice «Según su factura del…»). " +
            '<a href="' + esc(a.configurar || "/configuracion/?seccion=avisos") + '">Cambiar en Configuración › Avisos</a></span>';
    }

    function pintar() {
        pintarIndicadores();
        pintarTiempo();
        pintarFiltros();
        pintarTabla();
    }

    function pintarTodo() {
        var d = E.datos;
        $("vc-cuerpo").hidden = true;
        if (!d.renglones.length) {
            $("vc-cuerpo").hidden = false;
            $("vc-cuerpo").innerHTML = '<div class="ui-vacio">' + Fiscontable.icono("calendario") + "<b>Todavía no tienes empresas</b>" +
                "<span>Regístralas en Clientes con su e.firma: aquí verás cuándo vence cada e.firma y cada sello.</span>" +
                '<a class="ui-btn ui-btn--secundario" href="/clientes/">Ir a Clientes</a></div>';
            $("vc-contenido").hidden = true;
            return;
        }
        $("vc-contenido").hidden = false;
        $("vc-sub").innerHTML = "e.firma y sellos digitales de tus <b>" + plural(d.empresas, "empresa", "empresas") + "</b> · al " + esc(fecha(d.hoy));
        pintarAvisos();
        pintar();
    }

    async function cargar() {
        try {
            E.datos = await (await api("/api/vencimientos")).json();
        } catch (e) {
            $("vc-contenido").hidden = true;
            $("vc-cuerpo").hidden = false;
            $("vc-cuerpo").innerHTML = '<div class="ui-falla">' + Fiscontable.icono("alerta") + "<b>No se pudo cargar</b><span>" + esc(e.message) + "</span>" +
                '<button type="button" class="ui-btn ui-btn--secundario" id="vc-reintentar">Reintentar</button></div>';
            $("vc-reintentar").addEventListener("click", cargar);
            return;
        }
        pintarTodo();
    }

    /* ---------------------------------------------------------------- el globo de la línea de tiempo */
    var globo = null;
    function quitarGlobo() { if (globo) { globo.remove(); globo = null; } E.globoFijo = false; }
    function ponerGlobo(junto, html) {
        quitarGlobo();
        globo = document.createElement("div");
        globo.className = "vc-globo"; globo.setAttribute("role", "tooltip");
        globo.innerHTML = html;
        document.body.appendChild(globo);
        var r = junto.getBoundingClientRect(), g = globo.getBoundingClientRect();
        var x = Math.max(12, Math.min(window.innerWidth - g.width - 12, r.left + r.width / 2 - g.width / 2));
        var y = r.top - g.height - 10;
        if (y < 70) y = r.bottom + 10;
        globo.style.left = x + "px"; globo.style.top = y + "px";
    }
    function lineaGlobo(r) {
        return "<li><b>" + esc(r.alias) + "</b><span>" + esc(TIPO_CORTO[r.origen]) + " · " + (r.dias < 0 ? "venció el " : "vence el ") + esc(fecha(r.hasta)) +
            " (" + esc(cuando(r).replace(/^venció /, "")) + ")</span>" + (r.nota ? "<small>" + esc(r.nota) + "</small>" : "") + "</li>";   // «venció el 04/11 (hace 20 días)»
    }
    function globoDe(boton) {
        if (boton.dataset.marca) {
            var r = E.datos.renglones.filter(function (x) { return x.id === boton.dataset.marca; })[0];
            return r ? "<ul>" + lineaGlobo(r) + "</ul>" : "";
        }
        var c = (E.columnas || []).filter(function (x) { return x.clave === boton.dataset.mas; })[0];
        return c ? "<ul>" + c.items.map(lineaGlobo).join("") + "</ul>" : "";
    }

    /* ---------------------------------------------------------------- eventos */
    async function accion(id, boton) {
        var r = E.datos.renglones.filter(function (x) { return x.id === id; })[0];
        if (!r || !r.accion) return;
        if (r.accion.empresa) {                    // Facturar trabaja con la empresa elegida arriba: primero se elige
            boton.disabled = true;
            try { await Fiscontable.elegirEmpresa(r.accion.empresa); }
            catch (e) { boton.disabled = false; Fiscontable.toast(e.message); return; }
        }
        location.href = r.accion.url;
    }

    async function excel() {
        var b = $("vc-excel"), lista = visibles();
        if (!lista.length) return;
        b.disabled = true; b.classList.add("ui-btn--cargando");
        try {
            var r = await api("/api/vencimientos/excel", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: lista.map(function (x) { return x.id; }), filtro: textoFiltros() }) });
            var nombre = ((r.headers.get("content-disposition") || "").match(/filename="?([^";]+)"?/) || [])[1] || "Vencimientos.xlsx";
            Fiscontable.guardarArchivo(await r.blob(), nombre);
        } catch (e) { Fiscontable.toast(e.message); }
        b.classList.remove("ui-btn--cargando"); b.disabled = !visibles().length;
    }

    function enlazar() {
        $("vc-kpis").addEventListener("click", function (e) {
            var b = e.target.closest("[data-estado]"); if (!b) return;
            E.estado = E.estado === b.dataset.estado ? null : b.dataset.estado; E.mas = POR_PAGINA;
            pintar();
        });
        $("vc-meses").addEventListener("click", function (e) {
            var m = e.target.closest("[data-mes]");
            if (m) { E.mes = E.mes === m.dataset.mes ? null : m.dataset.mes; E.mas = POR_PAGINA; quitarGlobo(); pintar(); return; }
            var b = e.target.closest("[data-marca],[data-mas]");
            if (!b) return;
            e.stopPropagation();
            if (E.globoFijo && globo && globo.dataset.de === (b.dataset.marca || b.dataset.mas)) { quitarGlobo(); return; }
            ponerGlobo(b, globoDe(b)); E.globoFijo = true; globo.dataset.de = b.dataset.marca || b.dataset.mas;
        });
        $("vc-meses").addEventListener("mouseover", function (e) {
            var b = e.target.closest("[data-marca],[data-mas]");
            if (!b || E.globoFijo) return;
            ponerGlobo(b, globoDe(b));
        });
        $("vc-meses").addEventListener("mouseout", function (e) {
            var b = e.target.closest("[data-marca],[data-mas]");
            if (b && !E.globoFijo && !(e.relatedTarget && b.contains(e.relatedTarget))) quitarGlobo();
        });
        $("vc-meses").addEventListener("focusin", function (e) {
            var b = e.target.closest("[data-marca],[data-mas]"); if (b && !E.globoFijo) ponerGlobo(b, globoDe(b));
        });
        $("vc-meses").addEventListener("focusout", function () { if (!E.globoFijo) quitarGlobo(); });
        document.addEventListener("click", function (e) { if (globo && !globo.contains(e.target)) quitarGlobo(); });
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") quitarGlobo(); });
        window.addEventListener("scroll", function () { if (globo) quitarGlobo(); }, true);

        $("vc-tipos").addEventListener("click", function (e) {
            var b = e.target.closest("[data-tipo]"); if (!b) return;
            E.tipo = b.dataset.tipo; E.mas = POR_PAGINA; pintar();
        });
        $("vc-filtros").addEventListener("click", function (e) {
            var b = e.target.closest("[data-quitar]"); if (!b) return;
            E[b.dataset.quitar] = null; E.mas = POR_PAGINA; pintar();
        });
        var t = null;
        $("vc-buscar").addEventListener("input", function () {
            clearTimeout(t);
            t = setTimeout(function () { E.q = sinAcentos($("vc-buscar").value.trim()); E.mas = POR_PAGINA; pintar(); }, 120);
        });
        document.querySelector(".vc-tabla thead").addEventListener("click", function (e) {
            var th = e.target.closest("th[data-orden]"); if (!th) return;
            var k = th.dataset.orden;
            if (E.orden.clave === k) { if (E.orden.dir > 0) E.orden.dir = -1; else E.orden = { clave: "", dir: 1 }; }
            else E.orden = { clave: k, dir: 1 };
            pintarTabla();
        });
        $("vc-orden").addEventListener("change", function () { E.orden = { clave: $("vc-orden").value, dir: 1 }; pintarTabla(); });
        ["vc-filas", "vc-tarjetas"].forEach(function (id) {
            $(id).addEventListener("click", function (e) {
                var b = e.target.closest("[data-accion]");
                if (b) { accion(b.dataset.accion, b); return; }
                if (e.target.closest("#vc-vermas")) { E.mas += POR_PAGINA; pintarTabla(); }
            });
        });
        $("vc-excel").addEventListener("click", excel);
    }

    async function arrancar() {
        if (!(await Fiscontable.exigirModulo("clientes"))) { $("vc-cuerpo").hidden = true; return; }
        var q = Fiscontable.url("q"), estado = Fiscontable.url("estado");
        if (q) { $("vc-buscar").value = q; E.q = sinAcentos(q.trim()); }
        if (estado && ORDEN_ESTADO[estado] !== undefined) E.estado = estado;
        enlazar();
        cargar();
    }
    arrancar();
})();
