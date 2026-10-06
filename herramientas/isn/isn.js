/*
 * herramientas/isn/isn.js — ISN: calcular, capturar, cargar Excel y leer acuses.
 *
 * Empresa: la activa de la barra o cualquiera con periodos de ISN. Por año, una
 * fila por mes y tipo. Datos de la declaración (domicilio, giro, firma,
 * sucursales) por empresa; cada periodo lleva su desglose por sucursal, que
 * debe sumar el total de trabajadores y el impuesto (B).
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    var E = { empresa: null, empresas: [], rfc: null, anio: new Date().getFullYear(), datos: null, editando: null, periodoGeneral: null };

    async function api(ruta, opciones) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r;
    }
    function json(ruta, metodo, cuerpo) {
        return api(ruta, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }).then(function (r) { return r.json(); });
    }
    function m(v) { return v == null ? "" : Number(v).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function aviso(texto, error) { var a = $("aviso"); a.textContent = texto || ""; a.className = "isn-aviso" + (error ? " isn-aviso--error" : ""); a.hidden = !texto; }
    async function bajar(resp, porDefecto) {
        var blob = await resp.blob(), url = URL.createObjectURL(blob), a = document.createElement("a");
        var mt = /filename="?([^";]+)"?/.exec(resp.headers.get("Content-Disposition") || "");
        a.href = url; a.download = mt ? mt[1] : porDefecto; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }

    /* ------------------------------------------------------------ empresa y año */
    async function iniciar() {
        if (!(await Fiscontable.exigirModulo("isn"))) return;
        eventos();
        $("f-mes").innerHTML = MESES.map(function (n, i) { return '<option value="' + (i + 1) + '">' + n + "</option>"; }).join("");
        E.empresa = await Fiscontable.empresaActiva();
        E.periodoGeneral = await Fiscontable.periodoActivo();
        if (E.periodoGeneral) E.anio = +E.periodoGeneral.slice(0, 4);
        await cargarEmpresas();
        abrir(E.empresa ? E.empresa.rfc : (E.empresas[0] && E.empresas[0].rfc));
        window.addEventListener("fiscontable:empresa", function (e) { E.empresa = e.detail; if (e.detail) abrir(e.detail.rfc); });
    }

    async function cargarEmpresas() {
        try { E.empresas = await (await api("/api/isn/empresas")).json(); } catch (e) { E.empresas = []; }
    }

    function nombreDe(rfc) {
        var c = E.empresas.find(function (x) { return x.rfc === rfc; });
        if (E.empresa && E.empresa.rfc === rfc) return E.empresa.alias || rfc;
        return (c && c.nombre) || rfc;
    }

    function abrir(rfc) {
        E.rfc = rfc || null;
        $("empresa-etiqueta").textContent = E.rfc ? "Empresa · " + E.rfc : "Empresa";
        $("empresa-titulo").textContent = E.rfc ? nombreDe(E.rfc) : "Elegir empresa";
        cargar();
    }

    function pintarMenu() {
        var lista = E.empresas.slice();
        if (E.empresa && !lista.some(function (c) { return c.rfc === E.empresa.rfc; })) lista.unshift({ rfc: E.empresa.rfc, nombre: E.empresa.alias, periodos: 0 });
        $("menu-empresa").innerHTML = '<div class="xml-otra__grupo">Empresas</div>' + (lista.length ? lista.map(function (c) {
            return '<button type="button" data-rfc="' + esc(c.rfc) + '"' + (c.rfc === E.rfc ? ' class="xml-activa"' : "") + ">" + esc(c.nombre || c.rfc) +
                " <span>" + esc(c.rfc) + " · " + (c.periodos || 0) + " periodo(s)</span></button>";
        }).join("") : '<p class="xml-otra__nota">Todavía no hay periodos. Captura uno o carga el Excel.</p>');
    }

    /* ------------------------------------------------------------ tabla */
    async function cargar() {
        if (!E.rfc) { E.datos = { periodos: [], anios: [], tasa_sugerida: {} }; pintar(); return; }
        try {
            E.datos = await (await api("/api/isn/periodos?rfc=" + encodeURIComponent(E.rfc) + "&anio=" + E.anio)).json();
        } catch (e) { aviso(e.message, true); return; }
        pintar();
    }

    function pintarAnios() {
        var anios = new Set((E.datos.anios || []).concat([E.anio, new Date().getFullYear()]));
        $("sel-anio").innerHTML = Array.from(anios).sort().reverse().map(function (a) {
            return '<option value="' + a + '"' + (+a === +E.anio ? " selected" : "") + ">" + a + "</option>";
        }).join("");
    }

    var COLS = [["mes_nombre", "Mes", 96], ["tipo", "Tipo", 110], ["estado", "Estado", 64], ["municipio", "Municipio", 140],
                ["trab", "Trabajadores", 100, 1], ["base", "Base", 120, 1], ["tasa", "Tasa", 64, 1], ["impuesto", "Impuesto (B)", 120, 1],
                ["retenido", "Retenido", 100, 1], ["a_cargo", "A cargo", 120, 1],
                ["presentada", "Estatus", 120], ["acuse_importe", "Pagado (acuse)", 120, 1], ["diferencia", "Diferencia", 100, 1],
                ["folio", "Folio", 110], ["fecha_presentacion", "Presentada el", 110], ["acuse", "PDF", 110], ["avisos", "Avisos", 260]];

    function pintar() {
        pintarAnios();
        var filas = E.datos.periodos;
        var porPresentar = filas.filter(function (f) { return !f.presentada; });
        var suma = function (k, l) { return l.reduce(function (s, f) { return s + (f[k] || 0); }, 0); };
        $("resumen").innerHTML = E.rfc && filas.length
            ? '<div class="ctx-resumen__dato"><small>Impuesto del año</small><b>$' + m(suma("impuesto", filas)) + "</b></div>" +
              '<div class="ctx-resumen__dato"><small>Pagado según acuses</small><b>$' + m(suma("acuse_importe", filas)) + "</b></div>" +
              '<div class="ctx-resumen__dato' + (porPresentar.length ? " ctx-resumen__dato--alerta" : "") + '"><small>Por presentar</small><b>' + porPresentar.length +
              "</b><span>$" + m(suma("impuesto", porPresentar)) + "</span></div>"
            : "";
        $("thead").innerHTML = "<tr>" + COLS.map(function (c) {
            return "<th" + (c[3] ? ' class="xml-num"' : "") + ' style="width:' + c[2] + "px;min-width:" + c[2] + 'px">' + c[1] + "</th>";
        }).join("") + "</tr>";
        $("tbody").innerHTML = filas.map(function (f) {
            return '<tr data-id="' + f.id + '">' + COLS.map(function (c) {
                switch (c[0]) {
                    case "trab": return '<td class="xml-num">' + ((f.trabajadores_sm || 0) + (f.trabajadores_otro || 0)) + "</td>";
                    case "tasa": return '<td class="xml-num">' + (f.tasa != null ? (f.tasa * 100).toLocaleString("es-MX", { maximumFractionDigits: 2 }) + " %" : "") + "</td>";
                    case "presentada":
                        if (f.presentada) return '<td><span class="xml-sello xml-sello--verde">Presentada</span></td>';
                        if (f.faltan && f.faltan.length) return '<td title="' + esc(f.faltan.join(" ")) + '"><span class="xml-sello xml-sello--ambar">Falta información</span></td>';
                        return '<td title="Listo para llenar en Tributanet"><span class="xml-sello isn-sello-listo">Por presentar · listo</span></td>';
                    case "diferencia": return '<td class="xml-num' + (f.diferencia ? " isn-dif" : "") + '">' + (f.diferencia ? m(f.diferencia) : "") + "</td>";
                    case "acuse": return "<td>" + (f.tiene_acuse ? '<a class="xml-enlace" data-acuse="' + f.id + '" href="' + API + "/api/isn/acuse/" + f.id + '">Acuse</a>' : "") +
                        (f.tiene_pago_ceros ? ' · <a class="xml-enlace" data-acuse="' + f.id + '" href="' + API + "/api/isn/pago-ceros/" + f.id + '" title="Registrar pago en ceros">Ceros</a>' : "") + "</td>";
                    case "avisos": var t = (f.faltan || []).concat(f.avisos); return '<td title="' + esc(t.join(" · ")) + '" style="color:#b45309">' + esc(t.join(" · ")) + "</td>";
                    default: return "<td" + (c[3] ? ' class="xml-num"' : "") + ">" + (c[3] ? m(f[c[0]]) : esc(f[c[0]] == null ? "" : f[c[0]])) + "</td>";
                }
            }).join("") + "</tr>";
        }).join("");
        pintarDatos();
        $("sin-filas").hidden = filas.length > 0;
        $("sin-filas").textContent = !E.rfc ? "Elige una empresa, captura un periodo o carga el Excel." : "Sin periodos de " + E.anio + ". Captura uno, carga el Excel o lee los acuses.";
    }

    /* ------------------------------------------------------------ datos de la declaración */
    function pintarDatos() {
        var caja = $("datos-empresa"), d = E.datos.empresa;
        caja.hidden = !E.rfc;
        if (!E.rfc) return;
        if (!d) {
            caja.className = "isn-datos isn-datos--vacio";
            caja.innerHTML = "<span>Faltan los datos de la declaración (domicilio, giro, firma y sucursales).</span>" +
                '<span class="isn-datos__acciones"><button type="button" class="xml-enlace" data-accion="acuse">Subir el acuse de un mes anterior</button>' +
                '<button type="button" class="xml-enlace" data-accion="datos">Capturarlos</button></span>';
            return;
        }
        caja.className = "isn-datos";
        var dom = [d.domicilio, d.numero_exterior, d.numero_interior, d.colonia, d.codigo_postal ? "CP " + d.codigo_postal : "", d.localidad].filter(Boolean).join(", ");
        caja.innerHTML = "<span><b>" + esc(dom || "Sin domicilio") + "</b></span><span>Giro: <b>" + esc(d.giro || "—") + "</b></span>" +
            "<span>Firma: <b>" + esc(d.firma || "—") + "</b></span><span>" + d.sucursales.length + " sucursal(es)</span>" +
            (d.origen === "acuse" && d.periodo_origen ? '<span class="isn-nota">del acuse ' + esc(d.periodo_origen) + "</span>" : "") +
            '<span class="isn-datos__acciones"><button type="button" class="xml-enlace" data-accion="datos">Editar</button></span>';
    }

    function abrirDatos() {
        if (!E.rfc) { aviso("Elige una empresa.", true); return; }
        var d = E.datos.empresa || {}, campos = E.datos.campos_empresa || [];
        $("datos-titulo").textContent = "Datos de la declaración · " + E.rfc;
        $("datos-campos").innerHTML = '<label>Municipio<input data-campo="municipio" value="' + esc(d.municipio || "") + '"></label>' +
            campos.map(function (c) {
                return '<label' + (c.largo > 40 ? ' class="isn-ancho"' : "") + ">" + esc(c.titulo) + (c.obligatorio ? " *" : "") +
                    '<input data-campo="' + c.clave + '" maxlength="' + c.largo + '" value="' + esc(d[c.clave] || "") + '"></label>';
            }).join("");
        $("sucursales-filas").innerHTML = "";
        (d.sucursales && d.sucursales.length ? d.sucursales : [{ clave: "", nombre: "" }]).forEach(filaSucursal);
        $("datos-error").hidden = true;
        $("modal-datos").hidden = false;
    }

    function filaSucursal(s) {
        var tr = document.createElement("tr");
        tr.innerHTML = '<td><input class="su-clave" maxlength="6" placeholder="02001" value="' + esc(s.clave || "") + '"></td>' +
            '<td><input class="su-nombre" value="' + esc(s.nombre || "") + '"></td>' +
            '<td><button type="button" class="isn-quitar" title="Quitar">×</button></td>';
        $("sucursales-filas").appendChild(tr);
    }

    async function guardarDatos(e) {
        e.preventDefault();
        var cuerpo = { rfc: E.rfc, estado: "QROO", nombre: nombreDe(E.rfc), sucursales: [] };
        document.querySelectorAll("#datos-campos [data-campo]").forEach(function (i) { cuerpo[i.dataset.campo] = i.value.trim() || null; });
        document.querySelectorAll("#sucursales-filas tr").forEach(function (tr) {
            var c = tr.querySelector(".su-clave").value.trim();
            if (c) cuerpo.sucursales.push({ clave: c, nombre: tr.querySelector(".su-nombre").value.trim() });
        });
        try {
            await json("/api/isn/empresa", "PUT", cuerpo);
            $("modal-datos").hidden = true;
            aviso("Datos de la declaración guardados.");
            cargar();
        } catch (err) { $("datos-error").textContent = err.message; $("datos-error").hidden = false; }
    }

    /* ------------------------------------------------------------ captura */
    function abrirForm(f) {
        E.editando = f || null;
        $("form-titulo").textContent = f ? "Periodo " + f.mes_nombre + " " + f.anio + " · " + f.tipo : "Nuevo periodo";
        $("f-rfc").value = f ? f.rfc : (E.rfc || "");
        $("f-rfc").readOnly = !!f;
        $("f-estado").value = f ? f.estado : "QROO";
        $("f-municipio").value = f ? (f.municipio || "") : ((E.datos.periodos[0] || {}).municipio || "");
        $("f-anio").value = f ? f.anio : E.anio;
        $("f-mes").value = f ? f.mes : (E.periodoGeneral && +E.periodoGeneral.slice(0, 4) === +E.anio ? +E.periodoGeneral.slice(5, 7) : new Date().getMonth() + 1);
        $("f-tipo").value = f ? f.tipo : "Normal";
        $("f-tsm").value = f ? f.trabajadores_sm : 0;
        $("f-rsm").value = f ? f.remuneraciones_sm : 0;
        $("f-tot").value = f ? f.trabajadores_otro : 0;
        $("f-rot").value = f ? f.remuneraciones_otro : 0;
        var sugerida = (E.datos.tasa_sugerida || {})[$("f-estado").value];
        $("f-tasa").value = f && f.tasa != null ? +(f.tasa * 100).toFixed(4) : (sugerida != null ? +(sugerida * 100).toFixed(4) : "");
        $("f-notas").value = f ? (f.notas || "") : "";
        $("f-ret").value = f ? (f.retenido || 0) : 0;
        $("f-esp").value = f ? (f.trabajadores_especiales || 0) : 0;
        pintarReparto(f);
        $("form-borrar").hidden = !f;
        $("form-error").hidden = true;
        $("modal").hidden = false;
        recalcular();
        (f ? $("f-tsm") : $("f-rfc")).focus();
    }

    function totales() {
        var base = (+$("f-rsm").value || 0) + (+$("f-rot").value || 0), tasa = +$("f-tasa").value;
        var imp = tasa ? Math.round(Math.round(base) * tasa / 100) : null;   // como el portal: A en pesos, B = A × tasa
        return { base: base, trab: (+$("f-tsm").value || 0) + (+$("f-tot").value || 0), imp: imp, cargo: imp == null ? null : Math.max(imp - (+$("f-ret").value || 0), 0) };
    }

    function recalcular() {
        var t = totales();
        $("c-base").textContent = m(t.base);
        $("c-trab").textContent = t.trab;
        $("c-imp").textContent = t.imp != null ? "$" + t.imp.toLocaleString("es-MX") : "Lo calcula el portal";
        $("c-cargo").textContent = t.cargo != null ? "$" + t.cargo.toLocaleString("es-MX") : "—";
        sumasReparto();
    }

    /* Desglose por sucursal: solo QROO y con sucursales en los datos de la empresa */
    function pintarReparto(f) {
        var d = E.datos.empresa, caja = $("reparto");
        var suc = (d && d.sucursales) || [];
        caja.hidden = $("f-estado").value !== "QROO" || !suc.length;
        if (caja.hidden) { $("reparto-filas").innerHTML = ""; return; }
        var previo = {};
        ((f && f.reparto) || []).forEach(function (r) { previo[r.clave] = r; });
        $("reparto-filas").innerHTML = suc.map(function (s) {
            var r = previo[s.clave] || {};
            return '<tr data-clave="' + esc(s.clave) + '"><td title="' + esc(s.nombre) + '">' + esc(s.clave) + " · " + esc(s.nombre.slice(0, 48)) + "</td>" +
                '<td class="xml-num"><input type="number" min="0" step="1" class="rp-t" value="' + (r.trabajadores != null ? r.trabajadores : (suc.length === 1 ? "" : "")) + '"></td>' +
                '<td class="xml-num"><input type="number" min="0" step="1" class="rp-i" value="' + (r.impuesto != null ? r.impuesto : "") + '"></td></tr>';
        }).join("");
        $("reparto-nota").textContent = suc.length === 1 ? "Una sola sucursal: si la dejas vacía, lleva todo." :
            "Si dejas todo vacío se reparte como el último mes; si solo pones empleados, el impuesto se reparte según empleados.";
    }

    function filasReparto() {
        return Array.from(document.querySelectorAll("#reparto-filas tr")).map(function (tr) {
            var t = tr.querySelector(".rp-t").value, i = tr.querySelector(".rp-i").value;
            return { clave: tr.dataset.clave, trabajadores: t === "" ? null : +t, impuesto: i === "" ? null : +i };
        });
    }

    function sumasReparto() {
        if ($("reparto").hidden) return;
        var t = totales(), filas = filasReparto();
        var vacio = filas.every(function (r) { return r.trabajadores == null && r.impuesto == null; });
        var st = filas.reduce(function (s, r) { return s + (r.trabajadores || 0); }, 0);
        var si = filas.reduce(function (s, r) { return s + (r.impuesto || 0); }, 0);
        var sinImp = filas.every(function (r) { return r.impuesto == null; });
        $("rp-trab").innerHTML = vacio ? "automático" : '<span class="' + (st === t.trab ? "isn-bien" : "isn-mal") + '">' + st + " de " + t.trab + "</span>";
        $("rp-imp").innerHTML = vacio || sinImp ? "automático" : '<span class="' + (t.imp == null || si === t.imp ? "isn-bien" : "isn-mal") + '">' +
            si.toLocaleString("es-MX") + (t.imp != null ? " de " + t.imp.toLocaleString("es-MX") : "") + "</span>";
    }

    function repartirSegunEmpleados() {
        var t = totales(), trs = Array.from(document.querySelectorAll("#reparto-filas tr"));
        var pesos = trs.map(function (tr) { return +tr.querySelector(".rp-t").value || 0; });
        var suma = pesos.reduce(function (a, b) { return a + b; }, 0);
        if (t.imp == null || !suma) { $("form-error").textContent = "Pon primero los empleados de cada sucursal (y la tasa)."; $("form-error").hidden = false; return; }
        var crudos = pesos.map(function (p) { return t.imp * p / suma; }), enteros = crudos.map(Math.floor);
        var faltan = t.imp - enteros.reduce(function (a, b) { return a + b; }, 0);
        crudos.map(function (c, i) { return [c - enteros[i], i]; }).sort(function (a, b) { return b[0] - a[0]; }).slice(0, faltan).forEach(function (x) { enteros[x[1]]++; });
        trs.forEach(function (tr, i) { tr.querySelector(".rp-i").value = enteros[i]; });
        $("form-error").hidden = true;
        sumasReparto();
    }

    async function guardar(e) {
        e.preventDefault();
        var cuerpo = {
            rfc: $("f-rfc").value.trim().toUpperCase(), estado: $("f-estado").value, municipio: $("f-municipio").value.trim(),
            anio: +$("f-anio").value, mes: +$("f-mes").value, tipo: $("f-tipo").value,
            trabajadores_sm: +$("f-tsm").value || 0, remuneraciones_sm: +$("f-rsm").value || 0,
            trabajadores_otro: +$("f-tot").value || 0, remuneraciones_otro: +$("f-rot").value || 0,
            tasa: $("f-tasa").value === "" ? null : +$("f-tasa").value, notas: $("f-notas").value.trim() || null,
            retenido: +$("f-ret").value || 0, trabajadores_especiales: +$("f-esp").value || 0,
            nombre: nombreDe($("f-rfc").value.trim().toUpperCase())
        };
        if (!$("reparto").hidden) {
            var filas = filasReparto();
            // Vacío = automático (como el último mes). Con empleados: el impuesto vacío se reparte según empleados.
            if (filas.some(function (r) { return r.trabajadores != null || r.impuesto != null; }))
                cuerpo.reparto = filas.map(function (r) { return { clave: r.clave, trabajadores: r.trabajadores || 0, impuesto: r.impuesto }; });
        }
        try {
            var f = await json("/api/isn/periodo", "PUT", cuerpo);
            $("modal").hidden = true;
            aviso("Guardado: " + f.mes_nombre + " " + f.anio + (f.a_cargo != null ? " · a cargo $" + m(f.a_cargo) : "") + "." +
                  (f.faltan && f.faltan.length ? "\nFalta: " + f.faltan.join(" ") : ""), !!(f.faltan && f.faltan.length));
            E.anio = f.anio;
            await cargarEmpresas();
            abrir(f.rfc);
        } catch (err) { $("form-error").textContent = err.message; $("form-error").hidden = false; }
    }

    /* ------------------------------------------------------------ eventos */
    function eventos() {
        $("btn-empresa").addEventListener("click", function (e) { e.stopPropagation(); var mn = $("menu-empresa"); if (mn.hidden) pintarMenu(); mn.hidden = !mn.hidden; });
        $("menu-empresa").addEventListener("click", function (e) {
            e.stopPropagation(); var b = e.target.closest("[data-rfc]"); if (!b) return;
            $("menu-empresa").hidden = true; abrir(b.dataset.rfc);
        });
        document.addEventListener("click", function () { $("menu-empresa").hidden = true; });
        $("sel-anio").addEventListener("change", function () { E.anio = +this.value; cargar(); });
        $("btn-nuevo").addEventListener("click", function () { abrirForm(null); });
        $("tbody").addEventListener("click", function (e) {
            if (e.target.closest("[data-acuse]")) return;
            var tr = e.target.closest("tr[data-id]"); if (!tr) return;
            abrirForm(E.datos.periodos.find(function (f) { return f.id === +tr.dataset.id; }));
        });
        ["f-tsm", "f-rsm", "f-tot", "f-rot", "f-tasa", "f-ret"].forEach(function (id) { $(id).addEventListener("input", recalcular); });
        $("reparto-filas").addEventListener("input", sumasReparto);
        $("btn-repartir").addEventListener("click", repartirSegunEmpleados);
        $("btn-datos").addEventListener("click", abrirDatos);
        $("datos-empresa").addEventListener("click", function (e) {
            var b = e.target.closest("[data-accion]"); if (!b) return;
            if (b.dataset.accion === "acuse") $("in-acuses").click(); else abrirDatos();
        });
        $("form-datos").addEventListener("submit", guardarDatos);
        $("datos-cancelar").addEventListener("click", function () { $("modal-datos").hidden = true; });
        $("datos-acuse").addEventListener("click", function () { $("modal-datos").hidden = true; $("in-acuses").click(); });
        $("modal-datos").addEventListener("click", function (e) { if (e.target === this) this.hidden = true; });
        $("btn-sucursal").addEventListener("click", function () { filaSucursal({}); });
        $("sucursales-filas").addEventListener("click", function (e) { var b = e.target.closest(".isn-quitar"); if (b) b.closest("tr").remove(); });
        $("f-estado").addEventListener("change", function () {
            pintarReparto(E.editando);
            if (E.editando) return;
            var s = (E.datos.tasa_sugerida || {})[this.value];
            if (s != null) { $("f-tasa").value = +(s * 100).toFixed(4); recalcular(); }
        });
        $("form").addEventListener("submit", guardar);
        $("form-cancelar").addEventListener("click", function () { $("modal").hidden = true; });
        $("modal").addEventListener("click", function (e) { if (e.target === this) this.hidden = true; });
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") { $("modal").hidden = true; $("modal-datos").hidden = true; } });
        $("form-borrar").addEventListener("click", async function () {
            if (!E.editando || !confirm("¿Borrar " + E.editando.mes_nombre + " " + E.editando.anio + " (" + E.editando.tipo + ")? También se borra su acuse guardado.")) return;
            try { await api("/api/isn/periodo/" + E.editando.id, { method: "DELETE" }); $("modal").hidden = true; await cargarEmpresas(); cargar(); }
            catch (err) { $("form-error").textContent = err.message; $("form-error").hidden = false; }
        });
        $("btn-plantilla").addEventListener("click", async function () {
            // El mes a declarar: el del periodo general o el mes pasado; con tus empresas ya prellenadas
            var hoy = new Date(), a = hoy.getFullYear(), ms = hoy.getMonth();          // getMonth: 0 = enero → mes pasado
            if (ms === 0) { a -= 1; ms = 12; }
            if (E.periodoGeneral) { a = +E.periodoGeneral.slice(0, 4); ms = +E.periodoGeneral.slice(5, 7); }
            try { await bajar(await api("/api/isn/plantilla?anio=" + a + "&mes=" + ms), "Plantilla_ISN_" + a + "-" + String(ms).padStart(2, "0") + ".xlsx"); } catch (e) { aviso(e.message, true); }
        });
        $("btn-excel").addEventListener("click", function () { $("in-excel").click(); });
        $("in-excel").addEventListener("change", async function () {
            var f = this.files[0]; this.value = ""; if (!f) return;
            var fd = new FormData(); fd.append("archivo", f);
            try {
                var r = await (await api("/api/isn/excel", { method: "POST", body: fd })).json();
                aviso("Se cargaron " + r.cargados + " periodo(s)" + (r.empresas ? " y los datos de " + r.empresas + " empresa(s)" : "") + "." +
                      (r.por_revisar && r.por_revisar.length ? "\nRevisa:\n" + r.por_revisar.join("\n") : "") +
                      (r.errores.length ? "\nNo se cargaron:\n" + r.errores.join("\n") : ""), r.errores.length > 0 || (r.por_revisar || []).length > 0);
                await cargarEmpresas();
                if (r.rfcs.length && r.rfcs.indexOf(E.rfc) === -1) abrir(r.rfcs[0]); else cargar();
            } catch (e) { aviso(e.message, true); }
        });
        $("btn-acuses").addEventListener("click", function () { $("in-acuses").click(); });
        $("in-acuses").addEventListener("change", async function () {
            var archivos = Array.from(this.files); this.value = ""; if (!archivos.length) return;
            var fd = new FormData(); archivos.forEach(function (a) { fd.append("archivos", a); });
            aviso("Leyendo " + archivos.length + " acuse(s)…");
            try {
                var r = await (await api("/api/isn/acuses", { method: "POST", body: fd })).json();
                var malos = r.resultados.filter(function (x) { return x.error; });
                var conAviso = r.resultados.filter(function (x) { return !x.error && x.avisos.length; });
                var conDatos = r.resultados.filter(function (x) { return x.datos_empresa; }).length;
                aviso("Se leyeron " + r.leidos + " de " + archivos.length + " acuse(s)." +
                      (conDatos ? " Datos de la declaración actualizados en " + conDatos + " empresa(s)." : "") +
                      (conAviso.length ? "\nRevisa: " + conAviso.map(function (x) { return x.rfc + " " + MESES[x.mes - 1] + " " + x.anio + ": " + x.avisos.join(" "); }).join("\n") : "") +
                      (malos.length ? "\nNo se leyeron:\n" + malos.map(function (x) { return x.archivo + ": " + x.error; }).join("\n") : ""),
                      malos.length > 0 || conAviso.length > 0);
                await cargarEmpresas();
                var buenos = r.resultados.filter(function (x) { return !x.error; });
                if (buenos.length) { E.anio = buenos[0].anio; abrir(buenos.some(function (x) { return x.rfc === E.rfc; }) ? E.rfc : buenos[0].rfc); }
            } catch (e) { aviso(e.message, true); }
        });
        $("btn-exportar").addEventListener("click", async function () {
            if (!E.rfc) return;
            try { await bajar(await api("/api/isn/exportar?rfc=" + encodeURIComponent(E.rfc) + "&anio=" + E.anio), E.rfc + "_ISN_" + E.anio + ".xlsx"); }
            catch (e) { aviso(e.message, true); }
        });
    }

    document.addEventListener("DOMContentLoaded", iniciar);
})();
