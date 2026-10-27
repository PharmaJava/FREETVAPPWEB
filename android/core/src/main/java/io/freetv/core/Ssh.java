package io.freetv.core;

import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.JSchException;
import com.jcraft.jsch.KeyPair;
import com.jcraft.jsch.Session;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Properties;

/**
 * The TV's Developer Mode SSH session (port 9922, user "prisoner"), the same one LG's ares-install uses. The key comes from
 * the TV's Key Server (port 9991) and is unlocked with the passphrase in memory: it is never written to the phone and never shown.
 */
public final class Ssh implements AutoCloseable {
    public static int keyServerPort = 9991;
    public static int sshPort = 9922;

    /** Whether a command should stop early: return true from it. */
    public interface OnData { boolean onData(String text); }

    public static final class Result {
        public final int code;
        public final String out;
        public final String err;
        Result(int code, String out, String err) { this.code = code; this.out = out; this.err = err; }
    }

    private final Session session;

    private Ssh(Session session) { this.session = session; }

    /** The Developer Mode key, encrypted with the passphrase, as the TV's Key Server gives it. */
    public static byte[] fetchKey(String ip) throws Problem {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL("http://" + ip + ":" + keyServerPort + "/webos_rsa").openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            if (c.getResponseCode() != 200) throw new Problem("keyserver", "La tele no da la clave (respuesta " + c.getResponseCode() + ").");
            InputStream in = c.getInputStream();
            try { return readAll(in, 64 * 1024); } finally { in.close(); }
        } catch (Problem p) {
            throw p;
        } catch (Exception e) {
            throw new Problem("keyserver", "No llego al «Key Server» de la tele. En la app Developer Mode de la tele, activa «Key Server» y deja esa pantalla abierta.");
        }
    }

    /** Unlocks the key with the passphrase the person typed. Returns the plain key (PEM), kept in memory only.
     *  The TV shows capital letters, but people type small ones: as typed, in capitals and in small letters are all tried. */
    public static byte[] unlockKey(byte[] encrypted, String passphrase) throws Problem {
        String typed = passphrase == null ? "" : passphrase.trim();
        for (String candidate : new String[] { typed, typed.toUpperCase(java.util.Locale.ROOT), typed.toLowerCase(java.util.Locale.ROOT) }) {
            try {
                KeyPair kp = KeyPair.load(new JSch(), encrypted, null);
                if (kp.isEncrypted() && !kp.decrypt(candidate)) { kp.dispose(); continue; }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                kp.writePrivateKey(out);
                kp.dispose();
                return out.toByteArray();
            } catch (JSchException e) {
                // the next one
            }
        }
        throw new Problem("passphrase", "La passphrase no es correcta. Mírala otra vez en la app Developer Mode de la tele "
                + "(son 6 letras y números; cambia si reinicias el Key Server).");
    }

    public static Ssh connect(String ip, byte[] plainKey) throws Problem {
        try {
            JSch jsch = new JSch();
            jsch.addIdentity("tv", plainKey, null, null);
            Session s = jsch.getSession("prisoner", ip, sshPort);
            Properties config = new Properties();
            config.put("StrictHostKeyChecking", "no");   // the TV makes its own host key; there is nothing to check it against
            // What older webOS SSH servers speak (ares-cli asks for the same).
            config.put("kex", JSch.getConfig("kex") + ",diffie-hellman-group14-sha1,diffie-hellman-group1-sha1");
            config.put("server_host_key", JSch.getConfig("server_host_key") + ",ssh-rsa");
            config.put("PubkeyAcceptedAlgorithms", JSch.getConfig("PubkeyAcceptedAlgorithms") + ",ssh-rsa");
            s.setConfig(config);
            s.connect(30000);
            return new Ssh(s);
        } catch (JSchException e) {
            throw new Problem("ssh", "No pude abrir la conexión del Modo Desarrollador con la tele (" + e.getMessage() + "). "
                    + "Comprueba que «Dev Mode Status» está en ON.");
        }
    }

    public Result exec(String command) throws Exception { return exec(command, null, null); }

    /** Runs a command. onData sees the output as it comes and can end it early; stdin (if any) is sent and closed. */
    public Result exec(String command, byte[] stdin, OnData onData) throws Exception {
        ChannelExec ch = (ChannelExec) session.openChannel("exec");
        ch.setCommand(command);
        ByteArrayOutputStream err = new ByteArrayOutputStream();
        ch.setErrStream(err);
        InputStream in = ch.getInputStream();
        OutputStream stdinStream = ch.getOutputStream();
        ch.connect(15000);
        if (stdin != null) stdinStream.write(stdin);
        stdinStream.close();
        StringBuilder out = new StringBuilder();
        byte[] buf = new byte[8192];
        boolean stopped = false;
        while (true) {
            int n = in.read(buf);
            if (n < 0) break;
            String text = new String(buf, 0, n, StandardCharsets.UTF_8);
            out.append(text);
            if (out.length() > 2000000) out.delete(0, out.length() - 1000000);
            if (onData != null && onData.onData(text)) { stopped = true; break; }
        }
        int code = stopped ? 0 : ch.getExitStatus();
        ch.disconnect();
        return new Result(code < 0 ? 0 : code, out.toString(), new String(err.toByteArray(), StandardCharsets.UTF_8));
    }

    /** Single quotes around a value that cannot hold any. */
    public static String q(String value) {
        if (value.matches("(?s).*['\\\\\\n\\r`].*")) throw new IllegalArgumentException("valor no válido");
        return "'" + value + "'";
    }

    /** Copies data to path on the TV (through `cat`, as ares-install does), checking its SHA-256 there before it replaces anything. */
    public void put(String path, byte[] data, String mode) throws Exception {
        String tmp = path + ".freetv-tmp";
        exec("umask 077; cat > " + q(tmp), data, null);
        String want = sha256(data);
        Result r = exec("/bin/chmod " + mode + " " + q(tmp) + " && sha256sum " + q(tmp));
        String got = r.out.trim().split("\\s+")[0];
        if (!got.equals(want)) {
            exec("/bin/rm -f " + q(tmp));
            String name = path.substring(path.lastIndexOf('/') + 1);
            throw new Problem("transfer", "Un archivo no llegó entero a la tele (" + name + "). Vuelve a intentarlo.");
        }
        exec("/bin/mv -f " + q(tmp) + " " + q(path));
    }

    @Override public void close() { session.disconnect(); }

    static String sha256(byte[] data) throws Exception {
        byte[] d = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder sb = new StringBuilder();
        for (byte b : d) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    static byte[] readAll(InputStream in, int max) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
            if (out.size() > max) throw new java.io.IOException("too big");
        }
        return out.toByteArray();
    }
}
