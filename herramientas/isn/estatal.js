/*
 * herramientas/isn/estatal.js — Impuestos estatales de Quintana Roo (hospedaje, informativa, profesiones, alcohol)
 * con el mismo patrón que ISN: por empresa (periodos del año) y masivo (un mes, varias empresas).
 * El impuesto va en la dirección: estatal.html?i=ish | ish_inf | prof | alc.
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    var IMP = (new URLSearchParams(location.search).get("i") || "ish").toLowerCase();
    if (["ish", "ish_inf", "prof", "alc"].indexOf(IMP) === -1) IMP = "ish";
    var E = { cfg: null, imp: null, empresa: null, empresas: [], rfc: null, anio: new Date().getFullYear(), datos: null, editando: null,
              puedePresentar: false, job: null, reloj: null, vista: "empresa", masivo: [], mvListo: false, mvMarcas: {} };
    try { if (localStorage.getItem("est:vista") === "masivo") E.vista = "masivo"; } catch (e) { /* nada */ }

    async function api(ruta, opciones) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r;
    }
    function json(ruta, metodo, cuerpo) {
        return api(ruta, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }).then(function (r) { return r.json(); });
    }
    function m(v) { return v == null ? "" : Number(v).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
    function aviso(texto, error) { var a = $("aviso"); a.textContent = texto || ""; a.className = "isn-aviso" + (error ? " isn-aviso--error" : ""); a.hidden = !texto; }
    async function bajar(resp, porDefecto) {
        var mt = /filename="?([^";]+)"?/.exec(resp.headers.get("Content-Disposition") || "");
        Fiscontable.guardarArchivo(await resp.blob(), mt ? mt[1] : porDefecto);
    }
    function opcionesMeses(sel, elegido) {
        sel.innerHTML = MESES.map(function (n, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === elegido ? " selected" : "") + ">" + n + "</option>"; }).join("");
    }
    function opcionesAnios(sel, elegido) {
        var hoy = new Date().getFullYear();
        sel.innerHTML = [hoy, hoy - 1, hoy - 2, hoy - 3].map(function (a) { return "<option" + (a === elegido ? " selected" : "") + ">" + a + "</option>"; }).join("");
    }
    function mesAnterior() { var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return { anio: d.getFullYear(), mes: d.getMonth() + 1 }; }
    function esInf() { return !!E.imp.informativa; }
    function pesos(x) { return Math.round((+x || 0) + 1e-9); }

    /* ------------------------------------------------------------ inicio */
    async function iniciar() {
        if (!(await Fiscontable.exigirModulo("isn"))) return;
        try { E.cfg = await (await api("/api/estatales/config")).json(); } catch (e) { aviso(e.message, true); return; }
        E.imp = E.cfg.impuestos[IMP];
        document.title = E.imp.nombre + " · Fiscontable";
        $("titulo").textContent = E.imp.titulo;
        document.querySelectorAll(".est-impuestos a").forEach(function (a) { if (a.dataset.imp === IMP) a.setAttribute("aria-current", "page"); });
        document.querySelectorAll(".solo-inf").forEach(function (x) { x.hidden = !esInf(); });
        document.querySelectorAll(".solo-pago").forEach(function (x) { x.hidden = esInf(); });
        document.querySelectorAll(".solo-sistema").forEach(function (x) { x.hidden = !E.imp.sistema; });
        document.querySelectorAll(".solo-saldo").forEach(function (x) { x.hidden = !E.imp.saldo_favor; });
        if (E.imp.importe) $("etq-importe").textContent = E.imp.importe;
        if (E.imp.desglose) { $("th-base").textContent = E.imp.desglose[0]; $("th-imp").textContent = E.imp.desglose[1]; }
        $("mv-th-importe").textContent = esInf() ? "Establecimiento" : "Importe (A)";
        $("f-sistema").innerHTML = E.cfg.sistemas.map(function (s) { return "<option>" + esc(s) + "</option>"; }).join("");
        opcionesMeses($("f-mes"), new Date().getMonth() + 1);
        $("inf-campos").innerHTML = E.cfg.informativa.map(function (c) {
            return '<label>' + esc(c.titulo) + '<input type="number" min="0" step="any" data-inf="' + esc(c.name) + '" value="0"></label>';
        }).join("");
        eventos();
        E.empresa = await Fiscontable.empresaActiva();
        var perfil = await Fiscontable.perfil();
        E.puedePresentar = !!(perfil && (perfil.modulos_permitidos || []).indexOf("isn_presentar") !== -1);
        $("btn-presentar").disabled = !E.puedePresentar;
        $("nota-presentar").hidden = E.puedePresentar;
        await Promise.all([cargarEmpresas(), window.EstObligaciones ? EstObligaciones.cargar() : null]);
        var q = new URLSearchParams(location.search);
        abrir((q.get("empresa") || "").toUpperCase() || (E.empresa ? E.empresa.rfc : (E.empresas[0] && E.empresas[0].rfc)));
        if (q.get("abrir")) E.vista = "empresa";              // desde Mis clientes: va directo a la empresa
        ponerVista(E.vista, true);
        retomarTrabajo();
        if (q.get("abrir")) setTimeout(function () { abrirDesdeUrl(q.get("abrir")); }, 700);
        window.addEventListener("fiscontable:empresa", function (e) { E.empresa = e.detail; if (e.detail) abrir(e.detail.rfc); });
    }

    async function cargarEmpresas() {
        try { E.empresas = await (await api("/api/estatales/" + IMP + "/empresas")).json(); } catch (e) { E.empresas = []; }
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
        }).join("") : '<p class="xml-otra__nota">Todavía no hay empresas. Agrégalas en Masivo, captura un periodo o lee un acuse.</p>');
    }

    /* ------------------------------------------------------------ tabla por empresa */
    async function cargar() {
        if (!E.rfc) { E.datos = { periodos: [], anios: [], empresa: null }; pintar(); return; }
        try { E.datos = await (await api("/api/estatales/" + IMP + "/periodos?rfc=" + encodeURIComponent(E.rfc) + "&anio=" + E.anio)).json(); }
        catch (e) { aviso(e.message, true); return; }
        pintar();
    }

    function columnas() {
        var c = [["mes_nombre", "Mes", 96], ["tipo", "Tipo", 110]];
        if (esInf()) c.push(["establecimiento", "Establecimiento", 120]);
        c.push(["municipio", "Municipio", 140]);
        if (E.imp.sistema) c.push(["sistema", "Sistema", 110]);
        if (!esInf()) c.push(["importe", "Importe (A)", 120, 1], ["impuesto_b", "Impuesto (B)", 110, 1], ["a_cargo", "A cargo", 100, 1]);
        c.push(["presentada", "Estatus", 140]);
        if (!esInf()) c.push(["acuse_importe", "Pagado (acuse)", 110, 1]);
        c.push(["folio", "Folio", 110], ["referencia", "Referencia", 150], ["pdf", "PDF", 120], ["avisos", "Avisos", 280]);
        return c;
    }

    function estatus(f) {
        if (f.presentada) return '<span class="xml-sello xml-sello--verde">Presentada</span>';
        if (f.faltan && f.faltan.length) return '<span class="xml-sello xml-sello--ambar" title="' + esc(f.faltan.join(" ")) + '">Falta información</span>';
        return '<span class="xml-sello isn-sello-listo">Por presentar · lista</span>';
    }

    function candadoObligacion() {
        if (!window.EstObligaciones) return false;
        var c = E.empresas.find(function (x) { return x.rfc === E.rfc; });
        return EstObligaciones.aplicar({ imp: IMP, rfc: E.rfc, nombre: nombreDe(E.rfc), periodos: (c && c.periodos) || 0, vista: E.vista,
            alActivar: function () { cargarEmpresas().then(cargar); } });
    }

    function pintar() {
        candadoObligacion();
        var anios = new Set((E.datos.anios || []).concat([E.anio, new Date().getFullYear()]));
        $("sel-anio").innerHTML = Array.from(anios).sort().reverse().map(function (a) { return '<option value="' + a + '"' + (+a === +E.anio ? " selected" : "") + ">" + a + "</option>"; }).join("");
        var filas = E.datos.periodos, cols = columnas();
        var porPresentar = filas.filter(function (f) { return !f.presentada; });
        var suma = function (k, l) { return l.reduce(function (s, f) { return s + (f[k] || 0); }, 0); };
        $("resumen").innerHTML = E.rfc && filas.length ? (esInf() ? "" :
            '<div class="ctx-resumen__dato"><small>Impuesto del año</small><b>$' + m(suma("impuesto_b", filas)) + "</b></div>" +
            '<div class="ctx-resumen__dato"><small>Pagado según acuses</small><b>$' + m(suma("acuse_importe", filas)) + "</b></div>") +
            '<div class="ctx-resumen__dato' + (porPresentar.length ? " ctx-resumen__dato--alerta" : "") + '"><small>Por presentar</small><b>' + porPresentar.length + "</b></div>" : "";
        $("thead").innerHTML = "<tr>" + cols.map(function (c) { return "<th" + (c[3] ? ' class="xml-num"' : "") + ' style="width:' + c[2] + "px;min-width:" + c[2] + 'px">' + c[1] + "</th>"; }).join("") + "</tr>";
        $("tbody").innerHTML = filas.map(function (f) {
            return '<tr data-id="' + f.id + '">' + cols.map(function (c) {
                switch (c[0]) {
                    case "presentada": return "<td>" + estatus(f) + "</td>";
                    case "pdf": return "<td>" + (f.tiene_acuse ? '<a class="xml-enlace" data-pdf="acuse" data-id="' + f.id + '" href="' + API + "/api/estatales/acuse/" + f.id + '">Acuse</a>' : "") +
                        (f.tiene_pago_ceros ? ' · <a class="xml-enlace" data-pdf="ceros" data-id="' + f.id + '" href="' + API + "/api/estatales/pago-ceros/" + f.id + '">' + (esInf() ? "Presentación" : "Ceros") + "</a>" : "") + "</td>";
                    case "avisos": var t = (f.faltan || []).concat(f.avisos || []); return '<td title="' + esc(t.join(" · ")) + '" style="color:rgb(var(--av-600))">' + esc(t.join(" · ")) + "</td>";
                    default: return "<td" + (c[3] ? ' class="xml-num"' : "") + ">" + (c[3] ? m(f[c[0]]) : esc(f[c[0]] == null ? "" : f[c[0]])) + "</td>";
                }
            }).join("") + "</tr>";
        }).join("");
        pintarDatos();
        $("sin-filas").hidden = filas.length > 0;
        $("sin-filas").textContent = !E.rfc ? "Elige una empresa, captura un periodo o lee un acuse." : "Sin periodos de " + E.anio + ". Captura uno, carga el Excel o lee los acuses.";
    }

    /* ------------------------------------------------------------ datos de la empresa */
    function pintarDatos() {
        var caja = $("datos-empresa"), d = E.datos.empresa;
        caja.hidden = !E.rfc;
        if (!E.rfc) return;
        if (!d || d.sugerido) {
            caja.className = "isn-datos isn-datos--vacio";
            caja.innerHTML = "<span>" + (d ? "Datos sugeridos (" + esc(d.origen || "") + "): revísalos y guárdalos." : "Faltan los datos de la declaración (domicilio, localidad, giro y firma).") + "</span>" +
                '<span class="isn-datos__acciones"><button type="button" class="xml-enlace" data-accion="acuse">Subir el acuse de un mes anterior</button>' +
                '<button type="button" class="xml-enlace" data-accion="datos">' + (d ? "Revisarlos" : "Capturarlos") + "</button></span>";
            return;
        }
        caja.className = "isn-datos";
        var dom = [d.domicilio, d.numero_exterior, d.numero_interior, d.colonia, d.codigo_postal ? "CP " + d.codigo_postal : "", d.localidad].filter(Boolean).join(", ");
        caja.innerHTML = "<span><b>" + esc(dom || "Sin domicilio") + "</b></span>" + (esInf() ? "" : "<span>Giro: <b>" + esc(d.giro || "—") + "</b></span>") +
            (E.imp.sistema ? "<span>Sistema: <b>" + esc(d.sistema || "—") + "</b></span>" : "") +
            "<span>Firma: <b>" + esc(d.firma || "—") + "</b></span><span>" + (d.establecimientos || []).length + " establecimiento(s)</span>" +
            (d.origen === "acuse" && d.periodo_origen ? '<span class="isn-nota">del acuse ' + esc(d.periodo_origen) + "</span>" : "") +
            '<span class="isn-datos__acciones"><button type="button" class="xml-enlace" data-accion="datos">Editar</button></span>';
    }

    function abrirDatos() {
        if (!E.rfc) { aviso("Elige una empresa.", true); return; }
        var d = E.datos.empresa || {};
        $("datos-titulo").textContent = "Datos de la declaración · " + E.rfc;
        $("datos-nota").textContent = d.sugerido ? "Sugeridos de " + (d.origen || "otro impuesto").replace("sugerido de ", "") + ": revísalos y guarda." : "Se llenan solos con el acuse más reciente. Así quedan en Tributanet.";
        var campos = E.cfg.datos.filter(function (c) { return !(esInf() && c.clave === "giro"); });
        $("datos-campos").innerHTML = '<label>Municipio<input data-campo="municipio" value="' + esc(d.municipio || "") + '"></label>' +
            (E.imp.sistema ? '<label>Sistema<select data-campo="sistema">' + ["", "Todo incluido", "Normal", "Mixto"].map(function (s) {
                return "<option" + (s === (d.sistema || "") ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select></label>" : "") +
            campos.map(function (c) {
                return "<label" + (c.largo > 40 ? ' class="isn-ancho"' : "") + ">" + esc(c.titulo) + (c.obligatorio ? " *" : "") +
                    '<input data-campo="' + c.clave + '" maxlength="' + c.largo + '" value="' + esc(d[c.clave] || "") + '"></label>';
            }).join("");
        $("datos-obligacion").checked = d.obligacion == null ? true : !!d.obligacion;
        $("est-filas").innerHTML = "";
        (d.establecimientos && d.establecimientos.length ? d.establecimientos : [{}]).forEach(filaEst);
        $("datos-error").hidden = true;
        $("modal-datos").hidden = false;
    }
    function filaEst(s) {
        var tr = document.createElement("tr");
        tr.innerHTML = '<td><input class="es-clave" maxlength="6" placeholder="01001" value="' + esc(s.clave || "") + '"></td>' +
            '<td><input class="es-nombre" value="' + esc(s.nombre || "") + '"></td><td><button type="button" class="isn-quitar" title="Quitar">×</button></td>';
        $("est-filas").appendChild(tr);
    }
    async function guardarDatos(ev) {
        ev.preventDefault();
        var cuerpo = { rfc: E.rfc, nombre: nombreDe(E.rfc), establecimientos: [], obligacion: $("datos-obligacion").checked };
        document.querySelectorAll("#datos-campos [data-campo]").forEach(function (i) { cuerpo[i.dataset.campo] = i.value.trim(); });
        document.querySelectorAll("#est-filas tr").forEach(function (tr) {
            var c = tr.querySelector(".es-clave").value.trim();
            if (c) cuerpo.establecimientos.push({ clave: c, nombre: tr.querySelector(".es-nombre").value.trim() });
        });
        try {
            var r = await json("/api/estatales/" + IMP + "/empresa", "PUT", cuerpo);
            $("modal-datos").hidden = true;
            aviso("Datos de la declaración guardados." + (r.avisos && r.avisos.length ? "\n" + r.avisos.join("\n") : ""), !!(r.avisos && r.avisos.length));
            await cargarEmpresas();
            cargar();
        } catch (err) { $("datos-error").textContent = err.message; $("datos-error").hidden = false; }
    }

    /* ------------------------------------------------------------ captura de un periodo */
    function establecimientos() { return ((E.datos && E.datos.empresa) || {}).establecimientos || []; }

    function abrirForm(f) {
        if (f && f.presentada) { aviso("Ese periodo ya está presentado: no se edita. Su acuse está en la columna PDF."); return; }
        E.editando = f || null;
        $("form-titulo").textContent = f ? E.imp.nombre + " · " + f.mes_nombre + " " + f.anio + " · " + f.tipo : "Nuevo periodo · " + E.imp.nombre;
        var emp = (E.datos && E.datos.empresa) || {};
        $("f-rfc").value = f ? f.rfc : (E.rfc || "");
        $("f-rfc").readOnly = !!f;
        var ma = mesAnterior();
        $("f-anio").value = f ? f.anio : ma.anio;
        $("f-mes").value = f ? f.mes : ma.mes;
        $("f-tipo").value = f ? f.tipo : "Normal";
        $("f-municipio").value = f ? (f.municipio || "") : (emp.municipio || "");
        $("f-sistema").value = (f && f.sistema) || emp.sistema || "Normal";
        $("f-importe").value = f ? (f.importe || 0) : 0;
        $("f-saldo").value = f ? (f.saldo_favor || 0) : 0;
        var ests = establecimientos();
        $("f-est").innerHTML = (ests.length === 1 ? "" : '<option value="">' + (ests.length ? "Elegir…" : "El único del portal") + "</option>") +
            ests.map(function (e) { return '<option value="' + esc(e.clave) + '">' + esc(e.clave + " · " + (e.nombre || "")) + "</option>"; }).join("");
        $("f-est").value = f ? (f.establecimiento || "") : (ests.length === 1 ? ests[0].clave : "");
        document.querySelectorAll("[data-inf]").forEach(function (i) { i.value = f && f.campos && f.campos[i.dataset.inf] != null ? f.campos[i.dataset.inf] : 0; });
        pintarDesglose(f);
        $("form-borrar").hidden = !f;
        $("form-error").hidden = true;
        $("modal").hidden = false;
        recalcular();
    }

    function calculo() {
        var a = pesos($("f-importe").value), tasa = E.imp.tasa;
        var b = tasa == null ? null : Math.round(a * tasa + 1e-9);
        var saldo = E.imp.saldo_favor ? pesos($("f-saldo").value) : 0;
        return { a: a, b: b, cargo: b == null || $("f-tipo").value === "Complementaria" ? null : Math.max(b - saldo, 0), tasa: tasa };
    }
    function recalcular() {
        if (esInf()) return;
        var c = calculo();
        $("c-tasa").textContent = c.tasa != null ? (c.tasa * 100).toLocaleString("es-MX", { maximumFractionDigits: 2 }) + " %" : "—";
        $("c-imp").textContent = c.b != null ? "$" + m(c.b) : "—";
        $("c-cargo").textContent = c.cargo != null ? "$" + m(c.cargo) : ($("f-tipo").value === "Complementaria" ? "Lo calcula el portal" : "—");
        sumasDesglose();
    }

    function pintarDesglose(f) {
        var ests = establecimientos(), caja = $("desglose");
        caja.hidden = esInf() || ests.length < 2;
        if (caja.hidden) { $("desglose-filas").innerHTML = ""; return; }
        var previo = {};
        ((f && f.desglose_manual && f.desglose) || []).forEach(function (r) { previo[r.clave] = r; });
        $("desglose-filas").innerHTML = ests.map(function (e) {
            var r = previo[e.clave] || {};
            return '<tr data-clave="' + esc(e.clave) + '"><td>' + esc(e.clave + " · " + (e.nombre || "").slice(0, 48)) + "</td>" +
                '<td class="xml-num"><input type="number" min="0" step="1" class="dg-b" value="' + (r.base != null ? r.base : "") + '"></td>' +
                '<td class="xml-num"><input type="number" min="0" step="1" class="dg-i" value="' + (r.impuesto != null ? r.impuesto : "") + '"></td></tr>';
        }).join("");
        sumasDesglose();
    }
    function filasDesglose() {
        return Array.from(document.querySelectorAll("#desglose-filas tr")).map(function (tr) {
            var b = tr.querySelector(".dg-b").value, i = tr.querySelector(".dg-i").value;
            return { clave: tr.dataset.clave, base: b === "" ? null : +b, impuesto: i === "" ? null : +i };
        });
    }
    function sumasDesglose() {
        if ($("desglose").hidden) return;
        var c = calculo(), filas = filasDesglose();
        var vacio = filas.every(function (r) { return r.base == null && r.impuesto == null; });
        var sb = filas.reduce(function (s, r) { return s + (r.base || 0); }, 0), si = filas.reduce(function (s, r) { return s + (r.impuesto || 0); }, 0);
        var sinImp = filas.every(function (r) { return r.impuesto == null; });
        $("dg-base").innerHTML = vacio ? "automático" : '<span class="' + (sb === c.a ? "isn-bien" : "isn-mal") + '">' + m(sb) + " de " + m(c.a) + "</span>";
        $("dg-imp").innerHTML = vacio || sinImp ? "automático" : '<span class="' + (si === c.b ? "isn-bien" : "isn-mal") + '">' + m(si) + " de " + m(c.b) + "</span>";
    }
    function repartirImpuesto() {
        var c = calculo(), trs = Array.from(document.querySelectorAll("#desglose-filas tr"));
        var bases = trs.map(function (tr) { return +tr.querySelector(".dg-b").value || 0; }), suma = bases.reduce(function (a, b) { return a + b; }, 0);
        if (!suma) { $("form-error").textContent = "Pon primero la base de cada establecimiento."; $("form-error").hidden = false; return; }
        var crudos = bases.map(function (b) { return c.b * b / suma; }), ent = crudos.map(Math.floor);
        var faltan = c.b - ent.reduce(function (a, b) { return a + b; }, 0);
        crudos.map(function (x, i) { return [x - ent[i], i]; }).sort(function (a, b) { return b[0] - a[0]; }).slice(0, faltan).forEach(function (x) { ent[x[1]]++; });
        trs.forEach(function (tr, i) { tr.querySelector(".dg-i").value = ent[i]; });
        $("form-error").hidden = true;
        sumasDesglose();
    }

    async function guardar(ev) {
        ev.preventDefault();
        var cuerpo = { rfc: $("f-rfc").value.trim().toUpperCase(), anio: +$("f-anio").value, mes: +$("f-mes").value, tipo: $("f-tipo").value,
                       municipio: $("f-municipio").value.trim(), nombre: nombreDe($("f-rfc").value.trim().toUpperCase()) };
        if (E.imp.sistema) cuerpo.sistema = $("f-sistema").value;
        if (esInf()) {
            cuerpo.establecimiento = $("f-est").value;
            cuerpo.campos = {};
            document.querySelectorAll("[data-inf]").forEach(function (i) { cuerpo.campos[i.dataset.inf] = i.value === "" ? 0 : +i.value; });
        } else {
            cuerpo.importe = +$("f-importe").value || 0;
            if (E.imp.saldo_favor) cuerpo.saldo_favor = +$("f-saldo").value || 0;
            if (!$("desglose").hidden) {
                var filas = filasDesglose();
                if (filas.some(function (r) { return r.base != null; })) cuerpo.desglose = filas;
            }
        }
        try {
            var f = await json("/api/estatales/" + IMP + "/periodo", "PUT", cuerpo);
            $("modal").hidden = true;
            aviso("Guardado: " + f.mes_nombre + " " + f.anio + (f.a_cargo != null ? " · a cargo $" + m(f.a_cargo) : "") + "." +
                  (f.faltan && f.faltan.length ? "\nFalta: " + f.faltan.join(" ") : ""), !!(f.faltan && f.faltan.length));
            E.anio = f.anio;
            await cargarEmpresas();
            abrir(f.rfc);
        } catch (err) { $("form-error").textContent = err.message; $("form-error").hidden = false; }
    }

    /* ------------------------------------------------------------ presentar (una empresa) */
    function abrirPresentar(anio, mes) {
        if (!E.puedePresentar) return;
        if (!E.rfc) { aviso("Elige una empresa.", true); return; }
        $("p-titulo").textContent = "Presentar " + E.imp.nombre.toLowerCase() + " · " + nombreDe(E.rfc);
        var ma = anio ? { anio: +anio, mes: +mes } : mesAnterior();
        opcionesAnios($("p-anio"), ma.anio);
        opcionesMeses($("p-mes"), ma.mes);
        $("p-error").hidden = true;
        $("modal-presentar").hidden = false;
        cargarListos();
    }
    async function cargarListos() {
        $("p-filas").innerHTML = '<tr><td colspan="6">Cargando…</td></tr>';
        try {
            var d = await (await api("/api/estatales/" + IMP + "/periodos?rfc=" + encodeURIComponent(E.rfc) + "&anio=" + $("p-anio").value)).json();
            var filas = d.periodos.filter(function (f) { return f.mes === +$("p-mes").value && !f.presentada; });
            $("p-filas").innerHTML = filas.length ? filas.map(function (f) {
                var listo = !f.faltan.length;
                return '<tr><td><input type="checkbox" data-id="' + f.id + '"' + (listo ? (f.presentar !== 0 ? " checked" : "") : " disabled") + "></td>" +
                    "<td><b>" + esc(f.tipo) + (f.establecimiento ? " · " + esc(f.establecimiento) : "") + '</b><br><span class="isn-nota">' + esc(f.municipio || "") + "</span></td>" +
                    '<td class="xml-num">' + m(f.importe) + '</td><td class="xml-num">' + m(f.impuesto_b) + '</td><td class="xml-num">' + m(f.a_cargo) + "</td>" +
                    "<td>" + (listo ? '<span class="xml-sello isn-sello-listo">Lista</span>' : '<span class="isn-motivo">' + esc(f.faltan.join(" ")) + "</span>") + "</td></tr>";
            }).join("") : '<tr><td colspan="6">No hay declaración por presentar de ese mes. Captúrala o cárgala con el Excel.</td></tr>';
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
    async function revisarEnPortal(ids, titulo, despues) {
        try {
            $("avance").hidden = true;
            var r = await json("/api/estatales/portal/revisar", "POST", { ids: ids });
            seguir(r.job_id, titulo, despues);
            return true;
        } catch (e) { aviso(e.message, true); return false; }
    }
    async function presentar(ids, texto, despues) {
        if (!(await Fiscontable.preguntar(texto + "\n\n¿Todo bien? Esto no se puede deshacer."))) return false;
        try {
            $("avance").hidden = true;
            var r = await json("/api/estatales/presentar", "POST", { ids: ids });
            seguir(r.job_id, "Presentando " + E.imp.nombre.toLowerCase(), despues);
            if (r.no_van && r.no_van.length) aviso("No van (no están listas): " + r.no_van.map(function (x) { return (x.nombre || x.rfc) + ": " + x.motivo; }).join("\n"), true);
            return true;
        } catch (e) { aviso(e.message, true); return false; }
    }

    /* ------------------------------------------------------------ masivo */
    function ponerVista(v, inicio) {
        E.vista = v;
        try { localStorage.setItem("est:vista", v); } catch (e) { /* nada */ }
        document.querySelectorAll(".isn-pestanas button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.vista === v ? "true" : "false"); });
        $("vista-masivo").hidden = v !== "masivo";
        $("vista-empresa").hidden = v === "masivo";
        if (!inicio) candadoObligacion();
        $("ctx-empresa").style.visibility = v === "masivo" ? "hidden" : "";
        if (!inicio) aviso("");
        if (v === "masivo") {
            if (!E.mvListo) { var ma = mesAnterior(); opcionesAnios($("mv-anio"), ma.anio); opcionesMeses($("mv-mes"), ma.mes); E.mvListo = true; }
            cargarMasivo();
        }
    }
    async function cargarMasivo() {
        $("mv-filas").innerHTML = '<tr><td colspan="6">Cargando…</td></tr>';
        try { E.masivo = await (await api("/api/estatales/" + IMP + "/masivo?anio=" + $("mv-anio").value + "&mes=" + $("mv-mes").value)).json(); }
        catch (e) { E.masivo = []; aviso(e.message, true); }
        pintarMasivo();
    }
    function llave(x) { return x.rfc + "|" + (x.periodo ? x.periodo.establecimiento || "" : ""); }
    function estadoMasivo(x) {
        var p = x.periodo;
        if (p && p.presentada) return '<span class="isn-estado-ok">Presentada' + (p.folio ? " · folio " + esc(p.folio) : "") + "</span>";
        if (p && p.faltan.length) return '<span class="isn-estado-falta">' + esc(p.faltan.join(" ")) + "</span>";
        if (p) return '<span class="xml-sello isn-sello-listo">Lista</span>' + (p.en_ceros ? ' <span class="isn-nota">en ceros</span>' : "") + (p.presentar === 0 ? ' <span class="isn-nota">Excel: No</span>' : "");
        return '<span class="isn-estado-gris">Sin capturar' + (x.datos ? "" : " · faltan datos de la empresa") + "</span>";
    }
    function pintarMasivo() {
        var filas = E.masivo || [];
        $("mv-filas").innerHTML = filas.length ? filas.map(function (x) {
            var p = x.periodo, hecha = p && p.presentada, k = llave(x);
            var marcada = !hecha && (k in E.mvMarcas ? E.mvMarcas[k] : (!p || p.presentar !== 0));
            return '<tr><td><input type="checkbox" data-llave="' + esc(k) + '"' + (marcada ? " checked" : "") + (hecha ? " disabled" : "") + "></td>" +
                '<td><button type="button" class="isn-enlace-empresa" data-abrir="' + esc(x.rfc) + '">' + esc(x.nombre || x.rfc) + '</button><br><span class="isn-nota">' + esc(x.rfc) + "</span></td>" +
                "<td>" + estadoMasivo(x) + "</td>" +
                '<td class="xml-num">' + (p ? (esInf() ? esc(p.establecimiento || "—") : m(p.importe)) : "") + '</td><td class="xml-num">' + (p && !esInf() ? m(p.impuesto_b) : "") +
                '</td><td class="xml-num">' + (p && !esInf() ? m(p.a_cargo) : "") + "</td></tr>";
        }).join("") : '<tr><td colspan="6">No hay empresas que presenten ' + esc(E.imp.nombre.toLowerCase()) + '. Usa «+ Agregar empresas».</td></tr>';
        contarMasivo();
    }
    function marcadas() {
        var ks = Array.from(document.querySelectorAll("#mv-filas input[data-llave]:checked")).map(function (c) { return c.dataset.llave; });
        return (E.masivo || []).filter(function (x) { return ks.indexOf(llave(x)) !== -1; });
    }
    function contarMasivo() {
        var mk = marcadas();
        var listas = mk.filter(function (x) { return x.periodo && !x.periodo.presentada && !x.periodo.faltan.length; });
        var con = mk.filter(function (x) { return x.periodo && !x.periodo.presentada; });
        var sin = mk.filter(function (x) { return !x.periodo; });
        $("mv-resumen").textContent = mk.length + " marcada(s) · " + listas.length + " lista(s) para presentar";
        $("mv-plantilla").disabled = !mk.length;
        $("mv-ceros").disabled = !sin.length;
        $("mv-ceros").textContent = sin.length ? "0 En ceros (" + sin.length + ")" : "0 En ceros";
        $("mv-revisar").disabled = !con.length;
        $("mv-quitar").disabled = !con.length;
        $("mv-presentar").disabled = !E.puedePresentar || !listas.length;
        $("mv-presentar").textContent = listas.length ? "Presentar " + listas.length : "Presentar marcadas";
    }
    function mesMasivo() { return MESES[+$("mv-mes").value - 1] + " " + $("mv-anio").value; }

    async function cerosMasivo() {
        var van = marcadas().filter(function (x) { return !x.periodo; });
        if (!van.length) return;
        if (!(await Fiscontable.preguntar("Se crea la declaración EN CEROS de " + mesMasivo() + " de:\n\n" + van.map(function (x) { return "• " + (x.nombre || x.rfc); }).join("\n") +
                     "\n\nNo se presenta nada todavía: después revisas y presentas."))) return;
        try {
            var r = await json("/api/estatales/" + IMP + "/masivo/ceros", "POST", { anio: +$("mv-anio").value, mes: +$("mv-mes").value, rfcs: van.map(function (x) { return x.rfc; }) });
            aviso("Se crearon " + r.creadas.length + " declaración(es) en ceros." + (r.ya_estaban.length ? " Ya existían: " + r.ya_estaban.join(", ") : ""));
            await cargarEmpresas(); cargarMasivo();
        } catch (e) { aviso(e.message, true); }
    }
    async function quitarMasivo() {
        var van = marcadas().filter(function (x) { return x.periodo && !x.periodo.presentada; });
        if (!van.length || !(await Fiscontable.preguntar("Se BORRA la declaración de " + mesMasivo() + " de:\n\n" + van.map(function (x) { return "• " + (x.nombre || x.rfc); }).join("\n") +
                                    "\n\nNo se toca nada en el portal."))) return;
        try {
            var r = await json("/api/estatales/" + IMP + "/masivo/quitar", "POST", { anio: +$("mv-anio").value, mes: +$("mv-mes").value, rfcs: van.map(function (x) { return x.rfc; }) });
            aviso("Se quitaron " + r.borradas.length + " declaración(es)." + (r.presentadas.length ? " Las presentadas no se tocan." : ""));
            E.mvMarcas = {}; await cargarEmpresas(); cargarMasivo();
        } catch (e) { aviso(e.message, true); }
    }
    async function plantilla(rfcs, anio, mes) {
        try {
            await bajar(await api("/api/estatales/" + IMP + "/plantilla?anio=" + anio + "&mes=" + mes + "&rfcs=" + encodeURIComponent(rfcs.join(","))),
                        "Plantilla_" + E.imp.nombre.replace(/ /g, "_") + "_" + anio + "-" + String(mes).padStart(2, "0") + ".xlsx");
            return true;
        } catch (e) { aviso(e.message, true); return false; }
    }

    /* Agregar empresas de los clientes */
    var CLIENTES = [];
    async function abrirAgregar() {
        $("ag-titulo").textContent = "Empresas que presentan " + E.imp.nombre.toLowerCase();
        $("ag-error").hidden = true;
        try { CLIENTES = await (await api("/api/clientes")).json(); }
        catch (e) { CLIENTES = []; $("ag-error").textContent = "No se pudo leer la lista de clientes: " + e.message; $("ag-error").hidden = false; }
        var activos = {};
        E.empresas.forEach(function (x) { if (x.obligacion) activos[x.rfc] = true; });
        CLIENTES.forEach(function (c) { c.activa = !!activos[c.rfc]; c.antes = c.activa; });
        $("ag-buscar").value = "";
        pintarAgregar();
        $("modal-agregar").hidden = false;
    }
    function pintarAgregar() {
        var q = $("ag-buscar").value.trim().toLowerCase();
        var lista = CLIENTES.filter(function (c) { return !q || (c.rfc + " " + (c.razon_social || "") + " " + (c.alias || "")).toLowerCase().indexOf(q) !== -1; });
        $("ag-lista").innerHTML = lista.length ? lista.map(function (c) {
            return '<label><input type="checkbox" data-rfc="' + esc(c.rfc) + '"' + (c.activa ? " checked" : "") + "><span><b>" + esc(c.razon_social || c.alias || c.rfc) +
                '</b><small>' + esc(c.rfc) + "</small></span></label>";
        }).join("") : '<p class="isn-nota">Sin coincidencias.</p>';
    }
    async function guardarAgregar() {
        var alta = CLIENTES.filter(function (c) { return c.activa && !c.antes; }).map(function (c) { return c.rfc; });
        var baja = CLIENTES.filter(function (c) { return !c.activa && c.antes; }).map(function (c) { return c.rfc; });
        try {
            if (alta.length) await json("/api/estatales/" + IMP + "/obligacion", "POST", { rfcs: alta, activa: true });
            if (baja.length) await json("/api/estatales/" + IMP + "/obligacion", "POST", { rfcs: baja, activa: false });
            $("modal-agregar").hidden = true;
            aviso((alta.length ? "Se agregaron " + alta.length + " empresa(s). " : "") + (baja.length ? "Se quitaron " + baja.length + "." : "") || "Sin cambios.");
            await cargarEmpresas(); cargarMasivo();
        } catch (e) { $("ag-error").textContent = e.message; $("ag-error").hidden = false; }
    }

    /* ------------------------------------------------------------ descargar del portal */
    function abrirDescargar() {
        if (!E.rfc) { aviso("Elige una empresa.", true); return; }
        $("d-titulo").textContent = "Descargar acuses del portal · " + nombreDe(E.rfc);
        opcionesAnios($("d-anio"), +E.anio);
        var ests = establecimientos();
        $("d-est").innerHTML = (ests.length === 1 ? "" : '<option value="">El único del portal</option>') +
            ests.map(function (e) { return '<option value="' + esc(e.clave) + '">' + esc(e.clave + " · " + (e.nombre || "")) + "</option>"; }).join("");
        $("d-error").hidden = true;
        $("modal-descargar").hidden = false;
        pintarMesesDescarga();
    }
    async function pintarMesesDescarga() {
        var anio = +$("d-anio").value, hoy = new Date(), tengo = {};
        try {
            var d = await (await api("/api/estatales/" + IMP + "/periodos?rfc=" + encodeURIComponent(E.rfc) + "&anio=" + anio)).json();
            d.periodos.forEach(function (p) { if (p.tiene_acuse && p.tipo === "Normal" && (!esInf() || (p.establecimiento || "") === $("d-est").value)) tengo[p.mes] = true; });
        } catch (e) { /* nada */ }
        var ultimo = anio < hoy.getFullYear() ? 12 : hoy.getMonth();
        $("d-meses").innerHTML = MESES.map(function (n, i) {
            var mes = i + 1, ya = !!tengo[mes], posible = mes <= ultimo;
            return '<label class="' + (ya ? "isn-ya" : "") + '"><input type="checkbox" value="' + mes + '"' + (!ya && posible && mes === ultimo ? " checked" : "") +
                (posible ? "" : " disabled") + ">" + n.slice(0, 3) + (ya ? " ✓" : "") + "</label>";
        }).join("");
    }
    async function enviarDescarga() {
        var meses = Array.from(document.querySelectorAll("#d-meses input:checked")).map(function (c) { return +c.value; });
        if (!meses.length) { $("d-error").textContent = "Elige al menos un mes."; $("d-error").hidden = false; return; }
        if ($("d-ceros").checked && !(await Fiscontable.preguntar("El pago en ceros se GENERA en el portal en este momento. Solo aplica a declaraciones en $0. ¿Lo genero?"))) return;
        $("d-enviar").disabled = true;
        try {
            $("avance").hidden = true;
            var r = await json("/api/estatales/" + IMP + "/descargar", "POST", { rfc: E.rfc, anio: +$("d-anio").value, meses: meses,
                pago_ceros: $("d-ceros").checked && !esInf(), forzar: $("d-forzar").checked, establecimiento: esInf() ? $("d-est").value : "" });
            $("modal-descargar").hidden = true;
            if (r.job_id) seguir(r.job_id, "Descargando acuses · " + nombreDe(E.rfc));
            else pintarAvance({ estado: "completado", renglones: r.renglones }, "Descargar acuses");
        } catch (e) { $("d-error").textContent = e.message; $("d-error").hidden = false; }
        $("d-enviar").disabled = false;
    }

    /* ------------------------------------------------------------ avance del robot (mismo trabajo que ISN) */
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
            return '<li class="' + clase + '"><b>' + esc((r.nombre || r.rfc) + " · " + (r.mes_nombre || "") + " " + r.anio + (r.establecimiento ? " · " + r.establecimiento : "")) + "</b>" + esc(r.mensaje || "") + "</li>";
        }).join("") + (t.error ? '<li class="mal"><b>Error</b>' + esc(t.error) + "</li>" : "");
    }
    function seguir(jobId, titulo, despues) {
        E.job = { id: jobId, titulo: titulo };
        clearTimeout(E.reloj);
        pintarAvance({ estado: "procesando", renglones: [] }, titulo);
        var paso = async function () {
            try {
                var t = await (await api("/api/isn/trabajo/" + encodeURIComponent(jobId))).json();
                pintarAvance(t, titulo);
                if (t.estado === "procesando") { E.reloj = setTimeout(paso, 2500); return; }
                E.job = null;
                await cargarEmpresas();
                cargar();
                if (E.vista === "masivo") cargarMasivo();
                if (despues) despues();
            } catch (e) { E.reloj = setTimeout(paso, 5000); }
        };
        paso();
    }
    async function retomarTrabajo() {
        try {
            var t = await (await api("/api/estatales/trabajo-activo")).json();
            if (t && t.job_id) seguir(t.job_id, { est_presentar: "Presentando", est_revisar: "Revisando en el portal", est_descargar: "Descargando acuses",
                                                    isn_presentar: "Presentando ISN", isn_revisar: "Revisando ISN", isn_descargar: "Descargando acuses de ISN" }[t.tipo] || "Tributanet");
        } catch (e) { /* nada */ }
    }
    async function detenerTrabajo() {
        if (!E.job || !(await Fiscontable.preguntar("¿Detener? Se termina el que está en curso y ya no se empiezan los siguientes."))) return;
        try { await api("/api/isn/trabajo/" + encodeURIComponent(E.job.id) + "/detener", { method: "POST" }); } catch (e) { aviso(e.message, true); }
    }

    /* ------------------------------------------------------------ Excel y acuses */
    async function cargarExcel(archivo) {
        var fd = new FormData(); fd.append("archivo", archivo);
        try {
            var r = await (await api("/api/estatales/" + IMP + "/excel", { method: "POST", body: fd })).json();
            aviso("Se cargaron " + r.cargados + " declaración(es)" + (r.empresas ? " y los datos de " + r.empresas + " empresa(s)" : "") + "." +
                  (r.ya_presentadas ? " " + r.ya_presentadas + " ya estaban presentadas (no se tocaron)." : "") +
                  (r.errores.length ? "\nNo se cargaron:\n" + r.errores.join("\n") : ""), r.errores.length > 0);
            await cargarEmpresas();
            if (E.vista === "masivo") { E.mvMarcas = {}; cargarMasivo(); }
            else if (r.rfcs.length && r.rfcs.indexOf(E.rfc) === -1) abrir(r.rfcs[0]); else cargar();
        } catch (e) { aviso(e.message, true); }
    }
    async function leerAcuses(archivos) {
        var fd = new FormData(); archivos.forEach(function (a) { fd.append("archivos", a); });
        aviso("Leyendo " + archivos.length + " acuse(s)…");
        try {
            var r = await (await api("/api/estatales/acuses", { method: "POST", body: fd })).json();
            var malos = r.resultados.filter(function (x) { return x.error; });
            var otros = r.resultados.filter(function (x) { return !x.error && x.impuesto !== IMP; });
            var conAviso = r.resultados.filter(function (x) { return !x.error && x.avisos && x.avisos.length; });
            aviso("Se leyeron " + r.leidos + " de " + archivos.length + " acuse(s)." +
                  (otros.length ? "\n" + otros.length + " son de otro impuesto: quedaron en su pestaña (" + otros.map(function (x) { return E.cfg.impuestos[x.impuesto].nombre; }).join(", ") + ")." : "") +
                  (conAviso.length ? "\nRevisa: " + conAviso.map(function (x) { return x.rfc + " " + MESES[x.mes - 1] + " " + x.anio + ": " + x.avisos.join(" "); }).join("\n") : "") +
                  (malos.length ? "\nNo se leyeron:\n" + malos.map(function (x) { return x.archivo + ": " + x.error; }).join("\n") : ""), malos.length > 0 || conAviso.length > 0);
            await cargarEmpresas();
            var buenos = r.resultados.filter(function (x) { return !x.error && x.impuesto === IMP; });
            if (buenos.length) { E.anio = buenos[0].anio; abrir(buenos.some(function (x) { return x.rfc === E.rfc; }) ? E.rfc : buenos[0].rfc); }
        } catch (e) { aviso(e.message, true); }
    }

    /* Desde Mis clientes: ?empresa=RFC&abrir=datos|acuse|descargar */
    function abrirDesdeUrl(que) {
        if (que === "datos" || que === "acuse") abrirDatos();     // el selector de archivos necesita un clic: ahí está «Llenar con un acuse»
        else if (que === "descargar") abrirDescargar();
    }

    /* ------------------------------------------------------------ eventos */
    function cerrarModales() { ["modal", "modal-datos", "modal-presentar", "modal-descargar", "modal-plantilla", "modal-agregar"].forEach(function (id) { $(id).hidden = true; }); }
    function eventos() {
        $("btn-empresa").addEventListener("click", function (e) { e.stopPropagation(); var mn = $("menu-empresa"); if (mn.hidden) pintarMenu(); mn.hidden = !mn.hidden; });
        $("menu-empresa").addEventListener("click", function (e) { e.stopPropagation(); var b = e.target.closest("[data-rfc]"); if (!b) return; $("menu-empresa").hidden = true; abrir(b.dataset.rfc); });
        document.addEventListener("click", function () { $("menu-empresa").hidden = true; });
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") cerrarModales(); });
        document.querySelectorAll(".xml-modal").forEach(function (mo) { mo.addEventListener("click", function (e) { if (e.target === mo) mo.hidden = true; }); });
        $("sel-anio").addEventListener("change", function () { E.anio = +this.value; cargar(); });
        $("btn-nuevo").addEventListener("click", function () { abrirForm(null); });
        $("tbody").addEventListener("click", function (e) {
            var a = e.target.closest("[data-pdf]");
            if (a) {
                e.preventDefault();
                var f = E.datos.periodos.find(function (x) { return x.id === +a.dataset.id; }) || {};
                var tipo = a.dataset.pdf === "ceros" ? (esInf() ? "Presentacion" : "Pago_en_ceros") : "Acuse";
                Fiscontable.verPdf(a.href, { titulo: tipo.replace(/_/g, " ") + " · " + E.imp.nombre + " · " + E.rfc + " · " + f.mes + "/" + f.anio,
                                             nombre: tipo + "_" + IMP.toUpperCase() + "_" + E.rfc + "_" + f.anio + "_" + String(f.mes).padStart(2, "0") + ".pdf" });
                return;
            }
            var tr = e.target.closest("tr[data-id]"); if (!tr) return;
            abrirForm(E.datos.periodos.find(function (f) { return f.id === +tr.dataset.id; }));
        });
        ["f-importe", "f-saldo"].forEach(function (id) { $(id).addEventListener("input", recalcular); });
        $("f-tipo").addEventListener("change", recalcular);
        $("desglose-filas").addEventListener("input", sumasDesglose);
        $("btn-repartir").addEventListener("click", repartirImpuesto);
        $("btn-ceros").addEventListener("click", function () { document.querySelectorAll("[data-inf]").forEach(function (i) { i.value = 0; }); });
        $("form").addEventListener("submit", guardar);
        $("form-cancelar").addEventListener("click", function () { $("modal").hidden = true; });
        $("form-borrar").addEventListener("click", async function () {
            if (!E.editando || !(await Fiscontable.preguntar("¿Borrar " + E.editando.mes_nombre + " " + E.editando.anio + " (" + E.editando.tipo + ")?"))) return;
            try { await api("/api/estatales/periodo/" + E.editando.id, { method: "DELETE" }); $("modal").hidden = true; await cargarEmpresas(); cargar(); }
            catch (err) { $("form-error").textContent = err.message; $("form-error").hidden = false; }
        });
        $("btn-datos").addEventListener("click", abrirDatos);
        $("datos-empresa").addEventListener("click", function (e) { var b = e.target.closest("[data-accion]"); if (!b) return; if (b.dataset.accion === "acuse") $("in-acuses").click(); else abrirDatos(); });
        $("form-datos").addEventListener("submit", guardarDatos);
        $("datos-cancelar").addEventListener("click", function () { $("modal-datos").hidden = true; });
        $("datos-acuse").addEventListener("click", function () { $("modal-datos").hidden = true; $("in-acuses").click(); });
        $("btn-establecimiento").addEventListener("click", function () { filaEst({}); });
        $("est-filas").addEventListener("click", function (e) { var b = e.target.closest(".isn-quitar"); if (b) b.closest("tr").remove(); });
        $("btn-presentar").addEventListener("click", function () { abrirPresentar(); });
        $("p-anio").addEventListener("change", cargarListos);
        $("p-mes").addEventListener("change", cargarListos);
        $("p-todos").addEventListener("change", function () { var on = this.checked; document.querySelectorAll("#p-filas input[data-id]:not(:disabled)").forEach(function (c) { c.checked = on; }); contarElegidos(); });
        $("p-filas").addEventListener("change", contarElegidos);
        $("p-cancelar").addEventListener("click", function () { $("modal-presentar").hidden = true; });
        $("p-revisar").addEventListener("click", async function () {
            var ids = elegidos(), anio = $("p-anio").value, mes = $("p-mes").value;
            if (!ids.length) { $("p-error").textContent = "Marca la que quieres revisar."; $("p-error").hidden = false; return; }
            if (await revisarEnPortal(ids, "Revisando en el portal · " + MESES[+mes - 1] + " " + anio, function () { abrirPresentar(anio, mes); })) $("modal-presentar").hidden = true;
        });
        $("p-enviar").addEventListener("click", async function () {
            var ids = elegidos(); if (!ids.length) return;
            var mes = MESES[+$("p-mes").value - 1] + " " + $("p-anio").value;
            if (await presentar(ids, "Se van a PRESENTAR " + ids.length + " declaración(es) de " + E.imp.nombre.toLowerCase() + " de " + mes + " ante la SEFIPLAN.")) $("modal-presentar").hidden = true;
        });
        document.querySelectorAll(".isn-pestanas button").forEach(function (b) { b.addEventListener("click", function () { ponerVista(b.dataset.vista); }); });
        $("mv-anio").addEventListener("change", function () { E.mvMarcas = {}; cargarMasivo(); });
        $("mv-mes").addEventListener("change", function () { E.mvMarcas = {}; cargarMasivo(); });
        $("mv-filas").addEventListener("change", function (e) { if (e.target.dataset.llave) E.mvMarcas[e.target.dataset.llave] = e.target.checked; contarMasivo(); });
        $("mv-filas").addEventListener("click", function (e) { var b = e.target.closest("[data-abrir]"); if (!b) return; ponerVista("empresa"); abrir(b.dataset.abrir); });
        $("mv-todos").addEventListener("change", function () {
            var on = this.checked;
            document.querySelectorAll("#mv-filas input[data-llave]:not(:disabled)").forEach(function (c) { c.checked = on; E.mvMarcas[c.dataset.llave] = on; });
            contarMasivo();
        });
        $("mv-agregar").addEventListener("click", abrirAgregar);
        $("ag-buscar").addEventListener("input", pintarAgregar);
        $("ag-lista").addEventListener("change", function (e) { var c = CLIENTES.find(function (x) { return x.rfc === e.target.dataset.rfc; }); if (c) c.activa = e.target.checked; });
        $("ag-cancelar").addEventListener("click", function () { $("modal-agregar").hidden = true; });
        $("ag-guardar").addEventListener("click", guardarAgregar);
        $("mv-ceros").addEventListener("click", cerosMasivo);
        $("mv-plantilla").addEventListener("click", function () {
            var rfcs = marcadas().map(function (x) { return x.rfc; }).filter(function (r, i, a) { return a.indexOf(r) === i; });
            if (rfcs.length) plantilla(rfcs, $("mv-anio").value, $("mv-mes").value);
        });
        $("mv-excel").addEventListener("click", function () { $("in-excel").click(); });
        $("mv-quitar").addEventListener("click", quitarMasivo);
        $("mv-revisar").addEventListener("click", async function () {
            var van = marcadas().filter(function (x) { return x.periodo && !x.periodo.presentada; });
            if (van.length && await Fiscontable.preguntar("Revisar en el portal " + van.length + " declaración(es) de " + mesMasivo() + " (no se llena ni se presenta nada).")) {
                revisarEnPortal(van.map(function (x) { return x.periodo.id; }), "Revisando en el portal · " + mesMasivo());
            }
        });
        $("mv-presentar").addEventListener("click", function () {
            var mk = marcadas(), van = mk.filter(function (x) { return x.periodo && !x.periodo.presentada && !x.periodo.faltan.length; });
            if (!van.length) return;
            presentar(van.map(function (x) { return x.periodo.id; }), "Se van a PRESENTAR " + van.length + " declaración(es) de " + E.imp.nombre.toLowerCase() + " de " + mesMasivo() + " ante la SEFIPLAN:\n\n" +
                van.map(function (x) { return "• " + (x.nombre || x.rfc) + (esInf() ? "" : " — a cargo $" + m(x.periodo.a_cargo)); }).join("\n"));
        });
        $("btn-plantilla").addEventListener("click", function () {
            if (!E.rfc) { aviso("Elige una empresa.", true); return; }
            var ma = mesAnterior();
            $("pl-titulo").textContent = "Plantilla de Excel · " + nombreDe(E.rfc);
            opcionesAnios($("pl-anio"), ma.anio); opcionesMeses($("pl-mes"), ma.mes);
            $("pl-error").hidden = true; $("modal-plantilla").hidden = false;
        });
        $("pl-cancelar").addEventListener("click", function () { $("modal-plantilla").hidden = true; });
        $("pl-bajar").addEventListener("click", async function () { if (await plantilla([E.rfc], $("pl-anio").value, $("pl-mes").value)) $("modal-plantilla").hidden = true; });
        $("btn-excel").addEventListener("click", function () { $("in-excel").click(); });
        $("in-excel").addEventListener("change", function () { var f = this.files[0]; this.value = ""; if (f) cargarExcel(f); });
        $("btn-acuses").addEventListener("click", function () { $("in-acuses").click(); });
        $("in-acuses").addEventListener("change", function () { var a = Array.from(this.files); this.value = ""; if (a.length) leerAcuses(a); });
        $("btn-descargar").addEventListener("click", abrirDescargar);
        $("d-anio").addEventListener("change", pintarMesesDescarga);
        $("d-est").addEventListener("change", pintarMesesDescarga);
        $("d-cancelar").addEventListener("click", function () { $("modal-descargar").hidden = true; });
        $("d-enviar").addEventListener("click", enviarDescarga);
        $("avance-cerrar").addEventListener("click", function () { $("avance").hidden = true; });
        // Ocultar / ver el detalle del avance (sigue trabajando); Esc lo oculta, o lo cierra si ya terminó
        $("avance-min").addEventListener("click", function () {
            var min = $("avance").classList.toggle("isn-avance--min");
            this.textContent = min ? "Ver" : "Ocultar"; this.setAttribute("aria-expanded", String(!min));
        });
        document.addEventListener("keydown", function (e) {
            if (e.key !== "Escape" || $("avance").hidden || document.querySelector("dialog[open]")) return;
            if (!$("avance-cerrar").hidden) $("avance").hidden = true;
            else if (!$("avance").classList.contains("isn-avance--min")) $("avance-min").click();
        });
        $("avance-detener").addEventListener("click", detenerTrabajo);
        $("btn-facturas").hidden = !(IMP === "prof" || IMP === "alc");
        $("btn-facturas").addEventListener("click", function () {
            if (!E.rfc) { aviso("Elige una empresa.", true); return; }
            var ma = mesAnterior();
            location.href = "/herramientas/xml/fiscal.html?rfc=" + encodeURIComponent(E.rfc) + "&anio=" + ma.anio + "&mes=" + ma.mes + "&lado=emitidos";
        });
        $("btn-exportar").addEventListener("click", async function () {
            if (!E.rfc) return;
            try { await bajar(await api("/api/estatales/" + IMP + "/exportar?rfc=" + encodeURIComponent(E.rfc) + "&anio=" + E.anio), E.rfc + "_" + IMP + "_" + E.anio + ".xlsx"); }
            catch (e) { aviso(e.message, true); }
        });
    }

    document.addEventListener("DOMContentLoaded", iniciar);
})();
