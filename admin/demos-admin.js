/*
 * admin/demos-admin.js — Pestaña Demos de Administración: las solicitudes de fiscontable.app/demo. Aprobar (con los días
 * que quieras) deja la cuenta como Demo y le manda el correo para entrar; rechazar puede avisarle o no.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var datos = null, filtro = "pendiente";
    var PERSONAS = { "1": "Solo esa persona", "2-5": "2 a 5 personas", "6-10": "6 a 10 personas", "11+": "Más de 10 personas" };

    async function api(ruta, metodo, cuerpo) {
        var r = await fetch(API + ruta, { method: metodo || "GET", credentials: "include",
            headers: cuerpo ? { "Content-Type": "application/json" } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function avisar(tipo, texto) { if (typeof mostrarAlerta === "function") mostrarAlerta(tipo, texto); else alert(texto); }
    function fecha(iso) { var d = iso ? new Date(/Z$/.test(iso) ? iso : iso + "Z") : null; return d && !isNaN(d) ? d.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; }

    async function cargar() {
        try { datos = await api("/api/admin/demos" + (filtro ? "?estado=" + filtro : "")); } catch (e) { avisar("error", e.message); return; }
        $("dma-auto").checked = datos.ajustes.automatica;
        $("dma-dias").value = datos.ajustes.dias;
        $("cuenta-demos").textContent = datos.pendientes ? "(" + datos.pendientes + ")" : "";
        pintar();
    }

    function pintar() {
        var lista = datos.demos;
        $("dma-vacio").classList.toggle("hidden", lista.length > 0);
        $("dma-vacio").textContent = filtro ? "No hay solicitudes pendientes." : "Todavía no hay solicitudes.";
        $("dma-lista").innerHTML = lista.map(function (d) {
            var estado = d.estado === "pendiente" ? '<span class="ui-estado ui-estado--aviso">Pendiente</span>'
                : d.estado === "aprobada" ? '<span class="ui-estado ui-estado--ok">Aprobada · ' + (d.dias || "") + " días</span>"
                : '<span class="ui-estado ui-estado--error">Rechazada</span>';
            return '<li class="p-4 flex flex-wrap items-start gap-4">' +
                '<div class="flex-1 min-w-[240px]"><b class="text-slate-800">' + esc(d.nombre) + "</b> · " + esc(d.correo) +
                    '<div class="text-xs text-slate-500 mt-1">' + [d.despacho, PERSONAS[d.personas] || d.personas, d.telefono, fecha(d.creada)].filter(Boolean).map(esc).join(" · ") + "</div>" +
                    (d.mensaje ? '<p class="text-sm text-slate-700 mt-2 italic">«' + esc(d.mensaje) + "»</p>" : "") +
                    (d.resuelta_por && d.estado !== "pendiente" ? '<div class="text-xs text-slate-400 mt-1">' + esc(d.resuelta_por) + " · " + esc(fecha(d.resuelta_en)) + "</div>" : "") + "</div>" +
                '<div class="flex items-center gap-2">' + estado +
                    (d.estado === "pendiente" ? '<button type="button" class="ui-btn ui-btn--primario ui-btn--28" data-aprobar="' + d.id + '">Aprobar</button>' +
                        '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-rechazar="' + d.id + '">Rechazar</button>' : "") +
                "</div></li>";
        }).join("");
    }

    async function aprobar(id, b) {
        var dias = prompt("¿Cuántos días de demo?", String(datos.ajustes.dias));
        if (dias === null) return;
        if (!/^\d{1,2}$/.test(dias.trim())) return avisar("error", "Escribe un número de días (1 a 60).");
        b.classList.add("ui-btn--cargando");
        try {
            var r = await api("/api/admin/demos/" + id + "/aprobar", "POST", { dias: +dias });
            avisar("success", "Demo activa para " + r.correo + " hasta el " + new Date(r.vence).toLocaleDateString("es-MX") + ". Le mandamos el correo para entrar.");
            cargar();
        } catch (e) { b.classList.remove("ui-btn--cargando"); avisar("error", e.message); }
    }

    async function rechazar(id) {
        if (!confirm("¿Rechazar esta solicitud?")) return;
        var avisarle = confirm("¿Le mandamos un correo para avisarle?\n\nAceptar = sí, le avisamos.\nCancelar = no le escribimos.");
        try { await api("/api/admin/demos/" + id + "/rechazar", "POST", { avisar: avisarle }); cargar(); } catch (e) { avisar("error", e.message); }
    }

    $("dma-guardar").addEventListener("click", async function () {
        try {
            datos.ajustes = await api("/api/admin/demos/ajustes", "PUT", { automatica: $("dma-auto").checked, dias: +$("dma-dias").value });
            avisar("success", datos.ajustes.automatica ? "Las demos se aprueban solas por " + datos.ajustes.dias + " días." : "Tú apruebas cada demo (" + datos.ajustes.dias + " días de fábrica).");
        } catch (e) { avisar("error", e.message); }
    });
    $("dma-filtro").addEventListener("click", function (e) {
        var b = e.target.closest("[data-estado]");
        if (!b) return;
        filtro = b.dataset.estado;
        [].forEach.call(this.querySelectorAll("[data-estado]"), function (x) { x.setAttribute("aria-selected", String(x === b)); });
        cargar();
    });
    $("dma-lista").addEventListener("click", function (e) {
        var a = e.target.closest("[data-aprobar]"), r = e.target.closest("[data-rechazar]");
        if (a) aprobar(a.dataset.aprobar, a);
        else if (r) rechazar(r.dataset.rechazar);
    });

    window.DemosAdmin = { cargar: cargar };
    // El número de pendientes se ve en la pestaña aunque no se abra
    api("/api/admin/demos?estado=pendiente").then(function (d) { $("cuenta-demos").textContent = d.pendientes ? "(" + d.pendientes + ")" : ""; }).catch(function () {});
})();
