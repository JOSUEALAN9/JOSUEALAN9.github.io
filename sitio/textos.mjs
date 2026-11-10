// textos.mjs — Los textos de la página principal en español e inglés. La plantilla (generar.mjs) es una sola:
// solo cambian estas palabras. Regla: cada frase debe poder comprobarse hoy en el sistema.
export const T = {
    es: {
        idioma: "es", ruta: "/", otra: "/en/", otraNombre: "English",
        titulo: "Fiscontable · El SAT de todos tus clientes, en orden",
        descripcion: "Fiscontable descarga del SAT los XML, constancias, opiniones de cumplimiento y avisos del buzón de cada cliente de tu despacho, y te muestra qué falta para cerrar el mes.",
        nav: { funciones: "Funciones", agente: "Agente", seguridad: "Seguridad", dudas: "Preguntas", entrar: "Iniciar sesión", demo: "Solicita una demo", menu: "Menú" },
        heroe: {
            chip: "Para despachos contables en México",
            h1a: "Cierra el mes", h1b: "sin perseguir documentos.",
            sub: "Fiscontable descarga del SAT los XML, constancias, opiniones de cumplimiento y avisos del buzón de cada cliente, y te indica qué le falta a cada uno.",
            demo: "Solicita una demo", ver: "Ver funciones",
            nota: ["Demo de 7 días", "Sin tarjeta", "En tu navegador"]
        },
        maqueta: {
            ventana: "Cierre del mes", cab: "Cierre del periodo", mes: "Octubre 2026", meses: ["Ago", "Sep", "Oct", "Nov"],
            filtros: [["Todos", 12], ["Vencidas", 1], ["Vencen pronto", 2], ["Sin XML", 1]],
            columnas: ["Cliente", "XML", "CSF", "32-D", "Buzón", "Decl."],
            vence: ["vence 17 nov", "vence 17 nov", "vence 18 nov", "vencida", "vence 19 nov", "vence 19 nov"],
            pie: "Datos de ejemplo.",
            lector: "Vista del cierre del mes: una fila por cliente con el estado de sus XML, constancia, opinión de cumplimiento, buzón y declaración."
        },
        funciones: {
            chip: "Funciones", h2: "Lo que hoy se hace manualmente, cliente por cliente",
            sub: "Un solo lugar para lo que el SAT reparte en varios portales.",
            lista: [
                ["descarga", "Descarga de XML", "Emitidos y recibidos de cada empresa. Opcionalmente, de forma programada cada día."],
                ["xml", "Administración de XML", "Busca, filtra y exporta a Excel. Con el PDF de cada comprobante y su estado en el SAT."],
                ["escudo", "Constancia y opinión 32-D", "De un cliente o de toda tu cartera en una sola solicitud."],
                ["buzon", "Buzón Tributario", "Revisa los mensajes de cada cliente sin abrir las notificaciones pendientes."],
                ["alerta", "Listas del SAT", "Detecta proveedores y clientes publicados en los listados 69 y 69-B."],
                ["cruce", "Conciliación e IVA", "Facturas a crédito contra sus complementos de pago, y el papel de trabajo del IVA."],
                ["factura", "Facturación", "Facturas, complementos de pago y cotizaciones desde el mismo sistema."],
                ["equipo", "Tu despacho", "Cada persona ve solo las empresas y los módulos que le asignas."]
            ]
        },
        focos: [
            { chip: "Automático", h2: "Tus XML, siempre al día", texto: "Programa la descarga y Fiscontable incorpora cada día los comprobantes nuevos de tus empresas. Al iniciar tu jornada ya están en tu Administración de XML.",
              puntos: ["Emitidos y recibidos", "Sin duplicados", "Aviso si algo falla"] },
            { chip: "Equipo", h2: "Un despacho, con permisos por persona", texto: "Invita a tu equipo y define qué empresas ve cada persona, qué módulos utiliza y quién solo consulta. Cada acción queda registrada en la bitácora.",
              puntos: ["Permisos por persona", "Solicitudes con aprobación", "Espacio personal aparte"] }
        ],
        maquetaXml: { titulo: "Descarga automática", sub: "Hoy · 03:10", filas: [["Comercializadora Aurora", "184 XML"], ["Ferretera del Valle", "62 XML"], ["Café Orquídea", "27 XML"]], pie: "273 comprobantes nuevos" },
        maquetaEquipo: { titulo: "Equipo del despacho", filas: [["MR", "Mariana R.", "Titular", "Todas las empresas"], ["JC", "Jorge C.", "Aprueba", "8 empresas"], ["LP", "Lucía P.", "Solo consulta", "3 empresas"]] },
        agente: {
            chip: "Para Windows", h2: "Tus consultas y descargas, desde tu propia PC",
            texto: "Fiscontable Agente es una aplicación para Windows que procesa en tu computadora las solicitudes que realizas en la web: con tu conexión a internet, tu navegador y una copia de cada documento en tu equipo.",
            puntos: [
                "Opera en segundo plano, con un ícono junto al reloj.",
                "Conserva una copia organizada por RFC en Documentos\\Fiscontable.",
                "Tu PC llama al servidor: no abre puertos ni recibe conexiones.",
                "Tú autorizas cada equipo y puedes desconectarlo en cualquier momento."
            ],
            boton: "Cómo se instala", tienda: "Muy pronto en Microsoft Store", tiendaLista: "Disponible en Microsoft Store",
            ventana: { titulo: "Fiscontable Agente", filas: [["Estado", "En línea"], ["Cuenta", "mariana@despacho.mx"], ["Última solicitud", "Constancia · Completado"], ["Solicitudes hoy", "14"]] }
        },
        seguridad: {
            chip: "Seguridad", h2: "Hecho para manejar información fiscal",
            sub: "Lo que puedes explicar a un cliente cuando pregunte por su e.firma.",
            lista: [
                ["candado", "e.firmas cifradas", "Las e.firmas y contraseñas del SAT se guardan cifradas. En la demo no se guardan: se piden en cada trámite."],
                ["telefono", "Verificación en dos pasos", "Además de tu contraseña, un código en tu app de autenticación o en tu correo."],
                ["equipo", "Permisos por persona", "Cada persona ve únicamente las empresas que le asignas."],
                ["lista", "Bitácora", "Registro de quién realizó cada acción y cuándo."],
                ["reloj", "Bloqueo por inactividad", "Si dejas la sesión abierta, la pantalla se bloquea automáticamente."],
                ["monitor", "Sesiones a la vista", "Consulta dónde está abierta tu cuenta y cierra las sesiones que no reconozcas."]
            ],
            enlace: "Leer el aviso de privacidad"
        },
        pasos: {
            chip: "Cómo empezar", h2: "Comienza en tres pasos",
            lista: [["Solicita tu demo", "Al aprobarse tu solicitud recibirás el acceso por correo."], ["Registra tus empresas", "Con su e.firma o su contraseña del SAT, según el trámite."], ["Instala el Agente", "Opcional: para procesar tus solicitudes desde tu PC."]]
        },
        registro: {
            chip: "Demo", h2: "Conócelo con tus propias empresas",
            sub: "Demo de 7 días. Recibirás un correo en cuanto esté activa.",
            puntos: ["Con tus clientes reales", "Sin instalar nada", "Tu información se conserva al contratar"],
            licencia: "¿Ya tienes una licencia?", licenciaEnlace: "Crea tu cuenta", cuenta: "¿Ya tienes cuenta?", cuentaEnlace: "Inicia sesión",
            sinJs: "Para enviar el formulario activa JavaScript en tu navegador."
        },
        dudas: {
            chip: "Preguntas", h2: "Antes de empezar",
            lista: [
                ["¿Necesito instalar algo?", "No. Fiscontable funciona en el navegador. El Agente para Windows es opcional: permite que las consultas y descargas se realicen desde tu computadora."],
                ["¿Qué necesito de cada cliente?", "Su e.firma (archivos .cer y .key y su contraseña) o su contraseña del SAT, según el trámite."],
                ["¿Dónde quedan las e.firmas?", "Cifradas en el servidor de Fiscontable; se utilizan únicamente para los trámites que solicitas. En la demo no se guardan."],
                ["¿Puedo trabajar con mi equipo?", "Sí. Crea tu despacho, invita a cada persona y define qué empresas y módulos ve."],
                ["¿Funciona en Mac o en el celular?", "La web sí, en cualquier navegador actual. El Agente es solo para Windows 10 y 11."],
                ["¿Qué incluye la demo?", "Los módulos principales, para que conozcas el sistema con tus propias empresas durante 7 días. Al contratar se activan todos los de tu plan y se conserva la información registrada."],
                ["¿Cuánto cuesta?", "Depende del número de empresas y de personas. Solicita tu demo y te presentaremos el plan adecuado para tu despacho."]
            ]
        },
        cierre: { h2: "Lleva tu próximo cierre con todo en orden", boton: "Solicita una demo" },
        pie: {
            lema: "El SAT de todos tus clientes, en orden.",
            producto: "Producto", cuenta: "Cuenta", legal: "Legal",
            privacidad: "Aviso de privacidad", terminos: "Términos y condiciones", cookies: "Cookies", soporte: "Ayuda y soporte", activar: "Activar una licencia",
            derechos: "© 2026 Fiscontable. Hecho en México."
        },
        rutas: { privacidad: "/privacidad/", terminos: "/terminos/", cookies: "/cookies/", soporte: "/soporte/" }
    },

    en: {
        idioma: "en", ruta: "/en/", otra: "/", otraNombre: "Español",
        titulo: "Fiscontable · Every client's SAT paperwork, in order",
        descripcion: "Fiscontable downloads each client's invoices (XML), tax status certificates, compliance opinions and tax mailbox notices from Mexico's tax authority (SAT), and shows your firm what is still missing to close the month.",
        nav: { funciones: "Features", agente: "Agent", seguridad: "Security", dudas: "FAQ", entrar: "Sign in", demo: "Request a demo", menu: "Menu" },
        heroe: {
            chip: "For accounting firms in Mexico",
            h1a: "Close the month", h1b: "without chasing documents.",
            sub: "Fiscontable pulls each client's invoices (XML), tax status certificates, compliance opinions and tax mailbox notices from the SAT, and tells you what each one is missing.",
            demo: "Request a demo", ver: "See features",
            nota: ["7-day demo", "No credit card", "In your browser"]
        },
        maqueta: {
            ventana: "Month-end close", cab: "Period close", mes: "October 2026", meses: ["Aug", "Sep", "Oct", "Nov"],
            filtros: [["All", 12], ["Overdue", 1], ["Due soon", 2], ["No XML", 1]],
            columnas: ["Client", "XML", "CSF", "32-D", "Inbox", "Filing"],
            vence: ["due Nov 17", "due Nov 17", "due Nov 18", "overdue", "due Nov 19", "due Nov 19"],
            pie: "Sample data.",
            lector: "Month-end close view: one row per client with the status of its XML invoices, tax status certificate, compliance opinion, tax mailbox and return."
        },
        funciones: {
            chip: "Features", h2: "What you do by hand today, client by client",
            sub: "One place for what the SAT spreads across several portals.",
            lista: [
                ["descarga", "XML download", "Issued and received invoices for every company. Optionally, on a daily schedule."],
                ["xml", "XML management", "Search, filter and export to Excel. With each invoice's PDF and its status at the SAT."],
                ["escudo", "Tax status and 32-D opinion", "For one client or your whole portfolio in a single request."],
                ["buzon", "Tax mailbox", "Check each client's messages without opening pending notifications."],
                ["alerta", "SAT lists", "Spot suppliers and customers published on the 69 and 69-B lists."],
                ["cruce", "Reconciliation and VAT", "Credit invoices against their payment receipts, plus the VAT worksheet."],
                ["factura", "Invoicing", "Invoices, payment receipts and quotes from the same system."],
                ["equipo", "Your firm", "Each person sees only the companies and modules you assign."]
            ]
        },
        focos: [
            { chip: "Automatic", h2: "Your invoices, always up to date", texto: "Schedule the download and Fiscontable brings in what is new for your companies every day. By the time you get to the office it is already in XML management.",
              puntos: ["Issued and received", "No duplicates", "An alert if something fails"] },
            { chip: "Team", h2: "One firm, everyone with their own work", texto: "Invite your team and decide which companies each person sees, which modules they use and who is read-only. Everything is logged.",
              puntos: ["Per-person permissions", "Requests with approval", "A separate personal space"] }
        ],
        maquetaXml: { titulo: "Automatic download", sub: "Today · 03:10", filas: [["Comercializadora Aurora", "184 XML"], ["Ferretera del Valle", "62 XML"], ["Café Orquídea", "27 XML"]], pie: "273 new invoices" },
        maquetaEquipo: { titulo: "Firm team", filas: [["MR", "Mariana R.", "Owner", "All companies"], ["JC", "Jorge C.", "Approver", "8 companies"], ["LP", "Lucía P.", "Read-only", "3 companies"]] },
        agente: {
            chip: "For Windows", h2: "Your requests, processed on your own PC",
            texto: "Fiscontable Agent is a Windows app that processes on your computer the requests you make on the web: with your internet connection, your browser, and a copy of every document on your machine.",
            puntos: [
                "Runs in the background, with an icon next to the clock.",
                "Keeps a copy sorted by taxpayer ID in Documents\\Fiscontable.",
                "Your PC calls the server: it opens no ports and accepts no connections.",
                "You approve each PC and can disconnect it at any time."
            ],
            boton: "How to install it", tienda: "Coming soon to Microsoft Store", tiendaLista: "Available on Microsoft Store",
            ventana: { titulo: "Fiscontable Agente", filas: [["Status", "Online"], ["Account", "mariana@despacho.mx"], ["Last request", "Tax status · Completed"], ["Requests today", "14"]] }
        },
        seguridad: {
            chip: "Security", h2: "Built to handle tax information",
            sub: "What you can tell a client who asks about their e.firma (digital tax signature).",
            lista: [
                ["candado", "Encrypted e.firmas", "e.firmas and SAT passwords are stored encrypted. In the demo they are not stored: they are requested for each procedure."],
                ["telefono", "Two-step verification", "On top of your password, a code from your authenticator app or sent to your email."],
                ["equipo", "Per-person permissions", "Nobody sees a company you did not assign to them."],
                ["lista", "Activity log", "There is a record of who did what, and when."],
                ["reloj", "Inactivity lock", "If you leave the computer open, the screen locks itself."],
                ["monitor", "Sessions in view", "See where your account is open and close anything you do not recognize."]
            ],
            enlace: "Read the privacy notice"
        },
        pasos: {
            chip: "Getting started", h2: "Ready in an afternoon",
            lista: [["Request your demo", "We activate your access and let you know by email."], ["Add your companies", "With their e.firma or SAT password, depending on the procedure."], ["Install the Agent", "Optional: to process your requests on your own PC."]]
        },
        registro: {
            chip: "Demo", h2: "Try it with your own companies",
            sub: "7-day demo. We will email you as soon as it is ready.",
            puntos: ["With your real clients", "Nothing to install", "What you do is kept when you subscribe"],
            licencia: "Already have a license?", licenciaEnlace: "Create your account", cuenta: "Already have an account?", cuentaEnlace: "Sign in",
            sinJs: "To send the form, enable JavaScript in your browser."
        },
        dudas: {
            chip: "FAQ", h2: "Before you start",
            lista: [
                ["Do I need to install anything?", "No. Fiscontable runs in the browser. The Agent for Windows is optional: it lets your requests be processed on your own computer."],
                ["What do I need from each client?", "Their e.firma (the .cer and .key files and their password) or their SAT password, depending on the procedure."],
                ["Where are e.firmas kept?", "Encrypted on Fiscontable's server, and used only for the procedures you request. In the demo they are not stored."],
                ["Can I work with my team?", "Yes. You create your firm, invite each person and decide which companies and modules they see."],
                ["Does it work on Mac or on a phone?", "The web app does, in any current browser. The Agent is only for Windows 10 and 11."],
                ["What does the demo include?", "The main modules, so you can get to know the system with your own companies for 7 days. When you subscribe, every module in your plan is activated and you keep what you already did."],
                ["How much does it cost?", "It depends on the number of companies and people. Request your demo and we will share the plan that fits you."],
                ["Is the app in English?", "The application itself is in Spanish, since it is built for accounting work in Mexico. These public pages are available in English."]
            ]
        },
        cierre: { h2: "Your next month-end can be calmer", boton: "Request a demo" },
        pie: {
            lema: "Every client's SAT paperwork, in order.",
            producto: "Product", cuenta: "Account", legal: "Legal",
            privacidad: "Privacy notice", terminos: "Terms and conditions", cookies: "Cookies", soporte: "Help and support", activar: "Activate a license",
            derechos: "© 2026 Fiscontable. Made in Mexico."
        },
        rutas: { privacidad: "/en/privacy/", terminos: "/en/terms/", cookies: "/en/cookies/", soporte: "/en/support/" }
    }
};
