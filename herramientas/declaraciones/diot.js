/**
 * diot.js — «DIOT en ceros» en Declaraciones (Avance 1, 23-nov-2026, decisión G del dueño).
 * Una ventana con tres pasos: elegir empresas (hasta 20) y mes → revisar (lo que bloquea y lo que avisa, con las facturas
 * con IVA pagadas en el mes y «Presentar en ceros de todos modos») → confirmar (tabla + «Revisé la vista previa» + PIN)
 * → avance del robot (una por una, en el servidor). Solo la ve quien puede presentar (titular y administrador).
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    var boton = document.getElementById("btn-diot");
    var info = null, dlg = null, sondeo = null, revision = null;
    var CHIP = { enviado: "ok", ya_presentada: "ok", pendiente: "", en_curso: "va", detenido: "aviso", cancelado: "", revisar: "mal", error: "mal",
                 verificando: "va", no_presentada: "aviso", a_mano: "ok" };    // 24-nov-2026 (a2dec, A.1): la búsqueda sola en el SAT
    var vistaActual = null;             // "elegir" | lote en avance (para volver a pintar después de una acción)

    function dinero(v) { return "$" + Number(v || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    async function pedir(ruta, cuerpo) {
        var r = await fetch(API + ruta, cuerpo === undefined ? { credentials: "include" } :
            { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }

    /* 25-nov-2026 (el dueño: «DIOT en ceros: ¿dónde está eso?»): si la consulta del permiso falla por la red (o el servidor no
       contesta), el botón ya no se esconde: sale deshabilitado con el motivo, y se vuelve a preguntar al recuperar la conexión.
       Sin permiso (lo dice el servidor) sigue sin salir. */
    var sinRed = "";
    async function cargar() {
        sinRed = "";
        try { info = await pedir("/api/declaraciones/diot"); }
        catch (e) {
            info = null;
            sinRed = e instanceof TypeError || /no responde|conexi[oó]n|sin red/i.test(String(e && e.message || "")) ?
                "No se pudo revisar si puedes presentar la DIOT en ceros: no hubo respuesta del servidor. Revisa tu conexión; " +
                "se vuelve a intentar sola al recuperarla." : "";
        }
        if (!boton) return;
        boton.hidden = !(info && info.permitido) && !sinRed;
        boton.disabled = !!sinRed;
        boton.title = sinRed || "Presentar la DIOT sin operaciones de una o varias empresas (hasta 20)";
        var nota = document.getElementById("diot-sin-red");
        if (sinRed && !nota) {
            nota = document.createElement("p");
            nota.id = "diot-sin-red";
            nota.setAttribute("data-globo", "#btn-diot");
            nota.setAttribute("data-globo-nombre", "Por qué no se puede ahora");
            boton.insertAdjacentElement("afterend", nota);
        }
        if (nota) {
            nota.textContent = sinRed;
            if (sinRed && Fiscontable.globos) Fiscontable.globos(boton.parentNode);
            nota.hidden = !sinRed;                  // con el globo, el «?» se esconde con su texto (common.css, .fc-globo-caja:has)
        }
    }

    /* 25-nov-2026: el buscador de arriba lleva aquí con #diot: abre la ventana; si no se puede, lo dice o señala el botón */
    async function desdeBuscador() {
        if (location.hash !== "#diot") return;
        history.replaceState(null, "", location.pathname + location.search);
        if (info === null && !sinRed) await cargar();
        if (info && info.permitido) { abrir(); return; }
        if (sinRed && boton) { boton.scrollIntoView({ block: "center" }); Fiscontable.toast(sinRed); return; }
        Fiscontable.toast((info && info.motivo) || "La DIOT en ceros no está disponible para tu cuenta.");
    }

    /* ------------------------------------------------------------ la ventana */
    async function abrir() {
        // 24-nov-2026 (revisión): se vuelve a leer al abrir; si no, al cerrar la ventana a media presentación y abrirla otra
        // vez, salía «elegir» en lugar del avance del lote que sigue corriendo
        if (boton) boton.disabled = true;
        await cargar();
        if (boton) boton.disabled = !!sinRed;          // sin red, se queda deshabilitado con su motivo
        if (!info || !info.permitido) return;
        if (dlg) { try { dlg.close(); } catch (x) { /* nada */ } dlg.remove(); }
        dlg = document.createElement("dialog");
        dlg.className = "fc-modal fc-modal--grande fc-modal--fija";
        dlg.setAttribute("aria-labelledby", "dt-titulo");
        dlg.innerHTML = '<div class="fc-modal__cabeza"><div><h2 id="dt-titulo">DIOT en ceros</h2><p data-i="sub"></p></div>' +
            '<button type="button" class="fc-modal__cerrar" data-i="cerrar" aria-label="Cerrar">×</button></div>' +
            '<div class="fc-modal__cuerpo" data-i="cuerpo"></div><div class="fc-modal__pie" data-i="pie"></div>';
        dlg.querySelector('[data-i="cerrar"]').addEventListener("click", cerrar);
        dlg.addEventListener("cancel", function (e) { e.preventDefault(); cerrar(); });
        document.body.appendChild(dlg);
        dlg.showModal();
        var vivo = (info.lotes || []).filter(function (l) { return l.en_curso; })[0];
        if (vivo) avance(vivo.lote); else elegir();
    }
    function cerrar() {
        clearInterval(sondeo); sondeo = null;
        if (dlg) { try { dlg.close(); } catch (x) { /* nada */ } dlg.remove(); dlg = null; }
    }
    function q(k) { return dlg.querySelector('[data-i="' + k + '"]'); }
    function sub(t) { q("sub").textContent = t; }
    function pie(html) { q("pie").innerHTML = html; }
    function error(t) {
        var e = q("error");
        if (e) { e.textContent = t || ""; e.hidden = !t; }
    }

    /* 24-nov-2026 (a2dec, decisión A.1 del dueño): una DIOT que quedó en duda («Revisar en el SAT») la busca sola el robot
       en el SAT (solo consulta). Aquí se ve cuándo es la siguiente búsqueda y lo que la persona puede hacer: la casilla
       «Ya la revisé en el SAT» (sin PIN: la marca presentada a mano) y, si no se presentó, «Enviarla otra vez» (con PIN). */
    function hora(iso) {
        if (!iso) return "";
        var d = new Date(String(iso).replace(/Z?$/, "Z"));
        return isNaN(d) ? "" : d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    }
    function acciones(f) {
        var b = f.busqueda, html = "";
        if (f.estado === "revisar" && b && b.proxima) html += '<p class="dt-item__msj">Siguiente búsqueda en el SAT: ' + esc(hora(b.proxima)) + " (" + (b.intento + 1) + " de " + b.tope + ").</p>";
        if (!f.puede_marcar && !f.puede_reenviar && !f.puede_desmarcar) return html;
        return html + '<div class="dt-acciones">' +
            (f.puede_marcar ? '<label class="dt-reviso dt-reviso--chico"><input type="checkbox" data-revisada="' + esc(f.id) + '"> Ya la revisé en el SAT</label>' : "") +
            (f.puede_reenviar ? '<button type="button" class="fc-btn" data-reenviar="' + esc(f.id) + '" data-nombre="' + esc(f.nombre) + '" data-periodo="' + esc(f.periodo) + '">Enviarla otra vez</button>' : "") +
            // 24-nov-2026 (auditoría de Fable, hallazgo 7): «Ya la revisé en el SAT» puesto por error se quita con PIN
            (f.puede_desmarcar ? '<button type="button" class="fc-btn" data-desmarcar="' + esc(f.id) + '" data-nombre="' + esc(f.nombre) + '" data-periodo="' + esc(f.periodo) + '">Desmarcar</button>' : "") +
            "</div>";
    }
    function filaHtml(f) {
        return '<div class="dt-item"><div class="dt-item__fila"><span class="dt-item__nombre">' + esc(f.nombre) + ' <span class="dt-item__rfc">' + esc(f.rfc) +
            (f.lote && vistaActual === "elegir" ? " · " + esc(f.periodo) : "") + "</span></span>" +
            '<span class="dt-chip' + (CHIP[f.estado] ? " dt-chip--" + CHIP[f.estado] : "") + '">' + esc(f.estado_txt) + "</span></div>" +
            (f.mensaje ? '<p class="dt-item__msj">' + esc(f.mensaje) + "</p>" : "") + acciones(f) + "</div>";
    }
    async function despues(nuevo) {
        await cargar();
        if (!dlg) return;
        if (nuevo) return avance(nuevo.lote, nuevo);
        if (vistaActual && vistaActual !== "elegir") {
            try { pintarAvance(await pedir("/api/declaraciones/diot/lote/" + encodeURIComponent(vistaActual))); } catch (e) { /* sigue */ }
        } else pintarPendientes();
    }
    function escucharAcciones(caja) {
        if (caja.dataset.acc) return;
        caja.dataset.acc = "1";
        caja.addEventListener("change", async function (ev) {
            var c = ev.target.closest("[data-revisada]"); if (!c || !c.checked) return;
            var si = await Fiscontable.confirmar({ titulo: "¿Ya la revisaste en el SAT?", si: "Sí, ya la revisé",
                texto: "Márcala solo si en «Consultar declaración» del SAT SÍ aparece presentada (o la presentaste tú). Queda como presentada: Fiscontable ya no la busca y ya no se puede volver a pedir desde aquí." });   // revisión 24-nov: que no se confunda con «ya vi que no está»
            if (!si) { c.checked = false; return; }
            c.disabled = true;
            try { await pedir("/api/declaraciones/diot/fila/" + encodeURIComponent(c.dataset.revisada) + "/revisada", {}); await despues(); }
            catch (e) { Fiscontable.avisar(e.message); c.checked = false; c.disabled = false; }
        });
        caja.addEventListener("click", async function (ev) {
            var b = ev.target.closest("[data-reenviar]"); if (!b) return;
            var nuevo = null;
            var resumen = '<p class="fc-identidad__aviso">El robot vuelve a revisar en el SAT que no esté presentada y, si no está, la envía con la e.firma de la empresa. No se puede deshacer.</p>' +
                '<div class="fc-identidad__tabla"><table><thead><tr><th>Empresa</th><th>Periodo</th><th>Declaración</th></tr></thead><tbody><tr><td>' + esc(b.dataset.nombre) +
                "</td><td>" + esc(b.dataset.periodo) + "</td><td>Normal · sin operaciones</td></tr></tbody></table></div>";
            var hecho = await Fiscontable.confirmarIdentidad("presentar_declaracion", async function (c) {
                nuevo = await pedir("/api/declaraciones/diot/fila/" + encodeURIComponent(b.dataset.reenviar) + "/reenviar", { confirmacion: c });
            }, { titulo: "Enviar otra vez la DIOT en ceros", boton: "Enviarla otra vez", resumen: resumen });
            if (hecho && nuevo) await despues(nuevo);
        });
        caja.addEventListener("click", async function (ev) {
            var b = ev.target.closest("[data-desmarcar]"); if (!b) return;
            var resumen = '<p class="fc-identidad__aviso">Se quita «Ya la revisé en el SAT». Vuelve a como estaba: «No se presentó» (la puedes enviar otra vez) o «Revisar en el SAT» (Fiscontable la vuelve a buscar sola en el SAT, solo consulta). Queda en la bitácora.</p>' +
                '<div class="fc-identidad__tabla"><table><thead><tr><th>Empresa</th><th>Periodo</th></tr></thead><tbody><tr><td>' + esc(b.dataset.nombre) +
                "</td><td>" + esc(b.dataset.periodo) + "</td></tr></tbody></table></div>";
            var hecho = await Fiscontable.confirmarIdentidad("presentar_declaracion", async function (c) {
                await pedir("/api/declaraciones/diot/fila/" + encodeURIComponent(b.dataset.desmarcar) + "/desmarcar", { confirmacion: c });
            }, { titulo: "Desmarcar «Ya la revisé en el SAT»", boton: "Desmarcar", resumen: resumen });
            if (hecho) await despues();
        });
    }
    function pintarPendientes() {
        var caja = q("pendientes");
        if (!caja) return;
        var lista = (info && info.pendientes) || [], marcadas = (info && info.marcadas) || [];
        caja.hidden = !lista.length && !marcadas.length;
        caja.innerHTML = (lista.length ? '<p class="dt-pendientes__titulo">Para revisar · ' + lista.length + "</p>" + lista.map(filaHtml).join("") : "") +
            // 24-nov-2026 (auditoría de Fable, hallazgo 7): las de las últimas dos semanas, por si se marcó una por error
            (marcadas.length ? '<details class="dt-marcadas"><summary class="dt-pendientes__titulo">Marcadas «Ya la revisé en el SAT» · ' + marcadas.length +
                "</summary>" + marcadas.map(filaHtml).join("") + "</details>" : "");
        escucharAcciones(caja);
    }

    /* Paso 1: mes y empresas */
    var elegidas = {}, mesElegido = null;
    function opcionesMes() {
        var ej = info.ejercicio, m = info.mes, html = "";
        for (var i = 0; i < 14 && ej >= 2025; i++) {
            var v = ej + "-" + m;
            html += '<option value="' + v + '"' + (mesElegido === v || (!mesElegido && !i) ? " selected" : "") + ">" + MESES[m - 1] + " " + ej + "</option>";
            m -= 1; if (!m) { m = 12; ej -= 1; }
        }
        return html;
    }
    function elegir() {
        clearInterval(sondeo); sondeo = null;
        vistaActual = "elegir";
        sub("Normal y «La presenta sin operaciones». Elige el mes y hasta " + info.tope + " empresas; antes de presentar te enseñamos lo que hay que revisar.");
        q("cuerpo").innerHTML = '<div class="dt-lista dt-pendientes" data-i="pendientes" hidden></div>' +
            '<div class="dt-periodo"><label class="ui-campo"><span class="ui-etiqueta">Mes</span><select class="ui-select" data-i="mes">' + opcionesMes() + "</select></label>" +
            '<label class="ui-campo dt-buscar"><span class="ui-etiqueta">Buscar empresa</span><input class="ui-input" data-i="buscar" type="search" placeholder="Nombre o RFC" autocomplete="off"></label>' +
            '<span class="dt-contador" data-i="contador"></span></div>' +
            '<div class="dt-empresas" data-i="lista" role="group" aria-label="Empresas"></div>' +
            '<p class="dt-nota">Solo meses que ya terminaron. La presenta Fiscontable con la e.firma guardada de cada empresa, una por una; antes de enviar consulta en el SAT que no esté presentada y revisa la vista previa.</p>' +
            '<p class="ui-ayuda ui-ayuda--error" data-i="error" hidden></p>';
        pie('<button type="button" class="fc-btn" data-i="cancelar">Cancelar</button><button type="button" class="fc-btn fc-btn--principal" data-i="revisar">Revisar</button>');
        q("cancelar").addEventListener("click", cerrar);
        q("revisar").addEventListener("click", revisar);
        q("mes").addEventListener("change", function () { mesElegido = this.value; });
        q("buscar").addEventListener("input", pintarEmpresas);
        pintarEmpresas();
        pintarPendientes();
    }
    function pintarEmpresas() {
        var t = (q("buscar").value || "").trim().toLowerCase();
        var lista = info.empresas.filter(function (e) { return !t || e.nombre.toLowerCase().indexOf(t) >= 0 || e.rfc.toLowerCase().indexOf(t) >= 0; });
        q("lista").innerHTML = lista.length ? lista.map(function (e) {
            return '<label class="dt-empresa' + (e.efirma ? "" : " dt-empresa--sin") + '" title="' + (e.efirma ? "" : "Sin e.firma guardada") + '">' +
                '<input type="checkbox" value="' + esc(e.rfc) + '"' + (elegidas[e.rfc] ? " checked" : "") + (e.efirma ? "" : " disabled") + ">" +
                '<span class="dt-empresa__nombre">' + esc(e.nombre) + '</span><span class="dt-empresa__rfc">' + esc(e.rfc) + (e.efirma ? "" : " · sin e.firma") + "</span></label>";
        }).join("") : '<p class="dt-nota" style="padding:14px">Ninguna empresa coincide.</p>';
        q("lista").querySelectorAll("input").forEach(function (c) {
            c.addEventListener("change", function () {
                if (c.checked && Object.keys(elegidas).length >= info.tope) { c.checked = false; error("Hasta " + info.tope + " empresas por vez."); return; }
                error("");
                if (c.checked) elegidas[c.value] = 1; else delete elegidas[c.value];
                contar();
            });
        });
        contar();
    }
    function contar() {
        var n = Object.keys(elegidas).length;
        q("contador").innerHTML = "<b>" + n + "</b> de " + info.tope;
        q("revisar").disabled = !n;
    }

    /* Paso 2: lo que bloquea y lo que avisa */
    async function revisar() {
        var rfcs = Object.keys(elegidas), b = q("revisar");
        var partes = (q("mes").value || "").split("-");
        b.disabled = true; b.textContent = "Revisando…"; error("");
        try {
            revision = await pedir("/api/declaraciones/diot/revisar", { rfcs: rfcs, ejercicio: +partes[0], mes: +partes[1] });
            pintarRevision();
        } catch (e) { error(e.message); b.disabled = false; b.textContent = "Revisar"; }
    }
    function pintarRevision() {
        var r = revision;
        sub(r.periodo + " · Normal · sin operaciones. Revisa cada empresa antes de presentar.");
        q("cuerpo").innerHTML = '<div class="dt-resumen" data-i="resumen"></div><div class="dt-lista">' + r.filas.map(function (f) {
            var chip = !f.puede ? '<span class="dt-chip dt-chip--mal">No se puede</span>' : f.requiere_ack ? '<span class="dt-chip dt-chip--aviso">Revisa</span>' :
                f.avisos.length ? '<span class="dt-chip dt-chip--aviso">Con aviso</span>' : '<span class="dt-chip dt-chip--ok">Lista</span>';
            var fact = f.facturas.length ? '<details class="dt-facturas"><summary>Ver ' + f.n_facturas + " factura(s) con IVA pagadas en el mes</summary>" +
                '<div class="dt-facturas__caja"><table><thead><tr><th>Proveedor</th><th>Folio</th><th>Fecha</th><th class="dt-num">Total</th><th class="dt-num">IVA</th></tr></thead><tbody>' +
                f.facturas.map(function (x) {
                    // data-et: en el celular la tabla se vuelve tarjetas y cada importe dice qué es (24-nov-2026, revisión)
                    return "<tr><td>" + esc(x.proveedor) + "</td><td>" + esc(x.folio) + "</td><td>" + esc((x.fecha || "").split("-").reverse().join("/")) + '</td><td class="dt-num" data-et="Total">' +
                        dinero(x.total) + '</td><td class="dt-num" data-et="IVA">' + dinero(x.iva) + "</td></tr>";
                }).join("") + "</tbody></table></div>" + (f.n_facturas > f.facturas.length ? '<p class="dt-nota">Y ' + (f.n_facturas - f.facturas.length) + " más.</p>" : "") + "</details>" : "";
            return '<div class="dt-item"><div class="dt-item__fila"><span class="dt-item__nombre">' + esc(f.nombre) + ' <span class="dt-item__rfc">' + esc(f.rfc) + "</span></span>" + chip + "</div>" +
                (f.bloqueos.length ? '<ul class="dt-bloqueos">' + f.bloqueos.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
                (f.avisos.length ? '<ul class="dt-avisos">' + f.avisos.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") + fact +
                (f.puede && f.requiere_ack ? '<label class="ui-check"><input type="checkbox" data-ack="' + esc(f.rfc) + '"> Presentar en ceros de todos modos</label>' : "") + "</div>";
        }).join("") + '</div><p class="ui-ayuda ui-ayuda--error" data-i="error" hidden></p>';
        pie('<button type="button" class="fc-btn" data-i="atras">Atrás</button><button type="button" class="fc-btn fc-btn--principal" data-i="seguir"></button>');
        q("atras").addEventListener("click", elegir);
        q("seguir").addEventListener("click", confirmar);
        q("cuerpo").querySelectorAll("[data-ack]").forEach(function (c) { c.addEventListener("change", resumir); });
        resumir();
    }
    function van() {
        var ok = {};
        q("cuerpo").querySelectorAll("[data-ack]").forEach(function (c) { if (c.checked) ok[c.dataset.ack] = 1; });
        return revision.filas.filter(function (f) { return f.puede && (!f.requiere_ack || ok[f.rfc]); });
    }
    function resumir() {
        var v = van(), no = revision.filas.filter(function (f) { return !f.puede; }).length,
            falta = revision.filas.filter(function (f) { return f.puede && f.requiere_ack; }).length - v.filter(function (f) { return f.requiere_ack; }).length;
        q("resumen").innerHTML = '<span class="dt-chip dt-chip--ok">Van ' + v.length + "</span>" + (no ? '<span class="dt-chip dt-chip--mal">No se pueden ' + no + "</span>" : "") +
            (falta ? '<span class="dt-chip dt-chip--aviso">Por decidir ' + falta + "</span>" : "");
        q("seguir").textContent = v.length ? "Presentar " + v.length + "…" : "Nada que presentar";
        q("seguir").disabled = !v.length;
    }

    /* Paso 3: tabla + «Revisé la vista previa» + PIN */
    async function confirmar() {
        var lista = van(), r = revision, respuesta = null;
        var forzadas = lista.filter(function (f) { return f.requiere_ack; }).map(function (f) { return f.rfc; });
        var resumen = '<p class="fc-identidad__aviso">Se presenta ante el SAT con la e.firma de cada empresa. No se puede deshacer.</p>' +
            '<div class="fc-identidad__tabla"><table><thead><tr><th>Empresa</th><th>RFC</th><th>Periodo</th><th>Declaración</th></tr></thead><tbody>' +
            lista.map(function (f) {
                return "<tr><td>" + esc(f.nombre) + "</td><td>" + esc(f.rfc) + "</td><td>" + esc(r.periodo) + "</td><td>Normal · sin operaciones" + (f.requiere_ack ? " (de todos modos)" : "") + "</td></tr>";
            }).join("") + "</tbody></table></div>" +
            '<label class="dt-reviso"><input type="checkbox" id="dt-reviso"> Revisé la vista previa: son las empresas y el mes correctos, y no tuvieron operaciones.</label>';
        var hecho = await Fiscontable.confirmarIdentidad("presentar_declaracion", async function (c) {
            var marca = document.getElementById("dt-reviso");
            if (!marca || !marca.checked) throw new Error("Marca «Revisé la vista previa» para presentar.");
            respuesta = await pedir("/api/declaraciones/diot/presentar", { rfcs: lista.map(function (f) { return f.rfc; }), ejercicio: r.ejercicio, mes: r.mes,
                de_todos_modos: forzadas, revise: true, confirmacion: c });
        }, { titulo: "Presentar " + lista.length + (lista.length === 1 ? " DIOT en ceros" : " DIOT en ceros"), boton: "Presentar " + lista.length, resumen: resumen });
        if (hecho && respuesta) { elegidas = {}; avance(respuesta.lote, respuesta); }
    }

    /* Paso 4: avance del robot */
    function avance(lote, d) {
        vistaActual = lote;
        sub("Fiscontable las presenta una por una. Puedes cerrar esta ventana: sigue sola y te avisamos al terminar.");
        q("cuerpo").innerHTML = '<div class="dt-resumen" data-i="resumen"></div><div class="dt-lista" data-i="filas"></div>';
        pie('<button type="button" class="fc-btn" data-i="detener">Detener las que faltan</button><button type="button" class="fc-btn fc-btn--principal" data-i="listo">Cerrar</button>');
        q("listo").addEventListener("click", cerrar);
        q("detener").addEventListener("click", async function () {
            var b = this;
            var si = await Fiscontable.confirmar({ titulo: "¿Detener las que faltan?", texto: "La que se está presentando termina; las demás ya no se presentan.", si: "Detener", peligro: true });
            if (!si) return;
            b.disabled = true;
            try { pintarAvance(await pedir("/api/declaraciones/diot/lote/" + encodeURIComponent(lote) + "/detener", {})); } catch (e) { Fiscontable.avisar(e.message); b.disabled = false; }
        });
        escucharAcciones(q("filas"));
        if (d) pintarAvance(d);
        var vuelta = async function () {
            try { pintarAvance(await pedir("/api/declaraciones/diot/lote/" + encodeURIComponent(lote))); } catch (e) { /* reintenta en la siguiente vuelta */ }
        };
        vuelta();
        clearInterval(sondeo);
        sondeo = setInterval(vuelta, 3000);
    }
    function pintarAvance(d) {
        if (!dlg) return;
        var c = d.conteo || {};
        q("resumen").innerHTML = '<span class="dt-chip">' + esc(d.periodo) + '</span><span class="dt-chip dt-chip--ok">Presentadas ' + (c.enviado || 0) + "</span>" +
            ((c.pendiente || 0) + (c.en_curso || 0) ? '<span class="dt-chip dt-chip--va">Faltan ' + ((c.pendiente || 0) + (c.en_curso || 0)) + "</span>" : "") +
            ((c.revisar || 0) + (c.error || 0) + (c.detenido || 0) + (c.no_presentada || 0) ? '<span class="dt-chip dt-chip--mal">Para revisar ' +
                ((c.revisar || 0) + (c.error || 0) + (c.detenido || 0) + (c.no_presentada || 0)) + "</span>" : "") +
            (c.verificando ? '<span class="dt-chip dt-chip--va">Buscándola en el SAT ' + c.verificando + "</span>" : "");
        // 24-nov-2026 (a2dec): una casilla a medio marcar no se borra con el sondeo de cada 3 segundos
        if (!q("filas").querySelector("[data-revisada]:checked")) q("filas").innerHTML = d.filas.map(filaHtml).join("");
        q("detener").hidden = !(c.pendiente);
        if (!d.en_curso) {
            clearInterval(sondeo); sondeo = null;
            // 24-nov-2026 (revisión): solo dice que los acuses quedaron guardados si de verdad quedaron (acuse_id)
            var sinAcuse = d.filas.filter(function (f) { return f.estado === "enviado" && !f.acuse_id; }).length;
            sub(!c.enviado ? (c.ya_presentada ? "Terminó: ya estaban presentadas en el SAT; no se envió ninguna." : "Terminó sin presentar ninguna.") :
                sinAcuse ? "Terminó. " + sinAcuse + (sinAcuse === 1 ? " acuse no se pudo guardar: bájalo" : " acuses no se pudieron guardar: bájalos") + " en el SAT (Impresión de acuse)." :
                "Terminó. Los acuses quedaron en «Declaraciones guardadas» de cada empresa.");
            cargar();
            window.dispatchEvent(new CustomEvent("fiscontable:diot-terminada"));
        }
    }

    if (boton) boton.addEventListener("click", abrir);
    window.addEventListener("pagehide", function () { clearInterval(sondeo); });
    window.addEventListener("online", function () { if (sinRed) cargar(); });
    window.addEventListener("hashchange", desdeBuscador);
    // sin permiso (o sin el módulo) el servidor dice que no y el botón no aparece; sin red, sale deshabilitado con el motivo
    cargar().then(desdeBuscador);
})();
