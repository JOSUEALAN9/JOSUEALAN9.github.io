/**
 * rfc-from-cer.js — Lee el certificado (.cer) de una e.firma en el
 * navegador, sin mandarlo a ningún lado y sin librerías externas.
 *
 *   leerCertificado(archivo)  -> { rfc, nombre, vigenteDesde, vigenteHasta,
 *                                  vencido, diasRestantes }   o null
 *   extraerRFCDeCertificado(archivo) -> "RFC" o null   (compatibilidad)
 *
 * Antes dependía de forge.js (~280 KB desde un CDN) solo para esto. Un
 * certificado X.509 es una estructura DER sencilla; aquí se leen nada
 * más las tres partes que importan: sujeto (nombre y RFC) y vigencia.
 *
 * De dónde sale cada dato en la e.firma del SAT:
 *   - RFC:    atributo x500UniqueIdentifier (2.5.4.45). En personas
 *             morales trae "RFC_EMPRESA / RFC_REPRESENTANTE": se toma el
 *             primero. Si no existe, se busca un valor con forma de RFC
 *             en cualquier atributo del sujeto.
 *   - Nombre: CN (2.5.4.3); si falta, name (2.5.4.41) u O (2.5.4.10).
 */
(function () {
    "use strict";

    var PATRON_RFC = /([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/;
    var OID_RFC = "2.5.4.45", OID_CN = "2.5.4.3", OID_NAME = "2.5.4.41", OID_O = "2.5.4.10";

    /* ---- DER: tag, longitud, contenido ---- */
    function tlv(b, pos) {
        var tag = b[pos], l = b[pos + 1], cab = 2, len = l;
        if (l & 0x80) {
            var n = l & 0x7f;
            if (n < 1 || n > 4) throw new Error("longitud DER no soportada");
            len = 0;
            for (var i = 0; i < n; i++) len = len * 256 + b[pos + 2 + i];
            cab = 2 + n;
        }
        var ini = pos + cab;
        if (ini + len > b.length) throw new Error("DER truncado");
        return { tag: tag, ini: ini, fin: ini + len };
    }

    function hijos(b, nodo) {
        var lista = [], p = nodo.ini;
        while (p < nodo.fin) { var h = tlv(b, p); lista.push(h); p = h.fin; }
        return lista;
    }

    function oid(b, n) {
        var v = b.subarray(n.ini, n.fin), partes = [Math.floor(v[0] / 40), v[0] % 40], x = 0;
        for (var i = 1; i < v.length; i++) {
            x = x * 128 + (v[i] & 0x7f);
            if (!(v[i] & 0x80)) { partes.push(x); x = 0; }
        }
        return partes.join(".");
    }

    function texto(b, n) {
        var v = b.subarray(n.ini, n.fin);
        if (n.tag === 0x0C) return new TextDecoder("utf-8").decode(v);            // UTF8String
        if (n.tag === 0x1E) return new TextDecoder("utf-16be").decode(v);         // BMPString
        return new TextDecoder("latin1").decode(v);                               // Printable, IA5, T61
    }

    function fecha(b, n) {
        var s = texto(b, n), a, r;
        if (n.tag === 0x17) { a = parseInt(s.slice(0, 2), 10); a += a < 50 ? 2000 : 1900; r = s.slice(2); }
        else { a = parseInt(s.slice(0, 4), 10); r = s.slice(4); }
        return new Date(Date.UTC(a, parseInt(r.slice(0, 2), 10) - 1, parseInt(r.slice(2, 4), 10),
            parseInt(r.slice(4, 6), 10), parseInt(r.slice(6, 8), 10), parseInt(r.slice(8, 10) || "0", 10)));
    }

    /* Acepta DER (lo normal en el SAT) y también PEM por si acaso. */
    function aBytes(buffer) {
        var b = new Uint8Array(buffer);
        var inicio = new TextDecoder("latin1").decode(b.subarray(0, 30));
        if (inicio.indexOf("-----BEGIN") === -1) return b;
        var base64 = new TextDecoder("latin1").decode(b).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
        var bin = atob(base64), out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    function analizar(buffer) {
        var b = aBytes(buffer);
        var cert = tlv(b, 0);
        var tbs = hijos(b, cert)[0];
        var campos = hijos(b, tbs);
        var i = campos[0].tag === 0xA0 ? 1 : 0;      // versión explícita (v3)
        // serial, algoritmo, emisor, vigencia, sujeto
        var vigencia = hijos(b, campos[i + 3]);
        var sujeto = campos[i + 4];

        var atributos = {};
        hijos(b, sujeto).forEach(function (conjunto) {
            hijos(b, conjunto).forEach(function (par) {
                var p = hijos(b, par);
                var clave = oid(b, p[0]);
                (atributos[clave] = atributos[clave] || []).push(texto(b, p[1]).trim());
            });
        });

        var rfc = null;
        (atributos[OID_RFC] || []).some(function (v) {
            var m = v.toUpperCase().match(PATRON_RFC);
            if (m) { rfc = m[1]; return true; }
            return false;
        });
        if (!rfc) {
            Object.keys(atributos).some(function (k) {
                return atributos[k].some(function (v) {
                    var m = v.toUpperCase().match(PATRON_RFC);
                    if (m) { rfc = m[1]; return true; }
                    return false;
                });
            });
        }

        var nombre = (atributos[OID_CN] || atributos[OID_NAME] || atributos[OID_O] || [null])[0];
        var desde = fecha(b, vigencia[0]), hasta = fecha(b, vigencia[1]);
        var ahora = new Date();
        return {
            rfc: rfc,
            nombre: nombre,
            vigenteDesde: desde,
            vigenteHasta: hasta,
            vencido: hasta < ahora,
            diasRestantes: Math.floor((hasta - ahora) / 86400000)
        };
    }

    async function leerCertificado(archivo) {
        try {
            return analizar(await archivo.arrayBuffer());
        } catch (e) {
            console.warn("No se pudo leer el certificado:", e);
            return null;
        }
    }

    async function extraerRFCDeCertificado(archivo) {
        var datos = await leerCertificado(archivo);
        return datos ? datos.rfc : null;
    }

    window.leerCertificado = leerCertificado;
    window.extraerRFCDeCertificado = extraerRFCDeCertificado;
    window._analizarCertificado = analizar;   // solo para pruebas
})();
