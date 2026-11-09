/*
 * admin/planes-admin.js — Planes y precios (catálogo comercial) y asignación de plan a cada usuario.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var datos = null, cargado = false;
    var ROLES = { pro: "Pro", plus: "Plus", demo: "Demo" };

    async function api(ruta, metodo, cuerpo) {
        var r = await fetch(API + ruta, { method: metodo || "GET", credentials: "include",
            headers: cuerpo ? { "Content-Type": "application/json" } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    var campo = "text-sm border border-gray-300 rounded-lg p-2";

    function filaPlan(p) {
        p = p || { empresas: 5, timbres: 100, precio: 0, rol: "pro" };
        var d = document.createElement("div");
        d.className = "grid grid-cols-2 sm:grid-cols-12 gap-2 items-center border border-gray-200 rounded-lg p-2";
        d.dataset.plan = p.clave || "";
        d.innerHTML =
            '<input data-k="nombre" placeholder="Nombre" class="sm:col-span-2 ' + campo + '">' +
            '<label class="sm:col-span-1 text-xs text-slate-500">Empresas<input data-k="empresas" type="number" min="1" class="w-full ' + campo + '"></label>' +
            '<label class="sm:col-span-1 text-xs text-slate-500">Timbres/mes<input data-k="timbres" type="number" min="0" class="w-full ' + campo + '"></label>' +
            '<label class="sm:col-span-2 text-xs text-slate-500">Precio al mes ($)<input data-k="precio" type="number" min="0" step="1" class="w-full ' + campo + '"></label>' +
            '<label class="sm:col-span-1 text-xs text-slate-500">Rol<select data-k="rol" class="w-full ' + campo + '">' +
                Object.keys(ROLES).map(function (r) { return '<option value="' + r + '">' + ROLES[r] + "</option>"; }).join("") + "</select></label>" +
            '<input data-k="para" placeholder="Para quién (ej. Despacho chico)" class="sm:col-span-3 ' + campo + '">' +
            '<label class="sm:col-span-1 text-xs text-slate-600 flex items-center gap-1"><input data-k="destacado" type="checkbox"> Destacado</label>' +
            '<button type="button" data-quitar class="sm:col-span-1 text-xs font-bold text-red-600 hover:underline">Quitar</button>';
        ["nombre", "empresas", "timbres", "precio", "rol", "para"].forEach(function (k) { d.querySelector('[data-k="' + k + '"]').value = p[k] != null ? p[k] : ""; });
        d.querySelector('[data-k="destacado"]').checked = !!p.destacado;
        $("pr-planes").appendChild(d);
    }
    function filaTimbre(t) {
        t = t || {};
        var d = document.createElement("div");
        d.className = "flex gap-2 items-center";
        d.innerHTML = '<input data-k="timbres" type="number" min="1" placeholder="Timbres" class="w-28 ' + campo + '"> timbres por $' +
            '<input data-k="precio" type="number" min="1" step="1" placeholder="Precio" class="w-28 ' + campo + '">' +
            '<button type="button" data-quitar class="text-xs font-bold text-red-600 hover:underline">Quitar</button>';
        d.querySelector('[data-k="timbres"]').value = t.timbres || ""; d.querySelector('[data-k="precio"]').value = t.precio || "";
        $("pr-timbres").appendChild(d);
    }
    function pintar() {
        $("pr-planes").innerHTML = ""; datos.planes.forEach(filaPlan);
        $("pr-timbres").innerHTML = ""; (datos.timbres || []).forEach(filaTimbre);
        $("pr-meses").value = datos.meses_gratis_anual || 0;
        $("pr-incluye").value = (datos.incluye || []).join("\n");
        $("pr-plan").innerHTML = '<option value="">Sin plan (sin tope)</option>' + datos.planes.map(function (p) {
            return '<option value="' + esc(p.clave) + '">' + esc(p.nombre) + " · " + p.empresas + " empresas</option>";
        }).join("");
        var asig = datos.asignados || {}, nombres = {};
        datos.planes.forEach(function (p) { nombres[p.clave] = p.nombre; });
        var lista = Object.keys(asig);
        $("pr-asignados").textContent = lista.length ? "Con plan: " + lista.map(function (c) { return c + " (" + (nombres[asig[c]] || asig[c]) + ")"; }).join(", ") : "Nadie tiene plan asignado todavía.";
    }
    async function cargar() {
        if (cargado) return;
        try { datos = await api("/api/admin/planes-catalogo"); cargado = true; pintar(); }
        catch (e) { $("pr-msj").textContent = e.message; $("pr-msj").className = "text-xs font-semibold text-red-600"; }
        try {
            var us = await api("/api/usuarios");
            $("pr-correos").innerHTML = (us.usuarios || us || []).map(function (u) { return '<option value="' + esc(u.correo) + '">'; }).join("");
        } catch (e) { /* sin lista: se escribe a mano */ }
    }
    async function guardar() {
        var msj = $("pr-msj");
        var cuerpo = {
            planes: Array.from($("pr-planes").children).map(function (f) {
                var v = function (k) { var el = f.querySelector('[data-k="' + k + '"]'); return el.type === "checkbox" ? el.checked : el.value; };
                return { clave: f.dataset.plan || "", nombre: v("nombre"), empresas: +v("empresas"), timbres: +v("timbres"), precio: +v("precio"),
                         rol: v("rol"), para: v("para"), destacado: v("destacado") };
            }),
            timbres: Array.from($("pr-timbres").children).map(function (f) {
                return { timbres: +f.querySelector('[data-k="timbres"]').value, precio: +f.querySelector('[data-k="precio"]').value };
            }),
            meses_gratis_anual: +$("pr-meses").value || 0,
            incluye: $("pr-incluye").value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean)
        };
        msj.textContent = "Guardando…"; msj.className = "text-xs font-semibold text-slate-500";
        try {
            var asignados = datos.asignados;
            datos = await api("/api/admin/planes-catalogo", "PUT", cuerpo); datos.asignados = asignados;
            pintar(); msj.textContent = "✓ Guardado."; msj.className = "text-xs font-semibold text-emerald-700";
        } catch (e) { msj.textContent = e.message; msj.className = "text-xs font-semibold text-red-600"; }
    }
    async function asignar() {
        var msj = $("pr-asignar-msj"), correo = $("pr-correo").value.trim().toLowerCase(), plan = $("pr-plan").value;
        if (!correo) { msj.textContent = "Escribe el correo."; return; }
        try {
            await api("/api/admin/usuarios/" + encodeURIComponent(correo) + "/plan", "PUT", { plan: plan || null });
            if (plan) datos.asignados[correo] = plan; else delete datos.asignados[correo];
            pintar(); msj.textContent = "✓ Listo."; msj.className = "text-xs font-semibold text-emerald-700";
        } catch (e) { msj.textContent = e.message; msj.className = "text-xs font-semibold text-red-600"; }
    }

    document.addEventListener("DOMContentLoaded", function () {
        if (!$("caja-precios")) return;
        $("pr-mas-plan").addEventListener("click", function () { filaPlan(); });
        $("pr-mas-timbre").addEventListener("click", function () { filaTimbre(); });
        $("caja-precios").addEventListener("click", function (e) { var q = e.target.closest("[data-quitar]"); if (q) q.parentElement.remove(); });
        $("pr-guardar").addEventListener("click", guardar);
        $("pr-asignar").addEventListener("click", asignar);
        // Se carga cuando la caja se ve (está en la pestaña de permisos)
        var obs = new IntersectionObserver(function (es) { if (es.some(function (x) { return x.isIntersecting; })) { cargar(); obs.disconnect(); } });
        obs.observe($("caja-precios"));
    });
})();
