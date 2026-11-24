/*
 * configuracion/cierres.js — Configuración › Cierre de meses (24-nov-2026, decisión D del dueño).
 *
 * Por empresa y mes: cerrado o abierto, quién lo cerró y cuándo; cerrar o abrir con un clic (y una confirmación). Arriba,
 * el aviso de los meses que cerró solo una declaración presentada (nadie los cerró a mano). Es el mismo candado del botón
 * «Cerrar mes» de Marcas fiscales (ese botón es un atajo): el mes cerrado congela las decisiones (marcas, deducibles, ⚙
 * Reglas), no los hechos (una cancelación o un XML que llega después se avisan).
 * Con muchas empresas: buscador y de 12 en 12 (la regla del dueño: nada de listas infinitas).
 * configuracion.js la llama con FcCierres.pintar(caja, {api, enviar}).
 */
(function () {
    "use strict";
    var esc = Fiscontable.escapar;
    var MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    var LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    // de 12 en 12 en la computadora; en el celular cada empresa ocupa más (dos renglones de meses): de 8 en 8
    function porPagina() { return window.innerWidth <= 760 ? 8 : 12; }

    function fecha(iso) {
        if (!iso) return "";
        var d = new Date(String(iso).replace(/Z?$/, "Z"));
        return isNaN(d) ? "" : d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
    }
    function titulo(m, e) {
        var t = LARGOS[m.mes - 1] + ": ";
        if (m.estado === "cerrado") t += "cerrado" + (m.quien ? " por " + m.quien : "") + (m.en ? " el " + fecha(m.en) : "") + (m.por && m.por.length ? " (también tiene " + m.por.join(", ") + " presentada)" : "");
        else if (m.estado === "declaracion") t += "cerrado solo por la declaración presentada (" + m.por.join(", ") + ")";
        else if (m.estado === "abierto_a_mano") t += "abierto a propósito" + (m.quien ? " por " + m.quien : "") + (m.en ? " el " + fecha(m.en) : "") + " (tiene " + m.por.join(", ") + " presentada)";
        else t += m.futuro ? "todavía no empieza" : "abierto";
        return e.nombre + " · " + t;
    }
    function celda(m, e, puede) {
        var clase = "cm-mes cm-mes--" + m.estado + (m.futuro ? " cm-mes--futuro" : "");
        var ico = m.estado === "cerrado" ? "🔒" : m.estado === "declaracion" ? "🧾" : "";
        var t = titulo(m, e);
        var dis = !puede || (m.futuro && !m.cerrado);
        return '<button type="button" class="' + clase + '" data-rfc="' + esc(e.rfc) + '" data-mes="' + m.mes + '" title="' + esc(t) + '" aria-label="' + esc(t) + '"' +
            (dis ? " disabled" : "") + '><span class="cm-mes__nombre">' + MESES[m.mes - 1] + '</span><span class="cm-mes__ico" aria-hidden="true">' + ico + "</span></button>";
    }

    function pintar(c, h) {
        var estado = { anio: null, datos: null, buscar: "", pagina: 0 };
        async function cargar(anio) {
            c.innerHTML = '<div class="cf-tarjeta"><p class="cf-texto">Cargando…</p></div>';
            try { estado.datos = await h.api("/api/fiscal/cierres" + (anio ? "?anio=" + anio : "")); }
            catch (e) { c.innerHTML = '<div class="cf-tarjeta"><p class="cf-msj cf-msj--mal">' + esc(e.message) + "</p></div>"; return; }
            estado.anio = estado.datos.anio;
            dibujar();
        }
        function dibujar() {
            var d = estado.datos, t = estado.buscar.trim().toLowerCase();
            var lista = d.empresas.filter(function (e) { return !t || e.nombre.toLowerCase().indexOf(t) >= 0 || e.rfc.toLowerCase().indexOf(t) >= 0; });
            var paginas = Math.max(1, Math.ceil(lista.length / porPagina()));
            estado.pagina = Math.min(estado.pagina, paginas - 1);
            var ver = lista.slice(estado.pagina * porPagina(), (estado.pagina + 1) * porPagina());
            var html = '<div class="cf-tarjeta"><p class="cf-texto">Un mes cerrado ya no cambia sus <b>decisiones</b>: las marcas fiscales, lo deducible y ⚙ Reglas ' +
                "se quedan como estaban al cerrarlo. Los <b>hechos</b> sí cuentan: si después se cancela un CFDI o llega uno nuevo, se avisa. " +
                "El botón «Cerrar mes» de Marcas fiscales hace lo mismo que aquí.</p>" +
                '<div class="cm-barra"><label class="ui-campo cm-anio"><span class="ui-etiqueta">Año</span><select class="ui-select" data-cm="anio">' +
                d.anios.map(function (a) { return '<option value="' + a + '"' + (a === d.anio ? " selected" : "") + ">" + a + "</option>"; }).join("") + "</select></label>" +
                (d.empresas.length > porPagina() ? '<label class="ui-campo cm-buscar"><span class="ui-etiqueta">Buscar empresa</span><input class="ui-input" data-cm="buscar" type="search" placeholder="Nombre o RFC" autocomplete="off" value="' + esc(estado.buscar) + '"></label>' : "") +
                '<span class="cm-leyenda"><span class="cm-mes cm-mes--cerrado cm-mes--muestra">🔒</span> cerrado · <span class="cm-mes cm-mes--declaracion cm-mes--muestra">🧾</span> solo por una declaración · <span class="cm-mes cm-mes--abierto cm-mes--muestra"></span> abierto</span></div>' +
                '<p class="cf-msj" data-cm="msj"></p></div>';
            if (d.solo_declaracion.length) {
                var porEmpresa = {};
                d.solo_declaracion.forEach(function (x) { (porEmpresa[x.nombre] = porEmpresa[x.nombre] || []).push(LARGOS[x.mes - 1] + " (" + x.por.join(", ") + ")"); });
                html += '<div class="cf-tarjeta cm-aviso"><p><b>' + d.solo_declaracion.length + (d.solo_declaracion.length === 1 ? " mes está cerrado" : " meses están cerrados") +
                    " solo por una declaración presentada</b> (nadie los cerró a mano). Sus marcas ya no cambian. Si hay que corregir algo, ábrelo aquí.</p><ul>" +
                    Object.keys(porEmpresa).slice(0, 8).map(function (n) { return "<li><b>" + esc(n) + "</b>: " + esc(porEmpresa[n].join(", ")) + "</li>"; }).join("") +
                    (Object.keys(porEmpresa).length > 8 ? "<li>… y " + (Object.keys(porEmpresa).length - 8) + " empresa(s) más.</li>" : "") + "</ul></div>";
            }
            if (!d.empresas.length) {
                html += '<div class="cf-tarjeta"><p class="cf-texto"><b>Todavía no hay empresas.</b> Da de alta una en el Directorio para cerrar sus meses.</p></div>';
            } else {
                html += '<div class="cf-tarjeta cm-tabla">' + (ver.length ? ver.map(function (e) {
                    var n = e.meses.filter(function (m) { return m.cerrado; }).length;
                    return '<div class="cm-fila"><div class="cm-empresa"><b>' + esc(e.nombre) + "</b><small>" + esc(e.rfc) + " · " + n + (n === 1 ? " mes cerrado" : " meses cerrados") + "</small></div>" +
                        '<div class="cm-meses">' + e.meses.map(function (m) { return celda(m, e, d.puede_cambiar); }).join("") + "</div></div>";
                }).join("") : '<p class="cf-texto" style="padding:0 4px">Ninguna empresa coincide.</p>') +
                    (paginas > 1 ? '<div class="cm-paginas"><button type="button" class="cf-btn" data-cm="ant"' + (estado.pagina ? "" : " disabled") + '>Anterior</button><span>' +
                        (estado.pagina + 1) + " de " + paginas + '</span><button type="button" class="cf-btn" data-cm="sig"' + (estado.pagina < paginas - 1 ? "" : " disabled") + ">Siguiente</button></div>" : "") +
                    "</div>";
            }
            c.innerHTML = html;
            var sel = c.querySelector('[data-cm="anio"]');
            if (sel) sel.addEventListener("change", function () { estado.pagina = 0; cargar(+this.value); });
            var b = c.querySelector('[data-cm="buscar"]');
            if (b) b.addEventListener("input", function () {
                estado.buscar = this.value; estado.pagina = 0;
                var pos = this.selectionStart; dibujar();
                var nb = c.querySelector('[data-cm="buscar"]'); if (nb) { nb.focus(); try { nb.setSelectionRange(pos, pos); } catch (x) { /* nada */ } }
            });
            var ant = c.querySelector('[data-cm="ant"]'), sig = c.querySelector('[data-cm="sig"]');
            if (ant) ant.addEventListener("click", function () { estado.pagina -= 1; dibujar(); });
            if (sig) sig.addEventListener("click", function () { estado.pagina += 1; dibujar(); });
        }
        function msj(ok, t) {
            var p = c.querySelector('[data-cm="msj"]');
            if (p) { p.textContent = t; p.className = "cf-msj " + (ok ? "cf-msj--ok" : "cf-msj--mal"); }
        }
        c._cm = { estado: estado, cargar: cargar, msj: msj };
        cargar();
        if (c.dataset.cm) return;                  // el clic se escucha una sola vez aunque la sección se vuelva a pintar
        c.dataset.cm = "1";
        c.addEventListener("click", async function (ev) {
            var estado = c._cm.estado, cargar = c._cm.cargar, msj = c._cm.msj;
            var b = ev.target.closest(".cm-mes[data-rfc]");
            if (!b || b.disabled) return;
            var e = estado.datos.empresas.find(function (x) { return x.rfc === b.dataset.rfc; });
            var m = e && e.meses[+b.dataset.mes - 1];
            if (!m) return;
            var cerrar = !m.cerrado, nombreMes = LARGOS[m.mes - 1] + " " + estado.anio;
            var si = await Fiscontable.confirmar(cerrar ? {
                titulo: "¿Cerrar " + nombreMes + "?", si: "Cerrar el mes",
                texto: e.nombre + ": sus marcas fiscales, lo deducible y ⚙ Reglas de ese mes se quedan como están hoy. Lo que pase después (una cancelación, un XML nuevo) se avisa."
            } : {
                titulo: "¿Abrir " + nombreMes + "?", si: "Abrir el mes", peligro: true,
                texto: e.nombre + ": el mes vuelve a calcularse con las marcas y reglas de hoy." + (m.por && m.por.length ? " Ojo: tiene " + m.por.join(", ") + " presentada; sus cifras pueden cambiar." : "")
            });
            if (!si) return;
            b.disabled = true;
            try {
                var r = await h.enviar("/api/fiscal/cierres", "POST", { rfc: e.rfc, anio: estado.anio, mes: m.mes, cerrar: cerrar });
                await cargar(estado.anio);
                msj(true, "✓ " + e.nombre + ": " + (r.texto || (cerrar ? "cerrado" : "abierto")).toLowerCase() + ".");
            } catch (x) { msj(false, x.message); b.disabled = false; }
        });
    }

    window.FcCierres = { pintar: pintar };
})();
