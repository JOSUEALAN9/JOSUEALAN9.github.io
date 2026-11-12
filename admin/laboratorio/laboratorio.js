/**
 * laboratorio.js — Laboratorio (solo administrador): lanza un recorrido de solo lectura por un portal del SAT y enseña
 * su registro: cada pantalla con su captura y su «mapa» (botones, enlaces, listas, campos). Desde el mapa se agregan
 * pasos para el siguiente recorrido. El candado vive en el servidor (modulos/laboratorio/motor.py): aquí solo se muestra.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var E = { datos: null, corrida: null, paso: 0, reloj: null, imagenes: {} };
    var ESTADO = { en_curso: ["aviso", "En curso"], completado: ["ok", "Terminado"], error: ["error", "Con error"], detenido: ["aviso", "Detenido"], interrumpido: ["error", "Interrumpido"] };
    var RESULTADO = { hecho: "", bloqueado: "bloqueado", "no encontrado": "no", error: "error" };

    async function api(ruta, opciones) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function fecha(iso) { return new Date(iso + "Z").toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
    function receta(clave) { return (E.datos.recetas.find(function (r) { return r.clave === clave; }) || {}).nombre || clave; }
    function empresa(rfc) { return (E.datos.empresas.find(function (e) { return e.rfc === rfc; }) || {}).alias || rfc; }
    function sello(estado) { var s = ESTADO[estado] || ["", estado]; return '<span class="ui-estado ui-estado--' + s[0] + '">' + esc(s[1]) + "</span>"; }

    function pintarForma() {
        var d = E.datos;
        $("lb-empresa").innerHTML = d.empresas.length
            ? d.empresas.map(function (e) { return '<option value="' + esc(e.rfc) + '"' + (e.efirma ? "" : " disabled") + ">" + esc(e.alias) + " · " + esc(e.rfc) + (e.efirma ? "" : " (sin e.firma guardada)") + "</option>"; }).join("")
            : '<option value="">Registra una empresa con su e.firma en Clientes</option>';
        $("lb-receta").innerHTML = d.recetas.map(function (r) { return '<option value="' + esc(r.clave) + '">' + esc(r.nombre) + "</option>"; }).join("");
        $("lb-guardado").textContent = "Cada recorrido se guarda " + d.dias_guardado + " días. Hasta " + d.max_pasos + " pasos por recorrido; uno a la vez.";
        cambioReceta();
    }
    var CANDADO = { recorrido: "", grabacion: "No tiene efecto ante el SAT: solo consulta y no abre notificaciones. No guarda contraseñas, sesiones, el RFC ni los documentos.",
        sin_navegador: "No tiene efecto ante el SAT: solo consulta. Registra los tiempos de cada paso; no guarda contraseñas, sesiones, el RFC ni los documentos." };
    function esGrabacion(clave) { return !!(E.datos.recetas.find(function (x) { return x.clave === clave; }) || {}).grabacion; }
    function cambioReceta() {
        var r = E.datos.recetas.find(function (x) { return x.clave === $("lb-receta").value; }) || {}, g = !!r.grabacion;
        $("lb-nota").textContent = (r.nota || "") + (r.url && !g ? " " + r.url : "");
        $("lb-url-caja").hidden = r.clave !== "libre";
        ["lb-grab-caja", "lb-ejercicio-caja", "lb-dia-caja"].forEach(function (id) { $(id).hidden = !g; });
        $("lb-pasos-caja").hidden = g;
        if (!CANDADO.recorrido) CANDADO.recorrido = $("lb-candado-txt").textContent;
        $("lb-candado-txt").textContent = r.sin_navegador ? CANDADO.sin_navegador : g ? CANDADO.grabacion : CANDADO.recorrido;
        $("lb-lanzar").textContent = r.sin_navegador ? "Probar" : g ? "Grabar" : "Recorrer";
        $("lb-grab-titulo").textContent = r.sin_navegador ? "Qué probar" : "Qué grabar";
        [].forEach.call(document.querySelectorAll('input[name="lb-parte"]'), function (x) {
            var si = !r.partes || !r.partes.length || r.partes.indexOf(x.value) >= 0;
            x.closest("label").hidden = !si;
            if (!si) x.checked = false; else if (g) x.checked = true;
        });
        if (g && !$("lb-ejercicio").value) $("lb-ejercicio").value = new Date().getFullYear() - 1;
        if (g && !$("lb-dia").value) { var d = new Date(Date.now() - 864e5); $("lb-dia").value = d.toISOString().slice(0, 10); }
    }
    function pintarLista() {
        var c = E.datos.corridas;
        $("lb-lista").innerHTML = c.length ? c.map(function (x) {
            return '<button type="button" class="lb-fila" data-corrida="' + esc(x.id) + '" aria-current="' + (E.corrida && E.corrida.id === x.id) + '">' +
                "<b>" + esc(receta(x.receta)) + "</b>" + sello(x.estado) +
                "<small>" + esc(empresa(x.rfc)) + " · " + esc(fecha(x.creada)) + " · " + x.pasos + (esGrabacion(x.receta) ? " parte" : " pantalla") + (x.pasos === 1 ? "" : "s") +
                (x.bloqueados ? " · " + x.bloqueados + " bloqueado" + (x.bloqueados === 1 ? "" : "s") : "") + (x.nota ? " · " + esc(x.nota) : "") + "</small></button>";
        }).join("") : '<div class="ui-vacio"><span>Todavía no hay recorridos.</span></div>';
    }

    async function imagen(cid, n) {
        var k = cid + "/" + n;
        if (!E.imagenes[k]) {
            var r = await fetch(API + "/api/admin/laboratorio/" + cid + "/captura/" + n, { credentials: "include" });
            if (!r.ok) throw new Error("sin captura");
            E.imagenes[k] = URL.createObjectURL(await r.blob());
        }
        return E.imagenes[k];
    }
    function filaMapa(e) {
        var extra = e.clase === "lista" ? "<small>" + esc((e.etiqueta || e.nombre || e.id || "lista") + ": " + (e.opciones || []).join(" · ")) + "</small>"
            : e.clase === "campo" ? "<small>" + esc((e.etiqueta || e.nombre || e.id || "campo") + " (" + (e.tipo || "texto") + ")") + "</small>"
            : e.clase === "enlace" && e.destino ? "<small>" + esc(e.destino) + "</small>" : "";
        var accion = "";
        if (e.bloqueado) accion = '<span class="lb-no" title="El laboratorio nunca pulsa este botón">🔒 bloqueado</span>';
        else if (e.clase === "boton" || e.clase === "enlace") accion = e.texto && !e.apagado ? '<button type="button" class="lb-mas" data-paso="' + esc("clic: " + e.texto) + '">+ paso</button>' : "";
        else if (e.clase === "lista" && (e.etiqueta || e.nombre || e.id)) accion = '<button type="button" class="lb-mas" data-paso="' + esc("elegir: " + (e.etiqueta || e.nombre || e.id) + " = " + ((e.opciones || [])[0] || "")) + '">+ paso</button>';
        return "<tr><td>" + esc({ boton: "Botón", enlace: "Enlace", lista: "Lista", campo: "Campo" }[e.clase] || e.clase) + "</td><td>" +
            (e.texto ? "<b>" + esc(e.texto) + "</b>" : "") + (e.texto && extra ? "<br>" : "") + extra + "</td><td>" + accion + "</td></tr>";
    }
    async function pintarDetalle() {
        var c = E.corrida, caja = $("lb-detalle");
        if (!c) return;
        var reg = c.registro || [];
        if (E.paso >= reg.length) E.paso = Math.max(0, reg.length - 1);
        var p = reg[E.paso];
        caja.innerHTML =
            '<div class="lb-cabeza"><h2>' + esc(receta(c.receta)) + " · " + esc(empresa(c.rfc)) + "</h2>" + sello(c.estado) +
                (c.en_curso ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-hacer="detener">Detener</button>' : "") +
                (esGrabacion(c.receta) ? "" : '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-hacer="repetir" title="Copia sus pasos al formulario para seguir desde ahí">Usar sus pasos</button>') +
                (reg.length ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-hacer="zip">Descargar registro</button>' : "") +
                (c.en_curso ? "" : '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-hacer="borrar">Borrar</button>') + "</div>" +
            '<div class="lb-datos">' + esc(fecha(c.creada)) + (c.mensaje ? " · <b>" + esc(c.mensaje) + "</b>" : c.en_curso ? " · recorriendo…" : "") + (c.nota ? " · " + esc(c.nota) : "") + "</div>" +
            (reg.length ? '<div class="lb-pasos">' + reg.map(function (x, i) {
                return '<button type="button" class="lb-paso' + (RESULTADO[x.resultado] ? " lb-paso--" + RESULTADO[x.resultado] : "") + '" data-ir="' + i + '" aria-current="' + (i === E.paso) + '">' +
                    "<b>" + x.n + (x.resultado !== "hecho" ? " · " + esc(x.resultado) : "") + "</b><span>" + esc(x.accion) + "</span></button>";
            }).join("") + "</div>" : '<div class="ui-vacio"><span>' + (c.en_curso ? (esGrabacion(c.receta) ? "Grabando la primera parte…" : "Abriendo el portal…") : "Este recorrido no guardó pantallas.") + "</span></div>") +
            (p && !p.captura && !(p.elementos || []).length ? '<div class="lb-datos"><b>' + esc(p.accion) + "</b>" + (p.detalle ? "<br>" + esc(p.detalle) : "") + "</div>" : "") +
            (p && (p.captura || (p.elementos || []).length) ? '<div class="lb-datos"><b>' + esc(p.titulo || "(sin título)") + "</b><br>" + esc(p.url) + (p.detalle ? "<br>" + esc(p.detalle) : "") +
                (p.ventanas && p.ventanas.length ? "<br>Ventanas que se cancelaron automáticamente: " + p.ventanas.map(esc).join(" · ") : "") + "</div>" +
                '<div class="lb-vista"><div class="lb-captura" id="lb-captura"><div class="ui-vacio"><span>Cargando la captura…</span></div></div>' +
                '<div class="lb-mapa"><table><thead><tr><th>Qué es</th><th>Texto</th><th></th></tr></thead><tbody>' +
                (p.elementos.length ? p.elementos.map(filaMapa).join("") : '<tr><td colspan="3">Esta pantalla no tiene botones ni enlaces visibles.</td></tr>') + "</tbody></table></div></div>" : "");
        if (p && p.captura) {
            try {
                var src = await imagen(c.id, p.n), hueco = $("lb-captura");
                if (hueco && E.corrida === c && reg[E.paso] === p) hueco.innerHTML = '<img alt="Captura del paso ' + p.n + '" src="' + src + '">';
            } catch (e) { var h = $("lb-captura"); if (h) h.innerHTML = '<div class="ui-vacio"><span>No hay captura de este paso.</span></div>'; }
        }
    }
    async function abrir(cid, conservar) {
        try { E.corrida = await api("/api/admin/laboratorio/" + cid); } catch (e) { Fiscontable.toast(e.message); return; }
        if (!conservar) E.paso = Math.max(0, (E.corrida.registro || []).length - 1);
        pintarLista(); pintarDetalle();
        clearTimeout(E.reloj);
        if (E.corrida.en_curso || E.corrida.estado === "en_curso") E.reloj = setTimeout(async function () {
            var antes = (E.corrida.registro || []).length, sigue = E.paso === antes - 1;
            await abrir(cid, !sigue);
            if (E.corrida && E.corrida.estado !== "en_curso") cargar(true);
        }, 2000);
    }
    async function cargar(soloLista) {
        try { E.datos = await api("/api/admin/laboratorio"); }
        catch (e) { $("lb").hidden = true; $("lb-aviso").hidden = false; $("lb-aviso").innerHTML = "<b>No se pudo abrir el laboratorio</b><span>" + esc(e.message) + "</span>"; return; }
        $("lb").hidden = false;
        if (!soloLista) { pintarForma(); pintarTiempos(); }
        pintarLista();
    }
    async function pintarTiempos() {
        var caja = $("lb-tiempos"); if (!caja) return;
        try {
            var t = await api("/api/admin/sat-tiempos?dias=7");
            var seg = function (ms) { return ms >= 1000 ? (ms / 1000).toFixed(1) + " s" : ms + " ms"; };
            caja.innerHTML = t.operaciones.length ? '<table class="lb-tiempos"><thead><tr><th>Petición</th><th>Veces</th><th>Fallas</th><th>Normal</th><th>Lenta (95 %)</th><th>La peor</th></tr></thead><tbody>' +
                t.operaciones.map(function (o) {
                    return "<tr><td>" + esc(o.operacion) + "</td><td>" + o.veces + "</td><td>" + o.fallas + "</td><td>" + seg(o.mediana_ms) + "</td><td>" + seg(o.p95_ms) + "</td><td>" + seg(o.max_ms) + "</td></tr>";
                }).join("") + "</tbody></table>" : '<small style="font-size:var(--t-12);color:rgb(var(--g-500))">Todavía no hay mediciones: aparecen con la primera descarga masiva.</small>';
        } catch (e) { caja.innerHTML = '<small style="font-size:var(--t-12);color:rgb(var(--er-600))">' + esc(e.message) + "</small>"; }
    }

    $("lb-receta").addEventListener("change", cambioReceta);
    $("lb-forma").addEventListener("submit", async function (e) {
        e.preventDefault();
        var b = $("lb-lanzar"); b.disabled = true;
        try {
            var r = await api("/api/admin/laboratorio", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rfc: $("lb-empresa").value, receta: $("lb-receta").value, instrucciones: $("lb-pasos").value, url: $("lb-url").value, nota: $("lb-nota-txt").value,
                    opciones: esGrabacion($("lb-receta").value) ? { partes: [].slice.call(document.querySelectorAll('input[name="lb-parte"]:checked')).map(function (x) { return x.value; }),
                        ejercicio: $("lb-ejercicio").value, dia: $("lb-dia").value } : null }) });
            await cargar(true); abrir(r.id);
        } catch (er) { Fiscontable.toast(er.message); }
        b.disabled = false;
    });
    $("lb-lista").addEventListener("click", function (e) { var b = e.target.closest("[data-corrida]"); if (b) abrir(b.dataset.corrida); });
    $("lb-detalle").addEventListener("click", async function (e) {
        var ir = e.target.closest("[data-ir]"), mas = e.target.closest("[data-paso]"), h = e.target.closest("[data-hacer]"), c = E.corrida;
        if (ir) { E.paso = +ir.dataset.ir; pintarDetalle(); return; }
        if (mas) {
            var t = $("lb-pasos");
            if (!t.value.trim() && c) t.value = (c.instrucciones || "").trim();
            t.value = (t.value.trim() ? t.value.trim() + "\n" : "") + mas.dataset.paso;
            if (c) { $("lb-empresa").value = c.rfc; $("lb-receta").value = c.receta; cambioReceta(); if (c.receta === "libre") $("lb-url").value = c.url; }
            Fiscontable.toast("Paso agregado al formulario: " + mas.dataset.paso);
            return;
        }
        if (!h || !c) return;
        try {
            if (h.dataset.hacer === "detener") { await api("/api/admin/laboratorio/" + c.id + "/detener", { method: "POST" }); Fiscontable.toast("Se detiene al terminar el paso en curso."); }
            else if (h.dataset.hacer === "repetir") {
                $("lb-empresa").value = c.rfc; $("lb-receta").value = c.receta; cambioReceta(); $("lb-pasos").value = c.instrucciones || ""; if (c.receta === "libre") $("lb-url").value = c.url;
                $("lb-pasos").focus(); Fiscontable.toast("Pasos copiados al formulario.");
            } else if (h.dataset.hacer === "zip") {
                var r = await fetch(API + "/api/admin/laboratorio/" + c.id + "/zip", { credentials: "include" });
                if (!r.ok) throw new Error(await Fiscontable.leerError(r));
                Fiscontable.guardarArchivo(await r.blob(), "Laboratorio_" + c.rfc + "_" + c.creada.slice(0, 10) + ".zip");
            } else if (h.dataset.hacer === "borrar") {
                if (!(await Fiscontable.confirmar({ titulo: "¿Borrar este recorrido?", texto: "Se borran sus capturas y su registro.", si: "Borrar", peligro: true }))) return;
                await api("/api/admin/laboratorio/" + c.id, { method: "DELETE" });
                E.corrida = null; $("lb-detalle").innerHTML = '<div class="ui-vacio"><b>Elige un recorrido</b><span>o lanza uno nuevo.</span></div>'; cargar(true);
            }
        } catch (er) { Fiscontable.toast(er.message); }
    });

    (async function () {
        var p = await Fiscontable.perfil();
        if (!p || p._error || p.rol !== "admin") { $("lb-aviso").hidden = false; $("lb-aviso").innerHTML = "<b>Esta página es solo para el administrador.</b>"; return; }
        cargar();
    })();
})();
