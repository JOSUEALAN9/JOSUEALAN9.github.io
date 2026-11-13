/*
 * admin/migracion-admin.js — «Migrar a otra cuenta» (Administración › Usuarios).
 * Cuatro pasos: cuentas y qué se pasa → revisión por empresa (Pasar, Combinar, Reemplazar, Omitir) → confirmar →
 * resultado en vivo, con Excel, reintento y deshacer (30 días). La lógica vive en el servidor (core/migracion.py).
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var paso = 1, categorias = [], revision = null, destino = null, migracionId = null, sondeo = null, historial = [];
    var solicitudId = null, solicitudesCache = [], rechazando = null;
    var NOMBRES = { pasar: "Pasar", combinar: "Combinar", reemplazar: "Reemplazar", omitir: "Omitir" };
    var ESTADOS = { en_curso: ["En curso", "info"], terminada: ["Terminada", "ok"], con_fallas: ["Con empresas pendientes", "aviso"], deshecha: ["Deshecha", ""] };

    async function api(ruta, metodo, cuerpo) {
        var r = await fetch(API + ruta, { method: metodo || "GET", credentials: "include",
            headers: cuerpo ? { "Content-Type": "application/json" } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function avisar(tipo, texto) { if (typeof mostrarAlerta === "function") mostrarAlerta(tipo, texto); else Fiscontable.avisar(texto); }
    function error(texto) { $("mig-error").textContent = texto || ""; $("mig-error").hidden = !texto; }
    function fecha(iso) {
        var d = iso ? new Date(/Z$/.test(iso) ? iso : iso + "Z") : null;
        return d && !isNaN(d) ? d.toLocaleString("es-MX", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
    }
    function fechaCorta(iso) { var d = iso ? new Date(iso + "T12:00:00") : null; return d && !isNaN(d) ? d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : ""; }
    function n(x) { return (x || 0).toLocaleString("es-MX"); }
    function cuantos(x, uno, varios) { return n(x) + " " + (x === 1 ? uno : varios); }
    function estado(clave) { var e = ESTADOS[clave] || [clave, ""]; return '<span class="ui-estado' + (e[1] ? " ui-estado--" + e[1] : "") + '">' + esc(e[0]) + "</span>"; }

    /* ---------------------------------------------------------------- historial */
    async function cargarHistorial() {
        try {
            var d = await api("/api/admin/migraciones");
            historial = d.migraciones; categorias = d.categorias;
        } catch (e) { return; }
        $("mig-historial").hidden = !historial.length;
        $("mig-historial-lista").innerHTML = historial.map(function (m) {
            var c = m.cuentas;
            return '<tr class="border-t border-gray-100"><td class="p-4 text-xs whitespace-nowrap">' + esc(fecha(m.creada)) + "</td>" +
                '<td class="p-4 font-mono text-xs break-all">' + esc(m.origen) + "</td>" +
                '<td class="p-4 font-mono text-xs break-all">' + esc(m.destino) + "</td>" +
                '<td class="p-4 text-xs">' + n(c.ok) + " pasaron" + (c.fallo ? " · " + n(c.fallo) + " no pasaron" : "") + (c.omitida ? " · " + n(c.omitida) + " omitidas" : "") +
                    (m.deshechas ? " · " + n(m.deshechas) + " deshechas" : "") + "</td>" +
                '<td class="p-4">' + estado(m.estado) + (m.respaldo ? "" : '<div class="text-[11px] text-slate-400 mt-1">Respaldo vencido</div>') + "</td>" +
                '<td class="p-4 text-right"><button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-mig-ver="' + esc(m.id) + '">Ver</button></td></tr>';
        }).join("");
    }

    /* ---------------------------------------------------------------- solicitudes de los despachos */
    var EST_SOL = { pendiente: ["Pendiente", "aviso"], en_curso: ["En curso", "info"], atendida: ["Atendida", "ok"], rechazada: ["Rechazada", ""] };
    async function cargarSolicitudes() {
        try { solicitudesCache = (await api("/api/admin/migraciones/solicitudes")).solicitudes; } catch (e) { return; }
        var pend = solicitudesCache.filter(function (s) { return s.estado === "pendiente"; }).length;
        $("mig-solicitudes").hidden = !solicitudesCache.length;
        $("mig-sol-cuenta").textContent = pend ? pend + (pend === 1 ? " pendiente" : " pendientes") : "Sin pendientes";
        $("mig-sol-lista").innerHTML = solicitudesCache.map(function (s) {
            var e = EST_SOL[s.estado] || [s.estado, ""];
            var emp = s.empresas ? s.empresas.length + (s.empresas.length === 1 ? " empresa" : " empresas") + '<div class="text-[11px] text-slate-500 font-mono">' + esc(s.empresas.slice(0, 6).join(", ")) + (s.empresas.length > 6 ? "…" : "") + "</div>" : "Todas";
            return '<tr class="border-t border-gray-100"><td class="p-4 text-xs whitespace-nowrap">' + esc(fecha(s.creada)) + "</td>" +
                '<td class="p-4"><b class="text-sm">' + esc(s.despacho || "") + '</b><div class="text-xs text-slate-500 break-all">' + esc(s.titular) + "</div></td>" +
                '<td class="p-4 font-mono text-xs break-all">' + esc(s.origen) + "</td>" +
                '<td class="p-4 text-xs">' + emp + (s.nota ? '<div class="text-[11px] text-slate-500 mt-1">' + esc(s.nota) + "</div>" : "") + "</td>" +
                '<td class="p-4"><span class="ui-estado' + (e[1] ? " ui-estado--" + e[1] : "") + '">' + esc(e[0]) + "</span>" +
                    (s.motivo ? '<div class="text-[11px] text-slate-500 mt-1">' + esc(s.motivo) + "</div>" : "") + "</td>" +
                '<td class="p-4 text-right whitespace-nowrap">' + (s.estado === "pendiente"
                    ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-sol-atender="' + s.id + '">Atender</button> ' +
                      '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-sol-rechazar="' + s.id + '">Rechazar</button>'
                    : (s.migracion_id ? '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-mig-ver="' + esc(s.migracion_id) + '">Ver</button>' : "")) + "</td></tr>";
        }).join("");
    }

    /* ---------------------------------------------------------------- pasos */
    function irA(p) {
        paso = p;
        [].forEach.call(document.querySelectorAll("[data-mig-panel]"), function (x) { x.hidden = +x.dataset.migPanel !== p; });
        [].forEach.call($("mig-pasos").children, function (li) {
            var k = +li.dataset.paso;
            if (k === p) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
            li.classList.toggle("hecho", k < p);
        });
        $("mig-atras").hidden = p === 1 || p === 4;
        $("mig-siguiente").hidden = p === 4;
        $("mig-siguiente").textContent = p === 3 ? "Migrar" : "Siguiente";
        $("mig-cancelar").textContent = p === 4 ? "Cerrar" : "Cancelar";
        error("");
    }

    function abrir(origen, solicitud) {
        migracionId = null; revision = null; destino = null; solicitudId = solicitud ? solicitud.id : null;
        $("mig-origen").value = origen || "";
        $("mig-destino").value = "";
        $("mig-destinos").innerHTML = "";
        $("mig-desactivar").checked = false;
        alCambiarOrigen();
        pintarTipos();
        irA(1);
        $("mig-dlg").showModal();
        if (solicitud) {                 // viene de una solicitud del despacho: las cuentas ya van puestas
            $("mig-destino").value = solicitud.titular;
            buscarDestinos().then(function () {
                var r = document.querySelector('input[name="mig-a"][value="' + CSS.escape(solicitud.destino) + '"]');
                if (r) r.checked = true;
            });
            return;
        }
        (origen ? $("mig-destino") : $("mig-origen")).focus();
    }

    function esAdmin(correo) {
        var lista = typeof usuariosCache !== "undefined" ? usuariosCache : [];
        var u = lista.filter(function (x) { return x.correo === correo; })[0];
        return !!u && u.rol === "admin";
    }
    function alCambiarOrigen() {
        var admin = esAdmin($("mig-origen").value.trim().toLowerCase());
        $("mig-desactivar-campo").hidden = admin;
        if (admin) $("mig-desactivar").checked = false;
    }

    function pintarTipos() {
        $("mig-tipos").innerHTML = categorias.map(function (c) {
            return '<label class="ui-check"><input type="checkbox" value="' + esc(c.clave) + '" checked> ' + esc(c.nombre) + "</label>";
        }).join("");
    }
    function tiposElegidos() { return [].map.call($("mig-tipos").querySelectorAll("input:checked"), function (x) { return x.value; }); }

    async function buscarDestinos() {
        var correo = $("mig-destino").value.trim().toLowerCase();
        destino = null;
        $("mig-destinos").innerHTML = "";
        if (!correo) { error("Escribe el correo de la cuenta que recibe."); return; }
        try {
            var d = await api("/api/admin/migraciones/destinos?correo=" + encodeURIComponent(correo));
            $("mig-destinos").innerHTML = d.destinos.map(function (x, i) {
                return '<label class="mig-opcion"><input type="radio" name="mig-a" value="' + esc(x.cuenta) + '"' + (i === 0 ? " checked" : "") + '>' +
                    "<span>" + esc(x.tipo === "despacho" ? x.nombre : "Su espacio personal") +
                    "<small>" + (x.tipo === "despacho" ? "Las empresas serán del despacho. Si la persona sale, se quedan en el despacho."
                        : "Las empresas serán de esta persona. Si un día sale de un despacho, se las lleva.") + "</small></span></label>";
            }).join("");
            destino = d.destinos[0].cuenta;
            error("");
        } catch (e) { error(e.message); }
    }

    async function revisar() {
        var origen = $("mig-origen").value.trim().toLowerCase();
        var elegido = document.querySelector('input[name="mig-a"]:checked');
        if (!origen) return error("Escribe el correo de la cuenta que entrega.");
        if (!elegido) return error("Busca la cuenta de destino y elige a dónde van las empresas.");
        if (!tiposElegidos().length) return error("Elige al menos un tipo de información.");
        destino = elegido.value;
        var b = $("mig-siguiente");
        b.classList.add("ui-btn--cargando");
        try {
            revision = await api("/api/admin/migraciones/revisar", "POST", { origen: origen, destino: destino });
        } catch (e) { error(e.message); return; }
        finally { b.classList.remove("ui-btn--cargando"); }
        if (!revision.empresas.length) return error("La cuenta de origen no tiene empresas.");
        revision.empresas.forEach(function (e) { e.sugerida = e.accion; });
        pintarEmpresas();
        irA(2);
    }

    function resumenLado(l) {
        if (!l) return '<span class="text-slate-400">No la tiene</span>';
        var c = l.conteos, partes = [];
        if (c.comprobantes.XML) partes.push(n(c.comprobantes.XML) + " XML");
        if (c.comprobantes.retenciones) partes.push(cuantos(c.comprobantes.retenciones, "retención", "retenciones"));
        if (c.documentos.documentos) partes.push(cuantos(c.documentos.documentos, "documento", "documentos"));
        if (c.buzon.notificaciones) partes.push(cuantos(c.buzon.notificaciones, "notificación", "notificaciones"));
        if (c.facturacion.facturas) partes.push(cuantos(c.facturacion.facturas, "factura", "facturas"));
        var firma = l.efirma ? "e.firma" + (l.efirma_vence ? " vence " + fechaCorta(l.efirma_vence) : "") : "Sin e.firma";
        return esc(partes.join(" · ") || "Sin información") + "<small>" + esc(firma) + (l.ciec ? " · contraseña del SAT" : "") + "</small>";
    }

    function pintarEmpresas() {
        var r = revision;
        $("mig-tope").textContent = r.tope || "";
        $("mig-tope").hidden = !r.tope;
        $("mig-empresas").innerHTML = r.empresas.map(function (e, i) {
            var opciones = e.bloqueo ? ["omitir"] : (e.en_destino ? ["combinar", "reemplazar", "omitir"] : ["pasar", "omitir"]);
            return "<tr><td><b>" + esc(e.nombre) + '</b><small class="mig-rfc">' + esc(e.rfc) + "</small>" +
                    (e.bloqueo ? '<small class="text-amber-700">' + esc(e.bloqueo) + "</small>" : "") + "</td>" +
                "<td>" + resumenLado(e.origen) + "</td><td>" + resumenLado(e.destino) + "</td>" +
                '<td><select class="ui-select" data-mig-accion="' + i + '"' + (e.bloqueo ? " disabled" : "") + ">" +
                    opciones.map(function (o) { return '<option value="' + o + '"' + (o === e.accion ? " selected" : "") + ">" + NOMBRES[o] + "</option>"; }).join("") + "</select>" +
                    '<input class="ui-input mig-confirmar" data-mig-confirmar="' + i + '" maxlength="13" placeholder="Escribe ' + esc(e.rfc) + '"' +
                    (e.accion === "reemplazar" ? "" : " hidden") + ' value="' + esc(e.confirmacion || "") + '"></td></tr>';
        }).join("");
        contar();
    }

    function contar() {
        var c = { pasar: 0, combinar: 0, reemplazar: 0, omitir: 0 };
        revision.empresas.forEach(function (e) { c[e.accion]++; });
        $("mig-cuantas").textContent = revision.empresas.length + " empresas · " + (c.pasar + c.combinar + c.reemplazar) + " se pasan · " + c.omitir + " se omiten";
        return c;
    }

    function confirmar() {
        var faltan = revision.empresas.filter(function (e) { return e.accion === "reemplazar" && (e.confirmacion || "").trim().toUpperCase() !== e.rfc; });
        if (faltan.length) return error("Para reemplazar escribe el RFC de: " + faltan.map(function (e) { return e.rfc; }).join(", ") + ".");
        var c = contar();
        if (!c.pasar && !c.combinar && !c.reemplazar) return error("No elegiste ninguna empresa para pasar.");
        $("mig-conteo").innerHTML = [["pasar", "Se pasan completas"], ["combinar", "Se combinan"], ["reemplazar", "Se reemplazan"], ["omitir", "Se omiten"]].map(function (x) {
            return "<div><b>" + n(c[x[0]]) + "</b><span>" + x[1] + "</span></div>";
        }).join("");
        var nombres = categorias.filter(function (k) { return tiposElegidos().indexOf(k.clave) >= 0; }).map(function (k) { return k.nombre; });
        $("mig-conf-titulo").textContent = "De " + revision.origen + " a " + revision.destino_nombre;
        $("mig-conf-lista").innerHTML = nombres.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") +
            (nombres.length < categorias.length ? "<li>Lo que no marcaste se queda en el origen, con la empresa.</li>" : "") +
            ($("mig-desactivar").checked ? "<li>Al terminar sin pendientes, la cuenta de origen queda desactivada.</li>" : "") +
            "<li>Puedes deshacerla durante 30 días.</li>";
        irA(3);
    }

    function migrar() {
        confirmarIdentidad("migrar", async function (c) {
            var d = await api("/api/admin/migraciones", "POST", {
                origen: revision.origen, destino: revision.destino, categorias: tiposElegidos(), desactivar_origen: $("mig-desactivar").checked,
                empresas: revision.empresas.map(function (e) { return { rfc: e.rfc, accion: e.accion, confirmacion: e.confirmacion || null }; }),
                confirmacion: c, solicitud_id: solicitudId });
            migracionId = d.id;
            irA(4);
            verResultado();
        });
    }

    /* PIN y código por correo antes de migrar, reintentar o deshacer (ventana común de barra.js) */
    function confirmarIdentidad(accion, ejecutar) { return Fiscontable.confirmarIdentidad(accion, ejecutar); }

    /* ---------------------------------------------------------------- resultado */
    function detalle(x) {
        var d = x.detalle || {};
        if (d.mensaje) return esc(d.mensaje);
        if (x.estado === "omitida") return '<span class="text-slate-400">Sin cambios</span>';
        if (x.estado === "pendiente") return '<span class="text-slate-400">En espera…</span>';
        var SING = { XML: "XML", retenciones: "retención", descargas: "descarga", marcas: "marca", documentos: "documento", consultas: "consulta",
                     notificaciones: "notificación", comunicados: "comunicado", facturas: "factura" };
        var partes = Object.keys(d.por_tipo || {}).map(function (k) { return cuantos(d.por_tipo[k], SING[k] || k, k); });
        var t = partes.join(" · ") || (n(d.pasaron) + " registros");
        if (d.ya_estaban) t += "<small>" + n(d.ya_estaban) + " ya estaban en el destino</small>";
        if (d.reemplazados) t += "<small>" + n(d.reemplazados) + " del destino van al respaldo</small>";
        if (d.credenciales) t += "<small>" + esc(d.credenciales) + "</small>";
        if (x.deshacer) t += "<small>Deshecha: " + n(x.deshacer.regresaron) + " regresaron" + (x.deshacer.no_regresaron ? ", " + n(x.deshacer.no_regresaron) + " ya existían en el origen" : "") + "</small>";
        return t;
    }
    function claseResultado(x) {
        if (x.deshecha) return "";
        return { ok: "ok", fallo: "error", omitida: "", pendiente: "info" }[x.estado] || "";
    }

    async function verResultado() {
        clearTimeout(sondeo);
        var m;
        try { m = await api("/api/admin/migraciones/" + migracionId); } catch (e) { error(e.message); return; }
        var res = m.resultado, rfcs = Object.keys(res);
        var ok = rfcs.filter(function (r) { return res[r].estado === "ok"; }).length;
        var fallas = rfcs.filter(function (r) { return res[r].estado === "fallo"; }).length;
        var quedan = rfcs.filter(function (r) { return res[r].estado === "pendiente"; }).length;
        var vivo = m.estado === "en_curso";
        $("mig-estado").innerHTML = estado(m.estado) + " &nbsp;De " + esc(m.origen) + " a " + esc(m.destino_nombre) + " · " +
            (vivo ? n(quedan) + " empresas por pasar" : n(ok) + " pasaron" + (fallas ? " · " + n(fallas) + " no pasaron" : ""));
        var deshacible = !vivo && m.respaldo;
        $("mig-resultado").innerHTML = rfcs.map(function (r) {
            var x = res[r];
            var puede = deshacible && x.estado === "ok" && !x.deshecha;
            return '<tr><td class="mig-rfc">' + esc(r) + "</td><td>" + esc(NOMBRES[x.accion] || x.accion) + "</td>" +
                '<td><span class="ui-estado' + (claseResultado(x) ? " ui-estado--" + claseResultado(x) : "") + '">' + esc(x.texto) + "</span></td>" +
                "<td>" + detalle(x) + "</td>" +
                '<td style="text-align:right">' + (puede ? '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-mig-deshacer="' + esc(r) + '">Deshacer</button>' : "") + "</td></tr>";
        }).join("");
        $("mig-reintentar").hidden = vivo || !fallas;
        $("mig-deshacer-todo").hidden = !deshacible || !rfcs.some(function (r) { return res[r].estado === "ok" && !res[r].deshecha; });
        $("mig-excel").hidden = vivo;
        if (vivo) sondeo = setTimeout(verResultado, 1500);
        else { cargarHistorial(); cargarSolicitudes(); }
    }

    async function deshacer(rfc) {
        var texto = rfc ? "¿Deshacer la migración de " + rfc + "?\n\nLa empresa regresa al origen como estaba y el destino recupera lo que tenía."
            : "¿Deshacer toda la migración?\n\nCada empresa regresa al origen como estaba y el destino recupera lo que tenía.";
        if (!(await Fiscontable.preguntar(texto))) return;
        confirmarIdentidad("deshacer", async function (c) {
            await api("/api/admin/migraciones/" + migracionId + "/deshacer", "POST", { rfc: rfc || null, confirmacion: c });
            avisar("success", rfc ? "Se deshizo la migración de " + rfc + "." : "Se deshizo la migración.");
            verResultado();
        });
    }

    async function bajarExcel() {
        try {
            var r = await fetch(API + "/api/admin/migraciones/" + migracionId + "/excel", { credentials: "include" });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            Fiscontable.guardarArchivo(await r.blob(), "Migracion_" + migracionId.slice(0, 8) + ".xlsx");
        } catch (e) { error(e.message); }
    }

    /* ---------------------------------------------------------------- eventos */
    $("mig-abrir").addEventListener("click", async function () { if (!categorias.length) await cargarHistorial(); abrir(""); });
    $("mig-buscar").addEventListener("click", buscarDestinos);
    $("mig-destino").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); buscarDestinos(); } });
    $("mig-destino").addEventListener("input", function () { $("mig-destinos").innerHTML = ""; });
    $("mig-origen").addEventListener("input", alCambiarOrigen);
    $("mig-siguiente").addEventListener("click", function () {
        if (paso === 1) revisar();
        else if (paso === 2) confirmar();
        else if (paso === 3) migrar();
    });
    $("mig-atras").addEventListener("click", function () { irA(paso - 1); });
    $("mig-empresas").addEventListener("change", function (e) {
        var s = e.target.closest("[data-mig-accion]");
        if (!s) return;
        var emp = revision.empresas[+s.dataset.migAccion];
        emp.accion = s.value;
        var campo = this.querySelector('[data-mig-confirmar="' + s.dataset.migAccion + '"]');
        campo.hidden = s.value !== "reemplazar";
        if (!campo.hidden) campo.focus();
        contar();
    });
    $("mig-empresas").addEventListener("input", function (e) {
        var c = e.target.closest("[data-mig-confirmar]");
        if (c) revision.empresas[+c.dataset.migConfirmar].confirmacion = c.value;
    });
    document.querySelector("#mig-dlg .mig-barra").addEventListener("click", function (e) {
        var b = e.target.closest("[data-mig-todas]");
        if (!b || !revision) return;
        revision.empresas.forEach(function (x) { x.accion = b.dataset.migTodas === "omitir" ? "omitir" : x.sugerida; });
        pintarEmpresas();
    });
    $("mig-resultado").addEventListener("click", function (e) { var b = e.target.closest("[data-mig-deshacer]"); if (b) deshacer(b.dataset.migDeshacer); });
    $("mig-deshacer-todo").addEventListener("click", function () { deshacer(null); });
    $("mig-reintentar").addEventListener("click", function () {
        confirmarIdentidad("reintentar", async function (c) {
            await api("/api/admin/migraciones/" + migracionId + "/reintentar", "POST", { confirmacion: c });
            verResultado();
        });
    });
    $("mig-excel").addEventListener("click", bajarExcel);
    $("mig-dlg").addEventListener("click", function (e) { if (e.target.closest("[data-mig-cerrar]")) this.close(); });
    $("mig-dlg").addEventListener("close", function () { clearTimeout(sondeo); });
    $("mig-historial-lista").addEventListener("click", function (e) {
        var b = e.target.closest("[data-mig-ver]");
        if (!b) return;
        migracionId = b.dataset.migVer;
        irA(4);
        $("mig-dlg").showModal();
        verResultado();
    });

    $("mig-sol-lista").addEventListener("click", async function (e) {
        var a = e.target.closest("[data-sol-atender]"), r = e.target.closest("[data-sol-rechazar]"), v = e.target.closest("[data-mig-ver]");
        if (a) {
            if (!categorias.length) await cargarHistorial();
            var s = solicitudesCache.filter(function (x) { return String(x.id) === a.dataset.solAtender; })[0];
            if (s) abrir(s.origen, s);
        } else if (r) {
            rechazando = +r.dataset.solRechazar;
            $("mig-rech-motivo").value = ""; $("mig-rech-error").hidden = true;
            $("mig-rech-dlg").showModal(); $("mig-rech-motivo").focus();
        } else if (v) {
            migracionId = v.dataset.migVer; irA(4); $("mig-dlg").showModal(); verResultado();
        }
    });
    $("mig-rech-ok").addEventListener("click", async function () {
        var b = this;
        b.classList.add("ui-btn--cargando"); b.disabled = true;
        try {
            await api("/api/admin/migraciones/solicitudes/" + rechazando + "/rechazar", "POST", { motivo: $("mig-rech-motivo").value.trim() });
            $("mig-rech-dlg").close();
            avisar("success", "Solicitud rechazada; al titular le llegó un correo.");
            cargarSolicitudes();
        } catch (x) { $("mig-rech-error").textContent = x.message; $("mig-rech-error").hidden = false; }
        finally { b.classList.remove("ui-btn--cargando"); b.disabled = false; }
    });
    $("mig-rech-dlg").addEventListener("click", function (e) { if (e.target.closest("[data-rech-cerrar]")) this.close(); });

    cargarHistorial();
    cargarSolicitudes();
    window.MigracionAdmin = { abrir: abrir, cargar: cargarHistorial };
})();
