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
    var E = { empresa: null, empresas: [], rfc: null, anio: new Date().getFullYear(), datos: null, editando: null, periodoGeneral: null,
              modo: "totales", puedePresentar: false, job: null, reloj: null, vista: "empresa", masivo: [], mvListo: false, mvMarcas: {} };
    try { if (localStorage.getItem("isn:vista") === "masivo") E.vista = "masivo"; } catch (e) { /* nada */ }
    try { if (localStorage.getItem("isn:modo") === "minimo") E.modo = "minimo"; } catch (e) { /* nada */ }

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
        var mt = /filename="?([^";]+)"?/.exec(resp.headers.get("Content-Disposition") || "");
        Fiscontable.guardarArchivo(await resp.blob(), mt ? mt[1] : porDefecto);
    }

    /* ------------------------------------------------------------ empresa y año */
    async function iniciar() {
        if (!(await Fiscontable.exigirModulo("isn"))) return;
        eventos();
        $("f-mes").innerHTML = MESES.map(function (n, i) { return '<option value="' + (i + 1) + '">' + n + "</option>"; }).join("");
        E.empresa = await Fiscontable.empresaActiva();
        E.periodoGeneral = await Fiscontable.periodoActivo();
        if (E.periodoGeneral) E.anio = +E.periodoGeneral.slice(0, 4);
        var perfil = await Fiscontable.perfil();
        E.puedePresentar = !!(perfil && (perfil.modulos_permitidos || []).indexOf("isn_presentar") !== -1);
        $("btn-presentar").disabled = !E.puedePresentar;
        $("nota-presentar").hidden = E.puedePresentar;
        await cargarEmpresas();
        var q = new URLSearchParams(location.search);
        var deUrl = (q.get("empresa") || "").toUpperCase();
        abrir(deUrl || (E.empresa ? E.empresa.rfc : (E.empresas[0] && E.empresas[0].rfc)));
        if (q.get("abrir")) setTimeout(function () { abrirDesdeUrl(q.get("abrir")); }, 700);
        ponerVista(E.vista, true);
        retomarTrabajo();
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
            '<td><input class="su-nombre" value="' + esc(s.nombre || "") + '">' + (s.nueva ? ' <span class="isn-sello-nueva" title="Reparte sus empleados en los periodos por presentar">nueva</span>' : "") + "</td>" +
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
        // Con días guardados = se calculó con salario mínimo; si no, se edita como totales
        var conMinimo = f ? !!f.dias_sm : E.modo === "minimo";
        ponerModo(conMinimo ? "minimo" : "totales", true);
        $("f-tsm").value = f && f.dias_sm ? f.trabajadores_sm : 0;
        $("f-dias").value = f && f.dias_sm ? f.dias_sm : "";
        $("f-tot").value = f ? (f.dias_sm ? f.trabajadores_otro : (f.trabajadores_sm || 0) + (f.trabajadores_otro || 0)) : 0;
        $("f-rot").value = f ? (f.dias_sm ? f.remuneraciones_otro : +(((f.remuneraciones_sm || 0) + (f.remuneraciones_otro || 0)).toFixed(2))) : 0;
        var sugerida = (E.datos.tasa_sugerida || {})[$("f-estado").value];
        $("f-tasa").value = f && f.tasa != null ? +(f.tasa * 100).toFixed(4) : (sugerida != null ? +(sugerida * 100).toFixed(4) : "");
        $("f-ret").value = f ? (f.retenido || 0) : 0;
        $("f-esp").value = f ? (f.trabajadores_especiales || 0) : 0;
        pintarReparto(f);
        $("form-borrar").hidden = !f;
        $("form-error").hidden = true;
        $("modal").hidden = false;
        recalcular();
        (f ? $("f-tsm") : $("f-rfc")).focus();
    }

    /* Salario mínimo del año y la zona de la empresa (lo manda el servidor con los periodos) */
    function salarioMinimo() {
        var tabla = E.datos.salarios_minimos || {}, anio = +$("f-anio").value, zona = (E.datos.empresa && E.datos.empresa.zona) || "general";
        var anios = Object.keys(tabla).map(Number).filter(function (a) { return a <= anio; });
        if (!anios.length) return null;
        return (tabla[anio] || tabla[Math.max.apply(null, anios)])[zona];
    }
    function diasDelMes() { return new Date(+$("f-anio").value, +$("f-mes").value, 0).getDate(); }

    function ponerModo(modo, sinGuardar) {
        E.modo = modo;
        if (!sinGuardar) { try { localStorage.setItem("isn:modo", modo); } catch (e) { /* nada */ } }
        document.querySelectorAll(".isn-modo button").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.modo === modo ? "true" : "false"); });
        document.querySelectorAll(".solo-minimo").forEach(function (x) { x.hidden = modo !== "minimo"; });
        $("etq-tot").textContent = modo === "minimo" ? "Otros trabajadores" : "Total de trabajadores";
        $("etq-rot").textContent = modo === "minimo" ? "Remuneraciones de otros" : "Total de remuneraciones";
        if (modo === "minimo" && !$("f-dias").value) $("f-dias").value = diasDelMes();
        recalcular();
    }

    function totales() {
        var rsm = 0;
        if (E.modo === "minimo") {
            var sm = salarioMinimo();
            rsm = sm ? Math.round((+$("f-tsm").value || 0) * (+$("f-dias").value || 0) * sm * 100) / 100 : 0;
            $("f-rsm").value = rsm ? rsm.toFixed(2) : "0.00";
            $("nota-minimo").textContent = sm ? $("f-tsm").value + " × " + ($("f-dias").value || 0) + " días × $" + sm.toFixed(2) + " (salario mínimo " +
                $("f-anio").value + ", " + (((E.datos.empresa && E.datos.empresa.zona) === "frontera") ? "frontera norte" : "zona general") + ")" : "No hay salario mínimo para ese año.";
        }
        var base = rsm + (+$("f-rot").value || 0), tasa = +$("f-tasa").value;
        var imp = tasa ? Math.round(Math.round(base) * tasa / 100) : null;   // como el portal: A en pesos, B = A × tasa
        var trab = (E.modo === "minimo" ? (+$("f-tsm").value || 0) : 0) + (+$("f-tot").value || 0);
        return { base: base, trab: trab, imp: imp, cargo: imp == null ? null : Math.max(imp - (+$("f-ret").value || 0), 0) };
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
        var llave = $("f-anio").value + "-" + String($("f-mes").value).padStart(2, "0") + "-" + $("f-tipo").value;
        $("reparto-filas").innerHTML = suc.map(function (s) {
            // Sucursal nueva aún sin repartir en este periodo: vacía y marcada (el automático le daría 0)
            var nueva = s.nueva && (s.repartida_en || []).indexOf(llave) === -1;
            var r = nueva ? {} : (previo[s.clave] || {});
            return '<tr data-clave="' + esc(s.clave) + '"' + (nueva ? ' class="isn-nueva" data-nueva="1"' : "") + '><td title="' + esc(s.nombre) + '">' +
                esc(s.clave) + " · " + esc(s.nombre.slice(0, 48)) + (nueva ? ' <span class="isn-sello-nueva">nueva</span>' : "") + "</td>" +
                '<td class="xml-num"><input type="number" min="0" step="1" class="rp-t" value="' + (r.trabajadores != null ? r.trabajadores : (suc.length === 1 ? "" : "")) + '"></td>' +
                '<td class="xml-num"><input type="number" min="0" step="1" class="rp-i" value="' + (r.impuesto != null ? r.impuesto : "") + '"></td></tr>';
        }).join("");
        $("reparto-nota").textContent = suc.length === 1 ? "Una sola sucursal: si la dejas vacía, lleva todo." :
            "Si dejas todo vacío se reparte como el último mes; si solo pones empleados, el impuesto se reparte según empleados.";
    }

    function filasReparto() {
        return Array.from(document.querySelectorAll("#reparto-filas tr")).map(function (tr) {
            var t = tr.querySelector(".rp-t").value, i = tr.querySelector(".rp-i").value;
            return { clave: tr.dataset.clave, trabajadores: t === "" ? null : +t, impuesto: i === "" ? null : +i, nueva: !!tr.dataset.nueva };
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
            trabajadores_sm: E.modo === "minimo" ? (+$("f-tsm").value || 0) : 0, remuneraciones_sm: 0,
            dias_sm: E.modo === "minimo" && (+$("f-tsm").value || 0) > 0 ? (+$("f-dias").value || diasDelMes()) : null,
            trabajadores_otro: +$("f-tot").value || 0, remuneraciones_otro: +$("f-rot").value || 0,
            tasa: $("f-tasa").value === "" ? null : +$("f-tasa").value,
            retenido: +$("f-ret").value || 0, trabajadores_especiales: +$("f-esp").value || 0,
            nombre: nombreDe($("f-rfc").value.trim().toUpperCase())
        };
        if (!$("reparto").hidden) {
            var filas = filasReparto();
            var sinPoner = filas.filter(function (r) { return r.nueva && r.trabajadores == null; });
            if (sinPoner.length) {
                $("form-error").textContent = "Sucursal nueva: " + sinPoner.map(function (r) { return r.clave; }).join(", ") +
                    ". Pon sus empleados (aunque sean 0) y reparte los demás; el reparto automático le daría 0.";
                $("form-error").hidden = false;
                return;
            }
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

    /* ------------------------------------------------------------ presentar por lote */
    function opcionesAnios(sel, elegido) {
        var hoy = new Date().getFullYear();
        sel.innerHTML = [hoy, hoy - 1, hoy - 2].map(function (a) { return '<option' + (a === elegido ? " selected" : "") + ">" + a + "</option>"; }).join("");
    }
    function mesAnterior() { var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return { anio: d.getFullYear(), mes: d.getMonth() + 1 }; }

    function abrirPlantilla() {
        // Solo la empresa abierta. Por omisión el mes pasado (el que normalmente se declara); siempre se ve antes de bajarla
        if (!E.rfc) { aviso("Elige una empresa.", true); return; }
        $("pl-titulo").textContent = "Plantilla de Excel · " + nombreDe(E.rfc);
        var m = mesAnterior();
        opcionesAnios($("pl-anio"), m.anio);
        $("pl-mes").innerHTML = MESES.map(function (n, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === m.mes ? " selected" : "") + ">" + n + "</option>"; }).join("");
        $("pl-error").hidden = true;
        resumenPlantilla();
        $("modal-plantilla").hidden = false;
    }

    function resumenPlantilla() {
        var a = +$("pl-anio").value, ms = +$("pl-mes").value;
        var tabla = (E.datos && E.datos.salarios_minimos) || {}, sm = tabla[a] && tabla[a].general;
        $("pl-resumen").textContent = MESES[ms - 1] + " " + a + ": " + new Date(a, ms, 0).getDate() + " días" +
            (sm ? " · salario mínimo zona general $" + sm.toFixed(2) : "") + ".";
    }

    function abrirPresentar(anio, mes) {
        // Por empresa: solo la abierta (lo de varias empresas está en la pestaña Masivo)
        if (!E.puedePresentar) return;
        if (!E.rfc) { aviso("Elige una empresa.", true); return; }
        $("p-titulo").textContent = "Presentar · " + nombreDe(E.rfc);
        var m = anio ? { anio: +anio, mes: +mes } : mesAnterior();
        opcionesAnios($("p-anio"), m.anio);
        $("p-mes").innerHTML = MESES.map(function (n, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === m.mes ? " selected" : "") + ">" + n + "</option>"; }).join("");
        $("p-error").hidden = true;
        $("modal-presentar").hidden = false;
        cargarListos();
    }

    async function cargarListos() {
        $("p-filas").innerHTML = '<tr><td colspan="7">Cargando…</td></tr>';
        try {
            var filas = await (await api("/api/isn/listos?anio=" + $("p-anio").value + "&mes=" + $("p-mes").value + "&rfc=" + encodeURIComponent(E.rfc))).json();
            $("p-filas").innerHTML = filas.length ? filas.map(function (f) {
                var listo = !f.faltan.length;
                // "¿Presentar?" del Excel: las que dicen No salen sin marcar (se pueden marcar aquí)
                return "<tr><td><input type=\"checkbox\" data-id=\"" + f.id + "\"" + (listo ? (f.presentar ? " checked" : "") : " disabled") + "></td>" +
                    "<td><b>" + esc(f.nombre || f.rfc) + "</b><br><span class=\"isn-nota\">" + esc(f.rfc) + " · " + esc(f.tipo) + "</span></td>" +
                    '<td class="xml-num">' + f.trabajadores + '</td><td class="xml-num">' + m(f.base) + '</td><td class="xml-num">' + m(f.impuesto) +
                    '</td><td class="xml-num">' + m(f.a_cargo) + "</td><td>" + (listo ? '<span class="xml-sello isn-sello-listo">Listo</span>' +
                    (f.presentar ? "" : '<br><span class="isn-nota">Excel: No</span>')
                    : '<span class="isn-motivo">' + esc(f.faltan.join(" ")) + "</span>") + "</td></tr>";
            }).join("") : '<tr><td colspan="7">Esta empresa no tiene declaración por presentar de ese mes. Captúrala o cárgala con el Excel.</td></tr>';
        } catch (e) { $("p-filas").innerHTML = ""; $("p-error").textContent = e.message; $("p-error").hidden = false; }
        contarElegidos();
    }

    function elegidos() { return Array.from(document.querySelectorAll("#p-filas input[data-id]:checked")).map(function (c) { return +c.dataset.id; }); }
    function contarElegidos() {
        var n = elegidos().length;
        $("p-enviar").disabled = !n;
        $("p-enviar").textContent = n ? "Presentar " + n + (n === 1 ? " declaración" : " declaraciones") : "Presentar";
        $("p-resumen").textContent = n ? n + " elegida(s)" : "";
    }

    async function revisarEnPortal() {
        var ids = elegidos();                                   // solo las marcadas
        if (!ids.length) { $("p-error").textContent = "Marca la que quieres revisar."; $("p-error").hidden = false; return; }
        var anio = $("p-anio").value, mes = $("p-mes").value;
        $("p-revisar").disabled = true;
        try {
            $("avance").hidden = true;
            var r = await json("/api/isn/portal/revisar", "POST", { ids: ids });
            $("modal-presentar").hidden = true;
            // Al terminar se vuelve a abrir la lista del mismo mes, ya sin las que estaban presentadas
            seguir(r.job_id, "Revisando en el portal · " + MESES[+mes - 1] + " " + anio, function () {
                abrirPresentar(anio, mes);
            });
        } catch (e) { $("p-error").textContent = e.message; $("p-error").hidden = false; }
        $("p-revisar").disabled = false;
    }

    async function enviarLote() {
        var ids = elegidos();
        if (!ids.length) return;
        var mes = MESES[+$("p-mes").value - 1] + " " + $("p-anio").value;
        if (!confirm("Se van a PRESENTAR " + ids.length + " declaración(es) de ISN de " + mes + " ante la SEFIPLAN.\n\n¿Todo bien? Esto no se puede deshacer.")) return;
        $("p-enviar").disabled = true;
        try {
            $("avance").hidden = true;
            var r = await json("/api/isn/presentar", "POST", { ids: ids });
            $("modal-presentar").hidden = true;
            seguir(r.job_id, "Presentando " + mes);
        } catch (e) { $("p-error").textContent = e.message; $("p-error").hidden = false; $("p-enviar").disabled = false; }
    }

    /* ------------------------------------------------------------ pestañas y masivo */
    function ponerVista(v, inicio) {
        E.vista = v;
        try { localStorage.setItem("isn:vista", v); } catch (e) { /* nada */ }
        document.querySelectorAll(".isn-pestanas button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.vista === v ? "true" : "false"); });
        $("vista-masivo").hidden = v !== "masivo";
        $("vista-empresa").hidden = v === "masivo";
        $("ctx-empresa").style.visibility = v === "masivo" ? "hidden" : "";   // conserva su lugar: la cabecera no brinca
        if (!inicio) aviso("");
        if (v === "masivo") {
            if (!E.mvListo) {
                var m = mesAnterior();
                opcionesAnios($("mv-anio"), m.anio);
                $("mv-mes").innerHTML = MESES.map(function (n, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === m.mes ? " selected" : "") + ">" + n + "</option>"; }).join("");
                E.mvListo = true;
            }
            $("mv-presentar").disabled = !E.puedePresentar;
            $("mv-presentar").title = E.puedePresentar ? "" : 'Pide el permiso "Presentar ISN" al administrador.';
            cargarMasivo();
        }
    }

    async function cargarMasivo() {
        $("mv-filas").innerHTML = '<tr><td colspan="7">Cargando…</td></tr>';
        try {
            E.masivo = await (await api("/api/isn/masivo?anio=" + $("mv-anio").value + "&mes=" + $("mv-mes").value)).json();
        } catch (e) { E.masivo = []; aviso(e.message, true); }
        pintarMasivo();
    }

    function estadoMasivo(x) {
        var p = x.periodo;
        if (p && p.presentada) return '<span class="isn-estado-ok">Presentada' + (p.folio ? " · folio " + esc(p.folio) : "") + "</span>";
        if (p && p.faltan.length) return '<span class="isn-estado-falta">' + esc(p.faltan.join(" ")) + "</span>";
        if (p) return '<span class="xml-sello isn-sello-listo">Lista</span>' + (p.presentar ? "" : ' <span class="isn-nota">Excel: No</span>');
        return '<span class="isn-estado-gris">Sin capturar' + (x.datos ? "" : " · faltan datos de la empresa") + "</span>";
    }

    function pintarMasivo() {
        var filas = E.masivo || [];
        $("mv-filas").innerHTML = filas.length ? filas.map(function (x) {
            var p = x.periodo, hecha = p && p.presentada;
            // Lo que marcaste a mano se respeta; si no, las que faltan, salvo las que en el Excel dijeron No
            var marcada = !hecha && (x.rfc in E.mvMarcas ? E.mvMarcas[x.rfc] : (!p || p.presentar));
            return '<tr><td><input type="checkbox" data-rfc="' + esc(x.rfc) + '"' + (marcada ? " checked" : "") + (hecha ? " disabled" : "") + "></td>" +
                '<td><button type="button" class="isn-enlace-empresa" data-abrir="' + esc(x.rfc) + '">' + esc(x.nombre || x.rfc) + '</button><br><span class="isn-nota">' + esc(x.rfc) + "</span></td>" +
                "<td>" + estadoMasivo(x) + "</td>" +
                '<td class="xml-num">' + (p ? p.trabajadores : "") + '</td><td class="xml-num">' + (p ? m(p.base) : "") +
                '</td><td class="xml-num">' + (p ? m(p.impuesto) : "") + '</td><td class="xml-num">' + (p ? m(p.a_cargo) : "") + "</td></tr>";
        }).join("") : '<tr><td colspan="7">No hay empresas con la obligación de ISN. Actívala en Clientes (editar → Obligaciones).</td></tr>';
        contarMasivo();
    }

    function marcadasMasivo() {
        var rfcs = Array.from(document.querySelectorAll("#mv-filas input[data-rfc]:checked")).map(function (c) { return c.dataset.rfc; });
        return (E.masivo || []).filter(function (x) { return rfcs.indexOf(x.rfc) !== -1; });
    }

    function contarMasivo() {
        var marcadas = marcadasMasivo();
        var listas = marcadas.filter(function (x) { return x.periodo && !x.periodo.presentada && !x.periodo.faltan.length; });
        var conPeriodo = marcadas.filter(function (x) { return x.periodo && !x.periodo.presentada; });
        $("mv-resumen").textContent = marcadas.length + " marcada(s) · " + listas.length + " lista(s) para presentar";
        $("mv-plantilla").disabled = !marcadas.length;
        $("mv-revisar").disabled = !conPeriodo.length;
        $("mv-presentar").disabled = !E.puedePresentar || !listas.length;
        $("mv-presentar").textContent = listas.length ? "Presentar " + listas.length : "Presentar marcadas";
    }

    async function plantillaMasivo() {
        var marcadas = marcadasMasivo(), a = $("mv-anio").value, ms = $("mv-mes").value;
        if (!marcadas.length) return;
        try {
            await bajar(await api("/api/isn/plantilla?anio=" + a + "&mes=" + ms + "&rfcs=" + encodeURIComponent(marcadas.map(function (x) { return x.rfc; }).join(","))),
                        "Plantilla_ISN_" + a + "-" + String(ms).padStart(2, "0") + ".xlsx");
        } catch (e) { aviso(e.message, true); }
    }

    async function revisarMasivo() {
        var van = marcadasMasivo().filter(function (x) { return x.periodo && !x.periodo.presentada; });
        if (!van.length) return;
        var mes = MESES[+$("mv-mes").value - 1] + " " + $("mv-anio").value;
        if (!confirm("Revisar en el portal " + van.length + " empresa(s) de " + mes + " (no se llena ni se presenta nada):\n\n" +
                     van.map(function (x) { return "• " + (x.nombre || x.rfc); }).join("\n"))) return;
        try {
            $("avance").hidden = true;
            var r = await json("/api/isn/portal/revisar", "POST", { ids: van.map(function (x) { return x.periodo.id; }) });
            seguir(r.job_id, "Revisando en el portal · " + mes, cargarMasivo);
        } catch (e) { aviso(e.message, true); }
    }

    async function presentarMasivo() {
        var marcadas = marcadasMasivo();
        var van = marcadas.filter(function (x) { return x.periodo && !x.periodo.presentada && !x.periodo.faltan.length; });
        var noVan = marcadas.filter(function (x) { return van.indexOf(x) === -1; });
        if (!van.length) return;
        var mes = MESES[+$("mv-mes").value - 1] + " " + $("mv-anio").value;
        if (!confirm("Se van a PRESENTAR " + van.length + " declaración(es) de ISN de " + mes + " ante la SEFIPLAN:\n\n" +
                     van.map(function (x) { return "• " + (x.nombre || x.rfc) + " — a cargo $" + m(x.periodo.a_cargo); }).join("\n") +
                     (noVan.length ? "\n\nNo van (no están listas o no tienen captura): " + noVan.map(function (x) { return x.nombre || x.rfc; }).join(", ") : "") +
                     "\n\n¿Todo bien? Esto no se puede deshacer.")) return;
        try {
            $("avance").hidden = true;
            var r = await json("/api/isn/presentar", "POST", { ids: van.map(function (x) { return x.periodo.id; }) });
            seguir(r.job_id, "Presentando " + mes, cargarMasivo);
        } catch (e) { aviso(e.message, true); }
    }

    /* ------------------------------------------------------------ descargar del portal */
    function abrirDescargar() {
        if (!E.rfc) { aviso("Elige una empresa.", true); return; }
        $("d-titulo").textContent = "Descargar acuses del portal · " + nombreDe(E.rfc);
        opcionesAnios($("d-anio"), +E.anio);
        $("d-error").hidden = true;
        $("modal-descargar").hidden = false;
        pintarMesesDescarga();
    }

    async function pintarMesesDescarga() {
        var anio = +$("d-anio").value, hoy = new Date(), tengo = {};
        try {
            var d = await (await api("/api/isn/periodos?rfc=" + encodeURIComponent(E.rfc) + "&anio=" + anio)).json();
            d.periodos.forEach(function (p) { if (p.tiene_acuse && p.tipo === "Normal") tengo[p.mes] = true; });
        } catch (e) { /* sin datos: todos sin marcar */ }
        var ultimo = anio < hoy.getFullYear() ? 12 : hoy.getMonth();          // hasta el mes pasado
        $("d-meses").innerHTML = MESES.map(function (n, i) {
            var mes = i + 1, ya = !!tengo[mes], posible = mes <= ultimo;
            return '<label class="' + (ya ? "isn-ya" : "") + '"><input type="checkbox" value="' + mes + '"' + (!ya && posible && mes === ultimo ? " checked" : "") +
                (posible ? "" : " disabled") + ">" + n.slice(0, 3) + (ya ? " ✓" : "") + "</label>";
        }).join("");
    }

    async function enviarDescarga() {
        var meses = Array.from(document.querySelectorAll("#d-meses input:checked")).map(function (c) { return +c.value; });
        if (!meses.length) { $("d-error").textContent = "Elige al menos un mes."; $("d-error").hidden = false; return; }
        if ($("d-ceros").checked && !confirm("El pago en ceros se GENERA en el portal en este momento (puede quedar registrado otra vez, con la fecha de hoy).\n\n" +
            "Solo aplica a las declaraciones en $0 y se salta las que ya lo tienen. ¿Lo genero?")) return;
        $("d-enviar").disabled = true;
        try {
            $("avance").hidden = true;
            var r = await json("/api/isn/descargar", "POST", { rfc: E.rfc, anio: +$("d-anio").value, meses: meses,
                pago_ceros: $("d-ceros").checked, forzar: $("d-forzar").checked });
            $("modal-descargar").hidden = true;
            if (r.job_id) seguir(r.job_id, "Descargando acuses · " + nombreDe(E.rfc));
            else { pintarAvance({ estado: "completado", renglones: r.renglones }, "Descargar acuses"); }
        } catch (e) { $("d-error").textContent = e.message; $("d-error").hidden = false; }
        $("d-enviar").disabled = false;
    }

    /* ------------------------------------------------------------ avance del robot */
    var ESTADOS_OK = { presentada: 1, descargado: 1, ya_estaba: 1, ya_lo_tenias: 1, por_presentar: 1 };
    var ESTADOS_MAL = { error: 1, rechazada: 1, sin_presentar: 1, cancelado: 1 };

    function pintarAvance(t, titulo) {
        $("avance").hidden = false;
        $("avance-titulo").textContent = titulo || "Tributanet";
        var corre = t.estado === "procesando";
        var hechos = (t.renglones || []).filter(function (r) { return ESTADOS_OK[r.estado] || ESTADOS_MAL[r.estado]; }).length;
        $("avance-estado").textContent = corre ? hechos + " de " + (t.renglones || []).length + "…" : (t.estado === "error" ? "Se detuvo con error" : "Terminó");
        $("avance-detener").hidden = !corre;
        $("avance-cerrar").hidden = corre;
        $("avance-filas").innerHTML = (t.renglones || []).map(function (r) {
            var clase = ESTADOS_OK[r.estado] ? "ok" : ESTADOS_MAL[r.estado] ? "mal" : r.estado === "trabajando" ? "va" : "";
            return '<li class="' + clase + '"><b>' + esc((r.nombre || r.rfc) + " · " + (r.mes_nombre || "") + " " + r.anio) + "</b>" + esc(r.mensaje || "") + "</li>";
        }).join("") + (t.error ? '<li class="mal"><b>Error</b>' + esc(t.error) + "</li>" : "");
    }

    function seguir(jobId, titulo, despues) {
        E.job = { id: jobId, titulo: titulo };
        clearTimeout(E.reloj);
        pintarAvance({ estado: "procesando", renglones: [] }, titulo);       // limpia lo del trabajo anterior
        var paso = async function () {
            try {
                var t = await (await api("/api/isn/trabajo/" + encodeURIComponent(jobId))).json();
                pintarAvance(t, titulo);
                if (t.estado === "procesando") { E.reloj = setTimeout(paso, 2500); return; }
                E.job = null;
                await cargarEmpresas();
                cargar();
                if (despues) despues();
            } catch (e) { E.reloj = setTimeout(paso, 5000); }
        };
        paso();
    }

    async function retomarTrabajo() {
        try {
            var t = await (await api("/api/isn/trabajo-activo")).json();
            if (t && t.job_id) seguir(t.job_id, { isn_presentar: "Presentando declaraciones", isn_revisar: "Revisando en el portal" }[t.tipo] || "Descargando acuses");
        } catch (e) { /* nada */ }
    }

    async function detenerTrabajo() {
        if (!E.job || !confirm("¿Detener? Se termina el que está en curso y ya no se empiezan los siguientes.")) return;
        try { await api("/api/isn/trabajo/" + encodeURIComponent(E.job.id) + "/detener", { method: "POST" }); } catch (e) { aviso(e.message, true); }
    }

    /* Desde Mis clientes: ?empresa=RFC&abrir=datos|acuse|descargar */
    function abrirDesdeUrl(que) {
        if (que === "datos" || que === "acuse") abrirDatos();     // el selector de archivos necesita un clic: ahí está "Llenar con un acuse"
        else if (que === "descargar") abrirDescargar();
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
        ["f-tsm", "f-dias", "f-tot", "f-rot", "f-ret", "f-anio"].forEach(function (id) { $(id).addEventListener("input", recalcular); });
        $("f-mes").addEventListener("change", function () { if (E.modo === "minimo") $("f-dias").value = diasDelMes(); recalcular(); });
        document.querySelector(".isn-modo").addEventListener("click", function (e) { var b = e.target.closest("[data-modo]"); if (b) ponerModo(b.dataset.modo); });
        $("btn-presentar").addEventListener("click", function () { abrirPresentar(); });
        $("btn-descargar").addEventListener("click", abrirDescargar);
        $("p-anio").addEventListener("change", cargarListos);
        $("p-mes").addEventListener("change", cargarListos);
        $("p-todos").addEventListener("change", function () {
            var on = this.checked; document.querySelectorAll("#p-filas input[data-id]:not(:disabled)").forEach(function (c) { c.checked = on; }); contarElegidos();
        });
        $("p-filas").addEventListener("change", contarElegidos);
        $("p-cancelar").addEventListener("click", function () { $("modal-presentar").hidden = true; });
        $("p-revisar").addEventListener("click", revisarEnPortal);
        document.querySelectorAll(".isn-pestanas button").forEach(function (b) { b.addEventListener("click", function () { ponerVista(b.dataset.vista); }); });
        $("mv-anio").addEventListener("change", function () { E.mvMarcas = {}; cargarMasivo(); });
        $("mv-mes").addEventListener("change", function () { E.mvMarcas = {}; cargarMasivo(); });
        $("mv-filas").addEventListener("change", function (e) {
            if (e.target.dataset.rfc) E.mvMarcas[e.target.dataset.rfc] = e.target.checked;
            contarMasivo();
        });
        $("mv-filas").addEventListener("click", function (e) {
            var b = e.target.closest("[data-abrir]"); if (!b) return;
            ponerVista("empresa"); abrir(b.dataset.abrir);
        });
        $("mv-todos").addEventListener("change", function () {
            var on = this.checked;
            document.querySelectorAll("#mv-filas input[data-rfc]:not(:disabled)").forEach(function (c) { c.checked = on; E.mvMarcas[c.dataset.rfc] = on; });
            contarMasivo();
        });
        $("mv-plantilla").addEventListener("click", plantillaMasivo);
        $("mv-excel").addEventListener("click", function () { $("in-excel").click(); });
        $("mv-revisar").addEventListener("click", revisarMasivo);
        $("mv-presentar").addEventListener("click", presentarMasivo);
        $("p-enviar").addEventListener("click", enviarLote);
        $("d-anio").addEventListener("change", pintarMesesDescarga);
        $("d-cancelar").addEventListener("click", function () { $("modal-descargar").hidden = true; $("modal-plantilla").hidden = true; });
        $("d-enviar").addEventListener("click", enviarDescarga);
        $("avance-cerrar").addEventListener("click", function () { $("avance").hidden = true; });
        $("avance-detener").addEventListener("click", detenerTrabajo);
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
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape") { $("modal").hidden = true; $("modal-datos").hidden = true; $("modal-presentar").hidden = true; $("modal-descargar").hidden = true; }
        });
        $("form-borrar").addEventListener("click", async function () {
            if (!E.editando || !confirm("¿Borrar " + E.editando.mes_nombre + " " + E.editando.anio + " (" + E.editando.tipo + ")? También se borra su acuse guardado.")) return;
            try { await api("/api/isn/periodo/" + E.editando.id, { method: "DELETE" }); $("modal").hidden = true; await cargarEmpresas(); cargar(); }
            catch (err) { $("form-error").textContent = err.message; $("form-error").hidden = false; }
        });
        $("btn-plantilla").addEventListener("click", abrirPlantilla);
        $("pl-anio").addEventListener("change", resumenPlantilla);
        $("pl-mes").addEventListener("change", resumenPlantilla);
        $("pl-cancelar").addEventListener("click", function () { $("modal-plantilla").hidden = true; });
        $("pl-bajar").addEventListener("click", async function () {
            var a = +$("pl-anio").value, ms = +$("pl-mes").value, b = this;
            b.disabled = true;
            try {
                await bajar(await api("/api/isn/plantilla?anio=" + a + "&mes=" + ms + "&rfc=" + encodeURIComponent(E.rfc)),
                            "Plantilla_ISN_" + E.rfc + "_" + a + "-" + String(ms).padStart(2, "0") + ".xlsx");
                $("modal-plantilla").hidden = true;
            } catch (e) { $("pl-error").textContent = e.message; $("pl-error").hidden = false; }
            b.disabled = false;
        });
        $("btn-excel").addEventListener("click", function () { $("in-excel").click(); });
        $("in-excel").addEventListener("change", async function () {
            var f = this.files[0]; this.value = ""; if (!f) return;
            var fd = new FormData(); fd.append("archivo", f);
            try {
                var r = await (await api("/api/isn/excel", { method: "POST", body: fd })).json();
                aviso("Se cargaron " + r.cargados + " periodo(s)" + (r.empresas ? " y los datos de " + r.empresas + " empresa(s)" : "") + "." +
                      (r.ya_presentadas ? " " + r.ya_presentadas + " ya estaban presentadas (no se tocaron)." : "") +
                      (r.sucursales_nuevas && r.sucursales_nuevas.length ? "\nSucursales nuevas (reparte sus empleados antes de presentar):\n" + r.sucursales_nuevas.join("\n") : "") +
                      (r.por_revisar && r.por_revisar.length ? "\nRevisa:\n" + r.por_revisar.join("\n") : "") +
                      (r.errores.length ? "\nNo se cargaron:\n" + r.errores.join("\n") : ""), r.errores.length > 0 || (r.por_revisar || []).length > 0);
                await cargarEmpresas();
                if (E.vista === "masivo") {
                    r.rfcs.forEach(function (rfc) { delete E.mvMarcas[rfc]; });   // las del Excel: manda su ¿Presentar?
                    cargarMasivo();
                }
                else if (r.rfcs.length && r.rfcs.indexOf(E.rfc) === -1) abrir(r.rfcs[0]); else cargar();
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
