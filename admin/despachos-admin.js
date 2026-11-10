/*
 * admin/despachos-admin.js — Pestaña Despachos de Administración: crear despachos (con su titular), ver su equipo y
 * cuántas empresas tienen, el tope de empresas del espacio personal y activar o desactivar.
 * El titular administra su equipo desde /despacho/ (modulos/despacho/router.py).
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var lista = [];

    async function api(ruta, metodo, cuerpo) {
        var r = await fetch(API + ruta, { method: metodo || "GET", credentials: "include",
            headers: cuerpo ? { "Content-Type": "application/json" } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function avisar(tipo, texto) { if (typeof mostrarAlerta === "function") mostrarAlerta(tipo, texto); else alert(texto); }

    async function cargar() {
        try { lista = (await api("/api/admin/despachos")).despachos; } catch (e) { avisar("error", e.message); return; }
        pintar();
    }

    function pintar() {
        $("cuenta-despachos").textContent = lista.length ? "(" + lista.length + ")" : "";
        $("dsa-vacio").classList.toggle("hidden", lista.length > 0);
        $("dsa-lista").innerHTML = lista.map(function (d) {
            var tope = d.ajustes && d.ajustes.empresas_personales;
            return '<tr class="border-t border-gray-100' + (d.activo ? "" : " opacity-60") + '">' +
                '<td class="p-4"><b class="text-slate-800">' + esc(d.nombre) + "</b>" +
                    '<div class="text-xs text-slate-500">' + (d.interna ? "Cuenta propia del despacho" : "Cuenta de " + esc(d.cuenta)) + (d.activo ? "" : " · desactivado") + "</div></td>" +
                '<td class="p-4">' + esc(d.titulares || "—") + "</td>" +
                '<td class="p-4">' + d.n_miembros + (d.n_invitados ? ' <span class="text-xs text-amber-700">+' + d.n_invitados + " invitados</span>" : "") + "</td>" +
                '<td class="p-4">' + d.n_empresas + "</td>" +
                '<td class="p-4"><button type="button" class="cra-enlace" data-tope="' + d.id + '" title="Empresas que puede tener en Mi espacio quien no tiene licencia propia">' +
                    (tope === null || tope === undefined ? "Sin tope" : "Hasta " + tope) + "</button></td>" +
                '<td class="p-4 text-right whitespace-nowrap">' +
                    '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-ver-cuenta="' + esc(d.cuenta) + '" title="Ver sus empresas como la cuenta del despacho (solo lectura)">Ver como</button> ' +
                    '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-activo="' + d.id + '" data-valor="' + (d.activo ? "0" : "1") + '">' + (d.activo ? "Desactivar" : "Activar") + "</button></td></tr>";
        }).join("");
    }

    function abrirNuevo() {
        $("dsa-forma").reset();
        $("dsa-cuenta").hidden = true;
        $("dsa-error").hidden = true;
        $("dsa-dlg").showModal();
        $("dsa-nombre").focus();
    }

    async function crear() {
        var existente = document.querySelector('input[name="dsa-cuenta"]:checked').value === "existente";
        var cuerpo = { nombre: $("dsa-nombre").value.trim(), titular: $("dsa-titular").value.trim().toLowerCase(),
                       cuenta: existente ? $("dsa-cuenta").value.trim().toLowerCase() : "" };
        function error(t) { $("dsa-error").textContent = t; $("dsa-error").hidden = false; }
        if (!cuerpo.nombre) return error("Ponle nombre al despacho.");
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cuerpo.titular)) return error("Escribe el correo del titular.");
        if (existente && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cuerpo.cuenta)) return error("Escribe el correo de la cuenta donde están sus empresas.");
        var b = $("dsa-crear");
        b.classList.add("ui-btn--cargando");
        try {
            await api("/api/admin/despachos", "POST", cuerpo);
            $("dsa-dlg").close();
            avisar("success", "Despacho «" + cuerpo.nombre + "» creado. " + cuerpo.titular + " ya lo administra desde Mi despacho (menú con su nombre).");
            cargar();
        } catch (e) { error(e.message); } finally { b.classList.remove("ui-btn--cargando"); }
    }

    async function cambiarTope(id) {
        var d = lista.filter(function (x) { return x.id === +id; })[0];
        var actual = d.ajustes && d.ajustes.empresas_personales;
        var v = prompt("¿Cuántas empresas puede tener en Mi espacio quien usa la licencia del despacho? (vacío = sin tope)", actual == null ? "" : actual);
        if (v === null) return;
        v = v.trim();
        if (v && !/^\d{1,4}$/.test(v)) return avisar("error", "Escribe un número, o déjalo vacío para no poner tope.");
        try { await api("/api/admin/despachos/" + id, "PUT", { empresas_personales: v }); cargar(); } catch (e) { avisar("error", e.message); }
    }

    async function activar(id, valor) {
        if (valor === "0" && !confirm("¿Desactivar el despacho? Su equipo deja de ver sus empresas (nada se borra) y cada quien queda en su Mi espacio.")) return;
        try { await api("/api/admin/despachos/" + id, "PUT", { activo: valor === "1" }); cargar(); } catch (e) { avisar("error", e.message); }
    }

    async function verComo(cuenta) {
        try { await api("/api/admin/ver-como", "POST", { correo: cuenta }); location.href = "/clientes/"; } catch (e) { avisar("error", e.message); }
    }

    $("dsa-nuevo").addEventListener("click", abrirNuevo);
    $("dsa-crear").addEventListener("click", crear);
    $("dsa-forma").addEventListener("submit", function (e) { e.preventDefault(); crear(); });
    $("dsa-forma").addEventListener("change", function (e) {
        if (e.target.name === "dsa-cuenta") $("dsa-cuenta").hidden = e.target.value !== "existente";
    });
    $("dsa-dlg").addEventListener("click", function (e) { if (e.target.closest("[data-dsa-cerrar]") || e.target === this) this.close(); });
    $("dsa-lista").addEventListener("click", function (e) {
        var b = e.target.closest("[data-tope],[data-activo],[data-ver-cuenta]");
        if (!b) return;
        if (b.dataset.tope) cambiarTope(b.dataset.tope);
        else if (b.dataset.activo) activar(b.dataset.activo, b.dataset.valor);
        else verComo(b.dataset.verCuenta);
    });

    window.DespachosAdmin = { cargar: cargar };
})();
