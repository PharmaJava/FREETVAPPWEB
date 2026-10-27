package io.freetv.core;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Samsung certificates for Samsung TVs of 2023 and newer (Tizen 7+), as the computer program does (connector/src/samsung-cert.js):
 *   1. the person signs in to their Samsung account in the phone's browser (Samsung's own page); Samsung sends the browser back
 *      to http://localhost:4794/signin/callback with a token, which this app receives (it never sees the password),
 *   2. two keys are made here and Samsung's certificate service signs them (author, and distributor for this TV's DUID),
 *   3. the TV gets the device profile, and the certificates are kept in the app, so an update uses the same ones.
 * Written after Samsung's webIDE-common-tizentv (Apache License 2.0), see NOTICE.md.
 */
public final class SamsungCert {
    private SamsungCert() {}

    public static int loginPort = 4794;
    public static String service = "https://svdca.samsungqbe.com";
    /** Where certificates are kept (the app sets its own folder). */
    public static File dir = new File(System.getProperty("java.io.tmpdir"), "freetv");

    public static String loginUrl() {
        return "https://account.samsung.com/mobile/account/check.do?serviceID=v285zxnl3h&actionID=StartOAuth2&accessToken=Y"
                + "&redirect_uri=http%3A%2F%2Flocalhost%3A" + loginPort + "%2Fsignin%2Fcallback";
    }

    /* ---------- 1. the Samsung account sign-in ---------- */

    public static final class Access { public final String token, userId, email; Access(String t, String u, String e) { token = t; userId = u; email = e; } }

    private static final Object LOCK = new Object();
    private static String loginState = "none";   // none | waiting | done | failed
    private static Access access;
    private static final List<ServerSocket> servers = new ArrayList<>();

    static String page(boolean ok) {
        return "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>FreeTV</title>"
                + "<body style=\"font:18px system-ui,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;text-align:center\">"
                + (ok ? "<h1>✓</h1><p><b>Listo.</b> Vuelve a la app FreeTV: sigue sola.</p><p><b>Done.</b> Go back to the FreeTV app: it carries on by itself.</p>"
                      : "<h1>✗</h1><p>Samsung no devolvió la sesión. Vuelve a FreeTV e inténtalo otra vez.</p><p>Samsung did not send the sign-in back. Go back to FreeTV and try again.</p>");
    }

    /** What Samsung sends back: a form whose "code" is JSON {access_token, userId, inputEmailID}. */
    static Access readAccess(String body) throws Exception {
        Map<String, String> form = new LinkedHashMap<>();
        for (String pair : body.split("&")) {
            int i = pair.indexOf('=');
            if (i > 0) form.put(URLDecoder.decode(pair.substring(0, i), "UTF-8"), URLDecoder.decode(pair.substring(i + 1), "UTF-8"));
        }
        JSONObject data = new JSONObject();
        try { if (form.containsKey("code")) data = new JSONObject(form.get("code")); } catch (Exception e) { data = new JSONObject(); }
        for (String k : new String[] {"access_token", "userId", "inputEmailID"}) if (!data.has(k) && form.containsKey(k)) data.put(k, form.get(k));
        if (data.optString("access_token").isEmpty() || data.optString("userId").isEmpty()) return null;
        return new Access(data.getString("access_token"), data.getString("userId"), data.optString("inputEmailID", ""));
    }

    private static void serve(Socket s) {
        try (Socket c = s) {
            c.setSoTimeout(15000);
            InputStream in = c.getInputStream();
            ByteArrayOutputStream head = new ByteArrayOutputStream();
            int b, last4 = 0;
            while ((b = in.read()) >= 0) { head.write(b); last4 = (last4 << 8) | b; if (last4 == 0x0d0a0d0a || head.size() > 32768) break; }
            String h = new String(head.toByteArray(), StandardCharsets.ISO_8859_1);
            boolean post = h.startsWith("POST ");
            int len = 0;
            for (String line : h.split("\r\n")) if (line.toLowerCase().startsWith("content-length:")) len = Math.min(200000, Integer.parseInt(line.substring(15).trim()));
            byte[] body = new byte[len];
            int got = 0;
            while (got < len) { int n = in.read(body, got, len - got); if (n < 0) break; got += n; }
            boolean ok;
            synchronized (LOCK) {
                if (post) {
                    Access a = readAccess(new String(body, 0, got, StandardCharsets.UTF_8));
                    if (a != null) { access = a; loginState = "done"; } else if (!"done".equals(loginState)) loginState = "failed";
                }
                ok = "done".equals(loginState);
            }
            byte[] out = page(ok).getBytes(StandardCharsets.UTF_8);
            OutputStream o = c.getOutputStream();
            o.write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " + out.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
            o.write(out);
            o.flush();
        } catch (Exception e) { /* a broken request: ignore it */ }
    }

    /** Starts waiting for the sign-in; returns the address to open in the browser. */
    public static String startLogin() {
        synchronized (LOCK) {
            stopServers();
            loginState = "waiting";
            access = null;
            for (String host : new String[] {"127.0.0.1", "::1"}) {
                try {
                    final ServerSocket ss = new ServerSocket(loginPort, 10, InetAddress.getByName(host));
                    servers.add(ss);
                    Thread t = new Thread(() -> {
                        while (!ss.isClosed()) {
                            try { final Socket c = ss.accept(); new Thread(() -> serve(c), "freetv-login-client").start(); } catch (IOException e) { break; }
                        }
                    }, "freetv-login");
                    t.setDaemon(true);
                    t.start();
                } catch (IOException e) {
                    if ("127.0.0.1".equals(host)) loginState = "failed";
                }
            }
        }
        return loginUrl();
    }
    private static void stopServers() { for (ServerSocket s : servers) try { s.close(); } catch (IOException e) { /* closed */ } servers.clear(); }
    public static String loginState() { synchronized (LOCK) { return loginState; } }
    /** The sign-in, once: it is used for one certificate. */
    static Access takeAccess() {
        synchronized (LOCK) {
            if (!"done".equals(loginState)) return null;
            Access a = access;
            stopServers();
            return a;
        }
    }

    /* ---------- 2. the certificates ---------- */

    static String post(String path, Map<String, String> fields, String csr, String name) throws Exception {
        String boundary = "----freetv" + Long.toHexString(new SecureRandom().nextLong());
        StringBuilder b = new StringBuilder();
        for (Map.Entry<String, String> f : fields.entrySet()) {
            b.append("--").append(boundary).append("\r\nContent-Disposition: form-data; name=\"").append(f.getKey()).append("\"\r\n\r\n")
                    .append(f.getValue()).append("\r\n");
        }
        b.append("--").append(boundary).append("\r\nContent-Disposition: form-data; name=\"csr\"; filename=\"").append(name)
                .append("\"\r\nContent-Type: application/octet-stream\r\n\r\n").append(csr).append("\r\n--").append(boundary).append("--\r\n");
        byte[] body = b.toString().getBytes(StandardCharsets.UTF_8);
        HttpURLConnection c;
        try {
            c = (HttpURLConnection) new URL(service + path).openConnection();
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setConnectTimeout(20000);
            c.setReadTimeout(60000);
            c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
            c.setFixedLengthStreamingMode(body.length);
            try (OutputStream o = c.getOutputStream()) { o.write(body); }
        } catch (IOException e) {
            throw new Problem("samsung-cert", "No pude hablar con el servicio de certificados de Samsung (" + e.getMessage() + "). ¿Hay internet?");
        }
        int code = c.getResponseCode();
        InputStream in = code == 200 ? c.getInputStream() : c.getErrorStream();
        String text = in == null ? "" : new String(Tizen.readAll(in), StandardCharsets.UTF_8);
        if (code != 200) throw new Problem("samsung-cert", "Samsung no firmó el certificado (" + code + "): " + text.substring(0, Math.min(200, text.length())));
        return text;
    }

    static String pkcs8(KeyPair k) { return Der.pem("PRIVATE KEY", k.getPrivate().getEncoded()); }

    /** This TV's certificates with the person's sign-in. cas: {author, partner} PEM (Samsung's CAs, in the bundle). */
    static JSONObject create(Access a, String duid, JSONObject cas) throws Exception {
        KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
        g.initialize(2048);
        KeyPair author = g.generateKeyPair(), dist = g.generateKeyPair();
        String authorCsr = Der.csr(author, "FreeTV", null, null);
        String distCsr = Der.csr(dist, "TizenSDK", a.email.isEmpty() ? "freetv@localhost" : a.email,
                new String[] {"URN:tizen:packageid=", "URN:tizen:deviceid=" + duid});
        Map<String, String> base = new LinkedHashMap<>();
        base.put("access_token", a.token);
        base.put("user_id", a.userId);
        base.put("platform", "VD");
        String authorCert = post("/apis/v3/authors", base, authorCsr, "author.csr");
        Map<String, String> distFields = new LinkedHashMap<>(base);
        distFields.put("privilege_level", "Partner");
        distFields.put("developer_type", "Individual");
        // Samsung answers this one twice: the TV's device profile (XML) and the certificate, as its tools ask for them.
        String first = post("/apis/v3/distributors", distFields, distCsr, "distributor.csr");
        String second = post("/apis/v3/distributors", distFields, distCsr, "distributor.csr");
        boolean firstCert = first.contains("BEGIN CERTIFICATE"), secondCert = second.contains("BEGIN CERTIFICATE");
        String distCert = secondCert ? second : firstCert ? first : null;
        String profile = firstCert ? second : first;
        if (!authorCert.contains("BEGIN CERTIFICATE") || distCert == null) throw new Problem("samsung-cert", "Samsung no devolvió los certificados esperados.");
        return new JSONObject().put("duid", duid)
                .put("author", new JSONObject().put("key", pkcs8(author)).put("chain", new JSONArray().put(Der.unpemB64(authorCert)).put(Der.unpemB64(cas.getString("author")))))
                .put("distributor", new JSONObject().put("key", pkcs8(dist)).put("chain", new JSONArray().put(Der.unpemB64(distCert)).put(Der.unpemB64(cas.getString("partner")))))
                .put("profile", profile);
    }

    static File fileFor(String duid) { return new File(dir, "samsung-" + duid.replaceAll("[^A-Za-z0-9_-]", "") + ".json"); }

    static JSONObject load(String duid) {
        try {
            JSONObject c = new JSONObject(new String(Files.readAllBytes(fileFor(duid).toPath()), StandardCharsets.UTF_8));
            return c.has("author") && c.has("distributor") ? c : null;
        } catch (Exception e) { return null; }
    }

    static void save(String duid, JSONObject cert) throws IOException {
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("cannot create " + dir);
        Files.write(fileFor(duid).toPath(), cert.toString().getBytes(StandardCharsets.UTF_8));
    }

    static byte[] b64(String s) { return Base64.getDecoder().decode(s); }
}
