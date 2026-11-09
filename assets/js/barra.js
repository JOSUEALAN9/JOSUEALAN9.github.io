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
        clientes:      { nombre: "Clientes",          acento: "#6D28D9", suave: "#F1EBFD", permiso: null },
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
        cancelaciones: ["«Por responder»: Buscar en el SAT y aceptar o rechazar una por una (72 horas).",
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
        xml: "M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9zM14 3v6h6M10 12l-2 2.5 2 2.5M14 12l2 2.5-2 2.5",
        nube: "M7 17a4 4 0 01-.9-7.9 5 5 0 019.7-1.3A4 4 0 0117 17M12 12v8m-3-3l3 3 3-3",
        medalla: "M12 14a5 5 0 100-10 5 5 0 000 10zM8.5 12.6L7 21l5-2.5 5 2.5-1.5-8.4",
        archivo: "M3 5a1 1 0 011-1h16a1 1 0 011 1v3H3zM5 8v11a1 1 0 001 1h12a1 1 0 001-1V8M10 12h4",
        cruce: "M4 8h13m0 0l-3-3m3 3l-3 3M20 16H7m0 0l3-3m-3 3l3 3",
        porciento: "M19 5L5 19M7 9a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z",
        enviar: "M4 12l16-8-6 16-3-7zM11 13l9-9",
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
    // Menú agrupado por el trabajo del contador (aprobado el 9 nov 2026). Las direcciones no cambian.
    // cuenta: true = no va en el menú (Descargas y Créditos viven en la barra y en el menú de usuario).
    // Íconos de un solo color: el color es solo para estados, nunca para distinguir módulos.
    var GRUPOS = ["Clientes", "Comprobantes", "Cierre del mes", "Cumplimiento", "Nómina", "Facturación", "Documentos"];
    var CATALOGO = [
        { clave: "clientes", grupo: "Clientes", nombre: "Clientes", desc: "Empresas, e.firma y obligaciones", url: "/clientes/", permiso: null, icono: I.clientes, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },

        { clave: "xml", grupo: "Comprobantes", nombre: "Administración de XML", alias: "xml comprobantes", desc: "Tus XML por tipo, con reportes en Excel", url: "/herramientas/xml/", permiso: "validador", icono: I.xml, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },
        { clave: "descarga_xml", grupo: "Comprobantes", nombre: "Descarga masiva", alias: "descarga masiva de xml web service portal", desc: "Emitidos y recibidos de un periodo", url: "/herramientas/descarga-xml/", permiso: "descarga_xml", icono: I.nube, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },
        { clave: "validador", grupo: "Comprobantes", nombre: "Validador", alias: "validador de xml vigente cancelado", desc: "¿Vigente o cancelado ante el SAT?", url: "/herramientas/validador/", permiso: "validador", icono: I.palomita, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },
        { clave: "marcas", grupo: "Comprobantes", nombre: "Marcas fiscales", desc: "Para qué impuesto cuenta cada CFDI y por qué", url: "/herramientas/xml/fiscal.html", permiso: "marcas", icono: I.balanza, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },
        { clave: "cancelaciones", grupo: "Comprobantes", nombre: "Cancelaciones", desc: "Cancela emitidas y responde las que te piden", url: "/herramientas/xml/cancelaciones.html", permiso: "cancelaciones", icono: I.prohibido, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },

        { clave: "conciliacion", grupo: "Cierre del mes", nombre: "Conciliación", num: 1, desc: "Facturas contra pagos y notas de crédito", url: "/herramientas/conciliacion/", permiso: "conciliacion", icono: I.cruce, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },
        { clave: "iva", grupo: "Cierre del mes", nombre: "Papel de trabajo IVA", num: 2, alias: "papel de trabajo de iva", desc: "IVA cobrado y pagado del mes", url: "/herramientas/iva/", permiso: "iva", icono: I.porciento, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },
        { clave: "isn", grupo: "Cierre del mes", nombre: "Impuestos estatales", num: 3, alias: "isn nominas hospedaje", desc: "ISN, hospedaje, profesiones y alcohol (Q. Roo)", url: "/herramientas/isn/", permiso: "isn", icono: I.gente, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },
        { clave: "presentar", grupo: "Cierre del mes", pronto: true, num: 4, nombre: "Declarar", alias: "presentar declaraciones", desc: "En preparación", url: null, permiso: null, icono: I.enviar, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },
        { clave: "voucheo", grupo: "Cierre del mes", nombre: "Voucheo", num: 5, alias: "voucheo de impuestos acuses", desc: "Acuses estatales a tu papel de trabajo", url: "/herramientas/voucheo/", permiso: "voucheo", icono: I.ticket, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },

        { clave: "opinion", grupo: "Cumplimiento", nombre: "Opinión 32-D", alias: "opinion de cumplimiento", desc: "De una empresa o de varias a la vez", url: "/herramientas/opinion/", permiso: "opinion", icono: I.escudo, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },
        { clave: "constancias", grupo: "Cumplimiento", nombre: "Constancia fiscal", alias: "constancia de situacion fiscal csf", desc: "De una empresa o de varias a la vez", url: "/herramientas/constancias/", permiso: "constancias", icono: I.medalla, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },
        { clave: "buzon", grupo: "Cumplimiento", nombre: "Buzón Tributario", desc: "Comunicados, cancelaciones y notificaciones", url: "/herramientas/buzon/", permiso: "buzon", icono: I.buzon, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },
        { clave: "listas", grupo: "Cumplimiento", nombre: "Listas del SAT", desc: "69, 69-B y demás listas negras", url: "/herramientas/listas-sat/", permiso: "validador", icono: I.alerta, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },
        { clave: "declaraciones", grupo: "Cumplimiento", nombre: "Declaraciones", alias: "declaraciones presentadas acuses", desc: "Acuses, pagos y recibos", url: "/herramientas/declaraciones/", permiso: "declaraciones", icono: I.archivo, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },

        // Nómina en laboratorio: solo el administrador la ve (soloAdmin) y el servidor solo a él le entrega la página
        { clave: "nomina", grupo: "Nómina", soloAdmin: true, nombre: "Nómina", alias: "nomina motor prueba recibos imss isr", desc: "Prueba del motor de cálculo (solo administrador)", url: "/herramientas/nomina/", permiso: null, icono: "M9 7a3 3 0 106 0 3 3 0 00-6 0zM5 21v-1a5 5 0 015-5h4a5 5 0 015 5v1M17 4.5a3 3 0 010 5.5M19.5 15.5A4.5 4.5 0 0122 19.5V21", tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },

        { clave: "facturar", grupo: "Facturación", nombre: "Facturar", desc: "Facturas, notas de crédito y recibos de pago", url: "/herramientas/facturar/", permiso: "facturacion", icono: I.recibo, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },

        { clave: "documentos", grupo: "Documentos", nombre: "Documentos", desc: "Actas, constancias, IMSS e INFONAVIT", url: "/herramientas/documentos/", permiso: "documentos", icono: I.credencial, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },

        { clave: "descargas", grupo: "Tu cuenta", cuenta: true, nombre: "Mis descargas", alias: "descargas", desc: "Todo lo que bajan las herramientas", url: "/descargas/", permiso: null, icono: I.bajar, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" },
        { clave: "creditos", grupo: "Tu cuenta", cuenta: true, nombre: "Mis créditos", alias: "creditos saldo recargar", desc: "Saldo y recargas", url: "/creditos/", permiso: null, icono: I.moneda, tono: "rgb(var(--g-700))", suave: "rgb(var(--g-100))" }
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
    // Opción visual elegida en /ui/ (A por defecto). Solo en este navegador, mientras se decide.
    try { var tema = localStorage.getItem("fc-tema"); if (tema === "b") document.documentElement.dataset.tema = "b"; } catch (e) { /* sin almacenamiento */ }
    // Barra de arriba oscura (por defecto) o clara: se elige en /ui/
    try { if (localStorage.getItem("fc-barra") === "clara") document.documentElement.dataset.barra = "clara"; } catch (e) { /* sin almacenamiento */ }
    var ancla = document.getElementById("app-header");
    if (!ancla) return;

    var clave = ancla.dataset.modulo || "portada";
    var modulo = MODULOS[clave] || MODULOS.portada;

    // Un solo acento para toda la app (tokens en common.css): el módulo ya no cambia el color

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
        campana:  "M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 00-4-5.7V5a2 2 0 10-4 0v.3A6 6 0 006 11v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
        engrane:  "M10.3 4.3c.4-1.7 2.9-1.7 3.4 0a1.7 1.7 0 002.5 1.1c1.6-.9 3.3.8 2.4 2.4a1.7 1.7 0 001.1 2.5c1.7.4 1.7 2.9 0 3.4a1.7 1.7 0 00-1.1 2.5c.9 1.6-.8 3.3-2.4 2.4a1.7 1.7 0 00-2.5 1.1c-.4 1.7-2.9 1.7-3.4 0a1.7 1.7 0 00-2.5-1.1c-1.6.9-3.3-.8-2.4-2.4a1.7 1.7 0 00-1.1-2.5c-1.7-.4-1.7-2.9 0-3.4a1.7 1.7 0 001.1-2.5c-.9-1.6.8-3.3 2.4-2.4 1 .6 2.3.1 2.5-1.1zM15 12a3 3 0 11-6 0 3 3 0 016 0z",
        persona:  "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
        rejilla:  "M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z",
        salir:    "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
        cerrar:   "M6 18L18 6M6 6l12 12",
        pc:       "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
        alerta:   "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
        candado:  "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z M16 11V7a4 4 0 00-8 0v4",
        flecha:   "M9 18l6-6-6-6",
        casa:     "M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10",
        lapiz:    "M15.2 5.2l3.6 3.6M4 20h4L19.5 8.5a2.5 2.5 0 00-3.6-3.6L4 16.4V20z",
        basura:   "M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2",
        palomita: "M5 12.5l4.5 4.5L19 7.5",
        copiar:   "M8 8V5a1 1 0 011-1h10a1 1 0 011 1v10a1 1 0 01-1 1h-3M5 8h10a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V9a1 1 0 011-1z",
        mas:      "M12 5v14M5 12h14",
        subir:    "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M16 8l-4-4m0 0L8 8m4-4v12",
        carpeta:  "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z",
        documento: "M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9zM14 3v6h6",
        llave:    "M15 7a4 4 0 11-4.9 3.9L3 18v3h3v-2h2v-2h2l1.1-1.1A4 4 0 0115 7z",
        moneda2:  "M12 3v18M17 7H9.5a3 3 0 000 6h5a3 3 0 010 6H6",
        contraer: "M11 17l-5-5 5-5M18 17l-5-5 5-5",
        estrella: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
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
                  '<button type="button" class="fc-accion" id="fc-btn-actividad" aria-haspopup="dialog" aria-label="Actividad" title="Actividad">' +
                    ico(D.campana) +
                    '<span class="fc-contador" id="fc-act-contador" hidden>0</span>' +
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
    var aqui = CATALOGO.filter(function (m) { return m.url && location.pathname.indexOf(m.url) === 0; })
        .sort(function (a, b) { return b.url.length - a.url.length; })[0] || null;

    function menuModulosHTML() {
        return '<div class="fc-menu fc-modulos" id="fc-modulos" role="dialog" aria-label="Ir a un módulo" hidden>' +
            '<input type="search" class="fc-modulos__buscar" id="fc-modulos-buscar" placeholder="Buscar módulo… (Ctrl+K)" autocomplete="off">' +
            '<div class="fc-modulos__cuerpo" id="fc-modulos-cuerpo"></div></div>';
    }

    // Lo que está en laboratorio (soloAdmin) no aparece para nadie más
    function verModulo(m) { return !m.soloAdmin || !!(perfilActual && perfilActual.rol === "admin"); }
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
                return !m.pronto && verModulo(m) && (m.nombre + " " + m.desc + " " + m.grupo + " " + (m.alias || "")).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").indexOf(q) !== -1;
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
        GRUPOS.concat(["Tu cuenta"]).forEach(function (g) {
            var ms = CATALOGO.filter(function (m) { return m.grupo === g && !m.pronto && verModulo(m); });
            if (ms.length) html += '<div class="fc-modulos__grupo">' + esc(g) + '</div><div class="fc-modulos__rejilla">' + ms.map(itemModulo).join("") + "</div>";
        });
        cuerpo.innerHTML = html;
    }

    /* --------------------------------------------- riel: la barra lateral compartida
       Una sola pieza para la barra de módulos y el menú de Ajustes (si son iguales, son la misma).
       - Abierta con nombres la primera vez; si la persona la pliega, queda en íconos y se recuerda (para las dos).
       - Plegada: solo íconos, el nombre sale a un lado al pasar el cursor, sin ensanchar la barra. Una línea
         delgada separa los grupos. Nada cambia de lugar al plegar: solo el ancho (sin saltos).
       - Cada grupo se pliega con un clic en su título y se recuerda. En pantallas bajas solo queda abierto el
         grupo de la página actual.
       Uso: Fiscontable.riel(nav, { id, cabeza, buscar, grupos, alElegir }) → { pintar(grupos) } (ver /ui/). */
    var CLAVE_CHICO = "fc-lateral";
    function lateralChico() { try { return localStorage.getItem(CLAVE_CHICO) === "chico"; } catch (e) { return false; } }
    function ponerChico(chico) {
        try { localStorage.setItem(CLAVE_CHICO, chico ? "chico" : "grande"); } catch (e) { /* sin almacenamiento */ }
        document.documentElement.classList.toggle("fc-lateral-chico", chico);
        document.querySelectorAll(".ui-riel__plegar").forEach(function (b) {
            b.setAttribute("aria-label", chico ? "Mostrar nombres" : "Plegar a íconos");
            b.dataset.nombre = chico ? "Mostrar nombres" : "Plegar a íconos";
        });
    }
    D.buscar = "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4";
    D.abajo = "M6 9l6 6 6-6";

    function riel(nav, op) {
        var CLAVE_GRUPOS = "fc-riel-grupos:" + (op.id || "menu"), tocados = {};
        document.documentElement.classList.toggle("fc-lateral-chico", lateralChico());
        nav.classList.add("ui-riel");
        function guardados() { try { return JSON.parse(localStorage.getItem(CLAVE_GRUPOS) || "{}"); } catch (e) { return {}; } }
        function plegado(g, conActual) {
            if (g in tocados) return tocados[g];
            if (window.innerHeight < 760) return !conActual;             // pantalla baja: solo el grupo actual abierto
            return !!guardados()[g];
        }
        function icono(it) { return it.svg || ico(it.icono, 1.7); }
        function item(it) {
            var etiqueta = (it.num ? it.num + ". " : "") + it.nombre;
            var dentro = icono(it) + '<span class="ui-riel__texto">' + (it.num ? '<b class="ui-riel__num">' + it.num + "</b>" : "") + esc(it.nombre) + "</span>" +
                (it.pronto ? '<em class="ui-riel__pronto">Pronto</em>' : "") +
                (it.vedado ? '<i class="ui-riel__candado" title="No incluido en tu plan">' + ico(D.candado, 2) + "</i>" : "");
            var clase = "ui-riel__item" + (it.actual ? " ui-riel__item--actual" : "") + (it.vedado ? " ui-riel__item--vedado" : "") + (it.pronto ? " ui-riel__item--pronto" : "");
            var datos = ' data-nombre="' + esc(etiqueta + (it.pronto ? " (pronto)" : "")) + '"' + (it.id ? ' data-riel="' + esc(it.id) + '"' : "") + (it.plan ? ' data-plan="' + esc(it.plan) + '"' : "") +
                (it.actual ? ' aria-current="page"' : "");
            if (it.pronto) return '<span class="' + clase + '" aria-disabled="true"' + datos + ">" + dentro + "</span>";
            if (it.href) return '<a class="' + clase + '" href="' + esc(it.href) + '"' + datos + ">" + dentro + "</a>";
            return '<button type="button" class="' + clase + '"' + datos + ">" + dentro + "</button>";
        }
        function lista(grupos) {
            return grupos.map(function (g) {
                if (!g.titulo) return (g.separador ? '<div class="ui-riel__sep"></div>' : "") + g.items.map(item).join("");
                var conActual = g.items.some(function (x) { return x.actual; }), cerrado = plegado(g.titulo, conActual);
                // Plegada, el grupo es UN ícono (marcado si estás en uno de sus módulos) con su menú flotante
                return '<section class="ui-riel__grupo' + (cerrado ? " ui-riel__grupo--plegado" : "") + (conActual ? " ui-riel__grupo--actual" : "") + '" data-grupo="' + esc(g.titulo) + '">' +
                    '<button type="button" class="ui-riel__titulo" aria-expanded="' + !cerrado + '"><span>' + esc(g.titulo) + "</span>" + ico(D.abajo, 2) + "</button>" +
                    '<button type="button" class="ui-riel__grupo-ico' + (conActual ? " ui-riel__grupo-ico--actual" : "") + '" aria-haspopup="true" aria-expanded="false" aria-label="' + esc(g.titulo) + '">' +
                    (g.svg || ico(g.icono || D.rejilla, 1.7)) + "</button>" +
                    '<div class="ui-riel__items"><p class="ui-riel__flotante-titulo">' + esc(g.titulo) + "</p>" + g.items.map(item).join("") + "</div></section>";
            }).join("") || (op.vacio ? '<p class="ui-riel__vacio">' + esc(op.vacio) + "</p>" : "");
        }
        var b = op.buscar, chico = lateralChico();
        // Contraer siempre abajo (en los dos estados); buscar siempre arriba
        var plegar = '<button type="button" class="ui-riel__plegar" aria-label="' + (chico ? "Mostrar nombres" : "Plegar a íconos") + '" data-nombre="' + (chico ? "Mostrar nombres" : "Plegar a íconos") + '">' +
            ico(D.contraer, 1.8) + '<span class="ui-riel__texto">Contraer</span></button>';
        nav.innerHTML = (op.cabeza ? '<div class="ui-riel__cabeza"><div class="ui-riel__titulo-riel">' + op.cabeza + "</div></div>" : "") +
            (!b ? "" : b.campo
                ? '<label class="ui-riel__buscar" data-nombre="' + esc(b.texto) + '">' + ico(D.buscar, 2) + '<input type="search" autocomplete="off" placeholder="' + esc(b.texto) + '" aria-label="' + esc(b.texto) + '"></label>'
                : '<button type="button" class="ui-riel__buscar" data-nombre="' + esc(b.texto + (b.atajo ? " (" + b.atajo + ")" : "")) + '">' + ico(D.buscar, 2) +
                  '<span class="ui-riel__texto">' + esc(b.texto) + "</span>" + (b.atajo ? "<kbd>" + esc(b.atajo) + "</kbd>" : "") + "</button>") +
            '<div class="ui-riel__lista">' + lista(op.grupos || []) + "</div>" + plegar;
        var caja = nav.querySelector(".ui-riel__lista"), entrada = nav.querySelector(".ui-riel__buscar input");
        // Menú flotante del grupo (plegada): sale junto a su ícono al pasar el cursor, con Tab o con un toque
        function cerrarFlotantes(salvo) {
            nav.querySelectorAll(".ui-riel__grupo--flotando").forEach(function (sec) {
                if (sec === salvo) return;
                sec.classList.remove("ui-riel__grupo--flotando"); sec.querySelector(".ui-riel__grupo-ico").setAttribute("aria-expanded", "false");
            });
        }
        function abrirFlotante(sec) {
            if (!lateralChico() || !sec) return;
            var icoG = sec.querySelector(".ui-riel__grupo-ico"), r = icoG.getBoundingClientRect();
            sec.style.setProperty("--flot-top", Math.max(8, r.top - 6) + "px");
            nav.style.setProperty("--riel-x", nav.getBoundingClientRect().right + "px");
            cerrarFlotantes(sec);
            sec.classList.add("ui-riel__grupo--flotando"); icoG.setAttribute("aria-expanded", "true");
        }
        caja.addEventListener("mouseover", function (e) {
            var sec = e.target.closest(".ui-riel__grupo");
            if (sec && e.target.closest(".ui-riel__grupo-ico")) abrirFlotante(sec);
            else if (!sec) cerrarFlotantes(null);           // sobre Inicio, Clientes…: se cierra el menú abierto
        });
        caja.addEventListener("mouseleave", function () { cerrarFlotantes(null); });
        caja.addEventListener("focusin", function (e) { if (e.target.closest(".ui-riel__grupo-ico")) abrirFlotante(e.target.closest(".ui-riel__grupo")); });
        caja.addEventListener("focusout", function (e) { if (!caja.contains(e.relatedTarget)) cerrarFlotantes(null); });
        caja.addEventListener("keydown", function (e) { if (e.key === "Escape") cerrarFlotantes(null); });
        document.addEventListener("pointerdown", function (e) { if (!nav.contains(e.target)) cerrarFlotantes(null); });
        // El nombre que sale al pasar el cursor (plegada) se pone junto al borde derecho de esta barra, esté donde esté
        nav.addEventListener("mouseover", function () { nav.style.setProperty("--riel-x", nav.getBoundingClientRect().right + "px"); });
        nav.addEventListener("click", function (e) {
            if (e.target.closest(".ui-riel__plegar")) { cerrarFlotantes(null); ponerChico(!lateralChico()); return; }
            var gi = e.target.closest(".ui-riel__grupo-ico");
            if (gi) { var sg = gi.closest(".ui-riel__grupo"); if (sg.classList.contains("ui-riel__grupo--flotando") && e.pointerType !== "mouse") cerrarFlotantes(null); else abrirFlotante(sg); return; }
            var t = e.target.closest(".ui-riel__titulo");
            if (t) {
                var sec = t.parentElement, g = sec.dataset.grupo, cerrar = !sec.classList.contains("ui-riel__grupo--plegado");
                sec.classList.toggle("ui-riel__grupo--plegado", cerrar); t.setAttribute("aria-expanded", String(!cerrar));
                tocados[g] = cerrar;
                if (window.innerHeight >= 760) { var m = guardados(); if (cerrar) m[g] = true; else delete m[g]; try { localStorage.setItem(CLAVE_GRUPOS, JSON.stringify(m)); } catch (err) { /* sin almacenamiento */ } }
                return;
            }
            var bus = e.target.closest(".ui-riel__buscar");
            if (bus) {
                if (entrada) { if (lateralChico()) ponerChico(false); entrada.focus(); }
                else if (b && b.alAbrir) b.alAbrir(bus);
                return;
            }
            var it = e.target.closest("button.ui-riel__item[data-riel]");
            if (it && op.alElegir) op.alElegir(it.dataset.riel, e);
        });
        if (entrada && b.alEscribir) entrada.addEventListener("input", function () { b.alEscribir(entrada.value); });
        return {
            nav: nav, entrada: entrada,
            pintar: function (grupos) { caja.innerHTML = lista(grupos); }
        };
    }

    /* --------------------------------------------- barra lateral de módulos (computadora; en el teléfono, «Módulos») */
    var conLateral = !document.documentElement.classList.contains("fc-incrustado") && clave !== "configuracion";
    // Ajustes trae su propia barra (la misma pieza): misma estructura de página desde el primer pintado
    if (clave === "configuracion" && !document.documentElement.classList.contains("fc-incrustado")) document.documentElement.classList.add("fc-con-riel");
    var rielModulos = null;
    // Íconos de grupo (barra plegada): distintos entre sí y de los de sus módulos
    var ICONO_GRUPO = {
        "Comprobantes": "M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9zM14 3v6h6M10 12l-2 2.5 2 2.5M14 12l2 2.5-2 2.5",
        "Cierre del mes": "M8 3v3m8-3v3M4 9h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zM9 14.5l2 2 4-4",
        "Cumplimiento": "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6zM9 12l2 2 4-4",
        "Facturación": "M7 3h10a1 1 0 011 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 011-1zM9 8h6M9 12h6M9 16h3",
        "Documentos": "M4 6h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1zM9 13a2 2 0 100-4 2 2 0 000 4zM6 16a3 3 0 016 0M14 10h4M14 13h3"
    };
    function gruposModulos() {
        var inicio = { titulo: null, items: [{ nombre: "Inicio", icono: D.casa, href: "/", actual: clave === "portada" }] };
        return [inicio].concat(GRUPOS.map(function (g) {
            var ms = CATALOGO.filter(function (m) { return m.grupo === g && verModulo(m); });
            if (!ms.length) return null;
            var items = ms.map(function (m) {
                var ok = m.pronto || permitido(m);
                return { nombre: m.nombre, num: m.num, icono: m.icono, href: m.url, pronto: m.pronto, actual: aqui && m.clave === aqui.clave, vedado: !ok, plan: ok ? null : m.clave };
            });
            // Un grupo de un solo módulo no lleva título (sería «Clientes › Clientes»): solo la línea que separa
            return ms.length > 1 ? { titulo: g, icono: ICONO_GRUPO[g], items: items } : { titulo: null, separador: true, items: items };
        }).filter(Boolean));
    }
    function pintarLateral() {
        if (!conLateral) return;
        document.documentElement.classList.add("fc-con-lateral");
        var nav = document.getElementById("fc-lateral");
        if (!nav) {
            nav = document.createElement("nav");
            nav.id = "fc-lateral"; nav.className = "fc-lateral"; nav.setAttribute("aria-label", "Módulos");
            document.body.appendChild(nav);
            rielModulos = riel(nav, { id: "modulos", grupos: gruposModulos(),
                buscar: { texto: "Buscar…", atajo: "Ctrl K", alAbrir: function (boton) { abrirModulos(boton); } } });
        } else rielModulos.pintar(gruposModulos());
    }

    function abrirModulos(origen) {
        var panel = document.getElementById("fc-modulos"), boton = origen || document.getElementById("fc-btn-modulos");
        cerrarEmpresas();
        document.getElementById("fc-menu").hidden = true;
        var buscar = document.getElementById("fc-modulos-buscar");
        buscar.value = "";
        pintarModulos();
        panel.hidden = false;
        boton.setAttribute("aria-expanded", "true");
        var interior = panel.parentElement.getBoundingClientRect(), r = boton.getBoundingClientRect();
        panel.style.left = Math.max(12, (r.width ? r.left : 12) - interior.left) + "px";
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
                e.preventDefault();
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
            if (!panel.hidden && !panel.contains(e.target) && !boton.contains(e.target) && !(e.target.closest && e.target.closest(".ui-riel__buscar"))) cerrarModulos();
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

    /* Selector único de empresa (G-02): Favoritos (se guardan en el servidor), Recientes (este navegador) y Todas.
       Busca por nombre o RFC parcial; con flechas y Enter se elige sin ratón. */
    function empresasRecientes() { try { return JSON.parse(localStorage.getItem("fc-empresas-recientes") || "[]"); } catch (e) { return []; } }
    function anotarEmpresaReciente(rfc) {
        if (!rfc) return;
        try { localStorage.setItem("fc-empresas-recientes", JSON.stringify([rfc].concat(empresasRecientes().filter(function (x) { return x !== rfc; })).slice(0, 5))); }
        catch (e) { /* sin almacenamiento */ }
    }
    function filaEmpresa(c, activa) {
        var chips = (c.efirma_guardada ? '<i class="fc-empresas__chip fc-empresas__chip--ok" title="e.firma guardada">e.firma</i>' : '<i class="fc-empresas__chip" title="Sin e.firma guardada">sin e.firma</i>') +
            (c.ciec_guardada ? '<i class="fc-empresas__chip fc-empresas__chip--ok" title="Contraseña del SAT guardada">CIEC</i>' : "");
        return '<div class="fc-empresas__fila"><button type="button" class="fc-empresas__item' + (c.rfc === activa ? " fc-empresas__item--activa" : "") + '" data-rfc="' + esc(c.rfc) + '" role="menuitem">' +
            '<span class="fc-empresas__inicial">' + esc((c.alias || c.rfc).charAt(0).toUpperCase()) + "</span>" +
            '<span class="fc-empresas__texto"><strong>' + esc(c.alias) + "</strong><small>" + esc(c.rfc) + " " + chips + "</small></span>" +
            (c.rfc === activa ? '<span class="fc-empresas__check">' + ico(D.palomita, 2.2) + "</span>" : "") + "</button>" +
            '<button type="button" class="fc-empresas__estrella' + (c.favorito ? " fc-empresas__estrella--si" : "") + '" data-favorito="' + esc(c.rfc) + '" aria-pressed="' + !!c.favorito + '" title="' +
            (c.favorito ? "Quitar de favoritos" : "Agregar a favoritos") + '" aria-label="' + (c.favorito ? "Quitar de favoritos" : "Agregar a favoritos") + '">' + ico(D.estrella, 1.8) + "</button>" +
            '<a class="fc-empresas__editar" href="/clientes/?editar=' + encodeURIComponent(c.rfc) + '" title="Editar ' + esc(c.alias || c.rfc) +
            ' (e.firma, obligaciones…)" aria-label="Editar ' + esc(c.alias || c.rfc) + '">' + ico(D.lapiz, 1.8) + "</a></div>";
    }
    function pintarListaEmpresas() {
        var q = (document.getElementById("fc-empresas-buscar").value || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        var activa = perfilActual && perfilActual.empresa_activa ? perfilActual.empresa_activa.rfc : null;
        var caja = document.getElementById("fc-empresas-lista");
        if (clientesCache === null) { caja.innerHTML = '<p class="fc-empresas__nada">Cargando tu directorio…</p>'; return; }
        if (!clientesCache.length) {
            caja.innerHTML = '<p class="fc-empresas__nada">Todavía no tienes empresas registradas. Regístralas en <a href="/clientes/">Clientes</a>.</p>';
            return;
        }
        var fila = function (c) { return filaEmpresa(c, activa); };
        if (q) {
            var hallados = clientesCache.filter(function (c) {
                return (c.alias + " " + c.rfc + " " + (c.razon_social || "")).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").indexOf(q) !== -1;
            });
            caja.innerHTML = hallados.length ? hallados.map(fila).join("") : '<p class="fc-empresas__nada">Ninguna coincide con la búsqueda.</p>';
            return;
        }
        var porRfc = {}; clientesCache.forEach(function (c) { porRfc[c.rfc] = c; });
        var fav = clientesCache.filter(function (c) { return c.favorito; });
        var rec = empresasRecientes().map(function (r) { return porRfc[r]; }).filter(function (c) { return c && !c.favorito; }).slice(0, 4);
        var seccion = function (titulo, lista) { return lista.length ? '<p class="fc-empresas__grupo">' + titulo + "</p>" + lista.map(fila).join("") : ""; };
        caja.innerHTML = seccion("Favoritas", fav) + seccion("Recientes", rec) +
            seccion(fav.length || rec.length ? "Todas" : "", clientesCache);
    }
    async function marcarFavorita(rfc, boton) {
        var c = (clientesCache || []).filter(function (x) { return x.rfc === rfc; })[0];
        if (!c) return;
        c.favorito = !c.favorito;
        pintarListaEmpresas();
        try {
            var r = await fetch(API + "/api/clientes/" + encodeURIComponent(rfc) + "/favorito", { method: "PUT", credentials: "include",
                headers: { "Content-Type": "application/json" }, body: JSON.stringify({ favorito: c.favorito }) });
            if (!r.ok) throw new Error();
            window.dispatchEvent(new CustomEvent("fiscontable:favoritos"));
        } catch (e) { c.favorito = !c.favorito; pintarListaEmpresas(); brindis("No se pudo guardar el favorito."); }
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
            if (nuestra) p.then(function (r) { if (r && r.status === 423 && window.Fiscontable.bloquearPantalla) window.Fiscontable.bloquearPantalla(true); }, function () {});
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
        anotarEmpresaReciente(rfc);
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
            var est = e.target.closest("[data-favorito]");
            if (est) { marcarFavorita(est.dataset.favorito, est); return; }
            var item = e.target.closest("[data-rfc]");
            if (item) elegirEmpresa(item.dataset.rfc);
        });
        document.getElementById("fc-empresas-buscar").addEventListener("input", pintarListaEmpresas);
        document.getElementById("fc-empresas-buscar").addEventListener("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); var primero = panel.querySelector("[data-rfc]"); if (primero) elegirEmpresa(primero.dataset.rfc); }
            else if (e.key === "ArrowDown") { var p1 = panel.querySelector("[data-rfc]"); if (p1) { e.preventDefault(); p1.focus(); } }
        });
        // Flechas entre empresas (sin ratón)
        panel.addEventListener("keydown", function (e) {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            var items = [].slice.call(panel.querySelectorAll("[data-rfc]")), i = items.indexOf(document.activeElement);
            if (i === -1) return;
            e.preventDefault();
            var sig = items[i + (e.key === "ArrowDown" ? 1 : -1)];
            if (sig) sig.focus(); else if (e.key === "ArrowUp") document.getElementById("fc-empresas-buscar").focus();
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
        envoltorio.innerHTML +=
            '<div class="fc-velo" id="fc-act-velo" hidden></div>' +
            '<aside class="fc-panel" id="fc-act-panel" role="dialog" aria-modal="true" aria-label="Actividad" hidden>' +
              '<div class="fc-panel__cabeza">' +
                '<div><div class="fc-panel__titulo">Actividad</div>' +
                '<div class="fc-panel__sub">Lo que pasó mientras no estabas</div></div>' +
                '<button type="button" class="fc-panel__cerrar" id="fc-act-cerrar" aria-label="Cerrar">' + ico(D.cerrar) + "</button>" +
              "</div>" +
              '<div class="fc-panel__cuerpo" id="fc-act-cuerpo"></div>' +
              '<div class="fc-panel__pie fc-act-pie">' +
                '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" id="fc-act-leidas">Marcar todo como leído</button>' +
                '<a class="ui-btn ui-btn--terciario ui-btn--32" href="/configuracion/?seccion=avisos">Qué me llega por correo</a>' +
              "</div>" +
            "</aside>";
        while (envoltorio.firstChild) document.body.appendChild(envoltorio.firstChild);
    }

    /* --------------------------------------------- Centro de actividad (G-13)
       Avisos de lo que pasó sin que estuvieras mirando: programaciones que terminaron, CFDI que cambiaron de
       estado, proveedores en listas del SAT, mensajes nuevos del buzón. Mis descargas queda solo para archivos. */
    var actividad = { datos: null, abierta: false };
    var ICONO_AVISO = { programacion: "calendario", validacion: "alerta", listas: "alerta", buzon: "documento", descarga: "descarga", aviso: "campana" };

    async function sondearActividad() {
        if ((bloqueo && bloqueo.activa) || document.hidden) return;
        try {
            var r = await fetch(API + "/api/actividad?limite=30", { credentials: "include" });
            if (!r.ok) return;
            var d = await r.json(), antes = actividad.datos ? actividad.datos.sin_leer : null;
            actividad.datos = d;
            var c = document.getElementById("fc-act-contador");
            if (c) { c.textContent = d.sin_leer > 99 ? "99+" : d.sin_leer; c.hidden = !d.sin_leer; }
            if (antes !== null && d.sin_leer > antes && d.avisos[0]) avisarNavegador(d.avisos[0].titulo, d.avisos[0].detalle || "");
            if (actividad.abierta) pintarActividad();
        } catch (e) { /* sin red: se vuelve a intentar */ }
    }
    function hace(iso) {
        var f = new Date(String(iso).length <= 19 ? iso + "Z" : iso), m = Math.round((Date.now() - f) / 60000);
        if (m < 1) return "ahora";
        if (m < 60) return "hace " + m + " min";
        if (m < 1440) return "hace " + Math.round(m / 60) + " h";
        return f.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
    }
    function pintarActividad() {
        var cuerpo = document.getElementById("fc-act-cuerpo"), d = actividad.datos;
        if (!d) { cuerpo.innerHTML = '<span class="ui-skel" style="width:70%"></span>'; return; }
        var h = [];
        if (d.en_curso && d.en_curso.length) {
            h.push('<p class="fc-act-grupo">En curso</p>');
            d.en_curso.forEach(function (p) {
                h.push('<div class="fc-act-item fc-act-item--curso">' + ico(D.reloj || D.calendario, 1.8) + "<div><b>" + esc(p.titulo) + "</b><span>" + esc(p.progreso) + "</span></div></div>");
            });
        }
        h.push('<p class="fc-act-grupo">Avisos</p>');
        if (!d.avisos.length) h.push('<div class="ui-vacio">' + ico(D.campana, 1.6) + "<b>Sin avisos</b><span>Aquí verás lo que terminó o cambió.</span></div>");
        d.avisos.forEach(function (a) {
            var dentro = ico(D[ICONO_AVISO[a.tipo]] || D.campana, 1.8) + "<div><b>" + esc(a.titulo) + "</b>" +
                (a.detalle ? "<span>" + esc(a.detalle).replace(/\n/g, "<br>") + "</span>" : "") + "<small>" + esc(hace(a.creada)) + "</small></div>";
            var clase = "fc-act-item" + (a.leida ? "" : " fc-act-item--nuevo");
            h.push(a.enlace && a.enlace.charAt(0) === "/" ? '<a class="' + clase + '" href="' + esc(a.enlace) + '">' + dentro + "</a>" : '<div class="' + clase + '">' + dentro + "</div>");
        });
        if ("Notification" in window && Notification.permission === "default")
            h.push('<div class="fc-act-navegador"><span>¿Avisos del navegador cuando termine algo?</span><button type="button" class="ui-btn ui-btn--secundario ui-btn--28" id="fc-act-permiso">Activar</button></div>');
        cuerpo.innerHTML = h.join("");
        var permiso = document.getElementById("fc-act-permiso");
        if (permiso) permiso.addEventListener("click", function () { Notification.requestPermission().then(pintarActividad); });
    }
    function abrirActividad() {
        var velo = document.getElementById("fc-act-velo"), panel = document.getElementById("fc-act-panel");
        velo.hidden = false; panel.hidden = false;
        requestAnimationFrame(function () { velo.classList.add("abierto"); panel.classList.add("abierto"); });
        document.body.classList.add("fc-sin-scroll");
        actividad.abierta = true;
        pintarActividad();
        sondearActividad();
        document.getElementById("fc-act-cerrar").focus();
    }
    function cerrarActividad() {
        var velo = document.getElementById("fc-act-velo"), panel = document.getElementById("fc-act-panel");
        velo.classList.remove("abierto"); panel.classList.remove("abierto");
        document.body.classList.remove("fc-sin-scroll");
        actividad.abierta = false;
        setTimeout(function () { if (!actividad.abierta) { velo.hidden = true; panel.hidden = true; } }, 260);
        var b = document.getElementById("fc-btn-actividad"); if (b) b.focus();
    }
    async function marcarActividadLeida() {
        try {
            await fetch(API + "/api/actividad/leidas", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
        } catch (e) { /* nada */ }
        sondearActividad();
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
        var total = nuevos;              // solo lo nuevo sin ver (lo que sigue corriendo no suma)

        var contador = document.getElementById("fc-contador");
        if (contador) {
            contador.textContent = total;
            contador.hidden = total === 0;
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
        if (bloqueo && bloqueo.activa) { programar(); return; }      // con la pantalla bloqueada no se pregunta nada
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
        ponerFoto(p.foto);
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
        pintarLateral();
        prepararBloqueo(p);
        vigilarChipEmpresa();
        pintarVerComo(p);
        cargarTextos();
        esAdminActual = p.rol === "admin" && !p.viendo_como;
        document.dispatchEvent(new CustomEvent("fc:perfil", { detail: p }));
    }


    /* ------------------------------------------------- exportar a Excel (G-12)
       Fiscontable.excel("Cancelaciones_RFC.xlsx", [{ hoja: "Historial", columnas: [{ titulo, clave, tipo: "fecha"|"moneda"|"texto" }], filas }])
       Encabezados en la primera fila, fechas e importes con su tipo (Excel los suma y ordena bien), anchos razonables. */
    var sheetjs = null;
    function cargarSheetJS() {
        if (window.XLSX) return Promise.resolve(window.XLSX);
        if (!sheetjs) sheetjs = new Promise(function (ok, mal) {
            var sc = document.createElement("script");
            sc.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
            sc.onload = function () { ok(window.XLSX); }; sc.onerror = function () { sheetjs = null; mal(new Error("No se pudo preparar el Excel. Revisa tu conexión.")); };
            document.head.appendChild(sc);
        });
        return sheetjs;
    }
    async function excel(nombre, hojas) {
        var X = await cargarSheetJS(), libro = X.utils.book_new();
        hojas.forEach(function (h) {
            var datos = [h.columnas.map(function (c) { return c.titulo; })].concat(h.filas.map(function (f) {
                return h.columnas.map(function (c) {
                    var v = f[c.clave];
                    if (v === null || v === undefined || v === "") return "";
                    if (c.tipo === "moneda") return Number(v) || 0;
                    if (c.tipo === "fecha") { var d = new Date(String(v).length <= 10 ? v + "T12:00:00" : v); return isNaN(d) ? String(v) : d; }
                    return String(v);
                });
            }));
            var ws = X.utils.aoa_to_sheet(datos, { cellDates: true });
            ws["!cols"] = h.columnas.map(function (c) { return { wch: c.ancho || (c.tipo === "moneda" ? 14 : c.tipo === "fecha" ? 18 : 24) }; });
            h.columnas.forEach(function (c, j) {
                if (c.tipo !== "moneda" && c.tipo !== "fecha") return;
                for (var i = 1; i < datos.length; i++) {
                    var cel = ws[X.utils.encode_cell({ r: i, c: j })];
                    if (cel) cel.z = c.tipo === "moneda" ? "#,##0.00" : "dd/mm/yyyy hh:mm";
                }
            });
            X.utils.book_append_sheet(libro, ws, (h.hoja || "Hoja1").slice(0, 31));
        });
        X.writeFile(libro, nombre);
    }

    /* ------------------------------------------------- foto de perfil (M-20): se pide con la sesión y se muestra en el avatar */
    var fotoActual = null, esAdminActual = false;
    async function ponerFoto(version) {
        var av = document.getElementById("fc-avatar");
        if (!av || version === fotoActual) return;
        fotoActual = version;
        if (!version) return;
        try {
            var r = await fetch(API + "/api/mi-perfil/foto?v=" + encodeURIComponent(version), { credentials: "include" });
            if (!r.ok) return;
            var url = URL.createObjectURL(await r.blob());
            av.innerHTML = '<img src="' + url + '" alt="">';
            av.classList.add("fc-avatar--foto");
        } catch (e) { /* se queda la inicial */ }
    }

    /* ------------------------------------------------- textos editables de la web (C-05)
       El admin cambia las guías de cada módulo (clave "ayuda.<módulo>", una línea por paso) y cualquier elemento con
       data-texto="clave". Se piden una vez por sesión del navegador (5 min) y se aplican encima de los de fábrica. */
    var textosWeb = {};
    async function cargarTextos() {
        try {
            var guardado = JSON.parse(sessionStorage.getItem("fc-textos") || "null");
            if (guardado && Date.now() - guardado.t < 300000) textosWeb = guardado.d;
            else {
                var r = await fetch(API + "/api/textos", { credentials: "include" });
                if (r.ok) { textosWeb = await r.json(); sessionStorage.setItem("fc-textos", JSON.stringify({ t: Date.now(), d: textosWeb })); }
            }
        } catch (e) { textosWeb = {}; }
        Object.keys(textosWeb).forEach(function (k) {
            if (k.indexOf("ayuda.") === 0) AYUDA[k.slice(6)] = textosWeb[k].split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
        });
        document.querySelectorAll("[data-texto]").forEach(function (el) { if (textosWeb[el.dataset.texto]) el.textContent = textosWeb[el.dataset.texto]; });
    }
    async function editarTexto(claveTexto, actual, alGuardar) {
        var nuevo = prompt("Nuevo texto (una línea por paso). Déjalo vacío para regresar al de fábrica:", actual);
        if (nuevo === null) return;
        try {
            var r = await fetch(API + "/api/admin/textos/" + encodeURIComponent(claveTexto), { method: "PUT", credentials: "include",
                headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto: nuevo.replace(/ · /g, "\n") }) });
            if (!r.ok) throw new Error(await window.Fiscontable.leerError(r));
            sessionStorage.removeItem("fc-textos");
            brindis("Texto guardado. Se ve al recargar la página.");
            if (alGuardar) alGuardar();
        } catch (e) { brindis(esc(e.message)); }
    }

    /* ------------------------------------------------- «Ver como» (N-04): letrero fijo mientras el admin ve como otro usuario */
    function pintarVerComo(p) {
        var vc = p && p.viendo_como, caja = document.getElementById("fc-ver-como");
        document.documentElement.classList.toggle("fc-viendo-como", !!vc);
        if (!vc) { if (caja) caja.remove(); return; }
        if (!caja) {
            caja = document.createElement("div");
            caja.id = "fc-ver-como"; caja.className = "fc-ver-como"; caja.setAttribute("role", "status");
            document.body.appendChild(caja);
        }
        var hasta = new Date(vc.hasta + (String(vc.hasta).length <= 19 ? "Z" : "")).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
        caja.innerHTML = ico(D.persona, 2) + "<span>Estás viendo como <b>" + esc(vc.correo) + "</b> · solo lectura · hasta las " + esc(hasta) + "</span>" +
            '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" id="fc-ver-como-salir">Salir</button>';
        document.getElementById("fc-ver-como-salir").addEventListener("click", async function () {
            this.disabled = true;
            try { await fetch(API + "/api/admin/ver-como/salir", { method: "POST", credentials: "include" }); } catch (e) { /* nada */ }
            location.href = "/admin/";
        });
    }

    /* ------------------------------------------------- bloque de estado de un documento (G-08)
       Fiscontable.bloqueEstado({ icono: "documento", tono: "ok"|"aviso"|"error"|"", titulo, detalle,
                                  acciones: [{ id, texto, primario }] })  → HTML. Reemplaza los anuncios verdes sueltos. */
    function bloqueEstado(o) {
        return '<div class="ui-bloque' + (o.tono ? " ui-bloque--" + o.tono : "") + '">' +
            '<span class="ui-bloque__icono">' + ico(D[o.icono] || D.documento, 1.7) + "</span>" +
            '<div class="ui-bloque__texto"><b>' + esc(o.titulo) + "</b>" + (o.detalle ? "<span>" + esc(o.detalle) + "</span>" : "") + "</div>" +
            '<div class="ui-bloque__acciones">' + (o.acciones || []).map(function (a) {
                return '<button type="button" class="ui-btn ' + (a.primario ? "ui-btn--primario" : "ui-btn--secundario") + ' ui-btn--32" id="' + esc(a.id) + '">' + esc(a.texto) + "</button>";
            }).join("") + "</div></div>";
    }

    /* ------------------------------------------------- enviar por correo (G-14)
       Fiscontable.enviarCorreo({ titulo: "Enviar constancia", ruta: "/api/documentos/enviar", datos: {rfc, tipo}, para: "" })
       Pide a quién y un mensaje opcional; el servidor manda el archivo por el canal de la cuenta. */
    var dlgCorreo = null;
    function enviarCorreo(o) {
        if (!dlgCorreo) {
            dlgCorreo = document.createElement("dialog");
            dlgCorreo.className = "ui-modal";
            dlgCorreo.innerHTML = '<form method="dialog" class="ui-modal__cuerpo"><h3></h3>' +
                '<label class="fc-correo-campo">Para<input type="text" class="ui-input" name="para" placeholder="cliente@empresa.com, otro@empresa.com" required autocomplete="email"></label>' +
                '<label class="fc-correo-campo">Mensaje (opcional)<textarea class="ui-input" name="mensaje" rows="3" maxlength="1000"></textarea></label>' +
                '<p class="fc-correo-error" hidden></p></form><div class="ui-modal__pie">' +
                '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-correo="no">Cancelar</button>' +
                '<button type="button" class="ui-btn ui-btn--primario ui-btn--32" data-correo="si">Enviar</button></div>';
            document.body.appendChild(dlgCorreo);
            dlgCorreo.addEventListener("click", async function (e) {
                var b = e.target.closest("[data-correo]"); if (!b) return;
                if (b.dataset.correo === "no") { dlgCorreo.close(); return; }
                var f = dlgCorreo.querySelector("form"), err = dlgCorreo.querySelector(".fc-correo-error"), op = dlgCorreo._op;
                if (!f.para.value.trim()) { f.para.focus(); return; }
                b.disabled = true; err.hidden = true;
                try {
                    var r = await fetch(API + op.ruta, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(Object.assign({}, op.datos, { para: f.para.value.trim(), mensaje: f.mensaje.value })) });
                    if (!r.ok) throw new Error(await window.Fiscontable.leerError(r));
                    dlgCorreo.close();
                    brindis("Enviado a " + esc(f.para.value.trim()) + ".");
                } catch (x) { err.textContent = x.message; err.hidden = false; }
                finally { b.disabled = false; }
            });
        }
        dlgCorreo._op = o;
        dlgCorreo.querySelector("h3").textContent = o.titulo || "Enviar por correo";
        var f = dlgCorreo.querySelector("form");
        f.para.value = o.para || ""; f.mensaje.value = "";
        dlgCorreo.querySelector(".fc-correo-error").hidden = true;
        dlgCorreo.showModal();
        f.para.focus();
    }

    /* ------------------------------------------------- detalle de un CFDI en panel lateral (G-07)
       Fiscontable.verCfdi(rfc, uuid, lista) abre el detalle de siempre (/herramientas/xml/detalle/) en un panel a la
       derecha, sin salir de la tabla. lista = uuids en el orden en que se ven: ← y → (o los botones) pasan a la
       anterior o la siguiente. Cualquier enlace a ese detalle en la página abre el panel (Ctrl/Cmd+clic, en pestaña). */
    var cfdiPanel = null;
    function verCfdi(rfc, uuid, lista) {
        if (!rfc || !uuid) return;
        if (!cfdiPanel) {
            var d = document.createElement("aside");
            d.className = "fc-cfdi"; d.setAttribute("aria-label", "Detalle de la factura"); d.hidden = true;
            d.innerHTML = '<div class="fc-cfdi__cabeza"><b>Factura</b><span class="fc-cfdi__pos"></span>' +
                '<button type="button" class="ui-icono-btn" data-cfdi="ant" aria-label="Anterior (←)" title="Anterior (←)">' + ico(D.flecha, 2).replace("<svg ", '<svg style="transform:rotate(180deg)" ') + "</button>" +
                '<button type="button" class="ui-icono-btn" data-cfdi="sig" aria-label="Siguiente (→)" title="Siguiente (→)">' + ico(D.flecha, 2) + "</button>" +
                '<a class="ui-btn ui-btn--terciario ui-btn--28" data-cfdi="pestana" target="_blank" rel="noopener">Abrir en pestaña</a>' +
                '<button type="button" class="ui-icono-btn" data-cfdi="cerrar" aria-label="Cerrar (Esc)" title="Cerrar (Esc)">' + ico(D.cerrar, 2) + "</button></div>" +
                '<iframe class="fc-cfdi__marco" title="Detalle de la factura"></iframe>';
            document.body.appendChild(d);
            cfdiPanel = { el: d, marco: d.querySelector("iframe"), lista: [], i: -1, rfc: "" };
            d.addEventListener("click", function (e) {
                var b = e.target.closest("[data-cfdi]"); if (!b) return;
                if (b.dataset.cfdi === "cerrar") cerrarCfdi();
                else if (b.dataset.cfdi === "ant") moverCfdi(-1);
                else if (b.dataset.cfdi === "sig") moverCfdi(1);
            });
            var teclas = function (e) {
                if (d.hidden || e.target.closest && e.target.closest("input, textarea, select")) return;
                if (e.key === "Escape") cerrarCfdi(); else if (e.key === "ArrowLeft") moverCfdi(-1); else if (e.key === "ArrowRight") moverCfdi(1);
            };
            document.addEventListener("keydown", teclas);
            cfdiPanel.marco.addEventListener("load", function () { try { cfdiPanel.marco.contentWindow.document.addEventListener("keydown", teclas); } catch (err) { /* otro origen */ } });
        }
        var P = cfdiPanel;
        P.rfc = rfc; P.lista = (lista && lista.length) ? lista : [uuid]; P.i = Math.max(0, P.lista.indexOf(uuid));
        if (P.lista.indexOf(uuid) === -1) { P.lista = [uuid]; P.i = 0; }
        pintarCfdi();
        P.el.hidden = false;
        document.documentElement.classList.add("fc-con-cfdi");
    }
    function pintarCfdi() {
        var P = cfdiPanel, uuid = P.lista[P.i], url = "/herramientas/xml/detalle/?rfc=" + encodeURIComponent(P.rfc) + "&uuid=" + encodeURIComponent(uuid);
        P.marco.src = url + "&incrustado=1";
        P.el.querySelector('[data-cfdi="pestana"]').href = url;
        P.el.querySelector(".fc-cfdi__pos").textContent = P.lista.length > 1 ? (P.i + 1) + " de " + P.lista.length : "";
        P.el.querySelector('[data-cfdi="ant"]').disabled = P.i <= 0;
        P.el.querySelector('[data-cfdi="sig"]').disabled = P.i >= P.lista.length - 1;
    }
    function moverCfdi(paso) {
        var P = cfdiPanel; if (!P || P.el.hidden) return;
        var n = P.i + paso; if (n < 0 || n >= P.lista.length) return;
        P.i = n; pintarCfdi();
    }
    function cerrarCfdi() {
        if (!cfdiPanel || cfdiPanel.el.hidden) return;
        cfdiPanel.el.hidden = true; cfdiPanel.marco.src = "about:blank";
        document.documentElement.classList.remove("fc-con-cfdi");
    }
    // Enlaces al detalle en cualquier módulo: panel lateral (con modificador o clic medio, pestaña como siempre)
    document.addEventListener("click", function (e) {
        if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        var a = e.target.closest && e.target.closest('a[href*="/herramientas/xml/detalle/"]');
        if (!a || a.closest(".fc-cfdi") || document.documentElement.classList.contains("fc-incrustado")) return;
        var u = new URL(a.href, location.href), rfc = u.searchParams.get("rfc"), uuid = u.searchParams.get("uuid");
        if (!rfc || !uuid) return;
        e.preventDefault();
        var lista = [].slice.call(document.querySelectorAll('a[href*="/herramientas/xml/detalle/"]')).map(function (x) {
            try { return new URL(x.href, location.href).searchParams.get("uuid"); } catch (err) { return null; }
        }).filter(function (x, i, arr) { return x && arr.indexOf(x) === i; });
        verCfdi(rfc, uuid, lista);
    });

    /* ------------------------------------------------- selector de empresa repetido en los módulos (G-02)
       Varios módulos traen su recuadro «Empresa · RFC». Si muestra la misma empresa que la barra, se vuelve un enlace
       discreto «Otro contribuyente ▾» (el menú del módulo sigue igual); si el módulo trabaja con otra, se queda visible. */
    var chipVigilado = false, chipCambiando = false;
    function revisarChipEmpresa() {
        var et = document.getElementById("empresa-etiqueta"), ti = document.getElementById("empresa-titulo");
        if (!et || !ti || chipCambiando) return;
        var boton = et.closest(".ctx-campo"); if (!boton) return;
        var activa = perfilActual && perfilActual.empresa_activa && perfilActual.empresa_activa.rfc;
        var m = /Empresa · ([A-ZÑ&0-9]{12,13})/.exec(et.textContent || "");
        if (!m) return;                                           // vacío o ya convertido por el propio módulo
        chipCambiando = true;
        var mismo = !!activa && m[1] === activa;
        boton.classList.toggle("ctx-campo--discreto", mismo);
        if (mismo) { et.textContent = ""; ti.textContent = "Otro contribuyente"; }
        chipCambiando = false;
    }
    function vigilarChipEmpresa() {
        revisarChipEmpresa();
        if (chipVigilado) return;
        var et = document.getElementById("empresa-etiqueta");
        if (!et) return;
        chipVigilado = true;
        new MutationObserver(function () { setTimeout(revisarChipEmpresa, 0); }).observe(et, { childList: true, characterData: true, subtree: true });
        window.addEventListener("fiscontable:empresa", function () { setTimeout(revisarChipEmpresa, 50); });
    }

    /* ------------------------------------------------- acciones del módulo (G-06)
       La columna de acciones de la derecha (.mod-acciones: SAT, Reportes, Compartir, Con este periodo) se vuelve una
       barra de una línea arriba de la tabla: un grupo con una sola acción es un botón; con varias, un menú «Grupo ▾»;
       «Con este periodo» es «Ir a ▾». Es el MISMO elemento (los módulos escuchan sus clics ahí) y los mismos botones
       (con sus ids y eventos), así que no se pierde ninguna acción. La tabla queda con todo el ancho. */
    function accionesEnBarra() {
        document.querySelectorAll("aside.mod-acciones:not(.mod-acciones--barra)").forEach(function (lado) {
            var grupos = [], nota = null, actual = null, otros = [];
            [].slice.call(lado.children).forEach(function (el) {
                if (el.classList.contains("mod-acciones__grupo")) { actual = { titulo: el.textContent.trim(), items: [] }; grupos.push(actual); el.remove(); }
                else if (el.classList.contains("mod-acciones__nota")) nota = el;
                else if (el.classList.contains("mod-accion")) { if (!actual) { actual = { titulo: "", items: [] }; grupos.push(actual); } actual.items.push(el); }
                else otros.push(el);             // campos de archivo ocultos y demás: se conservan tal cual
            });
            lado.classList.add("mod-acciones--barra");
            lado.innerHTML = "";
            otros.forEach(function (el) { lado.appendChild(el); });
            if (nota) { nota.classList.add("mod-acciones__nota--barra"); lado.appendChild(nota); }
            var derecha = document.createElement("div"); derecha.className = "mod-acciones__der"; lado.appendChild(derecha);
            var menus = [];
            grupos.forEach(function (g) {
                var ir = /con este periodo/i.test(g.titulo), primarias = g.items.filter(function (b) { return b.classList.contains("mod-accion--primaria"); });
                primarias.forEach(function (b) { b.classList.add("ui-btn", "ui-btn--primario", "ui-btn--28"); derecha.appendChild(b); });
                var resto = g.items.filter(function (b) { return primarias.indexOf(b) === -1; });
                if (!resto.length) return;
                if (resto.length === 1 && !ir) { resto[0].classList.add("ui-btn", "ui-btn--secundario", "ui-btn--28"); derecha.appendChild(resto[0]); return; }
                var caja = document.createElement("div"); caja.className = "mod-menu";
                caja.innerHTML = '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28 mod-menu__btn" aria-haspopup="menu" aria-expanded="false">' +
                    esc(ir ? "Ir a" : g.titulo) + ico(D.abajo, 2) + '</button><div class="mod-menu__lista" role="menu" hidden></div>';
                var lista = caja.querySelector(".mod-menu__lista");
                resto.forEach(function (b) { b.setAttribute("role", "menuitem"); lista.appendChild(b); });
                derecha.appendChild(caja);
                menus.push({ caja: caja, items: resto });
            });
            // Un menú sin nada visible no se muestra (los módulos ocultan acciones según lo que hay)
            function refrescar() { menus.forEach(function (m) { m.caja.hidden = m.items.every(function (b) { return b.hidden; }); }); }
            refrescar();
            var obs = new MutationObserver(refrescar);
            menus.forEach(function (m) { m.items.forEach(function (b) { obs.observe(b, { attributes: true, attributeFilter: ["hidden"] }); }); });
            function cerrar(salvo) {
                lado.querySelectorAll(".mod-menu__lista").forEach(function (l) { if (l !== salvo) { l.hidden = true; l.previousElementSibling.setAttribute("aria-expanded", "false"); } });
            }
            lado.addEventListener("click", function (e) {
                var btn = e.target.closest(".mod-menu__btn");
                if (btn) { var l = btn.nextElementSibling; cerrar(l); l.hidden = !l.hidden; btn.setAttribute("aria-expanded", String(!l.hidden)); return; }
                if (e.target.closest(".mod-menu__lista .mod-accion")) cerrar(null);
            });
            document.addEventListener("click", function (e) { if (!lado.contains(e.target)) cerrar(null); });
            document.addEventListener("keydown", function (e) { if (e.key === "Escape") cerrar(null); });
            var layout = lado.closest(".mod-layout"), principal = layout && layout.querySelector(".mod-layout__principal");
            if (principal) { principal.insertBefore(lado, principal.firstChild); layout.classList.add("mod-layout--sin-lado"); }
        });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", accionesEnBarra); else accionesEnBarra();

    /* ------------------------------------------------- bloqueo por inactividad (S-01)
       Tras N minutos sin usar la web (cada quien lo elige en Configuración › Mi perfil) se bloquea la pantalla en
       todas las pestañas. Con PIN se desbloquea sin perder lo que estaba en pantalla; el servidor también deja esa
       sesión sin acceso mientras tanto. Sin PIN, se vuelve a entrar con el correo. Tras 8 h sin actividad se cierra
       la sesión. Los trabajos en curso del servidor no se detienen. */
    var bloqueo = { activa: false, minutos: 15, horas: 8, pin: false, listo: false };
    var LLAVE_ACT = "fc-actividad", LLAVE_BLOQ = "fc-bloqueada", SALIR = "/cdn-cgi/access/logout";
    function leerLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function ponerLS(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }
    var ultimaMarca = 0;
    function marcarActividad() {
        if (bloqueo.activa) return;
        var t = Date.now();
        if (t - ultimaMarca < 5000) return;
        ultimaMarca = t; ponerLS(LLAVE_ACT, String(t));
    }
    function capaBloqueo() {
        var capa = document.getElementById("fc-bloqueo-pantalla");
        if (capa) return capa;
        capa = document.createElement("div");
        capa.id = "fc-bloqueo-pantalla"; capa.className = "fc-bloqueo-pantalla"; capa.setAttribute("role", "dialog"); capa.setAttribute("aria-modal", "true");
        capa.setAttribute("aria-labelledby", "fc-bl-titulo");
        capa.innerHTML = '<div class="fc-bloqueo-pantalla__caja">' +
            '<span class="fc-marca__sello">' + ico(D.rayo) + "</span>" +
            '<h2 id="fc-bl-titulo">Pantalla bloqueada</h2><p id="fc-bl-texto"></p>' +
            '<form id="fc-bl-form" hidden><input id="fc-bl-pin" class="ui-input" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="PIN" aria-label="Tu PIN">' +
            '<button type="submit" class="ui-btn ui-btn--primario">Desbloquear</button></form>' +
            '<p class="fc-bloqueo-pantalla__msj" id="fc-bl-msj" role="alert"></p>' +
            '<a class="ui-btn ui-btn--secundario" id="fc-bl-salir" href="' + SALIR + '">Volver a entrar</a></div>';
        document.body.appendChild(capa);
        capa.querySelector("#fc-bl-form").addEventListener("submit", function (e) { e.preventDefault(); desbloquear(); });
        return capa;
    }
    function pintarCapa() {
        var capa = capaBloqueo(), con = bloqueo.pin;
        document.getElementById("fc-bl-texto").textContent = con
            ? "Por seguridad, después de " + bloqueo.minutos + " minutos sin usarla. Escribe tu PIN para seguir donde estabas."
            : "Por seguridad, después de " + bloqueo.minutos + " minutos sin usarla. Para seguir, vuelve a entrar con tu correo. " +
              "Si creas un PIN en Configuración › Mi perfil, la desbloqueas sin salir.";
        document.getElementById("fc-bl-form").hidden = !con;
        document.getElementById("fc-bl-salir").textContent = con ? "Entrar con mi correo" : "Volver a entrar";
        document.getElementById("fc-bl-salir").className = "ui-btn " + (con ? "ui-btn--terciario" : "ui-btn--primario");
        capa.hidden = false;
        document.documentElement.classList.add("fc-bloqueada");
        if (con) setTimeout(function () { var i = document.getElementById("fc-bl-pin"); if (i) i.focus(); }, 50);
    }
    function bloquearPantalla(desdeServidor) {
        if (bloqueo.activa) return;
        bloqueo.activa = true;
        ponerLS(LLAVE_BLOQ, "1");
        pintarCapa();
        if (!desdeServidor && bloqueo.pin) fetch(API + "/api/mi-perfil/pin/bloquear", { method: "POST", credentials: "include" }).catch(function () {});
    }
    function quitarCapa() {
        bloqueo.activa = false;
        var capa = document.getElementById("fc-bloqueo-pantalla");
        if (capa) { capa.hidden = true; document.getElementById("fc-bl-pin").value = ""; document.getElementById("fc-bl-msj").textContent = ""; }
        document.documentElement.classList.remove("fc-bloqueada");
    }
    async function desbloquear() {
        var pin = document.getElementById("fc-bl-pin").value.trim(), msj = document.getElementById("fc-bl-msj");
        if (!pin) return;
        msj.textContent = "";
        try {
            var r = await fetch(API + "/api/mi-perfil/pin/desbloquear", { method: "POST", credentials: "include",
                headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: pin }) });
            if (!r.ok) { msj.textContent = await window.Fiscontable.leerError(r); document.getElementById("fc-bl-pin").select(); return; }
            ponerLS(LLAVE_BLOQ, null); ultimaMarca = 0; quitarCapa(); marcarActividad();
        } catch (e) { msj.textContent = "No se pudo conectar. Intenta de nuevo."; }
    }
    function revisarInactividad() {
        if (!bloqueo.listo) return;
        var ultima = +(leerLS(LLAVE_ACT) || 0) || ultimaMarca || Date.now(), quieto = Date.now() - ultima;
        if (quieto > bloqueo.horas * 3600e3) { ponerLS(LLAVE_BLOQ, null); ponerLS(LLAVE_ACT, null); location.href = SALIR; return; }
        if (!bloqueo.activa && quieto > bloqueo.minutos * 60e3) bloquearPantalla(false);
    }
    function prepararBloqueo(p) {
        var b = p && p.bloqueo;
        if (!b || document.documentElement.classList.contains("fc-incrustado")) return;
        bloqueo.minutos = b.minutos || 15; bloqueo.horas = b.horas_cierre || 8; bloqueo.pin = !!b.tiene_pin;
        if (bloqueo.activa) pintarCapa();
        if (bloqueo.listo) return;
        bloqueo.listo = true;
        if (p.pantalla_bloqueada || leerLS(LLAVE_BLOQ) === "1") bloquearPantalla(!!p.pantalla_bloqueada);
        else { ultimaMarca = 0; marcarActividad(); }
        ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"].forEach(function (ev) { document.addEventListener(ev, marcarActividad, { passive: true }); });
        setInterval(revisarInactividad, 15000);
        // Las demás pestañas: si una se bloquea o se desbloquea, todas igual
        window.addEventListener("storage", function (e) {
            if (e.key !== LLAVE_BLOQ) return;
            if (e.newValue === "1") bloquearPantalla(true); else quitarCapa();
        });
    }
    // Recargar con la pantalla bloqueada no la abre: la capa sale antes que cualquier dato
    if (leerLS(LLAVE_BLOQ) === "1" && !document.documentElement.classList.contains("fc-incrustado")) {
        bloqueo.activa = true;
        document.addEventListener("DOMContentLoaded", pintarCapa);
        if (document.readyState !== "loading") pintarCapa();
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
            fila.className = "fc-letrero";
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
    pintarLateral();
    pintarPanel();
    pintarModalPerfil();

    document.getElementById("fc-btn-descargas").addEventListener("click", abrirDescargas);
    document.getElementById("fc-btn-actividad").addEventListener("click", abrirActividad);
    document.getElementById("fc-act-cerrar").addEventListener("click", cerrarActividad);
    document.getElementById("fc-act-velo").addEventListener("click", cerrarActividad);
    document.getElementById("fc-act-leidas").addEventListener("click", marcarActividadLeida);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && actividad.abierta) cerrarActividad(); });
    setTimeout(sondearActividad, 1500);
    setInterval(sondearActividad, 60000);
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
        // G-15: dos opciones — la guía rápida (texto) y el recorrido visual (resalta cada parte de la pantalla)
        caja.innerHTML = '<div class="fc-ayuda-modal__caja" role="dialog" aria-label="Cómo se usa">' +
            "<h2>Cómo se usa · " + esc(ancla.dataset.titulo || modulo.nombre) + "</h2>" +
            '<p class="fc-ayuda-modal__sub">Guía rápida</p>' +
            "<ol>" + pasos.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ol>" +
            '<div class="fc-ayuda-modal__pie">' + (esAdminActual ? '<button type="button" class="ui-btn ui-btn--terciario ui-btn--32" data-editar-guia>Editar guía</button>' : "") +
            '<button type="button" class="ui-btn ui-btn--secundario ui-btn--32" data-recorrido>Recorrido visual</button>' +
            '<button type="button" class="fc-ayuda-modal__cerrar" data-cerrar>Entendido</button></div></div>';
        caja.hidden = false;
        caja.querySelector("[data-recorrido]").addEventListener("click", function () { caja.hidden = true; recorrido(clave, pasos); });
        var eg = caja.querySelector("[data-editar-guia]");
        if (eg) eg.addEventListener("click", function () { caja.hidden = true; editarTexto("ayuda." + (ancla.dataset.ayuda || clave), pasos.join(" · ")); });
    });

    /* ------------------------------------------------- recorrido visual (G-15)
       Resalta, uno por uno, los elementos que se ven en esta pantalla y explica para qué sirven. Lo que ya viste se
       recuerda (fc-recorrido:<módulo>). Fiscontable.recorrido(clave, pasos) lo abre desde cualquier lado. */
    var PASOS_COMUNES = [
        ["#fc-lateral", "Barra lateral", "Todos los módulos por grupo. Pliégala con «Contraer»; Ctrl+K busca cualquier módulo por su nombre."],
        ["#fc-btn-empresa", "Empresa activa", "Con quién trabajas. Todos los módulos la usan; las favoritas salen primero."],
        ["#fc-btn-periodo", "Periodo general", "El mes con el que abren los módulos que trabajan por periodo."],
        [".mod-acciones--barra", "Acciones del módulo", "Lo que puedes hacer con lo que ves. «Ir a ▾» abre otro módulo con el mismo periodo."],
        ["#linea-programa .fpu", "Programación", "Lo que se hace solo, de madrugada, y cada cuánto. «Cambiar» para ajustarlo."],
        [".fct-barra, .xml-toolbar", "La tabla", "Busca, filtra (los filtros quedan como etiquetas), elige columnas, guarda vistas y exporta a Excel."],
        ["#fc-btn-actividad", "Actividad", "Avisos de lo que terminó o cambió mientras no estabas (también pueden llegarte por correo)."],
        ["#fc-btn-descargas", "Descargas", "Los archivos que pediste: constancias, opiniones, XML y reportes."]
    ];
    function recorrido(claveMod, pasosTexto) {
        var pasos = [];
        if (pasosTexto && pasosTexto.length) pasos.push({ el: null, titulo: modulo ? modulo.nombre : "Esta pantalla", texto: pasosTexto[0] });
        PASOS_COMUNES.forEach(function (p) {
            var el = Array.prototype.slice.call(document.querySelectorAll(p[0])).filter(function (x) { var r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; })[0];
            if (el) pasos.push({ el: el, titulo: p[1], texto: p[2] });
        });
        if (!pasos.length) return;
        var i = 0, capa = document.createElement("div");
        capa.className = "fc-tour";
        capa.innerHTML = '<div class="fc-tour__luz"></div><div class="fc-tour__globo" role="dialog" aria-live="polite"><b class="fc-tour__titulo"></b><p class="fc-tour__texto"></p>' +
            '<div class="fc-tour__pie"><span class="fc-tour__n"></span><button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-t="ant">Anterior</button>' +
            '<button type="button" class="ui-btn ui-btn--primario ui-btn--28" data-t="sig">Siguiente</button></div>' +
            '<button type="button" class="fc-tour__cerrar" data-t="fin" aria-label="Terminar recorrido">×</button></div>';
        document.body.appendChild(capa);
        var luz = capa.querySelector(".fc-tour__luz"), globo = capa.querySelector(".fc-tour__globo");
        function poner() {
            var p = pasos[i];
            capa.querySelector(".fc-tour__titulo").textContent = p.titulo;
            capa.querySelector(".fc-tour__texto").textContent = p.texto;
            capa.querySelector(".fc-tour__n").textContent = (i + 1) + " de " + pasos.length;
            capa.querySelector('[data-t="ant"]').disabled = i === 0;
            capa.querySelector('[data-t="sig"]').textContent = i === pasos.length - 1 ? "Terminar" : "Siguiente";
            if (!p.el) {
                luz.hidden = true;
                globo.style.left = "50%"; globo.style.top = "30%"; globo.style.transform = "translateX(-50%)";
                return;
            }
            p.el.scrollIntoView({ block: "nearest" });
            var r = p.el.getBoundingClientRect(), m = 6;
            luz.hidden = false;
            luz.style.left = (r.left - m) + "px"; luz.style.top = (r.top - m) + "px";
            luz.style.width = (r.width + m * 2) + "px"; luz.style.height = Math.min(r.height + m * 2, innerHeight - 20) + "px";
            var ancho = Math.min(340, innerWidth - 24), x = Math.min(Math.max(12, r.left), innerWidth - ancho - 12);
            var abajo = r.bottom + 12 + 160 < innerHeight;
            globo.style.transform = "none"; globo.style.left = x + "px";
            globo.style.top = (abajo ? r.bottom + 12 : Math.max(12, r.top - 12 - globo.offsetHeight)) + "px";
            if (r.height > innerHeight * 0.5) {                     // algo alto (la barra lateral, la tabla): el globo va a un lado
                if (r.right + 12 + ancho < innerWidth) { globo.style.left = (r.right + 12) + "px"; globo.style.top = Math.max(12, r.top + 24) + "px"; }
                else if (r.left - 12 - ancho > 0) { globo.style.left = (r.left - 12 - ancho) + "px"; globo.style.top = Math.max(12, r.top + 24) + "px"; }
                else { globo.style.top = "auto"; globo.style.bottom = "16px"; }
            } else globo.style.bottom = "auto";
        }
        function fin() {
            capa.remove(); document.removeEventListener("keydown", tecla);
            try { localStorage.setItem("fc-recorrido:" + claveMod, "1"); } catch (e) { /* nada */ }
        }
        function tecla(e) {
            if (e.key === "Escape") fin();
            else if (e.key === "ArrowRight") { if (i < pasos.length - 1) { i++; poner(); } else fin(); }
            else if (e.key === "ArrowLeft" && i > 0) { i--; poner(); }
        }
        capa.addEventListener("click", function (e) {
            var b = e.target.closest("[data-t]"); if (!b) return;
            if (b.dataset.t === "fin") fin();
            else if (b.dataset.t === "ant" && i > 0) { i--; poner(); }
            else if (b.dataset.t === "sig") { if (i < pasos.length - 1) { i++; poner(); } else fin(); }
        });
        document.addEventListener("keydown", tecla);
        poner();
    }

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
        riel: riel,
        excel: excel,
        verCfdi: verCfdi,
        bloquearPantalla: function (servidor) { bloquearPantalla(!!servidor); },
        catalogo: CATALOGO,
        grupos: GRUPOS,
        avisoPlan: avisoPlan,
        toast: function (texto) { brindis(esc(texto)); },
        bloqueEstado: bloqueEstado,
        recorrido: function (c) { recorrido(c || clave, AYUDA[c || clave] || []); },
        enviarCorreo: enviarCorreo,
        // Set único de íconos (mismo grosor). Fiscontable.icono("lapiz") → <svg>. Ver /ui/.
        icono: function (nombre, ancho) { return D[nombre] ? ico(D[nombre], ancho || 1.8).replace("<svg ", '<svg class="ui-ico" aria-hidden="true" ') : ""; },
        iconos: function () { return Object.keys(D); },
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
