package io.freetv.core;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * SDB, the connection Samsung's tools use with a TV in Developer Mode (port 26101): ADB's wire format (a 24-byte header whose
 * checksum is a byte sum), streams opened with OPEN, every WRTE answered with OKAY. Only what installing an app needs: run a
 * command, read the TV's capabilities, copy a file. The same as the computer program (connector/src/sdb.js), one thing at a time.
 * The TV only accepts this connection from the address typed in its Developer Mode window ("Host PC IP").
 */
public final class Sdb implements AutoCloseable {
    public static int port = 26101;
    static final int MAX_DATA = 4096;

    private final Socket sock;
    private final DataInputStream in;
    private final OutputStream out;
    private int nextId = 1;
    private int max = MAX_DATA;
    public final String banner;

    private static final class Packet { String cmd; int a0, a1; byte[] data; }
    private static final class Stream { int local, remote; boolean okay, closed; ByteArrayOutputStream data = new ByteArrayOutputStream(); }
    private final Map<Integer, Stream> streams = new HashMap<>();

    private Sdb(String ip, int timeoutMs) throws IOException {
        sock = new Socket();
        sock.connect(new InetSocketAddress(ip, port), timeoutMs);
        sock.setSoTimeout(timeoutMs);
        in = new DataInputStream(sock.getInputStream());
        out = sock.getOutputStream();
        send("CNXN", 0x01000000, MAX_DATA, "host::\0".getBytes(StandardCharsets.UTF_8));
        Packet p = read();
        if (!"CNXN".equals(p.cmd)) throw new IOException("the TV answered " + p.cmd + " instead of connecting");
        max = Math.min(p.a1, MAX_DATA);
        banner = new String(p.data, StandardCharsets.UTF_8).replaceAll("\0+$", "");
        sock.setSoTimeout(15000);
    }

    public static Sdb connect(String ip, int timeoutMs) throws IOException { return new Sdb(ip, timeoutMs); }

    private void send(String cmd, int a0, int a1, byte[] data) throws IOException {
        int c = ByteBuffer.wrap(cmd.getBytes(StandardCharsets.ISO_8859_1)).order(ByteOrder.LITTLE_ENDIAN).getInt();
        long sum = 0;
        for (byte b : data) sum += b & 0xff;
        ByteBuffer h = ByteBuffer.allocate(24 + data.length).order(ByteOrder.LITTLE_ENDIAN);
        h.putInt(c).putInt(a0).putInt(a1).putInt(data.length).putInt((int) sum).putInt(c ^ 0xffffffff).put(data);
        out.write(h.array());
        out.flush();
    }

    private Packet read() throws IOException {
        byte[] head = new byte[24];
        in.readFully(head);
        ByteBuffer h = ByteBuffer.wrap(head).order(ByteOrder.LITTLE_ENDIAN);
        Packet p = new Packet();
        p.cmd = new String(head, 0, 4, StandardCharsets.ISO_8859_1);
        h.position(4);
        p.a0 = h.getInt();
        p.a1 = h.getInt();
        int n = h.getInt();
        p.data = new byte[n];
        in.readFully(p.data);
        return p;
    }

    /** Reads one packet and files it under its stream. */
    private void pump() throws IOException {
        Packet p = read();
        Stream s = streams.get(p.a1);
        if (s == null) return;
        if ("OKAY".equals(p.cmd)) { s.remote = p.a0; s.okay = true; }
        else if ("WRTE".equals(p.cmd)) { s.data.write(p.data); send("OKAY", p.a1, p.a0, new byte[0]); }
        else if ("CLSE".equals(p.cmd)) s.closed = true;
    }

    private Stream open(String service) throws IOException {
        Stream s = new Stream();
        s.local = nextId++;
        streams.put(s.local, s);
        send("OPEN", s.local, 0, (service + "\0").getBytes(StandardCharsets.UTF_8));
        while (!s.okay) {
            if (s.closed) throw new IOException("the TV refused " + service.split(" ")[0]);
            pump();
        }
        s.okay = false;
        return s;
    }

    private void write(Stream s, byte[] data) throws IOException {
        send("WRTE", s.local, s.remote, data);
        while (!s.okay) {
            if (s.closed) throw new IOException("the TV closed the stream");
            pump();
        }
        s.okay = false;
    }

    /** The stream's text until until matches, the TV closes it, or time runs out. */
    private String readUntil(Stream s, Pattern until, int ms) throws IOException {
        long end = System.currentTimeMillis() + ms;
        try {
            while (!s.closed && System.currentTimeMillis() < end) {
                String text = new String(s.data.toByteArray(), StandardCharsets.UTF_8);
                if (until != null && until.matcher(text).find()) break;
                sock.setSoTimeout((int) Math.max(100, end - System.currentTimeMillis()));
                try { pump(); } catch (SocketTimeoutException e) { break; }
            }
        } finally {
            sock.setSoTimeout(15000);
        }
        streams.remove(s.local);
        if (!s.closed) send("CLSE", s.local, s.remote, new byte[0]);
        return new String(s.data.toByteArray(), StandardCharsets.UTF_8);
    }

    /** Runs a command on the TV; until: ends the wait as soon as it shows. */
    public String shell(String command, Pattern until, int ms) throws IOException {
        return readUntil(open("shell:" + command), until, ms);
    }

    /** The TV's capabilities (platform_version, sdk_toolpath, ...). */
    public Map<String, String> capabilities() throws IOException {
        String text = readUntil(open("capability:"), null, 5000);
        Map<String, String> caps = new LinkedHashMap<>();
        for (String line : text.split("\r?\n")) {
            int i = line.indexOf(':');
            if (i > 0) caps.put(line.substring(0, i).trim(), line.substring(i + 1).trim());
        }
        return caps;
    }

    private static byte[] le(int n) { return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(n).array(); }
    private static byte[] cat(byte[]... parts) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        for (byte[] p : parts) o.write(p, 0, p.length);
        return o.toByteArray();
    }

    /** Copies data to path on the TV (sync SEND) and checks the TV's answer. */
    public void push(String path, byte[] data) throws IOException {
        Stream s = open("sync:");
        byte[] spec = (path + "," + 0100644).getBytes(StandardCharsets.UTF_8);
        write(s, cat("SEND".getBytes(StandardCharsets.ISO_8859_1), le(spec.length), spec));
        int step = max - 8;
        for (int i = 0; i < data.length; i += step) {
            int n = Math.min(step, data.length - i);
            byte[] part = new byte[n];
            System.arraycopy(data, i, part, 0, n);
            write(s, cat("DATA".getBytes(StandardCharsets.ISO_8859_1), le(n), part));
        }
        write(s, cat("DONE".getBytes(StandardCharsets.ISO_8859_1), le((int) (System.currentTimeMillis() / 1000))));
        long end = System.currentTimeMillis() + 60000;
        while (s.data.size() < 8 && !s.closed && System.currentTimeMillis() < end) pump();
        byte[] answer = s.data.toByteArray();
        send("WRTE", s.local, s.remote, cat("QUIT".getBytes(StandardCharsets.ISO_8859_1), le(0)));
        streams.remove(s.local);
        if (answer.length < 4 || !"OKAY".equals(new String(answer, 0, 4, StandardCharsets.ISO_8859_1))) {
            String why = answer.length > 8 ? ": " + new String(answer, 8, answer.length - 8, StandardCharsets.UTF_8) : "";
            throw new IOException("the TV did not take the file" + why);
        }
    }

    @Override public void close() { try { sock.close(); } catch (IOException e) { /* gone */ } }
}
