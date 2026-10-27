package io.freetv.core;

import static io.freetv.core.Check.assertEquals;
import static io.freetv.core.Check.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * The whole Samsung install against the pretend Samsung TV (connector/test/fake-samsung.js), which checks the signatures this
 * Java code makes, with FreeTV for Samsung from connector/bundle/samsung and test certificates made by the pretend TV.
 */
public class SamsungTest {
    static final File REPO = InstallerTest.REPO;

    static final class Tv implements AutoCloseable {
        final Process p;
        final BufferedReader out;
        final JSONObject ready;
        JSONObject state;
        Tv(String... args) throws Exception {
            String[] cmd = new String[args.length + 2];
            cmd[0] = "node";
            cmd[1] = new File(REPO, "connector/test/fake-samsung-server.js").getAbsolutePath();
            System.arraycopy(args, 0, cmd, 2, args.length);
            p = new ProcessBuilder(cmd).redirectError(ProcessBuilder.Redirect.INHERIT).start();
            out = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8));
            String line = out.readLine();
            if (line == null || !line.startsWith("READY ")) throw new IllegalStateException("fake Samsung did not start: " + line);
            ready = new JSONObject(line.substring(6));
            SamsungCert.service = ready.getString("service");
        }
        Installer.Bundle bundle() throws Exception {
            Installer.Bundle lg = InstallerTest.bundle();
            byte[] wgt = Files.readAllBytes(new File(REPO, "connector/bundle/samsung/FreeTV.wgt").toPath());
            return new Installer.Bundle(lg.info, lg.launcher, lg.nativeHome, wgt, ready.getJSONObject("certs"));
        }
        JSONObject finish() throws Exception {
            p.getOutputStream().close();
            String line;
            while ((line = out.readLine()) != null) if (line.startsWith("STATE ")) state = new JSONObject(line.substring(6));
            p.waitFor();
            return state;
        }
        @Override public void close() throws Exception { if (state == null) finish(); }
    }

    static JSONObject settings(boolean tizenbrew) {
        return new JSONObject().put("city", "Sevilla").put("latitude", 37.3891).put("longitude", -5.9845).put("country", "ES")
                .put("hideServices", new JSONArray().put("disney")).put("tizenbrew", tizenbrew);
    }

    static boolean has(JSONArray a, String v) { for (int i = 0; i < a.length(); i++) if (v.equals(a.optString(i))) return true; return false; }

    public void testTizen6InstallsSignedWithTheTizenCertificates() throws Exception {
        Installer.Job job = Samsung.newJob("127.0.0.1", false);
        try (Tv tv = new Tv("6.0")) {
            Samsung.run(job, tv.bundle(), settings(false));
            JSONObject s = tv.finish();
            assertEquals(job.view().toString() + " " + s.optString("lastError"), "done", job.state);
            assertTrue(has(s.getJSONArray("installed"), "FreeTVhome"));
            assertTrue(has(s.getJSONArray("launched"), "FreeTVhome.FreeTV"));
            assertTrue(s.getString("config").contains("\"city\":\"Sevilla\""));
            assertEquals("skipped", job.step("tizenbrew").state);
        }
    }

    public void testATvWithOnlyTheOlderDistributorGetsItSignedAgain() throws Exception {
        Installer.Job job = Samsung.newJob("127.0.0.1", false);
        try (Tv tv = new Tv("5.0", "--old-distributor-only")) {
            Samsung.run(job, tv.bundle(), settings(false));
            tv.finish();
            assertEquals(job.view().toString(), "done", job.state);
        }
    }

    public void testTizen7SignsInMakesTheCertificateAndInstalls() throws Exception {
        SamsungCert.dir = Files.createTempDirectory("freetv-test").toFile();
        try (Tv tv = new Tv("7.0", "--duid", "DUID-JAVA-0001")) {
            Installer.Bundle bundle = tv.bundle();
            JSONObject inspected = Samsung.inspect("127.0.0.1");
            assertTrue(inspected.toString(), inspected.getBoolean("reachable") && inspected.getBoolean("needsSamsungLogin"));
            assertEquals("Samsung Test", inspected.optString("name"));

            Installer.Job first = Samsung.newJob("127.0.0.1", false);
            Samsung.run(first, bundle, settings(false));
            assertEquals("samsung-login", first.errorCode);

            String url = SamsungCert.startLogin();
            assertTrue(url, url.contains("redirect_uri=http%3A%2F%2Flocalhost%3A4794%2Fsignin%2Fcallback"));
            String code = new JSONObject().put("access_token", "TOKEN-J").put("userId", "user-j").put("inputEmailID", "me@example.com").toString();
            HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:4794/signin/callback").openConnection();
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            try (OutputStream o = c.getOutputStream()) { o.write(("code=" + URLEncoder.encode(code, "UTF-8")).getBytes(StandardCharsets.UTF_8)); }
            assertEquals(200, c.getResponseCode());
            assertEquals("done", SamsungCert.loginState());

            Installer.Job job = Samsung.newJob("127.0.0.1", false);
            Samsung.run(job, bundle, settings(false));
            assertEquals(job.view().toString(), "done", job.state);
            assertTrue(new File(SamsungCert.dir, "samsung-DUID-JAVA-0001.json").isFile());
            JSONObject again = Samsung.inspect("127.0.0.1");
            assertTrue("no sign-in needed now", !again.getBoolean("needsSamsungLogin"));
            Installer.Job update = Samsung.newJob("127.0.0.1", false);
            Samsung.run(update, bundle, settings(false));
            assertEquals(update.view().toString(), "done", update.state);
            JSONObject s = tv.finish();
            assertTrue(s.toString(), has(s.getJSONArray("files"), "/home/owner/share/tmp/sdk_tools/device-profile.xml"));
            assertTrue(has(s.getJSONArray("installed"), "FreeTVhome"));
        }
    }

    public void testRefusedConnectionSaysWhatToDoOnTheTv() throws Exception {
        Installer.Job job = Samsung.newJob("127.0.0.1", false);
        int old = Sdb.port;
        Sdb.port = 1;   // nothing listens there: like a TV that refuses this phone
        try { Samsung.run(job, InstallerTest.bundle() == null ? null : new Installer.Bundle(new JSONObject(), null, null, new byte[0], new JSONObject()), settings(false)); }
        finally { Sdb.port = old; }
        assertEquals("sdb", job.errorCode);
        assertTrue(job.errorMessage, job.errorMessage.contains("Host PC IP escribe 127.0.0.1"));
    }

    public void testUriComponentMatchesJavaScript() throws Exception {
        assertEquals("js%2Fa%20b(1)!~*'.png", Tizen.uriComponent("js/a b(1)!~*'.png"));
    }
}
