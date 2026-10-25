package io.freetv.core;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.Base64;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * Just enough of a WebSocket client (RFC 6455) for the TV's remote-control service: text messages, both ways, on ws:// or
 * wss://. For wss the TV's certificate is accepted as it is: it is signed by LG's own CA and only the TV's local address is used.
 */
final class WebSocketClient implements AutoCloseable {
    private final Socket socket;
    private final DataInputStream in;
    private final OutputStream out;
    private final SecureRandom random = new SecureRandom();

    private WebSocketClient(Socket socket, DataInputStream in) throws IOException {
        this.socket = socket;
        this.in = in;
        this.out = socket.getOutputStream();
    }

    static SSLContext trustingTls() throws Exception {
        TrustManager[] trustAll = {new X509TrustManager() {
            @Override public void checkClientTrusted(X509Certificate[] chain, String authType) {}
            @Override public void checkServerTrusted(X509Certificate[] chain, String authType) {}
            @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
        }};
        SSLContext ssl = SSLContext.getInstance("TLS");
        ssl.init(null, trustAll, new SecureRandom());
        return ssl;
    }

    static WebSocketClient connect(String host, int port, boolean tls, int timeoutMs) throws Exception {
        Socket raw = new Socket();
        raw.connect(new InetSocketAddress(host, port), timeoutMs);
        Socket s = raw;
        if (tls) {
            SSLSocket ssl = (SSLSocket) trustingTls().getSocketFactory().createSocket(raw, host, port, true);
            ssl.setSoTimeout(timeoutMs);
            ssl.startHandshake();
            s = ssl;
        }
        s.setSoTimeout(timeoutMs);
        byte[] nonce = new byte[16];
        new SecureRandom().nextBytes(nonce);
        String key = Base64.getEncoder().encodeToString(nonce);
        String request = "GET / HTTP/1.1\r\nHost: " + host + ":" + port + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                + "Sec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n\r\n";
        s.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
        s.getOutputStream().flush();
        DataInputStream in = new DataInputStream(new BufferedInputStream(s.getInputStream()));
        String status = readLine(in);
        if (!status.matches("HTTP/1\\.1 101.*")) { s.close(); throw new IOException("not a WebSocket: " + status); }
        String accept = null, line;
        while (!(line = readLine(in)).isEmpty()) {
            int c = line.indexOf(':');
            if (c > 0 && line.substring(0, c).trim().equalsIgnoreCase("Sec-WebSocket-Accept")) accept = line.substring(c + 1).trim();
        }
        String want = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1")
                .digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.US_ASCII)));
        if (!want.equals(accept)) { s.close(); throw new IOException("bad WebSocket handshake"); }
        return new WebSocketClient(s, in);
    }

    private static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int c;
        while ((c = in.read()) >= 0 && c != '\n') if (c != '\r') sb.append((char) c);
        if (c < 0 && sb.length() == 0) throw new IOException("connection closed");
        return sb.toString();
    }

    synchronized void send(String text) throws IOException { frame(0x1, text.getBytes(StandardCharsets.UTF_8)); }

    private synchronized void frame(int opcode, byte[] payload) throws IOException {
        ByteArrayOutputStream f = new ByteArrayOutputStream();
        f.write(0x80 | opcode);
        int n = payload.length;
        if (n < 126) f.write(0x80 | n);
        else if (n < 65536) { f.write(0x80 | 126); f.write(n >>> 8); f.write(n & 0xff); }
        else { f.write(0x80 | 127); for (int i = 7; i >= 0; i--) f.write((int) (((long) n >>> (8 * i)) & 0xff)); }
        byte[] mask = new byte[4];
        random.nextBytes(mask);
        f.write(mask, 0, 4);
        for (int i = 0; i < n; i++) f.write(payload[i] ^ mask[i & 3]);
        out.write(f.toByteArray());
        out.flush();
    }

    /** The next text message; waits up to ms. Throws SocketTimeoutException when nothing came, IOException when closed. */
    String receive(int ms) throws IOException {
        socket.setSoTimeout(ms);
        ByteArrayOutputStream message = new ByteArrayOutputStream();
        while (true) {
            int b0 = in.readUnsignedByte();
            int b1 = in.readUnsignedByte();
            long n = b1 & 0x7f;
            if (n == 126) n = in.readUnsignedShort();
            else if (n == 127) n = in.readLong();
            byte[] mask = null;
            if ((b1 & 0x80) != 0) { mask = new byte[4]; in.readFully(mask); }
            if (n > 64L * 1024 * 1024) throw new IOException("message too big");
            byte[] payload = new byte[(int) n];
            in.readFully(payload);
            if (mask != null) for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
            int opcode = b0 & 0x0f;
            if (opcode == 0x8) throw new IOException("closed by the TV");
            if (opcode == 0x9) { frame(0xA, payload); continue; }          // ping -> pong
            if (opcode == 0xA) continue;
            message.write(payload, 0, payload.length);
            if ((b0 & 0x80) != 0 && opcode != 0x2) return new String(message.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    @Override public void close() {
        try { frame(0x8, new byte[0]); } catch (Exception e) { /* gone */ }
        try { socket.close(); } catch (Exception e) { /* gone */ }
    }
}
