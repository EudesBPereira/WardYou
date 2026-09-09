package expo.modules.appblock

import android.accessibilityservice.AccessibilityService
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Fullscreen "app blocked" panel drawn by the AccessibilityService itself via
 * TYPE_ACCESSIBILITY_OVERLAY — the ONLY overlay type that needs no extra
 * permission and is exempt from background-activity-launch restrictions, so it
 * appears INSTANTLY when a blocked app is kicked, even on MIUI with the
 * "pop-up in background" permission denied (where startActivity is silently
 * swallowed — the old approach, which only surfaced the screen on next open).
 *
 * The action buttons don't talk to the network: they enqueue the request in
 * AppBlockPrefs and poke the JS runtime (kept alive by the shield FGS), which
 * drains the queue and calls the API with the child's own auth session.
 *
 * All UI is built programmatically — an accessibility service has no theme /
 * AppCompat inflater to lean on. Colors follow the "Guardião Sereno" brand.
 */
object AppBlockOverlay {
  private const val BRAND = 0xFF1875BE.toInt()
  private const val BRAND_SOFT = 0xFFE8F2FA.toInt()
  private const val INK = 0xFF12263A.toInt()
  private const val INK_MUTED = 0xFF5B7083.toInt()
  private const val SAFE = 0xFF1FB57A.toInt()
  private const val SCRIM = 0xE6F4F7FA.toInt() // near-opaque light scrim

  private val main = Handler(Looper.getMainLooper())
  private var current: View? = null
  private var autoDismiss: Runnable? = null

  fun show(service: AccessibilityService, pkg: String, label: String, onShown: (() -> Unit)? = null) {
    main.post {
      // Backstop (Home kick) runs after the add attempt regardless of outcome,
      // so enforcement never depends on the overlay rendering. Guarded so it
      // fires exactly once even across the fallback paths below.
      var backstopRan = false
      val runBackstop = {
        if (!backstopRan) {
          backstopRan = true
          try { onShown?.invoke() } catch (e: Exception) { /* ignore */ }
        }
      }
      removeCurrent(service)
      val wm = service.getSystemService(Context.WINDOW_SERVICE) as WindowManager
      val view = build(service, pkg, label)
      // Primary: accessibility overlay — needs NO permission, drawn by the a11y
      // layer. Fallback: TYPE_APPLICATION_OVERLAY (needs "display over other
      // apps"), for OEM builds where the a11y overlay is suppressed. MIUI
      // exposes an explicit toggle for the latter, which the setup guide walks
      // the user through — so between the two, the panel shows on every device.
      val types = mutableListOf(WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY)
      if (canDrawOverlays(service)) {
        val appOverlay =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
          else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        types.add(appOverlay)
      }
      var lastError = "no window type available"
      for (type in types) {
        try {
          val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            type,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
          )
          wm.addView(view, lp)
          current = view
          scheduleDismiss(service, 30_000L)
          // Self-diagnostic: record which window path actually rendered so the
          // setup screen (and the guardian's device via heartbeat) can confirm
          // the overlay works, instead of relying on a subjective "did it show?"
          AppBlockPrefs.setLastOverlayResult(
            service,
            if (type == WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY) "a11y-overlay" else "app-overlay",
          )
          runBackstop() // kick Home as backstop, now that the overlay is attached
          return@post
        } catch (e: Exception) {
          lastError = e.javaClass.simpleName + ": " + (e.message ?: "")
        }
      }
      // Both window overlays were suppressed (some HyperOS builds). Last resort:
      // a full-screen-intent notification — the incoming-call mechanism, which
      // OEMs DO allow to present UI from the background (unlike a plain
      // startActivity). It surfaces app/blocked.tsx automatically, no tap.
      current = null // never break enforcement over UI
      val fsi = fireFullScreenIntent(service, pkg, label)
      AppBlockPrefs.setLastOverlayResult(
        service,
        if (fsi) "fullscreen-intent" else "failed: $lastError",
      )
      // Overlays failed → the Home kick is the only block left; run it now.
      runBackstop()
    }
  }

  private const val FSI_CHANNEL = "wardyou_blocked_fullscreen"
  private const val FSI_NOTIF_ID = 4212

  private fun fireFullScreenIntent(context: Context, pkg: String, label: String): Boolean {
    return try {
      val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= 26) {
        val ch = NotificationChannel(FSI_CHANNEL, "Bloqueio de apps", NotificationManager.IMPORTANCE_HIGH)
        nm.createNotificationChannel(ch)
      }
      val uri = android.net.Uri.parse(
        "wardyou://blocked?pkg=${android.net.Uri.encode(pkg)}&label=${android.net.Uri.encode(label)}",
      )
      val activityIntent = Intent(Intent.ACTION_VIEW, uri).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      val pi = PendingIntent.getActivity(context, 1, activityIntent, flags)
      val icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
        .takeIf { it != 0 } ?: context.resources.getIdentifier("ic_launcher", "mipmap", context.packageName)
      val builder = if (Build.VERSION.SDK_INT >= 26)
        android.app.Notification.Builder(context, FSI_CHANNEL)
      else
        @Suppress("DEPRECATION") android.app.Notification.Builder(context)
      val notif = builder
        .setContentTitle(context.getString(R.string.app_block_overlay_title))
        .setContentText(context.getString(R.string.app_block_overlay_body, label))
        .setSmallIcon(icon)
        .setCategory(android.app.Notification.CATEGORY_CALL)
        .setPriority(@Suppress("DEPRECATION") android.app.Notification.PRIORITY_MAX)
        .setAutoCancel(true)
        .setFullScreenIntent(pi, true)
        .build()
      nm.notify(FSI_NOTIF_ID, notif)
      true
    } catch (e: Exception) {
      false
    }
  }

  private fun canDrawOverlays(context: Context): Boolean {
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) android.provider.Settings.canDrawOverlays(context)
      else true
    } catch (e: Exception) {
      false
    }
  }

  fun hide(service: AccessibilityService) {
    main.post { removeCurrent(service) }
  }

  private fun scheduleDismiss(service: AccessibilityService, delayMs: Long) {
    autoDismiss?.let { main.removeCallbacks(it) }
    val r = Runnable { removeCurrent(service) }
    autoDismiss = r
    main.postDelayed(r, delayMs)
  }

  private fun removeCurrent(service: AccessibilityService) {
    autoDismiss?.let { main.removeCallbacks(it) }
    autoDismiss = null
    current?.let {
      try {
        (service.getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(it)
      } catch (e: Exception) {
        // already gone
      }
    }
    current = null
  }

  private fun build(service: AccessibilityService, pkg: String, label: String): View {
    val ctx: Context = service
    val d = ctx.resources.displayMetrics.density
    fun dp(v: Int) = (v * d).toInt()

    val root = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(SCRIM)
      setPadding(dp(24), dp(24), dp(24), dp(24))
      isClickable = true // swallow touches — nothing leaks to the app behind
    }

    val card = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      background = GradientDrawable().apply {
        setColor(Color.WHITE)
        cornerRadius = dp(28).toFloat()
      }
      setPadding(dp(24), dp(28), dp(24), dp(24))
    }

    // Brand badge: the real WardYou launcher icon (not an emoji) — it's the app's
    // own identity the child already recognises on the home screen.
    val badge = android.widget.ImageView(ctx).apply {
      val icon = try {
        ctx.packageManager.getApplicationIcon(ctx.packageName)
      } catch (e: Exception) {
        null
      }
      if (icon != null) setImageDrawable(icon)
      background = GradientDrawable().apply {
        setColor(BRAND_SOFT)
        cornerRadius = dp(44).toFloat()
      }
      setPadding(dp(14), dp(14), dp(14), dp(14))
      layoutParams = LinearLayout.LayoutParams(dp(88), dp(88))
    }
    card.addView(badge)

    card.addView(TextView(ctx).apply {
      text = ctx.getString(R.string.app_block_overlay_title)
      textSize = 24f
      setTextColor(INK)
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      gravity = Gravity.CENTER
      setPadding(0, dp(16), 0, 0)
    })

    card.addView(TextView(ctx).apply {
      text = ctx.getString(R.string.app_block_overlay_body, label)
      textSize = 15f
      setTextColor(INK_MUTED)
      gravity = Gravity.CENTER
      setPadding(0, dp(8), 0, dp(20))
    })

    // Sent confirmation (hidden until an action succeeds)
    val sent = TextView(ctx).apply {
      text = ctx.getString(R.string.app_block_overlay_sent)
      textSize = 16f
      setTextColor(SAFE)
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      gravity = Gravity.CENTER
      background = GradientDrawable().apply {
        setColor(0xFFE7F8F0.toInt())
        cornerRadius = dp(20).toFloat()
      }
      setPadding(dp(16), dp(14), dp(16), dp(14))
      visibility = View.GONE
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      )
    }
    card.addView(sent)

    fun pill(bg: Int, fg: Int, textStr: String, bold: Boolean = true, stroke: Boolean = false) =
      TextView(ctx).apply {
        text = textStr
        textSize = 16f
        setTextColor(fg)
        if (bold) typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        gravity = Gravity.CENTER
        background = GradientDrawable().apply {
          setColor(bg)
          cornerRadius = dp(20).toFloat()
          if (stroke) setStroke(dp(1), 0xFFD4DEE7.toInt())
        }
        setPadding(dp(16), dp(14), dp(16), dp(14))
      }

    fun markSent(vararg toHide: View) {
      toHide.forEach { it.visibility = View.GONE }
      sent.visibility = View.VISIBLE
      scheduleDismiss(service, 2500L)
    }

    // Extra-time chips (hidden behind the "ask time" button)
    val chipsRow = LinearLayout(ctx).apply {
      orientation = LinearLayout.HORIZONTAL
      visibility = View.GONE
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ).apply { topMargin = dp(10) }
    }

    val askAccess = pill(BRAND, Color.WHITE, ctx.getString(R.string.app_block_overlay_ask_access)).apply {
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      )
    }
    val askTime = pill(Color.WHITE, BRAND, ctx.getString(R.string.app_block_overlay_ask_time), stroke = true).apply {
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ).apply { topMargin = dp(10) }
    }

    askAccess.setOnClickListener {
      AppBlockPrefs.queuePendingRequest(ctx, "access", pkg, label, null)
      AppBlockEventBus.poke()
      markSent(askAccess, askTime, chipsRow)
    }

    askTime.setOnClickListener {
      chipsRow.visibility = if (chipsRow.visibility == View.VISIBLE) View.GONE else View.VISIBLE
    }

    for (minutes in intArrayOf(15, 30, 60)) {
      val chip = pill(BRAND_SOFT, BRAND, "$minutes " + ctx.getString(R.string.app_block_overlay_min)).apply {
        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
          if (minutes != 15) leftMargin = dp(8)
        }
      }
      chip.setOnClickListener {
        AppBlockPrefs.queuePendingRequest(ctx, "extra", null, null, minutes)
        AppBlockEventBus.poke()
        markSent(askAccess, askTime, chipsRow)
      }
      chipsRow.addView(chip)
    }

    card.addView(askAccess)
    card.addView(askTime)
    card.addView(chipsRow)

    val close = TextView(ctx).apply {
      text = ctx.getString(R.string.app_block_overlay_close)
      textSize = 15f
      setTextColor(BRAND)
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      gravity = Gravity.CENTER
      setPadding(dp(16), dp(16), dp(16), dp(4))
      setOnClickListener { removeCurrent(service) }
    }
    card.addView(close)

    root.addView(card, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT,
    ))
    return root
  }
}
