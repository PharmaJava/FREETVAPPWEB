package io.freetv.core;

import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.apache.commons.compress.archivers.tar.TarArchiveOutputStream;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

/**
 * Reads and rewrites a webOS .ipk (a Debian-style `ar` archive: debian-binary, control.tar.gz, data.tar.gz). The app carries
 * FreeTV's package already built, with an empty config.js and apps.js, and puts each person's settings and their TV's apps in it
 * here, keeping everything else as LG's packager made it (owners and modes included: the services' `state` folders must stay
 * prisoner:jailer 0770).
 */
public final class Ipk {
    private Ipk() {}

    static final class Member {
        final String name;
        final byte[] header;
        byte[] data;
        Member(String name, byte[] header, byte[] data) { this.name = name; this.header = header; this.data = data; }
    }

    static List<Member> readAr(byte[] b) {
        if (b.length < 8 || !new String(b, 0, 8, StandardCharsets.ISO_8859_1).equals("!<arch>\n")) throw new IllegalArgumentException("no es un paquete .ipk");
        List<Member> out = new ArrayList<>();
        int i = 8;
        while (i + 60 <= b.length) {
            byte[] header = new byte[60];
            System.arraycopy(b, i, header, 0, 60);
            int size = Integer.parseInt(new String(header, 48, 10, StandardCharsets.ISO_8859_1).trim());
            String name = new String(header, 0, 16, StandardCharsets.ISO_8859_1).trim().replaceAll("/$", "");
            byte[] data = new byte[size];
            System.arraycopy(b, i + 60, data, 0, size);
            out.add(new Member(name, header, data));
            i += 60 + size + (size & 1);
        }
        return out;
    }

    static byte[] writeAr(List<Member> members) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write("!<arch>\n".getBytes(StandardCharsets.ISO_8859_1), 0, 8);
        for (Member m : members) {
            byte[] h = m.header.clone();
            byte[] size = pad(String.valueOf(m.data.length), 10).getBytes(StandardCharsets.ISO_8859_1);
            System.arraycopy(size, 0, h, 48, 10);
            out.write(h, 0, 60);
            out.write(m.data, 0, m.data.length);
            if ((m.data.length & 1) == 1) out.write('\n');
        }
        return out.toByteArray();
    }

    private static String pad(String s, int n) {
        StringBuilder sb = new StringBuilder(s);
        while (sb.length() < n) sb.append(' ');
        return sb.toString();
    }

    static final class Entry {
        final TarArchiveEntry header;
        byte[] data;
        Entry(TarArchiveEntry header, byte[] data) { this.header = header; this.data = data; }
        String path() { return header.getName().replaceFirst("^\\./", ""); }
    }

    static List<Entry> readTarGz(byte[] gz) throws Exception {
        List<Entry> out = new ArrayList<>();
        try (TarArchiveInputStream tar = new TarArchiveInputStream(new GZIPInputStream(new ByteArrayInputStream(gz)))) {
            TarArchiveEntry e;
            while ((e = tar.getNextEntry()) != null) {
                out.add(new Entry(e, e.isDirectory() ? new byte[0] : Ssh.readAll(tar, 512 * 1024 * 1024)));
            }
        }
        return out;
    }

    static byte[] writeTarGz(List<Entry> entries) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (TarArchiveOutputStream tar = new TarArchiveOutputStream(new GZIPOutputStream(bytes))) {
            tar.setLongFileMode(TarArchiveOutputStream.LONGFILE_POSIX);
            tar.setBigNumberMode(TarArchiveOutputStream.BIGNUMBER_POSIX);
            for (Entry e : entries) {
                if (!e.header.isDirectory()) e.header.setSize(e.data.length);
                tar.putArchiveEntry(e.header);
                if (!e.header.isDirectory()) tar.write(e.data);
                tar.closeArchiveEntry();
            }
        }
        return bytes.toByteArray();
    }

    /** A new .ipk with files replaced or added inside one app's folder (paths relative to usr/palm/applications/&lt;appId&gt;/). */
    public static byte[] withAppFiles(byte[] ipk, String appId, Map<String, byte[]> files) throws Exception {
        List<Member> members = readAr(ipk);
        Member data = null;
        for (Member m : members) if (m.name.equals("data.tar.gz")) data = m;
        if (data == null) throw new IllegalArgumentException("el paquete no tiene data.tar.gz");
        String base = "usr/palm/applications/" + appId + "/";
        List<Entry> entries = readTarGz(data.data);
        Entry appDir = null, like = null;
        int last = -1;
        for (int i = 0; i < entries.size(); i++) {
            Entry e = entries.get(i);
            String p = e.path();
            if ((p.endsWith("/") ? p : p + "/").equals(base)) appDir = e;
            if (p.startsWith(base)) {
                last = i;
                if (like == null && e.header.isFile()) like = e;
            }
        }
        if (appDir == null) throw new IllegalArgumentException("el paquete no trae la app " + appId);
        if (like == null) like = appDir;
        String prefix = appDir.header.getName().startsWith("./") ? "./" : "";
        Date now = new Date();
        Map<String, byte[]> left = new TreeMap<>(files);

        for (Entry e : entries) {
            String p = e.path();
            if (!p.startsWith(base)) continue;
            String rel = p.substring(base.length());
            if (left.containsKey(rel)) {
                e.data = left.remove(rel);
                e.header.setModTime(now);
            }
        }
        Set<String> have = new HashSet<>();
        for (Entry e : entries) have.add(e.path().replaceAll("/$", ""));
        List<Entry> added = new ArrayList<>();
        for (Map.Entry<String, byte[]> f : left.entrySet()) {
            String[] parts = f.getKey().split("/");
            StringBuilder dir = new StringBuilder(base.substring(0, base.length() - 1));
            for (int k = 0; k < parts.length - 1; k++) {
                dir.append('/').append(parts[k]);
                if (have.add(dir.toString())) added.add(new Entry(copy(appDir.header, prefix + dir + "/", appDir.header.getMode(), now), new byte[0]));
            }
            added.add(new Entry(copy(like.header, prefix + base + f.getKey(), 0100644, now), f.getValue()));
        }
        // New entries go right after the app's last entry, so its folder stays together as the packager writes it.
        entries.addAll(last + 1, added);
        data.data = writeTarGz(entries);
        return writeAr(members);
    }

    private static TarArchiveEntry copy(TarArchiveEntry like, String name, int mode, Date mtime) {
        TarArchiveEntry e = new TarArchiveEntry(name, true);
        e.setMode(mode);
        e.setUserId(like.getLongUserId());
        e.setGroupId(like.getLongGroupId());
        e.setUserName(like.getUserName());
        e.setGroupName(like.getGroupName());
        e.setModTime(mtime);
        return e;
    }

    /** The files inside one app's folder (for the tests). */
    public static Map<String, byte[]> appFiles(byte[] ipk, String appId) throws Exception {
        Map<String, byte[]> out = new LinkedHashMap<>();
        String base = "usr/palm/applications/" + appId + "/";
        for (Member m : readAr(ipk)) {
            if (!m.name.equals("data.tar.gz")) continue;
            for (Entry e : readTarGz(m.data)) {
                if (e.path().startsWith(base) && e.header.isFile()) out.put(e.path().substring(base.length()), e.data);
            }
        }
        return out;
    }
}
