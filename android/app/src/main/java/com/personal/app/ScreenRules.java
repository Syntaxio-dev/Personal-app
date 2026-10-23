package com.personal.app;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The rules of Prysm's app limits, with no Android classes in them so they can be tested on a plain JVM.
 *
 * A limit is a promise: once made it is locked for a number of days and can only be made stricter.
 * The phone side (native) owns the promise; the web side only asks for changes and shows what native kept.
 *
 * config = { limits: [limit], sleep: sleep | null, motto: "" }
 * limit  = { id, name, pkgs[], min (0 = none), night: {from,to} | null, on, created, lockUntil }
 * sleep  = { on, from, to, cats[], extra[], message, created, lockUntil }
 * A change request may carry "lockDays" on an item (new item, or "lock it again"). Times are epoch millis.
 */
final class ScreenRules {
    static final long DAY = 86400000L;
    /** A limit that is only minutes old can still be fixed or removed (a mistake must not cost a month). */
    static final long GRACE = 10 * 60000L;
    static final int MIN_LOCK_DAYS = 7;
    static final int MAX_LOCK_DAYS = 365;
    static final int DEFAULT_LOCK_DAYS = 30;
    static final String DEFAULT_MESSAGE = "Soo ja bhen ke land.";

    private static final Pattern PKG = Pattern.compile("^[A-Za-z0-9_.]{1,160}$");
    private static final Pattern ID = Pattern.compile("^[A-Za-z0-9_-]{1,64}$");
    private static final String[] CATS = {"social", "video", "game", "music"};

    private ScreenRules() {}

    // ---------- time of day ----------
    static int minutesOf(String hhmm) {
        try {
            if (hhmm == null || !hhmm.matches("^\\d{2}:\\d{2}$")) return -1;
            int h = Integer.parseInt(hhmm.substring(0, 2)), m = Integer.parseInt(hhmm.substring(3, 5));
            return h > 23 || m > 59 ? -1 : h * 60 + m;
        } catch (Exception e) {
            return -1;
        }
    }

    /** Is minute-of-day `now` inside [from, to)? The window may cross midnight. */
    static boolean inWindow(int now, int from, int to) {
        if (from < 0 || to < 0 || from == to) return false;
        if (from < to) return now >= from && now < to;
        return now >= from || now < to;
    }

    private static boolean[] minutesSet(int from, int to) {
        boolean[] s = new boolean[1440];
        for (int m = 0; m < 1440; m++) s[m] = inWindow(m, from, to);
        return s;
    }

    /** Does the window (nf..nt) contain every minute of the window (of..ot)? */
    static boolean covers(int nf, int nt, int of, int ot) {
        boolean[] n = minutesSet(nf, nt), o = minutesSet(of, ot);
        for (int m = 0; m < 1440; m++) if (o[m] && !n[m]) return false;
        return true;
    }

    // ---------- days in a fixed time zone (so changing the zone cannot move midnight) ----------
    static long dayNumber(long trustedMs, long tzOffsetMs) {
        return Math.floorDiv(trustedMs + tzOffsetMs, DAY);
    }

    static long dayStart(long trustedMs, long tzOffsetMs) {
        return dayNumber(trustedMs, tzOffsetMs) * DAY - tzOffsetMs;
    }

    static int minuteOfDay(long trustedMs, long tzOffsetMs) {
        return (int) (Math.floorMod(trustedMs + tzOffsetMs, DAY) / 60000L);
    }

    // ---------- a clock that ignores jumps ----------
    /** What is remembered between calls (and between runs). */
    static final class Clock {
        long trusted = 0;   // the last time we believed
        long elapsed = 0;   // SystemClock.elapsedRealtime() at that moment
        long boot = -1;     // boot counter when it was taken
        long offset = 0;    // wall clock minus real time: how far someone has moved the clock
    }

    /**
     * Returns the real time. Time moves with the phone's own uptime counter, which nobody can set,
     * so moving the date or the clock forward or back does nothing. Small corrections (network time) are followed.
     */
    static long step(Clock c, long wall, long elapsedNow, long bootCount, long tolMs) {
        long adj = wall - c.offset;
        // the uptime counter never runs backwards, so if it did (or the boot counter changed) the phone restarted
        if (c.boot != bootCount || elapsedNow < c.elapsed) {
            // first run, or the phone restarted: uptime started again, so go by the clock but never back in time
            if (c.trusted == 0 || adj >= c.trusted) c.trusted = adj;
            else c.offset = wall - c.trusted;
            c.boot = bootCount;
            c.elapsed = elapsedNow;
            return c.trusted;
        }
        long expected = c.trusted + (elapsedNow - c.elapsed);
        long diff = adj - expected;
        if (Math.abs(diff) <= tolMs) {
            c.trusted = adj;
        } else {
            c.offset += diff;
            c.trusted = expected;
        }
        c.elapsed = elapsedNow;
        return c.trusted;
    }

    // ---------- websites ----------
    /** The host of what a browser shows in its address bar ("" when it is not an address). */
    static String hostOf(String text) {
        if (text == null) return "";
        String t = text.trim().toLowerCase(Locale.ROOT);
        if (t.isEmpty() || t.indexOf(' ') >= 0 || t.length() > 300) return "";
        int s = t.indexOf("://");
        if (s >= 0) t = t.substring(s + 3);
        int cut = t.length();
        for (char ch : new char[]{'/', '?', '#'}) {
            int i = t.indexOf(ch);
            if (i >= 0 && i < cut) cut = i;
        }
        t = t.substring(0, cut);
        int at = t.lastIndexOf('@');
        if (at >= 0) t = t.substring(at + 1);
        int colon = t.indexOf(':');
        if (colon >= 0) t = t.substring(0, colon);
        if (t.startsWith("www.")) t = t.substring(4);
        if (t.indexOf('.') < 0 || t.startsWith(".") || t.endsWith(".")) return "";
        return t;
    }

    static boolean hostMatches(String host, String domain) {
        if (host == null || host.isEmpty() || domain == null || domain.isEmpty()) return false;
        return host.equals(domain) || host.endsWith("." + domain);
    }

    // ---------- reading and cleaning what the web side sends ----------
    static boolean validPkg(String p) {
        return p != null && PKG.matcher(p).matches();
    }

    private static List<String> cleanPkgs(JSONArray a) {
        Set<String> out = new LinkedHashSet<>();
        if (a != null) for (int i = 0; i < a.length(); i++) {
            String p = a.optString(i, "");
            if (validPkg(p)) out.add(p);
        }
        return new ArrayList<>(out);
    }

    private static JSONArray arr(List<String> l) {
        JSONArray a = new JSONArray();
        for (String s : l) a.put(s);
        return a;
    }

    private static JSONObject cleanNight(JSONObject n) {
        if (n == null) return null;
        int f = minutesOf(n.optString("from", "")), t = minutesOf(n.optString("to", ""));
        if (f < 0 || t < 0 || f == t) return null;
        return obj("from", n.optString("from"), "to", n.optString("to"));
    }

    private static JSONObject obj(Object... kv) {
        JSONObject o = new JSONObject();
        try {
            for (int i = 0; i + 1 < kv.length; i += 2) o.put((String) kv[i], kv[i + 1]);
        } catch (Exception ignored) {
            // keys are plain strings
        }
        return o;
    }

    private static void put(JSONObject o, String k, Object v) {
        try {
            o.put(k, v);
        } catch (Exception ignored) {
            // plain keys cannot fail
        }
    }

    private static String clip(String s, int n) {
        String t = s == null ? "" : s.trim();
        return t.length() > n ? t.substring(0, n) : t;
    }

    static int clampDays(int d) {
        if (d <= 0) return DEFAULT_LOCK_DAYS;
        return Math.max(MIN_LOCK_DAYS, Math.min(MAX_LOCK_DAYS, d));
    }

    /** A limit as the web side may send it, made safe. Null if it is not usable. */
    static JSONObject cleanLimit(JSONObject in) {
        if (in == null) return null;
        String id = in.optString("id", "");
        if (!ID.matcher(id).matches()) return null;
        List<String> pkgs = cleanPkgs(in.optJSONArray("pkgs"));
        int min = Math.max(0, Math.min(1440, in.optInt("min", 0)));
        JSONObject night = cleanNight(in.optJSONObject("night"));
        if (pkgs.isEmpty() || (min == 0 && night == null)) return null;
        JSONObject taper = cleanTaper(in.optJSONObject("taper"), min);
        JSONObject o = new JSONObject();
        put(o, "id", id);
        put(o, "taper", taper == null ? JSONObject.NULL : taper);
        put(o, "name", clip(in.optString("name", ""), 40));
        put(o, "pkgs", arr(pkgs));
        put(o, "min", min);
        put(o, "night", night == null ? JSONObject.NULL : night);
        put(o, "on", in.optBoolean("on", true));
        put(o, "lockDays", Math.max(0, in.optInt("lockDays", 0)));
        return o;
    }

    static JSONObject cleanSleep(JSONObject in) {
        if (in == null) return null;
        String from = in.optString("from", "23:00"), to = in.optString("to", "06:00");
        if (minutesOf(from) < 0 || minutesOf(to) < 0 || from.equals(to)) return null;
        Set<String> cats = new LinkedHashSet<>();
        JSONArray ca = in.optJSONArray("cats");
        if (ca != null) for (int i = 0; i < ca.length(); i++) {
            String c = ca.optString(i, "");
            for (String known : CATS) if (known.equals(c)) cats.add(c);
        }
        List<String> extra = cleanPkgs(in.optJSONArray("extra"));
        if (cats.isEmpty() && extra.isEmpty()) return null;
        JSONObject o = new JSONObject();
        put(o, "on", in.optBoolean("on", true));
        put(o, "from", from);
        put(o, "to", to);
        put(o, "cats", arr(new ArrayList<>(cats)));
        put(o, "extra", arr(extra));
        String msg = clip(in.optString("message", ""), 120);
        put(o, "message", msg.isEmpty() ? DEFAULT_MESSAGE : msg);
        put(o, "lockDays", Math.max(0, in.optInt("lockDays", 0)));
        return o;
    }

    // ---------- locks ----------
    /** Locked = the promise is still running and the 10 minute "fix a mistake" window is over. */
    static boolean isLocked(JSONObject item, long now) {
        return item != null && item.optLong("lockUntil", 0) > now && now - item.optLong("created", 0) > GRACE;
    }

    private static List<String> union(List<String> a, List<String> b) {
        Set<String> s = new LinkedHashSet<>(a);
        s.addAll(b);
        return new ArrayList<>(s);
    }

    private static List<String> list(JSONArray a) {
        return cleanPkgs(a);
    }

    private static List<String> catList(JSONArray a) {
        List<String> out = new ArrayList<>();
        if (a != null) for (int i = 0; i < a.length(); i++) out.add(a.optString(i, ""));
        return out;
    }

    private static long newLockUntil(JSONObject old, JSONObject inc, long now) {
        int days = inc.optInt("lockDays", 0);
        long asked = days > 0 ? now + clampDays(days) * DAY : 0;
        long kept = old == null ? 0 : old.optLong("lockUntil", 0);
        return Math.max(asked, kept);
    }

    /** One limit: what is kept when the web side asks for `inc` and `old` is what the phone holds. refused[0] counts refusals. */
    private static JSONObject mergeLimit(JSONObject old, JSONObject inc, long now, int[] refused) {
        JSONObject out = new JSONObject();
        put(out, "id", inc.optString("id"));
        if (old == null) {
            put(out, "name", inc.optString("name"));
            put(out, "pkgs", inc.optJSONArray("pkgs"));
            put(out, "min", inc.optInt("min"));
            put(out, "night", inc.opt("night") == null ? JSONObject.NULL : inc.opt("night"));
            put(out, "taper", taperValue(inc.optJSONObject("taper"), now));
            put(out, "on", true);
            put(out, "created", now);
            put(out, "lockUntil", now + clampDays(inc.optInt("lockDays", 0)) * DAY);
            return out;
        }
        put(out, "created", old.optLong("created", now));
        if (!isLocked(old, now)) {
            // not locked (a minute-old mistake, or the promise has run out): anything goes
            put(out, "name", inc.optString("name"));
            put(out, "pkgs", inc.optJSONArray("pkgs"));
            put(out, "min", inc.optInt("min"));
            put(out, "night", inc.opt("night") == null ? JSONObject.NULL : inc.opt("night"));
            JSONObject it = inc.optJSONObject("taper"), ot0 = old.optJSONObject("taper");
            boolean sameTaper = it != null && ot0 != null && it.optInt("step") == ot0.optInt("step") && it.optInt("floor") == ot0.optInt("floor");
            put(out, "taper", taperValue(it, sameTaper ? ot0.optLong("from", now) : now));
            boolean relock = inc.optInt("lockDays", 0) > 0;
            put(out, "on", relock || inc.optBoolean("on", true));
            long until = old.optLong("lockUntil", 0);
            if (relock) until = now + clampDays(inc.optInt("lockDays", 0)) * DAY;
            put(out, "lockUntil", until);
            return out;
        }
        // locked: only stricter changes get through
        int om = old.optInt("min", 0), nm = inc.optInt("min", 0);
        int min = om;
        if (om == 0) min = nm;
        else if (nm > 0 && nm < om) min = nm;
        if (nm != min) refused[0]++;

        List<String> op = list(old.optJSONArray("pkgs")), np = list(inc.optJSONArray("pkgs"));
        if (!np.containsAll(op)) refused[0]++;

        JSONObject on = old.optJSONObject("night"), nn = inc.optJSONObject("night");
        JSONObject night = on;
        if (on == null) night = nn;
        else if (nn != null && covers(minutesOf(nn.optString("from")), minutesOf(nn.optString("to")), minutesOf(on.optString("from")), minutesOf(on.optString("to")))) night = nn;
        boolean nightOk = on == null ? true : (nn != null && night == nn);
        if (!nightOk) refused[0]++;

        boolean wasOn = old.optBoolean("on", true);
        if (wasOn && !inc.optBoolean("on", true)) refused[0]++;

        // a weekly taper can be added or made stricter (bigger step, lower floor), never removed or relaxed
        JSONObject ot = old.optJSONObject("taper"), nt = inc.optJSONObject("taper");
        Object taper = taperValue(ot, ot == null ? now : ot.optLong("from", now));
        if (ot == null) {
            if (nt != null) taper = taperValue(nt, now);
        } else if (nt == null) {
            refused[0]++;
        } else if (nt.optInt("step") >= ot.optInt("step") && nt.optInt("floor") <= ot.optInt("floor")) {
            taper = taperValue(nt, ot.optLong("from", now));
        } else {
            refused[0]++;
        }
        put(out, "taper", taper);

        put(out, "name", inc.optString("name"));
        put(out, "pkgs", arr(union(op, np)));
        put(out, "min", min);
        put(out, "night", night == null ? JSONObject.NULL : night);
        put(out, "on", wasOn || inc.optBoolean("on", true));
        put(out, "lockUntil", newLockUntil(old, inc, now));
        return out;
    }

    private static JSONObject mergeSleep(JSONObject old, JSONObject inc, long now, int[] refused) {
        JSONObject out = new JSONObject();
        if (old == null) {
            put(out, "on", true);
            put(out, "from", inc.optString("from"));
            put(out, "to", inc.optString("to"));
            put(out, "cats", inc.optJSONArray("cats"));
            put(out, "extra", inc.optJSONArray("extra"));
            put(out, "message", inc.optString("message"));
            put(out, "created", now);
            put(out, "lockUntil", now + clampDays(inc.optInt("lockDays", 0)) * DAY);
            return out;
        }
        put(out, "created", old.optLong("created", now));
        if (!isLocked(old, now)) {
            boolean relock = inc.optInt("lockDays", 0) > 0;
            put(out, "on", relock || inc.optBoolean("on", true));
            put(out, "from", inc.optString("from"));
            put(out, "to", inc.optString("to"));
            put(out, "cats", inc.optJSONArray("cats"));
            put(out, "extra", inc.optJSONArray("extra"));
            put(out, "message", inc.optString("message"));
            long until = old.optLong("lockUntil", 0);
            if (relock) until = now + clampDays(inc.optInt("lockDays", 0)) * DAY;
            put(out, "lockUntil", until);
            return out;
        }
        String of = old.optString("from"), ot = old.optString("to"), nf = inc.optString("from"), nt = inc.optString("to");
        boolean wider = covers(minutesOf(nf), minutesOf(nt), minutesOf(of), minutesOf(ot));
        if (!wider) refused[0]++;
        List<String> oc = catList(old.optJSONArray("cats")), nc = catList(inc.optJSONArray("cats"));
        if (!nc.containsAll(oc)) refused[0]++;
        List<String> oe = list(old.optJSONArray("extra")), ne = list(inc.optJSONArray("extra"));
        if (!ne.containsAll(oe)) refused[0]++;
        boolean wasOn = old.optBoolean("on", true);
        if (wasOn && !inc.optBoolean("on", true)) refused[0]++;
        put(out, "on", wasOn || inc.optBoolean("on", true));
        put(out, "from", wider ? nf : of);
        put(out, "to", wider ? nt : ot);
        put(out, "cats", arr(union(oc, nc)));
        put(out, "extra", arr(union(oe, ne)));
        put(out, "message", inc.optString("message"));
        put(out, "lockUntil", newLockUntil(old, inc, now));
        return out;
    }

    /**
     * Applies a change request to what the phone holds and returns what is kept:
     * { limits, sleep, motto, refused } where refused counts the changes the lock said no to.
     */
    static JSONObject merge(JSONObject committed, JSONObject incoming, long now) {
        int[] refused = {0};
        JSONObject cur = committed == null ? new JSONObject() : committed;
        JSONObject req = incoming == null ? new JSONObject() : incoming;
        JSONArray oldLimits = cur.optJSONArray("limits") == null ? new JSONArray() : cur.optJSONArray("limits");
        JSONArray inLimits = req.optJSONArray("limits") == null ? new JSONArray() : req.optJSONArray("limits");

        JSONArray result = new JSONArray();
        Set<String> seen = new LinkedHashSet<>();
        // a request that does not mention the limits at all changes nothing about them
        if (!req.has("limits")) {
            for (int j = 0; j < oldLimits.length(); j++) result.put(oldLimits.optJSONObject(j));
            inLimits = new JSONArray();
            for (int j = 0; j < oldLimits.length(); j++) seen.add(oldLimits.optJSONObject(j).optString("id"));
        }
        for (int i = 0; i < inLimits.length(); i++) {
            JSONObject inc = cleanLimit(inLimits.optJSONObject(i));
            if (inc == null || !seen.add(inc.optString("id"))) continue;
            JSONObject old = null;
            for (int j = 0; j < oldLimits.length(); j++) {
                JSONObject o = oldLimits.optJSONObject(j);
                if (o != null && inc.optString("id").equals(o.optString("id"))) old = o;
            }
            result.put(mergeLimit(old, inc, now, refused));
        }
        // limits the request left out stay while they are locked
        for (int j = 0; j < oldLimits.length(); j++) {
            JSONObject o = oldLimits.optJSONObject(j);
            if (o == null || seen.contains(o.optString("id"))) continue;
            if (isLocked(o, now)) {
                result.put(o);
                refused[0]++;
            }
        }

        JSONObject oldSleep = cur.optJSONObject("sleep");
        JSONObject inSleep = cleanSleep(req.optJSONObject("sleep"));
        JSONObject sleep;
        if (!req.has("sleep")) {
            sleep = oldSleep;
        } else if (inSleep == null) {
            if (oldSleep != null && isLocked(oldSleep, now)) {
                sleep = oldSleep;
                if (req.has("sleep")) refused[0]++;
            } else sleep = null;
        } else sleep = mergeSleep(oldSleep, inSleep, now, refused);

        // a focus session: it can be started, extended and given more groups, but never ended early
        // (one 60 second window is left to undo a wrong tap)
        JSONObject oldFocus = focusRunning(cur.optJSONObject("focus"), now) ? cur.optJSONObject("focus") : null;
        JSONObject focus = oldFocus;
        if (req.has("focus")) {
            if (req.isNull("focus")) {
                if (oldFocus != null) {
                    if (now - oldFocus.optLong("start", 0) <= FOCUS_OOPS_MS) focus = null;
                    else refused[0]++;
                }
            } else {
                JSONObject inc = cleanFocus(req.optJSONObject("focus"));
                if (inc != null) focus = mergeFocus(oldFocus, inc, now);
            }
        }

        JSONObject out = new JSONObject();
        put(out, "limits", result);
        put(out, "sleep", sleep == null ? JSONObject.NULL : sleep);
        put(out, "focus", focus == null ? JSONObject.NULL : focus);
        put(out, "motto", clip(req.optString("motto", cur.optString("motto", "")), 140));
        put(out, "refused", refused[0]);
        return out;
    }

    // ---------- the weekly taper of a limit ----------
    static final long WEEK = 7 * DAY;

    /** A taper asked for: step = minutes less each week (1 to 120), floor = where it stops (5 up to just under min). */
    static JSONObject cleanTaper(JSONObject in, int min) {
        if (in == null || min <= 5) return null;
        int step = in.optInt("step", 0), floor = in.optInt("floor", 0);
        if (step < 1 || step > 120 || floor < 5 || floor >= min) return null;
        return obj("step", step, "floor", floor);
    }

    private static Object taperValue(JSONObject t, long from) {
        if (t == null) return JSONObject.NULL;
        return obj("step", t.optInt("step"), "floor", t.optInt("floor"), "from", from);
    }

    /** The daily minutes that count today: the limit's minutes, less the taper's step for every full week since it began, never below the floor. */
    static int effectiveMin(JSONObject limit, long now) {
        int min = limit.optInt("min", 0);
        JSONObject t = limit.optJSONObject("taper");
        if (min <= 0 || t == null) return min;
        int step = t.optInt("step", 0), floor = t.optInt("floor", 0);
        long from = t.optLong("from", 0);
        if (step <= 0 || floor <= 0 || from <= 0) return min;
        long weeks = Math.max(0, (now - from) / WEEK);
        long eff = Math.max((long) floor, min - weeks * step);
        return (int) Math.min((long) min, eff);
    }

    // ---------- focus sessions ----------
    static final long FOCUS_MIN_MS = 10 * 60000L;
    static final long FOCUS_MAX_MS = 240 * 60000L;
    static final long FOCUS_OOPS_MS = 60000L;

    static boolean focusRunning(JSONObject f, long now) {
        return f != null && f.optLong("until", 0) > now;
    }

    /** A focus request from the web side, made safe: { minutes, label, cats[], extra[] }. Null when it cannot be used. */
    static JSONObject cleanFocus(JSONObject in) {
        if (in == null) return null;
        int minutes = in.optInt("minutes", 0);
        if (minutes <= 0) return null;
        Set<String> cats = new LinkedHashSet<>();
        JSONArray ca = in.optJSONArray("cats");
        if (ca != null) for (int i = 0; i < ca.length(); i++) {
            String c = ca.optString(i, "");
            for (String known : CATS) if (known.equals(c)) cats.add(c);
        }
        List<String> extra = cleanPkgs(in.optJSONArray("extra"));
        if (cats.isEmpty() && extra.isEmpty()) return null;
        JSONObject o = new JSONObject();
        put(o, "minutes", (int) Math.max(FOCUS_MIN_MS / 60000L, Math.min(FOCUS_MAX_MS / 60000L, minutes)));
        put(o, "label", clip(in.optString("label", ""), 40));
        put(o, "cats", arr(new ArrayList<>(cats)));
        put(o, "extra", arr(extra));
        return o;
    }

    private static JSONObject mergeFocus(JSONObject old, JSONObject inc, long now) {
        long ms = inc.optInt("minutes") * 60000L;
        JSONObject out = new JSONObject();
        if (old == null) {
            put(out, "start", now);
            put(out, "until", now + ms);
            put(out, "label", inc.optString("label"));
            put(out, "cats", inc.optJSONArray("cats"));
            put(out, "extra", inc.optJSONArray("extra"));
            return out;
        }
        put(out, "start", old.optLong("start", now));
        put(out, "until", Math.min(Math.max(old.optLong("until", 0), now + ms), now + FOCUS_MAX_MS));
        String label = inc.optString("label");
        put(out, "label", label.isEmpty() ? old.optString("label") : label);
        put(out, "cats", arr(union(catList(old.optJSONArray("cats")), catList(inc.optJSONArray("cats")))));
        put(out, "extra", arr(union(list(old.optJSONArray("extra")), list(inc.optJSONArray("extra")))));
        return out;
    }

    // ---------- sleep estimate ----------
    /**
     * The longest stretch with the screen off inside [w0, w1]. times/types are screen events in time order
     * (16 = screen off, 26 = shut down, 15 = screen on). A stretch still open at the end of the window counts only when
     * windowOver is true (otherwise the night is still going). Returns { start, end } or null when nothing
     * reaches minGap.
     */
    static long[] longestOff(long[] times, int[] types, int n, long w0, long w1, long minGap, boolean windowOver) {
        long bestS = 0, bestE = 0, offStart = -1;
        for (int i = 0; i < n; i++) {
            long t = times[i];
            int ty = types[i];
            if (t < w0) continue;
            if (t > w1) break;
            if (ty == 16 || ty == 26) {
                if (offStart < 0) offStart = t;
            } else if (ty == 15) {
                // the first event being "screen on" means the screen was off before it, since the start of the window
                long s = offStart >= 0 ? offStart : w0;
                if (t - s > bestE - bestS) { bestS = s; bestE = t; }
                offStart = -1;
            }
        }
        if (offStart >= 0 && windowOver && w1 - offStart > bestE - bestS) { bestS = offStart; bestE = w1; }
        return bestE - bestS >= minGap ? new long[]{bestS, bestE} : null;
    }

    // ---------- settings pages that could undo a promise ----------
    private static final String[] GUARD_PKGS = {
            "com.android.settings", "com.vivo.settings", "com.vivo.permissionmanager", "com.iqoo.secure", "com.vivo.abe",
            "com.google.android.permissioncontroller", "com.android.permissioncontroller", "com.google.android.packageinstaller", "com.android.packageinstaller"};
    private static final Pattern DANGER = Pattern.compile("\\b(force stop|uninstall|clear storage|clear data|deactivate)\\b");
    private static final Pattern DATE_TIME = Pattern.compile("\\bdate\\b.*\\btime\\b|\\btime\\b.*\\bdate\\b");

    static boolean isGuardPackage(String pkg) {
        if (pkg == null) return false;
        for (String g : GUARD_PKGS) if (g.equals(pkg)) return true;
        return false;
    }

    private static String low(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT);
    }

    /**
     * Which screen of the system settings (or the installer) is this, if it could be used to undo a promise?
     * Switching the accessibility service or usage access off, deactivating device admin, force-stopping,
     * clearing the data of or uninstalling Prysm, changing the date, time or time zone, developer options and the language
     * of the phone. Null when harmless.
     * title: the window title, cls: its class name, text: the visible text of the window.
     */
    static String guardPage(String pkg, String title, String cls, String text) {
        if (!isGuardPackage(pkg)) return null;
        String t = low(title), c = low(cls), x = low(text);
        if (t.contains("accessibility") || c.contains("accessibility")) return "Accessibility settings";
        if (x.contains("screen time limits")) return "The Prysm accessibility service";
        // (device admin is covered by the last rule: only the page that offers to DEACTIVATE Prysm is shut, so the
        // protection can still be switched back on)
        if (t.contains("usage access") || t.contains("usage data access") || c.contains("usageaccess")) return "Usage access";
        if (DATE_TIME.matcher(t).find() || c.contains("datetime") || t.contains("time zone") || t.contains("timezone")) return "Date and time settings";
        // USB debugging would let a computer switch the service off, and a phone in another language would hide the
        // English titles this guard reads
        if (t.contains("developer options") || c.contains("developmentsettings")) return "Developer options";
        if (t.contains("language")) return "Language settings";
        if (x.contains("prysm") && DANGER.matcher(x).find()) return "Prysm app settings";
        return null;
    }

    /** Is any promise still running (past the "fix a mistake" window)? Then the settings that could undo it are guarded. */
    static boolean anyLocked(JSONObject config, long now) {
        if (config == null) return false;
        JSONArray l = config.optJSONArray("limits");
        if (l != null) for (int i = 0; i < l.length(); i++) if (isLocked(l.optJSONObject(i), now)) return true;
        if (focusRunning(config.optJSONObject("focus"), now)) return true;
        return isLocked(config.optJSONObject("sleep"), now);
    }
}
