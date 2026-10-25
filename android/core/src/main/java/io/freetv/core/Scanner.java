package io.freetv.core;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.URLConnection;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Finds TVs on the phone's Wi-Fi. Two ways at once: SSDP (the "who is there?" TVs answer to, which gives their name and maker)
 * and a quick look at the ports TVs open, on every address of the phone's /24 network. Nothing leaves the local network.
 */
public final class Scanner {
    private Scanner() {}

    private static final int[] QUICK = {3000, 3001, 8001, 8002, 8008, 8009, 5555};
    private static final int[] ALL = {3000, 3001, 9922, 9991, 8001, 8002, 26101, 8008, 8009, 5555};

    static boolean privateIPv4(String a) {
        return a.startsWith("10.") || a.startsWith("192.168.") || a.matches("^172\\.(1[6-9]|2\\d|3[01])\\..*");
    }

    /** The phone's own local addresses. */
    public static List<String> addresses() {
        List<String> out = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> list = NetworkInterface.getNetworkInterfaces();
            for (NetworkInterface ni : list == null ? Collections.<NetworkInterface>emptyList() : Collections.list(list)) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && privateIPv4(a.getHostAddress())) out.add(a.getHostAddress());
                }
            }
        } catch (Exception e) { /* none */ }
        return out;
    }

    static boolean probe(String host, int port, int ms) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(host, port), ms);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** What one address is, or null if nothing TV-like answers there. */
    public static JSONObject inspect(String ip, boolean quick) {
        int[] ports = quick ? QUICK : ALL;
        Set<Integer> open = new LinkedHashSet<>();
        for (int p : ports) if (probe(ip, p, quick ? 700 : 1200)) open.add(p);
        if (open.isEmpty()) return null;
        if (quick) return inspect(ip, false);
        String brand = null;
        if (open.contains(3000) || open.contains(3001)) brand = "lg";
        else if (open.contains(8001) || open.contains(8002)) brand = "samsung";
        else if (open.contains(8008) || open.contains(8009) || open.contains(5555)) brand = "android";
        boolean dev = "lg".equals(brand) ? open.contains(9922) : "samsung".equals(brand) ? open.contains(26101) : open.contains(5555);
        JSONObject tv = new JSONObject().put("ip", ip).put("devMode", dev).put("keyServer", open.contains(9991)).put("name", "");
        tv.put("brand", brand == null ? JSONObject.NULL : brand);
        return tv;
    }

    /** SSDP answers: ip -> {name, maker}. */
    static Map<String, String[]> ssdp(int seconds) {
        Map<String, String[]> found = new HashMap<>();
        Map<String, String> locations = new HashMap<>();
        try (DatagramSocket sock = new DatagramSocket()) {
            sock.setSoTimeout(300);
            InetAddress group = InetAddress.getByName("239.255.255.250");
            for (String st : new String[]{"ssdp:all", "urn:lge-com:service:webos-second-screen:1", "urn:dial-multiscreen-org:service:dial:1",
                    "urn:samsung.com:device:RemoteControlReceiver:1"}) {
                byte[] msg = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: " + st + "\r\n\r\n")
                        .getBytes(StandardCharsets.US_ASCII);
                sock.send(new DatagramPacket(msg, msg.length, group, 1900));
            }
            long end = System.currentTimeMillis() + seconds * 1000L;
            byte[] buf = new byte[4096];
            while (System.currentTimeMillis() < end) {
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                try { sock.receive(p); } catch (SocketTimeoutException e) { continue; }
                String ip = p.getAddress().getHostAddress();
                String text = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8);
                String head = header(text, "server") + " " + header(text, "st");
                String[] f = found.get(ip);
                if (f == null) { f = new String[]{"", ""}; found.put(ip, f); }
                if (f[1].isEmpty() && head.matches("(?is).*(lge|webos).*")) f[1] = "lg";
                if (f[1].isEmpty() && head.matches("(?is).*(samsung|tizen).*")) f[1] = "samsung";
                String loc = header(text, "location");
                if (loc.startsWith("http://") && !locations.containsKey(ip)) locations.put(ip, loc);
            }
        } catch (Exception e) { /* no multicast on this network */ }
        for (Map.Entry<String, String> l : locations.entrySet()) {
            String xml = fetch(l.getValue());
            String[] f = found.get(l.getKey());
            String name = tag(xml, "friendlyName"), maker = tag(xml, "manufacturer");
            if (!name.isEmpty() && f[0].isEmpty()) f[0] = name.replace("&amp;", "&").trim();
            if (maker.matches("(?is).*\\blg.*")) f[1] = "lg";
            else if (maker.matches("(?is).*samsung.*")) f[1] = "samsung";
            else if (f[1].isEmpty() && maker.matches("(?is).*(google|sony|tcl|xiaomi|philips|hisense|android).*")) f[1] = "android";
        }
        return found;
    }

    private static String header(String text, String name) {
        Matcher m = Pattern.compile("(?im)^" + name + ":\\s*(.+?)\\s*$").matcher(text);
        return m.find() ? m.group(1) : "";
    }

    private static String tag(String xml, String name) {
        Matcher m = Pattern.compile("<" + name + ">([^<]{1,80})</" + name + ">", Pattern.CASE_INSENSITIVE).matcher(xml);
        return m.find() ? m.group(1) : "";
    }

    private static String fetch(String url) {
        try {
            URLConnection c = new URL(url).openConnection();
            c.setConnectTimeout(2500);
            c.setReadTimeout(2500);
            try (InputStream in = c.getInputStream()) { return new String(Ssh.readAll(in, 200000), StandardCharsets.UTF_8); }
        } catch (Exception e) {
            return "";
        }
    }

    /** {networks: [...], tvs: [{ip, brand, name, devMode, keyServer}]}. Takes about 5 to 15 seconds. */
    public static JSONObject scan() throws Exception {
        List<String> own = addresses();
        List<String> nets = new ArrayList<>();
        final List<String> hosts = new ArrayList<>();
        for (String a : own) {
            String base = a.substring(0, a.lastIndexOf('.') + 1);
            if (nets.contains(base + "0/24")) continue;
            nets.add(base + "0/24");
            for (int i = 1; i < 255; i++) if (!(base + i).equals(a)) hosts.add(base + i);
        }
        ExecutorService pool = Executors.newFixedThreadPool(64);
        try {
            Future<Map<String, String[]>> answers = pool.submit(() -> ssdp(3));
            List<Future<JSONObject>> probes = new ArrayList<>();
            for (final String h : hosts) probes.add(pool.submit(() -> inspect(h, true)));
            List<JSONObject> found = new ArrayList<>();
            for (Future<JSONObject> f : probes) { JSONObject tv = f.get(); if (tv != null) found.add(tv); }
            Map<String, String[]> names = answers.get();
            for (String ip : names.keySet()) {   // a TV that answered SSDP from another network (a second router, say)
                if (privateIPv4(ip) && !hosts.contains(ip)) { JSONObject tv = inspect(ip, true); if (tv != null) found.add(tv); }
            }
            JSONArray tvs = new JSONArray();
            List<JSONObject> lg = new ArrayList<>(), rest = new ArrayList<>();
            for (JSONObject tv : found) {
                String[] s = names.get(tv.getString("ip"));
                Object brand = tv.get("brand");
                if (s != null && !s[1].isEmpty() && (brand == JSONObject.NULL || "android".equals(brand))) tv.put("brand", s[1]);
                if (tv.get("brand") == JSONObject.NULL) continue;
                if (s != null) tv.put("name", s[0]);
                ("lg".equals(tv.get("brand")) ? lg : rest).add(tv);
            }
            for (JSONObject tv : lg) tvs.put(tv);
            for (JSONObject tv : rest) tvs.put(tv);
            return new JSONObject().put("networks", new JSONArray(nets)).put("tvs", tvs);
        } finally {
            pool.shutdownNow();
            pool.awaitTermination(1, TimeUnit.SECONDS);
        }
    }

    public static JSONObject check(String ip) {
        JSONObject tv = inspect(ip, false);
        if (tv != null) return tv;
        return new JSONObject().put("ip", ip).put("brand", JSONObject.NULL).put("devMode", false).put("keyServer", false);
    }
}
