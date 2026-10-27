package io.freetv.core;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Installs FreeTV on a Samsung TV (Tizen, 2017 or newer) in Developer Mode: the same steps as the computer program
 * (connector/src/samsung.js), keep them in step:
 *   1. connect (SDB, port 26101: the TV must have this phone's IP as "Host PC IP"),
 *   2. the certificate: before 2023 (Tizen 3 to 6.5) FreeTV's Tizen certificate from the bundle; 2023 and newer (Tizen 7+)
 *      a Samsung certificate for this TV made with the person's Samsung account (SamsungCert), kept for the next time,
 *   3. FreeTV with this person's settings, signed, 4. installed (vd_appinstall), 5. TizenBrew if asked, 6. opened.
 */
public final class Samsung {
    private Samsung() {}

    public static int infoPort = 8001;
    public static String tizenbrewRelease = "https://api.github.com/repos/reisxd/TizenBrew/releases/latest";

    static final String[][] STEPS = {
        {"connect", "Conectar con la tele"},
        {"cert", "Preparar el certificado"},
        {"build", "Preparar FreeTV con tus ajustes"},
        {"install", "Instalar en la tele"},
        {"tizenbrew", "Instalar TizenBrew (YouTube y Twitch sin anuncios)"},
        {"open", "Abrir FreeTV en la tele"},
    };

    public static Installer.Job newJob(String ip, boolean tizenbrew) {
        Installer.Job job = new Installer.Job(ip, "samsung", STEPS);
        if (!tizenbrew) job.step("tizenbrew").title = "TizenBrew (no pedido)";
        return job;
    }

    /** This phone's address on the TV's network: what the TV must have as Host PC IP. */
    public static String hostIpFor(String ip) {
        try (DatagramSocket s = new DatagramSocket()) {
            s.connect(InetAddress.getByName(ip), Sdb.port);
            InetAddress a = s.getLocalAddress();
            return a == null || a.isAnyLocalAddress() ? "" : a.getHostAddress();
        } catch (Exception e) { return ""; }
    }

    static String get(String url, int ms) throws IOException {
        return new String(getBytes(url, ms), StandardCharsets.UTF_8);
    }
    static byte[] getBytes(String url, int ms) throws IOException {
        for (int hops = 0; hops < 6; hops++) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(ms);
            c.setReadTimeout(Math.max(ms, 30000));
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("User-Agent", "FreeTV");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) { url = new URL(new URL(url), c.getHeaderField("Location")).toString(); continue; }
            if (code != 200) throw new IOException("HTTP " + code);
            try (InputStream in = c.getInputStream()) { return Tizen.readAll(in); }
        }
        throw new IOException("too many redirects");
    }

    /** The TV's own description (port 8001), or null. */
    static JSONObject tvInfo(String ip) {
        try {
            JSONObject j = new JSONObject(get("http://" + ip + ":" + infoPort + "/api/v2/", 3000));
            JSONObject d = j.optJSONObject("device") == null ? new JSONObject() : j.getJSONObject("device");
            return new JSONObject().put("name", d.optString("name", j.optString("name", ""))).put("model", d.optString("modelName", ""))
                    .put("developerMode", "1".equals(d.optString("developerMode"))).put("developerIP", d.optString("developerIP", ""));
        } catch (Exception e) { return null; }
    }

    static double version(Map<String, String> caps) {
        try { return Double.parseDouble(caps.getOrDefault("platform_version", "0")); } catch (Exception e) { return 0; }
    }

    static final Pattern DUID = Pattern.compile("\\S{8,}\\s*$");
    static String duid(Sdb sdb) throws IOException {
        String[] parts = sdb.shell("0 getduid", DUID, 8000).trim().split("\\s+");
        return parts.length == 0 ? "" : parts[parts.length - 1];
    }

    /** Whether the TV lets this phone connect, its Tizen version, and whether a Samsung sign-in is still needed. */
    public static JSONObject inspect(String ip) {
        JSONObject r = new JSONObject().put("ip", ip).put("brand", "samsung").put("hostIp", hostIpFor(ip));
        JSONObject info = tvInfo(ip);
        r.put("info", info == null ? JSONObject.NULL : info);
        if (info != null && !info.optString("name").isEmpty()) r.put("name", info.getString("name").replaceFirst("^\\[TV\\]\\s*", ""));
        try (Sdb sdb = Sdb.connect(ip, 5000)) {
            Map<String, String> caps = sdb.capabilities();
            double v = version(caps);
            boolean need = false;
            if (v >= 7) { String d = duid(sdb); need = d.isEmpty() || SamsungCert.load(d) == null; }
            return r.put("reachable", true).put("tizen", caps.getOrDefault("platform_version", "")).put("needsSamsungLogin", need);
        } catch (Exception e) {
            return r.put("reachable", false);
        }
    }

    static final Pattern DONE = Pattern.compile("spend time|install completed|failed", Pattern.CASE_INSENSITIVE);
    static boolean installed(String out) { return Pattern.compile("install completed", Pattern.CASE_INSENSITIVE).matcher(out).find(); }
    static boolean otherCert(String out) {
        return Pattern.compile("different certificate|certificate.*(mismatch|differ)|author.*(mismatch|differ)", Pattern.CASE_INSENSITIVE).matcher(out).find();
    }

    interface Maker { byte[] make() throws Exception; }

    static String installWgt(Sdb sdb, Installer.Job job, String toolPath, String pkg, byte[] data, String label) throws IOException {
        String remote = toolPath + "/" + pkg + ".wgt";
        job.say("Enviando " + label + " (" + Math.round(data.length / 1024.0) + " KB)…");
        sdb.push(remote, data);
        String out = sdb.shell("0 vd_appinstall " + pkg + " " + remote, DONE, 180000);
        List<String> lines = new ArrayList<>();
        for (String l : out.split("\r?\n")) if (!l.trim().isEmpty()) lines.add(l.trim());
        for (String l : lines.subList(Math.max(0, lines.size() - 6), lines.size())) job.say("  " + l);
        return out;
    }

    /** Installs; when the TV has the app signed with another certificate, removes it and installs again. */
    static String installOrReplace(Sdb sdb, Installer.Job job, String toolPath, String pkg, Maker maker, String label) throws Exception {
        String out = installWgt(sdb, job, toolPath, pkg, maker.make(), label);
        if (installed(out)) return out;
        if (otherCert(out)) {
            job.say(label + " ya estaba en la tele con otra firma: lo quito y lo vuelvo a instalar.");
            String un = sdb.shell("0 vd_appuninstall " + pkg, Pattern.compile("spend time|uninstall completed|failed", Pattern.CASE_INSENSITIVE), 120000);
            if (!un.toLowerCase().contains("uninstall completed")) {
                throw new Problem("replace", "En la tele ya hay un " + label + " firmado con otro certificado y no me deja quitarlo. "
                        + "Quítalo en la tele (Apps, mantén pulsado " + label + ", Eliminar) y vuelve a intentarlo.");
            }
            out = installWgt(sdb, job, toolPath, pkg, maker.make(), label);
        }
        return out;
    }

    /** Runs the whole install. Never throws: the outcome is in job. */
    public static void run(Installer.Job job, Installer.Bundle bundle, JSONObject settings) {
        Installer.Step current = null;
        Sdb sdb = null;
        try {
            if (bundle.samsungWgt == null || bundle.samsungCerts == null) throw new Problem("bundle", "Esta app no trae FreeTV para Samsung: descárgala otra vez.");
            JSONObject certs = bundle.samsungCerts;

            current = begin(job, "connect");
            try { sdb = Sdb.connect(job.ip, 8000); } catch (IOException e) {
                String host = hostIpFor(job.ip);
                throw new Problem("sdb", "La tele no deja conectar. En la tele: abre Apps, escribe 1 2 3 4 5 con el mando, pon Developer mode en On "
                        + "y en Host PC IP escribe " + (host.isEmpty() ? "la IP de este aparato" : host) + ". Luego apaga la tele del todo y vuelve a encenderla.");
            }
            Map<String, String> caps = sdb.capabilities();
            double v = version(caps);
            String toolPath = caps.getOrDefault("sdk_toolpath", "/home/owner/share/tmp/sdk_tools").replaceAll("/+$", "");
            String tizen = caps.getOrDefault("platform_version", "?");
            job.say("Tizen " + tizen + (sdb.banner.isEmpty() ? "" : " · " + sdb.banner));
            end(job, current, "Tizen " + tizen);

            current = begin(job, "cert");
            List<JSONObject[]> signers = new ArrayList<>();
            if (v >= 7) {
                String d = duid(sdb);
                if (d.isEmpty()) throw new Problem("duid", "La tele no dijo su identificador (DUID). Apágala, enciéndela y vuelve a intentarlo.");
                JSONObject c = SamsungCert.load(d);
                if (c == null) {
                    SamsungCert.Access a = SamsungCert.takeAccess();
                    if (a == null) throw new Problem("samsung-login", "Esta tele (2023 o más nueva) pide un certificado de Samsung: inicia sesión con tu cuenta Samsung y vuelve a pulsar Instalar.");
                    job.say("Pidiendo a Samsung el certificado para esta tele…");
                    c = SamsungCert.create(a, d, certs.getJSONObject("cas"));
                    SamsungCert.save(d, c);
                }
                if (!c.optString("profile").isEmpty()) sdb.push(toolPath + "/device-profile.xml", c.getString("profile").getBytes(StandardCharsets.UTF_8));
                signers.add(new JSONObject[] {c.getJSONObject("author"), c.getJSONObject("distributor")});
                end(job, current, "certificado de Samsung");
            } else {
                JSONObject t = certs.getJSONObject("tizen");
                JSONObject newer = t.optJSONObject("distributorNew"), older = t.optJSONObject("distributor");
                signers.add(new JSONObject[] {t.getJSONObject("author"), newer != null ? newer : older});
                if (newer != null && older != null) signers.add(new JSONObject[] {t.getJSONObject("author"), older});
                end(job, current, "certificado de Tizen");
            }

            current = begin(job, "build");
            final Map<String, String> ids = Tizen.appIds(bundle.samsungWgt);
            JSONObject config = Installer.makeConfig(bundle.info.getJSONObject("config"), settings);
            final Map<String, byte[]> changes = Collections.singletonMap("config.js",
                    ("/* Generated by FreeTV Conector. */\nwindow.CONFIG = " + config.toString() + ";\n").getBytes(StandardCharsets.UTF_8));
            end(job, current, ids.get("version").isEmpty() ? "" : "v" + ids.get("version"));

            current = begin(job, "install");
            String out = "";
            JSONObject[] used = signers.get(0);
            for (final JSONObject[] s : signers) {
                used = s;
                out = installOrReplace(sdb, job, toolPath, ids.get("package"), () -> Tizen.sign(bundle.samsungWgt, s[0], s[1], changes), "FreeTV");
                if (installed(out)) break;
            }
            if (!installed(out)) {
                String[] lines = out.trim().split("\r?\n");
                String said = lines.length == 0 ? "" : lines[lines.length - 1].trim();
                throw new Problem("install", "La tele no pudo instalar FreeTV" + (said.isEmpty() ? "." : ": " + said)
                        + (said.toLowerCase().matches(".*(space|storage).*") ? " Libera espacio borrando apps que no uses." : ""));
            }
            end(job, current, null);

            current = begin(job, "tizenbrew");
            if (settings.optBoolean("tizenbrew", false)) {
                try {
                    JSONObject release = new JSONObject(get(tizenbrewRelease, 15000));
                    JSONArray assets = release.optJSONArray("assets") == null ? new JSONArray() : release.getJSONArray("assets");
                    JSONObject pick = null, old = null;
                    for (int i = 0; i < assets.length(); i++) {
                        JSONObject a = assets.getJSONObject(i);
                        String n = a.optString("name");
                        if (!n.toLowerCase().endsWith(".wgt")) continue;
                        if (n.equalsIgnoreCase("TizenBrewStandalone.wgt")) pick = a;
                        else if (n.toLowerCase().contains("old")) old = a;
                        else if (pick == null) pick = a;
                    }
                    if (pick == null) pick = old;
                    if (pick == null) throw new IOException("no package in the release");
                    final byte[] tb = getBytes(pick.getString("browser_download_url"), 20000);
                    String tbPkg = Tizen.appIds(tb).get("package");
                    final JSONObject[] u = used;
                    final boolean resign = v >= 7;
                    String res = installOrReplace(sdb, job, toolPath, tbPkg, () -> resign ? Tizen.sign(tb, u[0], u[1], null) : tb, "TizenBrew");
                    if (!installed(res) && !resign && old != null && old != pick) {
                        final byte[] tbOld = getBytes(old.getString("browser_download_url"), 20000);
                        res = installOrReplace(sdb, job, toolPath, tbPkg, () -> tbOld, "TizenBrew");
                    }
                    if (!installed(res)) throw new IOException("the TV did not install it");
                    end(job, current, release.optString("tag_name", ""));
                } catch (Exception e) {
                    current.state = "failed";
                    current.note = "no se pudo";
                    job.say("TizenBrew no se pudo instalar (" + e.getMessage() + "). FreeTV sí está instalado; puedes instalar TizenBrew más tarde con TizenBrew Installer.");
                }
            } else {
                current.state = "skipped";
            }
            current = null;

            current = begin(job, "open");
            String opened = sdb.shell("0 was_execute " + ids.get("id"), Pattern.compile("launch|spend time|fail", Pattern.CASE_INSENSITIVE), 20000);
            end(job, current, opened.toLowerCase().contains("fail") ? "ábrela tú desde Apps" : null);
            current = null;
            job.state = "done";
            job.say("¡Listo! FreeTV está en Apps de la tele.");
        } catch (Exception e) {
            if (current != null) current.state = "failed";
            job.errorCode = e instanceof Problem ? ((Problem) e).code : "error";
            job.errorMessage = e instanceof Problem ? e.getMessage() : "Algo falló: " + e;
            job.say("✗ " + job.errorMessage);
            job.state = "failed";
        } finally {
            if (sdb != null) sdb.close();
        }
    }

    static Installer.Step begin(Installer.Job job, String id) {
        Installer.Step s = job.step(id);
        s.state = "running";
        job.say("▸ " + s.title);
        return s;
    }
    static void end(Installer.Job job, Installer.Step s, String note) {
        s.state = "done";
        if (note != null && !note.isEmpty()) s.note = note;
    }
}
