/*
 * admin/pendientes-admin.js — Sistema › Estado › tarjeta «Pendientes» (solo admin). 21-nov-2026, el dueño: «esos puntos que me
 * faltan tenlos presentes, meter una tarjeta… para que me los recuerdes».
 *   Lo que le falta al dueño (no es código), por grupos. La casilla lo marca como hecho: se ve tachado y se pliega bajo
 *   «Hechos (N)» de su grupo. «+ Agregar» (o el + de cada grupo) abre una sola forma arriba; ✎ cambia el texto en su lugar;
 *   la papelera lo borra, con confirmación. El número de la cabecera («N pendientes») también sale en la pestaña Sistema, así
 *   que el punto del grupo «Sistema» lo recuerda desde cualquier apartado.
 *   API: /api/admin/pendientes (GET, POST) y /api/admin/pendientes/{id} (PATCH, DELETE); solo responde al admin.
 */
(function () {
    "use strict";
    var caja = document.getElementById("tarjeta-pendientes");
    if (!caja) return;
    var API = Fiscontable.API, esc = Fiscontable.escapar, ZONA = "America/Mexico_City";
    var datos = null, abiertos = {}, ocupado = false, formaGrupo = null, editando = null;
    var ICONO = {
        mas: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>',
        lapiz: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 3.5l3 3L7 16H4v-3z"/></svg>',
        borrar: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/></svg>'
    };

    function pedir(ruta, opciones) {
        opciones = opciones || {};
        if (opciones.cuerpo !== undefined) {
            opciones.body = JSON.stringify(opciones.cuerpo);
            opciones.headers = { "Content-Type": "application/json" };
        }
        return fetch(API + ruta, Object.assign({ credentials: "include" }, opciones)).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) {
                if (!r.ok) throw new Error(typeof j.detail === "string" && j.detail ? j.detail : "No se pudo guardar. Intenta de nuevo.");
                return j;
            });
        });
    }
    function diaCorto(iso) {
        if (!iso) return "";
        var s = String(iso); if (!/[zZ]|[+-]\d\d:\d\d$/.test(s)) s += "Z";
        var d = new Date(s);
        return isNaN(d) ? "" : d.toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: ZONA });
    }
    function mensaje(t) { var m = document.getElementById("pnd-msj"); if (m) m.textContent = t || ""; }
    function frase(n) { return n === 0 ? "Todo al día" : n === 1 ? "1 pendiente" : n + " pendientes"; }

    // El número también va en la pestaña «Sistema» (ámbar: enciende el punto de su grupo mientras quede algo)
    function contadorPestana(n) {
        var s = document.getElementById("cuenta-pendientes");
        if (!s) return;
        s.textContent = n ? String(n) : "";
        s.title = n ? frase(n) : "";
    }

    function item(p) {
        var id = String(p.id);
        if (editando === p.id) {
            return '<li class="pnd-item" data-id="' + id + '"><input class="pnd-item__editar" id="pnd-editar" maxlength="300" value="' +
                esc(p.texto) + '" aria-label="Texto del pendiente"></li>';
        }
        return '<li class="pnd-item' + (p.hecho ? " pnd-item--hecho" : "") + '" data-id="' + id + '">' +
            '<label><input type="checkbox" data-pnd="hecho"' + (p.hecho ? " checked" : "") + (ocupado ? " disabled" : "") + '>' +
            '<span class="pnd-texto"><span class="pnd-texto__t">' + esc(p.texto) + "</span>" + (p.hecho && p.hecho_en ? "<small>Hecho el " + esc(diaCorto(p.hecho_en)) + "</small>" : "") + "</span></label>" +
            '<span class="pnd-acciones">' +
            '<button type="button" class="pnd-icono" data-pnd="editar" title="Cambiar el texto" aria-label="Cambiar el texto">' + ICONO.lapiz + "</button>" +
            '<button type="button" class="pnd-icono pnd-icono--borrar" data-pnd="borrar" title="Borrar" aria-label="Borrar">' + ICONO.borrar + "</button>" +
            "</span></li>";
    }

    function grupo(nombre) {
        var todos = datos.pendientes.filter(function (p) { return p.grupo === nombre; });
        var faltan = todos.filter(function (p) { return !p.hecho; }), hechos = todos.filter(function (p) { return p.hecho; });
        return '<section class="pnd-grupo" data-grupo="' + esc(nombre) + '">' +
            '<div class="pnd-grupo__cabeza"><h3>' + esc(nombre) + "</h3>" +
            '<span class="pnd-grupo__n">' + (hechos.length ? esc(hechos.length + " de " + todos.length + (hechos.length === 1 ? " hecho" : " hechos")) : esc(String(todos.length))) + "</span>" +
            '<button type="button" class="pnd-icono pnd-grupo__mas" data-pnd="agregar-en" title="Agregar en «' + esc(nombre) + '»" aria-label="Agregar en «' +
            esc(nombre) + '»">' + ICONO.mas + "</button></div>" +
            (faltan.length ? '<ul class="pnd-lista">' + faltan.map(item).join("") + "</ul>" : '<p class="pnd-todo">✓ Todo hecho</p>') +
            (hechos.length ? '<details class="pnd-hechos"' + (abiertos[nombre] ? " open" : "") + '><summary>Hechos (' + hechos.length + ")</summary>" +
                '<ul class="pnd-lista">' + hechos.map(item).join("") + "</ul></details>" : "") +
            "</section>";
    }

    function forma() {
        if (formaGrupo === null) return "";
        var grupos = datos.grupos.slice();
        var nuevo = formaGrupo === "" || grupos.indexOf(formaGrupo) < 0;
        return '<form class="pnd-form" id="pnd-form" autocomplete="off">' +
            '<div class="pnd-form__grupo"><select id="pnd-grupo" aria-label="Grupo">' +
            grupos.map(function (g) { return '<option value="' + esc(g) + '"' + (g === formaGrupo ? " selected" : "") + ">" + esc(g) + "</option>"; }).join("") +
            '<option value=""' + (nuevo ? " selected" : "") + ">Grupo nuevo…</option></select>" +
            '<input id="pnd-grupo-nuevo" maxlength="60" placeholder="Nombre del grupo" aria-label="Nombre del grupo nuevo"' + (nuevo ? "" : " hidden") + "></div>" +
            '<input id="pnd-texto" maxlength="300" placeholder="¿Qué falta? (una frase corta)" aria-label="Pendiente">' +
            '<div class="pnd-form__botones"><button type="button" class="pnd-btn pnd-btn--suave" data-pnd="cancelar">Cancelar</button>' +
            '<button type="submit" class="pnd-btn pnd-btn--primario" id="pnd-guardar">Agregar</button></div></form>';
    }

    function pintar() {
        var n = datos.faltan;
        caja.innerHTML = '<div class="pnd-cabeza"><h2 class="pnd-titulo">Pendientes</h2>' +
            '<span class="pnd-cuenta' + (n ? "" : " pnd-cuenta--cero") + '" id="pnd-cuenta">' + esc(frase(n)) + "</span>" +
            '<button type="button" class="pnd-btn" data-pnd="nuevo"' + (formaGrupo !== null ? " disabled" : "") + ">+ Agregar</button></div>" +
            forma() +
            (datos.pendientes.length ? '<div class="pnd-grupos">' + datos.grupos.map(grupo).join("") + "</div>"
                : '<p class="pnd-vacio">No tienes pendientes anotados. Con «+ Agregar» anotas lo que te falta y aquí te lo recuerdo.</p>') +
            '<p class="pnd-msj" id="pnd-msj" role="status"></p>';
        contadorPestana(n);
        var t = document.getElementById(editando !== null ? "pnd-editar" : "pnd-texto");
        if (t && (editando !== null || formaGrupo !== null)) { t.focus(); if (editando !== null) t.setSelectionRange(t.value.length, t.value.length); }
    }

    function cargar() {
        return pedir("/api/admin/pendientes").then(function (d) { datos = d; pintar(); }).catch(function (e) {
            caja.innerHTML = '<div class="pnd-cabeza"><h2 class="pnd-titulo">Pendientes</h2></div><p class="pnd-msj">' + esc(e.message) + "</p>";
        });
    }

    // Un cambio a la vez: mientras corre, las casillas y botones quedan quietos (evita dobles)
    function cambiar(ruta, opciones, siguiente) {
        if (ocupado) return Promise.resolve();
        ocupado = true;
        caja.querySelectorAll("button, input, select").forEach(function (x) { x.disabled = true; });
        return pedir(ruta, opciones).then(function (d) {
            datos = d; ocupado = false; if (siguiente) siguiente(); pintar();
        }).catch(function (e) {
            ocupado = false; pintar(); mensaje(e.message);
        });
    }

    function porId(li) { var id = Number(li.dataset.id); return datos.pendientes.filter(function (p) { return p.id === id; })[0]; }

    caja.addEventListener("change", function (e) {
        if (e.target.id === "pnd-grupo") {
            var nuevo = document.getElementById("pnd-grupo-nuevo");
            nuevo.hidden = e.target.value !== "";
            (e.target.value === "" ? nuevo : document.getElementById("pnd-texto")).focus();
            return;
        }
        if (e.target.dataset.pnd !== "hecho") return;
        var li = e.target.closest(".pnd-item"), p = porId(li);
        if (p) cambiar("/api/admin/pendientes/" + p.id, { method: "PATCH", cuerpo: { hecho: e.target.checked } });
    });

    caja.addEventListener("toggle", function (e) {
        var d = e.target.closest && e.target.closest(".pnd-hechos");
        if (d) abiertos[d.closest(".pnd-grupo").dataset.grupo] = d.open;
    }, true);

    caja.addEventListener("click", function (e) {
        var b = e.target.closest("[data-pnd]");
        if (!b || b.disabled || b.dataset.pnd === "hecho") return;
        var accion = b.dataset.pnd;
        if (accion === "nuevo" || accion === "agregar-en") {
            var g = accion === "agregar-en" ? b.closest(".pnd-grupo").dataset.grupo : null;
            if (g === null) {          // el primer grupo con algo por hacer (o el primero)
                var conAlgo = datos.grupos.filter(function (x) { return datos.pendientes.some(function (p) { return p.grupo === x && !p.hecho; }); });
                g = conAlgo[0] || datos.grupos[0] || "";
            }
            formaGrupo = g; editando = null; pintar(); return;
        }
        if (accion === "cancelar") { formaGrupo = null; pintar(); return; }
        var li = b.closest(".pnd-item"), p = li && porId(li);
        if (!p) return;
        if (accion === "editar") { editando = p.id; formaGrupo = null; pintar(); return; }
        if (accion === "borrar") {
            var preguntar = Fiscontable.confirmar
                ? Fiscontable.confirmar({ titulo: "¿Borrar este pendiente?", texto: "«" + p.texto + "». No se puede deshacer.", si: "Borrar", peligro: true })
                : Promise.resolve(window.confirm("¿Borrar «" + p.texto + "»? No se puede deshacer."));
            preguntar.then(function (si) { if (si) cambiar("/api/admin/pendientes/" + p.id, { method: "DELETE" }); });
        }
    });

    caja.addEventListener("submit", function (e) {
        e.preventDefault();
        var sel = document.getElementById("pnd-grupo").value;
        var grupoElegido = sel || document.getElementById("pnd-grupo-nuevo").value.trim();
        var texto = document.getElementById("pnd-texto").value.trim();
        if (!grupoElegido) { mensaje("Escribe el nombre del grupo."); document.getElementById("pnd-grupo-nuevo").focus(); return; }
        if (!texto) { mensaje("Escribe qué falta."); document.getElementById("pnd-texto").focus(); return; }
        cambiar("/api/admin/pendientes", { method: "POST", cuerpo: { grupo: grupoElegido, texto: texto } }, function () { formaGrupo = null; });
    });

    // Cambiar el texto en su lugar: Enter guarda, Esc deja como estaba; al salir del campo también guarda
    function terminarEdicion(guardar) {
        var inp = document.getElementById("pnd-editar");
        if (editando === null || !inp) return;
        var p = datos.pendientes.filter(function (x) { return x.id === editando; })[0];
        var nuevo = inp.value.trim();
        if (!guardar || !p || !nuevo || nuevo === p.texto) {
            editando = null; pintar(); if (guardar && !nuevo) mensaje("El texto no puede quedar vacío: se dejó como estaba."); return;
        }
        var id = editando;
        cambiar("/api/admin/pendientes/" + id, { method: "PATCH", cuerpo: { texto: nuevo } }, function () { editando = null; });
    }
    caja.addEventListener("keydown", function (e) {
        if (e.target.id === "pnd-editar") {
            if (e.key === "Enter") { e.preventDefault(); terminarEdicion(true); }
            if (e.key === "Escape") { e.preventDefault(); terminarEdicion(false); }
        } else if (e.key === "Escape" && formaGrupo !== null && e.target.closest("#pnd-form")) {
            formaGrupo = null; pintar();
        }
    });
    caja.addEventListener("focusout", function (e) {
        if (e.target.id === "pnd-editar" && !ocupado) setTimeout(function () { if (editando !== null && document.activeElement !== e.target) terminarEdicion(true); }, 0);
    });

    // Solo el admin: a cualquier otro ni se le pregunta al servidor (que de todos modos contesta 403)
    Promise.resolve(Fiscontable.perfil()).then(function (perfil) {
        if (!perfil || perfil.rol !== "admin") return;
        cargar();
        var actualizar = document.getElementById("btn-actualizar-sistema");
        if (actualizar) actualizar.addEventListener("click", function () { if (!ocupado && editando === null && formaGrupo === null) cargar(); });
    });
})();
