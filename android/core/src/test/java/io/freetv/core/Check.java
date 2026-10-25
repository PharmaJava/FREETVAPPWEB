package io.freetv.core;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Arrays;

/** A very small test runner (no test library needed): runs every public method whose name starts with "test". */
public final class Check {
    private Check() {}

    static void assertEquals(Object want, Object got) { assertEquals("", want, got); }
    static void assertEquals(String why, Object want, Object got) {
        if (want == null ? got != null : !want.equals(got)) throw new AssertionError(why + " expected <" + want + "> but was <" + got + ">");
    }
    static void assertTrue(boolean ok) { assertTrue("", ok); }
    static void assertTrue(String why, boolean ok) { if (!ok) throw new AssertionError("expected true " + why); }
    static void assertFalse(boolean bad) { assertFalse("", bad); }
    static void assertFalse(String why, boolean bad) { if (bad) throw new AssertionError("expected false " + why); }
    static void assertArrayEquals(byte[] want, byte[] got) { if (!Arrays.equals(want, got)) throw new AssertionError("arrays differ"); }

    public static void main(String[] args) throws Exception {
        int failed = 0, passed = 0;
        for (String name : args) {
            Class<?> c = Class.forName(name);
            for (Method m : c.getDeclaredMethods()) {
                if (!m.getName().startsWith("test")) continue;
                try {
                    m.invoke(c.getDeclaredConstructor().newInstance());
                    passed++;
                    System.out.println("PASSED " + c.getSimpleName() + "." + m.getName());
                } catch (InvocationTargetException e) {
                    failed++;
                    System.out.println("FAILED " + c.getSimpleName() + "." + m.getName());
                    e.getCause().printStackTrace(System.out);
                }
            }
        }
        System.out.println(passed + " passed, " + failed + " failed");
        if (failed > 0 || passed == 0) System.exit(1);
    }
}
