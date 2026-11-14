package com.personal.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.CancellationSignal;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.RequiresApi;

import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Fingerprint unlock for the Vault.
 *
 * The Vault's data key (32 bytes, made and used in JS) is never kept readable. After the user typed the Vault PIN once, JS
 * hands the key over, it is locked with an Android Keystore key that can only be used right after a fingerprint
 * (setUserAuthenticationRequired, strong biometrics, one use at a time through a CryptoObject), and only the locked copy is
 * stored. Unlocking = a fingerprint prompt that releases the key to JS. A new fingerprint added to the phone invalidates the
 * Keystore key (setInvalidatedByBiometricEnrollment), then the PIN is needed again and fingerprint unlock is switched off.
 * The PIN keeps working at all times. Needs Android 11 or newer (strong-biometric authenticator flags).
 *
 * No Capacitor classes in here on purpose: the file stands alone and can be compiled against android.jar.
 */
@RequiresApi(api = Build.VERSION_CODES.R)
final class VaultBio {
    private VaultBio() { }

    interface Done {
        void ok(String data);
        /** code: "cancel" (user backed out), "invalid" (fingerprints changed / key gone), "none" (nothing enrolled), "error" */
        void fail(String code);
    }

    private static final String ALIAS = "prysm_vault_bio";
    private static final String PREFS = "prysm_vault_bio";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORM = "AES/GCM/NoPadding";

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean available(Context c) {
        BiometricManager bm = c.getSystemService(BiometricManager.class);
        return bm != null && bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS;
    }

    static boolean enrolled(Context c) {
        SharedPreferences p = prefs(c);
        return p.contains("ct") && p.contains("iv") && keyExists();
    }

    private static boolean keyExists() {
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            return ks.containsAlias(ALIAS);
        } catch (Exception e) {
            return false;
        }
    }

    static void disable(Context c) {
        prefs(c).edit().clear().apply();
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS);
        } catch (Exception e) { /* nothing to delete */ }
    }

    private static SecretKey makeKey() throws Exception {
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true)
                .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
                .setInvalidatedByBiometricEnrollment(true)
                .build());
        return kg.generateKey();
    }

    private static SecretKey loadKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        return (SecretKey) ks.getKey(ALIAS, null);
    }

    /** Locks the data key (raw bytes) behind a fingerprint and stores only the locked copy. */
    static void enroll(final Activity a, final byte[] raw, final Done cb) {
        try {
            disable(a);
            SecretKey key = makeKey();
            Cipher cipher = Cipher.getInstance(TRANSFORM);
            cipher.init(Cipher.ENCRYPT_MODE, key);
            prompt(a, "Turn on fingerprint unlock", "Touch the sensor to confirm", cipher, new Done() {
                @Override public void ok(String ignored) { /* handled below */ }
                @Override public void fail(String code) { disable(a); cb.fail(code); }
            }, new Finish() {
                @Override public void run(Cipher c) throws Exception {
                    byte[] ct = c.doFinal(raw);
                    prefs(a).edit()
                            .putString("iv", Base64.encodeToString(c.getIV(), Base64.NO_WRAP))
                            .putString("ct", Base64.encodeToString(ct, Base64.NO_WRAP))
                            .apply();
                    cb.ok("");
                }
            });
        } catch (Exception e) {
            disable(a);
            cb.fail("error");
        }
    }

    /** Asks for a fingerprint and hands the data key (base64) to the callback. */
    static void unlock(final Activity a, final Done cb) {
        try {
            SharedPreferences p = prefs(a);
            String iv = p.getString("iv", null), ct = p.getString("ct", null);
            if (iv == null || ct == null || !keyExists()) { disable(a); cb.fail("invalid"); return; }
            final byte[] ctBytes = Base64.decode(ct, Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance(TRANSFORM);
            cipher.init(Cipher.DECRYPT_MODE, loadKey(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            prompt(a, "Unlock Vault", "Touch the fingerprint sensor", cipher, cb, new Finish() {
                @Override public void run(Cipher c) throws Exception {
                    cb.ok(Base64.encodeToString(c.doFinal(ctBytes), Base64.NO_WRAP));
                }
            });
        } catch (KeyPermanentlyInvalidatedException e) {
            // a fingerprint was added or removed on the phone: the key is gone for good, the PIN is needed
            disable(a);
            cb.fail("invalid");
        } catch (Exception e) {
            cb.fail("error");
        }
    }

    private interface Finish {
        void run(Cipher authenticated) throws Exception;
    }

    private static void prompt(final Activity a, String title, String subtitle, Cipher cipher, final Done cb, final Finish finish) {
        a.runOnUiThread(() -> {
            try {
                BiometricPrompt bp = new BiometricPrompt.Builder(a)
                        .setTitle(title)
                        .setSubtitle(subtitle)
                        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                        .setNegativeButton("Use PIN", a.getMainExecutor(), (dialog, which) -> cb.fail("cancel"))
                        .build();
                bp.authenticate(new BiometricPrompt.CryptoObject(cipher), new CancellationSignal(), a.getMainExecutor(),
                        new BiometricPrompt.AuthenticationCallback() {
                            @Override
                            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                                try {
                                    finish.run(result.getCryptoObject().getCipher());
                                } catch (Exception e) {
                                    cb.fail("error");
                                }
                            }

                            @Override
                            public void onAuthenticationError(int code, CharSequence msg) {
                                // BiometricConstants values: 5 = canceled, 10 = user canceled, 13 = negative button, 11 = nothing enrolled
                                boolean backed = code == 5 || code == 10 || code == 13;
                                cb.fail(backed ? "cancel" : code == 11 ? "none" : "error");
                            }
                        });
            } catch (Exception e) {
                cb.fail("error");
            }
        });
    }
}
