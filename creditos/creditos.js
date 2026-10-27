/*
 * creditos/creditos.js — Mis créditos: saldo, recargar (paquetes o monto libre),
 * reportar el pago y ver el historial. 1 crédito = $1.
 *
 * Fase 1: el pago reportado lo revisa un administrador (Administración → Créditos).
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var BANCOS = ["BBVA", "Santander", "Banorte", "Banamex", "HSBC", "Scotiabank", "Inbursa", "Azteca", "BanCoppel", "Banregio",
                  "Afirme", "BanBajío", "Mercado Pago", "Nu", "Spin by OXXO", "Klar", "Hey Banco", "Albo", "Fondeadora", "Ualá", "STP", "Otro"];
    var E = { datos: null, eleccion: null };     // eleccion: {tipo:"paquete", i} o {tipo:"libre"}

    function m(v) { return Number(v || 0).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
    function fecha(iso) {
        if (!iso) return "";
        var d = new Date(iso.length > 10 && !/Z$/.test(iso) ? iso + "Z" : iso);
        return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) +
            (iso.length > 10 ? " " + d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "");
    }
    function aviso(texto, error) { var a = $("aviso"); a.textContent = texto || ""; a.className = "cr-aviso" + (error ? " cr-aviso--error" : ""); a.hidden = !texto; }

    async function cargar() {
        try {
            var r = await fetch(API + "/api/creditos", { credentials: "include" });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            E.datos = await r.json();
        } catch (e) { aviso(e.message || "No se pudo cargar tu saldo.", true); return; }
        pintar();
    }

    function pintar() {
        var d = E.datos, c = d.config;
        $("saldo").textContent = m(d.saldo);
        $("en-proceso").hidden = !d.en_proceso;
        $("en-proceso").textContent = d.en_proceso ? m(d.en_proceso) + " créditos apartados en trámites en curso." : "";
        // Paquetes + monto libre
        $("paquetes").innerHTML = c.paquetes.map(function (p, i) {
            var ahorro = p.creditos - p.precio;
            return '<button type="button" class="cr-paquete" role="radio" data-i="' + i + '" aria-checked="false">' +
                "<b>" + m(p.creditos) + " créditos</b><span>pagas $" + m(p.precio) + "</span>" +
                (ahorro > 0 ? "<em>Ahorras $" + m(ahorro) + "</em>" : "") + "</button>";
        }).join("") + '<div class="cr-paquete" role="radio" data-libre="1" aria-checked="false" tabindex="0">' +
            "<b>Otra cantidad</b><span>desde $" + m(c.minimo) + "</span>" +
            '<input type="number" id="libre" min="' + c.minimo + '" step="1" placeholder="$ ' + c.minimo + '"></div>';
        // Cuentas
        $("cuentas").innerHTML = c.cuentas.length ? c.cuentas.map(function (k) {
            return '<div class="cr-cuenta"><b>' + esc(k.banco || "Cuenta") + "</b>" + (k.titular ? esc(k.titular) + "<br>" : "") +
                (k.clabe ? 'CLABE <code>' + esc(k.clabe) + '</code><button type="button" class="cr-copiar" data-copiar="' + esc(k.clabe) + '">Copiar</button><br>' : "") +
                (k.tarjeta ? 'Tarjeta <code>' + esc(k.tarjeta) + '</code><button type="button" class="cr-copiar" data-copiar="' + esc(k.tarjeta) + '">Copiar</button><br>' : "") +
                (k.nota ? '<span class="cr-nota">' + esc(k.nota) + "</span>" : "") + "</div>";
        }).join("") : '<p class="cr-nota">Pide a soporte los datos para depositar.</p>';
        $("instrucciones").hidden = !c.instrucciones;
        $("instrucciones").textContent = c.instrucciones || "";
        $("p-cuenta").innerHTML = c.cuentas.map(function (k) {
            var t = [k.banco, k.clabe || k.tarjeta].filter(Boolean).join(" · ");
            return '<option value="' + esc(t) + '">' + esc(t) + "</option>";
        }).join("");
        $("caja-cuenta").hidden = c.cuentas.length < 2;
        pintarPagos();
        pintarMovimientos();
        recibes();
    }

    function pintarPagos() {
        var filas = E.datos.pagos;
        var nombre = { pendiente: "Por revisar", aprobado: "Aprobado", rechazado: "Rechazado" };
        $("pagos").innerHTML = filas.length ? filas.map(function (p) {
            return "<tr><td>" + fecha(p.creado_en) + "</td><td>" + esc(p.banco_emisor || "") + '<br><span class="cr-nota">' + esc(p.clave_rastreo || "") +
                "</span></td><td class=\"num\">$" + m(p.monto) + '</td><td class="num">' + m(p.creditos) + "</td><td>" +
                '<span class="cr-sello cr-sello--' + p.estado + '">' + nombre[p.estado] + "</span>" +
                (p.motivo ? '<br><span class="cr-nota">' + esc(p.motivo) + "</span>" : "") +
                (p.tiene_comprobante ? '<br><a class="cr-copiar" style="margin:0" href="' + API + "/api/creditos/pagos/" + p.id + '/comprobante" target="_blank" rel="noopener">Comprobante</a>' : "") +
                "</td></tr>";
        }).join("") : '<tr><td colspan="5" class="cr-vacio">Todavía no has reportado pagos.</td></tr>';
    }

    function pintarMovimientos() {
        var filas = E.datos.movimientos;
        var estado = { apartado: " (en proceso)", cobrado: "", devuelto: " (devuelto)" };
        $("movimientos").innerHTML = filas.length ? filas.map(function (x) {
            return "<tr><td>" + fecha(x.creado_en) + "</td><td>" + esc(x.concepto || "") + (x.tipo === "apartado" ? esc(estado[x.estado] || "") : "") +
                '</td><td class="num ' + (x.monto >= 0 ? "cr-mas" : "cr-menos") + '">' + (x.monto > 0 ? "+" : "") + m(x.monto) + "</td></tr>";
        }).join("") : '<tr><td colspan="3" class="cr-vacio">Sin movimientos.</td></tr>';
    }

    /* Lo que se va a recibir con el monto escrito (paquete exacto o 1 a 1) */
    function creditosPor(monto) {
        var c = E.datos.config;
        var p = c.paquetes.find(function (x) { return Math.abs(x.precio - monto) < 0.005; });
        if (p) return { creditos: p.creditos, paquete: true };
        if (monto >= c.minimo && monto === Math.floor(monto)) return { creditos: monto, paquete: false };
        return null;
    }
    function recibes() {
        var monto = +$("p-monto").value;
        var r = monto ? creditosPor(monto) : null;
        $("p-recibes").textContent = !monto ? "Elige un paquete o escribe el monto que pagaste." :
            r ? "Recibes " + m(r.creditos) + " créditos" + (r.paquete ? " (paquete)." : ".") : "La recarga mínima es de $" + m(E.datos.config.minimo) + ", sin centavos.";
    }

    function elegir(nodo) {
        document.querySelectorAll(".cr-paquete").forEach(function (b) { b.setAttribute("aria-checked", b === nodo ? "true" : "false"); });
        if (nodo.dataset.libre) {
            $("p-monto").value = $("libre").value || "";
            $("libre").focus();
        } else {
            $("p-monto").value = E.datos.config.paquetes[+nodo.dataset.i].precio;
        }
        recibes();
    }

    async function enviar(e) {
        e.preventDefault();
        $("p-error").hidden = true;
        var monto = +$("p-monto").value;
        if (!creditosPor(monto)) { $("p-error").textContent = $("p-recibes").textContent; $("p-error").hidden = false; return; }
        var fd = new FormData();
        fd.append("monto", String(monto));
        fd.append("banco", $("p-banco").value.trim());
        fd.append("clave_rastreo", $("p-clave").value.trim());
        fd.append("fecha_pago", $("p-fecha").value);
        fd.append("cuenta", $("p-cuenta").value || "");
        if ($("p-comprobante").files[0]) fd.append("comprobante", $("p-comprobante").files[0]);
        var b = $("p-enviar"); b.disabled = true;
        try {
            var r = await fetch(API + "/api/creditos/pagos", { method: "POST", credentials: "include", body: fd });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            var p = await r.json();
            $("form-pago").reset();
            $("p-fecha").value = hoy();
            aviso("Pago reportado: " + m(p.creditos) + " créditos por revisar. Te aparecen en cuanto se valide.");
            window.scrollTo({ top: 0, behavior: "smooth" });
            await cargar();
        } catch (err) { $("p-error").textContent = err.message; $("p-error").hidden = false; }
        b.disabled = false;
    }

    function hoy() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

    function eventos() {
        $("paquetes").addEventListener("click", function (e) { var n = e.target.closest(".cr-paquete"); if (n) elegir(n); });
        $("paquetes").addEventListener("input", function (e) {
            if (e.target.id === "libre") { $("p-monto").value = e.target.value; recibes(); }
        });
        $("p-monto").addEventListener("input", recibes);
        $("cuentas").addEventListener("click", function (e) {
            var b = e.target.closest("[data-copiar]"); if (!b) return;
            try { navigator.clipboard.writeText(b.dataset.copiar); b.textContent = "Copiado"; setTimeout(function () { b.textContent = "Copiar"; }, 1500); } catch (x) { /* nada */ }
        });
        $("form-pago").addEventListener("submit", enviar);
    }

    document.addEventListener("DOMContentLoaded", function () {
        $("bancos").innerHTML = BANCOS.map(function (b) { return '<option value="' + b + '">'; }).join("");
        $("p-fecha").value = hoy();
        $("p-fecha").max = hoy();
        eventos();
        cargar();
    });
})();
