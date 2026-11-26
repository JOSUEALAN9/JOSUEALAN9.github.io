/*
 * configuracion/cierres.js — Configuración › Cierre de meses.
 *
 * 24-nov-2026 (decisión D del dueño): por empresa y mes, cerrado o abierto, quién lo cerró y cuándo, y cerrar o abrir.
 * 25-nov-2026, el dueño (docs/prd/avance3_cierre_y_pin.md):
 *   · «Esa vista está fea, me muestra todas las empresas muy feo»: rediseño. Arriba el año, el buscador y el filtro «Todas /
 *     Con meses abiertos / Con meses cerrados» con un resumen; una fila por empresa con sus 12 meses en casillas chicas
 *     (candado cerrado o abierto; quién y cuándo al pasar el cursor o al tocar); «Cerrar hasta…» por fila y lo mismo para
 *     las empresas marcadas. En el celular (o en una ventana angosta), una tarjeta por empresa con los meses en 4 × 3.
 *   · Cerrar Y abrir piden PIN, una sola vez por operación, con un resumen claro antes (Fiscontable.confirmarIdentidad,
 *     acción «cerrar_mes»). El servidor también lo exige.
 *   · Solo se cierra o abre aquí (Marcas fiscales solo enseña el candado y trae aquí). En un despacho, solo el titular:
 *     los demás ven la tabla con el motivo y, al tocar un mes, quién y cuándo, sin botones.
 * Un mes cerrado congela las decisiones (marcas, deducibles, ⚙ Reglas), no los hechos (una cancelación o un XML que llega
 * después se avisan). configuracion.js la llama con FcCierres.pintar(caja, {api, enviar}). Con &sub=RFC[:año] abre en esa
 * empresa (así llega desde Marcas fiscales).
 */
(function () {
    "use strict";
    var esc = Fiscontable.escapar;
    var CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    var LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    var SVG_ATR = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    var SVG = {
        cerrado: "<svg " + SVG_ATR + '><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
        abierto: "<svg " + SVG_ATR + '><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 017.6-1.8"/></svg>',
        buscar: "<svg " + SVG_ATR + '><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
    };
    var ANGOSTA = 760;                 // por debajo de este ancho de la sección: tarjetas con rejilla de 4 × 3
    function porPagina(angosta) { return angosta ? 6 : 12; }        // que cada página quepa en una pantalla (regla del dueño)
    function mayus(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
    function plural(n, uno, varios) { return n + " " + (n === 1 ? uno : varios); }

    function fecha(iso) {
        if (!iso) return "";
        var d = new Date(String(iso).replace(/Z?$/, "Z"));
        return isNaN(d) ? "" : d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
    }
    /* «enero a marzo, mayo y julio 2026»: los meses en palabras (igual que el servidor, cierres.texto_meses) */
    function textoMeses(meses, anio) {
        meses = meses.slice().sort(function (a, b) { return a - b; });
        var tramos = [], ini = null;
        meses.forEach(function (m, i) {
            if (ini === null) ini = m;
            if (i + 1 === meses.length || meses[i + 1] !== m + 1) {
                if (m - ini >= 2) tramos.push(LARGOS[ini - 1] + " a " + LARGOS[m - 1]);
                else for (var x = ini; x <= m; x++) tramos.push(LARGOS[x - 1]);
                ini = null;
            }
        });
        var t = tramos.length <= 1 ? (tramos[0] || "") : tramos.slice(0, -1).join(", ") + " y " + tramos[tramos.length - 1];
        return anio ? t + " " + anio : t;
    }
    function estadoTexto(m) {
        var quien = m.quien ? " por " + m.quien : "", cuando = m.en ? " el " + fecha(m.en) : "";
        var decl = m.por && m.por.length ? m.por.join(" y ") : "";
        if (m.estado === "cerrado") return "Cerrado" + quien + cuando + "." + (decl ? " También tiene " + decl + " presentada." : "");
        if (m.estado === "declaracion") return "Cerrado solo por la declaración presentada (" + decl + "). Nadie lo cerró a mano.";
        if (m.estado === "abierto_a_mano") return "Abierto a propósito" + quien + cuando + ". Tiene " + decl + " presentada.";
        return m.futuro ? "Todavía no empieza." : "Abierto.";
    }
    function icono(m) { return m.futuro && !m.cerrado ? "" : (m.cerrado ? SVG.cerrado : SVG.abierto); }
    function claseMes(m, hoy, anio) {
        return "cm-mes cm-mes--" + m.estado + (m.futuro && !m.cerrado ? " cm-mes--futuro" : "") +
            (hoy && anio === hoy.anio && m.mes === hoy.mes ? " cm-mes--hoy" : "");
    }
    /* ¿Al día? Cerrados todos los meses que ya terminaron (en el año en curso, hasta el mes pasado; en uno anterior, los 12) */
    function alDia(e, hoy, anio) {
        var hasta = anio < hoy.anio ? 12 : anio === hoy.anio ? hoy.mes - 1 : 0;
        if (hasta < 1) return false;
        for (var i = 0; i < hasta; i++) if (!e.meses[i].cerrado) return false;
        return true;
    }
    function resumenFila(e, hoy, anio) {
        var n = e.meses.filter(function (m) { return m.cerrado; }).length;
        if (!n) return "Ningún mes cerrado";
        var M = 0; while (M < 12 && e.meses[M].cerrado) M++;
        var L = 12; while (L > 0 && !e.meses[L - 1].cerrado) L--;
        var t = M ? "Cerrada hasta " + LARGOS[M - 1] + (L > M ? " · <i>" + LARGOS[M] + " abierto</i>" : "")
                  : plural(n, "mes cerrado", "meses cerrados") + " · <i>enero abierto</i>";
        return (alDia(e, hoy, anio) ? '<span class="cm-aldia">Al día</span> · ' : "") + t;
    }
    function conAbiertos(e) { return e.meses.some(function (m) { return !m.futuro && !m.cerrado; }); }
    function conCerrados(e) { return e.meses.some(function (m) { return m.cerrado; }); }

    /* Lo que cambia una operación (las mismas reglas del servidor, cierres.planear): los meses que ya están como se pide no
       se tocan; nunca se cierra un mes que no ha empezado. pedidos: [{e, meses: [..]}] */
    function planear(pedidos, cerrar) {
        var plan = { cerrar: cerrar, empresas: [], cambian: 0, ya: 0, decl: 0 };
        pedidos.forEach(function (p) {
            var x = { e: p.e, meses: [], ya: [], decl: [] };
            p.meses.forEach(function (n) {
                var m = p.e.meses[n - 1];
                if (!m || (cerrar && m.futuro)) return;
                if (m.cerrado === cerrar) { x.ya.push(n); return; }
                x.meses.push(n);
                if (m.por && m.por.length) x.decl.push(n);
            });
            plan.ya += x.ya.length;
            if (!x.meses.length) return;
            plan.empresas.push(x); plan.cambian += x.meses.length; plan.decl += x.decl.length;
        });
        return plan;
    }
    function rango(modo, mes) {
        var r = [];
        for (var i = 1; i <= 12; i++) if (modo === "cerrar" ? i <= mes : i >= mes) r.push(i);
        return r;
    }

    function pintar(c, h) {
        var hoyLocal = new Date();
        var E = { anio: null, datos: null, buscar: "", filtro: "todas", pagina: 0, marcadas: {}, angosta: false, msj: null, verDecl: false,
                  sub: (Fiscontable.url("sub") || "").toUpperCase(), hoy: { anio: hoyLocal.getFullYear(), mes: hoyLocal.getMonth() + 1 } };
        c._cm = E;
        var pop = null;

        /* ------------------------------------------------ datos */
        async function cargar(anio) {
            cerrarPop();
            if (!E.datos) c.innerHTML = '<div class="cf-tarjeta"><span class="ui-skel" style="width:40%"></span><span class="ui-skel" style="width:70%;margin-top:12px"></span></div>';
            try { var d = await h.api("/api/fiscal/cierres" + (anio ? "?anio=" + anio : "")); }
            catch (e) { c.innerHTML = '<div class="cf-tarjeta"><div class="ui-falla"><b>No se pudo cargar</b><span>' + esc(e.message) + "</span></div></div>"; return; }
            if (c._cm !== E) return;                       // se volvió a pintar la sección mientras cargaba
            E.datos = d; E.anio = d.anio; E.hoy = d.hoy || E.hoy;
            Object.keys(E.marcadas).forEach(function (r) { if (!d.empresas.some(function (e) { return e.rfc === r; })) delete E.marcadas[r]; });
            if (E.sub) {                                   // desde Marcas fiscales: esa empresa
                var rfc = E.sub.split(":")[0], e = d.empresas.filter(function (x) { return x.rfc === rfc; })[0];
                E.buscar = e ? e.nombre : rfc; E.sub = "";
            }
            dibujar();
        }
        function empresa(rfc) { return E.datos.empresas.filter(function (e) { return e.rfc === rfc; })[0]; }
        function buscadas() {
            var t = E.buscar.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            return E.datos.empresas.filter(function (e) {
                return !t || e.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").indexOf(t) >= 0 || e.rfc.toLowerCase().indexOf(t) >= 0;
            });
        }
        function filtradas() {
            return buscadas().filter(function (e) { return E.filtro === "abiertos" ? conAbiertos(e) : E.filtro === "cerrados" ? conCerrados(e) : true; });
        }
        function marcadas() { return E.datos.empresas.filter(function (e) { return E.marcadas[e.rfc]; }); }

        /* ------------------------------------------------ pintar */
        function dibujar() {
            var d = E.datos;
            var nota = d.puede_cambiar ? "" : '<p class="cf-solo-titular" role="note">' + esc(d.motivo || "Solo puedes ver los meses cerrados.") + "</p>";
            var barra = '<div class="cf-tarjeta cm-barra"><div class="cm-filtros">' +
                '<label class="ui-campo cm-anio"><span class="ui-etiqueta">Año</span><select class="ui-select" data-cm="anio">' +
                d.anios.map(function (a) { return '<option value="' + a + '"' + (a === d.anio ? " selected" : "") + ">" + a + "</option>"; }).join("") + "</select></label>" +
                '<label class="ui-campo cm-buscar"><span class="ui-etiqueta">Empresa</span><span class="cm-buscar__caja">' + SVG.buscar +
                '<input class="ui-input" data-cm="buscar" type="search" placeholder="Nombre o RFC" autocomplete="off" value="' + esc(E.buscar) + '"></span></label>' +
                '<div class="ui-campo cm-mostrar"><span class="ui-etiqueta">Mostrar</span><div class="ctx-segmento cm-segmento" role="group" aria-label="Qué empresas mostrar">' +
                [["todas", "Todas"], ["abiertos", 'Con <span class="cm-largo">meses </span>abiertos'], ["cerrados", 'Con <span class="cm-largo">meses </span>cerrados']].map(function (f) {
                    return '<button type="button" data-filtro="' + f[0] + '" aria-pressed="' + (E.filtro === f[0]) + '">' + f[1] + ' <b data-cuenta="' + f[0] + '"></b></button>';
                }).join("") + "</div></div></div>" +
                '<div class="cm-resumen"><span class="cm-resumen__datos" data-cm="resumen"></span>' +
                '<p data-globo data-globo-nombre="Qué hace cerrar un mes">Un mes cerrado ya no cambia sus <b>decisiones</b>: ' +
                "las marcas fiscales, lo deducible y ⚙ Reglas se quedan como estaban al cerrarlo. Los <b>hechos</b> sí cuentan: si después se cancela un CFDI o llega uno nuevo, se avisa. " +
                "Una declaración presentada en Impuestos estatales cierra su mes sola. Cerrar y abrir piden tu PIN.</p></div></div>";
            c.innerHTML = '<div class="cm' + (E.angosta ? " cm--angosta" : "") + '">' + nota + barra +
                '<div class="cm-decl" data-cm="decl" hidden></div>' +
                '<div class="cf-tarjeta cm-lista' + (d.puede_cambiar ? "" : " cm-sin-check") + '" data-cm="lista"></div>' +
                '<div class="cm-seleccion" data-cm="sel" role="region" aria-label="Empresas marcadas" hidden></div></div>';
            resumen();
            Fiscontable.globos && Fiscontable.globos(c);
            lista();
        }
        function resumen() {
            var d = E.datos, todas = buscadas();
            c.querySelectorAll("[data-cuenta]").forEach(function (b) {
                var f = b.dataset.cuenta;
                b.textContent = todas.filter(function (e) { return f === "abiertos" ? conAbiertos(e) : f === "cerrados" ? conCerrados(e) : true; }).length;
            });
            var aldia = d.empresas.filter(function (e) { return alDia(e, E.hoy, E.anio); }).length;
            var abiertas = d.empresas.filter(conAbiertos).length;
            var hasta = E.anio < E.hoy.anio ? "diciembre" : E.anio === E.hoy.anio && E.hoy.mes > 1 ? LARGOS[E.hoy.mes - 2] : "";
            var r = c.querySelector('[data-cm="resumen"]');
            r.innerHTML = (d.empresas.length ? '<span class="cm-dato cm-dato--ok"><span><b>' + aldia + "</b> de " + d.empresas.length + " al día" +
                (hasta ? " (cerradas hasta " + hasta + ")" : "") + "</span></span>" +
                '<span class="cm-dato cm-dato--abierto"><span><b>' + abiertas + "</b> con meses abiertos</span></span>" +
                '<span class="cm-dato"><span><b>' + d.cerrados + "</b> " + (d.cerrados === 1 ? "mes cerrado" : "meses cerrados") + " en " + E.anio + "</span></span>" : "") +
                (d.solo_declaracion.length ? '<span class="cm-dato cm-dato--decl"><span><b>' + d.solo_declaracion.length + "</b> " +
                    (d.solo_declaracion.length === 1 ? "cerrado solo por una declaración" : "cerrados solo por una declaración") +
                    ' · <button type="button" data-cm="ver-decl" aria-expanded="' + E.verDecl + '">' + (E.verDecl ? "Ocultar" : "Ver cuáles") + "</button></span></span>" : "");
            var caja = c.querySelector('[data-cm="decl"]');
            caja.hidden = !(E.verDecl && d.solo_declaracion.length);
            if (!caja.hidden) {
                var porEmpresa = {};
                d.solo_declaracion.forEach(function (x) { (porEmpresa[x.nombre] = porEmpresa[x.nombre] || []).push(LARGOS[x.mes - 1] + " (" + x.por.join(", ") + ")"); });
                var nombres = Object.keys(porEmpresa);
                caja.innerHTML = "<b>Nadie los cerró a mano:</b> los cerró una declaración presentada, así que sus marcas ya no cambian. " +
                    (d.puede_cambiar ? "Si hay que corregir algo, toca el mes para abrirlo." : "") + "<ul>" +
                    nombres.slice(0, 8).map(function (n) { return "<li><b>" + esc(n) + "</b>: " + esc(porEmpresa[n].join(", ")) + "</li>"; }).join("") +
                    (nombres.length > 8 ? "<li>… y " + plural(nombres.length - 8, "empresa más", "empresas más") + ".</li>" : "") + "</ul>";
            }
        }
        function celdas(e, d) {
            return e.meses.map(function (m) {
                var t = mayus(LARGOS[m.mes - 1]) + " " + E.anio + ": " + estadoTexto(m);
                return '<button type="button" class="' + claseMes(m, E.hoy, E.anio) + '" data-mes="' + m.mes + '" title="' + esc(t) + '" aria-label="' + esc(e.nombre + " · " + t) + '">' +
                    '<span class="cm-mes__nombre">' + CORTOS[m.mes - 1] + "</span>" + icono(m) + "</button>";
            }).join("");
        }
        function lista() {
            var d = E.datos, caja = c.querySelector('[data-cm="lista"]');
            if (!caja) return;
            if (!d.empresas.length) {
                caja.innerHTML = '<div class="ui-vacio cm-vacio"><b>Todavía no hay empresas</b><span>Da de alta una en Clientes para cerrar sus meses.</span></div>';
                return seleccion();
            }
            var todas = filtradas(), pp = porPagina(E.angosta);
            var paginas = Math.max(1, Math.ceil(todas.length / pp));
            E.pagina = Math.max(0, Math.min(E.pagina, paginas - 1));
            var ver = todas.slice(E.pagina * pp, (E.pagina + 1) * pp);
            var todasPagina = ver.length && ver.every(function (e) { return E.marcadas[e.rfc]; });
            var html = E.msj ? '<div class="ui-aviso ui-aviso--' + (E.msj.ok ? "ok" : "error") + ' cm-msj" role="status">' + esc(E.msj.texto) + "</div>" : "";
            if (d.puede_cambiar && ver.length) {
                html += '<label class="ui-check cm-marcar-pagina"><input type="checkbox" data-cm="pagina"' + (todasPagina ? " checked" : "") + "> Marcar las de esta página</label>";
            }
            html += '<div class="cm-cab"><span class="cm-check">' + (d.puede_cambiar ? '<input type="checkbox" data-cm="pagina" aria-label="Marcar las de esta página"' + (todasPagina ? " checked" : "") + ">" : "") +
                "</span><span>Empresa</span><span class=\"cm-meses\">" + CORTOS.map(function (n, i) {
                    return "<span" + (E.anio === E.hoy.anio && i + 1 === E.hoy.mes ? ' class="cm-hoy" title="Mes en curso"' : "") + ">" + n + "</span>";
                }).join("") + "</span><span></span></div>";
            html += ver.length ? ver.map(function (e) {
                var marcada = !!E.marcadas[e.rfc];
                return '<div class="cm-fila' + (marcada ? " cm-fila--marcada" : "") + '" data-rfc="' + esc(e.rfc) + '">' +
                    '<span class="cm-check">' + (d.puede_cambiar ? '<input type="checkbox" data-cm="marcar" aria-label="Marcar ' + esc(e.nombre) + '"' + (marcada ? " checked" : "") + ">" : "") + "</span>" +
                    '<div class="cm-empresa"><b title="' + esc(e.nombre) + '">' + esc(e.nombre) + "</b><small>" + esc(e.rfc) + " · " + resumenFila(e, E.hoy, E.anio) + "</small></div>" +
                    '<div class="cm-meses" role="group" aria-label="Meses de ' + esc(e.nombre) + '">' + celdas(e, d) + "</div>" +
                    '<div class="cm-accion">' + (d.puede_cambiar ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-cm="hasta" aria-haspopup="dialog">Cerrar hasta… ▾</button>' : "") + "</div></div>";
            }).join("") : '<div class="ui-vacio cm-vacio"><b>Ninguna empresa coincide</b><span>' +
                (E.filtro !== "todas" ? "Prueba con «Todas» o con otro nombre." : "Prueba con otro nombre o RFC.") + "</span></div>";
            var desde = todas.length ? E.pagina * pp + 1 : 0, hastaN = Math.min(todas.length, (E.pagina + 1) * pp);
            html += '<div class="cm-pie"><div class="cm-leyenda">' +
                '<span><i class="cm-mes cm-mes--cerrado">' + SVG.cerrado + "</i>Cerrado</span>" +
                (d.solo_declaracion.length || E.verDecl ? '<span><i class="cm-mes cm-mes--declaracion">' + SVG.cerrado + "</i>Por una declaración</span>" : "") +
                '<span><i class="cm-mes cm-mes--abierto">' + SVG.abierto + "</i>Abierto</span>" +
                (d.empresas.some(function (e) { return e.meses.some(function (m) { return m.estado === "abierto_a_mano"; }); }) ?
                    '<span><i class="cm-mes cm-mes--abierto_a_mano">' + SVG.abierto + "</i>Abierto con declaración</span>" : "") +
                '<span><i class="cm-mes cm-mes--abierto cm-mes--futuro"></i>Aún no empieza</span></div>' +
                (paginas > 1 ? '<div class="cm-paginas"><button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-cm="ant"' + (E.pagina ? "" : " disabled") + ">‹ Anterior</button>" +
                    "<span>" + desde + "–" + hastaN + " de " + todas.length + "</span>" +
                    '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-cm="sig"' + (E.pagina < paginas - 1 ? "" : " disabled") + ">Siguiente ›</button></div>"
                    : '<div class="cm-paginas"><span>' + plural(todas.length, "empresa", "empresas") + "</span></div>") + "</div>";
            caja.innerHTML = html;
            seleccion();
        }
        function seleccion() {
            var bar = c.querySelector('[data-cm="sel"]');
            if (!bar) return;
            var n = marcadas().length, coinciden = filtradas().filter(function (e) { return !E.marcadas[e.rfc]; }).length;
            bar.hidden = !(E.datos.puede_cambiar && n);
            if (bar.hidden) return;
            // en el ambiente de pruebas, el letrero morado va fijo abajo: la barra se queda encima de él, no detrás
            var amb = document.getElementById("fc-ambiente");
            bar.style.bottom = amb && amb.offsetHeight ? (amb.offsetHeight + 20) + "px" : "";
            bar.innerHTML = "<span>" + plural(n, "empresa marcada", "empresas marcadas") + "</span>" +
                (coinciden ? '<button type="button" class="cm-seleccion__enlace" data-cm="marcar-todas">Marcar todas las de la lista (' + filtradas().length + ")</button>" : "") +
                '<button type="button" class="cm-seleccion__enlace" data-cm="desmarcar">Quitar marcas</button>' +
                '<span class="cm-seleccion__acciones"><button type="button" class="ui-btn ui-btn--primario ui-btn--32" data-cm="sel-cerrar" aria-haspopup="dialog">Cerrar hasta… ▾</button>' +
                '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-cm="sel-abrir" aria-haspopup="dialog">Abrir desde… ▾</button></span>';
        }

        /* ------------------------------------------------ ventanitas */
        function cerrarPop() {
            previa(null);
            if (pop) { pop.remove(); pop = null; }
        }
        function abrirPop(html, ancla, clase) {
            cerrarPop();
            pop = document.createElement("div");
            pop.className = "cm-pop" + (clase ? " " + clase : "");
            pop.setAttribute("role", "dialog");
            pop.innerHTML = html;
            document.body.appendChild(pop);
            pop._ancla = ancla;
            colocar();
            var foco = pop.querySelector("button:not(:disabled)");
            if (foco && !matchMedia("(hover: hover)").matches) foco.focus({ preventScroll: true });
            return pop;
        }
        /* Junto a lo que se tocó, sin salirse de la pantalla (abajo; si no cabe, arriba). Al desplazar la página la ventanita
           sigue a su casilla; si la casilla sale de la pantalla, se cierra. */
        function colocar() {
            if (!pop) return;
            var r = pop._ancla.getBoundingClientRect(), w = pop.offsetWidth, alto = pop.offsetHeight;
            if (r.bottom < 0 || r.top > window.innerHeight || !pop._ancla.isConnected) return cerrarPop();
            var x = Math.min(Math.max(16, r.left + r.width / 2 - w / 2), window.innerWidth - 16 - w);
            var y = r.bottom + 8;
            if (y + alto > window.innerHeight - 12 && r.top - 8 - alto > 12) y = r.top - 8 - alto;
            pop.style.left = Math.max(16, x) + "px"; pop.style.top = Math.max(12, Math.min(y, window.innerHeight - alto - 12)) + "px";
        }
        /* El detalle de un mes (al tocarlo): estado, quién y cuándo, y cerrarlo o abrirlo si se puede */
        function popMes(e, m, ancla) {
            var d = E.datos, html = '<p class="cm-pop__titulo">' + mayus(LARGOS[m.mes - 1]) + " " + E.anio + '</p><p class="cm-pop__empresa">' + esc(e.nombre) + "</p>" +
                '<p class="cm-pop__estado"><i class="' + claseMes(m) + '">' + icono(m) + "</i><span>" + esc(estadoTexto(m)) + "</span></p>";
            if (!d.puede_cambiar) {
                html += '<p class="cm-pop__nota">' + esc(d.motivo || "") + "</p>";
            } else if (m.futuro && !m.cerrado) {
                html += '<p class="cm-pop__nota">Se puede cerrar cuando empiece el mes.</p>';
            } else if (m.cerrado) {
                html += '<div class="cm-pop__acciones"><button type="button" class="ui-btn ui-btn--peligro ui-btn--32" data-pop="abrir">Abrir este mes…</button></div>' +
                    '<p class="cm-pop__nota">' + (m.por && m.por.length ? "Tiene " + esc(m.por.join(" y ")) + " presentada: si lo abres, sus cifras pueden cambiar. " : "") +
                    "Vuelve a calcularse con las marcas y reglas de hoy.</p>";
            } else {
                var antes = e.meses.slice(0, m.mes - 1).filter(function (x) { return !x.cerrado; }).length;
                html += '<div class="cm-pop__acciones"><button type="button" class="ui-btn ui-btn--primario ui-btn--32" data-pop="cerrar">Cerrar este mes…</button>' +
                    (antes ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-pop="hasta">Cerrar de enero a ' + LARGOS[m.mes - 1] + " · " + plural(antes + 1, "mes", "meses") + "…</button>" : "") +
                    '</div><p class="cm-pop__nota">Sus marcas, lo deducible y ⚙ Reglas se quedan como están hoy.</p>';
            }
            var p = abrirPop(html, ancla);
            p.addEventListener("click", function (ev) {
                var b = ev.target.closest("[data-pop]");
                if (!b) return;
                cerrarPop();
                if (b.dataset.pop === "cerrar") confirmar(planear([{ e: e, meses: [m.mes] }], true), { mes: m.mes });
                else if (b.dataset.pop === "abrir") confirmar(planear([{ e: e, meses: [m.mes] }], false), { mes: m.mes });
                else confirmar(planear([{ e: e, meses: rango("cerrar", m.mes) }], true), { hasta: m.mes });
            });
        }
        /* Elegir «hasta qué mes» se cierra (o «desde qué mes» se abre) para una empresa o para las marcadas */
        function popElegir(empresas, modo, ancla) {
            function cuantos(mes, md) { return planear(empresas.map(function (e) { return { e: e, meses: rango(md, mes) }; }), md === "cerrar").cambian; }
            function html(md) {
                return '<div class="ctx-segmento" role="group" aria-label="Qué hacer"><button type="button" data-modo="cerrar" aria-pressed="' + (md === "cerrar") + '">Cerrar hasta…</button>' +
                    '<button type="button" data-modo="abrir" aria-pressed="' + (md === "abrir") + '">Abrir desde…</button></div>' +
                    '<p class="cm-pop__titulo">' + (md === "cerrar" ? "Cerrar de enero hasta…" : "Abrir desde… hasta diciembre") + "</p>" +
                    '<p class="cm-pop__empresa">' + (empresas.length === 1 ? esc(empresas[0].nombre) : plural(empresas.length, "empresa marcada", "empresas marcadas")) + " · " + E.anio + "</p>" +
                    '<div class="cm-rejilla">' + CORTOS.map(function (n, i) {
                        var futuro = E.anio > E.hoy.anio || (E.anio === E.hoy.anio && i + 1 > E.hoy.mes);
                        var k = md === "cerrar" && futuro ? 0 : cuantos(i + 1, md);
                        return '<button type="button" data-elegir="' + (i + 1) + '"' + (k ? "" : " disabled") + ' title="' +
                            esc(k ? (md === "cerrar" ? "Cierra " : "Abre ") + plural(k, "mes", "meses") : md === "cerrar" && futuro ? "Todavía no empieza" :
                                "No hay nada que " + (md === "cerrar" ? "cerrar" : "abrir")) + '">' + n + "</button>";
                    }).join("") + "</div>" +
                    '<p class="cm-pop__nota">' + (md === "cerrar" ? "Los meses que ya están cerrados no se tocan. Te pedimos tu PIN una vez." :
                        "Abre ese mes y los que siguen. Te pedimos tu PIN una vez.") + "</p>";
            }
            var p = abrirPop(html(modo), ancla), md = modo;
            p.addEventListener("click", function (ev) {
                var b = ev.target.closest("[data-modo]");
                if (b) { md = b.dataset.modo; p.innerHTML = html(md); return; }
                var x = ev.target.closest("[data-elegir]");
                if (!x || x.disabled) return;
                var mes = +x.dataset.elegir;
                cerrarPop();
                confirmar(planear(empresas.map(function (e) { return { e: e, meses: rango(md, mes) }; }), md === "cerrar"), md === "cerrar" ? { hasta: mes } : { desde: mes });
            });
            p.addEventListener("mouseover", function (ev) {
                var x = ev.target.closest("[data-elegir]");
                previa(x && !x.disabled ? { rfcs: empresas.map(function (e) { return e.rfc; }), modo: md, mes: +x.dataset.elegir } : null);
            });
            p.addEventListener("mouseleave", function () { previa(null); });
        }
        /* Al pasar el cursor por un mes de la rejilla, se ven en la tabla los meses que cambiarían */
        function previa(o) {
            c.querySelectorAll(".cm-mes--previa, .cm-mes--previa-abrir").forEach(function (b) { b.classList.remove("cm-mes--previa", "cm-mes--previa-abrir"); });
            if (!o) return;
            o.rfcs.forEach(function (rfc) {
                var fila = c.querySelector('.cm-fila[data-rfc="' + rfc + '"]'), e = empresa(rfc);
                if (!fila || !e) return;
                var p = planear([{ e: e, meses: rango(o.modo, o.mes) }], o.modo === "cerrar");
                (p.empresas[0] ? p.empresas[0].meses : []).forEach(function (n) {
                    var b = fila.querySelector('.cm-mes[data-mes="' + n + '"]');
                    if (b) b.classList.add(o.modo === "cerrar" ? "cm-mes--previa" : "cm-mes--previa-abrir");
                });
            });
        }

        /* ------------------------------------------------ el resumen y el PIN (una vez por operación) */
        function confirmar(plan, como) {
            if (!plan.cambian) return;
            var cerrar = plan.cerrar, verbo = cerrar ? "cerrar" : "abrir", una = plan.empresas.length === 1 ? plan.empresas[0] : null;
            var cuantos = plural(plan.cambian, "mes", "meses");
            var titulo = una && plan.cambian === 1 ? mayus(verbo) + " " + LARGOS[una.meses[0] - 1] + " " + E.anio : mayus(verbo) + " meses de " + E.anio;
            var html = '<div class="cm-resumen-pin">';
            if (una) {
                html += "<p>Vas a <b>" + verbo + " " + (plan.cambian === 1 ? LARGOS[una.meses[0] - 1] + " " + E.anio : cuantos) + "</b> de <b>" + esc(una.e.nombre) + "</b>" +
                    (plan.cambian > 1 ? ": " + esc(textoMeses(una.meses, E.anio)) : "") + ".</p>";
                if (una.ya.length) html += '<p class="cm-resumen-pin__chico">' + esc(mayus(textoMeses(una.ya))) + (una.ya.length === 1 ? " ya estaba " : " ya estaban ") +
                    (cerrar ? (una.ya.length === 1 ? "cerrado" : "cerrados") : (una.ya.length === 1 ? "abierto" : "abiertos")) + ": no se toca" + (una.ya.length === 1 ? "" : "n") + ".</p>";
            } else {
                html += "<p>Vas a <b>" + verbo + " " + cuantos + "</b> de <b>" + plural(plan.empresas.length, "empresa", "empresas") + "</b>" +
                    (como.hasta ? " (de enero hasta " + LARGOS[como.hasta - 1] + ")" : como.desde ? " (de " + LARGOS[como.desde - 1] + " en adelante)" : "") + ".</p>" +
                    '<div class="fc-identidad__tabla"><table><thead><tr><th>Empresa</th><th>Meses que se ' + (cerrar ? "cierran" : "abren") + "</th></tr></thead><tbody>" +
                    plan.empresas.map(function (x) { return "<tr><td>" + esc(x.e.nombre) + "</td><td>" + esc(mayus(textoMeses(x.meses))) + "</td></tr>"; }).join("") +
                    "</tbody>" + '<tfoot><tr><td>Total</td><td>' + cuantos + "</td></tr></tfoot></table></div>";
                if (plan.ya) html += '<p class="cm-resumen-pin__chico">' + plural(plan.ya, "mes ya estaba ", "meses ya estaban ") +
                    (cerrar ? (plan.ya === 1 ? "cerrado" : "cerrados") : (plan.ya === 1 ? "abierto" : "abiertos")) + ": no se toca" + (plan.ya === 1 ? "" : "n") + ".</p>";
            }
            html += cerrar ? '<p class="cm-resumen-pin__chico">Sus marcas fiscales, lo deducible y ⚙ Reglas se quedan como están hoy. Si después se cancela un CFDI o llega uno nuevo, se avisa.</p>'
                : '<p class="cm-resumen-pin__chico">Vuelven a calcularse con las marcas y reglas de hoy.</p>' +
                  (plan.decl ? '<p class="cm-resumen-pin__ojo">Ojo: ' + (plan.decl === 1 ? "uno de esos meses tiene" : plural(plan.decl, "mes tiene", "meses tienen")) +
                      " una declaración presentada; sus cifras pueden cambiar. Si cambias algo, revisa si toca una complementaria.</p>" : "");
            html += "</div>";
            var respuesta = null;
            Fiscontable.confirmarIdentidad("cerrar_mes", async function (conf) {
                respuesta = await h.enviar("/api/fiscal/cierres/varios", "POST", {
                    anio: E.anio, cerrar: cerrar, confirmacion: conf,
                    empresas: plan.empresas.map(function (x) { return { rfc: x.e.rfc, meses: x.meses }; })
                });
            }, { titulo: titulo, resumen: html, boton: mayus(verbo) + " " + cuantos, peligro: !cerrar }).then(async function (hecho) {
                if (!hecho) return;
                if (plan.empresas.length > 1) E.marcadas = {};
                E.msj = { ok: true, texto: "✓ " + ((respuesta && respuesta.texto) || (cerrar ? "Listo: se cerraron." : "Listo: se abrieron.")) };
                await cargar(E.anio);
            });
        }

        /* ------------------------------------------------ eventos (uno solo por contenedor, aunque la sección se repinte) */
        if (!c.dataset.cm) {
            c.dataset.cm = "1";
            c.addEventListener("click", function (ev) { if (c._cm && c._cm.clic) c._cm.clic(ev); });
            c.addEventListener("change", function (ev) { if (c._cm && c._cm.cambio) c._cm.cambio(ev); });
            c.addEventListener("input", function (ev) { if (c._cm && c._cm.escribe) c._cm.escribe(ev); });
            document.addEventListener("mousedown", function (ev) { if (c._cm && c._cm.fuera) c._cm.fuera(ev); }, true);
            document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && c._cm && c._cm.cerrarPop) c._cm.cerrarPop(); });
            window.addEventListener("resize", function () { if (c._cm && c._cm.medir) c._cm.medir(); });
            window.addEventListener("scroll", function () { if (c._cm && c._cm.colocar) c._cm.colocar(); }, true);
            if (window.ResizeObserver) new ResizeObserver(function () { if (c._cm && c._cm.medir) c._cm.medir(); }).observe(c);
        }
        E.cerrarPop = cerrarPop; E.colocar = colocar;
        E.fuera = function (ev) { if (pop && !pop.contains(ev.target) && ev.target !== pop._ancla && !(pop._ancla && pop._ancla.contains(ev.target))) cerrarPop(); };
        E.medir = function () {
            var angosta = c.clientWidth > 0 && c.clientWidth < ANGOSTA;
            if (angosta === E.angosta) return;
            E.angosta = angosta;
            cerrarPop();
            var raiz = c.querySelector(".cm");
            if (raiz) { raiz.classList.toggle("cm--angosta", angosta); lista(); }
        };
        E.clic = function (ev) {
            if (!E.datos) return;
            var t = ev.target, b;
            if ((b = t.closest("[data-filtro]"))) {
                E.filtro = b.dataset.filtro; E.pagina = 0;
                c.querySelectorAll("[data-filtro]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
                return lista();
            }
            if ((b = t.closest('[data-cm="ver-decl"]'))) { E.verDecl = !E.verDecl; resumen(); return lista(); }
            if ((b = t.closest('[data-cm="ant"]'))) { E.pagina -= 1; cerrarPop(); return lista(); }
            if ((b = t.closest('[data-cm="sig"]'))) { E.pagina += 1; cerrarPop(); return lista(); }
            if ((b = t.closest(".cm-fila .cm-mes"))) {
                var e = empresa(b.closest(".cm-fila").dataset.rfc);
                if (pop && pop._ancla === b) return cerrarPop();
                return popMes(e, e.meses[+b.dataset.mes - 1], b);
            }
            if ((b = t.closest('[data-cm="hasta"]'))) {
                if (pop && pop._ancla === b) return cerrarPop();
                return popElegir([empresa(b.closest(".cm-fila").dataset.rfc)], "cerrar", b);
            }
            if ((b = t.closest('[data-cm="sel-cerrar"], [data-cm="sel-abrir"]'))) {
                if (pop && pop._ancla === b) return cerrarPop();
                return popElegir(marcadas(), b.dataset.cm === "sel-cerrar" ? "cerrar" : "abrir", b);
            }
            if ((b = t.closest('[data-cm="marcar-todas"]'))) { filtradas().forEach(function (e) { E.marcadas[e.rfc] = true; }); return lista(); }
            if ((b = t.closest('[data-cm="desmarcar"]'))) { E.marcadas = {}; cerrarPop(); return lista(); }
        };
        E.cambio = function (ev) {
            var t = ev.target;
            if (t.matches('[data-cm="anio"]')) { E.pagina = 0; E.msj = null; return cargar(+t.value); }
            if (t.matches('[data-cm="marcar"]')) {
                var rfc = t.closest(".cm-fila").dataset.rfc;
                if (t.checked) E.marcadas[rfc] = true; else delete E.marcadas[rfc];
                t.closest(".cm-fila").classList.toggle("cm-fila--marcada", t.checked);
                c.querySelectorAll('[data-cm="pagina"]').forEach(function (x) {
                    x.checked = Array.prototype.every.call(c.querySelectorAll('[data-cm="marcar"]'), function (y) { return y.checked; });
                });
                return seleccion();
            }
            if (t.matches('[data-cm="pagina"]')) {
                c.querySelectorAll(".cm-fila[data-rfc]").forEach(function (f) { if (t.checked) E.marcadas[f.dataset.rfc] = true; else delete E.marcadas[f.dataset.rfc]; });
                return lista();
            }
        };
        E.escribe = function (ev) {
            if (!ev.target.matches('[data-cm="buscar"]')) return;
            E.buscar = ev.target.value; E.pagina = 0;
            resumen(); lista();
        };

        /* ------------------------------------------------ al volver a la pestaña (26-nov-2026, el dueño, k4: «lo cerré en la compu,
           fui en el celular y no se había cerrado, actualicé con F5 y ya apareció»). Se vuelve a pedir la tabla al regresar y cada
           90 s mientras se ve (Fiscontable.alVolver); solo se repinta si cambió, sin tocar el año, la búsqueda, el filtro, la página
           ni las marcadas. Con una ventanita o el PIN abiertos espera a la siguiente vez. */
        async function refrescar() {
            if (!E.datos || c._cm !== E || pop || document.querySelector("dialog[open]")) return;
            var d;
            try { d = await h.api("/api/fiscal/cierres?anio=" + E.anio); } catch (e) { return; }
            if (c._cm !== E || !E.datos || !d || d.anio !== E.anio || pop || JSON.stringify(d) === JSON.stringify(E.datos)) return;
            var todo = d.puede_cambiar !== E.datos.puede_cambiar || d.motivo !== E.datos.motivo || String(d.anios) !== String(E.datos.anios);
            E.datos = d; E.hoy = d.hoy || E.hoy;
            Object.keys(E.marcadas).forEach(function (r) { if (!d.empresas.some(function (e) { return e.rfc === r; })) delete E.marcadas[r]; });
            if (todo) dibujar(); else { resumen(); lista(); }
        }
        var vuelta = Fiscontable.alVolver && Fiscontable.alVolver(function () {
            if (!c.isConnected || c._cm !== E) { vuelta.parar(); return; }          // ya se fue a otra sección
            return refrescar();
        });

        E.angosta = c.clientWidth > 0 ? c.clientWidth < ANGOSTA : window.innerWidth <= ANGOSTA;
        var sub = E.sub.split(":")[1];
        cargar(sub && /^\d{4}$/.test(sub) ? +sub : 0);
    }

    window.FcCierres = { pintar: pintar };
})();
