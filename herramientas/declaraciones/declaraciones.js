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
        document.getElementById("resultado").hidden = true;
        fOpciones.scrollIntoView({ behavior: "smooth", block: "nearest" });
        cargarAlmacen(quien.rfc);
    }

    /* -------------------------------------------------- guardadas (almacén) */
    var MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    var almacen = null;

    async function pedirAlmacen(rfc, ejercicio) {
        var q = "?rfc=" + encodeURIComponent(rfc) + (ejercicio ? "&ejercicio=" + encodeURIComponent(ejercicio) : "");
        var resp = await fetch(API + "/api/declaraciones/almacen" + q, { credentials: "include" });
        if (!resp.ok) throw new Error(await leerError(resp));
        return resp.json();
    }

    /* El almacén no se muestra solo: un botón con cuántas hay y la ventana con la tabla */
    async function cargarAlmacen(rfc) {
        var b = document.getElementById("btn-guardadas");
        try {
            var a = await pedirAlmacen(rfc);
            if (!elegido || elegido.rfc !== rfc) return;
            almacen = a;
            b.hidden = !a.acceso || !a.ejercicios.length;
            document.getElementById("n-guardadas").textContent = a.documentos.length;
            b.title = a.documentos.length + " documento(s) del " + a.ejercicio;
        } catch (e) { b.hidden = true; }
    }

    function abrirGuardadas() {
        if (!elegido || !almacen) return;
        var rfc = elegido.rfc;
        Fiscontable.documentosGuardados({
            titulo: "Declaraciones guardadas",
            subtitulo: (elegido.alias ? elegido.alias + " · " : "") + rfc + ". Se guardan un año; si tu suscripción sigue vigente, se quedan.",
            filtro: { etiqueta: "Ejercicio", valor: almacen.ejercicio, opciones: almacen.ejercicios.map(function (e) { return { valor: e, texto: e }; }) },
            columnas: ["Mes", "Declaración", "Documento", "No. operación", "Guardada"],
            nombreZip: "Declaraciones_" + rfc,
            cargar: async function (ej) {
                var a = await pedirAlmacen(rfc, ej);
                return { nota: a.documentos.length + " documento(s) del " + a.ejercicio + ".",
                         documentos: a.documentos.map(function (d) {
                             var mes = MESES[+d.mes] || d.mes || "";
                             return { id: d.id, nombre: d.nombre, titulo: d.documento + " · " + mes + " " + a.ejercicio + " · " + rfc,
                                      url: API + "/api/declaraciones/almacen/archivo?id=" + d.id,
                                      celdas: [mes, d.tipo_declaracion || "", d.documento, d.num_operacion || "", (d.descargado_en || "").slice(0, 10)] };
                         }) };
            },
            zip: function (ids, ej) { return API + "/api/declaraciones/almacen/zip?rfc=" + encodeURIComponent(rfc) + "&ejercicio=" + encodeURIComponent(ej) + "&ids=" + ids.join(","); }
        });
    }
    document.getElementById("btn-guardadas").addEventListener("click", abrirGuardadas);

    function alLimpiar() {
        elegido = null;
        almacen = null;
        document.getElementById("btn-guardadas").hidden = true;
        document.getElementById("resultado").hidden = true;
        fEfirma.hidden = true;
        fOpciones.hidden = true;
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
        cuerpo.append("forzar", document.getElementById("forzar").checked ? "1" : "");

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
        btnBuscar.hidden = false;
        btnBuscar.textContent = "Buscar y descargar";
        document.getElementById("avance").hidden = true;
    }

    /* Mientras corre, el botón se cambia por el avance en la misma tarjeta */
    var inicio = 0;
    function mostrarProgreso() {
        inicio = Date.now();
        btnBuscar.hidden = true;
        document.getElementById("avance").hidden = false;
        document.getElementById("resultado").hidden = true;
        document.getElementById("btn-detener").hidden = false;
        document.getElementById("texto-progreso").textContent = "Arrancando…";
        document.getElementById("barra-fill").style.width = "8%";
    }

    function resultado(tipo, texto, accion) {
        var caja = document.getElementById("resultado");
        caja.className = "fc-resultado fc-resultado--" + tipo;
        caja.innerHTML = "<span>" + Fiscontable.escapar(texto) + "</span>";
        if (accion) {
            var b = document.createElement("button");
            b.type = "button"; b.textContent = accion.texto;
            b.addEventListener("click", function () { accion.hacer(b); });
            caja.appendChild(b);
        }
        caja.hidden = false;
    }

    function vigilar(jobId) {
        clearInterval(sondeo);
        sondeo = setInterval(async function () {
            try {
                var resp = await fetch(API + "/api/trabajos/" + jobId, { credentials: "include" });
                if (!resp.ok) return;     // reintenta en la siguiente vuelta
                var t = await resp.json();

                document.getElementById("texto-progreso").textContent = t.progreso || "Procesando…";
                document.getElementById("barra-fill").style.width = Math.min(8 + (Date.now() - inicio) / 1500, 92) + "%";

                if (t.estado === "procesando") return;

                detenerSondeo();
                liberarBoton();
                Fiscontable.refrescarDescargas();

                if (t.estado === "completado") {
                    if (t.en_pc && t.en_pc.rutas && t.en_pc.rutas.length) {
                        // Ya quedó en la PC del contador: no se vuelve a bajar solo
                        resultado("bien", t.progreso || "Listo.");
                        document.getElementById("resultado").appendChild(Fiscontable.cajaEnPc(t.en_pc, function (b) { bajar(jobId, t.nombre_descarga, b, "Descargar aquí"); }));
                    } else {
                        await (elegido ? cargarAlmacen(elegido.rfc) : Promise.resolve());
                        // Un solo lugar para verlas y bajarlas: la ventana de guardadas (si no hay acceso, el ZIP del trabajo)
                        if (!document.getElementById("btn-guardadas").hidden) resultado("bien", t.progreso || "Listo.", { texto: "Ver declaraciones", hacer: abrirGuardadas });
                        else resultado("bien", t.progreso || "Listo.", { texto: "Descargar", hacer: function (b) { bajar(jobId, t.nombre_descarga, b); } });
                    }
                } else {
                    resultado("mal", t.mensaje_error || "No se pudo completar.");
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

    async function bajar(jobId, nombre, boton, texto) {
        boton.disabled = true;
        boton.textContent = "Descargando…";
        try {
            var resp = await fetch(API + "/api/trabajos/" + jobId + "/descargar", { credentials: "include" });
            if (!resp.ok) { alerta(await leerError(resp)); return; }
            Fiscontable.guardarArchivo(await resp.blob(), nombre || (elegido.rfc + "_declaraciones.zip"));
        } catch (e) {
            alerta("El archivo se generó, pero no se pudo bajar. Búscalo en Mis descargas.");
        } finally {
            boton.disabled = false;
            boton.textContent = texto || "Descargar";
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
