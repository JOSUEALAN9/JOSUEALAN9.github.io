/**
 * Intenta extraer el RFC del certificado .cer de e.firma leyendo el
 * campo "Subject" del certificado X.509 (usando la librería forge.js).
 *
 * Es un método heurístico a propósito: en vez de buscar un único OID
 * fijo dentro del certificado (que no pudimos confirmar probando
 * contra un .cer real durante el desarrollo de este archivo), se
 * revisan TODOS los atributos del Subject buscando un valor con forma
 * de RFC mexicano. Es más tolerante a variaciones del formato.
 *
 * Devuelve el RFC en mayúsculas si lo encuentra, o null si no se pudo
 * leer (el formulario debe permitir captura manual como respaldo).
 *
 * Requiere que la librería forge.js esté cargada en la página antes
 * de este archivo.
 */
async function extraerRFCDeCertificado(archivo) {
    if (typeof forge === "undefined") {
        console.warn("forge.js no está disponible; se omite la lectura automática del RFC.");
        return null;
    }

    const patronRFC = /([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/;

    try {
        const buffer = await archivo.arrayBuffer();
        const binario = forge.util.createBuffer(new Uint8Array(buffer));
        const asn1 = forge.asn1.fromDer(binario);
        const cert = forge.pki.certificateFromAsn1(asn1);

        for (const atributo of cert.subject.attributes) {
            const valor = (atributo.value || "").toString().toUpperCase();
            const coincidencia = valor.match(patronRFC);
            if (coincidencia) return coincidencia[1];
        }
        return null;
    } catch (error) {
        console.warn("No se pudo leer el certificado para extraer el RFC:", error);
        return null;
    }
}
