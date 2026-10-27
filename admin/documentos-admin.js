/*
 * admin/documentos-admin.js — Pestaña Documentos de Administración: saldo en UnlockerFast,
 * pedidos que no se resolvieron solos (reintentar / devolver créditos), catálogo con
 * precio en créditos y todos los pedidos.
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var datos = null;

    function m(v, dec) { return Number(v || 0).toLocaleString("es-MX", { minimumFractionDigits: dec || 0, maximumFractionDigits: dec == null ? 2 : dec }); }
    function fecha(iso) { return iso ? new Date(iso.length > 10 && !/Z$/.test(iso) ? iso + "Z" : iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; }
    async function api(ruta, metodo, cuerpo) {
        var r = await fetch(API + ruta, { method: metodo || "GET", credentials: "include",
            headers: cuerpo ? { "Content-Type": "application/json" } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function avisar(tipo, texto) { if (typeof mostrarAlerta === "function") mostrarAlerta(tipo, texto); else alert(texto); }

    async function cargar() {
        try { datos = await api("/api/admin/documentos"); } catch (e) { avisar("error", e.message); return; }
        var sel = $("dca-estado");
        if (sel.options.length === 1) {
            Object.keys(datos.estados).forEach(function (k) { sel.insertAdjacentHTML("beforeend", '<option value="' + esc(k) + '">' + esc(datos.estados[k]) + "</option>"); });
        }
        pintarResumen();
        pintarRevisar();
        pintarCatalogo();
        pintarPedidos();
    }

    function pintarSaldo(s) {
        $("dca-saldo").textContent = !s.configurado ? "Sin configurar" : s.saldo == null ? "—" : "$" + m(s.saldo, 2);
        $("dca-saldo-cuando").textContent = !s.configurado ? "Faltan UNLOCKER_USER y UNLOCKER_KEY en /etc/fiscontable.env" :
            s.cuando ? "Visto " + fecha(s.cuando) + (s.bajo ? " · recarga en el panel del proveedor" : "") : "Aún sin consultar";
        $("dca-saldo-caja").classList.toggle("dca-tarjeta--alerta", !s.configurado || !!s.bajo);
    }

    function pintarResumen() {
        var r = datos.resumen;
        pintarSaldo(datos.saldo_proveedor);
        $("dca-entregados").textContent = m(r.entregados);
        $("dca-en-curso").textContent = r.en_curso ? r.en_curso + " en curso ahora" : "";
        $("dca-cobrado").textContent = m(r.creditos) + " créditos";
        $("dca-costo").textContent = "Costo del proveedor $" + m(r.costo, 2);
        $("cuenta-documentos").textContent = r.revisar ? "(" + r.revisar + ")" : "";
    }

    function pintarRevisar() {
        var filas = datos.pedidos.filter(function (p) { return p.estado === "revisar"; });
        $("dca-revisar-caja").hidden = !filas.length;
        $("dca-n-revisar").textContent = filas.length ? "(" + filas.length + ")" : "";
        $("dca-revisar").innerHTML = filas.map(function (p) {
            return "<tr><td>" + p.id + "<br><small>" + fecha(p.creado_en) + "</small></td>" +
                "<td>" + esc(p.correo) + "</td>" +
                "<td>" + esc(p.servicio) + "<br><small>" + esc(p.titular) + (p.referenceid ? " · proveedor " + esc(p.referenceid) : " · sin folio del proveedor") + "</small></td>" +
                "<td>" + esc(p.motivo) + "</td>" +
                '<td><div class="cra-acciones">' + (p.referenceid ? '<button type="button" class="cra-btn" data-reintentar="' + p.id + '">Reintentar</button>' : "") +
                '<button type="button" class="cra-btn cra-btn--no" data-devolver="' + p.id + '">Devolver' + (p.precio ? " " + m(p.precio) + " créditos" : "") + "</button></div></td></tr>";
        }).join("");
    }

    function pintarCatalogo() {
        var cat = null;
        $("dca-catalogo").innerHTML = datos.servicios.map(function (s) {
            var cab = s.categoria !== cat ? '<tr class="dca-cat"><td colspan="6">' + esc(s.categoria) + "</td></tr>" : "";
            cat = s.categoria;
            var ganancia = s.precio - s.costo;
            var extras = s.extras.map(function (e) { return e.etiqueta; });
            return cab + '<tr data-sid="' + s.serviceid + '"' + (s.activo ? "" : ' class="dca-inactivo"') + ">" +
                '<td><input type="checkbox" data-campo="activo"' + (s.activo ? " checked" : "") + ' aria-label="Activo"></td>' +
                '<td><b class="dca-nombre">' + esc(s.nombre) + '</b> <button type="button" class="dca-renombrar" data-renombrar="' + s.serviceid + '" title="Cambiar nombre" aria-label="Cambiar nombre">✎</button>' +
                "<br><small>ID " + s.serviceid + " · pide " + esc([s.principal.etiqueta].concat(extras).join(" + ")) + (s.tiempo ? " · " + esc(s.tiempo) : "") + "</small></td>" +
                '<td class="num">$' + m(s.costo, 2) + "</td>" +
                '<td class="num"><input type="number" data-campo="precio" class="cra-control dca-precio" min="1" step="1" value="' + s.precio + '"></td>' +
                '<td class="num ' + (ganancia < 0 ? "dca-pierde" : "") + '">' + (ganancia < 0 ? "−" : "") + "$" + m(Math.abs(ganancia), 2) + "</td>" +
                "<td>" + (s.probado ? '<span class="dca-sello dca-sello--ok">Probado</span>' : '<span class="dca-sello dca-sello--revisar">Sin probar</span>') +
                (s.nota ? "<br><small>" + esc(s.nota) + "</small>" : "") + "</td></tr>";
        }).join("");
    }

    function pintarPedidos() {
        var q = ($("dca-buscar").value || "").trim().toLowerCase(), est = $("dca-estado").value;
        var filas = datos.pedidos.filter(function (p) {
            if (est && p.estado !== est) return false;
            if (!q) return true;
            return [p.correo, p.titular, p.servicio, p.nota, p.referenceid, String(p.id)].join(" ").toLowerCase().indexOf(q) !== -1;
        });
        $("dca-pedidos").innerHTML = filas.length ? filas.map(function (p) {
            return "<tr><td>" + p.id + "<br><small>" + fecha(p.creado_en) + "</small></td>" +
                "<td>" + esc(p.correo) + "</td>" +
                "<td>" + esc(p.servicio) + (p.nota ? "<br><small>" + esc(p.nota) + "</small>" : "") + "</td>" +
                '<td class="dca-dato">' + esc(p.titular) + "</td>" +
                '<td class="num">' + (p.precio ? m(p.precio) : "—") + "</td>" +
                '<td class="num">' + (p.costo != null ? "$" + m(p.costo, 2) : "") + "</td>" +
                '<td><span class="dca-sello dca-sello--' + esc(p.estado) + '">' + esc(p.estado_texto) + "</span>" +
                (p.referenceid ? "<br><small>Proveedor " + esc(p.referenceid) + "</small>" : "") +
                (p.motivo && p.estado !== "entregado" ? "<br><small>" + esc(p.motivo) + "</small>" : "") +
                (p.tiene_archivo ? '<br><button type="button" class="cra-enlace" data-bajar="' + p.id + '">Descargar</button>' : "") + "</td></tr>";
        }).join("") : '<tr><td colspan="7" class="cra-vacio">Sin pedidos.</td></tr>';
    }

    async function guardarServicio(input, nombre) {
        var fila = input.closest("tr[data-sid]"), sid = Number(fila.dataset.sid), campo = nombre != null ? "nombre" : input.dataset.campo, cuerpo = {};
        cuerpo[campo] = nombre != null ? nombre : campo === "activo" ? input.checked : Number(input.value);
        input.disabled = true;
        try {
            var s = await api("/api/admin/documentos/servicios/" + sid, "PUT", cuerpo);
            datos.servicios = datos.servicios.map(function (x) { return x.serviceid === sid ? s : x; });
            pintarCatalogo();
            var nuevo = $("dca-catalogo").querySelector('tr[data-sid="' + sid + '"]');
            if (nuevo) { nuevo.classList.add("dca-guardado"); setTimeout(function () { nuevo.classList.remove("dca-guardado"); }, 1200); }
        } catch (e) {
            avisar("error", e.message);
            pintarCatalogo();
        }
    }

    async function accion(e) {
        var b = e.target.closest("button");
        if (!b) return;
        try {
            if (b.dataset.renombrar) {
                var s = datos.servicios.filter(function (x) { return x.serviceid === Number(b.dataset.renombrar); })[0];
                var nombre = prompt("Nombre que ven los usuarios:", s.nombre);
                if (nombre && nombre.trim() && nombre.trim() !== s.nombre) await guardarServicio(b, nombre.trim());
            } else if (b.dataset.devolver) {
                var motivo = prompt("¿Devolver los créditos y cerrar el pedido " + b.dataset.devolver + "? Motivo (lo ve el usuario):",
                    "No se pudo obtener el documento.");
                if (motivo === null) return;
                b.disabled = true;
                await api("/api/admin/documentos/pedidos/" + b.dataset.devolver + "/devolver", "POST", { motivo: motivo });
                avisar("exito", "Pedido cerrado y créditos devueltos.");
                await cargar();
            } else if (b.dataset.reintentar) {
                b.disabled = true;
                await api("/api/admin/documentos/pedidos/" + b.dataset.reintentar + "/reintentar", "POST");
                avisar("exito", "Se vuelve a consultar al proveedor en unos segundos.");
                await cargar();
            } else if (b.dataset.bajar) {
                var r = await fetch(API + "/api/documentos/pedidos/" + b.dataset.bajar + "/archivo", { credentials: "include" });
                if (!r.ok) throw new Error(await Fiscontable.leerError(r));
                var blob = await r.blob();
                Fiscontable.guardarArchivo(blob, "documento_" + b.dataset.bajar + (/png/.test(blob.type) ? ".png" : /jpe?g/.test(blob.type) ? ".jpg" : ".pdf"));
            } else if (b.id === "dca-consultar") {
                b.disabled = true; b.textContent = "Consultando…";
                try { pintarSaldo(await api("/api/admin/documentos/saldo")); }
                finally { b.disabled = false; b.textContent = "Consultar ahora"; }
            }
        } catch (err) {
            avisar("error", err.message);
            b.disabled = false;
        }
    }

    document.addEventListener("DOMContentLoaded", function () {
        $("panel-documentos").addEventListener("click", accion);
        $("dca-catalogo").addEventListener("change", function (e) { if (e.target.dataset.campo) guardarServicio(e.target); });
        $("dca-buscar").addEventListener("input", function () { if (datos) pintarPedidos(); });
        $("dca-estado").addEventListener("change", function () { if (datos) pintarPedidos(); });
    });

    window.DocumentosAdmin = { cargar: cargar };
})();
