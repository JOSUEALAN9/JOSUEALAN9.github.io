/**
 * barra.js — el marco de Fiscontable, en un solo lugar (antes app-header.js).
 * Requiere assets/js/nucleo.js cargado antes.
 *
 * Antes cada página dibujaba su propia navegación: el mismo botón se
 * llamaba "Inicio", "Menú", "Volver" o "Clientes" según dónde estuvieras,
 * y sólo la portada tenía perfil y descargas. Ahora las doce páginas
 * montan esto y se comportan igual.
 *
 * Cómo se usa — una línea en el <body> y una en el <head>:
 *
 *   <div id="app-header"
 *        data-modulo="constancias"
 *        data-titulo="Constancias de Situación Fiscal"
 *        data-migas="Herramientas|/herramientas/"></div>
 *
 * data-modulo   clave del módulo: fija el color de acento y el permiso.
 * data-titulo   nombre de la página (último tramo de la ruta de migas).
 * data-migas    tramos anteriores, "Texto|ruta" separados por ";".
 *               La portada se agrega sola al principio; omítelo en ella.
 *
 * Lo que queda disponible para las páginas:
 *   Fiscontable.perfil()             -> Promise<perfil|null>  (se pide una vez)
 *   Fiscontable.exigirModulo(clave)  -> Promise<bool>  bloquea la vista si no
 *   Fiscontable.bloquear(mensaje)
 *   Fiscontable.aviso(mensaje, {acciones})
 *   Fiscontable.ocultarAviso()
 *   Fiscontable.abrirDescargas() / cerrarDescargas()
 *   Fiscontable.refrescarDescargas()   úsalo al lanzar un proceso nuevo
 *   Fiscontable.API                    la URL base del backend
 */
(function () {
    "use strict";

    var API = window.Fiscontable.API;

    // Un solo lugar donde vive la identidad de cada módulo: nombre,
    // color y clave de permiso. Agregar un módulo nuevo es una línea.
    var MODULOS = {
        portada:       { nombre: "Fiscontable",           acento: "#0E9F6E", suave: "#E8F6F0", permiso: null },
        clientes:      { nombre: "Mis clientes",          acento: "#6D28D9", suave: "#F1EBFD", permiso: null },
        herramientas:  { nombre: "Herramientas",          acento: "#0E9F6E", suave: "#E8F6F0", permiso: null },
        conciliacion:  { nombre: "Conciliación",          acento: "#1D4ED8", suave: "#E8EFFD", permiso: "conciliacion" },
        iva:           { nombre: "Papel de trabajo de IVA", acento: "#7C3AED", suave: "#F1EBFE", permiso: "iva" },
        validador:     { nombre: "Validador SAT",         acento: "#047857", suave: "#E6F4EF", permiso: "validador" },
        xml:           { nombre: "Administración de XML", acento: "#0E7490", suave: "#E0F2F7", permiso: "validador" },
        constancias:   { nombre: "Constancias",           acento: "#4338CA", suave: "#ECEBFB", permiso: "constancias" },
        opinion:       { nombre: "Opinión 32-D",          acento: "#0F766E", suave: "#E6F2F1", permiso: "opinion" },
        voucheo:       { nombre: "Voucheo",               acento: "#B45309", suave: "#FBF0E2", permiso: "voucheo" },
        isn:           { nombre: "Impuestos estatales",   acento: "#BE185D", suave: "#FCE7F3", permiso: "isn" },
        declaraciones: { nombre: "Declaraciones",         acento: "#0369A1", suave: "#E4F1F9", permiso: "declaraciones" },
        descarga_xml:  { nombre: "Descarga masiva de XML", acento: "#0E7490", suave: "#E0F2F7", permiso: "descarga_xml" },
        facturar:      { nombre: "Facturar",              acento: "#4F46E5", suave: "#EEF2FF", permiso: "facturacion" },
        documentos:    { nombre: "Documentos",            acento: "#0E7490", suave: "#ECFEFF", permiso: "documentos" },
        buzon:         { nombre: "Buzón Tributario",      acento: "#0F766E", suave: "#E6F2F1", permiso: "buzon" },
        descargas:     { nombre: "Mis descargas",         acento: "#334155", suave: "#EEF1F5", permiso: null },
        creditos:      { nombre: "Mis créditos",          acento: "#0E9F6E", suave: "#E8F6F0", permiso: null },
        admin:         { nombre: "Administración",        acento: "#BE123C", suave: "#FCE9EE", permiso: null },
        configuracion: { nombre: "Configuración",         acento: "#4F46E5", suave: "#EEF2FF", permiso: null }
    };

    // "¿Cómo se usa?": pocos pasos por herramienta (clave = data-ayuda o data-modulo)
    var AYUDA = {
        clientes: ["+ Registrar empresa: sube su e.firma (el RFC sale solo del certificado), su nombre y tipo de sociedad; la contraseña del SAT es opcional.",
                   "Editar (o el lápiz ✎ del menú de empresa, arriba, desde cualquier pantalla): e.firma guardada y obligaciones.",
                   "Los botones de cada tarjeta abren esa herramienta ya con el cliente elegido."],
        constancias: ["Arriba eliges Por empresa (una) o Masivo (varias).",
                      "Por empresa: toma la empresa activa; con \"Otro contribuyente\" usas a alguien más. Su e.firma (o la guardada) y Descargar.",
                      "Masivo: llena la plantilla del lote, júntala con los .cer y .key en una carpeta y arrástrala.",
                      "\"Programar descarga\" la deja para la madrugada. Todo queda en Mis descargas."],
        opinion: ["Arriba eliges Por empresa (una) o Masivo (varias).",
                  "Por empresa: toma la empresa activa; con \"Otro contribuyente\" usas a alguien más. Su e.firma (o la guardada) y Descargar.",
                  "Masivo: llena la plantilla del lote, júntala con los .cer y .key en una carpeta y arrástrala.",
                  "\"Programar descarga\" la deja para la madrugada. Todo queda en Mis descargas."],
        declaraciones: ["Toma la empresa activa (o \"Otro contribuyente\").",
                        "Entra con su e.firma y elige el periodo.",
                        "Se baja solo lo que todavía no tienes guardado de esa empresa; lo descargas en un ZIP."],
        facturar: ["Elige arriba la empresa que factura. La primera vez, en Configuración: régimen, C.P., series y su CSD (sello digital).",
                   "Nueva factura: cliente, pago y conceptos; los totales se calculan solos.",
                   "Antes de timbrar se revisa todo sin gastar timbre; al confirmar se manda al SAT.",
                   "En Emitidas bajas el XML, imprimes el PDF o cancelas. Una nota de crédito se relaciona con su factura."],
        descarga_xml: ["Elige la empresa o \"Otro contribuyente\" (con su e.firma o solo su RFC).",
                       "Web service: con e.firma; el SAT prepara la solicitud y la ves en Solicitudes.",
                       "Portal: con contraseña y captcha (o e.firma); busca y descarga al momento.",
                       "Los XML entran solos a Administración de XML."],
        xml: ["Elige empresa y periodo arriba.",
              "Carga XML o tráelos con Descarga masiva.",
              "Revisa por pestaña (recibidos, emitidos, nómina, pagos), filtra y exporta a Excel.",
              "Marca CFDI para validarlos ante el SAT, ver listas negras o sacar su PDF."],
        validador: ["Arrastra XML sueltos (no se guardan) o usa los de tu empresa.",
                    "Validar: te dice si cada uno está vigente o cancelado ante el SAT.",
                    "Descarga el resultado en Excel."],
        listas: ["Busca cualquier RFC.",
                 "Con la empresa activa ves cuáles de sus proveedores y clientes aparecen.",
                 "Las listas se actualizan solas cada día."],
        conciliacion: ["Elige empresa y periodo arriba.",
                       "Escoge emitidas o recibidas.",
                       "Cruza cada factura con sus pagos y notas de crédito (tipo de cambio de Banxico).",
                       "Exporta a Excel."],
        iva: ["Elige empresa y periodo arriba.",
              "Emitidos = IVA cobrado; recibidos = IVA pagado.",
              "Revisa los avisos (PPD sin pago, proveedores en 69-B).",
              "Exporta a Excel, CFDI por CFDI."],
        isn: ["Arriba eliges el impuesto: ISN, hospedaje, informativa de hospedaje, profesiones o alcohol.",
              "Por empresa: Nuevo periodo (o Plantilla → Cargar Excel), revisa y Presentar.",
              "Masivo: elige el mes, marca empresas, Plantilla de las marcadas, llénala y Cargar Excel.",
              "Revisar en el portal quita las que ya estén presentadas; Presentar manda solo las marcadas.",
              "El acuse queda en cada periodo; el pago en ceros solo si lo pides."],
        voucheo: ["Elige el impuesto en las pestañas.",
                  "Sube los acuses en PDF.",
                  "Descarga el papel de trabajo en Excel (nuevo o actualizando uno tuyo)."],
        buzon: ["Todas mis empresas: lo que hay que atender en cada una (pendientes, cancelaciones por responder, nuevos).",
                "Revisión automática: elige cada cuánto se revisa en la madrugada; o marca empresas y Revisar ahora.",
                "Abrir (o Por empresa): comunicados completos, solicitudes de cancelación con su fecha límite y notificaciones con sus PDF.",
                "Las notificaciones pendientes NO se abren solas: abrirlas te da por notificado. Ábrelas tú en el SAT."],
        marcas: ["Elige empresa, mes y Emitidas o Recibidas.",
                 "Casi todo se marca solo y dice por qué; revisa «Por revisar».",
                 "Toca la casilla de un impuesto para decir si cuenta o no; el folio abre la factura.",
                 "⚙ Reglas: momento de cada impuesto, alcohol y lo aprendido. «Cerrar mes» cuando ya presentaste."],
        cancelaciones: ["«Te piden cancelar»: Buscar en el SAT y aceptar o rechazar una por una (72 horas).",
                        "«Cancelar emitidas»: elige el mes y Cancelar… en la factura (necesita el CSD en Facturar).",
                        "«Historial»: lo enviado, su resultado, Revisar en el SAT y el acuse."],
        documentos: ["Elige el tipo (SAT, Actas, IMSS, INFONAVIT) y el documento.",
                     "Escribe la CURP, RFC o NSS que pide y Pedir. Se apartan los créditos que cuesta.",
                     "Llega en minutos u horas: queda en Mis pedidos para descargarlo cuando quieras.",
                     "Si no se puede obtener, se te devuelven los créditos solos."],
        creditos: ["1 crédito = $1. Con ellos se pagan los documentos (actas, constancias, IMSS…).",
                   "Para recargar: deposita o transfiere a una de las cuentas y reporta tu pago (banco, clave de rastreo y comprobante).",
                   "Cuando se valida, los créditos aparecen en tu saldo. Si un trámite falla, se te devuelven solos."],
        descargas: ["Aquí queda todo lo que bajan las herramientas y la madrugada.",
                    "Descarga cada archivo o reintenta los que fallaron."]
    };

    // Todos los módulos en un solo lugar: el botón «Módulos» de la barra, la portada y los recientes salen de aquí.
    var I = {
        doc: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
        escudo: "M9 12l2 2 4-4m5.6-4A11.9 11.9 0 0112 2.9 11.9 11.9 0 013.4 6 12 12 0 003 9c0 5.6 3.8 10.3 9 11.6 5.2-1.3 9-6 9-11.6 0-1-.1-2-.4-3z",
        bajarDoc: "M12 10v6m0 0l-3-3m3 3l3-3M7 21h10a2 2 0 002-2V7.4a1 1 0 00-.3-.7l-3.4-3.4a1 1 0 00-.7-.3H7a2 2 0 00-2 2v14a2 2 0 002 2z",
        bajar: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4",
        buzon: "M20 13V7a2 2 0 00-2-2H6a2 2 0 00-2 2v6m16 0v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4m16 0h-2.6a1 1 0 00-.7.3l-2.4 2.4a1 1 0 01-.7.3h-3.2a1 1 0 01-.7-.3l-2.4-2.4a1 1 0 00-.7-.3H4",
        ticket: "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z",
        gente: "M17 20h5v-2a3 3 0 00-5.4-1.8M17 20H7m10 0v-2c0-.7-.1-1.3-.4-1.8M7 20H2v-2a3 3 0 015.4-1.8M7 20v-2c0-.7.1-1.3.4-1.8m0 0a5 5 0 019.2 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
        grafica: "M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
        recibo: "M9 7h6m-6 4h6m-6 4h3M5 3h14a1 1 0 011 1v16l-3-2-2 2-2-2-2 2-2-2-3 2V4a1 1 0 011-1z",
        alerta: "M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z",
        palomita: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
        credencial: "M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2",
        clientes: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a4 4 0 10-4-4",
        balanza: "M12 3v18m0-18l-7 3m7-3l7 3M5 6l-3 7a3 3 0 006 0L5 6zm14 0l-3 7a3 3 0 006 0l-3-7zM8 21h8",
        prohibido: "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636",
        moneda: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    };
    var CATALOGO = [
        { clave: "clientes", grupo: "Mi despacho", nombre: "Mis clientes", desc: "Empresas, e.firma y obligaciones", url: "/clientes/", permiso: null, icono: I.clientes, tono: "#6D28D9", suave: "#F1EBFD" },
        { clave: "facturar", grupo: "Mi despacho", nombre: "Facturar", desc: "Facturas y notas de crédito (CFDI 4.0)", url: "/herramientas/facturar/", permiso: "facturacion", icono: I.recibo, tono: "#4F46E5", suave: "#EEF2FF" },
        { clave: "descargas", grupo: "Mi despacho", nombre: "Mis descargas", desc: "Todo lo que bajan las herramientas", url: "/descargas/", permiso: null, icono: I.bajar, tono: "#334155", suave: "#EEF1F5" },
        { clave: "constancias", grupo: "Trámites ante el SAT", nombre: "Constancia de Situación Fiscal", desc: "De una empresa o de varias a la vez", url: "/herramientas/constancias/", permiso: "constancias", icono: I.doc, tono: "#4338CA", suave: "#ECEBFB" },
        { clave: "opinion", grupo: "Trámites ante el SAT", nombre: "Opinión de cumplimiento 32-D", desc: "De una empresa o de varias a la vez", url: "/herramientas/opinion/", permiso: "opinion", icono: I.escudo, tono: "#0F766E", suave: "#E6F2F1" },
        { clave: "declaraciones", grupo: "Trámites ante el SAT", nombre: "Declaraciones presentadas", desc: "Acuses, pagos y recibos", url: "/herramientas/declaraciones/", permiso: "declaraciones", icono: I.bajarDoc, tono: "#0369A1", suave: "#E4F1F9" },
        { clave: "descarga_xml", grupo: "Trámites ante el SAT", nombre: "Descarga masiva de XML", desc: "Emitidos y recibidos de un periodo", url: "/herramientas/descarga-xml/", permiso: "descarga_xml", icono: I.bajar, tono: "#0E7490", suave: "#E0F2F7" },
        { clave: "buzon", grupo: "Trámites ante el SAT", nombre: "Buzón Tributario", desc: "Comunicados, cancelaciones y notificaciones", url: "/herramientas/buzon/", permiso: "buzon", icono: I.buzon, tono: "#0F766E", suave: "#E6F2F1" },
        { clave: "cancelaciones", grupo: "Trámites ante el SAT", nombre: "Cancelaciones", desc: "Cancela emitidas y responde las que te piden", url: "/herramientas/xml/cancelaciones.html", permiso: "cancelaciones", icono: I.prohibido, tono: "#B91C1C", suave: "#FDECEC" },
        { clave: "xml", grupo: "Revisión y papeles de trabajo", nombre: "Administración de XML", desc: "Tus XML por tipo, con reportes en Excel", url: "/herramientas/xml/", permiso: "validador", icono: I.doc, tono: "#0E7490", suave: "#E0F2F7" },
        { clave: "marcas", grupo: "Revisión y papeles de trabajo", nombre: "Marcas fiscales", desc: "Para qué impuesto cuenta cada CFDI y por qué", url: "/herramientas/xml/fiscal.html", permiso: "marcas", icono: I.balanza, tono: "#4F46E5", suave: "#EEF2FF" },
        { clave: "conciliacion", grupo: "Revisión y papeles de trabajo", nombre: "Conciliación", desc: "Facturas contra pagos y notas de crédito", url: "/herramientas/conciliacion/", permiso: "conciliacion", icono: I.grafica, tono: "#1D4ED8", suave: "#E8EFFD" },
        { clave: "iva", grupo: "Revisión y papeles de trabajo", nombre: "Papel de trabajo de IVA", desc: "IVA cobrado y pagado del mes", url: "/herramientas/iva/", permiso: "iva", icono: I.recibo, tono: "#7C3AED", suave: "#F1EBFE" },
        { clave: "isn", grupo: "Revisión y papeles de trabajo", nombre: "Impuestos estatales", desc: "ISN, hospedaje, profesiones y alcohol (Q. Roo): calcula, presenta y lleva el control", url: "/herramientas/isn/", permiso: "isn", icono: I.gente, tono: "#BE185D", suave: "#FCE7F3" },
        { clave: "voucheo", grupo: "Revisión y papeles de trabajo", nombre: "Voucheo de impuestos", desc: "Acuses estatales a tu papel de trabajo", url: "/herramientas/voucheo/", permiso: "voucheo", icono: I.ticket, tono: "#B45309", suave: "#FBF0E2" },
        { clave: "listas", grupo: "Revisión y papeles de trabajo", nombre: "Listas del SAT", desc: "69, 69-B y demás listas negras", url: "/herramientas/listas-sat/", permiso: "validador", icono: I.alerta, tono: "#B91C1C", suave: "#FDECEC" },
        { clave: "validador", grupo: "Revisión y papeles de trabajo", nombre: "Validador de XML", desc: "¿Vigente o cancelado ante el SAT?", url: "/herramientas/validador/", permiso: "validador", icono: I.palomita, tono: "#047857", suave: "#E6F4EF" },
        { clave: "documentos", grupo: "Documentos con créditos", nombre: "Documentos", desc: "Actas, constancias, IMSS e INFONAVIT", url: "/herramientas/documentos/", permiso: "documentos", icono: I.credencial, tono: "#0E7490", suave: "#ECFEFF" },
        { clave: "creditos", grupo: "Documentos con créditos", nombre: "Mis créditos", desc: "Saldo y recargas", url: "/creditos/", permiso: null, icono: I.moneda, tono: "#0E9F6E", suave: "#E8F6F0" }
    ];

    // Lo último que usaste (para el menú «Módulos» y la portada)
    function recientes() {
        try { return JSON.parse(localStorage.getItem("fc-recientes") || "[]").filter(function (c) { return CATALOGO.some(function (m) { return m.clave === c; }); }); }
        catch (e) { return []; }
    }
    function anotarReciente(c) {
        if (!CATALOGO.some(function (m) { return m.clave === c; })) return;
        try { localStorage.setItem("fc-recientes", JSON.stringify([c].concat(recientes().filter(function (x) { return x !== c; })).slice(0, 6))); }
        catch (e) { /* sin almacenamiento: no pasa nada */ }
    }

    // Abierta dentro de la ventana de Configuración: sin barra superior (la ventana pone la suya)
    if (/[?&]incrustado=1\b/.test(location.search)) document.documentElement.classList.add("fc-incrustado");
    // …y además dentro de la página de Configuración (que ya pone título y pestañas): sin su propio encabezado
    if (/[?&]dentro=1\b/.test(location.search)) document.documentElement.classList.add("fc-dentro");
    var ancla = document.getElementById("app-header");
    if (!ancla) return;

    var clave = ancla.dataset.modulo || "portada";
    var modulo = MODULOS[clave] || MODULOS.portada;

    document.documentElement.style.setProperty("--acento", modulo.acento);
    document.documentElement.style.setProperty("--acento-suave", modulo.suave);

    /* ---------------------------------------------------------- útiles */

    var esc = window.Fiscontable.escapar;

    function ico(d, ancho) {
        return '<svg fill="none" stroke="currentColor" stroke-width="' + (ancho || 2) +
            '" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="' + d + '"/></svg>';
    }

    var D = {
        rayo:     "M13 10V3L4 14h7v7l9-11h-7z",
        edificio: "M3 21h18M5 21V7l7-4 7 4v14M9 9h1m-1 4h1m4-4h1m-1 4h1M10 21v-4h4v4",
        descarga: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4",
        engrane:  "M10.3 4.3c.4-1.7 2.9-1.7 3.4 0a1.7 1.7 0 002.5 1.1c1.6-.9 3.3.8 2.4 2.4a1.7 1.7 0 001.1 2.5c1.7.4 1.7 2.9 0 3.4a1.7 1.7 0 00-1.1 2.5c.9 1.6-.8 3.3-2.4 2.4a1.7 1.7 0 00-2.5 1.1c-.4 1.7-2.9 1.7-3.4 0a1.7 1.7 0 00-2.5-1.1c-1.6.9-3.3-.8-2.4-2.4a1.7 1.7 0 00-1.1-2.5c-1.7-.4-1.7-2.9 0-3.4a1.7 1.7 0 001.1-2.5c-.9-1.6.8-3.3 2.4-2.4 1 .6 2.3.1 2.5-1.1zM15 12a3 3 0 11-6 0 3 3 0 016 0z",
        persona:  "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
        rejilla:  "M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z",
        salir:    "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
        cerrar:   "M6 18L18 6M6 6l12 12",
        pc:       "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
        alerta:   "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
        candado:  "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z M16 11V7a4 4 0 00-8 0v4",
        flecha:   "M9 18l6-6-6-6",
        calendario: "M8 7V3m8 4V3M4 11h16M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
    };

    /* ------------------------------------------------------- la barra */

    function migasDesdeDatos() {
        var tramos = [];
        (ancla.dataset.migas || "").split(";").forEach(function (t) {
            if (!t.trim()) return;
            var p = t.split("|");
            tramos.push({ texto: p[0].trim(), href: (p[1] || "/").trim() });
        });
        return tramos;
    }

    function pintarBarra() {
        var tramos = migasDesdeDatos();
        var titulo = ancla.dataset.titulo || modulo.nombre;

        // En el teléfono no cabe la ruta completa, así que el último
        // tramo (el "padre") se convierte en una flecha de regresar y el
        // resto se esconde. En pantalla grande se ve la ruta entera.
        if (clave !== "portada" && !tramos.length) tramos.push({ texto: "Inicio", href: "/" });
        var migas = tramos.map(function (t, i) {
            var esPadre = i === tramos.length - 1;
            // En computadora el botón «Módulos» ya lleva a cualquier herramienta: "Herramientas" e "Inicio" sobran
            var soloMovil = t.href === "/herramientas/" || t.href === "/";
            return '<a class="fc-miga' + (esPadre ? " fc-miga--padre" : "") + (soloMovil ? " fc-miga--solo-movil" : "") + '" href="' + esc(t.href) + '"' +
                (esPadre ? ' aria-label="Regresar a ' + esc(t.texto) + '"' : "") + ">" +
                '<span class="fc-miga__sep">' + ico(D.flecha, 2.2) + "</span>" +
                "<span>" + esc(t.texto) + "</span></a>";
        }).join("");

        if (clave !== "portada") {
            migas += '<span class="fc-miga fc-miga--actual">' +
                '<span class="fc-miga__sep">' + ico(D.flecha, 2.2) + "</span>" +
                "<span>" + esc(titulo) + "</span></span>";
        }
        if (AYUDA[ancla.dataset.ayuda || clave]) {
            migas += '<button type="button" class="fc-ayuda" id="fc-ayuda" title="Cómo se usa"><span class="fc-ayuda__icono">?</span><span class="fc-ayuda__texto">Cómo se usa</span></button>';
        }

        ancla.outerHTML =
            '<header class="fc-barra">' +
              '<div class="fc-barra__interior">' +
                '<a class="fc-marca" href="/">' +
                  '<span class="fc-marca__sello">' + ico(D.rayo) + "</span>" +
                  '<span class="fc-marca__nombre">Fiscontable</span>' +
                "</a>" +
                '<button type="button" class="fc-modulos-btn" id="fc-btn-modulos" aria-haspopup="dialog" aria-expanded="false" title="Ir a otro módulo (Ctrl+K)">' +
                  ico(D.rejilla) + '<span class="fc-modulos-btn__texto">Módulos</span></button>' +
                '<nav class="fc-migas" aria-label="Ruta">' + migas + "</nav>" +
                '<div class="fc-acciones">' +
                  '<button type="button" class="fc-accion fc-empresa" id="fc-btn-empresa" aria-haspopup="menu" aria-expanded="false" hidden>' +
                    ico(D.edificio) +
                    '<span class="fc-accion__etiqueta fc-empresa__nombre" id="fc-empresa-nombre">Elegir empresa</span>' +
                    '<span class="fc-empresa__flecha" aria-hidden="true">▾</span>' +
                  "</button>" +
                  '<button type="button" class="fc-accion fc-empresa fc-empresa--vacia" id="fc-btn-periodo" aria-haspopup="dialog" aria-expanded="false" hidden>' +
                    ico(D.calendario) +
                    '<span class="fc-accion__etiqueta fc-empresa__nombre" id="fc-periodo-nombre">Elegir periodo</span>' +
                    '<span class="fc-empresa__flecha" aria-hidden="true">▾</span>' +
                  "</button>" +
                  '<button type="button" class="fc-accion" id="fc-btn-descargas" aria-haspopup="dialog" aria-label="Mis descargas">' +
                    ico(D.descarga) +
                    '<span class="fc-accion__etiqueta">Descargas</span>' +
                    '<span class="fc-contador" id="fc-contador" hidden>0</span>' +
                  "</button>" +
                  '<a class="fc-accion" id="fc-enlace-admin" href="/configuracion/" title="Configuración">' +
                    ico(D.engrane) + '<span class="fc-accion__etiqueta">Configuración</span>' +
                  "</a>" +
                  '<button type="button" class="fc-accion" id="fc-btn-perfil" aria-haspopup="menu" aria-expanded="false">' +
                    '<span class="fc-avatar" id="fc-avatar">·</span>' +
                    '<span class="fc-accion__etiqueta" id="fc-nombre-corto"></span>' +
                  "</button>" +
                "</div>" +
                menuPerfilHTML() + menuEmpresasHTML() + menuModulosHTML() +
              "</div>" +
            "</header>" +
            avisoHTML();
    }

    function menuPerfilHTML() {
        return '<div class="fc-menu" id="fc-menu" role="menu" hidden>' +
            '<div class="fc-menu__cabeza">' +
              '<div class="fc-menu__nombre" id="fc-menu-nombre">—</div>' +
              '<div class="fc-menu__dato" id="fc-menu-correo"></div>' +
              '<div class="fc-menu__dato" id="fc-menu-telefono"></div>' +
            "</div>" +
            '<div class="fc-menu__fila"><span>Plan</span><span class="fc-menu__plan" id="fc-menu-plan">—</span></div>' +
            '<div class="fc-menu__fila"><span>Vigencia</span><span class="fc-menu__valor" id="fc-menu-vigencia">—</span></div>' +
            '<a class="fc-menu__fila fc-menu__creditos" href="/creditos/" role="menuitem"><span>Créditos</span>' +
              '<span class="fc-menu__valor"><span id="fc-menu-creditos">—</span> · <u>Recargar</u></span></a>' +
            '<div class="fc-menu__acciones">' +
              '<button type="button" class="fc-menu__boton" id="fc-btn-editar-perfil" role="menuitem">' +
                ico(D.persona) + "Editar mi perfil</button>" +
              '<a class="fc-menu__boton" href="/agente/" role="menuitem">' +
                ico(D.pc) + "Conectar esta PC</a>" +
              '<a class="fc-menu__boton fc-menu__boton--salir" href="/cdn-cgi/access/logout" role="menuitem">' +
                ico(D.salir) + "Cerrar sesión</a>" +
            "</div></div>";
    }

    /* --------------------------------------------- menú «Módulos» (y Ctrl+K) */
    // El módulo de esta página, por su dirección (Listas y Validador comparten permiso, no dirección)
    var aqui = CATALOGO.filter(function (m) { return location.pathname.indexOf(m.url) === 0; })
        .sort(function (a, b) { return b.url.length - a.url.length; })[0] || null;

    function menuModulosHTML() {
        return '<div class="fc-menu fc-modulos" id="fc-modulos" role="dialog" aria-label="Ir a un módulo" hidden>' +
            '<input type="search" class="fc-modulos__buscar" id="fc-modulos-buscar" placeholder="Buscar módulo… (Ctrl+K)" autocomplete="off">' +
            '<div class="fc-modulos__cuerpo" id="fc-modulos-cuerpo"></div></div>';
    }

    function permitido(m) {
        if (!m.permiso) return true;
        var p = perfilActual;
        if (!p || p._error) return true;            // mientras carga no se ve nada como bloqueado
        return !p.solo_lectura && (p.modulos_permitidos || []).indexOf(m.permiso) !== -1;
    }

    function itemModulo(m) {
        var ok = permitido(m), actual = aqui && m.clave === aqui.clave;
        return '<a class="fc-modulos__item' + (ok ? "" : " fc-modulos__item--vedado") + (actual ? " fc-modulos__item--actual" : "") + '" href="' + esc(m.url) + '"' +
            ' style="--tono:' + m.tono + ';--tono-suave:' + m.suave + '"' + (ok ? "" : ' data-plan="' + m.clave + '" title="No incluido en tu plan"') + ">" +
            '<span class="fc-modulos__icono">' + ico(m.icono, 1.7) + "</span>" +
            '<span class="fc-modulos__texto"><strong>' + esc(m.nombre) + (ok ? "" : " 🔒") + "</strong><small>" +
            (ok ? esc(m.desc) : '<em class="fc-plan-chip">No incluido en tu plan</em>') + "</small></span></a>";
    }

    function pintarModulos() {
        var q = (document.getElementById("fc-modulos-buscar").value || "").trim().toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        var cuerpo = document.getElementById("fc-modulos-cuerpo");
        if (q) {
            var hallados = CATALOGO.filter(function (m) {
                return (m.nombre + " " + m.desc + " " + m.grupo).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").indexOf(q) !== -1;
            });
            cuerpo.innerHTML = hallados.length ? '<div class="fc-modulos__rejilla">' + hallados.map(itemModulo).join("") + "</div>"
                : '<p class="fc-empresas__nada">Ningún módulo coincide con «' + esc(q) + "».</p>";
            return;
        }
        var html = "";
        var rec = recientes().filter(function (c) { return !aqui || c !== aqui.clave; }).slice(0, 4);
        if (rec.length) {
            html += '<div class="fc-modulos__grupo">Recientes</div><div class="fc-modulos__rejilla">' +
                rec.map(function (c) { return itemModulo(CATALOGO.filter(function (m) { return m.clave === c; })[0]); }).join("") + "</div>";
        }
        var grupos = [];
        CATALOGO.forEach(function (m) { if (grupos.indexOf(m.grupo) === -1) grupos.push(m.grupo); });
        grupos.forEach(function (g) {
            html += '<div class="fc-modulos__grupo">' + esc(g) + '</div><div class="fc-modulos__rejilla">' +
                CATALOGO.filter(function (m) { return m.grupo === g; }).map(itemModulo).join("") + "</div>";
        });
        cuerpo.innerHTML = html;
    }

    function abrirModulos() {
        var panel = document.getElementById("fc-modulos"), boton = document.getElementById("fc-btn-modulos");
        cerrarEmpresas();
        document.getElementById("fc-menu").hidden = true;
        var buscar = document.getElementById("fc-modulos-buscar");
        buscar.value = "";
        pintarModulos();
        panel.hidden = false;
        boton.setAttribute("aria-expanded", "true");
        var interior = panel.parentElement.getBoundingClientRect(), r = boton.getBoundingClientRect();
        panel.style.left = Math.max(12, r.left - interior.left) + "px";
        if (window.innerWidth > 700) buscar.focus();
    }

    function cerrarModulos() {
        var panel = document.getElementById("fc-modulos");
        if (!panel || panel.hidden) return false;
        panel.hidden = true;
        document.getElementById("fc-btn-modulos").setAttribute("aria-expanded", "false");
        return true;
    }

    function prepararModulos() {
        var boton = document.getElementById("fc-btn-modulos"), panel = document.getElementById("fc-modulos");
        boton.addEventListener("click", function (e) { e.stopPropagation(); if (panel.hidden) abrirModulos(); else cerrarModulos(); });
        panel.addEventListener("click", function (e) {
            var a = e.target.closest(".fc-modulos__item--vedado");
            if (a) { e.preventDefault(); }
        });
        var buscar = document.getElementById("fc-modulos-buscar");
        buscar.addEventListener("input", pintarModulos);
        buscar.addEventListener("keydown", function (e) {
            if (e.key === "Enter") {
                var primero = panel.querySelector(".fc-modulos__item:not(.fc-modulos__item--vedado)");
                if (primero) location.href = primero.getAttribute("href");
            } else if (e.key === "ArrowDown") {
                var p = panel.querySelector(".fc-modulos__item"); if (p) { e.preventDefault(); p.focus(); }
            }
        });
        panel.addEventListener("keydown", function (e) {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            var items = [].slice.call(panel.querySelectorAll(".fc-modulos__item")), i = items.indexOf(document.activeElement);
            if (i === -1) return;
            e.preventDefault();
            var sig = items[i + (e.key === "ArrowDown" ? 1 : -1)];
            if (sig) sig.focus(); else if (e.key === "ArrowUp") buscar.focus();
        });
        document.addEventListener("pointerdown", function (e) {
            if (!panel.hidden && !panel.contains(e.target) && !boton.contains(e.target)) cerrarModulos();
        });
        document.addEventListener("keydown", function (e) {
            if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
                e.preventDefault();
                if (panel.hidden) abrirModulos(); else cerrarModulos();
            }
        });
        if (aqui) anotarReciente(aqui.clave);
    }

    /* --------------------------------------------- selector de empresa */
    /* La empresa en la que estás trabajando. Se guarda en el servidor
       (te sigue en cualquier PC) y los módulos la usan para resolver solos
       el paso "¿Para quién?". Las herramientas rápidas (un RFC sin
       registrar) siguen disponibles en cada módulo sin tocar este selector. */
    function menuEmpresasHTML() {
        return '<div class="fc-menu fc-empresas" id="fc-empresas" role="menu" hidden>' +
            '<div class="fc-empresas__cabeza"><div class="fc-menu__nombre">¿En qué empresa trabajas?</div>' +
              '<input type="search" class="fc-empresas__buscar" id="fc-empresas-buscar" placeholder="Buscar por nombre o RFC…" autocomplete="off"></div>' +
            '<div class="fc-empresas__lista" id="fc-empresas-lista"></div>' +
            '<div class="fc-empresas__pie">' +
              '<button type="button" class="fc-empresas__ninguna" id="fc-empresa-ninguna">Quitar empresa activa</button>' +
              '<a class="fc-empresas__nueva" href="/clientes/?nuevo=1">+ Registrar empresa</a>' +
            "</div></div>";
    }

    var clientesCache = null;

    function pintarEmpresa() {
        var e = perfilActual && perfilActual.empresa_activa;
        if (e && !cambio) ponerTitulo(e.alias || e.nombre || e.rfc);
        var boton = document.getElementById("fc-btn-empresa");
        if (!boton) return;
        boton.hidden = false;
        boton.classList.toggle("fc-empresa--vacia", !e);
        document.getElementById("fc-empresa-nombre").textContent = e ? (e.alias || e.rfc) : "Elegir empresa";
        boton.title = e ? (e.alias || "") + " · " + e.rfc + " — cambiar de empresa" : "Elige la empresa en la que vas a trabajar";
        document.getElementById("fc-empresa-ninguna").hidden = !e;
    }

    function pintarListaEmpresas() {
        var q = (document.getElementById("fc-empresas-buscar").value || "").trim().toLowerCase();
        var activa = perfilActual && perfilActual.empresa_activa ? perfilActual.empresa_activa.rfc : null;
        var lista = (clientesCache || []).filter(function (c) {
            return !q || (c.alias + " " + c.rfc + " " + (c.razon_social || "")).toLowerCase().indexOf(q) !== -1;
        });
        var caja = document.getElementById("fc-empresas-lista");
        if (clientesCache === null) { caja.innerHTML = '<p class="fc-empresas__nada">Cargando tu directorio…</p>'; return; }
        if (!clientesCache.length) {
            caja.innerHTML = '<p class="fc-empresas__nada">Todavía no tienes empresas registradas. Regístralas en <a href="/clientes/">Mis clientes</a>.</p>';
            return;
        }
        caja.innerHTML = lista.length ? lista.map(function (c) {
            // ✎ = acceso directo a su ficha (editar), sin pasar por Mis clientes
            return '<div class="fc-empresas__fila"><button type="button" class="fc-empresas__item' + (c.rfc === activa ? " fc-empresas__item--activa" : "") + '" data-rfc="' + esc(c.rfc) + '" role="menuitem">' +
                '<span class="fc-empresas__inicial">' + esc((c.alias || c.rfc).charAt(0).toUpperCase()) + "</span>" +
                '<span class="fc-empresas__texto"><strong>' + esc(c.alias) + "</strong><small>" + esc(c.rfc) + "</small></span>" +
                (c.rfc === activa ? '<span class="fc-empresas__check">✓</span>' : "") + "</button>" +
                '<a class="fc-empresas__editar" href="/clientes/?editar=' + encodeURIComponent(c.rfc) + '" title="Editar ' + esc(c.alias || c.rfc) +
                ' (e.firma, obligaciones…)" aria-label="Editar ' + esc(c.alias || c.rfc) + '">✎</a></div>';
        }).join("") : '<p class="fc-empresas__nada">Ninguna coincide con la búsqueda.</p>';
    }

    async function abrirEmpresas() {
        var panel = document.getElementById("fc-empresas");
        var boton = document.getElementById("fc-btn-empresa");
        document.getElementById("fc-menu").hidden = true;
        cerrarModulos();
        panel.hidden = false;
        boton.setAttribute("aria-expanded", "true");
        var interior = panel.parentElement.getBoundingClientRect();
        var r = boton.getBoundingClientRect();
        panel.style.right = Math.max(12, interior.right - r.right) + "px";
        var buscar = document.getElementById("fc-empresas-buscar");
        buscar.value = "";
        pintarListaEmpresas();
        if (window.innerWidth > 700) buscar.focus();
        if (clientesCache === null) {
            try {
                var resp = await fetch(API + "/api/clientes", { credentials: "include" });
                clientesCache = resp.ok ? await resp.json() : [];
            } catch (e) { clientesCache = []; }
            pintarListaEmpresas();
        }
    }

    function cerrarEmpresas() {
        var panel = document.getElementById("fc-empresas");
        if (!panel || panel.hidden) return;
        panel.hidden = true;
        document.getElementById("fc-btn-empresa").setAttribute("aria-expanded", "false");
    }

    /* ---------- Visor de PDF de Fiscontable (PDF.js) ----------
       El de Chrome dentro de una página se ve oscuro y en el teléfono casi nunca abre. Este dibuja cada página como
       imagen, igual en todos lados, con zoom, descargar e imprimir. verPdf(blob|url, {titulo, nombre}) abre la ventana;
       pdfEn(elemento, blob) lo pinta dentro de una caja (por ejemplo, la vista previa del último paso). */
    var PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
    var pdfjsListo = null;
    function cargarPdfjs() {
        if (!pdfjsListo) {
            pdfjsListo = new Promise(function (ok, mal) {
                var s = document.createElement("script");
                s.src = PDFJS + "pdf.min.js";
                s.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; ok(window.pdfjsLib); };
                s.onerror = function () { pdfjsListo = null; mal(new Error("No se pudo cargar el visor de PDF.")); };
                document.head.appendChild(s);
            });
        }
        return pdfjsListo;
    }

    async function abrirDoc(fuente) {
        var lib = await cargarPdfjs();
        var datos = fuente instanceof Blob ? new Uint8Array(await fuente.arrayBuffer()) : null;
        return lib.getDocument(datos ? { data: datos } : { url: fuente, withCredentials: true }).promise;
    }

    async function pintarPaginas(doc, cont, escala, ancho) {
        cont.innerHTML = "";
        for (var n = 1; n <= doc.numPages; n++) {
            var pag = await doc.getPage(n);
            var base = pag.getViewport({ scale: 1 });
            var zoom = ancho ? Math.max(0.3, (ancho - 24) / base.width) : escala;
            var vista = pag.getViewport({ scale: zoom });
            var px = window.devicePixelRatio || 1;
            // La página es una imagen (canvas) con una capa de texto invisible encima: así se puede seleccionar y copiar
            var hoja = document.createElement("div");
            hoja.className = "fc-pdf__pagina";
            hoja.style.width = Math.floor(vista.width) + "px"; hoja.style.height = Math.floor(vista.height) + "px";
            var lienzo = document.createElement("canvas");
            lienzo.width = Math.floor(vista.width * px); lienzo.height = Math.floor(vista.height * px);
            lienzo.style.width = Math.floor(vista.width) + "px"; lienzo.style.height = Math.floor(vista.height) + "px";
            hoja.appendChild(lienzo);
            cont.appendChild(hoja);
            await pag.render({ canvasContext: lienzo.getContext("2d"), viewport: vista, transform: px !== 1 ? [px, 0, 0, px, 0, 0] : null }).promise;
            try {
                var capa = document.createElement("div");
                capa.className = "textLayer";
                capa.style.setProperty("--scale-factor", vista.scale);
                hoja.appendChild(capa);
                await window.pdfjsLib.renderTextLayer({ textContentSource: pag.streamTextContent(), container: capa, viewport: vista, textDivs: [] }).promise;
            } catch (e) { /* sin capa de texto: la página se ve igual, solo no se puede copiar */ }
        }
    }

    async function pdfEn(elemento, fuente) {
        elemento.classList.add("fc-pdf__hoja");
        elemento.innerHTML = '<p class="fc-pdf__cargando">Cargando vista previa…</p>';
        try {
            var doc = await abrirDoc(fuente);
            await pintarPaginas(doc, elemento, 1, elemento.clientWidth || 700);
        } catch (e) { elemento.innerHTML = '<p class="fc-pdf__cargando">No se pudo mostrar el PDF (' + (e.message || "error") + ").</p>"; }
    }

    function verPdf(fuente, opciones) {
        opciones = opciones || {};
        var dlg = document.getElementById("fc-pdf");
        if (!dlg) {
            dlg = document.createElement("dialog");
            dlg.id = "fc-pdf"; dlg.className = "fc-pdf";
            dlg.innerHTML = '<div class="fc-pdf__barra"><span class="fc-pdf__titulo" id="fc-pdf-titulo"></span><span class="fc-pdf__paginas" id="fc-pdf-paginas"></span>' +
                '<div class="fc-pdf__zoom"><button type="button" data-zoom="-1" aria-label="Alejar">−</button><button type="button" data-zoom="0" title="Ajustar al ancho">Ajustar</button><button type="button" data-zoom="1" aria-label="Acercar">+</button></div>' +
                '<button type="button" class="fc-pdf__accion" id="fc-pdf-imprimir">Imprimir</button><button type="button" class="fc-pdf__accion fc-pdf__accion--principal" id="fc-pdf-bajar">Descargar</button>' +
                '<button type="button" class="fc-pdf__cerrar" aria-label="Cerrar">✕</button></div><div class="fc-pdf__cuerpo" id="fc-pdf-cuerpo"></div>';
            document.body.appendChild(dlg);
            dlg.querySelector(".fc-pdf__cerrar").addEventListener("click", function () { dlg.close(); });
            dlg.addEventListener("click", function (ev) { if (ev.target === dlg) dlg.close(); });
            dlg.querySelectorAll("[data-zoom]").forEach(function (b) {
                b.addEventListener("click", function () {
                    var d = +b.dataset.zoom;
                    dlg._escala = d === 0 ? null : Math.min(3, Math.max(0.4, (dlg._escala || dlg._ajuste || 1) + d * 0.25));
                    redibujar();
                });
            });
            dlg.querySelector("#fc-pdf-bajar").addEventListener("click", function () {
                if (dlg._blob) window.Fiscontable.guardarArchivo(dlg._blob, dlg._nombre);
            });
            dlg.querySelector("#fc-pdf-imprimir").addEventListener("click", function () {
                if (!dlg._url) return;
                var marco = document.getElementById("fc-pdf-impresion") || document.body.appendChild(Object.assign(document.createElement("iframe"), { id: "fc-pdf-impresion" }));
                marco.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
                marco.onload = function () { try { marco.contentWindow.focus(); marco.contentWindow.print(); } catch (e) { window.open(dlg._url, "_blank"); } };
                marco.src = dlg._url;
            });
        }
        var cuerpo = dlg.querySelector("#fc-pdf-cuerpo");
        async function redibujar() {
            if (!dlg._doc) return;
            var ancho = Math.min(cuerpo.clientWidth, 1100);
            dlg._ajuste = (ancho - 24) / (await dlg._doc.getPage(1)).getViewport({ scale: 1 }).width;
            await pintarPaginas(dlg._doc, cuerpo, dlg._escala || dlg._ajuste, null);
        }
        dlg.querySelector("#fc-pdf-titulo").textContent = opciones.titulo || opciones.nombre || "Documento";
        dlg.querySelector("#fc-pdf-paginas").textContent = "";
        cuerpo.innerHTML = '<p class="fc-pdf__cargando">Abriendo…</p>';
        dlg._escala = null; dlg._doc = null;
        dlg._nombre = opciones.nombre || "documento.pdf";
        if (!dlg.open) dlg.showModal();
        (async function () {
            try {
                var blob = fuente instanceof Blob ? fuente : await (await fetch(fuente, { credentials: "include" })).blob();
                if (dlg._url) URL.revokeObjectURL(dlg._url);
                dlg._blob = blob; dlg._url = URL.createObjectURL(blob);
                dlg._doc = await abrirDoc(blob);
                dlg.querySelector("#fc-pdf-paginas").textContent = dlg._doc.numPages + (dlg._doc.numPages === 1 ? " página" : " páginas");
                await redibujar();
            } catch (e) { cuerpo.innerHTML = '<p class="fc-pdf__cargando">No se pudo abrir el PDF (' + (e.message || "error") + ").</p>"; }
        })();
    }

    var SECCIONES_CONFIG = {
        facturacion: function (sub) { return "/herramientas/facturar/?vista=config&incrustado=1" + (sub ? "&sub=" + encodeURIComponent(sub) : ""); }
    };
    function abrirConfiguracion(seccion, sub) {
        var url = SECCIONES_CONFIG[seccion] ? SECCIONES_CONFIG[seccion](sub) : "/configuracion/?incrustado=1&seccion=" + encodeURIComponent(seccion || "") + (sub ? "&sub=" + encodeURIComponent(sub) : "");
        var dlg = document.getElementById("fc-config");
        if (!dlg) {
            dlg = document.createElement("dialog");
            dlg.id = "fc-config";
            dlg.className = "fc-config";
            dlg.innerHTML = '<div class="fc-config__barra"><span class="fc-config__titulo">' + ico(D.engrane) + 'Configuración</span>' +
                '<a class="fc-config__todo" href="/configuracion/" title="Abrir toda la configuración">Toda la configuración ↗</a>' +
                '<button type="button" class="fc-config__cerrar" aria-label="Cerrar">✕</button></div><iframe class="fc-config__marco" title="Configuración"></iframe>';
            document.body.appendChild(dlg);
            var cerrar = function () { if (dlg.open) dlg.close(); };
            dlg.querySelector(".fc-config__cerrar").addEventListener("click", cerrar);
            dlg.addEventListener("click", function (ev) { if (ev.target === dlg) cerrar(); });
            dlg.addEventListener("close", function () {
                window.dispatchEvent(new CustomEvent("fiscontable:config", { detail: { seccion: dlg.dataset.seccion } }));
                dlg.querySelector("iframe").src = "about:blank";
            });
            window.addEventListener("message", function (ev) {
                if (ev.origin === location.origin && ev.data && ev.data.fiscontable === "config-listo") cerrar();
            });
        }
        dlg.dataset.seccion = seccion || "";
        dlg.querySelector("iframe").src = url;
        dlg.showModal();
    }

    /* ------------------------------------------------ cambio de empresa: que se note
       Al cambiar de empresa (arriba o en el selector del módulo) se cubre el contenido con «Cargando datos de…» hasta
       que terminan las consultas al servidor que dispara el cambio (mínimo medio segundo, máximo 8), aparece con un
       destello suave, sale un aviso con la empresa y la pestaña del navegador dice cuál es. */
    var enCurso = [];                      // inicio (ms) de cada consulta al servidor que no ha terminado
    function pendientesDesde(t) { return enCurso.filter(function (x) { return x >= t; }).length; }
    (function vigilarConsultas() {
        var original = window.fetch;
        if (!original || original.__fc) return;
        var envuelto = function (recurso) {
            var url = typeof recurso === "string" ? recurso : (recurso && recurso.url) || "";
            var nuestra = url.indexOf(API) === 0;
            var marca = Date.now();
            if (nuestra) enCurso.push(marca);
            var p = original.apply(this, arguments);
            var fin = function () { var i = enCurso.indexOf(marca); if (i !== -1) enCurso.splice(i, 1); };
            if (nuestra) p.then(fin, fin);
            return p;
        };
        envuelto.__fc = true;
        window.fetch = envuelto;
    })();

    var cambio = null;
    function mostrarCambio(nombre, rfc) {
        var velo = document.getElementById("fc-cambio");
        if (!velo) {
            velo = document.createElement("div");
            velo.id = "fc-cambio"; velo.className = "fc-cambio"; velo.setAttribute("role", "status"); velo.setAttribute("aria-live", "polite");
            velo.innerHTML = '<div class="fc-cambio__caja"><span class="fc-cambio__giro" aria-hidden="true"></span><p>Cargando datos de <b></b></p><small></small></div>';
            document.body.appendChild(velo);
        }
        velo.querySelector("b").textContent = nombre || rfc || "la empresa";
        velo.querySelector("small").textContent = rfc && nombre && nombre !== rfc ? rfc : "";
        velo.hidden = false;
        requestAnimationFrame(function () { velo.classList.add("fc-cambio--ve"); });
        ponerTitulo(nombre || rfc);
        var yo = cambio = { inicio: Date.now(), nombre: nombre, rfc: rfc, quieto: 0 };
        (function revisar() {
            if (cambio !== yo) return;
            var t = Date.now() - yo.inicio;
            yo.quieto = pendientesDesde(yo.inicio - 50) ? 0 : yo.quieto + 1;     // solo lo que pidió el cambio, no lo de fondo
            if ((t >= 500 && yo.quieto >= 3) || t > 8000) return terminarCambio(yo);
            setTimeout(revisar, 60);
        })();
    }
    function terminarCambio(yo) {
        cambio = null;
        var velo = document.getElementById("fc-cambio");
        velo.classList.remove("fc-cambio--ve");
        setTimeout(function () { if (!cambio) velo.hidden = true; }, 200);
        var main = document.querySelector("main");
        if (main) { main.classList.remove("fc-recien"); void main.offsetWidth; main.classList.add("fc-recien"); }
        brindis("Ahora ves: <b>" + esc(yo.nombre || yo.rfc || "") + "</b>" + (yo.rfc && yo.nombre && yo.nombre !== yo.rfc ? " · " + esc(yo.rfc) : ""));
    }
    function brindis(html) {
        var t = document.getElementById("fc-brindis");
        if (!t) {
            t = document.createElement("div");
            t.id = "fc-brindis"; t.className = "fc-brindis"; t.setAttribute("role", "status");
            document.body.appendChild(t);
        }
        t.innerHTML = '<span aria-hidden="true">✓</span> ' + html;
        t.classList.remove("fc-brindis--ve"); void t.offsetWidth; t.classList.add("fc-brindis--ve");
        clearTimeout(t._reloj);
        t._reloj = setTimeout(function () { t.classList.remove("fc-brindis--ve"); }, 2800);
    }
    var tituloBase = document.title;
    function ponerTitulo(nombre) {
        var m = /^(.*?)\s*([·|])\s*Fiscontable$/.exec(tituloBase);
        document.title = nombre && m ? m[1] + " · " + nombre + " " + m[2] + " Fiscontable" : tituloBase;
    }
    // El selector de empresa propio de cada módulo (#menu-empresa) también avisa, aunque la empresa no esté registrada
    document.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest(".xml-menu__lista--otra [data-rfc], .xml-menu__lista--otra [data-empresa], .xml-menu__lista--otra [data-otra]");
        if (!b || b.classList.contains("xml-activa")) return;
        var span = b.querySelector("span");
        var nombre = (b.textContent.replace(span ? span.textContent : "", "") || "").trim();
        mostrarCambio(nombre, b.dataset.rfc || b.dataset.empresa || b.dataset.otra);
    }, true);

    async function elegirEmpresa(rfc) {
        cerrarEmpresas();
        var previa = perfilActual && perfilActual.empresa_activa;
        try {
            var resp = await fetch(API + "/api/mi-perfil/empresa", {
                method: "PUT", credentials: "include",
                headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rfc: rfc })
            });
            if (!resp.ok) throw new Error(await window.Fiscontable.leerError(resp));
            var r = await resp.json();
            perfilActual.empresa_activa = r.empresa_activa;
            promesaPerfil = Promise.resolve(perfilActual);
            pintarEmpresa();
            var e = r.empresa_activa;
            if (e && (!previa || previa.rfc !== e.rfc) && !cambio) mostrarCambio(e.alias || e.nombre || e.rfc, e.rfc);
            else if (e) ponerTitulo(e.alias || e.nombre || e.rfc);
            window.dispatchEvent(new CustomEvent("fiscontable:empresa", { detail: r.empresa_activa }));
        } catch (e) {
            aviso(e.message || "No se pudo cambiar de empresa.");
        }
    }

    function prepararEmpresas() {
        var boton = document.getElementById("fc-btn-empresa");
        if (!boton) return;
        boton.addEventListener("click", function (e) {
            e.stopPropagation();
            if (document.getElementById("fc-empresas").hidden) abrirEmpresas(); else cerrarEmpresas();
        });
        var panel = document.getElementById("fc-empresas");
        panel.addEventListener("click", function (e) {
            e.stopPropagation();
            var item = e.target.closest("[data-rfc]");
            if (item) elegirEmpresa(item.dataset.rfc);
        });
        document.getElementById("fc-empresas-buscar").addEventListener("input", pintarListaEmpresas);
        document.getElementById("fc-empresas-buscar").addEventListener("keydown", function (e) {
            if (e.key === "Enter") { var primero = panel.querySelector("[data-rfc]"); if (primero) elegirEmpresa(primero.dataset.rfc); }
        });
        document.getElementById("fc-empresa-ninguna").addEventListener("click", function () { elegirEmpresa(null); });
        document.addEventListener("click", cerrarEmpresas);
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") cerrarEmpresas(); });
    }

    /* --------------------------------------------- selector de periodo */
    /* Componente único para elegir periodo. Lo usa el selector general de la
       barra (solo mes y año) y lo reutiliza cualquier módulo con opciones
       extra (todo el año, todos los periodos, cuántos XML hay por mes):

         var sel = Fiscontable.selectorPeriodo({
             boton: el, etiqueta: el,          // el botón y dónde escribir el texto
             valor: "m:2025-10",               // "m:AAAA-MM" | "a:AAAA" | "t:" | "r:AAAA-MM-DD|AAAA-MM-DD" | null
             permitirAnio: true, permitirTodos: true, permitirQuitar: false,
             permitirRango: true,              // "Rango de fechas": del día X al día Y
             conteos: { "2025-10": 12 },       // opcional: se muestran en cada mes
             general: "2025-10",               // opcional: ofrece "volver al general"
             alCambiar: function (valor) {}
         });
         sel.poner(v); sel.conteos(obj); sel.general(p); sel.valor(); sel.abrir();
    */
    var MESES_LARGOS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    var MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

    function textoPeriodo(v) {
        if (!v) return "Elegir periodo";
        if (v === "t:") return "Todos los periodos";
        if (v.indexOf("a:") === 0) return "Todo " + v.slice(2);
        if (v.indexOf("m:") === 0) return MESES_LARGOS[+v.slice(7, 9) - 1] + " " + v.slice(2, 6);
        if (v.indexOf("r:") === 0) return textoRango(v.slice(2).split("|"));
        return v;
    }

    /** "3 ene – 15 mar 2026", "20 dic 2025 – 10 ene 2026", "Desde 1 ene 2026"… */
    function textoRango(r) {
        function dia(f, conAnio) {
            return +f.slice(8, 10) + " " + MESES_CORTOS[+f.slice(5, 7) - 1].toLowerCase() + (conAnio ? " " + f.slice(0, 4) : "");
        }
        var d = r[0] || "", h = r[1] || "";
        if (d && h) return dia(d, d.slice(0, 4) !== h.slice(0, 4)) + " – " + dia(h, true);
        if (d) return "Desde " + dia(d, true);
        if (h) return "Hasta " + dia(h, true);
        return "Rango de fechas";
    }

    function selectorPeriodo(o) {
        var st = { valor: o.valor || null, conteos: o.conteos || {}, general: o.general || null, anio: null };
        var pop = document.createElement("div");
        pop.className = "fc-periodo";
        pop.setAttribute("role", "dialog");
        pop.setAttribute("aria-label", "Elegir periodo");
        pop.hidden = true;
        document.body.appendChild(pop);

        function anioInicial() {
            var v = st.valor;
            if (v && (v.indexOf("m:") === 0 || v.indexOf("a:") === 0)) return +v.slice(2, 6);
            if (v && v.indexOf("r:") === 0 && /^\d{4}/.test(v.slice(2))) return +v.slice(2, 6);
            var llaves = Object.keys(st.conteos).sort();
            return llaves.length ? +llaves[llaves.length - 1].slice(0, 4) : new Date().getFullYear();
        }

        function pintar() {
            var a = st.anio, hayConteos = Object.keys(st.conteos).length > 0, totalAnio = 0;
            var meses = MESES_CORTOS.map(function (nombre, i) {
                var clave = a + "-" + String(i + 1).padStart(2, "0");
                var n = st.conteos[clave] || 0;
                totalAnio += n;
                var activo = st.valor === "m:" + clave;
                return '<button type="button" class="fc-periodo__mes' + (activo ? " fc-periodo__mes--activo" : "") +
                    (hayConteos && !n ? " fc-periodo__mes--vacio" : "") + '" data-mes="' + clave + '"' +
                    ' title="' + MESES_LARGOS[i] + " " + a + (hayConteos ? " · " + n + " XML" : "") + '">' +
                    "<span>" + nombre + "</span>" + (hayConteos && n ? "<small>" + n.toLocaleString("es-MX") + "</small>" : "") + "</button>";
            }).join("");
            var pie = [];
            if (o.permitirAnio) pie.push('<button type="button" class="fc-periodo__opcion' + (st.valor === "a:" + a ? " fc-periodo__opcion--activa" : "") +
                '" data-anio-completo="' + a + '">Todo ' + a + (hayConteos && totalAnio ? " <small>" + totalAnio.toLocaleString("es-MX") + "</small>" : "") + "</button>");
            if (o.permitirTodos) pie.push('<button type="button" class="fc-periodo__opcion' + (st.valor === "t:" ? " fc-periodo__opcion--activa" : "") +
                '" data-todos>Todos los periodos</button>');
            if (st.general && st.valor !== "m:" + st.general) pie.push('<button type="button" class="fc-periodo__general" data-general>' +
                "Volver al periodo general · " + esc(textoPeriodo("m:" + st.general)) + "</button>");
            if (o.permitirQuitar && st.valor) pie.push('<button type="button" class="fc-periodo__quitar" data-quitar>Quitar periodo</button>');
            if (o.permitirRango) {
                // Días exactos, en el mismo lugar que los meses: así no hay un segundo
                // filtro de fechas en otro panel que choque con el periodo.
                var r = st.valor && st.valor.indexOf("r:") === 0 ? st.valor.slice(2).split("|") : rangoDe(st.valor, a);
                pie.push('<div class="fc-periodo__rango' + (st.valor && st.valor.indexOf("r:") === 0 ? " fc-periodo__rango--activo" : "") + '">' +
                    "<span>Rango de fechas</span>" +
                    '<label><small>Del</small><input type="date" data-rango-desde value="' + esc(r[0] || "") + '"></label>' +
                    '<label><small>al</small><input type="date" data-rango-hasta value="' + esc(r[1] || "") + '"></label>' +
                    '<button type="button" class="fc-periodo__aplicar" data-rango>Aplicar</button></div>');
            }
            pop.innerHTML =
                '<div class="fc-periodo__cabeza">' +
                  '<button type="button" class="fc-periodo__flecha" data-anio="-1" aria-label="Año anterior">‹</button>' +
                  "<strong>" + a + "</strong>" +
                  '<button type="button" class="fc-periodo__flecha" data-anio="1" aria-label="Año siguiente">›</button>' +
                "</div>" +
                '<div class="fc-periodo__meses">' + meses + "</div>" +
                (pie.length ? '<div class="fc-periodo__pie">' + pie.join("") + "</div>" : "");
        }

        /** Fechas con las que se abre el rango: las del mes o año elegido, o el año que se ve. */
        function rangoDe(v, anio) {
            if (v && v.indexOf("m:") === 0) {
                var y = +v.slice(2, 6), m = +v.slice(7, 9);
                return [v.slice(2) + "-01", v.slice(2) + "-" + String(new Date(y, m, 0).getDate()).padStart(2, "0")];
            }
            if (v && v.indexOf("a:") === 0) return [v.slice(2) + "-01-01", v.slice(2) + "-12-31"];
            return [anio + "-01-01", anio + "-12-31"];
        }

        function aplicarRango() {
            var d = pop.querySelector("[data-rango-desde]").value, h = pop.querySelector("[data-rango-hasta]").value;
            if (!d && !h) return;
            if (d && h && d > h) { var t = d; d = h; h = t; }
            elegir("r:" + d + "|" + h);
        }

        function posicionar() {
            var r = o.boton.getBoundingClientRect();
            var ancho = pop.offsetWidth || 300;
            pop.style.top = Math.round(r.bottom + 6) + "px";
            pop.style.left = Math.round(Math.max(12, Math.min(r.left, window.innerWidth - ancho - 12))) + "px";
        }

        function abrir() {
            st.anio = anioInicial();
            pintar();
            pop.hidden = false;
            o.boton.setAttribute("aria-expanded", "true");
            posicionar();
            if (o.alAbrir) o.alAbrir();
        }
        function cerrar() {
            if (pop.hidden) return;
            pop.hidden = true;
            o.boton.setAttribute("aria-expanded", "false");
        }
        function etiqueta() {
            if (o.etiqueta) o.etiqueta.textContent = textoPeriodo(st.valor);
            o.boton.classList.toggle("fc-sin-periodo", !st.valor);
        }
        function elegir(v) {
            st.valor = v;
            cerrar();
            etiqueta();
            if (o.alCambiar) o.alCambiar(v);
        }

        o.boton.addEventListener("click", function () { if (pop.hidden) abrir(); else cerrar(); });
        pop.addEventListener("click", function (e) {
            var b = e.target.closest("button");
            if (!b) return;
            if (b.dataset.anio) { st.anio += +b.dataset.anio; pintar(); return; }
            if (b.dataset.mes) { elegir("m:" + b.dataset.mes); return; }
            if (b.dataset.anioCompleto) { elegir("a:" + b.dataset.anioCompleto); return; }
            if (b.hasAttribute("data-todos")) { elegir("t:"); return; }
            if (b.hasAttribute("data-general")) { elegir("m:" + st.general); return; }
            if (b.hasAttribute("data-quitar")) { elegir(null); return; }
            if (b.hasAttribute("data-rango")) aplicarRango();
        });
        pop.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && e.target.matches("[data-rango-desde], [data-rango-hasta]")) { e.preventDefault(); aplicarRango(); }
        });
        // pointerdown (no click): así se cierra aunque otro menú detenga el clic
        document.addEventListener("pointerdown", function (e) {
            if (!pop.hidden && !pop.contains(e.target) && !o.boton.contains(e.target)) cerrar();
        }, true);
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") cerrar(); });
        window.addEventListener("resize", cerrar);
        etiqueta();

        return {
            poner: function (v) { st.valor = v || null; etiqueta(); },
            valor: function () { return st.valor; },
            conteos: function (c) { st.conteos = c || {}; },
            general: function (g) { st.general = g || null; },
            abrir: abrir,
            cerrar: cerrar
        };
    }

    /* El periodo general (mes y año) se guarda en el servidor, igual que la
       empresa: te sigue en cualquier PC. Los módulos lo precargan; cambiar el
       periodo dentro de un módulo NO lo toca. */
    var selectorGeneral = null;

    function pintarPeriodo() {
        var boton = document.getElementById("fc-btn-periodo");
        if (!boton) return;
        var p = perfilActual && perfilActual.periodo_activo;
        boton.hidden = false;
        boton.classList.toggle("fc-empresa--vacia", !p);
        boton.title = p ? "Periodo general: " + textoPeriodo("m:" + p) + " — cambiar" : "Elige el periodo en el que vas a trabajar";
        if (!selectorGeneral) {
            selectorGeneral = selectorPeriodo({
                boton: boton, etiqueta: document.getElementById("fc-periodo-nombre"),
                valor: p ? "m:" + p : null, permitirQuitar: true,
                alAbrir: function () { cerrarEmpresas(); cerrarModulos(); var m = document.getElementById("fc-menu"); if (m) m.hidden = true; },
                alCambiar: elegirPeriodoGeneral
            });
        } else {
            selectorGeneral.poner(p ? "m:" + p : null);
        }
    }

    async function elegirPeriodoGeneral(valor) {
        var periodo = valor && valor.indexOf("m:") === 0 ? valor.slice(2) : null;
        try {
            var resp = await fetch(API + "/api/mi-perfil/periodo", {
                method: "PUT", credentials: "include",
                headers: { "Content-Type": "application/json" }, body: JSON.stringify({ periodo: periodo })
            });
            if (!resp.ok) throw new Error(await window.Fiscontable.leerError(resp));
            var r = await resp.json();
            perfilActual.periodo_activo = r.periodo_activo;
            promesaPerfil = Promise.resolve(perfilActual);
            pintarPeriodo();
            window.dispatchEvent(new CustomEvent("fiscontable:periodo", { detail: r.periodo_activo }));
        } catch (e) {
            pintarPeriodo();      // regresa el botón al valor que sí quedó guardado
            aviso(e.message || "No se pudo cambiar el periodo.");
        }
    }

    function avisoHTML() {
        return '<div class="fc-aviso" id="fc-aviso" role="status" hidden>' +
            '<span style="flex:none;width:18px;height:18px;margin-top:1px">' + ico(D.alerta) + "</span>" +
            '<div style="flex:1"><div id="fc-aviso-texto"></div>' +
            '<div class="fc-aviso__acciones" id="fc-aviso-acciones"></div></div></div>';
    }

    /* --------------------------------------------- panel de descargas */

    function pintarPanel() {
        var envoltorio = document.createElement("div");
        envoltorio.innerHTML =
            '<div class="fc-velo" id="fc-velo" hidden></div>' +
            '<aside class="fc-panel" id="fc-panel" role="dialog" aria-modal="true" aria-label="Mis descargas" hidden>' +
              '<div class="fc-panel__cabeza">' +
                "<div><div class=\"fc-panel__titulo\">Mis descargas</div>" +
                '<div class="fc-panel__sub" id="fc-panel-sub">Documentos listos y en preparación</div></div>' +
                '<button type="button" class="fc-panel__cerrar" id="fc-panel-cerrar" aria-label="Cerrar">' + ico(D.cerrar) + "</button>" +
              "</div>" +
              '<div class="fc-panel__cuerpo" id="fc-panel-cuerpo"></div>' +
              '<div class="fc-panel__pie"><a class="fc-btn" href="/descargas/" style="width:100%;justify-content:center">Ver el historial completo</a></div>' +
            "</aside>";
        while (envoltorio.firstChild) document.body.appendChild(envoltorio.firstChild);
    }

    var panelAbierto = false;
    var temporizador = null;
    var ultimaLista = [];
    var ultimoEstado = new Map();
    var primerSondeo = true;

    /* --- Qué procesos ya viste ---------------------------------------
       El contador tiene dos significados distintos y antes los mezclaba:
       lo que está corriendo (se limpia solo al terminar) y lo que acabó
       y todavía no has visto (eso sí hay que darlo por visto). Se guarda
       en el navegador para que siga valiendo cuando cambias de módulo.  */

    var LLAVE_VISTOS = "fc:procesos-vistos";

    function leerVistos() {
        try {
            return new Set(JSON.parse(localStorage.getItem(LLAVE_VISTOS) || "[]"));
        } catch (e) {
            return new Set();
        }
    }

    function guardarVistos(conjunto) {
        try {
            localStorage.setItem(LLAVE_VISTOS, JSON.stringify(Array.from(conjunto)));
        } catch (e) { /* si el navegador no deja guardar, el contador sigue funcionando */ }
    }

    var vistos = leerVistos();

    /** Da por visto todo lo que ya terminó (bien o mal). Lo que sigue
        corriendo se deja fuera: cuando acabe volverá a contar como nuevo. */
    function marcarComoVistos(procesos) {
        var antes = vistos.size;
        procesos.forEach(function (p) {
            if (p.estado !== "procesando") vistos.add(p.id);
        });
        // Se poda lo que el servidor ya borró, para que la lista no crezca sin fin.
        var vigentes = new Set(procesos.map(function (p) { return p.id; }));
        vistos.forEach(function (id) { if (!vigentes.has(id)) vistos.delete(id); });

        if (vistos.size !== antes) guardarVistos(vistos);
    }

    function abrirDescargas() {
        var velo = document.getElementById("fc-velo");
        var panel = document.getElementById("fc-panel");
        velo.hidden = false; panel.hidden = false;
        requestAnimationFrame(function () {
            velo.classList.add("abierto");
            panel.classList.add("abierto");
        });
        document.body.classList.add("fc-sin-scroll");
        panelAbierto = true;
        document.getElementById("fc-panel-cerrar").focus();

        if (ultimaLista.length) {
            pintarLista(ultimaLista);
            marcarComoVistos(ultimaLista);
            refrescarContador(ultimaLista);
        }
        sondear();
    }

    function cerrarDescargas() {
        var velo = document.getElementById("fc-velo");
        var panel = document.getElementById("fc-panel");
        velo.classList.remove("abierto");
        panel.classList.remove("abierto");
        document.body.classList.remove("fc-sin-scroll");
        panelAbierto = false;
        setTimeout(function () {
            if (panelAbierto) return;
            velo.hidden = true; panel.hidden = true;
        }, 260);
        var boton = document.getElementById("fc-btn-descargas");
        if (boton) boton.focus();
    }

    function fecha(iso) {
        if (!iso) return "";
        var f = new Date(iso + "Z");
        if (isNaN(f)) return "";
        var hoy = new Date();
        var hora = f.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
        if (f.toDateString() === hoy.toDateString()) return "Hoy " + hora;
        var ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
        if (f.toDateString() === ayer.toDateString()) return "Ayer " + hora;
        return f.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
    }

    var NOMBRES = {
        csf: "Constancia de Situación Fiscal",
        opinion: "Opinión de Cumplimiento",
        "csf+opinion": "Constancia y Opinión",
        declaraciones: "Declaraciones",
        voucheo: "Voucheo de impuestos",
        descarga_xml: "Descarga masiva de XML",
        programada_csf: "Programada · Constancias",
        programada_opinion: "Programada · Opiniones",
        programada_declaraciones: "Programada · Declaraciones",
        programada_xml: "Programada · Descarga de XML",
        programada_buzon: "Programada · Buzón Tributario",
        buzon_revisar: "Revisión del Buzón Tributario",
        buzon_abrir: "Apertura de notificación del Buzón"
    };

    function tituloProceso(p) {
        var base = NOMBRES[p.tipo] || p.tipo || "Documento";
        if (p.clase === "lote") return base + " — " + (p.total || "varios") + " contribuyentes";
        return base + (p.titulo ? " — " + p.titulo : "");
    }

    function tarjeta(p) {
        var t = esc(tituloProceso(p));
        var nuevo = p.estado !== "procesando" && !vistos.has(p.id)
            ? '<span class="fc-punto" title="Nuevo desde la última vez"></span>' : "";

        if (p.estado === "procesando") {
            var detalle = "Preparando…", barra = "";
            if (p.clase === "lote" && p.total > 0) {
                var pct = Math.round((p.procesados / p.total) * 100);
                detalle = p.procesados + " de " + p.total + (p.rfc_actual ? " · " + esc(p.rfc_actual) : "");
                barra = '<div class="progress-track" style="margin-top:9px"><div class="progress-fill" style="width:' + pct + '%"></div></div>';
            } else if (p.progreso) {
                detalle = esc(p.progreso);
            }
            return '<div class="fc-item"><div class="fc-item__titulo">' + t + "</div>" +
                '<div class="fc-item__detalle">' + detalle + "</div>" + barra +
                '<div class="fc-item__acciones"><button type="button" class="fc-btn fc-btn--discreto" ' +
                'data-accion="detener" data-clase="' + esc(p.clase) + '" data-id="' + esc(p.id) + '">Detener</button></div></div>';
        }

        if (p.estado === "completado") {
            var resumen = fecha(p.creado_en);
            if (p.clase === "lote") resumen = p.exitosos + " de " + p.total + " obtenidos · " + resumen;
            var incompleta = false;
            if (p.resumen) {         // madrugada: "1 listo, 2 fallaron"
                var noche = p.resumen.replace(/^[^:]*:\s*/, "").replace(/\.$/, "");
                incompleta = /revisar|fall|no alcanz|cancelad/i.test(noche);
                resumen = noche + " · " + resumen;
            }
            return '<div class="fc-item' + (incompleta ? " fc-item--alerta" : "") + '"><div class="fc-item__titulo">' + nuevo + t + "</div>" +
                '<div class="fc-item__detalle">' + esc(resumen) + "</div>" +
                (p.en_pc && p.en_pc.rutas && p.en_pc.rutas.length ? '<div class="fc-item__detalle" style="color:#065F46">' + esc(Fiscontable.textoEnPc(p.en_pc)) + "</div>" : "") +
                '<div class="fc-item__acciones">' +
                (p.en_pc && p.en_pc.rutas && p.en_pc.rutas.length ? '<button type="button" class="fc-btn" data-accion="mostrar-pc" data-id="' + esc(p.id) + '">Mostrar en mi PC</button>' : "") +
                '<button type="button" class="fc-btn fc-btn--principal" data-accion="descargar" ' +
                'data-url="' + esc(p.url_descarga) + '" data-nombre="' + esc(p.nombre_descarga || "documento") + '">Descargar</button>' +
                '<button type="button" class="fc-btn fc-btn--discreto" data-accion="quitar" ' +
                'data-clase="' + esc(p.clase) + '" data-id="' + esc(p.id) + '">Quitar</button>' +
                "</div></div>";
        }

        // Lote que se cortó: bajar lo que sí salió y reanudar los que faltan, sin ir a Mis descargas
        var parcial = p.clase === "lote" && p.parcial
            ? '<button type="button" class="fc-btn fc-btn--principal" data-accion="descargar" data-url="' + esc(p.url_descarga) +
              '" data-nombre="' + esc(p.nombre_descarga || "Lote_parcial.zip") + '">Bajar lo que salió (' + (p.exitosos || 0) + ")</button>" : "";
        var faltan = Math.max((p.total || 0) - (p.exitosos || 0), 0);
        var reanudar = p.clase === "lote" && p.se_puede_reanudar
            ? '<button type="button" class="fc-btn" data-accion="reanudar" data-id="' + esc(p.id) + '">Reanudar' +
              (faltan ? " los " + faltan : "") + "</button>" : "";
        return '<div class="fc-item fc-item--alerta"><div class="fc-item__titulo">' + nuevo + t + "</div>" +
            '<div class="fc-item__detalle">' + esc(p.mensaje_error || "No se pudo completar.") + "</div>" +
            (p.clase === "lote" && p.total ? '<div class="fc-item__detalle">' + (p.exitosos || 0) + " de " + p.total + " listos</div>" : "") +
            '<div class="fc-item__acciones">' + parcial + reanudar +
            (parcial || reanudar ? "" : '<a class="fc-btn" href="/descargas/">Ver detalle</a>') +
            '<button type="button" class="fc-btn fc-btn--discreto" data-accion="quitar" ' +
            'data-clase="' + esc(p.clase) + '" data-id="' + esc(p.id) + '">Quitar</button>' +
            "</div></div>";
    }

    function pintarLista(procesos) {
        var cuerpo = document.getElementById("fc-panel-cuerpo");
        if (!cuerpo) return;

        if (!procesos.length) {
            cuerpo.innerHTML = '<div class="fc-vacio">Todavía no hay nada aquí.<br>' +
                "Lo que generes va a aparecer en esta lista.</div>";
            return;
        }

        var grupos = [
            ["En preparación", procesos.filter(function (p) { return p.estado === "procesando"; })],
            ["Listos para descargar", procesos.filter(function (p) { return p.estado === "completado"; })],
            ["Sin resultado", procesos.filter(function (p) { return p.estado !== "procesando" && p.estado !== "completado"; })]
        ];

        cuerpo.innerHTML = grupos.filter(function (g) { return g[1].length; }).map(function (g) {
            return '<div class="fc-grupo"><div class="fc-grupo__titulo">' + g[0] + "</div>" +
                g[1].map(tarjeta).join("") + "</div>";
        }).join("");
    }

    function avisarNavegador(titulo, cuerpo) {
        if (!("Notification" in window) || Notification.permission !== "granted") return;
        try { new Notification(titulo, { body: cuerpo }); } catch (e) { /* sin permiso real */ }
    }

    /**
     * Recalcula el número del botón y devuelve cuántos procesos siguen
     * corriendo. El número suma dos cosas: lo que corre (se descuenta solo
     * al terminar) y lo que ya terminó pero no has visto (se descuenta al
     * abrir el panel). Si no hay ni una ni otra, el número desaparece.
     */
    function refrescarContador(procesos) {
        var activos = procesos.filter(function (p) { return p.estado === "procesando"; }).length;
        var nuevos = procesos.filter(function (p) {
            return p.estado !== "procesando" && !vistos.has(p.id);
        }).length;
        var total = activos + nuevos;

        var contador = document.getElementById("fc-contador");
        if (contador) {
            contador.textContent = total;
            contador.hidden = total === 0;
            contador.style.background = activos ? "#F59E0B" : "#12B76A";
            contador.style.color = activos ? "#241503" : "#FFFFFF";
        }

        var boton = document.getElementById("fc-btn-descargas");
        if (boton) {
            boton.classList.toggle("fc-accion--activa", activos > 0);
            boton.setAttribute("aria-label", activos
                ? "Mis descargas — " + activos + " en proceso"
                : (nuevos ? "Mis descargas — " + nuevos + " sin ver" : "Mis descargas"));
        }
        return activos;
    }

    async function sondear() {
        try {
            var resp = await fetch(API + "/api/procesos", { credentials: "include" });
            if (!resp.ok) { programar(); return; }
            var procesos = await resp.json();
            ultimaLista = procesos;

            var activos = refrescarContador(procesos);

            // Aviso del navegador cuando algo pasa de "procesando" a terminado.
            procesos.forEach(function (p) {
                var antes = ultimoEstado.get(p.id);
                if (!primerSondeo && antes === "procesando" && p.estado !== "procesando") {
                    avisarNavegador(
                        p.estado !== "completado" ? "No se pudo completar" : (/revisar|fall|no alcanz|cancelad/i.test(p.resumen || "") ? "Terminó, pero no salieron todos" : "Documento listo"),
                        tituloProceso(p)
                    );
                }
                ultimoEstado.set(p.id, p.estado);
            });
            primerSondeo = false;

            if (panelAbierto) {
                pintarLista(procesos);
                // Estás viéndolos: dejan de ser novedad, y el número baja
                // en el momento, sin esperar al siguiente sondeo.
                marcarComoVistos(procesos);
                refrescarContador(procesos);
            }
            programar(activos > 0);
        } catch (e) {
            programar();
        }
    }

    function programar(hayActivos) {
        clearTimeout(temporizador);
        // Si hay algo corriendo y el panel está abierto, seguimos de cerca.
        // Si no, apenas lo suficiente para que el contador no mienta.
        var espera = hayActivos ? (panelAbierto ? 3000 : 10000) : (panelAbierto ? 8000 : 45000);
        temporizador = setTimeout(function () {
            if (!document.hidden) sondear();
            else programar(hayActivos);
        }, espera);
    }

    async function accionPanel(e) {
        var boton = e.target.closest("[data-accion]");
        if (!boton) return;
        var accion = boton.dataset.accion;
        var original = boton.textContent;
        boton.disabled = true;

        try {
            if (accion === "mostrar-pc") {
                var proc = (ultimaLista || []).filter(function (x) { return String(x.id) === boton.dataset.id; })[0];
                if (proc && proc.en_pc) { await Fiscontable.mostrarEnPc(proc.en_pc, boton); return; }
            } else if (accion === "descargar") {
                boton.textContent = "Descargando…";
                var r = await fetch(API + boton.dataset.url, { credentials: "include" });
                if (!r.ok) throw new Error(await Fiscontable.leerError(r));
                Fiscontable.guardarArchivo(await r.blob(), boton.dataset.nombre);
            } else if (accion === "quitar") {
                var rq = await fetch(API + "/api/procesos/" + boton.dataset.clase + "/" + boton.dataset.id,
                    { method: "DELETE", credentials: "include" });
                if (!rq.ok) throw new Error(await Fiscontable.leerError(rq));
                ultimoEstado.delete(boton.dataset.id);
                await sondear();
                return;
            } else if (accion === "reanudar") {
                boton.textContent = "Reanudando…";
                var rr = await fetch(API + "/api/lotes/" + boton.dataset.id + "/reanudar", { method: "POST", credentials: "include" });
                if (!rr.ok) throw new Error(await Fiscontable.leerError(rr));
                aviso("Se reanudó el lote. Sigue donde se quedó; lo que ya salió no se vuelve a pedir al SAT.");
                await sondear();
                return;
            } else if (accion === "detener") {
                boton.textContent = "Deteniendo…";
                var ruta = boton.dataset.clase === "lote"
                    ? "/api/lotes/" + boton.dataset.id + "/cancelar"
                    : boton.dataset.clase === "programada"
                        ? "/api/programadas/" + boton.dataset.id + "/cancelar"
                        : "/api/trabajos/" + boton.dataset.id + "/cancelar";
                var rd = await fetch(API + ruta, { method: "POST", credentials: "include" });
                if (!rd.ok) throw new Error(await Fiscontable.leerError(rd));
                await sondear();
                return;
            }
        } catch (err) {
            aviso((err && err.message) || "No se pudo completar esa acción. Revisa tu conexión e intenta de nuevo.");
        } finally {
            boton.disabled = false;
            boton.textContent = original;
        }
    }

    /* ------------------------------------------------------- el perfil */

    var promesaPerfil = null;
    var perfilActual = null;

    // El modal vive aquí, no en la portada: así "Editar mi perfil"
    // funciona desde cualquier módulo sin mandarte de vuelta al inicio.
    function pintarModalPerfil() {
        var caja = document.createElement("div");
        caja.id = "fc-modal-perfil";
        caja.className = "fixed inset-0 hidden items-center justify-center p-4";
        // display:none propio: antes dependía de la clase "hidden" de Tailwind, y si el
        // CDN de Tailwind no cargaba, la ventana quedaba invisible ENCIMA de toda la página
        // bloqueando los clics. .modal-active (common.css) la muestra con !important.
        caja.style.cssText = "display:none;position:fixed;inset:0;z-index:90;background:rgba(16,27,45,.5);" +
            "backdrop-filter:blur(2px);align-items:center;justify-content:center;padding:16px";
        caja.innerHTML =
            '<div style="background:#fff;width:100%;max-width:420px;border-radius:var(--radio);' +
            'box-shadow:var(--sombra-alta);overflow:hidden">' +
              '<div style="padding:18px 20px;border-bottom:1px solid var(--linea)">' +
                '<div style="font-size:16px;font-weight:700" id="fc-mp-titulo">Mi perfil</div>' +
                '<div style="font-size:13px;color:var(--texto-tenue);margin-top:3px" id="fc-mp-sub"></div>' +
              "</div>" +
              '<form id="fc-mp-form" style="padding:20px;display:flex;flex-direction:column;gap:14px">' +
                '<label style="display:block"><span style="font-size:13px;font-weight:600">Nombre completo</span>' +
                  '<input id="fc-mp-nombre" type="text" required placeholder="Ej. Alan Sánchez" ' +
                  'style="width:100%;margin-top:6px;padding:11px;border:1px solid var(--linea);border-radius:10px;font:inherit;font-size:14px"></label>' +
                '<label style="display:block"><span style="font-size:13px;font-weight:600">Teléfono</span> ' +
                  '<span style="font-size:12.5px;color:var(--texto-tenue)">(opcional)</span>' +
                  '<input id="fc-mp-telefono" type="tel" placeholder="Ej. 998 123 4567" ' +
                  'style="width:100%;margin-top:6px;padding:11px;border:1px solid var(--linea);border-radius:10px;font:inherit;font-size:14px"></label>' +
                '<label style="display:block"><span style="font-size:13px;font-weight:600">Correo</span>' +
                  '<input id="fc-mp-correo" type="text" readonly class="campo-solo-lectura" ' +
                  'style="width:100%;margin-top:6px;padding:11px;border:1px solid var(--linea);border-radius:10px;font:inherit;font-size:14px">' +
                  '<span style="display:block;font-size:12px;color:var(--texto-tenue);margin-top:5px">' +
                  "Viene de tu acceso y no se cambia aquí.</span></label>" +
                '<div style="display:flex;gap:10px;margin-top:4px">' +
                  '<button type="button" class="fc-btn" id="fc-mp-cancelar" style="flex:1;justify-content:center;padding:11px">Cancelar</button>' +
                  '<button type="submit" class="fc-btn fc-btn--principal" id="fc-mp-guardar" style="flex:1;justify-content:center;padding:11px">Guardar</button>' +
                "</div>" +
              "</form></div>";
        document.body.appendChild(caja);

        document.getElementById("fc-mp-cancelar").addEventListener("click", cerrarModalPerfil);
        document.getElementById("fc-mp-form").addEventListener("submit", guardarPerfil);
    }

    function abrirModalPerfil(esPrimeraVez) {
        if (!perfilActual) return;
        var caja = document.getElementById("fc-modal-perfil");
        document.getElementById("fc-menu").hidden = true;
        document.getElementById("fc-mp-nombre").value = perfilActual.nombre || "";
        document.getElementById("fc-mp-telefono").value = perfilActual.telefono || "";
        document.getElementById("fc-mp-correo").value = perfilActual.correo || "";
        document.getElementById("fc-mp-titulo").textContent = esPrimeraVez ? "Te damos la bienvenida" : "Mi perfil";
        document.getElementById("fc-mp-sub").textContent = esPrimeraVez
            ? "Sólo falta tu nombre para personalizar tu espacio. Lo puedes cambiar después."
            : "Actualiza tus datos de contacto.";
        document.getElementById("fc-mp-cancelar").style.display = esPrimeraVez ? "none" : "";
        caja.dataset.noCerrable = esPrimeraVez ? "true" : "false";
        caja.classList.add("modal-active");
        document.getElementById("fc-mp-nombre").focus();
    }

    function cerrarModalPerfil() {
        document.getElementById("fc-modal-perfil").classList.remove("modal-active");
    }

    async function guardarPerfil(e) {
        e.preventDefault();
        var boton = document.getElementById("fc-mp-guardar");
        boton.disabled = true;
        boton.textContent = "Guardando…";
        try {
            var resp = await fetch(API + "/api/mi-perfil", {
                method: "PUT",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    nombre: document.getElementById("fc-mp-nombre").value.trim(),
                    telefono: document.getElementById("fc-mp-telefono").value.trim()
                })
            });
            if (!resp.ok) { aviso("No se pudo guardar tu perfil. Intenta de nuevo."); return; }
            promesaPerfil = Promise.resolve(await resp.json());
            pintarPerfil(await promesaPerfil);
            cerrarModalPerfil();
        } catch (err) {
            aviso("No se pudo guardar tu perfil. Revisa tu conexión e intenta de nuevo.");
        } finally {
            boton.disabled = false;
            boton.textContent = "Guardar";
        }
    }

    function perfil() {
        if (!promesaPerfil) {
            promesaPerfil = (async function () {
                try {
                    var resp = await fetch(API + "/api/mi-perfil", { credentials: "include" });
                    if (resp.status === 401 || resp.status === 403) {
                        // Sesión cerrada por el administrador o tope de sesiones: el servidor dice el motivo
                        var motivo = "";
                        try { motivo = (await resp.json()).detail || ""; } catch (e) { /* sin cuerpo */ }
                        if (/cerró el administrador|ya está abierta en/i.test(motivo)) return { _error: "bloqueada", motivo: motivo };
                        return { _error: "sesion" };
                    }
                    if (!resp.ok) return { _error: "servidor" };
                    return await resp.json();
                } catch (e) {
                    return { _error: "conexion" };
                }
            })();
        }
        return promesaPerfil;
    }

    function vigencia(p) {
        if (!p.activo) return "Desactivado";
        if (!p.fecha_expira) return "Sin vencimiento";
        var f = new Date(p.fecha_expira);
        var texto = f.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
        return p.expirado ? "Venció el " + texto : "Hasta " + texto;
    }

    function pintarPerfil(p) {
        perfilActual = p;
        var nombre = p.nombre || (p.correo || "").split("@")[0] || "Tu cuenta";

        document.getElementById("fc-avatar").textContent = nombre.charAt(0).toUpperCase();
        document.getElementById("fc-nombre-corto").textContent = nombre.split(" ")[0];
        document.getElementById("fc-menu-nombre").textContent = p.nombre || "Sin nombre";
        document.getElementById("fc-menu-correo").textContent = p.correo || "";
        document.getElementById("fc-menu-telefono").textContent = p.telefono || "Sin teléfono";
        document.getElementById("fc-menu-plan").textContent = p.rol || "—";
        document.getElementById("fc-menu-vigencia").textContent = vigencia(p);
        document.getElementById("fc-menu-creditos").textContent = p.creditos == null ? "—" : Number(p.creditos).toLocaleString("es-MX");

        // Configuración la ven todos; la parte de Administración solo el admin (adentro de Configuración)
        pintarLetreros(p);
        pintarEmpresa();
        pintarPeriodo();

        if (p.solo_lectura) {
            aviso("Tu acceso venció. Puedes consultar tu directorio, pero no generar documentos. " +
                "Contacta al administrador para renovarlo.");
        }
        // Primer ingreso: pedimos el nombre una sola vez, caiga donde caiga.
        if (!p.perfil_completo) abrirModalPerfil(true);
        document.dispatchEvent(new CustomEvent("fc:perfil", { detail: p }));
    }

    function manejarErrorPerfil(tipo, motivo) {
        if (tipo === "bloqueada") {
            aviso(motivo, [{ texto: "Cerrar sesión", href: "/cdn-cgi/access/logout" },
                           { texto: "Reintentar", accion: function () { promesaPerfil = null; iniciarPerfil(); } }]);
            document.dispatchEvent(new CustomEvent("fc:perfil", { detail: null }));
            return;
        }
        var acciones = [
            { texto: "Reconectar sesión", href: API + "/" },
            { texto: "Reintentar", accion: function () { promesaPerfil = null; iniciarPerfil(); } }
        ];
        if (tipo === "sesion") {
            aviso("Tu sesión con el servidor expiró. Reconéctala para continuar.", acciones);
        } else {
            aviso("No pudimos conectar con el servidor. Puede que tu sesión haya expirado o que el " +
                "servidor no esté disponible ahora mismo.", acciones);
        }
        document.dispatchEvent(new CustomEvent("fc:perfil", { detail: null }));
    }

    async function iniciarPerfil() {
        ocultarAviso();
        var p = await perfil();
        if (p && p._error) { manejarErrorPerfil(p._error, p.motivo); return; }
        pintarPerfil(p);
    }

    /* ------------------------------------------------ letreros globales */
    /* Los publica el administrador desde Administración → Sistema y llegan
       con /api/mi-perfil: el modo mantenimiento (no se cierra) y el aviso
       global (se puede cerrar; vuelve a salir si el aviso cambia). */

    function pintarLetreros(p) {
        var viejo = document.getElementById("fc-letreros");
        if (viejo) viejo.remove();
        var barra = document.querySelector(".fc-barra");
        if (!barra) return;

        var caja = document.createElement("div");
        caja.id = "fc-letreros";

        function letrero(texto, colores, cerrable, alCerrar, enlace) {
            var fila = document.createElement("div");
            fila.setAttribute("role", "status");
            fila.style.cssText = "display:flex;align-items:flex-start;gap:12px;justify-content:center;" +
                "padding:10px 16px;font-size:13.5px;font-weight:600;line-height:1.4;" + colores;
            var t = document.createElement("span");
            t.textContent = texto;
            t.style.maxWidth = "900px";
            fila.appendChild(t);
            if (enlace) {
                var a = document.createElement("a");
                a.href = enlace.href; a.textContent = enlace.texto;
                a.style.cssText = "color:inherit;text-decoration:underline;white-space:nowrap";
                fila.appendChild(a);
            }
            if (cerrable) {
                var b = document.createElement("button");
                b.type = "button";
                b.textContent = "✕";
                b.title = "Ocultar este aviso";
                b.setAttribute("aria-label", "Ocultar este aviso");
                b.style.cssText = "background:none;border:0;cursor:pointer;font-size:14px;opacity:.7;padding:0 4px;color:inherit";
                b.addEventListener("click", function () { fila.remove(); alCerrar(); });
                fila.appendChild(b);
            }
            caja.appendChild(fila);
        }

        if (p.mantenimiento) {
            letrero("Portal en mantenimiento: por ahora no se pueden iniciar descargas nuevas. Lo que ya estaba corriendo sigue." +
                (p.rol === "admin" ? " (Tú, como administrador, sigues pudiendo usar todo.)" : ""),
                "background:#FEF3C7;color:#78350F;border-bottom:1px solid #FCD34D", false);
        }
        if (p.aviso && p.aviso.texto) {
            var clave = "fc-aviso-oculto:" + (p.aviso.publicado_en || "") + ":" + p.aviso.texto;
            var oculto = false;
            try { oculto = localStorage.getItem("fc-aviso-oculto") === clave; } catch (e) { /* sin almacenamiento */ }
            if (!oculto) {
                letrero(p.aviso.texto,
                    p.aviso.tipo === "atencion"
                        ? "background:#FFF7ED;color:#9A3412;border-bottom:1px solid #FDBA74"
                        : "background:#EFF6FF;color:#1E3A8A;border-bottom:1px solid #BFDBFE",
                    true,
                    function () { try { localStorage.setItem("fc-aviso-oculto", clave); } catch (e) { /* nada */ } });
            }
        }
        // Lo pone solo el monitor del SAT (Administración → Sistema) mientras un servicio no responde.
        if (p.sat_fallas && p.sat_fallas.length) {
            var claveSat = "fc-sat-oculto:" + p.sat_fallas.map(function (s) { return s.servicio + "@" + (s.desde || ""); }).join(",");
            var ocultoSat = false;
            try { ocultoSat = localStorage.getItem("fc-sat-oculto") === claveSat; } catch (e) { /* sin almacenamiento */ }
            if (!ocultoSat) {
                var nombres = p.sat_fallas.map(function (s) { return s.nombre; });
                var lista = nombres.length > 1 ? nombres.slice(0, -1).join(", ") + " y " + nombres[nombres.length - 1] : nombres[0];
                letrero("El SAT no está respondiendo en: " + lista + ". Lo que pidas ahí puede fallar; conviene intentarlo más tarde. " +
                    "Este aviso se quita solo cuando vuelva.",
                    "background:#FEF2F2;color:#991B1B;border-bottom:1px solid #FECACA",
                    true,
                    function () { try { localStorage.setItem("fc-sat-oculto", claveSat); } catch (e) { /* nada */ } });
            }
        }
        // Una PC se vinculó a esta cuenta y no recibe trámites hasta que su dueño la apruebe
        if (p.pcs_por_aprobar && p.pcs_por_aprobar.length && location.pathname.indexOf("/agente/") !== 0) {
            letrero("Se conectó una PC nueva a tu cuenta (" + p.pcs_por_aprobar.join(", ") + "). Si fuiste tú, apruébala; si no, desconéctala.",
                "background:#FFF7ED;color:#9A3412;border-bottom:1px solid #FDBA74", false, null,
                { href: "/agente/", texto: "Revisar" });
        }
        if (caja.children.length) barra.insertAdjacentElement("afterend", caja);
    }

    /* ------------------------------------------------ avisos y bloqueo */

    function aviso(mensaje, acciones) {
        var caja = document.getElementById("fc-aviso");
        if (!caja) return;
        document.getElementById("fc-aviso-texto").textContent = mensaje;
        var zona = document.getElementById("fc-aviso-acciones");
        zona.innerHTML = "";
        (acciones || []).forEach(function (a) {
            var el;
            if (a.href) {
                el = document.createElement("a");
                el.href = a.href; el.target = "_blank"; el.rel = "noopener";
            } else {
                el = document.createElement("button");
                el.type = "button";
                el.addEventListener("click", a.accion);
            }
            el.className = "fc-btn";
            el.textContent = a.texto;
            zona.appendChild(el);
        });
        caja.hidden = false;
    }

    function ocultarAviso() {
        var caja = document.getElementById("fc-aviso");
        if (caja) caja.hidden = true;
    }

    /* ------------------------------------------------ módulos que el plan no incluye
       Todo sale de los permisos reales del usuario (su rol y sus ajustes propios): si el admin le da un módulo, se
       desbloquea solo. Al tocar uno bloqueado sale este aviso con el contacto que el admin puso en Permisos por rol. */
    var NOMBRE_PLAN = { admin: "Admin", pro: "Pro", plus: "Plus", demo: "Demo" };
    function planInfo() { return (perfilActual && perfilActual.planes) || { contacto: { texto: "Contacta al administrador para mejorar tu plan." }, proximos: [] }; }
    function nombrePlan() { var r = perfilActual && perfilActual.rol; return NOMBRE_PLAN[r] || (r ? r.charAt(0).toUpperCase() + r.slice(1) : ""); }
    function botonesContacto(modulo) {
        var c = planInfo().contacto || {}, correo = (perfilActual && perfilActual.correo) || "";
        var texto = "Hola, quiero " + (modulo ? "agregar «" + modulo + "» a" : "mejorar") + " mi plan de Fiscontable" + (correo ? " (" + correo + ")" : "") + ".";
        var b = "";
        if (c.whatsapp) b += '<a class="fc-btn fc-btn--principal" target="_blank" rel="noopener" href="https://wa.me/' + esc(c.whatsapp) + "?text=" + encodeURIComponent(texto) + '">WhatsApp</a>';
        if (c.correo) b += '<a class="fc-btn" href="mailto:' + esc(c.correo) + "?subject=" + encodeURIComponent("Mejorar mi plan de Fiscontable") + "&body=" + encodeURIComponent(texto) + '">Correo</a>';
        return b;
    }
    function avisoPlan(clave) {
        var m = CATALOGO.filter(function (x) { return x.clave === clave; })[0];
        var dlg = document.getElementById("fc-plan");
        if (!dlg) {
            dlg = document.createElement("dialog");
            dlg.id = "fc-plan"; dlg.className = "fc-plan";
            document.body.appendChild(dlg);
            dlg.addEventListener("click", function (e) { if (e.target === dlg || e.target.closest("[data-cerrar]")) dlg.close(); });
        }
        var plan = nombrePlan();
        dlg.innerHTML = '<div class="fc-plan__caja"><div class="fc-plan__ico" style="--tono:' + (m ? m.tono : "#475569") + ";--tono-suave:" + (m ? m.suave : "#EEF1F5") + '">' +
            (m ? ico(m.icono, 1.7) : "") + '<span class="fc-plan__candado">' + ico(D.candado, 2) + "</span></div>" +
            "<h3>" + esc(m ? m.nombre : "Este módulo") + "</h3>" +
            "<p>No está incluido en tu plan" + (plan ? " <b>" + esc(plan) + "</b>" : "") + ".</p>" +
            (m ? '<p class="fc-plan__desc">' + esc(m.desc) + ".</p>" : "") +
            '<p class="fc-plan__contacto">' + esc((planInfo().contacto || {}).texto || "Contacta al administrador para mejorar tu plan.") + "</p>" +
            '<div class="fc-plan__botones">' + botonesContacto(m && m.nombre) + '<button type="button" class="fc-btn" data-cerrar>Entendido</button></div></div>';
        dlg.showModal();
    }
    // Cualquier módulo bloqueado (menú «Módulos», Herramientas, portada) lleva data-plan
    document.addEventListener("click", function (e) {
        var a = e.target.closest && e.target.closest("[data-plan]");
        if (!a) return;
        e.preventDefault(); e.stopPropagation();
        avisoPlan(a.dataset.plan);
    }, true);

    function bloquear(mensaje, extra) {
        var main = document.querySelector("main");
        if (!main) return;
        main.innerHTML = '<div class="fc-bloqueo">' + ico(D.candado, 1.6) +
            "<p>" + esc(mensaje) + "</p>" +
            '<div class="fc-plan__botones" style="margin-top:16px">' + (extra || "") +
            '<a class="fc-btn' + (extra ? "" : " fc-btn--principal") + '" href="/herramientas/">Ver mis herramientas</a></div></div>';
    }

    /**
     * Verifica que el usuario pueda usar este módulo ANTES de que llene
     * nada. Antes sólo Herramientas lo hacía; Declaraciones, Validador y
     * Conciliación dejaban que el backend rechazara al final.
     */
    async function exigirModulo(permiso) {
        var requerido = permiso || modulo.permiso;
        var p = await perfil();

        if (!p || p._error) {
            bloquear(p && p._error === "bloqueada" ? p.motivo : p && p._error === "sesion"
                ? "Tu sesión expiró. Recarga la página para entrar de nuevo."
                : "No pudimos conectar con el servidor. Intenta más tarde o contacta al administrador.");
            return false;
        }
        if (p.solo_lectura) {
            bloquear("Tu acceso venció. No puedes generar documentos hasta que se renueve. " +
                "Contacta al administrador.", botonesContacto(null));
            return false;
        }
        if (requerido && !(p.modulos_permitidos || []).includes(requerido)) {
            var plan = nombrePlan();
            bloquear("Tu plan" + (plan ? " " + plan : " actual") + " no incluye " + modulo.nombre + ". " +
                ((planInfo().contacto || {}).texto || "Contacta al administrador para mejorar tu plan."), botonesContacto(modulo.nombre));
            return false;
        }
        return true;
    }

    /* ------------------------------------------------------- arranque */

    pintarBarra();
    pintarPanel();
    pintarModalPerfil();

    document.getElementById("fc-btn-descargas").addEventListener("click", abrirDescargas);
    document.getElementById("fc-panel-cerrar").addEventListener("click", cerrarDescargas);
    document.getElementById("fc-velo").addEventListener("click", cerrarDescargas);
    document.getElementById("fc-panel-cuerpo").addEventListener("click", accionPanel);

    prepararEmpresas();
    prepararModulos();

    // Instructivo de la herramienta
    var botonAyuda = document.getElementById("fc-ayuda");
    if (botonAyuda) botonAyuda.addEventListener("click", function () {
        var pasos = AYUDA[ancla.dataset.ayuda || clave] || [];
        var caja = document.getElementById("fc-ayuda-modal");
        if (!caja) {
            caja = document.createElement("div");
            caja.id = "fc-ayuda-modal";
            caja.className = "fc-ayuda-modal";
            caja.addEventListener("click", function (e) { if (e.target === caja || e.target.closest("[data-cerrar]")) caja.hidden = true; });
            document.addEventListener("keydown", function (e) { if (e.key === "Escape") caja.hidden = true; });
            document.body.appendChild(caja);
        }
        caja.innerHTML = '<div class="fc-ayuda-modal__caja" role="dialog" aria-label="Cómo se usa">' +
            "<h2>Cómo se usa · " + esc(ancla.dataset.titulo || modulo.nombre) + "</h2>" +
            "<ol>" + pasos.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ol>" +
            '<button type="button" class="fc-ayuda-modal__cerrar" data-cerrar>Entendido</button></div>';
        caja.hidden = false;
    });

    var btnPerfil = document.getElementById("fc-btn-perfil");
    var menu = document.getElementById("fc-menu");

    btnPerfil.addEventListener("click", function (e) {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
        btnPerfil.setAttribute("aria-expanded", String(!menu.hidden));
    });

    document.getElementById("fc-btn-editar-perfil").addEventListener("click", function () {
        menu.hidden = true;
        abrirModalPerfil(false);
    });

    document.addEventListener("click", function (e) {
        if (!menu.hidden && !menu.contains(e.target) && !btnPerfil.contains(e.target)) {
            menu.hidden = true;
            btnPerfil.setAttribute("aria-expanded", "false");
        }
    });

    // ESC cierra lo más superficial primero. Antes sólo funcionaba en
    // 3 de las 12 páginas, y con reglas distintas en cada una.
    document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        if (cerrarModulos()) return;
        if (panelAbierto) { cerrarDescargas(); return; }
        if (!menu.hidden) { menu.hidden = true; btnPerfil.setAttribute("aria-expanded", "false"); return; }
        document.querySelectorAll(".modal-active").forEach(function (m) {
            if (m.dataset.noCerrable === "true") return;
            m.classList.remove("modal-active");
        });
    });

    document.addEventListener("visibilitychange", function () {
        if (!document.hidden) sondear();
    });

    // Un solo temporizador vivo por página, y se apaga al salir: antes
    // cada módulo dejaba su propio setInterval corriendo.
    window.addEventListener("pagehide", function () { clearTimeout(temporizador); });

    // Tablas anchas: se envuelven en un carril con desplazamiento lateral
    // para que en el teléfono se puedan ver de lado en vez de romper la
    // página. Funciona en cualquier módulo, presente o futuro.
    function enCarril(tabla) {
        if (tabla.closest(".fc-carril") || tabla.closest("dialog")) return;
        // Si ya vive en una caja que se desplaza sola (tablas de XML, Conciliación…), no se toca
        for (var e = tabla.parentElement; e && e.tagName !== "MAIN"; e = e.parentElement) {
            var o = getComputedStyle(e).overflowX;
            if (o === "auto" || o === "scroll") return;
        }
        var carril = document.createElement("div");
        carril.className = "fc-carril";
        tabla.parentNode.insertBefore(carril, tabla);
        carril.appendChild(tabla);
    }
    document.querySelectorAll("main table").forEach(enCarril);
    // También las tablas que se dibujan después (Administración, Créditos, Documentos…)
    var principal = document.querySelector("main");
    if (principal && window.MutationObserver) {
        new MutationObserver(function (cambios) {
            cambios.forEach(function (c) {
                c.addedNodes.forEach(function (n) {
                    if (n.nodeType !== 1) return;
                    if (n.tagName === "TABLE") enCarril(n);
                    else if (n.querySelectorAll) n.querySelectorAll("table").forEach(enCarril);
                });
            });
        }).observe(principal, { childList: true, subtree: true });
    }

    iniciarPerfil();
    sondear();

    Object.assign(window.Fiscontable, {
        modulo: clave,
        catalogo: CATALOGO,
        avisoPlan: avisoPlan,
        planInfo: planInfo,
        nombrePlan: nombrePlan,
        recientes: recientes,
        permitido: function (m) { return permitido(m); },
        abrirModulos: abrirModulos,
        perfil: perfil,
        exigirModulo: exigirModulo,
        bloquear: bloquear,
        aviso: aviso,
        ocultarAviso: ocultarAviso,
        abrirDescargas: abrirDescargas,
        cerrarDescargas: cerrarDescargas,
        refrescarDescargas: sondear,
        abrirModalPerfil: abrirModalPerfil,
        // La empresa elegida en el selector general (o null). Los módulos también
        // pueden escuchar window "fiscontable:empresa" para enterarse de un cambio.
        elegirEmpresa: function (rfc) { return elegirEmpresa(rfc); },
        // Configuración en una ventana sobre el módulo: al dar «Listo» se cierra, se queda en el módulo y avisa con
        // window "fiscontable:config" ({seccion}) para que el módulo vuelva a leer lo que cambió.
        abrirConfiguracion: abrirConfiguracion,
        verPdf: verPdf,
        pdfEn: pdfEn,
        empresaActiva: function () {
            return perfil().then(function (p) { return p && !p._error ? (p.empresa_activa || null) : null; });
        },
        // Periodo general ("AAAA-MM" o null). Evento: window "fiscontable:periodo".
        periodoActivo: function () {
            return perfil().then(function (p) { return p && !p._error ? (p.periodo_activo || null) : null; });
        },
        elegirPeriodo: function (periodo) { return elegirPeriodoGeneral(periodo ? "m:" + periodo : null); },
        // Componente reutilizable para cualquier módulo (ver comentario arriba)
        selectorPeriodo: selectorPeriodo,
        textoPeriodo: textoPeriodo,
        // Para Administración → Sistema: vuelve a pedir el perfil y repinta los letreros.
        recargarLetreros: async function () {
            promesaPerfil = null;
            var p = await perfil();
            if (p && !p._error) { perfilActual = p; pintarLetreros(p); }
        }
    });
})();
