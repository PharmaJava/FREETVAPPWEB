package io.freetv.core;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Installs FreeTV on an LG webOS TV, step by step, as FreeTV's install.sh does (and the Home helper's install.sh after it):
 *   1. the Developer Mode key from the TV's Key Server, unlocked with the passphrase,
 *   2. the Developer Mode SSH session,
 *   3. the TV's apps and inputs (the TV shows a pairing prompt),
 *   4. FreeTV's package with this person's settings and those apps,
 *   5. both packages installed (Home helper first),
 *   6. the helper configured (pairing key, apps, early input) and started,
 *   7. only if the person said yes: the store service's key, so the TV can install community apps by itself.
 * The same steps as the computer Conector (connector/src/lg.js): keep them in step.
 */
public final class Installer {
    private Installer() {}

    static final String TEMP = "/media/developer/temp";
    static final String NATIVE_STATE = "/media/developer/apps/usr/palm/applications/com.local.nativehome/state";
    static final String STORE_STATE = "/media/developer/apps/usr/palm/services/com.gathin.tvhome.store/state";
    static final List<String> SKIP_APPS = Arrays.asList("com.gathin.tvhome", "com.local.nativehome", "com.webos.app.home");
    static final List<String> SERVICES = Arrays.asList("netflix", "prime", "disney", "hulu", "paramount", "peacock", "globoplay",
            "max", "appletv", "hotstar", "crunchyroll");

    public interface Log { void say(String text); }

    /** FreeTV's package and the defaults it was built with. */
    public static final class Bundle {
        public final JSONObject info;
        public final byte[] launcher;
        public final byte[] nativeHome;
        public Bundle(JSONObject info, byte[] launcher, byte[] nativeHome) { this.info = info; this.launcher = launcher; this.nativeHome = nativeHome; }
    }

    private static String num(Object v, double min, double max) {
        double n;
        try { n = v instanceof Number ? ((Number) v).doubleValue() : Double.parseDouble(String.valueOf(v)); } catch (Exception e) { return null; }
        if (Double.isNaN(n) || Double.isInfinite(n) || n < min || n > max) return null;
        double r = Math.round(n * 10000) / 10000.0;
        return r == Math.rint(r) ? String.valueOf((long) r) : String.valueOf(r);
    }

    /** FreeTV's settings (window.CONFIG) from the defaults and what the person chose, checked one by one. */
    public static JSONObject makeConfig(JSONObject defaults, JSONObject s) {
        JSONObject c = new JSONObject(defaults.toString());
        if (s == null) s = new JSONObject();
        String lat = num(s.opt("latitude"), -90, 90), lon = num(s.opt("longitude"), -180, 180);
        if (s.has("latitude") && s.has("longitude") && lat != null && lon != null) { c.put("latitude", lat); c.put("longitude", lon); }
        Object city = s.opt("city");
        if (city instanceof String) {
            String v = ((String) city).replaceAll("[<>]", "").trim();
            c.put("city", v.length() > 40 ? v.substring(0, 40) : v);
        }
        if (s.optString("country", "").matches("[A-Z]{2}")) c.put("tmdbRegion", s.getString("country"));
        Object key = s.opt("tmdbKey");
        if (key instanceof String && ((String) key).trim().matches("[A-Za-z0-9._-]{0,400}")) c.put("tmdbKey", ((String) key).trim());
        if (Arrays.asList("auto", "es", "en", "pt", "de", "ru").contains(s.optString("language"))) c.put("language", s.getString("language"));
        if (Arrays.asList("C", "F", "auto").contains(s.optString("temperature"))) c.put("temperature", s.getString("temperature"));
        if (s.optString("currency", "").matches("[A-Z]{3}")) c.put("currency", s.getString("currency"));
        if (s.opt("showCrypto") instanceof Boolean) c.put("showCrypto", s.getBoolean("showCrypto"));
        if (s.opt("hideAnimation") instanceof Boolean) c.put("hideAnimation", s.getBoolean("hideAnimation"));
        JSONArray hide = s.optJSONArray("hideServices");
        if (hide != null) {
            JSONArray ok = new JSONArray();
            for (int i = 0; i < hide.length(); i++) if (SERVICES.contains(hide.optString(i))) ok.put(hide.getString(i));
            c.put("hideServices", ok);
        }
        return c;
    }

    public static final class Step {
        final String id;
        String title, state = "pending", note = "";
        Step(String id, String title) { this.id = id; this.title = title; }
        JSONObject json() { return new JSONObject().put("id", id).put("title", title).put("state", state).put("note", note); }
    }

    public static final class Job implements Log {
        public final String id;
        public final String ip;
        public volatile String state = "running";   // running | done | failed
        final List<Step> steps = new ArrayList<>();
        volatile boolean prompt = false;
        final List<String> log = new ArrayList<>();
        volatile String errorCode, errorMessage;

        public Job(String ip, boolean store) {
            byte[] r = new byte[6];
            new SecureRandom().nextBytes(r);
            StringBuilder sb = new StringBuilder();
            for (byte b : r) sb.append(String.format("%02x", b));
            this.id = sb.toString();
            this.ip = ip;
            steps.add(new Step("key", "Recoger la llave del Modo Desarrollador"));
            steps.add(new Step("ssh", "Conectar con la tele"));
            steps.add(new Step("apps", "Leer las apps de la tele (acepta el aviso en la tele)"));
            steps.add(new Step("build", "Preparar FreeTV con tus ajustes"));
            steps.add(new Step("install", "Instalar en la tele"));
            steps.add(new Step("configure", "Activar el botón Home"));
            steps.add(new Step("store", store ? "Tienda de apps en la tele" : "Tienda de apps en la tele (no activada)"));
        }

        public Step step(String id) { for (Step s : steps) if (s.id.equals(id)) return s; return null; }

        @Override public synchronized void say(String text) { log.add(text); if (log.size() > 300) log.remove(0); }

        public synchronized JSONObject view() {
            JSONArray st = new JSONArray(), lg = new JSONArray();
            for (Step s : steps) st.put(s.json());
            for (String t : log.subList(Math.max(0, log.size() - 60), log.size())) lg.put(new JSONObject().put("text", t));
            JSONObject error = errorCode == null ? null : new JSONObject().put("code", errorCode).put("message", errorMessage);
            return new JSONObject().put("id", id).put("ip", ip).put("state", state).put("steps", st).put("prompt", prompt)
                    .put("log", lg).put("error", error == null ? JSONObject.NULL : error);
        }
    }

    static void installPackage(Ssh ssh, final Job job, String name, byte[] data) throws Exception {
        String file = TEMP + "/" + name;
        ssh.exec("/usr/bin/test -d " + TEMP + " || /bin/mkdir -p " + TEMP);
        job.say("Enviando " + name + " (" + Math.round(data.length / 1024.0) + " KB)…");
        ssh.put(file, data, "644");
        String payload = new JSONObject().put("id", "com.ares.defaultName").put("ipkUrl", file).put("subscribe", true).toString()
                .replace("\\/", "/");   // Android's JSON writes "/" as "\/", and a backslash cannot go inside the quotes
        final String[] result = {"", ""};   // state, failure
        final StringBuilder lines = new StringBuilder();
        ssh.exec("/usr/bin/luna-send-pub -i luna://com.webos.appInstallService/dev/install " + Ssh.q(payload), null, text -> {
            lines.append(text);
            int nl;
            while ((nl = lines.indexOf("\n")) >= 0) {
                String line = lines.substring(0, nl);
                lines.delete(0, nl + 1);
                JSONObject obj;
                try { obj = new JSONObject(line); } catch (Exception e) { continue; }
                JSONObject details = obj.optJSONObject("details");
                String s = details != null ? details.optString("state", "") : "";
                if (!s.isEmpty()) job.say("  " + s);
                if (s.matches("(?i).*FAILED.*")) { result[1] = details.optString("reason", s); return true; }
                if (s.matches("(?i)(.*installed.*|SUCCESS.*)")) { result[0] = s; return true; }
                if (obj.has("returnValue") && !obj.optBoolean("returnValue", true)) { result[1] = obj.optString("errorText", "la tele rechazó la instalación"); return true; }
            }
            return false;
        });
        ssh.exec("/bin/rm -f " + Ssh.q(file));
        if (result[0].isEmpty()) {
            String bad = result[1].isEmpty() ? "sin respuesta" : result[1];
            throw new Problem("install", "La tele no pudo instalar " + name + ": " + bad
                    + (bad.toLowerCase().contains("space") ? ". Libera espacio borrando apps que no uses." : ""));
        }
    }

    /** Runs the whole install. Never throws: the outcome is in the job. */
    public static void run(Job job, Bundle bundle, String passphrase, JSONObject settings) {
        Step current = null;
        Ssh ssh = null;
        Ssap ssap = null;
        boolean store = settings != null && settings.optBoolean("store", false);
        try {
            current = begin(job, "key");
            byte[] plainKey = Ssh.unlockKey(Ssh.fetchKey(job.ip), passphrase);
            current = end(current, null);

            current = begin(job, "ssh");
            ssh = Ssh.connect(job.ip, plainKey);
            if (!ssh.exec("echo FREETV_SSH_OK").out.contains("FREETV_SSH_OK")) throw new Problem("ssh", "La conexión con la tele no respondió.");
            current = end(current, null);

            current = begin(job, "apps");
            ssap = Ssap.pair(job.ip, null, () -> { job.prompt = true; job.say("La tele muestra un aviso: pulsa «Aceptar» con el mando."); });
            job.prompt = false;
            Ssap.Apps apps = ssap.readApps(job);
            String clientKey = ssap.key;
            ssap.close();
            ssap = null;
            JSONArray list = apps.tvApps.getJSONArray("apps");
            if (list.length() == 0) throw new Problem("apps", "La tele no devolvió ninguna app. Vuelve a intentarlo.");
            current = end(current, list.length() + " apps");

            current = begin(job, "build");
            JSONObject config = makeConfig(bundle.info.getJSONObject("config"), settings);
            Map<String, byte[]> files = new LinkedHashMap<>();
            files.put("config.js", ("/* Generated by FreeTV for Android. */\nwindow.CONFIG = " + config + ";\n").getBytes(StandardCharsets.UTF_8));
            files.put("apps.js", ("// Generated by FreeTV for Android: the TV's apps and inputs.\nwindow.TV_APPS = " + apps.tvApps.toString(1) + ";\n")
                    .getBytes(StandardCharsets.UTF_8));
            files.putAll(apps.icons);
            byte[] launcher = Ipk.withAppFiles(bundle.launcher, bundle.info.getJSONObject("launcher").getString("id"), files);
            current = end(current, null);

            current = begin(job, "install");
            installPackage(ssh, job, "com.local.nativehome.ipk", bundle.nativeHome);
            installPackage(ssh, job, "com.gathin.tvhome.ipk", launcher);
            ssh.exec("/usr/sbin/ls-control scan-services");
            current = end(current, null);

            current = begin(job, "configure");
            if (!ssh.exec("test -d " + NATIVE_STATE + " && echo yes").out.contains("yes")) {
                throw new Problem("configure", "El ayudante del botón Home no aparece instalado en la tele.");
            }
            ssh.put(NATIVE_STATE + "/ssap-key.json", new JSONObject().put("key", clientKey).toString().getBytes(StandardCharsets.UTF_8), "640");
            JSONArray ids = new JSONArray();
            for (int i = 0; i < list.length(); i++) {
                String id = list.getJSONObject(i).getString("id");
                if (!SKIP_APPS.contains(id)) ids.put(id);
            }
            ssh.put(NATIVE_STATE + "/apps.json", ids.toString().getBytes(StandardCharsets.UTF_8), "644");
            String eim = ssh.exec("/usr/bin/luna-send-pub -n 1 luna://com.webos.service.eim/addDevice '"
                    + new JSONObject().put("appId", "com.gathin.tvhome").put("pigImage", "").put("mvpdIcon", "") + "'").out;
            job.say(eim.matches("(?s).*\"returnValue\"\\s*:\\s*true.*") ? "Arranque temprano registrado."
                    : "La tele no registró el arranque temprano: al encenderla puede verse el inicio de LG un momento.");
            String launch = ssh.exec("/usr/bin/luna-send-pub -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"com.local.nativehome\"}'").out;
            if (!launch.matches("(?s).*\"returnValue\"\\s*:\\s*true.*")) job.say("No pude arrancar el ayudante ahora; arrancará al apagar y encender la tele.");
            current = end(current, null);

            current = begin(job, "store");
            if (store) {
                if (!ssh.exec("test -d " + STORE_STATE + " && echo yes").out.contains("yes")) {
                    job.say("Esta versión no trae el servicio de la tienda: sigue sin él.");
                    current = end(current, "no disponible");
                } else {
                    ssh.put(STORE_STATE + "/key.pem", plainKey, "640");
                    current = end(current, "activada");
                }
            } else {
                current.state = "skipped";
                current = null;
            }
            job.state = "done";
            job.say("¡Listo! En la tele: abre cualquier app y pulsa Home, o apágala y enciéndela.");
        } catch (Throwable e) {
            if (current != null) current.state = "failed";
            job.prompt = false;
            if (e instanceof Problem) {
                job.errorCode = ((Problem) e).code;
                job.errorMessage = e.getMessage();
            } else {
                job.errorCode = "error";
                job.errorMessage = "Algo falló: " + e;
            }
            job.state = "failed";
            job.say("✗ " + job.errorMessage);
        } finally {
            if (ssap != null) ssap.close();
            if (ssh != null) ssh.close();
        }
    }

    private static Step begin(Job job, String id) {
        Step s = job.step(id);
        s.state = "running";
        job.say("▸ " + s.title);
        return s;
    }

    private static Step end(Step s, String note) {
        s.state = "done";
        if (note != null) s.note = note;
        return null;
    }
}
