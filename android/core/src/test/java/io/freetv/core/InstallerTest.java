package io.freetv.core;

import static io.freetv.core.Check.assertArrayEquals;
import static io.freetv.core.Check.assertEquals;
import static io.freetv.core.Check.assertFalse;
import static io.freetv.core.Check.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Base64;
import java.util.Map;

/** The whole LG install against the pretend TV (connector/test/fake-tv.js), with the real FreeTV packages from connector/bundle. */
public class InstallerTest {
    static final File REPO = new File(System.getProperty("freetv.repo", "../.."));
    static final File BUNDLE = new File(REPO, "connector/bundle");

    static Installer.Bundle bundle() throws Exception {
        return new Installer.Bundle(new JSONObject(new String(Files.readAllBytes(new File(BUNDLE, "bundle.json").toPath()), StandardCharsets.UTF_8)),
                Files.readAllBytes(new File(BUNDLE, "launcher.ipk").toPath()), Files.readAllBytes(new File(BUNDLE, "nativehome.ipk").toPath()));
    }

    static final class Tv implements AutoCloseable {
        final Process p;
        final BufferedReader out;
        final String passphrase;
        JSONObject state;
        Tv(String... args) throws Exception {
            String[] cmd = new String[args.length + 2];
            cmd[0] = "node";
            cmd[1] = new File(REPO, "connector/test/fake-tv-server.js").getAbsolutePath();
            System.arraycopy(args, 0, cmd, 2, args.length);
            p = new ProcessBuilder(cmd).redirectError(ProcessBuilder.Redirect.INHERIT).start();
            out = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8));
            String line = out.readLine();
            if (line == null || !line.startsWith("READY ")) throw new IllegalStateException("fake TV did not start: " + line);
            passphrase = line.substring(6);
        }
        JSONObject finish() throws Exception {
            p.getOutputStream().close();
            String line;
            while ((line = out.readLine()) != null) if (line.startsWith("STATE ")) state = new JSONObject(line.substring(6));
            p.waitFor();
            return state;
        }
        byte[] file(String path) { return Base64.getDecoder().decode(state.getJSONObject("files").getString(path)); }
        @Override public void close() throws Exception { if (state == null) finish(); }
    }

    static JSONObject settings(boolean store) {
        return new JSONObject().put("city", "Sevilla").put("latitude", 37.3891).put("longitude", -5.9845).put("country", "ES")
                .put("hideServices", new JSONArray().put("disney").put("nope")).put("store", store);
    }

    public void testInstallsBothPackagesAndConfiguresTheHelper() throws Exception {
        Installer.Bundle b = bundle();
        Installer.Job job = new Installer.Job("127.0.0.1", false);
        try (Tv tv = new Tv()) {
            Installer.run(job, b, tv.passphrase, settings(false));
            JSONObject s = tv.finish();
            assertEquals(job.view().toString(), "done", job.state);
            JSONArray installed = s.getJSONArray("installed");
            assertEquals("com.local.nativehome.ipk", installed.getJSONObject(0).getString("name"));
            assertEquals("com.gathin.tvhome.ipk", installed.getJSONObject(1).getString("name"));
            assertArrayEquals(b.nativeHome, Base64.getDecoder().decode(installed.getJSONObject(0).getString("data")));
            Map<String, byte[]> files = Ipk.appFiles(Base64.getDecoder().decode(installed.getJSONObject(1).getString("data")), "com.gathin.tvhome");
            String configJs = new String(files.get("config.js"), StandardCharsets.UTF_8);
            JSONObject config = new JSONObject(configJs.substring(configJs.indexOf('{'), configJs.lastIndexOf('}') + 1));
            assertEquals("Sevilla", config.getString("city"));
            assertEquals("37.3891", config.getString("latitude"));
            assertEquals("ES", config.getString("tmdbRegion"));
            assertEquals("[\"disney\"]", config.getJSONArray("hideServices").toString());
            String appsJs = new String(files.get("apps.js"), StandardCharsets.UTF_8);
            JSONObject apps = new JSONObject(appsJs.substring(appsJs.indexOf('{'), appsJs.lastIndexOf('}') + 1));
            assertEquals(2, apps.getJSONArray("apps").length());
            assertEquals("netflix", apps.getJSONArray("apps").getJSONObject(0).getString("id"));
            assertEquals("com.webos.app.hdmi1", apps.getJSONArray("inputs").getJSONObject(0).getString("appId"));
            assertEquals("PNG/netflix-big.png", new String(files.get("icons/netflix.png"), StandardCharsets.UTF_8));
            assertTrue(files.get("home.js").length > 1000);
            String state = "/media/developer/apps/usr/palm/applications/com.local.nativehome/state/";
            assertEquals("fake-client-key", new JSONObject(new String(tv.file(state + "ssap-key.json"), StandardCharsets.UTF_8)).getString("key"));
            assertEquals("[\"netflix\",\"youtube.leanback.v4\"]", new String(tv.file(state + "apps.json"), StandardCharsets.UTF_8));
            assertTrue(s.getBoolean("eim"));
            assertEquals("[\"com.local.nativehome\"]", s.getJSONArray("launched").toString());
            for (String f : s.getJSONObject("files").keySet()) {
                assertFalse("no store key without a yes", f.endsWith("key.pem"));
                assertFalse("temporary packages removed", f.startsWith("/media/developer/temp/"));
            }
            assertEquals("skipped", job.step("store").state);
        }
    }

    public void testStoreKeyOnlyWhenAsked() throws Exception {
        Installer.Job job = new Installer.Job("127.0.0.1", true);
        try (Tv tv = new Tv()) {
            Installer.run(job, bundle(), tv.passphrase, settings(true));
            tv.finish();
            assertEquals(job.view().toString(), "done", job.state);
            String pem = new String(tv.file("/media/developer/apps/usr/palm/services/com.gathin.tvhome.store/state/key.pem"), StandardCharsets.UTF_8);
            assertTrue(pem, pem.startsWith("-----BEGIN RSA PRIVATE KEY-----"));
            assertFalse(pem.contains("ENCRYPTED"));
        }
    }

    public void testWrongPassphraseStopsBeforeTouchingTheTv() throws Exception {
        Installer.Job job = new Installer.Job("127.0.0.1", false);
        try (Tv tv = new Tv()) {
            Installer.run(job, bundle(), "ZZZZZZ", settings(false));
            JSONObject s = tv.finish();
            assertEquals("failed", job.state);
            assertEquals("passphrase", job.errorCode);
            assertEquals(0, s.getJSONArray("commands").length());
        }
    }

    public void testRejectedPairingIsExplained() throws Exception {
        Installer.Job job = new Installer.Job("127.0.0.1", false);
        try (Tv tv = new Tv("--reject-pairing")) {
            Installer.run(job, bundle(), tv.passphrase, settings(false));
            JSONObject s = tv.finish();
            assertEquals("pairing", job.errorCode);
            assertEquals(0, s.getJSONArray("installed").length());
        }
    }

    public void testNoKeyServer() throws Exception {
        Installer.Job job = new Installer.Job("127.0.0.1", false);
        Installer.run(job, bundle(), "A1B2C3", settings(false));
        assertEquals("keyserver", job.errorCode);
    }

    public void testApiChecksAndFindsTheTv() throws Exception {
        Api api = new Api(bundle(), "android");
        assertTrue(api.handle("GET", "/api/hello", null).json.contains("\"ready\":true"));
        assertEquals(400, api.handle("POST", "/api/install", "{\"brand\":\"lg\",\"ip\":\"1.2.3\",\"passphrase\":\"A1B2C3\"}").status);
        assertEquals(400, api.handle("POST", "/api/install", "{\"brand\":\"samsung\",\"ip\":\"1.2.3.4\",\"passphrase\":\"A1B2C3\"}").status);
        try (Tv tv = new Tv()) {
            JSONObject check = new JSONObject(api.handle("POST", "/api/check", "{\"ip\":\"127.0.0.1\"}").json);
            assertEquals("lg", check.getString("brand"));
            assertTrue(check.getBoolean("devMode"));
            assertTrue(check.getBoolean("keyServer"));
        }
    }

    public void testSettingsAreChecked() throws Exception {
        JSONObject d = bundle().info.getJSONObject("config");
        JSONObject c = Installer.makeConfig(d, new JSONObject().put("latitude", "x").put("longitude", 2).put("city", "<b>Hi</b>")
                .put("country", "es").put("tmdbKey", "a b").put("language", "zz"));
        assertEquals(d.getString("latitude"), c.getString("latitude"));
        assertEquals("bHi/b", c.getString("city"));
        assertEquals(d.getString("tmdbRegion"), c.getString("tmdbRegion"));
        assertEquals("", c.getString("tmdbKey"));
        assertEquals("auto", c.getString("language"));
    }

    public void testRewrittenPackageKeepsOwnersAndModes() throws Exception {
        java.util.Map<String, byte[]> add = new java.util.LinkedHashMap<>();
        add.put("config.js", "x".getBytes(StandardCharsets.UTF_8));
        add.put("icons/a.png", "a".getBytes(StandardCharsets.UTF_8));
        byte[] out = Ipk.withAppFiles(bundle().launcher, "com.gathin.tvhome", add);
        StringBuilder names = new StringBuilder();
        for (Ipk.Member m : Ipk.readAr(out)) names.append(m.name).append(',');
        assertEquals("debian-binary,control.tar.gz,data.tar.gz,", names.toString());
        boolean state = false, icons = false;
        for (Ipk.Member m : Ipk.readAr(out)) {
            if (!m.name.equals("data.tar.gz")) continue;
            for (Ipk.Entry e : Ipk.readTarGz(m.data)) {
                if (e.path().endsWith("com.gathin.tvhome.store/state/")) {
                    state = true;
                    assertEquals("prisoner", e.header.getUserName());
                    assertEquals("jailer", e.header.getGroupName());
                    assertEquals(0770, e.header.getMode() & 0777);
                }
                if (e.path().endsWith("com.gathin.tvhome/icons/a.png")) { icons = true; assertEquals("a", new String(e.data, StandardCharsets.UTF_8)); }
            }
        }
        assertTrue("store state folder", state);
        assertTrue("new icon", icons);
        assertEquals("x", new String(Ipk.appFiles(out, "com.gathin.tvhome").get("config.js"), StandardCharsets.UTF_8));
    }
}
