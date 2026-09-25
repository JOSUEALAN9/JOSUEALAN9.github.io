/**
 * declaraciones.js — página de Declaraciones (antes vivía dentro del HTML).
 */
(function () {
    "use strict";
    var API = Fiscontable.API;

    var elegido = null;
    var sondeo = null;          // un único temporizador vivo
    var trabajoActual = null;
    var paso = null;

    var fEfirma   = document.getElementById("paso-efirma");
    var fOpciones = document.getElementById("paso-opciones");
    var fProgreso = document.getElementById("paso-progreso");
    var btnBuscar = document.getElementById("btn-buscar");

    /* ---- Ejercicios: se generan del año en curso hacia atrás, para no
            tener que mantener un valor fijo cada enero. ---- */
    (function () {
        var select = document.getElementById("ejercicio");
        var hoy = new Date().getFullYear();
        for (var a = hoy; a >= hoy - 10; a--) {
            var o = document.createElement("option");
            o.value = a; o.textContent = a;
            select.appendChild(o);
        }
    })();

    document.getElementById("ver-password").addEventListener("click", function () {
        var c = document.getElementById("password");
        c.type = c.type === "password" ? "text" : "password";
        this.setAttribute("aria-label", c.type === "password" ? "Mostrar contraseña" : "Ocultar contraseña");
    });

    function alerta(mensaje) {
        var caja = document.getElementById("alerta");
        caja.textContent = mensaje;
        caja.hidden = false;
        caja.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    function sinAlerta() { document.getElementById("alerta").hidden = true; }

    async function leerError(resp) {
        if (!resp) return "No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.";
        if (resp.status === 401 || resp.status === 403) return "Tu sesión expiró. Recarga la página para entrar otra vez.";
        try {
            var d = await resp.json();
            return d.detail || "El servidor respondió con un error (" + resp.status + ").";
        } catch (e) {
            return "El servidor respondió con un error (" + resp.status + ").";
        }
    }

    /* -------------------------------------------------- pasos */

    function alElegir(quien) {
        elegido = quien;
        sinAlerta();
        fEfirma.hidden = quien.efirmaGuardada;
        // Si el .cer ya vino del paso "¿Para quién?", aquí no se vuelve a pedir.
        document.getElementById("campo-cer").style.display = quien.cer ? "none" : "";
        // 12 caracteres = persona moral, 13 = persona física.
        document.getElementById("tipo-persona").value = quien.rfc.length === 13 ? "pf" : "pm";
        fOpciones.hidden = false;
        fOpciones.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function alLimpiar() {
        elegido = null;
        fEfirma.hidden = true;
        fOpciones.hidden = true;
        fProgreso.hidden = true;
    }

    /* ------------------------------------------------ arranque */

    async function buscar() {
        sinAlerta();
        if (!elegido) { alerta("Primero indica de quién es el trabajo."); return; }

        var portales = [];
        if (document.getElementById("portal-nuevo").checked) portales.push("nuevo");
        if (document.getElementById("portal-antiguo").checked) portales.push("antiguo");
        if (!portales.length) { alerta("Marca al menos un portal del SAT."); return; }

        var cuerpo = new FormData();
        cuerpo.append("tipo_persona", document.getElementById("tipo-persona").value);
        cuerpo.append("ejercicio", document.getElementById("ejercicio").value);
        cuerpo.append("portales", portales.join(","));
        cuerpo.append("tipos_documento", "detalle,pago,recibo");

        var ruta;
        if (elegido.efirmaGuardada) {
            ruta = "/api/clientes/" + encodeURIComponent(elegido.rfc) + "/descargar-declaraciones";
        } else {
            var cer = elegido.cer || document.getElementById("cer").files[0];
            var key = document.getElementById("key").files[0];
            var pwd = document.getElementById("password").value;
            if (!cer || !key || !pwd) {
                alerta("Faltan el .cer, el .key o la contraseña de la e.firma.");
                return;
            }
            ruta = "/api/declaraciones/iniciar";
            cuerpo.append("rfc", elegido.rfc);
            cuerpo.append("password", pwd);
            cuerpo.append("cer", cer);
            cuerpo.append("key", key);
        }

        // El botón se queda apagado hasta que el trabajo termine. Antes se
        // reactivaba en el `finally` incluso cuando el trabajo ya había
        // arrancado, y un doble clic lanzaba dos robots al SAT por el
        // mismo RFC.
        btnBuscar.disabled = true;
        btnBuscar.textContent = "Arrancando…";

        try {
            var resp = await fetch(API + ruta, { method: "POST", credentials: "include", body: cuerpo });
            if (!resp.ok) {
                alerta(await leerError(resp));
                liberarBoton();
                return;
            }
            var datos = await resp.json();
            trabajoActual = datos.job_id;
            mostrarProgreso();
            vigilar(datos.job_id);
            Fiscontable.refrescarDescargas();
        } catch (e) {
            alerta(await leerError(null));
            liberarBoton();
        }
    }

    function liberarBoton() {
        btnBuscar.disabled = false;
        btnBuscar.textContent = "Buscar y descargar";
    }

    function mostrarProgreso() {
        fProgreso.hidden = false;
        document.getElementById("giro").style.display = "";
        document.getElementById("resultado").hidden = true;
        document.getElementById("btn-detener").hidden = false;
        document.getElementById("texto-progreso").textContent = "Arrancando…";
        fProgreso.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function vigilar(jobId) {
        clearInterval(sondeo);
        sondeo = setInterval(async function () {
            try {
                var resp = await fetch(API + "/api/trabajos/" + jobId, { credentials: "include" });
                if (!resp.ok) return;     // reintenta en la siguiente vuelta
                var t = await resp.json();

                document.getElementById("texto-progreso").textContent = t.progreso || "Procesando…";

                if (t.estado === "procesando") return;

                detenerSondeo();
                document.getElementById("giro").style.display = "none";
                document.getElementById("btn-detener").hidden = true;
                liberarBoton();
                Fiscontable.refrescarDescargas();

                var caja = document.getElementById("resultado");
                caja.hidden = false;

                if (t.estado === "completado") {
                    caja.innerHTML =
                        '<div style="background:#ECFDF3;border:1px solid #A9E5C3;border-radius:10px;padding:13px;font-size:13.5px;color:#05603A">' +
                        Fiscontable.escapar(t.progreso || "Listo.") +
                        '</div><button type="button" id="btn-bajar" class="boton-principal" style="margin-top:12px">Descargar</button>';
                    document.getElementById("btn-bajar").addEventListener("click", function () {
                        bajar(jobId, t.nombre_descarga, this);
                    });
                } else {
                    caja.innerHTML =
                        '<div style="background:#FFFBF3;border:1px solid #FCD9A6;border-radius:10px;padding:13px;font-size:13.5px;color:#7A4A05">' +
                        Fiscontable.escapar(t.mensaje_error || "No se pudo completar.") + "</div>";
                }
            } catch (e) {
                // Un tropiezo de red no mata el seguimiento: se reintenta.
            }
        }, 2500);
    }

    function detenerSondeo() {
        clearInterval(sondeo);
        sondeo = null;
    }

    async function bajar(jobId, nombre, boton) {
        boton.disabled = true;
        boton.textContent = "Descargando…";
        try {
            var resp = await fetch(API + "/api/trabajos/" + jobId + "/descargar", { credentials: "include" });
            if (!resp.ok) { alerta(await leerError(resp)); return; }
            var url = URL.createObjectURL(await resp.blob());
            var a = document.createElement("a");
            a.href = url;
            a.download = nombre || (elegido.rfc + "_declaraciones.zip");
            a.click();
            setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        } catch (e) {
            alerta("El archivo se generó, pero no se pudo bajar. Búscalo en Mis descargas.");
        } finally {
            boton.disabled = false;
            boton.textContent = "Descargar";
        }
    }

    document.getElementById("btn-detener").addEventListener("click", async function () {
        this.disabled = true;
        this.textContent = "Deteniendo…";
        try {
            await fetch(API + "/api/trabajos/" + trabajoActual + "/cancelar",
                { method: "POST", credentials: "include" });
        } catch (e) { /* el sondeo va a reflejar el estado real */ }
        this.disabled = false;
        this.textContent = "Detener";
    });

    btnBuscar.addEventListener("click", buscar);

    // Sin temporizadores huérfanos al salir de la página.
    window.addEventListener("pagehide", detenerSondeo);

    /* --------------------------------------------- inicio real */
    (async function () {
        // Se verifica el permiso ANTES de mostrar nada. Antes este módulo
        // dejaba llenar todo el formulario para que el backend lo
        // rechazara al final.
        if (!(await Fiscontable.exigirModulo("declaraciones"))) return;
        paso = PasoCliente.montar({
            contenedor: "paso-cliente",
            alElegir: alElegir,
            alLimpiar: alLimpiar
        });
    })();
})();
