package io.freetv.core;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Tizen web app packages (.wgt): read them, and sign them as Samsung's tools do — an author signature (author-signature.xml)
 * over every file, then a distributor signature (signature1.xml) over every file plus the author signature, each an XML
 * signature with SHA-256 digests, RSA-SHA256 and the certificate chain. The same as connector/src/tizen-sign.js, written after
 * Samsung's webIDE-common-tizentv (Apache License 2.0), see NOTICE.md.
 *
 * A certificate here is JSON {key: PEM private key (PKCS#8), chain: [base64 DER, ...]}, the signer's certificate first.
 */
public final class Tizen {
    private Tizen() {}

    static final Pattern SIGNATURE_FILE = Pattern.compile("^(author-signature|signature\\d+)\\.xml$");
    private static final String AUTHOR_PROP = "lpo8tUDs054eLlBQXiDPVDVKfw30ZZdtkRs1jd7H5K8=";
    private static final String DISTRIBUTOR_PROP = "u/jU3U4Zm5ihTMSjKGlGYbWzDfRkGphPPHx3gJIYEJ4=";

    /** A package's files, in order (folders left out). */
    public static Map<String, byte[]> read(byte[] wgt) throws IOException {
        Map<String, byte[]> files = new LinkedHashMap<>();
        try (ZipInputStream z = new ZipInputStream(new ByteArrayInputStream(wgt))) {
            ZipEntry e;
            while ((e = z.getNextEntry()) != null) {
                if (e.isDirectory()) continue;
                files.put(e.getName(), readAll(z));
            }
        }
        return files;
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
        return o.toByteArray();
    }

    public static byte[] write(Map<String, byte[]> files) throws IOException {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        try (ZipOutputStream z = new ZipOutputStream(o)) {
            z.setLevel(9);
            for (Map.Entry<String, byte[]> f : files.entrySet()) {
                ZipEntry e = new ZipEntry(f.getKey());
                e.setTime(1704067200000L);   // a fixed date: the same files make the same package
                z.putNextEntry(e);
                z.write(f.getValue());
                z.closeEntry();
            }
        }
        return o.toByteArray();
    }

    static String sha256(byte[] data) throws Exception {
        return Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(data));
    }

    private static String reference(String uri, String digest, boolean prop) {
        return "<Reference URI=\"" + uri + "\">\n"
                + (prop ? "<Transforms>\n<Transform Algorithm=\"http://www.w3.org/2006/12/xml-c14n11\"></Transform>\n</Transforms>\n" : "")
                + "<DigestMethod Algorithm=\"http://www.w3.org/2001/04/xmlenc#sha256\"></DigestMethod>\n"
                + "<DigestValue>" + digest + "</DigestValue>\n"
                + "</Reference>\n";
    }

    /** encodeURIComponent, as JavaScript does it (URLEncoder writes spaces as + and encodes a few more). */
    static String uriComponent(String s) throws Exception {
        return URLEncoder.encode(s, "UTF-8").replace("+", "%20").replace("%21", "!").replace("%27", "'")
                .replace("%28", "(").replace("%29", ")").replace("%7E", "~");
    }

    static PrivateKey privateKey(String pem) throws Exception {
        if (pem.contains("BEGIN RSA PRIVATE KEY")) throw new IllegalArgumentException("PKCS#8 keys only");
        byte[] der = Base64.getDecoder().decode(pem.replaceAll("-----[^-]+-----", "").replaceAll("\\s+", ""));
        return KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der));
    }

    /** One signature file's text over these files. */
    static String signature(String id, Map<String, byte[]> files, JSONObject cert) throws Exception {
        List<String> names = new ArrayList<>();
        for (String name : files.keySet()) {
            boolean hidden = false;
            for (String part : name.split("/")) if (part.startsWith(".")) hidden = true;
            if (!hidden) names.add(name);
        }
        Collections.sort(names);
        StringBuilder refs = new StringBuilder();
        for (String name : names) refs.append(reference(uriComponent(name), sha256(files.get(name)), false));
        refs.append(reference("#prop", "AuthorSignature".equals(id) ? AUTHOR_PROP : DISTRIBUTOR_PROP, true));
        String signedInfo = "<SignedInfo>\n"
                + "<CanonicalizationMethod Algorithm=\"http://www.w3.org/2001/10/xml-exc-c14n#\"></CanonicalizationMethod>\n"
                + "<SignatureMethod Algorithm=\"http://www.w3.org/2001/04/xmldsig-more#rsa-sha256\"></SignatureMethod>\n"
                + refs + "</SignedInfo>\n";
        // Exclusive canonical form of SignedInfo: the same text, with the namespace it inherits written on it.
        String canonical = signedInfo.replace("<SignedInfo>", "<SignedInfo xmlns=\"http://www.w3.org/2000/09/xmldsig#\">");
        Signature sig = Signature.getInstance("SHA256withRSA");
        sig.initSign(privateKey(cert.getString("key")));
        sig.update(canonical.getBytes(StandardCharsets.UTF_8));
        String value = Base64.getEncoder().encodeToString(sig.sign());
        String role = "AuthorSignature".equals(id) ? "author" : "distributor";
        StringBuilder chain = new StringBuilder();
        JSONArray c = cert.getJSONArray("chain");
        for (int i = 0; i < c.length(); i++) chain.append("<X509Certificate>").append(c.getString(i)).append("</X509Certificate>\n");
        return "<Signature xmlns=\"http://www.w3.org/2000/09/xmldsig#\" Id=\"" + id + "\">\n" + signedInfo
                + "<SignatureValue>" + value + "</SignatureValue>"
                + "<KeyInfo><X509Data>\n" + chain + "</X509Data>\n</KeyInfo>\n"
                + "<Object Id=\"prop\"><SignatureProperties xmlns:dsp=\"http://www.w3.org/2009/xmldsig-properties\"><SignatureProperty Id=\"profile\" Target=\"#" + id
                + "\"><dsp:Profile URI=\"http://www.w3.org/ns/widgets-digsig#profile\"></dsp:Profile></SignatureProperty><SignatureProperty Id=\"role\" Target=\"#" + id
                + "\"><dsp:Role URI=\"http://www.w3.org/ns/widgets-digsig#role-" + role + "\"></dsp:Role></SignatureProperty><SignatureProperty Id=\"identifier\" Target=\"#" + id
                + "\"><dsp:Identifier></dsp:Identifier></SignatureProperty></SignatureProperties></Object>\n"
                + "</Signature>\n";
    }

    /** A .wgt signed with these certificates, with some files replaced or added first (changes may be null). */
    public static byte[] sign(byte[] wgt, JSONObject author, JSONObject distributor, Map<String, byte[]> changes) throws Exception {
        Map<String, byte[]> files = new LinkedHashMap<>();
        for (Map.Entry<String, byte[]> f : read(wgt).entrySet()) if (!SIGNATURE_FILE.matcher(f.getKey()).matches()) files.put(f.getKey(), f.getValue());
        if (changes != null) files.putAll(changes);
        files.put("author-signature.xml", signature("AuthorSignature", files, author).getBytes(StandardCharsets.UTF_8));
        files.put("signature1.xml", signature("DistributorSignature", files, distributor).getBytes(StandardCharsets.UTF_8));
        return write(files);
    }

    /** {id, package, version} from the package's config.xml. */
    public static Map<String, String> appIds(byte[] wgt) throws IOException {
        byte[] config = read(wgt).get("config.xml");
        if (config == null) throw new IOException("the package has no config.xml");
        String xml = new String(config, StandardCharsets.UTF_8);
        Map<String, String> ids = new LinkedHashMap<>();
        Matcher tag = Pattern.compile("<tizen:application[^>]*>").matcher(xml);
        String t = tag.find() ? tag.group() : "";
        Matcher m = Pattern.compile("\\bid=\"([^\"]+)\"").matcher(t);
        ids.put("id", m.find() ? m.group(1) : "");
        m = Pattern.compile("\\bpackage=\"([^\"]+)\"").matcher(t);
        ids.put("package", m.find() ? m.group(1) : "");
        m = Pattern.compile("<widget [^>]*version=\"([^\"]+)\"").matcher(xml);
        ids.put("version", m.find() ? m.group(1) : "");
        return ids;
    }
}
