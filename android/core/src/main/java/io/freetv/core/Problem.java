package io.freetv.core;

/** Something that stopped the install, with a message for the person (in Spanish) and a short code for the page. */
public class Problem extends Exception {
    public final String code;

    public Problem(String code, String message) {
        super(message);
        this.code = code;
    }
}
