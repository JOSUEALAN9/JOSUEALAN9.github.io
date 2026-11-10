/*
 * admin/licencias-admin.js — Pestaña Licencias de Administración: emitir claves (individuales o de despacho), ver
 * quién las activó y hasta cuándo, y cancelarlas. Las claves completas se ven una sola vez, al emitirlas.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var datos = null, filtro = "", claves = [];
    var ESTADOS = { disponible: ["Sin usar", ""], activa: ["Activa", "ok"], vencida: ["Vencida", "aviso"], caducada: ["Caducó sin usar", "aviso"], revocada: ["Cancelada", "error"] };

    async function api(ruta, metodo, cuerpo) {
        var r = await fetch(API + ruta, { method: metodo || "GET", credentials: "include",
            headers: cuerpo ? { "Content-Type": "application/json" } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function avisar(tipo, texto) { if (typeof mostrarAlerta === "function") mostrarAlerta(tipo, texto); else Fiscontable.avisar(texto); }
    function fecha(iso) { var d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "—"; }

    async function cargar() {
        try { datos = await api("/api/admin/licencias" + (filtro ? "?estado=" + filtro : "")); } catch (e) { avisar("error", e.message); return; }
        pintar();
    }

    function pintar() {
        var lista = datos.licencias;
        var sinUsar = lista.filter(function (l) { return l.estado === "disponible"; }).length;
        if (!filtro) $("cuenta-licencias").textContent = lista.length ? "(" + lista.length + ")" : "";
        $("lca-vacio").classList.toggle("hidden", lista.length > 0);
        var planes = {};
        datos.planes.forEach(function (p) { planes[p.clave] = p.nombre; });
        $("lca-lista").innerHTML = lista.map(function (l) {
            var e = ESTADOS[l.estado] || [l.estado, ""];
            return '<tr class="border-t border-gray-100">' +
                '<td class="p-4 font-mono text-xs whitespace-nowrap">' + esc(l.clave) + "</td>" +
                '<td class="p-4">' + esc(datos.tipos[l.tipo] || l.tipo) + "<div class=\"text-xs text-slate-500\">" + esc(planes[l.plan] || l.rol) +
                    (l.tipo === "despacho" ? " · " + l.asientos + " lugares" : "") + "</div></td>" +
                '<td class="p-4 whitespace-nowrap">' + l.meses + (l.meses === 1 ? " mes" : " meses") + "</td>" +
                '<td class="p-4"><span class="ui-estado' + (e[1] ? " ui-estado--" + e[1] : "") + '">' + esc(e[0]) + "</span></td>" +
                '<td class="p-4 text-xs">' + esc(l.activada_por || "—") + (l.cuenta && l.cuenta !== l.activada_por ? '<div class="text-slate-500">cuenta del despacho</div>' : "") + "</td>" +
                '<td class="p-4 whitespace-nowrap">' + (l.vence_en ? fecha(l.vence_en) : (l.caduca ? "Activar antes del " + fecha(l.caduca) : "—")) + "</td>" +
                '<td class="p-4 text-xs text-slate-600">' + esc(l.nota || "") + "</td>" +
                '<td class="p-4 text-right">' + (l.estado === "disponible" || l.estado === "activa" || l.estado === "vencida" ?
                    '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-revocar="' + l.id + '" data-activa="' + (l.estado !== "disponible" ? 1 : 0) + '">Cancelar</button>' : "") + "</td></tr>";
        }).join("");
        void sinUsar;
    }

    function abrirEmitir() {
        claves = [];
        $("lca-forma").reset();
        $("lca-plan").innerHTML = datos.planes.map(function (p) { return '<option value="' + esc(p.clave) + '">' + esc(p.nombre) + "</option>"; }).join("") ||
            '<option value="">Pro</option>';
        $("lca-meses").innerHTML = datos.meses.map(function (m) { return '<option value="' + m + '"' + (m === 12 ? " selected" : "") + ">" + m + (m === 1 ? " mes" : " meses") + "</option>"; }).join("");
        ["lca-resultado", "lca-copiar", "lca-bajar", "lca-error"].forEach(function (id) { $(id).hidden = true; });
        $("lca-crear").hidden = false; $("lca-cancelar").textContent = "Cancelar";
        [].forEach.call($("lca-forma").querySelectorAll("input,select"), function (x) { x.disabled = false; });
        tipoCambio();
        $("lca-dlg").showModal();
    }

    function tipoCambio() {
        var despacho = document.querySelector('input[name="lca-tipo"]:checked').value === "despacho";
        $("lca-campo-asientos").hidden = !despacho;
        $("lca-campo-cantidad").hidden = despacho;
        if (despacho) { var pd = datos.planes.filter(function (p) { return /despacho/i.test(p.clave); })[0]; if (pd) $("lca-plan").value = pd.clave; }
    }

    async function emitir() {
        var despacho = document.querySelector('input[name="lca-tipo"]:checked').value === "despacho";
        var cuerpo = { tipo: despacho ? "despacho" : "individual", plan: $("lca-plan").value || null, meses: +$("lca-meses").value,
                       asientos: despacho ? +$("lca-asientos").value : 1, cantidad: despacho ? 1 : +$("lca-cantidad").value,
                       nota: $("lca-nota").value.trim(), caduca_dias: $("lca-caduca").value ? +$("lca-caduca").value : null };
        var b = $("lca-crear");
        b.classList.add("ui-btn--cargando");
        try {
            claves = (await api("/api/admin/licencias", "POST", cuerpo)).claves;
            $("lca-claves").textContent = claves.join("\n");
            $("lca-resultado").hidden = false;
            $("lca-copiar").hidden = $("lca-bajar").hidden = false;
            $("lca-crear").hidden = true; $("lca-cancelar").textContent = "Listo";
            [].forEach.call($("lca-forma").querySelectorAll("input,select"), function (x) { x.disabled = true; });
            $("lca-dlg-sub").textContent = claves.length === 1 ? "Esta es la clave." : "Estas son las " + claves.length + " claves.";
            cargar();
        } catch (e) { $("lca-error").textContent = e.message; $("lca-error").hidden = false; }
        finally { b.classList.remove("ui-btn--cargando"); }
    }

    async function revocar(id, activa) {
        var terminar = false;
        if (activa) {
            if (!(await Fiscontable.preguntar("¿Cancelar esta licencia? Ya está en uso."))) return;
            terminar = (await Fiscontable.preguntar("¿También termina el acceso de esa cuenta hoy mismo?\n\nAceptar = su vigencia vence hoy.\nCancelar = conserva la vigencia que ya tenía."));
        } else if (!(await Fiscontable.preguntar("¿Cancelar esta clave? Ya no se podrá activar."))) return;
        try { await api("/api/admin/licencias/" + id + "/revocar", "POST", { terminar_acceso: terminar }); cargar(); } catch (e) { avisar("error", e.message); }
    }

    $("lca-emitir").addEventListener("click", async function () { if (!datos) await cargar(); abrirEmitir(); });
    $("lca-crear").addEventListener("click", emitir);
    $("lca-forma").addEventListener("change", function (e) { if (e.target.name === "lca-tipo") tipoCambio(); });
    $("lca-forma").addEventListener("submit", function (e) { e.preventDefault(); });
    $("lca-dlg").addEventListener("click", function (e) { if (e.target.closest("[data-lca-cerrar]") || e.target === this) this.close(); });
    $("lca-copiar").addEventListener("click", function () {
        navigator.clipboard.writeText(claves.join("\n")).then(function () { $("lca-copiar").textContent = "Copiadas ✓"; setTimeout(function () { $("lca-copiar").textContent = "Copiar"; }, 1800); });
    });
    $("lca-bajar").addEventListener("click", function () {
        var nota = $("lca-nota").value.trim();
        var texto = "Licencias de Fiscontable" + (nota ? " · " + nota : "") + "\nActívalas en https://fiscontable.app/activar\n\n" + claves.join("\n") + "\n";
        Fiscontable.guardarArchivo ? Fiscontable.guardarArchivo(new Blob([texto], { type: "text/plain" }), "licencias-fiscontable.txt")
            : (function () { var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([texto], { type: "text/plain" })); a.download = "licencias-fiscontable.txt"; a.click(); })();
    });
    $("lca-filtro").addEventListener("click", function (e) {
        var b = e.target.closest("[data-estado]");
        if (!b) return;
        filtro = b.dataset.estado;
        [].forEach.call(this.querySelectorAll("[data-estado]"), function (x) { x.setAttribute("aria-selected", String(x === b)); });
        cargar();
    });
    $("lca-lista").addEventListener("click", function (e) {
        var b = e.target.closest("[data-revocar]");
        if (b) revocar(b.dataset.revocar, b.dataset.activa === "1");
    });

    window.LicenciasAdmin = { cargar: cargar };
})();
