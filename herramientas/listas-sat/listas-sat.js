/*
 * herramientas/listas-sat/listas-sat.js — Listas del SAT (como Mi Admin).
 *
 * De la empresa activa: sus CFDI cuyo proveedor o cliente aparece en alguna
 * lista del SAT. Pestaña "General" (con la columna "Encontrado en") y una
 * pestaña por lista, que solo aparece si tiene algo en el periodo. El
 * periodo funciona igual que en Administración de XML.
 *
 * Son pocos CFDI: se piden todos una vez y el periodo, las pestañas y la
 * búsqueda se aplican aquí.
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var GRAVEDAD = { grave: "Grave", alerta: "Revisar", informativo: "Informativo" };
    var TIPO = { I: "Ingreso", E: "Egreso", P: "Pago", T: "Traslado", N: "Nómina" };
    var MAX_ACUSES = 300;

    var E = {
        empresa: null, periodoGeneral: null, contribuyentes: [], rfc: null, datos: null,
        P: null, porDia: {}, cargado: null,
        pestana: "", rol: "", informativos: false, busqueda: "", orden: { clave: "fecha", dir: -1 },
        filas: [], seleccion: new Set()
    };

    async function api(ruta, opciones) {
        var resp = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!resp.ok) throw new Error(await Fiscontable.leerError(resp));
        return resp;
    }
    async function apiJSON(ruta, opciones) { return (await api(ruta, opciones)).json(); }
    function postJSON(ruta, cuerpo) {
        return api(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    }

    function aviso(texto, error) {
        var a = $("aviso");
        a.textContent = texto || "";
        a.className = "ls-aviso" + (error ? " ls-aviso--error" : "");
        a.hidden = !texto;
    }

    function descargar(resp, porDefecto) {
        return resp.blob().then(function (blob) {
            var m = /filename="?([^";]+)"?/i.exec(resp.headers.get("Content-Disposition") || "");
            var url = URL.createObjectURL(blob), a = document.createElement("a");
            a.href = url; a.download = m ? m[1] : porDefecto;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        });
    }

    function dmy(iso) { return iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : ""; }
    function dinero(v) { return Number(v || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function hace(iso) {
        if (!iso) return "";
        var t = new Date(/([zZ]|[+-]\d\d:\d\d)$/.test(iso) ? iso : iso + "Z");
        var min = Math.round((Date.now() - t) / 60000);
        if (min < 60) return "hace " + Math.max(min, 1) + " min";
        var h = Math.round(min / 60);
        return h < 48 ? "hace " + h + " h" : "hace " + Math.round(h / 24) + " días";
    }

    function sello(h, corto) {
        var fecha = h.fecha ? " · " + (h.fecha_tipo || "") + " " + dmy(h.fecha) : "";
        return '<span class="ls-sello ls-sello--' + h.gravedad + '" title="' + esc(h.descripcion + ": " + h.situacion + fecha + " · " + GRAVEDAD[h.gravedad]) + '">' +
            esc(h.nombre_lista) + (corto ? "" : ": " + esc(h.situacion)) + "</span>";
    }

    // ------------------------------------------------------------ empresa
    async function iniciar() {
        if (!(await Fiscontable.exigirModulo("validador"))) return;
        E.P = FCPeriodoMeses.crear({ contenedor: $("periodo-ls"), alCambiar: function () { alCambiarPeriodo(); } });
        prepararEventos();
        cargarEstado();
        E.empresa = await Fiscontable.empresaActiva();
        E.periodoGeneral = await Fiscontable.periodoActivo();
        try { E.contribuyentes = await apiJSON("/api/xml/contribuyentes"); } catch (e) { aviso(e.message, true); }
        var q = new URLSearchParams(location.search);
        if (q.get("empresa")) {
            E.pedido = { anio: q.get("anio") || "", meses: (q.get("meses") || "").split(",").filter(function (m) { return /^\d\d$/.test(m); }),
                         desde: q.get("desde") || "", hasta: q.get("hasta") || "" };
        }
        await abrirEmpresa(q.get("empresa") || (E.empresa && E.empresa.rfc));
        window.addEventListener("fiscontable:empresa", function (e) { E.empresa = e.detail; abrirEmpresa(e.detail && e.detail.rfc); });
        window.addEventListener("fiscontable:periodo", function (e) {
            E.periodoGeneral = e.detail;
            if (!E.rfc || !e.detail) return;
            E.P.poner({ anio: e.detail.slice(0, 4), meses: [e.detail.slice(5, 7)] });
            alCambiarPeriodo();
        });
    }

    function nombreDe(rfc) {
        if (E.empresa && E.empresa.rfc === rfc) return E.empresa.alias || rfc;
        var c = E.contribuyentes.find(function (x) { return x.rfc === rfc; });
        return (c && (c.alias || c.nombre)) || rfc;
    }

    function pintarEncabezado() {
        $("empresa-etiqueta").textContent = E.rfc ? "Empresa · " + E.rfc : "Empresa";
        $("empresa-titulo").textContent = E.rfc ? nombreDe(E.rfc) : "Elegir empresa";
        $("btn-empresa").classList.toggle("ctx-campo--vacio", !E.rfc);
    }

    function pintarMenuEmpresa() {
        var activa = E.empresa ? E.empresa.rfc : null;
        $("menu-empresa").innerHTML = '<div class="xml-otra__grupo">Empresas con XML</div>' +
            (E.contribuyentes.length ? E.contribuyentes.map(function (c) {
                return '<button type="button" data-rfc="' + esc(c.rfc) + '"' + (c.rfc === E.rfc ? ' class="xml-activa"' : "") + ">" +
                    esc(c.alias || c.nombre || c.rfc) + " <span>" + esc(c.rfc) + (c.rfc === activa ? " · empresa activa" : "") +
                    " · " + Number(c.total || 0).toLocaleString("es-MX") + " XML</span></button>";
            }).join("") : '<p class="xml-otra__nota">Todavía no hay XML cargados.</p>') +
            '<div class="xml-separador"></div><button type="button" data-ir="/herramientas/xml/">Agregar XML <span>En Administración de XML</span></button>';
    }

    async function elegirDelMenu(b) {
        $("menu-empresa").hidden = true;
        if (b.dataset.ir) { location.href = b.dataset.ir; return; }
        var rfc = b.dataset.rfc;
        var registrada = (await apiJSON("/api/clientes").catch(function () { return []; })).some(function (c) { return c.rfc === rfc; });
        if (registrada && (!E.empresa || E.empresa.rfc !== rfc)) await Fiscontable.elegirEmpresa(rfc);   // la barra avisa y se recarga sola
        else abrirEmpresa(rfc);
    }

    async function abrirEmpresa(rfc) {
        E.rfc = rfc || null;
        E.datos = vacio(); E.cargado = null; E.seleccion.clear(); E.pestana = ""; E.busqueda = ""; $("buscar").value = "";
        pintarEncabezado();
        var c = rfc && E.contribuyentes.find(function (x) { return x.rfc === rfc; });
        if (!c) { mostrarVacio(); return; }
        $("sin-empresa").hidden = true;
        $("contenido").hidden = false;
        // Los cuadros dicen cuántos XML hay por mes (sin abrirlos); los CFDI se leen solo del periodo elegido
        try { E.porDia = (await apiJSON("/api/listas-sat/conteos?rfc=" + encodeURIComponent(rfc))).xml_por_dia || {}; }
        catch (e) { E.porDia = {}; }
        if (E.rfc !== rfc) return;
        var porMes = {};
        Object.keys(E.porDia).forEach(function (d) { porMes[d.slice(0, 7)] = (porMes[d.slice(0, 7)] || 0) + E.porDia[d]; });
        E.P.conteos(porMes);
        var pedido = E.pedido; E.pedido = null;         // lo que mandó Administración de XML o Conciliación
        if (pedido && (pedido.desde || pedido.hasta || pedido.anio)) E.P.poner(pedido);
        else if (E.periodoGeneral) E.P.poner({ anio: E.periodoGeneral.slice(0, 4), meses: [E.periodoGeneral.slice(5, 7)] });
        else E.P.poner(null);
        alCambiarPeriodo();
    }

    function vacio() { return { cfdi: [], grupos: (E.datos && E.datos.grupos) || {}, cambios: [], revisados: 0 }; }

    function mostrarVacio() {
        $("contenido").hidden = true;
        var caja = $("sin-empresa");
        caja.hidden = false;
        caja.innerHTML = E.rfc
            ? '<p class="ctx-vacio__titulo">' + esc(nombreDe(E.rfc)) + " todavía no tiene XML</p><p>Las listas se cruzan contra sus XML: agrégalos en Administración de XML.</p>" +
              '<div class="ctx-vacio__acciones"><a class="xml-btn xml-btn--primario" href="/herramientas/xml/">Ir a Administración de XML</a>' +
              '<button type="button" class="xml-btn" data-abrir-rfc>Buscar un RFC suelto</button></div>'
            : '<p class="ctx-vacio__titulo">¿De qué empresa?</p><p>Elige una empresa para revisar a sus proveedores y clientes contra las listas del SAT, o busca un RFC suelto.</p>' +
              '<div class="ctx-vacio__acciones"><button type="button" class="xml-btn xml-btn--primario" data-elegir>Elegir empresa</button>' +
              '<button type="button" class="xml-btn" data-abrir-rfc>Buscar un RFC suelto</button></div>';
    }

    // ------------------------------------------------------------ periodo (el mismo de XML y Conciliación)
    function hayEleccion() { return E.P.hayEleccion(); }
    function enPeriodo(f) { return E.P.dentro(f.fecha); }
    function textoPeriodo() { return E.P.texto(); }

    // Lo que cuenta en el periodo: la pestaña y Emitidos/Recibidos, sin la búsqueda
    function base(f) {
        if (!E.informativos && !f._grave) return false;
        if (E.rol && f.rol !== E.rol) return false;
        return true;
    }
    function dePestana(f, p) { return !p || f.grupos.indexOf(p) !== -1; }

    /* Si lo elegido cabe en lo ya leído se filtra aquí; si no, se pide al servidor solo ese rango. */
    async function alCambiarPeriodo() {
        E.seleccion.clear();
        if (!E.rfc) return;
        var r = E.P.rango();
        if (!hayEleccion()) { E.datos = vacio(); E.cargado = null; pintarTodo(); return; }
        var cabe = E.cargado && E.cargado.rfc === E.rfc && (r.desde || "0000") >= E.cargado.desde && (r.hasta || "9999") <= E.cargado.hasta;
        if (!cabe) {
            var rfc = E.rfc, pedido = { desde: r.desde || "", hasta: r.hasta || "" };
            $("resumen").textContent = "Revisando " + textoPeriodo() + " contra las listas…";
            var q = new URLSearchParams({ rfc: rfc });
            if (pedido.desde) q.set("desde", pedido.desde); if (pedido.hasta) q.set("hasta", pedido.hasta);
            var datos;
            try { datos = await apiJSON("/api/listas-sat/cfdi?" + q.toString()); }
            catch (e) { $("resumen").textContent = e.message; return; }
            var r2 = E.P.rango();
            if (E.rfc !== rfc || (r2.desde || "") !== pedido.desde || (r2.hasta || "") !== pedido.hasta) return;   // cambió mientras cargaba
            datos.cfdi.forEach(function (f) {
                f._grave = f.listas.some(function (h) { return h.gravedad !== "informativo"; });
                f._texto = [f.rfc, f.nombre, f.serie_folio, f.uuid].join(" ").toLowerCase();
            });
            E.datos = datos;
            E.cargado = { rfc: rfc, desde: datos.desde, hasta: datos.hasta };
        }
        pintarTodo();
    }

    function pintarTodo() { pintarPestanas(); aplicar(); }

    // ------------------------------------------------------------ pestañas
    function pintarPestanas() {
        var enP = E.datos.cfdi.filter(function (f) { return enPeriodo(f) && base(f); });
        var grupos = E.datos.grupos;
        var lista = [["", "General", enP.length]];
        Object.keys(grupos).forEach(function (g) {
            var n = enP.filter(function (f) { return dePestana(f, g); }).length;
            if (n) lista.push([g, grupos[g], n]);                 // si no hay, la pestaña no aparece
        });
        if (!lista.some(function (p) { return p[0] === E.pestana; })) E.pestana = "";
        $("pestanas").innerHTML = lista.map(function (p) {
            return '<button type="button" role="tab" class="pestana' + (E.pestana === p[0] ? " pestana--activa" : "") + (p[0] ? " ls-pestana--lista" : "") +
                '" data-pestana="' + p[0] + '" aria-selected="' + (E.pestana === p[0]) + '">' + esc(p[1]) + '<span class="xml-cuenta">' + p[2] + "</span></button>";
        }).join("");
        var nR = enP.filter(function (f) { return f.rol === "recibido"; }).length;
        $("roles").innerHTML = [["", "Todos", enP.length], ["recibido", "Recibidos (proveedores)", nR], ["emitido", "Emitidos (clientes)", enP.length - nR]].map(function (r) {
            return '<button type="button" class="xml-chip' + (E.rol === r[0] ? " xml-chip--activo" : "") + '" data-rol="' + r[0] + '">' + r[1] + "<span>" + r[2] + "</span></button>";
        }).join("") + '<label class="ls-informativos" title="69-B desvirtuados y sentencias favorables: no son riesgo, pero puedes verlos">' +
            '<input type="checkbox" id="chk-informativos"' + (E.informativos ? " checked" : "") + "> Incluir desvirtuados</label>";
    }

    // ------------------------------------------------------------ tabla
    var COLUMNAS = [
        { clave: "fecha", titulo: "Fecha", ancho: 92 },
        { clave: "rol", titulo: "E/R", ancho: 74 },
        { clave: "tipo", titulo: "Tipo", ancho: 74 },
        { clave: "serie_folio", titulo: "Serie-Folio", ancho: 110 },
        { clave: "rfc", titulo: "RFC contraparte", ancho: 132 },
        { clave: "nombre", titulo: "Nombre", ancho: 240 },
        { clave: "total", titulo: "Total", ancho: 112, num: true },
        { clave: "estado_sat", titulo: "Estado SAT", ancho: 96 }
    ];
    var COL_GENERAL = [{ clave: "_encontrado", titulo: "Encontrado en", ancho: 300 }];
    var COL_LISTA = [{ clave: "_situacion", titulo: "Situación", ancho: 220 }, { clave: "_publicacion", titulo: "Publicación", ancho: 180 }];

    function columnas() { return COLUMNAS.concat(E.pestana ? COL_LISTA : COL_GENERAL); }

    function hitsDe(f) { return E.pestana ? f.listas.filter(function (h) { return h.grupo === E.pestana; }) : f.listas; }

    function valorOrden(f, clave) {
        if (clave === "_encontrado" || clave === "_situacion") return hitsDe(f).map(function (h) { return h.nombre_lista + h.situacion; }).join();
        if (clave === "_publicacion") return (hitsDe(f)[0] || {}).fecha || "";
        var v = f[clave];
        return typeof v === "string" ? v.toLowerCase() : v;
    }

    function celda(f, c) {
        var hs = hitsDe(f);
        switch (c.clave) {
            case "fecha": return dmy(f.fecha);
            case "rol": return f.rol === "emitido" ? "Emitido" : "Recibido";
            case "tipo": return esc(TIPO[f.tipo] || f.tipo || "");
            case "total": return dinero(f.total) + (f.moneda && f.moneda !== "MXN" ? " " + esc(f.moneda) : "");
            case "estado_sat": return '<span class="' + (f.estado_sat === "Cancelado" ? "ls-cancelado" : "") + '">' + esc(f.estado_sat || "Sin validar") + "</span>";
            case "rfc": return '<span class="ls-rfc">' + esc(f.rfc) + "</span>";
            case "_encontrado": return '<span class="ls-sellos ls-sellos--fila">' + hs.map(function (h) { return sello(h, false); }).join("") + "</span>";
            case "_situacion": return '<span class="ls-sellos ls-sellos--fila">' + hs.map(function (h) { return sello(h, false); }).join("") + "</span>";
            case "_publicacion": return esc(hs.filter(function (h) { return h.fecha; }).map(function (h) { return (h.fecha_tipo || "") + " " + dmy(h.fecha); }).join(" · "));
            default: return esc(f[c.clave] || "");
        }
    }

    function aplicar() {
        var q = E.busqueda.trim().toLowerCase();
        E.filas = E.datos.cfdi.filter(function (f) {
            return enPeriodo(f) && base(f) && dePestana(f, E.pestana) && (!q || f._texto.indexOf(q) !== -1);
        });
        var o = E.orden;
        E.filas.sort(function (a, b) {
            var x = valorOrden(a, o.clave), y = valorOrden(b, o.clave);
            return (x > y ? 1 : x < y ? -1 : 0) * o.dir;
        });
        pintarResumen();
        pintarTabla();
    }

    // Cuántos XML hay (de cualquier tipo, sin nómina) en el periodo elegido, estén o no en listas
    function xmlEnPeriodo() {
        var dias = E.porDia || {}, n = 0;
        Object.keys(dias).forEach(function (d) { if (enPeriodo({ fecha: d })) n += dias[d]; });
        return n;
    }

    function pintarResumen() {
        var d = E.datos;
        if (!hayEleccion()) { $("resumen").textContent = ""; return; }
        if (!xmlEnPeriodo()) {
            $("resumen").innerHTML = '<span class="ls-sin-xml">Sin XML de ' + esc(textoPeriodo()) + '. <a class="xml-enlace" href="/herramientas/xml/">Agrégalos en Administración de XML</a></span>';
            return;
        }
        var enP = d.cfdi.filter(function (f) { return enPeriodo(f) && f._grave; });
        var contrapartes = new Set(enP.map(function (f) { return f.rfc; }));
        $("resumen").innerHTML = !d.revisados ? "Todavía no hay XML para revisar."
            : enP.length ? "<strong>" + enP.length + " CFDI</strong> de " + textoPeriodo() + " son con <strong>" + contrapartes.size +
                (contrapartes.size === 1 ? " proveedor o cliente" : " proveedores o clientes") + "</strong> que aparecen en alguna lista del SAT."
            : '<span class="ls-limpio">✓ En ' + esc(textoPeriodo()) + " ningún proveedor o cliente aparece en las listas del SAT.</span>";
    }

    function pintarTabla() {
        var cols = columnas();
        var todos = E.filas.length && E.filas.every(function (f) { return E.seleccion.has(f.uuid); });
        $("thead").innerHTML = "<tr>" + '<th class="ls-chk"><input type="checkbox" id="chk-todos" aria-label="Seleccionar todo"' + (todos ? " checked" : "") + "></th>" +
            cols.map(function (c) {
                var flecha = E.orden.clave === c.clave ? '<span class="xml-orden">' + (E.orden.dir > 0 ? "▲" : "▼") + "</span>" : "";
                return '<th data-orden="' + c.clave + '" style="width:' + c.ancho + 'px;min-width:' + c.ancho + 'px"' + (c.num ? ' class="xml-num"' : "") + ">" + c.titulo + flecha + "</th>";
            }).join("") + "</tr>";
        var maximo = 1500;
        $("tbody").innerHTML = E.filas.slice(0, maximo).map(function (f) {
            return '<tr data-uuid="' + esc(f.uuid) + '" class="' + (E.seleccion.has(f.uuid) ? "xml-fila--sel " : "") + (f.estado_sat === "Cancelado" ? "ls-fila--cancelada" : "") + '">' +
                '<td class="ls-chk"><input type="checkbox" data-sel' + (E.seleccion.has(f.uuid) ? " checked" : "") + "></td>" +
                cols.map(function (c) { return "<td" + (c.num ? ' class="xml-num"' : "") + ">" + celda(f, c) + "</td>"; }).join("") + "</tr>";
        }).join("");
        var sin = $("sin-filas");
        sin.hidden = E.filas.length > 0;
        if (!E.filas.length) {
            sin.textContent = !hayEleccion() ? "Elige un año y al menos un mes (o un rango de fechas) para revisar sus CFDI."
                : !xmlEnPeriodo() ? "Sin XML de " + textoPeriodo() + "."
                : E.busqueda ? "Nada coincide con la búsqueda." : "Ningún CFDI de " + textoPeriodo() + " es con proveedores o clientes en las listas.";
        }
        var suma = E.filas.reduce(function (s, f) { return s + (f.estado_sat === "Cancelado" || f.tipo === "P" ? 0 : (f.tipo === "E" ? -1 : 1) * (f.total || 0)); }, 0);
        $("conteo-filas").textContent = E.filas.length.toLocaleString("es-MX") + " CFDI" + (E.filas.length > maximo ? " (se muestran " + maximo + ")" : "") +
            " · Total vigente " + dinero(suma);
        pintarSeleccion();
    }

    function pintarSeleccion() {
        var n = E.seleccion.size;
        $("barra-seleccion").hidden = !n;
        $("texto-seleccion").textContent = n + (n === 1 ? " CFDI seleccionado" : " CFDI seleccionados");
        var m = uuidsParaAcciones().length;
        $("acciones-alcance").textContent = n ? "Las acciones usan los " + n + " seleccionados." : m ? "Las acciones usan los " + m + " CFDI que ves." : "No hay CFDI en esta vista.";
        $("btn-excel").disabled = $("btn-acuse").disabled = !m;
    }

    function uuidsParaAcciones() {
        return E.seleccion.size ? Array.from(E.seleccion) : E.filas.map(function (f) { return f.uuid; });
    }

    // ------------------------------------------------------------ acciones
    async function exportarExcel() {
        var b = $("btn-excel"), t = b.innerHTML;
        b.disabled = true; b.innerHTML = "<b>⏳</b>Generando…";
        try {
            var titulo = "CFDI con proveedores o clientes en listas del SAT" + (E.pestana ? " · " + E.datos.grupos[E.pestana] : "");
            var resp = await postJSON("/api/listas-sat/excel", { rfc: E.rfc, uuids: uuidsParaAcciones(), titulo: titulo, periodo: textoPeriodo(), desde: E.cargado.desde, hasta: E.cargado.hasta });
            await descargar(resp, E.rfc + "_Listas_SAT.xlsx");
        } catch (e) { aviso(e.message, true); }
        b.innerHTML = t; pintarSeleccion();
    }

    async function descargarAcuses() {
        var uuids = uuidsParaAcciones();
        if (uuids.length > MAX_ACUSES) { aviso("Saca hasta " + MAX_ACUSES + " acuses a la vez: selecciona o filtra menos (hay " + uuids.length + ").", true); return; }
        var b = $("btn-acuse"), t = b.innerHTML;
        b.disabled = true; b.innerHTML = "<b>⏳</b>Generando " + uuids.length + "…";
        try {
            var resp = uuids.length === 1
                ? await api("/api/xml/reporte-validacion?rfc=" + encodeURIComponent(E.rfc) + "&uuid=" + encodeURIComponent(uuids[0]))
                : await postJSON("/api/xml/reportes-validacion", { rfc: E.rfc, uuids: uuids });
            await descargar(resp, uuids.length === 1 ? "acuse_validacion.pdf" : "acuses_validacion.zip");
        } catch (e) { aviso(e.message, true); }
        b.innerHTML = t; pintarSeleccion();
    }

    // ------------------------------------------------------------ ventanas
    function abrirVentana(titulo, bloque) {
        $("ventana-titulo").textContent = titulo;
        $("bloque-rfc").hidden = bloque !== "rfc";
        $("bloque-cambios").hidden = bloque !== "cambios";
        $("ventana").hidden = false;
        if (bloque === "rfc") $("rfc-buscar").focus();
    }
    function cerrarVentana() { $("ventana").hidden = true; }

    function textoCambio(c) {
        if (!c.antes) return "entró a " + c.nombre_lista + " (" + c.despues + ")";
        if (!c.despues) return "salió de " + c.nombre_lista + " (era " + c.antes + ")";
        return "en " + c.nombre_lista + " pasó de " + c.antes + " a " + c.despues;
    }

    function abrirCambios() {
        var cambios = (E.datos && E.datos.cambios) || [];
        $("lista-cambios").innerHTML = cambios.length ? cambios.map(function (c) {
            return '<p class="ls-cambio"><time>' + esc(dmy(c.momento)) + "</time><strong>" + esc(c.nombre || c.rfc) +
                '</strong> <span class="ls-rfc">' + esc(c.rfc) + "</span> " + esc(textoCambio(c)) + "</p>";
        }).join("") : '<p class="ls-nota">Sin cambios en los proveedores y clientes de esta empresa.</p>';
        abrirVentana("Cambios recientes", "cambios");
    }

    async function buscarRfc(e) {
        e.preventDefault();
        var rfc = $("rfc-buscar").value.trim().toUpperCase();
        var caja = $("resultado-buscar");
        caja.innerHTML = '<p class="ls-nota">Buscando…</p>';
        try {
            var r = await apiJSON("/api/listas-sat/buscar?rfc=" + encodeURIComponent(rfc));
            var n = Object.keys(r.fechas || {}).length;
            caja.innerHTML = !r.listas.length
                ? '<p class="ls-limpio">✓ ' + esc(r.rfc) + " no aparece en ninguna de las " + n + " listas descargadas.</p>"
                : '<p class="ls-item__nombre">' + esc(r.listas[0].nombre || r.rfc) + '</p><p class="ls-rfc">' + esc(r.rfc) + '</p><div class="ls-sellos">' +
                  r.listas.map(function (h) { return sello(h, false); }).join("") + "</div>";
            if (r.cambios.length) caja.innerHTML += '<p class="ls-nota">Historial: ' + r.cambios.map(function (c) { return esc(dmy(c.momento) + " " + textoCambio(c)); }).join(" · ") + "</p>";
        } catch (err) { caja.innerHTML = '<p class="ls-nota">' + esc(err.message) + "</p>"; }
    }

    // ------------------------------------------------------------ actualización de las listas
    var antesDeBuscar = null;

    function resumenListas(e) {
        var fechas = e.listas.map(function (l) { return l.actualizado_al; }).filter(Boolean).sort();
        var revisadas = e.listas.map(function (l) { return l.revisada_en; }).filter(Boolean).sort();
        if (!revisadas.length) return "Las listas todavía no se descargan.";
        return "Listas al " + dmy(fechas[fechas.length - 1] || revisadas[revisadas.length - 1]) + " · revisadas " + hace(revisadas[0]);
    }

    async function cargarEstado() {
        try {
            var e = await apiJSON("/api/listas-sat/estado");
            $("texto-actualizacion").textContent = e.actualizando ? "Buscando actualizaciones en el SAT…" : resumenListas(e);
            $("btn-buscar-act").disabled = e.actualizando;
            if (e.actualizando) { setTimeout(cargarEstado, 8000); return; }
            if (antesDeBuscar) {
                var cambiaron = e.listas.filter(function (l) { return l.cambiada_en && l.cambiada_en !== antesDeBuscar[l.lista]; });
                antesDeBuscar = null;
                aviso(cambiaron.length ? "Se actualizaron: " + cambiaron.map(function (l) { return l.nombre; }).join(", ") + "."
                                       : "Las listas ya estaban actualizadas: el SAT no ha publicado nada nuevo.");
                if (cambiaron.length && E.rfc) { E.cargado = null; alCambiarPeriodo(); }   // se vuelve a cruzar el mismo periodo
            }
        } catch (err) { $("texto-actualizacion").textContent = err.message; }
    }

    async function buscarActualizaciones() {
        var boton = $("btn-buscar-act");
        boton.disabled = true;
        try {
            var previo = await apiJSON("/api/listas-sat/estado");
            var r = await (await postJSON("/api/listas-sat/buscar-actualizaciones", {})).json();
            aviso(r.mensaje);
            if (r.estado === "al_dia") { boton.disabled = false; return; }
            antesDeBuscar = {};
            previo.listas.forEach(function (l) { antesDeBuscar[l.lista] = l.cambiada_en; });
            $("texto-actualizacion").textContent = "Buscando actualizaciones en el SAT…";
            setTimeout(cargarEstado, 4000);
        } catch (err) { aviso(err.message, true); boton.disabled = false; }
    }

    // ------------------------------------------------------------ eventos
    function prepararEventos() {
        $("btn-buscar-act").addEventListener("click", buscarActualizaciones);
        $("btn-empresa").addEventListener("click", function (e) {
            e.stopPropagation();
            var m = $("menu-empresa");
            if (m.hidden) pintarMenuEmpresa();
            m.hidden = !m.hidden;
        });
        $("menu-empresa").addEventListener("click", function (e) {
            e.stopPropagation();
            var b = e.target.closest("button"); if (b) elegirDelMenu(b);
        });
        document.addEventListener("click", function () { $("menu-empresa").hidden = true; });
        $("sin-empresa").addEventListener("click", function (e) {
            if (e.target.closest("[data-elegir]")) { e.stopPropagation(); pintarMenuEmpresa(); $("menu-empresa").hidden = false; }
            if (e.target.closest("[data-abrir-rfc]")) abrirVentana("Buscar un RFC", "rfc");
        });

        $("pestanas").addEventListener("click", function (e) {
            var b = e.target.closest("[data-pestana]"); if (!b) return;
            E.pestana = b.dataset.pestana; E.seleccion.clear(); pintarTodo();
        });
        $("roles").addEventListener("click", function (e) {
            var b = e.target.closest("[data-rol]"); if (!b) return;
            E.rol = b.dataset.rol; E.seleccion.clear(); pintarTodo();
        });
        $("roles").addEventListener("change", function (e) {
            if (e.target.id === "chk-informativos") { E.informativos = e.target.checked; pintarTodo(); }
        });
        var reloj = null;
        $("buscar").addEventListener("input", function () {
            clearTimeout(reloj); var v = this.value;
            reloj = setTimeout(function () { E.busqueda = v; aplicar(); }, 150);
        });

        $("thead").addEventListener("click", function (e) {
            if (e.target.id === "chk-todos") {
                E.filas.forEach(function (f) { if (e.target.checked) E.seleccion.add(f.uuid); else E.seleccion.delete(f.uuid); });
                pintarTabla(); return;
            }
            var th = e.target.closest("[data-orden]"); if (!th) return;
            var k = th.dataset.orden;
            E.orden = { clave: k, dir: E.orden.clave === k ? -E.orden.dir : 1 };
            aplicar();
        });
        $("tbody").addEventListener("click", function (e) {
            var tr = e.target.closest("tr[data-uuid]"); if (!tr) return;
            var u = tr.dataset.uuid;
            if (e.target.closest(".ls-chk")) {
                if (e.target.matches("[data-sel]") ? !e.target.checked : E.seleccion.has(u)) E.seleccion.delete(u); else E.seleccion.add(u);
                pintarTabla(); return;
            }
            window.open("/herramientas/xml/detalle/?rfc=" + encodeURIComponent(E.rfc) + "&uuid=" + encodeURIComponent(u), "_blank", "noopener");
        });
        $("btn-limpiar-sel").addEventListener("click", function () { E.seleccion.clear(); pintarTabla(); });

        $("btn-excel").addEventListener("click", exportarExcel);
        $("btn-acuse").addEventListener("click", descargarAcuses);
        $("btn-rfc").addEventListener("click", function () { abrirVentana("Buscar un RFC", "rfc"); });
        $("btn-cambios").addEventListener("click", abrirCambios);
        $("form-buscar").addEventListener("submit", buscarRfc);
        $("ventana-cerrar").addEventListener("click", cerrarVentana);
        $("ventana").addEventListener("click", function (e) { if (e.target === this) cerrarVentana(); });
        document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("ventana").hidden) cerrarVentana(); });

        var rfc = new URLSearchParams(location.search).get("rfc");
        if (rfc) { $("rfc-buscar").value = rfc; abrirVentana("Buscar un RFC", "rfc"); buscarRfc(new Event("submit")); }
    }

    document.addEventListener("DOMContentLoaded", iniciar);
})();
