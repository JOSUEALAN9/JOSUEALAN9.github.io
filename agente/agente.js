/* agente/agente.js — Conectar esta PC: código de vinculación y PCs conectadas (core/agentes.py). */
"use strict";
const API = Fiscontable.API, esc = Fiscontable.escapar;
let reloj = null;

async function api(ruta, opciones) {
    let resp;
    try { resp = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {})); }
    catch (e) { throw new Error(await Fiscontable.leerError(null)); }
    if (!resp.ok) throw new Error(await Fiscontable.leerError(resp));
    return resp.json();
}

function alerta(tipo, texto) {
    const c = document.getElementById("alerta");
    c.className = "mb-4 p-3 rounded-lg text-sm " + (tipo === "ok" ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
        : "bg-red-50 text-red-800 border border-red-200");
    c.textContent = texto;
}

function haceCuanto(iso) {
    if (!iso) return "nunca";
    const seg = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (seg < 90) return "hace un momento";
    if (seg < 3600) return `hace ${Math.round(seg / 60)} min`;
    if (seg < 86400) return `hace ${Math.round(seg / 3600)} h`;
    return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

async function cargar() {
    const lista = document.getElementById("lista");
    try {
        const d = await api("/api/agentes");
        const modo = document.getElementById("texto-modo");
        modo.className = "text-xs mt-3 " + (d.tramites_en_agente.length ? "text-emerald-700" : "text-amber-700");
        modo.textContent = d.tramites_en_agente.length
            ? `Hoy se hacen en tu PC (si está conectada): ${d.tramites_en_agente.join(", ")}.`
            : "Por ahora el administrador no ha activado ningún trámite para los agentes: puedes vincular tu PC desde ya.";
        if (!d.agentes.length) { lista.innerHTML = '<p class="text-slate-400">Todavía no hay PCs conectadas a tu cuenta.</p>'; return; }
        lista.innerHTML = '<ul class="divide-y divide-gray-100">' + d.agentes.map(a => `
            <li class="py-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <span class="inline-block w-2 h-2 rounded-full mr-1 ${a.conectado ? "bg-emerald-500" : "bg-gray-300"}"></span>
                    <b class="text-slate-800">${esc(a.nombre)}</b>
                    <span class="text-xs ${a.conectado ? "text-emerald-700" : "text-slate-400"}">
                        ${a.trabajando ? "· trabajando ahora" : a.conectado ? "· conectada" : "· apagada o sin internet (" + esc(haceCuanto(a.ultimo_contacto)) + ")"}</span>
                    <div class="text-xs text-slate-400">${esc(a.sistema || "")}${a.version ? " · agente " + esc(a.version) : ""} · vinculada ${esc(haceCuanto(a.creado))}</div>
                </div>
                <button type="button" data-quitar="${esc(a.id)}" data-nombre="${esc(a.nombre)}" class="text-xs text-slate-500 hover:text-red-600 border border-gray-200 rounded-lg py-1 px-3">Desconectar</button>
            </li>`).join("") + "</ul>";
    } catch (e) { lista.textContent = e.message; }
}

document.getElementById("btn-codigo").addEventListener("click", async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    try {
        const d = await api("/api/agentes/codigo", { method: "POST" });
        document.getElementById("codigo").textContent = d.codigo;
        document.getElementById("caja-codigo").classList.remove("hidden");
        const vence = new Date(d.expira).getTime();
        clearInterval(reloj);
        const pinta = () => {
            const s = Math.round((vence - Date.now()) / 1000);
            document.getElementById("codigo-vence").textContent = s > 0 ? `vence en ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "venció; pide otro";
            if (s <= 0) clearInterval(reloj);
        };
        pinta(); reloj = setInterval(pinta, 1000);
        b.textContent = "Pedir otro código";
    } catch (e) { alerta("error", e.message); }
    b.disabled = false;
});

document.getElementById("lista").addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-quitar]");
    if (!b) return;
    if (!confirm(`¿Desconectar "${b.dataset.nombre}"? Esa PC dejará de hacer trámites para tu cuenta hasta que la vuelvas a vincular.`)) return;
    try { await api(`/api/agentes/${b.dataset.quitar}`, { method: "DELETE" }); alerta("ok", "Listo: esa PC quedó desconectada."); cargar(); }
    catch (e) { alerta("error", e.message); }
});

document.getElementById("btn-actualizar").addEventListener("click", cargar);
cargar();
setInterval(cargar, 30000);
