package com.personal.app;

import java.util.Random;

/** The lines shown on the block screen. Written for Prysm, so none of them is attributed to anyone. */
final class Quotes {
    private static final String[] GENERAL = {
            "Discipline is choosing what you want most over what you want right now.",
            "You are not missing out. You are choosing to build something.",
            "Every scroll is a vote for the person you used to be.",
            "Motivation gets you started. Boundaries keep you going.",
            "The habit you break today is the freedom you keep for life.",
            "Your future self is watching what you do with this minute.",
            "Small promises kept to yourself become a strong character.",
            "Comfort is cheap. Growth costs a little discomfort every day.",
            "You do not need more time. You need less distraction.",
            "Be proud of the limit you set. It means you take your life seriously.",
            "Nobody ever looked back on life and wished they had scrolled more.",
            "Close the app. Open your day.",
            "The urge passes in a few minutes. The regret does not.",
            "A focused hour beats a distracted day.",
            "You decided this when you were thinking clearly. Trust that person.",
            "Strong people do not feel less temptation. They simply keep their word.",
            "What you do repeatedly is who you become. Choose well.",
            "Your attention is the most valuable thing you own. Spend it on purpose.",
            "Boredom is where ideas begin. Stay with it.",
            "Win the next ten minutes. Then do it again.",
            "Dreams do not work unless you do. Put the phone down.",
            "Be the person who finishes things, not the person who feeds on feeds.",
            "The best time to start was yesterday. The next best is right now, off this app.",
            "Every limit you keep makes the next one easier.",
            "Your goals are quietly waiting for you. Go and meet them.",
            "Real life has better content. Go and make some.",
            "You are one decision away from a better day. This is that decision.",
            "Self-control is just self-respect in action.",
            "Do it for the version of you who is proud of how this year ended.",
            "Pain is temporary. Wasted years are permanent.",
            "Do something today that your future self will thank you for.",
            "Limits are not a cage. They are the walls of a strong house.",
            "Tired of who you were while scrolling? Then stop scrolling.",
            "Less noise. More work. Better life.",
            "Today is a day you will never get back. Make it count for something.",
            "Say no to the easy thing so you can say yes to the great thing.",
            "You are building a life, not killing time.",
            "Progress hides in the boring hours. Show up for them.",
            "A calm mind and a quiet phone make a powerful pair.",
            "The only way to break a habit is to keep breaking it. Again, now.",
            "Winners are made in the moments no one is watching. This is one of them.",
            "Your life is not a feed. Look up.",
            "Hard choices, easy life. Easy choices, hard life.",
            "Your phone is a tool. Do not let it become the master.",
            "Stay hungry for your goals, not for notifications.",
            "Today's discipline is tomorrow's confidence.",
            "You said you wanted change. This is what it feels like.",
            "No one is coming to save your time. You have to.",
            "Be bored. Be present. Be better.",
            "Someone with your goals would not be here. Go be that person.",
    };

    private static final String[] SLEEP = {
            "Sleep is the cheapest performance booster you will ever get.",
            "Tomorrow's energy is built tonight. Put the phone down.",
            "Nothing on this screen is worth tomorrow's focus.",
            "Rest is part of the work. Go and do it properly.",
            "Your brain repairs itself while you sleep. Let it.",
            "Late nights make slow mornings. Choose the morning you want.",
            "The version of you with a full night's sleep gets things done.",
            "You will still be you tomorrow. Better rested.",
            "Good sleep, good mood, good decisions. In that order.",
            "The feed will still be there tomorrow. Your health might not wait.",
    };

    private static final Random RNG = new Random();

    private Quotes() {}

    static String random() {
        return GENERAL[RNG.nextInt(GENERAL.length)];
    }

    static String sleep() {
        return SLEEP[RNG.nextInt(SLEEP.length)];
    }

    static int count() {
        return GENERAL.length + SLEEP.length;
    }
}
