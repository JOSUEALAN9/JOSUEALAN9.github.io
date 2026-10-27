/*
 * admin/creditos-admin.js — Pestaña Créditos de Administración: pagos reportados
 * por revisar (aprobar / rechazar), saldos (ajuste manual) y la configuración
 * (recarga mínima, paquetes y cuentas para depositar).
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var datos = null;

    function m(v) { return Number(v || 0).toLocaleString("es-MX", { maximumFractionDigits: 2 }); }
    function fecha(iso) { return iso ? new Date(iso.length > 10 && !/Z$/.test(iso) ? iso + "Z" : iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; }
    async function api(ruta, metodo, cuerpo) {
        var r = await fetch(API + ruta, { method: metodo || "GET", credentials: "include",
            headers: cuerpo ? { "Content-Type": "application/json" } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function avisar(tipo, texto) { if (typeof mostrarAlerta === "function") mostrarAlerta(tipo, texto); else alert(texto); }

    async function cargar() {
        try { datos = await api("/api/admin/creditos"); } catch (e) { avisar("error", e.message); return; }
        pintarPendientes();
        pintarSaldos();
        pintarConfig();
    }

    function contar(n) { $("cuenta-creditos").textContent = n ? "(" + n + ")" : ""; $("cra-n").textContent = n ? "(" + n + ")" : ""; }

    function pintarPendientes() {
        var p = datos.pendientes;
        contar(p.length);
        $("cra-pendientes").innerHTML = p.length ? p.map(function (x) {
            return "<tr><td>" + esc(x.correo) + "<br><small>" + fecha(x.creado_en) + "</small></td>" +
                "<td>$" + m(x.monto) + "<br><small>" + esc(x.fecha_pago || "") + (x.paquete ? " · paquete" : "") + "</small></td>" +
                "<td>" + esc(x.banco_emisor || "") + "<br><small>" + esc(x.clave_rastreo || "") + (x.cuenta ? " → " + esc(x.cuenta) : "") + "</small>" +
                (x.tiene_comprobante ? '<br><a class="cra-enlace" target="_blank" rel="noopener" href="' + API + "/api/creditos/pagos/" + x.id + '/comprobante">Ver comprobante</a>' : "<br><small>Sin comprobante</small>") + "</td>" +
                '<td class="num"><b>' + m(x.creditos) + "</b></td>" +
                '<td><div class="cra-acciones"><button type="button" class="cra-btn cra-btn--si" data-aprobar="' + x.id + '">Aprobar</button>' +
                '<button type="button" class="cra-btn cra-btn--no" data-rechazar="' + x.id + '">Rechazar</button></div></td></tr>';
        }).join("") : '<tr><td colspan="5" class="cra-vacio">No hay pagos por revisar.</td></tr>';
    }

    function pintarSaldos() {
        var q = ($("cra-buscar").value || "").trim().toLowerCase();
        var filas = datos.saldos.filter(function (s) { return !q || s.correo.indexOf(q) !== -1; });
        $("cra-saldos").innerHTML = filas.map(function (s) {
            return "<tr><td>" + esc(s.correo) + (s.nombre ? "<br><small>" + esc(s.nombre) + "</small>" : "") + "</td>" +
                '<td class="num"><b>' + m(s.saldo) + '</b></td><td class="num">' + (s.apartado ? m(s.apartado) : "") + "</td>" +
                '<td><div class="cra-acciones"><button type="button" class="cra-btn" data-ajustar="' + esc(s.correo) + '">Sumar / quitar</button></div></td></tr>';
        }).join("") || '<tr><td colspan="4" class="cra-vacio">Sin usuarios.</td></tr>';
    }

    function filaPaquete(p) {
        return '<div class="cra-fila" data-paquete><input type="number" min="1" step="1" placeholder="Créditos" value="' + (p.creditos || "") + '" style="width:120px">' +
            ' créditos por $ <input type="number" min="1" step="0.01" placeholder="Precio" value="' + (p.precio || "") + '" style="width:110px">' +
            '<button type="button" class="cra-quitar" title="Quitar">×</button></div>';
    }
    function filaCuenta(c) {
        return '<div class="cra-fila" data-cuenta>' + ["banco", "titular", "clabe", "tarjeta", "nota"].map(function (k) {
            return '<input data-k="' + k + '" placeholder="' + { banco: "Banco", titular: "Titular", clabe: "CLABE", tarjeta: "Tarjeta", nota: "Nota" }[k] +
                '" value="' + esc(c[k] || "") + '" style="width:' + (k === "nota" ? 200 : k === "clabe" ? 190 : 140) + 'px">';
        }).join("") + '<button type="button" class="cra-quitar" title="Quitar">×</button></div>';
    }
    function pintarConfig() {
        var c = datos.config;
        $("cra-minimo").value = c.minimo;
        $("cra-paquetes").innerHTML = c.paquetes.map(filaPaquete).join("");
        $("cra-cuentas").innerHTML = c.cuentas.map(filaCuenta).join("");
        $("cra-instrucciones").value = c.instrucciones || "";
        $("cra-config-msj").textContent = "";
    }

    async function guardarConfig() {
        var cuerpo = {
            minimo: +$("cra-minimo").value,
            paquetes: Array.from(document.querySelectorAll("[data-paquete]")).map(function (f) {
                var i = f.querySelectorAll("input"); return { creditos: +i[0].value, precio: +i[1].value };
            }).filter(function (p) { return p.creditos || p.precio; }),
            cuentas: Array.from(document.querySelectorAll("[data-cuenta]")).map(function (f) {
                var o = {}; f.querySelectorAll("input").forEach(function (i) { o[i.dataset.k] = i.value; }); return o;
            }),
            instrucciones: $("cra-instrucciones").value
        };
        var msj = $("cra-config-msj");
        try {
            datos.config = await api("/api/admin/creditos/config", "PUT", cuerpo);
            pintarConfig();
            msj.textContent = "Guardado."; msj.className = "text-xs mt-2 text-emerald-700 font-semibold";
        } catch (e) { msj.textContent = e.message; msj.className = "text-xs mt-2 text-red-600 font-semibold"; }
    }

    async function accion(e) {
        var b = e.target.closest("[data-aprobar],[data-rechazar],[data-ajustar]");
        if (!b) return;
        try {
            if (b.dataset.aprobar) {
                var x = datos.pendientes.find(function (p) { return String(p.id) === b.dataset.aprobar; });
                var cr = prompt("¿Cuántos créditos abonar a " + x.correo + "? (pagó $" + m(x.monto) + ")", x.creditos);
                if (cr === null) return;
                await api("/api/admin/creditos/pagos/" + x.id + "/aprobar", "POST", { creditos: +cr });
                avisar("ok", "Recarga aprobada: " + m(cr) + " créditos para " + x.correo + ".");
            } else if (b.dataset.rechazar) {
                var motivo = prompt("Motivo del rechazo (lo ve el usuario):", "No encontramos el depósito con esa clave de rastreo.");
                if (!motivo) return;
                await api("/api/admin/creditos/pagos/" + b.dataset.rechazar + "/rechazar", "POST", { motivo: motivo });
                avisar("ok", "Pago rechazado.");
            } else {
                var monto = prompt("Créditos para " + b.dataset.ajustar + " (positivo suma, negativo quita):", "");
                if (!monto || !+monto) return;
                var concepto = prompt("Concepto (lo ve el usuario):", +monto > 0 ? "Abono" : "Cargo") || "";
                var r = await api("/api/admin/creditos/ajuste", "POST", { correo: b.dataset.ajustar, monto: Math.trunc(+monto), concepto: concepto });
                avisar("ok", "Nuevo saldo de " + r.correo + ": " + m(r.saldo) + " créditos.");
            }
            await cargar();
        } catch (err) { avisar("error", err.message); }
    }

    document.addEventListener("DOMContentLoaded", function () {
        $("panel-creditos").addEventListener("click", accion);
        $("cra-buscar").addEventListener("input", function () { if (datos) pintarSaldos(); });
        $("cra-mas-paquete").addEventListener("click", function () { $("cra-paquetes").insertAdjacentHTML("beforeend", filaPaquete({})); });
        $("cra-mas-cuenta").addEventListener("click", function () { $("cra-cuentas").insertAdjacentHTML("beforeend", filaCuenta({})); });
        $("panel-creditos").addEventListener("click", function (e) { var q = e.target.closest(".cra-quitar"); if (q) q.parentNode.remove(); });
        $("cra-guardar-config").addEventListener("click", guardarConfig);
        // Cuántos pagos esperan revisión, en la pestaña (sin abrirla)
        setTimeout(function () {
            api("/api/admin/creditos").then(function (d) { datos = d; contar(d.pendientes.length); }).catch(function () { /* no es admin */ });
        }, 1200);
    });

    window.CreditosAdmin = { cargar: cargar };
})();
