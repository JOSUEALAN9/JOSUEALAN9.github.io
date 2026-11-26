/**
 * declaraciones.js — página de Declaraciones (antes vivía dentro del HTML).
 *
 * 24-nov-2026 (Alan, con captura de producción): se pedía la búsqueda de una empresa, se cambiaba de empresa y el panel
 * de avance pasaba a decir el nombre de la NUEVA, y al terminar se recargaba lo guardado de la elegida en ese momento. Y no
 * se podía pedir otra mientras corría («Descargando…»). Ahora cada búsqueda nace amarrada a su empresa (el servidor guarda
 * empresa, años y portales: /api/declaraciones/busquedas), se pueden pedir varias (el servidor las pone en fila: una por
 * persona, una por empresa; dos iguales se unen) y el panel es una lista «En curso / En fila (N) / Terminadas», cada renglón
 * con su empresa, su avance y su «Detener» o «Ver». Al volver a la página (F5) se ve lo que sigue en curso.
 */
(function () {
    "use strict";
    var API = Fiscontable.API;

    var elegido = null;
    var paso = null;

    var fEfirma   = document.getElementById("paso-efirma");
    var fOpciones = document.getElementById("paso-opciones");
    var btnBuscar = document.getElementById("btn-buscar");

    /* ---- Ejercicios: se generan del año en curso hacia atrás, para no
            tener que mantener un valor fijo cada enero.
            24-nov-2026 (a2ses): «Desde año / Hasta año» (hasta 10 años en una sola búsqueda; de fábrica, el año en curso). ---- */
    var MAX_ANIOS = 10;
    var selDesde = document.getElementById("ejercicio");
    var selHasta = document.getElementById("ejercicio-hasta");
    (function () {
        var hoy = new Date().getFullYear();
        [selDesde, selHasta].forEach(function (select) {
            for (var a = hoy; a >= hoy - 10; a--) {
                var o = document.createElement("option");
                o.value = a; o.textContent = a;
                select.appendChild(o);
            }
        });
    })();
    function aniosElegidos() {
        var a = +selDesde.value, b = +selHasta.value;
        return { desde: Math.min(a, b), hasta: Math.max(a, b) };
    }
    function alCambiarAnios(cual) {
        // Que el rango nunca quede al revés: si «Desde» pasa a «Hasta» (o al revés), el otro lo sigue
        if (cual === "desde" && +selDesde.value > +selHasta.value) selHasta.value = selDesde.value;
        if (cual === "hasta" && +selHasta.value < +selDesde.value) selDesde.value = selHasta.value;
        var r = aniosElegidos();
        document.getElementById("nota-anios").hidden = r.desde === r.hasta;
    }
    selDesde.addEventListener("change", function () { alCambiarAnios("desde"); });
    selHasta.addEventListener("change", function () { alCambiarAnios("hasta"); });

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

    var autDecl = null;

    function alElegir(quien) {
        elegido = quien;
        sinAlerta();
        fEfirma.hidden = quien.efirmaGuardada;
        if (window.FcAutorizacion && !quien.efirmaGuardada) {        // 19-nov-2026: la autorización del titular
            autDecl = autDecl || window.FcAutorizacion.montar("decl-autoriza");
            autDecl.limpiar(); autDecl.rfc(quien.rfc);
        }
        // Si el .cer ya vino del paso "¿Para quién?", aquí no se vuelve a pedir.
        document.getElementById("campo-cer").style.display = quien.cer ? "none" : "";
        // 12 caracteres = persona moral, 13 = persona física.
        document.getElementById("tipo-persona").value = quien.rfc.length === 13 ? "pf" : "pm";
        fOpciones.hidden = false;
        // 24-nov-2026: los resultados ya no se esconden al cambiar de empresa: cada uno dice de qué empresa es y su botón abre
        // lo de ESA empresa
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

    /* El almacén no se muestra automáticamente: un botón con cuántas hay y la ventana con la tabla */
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

    /* La ventana de guardadas es de UNA empresa: la elegida (botón de arriba) o la de una búsqueda que terminó («Ver»),
       aunque ya se haya cambiado de empresa (24-nov-2026). ejercicio: el año con el que abre, si lo tiene guardado. */
    async function abrirGuardadas(quien, ejercicio) {
        quien = quien && quien.rfc ? quien : elegido;
        if (!quien) return false;
        var rfc = quien.rfc, nombre = quien.alias || rfc;
        var a = elegido && elegido.rfc === rfc && almacen ? almacen : null;
        if (!a) {
            try { a = await pedirAlmacen(rfc); } catch (e) { alerta(e.message || "No se pudo abrir lo guardado de " + nombre + "."); return null; }
        }
        if (!a.acceso || !a.ejercicios.length) return false;
        var anios = a.ejercicios.map(String), valor = ejercicio && anios.indexOf(String(ejercicio)) >= 0 ? String(ejercicio) : a.ejercicio;
        Fiscontable.documentosGuardados({
            titulo: "Declaraciones guardadas",
            subtitulo: (quien.alias ? quien.alias + " · " : "") + rfc + ". Se guardan " + Fiscontable.textoPlazo("declaraciones") + "; si tu suscripción sigue vigente, se quedan. Si se van a eliminar, recibirás un aviso 30 días antes.",
            filtro: { etiqueta: "Ejercicio", valor: valor, opciones: a.ejercicios.map(function (e) { return { valor: e, texto: e }; }) },
            // M-05: un renglón por declaración (mes + número de operación); sus documentos salen como etiquetas.
            // 19-nov-2026 (el dueño): agrupadas por mes (abierto el más reciente) y con el portal del SAT de donde salió.
            columnas: ["Declaración", "Portal", "No. operación", "Guardada"],
            agrupar: true,
            nombreZip: "Declaraciones_" + rfc,
            unidad: ["declaración", "declaraciones"],
            // G-14: los documentos de esa declaración, adjuntos, por el correo de la cuenta
            enviar: function (x) {
                Fiscontable.enviarCorreo({ titulo: "Enviar la declaración de " + (x.grupoTitulo || x.celdas[0] || "") + " · " + nombre,
                                           ruta: "/api/declaraciones/almacen/enviar", datos: { rfc: rfc, ids: x.docs.map(function (a) { return a.id; }) } });
            },
            cargar: async function (ej) {
                var a = await pedirAlmacen(rfc, ej), grupos = {}, orden = [];
                a.documentos.forEach(function (d) {
                    var k = (d.mes || "") + "|" + (d.num_operacion || ("sin-" + (d.tipo_declaracion || "") + d.id));
                    if (!grupos[k]) { grupos[k] = { mes: d.mes, tipo: d.tipo_declaracion || "", op: d.num_operacion || "", portal: d.portal || "", guardada: "", docs: [] }; orden.push(k); }
                    var g = grupos[k], mes = MESES[+d.mes] || d.mes || "";
                    if (!g.tipo && d.tipo_declaracion) g.tipo = d.tipo_declaracion;
                    if (!g.portal && d.portal) g.portal = d.portal;
                    if ((d.descargado_en || "") > g.guardada) g.guardada = d.descargado_en || "";
                    g.docs.push({ id: d.id, etiqueta: d.documento || "Documento", nombre: d.nombre, url: API + "/api/declaraciones/almacen/archivo?id=" + d.id,
                                  titulo: d.documento + " · " + mes + " " + a.ejercicio + " · " + rfc, _o: +d.tipo_documento || 9 });
                });
                var filas = orden.map(function (k) {
                    var g = grupos[k];
                    g.docs.sort(function (x, y) { return x._o - y._o; });
                    var portal = g.portal === "antiguo" ? { texto: "Anterior", pastilla: "antiguo", etiqueta: "Portal" } : g.portal === "nuevo" ? { texto: "Nuevo", pastilla: "nuevo", etiqueta: "Portal" } :
                        g.portal === "diot" ? { texto: "DIOT", pastilla: "diot", etiqueta: "Portal" } : "—";      // 23-nov-2026: la DIOT presentada desde aquí
                    return { id: "d" + g.docs[0].id, mes: +g.mes || 0, docs: g.docs, guardada: g.guardada,
                             grupo: "m" + (g.mes || "SD"), grupoTitulo: (MESES[+g.mes] || (g.mes ? "Mes " + g.mes : "Sin mes")) + " " + a.ejercicio,
                             celdas: [g.portal === "diot" ? "DIOT · " + (g.tipo || "Normal") : (g.tipo || "Declaración"), portal, g.op, g.guardada.slice(0, 10)] };
                });
                // El mes más reciente primero; dentro del mes, la guardada al último arriba
                filas.sort(function (x, y) { return (y.mes - x.mes) || (y.guardada > x.guardada ? 1 : y.guardada < x.guardada ? -1 : 0); });
                return { nota: filas.length + " declaración(es) · " + a.documentos.length + " documento(s) del " + a.ejercicio + ".", documentos: filas };
            },
            zip: function (ids, ej) { return API + "/api/declaraciones/almacen/zip?rfc=" + encodeURIComponent(rfc) + "&ejercicio=" + encodeURIComponent(ej) + "&ids=" + ids.join(","); }
        });
        return true;
    }
    document.getElementById("btn-guardadas").addEventListener("click", function () { abrirGuardadas(elegido); });
    // 23-nov-2026 (DIOT en ceros, diot.js): al terminar un lote, el acuse ya está en el almacén de la empresa elegida
    window.addEventListener("fiscontable:diot-terminada", function () { if (elegido) cargarAlmacen(elegido.rfc); });

    function alLimpiar() {
        elegido = null;
        almacen = null;
        document.getElementById("btn-guardadas").hidden = true;
        fEfirma.hidden = true;
        fOpciones.hidden = true;
    }

    /* ------------------------------------------------ arranque */

    async function buscar() {
        sinAlerta();
        if (!elegido) { alerta("Primero indica de quién es el trabajo."); return; }
        // 24-nov-2026: la búsqueda se amarra AQUÍ a su empresa (y a sus años y portales); cambiar de empresa después ya no la toca
        var quien = { rfc: elegido.rfc, alias: elegido.alias || "" };

        var portales = [];
        if (document.getElementById("portal-nuevo").checked) portales.push("nuevo");
        if (document.getElementById("portal-antiguo").checked) portales.push("antiguo");
        if (!portales.length) { alerta("Marca al menos un portal del SAT."); return; }

        var anios = aniosElegidos();
        if (anios.hasta - anios.desde + 1 > MAX_ANIOS) { alerta("Elige hasta " + MAX_ANIOS + " años por búsqueda."); return; }

        var cuerpo = new FormData();
        cuerpo.append("tipo_persona", document.getElementById("tipo-persona").value);
        cuerpo.append("ejercicio", String(anios.desde));
        if (anios.hasta !== anios.desde) cuerpo.append("ejercicio_hasta", String(anios.hasta));
        cuerpo.append("portales", portales.join(","));
        cuerpo.append("tipos_documento", "detalle,pago,recibo");
        cuerpo.append("forzar", document.getElementById("forzar").checked ? "1" : "");

        var ruta;
        if (elegido.efirmaGuardada) {
            ruta = "/api/clientes/" + encodeURIComponent(quien.rfc) + "/descargar-declaraciones";
        } else {
            var cer = elegido.cer || document.getElementById("cer").files[0];
            var key = document.getElementById("key").files[0];
            var pwd = document.getElementById("password").value;
            if (!cer || !key || !pwd) {
                alerta("Faltan el .cer, el .key o la contraseña de la e.firma.");
                return;
            }
            if (autDecl && !autDecl.exigir()) {
                alerta("Marca la casilla de la autorización del titular para usar su e.firma.");
                return;
            }
            cuerpo.append("autorizo", autDecl ? autDecl.valor() : "false");
            ruta = "/api/declaraciones/iniciar";
            cuerpo.append("rfc", quien.rfc);
            cuerpo.append("password", pwd);
            cuerpo.append("cer", cer);
            cuerpo.append("key", key);
        }

        /* 24-nov-2026: el botón ya no se queda «Descargando…» hasta que termine: se apaga solo mientras se manda la petición y
           después se puede pedir otra (otra empresa u otros años). El servidor la pone en fila, y si es igual a una que ya va
           (doble clic, u otra persona del despacho), la une a esa: no se lanzan dos robots al SAT por lo mismo. */
        btnBuscar.disabled = true;
        btnBuscar.textContent = "Pidiendo…";
        try {
            var resp = await fetch(API + ruta, { method: "POST", credentials: "include", body: cuerpo });
            if (!resp.ok) { alerta(await leerError(resp)); return; }
            var datos = await resp.json();
            Fiscontable.refrescarDescargas();
            seguir(datos.job_id, { job_id: datos.job_id, rfc: quien.rfc, alias: quien.alias,
                                   anios: anios.desde === anios.hasta ? String(anios.desde) : anios.desde + "–" + anios.hasta,
                                   estado: datos.en_fila ? "en_fila" : "corriendo", progreso: datos.en_fila ? "En fila." : "Iniciando",
                                   propia: !datos.unido, puede_detener: !datos.unido, unido: !!datos.unido });
            if (datos.aviso) avisoBreve(datos.aviso);
        } catch (e) {
            alerta(await leerError(null));
        } finally {
            btnBuscar.disabled = false;
            btnBuscar.textContent = "Buscar y descargar";
        }
    }

    // Una línea que dice qué pasó con lo que se acaba de pedir (y se va sola); los errores siguen en la alerta de arriba
    var relojAviso = null;
    function avisoBreve(texto) {
        var caja = document.getElementById("aviso-fila");
        if (!caja) {
            caja = document.createElement("p");
            caja.id = "aviso-fila"; caja.className = "ficha__nota"; caja.setAttribute("role", "status");
            caja.style.cssText = "margin-top:10px;overflow-wrap:anywhere";
            btnBuscar.insertAdjacentElement("afterend", caja);
        }
        caja.textContent = texto;
        caja.hidden = false;
        clearTimeout(relojAviso);
        relojAviso = setTimeout(function () { caja.hidden = true; }, 9000);
    }

    /* ------------------------------------------------ la fila: el panel con todas las búsquedas (24-nov-2026)
       busquedas[job_id] = lo último que dijo el servidor de esa búsqueda (empresa, años, estado, avance). El título y cada
       renglón salen de ahí, nunca de la empresa elegida en pantalla. Un solo temporizador para todas. */
    var ACTIVAS = { corriendo: 1, deteniendo: 1, en_fila: 1 };
    var MAX_TERMINADAS = 6;
    var busquedas = {}, orden = [], sondeo = null, ocupado = false;

    function nombreDe(b) { return (b.alias || b.rfc) + " · " + (b.anios || ""); }

    var panel = Fiscontable.panelTrabajo({ alAccion: function (fila, boton) { accionFila(fila, boton); } });

    function filaDe(b) {
        var f = { titulo: nombreDe(b), b: b, clase: "", texto: "" };
        if (b.estado === "corriendo") { f.clase = "va"; f.texto = b.progreso || "Buscando…"; }
        else if (b.estado === "deteniendo") { f.clase = "va"; f.texto = "Deteniendo: termina el paso en que va con el SAT; después sigue la fila."; }
        else if (b.estado === "en_fila") { f.clase = "fila"; f.texto = Fiscontable.enFila(b.progreso) || "En fila."; }   // 25-nov-2026: ámbar, como «esperando»
        else if (b.estado === "completado") { f.clase = /fallaron/i.test(b.progreso || "") ? "mal" : "ok"; f.texto = b.progreso || "Terminó."; }
        else if (b.estado === "cancelado") { f.clase = "mal"; f.texto = "Detenida."; }
        else { f.clase = "mal"; f.texto = b.mensaje_error || "No se pudo completar."; }
        if (ACTIVAS[b.estado] && b.unido) f.texto = "Te uniste a esta búsqueda: la pidió otra persona del despacho. " + f.texto;
        if (ACTIVAS[b.estado] && b.puede_detener) {
            f.boton = "Detener";
            f.botonTitulo = b.estado === "en_fila" ? "Quitarla de la fila (no se toca el SAT)" : "Detenerla (termina el paso en que va con el SAT)";
        } else if (b.estado === "completado") {
            f.boton = "Ver"; f.botonTitulo = "Ver lo que se bajó de " + (b.alias || b.rfc);
        }
        return f;
    }

    function pintarPanel() {
        var lista = orden.map(function (id) { return busquedas[id]; }).filter(Boolean);
        if (!lista.length) { panel.cerrar(); return; }
        var curso = lista.filter(function (b) { return b.estado === "corriendo" || b.estado === "deteniendo"; });
        var fila = lista.filter(function (b) { return b.estado === "en_fila"; });
        var fin = lista.filter(function (b) { return !ACTIVAS[b.estado]; });
        var filas = [];
        if (curso.length) { filas.push({ seccion: "En curso" }); curso.forEach(function (b) { filas.push(filaDe(b)); }); }
        if (fila.length) { filas.push({ seccion: "En fila (" + fila.length + ")" }); fila.forEach(function (b) { filas.push(filaDe(b)); }); }
        if (fin.length) { filas.push({ seccion: "Terminadas" }); fin.forEach(function (b) { filas.push(filaDe(b)); }); }
        var corre = curso.length + fila.length > 0;
        var estado = corre ? [curso.length ? curso.length + " en curso" : "", fila.length ? fila.length + " en fila" : ""].filter(Boolean).join(" · ")
            : (fin.length === 1 ? (fin[0].estado === "completado" ? "Terminó" : fin[0].estado === "cancelado" ? "Detenida" : "Se detuvo con error") : "Terminaron");
        panel.pintar({ titulo: "Declaraciones", corre: corre, estado: estado, filas: filas });
    }

    // Lo que llega del servidor (o lo que se acaba de pedir, mientras contesta): se guarda, se ordena y se pinta
    function recibir(lista) {
        lista.forEach(function (b) {
            if (!b || !b.job_id) return;
            var antes = busquedas[b.job_id], ahora = antes ? Object.assign({}, antes, b) : b;
            busquedas[b.job_id] = ahora;
            if (antes && ACTIVAS[antes.estado] && !ACTIVAS[ahora.estado]) alTerminar(ahora);
        });
        var todas = Object.keys(busquedas).map(function (id) { return busquedas[id]; });
        var rango = { corriendo: 0, deteniendo: 0, en_fila: 1 };
        var activas = todas.filter(function (b) { return ACTIVAS[b.estado]; })
            .sort(function (x, y) { return (rango[x.estado] - rango[y.estado]) || String(x.creado_en || "~").localeCompare(String(y.creado_en || "~")); });
        var fin = todas.filter(function (b) { return !ACTIVAS[b.estado]; })
            .sort(function (x, y) { return String(y._termino || y.actualizado_en || "").localeCompare(String(x._termino || x.actualizado_en || "")); });
        fin.slice(MAX_TERMINADAS).forEach(function (b) { delete busquedas[b.job_id]; });     // solo las últimas terminadas
        orden = activas.concat(fin.slice(0, MAX_TERMINADAS)).map(function (b) { return b.job_id; });
        pintarPanel();
        var hay = activas.length > 0;
        if (hay && !sondeo) sondeo = setInterval(sondear, 2500);
        if (!hay && sondeo) { clearInterval(sondeo); sondeo = null; }
    }

    function seguir(jobId, inicial) {
        if (!jobId) return;
        recibir([busquedas[jobId] ? { job_id: jobId } : inicial]);
        sondear();
    }

    async function sondear() {
        if (ocupado) return;                    // la vuelta anterior no ha terminado: no se encima
        ocupado = true;
        try {
            var pedidas = Object.keys(busquedas), ids = pedidas.join(",");
            var resp = await fetch(API + "/api/declaraciones/busquedas" + (ids ? "?ids=" + encodeURIComponent(ids) : ""), { credentials: "include" });
            if (!resp.ok) return;               // 423 (pantalla bloqueada) o un tropiezo: se pregunta en la siguiente vuelta
            var d = await resp.json();
            var lista = d.busquedas || [], llegaron = {};
            lista.forEach(function (b) { if (b && b.job_id) llegaron[b.job_id] = 1; });
            // Revisión de Fable (24-nov-2026): una búsqueda que la pantalla seguía y el servidor ya no devuelve (se quitó de Mis
            // descargas, cambiaste de espacio, o el titular te quitó esa empresa) se cierra aquí. Antes se quedaba «en curso»
            // para siempre y la pantalla seguía preguntando cada 2.5 s.
            pedidas.forEach(function (id) {
                var b = busquedas[id];
                if (b && ACTIVAS[b.estado] && !llegaron[id]) lista.push({ job_id: id, estado: "error", puede_detener: false, mensaje_error: "Ya no está en curso. Revísala en Mis descargas." });
            });
            recibir(lista);
        } catch (e) {
            // Un tropiezo de red no mata el seguimiento: se reintenta.
        } finally {
            ocupado = false;
        }
    }

    async function accionFila(f, boton) {
        var b = f.b || {};
        if (f.boton === "Detener") {
            if (b.estado === "corriendo" && !(await Fiscontable.preguntar("¿Detener la búsqueda de " + nombreDe(b) + "? Termina el paso en que va con el SAT; lo que ya bajó se queda guardado."))) return;
            boton.disabled = true;
            try {
                var r = await fetch(API + "/api/trabajos/" + encodeURIComponent(b.job_id) + "/cancelar", { method: "POST", credentials: "include" });
                if (!r.ok && r.status !== 400) alerta(await leerError(r));
            } catch (e) { /* el sondeo va a reflejar el estado real */ }
            sondear();
        } else if (f.boton === "Ver") {
            verResultado(b, boton);
        }
    }

    // Lo que bajó ESA búsqueda: lo guardado de su empresa (en su año); si no hay acceso al almacén, el ZIP de la búsqueda
    async function verResultado(b, boton) {
        if (b.en_pc && b.en_pc.rutas && b.en_pc.rutas.length) { bajar(b, boton, "Ver"); return; }
        // false = esa empresa no tiene almacén para esta cuenta (o está vacío): el ZIP que dejó la búsqueda; null = ya se avisó el error
        if ((await abrirGuardadas({ rfc: b.rfc, alias: b.alias }, b.hasta || b.desde || String(b.anios || "").slice(-4))) === false) bajar(b, boton, boton.textContent);
    }

    function alTerminar(b) {
        b._termino = new Date().toISOString();
        Fiscontable.refrescarDescargas();
        if (elegido && elegido.rfc === b.rfc) cargarAlmacen(b.rfc);          // el botón de guardadas de ESA empresa, si es la elegida
        pintarResultado(b);
    }

    /* Un aviso por búsqueda que termina, arriba del botón, con su empresa en el texto y su botón (las demás no se tocan) */
    function pintarResultado(b) {
        var lista = document.getElementById("resultado");
        lista.hidden = false;
        var bien = b.estado === "completado" && !/fallaron/i.test(b.progreso || "");
        var caja = document.createElement("div");
        caja.className = "fc-resultado fc-resultado--" + (bien ? "bien" : "mal");
        caja.dataset.job = b.job_id;
        var texto = b.estado === "completado" ? "Terminó la búsqueda de " + nombreDe(b) + ". " + (b.progreso || "")
            : b.estado === "cancelado" ? "Se detuvo la búsqueda de " + nombreDe(b) + "."
            : "No terminó la búsqueda de " + nombreDe(b) + ": " + (b.mensaje_error || "no se pudo completar.");
        var t = document.createElement("span");
        t.textContent = texto;
        caja.appendChild(t);
        if (b.estado === "completado") {
            var v = document.createElement("button");
            v.type = "button"; v.textContent = "Ver las de " + (b.alias || b.rfc);
            v.addEventListener("click", function () { verResultado(b, v); });
            caja.appendChild(v);
        }
        var x = document.createElement("button");
        x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", "Cerrar aviso"); x.style.textDecoration = "none";
        x.addEventListener("click", function () { caja.remove(); if (!lista.children.length) lista.hidden = true; });
        caja.appendChild(x);
        if (b.estado === "completado" && b.en_pc && b.en_pc.rutas && b.en_pc.rutas.length) {
            caja.appendChild(Fiscontable.cajaEnPc(b.en_pc, function (bt) { bajar(b, bt, "Descargar aquí"); }));
        }
        lista.insertBefore(caja, lista.firstChild);
        while (lista.children.length > 4) lista.removeChild(lista.lastChild);
    }

    async function bajar(b, boton, texto) {
        var antes = texto || boton.textContent;
        boton.disabled = true;
        boton.textContent = "Descargando…";
        try {
            var resp = await fetch(API + "/api/trabajos/" + encodeURIComponent(b.job_id) + "/descargar", { credentials: "include" });
            if (!resp.ok) { alerta(await leerError(resp)); return; }
            Fiscontable.guardarArchivo(await resp.blob(), b.nombre_descarga || (b.rfc + "_declaraciones.zip"));
        } catch (e) {
            alerta("El archivo se generó, pero no se pudo descargar. Búscalo en Mis descargas.");
        } finally {
            boton.disabled = false;
            boton.textContent = antes;
        }
    }

    btnBuscar.addEventListener("click", buscar);

    // Sin temporizadores huérfanos al salir de la página.
    window.addEventListener("pagehide", function () { clearInterval(sondeo); sondeo = null; });
    // Al volver de la caché del navegador (Atrás) o de otra pestaña, se pregunta de una vez
    document.addEventListener("visibilitychange", function () { if (!document.hidden && orden.length) sondear(); });

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
        sondear();          // 24-nov-2026: al volver a la página (F5), lo que sigue en curso o en fila, cada una con su empresa
    })();
})();
