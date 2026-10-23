package com.personal.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Apps that belong together (Instagram and Instagram Lite, YouTube and a modded YouTube), the kind of app each one is,
 * and the websites of each. Limiting one app limits its whole family and its websites too, so a second copy of the
 * same service is not a way around the limit. No Android classes here, so it can be tested on a plain JVM.
 */
final class Families {
    static final class Fam {
        final String name;
        final String cat;
        final List<String> pkgs;
        final List<String> needles;
        final List<String> domains;

        Fam(String name, String cat, String[] pkgs, String[] needles, String[] domains) {
            this.name = name;
            this.cat = cat;
            this.pkgs = Arrays.asList(pkgs);
            this.needles = Arrays.asList(needles);
            this.domains = Arrays.asList(domains);
        }

        boolean has(String pkg) {
            if (pkgs.contains(pkg)) return true;
            for (String n : needles) if (pkg.contains(n)) return true;
            return false;
        }
    }

    private static final String[] NONE = {};

    private static final List<Fam> ALL = Arrays.asList(
            new Fam("instagram", "social", new String[]{"com.instagram.android", "com.instagram.lite", "com.instagram.barcelona"}, new String[]{"instagram"}, new String[]{"instagram.com", "threads.net", "threads.com"}),
            new Fam("facebook", "social", new String[]{"com.facebook.katana", "com.facebook.lite", "com.facebook.pages.app"}, NONE, new String[]{"facebook.com", "fb.com", "fb.watch"}),
            new Fam("snapchat", "social", new String[]{"com.snapchat.android"}, new String[]{"snapchat"}, new String[]{"snapchat.com"}),
            new Fam("twitter", "social", new String[]{"com.twitter.android", "com.twitter.android.lite"}, NONE, new String[]{"twitter.com", "x.com"}),
            new Fam("reddit", "social", new String[]{"com.reddit.frontpage"}, new String[]{"reddit"}, new String[]{"reddit.com", "redd.it"}),
            new Fam("pinterest", "social", new String[]{"com.pinterest"}, NONE, new String[]{"pinterest.com"}),
            new Fam("tiktok", "social", new String[]{"com.zhiliaoapp.musically", "com.ss.android.ugc.trill"}, new String[]{"tiktok"}, new String[]{"tiktok.com"}),
            new Fam("sharechat", "social", new String[]{"in.mohalla.sharechat", "in.mohalla.video", "com.next.innovation.takatak"}, NONE, new String[]{"sharechat.com", "mojapp.in"}),
            new Fam("youtube", "video", new String[]{"com.google.android.youtube", "com.google.android.apps.youtube.mango", "app.revanced.android.youtube", "com.vanced.android.youtube"}, NONE, new String[]{"youtube.com", "youtu.be"}),
            new Fam("netflix", "video", new String[]{"com.netflix.mediaclient"}, NONE, new String[]{"netflix.com"}),
            new Fam("prime", "video", new String[]{"com.amazon.avod.thirdpartyclient", "com.amazon.avod"}, NONE, new String[]{"primevideo.com"}),
            new Fam("hotstar", "video", new String[]{"in.startv.hotstar", "in.startv.hotstar.dplus", "com.jio.jiohotstar"}, NONE, new String[]{"hotstar.com", "jiohotstar.com"}),
            new Fam("jiocinema", "video", new String[]{"com.jio.media.ondemand"}, NONE, new String[]{"jiocinema.com"}),
            new Fam("sonyliv", "video", new String[]{"com.sonyliv"}, NONE, new String[]{"sonyliv.com"}),
            new Fam("zee5", "video", new String[]{"com.graymatrix.did"}, NONE, new String[]{"zee5.com"}),
            new Fam("mxplayer", "video", new String[]{"com.mxtech.videoplayer.ad"}, NONE, new String[]{"mxplayer.in"}),
            new Fam("twitch", "video", new String[]{"tv.twitch.android.app"}, NONE, new String[]{"twitch.tv"}),
            new Fam("ytmusic", "music", new String[]{"com.google.android.apps.youtube.music"}, NONE, new String[]{"music.youtube.com"}),
            new Fam("spotify", "music", new String[]{"com.spotify.music"}, NONE, new String[]{"spotify.com"}),
            new Fam("gaana", "music", new String[]{"com.gaana"}, NONE, new String[]{"gaana.com"}),
            new Fam("jiosaavn", "music", new String[]{"com.jio.media.jiobeats"}, NONE, new String[]{"jiosaavn.com"}),
            new Fam("wynk", "music", new String[]{"com.bsbportal.music"}, NONE, new String[]{"wynk.in"}),
            new Fam("games", "game", new String[]{"com.pubg.imobile", "com.tencent.ig", "com.dts.freefireth", "com.dts.freefiremax", "com.activision.callofduty.shooter", "com.ludo.king",
                    "com.king.candycrushsaga", "com.kiloo.subwaysurf", "com.supercell.clashofclans", "com.supercell.clashroyale", "com.supercell.brawlstars", "com.roblox.client", "com.mojang.minecraftpe"},
                    NONE, new String[]{"roblox.com", "poki.com", "crazygames.com"})
    );

    // Messengers, mail and calls are never part of a group: a night lock must not stop a WhatsApp call or an email.
    // (Android files many of them under "social", so that label cannot be trusted either.)
    private static final List<String> COMMS = Arrays.asList(
            "com.whatsapp", "com.whatsapp.w4b", "org.telegram.messenger", "org.telegram.messenger.web", "org.thunderdog.challegram",
            "org.thoughtcrime.securesms", "com.google.android.gm", "com.google.android.apps.tachyon", "com.google.android.apps.messaging",
            "com.microsoft.office.outlook", "us.zoom.videomeetings", "com.microsoft.teams", "com.Slack", "com.truecaller", "com.skype.raider",
            "com.viber.voip", "jp.naver.line.android", "com.google.android.apps.meetings", "com.facebook.orca", "com.facebook.mlite", "com.android.email", "com.samsung.android.email.provider");

    private Families() {}

    static boolean isComms(String pkg) {
        return pkg != null && COMMS.contains(pkg);
    }

    /** The family a package belongs to, or null. */
    static Fam of(String pkg) {
        if (pkg == null) return null;
        // YouTube Music has "youtube" in its name but is its own family (checked first)
        for (Fam f : ALL) if (f.pkgs.contains(pkg)) return f;
        for (Fam f : ALL) if (!f.needles.isEmpty() && f.has(pkg)) return f;
        return null;
    }

    static boolean sameFamily(String a, String b) {
        if (a == null || b == null) return false;
        if (a.equals(b)) return true;
        Fam fa = of(a), fb = of(b);
        return fa != null && fa == fb;
    }

    /**
     * "social", "video", "game", "music" or "". Known families win; messengers and mail are never in a group; otherwise
     * what the app declares about itself (android.content.pm.ApplicationInfo.category: 0 game, 1 audio, 2 video) and its
     * game flag. "Social" is NOT taken from the declaration, because Android files messengers under it.
     */
    static String categoryOf(String pkg, int declared, boolean gameFlag) {
        Fam f = of(pkg);
        if (f != null) return f.cat;
        if (isComms(pkg)) return "";
        if (declared == 2) return "video";
        if (declared == 0 || gameFlag) return "game";
        if (declared == 1) return "music";
        return "";
    }

    /** Websites of the families the given packages belong to. */
    static Set<String> domainsOf(Collection<String> pkgs) {
        Set<String> out = new LinkedHashSet<>();
        if (pkgs != null) for (String p : pkgs) {
            Fam f = of(p);
            if (f != null) out.addAll(f.domains);
        }
        return out;
    }

    /** Websites of every family in the given categories (a sleep lock covers the sites of apps you do not even have). */
    static Set<String> domainsOfCategories(Collection<String> cats) {
        Set<String> out = new LinkedHashSet<>();
        if (cats != null) for (Fam f : ALL) if (cats.contains(f.cat)) out.addAll(f.domains);
        return out;
    }

    static boolean anyDomainMatches(Collection<String> domains, String host) {
        if (host == null || host.isEmpty()) return false;
        for (String d : domains) if (ScreenRules.hostMatches(host.toLowerCase(Locale.ROOT), d)) return true;
        return false;
    }

    static List<String> names() {
        List<String> out = new ArrayList<>();
        for (Fam f : ALL) out.add(f.name);
        return out;
    }
}
