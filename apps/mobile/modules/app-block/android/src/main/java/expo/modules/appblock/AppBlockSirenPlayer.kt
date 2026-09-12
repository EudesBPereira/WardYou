package expo.modules.appblock

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.Looper

/**
 * Anti-theft siren playback engine (see AntifurtoAlarmOverlay.tsx for the JS
 * side and the 2026-09-12 field report this answers).
 *
 * Two bugs were reported after the screen-lock itself started working:
 *
 *  1. "Bloqueou, mas a sirene não tocou" (intermittent). Root cause: the old
 *     JS path called `setAudioModeAsync(...).catch(() => {})` — fire-and-
 *     forget — then `player.play()` immediately, then scheduled the screen
 *     lock on an independent timer. Three uncoordinated async things racing.
 *     Worse, once the screen locks the RN JS timer manager can pause ALL JS
 *     timers (confirmed 2026-09-12 as the root cause of a separate
 *     trip-location bug the same day) — so anything still depending on a JS
 *     `await`/`setTimeout` after that point is not reliable.
 *
 *  2. "O ladrão não pode abaixar o volume." `player.volume` (expo-audio) is
 *     player-level gain, not the system STREAM_ALARM volume — the physical
 *     volume-down button was untouched by it.
 *
 * This class fixes both by moving the whole siren OFF the JS runtime:
 *  - `start()` builds and prepares the MediaPlayer with `prepare()`
 *    (SYNCHRONOUS — blocks the calling thread until the engine is genuinely
 *    ready), then calls `start()` before returning. By the time this
 *    function returns `true`, the siren is audibly playing — there is
 *    nothing left to race against the screen lock. See
 *    AppBlockModule.startSiren(), called synchronously (JSI, like
 *    nativeLog()) so the JS caller only schedules the lock AFTER this is
 *    confirmed.
 *  - Volume enforcement runs as a `Handler(Looper.getMainLooper())` loop —
 *    Android's native main-thread Looper, NOT a JS timer — so it keeps
 *    ticking after the screen locks and the RN JS timers pause. Every tick
 *    it re-asserts STREAM_ALARM to max if anything (a physical volume-down
 *    press) took it below that.
 *
 * STREAM_ALARM specifically because it's the one stream Android will not let
 * silent/DND mode mute (the same stream a wake-up alarm clock uses) — see
 * AppBlockSirenService for the foreground-service half of this design and
 * why USAGE_ALARM was chosen over a plain media stream.
 *
 * HONEST LIMIT (do not promise otherwise): Android has no public API to
 * disable the physical volume keys, and no confirmed way to intercept them
 * while the keyguard is showing (AccessibilityService.onKeyEvent filtering
 * is not documented or verified to fire past the lock screen — see the
 * design note this ships with). So a thief CAN still press volume-down; the
 * loop below simply reasserts max within ~300ms, faster than sustained
 * button-mashing can hold it silent for any conversationally useful window.
 */
object AppBlockSirenPlayer {
  private const val REASSERT_INTERVAL_MS = 300L

  @Volatile
  private var mediaPlayer: MediaPlayer? = null
  private var audioFocusRequest: AudioFocusRequest? = null
  private val handler = Handler(Looper.getMainLooper())
  private var maxAlarmVolume = 0

  private val reassertVolume = object : Runnable {
    override fun run() {
      val context = lastContext
      if (mediaPlayer == null || context == null) return
      try {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        if (am != null && am.getStreamVolume(AudioManager.STREAM_ALARM) < maxAlarmVolume) {
          am.setStreamVolume(AudioManager.STREAM_ALARM, maxAlarmVolume, 0)
        }
      } catch (e: Exception) {
        // best-effort — worst case one tick is silently skipped, the next
        // one (300ms later) tries again
      }
      handler.postDelayed(this, REASSERT_INTERVAL_MS)
    }
  }

  /** applicationContext from the last start() — used by the reassert loop,
   *  which has no context of its own once queued on the Handler. */
  @Volatile
  private var lastContext: Context? = null

  /**
   * Prepares and starts the siren SYNCHRONOUSLY. Returns true only once
   * `MediaPlayer.start()` has actually been called — a caller that gets
   * `true` back knows the siren is audible, not merely "requested".
   *
   * Idempotent: calling this while already playing just returns true without
   * restarting the sound (avoids an audible stutter if invoked twice).
   */
  @Synchronized
  fun start(context: Context): Boolean {
    val appContext = context.applicationContext
    lastContext = appContext
    if (mediaPlayer?.isPlaying == true) return true
    stopInternal()
    return try {
      val am = appContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        ?: return false
      maxAlarmVolume = am.getStreamMaxVolume(AudioManager.STREAM_ALARM)
      am.setStreamVolume(AudioManager.STREAM_ALARM, maxAlarmVolume, 0)

      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
      requestAudioFocus(am, attrs)

      val resId = appContext.resources.getIdentifier("siren", "raw", appContext.packageName)
      if (resId == 0) return false // module resource missing from this build
      val afd = appContext.resources.openRawResourceFd(resId) ?: return false
      val player = MediaPlayer()
      try {
        player.setAudioAttributes(attrs)
        player.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
      } finally {
        afd.close()
      }
      player.isLooping = true
      player.setVolume(1f, 1f)
      // SYNCHRONOUS on purpose — see the class doc. Blocks briefly (local
      // bundled asset, ~176KB) instead of racing an async "prepared"
      // callback against the screen-lock timer.
      player.prepare()
      player.start()
      mediaPlayer = player
      handler.post(reassertVolume)
      true
    } catch (e: Exception) {
      stopInternal()
      false
    }
  }

  fun isPlaying(): Boolean = mediaPlayer?.isPlaying == true

  @Synchronized
  fun stop() {
    stopInternal()
  }

  private fun stopInternal() {
    handler.removeCallbacks(reassertVolume)
    mediaPlayer?.let {
      try {
        it.stop()
      } catch (e: Exception) {
        // already stopped/released
      }
      try {
        it.release()
      } catch (e: Exception) {
        // ignore
      }
    }
    mediaPlayer = null
    try {
      val context = lastContext
      val am = context?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      val afr = audioFocusRequest
      if (am != null && Build.VERSION.SDK_INT >= 26 && afr != null) {
        am.abandonAudioFocusRequest(afr)
      }
    } catch (e: Exception) {
      // ignore
    }
    audioFocusRequest = null
  }

  private fun requestAudioFocus(am: AudioManager, attrs: AudioAttributes) {
    try {
      if (Build.VERSION.SDK_INT >= 26) {
        val afr = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
          .setAudioAttributes(attrs)
          .setAcceptsDelayedFocusGain(false)
          .build()
        audioFocusRequest = afr
        am.requestAudioFocus(afr)
      } else {
        @Suppress("DEPRECATION")
        am.requestAudioFocus(null, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN)
      }
    } catch (e: Exception) {
      // Best-effort: STREAM_ALARM plays even without focus (it's the one
      // stream designed to cut through), this just stops it from also
      // ducking/pausing whatever else might be playing.
    }
  }
}
