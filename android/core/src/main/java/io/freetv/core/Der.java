package io.freetv.core;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.Signature;
import java.util.Base64;

/**
 * The PKCS#10 certificate request (CSR) Samsung's certificate service signs, written by hand (Java can make keys and sign, but
 * not certificate requests without a library). The same as connector/src/der.js.
 */
final class Der {
    private Der() {}

    static byte[] tlv(int tag, byte[] body) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        o.write(tag);
        int n = body.length;
        if (n < 0x80) o.write(n);
        else {
            int bytes = n > 0xffffff ? 4 : n > 0xffff ? 3 : n > 0xff ? 2 : 1;
            o.write(0x80 | bytes);
            for (int i = bytes - 1; i >= 0; i--) o.write((n >> (8 * i)) & 0xff);
        }
        o.write(body, 0, n);
        return o.toByteArray();
    }
    static byte[] cat(byte[]... parts) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        for (byte[] p : parts) o.write(p, 0, p.length);
        return o.toByteArray();
    }
    static byte[] seq(byte[]... items) { return tlv(0x30, cat(items)); }
    static byte[] set(byte[]... items) { return tlv(0x31, cat(items)); }
    static byte[] oid(String dotted) {
        String[] p = dotted.split("\\.");
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        o.write(40 * Integer.parseInt(p[0]) + Integer.parseInt(p[1]));
        for (int i = 2; i < p.length; i++) {
            long n = Long.parseLong(p[i]);
            byte[] b = new byte[10];
            int k = 0;
            b[k++] = (byte) (n & 0x7f);
            n >>= 7;
            while (n > 0) { b[k++] = (byte) ((n & 0x7f) | 0x80); n >>= 7; }
            for (int j = k - 1; j >= 0; j--) o.write(b[j]);
        }
        return tlv(0x06, o.toByteArray());
    }

    static final String CN = "2.5.4.3", EMAIL = "1.2.840.113549.1.9.1", EXT_REQ = "1.2.840.113549.1.9.14", SAN = "2.5.29.17",
            SHA512_RSA = "1.2.840.113549.1.1.13";

    /** A CSR (PEM) for this key pair: subject CN (and email when given), subjectAltName URIs when given, signed with SHA-512. */
    static String csr(KeyPair keys, String cn, String email, String[] uris) throws Exception {
        byte[] subject = email == null
                ? seq(set(seq(oid(CN), tlv(0x0c, cn.getBytes(StandardCharsets.UTF_8)))))
                : seq(set(seq(oid(CN), tlv(0x0c, cn.getBytes(StandardCharsets.UTF_8)))),
                      set(seq(oid(EMAIL), tlv(0x16, email.getBytes(StandardCharsets.ISO_8859_1)))));
        byte[] attrs = tlv(0xa0, new byte[0]);
        if (uris != null && uris.length > 0) {
            ByteArrayOutputStream names = new ByteArrayOutputStream();
            for (String u : uris) { byte[] t = tlv(0x86, u.getBytes(StandardCharsets.ISO_8859_1)); names.write(t, 0, t.length); }
            byte[] ext = seq(seq(oid(SAN), tlv(0x04, tlv(0x30, names.toByteArray()))));
            attrs = tlv(0xa0, seq(oid(EXT_REQ), set(ext)));
        }
        byte[] info = seq(tlv(0x02, new byte[] {0}), subject, keys.getPublic().getEncoded(), attrs);
        Signature s = Signature.getInstance("SHA512withRSA");
        s.initSign(keys.getPrivate());
        s.update(info);
        byte[] sig = s.sign();
        byte[] bits = cat(new byte[] {0}, sig);
        byte[] der = seq(info, seq(oid(SHA512_RSA), new byte[] {0x05, 0x00}), tlv(0x03, bits));
        return pem("CERTIFICATE REQUEST", der);
    }

    static String pem(String label, byte[] der) {
        String b64 = Base64.getEncoder().encodeToString(der);
        StringBuilder sb = new StringBuilder("-----BEGIN " + label + "-----\n");
        for (int i = 0; i < b64.length(); i += 64) sb.append(b64, i, Math.min(b64.length(), i + 64)).append('\n');
        return sb.append("-----END ").append(label).append("-----\n").toString();
    }

    static String unpemB64(String pem) { return pem.replaceAll("-----[^-]+-----", "").replaceAll("\\s+", ""); }
}
