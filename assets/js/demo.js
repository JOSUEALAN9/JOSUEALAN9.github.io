/**
 * demo.js — «Solicita una demo» (fiscontable.app/demo). Página pública: no pide sesión.
 * Manda la solicitud a /publico/demo (sin cookies) y muestra el «¡Listo!». El servidor revisa todo
 * (core/demos.py): el campo trampa, el tiempo mínimo para llenarlo y los topes por red y por correo.
 */
(function () {
    "use strict";
    var F = window.Fiscontable, inicio = Date.now();
    var forma = document.getElementById("dm-forma"), boton = document.getElementById("dm-enviar"), aviso = document.getElementById("en-aviso");
    function decir(texto) { aviso.textContent = texto; aviso.hidden = !texto; }
    forma.addEventListener("input", function () { decir(""); });
    forma.addEventListener("submit", async function (e) {
        e.preventDefault();
        var d = {};
        new FormData(forma).forEach(function (v, k) { d[k] = typeof v === "string" ? v.trim() : v; });
        d.acepto = forma.acepto.checked;
        d.t = Date.now() - inicio;
        if ((d.nombre || "").length < 3) { forma.nombre.focus(); return decir("Escribe tu nombre."); }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.correo || "")) { forma.correo.focus(); return decir("Escribe un correo válido: ahí te llega el acceso."); }
        if (!d.acepto) return decir("Para continuar, acepta el Aviso de privacidad.");
        boton.disabled = true; boton.textContent = "Enviando…";
        try {
            var r = await fetch(F.API + "/publico/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) });
            if (!r.ok) throw new Error(await F.leerError(r));
            var res = await r.json();
            document.getElementById("dm-forma-caja").hidden = true;
            document.getElementById("dm-listo").hidden = false;
            if (res.mensaje) document.getElementById("dm-listo-texto").textContent = res.mensaje + " Revisa también la carpeta de spam.";
        } catch (er) {
            decir(er instanceof TypeError || /conectar|servidor|sesión/i.test(er.message) ? "No pudimos enviar tu solicitud. Intenta de nuevo en unos minutos." : er.message);
            boton.disabled = false; boton.textContent = "Solicitar mi demo";
        }
    });
})();
