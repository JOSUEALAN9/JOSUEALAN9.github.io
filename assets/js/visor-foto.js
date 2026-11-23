/**
 * visor-foto.js — Ver una foto de perfil en grande (23-nov-2026, el dueño: «que al picarle te la abra en grande»).
 * Un solo visor para Mi despacho › Equipo, Configuración › Mi perfil y el menú de la cuenta. Mi despacho lo carga desde el
 * principio; en las demás páginas lo carga barra.js la primera vez que se usa (Fiscontable.verFoto).
 *
 *   Fiscontable.visorFoto({ titulo, sub, ruta, previa, alt, volverA })
 *     titulo   el nombre de la persona (título de la ventana)
 *     sub      su papel («Titular», «Integrante»…) o «Tu foto de perfil»
 *     ruta     la dirección de la API de la foto grande (…?tam=grande&v=…); se pide con la sesión
 *     previa   la foto chica que ya se ve: sale mientras llega la grande
 *     volverA  a dónde regresa el foco al cerrar (por defecto, lo que tenía el foco al abrir)
 *
 * Es un <dialog class="fc-modal fc-modal--chica"> (estilos en common.css, «Visor de fotos»): cierra con ✕, Esc y clic
 * fuera; en el celular ocupa la pantalla. Las fotos de antes (256 px) se muestran a su tamaño, sin estirarlas.
 */
(function () {
    "use strict";
    var F = window.Fiscontable = window.Fiscontable || {};
    if (F.visorFoto) return;
    var dlg = null, turno = 0, urlGrande = null, volverA = null;

    function parte(sel) { return dlg.querySelector(sel); }

    function crear() {
        if (dlg) return;
        dlg = document.createElement("dialog");
        dlg.className = "fc-modal fc-modal--chica fc-visor";
        dlg.id = "fc-visor-foto";
        dlg.setAttribute("aria-labelledby", "fc-visor-titulo");
        dlg.innerHTML = '<div class="fc-modal__cabeza"><div><h2 id="fc-visor-titulo"></h2><p id="fc-visor-sub"></p></div>' +
            '<button type="button" class="fc-modal__cerrar" data-visor-cerrar aria-label="Cerrar">×</button></div>' +
            '<div class="fc-modal__cuerpo"><div class="fc-visor__marco"><img class="fc-visor__img" alt="" hidden></div>' +
            '<p class="fc-visor__estado" role="status" hidden></p></div>';
        document.body.appendChild(dlg);
        parte("[data-visor-cerrar]").addEventListener("click", function () { dlg.close(); });
        // Clic fuera: en el fondo oscuro el clic le llega al <dialog> mismo (su contenido lo cubre todo por dentro)
        dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
        // Esc lo cierra el navegador; que no siga a la página (ahí cerraría también menús o paneles de atrás)
        dlg.addEventListener("keydown", function (e) { if (e.key === "Escape") e.stopPropagation(); });
        dlg.addEventListener("close", function () {
            turno++;                                              // si la grande aún venía en camino, ya no se pinta
            soltar();
            var destino = volverA; volverA = null;
            if (destino && destino.isConnected && destino.getClientRects().length) {
                try { destino.focus({ preventScroll: true }); } catch (e) { /* sin foco */ }
            }
        });
    }

    function soltar() {
        if (urlGrande) { try { URL.revokeObjectURL(urlGrande); } catch (e) { /* nada */ } urlGrande = null; }
    }

    function decir(texto) {
        var p = parte(".fc-visor__estado");
        p.textContent = texto || ""; p.hidden = !texto;
    }

    function ponerLado(img) {
        // El cuadro mide lo que mide la foto (hasta lo que quepa): una de 256 no se estira a 464
        var lado = img && img.naturalWidth ? Math.max(img.naturalWidth, img.naturalHeight) : 0;
        if (lado) parte(".fc-visor__marco").style.setProperty("--visor-lado", lado + "px");
    }

    function abrir(o) {
        o = o || {};
        crear();
        var mio = ++turno;
        soltar();
        volverA = o.volverA || document.activeElement;
        var img = parte(".fc-visor__img"), marco = parte(".fc-visor__marco");
        parte("#fc-visor-titulo").textContent = o.titulo || "Foto de perfil";
        parte("#fc-visor-sub").textContent = o.sub || "";
        parte("#fc-visor-sub").hidden = !o.sub;
        img.alt = o.alt || ("Foto de " + (o.titulo || "perfil"));
        marco.style.removeProperty("--visor-lado");
        decir("");
        if (o.previa) { img.src = o.previa; img.hidden = false; }
        else { img.removeAttribute("src"); img.hidden = true; }
        marco.classList.toggle("fc-visor__marco--cargando", !!o.ruta);
        if (!dlg.open) dlg.showModal();
        if (!o.ruta) { if (o.previa) img.decode().then(function () { ponerLado(img); }, function () { /* nada */ }); return; }
        fetch((F.API || "") + o.ruta, { credentials: "include" })
            .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); })
            .then(function (b) {
                if (mio !== turno) return;
                var u = URL.createObjectURL(b), nueva = new Image();
                nueva.onload = function () {
                    if (mio !== turno) { URL.revokeObjectURL(u); return; }
                    urlGrande = u; img.src = u; img.hidden = false;
                    ponerLado(nueva);
                    marco.classList.remove("fc-visor__marco--cargando");
                };
                nueva.onerror = function () { URL.revokeObjectURL(u); if (mio === turno) fallo(); };
                nueva.src = u;
            })
            .catch(function () { if (mio === turno) fallo(); });

        function fallo() {
            marco.classList.remove("fc-visor__marco--cargando");
            if (o.previa) { ponerLado(img); decir("No se pudo traer la foto en grande; esta es la chica."); }
            else { marco.style.setProperty("--visor-lado", "160px"); decir("No se pudo cargar la foto. Revisa tu conexión e inténtalo otra vez."); }
        }
    }

    F.visorFoto = abrir;
})();
