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

let ultimo = null;

// No repintar mientras alguien está ajustando una PC (se perdería lo que escribe)
function editando() {
    return !!document.querySelector("#lista details[open]") || (document.activeElement && document.activeElement.closest && document.activeElement.closest("#lista"));
}

function horaCorta(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString("es-MX", { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function estadoPc(a) {
    if (!a.aprobado) return '<span class="text-xs font-bold text-amber-700">· por aprobar</span>';
    if (a.trabajando) return '<span class="text-xs text-emerald-700">· trabajando ahora</span>';
    if (a.ajustes.pausa_hasta && new Date(a.ajustes.pausa_hasta) > new Date()) return `<span class="text-xs text-amber-700">· en pausa hasta ${esc(horaCorta(a.ajustes.pausa_hasta))}</span>`;
    if (a.conectado) return '<span class="text-xs text-emerald-700">· conectada' + (a.disponible ? "" : " (fuera de su horario)") + "</span>";
    return `<span class="text-xs text-slate-400">· apagada o sin internet (${esc(haceCuanto(a.ultimo_contacto))})</span>`;
}

function ajustesPc(a, tramites) {
    const todos = a.ajustes.tramites === null;
    const casillas = Object.entries(tramites).map(([k, n]) =>
        `<label class="inline-flex items-center gap-1 mr-3"><input type="checkbox" data-tramite="${esc(k)}" ${todos || a.ajustes.tramites.includes(k) ? "checked" : ""}> ${esc(n)}</label>`).join("");
    const pausada = a.ajustes.pausa_hasta && new Date(a.ajustes.pausa_hasta) > new Date();
    return `<details class="mt-2 text-xs text-slate-600" data-ajustes="${esc(a.id)}">
        <summary class="cursor-pointer text-slate-500 hover:text-slate-800">Ajustes de esta PC</summary>
        <div class="mt-2 space-y-2 border border-gray-100 rounded-lg p-3">
            <label class="block">Nombre <input data-campo="nombre" value="${esc(a.nombre)}" maxlength="60" class="ml-1 border border-gray-200 rounded px-2 py-1 w-48"></label>
            <div>Trámites que hace: <div class="mt-1">${casillas}</div></div>
            <div>Horario (vacío = siempre): <input type="time" data-campo="desde" value="${esc(a.ajustes.desde)}" class="border border-gray-200 rounded px-1">
                a <input type="time" data-campo="hasta" value="${esc(a.ajustes.hasta)}" class="border border-gray-200 rounded px-1"></div>
            <label class="block"><input type="checkbox" data-campo="copia_local" ${a.ajustes.copia_local ? "checked" : ""}> Guardar copia en esta PC (Documentos\\Fiscontable)</label>
            <div class="flex flex-wrap gap-2 items-center pt-1">
                <button type="button" data-guardar="${esc(a.id)}" class="font-bold text-white bg-slate-800 hover:bg-slate-700 rounded-lg py-1.5 px-3" disabled>Sin cambios</button>
                ${pausada ? `<button type="button" data-pausa="${esc(a.id)}" data-horas="0" class="border border-gray-200 rounded-lg py-1.5 px-3">Reanudar</button>`
                          : `<button type="button" data-pausa="${esc(a.id)}" data-horas="1" class="border border-gray-200 rounded-lg py-1.5 px-3">Pausar 1 hora</button>
                             <button type="button" data-pausa="${esc(a.id)}" data-horas="12" class="border border-gray-200 rounded-lg py-1.5 px-3">Pausar 12 horas</button>`}
            </div>
        </div></details>`;
}

async function cargar(forzar) {
    const lista = document.getElementById("lista");
    if (!forzar && ultimo && editando()) return;
    try {
        const d = ultimo = await api("/api/agentes");
        const modo = document.getElementById("texto-modo");
        modo.className = "text-xs mt-3 " + (d.tramites_en_agente.length ? "text-emerald-700" : "text-amber-700");
        modo.textContent = d.tramites_en_agente.length
            ? `Hoy se hacen en tu PC (si está conectada y aprobada): ${d.tramites_en_agente.join(", ")}.`
            : "Por ahora el administrador no ha activado ningún trámite para los agentes: puedes vincular tu PC desde ya.";
        document.getElementById("cuantas").textContent = `${d.agentes.length} de ${d.max_pcs}`;
        if (!d.agentes.length) { lista.innerHTML = '<p class="text-slate-400">Todavía no hay PCs conectadas a tu cuenta.</p>'; return; }
        lista.innerHTML = '<ul class="divide-y divide-gray-100">' + d.agentes.map(a => `
            <li class="py-3 ${a.aprobado ? "" : "bg-amber-50 -mx-2 px-2 rounded-lg"}">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <span class="inline-block w-2 h-2 rounded-full mr-1 ${a.conectado && a.aprobado ? "bg-emerald-500" : a.aprobado ? "bg-gray-300" : "bg-amber-500"}"></span>
                        <b class="text-slate-800">${esc(a.nombre)}</b> ${estadoPc(a)}
                        <div class="text-xs text-slate-400">${esc(a.sistema || "")}${a.version ? " · agente " + esc(a.version) : ""}${a.ip ? " · red " + esc(a.ip) : ""} · vinculada ${esc(haceCuanto(a.creado))}</div>
                    </div>
                    <div class="flex gap-2">
                        ${a.aprobado ? "" : `<button type="button" data-aprobar="${esc(a.id)}" class="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg py-1 px-3">Sí, es mi PC</button>`}
                        <button type="button" data-quitar="${esc(a.id)}" data-nombre="${esc(a.nombre)}" class="text-xs text-slate-500 hover:text-red-600 border border-gray-200 rounded-lg py-1 px-3">${a.aprobado ? "Desconectar" : "No fui yo: desconectar"}</button>
                    </div>
                </div>
                ${a.aprobado ? "" : '<p class="text-xs text-amber-800 mt-1">Esta PC no recibe ningún trámite (ni e.firmas) hasta que la apruebes. Si no la reconoces, desconéctala.</p>'}
                ${ajustesPc(a, d.tramites)}
            </li>`).join("") + "</ul>";
    } catch (e) { lista.textContent = e.message; }
}

// Guardar: se activa solo con cambios, dice "Guardando…" y luego "✓ Guardado"
function marcarCambio(ev) {
    const caja = ev.target.closest("[data-ajustes]");
    if (!caja) return;
    const b = caja.querySelector("[data-guardar]");
    b.disabled = false; b.textContent = "Guardar cambios";
    b.className = "font-bold text-white bg-amber-600 hover:bg-amber-500 rounded-lg py-1.5 px-3";
}

async function guardarPc(b) {
    const caja = b.closest("[data-ajustes]"), id = b.dataset.guardar;
    const marcadas = [...caja.querySelectorAll("[data-tramite]")].filter(x => x.checked).map(x => x.dataset.tramite);
    const total = caja.querySelectorAll("[data-tramite]").length;
    const datos = {
        nombre: caja.querySelector('[data-campo="nombre"]').value,
        desde: caja.querySelector('[data-campo="desde"]').value, hasta: caja.querySelector('[data-campo="hasta"]').value,
        copia_local: caja.querySelector('[data-campo="copia_local"]').checked,
    };
    if (marcadas.length === total) datos.todos_los_tramites = true; else datos.tramites = marcadas;
    b.disabled = true; b.textContent = "Guardando…";
    try {
        await api(`/api/agentes/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
        b.textContent = "✓ Guardado"; b.className = "font-bold text-white bg-emerald-600 rounded-lg py-1.5 px-3";
        setTimeout(() => { b.textContent = "Sin cambios"; b.className = "font-bold text-white bg-slate-800 rounded-lg py-1.5 px-3"; }, 2500);
    } catch (e) { b.disabled = false; b.textContent = "Guardar cambios"; alerta("error", e.message); }
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

document.getElementById("lista").addEventListener("input", marcarCambio);
document.getElementById("lista").addEventListener("change", marcarCambio);
document.getElementById("lista").addEventListener("click", async (ev) => {
    const g = ev.target.closest("[data-guardar]");
    if (g) return guardarPc(g);
    const ap = ev.target.closest("[data-aprobar]");
    if (ap) {
        ap.disabled = true;
        try { await api(`/api/agentes/${ap.dataset.aprobar}/aprobar`, { method: "POST" }); alerta("ok", "Listo: esa PC ya puede hacer trámites para tu cuenta."); cargar(true); }
        catch (e) { ap.disabled = false; alerta("error", e.message); }
        return;
    }
    const pa = ev.target.closest("[data-pausa]");
    if (pa) {
        pa.disabled = true;
        try {
            await api(`/api/agentes/${pa.dataset.pausa}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pausa_horas: +pa.dataset.horas }) });
            alerta("ok", +pa.dataset.horas ? `Listo: esa PC no recibe trámites por ${pa.dataset.horas} h (los hace el servidor).` : "Listo: esa PC vuelve a recibir trámites.");
            cargar(true);
        } catch (e) { pa.disabled = false; alerta("error", e.message); }
        return;
    }
    const b = ev.target.closest("[data-quitar]");
    if (!b) return;
    if (!confirm(`¿Desconectar "${b.dataset.nombre}"? Esa PC dejará de hacer trámites para tu cuenta hasta que la vuelvas a vincular.`)) return;
    try { await api(`/api/agentes/${b.dataset.quitar}`, { method: "DELETE" }); alerta("ok", "Listo: esa PC quedó desconectada."); cargar(true); }
    catch (e) { alerta("error", e.message); }
});

document.getElementById("btn-actualizar").addEventListener("click", () => cargar(true));
cargar(true);
setInterval(() => cargar(false), 30000);
