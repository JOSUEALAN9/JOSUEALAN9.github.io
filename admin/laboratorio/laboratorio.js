/**
 * laboratorio.js — Laboratorio (solo administrador): lanza un recorrido de solo lectura por un portal del SAT y enseña
 * su registro: cada pantalla con su captura y su «mapa» (botones, enlaces, listas, campos). Desde el mapa se agregan
 * pasos para el siguiente recorrido. En vivo, la sesión queda abierta y «+ paso» (o el renglón de abajo) manda el paso
 * en ese momento. El candado vive en el servidor (modulos/laboratorio/motor.py): aquí solo se muestra.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var E = { datos: null, corrida: null, paso: 0, reloj: null, imagenes: {}, firma: "" };
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
        if (d.vivo) $("lb-vivo-nota").textContent = "Al terminar estos pasos la sesión sigue abierta y le mandas más, uno a la vez. Se cierra al terminarla, tras " +
            d.vivo.espera_min + " minutos sin pasos o a los " + d.vivo.tope_min + " minutos.";
        cambioReceta();
    }
    var CANDADO = { recorrido: "", grabacion: "No tiene efecto ante el SAT: solo consulta y no abre notificaciones. No guarda contraseñas, sesiones, el RFC ni los documentos.",
        sin_navegador: "No tiene efecto ante el SAT: solo consulta y no gasta cupo de descargas. Registra los tiempos de cada paso y, si algo falla, en qué paso y qué contestó el SAT; no guarda contraseñas, sesiones, el RFC ni los documentos." };
    function esGrabacion(clave) { return !!(E.datos.recetas.find(function (x) { return x.clave === clave; }) || {}).grabacion; }
    function cambioReceta() {
        var r = E.datos.recetas.find(function (x) { return x.clave === $("lb-receta").value; }) || {}, g = !!r.grabacion;
        $("lb-nota").textContent = (r.nota || "") + (r.url && !g ? " " + r.url : "");
        $("lb-url-caja").hidden = r.clave !== "libre";
        ["lb-grab-caja", "lb-ejercicio-caja", "lb-dia-caja"].forEach(function (id) { $(id).hidden = !g; });
        $("lb-dia-caja").hidden = !g || !!r.sin_navegador;          // la prueba sin navegador usa un mes completo
        $("lb-mes-caja").hidden = !r.sin_navegador;
        $("lb-pasos-caja").hidden = g;
        var cuadro = $("lb-pasos"), sug = r.pasos || "";             // la receta trae el camino que ya funcionó (DIOT)
        if (!g && (!cuadro.value.trim() || cuadro.value === E.sugeridos)) cuadro.value = sug;
        E.sugeridos = sug;
        $("lb-vivo-caja").hidden = g;
        if (g) $("lb-en-vivo").checked = false;
        if (!CANDADO.recorrido) CANDADO.recorrido = $("lb-candado-txt").textContent;
        $("lb-candado-txt").textContent = r.sin_navegador ? CANDADO.sin_navegador : g ? CANDADO.grabacion : CANDADO.recorrido;
        $("lb-lanzar").textContent = r.sin_navegador ? "Probar" : g ? "Grabar" : $("lb-en-vivo").checked ? "Abrir en vivo" : "Recorrer";
        $("lb-grab-titulo").textContent = r.sin_navegador ? "Qué probar" : "Qué grabar";
        [].forEach.call(document.querySelectorAll('input[name="lb-parte"]'), function (x) {
            var si = !r.partes || !r.partes.length || r.partes.indexOf(x.value) >= 0;
            x.closest("label").hidden = !si;
            if (!si) x.checked = false; else if (g) x.checked = !x.hasAttribute("data-no-de-fabrica");
        });
        if (g && !$("lb-ejercicio").value) $("lb-ejercicio").value = new Date().getFullYear() - 1;
        if (g && !$("lb-dia").value) { var d = new Date(Date.now() - 864e5); $("lb-dia").value = d.toISOString().slice(0, 10); }
        if (r.sin_navegador && !$("lb-mes").value) { var m = new Date(); m.setDate(1); m.setMonth(m.getMonth() - 1); $("lb-mes").value = m.toISOString().slice(0, 7); }
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
    function opcionesValidas(e) {
        var fuera = e.apagadas || [];
        return (e.opciones || []).filter(function (o) { return o && fuera.indexOf(o) < 0 && !/^(selecciona|seleccione|elige|sin selecci)/i.test(o); });
    }
    function filaLista(e) {
        // Cada opción es un botón: pulsarla agrega (o en vivo, manda) «elegir: Lista = Opción».
        var nom = e.etiqueta || e.nombre || e.id || "Lista", ops = opcionesValidas(e);
        var elegida = ops.indexOf(e.elegida) >= 0 ? e.elegida : "";
        return "<tr><td>Lista</td><td><b>" + esc(nom) + "</b>" +
            (e.apagado ? "<br><small>Apagada por ahora (se activa al elegir lo anterior)</small>"
                : ops.length ? '<div class="lb-ops">' + ops.slice(0, 30).map(function (o) {
                    return '<button type="button" class="lb-op" data-paso="' + esc("elegir: " + nom + " = " + o) + '" aria-pressed="' + (o === elegida) + '" title="Elegir ' + esc(o) + '">' + esc(o) + "</button>";
                }).join("") + "</div>" : "<br><small>Sin opciones todavía</small>") + "</td><td></td></tr>";
    }
    function filaMapa(e) {
        if (e.clase === "lista") return filaLista(e);
        var extra = e.clase === "campo" ? "<small>" + esc((e.etiqueta || e.nombre || e.id || "campo") + " (" + (e.tipo || "texto") + ")") + "</small>"
            : e.clase === "enlace" && e.destino ? "<small>" + esc(e.destino) + "</small>"
            : e.clase === "casilla" ? "<small>" + (e.marcada ? "Marcada" : "Sin marcar") + "</small>" : "";
        var accion = "";
        if (e.bloqueado) accion = '<span class="lb-no" title="El laboratorio nunca pulsa este botón">🔒 bloqueado</span>';
        else if (e.clase === "boton" || e.clase === "enlace") accion = e.texto && !e.apagado ? '<button type="button" class="lb-mas" data-paso="' + esc("clic: " + e.texto) + '">+ paso</button>' : "";
        else if (e.clase === "casilla") accion = e.texto && !e.apagado ? '<button type="button" class="lb-mas" data-paso="' + esc("marcar: " + e.texto) + '">+ paso</button>' : "";
        else if (e.clase === "lista" && (e.etiqueta || e.nombre || e.id)) accion = '<button type="button" class="lb-mas" data-paso="' + esc("elegir: " + (e.etiqueta || e.nombre || e.id) + " = " + ((e.opciones || [])[0] || "")) + '">+ paso</button>';
        return "<tr><td>" + esc({ boton: "Botón", enlace: "Enlace", lista: "Lista", campo: "Campo", casilla: "Casilla" }[e.clase] || e.clase) + "</td><td>" +
            (e.texto ? "<b>" + esc(e.texto) + "</b>" : "") + (e.texto && extra ? "<br>" : "") + extra + "</td><td>" + accion + "</td></tr>";
    }
    function barraVivo(c) {
        if (!c.en_vivo) return "";
        var estado = c.cola ? "Haciendo tu paso…" : c.esperando ? "Esperando tu siguiente paso" : "Haciendo los pasos iniciales…";
        return '<form class="lb-vivo" id="lb-vivo"><div class="lb-vivo__estado"><i aria-hidden="true"></i><b>En vivo</b><span>' + esc(estado) + "</span></div>" +
            '<div class="lb-vivo__fila"><input class="ui-input" id="lb-vivo-paso" autocomplete="off" spellcheck="false" maxlength="300" placeholder="Ej.: selecciona mensual · marca DIOT · clic: Siguiente" aria-label="Paso para mandar">' +
            '<button type="submit" class="ui-btn ui-btn--primario ui-btn--28">Mandar</button></div>' +
            "<small>«+ paso» y las opciones de las listas en el mapa también lo mandan en este momento. Lo que presenta, envía, firma o paga sigue bloqueado. " +
            '<button type="button" class="lb-enlace" data-ayuda>¿Cómo escribo un paso?</button></small></form>';
    }
    // «En esta pantalla» (dentro de la ayuda): las instrucciones listas para la pantalla que estás viendo.
    function pintarAyuda() {
        var caja = $("lb-ay-aqui"), c = E.corrida, p = c && (c.registro || [])[E.paso];
        var els = (p && p.elementos) || [], orden = { casilla: 0, lista: 1, boton: 2, enlace: 3 }, filas = [], visto = {};
        els.filter(function (e) { return !e.bloqueado && !e.apagado && orden[e.clase] !== undefined; })
            .sort(function (a, b) { return orden[a.clase] - orden[b.clase]; })
            .forEach(function (e) {
                if (filas.length >= 14) return;
                if (e.clase === "lista") {
                    var nom = e.etiqueta || e.nombre || e.id, ops = opcionesValidas(e);
                    if (!nom || !ops.length || visto["l" + nom]) return;
                    visto["l" + nom] = 1;
                    filas.push('<div class="lb-ay-aqui__fila"><span>Elegir en «' + esc(nom) + '»</span><div class="lb-ops">' + ops.slice(0, 12).map(function (o) {
                        return '<button type="button" class="lb-op" data-ayuda-paso="' + esc("elegir: " + nom + " = " + o) + '">' + esc(o) + "</button>";
                    }).join("") + "</div></div>");
                    return;
                }
                if (!e.texto) return;
                var paso = (e.clase === "casilla" ? "marcar: " : "clic: ") + e.texto;
                if (visto[paso]) return;
                visto[paso] = 1;
                var que = e.clase === "casilla" ? (e.marcada ? "Desmarcar (ya está marcada)" : "Marcar la casilla") : e.clase === "boton" ? "Pulsar el botón" : "Abrir el enlace";
                filas.push('<div class="lb-ay-aqui__fila"><span>' + que + '</span><button type="button" class="lb-ay-paso" data-ayuda-paso="' + esc(paso) + '">' + esc(paso) + "</button></div>");
            });
        caja.hidden = !filas.length;
        if (filas.length) caja.innerHTML = '<h3 class="lb-ay-sub">En esta pantalla <small>(paso ' + p.n + ")</small></h3>" +
            '<p class="lb-ay-nota" style="margin:0 0 10px">' + (c.en_vivo ? "Pulsa una y se manda en este momento." : "Pulsa una y se agrega al cuadro de pasos.") + "</p>" +
            '<div class="lb-ay-aqui__lista">' + filas.join("") + "</div>";
    }
    function agregarPaso(paso) {
        var t = $("lb-pasos"), c = E.corrida;
        if (!t.value.trim() && c) t.value = (c.instrucciones || "").trim();
        t.value = (t.value.trim() ? t.value.trim() + "\n" : "") + paso;
        if (c) { $("lb-empresa").value = c.rfc; $("lb-receta").value = c.receta; cambioReceta(); if (c.receta === "libre") $("lb-url").value = c.url; }
        Fiscontable.toast("Paso agregado al formulario: " + paso);
    }
    async function mandarPaso(paso) {
        var c = E.corrida;
        if (!c || !c.en_vivo || !paso) return false;
        try {
            await api("/api/admin/laboratorio/" + c.id + "/paso", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paso: paso }) });
            Fiscontable.toast("Mandado: " + paso);
            abrir(c.id);
            return true;
        } catch (er) { Fiscontable.toast(er.message); return false; }
    }
    async function pintarDetalle() {
        var c = E.corrida, caja = $("lb-detalle");
        if (!c) return;
        var campo = $("lb-vivo-paso"), escrito = campo ? campo.value : "", foco = campo && document.activeElement === campo;
        var reg = c.registro || [];
        if (E.paso >= reg.length) E.paso = Math.max(0, reg.length - 1);
        var p = reg[E.paso];
        caja.innerHTML =
            '<div class="lb-cabeza"><h2>' + esc(receta(c.receta)) + " · " + esc(empresa(c.rfc)) + "</h2>" + sello(c.estado) +
                (c.en_curso ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-hacer="detener">' + (c.en_vivo ? "Terminar" : "Detener") + "</button>" : "") +
                (esGrabacion(c.receta) ? "" : '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-hacer="repetir" title="Copia sus pasos al formulario para seguir desde ahí">Usar sus pasos</button>') +
                (reg.length ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-hacer="zip">Descargar registro</button>' : "") +
                (c.en_curso ? "" : '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-hacer="borrar">Borrar</button>') + "</div>" +
            '<div class="lb-datos">' + esc(fecha(c.creada)) + (c.mensaje ? " · <b>" + esc(c.mensaje) + "</b>" : c.en_curso ? " · recorriendo…" : "") + (c.nota ? " · " + esc(c.nota) : "") + "</div>" +
            barraVivo(c) +
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
        var nuevo = $("lb-vivo-paso");
        if (nuevo) { nuevo.value = escrito; if (foco) nuevo.focus(); }
        if (p && p.captura) {
            try {
                var src = await imagen(c.id, p.n), hueco = $("lb-captura");
                if (hueco && E.corrida === c && reg[E.paso] === p) hueco.innerHTML = '<img alt="Captura del paso ' + p.n + '" src="' + src + '">';
            } catch (e) { var h = $("lb-captura"); if (h) h.innerHTML = '<div class="ui-vacio"><span>No hay captura de este paso.</span></div>'; }
        }
    }
    async function abrir(cid, conservar) {
        var c;
        try { c = await api("/api/admin/laboratorio/" + cid); } catch (e) { Fiscontable.toast(e.message); return; }
        var firma = [c.id, (c.registro || []).length, c.estado, c.mensaje, c.en_vivo, c.esperando, c.cola].join("|"), igual = E.corrida && firma === E.firma;
        E.corrida = c; E.firma = firma;
        if (!conservar) E.paso = Math.max(0, (c.registro || []).length - 1);
        if (!igual) { pintarLista(); pintarDetalle(); }        // en vivo se consulta cada 2 s: solo se repinta si algo cambió
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
    document.addEventListener("click", function (e) {
        var d = $("lb-ayuda");
        if (e.target.closest("[data-ayuda]")) { e.preventDefault(); pintarAyuda(); d.showModal(); return; }
        var ap = e.target.closest("[data-ayuda-paso]");
        if (ap) { d.close(); if (E.corrida && E.corrida.en_vivo) mandarPaso(ap.dataset.ayudaPaso); else agregarPaso(ap.dataset.ayudaPaso); return; }
        if (e.target.closest("[data-ayuda-cerrar]") || e.target === d) d.close();
    });
    $("lb-en-vivo").addEventListener("change", cambioReceta);
    $("lb-detalle").addEventListener("submit", async function (e) {
        if (e.target.id !== "lb-vivo") return;
        e.preventDefault();
        var campo = $("lb-vivo-paso"), paso = campo.value.trim();
        if (!paso) { campo.focus(); return; }
        campo.value = "";
        if (!(await mandarPaso(paso))) campo.value = paso;
    });
    $("lb-forma").addEventListener("submit", async function (e) {
        e.preventDefault();
        var b = $("lb-lanzar"); b.disabled = true;
        try {
            var r = await api("/api/admin/laboratorio", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rfc: $("lb-empresa").value, receta: $("lb-receta").value, instrucciones: $("lb-pasos").value, url: $("lb-url").value, nota: $("lb-nota-txt").value,
                    en_vivo: $("lb-en-vivo").checked && !esGrabacion($("lb-receta").value),
                    opciones: esGrabacion($("lb-receta").value) ? { partes: [].slice.call(document.querySelectorAll('input[name="lb-parte"]:checked')).map(function (x) { return x.value; }),
                        ejercicio: $("lb-ejercicio").value, dia: $("lb-dia").value, mes: $("lb-mes").value } : null }) });
            await cargar(true); abrir(r.id);
        } catch (er) { Fiscontable.toast(er.message); }
        b.disabled = false;
    });
    $("lb-lista").addEventListener("click", function (e) { var b = e.target.closest("[data-corrida]"); if (b) abrir(b.dataset.corrida); });
    $("lb-detalle").addEventListener("click", async function (e) {
        var ir = e.target.closest("[data-ir]"), mas = e.target.closest("[data-paso]"), h = e.target.closest("[data-hacer]"), c = E.corrida;
        if (ir) { E.paso = +ir.dataset.ir; pintarDetalle(); return; }
        if (mas && c && c.en_vivo) { mandarPaso(mas.dataset.paso); return; }
        if (mas) { agregarPaso(mas.dataset.paso); return; }
        if (!h || !c) return;
        try {
            if (h.dataset.hacer === "detener") {
                await api("/api/admin/laboratorio/" + c.id + "/detener", { method: "POST" });
                Fiscontable.toast(c.en_vivo ? "Se cierra la sesión en unos segundos." : "Se detiene al terminar el paso en curso.");
            }
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
