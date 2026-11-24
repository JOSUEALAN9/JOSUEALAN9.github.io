/**
 * probar.js — «Probar todo» (24-nov-2026, el dueño; solo el administrador). Elige empresas (la tuya viene marcada) y
 * pruebas, pulsa «Probar ahora» y ve el avance de cada una en vivo; al final, ✔ / ✘ / no aplica / pendiente del SAT con su
 * motivo y lo que tardó, el historial y «Descargar reporte» (Registro de auditoría enmascarado + resultados.json).
 * Todo lo que decide vive en el servidor (modulos/probar): aquí solo se pide y se muestra.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var E = { datos: null, corrida: null, reloj: null, marcadas: null };
    var ICONO = { ok: "✔", falla: "✘", no_aplica: "–", pendiente: "⏳", corriendo: "↻", espera: "·", detenida: "–" };
    var TEXTO = { ok: "Bien", falla: "Falló", no_aplica: "No aplica", pendiente: "Pendiente del SAT", corriendo: "Probando…", espera: "En espera", detenida: "No se probó" };
    var ESTADO = { en_curso: ["aviso", "En curso"], terminada: ["ok", "Terminada"], detenida: ["aviso", "Detenida"], interrumpida: ["error", "Interrumpida"], error: ["error", "Con error"] };

    async function api(ruta, opciones) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function json(metodo, cuerpo) { return { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }; }
    function fecha(iso) { return iso ? new Date(iso + "Z").toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; }
    function seg(s) { if (s == null) return ""; return s >= 60 ? Math.floor(s / 60) + " min " + Math.round(s % 60) + " s" : (s < 10 ? s.toFixed(1) : Math.round(s)) + " s"; }
    function nombrePrueba(clave) { return (E.datos.pruebas.find(function (p) { return p.clave === clave; }) || {}).nombre || clave; }

    // ------------------------------------------------------------------ formulario
    function pintarEmpresas() {
        var d = E.datos, mia = d.ajustes.mia, filtro = ($("pt-buscar").value || "").trim().toLowerCase();
        if (!E.marcadas) E.marcadas = new Set(mia ? [mia] : []);
        $("pt-buscar").hidden = d.empresas.length < 8;
        // la mía primero; después como vienen (por nombre)
        var lista = d.empresas.slice().sort(function (x, y) { return (y.clave === mia) - (x.clave === mia); }).filter(function (e) { return !filtro || (e.alias + " " + e.rfc).toLowerCase().indexOf(filtro) >= 0; });
        $("pt-empresas").innerHTML = lista.length ? lista.map(function (e) {
            var esMia = e.clave === mia;
            return '<label class="pt-emp' + (e.efirma ? "" : " pt-emp--sin") + '"><input type="checkbox" value="' + esc(e.clave) + '"' + (E.marcadas.has(e.clave) ? " checked" : "") + ">" +
                "<b>" + esc(e.alias) + "</b>" +
                '<button type="button" class="pt-mia" data-mia="' + esc(e.clave) + '" aria-pressed="' + esMia + '" title="' + (esMia ? "Tu empresa: siempre viene marcada" : "Marcar como la mía") + '">' + (esMia ? "★ La mía" : "☆ La mía") + "</button>" +
                "<small>" + esc(e.rfc) + (d.empresas.some(function (x) { return x.owner !== e.owner; }) ? " · " + esc(e.cuenta) : "") + (e.efirma ? "" : " · sin e.firma") + "</small></label>";
        }).join("") : '<div class="ui-vacio" style="padding:var(--e-6) var(--e-4)"><b>' + (d.empresas.length ? "Ninguna coincide" : "No tienes empresas") + "</b><span>" +
            (d.empresas.length ? "Prueba con otra búsqueda." : "Registra tus empresas con su e.firma en Clientes.") + "</span></div>";
        contar();
    }
    function contar() {
        $("pt-emp-cuenta").textContent = E.marcadas.size ? "· " + E.marcadas.size + " marcada" + (E.marcadas.size === 1 ? "" : "s") : "";
    }
    function pintarPruebas() {
        $("pt-pruebas").innerHTML = E.datos.pruebas.map(function (p) {
            return '<label class="pt-prueba" title="' + esc(p.texto) + '"><input type="checkbox" name="pt-prueba" value="' + esc(p.clave) + '" checked><span>' + esc(p.nombre) + "</span></label>";
        }).join("");
        $("pt-ay-pruebas").innerHTML = E.datos.pruebas.map(function (p) { return "<li><b>" + esc(p.nombre) + ".</b> " + esc(p.texto) + "</li>"; }).join("");
    }
    function pruebasMarcadas() { return [].map.call(document.querySelectorAll('input[name="pt-prueba"]:checked'), function (x) { return x.value; }); }
    function pintarAvisos() {
        var d = E.datos, avisos = (d.avisos || []).slice();
        if (d.madrugada) avisos.unshift("Ahora corre la madrugada: «Probar ahora» se puede cuando termine.");
        $("pt-avisos").innerHTML = avisos.map(function (a) { return '<p class="pt-aviso">' + esc(a) + "</p>"; }).join("");
        $("pt-servidor").className = "ui-estado ui-estado--" + (d.servidor === "pruebas" ? "info" : "aviso");
        $("pt-servidor").textContent = d.servidor === "pruebas" ? "Servidor de pruebas" : "Producción";
    }
    function pintarSemanal() {
        var s = E.datos.ajustes.semanal, dias = E.datos.dias;
        $("pt-sem-dia").innerHTML = dias.map(function (n, i) { return '<option value="' + i + '"' + (i === s.dia ? " selected" : "") + ">" + n.charAt(0).toUpperCase() + n.slice(1) + "</option>"; }).join("");
        var h = ""; for (var i = 0; i < 24; i++) h += '<option value="' + i + '"' + (i === s.hora ? " selected" : "") + ">" + i + ":00</option>";
        $("pt-sem-hora").innerHTML = h;
        $("pt-sem-activo").checked = !!s.activo;
        $("pt-sem-resumen").textContent = s.activo ? "Cada " + dias[s.dia] + " a las " + s.hora + ":00" : "Apagado";
        $("pt-sem-estado").textContent = s.activo
            ? "Encendido: cada " + dias[s.dia] + " a las " + s.hora + ":00 · " + (s.empresas.length || (E.datos.ajustes.mia ? 1 : 0)) + " empresa(s) · " + (s.pruebas.length || E.datos.pruebas.length) + " prueba(s)."
            : "Apagado.";
        // revisión 24-nov-2026: en el servidor de pruebas no corre lo automático; se dice aquí (no arriba: la pantalla cabe en el celular)
        if (E.datos.automatico === false) $("pt-sem-estado").textContent += " En este servidor no corre lo automático: «Cada semana» solo corre en producción.";
    }

    // ------------------------------------------------------------------ la corrida
    function cuenta(pruebas) {
        var c = {}; Object.keys(pruebas || {}).forEach(function (k) { var e = pruebas[k].estado || "espera"; c[e] = (c[e] || 0) + 1; }); return c;
    }
    function chips(c, todas) {
        var orden = ["ok", "falla", "pendiente", "no_aplica", "corriendo", "espera", "detenida"];
        return '<span class="pt-chips">' + orden.filter(function (k) { return c[k] && (todas || k !== "espera"); }).map(function (k) {
            return '<span class="pt-chip pt-chip--' + k + '" title="' + esc(TEXTO[k]) + '">' + ICONO[k] + " " + c[k] + "</span>";
        }).join("") + "</span>";
    }
    function pintarCorrida() {
        var c = E.corrida, caja = $("pt-corrida");
        if (!c) return;
        var total = 0, hechas = 0, todo = {};
        Object.keys(c.resultados).forEach(function (k) {
            var p = c.resultados[k].pruebas || {};
            Object.keys(p).forEach(function (x) { total++; if (["espera", "corriendo"].indexOf(p[x].estado) < 0) hechas++; todo[p[x].estado] = (todo[p[x].estado] || 0) + 1; });
        });
        var s = ESTADO[c.estado] || ["", c.estado], vivo = c.estado === "en_curso";
        var html = '<div class="pt-cab"><h2>Corrida del ' + esc(fecha(c.creada)) + "</h2>" + '<span class="ui-estado ui-estado--' + s[0] + '">' + esc(s[1]) + "</span></div>" +
            '<p class="pt-sub">' + (c.origen === "semanal" ? "La de cada semana · " : "") + Object.keys(c.resultados).filter(function (k) { return k !== "general"; }).length + " empresa(s) · " +
            c.pruebas.length + " prueba(s)" + (c.terminada ? " · terminó a las " + esc(new Date(c.terminada + "Z").toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })) : "") + "</p>" +
            '<div class="pt-barra" role="progressbar" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + hechas + '"><span style="width:' + (total ? Math.round(100 * hechas / total) : 0) + '%"></span></div>' +
            '<div class="pt-cuenta"><span><b>' + hechas + "</b> de " + total + " pruebas</span>" + chips(todo) +
            '<span class="pt-acciones" style="margin-left:auto">' + (vivo ? '<button type="button" class="ui-btn ui-btn--peligro ui-btn--28" data-hacer="detener">Detener</button>'
                : '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-hacer="reporte">Descargar reporte</button>') + "</span></div>";
        Object.keys(c.resultados).forEach(function (k, i) {
            var e = c.resultados[k], p = e.pruebas || {}, n = cuenta(p);
            var abierto = vivo ? Object.keys(p).some(function (x) { return p[x].estado === "corriendo"; }) || (i === 0 && !hechas) : !!(n.falla || n.pendiente) || i === 0;
            html += '<details class="pt-bloque" data-bloque="' + esc(k) + '"' + (abierto ? " open" : "") + "><summary><b>" + esc(e.alias) + "</b>" + chips(n, true) +
                "<small>" + esc(e.rfc ? e.rfc + (e.cuenta && e.cuenta !== "Tu cuenta" ? " · " + e.cuenta : "") : "Lo que no es de una empresa") + "</small></summary>" +
                Object.keys(p).map(function (x) {
                    var r = p[x], est = r.estado || "espera";
                    return '<div class="pt-fila pt-fila--' + est + '" data-prueba="' + esc(x) + '" data-estado="' + esc(est) + '"><i aria-hidden="true">' + ICONO[est] + "</i><b>" + esc(nombrePrueba(x)) +
                        '<span class="sr-only"> · ' + esc(TEXTO[est]) + "</span></b><em>" + (r.segundos != null ? esc(seg(r.segundos)) : esc(TEXTO[est])) + "</em>" +
                        (r.motivo ? "<p>" + esc(r.motivo) + "</p>" : "") + "</div>";
                }).join("") + "</details>";
        });
        // los bloques que la persona abrió o cerró a mano se quedan así mientras se actualiza
        var antes = {}; [].forEach.call(caja.querySelectorAll("details[data-bloque]"), function (d) { antes[d.dataset.bloque] = d.open; });
        caja.innerHTML = html;
        if (E.mismo) [].forEach.call(caja.querySelectorAll("details[data-bloque]"), function (d) { if (d.dataset.bloque in antes) d.open = antes[d.dataset.bloque]; });
        $("pt-lanzar").disabled = vivo || !!(E.datos && E.datos.madrugada);
        $("pt-lanzar").textContent = vivo ? "Probando…" : "Probar ahora";
    }
    function vista(cual) {
        [].forEach.call(document.querySelectorAll("#pt-vista [data-vista]"), function (b) { b.setAttribute("aria-selected", String(b.dataset.vista === cual)); });
        [].forEach.call(document.querySelectorAll("[data-panel]"), function (p) { p.hidden = p.dataset.panel !== cual; });
    }
    function pintarHistorial() {
        var h = E.datos.corridas || [];
        $("pt-hist-n").textContent = h.length ? String(h.length) : "";
        $("pt-hist").innerHTML = h.length ? h.map(function (c) {
            var s = ESTADO[c.estado] || ["", c.estado];
            return '<button type="button" class="pt-hfila" data-corrida="' + esc(c.id) + '"' + (E.corrida && E.corrida.id === c.id ? ' aria-current="true"' : "") + "><b>" + esc(fecha(c.creada)) +
                (c.origen === "semanal" ? " · semanal" : "") + "</b>" + (c.resumen ? chips(c.resumen) : '<span class="pt-chips"><span class="ui-estado ui-estado--' + s[0] + '">' + esc(s[1]) + "</span></span>") +
                "<small>" + c.empresas + " empresa(s) · " + c.pruebas + " prueba(s) · " + esc(s[1]) + "</small></button>";
        }).join("") : '<p class="pt-sub">Aquí quedan las últimas corridas, con su resultado.</p>';
    }
    async function abrir(cid, mismo) {
        try { E.corrida = await api("/api/admin/probar/" + cid); } catch (e) { Fiscontable.toast(e.message); return; }
        E.mismo = !!mismo;
        pintarCorrida();
        pintarHistorial();
        clearTimeout(E.reloj);
        if (E.corrida.estado === "en_curso") E.reloj = setTimeout(function () { abrir(cid, true); }, 2000);
        else if (mismo) cargar(true);
    }
    async function cargar(soloLista) {
        try { E.datos = await api("/api/admin/probar"); }
        catch (e) { $("pt").hidden = true; $("pt-aviso").hidden = false; $("pt-aviso").innerHTML = "<b>No se pudo abrir «Probar todo»</b><span>" + esc(e.message) + "</span>"; return; }
        $("pt").hidden = false;
        if (!soloLista) {
            pintarEmpresas(); pintarPruebas(); pintarSemanal();
            var pedida = new URLSearchParams(location.search).get("corrida");
            var cual = E.datos.en_curso || pedida || (E.datos.corridas[0] || {}).id;
            if (cual) abrir(cual);
        }
        pintarAvisos();
        pintarHistorial();
        $("pt-lanzar").disabled = !!E.datos.en_curso || !!E.datos.madrugada;
    }

    // ------------------------------------------------------------------ acciones
    $("pt-buscar").addEventListener("input", pintarEmpresas);
    $("pt-empresas").addEventListener("change", function (ev) {
        var x = ev.target; if (!x.matches('input[type="checkbox"]')) return;
        if (x.checked) E.marcadas.add(x.value); else E.marcadas.delete(x.value);
        contar();
    });
    $("pt-empresas").addEventListener("click", async function (ev) {
        var b = ev.target.closest("[data-mia]"); if (!b) return;
        ev.preventDefault();
        var nueva = E.datos.ajustes.mia === b.dataset.mia ? "" : b.dataset.mia;
        b.disabled = true;
        try {
            var a = await api("/api/admin/probar/ajustes", json("PUT", { mia: nueva }));
            E.datos.ajustes = a;
            if (nueva) E.marcadas.add(nueva);
            Fiscontable.toast(nueva ? "Listo: esa es tu empresa. Siempre viene marcada." : "Ya no hay una empresa marcada como la tuya.");
            pintarEmpresas(); pintarSemanal();
        } catch (e) { Fiscontable.toast(e.message); b.disabled = false; }
    });
    $("pt-todas").addEventListener("click", function () {
        var cajas = document.querySelectorAll('input[name="pt-prueba"]'), alguna = [].some.call(cajas, function (x) { return x.checked; });
        [].forEach.call(cajas, function (x) { x.checked = !alguna; });
        this.textContent = alguna ? "Marcar todas" : "Quitar todas";
    });
    $("pt-pruebas").addEventListener("change", function () {
        $("pt-todas").textContent = pruebasMarcadas().length ? "Quitar todas" : "Marcar todas";
    });
    $("pt-forma").addEventListener("submit", async function (ev) {
        ev.preventDefault();
        var empresas = Array.from(E.marcadas), pruebas = pruebasMarcadas(), boton = $("pt-lanzar");
        if (!pruebas.length) { Fiscontable.toast("Marca al menos una prueba."); return; }
        var deEmpresa = pruebas.some(function (p) { return (E.datos.pruebas.find(function (x) { return x.clave === p; }) || {}).de_empresa; });
        if (deEmpresa && !empresas.length) { Fiscontable.toast("Elige al menos una empresa."); return; }
        var sat = pruebas.filter(function (p) { return ["xml_ws", "xml_portal", "constancia", "opinion", "buzon", "declaraciones", "diot"].indexOf(p) >= 0; }).length;
        if (!(await Fiscontable.confirmar({ titulo: "¿Probar ahora?", si: "Probar ahora",
            texto: (deEmpresa ? empresas.length + " empresa(s) y " : "") + pruebas.length + " prueba(s)." + (sat ? " Se entra al SAT con la e.firma de cada empresa, como cuando pides un trámite; puede tardar unos minutos por empresa." : "") +
                " No tiene efecto fiscal y no le llega nada a ningún cliente." }))) return;
        boton.disabled = true;
        try {
            var r = await api("/api/admin/probar", json("POST", { empresas: empresas, pruebas: pruebas }));
            await cargar(true);
            vista("corrida");
            abrir(r.id);
        } catch (e) { Fiscontable.toast(e.message); boton.disabled = false; }
    });
    $("pt-sem-guardar").addEventListener("click", async function () {
        var b = this, activo = $("pt-sem-activo").checked;
        b.disabled = true;
        try {
            E.datos.ajustes = await api("/api/admin/probar/ajustes", json("PUT", { semanal: { activo: activo, dia: +$("pt-sem-dia").value, hora: +$("pt-sem-hora").value,
                empresas: Array.from(E.marcadas), pruebas: pruebasMarcadas() } }));
            pintarSemanal();
            Fiscontable.toast(activo ? "Listo: correrá cada " + E.datos.dias[E.datos.ajustes.semanal.dia] + " a las " + E.datos.ajustes.semanal.hora + ":00." : "Listo: ya no corre cada semana.");
        } catch (e) { Fiscontable.toast(e.message); }
        b.disabled = false;
    });
    $("pt-hist").addEventListener("click", function (ev) {
        var b = ev.target.closest("[data-corrida]"); if (b) { vista("corrida"); abrir(b.dataset.corrida); }
    });
    $("pt-vista").addEventListener("click", function (ev) {
        var b = ev.target.closest("[data-vista]"); if (b) vista(b.dataset.vista);
    });
    $("pt-corrida").addEventListener("click", async function (ev) {
        var motivo = ev.target.closest(".pt-fila p"); if (motivo) motivo.classList.toggle("pt-completo");
        var h = ev.target.closest("[data-hacer]"); if (!h || !E.corrida) return;
        var c = E.corrida;
        try {
            if (h.dataset.hacer === "detener") {
                if (!(await Fiscontable.confirmar({ titulo: "¿Detener la corrida?", texto: "Termina la prueba que va y no sigue con las demás.", si: "Detener", peligro: true }))) return;
                h.disabled = true;
                await api("/api/admin/probar/" + c.id + "/detener", { method: "POST" });
                Fiscontable.toast("Se detiene en cuanto termine la prueba que va.");
            } else if (h.dataset.hacer === "reporte") {
                h.disabled = true;
                var r = await fetch(API + "/api/admin/probar/" + c.id + "/reporte", { credentials: "include" });
                if (!r.ok) throw new Error(await Fiscontable.leerError(r));
                var nombre = ((r.headers.get("content-disposition") || "").match(/filename="([^"]+)"/) || [])[1] || "probar_todo.zip";
                Fiscontable.guardarArchivo(await r.blob(), nombre);
                h.disabled = false;
            }
        } catch (e) { Fiscontable.toast(e.message); h.disabled = false; }
    });
    document.addEventListener("click", function (ev) {
        if (ev.target.closest("[data-ayuda]")) $("pt-ayuda").showModal();
        else if (ev.target.closest("[data-ayuda-cerrar]")) $("pt-ayuda").close();
    });

    (async function () {
        var p = await Fiscontable.perfil();
        if (!p || p._error || p.rol !== "admin") { $("pt-aviso").hidden = false; $("pt-aviso").innerHTML = "<b>Esta página es solo para el administrador.</b>"; return; }
        cargar();
    })();
})();
