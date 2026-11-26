/*
 * configuracion/nombres-archivo.js — Configuración › Nombres de archivo (20-nov-2026, el dueño: «que el contador personalice
 * los nombres de archivo en Configuración, como las plantillas de correo»).
 *
 * Una plantilla por tipo de archivo (XML y PDF de un CFDI, Excel y reportes, ZIP de comprobantes, ZIP de un envío) con
 * piezas entre llaves, como las del correo de Envíos. La vista previa se arma aquí mismo con datos de ejemplo (la misma
 * limpieza que core/nombres.py: sin acentos, sin espacios, solo letras, números, «-» y «_»); quien decide al guardar es el
 * servidor (/api/nombres-archivo). En un despacho solo el titular las cambia y valen para todo el equipo.
 * configuracion.js la llama con FcNombresArchivo.pintar(caja, {api, enviar}).
 */
(function () {
    "use strict";
    var esc = Fiscontable.escapar;

    function ascii(t) { return String(t || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7f]/g, ""); }

    // La vista previa: lo mismo que nombres.armar con los datos de ejemplo de cada pieza
    function armar(tipo, texto, max) {
        var valores = {};
        tipo.piezas.forEach(function (p) { valores[p.clave] = p.ejemplo; });
        texto = (texto || "").trim() || tipo.fabrica;
        if (tipo.clave === "cfdi" && texto.indexOf("{uuid}") === -1) texto += "_{uuid}";
        var t = texto.replace(/\{(\w+)\}/g, function (todo, k) { return Object.prototype.hasOwnProperty.call(valores, k) ? valores[k] : ""; });
        t = ascii(t).replace(/[^0-9A-Za-z_.-]+/g, "-").replace(/([_-])[_-]+/g, "$1").replace(/\.{2,}/g, ".").replace(/^[-_.]+|[-_.]+$/g, "");
        return (t.slice(0, max - tipo.ext.length).replace(/[-_.]+$/, "") || "archivo") + tipo.ext;
    }

    // Lo que el servidor no dejaría guardar, dicho antes (el servidor vuelve a revisar todo)
    function errores(tipo, texto) {
        texto = (texto || "").trim();
        if (!texto) return "";
        var validas = tipo.piezas.map(function (p) { return p.clave; }), raras = [];
        texto.replace(/\{([^{}]*)\}/g, function (todo, k) { if (validas.indexOf(k) === -1) raras.push(todo); return todo; });
        if (raras.length) return "No se reconoce " + raras[0] + ". Usa las piezas de abajo.";
        var falta = tipo.obligatorias.filter(function (k) { return texto.indexOf("{" + k + "}") === -1; })[0];
        if (falta) return "Tiene que llevar {" + falta + "}: sin eso dos archivos podrían llamarse igual.";
        var fuera = texto.replace(/\{[^{}]*\}/g, "");
        if (/[^0-9A-Za-z_ -]/.test(ascii(fuera)) || /[{}]/.test(fuera)) return "Fuera de las llaves solo van letras, números, espacios, «-» y «_».";
        return "";
    }

    function pintar(caja, h) {
        caja.innerHTML = '<div class="cf-tarjeta"><p class="cf-texto">Cargando…</p></div>';
        h.api("/api/nombres-archivo").then(function (d) { dibujar(caja, h, d); }).catch(function (e) {
            caja.innerHTML = '<div class="cf-tarjeta"><p class="cf-texto">No se pudieron leer los nombres de archivo: ' + esc(e.message) + "</p></div>";
        });
    }

    function dibujar(caja, h, d) {
        var puede = !!d.puede_editar, alguna = d.tipos.some(function (t) { return t.propia; });
        caja.innerHTML =
            '<div class="cf-tarjeta cf-na">' +
            '<p class="cf-texto cf-na__intro">Arma cómo se llaman los archivos que bajas, los ZIP y lo que va en los envíos. Escribe el texto que quieras y ' +
            "toca una pieza para meterla donde está el cursor. " + esc(d.alcance) + "</p>" +
            (d.aviso ? '<p class="cf-na__aviso" role="note">' + esc(d.aviso) + "</p>" : "") +
            '<div class="cf-na__lista">' + d.tipos.map(function (t) {
                return '<section class="cf-na__tipo" data-clave="' + esc(t.clave) + '">' +
                    '<div class="cf-na__cab"><h3 class="cf-sub">' + esc(t.nombre) + "</h3>" +
                    '<span class="cf-na__marca" data-marca></span></div>' +
                    '<label class="cf-campo"><span>Plantilla</span><input type="text" autocomplete="off" spellcheck="false" maxlength="200" ' +
                    'data-plantilla value="' + esc(t.plantilla) + '"' + (puede ? "" : " disabled") + ' aria-describedby="cf-na-vista-' + esc(t.clave) + '"></label>' +
                    (puede ? '<div class="cf-na__piezas" role="group" aria-label="Piezas">' + t.piezas.map(function (p) {
                        return '<button type="button" class="cf-na__pieza" data-pieza="' + esc(p.clave) + '" title="' + esc(p.nombre) + " · " + esc(p.ejemplo) + '">{' + esc(p.clave) + "}</button>";
                    }).join("") + "</div>" : "") +
                    '<p class="cf-na__vista" id="cf-na-vista-' + esc(t.clave) + '"><small>Así quedaría</small><code data-vista></code></p>' +
                    '<p class="cf-na__error" data-error hidden></p>' +
                    '<p class="cf-na__fabrica"><small>De Fiscontable: <code>' + esc(t.fabrica) + "</code></small>" +
                    (puede ? ' <button type="button" class="cf-link" data-fabrica>Usar esta</button>' : "") + "</p>" +
                    "</section>";
            }).join("") + "</div>" +
            '<p class="cf-texto cf-na__nota">Siempre se quitan los acentos, los espacios y lo que Windows o Mac no aceptan, hasta ' + esc(d.max) +
            " letras. El XML y el PDF de un comprobante siempre llevan su folio fiscal (UUID), y si dos archivos de un ZIP quedan iguales, " +
            "al segundo se le agrega un pedazo de su UUID: nunca se pierde ninguno.</p>" +
            (puede ? '<div class="cf-acciones"><button type="button" class="cf-btn cf-btn--principal" id="cf-na-guardar">Guardar</button>' +
                '<button type="button" class="cf-btn" id="cf-na-fabrica"' + (alguna ? "" : " hidden") + ">Volver a los de Fiscontable</button>" +
                '<span class="cf-msj" role="status"></span></div>' : "") +
            "</div>";

        var tipos = {};
        d.tipos.forEach(function (t) { tipos[t.clave] = t; });
        function refrescar(sec) {
            var t = tipos[sec.dataset.clave], entrada = sec.querySelector("[data-plantilla]"), texto = entrada.value;
            var mal = errores(t, texto);
            sec.querySelector("[data-vista]").textContent = mal ? "—" : armar(t, texto, d.max);
            var e = sec.querySelector("[data-error]");
            e.hidden = !mal; e.textContent = mal;
            entrada.setAttribute("aria-invalid", mal ? "true" : "false");
            var propia = texto.trim() && texto.trim() !== t.fabrica;
            var marca = sec.querySelector("[data-marca]");
            marca.textContent = propia ? "Personalizada" : "De Fiscontable";
            marca.classList.toggle("cf-na__marca--propia", !!propia);
            return !mal;
        }
        var secciones = Array.prototype.slice.call(caja.querySelectorAll(".cf-na__tipo"));
        secciones.forEach(function (sec) {
            var entrada = sec.querySelector("[data-plantilla]");
            entrada.addEventListener("input", function () { refrescar(sec); });
            sec.querySelectorAll("[data-pieza]").forEach(function (b) {
                b.addEventListener("click", function () {
                    var k = "{" + b.dataset.pieza + "}", ini = entrada.selectionStart == null ? entrada.value.length : entrada.selectionStart;
                    var fin = entrada.selectionEnd == null ? ini : entrada.selectionEnd;
                    entrada.value = entrada.value.slice(0, ini) + k + entrada.value.slice(fin);
                    entrada.focus();
                    entrada.setSelectionRange(ini + k.length, ini + k.length);
                    refrescar(sec);
                });
            });
            var f = sec.querySelector("[data-fabrica]");
            if (f) f.addEventListener("click", function () { entrada.value = tipos[sec.dataset.clave].fabrica; refrescar(sec); entrada.focus(); });
            refrescar(sec);
        });
        if (!puede) return;

        var msj = caja.querySelector(".cf-msj");
        function aviso(ok, texto) {
            msj.textContent = texto; msj.className = "cf-msj " + (ok ? "cf-msj--ok" : "cf-msj--mal");
            clearTimeout(msj._reloj);        // 26-nov-2026 (el dueño): lo que salió bien se quita solo
            if (ok) msj._reloj = setTimeout(function () { if (msj.textContent === texto) { msj.textContent = ""; msj.className = "cf-msj"; } }, 4000);
        }
        var guardar = caja.querySelector("#cf-na-guardar"), fabrica = caja.querySelector("#cf-na-fabrica");
        guardar.addEventListener("click", function () {
            var bien = secciones.map(refrescar).every(Boolean);
            if (!bien) { aviso(false, "Revisa la plantilla marcada en rojo."); return; }
            var plantillas = {};
            secciones.forEach(function (sec) { plantillas[sec.dataset.clave] = sec.querySelector("[data-plantilla]").value.trim(); });
            guardar.disabled = true;
            h.enviar("/api/nombres-archivo", "PUT", { plantillas: plantillas }).then(function (r) {
                dibujar(caja, h, r);
                var m = caja.querySelector(".cf-msj");
                if (m) { m.textContent = "Listo. Lo que bajes desde ahora sale con estos nombres."; m.className = "cf-msj cf-msj--ok"; }
            }).catch(function (e) { guardar.disabled = false; aviso(false, e.message); });
        });
        fabrica.addEventListener("click", function () {
            if (!window.confirm("¿Volver a los nombres de Fiscontable? Se borran tus plantillas" + (d.en_despacho ? " para todo el despacho." : "."))) return;
            fabrica.disabled = true;
            h.api("/api/nombres-archivo", { method: "DELETE" }).then(function (r) {
                dibujar(caja, h, r);
                var m = caja.querySelector(".cf-msj");
                if (m) { m.textContent = "Listo. Los archivos vuelven a llamarse como siempre."; m.className = "cf-msj cf-msj--ok"; }
            }).catch(function (e) { fabrica.disabled = false; aviso(false, e.message); });
        });
    }

    window.FcNombresArchivo = { pintar: pintar, armar: armar, errores: errores };
})();
