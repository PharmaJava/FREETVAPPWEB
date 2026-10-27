package io.freetv.core;

import org.json.JSONObject;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The same small API the computer Conector answers (connector/src/main.js), for the web page inside the Android app:
 *   GET /api/hello, POST /api/scan, POST /api/check {ip}, POST /api/install {brand, ip, passphrase, settings}, GET /api/job/&lt;id&gt;,
 *   POST and GET /api/samsung/login
 * The page calls it through the app's JavaScript bridge instead of http.
 */
public final class Api {
    public static final String VERSION = "1.0.0";

    public static final class Reply {
        public final int status;
        public final String json;
        Reply(int status, JSONObject body) { this.status = status; this.json = body.toString(); }
    }

    private final Installer.Bundle bundle;
    private final String platform;
    private final Map<String, Installer.Job> jobs = new ConcurrentHashMap<>();
    private volatile Installer.Job running;

    public Api(Installer.Bundle bundle, String platform) { this.bundle = bundle; this.platform = platform; }

    private static Reply error(int status, String message) { return new Reply(status, new JSONObject().put("error", message)); }

    private static final String IP = "^(25[0-5]|2[0-4]\\d|1?\\d?\\d)(\\.(25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}$";

    public Reply handle(String method, String path, String body) {
        try {
            String route = method + " " + path;
            if (route.equals("GET /api/hello")) {
                JSONObject r = new JSONObject().put("app", "freetv-conector").put("platform", platform).put("version", VERSION)
                        .put("ready", bundle != null).put("busy", running != null && "running".equals(running.state));
                if (bundle != null) r.put("freetv", bundle.info.optString("freetv")).put("launcher", bundle.info.optJSONObject("launcher"));
                r.put("samsung", bundle != null && bundle.samsungWgt != null && bundle.samsungCerts != null);
                r.put("addresses", new org.json.JSONArray(Scanner.addresses()));
                return new Reply(200, r);
            }
            JSONObject b = body == null || body.isEmpty() ? new JSONObject() : new JSONObject(body);
            if (route.equals("POST /api/scan")) return new Reply(200, Scanner.scan());
            if (route.equals("POST /api/check")) {
                String ip = b.optString("ip", "");
                if (!ip.matches(IP)) return error(400, "IP no válida");
                JSONObject tv = Scanner.check(ip);
                if ("samsung".equals(tv.optString("brand"))) {
                    JSONObject more = Samsung.inspect(ip);
                    for (java.util.Iterator<String> it = more.keys(); it.hasNext(); ) { String k = it.next(); tv.put(k, more.get(k)); }
                }
                return new Reply(200, tv);
            }
            // Samsung TVs of 2023 and newer: the person signs in to their Samsung account in the phone's browser.
            if (route.equals("POST /api/samsung/login")) return new Reply(200, new JSONObject().put("url", SamsungCert.startLogin()));
            if (route.equals("GET /api/samsung/login")) return new Reply(200, new JSONObject().put("state", SamsungCert.loginState()));
            if (route.equals("POST /api/install")) {
                if (bundle == null) return error(500, "Esta app no trae los paquetes de FreeTV.");
                String brand = b.optString("brand");
                if (!"lg".equals(brand) && !"samsung".equals(brand)) return error(400, "La app instala en teles LG y Samsung.");
                String ip = b.optString("ip", "");
                if (!ip.matches(IP)) return error(400, "La IP no es válida (por ejemplo 192.168.1.140).");
                if (running != null && "running".equals(running.state)) return error(409, "Ya hay una instalación en marcha.");
                if ("samsung".equals(brand)) {
                    if (bundle.samsungWgt == null || bundle.samsungCerts == null) return error(500, "Esta app no trae FreeTV para Samsung: descárgala otra vez.");
                    final JSONObject ss = b.optJSONObject("settings") == null ? new JSONObject() : b.getJSONObject("settings");
                    ss.put("tizenbrew", ss.optBoolean("tizenbrew", false));
                    final Installer.Job sj = Samsung.newJob(ip, ss.getBoolean("tizenbrew"));
                    jobs.put(sj.id, sj);
                    running = sj;
                    new Thread(() -> Samsung.run(sj, bundle, ss), "freetv-install").start();
                    return new Reply(200, new JSONObject().put("job", sj.id));
                }
                String pass = b.optString("passphrase", "").trim();
                if (!pass.matches("[A-Za-z0-9]{4,12}")) return error(400, "Escribe la passphrase de la tele (6 letras y números).");
                if (running != null && "running".equals(running.state)) return error(409, "Ya hay una instalación en marcha.");
                final JSONObject settings = b.optJSONObject("settings") == null ? new JSONObject() : b.getJSONObject("settings");
                settings.put("store", settings.optBoolean("store", false));
                final Installer.Job job = new Installer.Job(ip, settings.getBoolean("store"));
                jobs.put(job.id, job);
                running = job;
                Thread t = new Thread(() -> Installer.run(job, bundle, pass, settings), "freetv-install");
                t.start();
                return new Reply(200, new JSONObject().put("job", job.id));
            }
            if (method.equals("GET") && path.matches("/api/job/[a-f0-9]{12}")) {
                Installer.Job job = jobs.get(path.substring(9));
                return job == null ? error(404, "no existe") : new Reply(200, job.view());
            }
            return error(404, "no existe");
        } catch (Exception e) {
            return error(500, "Error: " + e.getMessage());
        }
    }
}
