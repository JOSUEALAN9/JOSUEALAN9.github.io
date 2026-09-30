/* ============================================================
   programar.js — "Programar para la madrugada" (compartido por módulos)

   Fiscontable.Programar.montar({ modulo, contenedor })
     modulo: "csf" | "opinion" | "declaraciones" | "xml"
     contenedor: id del <div> donde va la tarjeta

   La tarjeta muestra el botón "Programar" y las últimas programaciones
   del módulo (estado, detalle por RFC, cancelar, bajar el ZIP). El turno
   corre en el servidor entre 2:00 y 6:30 con pausas al azar; solo usa las
   e.firmas guardadas del directorio.
   ============================================================ */
(function () {
    "use strict";
    var API = Fiscontable.API;

    var NOMBRES = { csf: "constancias", opinion: "opiniones", declaraciones: "declaraciones", xml: "XML" };
    var ESTADOS = {
        pendiente: ["En espera", "fp-gris"], reintentar: ["Se reintentará", "fp-ambar"], en_curso: ["Trabajando", "fp-azul"],
        lista: ["Listo", "fp-verde"], revisar: ["Revisar", "fp-rojo"], fallida: ["Falló", "fp-rojo"],
        no_alcanzo: ["No alcanzó", "fp-ambar"], cancelada: ["Cancelada", "fp-gris"]
    };
    var ESTADO_PROG = { programada: "Programada", en_curso: "Trabajando", terminada: "Terminada", cancelada: "Cancelada" };

    function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    function hora(iso) { var f = new Date(iso); return f.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" }); }
    function dia(iso) {
        var f = new Date(iso), hoy = new Date(), man = new Date(); man.setDate(hoy.getDate() + 1);
        if (f.toDateString() === hoy.toDateString()) return "hoy";
        if (f.toDateString() === man.toDateString()) return "mañana";
        return f.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
    }
    async function api(ruta, opciones) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }

    function estilos() {
        if (document.getElementById("fp-estilos")) return;
        var css = [
            ".fp-tarjeta{border:1px solid var(--linea);border-radius:var(--radio-chico);background:#fff;padding:12px 14px;margin:0 0 16px}",
            ".fp-cabeza{display:flex;align-items:center;gap:12px;flex-wrap:wrap}",
            ".fp-cabeza__texto{flex:1 1 240px;font-size:13.5px;color:var(--texto-tenue);line-height:1.45}",
            ".fp-cabeza__texto strong{color:var(--texto);font-size:14.5px;display:block}",
            ".fp-boton{padding:8px 14px;font-size:14px;width:auto}",
            ".fp-lista{margin-top:10px;display:flex;flex-direction:column;gap:8px}",
            ".fp-prog{border-top:1px solid var(--linea);padding-top:8px;font-size:13.5px}",
            ".fp-prog__linea{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
            ".fp-prog__linea .fp-crece{flex:1 1 200px}",
            ".fp-enlace{background:none;border:0;padding:0;color:var(--acento);font:inherit;font-weight:600;cursor:pointer;text-decoration:underline}",
            ".fp-chip{display:inline-block;border-radius:999px;padding:1px 8px;font-size:12px;font-weight:600;white-space:nowrap}",
            ".fp-verde{background:#E3F4EC;color:#0B6B47}.fp-rojo{background:#FDECEC;color:#A12A2A}.fp-ambar{background:#FDF3DC;color:#8A5A00}",
            ".fp-azul{background:#E4F0FB;color:#1C5D99}.fp-gris{background:var(--papel);color:var(--texto-tenue)}",
            ".fp-tabla{width:100%;border-collapse:collapse;margin-top:6px;font-size:13px}",
            ".fp-tabla td{padding:4px 6px;border-top:1px solid var(--linea);vertical-align:top}",
            ".fp-tabla td:first-child{font-family:ui-monospace,monospace;white-space:nowrap}",
            ".fp-fondo{position:fixed;inset:0;background:rgba(16,27,45,.45);display:flex;align-items:center;justify-content:center;z-index:60;padding:16px}",
            ".fp-fondo[hidden]{display:none}",
            ".fp-modal{background:#fff;border-radius:var(--radio);box-shadow:var(--sombra-alta);width:100%;max-width:560px;max-height:calc(100vh - 32px);display:flex;flex-direction:column}",
            ".fp-modal__cabeza{padding:16px 18px 6px}.fp-modal__cabeza h2{font-size:18px;font-weight:700}",
            ".fp-modal__cuerpo{padding:6px 18px;overflow:auto;display:flex;flex-direction:column;gap:12px}",
            ".fp-modal__pie{padding:12px 18px 16px;display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}",
            ".fp-modal__pie button{width:auto;padding:9px 16px}",
            ".fp-clientes{border:1px solid var(--linea);border-radius:var(--radio-chico);max-height:240px;overflow:auto}",
            ".fp-cliente{display:flex;gap:9px;align-items:center;padding:7px 10px;border-top:1px solid var(--linea);font-size:14px;cursor:pointer}",
            ".fp-cliente:first-child{border-top:0}.fp-cliente small{color:var(--texto-tenue);font-family:ui-monospace,monospace}",
            ".fp-cliente input{width:16px;height:16px;accent-color:var(--acento);flex:none}",
            ".fp-fila{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}.fp-fila>*{flex:1 1 150px}",
            ".fp-aviso{font-size:13px;border-radius:var(--radio-chico);padding:8px 10px;background:var(--acento-suave)}",
            ".fp-aviso--error{background:#FDECEC;color:#A12A2A}",
            ".fp-segmento{display:flex;gap:6px;flex-wrap:wrap}.fp-segmento label{flex:none}"
        ].join("\n");
        var s = document.createElement("style");
        s.id = "fp-estilos";
        s.textContent = css;
        document.head.appendChild(s);
    }

    /* ------------------------------------------------------------ opciones por módulo */

    /* La madrugada que sigue: hoy si aún no dan las 6:30; si no, mañana. */
    function nocheSiguiente() {
        var f = new Date();
        if (f.getHours() > 6 || (f.getHours() === 6 && f.getMinutes() >= 30)) f.setDate(f.getDate() + 1);
        return f.getFullYear() + "-" + String(f.getMonth() + 1).padStart(2, "0") + "-" + String(f.getDate()).padStart(2, "0");
    }
    function textoNoche(valor) {
        if (!valor) return "";
        var d = new Date(valor + "T12:00:00"), hoy = new Date(), man = new Date(); man.setDate(hoy.getDate() + 1);
        var nombre = d.toDateString() === hoy.toDateString() ? "hoy" : d.toDateString() === man.toDateString() ? "mañana" :
            d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
        return "Madrugada de " + nombre + ", de 2:00 a 6:30 a. m. (hora de México), con pausas al azar.";
    }

    function mesAnterior() {
        var f = new Date(); f.setDate(1); f.setMonth(f.getMonth() - 1);
        return f.getFullYear() + "-" + String(f.getMonth() + 1).padStart(2, "0");
    }

    function opcionesHtml(modulo) {
        if (modulo === "csf" || modulo === "opinion") {
            return '<label class="marca"><input type="checkbox" id="fp-forzar"> Sacarla aunque ya tenga una vigente</label>';
        }
        if (modulo === "declaraciones") {
            var anio = new Date().getFullYear(), opts = "";
            for (var a = anio; a >= 2014; a--) opts += '<option value="' + a + '"' + (a === anio ? " selected" : "") + ">" + a + "</option>";
            return '<div class="fp-fila"><label class="campo"><span class="campo__etiqueta">Ejercicio</span>' +
                '<select id="fp-ejercicio" class="campo__control">' + opts + "</select></label>" +
                '<div class="campo"><span class="campo__etiqueta">Portal</span><div class="fp-segmento">' +
                '<label class="marca"><input type="checkbox" id="fp-portal-nuevo" checked> Nuevo</label>' +
                '<label class="marca"><input type="checkbox" id="fp-portal-antiguo"> Anterior</label></div></div></div>';
        }
        var mes = mesAnterior();
        return '<div class="fp-fila"><label class="campo"><span class="campo__etiqueta">Comprobantes</span>' +
            '<select id="fp-tipo" class="campo__control"><option value="recibidos">Recibidas</option><option value="emitidos">Emitidas</option>' +
            '<option value="ambos">Emitidas y recibidas</option></select></label>' +
            '<label class="campo"><span class="campo__etiqueta">Por</span><select id="fp-via" class="campo__control">' +
            '<option value="webservice">Web service (recomendado)</option><option value="portal">Portal con e.firma</option></select></label></div>' +
            '<div class="fp-fila"><label class="campo"><span class="campo__etiqueta">Desde (mes)</span>' +
            '<input type="month" id="fp-desde" class="campo__control" value="' + mes + '"></label>' +
            '<label class="campo"><span class="campo__etiqueta">Hasta (mes)</span>' +
            '<input type="month" id="fp-hasta" class="campo__control" value="' + mes + '"></label></div>' +
            '<p class="ficha__nota">Web service: el SAT prepara la descarga y termina sola en Descarga masiva. Portal: máximo 2,000 XML por día.</p>';
    }

    function leerOpciones(modulo) {
        if (modulo === "csf" || modulo === "opinion") return { forzar: document.getElementById("fp-forzar").checked };
        if (modulo === "declaraciones") {
            var portales = [];
            if (document.getElementById("fp-portal-nuevo").checked) portales.push("nuevo");
            if (document.getElementById("fp-portal-antiguo").checked) portales.push("antiguo");
            if (!portales.length) throw new Error("Elige al menos un portal de declaraciones.");
            return { ejercicio: +document.getElementById("fp-ejercicio").value, portales: portales };
        }
        var desde = document.getElementById("fp-desde").value, hasta = document.getElementById("fp-hasta").value;
        if (!desde || !hasta) throw new Error("Elige el periodo.");
        if (hasta < desde) throw new Error("El mes final no puede ser anterior al inicial.");
        var h = new Date(+hasta.slice(0, 4), +hasta.slice(5, 7), 0);
        return {
            tipo: document.getElementById("fp-tipo").value, via: document.getElementById("fp-via").value,
            fecha_inicial: desde + "-01T00:00:00",
            fecha_final: hasta + "-" + String(h.getDate()).padStart(2, "0") + "T23:59:59"
        };
    }

    /* ------------------------------------------------------------ la tarjeta */

    function montar(cfg) {
        var caja = document.getElementById(cfg.contenedor);
        if (!caja) return;
        estilos();
        var modulo = cfg.modulo, abiertas = {}, clientes = null, ventana = null;

        caja.innerHTML =
            '<div class="fp-tarjeta">' +
            '  <div class="fp-cabeza">' +
            '    <div class="fp-cabeza__texto"><strong>🌙 Programar para la madrugada</strong>' +
            '      Se hace entre 2:00 y 6:30 con pausas al azar, cuando el SAT está libre. Usa las e.firmas guardadas del directorio.</div>' +
            '    <button type="button" class="boton-secundario fp-boton" data-fp="abrir">Programar</button>' +
            '  </div>' +
            '  <div class="fp-lista" data-fp="lista"></div>' +
            "</div>" +
            '<div class="fp-fondo" data-fp="fondo" hidden><div class="fp-modal" role="dialog" aria-modal="true" aria-labelledby="fp-titulo">' +
            '  <div class="fp-modal__cabeza"><h2 id="fp-titulo">Programar ' + NOMBRES[modulo] + " para la madrugada</h2>" +
            '    <p class="ficha__nota" data-fp="ventana"></p></div>' +
            '  <div class="fp-modal__cuerpo">' +
            '    <div><div class="fp-fila" style="align-items:center"><input type="search" class="campo__control" data-fp="buscar" placeholder="Buscar cliente o RFC">' +
            '      <label class="marca" style="flex:none"><input type="checkbox" data-fp="todos"> Todos</label></div></div>' +
            '    <div class="fp-clientes" data-fp="clientes"><p class="ficha__nota" style="padding:10px">Cargando tu directorio…</p></div>' +
            '    <p class="ficha__nota" data-fp="cuenta"></p>' +
            '    <div class="fp-fila"><label class="campo"><span class="campo__etiqueta">¿Qué madrugada?</span>' +
            '      <input type="date" class="campo__control" data-fp="noche"></label>' +
            '      <p class="ficha__nota" data-fp="noche-texto" style="flex:2 1 220px"></p></div>' +
                 opcionesHtml(modulo) +
            '    <div class="fp-aviso fp-aviso--error" data-fp="error" hidden></div>' +
            "  </div>" +
            '  <div class="fp-modal__pie"><button type="button" class="boton-secundario" data-fp="cerrar">Cancelar</button>' +
            '    <button type="button" class="boton-principal" data-fp="enviar">Programar</button></div>' +
            "</div></div>";

        function $(nombre) { return caja.querySelector('[data-fp="' + nombre + '"]'); }

        /* ---- lista de programaciones */
        function pintarLista(lista) {
            var html = "";
            (lista || []).slice(0, 4).forEach(function (p) {
                var c = p.conteo || {}, total = (p.tareas || []).length;
                var linea;
                if (p.estado === "programada") {
                    linea = "Empieza " + dia(p.arranque) + " a las " + hora(p.arranque) + " · " + (c.pendiente || 0) + " por hacer";
                } else if (p.estado === "en_curso") {
                    linea = "Trabajando: " + (c.lista || 0) + " de " + total + " listos";
                } else {
                    linea = (p.resumen && p.resumen.mensaje) || ESTADO_PROG[p.estado];
                }
                if (p.parametros && p.parametros.origen === "lote") linea = "Lote subido · " + linea;
                var chips = Object.keys(ESTADOS).filter(function (k) { return c[k]; }).map(function (k) {
                    return '<span class="fp-chip ' + ESTADOS[k][1] + '">' + ESTADOS[k][0] + " " + c[k] + "</span>";
                }).join(" ");
                html += '<div class="fp-prog"><div class="fp-prog__linea">' +
                    '<span class="fp-chip ' + (p.estado === "terminada" ? "fp-verde" : p.estado === "cancelada" ? "fp-gris" : "fp-azul") + '">' +
                    ESTADO_PROG[p.estado] + "</span>" +
                    '<span class="fp-crece">' + esc(linea) + "</span>" +
                    '<button type="button" class="fp-enlace" data-ver="' + p.id + '">' + (abiertas[p.id] ? "Ocultar" : "Detalle") + "</button>" +
                    (p.estado === "programada" || p.estado === "en_curso" ? ' <button type="button" class="fp-enlace" data-cancelar="' + p.id + '">Cancelar</button>' : "") +
                    (p.job_id && (c.lista || 0) > 0 && p.modulo !== "xml" ? ' <button type="button" class="fp-enlace" data-bajar="' + p.id + '">Descargar ZIP</button>' : "") +
                    "</div>" + (chips ? '<div style="margin-top:4px">' + chips + "</div>" : "");
                if (abiertas[p.id]) {
                    html += '<table class="fp-tabla"><tbody>' + (p.tareas || []).map(function (t) {
                        var e = ESTADOS[t.estado] || [t.estado, "fp-gris"];
                        var extra = t.detalle && t.detalle.tipo ? " · " + t.detalle.tipo : "";
                        var cuando = t.estado === "reintentar" && t.proximo_intento ? " (a las " + hora(t.proximo_intento) + ")" : "";
                        return "<tr><td>" + esc(t.rfc) + esc(extra) + '</td><td><span class="fp-chip ' + e[1] + '">' + e[0] + "</span>" + cuando +
                            (t.mensaje ? '<div class="ficha__nota">' + esc(t.mensaje) + "</div>" : "") + "</td></tr>";
                    }).join("") + "</tbody></table>";
                }
                html += "</div>";
            });
            $("lista").innerHTML = html;
        }

        async function cargarLista() {
            try { pintarLista(await api("/api/programadas?modulo=" + modulo)); } catch (e) { /* sin sesión o sin permiso: no se muestra */ }
        }

        $("lista").addEventListener("click", async function (ev) {
            var b = ev.target.closest("button");
            if (!b) return;
            if (b.dataset.ver) { abiertas[b.dataset.ver] = !abiertas[b.dataset.ver]; cargarLista(); }
            if (b.dataset.cancelar) {
                if (!confirm("¿Cancelar esta programación? Lo que ya salió se queda.")) return;
                try { await api("/api/programadas/" + b.dataset.cancelar + "/cancelar", { method: "POST" }); } catch (e) { alert(e.message); }
                cargarLista();
            }
            if (b.dataset.bajar) {
                try {
                    var r = await fetch(API + "/api/programadas/" + b.dataset.bajar + "/descargar", { credentials: "include" });
                    if (!r.ok) throw new Error(await Fiscontable.leerError(r));
                    var url = URL.createObjectURL(await r.blob()), a = document.createElement("a");
                    a.href = url; a.download = "Programada_" + modulo + ".zip"; a.click();
                    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
                } catch (e) { alert(e.message); }
            }
        });

        /* ---- ventana de programar */
        function pintarClientes() {
            var filtro = ($("buscar").value || "").trim().toUpperCase();
            var lista = (clientes || []).filter(function (q) {
                return !filtro || q.rfc.indexOf(filtro) >= 0 || (q.alias || "").toUpperCase().indexOf(filtro) >= 0;
            });
            if (!clientes || !clientes.length) {
                $("clientes").innerHTML = '<p class="ficha__nota" style="padding:10px">No tienes clientes con e.firma guardada. Guárdala en el directorio para poder programar.</p>';
            } else if (!lista.length) {
                $("clientes").innerHTML = '<p class="ficha__nota" style="padding:10px">Ninguno coincide con la búsqueda.</p>';
            } else {
                $("clientes").innerHTML = lista.map(function (q) {
                    return '<label class="fp-cliente"><input type="checkbox" value="' + esc(q.rfc) + '"' + (q.marcado ? " checked" : "") + ">" +
                        "<span>" + esc(q.alias || q.rfc) + " <small>" + esc(q.rfc) + "</small></span></label>";
                }).join("");
            }
            contar();
        }
        function contar() {
            var n = (clientes || []).filter(function (q) { return q.marcado; }).length;
            $("cuenta").textContent = n ? n + (n === 1 ? " cliente elegido." : " clientes elegidos.") : "";
            $("todos").checked = !!clientes && clientes.length > 0 && n === clientes.length;
        }
        $("clientes").addEventListener("change", function (ev) {
            var q = (clientes || []).find(function (x) { return x.rfc === ev.target.value; });
            if (q) q.marcado = ev.target.checked;
            contar();
        });
        $("todos").addEventListener("change", function () {
            var si = this.checked;
            (clientes || []).forEach(function (q) { q.marcado = si; });
            pintarClientes();
        });
        $("buscar").addEventListener("input", pintarClientes);
        $("noche").addEventListener("change", function () { $("noche-texto").textContent = textoNoche(this.value); });

        async function abrir() {
            $("error").hidden = true;
            $("fondo").hidden = false;
            try {
                if (!ventana) ventana = await api("/api/programadas/ventana");
                var yaEsMadrugada = new Date(ventana.inicio) - new Date() < 5 * 60000;
                $("ventana").textContent = (yaEsMadrugada
                    ? "Ya es madrugada: empieza en unos minutos"
                    : "Empieza " + dia(ventana.inicio) + " a una hora al azar desde las " + ventana.desde + " a. m.") +
                    " y termina a más tardar a las " + ventana.hasta + " a. m., con pausas al azar. Lo que no alcance queda marcado; no pasa a otra noche.";
                if (!clientes) {
                    var todos = await api("/api/clientes");
                    clientes = todos.filter(function (q) { return q.efirma_guardada; }).map(function (q) {
                        return { rfc: q.rfc, alias: q.alias, marcado: false };
                    });
                }
                var noche = $("noche"), siguiente = nocheSiguiente();
                noche.min = siguiente;
                var max = new Date(); max.setDate(max.getDate() + 60);
                noche.max = max.toISOString().slice(0, 10);
                if (!noche.value || noche.value < siguiente) noche.value = siguiente;
                $("noche-texto").textContent = textoNoche(noche.value);
                pintarClientes();
                $("buscar").focus();
            } catch (e) {
                $("error").textContent = e.message; $("error").hidden = false;
            }
        }
        function cerrar() { $("fondo").hidden = true; }

        $("abrir").addEventListener("click", abrir);
        $("cerrar").addEventListener("click", cerrar);
        $("fondo").addEventListener("click", function (ev) { if (ev.target === this) cerrar(); });
        document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !$("fondo").hidden) cerrar(); });

        $("enviar").addEventListener("click", async function () {
            var b = this;
            $("error").hidden = true;
            var rfcs = (clientes || []).filter(function (q) { return q.marcado; }).map(function (q) { return q.rfc; });
            try {
                if (!rfcs.length) throw new Error("Elige al menos un cliente.");
                var cuerpo = Object.assign({ modulo: modulo, rfcs: rfcs, noche: $("noche").value || null }, leerOpciones(modulo));
                b.disabled = true; b.textContent = "Programando…";
                var p = await api("/api/programadas", {
                    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo)
                });
                cerrar();
                (clientes || []).forEach(function (q) { q.marcado = false; });
                abiertas[p.id] = (p.conteo && p.conteo.revisar) > 0;        // si hay e.firmas con problema, se ven de una vez
                await cargarLista();
            } catch (e) {
                $("error").textContent = e.message; $("error").hidden = false;
            } finally {
                b.disabled = false; b.textContent = "Programar";
            }
        });

        cargarLista();
        setInterval(function () { if (!document.hidden) cargarLista(); }, 60000);
        recargas.push(function (abrirId) {
            if (abrirId) abiertas[abrirId] = true;
            cargarLista();
            caja.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
    }

    var recargas = [];
    /* Otra parte de la página (p. ej. "Varios a la vez") programó algo: se vuelve a pintar la lista. */
    function refrescar(abrirId) { recargas.forEach(function (f) { f(abrirId); }); }

    window.Fiscontable = window.Fiscontable || {};
    window.Fiscontable.Programar = { montar: montar, refrescar: refrescar, nocheSiguiente: nocheSiguiente, textoNoche: textoNoche };
})();
