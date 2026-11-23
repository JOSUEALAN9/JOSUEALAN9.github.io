/**
 * envios.js — Envíos por correo (18-nov-2026).
 *
 * El dueño: «que automaticemos el envío de los XML, PDF y Excel por correo… un ZIP por empresa y mes, se juntan todas las
 * empresas seleccionadas, se hace un ZIP y se manda; si pesa más, un enlace que vence. Esto es la necesidad de un despacho.»
 * Y por la tarde: «que no sea solo lo nuevo… se valida lo que se vaya a enviar»; «envío 1, envío 2… hasta 5… se check y se
 * habilita»; «a un grupo o a cada cliente»; «igual para las constancias y opiniones»; los correos, «como el Cloudflare».
 *
 * La página lista los envíos de la cuenta (hasta 5: a quién, qué llevan, cada cuánto), deja crear, cambiar, pausar, mandar
 * ahora y ver el historial con su enlace, y trae la tabla de casillas «Envío 1…5» por empresa. En un despacho, los envíos y
 * sus destinatarios los define el titular; los demás solo marcan sus empresas. Todo lo demás (verificar contra el SAT,
 * armar el ZIP, el correo, el programador) lo hace el servidor: modulos/entregas.
 *
 * 21-nov-2026 (el dueño, pase 38): «Enviar ahora» nombra sus dos cortes con la fecha y la hora reales del centro («Hasta el 20/11
 * a las 23:59 · completo y verificado» / «Hasta hoy 21/11 a las 16:35 · trae lo de hoy del SAT»); el paso «Cada cuándo»
 * tiene «Solo una vez, ahora» (sale al guardarlo; los ya enviados van plegados en «Enviados una vez»), y «Qué lleva» puede
 * limitarse a ciertos proveedores o clientes.
 *
 * 21-nov-2026 (el dueño: «creo que es al revés: primero me pone qué mandar y hasta el final me pregunta el periodo»): los pasos
 * son A quién · Empresas · Cuándo · Qué lleva · Mensaje. Con el periodo ya elegido, «Qué lleva» enseña el Excel de todos
 * los meses juntos solo cuando el periodo abarca más de un mes.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var E = { envios: [], op: null, editando: null, histDe: null, reloj: 0, tope: 15, max: 5, titular: true, correos: {}, calculoN: 0,
              solo: { proveedores: new Set(), clientes: new Set() }, soloLado: "proveedores", soloLista: null, soloDe: "", soloN: 0 };
    var UNA_VEZ = "una_vez";
    // 22-nov-2026: lo que de verdad hace el automático si falta algo (antes decía que a las 10 salía con la anotación)
    var TXT_VERIFICA = "Antes de mandar se pide al SAT la lista de cada empresa para comprobar que estén todos los XML, y se valida el estado de todo lo que va. " +
        "Si falta alguna lista, espera (se revisa cada hora) y a las 24 horas se detiene para que decidas. En «A cada cliente», los completos salen y solo espera el que falta.";
    function programados() { return E.envios.filter(function (e) { return e.frecuencia !== UNA_VEZ; }); }
    function deUnaVez() { return E.envios.filter(function (e) { return e.frecuencia === UNA_VEZ; }); }

    /* La hora del centro (21-nov-2026): los cortes se cuentan en la hora del centro de México, no en la de la computadora
       (en la zona horaria del sureste se va una hora adelante). */
    function enCentro(d) {
        var p = {};
        new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
            .formatToParts(d || new Date()).forEach(function (x) { p[x.type] = x.value; });
        return { iso: p.year + "-" + p.month + "-" + p.day + "T" + p.hour + ":" + p.minute, mes: p.year + "-" + p.month, h: Number(p.hour) };
    }
    function corteAyer(c) {          // el corte de «Hasta ayer», igual que el servidor (cuadre.tope_de): ayer 23:59; de 23:00 a 23:59, hoy a la hora en punto anterior menos una
        if (c.h >= 23) return c.iso.slice(0, 11) + String(c.h - 1).padStart(2, "0") + ":00";
        var d = new Date(Date.UTC(Number(c.iso.slice(0, 4)), Number(c.iso.slice(5, 7)) - 1, Number(c.iso.slice(8, 10))) - 86400000);
        return d.toISOString().slice(0, 10) + "T23:59";
    }
    function diaMes(iso) { return iso.slice(8, 10) + "/" + iso.slice(5, 7); }
    var DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    /* «lunes 30 de noviembre» de un «AAAA-MM-DD» */
    function fechaLarga(iso) {
        var d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
        return DIAS[d.getUTCDay()] + " " + d.getUTCDate() + " de " + MESES[d.getUTCMonth()];
    }
    /* 22-nov-2026 (auditoría envios_correos-1): la primera vez que sale, igual que el servidor (motor.primera_fecha): si hoy le
       toca pero ya pasó la hora de salida, la siguiente. semanal: dia 0–6 (lunes = 0); quincenal: el 1 y el 16; mensual: 1–28. */
    function primeraFecha(f, dia) {
        var c = enCentro(), d = new Date(Date.UTC(Number(c.iso.slice(0, 4)), Number(c.iso.slice(5, 7)) - 1, Number(c.iso.slice(8, 10))));
        if (c.h >= (E.hora || 7)) d = new Date(d.getTime() + 86400000);
        for (var i = 0; i < 40; i++) {
            var lun0 = (d.getUTCDay() + 6) % 7, n = d.getUTCDate();
            if ((f === "semanal" && lun0 === dia) || (f === "quincenal" && (n === 1 || n === 16)) || (f === "mensual" && n === dia)) return d.toISOString().slice(0, 10);
            d = new Date(d.getTime() + 86400000);
        }
        return d.toISOString().slice(0, 10);
    }
    /* Las empresas sin correo en su ficha (envios_correos-2): en «A cada cliente» a esas no les llega nada */
    function sinCorreo(rfcs) {
        return (E.op.empresas || []).filter(function (x) { return !x.con_correo && (!rfcs || rfcs.indexOf(x.rfc) !== -1); });
    }
    function nombresCortos(lista, max) {
        var n = lista.map(function (x) { return x.alias; });
        return n.slice(0, max).join(", ") + (n.length > max ? " y " + (n.length - max) + " más" : "");
    }
    /* «Hasta el 20/11 a las 23:59 · completo y verificado» y «Hasta hoy 21/11 a las 16:35 · trae lo de hoy del SAT» */
    function pintarCortes(caja, ayer, ahora) {
        if (!ayer || !ahora) { var c = enCentro(); ayer = corteAyer(c); ahora = c.iso; }
        caja.querySelectorAll("[data-corte-ayer]").forEach(function (b) { b.textContent = "Hasta el " + diaMes(ayer) + " a las " + ayer.slice(11, 16) + " · completo y verificado"; });
        caja.querySelectorAll("[data-corte-hoy]").forEach(function (b) { b.textContent = "Hasta hoy " + diaMes(ahora) + " a las " + ahora.slice(11, 16) + " · trae lo de hoy del SAT"; });
    }

    async function api(ruta, op) {
        var resp;
        try { resp = await fetch(API + ruta, Object.assign({ credentials: "include" }, op || {})); }
        catch (e) { throw new Error("No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo."); }
        if (!resp.ok) throw new Error(await Fiscontable.leerError(resp));
        return resp.json();
    }
    function mandar(ruta, metodo, cuerpo) {
        return api(ruta, { method: metodo, headers: { "Content-Type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    }
    function cuando(iso, conHora) {
        if (!iso) return "";
        var d = new Date(iso.length <= 10 ? iso + "T12:00:00" : iso + (/Z|[+-]\d\d:?\d\d$/.test(iso) ? "" : "Z"));
        return d.toLocaleDateString("es-MX", { weekday: iso.length <= 10 ? "long" : undefined, day: "numeric", month: "short" }) +
            (conHora ? ", " + d.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" }) : "");
    }
    function peso(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
    function plural(n, uno, varios) { return n.toLocaleString("es-MX") + " " + (n === 1 ? uno : varios); }
    function nombreEmpresa(rfc) { var e = (E.op.empresas || []).find(function (x) { return x.rfc === rfc; }); return e ? e.alias : rfc; }
    function de(lista, clave) { return (lista.find(function (x) { return x.clave === clave; }) || {}).nombre || clave; }
    var ESTADOS = { enviado: ["Enviado", "ok"], sin_novedades: ["Nada que mandar (no se envió)", "info"], sin_novedades_avisado: ["Nada que mandar (se avisó)", "info"],
                    error: ["No salió", "error"], armando: ["Verificando y armando…", "aviso"] };
    var VERIFICA = { completo: "ok", parcial: "aviso", pendiente: "aviso", sin: "aviso", omitida: "aviso" };

    /* ============================================================ correos como pastillas
       Como el campo de correos de Cloudflare: se escribe uno y con Enter, coma, espacio o al salir del campo queda como
       pastilla con su «×»; Retroceso en el campo vacío quita la última; pegar varios los separa. */
    var CORREO = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/;
    function pastillas(caja) {
        var lista = [], campo = document.createElement("input");
        campo.type = "email"; campo.autocomplete = "off"; campo.spellcheck = false; campo.setAttribute("aria-label", "Agregar correo");
        caja.appendChild(campo);
        function pintar() {
            caja.querySelectorAll(".ev-pastilla").forEach(function (p) { p.remove(); });
            lista.forEach(function (c, i) {
                var p = document.createElement("span"); p.className = "ev-pastilla";
                p.innerHTML = "<span>" + esc(c) + '</span><button type="button" data-quitar="' + i + '" aria-label="Quitar ' + esc(c) + '">×</button>';
                caja.insertBefore(p, campo);
            });
            campo.placeholder = lista.length ? "" : (caja.dataset.vacio || "");
        }
        function agregar(texto) {
            var malos = [];
            String(texto || "").split(/[\s,;]+/).forEach(function (c) {
                c = c.trim().toLowerCase();
                if (!c) return;
                if (!CORREO.test(c)) malos.push(c); else if (lista.indexOf(c) === -1) lista.push(c);
            });
            caja.classList.toggle("ev-correos--error", !!malos.length);
            campo.value = malos.join(" ");
            pintar();
            caja.dispatchEvent(new CustomEvent("cambio"));
            return !malos.length;
        }
        campo.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === "," || e.key === ";" || e.key === " ") { if (campo.value.trim()) { e.preventDefault(); agregar(campo.value); } else if (e.key !== "Enter") e.preventDefault(); }
            else if (e.key === "Backspace" && !campo.value && lista.length) { lista.pop(); pintar(); caja.dispatchEvent(new CustomEvent("cambio")); }
        });
        campo.addEventListener("blur", function () { if (campo.value.trim()) agregar(campo.value); });
        campo.addEventListener("paste", function (e) {
            var t = (e.clipboardData || window.clipboardData).getData("text");
            if (/[\s,;]/.test(t.trim())) { e.preventDefault(); agregar(campo.value + " " + t); }
        });
        campo.addEventListener("input", function () { caja.classList.remove("ev-correos--error"); });
        caja.addEventListener("click", function (e) {
            var q = e.target.closest("[data-quitar]");
            if (q) { lista.splice(Number(q.dataset.quitar), 1); pintar(); caja.dispatchEvent(new CustomEvent("cambio")); }
            campo.focus();
        });
        pintar();
        return {
            poner: function (v) { lista = (v || []).slice(); campo.value = ""; caja.classList.remove("ev-correos--error"); pintar(); },
            valores: function () { if (campo.value.trim()) agregar(campo.value); return lista.slice(); },
            pendiente: function () { return campo.value.trim(); },
            tiene: function (c) { return lista.indexOf(c) !== -1; },
            alternar: function (c, dentro) { var i = lista.indexOf(c); if (dentro && i === -1) lista.push(c); if (!dentro && i !== -1) lista.splice(i, 1); pintar(); }
        };
    }

    /* ============================================================ la lista */
    function lleva(c) {
        var xml = (c.xml || []).map(function (k) { return de(E.op.xml, k); });
        var n = (c.excel || []).length, docs = (c.docs || []).map(function (k) { return k === "csf" ? "constancia" : "opinión 32-D"; });
        var cp = c.contrapartes || {}, np = (cp.proveedores || []).length, nc = (cp.clientes || []).length, oc = cp.ocultas || 0;
        // 21-nov-2026 (revisión de Fable, hallazgo 7): un lado sin elegidos va completo; se dice cada lado que lleva
        var lados = ladosQueLleva(c), solo = "";
        if ((np || nc || oc) && lados.length) {
            solo = lados.map(function (l) {
                var n = l === "proveedores" ? np : nc;
                return (l === "proveedores" ? "recibidas: " : "emitidas: ") + (n ? "solo de " + plural(n, l === "proveedores" ? "proveedor" : "cliente", l) : oc ? "según lo elegido" : "todas");
            }).join(" · ") + (oc ? " (y " + oc + " más de otras empresas)" : "");
        }
        return [xml.length ? "XML y PDF de " + xml.join(", ").toLowerCase() : "", n ? plural(n, "Excel", "Excel") : "", docs.join(" y "), solo].filter(Boolean).join(" · ");
    }
    /* Qué lados lleva un envío por lo marcado (igual que contrapartes.lados_que_lleva del servidor): XML recibidos o emitidos
       (los complementos de pago, los dos) y los Excel de cada lado. */
    function ladosQueLleva(c) {
        var xml = c.xml || [], ex = (c.excel || []).map(function (y) { return y && y.que ? y.que : y; });
        var tiene = function (lista, claves) { return claves.some(function (k) { return lista.indexOf(k) !== -1; }); };
        var lados = [];
        if (tiene(xml, ["recibidos", "pagos"]) || tiene(ex, ["xml_recibidos", "conciliacion_recibidos", "pagos"])) lados.push("proveedores");
        if (tiene(xml, ["emitidos", "pagos"]) || tiene(ex, ["xml_emitidos", "conciliacion_emitidos", "pagos"])) lados.push("clientes");
        return lados;
    }
    /* «Recibidas: solo de ACME · Emitidas: todas.» con lo elegido (sets o listas de nombres por lado). */
    function textoSolo(lados, nombres) {          // nombres[lado]: null = sin filtro (todas); [] = filtrado, sin nombres
        if (!lados.some(function (l) { return nombres[l]; })) return "";
        return lados.map(function (l) {
            var n = nombres[l];
            var lista = n ? n.slice(0, 5).join(", ") + (n.length > 5 ? " y " + (n.length - 5) + " más" : "") : "";
            return (l === "proveedores" ? "Recibidas" : "Emitidas") + ": " +
                (!n ? "todas" : n.length ? "solo de " + lista : "solo de los " + l + " elegidos");
        }).join(" · ") + ".";
    }
    // Lo que el robot va haciendo con un envío en curso (18-nov): fila, lista del SAT, validación una por una, armado
    function textoAvance(a) {
        var miles = function (n) { return Number(n || 0).toLocaleString("es-MX"); };
        if (!a) return "Se está verificando y armando ahora…";
        if (a.fase === "fila") return "En la fila: empieza en cuanto termine el envío anterior.";
        if (a.fase === "verificando") return "Pidiendo al SAT la lista del mes…";
        if (a.fase === "validando") return a.total ? "Validando ante el SAT: " + miles(a.hechos) + " de " + miles(a.total) + "…" : "Validando ante el SAT…";
        if (a.fase === "documentos") return a.total ? "Pidiendo al SAT la constancia u opinión nueva: " + miles(a.hechos) + " de " + miles(a.total) + "…" : "Revisando la constancia y la opinión…";
        if (a.fase === "hoy_portal") return "Trayendo lo de hoy del SAT" + (a.total ? " (" + Math.min(a.hechos + 1, a.total) + " de " + plural(a.total, "empresa", "empresas") + ")" : "") + "…";
        if (a.fase === "esperando") return "Esperando la lista del SAT: llegaron " + miles(a.hechos) + " de " + miles(a.total) + " empresas (espera hasta " + (E.esperaListas || 15) + " min)…";
        return "Armando el ZIP y mandando el correo…";
    }
    function botonesDecidir(manual, mandarTxt, esperarTxt) {
        return E.titular ? '<div class="ev-detenido__botones"><button type="button" class="ui-btn ui-btn--primario ui-btn--28" data-accion="decidir" data-decision="mandar">' + esc(mandarTxt || "Mandar así") + "</button>" +
            (esperarTxt === null ? "" : '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-accion="decidir" data-decision="esperar">' + esc(esperarTxt || (manual ? "No mandar" : "Seguir esperando 24 h")) + "</button>") + "</div>"
            : "<p>Lo decide el titular del despacho.</p>";
    }
    function ultimo(e) {
        var v = e.vez || null;
        // 22-nov-2026 (auditoría envios_correos-5): en «A cada cliente», la parte que se quedó sin su lista del SAT se detiene sola;
        // los demás clientes ya recibieron lo suyo
        if (e.detenido && String(e.detenido).indexOf("c|") === 0) {
            var n = v ? v.esperan : 0;
            return '<div class="ev-detenido"><p><b>Detenido</b> · ' + esc((n === 1 ? "1 cliente lleva" : n + " clientes llevan") + " 24 horas sin su lista del SAT (el detalle está en tu campana). " +
                (v ? "Los demás ya recibieron el suyo (" + v.salieron + " de " + v.total + ")." : "Los demás ya recibieron el suyo.")) + "</p>" +
                botonesDecidir(false, n > 1 ? "Mandar así a los " + n : "Mandar así", "Seguir esperando 24 h") + "</div>";
        }
        // 20-nov-2026 (el dueño): un envío incompleto no sale solo; se detiene y el titular decide
        if (e.detenido) {
            var manual = String(e.detenido).indexOf("m|") === 0;
            var txt = manual ? "No se mandó: al validar, al SAT le faltó entregar algo (el detalle está en tu campana). El envío programado sigue su calendario."
                             : "No salió: lleva 24 horas incompleto contra el SAT (el detalle está en tu campana).";
            // 21-nov-2026 (auditoría M3): el «Enviar ahora» en espera ya no frena al programado; si los dos esperan, primero
            // se decide el programado y después sale este otro
            if (!manual && e.detenido_manual) txt += " Además, hay un «Enviar ahora» en espera de tu decisión: lo verás al decidir este.";
            // 21-nov-2026 (revisión de Fable, hallazgo 4): la espera de un «Enviar ahora» vence (72 h, o antes si sale el
            // programado) y no tapa el último envío: la tarjeta lo sigue enseñando debajo
            if (manual && e.detenido_manual_vence) txt += " Esta espera vence el " + cuando(e.detenido_manual_vence, true) + " (o antes, si sale bien el envío programado).";
            return '<div class="ev-detenido"><p><b>' + (manual ? "En espera de tu decisión" : "Detenido") + "</b> · " + esc(txt) + "</p>" +
                botonesDecidir(manual) + "</div>" + (manual ? lineaUltimo(e) : "");
        }
        // 22-nov-2026 (auditoría envios_correos-5): salió a los completos y algunos esperan su lista; salen solos al llegar
        if (v && v.automatico && v.abierta && v.esperan && !e.en_curso) {
            return '<div class="ev-detenido ev-detenido--espera"><p><b>Salió a ' + v.salieron + " de " + v.total + "</b> · " +
                esc((v.esperan === 1 ? "1 cliente espera" : v.esperan + " clientes esperan") + " su lista del SAT" + (v.espera_desde ? " (desde el " + cuando(v.espera_desde, true) + ")" : "") +
                    (e.activa ? ": sale solo en cuanto llegue; a las 24 horas se detiene y te pregunta." : ". Está apagado: no sale solo hasta que lo prendas.")) + "</p>" +
                botonesDecidir(false, v.esperan > 1 ? "Mandar así a los " + v.esperan : "Mandarlo así", null) + "</div>";
        }
        // 22-nov-2026 (auditoría envios_correos-1): mientras el automático espera al SAT, la tarjeta lo dice (antes solo enseñaba el
        // último envío y una hora que ya había pasado, y el titular lo mandaba a mano: los clientes lo recibían dos veces)
        if (e.espera && !e.en_curso) {
            var x = e.espera;
            return '<p class="ev-ultimo ev-ultimo--avance">' + esc("Esperando la lista del SAT desde " + (x.desde ? cuando(x.desde, true) : "las " + E.hora + ":00") +
                (x.total ? " · " + (x.total === 1 ? "falta la empresa" : "faltan " + x.faltan + " de " + x.total + " empresas") : "") +
                ". Se revisa cada hora; si a las 24 horas sigue incompleto, se detiene y te pregunta.") + "</p>" + lineaUltimo(e);
        }
        return lineaUltimo(e);
    }
    function lineaUltimo(e) {
        if (e.en_curso) return '<p class="ev-ultimo ev-ultimo--avance">' + esc(textoAvance(e.avance)) + "</p>";
        var u = e.ultimo, v = e.vez;
        if (!u) return '<p class="ev-ultimo">Todavía no se ha mandado.</p>';
        // 22-nov-2026 (auditoría envios_correos-2): la última vez completa, no solo su último renglón («41 de 50 salieron»)
        if (v && (v.total > 1 || v.reintentan)) {
            var partes = [];
            if (v.no_salieron) partes.push(v.no_salieron === 1 ? "1 no salió" : v.no_salieron + " no salieron");
            if (v.reintentan) partes.push(v.reintentan === 1 ? "1 se vuelve a intentar en una hora" : v.reintentan + " se vuelven a intentar en una hora");
            if (v.faltan) partes.push(v.faltan + " por mandar");
            var mal = v.no_salieron || v.reintentan;
            var cabeza = v.total > 1 ? v.salieron + " de " + v.total + " salieron" : v.reintentan ? "No salió" : v.salieron ? "Salió" : "No salió";
            return '<p class="ev-ultimo' + (mal ? " ev-ultimo--error" : "") + '"><b>' + esc((v.automatico ? "Automático" : "Última vez") + " (" + cuando(u.momento, true) + "): " + cabeza) + "</b>" +
                (partes.length ? esc(" · " + partes.join(" · ")) : "") + (mal ? esc(". El detalle está en el historial y en tu campana.") : "") + "</p>";
        }
        if (u.estado === "error") return '<p class="ev-ultimo ev-ultimo--error"><b>El último no salió</b> (' + esc(cuando(u.momento, true)) + "): " + esc(u.error || "") + "</p>";
        var txt = u.estado === "enviado" ? plural(u.comprobantes, "comprobante", "comprobantes") + " · " + peso(u.bytes) + (u.en_descargas ? " · en Mis descargas" : u.adjunto ? " · adjunto y enlace" : " · solo enlace")
            : "nada que mandar";
        return '<p class="ev-ultimo">Último: ' + esc(cuando(u.momento, true)) + " · " + esc(txt) + "</p>";
    }
    function pintar() {
        var caja = $("ev-lista"), todos = E.envios, lista = programados();
        caja.classList.toggle("ev-solo-lectura", !E.titular);
        // El botón: con lugar para un programado, o siempre que se pueda mandar uno «Solo una vez» (no cuenta en el límite)
        $("ev-nuevo").hidden = !E.titular || !todos.length;      // vacío: el botón va en el propio aviso, uno solo
        pintarUnaVez();
        if (!lista.length) {
            caja.innerHTML = '<div class="ui-vacio ev-vacio"><b>Todavía no hay envíos</b><span>' + (E.titular
                ? "Crea hasta " + E.max + " para que los XML, PDF, Excel, constancias y opiniones de tus empresas salgan solos por correo."
                : "Los define el titular del despacho. Cuando existan, aquí marcas cuáles de tus empresas van en cada uno.") + "</span>" +
                (E.titular ? '<button type="button" class="ui-btn ui-btn--primario ui-btn--32" data-accion="nuevo">+ Nuevo envío</button>' : "") + "</div>";
            if (todos.length) caja.innerHTML = '<div class="ui-vacio ev-vacio"><b>No hay envíos programados</b><span>' +
                (E.titular ? "Los de «Solo una vez» están abajo. Crea uno programado con «+ Nuevo envío»." : "Los define el titular del despacho.") + "</span></div>";
            pintarMatriz();
            return;
        }
        caja.innerHTML = lista.map(function (e) {
            var emp = e.empresas.length ? plural(e.empresas.length, "empresa", "empresas") + ": " + e.empresas.slice(0, 3).map(nombreEmpresa).join(", ") +
                (e.empresas.length > 3 ? " y " + (e.empresas.length - 3) + " más" : "") : "ninguna todavía: márcalas abajo";
            var para = e.destino === "cliente" ? "cada cliente, a su correo" + (e.para.concat(e.cc || []).length ? " · copia a " + e.para.concat(e.cc || []).join(", ") : "")
                : e.para.concat(e.cc || []).join(", ");
            return '<article class="ui-tarjeta ev-tarjeta' + (e.activa ? "" : " ev-tarjeta--pausado") + '" data-id="' + esc(e.id) + '">' +
                '<header><div><h2><span class="ev-num">' + e.numero + "</span>" + esc(e.nombre) + "</h2><small>" + esc(e.cada) + " · " + (e.modo === "mes" ? "el mes completo, verificado" : "solo lo nuevo") + "</small></div>" +
                '<label class="ui-switch" title="' + (e.activa ? "Encendido: se manda solo. Apágalo para pausarlo." : "Apagado: no se manda solo.") + '"><input type="checkbox" data-accion="activar"' +
                (e.activa ? " checked" : "") + ' aria-label="Encendido"><span class="ui-switch__riel"></span></label></header>' +
                '<dl class="ev-datos"><div><dt>Para</dt><dd>' + esc(para) + "</dd></div>" +
                "<div><dt>Empresas</dt><dd>" + esc(emp) + "</dd></div>" +
                "<div><dt>Lleva</dt><dd>" + esc(lleva(e.contenido)) + "</dd></div>" +
                "<div><dt>Próximo</dt><dd>" + (e.activa ? esc(cuando(e.proxima)) + ", " + E.hora + ":00" + (e.periodo_proximo ? " · lleva " + esc(e.periodo_proximo) : "") : "apagado") + "</dd></div></dl>" +
                ultimo(e) +
                '<div class="ev-acciones"><button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-accion="enviar"' + (e.en_curso || !e.empresas.length ? " disabled" : "") + ">Enviar ahora</button>" +
                '<button type="button" class="ui-btn ui-btn--terciario ui-btn--32" data-accion="historial">Historial</button>' +
                (E.titular ? '<button type="button" class="ui-btn ui-btn--terciario ui-btn--32" data-accion="duplicar" title="Otro envío con esta misma configuración">Duplicar</button>' : "") +
                '<button type="button" class="ui-btn ui-btn--terciario ui-btn--32" data-accion="editar">Editar</button></div></article>';
        }).join("");
        pintarMatriz();
    }
    async function cargar() {
        var r = await api("/api/entregas");
        E.envios = r.envios; E.tope = r.tope_adjunto_mb; E.hora = r.hora; E.limite = r.hora_limite; E.max = r.max; E.titular = r.titular; E.esperaListas = r.espera_listas_min;
        E.portalHoy = r.portal_hoy_min;
        pintar();
        clearTimeout(E.reloj);
        if (E.envios.some(function (e) { return e.en_curso; })) E.reloj = setTimeout(function () { cargar().catch(function () { /* se reintenta al siguiente */ }); }, 4000);
    }

    /* ============================================================ «Enviados una vez» (21-nov-2026)
       Los «Solo una vez, ahora» ya salieron y no vuelven a salir solos: van plegados, del más nuevo al más viejo, cada uno con
       cuándo salió, qué periodo y corte llevó, cómo quedó y sus botones (Historial, Duplicar, Borrar). */
    function pintarUnaVez() {
        var sec = $("ev-unavez"), lista = deUnaVez().sort(function (a, b) { return (b.creado_en || "").localeCompare(a.creado_en || ""); });
        sec.hidden = !lista.length;
        if (!lista.length) { $("ev-unavez-lista").innerHTML = ""; return; }
        $("ev-unavez-cuenta").textContent = plural(lista.length, "envío", "envíos");
        $("ev-unavez-lista").innerHTML = lista.map(function (e) {
            var u = e.una_vez || {}, para = e.destino === "cliente" ? "cada cliente, a su correo" : e.para.concat(e.cc || []).join(", ");
            var corte = u.corte === "ahora" ? "hasta hoy" : "hasta ayer";
            return '<article class="ev-unavez__fila" data-id="' + esc(e.id) + '"><div class="ev-unavez__txt"><b>' + esc(e.nombre) + "</b><small>" +
                esc([e.periodo_una_vez, corte, "a " + para].filter(Boolean).join(" · ")) + "</small>" + ultimo(e) + "</div>" +
                '<div class="ev-acciones"><button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-accion="historial">Historial</button>' +
                (E.titular ? '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-accion="duplicar" title="Uno nuevo con lo mismo">Duplicar</button>' +
                    '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28 ev-borrar" data-accion="borrar">Borrar</button>' : "") + "</div></article>";
        }).join("");
    }

    /* ============================================================ las casillas «Envío 1…5» por empresa */
    function visibles() {
        var q = $("ev-matriz-buscar").value.trim().toLowerCase();
        return E.op.empresas.filter(function (e) { return !q || e.alias.toLowerCase().indexOf(q) !== -1 || e.rfc.toLowerCase().indexOf(q) !== -1; });
    }
    function pintarMatriz() {
        var sec = $("ev-matriz"), lista = programados();          // los de una vez ya salieron: no llevan casillas
        sec.hidden = !lista.length || !E.op.empresas.length;
        if (sec.hidden) return;
        // Plegada para el titular (ya marca las empresas en el formulario); abierta para quien solo puede marcar las suyas
        if (!E.matrizVista) { E.matrizVista = true; sec.open = !E.titular; }
        var marcadas = new Set(); lista.forEach(function (e) { e.empresas.forEach(function (r) { marcadas.add(r); }); });
        $("ev-matriz-cuenta").textContent = plural(marcadas.size, "empresa marcada", "empresas marcadas") + " de " + E.op.empresas.length;
        var envs = lista;
        lista = visibles();
        $("ev-matriz-enc").innerHTML = "<tr><th>Empresa</th>" + envs.map(function (e) {
            var todas = lista.length && lista.every(function (x) { return e.empresas.indexOf(x.rfc) !== -1; });
            return '<th class="ev-col' + (e.activa ? "" : " ev-col--apagado") + '"><label title="Marcar o quitar todas las que ves en «' + esc(e.nombre) + '»"><span>Envío ' + e.numero + "</span><small>" + esc(e.nombre) +
                '</small><input type="checkbox" data-todas="' + esc(e.id) + '"' + (todas ? " checked" : "") + ' aria-label="Todas las que ves en Envío ' + e.numero + '"></label></th>';
        }).join("") + "</tr>";
        $("ev-matriz-cuerpo").innerHTML = lista.length ? lista.map(function (x) {
            return "<tr><td>" + esc(x.alias) + (x.alias !== x.rfc ? " <small>" + esc(x.rfc) + "</small>" : "") + "</td>" + envs.map(function (e) {
                return '<td class="ev-col"><input type="checkbox" data-envio="' + esc(e.id) + '" data-rfc="' + esc(x.rfc) + '"' + (e.empresas.indexOf(x.rfc) !== -1 ? " checked" : "") +
                    ' aria-label="' + esc(x.alias) + " en Envío " + e.numero + '"></td>';
            }).join("") + "</tr>";
        }).join("") : '<tr><td colspan="' + (envs.length + 1) + '">Ninguna empresa coincide con la búsqueda.</td></tr>';
    }
    async function asignar(id, rfcs, dentro, casilla) {
        try {
            var r = await mandar("/api/entregas/" + encodeURIComponent(id) + "/empresas", "POST", { rfcs: rfcs, dentro: dentro });
            var e = E.envios.find(function (x) { return x.id === id; });
            if (e) e.empresas = r.empresas;
            pintar();
        } catch (err) { if (casilla) casilla.checked = !casilla.checked; Fiscontable.toast(err.message); }
    }

    /* ============================================================ el formulario, en pasos */
    var PASOS = ["A quién", "Empresas", "Cuándo", "Qué lleva", "Mensaje"];          // 21-nov-2026: el periodo antes de qué lleva
    var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    function mesTxt(m) { return MESES[Number(m.slice(5, 7)) - 1] + " " + m.slice(0, 4); }
    function periodoTxt(meses) {          // ["2026-10", "2026-11"] -> «octubre y noviembre 2026» (igual que el servidor)
        meses = meses.slice().sort();
        if (!meses.length) return "";
        var mismo = meses.every(function (m) { return m.slice(0, 4) === meses[0].slice(0, 4); });
        var partes = meses.map(function (m) { return mismo ? MESES[Number(m.slice(5, 7)) - 1] : mesTxt(m); });
        return (partes.length > 1 ? partes.slice(0, -1).join(", ") + " y " + partes[partes.length - 1] : partes[0]) + (mismo ? " " + meses[0].slice(0, 4) : "");
    }
    function mesDe(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
    function mesesDeHoy(frecuencia, cierre) {      // lo que llevaría «el mes completo» si saliera hoy
        var h = new Date(), actual = mesDe(h), anterior = mesDe(new Date(h.getFullYear(), h.getMonth() - 1, 1));
        return frecuencia === "mensual" ? [anterior] : (cierre !== false && h.getDate() <= 7) ? [anterior, actual] : [actual];
    }
    function pintarDias() {
        var f = $("ev-frecuencia").value, sel = $("ev-dia"), previo = sel.value;
        $("ev-dia-caja").hidden = f === "quincenal" || f === UNA_VEZ;
        if (f === "semanal") sel.innerHTML = E.op.dias_semana.map(function (d, i) { return '<option value="' + i + '">' + esc(d.charAt(0).toUpperCase() + d.slice(1)) + "</option>"; }).join("");
        else if (f === "mensual") { var h = ""; for (var i = 1; i <= 28; i++) h += '<option value="' + i + '">Día ' + i + "</option>"; sel.innerHTML = h; }
        if (sel.querySelector('option[value="' + previo + '"]')) sel.value = previo;
        pintarPeriodo();
    }
    function pintarPeriodo() {
        var mes = document.querySelector('input[name="ev-modo"]:checked').value === "mes", f = $("ev-frecuencia").value, cierre = $("ev-cierre").checked;
        var una = f === UNA_VEZ;
        pintarExcelPeriodo();
        // «Solo una vez, ahora» (21-nov-2026): el periodo y el corte como en «Enviar ahora»; sin día, sin modo y sin «avisar»
        $("ev-una-caja").hidden = !una; $("ev-modo-caja").hidden = una; $("ev-avisar-caja").hidden = una;
        $("ev-guardar").textContent = una && !E.editando ? "Guardar y mandar" : "Guardar";
        $("ev-dlg-sub").textContent = una ? "Sale en cuanto lo guardes y no queda programado. En el último paso eliges si llega por correo o se queda en Mis descargas."
            : "Se manda solo, a las " + E.hora + " de la mañana del día que toque. En el último paso eliges si llega por correo o se queda en Mis descargas.";
        $("ev-verifica-txt").textContent = una ? "Antes de mandarlo se revisa contra el SAT que no falte ninguno y se valida el estado de todo lo que va. No vuelve a salir solo " +
            "ni cuenta en tus " + E.max + " envíos programados; queda en «Enviados una vez», con su historial."
            : TXT_VERIFICA;
        if (una) {
            if ($("ev-primera")) $("ev-primera").hidden = true;
            $("ev-cierre-caja").hidden = true;
            var meses = mesesUna(), hoy = enCentro().mes;
            $("ev-una-corte-caja").hidden = meses.indexOf(hoy) === -1;          // un mes cerrado ya va completo
            if ($("ev-una-corte-caja").hidden) document.querySelector('input[name="ev-una-corte"][value="ayer"]').checked = true;
            pintarCortes($("ev-una-caja"));
            $("ev-periodo-txt").textContent = meses.length > 12 ? "Son " + meses.length + " meses: se mandan hasta 12 de una vez. Acorta el periodo."
                : "Lleva " + periodoTxt(meses) + ", cada mes en su carpeta.";
            return;
        }
        pintarPrimera(f);
        $("ev-cierre-caja").hidden = !mes || f === "mensual";          // el mensual ES el cierre: siempre manda el mes anterior
        $("ev-modo-mes-txt").textContent = f === "mensual" ? "El mes anterior completo, ya cerrado."
            : cierre ? "El mes en curso completo cada vez (y, la primera semana, también el mes que acaba de cerrar)." : "El mes en curso completo cada vez.";
        $("ev-periodo-txt").textContent = mes ? "Si saliera hoy llevaría " + periodoTxt(mesesDeHoy(f, cierre)) + ". Para mandar otro mes una sola vez, usa «Enviar ahora» y elígelo ahí."
            : "Lleva lo que haya llegado desde el envío anterior. Para mandar un mes completo una sola vez, usa «Enviar ahora» y elígelo ahí.";
    }
    /* 22-nov-2026 (auditoría envios_correos-1): el formulario dice cuándo sale la primera vez («El primero sale el lunes 30 de
       noviembre»). Si se crea o se cambia el día después de las 7 del día que le toca, es la siguiente: ya no sale en la
       siguiente vuelta de la hora. */
    function diaElegido(f) { return f === "quincenal" ? 1 : Number($("ev-dia").value) || (f === "mensual" ? 1 : 0); }
    function pintarPrimera(f) {
        var caja = $("ev-primera"); if (!caja) return;
        var ed = E.editando, dia = diaElegido(f);
        var mismo = ed && ed.frecuencia === f && Number(ed.dia) === dia && ed.activa && ed.proxima;
        var fecha = mismo ? String(ed.proxima).slice(0, 10) : primeraFecha(f, dia);
        caja.textContent = ed && !ed.activa ? "Está apagado: al prenderlo, el primero sale el " + fechaLarga(primeraFecha(f, dia)) + ", a las " + E.hora + ":00."
            : (mismo ? "El próximo sale el " : "El primero sale el ") + fechaLarga(fecha) + ", a las " + E.hora + ":00.";
        caja.hidden = false;
    }
    /* ¿El periodo elegido en «Cuándo» abarca más de un mes? (21-nov-2026, el dueño). Es la regla del servidor (motor.armar:
       el Excel de todos los meses solo sale si el paquete lleva más de un mes): «Solo una vez» con Desde y Hasta distintos; el
       semanal o quincenal de «mes completo» con el cierre (la primera semana lleva el mes que cerró y el que corre); «solo lo
       nuevo», que acomoda por su mes lo que llegó tarde. El mensual, o sin el cierre, lleva un solo mes. */
    function variosMeses() {
        var f = $("ev-frecuencia").value;
        if (f === UNA_VEZ) return mesesUna().length > 1;
        if (document.querySelector('input[name="ev-modo"]:checked').value === "nuevo") return true;
        return f !== "mensual" && $("ev-cierre").checked;
    }
    /* «Además, un Excel con todos los meses juntos»: solo con más de un mes y algún Excel. Si se oculta, la casilla guarda lo
       que tenía (al editar no se pierde, y «Enviar ahora» con varios meses lo sigue usando). */
    function pintarExcelPeriodo() {
        $("ev-excel-periodo-caja").hidden = !$("ev-excel").querySelector("input:checked") || !variosMeses();
    }
    /* «Hasta hoy» solo cambia los XML, PDF y Excel: con solo la constancia o la opinión no agrega nada y tarda más (21-nov-2026) */
    function pintarCorteLleva() {
        var marcado = function (id) { return !!$(id).querySelector("input:checked"); };
        var hoy = $("ev-frecuencia").value === UNA_VEZ && !$("ev-una-corte-caja").hidden && document.querySelector('input[name="ev-una-corte"]:checked').value === "ahora";
        $("ev-lleva-corte").hidden = !(hoy && !marcado("ev-xml") && !marcado("ev-excel") && marcado("ev-docs"));
    }
    function pintarDestino() {
        var cliente = document.querySelector('input[name="ev-destino"]:checked').value === "cliente";
        $("ev-para-etq").innerHTML = cliente ? "Copia <i>(opcional: además del correo de cada cliente)</i>" : "Para";
        pintarLugar();
        pintarSinCorreo();
    }
    /* 22-nov-2026 (auditoría envios_correos-2): en «A cada cliente», qué empresas no tienen correo en su ficha (a esas no les
       llega nada). En «A quién», de las elegidas o, si todavía no hay, de todas; en «Empresas», de las elegidas. */
    function pintarSinCorreo() {
        var cliente = document.querySelector('input[name="ev-destino"]:checked').value === "cliente";
        var elegidas = Array.from(E.marcadas || []), de = sinCorreo(elegidas.length ? elegidas : null), dePasos = sinCorreo(elegidas);
        var uno = $("ev-sin-correo"), dos = $("ev-sin-correo-emp");
        if (uno) {
            uno.hidden = !cliente || !de.length;
            uno.textContent = de.length ? (de.length === 1 ? "1 empresa" : de.length + " empresas") + (elegidas.length ? " de las elegidas" : " de tu lista") +
                " no tiene" + (de.length === 1 ? "" : "n") + " correo en su ficha: " + nombresCortos(de, 4) + (de.length === 1 ? ". A esa no le llega nada" : ". A esas no les llega nada") + " hasta que se lo agregues en Clientes." : "";
        }
        if (dos) {
            dos.hidden = !cliente || !dePasos.length;
            dos.textContent = dePasos.length ? "Sin correo en su ficha (no les llega nada): " + nombresCortos(dePasos, 6) + ". Agrégaselo en Clientes › editar › correo." : "";
        }
    }
    /* Dónde queda el paquete: en el correo (enlace que vence, con o sin adjunto) o en «Mis descargas» (el correo solo
       avisa). A cada cliente siempre va por correo: el cliente no entra a Fiscontable. */
    function enDescargas() { return document.querySelector('input[name="ev-lugar"]:checked').value === "descargas"; }
    function pintarLugar() {
        var cliente = document.querySelector('input[name="ev-destino"]:checked').value === "cliente";
        var desc = document.querySelector('input[name="ev-lugar"][value="descargas"]');
        if (cliente && desc.checked) document.querySelector('input[name="ev-lugar"][value="correo"]').checked = true;
        desc.disabled = cliente;
        $("ev-lugar-desc-txt").textContent = cliente ? "No aplica cuando va a cada cliente: el cliente no entra a Fiscontable."
            : "El correo y la campana solo avisan que ya está listo; se baja al entrar. En un despacho, cada persona ve lo de sus empresas. Se conserva " + (E.op.dias_descargas || 7) + " días.";
        var d = enDescargas();
        $("ev-adjuntar-caja").hidden = d; $("ev-dias-enlace-caja").hidden = d;
    }
    function pintarUsuarios() {
        var us = E.op.usuarios || [];
        $("ev-usuarios-caja").hidden = !us.length;
        $("ev-usuarios").innerHTML = us.map(function (u) {
            return '<label class="ui-check"><input type="checkbox" value="' + esc(u.correo) + '"' + (E.correos.cc.tiene(u.correo) ? " checked" : "") + "> <span>" + esc(u.nombre) +
                (u.nombre !== u.correo ? " <small>" + esc(u.correo) + "</small>" : "") + "</span></label>";
        }).join("");
    }
    /* --- empresas: lista desplegable con buscador; las elegidas, abajo, como pastillas */
    function pintarEmpresas() {
        var q = $("ev-emp-buscar").value.trim().toLowerCase(), marcadas = E.marcadas;
        var lista = E.op.empresas.filter(function (e) { return !q || e.alias.toLowerCase().indexOf(q) !== -1 || e.rfc.toLowerCase().indexOf(q) !== -1; });
        $("ev-empresas").innerHTML = lista.length ? lista.map(function (e) {
            return '<label class="ui-check" role="option" aria-selected="' + marcadas.has(e.rfc) + '"><input type="checkbox" value="' + esc(e.rfc) + '"' + (marcadas.has(e.rfc) ? " checked" : "") + "><span>" + esc(e.alias) +
                (e.alias !== e.rfc ? " <small>" + esc(e.rfc) + "</small>" : "") + "</span></label>";
        }).join("") : '<p class="ev-empresas__vacio">' + (E.op.empresas.length ? "Ninguna empresa coincide con la búsqueda." : "Todavía no tienes empresas en tu directorio.") + "</p>";
        pintarElegidas();
    }
    function pintarElegidas() {
        var n = E.marcadas.size, total = E.op.empresas.length;
        $("ev-combo-boton").textContent = n ? plural(n, "empresa elegida", "empresas elegidas") + " de " + total : "Elegir empresas (" + total + ")";
        var elegidas = E.op.empresas.filter(function (e) { return E.marcadas.has(e.rfc); });
        $("ev-elegidas").innerHTML = elegidas.length ? elegidas.map(function (e) {
            return '<span class="ev-pastilla" title="' + esc(e.rfc) + '"><span>' + esc(e.alias) + '</span><button type="button" data-quitar-empresa="' + esc(e.rfc) + '" aria-label="Quitar ' + esc(e.alias) + '">×</button></span>';
        }).join("") : '<span class="ev-elegidas__vacio">Ninguna todavía.</span>';
        pintarSinCorreo();
    }
    function abrirCombo(si) {
        $("ev-combo-panel").hidden = !si; $("ev-combo-boton").setAttribute("aria-expanded", String(si));
        $("ev-combo").classList.toggle("ev-combo--abierto", si);
        if (si) { $("ev-emp-buscar").value = ""; pintarEmpresas(); $("ev-emp-buscar").focus(); }
    }
    /* --- el correo: plantillas, palabras entre llaves y cómo llegaría */
    function plantillaActual() {
        var a = $("ev-asunto").value.trim(), m = $("ev-mensaje").value.trim();
        var p = E.op.plantillas.find(function (x) { return x.asunto === a && x.mensaje.trim() === m; });
        return p ? p.clave : "";
    }
    function pintarPlantillas() {
        var actual = plantillaActual();
        $("ev-plantillas").innerHTML = E.op.plantillas.map(function (x) {
            return '<button type="button" class="ev-chip" data-plantilla="' + esc(x.clave) + '" aria-pressed="' + (x.clave === actual) + '">' + esc(x.nombre) + "</button>";
        }).join("") + '<span class="ev-chip ev-chip--nota" aria-hidden="' + (actual ? "true" : "false") + '"' + (actual ? " hidden" : "") + ">Personalizado</span>";
    }
    function valoresEjemplo() {
        var elegidas = E.op.empresas.filter(function (e) { return E.marcadas.has(e.rfc); }).map(function (e) { return e.alias; });
        var cliente = document.querySelector('input[name="ev-destino"]:checked').value === "cliente";
        if (cliente && elegidas.length) elegidas = elegidas.slice(0, 1);
        var empresas = !elegidas.length ? "tus empresas" : elegidas.length === 1 ? elegidas[0] : elegidas.length <= 3 ? elegidas.slice(0, -1).join(", ") + " y " + elegidas[elegidas.length - 1] : elegidas.length + " empresas";
        var hoy = new Date(), mes = $("ev-frecuencia").value === UNA_VEZ ? mesesUna()          // 21-nov-2026: el Desde / Hasta elegido
            : document.querySelector('input[name="ev-modo"]:checked').value === "mes" ? mesesDeHoy($("ev-frecuencia").value, $("ev-cierre").checked) : [mesDe(hoy)];
        var c = leerForm().contenido, partes = c.xml.map(function (k) { return "12 " + de(E.op.xml, k).toLowerCase(); });
        if (c.excel.length) partes.push(plural(c.excel.length, "Excel", "Excel"));
        var vence = new Date(hoy.getTime() + (Number($("ev-dias-enlace").value) || 7) * 86400000);
        var juntos = c.excel_periodo && !$("ev-excel-periodo-caja").hidden && mes.length > 1 && c.excel.length;
        var detalle = "· " + (elegidas[0] || "Tu empresa") + ", " + mesTxt(mes[mes.length - 1]) + ": " + (partes.join(", ") || "sus documentos") + "." +
            (juntos ? "\n· " + (elegidas[0] || "Tu empresa") + ", todo el periodo: " + plural(c.excel.length, "Excel", "Excel") + "." : "") +
            (elegidas.length > 1 && !cliente ? "\n· … y así cada empresa" : "") +
            (enDescargas() ? "\n\nYa está listo en tu cuenta de Fiscontable, en «Mis descargas» (2.4 MB).\nSe conserva " + (E.op.dias_descargas || 7) + " días; después se borra. En un despacho, cada persona ve lo de sus empresas."
                : "\n\nDescárgalo aquí (2.4 MB): https://…\nEl enlace vence el " + vence.toLocaleDateString("es-MX") + "; después el archivo se borra." + ($("ev-adjuntar").checked ? " También va adjunto a este correo." : ""));
        return { envio: $("ev-nombre").value.trim() || nombreAuto(), periodo: periodoTxt(mes),
                 fecha: hoy.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" }), empresas: empresas, detalle: detalle };
    }
    /* El nombre de un envío sin nombre (19-nov, el dueño): el mismo que arma el servidor (motor.nombre_automatico), para la vista
       previa. «Mensual · 3 empresas · XML y Excel», «A cada cliente · semanal · XML». */
    function nombreAuto() {
        var f = leerForm(), c = f.contenido, frec = { semanal: "Semanal", quincenal: "Quincenal", mensual: "Mensual" }[f.frecuencia] || "Semanal";
        var cuantas = f.empresas.length === 1 ? nombreEmpresa(f.empresas[0]).slice(0, 30) : f.empresas.length ? f.empresas.length + " empresas" : "sin empresas";
        var lleva = (c.xml.length ? ["XML"] : []).concat(c.excel.length ? ["Excel"] : []), docs = c.docs || [];
        if (docs.length) lleva.push(!lleva.length ? docs.map(function (x) { return x === "csf" ? "constancia" : "opinión"; }).join(" y ")
            : docs.length === 1 ? (docs[0] === "csf" ? "constancia" : "opinión") : "documentos");
        var que = lleva.length > 1 ? lleva.slice(0, -1).join(", ") + " y " + lleva[lleva.length - 1] : lleva[0] || "sin contenido";
        que = que.charAt(0).toUpperCase() + que.slice(1);
        return (f.destino === "cliente" ? ["A cada cliente", frec.toLowerCase(), que] : [frec, cuantas, que]).join(" · ").slice(0, 80);
    }
    function poner(texto, v) { return texto.replace(/\{([a-z_]+)\}/g, function (todo, k) { return Object.prototype.hasOwnProperty.call(v, k) ? v[k] : todo; }); }
    function pintarVista() {
        var v = valoresEjemplo(), m = $("ev-mensaje").value.trim() || E.op.plantillas[0].mensaje;
        if (m.indexOf("{detalle}") === -1) m += "\n\n{detalle}";
        $("ev-vista-asunto").textContent = poner($("ev-asunto").value.trim() || E.op.plantillas[0].asunto, Object.assign({}, v, { detalle: "" }));
        $("ev-vista-cuerpo").textContent = poner(m, v);
        pintarPlantillas();
    }
    function palabrasRaras(texto, enAsunto) {
        var claves = E.op.variables.map(function (x) { return x.clave; }), raras = [];
        texto.replace(/\{([^{}\n]*)\}/g, function (todo, k) { if (claves.indexOf(k) === -1 || (enAsunto && k === "detalle")) raras.push(todo); return todo; });
        return raras;
    }
    /* --- pasos */
    function errorDePaso(n) {
        if (n === 1) {
            var mal = E.correos.para.pendiente() || E.correos.cc.pendiente();
            if (mal) return "Revisa los correos: «" + mal + "» no parece un correo.";
            if (document.querySelector('input[name="ev-destino"]:checked').value === "grupo" && !E.correos.para.valores().length) return "Escribe al menos un correo en «Para».";
        }
        if (n === 3 && $("ev-frecuencia").value === UNA_VEZ) {
            if (mesesUna().length > 12) return "Se mandan hasta 12 meses de una vez: acorta el periodo.";
            if (!E.marcadas.size) return "Elige al menos una empresa (paso 2): este envío sale en cuanto lo guardes.";
        }
        if (n === 4) {
            var c = leerForm().contenido;
            if (!c.xml.length && !c.excel.length && !c.docs.length) return "Marca al menos una cosa que mandar (XML y PDF, algún Excel, la constancia o la opinión).";
            var solo = errorDeSolo();
            if (solo) return solo;
        }
        if (n === 5) {
            var r = palabrasRaras($("ev-asunto").value, true).concat(palabrasRaras($("ev-mensaje").value, false));
            if (r.length) return "No se reconoce " + r[0] + ". Usa las palabras de la lista de abajo.";
        }
        return "";
    }
    function pintarPasos() {
        $("ev-pasos").innerHTML = PASOS.map(function (t, i) {
            var n = i + 1;
            return '<li><button type="button" data-ir="' + n + '" class="' + (n < E.paso ? "ev-pasos--hecho" : "") + '"' + (n === E.paso ? ' aria-current="step"' : "") + '><span class="ev-pasos__num">' + n +
                '</span><span class="ev-pasos__txt">' + esc(t) + "</span></button></li>";
        }).join("");
        document.querySelectorAll("#ev-form .ev-paso").forEach(function (s) { s.hidden = Number(s.dataset.paso) !== E.paso; });
        $("ev-atras").hidden = E.paso === 1;
        $("ev-siguiente").hidden = E.paso === PASOS.length;
        $("ev-guardar").hidden = !E.editando && E.paso !== PASOS.length;          // al editar se puede guardar desde cualquier paso
        $("ev-siguiente").className = "ui-btn ui-btn--36 " + ($("ev-guardar").hidden ? "ui-btn--primario" : "ui-btn--secundario");
        $("ev-base").hidden = !E.nota || E.paso !== 1;
        if (E.paso === 5) pintarVista();
        if (E.paso === 3) pintarPeriodo();
        if (E.paso === 4) { pintarExcelPeriodo(); pintarCorteLleva(); if ($("ev-solo").checked) cargarSolo(); }
    }
    // El aviso va al final del formulario: en un paso largo (Qué lleva) quedaba fuera de la vista (21-nov-2026)
    function verError() { try { $("ev-error").scrollIntoView({ block: "nearest" }); } catch (x) { /* navegador viejo */ } }
    function irA(n) {
        var err = $("ev-error");
        err.hidden = true; abrirCombo(false);
        for (var p = E.paso; p < n; p++) {           // hacia adelante, cada paso de en medio tiene que estar bien
            var e = errorDePaso(p);
            if (e) { E.paso = p; pintarPasos(); err.textContent = e; err.hidden = false; verError(); return false; }
        }
        E.paso = Math.min(Math.max(n, 1), PASOS.length);
        pintarPasos();
        $("ev-form").scrollTop = 0;
        return true;
    }
    /* Los últimos 24 meses (del más reciente al más viejo), contados en la hora del centro */
    function opcionesMeses() {
        var c = enCentro(), a = Number(c.mes.slice(0, 4)), m = Number(c.mes.slice(5, 7)), ops = "";
        for (var i = 0; i < 24; i++) {
            var mm = a + "-" + String(m).padStart(2, "0");
            ops += '<option value="' + mm + '">' + esc(mesTxt(mm).replace(/^./, function (x) { return x.toUpperCase(); })) + "</option>";
            m -= 1; if (!m) { m = 12; a -= 1; }
        }
        return ops;
    }
    function mesesEntre(a, b) {          // de «a» a «b» (si están al revés, se acomodan)
        var salida = [];
        if (a > b) { var t = a; a = b; b = t; }
        var d = new Date(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, 1);
        while (mesDe(d) <= b && salida.length <= 24) { salida.push(mesDe(d)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
        return salida;
    }
    function mesesUna() { return mesesEntre($("ev-una-desde").value, $("ev-una-hasta").value); }

    /* 21-nov-2026 (auditoría M9): con el interruptor prendido y sin nadie elegido (o con elegidos que ya no salen en las
       empresas del envío) no se guarda: una lista vacía es «todos» y el envío mandaría todo. El servidor revisa lo mismo. */
    function errorDeSolo() {
        if (!$("ev-solo").checked) return "";
        if (!E.solo.proveedores.size && !E.solo.clientes.size)
            return "Elige al menos un proveedor o cliente en «Solo de estos proveedores / clientes», o apaga esa opción. Sin ninguno, el envío mandaría todo.";
        var emp = Array.from(E.marcadas).sort().join(",");
        if (!E.soloLista || E.soloDe !== emp) return "";          // la lista de estas empresas no ha llegado: lo revisa el servidor
        var lados = ["proveedores", "clientes"];
        for (var i = 0; i < lados.length; i++) {
            var lado = lados[i], hay = {};
            if (!E.solo[lado].size) continue;
            (E.soloLista[lado] || []).forEach(function (x) { hay[x.rfc] = true; });
            if (!Array.from(E.solo[lado]).some(function (r) { return hay[r]; }))
                return "Ninguno de los " + lado + " elegidos tiene comprobantes con las empresas de este envío. Elige otros o apaga «Solo de estos proveedores / clientes»: si no, el envío mandaría lo de todos los " + lado + ".";
        }
        return "";
    }

    /* --- «Solo de estos proveedores / clientes» (21-nov-2026): la lista sale de los XML de las empresas elegidas en el paso 2 */
    async function cargarSolo() {
        var emp = Array.from(E.marcadas).sort().join(",");
        if (E.soloDe === emp && E.soloLista) return pintarSolo();
        E.soloDe = emp; E.soloLista = null;
        var n = ++E.soloN;
        $("ev-solo-lista").innerHTML = '<p class="ev-empresas__vacio">' + (emp ? "Buscando en los XML de las empresas del envío…" : "Elige primero las empresas del envío (paso 2).") + "</p>";
        pintarSoloElegidos();
        if (!emp) return;
        try {
            var r = await api("/api/entregas/contrapartes?empresas=" + encodeURIComponent(emp));
            if (n !== E.soloN) return;          // ya cambiaron las empresas
            E.soloLista = r;
        } catch (err) {
            if (n === E.soloN) $("ev-solo-lista").innerHTML = '<p class="ev-empresas__vacio">' + esc(err.message) + "</p>";
            return;
        }
        pintarSolo();
    }
    function nombreSolo(lado, rfc) {
        var x = ((E.soloLista || {})[lado] || []).find(function (y) { return y.rfc === rfc; });
        return x ? x.nombre : rfc;
    }
    function pintarSolo() {
        if (!E.soloLista) return pintarSoloElegidos();          // todavía no llega la lista
        var lado = E.soloLado, q = $("ev-solo-buscar").value.trim().toLowerCase(), todos = (E.soloLista || {})[lado] || [], elegidos = E.solo[lado];
        document.querySelectorAll("[data-solo-lado]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.soloLado === lado)); });
        ["proveedores", "clientes"].forEach(function (l) { $("ev-solo-n-" + l).textContent = E.solo[l].size ? "(" + E.solo[l].size + ")" : ""; });
        $("ev-solo-lado-txt").textContent = lado === "proveedores" ? "En lo recibido: de quién son las facturas y complementos de pago." : "En lo emitido: a quién se le facturó.";
        var lista = todos.filter(function (x) { return !q || x.nombre.toLowerCase().indexOf(q) !== -1 || x.rfc.toLowerCase().indexOf(q) !== -1; });
        var mas = lista.length > 200 ? lista.length - 200 : 0;
        lista = lista.slice(0, 200);
        $("ev-solo-lista").innerHTML = lista.length ? lista.map(function (x) {
            return '<label class="ui-check" role="option" aria-selected="' + elegidos.has(x.rfc) + '"><input type="checkbox" value="' + esc(x.rfc) + '"' + (elegidos.has(x.rfc) ? " checked" : "") +
                "><span><b>" + esc(x.nombre) + "</b> <small>" + esc(x.rfc) + " · " + plural(x.n, "comprobante", "comprobantes") + "</small></span></label>";
        }).join("") + (mas ? '<p class="ev-empresas__vacio">Y ' + mas + " más: escribe para buscar.</p>" : "")
            : '<p class="ev-empresas__vacio">' + (todos.length ? "Ninguno coincide con la búsqueda." : lado === "proveedores" ? "Las empresas del envío no tienen XML recibidos." : "Las empresas del envío no tienen XML emitidos.") + "</p>";
        pintarSoloElegidos();
    }
    function pintarSoloElegidos() {
        var piezas = [];
        ["proveedores", "clientes"].forEach(function (lado) {
            E.solo[lado].forEach(function (rfc) {
                piezas.push('<span class="ev-pastilla" title="' + esc(rfc) + '"><span>' + (lado === "proveedores" ? "Proveedor: " : "Cliente: ") + esc(nombreSolo(lado, rfc)) +
                    '</span><button type="button" data-quitar-solo="' + lado + "|" + esc(rfc) + '" aria-label="Quitar ' + esc(nombreSolo(lado, rfc)) + '">×</button></span>');
            });
        });
        $("ev-solo-elegidos").innerHTML = piezas.length ? piezas.join("") : '<span class="ev-elegidas__vacio">Ninguno elegido todavía: elige al menos uno (o apaga esta opción para que vayan todos).</span>';
        pintarSoloResumen();
    }
    /* 21-nov-2026 (revisión de Fable, hallazgo 7): lo que de verdad va de cada lado. Un lado sin elegidos va completo. */
    function pintarSoloResumen() {
        var caja = $("ev-solo-resumen"); if (!caja) return;
        var lados = ladosQueLleva(contenidoMarcado()), nombres = {};
        ["proveedores", "clientes"].forEach(function (l) { nombres[l] = E.solo[l].size ? Array.from(E.solo[l]).map(function (r) { return nombreSolo(l, r); }) : null; });
        var txt = $("ev-solo").checked ? textoSolo(lados, nombres) : "";
        caja.textContent = txt ? "Va así: " + txt : "";
        caja.hidden = !txt;
    }
    function contenidoMarcado() {
        var xml = Array.from(document.querySelectorAll("#ev-xml input:checked")).map(function (i) { return i.value; });
        var ex = Array.from(document.querySelectorAll("#ev-excel input[type=checkbox]:checked")).map(function (i) { return { que: i.value }; });
        return { xml: xml, excel: ex };
    }

    function abrirForm(e, base, copia) {
        E.editando = e || null;
        var de_ = e || base || null, todo = e || (copia ? base : null);          // «todo»: también nombre, correos y empresas
        E.marcadas = new Set(todo ? todo.empresas : []);
        E.nota = !e && base ? (copia ? "Es una copia de «" + base.nombre + "»: cambia lo que quieras y guarda." :
            "Empieza con lo mismo que «" + base.nombre + "» (cuándo, qué lleva y el mensaje). Cambia lo que quieras.") : "";
        $("ev-base").textContent = E.nota;
        var c = de_ ? de_.contenido : { xml: ["recibidos", "pagos"], excel: [{ que: "conciliacion_emitidos" }, { que: "pagos" }], docs: [] };      // lo que pidió el dueño, de fábrica
        $("ev-dlg-titulo").textContent = e ? "Editar Envío " + e.numero : "Nuevo envío";
        $("ev-dlg-sub").textContent = "Se manda solo, a las " + E.hora + " de la mañana del día que toque. En el último paso eliges si llega por correo o se queda en Mis descargas.";
        $("ev-verifica-txt").textContent = TXT_VERIFICA;
        // Un nombre automático no se escribe en el campo: se queda vacío (y se rehace si cambia lo que lleva); se ve de ejemplo
        $("ev-nombre").value = e ? (e.nombre_auto ? "" : e.nombre) : copia && !base.nombre_auto ? (base.nombre + " (copia)").slice(0, 80) : "";
        $("ev-nombre").placeholder = e && e.nombre_auto ? e.nombre + " (automático)" : "Vacío: se arma con lo que lleva, por ejemplo «Mensual · 3 empresas · XML y Excel»";
        E.correos.para.poner(todo ? todo.para : []); E.correos.cc.poner(todo ? todo.cc : []);
        document.querySelector('input[name="ev-destino"][value="' + (de_ && de_.destino === "cliente" ? "cliente" : "grupo") + '"]').checked = true;
        pintarDestino(); pintarUsuarios();
        $("ev-emp-buscar").value = ""; abrirCombo(false);
        $("ev-xml").innerHTML = E.op.xml.map(function (x) {
            return '<label class="ui-check"><input type="checkbox" value="' + esc(x.clave) + '"' + (c.xml.indexOf(x.clave) !== -1 ? " checked" : "") + "> " + esc(x.nombre) + "</label>";
        }).join("");
        $("ev-excel").innerHTML = E.op.excel.map(function (x) {
            var puesto = (c.excel || []).find(function (y) { return y.que === x.clave; });
            return '<div class="ev-excel__fila"><label class="ui-check"><input type="checkbox" value="' + esc(x.clave) + '"' + (puesto ? " checked" : "") + "> <span>" + esc(x.nombre) + "</span></label>" +
                '<select class="ui-select" data-vista="' + esc(x.clave) + '" aria-label="Columnas de ' + esc(x.nombre) + '"><option value="">Columnas de fábrica</option>' +
                x.vistas.map(function (v) { return '<option value="' + v.id + '"' + (puesto && puesto.vista === v.id ? " selected" : "") + ">Vista: " + esc(v.nombre) + "</option>"; }).join("") + "</select></div>";
        }).join("");
        $("ev-excel-periodo").checked = !!(c.excel_periodo);
        // «Solo de estos proveedores / clientes» (21-nov-2026): apagado si no tiene ninguno
        var cp = c.contrapartes || {};
        E.solo = { proveedores: new Set(cp.proveedores || []), clientes: new Set(cp.clientes || []) };
        E.soloLado = "proveedores"; E.soloDe = ""; E.soloLista = null; $("ev-solo-buscar").value = "";
        $("ev-solo").checked = !!(E.solo.proveedores.size || E.solo.clientes.size); $("ev-solo-panel").hidden = !$("ev-solo").checked;
        $("ev-docs").innerHTML = E.op.docs.map(function (x) {
            return '<label class="ui-check"><input type="checkbox" value="' + esc(x.clave) + '"' + ((c.docs || []).indexOf(x.clave) !== -1 ? " checked" : "") + "> " + esc(x.nombre) + "</label>";
        }).join("");
        // En qué moneda van los Excel (pesos de fábrica) y qué hojas lleva la conciliación («Para compartir» de fábrica)
        $("ev-moneda").innerHTML = E.op.monedas.map(function (m) { return '<option value="' + esc(m.clave) + '">' + esc(m.nombre) + "</option>"; }).join("");
        $("ev-moneda").value = c.moneda || "xml";
        var cj = E.op.conciliacion, hc = c.conciliacion || "compartir";
        $("ev-conc").innerHTML = Object.keys(cj.juegos).map(function (k) { return '<option value="' + esc(k) + '">' + esc(cj.nombres[k]) + " (" + cj.juegos[k].length + " hojas)</option>"; }).join("") +
            '<option value="">Elegir hojas…</option>';
        E.hojasConc = new Set(Array.isArray(hc) ? hc : cj.juegos[hc] || cj.juegos.compartir);
        $("ev-conc").value = Array.isArray(hc) ? "" : (cj.juegos[hc] ? hc : "compartir");
        $("ev-conc-hojas").innerHTML = cj.hojas.map(function (h) { return '<label class="ui-check"><input type="checkbox" value="' + esc(h.clave) + '"> <span>' + esc(h.nombre) + "</span></label>"; }).join("");
        pintarConc();
        // «Solo una vez, ahora» (21-nov-2026): con los 5 programados ya hechos, uno nuevo solo puede ser de una vez
        var lleno = !e && programados().length >= E.max;
        $("ev-frecuencia").querySelectorAll("option").forEach(function (o) { o.disabled = (lleno && o.value !== UNA_VEZ) || (!!e && o.value === UNA_VEZ); });
        $("ev-frecuencia").value = lleno ? UNA_VEZ : de_ ? de_.frecuencia : "semanal";
        if (lleno) { E.nota = (E.nota ? E.nota + " " : "") + "Ya tienes los " + E.max + " envíos programados: este sale una sola vez, ahora."; $("ev-base").textContent = E.nota; }
        var ops = opcionesMeses(), u = (de_ && de_.una_vez) || {}, um = (u.meses || []).slice().sort(), mesHoy = enCentro().mes;
        $("ev-una-desde").innerHTML = ops; $("ev-una-hasta").innerHTML = ops;
        $("ev-una-desde").value = um[0] && $("ev-una-desde").querySelector('option[value="' + um[0] + '"]') ? um[0] : mesHoy;
        $("ev-una-hasta").value = um.length && $("ev-una-hasta").querySelector('option[value="' + um[um.length - 1] + '"]') ? um[um.length - 1] : mesHoy;
        document.querySelector('input[name="ev-una-corte"][value="' + (u.corte === "ahora" ? "ahora" : "ayer") + '"]').checked = true;
        document.querySelector('input[name="ev-modo"][value="' + (de_ && de_.modo === "nuevo" ? "nuevo" : "mes") + '"]').checked = true;
        pintarDias();
        $("ev-dia").value = String(de_ ? de_.dia : 0);
        $("ev-dias-enlace").value = String(de_ && [3, 5, 7].indexOf(de_.dias_enlace) !== -1 ? de_.dias_enlace : 7);          // una semana como máximo (18-nov)
        $("ev-avisar").checked = !!(de_ && de_.avisar_sin_novedades);
        $("ev-cierre").checked = de_ ? de_.cierre !== false : true;
        pintarPeriodo();
        $("ev-remitente").value = de_ && de_.remitente && de_.remitente !== E.op.remitente ? de_.remitente : "";
        $("ev-remitente").placeholder = E.op.remitente;
        $("ev-adjuntar").checked = de_ ? de_.adjuntar !== false : true;
        document.querySelector('input[name="ev-lugar"][value="' + (de_ && de_.en_descargas ? "descargas" : "correo") + '"]').checked = true;
        pintarLugar();
        $("ev-adjuntar-txt").textContent = "(si pesa hasta " + E.tope + " MB). Sin adjunto, solo con el enlace, es menos probable que caiga en correo no deseado.";
        $("ev-asunto").value = de_ && de_.asunto ? de_.asunto : E.op.plantillas[0].asunto;
        $("ev-mensaje").value = de_ && de_.mensaje ? de_.mensaje : E.op.plantillas[0].mensaje;
        $("ev-variables").innerHTML = E.op.variables.map(function (x) {
            return '<button type="button" class="ev-chip ev-chip--palabra" data-palabra="' + esc(x.clave) + '" title="' + esc(x.nombre) + '">{' + esc(x.clave) + "}</button>";
        }).join("");
        E.campoTexto = $("ev-mensaje");
        $("ev-borrar").hidden = !e; $("ev-error").hidden = true;
        pintarEmpresas();
        E.paso = 1; pintarPasos();
        if (!$("ev-dlg").open) $("ev-dlg").showModal();
        $("ev-nombre").focus();
    }
    // Las hojas de la conciliación solo se preguntan si el envío lleva un Excel de conciliación
    function pintarConc() {
        var lleva = !!$("ev-excel").querySelector('input[value^="conciliacion_"]:checked'), propio = $("ev-conc").value === "";
        $("ev-conc-caja").hidden = !lleva;
        $("ev-conc-hojas").hidden = !lleva || !propio;
        pintarExcelPeriodo();          // solo si lleva algún Excel y el periodo abarca más de un mes
        $("ev-conc-hojas").querySelectorAll("input").forEach(function (i) { i.checked = E.hojasConc.has(i.value); });
    }
    function leerForm() {
        var juego = $("ev-conc").value, orden = E.op.conciliacion.hojas.map(function (h) { return h.clave; });
        var hojas = juego || orden.filter(function (k) { return E.hojasConc.has(k); });
        return {
            nombre: $("ev-nombre").value, para: E.correos.para.valores().join(", "), cc: E.correos.cc.valores().join(", "), empresas: Array.from(E.marcadas),
            destino: document.querySelector('input[name="ev-destino"]:checked').value,
            contenido: {
                xml: Array.from($("ev-xml").querySelectorAll("input:checked")).map(function (i) { return i.value; }),
                excel: Array.from($("ev-excel").querySelectorAll("input:checked")).map(function (i) {
                    var v = $("ev-excel").querySelector('[data-vista="' + i.value + '"]').value;
                    return { que: i.value, vista: v ? Number(v) : null };
                }),
                docs: Array.from($("ev-docs").querySelectorAll("input:checked")).map(function (i) { return i.value; }),
                moneda: $("ev-moneda").value || "xml", conciliacion: (Array.isArray(hojas) && !hojas.length) ? "compartir" : hojas,
                excel_periodo: $("ev-excel-periodo").checked,          // además, un Excel con todo el periodo (19-nov)
                contrapartes: $("ev-solo").checked ? { proveedores: Array.from(E.solo.proveedores), clientes: Array.from(E.solo.clientes) } : { proveedores: [], clientes: [] }
            },
            frecuencia: $("ev-frecuencia").value, dia: Number($("ev-dia").value) || 0, modo: document.querySelector('input[name="ev-modo"]:checked').value,
            dias_enlace: Number($("ev-dias-enlace").value) || 7, avisar_sin_novedades: $("ev-avisar").checked, activa: E.editando ? E.editando.activa : true,
            asunto: $("ev-asunto").value, mensaje: $("ev-mensaje").value, remitente: $("ev-remitente").value, adjuntar: $("ev-adjuntar").checked,
            cierre: $("ev-cierre").checked, en_descargas: enDescargas(),
            // «Solo una vez, ahora» (21-nov-2026): el periodo y el corte, como en «Enviar ahora»
            una_vez: $("ev-frecuencia").value === UNA_VEZ ? { meses: mesesUna(), corte: $("ev-una-corte-caja").hidden ? "ayer" : document.querySelector('input[name="ev-una-corte"]:checked').value } : null
        };
    }
    async function guardar() {
        var b = $("ev-guardar"), err = $("ev-error");
        err.hidden = true;
        // 21-nov-2026: al guardar desde otro paso (editar), la lista de «Solo de…» se trae antes para revisarla aquí y abrir
        // «Qué lleva» si algo no cuadra (el aviso del servidor todavía nombra el paso con su número viejo)
        if ($("ev-solo").checked) await cargarSolo();
        for (var p = 1; p <= PASOS.length; p++) {          // si algo falta, se abre ese paso y lo dice
            var falta = errorDePaso(p);
            if (falta) { E.paso = p; pintarPasos(); err.textContent = falta; err.hidden = false; verError(); return; }
        }
        var datos = leerForm(), una = datos.frecuencia === UNA_VEZ && !E.editando;
        if (una) {          // sale en este momento: se confirma a quién y qué periodo
            var aQuien = datos.destino === "cliente" ? "cada cliente, a su correo" : E.correos.para.valores().concat(E.correos.cc.valores()).join(", ");
            var si = await Fiscontable.confirmar({ titulo: "¿Mandarlo ahora?", si: "Mandar",
                texto: "Sale a " + aQuien + " con " + periodoTxt(datos.una_vez.meses) + (datos.una_vez.corte === "ahora" ? ", hasta hoy (antes trae lo de hoy del SAT)" : ", hasta ayer") +
                       ". No queda programado: no vuelve a salir solo." });
            if (!si) return;
        }
        b.disabled = true;
        try {
            var r = await mandar("/api/entregas" + (E.editando ? "/" + E.editando.id : ""), E.editando ? "PUT" : "POST", datos);
            $("ev-dlg").close();
            await cargar();
            if (una) {          // se ve cómo va en su historial
                var hecho_ = E.envios.find(function (x) { return x.id === r.id; });
                Fiscontable.toast("Se está mandando. Lo ves en «Enviados una vez».");
                if (hecho_) { E.esperando = true; abrirHistorial(hecho_); }
                return;
            }
            // 22-nov-2026 (auditoría envios_correos-1): ya no invita a probarlo con «Enviar ahora» (el día que le toca, los clientes lo
            // recibían dos veces): dice cuándo sale el primero
            var primero = r && r.proxima && r.activa ? "El primero sale el " + fechaLarga(String(r.proxima).slice(0, 10)) + " a las " + E.hora + ":00." : "";
            Fiscontable.toast(E.editando ? "Envío guardado." + (primero && E.editando.proxima !== r.proxima ? " " + primero.replace("El primero", "El próximo") : "")
                : datos.empresas.length ? "Envío creado. " + primero : "Envío creado. Marca sus empresas. " + primero);
        } catch (e) { err.textContent = e.message; err.hidden = false; verError(); }
        finally { b.disabled = false; }
    }

    /* ============================================================ «Enviar ahora»: a quién y de qué periodo */
    function abrirAhora(e) {
        E.ahoraDe = e;
        var aQuien = e.destino === "cliente" ? "cada cliente, a su correo" : e.para.concat(e.cc || []).join(", ");
        $("ev-ahora-titulo").textContent = "¿Mandar el Envío " + e.numero + " ahora?";
        var v = e.vez || {};
        // 22-nov-2026 (auditoría envios_correos-1 y -5): si el automático de hoy ya salió a algunos clientes, mandarlo otra vez les llega dos veces
        $("ev-ahora-sub").textContent = "Sale a " + aQuien + "." + (v.automatico && v.abierta && v.salieron
            ? " Ojo: el automático ya salió a " + v.salieron + " de " + v.total + "; a esos les llegaría otra vez. Para los que faltan, usa «Mandar así» en la tarjeta." : "");
        $("ev-ahora-siempre").textContent = (e.modo === "mes" ? "Lleva " + periodoTxt(e.meses_hoy || mesesDeHoy(e.frecuencia, e.cierre)) + ", completo." : "Lo que llegó desde el envío anterior.") +
            (e.cuenta_hoy ? " Cuenta como el envío automático " + (e.cuenta_hoy === enCentro().iso.slice(0, 10) ? "de hoy" : "del " + fechaLarga(e.cuenta_hoy)) + ": si sale bien, ya no sale solo otra vez." : "");
        // Desde / Hasta (19-nov, el dueño: de agosto a noviembre, hasta 12 meses): los últimos 24 meses, del más reciente al más viejo
        var h = new Date(), ops = "";
        for (var i = 0; i < 24; i++) { var m = mesDe(new Date(h.getFullYear(), h.getMonth() - i, 1)); ops += '<option value="' + m + '">' + esc(mesTxt(m).replace(/^./, function (c) { return c.toUpperCase(); })) + "</option>"; }
        $("ev-ahora-desde").innerHTML = ops; $("ev-ahora-hasta").innerHTML = ops;
        $("ev-ahora-desde").value = $("ev-ahora-hasta").value = mesDe(new Date(h.getFullYear(), h.getMonth() - 1, 1));
        document.querySelector('input[name="ev-ahora-periodo"][value="siempre"]').checked = true;
        $("ev-ahora-mes-caja").hidden = true; $("ev-ahora-calculo").hidden = true;
        document.querySelector('input[name="ev-ahora-corte"][value="ayer"]').checked = true;          // de fábrica, hasta ayer (20-nov)
        pintarCortes($("ev-ahora"));          // 21-nov-2026: con la fecha y la hora reales; el servidor las confirma al calcular
        verCorte();
        // 19-nov (el dueño): «Validar primero» o «Enviar ya». Validar revisa contra el SAT (lista de cada mes con corte a ayer
        // 23:59, estado de cada comprobante, constancia y opinión de más de 30 días); «Enviar ya» sale con lo que hay
        $("ev-ahora-nota").textContent = "«Validar primero» revisa contra el SAT que no falte ninguno (el mes en curso, con corte a ayer 23:59) y el estado de cada comprobante, " +
            "y pide la constancia u opinión si la guardada tiene más de 30 días. Puede tardar hasta " + (E.esperaListas || 15) + " minutos" +
            " (con «Hasta hoy», hasta " + (E.portalHoy || 10) + " más para traer lo de hoy). " +
            "«Enviar ya» sale en seguida con lo que ya está en Fiscontable, sin ir al SAT, y el correo dice que no se verificó. " +
            (e.cuenta_hoy ? "Con otro periodo no cuenta como el automático: no cambia su fecha." : "No cambia la fecha del próximo envío automático.");
        $("ev-ahora-si").disabled = $("ev-ahora-ya").disabled = false;
        if (!$("ev-ahora").open) $("ev-ahora").showModal();
        calcularAhora();
    }
    /* 20-nov-2026 (el dueño): «Hasta ayer, verificado contra el SAT» (de fábrica) o «Hasta este momento» (lleva también lo de
       hoy, sin compararlo con la lista del SAT). Solo se pregunta si el periodo llega a este mes: un mes cerrado ya va completo. */
    function llegaAEsteMes() {
        var e = E.ahoraDe; if (!e) return false;
        var hoy = enCentro().mes, otro = document.querySelector('input[name="ev-ahora-periodo"]:checked').value === "otro";
        if (otro) return mesesAhora().indexOf(hoy) >= 0;
        return e.modo !== "mes" || (e.meses_hoy || mesesDeHoy(e.frecuencia, e.cierre)).indexOf(hoy) >= 0;
    }
    function verCorte() {
        var se = llegaAEsteMes();
        $("ev-ahora-corte-caja").hidden = !se;
        if (!se) document.querySelector('input[name="ev-ahora-corte"][value="ayer"]').checked = true;
    }
    function corteAhora() {          // "ahora" solo si se ve y se eligió; si no, el de siempre
        return !$("ev-ahora-corte-caja").hidden && document.querySelector('input[name="ev-ahora-corte"]:checked').value === "ahora";
    }
    function mesesAhora() {          // los meses de «Desde» a «Hasta» (si están al revés, se acomodan)
        return mesesEntre($("ev-ahora-desde").value, $("ev-ahora-hasta").value);
    }
    /* Antes de mandar, cuánto llevaría y cuánto pesaría (19-nov: con 12 meses y muchas empresas el ZIP puede ser grande). */
    async function calcularAhora() {
        var e = E.ahoraDe, caja = $("ev-ahora-calculo"), si = $("ev-ahora-si"), ya = $("ev-ahora-ya"), otro = document.querySelector('input[name="ev-ahora-periodo"]:checked').value === "otro";
        if (!e) return;
        var b = { set disabled(v) { si.disabled = ya.disabled = v; } };          // los dos botones van juntos
        var meses = otro ? mesesAhora() : [], tope = (E.op && E.op.max_meses_ahora) || 12, pedido = ++E.calculoN;
        if (otro && meses.length > tope) {
            caja.className = "ev-ahora__calculo ev-ahora__calculo--error"; caja.hidden = false;
            caja.textContent = "Son " + meses.length + " meses: se mandan hasta " + tope + " de una vez. Acorta el periodo.";
            b.disabled = true; return;
        }
        b.disabled = false;
        try {
            var r = await api("/api/entregas/" + encodeURIComponent(e.id) + "/calcular?meses=" + encodeURIComponent(meses.join(",")) + (corteAhora() ? "&corte=ahora" : ""));
            if (pedido !== E.calculoN) return;          // ya se cambió el periodo
            if (r.corte_ayer && r.ahora) pintarCortes($("ev-ahora"), r.corte_ayer.slice(0, 16), r.ahora.slice(0, 16));          // la hora del servidor (centro) manda
            var lleva = (otro ? periodoTxt(meses).replace(/^./, function (c) { return c.toUpperCase(); }) + ": " : "") +
                plural(r.comprobantes, "comprobante", "comprobantes") + (r.excel ? " y hasta " + plural(r.excel, "Excel", "Excel") : "") + (r.mb < 1 ? ", menos de 1 MB." : ", unos " + Math.round(r.mb).toLocaleString("es-MX") + " MB.");
            caja.className = "ev-ahora__calculo" + (r.aviso ? (r.se_puede ? " ev-ahora__calculo--aviso" : " ev-ahora__calculo--error") : "");
            caja.textContent = lleva + (r.aviso ? " " + r.aviso : ""); caja.hidden = false;
            b.disabled = !r.se_puede;
        } catch (err) { if (pedido === E.calculoN) { caja.hidden = true; b.disabled = false; } }
    }
    async function mandarAhora(validar) {
        var e = E.ahoraDe, b = $("ev-ahora-si"), ya = $("ev-ahora-ya"); if (!e) return;
        var otro = document.querySelector('input[name="ev-ahora-periodo"]:checked').value === "otro";
        var antes = b.disabled;
        b.disabled = ya.disabled = true;
        try {
            var cuerpo = { meses: otro ? mesesAhora() : [], validar: validar !== false };
            if (corteAhora()) cuerpo.corte = "ahora";          // de fábrica no se manda: el servidor entiende «hasta ayer»
            await mandar("/api/entregas/" + encodeURIComponent(e.id) + "/enviar", "POST", cuerpo);
            $("ev-ahora").close(); E.esperando = true; abrirHistorial(e); await cargar();
        } catch (err) { b.disabled = antes; ya.disabled = antes; fallo(err); }
    }

    /* ============================================================ el historial */
    /* Cada envío hecho, en corto: cuándo, cómo quedó, cuánto llevó y sus botones (copiar el enlace, revocarlo). El
       detalle por empresa va plegado: se abre al tocarlo (18-nov, el dueño: «que me dé lo importante… sin tener expandido
       todo el detalle»). */
    function hecho(v) {
        var est = ESTADOS[v.estado] || [v.estado, "info"];
        var conAlgo = (v.detalle.empresas || []).filter(function (d) { return d.meses.length || (d.docs || []).length || d.verificacion; });
        var verificadas = conAlgo.filter(function (d) { return d.verificacion; });
        var porRevisar = verificadas.filter(function (d) { return d.verificacion.estado !== "completo"; }).length;
        var lineas = conAlgo.map(function (d) {
            var meses = d.meses.map(function (m) {
                var partes = Object.keys(m.partes).map(function (p) {
                    var x = E.op.xml.find(function (y) { return y.clave === p; }) || { nombre: p, uno: p };
                    return m.partes[p].toLocaleString("es-MX") + " " + (m.partes[p] === 1 ? x.uno : x.nombre.toLowerCase());
                });
                if (m.excel.length) partes.push(plural(m.excel.length, "Excel", "Excel"));
                return esc(m.mes.slice(5) + "/" + m.mes.slice(0, 4) + " (" + partes.join(", ") + ")");
            }).join(" · ");
            var docs = (d.docs || []).map(function (x) { return (x.tipo === "csf" ? "constancia" : "opinión 32-D") + (x.fecha ? " del " + x.fecha.slice(8, 10) + "/" + x.fecha.slice(5, 7) + (x.vieja ? "/" + x.fecha.slice(0, 4) + " (vieja)" : "") : ""); })
                .concat((d.sin_docs || []).map(function (x) { return "sin " + (x === "csf" ? "constancia" : "opinión 32-D") + " guardada"; })).join(", ");
            var ver = d.verificacion ? '<br><small><span class="ui-estado ui-estado--' + (VERIFICA[d.verificacion.estado] || "info") + '">' + esc(d.verificacion.texto) + "</span>" +
                (d.validacion && d.validacion.pendientes ? " · " + d.validacion.pendientes + " sin validar su estado (el SAT no respondió)" : "") + "</small>" : "";
            ver += (d.docs || []).filter(function (x) { return x.nota; }).map(function (x) { return '<br><small class="ev-hecho__nota">' + esc(x.nota.replace(/^./, function (c) { return c.toUpperCase(); })) + ".</small>"; }).join("");
            // «Hasta hoy» (21-nov-2026): si lo de hoy se trajo del portal del SAT o por qué puede no estar completo
            if (d.hoy) ver += d.hoy.estado === "traido" ? '<br><small><span class="ui-estado ui-estado--ok">Lo de hoy se trajo del portal del SAT</span></small>'
                : '<br><small class="ev-hecho__nota">Lo de hoy puede no estar completo: ' + esc(d.hoy.texto || "no se trajo del portal del SAT") + ".</small>";
            var todoPeriodo = (d.excel_periodo || []).length ? esc("todo el periodo (" + plural(d.excel_periodo.length, "Excel", "Excel") + ")") : "";
            return "<li><b>" + esc(d.alias) + "</b>: " + ([meses || (docs || todoPeriodo ? "" : "nada del periodo"), todoPeriodo, esc(docs)].filter(Boolean).join(" · ")) + ver + "</li>";
        }).join("");
        var pie = "", enDesc = v.detalle && v.detalle.descargas;
        if (enDesc && v.estado === "enviado") {          // se quedó en «Mis descargas»: no hay enlace que copiar ni que revocar
            pie = "<span>" + esc(peso(v.bytes) + " · en Mis descargas (se conserva " + enDesc + " días)") + "</span>" +
                (v.detalle.aviso_fallo ? '<span class="ev-hecho__aviso">El correo de aviso no salió: ' + esc(v.detalle.aviso_fallo) + "</span>" : "") +
                '<a class="ui-btn ui-btn--terciario ui-btn--28" href="/descargas/">Abrir Mis descargas</a>';
        }
        // Si el correo falló pero el archivo sí se armó, su enlace sirve igual: se puede copiar y mandar a mano
        else if (v.estado === "enviado" || (v.estado === "error" && v.enlace_activo)) {
            pie = "<span>" + esc(peso(v.bytes) + (v.estado === "error" ? " · el archivo sí se armó" : v.adjunto ? " · fue adjunto" : " · solo enlace") + " · " + plural(v.descargas, "descarga", "descargas")) + "</span>" +
                (v.enlace_activo ? "<span>El enlace vence el " + esc(cuando(v.vence)) + "</span>" +
                    '<span class="ev-hecho__botones"><button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-copiar="' + esc(v.url) + '">Copiar enlace</button>' +
                    (E.titular ? '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-revocar="' + esc(v.id) + '">Revocar</button>' : "") + "</span>"
                    : "<span>" + (v.revocado ? "Enlace revocado: el archivo ya se borró." : "Enlace vencido: el archivo ya se borró.") + "</span>");
        }
        var resumen = [], solo = [];
        (v.detalle.empresas || []).forEach(function (d) { (d.solo_de || []).forEach(function (n) { if (solo.indexOf(n) === -1) solo.push(n); }); });
        // 21-nov-2026 (hallazgo 7 de Fable): lo armado desde hoy dice cada lado («Recibidas: solo de ACME · Emitidas: todas.»)
        var porLado = { proveedores: null, clientes: null }, ladosH = [];
        (v.detalle.empresas || []).forEach(function (d) {
            Object.keys(d.solo_lados || {}).forEach(function (k) {
                var l = k === "Recibidas" ? "proveedores" : "clientes", n = d.solo_lados[k];
                if (ladosH.indexOf(l) === -1) ladosH.push(l);
                if (n) { porLado[l] = porLado[l] || []; n.forEach(function (x) { if (porLado[l].indexOf(x) === -1) porLado[l].push(x); }); }
            });
        });
        var soloTxt = ladosH.length ? textoSolo(["proveedores", "clientes"].filter(function (l) { return ladosH.indexOf(l) !== -1; }), porLado)
            : solo.length ? "Solo de: " + solo.slice(0, 5).join(", ") + (solo.length > 5 ? " y " + (solo.length - 5) + " más" : "") + "." : "";
        if (conAlgo.length) resumen.push(plural(conAlgo.length, "empresa", "empresas"));
        if (v.comprobantes) resumen.push(plural(v.comprobantes, "comprobante", "comprobantes"));
        var lista = !verificadas.length ? "" : porRevisar
            ? '<span class="ui-estado ui-estado--aviso">' + (porRevisar === verificadas.length && porRevisar > 1 ? "Ninguna" : porRevisar + " de " + verificadas.length) +
              (porRevisar === verificadas.length && porRevisar > 1 ? " con su lista del SAT completa" : " con algo por revisar en su lista del SAT") + "</span>"
            : '<span class="ui-estado ui-estado--ok">Todo verificado contra el SAT</span>';
        return '<article class="ev-hecho"><header><b>' + esc(cuando(v.momento, true)) + '</b><span class="ui-estado ui-estado--' + est[1] + '">' + esc(est[0]) + "</span></header>" +
            (v.error ? '<p class="ev-hecho__error">' + esc(v.error) + "</p>" : "") +
            (v.detalle && v.detalle.retomado && v.estado !== "error" ? '<small class="ev-hecho__retomado">Se retomó solo después de un reinicio del servidor.</small>' : "") +
            (v.detalle && v.detalle.cuenta_como ? '<small class="ev-hecho__retomado">' + esc("Contó como el envío automático del " + fechaLarga(v.detalle.cuenta_como) + ": ese día ya no salió solo.") + "</small>" : "") +
            (v.verificado_texto && v.estado !== "error" ? '<small class="ev-hecho__verificado' + (v.detalle.verificado && v.detalle.verificado.validar === false ? " ev-hecho__verificado--sin" : "") + '">' + esc(v.verificado_texto) + "</small>" : "") +
            (resumen.length || lista ? '<p class="ev-hecho__resumen">' + (resumen.length ? "<b>" + esc(resumen.join(" · ")) + "</b>" : "") + lista + "</p>" : "") +
            (soloTxt ? '<small class="ev-hecho__solo">' + esc(soloTxt) + "</small>" : "") +
            '<div class="ev-hecho__pie"><span>A ' + esc((v.para || []).join(", ")) + " · " + esc(v.quien === "programado" ? "automático" : "lo pidió " + v.quien) + "</span>" + pie + "</div>" +
            (lineas ? '<details class="ev-hecho__det"><summary>Detalle por empresa</summary><ul>' + lineas + "</ul></details>" : "") + "</article>";
    }
    async function cargarHistorial() {
        var e = E.histDe, cuerpo = $("ev-hist-cuerpo");
        try {
            var r = await api("/api/entregas/" + encodeURIComponent(e.id) + "/historial");
            cuerpo.innerHTML = (r.en_curso ? '<p class="ev-ultimo ev-ultimo--avance" id="ev-hist-avance">' + esc(textoAvance(r.avance)) + "</p>" : "") +
                (r.envios.length ? '<div class="ev-hist">' + r.envios.map(hecho).join("") + "</div>"
                : '<div class="ui-vacio"><b>Todavía no se ha mandado</b><span>Pruébalo con «Enviar ahora» o espera al ' + esc(cuando(e.proxima)) + ".</span></div>");
            clearTimeout(E.relojHist);
            if ((r.en_curso || r.envios.some(function (v) { return v.estado === "armando"; })) && $("ev-hist").open) E.relojHist = setTimeout(cargarHistorial, 3000);
            else if (E.esperando) { E.esperando = false; cargar().catch(function () { /* nada */ }); }
        } catch (err) {
            cuerpo.innerHTML = '<div class="ui-falla"><b>No se pudo cargar el historial</b><span>' + esc(err.message) + "</span></div>";
        }
    }
    function abrirHistorial(e) {
        E.histDe = e;
        $("ev-hist-titulo").textContent = "Historial · Envío " + e.numero + " · " + e.nombre;
        $("ev-hist-sub").textContent = e.cada + " · " + plural(e.empresas.length, "empresa", "empresas");
        $("ev-hist-cuerpo").innerHTML = '<p class="ui-ayuda">Cargando…</p>';
        if (!$("ev-hist").open) $("ev-hist").showModal();
        cargarHistorial();
    }

    /* ============================================================ arranque */
    function deTarjeta(el) { var a = el.closest("[data-id]"); return a ? E.envios.find(function (e) { return e.id === a.dataset.id; }) : null; }
    function fallo(e) { Fiscontable.toast(e.message); }
    function cuerpoDe(e, cambios) {      // un envío tal como está, listo para volver a guardarlo con algún cambio
        return Object.assign({}, e, { para: e.para.join(", "), cc: (e.cc || []).join(", ") }, cambios);
    }

    async function iniciar() {
        if (!(await Fiscontable.exigirModulo("envios"))) return;
        E.correos.para = pastillas($("ev-para")); E.correos.cc = pastillas($("ev-cc"));
        try {
            E.op = await api("/api/entregas/opciones");
            await cargar();
        } catch (e) {
            $("ev-aviso").textContent = e.message; $("ev-aviso").hidden = false;
            return;
        }
        // Un envío nuevo arranca con la configuración del último que se hizo (el dueño: «una vez lo configuro y ya está para todo»)
        function nuevo() { var ps = programados(); abrirForm(null, ps.length ? ps[ps.length - 1] : E.envios[E.envios.length - 1] || null, false); }
        $("ev-nuevo").addEventListener("click", nuevo);
        async function enTarjeta(ev) {          // los botones de cada envío (los programados y los «Enviados una vez»)
            var b = ev.target.closest("[data-accion]"); if (!b || b.type === "checkbox") return;
            var accion = b.dataset.accion, e = deTarjeta(b);
            if (accion === "nuevo") return nuevo();
            if (!e) return;
            if (accion === "editar") return abrirForm(e);
            if (accion === "duplicar") return abrirForm(null, e, true);
            if (accion === "historial") return abrirHistorial(e);
            if (accion === "enviar") return abrirAhora(e);
            if (accion === "borrar") {          // 21-nov-2026: un «Enviado una vez» se borra con su historial
                var ok_ = await Fiscontable.confirmar({ titulo: "¿Borrar «" + e.nombre + "»?", si: "Borrar", peligro: true,
                    texto: "Se borran su historial y el archivo que siga en el servidor: el enlace que ya mandaste deja de servir." });
                if (!ok_) return;
                try { await mandar("/api/entregas/" + encodeURIComponent(e.id), "DELETE"); await cargar(); Fiscontable.toast("Borrado."); } catch (err) { fallo(err); }
                return;
            }
            if (accion === "decidir") {
                var sale = b.dataset.decision === "mandar";   // 20-nov-2026: se llamaba «mandar» y tapaba la función mandar() («mandar is not a function»)
                if (sale && !(await Fiscontable.preguntar("¿Mandarlo así? Sale con lo que hay. El cliente recibe la versión limpia; la causa de lo que falta queda solo para ti."))) return;
                b.disabled = true;
                try {
                    var r = await mandar("/api/entregas/" + encodeURIComponent(e.id) + "/decidir", "POST", { accion: b.dataset.decision });
                    Fiscontable.toast(r.accion === "mandar" ? "Se está mandando." : r.accion === "no_mandar" ? "No se mandó." : "Va a esperar otras 24 horas.");
                    await cargar();
                } catch (err) { Fiscontable.avisar ? Fiscontable.avisar(err.message) : alert(err.message); b.disabled = false; }
            }
        }
        $("ev-lista").addEventListener("click", enTarjeta);
        $("ev-unavez-lista").addEventListener("click", enTarjeta);
        $("ev-ahora").addEventListener("click", function (ev) { if (ev.target.closest('[data-ev="cerrar-ahora"]')) $("ev-ahora").close(); });
        $("ev-ahora").addEventListener("change", function (ev) {
            if (ev.target.name === "ev-ahora-periodo") $("ev-ahora-mes-caja").hidden = ev.target.value !== "otro";
            if (ev.target.name === "ev-ahora-periodo" || ev.target.id === "ev-ahora-desde" || ev.target.id === "ev-ahora-hasta") verCorte();
            if (ev.target.name === "ev-ahora-periodo" || ev.target.id === "ev-ahora-desde" || ev.target.id === "ev-ahora-hasta" || ev.target.name === "ev-ahora-corte") calcularAhora();
        });
        $("ev-ahora-si").addEventListener("click", function () { mandarAhora(true); });
        $("ev-ahora-ya").addEventListener("click", function () { mandarAhora(false); });
        $("ev-lista").addEventListener("change", async function (ev) {
            var i = ev.target.closest('[data-accion="activar"]'); if (!i) return;
            var e = deTarjeta(i); if (!e) return;
            try {
                var r = await mandar("/api/entregas/" + encodeURIComponent(e.id), "PUT", cuerpoDe(e, { activa: i.checked })); await cargar();
                // 22-nov-2026 (auditoría envios_correos-7): al prenderlo, su fecha vieja no cuenta: sale en la siguiente que le toca
                Fiscontable.toast(r.activa && r.proxima ? "Encendido. El próximo sale el " + fechaLarga(String(r.proxima).slice(0, 10)) + " a las " + E.hora + ":00." : "Apagado: no sale solo.");
            }
            catch (err) { i.checked = !i.checked; fallo(err); }
        });
        // casillas por empresa
        $("ev-matriz-buscar").addEventListener("input", pintarMatriz);
        $("ev-matriz").addEventListener("change", function (ev) {
            var c = ev.target;
            if (c.dataset.envio) return asignar(c.dataset.envio, [c.dataset.rfc], c.checked, c);
            if (c.dataset.todas) return asignar(c.dataset.todas, visibles().map(function (x) { return x.rfc; }), c.checked, c);
        });
        // formulario
        $("ev-frecuencia").addEventListener("change", pintarDias);
        $("ev-dia").addEventListener("change", pintarPeriodo);
        document.querySelectorAll('input[name="ev-destino"]').forEach(function (r) { r.addEventListener("change", pintarDestino); });
        $("ev-usuarios").addEventListener("change", function (ev) { E.correos.cc.alternar(ev.target.value, ev.target.checked); });
        $("ev-cc").addEventListener("cambio", pintarUsuarios);
        document.querySelectorAll('input[name="ev-modo"]').forEach(function (r) { r.addEventListener("change", pintarPeriodo); });
        $("ev-cierre").addEventListener("change", pintarPeriodo);
        ["ev-una-desde", "ev-una-hasta"].forEach(function (id) { $(id).addEventListener("change", pintarPeriodo); });
        // «Solo de estos proveedores / clientes» (21-nov-2026)
        $("ev-solo").addEventListener("change", function () { $("ev-solo-panel").hidden = !$("ev-solo").checked; if ($("ev-solo").checked) cargarSolo(); });
        ["ev-xml", "ev-excel"].forEach(function (id) { $(id).addEventListener("change", pintarSoloResumen); });
        $("ev-solo-buscar").addEventListener("input", pintarSolo);
        $("ev-solo-lista").addEventListener("change", function (ev) {
            var i = ev.target; if (!i.value) return;
            if (i.checked) E.solo[E.soloLado].add(i.value); else E.solo[E.soloLado].delete(i.value);
            var op = i.closest('[role="option"]'); if (op) op.setAttribute("aria-selected", String(i.checked));
            ["proveedores", "clientes"].forEach(function (l) { $("ev-solo-n-" + l).textContent = E.solo[l].size ? "(" + E.solo[l].size + ")" : ""; });
            pintarSoloElegidos();          // sin volver a pintar la lista: no se pierde dónde ibas
        });
        $("ev-emp-buscar").addEventListener("input", pintarEmpresas);
        $("ev-empresas").addEventListener("change", function (ev) {
            if (ev.target.checked) E.marcadas.add(ev.target.value); else E.marcadas.delete(ev.target.value);
            var op = ev.target.closest('[role="option"]'); if (op) op.setAttribute("aria-selected", String(ev.target.checked));
            pintarElegidas();
        });
        $("ev-combo-boton").addEventListener("click", function () { abrirCombo($("ev-combo-panel").hidden); });
        $("ev-dlg").addEventListener("keydown", function (ev) {          // Esc con la lista abierta cierra la lista, no el formulario
            if (ev.key === "Escape" && !$("ev-combo-panel").hidden) { ev.preventDefault(); abrirCombo(false); $("ev-combo-boton").focus(); }
        });
        $("ev-dlg").addEventListener("cancel", function (ev) { if (!$("ev-combo-panel").hidden) ev.preventDefault(); });
        $("ev-dlg").addEventListener("click", function (ev) {
            var q = ev.target.closest("[data-quitar-empresa]");
            if (q) { E.marcadas.delete(q.dataset.quitarEmpresa); return pintarEmpresas(); }
            var qs = ev.target.closest("[data-quitar-solo]");
            if (qs) { var par = qs.dataset.quitarSolo.split("|"); E.solo[par[0]].delete(par[1]); return pintarSolo(); }
            var ld = ev.target.closest("[data-solo-lado]");
            if (ld) { E.soloLado = ld.dataset.soloLado; return pintarSolo(); }
            var ir = ev.target.closest("[data-ir]");
            if (ir) return irA(Number(ir.dataset.ir));
            var pl = ev.target.closest("[data-plantilla]");
            if (pl) {
                var x = E.op.plantillas.find(function (y) { return y.clave === pl.dataset.plantilla; });
                $("ev-asunto").value = x.asunto; $("ev-mensaje").value = x.mensaje; return pintarVista();
            }
            var pa = ev.target.closest("[data-palabra]");
            if (pa) {          // la palabra entra donde está el cursor del último campo que se tocó ({detalle} solo en el mensaje)
                var campo = pa.dataset.palabra === "detalle" ? $("ev-mensaje") : (E.campoTexto || $("ev-mensaje")), t = "{" + pa.dataset.palabra + "}";
                var ini = campo.selectionStart == null ? campo.value.length : campo.selectionStart, fin = campo.selectionEnd == null ? ini : campo.selectionEnd;
                campo.value = campo.value.slice(0, ini) + t + campo.value.slice(fin);
                campo.focus(); campo.setSelectionRange(ini + t.length, ini + t.length);
                return pintarVista();
            }
            var b = ev.target.closest("[data-ev]"); if (!b) return;
            if (b.dataset.ev === "cerrar") return $("ev-dlg").close();
            if (b.dataset.ev === "atras") return irA(E.paso - 1);
            if (b.dataset.ev === "siguiente") return irA(E.paso + 1);
            if (b.dataset.ev === "combo-listo") { abrirCombo(false); return $("ev-combo-boton").focus(); }
            if (b.dataset.ev === "todas") { $("ev-empresas").querySelectorAll("input").forEach(function (i) { E.marcadas.add(i.value); }); pintarEmpresas(); }
            if (b.dataset.ev === "ninguna") { E.marcadas.clear(); pintarEmpresas(); }
        });
        $("ev-adjuntar").addEventListener("change", pintarVista);
        document.querySelectorAll('input[name="ev-lugar"]').forEach(function (r) { r.addEventListener("change", function () { pintarLugar(); pintarVista(); }); });
        $("ev-excel").addEventListener("change", pintarConc);
        ["ev-xml", "ev-excel", "ev-docs"].forEach(function (id) { $(id).addEventListener("change", pintarCorteLleva); });
        $("ev-conc").addEventListener("change", function () {
            var j = E.op.conciliacion.juegos[$("ev-conc").value];
            if (j) E.hojasConc = new Set(j);
            pintarConc();
        });
        $("ev-conc-hojas").addEventListener("change", function (ev) {
            if (ev.target.checked) E.hojasConc.add(ev.target.value); else E.hojasConc.delete(ev.target.value);
        });
        ["ev-asunto", "ev-mensaje"].forEach(function (id) {
            $(id).addEventListener("focus", function () { E.campoTexto = $(id); });
            $(id).addEventListener("input", pintarVista);
        });
        $("ev-form").addEventListener("submit", function (ev) { ev.preventDefault(); });      // Enter en un campo de correos agrega la pastilla, no guarda
        $("ev-guardar").addEventListener("click", guardar);
        $("ev-borrar").addEventListener("click", async function () {
            var e = E.editando; if (!e) return;
            var si = await Fiscontable.confirmar({ titulo: "¿Borrar el Envío " + e.numero + "?", si: "Borrar", peligro: true,
                texto: "Deja de mandarse y se borran su historial y los archivos que sigan en el servidor: los enlaces que ya mandaste dejan de servir." });
            if (!si) return;
            try { await mandar("/api/entregas/" + encodeURIComponent(e.id), "DELETE"); $("ev-dlg").close(); await cargar(); Fiscontable.toast("Envío borrado."); }
            catch (err) { fallo(err); }
        });
        // historial
        $("ev-hist").addEventListener("click", async function (ev) {
            if (ev.target.closest('[data-ev="cerrar-hist"]')) { clearTimeout(E.relojHist); return $("ev-hist").close(); }
            var c = ev.target.closest("[data-copiar]");
            if (c) {
                try { await navigator.clipboard.writeText(c.dataset.copiar); Fiscontable.toast("Enlace copiado."); } catch (x) { window.prompt("Copia el enlace:", c.dataset.copiar); }
                return;
            }
            var r = ev.target.closest("[data-revocar]");
            if (r) {
                var si = await Fiscontable.confirmar({ titulo: "¿Revocar el enlace?", si: "Revocar", peligro: true, texto: "Deja de servir en este momento y el archivo se borra del servidor. Lo que ya se bajó o llegó adjunto no cambia." });
                if (!si) return;
                try { await mandar("/api/entregas/hechos/" + encodeURIComponent(r.dataset.revocar) + "/revocar", "POST"); await cargarHistorial(); }
                catch (err) { fallo(err); }
            }
        });
    }
    document.addEventListener("DOMContentLoaded", iniciar);
})();
