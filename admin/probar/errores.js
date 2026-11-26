/**
 * errores.js — «Probar con errores» (25-nov-2026, el dueño; solo el administrador). Elige los grupos de escenarios (todos
 * vienen marcados), pulsa «Probar con errores» y ve el avance en vivo; al final, por escenario, qué se esperaba, qué pasó y
 * ✔ Bien / ✘ Falló / ⚠ Falló — error conocido, el historial y «Descargar reporte» (ZIP sin secretos).
 * Todo corre en el servidor, en una caja aparte (modulos/probar/errores.py y caja.py): aquí solo se pide y se muestra.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var E = { datos: null, corrida: null, reloj: null, mismo: false, fuera: new Set() };
    var ICONO = { ok: "✔", falla: "✘", conocido: "⚠", corriendo: "↻", espera: "·", detenida: "–" };
    var ESTADO = { en_curso: ["aviso", "En curso"], terminada: ["ok", "Terminada"], detenida: ["aviso", "Detenida"], interrumpida: ["error", "Interrumpida"], error: ["error", "Con error"] };

    async function api(ruta, opciones) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function json(metodo, cuerpo) { return { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }; }
    function fecha(iso) { return iso ? new Date(iso + "Z").toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; }
    function seg(s) { if (s == null) return ""; return s >= 60 ? Math.floor(s / 60) + " min " + Math.round(s % 60) + " s" : (s < 10 ? s.toFixed(1) : Math.round(s)) + " s"; }
    function texto(e) { return (E.datos && E.datos.estados && E.datos.estados[e]) || e; }
    function escenario(clave) {
        var hallado = null;
        (E.datos.catalogo.grupos || []).forEach(function (g) { g.escenarios.forEach(function (x) { if (x.clave === clave) hallado = x; }); });
        return hallado || { clave: clave, nombre: clave, espera: "", grupo: "" };
    }

    // ------------------------------------------------------------------ qué probar
    function pintarGrupos() {
        var g = E.datos.catalogo.grupos;
        $("pe-grupos").innerHTML = g.map(function (x) {
            return '<label class="pe-grupo"><input type="checkbox" value="' + esc(x.clave) + '"' + (E.fuera.has(x.clave) ? "" : " checked") + ">" +
                "<span>" + esc(x.nombre) + "</span><small>" + x.escenarios.length + " prueba" + (x.escenarios.length === 1 ? "" : "s") + "</small></label>";
        }).join("");
        $("pe-ay-grupos").innerHTML = g.map(function (x) {
            return "<li><b>" + esc(x.nombre) + ".</b> " + x.escenarios.map(function (s) { return esc(s.nombre); }).join(" · ") + ".</li>";
        }).join("");
        contar();
    }
    function elegidas() {
        var claves = [];
        E.datos.catalogo.grupos.forEach(function (g) { if (!E.fuera.has(g.clave)) g.escenarios.forEach(function (s) { claves.push(s.clave); }); });
        return claves;
    }
    function contar() {
        var n = elegidas().length;
        var todas = E.fuera.size === 0;
        $("pe-cuenta").textContent = (todas ? "Todas · " : E.datos.catalogo.grupos.length - E.fuera.size + " de " + E.datos.catalogo.grupos.length + " · ") +
            n + " de " + E.datos.catalogo.total + " pruebas";
        $("pe-todas").textContent = E.fuera.size === E.datos.catalogo.grupos.length ? "Marcar todas" : "Quitar todas";
    }
    function pintarServidor() {
        var d = E.datos;
        $("pe-servidor").className = "ui-estado ui-estado--" + (d.servidor === "pruebas" ? "info" : "aviso");
        $("pe-servidor").textContent = d.servidor === "pruebas" ? "Servidor de pruebas" : "Producción";
    }

    // ------------------------------------------------------------------ la corrida
    function cuenta(lista) {
        var c = {}; lista.forEach(function (x) { var e = x.estado || "espera"; c[e] = (c[e] || 0) + 1; }); return c;
    }
    function chips(c, todas) {
        var orden = ["ok", "falla", "conocido", "corriendo", "espera", "detenida"];
        return '<span class="pt-chips">' + orden.filter(function (k) { return c[k] && (todas || k !== "espera"); }).map(function (k) {
            return '<span class="pt-chip pt-chip--' + k + '" title="' + esc(texto(k)) + '">' + ICONO[k] + " " + c[k] + "</span>";
        }).join("") + "</span>";
    }
    function fila(clave, r) {
        var s = escenario(clave), est = r.estado || "espera";
        var html = '<div class="pt-fila pt-fila--' + est + '" data-escenario="' + esc(clave) + '" data-estado="' + esc(est) + '"><i aria-hidden="true">' + ICONO[est] + "</i>" +
            "<b>" + esc(s.nombre) + '<span class="sr-only"> · ' + esc(texto(est)) + "</span></b><em>" + (r.segundos != null ? esc(seg(r.segundos)) : esc(texto(est))) + "</em>" +
            "<p><b>Se esperaba:</b> " + esc(s.espera) + "</p>";
        if (r.paso) html += '<p class="pe-paso"><b>' + (est === "ok" ? "Pasó" : est === "detenida" ? "No se probó" : "Pasó") + ":</b> " + esc(r.paso) + "</p>";
        if (est === "conocido" && r.motivo) html += '<p class="pe-conocido"><b>Error conocido:</b> ' + esc(r.motivo) + "</p>";
        return html + "</div>";
    }
    function pintarCorrida() {
        var c = E.corrida, caja = $("pe-corrida");
        if (!c) return;
        var claves = Object.keys(c.escenarios || {}), total = claves.length;
        var hechas = claves.filter(function (k) { return ["espera", "corriendo"].indexOf(c.escenarios[k].estado) < 0; }).length;
        var todo = cuenta(claves.map(function (k) { return c.escenarios[k]; }));
        var s = ESTADO[c.estado] || ["", c.estado], vivo = c.estado === "en_curso", cj = c.caja || {};
        var html = '<div class="pt-cab"><h2>Corrida del ' + esc(fecha(c.creada)) + "</h2>" + '<span class="ui-estado ui-estado--' + s[0] + '">' + esc(s[1]) + "</span></div>" +
            '<p class="pt-sub">' + total + " prueba" + (total === 1 ? "" : "s") + " en la caja aparte" +
            (c.terminada ? " · terminó a las " + esc(new Date(c.terminada + "Z").toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })) : "") + "</p>" +
            '<div class="pt-barra" role="progressbar" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + hechas + '"><span style="width:' + (total ? Math.round(100 * hechas / total) : 0) + '%"></span></div>' +
            '<div class="pt-cuenta"><span><b>' + hechas + "</b> de " + total + "</span>" + chips(todo) +
            '<span class="pt-acciones" style="margin-left:auto">' + (vivo ? '<button type="button" class="ui-btn ui-btn--peligro ui-btn--28" data-hacer="detener">Detener</button>'
                : '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-hacer="reporte">Descargar reporte</button>') + "</span></div>";
        if (!vivo) {
            html += '<p class="pe-caja">' + (cj.borrada ? "<b>La caja se borró.</b> " : "<b>La caja no se pudo borrar.</b> ") +
                "Intentos de salir a internet: " + (cj.red || 0) + " (cortados) · llamadas al PAC: " + (cj.pac || 0) + " · correos simulados: " + (cj.correos || 0) + "." +
                (c.mensaje ? " " + esc(c.mensaje) : "") + "</p>";
        }
        var bloques = "";
        E.datos.catalogo.grupos.forEach(function (g) {
            var suyas = g.escenarios.map(function (x) { return x.clave; }).filter(function (k) { return k in c.escenarios; });
            if (!suyas.length) return;
            var n = cuenta(suyas.map(function (k) { return c.escenarios[k]; }));
            // abiertos: el que corre y, al final, los que fallaron; los de «error conocido» se quedan cerrados con su ⚠
            var abierto = vivo ? !!n.corriendo : !!n.falla;
            bloques += '<details class="pt-bloque" data-bloque="' + esc(g.clave) + '"' + (abierto ? " open" : "") + '><summary><span class="pe-nombre"><b>' + esc(g.nombre) + "</b>" +
                "<small>" + suyas.length + " prueba" + (suyas.length === 1 ? "" : "s") + "</small></span>" + chips(n, true) + "</summary>" +
                suyas.map(function (k) { return fila(k, c.escenarios[k]); }).join("") + "</details>";
        });
        html += '<div class="pe-lista">' + bloques + "</div>";
        // los bloques que la persona abrió o cerró a mano se quedan así mientras se actualiza
        var antes = {}; [].forEach.call(caja.querySelectorAll("details[data-bloque]"), function (d) { antes[d.dataset.bloque] = d.open; });
        caja.innerHTML = html;
        if (E.mismo) [].forEach.call(caja.querySelectorAll("details[data-bloque]"), function (d) { if (d.dataset.bloque in antes) d.open = antes[d.dataset.bloque]; });
        $("pe-lanzar").disabled = vivo;
        $("pe-lanzar").textContent = vivo ? "Probando…" : "Probar con errores";
    }
    function vista(cual) {
        [].forEach.call(document.querySelectorAll("#pe-vista [data-vista]"), function (b) { b.setAttribute("aria-selected", String(b.dataset.vista === cual)); });
        [].forEach.call(document.querySelectorAll("[data-panel]"), function (p) { p.hidden = p.dataset.panel !== cual; });
    }
    function pintarHistorial() {
        var h = E.datos.corridas || [];
        $("pe-hist-n").textContent = h.length ? String(h.length) : "";
        $("pe-hist").innerHTML = h.length ? h.map(function (c) {
            var s = ESTADO[c.estado] || ["", c.estado];
            return '<button type="button" class="pt-hfila" data-corrida="' + esc(c.id) + '"' + (E.corrida && E.corrida.id === c.id ? ' aria-current="true"' : "") + "><b>" + esc(fecha(c.creada)) + "</b>" +
                (c.resumen ? chips(c.resumen) : '<span class="pt-chips"><span class="ui-estado ui-estado--' + s[0] + '">' + esc(s[1]) + "</span></span>") +
                "<small>" + c.escenarios + " pruebas · " + esc(s[1]) + "</small></button>";
        }).join("") : '<p class="pt-sub">Aquí quedan las últimas corridas, con su resultado.</p>';
    }
    async function abrir(cid, mismo) {
        var antes = E.corrida;
        try { E.corrida = await api("/api/admin/probar-errores/" + cid); } catch (e) { Fiscontable.toast(e.message); return; }
        // al terminar, los grupos se abren según el resultado (no como estaban mientras corría)
        E.mismo = !!mismo && !(antes && antes.id === cid && antes.estado !== E.corrida.estado);
        pintarCorrida();
        pintarHistorial();
        clearTimeout(E.reloj);
        if (E.corrida.estado === "en_curso") E.reloj = setTimeout(function () { abrir(cid, true); }, 1500);
        else if (mismo) cargar(true);
    }
    async function cargar(soloLista) {
        try { E.datos = await api("/api/admin/probar-errores"); }
        catch (e) { $("pe").hidden = true; $("pe-aviso").hidden = false; $("pe-aviso").innerHTML = "<b>No se pudo abrir «Probar con errores»</b><span>" + esc(e.message) + "</span>"; return; }
        $("pe").hidden = false;
        if (!soloLista) {
            pintarGrupos(); pintarServidor();
            var pedida = new URLSearchParams(location.search).get("corrida");
            var cual = E.datos.en_curso || pedida || (E.datos.corridas[0] || {}).id;
            if (cual) abrir(cual);
        }
        pintarHistorial();
        $("pe-lanzar").disabled = !!E.datos.en_curso;
    }

    // ------------------------------------------------------------------ acciones
    $("pe-grupos").addEventListener("change", function (ev) {
        var x = ev.target; if (!x.matches('input[type="checkbox"]')) return;
        if (x.checked) E.fuera.delete(x.value); else E.fuera.add(x.value);
        contar();
    });
    $("pe-todas").addEventListener("click", function () {
        var todas = E.datos.catalogo.grupos.map(function (g) { return g.clave; });
        E.fuera = E.fuera.size === todas.length ? new Set() : new Set(todas);
        pintarGrupos();
    });
    $("pe-forma").addEventListener("submit", async function (ev) {
        ev.preventDefault();
        var claves = elegidas(), boton = $("pe-lanzar");
        if (!claves.length) { Fiscontable.toast("Marca al menos un grupo."); return; }
        if (!(await Fiscontable.confirmar({ titulo: "¿Probar con errores?", si: "Probar con errores",
            texto: claves.length + " prueba" + (claves.length === 1 ? "" : "s") + " en la caja aparte (tarda menos de un minuto). " +
                "No toca tus empresas, el SAT ni el PAC, y no sale ningún correo." }))) return;
        boton.disabled = true;
        try {
            var r = await api("/api/admin/probar-errores", json("POST", { escenarios: claves }));
            await cargar(true);
            vista("corrida");
            abrir(r.id);
        } catch (e) { Fiscontable.toast(e.message); boton.disabled = false; }
    });
    $("pe-hist").addEventListener("click", function (ev) {
        var b = ev.target.closest("[data-corrida]"); if (b) { vista("corrida"); abrir(b.dataset.corrida); }
    });
    $("pe-vista").addEventListener("click", function (ev) {
        var b = ev.target.closest("[data-vista]"); if (b) vista(b.dataset.vista);
    });
    $("pe-corrida").addEventListener("click", async function (ev) {
        var parrafo = ev.target.closest(".pt-fila p"); if (parrafo) parrafo.classList.toggle("pt-completo");
        var h = ev.target.closest("[data-hacer]"); if (!h || !E.corrida) return;
        var c = E.corrida;
        try {
            if (h.dataset.hacer === "detener") {
                if (!(await Fiscontable.confirmar({ titulo: "¿Detener la corrida?", texto: "La caja se corta y se borra; lo que falte queda «No se probó».", si: "Detener", peligro: true }))) return;
                h.disabled = true;
                await api("/api/admin/probar-errores/" + c.id + "/detener", { method: "POST" });
                Fiscontable.toast("Listo: se detuvo y la caja se borra.");
            } else if (h.dataset.hacer === "reporte") {
                h.disabled = true;
                var r = await fetch(API + "/api/admin/probar-errores/" + c.id + "/reporte", { credentials: "include" });
                if (!r.ok) throw new Error(await Fiscontable.leerError(r));
                var nombre = ((r.headers.get("content-disposition") || "").match(/filename="([^"]+)"/) || [])[1] || "probar_con_errores.zip";
                Fiscontable.guardarArchivo(await r.blob(), nombre);
                h.disabled = false;
            }
        } catch (e) { Fiscontable.toast(e.message); h.disabled = false; }
    });
    document.addEventListener("click", function (ev) {
        if (ev.target.closest("[data-ayuda]")) $("pe-ayuda").showModal();
        else if (ev.target.closest("[data-ayuda-cerrar]")) $("pe-ayuda").close();
    });

    (async function () {
        var p = await Fiscontable.perfil();
        if (!p || p._error || p.rol !== "admin") { $("pe-aviso").hidden = false; $("pe-aviso").innerHTML = "<b>Esta página es solo para el administrador.</b>"; return; }
        cargar();
    })();
})();
