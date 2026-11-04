/*
 * herramientas/xml/fiscal.js — Marcas fiscales de los CFDI: para qué impuesto cuenta cada uno, cuánto y por qué.
 * Casi todo lo marcan las reglas (con su motivo); la persona revisa «Por revisar» y, si quiere, marca a mano
 * (una o varias) y le dice a Fiscontable que lo aprenda para el proveedor/cliente o la clave de producto.
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    var q = new URLSearchParams(location.search);
    var E = { cat: null, empresas: [], rfc: null, anio: null, mes: null, lado: q.get("lado") === "recibidos" ? "recibidos" : "emitidos",
              datos: null, filtro: q.get("filtro") === "revisar" ? "revisar" : "todos", sel: new Set(), buscar: "" };

    async function api(ruta, opciones) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function enviar(ruta, metodo, cuerpo) { return api(ruta, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }); }
    function m(v) { return (v < 0 ? "−$" : "$") + Math.abs(Number(v) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function aviso(t, mal) { var a = $("aviso"); a.innerHTML = t || ""; a.className = "isn-aviso" + (mal ? " isn-aviso--error" : ""); a.hidden = !t; }
    function nombre(imp) { return (E.cat && E.cat.impuestos[imp]) || imp; }

    /* ------------------------------------------------------------ inicio */
    async function iniciar() {
        if (!(await Fiscontable.exigirModulo("validador"))) return;
        try { E.cat = await api("/api/fiscal/catalogos"); } catch (e) { aviso(esc(e.message), true); return; }
        try { E.empresas = await api("/api/xml/contribuyentes"); } catch (e) { E.empresas = []; }
        var activa = await Fiscontable.empresaActiva();
        E.rfc = (q.get("rfc") || q.get("empresa") || (activa && activa.rfc) || (E.empresas[0] && E.empresas[0].rfc) || "").toUpperCase() || null;
        var hoy = new Date(); hoy.setDate(1); hoy.setMonth(hoy.getMonth() - 1);
        E.anio = +(q.get("anio") || hoy.getFullYear());
        E.mes = +(q.get("mes") || (q.get("meses") || "").split(",")[0].slice(-2) || hoy.getMonth() + 1);
        var anios = []; for (var a = new Date().getFullYear(); a >= new Date().getFullYear() - 5; a--) anios.push(a);
        $("sel-anio").innerHTML = anios.map(function (x) { return "<option" + (x === E.anio ? " selected" : "") + ">" + x + "</option>"; }).join("");
        $("sel-mes").innerHTML = MESES.map(function (n, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === E.mes ? " selected" : "") + ">" + n + "</option>"; }).join("");
        eventos();
        ponerLado(E.lado, true);
        ponerFiltro(E.filtro, true);
        titulo();
        cargar();
    }

    function nombreEmpresa(rfc) {
        var c = E.empresas.find(function (x) { return x.rfc === rfc; });
        return (c && (c.alias || c.nombre)) || rfc;
    }
    function titulo() {
        $("empresa-etiqueta").textContent = E.rfc ? "Empresa · " + E.rfc : "Empresa";
        $("empresa-titulo").textContent = E.rfc ? nombreEmpresa(E.rfc) : "Elegir empresa";
    }
    function pintarMenu() {
        $("menu-empresa").innerHTML = '<div class="xml-otra__grupo">Empresas con XML</div>' + (E.empresas.length ? E.empresas.map(function (c) {
            return '<button type="button" data-rfc="' + esc(c.rfc) + '"' + (c.rfc === E.rfc ? ' class="xml-activa"' : "") + ">" + esc(c.alias || c.nombre || c.rfc) +
                " <span>" + esc(c.rfc) + "</span></button>";
        }).join("") : '<p class="xml-otra__nota">Carga primero sus XML en Administración de XML.</p>');
    }

    /* ------------------------------------------------------------ datos */
    async function cargar() {
        E.sel.clear();
        if (!E.rfc) { E.datos = null; pintar(); return; }
        $("tbody").innerHTML = '<tr><td colspan="8" class="xml-vacio">Calculando…</td></tr>';
        try { E.datos = await api("/api/fiscal/" + encodeURIComponent(E.rfc) + "/mes?anio=" + E.anio + "&mes=" + E.mes + "&lado=" + E.lado); }
        catch (e) { E.datos = null; aviso(esc(e.message), true); }
        pintar();
    }

    function impuestosDelLado() {
        if (!E.datos) return [];
        var c = E.datos.config;
        if (E.lado === "recibidos") return ["isr", "iva", "diot"];
        return ["isr", "iva"].concat(c.prof ? ["prof"] : []).concat(c.alc ? ["alc"] : []);
    }

    function pintar() {
        var d = E.datos;
        $("paquete").textContent = d ? "Reglas: " + d.config.paquete + (d.config.personalizada ? " · con ajustes tuyos" : "") : "";
        pintarAvisos();
        pintarTarjetas();
        $("n-revisar").textContent = d && d.por_revisar ? "(" + d.por_revisar + ")" : "";
        pintarTabla();
    }

    function pintarAvisos() {
        var caja = $("avisos-cancel"), lista = (E.datos && E.datos.avisos) || [];
        caja.hidden = !lista.length;
        caja.innerHTML = lista.map(function (a) {
            return "<div>⚠ Se cancelaron " + a.canceladas.length + " CFDI que se usaron en <b>" + esc(a.nombre) + " de " + MESES[a.mes - 1] + " " + a.anio + "</b>." +
                (a.presentada ? " Esa declaración ya está presentada: revisa si toca una complementaria." :
                 '<button type="button" data-actualizar="' + a.impuesto + '" data-anio="' + a.anio + '" data-mes="' + a.mes + '">Actualizar el cálculo</button>') + "</div>";
        }).join("");
    }

    function uso(imp) {
        return ((E.datos && E.datos.usos) || []).find(function (u) { return u.impuesto === imp && u.anio === E.anio && u.mes === E.mes; });
    }

    function pintarTarjetas() {
        var d = E.datos;
        if (!d) { $("tarjetas").innerHTML = ""; return; }
        var r = d.resumen, t = [];
        function tarjeta(titulo, valor, extra, boton) {
            return '<div class="fi-tarjeta"><small>' + titulo + "</small><b>" + valor + "</b>" + (extra ? "<span>" + extra + "</span>" : "") + (boton || "") + "</div>";
        }
        if (E.lado === "emitidos") {
            t.push(tarjeta("Ingresos para ISR", m(r.isr.base), r.isr.cfdi + " CFDI · " + (d.config.momento.isr === "cobrado" ? "cobrado" : "facturado")));
            t.push(tarjeta("IVA " + (d.config.momento.iva === "cobrado" ? "cobrado" : "facturado"), m(r.iva.base), r.iva.cfdi + " CFDI"));
            ["prof", "alc"].forEach(function (k) {
                if (!d.config[k]) return;
                var u = uso(k);
                t.push(tarjeta(k === "prof" ? "Base profesiones" : "Base alcohol", m(r[k].base), r[k].cfdi + " CFDI",
                    (u ? "<em>✓ En la declaración: " + m(u.base) + "</em>" : "") +
                    '<button type="button" data-usar="' + k + '">' + (u ? "Volver a usar" : "Usar en la declaración") + "</button>"));
            });
        } else {
            t.push(tarjeta("Deducible (ISR)", m(r.isr.base), r.isr.cfdi + " CFDI · " + (d.config.momento.isr === "cobrado" ? "pagado" : "facturado")));
            t.push(tarjeta("IVA acreditable", m(r.iva.base), r.iva.cfdi + " CFDI"));
            t.push(tarjeta("Para la DIOT", m(r.diot.base), r.diot.cfdi + " CFDI pagados"));
        }
        t.push('<div class="fi-tarjeta' + (d.por_revisar ? " fi-tarjeta--alerta" : "") + '"><small>Por revisar</small><b>' + d.por_revisar + "</b><span>" +
               (d.por_revisar ? "lo demás ya quedó marcado" : "todo quedó marcado solo") + "</span>" +
               (d.por_revisar ? '<button type="button" data-ver-revisar="1">Ver</button>' : "") + "</div>");
        $("tarjetas").innerHTML = t.join("");
    }

    function visibles() {
        if (!E.datos) return [];
        var b = E.buscar.toLowerCase();
        return E.datos.filas.filter(function (f) {
            var marcas = Object.keys(f.marcas).map(function (k) { return f.marcas[k]; });
            if (E.filtro === "revisar" && !f.revisar.length) return false;
            if (E.filtro === "cuentan" && !marcas.some(function (x) { return x.cuenta && x.base; })) return false;
            if (E.filtro === "no" && marcas.some(function (x) { return x.cuenta && x.base; })) return false;
            if (E.filtro === "mano" && !marcas.some(function (x) { return x.origen !== "auto"; })) return false;
            if (b && (f.folio + " " + (f.contraparte.nombre || "") + " " + (f.contraparte.rfc || "") + " " + f.uuid).toLowerCase().indexOf(b) === -1) return false;
            return true;
        });
    }

    function etiqueta(imp, x) {
        if (!x.cuenta) return '<span class="fi-etq fi-etq--no" title="' + esc(x.motivo) + '">' + nombre(imp) + "</span>";
        var valor = x.base * x.pct / 100;
        return '<span class="fi-etq ' + (x.pct < 100 ? "fi-etq--parcial" : "fi-etq--si") + '" title="' + esc(x.motivo) + '">' + nombre(imp) + " " + m(valor) +
               (x.pct < 100 ? " <i>" + x.pct + " %</i>" : "") + "</span>";
    }

    function pintarTabla() {
        var filas = visibles(), imps = impuestosDelLado();
        var todas = filas.length && filas.every(function (f) { return E.sel.has(f.uuid); });
        $("thead").innerHTML = '<tr><th style="width:32px"><input type="checkbox" id="sel-todas"' + (todas ? " checked" : "") + ' aria-label="Seleccionar todas"></th>' +
            "<th>Fecha</th><th>Folio</th><th>" + (E.lado === "emitidos" ? "Cliente" : "Proveedor") + '</th><th class="xml-num">Total</th>' +
            "<th>" + (E.lado === "emitidos" ? "Cobro" : "Pago") + "</th><th>Cuenta para</th><th>Motivo</th></tr>";
        $("tbody").innerHTML = filas.map(function (f) {
            var primero = f.marcas[imps[0]] || {};
            var mano = imps.some(function (k) { return f.marcas[k] && f.marcas[k].origen !== "auto"; });
            var origen = imps.map(function (k) { return f.marcas[k] && f.marcas[k].origen; }).find(function (o) { return o && o !== "auto"; });
            return '<tr data-uuid="' + esc(f.uuid) + '" class="' + (E.sel.has(f.uuid) ? "fi-sel " : "") + (f.cancelado ? "fi-cancelada" : "") + '">' +
                '<td><input type="checkbox" data-check="' + esc(f.uuid) + '"' + (E.sel.has(f.uuid) ? " checked" : "") + "></td>" +
                "<td>" + esc(f.fecha.slice(8, 10) + "/" + f.fecha.slice(5, 7)) + "</td>" +
                "<td>" + esc(f.folio || f.uuid.slice(0, 8)) + (f.tipo === "E" ? ' <span class="xml-sello">NC</span>' : "") + "</td>" +
                '<td class="fi-nombre">' + esc(f.contraparte.nombre || "—") + "<small>" + esc(f.contraparte.rfc || "") + "</small></td>" +
                '<td class="xml-num">' + m(f.total) + "</td>" +
                '<td class="fi-como">' + esc(f.como || "—") + "</td>" +
                '<td><div class="fi-etqs">' + imps.filter(function (k) { return f.marcas[k]; }).map(function (k) { return etiqueta(k, f.marcas[k]); }).join("") + "</div></td>" +
                '<td class="fi-motivo">' + (mano ? '<span class="fi-mano">' + (origen === "regla" ? "Regla de la empresa · " : "A mano · ") + "</span>" : "") +
                esc(primero.motivo || "") + f.revisar.map(function (r) { return '<span class="fi-rev">⚑ ' + esc(r) + "</span>"; }).join("") + "</td></tr>";
        }).join("");
        $("sin-filas").hidden = filas.length > 0;
        $("sin-filas").textContent = !E.rfc ? "Elige una empresa." : !E.datos ? "" :
            E.datos.filas.length ? "Nada con este filtro." : "No hay CFDI " + (E.lado === "emitidos" ? "emitidos ni cobrados" : "recibidos ni pagados") + " en " + MESES[E.mes - 1] + " " + E.anio + ". Cárgalos en Administración de XML.";
        pintarSeleccion();
    }

    function pintarSeleccion() {
        var n = E.sel.size;
        $("seleccion").hidden = !n;
        $("sel-n").textContent = n + (n === 1 ? " seleccionada" : " seleccionadas");
    }

    /* ------------------------------------------------------------ marcar */
    function abrirMarcar() {
        var imps = impuestosDelLado();
        $("mk-titulo").textContent = "Marcar " + E.sel.size + (E.sel.size === 1 ? " CFDI" : " CFDI");
        $("mk-imp").innerHTML = '<option value="*">Todo (' + imps.map(nombre).join(", ") + ")</option>" +
            imps.map(function (k) { return '<option value="' + k + '">' + nombre(k) + "</option>"; }).join("");
        $("mk-cuenta").value = "0";
        $("mk-pct").value = "";
        $("mk-motivo").value = "";
        $("mk-contra").textContent = E.lado === "emitidos" ? "Siempre con este cliente" : "Siempre con este proveedor";
        document.querySelector('input[name="siempre"][value=""]').checked = true;
        $("mk-error").hidden = true;
        $("modal-marcar").hidden = false;
    }

    async function aplicarMarca() {
        var imp = $("mk-imp").value, imps = imp === "*" ? impuestosDelLado() : [imp];
        var siempre = document.querySelector('input[name="siempre"]:checked').value;
        if (siempre === "contraparte") siempre = E.lado === "emitidos" ? "cliente" : "proveedor";
        var pct = $("mk-pct").value === "" ? null : +$("mk-pct").value;
        if (imp === "alc" && pct == null && $("mk-cuenta").value === "1") pct = E.datos.config.alcohol_pct;
        var cuerpo = { uuids: Array.from(E.sel), cuenta: $("mk-cuenta").value === "1", pct: pct, motivo: $("mk-motivo").value.trim() || null, siempre: siempre || null };
        try {
            var aprendidas = 0;
            for (var i = 0; i < imps.length; i++) {
                var r = await enviar("/api/fiscal/" + encodeURIComponent(E.rfc) + "/marcar", "POST", Object.assign({ impuesto: imps[i] }, cuerpo));
                aprendidas += r.reglas;
            }
            $("modal-marcar").hidden = true;
            aviso("Listo: " + cuerpo.uuids.length + " CFDI marcados." + (aprendidas ? " Fiscontable lo aprendió para esta empresa (" + aprendidas + " regla(s); las ves en ⚙ Reglas)." : ""));
            cargar();
        } catch (e) { $("mk-error").textContent = e.message; $("mk-error").hidden = false; }
    }

    async function marcarRevisado() {
        try {
            await enviar("/api/fiscal/" + encodeURIComponent(E.rfc) + "/marcar", "POST", { uuids: Array.from(E.sel), impuesto: "revisado", cuenta: true });
            aviso("Marcadas como revisadas.");
            cargar();
        } catch (e) { aviso(esc(e.message), true); }
    }

    async function volverAutomatico() {
        if (!confirm("Esos CFDI vuelven a lo que dicen las reglas (se quita lo marcado a mano). Las reglas aprendidas se quedan.")) return;
        try {
            await enviar("/api/fiscal/" + encodeURIComponent(E.rfc) + "/automatico", "POST", { uuids: Array.from(E.sel) });
            aviso("Volvieron a lo automático.");
            cargar();
        } catch (e) { aviso(esc(e.message), true); }
    }

    /* ------------------------------------------------------------ usar en la declaración */
    async function usar(imp, anio, mes) {
        anio = anio || E.anio; mes = mes || E.mes;
        var base = E.datos.resumen[imp].base;
        if (!confirm("Se llena " + nombre(imp).toLowerCase() + " de " + MESES[mes - 1] + " " + anio + " en Impuestos estatales con la base de " + m(base) +
                     " (" + E.datos.resumen[imp].cfdi + " CFDI).\n\nNo se presenta nada todavía.")) return;
        try {
            var r = await enviar("/api/fiscal/" + encodeURIComponent(E.rfc) + "/usar", "POST", { impuesto: imp, anio: anio, mes: mes });
            aviso("Listo: " + esc(nombre(imp)) + " de " + MESES[mes - 1] + " " + anio + " quedó con A = " + m(r.base) + ". " +
                  '<a class="xml-enlace" href="/herramientas/isn/estatal.html?i=' + imp + "&empresa=" + encodeURIComponent(E.rfc) + '">Abrir la declaración →</a>');
            cargar();
        } catch (e) { aviso(esc(e.message), true); }
    }

    /* ------------------------------------------------------------ reglas de la empresa */
    async function abrirConfig() {
        if (!E.datos) return;
        var c = E.datos.config;
        $("cf-titulo").textContent = "Reglas · " + nombreEmpresa(E.rfc);
        $("cf-paquete").textContent = "Paquete por su régimen" + (c.regimen ? " (" + c.regimen + ")" : "") + ": " + c.paquete + ".";
        var momentos = [["isr", "ISR"], ["iva", "IVA"], ["prof", "Profesiones"], ["alc", "Alcohol"]];
        $("cf-momentos").innerHTML = momentos.map(function (x) {
            return "<label>" + x[1] + '<select data-momento="' + x[0] + '"><option value="cobrado"' + (c.momento[x[0]] === "cobrado" ? " selected" : "") +
                ">Cobrado / pagado (flujo)</option><option value=\"facturado\"" + (c.momento[x[0]] === "facturado" ? " selected" : "") + ">Facturado (devengado)</option></select></label>";
        }).join("");
        $("cf-prof").checked = !!c.prof;
        $("cf-alc").checked = !!c.alc;
        $("cf-alc-pct").value = c.alcohol_pct;
        $("cf-reglas").innerHTML = Object.keys(E.cat.reglas_generales).map(function (k) {
            return '<label class="isn-check"><input type="checkbox" data-regla="' + k + '"' + (c.reglas[k] ? " checked" : "") + "> " + esc(E.cat.reglas_generales[k]) + "</label>";
        }).join("");
        $("cf-error").hidden = true;
        $("modal-config").hidden = false;
        pintarAprendidas();
    }
    async function pintarAprendidas() {
        try {
            var reglas = await api("/api/fiscal/" + encodeURIComponent(E.rfc) + "/reglas");
            var tipos = { proveedor: "Proveedor", cliente: "Cliente", clave: "Clave" };
            $("cf-aprendidas").innerHTML = reglas.length ? reglas.map(function (r) {
                return '<div class="fi-aprendida"><span><b>' + tipos[r.tipo] + " " + esc(r.valor) + "</b>" + (r.nombre ? " · " + esc(r.nombre) : "") + " → " + nombre(r.impuesto) + ": " +
                    (r.cuenta ? "cuenta" + (r.pct != null && r.pct !== 100 ? " al " + r.pct + " %" : "") : "no cuenta") + (r.motivo ? " · " + esc(r.motivo) : "") +
                    '</span><button type="button" data-borrar-regla="' + r.id + '" title="Olvidar esta regla">×</button></div>';
            }).join("") : '<p class="isn-nota">Todavía no hay. Cuando marques algo con «¿Siempre así?», aparece aquí.</p>';
        } catch (e) { $("cf-aprendidas").textContent = e.message; }
    }
    async function guardarConfig(restablecer) {
        var cuerpo = { momento: {}, reglas: {}, prof: $("cf-prof").checked, alc: $("cf-alc").checked, alcohol_pct: +$("cf-alc-pct").value };
        document.querySelectorAll("[data-momento]").forEach(function (s) { cuerpo.momento[s.dataset.momento] = s.value; });
        document.querySelectorAll("[data-regla]").forEach(function (c) { cuerpo.reglas[c.dataset.regla] = c.checked; });
        if (restablecer) cuerpo = { restablecer: true };
        try {
            await enviar("/api/fiscal/" + encodeURIComponent(E.rfc) + "/config", "PUT", cuerpo);
            $("modal-config").hidden = true;
            aviso(restablecer ? "Se volvió al paquete de su régimen." : "Reglas guardadas.");
            cargar();
        } catch (e) { $("cf-error").textContent = e.message; $("cf-error").hidden = false; }
    }

    /* ------------------------------------------------------------ eventos */
    function ponerLado(l, inicio) {
        E.lado = l;
        document.querySelectorAll("[data-lado]").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.lado === l ? "true" : "false"); });
        if (!inicio) cargar();
    }
    function ponerFiltro(f, inicio) {
        E.filtro = f;
        document.querySelectorAll("[data-filtro]").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.filtro === f ? "true" : "false"); });
        if (!inicio) pintarTabla();
    }
    function eventos() {
        $("btn-empresa").addEventListener("click", function (e) { e.stopPropagation(); var mn = $("menu-empresa"); if (mn.hidden) pintarMenu(); mn.hidden = !mn.hidden; });
        $("menu-empresa").addEventListener("click", function (e) { e.stopPropagation(); var b = e.target.closest("[data-rfc]"); if (!b) return; $("menu-empresa").hidden = true; E.rfc = b.dataset.rfc; titulo(); cargar(); });
        document.addEventListener("click", function () { $("menu-empresa").hidden = true; });
        $("sel-anio").addEventListener("change", function () { E.anio = +this.value; cargar(); });
        $("sel-mes").addEventListener("change", function () { E.mes = +this.value; cargar(); });
        document.querySelectorAll("[data-lado]").forEach(function (b) { b.addEventListener("click", function () { ponerLado(b.dataset.lado); }); });
        document.querySelectorAll("[data-filtro]").forEach(function (b) { b.addEventListener("click", function () { ponerFiltro(b.dataset.filtro); }); });
        $("buscar").addEventListener("input", function () { E.buscar = this.value; pintarTabla(); });
        $("tbody").addEventListener("click", function (e) {
            var tr = e.target.closest("tr[data-uuid]"); if (!tr) return;
            var u = tr.dataset.uuid;
            if (E.sel.has(u)) E.sel.delete(u); else E.sel.add(u);
            tr.classList.toggle("fi-sel", E.sel.has(u));
            tr.querySelector("[data-check]").checked = E.sel.has(u);
            pintarSeleccion();
        });
        $("thead").addEventListener("change", function (e) {
            if (e.target.id !== "sel-todas") return;
            visibles().forEach(function (f) { if (e.target.checked) E.sel.add(f.uuid); else E.sel.delete(f.uuid); });
            pintarTabla();
        });
        $("tarjetas").addEventListener("click", function (e) {
            var b = e.target.closest("[data-usar]"); if (b) usar(b.dataset.usar);
            if (e.target.closest("[data-ver-revisar]")) ponerFiltro("revisar");
        });
        $("avisos-cancel").addEventListener("click", function (e) {
            var b = e.target.closest("[data-actualizar]"); if (!b) return;
            usar(b.dataset.actualizar, +b.dataset.anio, +b.dataset.mes);
        });
        $("btn-marcar").addEventListener("click", abrirMarcar);
        $("btn-revisado").addEventListener("click", marcarRevisado);
        $("btn-auto").addEventListener("click", volverAutomatico);
        $("btn-limpiar").addEventListener("click", function () { E.sel.clear(); pintarTabla(); });
        $("mk-cancelar").addEventListener("click", function () { $("modal-marcar").hidden = true; });
        $("mk-aplicar").addEventListener("click", aplicarMarca);
        $("mk-imp").addEventListener("change", function () { if (this.value === "alc" && E.datos) { $("mk-cuenta").value = "1"; $("mk-pct").value = E.datos.config.alcohol_pct; } });
        $("btn-config").addEventListener("click", abrirConfig);
        $("cf-cancelar").addEventListener("click", function () { $("modal-config").hidden = true; });
        $("cf-guardar").addEventListener("click", function () { guardarConfig(false); });
        $("cf-restablecer").addEventListener("click", function () { if (confirm("¿Volver al paquete de su régimen? Lo aprendido se queda.")) guardarConfig(true); });
        $("cf-aprendidas").addEventListener("click", async function (e) {
            var b = e.target.closest("[data-borrar-regla]"); if (!b) return;
            try { await api("/api/fiscal/" + encodeURIComponent(E.rfc) + "/reglas/" + b.dataset.borrarRegla, { method: "DELETE" }); pintarAprendidas(); cargar(); }
            catch (err) { $("cf-error").textContent = err.message; $("cf-error").hidden = false; }
        });
        document.querySelectorAll(".xml-modal").forEach(function (mo) { mo.addEventListener("click", function (e) { if (e.target === mo) mo.hidden = true; }); });
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") { $("modal-marcar").hidden = true; $("modal-config").hidden = true; } });
    }

    document.addEventListener("DOMContentLoaded", iniciar);
})();
