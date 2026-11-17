/* Antes iba en línea en la página (17-nov-2026: las páginas ya no llevan código en línea). */
(function () {
    "use strict";
    var $ = function (id) { return document.getElementById(id); };
    function avisar(t) { $("nm-aviso").textContent = t; $("nm-aviso").hidden = false; }
    async function iniciar() {
        var p = await Fiscontable.perfil();
        if (!p || p._error || p.rol !== "admin") { avisar("Esta página es solo para el administrador."); return; }
        try {
            var r = await fetch(Fiscontable.API + "/api/nomina/prueba", { credentials: "include" });
            if (!r.ok) throw new Error(await Fiscontable.leerError(r));
            // La página del motor pide tres librerías; aquí se le dan las copias de nuestro sitio (mismas versiones):
            // nada se carga de otros servidores (política de contenido, _headers).
            var pagina = (await r.text())
                .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/3\.11\.174\//g, "/assets/js/terceros/pdfjs/")
                .replace("https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js", "/assets/js/terceros/fflate.min.js")
                .replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>\s*/g, "");
            $("nm-marco").srcdoc = pagina;
            $("nm-marco").hidden = false;
            var e = await fetch(Fiscontable.API + "/api/nomina/estado", { credentials: "include" });
            if (e.ok) { var d = await e.json(); $("nm-version").textContent = "Motor " + d.motor; }
        } catch (err) { avisar("No se pudo abrir la prueba del motor: " + err.message); }
    }
    iniciar();
})();
