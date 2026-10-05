/*
 * herramientas/listas-sat/listas-sat.js — Panel "Listas del SAT".
 *
 * Buscar un RFC, ver cuáles de tus proveedores y clientes aparecen (por
 * empresa o todas), los cambios recientes y el estado de cada listado.
 * Actualizar a mano y el enlace del 49 Bis: solo admin.
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var GRAVEDAD = { grave: "Grave", alerta: "Revisar", informativo: "Informativo" };

    async function api(ruta, opciones) {
        var resp = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!resp.ok) throw new Error(await Fiscontable.leerError(resp));
        return resp.json();
    }

    function aviso(texto, error) {
        var a = $("aviso");
        a.textContent = texto;
        a.className = "ls-aviso" + (error ? " ls-aviso--error" : "");
        a.hidden = !texto;
    }

    function dmy(iso) {
        return iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "";
    }

    function hace(iso) {
        if (!iso) return "";
        var t = new Date(/([zZ]|[+-]\d\d:\d\d)$/.test(iso) ? iso : iso + "Z");
        var min = Math.round((Date.now() - t) / 60000);
        if (min < 60) return "hace " + Math.max(min, 1) + " min";
        var h = Math.round(min / 60);
        return h < 48 ? "hace " + h + " h" : "hace " + Math.round(h / 24) + " días";
    }

    function dinero(v) {
        return Number(v || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
    }

    function sellos(listas) {
        return '<div class="ls-sellos">' + listas.map(function (h) {
            var fecha = h.fecha ? " · " + esc(h.fecha_tipo || "") + " " + dmy(h.fecha) : "";
            return '<span class="ls-sello ls-sello--' + h.gravedad + '" title="' + esc(h.descripcion || "") + " · " + GRAVEDAD[h.gravedad] + '">' +
                esc(h.nombre_lista) + ": " + esc(h.situacion) + fecha + "</span>";
        }).join("") + "</div>";
    }

    // ------------------------------------------------------------ buscar
    async function buscar(e) {
        e.preventDefault();
        var rfc = $("rfc-buscar").value.trim().toUpperCase();
        var caja = $("resultado-buscar");
        caja.hidden = false;
        caja.innerHTML = '<p class="ls-nota">Buscando…</p>';
        try {
            var r = await api("/api/listas-sat/buscar?rfc=" + encodeURIComponent(rfc));
            var listas = Object.keys(r.fechas || {}).length;
            if (!r.listas.length) {
                caja.innerHTML = '<p class="ls-limpio">✓ ' + esc(r.rfc) + " no aparece en ninguna de las " + listas + " listas descargadas.</p>";
            } else {
                caja.innerHTML = '<div class="ls-item"><div class="ls-item__principal"><p class="ls-item__nombre">' + esc(r.listas[0].nombre || r.rfc) +
                    '</p><p class="ls-rfc">' + esc(r.rfc) + "</p>" + sellos(r.listas) + "</div></div>";
            }
            if (r.cambios.length) {
                caja.innerHTML += '<p class="ls-nota">Historial: ' + r.cambios.map(function (c) { return dmy(c.momento) + " " + textoCambio(c); }).map(esc).join(" · ") + "</p>";
            }
        } catch (err) {
            caja.innerHTML = '<p class="ls-nota">' + esc(err.message) + "</p>";
        }
    }

    // ------------------------------------------------------------ contrapartes
    async function cargarContrapartes() {
        var rfc = $("sel-empresa").value;
        $("texto-contrapartes").textContent = "Revisando…";
        $("lista-contrapartes").innerHTML = "";
        try {
            var r = await api("/api/listas-sat/mis-contrapartes" + (rfc ? "?rfc=" + encodeURIComponent(rfc) : ""));
            var n = r.contrapartes.length;
            $("texto-contrapartes").textContent = !r.revisadas
                ? "Todavía no hay XML cargados para revisar."
                : n ? n + " de " + r.revisadas + " proveedores y clientes revisados aparecen en alguna lista."
                    : "Ninguno de tus " + r.revisadas + " proveedores y clientes aparece en las listas. ✓";
            $("lista-contrapartes").innerHTML = r.contrapartes.map(function (c) {
                return '<div class="ls-item"><div class="ls-item__principal">' +
                    '<p class="ls-item__nombre">' + esc(c.nombre || c.rfc) + "</p>" +
                    '<p class="ls-item__meta"><span class="ls-rfc">' + esc(c.rfc) + "</span> · " + (c.papel === "proveedor" ? "Proveedor" : "Cliente") +
                    " de " + esc(c.empresa) + "</p>" + sellos(c.listas) + "</div>" +
                    '<div class="ls-item__cifras">' + esc(c.cfdi) + " CFDI vigentes · " + esc(dinero(c.total)) +
                    (c.desde ? "<br>" + esc(dmy(c.desde)) + " a " + esc(dmy(c.hasta)) : "") + "</div></div>";
            }).join("");
            pintarCambios(r.cambios);
        } catch (err) {
            $("texto-contrapartes").textContent = err.message;
        }
    }

    function textoCambio(c) {
        if (!c.antes) return "entró a " + c.nombre_lista + " (" + c.despues + ")";
        if (!c.despues) return "salió de " + c.nombre_lista + " (era " + c.antes + ")";
        return "en " + c.nombre_lista + " pasó de " + c.antes + " a " + c.despues;
    }

    function pintarCambios(cambios) {
        $("lista-cambios").innerHTML = cambios.length ? cambios.map(function (c) {
            return '<p class="ls-cambio"><time>' + esc(dmy(c.momento)) + "</time><strong>" + esc(c.nombre || c.rfc) +
                '</strong> <span class="ls-rfc">' + esc(c.rfc) + "</span> " + esc(textoCambio(c)) + "</p>";
        }).join("") : '<p class="ls-nota">Sin cambios en tus proveedores y clientes.</p>';
    }

    // ------------------------------------------------------------ actualización
    /* Una línea con la fecha de las listas y "Buscar actualizaciones" (para todos). El detalle de
       cada lista, los errores y el enlace del 49 Bis están en Administración → Sistema. */
    var antesDeBuscar = null;

    function resumenListas(e) {
        var fechas = e.listas.map(function (l) { return l.actualizado_al; }).filter(Boolean).sort();
        var revisadas = e.listas.map(function (l) { return l.revisada_en; }).filter(Boolean).sort();
        if (!revisadas.length) return "Las listas todavía no se descargan.";
        return "Listas actualizadas al " + dmy(fechas[fechas.length - 1] || revisadas[revisadas.length - 1]) +
            " · revisadas con el SAT " + hace(revisadas[0]);
    }

    async function cargarEstado() {
        try {
            var e = await api("/api/listas-sat/estado");
            $("texto-actualizacion").textContent = e.actualizando ? "Buscando actualizaciones en el SAT…" : resumenListas(e);
            $("btn-buscar-act").disabled = e.actualizando;
            if (e.actualizando) { setTimeout(cargarEstado, 8000); return; }
            if (antesDeBuscar) {                       // terminó una búsqueda que pidió esta persona
                var cambiaron = e.listas.filter(function (l) { return l.cambiada_en && l.cambiada_en !== antesDeBuscar[l.lista]; });
                antesDeBuscar = null;
                aviso(cambiaron.length ? "Se actualizaron: " + cambiaron.map(function (l) { return l.nombre; }).join(", ") + "."
                                       : "Las listas ya estaban actualizadas: el SAT no ha publicado nada nuevo.");
                if (cambiaron.length) cargarContrapartes();
            }
        } catch (err) {
            $("texto-actualizacion").textContent = err.message;
        }
    }

    async function buscarActualizaciones() {
        var boton = $("btn-buscar-act");
        boton.disabled = true;
        try {
            var previo = await api("/api/listas-sat/estado");
            var r = await api("/api/listas-sat/buscar-actualizaciones", { method: "POST" });
            if (r.estado === "al_dia") {
                aviso(r.mensaje);
                boton.disabled = false;
                return;
            }
            antesDeBuscar = {};
            previo.listas.forEach(function (l) { antesDeBuscar[l.lista] = l.cambiada_en; });
            aviso(r.mensaje);
            $("texto-actualizacion").textContent = "Buscando actualizaciones en el SAT…";
            setTimeout(cargarEstado, 4000);
        } catch (err) {
            aviso(err.message, true);
            boton.disabled = false;
        }
    }

    async function empresas() {
        try {
            var lista = await api("/api/xml/contribuyentes");
            var sel = $("sel-empresa");
            lista.forEach(function (c) {
                var o = document.createElement("option");
                o.value = c.rfc;
                o.textContent = (c.alias || c.nombre || c.rfc) + " · " + c.rfc;
                sel.appendChild(o);
            });
            var p = await Fiscontable.perfil();
            var activa = p && p.empresa_activa && p.empresa_activa.rfc;
            if (activa && lista.some(function (c) { return c.rfc === activa; })) sel.value = activa;
        } catch (err) { /* el selector queda en "Todas mis empresas" */ }
    }

    document.addEventListener("DOMContentLoaded", async function () {
        $("form-buscar").addEventListener("submit", buscar);
        $("btn-buscar-act").addEventListener("click", buscarActualizaciones);
        $("sel-empresa").addEventListener("change", cargarContrapartes);
        var rfc = new URLSearchParams(location.search).get("rfc");
        if (rfc) { $("rfc-buscar").value = rfc; buscar(new Event("submit")); }
        cargarEstado();
        await empresas();
        cargarContrapartes();
    });
})();
