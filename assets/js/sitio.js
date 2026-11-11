/**
 * sitio.js — Lo poco que se mueve en las páginas públicas (portada, legales, ayuda): el menú en el celular, la raya de
 * la barra al bajar y la entrada suave de las secciones. Sin esto la página se lee completa igual.
 */
(function () {
    "use strict";
    var barra = document.getElementById("st-barra"), boton = document.getElementById("st-menu"), nav = document.getElementById("st-nav");
    function menu(abierto) {
        if (!nav || !boton) return;
        nav.classList.toggle("abierto", abierto);
        boton.setAttribute("aria-expanded", abierto ? "true" : "false");
    }
    if (boton && nav) {
        boton.addEventListener("click", function () { menu(!nav.classList.contains("abierto")); });
        nav.addEventListener("click", function (e) { if (e.target.closest("a")) menu(false); });
        document.addEventListener("keydown", function (e) { if (e.key === "Escape" && nav.classList.contains("abierto")) { menu(false); boton.focus(); } });
    }
    // Con la sesión abierta, «Iniciar sesión» pasa a «Ir a mi tablero» (la página se queda como está).
    (function () {
        try { if (localStorage.getItem("fc-ya-entro") !== "1") return; } catch (e) { return; }
        var h = location.hostname;
        var api = "https://" + (/^pruebas\./.test(h) ? "api-pruebas." : "api.") + (/(^|\.)fiscontable\.app$/.test(h) ? "fiscontable.app" : "josuealan.com");
        fetch(api + "/api/mi-perfil", { credentials: "include", cache: "no-store" }).then(function (r) {
            if (r.status === 401) { try { localStorage.removeItem("fc-ya-entro"); } catch (e) { /* nada */ } }
            if (!r.ok) return;
            document.querySelectorAll("[data-entrar]").forEach(function (a) { a.href = "/inicio/"; a.textContent = a.getAttribute("data-entrar"); });
        }, function () { /* sin conexión: se queda «Iniciar sesión» */ });
    })();
    if (barra) {
        var raya = function () { barra.classList.toggle("baja", window.scrollY > 8); };
        raya();
        window.addEventListener("scroll", raya, { passive: true });
    }
    // Entrada suave: solo se esconde lo que todavía no se ve, y solo si el navegador puede avisar cuando aparezca
    if ("IntersectionObserver" in window && window.matchMedia("(prefers-reduced-motion: no-preference)").matches) {
        var alto = window.innerHeight, piezas = document.querySelectorAll(".st-titulo, .st-modulo, .st-foco, .st-seguro, .st-pasos li, .st-registro__dentro, .st-dudas__lista details");
        var ojo = new IntersectionObserver(function (vistas) {
            vistas.forEach(function (v) { if (v.isIntersecting) { v.target.classList.add("visto"); ojo.unobserve(v.target); } });
        }, { rootMargin: "0px 0px -8% 0px" });
        piezas.forEach(function (p) {
            if (p.getBoundingClientRect().top < alto) return;
            p.classList.add("st-rev"); ojo.observe(p);
        });
    }
})();
