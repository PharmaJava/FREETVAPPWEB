package io.freetv.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.res.AssetManager;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import io.freetv.core.Api;
import io.freetv.core.Installer;
import io.freetv.core.SamsungCert;

/**
 * FreeTV for Android: the same web page as GitHub Pages (inside the app, from its assets), and under it the installer
 * (io.freetv.core), which the page calls through a JavaScript bridge (window.FreeTVAndroid) instead of the computer Conector.
 */
public class MainActivity extends Activity {
    private WebView web;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private volatile Api api;
    private WifiManager.MulticastLock multicast;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);   // the install takes a couple of minutes
        WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi != null) {
            multicast = wifi.createMulticastLock("freetv-ssdp");   // to hear the TVs answer when looking for them
            multicast.setReferenceCounted(false);
        }

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        web.addJavascriptInterface(new Bridge(), "FreeTVAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("file".equals(uri.getScheme())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (ActivityNotFoundException e) { /* no browser */ }
                return true;   // web links (LG's developer site, guides) open in the browser
            }
        });
        setContentView(web);
        if (state != null) web.restoreState(state);
        else web.loadUrl("file:///android_asset/site/index.html");
    }

    @Override protected void onResume() { super.onResume(); if (multicast != null) multicast.acquire(); }
    @Override protected void onPause() { super.onPause(); if (multicast != null && multicast.isHeld()) multicast.release(); }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.__freetvBack ? window.__freetvBack() : false", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    private Api api() throws Exception {
        if (api == null) {
            synchronized (this) {
                if (api == null) {
                    AssetManager a = getAssets();
                    byte[] wgt = null;
                    JSONObject certs = null;
                    try {
                        wgt = read(a, "bundle/samsung/FreeTV.wgt");
                        certs = new JSONObject(new String(read(a, "bundle/samsung/certs.json"), StandardCharsets.UTF_8));
                    } catch (Exception e) { wgt = null; certs = null; }   // a build without Samsung: LG only
                    Installer.Bundle bundle = new Installer.Bundle(new JSONObject(new String(read(a, "bundle/bundle.json"), StandardCharsets.UTF_8)),
                            read(a, "bundle/launcher.ipk"), read(a, "bundle/nativehome.ipk"), wgt, certs);
                    // Samsung certificates (2023+ TVs) are kept in the app's own private folder, for the next install.
                    SamsungCert.dir = new File(getFilesDir(), "samsung");
                    api = new Api(bundle, "android");
                }
            }
        }
        return api;
    }

    private static byte[] read(AssetManager assets, String name) throws Exception {
        try (InputStream in = assets.open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    /** What the page calls: request(id, method, path, body); the answer comes back to window.__freetvReply(id, status, json). */
    final class Bridge {
        @JavascriptInterface
        public void request(final String id, final String method, final String path, final String body) {
            if (id == null || !id.matches("[A-Za-z0-9]{1,20}")) return;
            pool.execute(() -> {
                int status;
                String json;
                try {
                    Api.Reply r = api().handle(method, path, body);
                    status = r.status;
                    json = r.json;
                } catch (Throwable e) {
                    status = 500;
                    json = new JSONObject().toString();
                    try { json = new JSONObject().put("error", "Error de la app: " + e.getMessage()).toString(); } catch (Exception ignored) { }
                }
                final String js = "window.__freetvReply(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(json) + ")";
                runOnUiThread(() -> web.evaluateJavascript(js, null));
            });
        }
    }
}
