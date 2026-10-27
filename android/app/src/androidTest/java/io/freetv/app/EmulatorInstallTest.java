package io.freetv.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.res.AssetManager;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import io.freetv.core.Installer;
import io.freetv.core.Samsung;

/**
 * The Android app, on an Android emulator, against the pretend LG TV that runs on the build machine (connector/test/fake-tv-daemon.js;
 * an emulator reaches its host as 10.0.2.2). Three tests:
 *  1. the installer alone (io.freetv.core) on a real Android runtime: SSH, the remote-control WebSocket, rewriting the .ipk, HTTP;
 *  2. the Samsung installer alone, against the pretend Samsung TV there: SDB, signing with the app's certificates;
 *  3. the whole app as a person uses it: the page in the WebView, the buttons, the bridge to the installer, to "FreeTV is on your TV".
 */
public class EmulatorInstallTest {
    static final String TV = "10.0.2.2";
    static final String PASSPHRASE = "A1B2C3";

    private static byte[] read(AssetManager assets, String name) throws Exception {
        try (InputStream in = assets.open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    @Test
    public void theInstallerWorksOnAnAndroidRuntime() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        AssetManager a = app.getAssets();
        Installer.Bundle bundle = new Installer.Bundle(new JSONObject(new String(read(a, "bundle/bundle.json"), StandardCharsets.UTF_8)),
                read(a, "bundle/launcher.ipk"), read(a, "bundle/nativehome.ipk"));

        Installer.Job wrong = new Installer.Job(TV, false);
        Installer.run(wrong, bundle, "ZZZZZZ", new JSONObject());
        assertEquals(wrong.view().toString(), "failed", wrong.state);
        assertEquals("passphrase", wrong.view().getJSONObject("error").getString("code"));

        Installer.Job job = new Installer.Job(TV, false);
        Installer.run(job, bundle, PASSPHRASE, new JSONObject().put("city", "Sevilla").put("latitude", 37.3891).put("longitude", -5.9845).put("country", "ES"));
        assertEquals(job.view().toString(), "done", job.state);
    }

    @Test
    public void theSamsungInstallerWorksOnAnAndroidRuntime() throws Exception {
        // The pretend Samsung TV (Tizen 6) checks the signatures made here, on Android, with the certificates the app carries.
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        AssetManager a = app.getAssets();
        Installer.Bundle bundle = new Installer.Bundle(new JSONObject(new String(read(a, "bundle/bundle.json"), StandardCharsets.UTF_8)),
                read(a, "bundle/launcher.ipk"), read(a, "bundle/nativehome.ipk"), read(a, "bundle/samsung/FreeTV.wgt"),
                new JSONObject(new String(read(a, "bundle/samsung/certs.json"), StandardCharsets.UTF_8)));
        JSONObject seen = Samsung.inspect(TV);
        assertTrue(seen.toString(), seen.getBoolean("reachable"));
        Installer.Job job = Samsung.newJob(TV, false);
        Samsung.run(job, bundle, new JSONObject().put("city", "Sevilla").put("latitude", 37.3891).put("longitude", -5.9845).put("country", "ES"));
        assertEquals(job.view().toString(), "done", job.state);
    }

    // ---- the whole app ----

    private WebView web;

    private String js(final String script, int seconds) throws Exception {
        final CountDownLatch latch = new CountDownLatch(1);
        final String[] out = {null};
        new Handler(Looper.getMainLooper()).post(() -> web.evaluateJavascript(script, value -> { out[0] = value; latch.countDown(); }));
        assertTrue("the page did not answer: " + script, latch.await(seconds, TimeUnit.SECONDS));
        return out[0];
    }

    private void waitUntil(String expression, int seconds, String what) throws Exception {
        long end = System.currentTimeMillis() + seconds * 1000L;
        while (System.currentTimeMillis() < end) {
            if ("true".equals(js("(function(){try{return !!(" + expression + ")}catch(e){return false}})()", 20))) return;
            Thread.sleep(500);
        }
        throw new AssertionError("timed out waiting for: " + what + "\npage says: " + js("document.body.innerText.slice(0, 1500)", 20));
    }

    private void tap(String selector) throws Exception {
        assertEquals("\"ok\"", js("(function(){var e=document.querySelector('" + selector + "');if(!e)return 'missing';e.click();return 'ok'})()", 20));
    }

    @Test
    public void thePageAndTheAppInstallFreeTvOnTheTv() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            final WebView[] holder = new WebView[1];
            scenario.onActivity(activity -> holder[0] = (WebView) ((ViewGroup) activity.findViewById(android.R.id.content)).getChildAt(0));
            web = holder[0];

            waitUntil("document.readyState === 'complete' && document.getElementById('install-btn')", 60, "the page to load");
            waitUntil("document.body.classList.contains('wizard-only')", 10, "the app to show only the installer");
            // the bridge to the installer answers
            waitUntil("document.querySelector('.step[data-step=start]') && !document.querySelector('.step[data-step=start]').hidden", 10, "the start step");

            tap("[data-step=start] [data-go=prepare]");
            waitUntil("!document.querySelector('.step[data-step=prepare]').hidden", 10, "step 2 (get the TV ready)");
            tap("[data-step=prepare] [data-go=find]");
            waitUntil("!document.querySelector('.step[data-step=find]').hidden", 10, "step 3 (find your TV)");

            // type the IP, as a person would when the search does not show the TV
            js("(function(){document.getElementById('ip').value='" + TV + "';})()", 20);
            tap("#check-ip");
            waitUntil("!document.querySelector('.step[data-step=details]').hidden", 120, "step 4 (the TV was found and chosen)");

            js("(function(){document.getElementById('pass').value='" + PASSPHRASE + "';})()", 20);
            tap("#install-btn");
            waitUntil("!document.getElementById('done').hidden || !document.getElementById('failed').hidden", 240, "the install to finish");
            String failure = js("document.getElementById('failed').hidden ? '' : document.getElementById('fail-msg').textContent + ' | ' + document.getElementById('log').textContent", 20);
            assertEquals("the install failed: " + failure, "\"\"", failure);
            assertEquals("true", js("!document.getElementById('done').hidden", 20));
        }
    }
}
