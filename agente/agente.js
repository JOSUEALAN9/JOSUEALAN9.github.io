/* agente/agente.js — Conectar esta PC: código de vinculación y PCs conectadas (core/agentes.py). */
"use strict";
const API = Fiscontable.API, esc = Fiscontable.escapar;
let reloj = null, vigia = null, codigoActual = "";

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

function ajustesPc(a) {
    // De fábrica la PC procesa todo y guarda copia; aquí solo se ajusta el nombre, el horario y el modo sin conexión
    const pausada = a.ajustes.pausa_hasta && new Date(a.ajustes.pausa_hasta) > new Date();
    return `<details class="mt-2 text-xs text-slate-600" data-ajustes="${esc(a.id)}">
        <summary class="cursor-pointer text-slate-500 hover:text-slate-800">Ajustes de esta PC</summary>
        <div class="mt-2 space-y-3 border border-gray-100 rounded-lg p-3">
            <label class="block">Nombre <input data-campo="nombre" value="${esc(a.nombre)}" maxlength="60" class="ml-1 border border-gray-200 rounded px-2 py-1 w-48"></label>
            <div>Horario <input type="time" data-campo="desde" value="${esc(a.ajustes.desde)}" class="ml-1 border border-gray-200 rounded px-1">
                a <input type="time" data-campo="hasta" value="${esc(a.ajustes.hasta)}" class="border border-gray-200 rounded px-1">
                <span class="text-slate-400">(vacío: todo el día)</span></div>
            <label class="flex items-start gap-2"><input type="checkbox" data-campo="boveda" class="mt-0.5" ${a.ajustes.boveda ? "checked" : ""}>
                <span><b class="text-slate-700">Modo sin conexión</b><br>Guarda cifradas en esta PC las e.firmas que use, para pedir constancias y opiniones desde el Agente aunque Fiscontable no esté disponible.</span></label>
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
        modo.className = "text-xs mb-4 text-emerald-700";
        modo.textContent = d.tramites_en_agente.length ? `Se procesan en tu PC: ${d.tramites_en_agente.join(", ")}.` : "";
        modo.hidden = !d.tramites_en_agente.length;
        document.getElementById("cuantas").textContent = `${d.agentes.length} de ${d.max_pcs}`;
        pintarInstalador(d.instalador);
        if (!d.agentes.length) { lista.innerHTML = '<p class="text-slate-400">Sin PCs conectadas.</p>'; return; }
        lista.innerHTML = '<ul class="divide-y divide-gray-100">' + d.agentes.map(a => `
            <li class="py-3 ${a.aprobado ? "" : "bg-amber-50 -mx-2 px-2 rounded-lg"}">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <span class="inline-block w-2 h-2 rounded-full mr-1 ${a.conectado && a.aprobado ? "bg-emerald-500" : a.aprobado ? "bg-gray-300" : "bg-amber-500"}"></span>
                        <b class="text-slate-800">${esc(a.nombre)}</b> ${estadoPc(a)}
                        <div class="text-xs text-slate-400">${esc(a.sistema || "")}${a.version ? " · agente " + esc(a.version) : ""}${d.instalador && a.version && masNueva(d.instalador.version, a.version)
                            ? ` <span class="text-amber-700 font-bold">· versión ${esc(d.instalador.version)} disponible</span>` : ""}${a.ip ? " · red " + esc(a.ip) : ""} · conectada ${esc(haceCuanto(a.creado))}</div>
                    </div>
                    <div class="flex gap-2">
                        ${a.aprobado ? "" : `<button type="button" data-aprobar="${esc(a.id)}" class="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg py-1 px-3">Sí, es mi PC</button>`}
                        <button type="button" data-quitar="${esc(a.id)}" data-nombre="${esc(a.nombre)}" class="text-xs text-slate-500 hover:text-red-600 border border-gray-200 rounded-lg py-1 px-3">${a.aprobado ? "Desconectar" : "No fui yo: desconectar"}</button>
                    </div>
                </div>
                ${a.aprobado ? "" : '<p class="text-xs text-amber-800 mt-1">No recibe solicitudes hasta que la apruebes. Si no la reconoces, desconéctala.</p>'}
                ${ajustesPc(a)}
            </li>`).join("") + "</ul>";
    } catch (e) { lista.textContent = e.message; }
}

function masNueva(nueva, actual) {
    const n = String(nueva || "").split(/\D+/).filter(Boolean).map(Number), a = String(actual || "").split(/\D+/).filter(Boolean).map(Number);
    for (let i = 0; i < Math.max(n.length, a.length); i++) {
        if ((n[i] || 0) !== (a[i] || 0)) return (n[i] || 0) > (a[i] || 0);
    }
    return false;
}

function pintarInstalador(inst) {
    const b = document.getElementById("btn-instalador"), t = document.getElementById("texto-instalador");
    if (b.dataset.bajando) return;
    b.disabled = !inst;
    t.textContent = inst ? `versión ${inst.version} · ${Math.round(inst.tamano / 1048576)} MB` : "No disponible por el momento.";
}

async function bajarInstalador(b) {
    b.disabled = true; b.dataset.bajando = "1"; b.textContent = "Bajando…";
    try {
        const resp = await fetch(API + "/api/agentes/instalador", { credentials: "include" });
        if (!resp.ok) throw new Error(await Fiscontable.leerError(resp));
        Fiscontable.guardarArchivo(await resp.blob(), "FiscontableAgente-Setup.exe");
        alerta("ok", "Abre FiscontableAgente-Setup.exe en esa PC.");
    } catch (e) { alerta("error", e.message || "No se pudo descargar el instalador."); }
    delete b.dataset.bajando; b.disabled = false; b.textContent = "Descargar para Windows";
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
    const datos = {
        nombre: caja.querySelector('[data-campo="nombre"]').value,
        desde: caja.querySelector('[data-campo="desde"]').value, hasta: caja.querySelector('[data-campo="hasta"]').value,
        boveda: caja.querySelector('[data-campo="boveda"]').checked,
        todos_los_tramites: true, copia_local: true, solo_presente: false,       // lo de fábrica: procesa todo y guarda copia
    };
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
        mostrarCodigo(d);
        b.textContent = "Pedir otro código";
    } catch (e) { alerta("error", e.message); }
    b.disabled = false;
});

// El código: se ve, se copia, cuenta hacia atrás y se apaga solo en cuanto una PC lo usa (o vence)
function mostrarCodigo(d) {
    codigoActual = d.codigo;
    const caja = document.getElementById("caja-codigo"), cod = document.getElementById("codigo"), copiar = document.getElementById("btn-copiar");
    cod.textContent = d.codigo; cod.className = "font-mono text-2xl font-bold tracking-widest text-slate-800 select-all";
    copiar.style.display = ""; copiar.disabled = false; copiar.textContent = "Copiar";
    caja.classList.remove("hidden");
    const vence = new Date(d.expira).getTime();
    clearInterval(reloj); clearInterval(vigia);
    const pinta = () => {
        const s = Math.round((vence - Date.now()) / 1000);
        if (s <= 0) return apagarCodigo("Venció. Pide otro.", false);
        document.getElementById("codigo-vence").textContent = `vence en ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    };
    pinta(); reloj = setInterval(pinta, 1000);
    vigia = setInterval(revisarCodigo, 2500);
}

function apagarCodigo(texto, usado) {
    clearInterval(reloj); clearInterval(vigia);
    const cod = document.getElementById("codigo");
    cod.className = "font-mono text-2xl font-bold tracking-widest text-slate-300 line-through select-none";
    document.getElementById("btn-copiar").style.display = "none";
    const v = document.getElementById("codigo-vence");
    v.textContent = texto; v.className = "text-xs " + (usado ? "font-bold text-emerald-700" : "text-slate-500");
    codigoActual = "";
}

async function revisarCodigo() {
    if (!codigoActual) return;
    try {
        const r = await api("/api/agentes/codigo/" + encodeURIComponent(codigoActual));
        if (r.estado === "usado") {
            apagarCodigo(`✓ Ya se usó: se conectó «${r.pc}». Apruébala abajo con «Sí, es mi PC».`, true);
            cargar(true);
        } else if (r.estado === "vencido") apagarCodigo("Venció. Pide otro.", false);
    } catch (e) { /* se reintenta en la siguiente vuelta */ }
}

document.getElementById("btn-copiar").addEventListener("click", async (ev) => {
    const b = ev.currentTarget, texto = document.getElementById("codigo").textContent;
    try { await navigator.clipboard.writeText(texto); }
    catch (e) {
        const r = document.createRange(); r.selectNodeContents(document.getElementById("codigo"));
        const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand("copy");
    }
    b.textContent = "✓ Copiado";
    setTimeout(() => { if (b.style.display !== "none") b.textContent = "Copiar"; }, 2000);
});

document.getElementById("lista").addEventListener("input", marcarCambio);
document.getElementById("lista").addEventListener("change", marcarCambio);
document.getElementById("lista").addEventListener("click", async (ev) => {
    const g = ev.target.closest("[data-guardar]");
    if (g) return guardarPc(g);
    const ap = ev.target.closest("[data-aprobar]");
    if (ap) {
        ap.disabled = true;
        try { await api(`/api/agentes/${ap.dataset.aprobar}/aprobar`, { method: "POST" }); alerta("ok", "PC aprobada."); cargar(true); }
        catch (e) { ap.disabled = false; alerta("error", e.message); }
        return;
    }
    const pa = ev.target.closest("[data-pausa]");
    if (pa) {
        pa.disabled = true;
        try {
            await api(`/api/agentes/${pa.dataset.pausa}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pausa_horas: +pa.dataset.horas }) });
            alerta("ok", +pa.dataset.horas ? `PC en pausa ${pa.dataset.horas} h.` : "PC reanudada.");
            cargar(true);
        } catch (e) { pa.disabled = false; alerta("error", e.message); }
        return;
    }
    const b = ev.target.closest("[data-quitar]");
    if (!b) return;
    if (!(await Fiscontable.preguntar(`¿Desconectar "${b.dataset.nombre}"? Dejará de procesar tus solicitudes hasta que la vuelvas a conectar.`))) return;
    try { await api(`/api/agentes/${b.dataset.quitar}`, { method: "DELETE" }); alerta("ok", "Listo: esa PC quedó desconectada."); cargar(true); }
    catch (e) { alerta("error", e.message); }
});

document.getElementById("btn-actualizar").addEventListener("click", () => cargar(true));
document.getElementById("btn-instalador").addEventListener("click", (ev) => bajarInstalador(ev.currentTarget));
cargar(true);
setInterval(() => cargar(false), 30000);
