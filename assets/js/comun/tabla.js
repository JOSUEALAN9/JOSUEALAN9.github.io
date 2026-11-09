/**
 * tabla.js — La tabla de Fiscontable, reutilizable (sale de la de
 * Administración de XML). Requiere nucleo.js y los estilos de
 * herramientas/xml/xml.css (clases xml-tabla, xml-panel, xml-menu…).
 *
 *   var t = FCTabla.crear({
 *       caja: elemento .xml-tabla-caja (vacío; la tabla se dibuja dentro),
 *       id: "conc-emitidos",               // guarda en este navegador columnas y anchos
 *       catalogo: [{clave, etiqueta, tipo, grupo}], predeterminadas: [claves],
 *       sellos: {clave: {valor: "verde"|"ambar"|"rojo"|"gris"}},
 *       claveFila: "uuid", alClic: function (fila) {}, alSeleccionar: function (set) {},
 *       claseFila: function (fila) { return "" }, alCambiarColumnas: function () {}
 *   });
 *   t.ponerFilas(filas)    filas ya filtradas; el orden por columna lo hace la tabla
 *   t.filas()              las filas en el orden en que se ven
 *   t.columnas() / t.ponerColumnas([{clave, ancho}])
 *   t.seleccion            Set con las claves seleccionadas
 *   t.abrirPanelColumnas()
 *
 *   FCTabla.menuVistas({boton, menu, etiqueta, tabla, listar, guardar, borrar})
 *       Menú "Vista ▾": vista de fábrica, vistas guardadas, ★ predeterminada.
 *
 * Desplazamiento virtual: solo se dibujan las filas visibles, así que
 * miles de registros no la traban. Todo dato de un XML se muestra como
 * texto (Fiscontable.escapar).
 */
(function () {
    "use strict";
    var esc = Fiscontable.escapar;
    var ANCHO_TIPO = { moneda: 124, numero: 96, fecha: 104, uuid: 130, texto: 160 };
    var fmtMoneda = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var fmtNumero = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 4 });

    function guardarLocal(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* nada */ } }
    function leerLocal(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }

    function formato(c, v) {
        if (v === undefined || v === null || v === "") return "";
        if (c.tipo === "moneda") return fmtMoneda.format(v);
        if (c.tipo === "numero") return fmtNumero.format(v);
        if (c.tipo === "fecha") { var s = String(v); return s.length >= 10 ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : s; }
        return String(v);
    }

    function crear(o) {
        var caja = o.caja;
        var claveFila = o.claveFila || "uuid";
        var anchoClave = o.anchoClave || {};
        var T = { catalogo: o.catalogo, predeterminadas: o.predeterminadas, cols: [], datos: [], orden: { clave: null, dir: 1 },
                  seleccion: new Set(), altoFila: 35, ultimoInicio: -1, vista: "" };

        caja.innerHTML = '<table class="xml-tabla"><colgroup></colgroup><thead></thead><tbody></tbody><tfoot></tfoot></table>' +
            '<p class="xml-vacio xml-vacio--tabla" hidden>No hay registros con estos filtros.</p>';
        var tabla = caja.querySelector("table"), colgroup = caja.querySelector("colgroup"), thead = caja.querySelector("thead"),
            tbody = caja.querySelector("tbody"), tfoot = caja.querySelector("tfoot"), vacio = caja.querySelector(".xml-vacio");

        function colPorClave(k) { return T.catalogo.find(function (c) { return c.clave === k; }); }
        function anchoDefecto(c) { return anchoClave[c.clave] || ANCHO_TIPO[c.tipo] || 150; }
        function deFabrica() { return T.predeterminadas.filter(colPorClave).map(function (k) { return { clave: k, ancho: 0 }; }); }
        function guardarCols() { guardarLocal("tabla:" + o.id + ":cols", T.cols); guardarLocal("tabla:" + o.id + ":vista", T.vista); if (o.alCambiarColumnas) o.alCambiarColumnas(); }

        function prepararColumnas(predeterminadaGuardada) {
            var local = leerLocal("tabla:" + o.id + ":cols");
            var cols = local || (predeterminadaGuardada && predeterminadaGuardada.columnas) || deFabrica();
            T.vista = local ? (leerLocal("tabla:" + o.id + ":vista") || "") : (predeterminadaGuardada ? predeterminadaGuardada.nombre : "");
            T.cols = cols.filter(function (c) { return colPorClave(c.clave); });
            if (!T.cols.length) T.cols = deFabrica();
        }

        function visibles() {
            return T.cols.map(function (x) {
                var c = colPorClave(x.clave);
                return c ? Object.assign({}, c, { ancho: x.ancho || anchoDefecto(c) }) : null;
            }).filter(Boolean);
        }

        function ordenar() {
            if (!T.orden.clave) return;
            var k = T.orden.clave, d = T.orden.dir, tipo = (colPorClave(k) || {}).tipo;
            T.datos.sort(function (a, b) {
                var x = a[k], y = b[k];
                if (x == null || x === "") return 1;
                if (y == null || y === "") return -1;
                if (tipo === "moneda" || tipo === "numero") return (x - y) * d;
                return String(x).localeCompare(String(y), "es") * d;
            });
        }

        function celda(c, f, fija) {
            var estiloFija = fija ? ' style="left:36px"' : "";
            if (o.celda) {
                var propia = o.celda(c, f);
                if (propia !== undefined && propia !== null) return "<td" + (fija ? ' class="xml-fija xml-fija--ultima"' : "") + estiloFija + ">" + propia + "</td>";
            }
            var v = f[c.clave];
            if (c.clave === "alertas") {
                var n = v ? String(v).split("; ").length : 0;
                return "<td" + (fija ? ' class="xml-fija xml-fija--ultima"' : "") + estiloFija + (n ? ' title="' + esc(v) + '"' : "") + ">" +
                    (n ? '<span class="xml-alerta">⚠ ' + n + "</span> " + esc(String(v).split("; ")[0]) : "") + "</td>";
            }
            var clase = c.tipo === "moneda" || c.tipo === "numero" ? "xml-num" : (c.tipo === "uuid" ? "xml-uuid" : "");
            if (c.tipo === "moneda" && typeof v === "number" && v < -0.005) clase += " fc-negativo";
            if (fija) clase += " xml-fija xml-fija--ultima";
            var txt = formato(c, v);
            var sello = o.sellos && o.sellos[c.clave] && o.sellos[c.clave][v];
            var html = sello ? '<span class="xml-sello xml-sello--' + sello + '">' + esc(txt) + "</span>" : esc(txt);
            return "<td" + (clase ? ' class="' + clase.trim() + '"' : "") + estiloFija + (txt.length > 18 ? ' title="' + esc(txt) + '"' : "") + ">" + html + "</td>";
        }

        function contar() { var s = new Set(); T.datos.forEach(function (f) { s.add(f[claveFila]); }); return s.size; }

        function pintar() {
            var cols = visibles();
            colgroup.innerHTML = '<col style="width:36px">' + cols.map(function (c) { return '<col style="width:' + c.ancho + 'px">'; }).join("");
            tabla.style.width = (36 + cols.reduce(function (s, c) { return s + c.ancho; }, 0)) + "px";
            var todas = T.datos.length > 0 && T.datos.every(function (f) { return T.seleccion.has(f[claveFila]); });
            thead.innerHTML = "<tr>" +
                '<th class="xml-check xml-fija" style="left:0"><input type="checkbox" data-todas' + (todas ? " checked" : "") + ' title="Seleccionar todo lo filtrado"></th>' +
                cols.map(function (c, i) {
                    var ord = T.orden.clave === c.clave ? (T.orden.dir > 0 ? "▲" : "▼") : "";
                    return '<th data-clave="' + esc(c.clave) + '" class="' + (c.tipo === "moneda" || c.tipo === "numero" ? "xml-num" : "") +
                        (i === 0 ? " xml-fija xml-fija--ultima" : "") + '"' + (i === 0 ? ' style="left:36px"' : "") +
                        ' title="' + esc(c.etiqueta + (c.grupo ? " · " + c.grupo : "")) + '"><span class="xml-th-txt" draggable="true">' + esc(c.etiqueta) +
                        '</span><span class="xml-orden">' + ord + '</span><span class="xml-asa" data-asa="' + esc(c.clave) + '"></span></th>';
                }).join("") + "</tr>";
            tfoot.innerHTML = T.datos.length ? "<tr>" + '<td class="xml-fija" style="left:0"></td>' + cols.map(function (c, i) {
                if (i === 0) return '<td class="xml-fija xml-fija--ultima" style="left:36px">Total (' + contar() + ")</td>";
                if (c.tipo !== "moneda" || c.sinTotal) return "<td></td>";
                var s = 0;
                for (var j = 0; j < T.datos.length; j++) s += T.datos[j][c.clave] || 0;
                return '<td class="xml-num' + (s < -0.005 ? " fc-negativo" : "") + '">' + fmtMoneda.format(s) + "</td>";
            }).join("") + "</tr>" : "";
            vacio.hidden = T.datos.length > 0;
            pintarFilas(true);
        }

        function pintarFilas(forzar) {
            var alto = T.altoFila;
            var n = Math.ceil((caja.clientHeight || 600) / alto) + 1;
            var inicio = Math.max(0, Math.floor(caja.scrollTop / alto) - 15);
            if (!forzar && Math.abs(inicio - T.ultimoInicio) < 8) return;
            T.ultimoInicio = inicio;
            var fin = Math.min(T.datos.length, inicio + n + 30);
            var cols = visibles();
            var h = [];
            if (inicio > 0) h.push('<tr aria-hidden="true" style="height:' + (inicio * alto) + 'px"><td colspan="' + (cols.length + 1) + '" style="padding:0;border:0"></td></tr>');
            for (var i = inicio; i < fin; i++) {
                var f = T.datos[i], sel = T.seleccion.has(f[claveFila]);
                var extra = o.claseFila ? o.claseFila(f) : "";
                var clases = (sel ? "xml-sel " : "") + (extra || "");
                h.push('<tr data-i="' + i + '"' + (o.alClic ? ' tabindex="0"' : "") + (clases.trim() ? ' class="' + clases.trim() + '"' : "") + ">" +
                    '<td class="xml-check xml-fija" style="left:0"><input type="checkbox" data-sel="' + i + '"' + (sel ? " checked" : "") + "></td>" +
                    cols.map(function (c, j) { return celda(c, f, j === 0); }).join("") + "</tr>");
            }
            if (fin < T.datos.length) h.push('<tr aria-hidden="true" style="height:' + ((T.datos.length - fin) * alto) + 'px"><td colspan="' + (cols.length + 1) + '" style="padding:0;border:0"></td></tr>');
            tbody.innerHTML = h.join("");
            var muestra = tbody.querySelector("tr[data-i]");
            if (muestra && muestra.offsetHeight && Math.abs(muestra.offsetHeight - T.altoFila) > 1) T.altoFila = muestra.offsetHeight;
        }

        function avisarSeleccion() { if (o.alSeleccionar) o.alSeleccionar(T.seleccion); }

        function moverColumna(de, a, despues) {
            var i = T.cols.findIndex(function (c) { return c.clave === de; });
            if (i < 0 || de === a) return;
            var item = T.cols.splice(i, 1)[0];
            var j = T.cols.findIndex(function (c) { return c.clave === a; });
            T.cols.splice(despues ? j + 1 : j, 0, item);
            guardarCols(); pintar(); if (!panel.hidden) pintarPanel();
        }

        /* ---------- encabezados: ordenar, arrastrar, ancho */
        var arrastrada = null;
        thead.addEventListener("dragstart", function (e) {
            var th = e.target.closest && e.target.closest("th[data-clave]");
            if (!th || !e.target.closest(".xml-th-txt")) return;
            arrastrada = th.dataset.clave; th.classList.add("xml-arrastrando");
            e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", arrastrada);
        });
        thead.addEventListener("dragover", function (e) {
            var th = e.target.closest("th[data-clave]");
            if (!th || !arrastrada) return;
            e.preventDefault();
            thead.querySelectorAll(".xml-destino").forEach(function (x) { x.classList.remove("xml-destino"); });
            th.classList.add("xml-destino");
        });
        thead.addEventListener("drop", function (e) {
            var th = e.target.closest("th[data-clave]");
            if (!th || !arrastrada) return;
            e.preventDefault();
            var r = th.getBoundingClientRect();
            moverColumna(arrastrada, th.dataset.clave, e.clientX > r.left + r.width / 2);
            arrastrada = null;
        });
        thead.addEventListener("dragend", function () {
            arrastrada = null;
            thead.querySelectorAll(".xml-arrastrando,.xml-destino").forEach(function (x) { x.classList.remove("xml-arrastrando", "xml-destino"); });
        });
        thead.addEventListener("mousedown", function (e) {
            var asa = e.target.closest("[data-asa]");
            if (!asa) return;
            e.preventDefault(); e.stopPropagation();
            var clave = asa.dataset.asa, th = asa.parentElement;
            var x0 = e.clientX, w0 = th.getBoundingClientRect().width;
            var col = colgroup.children[Array.prototype.indexOf.call(th.parentElement.children, th)];
            function mover(ev) {
                col.style.width = Math.max(60, Math.round(w0 + ev.clientX - x0)) + "px";
                tabla.style.width = Array.prototype.reduce.call(colgroup.children, function (s, c) { return s + parseInt(c.style.width, 10); }, 0) + "px";
            }
            function soltar() {
                document.removeEventListener("mousemove", mover); document.removeEventListener("mouseup", soltar);
                var x = T.cols.find(function (c) { return c.clave === clave; });
                if (x) x.ancho = parseInt(col.style.width, 10);
                guardarCols();
            }
            document.addEventListener("mousemove", mover); document.addEventListener("mouseup", soltar);
        });
        thead.addEventListener("click", function (e) {
            if (e.target.closest("[data-asa]")) return;
            if (e.target.matches("[data-todas]")) {
                var marcar = e.target.checked;
                T.datos.forEach(function (f) { if (marcar) T.seleccion.add(f[claveFila]); else T.seleccion.delete(f[claveFila]); });
                pintarFilas(true); avisarSeleccion();
                return;
            }
            var th = e.target.closest("th[data-clave]");
            if (!th) return;
            var k = th.dataset.clave;
            T.orden = T.orden.clave === k ? { clave: k, dir: -T.orden.dir } : { clave: k, dir: 1 };
            ordenar(); pintar();
        });
        tbody.addEventListener("click", function (e) {
            var chk = e.target.closest("[data-sel]");
            if (chk) {
                var f = T.datos[+chk.dataset.sel];
                if (chk.checked) T.seleccion.add(f[claveFila]); else T.seleccion.delete(f[claveFila]);
                chk.closest("tr").classList.toggle("xml-sel", chk.checked);
                avisarSeleccion();
                return;
            }
            if (e.target.closest(".xml-check")) return;
            var tr = e.target.closest("tr[data-i]");
            if (tr && o.alClic) o.alClic(T.datos[+tr.dataset.i], e);
        });
        caja.addEventListener("scroll", function () { pintarFilas(false); }, { passive: true });
        window.addEventListener("resize", function () { pintarFilas(true); });

        /* ---------- panel de columnas (uno por tabla) */
        var panel = document.createElement("aside");
        panel.className = "xml-panel";
        panel.hidden = true;
        panel.innerHTML = '<div class="xml-panel__cabeza"><h3>Columnas</h3><button type="button" class="xml-enlace" data-cerrar>Cerrar</button></div>' +
            '<input type="search" placeholder="Buscar columna…" data-buscar>' +
            '<p class="xml-panel__sub">Visibles <span class="xml-tenue">(arrastra para ordenar)</span></p><ol class="xml-lista" data-visibles></ol>' +
            '<p class="xml-panel__sub">Disponibles</p><div class="fc-disponibles" data-disponibles></div>' +
            '<div class="xml-panel__pie"><button type="button" class="xml-enlace" data-fabrica>Regresar a las de fábrica</button></div>';
        document.body.appendChild(panel);
        var pBuscar = panel.querySelector("[data-buscar]"), pVis = panel.querySelector("[data-visibles]"), pDisp = panel.querySelector("[data-disponibles]");

        function pintarPanel() {
            var q = pBuscar.value.trim().toLowerCase();
            var visSet = new Set(T.cols.map(function (c) { return c.clave; }));
            pVis.innerHTML = T.cols.map(function (x) {
                var c = colPorClave(x.clave);
                if (!c || (q && c.etiqueta.toLowerCase().indexOf(q) === -1)) return "";
                return '<li draggable="true" data-clave="' + esc(c.clave) + '"><span class="xml-agarre">⋮⋮</span>' + esc(c.etiqueta) +
                    '<button type="button" data-ocultar="' + esc(c.clave) + '" title="Ocultar">×</button></li>';
            }).join("");
            var grupos = {};
            T.catalogo.forEach(function (c) {
                if (visSet.has(c.clave) || (q && (c.etiqueta + " " + c.grupo).toLowerCase().indexOf(q) === -1)) return;
                (grupos[c.grupo] = grupos[c.grupo] || []).push(c);
            });
            pDisp.innerHTML = Object.keys(grupos).map(function (g) {
                return '<div class="xml-grupo">' + esc(g) + "</div>" + grupos[g].map(function (c) {
                    return '<label class="xml-disp"><input type="checkbox" data-mostrar="' + esc(c.clave) + '"> ' + esc(c.etiqueta) + "</label>";
                }).join("");
            }).join("") || '<p class="xml-tenue" style="padding:10px">Ya están todas visibles.</p>';
        }
        panel.querySelector("[data-cerrar]").addEventListener("click", function () { panel.hidden = true; });
        pBuscar.addEventListener("input", pintarPanel);
        panel.querySelector("[data-fabrica]").addEventListener("click", function () { api.aplicarVista(null); });
        pDisp.addEventListener("change", function (e) {
            var k = e.target.dataset.mostrar; if (!k) return;
            T.cols.push({ clave: k, ancho: 0 }); guardarCols(); pintarPanel(); pintar();
        });
        var arrP = null;
        pVis.addEventListener("click", function (e) {
            var k = e.target.dataset.ocultar;
            if (!k || T.cols.length === 1) return;
            T.cols = T.cols.filter(function (c) { return c.clave !== k; }); guardarCols(); pintarPanel(); pintar();
        });
        pVis.addEventListener("dragstart", function (e) { var li = e.target.closest("li"); if (li) { arrP = li.dataset.clave; e.dataTransfer.setData("text/plain", arrP); } });
        pVis.addEventListener("dragover", function (e) {
            var li = e.target.closest("li"); if (!li || !arrP) return;
            e.preventDefault();
            pVis.querySelectorAll(".xml-destino").forEach(function (x) { x.classList.remove("xml-destino"); });
            li.classList.add("xml-destino");
        });
        pVis.addEventListener("drop", function (e) {
            var li = e.target.closest("li"); if (!li || !arrP) return;
            e.preventDefault(); moverColumna(arrP, li.dataset.clave, false); arrP = null;
        });
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") panel.hidden = true; });

        var api = {
            seleccion: T.seleccion,
            iniciarColumnas: function (predeterminadaGuardada) { prepararColumnas(predeterminadaGuardada); },
            ponerFilas: function (filas) {
                T.datos = filas.slice();
                ordenar();
                var validas = new Set(T.datos.map(function (f) { return f[claveFila]; }));
                T.seleccion.forEach(function (k) { if (!validas.has(k)) T.seleccion.delete(k); });
                pintar(); avisarSeleccion();
            },
            repintarFilas: function () { pintarFilas(true); },
            filas: function () { return T.datos; },
            columnas: function () { return T.cols; },
            vistaActual: function () { return T.vista; },
            aplicarVista: function (vista) {
                T.cols = (vista ? vista.columnas : deFabrica()).filter(function (c) { return colPorClave(c.clave); });
                if (!T.cols.length) T.cols = deFabrica();
                T.vista = vista ? vista.nombre : "";
                guardarCols(); pintar(); if (!panel.hidden) pintarPanel();
            },
            marcarVista: function (nombre) { T.vista = nombre || ""; guardarCols(); },
            limpiarSeleccion: function () { T.seleccion.clear(); pintarFilas(true); pintar(); avisarSeleccion(); },
            abrirPanelColumnas: function () { panel.hidden = false; pintarPanel(); },
            etiqueta: function (clave) { var c = colPorClave(clave); return c ? c.etiqueta : clave; },
            formato: formato
        };
        return api;
    }

    /* ---------- menú de vistas guardadas */
    function menuVistas(o) {
        var vistas = [];
        function actual() { var n = o.tabla.vistaActual(); return vistas.find(function (v) { return v.nombre === n; }) || null; }
        function item(accion, nombre, texto, clase) {
            return '<button type="button" data-accion="' + accion + '" data-nombre="' + esc(nombre) + '"' + (clase ? ' class="' + clase + '"' : "") + ">" + texto + "</button>";
        }
        function pintar() {
            var v = actual();
            o.etiqueta.textContent = v ? v.nombre : "Vista de fábrica";
            var h = [item("aplicar", "", "Vista de fábrica", !v ? "xml-activa" : "")];
            vistas.forEach(function (p) { h.push(item("aplicar", p.nombre, esc(p.nombre) + (p.predeterminada ? " ★" : ""), v && p.nombre === v.nombre ? "xml-activa" : "")); });
            h.push('<div class="xml-separador"></div>');
            if (v) h.push(item("guardar", v.nombre, "Guardar cambios en «" + esc(v.nombre) + "»"));
            h.push(item("nueva", "", "Guardar como vista nueva…"));
            if (v) h.push(item("pred", v.nombre, v.predeterminada ? "Ya no abrir siempre con esta vista" : "Abrir siempre con esta vista ★"));
            if (v) h.push(item("borrar", v.nombre, "Borrar «" + esc(v.nombre) + "»", "xml-peligro"));
            o.menu.innerHTML = h.join("");
        }
        async function recargar() { try { vistas = await o.listar(); } catch (e) { vistas = []; } pintar(); }
        o.menu.addEventListener("click", async function (e) {
            e.stopPropagation();
            var b = e.target.closest("[data-accion]"); if (!b) return;
            o.menu.hidden = true;
            var v = actual(), accion = b.dataset.accion;
            try {
                if (accion === "aplicar") o.tabla.aplicarVista(vistas.find(function (x) { return x.nombre === b.dataset.nombre; }) || null);
                else if (accion === "guardar" && v) { await o.guardar(v.nombre, v.predeterminada, o.tabla.columnas()); await recargar(); }
                else if (accion === "nueva") {
                    var n = prompt("Nombre de la vista nueva (por ejemplo: Cobranza del mes):", "");
                    if (!n || !n.trim()) return;
                    await o.guardar(n.trim().slice(0, 60), false, o.tabla.columnas());
                    o.tabla.marcarVista(n.trim().slice(0, 60)); await recargar();
                }
                else if (accion === "pred" && v) { await o.guardar(v.nombre, !v.predeterminada, v.columnas); await recargar(); }
                else if (accion === "borrar" && v) {
                    if (!confirm("¿Borrar la vista «" + v.nombre + "»?")) return;
                    await o.borrar(v); await recargar(); o.tabla.aplicarVista(null);
                }
            } catch (err) { Fiscontable.aviso ? Fiscontable.aviso(err.message) : alert(err.message); }
            pintar();
        });
        return {
            recargar: recargar, pintar: pintar,
            predeterminada: function () { return vistas.find(function (v) { return v.predeterminada; }) || null; }
        };
    }

    /* ---------- tabla estándar (G-04): barra de herramientas + tabla + estados, en una pieza
       var t = FCTabla.estandar({
           contenedor: div vacío, id: "validador" (vistas guardadas en el servidor con este nombre),
           catalogo, predeterminadas, sellos, claveFila, celda, claseFila, alClic, alSeleccionar,  (como FCTabla.crear)
           buscar: { texto: "Buscar…", campos: ["uuid", "rfc"] },
           filtros: [{ clave, etiqueta, texto: function (v) {} }],      se eligen en "Filtros" y quedan como etiquetas
           rapidos: { clave, valores: [{ valor, etiqueta }] },          etiquetas con conteo arriba de la tabla
           exportar: { nombre: "Archivo.xlsx", hoja: "Datos", porValor: { clave, valores: [...] },
                       extras: [{ texto, accion(filas) }],     más opciones en el menú «Descargar ▾»
                       enBarra: false },                       sin botón: la página lo pone en su propio «Descargar» (t.exportar())
           vacio: { titulo, texto }, extra: [elementos que van junto a los botones]
       });
       t.ponerDatos(filas)  t.cargando()  t.error(mensaje, reintentar)  t.visibles()  t.filtrar(clave, valor)  t.tabla
       t.quitarSeleccion()   alClic(fila, filasVisibles, evento) */
    function estandar(o) {
        var raiz = o.contenedor;
        var F = { datos: [], buscar: "", filtros: {}, rapido: null };
        raiz.classList.add("fct");
        raiz.innerHTML =
            '<div class="xml-chips fct-rapidos" hidden></div>' +
            '<div class="xml-toolbar fct-barra">' +
                (o.buscar ? '<input type="search" class="fct-buscar" placeholder="' + esc(o.buscar.texto || "Buscar…") + '" aria-label="Buscar">' : "") +
                '<div class="xml-toolbar__der"><span class="fct-extra"></span>' +
                    (o.filtros && o.filtros.length ? '<div class="xml-menu"><button type="button" class="xml-btn" data-fct="filtros" aria-haspopup="true">Filtros<span class="xml-insignia" hidden></span></button>' +
                        '<div class="xml-menu__lista xml-menu__lista--filtros fct-menu-filtros" hidden></div></div>' : "") +
                    '<button type="button" class="xml-btn" data-fct="columnas">Columnas</button>' +
                    '<div class="xml-menu"><button type="button" class="xml-btn" data-fct="vistas" aria-haspopup="true"><span class="fct-vista">Vista de fábrica</span> ▾</button>' +
                        '<div class="xml-menu__lista fct-menu-vistas" hidden></div></div>' +
                    (o.exportar && o.exportar.enBarra !== false ? '<div class="xml-menu"><button type="button" class="xml-btn" data-fct="descargar" aria-haspopup="true" disabled>Descargar ▾</button>' +
                        '<div class="xml-menu__lista fct-menu-descargar" hidden><button type="button" data-fct="excel">Excel de esta tabla</button>' +
                        ((o.exportar.extras || []).map(function (x, i) { return '<button type="button" data-fct-extra="' + i + '">' + esc(x.texto) + "</button>"; }).join("")) +
                        "</div></div>" : "") +
                "</div></div>" +
            '<div class="xml-filtros-activos fct-chips" hidden></div>' +
            '<div class="fct-estado" hidden></div>' +
            '<div class="xml-tabla-caja fct-caja"></div>';
        var q = function (sel) { return raiz.querySelector(sel); };
        var caja = q(".fct-caja"), estado = q(".fct-estado"), menuF = q(".fct-menu-filtros"), menuV = q(".fct-menu-vistas"), menuD = q(".fct-menu-descargar");
        (o.extra || []).forEach(function (el) { q(".fct-extra").appendChild(el); });

        var tabla = crear({
            caja: caja, id: o.id, catalogo: o.catalogo, predeterminadas: o.predeterminadas, sellos: o.sellos, anchoClave: o.anchoClave,
            claveFila: o.claveFila, celda: o.celda, claseFila: o.claseFila, alSeleccionar: o.alSeleccionar,
            alClic: o.alClic ? function (f, ev) { o.alClic(f, tabla.filas(), ev); } : null,
            alCambiarColumnas: function () { vistas.pintar(); }
        });
        var vistas = menuVistas({
            menu: menuV, etiqueta: q(".fct-vista"), tabla: tabla,
            listar: function () { return pedir("GET"); },
            guardar: function (nombre, pred, cols) { return pedir("PUT", { nombre: nombre, columnas: cols, predeterminada: !!pred }); },
            borrar: function (v) { return pedir("DELETE", null, v.id); }
        });
        async function pedir(metodo, cuerpo, idVista) {
            var r = await fetch(Fiscontable.API + "/api/vistas/" + encodeURIComponent(o.id) + (idVista ? "/" + idVista : ""), {
                method: metodo, credentials: "include",
                headers: cuerpo ? { "Content-Type": "application/json" } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            return r.json();
        }
        tabla.iniciarColumnas(null);
        vistas.recargar().then(function () {
            var pred = vistas.predeterminada();
            if (pred && !leerLocal("tabla:" + o.id + ":cols")) tabla.aplicarVista(pred);
        });


        function textoValor(f, v) { return f.texto ? f.texto(v) : String(v); }
        function pasa(fila, excepto) {
            if (F.rapido !== null && o.rapidos && excepto !== "rapido" && String(fila[o.rapidos.clave]) !== F.rapido) return false;
            for (var k in F.filtros) if (k !== excepto && String(fila[k]) !== F.filtros[k]) return false;
            if (F.buscar && excepto !== "buscar") {
                var campos = (o.buscar && o.buscar.campos) || o.catalogo.map(function (c) { return c.clave; });
                var hay = campos.some(function (c) { return String(fila[c] == null ? "" : fila[c]).toLowerCase().indexOf(F.buscar) >= 0; });
                if (!hay) return false;
            }
            return true;
        }
        function visiblesAhora() { return F.datos.filter(function (f) { return pasa(f); }); }

        function pintarRapidos() {
            var cont = q(".fct-rapidos");
            if (!o.rapidos || !F.datos.length) { cont.hidden = true; return; }
            var base = F.datos.filter(function (f) { return pasa(f, "rapido"); });
            var h = ['<button type="button" class="xml-chip' + (F.rapido === null ? " xml-chip--activo" : "") + '" data-rapido="">Todos<span>' + base.length + "</span></button>"];
            o.rapidos.valores.forEach(function (r) {
                var n = base.filter(function (f) { return String(f[o.rapidos.clave]) === String(r.valor); }).length;
                if (!n && F.rapido !== String(r.valor)) return;
                h.push('<button type="button" class="xml-chip' + (F.rapido === String(r.valor) ? " xml-chip--activo" : "") + '" data-rapido="' + esc(r.valor) + '">' + esc(r.etiqueta) + "<span>" + n + "</span></button>");
            });
            cont.innerHTML = h.join(""); cont.hidden = false;
        }
        function pintarChips() {
            var cont = q(".fct-chips"), chips = [];
            Object.keys(F.filtros).forEach(function (k) {
                var f = (o.filtros || []).find(function (x) { return x.clave === k; }) || { etiqueta: k };
                chips.push('<span class="ui-chip">' + esc(f.etiqueta) + ": <b>" + esc(textoValor(f, F.filtros[k])) + '</b><button type="button" data-quitar="' + esc(k) + '" aria-label="Quitar filtro">×</button></span>');
            });
            if (chips.length > 1) chips.push('<button type="button" class="xml-enlace" data-quitar="*">Quitar todos</button>');
            cont.innerHTML = chips.join(""); cont.hidden = !chips.length;
            var ins = q("[data-fct=filtros] .xml-insignia");
            if (ins) { ins.hidden = !Object.keys(F.filtros).length; ins.textContent = Object.keys(F.filtros).length; }
        }
        function pintarMenuFiltros() {
            if (!menuF) return;
            menuF.innerHTML = o.filtros.map(function (f) {
                var cuenta = {};
                F.datos.forEach(function (fila) { if (!pasa(fila, f.clave)) return; var v = fila[f.clave]; if (v === "" || v == null) return; cuenta[v] = (cuenta[v] || 0) + 1; });
                var vals = Object.keys(cuenta).sort();
                return '<label class="fct-filtro"><span>' + esc(f.etiqueta) + '</span><select class="ui-select" data-filtro="' + esc(f.clave) + '">' +
                    '<option value="">Todos</option>' + vals.map(function (v) {
                        return '<option value="' + esc(v) + '"' + (F.filtros[f.clave] === v ? " selected" : "") + ">" + esc(textoValor(f, v)) + " (" + cuenta[v] + ")</option>";
                    }).join("") + "</select></label>";
            }).join("") + '<button type="button" class="xml-enlace" data-quitar="*">Quitar todos los filtros</button>';
        }
        function aplicar() {
            var vis = visiblesAhora();
            estado.hidden = true; caja.hidden = false;
            if (!F.datos.length && o.vacio) {
                estado.innerHTML = '<div class="ui-vacio">' + Fiscontable.icono("documento") + "<b>" + esc(o.vacio.titulo || "Sin datos") + "</b><span>" + esc(o.vacio.texto || "") + "</span></div>";
                estado.hidden = false; caja.hidden = true;
            }
            tabla.ponerFilas(vis);
            pintarRapidos(); pintarChips(); if (menuF && !menuF.hidden) pintarMenuFiltros();
            var bx = q("[data-fct=descargar]"); if (bx) bx.disabled = !vis.length;
            if (o.alFiltrar) o.alFiltrar(vis);
        }

        raiz.addEventListener("click", function (e) {
            var b = e.target.closest("[data-fct],[data-rapido],[data-quitar],[data-fct-extra]");
            if (!b) return;
            if (b.dataset.fctExtra !== undefined) { menuD.hidden = true; o.exportar.extras[+b.dataset.fctExtra].accion(tabla.filas()); return; }
            if (b.dataset.rapido !== undefined) { F.rapido = b.dataset.rapido === "" ? null : b.dataset.rapido; aplicar(); return; }
            if (b.dataset.quitar !== undefined) {
                if (b.dataset.quitar === "*") { F.filtros = {}; F.rapido = null; } else delete F.filtros[b.dataset.quitar];
                aplicar(); return;
            }
            var que = b.dataset.fct;
            if (que === "columnas") tabla.abrirPanelColumnas();
            else if (que === "filtros" || que === "vistas" || que === "descargar") {
                e.stopPropagation();
                var m = que === "filtros" ? menuF : que === "vistas" ? menuV : menuD, abrir = m.hidden;
                [menuF, menuV, menuD].forEach(function (x) { if (x) x.hidden = true; });
                if (abrir) { if (que === "filtros") pintarMenuFiltros(); else if (que === "vistas") vistas.pintar(); m.hidden = false; }
            } else if (que === "excel") { if (menuD) menuD.hidden = true; exportar(); }
        });
        if (menuF) {
            menuF.addEventListener("click", function (e) { e.stopPropagation(); });
            menuF.addEventListener("change", function (e) {
                var s = e.target.closest("[data-filtro]"); if (!s) return;
                if (s.value) F.filtros[s.dataset.filtro] = s.value; else delete F.filtros[s.dataset.filtro];
                aplicar(); pintarMenuFiltros();
            });
        }
        document.addEventListener("click", function (e) {
            [menuF, menuV, menuD].forEach(function (m) { if (m && !m.hidden && !m.parentNode.contains(e.target)) m.hidden = true; });
        });
        var bus = q(".fct-buscar"), tBus = null;
        if (bus) bus.addEventListener("input", function () {
            clearTimeout(tBus);
            tBus = setTimeout(function () { F.buscar = bus.value.trim().toLowerCase(); aplicar(); }, 150);
        });

        function columnasExcel() {
            return tabla.columnas().map(function (x) {
                var c = o.catalogo.find(function (k) { return k.clave === x.clave; });
                return c ? { titulo: c.etiqueta, clave: c.clave, tipo: c.tipo === "moneda" ? "moneda" : c.tipo === "fecha" ? "fecha" : "texto" } : null;
            }).filter(Boolean);
        }
        function exportar() {
            var vis = tabla.filas(), cols = columnasExcel(), x = o.exportar;
            var hojas = [{ hoja: x.hoja || "Datos", columnas: cols, filas: vis }];
            if (x.porValor) x.porValor.valores.forEach(function (v) {
                var filas = vis.filter(function (f) { return String(f[x.porValor.clave]) === String(v); });
                if (filas.length) hojas.push({ hoja: String(v), columnas: cols, filas: filas });
            });
            Fiscontable.excel(typeof x.nombre === "function" ? x.nombre() : x.nombre, hojas)
                .catch(function (err) { Fiscontable.toast ? Fiscontable.toast(err.message) : alert(err.message); });
        }

        return {
            tabla: tabla,
            ponerDatos: function (filas) { F.datos = (filas || []).slice(); aplicar(); },
            datos: function () { return F.datos; },
            visibles: function () { return tabla.filas(); },
            filtrar: function (clave, valor) { if (valor === null || valor === "") delete F.filtros[clave]; else F.filtros[clave] = String(valor); aplicar(); },
            rapido: function (valor) { F.rapido = valor === null ? null : String(valor); aplicar(); },
            limpiar: function () { F.filtros = {}; F.rapido = null; F.buscar = ""; if (bus) bus.value = ""; },
            exportar: function () { exportar(); },
            quitarSeleccion: function () { tabla.seleccion.clear(); aplicar(); if (o.alSeleccionar) o.alSeleccionar(tabla.seleccion); },
            cargando: function (texto) {
                caja.hidden = true; estado.hidden = false;
                var filas = ""; for (var i = 0; i < 8; i++) filas += '<span class="ui-skel" style="width:' + (60 + (i * 37) % 40) + '%"></span>';
                estado.innerHTML = '<div class="fct-esqueleto" aria-busy="true">' + (texto ? '<p class="xml-tenue">' + esc(texto) + "</p>" : "") + filas + "</div>";
            },
            error: function (mensaje, reintentar) {
                caja.hidden = true; estado.hidden = false;
                estado.innerHTML = '<div class="ui-falla">' + Fiscontable.icono("alerta") + "<b>No se pudo cargar</b><span>" + esc(mensaje || "") + "</span>" +
                    (reintentar ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32 fct-reintentar">Reintentar</button>' : "") + "</div>";
                var r = estado.querySelector(".fct-reintentar"); if (r) r.addEventListener("click", reintentar);
            },
            mensaje: function (titulo, texto) {
                caja.hidden = true; estado.hidden = false;
                estado.innerHTML = '<div class="ui-vacio">' + Fiscontable.icono("documento") + "<b>" + esc(titulo) + "</b><span>" + esc(texto || "") + "</span></div>";
            }
        };
    }

    window.FCTabla = { crear: crear, menuVistas: menuVistas, formato: formato, estandar: estandar };
})();
