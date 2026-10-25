package io.freetv.core;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.net.ssl.HttpsURLConnection;

/**
 * The TV's remote-control service (wss://TV:3001, the one LG's phone app uses), to read the TV's apps and inputs: webOS does
 * not let an app list them, so FreeTV gets them at install time (as the Home helper's sync-apps.py does). The first time the
 * TV shows a pairing prompt: the person accepts it with the remote. The key the TV gives back stays on the TV, for the helper.
 */
public final class Ssap implements AutoCloseable {
    public static int wssPort = 3001;
    public static int wsPort = 3000;

    // Unsigned on purpose (see the helper's lgtv.py): newer firmware rejects the signed manifest open-source clients share.
    private static final String[] PERMISSIONS = {
        "LAUNCH", "LAUNCH_WEBAPP", "APP_TO_APP", "CLOSE", "TEST_OPEN", "TEST_PROTECTED", "CONTROL_AUDIO",
        "CONTROL_DISPLAY", "CONTROL_INPUT_JOYSTICK", "CONTROL_INPUT_MEDIA_RECORDING",
        "CONTROL_INPUT_MEDIA_PLAYBACK", "CONTROL_INPUT_TV", "CONTROL_POWER", "CONTROL_TV_SCREEN",
        "READ_APP_STATUS", "READ_CURRENT_CHANNEL", "READ_INPUT_DEVICE_LIST", "READ_NETWORK_STATE",
        "READ_RUNNING_APPS", "READ_TV_CHANNEL_LIST", "WRITE_NOTIFICATION_TOAST", "READ_POWER_STATE",
        "READ_COUNTRY_INFO", "CONTROL_INPUT_TEXT", "CONTROL_MOUSE_AND_KEYBOARD", "READ_INSTALLED_APPS",
        "READ_SETTINGS", "READ_STORAGE_DEVICE_LIST",
    };

    /** Called when the TV shows its pairing prompt. */
    public interface OnPrompt { void prompt(); }

    private final WebSocketClient ws;
    private int n = 0;
    public final String key;

    private Ssap(WebSocketClient ws, String key) { this.ws = ws; this.key = key; }

    private static WebSocketClient open(String ip) {
        try { return WebSocketClient.connect(ip, wssPort, true, 10000); } catch (Exception e) { /* older TVs: plain ws on 3000 */ }
        try { return WebSocketClient.connect(ip, wsPort, false, 10000); } catch (Exception e) { return null; }
    }

    /** Pairs (the TV may show a prompt) and returns the session. */
    public static Ssap pair(String ip, String clientKey, OnPrompt onPrompt) throws Problem {
        WebSocketClient ws = open(ip);
        if (ws == null) throw new Problem("ssap", "No llego al servicio del mando de la tele (puertos 3001 y 3000). ¿Está encendida y en la misma red?");
        try {
            JSONObject manifest = new JSONObject().put("manifestVersion", 1).put("appVersion", "1.1").put("permissions", new JSONArray(PERMISSIONS));
            JSONObject payload = new JSONObject().put("forcePairing", false).put("pairingType", "PROMPT").put("manifest", manifest);
            if (clientKey != null) payload.put("client-key", clientKey);
            ws.send(new JSONObject().put("type", "register").put("id", "register_0").put("payload", payload).toString());
            long end = System.currentTimeMillis() + 90000;
            while (true) {
                JSONObject msg;
                try {
                    msg = new JSONObject(ws.receive((int) Math.max(1, end - System.currentTimeMillis())));
                } catch (SocketTimeoutException e) {
                    throw new Problem("pairing", "No se aceptó a tiempo el aviso de emparejamiento en la tele. Vuelve a intentarlo y pulsa «Aceptar» con el mando.");
                } catch (java.io.IOException e) {
                    throw new Problem("ssap", "La tele cerró la conexión del mando. Vuelve a intentarlo.");
                }
                String type = msg.optString("type");
                if (!"register_0".equals(msg.optString("id"))) continue;
                JSONObject p = msg.optJSONObject("payload");
                if ("response".equals(type) && p != null && "PROMPT".equals(p.optString("pairingType"))) { onPrompt.prompt(); continue; }
                if ("registered".equals(type) && p != null) return new Ssap(ws, p.getString("client-key"));
                if ("error".equals(type)) {
                    String error = msg.optString("error");
                    throw new Problem("pairing", error.matches("(?is).*(rejected|denied|cancel).*")
                            ? "En la tele se rechazó el aviso de emparejamiento. Vuelve a intentarlo y pulsa «Aceptar» con el mando."
                            : "La tele no aceptó el emparejamiento: " + error);
                }
            }
        } catch (Problem e) {
            ws.close();
            throw e;
        } catch (Exception e) {
            ws.close();
            throw new Problem("ssap", "La conexión con el mando de la tele falló: " + e.getMessage());
        }
    }

    public JSONObject call(String uri) throws Exception {
        String id = "c" + (++n);
        ws.send(new JSONObject().put("type", "request").put("id", id).put("uri", uri).put("payload", new JSONObject()).toString());
        long end = System.currentTimeMillis() + 20000;
        while (true) {
            JSONObject msg = new JSONObject(ws.receive((int) Math.max(1, end - System.currentTimeMillis())));
            if (!id.equals(msg.optString("id"))) continue;
            if ("error".equals(msg.optString("type"))) throw new Exception(msg.optString("error", "error"));
            JSONObject p = msg.optJSONObject("payload");
            return p == null ? new JSONObject() : p;
        }
    }

    /** What FreeTV's apps.js holds: {apps: [{id, title, icon, iconColor}], inputs: [{appId, label}]}. */
    public static final class Apps {
        public final JSONObject tvApps;
        public final Map<String, byte[]> icons;   // 'icons/<name>.png' -> picture
        Apps(JSONObject tvApps, Map<String, byte[]> icons) { this.tvApps = tvApps; this.icons = icons; }
    }

    public Apps readApps(Installer.Log log) throws Exception {
        JSONArray points = call("ssap://com.webos.applicationManager/listLaunchPoints").optJSONArray("launchPoints");
        JSONArray inputs = null;
        try { inputs = call("ssap://tv/getExternalInputList").optJSONArray("devices"); } catch (Exception e) { /* some TVs have none */ }
        JSONArray apps = new JSONArray();
        Map<String, byte[]> icons = new LinkedHashMap<>();
        for (int i = 0; points != null && i < points.length(); i++) {
            JSONObject p = points.getJSONObject(i);
            if (p.optBoolean("hidden")) continue;
            String large = p.optString("largeIcon", "");
            String url = large.startsWith("http") ? large : p.optString("icon", "");
            String name = p.getString("id").replaceAll("[^A-Za-z0-9._-]", "_") + ".png";
            try {
                icons.put("icons/" + name, download(url));
            } catch (Exception e) {
                log.say("Sin icono para " + p.optString("title"));
                continue;
            }
            String color = p.optString("iconColor", "");
            if (color.isEmpty()) color = p.optString("bgColor", "");
            apps.put(new JSONObject().put("id", p.getString("id")).put("title", p.optString("title"))
                    .put("icon", "icons/" + name).put("iconColor", color));
        }
        JSONArray ins = new JSONArray();
        for (int i = 0; inputs != null && i < inputs.length(); i++) {
            JSONObject d = inputs.getJSONObject(i);
            if (d.optString("appId", "").isEmpty()) continue;
            String label = d.optString("label", "");
            ins.put(new JSONObject().put("appId", d.getString("appId")).put("label", label.isEmpty() ? d.optString("id") : label));
        }
        return new Apps(new JSONObject().put("apps", apps).put("inputs", ins), icons);
    }

    /** An app's icon, from the TV (its own certificate, as above). */
    static byte[] download(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        if (c instanceof HttpsURLConnection) {
            ((HttpsURLConnection) c).setSSLSocketFactory(WebSocketClient.trustingTls().getSocketFactory());
            ((HttpsURLConnection) c).setHostnameVerifier((host, session) -> true);
        }
        c.setConnectTimeout(10000);
        c.setReadTimeout(10000);
        try {
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            try (InputStream in = c.getInputStream()) { return Ssh.readAll(in, 4 * 1024 * 1024); }
        } finally {
            c.disconnect();
        }
    }

    @Override public void close() { ws.close(); }
}
